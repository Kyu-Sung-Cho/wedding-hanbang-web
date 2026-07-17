-- SAFE PHASE-2 FAIL-CLOSED ROLLBACK TO ZERO STORAGE POLICIES.
-- This removes the final chat write and leaves both mutation and broad public
-- reads disabled. It never restores any legacy policy. Reproduce through
-- Dashboard > Storage > Policies; do not run through migrations or SQL Editor.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $storage_final_safe_rollback_precondition$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'storage' AND relation.relname = 'objects'
      AND relation.relkind = 'r' AND relation.relrowsecurity
      AND NOT relation.relforcerowsecurity
      AND pg_catalog.pg_get_userbyid(relation.relowner) = 'supabase_storage_admin'
  ) OR pg_catalog.to_regprocedure('extensions.digest(text,text)') IS NULL THEN
    RAISE EXCEPTION 'STORAGE_FINAL_SAFE_ROLLBACK_RELATION_INVALID';
  END IF;

  IF EXISTS (
    WITH actual AS (
      SELECT policyname::text, permissive::text, roles, cmd::text,
        pg_catalog.encode(extensions.digest(lower(pg_catalog.regexp_replace(
          COALESCE(qual, '') || E'\n' || COALESCE(with_check, ''),
          E'\\s+', '', 'g')), 'sha256'), 'hex') AS expression_sha256
      FROM pg_catalog.pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
    )
    SELECT 1 FROM actual
    WHERE NOT (
      (
        actual.policyname = 'Anyone can view chat image'
        AND actual.permissive = 'PERMISSIVE'
        AND actual.roles = ARRAY['public']::name[]
        AND actual.cmd = 'SELECT'
        AND actual.expression_sha256 = '11a6595c0534cd28fc75eace428725eb971ed106208189913fc328fafe4fed23'
      ) OR (
        actual.policyname = 'Anyone can view chat images'
        AND actual.permissive = 'PERMISSIVE'
        AND actual.roles = ARRAY['public']::name[]
        AND actual.cmd = 'SELECT'
        AND actual.expression_sha256 = '3e004f601bc171c755a6dad45c4abac266024ae16b050ac53005dee54c0a3ddb'
      ) OR (
        actual.policyname = '공개: 업체 이미지 조회'
        AND actual.permissive = 'PERMISSIVE'
        AND actual.roles = ARRAY['public']::name[]
        AND actual.cmd = 'SELECT'
        AND actual.expression_sha256 = '58225493db8405746e0170ff05141dfc86d73e4445ece3fbe33473420e0d8033'
      ) OR (
        actual.policyname = '서비스: 사업자등록증 조회'
        AND actual.permissive = 'PERMISSIVE'
        AND actual.roles = ARRAY['public']::name[]
        AND actual.cmd = 'SELECT'
        AND actual.expression_sha256 = '1beeec48bf3997f33f65db1f2076e1efab8d014d5fb0d1df59e1f3b7a4afe177'
      ) OR (
        -- Dashboard policy-name suffixes are non-security metadata.
        actual.permissive = 'PERMISSIVE'
        AND actual.roles = ARRAY['authenticated']::name[]
        AND actual.cmd = 'INSERT'
        AND actual.expression_sha256 = '7b9e967897a69bdc226f09e02a240db1ca64f0caeb58244912445ff0f5032482'
      )
    )
  ) THEN
    RAISE EXCEPTION 'STORAGE_FINAL_SAFE_ROLLBACK_UNKNOWN_POLICY';
  END IF;
END;
$storage_final_safe_rollback_precondition$;

-- The precondition proved every extant policy is reviewed. Drop by its quoted
-- catalog name so a regenerated Dashboard suffix cannot strand a write policy.
DO $storage_final_safe_rollback_drop_reviewed_policies$
DECLARE
  reviewed_policy_name text;
BEGIN
  FOR reviewed_policy_name IN
    SELECT policyname::text
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY %I ON storage.objects', reviewed_policy_name
    );
  END LOOP;
END;
$storage_final_safe_rollback_drop_reviewed_policies$;

DO $storage_final_safe_rollback_postcondition$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
  ) THEN
    RAISE EXCEPTION 'STORAGE_FINAL_SAFE_ROLLBACK_FAILED_CLOSED';
  END IF;
END;
$storage_final_safe_rollback_postcondition$;

COMMIT;
