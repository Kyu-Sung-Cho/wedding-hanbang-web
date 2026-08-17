BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $preconditions$
BEGIN
  IF to_regclass('public.couples') IS NULL
     OR to_regclass('public.chat_messages') IS NULL
     OR to_regclass('public.amora_chat_request_claims') IS NULL
     OR to_regclass('public.amora_tool_executions') IS NULL
     OR to_regclass('public.amora_actions') IS NULL
     OR to_regclass('public.amora_shared_action_application_claims') IS NULL
     OR to_regclass('public.amora_first_use_action_promotions') IS NULL
     OR to_regclass('public.amora_first_use_action_proposal_bindings') IS NULL
     OR to_regclass('public.ai_interactions_log') IS NULL
     OR to_regprocedure('auth.role()') IS NULL
     OR to_regprocedure(
       'public.amora_shared_action_context_with_first_use_promotion_v1(uuid,uuid,uuid,uuid,text,uuid)'
     ) IS NULL
     OR to_regprocedure(
       'public.authorize_amora_shared_action_execution(uuid,uuid,uuid,uuid,uuid)'
     ) IS NULL
     OR to_regprocedure(
       'public.claim_amora_tool_execution(uuid,text,text,text,text,integer,uuid,integer)'
     ) IS NULL
     OR to_regprocedure(
       'public.apply_amora_atomic_tool_execution(uuid,text,text,integer,text,jsonb,jsonb,jsonb)'
     ) IS NULL
     OR to_regprocedure('extensions.digest(bytea,text)') IS NULL THEN
    RAISE EXCEPTION
      'AMORA_FIRST_USE_ACTION_APPLICATION_PREREQUISITE_MISSING';
  END IF;
END
$preconditions$;

CREATE FUNCTION public.finalize_amora_first_use_action_application_v1(
  p_couple_id uuid,
  p_actor_user_id uuid,
  p_source_proposal_message_id uuid,
  p_confirmation_message_id uuid,
  p_chat_request_key text,
  p_chat_claim_attempt_count integer,
  p_expected_privacy_epoch bigint
)
RETURNS TABLE(
  outcome text,
  tool_result jsonb,
  message_id uuid,
  message_created_at timestamptz,
  message_content text,
  message_metadata jsonb,
  message_stage_tag text,
  message_specialist_type text,
  message_visibility text,
  message_reused boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_claim public.amora_chat_request_claims%ROWTYPE;
  v_source public.chat_messages%ROWTYPE;
  v_confirmation public.chat_messages%ROWTYPE;
  v_message public.chat_messages%ROWTYPE;
  v_binding public.amora_first_use_action_proposal_bindings%ROWTYPE;
  v_promotion public.amora_first_use_action_promotions%ROWTYPE;
  v_execution public.amora_tool_executions%ROWTYPE;
  v_action public.amora_actions%ROWTYPE;
  v_context jsonb;
  v_authorization jsonb;
  v_pending jsonb;
  v_add_input jsonb;
  v_tool_claim jsonb;
  v_durable_result jsonb;
  v_public_tool_result jsonb;
  v_domain_action jsonb;
  v_domain_mutation jsonb;
  v_expected_action_output jsonb;
  v_expected_source_metadata jsonb;
  v_expected_metadata jsonb;
  v_canonical_input text;
  v_computed_input_digest text;
  v_computed_operation_key text;
  v_normalized_title text;
  v_normalized_description text;
  v_pending_action_id uuid;
  v_pending_issued_at bigint;
  v_pending_expires_at bigint;
  v_request_digest text;
  v_request_uuid text;
  v_expected_request_key text;
  v_visible_request_uuid text;
  v_expected_visible_request_key text;
  v_domain_action_id text;
  v_display_message text;
  v_prior_message_id uuid;
  v_expected_metadata_keys text[] := ARRAY[
    'client_request_id',
    'client_visible_request_id',
    'in_reply_to_user_message_id',
    'confirmed_amora_action_id',
    'question_scope',
    'memory_eligible',
    'memory_enqueue_requested',
    'amora_wedding_context_revision',
    'amora_first_use_promotion_id',
    'toolResults',
    'toolsUsed',
    'persistence_terminal_source',
    'response_origin',
    'provider_call_count'
  ];
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION
      'AMORA_FIRST_USE_ACTION_APPLICATION_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF p_couple_id IS NULL
     OR p_actor_user_id IS NULL
     OR p_source_proposal_message_id IS NULL
     OR p_confirmation_message_id IS NULL
     OR p_source_proposal_message_id = p_confirmation_message_id
     OR p_chat_request_key IS NULL
     OR char_length(p_chat_request_key) NOT BETWEEN 1 AND 160
     OR p_chat_request_key !~ (
       '^chat:' || p_actor_user_id::text ||
       ':[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     )
     OR p_chat_claim_attempt_count IS NULL
     OR p_chat_claim_attempt_count < 1
     OR p_expected_privacy_epoch IS NULL
     OR p_expected_privacy_epoch < 1 THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_ACTION_APPLICATION_INVALID'
      USING ERRCODE = '22023';
  END IF;

  -- Canonical processing order starts at the exact terminal claim. The source
  -- probe below is deliberately non-locking: it only discovers the immutable
  -- capability UUID needed by the context validator, which then owns the
  -- couple -> action advisory -> source -> privacy -> journey lock prefix.
  SELECT claim.*
    INTO v_claim
  FROM public.amora_chat_request_claims AS claim
  WHERE claim.couple_id = p_couple_id
    AND claim.request_key = p_chat_request_key
  FOR UPDATE;
  IF NOT FOUND
     OR v_claim.user_id IS DISTINCT FROM p_actor_user_id
     OR v_claim.visibility IS DISTINCT FROM 'shared'
     OR v_claim.user_message_id IS DISTINCT FROM p_confirmation_message_id
     OR v_claim.attempt_count IS DISTINCT FROM
       p_chat_claim_attempt_count THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_ACTION_APPLICATION_CLAIM_STALE'
      USING ERRCODE = '40001';
  END IF;
  IF v_claim.status NOT IN ('processing', 'completed') THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_ACTION_APPLICATION_CLAIM_STALE'
      USING ERRCODE = '40001';
  END IF;
  IF v_claim.status = 'completed'
     AND (
       v_claim.message_id IS NULL
       OR v_claim.completed_at IS NULL
       OR v_claim.failed_at IS NOT NULL
       OR v_claim.failure_code IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_ACTION_APPLICATION_REPLAY_INVALID'
      USING ERRCODE = '55000';
  END IF;

  SELECT source.metadata -> 'pending_amora_action'
    INTO v_pending
  FROM public.chat_messages AS source
  WHERE source.id = p_source_proposal_message_id
    AND source.couple_id = p_couple_id;
  BEGIN
    v_pending_action_id := NULLIF(v_pending ->> 'actionId', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_ACTION_APPLICATION_PROPOSAL_MISMATCH'
      USING ERRCODE = '23514';
  END;
  IF v_pending_action_id IS NULL THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_ACTION_APPLICATION_PROPOSAL_MISMATCH'
      USING ERRCODE = '23514';
  END IF;

  IF v_claim.status = 'processing' THEN
    v_context :=
      public.amora_shared_action_context_with_first_use_promotion_v1(
        v_pending_action_id,
        p_couple_id,
        p_source_proposal_message_id,
        p_actor_user_id,
        'execution',
        p_confirmation_message_id
      );
    IF COALESCE(v_context ->> 'authorized', '') <> ''
       OR COALESCE(v_context ->> 'firstUsePromotionId', '') !~
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR v_context ->> 'tool' IS DISTINCT FROM 'add_amora_action'
       OR jsonb_typeof(v_context -> 'canonicalAddActionInput')
         IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'AMORA_FIRST_USE_ACTION_APPLICATION_PROPOSAL_MISMATCH'
        USING ERRCODE = '23514';
    END IF;

    v_authorization := public.authorize_amora_shared_action_execution(
      v_pending_action_id,
      p_couple_id,
      p_source_proposal_message_id,
      p_confirmation_message_id,
      p_actor_user_id
    );
    IF v_authorization -> 'authorized' IS DISTINCT FROM 'true'::jsonb
       OR v_authorization -> 'ready' IS DISTINCT FROM 'true'::jsonb THEN
      RAISE EXCEPTION 'AMORA_FIRST_USE_ACTION_APPLICATION_NOT_AUTHORIZED'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Processing now owns the canonical context locks. Replay owns only the
  -- exact completed claim and immutable receipt rows, intentionally allowing
  -- old privacy/journey snapshots to be replayed after later user changes.
  SELECT source.*
    INTO v_source
  FROM public.chat_messages AS source
  WHERE source.id = p_source_proposal_message_id
    AND source.couple_id = p_couple_id
  FOR SHARE;
  SELECT confirmation.*
    INTO v_confirmation
  FROM public.chat_messages AS confirmation
  WHERE confirmation.id = p_confirmation_message_id
    AND confirmation.couple_id = p_couple_id
  FOR SHARE;
  IF v_source.id IS NULL
     OR v_confirmation.id IS NULL THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_ACTION_APPLICATION_PROPOSAL_MISMATCH'
      USING ERRCODE = '23514';
  END IF;

  SELECT ordered.prior_id
    INTO v_prior_message_id
  FROM (
    SELECT message.id,
           lag(message.id) OVER (
             ORDER BY message.created_at, message.id
           ) AS prior_id
    FROM public.chat_messages AS message
    WHERE message.couple_id = p_couple_id
      AND message.visibility = 'shared'
      AND COALESCE(message.metadata ->> 'target', '') <> 'partner'
  ) AS ordered
  WHERE ordered.id = p_confirmation_message_id;

  IF v_confirmation.sender_id IS DISTINCT FROM p_actor_user_id
     OR v_confirmation.sender_type NOT IN ('bride', 'groom')
     OR v_confirmation.role IS DISTINCT FROM 'user'
     OR v_confirmation.visibility IS DISTINCT FROM 'shared'
     OR COALESCE(v_confirmation.metadata ->> 'target', '') = 'partner'
     OR v_confirmation.content IS DISTINCT FROM
       '좋아요. 제안한 변경을 적용해 주세요.'
     OR jsonb_typeof(v_confirmation.metadata)
       IS DISTINCT FROM 'object'
     OR jsonb_typeof(
       v_confirmation.metadata -> 'confirmed_amora_action_id'
     ) IS DISTINCT FROM 'string'
     OR v_confirmation.metadata ->> 'confirmed_amora_action_id'
       IS DISTINCT FROM v_pending_action_id::text
     OR jsonb_typeof(v_confirmation.metadata -> 'client_request_id')
       IS DISTINCT FROM 'string'
     OR COALESCE(v_confirmation.metadata ->> 'client_request_id', '') !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR v_prior_message_id IS DISTINCT FROM
       p_source_proposal_message_id THEN
    RAISE EXCEPTION
      'AMORA_FIRST_USE_ACTION_APPLICATION_CONFIRMATION_MISMATCH'
      USING ERRCODE = '23514';
  END IF;

  v_pending := v_source.metadata -> 'pending_amora_action';
  BEGIN
    v_pending_action_id := NULLIF(v_pending ->> 'actionId', '')::uuid;
    v_pending_issued_at := NULLIF(v_pending ->> 'issuedAt', '')::bigint;
    v_pending_expires_at := NULLIF(v_pending ->> 'expiresAt', '')::bigint;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION
        'AMORA_FIRST_USE_ACTION_APPLICATION_PROPOSAL_MISMATCH'
        USING ERRCODE = '23514';
  END;
  IF v_source.sender_id IS NOT NULL
     OR v_source.sender_type IS DISTINCT FROM 'ai'
     OR v_source.sender_role IS NOT NULL
     OR v_source.role IS DISTINCT FROM 'assistant'
     OR v_source.visibility IS DISTINCT FROM 'shared'
     OR v_source.stage_tag IS NOT NULL
     OR v_source.specialist_type IS DISTINCT FROM 'general'
     OR COALESCE(v_source.metadata ->> 'target', '') = 'partner'
     OR v_source.content IS DISTINCT FROM v_pending ->> 'confirmation'
     OR v_source.metadata -> 'response_origin' IS DISTINCT FROM
       to_jsonb('server_authoritative_first_use_promotion'::text)
     OR v_source.metadata -> 'provider_call_count'
       IS DISTINCT FROM '0'::jsonb
     OR jsonb_typeof(v_pending) IS DISTINCT FROM 'object'
     OR NOT (v_pending ?& ARRAY[
       'version', 'actionId', 'tool', 'input', 'inputDigest',
       'operationKey', 'confirmation', 'issuedAt', 'expiresAt'
     ])
     OR v_pending - ARRAY[
       'version', 'actionId', 'tool', 'input', 'inputDigest',
       'operationKey', 'confirmation', 'issuedAt', 'expiresAt'
     ] <> '{}'::jsonb
     OR v_pending -> 'version' IS DISTINCT FROM '2'::jsonb
     OR v_pending -> 'tool'
       IS DISTINCT FROM to_jsonb('add_amora_action'::text)
     OR jsonb_typeof(v_pending -> 'input') IS DISTINCT FROM 'object'
     OR COALESCE(v_pending ->> 'inputDigest', '') !~ '^[a-f0-9]{64}$'
     OR COALESCE(v_pending ->> 'operationKey', '') !~ '^[a-f0-9]{64}$'
     OR jsonb_typeof(v_pending -> 'confirmation')
       IS DISTINCT FROM 'string'
     OR v_pending_action_id IS NULL
     OR v_pending_issued_at IS NULL
     OR v_pending_expires_at IS NULL
     OR v_pending_issued_at > 9007199254740991
     OR v_pending_expires_at > 9007199254740991
     OR v_pending_expires_at IS DISTINCT FROM v_pending_issued_at + 600000
     OR v_source.created_at IS DISTINCT FROM to_timestamp(
       v_pending_issued_at::double precision / 1000.0
     ) THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_ACTION_APPLICATION_PROPOSAL_MISMATCH'
      USING ERRCODE = '23514';
  END IF;

  SELECT binding.*
    INTO v_binding
  FROM public.amora_first_use_action_proposal_bindings AS binding
  WHERE binding.proposal_message_id = p_source_proposal_message_id
    AND binding.couple_id = p_couple_id
    AND binding.action_id = v_pending_action_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_ACTION_APPLICATION_PROPOSAL_MISMATCH'
      USING ERRCODE = '23514';
  END IF;
  SELECT promotion.*
    INTO v_promotion
  FROM public.amora_first_use_action_promotions AS promotion
  WHERE promotion.id = v_binding.promotion_id
    AND promotion.couple_id = p_couple_id
    AND promotion.shared_user_message_id = v_binding.shared_user_message_id
  FOR SHARE;
  IF NOT FOUND
     OR v_source.metadata -> 'amora_first_use_promotion_id'
       IS DISTINCT FROM to_jsonb(v_promotion.id)
     OR v_source.metadata -> 'in_reply_to_user_message_id'
       IS DISTINCT FROM to_jsonb(v_promotion.shared_user_message_id)
     OR v_binding.proposal_journey_revision IS DISTINCT FROM
       v_promotion.source_journey_revision
     OR v_binding.action_digest IS DISTINCT FROM
       v_promotion.action_digest
     OR (
       v_claim.status = 'processing'
       AND (
         v_promotion.source_privacy_epoch IS DISTINCT FROM
           p_expected_privacy_epoch
         OR v_context ->> 'firstUsePromotionId' IS DISTINCT FROM
           v_promotion.id::text
       )
     ) THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_ACTION_APPLICATION_PROPOSAL_MISMATCH'
      USING ERRCODE = '23514';
  END IF;

  v_expected_source_metadata := jsonb_strip_nulls(jsonb_build_object(
    'client_request_id', v_source.metadata ->> 'client_request_id',
    'client_visible_request_id',
      'chat:' || v_promotion.owner_user_id::text || ':' ||
      v_promotion.shared_client_request_id::text,
    'in_reply_to_user_message_id', v_promotion.shared_user_message_id,
    'question_scope', 'W0_wedding_core',
    'memory_eligible', false,
    'memory_enqueue_requested', false,
    'amora_wedding_context_revision',
      v_binding.proposal_journey_revision,
    'amora_couple_criterion_decision_id',
      v_promotion.source_criterion_decision_id,
    'pending_amora_action', v_pending,
    'pending_amora_action_journey_revision',
      v_binding.proposal_journey_revision,
    'amora_first_use_promotion_id', v_promotion.id,
    'response_origin', 'server_authoritative_first_use_promotion',
    'provider_call_count', 0
  ));
  IF jsonb_typeof(v_source.metadata) IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_source.metadata -> 'client_request_id')
       IS DISTINCT FROM 'string'
     OR COALESCE(v_source.metadata ->> 'client_request_id', '') !~ (
       '^chat:' || v_promotion.owner_user_id::text ||
       ':[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     )
     OR v_source.metadata IS DISTINCT FROM v_expected_source_metadata
     OR NOT EXISTS (
       SELECT 1
       FROM public.amora_chat_request_claims AS source_claim
       WHERE source_claim.couple_id = p_couple_id
         AND source_claim.request_key =
           v_source.metadata ->> 'client_request_id'
         AND source_claim.user_id = v_promotion.owner_user_id
         AND source_claim.visibility = 'shared'
         AND source_claim.status = 'completed'
         AND source_claim.user_message_id =
           v_promotion.shared_user_message_id
         AND source_claim.message_id = v_source.id
         AND source_claim.completed_at IS NOT NULL
         AND source_claim.failed_at IS NULL
         AND source_claim.failure_code IS NULL
     ) THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_ACTION_APPLICATION_PROPOSAL_MISMATCH'
      USING ERRCODE = '23514';
  END IF;

  v_add_input := v_promotion.canonical_add_action_input;
  IF jsonb_typeof(v_add_input) IS DISTINCT FROM 'object'
     OR NOT (v_add_input ?& ARRAY[
       'title', 'description', 'category_key', 'priority', 'source'
     ])
     OR v_add_input - ARRAY[
       'title', 'description', 'category_key', 'priority', 'source'
     ] <> '{}'::jsonb
     OR jsonb_typeof(v_add_input -> 'title') IS DISTINCT FROM 'string'
     OR jsonb_typeof(v_add_input -> 'description') IS DISTINCT FROM 'string'
     OR v_add_input ->> 'category_key' IS DISTINCT FROM 'general'
     OR v_add_input ->> 'priority' IS DISTINCT FROM 'medium'
     OR v_add_input ->> 'source' IS DISTINCT FROM 'chat'
     OR char_length(v_add_input ->> 'title') NOT BETWEEN 1 AND 120
     OR char_length(v_add_input ->> 'description') NOT BETWEEN 1 AND 500
     OR btrim(v_add_input ->> 'title') IS DISTINCT FROM
       v_add_input ->> 'title'
     OR btrim(v_add_input ->> 'description') IS DISTINCT FROM
       v_add_input ->> 'description' THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_ACTION_APPLICATION_INPUT_INVALID'
      USING ERRCODE = '23514';
  END IF;
  v_normalized_title := left(regexp_replace(
    btrim(v_add_input ->> 'title'), '[[:space:]]+', ' ', 'g'
  ), 120);
  v_normalized_description := NULLIF(left(regexp_replace(
    btrim(v_add_input ->> 'description'), '[[:space:]]+', ' ', 'g'
  ), 500), '');
  IF v_normalized_title = '' OR v_normalized_description IS NULL THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_ACTION_APPLICATION_INPUT_INVALID'
      USING ERRCODE = '23514';
  END IF;

  -- Exact parity with canonicalAmoraToolInput/getAmoraToolOperationIdentity.
  v_canonical_input :=
    '{"category_key":' || to_jsonb(v_add_input ->> 'category_key')::text ||
    ',"description":' || to_jsonb(v_add_input ->> 'description')::text ||
    ',"priority":' || to_jsonb(v_add_input ->> 'priority')::text ||
    ',"source":' || to_jsonb(v_add_input ->> 'source')::text ||
    ',"title":' || to_jsonb(v_add_input ->> 'title')::text || '}';
  v_computed_input_digest := encode(
    extensions.digest(convert_to(v_canonical_input, 'UTF8'), 'sha256'),
    'hex'
  );
  v_computed_operation_key := encode(
    extensions.digest(
      convert_to(
        'add_amora_action' || chr(10) || v_canonical_input,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  IF v_pending -> 'input' IS DISTINCT FROM v_add_input
     OR v_pending ->> 'inputDigest' IS DISTINCT FROM
       v_computed_input_digest
     OR v_pending ->> 'operationKey' IS DISTINCT FROM
       v_computed_operation_key
     OR v_binding.action_digest IS DISTINCT FROM
       v_computed_input_digest
     OR v_promotion.action_digest IS DISTINCT FROM
       v_computed_input_digest
     OR (
       v_claim.status = 'processing'
       AND (
         v_context -> 'canonicalAddActionInput' IS DISTINCT FROM v_add_input
         OR v_context ->> 'inputDigest' IS DISTINCT FROM
           v_computed_input_digest
         OR v_context ->> 'operationKey' IS DISTINCT FROM
           v_computed_operation_key
         OR v_authorization ->> 'inputDigest' IS DISTINCT FROM
           v_computed_input_digest
         OR v_authorization ->> 'operationKey' IS DISTINCT FROM
           v_computed_operation_key
       )
     ) THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_ACTION_APPLICATION_INPUT_INVALID'
      USING ERRCODE = '23514';
  END IF;

  -- PostgreSQL text cannot contain NUL. Build the TS hash preimage as bytea so
  -- the two `\0` separators are byte-for-byte identical to Node's UTF-8 input.
  v_request_digest := left(encode(
    extensions.digest(
      convert_to('amora-confirmed-action-request', 'UTF8')
        || decode('00', 'hex')
        || convert_to(p_confirmation_message_id::text, 'UTF8')
        || decode('00', 'hex')
        || convert_to(v_pending_action_id::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  ), 32);
  v_request_digest := overlay(v_request_digest placing '5' from 13 for 1);
  v_request_digest := overlay(v_request_digest placing '8' from 17 for 1);
  v_request_uuid :=
    substring(v_request_digest from 1 for 8) || '-' ||
    substring(v_request_digest from 9 for 4) || '-' ||
    substring(v_request_digest from 13 for 4) || '-' ||
    substring(v_request_digest from 17 for 4) || '-' ||
    substring(v_request_digest from 21 for 12);
  v_expected_request_key :=
    'chat:' || p_actor_user_id::text || ':' || v_request_uuid;
  IF p_chat_request_key IS DISTINCT FROM v_expected_request_key THEN
    RAISE EXCEPTION
      'AMORA_FIRST_USE_ACTION_APPLICATION_REQUEST_KEY_MISMATCH'
      USING ERRCODE = '23514';
  END IF;
  v_visible_request_uuid :=
    v_confirmation.metadata ->> 'client_request_id';
  v_expected_visible_request_key :=
    'chat:' || p_actor_user_id::text || ':' || v_visible_request_uuid;

  v_domain_action_id := 'act_'
    || replace(v_request_uuid, '-', '')
    || '_' || left(v_computed_operation_key, 24);
  v_display_message := '"' || v_normalized_title
    || '"을 아모라 행동 카드로 저장했어요.';
  v_domain_action := jsonb_build_object(
    'id', v_domain_action_id,
    'title', v_normalized_title,
    'description', v_normalized_description,
    'dueDate', NULL,
    'categoryKey', NULL,
    'priority', 'medium',
    'status', 'open',
    'source', 'chat',
    'href', '/wedding/lounge'
  );
  v_domain_mutation := jsonb_build_object(
    'kind', 'amora_action_insert',
    'action', v_domain_action
  );

  IF v_claim.status = 'processing' THEN
    v_tool_claim := public.claim_amora_tool_execution(
      p_couple_id,
      p_chat_request_key,
      v_computed_operation_key,
      'add_amora_action',
      v_computed_input_digest,
      p_chat_claim_attempt_count,
      v_pending_action_id,
      NULL
    );
    IF v_tool_claim ->> 'action' = 'acquired' THEN
      v_durable_result := public.apply_amora_atomic_tool_execution(
        p_couple_id,
        p_chat_request_key,
        v_computed_operation_key,
        p_chat_claim_attempt_count,
        v_computed_input_digest,
        v_add_input,
        v_domain_mutation,
        jsonb_build_object(
          'toolName', 'add_amora_action',
          'toolOutput', jsonb_build_object('action', v_domain_action),
          'success', true,
          'displayMessage', v_display_message
        )
      );
    ELSIF v_tool_claim ->> 'action' = 'completed' THEN
      v_durable_result := v_tool_claim -> 'result';
    ELSIF v_tool_claim ->> 'action' IN (
      'in_progress', 'stale_attempt', 'stale_context'
    ) THEN
      RAISE EXCEPTION 'AMORA_FIRST_USE_ACTION_APPLICATION_EXECUTION_BUSY'
        USING ERRCODE = '40001';
    ELSIF v_tool_claim ->> 'action' = 'conflict' THEN
      RAISE EXCEPTION 'AMORA_FIRST_USE_ACTION_APPLICATION_EXECUTION_CONFLICT'
        USING ERRCODE = '23505';
    ELSE
      RAISE EXCEPTION 'AMORA_FIRST_USE_ACTION_APPLICATION_EXECUTION_INVALID'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  SELECT execution.*
    INTO v_execution
  FROM public.amora_tool_executions AS execution
  WHERE execution.couple_id = p_couple_id
    AND execution.request_key = p_chat_request_key
    AND execution.operation_key = v_computed_operation_key
    AND execution.pending_action_id = v_pending_action_id
  FOR SHARE;
  IF NOT FOUND
     OR v_execution.request_key IS DISTINCT FROM p_chat_request_key
     OR v_execution.operation_key IS DISTINCT FROM
       v_computed_operation_key
     OR v_execution.tool_name IS DISTINCT FROM 'add_amora_action'
     OR v_execution.input_digest IS DISTINCT FROM
       v_computed_input_digest
     OR v_execution.status IS DISTINCT FROM 'completed'
     OR jsonb_typeof(v_execution.result) IS DISTINCT FROM 'object'
     OR (
       v_claim.status = 'processing'
       AND v_execution.pending_action_journey_revision IS DISTINCT FROM
         v_binding.proposal_journey_revision
     ) THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_ACTION_APPLICATION_EXECUTION_INVALID'
      USING ERRCODE = '55000';
  END IF;
  IF v_claim.status = 'completed' THEN
    v_durable_result := v_execution.result;
  ELSIF v_execution.result IS DISTINCT FROM v_durable_result THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_ACTION_APPLICATION_EXECUTION_INVALID'
      USING ERRCODE = '55000';
  END IF;

  IF v_claim.status = 'processing' THEN
    SELECT action.*
      INTO v_action
    FROM public.amora_actions AS action
    WHERE action.id = v_domain_action_id
      AND action.couple_id = p_couple_id
    FOR SHARE;
    IF NOT FOUND
       OR v_action.first_use_promotion_id IS DISTINCT FROM v_promotion.id
       OR v_action.title IS DISTINCT FROM v_normalized_title
       OR v_action.description IS DISTINCT FROM v_normalized_description
       OR v_action.due_date IS NOT NULL
       OR v_action.category_key IS NOT NULL
       OR v_action.priority IS DISTINCT FROM 'medium'
       OR v_action.status IS DISTINCT FROM 'open'
       OR v_action.source IS DISTINCT FROM 'chat'
       OR v_action.href IS DISTINCT FROM '/wedding/lounge' THEN
      RAISE EXCEPTION 'AMORA_FIRST_USE_ACTION_APPLICATION_RESULT_INVALID'
        USING ERRCODE = '55000';
    END IF;
    v_expected_action_output := jsonb_strip_nulls(jsonb_build_object(
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
    ));
  ELSE
    -- The action row is mutable after application. Replay authenticates the
    -- immutable execution snapshot instead of comparing it with today's title
    -- or status, so a normal later edit cannot invalidate the old receipt.
    v_expected_action_output := v_durable_result #> '{toolOutput,action}';
    IF jsonb_typeof(v_expected_action_output) IS DISTINCT FROM 'object'
       OR NOT (v_expected_action_output ?& ARRAY[
         'id', 'title', 'description', 'priority', 'status', 'source',
         'href', 'createdAt', 'updatedAt'
       ])
       OR v_expected_action_output - ARRAY[
         'id', 'title', 'description', 'priority', 'status', 'source',
         'href', 'createdAt', 'updatedAt'
       ] <> '{}'::jsonb
       OR v_expected_action_output ->> 'id' IS DISTINCT FROM
         v_domain_action_id
       OR v_expected_action_output ->> 'title' IS DISTINCT FROM
         v_normalized_title
       OR v_expected_action_output ->> 'description' IS DISTINCT FROM
         v_normalized_description
       OR v_expected_action_output ->> 'priority' IS DISTINCT FROM 'medium'
       OR v_expected_action_output ->> 'status' IS DISTINCT FROM 'open'
       OR v_expected_action_output ->> 'source' IS DISTINCT FROM 'chat'
       OR v_expected_action_output ->> 'href' IS DISTINCT FROM
         '/wedding/lounge'
       OR jsonb_typeof(v_expected_action_output -> 'createdAt')
         IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_expected_action_output -> 'updatedAt')
         IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'AMORA_FIRST_USE_ACTION_APPLICATION_REPLAY_INVALID'
        USING ERRCODE = '55000';
    END IF;
  END IF;
  IF jsonb_typeof(v_durable_result) IS DISTINCT FROM 'object'
     OR v_durable_result ? 'toolInput'
     OR NOT (v_durable_result ?& ARRAY[
       'toolName', 'toolOutput', 'success', 'displayMessage'
     ])
     OR v_durable_result - ARRAY[
       'toolName', 'toolOutput', 'success', 'displayMessage'
     ] <> '{}'::jsonb
     OR v_durable_result -> 'toolName'
       IS DISTINCT FROM to_jsonb('add_amora_action'::text)
     OR v_durable_result -> 'success' IS DISTINCT FROM 'true'::jsonb
     OR v_durable_result -> 'displayMessage'
       IS DISTINCT FROM to_jsonb(v_display_message)
     OR v_durable_result -> 'toolOutput'
       IS DISTINCT FROM jsonb_build_object(
         'action', v_expected_action_output
       ) THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_ACTION_APPLICATION_RESULT_INVALID'
      USING ERRCODE = '55000';
  END IF;
  -- The durable ledger keeps database timestamps for reconciliation. Browser
  -- and mobile consumers receive the stable nine-field action contract only.
  v_public_tool_result := jsonb_build_object(
    'toolName', 'add_amora_action',
    'toolInput', v_add_input,
    'toolOutput', jsonb_build_object('action', v_domain_action),
    'success', true,
    'displayMessage', v_display_message
  );
  v_expected_metadata := jsonb_build_object(
    'client_request_id', p_chat_request_key,
    'client_visible_request_id', v_expected_visible_request_key,
    'in_reply_to_user_message_id', p_confirmation_message_id,
    'confirmed_amora_action_id', v_pending_action_id,
    'question_scope', 'W0_wedding_core',
    'memory_eligible', false,
    'memory_enqueue_requested', false,
    'amora_wedding_context_revision',
      v_binding.proposal_journey_revision,
    'amora_first_use_promotion_id', v_promotion.id,
    'toolResults', jsonb_build_array(v_public_tool_result),
    'toolsUsed', jsonb_build_array('add_amora_action'),
    'persistence_terminal_source', 'server_mutation_receipts',
    'response_origin',
      'server_authoritative_first_use_action_application',
    'provider_call_count', 0
  );

  IF v_claim.status = 'completed' THEN
    SELECT message.*
      INTO v_message
    FROM public.chat_messages AS message
    WHERE message.id = v_claim.message_id
    FOR SHARE;
    IF NOT FOUND
       OR v_message.couple_id IS DISTINCT FROM p_couple_id
       OR v_message.sender_id IS NOT NULL
       OR v_message.sender_type IS DISTINCT FROM 'ai'
       OR v_message.sender_role IS NOT NULL
       OR v_message.role IS DISTINCT FROM 'assistant'
       OR v_message.content IS DISTINCT FROM v_display_message
       OR v_message.metadata IS DISTINCT FROM v_expected_metadata
       OR jsonb_typeof(v_message.metadata) IS DISTINCT FROM 'object'
       OR NOT (v_message.metadata ?& v_expected_metadata_keys)
       OR v_message.metadata - v_expected_metadata_keys <> '{}'::jsonb
       OR v_message.visibility IS DISTINCT FROM 'shared'
       OR v_message.stage_tag IS NOT NULL
       OR v_message.specialist_type IS DISTINCT FROM 'general' THEN
      RAISE EXCEPTION 'AMORA_FIRST_USE_ACTION_APPLICATION_REPLAY_INVALID'
        USING ERRCODE = '55000';
    END IF;
    RETURN QUERY SELECT
      'replayed'::text,
      v_public_tool_result,
      v_message.id,
      v_message.created_at,
      v_message.content,
      v_message.metadata,
      v_message.stage_tag,
      v_message.specialist_type,
      v_message.visibility,
      true;
    RETURN;
  END IF;

  INSERT INTO public.chat_messages(
    id,
    couple_id,
    sender_id,
    sender_type,
    sender_role,
    role,
    content,
    metadata,
    visibility,
    stage_tag,
    specialist_type,
    created_at
  ) VALUES (
    gen_random_uuid(),
    p_couple_id,
    NULL,
    'ai',
    NULL,
    'assistant',
    v_display_message,
    v_expected_metadata,
    'shared',
    NULL,
    'general',
    clock_timestamp()
  )
  RETURNING * INTO v_message;

  UPDATE public.amora_chat_request_claims AS claim
  SET status = 'completed',
      message_id = v_message.id,
      completed_at = clock_timestamp(),
      failed_at = NULL,
      failure_code = NULL
  WHERE claim.couple_id = p_couple_id
    AND claim.request_key = p_chat_request_key
    AND claim.user_id = p_actor_user_id
    AND claim.visibility = 'shared'
    AND claim.user_message_id = p_confirmation_message_id
    AND claim.attempt_count = p_chat_claim_attempt_count
    AND claim.status = 'processing';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_ACTION_APPLICATION_CLAIM_STALE'
      USING ERRCODE = '40001';
  END IF;

  RETURN QUERY SELECT
    'persisted'::text,
    v_public_tool_result,
    v_message.id,
    v_message.created_at,
    v_message.content,
    v_message.metadata,
    v_message.stage_tag,
    v_message.specialist_type,
    v_message.visibility,
    false;
END
$function$;

ALTER FUNCTION public.finalize_amora_first_use_action_application_v1(
  uuid, uuid, uuid, uuid, text, integer, bigint
) OWNER TO postgres;
REVOKE ALL ON FUNCTION
  public.finalize_amora_first_use_action_application_v1(
    uuid, uuid, uuid, uuid, text, integer, bigint
  ) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.finalize_amora_first_use_action_application_v1(
    uuid, uuid, uuid, uuid, text, integer, bigint
  ) TO service_role;

COMMENT ON FUNCTION public.finalize_amora_first_use_action_application_v1(
  uuid, uuid, uuid, uuid, text, integer, bigint
) IS
  'Service-only provider-free first-use application finalizer. It derives one canonical add_amora_action mutation from the immutable proposal, commits the action and tool ledger with one exact assistant receipt, completes the chat claim last, and replays only the verified committed terminal result.';

DO $postchecks$
DECLARE
  v_function_oid oid := to_regprocedure(
    'public.finalize_amora_first_use_action_application_v1(uuid,uuid,uuid,uuid,text,integer,bigint)'
  );
BEGIN
  IF v_function_oid IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc AS procedure
       WHERE procedure.oid = v_function_oid
         AND procedure.prosecdef
         AND procedure.proowner = 'postgres'::regrole
         AND procedure.proconfig @> ARRAY[
           'search_path=pg_catalog, public',
           'lock_timeout=5s',
           'statement_timeout=15s'
         ]
     )
     OR has_function_privilege(
       'anon',
       'public.finalize_amora_first_use_action_application_v1(uuid,uuid,uuid,uuid,text,integer,bigint)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.finalize_amora_first_use_action_application_v1(uuid,uuid,uuid,uuid,text,integer,bigint)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.finalize_amora_first_use_action_application_v1(uuid,uuid,uuid,uuid,text,integer,bigint)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'AMORA_FIRST_USE_ACTION_APPLICATION_POSTCHECK_FAILED';
  END IF;
END
$postchecks$;

COMMIT;
