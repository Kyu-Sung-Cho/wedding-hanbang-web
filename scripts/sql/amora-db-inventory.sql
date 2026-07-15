begin transaction read only;
set local statement_timeout = '120s';
set local lock_timeout = '5s';
set local row_security = off;

with target_table_names(name) as (
  values
    ('chat_messages'::text),
    ('chat_summaries'::text),
    ('decision_nodes'::text),
    ('ai_interactions_log'::text),
    ('amora_turn_counters'::text),
    ('amora_couple_profiles'::text),
    ('amora_mediation_acceptances'::text),
    ('amora_memory_consents'::text),
    ('amora_memory_jobs'::text),
    ('amora_memory_settings'::text),
    ('amora_actions'::text),
    ('wedding_journeys'::text),
    ('profiles'::text),
    ('couples'::text),
    ('chat_feedback'::text)
),
included_functions as materialized (
  select p.*
  from pg_proc as p
  join pg_namespace as n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (
      p.proname in (
        'reserve_amora_turn',
        'apply_journey_progress_patch',
        'join_couple',
        'generate_invite_code',
        'redact_old_ai_interactions',
        'create_profile_on_signup',
        'set_updated_at',
        'update_updated_at_column',
        'is_couple_member',
        'can_read_profile',
        'set_amora_action_status_timestamps',
        'enqueue_amora_memory_job',
        'claim_amora_memory_job',
        'finish_amora_memory_job',
        'upsert_amora_memory_node',
        'update_amora_memory_node',
        'delete_amora_memory_node',
        'insert_amora_memory_summary',
        'accept_amora_mediation',
        'insert_amora_care_message',
        'set_amora_memory_consent',
        'clear_amora_memory_scope'
      )
      or exists (
        select 1
        from pg_trigger as dependency_trigger
        join pg_class as dependency_table
          on dependency_table.oid = dependency_trigger.tgrelid
        join pg_namespace as dependency_schema
          on dependency_schema.oid = dependency_table.relnamespace
        where not dependency_trigger.tgisinternal
          and dependency_trigger.tgfoid = p.oid
          and dependency_schema.nspname = 'public'
          and dependency_table.relname in (
            select target_table.name from target_table_names as target_table
          )
      )
      or exists (
        select 1
        from pg_depend as dependency
        join pg_policy as dependency_policy
          on dependency.classid = 'pg_policy'::regclass
         and dependency.objid = dependency_policy.oid
        join pg_class as dependency_table
          on dependency_table.oid = dependency_policy.polrelid
        join pg_namespace as dependency_schema
          on dependency_schema.oid = dependency_table.relnamespace
        where dependency.refclassid = 'pg_proc'::regclass
          and dependency.refobjid = p.oid
          and dependency_schema.nspname = 'public'
          and dependency_table.relname in (
            select target_table.name from target_table_names as target_table
          )
      )
    )
),
inventory as materialized (
  select jsonb_build_object(
    'captured_at', now(),
    'source_project_ref', current_setting('app.settings.project_ref', true),
    'current_user', current_user,
    'session_user', session_user,
    'current_role_bypasses_rls', exists (
      select 1 from pg_roles
      where rolname = current_user and (rolsuper or rolbypassrls)
    ),
    'row_security', current_setting('row_security'),
    'server_version_num', current_setting('server_version_num'),
    'migration_history', coalesce((
      select jsonb_agg(
        jsonb_build_object('version', m.version, 'name', m.name)
        order by m.version
      )
      from supabase_migrations.schema_migrations as m
    ), '[]'::jsonb),
    'tables', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'name', c.relname,
          'relation_oid', c.oid::text,
          'relkind', c.relkind::text,
          'has_inheritance_children', exists (
            select 1 from pg_inherits as inheritance_children
            where inheritance_children.inhparent = c.oid
          ),
          'is_inheritance_child', exists (
            select 1 from pg_inherits as inheritance_parent
            where inheritance_parent.inhrelid = c.oid
          ),
          'rls', c.relrowsecurity,
          'force_rls', c.relforcerowsecurity,
          'owner', pg_get_userbyid(c.relowner),
          'acl', c.relacl
        )
        order by c.relname
      )
      from pg_class as c
      join pg_namespace as n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind in ('r', 'p')
        and c.relname in (
          select target_table.name from target_table_names as target_table
        )
    ), '[]'::jsonb),
    'columns', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.table_name, x.ordinal_position)
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
          column_info.character_octet_length,
          column_info.numeric_precision,
          column_info.numeric_precision_radix,
          column_info.numeric_scale,
          column_info.datetime_precision,
          column_info.interval_type,
          column_info.interval_precision,
          column_info.domain_schema,
          column_info.domain_name,
          column_info.collation_schema,
          column_info.collation_name,
          column_info.is_nullable,
          column_info.column_default,
          column_info.is_identity,
          column_info.identity_generation,
          column_info.identity_start,
          column_info.identity_increment,
          column_info.identity_maximum,
          column_info.identity_minimum,
          column_info.identity_cycle,
          column_info.is_generated,
          column_info.generation_expression
        from information_schema.columns as column_info
        join pg_namespace as table_schema
          on table_schema.nspname = column_info.table_schema
        join pg_class as table_class
          on table_class.relnamespace = table_schema.oid
         and table_class.relname = column_info.table_name
         and table_class.relkind in ('r', 'p')
        join pg_attribute as attribute
          on attribute.attrelid = table_class.oid
         and attribute.attname = column_info.column_name
         and attribute.attnum = column_info.ordinal_position
         and attribute.attnum > 0
         and not attribute.attisdropped
        where column_info.table_schema = 'public'
          and column_info.table_name in (
            select target_table.name from target_table_names as target_table
          )
      ) as x
    ), '[]'::jsonb),
    'constraints', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'table', c.relname,
          'name', con.conname,
          'type', con.contype,
          'validated', con.convalidated,
          'definition', pg_get_constraintdef(con.oid, true),
          'columns', coalesce((
            select jsonb_agg(a.attname order by key_column.ordinality)
            from unnest(con.conkey) with ordinality as key_column(attnum, ordinality)
            join pg_attribute as a
              on a.attrelid = con.conrelid
             and a.attnum = key_column.attnum
          ), '[]'::jsonb),
          'referenced_table', case
            when con.confrelid <> 0 then con.confrelid::regclass::text
            else null
          end,
          'referenced_columns', coalesce((
            select jsonb_agg(a.attname order by key_column.ordinality)
            from unnest(con.confkey) with ordinality as key_column(attnum, ordinality)
            join pg_attribute as a
              on a.attrelid = con.confrelid
             and a.attnum = key_column.attnum
          ), '[]'::jsonb)
        )
        order by c.relname, con.conname
      )
      from pg_constraint as con
      join pg_class as c on c.oid = con.conrelid
      join pg_namespace as n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in (
          select target_table.name from target_table_names as target_table
        )
    ), '[]'::jsonb),
    'indexes', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'table', t.relname,
          'name', i.relname,
          'definition', pg_get_indexdef(i.oid)
        )
        order by t.relname, i.relname
      )
      from pg_index as ix
      join pg_class as i on i.oid = ix.indexrelid
      join pg_class as t on t.oid = ix.indrelid
      join pg_namespace as n on n.oid = t.relnamespace
      where n.nspname = 'public'
        and t.relname in (
          select target_table.name from target_table_names as target_table
        )
    ), '[]'::jsonb),
    'policies', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.tablename, p.policyname)
      from pg_policies as p
      where p.schemaname = 'public'
        and p.tablename in (
          select target_table.name from target_table_names as target_table
        )
    ), '[]'::jsonb),
    'triggers', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'table', c.relname,
          'name', tg.tgname,
          'enabled', tg.tgenabled,
          'type_bits', tg.tgtype,
          'row_level', (tg.tgtype & 1) = 1,
          'timing', case
            when (tg.tgtype & 64) = 64 then 'INSTEAD OF'
            when (tg.tgtype & 2) = 2 then 'BEFORE'
            else 'AFTER'
          end,
          'fires_insert', (tg.tgtype & 4) = 4,
          'fires_delete', (tg.tgtype & 8) = 8,
          'fires_update', (tg.tgtype & 16) = 16,
          'fires_truncate', (tg.tgtype & 32) = 32,
          'function_identity', tg.tgfoid::regprocedure::text,
          'definition', pg_get_triggerdef(tg.oid, true)
        )
        order by c.relname, tg.tgname
      )
      from pg_trigger as tg
      join pg_class as c on c.oid = tg.tgrelid
      join pg_namespace as n on n.oid = c.relnamespace
      where not tg.tgisinternal
        and n.nspname = 'public'
        and c.relname in (
          select target_table.name from target_table_names as target_table
        )
    ), '[]'::jsonb),
    'functions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'identity', f.oid::regprocedure::text,
          'owner', pg_get_userbyid(f.proowner),
          'definition', pg_get_functiondef(f.oid),
          'acl', f.proacl,
          'security_definer', f.prosecdef,
          'config', f.proconfig
        )
        order by f.oid::regprocedure::text
      )
      from included_functions as f
    ), '[]'::jsonb),
    'external_triggers', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'schema', relation_schema.nspname,
          'table', relation.relname,
          'name', trigger_definition.tgname,
          'enabled', trigger_definition.tgenabled,
          'type_bits', trigger_definition.tgtype,
          'row_level', (trigger_definition.tgtype & 1) = 1,
          'timing', case
            when (trigger_definition.tgtype & 64) = 64 then 'INSTEAD OF'
            when (trigger_definition.tgtype & 2) = 2 then 'BEFORE'
            else 'AFTER'
          end,
          'fires_insert', (trigger_definition.tgtype & 4) = 4,
          'fires_delete', (trigger_definition.tgtype & 8) = 8,
          'fires_update', (trigger_definition.tgtype & 16) = 16,
          'fires_truncate', (trigger_definition.tgtype & 32) = 32,
          'function_identity', function_definition.oid::regprocedure::text,
          'definition', pg_get_triggerdef(trigger_definition.oid, true)
        )
        order by relation_schema.nspname, relation.relname, trigger_definition.tgname
      )
      from pg_trigger as trigger_definition
      join pg_class as relation on relation.oid = trigger_definition.tgrelid
      join pg_namespace as relation_schema on relation_schema.oid = relation.relnamespace
      join included_functions as function_definition
        on function_definition.oid = trigger_definition.tgfoid
      where not trigger_definition.tgisinternal
        and not (
          relation_schema.nspname = 'public'
          and relation.relname in (
            select target_table.name from target_table_names as target_table
          )
        )
    ), '[]'::jsonb)
  ) as payload
)
select
  case when pg_column_size(payload) <= 33554432 then payload::text else null end as payload,
  pg_column_size(payload)::bigint as payload_bytes
from inventory;

commit;
