// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

function migration(name: string): string {
  return readFileSync(
    resolve(process.cwd(), `../../supabase/migrations/${name}`),
    "utf8",
  );
}

const reserveBase = migration(
  "20260704120000_create_amora_turn_reserve_rpc.sql",
);
const costBudget = migration(
  "20260716097000_amora_atomic_cost_budget.sql",
);
const conflictClaim = migration(
  "20260716103000_amora_conflict_check_claim.sql",
);
const atomicCheckpoint = migration(
  "20260716105000_amora_conflict_receipt_checkpoint.sql",
);

const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000001";
const DIGEST = "a".repeat(64);

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')::text
    $$;
    CREATE TABLE public.couples (id uuid PRIMARY KEY);
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      couple_id uuid REFERENCES public.couples(id)
    );
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
    INSERT INTO public.couples (id) VALUES ('${COUPLE_ID}');
    INSERT INTO public.profiles (id, couple_id)
    VALUES ('${USER_ID}', '${COUPLE_ID}');
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.role() TO PUBLIC;
    GRANT ALL ON TABLE public.ai_interactions_log TO service_role;
  `);
  await db.exec(reserveBase);
  await db.exec(costBudget);
  await db.exec(conflictClaim);
  await db.exec(atomicCheckpoint);
  await db.exec("SET ROLE service_role");
  await db.query(
    "SELECT set_config('request.jwt.claim.role', 'service_role', false)",
  );
  return db;
}

async function prepareReservedReceipt(db: PGlite, claimToken: string) {
  const receipt = await db.query<{
    receipt_id: string;
    claim_token: string;
  }>(`
    SELECT receipt_id, claim_token
    FROM public.prepare_amora_provider_call_receipt(
      '${USER_ID}'::uuid, '${COUPLE_ID}'::uuid, '${DIGEST}',
      'general', 'gpt-5.6-luna', 'conflict:${DIGEST}', 1,
      'conflict_check', 'conflict_verify', '{}'::jsonb
    )
  `);
  const row = receipt.rows[0]!;
  const reserved = await db.query<{ allowed: boolean }>(`
    SELECT * FROM public.reserve_amora_provider_call(
      $1::uuid, $2::uuid, 'conflict:${DIGEST}', '${COUPLE_ID}'::uuid,
      2147483647, 300, 84800::bigint, 1000000::bigint
    )
  `, [row.receipt_id, row.claim_token]);
  expect(reserved.rows[0]?.allowed).toBe(true);
  return { ...row, conflictClaimToken: claimToken };
}

function checkpoint(extra: Record<string, unknown> = {}) {
  return {
    stage: "detection_complete",
    triggered: true,
    score: 7,
    reason: "borderline score verified as conflict",
    conflictContext: "bounded conflict context",
    llmVerified: true,
    ...extra,
  };
}

describe("atomic conflict receipt checkpoint migration", () => {
  it("settles cost and stores the replay checkpoint in one idempotent transaction", async () => {
    const db = await createDatabase();
    try {
      const claim = await db.query<{ value: Record<string, unknown> }>(
        "SELECT public.claim_amora_conflict_check($1, $2, $3) AS value",
        [COUPLE_ID, DIGEST, USER_ID],
      );
      const claimToken = String(claim.rows[0]?.value.claim_token);
      const receipt = await prepareReservedReceipt(db, claimToken);
      const noConflictCheckpoint = checkpoint({ triggered: false });
      const values = [
        receipt.receipt_id,
        receipt.claim_token,
        COUPLE_ID,
        DIGEST,
        claimToken,
        JSON.stringify(noConflictCheckpoint),
      ];
      const finalizeSql = `
        SELECT * FROM public.finalize_amora_conflict_verify_receipt(
          $1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, $6::jsonb,
          true, 'complete', 1230::bigint, true, NULL,
          'gpt-5.6-luna', 1200, 240, 25, '{}'::jsonb
        )
      `;

      await expect(db.query(finalizeSql, values)).resolves.toMatchObject({
        rows: [{
          finalized: true,
          receipt_status: "settled",
          checkpointed: true,
        }],
      });
      await expect(db.query(finalizeSql, values)).resolves.toMatchObject({
        rows: [{ finalized: true, checkpointed: true }],
      });

      const persisted = await db.query<{
        amora_cost_status: string;
        cost_usd: number;
        checkpoint: Record<string, unknown>;
        reserved_cost_microusd: number;
      }>(`
        SELECT log.amora_cost_status, log.cost_usd::float8 AS cost_usd,
          claim.checkpoint,
          counter.reserved_cost_microusd
        FROM public.ai_interactions_log AS log
        CROSS JOIN public.amora_conflict_check_claims AS claim
        JOIN public.amora_turn_counters AS counter
          ON counter.key LIKE 'global:%'
        WHERE log.id = $1::uuid
      `, [receipt.receipt_id]);
      expect(persisted.rows[0]).toMatchObject({
        amora_cost_status: "settled",
        cost_usd: 0.00123,
        checkpoint: noConflictCheckpoint,
        reserved_cost_microusd: 1_230,
      });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rolls back receipt settlement for a stale conflict claim or malformed checkpoint", async () => {
    const db = await createDatabase();
    try {
      const claim = await db.query<{ value: Record<string, unknown> }>(
        "SELECT public.claim_amora_conflict_check($1, $2, $3) AS value",
        [COUPLE_ID, DIGEST, USER_ID],
      );
      const claimToken = String(claim.rows[0]?.value.claim_token);
      const receipt = await prepareReservedReceipt(db, claimToken);
      const call = (token: string, value: Record<string, unknown>) => db.query(`
        SELECT * FROM public.finalize_amora_conflict_verify_receipt(
          $1::uuid, $2::uuid, '${COUPLE_ID}'::uuid, '${DIGEST}',
          $3::uuid, $4::jsonb, true, 'complete', 1230::bigint, true,
          NULL, 'gpt-5.6-luna', 1200, 240, 25, '{}'::jsonb
        )
      `, [receipt.receipt_id, receipt.claim_token, token, JSON.stringify(value)]);

      await expect(call(
        "50000000-0000-4000-8000-000000000099",
        checkpoint(),
      )).rejects.toThrow(/CONFLICT_CLAIM_STALE/);
      await expect(call(claimToken, checkpoint({ extra: "forbidden" })))
        .rejects.toThrow(/CHECKPOINT_INVALID/);

      const unchanged = await db.query<{
        amora_cost_status: string;
        cost_usd: number | null;
        checkpoint: Record<string, unknown> | null;
        reserved_cost_microusd: number;
      }>(`
        SELECT log.amora_cost_status, log.cost_usd::float8 AS cost_usd,
          claim.checkpoint,
          counter.reserved_cost_microusd
        FROM public.ai_interactions_log AS log
        CROSS JOIN public.amora_conflict_check_claims AS claim
        JOIN public.amora_turn_counters AS counter
          ON counter.key LIKE 'global:%'
        WHERE log.id = $1::uuid
      `, [receipt.receipt_id]);
      expect(unchanged.rows[0]).toMatchObject({
        amora_cost_status: "reserved",
        cost_usd: null,
        checkpoint: null,
        reserved_cost_microusd: 84_800,
      });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});
