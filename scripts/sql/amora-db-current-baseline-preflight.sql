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
target_tables as materialized (
  select
    relation.oid,
    relation.oid::text as relation_oid,
    relation.relname as name,
    relation.relkind::text as relkind,
    exists (
      select 1 from pg_inherits as child
      where child.inhparent = relation.oid
    ) as has_inheritance_children,
    exists (
      select 1 from pg_inherits as parent
      where parent.inhrelid = relation.oid
    ) as is_inheritance_child,
    greatest(relation.reltuples, 0)::bigint as estimated_rows,
    pg_table_size(relation.oid)::bigint as estimated_bytes
  from pg_class as relation
  join pg_namespace as relation_schema on relation_schema.oid = relation.relnamespace
  where relation_schema.nspname = 'public'
    and relation.relkind = 'r'
    and relation.relname in (
      select target.name from target_table_names as target
    )
),
preflight as materialized (
  select jsonb_build_object(
    'captured_at', clock_timestamp(),
    'source_project_ref', current_setting('app.settings.project_ref', true),
    'database_name', current_database(),
    'current_user', current_user,
    'session_user', session_user,
    'current_role_bypasses_rls', exists (
      select 1 from pg_roles
      where rolname = current_user and (rolsuper or rolbypassrls)
    ),
    'row_security', current_setting('row_security'),
    'transaction_read_only', current_setting('transaction_read_only'),
    'server_version_num', current_setting('server_version_num'),
    'migration_head', (
      select max(migration.version::text)
      from supabase_migrations.schema_migrations as migration
    ),
    'forbidden_post_baseline_relation_count', (
      select count(*)::integer
      from pg_class as forbidden_relation
      join pg_namespace as forbidden_schema on forbidden_schema.oid = forbidden_relation.relnamespace
      where forbidden_schema.nspname = 'public'
        and forbidden_relation.relname in (
          'account_deletion_jobs',
          'account_deletion_media_manifest',
          'amora_care_deliveries',
          'amora_care_jobs',
          'amora_care_scan_states',
          'amora_conflict_check_claims',
          'amora_mediation_acceptances',
          'amora_memory_consents',
          'amora_memory_jobs',
          'amora_memory_settings',
          'amora_turn_requests',
          'booking_projection_jobs',
          'community_upload_sessions'
        )
    ),
    'excluded_ephemeral_relation_count', (
      select count(*)::integer
      from pg_class as excluded_relation
      join pg_namespace as excluded_schema
        on excluded_schema.oid = excluded_relation.relnamespace
      where excluded_schema.nspname = 'public'
        and excluded_relation.relkind = 'r'
        and excluded_relation.relname in (
          'production_release_lease_20260717',
          'rate_limit_buckets'
        )
    ),
    'ephemeral_rebuild_function_count', (
      select count(*)::integer
      from pg_proc as rebuild_function
      join pg_namespace as rebuild_schema
        on rebuild_schema.oid = rebuild_function.pronamespace
      where rebuild_schema.nspname = 'public'
        and rebuild_function.oid = to_regprocedure(
          'public.check_rate_limit(text,integer,integer)'
        )
    ),
    'temporary_release_lease_empty_count', (
      select (count(*) = 0)::integer
      from public.production_release_lease_20260717
    ),
    'table_count', count(*)::integer,
    'estimated_total_bytes', coalesce(sum(estimated_bytes), 0)::bigint,
    'estimated_total_rows', coalesce(sum(estimated_rows), 0)::bigint,
    'tables', coalesce(jsonb_agg(
      jsonb_build_object(
        'name', name,
        'relation_oid', relation_oid,
        'relkind', relkind,
        'has_inheritance_children', has_inheritance_children,
        'is_inheritance_child', is_inheritance_child,
        'estimated_bytes', estimated_bytes,
        'estimated_rows', estimated_rows
      ) order by name
    ), '[]'::jsonb)
  ) as payload
  from target_tables
)
select
  case
    when (payload ->> 'table_count')::integer = 14
     and (payload ->> 'current_role_bypasses_rls')::boolean
     and payload ->> 'row_security' = 'off'
     and payload ->> 'transaction_read_only' = 'on'
     and payload ->> 'migration_head' = '20260715210000'
     and (payload ->> 'forbidden_post_baseline_relation_count')::integer = 0
     and (payload ->> 'excluded_ephemeral_relation_count')::integer = 2
     and (payload ->> 'ephemeral_rebuild_function_count')::integer = 1
     and (payload ->> 'temporary_release_lease_empty_count')::integer = 1
     and (payload ->> 'estimated_total_bytes')::bigint <= 8388608
     and (payload ->> 'estimated_total_rows')::bigint <= 100000
     and pg_column_size(payload) <= 16777216
    then payload::text
    else null
  end as payload,
  pg_column_size(payload)::bigint as payload_bytes
from preflight;

commit;
