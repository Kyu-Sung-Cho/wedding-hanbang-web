BEGIN TRANSACTION READ ONLY;

SELECT
  current_database() IS NOT NULL AS database_reachable,
  to_regprocedure('public.redact_old_ai_interactions(interval)') IS NOT NULL
    AS function_exists,
  pg_get_userbyid(procedure_record.proowner) AS function_owner,
  procedure_record.prosecdef AS security_definer,
  md5(pg_get_functiondef(procedure_record.oid)) AS definition_md5,
  (
    SELECT array_agg(
      DISTINCT pg_get_userbyid(acl_entry.grantee)
      ORDER BY pg_get_userbyid(acl_entry.grantee)
    )
    FROM aclexplode(COALESCE(
      procedure_record.proacl,
      acldefault('f', procedure_record.proowner)
    )) AS acl_entry
    WHERE acl_entry.privilege_type = 'EXECUTE'
  ) AS execute_grantees,
  EXISTS (
    SELECT 1
    FROM aclexplode(COALESCE(
      procedure_record.proacl,
      acldefault('f', procedure_record.proowner)
    )) AS acl_entry
    WHERE acl_entry.privilege_type = 'EXECUTE'
      AND pg_get_userbyid(acl_entry.grantee) = 'service_role'
      AND acl_entry.is_grantable
  ) AS service_role_grantable
FROM pg_proc AS procedure_record
WHERE procedure_record.oid =
  to_regprocedure('public.redact_old_ai_interactions(interval)');

ROLLBACK;
