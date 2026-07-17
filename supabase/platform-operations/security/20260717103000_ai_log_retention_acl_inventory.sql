BEGIN TRANSACTION READ ONLY;

SELECT
  current_database() IS NOT NULL AS database_reachable,
  to_regprocedure('public.redact_old_ai_interactions(interval)') IS NOT NULL AS function_exists,
  pg_get_userbyid(procedure_record.proowner) AS function_owner,
  procedure_record.prosecdef AS security_definer,
  md5(pg_get_functiondef(procedure_record.oid)) AS definition_md5,
  has_function_privilege('anon', procedure_record.oid, 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', procedure_record.oid, 'EXECUTE') AS authenticated_execute,
  has_function_privilege('service_role', procedure_record.oid, 'EXECUTE') AS service_role_execute,
  EXISTS (
    SELECT 1
    FROM aclexplode(COALESCE(
      procedure_record.proacl,
      acldefault('f', procedure_record.proowner)
    )) AS acl_entry
    WHERE acl_entry.grantee = 0
      AND acl_entry.privilege_type = 'EXECUTE'
  ) AS public_execute
FROM pg_proc AS procedure_record
WHERE procedure_record.oid = 'public.redact_old_ai_interactions(interval)'::regprocedure;

ROLLBACK;
