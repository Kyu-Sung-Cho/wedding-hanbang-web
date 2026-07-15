BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- A profile row mixes ordinary UI state with identity, consent, notification,
-- admin and account-lifecycle columns. Row-level partner access therefore
-- cannot be made safe with SELECT * (or a caller-chosen column list). Retire
-- every browser/mobile table read and expose purpose-built DTO functions only.
LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE;

DROP POLICY IF EXISTS profiles_select_related ON public.profiles;
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
DROP POLICY IF EXISTS profiles_select_couple ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_related" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_couple" ON public.profiles;
DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
DROP POLICY IF EXISTS profiles_delete_own ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_delete_own" ON public.profiles;

REVOKE SELECT ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.profiles FROM PUBLIC, anon, authenticated;

-- Table and column grants are independent in PostgreSQL. Revoke any historical
-- or out-of-band column grant as well, including unexpected columns already
-- present when this migration runs.
DO $profile_column_grants$
DECLARE
  profile_column record;
BEGIN
  FOR profile_column IN
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
  LOOP
    EXECUTE format(
      'REVOKE ALL (%I) ON TABLE public.profiles FROM PUBLIC, anon, authenticated, service_role',
      profile_column.column_name
    );
  END LOOP;
END;
$profile_column_grants$;

REVOKE ALL PRIVILEGES ON TABLE public.profiles
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.can_read_profile(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_profile(uuid) TO service_role;

-- The only partner profile surface is the existing three-field public card.
-- Reassert its exact result and relationship/lifecycle checks so a stale or
-- out-of-band definition cannot silently broaden the deployed contract.
CREATE OR REPLACE FUNCTION public.get_my_partner_public()
RETURNS TABLE (
  id uuid,
  name text,
  role text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT
    partner.id,
    COALESCE(partner.name, ''),
    partner.role::text
  FROM public.profiles AS caller
  JOIN public.couples AS couple
    ON couple.id = caller.couple_id
  JOIN public.profiles AS partner
    ON partner.id = CASE
      WHEN couple.bride_id = auth.uid() THEN couple.groom_id
      WHEN couple.groom_id = auth.uid() THEN couple.bride_id
      ELSE NULL
    END
  WHERE caller.id = auth.uid()
    AND caller.account_deleting_at IS NULL
    AND caller.amora_membership_resetting_at IS NULL
    AND couple.amora_shared_resetting_at IS NULL
    AND partner.couple_id = couple.id
    AND partner.id <> caller.id
    AND partner.account_deleting_at IS NULL
    AND partner.amora_membership_resetting_at IS NULL
    AND (
      (
        caller.role::text = 'bride'
        AND couple.bride_id = caller.id
        AND partner.role::text = 'groom'
      )
      OR (
        caller.role::text = 'groom'
        AND couple.groom_id = caller.id
        AND partner.role::text = 'bride'
      )
    )
  LIMIT 1;
$function$;
ALTER FUNCTION public.get_my_partner_public() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_my_partner_public() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_partner_public() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_my_profile_safe()
RETURNS TABLE (
  id uuid,
  name text,
  role text,
  couple_id uuid,
  onboarding_completed boolean,
  onboarding_step integer,
  has_phone boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT
    profile.id,
    COALESCE(profile.name, ''),
    profile.role::text,
    profile.couple_id,
    COALESCE(profile.onboarding_completed, false),
    COALESCE(profile.onboarding_step, 0),
    profile.phone IS NOT NULL
  FROM public.profiles AS profile
  WHERE profile.id = auth.uid()
    AND profile.account_deleting_at IS NULL
    AND profile.amora_membership_resetting_at IS NULL
  LIMIT 1;
$function$;
ALTER FUNCTION public.get_my_profile_safe() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_my_profile_safe() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_profile_safe() TO authenticated, service_role;

-- Chat clear timestamps are intentionally kept out of the general profile DTO.
-- They are exposed only to their owner for message-view filtering.
CREATE OR REPLACE FUNCTION public.get_my_chat_view_state()
RETURNS TABLE (
  shared_cleared_at timestamptz,
  private_cleared_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT
    profile.shared_chat_cleared_at,
    profile.private_chat_cleared_at
  FROM public.profiles AS profile
  WHERE profile.id = auth.uid()
    AND profile.account_deleting_at IS NULL
    AND profile.amora_membership_resetting_at IS NULL
  LIMIT 1;
$function$;
ALTER FUNCTION public.get_my_chat_view_state() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_my_chat_view_state() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_chat_view_state() TO authenticated, service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO service_role;

-- Fail the migration if any client-readable table/column grant or SELECT policy
-- survived. This prevents a partially applied ACL from being mistaken for safe.
DO $profile_acl_assertions$
DECLARE
  actual_service_privileges text[];
BEGIN
  SELECT COALESCE(
    pg_catalog.array_agg(
      privilege_row.privilege_type::text
      ORDER BY privilege_row.privilege_type::text
    ),
    ARRAY[]::text[]
  )
  INTO actual_service_privileges
  FROM pg_catalog.pg_class AS relation
  CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl)
    AS privilege_row
  JOIN pg_catalog.pg_roles AS granted_role
    ON granted_role.oid = privilege_row.grantee
  WHERE relation.oid = 'public.profiles'::pg_catalog.regclass
    AND granted_role.rolname = 'service_role';

  IF actual_service_privileges IS DISTINCT FROM
       ARRAY['INSERT', 'SELECT', 'UPDATE']::text[]
     OR has_table_privilege(
       'anon',
       'public.profiles',
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
     )
     OR has_table_privilege(
       'authenticated',
       'public.profiles',
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
     )
     OR has_table_privilege('anon', 'public.profiles', 'SELECT')
     OR has_table_privilege('authenticated', 'public.profiles', 'SELECT')
     OR has_table_privilege('anon', 'public.profiles', 'INSERT')
     OR has_table_privilege('authenticated', 'public.profiles', 'INSERT')
     OR has_table_privilege('anon', 'public.profiles', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.profiles', 'UPDATE')
     OR has_table_privilege('anon', 'public.profiles', 'DELETE')
     OR has_table_privilege('authenticated', 'public.profiles', 'DELETE')
     OR has_any_column_privilege('anon', 'public.profiles', 'SELECT')
     OR has_any_column_privilege('authenticated', 'public.profiles', 'SELECT')
     OR has_any_column_privilege('anon', 'public.profiles', 'INSERT')
     OR has_any_column_privilege('authenticated', 'public.profiles', 'INSERT')
     OR has_any_column_privilege('anon', 'public.profiles', 'UPDATE')
     OR has_any_column_privilege('authenticated', 'public.profiles', 'UPDATE')
     OR EXISTS (
       SELECT 1
       FROM information_schema.column_privileges
       WHERE table_schema = 'public'
         AND table_name = 'profiles'
         AND grantee IN ('anon', 'authenticated', 'PUBLIC')
         AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE')
     )
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'profiles'
         AND cmd IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALL')
         AND ('authenticated' = ANY(roles) OR 'public' = ANY(roles))
     )
     OR has_function_privilege(
       'authenticated', 'public.can_read_profile(uuid)', 'EXECUTE'
     )
     OR has_function_privilege(
       'anon', 'public.get_my_profile_safe()', 'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated', 'public.get_my_profile_safe()', 'EXECUTE'
     )
     OR has_function_privilege(
       'anon', 'public.get_my_partner_public()', 'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated', 'public.get_my_partner_public()', 'EXECUTE'
     )
     OR has_function_privilege(
       'anon', 'public.get_my_chat_view_state()', 'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated', 'public.get_my_chat_view_state()', 'EXECUTE'
     )
     OR NOT has_table_privilege(
       'service_role', 'public.profiles', 'SELECT'
     )
     OR NOT has_table_privilege(
       'service_role', 'public.profiles', 'INSERT'
     )
     OR NOT has_table_privilege(
       'service_role', 'public.profiles', 'UPDATE'
     )
     OR has_table_privilege(
       'service_role',
       'public.profiles',
       'DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
     )
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_class AS relation
       CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl)
         AS privilege_row
       JOIN pg_catalog.pg_roles AS granted_role
         ON granted_role.oid = privilege_row.grantee
       JOIN pg_catalog.pg_roles AS grantor_role
         ON grantor_role.oid = privilege_row.grantor
       WHERE relation.oid = 'public.profiles'::pg_catalog.regclass
         AND granted_role.rolname = 'service_role'
         AND (
           privilege_row.is_grantable
           OR grantor_role.rolname <> 'postgres'
         )
     )
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_class AS relation
       CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl)
         AS privilege_row
       WHERE relation.oid = 'public.profiles'::pg_catalog.regclass
         AND privilege_row.grantee = 0
     )
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_attribute AS attribute_row
       CROSS JOIN LATERAL pg_catalog.aclexplode(attribute_row.attacl)
         AS privilege_row
       LEFT JOIN pg_catalog.pg_roles AS granted_role
         ON granted_role.oid = privilege_row.grantee
       WHERE attribute_row.attrelid = 'public.profiles'::pg_catalog.regclass
         AND attribute_row.attnum > 0
         AND NOT attribute_row.attisdropped
         AND (
           granted_role.rolname = 'service_role'
           OR privilege_row.grantee = 0
         )
     ) THEN
    RAISE EXCEPTION 'PROFILES_CLIENT_TABLE_ACL_CONTRACT_MISMATCH';
  END IF;
END;
$profile_acl_assertions$;

COMMIT;
