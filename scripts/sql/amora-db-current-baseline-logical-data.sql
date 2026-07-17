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
relation_shapes as materialized (
  select
    relation.relname as name,
    relation.oid::text as relation_oid,
    relation.relkind::text as relkind,
    exists (
      select 1 from pg_inherits as child where child.inhparent = relation.oid
    ) as has_inheritance_children,
    exists (
      select 1 from pg_inherits as parent where parent.inhrelid = relation.oid
    ) as is_inheritance_child
  from pg_class as relation
  join pg_namespace as relation_schema on relation_schema.oid = relation.relnamespace
  where relation_schema.nspname = 'public'
    and relation.relkind = 'r'
    and relation.relname in (
      select target.name from target_table_names as target
    )
),
ai_interactions_log_rows as materialized (
  select to_jsonb(row_value) as row_data from only public.ai_interactions_log as row_value
),
amora_actions_rows as materialized (
  select to_jsonb(row_value) as row_data from only public.amora_actions as row_value
),
amora_chat_request_claims_rows as materialized (
  select to_jsonb(row_value) as row_data from only public.amora_chat_request_claims as row_value
),
amora_couple_profiles_rows as materialized (
  select to_jsonb(row_value) as row_data from only public.amora_couple_profiles as row_value
),
amora_tool_executions_rows as materialized (
  select to_jsonb(row_value) as row_data from only public.amora_tool_executions as row_value
),
amora_turn_counters_rows as materialized (
  select to_jsonb(row_value) as row_data from only public.amora_turn_counters as row_value
),
chat_feedback_rows as materialized (
  select to_jsonb(row_value) as row_data from only public.chat_feedback as row_value
),
chat_messages_rows as materialized (
  select to_jsonb(row_value) as row_data from only public.chat_messages as row_value
),
chat_summaries_rows as materialized (
  select to_jsonb(row_value) as row_data from only public.chat_summaries as row_value
),
couples_rows as materialized (
  select to_jsonb(row_value) as row_data from only public.couples as row_value
),
decision_nodes_rows as materialized (
  select to_jsonb(row_value) as row_data from only public.decision_nodes as row_value
),
profiles_rows as materialized (
  select to_jsonb(row_value) as row_data from only public.profiles as row_value
),
vendor_reviews_rows as materialized (
  select to_jsonb(row_value) as row_data from only public.vendor_reviews as row_value
),
wedding_journeys_rows as materialized (
  select to_jsonb(row_value) as row_data from only public.wedding_journeys as row_value
),
logical_data as materialized (
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
    'relations', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', name,
        'relation_oid', relation_oid,
        'relkind', relkind,
        'has_inheritance_children', has_inheritance_children,
        'is_inheritance_child', is_inheritance_child
      ) order by name), '[]'::jsonb)
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
    when jsonb_array_length(payload -> 'relations') = 14
     and (
       select count(*) from jsonb_object_keys(payload -> 'tables') as table_name
     ) = 14
     and (payload ->> 'current_role_bypasses_rls')::boolean
     and payload ->> 'row_security' = 'off'
     and payload ->> 'transaction_read_only' = 'on'
     and pg_column_size(payload) <= 16777216
    then payload::text
    else null
  end as payload,
  pg_column_size(payload)::bigint as payload_bytes
from logical_data;

commit;
