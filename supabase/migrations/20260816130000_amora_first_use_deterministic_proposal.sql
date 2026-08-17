BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $preconditions$
BEGIN
  IF to_regclass('public.couples') IS NULL
     OR to_regclass('public.chat_messages') IS NULL
     OR to_regclass('public.amora_chat_request_claims') IS NULL
     OR to_regclass('public.amora_first_use_action_promotions') IS NULL
     OR to_regclass('public.amora_first_use_action_proposal_bindings') IS NULL
     OR to_regclass('public.ai_interactions_log') IS NULL
     OR to_regprocedure('auth.role()') IS NULL
     OR to_regprocedure(
       'public.validate_amora_first_use_action_promotion_v1(uuid,uuid,uuid,bigint)'
     ) IS NULL
     OR to_regprocedure('extensions.digest(bytea,text)') IS NULL THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_PREREQUISITE_MISSING';
  END IF;
END
$preconditions$;

CREATE FUNCTION public.finalize_amora_first_use_action_proposal_v1(
  p_couple_id uuid,
  p_owner_user_id uuid,
  p_shared_user_message_id uuid,
  p_chat_request_key text,
  p_chat_claim_attempt_count integer,
  p_expected_privacy_epoch bigint
)
RETURNS TABLE(
  outcome text,
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
  v_promotion public.amora_first_use_action_promotions%ROWTYPE;
  v_binding public.amora_first_use_action_proposal_bindings%ROWTYPE;
  v_message public.chat_messages%ROWTYPE;
  v_validated jsonb;
  v_add_input jsonb;
  v_pending jsonb;
  v_metadata jsonb;
  v_canonical_input text;
  v_computed_input_digest text;
  v_operation_key text;
  v_confirmation text;
  v_expected_visible_request_key text;
  v_action_id uuid;
  v_message_id uuid;
  v_issued_at bigint;
  v_pending_action_id uuid;
  v_pending_issued_at bigint;
  v_pending_expires_at bigint;
  v_expected_metadata_keys text[] := ARRAY[
    'client_request_id',
    'client_visible_request_id',
    'in_reply_to_user_message_id',
    'question_scope',
    'memory_eligible',
    'memory_enqueue_requested',
    'amora_wedding_context_revision',
    'pending_amora_action',
    'pending_amora_action_journey_revision',
    'amora_first_use_promotion_id',
    'response_origin',
    'provider_call_count'
  ];
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF p_couple_id IS NULL
     OR p_owner_user_id IS NULL
     OR p_shared_user_message_id IS NULL
     OR p_chat_request_key IS NULL
     OR char_length(p_chat_request_key) NOT BETWEEN 1 AND 160
     OR p_chat_request_key !~ (
       '^chat:' || p_owner_user_id::text ||
       ':[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     )
     OR p_chat_claim_attempt_count IS NULL
     OR p_chat_claim_attempt_count < 1
     OR p_expected_privacy_epoch IS NULL
     OR p_expected_privacy_epoch < 1 THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_INVALID'
      USING ERRCODE = '22023';
  END IF;

  -- This provider-free terminal path keeps the established terminal prefix:
  -- exact request claim -> couple -> privacy epoch -> journey -> promotion.
  -- The current-context validator below owns the latter four locks. A private
  -- hard delete cannot lock this exact shared claim, so its couple -> private
  -- claim order does not form a cycle with this path.
  SELECT claim.*
    INTO v_claim
  FROM public.amora_chat_request_claims AS claim
  WHERE claim.couple_id = p_couple_id
    AND claim.request_key = p_chat_request_key
  FOR UPDATE;

  IF NOT FOUND
     OR v_claim.user_id IS DISTINCT FROM p_owner_user_id
     OR v_claim.visibility IS DISTINCT FROM 'shared'
     OR v_claim.user_message_id IS DISTINCT FROM p_shared_user_message_id
     OR v_claim.attempt_count IS DISTINCT FROM p_chat_claim_attempt_count THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_CLAIM_STALE'
      USING ERRCODE = '40001';
  END IF;

  IF v_claim.status = 'completed' THEN
    IF v_claim.message_id IS NULL
       OR v_claim.completed_at IS NULL
       OR v_claim.failed_at IS NOT NULL
       OR v_claim.failure_code IS NOT NULL THEN
      RAISE EXCEPTION 'AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_REPLAY_INVALID'
        USING ERRCODE = '55000';
    END IF;

    -- A committed terminal result is immutable. Replay verifies its exact
    -- promotion and proposal binding, but intentionally does not require the
    -- old privacy/journey snapshot to remain current.
    SELECT promotion.*
      INTO v_promotion
    FROM public.amora_first_use_action_promotions AS promotion
    WHERE promotion.couple_id = p_couple_id
      AND promotion.owner_user_id = p_owner_user_id
      AND promotion.shared_user_message_id = p_shared_user_message_id
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_REPLAY_INVALID'
        USING ERRCODE = '55000';
    END IF;
  ELSIF v_claim.status = 'processing' THEN
    v_validated := public.validate_amora_first_use_action_promotion_v1(
      p_couple_id,
      p_owner_user_id,
      p_shared_user_message_id,
      p_expected_privacy_epoch
    );
    SELECT promotion.*
      INTO v_promotion
    FROM public.amora_first_use_action_promotions AS promotion
    WHERE promotion.id = (v_validated ->> 'promotionId')::uuid
      AND promotion.couple_id = p_couple_id
      AND promotion.owner_user_id = p_owner_user_id
      AND promotion.shared_user_message_id = p_shared_user_message_id
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_PROMOTION_INVALID'
        USING ERRCODE = '40001';
    END IF;
  ELSE
    RAISE EXCEPTION 'AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_CLAIM_STALE'
      USING ERRCODE = '40001';
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
     OR btrim(v_add_input ->> 'title') IS DISTINCT FROM v_add_input ->> 'title'
     OR btrim(v_add_input ->> 'description')
       IS DISTINCT FROM v_add_input ->> 'description' THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_ACTION_INVALID'
      USING ERRCODE = '23514';
  END IF;

  -- Match canonicalAmoraToolInput's sorted ASCII key order exactly. This is
  -- independently recomputed rather than trusting a caller-supplied digest.
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
  IF v_computed_input_digest IS DISTINCT FROM v_promotion.action_digest THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_ACTION_INVALID'
      USING ERRCODE = '23514';
  END IF;
  v_operation_key := encode(
    extensions.digest(
      convert_to('add_amora_action' || chr(10) || v_canonical_input, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  v_confirmation :=
    '다음 변경을 적용할까요?' || chr(10) ||
    '- 변경: 아모라 행동 카드 추가' || chr(10) ||
    '- 제목: ' || to_jsonb(v_add_input ->> 'title')::text || chr(10) ||
    '- 설명: ' || to_jsonb(v_add_input ->> 'description')::text;
  IF char_length(v_confirmation) > 2000 THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_ACTION_INVALID'
      USING ERRCODE = '23514';
  END IF;

  v_expected_visible_request_key :=
    'chat:' || p_owner_user_id::text || ':' ||
    v_promotion.shared_client_request_id::text;
  IF v_promotion.source_criterion_decision_id IS NOT NULL THEN
    v_expected_metadata_keys := array_append(
      v_expected_metadata_keys,
      'amora_couple_criterion_decision_id'
    );
  END IF;

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
       OR v_message.visibility IS DISTINCT FROM 'shared'
       OR v_message.stage_tag IS NOT NULL
       OR v_message.specialist_type IS DISTINCT FROM 'general'
       OR v_message.content IS DISTINCT FROM v_confirmation
       OR jsonb_typeof(v_message.metadata) IS DISTINCT FROM 'object'
       OR v_message.metadata -> 'client_request_id'
         IS DISTINCT FROM to_jsonb(p_chat_request_key)
       OR v_message.metadata -> 'client_visible_request_id'
         IS DISTINCT FROM to_jsonb(v_expected_visible_request_key)
       OR v_message.metadata -> 'in_reply_to_user_message_id'
         IS DISTINCT FROM to_jsonb(p_shared_user_message_id)
       OR v_message.metadata -> 'amora_first_use_promotion_id'
         IS DISTINCT FROM to_jsonb(v_promotion.id)
       OR v_message.metadata -> 'response_origin'
         IS DISTINCT FROM to_jsonb(
           'server_authoritative_first_use_promotion'::text
         )
       OR v_message.metadata -> 'provider_call_count' IS DISTINCT FROM '0'::jsonb
       OR v_message.metadata -> 'question_scope'
         IS DISTINCT FROM to_jsonb('W0_wedding_core'::text)
       OR v_message.metadata -> 'memory_eligible' IS DISTINCT FROM 'false'::jsonb
       OR v_message.metadata -> 'memory_enqueue_requested'
         IS DISTINCT FROM 'false'::jsonb
       OR v_message.metadata -> 'amora_wedding_context_revision'
         IS DISTINCT FROM to_jsonb(v_promotion.source_journey_revision)
       OR v_message.metadata -> 'pending_amora_action_journey_revision'
         IS DISTINCT FROM to_jsonb(v_promotion.source_journey_revision)
       OR (
         v_promotion.source_criterion_decision_id IS NULL
         AND v_message.metadata ? 'amora_couple_criterion_decision_id'
       )
       OR (
         v_promotion.source_criterion_decision_id IS NOT NULL
         AND v_message.metadata -> 'amora_couple_criterion_decision_id'
           IS DISTINCT FROM to_jsonb(
             v_promotion.source_criterion_decision_id
           )
       )
       OR NOT (v_message.metadata ?& v_expected_metadata_keys)
       OR v_message.metadata - v_expected_metadata_keys <> '{}'::jsonb THEN
      RAISE EXCEPTION 'AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_REPLAY_INVALID'
        USING ERRCODE = '55000';
    END IF;

    v_pending := v_message.metadata -> 'pending_amora_action';
    BEGIN
      v_pending_action_id := NULLIF(v_pending ->> 'actionId', '')::uuid;
      v_pending_issued_at := NULLIF(v_pending ->> 'issuedAt', '')::bigint;
      v_pending_expires_at := NULLIF(v_pending ->> 'expiresAt', '')::bigint;
    EXCEPTION
      WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_REPLAY_INVALID'
          USING ERRCODE = '55000';
    END;
    IF jsonb_typeof(v_pending) IS DISTINCT FROM 'object'
       OR NOT (v_pending ?& ARRAY[
         'version', 'actionId', 'tool', 'input', 'inputDigest',
         'operationKey', 'confirmation', 'issuedAt', 'expiresAt'
       ])
       OR v_pending - ARRAY[
         'version', 'actionId', 'tool', 'input', 'inputDigest',
         'operationKey', 'confirmation', 'issuedAt', 'expiresAt'
       ] <> '{}'::jsonb
       OR v_pending -> 'version' IS DISTINCT FROM '2'::jsonb
       OR jsonb_typeof(v_pending -> 'actionId') IS DISTINCT FROM 'string'
       OR v_pending ->> 'actionId' !~
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR v_pending_action_id IS NULL
       OR v_pending -> 'tool'
         IS DISTINCT FROM to_jsonb('add_amora_action'::text)
       OR v_pending -> 'input' IS DISTINCT FROM v_add_input
       OR v_pending -> 'inputDigest'
         IS DISTINCT FROM to_jsonb(v_computed_input_digest)
       OR v_pending -> 'operationKey' IS DISTINCT FROM to_jsonb(v_operation_key)
       OR v_pending -> 'confirmation' IS DISTINCT FROM to_jsonb(v_confirmation)
       OR jsonb_typeof(v_pending -> 'issuedAt') IS DISTINCT FROM 'number'
       OR jsonb_typeof(v_pending -> 'expiresAt') IS DISTINCT FROM 'number'
       OR v_pending ->> 'issuedAt' !~ '^[1-9][0-9]{0,15}$'
       OR v_pending ->> 'expiresAt' !~ '^[1-9][0-9]{0,15}$'
       OR v_pending_issued_at IS NULL
       OR v_pending_issued_at > 9007199254740991
       OR v_pending_expires_at > 9007199254740991
       OR v_message.created_at IS DISTINCT FROM to_timestamp(
         v_pending_issued_at::double precision / 1000.0
       )
       OR v_pending_expires_at IS DISTINCT FROM v_pending_issued_at + 600000 THEN
      RAISE EXCEPTION 'AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_REPLAY_INVALID'
        USING ERRCODE = '55000';
    END IF;

    SELECT binding.*
      INTO v_binding
    FROM public.amora_first_use_action_proposal_bindings AS binding
    WHERE binding.proposal_message_id = v_message.id
      AND binding.couple_id = p_couple_id
      AND binding.action_id = v_pending_action_id
      AND binding.promotion_id = v_promotion.id
      AND binding.shared_user_message_id = p_shared_user_message_id
      AND binding.proposal_journey_revision =
        v_promotion.source_journey_revision
      AND binding.action_digest = v_computed_input_digest
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_REPLAY_INVALID'
        USING ERRCODE = '55000';
    END IF;

    RETURN QUERY SELECT
      'replayed'::text,
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

  SELECT binding.*
    INTO v_binding
  FROM public.amora_first_use_action_proposal_bindings AS binding
  WHERE binding.promotion_id = v_promotion.id
  FOR SHARE;
  IF FOUND THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_REQUEST_CONFLICT'
      USING ERRCODE = '23505';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.chat_messages AS message
    WHERE message.couple_id = p_couple_id
      AND message.metadata ->> 'client_request_id' = p_chat_request_key
  ) THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_REQUEST_CONFLICT'
      USING ERRCODE = '23505';
  END IF;

  v_action_id := gen_random_uuid();
  v_message_id := gen_random_uuid();
  v_issued_at := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  v_pending := jsonb_build_object(
    'version', 2,
    'actionId', v_action_id,
    'tool', 'add_amora_action',
    'input', v_add_input,
    'inputDigest', v_computed_input_digest,
    'operationKey', v_operation_key,
    'confirmation', v_confirmation,
    'issuedAt', v_issued_at,
    'expiresAt', v_issued_at + 600000
  );
  v_metadata := jsonb_strip_nulls(jsonb_build_object(
    'client_request_id', p_chat_request_key,
    'client_visible_request_id', v_expected_visible_request_key,
    'in_reply_to_user_message_id', p_shared_user_message_id,
    'question_scope', 'W0_wedding_core',
    'memory_eligible', false,
    'memory_enqueue_requested', false,
    'amora_wedding_context_revision', v_promotion.source_journey_revision,
    'amora_couple_criterion_decision_id',
      v_promotion.source_criterion_decision_id,
    'pending_amora_action', v_pending,
    'pending_amora_action_journey_revision',
      v_promotion.source_journey_revision,
    'amora_first_use_promotion_id', v_promotion.id,
    'response_origin', 'server_authoritative_first_use_promotion',
    'provider_call_count', 0
  ));

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
    v_message_id,
    p_couple_id,
    NULL,
    'ai',
    NULL,
    'assistant',
    v_confirmation,
    v_metadata,
    'shared',
    NULL,
    'general',
    to_timestamp(v_issued_at::double precision / 1000.0)
  )
  RETURNING * INTO v_message;

  SELECT binding.*
    INTO v_binding
  FROM public.amora_first_use_action_proposal_bindings AS binding
  WHERE binding.proposal_message_id = v_message.id
    AND binding.couple_id = p_couple_id
    AND binding.action_id = v_action_id
    AND binding.promotion_id = v_promotion.id
    AND binding.shared_user_message_id = p_shared_user_message_id
    AND binding.proposal_journey_revision = v_promotion.source_journey_revision
    AND binding.action_digest = v_computed_input_digest
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_BINDING_MISSING'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.amora_chat_request_claims AS claim
  SET status = 'completed',
      message_id = v_message.id,
      completed_at = clock_timestamp(),
      failed_at = NULL,
      failure_code = NULL
  WHERE claim.couple_id = p_couple_id
    AND claim.request_key = p_chat_request_key
    AND claim.user_id = p_owner_user_id
    AND claim.visibility = 'shared'
    AND claim.user_message_id = p_shared_user_message_id
    AND claim.attempt_count = p_chat_claim_attempt_count
    AND claim.status = 'processing';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_CLAIM_STALE'
      USING ERRCODE = '40001';
  END IF;

  RETURN QUERY SELECT
    'persisted'::text,
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

ALTER FUNCTION public.finalize_amora_first_use_action_proposal_v1(
  uuid, uuid, uuid, text, integer, bigint
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.finalize_amora_first_use_action_proposal_v1(
  uuid, uuid, uuid, text, integer, bigint
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_amora_first_use_action_proposal_v1(
  uuid, uuid, uuid, text, integer, bigint
) TO service_role;

COMMENT ON FUNCTION public.finalize_amora_first_use_action_proposal_v1(
  uuid, uuid, uuid, text, integer, bigint
) IS
  'Service-only, provider-free first-use finalizer. It derives one canonical pending action from the immutable promotion, atomically binds the assistant proposal and exact chat claim, and replays only the verified committed result without creating an AI provider receipt.';

DO $postchecks$
DECLARE
  v_function_oid oid := to_regprocedure(
    'public.finalize_amora_first_use_action_proposal_v1(uuid,uuid,uuid,text,integer,bigint)'
  );
BEGIN
  IF v_function_oid IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc AS procedure
       WHERE procedure.oid = v_function_oid
         AND procedure.prosecdef
         AND procedure.proowner = 'postgres'::regrole
     )
     OR has_function_privilege(
       'anon',
       'public.finalize_amora_first_use_action_proposal_v1(uuid,uuid,uuid,text,integer,bigint)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.finalize_amora_first_use_action_proposal_v1(uuid,uuid,uuid,text,integer,bigint)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.finalize_amora_first_use_action_proposal_v1(uuid,uuid,uuid,text,integer,bigint)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_POSTCHECK_FAILED';
  END IF;
END
$postchecks$;

COMMIT;
