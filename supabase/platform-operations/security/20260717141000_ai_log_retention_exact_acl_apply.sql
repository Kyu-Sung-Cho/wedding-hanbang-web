BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $precondition$
DECLARE
  procedure_record pg_proc%ROWTYPE;
BEGIN
  SELECT * INTO procedure_record
  FROM pg_proc
  WHERE oid = to_regprocedure('public.redact_old_ai_interactions(interval)');

  IF current_user <> 'postgres'
     OR session_user <> 'postgres'
     OR NOT FOUND
     OR NOT procedure_record.prosecdef
     OR pg_get_userbyid(procedure_record.proowner) <> 'postgres'
     OR to_regrole('service_role') IS NULL
     OR NOT has_function_privilege(
       'service_role', procedure_record.oid, 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'AI_LOG_RETENTION_EXACT_ACL_PRECONDITION_FAILED';
  END IF;
END
$precondition$;

-- CREATE OR REPLACE preserves old ACLs. Remove every explicit non-owner grant,
-- including project-specific roles and grants derived from their grant option.
REVOKE ALL PRIVILEGES ON FUNCTION public.redact_old_ai_interactions(interval)
  FROM PUBLIC;
DO $revoke_unreviewed_execute_grants$
DECLARE
  grant_record record;
BEGIN
  FOR grant_record IN
    SELECT DISTINCT pg_get_userbyid(acl_entry.grantee) AS role_name
    FROM pg_proc AS procedure_record
    CROSS JOIN LATERAL aclexplode(COALESCE(
      procedure_record.proacl,
      acldefault('f', procedure_record.proowner)
    )) AS acl_entry
    WHERE procedure_record.oid =
      'public.redact_old_ai_interactions(interval)'::regprocedure
      AND acl_entry.privilege_type = 'EXECUTE'
      AND acl_entry.grantee <> 0
      AND acl_entry.grantee <> procedure_record.proowner
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON FUNCTION public.redact_old_ai_interactions(interval) FROM %I CASCADE',
      grant_record.role_name
    );
  END LOOP;
END
$revoke_unreviewed_execute_grants$;

GRANT EXECUTE ON FUNCTION public.redact_old_ai_interactions(interval)
  TO service_role;

DO $postcondition$
DECLARE
  procedure_record pg_proc%ROWTYPE;
BEGIN
  SELECT * INTO STRICT procedure_record
  FROM pg_proc
  WHERE oid = 'public.redact_old_ai_interactions(interval)'::regprocedure;

  IF (
    SELECT array_agg(
      DISTINCT pg_get_userbyid(acl_entry.grantee)
      ORDER BY pg_get_userbyid(acl_entry.grantee)
    )
    FROM aclexplode(COALESCE(
      procedure_record.proacl,
      acldefault('f', procedure_record.proowner)
    )) AS acl_entry
    WHERE acl_entry.privilege_type = 'EXECUTE'
  ) IS DISTINCT FROM ARRAY['postgres', 'service_role']::name[]
  OR EXISTS (
    SELECT 1
    FROM aclexplode(COALESCE(
      procedure_record.proacl,
      acldefault('f', procedure_record.proowner)
    )) AS acl_entry
    WHERE acl_entry.privilege_type = 'EXECUTE'
      AND pg_get_userbyid(acl_entry.grantee) = 'service_role'
      AND acl_entry.is_grantable
  ) THEN
    RAISE EXCEPTION 'AI_LOG_RETENTION_EXACT_ACL_POSTCONDITION_FAILED';
  END IF;
END
$postcondition$;

COMMIT;
