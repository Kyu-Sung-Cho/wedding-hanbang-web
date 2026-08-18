// @vitest-environment node

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { describe, expect, it } from "vitest";
import { getAmoraToolOperationIdentity } from "@/lib/ai/amoraToolIdentity";

const migrationPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260816150000_amora_provider_backed_add_action_application.sql",
);
const coupleCriterionMigrationPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260814140000_amora_couple_core_criterion.sql",
);
const topicCriterionContextMigrationPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260818150000_amora_topic_criterion_action_context.sql",
);

const BRIDE_ID = "10000000-0000-4000-8000-000000000001";
const GROOM_ID = "10000000-0000-4000-8000-000000000002";
const COUPLE_ID = "20000000-0000-4000-8000-000000000001";
const SOURCE_USER_MESSAGE_ID = "30000000-0000-4000-8000-000000000001";
const SOURCE_PROPOSAL_MESSAGE_ID = "30000000-0000-4000-8000-000000000002";
const CONFIRMATION_MESSAGE_ID = "30000000-0000-4000-8000-000000000003";
const SOURCE_RECEIPT_ID = "40000000-0000-4000-8000-000000000001";
const SOURCE_RECEIPT_TOKEN = "40000000-0000-4000-8000-000000000002";
const SOURCE_REQUEST_ID = "50000000-0000-4000-8000-000000000001";
const CONFIRMATION_REQUEST_ID = "50000000-0000-4000-8000-000000000002";
const PENDING_ACTION_ID = "60000000-0000-4000-8000-000000000001";
const COUPLE_CRITERION_DECISION_ID = "70000000-0000-4000-8000-000000000001";
const COUPLE_CRITERION_VALUE = "무리하지 않는 예산 안에서 결정해요";
const CONFIRMATION_CONTENT = "좋아요. 제안한 변경을 적용해 주세요.";
const SOURCE_CONFIRMATION = [
  "다음 변경을 적용할까요?",
  "- 변경: 아모라 행동 카드 추가",
  "- 제목: 예식장 계약서 특약 확인",
  "- 설명: 취소 수수료와 보증 인원을 다시 확인해요.",
  "- 마감일: 2026-09-30",
  "- 관련 준비 항목: 예식장",
].join("\n");

const actionInput = {
  title: "예식장 계약서 특약 확인",
  description: "취소 수수료와 보증 인원을 다시 확인해요.",
  due_date: "2026-09-30",
  category_key: "venue",
};
const actionIdentity = getAmoraToolOperationIdentity(
  "add_amora_action",
  actionInput,
);

function deriveConfirmedActionRequestId(
  userMessageId: string,
  confirmedActionId: string,
): string {
  const digest = createHash("sha256")
    .update(
      `amora-confirmed-action-request\0${userMessageId}\0${confirmedActionId}`,
      "utf8",
    )
    .digest("hex")
    .slice(0, 32)
    .split("");
  digest[12] = "5";
  digest[16] = "8";
  const value = digest.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

interface ApplicationRow {
  outcome: string;
  tool_result: Record<string, unknown>;
  message_id: string;
  message_created_at: Date;
  message_content: string;
  message_metadata: Record<string, unknown>;
  message_stage_tag: string | null;
  message_specialist_type: string | null;
  message_visibility: string;
  message_reused: boolean;
}

async function setServiceRole(db: PGlite) {
  await db.exec("SET ROLE service_role");
  await db.query(
    "SELECT set_config('request.jwt.claim.role', 'service_role', false), set_config('request.jwt.claim.sub', $1, false)",
    [BRIDE_ID],
  );
}

async function createDatabase() {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(`
    CREATE SCHEMA extensions;
    CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')::text
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
    CREATE TABLE public.amora_privacy_context_epochs (
      couple_id uuid PRIMARY KEY REFERENCES public.couples(id),
      epoch bigint NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.decision_nodes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      category text,
      decision_type text,
      title text,
      chosen_value jsonb,
      options_considered jsonb NOT NULL DEFAULT '[]'::jsonb,
      reasoning text,
      confidence numeric,
      stage_tag text,
      decided_at timestamptz,
      source text,
      source_ref_id uuid,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      visibility text NOT NULL,
      source_actor_role text,
      user_confirmed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
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
    CREATE TABLE public.ai_interactions_log (
      id uuid PRIMARY KEY,
      amora_claim_token uuid NOT NULL,
      couple_id uuid NOT NULL,
      user_id uuid NOT NULL,
      amora_cost_status text NOT NULL,
      amora_call_source text NOT NULL,
      amora_call_phase text NOT NULL,
      amora_request_key text NOT NULL,
      amora_call_index integer NOT NULL,
      success boolean
    );
    CREATE TABLE public.amora_chat_request_claims (
      couple_id uuid NOT NULL,
      request_key text NOT NULL,
      user_id uuid NOT NULL,
      visibility text NOT NULL,
      status text NOT NULL,
      user_message_id uuid,
      message_id uuid,
      claimed_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,
      failed_at timestamptz,
      failure_code text,
      attempt_count integer NOT NULL DEFAULT 1,
      PRIMARY KEY (couple_id, request_key)
    );
    CREATE TABLE public.amora_shared_action_application_claims (
      couple_id uuid NOT NULL,
      source_message_id uuid NOT NULL,
      action_id uuid NOT NULL,
      claimed_by_user_id uuid NOT NULL,
      proposal_digest text NOT NULL,
      roster_fingerprint text NOT NULL,
      confirmation_message_id uuid,
      PRIMARY KEY (couple_id, source_message_id, action_id)
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
    CREATE UNIQUE INDEX amora_tool_executions_pending_action_unique
      ON public.amora_tool_executions(couple_id, pending_action_id)
      WHERE pending_action_id IS NOT NULL;
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
      dismissed_at timestamptz,
      first_use_promotion_id uuid,
      follow_up_revision bigint NOT NULL DEFAULT 1
    );
    CREATE FUNCTION public.amora_shared_action_context(
      p_action_id uuid,
      p_couple_id uuid,
      p_source_message_id uuid,
      p_user_id uuid,
      p_context_mode text,
      p_confirmation_message_id uuid
    ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = pg_catalog, public AS $$
    DECLARE
      v_pending jsonb;
      v_revision bigint;
    BEGIN
      PERFORM 1 FROM public.couples
      WHERE id = p_couple_id FOR UPDATE;
      IF NOT FOUND OR NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = p_user_id AND couple_id = p_couple_id
      ) THEN
        RAISE EXCEPTION 'AMORA_SHARED_ACTION_SCOPE_DENIED'
          USING ERRCODE = '42501';
      END IF;
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        'hanbang:amora-shared-action:' || p_couple_id::text || ':' || p_action_id::text,
        0
      ));
      SELECT message.metadata -> 'pending_amora_action',
             (message.metadata ->> 'pending_amora_action_journey_revision')::bigint
      INTO v_pending, v_revision
      FROM public.chat_messages AS message
      WHERE message.id = p_source_message_id
        AND message.couple_id = p_couple_id
        AND message.sender_id IS NULL
        AND message.sender_type = 'ai'
        AND message.role = 'assistant'
        AND message.visibility = 'shared'
      FOR SHARE;
      IF NOT FOUND
         OR v_pending ->> 'actionId' IS DISTINCT FROM p_action_id::text THEN
        RAISE EXCEPTION 'AMORA_SHARED_ACTION_PROPOSAL_INVALID'
          USING ERRCODE = '22023';
      END IF;
      RETURN jsonb_build_object(
        'actionId', p_action_id,
        'sourceMessageId', p_source_message_id,
        'tool', v_pending ->> 'tool',
        'input', v_pending -> 'input',
        'inputDigest', v_pending ->> 'inputDigest',
        'operationKey', v_pending ->> 'operationKey',
        'journeyRevision', v_revision,
        'policy', 'single',
        'proposalDigest', repeat('c', 64),
        'rosterFingerprint', md5('${BRIDE_ID}:${GROOM_ID}'),
        'requiredCount', 2,
        'partnerLinked', true
      );
    END
    $$;

    CREATE FUNCTION public.authorize_amora_shared_action_execution(
      p_action_id uuid,
      p_couple_id uuid,
      p_source_message_id uuid,
      p_confirmation_message_id uuid,
      p_user_id uuid
    ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = pg_catalog, public AS $$
    DECLARE
      v_context jsonb;
      v_claim public.amora_shared_action_application_claims%ROWTYPE;
    BEGIN
      IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'AMORA_SHARED_ACTION_SERVICE_ROLE_REQUIRED'
          USING ERRCODE = '42501';
      END IF;
      v_context := public.amora_shared_action_context(
        p_action_id, p_couple_id, p_source_message_id, p_user_id,
        'execution', p_confirmation_message_id
      );
      SELECT claim.* INTO v_claim
      FROM public.amora_shared_action_application_claims AS claim
      WHERE claim.couple_id = p_couple_id
        AND claim.source_message_id = p_source_message_id
        AND claim.action_id = p_action_id
      FOR UPDATE;
      IF NOT FOUND
         OR v_claim.claimed_by_user_id IS DISTINCT FROM p_user_id
         OR v_claim.confirmation_message_id IS DISTINCT FROM p_confirmation_message_id THEN
        RAISE EXCEPTION 'AMORA_SHARED_ACTION_APPLICATION_CLAIM_INVALID'
          USING ERRCODE = '55000';
      END IF;
      RETURN v_context || jsonb_build_object(
        'authorized', true, 'ready', true, 'approvalMode', 'single'
      );
    END
    $$;

    CREATE FUNCTION public.claim_amora_tool_execution(
      p_couple_id uuid,
      p_request_key text,
      p_operation_key text,
      p_tool_name text,
      p_input_digest text,
      p_request_attempt_count integer,
      p_pending_action_id uuid,
      p_provider_call_index integer
    ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = pg_catalog, public AS $$
    DECLARE
      v_request public.amora_chat_request_claims%ROWTYPE;
      v_execution public.amora_tool_executions%ROWTYPE;
      v_revision bigint;
    BEGIN
      SELECT claim.* INTO v_request
      FROM public.amora_chat_request_claims AS claim
      WHERE claim.couple_id = p_couple_id
        AND claim.request_key = p_request_key
      FOR UPDATE;
      IF NOT FOUND OR v_request.status IS DISTINCT FROM 'processing'
         OR v_request.attempt_count IS DISTINCT FROM p_request_attempt_count THEN
        RETURN jsonb_build_object('action', 'stale_attempt');
      END IF;
      SELECT execution.* INTO v_execution
      FROM public.amora_tool_executions AS execution
      WHERE execution.couple_id = p_couple_id
        AND execution.pending_action_id = p_pending_action_id
      FOR UPDATE;
      IF FOUND THEN
        IF v_execution.request_key IS DISTINCT FROM p_request_key
           OR v_execution.operation_key IS DISTINCT FROM p_operation_key
           OR v_execution.tool_name IS DISTINCT FROM p_tool_name
           OR v_execution.input_digest IS DISTINCT FROM p_input_digest THEN
          RETURN jsonb_build_object('action', 'conflict');
        END IF;
        IF v_execution.status = 'completed' THEN
          RETURN jsonb_build_object('action', 'completed', 'result', v_execution.result);
        END IF;
        RETURN jsonb_build_object('action', 'in_progress');
      END IF;
      SELECT (source.metadata ->> 'pending_amora_action_journey_revision')::bigint
      INTO v_revision
      FROM public.amora_shared_action_application_claims AS application
      JOIN public.chat_messages AS source
        ON source.id = application.source_message_id
       AND source.couple_id = application.couple_id
      WHERE application.couple_id = p_couple_id
        AND application.action_id = p_pending_action_id
        AND application.confirmation_message_id = v_request.user_message_id;
      IF v_revision IS NULL OR p_provider_call_index IS NOT NULL THEN
        RETURN jsonb_build_object('action', 'stale_context');
      END IF;
      INSERT INTO public.amora_tool_executions(
        couple_id, request_key, operation_key, tool_name, input_digest,
        status, pending_action_id, pending_action_journey_revision
      ) VALUES (
        p_couple_id, p_request_key, p_operation_key, p_tool_name,
        p_input_digest, 'processing', p_pending_action_id, v_revision
      );
      RETURN jsonb_build_object('action', 'acquired');
    END
    $$;

    CREATE FUNCTION public.apply_amora_atomic_tool_execution(
      p_couple_id uuid,
      p_request_key text,
      p_operation_key text,
      p_request_attempt_count integer,
      p_input_digest text,
      p_tool_input jsonb,
      p_domain_mutation jsonb,
      p_result jsonb
    ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = pg_catalog, public AS $$
    DECLARE
      v_execution public.amora_tool_executions%ROWTYPE;
      v_action public.amora_actions%ROWTYPE;
      v_action_input jsonb := p_domain_mutation -> 'action';
      v_effective_result jsonb;
    BEGIN
      SELECT execution.* INTO v_execution
      FROM public.amora_tool_executions AS execution
      WHERE execution.couple_id = p_couple_id
        AND execution.request_key = p_request_key
        AND execution.operation_key = p_operation_key
      FOR UPDATE;
      IF NOT FOUND OR v_execution.input_digest IS DISTINCT FROM p_input_digest THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_TOOL_EXECUTION_MISMATCH'
          USING ERRCODE = '23514';
      END IF;
      IF v_execution.status = 'completed' THEN
        RETURN v_execution.result;
      END IF;
      PERFORM set_config(
        'hanbang.amora_shared_action_couple_id', p_couple_id::text, true
      );
      PERFORM set_config(
        'hanbang.amora_shared_action_request_key', p_request_key, true
      );
      PERFORM set_config(
        'hanbang.amora_shared_action_operation_key', p_operation_key, true
      );
      PERFORM set_config(
        'hanbang.amora_shared_action_action_id',
        v_execution.pending_action_id::text,
        true
      );
      PERFORM set_config(
        'hanbang.amora_shared_action_expected_revision',
        v_execution.pending_action_journey_revision::text,
        true
      );
      INSERT INTO public.amora_actions(
        id, couple_id, title, description, due_date, category_key,
        priority, status, source, href, metadata, created_by
      ) VALUES (
        v_action_input ->> 'id', p_couple_id,
        v_action_input ->> 'title', v_action_input ->> 'description',
        v_action_input ->> 'dueDate', v_action_input ->> 'categoryKey',
        v_action_input ->> 'priority', v_action_input ->> 'status',
        v_action_input ->> 'source', v_action_input ->> 'href', '{}'::jsonb, NULL
      ) RETURNING * INTO v_action;
      PERFORM set_config('hanbang.amora_shared_action_couple_id', '', true);
      PERFORM set_config('hanbang.amora_shared_action_request_key', '', true);
      PERFORM set_config('hanbang.amora_shared_action_operation_key', '', true);
      PERFORM set_config('hanbang.amora_shared_action_action_id', '', true);
      PERFORM set_config('hanbang.amora_shared_action_expected_revision', '', true);
      v_effective_result := jsonb_set(
        p_result,
        ARRAY['toolOutput'],
        jsonb_build_object('action', jsonb_strip_nulls(jsonb_build_object(
          'id', v_action.id,
          'title', v_action.title,
          'description', v_action.description,
          'dueDate', v_action.due_date,
          'categoryKey', v_action.category_key,
          'priority', v_action.priority,
          'status', v_action.status,
          'source', v_action.source,
          'href', v_action.href,
          'createdAt', v_action.created_at,
          'updatedAt', v_action.updated_at,
          'completedAt', v_action.completed_at
        )))
      );
      UPDATE public.amora_tool_executions
      SET status = 'completed', result = v_effective_result
      WHERE couple_id = p_couple_id
        AND request_key = p_request_key
        AND operation_key = p_operation_key
        AND status = 'processing';
      IF NOT FOUND THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_TOOL_COMPLETION_RACE'
          USING ERRCODE = '40001';
      END IF;
      RETURN v_effective_result;
    END
    $$;

    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.role() TO PUBLIC;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
    GRANT EXECUTE ON FUNCTION public.amora_shared_action_context(uuid,uuid,uuid,uuid,text,uuid) TO service_role;
    GRANT EXECUTE ON FUNCTION public.authorize_amora_shared_action_execution(uuid,uuid,uuid,uuid,uuid) TO service_role;
    GRANT EXECUTE ON FUNCTION public.claim_amora_tool_execution(uuid,text,text,text,text,integer,uuid,integer) TO service_role;
    GRANT EXECUTE ON FUNCTION public.apply_amora_atomic_tool_execution(uuid,text,text,integer,text,jsonb,jsonb,jsonb) TO service_role;

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
      id, couple_id, category, decision_type, title, chosen_value,
      options_considered, reasoning, confidence, decided_at, source,
      source_ref_id, metadata, visibility, source_actor_role,
      user_confirmed_at, created_at, updated_at
    ) VALUES (
      '${COUPLE_CRITERION_DECISION_ID}', '${COUPLE_ID}',
      'preference', 'decided', '우리 기준',
      jsonb_build_object('value', '${COUPLE_CRITERION_VALUE}'),
      '[]'::jsonb, '두 사람이 직접 확인한 기준', 1.00,
      '2026-08-16T02:00:00.000Z', 'manual', gen_random_uuid(),
      jsonb_build_object(
        'criterion_contract', 'amora_couple_core_criterion_v1',
        'criterion_version', 1,
        'bride_user_id', '${BRIDE_ID}',
        'groom_user_id', '${GROOM_ID}',
        'acceptance_count', 2,
        'explicit', true
      ),
      'shared', NULL, '2026-08-16T02:00:00.000Z',
      '2026-08-16T02:00:00.000Z', '2026-08-16T02:00:00.000Z'
    );
  `);
  await db.exec(readFileSync(coupleCriterionMigrationPath, "utf8"));
  if (existsSync(migrationPath)) {
    await db.exec(readFileSync(migrationPath, "utf8"));
  }
  if (existsSync(topicCriterionContextMigrationPath)) {
    await db.exec(readFileSync(topicCriterionContextMigrationPath, "utf8"));
  }
  return db;
}

async function prepareApplication(db: PGlite) {
  const issuedAt = Date.parse("2026-08-16T03:00:00.000Z");
  const sourceRequestKey = `chat:${BRIDE_ID}:${SOURCE_REQUEST_ID}`;
  const pendingAction = {
    version: 2,
    actionId: PENDING_ACTION_ID,
    tool: "add_amora_action",
    input: actionInput,
    inputDigest: actionIdentity.inputDigest,
    operationKey: actionIdentity.operationKey,
    confirmation: SOURCE_CONFIRMATION,
    issuedAt,
    expiresAt: issuedAt + 600_000,
  };
  await db.query(`
    INSERT INTO public.chat_messages(
      id, couple_id, sender_id, sender_type, sender_role, role,
      content, metadata, visibility, created_at
    ) VALUES
      ($1::uuid, $2::uuid, $3::uuid, 'bride', NULL, 'user',
       '예식장 계약서 특약을 나중에 확인하도록 저장해줘',
       jsonb_build_object('client_request_id', $4::uuid),
       'shared', '2026-08-16T02:59:59.000Z'),
      ($5::uuid, $2::uuid, NULL, 'ai', NULL, 'assistant',
       $6, jsonb_build_object(
         'client_request_id', $7::text,
         'in_reply_to_user_message_id', $1::uuid,
         'question_scope', 'W0_wedding_core',
         'memory_eligible', false,
         'memory_enqueue_requested', false,
         'amora_wedding_context_revision', 7,
         'amora_couple_criterion_decision_id', $9::uuid,
         'pending_amora_action', $8::jsonb,
         'pending_amora_action_journey_revision', 7,
         'amora_add_action_proposal_origin_v1', 'ordinary_provider'
       ), 'shared', '2026-08-16T03:00:00.000Z')
  `, [
    SOURCE_USER_MESSAGE_ID,
    COUPLE_ID,
    BRIDE_ID,
    SOURCE_REQUEST_ID,
    SOURCE_PROPOSAL_MESSAGE_ID,
    SOURCE_CONFIRMATION,
    sourceRequestKey,
    JSON.stringify(pendingAction),
    COUPLE_CRITERION_DECISION_ID,
  ]);
  await db.query(`
    INSERT INTO public.amora_chat_request_claims(
      couple_id, request_key, user_id, visibility, status,
      user_message_id, message_id, completed_at, attempt_count
    ) VALUES (
      $1::uuid, $2, $3::uuid, 'shared', 'completed',
      $4::uuid, $5::uuid, now(), 1
    )
  `, [
    COUPLE_ID,
    sourceRequestKey,
    BRIDE_ID,
    SOURCE_USER_MESSAGE_ID,
    SOURCE_PROPOSAL_MESSAGE_ID,
  ]);
  await db.query(`
    INSERT INTO public.ai_interactions_log(
      id, amora_claim_token, couple_id, user_id, amora_cost_status,
      amora_call_source, amora_call_phase, amora_request_key,
      amora_call_index, success
    ) VALUES (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'settled',
      'durable', 'tool_round', $5, 1, true
    )
  `, [
    SOURCE_RECEIPT_ID,
    SOURCE_RECEIPT_TOKEN,
    COUPLE_ID,
    BRIDE_ID,
    sourceRequestKey,
  ]);
  await db.query(`
    INSERT INTO public.amora_shared_action_application_claims(
      couple_id, source_message_id, action_id, claimed_by_user_id,
      proposal_digest, roster_fingerprint, confirmation_message_id
    ) VALUES (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid,
      repeat('c', 64), md5($4::text || ':application'), $5::uuid
    )
  `, [
    COUPLE_ID,
    SOURCE_PROPOSAL_MESSAGE_ID,
    PENDING_ACTION_ID,
    BRIDE_ID,
    CONFIRMATION_MESSAGE_ID,
  ]);
  await db.query(`
    INSERT INTO public.chat_messages(
      id, couple_id, sender_id, sender_type, sender_role, role,
      content, metadata, visibility, created_at
    ) VALUES (
      $1::uuid, $2::uuid, $3::uuid, 'bride', NULL, 'user',
      $4, jsonb_build_object(
        'client_request_id', $5::uuid,
        'confirmed_amora_action_id', $6::uuid,
        'amora_ingest_contract_version', 2,
        'ai_response_requested', true,
        'provider_attachment_state', 'none',
        'provider_attachment_count', 0
      ), 'shared', '2026-08-16T03:00:01.000Z'
    )
  `, [
    CONFIRMATION_MESSAGE_ID,
    COUPLE_ID,
    BRIDE_ID,
    CONFIRMATION_CONTENT,
    CONFIRMATION_REQUEST_ID,
    PENDING_ACTION_ID,
  ]);
  const applicationRequestId = deriveConfirmedActionRequestId(
    CONFIRMATION_MESSAGE_ID,
    PENDING_ACTION_ID,
  );
  const applicationRequestKey = `chat:${BRIDE_ID}:${applicationRequestId}`;
  await db.query(`
    INSERT INTO public.amora_chat_request_claims(
      couple_id, request_key, user_id, visibility, status,
      user_message_id, attempt_count
    ) VALUES (
      $1::uuid, $2, $3::uuid, 'shared', 'processing', $4::uuid, 2
    )
  `, [
    COUPLE_ID,
    applicationRequestKey,
    BRIDE_ID,
    CONFIRMATION_MESSAGE_ID,
  ]);
  return { applicationRequestId, applicationRequestKey };
}

async function replacePendingActionInput(
  db: PGlite,
  input: Record<string, unknown>,
) {
  const identity = getAmoraToolOperationIdentity("add_amora_action", input);
  await db.query(`
    UPDATE public.chat_messages
    SET metadata = jsonb_set(
      jsonb_set(
        jsonb_set(
          metadata,
          '{pending_amora_action,input}',
          $1::jsonb
        ),
        '{pending_amora_action,inputDigest}',
        to_jsonb($2::text)
      ),
      '{pending_amora_action,operationKey}',
      to_jsonb($3::text)
    )
    WHERE id = $4::uuid
  `, [
    JSON.stringify(input),
    identity.inputDigest,
    identity.operationKey,
    SOURCE_PROPOSAL_MESSAGE_ID,
  ]);
  return identity;
}

async function replacePendingActionInputWithSqlGeneratedNonBmp(
  db: PGlite,
  field: "title" | "description" | "href",
) {
  await db.exec("RESET ROLE");
  try {
    await db.query(`
    WITH candidate AS (
      SELECT CASE $1::text
        WHEN 'title' THEN jsonb_build_object(
          'title', repeat(chr(128512), 61),
          'category_key', 'venue'
        )
        WHEN 'description' THEN jsonb_build_object(
          'title', 'portable title',
          'description', repeat(chr(128512), 251),
          'category_key', 'venue'
        )
        WHEN 'href' THEN jsonb_build_object(
          'title', 'portable title',
          'category_key', 'venue',
          'href', '/' || repeat(chr(128512), 90)
        )
      END AS input
    ), canonical AS (
      SELECT candidate.input,
             '{' || string_agg(
               to_jsonb(entry.key)::text || ':' || entry.value::text,
               ',' ORDER BY entry.key
             ) || '}' AS input_text
      FROM candidate
      CROSS JOIN LATERAL jsonb_each(candidate.input) AS entry
      GROUP BY candidate.input
    ), identity AS (
      SELECT input,
             encode(
               extensions.digest(convert_to(input_text, 'UTF8'), 'sha256'),
               'hex'
             ) AS input_digest,
             encode(
               extensions.digest(
                 convert_to('add_amora_action' || chr(10) || input_text, 'UTF8'),
                 'sha256'
               ),
               'hex'
             ) AS operation_key
      FROM canonical
    )
    UPDATE public.chat_messages
    SET metadata = jsonb_set(
      jsonb_set(
        jsonb_set(
          metadata,
          '{pending_amora_action,input}',
          identity.input
        ),
        '{pending_amora_action,inputDigest}',
        to_jsonb(identity.input_digest)
      ),
      '{pending_amora_action,operationKey}',
      to_jsonb(identity.operation_key)
    )
    FROM identity
    WHERE public.chat_messages.id = $2::uuid
    `, [field, SOURCE_PROPOSAL_MESSAGE_ID]);
  } finally {
    await setServiceRole(db);
  }
}

async function finalizeApplication(
  db: PGlite,
  requestKey: string,
  attemptCount = 2,
  expectedPrivacyEpoch = 11,
) {
  return db.query<ApplicationRow>(`
    SELECT *
    FROM public.finalize_amora_provider_backed_add_action_application_v1(
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7
    )
  `, [
    COUPLE_ID,
    BRIDE_ID,
    SOURCE_PROPOSAL_MESSAGE_ID,
    CONFIRMATION_MESSAGE_ID,
    requestKey,
    attemptCount,
    expectedPrivacyEpoch,
  ]);
}

async function readApplicationSideEffects(db: PGlite, requestKey: string) {
  return (await db.query<{
    actions: number;
    executions: number;
    assistants: number;
    claim_status: string;
  }>(`
    SELECT
      (SELECT count(*)::integer FROM public.amora_actions) AS actions,
      (SELECT count(*)::integer FROM public.amora_tool_executions) AS executions,
      (SELECT count(*)::integer FROM public.chat_messages
       WHERE metadata ->> 'response_origin' =
         'server_authoritative_provider_backed_add_action_application') AS assistants,
      (SELECT status FROM public.amora_chat_request_claims
       WHERE request_key = $1) AS claim_status
  `, [requestKey])).rows[0]!;
}

describe("provider-backed ordinary add-action application migration", () => {
  it("seals the current couple criterion context on the exact categorized action", async () => {
    const db = await createDatabase();
    try {
      await setServiceRole(db);
      const prepared = await prepareApplication(db);
      await finalizeApplication(db, prepared.applicationRequestKey);

      const action = (await db.query<{
        metadata: Record<string, unknown>;
        follow_up_revision: number;
      }>(`
        SELECT metadata, follow_up_revision
        FROM public.amora_actions
      `)).rows[0]!;
      expect(action.follow_up_revision).toBe(1);
      expect(action.metadata).toEqual({
        amora_topic_criterion_context_v1: {
          version: 1,
          scope: "couple",
          criterionDecisionId: COUPLE_CRITERION_DECISION_ID,
          topicKey: "venue",
          affects: "action",
          sourceMessageId: SOURCE_PROPOSAL_MESSAGE_ID,
          sourceJourneyRevision: 7,
          actionRevision: 1,
        },
      });
    } finally {
      await db.close();
    }
  });

  it("keeps the approved action but omits personalization when the criterion changed or disappeared", async () => {
    for (const mutation of [
      `INSERT INTO public.decision_nodes(
         id, couple_id, category, decision_type, title, chosen_value,
         reasoning, confidence, decided_at, source, source_ref_id, metadata,
         visibility, source_actor_role, user_confirmed_at, created_at, updated_at
       ) VALUES (
         '70000000-0000-4000-8000-000000000099', '${COUPLE_ID}',
         'preference', 'decided', '바뀐 우리 기준',
         '{"value":"가까운 이동을 먼저 봐요"}'::jsonb,
         '두 사람이 직접 확인한 새 기준', 1.00,
         '2026-08-16T02:30:00.000Z', 'manual', gen_random_uuid(),
         jsonb_build_object(
           'criterion_contract', 'amora_couple_core_criterion_v1',
           'criterion_version', 1,
           'bride_user_id', '${BRIDE_ID}',
           'groom_user_id', '${GROOM_ID}',
           'acceptance_count', 2,
           'explicit', true
         ),
         'shared', NULL, '2026-08-16T02:30:00.000Z',
         '2026-08-16T02:30:00.000Z', '2026-08-16T02:30:00.000Z'
       )`,
      `DELETE FROM public.decision_nodes
       WHERE id = '${COUPLE_CRITERION_DECISION_ID}'`,
    ]) {
      const db = await createDatabase();
      try {
        await setServiceRole(db);
        const prepared = await prepareApplication(db);
        await db.exec(mutation);
        await finalizeApplication(db, prepared.applicationRequestKey);

        const action = (await db.query<{ metadata: Record<string, unknown> }>(`
          SELECT metadata FROM public.amora_actions
        `)).rows[0]!;
        expect(action.metadata).toEqual({});
        expect(await readApplicationSideEffects(
          db,
          prepared.applicationRequestKey,
        )).toMatchObject({
          actions: 1,
          executions: 1,
          assistants: 1,
          claim_status: "completed",
        });
      } finally {
        await db.close();
      }
    }
  });

  it("rejects injected or rewritten topic criterion context receipts", async () => {
    const db = await createDatabase();
    try {
      await setServiceRole(db);
      await expect(db.exec(`
        INSERT INTO public.amora_actions(
          id, couple_id, title, category_key, metadata
        ) VALUES (
          'act_injected_context', '${COUPLE_ID}', '위조 행동', 'venue',
          jsonb_build_object(
            'amora_topic_criterion_context_v1',
            jsonb_build_object('version', 1)
          )
        )
      `)).rejects.toMatchObject({ code: "42501" });

      const prepared = await prepareApplication(db);
      await finalizeApplication(db, prepared.applicationRequestKey);
      await expect(db.exec(`
        UPDATE public.amora_actions
        SET metadata = metadata - 'amora_topic_criterion_context_v1'
      `)).rejects.toMatchObject({ code: "23514" });

      const stored = await db.query<{ criterion_id: string | null }>(`
        SELECT metadata #>>
          '{amora_topic_criterion_context_v1,criterionDecisionId}'
          AS criterion_id
        FROM public.amora_actions
      `);
      expect(stored.rows[0]?.criterion_id).toBe(COUPLE_CRITERION_DECISION_ID);
    } finally {
      await db.close();
    }
  });

  it("atomically applies one sealed ordinary provider proposal without another provider receipt", async () => {
    const db = await createDatabase();
    try {
      await setServiceRole(db);
      const prepared = await prepareApplication(db);
      const result = await finalizeApplication(db, prepared.applicationRequestKey);
      expect(result.rows).toHaveLength(1);
      const committed = result.rows[0]!;
      const expectedActionId =
        `act_${prepared.applicationRequestId.replaceAll("-", "")}_${actionIdentity.operationKey.slice(0, 24)}`;
      expect(committed).toMatchObject({
        outcome: "persisted",
        message_content:
          `"${actionInput.title}"을 아모라 행동 카드로 저장했어요.`,
        message_stage_tag: null,
        message_specialist_type: "general",
        message_visibility: "shared",
        message_reused: false,
        tool_result: {
          toolName: "add_amora_action",
          toolInput: actionInput,
          success: true,
          displayMessage:
            `"${actionInput.title}"을 아모라 행동 카드로 저장했어요.`,
          toolOutput: {
            action: {
              id: expectedActionId,
              title: actionInput.title,
              description: actionInput.description,
              dueDate: actionInput.due_date,
              categoryKey: actionInput.category_key,
              priority: "medium",
              status: "open",
              source: "chat",
              href: "/wedding/lounge",
            },
          },
        },
      });
      expect(Object.keys(committed.message_metadata).sort()).toEqual([
        "amora_wedding_context_revision",
        "client_request_id",
        "client_visible_request_id",
        "confirmed_amora_action_id",
        "in_reply_to_user_message_id",
        "memory_eligible",
        "memory_enqueue_requested",
        "persistence_terminal_source",
        "provider_call_count",
        "question_scope",
        "response_origin",
        "source_amora_action_message_id",
        "toolResults",
        "toolsUsed",
      ].sort());
      expect(committed.message_metadata).toMatchObject({
        client_request_id: prepared.applicationRequestKey,
        client_visible_request_id:
          `chat:${BRIDE_ID}:${CONFIRMATION_REQUEST_ID}`,
        in_reply_to_user_message_id: CONFIRMATION_MESSAGE_ID,
        confirmed_amora_action_id: PENDING_ACTION_ID,
        source_amora_action_message_id: SOURCE_PROPOSAL_MESSAGE_ID,
        question_scope: "W0_wedding_core",
        memory_eligible: false,
        memory_enqueue_requested: false,
        amora_wedding_context_revision: 7,
        toolsUsed: ["add_amora_action"],
        persistence_terminal_source: "server_mutation_receipts",
        response_origin:
          "server_authoritative_provider_backed_add_action_application",
        provider_call_count: 0,
      });
      const state = await db.query<{
        actions: number;
        executions: number;
        assistants: number;
        provider_receipts: number;
        claim_status: string;
      }>(`
        SELECT
          (SELECT count(*)::integer FROM public.amora_actions) AS actions,
          (SELECT count(*)::integer FROM public.amora_tool_executions) AS executions,
          (SELECT count(*)::integer FROM public.chat_messages
           WHERE metadata ->> 'response_origin' =
             'server_authoritative_provider_backed_add_action_application') AS assistants,
          (SELECT count(*)::integer FROM public.ai_interactions_log) AS provider_receipts,
          (SELECT status FROM public.amora_chat_request_claims
           WHERE request_key = $1) AS claim_status
      `, [prepared.applicationRequestKey]);
      expect(state.rows[0]).toEqual({
        actions: 1,
        executions: 1,
        assistants: 1,
        provider_receipts: 1,
        claim_status: "completed",
      });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("exactly replays the immutable receipt after later action and context changes", async () => {
    const db = await createDatabase();
    try {
      await setServiceRole(db);
      const prepared = await prepareApplication(db);
      const first = (await finalizeApplication(
        db,
        prepared.applicationRequestKey,
      )).rows[0]!;
      await db.exec(`
        UPDATE public.amora_actions
        SET title = '나중에 바꾼 제목', status = 'done', updated_at = now()
        WHERE couple_id = '${COUPLE_ID}';
        UPDATE public.amora_privacy_context_epochs
        SET epoch = 12
        WHERE couple_id = '${COUPLE_ID}';
        UPDATE public.wedding_journeys
        SET state_revision = 8
        WHERE couple_id = '${COUPLE_ID}';
      `);

      const replay = (await finalizeApplication(
        db,
        prepared.applicationRequestKey,
      )).rows[0]!;
      expect(replay).toEqual({
        ...first,
        outcome: "replayed",
        message_reused: true,
      });
      const counts = await db.query<{
        actions: number;
        executions: number;
        assistants: number;
        provider_receipts: number;
      }>(`
        SELECT
          (SELECT count(*)::integer FROM public.amora_actions) AS actions,
          (SELECT count(*)::integer FROM public.amora_tool_executions) AS executions,
          (SELECT count(*)::integer FROM public.chat_messages
           WHERE metadata ->> 'response_origin' =
             'server_authoritative_provider_backed_add_action_application') AS assistants,
          (SELECT count(*)::integer FROM public.ai_interactions_log) AS provider_receipts
      `);
      expect(counts.rows[0]).toEqual({
        actions: 1,
        executions: 1,
        assistants: 1,
        provider_receipts: 1,
      });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("rejects a forged W1 source even when the ordinary-provider seal is present", async () => {
    const db = await createDatabase();
    try {
      await setServiceRole(db);
      const prepared = await prepareApplication(db);
      await db.exec(`
        UPDATE public.chat_messages
        SET metadata = jsonb_set(
          metadata,
          '{question_scope}',
          '"W1_wedding_adjacent"'::jsonb
        )
        WHERE id = '${SOURCE_PROPOSAL_MESSAGE_ID}';
      `);
      await expect(
        finalizeApplication(db, prepared.applicationRequestKey),
      ).rejects.toMatchObject({ code: "23514" });
      const counts = await db.query<{
        actions: number;
        executions: number;
        assistants: number;
      }>(`
        SELECT
          (SELECT count(*)::integer FROM public.amora_actions) AS actions,
          (SELECT count(*)::integer FROM public.amora_tool_executions) AS executions,
          (SELECT count(*)::integer FROM public.chat_messages
           WHERE metadata ->> 'response_origin' =
             'server_authoritative_provider_backed_add_action_application') AS assistants
      `);
      expect(counts.rows[0]).toEqual({
        actions: 0,
        executions: 0,
        assistants: 0,
      });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("rejects absent or conflicting origin markers and any unproven source receipt", async () => {
    const sourceMetadataMutations = [
      "metadata - 'amora_add_action_proposal_origin_v1'",
      "jsonb_set(metadata, '{amora_add_action_proposal_origin_v1}', '\"wrong\"'::jsonb)",
      "jsonb_set(metadata, '{amora_first_use_grounding}', '{}'::jsonb)",
      "jsonb_set(metadata, '{amora_first_use_action_promotion_v1}', '{}'::jsonb)",
      "jsonb_set(metadata, '{amora_first_use_promotion_id}', '\"70000000-0000-4000-8000-000000000001\"'::jsonb)",
      "jsonb_set(metadata, '{amora_schedule_care_follow_up_v1}', '{}'::jsonb)",
      "jsonb_set(metadata, '{amora_schedule_care_action_draft_v1}', '{}'::jsonb)",
      "jsonb_set(metadata, '{response_origin}', '\"provider\"'::jsonb)",
      "jsonb_set(metadata, '{provider_call_count}', '1'::jsonb)",
      "jsonb_set(metadata, '{persistence_terminal_source}', '\"provider\"'::jsonb)",
    ];
    const cases: Array<{
      name: string;
      mutate: (db: PGlite) => Promise<unknown>;
    }> = sourceMetadataMutations.map((expression, index) => ({
      name: `source-metadata-${index}`,
      mutate: (db) => db.exec(`
        UPDATE public.chat_messages
        SET metadata = ${expression}
        WHERE id = '${SOURCE_PROPOSAL_MESSAGE_ID}'
      `),
    }));
    cases.push(
      {
        name: "missing-receipt",
        mutate: (db) => db.exec(
          `DELETE FROM public.ai_interactions_log WHERE id = '${SOURCE_RECEIPT_ID}'`,
        ),
      },
      {
        name: "unknown-receipt",
        mutate: (db) => db.exec(
          `UPDATE public.ai_interactions_log SET amora_cost_status = 'unknown' WHERE id = '${SOURCE_RECEIPT_ID}'`,
        ),
      },
      {
        name: "failed-receipt",
        mutate: (db) => db.exec(
          `UPDATE public.ai_interactions_log SET success = false WHERE id = '${SOURCE_RECEIPT_ID}'`,
        ),
      },
      {
        name: "later-failed-receipt",
        mutate: (db) => db.exec(`
          INSERT INTO public.ai_interactions_log(
            id, amora_claim_token, couple_id, user_id, amora_cost_status,
            amora_call_source, amora_call_phase, amora_request_key,
            amora_call_index, success
          ) SELECT
            '40000000-0000-4000-8000-000000000003'::uuid,
            '40000000-0000-4000-8000-000000000004'::uuid,
            couple_id, user_id, 'settled', amora_call_source,
            amora_call_phase, amora_request_key, 2, false
          FROM public.ai_interactions_log
          WHERE id = '${SOURCE_RECEIPT_ID}'
        `),
      },
      {
        name: "tied-latest-receipt",
        mutate: (db) => db.exec(`
          INSERT INTO public.ai_interactions_log(
            id, amora_claim_token, couple_id, user_id, amora_cost_status,
            amora_call_source, amora_call_phase, amora_request_key,
            amora_call_index, success
          ) SELECT
            '40000000-0000-4000-8000-000000000005'::uuid,
            '40000000-0000-4000-8000-000000000006'::uuid,
            couple_id, user_id, 'settled', amora_call_source,
            'final_no_tool', amora_request_key, amora_call_index, true
          FROM public.ai_interactions_log
          WHERE id = '${SOURCE_RECEIPT_ID}'
        `),
      },
    );

    for (const entry of cases) {
      const db = await createDatabase();
      try {
        await setServiceRole(db);
        const prepared = await prepareApplication(db);
        await entry.mutate(db);
        await expect(
          finalizeApplication(db, prepared.applicationRequestKey),
          entry.name,
        ).rejects.toMatchObject({ code: "23514" });
        expect(
          await readApplicationSideEffects(
            db,
            prepared.applicationRequestKey,
          ),
          entry.name,
        ).toEqual({
          actions: 0,
          executions: 0,
          assistants: 0,
          claim_status: "processing",
        });
      } finally {
        await db.close();
      }
    }
  }, 90_000);

  it("accepts the unique highest settled successful source provider receipt", async () => {
    const db = await createDatabase();
    try {
      await setServiceRole(db);
      const prepared = await prepareApplication(db);
      await db.exec(`
        INSERT INTO public.ai_interactions_log(
          id, amora_claim_token, couple_id, user_id, amora_cost_status,
          amora_call_source, amora_call_phase, amora_request_key,
          amora_call_index, success
        ) SELECT
          '40000000-0000-4000-8000-000000000007'::uuid,
          '40000000-0000-4000-8000-000000000008'::uuid,
          couple_id, user_id, 'settled', amora_call_source,
          'final_no_tool', amora_request_key, 2, true
        FROM public.ai_interactions_log
        WHERE id = '${SOURCE_RECEIPT_ID}'
      `);

      const committed = (await finalizeApplication(
        db,
        prepared.applicationRequestKey,
      )).rows[0]!;
      expect(committed.outcome).toBe("persisted");
      const counts = await db.query<{ receipts: number; actions: number }>(`
        SELECT
          (SELECT count(*)::integer FROM public.ai_interactions_log) AS receipts,
          (SELECT count(*)::integer FROM public.amora_actions) AS actions
      `);
      expect(counts.rows[0]).toEqual({ receipts: 2, actions: 1 });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("rejects a sealed proposal whose bound source request carried an attachment", async () => {
    const db = await createDatabase();
    try {
      await setServiceRole(db);
      const prepared = await prepareApplication(db);
      await db.exec(`
        UPDATE public.chat_messages
        SET metadata = metadata || jsonb_build_object(
          'imagePaths', jsonb_build_array('chat/example.jpg'),
          'amora_ingest_contract_version', 2,
          'ai_response_requested', true,
          'provider_attachment_state', 'present',
          'provider_attachment_count', 1,
          'provider_attachment_manifest', jsonb_build_array(
            jsonb_build_object('path', 'chat/example.jpg')
          )
        )
        WHERE id = '${SOURCE_USER_MESSAGE_ID}';
      `);
      await expect(
        finalizeApplication(db, prepared.applicationRequestKey),
      ).rejects.toMatchObject({ code: "23514" });
      expect(
        await readApplicationSideEffects(db, prepared.applicationRequestKey),
      ).toEqual({
        actions: 0,
        executions: 0,
        assistants: 0,
        claim_status: "processing",
      });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("keeps omitted mc and gift href inputs on the provider-backed path", async () => {
    for (const categoryKey of ["mc", "gift"]) {
      const db = await createDatabase();
      try {
        await setServiceRole(db);
        const prepared = await prepareApplication(db);
        await replacePendingActionInput(db, {
          title: `provider-only-${categoryKey}`,
          category_key: categoryKey,
        });

        await expect(
          finalizeApplication(db, prepared.applicationRequestKey),
          categoryKey,
        ).rejects.toMatchObject({ code: "23514" });
        expect(
          await readApplicationSideEffects(
            db,
            prepared.applicationRequestKey,
          ),
          categoryKey,
        ).toEqual({
          actions: 0,
          executions: 0,
          assistants: 0,
          claim_status: "processing",
        });
      } finally {
        await db.close();
      }
    }
  }, 30_000);

  it("accepts an explicit valid href for an mc action", async () => {
    const db = await createDatabase();
    try {
      await setServiceRole(db);
      const prepared = await prepareApplication(db);
      const explicitInput = {
        title: "provider-sealed-mc-action",
        category_key: "mc",
        href: "/wedding/chat",
      };
      await replacePendingActionInput(db, explicitInput);

      const committed = (await finalizeApplication(
        db,
        prepared.applicationRequestKey,
      )).rows[0]!;
      expect(committed.outcome).toBe("persisted");
      expect(committed.tool_result).toMatchObject({
        toolName: "add_amora_action",
        toolInput: explicitInput,
        toolOutput: {
          action: {
            categoryKey: "mc",
            href: "/wedding/chat",
          },
        },
        success: true,
      });
      expect(
        await readApplicationSideEffects(db, prepared.applicationRequestKey),
      ).toEqual({
        actions: 1,
        executions: 1,
        assistants: 1,
        claim_status: "completed",
      });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("rolls back the action, execution, and claim when assistant receipt insertion fails", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        CREATE FUNCTION public.reject_provider_backed_application_receipt()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          IF NEW.metadata ->> 'response_origin' =
             'server_authoritative_provider_backed_add_action_application' THEN
            RAISE EXCEPTION 'test receipt insertion failure';
          END IF;
          RETURN NEW;
        END
        $$;
        CREATE TRIGGER reject_provider_backed_application_receipt
        BEFORE INSERT ON public.chat_messages
        FOR EACH ROW
        EXECUTE FUNCTION public.reject_provider_backed_application_receipt();
      `);
      await setServiceRole(db);
      const prepared = await prepareApplication(db);

      await expect(
        finalizeApplication(db, prepared.applicationRequestKey),
      ).rejects.toMatchObject({ code: "P0001" });
      expect(
        await readApplicationSideEffects(db, prepared.applicationRequestKey),
      ).toEqual({
        actions: 0,
        executions: 0,
        assistants: 0,
        claim_status: "processing",
      });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("rolls back every write when final chat claim completion loses its lease", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        CREATE FUNCTION public.invalidate_application_claim_before_completion()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          IF NEW.metadata ->> 'response_origin' =
             'server_authoritative_provider_backed_add_action_application' THEN
            UPDATE public.amora_chat_request_claims
            SET attempt_count = attempt_count + 1
            WHERE couple_id = NEW.couple_id
              AND request_key = NEW.metadata ->> 'client_request_id';
          END IF;
          RETURN NEW;
        END
        $$;
        CREATE TRIGGER invalidate_application_claim_before_completion
        BEFORE INSERT ON public.chat_messages
        FOR EACH ROW
        EXECUTE FUNCTION public.invalidate_application_claim_before_completion();
      `);
      await setServiceRole(db);
      const prepared = await prepareApplication(db);

      await expect(
        finalizeApplication(db, prepared.applicationRequestKey),
      ).rejects.toMatchObject({ code: "40001" });
      expect(
        await readApplicationSideEffects(db, prepared.applicationRequestKey),
      ).toEqual({
        actions: 0,
        executions: 0,
        assistants: 0,
        claim_status: "processing",
      });
      const claim = await db.query<{ attempt_count: number }>(`
        SELECT attempt_count
        FROM public.amora_chat_request_claims
        WHERE couple_id = $1::uuid AND request_key = $2
      `, [COUPLE_ID, prepared.applicationRequestKey]);
      expect(claim.rows[0]!.attempt_count).toBe(2);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("fails closed when an immutable replay receipt is tampered", async () => {
    const mutations = [
      `UPDATE public.chat_messages
       SET content = content || ' tampered'
       WHERE metadata ->> 'response_origin' =
         'server_authoritative_provider_backed_add_action_application'`,
      `UPDATE public.chat_messages
       SET metadata = jsonb_set(metadata, '{provider_call_count}', '1'::jsonb)
       WHERE metadata ->> 'response_origin' =
         'server_authoritative_provider_backed_add_action_application'`,
      `UPDATE public.amora_tool_executions
       SET result = jsonb_set(
         result,
         '{toolOutput,action,title}',
         '"tampered"'::jsonb
       )`,
    ];

    for (const mutation of mutations) {
      const db = await createDatabase();
      try {
        await setServiceRole(db);
        const prepared = await prepareApplication(db);
        await finalizeApplication(db, prepared.applicationRequestKey);
        await db.exec(mutation);

        await expect(
          finalizeApplication(db, prepared.applicationRequestKey),
        ).rejects.toMatchObject({ code: "55000" });
        const counts = await db.query<{
          actions: number;
          executions: number;
          assistants: number;
        }>(`
          SELECT
            (SELECT count(*)::integer FROM public.amora_actions) AS actions,
            (SELECT count(*)::integer FROM public.amora_tool_executions) AS executions,
            (SELECT count(*)::integer FROM public.chat_messages
             WHERE metadata ->> 'response_origin' =
               'server_authoritative_provider_backed_add_action_application') AS assistants
        `);
        expect(counts.rows[0]).toEqual({
          actions: 1,
          executions: 1,
          assistants: 1,
        });
      } finally {
        await db.close();
      }
    }
  }, 60_000);

  it("revalidates immutable source, confirmation, and provider proof on replay", async () => {
    const mutations = [
      `UPDATE public.chat_messages
       SET metadata = metadata - 'amora_add_action_proposal_origin_v1'
       WHERE id = '${SOURCE_PROPOSAL_MESSAGE_ID}'`,
      `UPDATE public.chat_messages
       SET content = content || ' tampered'
       WHERE id = '${CONFIRMATION_MESSAGE_ID}'`,
      `UPDATE public.ai_interactions_log
       SET success = false
       WHERE id = '${SOURCE_RECEIPT_ID}'`,
    ];

    for (const mutation of mutations) {
      const db = await createDatabase();
      try {
        await setServiceRole(db);
        const prepared = await prepareApplication(db);
        await finalizeApplication(db, prepared.applicationRequestKey);
        await db.exec(mutation);

        await expect(
          finalizeApplication(db, prepared.applicationRequestKey),
        ).rejects.toMatchObject({ code: "23514" });
        expect(
          await readApplicationSideEffects(
            db,
            prepared.applicationRequestKey,
          ),
        ).toEqual({
          actions: 1,
          executions: 1,
          assistants: 1,
          claim_status: "completed",
        });
      } finally {
        await db.close();
      }
    }
  }, 60_000);

  it("freezes the service-only RPC contract and provider-free lock order", async () => {
    const db = await createDatabase();
    try {
      const contract = await db.query<{
        input_names: string[];
        output_names: string[];
        owner_name: string;
        security_definer: boolean;
        config: string[];
        definition: string;
        anon_execute: boolean;
        authenticated_execute: boolean;
        service_execute: boolean;
      }>(`
        SELECT procedure.proargnames[1:7] AS input_names,
               procedure.proargnames[8:17] AS output_names,
               pg_get_userbyid(procedure.proowner) AS owner_name,
               procedure.prosecdef AS security_definer,
               procedure.proconfig AS config,
               pg_get_functiondef(procedure.oid) AS definition,
               has_function_privilege('anon', procedure.oid, 'EXECUTE')
                 AS anon_execute,
               has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
                 AS authenticated_execute,
               has_function_privilege('service_role', procedure.oid, 'EXECUTE')
                 AS service_execute
        FROM pg_proc AS procedure
        WHERE procedure.oid =
          'public.finalize_amora_provider_backed_add_action_application_v1(uuid,uuid,uuid,uuid,text,integer,bigint)'::regprocedure
      `);
      expect(contract.rows).toHaveLength(1);
      const frozen = contract.rows[0]!;
      expect(frozen).toMatchObject({
        input_names: [
          "p_couple_id",
          "p_actor_user_id",
          "p_source_proposal_message_id",
          "p_confirmation_message_id",
          "p_chat_request_key",
          "p_chat_claim_attempt_count",
          "p_expected_privacy_epoch",
        ],
        output_names: [
          "outcome",
          "tool_result",
          "message_id",
          "message_created_at",
          "message_content",
          "message_metadata",
          "message_stage_tag",
          "message_specialist_type",
          "message_visibility",
          "message_reused",
        ],
        owner_name: "postgres",
        security_definer: true,
        config: [
          "search_path=pg_catalog, public",
          "lock_timeout=5s",
          "statement_timeout=15s",
        ],
        anon_execute: false,
        authenticated_execute: false,
        service_execute: true,
      });

      const definition = frozen.definition.replace(/\s+/g, " ");
      const claimLock = definition.indexOf(
        "FROM public.amora_chat_request_claims AS claim",
      );
      const contextLockChain = definition.indexOf(
        "v_context := public.amora_shared_action_context(",
      );
      const privacyLock = definition.indexOf(
        "FROM public.amora_privacy_context_epochs AS privacy",
      );
      const journeyLock = definition.indexOf(
        "FROM public.wedding_journeys AS journey",
      );
      const authorization = definition.indexOf(
        "v_authorization := public.authorize_amora_shared_action_execution(",
      );
      const toolClaim = definition.indexOf(
        "v_tool_claim := public.claim_amora_tool_execution(",
      );
      const toolApply = definition.indexOf(
        "v_durable_result := public.apply_amora_atomic_tool_execution(",
      );
      const assistantInsert = definition.indexOf(
        "INSERT INTO public.chat_messages(",
      );
      const claimCompletion = definition.indexOf(
        "UPDATE public.amora_chat_request_claims AS claim",
      );
      expect([
        claimLock,
        contextLockChain,
        privacyLock,
        journeyLock,
        authorization,
        toolClaim,
        toolApply,
        assistantInsert,
        claimCompletion,
      ].every((position) => position >= 0)).toBe(true);
      expect(claimLock).toBeLessThan(contextLockChain);
      expect(contextLockChain).toBeLessThan(privacyLock);
      expect(privacyLock).toBeLessThan(journeyLock);
      expect(journeyLock).toBeLessThan(authorization);
      expect(authorization).toBeLessThan(toolClaim);
      expect(toolClaim).toBeLessThan(toolApply);
      expect(toolApply).toBeLessThan(assistantInsert);
      expect(assistantInsert).toBeLessThan(claimCompletion);
      expect(definition).not.toContain("INSERT INTO public.ai_interactions_log");
      expect(definition).not.toContain("prepare_amora_provider_call_receipt");
      expect(definition).not.toContain("finalize_amora_provider_call_receipt");

      await db.exec("SET ROLE authenticated");
      await db.query(
        "SELECT set_config('request.jwt.claim.role', 'authenticated', false)",
      );
      await expect(db.query(`
        SELECT *
        FROM public.finalize_amora_provider_backed_add_action_application_v1(
          '${COUPLE_ID}'::uuid,
          '${BRIDE_ID}'::uuid,
          '${SOURCE_PROPOSAL_MESSAGE_ID}'::uuid,
          '${CONFIRMATION_MESSAGE_ID}'::uuid,
          'chat:${BRIDE_ID}:${CONFIRMATION_REQUEST_ID}',
          1,
          1
        )
      `)).rejects.toThrow(/permission denied/i);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("freezes the non-callable criterion context trigger boundary", async () => {
    const db = await createDatabase();
    try {
      const contract = await db.query<{
        owner_name: string;
        security_definer: boolean;
        config: string[];
        definition: string;
        anon_execute: boolean;
        authenticated_execute: boolean;
        service_execute: boolean;
        trigger_count: number;
      }>(`
        SELECT pg_get_userbyid(procedure.proowner) AS owner_name,
               procedure.prosecdef AS security_definer,
               procedure.proconfig AS config,
               pg_get_functiondef(procedure.oid) AS definition,
               has_function_privilege('anon', procedure.oid, 'EXECUTE')
                 AS anon_execute,
               has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
                 AS authenticated_execute,
               has_function_privilege('service_role', procedure.oid, 'EXECUTE')
                 AS service_execute,
               (
                 SELECT count(*)::integer
                 FROM pg_trigger AS trigger
                 WHERE trigger.tgrelid = 'public.amora_actions'::regclass
                   AND trigger.tgname =
                     'trg_seal_amora_topic_criterion_action_context_v1'
                   AND NOT trigger.tgisinternal
               ) AS trigger_count
        FROM pg_proc AS procedure
        WHERE procedure.oid =
          'public.seal_amora_topic_criterion_action_context_v1()'::regprocedure
      `);
      expect(contract.rows).toHaveLength(1);
      expect(contract.rows[0]).toMatchObject({
        owner_name: "postgres",
        security_definer: true,
        config: [
          "search_path=pg_catalog, public",
          "lock_timeout=5s",
          "statement_timeout=15s",
        ],
        anon_execute: false,
        authenticated_execute: false,
        service_execute: false,
        trigger_count: 1,
      });
      const definition = contract.rows[0]!.definition.replace(/\s+/g, " ");
      expect(definition).toContain(
        "public.read_amora_couple_core_criterion_v1(",
      );
      expect(definition).toContain(
        "AMORA_TOPIC_CRITERION_ACTION_CONTEXT_IMMUTABLE",
      );
      expect(definition).toContain(
        "AMORA_TOPIC_CRITERION_ACTION_CONTEXT_INJECTION",
      );
      expect(definition).not.toContain("current,value");
      expect(readFileSync(topicCriterionContextMigrationPath, "utf8"))
        .toContain(
          "FROM PUBLIC, anon, authenticated, service_role",
        );
    } finally {
      await db.close();
    }
  });

  it("accepts only the immediate exact attachment-free confirmation", async () => {
    const cases: Array<{
      name: string;
      mutate: (db: PGlite) => Promise<unknown>;
    }> = [
      {
        name: "mixed-content",
        mutate: (db) => db.exec(`
          UPDATE public.chat_messages
          SET content = content || ' 그리고 다른 것도 해 주세요.'
          WHERE id = '${CONFIRMATION_MESSAGE_ID}'
        `),
      },
      {
        name: "legacy-confirmation-sender-role",
        mutate: (db) => db.exec(`
          UPDATE public.chat_messages
          SET sender_role = 'bride'
          WHERE id = '${CONFIRMATION_MESSAGE_ID}'
        `),
      },
      {
        name: "wrong-action-id",
        mutate: (db) => db.exec(`
          UPDATE public.chat_messages
          SET metadata = jsonb_set(
            metadata,
            '{confirmed_amora_action_id}',
            '"60000000-0000-4000-8000-000000000099"'::jsonb
          )
          WHERE id = '${CONFIRMATION_MESSAGE_ID}'
        `),
      },
      {
        name: "extra-metadata",
        mutate: (db) => db.exec(`
          UPDATE public.chat_messages
          SET metadata = metadata || '{"unexpected":true}'::jsonb
          WHERE id = '${CONFIRMATION_MESSAGE_ID}'
        `),
      },
      {
        name: "attachment",
        mutate: (db) => db.exec(`
          UPDATE public.chat_messages
          SET metadata = metadata || jsonb_build_object(
            'imagePaths', jsonb_build_array('chat/confirmation.jpg'),
            'provider_attachment_state', 'present',
            'provider_attachment_count', 1
          )
          WHERE id = '${CONFIRMATION_MESSAGE_ID}'
        `),
      },
      {
        name: "not-immediate",
        mutate: (db) => db.exec(`
          INSERT INTO public.chat_messages(
            id, couple_id, sender_id, sender_type, sender_role, role,
            content, metadata, visibility, created_at
          ) VALUES (
            '30000000-0000-4000-8000-000000000004'::uuid,
            '${COUPLE_ID}'::uuid,
            '${GROOM_ID}'::uuid,
            'groom', 'groom', 'user', 'interposed', '{}'::jsonb,
            'shared', '2026-08-16T03:00:00.500Z'
          )
        `),
      },
    ];

    for (const entry of cases) {
      const db = await createDatabase();
      try {
        await setServiceRole(db);
        const prepared = await prepareApplication(db);
        await entry.mutate(db);

        await expect(
          finalizeApplication(db, prepared.applicationRequestKey),
          entry.name,
        ).rejects.toMatchObject({ code: "23514" });
        expect(
          await readApplicationSideEffects(
            db,
            prepared.applicationRequestKey,
          ),
          entry.name,
        ).toEqual({
          actions: 0,
          executions: 0,
          assistants: 0,
          claim_status: "processing",
        });
      } finally {
        await db.close();
      }
    }
  }, 90_000);

  it("requires the source completed claim and its exact message bindings", async () => {
    const sourceRequestKey = `chat:${BRIDE_ID}:${SOURCE_REQUEST_ID}`;
    const cases: Array<{
      name: string;
      mutate: (db: PGlite) => Promise<unknown>;
    }> = [
      {
        name: "missing-source-claim",
        mutate: (db) => db.query(
          "DELETE FROM public.amora_chat_request_claims WHERE request_key = $1",
          [sourceRequestKey],
        ),
      },
      {
        name: "unfinished-source-claim",
        mutate: (db) => db.query(`
          UPDATE public.amora_chat_request_claims
          SET status = 'processing', completed_at = NULL
          WHERE request_key = $1
        `, [sourceRequestKey]),
      },
      {
        name: "wrong-source-message-binding",
        mutate: (db) => db.query(`
          UPDATE public.amora_chat_request_claims
          SET message_id = $2::uuid
          WHERE request_key = $1
        `, [sourceRequestKey, CONFIRMATION_MESSAGE_ID]),
      },
      {
        name: "wrong-source-user-binding",
        mutate: (db) => db.query(`
          UPDATE public.amora_chat_request_claims
          SET user_message_id = $2::uuid
          WHERE request_key = $1
        `, [sourceRequestKey, CONFIRMATION_MESSAGE_ID]),
      },
      {
        name: "wrong-source-reply-binding",
        mutate: (db) => db.exec(`
          UPDATE public.chat_messages
          SET metadata = jsonb_set(
            metadata,
            '{in_reply_to_user_message_id}',
            '"${CONFIRMATION_MESSAGE_ID}"'::jsonb
          )
          WHERE id = '${SOURCE_PROPOSAL_MESSAGE_ID}'
        `),
      },
      {
        name: "legacy-source-user-sender-role",
        mutate: (db) => db.exec(`
          UPDATE public.chat_messages
          SET sender_role = 'bride'
          WHERE id = '${SOURCE_USER_MESSAGE_ID}'
        `),
      },
      {
        name: "wrong-source-user-request-id",
        mutate: (db) => db.exec(`
          UPDATE public.chat_messages
          SET metadata = jsonb_set(
            metadata,
            '{client_request_id}',
            '"50000000-0000-4000-8000-000000000099"'::jsonb
          )
          WHERE id = '${SOURCE_USER_MESSAGE_ID}'
        `),
      },
    ];

    for (const entry of cases) {
      const db = await createDatabase();
      try {
        await setServiceRole(db);
        const prepared = await prepareApplication(db);
        await entry.mutate(db);

        await expect(
          finalizeApplication(db, prepared.applicationRequestKey),
          entry.name,
        ).rejects.toMatchObject({ code: "23514" });
        expect(
          await readApplicationSideEffects(
            db,
            prepared.applicationRequestKey,
          ),
          entry.name,
        ).toEqual({
          actions: 0,
          executions: 0,
          assistants: 0,
          claim_status: "processing",
        });
      } finally {
        await db.close();
      }
    }
  }, 90_000);

  it("fails stale application leases, privacy epochs, and journey snapshots before writes", async () => {
    const cases: Array<{
      name: string;
      mutate?: (db: PGlite, requestKey: string) => Promise<unknown>;
      attemptCount?: number;
      expectedClaimStatus: string;
    }> = [
      {
        name: "stale-attempt",
        attemptCount: 1,
        expectedClaimStatus: "processing",
      },
      {
        name: "failed-claim",
        mutate: (db, requestKey) => db.query(`
          UPDATE public.amora_chat_request_claims
          SET status = 'failed', failed_at = now(), failure_code = 'test'
          WHERE request_key = $1
        `, [requestKey]),
        expectedClaimStatus: "failed",
      },
      {
        name: "missing-privacy-epoch",
        mutate: (db) => db.exec(`
          DELETE FROM public.amora_privacy_context_epochs
          WHERE couple_id = '${COUPLE_ID}'
        `),
        expectedClaimStatus: "processing",
      },
      {
        name: "stale-privacy-epoch",
        mutate: (db) => db.exec(`
          UPDATE public.amora_privacy_context_epochs
          SET epoch = 12
          WHERE couple_id = '${COUPLE_ID}'
        `),
        expectedClaimStatus: "processing",
      },
      {
        name: "stale-journey-revision",
        mutate: (db) => db.exec(`
          UPDATE public.wedding_journeys
          SET state_revision = 8
          WHERE couple_id = '${COUPLE_ID}'
        `),
        expectedClaimStatus: "processing",
      },
    ];

    for (const entry of cases) {
      const db = await createDatabase();
      try {
        await setServiceRole(db);
        const prepared = await prepareApplication(db);
        if (entry.mutate) {
          await entry.mutate(db, prepared.applicationRequestKey);
        }

        await expect(
          finalizeApplication(
            db,
            prepared.applicationRequestKey,
            entry.attemptCount,
          ),
          entry.name,
        ).rejects.toMatchObject({ code: "40001" });
        expect(
          await readApplicationSideEffects(
            db,
            prepared.applicationRequestKey,
          ),
          entry.name,
        ).toEqual({
          actions: 0,
          executions: 0,
          assistants: 0,
          claim_status: entry.expectedClaimStatus,
        });
      } finally {
        await db.close();
      }
    }
  }, 90_000);

  it("rejects every non-ASCII cross-runtime whitespace drift in title and description before writes", async () => {
    const db = await createDatabase();
    const codePoints = [
      0x0085,
      0x00a0,
      0x1680,
      0x2000,
      0x2001,
      0x2002,
      0x2003,
      0x2004,
      0x2005,
      0x2006,
      0x2007,
      0x2008,
      0x2009,
      0x200a,
      0x2028,
      0x2029,
      0x202f,
      0x205f,
      0x3000,
      0xfeff,
    ];
    try {
      await setServiceRole(db);
      const prepared = await prepareApplication(db);

      for (const field of ["title", "description"] as const) {
        for (const codePoint of codePoints) {
          const drift = String.fromCodePoint(codePoint);
          await replacePendingActionInput(db, {
            title: field === "title" ? `A${drift}B` : "portable title",
            description:
              field === "description" ? `A${drift}B` : "portable description",
            category_key: "venue",
          });
          await expect(
            finalizeApplication(db, prepared.applicationRequestKey),
            `${field}-U+${codePoint.toString(16).toUpperCase()}`,
          ).rejects.toMatchObject({ code: "23514" });
          expect(
            await readApplicationSideEffects(
              db,
              prepared.applicationRequestKey,
            ),
          ).toEqual({
            actions: 0,
            executions: 0,
            assistants: 0,
            claim_status: "processing",
          });
        }
      }
    } finally {
      await db.close();
    }
  }, 90_000);

  it("normalizes shared portable ASCII whitespace exactly", async () => {
    const db = await createDatabase();
    try {
      await setServiceRole(db);
      const prepared = await prepareApplication(db);
      const rawInput = {
        title: "  Alpha\r\n\tBeta  ",
        description: "  Details\t here  ",
        category_key: "venue",
      };
      await replacePendingActionInput(db, rawInput);

      const committed = (await finalizeApplication(
        db,
        prepared.applicationRequestKey,
      )).rows[0]!;
      expect(committed.tool_result).toMatchObject({
        toolInput: rawInput,
        toolOutput: {
          action: {
            title: "Alpha Beta",
            description: "Details here",
          },
        },
        displayMessage: '"Alpha Beta"을 아모라 행동 카드로 저장했어요.',
      });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("rejects portable whitespace edges where the private dispatcher and route differ", async () => {
    const db = await createDatabase();
    try {
      await setServiceRole(db);
      const prepared = await prepareApplication(db);
      const cases = [
        { title: "\tAlpha", description: "portable" },
        { title: "portable", description: "Beta\n" },
      ];

      for (const input of cases) {
        await replacePendingActionInput(db, input);
        await expect(
          finalizeApplication(db, prepared.applicationRequestKey),
        ).rejects.toMatchObject({ code: "23514" });
        expect(
          await readApplicationSideEffects(
            db,
            prepared.applicationRequestKey,
          ),
        ).toEqual({
          actions: 0,
          executions: 0,
          assistants: 0,
          claim_status: "processing",
        });
      }
    } finally {
      await db.close();
    }
  }, 30_000);

  it("rejects SQL-generated non-BMP input before UTF-16 length drift can commit", async () => {
    const db = await createDatabase();
    try {
      await setServiceRole(db);
      const prepared = await prepareApplication(db);

      for (const field of ["title", "description", "href"] as const) {
        await replacePendingActionInputWithSqlGeneratedNonBmp(db, field);
        await expect(
          finalizeApplication(db, prepared.applicationRequestKey),
          field,
        ).rejects.toMatchObject({ code: "23514" });
        expect(
          await readApplicationSideEffects(
            db,
            prepared.applicationRequestKey,
          ),
          field,
        ).toEqual({
          actions: 0,
          executions: 0,
          assistants: 0,
          claim_status: "processing",
        });
      }
    } finally {
      await db.close();
    }
  }, 30_000);

  it("keeps exact omitted tool input while deriving the complete default action shape", async () => {
    const db = await createDatabase();
    try {
      await setServiceRole(db);
      const prepared = await prepareApplication(db);
      const minimalInput = { title: "minimal action" };
      const identity = await replacePendingActionInput(db, minimalInput);
      const expectedActionId =
        `act_${prepared.applicationRequestId.replaceAll("-", "")}_${identity.operationKey.slice(0, 24)}`;

      const committed = (await finalizeApplication(
        db,
        prepared.applicationRequestKey,
      )).rows[0]!;
      expect(committed.tool_result).toEqual({
        toolName: "add_amora_action",
        toolInput: minimalInput,
        toolOutput: {
          action: {
            id: expectedActionId,
            title: "minimal action",
            description: null,
            dueDate: null,
            categoryKey: null,
            priority: "medium",
            status: "open",
            source: "chat",
            href: "/wedding/lounge",
          },
        },
        success: true,
        displayMessage: '"minimal action"을 아모라 행동 카드로 저장했어요.',
      });
      expect(Object.keys(
        (committed.tool_result.toolOutput as {
          action: Record<string, unknown>;
        }).action,
      ).sort()).toEqual([
        "categoryKey",
        "description",
        "dueDate",
        "href",
        "id",
        "priority",
        "source",
        "status",
        "title",
      ].sort());
    } finally {
      await db.close();
    }
  }, 30_000);
});
