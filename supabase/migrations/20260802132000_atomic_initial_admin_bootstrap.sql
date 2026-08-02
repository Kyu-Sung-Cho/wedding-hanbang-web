-- Make the exceptional first-admin bootstrap a single atomic database claim.
-- Application configuration still has to opt into the production flow; this
-- function closes the remaining concurrent-request race after Auth user
-- creation and refuses every non-service caller.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $initial_admin_bootstrap_preflight$
DECLARE
  missing_column text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    RAISE EXCEPTION 'INITIAL_ADMIN_BOOTSTRAP_ROLE_MISSING'
      USING ERRCODE = '55000';
  END IF;
  IF pg_catalog.to_regclass('auth.users') IS NULL
     OR pg_catalog.to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'INITIAL_ADMIN_BOOTSTRAP_TABLE_MISSING'
      USING ERRCODE = '55000';
  END IF;

  SELECT required.column_name
  INTO missing_column
  FROM (VALUES
    ('id'),
    ('name'),
    ('email'),
    ('onboarding_completed'),
    ('onboarding_step'),
    ('is_admin'),
    ('updated_at')
  ) AS required(column_name)
  LEFT JOIN information_schema.columns AS existing
    ON existing.table_schema = 'public'
   AND existing.table_name = 'profiles'
   AND existing.column_name = required.column_name
  WHERE existing.column_name IS NULL
  LIMIT 1;

  IF missing_column IS NOT NULL THEN
    RAISE EXCEPTION 'INITIAL_ADMIN_BOOTSTRAP_COLUMN_MISSING: %', missing_column
      USING ERRCODE = '55000';
  END IF;
END;
$initial_admin_bootstrap_preflight$;

CREATE OR REPLACE FUNCTION public.bootstrap_initial_admin_profile(
  p_user_id uuid,
  p_name text,
  p_email text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL
     OR p_name IS NULL
     OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 60
     OR p_email IS NULL
     OR octet_length(p_email) NOT BETWEEN 3 AND 320
     OR p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'invalid_initial_admin_profile' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hanbang:initial-admin-bootstrap', 0)
  );

  IF EXISTS (SELECT 1 FROM public.profiles WHERE is_admin = true) THEN
    RAISE EXCEPTION 'initial_admin_already_exists' USING ERRCODE = '23505';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'initial_admin_auth_user_missing' USING ERRCODE = '23503';
  END IF;

  INSERT INTO public.profiles (
    id,
    name,
    email,
    onboarding_completed,
    onboarding_step,
    is_admin,
    updated_at
  ) VALUES (
    p_user_id,
    btrim(p_name),
    lower(btrim(p_email)),
    true,
    5,
    true,
    clock_timestamp()
  )
  ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      email = EXCLUDED.email,
      onboarding_completed = true,
      onboarding_step = 5,
      is_admin = true,
      updated_at = clock_timestamp();

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.bootstrap_initial_admin_profile(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bootstrap_initial_admin_profile(uuid, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_initial_admin_profile(uuid, text, text) TO service_role;

COMMENT ON FUNCTION public.bootstrap_initial_admin_profile(uuid, text, text) IS
  'Atomically claims the exceptional first administrator after a matching Auth user exists.';

COMMIT;
