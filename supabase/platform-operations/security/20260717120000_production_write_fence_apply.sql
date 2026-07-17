BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $precondition$
DECLARE
  active_cron_jobs bigint := 0;
BEGIN
  IF current_user <> 'postgres'
     OR session_user <> 'postgres'
     OR NULLIF(current_setting('request.jwt.claims', true), '') IS NOT NULL
     OR NULLIF(current_setting('request.jwt.claim.role', true), '') IS NOT NULL
     OR auth.role() IS NOT NULL THEN
    RAISE EXCEPTION 'PRODUCTION_WRITE_FENCE_POSTGRES_SESSION_REQUIRED';
  END IF;

  IF to_regprocedure('public.production_write_fence_guard_20260717()') IS NOT NULL
     OR to_regprocedure('public.production_write_fence_attach_20260717()') IS NOT NULL
     OR to_regprocedure('public.production_live_schema_contract_20260717()') IS NOT NULL
     OR to_regclass('public.production_release_lease_20260717') IS NOT NULL
     OR EXISTS (
       SELECT 1
       FROM pg_event_trigger
       WHERE evtname IN (
         'evt_production_write_fence_ddl_lock_20260717',
         'evt_production_write_fence_20260717'
       )
     )
     OR EXISTS (
       SELECT 1
       FROM pg_trigger
       WHERE tgname = 'trg_production_write_fence_20260717'
     ) THEN
    RAISE EXCEPTION 'PRODUCTION_WRITE_FENCE_OBJECT_COLLISION';
  END IF;

  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM cron.job WHERE active' INTO active_cron_jobs;
  END IF;
  IF active_cron_jobs <> 0 THEN
    RAISE EXCEPTION 'PRODUCTION_WRITE_FENCE_ACTIVE_DATABASE_CRON'
      USING DETAIL = format('active_job_count=%s', active_cron_jobs);
  END IF;
END
$precondition$;

-- Take every current public-table lock before installing the first trigger so
-- there is no table-by-table write gap. The event trigger below covers tables
-- created later by the postgres migration session.
DO $lock_all_public_tables$
DECLARE
  relation_list text;
BEGIN
  SELECT string_agg(format('%I.%I', namespace.nspname, relation.relname), ', '
                    ORDER BY relation.oid)
  INTO relation_list
  FROM pg_class AS relation
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relkind IN ('r', 'p');

  IF relation_list IS NOT NULL THEN
    EXECUTE 'LOCK TABLE ' || relation_list || ' IN SHARE ROW EXCLUSIVE MODE';
  END IF;
END
$lock_all_public_tables$;

CREATE FUNCTION public.production_write_fence_guard_20260717()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, auth
AS $function$
BEGIN
  -- PostgREST keeps the JWT GUC while SECURITY DEFINER RPCs temporarily run as
  -- their postgres owner. Requiring both a JWT-less postgres current/session
  -- role closes direct anon, authenticated, service_role and RPC bypasses.
  IF current_user = 'postgres'
     AND session_user = 'postgres'
     AND NULLIF(current_setting('request.jwt.claims', true), '') IS NULL
     AND NULLIF(current_setting('request.jwt.claim.role', true), '') IS NULL
     AND auth.role() IS NULL THEN
    RETURN NULL;
  END IF;

  RAISE EXCEPTION 'PRODUCTION_WRITE_FENCE_ENABLED'
    USING ERRCODE = '25006',
          DETAIL = format('operation=%s relation=%I.%I', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME),
          HINT = 'Retry only after the production release fence has been explicitly released.';
END
$function$;

ALTER FUNCTION public.production_write_fence_guard_20260717() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.production_write_fence_guard_20260717()
  FROM PUBLIC, anon, authenticated, service_role;

-- This temporary, hash-pinned function is the single canonical schema capture
-- used by both the encrypted post-expand backup and the atomic finalizer. It
-- intentionally excludes relation OIDs so a semantically identical schema has
-- one digest, while ordered catalog fields make any reviewed schema drift
-- change the result.
CREATE FUNCTION public.production_live_schema_contract_20260717()
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
WITH target_table_names(name) AS (
  VALUES
    ('account_deletion_jobs'::text),
    ('account_deletion_media_manifest'::text),
    ('ai_interactions_log'::text),
    ('amora_actions'::text),
    ('amora_care_deliveries'::text),
    ('amora_care_jobs'::text),
    ('amora_care_scan_states'::text),
    ('amora_chat_request_claims'::text),
    ('amora_conflict_check_claims'::text),
    ('amora_couple_profiles'::text),
    ('amora_mediation_acceptances'::text),
    ('amora_memory_consents'::text),
    ('amora_memory_jobs'::text),
    ('amora_memory_settings'::text),
    ('amora_tool_executions'::text),
    ('amora_turn_counters'::text),
    ('amora_turn_requests'::text),
    ('booking_projection_jobs'::text),
    ('chat_feedback'::text),
    ('chat_messages'::text),
    ('chat_summaries'::text),
    ('community_upload_sessions'::text),
    ('couples'::text),
    ('decision_nodes'::text),
    ('profiles'::text),
    ('vendor_reviews'::text),
    ('wedding_journeys'::text)
),
target_relations AS MATERIALIZED (
  SELECT
    relation.oid,
    relation.relname,
    relation.relkind,
    relation.relpersistence,
    relation.relreplident,
    relation.relispartition,
    relation.reloptions,
    relation.relrowsecurity,
    relation.relforcerowsecurity,
    relation.relowner,
    relation.relacl
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relkind IN ('r', 'p')
    AND relation.relname IN (
      SELECT target.name FROM target_table_names AS target
    )
),
public_functions AS MATERIALIZED (
  SELECT function_definition.*
  FROM pg_catalog.pg_proc AS function_definition
  JOIN pg_catalog.pg_namespace AS function_schema
    ON function_schema.oid = function_definition.pronamespace
  WHERE function_schema.nspname = 'public'
    AND function_definition.prokind IN ('f', 'p')
),
referenced_type_oids AS MATERIALIZED (
  SELECT DISTINCT attribute.atttypid AS oid
  FROM target_relations AS relation
  JOIN pg_catalog.pg_attribute AS attribute
    ON attribute.attrelid = relation.oid
   AND attribute.attnum > 0
   AND NOT attribute.attisdropped
  UNION
  SELECT function_definition.prorettype
  FROM public_functions AS function_definition
  UNION
  SELECT argument_type.oid
  FROM public_functions AS function_definition
  CROSS JOIN LATERAL pg_catalog.unnest(
    COALESCE(
      function_definition.proallargtypes,
      function_definition.proargtypes::oid[]
    )
  ) AS argument_type(oid)
),
schema_contract AS MATERIALIZED (
  SELECT pg_catalog.jsonb_build_object(
    'contract_version', 'amora-post-expand-live-schema-v1',
    'server_version_num', pg_catalog.current_setting('server_version_num'),
    'public_schema_acl', (
      SELECT pg_catalog.jsonb_build_object(
        'owner', pg_catalog.pg_get_userbyid(namespace.nspowner),
        'acl', namespace.nspacl
      )
      FROM pg_catalog.pg_namespace AS namespace
      WHERE namespace.nspname = 'public'
    ),
    'default_acl', COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'owner', pg_catalog.pg_get_userbyid(default_acl.defaclrole),
          'schema', CASE
            WHEN default_acl.defaclnamespace = 0 THEN NULL
            ELSE namespace.nspname
          END,
          'object_type', default_acl.defaclobjtype,
          'acl', default_acl.defaclacl
        ) ORDER BY
          pg_catalog.pg_get_userbyid(default_acl.defaclrole),
          COALESCE(namespace.nspname, ''),
          default_acl.defaclobjtype
      )
      FROM pg_catalog.pg_default_acl AS default_acl
      LEFT JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = default_acl.defaclnamespace
      WHERE default_acl.defaclnamespace = 0
         OR namespace.nspname = 'public'
    ), '[]'::jsonb),
    'migration_versions', COALESCE((
      SELECT pg_catalog.jsonb_agg(
        migration.version::text ORDER BY migration.version::text
      )
      FROM supabase_migrations.schema_migrations AS migration
    ), '[]'::jsonb),
    'tables', COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'name', relation.relname,
          'relkind', relation.relkind::text,
          'persistence', relation.relpersistence,
          'replica_identity', relation.relreplident,
          'is_partition', relation.relispartition,
          'options', relation.reloptions,
          'has_inheritance_children', EXISTS (
            SELECT 1
            FROM pg_catalog.pg_inherits AS child
            WHERE child.inhparent = relation.oid
          ),
          'is_inheritance_child', EXISTS (
            SELECT 1
            FROM pg_catalog.pg_inherits AS parent
            WHERE parent.inhrelid = relation.oid
          ),
          'rls', relation.relrowsecurity,
          'force_rls', relation.relforcerowsecurity,
          'owner', pg_catalog.pg_get_userbyid(relation.relowner),
          'acl', relation.relacl
        ) ORDER BY relation.relname
      )
      FROM target_relations AS relation
    ), '[]'::jsonb),
    'columns', COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'table', relation.relname,
          'ordinal_position', attribute.attnum,
          'name', attribute.attname,
          'formatted_type', pg_catalog.format_type(
            attribute.atttypid,
            attribute.atttypmod
          ),
          'not_null', attribute.attnotnull,
          'identity', attribute.attidentity,
          'generated', attribute.attgenerated,
          'acl', attribute.attacl,
          'collation', CASE
            WHEN attribute.attcollation = 0 THEN NULL
            ELSE attribute.attcollation::regcollation::text
          END,
          'default', pg_catalog.pg_get_expr(
            default_definition.adbin,
            default_definition.adrelid,
            true
          )
        ) ORDER BY relation.relname, attribute.attnum
      )
      FROM target_relations AS relation
      JOIN pg_catalog.pg_attribute AS attribute
        ON attribute.attrelid = relation.oid
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
      LEFT JOIN pg_catalog.pg_attrdef AS default_definition
        ON default_definition.adrelid = attribute.attrelid
       AND default_definition.adnum = attribute.attnum
    ), '[]'::jsonb),
    'constraints', COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'table', relation.relname,
          'name', constraint_definition.conname,
          'type', constraint_definition.contype,
          'validated', constraint_definition.convalidated,
          'definition', pg_catalog.pg_get_constraintdef(
            constraint_definition.oid,
            true
          ),
          'columns', COALESCE((
            SELECT pg_catalog.jsonb_agg(
              attribute.attname ORDER BY key_column.ordinality
            )
            FROM pg_catalog.unnest(constraint_definition.conkey)
              WITH ORDINALITY AS key_column(attnum, ordinality)
            JOIN pg_catalog.pg_attribute AS attribute
              ON attribute.attrelid = constraint_definition.conrelid
             AND attribute.attnum = key_column.attnum
          ), '[]'::jsonb),
          'referenced_table', CASE
            WHEN constraint_definition.confrelid <> 0
              THEN constraint_definition.confrelid::regclass::text
            ELSE NULL
          END,
          'referenced_columns', COALESCE((
            SELECT pg_catalog.jsonb_agg(
              attribute.attname ORDER BY key_column.ordinality
            )
            FROM pg_catalog.unnest(constraint_definition.confkey)
              WITH ORDINALITY AS key_column(attnum, ordinality)
            JOIN pg_catalog.pg_attribute AS attribute
              ON attribute.attrelid = constraint_definition.confrelid
             AND attribute.attnum = key_column.attnum
          ), '[]'::jsonb)
        ) ORDER BY relation.relname, constraint_definition.conname
      )
      FROM pg_catalog.pg_constraint AS constraint_definition
      JOIN target_relations AS relation
        ON relation.oid = constraint_definition.conrelid
    ), '[]'::jsonb),
    'indexes', COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'table', relation.relname,
          'name', index_relation.relname,
          'definition', pg_catalog.pg_get_indexdef(index_relation.oid),
          'owner', pg_catalog.pg_get_userbyid(index_relation.relowner),
          'acl', index_relation.relacl,
          'valid', index_definition.indisvalid,
          'ready', index_definition.indisready,
          'unique', index_definition.indisunique,
          'primary', index_definition.indisprimary,
          'exclusion', index_definition.indisexclusion
        ) ORDER BY relation.relname, index_relation.relname
      )
      FROM pg_catalog.pg_index AS index_definition
      JOIN pg_catalog.pg_class AS index_relation
        ON index_relation.oid = index_definition.indexrelid
      JOIN target_relations AS relation
        ON relation.oid = index_definition.indrelid
    ), '[]'::jsonb),
    'policies', COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(policy_definition)
        ORDER BY policy_definition.tablename, policy_definition.policyname
      )
      FROM pg_catalog.pg_policies AS policy_definition
      WHERE policy_definition.schemaname = 'public'
        AND policy_definition.tablename IN (
          SELECT target.name FROM target_table_names AS target
        )
    ), '[]'::jsonb),
    'triggers', COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'table', relation.relname,
          'name', trigger_definition.tgname,
          'enabled', trigger_definition.tgenabled,
          'type_bits', trigger_definition.tgtype,
          'function_identity',
            trigger_definition.tgfoid::regprocedure::text,
          'definition', pg_catalog.pg_get_triggerdef(
            trigger_definition.oid,
            true
          )
        ) ORDER BY relation.relname, trigger_definition.tgname
      )
      FROM pg_catalog.pg_trigger AS trigger_definition
      JOIN target_relations AS relation
        ON relation.oid = trigger_definition.tgrelid
      WHERE NOT trigger_definition.tgisinternal
    ), '[]'::jsonb),
    'event_triggers', COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'name', event_trigger.evtname,
          'event', event_trigger.evtevent,
          'owner', pg_catalog.pg_get_userbyid(event_trigger.evtowner),
          'function_identity', event_trigger.evtfoid::regprocedure::text,
          'enabled', event_trigger.evtenabled,
          'tags', event_trigger.evttags
        ) ORDER BY event_trigger.evtname
      )
      FROM pg_catalog.pg_event_trigger AS event_trigger
    ), '[]'::jsonb),
    'external_triggers', COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'schema', relation_schema.nspname,
          'table', relation.relname,
          'name', trigger_definition.tgname,
          'enabled', trigger_definition.tgenabled,
          'type_bits', trigger_definition.tgtype,
          'function_identity',
            trigger_definition.tgfoid::regprocedure::text,
          'definition', pg_catalog.pg_get_triggerdef(
            trigger_definition.oid,
            true
          )
        ) ORDER BY
          relation_schema.nspname,
          relation.relname,
          trigger_definition.tgname
      )
      FROM pg_catalog.pg_trigger AS trigger_definition
      JOIN pg_catalog.pg_class AS relation
        ON relation.oid = trigger_definition.tgrelid
      JOIN pg_catalog.pg_namespace AS relation_schema
        ON relation_schema.oid = relation.relnamespace
      JOIN public_functions AS function_definition
        ON function_definition.oid = trigger_definition.tgfoid
      WHERE NOT trigger_definition.tgisinternal
        AND NOT EXISTS (
          SELECT 1
          FROM target_relations AS target
          WHERE target.oid = relation.oid
        )
    ), '[]'::jsonb),
    'owned_sequences', COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'schema', sequence_schema.nspname,
          'name', sequence_relation.relname,
          'owner_table', table_relation.relname,
          'owner_column', table_attribute.attname,
          'owner', pg_catalog.pg_get_userbyid(sequence_relation.relowner),
          'acl', sequence_relation.relacl,
          'data_type', sequence_info.data_type,
          'start_value', sequence_info.start_value,
          'min_value', sequence_info.min_value,
          'max_value', sequence_info.max_value,
          'increment_by', sequence_info.increment_by,
          'cycle', sequence_info.cycle,
          'cache_size', sequence_info.cache_size
        ) ORDER BY sequence_schema.nspname, sequence_relation.relname
      )
      FROM pg_catalog.pg_class AS sequence_relation
      JOIN pg_catalog.pg_namespace AS sequence_schema
        ON sequence_schema.oid = sequence_relation.relnamespace
      JOIN pg_catalog.pg_depend AS ownership
        ON ownership.classid = 'pg_catalog.pg_class'::regclass
       AND ownership.objid = sequence_relation.oid
       AND ownership.refclassid = 'pg_catalog.pg_class'::regclass
       AND ownership.deptype IN ('a', 'i')
      JOIN target_relations AS table_relation
        ON table_relation.oid = ownership.refobjid
      JOIN pg_catalog.pg_attribute AS table_attribute
        ON table_attribute.attrelid = table_relation.oid
       AND table_attribute.attnum = ownership.refobjsubid
      JOIN pg_catalog.pg_sequences AS sequence_info
        ON sequence_info.schemaname = sequence_schema.nspname
       AND sequence_info.sequencename = sequence_relation.relname
      WHERE sequence_relation.relkind = 'S'
    ), '[]'::jsonb),
    'types', COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'schema', type_schema.nspname,
          'name', type_definition.typname,
          'kind', type_definition.typtype,
          'category', type_definition.typcategory,
          'owner', pg_catalog.pg_get_userbyid(type_definition.typowner),
          'acl', type_definition.typacl,
          'not_null', type_definition.typnotnull,
          'base_type', CASE
            WHEN type_definition.typbasetype = 0 THEN NULL
            ELSE type_definition.typbasetype::regtype::text
          END,
          'default', type_definition.typdefault,
          'collation', CASE
            WHEN type_definition.typcollation = 0 THEN NULL
            ELSE type_definition.typcollation::regcollation::text
          END,
          'enum_labels', COALESCE((
            SELECT pg_catalog.jsonb_agg(
              enum_definition.enumlabel
              ORDER BY enum_definition.enumsortorder
            )
            FROM pg_catalog.pg_enum AS enum_definition
            WHERE enum_definition.enumtypid = type_definition.oid
          ), '[]'::jsonb),
          'domain_constraints', COALESCE((
            SELECT pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_object(
                'name', constraint_definition.conname,
                'validated', constraint_definition.convalidated,
                'definition', pg_catalog.pg_get_constraintdef(
                  constraint_definition.oid,
                  true
                )
              ) ORDER BY constraint_definition.conname
            )
            FROM pg_catalog.pg_constraint AS constraint_definition
            WHERE constraint_definition.contypid = type_definition.oid
          ), '[]'::jsonb)
        ) ORDER BY type_schema.nspname, type_definition.typname
      )
      FROM pg_catalog.pg_type AS type_definition
      JOIN pg_catalog.pg_namespace AS type_schema
        ON type_schema.oid = type_definition.typnamespace
      JOIN referenced_type_oids AS referenced_type
        ON referenced_type.oid = type_definition.oid
    ), '[]'::jsonb),
    'functions', COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'identity', function_definition.oid::regprocedure::text,
          'kind', function_definition.prokind,
          'result', pg_catalog.pg_get_function_result(
            function_definition.oid
          ),
          'language', language_definition.lanname,
          'owner', pg_catalog.pg_get_userbyid(
            function_definition.proowner
          ),
          'definition', pg_catalog.pg_get_functiondef(
            function_definition.oid
          ),
          'acl', function_definition.proacl,
          'security_definer', function_definition.prosecdef,
          'config', function_definition.proconfig,
          'volatility', function_definition.provolatile,
          'parallel', function_definition.proparallel,
          'strict', function_definition.proisstrict,
          'leakproof', function_definition.proleakproof
        ) ORDER BY function_definition.oid::regprocedure::text
      )
      FROM public_functions AS function_definition
      JOIN pg_catalog.pg_language AS language_definition
        ON language_definition.oid = function_definition.prolang
    ), '[]'::jsonb)
  ) AS contract
)
SELECT pg_catalog.encode(
  pg_catalog.sha256(pg_catalog.convert_to(contract::text, 'UTF8')),
  'hex'
)
FROM schema_contract
WHERE pg_catalog.jsonb_array_length(contract -> 'tables') = 27
$function$;

ALTER FUNCTION public.production_live_schema_contract_20260717()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.production_live_schema_contract_20260717()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.production_release_lease_20260717 (
  singleton boolean NOT NULL DEFAULT true,
  release_id text NOT NULL,
  release_commit text NOT NULL,
  owner_id uuid NOT NULL,
  outcome_path_sha256 text NOT NULL,
  phase text NOT NULL DEFAULT 'claimed',
  claimed_at timestamp with time zone NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamp with time zone NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT production_release_lease_20260717_pkey PRIMARY KEY (singleton),
  CONSTRAINT production_release_lease_20260717_singleton_true
    CHECK (singleton),
  CONSTRAINT production_release_lease_20260717_release_id_format
    CHECK (release_id ~ '^[a-z0-9][a-z0-9-]{2,80}$'),
  CONSTRAINT production_release_lease_20260717_commit_format
    CHECK (release_commit ~ '^[a-f0-9]{40}$'),
  CONSTRAINT production_release_lease_20260717_outcome_hash_format
    CHECK (outcome_path_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT production_release_lease_20260717_phase
    CHECK (phase IN ('claimed', 'awaiting-post-push', 'deployment-canary')),
  CONSTRAINT production_release_lease_20260717_time_order
    CHECK (updated_at >= claimed_at)
);

ALTER TABLE public.production_release_lease_20260717 OWNER TO postgres;
REVOKE ALL ON TABLE public.production_release_lease_20260717
  FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE public.production_release_lease_20260717 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_release_lease_20260717 FORCE ROW LEVEL SECURITY;

DO $install_current_table_triggers$
DECLARE
  relation_record record;
BEGIN
  FOR relation_record IN
    SELECT relation.oid::regclass AS relation_name
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
    ORDER BY relation.oid
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_production_write_fence_20260717 '
      'BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON %s '
      'FOR EACH STATEMENT EXECUTE FUNCTION public.production_write_fence_guard_20260717()',
      relation_record.relation_name
    );
  END LOOP;
END
$install_current_table_triggers$;

CREATE FUNCTION public.production_write_fence_attach_20260717()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  command_record record;
  target_relation regclass;
BEGIN
  -- Every DDL command that can change the captured live-schema contract takes
  -- the shared side of this transaction-scoped lock. The finalizer takes the
  -- exclusive side before it captures and compares the contract, so no DDL
  -- transaction can commit between validation and atomic fence removal.
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(7523370826071712::bigint);

  IF TG_EVENT = 'ddl_command_start' THEN
    RETURN;
  ELSIF TG_EVENT <> 'ddl_command_end' THEN
    RAISE EXCEPTION 'PRODUCTION_WRITE_FENCE_UNEXPECTED_DDL_EVENT';
  END IF;

  FOR command_record IN
    SELECT command.objid
    FROM pg_event_trigger_ddl_commands() AS command
    WHERE command.schema_name = 'public'
      AND command.object_type IN ('table', 'partitioned table')
  LOOP
    SELECT relation.oid::regclass
    INTO target_relation
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE relation.oid = command_record.objid
      AND namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p');

    IF target_relation IS NOT NULL THEN
      EXECUTE format(
        'DROP TRIGGER IF EXISTS trg_production_write_fence_20260717 ON %s',
        target_relation
      );
      EXECUTE format(
        'CREATE TRIGGER trg_production_write_fence_20260717 '
        'BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON %s '
        'FOR EACH STATEMENT EXECUTE FUNCTION public.production_write_fence_guard_20260717()',
        target_relation
      );
    END IF;
  END LOOP;
END
$function$;

ALTER FUNCTION public.production_write_fence_attach_20260717() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.production_write_fence_attach_20260717()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE EVENT TRIGGER evt_production_write_fence_ddl_lock_20260717
  ON ddl_command_start
  EXECUTE FUNCTION public.production_write_fence_attach_20260717();
ALTER EVENT TRIGGER evt_production_write_fence_ddl_lock_20260717
  OWNER TO postgres;

CREATE EVENT TRIGGER evt_production_write_fence_20260717
  ON ddl_command_end
  EXECUTE FUNCTION public.production_write_fence_attach_20260717();
ALTER EVENT TRIGGER evt_production_write_fence_20260717 OWNER TO postgres;

DO $postcondition$
DECLARE
  public_table_count bigint;
  exact_trigger_count bigint;
  active_cron_jobs bigint := 0;
BEGIN
  SELECT count(*) INTO public_table_count
  FROM pg_class AS relation
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relkind IN ('r', 'p');

  SELECT count(*) INTO exact_trigger_count
  FROM pg_trigger AS trigger_record
  JOIN pg_class AS relation ON relation.oid = trigger_record.tgrelid
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relkind IN ('r', 'p')
    AND trigger_record.tgname = 'trg_production_write_fence_20260717'
    AND NOT trigger_record.tgisinternal
    AND trigger_record.tgenabled = 'O'
    AND trigger_record.tgtype = 62
    AND trigger_record.tgfoid =
      'public.production_write_fence_guard_20260717()'::regprocedure;

  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM cron.job WHERE active' INTO active_cron_jobs;
  END IF;

  IF public_table_count = 0
     OR exact_trigger_count <> public_table_count
     OR active_cron_jobs <> 0
     OR (SELECT count(*) FROM public.production_release_lease_20260717) <> 0
     OR (SELECT count(*)
         FROM pg_policy
         WHERE polrelid = 'public.production_release_lease_20260717'::regclass) <> 0
     OR NOT EXISTS (
       SELECT 1
       FROM pg_class
       WHERE oid = 'public.production_release_lease_20260717'::regclass
         AND relkind = 'r'
         AND relrowsecurity
         AND relforcerowsecurity
         AND pg_get_userbyid(relowner) = 'postgres'
     )
     OR has_table_privilege('anon',
       'public.production_release_lease_20260717', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
     OR has_table_privilege('authenticated',
       'public.production_release_lease_20260717', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
     OR has_table_privilege('service_role',
       'public.production_release_lease_20260717', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
     OR (SELECT count(*)
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'production_release_lease_20260717') <> 8
     OR (SELECT array_agg(conname ORDER BY conname)
         FROM pg_constraint
         WHERE conrelid = 'public.production_release_lease_20260717'::regclass
           AND contype IN ('p', 'c'))
       IS DISTINCT FROM ARRAY[
         'production_release_lease_20260717_commit_format',
         'production_release_lease_20260717_outcome_hash_format',
         'production_release_lease_20260717_phase',
         'production_release_lease_20260717_pkey',
         'production_release_lease_20260717_release_id_format',
         'production_release_lease_20260717_singleton_true',
         'production_release_lease_20260717_time_order'
       ]::name[]
     OR NOT EXISTS (
       SELECT 1
       FROM pg_event_trigger
       WHERE evtname = 'evt_production_write_fence_20260717'
         AND evtevent = 'ddl_command_end'
         AND evtenabled = 'O'
         AND evtfoid = 'public.production_write_fence_attach_20260717()'::regprocedure
         AND pg_get_userbyid(evtowner) = 'postgres'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_event_trigger
       WHERE evtname = 'evt_production_write_fence_ddl_lock_20260717'
         AND evtevent = 'ddl_command_start'
         AND evtenabled = 'O'
         AND evtfoid = 'public.production_write_fence_attach_20260717()'::regprocedure
         AND pg_get_userbyid(evtowner) = 'postgres'
     )
     OR (SELECT count(*)
           FROM pg_event_trigger
          WHERE evtfoid =
            'public.production_write_fence_attach_20260717()'::regprocedure) <> 2
     OR (SELECT count(*)
           FROM pg_event_trigger
          WHERE evtname IN (
            'evt_production_write_fence_ddl_lock_20260717',
            'evt_production_write_fence_20260717'
          )) <> 2
  THEN
    RAISE EXCEPTION 'PRODUCTION_WRITE_FENCE_POSTCONDITION_FAILED';
  END IF;
END
$postcondition$;

COMMIT;
