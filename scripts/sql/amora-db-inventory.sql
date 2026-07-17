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
    ('account_deletion_jobs'::text),
    ('account_deletion_media_manifest'::text),
    ('amora_turn_counters'::text),
    ('amora_chat_request_claims'::text),
    ('amora_tool_executions'::text),
    ('amora_couple_profiles'::text),
    ('amora_care_deliveries'::text),
    ('amora_care_jobs'::text),
    ('amora_care_scan_states'::text),
    ('amora_mediation_acceptances'::text),
    ('amora_memory_consents'::text),
    ('amora_memory_jobs'::text),
    ('amora_memory_settings'::text),
    ('amora_turn_requests'::text),
    ('amora_actions'::text),
    ('booking_projection_jobs'::text),
    ('community_upload_sessions'::text),
    ('wedding_journeys'::text),
    ('profiles'::text),
    ('couples'::text),
    ('amora_conflict_check_claims'::text),
    ('chat_feedback'::text),
    ('vendor_reviews'::text)
),
required_release_migrations(version) as (
  values
    ('20260716090000'::text),
    ('20260716091000'::text),
    ('20260716092000'::text),
    ('20260716093000'::text),
    ('20260716094000'::text),
    ('20260716095000'::text),
    ('20260716096000'::text),
    ('20260716097000'::text),
    ('20260716098000'::text),
    ('20260716099000'::text),
    ('20260716100000'::text),
    ('20260716102000'::text),
    ('20260716103000'::text),
    ('20260716104000'::text),
    ('20260716105000'::text),
    ('20260716106000'::text),
    ('20260716107000'::text),
    ('20260716108000'::text),
    ('20260716109000'::text),
    ('20260716110000'::text),
    ('20260716111000'::text),
    ('20260716112000'::text),
    ('20260716113000'::text),
    ('20260716114000'::text),
    ('20260716115000'::text),
    ('20260716116000'::text),
    ('20260716117000'::text)
),
actual_release_migrations as materialized (
  select migration.version::text as version
  from supabase_migrations.schema_migrations as migration
  where migration.version::text > '20260715210000'
  order by migration.version::text
),
release_migration_contract as materialized (
  select jsonb_build_object(
    'baseline_head', '20260715210000',
    'expected_head', '20260716117000',
    'actual_head', (
      select max(migration.version::text)
      from supabase_migrations.schema_migrations as migration
    ),
    'expected_versions', (
      select jsonb_agg(required.version order by required.version)
      from required_release_migrations as required
    ),
    'actual_versions', (
      select coalesce(
        jsonb_agg(actual.version order by actual.version),
        '[]'::jsonb
      )
      from actual_release_migrations as actual
    ),
    'exact',
      (
        select coalesce(
          jsonb_agg(actual.version order by actual.version),
          '[]'::jsonb
        )
        from actual_release_migrations as actual
      ) = (
        select jsonb_agg(required.version order by required.version)
        from required_release_migrations as required
      )
      and (
        select max(migration.version::text)
        from supabase_migrations.schema_migrations as migration
      ) = '20260716117000'
  ) as contract
),
required_care_policy_functions(identity) as (
  values
    ('enqueue_amora_care_job(uuid,date,text,text,jsonb,text,text)'::text),
    ('prepare_amora_care_job(uuid,uuid,boolean)'::text),
    ('claim_amora_care_email_delivery(uuid,uuid)'::text),
    ('amora_care_delivery_clock()'::text),
    ('amora_care_is_delivery_window(timestamp with time zone)'::text),
    ('amora_care_next_delivery_window(timestamp with time zone)'::text),
    ('get_amora_care_queue_stats(date)'::text),
    ('enqueue_amora_care_job_pre_delivery_policy(uuid,date,text,text,jsonb,text,text)'::text),
    ('prepare_amora_care_job_pre_delivery_policy(uuid,uuid,boolean)'::text),
    ('claim_amora_care_email_delivery_pre_delivery_policy(uuid,uuid)'::text)
),
required_care_policy_indexes(name) as (
  values
    ('amora_care_deliveries_user_send_day_uidx'::text),
    ('amora_care_jobs_active_age_idx'::text),
    ('amora_care_jobs_scan_status_idx'::text)
),
care_delivery_policy_contract as materialized (
  select jsonb_build_object(
    'migration_version', '20260716095000',
    'migration_present', exists (
      select 1
      from supabase_migrations.schema_migrations as migration
      where migration.version::text = '20260716095000'
    ),
    'column', 'amora_care_deliveries.send_day',
    'column_present', exists (
      select 1
      from information_schema.columns as column_info
      where column_info.table_schema = 'public'
        and column_info.table_name = 'amora_care_deliveries'
        and column_info.column_name = 'send_day'
        and column_info.data_type = 'date'
    ),
    'constraint', 'profiles_care_consent_state_valid',
    'constraint_present', exists (
      select 1
      from pg_constraint as constraint_info
      where constraint_info.conrelid = 'public.profiles'::regclass
        and constraint_info.conname = 'profiles_care_consent_state_valid'
        and constraint_info.contype = 'c'
        and constraint_info.convalidated
    ),
    'indexes', (
      select jsonb_agg(required_index.name order by required_index.name)
      from required_care_policy_indexes as required_index
    ),
    'indexes_present', (
      select count(*) = 3
      from pg_index as index_info
      join pg_class as index_class on index_class.oid = index_info.indexrelid
      join pg_class as table_class on table_class.oid = index_info.indrelid
      join pg_namespace as table_schema on table_schema.oid = table_class.relnamespace
      where table_schema.nspname = 'public'
        and (
          (
            table_class.relname = 'amora_care_deliveries'
            and index_class.relname = 'amora_care_deliveries_user_send_day_uidx'
            and index_info.indisunique
            and index_info.indpred is not null
            and lower(pg_get_indexdef(index_class.oid)) like '%(user_id, send_day)%'
          )
          or (
            table_class.relname = 'amora_care_jobs'
            and index_class.relname = 'amora_care_jobs_scan_status_idx'
            and lower(pg_get_indexdef(index_class.oid)) like '%(scan_day, status)%'
          )
          or (
            table_class.relname = 'amora_care_jobs'
            and index_class.relname = 'amora_care_jobs_active_age_idx'
            and index_info.indpred is not null
            and lower(pg_get_indexdef(index_class.oid)) like '%(created_at)%'
          )
        )
    ),
    'functions', (
      select jsonb_agg(required_function.identity order by required_function.identity)
      from required_care_policy_functions as required_function
    ),
    'functions_present', (
      select count(*) = 10
      from required_care_policy_functions as required_function
      where to_regprocedure('public.' || required_function.identity) is not null
    )
  ) as contract
),
memory_budget_deferral_function as materialized (
  select to_regprocedure(
    'public.defer_amora_memory_job(uuid,integer,integer,text)'
  ) as function_oid
),
memory_budget_deferral_contract as materialized (
  select jsonb_build_object(
    'migration_version', '20260716098000',
    'migration_present', exists (
      select 1
      from supabase_migrations.schema_migrations as migration
      where migration.version::text = '20260716098000'
    ),
    'function', 'defer_amora_memory_job(uuid,integer,integer,text)',
    'function_present', function_oid is not null,
    'service_role_execute', coalesce(
      has_function_privilege('service_role', function_oid, 'EXECUTE'),
      false
    ),
    'anon_execute', coalesce(
      has_function_privilege('anon', function_oid, 'EXECUTE'),
      false
    ),
    'authenticated_execute', coalesce(
      has_function_privilege('authenticated', function_oid, 'EXECUTE'),
      false
    ),
    'service_only', function_oid is not null
      and coalesce(has_function_privilege('service_role', function_oid, 'EXECUTE'), false)
      and not coalesce(has_function_privilege('anon', function_oid, 'EXECUTE'), false)
      and not coalesce(has_function_privilege('authenticated', function_oid, 'EXECUTE'), false)
  ) as contract
  from memory_budget_deferral_function
),
included_functions as materialized (
  select p.*
  from pg_proc as p
  join pg_namespace as n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (
      p.proname in (
        'reserve_amora_turn',
        'prepare_amora_provider_call_receipt',
        'reserve_amora_provider_call',
        'finalize_amora_provider_call_receipt',
        'claim_amora_tool_execution',
        'apply_journey_progress_patch',
        'apply_journey_progress_item_patch',
        'join_couple',
        'generate_invite_code',
        'redact_old_ai_interactions',
        'create_profile_on_signup',
        'set_updated_at',
        'update_updated_at_column',
        'is_couple_member',
        'can_read_profile',
        'set_amora_action_status_timestamps',
        'has_current_amora_memory_consent',
        'enqueue_amora_memory_job',
        'claim_amora_memory_job',
        'finish_amora_memory_job',
        'upsert_amora_memory_node',
        'update_amora_memory_node',
        'delete_amora_memory_node',
        'insert_amora_memory_summary',
        'commit_amora_memory_job',
        'defer_amora_memory_job',
        'accept_amora_mediation',
        'revoke_amora_mediation_acceptance',
        'insert_amora_care_message',
        'claim_amora_care_scan',
        'advance_amora_care_scan',
        'enqueue_amora_care_job',
        'claim_amora_care_job',
        'prepare_amora_care_job',
        'claim_amora_care_email_delivery',
        'finish_amora_care_email_delivery',
        'finish_amora_care_job',
        'set_amora_care_consent',
        'quarantine_amora_care_queue',
        'amora_care_delivery_clock',
        'amora_care_is_delivery_window',
        'amora_care_next_delivery_window',
        'get_amora_care_queue_stats',
        'enqueue_amora_care_job_pre_delivery_policy',
        'prepare_amora_care_job_pre_delivery_policy',
        'claim_amora_care_email_delivery_pre_delivery_policy',
        'enqueue_booking_projection_job',
        'claim_booking_projection_job',
        'finish_booking_projection_job',
        'get_booking_projection_queue_stats',
        'retry_booking_projection_job',
        'apply_booking_progress_projection',
        'claim_amora_conflict_check',
        'checkpoint_amora_conflict_check',
        'complete_amora_conflict_check',
        'fail_amora_conflict_check',
        'patch_profile_atomic',
        'finalize_amora_conflict_verify_receipt',
        'finalize_amora_chat_response',
        'reconcile_amora_chat_response',
        'claim_community_upload_session',
        'get_wedding_settings_snapshot',
        'patch_wedding_settings_atomic',
        'set_amora_memory_consent',
        'clear_amora_memory_scope',
        'begin_account_deletion_job',
        'claim_account_deletion_job',
        'replace_account_deletion_media_manifest',
        'release_account_deletion_job',
        'mark_account_deletion_manual_review',
        'resume_account_deletion_after_manual_review',
        'checkpoint_account_deletion_media',
        'prepare_account_deletion_auth_delete',
        'finalize_account_deletion_job'
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
    'live_schema_contract_sha256', upper(
      public.production_live_schema_contract_20260717()
    ),
    'current_user', current_user,
    'session_user', session_user,
    'current_role_bypasses_rls', exists (
      select 1 from pg_roles
      where rolname = current_user and (rolsuper or rolbypassrls)
    ),
    'row_security', current_setting('row_security'),
    'server_version_num', current_setting('server_version_num'),
    'care_delivery_policy', (
      select contract from care_delivery_policy_contract
    ),
    'memory_budget_deferral', (
      select contract from memory_budget_deferral_contract
    ),
    'release_migrations', (
      select contract from release_migration_contract
    ),
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
  case
    when (payload #>> '{care_delivery_policy,migration_present}')::boolean
     and (payload #>> '{care_delivery_policy,column_present}')::boolean
     and (payload #>> '{care_delivery_policy,constraint_present}')::boolean
     and (payload #>> '{care_delivery_policy,indexes_present}')::boolean
     and (payload #>> '{care_delivery_policy,functions_present}')::boolean
     and (payload #>> '{memory_budget_deferral,migration_present}')::boolean
     and (payload #>> '{memory_budget_deferral,function_present}')::boolean
     and (payload #>> '{memory_budget_deferral,service_only}')::boolean
     and (payload #>> '{release_migrations,exact}')::boolean
     and payload ->> 'live_schema_contract_sha256' ~ '^[A-F0-9]{64}$'
     and pg_column_size(payload) <= 33554432
    then payload::text
    else null
  end as payload,
  pg_column_size(payload)::bigint as payload_bytes
from inventory;

commit;
