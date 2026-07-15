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
    ('amora_actions'::text),
    ('wedding_journeys'::text),
    ('profiles'::text),
    ('couples'::text),
    ('chat_feedback'::text)
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
    -- closed by counting ordinary tables only; table_count must still be 11.
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
    when (payload ->> 'table_count')::integer = 11
     and (payload ->> 'current_role_bypasses_rls')::boolean
     and (payload ->> 'estimated_total_bytes')::bigint <= 33554432
     and pg_column_size(payload) <= 33554432
    then payload::text
    else null
  end as payload,
  pg_column_size(payload)::bigint as payload_bytes
from preflight;

commit;
