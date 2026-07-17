begin transaction read only;
set local statement_timeout = '120s';
set local lock_timeout = '5s';
set local row_security = off;

with target_table_names(name) as (
  values
    ('ai_interactions_log'::text),
    ('amora_actions'::text),
    ('amora_chat_request_claims'::text),
    ('amora_couple_profiles'::text),
    ('amora_tool_executions'::text),
    ('amora_turn_counters'::text),
    ('chat_feedback'::text),
    ('chat_messages'::text),
    ('chat_summaries'::text),
    ('couples'::text),
    ('decision_nodes'::text),
    ('profiles'::text),
    ('vendor_reviews'::text),
    ('wedding_journeys'::text)
),
target_relations as materialized (
  select relation.oid, relation.relname
  from pg_class as relation
  join pg_namespace as relation_schema on relation_schema.oid = relation.relnamespace
  where relation_schema.nspname = 'public'
    and relation.relkind = 'r'
    and relation.relname in (
      select target.name from target_table_names as target
    )
),
dependent_functions as materialized (
  select distinct function_definition.oid
  from pg_proc as function_definition
  join pg_namespace as function_schema on function_schema.oid = function_definition.pronamespace
  where function_schema.nspname = 'public'
    and (
      exists (
        select 1
        from pg_trigger as trigger_definition
        join target_relations as target on target.oid = trigger_definition.tgrelid
        where not trigger_definition.tgisinternal
          and trigger_definition.tgfoid = function_definition.oid
      )
      or exists (
        select 1
        from pg_depend as dependency
        join pg_policy as policy_definition
          on dependency.classid = 'pg_policy'::regclass
         and dependency.objid = policy_definition.oid
        join target_relations as target on target.oid = policy_definition.polrelid
        where dependency.refclassid = 'pg_proc'::regclass
          and dependency.refobjid = function_definition.oid
      )
    )
),
schema_contract as materialized (
  select jsonb_build_object(
    'database_name', current_database(),
    'server_version_num', current_setting('server_version_num'),
    'migration_history', coalesce((
      select jsonb_agg(
        jsonb_build_object('version', migration.version, 'name', migration.name)
        order by migration.version
      )
      from supabase_migrations.schema_migrations as migration
    ), '[]'::jsonb),
    'tables', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', relation.relname,
        'relation_oid', relation.oid::text,
        'relkind', relation.relkind::text,
        'has_inheritance_children', exists (
          select 1 from pg_inherits as child where child.inhparent = relation.oid
        ),
        'is_inheritance_child', exists (
          select 1 from pg_inherits as parent where parent.inhrelid = relation.oid
        ),
        'rls', relation.relrowsecurity,
        'force_rls', relation.relforcerowsecurity,
        'owner', pg_get_userbyid(relation.relowner),
        'acl', relation.relacl
      ) order by relation.relname)
      from pg_class as relation
      join pg_namespace as relation_schema on relation_schema.oid = relation.relnamespace
      where relation_schema.nspname = 'public'
        and relation.relkind = 'r'
        and relation.relname in (
          select target.name from target_table_names as target
        )
    ), '[]'::jsonb),
    'columns', coalesce((
      select jsonb_agg(to_jsonb(column_contract) order by column_contract.table_name, column_contract.ordinal_position)
      from (
        select
          column_info.table_name,
          column_info.ordinal_position,
          column_info.column_name,
          column_info.data_type,
          column_info.udt_schema,
          column_info.udt_name,
          attribute.atttypmod as type_modifier,
          format_type(attribute.atttypid, attribute.atttypmod) as formatted_type,
          column_info.character_maximum_length,
          column_info.numeric_precision,
          column_info.numeric_scale,
          column_info.datetime_precision,
          column_info.domain_schema,
          column_info.domain_name,
          column_info.collation_schema,
          column_info.collation_name,
          column_info.is_nullable,
          column_info.column_default,
          column_info.is_identity,
          column_info.identity_generation,
          column_info.is_generated,
          column_info.generation_expression
        from information_schema.columns as column_info
        join pg_namespace as table_schema on table_schema.nspname = column_info.table_schema
        join pg_class as table_relation
          on table_relation.relnamespace = table_schema.oid
         and table_relation.relname = column_info.table_name
         and table_relation.relkind = 'r'
        join pg_attribute as attribute
          on attribute.attrelid = table_relation.oid
         and attribute.attname = column_info.column_name
         and attribute.attnum = column_info.ordinal_position
         and attribute.attnum > 0
         and not attribute.attisdropped
        where column_info.table_schema = 'public'
          and column_info.table_name in (
            select target.name from target_table_names as target
          )
      ) as column_contract
    ), '[]'::jsonb),
    'constraints', coalesce((
      select jsonb_agg(jsonb_build_object(
        'table', relation.relname,
        'name', constraint_definition.conname,
        'type', constraint_definition.contype,
        'validated', constraint_definition.convalidated,
        'definition', pg_get_constraintdef(constraint_definition.oid, true),
        'columns', coalesce((
          select jsonb_agg(attribute.attname order by key_column.ordinality)
          from unnest(constraint_definition.conkey)
            with ordinality as key_column(attnum, ordinality)
          join pg_attribute as attribute
            on attribute.attrelid = constraint_definition.conrelid
           and attribute.attnum = key_column.attnum
        ), '[]'::jsonb),
        'referenced_table', case
          when constraint_definition.confrelid <> 0
            then constraint_definition.confrelid::regclass::text
          else null
        end,
        'referenced_columns', coalesce((
          select jsonb_agg(attribute.attname order by key_column.ordinality)
          from unnest(constraint_definition.confkey)
            with ordinality as key_column(attnum, ordinality)
          join pg_attribute as attribute
            on attribute.attrelid = constraint_definition.confrelid
           and attribute.attnum = key_column.attnum
        ), '[]'::jsonb)
      ) order by relation.relname, constraint_definition.conname)
      from pg_constraint as constraint_definition
      join pg_class as relation on relation.oid = constraint_definition.conrelid
      join pg_namespace as relation_schema on relation_schema.oid = relation.relnamespace
      where relation_schema.nspname = 'public'
        and relation.relname in (
          select target.name from target_table_names as target
        )
    ), '[]'::jsonb),
    'indexes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'table', table_relation.relname,
        'name', index_relation.relname,
        'definition', pg_get_indexdef(index_relation.oid)
      ) order by table_relation.relname, index_relation.relname)
      from pg_index as index_definition
      join pg_class as index_relation on index_relation.oid = index_definition.indexrelid
      join pg_class as table_relation on table_relation.oid = index_definition.indrelid
      join pg_namespace as table_schema on table_schema.oid = table_relation.relnamespace
      where table_schema.nspname = 'public'
        and table_relation.relname in (
          select target.name from target_table_names as target
        )
    ), '[]'::jsonb),
    'policies', coalesce((
      select jsonb_agg(to_jsonb(policy_definition) order by policy_definition.tablename, policy_definition.policyname)
      from pg_policies as policy_definition
      where policy_definition.schemaname = 'public'
        and policy_definition.tablename in (
          select target.name from target_table_names as target
        )
    ), '[]'::jsonb),
    'triggers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'table', relation.relname,
        'name', trigger_definition.tgname,
        'enabled', trigger_definition.tgenabled,
        'function_identity', trigger_definition.tgfoid::regprocedure::text,
        'definition', pg_get_triggerdef(trigger_definition.oid, true)
      ) order by relation.relname, trigger_definition.tgname)
      from pg_trigger as trigger_definition
      join pg_class as relation on relation.oid = trigger_definition.tgrelid
      join pg_namespace as relation_schema on relation_schema.oid = relation.relnamespace
      where not trigger_definition.tgisinternal
        and relation_schema.nspname = 'public'
        and relation.relname in (
          select target.name from target_table_names as target
        )
    ), '[]'::jsonb),
    'dependent_functions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'identity', function_definition.oid::regprocedure::text,
        'owner', pg_get_userbyid(function_definition.proowner),
        'definition', pg_get_functiondef(function_definition.oid),
        'acl', function_definition.proacl,
        'security_definer', function_definition.prosecdef,
        'config', function_definition.proconfig
      ) order by function_definition.oid::regprocedure::text)
      from pg_proc as function_definition
      join dependent_functions as dependency on dependency.oid = function_definition.oid
    ), '[]'::jsonb),
    'owned_sequences', coalesce((
      select jsonb_agg(jsonb_build_object(
        'schema', sequence_info.schemaname,
        'name', sequence_info.sequencename,
        'owner_table', table_relation.relname,
        'owner_column', table_attribute.attname,
        'data_type', sequence_info.data_type,
        'start_value', sequence_info.start_value,
        'min_value', sequence_info.min_value,
        'max_value', sequence_info.max_value,
        'increment_by', sequence_info.increment_by,
        'cycle', sequence_info.cycle,
        'cache_size', sequence_info.cache_size,
        'last_value', sequence_info.last_value
      ) order by sequence_info.schemaname, sequence_info.sequencename)
      from pg_class as sequence_relation
      join pg_namespace as sequence_schema on sequence_schema.oid = sequence_relation.relnamespace
      join pg_depend as ownership
        on ownership.classid = 'pg_class'::regclass
       and ownership.objid = sequence_relation.oid
       and ownership.refclassid = 'pg_class'::regclass
       and ownership.deptype in ('a', 'i')
      join pg_class as table_relation on table_relation.oid = ownership.refobjid
      join pg_namespace as table_schema on table_schema.oid = table_relation.relnamespace
      join pg_attribute as table_attribute
        on table_attribute.attrelid = table_relation.oid
       and table_attribute.attnum = ownership.refobjsubid
      join pg_sequences as sequence_info
        on sequence_info.schemaname = sequence_schema.nspname
       and sequence_info.sequencename = sequence_relation.relname
      where sequence_relation.relkind = 'S'
        and table_schema.nspname = 'public'
        and table_relation.relname in (
          select target.name from target_table_names as target
        )
    ), '[]'::jsonb)
  ) as contract
),
inventory as materialized (
  select jsonb_build_object(
    'captured_at', clock_timestamp(),
    'source_project_ref', current_setting('app.settings.project_ref', true),
    'current_user', current_user,
    'session_user', session_user,
    'current_role_bypasses_rls', exists (
      select 1 from pg_roles
      where rolname = current_user and (rolsuper or rolbypassrls)
    ),
    'row_security', current_setting('row_security'),
    'transaction_read_only', current_setting('transaction_read_only'),
    'schema_contract_sha256', encode(sha256(convert_to(contract::text, 'UTF8')), 'hex'),
    'schema_contract', contract
  ) as payload
  from schema_contract
)
select
  case
    when jsonb_array_length(payload #> '{schema_contract,tables}') = 14
     and (payload ->> 'current_role_bypasses_rls')::boolean
     and payload ->> 'row_security' = 'off'
     and payload ->> 'transaction_read_only' = 'on'
     and pg_column_size(payload) <= 16777216
    then payload::text
    else null
  end as payload,
  pg_column_size(payload)::bigint as payload_bytes
from inventory;

commit;
