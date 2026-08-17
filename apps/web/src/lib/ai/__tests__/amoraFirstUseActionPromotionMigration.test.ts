// @vitest-environment node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { describe, expect, it } from "vitest";
import { resolveAmoraPendingAction } from "@/lib/ai/amoraPendingAction";
import { getAmoraToolOperationIdentity } from "@/lib/ai/amoraToolIdentity";
import type { AiToolDefinition } from "@/lib/ai/toolDefinition";

const migrationSql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260815130000_amora_first_use_action_promotions.sql",
  ),
  "utf8",
);
const deterministicProposalMigrationSql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260816130000_amora_first_use_deterministic_proposal.sql",
  ),
  "utf8",
);
const deterministicApplicationMigrationSql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260816140000_amora_first_use_deterministic_application.sql",
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
const PROPOSAL_REQUEST_ID = "50000000-0000-4000-8000-000000000004";
const PROPOSAL_MESSAGE_ID = "60000000-0000-4000-8000-000000000001";
const CONFIRMATION_MESSAGE_ID = "60000000-0000-4000-8000-000000000002";
const PENDING_ACTION_ID = "70000000-0000-4000-8000-000000000001";
const APPLICATION_CONFIRMATION_CONTENT = "좋아요. 제안한 변경을 적용해 주세요.";

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

const actionIdentity = getAmoraToolOperationIdentity(
  "add_amora_action",
  canonicalAddActionInput,
);
const OPERATION_KEY = actionIdentity.operationKey;
const ACTION_DIGEST = actionIdentity.inputDigest;

const firstUseBoundActionTool: AiToolDefinition = {
  name: "add_amora_action",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      description: { type: "string" },
      category_key: { type: "string", const: "general" },
      priority: { type: "string", const: "medium" },
      source: { type: "string", const: "chat" },
    },
    required: ["title", "description", "category_key", "priority", "source"],
    "x-amora-bound-input": canonicalAddActionInput,
  },
};

const sharedContent = [
  "나만 상담에서 정리한 다음 한 가지를 둘이 볼 실행 카드로 제안해줘.",
  `지금 할 한 가지: ${canonicalActionInput.action}`,
  `이유: ${canonicalActionInput.reason}`,
  `완료 기준: ${canonicalActionInput.completionCriterion}`,
  "저장 전에 확인 카드만 보여줘.",
].join("\n");

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

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

async function createDatabase() {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(`
    CREATE SCHEMA extensions;
    CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
  `);
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
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
      message_id uuid,
      claimed_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,
      failed_at timestamptz,
      failure_code text,
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

    CREATE FUNCTION public.authorize_amora_shared_action_execution(
      p_action_id uuid,
      p_couple_id uuid,
      p_source_message_id uuid,
      p_confirmation_message_id uuid,
      p_user_id uuid
    ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = pg_catalog, public AS $$
    DECLARE
      v_claim public.amora_shared_action_application_claims%ROWTYPE;
    BEGIN
      IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'AMORA_SHARED_ACTION_SERVICE_ROLE_REQUIRED'
          USING ERRCODE = '42501';
      END IF;
      SELECT claim.* INTO v_claim
      FROM public.amora_shared_action_application_claims AS claim
      WHERE claim.couple_id = p_couple_id
        AND claim.source_message_id = p_source_message_id
        AND claim.action_id = p_action_id
      FOR UPDATE;
      IF NOT FOUND
         OR v_claim.claimed_by_user_id IS DISTINCT FROM p_user_id
         OR v_claim.confirmation_message_id
           IS DISTINCT FROM p_confirmation_message_id THEN
        RAISE EXCEPTION 'AMORA_SHARED_ACTION_APPLICATION_CLAIM_INVALID'
          USING ERRCODE = '55000';
      END IF;
      RETURN public.amora_shared_action_context(
        p_action_id,
        p_couple_id,
        p_source_message_id,
        p_user_id,
        'execution',
        p_confirmation_message_id
      ) || jsonb_build_object('authorized', true, 'ready', true);
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
      IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'AMORA_TOOL_CLAIM_SERVICE_ROLE_REQUIRED'
          USING ERRCODE = '42501';
      END IF;
      SELECT claim.* INTO v_request
      FROM public.amora_chat_request_claims AS claim
      WHERE claim.couple_id = p_couple_id
        AND claim.request_key = p_request_key
      FOR UPDATE;
      IF NOT FOUND
         OR v_request.status IS DISTINCT FROM 'processing'
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
          RETURN jsonb_build_object(
            'action', 'completed', 'result', v_execution.result
          );
        END IF;
        RETURN jsonb_build_object('action', 'in_progress');
      END IF;
      SELECT NULLIF(
               source.metadata ->> 'pending_amora_action_journey_revision',
               ''
             )::bigint
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
      IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_TOOL_SERVICE_ROLE_REQUIRED'
          USING ERRCODE = '42501';
      END IF;
      SELECT execution.* INTO v_execution
      FROM public.amora_tool_executions AS execution
      WHERE execution.couple_id = p_couple_id
        AND execution.request_key = p_request_key
        AND execution.operation_key = p_operation_key
      FOR UPDATE;
      IF NOT FOUND
         OR v_execution.input_digest IS DISTINCT FROM p_input_digest THEN
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
        v_action_input ->> 'id',
        p_couple_id,
        v_action_input ->> 'title',
        v_action_input ->> 'description',
        v_action_input ->> 'dueDate',
        v_action_input ->> 'categoryKey',
        v_action_input ->> 'priority',
        v_action_input ->> 'status',
        v_action_input ->> 'source',
        v_action_input ->> 'href',
        '{}'::jsonb,
        NULL
      ) RETURNING * INTO v_action;
      v_effective_result := jsonb_set(
        p_result,
        ARRAY['toolOutput'],
        jsonb_build_object(
          'action',
          jsonb_strip_nulls(jsonb_build_object(
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
          ))
        )
      );
      UPDATE public.amora_tool_executions AS execution
      SET status = 'completed', result = v_effective_result
      WHERE execution.couple_id = p_couple_id
        AND execution.request_key = p_request_key
        AND execution.operation_key = p_operation_key
        AND execution.status = 'processing';
      IF NOT FOUND THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_TOOL_COMPLETION_RACE'
          USING ERRCODE = '40001';
      END IF;
      RETURN v_effective_result;
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
  await db.exec(deterministicProposalMigrationSql);
  await db.exec(deterministicApplicationMigrationSql);
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

interface DeterministicProposalRow {
  outcome: string;
  message_id: string;
  message_created_at: Date;
  message_content: string;
  message_metadata: Record<string, unknown>;
  message_stage_tag: string | null;
  message_specialist_type: string | null;
  message_visibility: string;
  message_reused: boolean;
}

interface DeterministicApplicationRow {
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

async function insertProposalClaim(input: {
  db: PGlite;
  sharedMessageId: string;
  requestId: string;
  attemptCount?: number;
}) {
  const requestKey = `chat:${BRIDE_ID}:${input.requestId}`;
  await input.db.query(`
    INSERT INTO public.amora_chat_request_claims(
      couple_id, request_key, user_id, visibility, status,
      user_message_id, attempt_count
    ) VALUES (
      $1::uuid, $2, $3::uuid, 'shared', 'processing', $4::uuid, $5::integer
    )
  `, [
    COUPLE_ID,
    requestKey,
    BRIDE_ID,
    input.sharedMessageId,
    input.attemptCount ?? 1,
  ]);
  return requestKey;
}

async function finalizeDeterministicProposal(input: {
  db: PGlite;
  sharedMessageId: string;
  requestKey: string;
  attemptCount?: number;
  expectedPrivacyEpoch?: number;
}) {
  return input.db.query<DeterministicProposalRow>(`
    SELECT *
    FROM public.finalize_amora_first_use_action_proposal_v1(
      $1::uuid, $2::uuid, $3::uuid, $4, $5::integer, $6::bigint
    )
  `, [
    COUPLE_ID,
    BRIDE_ID,
    input.sharedMessageId,
    input.requestKey,
    input.attemptCount ?? 1,
    input.expectedPrivacyEpoch ?? 11,
  ]);
}

async function prepareDeterministicApplication(db: PGlite) {
  const promoted = await ingest(db, FIRST_REQUEST_ID);
  const proposalRequestKey = await insertProposalClaim({
    db,
    sharedMessageId: String(promoted.sharedMessageId),
    requestId: PROPOSAL_REQUEST_ID,
  });
  const proposal = (await finalizeDeterministicProposal({
    db,
    sharedMessageId: String(promoted.sharedMessageId),
    requestKey: proposalRequestKey,
  })).rows[0]!;
  const pending = proposal.message_metadata.pending_amora_action as
    Record<string, unknown>;
  const pendingActionId = String(pending.actionId);

  await db.query("SELECT pg_sleep(0.025)");
  await db.query(`
    INSERT INTO public.amora_shared_action_application_claims(
      couple_id, source_message_id, action_id, claimed_by_user_id,
      proposal_digest, roster_fingerprint, confirmation_message_id
    ) VALUES (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid,
      $5, md5($4::text || ':application'), NULL
    )
  `, [
    COUPLE_ID,
    proposal.message_id,
    pendingActionId,
    BRIDE_ID,
    "c".repeat(64),
  ]);
  await db.query(`
    INSERT INTO public.chat_messages(
      id, couple_id, sender_id, sender_type, sender_role, role,
      content, metadata, visibility
    ) VALUES (
      $1::uuid, $2::uuid, $3::uuid, 'bride', 'bride', 'user',
      $4, jsonb_build_object(
        'client_request_id', $5::uuid,
        'confirmed_amora_action_id', $6::uuid
      ), 'shared'
    )
  `, [
    CONFIRMATION_MESSAGE_ID,
    COUPLE_ID,
    BRIDE_ID,
    APPLICATION_CONFIRMATION_CONTENT,
    CONFIRMATION_REQUEST_ID,
    pendingActionId,
  ]);
  await db.query(`
    UPDATE public.amora_shared_action_application_claims
    SET confirmation_message_id = $1::uuid
    WHERE couple_id = $2::uuid
      AND source_message_id = $3::uuid
      AND action_id = $4::uuid
  `, [
    CONFIRMATION_MESSAGE_ID,
    COUPLE_ID,
    proposal.message_id,
    pendingActionId,
  ]);

  const applicationRequestId = deriveConfirmedActionRequestId(
    CONFIRMATION_MESSAGE_ID,
    pendingActionId,
  );
  const applicationRequestKey = `chat:${BRIDE_ID}:${applicationRequestId}`;
  await db.query(`
    INSERT INTO public.amora_chat_request_claims(
      couple_id, request_key, user_id, visibility, status,
      user_message_id, attempt_count
    ) VALUES (
      $1::uuid, $2, $3::uuid, 'shared', 'processing', $4::uuid, 2
    )
  `, [COUPLE_ID, applicationRequestKey, BRIDE_ID, CONFIRMATION_MESSAGE_ID]);
  return {
    promoted,
    proposal,
    pendingActionId,
    applicationRequestId,
    applicationRequestKey,
  };
}

async function finalizeDeterministicApplication(input: {
  db: PGlite;
  proposalMessageId: string;
  requestKey: string;
  attemptCount?: number;
  expectedPrivacyEpoch?: number;
}) {
  return input.db.query<DeterministicApplicationRow>(`
    SELECT *
    FROM public.finalize_amora_first_use_action_application_v1(
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6::integer, $7::bigint
    )
  `, [
    COUPLE_ID,
    BRIDE_ID,
    input.proposalMessageId,
    CONFIRMATION_MESSAGE_ID,
    input.requestKey,
    input.attemptCount ?? 2,
    input.expectedPrivacyEpoch ?? 11,
  ]);
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

  it("atomically applies and exactly replays one provider-free first-use action", async () => {
    const db = await createDatabase();
    try {
      await db.exec("BEGIN");
      await setPersona(db, "service_role", BRIDE_ID);
      const prepared = await prepareDeterministicApplication(db);

      const first = await finalizeDeterministicApplication({
        db,
        proposalMessageId: prepared.proposal.message_id,
        requestKey: prepared.applicationRequestKey,
      });
      expect(first.rows).toHaveLength(1);
      const committed = first.rows[0]!;
      const expectedActionId =
        `act_${prepared.applicationRequestId.replaceAll("-", "")}_${OPERATION_KEY.slice(0, 24)}`;
      expect(committed).toMatchObject({
        outcome: "persisted",
        message_content:
          `"${canonicalAddActionInput.title}"을 아모라 행동 카드로 저장했어요.`,
        message_stage_tag: null,
        message_specialist_type: "general",
        message_visibility: "shared",
        message_reused: false,
        tool_result: {
          toolName: "add_amora_action",
          toolInput: canonicalAddActionInput,
          success: true,
          displayMessage:
            `"${canonicalAddActionInput.title}"을 아모라 행동 카드로 저장했어요.`,
          toolOutput: {
            action: {
              id: expectedActionId,
              title: canonicalAddActionInput.title,
              description: canonicalAddActionInput.description,
              priority: "medium",
              status: "open",
              source: "chat",
              href: "/wedding/lounge",
            },
          },
        },
      });
      const publicAction = (
        committed.tool_result.toolOutput as {
          action: Record<string, unknown>;
        }
      ).action;
      expect(publicAction).toEqual({
        id: expectedActionId,
        title: canonicalAddActionInput.title,
        description: canonicalAddActionInput.description,
        dueDate: null,
        categoryKey: null,
        priority: "medium",
        status: "open",
        source: "chat",
        href: "/wedding/lounge",
      });
      expect(Object.keys(committed.message_metadata).sort()).toEqual([
        "amora_first_use_promotion_id",
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
        "toolResults",
        "toolsUsed",
      ]);
      expect(committed.message_metadata).toMatchObject({
        client_request_id: prepared.applicationRequestKey,
        client_visible_request_id:
          `chat:${BRIDE_ID}:${CONFIRMATION_REQUEST_ID}`,
        in_reply_to_user_message_id: CONFIRMATION_MESSAGE_ID,
        confirmed_amora_action_id: prepared.pendingActionId,
        question_scope: "W0_wedding_core",
        memory_eligible: false,
        memory_enqueue_requested: false,
        amora_wedding_context_revision: 7,
        amora_first_use_promotion_id: prepared.promoted.promotionId,
        toolResults: [committed.tool_result],
        toolsUsed: ["add_amora_action"],
        persistence_terminal_source: "server_mutation_receipts",
        response_origin: "server_authoritative_first_use_action_application",
        provider_call_count: 0,
      });

      const durable = await db.query<{
        actions: number;
        executions: number;
        assistant_receipts: number;
        provider_rows: number;
        claim_status: string;
        first_use_promotion_id: string;
      }>(`
        SELECT
          (SELECT count(*)::integer FROM public.amora_actions) AS actions,
          (SELECT count(*)::integer FROM public.amora_tool_executions
            WHERE status = 'completed') AS executions,
          (SELECT count(*)::integer FROM public.chat_messages
            WHERE metadata ->> 'client_request_id' = $2) AS assistant_receipts,
          (SELECT count(*)::integer FROM public.ai_interactions_log) AS provider_rows,
          claim.status AS claim_status,
          action.first_use_promotion_id::text AS first_use_promotion_id
        FROM public.amora_chat_request_claims AS claim
        JOIN public.amora_actions AS action
          ON action.id = $3
        WHERE claim.couple_id = $1::uuid
          AND claim.request_key = $2
      `, [COUPLE_ID, prepared.applicationRequestKey, expectedActionId]);
      expect(durable.rows).toEqual([{
        actions: 1,
        executions: 1,
        assistant_receipts: 1,
        provider_rows: 0,
        claim_status: "completed",
        first_use_promotion_id: prepared.promoted.promotionId,
      }]);

      await db.exec(`
        UPDATE public.amora_actions
        SET title = '나중에 바꾼 행동 제목',
            status = 'completed',
            completed_at = clock_timestamp(),
            updated_at = clock_timestamp()
        WHERE id = '${expectedActionId}';
        UPDATE public.wedding_journeys SET state_revision = 8
        WHERE couple_id = '${COUPLE_ID}';
        UPDATE public.amora_privacy_context_epochs SET epoch = 12
        WHERE couple_id = '${COUPLE_ID}';
      `);
      const replay = await finalizeDeterministicApplication({
        db,
        proposalMessageId: prepared.proposal.message_id,
        requestKey: prepared.applicationRequestKey,
      });
      expect(replay.rows).toEqual([{
        ...committed,
        outcome: "replayed",
        message_reused: true,
      }]);
      const replayCounts = await db.query<{
        actions: number;
        executions: number;
        assistant_receipts: number;
        provider_rows: number;
      }>(`
        SELECT
          (SELECT count(*)::integer FROM public.amora_actions) AS actions,
          (SELECT count(*)::integer FROM public.amora_tool_executions)
            AS executions,
          (SELECT count(*)::integer FROM public.chat_messages
            WHERE metadata ->> 'client_request_id' = $1)
            AS assistant_receipts,
          (SELECT count(*)::integer FROM public.ai_interactions_log)
            AS provider_rows
      `, [prepared.applicationRequestKey]);
      expect(replayCounts.rows).toEqual([{
        actions: 1,
        executions: 1,
        assistant_receipts: 1,
        provider_rows: 0,
      }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.exec("ROLLBACK").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rejects a forged deterministic proposal before any application write", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role", BRIDE_ID);
      const prepared = await prepareDeterministicApplication(db);
      await db.query(`
        UPDATE public.chat_messages
        SET metadata = metadata || '{"forged_server_authority":true}'::jsonb
        WHERE id = $1::uuid
      `, [prepared.proposal.message_id]);

      await expect(finalizeDeterministicApplication({
        db,
        proposalMessageId: prepared.proposal.message_id,
        requestKey: prepared.applicationRequestKey,
      })).rejects.toThrow(/AMORA_FIRST_USE_ACTION_APPLICATION_PROPOSAL_MISMATCH/);

      const unchanged = await db.query<{
        actions: number;
        executions: number;
        provider_rows: number;
        claim_status: string;
      }>(`
        SELECT
          (SELECT count(*)::integer FROM public.amora_actions) AS actions,
          (SELECT count(*)::integer FROM public.amora_tool_executions)
            AS executions,
          (SELECT count(*)::integer FROM public.ai_interactions_log)
            AS provider_rows,
          claim.status AS claim_status
        FROM public.amora_chat_request_claims AS claim
        WHERE claim.couple_id = $1::uuid
          AND claim.request_key = $2
      `, [COUPLE_ID, prepared.applicationRequestKey]);
      expect(unchanged.rows).toEqual([{
        actions: 0,
        executions: 0,
        provider_rows: 0,
        claim_status: "processing",
      }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it.each([
    [
      "provider provenance",
      "metadata = jsonb_set(metadata, '{provider_call_count}', '1'::jsonb)",
    ],
    [
      "memory policy",
      "metadata = jsonb_set(metadata, '{memory_eligible}', 'true'::jsonb)",
    ],
    [
      "journey revision",
      "metadata = jsonb_set(metadata, '{amora_wedding_context_revision}', '8'::jsonb)",
    ],
    [
      "visible confirmation content",
      "content = content || ' 위조'",
    ],
  ])("rejects changed deterministic source %s", async (_label, mutation) => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role", BRIDE_ID);
      const prepared = await prepareDeterministicApplication(db);
      await db.exec(`
        UPDATE public.chat_messages
        SET ${mutation}
        WHERE id = '${prepared.proposal.message_id}'
      `);

      await expect(finalizeDeterministicApplication({
        db,
        proposalMessageId: prepared.proposal.message_id,
        requestKey: prepared.applicationRequestKey,
      })).rejects.toThrow(/AMORA_FIRST_USE_ACTION_APPLICATION_PROPOSAL_MISMATCH/);
      const unchanged = await db.query<{
        actions: number;
        executions: number;
        provider_rows: number;
        claim_status: string;
      }>(`
        SELECT
          (SELECT count(*)::integer FROM public.amora_actions) AS actions,
          (SELECT count(*)::integer FROM public.amora_tool_executions)
            AS executions,
          (SELECT count(*)::integer FROM public.ai_interactions_log)
            AS provider_rows,
          claim.status AS claim_status
        FROM public.amora_chat_request_claims AS claim
        WHERE claim.couple_id = $1::uuid
          AND claim.request_key = $2
      `, [COUPLE_ID, prepared.applicationRequestKey]);
      expect(unchanged.rows).toEqual([{
        actions: 0,
        executions: 0,
        provider_rows: 0,
        claim_status: "processing",
      }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rolls back action and tool ledger when assistant receipt persistence fails", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role", BRIDE_ID);
      const prepared = await prepareDeterministicApplication(db);
      await resetPersona(db);
      await db.exec(`
        CREATE FUNCTION public.fail_first_use_application_receipt_test()
        RETURNS trigger LANGUAGE plpgsql AS $trigger$
        BEGIN
          IF NEW.metadata ->> 'response_origin' =
             'server_authoritative_first_use_action_application' THEN
            RAISE EXCEPTION 'TEST_FIRST_USE_APPLICATION_RECEIPT_FAILURE'
              USING ERRCODE = '23514';
          END IF;
          RETURN NEW;
        END
        $trigger$;
        CREATE TRIGGER trg_fail_first_use_application_receipt_test
          BEFORE INSERT ON public.chat_messages
          FOR EACH ROW
          EXECUTE FUNCTION public.fail_first_use_application_receipt_test();
      `);
      await setPersona(db, "service_role", BRIDE_ID);

      await expect(finalizeDeterministicApplication({
        db,
        proposalMessageId: prepared.proposal.message_id,
        requestKey: prepared.applicationRequestKey,
      })).rejects.toThrow(/TEST_FIRST_USE_APPLICATION_RECEIPT_FAILURE/);
      const rolledBack = await db.query<{
        actions: number;
        executions: number;
        assistant_receipts: number;
        provider_rows: number;
        claim_status: string;
      }>(`
        SELECT
          (SELECT count(*)::integer FROM public.amora_actions) AS actions,
          (SELECT count(*)::integer FROM public.amora_tool_executions)
            AS executions,
          (SELECT count(*)::integer FROM public.chat_messages
            WHERE metadata ->> 'response_origin' =
              'server_authoritative_first_use_action_application')
            AS assistant_receipts,
          (SELECT count(*)::integer FROM public.ai_interactions_log)
            AS provider_rows,
          claim.status AS claim_status
        FROM public.amora_chat_request_claims AS claim
        WHERE claim.couple_id = $1::uuid
          AND claim.request_key = $2
      `, [COUPLE_ID, prepared.applicationRequestKey]);
      expect(rolledBack.rows).toEqual([{
        actions: 0,
        executions: 0,
        assistant_receipts: 0,
        provider_rows: 0,
        claim_status: "processing",
      }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rejects a stale privacy snapshot before claiming or applying the tool", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role", BRIDE_ID);
      const prepared = await prepareDeterministicApplication(db);
      await db.query(`
        UPDATE public.amora_privacy_context_epochs
        SET epoch = 12
        WHERE couple_id = $1::uuid
      `, [COUPLE_ID]);

      await expect(finalizeDeterministicApplication({
        db,
        proposalMessageId: prepared.proposal.message_id,
        requestKey: prepared.applicationRequestKey,
      })).rejects.toThrow(/AMORA_FIRST_USE_PROMOTION_PRIVACY_CHANGED/);

      const unchanged = await db.query<{
        actions: number;
        executions: number;
        provider_rows: number;
        claim_status: string;
      }>(`
        SELECT
          (SELECT count(*)::integer FROM public.amora_actions) AS actions,
          (SELECT count(*)::integer FROM public.amora_tool_executions)
            AS executions,
          (SELECT count(*)::integer FROM public.ai_interactions_log)
            AS provider_rows,
          claim.status AS claim_status
        FROM public.amora_chat_request_claims AS claim
        WHERE claim.couple_id = $1::uuid
          AND claim.request_key = $2
      `, [COUPLE_ID, prepared.applicationRequestKey]);
      expect(unchanged.rows).toEqual([{
        actions: 0,
        executions: 0,
        provider_rows: 0,
        claim_status: "processing",
      }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rejects a replay whose immutable assistant receipt was widened", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role", BRIDE_ID);
      const prepared = await prepareDeterministicApplication(db);
      const committed = await finalizeDeterministicApplication({
        db,
        proposalMessageId: prepared.proposal.message_id,
        requestKey: prepared.applicationRequestKey,
      });
      await db.query(`
        UPDATE public.chat_messages
        SET metadata = metadata || '{"forged_receipt_authority":true}'::jsonb
        WHERE id = $1::uuid
      `, [committed.rows[0]!.message_id]);

      await expect(finalizeDeterministicApplication({
        db,
        proposalMessageId: prepared.proposal.message_id,
        requestKey: prepared.applicationRequestKey,
      })).rejects.toThrow(/AMORA_FIRST_USE_ACTION_APPLICATION_REPLAY_INVALID/);

      const unchanged = await db.query<{
        actions: number;
        executions: number;
        assistant_receipts: number;
        provider_rows: number;
        claim_status: string;
      }>(`
        SELECT
          (SELECT count(*)::integer FROM public.amora_actions) AS actions,
          (SELECT count(*)::integer FROM public.amora_tool_executions)
            AS executions,
          (SELECT count(*)::integer FROM public.chat_messages
            WHERE metadata ->> 'client_request_id' = $2)
            AS assistant_receipts,
          (SELECT count(*)::integer FROM public.ai_interactions_log)
            AS provider_rows,
          claim.status AS claim_status
        FROM public.amora_chat_request_claims AS claim
        WHERE claim.couple_id = $1::uuid
          AND claim.request_key = $2
      `, [COUPLE_ID, prepared.applicationRequestKey]);
      expect(unchanged.rows).toEqual([{
        actions: 1,
        executions: 1,
        assistant_receipts: 1,
        provider_rows: 0,
        claim_status: "completed",
      }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("freezes the application RPC contract, ACL, and transaction lock order", async () => {
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
          'public.finalize_amora_first_use_action_application_v1(uuid,uuid,uuid,uuid,text,integer,bigint)'::regprocedure
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
        "public.amora_shared_action_context_with_first_use_promotion_v1(",
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
        authorization,
        toolClaim,
        toolApply,
        assistantInsert,
        claimCompletion,
      ].every((position) => position >= 0)).toBe(true);
      expect(claimLock).toBeLessThan(contextLockChain);
      expect(contextLockChain).toBeLessThan(authorization);
      expect(authorization).toBeLessThan(toolClaim);
      expect(toolClaim).toBeLessThan(toolApply);
      expect(toolApply).toBeLessThan(assistantInsert);
      expect(assistantInsert).toBeLessThan(claimCompletion);
      expect(definition).not.toContain("INSERT INTO public.ai_interactions_log");
      expect(definition).not.toContain("prepare_amora_provider_call_receipt");
      expect(definition).not.toContain("finalize_amora_provider_call_receipt");

      await setPersona(db, "authenticated", BRIDE_ID);
      await expect(finalizeDeterministicApplication({
        db,
        proposalMessageId: PROPOSAL_MESSAGE_ID,
        requestKey: `chat:${BRIDE_ID}:${PROPOSAL_REQUEST_ID}`,
      })).rejects.toThrow(/permission denied/i);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("atomically persists and exactly replays a provider-free canonical proposal", async () => {
    const db = await createDatabase();
    const requestKey = `chat:${BRIDE_ID}:${PROPOSAL_REQUEST_ID}`;
    try {
      await db.exec("BEGIN");
      await db.query("SELECT pg_sleep(0.025)");
      await setPersona(db, "service_role", BRIDE_ID);
      const promoted = await ingest(db, FIRST_REQUEST_ID);
      await db.query(`
        INSERT INTO public.amora_chat_request_claims(
          couple_id, request_key, user_id, visibility, status,
          user_message_id, attempt_count
        ) VALUES (
          $1::uuid, $2, $3::uuid, 'shared', 'processing', $4::uuid, 3
        )
      `, [COUPLE_ID, requestKey, BRIDE_ID, promoted.sharedMessageId]);

      const first = await db.query<{
        outcome: string;
        message_id: string;
        message_created_at: Date;
        message_content: string;
        message_metadata: Record<string, unknown>;
        message_stage_tag: string | null;
        message_specialist_type: string | null;
        message_visibility: string;
        message_reused: boolean;
      }>(`
        SELECT *
        FROM public.finalize_amora_first_use_action_proposal_v1(
          $1::uuid, $2::uuid, $3::uuid, $4, 3, 11::bigint
        )
      `, [COUPLE_ID, BRIDE_ID, promoted.sharedMessageId, requestKey]);

      expect(first.rows).toHaveLength(1);
      const committed = first.rows[0]!;
      expect(committed).toMatchObject({
        outcome: "persisted",
        message_id: expect.any(String),
        message_created_at: expect.any(Date),
        message_stage_tag: null,
        message_specialist_type: "general",
        message_visibility: "shared",
        message_reused: false,
      });
      expect(committed.message_metadata).toMatchObject({
        client_request_id: requestKey,
        client_visible_request_id: `chat:${BRIDE_ID}:${FIRST_REQUEST_ID}`,
        in_reply_to_user_message_id: promoted.sharedMessageId,
        amora_first_use_promotion_id: promoted.promotionId,
        pending_amora_action_journey_revision: 7,
        amora_wedding_context_revision: 7,
        amora_couple_criterion_decision_id: CRITERION_ID,
        response_origin: "server_authoritative_first_use_promotion",
        provider_call_count: 0,
        question_scope: "W0_wedding_core",
        memory_eligible: false,
        memory_enqueue_requested: false,
      });
      expect(committed.message_metadata).not.toHaveProperty("ai_provider");
      expect(committed.message_metadata).not.toHaveProperty("model");
      expect(committed.message_metadata).not.toHaveProperty("tokens_input");
      expect(committed.message_metadata).not.toHaveProperty("tokens_output");

      const pending = committed.message_metadata.pending_amora_action as
        Record<string, unknown>;
      expect(pending).toMatchObject({
        version: 2,
        actionId: expect.any(String),
        tool: "add_amora_action",
        input: canonicalAddActionInput,
        inputDigest: ACTION_DIGEST,
        operationKey: OPERATION_KEY,
        confirmation: expect.any(String),
        issuedAt: expect.any(Number),
        expiresAt: expect.any(Number),
      });
      expect(pending.expiresAt).toBe((pending.issuedAt as number) + 600_000);
      expect(committed.message_created_at.getTime()).toBe(pending.issuedAt);
      expect(committed.message_content).toBe(pending.confirmation);
      expect(resolveAmoraPendingAction({
        value: pending,
        confirmedActionId: pending.actionId,
        allowedTools: [firstUseBoundActionTool],
        now: (pending.issuedAt as number) + 1,
      })).toEqual(pending);

      await resetPersona(db);
      const durable = await db.query<{
        claim_status: string;
        claim_message_id: string;
        bindings: number;
        provider_rows: number;
        assistant_rows: number;
      }>(`
        SELECT
          claim.status AS claim_status,
          claim.message_id::text AS claim_message_id,
          (
            SELECT count(*)::integer
            FROM public.amora_first_use_action_proposal_bindings AS binding
            WHERE binding.proposal_message_id = claim.message_id
              AND binding.promotion_id = $3::uuid
          ) AS bindings,
          (SELECT count(*)::integer FROM public.ai_interactions_log)
            AS provider_rows,
          (
            SELECT count(*)::integer
            FROM public.chat_messages AS message
            WHERE message.couple_id = $1::uuid
              AND message.sender_id IS NULL
              AND message.sender_type = 'ai'
              AND message.role = 'assistant'
              AND message.visibility = 'shared'
              AND message.metadata ->> 'client_request_id' = $2
          ) AS assistant_rows
        FROM public.amora_chat_request_claims AS claim
        WHERE claim.couple_id = $1::uuid
          AND claim.request_key = $2
      `, [COUPLE_ID, requestKey, promoted.promotionId]);
      expect(durable.rows).toEqual([{
        claim_status: "completed",
        claim_message_id: committed.message_id,
        bindings: 1,
        provider_rows: 0,
        assistant_rows: 1,
      }]);

      await db.exec(`
        UPDATE public.wedding_journeys SET state_revision = 8
        WHERE couple_id = '${COUPLE_ID}';
        UPDATE public.amora_privacy_context_epochs SET epoch = 12
        WHERE couple_id = '${COUPLE_ID}';
      `);
      await setPersona(db, "service_role", BRIDE_ID);
      const replay = await db.query<typeof committed>(`
        SELECT *
        FROM public.finalize_amora_first_use_action_proposal_v1(
          $1::uuid, $2::uuid, $3::uuid, $4, 3, 11::bigint
        )
      `, [COUPLE_ID, BRIDE_ID, promoted.sharedMessageId, requestKey]);
      expect(replay.rows).toEqual([{
        ...committed,
        outcome: "replayed",
        message_reused: true,
      }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.exec("ROLLBACK").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("exposes only the service RPC and keeps the provider-free lock and ledger contract", async () => {
    const db = await createDatabase();
    try {
      const contract = await db.query<{
        anon_execute: boolean;
        authenticated_execute: boolean;
        service_execute: boolean;
        definition: string;
        argument_names: string[];
      }>(`
        SELECT
          has_function_privilege(
            'anon',
            'public.finalize_amora_first_use_action_proposal_v1(uuid,uuid,uuid,text,integer,bigint)',
            'EXECUTE'
          ) AS anon_execute,
          has_function_privilege(
            'authenticated',
            'public.finalize_amora_first_use_action_proposal_v1(uuid,uuid,uuid,text,integer,bigint)',
            'EXECUTE'
          ) AS authenticated_execute,
          has_function_privilege(
            'service_role',
            'public.finalize_amora_first_use_action_proposal_v1(uuid,uuid,uuid,text,integer,bigint)',
            'EXECUTE'
          ) AS service_execute,
          pg_get_functiondef(
            'public.finalize_amora_first_use_action_proposal_v1(uuid,uuid,uuid,text,integer,bigint)'::regprocedure
          ) AS definition,
          (
            SELECT proargnames
            FROM pg_proc
            WHERE oid =
              'public.finalize_amora_first_use_action_proposal_v1(uuid,uuid,uuid,text,integer,bigint)'::regprocedure
          ) AS argument_names
      `);
      expect(contract.rows[0]!.anon_execute).toBe(false);
      expect(contract.rows[0]!.authenticated_execute).toBe(false);
      expect(contract.rows[0]!.service_execute).toBe(true);
      expect(contract.rows[0]!.argument_names.slice(0, 6)).toEqual([
        "p_couple_id",
        "p_owner_user_id",
        "p_shared_user_message_id",
        "p_chat_request_key",
        "p_chat_claim_attempt_count",
        "p_expected_privacy_epoch",
      ]);

      const definition = contract.rows[0]!.definition.replace(/\s+/g, " ");
      const claimLock = definition.indexOf(
        "FROM public.amora_chat_request_claims AS claim",
      );
      const currentValidation = definition.indexOf(
        "public.validate_amora_first_use_action_promotion_v1(",
      );
      const messageInsert = definition.indexOf(
        "INSERT INTO public.chat_messages(",
      );
      const claimCompletion = definition.indexOf(
        "UPDATE public.amora_chat_request_claims AS claim",
      );
      expect(claimLock).toBeGreaterThanOrEqual(0);
      expect(claimLock).toBeLessThan(currentValidation);
      expect(currentValidation).toBeLessThan(messageInsert);
      expect(messageInsert).toBeLessThan(claimCompletion);
      expect(definition.slice(messageInsert, claimCompletion)).toMatch(
        /\bcreated_at\b/,
      );
      expect(definition).not.toContain("INSERT INTO public.ai_interactions_log");
      expect(definition).not.toContain("prepare_amora_provider_call_receipt");
      expect(definition).not.toContain("finalize_amora_provider_call_receipt");

      await setPersona(db, "authenticated", BRIDE_ID);
      await expect(finalizeDeterministicProposal({
        db,
        sharedMessageId: SOURCE_MESSAGE_ID,
        requestKey: `chat:${BRIDE_ID}:${PROPOSAL_REQUEST_ID}`,
      })).rejects.toThrow(/permission denied/i);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rejects a stale claim attempt before creating a proposal or provider row", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role", BRIDE_ID);
      const promoted = await ingest(db, FIRST_REQUEST_ID);
      const requestKey = await insertProposalClaim({
        db,
        sharedMessageId: promoted.sharedMessageId as string,
        requestId: PROPOSAL_REQUEST_ID,
        attemptCount: 2,
      });
      await expect(finalizeDeterministicProposal({
        db,
        sharedMessageId: promoted.sharedMessageId as string,
        requestKey,
        attemptCount: 1,
      })).rejects.toThrow(/AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_CLAIM_STALE/);

      await resetPersona(db);
      const state = await db.query<{ bindings: number; assistants: number; logs: number }>(`
        SELECT
          (SELECT count(*)::integer
             FROM public.amora_first_use_action_proposal_bindings) AS bindings,
          (SELECT count(*)::integer
             FROM public.chat_messages
            WHERE metadata ->> 'client_request_id' = $1) AS assistants,
          (SELECT count(*)::integer FROM public.ai_interactions_log) AS logs
      `, [requestKey]);
      expect(state.rows).toEqual([{ bindings: 0, assistants: 0, logs: 0 }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("fails closed when the current journey changed after the shared draft", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role", BRIDE_ID);
      const promoted = await ingest(db, FIRST_REQUEST_ID);
      const requestKey = await insertProposalClaim({
        db,
        sharedMessageId: promoted.sharedMessageId as string,
        requestId: PROPOSAL_REQUEST_ID,
      });
      await resetPersona(db);
      await db.query(`
        UPDATE public.wedding_journeys
        SET state_revision = state_revision + 1
        WHERE couple_id = $1::uuid
      `, [COUPLE_ID]);
      await setPersona(db, "service_role", BRIDE_ID);
      await expect(finalizeDeterministicProposal({
        db,
        sharedMessageId: promoted.sharedMessageId as string,
        requestKey,
      })).rejects.toThrow(/AMORA_FIRST_USE_PROMOTION_JOURNEY_CHANGED/);

      await resetPersona(db);
      const state = await db.query<{ status: string; message_id: string | null; bindings: number }>(`
        SELECT claim.status, claim.message_id::text,
          (SELECT count(*)::integer
             FROM public.amora_first_use_action_proposal_bindings) AS bindings
        FROM public.amora_chat_request_claims AS claim
        WHERE claim.couple_id = $1::uuid AND claim.request_key = $2
      `, [COUPLE_ID, requestKey]);
      expect(state.rows).toEqual([{ status: "processing", message_id: null, bindings: 0 }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("fails closed across privacy, roster, and criterion currentness changes", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role", BRIDE_ID);
      const promoted = await ingest(db, FIRST_REQUEST_ID);
      const requestKey = await insertProposalClaim({
        db,
        sharedMessageId: promoted.sharedMessageId as string,
        requestId: PROPOSAL_REQUEST_ID,
      });

      await resetPersona(db);
      await db.query(`
        UPDATE public.amora_privacy_context_epochs
        SET epoch = 12
        WHERE couple_id = $1::uuid
      `, [COUPLE_ID]);
      await setPersona(db, "service_role", BRIDE_ID);
      await expect(finalizeDeterministicProposal({
        db,
        sharedMessageId: promoted.sharedMessageId as string,
        requestKey,
      })).rejects.toThrow(/AMORA_FIRST_USE_PROMOTION_PRIVACY_CHANGED/);

      await resetPersona(db);
      await db.query(`
        UPDATE public.amora_privacy_context_epochs
        SET epoch = 11
        WHERE couple_id = $1::uuid
      `, [COUPLE_ID]);
      await db.query(`
        UPDATE public.couples
        SET groom_id = NULL
        WHERE id = $1::uuid
      `, [COUPLE_ID]);
      await setPersona(db, "service_role", BRIDE_ID);
      await expect(finalizeDeterministicProposal({
        db,
        sharedMessageId: promoted.sharedMessageId as string,
        requestKey,
      })).rejects.toThrow(/AMORA_FIRST_USE_PROMOTION_ROSTER_CHANGED/);

      await resetPersona(db);
      await db.query(`
        UPDATE public.couples
        SET groom_id = $2::uuid
        WHERE id = $1::uuid
      `, [COUPLE_ID, GROOM_ID]);
      await db.query(`
        INSERT INTO public.decision_nodes(
          id, couple_id, category, decision_type, chosen_value, source,
          visibility, source_actor_role, user_confirmed_at, metadata
        ) VALUES (
          '40000000-0000-4000-8000-000000000002', $1::uuid,
          'preference', 'decided', '{"value":"newer"}'::jsonb,
          'manual', 'shared', NULL, clock_timestamp() + interval '1 second',
          jsonb_build_object(
            'criterion_contract', 'amora_couple_core_criterion_v1',
            'criterion_version', 1,
            'bride_user_id', $3::text,
            'groom_user_id', $2::text,
            'acceptance_count', 2,
            'explicit', true
          )
        )
      `, [COUPLE_ID, GROOM_ID, BRIDE_ID]);
      await setPersona(db, "service_role", BRIDE_ID);
      await expect(finalizeDeterministicProposal({
        db,
        sharedMessageId: promoted.sharedMessageId as string,
        requestKey,
      })).rejects.toThrow(/AMORA_FIRST_USE_PROMOTION_CRITERION_CHANGED/);

      await resetPersona(db);
      const state = await db.query<{
        status: string;
        message_id: string | null;
        bindings: number;
        provider_rows: number;
      }>(`
        SELECT claim.status, claim.message_id::text,
          (SELECT count(*)::integer
             FROM public.amora_first_use_action_proposal_bindings) AS bindings,
          (SELECT count(*)::integer FROM public.ai_interactions_log)
            AS provider_rows
        FROM public.amora_chat_request_claims AS claim
        WHERE claim.couple_id = $1::uuid AND claim.request_key = $2
      `, [COUPLE_ID, requestKey]);
      expect(state.rows).toEqual([{
        status: "processing",
        message_id: null,
        bindings: 0,
        provider_rows: 0,
      }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("fails closed when the promoted shared source content was mutated", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role", BRIDE_ID);
      const promoted = await ingest(db, FIRST_REQUEST_ID);
      const requestKey = await insertProposalClaim({
        db,
        sharedMessageId: promoted.sharedMessageId as string,
        requestId: PROPOSAL_REQUEST_ID,
      });
      await resetPersona(db);
      await db.query(`
        UPDATE public.chat_messages SET content = content || ' changed'
        WHERE id = $1::uuid
      `, [promoted.sharedMessageId]);
      await setPersona(db, "service_role", BRIDE_ID);
      await expect(finalizeDeterministicProposal({
        db,
        sharedMessageId: promoted.sharedMessageId as string,
        requestKey,
      })).rejects.toThrow(/AMORA_FIRST_USE_PROMOTION_CONTENT_MISMATCH/);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rolls back the proposal and binding if exact claim completion loses the race", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role", BRIDE_ID);
      const promoted = await ingest(db, FIRST_REQUEST_ID);
      const requestKey = await insertProposalClaim({
        db,
        sharedMessageId: promoted.sharedMessageId as string,
        requestId: PROPOSAL_REQUEST_ID,
      });
      await resetPersona(db);
      await db.exec(`
        CREATE FUNCTION public.test_break_first_use_claim_completion()
        RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
        SET search_path = pg_catalog, public AS $$
        BEGIN
          IF NEW.metadata ->> 'response_origin'
               = 'server_authoritative_first_use_promotion' THEN
            UPDATE public.amora_chat_request_claims
            SET status = 'failed', failure_code = 'TEST_RACE'
            WHERE couple_id = NEW.couple_id
              AND request_key = NEW.metadata ->> 'client_request_id';
          END IF;
          RETURN NEW;
        END
        $$;
        CREATE TRIGGER trg_zzzz_test_break_first_use_claim_completion
        AFTER INSERT ON public.chat_messages
        FOR EACH ROW
        EXECUTE FUNCTION public.test_break_first_use_claim_completion();
      `);
      await setPersona(db, "service_role", BRIDE_ID);
      await expect(finalizeDeterministicProposal({
        db,
        sharedMessageId: promoted.sharedMessageId as string,
        requestKey,
      })).rejects.toThrow(/AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_CLAIM_STALE/);

      await resetPersona(db);
      const state = await db.query<{
        status: string;
        failure_code: string | null;
        bindings: number;
        assistants: number;
      }>(`
        SELECT claim.status, claim.failure_code,
          (SELECT count(*)::integer
             FROM public.amora_first_use_action_proposal_bindings) AS bindings,
          (SELECT count(*)::integer
             FROM public.chat_messages
            WHERE metadata ->> 'client_request_id' = $2) AS assistants
        FROM public.amora_chat_request_claims AS claim
        WHERE claim.couple_id = $1::uuid AND claim.request_key = $2
      `, [COUPLE_ID, requestKey]);
      expect(state.rows).toEqual([{
        status: "processing",
        failure_code: null,
        bindings: 0,
        assistants: 0,
      }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rejects a second request for a promotion that already has one proposal", async () => {
    const db = await createDatabase();
    const secondProposalRequestId = "50000000-0000-4000-8000-000000000005";
    try {
      await setPersona(db, "service_role", BRIDE_ID);
      const promoted = await ingest(db, FIRST_REQUEST_ID);
      const firstRequestKey = await insertProposalClaim({
        db,
        sharedMessageId: promoted.sharedMessageId as string,
        requestId: PROPOSAL_REQUEST_ID,
      });
      await finalizeDeterministicProposal({
        db,
        sharedMessageId: promoted.sharedMessageId as string,
        requestKey: firstRequestKey,
      });
      const secondRequestKey = await insertProposalClaim({
        db,
        sharedMessageId: promoted.sharedMessageId as string,
        requestId: secondProposalRequestId,
      });
      await expect(finalizeDeterministicProposal({
        db,
        sharedMessageId: promoted.sharedMessageId as string,
        requestKey: secondRequestKey,
      })).rejects.toThrow(/AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_REQUEST_CONFLICT/);

      await resetPersona(db);
      const state = await db.query<{ bindings: number; assistants: number; status: string }>(`
        SELECT
          (SELECT count(*)::integer
             FROM public.amora_first_use_action_proposal_bindings) AS bindings,
          (SELECT count(*)::integer
             FROM public.chat_messages
            WHERE metadata ->> 'response_origin'
              = 'server_authoritative_first_use_promotion') AS assistants,
          claim.status
        FROM public.amora_chat_request_claims AS claim
        WHERE claim.couple_id = $1::uuid AND claim.request_key = $2
      `, [COUPLE_ID, secondRequestKey]);
      expect(state.rows).toEqual([{ bindings: 1, assistants: 1, status: "processing" }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rejects replay when server metadata gained an unknown field", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role", BRIDE_ID);
      const promoted = await ingest(db, FIRST_REQUEST_ID);
      const requestKey = await insertProposalClaim({
        db,
        sharedMessageId: promoted.sharedMessageId as string,
        requestId: PROPOSAL_REQUEST_ID,
      });
      const committed = await finalizeDeterministicProposal({
        db,
        sharedMessageId: promoted.sharedMessageId as string,
        requestKey,
      });
      await resetPersona(db);
      await db.query(`
        UPDATE public.chat_messages
        SET metadata = metadata || '{"unexpected_private_extra":"blocked"}'::jsonb
        WHERE id = $1::uuid
      `, [committed.rows[0]!.message_id]);
      await setPersona(db, "service_role", BRIDE_ID);
      await expect(finalizeDeterministicProposal({
        db,
        sharedMessageId: promoted.sharedMessageId as string,
        requestKey,
      })).rejects.toThrow(/AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_REPLAY_INVALID/);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rejects replay when the stored pending journey revision was changed", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role", BRIDE_ID);
      const promoted = await ingest(db, FIRST_REQUEST_ID);
      const requestKey = await insertProposalClaim({
        db,
        sharedMessageId: promoted.sharedMessageId as string,
        requestId: PROPOSAL_REQUEST_ID,
      });
      const committed = await finalizeDeterministicProposal({
        db,
        sharedMessageId: promoted.sharedMessageId as string,
        requestKey,
      });
      await resetPersona(db);
      await db.query(`
        UPDATE public.chat_messages
        SET metadata = jsonb_set(
          metadata,
          '{pending_amora_action_journey_revision}',
          '8'::jsonb
        )
        WHERE id = $1::uuid
      `, [committed.rows[0]!.message_id]);
      await setPersona(db, "service_role", BRIDE_ID);
      await expect(finalizeDeterministicProposal({
        db,
        sharedMessageId: promoted.sharedMessageId as string,
        requestKey,
      })).rejects.toThrow(/AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_REPLAY_INVALID/);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rejects replay when pending number types or terminal claim fields changed", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role", BRIDE_ID);
      const promoted = await ingest(db, FIRST_REQUEST_ID);
      const requestKey = await insertProposalClaim({
        db,
        sharedMessageId: promoted.sharedMessageId as string,
        requestId: PROPOSAL_REQUEST_ID,
      });
      const committed = await finalizeDeterministicProposal({
        db,
        sharedMessageId: promoted.sharedMessageId as string,
        requestKey,
      });
      const persisted = committed.rows[0]!;

      await resetPersona(db);
      await db.query(`
        UPDATE public.chat_messages
        SET metadata = jsonb_set(
          metadata,
          '{pending_amora_action,issuedAt}',
          to_jsonb(metadata #>> '{pending_amora_action,issuedAt}')
        )
        WHERE id = $1::uuid
      `, [persisted.message_id]);
      await setPersona(db, "service_role", BRIDE_ID);
      await expect(finalizeDeterministicProposal({
        db,
        sharedMessageId: promoted.sharedMessageId as string,
        requestKey,
      })).rejects.toThrow(/AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_REPLAY_INVALID/);

      await resetPersona(db);
      await db.query(`
        UPDATE public.chat_messages
        SET metadata = $2::jsonb
        WHERE id = $1::uuid
      `, [
        persisted.message_id,
        JSON.stringify(persisted.message_metadata),
      ]);
      await db.query(`
        UPDATE public.amora_chat_request_claims
        SET completed_at = NULL
        WHERE couple_id = $1::uuid AND request_key = $2
      `, [
        COUPLE_ID,
        requestKey,
      ]);
      await setPersona(db, "service_role", BRIDE_ID);
      await expect(finalizeDeterministicProposal({
        db,
        sharedMessageId: promoted.sharedMessageId as string,
        requestKey,
      })).rejects.toThrow(/AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_REPLAY_INVALID/);
    } finally {
      await resetPersona(db).catch(() => undefined);
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
