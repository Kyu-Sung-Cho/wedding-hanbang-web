// @vitest-environment node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260815130000_amora_first_use_action_promotions.sql",
  ),
  "utf8",
);
const privateHardDeleteMigrationSql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260731173000_private_chat_hard_delete_boundary.sql",
  ),
  "utf8",
);

const BRIDE_ID = "10000000-0000-4000-8000-000000000001";
const GROOM_ID = "10000000-0000-4000-8000-000000000002";
const COUPLE_ID = "20000000-0000-4000-8000-000000000001";
const SOURCE_MESSAGE_ID = "30000000-0000-4000-8000-000000000001";
const CRITERION_ID = "40000000-0000-4000-8000-000000000001";
const FIRST_REQUEST_ID = "50000000-0000-4000-8000-000000000001";
const SECOND_REQUEST_ID = "50000000-0000-4000-8000-000000000002";
const CONFIRMATION_REQUEST_ID = "50000000-0000-4000-8000-000000000003";
const PROPOSAL_MESSAGE_ID = "60000000-0000-4000-8000-000000000001";
const CONFIRMATION_MESSAGE_ID = "60000000-0000-4000-8000-000000000002";
const PENDING_ACTION_ID = "70000000-0000-4000-8000-000000000001";
const OPERATION_KEY = "b".repeat(64);
const ACTION_DIGEST = "a".repeat(64);

const sourceContent = [
  "확인한 내용",
  "- venue shortlist is ready",
  "지금 할 한 가지: 예식장에 전화하기",
  "이유: 원하는 날짜가 가능한지 먼저 확인해야 해요",
  "완료 기준: 가능한 시간 두 개를 적어두기",
].join("\n");

const canonicalActionInput = {
  action: "예식장에 전화하기",
  reason: "원하는 날짜가 가능한지 먼저 확인해야 해요",
  completionCriterion: "가능한 시간 두 개를 적어두기",
};

const canonicalAddActionInput = {
  title: canonicalActionInput.action,
  description:
    `이유: ${canonicalActionInput.reason} 완료 기준: ${canonicalActionInput.completionCriterion}`,
  category_key: "general",
  priority: "medium",
  source: "chat",
};

const sharedContent = [
  "나만 상담에서 정리한 다음 한 가지를 둘이 볼 실행 카드로 제안해줘.",
  `지금 할 한 가지: ${canonicalActionInput.action}`,
  `이유: ${canonicalActionInput.reason}`,
  `완료 기준: ${canonicalActionInput.completionCriterion}`,
  "저장 전에 확인 카드만 보여줘.",
].join("\n");

function sha256(value: string): string {
  // PGlite does not ship Supabase pgcrypto. Match the deterministic 32-byte
  // extensions.digest stand-in installed by createDatabase; production uses
  // real SHA-256 through extensions.digest.
  const hex = Buffer.from(value, "utf8").toString("hex");
  return createHash("md5").update(hex).digest("hex")
    + createHash("md5").update(`${hex}sha256`).digest("hex");
}

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE SCHEMA extensions;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')::text
    $$;
    CREATE FUNCTION extensions.digest(value bytea, algorithm text)
    RETURNS bytea LANGUAGE sql IMMUTABLE AS $$
      SELECT decode(
        md5(encode(value, 'hex')) || md5(encode(value, 'hex') || algorithm),
        'hex'
      )
    $$;

    CREATE TABLE public.couples (
      id uuid PRIMARY KEY,
      bride_id uuid REFERENCES auth.users(id),
      groom_id uuid REFERENCES auth.users(id)
    );
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY REFERENCES auth.users(id),
      couple_id uuid REFERENCES public.couples(id),
      role text
    );
    CREATE TABLE public.wedding_journeys (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid NOT NULL UNIQUE REFERENCES public.couples(id),
      state_revision bigint NOT NULL DEFAULT 0
    );
    CREATE TABLE public.decision_nodes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      category text,
      decision_type text,
      chosen_value jsonb,
      source text,
      visibility text,
      source_actor_role text,
      user_confirmed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE public.amora_privacy_context_epochs (
      couple_id uuid PRIMARY KEY REFERENCES public.couples(id),
      epoch bigint NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.ai_interactions_log (
      id uuid PRIMARY KEY,
      amora_claim_token uuid NOT NULL,
      couple_id uuid NOT NULL,
      user_id uuid NOT NULL,
      amora_cost_status text NOT NULL,
      amora_call_source text NOT NULL,
      amora_call_phase text NOT NULL,
      amora_request_key text NOT NULL
    );
    CREATE TABLE public.chat_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
      sender_id uuid REFERENCES auth.users(id),
      sender_type text NOT NULL,
      sender_role text,
      role text NOT NULL,
      content text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      visibility text NOT NULL,
      stage_tag text,
      specialist_type text,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE UNIQUE INDEX chat_messages_client_request_id_unique
      ON public.chat_messages(couple_id, (metadata->>'client_request_id'))
      WHERE metadata->>'client_request_id' IS NOT NULL;
    CREATE TABLE public.amora_shared_action_acceptances (
      couple_id uuid NOT NULL,
      source_message_id uuid NOT NULL,
      action_id uuid NOT NULL,
      user_id uuid NOT NULL,
      proposal_digest text NOT NULL DEFAULT '${"c".repeat(64)}',
      roster_fingerprint text NOT NULL,
      revoked_at timestamptz,
      PRIMARY KEY (couple_id, source_message_id, action_id, user_id)
    );
    CREATE TABLE public.amora_shared_action_application_claims (
      couple_id uuid NOT NULL,
      source_message_id uuid NOT NULL,
      action_id uuid NOT NULL,
      claimed_by_user_id uuid NOT NULL,
      proposal_digest text NOT NULL DEFAULT '${"c".repeat(64)}',
      roster_fingerprint text NOT NULL,
      confirmation_message_id uuid,
      PRIMARY KEY (couple_id, source_message_id, action_id)
    );
    CREATE TABLE public.amora_chat_request_claims (
      couple_id uuid NOT NULL,
      request_key text NOT NULL,
      user_id uuid NOT NULL,
      visibility text NOT NULL,
      status text NOT NULL,
      user_message_id uuid,
      attempt_count integer NOT NULL DEFAULT 1,
      PRIMARY KEY (couple_id, request_key)
    );
    CREATE TABLE public.amora_tool_executions (
      couple_id uuid NOT NULL,
      request_key text NOT NULL,
      operation_key text NOT NULL,
      tool_name text NOT NULL,
      input_digest text NOT NULL,
      status text NOT NULL,
      result jsonb,
      pending_action_id uuid,
      pending_action_journey_revision bigint,
      PRIMARY KEY (couple_id, request_key, operation_key)
    );
    CREATE TABLE public.amora_actions (
      id text PRIMARY KEY,
      couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
      title text NOT NULL,
      description text,
      due_date text,
      category_key text,
      priority text NOT NULL DEFAULT 'medium',
      status text NOT NULL DEFAULT 'open',
      source text NOT NULL DEFAULT 'chat',
      href text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_by uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,
      dismissed_at timestamptz
    );
    CREATE FUNCTION public.amora_shared_action_context(
      p_action_id uuid,
      p_couple_id uuid,
      p_source_message_id uuid,
      p_user_id uuid,
      p_purpose text,
      p_confirmation_message_id uuid DEFAULT NULL
    ) RETURNS jsonb LANGUAGE sql SECURITY DEFINER
    SET search_path = pg_catalog, public AS $$
      SELECT jsonb_build_object(
        'actionId', p_action_id,
        'coupleId', p_couple_id,
        'sourceMessageId', p_source_message_id,
        'tool', 'add_amora_action',
        'inputDigest', '${ACTION_DIGEST}',
        'operationKey', '${OPERATION_KEY}',
        'policy', 'single'
      )
    $$;
    CREATE FUNCTION public.finalize_amora_chat_response_with_privacy_fence(
      p_receipt_id uuid,
      p_receipt_claim_token uuid,
      p_chat_couple_id uuid,
      p_chat_user_id uuid,
      p_chat_request_key text,
      p_chat_visibility text,
      p_chat_claim_attempt_count integer,
      p_expected_privacy_epoch bigint,
      p_message_content text,
      p_message_metadata jsonb,
      p_message_stage_tag text,
      p_message_specialist_type text,
      p_provider_attempted boolean,
      p_usage_status text,
      p_actual_cost_microusd bigint,
      p_success boolean,
      p_error_message text,
      p_model text,
      p_tokens_input integer,
      p_tokens_output integer,
      p_latency_ms integer,
      p_receipt_metadata jsonb
    ) RETURNS TABLE(
      finalized boolean,
      receipt_status text,
      outcome text,
      message_id uuid,
      message_created_at timestamptz,
      message_content text,
      message_metadata jsonb,
      message_stage_tag text,
      message_specialist_type text,
      message_visibility text,
      message_reused boolean
    ) LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = pg_catalog, public AS $$
    DECLARE
      v_epoch bigint;
    BEGIN
      SELECT privacy.epoch INTO v_epoch
      FROM public.amora_privacy_context_epochs AS privacy
      WHERE privacy.couple_id = p_chat_couple_id
      FOR UPDATE;
      RETURN QUERY SELECT
        true,
        'settled'::text,
        'persisted'::text,
        '60000000-0000-4000-8000-000000000099'::uuid,
        clock_timestamp(),
        p_message_content,
        p_message_metadata,
        p_message_stage_tag,
        p_message_specialist_type,
        p_chat_visibility,
        false;
    END
    $$;

    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO PUBLIC;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

    INSERT INTO auth.users(id) VALUES ('${BRIDE_ID}'), ('${GROOM_ID}');
    INSERT INTO public.couples(id, bride_id, groom_id)
    VALUES ('${COUPLE_ID}', '${BRIDE_ID}', '${GROOM_ID}');
    INSERT INTO public.profiles(id, couple_id, role) VALUES
      ('${BRIDE_ID}', '${COUPLE_ID}', 'bride'),
      ('${GROOM_ID}', '${COUPLE_ID}', 'groom');
    INSERT INTO public.wedding_journeys(couple_id, state_revision)
    VALUES ('${COUPLE_ID}', 7);
    INSERT INTO public.amora_privacy_context_epochs(couple_id, epoch)
    VALUES ('${COUPLE_ID}', 11);
    INSERT INTO public.decision_nodes(
      id, couple_id, category, decision_type, chosen_value, source,
      visibility, source_actor_role, user_confirmed_at, metadata
    ) VALUES (
      '${CRITERION_ID}', '${COUPLE_ID}', 'preference', 'decided',
      '{"value":"family-first"}'::jsonb, 'manual', 'shared', NULL, now(),
      jsonb_build_object(
        'criterion_contract', 'amora_couple_core_criterion_v1',
        'criterion_version', 1,
        'bride_user_id', '${BRIDE_ID}',
        'groom_user_id', '${GROOM_ID}',
        'acceptance_count', 2,
        'explicit', true
      )
    );
  `);
  const rosterFingerprint = await db.query<{ fingerprint: string }>(
    "SELECT md5($1 || ':' || $2) AS fingerprint",
    [BRIDE_ID, GROOM_ID],
  );
  await db.query(`
    INSERT INTO public.chat_messages(
      id, couple_id, sender_id, sender_type, role, content, metadata,
      visibility, created_at
    ) VALUES (
      $1::uuid, $2::uuid, NULL, 'ai', 'assistant', $3::text,
      jsonb_build_object(
        'amora_wedding_context_revision', 7,
        'amora_couple_criterion_decision_id', $4::uuid,
        'amora_first_use_action_promotion_v1', jsonb_build_object(
          'version', 1,
          'sourceContentDigest', $5::text,
          'journeyRevision', 7,
          'privacyEpoch', 11,
          'rosterFingerprint', $6::text,
          'criterionDecisionId', $4::uuid,
          'canonicalActionInput', $7::jsonb,
          'actionDigest', $8::text,
          'sharedContentDigest', $9::text
        )
      ),
      'bride_private', '2026-08-15T01:00:00Z'
    )
  `, [
    SOURCE_MESSAGE_ID,
    COUPLE_ID,
    sourceContent,
    CRITERION_ID,
    sha256(sourceContent),
    rosterFingerprint.rows[0]!.fingerprint,
    JSON.stringify(canonicalActionInput),
    ACTION_DIGEST,
    sha256(sharedContent),
  ]);
  await db.exec(migrationSql);
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

async function ingest(db: PGlite, clientRequestId: string) {
  const result = await db.query<{ result: Record<string, unknown> }>(`
    SELECT public.ingest_amora_first_use_action_promotion_v1(
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6,
      $7::jsonb, $8, $9
    ) AS result
  `, [
    COUPLE_ID,
    BRIDE_ID,
    SOURCE_MESSAGE_ID,
    clientRequestId,
    sharedContent,
    sha256(sourceContent),
    JSON.stringify(canonicalActionInput),
    ACTION_DIGEST,
    sha256(sharedContent),
  ]);
  return result.rows[0]!.result;
}

describe("Amora first-use action promotion migration", () => {
  it("keeps the hosted PostgREST read RPC argument names exact", async () => {
    const db = await createDatabase();
    try {
      const signature = await db.query<{ argument_names: string[] }>(`
        SELECT proargnames AS argument_names
        FROM pg_proc
        WHERE oid =
          'public.read_amora_first_use_action_promotion_v1(uuid,uuid,uuid)'::regprocedure
      `);
      expect(signature.rows[0]!.argument_names).toEqual([
        "p_couple_id",
        "p_owner_user_id",
        "p_source_private_message_id",
      ]);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("atomically promotes one current private action and reuses it by source after restart", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role", BRIDE_ID);
      const ready = await db.query<{ result: Record<string, unknown> }>(`
        SELECT public.read_amora_first_use_action_promotion_v1(
          $1::uuid, $2::uuid, $3::uuid
        ) AS result
      `, [COUPLE_ID, BRIDE_ID, SOURCE_MESSAGE_ID]);
      expect(ready.rows[0]!.result).toEqual({
        version: 1,
        status: "ready",
        promotionId: null,
        sharedMessageId: null,
        sourceMessageId: SOURCE_MESSAGE_ID,
        sourceRevision: 7,
        criterionDecisionId: CRITERION_ID,
        canonicalActionInput,
      });

      const first = await ingest(db, FIRST_REQUEST_ID);
      expect(first).toEqual({
        version: 1,
        promotionId: expect.any(String),
        sharedMessageId: expect.any(String),
        reused: false,
      });

      const retry = await ingest(db, SECOND_REQUEST_ID);
      expect(retry).toEqual({ ...first, reused: true });

      await resetPersona(db);
      const durable = await db.query<{
        receipts: number;
        shared_rows: number;
        sender_role: string | null;
        content: string;
        metadata: Record<string, unknown>;
      }>(`
        SELECT
          (SELECT count(*)::integer
             FROM public.amora_first_use_action_promotions) AS receipts,
          (SELECT count(*)::integer
             FROM public.chat_messages
            WHERE id = $1::uuid) AS shared_rows,
          message.sender_role,
          message.content,
          message.metadata
        FROM public.chat_messages AS message
        WHERE message.id = $1::uuid
      `, [first.sharedMessageId]);
      expect(durable.rows).toEqual([{
        receipts: 1,
        shared_rows: 1,
        sender_role: null,
        content: sharedContent,
        metadata: {
          client_request_id: FIRST_REQUEST_ID,
          amora_ingest_contract_version: 1,
          ai_response_requested: true,
          provider_attachment_state: "none",
          provider_attachment_count: 0,
          amora_first_use_promotion_id: first.promotionId,
        },
      }]);
      expect(JSON.stringify(durable.rows[0]!.metadata)).not.toContain(
        SOURCE_MESSAGE_ID,
      );

      await setPersona(db, "service_role", BRIDE_ID);
      const read = await db.query<{ result: Record<string, unknown> }>(`
        SELECT public.read_amora_first_use_action_promotion_v1(
          $1::uuid, $2::uuid, $3::uuid
        ) AS result
      `, [COUPLE_ID, BRIDE_ID, SOURCE_MESSAGE_ID]);
      expect(read.rows[0]!.result).toEqual({
        version: 1,
        status: "promoted",
        promotionId: first.promotionId,
        sharedMessageId: first.sharedMessageId,
        sourceMessageId: SOURCE_MESSAGE_ID,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("binds the promoted draft to one exact proposal and consumes it only with the atomic apply context", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role", BRIDE_ID);
      const promoted = await ingest(db, FIRST_REQUEST_ID);
      const validated = await db.query<{ result: Record<string, unknown> }>(`
        SELECT public.validate_amora_first_use_action_promotion_v1(
          $1::uuid, $2::uuid, $3::uuid, 11::bigint
        ) AS result
      `, [COUPLE_ID, BRIDE_ID, promoted.sharedMessageId]);
      expect(validated.rows[0]!.result).toEqual({
        version: 1,
        promotionId: promoted.promotionId,
        canonicalActionInput,
        canonicalAddActionInput,
      });

      const pendingAction = {
        version: 2,
        actionId: PENDING_ACTION_ID,
        tool: "add_amora_action",
        input: canonicalAddActionInput,
        inputDigest: ACTION_DIGEST,
        operationKey: OPERATION_KEY,
        confirmation: "이 실행 카드를 저장할까요?",
        issuedAt: 1_776_000_000_000,
        expiresAt: 1_776_000_600_000,
      };
      await expect(db.query(`
        INSERT INTO public.chat_messages(
          id, couple_id, sender_id, sender_type, role, content, metadata,
          visibility, created_at
        ) VALUES (
          $1::uuid, $2::uuid, NULL, 'ai', 'assistant', 'bad proposal',
          jsonb_build_object(
            'in_reply_to_user_message_id', $3::uuid,
            'pending_amora_action',
              jsonb_set($4::jsonb, '{input,title}', '"tampered"'::jsonb),
            'pending_amora_action_journey_revision', 7
          ),
          'shared', '2026-08-15T01:00:01Z'
        )
      `, [
        PROPOSAL_MESSAGE_ID,
        COUPLE_ID,
        promoted.sharedMessageId,
        JSON.stringify(pendingAction),
      ])).rejects.toThrow(/AMORA_FIRST_USE_PROMOTION_PROPOSAL_MISMATCH/);
      await resetPersona(db);
      const rejectedProposal = await db.query<{ messages: number; bindings: number }>(`
        SELECT
          (SELECT count(*)::integer FROM public.chat_messages
            WHERE id = $1::uuid) AS messages,
          (SELECT count(*)::integer
             FROM public.amora_first_use_action_proposal_bindings
            WHERE proposal_message_id = $1::uuid) AS bindings
      `, [PROPOSAL_MESSAGE_ID]);
      expect(rejectedProposal.rows).toEqual([{ messages: 0, bindings: 0 }]);

      await setPersona(db, "service_role", BRIDE_ID);
      await db.query(`
        INSERT INTO public.chat_messages(
          id, couple_id, sender_id, sender_type, role, content, metadata,
          visibility, created_at
        ) VALUES (
          $1::uuid, $2::uuid, NULL, 'ai', 'assistant', 'proposal',
          jsonb_build_object(
            'in_reply_to_user_message_id', $3::uuid,
            'pending_amora_action', $4::jsonb,
            'pending_amora_action_journey_revision', 7
          ),
          'shared', '2026-08-15T01:00:02Z'
        )
      `, [
        PROPOSAL_MESSAGE_ID,
        COUPLE_ID,
        promoted.sharedMessageId,
        JSON.stringify(pendingAction),
      ]);

      await db.query(`
        INSERT INTO public.chat_messages(
          id, couple_id, sender_id, sender_type, sender_role, role, content,
          metadata, visibility, created_at
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, 'bride', 'bride', 'user', 'apply',
          jsonb_build_object('confirmed_amora_action_id', $4::text),
          'shared', '2026-08-15T01:00:03Z'
        )
      `, [CONFIRMATION_MESSAGE_ID, COUPLE_ID, BRIDE_ID, PENDING_ACTION_ID]);
      const requestKey = `chat:${BRIDE_ID}:${CONFIRMATION_REQUEST_ID}`;
      await db.query(`
        INSERT INTO public.amora_shared_action_application_claims(
          couple_id, source_message_id, action_id, claimed_by_user_id,
          roster_fingerprint, confirmation_message_id
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid,
          md5($4::text || ':' || $5::text),
          $6::uuid
        )
      `, [
        COUPLE_ID,
        PROPOSAL_MESSAGE_ID,
        PENDING_ACTION_ID,
        BRIDE_ID,
        GROOM_ID,
        CONFIRMATION_MESSAGE_ID,
      ]);
      await db.query(`
        INSERT INTO public.amora_chat_request_claims(
          couple_id, request_key, user_id, visibility, status,
          user_message_id
        ) VALUES ($1::uuid, $2, $3::uuid, 'shared', 'processing', $4::uuid)
      `, [COUPLE_ID, requestKey, BRIDE_ID, CONFIRMATION_MESSAGE_ID]);
      await db.query(`
        INSERT INTO public.amora_tool_executions(
          couple_id, request_key, operation_key, tool_name, input_digest,
          status, pending_action_id, pending_action_journey_revision
        ) VALUES (
          $1::uuid, $2, $3, 'add_amora_action', $4, 'processing',
          $5::uuid, 7
        )
      `, [
        COUPLE_ID,
        requestKey,
        OPERATION_KEY,
        ACTION_DIGEST,
        PENDING_ACTION_ID,
      ]);

      await db.query(`
        SELECT set_config('hanbang.amora_shared_action_couple_id', $1, false),
               set_config('hanbang.amora_shared_action_request_key', $2, false),
               set_config('hanbang.amora_shared_action_operation_key', $3, false),
               set_config('hanbang.amora_shared_action_action_id', $4, false),
               set_config('hanbang.amora_shared_action_expected_revision', '7', false)
      `, [COUPLE_ID, requestKey, OPERATION_KEY, PENDING_ACTION_ID]);
      await db.query(`
        INSERT INTO public.amora_actions(
          id, couple_id, title, description, category_key, priority, status,
          source, href, metadata, created_by
        ) VALUES (
          'act_first', $1::uuid, $2, $3, NULL, 'medium', 'open', 'chat',
          '/wedding/lounge', '{}'::jsonb, NULL
        )
      `, [
        COUPLE_ID,
        canonicalAddActionInput.title,
        canonicalAddActionInput.description,
      ]);

      const applied = await db.query<{
        first_use_promotion_id: string | null;
      }>(`
        SELECT first_use_promotion_id::text
        FROM public.amora_actions
        WHERE id = 'act_first'
      `);
      expect(applied.rows).toEqual([{
        first_use_promotion_id: promoted.promotionId,
      }]);

      await expect(db.query(`
        INSERT INTO public.amora_actions(
          id, couple_id, title, description, category_key, priority, status,
          source, href, metadata, created_by
        ) VALUES (
          'act_duplicate', $1::uuid, $2, $3, NULL, 'medium', 'open', 'chat',
          '/wedding/lounge', '{}'::jsonb, NULL
        )
      `, [
        COUPLE_ID,
        canonicalAddActionInput.title,
        canonicalAddActionInput.description,
      ])).rejects.toThrow(/duplicate key|CONSUMED/i);

      const actionCount = await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count FROM public.amora_actions
      `);
      expect(actionCount.rows).toEqual([{ count: 1 }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rolls back the whole ingest when the source wedding revision is stale", async () => {
    const db = await createDatabase();
    try {
      await db.query(`
        UPDATE public.wedding_journeys
        SET state_revision = 8
        WHERE couple_id = $1::uuid
      `, [COUPLE_ID]);
      await setPersona(db, "service_role", BRIDE_ID);

      await expect(ingest(db, FIRST_REQUEST_ID)).rejects.toThrow(
        /AMORA_FIRST_USE_PROMOTION_JOURNEY_CHANGED/,
      );
      await resetPersona(db);
      const durableState = await db.query<{
        promotions: number;
        shared_messages: number;
      }>(`
        SELECT
          (
            SELECT count(*)::integer
            FROM public.amora_first_use_action_promotions
          ) AS promotions,
          (
            SELECT count(*)::integer
            FROM public.chat_messages
            WHERE visibility = 'shared'
          ) AS shared_messages
      `);
      expect(durableState.rows).toEqual([{
        promotions: 0,
        shared_messages: 0,
      }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rejects validation, status context, and claim writes after the privacy epoch changes", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role", BRIDE_ID);
      const promoted = await ingest(db, FIRST_REQUEST_ID);
      const pendingAction = {
        version: 2,
        actionId: PENDING_ACTION_ID,
        tool: "add_amora_action",
        input: canonicalAddActionInput,
        inputDigest: ACTION_DIGEST,
        operationKey: OPERATION_KEY,
        confirmation: "이 실행 카드를 저장할까요?",
        issuedAt: 1_776_000_000_000,
        expiresAt: 1_776_000_600_000,
      };
      await db.query(`
        INSERT INTO public.chat_messages(
          id, couple_id, sender_id, sender_type, role, content, metadata,
          visibility, created_at
        ) VALUES (
          $1::uuid, $2::uuid, NULL, 'ai', 'assistant', 'proposal',
          jsonb_build_object(
            'in_reply_to_user_message_id', $3::uuid,
            'pending_amora_action', $4::jsonb,
            'pending_amora_action_journey_revision', 7
          ),
          'shared', '2026-08-15T01:00:02Z'
        )
      `, [
        PROPOSAL_MESSAGE_ID,
        COUPLE_ID,
        promoted.sharedMessageId,
        JSON.stringify(pendingAction),
      ]);
      await db.query(`
        UPDATE public.amora_privacy_context_epochs
        SET epoch = 12
        WHERE couple_id = $1::uuid
      `, [COUPLE_ID]);

      await expect(db.query(`
        SELECT public.validate_amora_first_use_action_promotion_v1(
          $1::uuid, $2::uuid, $3::uuid, 11::bigint
        )
      `, [COUPLE_ID, BRIDE_ID, promoted.sharedMessageId])).rejects.toThrow(
        /AMORA_FIRST_USE_PROMOTION_PRIVACY_CHANGED/,
      );
      await expect(db.query(`
        SELECT public.amora_shared_action_context_with_first_use_promotion_v1(
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'status', NULL
        )
      `, [
        PENDING_ACTION_ID,
        COUPLE_ID,
        PROPOSAL_MESSAGE_ID,
        BRIDE_ID,
      ])).rejects.toThrow(/AMORA_FIRST_USE_PROMOTION_PRIVACY_CHANGED/);
      await expect(db.query(`
        INSERT INTO public.amora_shared_action_application_claims(
          couple_id, source_message_id, action_id, claimed_by_user_id,
          roster_fingerprint, confirmation_message_id
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid,
          md5($4::text || ':' || $5::text), NULL
        )
      `, [
        COUPLE_ID,
        PROPOSAL_MESSAGE_ID,
        PENDING_ACTION_ID,
        BRIDE_ID,
        GROOM_ID,
      ])).rejects.toThrow(/AMORA_FIRST_USE_PROMOTION_PRIVACY_CHANGED/);

      await resetPersona(db);
      const claims = await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count
        FROM public.amora_shared_action_application_claims
      `);
      expect(claims.rows).toEqual([{ count: 0 }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps receipts private and exposes promotion RPCs only to the service role", async () => {
    const db = await createDatabase();
    try {
      const contract = await db.query<{
        anon_receipts: boolean;
        authenticated_receipts: boolean;
        service_receipts: boolean;
        anon_ingest: boolean;
        authenticated_ingest: boolean;
        service_ingest: boolean;
        anon_read: boolean;
        authenticated_read: boolean;
        service_read: boolean;
        anon_validate: boolean;
        authenticated_validate: boolean;
        service_validate: boolean;
        anon_finalize: boolean;
        authenticated_finalize: boolean;
        service_finalize: boolean;
        service_inner_finalize: boolean;
      }>(`
        SELECT
          has_table_privilege(
            'anon', 'public.amora_first_use_action_promotions', 'SELECT'
          ) AS anon_receipts,
          has_table_privilege(
            'authenticated', 'public.amora_first_use_action_promotions', 'SELECT'
          ) AS authenticated_receipts,
          has_table_privilege(
            'service_role', 'public.amora_first_use_action_promotions', 'SELECT'
          ) AS service_receipts,
          has_function_privilege(
            'anon',
            'public.ingest_amora_first_use_action_promotion_v1(uuid,uuid,uuid,uuid,text,text,jsonb,text,text)',
            'EXECUTE'
          ) AS anon_ingest,
          has_function_privilege(
            'authenticated',
            'public.ingest_amora_first_use_action_promotion_v1(uuid,uuid,uuid,uuid,text,text,jsonb,text,text)',
            'EXECUTE'
          ) AS authenticated_ingest,
          has_function_privilege(
            'service_role',
            'public.ingest_amora_first_use_action_promotion_v1(uuid,uuid,uuid,uuid,text,text,jsonb,text,text)',
            'EXECUTE'
          ) AS service_ingest,
          has_function_privilege(
            'anon',
            'public.read_amora_first_use_action_promotion_v1(uuid,uuid,uuid)',
            'EXECUTE'
          ) AS anon_read,
          has_function_privilege(
            'authenticated',
            'public.read_amora_first_use_action_promotion_v1(uuid,uuid,uuid)',
            'EXECUTE'
          ) AS authenticated_read,
          has_function_privilege(
            'service_role',
            'public.read_amora_first_use_action_promotion_v1(uuid,uuid,uuid)',
            'EXECUTE'
          ) AS service_read,
          has_function_privilege(
            'anon',
            'public.validate_amora_first_use_action_promotion_v1(uuid,uuid,uuid,bigint)',
            'EXECUTE'
          ) AS anon_validate,
          has_function_privilege(
            'authenticated',
            'public.validate_amora_first_use_action_promotion_v1(uuid,uuid,uuid,bigint)',
            'EXECUTE'
          ) AS authenticated_validate,
          has_function_privilege(
            'service_role',
            'public.validate_amora_first_use_action_promotion_v1(uuid,uuid,uuid,bigint)',
            'EXECUTE'
          ) AS service_validate,
          has_function_privilege(
            'anon',
            'public.finalize_amora_chat_response_with_privacy_fence(uuid,uuid,uuid,uuid,text,text,integer,bigint,text,jsonb,text,text,boolean,text,bigint,boolean,text,text,integer,integer,integer,jsonb)',
            'EXECUTE'
          ) AS anon_finalize,
          has_function_privilege(
            'authenticated',
            'public.finalize_amora_chat_response_with_privacy_fence(uuid,uuid,uuid,uuid,text,text,integer,bigint,text,jsonb,text,text,boolean,text,bigint,boolean,text,text,integer,integer,integer,jsonb)',
            'EXECUTE'
          ) AS authenticated_finalize,
          has_function_privilege(
            'service_role',
            'public.finalize_amora_chat_response_with_privacy_fence(uuid,uuid,uuid,uuid,text,text,integer,bigint,text,jsonb,text,text,boolean,text,bigint,boolean,text,text,integer,integer,integer,jsonb)',
            'EXECUTE'
          ) AS service_finalize,
          has_function_privilege(
            'service_role',
            'public.finalize_amora_chat_response_with_privacy_fence_inner_v1(uuid,uuid,uuid,uuid,text,text,integer,bigint,text,jsonb,text,text,boolean,text,bigint,boolean,text,text,integer,integer,integer,jsonb)',
            'EXECUTE'
          ) AS service_inner_finalize
      `);
      expect(contract.rows).toEqual([{
        anon_receipts: false,
        authenticated_receipts: false,
        service_receipts: false,
        anon_ingest: false,
        authenticated_ingest: false,
        service_ingest: true,
        anon_read: false,
        authenticated_read: false,
        service_read: true,
        anon_validate: false,
        authenticated_validate: false,
        service_validate: true,
        anon_finalize: false,
        authenticated_finalize: false,
        service_finalize: true,
        service_inner_finalize: false,
      }]);

      await setPersona(db, "authenticated", BRIDE_ID);
      await expect(db.query(`
        SELECT * FROM public.amora_first_use_action_promotions
      `)).rejects.toThrow(/permission denied/i);
      await expect(db.query(`
        SELECT public.read_amora_first_use_action_promotion_v1(
          $1::uuid, $2::uuid, $3::uuid
        )
      `, [COUPLE_ID, BRIDE_ID, SOURCE_MESSAGE_ID])).rejects.toThrow(
        /permission denied/i,
      );
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("leaves generic shared proposals and non-promotion actions unchanged", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role", BRIDE_ID);
      const genericPendingAction = {
        version: 2,
        actionId: PENDING_ACTION_ID,
        tool: "add_amora_action",
        input: { title: "generic action" },
        inputDigest: ACTION_DIGEST,
        operationKey: OPERATION_KEY,
        confirmation: "save?",
        issuedAt: 1_776_000_000_000,
        expiresAt: 1_776_000_600_000,
      };
      await db.query(`
        INSERT INTO public.chat_messages(
          id, couple_id, sender_id, sender_type, role, content, metadata,
          visibility
        ) VALUES (
          $1::uuid, $2::uuid, NULL, 'ai', 'assistant', 'generic proposal',
          jsonb_build_object(
            'pending_amora_action', $3::jsonb,
            'pending_amora_action_journey_revision', 7
          ),
          'shared'
        )
      `, [PROPOSAL_MESSAGE_ID, COUPLE_ID, JSON.stringify(genericPendingAction)]);
      await db.query(`
        INSERT INTO public.amora_actions(
          id, couple_id, title, priority, status, source, href, metadata
        ) VALUES (
          'generic_action', $1::uuid, 'generic action', 'medium', 'open',
          'chat', '/wedding/lounge', '{}'::jsonb
        )
      `, [COUPLE_ID]);

      await resetPersona(db);
      const state = await db.query<{
        bindings: number;
        promotion_id: string | null;
      }>(`
        SELECT
          (
            SELECT count(*)::integer
            FROM public.amora_first_use_action_proposal_bindings
          ) AS bindings,
          first_use_promotion_id::text AS promotion_id
        FROM public.amora_actions
        WHERE id = 'generic_action'
      `);
      expect(state.rows).toEqual([{ bindings: 0, promotion_id: null }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("locks exact receipt and claim before the couple on processing terminal responses", async () => {
    const db = await createDatabase();
    const receiptId = "80000000-0000-4000-8000-000000000001";
    const receiptClaimToken = "80000000-0000-4000-8000-000000000002";
    const requestKey = `chat:${BRIDE_ID}:${FIRST_REQUEST_ID}`;
    try {
      await db.query(`
        INSERT INTO public.ai_interactions_log(
          id, amora_claim_token, couple_id, user_id, amora_cost_status,
          amora_call_source, amora_call_phase, amora_request_key
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'reserved',
          'durable', 'final_no_tool', $5
        )
      `, [receiptId, receiptClaimToken, COUPLE_ID, BRIDE_ID, requestKey]);
      await db.query(`
        INSERT INTO public.amora_chat_request_claims(
          couple_id, request_key, user_id, visibility, status, attempt_count
        ) VALUES ($1::uuid, $2, $3::uuid, 'shared', 'processing', 1)
      `, [COUPLE_ID, requestKey, BRIDE_ID]);

      const definitions = await db.query<{
        wrapper: string;
        base_finalizer: string;
      }>(`
        SELECT
          pg_get_functiondef(
            'public.finalize_amora_chat_response_with_privacy_fence(uuid,uuid,uuid,uuid,text,text,integer,bigint,text,jsonb,text,text,boolean,text,bigint,boolean,text,text,integer,integer,integer,jsonb)'::regprocedure
          ) AS wrapper,
          pg_get_functiondef(
            'public.finalize_amora_chat_response_with_privacy_fence_inner_v1(uuid,uuid,uuid,uuid,text,text,integer,bigint,text,jsonb,text,text,boolean,text,bigint,boolean,text,text,integer,integer,integer,jsonb)'::regprocedure
          ) AS base_finalizer
      `);
      const wrapper = definitions.rows[0]!.wrapper.replace(/\s+/g, " ");
      const baseFinalizer = definitions.rows[0]!.base_finalizer.replace(/\s+/g, " ");
      const receiptLock = wrapper.indexOf(
        "FROM public.ai_interactions_log AS receipt",
      );
      const claimLock = wrapper.indexOf(
        "FROM public.amora_chat_request_claims AS claim",
      );
      const processingBranch = wrapper.indexOf(
        "IF v_claim.status IS DISTINCT FROM 'processing' THEN",
      );
      const coupleLockBranch = wrapper.indexOf("IF v_requires_couple_update THEN");
      const finalDelegate = wrapper.lastIndexOf(
        "public.finalize_amora_chat_response_with_privacy_fence_inner_v1(",
      );
      expect(receiptLock).toBeGreaterThanOrEqual(0);
      expect(receiptLock).toBeLessThan(claimLock);
      expect(claimLock).toBeLessThan(processingBranch);
      expect(processingBranch).toBeLessThan(coupleLockBranch);
      expect(coupleLockBranch).toBeLessThan(finalDelegate);
      expect(wrapper).toContain("p_chat_visibility = 'shared'");
      expect(wrapper).toContain("p_message_metadata ? 'pending_amora_action'");
      expect(wrapper).toContain("FOR UPDATE");
      expect(wrapper).toContain("FOR SHARE");
      expect(baseFinalizer).toContain(
        "FROM public.amora_privacy_context_epochs AS privacy",
      );
      const argumentContract = await db.query<{
        input_names: string[];
        owner_name: string;
        security_definer: boolean;
        config: string[];
      }>(`
        SELECT procedure.proargnames[1:22] AS input_names,
               pg_get_userbyid(procedure.proowner) AS owner_name,
               procedure.prosecdef AS security_definer,
               procedure.proconfig AS config
        FROM pg_proc AS procedure
        JOIN pg_namespace AS namespace
          ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'public'
          AND procedure.proname =
            'finalize_amora_chat_response_with_privacy_fence'
      `);
      expect(argumentContract.rows).toEqual([{
        input_names: [
          "p_receipt_id",
          "p_receipt_claim_token",
          "p_chat_couple_id",
          "p_chat_user_id",
          "p_chat_request_key",
          "p_chat_visibility",
          "p_chat_claim_attempt_count",
          "p_expected_privacy_epoch",
          "p_message_content",
          "p_message_metadata",
          "p_message_stage_tag",
          "p_message_specialist_type",
          "p_provider_attempted",
          "p_usage_status",
          "p_actual_cost_microusd",
          "p_success",
          "p_error_message",
          "p_model",
          "p_tokens_input",
          "p_tokens_output",
          "p_latency_ms",
          "p_receipt_metadata",
        ],
        owner_name: "postgres",
        security_definer: true,
        config: [
          "search_path=pg_catalog, public",
          "lock_timeout=5s",
          "statement_timeout=15s",
        ],
      }]);

      await setPersona(db, "service_role", BRIDE_ID);
      const finalized = await db.query<{
        finalized: boolean;
        outcome: string;
        message_content: string;
        message_metadata: Record<string, unknown>;
      }>(`
        SELECT finalized, outcome, message_content, message_metadata
        FROM public.finalize_amora_chat_response_with_privacy_fence(
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, 'shared', 1, 11,
          'terminal answer',
          '{"pending_amora_action":{"tool":"add_amora_action"}}'::jsonb,
          'exploring', 'general', true, 'complete', 1230, true, NULL,
          'gpt-5.6-luna', 1200, 240, 25, '{}'::jsonb
        )
      `, [receiptId, receiptClaimToken, COUPLE_ID, BRIDE_ID, requestKey]);
      expect(finalized.rows).toEqual([{
        finalized: true,
        outcome: "persisted",
        message_content: "terminal answer",
        message_metadata: {
          pending_amora_action: { tool: "add_amora_action" },
        },
      }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("replays a settled receipt before requiring a new couple lock", async () => {
    const db = await createDatabase();
    const receiptId = "81000000-0000-4000-8000-000000000001";
    const receiptClaimToken = "81000000-0000-4000-8000-000000000002";
    const missingCoupleId = "21000000-0000-4000-8000-000000000099";
    const replayUserId = "11000000-0000-4000-8000-000000000099";
    const replayRequestId = "51000000-0000-4000-8000-000000000099";
    const requestKey = `chat:${replayUserId}:${replayRequestId}`;
    try {
      await db.query(`
        INSERT INTO public.ai_interactions_log(
          id, amora_claim_token, couple_id, user_id, amora_cost_status,
          amora_call_source, amora_call_phase, amora_request_key
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'settled',
          'durable', 'final_no_tool', $5
        )
      `, [
        receiptId,
        receiptClaimToken,
        missingCoupleId,
        replayUserId,
        requestKey,
      ]);
      await db.query(`
        INSERT INTO public.amora_chat_request_claims(
          couple_id, request_key, user_id, visibility, status, attempt_count
        ) VALUES ($1::uuid, $2, $3::uuid, 'shared', 'completed', 4)
      `, [missingCoupleId, requestKey, replayUserId]);
      await setPersona(db, "service_role", BRIDE_ID);

      const replay = await db.query<{ outcome: string; message_content: string }>(`
        SELECT outcome, message_content
        FROM public.finalize_amora_chat_response_with_privacy_fence(
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, 'shared', 4, 11,
          'replayed terminal answer', '{}'::jsonb, NULL, 'general',
          true, 'complete', 1230, true, NULL, 'gpt-5.6-luna',
          1200, 240, 25, '{}'::jsonb
        )
      `, [
        receiptId,
        receiptClaimToken,
        missingCoupleId,
        replayUserId,
        requestKey,
      ]);
      expect(replay.rows).toEqual([{
        outcome: "persisted",
        message_content: "replayed terminal answer",
      }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps private terminal couple locks compatible with private hard deletion", async () => {
    const db = await createDatabase();
    try {
      const definition = await db.query<{ wrapper: string }>(`
        SELECT pg_get_functiondef(
          'public.finalize_amora_chat_response_with_privacy_fence(uuid,uuid,uuid,uuid,text,text,integer,bigint,text,jsonb,text,text,boolean,text,bigint,boolean,text,text,integer,integer,integer,jsonb)'::regprocedure
        ) AS wrapper
      `);
      const wrapper = definition.rows[0]!.wrapper.replace(/\s+/g, " ");
      const updateRule = wrapper.match(
        /v_requires_couple_update := v_is_conflict_mediation OR \(.+?\);/,
      )?.[0];
      expect(updateRule).toBe(
        "v_requires_couple_update := v_is_conflict_mediation OR ( p_chat_visibility = 'shared' AND p_message_metadata ? 'pending_amora_action' );",
      );
      expect(wrapper).toContain(
        "ELSE PERFORM 1 FROM public.couples AS couple",
      );
      expect(wrapper).toContain("FOR SHARE;");

      const hardDelete = privateHardDeleteMigrationSql
        .slice(privateHardDeleteMigrationSql.indexOf(
          "CREATE OR REPLACE FUNCTION public.hard_delete_current_user_private_chat",
        ))
        .replace(/\s+/g, " ");
      const hardDeleteCouple = hardDelete.indexOf("FROM public.couples AS couple");
      const hardDeleteShare = hardDelete.indexOf("FOR SHARE;", hardDeleteCouple);
      const hardDeleteClaims = hardDelete.indexOf(
        "DELETE FROM public.amora_chat_request_claims",
      );
      expect(hardDeleteCouple).toBeGreaterThanOrEqual(0);
      expect(hardDeleteCouple).toBeLessThan(hardDeleteShare);
      expect(hardDeleteShare).toBeLessThan(hardDeleteClaims);
      expect(hardDelete.slice(hardDeleteClaims, hardDeleteClaims + 180)).toContain(
        "AND visibility = v_visibility",
      );
    } finally {
      await db.close();
    }
  }, 30_000);

  it("keeps the freshness lock order couple to epoch to journey to private source or receipt", async () => {
    const db = await createDatabase();
    try {
      const definitions = await db.query<{
        current_context: string;
        source_context: string;
        receipt_context: string;
      }>(`
        SELECT
          pg_get_functiondef(
            'public.amora_first_use_action_current_context_v1(uuid,uuid)'::regprocedure
          ) AS current_context,
          pg_get_functiondef(
            'public.amora_first_use_action_source_context_v1(uuid,uuid,uuid)'::regprocedure
          ) AS source_context,
          pg_get_functiondef(
            'public.amora_first_use_action_assert_current_v1(uuid,uuid,bigint)'::regprocedure
          ) AS receipt_context
      `);
      const current = definitions.rows[0]!.current_context.replace(/\s+/g, " ");
      const source = definitions.rows[0]!.source_context.replace(/\s+/g, " ");
      const receipt = definitions.rows[0]!.receipt_context.replace(/\s+/g, " ");
      const coupleLock = current.indexOf("FROM public.couples AS couple");
      const epochLock = current.indexOf(
        "FROM public.amora_privacy_context_epochs AS privacy",
      );
      const journeyLock = current.indexOf("FROM public.wedding_journeys AS journey");
      expect(coupleLock).toBeGreaterThanOrEqual(0);
      expect(coupleLock).toBeLessThan(epochLock);
      expect(epochLock).toBeLessThan(journeyLock);

      const sourceSnapshot = source.indexOf(
        "public.amora_first_use_action_current_context_v1",
      );
      const sourceLock = source.indexOf("FROM public.chat_messages AS message");
      expect(sourceSnapshot).toBeGreaterThanOrEqual(0);
      expect(sourceSnapshot).toBeLessThan(sourceLock);

      const receiptSnapshot = receipt.indexOf(
        "public.amora_first_use_action_current_context_v1",
      );
      const receiptLock = receipt.lastIndexOf(
        "FROM public.amora_first_use_action_promotions AS promotion",
      );
      expect(receiptSnapshot).toBeGreaterThanOrEqual(0);
      expect(receiptSnapshot).toBeLessThan(receiptLock);
    } finally {
      await db.close();
    }
  }, 30_000);
});
