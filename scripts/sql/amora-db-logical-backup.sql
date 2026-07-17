begin transaction read only;
set local statement_timeout = '120s';
set local lock_timeout = '5s';
set local row_security = off;

with
target_relations(name, relation_oid) as (
  values
    ('account_deletion_jobs'::text, 'public.account_deletion_jobs'::regclass),
    ('account_deletion_media_manifest'::text, 'public.account_deletion_media_manifest'::regclass),
    ('ai_interactions_log'::text, 'public.ai_interactions_log'::regclass),
    ('amora_actions'::text, 'public.amora_actions'::regclass),
    ('amora_chat_request_claims'::text, 'public.amora_chat_request_claims'::regclass),
    ('amora_conflict_check_claims'::text, 'public.amora_conflict_check_claims'::regclass),
    ('amora_care_deliveries'::text, 'public.amora_care_deliveries'::regclass),
    ('amora_care_jobs'::text, 'public.amora_care_jobs'::regclass),
    ('amora_care_scan_states'::text, 'public.amora_care_scan_states'::regclass),
    ('amora_couple_profiles'::text, 'public.amora_couple_profiles'::regclass),
    ('amora_mediation_acceptances'::text, 'public.amora_mediation_acceptances'::regclass),
    ('amora_memory_consents'::text, 'public.amora_memory_consents'::regclass),
    ('amora_memory_jobs'::text, 'public.amora_memory_jobs'::regclass),
    ('amora_memory_settings'::text, 'public.amora_memory_settings'::regclass),
    ('amora_tool_executions'::text, 'public.amora_tool_executions'::regclass),
    ('amora_turn_counters'::text, 'public.amora_turn_counters'::regclass),
    ('amora_turn_requests'::text, 'public.amora_turn_requests'::regclass),
    ('booking_projection_jobs'::text, 'public.booking_projection_jobs'::regclass),
    ('community_upload_sessions'::text, 'public.community_upload_sessions'::regclass),
    ('chat_feedback'::text, 'public.chat_feedback'::regclass),
    ('chat_messages'::text, 'public.chat_messages'::regclass),
    ('chat_summaries'::text, 'public.chat_summaries'::regclass),
    ('couples'::text, 'public.couples'::regclass),
    ('decision_nodes'::text, 'public.decision_nodes'::regclass),
    ('profiles'::text, 'public.profiles'::regclass),
    ('vendor_reviews'::text, 'public.vendor_reviews'::regclass),
    ('wedding_journeys'::text, 'public.wedding_journeys'::regclass)
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
relation_shapes as materialized (
  select
    target.name,
    relation.oid::text as relation_oid,
    relation.relkind::text as relkind,
    exists (
      select 1 from pg_inherits as inheritance_children
      where inheritance_children.inhparent = relation.oid
    ) as has_inheritance_children,
    exists (
      select 1 from pg_inherits as inheritance_parent
      where inheritance_parent.inhrelid = relation.oid
    ) as is_inheritance_child
  from target_relations as target
  join pg_class as relation on relation.oid = target.relation_oid
  join pg_namespace as relation_schema on relation_schema.oid = relation.relnamespace
  where relation_schema.nspname = 'public'
    and relation.relname = target.name
),
account_deletion_jobs_rows as materialized (
  select to_jsonb(t) as row_data from only public.account_deletion_jobs as t
),
account_deletion_media_manifest_rows as materialized (
  select to_jsonb(t) as row_data from only public.account_deletion_media_manifest as t
),
ai_interactions_log_rows as materialized (
  select to_jsonb(t) as row_data from only public.ai_interactions_log as t
),
amora_actions_rows as materialized (
  select to_jsonb(t) as row_data from only public.amora_actions as t
),
amora_chat_request_claims_rows as materialized (
  select to_jsonb(t) as row_data from only public.amora_chat_request_claims as t
),
amora_conflict_check_claims_rows as materialized (
  select to_jsonb(t) as row_data from only public.amora_conflict_check_claims as t
),
amora_care_deliveries_rows as materialized (
  select to_jsonb(t) as row_data from only public.amora_care_deliveries as t
),
amora_care_jobs_rows as materialized (
  select to_jsonb(t) as row_data from only public.amora_care_jobs as t
),
amora_care_scan_states_rows as materialized (
  select to_jsonb(t) as row_data from only public.amora_care_scan_states as t
),
amora_couple_profiles_rows as materialized (
  select to_jsonb(t) as row_data from only public.amora_couple_profiles as t
),
amora_mediation_acceptances_rows as materialized (
  select to_jsonb(t) as row_data from only public.amora_mediation_acceptances as t
),
amora_memory_consents_rows as materialized (
  select to_jsonb(t) as row_data from only public.amora_memory_consents as t
),
amora_memory_jobs_rows as materialized (
  select to_jsonb(t) as row_data from only public.amora_memory_jobs as t
),
amora_memory_settings_rows as materialized (
  select to_jsonb(t) as row_data from only public.amora_memory_settings as t
),
amora_tool_executions_rows as materialized (
  select to_jsonb(t) as row_data from only public.amora_tool_executions as t
),
amora_turn_counters_rows as materialized (
  select to_jsonb(t) as row_data from only public.amora_turn_counters as t
),
amora_turn_requests_rows as materialized (
  select to_jsonb(t) as row_data from only public.amora_turn_requests as t
),
booking_projection_jobs_rows as materialized (
  select to_jsonb(t) as row_data from only public.booking_projection_jobs as t
),
community_upload_sessions_rows as materialized (
  select to_jsonb(t) as row_data from only public.community_upload_sessions as t
),
chat_feedback_rows as materialized (
  select to_jsonb(t) as row_data from only public.chat_feedback as t
),
chat_messages_rows as materialized (
  select to_jsonb(t) as row_data from only public.chat_messages as t
),
chat_summaries_rows as materialized (
  select to_jsonb(t) as row_data from only public.chat_summaries as t
),
couples_rows as materialized (
  select to_jsonb(t) as row_data from only public.couples as t
),
decision_nodes_rows as materialized (
  select to_jsonb(t) as row_data from only public.decision_nodes as t
),
profiles_rows as materialized (
  select to_jsonb(t) as row_data from only public.profiles as t
),
vendor_reviews_rows as materialized (
  select to_jsonb(t) as row_data from only public.vendor_reviews as t
),
wedding_journeys_rows as materialized (
  select to_jsonb(t) as row_data from only public.wedding_journeys as t
),
logical_backup as materialized (
select jsonb_build_object(
  'captured_at', now(),
  'current_user', current_user,
  'session_user', session_user,
  'current_role_bypasses_rls', exists (
    select 1 from pg_roles
    where rolname = current_user and (rolsuper or rolbypassrls)
  ),
  'row_security', current_setting('row_security'),
  'care_delivery_policy', (
    select contract from care_delivery_policy_contract
  ),
  'memory_budget_deferral', (
    select contract from memory_budget_deferral_contract
  ),
  'release_migrations', (
    select contract from release_migration_contract
  ),
  'relations', (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'name', name,
        'relation_oid', relation_oid,
        'relkind', relkind,
        'has_inheritance_children', has_inheritance_children,
        'is_inheritance_child', is_inheritance_child
      ) order by name
    ), '[]'::jsonb)
    from relation_shapes
  ),
  'tables', jsonb_build_object(
    'account_deletion_jobs', (
      select jsonb_build_object(
        'row_count', count(*),
        'rows', coalesce(jsonb_agg(row_data order by row_data::text), '[]'::jsonb),
        'canonical_sha256', encode(sha256(convert_to(coalesce(string_agg(
          octet_length(row_data::text)::text || ':' || row_data::text || E'\n',
          '' order by row_data::text
        ), ''), 'UTF8')), 'hex')
      ) from account_deletion_jobs_rows
    ),
    'account_deletion_media_manifest', (
      select jsonb_build_object(
        'row_count', count(*),
        'rows', coalesce(jsonb_agg(row_data order by row_data::text), '[]'::jsonb),
        'canonical_sha256', encode(sha256(convert_to(coalesce(string_agg(
          octet_length(row_data::text)::text || ':' || row_data::text || E'\n',
          '' order by row_data::text
        ), ''), 'UTF8')), 'hex')
      ) from account_deletion_media_manifest_rows
    ),
    'ai_interactions_log', (
      select jsonb_build_object(
        'row_count', count(*),
        'rows', coalesce(jsonb_agg(row_data order by row_data::text), '[]'::jsonb),
        'canonical_sha256', encode(sha256(convert_to(coalesce(string_agg(
          octet_length(row_data::text)::text || ':' || row_data::text || E'\n',
          '' order by row_data::text
        ), ''), 'UTF8')), 'hex')
      ) from ai_interactions_log_rows
    ),
    'amora_actions', (
      select jsonb_build_object(
        'row_count', count(*),
        'rows', coalesce(jsonb_agg(row_data order by row_data::text), '[]'::jsonb),
        'canonical_sha256', encode(sha256(convert_to(coalesce(string_agg(
          octet_length(row_data::text)::text || ':' || row_data::text || E'\n',
          '' order by row_data::text
        ), ''), 'UTF8')), 'hex')
      ) from amora_actions_rows
    ),
    'amora_chat_request_claims', (
      select jsonb_build_object(
        'row_count', count(*),
        'rows', coalesce(jsonb_agg(row_data order by row_data::text), '[]'::jsonb),
        'canonical_sha256', encode(sha256(convert_to(coalesce(string_agg(
          octet_length(row_data::text)::text || ':' || row_data::text || E'\n',
          '' order by row_data::text
        ), ''), 'UTF8')), 'hex')
      ) from amora_chat_request_claims_rows
    ),
    'amora_conflict_check_claims', (
      select jsonb_build_object(
        'row_count', count(*),
        'rows', coalesce(jsonb_agg(row_data order by row_data::text), '[]'::jsonb),
        'canonical_sha256', encode(sha256(convert_to(coalesce(string_agg(
          octet_length(row_data::text)::text || ':' || row_data::text || E'\n',
          '' order by row_data::text
        ), ''), 'UTF8')), 'hex')
      ) from amora_conflict_check_claims_rows
    ),
    'amora_care_deliveries', (
      select jsonb_build_object(
        'row_count', count(*),
        'rows', coalesce(jsonb_agg(row_data order by row_data::text), '[]'::jsonb),
        'canonical_sha256', encode(sha256(convert_to(coalesce(string_agg(
          octet_length(row_data::text)::text || ':' || row_data::text || E'\n',
          '' order by row_data::text
        ), ''), 'UTF8')), 'hex')
      ) from amora_care_deliveries_rows
    ),
    'amora_care_jobs', (
      select jsonb_build_object(
        'row_count', count(*),
        'rows', coalesce(jsonb_agg(row_data order by row_data::text), '[]'::jsonb),
        'canonical_sha256', encode(sha256(convert_to(coalesce(string_agg(
          octet_length(row_data::text)::text || ':' || row_data::text || E'\n',
          '' order by row_data::text
        ), ''), 'UTF8')), 'hex')
      ) from amora_care_jobs_rows
    ),
    'amora_care_scan_states', (
      select jsonb_build_object(
        'row_count', count(*),
        'rows', coalesce(jsonb_agg(row_data order by row_data::text), '[]'::jsonb),
        'canonical_sha256', encode(sha256(convert_to(coalesce(string_agg(
          octet_length(row_data::text)::text || ':' || row_data::text || E'\n',
          '' order by row_data::text
        ), ''), 'UTF8')), 'hex')
      ) from amora_care_scan_states_rows
    ),
    'amora_couple_profiles', (
      select jsonb_build_object(
        'row_count', count(*),
        'rows', coalesce(jsonb_agg(row_data order by row_data::text), '[]'::jsonb),
        'canonical_sha256', encode(sha256(convert_to(coalesce(string_agg(
          octet_length(row_data::text)::text || ':' || row_data::text || E'\n',
          '' order by row_data::text
        ), ''), 'UTF8')), 'hex')
      ) from amora_couple_profiles_rows
    ),
    'amora_mediation_acceptances', (
      select jsonb_build_object(
        'row_count', count(*),
        'rows', coalesce(jsonb_agg(row_data order by row_data::text), '[]'::jsonb),
        'canonical_sha256', encode(sha256(convert_to(coalesce(string_agg(
          octet_length(row_data::text)::text || ':' || row_data::text || E'\n',
          '' order by row_data::text
        ), ''), 'UTF8')), 'hex')
      ) from amora_mediation_acceptances_rows
    ),
    'amora_memory_consents', (
      select jsonb_build_object(
        'row_count', count(*),
        'rows', coalesce(jsonb_agg(row_data order by row_data::text), '[]'::jsonb),
        'canonical_sha256', encode(sha256(convert_to(coalesce(string_agg(
          octet_length(row_data::text)::text || ':' || row_data::text || E'\n',
          '' order by row_data::text
        ), ''), 'UTF8')), 'hex')
      ) from amora_memory_consents_rows
    ),
    'amora_memory_jobs', (
      select jsonb_build_object(
        'row_count', count(*),
        'rows', coalesce(jsonb_agg(row_data order by row_data::text), '[]'::jsonb),
        'canonical_sha256', encode(sha256(convert_to(coalesce(string_agg(
          octet_length(row_data::text)::text || ':' || row_data::text || E'\n',
          '' order by row_data::text
        ), ''), 'UTF8')), 'hex')
      ) from amora_memory_jobs_rows
    ),
    'amora_memory_settings', (
      select jsonb_build_object(
        'row_count', count(*),
        'rows', coalesce(jsonb_agg(row_data order by row_data::text), '[]'::jsonb),
        'canonical_sha256', encode(sha256(convert_to(coalesce(string_agg(
          octet_length(row_data::text)::text || ':' || row_data::text || E'\n',
          '' order by row_data::text
        ), ''), 'UTF8')), 'hex')
      ) from amora_memory_settings_rows
    ),
    'amora_tool_executions', (
      select jsonb_build_object(
        'row_count', count(*),
        'rows', coalesce(jsonb_agg(row_data order by row_data::text), '[]'::jsonb),
        'canonical_sha256', encode(sha256(convert_to(coalesce(string_agg(
          octet_length(row_data::text)::text || ':' || row_data::text || E'\n',
          '' order by row_data::text
        ), ''), 'UTF8')), 'hex')
      ) from amora_tool_executions_rows
    ),
    'amora_turn_counters', (
      select jsonb_build_object(
        'row_count', count(*),
        'rows', coalesce(jsonb_agg(row_data order by row_data::text), '[]'::jsonb),
        'canonical_sha256', encode(sha256(convert_to(coalesce(string_agg(
          octet_length(row_data::text)::text || ':' || row_data::text || E'\n',
          '' order by row_data::text
        ), ''), 'UTF8')), 'hex')
      ) from amora_turn_counters_rows
    ),
    'amora_turn_requests', (
      select jsonb_build_object(
        'row_count', count(*),
        'rows', coalesce(jsonb_agg(row_data order by row_data::text), '[]'::jsonb),
        'canonical_sha256', encode(sha256(convert_to(coalesce(string_agg(
          octet_length(row_data::text)::text || ':' || row_data::text || E'\n',
          '' order by row_data::text
        ), ''), 'UTF8')), 'hex')
      ) from amora_turn_requests_rows
    ),
    'booking_projection_jobs', (
      select jsonb_build_object(
        'row_count', count(*),
        'rows', coalesce(jsonb_agg(row_data order by row_data::text), '[]'::jsonb),
        'canonical_sha256', encode(sha256(convert_to(coalesce(string_agg(
          octet_length(row_data::text)::text || ':' || row_data::text || E'\n',
          '' order by row_data::text
        ), ''), 'UTF8')), 'hex')
      ) from booking_projection_jobs_rows
    ),
    'community_upload_sessions', (
      select jsonb_build_object(
        'row_count', count(*),
        'rows', coalesce(jsonb_agg(row_data order by row_data::text), '[]'::jsonb),
        'canonical_sha256', encode(sha256(convert_to(coalesce(string_agg(
          octet_length(row_data::text)::text || ':' || row_data::text || E'\n',
          '' order by row_data::text
        ), ''), 'UTF8')), 'hex')
      ) from community_upload_sessions_rows
    ),
    'chat_feedback', (
      select jsonb_build_object(
        'row_count', count(*),
        'rows', coalesce(jsonb_agg(row_data order by row_data::text), '[]'::jsonb),
        'canonical_sha256', encode(sha256(convert_to(coalesce(string_agg(
          octet_length(row_data::text)::text || ':' || row_data::text || E'\n',
          '' order by row_data::text
        ), ''), 'UTF8')), 'hex')
      ) from chat_feedback_rows
    ),
    'chat_messages', (
      select jsonb_build_object(
        'row_count', count(*),
        'rows', coalesce(jsonb_agg(row_data order by row_data::text), '[]'::jsonb),
        'canonical_sha256', encode(sha256(convert_to(coalesce(string_agg(
          octet_length(row_data::text)::text || ':' || row_data::text || E'\n',
          '' order by row_data::text
        ), ''), 'UTF8')), 'hex')
      ) from chat_messages_rows
    ),
    'chat_summaries', (
      select jsonb_build_object(
        'row_count', count(*),
        'rows', coalesce(jsonb_agg(row_data order by row_data::text), '[]'::jsonb),
        'canonical_sha256', encode(sha256(convert_to(coalesce(string_agg(
          octet_length(row_data::text)::text || ':' || row_data::text || E'\n',
          '' order by row_data::text
        ), ''), 'UTF8')), 'hex')
      ) from chat_summaries_rows
    ),
    'couples', (
      select jsonb_build_object(
        'row_count', count(*),
        'rows', coalesce(jsonb_agg(row_data order by row_data::text), '[]'::jsonb),
        'canonical_sha256', encode(sha256(convert_to(coalesce(string_agg(
          octet_length(row_data::text)::text || ':' || row_data::text || E'\n',
          '' order by row_data::text
        ), ''), 'UTF8')), 'hex')
      ) from couples_rows
    ),
    'decision_nodes', (
      select jsonb_build_object(
        'row_count', count(*),
        'rows', coalesce(jsonb_agg(row_data order by row_data::text), '[]'::jsonb),
        'canonical_sha256', encode(sha256(convert_to(coalesce(string_agg(
          octet_length(row_data::text)::text || ':' || row_data::text || E'\n',
          '' order by row_data::text
        ), ''), 'UTF8')), 'hex')
      ) from decision_nodes_rows
    ),
    'profiles', (
      select jsonb_build_object(
        'row_count', count(*),
        'rows', coalesce(jsonb_agg(row_data order by row_data::text), '[]'::jsonb),
        'canonical_sha256', encode(sha256(convert_to(coalesce(string_agg(
          octet_length(row_data::text)::text || ':' || row_data::text || E'\n',
          '' order by row_data::text
        ), ''), 'UTF8')), 'hex')
      ) from profiles_rows
    ),
    'vendor_reviews', (
      select jsonb_build_object(
        'row_count', count(*),
        'rows', coalesce(jsonb_agg(row_data order by row_data::text), '[]'::jsonb),
        'canonical_sha256', encode(sha256(convert_to(coalesce(string_agg(
          octet_length(row_data::text)::text || ':' || row_data::text || E'\n',
          '' order by row_data::text
        ), ''), 'UTF8')), 'hex')
      ) from vendor_reviews_rows
    ),
    'wedding_journeys', (
      select jsonb_build_object(
        'row_count', count(*),
        'rows', coalesce(jsonb_agg(row_data order by row_data::text), '[]'::jsonb),
        'canonical_sha256', encode(sha256(convert_to(coalesce(string_agg(
          octet_length(row_data::text)::text || ':' || row_data::text || E'\n',
          '' order by row_data::text
        ), ''), 'UTF8')), 'hex')
      ) from wedding_journeys_rows
    )
  )
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
     and pg_column_size(payload) <= 33554432
    then payload::text
    else null
  end as payload,
  pg_column_size(payload)::bigint as payload_bytes
from logical_backup;

commit;
