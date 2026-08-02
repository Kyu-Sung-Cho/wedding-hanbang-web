BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preconditions$
BEGIN
  IF to_regclass('public.couples') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.amora_memory_settings') IS NULL
     OR to_regclass('public.amora_memory_consents') IS NULL
     OR to_regclass('public.amora_personalization_preferences') IS NULL
     OR to_regclass('public.amora_chat_request_claims') IS NULL
     OR to_regclass('public.ai_interactions_log') IS NULL
     OR to_regprocedure('auth.uid()') IS NULL
     OR to_regprocedure('auth.role()') IS NULL
     OR to_regprocedure(
       'public.has_current_amora_memory_consent(uuid,text)'
     ) IS NULL
     OR to_regprocedure(
       'public.get_own_amora_privacy_context_snapshot(uuid,text[])'
     ) IS NULL
     OR to_regprocedure(
       'public.finalize_amora_provider_call_receipt(uuid,uuid,boolean,text,bigint,boolean,text,text,integer,integer,integer,jsonb)'
     ) IS NULL
     OR to_regprocedure(
       'public.finalize_amora_chat_response(uuid,uuid,uuid,uuid,text,text,integer,text,jsonb,text,text,boolean,text,bigint,boolean,text,text,integer,integer,integer,jsonb)'
     ) IS NULL THEN
    RAISE EXCEPTION 'AMORA_ATOMIC_PRIVACY_EPOCH_PREREQUISITE_MISSING';
  END IF;
END
$preconditions$;

CREATE TABLE public.amora_privacy_context_epochs (
  couple_id uuid PRIMARY KEY
    REFERENCES public.couples(id) ON DELETE CASCADE,
  epoch bigint NOT NULL CHECK (epoch >= 1),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.amora_privacy_context_epochs OWNER TO postgres;
ALTER TABLE public.amora_privacy_context_epochs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amora_privacy_context_epochs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.amora_privacy_context_epochs
  FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO public.amora_privacy_context_epochs(couple_id, epoch)
SELECT couple.id, 1
FROM public.couples AS couple;

CREATE FUNCTION public.advance_amora_privacy_context_epoch(
  p_couple_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF p_couple_id IS NULL THEN
    RETURN;
  END IF;

  -- ON DELETE CASCADE child triggers must not reacquire the epoch of a couple
  -- that the same statement has already removed. Besides being unnecessary,
  -- doing so could invert the chat-claim -> epoch finalizer lock order.
  IF NOT EXISTS (
    SELECT 1 FROM public.couples WHERE id = p_couple_id
  ) THEN
    RETURN;
  END IF;

  UPDATE public.amora_privacy_context_epochs
  SET epoch = epoch + 1,
      updated_at = clock_timestamp()
  WHERE couple_id = p_couple_id;

  IF NOT FOUND AND EXISTS (
    SELECT 1 FROM public.couples WHERE id = p_couple_id
  ) THEN
    RAISE EXCEPTION 'AMORA_PRIVACY_CONTEXT_EPOCH_MISSING';
  END IF;
END;
$function$;

ALTER FUNCTION public.advance_amora_privacy_context_epoch(uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.advance_amora_privacy_context_epoch(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.is_amora_profile_roster_binding(
  p_user_id uuid,
  p_couple_id uuid,
  p_role text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.couples AS couple
    WHERE couple.id = p_couple_id
      AND (
        (p_role = 'bride' AND couple.bride_id = p_user_id)
        OR (p_role = 'groom' AND couple.groom_id = p_user_id)
      )
  )
$function$;

ALTER FUNCTION public.is_amora_profile_roster_binding(uuid, uuid, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION
  public.is_amora_profile_roster_binding(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.capture_amora_couple_privacy_epoch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.amora_privacy_context_epochs(couple_id, epoch)
    VALUES (NEW.id, 1)
    ON CONFLICT (couple_id) DO NOTHING;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND (
       OLD.bride_id IS DISTINCT FROM NEW.bride_id
       OR OLD.groom_id IS DISTINCT FROM NEW.groom_id
     )
     AND (NEW.bride_id IS NOT NULL OR NEW.groom_id IS NOT NULL) THEN
    -- The existing account-deletion trigger removes a newly empty aggregate
    -- in this same statement. Its epoch row is deleted with the couple, so do
    -- not take an otherwise useless epoch lock before that cascade reaches
    -- the chat claim.
    PERFORM public.advance_amora_privacy_context_epoch(NEW.id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE FUNCTION public.capture_amora_profile_privacy_epoch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_old_couple_id uuid;
  v_new_couple_id uuid;
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.couple_id IS NOT DISTINCT FROM NEW.couple_id
     AND OLD.role IS NOT DISTINCT FROM NEW.role THEN
    RETURN NEW;
  END IF;

  IF TG_OP <> 'INSERT'
     AND public.is_amora_profile_roster_binding(
       OLD.id,
       OLD.couple_id,
       OLD.role
     ) THEN
    v_old_couple_id := OLD.couple_id;
  END IF;

  IF TG_OP <> 'DELETE'
     AND public.is_amora_profile_roster_binding(
       NEW.id,
       NEW.couple_id,
       NEW.role
     ) THEN
    v_new_couple_id := NEW.couple_id;
  END IF;

  PERFORM public.advance_amora_privacy_context_epoch(v_old_couple_id);
  IF v_new_couple_id IS DISTINCT FROM v_old_couple_id THEN
    PERFORM public.advance_amora_privacy_context_epoch(v_new_couple_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE FUNCTION public.capture_amora_couple_scoped_privacy_epoch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.advance_amora_privacy_context_epoch(NEW.couple_id);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.advance_amora_privacy_context_epoch(OLD.couple_id);
    RETURN OLD;
  END IF;

  PERFORM public.advance_amora_privacy_context_epoch(OLD.couple_id);
  IF NEW.couple_id IS DISTINCT FROM OLD.couple_id THEN
    PERFORM public.advance_amora_privacy_context_epoch(NEW.couple_id);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION public.current_amora_personalization_couple_id(
  p_user_id uuid
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT profile.couple_id
  FROM public.profiles AS profile
  JOIN public.couples AS couple ON couple.id = profile.couple_id
  WHERE profile.id = p_user_id
    AND (
      (profile.role = 'bride' AND couple.bride_id = p_user_id)
      OR (profile.role = 'groom' AND couple.groom_id = p_user_id)
    )
$function$;

CREATE FUNCTION public.capture_amora_personalization_privacy_epoch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_old_couple_id uuid;
  v_new_couple_id uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old_couple_id := public.current_amora_personalization_couple_id(
      OLD.owner_user_id
    );
    PERFORM public.advance_amora_privacy_context_epoch(v_old_couple_id);
  END IF;

  IF TG_OP <> 'DELETE' THEN
    v_new_couple_id := public.current_amora_personalization_couple_id(
      NEW.owner_user_id
    );
    IF v_new_couple_id IS DISTINCT FROM v_old_couple_id THEN
      PERFORM public.advance_amora_privacy_context_epoch(v_new_couple_id);
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

ALTER FUNCTION public.capture_amora_couple_privacy_epoch()
  OWNER TO postgres;
ALTER FUNCTION public.capture_amora_profile_privacy_epoch()
  OWNER TO postgres;
ALTER FUNCTION public.capture_amora_couple_scoped_privacy_epoch()
  OWNER TO postgres;
ALTER FUNCTION public.current_amora_personalization_couple_id(uuid)
  OWNER TO postgres;
ALTER FUNCTION public.capture_amora_personalization_privacy_epoch()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.capture_amora_couple_privacy_epoch()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.capture_amora_profile_privacy_epoch()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.capture_amora_couple_scoped_privacy_epoch()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.current_amora_personalization_couple_id(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.capture_amora_personalization_privacy_epoch()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_amora_privacy_epoch_couples
  ON public.couples;
CREATE TRIGGER trg_amora_privacy_epoch_couples
  AFTER INSERT OR UPDATE OR DELETE ON public.couples
  FOR EACH ROW EXECUTE FUNCTION public.capture_amora_couple_privacy_epoch();
DROP TRIGGER IF EXISTS trg_amora_privacy_epoch_profiles
  ON public.profiles;
CREATE TRIGGER trg_amora_privacy_epoch_profiles
  AFTER INSERT OR UPDATE OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.capture_amora_profile_privacy_epoch();
DROP TRIGGER IF EXISTS trg_amora_privacy_epoch_memory_settings
  ON public.amora_memory_settings;
CREATE TRIGGER trg_amora_privacy_epoch_memory_settings
  AFTER INSERT OR UPDATE OR DELETE ON public.amora_memory_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.capture_amora_couple_scoped_privacy_epoch();
DROP TRIGGER IF EXISTS trg_amora_privacy_epoch_memory_consents
  ON public.amora_memory_consents;
CREATE TRIGGER trg_amora_privacy_epoch_memory_consents
  AFTER INSERT OR UPDATE OR DELETE ON public.amora_memory_consents
  FOR EACH ROW
  EXECUTE FUNCTION public.capture_amora_couple_scoped_privacy_epoch();
DROP TRIGGER IF EXISTS trg_amora_privacy_epoch_personalization
  ON public.amora_personalization_preferences;
CREATE TRIGGER trg_amora_privacy_epoch_personalization
  AFTER INSERT OR UPDATE OR DELETE
  ON public.amora_personalization_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.capture_amora_personalization_privacy_epoch();

CREATE OR REPLACE FUNCTION public.get_own_amora_privacy_context_snapshot(
  p_couple_id uuid,
  p_visibilities text[]
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '5s'
AS $function$
DECLARE
  v_user_id uuid;
  v_actor_role text;
  v_bride_id uuid;
  v_groom_id uuid;
  v_requested_count integer;
  v_distinct_count integer;
  v_memory jsonb;
  v_personalization_exists boolean;
  v_personalization_revision bigint;
  v_roster_fingerprint text;
  v_privacy_epoch bigint;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AMORA_PRIVACY_CONTEXT_AUTH_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF p_couple_id IS NULL
     OR p_visibilities IS NULL
     OR pg_catalog.cardinality(p_visibilities) NOT BETWEEN 1 AND 2
     OR pg_catalog.array_position(p_visibilities, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'AMORA_PRIVACY_CONTEXT_VISIBILITIES_INVALID'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    pg_catalog.count(*)::integer,
    pg_catalog.count(DISTINCT requested.visibility)::integer
  INTO v_requested_count, v_distinct_count
  FROM pg_catalog.unnest(p_visibilities) AS requested(visibility)
  WHERE requested.visibility IN (
    'shared',
    'bride_private',
    'groom_private'
  );

  IF v_requested_count IS DISTINCT FROM pg_catalog.cardinality(p_visibilities)
     OR v_distinct_count IS DISTINCT FROM v_requested_count THEN
    RAISE EXCEPTION 'AMORA_PRIVACY_CONTEXT_VISIBILITIES_INVALID'
      USING ERRCODE = '22023';
  END IF;

  SELECT profile.role, couple.bride_id, couple.groom_id
  INTO v_actor_role, v_bride_id, v_groom_id
  FROM public.profiles AS profile
  JOIN public.couples AS couple
    ON couple.id = profile.couple_id
  WHERE profile.id = v_user_id
    AND profile.couple_id = p_couple_id
    AND (
      (profile.role = 'bride' AND couple.bride_id = v_user_id)
      OR (profile.role = 'groom' AND couple.groom_id = v_user_id)
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_PRIVACY_CONTEXT_SCOPE_INVALID'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.unnest(p_visibilities) AS requested(visibility)
    WHERE (requested.visibility = 'bride_private' AND v_actor_role <> 'bride')
       OR (requested.visibility = 'groom_private' AND v_actor_role <> 'groom')
  ) THEN
    RAISE EXCEPTION 'AMORA_PRIVACY_CONTEXT_SCOPE_INVALID'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(
    pg_catalog.jsonb_object_agg(
      requested.visibility,
      pg_catalog.jsonb_build_object(
        'enabled',
        public.has_current_amora_memory_consent(
          p_couple_id,
          requested.visibility
        ),
        'resetAt',
        setting.memory_reset_at
      )
    ),
    '{}'::jsonb
  )
  INTO v_memory
  FROM pg_catalog.unnest(p_visibilities) AS requested(visibility)
  LEFT JOIN public.amora_memory_settings AS setting
    ON setting.couple_id = p_couple_id
   AND setting.visibility = requested.visibility;

  SELECT preference.revision
  INTO v_personalization_revision
  FROM public.amora_personalization_preferences AS preference
  WHERE preference.owner_user_id = v_user_id;
  v_personalization_exists := FOUND;

  SELECT privacy.epoch
  INTO v_privacy_epoch
  FROM public.amora_privacy_context_epochs AS privacy
  WHERE privacy.couple_id = p_couple_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_PRIVACY_CONTEXT_EPOCH_MISSING';
  END IF;

  v_roster_fingerprint := pg_catalog.md5(
    'amora-privacy-roster-v1:'
    || COALESCE(v_bride_id::text, '-')
    || ':'
    || COALESCE(v_groom_id::text, '-')
  );

  RETURN pg_catalog.jsonb_build_object(
    'version', 2,
    'privacyEpoch', v_privacy_epoch,
    'actorRole', v_actor_role,
    'rosterFingerprint', v_roster_fingerprint,
    'memory', v_memory,
    'personalization', pg_catalog.jsonb_build_object(
      'exists', v_personalization_exists,
      'revision',
      CASE
        WHEN v_personalization_exists THEN v_personalization_revision
        ELSE NULL
      END
    )
  );
END;
$function$;

ALTER FUNCTION public.get_own_amora_privacy_context_snapshot(uuid, text[])
  OWNER TO postgres;
REVOKE ALL ON FUNCTION
  public.get_own_amora_privacy_context_snapshot(uuid, text[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.get_own_amora_privacy_context_snapshot(uuid, text[])
  TO authenticated;

CREATE FUNCTION public.get_own_amora_privacy_epoch(
  p_couple_id uuid,
  p_visibility text
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '5s'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_actor_role text;
  v_privacy_epoch bigint;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AMORA_PRIVACY_CONTEXT_AUTH_REQUIRED'
      USING ERRCODE = '42501';
  END IF;
  IF p_couple_id IS NULL
     OR p_visibility IS NULL
     OR p_visibility NOT IN (
       'shared', 'bride_private', 'groom_private'
     ) THEN
    RAISE EXCEPTION 'AMORA_PRIVACY_CONTEXT_VISIBILITY_INVALID'
      USING ERRCODE = '22023';
  END IF;

  SELECT profile.role
  INTO v_actor_role
  FROM public.profiles AS profile
  JOIN public.couples AS couple
    ON couple.id = profile.couple_id
  WHERE profile.id = v_user_id
    AND profile.couple_id = p_couple_id
    AND (
      (profile.role = 'bride' AND couple.bride_id = v_user_id)
      OR (profile.role = 'groom' AND couple.groom_id = v_user_id)
    );

  IF NOT FOUND
     OR (p_visibility = 'bride_private' AND v_actor_role <> 'bride')
     OR (p_visibility = 'groom_private' AND v_actor_role <> 'groom') THEN
    RAISE EXCEPTION 'AMORA_PRIVACY_CONTEXT_SCOPE_INVALID'
      USING ERRCODE = '42501';
  END IF;

  SELECT privacy.epoch
  INTO v_privacy_epoch
  FROM public.amora_privacy_context_epochs AS privacy
  WHERE privacy.couple_id = p_couple_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_PRIVACY_CONTEXT_EPOCH_MISSING';
  END IF;

  RETURN v_privacy_epoch;
END;
$function$;

ALTER FUNCTION public.get_own_amora_privacy_epoch(uuid, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_own_amora_privacy_epoch(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_own_amora_privacy_epoch(uuid, text)
  TO authenticated;

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
  v_privacy_epoch bigint;
  v_expected_request_key boolean;
  v_is_conflict_mediation boolean := false;
  v_finalized boolean;
  v_receipt_status text;
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

  -- Preserve the established receipt -> chat claim lock order. A conflict
  -- mediation additionally locks the couple before the epoch so it cannot
  -- deadlock with roster mutations, whose trigger order is couple -> epoch.
  SELECT * INTO v_receipt
  FROM public.ai_interactions_log
  WHERE id = p_receipt_id
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
  FROM public.amora_chat_request_claims
  WHERE couple_id = p_chat_couple_id
    AND request_key = p_chat_request_key
  FOR UPDATE;

  IF NOT FOUND
     OR v_claim.user_id IS DISTINCT FROM p_chat_user_id
     OR v_claim.visibility IS DISTINCT FROM p_chat_visibility
     OR v_claim.attempt_count IS DISTINCT FROM p_chat_claim_attempt_count
  THEN
    RAISE EXCEPTION 'AMORA_CHAT_RESPONSE_CLAIM_STALE'
      USING ERRCODE = '40001';
  END IF;

  -- Terminal outcomes are immutable. A lost RPC response must replay the
  -- committed result even when the couple's privacy epoch changed later.
  IF v_claim.status = 'completed'
     OR (
       v_claim.status = 'failed'
       AND v_claim.failure_code = 'COOLDOWN_RACE_LOST'
     ) THEN
    RETURN QUERY
    SELECT result.*
    FROM public.finalize_amora_chat_response(
      p_receipt_id,
      p_receipt_claim_token,
      p_chat_couple_id,
      p_chat_user_id,
      p_chat_request_key,
      p_chat_visibility,
      p_chat_claim_attempt_count,
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

  IF v_claim.status = 'failed'
     AND v_claim.failure_code = 'PRIVACY_CONTEXT_CHANGED'
     AND v_claim.message_id IS NULL
     AND v_receipt.amora_cost_status IN ('settled', 'unknown') THEN
    RETURN QUERY SELECT
      true,
      v_receipt.amora_cost_status,
      'privacy_context_changed'::text,
      NULL::uuid,
      NULL::timestamptz,
      NULL::text,
      NULL::jsonb,
      NULL::text,
      NULL::text,
      NULL::text,
      false;
    RETURN;
  END IF;

  IF v_claim.status IS DISTINCT FROM 'processing'
     OR v_receipt.amora_cost_status IS DISTINCT FROM 'reserved' THEN
    RAISE EXCEPTION 'AMORA_CHAT_RESPONSE_RECONCILIATION_REQUIRED'
      USING ERRCODE = '55000';
  END IF;

  IF v_is_conflict_mediation THEN
    PERFORM 1
    FROM public.couples
    WHERE id = p_chat_couple_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'AMORA_CHAT_RESPONSE_COUPLE_MISSING';
    END IF;
  END IF;

  SELECT privacy.epoch
  INTO v_privacy_epoch
  FROM public.amora_privacy_context_epochs AS privacy
  WHERE privacy.couple_id = p_chat_couple_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_PRIVACY_CONTEXT_EPOCH_MISSING';
  END IF;
  IF v_privacy_epoch IS DISTINCT FROM p_expected_privacy_epoch THEN
    SELECT result.finalized, result.receipt_status
    INTO v_finalized, v_receipt_status
    FROM public.finalize_amora_provider_call_receipt(
      p_receipt_id,
      p_receipt_claim_token,
      true,
      p_usage_status,
      p_actual_cost_microusd,
      false,
      'privacy_context_changed',
      p_model,
      p_tokens_input,
      p_tokens_output,
      p_latency_ms,
      jsonb_build_object(
        'content_logging', 'disabled',
        'ledger_status', 'finalized',
        'privacy_fence_status', 'discarded_privacy_revision'
      )
    ) AS result;

    IF v_finalized IS DISTINCT FROM true
       OR v_receipt_status NOT IN ('settled', 'unknown') THEN
      RAISE EXCEPTION 'AMORA_PRIVACY_CONTEXT_RECEIPT_FINALIZE_FAILED';
    END IF;

    -- The base cost finalizer records its accounting status in ledger_status.
    -- This terminal discard has a distinct audit lifecycle, so overwrite only
    -- these three fixed, non-content fields after settlement. Caller-provided
    -- receipt metadata is intentionally never merged on this branch.
    UPDATE public.ai_interactions_log
    SET metadata = metadata || jsonb_build_object(
          'content_logging', 'disabled',
          'ledger_status', 'finalized',
          'privacy_fence_status', 'discarded_privacy_revision'
        )
    WHERE id = p_receipt_id
      AND amora_claim_token = p_receipt_claim_token
      AND amora_cost_status = v_receipt_status;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'AMORA_PRIVACY_CONTEXT_RECEIPT_FINALIZE_FAILED';
    END IF;

    UPDATE public.amora_chat_request_claims
    SET status = 'failed',
        message_id = NULL,
        completed_at = NULL,
        failed_at = now(),
        failure_code = 'PRIVACY_CONTEXT_CHANGED'
    WHERE couple_id = p_chat_couple_id
      AND request_key = p_chat_request_key
      AND user_id = p_chat_user_id
      AND visibility = p_chat_visibility
      AND attempt_count = p_chat_claim_attempt_count
      AND status = 'processing';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'AMORA_CHAT_RESPONSE_CLAIM_STALE'
        USING ERRCODE = '40001';
    END IF;

    RETURN QUERY SELECT
      true,
      v_receipt_status,
      'privacy_context_changed'::text,
      NULL::uuid,
      NULL::timestamptz,
      NULL::text,
      NULL::jsonb,
      NULL::text,
      NULL::text,
      NULL::text,
      false;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT result.*
  FROM public.finalize_amora_chat_response(
    p_receipt_id,
    p_receipt_claim_token,
    p_chat_couple_id,
    p_chat_user_id,
    p_chat_request_key,
    p_chat_visibility,
    p_chat_claim_attempt_count,
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
END;
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

COMMENT ON TABLE public.amora_privacy_context_epochs IS
  'One monotonic, content-free privacy revision per couple; used only as an optimistic fence around Amora provider context.';
COMMENT ON COLUMN public.amora_privacy_context_epochs.epoch IS
  'Monotonic revision advanced by current roster/role, memory setting/consent, or personalization mutations.';
COMMENT ON FUNCTION public.get_own_amora_privacy_context_snapshot(uuid, text[])
  IS 'Authenticated current-roster privacy snapshot, version 2, including the couple privacy epoch used by the atomic response fence.';
COMMENT ON FUNCTION public.get_own_amora_privacy_epoch(uuid, text)
  IS 'Authenticated current-roster scalar privacy epoch for turns that intentionally skip memory and personalization context.';
COMMENT ON FUNCTION
  public.finalize_amora_chat_response_with_privacy_fence(
    uuid, uuid, uuid, uuid, text, text, integer, bigint, text, jsonb, text,
    text, boolean, text, bigint, boolean, text, text, integer, integer,
    integer, jsonb
  ) IS
  'Service-only terminal response commit: replays terminal claims, otherwise fences the existing atomic finalizer by the locked couple privacy epoch and atomically settles paid privacy discards without chat content.';

DO $postcheck$
BEGIN
  IF EXISTS (
       SELECT 1
       FROM public.couples AS couple
       LEFT JOIN public.amora_privacy_context_epochs AS privacy
         ON privacy.couple_id = couple.id
       WHERE privacy.couple_id IS NULL OR privacy.epoch < 1
     )
     OR (
       SELECT count(*)
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'amora_privacy_context_epochs'
     ) <> 3
     OR EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'amora_privacy_context_epochs'
         AND column_name NOT IN ('couple_id', 'epoch', 'updated_at')
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_class
       WHERE oid = 'public.amora_privacy_context_epochs'::regclass
         AND relrowsecurity
         AND relforcerowsecurity
     )
     OR EXISTS (
       SELECT 1
       FROM (VALUES
         (
           'trg_amora_privacy_epoch_couples',
           'public.couples'::regclass,
           'public.capture_amora_couple_privacy_epoch()'::regprocedure
         ),
         (
           'trg_amora_privacy_epoch_profiles',
           'public.profiles'::regclass,
           'public.capture_amora_profile_privacy_epoch()'::regprocedure
         ),
         (
           'trg_amora_privacy_epoch_memory_settings',
           'public.amora_memory_settings'::regclass,
           'public.capture_amora_couple_scoped_privacy_epoch()'::regprocedure
         ),
         (
           'trg_amora_privacy_epoch_memory_consents',
           'public.amora_memory_consents'::regclass,
           'public.capture_amora_couple_scoped_privacy_epoch()'::regprocedure
         ),
         (
           'trg_amora_privacy_epoch_personalization',
           'public.amora_personalization_preferences'::regclass,
           'public.capture_amora_personalization_privacy_epoch()'::regprocedure
         )
       ) AS expected(trigger_name, table_oid, function_oid)
       WHERE NOT EXISTS (
         SELECT 1
         FROM pg_trigger AS actual
         WHERE actual.tgname = expected.trigger_name
           AND actual.tgrelid = expected.table_oid
           AND actual.tgfoid = expected.function_oid
           AND NOT actual.tgisinternal
           AND actual.tgenabled IN ('O', 'A')
       )
     )
     OR NOT has_function_privilege(
       'authenticated',
       'public.get_own_amora_privacy_context_snapshot(uuid,text[])',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.get_own_amora_privacy_context_snapshot(uuid,text[])',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.get_own_amora_privacy_context_snapshot(uuid,text[])',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       'public.get_own_amora_privacy_epoch(uuid,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.get_own_amora_privacy_epoch(uuid,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.get_own_amora_privacy_epoch(uuid,text)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.finalize_amora_chat_response_with_privacy_fence(uuid,uuid,uuid,uuid,text,text,integer,bigint,text,jsonb,text,text,boolean,text,bigint,boolean,text,text,integer,integer,integer,jsonb)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.finalize_amora_chat_response_with_privacy_fence(uuid,uuid,uuid,uuid,text,text,integer,bigint,text,jsonb,text,text,boolean,text,bigint,boolean,text,text,integer,integer,integer,jsonb)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.finalize_amora_chat_response_with_privacy_fence(uuid,uuid,uuid,uuid,text,text,integer,bigint,text,jsonb,text,text,boolean,text,bigint,boolean,text,text,integer,integer,integer,jsonb)',
       'EXECUTE'
     )
     OR EXISTS (
       SELECT 1
       FROM information_schema.role_table_grants
       WHERE table_schema = 'public'
         AND table_name = 'amora_privacy_context_epochs'
         AND grantee IN ('anon', 'authenticated', 'service_role')
     )
     OR EXISTS (
       SELECT 1
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
     )
     OR EXISTS (
       SELECT 1
       FROM pg_proc
       WHERE oid IN (
         'public.get_own_amora_privacy_context_snapshot(uuid,text[])'::regprocedure,
         'public.get_own_amora_privacy_epoch(uuid,text)'::regprocedure,
         'public.finalize_amora_chat_response_with_privacy_fence(uuid,uuid,uuid,uuid,text,text,integer,bigint,text,jsonb,text,text,boolean,text,bigint,boolean,text,text,integer,integer,integer,jsonb)'::regprocedure
       )
       AND prosecdef IS DISTINCT FROM true
     ) THEN
    RAISE EXCEPTION 'AMORA_ATOMIC_PRIVACY_EPOCH_POSTCHECK_FAILED';
  END IF;
END
$postcheck$;

COMMIT;
