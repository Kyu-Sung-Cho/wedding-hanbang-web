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
const atomicChatResponse = migration(
  "20260716106000_amora_atomic_chat_response.sql",
);

const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000001";
const RECEIPT_REQUEST_KEY = `chat:${USER_ID}:30000000-0000-4000-8000-000000000001`;
const CONFLICT_DIGEST = "a".repeat(64);
const CONFLICT_RECEIPT_KEY = `conflict:${CONFLICT_DIGEST}`;
const MEDIATION_REQUEST_KEY = `mediation:${CONFLICT_DIGEST}`;

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
    CREATE TABLE public.chat_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      sender_id uuid,
      sender_type text NOT NULL,
      role text NOT NULL,
      content text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      stage_tag text,
      specialist_type text,
      visibility text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX chat_messages_client_request_id_unique
      ON public.chat_messages (couple_id, (metadata->>'client_request_id'))
      WHERE metadata->>'client_request_id' IS NOT NULL;
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
      PRIMARY KEY (couple_id, request_key)
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
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
  `);
  await db.exec(reserveBase);
  await db.exec(costBudget);
  await db.exec(atomicChatResponse);
  await db.exec("SET ROLE service_role");
  await db.query(
    "SELECT set_config('request.jwt.claim.role', 'service_role', false)",
  );
  return db;
}

async function prepareMainChat(db: PGlite) {
  await db.query(`
    INSERT INTO public.amora_chat_request_claims (
      couple_id, request_key, user_id, visibility, attempt_count
    ) VALUES ($1::uuid, $2, $3::uuid, 'shared', 1)
  `, [COUPLE_ID, RECEIPT_REQUEST_KEY, USER_ID]);
  const receipt = await db.query<{ receipt_id: string; claim_token: string }>(`
    SELECT receipt_id, claim_token
    FROM public.prepare_amora_provider_call_receipt(
      '${USER_ID}'::uuid, '${COUPLE_ID}'::uuid, 'session-main',
      'general', 'gpt-5.6-luna', $1, 1,
      'durable', 'tool_round', '{}'::jsonb
    )
  `, [RECEIPT_REQUEST_KEY]);
  const row = receipt.rows[0]!;
  const reserved = await db.query<{ allowed: boolean }>(`
    SELECT * FROM public.reserve_amora_provider_call(
      $1::uuid, $2::uuid, $3, '${COUPLE_ID}'::uuid,
      100, 300, 84800::bigint, 1000000::bigint
    )
  `, [row.receipt_id, row.claim_token, RECEIPT_REQUEST_KEY]);
  expect(reserved.rows[0]?.allowed).toBe(true);
  return row;
}

async function prepareConflictMediation(db: PGlite) {
  await db.query(`
    INSERT INTO public.amora_chat_request_claims (
      couple_id, request_key, user_id, visibility, attempt_count
    ) VALUES ($1::uuid, $2, $3::uuid, 'shared', 1)
  `, [COUPLE_ID, MEDIATION_REQUEST_KEY, USER_ID]);
  const receipt = await db.query<{ receipt_id: string; claim_token: string }>(`
    SELECT receipt_id, claim_token
    FROM public.prepare_amora_provider_call_receipt(
      '${USER_ID}'::uuid, '${COUPLE_ID}'::uuid, '${CONFLICT_DIGEST}',
      'general', 'gpt-5.6-terra', $1, 1,
      'conflict_check', 'conflict_mediation', '{}'::jsonb
    )
  `, [CONFLICT_RECEIPT_KEY]);
  const row = receipt.rows[0]!;
  const reserved = await db.query<{ allowed: boolean }>(`
    SELECT * FROM public.reserve_amora_provider_call(
      $1::uuid, $2::uuid, $3, '${COUPLE_ID}'::uuid,
      100, 300, 636000::bigint, 1000000::bigint
    )
  `, [row.receipt_id, row.claim_token, CONFLICT_RECEIPT_KEY]);
  expect(reserved.rows[0]?.allowed).toBe(true);
  return row;
}

function finalizeSql(options: {
  requestKey?: string;
  attemptCount?: number;
  model?: string;
} = {}): string {
  const requestKey = options.requestKey ?? "$3";
  const attemptCount = options.attemptCount ?? 1;
  const model = options.model ?? "gpt-5.6-luna";
  return `
    SELECT * FROM public.finalize_amora_chat_response(
      $1::uuid, $2::uuid,
      '${COUPLE_ID}'::uuid, '${USER_ID}'::uuid, ${requestKey}, 'shared', ${attemptCount},
      $4, $5::jsonb, 'exploring', 'general',
      true, 'complete', 1230::bigint, true, NULL,
      '${model}', 1200, 240, 25, $6::jsonb
    )
  `;
}

describe("atomic terminal Amora response migration", () => {
  it("settles the receipt, inserts one assistant message, and completes its generation-fenced claim atomically", async () => {
    const db = await createDatabase();
    try {
      const receipt = await prepareMainChat(db);
      const privateText = "두 분이 정한 우선순위를 먼저 정리해볼게요.";
      const params = [
        receipt.receipt_id,
        receipt.claim_token,
        RECEIPT_REQUEST_KEY,
        privateText,
        JSON.stringify({ suggestions: ["예산부터 볼래요"] }),
        JSON.stringify({ provider_response_id: "resp_safe" }),
      ];

      await expect(db.query(finalizeSql(), params)).resolves.toMatchObject({
        rows: [{
          finalized: true,
          receipt_status: "settled",
          outcome: "persisted",
          message_reused: false,
        }],
      });

      const state = await db.query<{
        amora_cost_status: string;
        ai_output: string | null;
        log_metadata: Record<string, unknown>;
        claim_status: string;
        claim_message_id: string;
        content: string;
        message_metadata: Record<string, unknown>;
      }>(`
        SELECT log.amora_cost_status, log.ai_output,
          log.metadata AS log_metadata, claim.status AS claim_status,
          claim.message_id AS claim_message_id, message.content,
          message.metadata AS message_metadata
        FROM public.ai_interactions_log AS log
        JOIN public.amora_chat_request_claims AS claim
          ON claim.couple_id = log.couple_id
         AND claim.request_key = log.amora_request_key
        JOIN public.chat_messages AS message ON message.id = claim.message_id
        WHERE log.id = $1::uuid
      `, [receipt.receipt_id]);
      expect(state.rows[0]).toMatchObject({
        amora_cost_status: "settled",
        ai_output: null,
        log_metadata: { provider_response_id: "resp_safe" },
        claim_status: "completed",
        content: privateText,
        message_metadata: {
          suggestions: ["예산부터 볼래요"],
          client_request_id: RECEIPT_REQUEST_KEY,
        },
      });
      expect(JSON.stringify(state.rows[0]?.log_metadata)).not.toContain(privateText);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("returns the same committed message when the caller retries after losing the RPC response", async () => {
    const db = await createDatabase();
    try {
      const receipt = await prepareMainChat(db);
      const params = [
        receipt.receipt_id,
        receipt.claim_token,
        RECEIPT_REQUEST_KEY,
        "재시도해도 같은 답변이에요.",
        JSON.stringify({ kind: "terminal" }),
        JSON.stringify({ provider_response_id: "resp_retry" }),
      ];

      const first = await db.query<{
        message_id: string;
        message_reused: boolean;
      }>(finalizeSql(), params);
      const retry = await db.query<{
        message_id: string;
        message_reused: boolean;
      }>(finalizeSql(), params);

      expect(retry.rows[0]).toMatchObject({
        message_id: first.rows[0]?.message_id,
        message_reused: true,
      });
      const count = await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.chat_messages",
      );
      expect(count.rows[0]?.count).toBe(1);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rolls back every write when a stale chat-claim generation tries to finalize", async () => {
    const db = await createDatabase();
    try {
      const receipt = await prepareMainChat(db);
      await expect(db.query(finalizeSql({ attemptCount: 2 }), [
        receipt.receipt_id,
        receipt.claim_token,
        RECEIPT_REQUEST_KEY,
        "이 답변은 저장되면 안 돼요.",
        JSON.stringify({ kind: "terminal" }),
        JSON.stringify({ provider_response_id: "resp_stale" }),
      ])).rejects.toThrow(/CLAIM_STALE/);

      const state = await db.query<{
        amora_cost_status: string;
        claim_status: string;
        message_count: number;
      }>(`
        SELECT log.amora_cost_status, claim.status AS claim_status,
          (SELECT count(*)::integer FROM public.chat_messages) AS message_count
        FROM public.ai_interactions_log AS log
        JOIN public.amora_chat_request_claims AS claim
          ON claim.couple_id = log.couple_id
         AND claim.request_key = log.amora_request_key
        WHERE log.id = $1::uuid
      `, [receipt.receipt_id]);
      expect(state.rows[0]).toMatchObject({
        amora_cost_status: "reserved",
        claim_status: "processing",
        message_count: 0,
      });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rolls receipt settlement back when the message insert cannot commit", async () => {
    const db = await createDatabase();
    try {
      const receipt = await prepareMainChat(db);
      await db.exec("RESET ROLE");
      await db.exec(`
        ALTER TABLE public.chat_messages
          ADD CONSTRAINT reject_fixture_content
          CHECK (content <> 'reject-fixture');
      `);
      await db.exec("SET ROLE service_role");
      await db.query(
        "SELECT set_config('request.jwt.claim.role', 'service_role', false)",
      );
      await expect(db.query(finalizeSql(), [
        receipt.receipt_id,
        receipt.claim_token,
        RECEIPT_REQUEST_KEY,
        "reject-fixture",
        JSON.stringify({ kind: "terminal" }),
        JSON.stringify({ provider_response_id: "resp_insert_rejected" }),
      ])).rejects.toThrow(/reject_fixture_content/);

      const state = await db.query<{
        amora_cost_status: string;
        claim_status: string;
        message_count: number;
      }>(`
        SELECT log.amora_cost_status, claim.status AS claim_status,
          (SELECT count(*)::integer FROM public.chat_messages) AS message_count
        FROM public.ai_interactions_log AS log
        JOIN public.amora_chat_request_claims AS claim
          ON claim.couple_id = log.couple_id
         AND claim.request_key = log.amora_request_key
        WHERE log.id = $1::uuid
      `, [receipt.receipt_id]);
      expect(state.rows[0]).toMatchObject({
        amora_cost_status: "reserved",
        claim_status: "processing",
        message_count: 0,
      });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("uses the same atomic boundary for a conflict Terra mediation response", async () => {
    const db = await createDatabase();
    try {
      const receipt = await prepareConflictMediation(db);
      const result = await db.query<{
        outcome: string;
        message_id: string;
      }>(finalizeSql({
        requestKey: "$3",
        model: "gpt-5.6-terra",
      }), [
        receipt.receipt_id,
        receipt.claim_token,
        MEDIATION_REQUEST_KEY,
        "두 분 모두 잠깐 숨을 고르고 한 가지씩 말해볼까요?",
        JSON.stringify({ kind: "mediation" }),
        JSON.stringify({ provider_response_id: "resp_terra" }),
      ]);

      expect(result.rows[0]).toMatchObject({ outcome: "persisted" });
      const state = await db.query<{
        request_key: string;
        status: string;
        kind: string;
      }>(`
        SELECT claim.request_key, claim.status,
          message.metadata->>'kind' AS kind
        FROM public.amora_chat_request_claims AS claim
        JOIN public.chat_messages AS message ON message.id = claim.message_id
      `);
      expect(state.rows[0]).toEqual({
        request_key: MEDIATION_REQUEST_KEY,
        status: "completed",
        kind: "mediation",
      });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("settles a paid Terra receipt but atomically loses the cooldown race without inserting a duplicate mediation", async () => {
    const db = await createDatabase();
    try {
      const receipt = await prepareConflictMediation(db);
      await db.query(`
        INSERT INTO public.chat_messages (
          couple_id, sender_id, sender_type, role, content, metadata, visibility
        ) VALUES (
          $1::uuid, NULL, 'ai', 'assistant', '먼저 도착한 중재 답변',
          '{"kind":"mediation","client_request_id":"mediation:other"}'::jsonb,
          'shared'
        )
      `, [COUPLE_ID]);

      const params = [
        receipt.receipt_id,
        receipt.claim_token,
        MEDIATION_REQUEST_KEY,
        "늦게 도착해 중복되면 안 되는 중재 답변",
        JSON.stringify({ kind: "mediation" }),
        JSON.stringify({ provider_response_id: "resp_race_lost" }),
      ];
      const result = await db.query<{
        outcome: string;
        message_id: string | null;
      }>(finalizeSql({ model: "gpt-5.6-terra" }), params);
      expect(result.rows[0]).toMatchObject({
        outcome: "cooldown_race_lost",
        message_id: null,
      });
      await expect(db.query(
        finalizeSql({ model: "gpt-5.6-terra" }),
        params,
      )).resolves.toMatchObject({
        rows: [{ outcome: "cooldown_race_lost", message_id: null }],
      });

      const state = await db.query<{
        amora_cost_status: string;
        claim_status: string;
        failure_code: string;
        message_count: number;
      }>(`
        SELECT log.amora_cost_status, claim.status AS claim_status,
          claim.failure_code,
          (SELECT count(*)::integer FROM public.chat_messages) AS message_count
        FROM public.ai_interactions_log AS log
        CROSS JOIN public.amora_chat_request_claims AS claim
        WHERE log.id = $1::uuid
      `, [receipt.receipt_id]);
      expect(state.rows[0]).toMatchObject({
        amora_cost_status: "settled",
        claim_status: "failed",
        failure_code: "COOLDOWN_RACE_LOST",
        message_count: 1,
      });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("repairs a legacy message-first split before replaying the already committed response", async () => {
    const db = await createDatabase();
    try {
      await db.query(`
        INSERT INTO public.amora_chat_request_claims (
          couple_id, request_key, user_id, visibility, attempt_count
        ) VALUES ($1::uuid, $2, $3::uuid, 'shared', 1)
      `, [COUPLE_ID, RECEIPT_REQUEST_KEY, USER_ID]);
      const inserted = await db.query<{ id: string }>(`
        INSERT INTO public.chat_messages (
          couple_id, sender_id, sender_type, role, content, metadata, visibility
        ) VALUES (
          $1::uuid, NULL, 'ai', 'assistant', '커밋됐지만 완료 응답이 유실된 답변',
          jsonb_build_object('client_request_id', $2::text), 'shared'
        ) RETURNING id
      `, [COUPLE_ID, RECEIPT_REQUEST_KEY]);

      await expect(db.query<{ repaired: boolean }>(`
        SELECT public.reconcile_amora_chat_response(
          $1::uuid, $2, $3::uuid, 'shared', $4::uuid
        ) AS repaired
      `, [COUPLE_ID, RECEIPT_REQUEST_KEY, USER_ID, inserted.rows[0]?.id]))
        .resolves.toMatchObject({ rows: [{ repaired: true }] });

      const claim = await db.query<{ status: string; message_id: string }>(`
        SELECT status, message_id
        FROM public.amora_chat_request_claims
        WHERE couple_id = $1::uuid AND request_key = $2
      `, [COUPLE_ID, RECEIPT_REQUEST_KEY]);
      expect(claim.rows[0]).toEqual({
        status: "completed",
        message_id: inserted.rows[0]?.id,
      });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps terminal finalize and reconciliation RPCs service-role only", async () => {
    const db = await createDatabase();
    try {
      await db.exec("RESET ROLE");
      await db.exec("SET ROLE authenticated");
      await db.query(
        "SELECT set_config('request.jwt.claim.role', 'authenticated', false)",
      );
      await expect(db.query(`
        SELECT public.reconcile_amora_chat_response(
          '${COUPLE_ID}'::uuid, '${RECEIPT_REQUEST_KEY}',
          '${USER_ID}'::uuid, 'shared',
          '40000000-0000-4000-8000-000000000001'::uuid
        )
      `)).rejects.toThrow(/permission denied|SERVICE_ROLE_REQUIRED/i);
      await expect(db.query(`
        SELECT * FROM public.finalize_amora_chat_response(
          '30000000-0000-4000-8000-000000000001'::uuid,
          '40000000-0000-4000-8000-000000000001'::uuid,
          '${COUPLE_ID}'::uuid, '${USER_ID}'::uuid,
          '${RECEIPT_REQUEST_KEY}', 'shared', 1, 'content', '{}'::jsonb,
          NULL, NULL, true, 'complete', 1, true, NULL, 'model', 1, 1, 1,
          '{}'::jsonb
        )
      `)).rejects.toThrow(/permission denied|SERVICE_ROLE_REQUIRED/i);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});
