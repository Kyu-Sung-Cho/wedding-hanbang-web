-- EXPAND PHASE: make Auth signup create exactly one profile under every caller
-- search_path. The legacy trigger function used an unqualified `profiles`
-- reference and swallowed failures. Auth sessions whose search_path excluded
-- public therefore created ownerless Auth users without application profiles.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $precondition$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger AS trigger_record
    WHERE trigger_record.tgrelid = 'auth.users'::regclass
      AND trigger_record.tgname = 'on_auth_user_created'
      AND trigger_record.tgenabled <> 'D'
      AND NOT trigger_record.tgisinternal
  ) THEN
    RAISE EXCEPTION 'SIGNUP_PROFILE_TRIGGER_MISSING';
  END IF;
END;
$precondition$;

CREATE OR REPLACE FUNCTION public.create_profile_on_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  INSERT INTO public.profiles (
    id,
    name,
    email,
    onboarding_completed,
    onboarding_step,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(NEW.raw_user_meta_data->>'name', ''),
      NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
      NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
      'User'
    ),
    NEW.email,
    false,
    0,
    now(),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = COALESCE(EXCLUDED.email, profiles.email),
    name = COALESCE(NULLIF(EXCLUDED.name, ''), profiles.name),
    updated_at = now();

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.create_profile_on_signup() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_profile_on_signup()
  FROM PUBLIC, anon, authenticated, service_role;

DO $assertions$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger AS trigger_record
    JOIN pg_proc AS trigger_function
      ON trigger_function.oid = trigger_record.tgfoid
    JOIN pg_namespace AS function_schema
      ON function_schema.oid = trigger_function.pronamespace
    WHERE trigger_record.tgrelid = 'auth.users'::regclass
      AND trigger_record.tgname = 'on_auth_user_created'
      AND trigger_record.tgenabled <> 'D'
      AND NOT trigger_record.tgisinternal
      AND function_schema.nspname = 'public'
      AND trigger_function.proname = 'create_profile_on_signup'
      AND trigger_function.prosecdef
      AND trigger_function.proconfig @> ARRAY['search_path=pg_catalog, public']::text[]
  ) THEN
    RAISE EXCEPTION 'SIGNUP_PROFILE_TRIGGER_NOT_HARDENED';
  END IF;
END;
$assertions$;

COMMENT ON FUNCTION public.create_profile_on_signup() IS
  'Fail-closed Auth signup trigger that creates exactly one public profile using a fixed search_path.';
