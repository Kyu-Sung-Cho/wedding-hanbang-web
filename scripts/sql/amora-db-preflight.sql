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
    ('amora_chat_request_claims'::text),
    ('amora_turn_counters'::text),
    ('amora_couple_profiles'::text),
    ('amora_care_deliveries'::text),
    ('amora_care_jobs'::text),
    ('amora_care_scan_states'::text),
    ('amora_mediation_acceptances'::text),
    ('amora_memory_consents'::text),
    ('amora_memory_jobs'::text),
    ('amora_memory_settings'::text),
    ('amora_turn_requests'::text),
    ('amora_tool_executions'::text),
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
target_tables as materialized (
  select
    c.oid,
    c.oid::text as relation_oid,
    c.relname as name,
    c.relkind::text as relkind,
    exists (
      select 1 from pg_inherits as inheritance_children
      where inheritance_children.inhparent = c.oid
    ) as has_inheritance_children,
    exists (
      select 1 from pg_inherits as inheritance_parent
      where inheritance_parent.inhrelid = c.oid
    ) as is_inheritance_child,
    greatest(c.reltuples, 0)::bigint as estimated_rows,
    pg_table_size(c.oid)::bigint as estimated_bytes
  from pg_class as c
  join pg_namespace as n on n.oid = c.relnamespace
  where n.nspname = 'public'
    -- Partition parents can hide child size/reltuples from this bound. Fail
    -- closed by counting ordinary tables only; table_count must still be 27.
    and c.relkind = 'r'
    and not exists (
      select 1 from pg_inherits as inheritance
      where inheritance.inhparent = c.oid or inheritance.inhrelid = c.oid
    )
    and c.relname in (
      select target_table.name from target_table_names as target_table
    )
),
preflight as materialized (
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
    'care_delivery_policy', (
      select contract from care_delivery_policy_contract
    ),
    'memory_budget_deferral', (
      select contract from memory_budget_deferral_contract
    ),
    'release_migrations', (
      select contract from release_migration_contract
    ),
    'table_count', count(*)::integer,
    'estimated_total_bytes', coalesce(sum(estimated_bytes), 0)::bigint,
    'estimated_total_rows', coalesce(sum(estimated_rows), 0)::bigint,
    'tables', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'name', name,
          'relation_oid', relation_oid,
          'relkind', relkind,
          'has_inheritance_children', has_inheritance_children,
          'is_inheritance_child', is_inheritance_child,
          'estimated_bytes', estimated_bytes,
          'estimated_rows', estimated_rows
        )
        order by name
      ),
      '[]'::jsonb
    )
  ) as payload
  from target_tables
)
select
  case
    when (payload ->> 'table_count')::integer = 27
     and (payload ->> 'current_role_bypasses_rls')::boolean
     and (payload #>> '{care_delivery_policy,migration_present}')::boolean
     and (payload #>> '{care_delivery_policy,column_present}')::boolean
     and (payload #>> '{care_delivery_policy,constraint_present}')::boolean
     and (payload #>> '{care_delivery_policy,indexes_present}')::boolean
     and (payload #>> '{care_delivery_policy,functions_present}')::boolean
     and (payload #>> '{memory_budget_deferral,migration_present}')::boolean
     and (payload #>> '{memory_budget_deferral,function_present}')::boolean
     and (payload #>> '{memory_budget_deferral,service_only}')::boolean
     and (payload #>> '{release_migrations,exact}')::boolean
     and (payload ->> 'estimated_total_bytes')::bigint <= 33554432
     and pg_column_size(payload) <= 33554432
    then payload::text
    else null
  end as payload,
  pg_column_size(payload)::bigint as payload_bytes
from preflight;

commit;
