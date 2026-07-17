BEGIN TRANSACTION READ ONLY;

SELECT 1 / CASE WHEN
  to_regprocedure('public.redact_old_ai_interactions(interval)') IS NOT NULL
  AND NOT has_function_privilege(
    'anon',
    'public.redact_old_ai_interactions(interval)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.redact_old_ai_interactions(interval)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.redact_old_ai_interactions(interval)',
    'EXECUTE'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_proc AS procedure_record
    CROSS JOIN LATERAL aclexplode(COALESCE(
      procedure_record.proacl,
      acldefault('f', procedure_record.proowner)
    )) AS acl_entry
    WHERE procedure_record.oid = 'public.redact_old_ai_interactions(interval)'::regprocedure
      AND acl_entry.grantee = 0
      AND acl_entry.privilege_type = 'EXECUTE'
  )
THEN 1 ELSE 0 END AS ai_log_retention_acl_verified;

ROLLBACK;
