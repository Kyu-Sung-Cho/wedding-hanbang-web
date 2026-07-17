// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const baseMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260704120000_create_amora_turn_reserve_rpc.sql",
  ),
  "utf8",
);
const budgetMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260716097000_amora_atomic_cost_budget.sql",
  ),
  "utf8",
);

const COUPLE_ID = "10000000-0000-4000-8000-000000000001";

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.role()
    RETURNS text LANGUAGE sql STABLE
    AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')::text
    $$;
    CREATE TABLE public.ai_interactions_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid,
      couple_id uuid,
      session_id text,
      message_id uuid,
      interaction_type text,
      specialist_type text,
      user_input text,
      ai_output text,
      tool_name text,
      tool_input jsonb,
      tool_output jsonb,
      latency_ms integer,
      success boolean DEFAULT true,
      error_message text,
      model text,
      tokens_input integer,
      tokens_output integer,
      cost_usd numeric,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.role() TO PUBLIC;
    GRANT ALL ON TABLE public.ai_interactions_log TO service_role;
  `);
  return db;
}

async function setPersona(
  db: PGlite,
  role: "authenticated" | "service_role",
) {
  await db.exec(`SET ROLE ${role}`);
  await db.query("SELECT set_config('request.jwt.claim.role', $1, false)", [role]);
}

async function resetPersona(db: PGlite) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.role', '', false)");
}

describe("Amora atomic daily cost budget migration", () => {
  it("settles one provider receipt from its maximum reservation to actual usage", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${baseMigration}\n${budgetMigration}\nCOMMIT;`);
      await setPersona(db, "service_role");

      const prepared = await db.query<{
        receipt_id: string;
        claim_token: string;
        claimed: boolean;
        receipt_status: string;
      }>(`
        SELECT * FROM public.prepare_amora_provider_call_receipt(
          '${COUPLE_ID}'::uuid,
          '${COUPLE_ID}'::uuid,
          'session_123',
          'general',
          'gpt-5.6-terra',
          'request_123',
          1,
          'durable',
          'tool_round',
          '{"request_key":"request_123","provider_call_index":1,"provider_call_phase":"tool_round"}'::jsonb
        )
      `);
      expect(prepared.rows[0]).toMatchObject({
        claimed: true,
        receipt_status: "prepared",
      });

      const receipt = prepared.rows[0]!;
      const reserved = await db.query<{
        allowed: boolean;
        reason: string | null;
      }>(`
        SELECT * FROM public.reserve_amora_provider_call(
          $1::uuid,
          $2::uuid,
          'request_123',
          '${COUPLE_ID}'::uuid,
          100,
          300,
          212000::bigint,
          1000000::bigint
        )
      `, [receipt.receipt_id, receipt.claim_token]);
      expect(reserved.rows[0]).toMatchObject({ allowed: true, reason: null });

      const beforeSettlement = await db.query<{ reserved_cost_microusd: number }>(`
        SELECT reserved_cost_microusd
        FROM public.amora_turn_counters
        WHERE key LIKE 'global:%'
      `);
      expect(beforeSettlement.rows[0]?.reserved_cost_microusd).toBe(212_000);

      const finalized = await db.query<{
        finalized: boolean;
        receipt_status: string;
      }>(`
        SELECT * FROM public.finalize_amora_provider_call_receipt(
          $1::uuid,
          $2::uuid,
          true,
          'complete',
          1230::bigint,
          true,
          NULL,
          'gpt-5.6-terra',
          1200,
          240,
          25,
          '{"ledger_status":"settled"}'::jsonb
        )
      `, [receipt.receipt_id, receipt.claim_token]);
      expect(finalized.rows[0]).toEqual({
        finalized: true,
        receipt_status: "settled",
      });

      const afterSettlement = await db.query<{
        reserved_cost_microusd: number;
      }>(`
        SELECT reserved_cost_microusd
        FROM public.amora_turn_counters
        WHERE key LIKE 'global:%'
      `);
      expect(afterSettlement.rows[0]?.reserved_cost_microusd).toBe(1_230);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("does not admit or charge the same provider receipt twice", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${baseMigration}\n${budgetMigration}\nCOMMIT;`);
      await setPersona(db, "service_role");

      const prepare = async () => db.query<{
        receipt_id: string;
        claim_token: string;
        claimed: boolean;
        receipt_status: string;
      }>(`
        SELECT * FROM public.prepare_amora_provider_call_receipt(
          '${COUPLE_ID}'::uuid, '${COUPLE_ID}'::uuid, 'session_123',
          'general', 'gpt-5.6-luna', 'request_duplicate', 1,
          'durable', 'tool_round', '{}'::jsonb
        )
      `);

      const first = (await prepare()).rows[0]!;
      await db.query(`
        SELECT * FROM public.reserve_amora_provider_call(
          $1::uuid, $2::uuid, 'request_duplicate', '${COUPLE_ID}'::uuid,
          100, 300, 84800::bigint, 1000000::bigint
        )
      `, [first.receipt_id, first.claim_token]);

      const finalizeSql = `
        SELECT * FROM public.finalize_amora_provider_call_receipt(
          $1::uuid, $2::uuid, true, 'complete', 1230::bigint, true,
          NULL, 'gpt-5.6-luna', 1200, 240, 25, '{}'::jsonb
        )
      `;
      await db.query(finalizeSql, [first.receipt_id, first.claim_token]);
      await db.query(finalizeSql, [first.receipt_id, first.claim_token]);

      expect((await prepare()).rows[0]).toMatchObject({
        receipt_id: first.receipt_id,
        claimed: false,
        receipt_status: "settled",
      });
      const counters = await db.query<{
        key: string;
        count: number;
        reserved_cost_microusd: number;
      }>(`
        SELECT key, count, reserved_cost_microusd
        FROM public.amora_turn_counters
        ORDER BY key
      `);
      expect(counters.rows.find((row) => row.key.startsWith("global:")))
        .toMatchObject({ count: 1, reserved_cost_microusd: 1_230 });
      expect(counters.rows.find((row) => row.key.startsWith("couple:")))
        .toMatchObject({ count: 1 });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("admits only valid source and phase pairs for conflict-check receipts", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${baseMigration}\n${budgetMigration}\nCOMMIT;`);
      await setPersona(db, "service_role");

      const valid = await db.query<{ receipt_status: string }>(`
        SELECT * FROM public.prepare_amora_provider_call_receipt(
          '${COUPLE_ID}'::uuid, '${COUPLE_ID}'::uuid, 'session_conflict',
          'general', 'gpt-5.6-luna', 'request_conflict', 1,
          'conflict_check', 'conflict_verify', '{}'::jsonb
        )
      `);
      expect(valid.rows[0]?.receipt_status).toBe("prepared");

      await expect(db.query(`
        SELECT * FROM public.prepare_amora_provider_call_receipt(
          '${COUPLE_ID}'::uuid, '${COUPLE_ID}'::uuid, 'session_invalid',
          'general', 'gpt-5.6-luna', 'request_invalid_pair', 1,
          'durable', 'conflict_mediation', '{}'::jsonb
        )
      `)).rejects.toThrow("AMORA_PROVIDER_RECEIPT_INVALID_ARGS");
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("refunds a proven pre-provider failure and fences its stale finalizer on retry", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${baseMigration}\n${budgetMigration}\nCOMMIT;`);
      await setPersona(db, "service_role");

      const prepare = async () => db.query<{
        receipt_id: string;
        claim_token: string;
        claimed: boolean;
        receipt_status: string;
      }>(`
        SELECT * FROM public.prepare_amora_provider_call_receipt(
          '${COUPLE_ID}'::uuid, '${COUPLE_ID}'::uuid, 'session_retry',
          'general', 'gpt-5.6-luna', 'request_retry', 1,
          'durable', 'tool_round', '{}'::jsonb
        )
      `);
      const reserve = async (receiptId: string, claimToken: string) =>
        db.query<{ allowed: boolean; reason: string | null }>(`
          SELECT * FROM public.reserve_amora_provider_call(
            $1::uuid, $2::uuid, 'request_retry', '${COUPLE_ID}'::uuid,
            100, 300, 84800::bigint, 1000000::bigint
          )
        `, [receiptId, claimToken]);

      const first = (await prepare()).rows[0]!;
      expect((await reserve(first.receipt_id, first.claim_token)).rows[0])
        .toMatchObject({ allowed: true, reason: null });

      const released = await db.query<{
        finalized: boolean;
        receipt_status: string;
      }>(`
        SELECT * FROM public.finalize_amora_provider_call_receipt(
          $1::uuid, $2::uuid, false, 'complete', NULL, false,
          'input_count_failed', 'gpt-5.6-luna', NULL, NULL, 5,
          '{}'::jsonb
        )
      `, [first.receipt_id, first.claim_token]);
      expect(released.rows[0]).toEqual({
        finalized: true,
        receipt_status: "released",
      });

      const countersAfterRelease = await db.query<{
        key: string;
        count: number;
        reserved_cost_microusd: number;
      }>(`
        SELECT key, count, reserved_cost_microusd
        FROM public.amora_turn_counters
        ORDER BY key
      `);
      expect(countersAfterRelease.rows.every((row) => row.count === 0)).toBe(true);
      expect(countersAfterRelease.rows.find((row) => row.key.startsWith("global:")))
        .toMatchObject({ reserved_cost_microusd: 0 });

      const retry = (await prepare()).rows[0]!;
      expect(retry).toMatchObject({
        receipt_id: first.receipt_id,
        claimed: true,
        receipt_status: "prepared",
      });
      expect(retry.claim_token).not.toBe(first.claim_token);

      const stale = await db.query<{
        finalized: boolean;
        receipt_status: string;
      }>(`
        SELECT * FROM public.finalize_amora_provider_call_receipt(
          $1::uuid, $2::uuid, false, 'complete', NULL, false,
          'late_finalize', 'gpt-5.6-luna', NULL, NULL, 10, '{}'::jsonb
        )
      `, [first.receipt_id, first.claim_token]);
      expect(stale.rows[0]).toEqual({
        finalized: false,
        receipt_status: "stale_claim",
      });
      expect((await reserve(retry.receipt_id, retry.claim_token)).rows[0])
        .toMatchObject({ allowed: true, reason: null });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("seeds known cost, reserves atomically, and rejects the next over-budget turn", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        INSERT INTO public.ai_interactions_log (
          couple_id, interaction_type, cost_usd
        ) VALUES ('${COUPLE_ID}', 'amora_director', 0.25);
        INSERT INTO public.ai_interactions_log (
          couple_id, interaction_type, cost_usd, metadata
        ) VALUES (
          '${COUPLE_ID}',
          'community_amora_comment',
          0.10,
          '{"ai_provider":"openai"}'::jsonb
        );
        INSERT INTO public.ai_interactions_log (
          couple_id, interaction_type, cost_usd, metadata
        ) VALUES (
          '${COUPLE_ID}',
          'non_provider_business_event',
          99.00,
          '{}'::jsonb
        );
        BEGIN;
        ${baseMigration}
        ${budgetMigration}
        COMMIT;
      `);
      await setPersona(db, "service_role");

      const first = await db.query<{ allowed: boolean; reason: string | null }>(
        `SELECT * FROM public.reserve_amora_turn($1, 100, 300, 600000::bigint, 1000000::bigint)`,
        [COUPLE_ID],
      );
      expect(first.rows[0]).toEqual({ allowed: true, reason: null });

      const denied = await db.query<{ allowed: boolean; reason: string | null }>(
        `SELECT * FROM public.reserve_amora_turn($1, 100, 300, 600000::bigint, 1000000::bigint)`,
        [COUPLE_ID],
      );
      expect(denied.rows[0]).toEqual({
        allowed: false,
        reason: "global_daily_budget",
      });

      const counters = await db.query<{
        key: string;
        count: number;
        reserved_cost_microusd: number;
      }>(`
        SELECT key, count, reserved_cost_microusd
        FROM public.amora_turn_counters
        ORDER BY key
      `);
      const global = counters.rows.find((row) => row.key.startsWith("global:"));
      const couple = counters.rows.find((row) => row.key.startsWith("couple:"));
      expect(global).toMatchObject({ count: 1, reserved_cost_microusd: 950_000 });
      expect(couple).toMatchObject({ count: 1, reserved_cost_microusd: 0 });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps both signatures service-only and preserves rolling-deploy compatibility", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${baseMigration}\n${budgetMigration}\nCOMMIT;`);

      await setPersona(db, "authenticated");
      await expect(
        db.query(
          `SELECT * FROM public.reserve_amora_turn($1, 100, 300, 1000::bigint, 1000000::bigint)`,
          [COUPLE_ID],
        ),
      ).rejects.toThrow();

      await resetPersona(db);
      await setPersona(db, "service_role");
      const legacy = await db.query<{ allowed: boolean; reason: string | null }>(
        "SELECT * FROM public.reserve_amora_turn($1, 100, 300)",
        [COUPLE_ID],
      );
      expect(legacy.rows[0]).toEqual({ allowed: true, reason: null });
      const global = await db.query<{ reserved_cost_microusd: number }>(`
        SELECT reserved_cost_microusd
        FROM public.amora_turn_counters
        WHERE key LIKE 'global:%'
      `);
      expect(global.rows[0]?.reserved_cost_microusd).toBe(636_000);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});
