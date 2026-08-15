BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $preconditions$
BEGIN
  IF to_regclass('public.couples') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.wedding_journeys') IS NULL
     OR to_regclass('public.decision_nodes') IS NULL
     OR to_regclass('public.amora_privacy_context_epochs') IS NULL
     OR to_regclass('public.chat_messages') IS NULL
     OR to_regclass('public.amora_actions') IS NULL
     OR to_regclass('public.amora_shared_action_acceptances') IS NULL
     OR to_regclass('public.amora_shared_action_application_claims') IS NULL
     OR to_regclass('public.amora_chat_request_claims') IS NULL
     OR to_regclass('public.amora_tool_executions') IS NULL
     OR to_regclass('public.ai_interactions_log') IS NULL
     OR to_regprocedure('auth.role()') IS NULL
     OR to_regprocedure(
       'public.amora_shared_action_context(uuid,uuid,uuid,uuid,text,uuid)'
     ) IS NULL
     OR to_regprocedure(
       'public.finalize_amora_chat_response_with_privacy_fence(uuid,uuid,uuid,uuid,text,text,integer,bigint,text,jsonb,text,text,boolean,text,bigint,boolean,text,text,integer,integer,integer,jsonb)'
     ) IS NULL
     OR to_regprocedure('extensions.digest(bytea,text)') IS NULL THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_PREREQUISITE_MISSING';
  END IF;
END
$preconditions$;

ALTER FUNCTION public.finalize_amora_chat_response_with_privacy_fence(
  uuid, uuid, uuid, uuid, text, text, integer, bigint, text, jsonb, text,
  text, boolean, text, bigint, boolean, text, text, integer, integer,
  integer, jsonb
) RENAME TO finalize_amora_chat_response_with_privacy_fence_inner_v1;
REVOKE ALL ON FUNCTION
  public.finalize_amora_chat_response_with_privacy_fence_inner_v1(
    uuid, uuid, uuid, uuid, text, text, integer, bigint, text, jsonb, text,
    text, boolean, text, bigint, boolean, text, text, integer, integer,
    integer, jsonb
  ) FROM PUBLIC, anon, authenticated, service_role;

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
)
RETURNS TABLE(
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
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_receipt public.ai_interactions_log%ROWTYPE;
  v_claim public.amora_chat_request_claims%ROWTYPE;
  v_expected_request_key boolean;
  v_is_conflict_mediation boolean;
  v_requires_couple_update boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_CHAT_RESPONSE_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF p_receipt_id IS NULL
     OR p_receipt_claim_token IS NULL
     OR p_chat_couple_id IS NULL
     OR p_chat_user_id IS NULL
     OR p_chat_request_key IS NULL
     OR char_length(p_chat_request_key) NOT BETWEEN 1 AND 160
     OR p_chat_visibility NOT IN (
       'shared', 'bride_private', 'groom_private'
     )
     OR p_chat_claim_attempt_count IS NULL
     OR p_chat_claim_attempt_count < 1
     OR p_expected_privacy_epoch IS NULL
     OR p_expected_privacy_epoch < 1
     OR p_message_content IS NULL
     OR char_length(btrim(p_message_content)) < 1
     OR octet_length(p_message_content) > 131072
     OR p_message_metadata IS NULL
     OR jsonb_typeof(p_message_metadata) IS DISTINCT FROM 'object'
     OR pg_column_size(p_message_metadata) > 262144
     OR (
       p_message_stage_tag IS NOT NULL
       AND char_length(p_message_stage_tag) > 100
     )
     OR (
       p_message_specialist_type IS NOT NULL
       AND char_length(p_message_specialist_type) > 100
     )
     OR p_provider_attempted IS DISTINCT FROM true
     OR p_success IS DISTINCT FROM true
     OR p_receipt_metadata IS NULL
     OR jsonb_typeof(p_receipt_metadata) IS DISTINCT FROM 'object'
     OR pg_column_size(p_receipt_metadata) > 65536
  THEN
    RAISE EXCEPTION 'AMORA_CHAT_RESPONSE_INVALID_INPUT'
      USING ERRCODE = '22023';
  END IF;

  -- Keep the established receipt -> exact claim prefix. Couple-level locks
  -- happen only after both identities have been proven to belong to this
  -- terminal call, so caller metadata cannot lock an unrelated couple.
  SELECT * INTO v_receipt
  FROM public.ai_interactions_log AS receipt
  WHERE receipt.id = p_receipt_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_receipt.amora_claim_token IS DISTINCT FROM p_receipt_claim_token
     OR v_receipt.couple_id IS DISTINCT FROM p_chat_couple_id
     OR v_receipt.user_id IS DISTINCT FROM p_chat_user_id
     OR v_receipt.amora_cost_status NOT IN ('reserved', 'settled', 'unknown')
  THEN
    RAISE EXCEPTION 'AMORA_CHAT_RESPONSE_RECEIPT_INVALID'
      USING ERRCODE = '22023';
  END IF;

  v_expected_request_key :=
    (
      v_receipt.amora_call_source = 'durable'
      AND v_receipt.amora_call_phase IN ('tool_round', 'final_no_tool')
      AND v_receipt.amora_request_key = p_chat_request_key
    )
    OR (
      v_receipt.amora_call_source = 'conflict_check'
      AND v_receipt.amora_call_phase = 'conflict_mediation'
      AND v_receipt.amora_request_key ~ '^conflict:[0-9a-f]{64}$'
      AND p_chat_request_key =
        'mediation:' || substring(
          v_receipt.amora_request_key
          FROM char_length('conflict:') + 1
        )
      AND p_chat_visibility = 'shared'
    );
  v_is_conflict_mediation :=
    v_receipt.amora_call_source = 'conflict_check'
    AND v_receipt.amora_call_phase = 'conflict_mediation';
  IF v_expected_request_key IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'AMORA_CHAT_RESPONSE_RECEIPT_SCOPE_MISMATCH'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_claim
  FROM public.amora_chat_request_claims AS claim
  WHERE claim.couple_id = p_chat_couple_id
    AND claim.request_key = p_chat_request_key
  FOR UPDATE;
  IF NOT FOUND
     OR v_claim.user_id IS DISTINCT FROM p_chat_user_id
     OR v_claim.visibility IS DISTINCT FROM p_chat_visibility
     OR v_claim.attempt_count IS DISTINCT FROM p_chat_claim_attempt_count
  THEN
    RAISE EXCEPTION 'AMORA_CHAT_RESPONSE_CLAIM_STALE'
      USING ERRCODE = '40001';
  END IF;

  -- Lost-response retries are already immutable. Let the existing finalizer
  -- replay or reject them without adding a new couple lock.
  IF v_claim.status IS DISTINCT FROM 'processing' THEN
    RETURN QUERY
    SELECT result.*
    FROM public.finalize_amora_chat_response_with_privacy_fence_inner_v1(
      p_receipt_id,
      p_receipt_claim_token,
      p_chat_couple_id,
      p_chat_user_id,
      p_chat_request_key,
      p_chat_visibility,
      p_chat_claim_attempt_count,
      p_expected_privacy_epoch,
      p_message_content,
      p_message_metadata,
      p_message_stage_tag,
      p_message_specialist_type,
      p_provider_attempted,
      p_usage_status,
      p_actual_cost_microusd,
      p_success,
      p_error_message,
      p_model,
      p_tokens_input,
      p_tokens_output,
      p_latency_ms,
      p_receipt_metadata
    ) AS result;
    RETURN;
  END IF;

  -- Shared pending proposals and conflict mediation reach triggers that take
  -- the couple row FOR UPDATE. Pre-acquire that mode before the privacy epoch
  -- to avoid two SHARE-to-UPDATE lock upgrades. All other terminal responses
  -- need only the SHARE mode used by the conversation-segment trigger. That
  -- remains compatible with private hard deletion's couple SHARE lock while
  -- both paths serialize on the same exact private claim when they overlap.
  v_requires_couple_update := v_is_conflict_mediation OR (
    p_chat_visibility = 'shared'
    AND p_message_metadata ? 'pending_amora_action'
  );
  IF v_requires_couple_update THEN
    PERFORM 1
    FROM public.couples AS couple
    WHERE couple.id = p_chat_couple_id
    FOR UPDATE;
  ELSE
    PERFORM 1
    FROM public.couples AS couple
    WHERE couple.id = p_chat_couple_id
    FOR SHARE;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_CHAT_RESPONSE_COUPLE_MISSING';
  END IF;

  RETURN QUERY
  SELECT result.*
  FROM public.finalize_amora_chat_response_with_privacy_fence_inner_v1(
    p_receipt_id,
    p_receipt_claim_token,
    p_chat_couple_id,
    p_chat_user_id,
    p_chat_request_key,
    p_chat_visibility,
    p_chat_claim_attempt_count,
    p_expected_privacy_epoch,
    p_message_content,
    p_message_metadata,
    p_message_stage_tag,
    p_message_specialist_type,
    p_provider_attempted,
    p_usage_status,
    p_actual_cost_microusd,
    p_success,
    p_error_message,
    p_model,
    p_tokens_input,
    p_tokens_output,
    p_latency_ms,
    p_receipt_metadata
  ) AS result;
END
$function$;

ALTER FUNCTION public.finalize_amora_chat_response_with_privacy_fence(
  uuid, uuid, uuid, uuid, text, text, integer, bigint, text, jsonb, text,
  text, boolean, text, bigint, boolean, text, text, integer, integer,
  integer, jsonb
) OWNER TO postgres;
REVOKE ALL ON FUNCTION
  public.finalize_amora_chat_response_with_privacy_fence(
    uuid, uuid, uuid, uuid, text, text, integer, bigint, text, jsonb, text,
    text, boolean, text, bigint, boolean, text, text, integer, integer,
    integer, jsonb
  ) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.finalize_amora_chat_response_with_privacy_fence(
    uuid, uuid, uuid, uuid, text, text, integer, bigint, text, jsonb, text,
    text, boolean, text, bigint, boolean, text, text, integer, integer,
    integer, jsonb
  ) TO service_role;

COMMENT ON FUNCTION
  public.finalize_amora_chat_response_with_privacy_fence(
    uuid, uuid, uuid, uuid, text, text, integer, bigint, text, jsonb, text,
    text, boolean, text, bigint, boolean, text, text, integer, integer,
    integer, jsonb
  ) IS
  'Service-only terminal finalizer lock-order adapter: exact receipt -> exact claim -> couple SHARE/UPDATE -> privacy epoch, then delegates all validation, persistence, trigger binding, replay, and settlement to the existing atomic privacy finalizer.';

CREATE TABLE public.amora_first_use_action_promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL,
  owner_role text NOT NULL CHECK (owner_role IN ('bride', 'groom')),
  source_private_message_id uuid NOT NULL,
  source_visibility text NOT NULL
    CHECK (source_visibility IN ('bride_private', 'groom_private')),
  source_content_digest text NOT NULL
    CHECK (source_content_digest ~ '^[a-f0-9]{64}$'),
  source_journey_revision bigint NOT NULL
    CHECK (source_journey_revision BETWEEN 0 AND 9007199254740991),
  source_privacy_epoch bigint NOT NULL CHECK (source_privacy_epoch >= 1),
  source_roster_fingerprint text NOT NULL
    CHECK (source_roster_fingerprint ~ '^[a-f0-9]{32}$'),
  source_criterion_decision_id uuid,
  canonical_action_input jsonb NOT NULL CHECK (
    jsonb_typeof(canonical_action_input) = 'object'
    AND canonical_action_input ?& ARRAY[
      'action', 'reason', 'completionCriterion'
    ]
    AND canonical_action_input - ARRAY[
      'action', 'reason', 'completionCriterion'
    ] = '{}'::jsonb
  ),
  canonical_add_action_input jsonb NOT NULL CHECK (
    jsonb_typeof(canonical_add_action_input) = 'object'
    AND canonical_add_action_input ?& ARRAY[
      'title', 'description', 'category_key', 'priority', 'source'
    ]
    AND canonical_add_action_input - ARRAY[
      'title', 'description', 'category_key', 'priority', 'source'
    ] = '{}'::jsonb
  ),
  action_digest text NOT NULL CHECK (action_digest ~ '^[a-f0-9]{64}$'),
  shared_content_digest text NOT NULL
    CHECK (shared_content_digest ~ '^[a-f0-9]{64}$'),
  shared_user_message_id uuid NOT NULL,
  shared_client_request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT amora_first_use_action_promotions_source_unique
    UNIQUE (couple_id, owner_user_id, source_private_message_id),
  CONSTRAINT amora_first_use_action_promotions_shared_message_unique
    UNIQUE (shared_user_message_id)
);

ALTER TABLE public.amora_first_use_action_promotions OWNER TO postgres;
ALTER TABLE public.amora_first_use_action_promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amora_first_use_action_promotions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.amora_first_use_action_promotions
  FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.amora_actions
  ADD COLUMN first_use_promotion_id uuid;

CREATE UNIQUE INDEX amora_actions_first_use_promotion_once_idx
  ON public.amora_actions(first_use_promotion_id)
  WHERE first_use_promotion_id IS NOT NULL;

COMMENT ON TABLE public.amora_first_use_action_promotions IS
  'Content-minimized, service-only receipt proving that one owner explicitly declassified one sealed private first-use action into one shared draft.';
COMMENT ON COLUMN public.amora_first_use_action_promotions.source_private_message_id IS
  'Private provenance identifier. It deliberately has no chat_messages FK so private hard deletion never cascades into or is blocked by an explicitly shared artifact.';
COMMENT ON COLUMN public.amora_actions.first_use_promotion_id IS
  'Opaque one-shot receipt bound by the atomic shared-action execution trigger; never accepted as client authority.';

CREATE FUNCTION public.amora_first_use_action_current_context_v1(
  p_couple_id uuid,
  p_owner_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_bride_id uuid;
  v_groom_id uuid;
  v_owner_role text;
  v_profile_count integer;
  v_journey_revision bigint;
  v_privacy_epoch bigint;
  v_roster_fingerprint text;
  v_criterion_decision_id uuid;
BEGIN
  IF p_couple_id IS NULL OR p_owner_user_id IS NULL THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_INVALID'
      USING ERRCODE = '22023';
  END IF;

  -- Canonical order: couple -> privacy epoch -> journey -> source/criterion.
  -- Roster writers already own the couple before advancing the epoch; provider
  -- finalization owns the epoch before inserting a response. This makes the
  -- context below one transaction-linearized snapshot without new lock cycles.
  SELECT couple.bride_id, couple.groom_id
    INTO v_bride_id, v_groom_id
  FROM public.couples AS couple
  WHERE couple.id = p_couple_id
  FOR UPDATE;

  IF NOT FOUND
     OR (v_bride_id IS NOT NULL AND v_bride_id = v_groom_id)
     OR p_owner_user_id NOT IN (v_bride_id, v_groom_id) THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_SCOPE_CHANGED'
      USING ERRCODE = '42501';
  END IF;

  SELECT profile.role
    INTO v_owner_role
  FROM public.profiles AS profile
  WHERE profile.id = p_owner_user_id
    AND profile.couple_id = p_couple_id
    AND (
      (profile.role = 'bride' AND v_bride_id = profile.id)
      OR (profile.role = 'groom' AND v_groom_id = profile.id)
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_SCOPE_CHANGED'
      USING ERRCODE = '42501';
  END IF;

  SELECT count(*)::integer
    INTO v_profile_count
  FROM public.profiles AS profile
  WHERE profile.couple_id = p_couple_id
    AND (
      (profile.id = v_bride_id AND profile.role = 'bride')
      OR (profile.id = v_groom_id AND profile.role = 'groom')
    );
  IF v_profile_count IS DISTINCT FROM
       (CASE WHEN v_bride_id IS NOT NULL THEN 1 ELSE 0 END)
       + (CASE WHEN v_groom_id IS NOT NULL THEN 1 ELSE 0 END) THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_ROSTER_CHANGED'
      USING ERRCODE = '40001';
  END IF;

  SELECT privacy.epoch
    INTO v_privacy_epoch
  FROM public.amora_privacy_context_epochs AS privacy
  WHERE privacy.couple_id = p_couple_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_PRIVACY_CHANGED'
      USING ERRCODE = '40001';
  END IF;

  SELECT journey.state_revision
    INTO v_journey_revision
  FROM public.wedding_journeys AS journey
  WHERE journey.couple_id = p_couple_id
  FOR SHARE;
  IF NOT FOUND
     OR v_journey_revision NOT BETWEEN 0 AND 9007199254740991 THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_JOURNEY_CHANGED'
      USING ERRCODE = '40001';
  END IF;

  v_roster_fingerprint := md5(
    COALESCE(v_bride_id::text, '-') || ':' ||
    COALESCE(v_groom_id::text, '-')
  );

  SELECT decision.id
    INTO v_criterion_decision_id
  FROM public.decision_nodes AS decision
  WHERE decision.couple_id = p_couple_id
    AND decision.category = 'preference'
    AND decision.decision_type = 'decided'
    AND decision.visibility = 'shared'
    AND decision.source = 'manual'
    AND decision.source_actor_role IS NULL
    AND decision.metadata @> jsonb_build_object(
      'criterion_contract', 'amora_couple_core_criterion_v1',
      'criterion_version', 1,
      'bride_user_id', v_bride_id::text,
      'groom_user_id', v_groom_id::text,
      'acceptance_count', 2,
      'explicit', true
    )
  ORDER BY decision.user_confirmed_at DESC NULLS LAST,
           decision.created_at DESC,
           decision.id DESC
  LIMIT 1
  FOR SHARE;

  RETURN jsonb_build_object(
    'ownerRole', v_owner_role,
    'sourceVisibility', v_owner_role || '_private',
    'journeyRevision', v_journey_revision,
    'privacyEpoch', v_privacy_epoch,
    'rosterFingerprint', v_roster_fingerprint,
    'criterionDecisionId', v_criterion_decision_id
  );
END
$function$;

ALTER FUNCTION public.amora_first_use_action_current_context_v1(uuid, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION
  public.amora_first_use_action_current_context_v1(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.amora_first_use_action_source_context_v1(
  p_couple_id uuid,
  p_owner_user_id uuid,
  p_source_private_message_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_current jsonb;
  v_source record;
  v_latest_source_id uuid;
  v_seal jsonb;
  v_preview jsonb;
  v_add_input jsonb;
  v_source_digest text;
  v_source_revision bigint;
  v_source_privacy_epoch bigint;
  v_source_criterion_id uuid;
BEGIN
  IF p_source_private_message_id IS NULL THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_INVALID'
      USING ERRCODE = '22023';
  END IF;

  v_current := public.amora_first_use_action_current_context_v1(
    p_couple_id,
    p_owner_user_id
  );

  SELECT message.id,
         message.couple_id,
         message.sender_id,
         message.sender_type,
         message.role,
         message.content,
         message.metadata,
         message.visibility,
         message.created_at
    INTO v_source
  FROM public.chat_messages AS message
  WHERE message.id = p_source_private_message_id
  FOR SHARE;

  IF NOT FOUND
     OR v_source.couple_id IS DISTINCT FROM p_couple_id
     OR v_source.sender_id IS NOT NULL
     OR v_source.sender_type IS DISTINCT FROM 'ai'
     OR v_source.role IS DISTINCT FROM 'assistant'
     OR v_source.visibility IS DISTINCT FROM v_current ->> 'sourceVisibility'
     OR COALESCE(v_source.metadata ->> 'target', '') = 'partner' THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_SOURCE_INVALID'
      USING ERRCODE = '22023';
  END IF;

  SELECT message.id
    INTO v_latest_source_id
  FROM public.chat_messages AS message
  WHERE message.couple_id = p_couple_id
    AND message.sender_id IS NULL
    AND message.sender_type = 'ai'
    AND message.role = 'assistant'
    AND message.visibility = v_current ->> 'sourceVisibility'
    AND COALESCE(message.metadata ->> 'target', '') <> 'partner'
  ORDER BY message.created_at DESC, message.id DESC
  LIMIT 1;
  IF v_latest_source_id IS DISTINCT FROM p_source_private_message_id THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_SOURCE_STALE'
      USING ERRCODE = '40001';
  END IF;

  v_seal := v_source.metadata -> 'amora_first_use_action_promotion_v1';
  IF jsonb_typeof(v_seal) IS DISTINCT FROM 'object'
     OR v_seal - ARRAY[
       'version', 'sourceContentDigest', 'journeyRevision', 'privacyEpoch',
       'rosterFingerprint', 'criterionDecisionId', 'canonicalActionInput',
       'actionDigest', 'sharedContentDigest'
     ] <> '{}'::jsonb
     OR NOT (v_seal ?& ARRAY[
       'version', 'sourceContentDigest', 'journeyRevision', 'privacyEpoch',
       'rosterFingerprint', 'criterionDecisionId', 'canonicalActionInput',
       'actionDigest', 'sharedContentDigest'
     ])
     OR v_seal ->> 'version' IS DISTINCT FROM '1'
     OR COALESCE(v_seal ->> 'sourceContentDigest', '') !~ '^[a-f0-9]{64}$'
     OR COALESCE(v_seal ->> 'actionDigest', '') !~ '^[a-f0-9]{64}$'
     OR COALESCE(v_seal ->> 'sharedContentDigest', '') !~ '^[a-f0-9]{64}$'
     OR COALESCE(v_seal ->> 'rosterFingerprint', '') !~ '^[a-f0-9]{32}$'
     OR COALESCE(v_seal ->> 'journeyRevision', '') !~ '^(0|[1-9][0-9]{0,15})$'
     OR COALESCE(v_seal ->> 'privacyEpoch', '') !~ '^[1-9][0-9]*$' THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_SOURCE_INVALID'
      USING ERRCODE = '22023';
  END IF;

  v_preview := v_seal -> 'canonicalActionInput';
  IF jsonb_typeof(v_preview) IS DISTINCT FROM 'object'
     OR v_preview - ARRAY['action', 'reason', 'completionCriterion']
       <> '{}'::jsonb
     OR NOT (v_preview ?& ARRAY['action', 'reason', 'completionCriterion'])
     OR jsonb_typeof(v_preview -> 'action') IS DISTINCT FROM 'string'
     OR jsonb_typeof(v_preview -> 'reason') IS DISTINCT FROM 'string'
     OR jsonb_typeof(v_preview -> 'completionCriterion') IS DISTINCT FROM 'string'
     OR char_length(v_preview ->> 'action') NOT BETWEEN 1 AND 120
     OR char_length(v_preview ->> 'reason') NOT BETWEEN 1 AND 220
     OR char_length(v_preview ->> 'completionCriterion') NOT BETWEEN 1 AND 220
     OR btrim(v_preview ->> 'action') IS DISTINCT FROM v_preview ->> 'action'
     OR btrim(v_preview ->> 'reason') IS DISTINCT FROM v_preview ->> 'reason'
     OR btrim(v_preview ->> 'completionCriterion')
       IS DISTINCT FROM v_preview ->> 'completionCriterion'
     OR concat_ws('', v_preview ->> 'action', v_preview ->> 'reason',
                  v_preview ->> 'completionCriterion') ~ '[<>{}\[\]]' THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_SOURCE_INVALID'
      USING ERRCODE = '22023';
  END IF;

  v_source_digest := encode(
    extensions.digest(convert_to(v_source.content, 'UTF8'), 'sha256'),
    'hex'
  );
  v_source_revision := (v_seal ->> 'journeyRevision')::bigint;
  v_source_privacy_epoch := (v_seal ->> 'privacyEpoch')::bigint;
  BEGIN
    v_source_criterion_id := NULLIF(v_seal ->> 'criterionDecisionId', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_SOURCE_INVALID'
      USING ERRCODE = '22023';
  END;

  IF v_source_digest IS DISTINCT FROM v_seal ->> 'sourceContentDigest'
     OR v_source_revision IS DISTINCT FROM
       (v_current ->> 'journeyRevision')::bigint
     OR v_source_revision IS DISTINCT FROM
       NULLIF(v_source.metadata ->> 'amora_wedding_context_revision', '')::bigint
     OR v_source_privacy_epoch IS DISTINCT FROM
       (v_current ->> 'privacyEpoch')::bigint
     OR v_seal ->> 'rosterFingerprint' IS DISTINCT FROM
       v_current ->> 'rosterFingerprint' THEN
    IF v_source_revision IS DISTINCT FROM
         (v_current ->> 'journeyRevision')::bigint THEN
      RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_JOURNEY_CHANGED'
        USING ERRCODE = '40001';
    ELSIF v_source_privacy_epoch IS DISTINCT FROM
         (v_current ->> 'privacyEpoch')::bigint THEN
      RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_PRIVACY_CHANGED'
        USING ERRCODE = '40001';
    ELSIF v_seal ->> 'rosterFingerprint' IS DISTINCT FROM
         v_current ->> 'rosterFingerprint' THEN
      RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_ROSTER_CHANGED'
        USING ERRCODE = '40001';
    ELSE
      RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_SOURCE_INVALID'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_source_criterion_id IS DISTINCT FROM
       NULLIF(v_current ->> 'criterionDecisionId', '')::uuid
     OR v_source_criterion_id IS DISTINCT FROM
       NULLIF(v_source.metadata ->> 'amora_couple_criterion_decision_id', '')::uuid
  THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_CRITERION_CHANGED'
      USING ERRCODE = '40001';
  END IF;

  v_add_input := jsonb_build_object(
    'title', v_preview ->> 'action',
    'description', '이유: ' || (v_preview ->> 'reason')
      || ' 완료 기준: ' || (v_preview ->> 'completionCriterion'),
    'category_key', 'general',
    'priority', 'medium',
    'source', 'chat'
  );

  RETURN v_current || jsonb_build_object(
    'sourceMessageId', p_source_private_message_id,
    'sourceContentDigest', v_source_digest,
    'canonicalActionInput', v_preview,
    'canonicalAddActionInput', v_add_input,
    'actionDigest', v_seal ->> 'actionDigest',
    'sharedContentDigest', v_seal ->> 'sharedContentDigest'
  );
END
$function$;

ALTER FUNCTION public.amora_first_use_action_source_context_v1(uuid, uuid, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION
  public.amora_first_use_action_source_context_v1(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.ingest_amora_first_use_action_promotion_v1(
  p_couple_id uuid,
  p_owner_user_id uuid,
  p_source_private_message_id uuid,
  p_client_request_id uuid,
  p_content text,
  p_source_content_digest text,
  p_canonical_action_input jsonb,
  p_action_digest text,
  p_shared_content_digest text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_existing public.amora_first_use_action_promotions%ROWTYPE;
  v_source jsonb;
  v_actual_shared_digest text;
  v_promotion_id uuid := gen_random_uuid();
  v_shared_message_id uuid := gen_random_uuid();
  v_existing_request_message record;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;
  IF p_couple_id IS NULL
     OR p_owner_user_id IS NULL
     OR p_source_private_message_id IS NULL
     OR p_client_request_id IS NULL
     OR p_content IS NULL
     OR char_length(btrim(p_content)) < 1
     OR octet_length(p_content) > 131072
     OR COALESCE(p_source_content_digest, '') !~ '^[a-f0-9]{64}$'
     OR COALESCE(p_action_digest, '') !~ '^[a-f0-9]{64}$'
     OR COALESCE(p_shared_content_digest, '') !~ '^[a-f0-9]{64}$'
     OR jsonb_typeof(p_canonical_action_input) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_INVALID'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'hanbang:amora-first-use-promotion:' || p_couple_id::text || ':'
        || p_source_private_message_id::text,
      0
    )
  );

  SELECT promotion.*
    INTO v_existing
  FROM public.amora_first_use_action_promotions AS promotion
  WHERE promotion.couple_id = p_couple_id
    AND promotion.owner_user_id = p_owner_user_id
    AND promotion.source_private_message_id = p_source_private_message_id
  FOR SHARE;
  IF FOUND THEN
    v_actual_shared_digest := encode(
      extensions.digest(convert_to(p_content, 'UTF8'), 'sha256'),
      'hex'
    );
    IF v_existing.source_content_digest IS DISTINCT FROM p_source_content_digest
       OR v_existing.canonical_action_input
         IS DISTINCT FROM p_canonical_action_input
       OR v_existing.action_digest IS DISTINCT FROM p_action_digest
       OR v_existing.shared_content_digest
         IS DISTINCT FROM p_shared_content_digest
       OR v_actual_shared_digest IS DISTINCT FROM p_shared_content_digest THEN
      RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_CONTENT_MISMATCH'
        USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object(
      'version', 1,
      'promotionId', v_existing.id,
      'sharedMessageId', v_existing.shared_user_message_id,
      'reused', true
    );
  END IF;

  v_source := public.amora_first_use_action_source_context_v1(
    p_couple_id,
    p_owner_user_id,
    p_source_private_message_id
  );
  v_actual_shared_digest := encode(
    extensions.digest(convert_to(p_content, 'UTF8'), 'sha256'),
    'hex'
  );
  IF v_source ->> 'sourceContentDigest'
       IS DISTINCT FROM p_source_content_digest
     OR v_source -> 'canonicalActionInput'
       IS DISTINCT FROM p_canonical_action_input
     OR v_source ->> 'actionDigest' IS DISTINCT FROM p_action_digest
     OR v_source ->> 'sharedContentDigest'
       IS DISTINCT FROM p_shared_content_digest
     OR v_actual_shared_digest IS DISTINCT FROM p_shared_content_digest THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_CONTENT_MISMATCH'
      USING ERRCODE = '22023';
  END IF;

  SELECT message.id, message.couple_id, message.sender_id, message.role,
         message.content, message.metadata, message.visibility
    INTO v_existing_request_message
  FROM public.chat_messages AS message
  WHERE message.couple_id = p_couple_id
    AND message.metadata ->> 'client_request_id' = p_client_request_id::text
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_REQUEST_CONFLICT'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.chat_messages(
    id, couple_id, sender_id, sender_type, sender_role, role, content,
    metadata, visibility
  ) VALUES (
    v_shared_message_id,
    p_couple_id,
    p_owner_user_id,
    v_source ->> 'ownerRole',
    NULL,
    'user',
    p_content,
    jsonb_build_object(
      'client_request_id', p_client_request_id,
      'amora_ingest_contract_version', 1,
      'ai_response_requested', true,
      'provider_attachment_state', 'none',
      'provider_attachment_count', 0,
      'amora_first_use_promotion_id', v_promotion_id
    ),
    'shared'
  );

  INSERT INTO public.amora_first_use_action_promotions(
    id,
    couple_id,
    owner_user_id,
    owner_role,
    source_private_message_id,
    source_visibility,
    source_content_digest,
    source_journey_revision,
    source_privacy_epoch,
    source_roster_fingerprint,
    source_criterion_decision_id,
    canonical_action_input,
    canonical_add_action_input,
    action_digest,
    shared_content_digest,
    shared_user_message_id,
    shared_client_request_id
  ) VALUES (
    v_promotion_id,
    p_couple_id,
    p_owner_user_id,
    v_source ->> 'ownerRole',
    p_source_private_message_id,
    v_source ->> 'sourceVisibility',
    p_source_content_digest,
    (v_source ->> 'journeyRevision')::bigint,
    (v_source ->> 'privacyEpoch')::bigint,
    v_source ->> 'rosterFingerprint',
    NULLIF(v_source ->> 'criterionDecisionId', '')::uuid,
    p_canonical_action_input,
    v_source -> 'canonicalAddActionInput',
    p_action_digest,
    p_shared_content_digest,
    v_shared_message_id,
    p_client_request_id
  );

  RETURN jsonb_build_object(
    'version', 1,
    'promotionId', v_promotion_id,
    'sharedMessageId', v_shared_message_id,
    'reused', false
  );
END
$function$;

ALTER FUNCTION public.ingest_amora_first_use_action_promotion_v1(
  uuid, uuid, uuid, uuid, text, text, jsonb, text, text
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.ingest_amora_first_use_action_promotion_v1(
  uuid, uuid, uuid, uuid, text, text, jsonb, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ingest_amora_first_use_action_promotion_v1(
  uuid, uuid, uuid, uuid, text, text, jsonb, text, text
) TO service_role;

CREATE FUNCTION public.read_amora_first_use_action_promotion_v1(
  p_couple_id uuid,
  p_owner_user_id uuid,
  p_source_private_message_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_existing public.amora_first_use_action_promotions%ROWTYPE;
  v_source jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;
  IF p_couple_id IS NULL
     OR p_owner_user_id IS NULL
     OR p_source_private_message_id IS NULL THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_INVALID'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'hanbang:amora-first-use-promotion:' || p_couple_id::text || ':'
        || p_source_private_message_id::text,
      0
    )
  );
  SELECT promotion.*
    INTO v_existing
  FROM public.amora_first_use_action_promotions AS promotion
  WHERE promotion.couple_id = p_couple_id
    AND promotion.owner_user_id = p_owner_user_id
    AND promotion.source_private_message_id = p_source_private_message_id
  FOR SHARE;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'version', 1,
      'status', 'promoted',
      'promotionId', v_existing.id,
      'sharedMessageId', v_existing.shared_user_message_id,
      'sourceMessageId', v_existing.source_private_message_id
    );
  END IF;

  v_source := public.amora_first_use_action_source_context_v1(
    p_couple_id,
    p_owner_user_id,
    p_source_private_message_id
  );
  RETURN jsonb_build_object(
    'version', 1,
    'status', 'ready',
    'promotionId', NULL,
    'sharedMessageId', NULL,
    'sourceMessageId', p_source_private_message_id,
    'sourceRevision', (v_source ->> 'journeyRevision')::bigint,
    'criterionDecisionId', NULLIF(v_source ->> 'criterionDecisionId', '')::uuid,
    'canonicalActionInput', v_source -> 'canonicalActionInput'
  );
END
$function$;

ALTER FUNCTION public.read_amora_first_use_action_promotion_v1(uuid, uuid, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION
  public.read_amora_first_use_action_promotion_v1(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.read_amora_first_use_action_promotion_v1(uuid, uuid, uuid)
  TO service_role;

CREATE FUNCTION public.amora_first_use_action_assert_current_v1(
  p_promotion_id uuid,
  p_couple_id uuid,
  p_expected_privacy_epoch bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_owner_user_id uuid;
  v_promotion public.amora_first_use_action_promotions%ROWTYPE;
  v_current jsonb;
BEGIN
  IF p_promotion_id IS NULL OR p_couple_id IS NULL THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_INVALID'
      USING ERRCODE = '22023';
  END IF;

  -- Resolve the owner without a row lock, then acquire the canonical couple ->
  -- epoch -> journey order before locking the immutable receipt.
  SELECT promotion.owner_user_id
    INTO v_owner_user_id
  FROM public.amora_first_use_action_promotions AS promotion
  WHERE promotion.id = p_promotion_id
    AND promotion.couple_id = p_couple_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_SOURCE_INVALID'
      USING ERRCODE = '22023';
  END IF;

  v_current := public.amora_first_use_action_current_context_v1(
    p_couple_id,
    v_owner_user_id
  );
  SELECT promotion.*
    INTO v_promotion
  FROM public.amora_first_use_action_promotions AS promotion
  WHERE promotion.id = p_promotion_id
    AND promotion.couple_id = p_couple_id
    AND promotion.owner_user_id = v_owner_user_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_SOURCE_INVALID'
      USING ERRCODE = '22023';
  END IF;

  IF p_expected_privacy_epoch IS NOT NULL
     AND p_expected_privacy_epoch IS DISTINCT FROM
       v_promotion.source_privacy_epoch THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_PRIVACY_CHANGED'
      USING ERRCODE = '40001';
  END IF;
  IF v_promotion.source_journey_revision IS DISTINCT FROM
       (v_current ->> 'journeyRevision')::bigint THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_JOURNEY_CHANGED'
      USING ERRCODE = '40001';
  END IF;
  IF v_promotion.source_privacy_epoch IS DISTINCT FROM
       (v_current ->> 'privacyEpoch')::bigint THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_PRIVACY_CHANGED'
      USING ERRCODE = '40001';
  END IF;
  IF v_promotion.source_roster_fingerprint IS DISTINCT FROM
       v_current ->> 'rosterFingerprint'
     OR v_promotion.owner_role IS DISTINCT FROM v_current ->> 'ownerRole' THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_ROSTER_CHANGED'
      USING ERRCODE = '40001';
  END IF;
  IF v_promotion.source_criterion_decision_id IS DISTINCT FROM
       NULLIF(v_current ->> 'criterionDecisionId', '')::uuid THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_CRITERION_CHANGED'
      USING ERRCODE = '40001';
  END IF;

  RETURN jsonb_build_object(
    'version', 1,
    'promotionId', v_promotion.id,
    'ownerUserId', v_promotion.owner_user_id,
    'ownerRole', v_promotion.owner_role,
    'sharedMessageId', v_promotion.shared_user_message_id,
    'sourceRevision', v_promotion.source_journey_revision,
    'privacyEpoch', v_promotion.source_privacy_epoch,
    'criterionDecisionId', v_promotion.source_criterion_decision_id,
    'canonicalActionInput', v_promotion.canonical_action_input,
    'canonicalAddActionInput', v_promotion.canonical_add_action_input,
    'actionDigest', v_promotion.action_digest,
    'sharedContentDigest', v_promotion.shared_content_digest
  );
END
$function$;

ALTER FUNCTION public.amora_first_use_action_assert_current_v1(
  uuid, uuid, bigint
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.amora_first_use_action_assert_current_v1(
  uuid, uuid, bigint
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.validate_amora_first_use_action_promotion_v1(
  p_couple_id uuid,
  p_owner_user_id uuid,
  p_shared_user_message_id uuid,
  p_expected_privacy_epoch bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_promotion_id uuid;
  v_current jsonb;
  v_message record;
  v_shared_digest text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;
  IF p_couple_id IS NULL
     OR p_owner_user_id IS NULL
     OR p_shared_user_message_id IS NULL
     OR p_expected_privacy_epoch IS NULL
     OR p_expected_privacy_epoch < 1 THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_INVALID'
      USING ERRCODE = '22023';
  END IF;

  SELECT promotion.id
    INTO v_promotion_id
  FROM public.amora_first_use_action_promotions AS promotion
  WHERE promotion.couple_id = p_couple_id
    AND promotion.owner_user_id = p_owner_user_id
    AND promotion.shared_user_message_id = p_shared_user_message_id;
  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1
      FROM public.amora_first_use_action_promotions AS promotion
      WHERE promotion.couple_id = p_couple_id
        AND promotion.shared_user_message_id = p_shared_user_message_id
    ) THEN
      RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_SCOPE_CHANGED'
        USING ERRCODE = '42501';
    END IF;
    RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_SOURCE_INVALID'
      USING ERRCODE = '22023';
  END IF;

  v_current := public.amora_first_use_action_assert_current_v1(
    v_promotion_id,
    p_couple_id,
    p_expected_privacy_epoch
  );
  SELECT message.id,
         message.couple_id,
         message.sender_id,
         message.sender_type,
         message.role,
         message.content,
         message.metadata,
         message.visibility
    INTO v_message
  FROM public.chat_messages AS message
  WHERE message.id = p_shared_user_message_id
  FOR SHARE;
  v_shared_digest := CASE WHEN FOUND THEN encode(
    extensions.digest(convert_to(v_message.content, 'UTF8'), 'sha256'),
    'hex'
  ) ELSE NULL END;
  IF NOT FOUND
     OR v_message.couple_id IS DISTINCT FROM p_couple_id
     OR v_message.sender_id IS DISTINCT FROM
       p_owner_user_id
     OR p_owner_user_id IS DISTINCT FROM
       (v_current ->> 'ownerUserId')::uuid
     OR v_message.sender_type IS DISTINCT FROM v_current ->> 'ownerRole'
     OR v_message.role IS DISTINCT FROM 'user'
     OR v_message.visibility IS DISTINCT FROM 'shared'
     OR v_message.metadata ->> 'amora_first_use_promotion_id'
       IS DISTINCT FROM v_promotion_id::text
     OR v_shared_digest IS DISTINCT FROM v_current ->> 'sharedContentDigest' THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_CONTENT_MISMATCH'
      USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object(
    'version', 1,
    'promotionId', v_promotion_id,
    'canonicalActionInput', v_current -> 'canonicalActionInput',
    'canonicalAddActionInput', v_current -> 'canonicalAddActionInput'
  );
END
$function$;

ALTER FUNCTION public.validate_amora_first_use_action_promotion_v1(
  uuid, uuid, uuid, bigint
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.validate_amora_first_use_action_promotion_v1(
  uuid, uuid, uuid, bigint
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.validate_amora_first_use_action_promotion_v1(
  uuid, uuid, uuid, bigint
) TO service_role;

CREATE TABLE public.amora_first_use_action_proposal_bindings (
  proposal_message_id uuid PRIMARY KEY,
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  action_id uuid NOT NULL,
  promotion_id uuid NOT NULL
    REFERENCES public.amora_first_use_action_promotions(id) ON DELETE CASCADE,
  shared_user_message_id uuid NOT NULL,
  proposal_journey_revision bigint NOT NULL
    CHECK (proposal_journey_revision BETWEEN 0 AND 9007199254740991),
  action_digest text NOT NULL CHECK (action_digest ~ '^[a-f0-9]{64}$'),
  bound_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT amora_first_use_action_proposal_bindings_promotion_unique
    UNIQUE (promotion_id),
  CONSTRAINT amora_first_use_action_proposal_bindings_action_unique
    UNIQUE (couple_id, proposal_message_id, action_id)
);

ALTER TABLE public.amora_first_use_action_proposal_bindings OWNER TO postgres;
ALTER TABLE public.amora_first_use_action_proposal_bindings
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amora_first_use_action_proposal_bindings
  FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.amora_first_use_action_proposal_bindings
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.bind_amora_first_use_action_proposal_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_shared_user_message_id uuid;
  v_promotion_id uuid;
  v_current jsonb;
  v_pending jsonb;
  v_action_id uuid;
  v_revision bigint;
BEGIN
  IF NEW.sender_id IS NOT NULL
     OR NEW.sender_type IS DISTINCT FROM 'ai'
     OR NEW.role IS DISTINCT FROM 'assistant'
     OR NEW.visibility IS DISTINCT FROM 'shared'
     OR COALESCE(NEW.metadata ->> 'target', '') = 'partner'
     OR jsonb_typeof(NEW.metadata -> 'pending_amora_action')
       IS DISTINCT FROM 'object'
     OR COALESCE(NEW.metadata ->> 'in_reply_to_user_message_id', '') !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  THEN
    RETURN NEW;
  END IF;

  v_shared_user_message_id :=
    (NEW.metadata ->> 'in_reply_to_user_message_id')::uuid;
  SELECT promotion.id
    INTO v_promotion_id
  FROM public.amora_first_use_action_promotions AS promotion
  WHERE promotion.couple_id = NEW.couple_id
    AND promotion.shared_user_message_id = v_shared_user_message_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_current := public.amora_first_use_action_assert_current_v1(
    v_promotion_id,
    NEW.couple_id,
    NULL
  );
  v_pending := NEW.metadata -> 'pending_amora_action';
  BEGIN
    v_action_id := NULLIF(v_pending ->> 'actionId', '')::uuid;
    v_revision := NULLIF(
      NEW.metadata ->> 'pending_amora_action_journey_revision',
      ''
    )::bigint;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_PROPOSAL_MISMATCH'
      USING ERRCODE = '23514';
  END;

  IF v_action_id IS NULL
     OR v_revision IS DISTINCT FROM (v_current ->> 'sourceRevision')::bigint
     OR v_pending ->> 'tool' IS DISTINCT FROM 'add_amora_action'
     OR v_pending -> 'input' IS DISTINCT FROM
       v_current -> 'canonicalAddActionInput'
     OR v_pending ->> 'inputDigest' IS DISTINCT FROM
       v_current ->> 'actionDigest' THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_PROPOSAL_MISMATCH'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.amora_first_use_action_proposal_bindings(
    proposal_message_id,
    couple_id,
    action_id,
    promotion_id,
    shared_user_message_id,
    proposal_journey_revision,
    action_digest
  ) VALUES (
    NEW.id,
    NEW.couple_id,
    v_action_id,
    v_promotion_id,
    v_shared_user_message_id,
    v_revision,
    v_current ->> 'actionDigest'
  );
  RETURN NEW;
END
$function$;

ALTER FUNCTION public.bind_amora_first_use_action_proposal_v1()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.bind_amora_first_use_action_proposal_v1()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_bind_amora_first_use_action_proposal_v1
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.bind_amora_first_use_action_proposal_v1();

CREATE FUNCTION public.validate_amora_first_use_shared_action_write_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_promotion_id uuid;
BEGIN
  SELECT binding.promotion_id
    INTO v_promotion_id
  FROM public.amora_first_use_action_proposal_bindings AS binding
  WHERE binding.couple_id = NEW.couple_id
    AND binding.proposal_message_id = NEW.source_message_id
    AND binding.action_id = NEW.action_id;
  IF FOUND THEN
    PERFORM public.amora_first_use_action_assert_current_v1(
      v_promotion_id,
      NEW.couple_id,
      NULL
    );
  END IF;
  RETURN NEW;
END
$function$;

ALTER FUNCTION public.validate_amora_first_use_shared_action_write_v1()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION
  public.validate_amora_first_use_shared_action_write_v1()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_validate_amora_first_use_action_acceptance_v1
  BEFORE INSERT OR UPDATE ON public.amora_shared_action_acceptances
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_amora_first_use_shared_action_write_v1();
CREATE TRIGGER trg_validate_amora_first_use_action_application_v1
  BEFORE INSERT OR UPDATE ON public.amora_shared_action_application_claims
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_amora_first_use_shared_action_write_v1();

CREATE FUNCTION public.amora_shared_action_context_with_first_use_promotion_v1(
  p_action_id uuid,
  p_couple_id uuid,
  p_source_message_id uuid,
  p_user_id uuid,
  p_purpose text,
  p_confirmation_message_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_context jsonb;
  v_promotion_id uuid;
  v_promotion jsonb;
BEGIN
  v_context := public.amora_shared_action_context(
    p_action_id,
    p_couple_id,
    p_source_message_id,
    p_user_id,
    p_purpose,
    p_confirmation_message_id
  );
  SELECT binding.promotion_id
    INTO v_promotion_id
  FROM public.amora_first_use_action_proposal_bindings AS binding
  WHERE binding.couple_id = p_couple_id
    AND binding.proposal_message_id = p_source_message_id
    AND binding.action_id = p_action_id;
  IF NOT FOUND THEN
    RETURN v_context;
  END IF;

  v_promotion := public.amora_first_use_action_assert_current_v1(
    v_promotion_id,
    p_couple_id,
    NULL
  );
  RETURN v_context || jsonb_build_object(
    'firstUsePromotionId', v_promotion_id,
    'canonicalAddActionInput', v_promotion -> 'canonicalAddActionInput'
  );
END
$function$;

ALTER FUNCTION public.amora_shared_action_context_with_first_use_promotion_v1(
  uuid, uuid, uuid, uuid, text, uuid
) OWNER TO postgres;
REVOKE ALL ON FUNCTION
  public.amora_shared_action_context_with_first_use_promotion_v1(
    uuid, uuid, uuid, uuid, text, uuid
  ) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.amora_shared_action_context_with_first_use_promotion_v1(
    uuid, uuid, uuid, uuid, text, uuid
  ) TO service_role;

CREATE FUNCTION public.bind_amora_first_use_action_apply_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_context_couple_id text := current_setting(
    'hanbang.amora_shared_action_couple_id',
    true
  );
  v_request_key text := current_setting(
    'hanbang.amora_shared_action_request_key',
    true
  );
  v_operation_key text := current_setting(
    'hanbang.amora_shared_action_operation_key',
    true
  );
  v_context_action_id text := current_setting(
    'hanbang.amora_shared_action_action_id',
    true
  );
  v_expected_revision text := current_setting(
    'hanbang.amora_shared_action_expected_revision',
    true
  );
  v_execution record;
  v_confirmation_message_id uuid;
  v_proposal_message_id uuid;
  v_promotion_id uuid;
  v_promotion jsonb;
  v_proposal_input jsonb;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.first_use_promotion_id IS DISTINCT FROM OLD.first_use_promotion_id THEN
      RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_IMMUTABLE'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF COALESCE(v_context_couple_id, '') !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR COALESCE(v_context_action_id, '') !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR COALESCE(v_request_key, '') = ''
     OR COALESCE(v_operation_key, '') !~ '^[a-f0-9]{64}$'
     OR COALESCE(v_expected_revision, '') !~ '^(0|[1-9][0-9]{0,15})$'
  THEN
    IF NEW.first_use_promotion_id IS NOT NULL THEN
      RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_APPLY_CONTEXT_INVALID'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  SELECT execution.tool_name,
         execution.input_digest,
         execution.status,
         execution.pending_action_id,
         execution.pending_action_journey_revision
    INTO v_execution
  FROM public.amora_tool_executions AS execution
  WHERE execution.couple_id = v_context_couple_id::uuid
    AND execution.request_key = v_request_key
    AND execution.operation_key = v_operation_key
    AND execution.pending_action_id = v_context_action_id::uuid
  FOR SHARE;
  IF NOT FOUND THEN
    IF NEW.first_use_promotion_id IS NOT NULL THEN
      RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_APPLY_CONTEXT_INVALID'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  SELECT claim.user_message_id
    INTO v_confirmation_message_id
  FROM public.amora_chat_request_claims AS claim
  WHERE claim.couple_id = v_context_couple_id::uuid
    AND claim.request_key = v_request_key
    AND claim.status = 'processing'
    AND claim.visibility = 'shared'
    AND claim.user_message_id IS NOT NULL
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_APPLY_CONTEXT_INVALID'
      USING ERRCODE = '42501';
  END IF;

  SELECT application.source_message_id
    INTO v_proposal_message_id
  FROM public.amora_shared_action_application_claims AS application
  WHERE application.couple_id = v_context_couple_id::uuid
    AND application.action_id = v_context_action_id::uuid
    AND application.confirmation_message_id = v_confirmation_message_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_APPLY_CONTEXT_INVALID'
      USING ERRCODE = '42501';
  END IF;

  SELECT binding.promotion_id
    INTO v_promotion_id
  FROM public.amora_first_use_action_proposal_bindings AS binding
  WHERE binding.couple_id = v_context_couple_id::uuid
    AND binding.proposal_message_id = v_proposal_message_id
    AND binding.action_id = v_context_action_id::uuid;
  IF NOT FOUND THEN
    IF NEW.first_use_promotion_id IS NOT NULL THEN
      RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_APPLY_CONTEXT_INVALID'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  SELECT proposal.metadata #> '{pending_amora_action,input}'
    INTO v_proposal_input
  FROM public.chat_messages AS proposal
  WHERE proposal.id = v_proposal_message_id
    AND proposal.couple_id = v_context_couple_id::uuid
    AND proposal.metadata #>> '{pending_amora_action,actionId}'
      = v_context_action_id;
  v_promotion := public.amora_first_use_action_assert_current_v1(
    v_promotion_id,
    v_context_couple_id::uuid,
    NULL
  );

  IF NEW.couple_id IS DISTINCT FROM v_context_couple_id::uuid
     OR v_execution.tool_name IS DISTINCT FROM 'add_amora_action'
     OR v_execution.status IS DISTINCT FROM 'processing'
     OR v_execution.input_digest IS DISTINCT FROM
       v_promotion ->> 'actionDigest'
     OR v_execution.pending_action_journey_revision IS DISTINCT FROM
       (v_promotion ->> 'sourceRevision')::bigint
     OR v_execution.pending_action_journey_revision IS DISTINCT FROM
       v_expected_revision::bigint
     OR v_proposal_input IS DISTINCT FROM
       v_promotion -> 'canonicalAddActionInput'
     OR NEW.title IS DISTINCT FROM
       v_promotion #>> '{canonicalAddActionInput,title}'
     OR NEW.description IS DISTINCT FROM
       v_promotion #>> '{canonicalAddActionInput,description}'
     OR NEW.category_key IS NOT NULL
     OR NEW.priority IS DISTINCT FROM 'medium'
     OR NEW.source IS DISTINCT FROM 'chat'
     OR NEW.due_date IS NOT NULL THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_APPLY_CONTEXT_INVALID'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.amora_actions AS action
    WHERE action.first_use_promotion_id = v_promotion_id
  ) THEN
    RAISE EXCEPTION 'AMORA_FIRST_USE_PROMOTION_CONSUMED'
      USING ERRCODE = '23505';
  END IF;

  NEW.first_use_promotion_id := v_promotion_id;
  RETURN NEW;
END
$function$;

ALTER FUNCTION public.bind_amora_first_use_action_apply_v1()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.bind_amora_first_use_action_apply_v1()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_bind_amora_first_use_action_apply_v1
  BEFORE INSERT OR UPDATE ON public.amora_actions
  FOR EACH ROW
  EXECUTE FUNCTION public.bind_amora_first_use_action_apply_v1();

COMMIT;
