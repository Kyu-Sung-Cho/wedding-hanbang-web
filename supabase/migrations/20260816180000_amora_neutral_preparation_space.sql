SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $preconditions$
BEGIN
  IF pg_catalog.to_regclass('public.couples') IS NULL
     OR pg_catalog.to_regclass('public.profiles') IS NULL
     OR pg_catalog.to_regprocedure(
       'public.create_couple_for_current_user(text)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.join_couple_server(uuid,text,text)'
     ) IS NULL THEN
    RAISE EXCEPTION 'AMORA_NEUTRAL_PREPARATION_SPACE_PRECONDITION_FAILED';
  END IF;
END
$preconditions$;

ALTER TABLE public.couples
  ADD COLUMN IF NOT EXISTS member_model_version smallint NOT NULL DEFAULT 1;

DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.couples'::regclass
      AND conname = 'couples_member_model_version_check'
  ) THEN
    ALTER TABLE public.couples
      ADD CONSTRAINT couples_member_model_version_check
      CHECK (member_model_version IN (1, 2)) NOT VALID;
  END IF;
END
$constraint$;

ALTER TABLE public.couples
  VALIDATE CONSTRAINT couples_member_model_version_check;

CREATE OR REPLACE FUNCTION public.enforce_couple_member_model_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_upgrade_allowed boolean :=
    COALESCE(current_setting('hanbang.allow_member_model_upgrade', true), '') = 'on';
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.member_model_version <> 1 AND NOT v_upgrade_allowed THEN
      RAISE EXCEPTION 'COUPLE_MEMBER_MODEL_VERSION_WRITE_FORBIDDEN'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.member_model_version IS NOT DISTINCT FROM OLD.member_model_version THEN
    RETURN NEW;
  END IF;

  IF NOT (
    v_upgrade_allowed
    AND OLD.member_model_version = 1
    AND NEW.member_model_version = 2
    AND OLD.membership_sealed_at IS NULL
    AND ((OLD.bride_id IS NOT NULL)::integer + (OLD.groom_id IS NOT NULL)::integer) = 1
    AND NEW.bride_id IS NOT DISTINCT FROM OLD.bride_id
    AND NEW.groom_id IS NOT DISTINCT FROM OLD.groom_id
  ) THEN
    RAISE EXCEPTION 'COUPLE_MEMBER_MODEL_VERSION_WRITE_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$function$;

ALTER FUNCTION public.enforce_couple_member_model_version() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enforce_couple_member_model_version()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_enforce_couple_member_model_version ON public.couples;
CREATE TRIGGER trg_enforce_couple_member_model_version
  BEFORE INSERT OR UPDATE OF member_model_version ON public.couples
  FOR EACH ROW EXECUTE FUNCTION public.enforce_couple_member_model_version();

CREATE OR REPLACE FUNCTION public.create_neutral_preparation_space_for_current_user()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_actor_user_id uuid := auth.uid();
  v_profile_couple_id uuid;
  v_profile_role text;
  v_internal_role text;
  v_couple public.couples%ROWTYPE;
  v_result jsonb;
  v_result_couple_id uuid;
  v_updated_rows integer;
BEGIN
  IF v_actor_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'created', false,
      'idempotent', false,
      'error_code', 'AUTH_REQUIRED',
      'error', 'Unauthenticated.'
    );
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'hanbang:couple-membership:' || v_actor_user_id::text,
      0
    )
  );

  SELECT profile.couple_id, profile.role
    INTO v_profile_couple_id, v_profile_role
  FROM public.profiles AS profile
  WHERE profile.id = v_actor_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'created', false,
      'idempotent', false,
      'error_code', 'PROFILE_NOT_FOUND',
      'error', 'Profile not found.'
    );
  END IF;

  IF v_profile_couple_id IS NOT NULL THEN
    SELECT couple.*
      INTO v_couple
    FROM public.couples AS couple
    WHERE couple.id = v_profile_couple_id
    FOR UPDATE;

    IF NOT FOUND
       OR v_couple.member_model_version <> 2
       OR v_profile_role NOT IN ('bride', 'groom')
       OR NOT (
         (v_profile_role = 'bride'
          AND v_couple.bride_id = v_actor_user_id
          AND v_couple.groom_id IS NULL)
         OR
         (v_profile_role = 'groom'
          AND v_couple.groom_id = v_actor_user_id
          AND v_couple.bride_id IS NULL)
       ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'created', false,
        'idempotent', false,
        'error_code', 'ALREADY_LINKED',
        'error', 'This account is already linked.'
      );
    END IF;

    v_result := public.create_couple_for_current_user(v_profile_role);
    IF COALESCE(v_result ->> 'success', 'false') <> 'true'
       OR COALESCE(v_result ->> 'idempotent', 'false') <> 'true'
       OR NULLIF(v_result ->> 'couple_id', '')::uuid IS DISTINCT FROM v_couple.id THEN
      RAISE EXCEPTION 'NEUTRAL_PREPARATION_SPACE_REPLAY_INVALID'
        USING ERRCODE = '55000';
    END IF;

    RETURN (v_result - 'role') || jsonb_build_object('member_model_version', 2);
  END IF;

  IF v_profile_role IS NULL THEN
    v_internal_role := 'bride';
  ELSIF v_profile_role IN ('bride', 'groom') THEN
    v_internal_role := v_profile_role;
  ELSE
    RETURN jsonb_build_object(
      'success', false,
      'created', false,
      'idempotent', false,
      'error_code', 'MEMBERSHIP_INCONSISTENT',
      'error', 'Account membership is inconsistent.'
    );
  END IF;

  v_result := public.create_couple_for_current_user(v_internal_role);
  IF COALESCE(v_result ->> 'success', 'false') <> 'true'
     OR COALESCE(v_result ->> 'created', 'false') <> 'true'
     OR COALESCE(v_result ->> 'idempotent', 'false') <> 'false' THEN
    RETURN v_result - 'role';
  END IF;

  v_result_couple_id := NULLIF(v_result ->> 'couple_id', '')::uuid;
  IF v_result_couple_id IS NULL THEN
    RAISE EXCEPTION 'NEUTRAL_PREPARATION_SPACE_RESULT_INVALID'
      USING ERRCODE = '55000';
  END IF;

  PERFORM pg_catalog.set_config('hanbang.allow_member_model_upgrade', 'on', true);
  UPDATE public.couples AS couple
  SET member_model_version = 2,
      updated_at = clock_timestamp()
  WHERE couple.id = v_result_couple_id
    AND couple.member_model_version = 1
    AND couple.membership_sealed_at IS NULL
    AND (
      (v_internal_role = 'bride'
       AND couple.bride_id = v_actor_user_id
       AND couple.groom_id IS NULL)
      OR
      (v_internal_role = 'groom'
       AND couple.groom_id = v_actor_user_id
       AND couple.bride_id IS NULL)
    );

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
  IF v_updated_rows <> 1 THEN
    RAISE EXCEPTION 'NEUTRAL_PREPARATION_SPACE_UPGRADE_FAILED'
      USING ERRCODE = '40001';
  END IF;

  RETURN (v_result - 'role') || jsonb_build_object('member_model_version', 2);
END
$function$;

ALTER FUNCTION public.create_neutral_preparation_space_for_current_user()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_neutral_preparation_space_for_current_user()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_neutral_preparation_space_for_current_user()
  TO authenticated;

CREATE OR REPLACE FUNCTION public.join_neutral_preparation_space_server(
  p_actor_user_id uuid,
  p_invite_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_code text := upper(btrim(COALESCE(p_invite_code, '')));
  v_profile_couple_id uuid;
  v_profile_role text;
  v_internal_role text;
  v_target_couple_id uuid;
  v_bride_id uuid;
  v_groom_id uuid;
  v_member_model_version smallint;
  v_membership_sealed_at timestamptz;
  v_result jsonb;
  v_result_couple_id uuid;
  v_post_profile_couple_id uuid;
  v_post_profile_role text;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'joined', false,
      'idempotent', false,
      'error_code', 'AUTH_REQUIRED',
      'error', 'Unauthenticated.'
    );
  END IF;

  IF v_code !~ '^WH-[A-Z0-9]{12}$' THEN
    RETURN jsonb_build_object(
      'success', false,
      'joined', false,
      'idempotent', false,
      'error_code', 'INVALID_INVITE_CODE',
      'error', 'Invalid invite code.'
    );
  END IF;

  SELECT profile.couple_id, profile.role
    INTO v_profile_couple_id, v_profile_role
  FROM public.profiles AS profile
  WHERE profile.id = p_actor_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'joined', false,
      'idempotent', false,
      'error_code', 'PROFILE_NOT_FOUND',
      'error', 'Profile not found.'
    );
  END IF;

  IF v_profile_couple_id IS NOT NULL THEN
    SELECT couple.id, couple.bride_id, couple.groom_id,
           couple.member_model_version, couple.membership_sealed_at
      INTO v_target_couple_id, v_bride_id, v_groom_id,
           v_member_model_version, v_membership_sealed_at
    FROM public.couples AS couple
    WHERE couple.id = v_profile_couple_id;

    IF NOT FOUND
       OR v_member_model_version <> 2
       OR v_profile_role NOT IN ('bride', 'groom')
       OR NOT (
         (v_profile_role = 'bride' AND v_bride_id = p_actor_user_id)
         OR (v_profile_role = 'groom' AND v_groom_id = p_actor_user_id)
       ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'joined', false,
        'idempotent', false,
        'error_code', 'ALREADY_LINKED',
        'error', 'This account is already linked.'
      );
    END IF;
    v_internal_role := v_profile_role;
  ELSE
    SELECT couple.id, couple.bride_id, couple.groom_id,
           couple.member_model_version, couple.membership_sealed_at
      INTO v_target_couple_id, v_bride_id, v_groom_id,
           v_member_model_version, v_membership_sealed_at
    FROM public.couples AS couple
    WHERE couple.invite_code = v_code
      AND couple.member_model_version = 2;

    IF NOT FOUND
       OR v_membership_sealed_at IS NOT NULL
       OR ((v_bride_id IS NOT NULL)::integer + (v_groom_id IS NOT NULL)::integer) <> 1 THEN
      RETURN jsonb_build_object(
        'success', false,
        'joined', false,
        'idempotent', false,
        'error_code', 'INVALID_INVITE_CODE',
        'error', 'Invalid invite code.'
      );
    END IF;

    v_internal_role := CASE
      WHEN v_bride_id IS NULL THEN 'bride'
      ELSE 'groom'
    END;
  END IF;

  v_result := public.join_couple_server(
    p_actor_user_id,
    v_code,
    v_internal_role
  );

  IF COALESCE(v_result ->> 'success', 'false') <> 'true' THEN
    RETURN v_result - 'role';
  END IF;

  v_result_couple_id := NULLIF(v_result ->> 'couple_id', '')::uuid;
  SELECT profile.couple_id, profile.role,
         couple.bride_id, couple.groom_id, couple.member_model_version
    INTO v_post_profile_couple_id, v_post_profile_role,
         v_bride_id, v_groom_id, v_member_model_version
  FROM public.profiles AS profile
  JOIN public.couples AS couple ON couple.id = profile.couple_id
  WHERE profile.id = p_actor_user_id;

  IF NOT FOUND
     OR v_result_couple_id IS NULL
     OR v_post_profile_couple_id IS DISTINCT FROM v_result_couple_id
     OR v_result_couple_id IS DISTINCT FROM v_target_couple_id
     OR v_member_model_version <> 2
     OR v_post_profile_role IS DISTINCT FROM v_internal_role
     OR NOT (
       (v_internal_role = 'bride' AND v_bride_id = p_actor_user_id)
       OR (v_internal_role = 'groom' AND v_groom_id = p_actor_user_id)
     ) THEN
    RAISE EXCEPTION 'NEUTRAL_PREPARATION_SPACE_JOIN_RESULT_INVALID'
      USING ERRCODE = '55000';
  END IF;

  RETURN (v_result - 'role') || jsonb_build_object('member_model_version', 2);
END
$function$;

ALTER FUNCTION public.join_neutral_preparation_space_server(uuid, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.join_neutral_preparation_space_server(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.join_neutral_preparation_space_server(uuid, text)
  TO service_role;

DO $postconditions$
BEGIN
  IF pg_catalog.to_regprocedure(
       'public.create_neutral_preparation_space_for_current_user()'
     ) IS NULL
     OR NOT pg_catalog.has_function_privilege(
       'authenticated',
       'public.create_neutral_preparation_space_for_current_user()',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon',
       'public.create_neutral_preparation_space_for_current_user()',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role',
       'public.create_neutral_preparation_space_for_current_user()',
       'EXECUTE'
     )
     OR pg_catalog.to_regprocedure(
       'public.join_neutral_preparation_space_server(uuid,text)'
     ) IS NULL
     OR NOT pg_catalog.has_function_privilege(
       'service_role',
       'public.join_neutral_preparation_space_server(uuid,text)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated',
       'public.join_neutral_preparation_space_server(uuid,text)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon',
       'public.join_neutral_preparation_space_server(uuid,text)',
       'EXECUTE'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_trigger
       WHERE tgrelid = 'public.couples'::regclass
         AND tgname = 'trg_enforce_couple_member_model_version'
         AND tgenabled = 'O'
         AND NOT tgisinternal
     ) THEN
    RAISE EXCEPTION 'AMORA_NEUTRAL_PREPARATION_SPACE_POSTCONDITION_FAILED';
  END IF;
END
$postconditions$;
