BEGIN TRANSACTION READ ONLY;

SELECT 1 / CASE WHEN
  to_regprocedure('public.redact_old_ai_interactions(interval)') IS NOT NULL
  AND (
    SELECT array_agg(
      DISTINCT pg_get_userbyid(acl_entry.grantee)
      ORDER BY pg_get_userbyid(acl_entry.grantee)
    )
    FROM pg_proc AS procedure_record
    CROSS JOIN LATERAL aclexplode(COALESCE(
      procedure_record.proacl,
      acldefault('f', procedure_record.proowner)
    )) AS acl_entry
    WHERE procedure_record.oid =
      'public.redact_old_ai_interactions(interval)'::regprocedure
      AND acl_entry.privilege_type = 'EXECUTE'
  ) IS NOT DISTINCT FROM ARRAY['postgres', 'service_role']::name[]
  AND NOT EXISTS (
    SELECT 1
    FROM pg_proc AS procedure_record
    CROSS JOIN LATERAL aclexplode(COALESCE(
      procedure_record.proacl,
      acldefault('f', procedure_record.proowner)
    )) AS acl_entry
    WHERE procedure_record.oid =
      'public.redact_old_ai_interactions(interval)'::regprocedure
      AND acl_entry.privilege_type = 'EXECUTE'
      AND pg_get_userbyid(acl_entry.grantee) = 'service_role'
      AND acl_entry.is_grantable
  )
THEN 1 ELSE 0 END AS ai_log_retention_exact_acl_verified;

ROLLBACK;
