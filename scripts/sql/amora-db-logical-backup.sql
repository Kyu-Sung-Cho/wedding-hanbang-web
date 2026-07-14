begin transaction read only;
set local statement_timeout = '120s';
set local lock_timeout = '5s';
set local row_security = off;

with
target_relations(name, relation_oid) as (
  values
    ('ai_interactions_log'::text, 'public.ai_interactions_log'::regclass),
    ('amora_actions'::text, 'public.amora_actions'::regclass),
    ('amora_couple_profiles'::text, 'public.amora_couple_profiles'::regclass),
    ('amora_turn_counters'::text, 'public.amora_turn_counters'::regclass),
    ('chat_feedback'::text, 'public.chat_feedback'::regclass),
    ('chat_messages'::text, 'public.chat_messages'::regclass),
    ('chat_summaries'::text, 'public.chat_summaries'::regclass),
    ('couples'::text, 'public.couples'::regclass),
    ('decision_nodes'::text, 'public.decision_nodes'::regclass),
    ('profiles'::text, 'public.profiles'::regclass),
    ('wedding_journeys'::text, 'public.wedding_journeys'::regclass)
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
ai_interactions_log_rows as materialized (
  select to_jsonb(t) as row_data from only public.ai_interactions_log as t
),
amora_actions_rows as materialized (
  select to_jsonb(t) as row_data from only public.amora_actions as t
),
amora_couple_profiles_rows as materialized (
  select to_jsonb(t) as row_data from only public.amora_couple_profiles as t
),
amora_turn_counters_rows as materialized (
  select to_jsonb(t) as row_data from only public.amora_turn_counters as t
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
  case when pg_column_size(payload) <= 33554432 then payload::text else null end as payload,
  pg_column_size(payload)::bigint as payload_bytes
from logical_backup;

commit;
