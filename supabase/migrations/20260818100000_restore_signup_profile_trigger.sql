BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preconditions$
BEGIN
  IF pg_catalog.to_regclass('auth.users') IS NULL
     OR pg_catalog.to_regclass('public.profiles') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_attribute
       WHERE attrelid = 'auth.users'::regclass
         AND attname IN ('id', 'email', 'raw_user_meta_data')
         AND attnum > 0
         AND NOT attisdropped
       GROUP BY attrelid
       HAVING count(*) = 3
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public.profiles'::regclass
         AND attname IN (
           'id', 'name', 'email', 'onboarding_completed', 'onboarding_step',
           'created_at', 'updated_at'
         )
         AND attnum > 0
         AND NOT attisdropped
       GROUP BY attrelid
       HAVING count(*) = 7
     ) THEN
    RAISE EXCEPTION 'SIGNUP_PROFILE_TRIGGER_RESTORE_PRECONDITION_FAILED';
  END IF;
END;
$preconditions$;

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
      NULLIF(pg_catalog.split_part(COALESCE(NEW.email, ''), '@', 1), ''),
      'User'
    ),
    NEW.email,
    false,
    0,
    pg_catalog.now(),
    pg_catalog.now()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = COALESCE(EXCLUDED.email, profiles.email),
    name = COALESCE(NULLIF(EXCLUDED.name, ''), profiles.name),
    updated_at = pg_catalog.now();

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.create_profile_on_signup() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_profile_on_signup()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.create_profile_on_signup();

DO $postconditions$
DECLARE
  v_trigger_count integer;
BEGIN
  SELECT count(*)::integer
    INTO v_trigger_count
  FROM pg_catalog.pg_trigger AS trigger_record
  JOIN pg_catalog.pg_proc AS trigger_function
    ON trigger_function.oid = trigger_record.tgfoid
  JOIN pg_catalog.pg_namespace AS function_schema
    ON function_schema.oid = trigger_function.pronamespace
  WHERE trigger_record.tgrelid = 'auth.users'::regclass
    AND trigger_record.tgname = 'on_auth_user_created'
    AND trigger_record.tgenabled = 'O'
    AND NOT trigger_record.tgisinternal
    AND trigger_record.tgtype = 5
    AND function_schema.nspname = 'public'
    AND trigger_function.proname = 'create_profile_on_signup'
    AND trigger_function.prosecdef
    AND trigger_function.proconfig @> ARRAY[
      'search_path=pg_catalog, public'
    ]::text[];

  IF v_trigger_count <> 1
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc AS procedure_record
       CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
         procedure_record.proacl,
         pg_catalog.acldefault('f', procedure_record.proowner)
       )) AS privilege_record
       WHERE procedure_record.oid =
         'public.create_profile_on_signup()'::regprocedure
         AND privilege_record.grantee = 0
         AND privilege_record.privilege_type = 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon',
       'public.create_profile_on_signup()',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated',
       'public.create_profile_on_signup()',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role',
       'public.create_profile_on_signup()',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'SIGNUP_PROFILE_TRIGGER_RESTORE_POSTCONDITION_FAILED';
  END IF;
END;
$postconditions$;

COMMENT ON FUNCTION public.create_profile_on_signup() IS
  'Fail-closed Auth signup trigger function that creates exactly one public profile using a fixed search_path.';

COMMIT;
