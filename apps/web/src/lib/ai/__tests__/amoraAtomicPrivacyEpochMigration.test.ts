// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
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
const privacySnapshot = migration(
  "20260731174000_amora_privacy_context_snapshot.sql",
);
const privacyEpochPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260802230000_amora_atomic_privacy_epoch.sql",
);
const privacyEpoch = existsSync(privacyEpochPath)
  ? readFileSync(privacyEpochPath, "utf8")
  : "";

const BRIDE_ID = "00000000-0000-4000-8000-000000000001";
const GROOM_ID = "00000000-0000-4000-8000-000000000002";
const OUTSIDER_ID = "00000000-0000-4000-8000-000000000003";
const NEW_MEMBER_ID = "00000000-0000-4000-8000-000000000004";
const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const NEW_COUPLE_ID = "10000000-0000-4000-8000-000000000002";
const REQUEST_KEY = `chat:${BRIDE_ID}:30000000-0000-4000-8000-000000000001`;
const CONFLICT_DIGEST = "a".repeat(64);
const CONFLICT_RECEIPT_KEY = `conflict:${CONFLICT_DIGEST}`;
const MEDIATION_REQUEST_KEY = `mediation:${CONFLICT_DIGEST}`;

type PrivacySnapshotRow = {
  snapshot: {
    version: number;
    privacyEpoch: number;
  };
};

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')::text
    $$;

    CREATE TABLE public.couples (
      id uuid PRIMARY KEY,
      bride_id uuid,
      groom_id uuid,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      couple_id uuid REFERENCES public.couples(id),
      role text,
      shared_chat_cleared_at timestamptz,
      private_chat_cleared_at timestamptz
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
    CREATE TABLE public.amora_memory_settings (
      couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
      visibility text NOT NULL,
      enabled boolean NOT NULL DEFAULT false,
      enabled_by uuid,
      enabled_at timestamptz,
      memory_reset_at timestamptz,
      legacy_purged_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (couple_id, visibility)
    );
    CREATE TABLE public.amora_memory_consents (
      couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
      visibility text NOT NULL,
      user_id uuid NOT NULL,
      consented_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (couple_id, visibility, user_id)
    );
    CREATE TABLE public.amora_personalization_preferences (
      owner_user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
      decision_start text NOT NULL DEFAULT 'ask_each_time',
      revision bigint NOT NULL DEFAULT 1
    );

    CREATE FUNCTION public.has_current_amora_memory_consent(
      p_couple_id uuid,
      p_visibility text
    )
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = ''
    AS $$
      WITH current_members AS (
        SELECT member.user_id
        FROM public.couples AS couple
        CROSS JOIN LATERAL (
          VALUES
            (couple.bride_id, 'bride_private'::text),
            (couple.groom_id, 'groom_private'::text)
        ) AS member(user_id, private_visibility)
        WHERE couple.id = p_couple_id
          AND member.user_id IS NOT NULL
          AND (
            p_visibility = 'shared'
            OR p_visibility = member.private_visibility
          )
      )
      SELECT p_visibility IN ('shared', 'bride_private', 'groom_private')
        AND EXISTS (SELECT 1 FROM current_members)
        AND (
          p_visibility <> 'shared'
          OR (SELECT count(*) FROM current_members) = 2
        )
        AND EXISTS (
          SELECT 1
          FROM public.amora_memory_settings AS setting
          WHERE setting.couple_id = p_couple_id
            AND setting.visibility = p_visibility
            AND setting.enabled = true
        )
        AND NOT EXISTS (
          SELECT 1
          FROM current_members AS member
          WHERE NOT EXISTS (
            SELECT 1
            FROM public.amora_memory_consents AS consent
            WHERE consent.couple_id = p_couple_id
              AND consent.visibility = p_visibility
              AND consent.user_id = member.user_id
          )
        )
    $$;

    INSERT INTO public.couples(id, bride_id, groom_id)
    VALUES ('${COUPLE_ID}', '${BRIDE_ID}', '${GROOM_ID}');
    INSERT INTO public.profiles(id, couple_id, role) VALUES
      ('${BRIDE_ID}', '${COUPLE_ID}', 'bride'),
      ('${GROOM_ID}', '${COUPLE_ID}', 'groom'),
      ('${OUTSIDER_ID}', '${COUPLE_ID}', 'bride');
    INSERT INTO public.amora_memory_settings(
      couple_id, visibility, enabled, memory_reset_at
    ) VALUES
      ('${COUPLE_ID}', 'shared', true, '2026-08-02T00:00:00Z'),
      ('${COUPLE_ID}', 'bride_private', true, '2026-08-02T00:00:00Z');
    INSERT INTO public.amora_memory_consents(
      couple_id, visibility, user_id
    ) VALUES
      ('${COUPLE_ID}', 'shared', '${BRIDE_ID}'),
      ('${COUPLE_ID}', 'shared', '${GROOM_ID}'),
      ('${COUPLE_ID}', 'bride_private', '${BRIDE_ID}');
    INSERT INTO public.amora_personalization_preferences(owner_user_id, revision)
    VALUES ('${BRIDE_ID}', 1);

    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO PUBLIC;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
  `);
  await db.exec(reserveBase);
  await db.exec(costBudget);
  await db.exec(atomicChatResponse);
  await db.exec(privacySnapshot);
  if (privacyEpoch) await db.exec(privacyEpoch);
  await db.exec(migration("20260905223222_amora_atomic_chat_view_reset.sql"));
  return db;
}

async function setPersona(
  db: PGlite,
  role: "anon" | "authenticated" | "service_role",
  userId?: string,
) {
  await db.exec(`SET ROLE ${role}`);
  await db.query(
    "SELECT set_config('request.jwt.claim.role', $1, false), set_config('request.jwt.claim.sub', $2, false)",
    [role, userId ?? ""],
  );
}

async function resetPersona(db: PGlite) {
  await db.exec("RESET ROLE");
  await db.query(
    "SELECT set_config('request.jwt.claim.role', '', false), set_config('request.jwt.claim.sub', '', false)",
  );
}

async function getSnapshot(db: PGlite) {
  return db.query<PrivacySnapshotRow>(
    `SELECT public.get_own_amora_privacy_context_snapshot(
       $1::uuid,
       ARRAY['shared', 'bride_private']::text[]
     ) AS snapshot`,
    [COUPLE_ID],
  );
}

async function getSnapshotEpoch(db: PGlite): Promise<number> {
  await resetPersona(db).catch(() => undefined);
  await setPersona(db, "authenticated", BRIDE_ID);
  const result = await getSnapshot(db);
  return result.rows[0]!.snapshot.privacyEpoch;
}

async function prepareMainChat(db: PGlite) {
  await db.query(`
    INSERT INTO public.amora_chat_request_claims (
      couple_id, request_key, user_id, visibility, attempt_count
    ) VALUES ($1::uuid, $2, $3::uuid, 'shared', 1)
  `, [COUPLE_ID, REQUEST_KEY, BRIDE_ID]);
  const receipt = await db.query<{ receipt_id: string; claim_token: string }>(`
    SELECT receipt_id, claim_token
    FROM public.prepare_amora_provider_call_receipt(
      '${BRIDE_ID}'::uuid, '${COUPLE_ID}'::uuid, 'session-main',
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

async function prepareConflictMediation(db: PGlite) {
  await db.query(`
    INSERT INTO public.amora_chat_request_claims (
      couple_id, request_key, user_id, visibility, attempt_count
    ) VALUES ($1::uuid, $2, $3::uuid, 'shared', 1)
  `, [COUPLE_ID, MEDIATION_REQUEST_KEY, BRIDE_ID]);
  const receipt = await db.query<{ receipt_id: string; claim_token: string }>(`
    SELECT receipt_id, claim_token
    FROM public.prepare_amora_provider_call_receipt(
      '${BRIDE_ID}'::uuid, '${COUPLE_ID}'::uuid, '${CONFLICT_DIGEST}',
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

function fencedFinalizeSql(options: {
  usageStatus?: "complete" | "unknown";
  actualCostMicrousd?: number | null;
  model?: string;
  claimAttemptCount?: number;
} = {}): string {
  const usageStatus = options.usageStatus ?? "complete";
  const actualCostMicrousd = options.actualCostMicrousd === null
    ? "NULL::bigint"
    : `${options.actualCostMicrousd ?? 1230}::bigint`;
  const model = options.model ?? "gpt-5.6-luna";
  const claimAttemptCount = options.claimAttemptCount ?? 1;
  return `
    SELECT *
    FROM public.finalize_amora_chat_response_with_privacy_fence(
      $1::uuid, $2::uuid,
      '${COUPLE_ID}'::uuid, '${BRIDE_ID}'::uuid, $3, 'shared', ${claimAttemptCount},
      $4::bigint,
      $5, $6::jsonb, 'exploring', 'general',
      true, '${usageStatus}', ${actualCostMicrousd}, true, NULL,
      '${model}', 1200, 240, 25, $7::jsonb
    )
  `;
}

describe("atomic Amora privacy epoch migration", () => {
  it("rolls the cursor back if schema drift prevents advancing the epoch", async () => {
    const db = await createDatabase();
    try {
      await db.exec("ALTER TABLE public.profiles DISABLE TRIGGER trg_amora_privacy_epoch_profiles");
      await setPersona(db, "authenticated", BRIDE_ID);
      await expect(db.query("SELECT public.reset_own_amora_chat_view($1::uuid, 'shared')", [COUPLE_ID]))
        .rejects.toThrow("AMORA_CHAT_VIEW_RESET_EPOCH_NOT_ADVANCED");
      const view = await db.query<{ result: Record<string, unknown> }>(`
        SELECT public.get_own_amora_chat_view_snapshot($1::uuid, 'shared') AS result
      `, [COUPLE_ID]);
      expect(view.rows[0]!.result).toEqual({ version: 1, privacyEpoch: 1, shared: null, private: null });
    } finally { await resetPersona(db); await db.close(); }
  }, 30_000);

  it.each(["shared", "private"])("discards and settles a paid response when %s view reset wins the epoch lock", async (scope) => {
    const db = await createDatabase();
    try {
      const expectedEpoch = await getSnapshotEpoch(db);
      await resetPersona(db);
      await setPersona(db, "service_role", BRIDE_ID);
      const receipt = await prepareMainChat(db);
      await resetPersona(db);
      await setPersona(db, "authenticated", BRIDE_ID);
      const reset = await db.query<{ result: { privacyEpoch: number; clearedAt: string } }>(`
        SELECT public.reset_own_amora_chat_view($1::uuid, $2) AS result
      `, [COUPLE_ID, scope]);
      expect(reset.rows[0]!.result.privacyEpoch).toBe(expectedEpoch + 1);
      const view = await db.query<{ result: Record<string, unknown> }>(`
        SELECT public.get_own_amora_chat_view_snapshot($1::uuid, 'shared') AS result
      `, [COUPLE_ID]);
      expect(view.rows[0]!.result).toEqual({
        version: 1, privacyEpoch: expectedEpoch + 1,
        shared: scope === "shared" ? reset.rows[0]!.result.clearedAt : null,
        private: scope === "private" ? reset.rows[0]!.result.clearedAt : null,
      });
      await resetPersona(db);
      await setPersona(db, "service_role", BRIDE_ID);
      const finalized = await db.query<{ outcome: string; message_id: string | null }>(fencedFinalizeSql(), [
        receipt.receipt_id, receipt.claim_token, REQUEST_KEY, expectedEpoch,
        "SYNTHETIC_PRE_RESET_RESPONSE", JSON.stringify({ kind: "terminal" }), "{}",
      ]);
      expect(finalized.rows[0]).toMatchObject({ outcome: "privacy_context_changed", message_id: null });
      const state = await db.query(`
        SELECT receipt.amora_cost_status, receipt.amora_actual_cost_microusd,
          receipt.ai_output, claim.status, claim.failure_code,
          (SELECT count(*)::int FROM public.chat_messages) AS message_count
        FROM public.ai_interactions_log receipt
        JOIN public.amora_chat_request_claims claim ON claim.request_key = receipt.amora_request_key
        WHERE receipt.id = $1::uuid
      `, [receipt.receipt_id]);
      expect(state.rows[0]).toMatchObject({
        amora_cost_status: "settled", amora_actual_cost_microusd: 1230,
        ai_output: null, status: "failed", failure_code: "PRIVACY_CONTEXT_CHANGED", message_count: 0,
      });
    } finally { await resetPersona(db); await db.close(); }
  }, 30_000);

  it("hides a response committed before reset while preserving the immutable cost receipt replay", async () => {
    const db = await createDatabase();
    try {
      const epoch = await getSnapshotEpoch(db);
      await resetPersona(db);
      await setPersona(db, "service_role", BRIDE_ID);
      const receipt = await prepareMainChat(db);
      const params = [receipt.receipt_id, receipt.claim_token, REQUEST_KEY, epoch,
        "SYNTHETIC_COMMITTED_BEFORE_RESET", "{}", "{}"];
      const first = await db.query<{ message_id: string }>(fencedFinalizeSql(), params);
      await resetPersona(db);
      await setPersona(db, "authenticated", BRIDE_ID);
      await db.query("SELECT public.reset_own_amora_chat_view($1::uuid, 'shared')", [COUPLE_ID]);
      await resetPersona(db);
      const visible = await db.query<{ visible: boolean; partner_unchanged: boolean }>(`
        SELECT message.created_at > profile.shared_chat_cleared_at AS visible,
          (SELECT shared_chat_cleared_at IS NULL FROM public.profiles WHERE id = $3::uuid) AS partner_unchanged
        FROM public.chat_messages message, public.profiles profile
        WHERE message.id = $1::uuid AND profile.id = $2::uuid
      `, [first.rows[0]!.message_id, BRIDE_ID, GROOM_ID]);
      expect(visible.rows[0]).toEqual({ visible: false, partner_unchanged: true });
      await setPersona(db, "service_role", BRIDE_ID);
      const retry = await db.query(fencedFinalizeSql(), params);
      expect(retry.rows[0]).toMatchObject({ outcome: "persisted", message_id: first.rows[0]!.message_id, message_reused: true });
    } finally { await resetPersona(db); await db.close(); }
  }, 30_000);

  it("keeps the shared-clear request message timestamp and later messages intact", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration("20260714163000_atomic_chat_clear_request.sql"));
      const inserted = await db.query<{ id: string }>(`
        INSERT INTO public.chat_messages(couple_id,sender_id,sender_type,role,content,visibility,created_at,metadata)
        VALUES ($1::uuid,$2::uuid,'bride','user','SYNTHETIC_CLEAR_REQUEST','shared','2026-08-01T00:00:00Z',
          jsonb_build_object('clearRequest',jsonb_build_object('type','shared','requestedBy',$2::text,'requestedByRole','bride','status','pending')))
        RETURNING id
      `, [COUPLE_ID, BRIDE_ID]);
      await setPersona(db, "authenticated", GROOM_ID);
      const result = await db.query<{ resolution_status: string; cleared_at: Date }>(`
        SELECT * FROM public.resolve_shared_chat_clear_request($1::uuid,'accept')
      `, [inserted.rows[0]!.id]);
      expect(result.rows[0]!.resolution_status).toBe("accepted");
      expect(new Date(result.rows[0]!.cleared_at).toISOString()).toBe("2026-08-01T00:00:00.000Z");
      await resetPersona(db);
      const cursors = await db.query<{ preserved: boolean }>(`
        SELECT bool_and(shared_chat_cleared_at = '2026-08-01T00:00:00Z'::timestamptz) AS preserved
        FROM public.profiles WHERE id IN ($1::uuid,$2::uuid)
      `, [BRIDE_ID, GROOM_ID]);
      expect(cursors.rows[0]!.preserved).toBe(true);
      expect(await getSnapshotEpoch(db)).toBe(3);
    } finally { await resetPersona(db); await db.close(); }
  }, 30_000);

  it("restricts reset/snapshot RPCs to current members and exact private scope without changing memory consent", async () => {
    const db = await createDatabase();
    try {
      for (const rpc of ["get_own_amora_chat_view_snapshot", "reset_own_amora_chat_view"]) {
        for (const role of ["anon", "service_role"] as const) {
          await setPersona(db, role, BRIDE_ID);
          await expect(db.query(`SELECT public.${rpc}($1::uuid,'shared')`, [COUPLE_ID])).rejects.toThrow();
          await resetPersona(db);
        }
        await setPersona(db, "authenticated", OUTSIDER_ID);
        await expect(db.query(`SELECT public.${rpc}($1::uuid,'shared')`, [COUPLE_ID])).rejects.toThrow();
        await resetPersona(db);
      }
      await setPersona(db, "authenticated", BRIDE_ID);
      await expect(db.query("SELECT public.get_own_amora_chat_view_snapshot($1::uuid,'groom_private')", [COUPLE_ID])).rejects.toThrow();
      await expect(db.query("SELECT public.reset_own_amora_chat_view($1::uuid,'shared')", [NEW_COUPLE_ID])).rejects.toThrow();
      const before = (await getSnapshot(db)).rows[0]!.snapshot;
      await db.query("SELECT public.reset_own_amora_chat_view($1::uuid,'private')", [COUPLE_ID]);
      const after = (await getSnapshot(db)).rows[0]!.snapshot;
      expect(after).toEqual({ ...before, privacyEpoch: before.privacyEpoch + 1 });
      await resetPersona(db);
      await db.query("UPDATE public.profiles SET private_chat_cleared_at = private_chat_cleared_at WHERE id = $1::uuid", [BRIDE_ID]);
      expect(await getSnapshotEpoch(db)).toBe(after.privacyEpoch);
    } finally { await resetPersona(db); await db.close(); }
  }, 30_000);

  it("commits through the existing atomic finalizer when the authenticated snapshot epoch is unchanged", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "authenticated", BRIDE_ID);
      const snapshot = await getSnapshot(db);
      expect(snapshot.rows[0]?.snapshot).toMatchObject({
        version: 2,
        privacyEpoch: 1,
      });

      await resetPersona(db);
      await setPersona(db, "service_role", BRIDE_ID);
      const receipt = await prepareMainChat(db);
      const finalized = await db.query<{
        outcome: string;
        message_id: string | null;
        message_reused: boolean;
      }>(fencedFinalizeSql(), [
        receipt.receipt_id,
        receipt.claim_token,
        REQUEST_KEY,
        snapshot.rows[0]!.snapshot.privacyEpoch,
        "변경되지 않은 privacy context의 안전한 답변",
        JSON.stringify({ kind: "terminal" }),
        JSON.stringify({ provider_response_id: "resp_epoch_match" }),
      ]);

      expect(finalized.rows[0]).toMatchObject({
        outcome: "persisted",
        message_id: expect.any(String),
        message_reused: false,
      });
      const durable = await db.query<{
        claim_status: string;
        message_count: number;
        receipt_status: string;
      }>(`
        SELECT claim.status AS claim_status,
          (SELECT count(*)::integer FROM public.chat_messages) AS message_count,
          receipt.amora_cost_status AS receipt_status
        FROM public.amora_chat_request_claims AS claim
        JOIN public.ai_interactions_log AS receipt
          ON receipt.couple_id = claim.couple_id
         AND receipt.amora_request_key = claim.request_key
        WHERE claim.couple_id = $1::uuid
          AND claim.request_key = $2
      `, [COUPLE_ID, REQUEST_KEY]);
      expect(durable.rows[0]).toEqual({
        claim_status: "completed",
        message_count: 1,
        receipt_status: "settled",
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("monotonically advances the public snapshot after roster, role, memory, consent, or personalization changes", async () => {
    const db = await createDatabase();
    try {
      expect(await getSnapshotEpoch(db)).toBe(1);

      await resetPersona(db);
      await db.query(`
        UPDATE public.amora_memory_settings
        SET enabled = false
        WHERE couple_id = $1::uuid AND visibility = 'shared'
      `, [COUPLE_ID]);
      expect(await getSnapshotEpoch(db)).toBe(2);

      await resetPersona(db);
      await db.query(`
        DELETE FROM public.amora_memory_consents
        WHERE couple_id = $1::uuid
          AND visibility = 'shared'
          AND user_id = $2::uuid
      `, [COUPLE_ID, GROOM_ID]);
      expect(await getSnapshotEpoch(db)).toBe(3);

      await resetPersona(db);
      await db.query(`
        UPDATE public.amora_personalization_preferences
        SET revision = revision + 1
        WHERE owner_user_id = $1::uuid
      `, [BRIDE_ID]);
      expect(await getSnapshotEpoch(db)).toBe(4);

      await resetPersona(db);
      await db.query(
        "UPDATE public.couples SET groom_id = NULL WHERE id = $1::uuid",
        [COUPLE_ID],
      );
      expect(await getSnapshotEpoch(db)).toBe(5);

      await resetPersona(db);
      await db.query(
        "UPDATE public.profiles SET role = 'groom' WHERE id = $1::uuid",
        [BRIDE_ID],
      );
      await db.query(
        "UPDATE public.profiles SET role = 'bride' WHERE id = $1::uuid",
        [BRIDE_ID],
      );
      expect(await getSnapshotEpoch(db)).toBe(7);

      await resetPersona(db);
      await db.query(
        "UPDATE public.profiles SET couple_id = NULL WHERE id = $1::uuid",
        [BRIDE_ID],
      );
      await db.query(
        "UPDATE public.profiles SET couple_id = $2::uuid WHERE id = $1::uuid",
        [BRIDE_ID, COUPLE_ID],
      );
      expect(await getSnapshotEpoch(db)).toBe(9);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("atomically settles paid usage and fails the claim without persisting response text when the epoch changed", async () => {
    const db = await createDatabase();
    const rawResponse = "이 문장은 privacy mismatch 뒤 어디에도 저장되면 안 됩니다";
    const rawMetadata = "원문 개인정보가 든 테스트 메타데이터";
    try {
      const expectedEpoch = await getSnapshotEpoch(db);

      await resetPersona(db);
      await db.query(`
        UPDATE public.amora_personalization_preferences
        SET revision = revision + 1
        WHERE owner_user_id = $1::uuid
      `, [BRIDE_ID]);

      await setPersona(db, "service_role", BRIDE_ID);
      const receipt = await prepareMainChat(db);
      const finalized = await db.query<{
        finalized: boolean;
        receipt_status: string;
        outcome: string;
        message_id: string | null;
        message_content: string | null;
      }>(fencedFinalizeSql(), [
        receipt.receipt_id,
        receipt.claim_token,
        REQUEST_KEY,
        expectedEpoch,
        rawResponse,
        JSON.stringify({ raw_response: rawResponse }),
        JSON.stringify({
          provider_response_id: "resp_privacy_discarded",
          raw_prompt: rawMetadata,
        }),
      ]);

      expect(finalized.rows[0]).toEqual(expect.objectContaining({
        finalized: true,
        receipt_status: "settled",
        outcome: "privacy_context_changed",
        message_id: null,
        message_content: null,
      }));

      const state = await db.query<{
        receipt_status: string;
        actual_cost: number;
        success: boolean;
        error_message: string;
        receipt_metadata: Record<string, unknown>;
        user_input: string | null;
        ai_output: string | null;
        claim_status: string;
        failure_code: string;
        claim_message_id: string | null;
        message_count: number;
      }>(`
        SELECT receipt.amora_cost_status AS receipt_status,
          receipt.amora_actual_cost_microusd::integer AS actual_cost,
          receipt.success,
          receipt.error_message,
          receipt.metadata AS receipt_metadata,
          receipt.user_input,
          receipt.ai_output,
          claim.status AS claim_status,
          claim.failure_code,
          claim.message_id AS claim_message_id,
          (SELECT count(*)::integer FROM public.chat_messages) AS message_count
        FROM public.ai_interactions_log AS receipt
        JOIN public.amora_chat_request_claims AS claim
          ON claim.couple_id = receipt.couple_id
         AND claim.request_key = receipt.amora_request_key
        WHERE receipt.id = $1::uuid
      `, [receipt.receipt_id]);
      expect(state.rows[0]).toMatchObject({
        receipt_status: "settled",
        actual_cost: 1230,
        success: false,
        error_message: "privacy_context_changed",
        receipt_metadata: {
          content_logging: "disabled",
          ledger_status: "finalized",
          privacy_fence_status: "discarded_privacy_revision",
        },
        user_input: null,
        ai_output: null,
        claim_status: "failed",
        failure_code: "PRIVACY_CONTEXT_CHANGED",
        claim_message_id: null,
        message_count: 0,
      });
      const durableJson = JSON.stringify(state.rows[0]);
      expect(durableJson).not.toContain(rawResponse);
      expect(durableJson).not.toContain(rawMetadata);
      expect(durableJson).not.toContain("resp_privacy_discarded");
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("replays an already completed response even when the privacy epoch advanced afterward", async () => {
    const db = await createDatabase();
    try {
      const expectedEpoch = await getSnapshotEpoch(db);
      await resetPersona(db);
      await setPersona(db, "service_role", BRIDE_ID);
      const receipt = await prepareMainChat(db);
      const params = [
        receipt.receipt_id,
        receipt.claim_token,
        REQUEST_KEY,
        expectedEpoch,
        "이미 원자적으로 저장된 답변",
        JSON.stringify({ kind: "terminal" }),
        JSON.stringify({ provider_response_id: "resp_completed_replay" }),
      ];
      const first = await db.query<{
        outcome: string;
        message_id: string;
        message_reused: boolean;
      }>(fencedFinalizeSql(), params);

      await resetPersona(db);
      await db.query(`
        UPDATE public.amora_personalization_preferences
        SET revision = revision + 1
        WHERE owner_user_id = $1::uuid
      `, [BRIDE_ID]);
      await setPersona(db, "service_role", BRIDE_ID);
      const retry = await db.query<{
        outcome: string;
        message_id: string;
        message_reused: boolean;
      }>(fencedFinalizeSql(), params);

      expect(retry.rows[0]).toEqual(expect.objectContaining({
        outcome: "persisted",
        message_id: first.rows[0]?.message_id,
        message_reused: true,
      }));
      const durable = await db.query<{
        message_count: number;
        claim_status: string;
        receipt_success: boolean;
        receipt_error: string | null;
      }>(`
        SELECT
          (SELECT count(*)::integer FROM public.chat_messages) AS message_count,
          claim.status AS claim_status,
          receipt.success AS receipt_success,
          receipt.error_message AS receipt_error
        FROM public.amora_chat_request_claims AS claim
        JOIN public.ai_interactions_log AS receipt
          ON receipt.couple_id = claim.couple_id
         AND receipt.amora_request_key = claim.request_key
        WHERE receipt.id = $1::uuid
      `, [receipt.receipt_id]);
      expect(durable.rows[0]).toEqual({
        message_count: 1,
        claim_status: "completed",
        receipt_success: true,
        receipt_error: null,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("idempotently replays a committed privacy discard without rewriting its receipt or claim", async () => {
    const db = await createDatabase();
    try {
      const expectedEpoch = await getSnapshotEpoch(db);
      await resetPersona(db);
      await db.query(`
        UPDATE public.amora_personalization_preferences
        SET revision = revision + 1
        WHERE owner_user_id = $1::uuid
      `, [BRIDE_ID]);
      await setPersona(db, "service_role", BRIDE_ID);
      const receipt = await prepareMainChat(db);
      const params = [
        receipt.receipt_id,
        receipt.claim_token,
        REQUEST_KEY,
        expectedEpoch,
        "버려질 첫 응답",
        JSON.stringify({ raw_response: "버려질 첫 응답" }),
        JSON.stringify({ raw_prompt: "첫 민감 메타데이터" }),
      ];
      const first = await db.query<{ outcome: string }>(
        fencedFinalizeSql(),
        params,
      );
      expect(first.rows[0]?.outcome).toBe("privacy_context_changed");
      const before = await db.query<{
        receipt_updated_at: string;
        metadata: Record<string, unknown>;
        failed_at: string;
      }>(`
        SELECT receipt.amora_receipt_updated_at AS receipt_updated_at,
          receipt.metadata,
          claim.failed_at
        FROM public.ai_interactions_log AS receipt
        JOIN public.amora_chat_request_claims AS claim
          ON claim.couple_id = receipt.couple_id
         AND claim.request_key = receipt.amora_request_key
        WHERE receipt.id = $1::uuid
      `, [receipt.receipt_id]);

      const retry = await db.query<{ outcome: string; message_id: string | null }>(
        fencedFinalizeSql(),
        [
          ...params.slice(0, 6),
          JSON.stringify({ raw_prompt: "재시도에서 추가한 민감 메타데이터" }),
        ],
      );
      expect(retry.rows[0]).toMatchObject({
        outcome: "privacy_context_changed",
        message_id: null,
      });
      const after = await db.query<{
        receipt_updated_at: string;
        metadata: Record<string, unknown>;
        failed_at: string;
        message_count: number;
      }>(`
        SELECT receipt.amora_receipt_updated_at AS receipt_updated_at,
          receipt.metadata,
          claim.failed_at,
          (SELECT count(*)::integer FROM public.chat_messages) AS message_count
        FROM public.ai_interactions_log AS receipt
        JOIN public.amora_chat_request_claims AS claim
          ON claim.couple_id = receipt.couple_id
         AND claim.request_key = receipt.amora_request_key
        WHERE receipt.id = $1::uuid
      `, [receipt.receipt_id]);
      expect(after.rows[0]).toEqual({
        ...before.rows[0],
        message_count: 0,
      });
      expect(JSON.stringify(after.rows[0]?.metadata)).not.toContain(
        "재시도에서 추가한 민감 메타데이터",
      );
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rolls receipt settlement back when the privacy-failure claim update cannot commit", async () => {
    const db = await createDatabase();
    try {
      const expectedEpoch = await getSnapshotEpoch(db);
      await resetPersona(db);
      await db.query(`
        UPDATE public.amora_personalization_preferences
        SET revision = revision + 1
        WHERE owner_user_id = $1::uuid
      `, [BRIDE_ID]);
      await setPersona(db, "service_role", BRIDE_ID);
      const receipt = await prepareMainChat(db);

      await resetPersona(db);
      await db.exec(`
        CREATE FUNCTION public.reject_test_privacy_claim_update()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.failure_code = 'PRIVACY_CONTEXT_CHANGED' THEN
            RAISE EXCEPTION 'TEST_PRIVACY_CLAIM_WRITE_FAILED';
          END IF;
          RETURN NEW;
        END
        $$;
        CREATE TRIGGER trg_reject_test_privacy_claim_update
          BEFORE UPDATE ON public.amora_chat_request_claims
          FOR EACH ROW
          EXECUTE FUNCTION public.reject_test_privacy_claim_update();
      `);
      await setPersona(db, "service_role", BRIDE_ID);

      await expect(db.query(fencedFinalizeSql(), [
        receipt.receipt_id,
        receipt.claim_token,
        REQUEST_KEY,
        expectedEpoch,
        "반쪽 저장이 금지된 응답",
        JSON.stringify({ kind: "terminal" }),
        JSON.stringify({ provider_response_id: "resp_atomic_rollback" }),
      ])).rejects.toThrow(/TEST_PRIVACY_CLAIM_WRITE_FAILED/);

      const state = await db.query<{
        receipt_status: string;
        actual_cost: number | null;
        claim_status: string;
        failure_code: string | null;
        message_count: number;
      }>(`
        SELECT receipt.amora_cost_status AS receipt_status,
          receipt.amora_actual_cost_microusd::integer AS actual_cost,
          claim.status AS claim_status,
          claim.failure_code,
          (SELECT count(*)::integer FROM public.chat_messages) AS message_count
        FROM public.ai_interactions_log AS receipt
        JOIN public.amora_chat_request_claims AS claim
          ON claim.couple_id = receipt.couple_id
         AND claim.request_key = receipt.amora_request_key
        WHERE receipt.id = $1::uuid
      `, [receipt.receipt_id]);
      expect(state.rows[0]).toEqual({
        receipt_status: "reserved",
        actual_cost: null,
        claim_status: "processing",
        failure_code: null,
        message_count: 0,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("returns only the current member's scalar epoch for a lightweight shared or owned-private check", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "authenticated", BRIDE_ID);
      const shared = await db.query<{ epoch: number }>(`
        SELECT public.get_own_amora_privacy_epoch(
          $1::uuid,
          'shared'
        ) AS epoch
      `, [COUPLE_ID]);
      const privateResult = await db.query<{ epoch: number }>(`
        SELECT public.get_own_amora_privacy_epoch(
          $1::uuid,
          'bride_private'
        ) AS epoch
      `, [COUPLE_ID]);
      expect(shared.rows).toEqual([{ epoch: 1 }]);
      expect(privateResult.rows).toEqual([{ epoch: 1 }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rejects another member's private visibility and a stale profile backlink", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "authenticated", BRIDE_ID);
      await expect(db.query(`
        SELECT public.get_own_amora_privacy_epoch(
          $1::uuid,
          'groom_private'
        )
      `, [COUPLE_ID])).rejects.toThrow(
        /AMORA_PRIVACY_CONTEXT_SCOPE_INVALID/,
      );

      await resetPersona(db);
      await setPersona(db, "authenticated", OUTSIDER_ID);
      await expect(db.query(`
        SELECT public.get_own_amora_privacy_epoch(
          $1::uuid,
          'shared'
        )
      `, [COUPLE_ID])).rejects.toThrow(
        /AMORA_PRIVACY_CONTEXT_SCOPE_INVALID/,
      );
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rejects a null visibility instead of treating it as an unrestricted scalar epoch read", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "authenticated", BRIDE_ID);
      await expect(db.query(`
        SELECT public.get_own_amora_privacy_epoch(
          $1::uuid,
          NULL::text
        )
      `, [COUPLE_ID])).rejects.toThrow(
        /AMORA_PRIVACY_CONTEXT_VISIBILITY_INVALID/,
      );
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("fails closed when a current couple's scalar epoch row is missing", async () => {
    const db = await createDatabase();
    try {
      await db.query(
        "DELETE FROM public.amora_privacy_context_epochs WHERE couple_id = $1::uuid",
        [COUPLE_ID],
      );
      await setPersona(db, "authenticated", BRIDE_ID);
      await expect(db.query(`
        SELECT public.get_own_amora_privacy_epoch(
          $1::uuid,
          'shared'
        )
      `, [COUPLE_ID])).rejects.toThrow(
        /AMORA_PRIVACY_CONTEXT_EPOCH_MISSING/,
      );
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("exposes only the two authenticated reads and the service-only fenced finalizer without PII-bearing epoch storage", async () => {
    const db = await createDatabase();
    try {
      const contract = await db.query<{
        columns: string[];
        anon_table: boolean;
        authenticated_table: boolean;
        service_table: boolean;
        direct_grant_count: number;
        authenticated_snapshot: boolean;
        anon_snapshot: boolean;
        service_snapshot: boolean;
        authenticated_epoch: boolean;
        anon_epoch: boolean;
        service_epoch: boolean;
        service_finalize: boolean;
        authenticated_finalize: boolean;
        anon_finalize: boolean;
        helper_execute_grant_count: number;
        scalar_definition: string;
      }>(`
        SELECT
          (
            SELECT array_agg(column_name ORDER BY ordinal_position)
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'amora_privacy_context_epochs'
          ) AS columns,
          has_table_privilege(
            'anon', 'public.amora_privacy_context_epochs', 'SELECT'
          ) AS anon_table,
          has_table_privilege(
            'authenticated', 'public.amora_privacy_context_epochs', 'SELECT'
          ) AS authenticated_table,
          has_table_privilege(
            'service_role', 'public.amora_privacy_context_epochs', 'SELECT'
          ) AS service_table,
          (
            SELECT count(*)::integer
            FROM information_schema.role_table_grants
            WHERE table_schema = 'public'
              AND table_name = 'amora_privacy_context_epochs'
              AND grantee IN ('anon', 'authenticated', 'service_role')
          ) AS direct_grant_count,
          has_function_privilege(
            'authenticated',
            'public.get_own_amora_privacy_context_snapshot(uuid,text[])',
            'EXECUTE'
          ) AS authenticated_snapshot,
          has_function_privilege(
            'anon',
            'public.get_own_amora_privacy_context_snapshot(uuid,text[])',
            'EXECUTE'
          ) AS anon_snapshot,
          has_function_privilege(
            'service_role',
            'public.get_own_amora_privacy_context_snapshot(uuid,text[])',
            'EXECUTE'
          ) AS service_snapshot,
          has_function_privilege(
            'authenticated',
            'public.get_own_amora_privacy_epoch(uuid,text)',
            'EXECUTE'
          ) AS authenticated_epoch,
          has_function_privilege(
            'anon',
            'public.get_own_amora_privacy_epoch(uuid,text)',
            'EXECUTE'
          ) AS anon_epoch,
          has_function_privilege(
            'service_role',
            'public.get_own_amora_privacy_epoch(uuid,text)',
            'EXECUTE'
          ) AS service_epoch,
          has_function_privilege(
            'service_role',
            'public.finalize_amora_chat_response_with_privacy_fence(uuid,uuid,uuid,uuid,text,text,integer,bigint,text,jsonb,text,text,boolean,text,bigint,boolean,text,text,integer,integer,integer,jsonb)',
            'EXECUTE'
          ) AS service_finalize,
          has_function_privilege(
            'authenticated',
            'public.finalize_amora_chat_response_with_privacy_fence(uuid,uuid,uuid,uuid,text,text,integer,bigint,text,jsonb,text,text,boolean,text,bigint,boolean,text,text,integer,integer,integer,jsonb)',
            'EXECUTE'
          ) AS authenticated_finalize,
          has_function_privilege(
            'anon',
            'public.finalize_amora_chat_response_with_privacy_fence(uuid,uuid,uuid,uuid,text,text,integer,bigint,text,jsonb,text,text,boolean,text,bigint,boolean,text,text,integer,integer,integer,jsonb)',
            'EXECUTE'
          ) AS anon_finalize,
          (
            SELECT count(*)::integer
            FROM (VALUES
              ('anon'),
              ('authenticated'),
              ('service_role')
            ) AS app_role(role_name)
            CROSS JOIN (VALUES
              ('public.advance_amora_privacy_context_epoch(uuid)'::regprocedure),
              ('public.is_amora_profile_roster_binding(uuid,uuid,text)'::regprocedure),
              ('public.capture_amora_couple_privacy_epoch()'::regprocedure),
              ('public.capture_amora_profile_privacy_epoch()'::regprocedure),
              ('public.capture_amora_couple_scoped_privacy_epoch()'::regprocedure),
              ('public.current_amora_personalization_couple_id(uuid)'::regprocedure),
              ('public.capture_amora_personalization_privacy_epoch()'::regprocedure)
            ) AS helper(function_oid)
            WHERE has_function_privilege(
              app_role.role_name,
              helper.function_oid,
              'EXECUTE'
            )
          ) AS helper_execute_grant_count,
          pg_get_functiondef(
            to_regprocedure(
              'public.get_own_amora_privacy_epoch(uuid,text)'
            )
          ) AS scalar_definition
      `);
      expect(contract.rows[0]).toMatchObject({
        columns: ["couple_id", "epoch", "updated_at"],
        anon_table: false,
        authenticated_table: false,
        service_table: false,
        direct_grant_count: 0,
        authenticated_snapshot: true,
        anon_snapshot: false,
        service_snapshot: false,
        authenticated_epoch: true,
        anon_epoch: false,
        service_epoch: false,
        service_finalize: true,
        authenticated_finalize: false,
        anon_finalize: false,
        helper_execute_grant_count: 0,
      });
      const scalarDefinition = contract.rows[0]!.scalar_definition;
      expect(scalarDefinition).not.toMatch(
        /amora_memory|personalization|rosterFingerprint|md5|jsonb/i,
      );

      await setPersona(db, "anon");
      await expect(db.query(`
        SELECT public.get_own_amora_privacy_epoch(
          $1::uuid,
          'shared'
        )
      `, [COUPLE_ID])).rejects.toThrow(/permission denied/i);
      await resetPersona(db);
      await setPersona(db, "service_role", BRIDE_ID);
      await expect(db.query(`
        SELECT public.get_own_amora_privacy_epoch(
          $1::uuid,
          'shared'
        )
      `, [COUPLE_ID])).rejects.toThrow(/permission denied/i);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("retains an unknown paid reservation while terminally failing the stale-privacy claim", async () => {
    const db = await createDatabase();
    try {
      const expectedEpoch = await getSnapshotEpoch(db);
      await resetPersona(db);
      await db.query(`
        UPDATE public.amora_memory_settings
        SET enabled = false
        WHERE couple_id = $1::uuid AND visibility = 'shared'
      `, [COUPLE_ID]);
      await setPersona(db, "service_role", BRIDE_ID);
      const receipt = await prepareMainChat(db);
      const finalized = await db.query<{
        receipt_status: string;
        outcome: string;
      }>(fencedFinalizeSql({
        usageStatus: "unknown",
        actualCostMicrousd: null,
      }), [
        receipt.receipt_id,
        receipt.claim_token,
        REQUEST_KEY,
        expectedEpoch,
        "비용 미확정 상태에서 버려질 응답",
        JSON.stringify({ kind: "terminal" }),
        JSON.stringify({ raw_prompt: "저장 금지" }),
      ]);
      expect(finalized.rows[0]).toEqual(expect.objectContaining({
        receipt_status: "unknown",
        outcome: "privacy_context_changed",
      }));

      const state = await db.query<{
        receipt_status: string;
        actual_cost: number | null;
        cost_usd: string | null;
        global_reserved_cost: number;
        claim_status: string;
        failure_code: string;
        message_count: number;
      }>(`
        SELECT receipt.amora_cost_status AS receipt_status,
          receipt.amora_actual_cost_microusd::integer AS actual_cost,
          receipt.cost_usd::text AS cost_usd,
          counter.reserved_cost_microusd::integer AS global_reserved_cost,
          claim.status AS claim_status,
          claim.failure_code,
          (SELECT count(*)::integer FROM public.chat_messages) AS message_count
        FROM public.ai_interactions_log AS receipt
        JOIN public.amora_chat_request_claims AS claim
          ON claim.couple_id = receipt.couple_id
         AND claim.request_key = receipt.amora_request_key
        JOIN public.amora_turn_counters AS counter
          ON counter.key = receipt.amora_global_counter_key
        WHERE receipt.id = $1::uuid
      `, [receipt.receipt_id]);
      expect(state.rows[0]).toEqual({
        receipt_status: "unknown",
        actual_cost: null,
        cost_usd: null,
        global_reserved_cost: 84800,
        claim_status: "failed",
        failure_code: "PRIVACY_CONTEXT_CHANGED",
        message_count: 0,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("preserves receipt-to-claim-to-couple-to-epoch lock order for conflict mediation", async () => {
    const db = await createDatabase();
    try {
      const expectedEpoch = await getSnapshotEpoch(db);
      await resetPersona(db);
      await setPersona(db, "service_role", BRIDE_ID);
      const receipt = await prepareConflictMediation(db);
      const finalized = await db.query<{
        outcome: string;
        message_id: string | null;
      }>(fencedFinalizeSql({ model: "gpt-5.6-terra" }), [
        receipt.receipt_id,
        receipt.claim_token,
        MEDIATION_REQUEST_KEY,
        expectedEpoch,
        "중재 락 순서를 보존한 답변",
        JSON.stringify({ kind: "mediation" }),
        JSON.stringify({ provider_response_id: "resp_mediation_epoch" }),
      ]);
      expect(finalized.rows[0]).toMatchObject({
        outcome: "persisted",
        message_id: expect.any(String),
      });

      await resetPersona(db);
      const definition = await db.query<{ definition: string }>(`
        SELECT pg_get_functiondef(
          'public.finalize_amora_chat_response_with_privacy_fence(uuid,uuid,uuid,uuid,text,text,integer,bigint,text,jsonb,text,text,boolean,text,bigint,boolean,text,text,integer,integer,integer,jsonb)'::regprocedure
        ) AS definition
      `);
      const normalized = definition.rows[0]!.definition.replace(/\s+/g, " ");
      const receiptLock = normalized.indexOf(
        "FROM public.ai_interactions_log WHERE id = p_receipt_id FOR UPDATE",
      );
      const claimLock = normalized.indexOf(
        "FROM public.amora_chat_request_claims WHERE couple_id = p_chat_couple_id AND request_key = p_chat_request_key FOR UPDATE",
      );
      const coupleLock = normalized.indexOf(
        "FROM public.couples WHERE id = p_chat_couple_id FOR UPDATE",
      );
      const epochLock = normalized.indexOf(
        "FROM public.amora_privacy_context_epochs AS privacy WHERE privacy.couple_id = p_chat_couple_id FOR UPDATE",
      );
      expect([receiptLock, claimLock, coupleLock, epochLock]).toEqual([
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
      ]);
      expect(receiptLock).toBeGreaterThanOrEqual(0);
      expect(receiptLock).toBeLessThan(claimLock);
      expect(claimLock).toBeLessThan(coupleLock);
      expect(coupleLock).toBeLessThan(epochLock);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("initializes future couples while ignoring profile changes that are not current roster bindings", async () => {
    const db = await createDatabase();
    try {
      expect(await getSnapshotEpoch(db)).toBe(1);
      await resetPersona(db);
      await db.query(
        "UPDATE public.profiles SET role = 'groom' WHERE id = $1::uuid",
        [OUTSIDER_ID],
      );
      expect(await getSnapshotEpoch(db)).toBe(1);

      await resetPersona(db);
      await db.query(`
        INSERT INTO public.couples(id, bride_id, groom_id)
        VALUES ($1::uuid, $2::uuid, NULL)
      `, [NEW_COUPLE_ID, NEW_MEMBER_ID]);
      const initialized = await db.query<{ epoch: number }>(`
        SELECT epoch
        FROM public.amora_privacy_context_epochs
        WHERE couple_id = $1::uuid
      `, [NEW_COUPLE_ID]);
      expect(initialized.rows).toEqual([{ epoch: 1 }]);

      await db.query(`
        INSERT INTO public.profiles(id, couple_id, role)
        VALUES ($1::uuid, $2::uuid, 'bride')
      `, [NEW_MEMBER_ID, NEW_COUPLE_ID]);
      await setPersona(db, "authenticated", NEW_MEMBER_ID);
      const memberEpoch = await db.query<{ epoch: number }>(`
        SELECT public.get_own_amora_privacy_epoch(
          $1::uuid,
          'shared'
        ) AS epoch
      `, [NEW_COUPLE_ID]);
      expect(memberEpoch.rows).toEqual([{ epoch: 2 }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("does not settle or fail anything for a stale provider-receipt owner", async () => {
    const db = await createDatabase();
    try {
      const expectedEpoch = await getSnapshotEpoch(db);
      await resetPersona(db);
      await db.query(`
        UPDATE public.amora_personalization_preferences
        SET revision = revision + 1
        WHERE owner_user_id = $1::uuid
      `, [BRIDE_ID]);
      await setPersona(db, "service_role", BRIDE_ID);
      const receipt = await prepareMainChat(db);

      await expect(db.query(fencedFinalizeSql(), [
        receipt.receipt_id,
        "ffffffff-ffff-4fff-8fff-ffffffffffff",
        REQUEST_KEY,
        expectedEpoch,
        "소유권 없는 호출의 응답",
        JSON.stringify({ kind: "terminal" }),
        JSON.stringify({ provider_response_id: "resp_wrong_owner" }),
      ])).rejects.toThrow(/AMORA_CHAT_RESPONSE_RECEIPT_INVALID/);

      const state = await db.query<{
        receipt_status: string;
        claim_status: string;
        failure_code: string | null;
        message_count: number;
      }>(`
        SELECT receipt.amora_cost_status AS receipt_status,
          claim.status AS claim_status,
          claim.failure_code,
          (SELECT count(*)::integer FROM public.chat_messages) AS message_count
        FROM public.ai_interactions_log AS receipt
        JOIN public.amora_chat_request_claims AS claim
          ON claim.couple_id = receipt.couple_id
         AND claim.request_key = receipt.amora_request_key
        WHERE receipt.id = $1::uuid
      `, [receipt.receipt_id]);
      expect(state.rows[0]).toEqual({
        receipt_status: "reserved",
        claim_status: "processing",
        failure_code: null,
        message_count: 0,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("does not settle or fail anything for a stale chat-claim generation", async () => {
    const db = await createDatabase();
    try {
      const expectedEpoch = await getSnapshotEpoch(db);
      await resetPersona(db);
      await db.query(`
        UPDATE public.amora_personalization_preferences
        SET revision = revision + 1
        WHERE owner_user_id = $1::uuid
      `, [BRIDE_ID]);
      await setPersona(db, "service_role", BRIDE_ID);
      const receipt = await prepareMainChat(db);

      await expect(db.query(fencedFinalizeSql({ claimAttemptCount: 2 }), [
        receipt.receipt_id,
        receipt.claim_token,
        REQUEST_KEY,
        expectedEpoch,
        "stale claim 호출의 응답",
        JSON.stringify({ kind: "terminal" }),
        JSON.stringify({ provider_response_id: "resp_stale_claim" }),
      ])).rejects.toThrow(/AMORA_CHAT_RESPONSE_CLAIM_STALE/);

      const state = await db.query<{
        receipt_status: string;
        claim_status: string;
        failure_code: string | null;
        message_count: number;
      }>(`
        SELECT receipt.amora_cost_status AS receipt_status,
          claim.status AS claim_status,
          claim.failure_code,
          (SELECT count(*)::integer FROM public.chat_messages) AS message_count
        FROM public.ai_interactions_log AS receipt
        JOIN public.amora_chat_request_claims AS claim
          ON claim.couple_id = receipt.couple_id
         AND claim.request_key = receipt.amora_request_key
        WHERE receipt.id = $1::uuid
      `, [receipt.receipt_id]);
      expect(state.rows[0]).toEqual({
        receipt_status: "reserved",
        claim_status: "processing",
        failure_code: null,
        message_count: 0,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("preserves the existing mediation cooldown terminal result across a later epoch change", async () => {
    const db = await createDatabase();
    try {
      const expectedEpoch = await getSnapshotEpoch(db);
      await resetPersona(db);
      await setPersona(db, "service_role", BRIDE_ID);
      const receipt = await prepareConflictMediation(db);
      await db.query(`
        INSERT INTO public.chat_messages(
          couple_id, sender_id, sender_type, role, content, metadata,
          visibility
        ) VALUES (
          $1::uuid, NULL, 'ai', 'assistant', '먼저 저장된 중재',
          jsonb_build_object(
            'kind', 'mediation',
            'client_request_id', 'mediation:${"b".repeat(64)}'
          ),
          'shared'
        )
      `, [COUPLE_ID]);
      const params = [
        receipt.receipt_id,
        receipt.claim_token,
        MEDIATION_REQUEST_KEY,
        expectedEpoch,
        "경쟁에서 뒤늦게 생성된 중재",
        JSON.stringify({ kind: "mediation" }),
        JSON.stringify({ provider_response_id: "resp_cooldown_lost" }),
      ];
      const first = await db.query<{
        outcome: string;
        message_id: string | null;
      }>(fencedFinalizeSql({ model: "gpt-5.6-terra" }), params);
      expect(first.rows[0]).toMatchObject({
        outcome: "cooldown_race_lost",
        message_id: null,
      });

      await resetPersona(db);
      await db.query(`
        UPDATE public.amora_memory_settings
        SET enabled = false
        WHERE couple_id = $1::uuid AND visibility = 'shared'
      `, [COUPLE_ID]);
      await setPersona(db, "service_role", BRIDE_ID);
      const retry = await db.query<{
        outcome: string;
        message_id: string | null;
      }>(fencedFinalizeSql({ model: "gpt-5.6-terra" }), params);
      expect(retry.rows[0]).toMatchObject({
        outcome: "cooldown_race_lost",
        message_id: null,
      });
      const state = await db.query<{
        claim_status: string;
        failure_code: string;
        receipt_status: string;
        message_count: number;
      }>(`
        SELECT claim.status AS claim_status,
          claim.failure_code,
          receipt.amora_cost_status AS receipt_status,
          (SELECT count(*)::integer FROM public.chat_messages) AS message_count
        FROM public.amora_chat_request_claims AS claim
        JOIN public.ai_interactions_log AS receipt
          ON receipt.couple_id = claim.couple_id
         AND receipt.amora_request_key = $2
        WHERE claim.couple_id = $1::uuid
          AND claim.request_key = $3
      `, [COUPLE_ID, CONFLICT_RECEIPT_KEY, MEDIATION_REQUEST_KEY]);
      expect(state.rows[0]).toEqual({
        claim_status: "failed",
        failure_code: "COOLDOWN_RACE_LOST",
        receipt_status: "settled",
        message_count: 1,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});
