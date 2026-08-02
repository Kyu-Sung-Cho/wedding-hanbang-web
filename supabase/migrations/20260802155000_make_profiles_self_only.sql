-- Keep sensitive profile rows private to their authenticated owner. Partner
-- identity is intentionally exposed only through couple_profile_directory's
-- four-field projection; profiles also contains email, phone, admin state, and
-- sensitive mobile push delivery identifiers.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- PUBLIC/anon should never reach even the owner's row. Clear both table-level
-- and historical column-level grants before tightening the policies.
REVOKE SELECT ON TABLE public.profiles FROM PUBLIC, anon;
DO $revoke_public_profile_read_columns$
DECLARE
  all_columns text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
  INTO all_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'profiles';

  IF all_columns IS NULL THEN
    RAISE EXCEPTION 'PROFILES_TABLE_MISSING' USING ERRCODE = '55000';
  END IF;

  EXECUTE format(
    'REVOKE SELECT (%s) ON TABLE public.profiles FROM PUBLIC, anon',
    all_columns
  );
END;
$revoke_public_profile_read_columns$;

DROP POLICY IF EXISTS profiles_select_related ON public.profiles;
DROP POLICY IF EXISTS profiles_select_self ON public.profiles;
DROP POLICY IF EXISTS profiles_select_safe_related ON public.profiles;
DROP POLICY IF EXISTS profiles_select_couple ON public.profiles;
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;

CREATE POLICY profiles_select_self ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid());

-- This owner-controlled, security-barrier view is the sole partner directory.
-- Recreate it to pin the public contract even if an older environment drifted.
CREATE OR REPLACE VIEW public.couple_profile_directory
WITH (security_barrier = true, security_invoker = false)
AS
SELECT profile.id, profile.name, profile.role, profile.couple_id
FROM public.profiles AS profile
WHERE public.is_couple_member(profile.couple_id);

ALTER VIEW public.couple_profile_directory OWNER TO postgres;
REVOKE ALL ON TABLE public.couple_profile_directory
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE SELECT (id, name, role, couple_id)
  ON TABLE public.couple_profile_directory
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT (id, name, role, couple_id)
  ON TABLE public.couple_profile_directory
  TO authenticated;

DO $profiles_read_fence_postcondition$
DECLARE
  unexpected_column text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'profiles_select_self'
      AND cmd = 'SELECT'
      AND roles = ARRAY['authenticated'::name]
      AND regexp_replace(qual, '[()[:space:]]', '', 'g') = 'id=auth.uid'
  ) THEN
    RAISE EXCEPTION 'PROFILES_SELF_READ_POLICY_MISSING'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND cmd = 'SELECT'
      AND (
        'public' = ANY (roles)
        OR 'authenticated' = ANY (roles)
      )
      AND policyname <> 'profiles_select_self'
  ) THEN
    RAISE EXCEPTION 'PROFILES_RELATED_READ_POLICY_REMAINS'
      USING ERRCODE = '55000';
  END IF;

  IF has_table_privilege('anon', 'public.profiles', 'SELECT')
     OR has_any_column_privilege('anon', 'public.profiles', 'SELECT') THEN
    RAISE EXCEPTION 'PROFILES_ANON_READ_PRIVILEGE_REMAINS'
      USING ERRCODE = '55000';
  END IF;

  IF has_table_privilege(
       'authenticated',
       'public.couple_profile_directory',
       'SELECT'
     ) THEN
    RAISE EXCEPTION 'COUPLE_PROFILE_DIRECTORY_BROAD_TABLE_GRANT'
      USING ERRCODE = '55000';
  END IF;

  IF has_any_column_privilege(
       'anon',
       'public.couple_profile_directory',
       'SELECT'
     ) OR has_any_column_privilege(
       'service_role',
       'public.couple_profile_directory',
       'SELECT'
     ) THEN
    RAISE EXCEPTION 'COUPLE_PROFILE_DIRECTORY_UNEXPECTED_READER'
      USING ERRCODE = '55000';
  END IF;

  IF NOT (
    has_column_privilege(
      'authenticated', 'public.couple_profile_directory', 'id', 'SELECT'
    )
    AND has_column_privilege(
      'authenticated', 'public.couple_profile_directory', 'name', 'SELECT'
    )
    AND has_column_privilege(
      'authenticated', 'public.couple_profile_directory', 'role', 'SELECT'
    )
    AND has_column_privilege(
      'authenticated', 'public.couple_profile_directory', 'couple_id', 'SELECT'
    )
  ) THEN
    RAISE EXCEPTION 'COUPLE_PROFILE_DIRECTORY_AUTHENTICATED_GRANT_MISSING'
      USING ERRCODE = '55000';
  END IF;

  SELECT column_name
  INTO unexpected_column
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'couple_profile_directory'
    AND column_name NOT IN ('id', 'name', 'role', 'couple_id')
  ORDER BY ordinal_position
  LIMIT 1;

  IF unexpected_column IS NOT NULL THEN
    RAISE EXCEPTION 'COUPLE_PROFILE_DIRECTORY_UNSAFE_COLUMN: %', unexpected_column
      USING ERRCODE = '55000';
  END IF;

  IF (
    SELECT array_agg(column_name::text ORDER BY ordinal_position)
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'couple_profile_directory'
  ) IS DISTINCT FROM ARRAY['id', 'name', 'role', 'couple_id']::text[] THEN
    RAISE EXCEPTION 'COUPLE_PROFILE_DIRECTORY_PROJECTION_DRIFT'
      USING ERRCODE = '55000';
  END IF;
END;
$profiles_read_fence_postcondition$;

COMMIT;
