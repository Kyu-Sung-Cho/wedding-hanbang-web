-- Permanently pin the AI raw-log retention helper to the reviewed destructive
-- contract. Applying this migration replaces metadata and executable code only;
-- it deliberately does not invoke the function or mutate any AI-log row.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.redact_old_ai_interactions(
  p_retention interval DEFAULT interval '90 days'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF p_retention IS NULL
     OR EXTRACT(YEAR FROM p_retention) <> 0
     OR EXTRACT(MONTH FROM p_retention) <> 0
     OR EXTRACT(DAY FROM p_retention) <> 90
     OR EXTRACT(HOUR FROM p_retention) <> 0
     OR EXTRACT(MINUTE FROM p_retention) <> 0
     OR EXTRACT(SECOND FROM p_retention) <> 0 THEN
    RAISE EXCEPTION 'retention interval must be exactly 90 days'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.ai_interactions_log
     SET user_input = CASE
           WHEN user_input IS NULL THEN NULL
           ELSE '[redacted_after_retention]'
         END,
         ai_output = CASE
           WHEN ai_output IS NULL THEN NULL
           ELSE '[redacted_after_retention]'
         END,
         tool_input = NULL,
         tool_output = NULL,
         error_message = CASE
           WHEN error_message IS NULL THEN NULL
           ELSE '[redacted_after_retention]'
         END,
         -- Metadata has multiple writers, including operational/admin paths
         -- that historically bypassed the application sanitizer. Rebuild it
         -- from a tiny typed cost-reconciliation allowlist instead of copying
         -- arbitrary free-form values such as titles, reasons, or SDK errors.
         metadata = pg_catalog.jsonb_strip_nulls(
           pg_catalog.jsonb_build_object(
             'ledger_status', CASE
               WHEN metadata->>'ledger_status' IN (
                 'prepared', 'reserved', 'released', 'settled',
                 'unknown', 'finalized'
               ) THEN pg_catalog.to_jsonb(metadata->>'ledger_status')
               ELSE NULL::jsonb
             END,
             'provider_attempted', CASE
               WHEN pg_catalog.jsonb_typeof(metadata->'provider_attempted') = 'boolean'
                 THEN metadata->'provider_attempted'
               ELSE NULL::jsonb
             END,
             'usage_status', CASE
               WHEN metadata->>'usage_status' IN ('complete', 'unknown')
                 THEN pg_catalog.to_jsonb(metadata->>'usage_status')
               ELSE NULL::jsonb
             END,
             'unknown_paid_attempt', CASE
               WHEN pg_catalog.jsonb_typeof(metadata->'unknown_paid_attempt') = 'boolean'
                 THEN metadata->'unknown_paid_attempt'
               ELSE NULL::jsonb
             END,
             'cache_creation_input_tokens', CASE
               WHEN pg_catalog.jsonb_typeof(
                 metadata->'cache_creation_input_tokens'
               ) = 'number' THEN CASE
                 WHEN (metadata->>'cache_creation_input_tokens')::numeric
                        BETWEEN 0 AND 1000000000
                   THEN metadata->'cache_creation_input_tokens'
                 ELSE NULL::jsonb
               END
               ELSE NULL::jsonb
             END,
             'cache_read_input_tokens', CASE
               WHEN pg_catalog.jsonb_typeof(
                 metadata->'cache_read_input_tokens'
               ) = 'number' THEN CASE
                 WHEN (metadata->>'cache_read_input_tokens')::numeric
                        BETWEEN 0 AND 1000000000
                   THEN metadata->'cache_read_input_tokens'
                 ELSE NULL::jsonb
               END
               ELSE NULL::jsonb
             END
           )
         ) ||
           pg_catalog.jsonb_build_object(
             'retention_redacted_at', pg_catalog.now(),
             'retention_policy', 'raw_payload_90d'
           )
   WHERE created_at < pg_catalog.now() - interval '90 days'
     -- A marker is only complete when every raw payload field is actually
     -- redacted and the object has a timestamp. Repair forged, partial, or
     -- interrupted markers instead of trusting metadata alone.
     AND (
       pg_catalog.jsonb_typeof(metadata) IS DISTINCT FROM 'object'
       OR metadata->>'retention_policy' IS DISTINCT FROM 'raw_payload_90d'
       OR metadata->>'retention_redacted_at' IS NULL
       OR pg_catalog.jsonb_typeof(metadata->'retention_redacted_at')
            IS DISTINCT FROM 'string'
       OR (user_input IS NOT NULL
           AND user_input <> '[redacted_after_retention]')
       OR (ai_output IS NOT NULL
           AND ai_output <> '[redacted_after_retention]')
       OR tool_input IS NOT NULL
       OR tool_output IS NOT NULL
       OR (error_message IS NOT NULL
           AND error_message <> '[redacted_after_retention]')
       OR (
         CASE
           WHEN pg_catalog.jsonb_typeof(metadata) = 'object' THEN
             metadata - ARRAY[
               'ledger_status', 'provider_attempted', 'usage_status',
               'unknown_paid_attempt', 'cache_creation_input_tokens',
               'cache_read_input_tokens', 'retention_redacted_at',
               'retention_policy'
             ]::text[]
           ELSE '{}'::jsonb
         END
       ) <> '{}'::jsonb
       OR CASE
         WHEN NOT (COALESCE(metadata, '{}'::jsonb) ? 'ledger_status') THEN false
         WHEN pg_catalog.jsonb_typeof(metadata->'ledger_status')
              IS DISTINCT FROM 'string' THEN true
         ELSE metadata->>'ledger_status' NOT IN (
           'prepared', 'reserved', 'released', 'settled',
           'unknown', 'finalized'
         )
       END
       OR CASE
         WHEN NOT (COALESCE(metadata, '{}'::jsonb) ? 'provider_attempted') THEN false
         ELSE pg_catalog.jsonb_typeof(metadata->'provider_attempted') <> 'boolean'
       END
       OR CASE
         WHEN NOT (COALESCE(metadata, '{}'::jsonb) ? 'usage_status') THEN false
         WHEN pg_catalog.jsonb_typeof(metadata->'usage_status')
              IS DISTINCT FROM 'string' THEN true
         ELSE metadata->>'usage_status' NOT IN ('complete', 'unknown')
       END
       OR CASE
         WHEN NOT (COALESCE(metadata, '{}'::jsonb) ? 'unknown_paid_attempt') THEN false
         ELSE pg_catalog.jsonb_typeof(metadata->'unknown_paid_attempt') <> 'boolean'
       END
       OR CASE
         WHEN NOT (
           COALESCE(metadata, '{}'::jsonb) ? 'cache_creation_input_tokens'
         ) THEN false
         WHEN pg_catalog.jsonb_typeof(
           metadata->'cache_creation_input_tokens'
         ) <> 'number' THEN true
         ELSE (metadata->>'cache_creation_input_tokens')::numeric
                NOT BETWEEN 0 AND 1000000000
       END
       OR CASE
         WHEN NOT (COALESCE(metadata, '{}'::jsonb) ? 'cache_read_input_tokens')
           THEN false
         WHEN pg_catalog.jsonb_typeof(
           metadata->'cache_read_input_tokens'
         ) <> 'number' THEN true
         ELSE (metadata->>'cache_read_input_tokens')::numeric
                NOT BETWEEN 0 AND 1000000000
       END
     );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

ALTER FUNCTION public.redact_old_ai_interactions(interval) OWNER TO postgres;

-- CREATE OR REPLACE preserves the previous ACL. Remove every explicit grant,
-- including grants to project-specific roles that this migration cannot know
-- by name, before rebuilding the exact owner + service_role execute set.
REVOKE ALL PRIVILEGES ON FUNCTION public.redact_old_ai_interactions(interval)
  FROM PUBLIC;
DO $revoke_unreviewed_execute_grants$
DECLARE
  grant_record record;
BEGIN
  FOR grant_record IN
    SELECT DISTINCT pg_catalog.pg_get_userbyid(acl_entry.grantee) AS role_name
    FROM pg_catalog.pg_proc AS procedure_record
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
      procedure_record.proacl,
      pg_catalog.acldefault('f', procedure_record.proowner)
    )) AS acl_entry
    WHERE procedure_record.oid =
      'public.redact_old_ai_interactions(interval)'::regprocedure
      AND acl_entry.privilege_type = 'EXECUTE'
      AND acl_entry.grantee NOT IN (
        procedure_record.proowner,
        (SELECT role_record.oid
         FROM pg_catalog.pg_roles AS role_record
         WHERE role_record.rolname = 'service_role')
      )
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE ALL PRIVILEGES ON FUNCTION public.redact_old_ai_interactions(interval) FROM %I CASCADE',
      grant_record.role_name
    );
  END LOOP;
END;
$revoke_unreviewed_execute_grants$;

REVOKE ALL PRIVILEGES ON FUNCTION public.redact_old_ai_interactions(interval)
  FROM anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.redact_old_ai_interactions(interval)
  TO service_role;

DO $structural_postcondition$
DECLARE
  procedure_record pg_proc%ROWTYPE;
BEGIN
  SELECT *
    INTO procedure_record
    FROM pg_catalog.pg_proc
   WHERE oid = pg_catalog.to_regprocedure(
     'public.redact_old_ai_interactions(interval)'
   );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AI_LOG_RETENTION_CONTRACT_FUNCTION_MISSING';
  END IF;

  IF NOT procedure_record.prosecdef
     OR procedure_record.prokind <> 'f'
     OR procedure_record.provolatile <> 'v'
     OR procedure_record.pronargs <> 1
     OR procedure_record.pronargdefaults <> 1
     OR pg_catalog.pg_get_userbyid(procedure_record.proowner) <> 'postgres'
     OR procedure_record.proconfig IS DISTINCT FROM
       ARRAY['search_path=""']::text[]
     OR pg_catalog.pg_get_function_result(procedure_record.oid) <> 'integer'
     OR position(
       'UPDATE public.ai_interactions_log' IN procedure_record.prosrc
     ) = 0
     OR position(
       'pg_catalog.now() - interval ''90 days''' IN procedure_record.prosrc
     ) = 0
     OR position(
       'retention interval must be exactly 90 days' IN procedure_record.prosrc
     ) = 0
     OR position(
       'pg_catalog.jsonb_typeof(metadata) = ''object'''
       IN procedure_record.prosrc
     ) = 0
     OR position(
       'metadata->>''retention_policy'' IS DISTINCT FROM ''raw_payload_90d'''
       IN procedure_record.prosrc
     ) = 0
     OR position(
       'metadata->>''retention_redacted_at'' IS NULL'
       IN procedure_record.prosrc
     ) = 0
     OR position(
       'jsonb_typeof(metadata->''retention_redacted_at'')'
       IN procedure_record.prosrc
     ) = 0
     OR position(
       'error_message <> ''[redacted_after_retention]'''
       IN procedure_record.prosrc
     ) = 0
     OR position(
       'metadata - ARRAY[' IN procedure_record.prosrc
     ) = 0
     OR position(
       '''cache_read_input_tokens''' IN procedure_record.prosrc
     ) = 0 THEN
    RAISE EXCEPTION 'AI_LOG_RETENTION_CONTRACT_STRUCTURE_INVALID';
  END IF;
END;
$structural_postcondition$;

DO $acl_postcondition$
DECLARE
  procedure_record pg_proc%ROWTYPE;
BEGIN
  SELECT *
    INTO STRICT procedure_record
    FROM pg_catalog.pg_proc
   WHERE oid = 'public.redact_old_ai_interactions(interval)'::regprocedure;

  IF (
    SELECT pg_catalog.array_agg(
      DISTINCT pg_catalog.pg_get_userbyid(acl_entry.grantee)
      ORDER BY pg_catalog.pg_get_userbyid(acl_entry.grantee)
    )
    FROM pg_catalog.aclexplode(COALESCE(
      procedure_record.proacl,
      pg_catalog.acldefault('f', procedure_record.proowner)
    )) AS acl_entry
    WHERE acl_entry.privilege_type = 'EXECUTE'
  ) IS DISTINCT FROM ARRAY['postgres', 'service_role']::name[]
  OR EXISTS (
    SELECT 1
    FROM pg_catalog.aclexplode(COALESCE(
      procedure_record.proacl,
      pg_catalog.acldefault('f', procedure_record.proowner)
    )) AS acl_entry
    WHERE acl_entry.privilege_type = 'EXECUTE'
      AND pg_catalog.pg_get_userbyid(acl_entry.grantee) = 'service_role'
      AND acl_entry.is_grantable
  ) THEN
    RAISE EXCEPTION 'AI_LOG_RETENTION_CONTRACT_ACL_INVALID';
  END IF;
END;
$acl_postcondition$;

COMMENT ON FUNCTION public.redact_old_ai_interactions(interval) IS
  'Service-role-only raw AI payload redaction. The only accepted retention window is exactly 90 days; migrations never invoke this function.';
