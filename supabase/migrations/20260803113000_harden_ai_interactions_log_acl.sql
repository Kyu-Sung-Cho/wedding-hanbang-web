-- ai_interactions_log can contain user prompts, model output, tool payloads,
-- errors, identifiers, and cost metadata. It is a server-owned audit ledger:
-- current runtime callsites use service_role only for direct SELECT and INSERT.
-- UPDATE/DELETE work is performed inside postgres-owned SECURITY DEFINER RPCs.
--
-- RLS alone is insufficient because table, column, sequence, and non-DML table
-- privileges are independent grants. Rebuild every relevant boundary here and
-- force RLS so a future table-owner path cannot silently rely on owner bypass.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $ai_interactions_log_acl_preflight$
DECLARE
  missing_column text;
  missing_role text;
  table_owner text;
BEGIN
  SELECT required.role_name
  INTO missing_role
  FROM unnest(
    ARRAY['postgres', 'anon', 'authenticated', 'service_role']::text[]
  ) AS required(role_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles AS actual
    WHERE actual.rolname = required.role_name
  )
  ORDER BY required.role_name
  LIMIT 1;

  IF missing_role IS NOT NULL THEN
    RAISE EXCEPTION 'AI_LOG_ACL_ROLE_MISSING: %', missing_role
      USING ERRCODE = '55000';
  END IF;

  IF pg_catalog.to_regclass('public.ai_interactions_log') IS NULL THEN
    RAISE EXCEPTION 'AI_LOG_ACL_TABLE_MISSING: public.ai_interactions_log'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'ai_interactions_log'
      AND relation.relkind IN ('r', 'p')
  ) THEN
    RAISE EXCEPTION 'AI_LOG_ACL_RELATION_KIND_INVALID'
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.pg_get_userbyid(relation.relowner)
  INTO table_owner
  FROM pg_catalog.pg_class AS relation
  WHERE relation.oid = 'public.ai_interactions_log'::regclass;

  IF table_owner IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'AI_LOG_ACL_OWNER_REQUIRES_REVIEW: %', table_owner
      USING ERRCODE = '55000';
  END IF;

  IF NOT (
    SELECT role_record.rolbypassrls
    FROM pg_catalog.pg_roles AS role_record
    WHERE role_record.rolname = 'service_role'
  ) THEN
    RAISE EXCEPTION 'AI_LOG_ACL_SERVICE_ROLE_MUST_BYPASS_RLS'
      USING ERRCODE = '55000';
  END IF;

  SELECT required.column_name
  INTO missing_column
  FROM (VALUES
    ('id', 'uuid'::regtype),
    ('created_at', 'timestamptz'::regtype),
    ('user_id', 'uuid'::regtype),
    ('couple_id', 'uuid'::regtype),
    ('session_id', 'text'::regtype),
    ('message_id', 'uuid'::regtype),
    ('interaction_type', 'text'::regtype),
    ('specialist_type', 'text'::regtype),
    ('user_input', 'text'::regtype),
    ('ai_output', 'text'::regtype),
    ('tool_name', 'text'::regtype),
    ('tool_input', 'jsonb'::regtype),
    ('tool_output', 'jsonb'::regtype),
    ('latency_ms', 'integer'::regtype),
    ('success', 'boolean'::regtype),
    ('error_message', 'text'::regtype),
    ('model', 'text'::regtype),
    ('tokens_input', 'integer'::regtype),
    ('tokens_output', 'integer'::regtype),
    ('cost_usd', 'numeric'::regtype),
    ('metadata', 'jsonb'::regtype),
    ('amora_request_key', 'text'::regtype),
    ('amora_call_index', 'integer'::regtype),
    ('amora_call_source', 'text'::regtype),
    ('amora_call_phase', 'text'::regtype),
    ('amora_claim_token', 'uuid'::regtype),
    ('amora_cost_status', 'text'::regtype),
    ('amora_reserved_cost_microusd', 'bigint'::regtype),
    ('amora_actual_cost_microusd', 'bigint'::regtype),
    ('amora_global_counter_key', 'text'::regtype),
    ('amora_cost_couple_id', 'uuid'::regtype),
    ('amora_receipt_updated_at', 'timestamptz'::regtype)
  ) AS required(column_name, type_oid)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS actual
    WHERE actual.attrelid = 'public.ai_interactions_log'::regclass
      AND actual.attname = required.column_name
      AND actual.atttypid = required.type_oid
      AND actual.attnum > 0
      AND NOT actual.attisdropped
  )
  ORDER BY required.column_name
  LIMIT 1;

  IF missing_column IS NOT NULL THEN
    RAISE EXCEPTION 'AI_LOG_ACL_COLUMN_MISSING_OR_WRONG_TYPE: %', missing_column
      USING ERRCODE = '55000';
  END IF;
END;
$ai_interactions_log_acl_preflight$;

LOCK TABLE public.ai_interactions_log IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE public.ai_interactions_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_interactions_log FORCE ROW LEVEL SECURITY;

-- The ledger is service-only. Remove every historical or drifted policy,
-- including the former authenticated owner SELECT policy, before installing
-- the two commands required by current direct service-role callsites.
DO $ai_interactions_log_drop_policies$
DECLARE
  policy_record record;
BEGIN
  FOR policy_record IN
    SELECT policy.polname
    FROM pg_catalog.pg_policy AS policy
    WHERE policy.polrelid = 'public.ai_interactions_log'::regclass
    ORDER BY policy.polname
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY %I ON public.ai_interactions_log',
      policy_record.polname
    );
  END LOOP;
END;
$ai_interactions_log_drop_policies$;

CREATE POLICY ai_interactions_log_service_select
  ON public.ai_interactions_log
  FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY ai_interactions_log_service_insert
  ON public.ai_interactions_log
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Table-level REVOKE does not remove column ACLs. Reset both layers, including
-- service_role, and then grant back only the two verified runtime operations.
REVOKE ALL PRIVILEGES ON TABLE public.ai_interactions_log
  FROM PUBLIC, anon, authenticated, service_role;

DO $ai_interactions_log_remove_column_acls$
DECLARE
  all_columns text;
BEGIN
  SELECT pg_catalog.string_agg(
    pg_catalog.quote_ident(attribute_record.attname),
    ', '
    ORDER BY attribute_record.attnum
  )
  INTO all_columns
  FROM pg_catalog.pg_attribute AS attribute_record
  WHERE attribute_record.attrelid = 'public.ai_interactions_log'::regclass
    AND attribute_record.attnum > 0
    AND NOT attribute_record.attisdropped;

  IF all_columns IS NULL THEN
    RAISE EXCEPTION 'AI_LOG_ACL_COLUMNS_EMPTY'
      USING ERRCODE = '55000';
  END IF;

  EXECUTE pg_catalog.format(
    'REVOKE ALL PRIVILEGES (%s) ON TABLE public.ai_interactions_log FROM PUBLIC, anon, authenticated, service_role',
    all_columns
  );
END;
$ai_interactions_log_remove_column_acls$;

GRANT SELECT, INSERT ON TABLE public.ai_interactions_log TO service_role;

-- Production uses a UUID default and currently has no owned sequence. Handle
-- any serial/identity drift fail-safely: no client role may use it, while a
-- service INSERT that omits its generated column receives USAGE and nothing
-- broader. Unknown sequence grantees are rejected by postflight below.
DO $ai_interactions_log_rebuild_owned_sequence_acls$
DECLARE
  sequence_record record;
BEGIN
  FOR sequence_record IN
    SELECT pg_catalog.format(
      '%I.%I',
      sequence_namespace.nspname,
      sequence_relation.relname
    ) AS qualified_name
    FROM pg_catalog.pg_depend AS dependency
    JOIN pg_catalog.pg_class AS sequence_relation
      ON sequence_relation.oid = dependency.objid
    JOIN pg_catalog.pg_namespace AS sequence_namespace
      ON sequence_namespace.oid = sequence_relation.relnamespace
    WHERE dependency.refobjid = 'public.ai_interactions_log'::regclass
      AND dependency.refobjsubid > 0
      AND dependency.deptype IN ('a', 'i')
      AND sequence_relation.relkind = 'S'
    ORDER BY sequence_namespace.nspname, sequence_relation.relname
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE ALL PRIVILEGES ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role',
      sequence_record.qualified_name
    );
    EXECUTE pg_catalog.format(
      'GRANT USAGE ON SEQUENCE %s TO service_role',
      sequence_record.qualified_name
    );
  END LOOP;
END;
$ai_interactions_log_rebuild_owned_sequence_acls$;

DO $ai_interactions_log_acl_postflight$
DECLARE
  bad_grantee text;
  bad_policy text;
  leaked_column text;
  leaked_privilege text;
  leaked_role text;
  sequence_record record;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = 'public.ai_interactions_log'::regclass
      AND relation.relrowsecurity
      AND relation.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'AI_LOG_ACL_RLS_POSTCONDITION_FAILED'
      USING ERRCODE = '55000';
  END IF;

  SELECT role_name.role_name, privilege_name.privilege_name
  INTO leaked_role, leaked_privilege
  FROM unnest(ARRAY['anon', 'authenticated']::text[])
    AS role_name(role_name)
  CROSS JOIN unnest(ARRAY[
    'SELECT',
    'INSERT',
    'UPDATE',
    'DELETE',
    'TRUNCATE',
    'REFERENCES',
    'TRIGGER'
  ]::text[]) AS privilege_name(privilege_name)
  WHERE pg_catalog.has_table_privilege(
    role_name.role_name,
    'public.ai_interactions_log',
    privilege_name.privilege_name
  )
  ORDER BY role_name.role_name, privilege_name.privilege_name
  LIMIT 1;

  IF leaked_role IS NOT NULL THEN
    RAISE EXCEPTION 'AI_LOG_ACL_UNTRUSTED_TABLE_PRIVILEGE: % %',
      leaked_role,
      leaked_privilege
      USING ERRCODE = '55000';
  END IF;

  SELECT
    CASE
      WHEN acl_entry.grantee = 0 THEN 'PUBLIC'
      ELSE pg_catalog.pg_get_userbyid(acl_entry.grantee)
    END
  INTO bad_grantee
  FROM pg_catalog.pg_class AS relation
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(
      relation.relacl,
      pg_catalog.acldefault('r', relation.relowner)
    )
  ) AS acl_entry
  WHERE relation.oid = 'public.ai_interactions_log'::regclass
    AND acl_entry.grantee NOT IN (
      relation.relowner,
      (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'service_role')
    )
  ORDER BY acl_entry.grantee
  LIMIT 1;

  IF bad_grantee IS NOT NULL THEN
    RAISE EXCEPTION 'AI_LOG_ACL_UNREVIEWED_TABLE_GRANTEE: %', bad_grantee
      USING ERRCODE = '55000';
  END IF;

  IF NOT pg_catalog.has_table_privilege(
    'service_role', 'public.ai_interactions_log', 'SELECT'
  ) OR NOT pg_catalog.has_table_privilege(
    'service_role', 'public.ai_interactions_log', 'INSERT'
  ) OR pg_catalog.has_table_privilege(
    'service_role', 'public.ai_interactions_log', 'UPDATE'
  ) OR pg_catalog.has_table_privilege(
    'service_role', 'public.ai_interactions_log', 'DELETE'
  ) OR pg_catalog.has_table_privilege(
    'service_role', 'public.ai_interactions_log', 'TRUNCATE'
  ) OR pg_catalog.has_table_privilege(
    'service_role', 'public.ai_interactions_log', 'REFERENCES'
  ) OR pg_catalog.has_table_privilege(
    'service_role', 'public.ai_interactions_log', 'TRIGGER'
  ) THEN
    RAISE EXCEPTION 'AI_LOG_ACL_SERVICE_TABLE_POSTCONDITION_FAILED'
      USING ERRCODE = '55000';
  END IF;

  SELECT
    attribute_record.attname,
    CASE
      WHEN acl_entry.grantee = 0 THEN 'PUBLIC'
      ELSE pg_catalog.pg_get_userbyid(acl_entry.grantee)
    END,
    acl_entry.privilege_type
  INTO leaked_column, leaked_role, leaked_privilege
  FROM pg_catalog.pg_attribute AS attribute_record
  CROSS JOIN LATERAL unnest(
    COALESCE(attribute_record.attacl, '{}'::aclitem[])
  ) AS raw_acl(acl_item)
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    ARRAY[raw_acl.acl_item]::aclitem[]
  ) AS acl_entry
  WHERE attribute_record.attrelid = 'public.ai_interactions_log'::regclass
    AND attribute_record.attnum > 0
    AND NOT attribute_record.attisdropped
    AND acl_entry.grantee <> (
      SELECT relation.relowner
      FROM pg_catalog.pg_class AS relation
      WHERE relation.oid = 'public.ai_interactions_log'::regclass
    )
  ORDER BY attribute_record.attnum, acl_entry.grantee
  LIMIT 1;

  IF leaked_column IS NOT NULL THEN
    RAISE EXCEPTION 'AI_LOG_ACL_COLUMN_PRIVILEGE_REMAINS: % % %',
      leaked_role,
      leaked_column,
      leaked_privilege
      USING ERRCODE = '55000';
  END IF;

  SELECT policy_record.polname
  INTO bad_policy
  FROM pg_catalog.pg_policy AS policy_record
  WHERE policy_record.polrelid = 'public.ai_interactions_log'::regclass
    AND NOT (
      policy_record.polpermissive
      AND policy_record.polroles = ARRAY[
        (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'service_role')
      ]::oid[]
      AND (
        (
          policy_record.polname = 'ai_interactions_log_service_select'
          AND policy_record.polcmd = 'r'
          AND pg_catalog.pg_get_expr(
            policy_record.polqual,
            policy_record.polrelid
          ) = 'true'
          AND policy_record.polwithcheck IS NULL
        )
        OR (
          policy_record.polname = 'ai_interactions_log_service_insert'
          AND policy_record.polcmd = 'a'
          AND policy_record.polqual IS NULL
          AND pg_catalog.pg_get_expr(
            policy_record.polwithcheck,
            policy_record.polrelid
          ) = 'true'
        )
      )
    )
  ORDER BY policy_record.polname
  LIMIT 1;

  IF bad_policy IS NOT NULL OR (
    SELECT count(*)
    FROM pg_catalog.pg_policy AS policy_record
    WHERE policy_record.polrelid = 'public.ai_interactions_log'::regclass
  ) <> 2 THEN
    RAISE EXCEPTION 'AI_LOG_ACL_POLICY_POSTCONDITION_FAILED: %',
      COALESCE(bad_policy, 'wrong policy count')
      USING ERRCODE = '55000';
  END IF;

  FOR sequence_record IN
    SELECT
      sequence_relation.oid,
      sequence_relation.relowner,
      pg_catalog.format(
        '%I.%I',
        sequence_namespace.nspname,
        sequence_relation.relname
      ) AS qualified_name
    FROM pg_catalog.pg_depend AS dependency
    JOIN pg_catalog.pg_class AS sequence_relation
      ON sequence_relation.oid = dependency.objid
    JOIN pg_catalog.pg_namespace AS sequence_namespace
      ON sequence_namespace.oid = sequence_relation.relnamespace
    WHERE dependency.refobjid = 'public.ai_interactions_log'::regclass
      AND dependency.refobjsubid > 0
      AND dependency.deptype IN ('a', 'i')
      AND sequence_relation.relkind = 'S'
    ORDER BY sequence_namespace.nspname, sequence_relation.relname
  LOOP
    IF pg_catalog.has_sequence_privilege(
      'anon', sequence_record.oid, 'USAGE'
    ) OR pg_catalog.has_sequence_privilege(
      'anon', sequence_record.oid, 'SELECT'
    ) OR pg_catalog.has_sequence_privilege(
      'anon', sequence_record.oid, 'UPDATE'
    ) OR pg_catalog.has_sequence_privilege(
      'authenticated', sequence_record.oid, 'USAGE'
    ) OR pg_catalog.has_sequence_privilege(
      'authenticated', sequence_record.oid, 'SELECT'
    ) OR pg_catalog.has_sequence_privilege(
      'authenticated', sequence_record.oid, 'UPDATE'
    ) THEN
      RAISE EXCEPTION 'AI_LOG_ACL_UNTRUSTED_SEQUENCE_PRIVILEGE: %',
        sequence_record.qualified_name
        USING ERRCODE = '55000';
    END IF;

    SELECT
      CASE
        WHEN acl_entry.grantee = 0 THEN 'PUBLIC'
        ELSE pg_catalog.pg_get_userbyid(acl_entry.grantee)
      END
    INTO bad_grantee
    FROM pg_catalog.pg_class AS sequence_relation
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        sequence_relation.relacl,
        pg_catalog.acldefault('S', sequence_relation.relowner)
      )
    ) AS acl_entry
    WHERE sequence_relation.oid = sequence_record.oid
      AND acl_entry.grantee NOT IN (
        sequence_record.relowner,
        (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'service_role')
      )
    ORDER BY acl_entry.grantee
    LIMIT 1;

    IF bad_grantee IS NOT NULL THEN
      RAISE EXCEPTION 'AI_LOG_ACL_UNREVIEWED_SEQUENCE_GRANTEE: % %',
        sequence_record.qualified_name,
        bad_grantee
        USING ERRCODE = '55000';
    END IF;

    IF NOT pg_catalog.has_sequence_privilege(
      'service_role', sequence_record.oid, 'USAGE'
    ) OR pg_catalog.has_sequence_privilege(
      'service_role', sequence_record.oid, 'SELECT'
    ) OR pg_catalog.has_sequence_privilege(
      'service_role', sequence_record.oid, 'UPDATE'
    ) THEN
      RAISE EXCEPTION 'AI_LOG_ACL_SERVICE_SEQUENCE_POSTCONDITION_FAILED: %',
        sequence_record.qualified_name
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END;
$ai_interactions_log_acl_postflight$;

COMMIT;
