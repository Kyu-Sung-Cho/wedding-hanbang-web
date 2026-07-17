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

  IF NOT FOUND
     OR NOT procedure_record.prosecdef
     OR pg_get_userbyid(procedure_record.proowner) <> 'postgres'
     OR NOT has_function_privilege(
       'service_role',
       procedure_record.oid,
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'AI_LOG_RETENTION_ACL_PRECONDITION_FAILED';
  END IF;
END
$precondition$;

REVOKE ALL ON FUNCTION public.redact_old_ai_interactions(interval)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redact_old_ai_interactions(interval)
  TO service_role;

DO $postcondition$
DECLARE
  procedure_record pg_proc%ROWTYPE;
BEGIN
  SELECT * INTO procedure_record
  FROM pg_proc
  WHERE oid = 'public.redact_old_ai_interactions(interval)'::regprocedure;

  IF has_function_privilege('anon', procedure_record.oid, 'EXECUTE')
     OR has_function_privilege('authenticated', procedure_record.oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', procedure_record.oid, 'EXECUTE')
     OR EXISTS (
       SELECT 1
       FROM aclexplode(COALESCE(
         procedure_record.proacl,
         acldefault('f', procedure_record.proowner)
       )) AS acl_entry
       WHERE acl_entry.grantee = 0
         AND acl_entry.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'AI_LOG_RETENTION_ACL_POSTCONDITION_FAILED';
  END IF;
END
$postcondition$;

COMMIT;
