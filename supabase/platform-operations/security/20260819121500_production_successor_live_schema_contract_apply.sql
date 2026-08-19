BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $precondition$
DECLARE
  public_table_count bigint;
  exact_trigger_count bigint;
BEGIN
  IF current_user <> 'postgres'
     OR session_user <> 'postgres'
     OR NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '') IS NOT NULL
     OR NULLIF(pg_catalog.current_setting('request.jwt.claim.role', true), '') IS NOT NULL
     OR auth.role() IS NOT NULL THEN
    RAISE EXCEPTION 'PRODUCTION_SUCCESSOR_SCHEMA_CONTRACT_POSTGRES_SESSION_REQUIRED';
  END IF;

  SELECT pg_catalog.count(*) INTO public_table_count
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
   WHERE namespace.nspname = 'public'
     AND relation.relkind IN ('r', 'p');
  SELECT pg_catalog.count(*) INTO exact_trigger_count
    FROM pg_catalog.pg_trigger AS trigger_record
    JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger_record.tgrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
   WHERE namespace.nspname = 'public'
     AND relation.relkind IN ('r', 'p')
     AND trigger_record.tgname = 'trg_production_write_fence_20260717'
     AND NOT trigger_record.tgisinternal
     AND trigger_record.tgenabled = 'O'
     AND trigger_record.tgtype = 62
     AND trigger_record.tgfoid =
       'public.production_write_fence_guard_20260717()'::pg_catalog.regprocedure;

  IF pg_catalog.to_regprocedure(
       'public.production_successor_canonical_json_20260819(jsonb)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.production_successor_live_schema_contract_20260819()'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'PRODUCTION_SUCCESSOR_SCHEMA_CONTRACT_OBJECT_COLLISION';
  END IF;

  IF public_table_count = 0
     OR exact_trigger_count <> public_table_count
     OR pg_catalog.to_regclass('public.production_release_lease_20260717') IS NULL
     OR pg_catalog.to_regprocedure(
       'public.production_write_fence_guard_20260717()'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.production_write_fence_attach_20260717()'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.production_live_schema_contract_20260717()'
     ) IS NULL
     OR (SELECT pg_catalog.md5(procedure_record.prosrc)
           FROM pg_catalog.pg_proc AS procedure_record
          WHERE procedure_record.oid = pg_catalog.to_regprocedure(
            'public.production_write_fence_guard_20260717()'
          )) <> 'e9dc644c0ad98b742bde0e3c83c26f93'
     OR (SELECT pg_catalog.md5(procedure_record.prosrc)
           FROM pg_catalog.pg_proc AS procedure_record
          WHERE procedure_record.oid = pg_catalog.to_regprocedure(
            'public.production_write_fence_attach_20260717()'
          )) <> '9053c6d394854777b878bd219203b06a'
     OR (SELECT pg_catalog.md5(procedure_record.prosrc)
           FROM pg_catalog.pg_proc AS procedure_record
          WHERE procedure_record.oid = pg_catalog.to_regprocedure(
            'public.production_live_schema_contract_20260717()'
          )) <> '96ee93c897faa81bae68c8c65e29610b'
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_class AS relation
        WHERE relation.oid = 'public.production_release_lease_20260717'::pg_catalog.regclass
          AND relation.relkind = 'r'
          AND relation.relrowsecurity
          AND relation.relforcerowsecurity
          AND pg_catalog.pg_get_userbyid(relation.relowner) = 'postgres'
     )
     OR pg_catalog.has_table_privilege(
       'anon', 'public.production_release_lease_20260717',
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'
     )
     OR pg_catalog.has_table_privilege(
       'authenticated', 'public.production_release_lease_20260717',
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'
     )
     OR pg_catalog.has_table_privilege(
       'service_role', 'public.production_release_lease_20260717',
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'
     )
     OR (SELECT pg_catalog.count(*)
           FROM pg_catalog.pg_event_trigger AS event_trigger_record
          WHERE event_trigger_record.evtname IN (
            'evt_production_write_fence_ddl_lock_20260717',
            'evt_production_write_fence_20260717'
          )
            AND event_trigger_record.evtenabled = 'O'
            AND event_trigger_record.evtfoid =
              'public.production_write_fence_attach_20260717()'::pg_catalog.regprocedure
            AND pg_catalog.pg_get_userbyid(event_trigger_record.evtowner) = 'postgres'
         ) <> 2 THEN
    RAISE EXCEPTION 'PRODUCTION_SUCCESSOR_SCHEMA_CONTRACT_OLD_FENCE_INVALID';
  END IF;
END
$precondition$;

CREATE FUNCTION public.production_successor_canonical_json_20260819(value jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
DECLARE
  value_kind text := pg_catalog.jsonb_typeof(value);
  canonical text;
BEGIN
  IF value_kind = 'object' THEN
    SELECT '{' || COALESCE(pg_catalog.string_agg(
      pg_catalog.to_jsonb(item.key)::text || ':' ||
        public.production_successor_canonical_json_20260819(item.value),
      ',' ORDER BY item.key COLLATE "C"
    ), '') || '}'
      INTO canonical
      FROM pg_catalog.jsonb_each(value) AS item(key, value);
    RETURN canonical;
  ELSIF value_kind = 'array' THEN
    SELECT '[' || COALESCE(pg_catalog.string_agg(
      public.production_successor_canonical_json_20260819(item.value),
      ',' ORDER BY item.ordinality
    ), '') || ']'
      INTO canonical
      FROM pg_catalog.jsonb_array_elements(value)
        WITH ORDINALITY AS item(value, ordinality);
    RETURN canonical;
  END IF;
  RETURN value::text;
END
$function$;

ALTER FUNCTION public.production_successor_canonical_json_20260819(jsonb)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.production_successor_canonical_json_20260819(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.production_successor_live_schema_contract_20260819()
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
WITH target(name) AS (
  VALUES
    ('account_deletion_jobs'::text),
    ('account_deletion_media_manifest'::text),
    ('agencies'::text),
    ('agency_dedupe_candidates'::text),
    ('ai_interactions_log'::text),
    ('amora_action_follow_up_cards_v2'::text),
    ('amora_action_follow_up_outcomes_v2'::text),
    ('amora_actions'::text),
    ('amora_care_deliveries'::text),
    ('amora_care_jobs'::text),
    ('amora_care_scan_states'::text),
    ('amora_chat_request_claims'::text),
    ('amora_conflict_check_claims'::text),
    ('amora_couple_core_criterion_acceptances'::text),
    ('amora_couple_core_criterion_proposals'::text),
    ('amora_couple_profiles'::text),
    ('amora_first_use_action_promotions'::text),
    ('amora_first_use_action_proposal_bindings'::text),
    ('amora_mediation_acceptances'::text),
    ('amora_mediation_outcome_follow_up_cards'::text),
    ('amora_mediation_outcome_follow_up_receipts'::text),
    ('amora_mediation_private_safety_holds'::text),
    ('amora_memory_consents'::text),
    ('amora_memory_enqueue_repair_candidates'::text),
    ('amora_memory_enqueue_repair_dead_letters'::text),
    ('amora_memory_jobs'::text),
    ('amora_memory_settings'::text),
    ('amora_personalization_preferences'::text),
    ('amora_preparation_catch_up_items'::text),
    ('amora_preparation_catch_up_receipts'::text),
    ('amora_preparation_topic_message_refs'::text),
    ('amora_privacy_context_epochs'::text),
    ('amora_private_chat_delete_boundaries'::text),
    ('amora_provider_egress_grants'::text),
    ('amora_provider_runtime_control'::text),
    ('amora_saved_notes'::text),
    ('amora_shared_action_acceptances'::text),
    ('amora_shared_action_application_claims'::text),
    ('amora_shared_action_journey_mutation_receipts'::text),
    ('amora_shared_action_roster_bindings'::text),
    ('amora_today_one_preferences'::text),
    ('amora_today_one_recipient_states'::text),
    ('amora_today_one_signals'::text),
    ('amora_tool_executions'::text),
    ('amora_turn_counters'::text),
    ('amora_turn_requests'::text),
    ('booking_cancellation_receipts'::text),
    ('booking_cancellation_write_authorizations'::text),
    ('booking_intent_write_authorizations'::text),
    ('booking_outcome_write_authorizations'::text),
    ('booking_projection_jobs'::text),
    ('booking_projection_write_authorizations'::text),
    ('chat_feedback'::text),
    ('chat_messages'::text),
    ('chat_summaries'::text),
    ('cohort_moderation_events'::text),
    ('combos'::text),
    ('community_commands'::text),
    ('community_comment_commands'::text),
    ('community_comment_delete_receipts'::text),
    ('community_decision_answers'::text),
    ('community_decision_beta_members'::text),
    ('community_decision_outcome_publications'::text),
    ('community_decision_outcomes'::text),
    ('community_decision_publication_commands'::text),
    ('community_decision_thread_events'::text),
    ('community_decision_thread_intakes'::text),
    ('community_decision_threads'::text),
    ('community_moderation_appeal_decisions'::text),
    ('community_moderation_appeals'::text),
    ('community_moderation_cases'::text),
    ('community_moderation_command_receipts'::text),
    ('community_moderation_events'::text),
    ('community_moderation_holds'::text),
    ('community_moderation_notices'::text),
    ('community_notification_push_preferences'::text),
    ('community_poll_vote_commands'::text),
    ('community_poll_vote_quarantine'::text),
    ('community_post_delete_receipts'::text),
    ('community_post_write_commands'::text),
    ('community_reply_notifications'::text),
    ('community_responder_command_receipts'::text),
    ('community_responder_questions'::text),
    ('community_responder_requests'::text),
    ('community_responder_supply_events'::text),
    ('community_runtime_control'::text),
    ('community_runtime_control_events'::text),
    ('community_thread_evidence_selections'::text),
    ('community_upload_sessions'::text),
    ('community_viewer_control_events'::text),
    ('community_viewer_controls'::text),
    ('conversation_segments'::text),
    ('couple_change_notifications'::text),
    ('couple_invite_join_attempts'::text),
    ('couple_invite_join_runtime_state'::text),
    ('couple_invite_redemptions'::text),
    ('couple_plan_change_acceptances'::text),
    ('couple_plan_change_requests'::text),
    ('couples'::text),
    ('decision_nodes'::text),
    ('disclosure_semantic_staging'::text),
    ('events'::text),
    ('mobile_push_device_tokens'::text),
    ('notification_delivery_outbox'::text),
    ('official_agency_packages'::text),
    ('official_price_options'::text),
    ('official_prices'::text),
    ('official_review_events'::text),
    ('price_alerts'::text),
    ('price_snapshots'::text),
    ('price_upload_confirmation_events'::text),
    ('price_upload_confirmations'::text),
    ('profiles'::text),
    ('responder_capacity_slots'::text),
    ('tags'::text),
    ('vendor_alias_proposals'::text),
    ('vendor_dedupe_candidates'::text),
    ('vendor_demand_daily'::text),
    ('vendor_disclosure_bulk_approval_audits'::text),
    ('vendor_disclosure_ingest_batches'::text),
    ('vendor_disclosure_ingest_dedupe_links'::text),
    ('vendor_disclosure_ingest_identity_links'::text),
    ('vendor_disclosure_ingest_owned_identities'::text),
    ('vendor_disclosure_ingest_owned_ledger_rows'::text),
    ('vendor_disclosure_ingest_owned_rows'::text),
    ('vendor_disclosure_ingest_record_bindings'::text),
    ('vendor_disclosure_ingest_runs'::text),
    ('vendor_disclosure_ingest_storage_links'::text),
    ('vendor_disclosure_ingest_unit_provider_lineage'::text),
    ('vendor_disclosure_paid_extraction_attestations'::text),
    ('vendor_enrichment_private'::text),
    ('vendor_inquiry_handoffs'::text),
    ('vendor_reviews'::text),
    ('vendor_tags'::text),
    ('wedding_court_cases'::text),
    ('wedding_court_votes'::text),
    ('wedding_journeys'::text),
    ('wedding_payment_ledger'::text),
    ('wishlists'::text)
),
target_relations AS MATERIALIZED (
  SELECT target.name, relation.oid, relation.relkind, relation.relrowsecurity,
         relation.relforcerowsecurity, relation.relowner, relation.relacl
    FROM target
    LEFT JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.nspname = 'public'
    LEFT JOIN pg_catalog.pg_class AS relation
      ON relation.relnamespace = namespace.oid
     AND relation.relname = target.name
),
portable_columns_contract AS MATERIALIZED (
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'table', 'public.' || relation.relname,
    'ordinal_position', attribute.attnum,
    'column_name', attribute.attname,
    'data_type', pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
    'not_null', attribute.attnotnull,
    'identity', attribute.attidentity::text,
    'generated', attribute.attgenerated::text,
    'default_expression', pg_catalog.pg_get_expr(defaults.adbin, defaults.adrelid),
    'collation', CASE WHEN collation_record.oid IS NULL THEN NULL
      ELSE collation_namespace.nspname || '.' || collation_record.collname END
  ) ORDER BY relation.relname, attribute.attnum), '[]'::jsonb) AS value
    FROM target_relations AS target_relation
    JOIN pg_catalog.pg_class AS relation ON relation.oid = target_relation.oid
    JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = relation.oid
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
    LEFT JOIN pg_catalog.pg_attrdef AS defaults
      ON defaults.adrelid = relation.oid AND defaults.adnum = attribute.attnum
    LEFT JOIN pg_catalog.pg_collation AS collation_record
      ON collation_record.oid = attribute.attcollation AND attribute.attcollation <> 0
    LEFT JOIN pg_catalog.pg_namespace AS collation_namespace
      ON collation_namespace.oid = collation_record.collnamespace
),
public_constraints AS MATERIALIZED (
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'table', 'public.' || relation.relname,
    'name', item.conname,
    'type', item.contype::text,
    'definition', pg_catalog.pg_get_constraintdef(item.oid, false),
    'columns', COALESCE((SELECT pg_catalog.jsonb_agg(attribute.attname ORDER BY keys.ordinality)
      FROM pg_catalog.unnest(item.conkey) WITH ORDINALITY AS keys(attnum, ordinality)
      JOIN pg_catalog.pg_attribute AS attribute
        ON attribute.attrelid = relation.oid AND attribute.attnum = keys.attnum), '[]'::jsonb),
    'referenced_table', CASE WHEN item.confrelid = 0 THEN NULL
      ELSE referenced_namespace.nspname || '.' || referenced_relation.relname END,
    'referenced_columns', COALESCE((SELECT pg_catalog.jsonb_agg(attribute.attname ORDER BY keys.ordinality)
      FROM pg_catalog.unnest(item.confkey) WITH ORDINALITY AS keys(attnum, ordinality)
      JOIN pg_catalog.pg_attribute AS attribute
        ON attribute.attrelid = item.confrelid AND attribute.attnum = keys.attnum), '[]'::jsonb)
  ) ORDER BY relation.relname, item.conname), '[]'::jsonb) AS value
    FROM target_relations AS target_relation
    JOIN pg_catalog.pg_class AS relation ON relation.oid = target_relation.oid
    JOIN pg_catalog.pg_constraint AS item ON item.conrelid = relation.oid
    LEFT JOIN pg_catalog.pg_class AS referenced_relation
      ON referenced_relation.oid = item.confrelid
    LEFT JOIN pg_catalog.pg_namespace AS referenced_namespace
      ON referenced_namespace.oid = referenced_relation.relnamespace
),
indexes_contract AS MATERIALIZED (
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'table', 'public.' || relation.relname,
    'index', index_namespace.nspname || '.' || index_relation.relname,
    'definition', pg_catalog.pg_get_indexdef(index_relation.oid),
    'valid', index_record.indisvalid,
    'ready', index_record.indisready
  ) ORDER BY relation.relname, index_relation.relname), '[]'::jsonb) AS value
    FROM target_relations AS target_relation
    JOIN pg_catalog.pg_class AS relation ON relation.oid = target_relation.oid
    JOIN pg_catalog.pg_index AS index_record ON index_record.indrelid = relation.oid
    JOIN pg_catalog.pg_class AS index_relation ON index_relation.oid = index_record.indexrelid
    JOIN pg_catalog.pg_namespace AS index_namespace
      ON index_namespace.oid = index_relation.relnamespace
),
policies_contract AS MATERIALIZED (
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'table', 'public.' || relation.relname,
    'name', policy.polname,
    'command', policy.polcmd::text,
    'permissive', policy.polpermissive,
    'roles', (SELECT COALESCE(pg_catalog.jsonb_agg(
      CASE WHEN roles.role_oid = 0 THEN 'PUBLIC'
        ELSE pg_catalog.pg_get_userbyid(roles.role_oid) END
      ORDER BY CASE WHEN roles.role_oid = 0 THEN 'PUBLIC'
        ELSE pg_catalog.pg_get_userbyid(roles.role_oid) END
    ), '[]'::jsonb) FROM pg_catalog.unnest(policy.polroles) AS roles(role_oid)),
    'using_expression', pg_catalog.pg_get_expr(policy.polqual, policy.polrelid),
    'check_expression', pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid)
  ) ORDER BY relation.relname, policy.polname), '[]'::jsonb) AS value
    FROM target_relations AS target_relation
    JOIN pg_catalog.pg_class AS relation ON relation.oid = target_relation.oid
    JOIN pg_catalog.pg_policy AS policy ON policy.polrelid = relation.oid
),
triggers_contract AS MATERIALIZED (
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'table', 'public.' || relation.relname,
    'name', trigger_record.tgname,
    'enabled', trigger_record.tgenabled::text,
    'definition', pg_catalog.pg_get_triggerdef(trigger_record.oid, false),
    'function_identity', function_namespace.nspname || '.' || function_record.proname
      || '(' || pg_catalog.pg_get_function_identity_arguments(function_record.oid) || ')'
  ) ORDER BY relation.relname, trigger_record.tgname), '[]'::jsonb) AS value
    FROM target_relations AS target_relation
    JOIN pg_catalog.pg_class AS relation ON relation.oid = target_relation.oid
    JOIN pg_catalog.pg_trigger AS trigger_record
      ON trigger_record.tgrelid = relation.oid AND NOT trigger_record.tgisinternal
    JOIN pg_catalog.pg_proc AS function_record ON function_record.oid = trigger_record.tgfoid
    JOIN pg_catalog.pg_namespace AS function_namespace
      ON function_namespace.oid = function_record.pronamespace
),
tables_contract AS MATERIALIZED (
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'name', 'public.' || relation.name,
    'relkind', relation.relkind::text,
    'rls', relation.relrowsecurity,
    'force_rls', relation.relforcerowsecurity,
    'owner', pg_catalog.pg_get_userbyid(relation.relowner),
    'has_inheritance_children', EXISTS(
      SELECT 1 FROM pg_catalog.pg_inherits WHERE inhparent = relation.oid
    ),
    'is_inheritance_child', EXISTS(
      SELECT 1 FROM pg_catalog.pg_inherits WHERE inhrelid = relation.oid
    ),
    'acl', (SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'grantor', pg_catalog.pg_get_userbyid(acl.grantor),
      'grantee', CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
        ELSE pg_catalog.pg_get_userbyid(acl.grantee) END,
      'privilege', acl.privilege_type,
      'grantable', acl.is_grantable
    ) ORDER BY acl.grantee, acl.privilege_type, acl.is_grantable), '[]'::jsonb)
      FROM pg_catalog.aclexplode(COALESCE(
        relation.relacl,
        pg_catalog.acldefault('r', relation.relowner)
      )) AS acl)
  ) ORDER BY relation.name), '[]'::jsonb) AS value
    FROM target_relations AS relation
),
schema_rows AS MATERIALIZED (
  SELECT namespace.nspname AS schema_name,
         relation.relname AS table_name,
         attribute.attnum AS ordinal_position,
         attribute.attname AS column_name,
         pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) AS data_type,
         attribute.attnotnull AS not_null,
         attribute.attidentity::text AS identity,
         attribute.attgenerated::text AS generated,
         pg_catalog.pg_get_expr(defaults.adbin, defaults.adrelid) AS default_expression,
         CASE WHEN collation_record.oid IS NULL THEN NULL
           ELSE collation_namespace.nspname || '.' || collation_record.collname END AS collation_name
    FROM pg_catalog.pg_namespace AS namespace
    JOIN pg_catalog.pg_class AS relation
      ON relation.relnamespace = namespace.oid AND relation.relkind = 'r'
    JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = relation.oid
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
    LEFT JOIN pg_catalog.pg_attrdef AS defaults
      ON defaults.adrelid = relation.oid AND defaults.adnum = attribute.attnum
    LEFT JOIN pg_catalog.pg_collation AS collation_record
      ON collation_record.oid = attribute.attcollation AND attribute.attcollation <> 0
    LEFT JOIN pg_catalog.pg_namespace AS collation_namespace
      ON collation_namespace.oid = collation_record.collnamespace
   WHERE (namespace.nspname = 'auth' AND relation.relname = 'users')
      OR (namespace.nspname = 'storage' AND relation.relname IN ('buckets', 'objects'))
),
public_schema_contract AS MATERIALIZED (
  SELECT pg_catalog.jsonb_build_object(
    'tables', (SELECT value FROM tables_contract),
    'columns', (SELECT value FROM portable_columns_contract),
    'constraints', (SELECT value FROM public_constraints),
    'indexes', (SELECT value FROM indexes_contract),
    'policies', (SELECT value FROM policies_contract),
    'triggers', (SELECT value FROM triggers_contract)
  ) AS value
),
auth_schema_contract AS MATERIALIZED (
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'table', schema_name || '.' || table_name,
    'ordinal_position', ordinal_position,
    'column_name', column_name,
    'data_type', data_type,
    'not_null', not_null,
    'identity', identity,
    'generated', generated,
    'default_expression', default_expression,
    'collation', collation_name
  ) ORDER BY table_name, ordinal_position), '[]'::jsonb) AS value
    FROM schema_rows WHERE schema_name = 'auth'
),
storage_schema_contract AS MATERIALIZED (
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'table', schema_name || '.' || table_name,
    'ordinal_position', ordinal_position,
    'column_name', column_name,
    'data_type', data_type,
    'not_null', not_null,
    'identity', identity,
    'generated', generated,
    'default_expression', default_expression,
    'collation', collation_name
  ) ORDER BY table_name, ordinal_position), '[]'::jsonb) AS value
    FROM schema_rows WHERE schema_name = 'storage'
),
root_contract AS MATERIALIZED (
  SELECT pg_catalog.jsonb_build_object(
    'public', (SELECT value FROM public_schema_contract),
    'auth', (SELECT value FROM auth_schema_contract),
    'storage', (SELECT value FROM storage_schema_contract)
  ) AS value
)
SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
  public.production_successor_canonical_json_20260819(value) || E'\n',
  'UTF8'
)), 'hex')
  FROM root_contract
 WHERE (SELECT pg_catalog.count(*) FROM target_relations
         WHERE oid IS NOT NULL AND relkind = 'r') = 139
   AND NOT EXISTS (SELECT 1 FROM target_relations
                    WHERE oid IS NULL OR relkind <> 'r')
   AND (SELECT pg_catalog.count(*) FROM schema_rows
         WHERE schema_name = 'auth' AND table_name = 'users') > 0
   AND (SELECT pg_catalog.count(DISTINCT table_name) FROM schema_rows
         WHERE schema_name = 'storage') = 2
$function$;

ALTER FUNCTION public.production_successor_live_schema_contract_20260819()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.production_successor_live_schema_contract_20260819()
  FROM PUBLIC, anon, authenticated, service_role;

DO $metadata_postcondition$
BEGIN
  IF pg_catalog.pg_get_userbyid((SELECT procedure_record.proowner
       FROM pg_catalog.pg_proc AS procedure_record
      WHERE procedure_record.oid = pg_catalog.to_regprocedure(
        'public.production_successor_canonical_json_20260819(jsonb)'
      ))) <> 'postgres'
     OR (SELECT procedure_record.prosecdef
               OR procedure_record.provolatile <> 'i'
               OR NOT procedure_record.proisstrict
               OR procedure_record.proparallel <> 's'
           FROM pg_catalog.pg_proc AS procedure_record
          WHERE procedure_record.oid = pg_catalog.to_regprocedure(
            'public.production_successor_canonical_json_20260819(jsonb)'
          ))
     OR (SELECT procedure_record.proconfig
           FROM pg_catalog.pg_proc AS procedure_record
          WHERE procedure_record.oid = pg_catalog.to_regprocedure(
            'public.production_successor_canonical_json_20260819(jsonb)'
          )) IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
     OR pg_catalog.pg_get_userbyid((SELECT procedure_record.proowner
       FROM pg_catalog.pg_proc AS procedure_record
      WHERE procedure_record.oid = pg_catalog.to_regprocedure(
        'public.production_successor_live_schema_contract_20260819()'
      ))) <> 'postgres'
     OR (SELECT procedure_record.prosecdef
               OR procedure_record.provolatile <> 's'
               OR procedure_record.proisstrict
               OR procedure_record.proparallel <> 'u'
           FROM pg_catalog.pg_proc AS procedure_record
          WHERE procedure_record.oid = pg_catalog.to_regprocedure(
            'public.production_successor_live_schema_contract_20260819()'
          ))
     OR (SELECT procedure_record.proconfig
           FROM pg_catalog.pg_proc AS procedure_record
          WHERE procedure_record.oid = pg_catalog.to_regprocedure(
            'public.production_successor_live_schema_contract_20260819()'
          )) IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
     OR pg_catalog.has_function_privilege(
       'anon', 'public.production_successor_canonical_json_20260819(jsonb)', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated', 'public.production_successor_canonical_json_20260819(jsonb)', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role', 'public.production_successor_canonical_json_20260819(jsonb)', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon', 'public.production_successor_live_schema_contract_20260819()', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated', 'public.production_successor_live_schema_contract_20260819()', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role', 'public.production_successor_live_schema_contract_20260819()', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'PRODUCTION_SUCCESSOR_SCHEMA_CONTRACT_METADATA_INVALID';
  END IF;
END
$metadata_postcondition$;

COMMIT;
