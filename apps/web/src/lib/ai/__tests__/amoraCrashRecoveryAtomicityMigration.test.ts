// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { buildAmoraToolRoundCheckpoint } from "@/lib/ai/amoraTurnJournal";

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
const crashRecovery = migration(
  "20260716110000_amora_crash_recovery_atomicity.sql",
);

const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000001";
const REQUEST_KEY = `chat:${USER_ID}:30000000-0000-4000-8000-000000000001`;

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
      couple_id uuid REFERENCES public.couples(id),
      role text
    );
    CREATE TABLE public.chat_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      sender_id uuid,
      sender_type text NOT NULL,
      role text NOT NULL,
      content text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      visibility text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.wedding_journeys (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid NOT NULL UNIQUE REFERENCES public.couples(id),
      total_budget bigint NOT NULL DEFAULT 0,
      wedding_date date,
      venue text,
      progress jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.amora_chat_request_claims (
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      request_key text NOT NULL,
      user_id uuid NOT NULL REFERENCES public.profiles(id),
      visibility text NOT NULL,
      status text NOT NULL DEFAULT 'processing',
      message_id uuid REFERENCES public.chat_messages(id),
      claimed_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,
      failed_at timestamptz,
      failure_code text,
      attempt_count integer NOT NULL DEFAULT 1,
      user_message_id uuid REFERENCES public.chat_messages(id),
      PRIMARY KEY (couple_id, request_key)
    );
    CREATE TABLE public.amora_tool_executions (
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      request_key text NOT NULL,
      operation_key text NOT NULL,
      tool_name text NOT NULL,
      input_digest text NOT NULL,
      status text NOT NULL DEFAULT 'processing',
      result jsonb,
      claimed_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,
      uncertain_at timestamptz,
      failure_code text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      pending_action_id uuid,
      PRIMARY KEY (couple_id, request_key, operation_key)
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
    INSERT INTO public.profiles (id, couple_id, role)
    VALUES ('${USER_ID}', '${COUPLE_ID}', 'bride');
    INSERT INTO public.wedding_journeys (couple_id, total_budget)
    VALUES ('${COUPLE_ID}', 10000000);
    INSERT INTO public.amora_chat_request_claims (
      couple_id, request_key, user_id, visibility
    ) VALUES ('${COUPLE_ID}', '${REQUEST_KEY}', '${USER_ID}', 'shared');
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.role() TO PUBLIC;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
    BEGIN;
    ${reserveBase}
    ${costBudget}
    ${crashRecovery}
    COMMIT;
  `);
  await db.exec("SET ROLE service_role");
  await db.query(
    "SELECT set_config('request.jwt.claim.role', 'service_role', false)",
  );
  return db;
}

async function prepareReceipt(db: PGlite) {
  const receipt = await db.query<{ receipt_id: string; claim_token: string }>(`
    SELECT receipt_id, claim_token
    FROM public.prepare_amora_provider_call_receipt(
      '${USER_ID}'::uuid, '${COUPLE_ID}'::uuid, 'session-main',
      'general', 'gpt-5.6-luna', $1, 1,
      'durable', 'tool_round', '{}'::jsonb
    )
  `, [REQUEST_KEY]);
  const row = receipt.rows[0]!;
  const reserved = await db.query<{ allowed: boolean }>(`
    SELECT * FROM public.reserve_amora_provider_call(
      $1::uuid, $2::uuid, $3, '${COUPLE_ID}'::uuid,
      100, 300, 84800::bigint, 1000000::bigint
    )
  `, [row.receipt_id, row.claim_token, REQUEST_KEY]);
  expect(reserved.rows[0]?.allowed).toBe(true);
  return row;
}

function checkpoint() {
  return buildAmoraToolRoundCheckpoint(1, {
    fullText: "never persisted",
    toolCalls: [{
      callId: "call_budget",
      name: "update_budget",
      input: { total_budget: 30_000_000 },
    }],
    outputItems: [{
      type: "reasoning",
      id: "reasoning_1",
      summary: [],
      encrypted_content: "encrypted-reasoning-only",
    }, {
      type: "function_call",
      id: "function_1",
      call_id: "call_budget",
      name: "update_budget",
      arguments: JSON.stringify({ total_budget: 30_000_000 }),
      status: "completed",
    }],
  });
}

describe("Amora crash-recovery atomicity migration", () => {
  it("adds existing-table checks without validating under the ADD CONSTRAINT lock", () => {
    expect(crashRecovery).toMatch(
      /ADD CONSTRAINT amora_chat_request_tool_round_journal_shape CHECK[\s\S]*?\) NOT VALID;/,
    );
    expect(crashRecovery).toContain(
      "VALIDATE CONSTRAINT amora_chat_request_tool_round_journal_shape",
    );
    expect(crashRecovery).toMatch(
      /ADD CONSTRAINT amora_tool_atomic_attempt_shape CHECK[\s\S]*?\) NOT VALID;/,
    );
    expect(crashRecovery).toContain(
      "VALIDATE CONSTRAINT amora_tool_atomic_attempt_shape",
    );
  });

  it("settles a paid tool round and journals its exact replay checkpoint in one idempotent transaction", async () => {
    const db = await createDatabase();
    try {
      const receipt = await prepareReceipt(db);
      const params = [
        receipt.receipt_id,
        receipt.claim_token,
        JSON.stringify(checkpoint()),
      ];
      const sql = `
        SELECT * FROM public.finalize_amora_tool_round_receipt(
          $1::uuid, $2::uuid, '${COUPLE_ID}'::uuid, '${REQUEST_KEY}', 1,
          $3::jsonb, true, 'complete', 1230::bigint, true, NULL,
          'gpt-5.6-luna', 1200, 240, 25,
          '{"provider_response_id":"resp_safe"}'::jsonb
        )
      `;

      await expect(db.query(sql, params)).resolves.toMatchObject({
        rows: [{ finalized: true, receipt_status: "settled", checkpointed: true }],
      });
      await expect(db.query(sql, params)).resolves.toMatchObject({
        rows: [{ finalized: true, receipt_status: "settled", checkpointed: true }],
      });

      const state = await db.query<{
        amora_cost_status: string;
        journal: unknown[];
        ai_output: string | null;
      }>(`
        SELECT log.amora_cost_status, claim.tool_round_journal AS journal,
          log.ai_output
        FROM public.ai_interactions_log AS log
        JOIN public.amora_chat_request_claims AS claim
          ON claim.couple_id = log.couple_id
         AND claim.request_key = log.amora_request_key
        WHERE log.id = $1::uuid
      `, [receipt.receipt_id]);
      expect(state.rows[0]).toMatchObject({
        amora_cost_status: "settled",
        journal: [checkpoint()],
        ai_output: null,
      });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("does not settle a paid receipt when its journal exposes a plaintext reasoning summary", async () => {
    const db = await createDatabase();
    try {
      const receipt = await prepareReceipt(db);
      const invalid = checkpoint();
      invalid.outputItems = invalid.outputItems.map((item) =>
        item.type === "reasoning"
          ? {
              ...item,
              summary: [{
                type: "summary_text" as const,
                text: "private reasoning",
              }],
            }
          : item);

      await expect(db.query(`
        SELECT * FROM public.finalize_amora_tool_round_receipt(
          $1::uuid, $2::uuid, '${COUPLE_ID}'::uuid, '${REQUEST_KEY}', 1,
          $3::jsonb, true, 'complete', 1230::bigint, true, NULL,
          'gpt-5.6-luna', 1200, 240, 25,
          '{"provider_response_id":"resp_unsafe"}'::jsonb
        )
      `, [
        receipt.receipt_id,
        receipt.claim_token,
        JSON.stringify(invalid),
      ])).rejects.toThrow(/AMORA_TOOL_ROUND_CHECKPOINT_INVALID/);

      const state = await db.query<{
        amora_cost_status: string;
        journal: unknown[];
      }>(`
        SELECT log.amora_cost_status, claim.tool_round_journal AS journal
        FROM public.ai_interactions_log AS log
        JOIN public.amora_chat_request_claims AS claim
          ON claim.couple_id = log.couple_id
         AND claim.request_key = log.amora_request_key
        WHERE log.id = $1::uuid
      `, [receipt.receipt_id]);
      expect(state.rows[0]).toEqual({
        amora_cost_status: "reserved",
        journal: [],
      });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("commits a budget change and its durable tool result together, then replays the result", async () => {
    const db = await createDatabase();
    try {
      const operationKey = "b".repeat(64);
      const inputDigest = "a".repeat(64);
      await db.query(`
        INSERT INTO public.amora_tool_executions (
          couple_id, request_key, operation_key, tool_name, input_digest,
          atomic_dispatch, request_attempt_count
        ) VALUES ($1::uuid, $2, $3, 'update_budget', $4, true, 1)
      `, [COUPLE_ID, REQUEST_KEY, operationKey, inputDigest]);
      const result = {
        toolName: "update_budget",
        toolOutput: {
          total_budget: 30_000_000,
          previous_budget: 10_000_000,
        },
        success: true,
        displayMessage: "총예산을 1,000만원에서 3,000만원으로 변경했어요.",
      };
      const params = [
        operationKey,
        inputDigest,
        JSON.stringify({ total_budget: 30_000_000 }),
        JSON.stringify({
          kind: "journey_total_budget_cas",
          expected: 10_000_000,
          value: 30_000_000,
        }),
        JSON.stringify(result),
      ];
      const sql = `
        SELECT public.apply_amora_atomic_tool_execution(
          '${COUPLE_ID}'::uuid, '${REQUEST_KEY}', $1, 1, $2,
          $3::jsonb, $4::jsonb, $5::jsonb
        ) AS result
      `;

      await expect(db.query(sql, params)).resolves.toMatchObject({
        rows: [{ result }],
      });
      await expect(db.query(sql, params)).resolves.toMatchObject({
        rows: [{ result }],
      });

      const state = await db.query<{
        total_budget: string;
        status: string;
        result: unknown;
      }>(`
        SELECT journey.total_budget::text, execution.status, execution.result
        FROM public.wedding_journeys AS journey
        JOIN public.amora_tool_executions AS execution
          ON execution.couple_id = journey.couple_id
        WHERE journey.couple_id = $1::uuid
      `, [COUPLE_ID]);
      expect(state.rows[0]).toEqual({
        total_budget: "30000000",
        status: "completed",
        result,
      });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("lets a reclaimed attempt claim only the exact journal-authorized operation", async () => {
    const db = await createDatabase();
    try {
      const durableCheckpoint = checkpoint();
      const tool = durableCheckpoint.toolCalls[0]!;
      const message = await db.query<{ id: string }>(`
        INSERT INTO public.chat_messages (
          couple_id, sender_id, sender_type, role, content, metadata, visibility
        ) VALUES (
          $1::uuid, $2::uuid, 'bride', 'user', '총예산을 바꿔줘',
          '{}'::jsonb, 'shared'
        ) RETURNING id
      `, [COUPLE_ID, USER_ID]);
      await db.query(`
        UPDATE public.amora_chat_request_claims
        SET attempt_count = 2,
            user_message_id = $3::uuid,
            tool_round_journal = $4::jsonb,
            tool_round_journal_expires_at = now() + interval '1 hour'
        WHERE couple_id = $1::uuid AND request_key = $2
      `, [
        COUPLE_ID,
        REQUEST_KEY,
        message.rows[0]!.id,
        JSON.stringify([durableCheckpoint]),
      ]);

      const claim = await db.query<{ result: Record<string, unknown> }>(`
        SELECT public.claim_amora_tool_execution(
          '${COUPLE_ID}'::uuid, '${REQUEST_KEY}', $1, 'update_budget', $2,
          2, NULL::uuid, 1
        ) AS result
      `, [tool.operationKey, tool.inputDigest]);
      expect(claim.rows[0]?.result).toEqual({ action: "acquired" });

      const row = await db.query<{ atomic_dispatch: boolean }>(`
        SELECT atomic_dispatch
        FROM public.amora_tool_executions
        WHERE couple_id = $1::uuid AND request_key = $2
      `, [COUPLE_ID, REQUEST_KEY]);
      expect(row.rows).toEqual([{ atomic_dispatch: true }]);

      const blocked = await db.query<{ result: Record<string, unknown> }>(`
        SELECT public.claim_amora_tool_execution(
          '${COUPLE_ID}'::uuid, '${REQUEST_KEY}', $1, 'update_budget', $2,
          2, NULL::uuid, 1
        ) AS result
      `, ["c".repeat(64), "d".repeat(64)]);
      expect(blocked.rows[0]?.result).toEqual({ action: "stale_context" });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("safely reacquires an uncommitted server-confirmed action on the reclaimed request", async () => {
    const db = await createDatabase();
    try {
      const operationKey = "5".repeat(64);
      const inputDigest = "6".repeat(64);
      const actionId = "11111111-1111-4111-8111-111111111111";
      const message = await db.query<{ id: string }>(`
        INSERT INTO public.chat_messages (
          couple_id, sender_id, sender_type, role, content, metadata, visibility
        ) VALUES (
          $1::uuid, $2::uuid, 'bride', 'user', 'Yes, change it',
          '{}'::jsonb, 'shared'
        ) RETURNING id
      `, [COUPLE_ID, USER_ID]);
      await db.query(`
        UPDATE public.amora_chat_request_claims
        SET user_message_id = $3::uuid
        WHERE couple_id = $1::uuid AND request_key = $2
      `, [COUPLE_ID, REQUEST_KEY, message.rows[0]!.id]);

      const claimSql = (attempt: number) => `
        SELECT public.claim_amora_tool_execution(
          '${COUPLE_ID}'::uuid, '${REQUEST_KEY}', $1, 'update_budget', $2,
          ${attempt}, $3::uuid, NULL::integer
        ) AS result
      `;
      await expect(db.query<{ result: Record<string, unknown> }>(
        claimSql(1),
        [operationKey, inputDigest, actionId],
      )).resolves.toMatchObject({ rows: [{ result: { action: "acquired" } }] });

      const first = await db.query<{
        atomic_dispatch: boolean;
        request_attempt_count: number;
      }>(`
        SELECT atomic_dispatch, request_attempt_count
        FROM public.amora_tool_executions
        WHERE couple_id = $1::uuid AND request_key = $2
      `, [COUPLE_ID, REQUEST_KEY]);
      expect(first.rows).toEqual([{
        atomic_dispatch: true,
        request_attempt_count: 1,
      }]);

      await db.query(`
        UPDATE public.amora_chat_request_claims
        SET attempt_count = 2
        WHERE couple_id = $1::uuid AND request_key = $2
      `, [COUPLE_ID, REQUEST_KEY]);
      await expect(db.query<{ result: Record<string, unknown> }>(
        claimSql(2),
        [operationKey, inputDigest, actionId],
      )).resolves.toMatchObject({ rows: [{ result: { action: "acquired" } }] });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("durably completes an unsupported mutation as a no-op", async () => {
    const db = await createDatabase();
    try {
      const operationKey = "7".repeat(64);
      const inputDigest = "8".repeat(64);
      const result = {
        toolName: "update_wedding_date",
        toolOutput: { error: "TOOL_ATOMICITY_UNAVAILABLE" },
        success: false,
        displayMessage: "This change is not available through the atomic dispatcher.",
      };
      await db.query(`
        INSERT INTO public.amora_tool_executions (
          couple_id, request_key, operation_key, tool_name, input_digest,
          atomic_dispatch, request_attempt_count
        ) VALUES (
          $1::uuid, $2, $3, 'update_wedding_date', $4, true, 1
        )
      `, [COUPLE_ID, REQUEST_KEY, operationKey, inputDigest]);

      const applied = await db.query<{ result: unknown }>(`
        SELECT public.apply_amora_atomic_tool_execution(
          '${COUPLE_ID}'::uuid, '${REQUEST_KEY}', $1, 1, $2,
          $3::jsonb, '{"kind":"none"}'::jsonb, $4::jsonb
        ) AS result
      `, [
        operationKey,
        inputDigest,
        JSON.stringify({ wedding_date: "2027-05-01" }),
        JSON.stringify(result),
      ]);
      expect(applied.rows[0]?.result).toEqual(result);

      const state = await db.query<{
        wedding_date: string | null;
        status: string;
      }>(`
        SELECT journey.wedding_date::text, execution.status
        FROM public.wedding_journeys AS journey
        JOIN public.amora_tool_executions AS execution
          ON execution.couple_id = journey.couple_id
        WHERE journey.couple_id = $1::uuid
      `, [COUPLE_ID]);
      expect(state.rows[0]).toEqual({
        wedding_date: null,
        status: "completed",
      });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("commits a schedule event and its durable result in one transaction", async () => {
    const db = await createDatabase();
    try {
      const operationKey = "e".repeat(64);
      const inputDigest = "f".repeat(64);
      const event = {
        id: "evt_atomic_1",
        date: "2027-03-12",
        title: "드레스 투어",
        createdAt: "2026-07-17T00:00:00.000Z",
        updatedAt: "2026-07-17T00:00:00.000Z",
      };
      const result = {
        toolName: "add_schedule_event",
        toolOutput: { event },
        success: true,
        displayMessage: "2027-03-12에 드레스 투어 일정을 추가했어요.",
      };
      await db.query(`
        INSERT INTO public.amora_tool_executions (
          couple_id, request_key, operation_key, tool_name, input_digest,
          atomic_dispatch, request_attempt_count
        ) VALUES (
          $1::uuid, $2, $3, 'add_schedule_event', $4, true, 1
        )
      `, [COUPLE_ID, REQUEST_KEY, operationKey, inputDigest]);

      const applied = await db.query<{ result: unknown }>(`
        SELECT public.apply_amora_atomic_tool_execution(
          '${COUPLE_ID}'::uuid, '${REQUEST_KEY}', $1, 1, $2,
          $3::jsonb, $4::jsonb, $5::jsonb
        ) AS result
      `, [
        operationKey,
        inputDigest,
        JSON.stringify({ date: "2027-03-12", title: "드레스 투어" }),
        JSON.stringify({
          kind: "journey_progress_key_cas",
          key: "__events",
          expectedPresent: false,
          value: [event],
        }),
        JSON.stringify(result),
      ]);
      expect(applied.rows[0]?.result).toEqual(result);

      const state = await db.query<{ events: unknown; result: unknown }>(`
        SELECT journey.progress -> '__events' AS events, execution.result
        FROM public.wedding_journeys AS journey
        JOIN public.amora_tool_executions AS execution
          ON execution.couple_id = journey.couple_id
        WHERE journey.couple_id = $1::uuid
      `, [COUPLE_ID]);
      expect(state.rows[0]).toEqual({ events: [event], result });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("atomically deletes a schedule event and records the exact removed value", async () => {
    const db = await createDatabase();
    try {
      const operationKey = "1".repeat(64);
      const inputDigest = "2".repeat(64);
      const event = {
        id: "evt_delete_1",
        date: "2027-03-12",
        title: "Dress tour",
        createdAt: "2026-07-17T00:00:00.000Z",
        updatedAt: "2026-07-17T00:00:00.000Z",
      };
      const result = {
        toolName: "delete_schedule_event",
        toolOutput: { deleted_event: event },
        success: true,
        displayMessage: "Schedule event deleted.",
      };
      await db.query(`
        UPDATE public.wedding_journeys
        SET progress = jsonb_build_object('__events', $2::jsonb)
        WHERE couple_id = $1::uuid
      `, [COUPLE_ID, JSON.stringify([event])]);
      await db.query(`
        INSERT INTO public.amora_tool_executions (
          couple_id, request_key, operation_key, tool_name, input_digest,
          atomic_dispatch, request_attempt_count
        ) VALUES (
          $1::uuid, '${REQUEST_KEY}', $2, 'delete_schedule_event', $3, true, 1
        )
      `, [COUPLE_ID, operationKey, inputDigest]);

      const applied = await db.query<{ result: unknown }>(`
        SELECT public.apply_amora_atomic_tool_execution(
          '${COUPLE_ID}'::uuid, '${REQUEST_KEY}', $1, 1, $2,
          $3::jsonb, $4::jsonb, $5::jsonb
        ) AS result
      `, [
        operationKey,
        inputDigest,
        JSON.stringify({ event_id: event.id, confirmed: true }),
        JSON.stringify({
          kind: "journey_progress_key_cas",
          key: "__events",
          expectedPresent: true,
          expected: [event],
          value: [],
        }),
        JSON.stringify(result),
      ]);
      expect(applied.rows[0]?.result).toEqual(result);

      const state = await db.query<{ events: unknown; result: unknown }>(`
        SELECT journey.progress -> '__events' AS events, execution.result
        FROM public.wedding_journeys AS journey
        JOIN public.amora_tool_executions AS execution
          ON execution.couple_id = journey.couple_id
        WHERE journey.couple_id = $1::uuid
      `, [COUPLE_ID]);
      expect(state.rows[0]).toEqual({ events: [], result });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rolls back the domain write when durable ledger completion fails", async () => {
    const db = await createDatabase();
    try {
      const operationKey = "3".repeat(64);
      const inputDigest = "4".repeat(64);
      await db.query(`
        INSERT INTO public.amora_tool_executions (
          couple_id, request_key, operation_key, tool_name, input_digest,
          atomic_dispatch, request_attempt_count
        ) VALUES (
          $1::uuid, $2, $3, 'update_budget', $4, true, 1
        )
      `, [COUPLE_ID, REQUEST_KEY, operationKey, inputDigest]);
      await db.exec(`
        RESET ROLE;
        CREATE FUNCTION public.fail_amora_ledger_completion()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.status = 'completed' THEN
            RAISE EXCEPTION 'simulated ledger outage';
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER fail_amora_ledger_completion
        BEFORE UPDATE OF status ON public.amora_tool_executions
        FOR EACH ROW EXECUTE FUNCTION public.fail_amora_ledger_completion();
        SET ROLE service_role;
        SELECT set_config('request.jwt.claim.role', 'service_role', false);
      `);

      await expect(db.query(`
        SELECT public.apply_amora_atomic_tool_execution(
          '${COUPLE_ID}'::uuid, '${REQUEST_KEY}', $1, 1, $2,
          $3::jsonb, $4::jsonb, $5::jsonb
        )
      `, [
        operationKey,
        inputDigest,
        JSON.stringify({ total_budget: 30_000_000 }),
        JSON.stringify({
          kind: "journey_total_budget_cas",
          expected: 10_000_000,
          value: 30_000_000,
        }),
        JSON.stringify({
          toolName: "update_budget",
          toolOutput: {
            total_budget: 30_000_000,
            previous_budget: 10_000_000,
          },
          success: true,
          displayMessage: "Budget changed.",
        }),
      ])).rejects.toThrow(/simulated ledger outage/);

      const state = await db.query<{ total_budget: string; status: string }>(`
        SELECT journey.total_budget::text, execution.status
        FROM public.wedding_journeys AS journey
        JOIN public.amora_tool_executions AS execution
          ON execution.couple_id = journey.couple_id
        WHERE journey.couple_id = $1::uuid
      `, [COUPLE_ID]);
      expect(state.rows[0]).toEqual({
        total_budget: "10000000",
        status: "processing",
      });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});
