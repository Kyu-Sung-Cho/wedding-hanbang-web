BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $preconditions$
BEGIN
  IF to_regclass('public.couples') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.wedding_journeys') IS NULL
     OR to_regclass('public.amora_privacy_context_epochs') IS NULL
     OR to_regclass('public.chat_messages') IS NULL
     OR to_regclass('public.amora_chat_request_claims') IS NULL
     OR to_regclass('public.amora_shared_action_application_claims') IS NULL
     OR to_regclass('public.amora_tool_executions') IS NULL
     OR to_regclass('public.amora_actions') IS NULL
     OR to_regclass('public.ai_interactions_log') IS NULL
     OR to_regprocedure('auth.role()') IS NULL
     OR to_regprocedure(
       'public.amora_shared_action_context(uuid,uuid,uuid,uuid,text,uuid)'
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
     OR to_regprocedure('extensions.digest(bytea,text)') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_attribute AS attribute
       WHERE attribute.attrelid = 'public.ai_interactions_log'::regclass
         AND attribute.attname = 'amora_call_index'
         AND NOT attribute.attisdropped
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_attribute AS attribute
       WHERE attribute.attrelid = 'public.ai_interactions_log'::regclass
         AND attribute.attname = 'success'
         AND NOT attribute.attisdropped
     ) THEN
    RAISE EXCEPTION
      'AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_PREREQUISITE_MISSING';
  END IF;
END
$preconditions$;

CREATE FUNCTION public.finalize_amora_provider_backed_add_action_application_v1(
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
  v_source_claim public.amora_chat_request_claims%ROWTYPE;
  v_source public.chat_messages%ROWTYPE;
  v_source_user public.chat_messages%ROWTYPE;
  v_confirmation public.chat_messages%ROWTYPE;
  v_message public.chat_messages%ROWTYPE;
  v_source_receipt public.ai_interactions_log%ROWTYPE;
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
  v_expected_metadata jsonb;
  v_canonical_input text;
  v_computed_input_digest text;
  v_computed_operation_key text;
  v_normalized_title text;
  v_normalized_description text;
  v_due_date text;
  v_category_key text;
  v_priority text;
  v_source_name text;
  v_href text;
  v_pending_action_id uuid;
  v_pending_issued_at bigint;
  v_pending_expires_at bigint;
  v_pending_journey_revision bigint;
  v_privacy_epoch bigint;
  v_journey_revision bigint;
  v_request_digest text;
  v_request_uuid text;
  v_expected_request_key text;
  v_visible_request_uuid text;
  v_expected_visible_request_key text;
  v_domain_action_id text;
  v_display_message text;
  v_prior_message_id uuid;
  v_latest_receipt_index integer;
  v_latest_receipt_count integer;
  v_confirmation_keys text[] := ARRAY[
    'client_request_id',
    'confirmed_amora_action_id',
    'amora_ingest_contract_version',
    'ai_response_requested',
    'provider_attachment_state',
    'provider_attachment_count'
  ];
  v_expected_metadata_keys text[] := ARRAY[
    'client_request_id',
    'client_visible_request_id',
    'in_reply_to_user_message_id',
    'confirmed_amora_action_id',
    'source_amora_action_message_id',
    'question_scope',
    'memory_eligible',
    'memory_enqueue_requested',
    'amora_wedding_context_revision',
    'toolResults',
    'toolsUsed',
    'persistence_terminal_source',
    'response_origin',
    'provider_call_count'
  ];
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION
      'AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_SERVICE_ROLE_REQUIRED'
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
    RAISE EXCEPTION
      'AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_INVALID'
      USING ERRCODE = '22023';
  END IF;

  -- Exact application claim is always the first row lock. The non-locking
  -- source probe below discovers only the pending capability UUID.
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
    RAISE EXCEPTION
      'AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_CLAIM_STALE'
      USING ERRCODE = '40001';
  END IF;
  IF v_claim.status NOT IN ('processing', 'completed') THEN
    RAISE EXCEPTION
      'AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_CLAIM_STALE'
      USING ERRCODE = '40001';
  END IF;
  IF v_claim.status = 'completed'
     AND (
       v_claim.message_id IS NULL
       OR v_claim.completed_at IS NULL
       OR v_claim.failed_at IS NOT NULL
       OR v_claim.failure_code IS NOT NULL
     ) THEN
    RAISE EXCEPTION
      'AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_REPLAY_INVALID'
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
    RAISE EXCEPTION
      'AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_PROPOSAL_MISMATCH'
      USING ERRCODE = '23514';
  END;
  IF v_pending_action_id IS NULL THEN
    RAISE EXCEPTION
      'AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_PROPOSAL_MISMATCH'
      USING ERRCODE = '23514';
  END IF;

  IF v_claim.status = 'processing' THEN
    -- Existing shared-action context establishes couple -> action advisory ->
    -- source locks. The explicit epoch/journey locks complete one current
    -- snapshot before authorization consumes the exact application lease.
    v_context := public.amora_shared_action_context(
      v_pending_action_id,
      p_couple_id,
      p_source_proposal_message_id,
      p_actor_user_id,
      'execution',
      p_confirmation_message_id
    );
    IF v_context ->> 'tool' IS DISTINCT FROM 'add_amora_action'
       OR jsonb_typeof(v_context -> 'input') IS DISTINCT FROM 'object'
       OR COALESCE(v_context ->> 'inputDigest', '') !~ '^[a-f0-9]{64}$'
       OR COALESCE(v_context ->> 'operationKey', '') !~ '^[a-f0-9]{64}$'
       OR COALESCE(v_context ->> 'journeyRevision', '') !~
         '^(0|[1-9][0-9]{0,15})$' THEN
      RAISE EXCEPTION
        'AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_PROPOSAL_MISMATCH'
        USING ERRCODE = '23514';
    END IF;

    SELECT privacy.epoch
      INTO v_privacy_epoch
    FROM public.amora_privacy_context_epochs AS privacy
    WHERE privacy.couple_id = p_couple_id
    FOR UPDATE;
    IF NOT FOUND
       OR v_privacy_epoch IS DISTINCT FROM p_expected_privacy_epoch THEN
      RAISE EXCEPTION
        'AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_PRIVACY_STALE'
        USING ERRCODE = '40001';
    END IF;

    SELECT journey.state_revision
      INTO v_journey_revision
    FROM public.wedding_journeys AS journey
    WHERE journey.couple_id = p_couple_id
    FOR SHARE;
    IF NOT FOUND
       OR v_journey_revision IS DISTINCT FROM
         (v_context ->> 'journeyRevision')::bigint THEN
      RAISE EXCEPTION
        'AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_PROPOSAL_STALE'
        USING ERRCODE = '40001';
    END IF;

    v_authorization := public.authorize_amora_shared_action_execution(
      v_pending_action_id,
      p_couple_id,
      p_source_proposal_message_id,
      p_confirmation_message_id,
      p_actor_user_id
    );
    IF v_authorization -> 'authorized' IS DISTINCT FROM 'true'::jsonb
       OR v_authorization -> 'ready' IS DISTINCT FROM 'true'::jsonb
       OR v_authorization ->> 'tool' IS DISTINCT FROM 'add_amora_action'
       OR v_authorization ->> 'inputDigest' IS DISTINCT FROM
         v_context ->> 'inputDigest'
       OR v_authorization ->> 'operationKey' IS DISTINCT FROM
         v_context ->> 'operationKey'
       OR v_authorization ->> 'journeyRevision' IS DISTINCT FROM
         v_context ->> 'journeyRevision' THEN
      RAISE EXCEPTION
        'AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_NOT_AUTHORIZED'
        USING ERRCODE = '42501';
    END IF;
  END IF;

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
  IF v_source.id IS NULL OR v_confirmation.id IS NULL THEN
    RAISE EXCEPTION
      'AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_PROPOSAL_MISMATCH'
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
     OR v_confirmation.sender_role IS NOT NULL
     OR v_confirmation.role IS DISTINCT FROM 'user'
     OR v_confirmation.visibility IS DISTINCT FROM 'shared'
     OR v_confirmation.stage_tag IS NOT NULL
     OR v_confirmation.specialist_type IS NOT NULL
     OR v_confirmation.content IS DISTINCT FROM
       '좋아요. 제안한 변경을 적용해 주세요.'
     OR jsonb_typeof(v_confirmation.metadata) IS DISTINCT FROM 'object'
     OR v_confirmation.metadata - v_confirmation_keys <> '{}'::jsonb
     OR jsonb_typeof(
       v_confirmation.metadata -> 'confirmed_amora_action_id'
     ) IS DISTINCT FROM 'string'
     OR v_confirmation.metadata ->> 'confirmed_amora_action_id'
       IS DISTINCT FROM v_pending_action_id::text
     OR jsonb_typeof(v_confirmation.metadata -> 'client_request_id')
       IS DISTINCT FROM 'string'
     OR COALESCE(v_confirmation.metadata ->> 'client_request_id', '') !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR COALESCE(v_confirmation.metadata ->> 'target', '') = 'partner'
     OR v_confirmation.metadata ? 'imagePaths'
     OR v_confirmation.metadata ? 'provider_attachment_manifest'
     OR v_confirmation.metadata ? 'amora_schedule_care_follow_up_v1'
     OR (
       v_confirmation.metadata ? 'provider_attachment_count'
       AND v_confirmation.metadata -> 'provider_attachment_count'
         IS DISTINCT FROM '0'::jsonb
     )
     OR (
       v_confirmation.metadata ? 'provider_attachment_state'
       AND v_confirmation.metadata ->> 'provider_attachment_state'
         IS DISTINCT FROM 'none'
     )
     OR (
       v_confirmation.metadata ? 'ai_response_requested'
       AND v_confirmation.metadata -> 'ai_response_requested'
         IS DISTINCT FROM 'true'::jsonb
     )
     OR (
       v_confirmation.metadata ? 'amora_ingest_contract_version'
       AND v_confirmation.metadata -> 'amora_ingest_contract_version'
         NOT IN ('1'::jsonb, '2'::jsonb)
     )
     OR v_prior_message_id IS DISTINCT FROM
       p_source_proposal_message_id THEN
    RAISE EXCEPTION
      'AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_CONFIRMATION_MISMATCH'
      USING ERRCODE = '23514';
  END IF;

  v_pending := v_source.metadata -> 'pending_amora_action';
  BEGIN
    v_pending_action_id := NULLIF(v_pending ->> 'actionId', '')::uuid;
    v_pending_issued_at := NULLIF(v_pending ->> 'issuedAt', '')::bigint;
    v_pending_expires_at := NULLIF(v_pending ->> 'expiresAt', '')::bigint;
    v_pending_journey_revision := NULLIF(
      v_source.metadata ->> 'pending_amora_action_journey_revision', ''
    )::bigint;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION
        'AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_PROPOSAL_MISMATCH'
        USING ERRCODE = '23514';
  END;
  IF v_source.sender_id IS NOT NULL
     OR v_source.sender_type IS DISTINCT FROM 'ai'
     OR v_source.sender_role IS NOT NULL
     OR v_source.role IS DISTINCT FROM 'assistant'
     OR v_source.visibility IS DISTINCT FROM 'shared'
     OR COALESCE(v_source.metadata ->> 'target', '') = 'partner'
     OR v_source.content IS DISTINCT FROM v_pending ->> 'confirmation'
     OR v_source.metadata -> 'amora_add_action_proposal_origin_v1'
       IS DISTINCT FROM to_jsonb('ordinary_provider'::text)
     OR v_source.metadata -> 'question_scope'
       IS DISTINCT FROM to_jsonb('W0_wedding_core'::text)
     OR v_source.metadata ? 'response_origin'
     OR v_source.metadata ? 'provider_call_count'
     OR v_source.metadata ? 'persistence_terminal_source'
     OR v_source.metadata ? 'amora_first_use_grounding'
     OR v_source.metadata ? 'amora_first_use_action_promotion_v1'
     OR v_source.metadata ? 'amora_first_use_promotion_id'
     OR v_source.metadata ? 'amora_schedule_care_follow_up_v1'
     OR v_source.metadata ? 'amora_schedule_care_action_draft_v1'
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
     OR char_length(v_pending ->> 'confirmation') NOT BETWEEN 1 AND 2000
     OR v_pending_action_id IS NULL
     OR v_pending_issued_at IS NULL
     OR v_pending_expires_at IS NULL
     OR v_pending_journey_revision IS NULL
     OR v_pending_issued_at NOT BETWEEN 0 AND 9007199254740991
     OR v_pending_expires_at NOT BETWEEN 0 AND 9007199254740991
     OR v_pending_journey_revision NOT BETWEEN 0 AND 9007199254740991
     OR v_pending_expires_at IS DISTINCT FROM v_pending_issued_at + 600000
     OR v_source.metadata -> 'amora_wedding_context_revision'
       IS DISTINCT FROM to_jsonb(v_pending_journey_revision)
     OR (
       v_claim.status = 'processing'
       AND (
         v_context ->> 'journeyRevision' IS DISTINCT FROM
           v_pending_journey_revision::text
         OR v_context -> 'input' IS DISTINCT FROM v_pending -> 'input'
       )
     ) THEN
    RAISE EXCEPTION
      'AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_PROPOSAL_MISMATCH'
      USING ERRCODE = '23514';
  END IF;

  -- The proposal itself is provider-authored only when its exact completed
  -- chat claim and the unique highest durable provider call both prove it.
  SELECT source_claim.*
    INTO v_source_claim
  FROM public.amora_chat_request_claims AS source_claim
  WHERE source_claim.couple_id = p_couple_id
    AND source_claim.request_key = v_source.metadata ->> 'client_request_id'
  FOR SHARE;
  IF NOT FOUND
     OR v_source_claim.visibility IS DISTINCT FROM 'shared'
     OR v_source_claim.status IS DISTINCT FROM 'completed'
     OR v_source_claim.user_message_id IS NULL
     OR v_source_claim.message_id IS DISTINCT FROM v_source.id
     OR v_source_claim.completed_at IS NULL
     OR v_source_claim.failed_at IS NOT NULL
     OR v_source_claim.failure_code IS NOT NULL
     OR v_source.metadata -> 'in_reply_to_user_message_id'
       IS DISTINCT FROM to_jsonb(v_source_claim.user_message_id)
     OR COALESCE(v_source.metadata ->> 'client_request_id', '') !~ (
       '^chat:' || v_source_claim.user_id::text ||
       ':[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     ) THEN
    RAISE EXCEPTION
      'AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_SOURCE_PROVENANCE_INVALID'
      USING ERRCODE = '23514';
  END IF;

  SELECT source_user.*
    INTO v_source_user
  FROM public.chat_messages AS source_user
  WHERE source_user.id = v_source_claim.user_message_id
    AND source_user.couple_id = p_couple_id
  FOR SHARE;
  IF NOT FOUND
     OR v_source_user.sender_id IS DISTINCT FROM v_source_claim.user_id
     OR v_source_user.sender_type NOT IN ('bride', 'groom')
     OR v_source_user.sender_role IS NOT NULL
     OR v_source_user.role IS DISTINCT FROM 'user'
     OR v_source_user.visibility IS DISTINCT FROM 'shared'
     OR COALESCE(v_source_user.metadata ->> 'target', '') = 'partner'
     OR jsonb_typeof(v_source_user.metadata) IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_source_user.metadata -> 'client_request_id')
       IS DISTINCT FROM 'string'
     OR COALESCE(v_source_user.metadata ->> 'client_request_id', '') !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR v_source_claim.request_key IS DISTINCT FROM
       'chat:' || v_source_claim.user_id::text || ':' ||
       (v_source_user.metadata ->> 'client_request_id')
     OR v_source_user.metadata ? 'imagePaths'
     OR v_source_user.metadata ? 'provider_attachment_manifest'
     OR v_source_user.metadata ? 'amora_schedule_care_follow_up_v1'
     OR v_source_user.metadata ? 'amora_schedule_care_action_draft_v1'
     OR (
       v_source_user.metadata ? 'provider_attachment_count'
       AND v_source_user.metadata -> 'provider_attachment_count'
         IS DISTINCT FROM '0'::jsonb
     )
     OR (
       v_source_user.metadata ? 'provider_attachment_state'
       AND v_source_user.metadata ->> 'provider_attachment_state'
         IS DISTINCT FROM 'none'
     )
     OR (
       v_source_user.metadata ? 'ai_response_requested'
       AND v_source_user.metadata -> 'ai_response_requested'
         IS DISTINCT FROM 'true'::jsonb
     )
     OR (
       v_source_user.metadata ? 'amora_ingest_contract_version'
       AND v_source_user.metadata -> 'amora_ingest_contract_version'
         NOT IN ('1'::jsonb, '2'::jsonb)
     ) THEN
    RAISE EXCEPTION
      'AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_SOURCE_PROVENANCE_INVALID'
      USING ERRCODE = '23514';
  END IF;

  SELECT max(receipt.amora_call_index)
    INTO v_latest_receipt_index
  FROM public.ai_interactions_log AS receipt
  WHERE receipt.couple_id = p_couple_id
    AND receipt.user_id = v_source_claim.user_id
    AND receipt.amora_request_key =
      v_source.metadata ->> 'client_request_id'
    AND receipt.amora_call_source = 'durable'
    AND receipt.amora_call_phase IN ('tool_round', 'final_no_tool');
  SELECT count(*)::integer
    INTO v_latest_receipt_count
  FROM public.ai_interactions_log AS receipt
  WHERE receipt.couple_id = p_couple_id
    AND receipt.user_id = v_source_claim.user_id
    AND receipt.amora_request_key =
      v_source.metadata ->> 'client_request_id'
    AND receipt.amora_call_source = 'durable'
    AND receipt.amora_call_phase IN ('tool_round', 'final_no_tool')
    AND receipt.amora_call_index = v_latest_receipt_index;
  SELECT receipt.*
    INTO v_source_receipt
  FROM public.ai_interactions_log AS receipt
  WHERE receipt.couple_id = p_couple_id
    AND receipt.user_id = v_source_claim.user_id
    AND receipt.amora_request_key =
      v_source.metadata ->> 'client_request_id'
    AND receipt.amora_call_source = 'durable'
    AND receipt.amora_call_phase IN ('tool_round', 'final_no_tool')
    AND receipt.amora_call_index = v_latest_receipt_index
  ORDER BY receipt.id
  LIMIT 1;
  IF v_latest_receipt_index IS NULL
     OR v_latest_receipt_count IS DISTINCT FROM 1
     OR v_source_receipt.id IS NULL
     OR v_source_receipt.amora_cost_status IS DISTINCT FROM 'settled'
     OR v_source_receipt.success IS DISTINCT FROM true THEN
    RAISE EXCEPTION
      'AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_SOURCE_RECEIPT_INVALID'
      USING ERRCODE = '23514';
  END IF;

  v_add_input := v_pending -> 'input';
  IF jsonb_typeof(v_add_input) IS DISTINCT FROM 'object'
     OR NOT (v_add_input ? 'title')
     OR v_add_input - ARRAY[
       'title', 'description', 'due_date', 'category_key',
       'priority', 'source', 'href'
     ] <> '{}'::jsonb
     OR jsonb_typeof(v_add_input -> 'title') IS DISTINCT FROM 'string'
     OR (
       v_add_input ? 'description'
       AND jsonb_typeof(v_add_input -> 'description')
         IS DISTINCT FROM 'string'
     )
     OR (
       v_add_input ? 'due_date'
       AND jsonb_typeof(v_add_input -> 'due_date')
         IS DISTINCT FROM 'string'
     )
     OR (
       v_add_input ? 'category_key'
       AND jsonb_typeof(v_add_input -> 'category_key')
         IS DISTINCT FROM 'string'
     )
     OR (
       v_add_input ? 'priority'
       AND jsonb_typeof(v_add_input -> 'priority')
         IS DISTINCT FROM 'string'
     )
     OR (
       v_add_input ? 'source'
       AND jsonb_typeof(v_add_input -> 'source')
         IS DISTINCT FROM 'string'
     )
     OR (
       v_add_input ? 'href'
       AND jsonb_typeof(v_add_input -> 'href')
         IS DISTINCT FROM 'string'
     )
     -- ECMAScript \s and PostgreSQL POSIX whitespace disagree for these
     -- Unicode code points. The route's strict receipt parser uses JS
     -- normalization, so fail closed before any durable mutation.
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.unnest(ARRAY[
         133, 160, 5760,
         8192, 8193, 8194, 8195, 8196, 8197,
         8198, 8199, 8200, 8201, 8202,
         8232, 8233, 8239, 8287, 12288, 65279
       ]) AS whitespace(code_point)
       WHERE pg_catalog.strpos(
         COALESCE(v_add_input ->> 'title', ''),
         pg_catalog.chr(whitespace.code_point)
       ) > 0
          OR pg_catalog.strpos(
            COALESCE(v_add_input ->> 'description', ''),
            pg_catalog.chr(whitespace.code_point)
          ) > 0
     )
     -- The current private atomic dispatcher trims plain spaces before its
     -- POSIX collapse, while the TypeScript builder collapses then trims.
     -- Admit only inputs for which both predecessor semantics are identical.
     OR regexp_replace(
       btrim(v_add_input ->> 'title'), '[[:space:]]+', ' ', 'g'
     ) IS DISTINCT FROM btrim(regexp_replace(
       v_add_input ->> 'title', '[[:space:]]+', ' ', 'g'
     ))
     OR (
       v_add_input ? 'description'
       AND regexp_replace(
         btrim(v_add_input ->> 'description'), '[[:space:]]+', ' ', 'g'
       ) IS DISTINCT FROM btrim(regexp_replace(
         v_add_input ->> 'description', '[[:space:]]+', ' ', 'g'
       ))
     ) THEN
    RAISE EXCEPTION
      'AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_INPUT_INVALID'
      USING ERRCODE = '23514';
  END IF;

  -- PostgreSQL char_length counts Unicode code points while the TypeScript
  -- atomic builder's String.length counts UTF-16 code units. A non-BMP code
  -- point can therefore pass a SQL limit and fail strict receipt parsing
  -- after commit. This narrow provider-free path rejects that drift before
  -- claiming or applying the tool execution.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_each_text(v_add_input) AS entry(key, value)
    CROSS JOIN LATERAL pg_catalog.generate_series(
      0,
      pg_catalog.octet_length(
        pg_catalog.convert_to(entry.value, 'UTF8')
      ) - 1
    ) AS byte_offset(position)
    WHERE entry.key IN ('title', 'description', 'href')
      AND pg_catalog.get_byte(
        pg_catalog.convert_to(entry.value, 'UTF8'),
        byte_offset.position
      ) BETWEEN 240 AND 244
  ) THEN
    RAISE EXCEPTION
      'AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_INPUT_INVALID'
      USING ERRCODE = '23514';
  END IF;

  v_normalized_title := btrim(regexp_replace(
    v_add_input ->> 'title', '[[:space:]]+', ' ', 'g'
  ));
  v_normalized_description := CASE
    WHEN v_add_input ? 'description' THEN NULLIF(btrim(regexp_replace(
      v_add_input ->> 'description', '[[:space:]]+', ' ', 'g'
    )), '')
    ELSE NULL
  END;
  v_due_date := CASE
    WHEN v_add_input ? 'due_date' THEN v_add_input ->> 'due_date'
    ELSE NULL
  END;
  v_category_key := CASE
    WHEN COALESCE(v_add_input ->> 'category_key', 'general') = 'general'
      THEN NULL
    ELSE v_add_input ->> 'category_key'
  END;
  v_priority := COALESCE(v_add_input ->> 'priority', 'medium');
  v_source_name := COALESCE(v_add_input ->> 'source', 'chat');
  IF char_length(v_normalized_title) NOT BETWEEN 1 AND 120
     OR char_length(COALESCE(v_normalized_description, '')) > 500
     OR COALESCE(v_add_input ->> 'category_key', 'general') NOT IN (
       'general', 'meeting', 'venue', 'studio', 'dress', 'makeup', 'ring',
       'hanbok', 'yedan', 'honeymoon', 'houseware', 'housing',
       'invitation', 'snap', 'shoes', 'bouquet', 'gift', 'mc', 'ham',
       'pyebaek'
     )
     OR v_priority NOT IN ('high', 'medium', 'low')
     OR v_source_name NOT IN (
       'chat', 'quote', 'schedule', 'budget', 'guardrail', 'manual'
     )
     -- Current TS and atomic-SQL defaults disagree for these two legacy
     -- categories. An explicit href is unambiguous; an omitted one remains on
     -- the provider-backed legacy path until that dispatcher drift is fixed.
     OR (
       NOT (v_add_input ? 'href')
       AND v_category_key IN ('mc', 'gift')
     ) THEN
    RAISE EXCEPTION
      'AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_INPUT_INVALID'
      USING ERRCODE = '23514';
  END IF;
  IF v_due_date IS NOT NULL THEN
    BEGIN
      IF char_length(v_due_date) > 40
         OR to_char(v_due_date::date, 'YYYY-MM-DD') IS DISTINCT FROM
           v_due_date THEN
        RAISE EXCEPTION 'invalid date';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION
        'AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_INPUT_INVALID'
        USING ERRCODE = '23514';
    END;
  END IF;
  IF v_add_input ? 'href' THEN
    v_href := v_add_input ->> 'href';
    IF left(v_href, 1) <> '/' OR char_length(v_href) > 180 THEN
      RAISE EXCEPTION
        'AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_INPUT_INVALID'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    v_href := CASE
      WHEN v_source_name = 'quote'
        THEN '/wedding/community/quote-check'
      WHEN v_source_name = 'budget'
        THEN '/wedding/budget'
      WHEN v_source_name = 'schedule'
        OR v_category_key = 'invitation'
        THEN '/wedding/schedule'
      ELSE '/wedding/lounge'
    END;
  END IF;

  SELECT '{' || string_agg(
      to_jsonb(entry.key)::text || ':' || entry.value::text,
      ',' ORDER BY entry.key
    ) || '}'
    INTO v_canonical_input
  FROM jsonb_each(v_add_input) AS entry;
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
  IF v_pending ->> 'inputDigest' IS DISTINCT FROM
       v_computed_input_digest
     OR v_pending ->> 'operationKey' IS DISTINCT FROM
       v_computed_operation_key
     OR (
       v_claim.status = 'processing'
       AND (
         v_context ->> 'inputDigest' IS DISTINCT FROM
           v_computed_input_digest
         OR v_context ->> 'operationKey' IS DISTINCT FROM
           v_computed_operation_key
         OR v_authorization ->> 'inputDigest' IS DISTINCT FROM
           v_computed_input_digest
         OR v_authorization ->> 'operationKey' IS DISTINCT FROM
           v_computed_operation_key
       )
     ) THEN
    RAISE EXCEPTION
      'AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_INPUT_INVALID'
      USING ERRCODE = '23514';
  END IF;

  -- Exact parity with deriveConfirmedActionRequestId in the web route.
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
      'AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_REQUEST_KEY_MISMATCH'
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
    'dueDate', v_due_date,
    'categoryKey', v_category_key,
    'priority', v_priority,
    'status', 'open',
    'source', v_source_name,
    'href', v_href
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
      RAISE EXCEPTION
        'AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_EXECUTION_BUSY'
        USING ERRCODE = '40001';
    ELSIF v_tool_claim ->> 'action' = 'conflict' THEN
      RAISE EXCEPTION
        'AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_EXECUTION_CONFLICT'
        USING ERRCODE = '23505';
    ELSE
      RAISE EXCEPTION
        'AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_EXECUTION_INVALID'
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
     OR v_execution.tool_name IS DISTINCT FROM 'add_amora_action'
     OR v_execution.input_digest IS DISTINCT FROM
       v_computed_input_digest
     OR v_execution.status IS DISTINCT FROM 'completed'
     OR jsonb_typeof(v_execution.result) IS DISTINCT FROM 'object'
     OR v_execution.pending_action_journey_revision IS DISTINCT FROM
       v_pending_journey_revision THEN
    RAISE EXCEPTION
      'AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_EXECUTION_INVALID'
      USING ERRCODE = '55000';
  END IF;
  IF v_claim.status = 'completed' THEN
    v_durable_result := v_execution.result;
  ELSIF v_execution.result IS DISTINCT FROM v_durable_result THEN
    RAISE EXCEPTION
      'AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_EXECUTION_INVALID'
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
       OR v_action.first_use_promotion_id IS NOT NULL
       OR v_action.title IS DISTINCT FROM v_normalized_title
       OR v_action.description IS DISTINCT FROM v_normalized_description
       OR v_action.due_date IS DISTINCT FROM v_due_date
       OR v_action.category_key IS DISTINCT FROM v_category_key
       OR v_action.priority IS DISTINCT FROM v_priority
       OR v_action.status IS DISTINCT FROM 'open'
       OR v_action.source IS DISTINCT FROM v_source_name
       OR v_action.href IS DISTINCT FROM v_href THEN
      RAISE EXCEPTION
        'AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_RESULT_INVALID'
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
    -- Action rows remain editable. Replay authenticates the immutable tool
    -- execution snapshot and never compares it to today's action state.
    v_expected_action_output := v_durable_result #> '{toolOutput,action}';
    IF jsonb_typeof(v_expected_action_output) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_expected_action_output -> 'createdAt')
         IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_expected_action_output -> 'updatedAt')
         IS DISTINCT FROM 'string'
       OR (
         v_expected_action_output
           - ARRAY['createdAt', 'updatedAt', 'completedAt']
       ) IS DISTINCT FROM jsonb_strip_nulls(v_domain_action)
       OR v_expected_action_output - ARRAY[
         'id', 'title', 'description', 'dueDate', 'categoryKey',
         'priority', 'status', 'source', 'href',
         'createdAt', 'updatedAt', 'completedAt'
       ] <> '{}'::jsonb THEN
      RAISE EXCEPTION
        'AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_REPLAY_INVALID'
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
    RAISE EXCEPTION
      'AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_RESULT_INVALID'
      USING ERRCODE = '55000';
  END IF;

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
    'source_amora_action_message_id', p_source_proposal_message_id,
    'question_scope', 'W0_wedding_core',
    'memory_eligible', false,
    'memory_enqueue_requested', false,
    'amora_wedding_context_revision', v_pending_journey_revision,
    'toolResults', jsonb_build_array(v_public_tool_result),
    'toolsUsed', jsonb_build_array('add_amora_action'),
    'persistence_terminal_source', 'server_mutation_receipts',
    'response_origin',
      'server_authoritative_provider_backed_add_action_application',
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
       OR jsonb_typeof(v_message.metadata) IS DISTINCT FROM 'object'
       OR v_message.metadata IS DISTINCT FROM v_expected_metadata
       OR NOT (v_message.metadata ?& v_expected_metadata_keys)
       OR v_message.metadata - v_expected_metadata_keys <> '{}'::jsonb
       OR v_message.visibility IS DISTINCT FROM 'shared'
       OR v_message.stage_tag IS NOT NULL
       OR v_message.specialist_type IS DISTINCT FROM 'general' THEN
      RAISE EXCEPTION
        'AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_REPLAY_INVALID'
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
    RAISE EXCEPTION
      'AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_CLAIM_STALE'
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

ALTER FUNCTION public.finalize_amora_provider_backed_add_action_application_v1(
  uuid, uuid, uuid, uuid, text, integer, bigint
) OWNER TO postgres;
REVOKE ALL ON FUNCTION
  public.finalize_amora_provider_backed_add_action_application_v1(
    uuid, uuid, uuid, uuid, text, integer, bigint
  ) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.finalize_amora_provider_backed_add_action_application_v1(
    uuid, uuid, uuid, uuid, text, integer, bigint
  ) TO service_role;

COMMENT ON FUNCTION
  public.finalize_amora_provider_backed_add_action_application_v1(
    uuid, uuid, uuid, uuid, text, integer, bigint
  ) IS
  'Service-only provider-free application of one positively sealed ordinary provider-generated add_amora_action proposal. It proves the completed source claim and highest settled successful source provider receipt, derives the exact mutation server-side, atomically commits action/tool/assistant/chat claim, and exactly replays only the immutable committed receipt.';

DO $postchecks$
DECLARE
  v_function_oid oid := to_regprocedure(
    'public.finalize_amora_provider_backed_add_action_application_v1(uuid,uuid,uuid,uuid,text,integer,bigint)'
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
       'public.finalize_amora_provider_backed_add_action_application_v1(uuid,uuid,uuid,uuid,text,integer,bigint)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.finalize_amora_provider_backed_add_action_application_v1(uuid,uuid,uuid,uuid,text,integer,bigint)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.finalize_amora_provider_backed_add_action_application_v1(uuid,uuid,uuid,uuid,text,integer,bigint)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_POSTCHECK_FAILED';
  END IF;
END
$postchecks$;

COMMIT;
