BEGIN;

-- 2026-11-13 P1 "아모라가 먼저 알려 주기" 동의 화면.
--
-- Until now one column, care_notifications_enabled, opened two channels at
-- once: the care message Amora writes into the shared chat, and the same
-- message by email. The founder decided (2026-11-13) that email consent is
-- asked separately, so that a person who opted into shared-chat messages while
-- email was switched off never starts receiving email the day it is switched on.
--
-- Shape of the change:
--   * profiles gains care_email_enabled / care_email_consented_at and
--     care_prompt_answered_at (the lounge asks once; an answer either way ends it).
--   * Email consent requires shared-chat consent. Withdrawing shared-chat
--     consent also withdraws email consent in the same row update.
--   * patch_profile_atomic and claim_amora_care_email_delivery are renamed and
--     wrapped, the same convergence pattern as 20260716095000, so the reviewed
--     consent/roster/lock logic is reused rather than copied.
--   * Lock order stays jobs -> profiles -> deliveries, the worker's order.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS care_email_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS care_email_consented_at timestamptz,
  ADD COLUMN IF NOT EXISTS care_prompt_answered_at timestamptz;

-- The historical single consent was presented as email consent ("이메일 수신
-- 동의"), so an existing valid consent keeps both channels. Production had zero
-- such rows on 2026-11-13; this keeps any other database faithful to what the
-- person agreed to instead of silently dropping or widening it.
UPDATE public.profiles
SET care_email_enabled = true,
    care_email_consented_at = care_notifications_consented_at
WHERE care_notifications_enabled = true
  AND care_notifications_consented_at IS NOT NULL
  AND care_email_enabled = false;

-- Same write-compatible pattern as the existing consent invariant: add the
-- check NOT VALID, then validate it.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_care_email_consent_state_valid;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_care_email_consent_state_valid
  CHECK (care_email_enabled = (care_email_consented_at IS NOT NULL)) NOT VALID;
ALTER TABLE public.profiles
  VALIDATE CONSTRAINT profiles_care_email_consent_state_valid;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_care_email_requires_shared_consent;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_care_email_requires_shared_consent
  CHECK (NOT care_email_enabled OR care_notifications_enabled) NOT VALID;
ALTER TABLE public.profiles
  VALIDATE CONSTRAINT profiles_care_email_requires_shared_consent;

-- Email is "the same shared-chat message, also by email". When shared-chat
-- consent is withdrawn by any writer (the profile API, the legacy opt-out, a
-- future path), email consent goes with it in the same row version. Re-enabling
-- shared chat later never resumes email without a fresh email opt-in.
CREATE OR REPLACE FUNCTION public.normalize_amora_care_email_consent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.care_notifications_enabled IS DISTINCT FROM true THEN
    NEW.care_email_enabled := false;
    NEW.care_email_consented_at := NULL;
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_normalize_amora_care_email_consent ON public.profiles;
CREATE TRIGGER trg_normalize_amora_care_email_consent
  BEFORE UPDATE OF care_notifications_enabled, care_notifications_consented_at
  ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_amora_care_email_consent();

-- Clients keep table-level UPDATE on their own profile row. Every consent
-- column, old and new, must still be written only through the service RPC.
CREATE OR REPLACE FUNCTION public.prevent_direct_amora_care_consent_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF current_user IN ('anon', 'authenticated')
     AND (
       NEW.care_notifications_enabled IS DISTINCT FROM OLD.care_notifications_enabled
       OR NEW.care_notifications_consented_at IS DISTINCT FROM OLD.care_notifications_consented_at
       OR NEW.care_email_enabled IS DISTINCT FROM OLD.care_email_enabled
       OR NEW.care_email_consented_at IS DISTINCT FROM OLD.care_email_consented_at
       OR NEW.care_prompt_answered_at IS DISTINCT FROM OLD.care_prompt_answered_at
     ) THEN
    RAISE EXCEPTION 'AMORA_CARE_CONSENT_DIRECT_UPDATE_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_prevent_direct_amora_care_consent_change ON public.profiles;
CREATE TRIGGER trg_prevent_direct_amora_care_consent_change
  BEFORE UPDATE OF
    care_notifications_enabled,
    care_notifications_consented_at,
    care_email_enabled,
    care_email_consented_at,
    care_prompt_answered_at
  ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_direct_amora_care_consent_change();

ALTER FUNCTION public.patch_profile_atomic(
  uuid, text, text, boolean, boolean, boolean, text, boolean, boolean
) RENAME TO patch_profile_atomic_pre_email_consent;

CREATE OR REPLACE FUNCTION public.patch_profile_atomic(
  p_user_id uuid,
  p_name text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_phone_provided boolean DEFAULT false,
  p_phone_care_consent boolean DEFAULT NULL,
  p_care_notifications_enabled boolean DEFAULT NULL,
  p_community_nickname text DEFAULT NULL,
  p_force_community_nickname_sync boolean DEFAULT false,
  p_community_nickname_provided boolean DEFAULT false,
  p_care_email_enabled boolean DEFAULT NULL,
  p_care_prompt_answered boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '20s'
AS $function$
DECLARE
  v_base_patch boolean;
  v_result jsonb;
  v_couple_id uuid;
  v_profile public.profiles%ROWTYPE;
  v_cancelled_email_deliveries integer := 0;
BEGIN
  IF p_user_id IS NULL OR p_care_prompt_answered IS NULL THEN
    RAISE EXCEPTION 'PROFILE_PATCH_INVALID' USING ERRCODE = '22023';
  END IF;

  v_base_patch := p_name IS NOT NULL
    OR p_phone IS NOT NULL
    OR p_phone_provided IS DISTINCT FROM false
    OR p_phone_care_consent IS NOT NULL
    OR p_care_notifications_enabled IS NOT NULL
    OR p_community_nickname IS NOT NULL
    OR p_force_community_nickname_sync IS DISTINCT FROM false
    OR p_community_nickname_provided IS DISTINCT FROM false;

  IF NOT v_base_patch
     AND p_care_email_enabled IS NULL
     AND NOT p_care_prompt_answered THEN
    RAISE EXCEPTION 'PROFILE_PATCH_INVALID' USING ERRCODE = '22023';
  END IF;

  -- Asking for email while withdrawing shared chat in the same call is a
  -- contradiction, not something to resolve silently in either direction.
  IF p_care_email_enabled = true AND p_care_notifications_enabled = false THEN
    RAISE EXCEPTION 'PROFILE_PATCH_CARE_EMAIL_REQUIRES_SHARED_CONSENT'
      USING ERRCODE = '22023';
  END IF;

  -- Withdrawals touch the queue. Take the couple's active jobs first, exactly
  -- like the wrapped function and the worker do, before any profile row lock.
  IF p_care_notifications_enabled = false OR p_care_email_enabled = false THEN
    SELECT id INTO v_couple_id
    FROM public.couples
    WHERE bride_id = p_user_id OR groom_id = p_user_id
    ORDER BY id
    LIMIT 1;

    IF v_couple_id IS NOT NULL THEN
      PERFORM 1
      FROM public.amora_care_jobs
      WHERE couple_id = v_couple_id
        AND status IN ('pending', 'processing')
      ORDER BY id
      FOR UPDATE;
    END IF;
  END IF;

  IF v_base_patch THEN
    v_result := public.patch_profile_atomic_pre_email_consent(
      p_user_id,
      p_name,
      p_phone,
      p_phone_provided,
      p_phone_care_consent,
      p_care_notifications_enabled,
      p_community_nickname,
      p_force_community_nickname_sync,
      p_community_nickname_provided
    );
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROFILE_PATCH_PROFILE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF p_care_email_enabled = true THEN
    IF v_profile.care_notifications_enabled IS DISTINCT FROM true
       OR v_profile.care_notifications_consented_at IS NULL THEN
      RAISE EXCEPTION 'PROFILE_PATCH_CARE_EMAIL_REQUIRES_SHARED_CONSENT'
        USING ERRCODE = '22023';
    END IF;
    UPDATE public.profiles
    SET care_email_enabled = true,
        care_email_consented_at = now(),
        updated_at = now()
    WHERE id = p_user_id
    RETURNING * INTO v_profile;
  ELSIF p_care_email_enabled = false THEN
    UPDATE public.profiles
    SET care_email_enabled = false,
        care_email_consented_at = NULL,
        updated_at = now()
    WHERE id = p_user_id
    RETURNING * INTO v_profile;

    -- Mail that has not been handed to a worker yet is cancelled now. A
    -- delivery already processing cannot be recalled from the provider; the
    -- claim wrapper below refuses any retry of it.
    IF v_couple_id IS NOT NULL THEN
      UPDATE public.amora_care_deliveries AS delivery
      SET status = 'cancelled',
          completed_at = now(),
          updated_at = now(),
          recipient_email = NULL,
          recipient_name = NULL,
          last_error = 'email_consent_withdrawn'
      FROM public.amora_care_jobs AS job
      WHERE delivery.job_id = job.id
        AND job.couple_id = v_couple_id
        AND job.status IN ('pending', 'processing')
        AND delivery.user_id = p_user_id
        AND delivery.status = 'pending';
      GET DIAGNOSTICS v_cancelled_email_deliveries = ROW_COUNT;
    END IF;
  END IF;

  IF p_care_prompt_answered THEN
    UPDATE public.profiles
    SET care_prompt_answered_at = COALESCE(care_prompt_answered_at, now()),
        updated_at = now()
    WHERE id = p_user_id
    RETURNING * INTO v_profile;
  END IF;

  RETURN jsonb_build_object(
    'profile', to_jsonb(v_profile),
    'community_profile_synced',
      COALESCE((v_result->>'community_profile_synced')::boolean, false),
    'community_nickname', v_result->'community_nickname',
    'cancelled_jobs', COALESCE((v_result->>'cancelled_jobs')::integer, 0),
    'cancelled_email_deliveries', v_cancelled_email_deliveries
  );
END
$function$;

ALTER FUNCTION public.claim_amora_care_email_delivery(uuid, uuid)
  RENAME TO claim_amora_care_email_delivery_pre_email_consent;

CREATE OR REPLACE FUNCTION public.claim_amora_care_email_delivery(
  p_job_id uuid,
  p_lease_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '20s'
AS $function$
DECLARE
  v_job public.amora_care_jobs%ROWTYPE;
  v_bride_id uuid;
  v_groom_id uuid;
BEGIN
  SELECT * INTO v_job
  FROM public.amora_care_jobs
  WHERE id = p_job_id
  FOR UPDATE;
  IF NOT FOUND OR v_job.status <> 'processing'
     OR v_job.lease_token IS DISTINCT FROM p_lease_token
     OR v_job.lease_expires_at <= now() THEN
    RAISE EXCEPTION 'AMORA_CARE_JOB_LEASE_LOST' USING ERRCODE = '55000';
  END IF;

  SELECT bride_id, groom_id INTO v_bride_id, v_groom_id
  FROM public.couples
  WHERE id = v_job.couple_id
  FOR SHARE;
  PERFORM 1
  FROM public.profiles
  WHERE id IN (v_bride_id, v_groom_id)
  ORDER BY id
  FOR SHARE;

  -- Shared-chat consent of both members is still required by the wrapped
  -- function. On top of that, only a member who opted into email receives it.
  UPDATE public.amora_care_deliveries AS delivery
  SET status = 'skipped',
      completed_at = now(),
      updated_at = now(),
      recipient_email = NULL,
      recipient_name = NULL,
      last_error = 'email_not_consented'
  WHERE delivery.job_id = v_job.id
    AND delivery.status = 'pending'
    AND NOT EXISTS (
      SELECT 1
      FROM public.profiles AS member
      WHERE member.id = delivery.user_id
        AND member.care_email_enabled = true
        AND member.care_email_consented_at IS NOT NULL
    );

  RETURN public.claim_amora_care_email_delivery_pre_email_consent(
    p_job_id,
    p_lease_token
  );
END
$function$;

ALTER FUNCTION public.normalize_amora_care_email_consent() OWNER TO postgres;
ALTER FUNCTION public.prevent_direct_amora_care_consent_change() OWNER TO postgres;
ALTER FUNCTION public.patch_profile_atomic(
  uuid, text, text, boolean, boolean, boolean, text, boolean, boolean, boolean, boolean
) OWNER TO postgres;
ALTER FUNCTION public.patch_profile_atomic_pre_email_consent(
  uuid, text, text, boolean, boolean, boolean, text, boolean, boolean
) OWNER TO postgres;
ALTER FUNCTION public.claim_amora_care_email_delivery(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.claim_amora_care_email_delivery_pre_email_consent(uuid, uuid)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.normalize_amora_care_email_consent()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.prevent_direct_amora_care_consent_change()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.patch_profile_atomic_pre_email_consent(
  uuid, text, text, boolean, boolean, boolean, text, boolean, boolean
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_amora_care_email_delivery_pre_email_consent(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.patch_profile_atomic(
  uuid, text, text, boolean, boolean, boolean, text, boolean, boolean, boolean, boolean
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_amora_care_email_delivery(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.patch_profile_atomic(
  uuid, text, text, boolean, boolean, boolean, text, boolean, boolean, boolean, boolean
) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_amora_care_email_delivery(uuid, uuid)
  TO service_role;

COMMENT ON COLUMN public.profiles.care_notifications_enabled IS
  'True only after explicit opt-in to Amora care messages in the shared chat. Every couple member must opt in.';
COMMENT ON COLUMN public.profiles.care_notifications_consented_at IS
  'Timestamp of the latest explicit shared-chat care opt-in; NULL when disabled.';
COMMENT ON COLUMN public.profiles.care_email_enabled IS
  'True only after explicit opt-in to receive the same care messages by email. Requires shared-chat care consent.';
COMMENT ON COLUMN public.profiles.care_email_consented_at IS
  'Timestamp of the latest explicit care email opt-in; NULL when disabled.';
COMMENT ON COLUMN public.profiles.care_prompt_answered_at IS
  'First time the person answered the one-time care opt-in question (either way). The lounge does not ask again.';
COMMENT ON FUNCTION public.patch_profile_atomic(
  uuid, text, text, boolean, boolean, boolean, text, boolean, boolean, boolean, boolean
) IS
  'Service-only atomic profile, shared-chat care consent, care email consent, and optional community nickname patch.';

DO $postconditions$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE care_email_enabled IS DISTINCT FROM (care_email_consented_at IS NOT NULL)
       OR (care_email_enabled AND NOT care_notifications_enabled)
  ) THEN
    RAISE EXCEPTION 'AMORA_CARE_EMAIL_CONSENT_INVARIANT_POSTCONDITION_FAILED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_care_email_consent_state_valid'
      AND contype = 'c'
      AND convalidated
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_care_email_requires_shared_consent'
      AND contype = 'c'
      AND convalidated
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.profiles'::regclass
      AND tgname = 'trg_normalize_amora_care_email_consent'
      AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.profiles'::regclass
      AND tgname = 'trg_prevent_direct_amora_care_consent_change'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'AMORA_CARE_EMAIL_CONSENT_SCHEMA_POSTCONDITION_FAILED';
  END IF;

  IF to_regprocedure(
       'public.patch_profile_atomic(uuid,text,text,boolean,boolean,boolean,text,boolean,boolean)'
     ) IS NOT NULL
     OR NOT has_function_privilege(
       'service_role',
       'public.patch_profile_atomic(uuid,text,text,boolean,boolean,boolean,text,boolean,boolean,boolean,boolean)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.patch_profile_atomic(uuid,text,text,boolean,boolean,boolean,text,boolean,boolean,boolean,boolean)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.patch_profile_atomic_pre_email_consent(uuid,text,text,boolean,boolean,boolean,text,boolean,boolean)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.claim_amora_care_email_delivery(uuid,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.claim_amora_care_email_delivery(uuid,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.claim_amora_care_email_delivery_pre_email_consent(uuid,uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'AMORA_CARE_EMAIL_CONSENT_PRIVILEGE_POSTCONDITION_FAILED';
  END IF;
END
$postconditions$;

COMMIT;
