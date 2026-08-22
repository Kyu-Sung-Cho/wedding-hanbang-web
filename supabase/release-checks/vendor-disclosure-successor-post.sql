BEGIN TRANSACTION READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

WITH
expected_successor_tables(table_name) AS (VALUES
  ('agencies'::name),
  ('agency_dedupe_candidates'::name),
  ('amora_action_follow_up_cards_v2'::name),
  ('amora_action_follow_up_outcomes_v2'::name),
  ('amora_couple_core_criterion_acceptances'::name),
  ('amora_couple_core_criterion_proposals'::name),
  ('amora_first_use_action_promotions'::name),
  ('amora_first_use_action_proposal_bindings'::name),
  ('amora_mediation_outcome_follow_up_cards'::name),
  ('amora_mediation_outcome_follow_up_receipts'::name),
  ('amora_mediation_private_safety_holds'::name),
  ('amora_memory_enqueue_repair_candidates'::name),
  ('amora_memory_enqueue_repair_dead_letters'::name),
  ('amora_personalization_preferences'::name),
  ('amora_preparation_catch_up_items'::name),
  ('amora_preparation_catch_up_receipts'::name),
  ('amora_preparation_topic_message_refs'::name),
  ('amora_privacy_context_epochs'::name),
  ('amora_private_chat_delete_boundaries'::name),
  ('amora_provider_egress_grants'::name),
  ('amora_provider_runtime_control'::name),
  ('amora_saved_notes'::name),
  ('amora_shared_action_acceptances'::name),
  ('amora_shared_action_application_claims'::name),
  ('amora_shared_action_journey_mutation_receipts'::name),
  ('amora_shared_action_roster_bindings'::name),
  ('amora_today_one_preferences'::name),
  ('amora_today_one_recipient_states'::name),
  ('amora_today_one_signals'::name),
  ('booking_cancellation_receipts'::name),
  ('booking_cancellation_write_authorizations'::name),
  ('booking_intent_write_authorizations'::name),
  ('booking_outcome_write_authorizations'::name),
  ('booking_projection_write_authorizations'::name),
  ('cohort_moderation_events'::name),
  ('combos'::name),
  ('community_commands'::name),
  ('community_comment_commands'::name),
  ('community_comment_delete_receipts'::name),
  ('community_decision_answers'::name),
  ('community_decision_beta_members'::name),
  ('community_decision_outcome_publications'::name),
  ('community_decision_outcomes'::name),
  ('community_decision_publication_commands'::name),
  ('community_decision_thread_events'::name),
  ('community_decision_thread_intakes'::name),
  ('community_decision_threads'::name),
  ('community_moderation_appeal_decisions'::name),
  ('community_moderation_appeals'::name),
  ('community_moderation_cases'::name),
  ('community_moderation_command_receipts'::name),
  ('community_moderation_events'::name),
  ('community_moderation_holds'::name),
  ('community_moderation_notices'::name),
  ('community_notification_push_preferences'::name),
  ('community_poll_vote_commands'::name),
  ('community_poll_vote_quarantine'::name),
  ('community_post_delete_receipts'::name),
  ('community_post_write_commands'::name),
  ('community_reply_notifications'::name),
  ('community_responder_command_receipts'::name),
  ('community_responder_questions'::name),
  ('community_responder_requests'::name),
  ('community_responder_supply_events'::name),
  ('community_runtime_control'::name),
  ('community_runtime_control_events'::name),
  ('community_thread_evidence_selections'::name),
  ('community_viewer_control_events'::name),
  ('community_viewer_controls'::name),
  ('conversation_segments'::name),
  ('couple_change_notifications'::name),
  ('couple_invite_join_attempts'::name),
  ('couple_invite_join_runtime_state'::name),
  ('couple_invite_redemptions'::name),
  ('couple_plan_change_acceptances'::name),
  ('couple_plan_change_requests'::name),
  ('disclosure_semantic_staging'::name),
  ('events'::name),
  ('mobile_push_device_tokens'::name),
  ('notification_delivery_outbox'::name),
  ('official_agency_packages'::name),
  ('official_price_options'::name),
  ('official_prices'::name),
  ('official_review_events'::name),
  ('price_alerts'::name),
  ('price_snapshots'::name),
  ('price_upload_confirmation_events'::name),
  ('price_upload_confirmations'::name),
  ('responder_capacity_slots'::name),
  ('tags'::name),
  ('vendor_alias_proposals'::name),
  ('vendor_dedupe_candidates'::name),
  ('vendor_demand_daily'::name),
  ('vendor_disclosure_bulk_approval_audits'::name),
  ('vendor_disclosure_ingest_batches'::name),
  ('vendor_disclosure_ingest_dedupe_links'::name),
  ('vendor_disclosure_ingest_identity_links'::name),
  ('vendor_disclosure_ingest_owned_identities'::name),
  ('vendor_disclosure_ingest_owned_ledger_rows'::name),
  ('vendor_disclosure_ingest_owned_rows'::name),
  ('vendor_disclosure_ingest_record_bindings'::name),
  ('vendor_disclosure_ingest_runs'::name),
  ('vendor_disclosure_ingest_storage_links'::name),
  ('vendor_disclosure_ingest_unit_provider_lineage'::name),
  ('vendor_disclosure_paid_extraction_attestations'::name),
  ('vendor_enrichment_private'::name),
  ('vendor_inquiry_handoffs'::name),
  ('vendor_tags'::name),
  ('wedding_court_cases'::name),
  ('wedding_court_votes'::name),
  ('wedding_payment_ledger'::name),
  ('wishlists'::name)
),
successor_table_contract AS (
  SELECT pg_catalog.count(*)::integer AS value
  FROM expected_successor_tables AS expected
  JOIN pg_catalog.pg_namespace AS namespace_record
    ON namespace_record.nspname = 'public'
  JOIN pg_catalog.pg_class AS relation_record
    ON relation_record.relnamespace = namespace_record.oid
   AND relation_record.relname = expected.table_name
   AND relation_record.relkind IN ('r', 'p')
),
expected_successor_migrations(version) AS (VALUES
  ('20260730100000'::text),
  ('20260730101000'::text),
  ('20260730102000'::text),
  ('20260731123000'::text),
  ('20260731170000'::text),
  ('20260731173000'::text),
  ('20260731174000'::text),
  ('20260731180000'::text),
  ('20260731181000'::text),
  ('20260731182000'::text),
  ('20260731183000'::text),
  ('20260731184000'::text),
  ('20260731185000'::text),
  ('20260731190000'::text),
  ('20260731191000'::text),
  ('20260731192000'::text),
  ('20260801090000'::text),
  ('20260801100000'::text),
  ('20260802090000'::text),
  ('20260802100000'::text),
  ('20260802110000'::text),
  ('20260802120000'::text),
  ('20260802130000'::text),
  ('20260802140000'::text),
  ('20260802150000'::text),
  ('20260802160000'::text),
  ('20260802170000'::text),
  ('20260802180000'::text),
  ('20260802190000'::text),
  ('20260802200000'::text),
  ('20260802210000'::text),
  ('20260802220000'::text),
  ('20260802230000'::text),
  ('20260802240000'::text),
  ('20260804103000'::text),
  ('20260804120000'::text),
  ('20260804130000'::text),
  ('20260804140000'::text),
  ('20260804150000'::text),
  ('20260804160000'::text),
  ('20260804170000'::text),
  ('20260804180000'::text),
  ('20260804185000'::text),
  ('20260804190000'::text),
  ('20260804193000'::text),
  ('20260804194000'::text),
  ('20260804195000'::text),
  ('20260804200000'::text),
  ('20260805120000'::text),
  ('20260806090000'::text),
  ('20260807090000'::text),
  ('20260811230000'::text),
  ('20260812030000'::text),
  ('20260812090000'::text),
  ('20260812100000'::text),
  ('20260812120000'::text),
  ('20260812130000'::text),
  ('20260812140000'::text),
  ('20260814120000'::text),
  ('20260814130000'::text),
  ('20260814140000'::text),
  ('20260815120000'::text),
  ('20260815130000'::text),
  ('20260816120000'::text),
  ('20260816130000'::text),
  ('20260816140000'::text),
  ('20260816150000'::text),
  ('20260816160000'::text),
  ('20260816170000'::text),
  ('20260816180000'::text),
  ('20260816190000'::text),
  ('20260818100000'::text),
  ('20260818110000'::text),
  ('20260818120000'::text),
  ('20260818130000'::text),
  ('20260818140000'::text),
  ('20260818150000'::text),
  ('20260818160000'::text),
  ('20260818170000'::text),
  ('20260818180000'::text),
  ('20260819090000'::text),
  ('20260819100000'::text),
  ('20260820120000'::text),
  ('20260820130000'::text),
  ('20260820140000'::text),
  ('20260820150000'::text)
),
migration_ledger_contract AS (
  SELECT (
    CASE WHEN
      (SELECT pg_catalog.count(*) FROM expected_successor_migrations) = 86
      AND (
        SELECT pg_catalog.count(*)
        FROM expected_successor_migrations AS expected
        JOIN supabase_migrations.schema_migrations AS applied
          ON applied.version::text = expected.version
      ) = 86
      AND (
        SELECT pg_catalog.max(version::text)
        FROM supabase_migrations.schema_migrations
      ) IS NOT DISTINCT FROM '20260820150000'
      AND NOT EXISTS (
        SELECT 1
        FROM supabase_migrations.schema_migrations AS applied
        WHERE applied.version::text BETWEEN '20260730100000' AND '20260820150000'
          AND NOT EXISTS (
            SELECT 1
            FROM expected_successor_migrations AS expected
            WHERE expected.version = applied.version::text
          )
      )
    THEN 1 ELSE 0 END
  )::integer AS value
),
expected_rpc(signature, allowed_role, required_config) AS (VALUES
  ('public.start_amora_conversation_segment(uuid,text,uuid,uuid,text)'::text, 'none'::name,
   ARRAY['search_path=pg_catalog, public', 'statement_timeout=15s']::text[]),
  ('public.finalize_amora_first_use_action_proposal_v1(uuid,uuid,uuid,text,integer,bigint)'::text, 'service_role'::name,
   ARRAY['search_path=pg_catalog, public', 'lock_timeout=5s', 'statement_timeout=15s']::text[]),
  ('public.finalize_amora_first_use_action_application_v1(uuid,uuid,uuid,uuid,text,integer,bigint)'::text, 'service_role'::name,
   ARRAY['search_path=pg_catalog, public', 'lock_timeout=5s', 'statement_timeout=15s']::text[]),
  ('public.finalize_amora_provider_backed_add_action_application_v1(uuid,uuid,uuid,uuid,text,integer,bigint)'::text, 'service_role'::name,
   ARRAY['search_path=pg_catalog, public', 'lock_timeout=5s', 'statement_timeout=15s']::text[]),
  ('public.complete_amora_booking_outcome_atomic(uuid,uuid,numeric,numeric,integer,text,boolean)'::text, 'service_role'::name,
   ARRAY['search_path=pg_catalog, public', 'lock_timeout=5s', 'statement_timeout=20s']::text[]),
  ('public.create_neutral_preparation_space_for_current_user()'::text, 'authenticated'::name,
   ARRAY['search_path=pg_catalog, public, auth', 'lock_timeout=5s', 'statement_timeout=30s']::text[]),
  ('public.join_neutral_preparation_space_server(uuid,text)'::text, 'service_role'::name,
   ARRAY['search_path=pg_catalog, public', 'lock_timeout=5s', 'statement_timeout=30s']::text[]),
  ('public.finalize_amora_preparation_catch_up_v1(uuid,uuid,uuid,bigint,jsonb)'::text, 'service_role'::name,
   ARRAY['search_path=pg_catalog, public, extensions', 'lock_timeout=5s', 'statement_timeout=30s']::text[]),
  ('public.list_amora_preparation_notes_v1(uuid,uuid,bigint,text,timestamp with time zone,timestamp with time zone,uuid,integer)'::text, 'service_role'::name,
   ARRAY['search_path=pg_catalog, public', 'lock_timeout=5s', 'statement_timeout=15s']::text[]),
  ('public.list_amora_preparation_action_receipt_bindings_v1(uuid,uuid,bigint,uuid[])'::text, 'service_role'::name,
   ARRAY['search_path=pg_catalog, public', 'lock_timeout=5s', 'statement_timeout=15s']::text[])
),
rpc_acl_contract AS (
  SELECT expected.signature,
         (
           procedure_record.oid IS NOT NULL
           AND procedure_record.prosecdef
           AND pg_catalog.pg_get_userbyid(procedure_record.proowner) = 'postgres'
           AND procedure_record.proconfig IS NOT DISTINCT FROM expected.required_config
           AND NOT COALESCE(pg_catalog.has_function_privilege(
             'anon', procedure_record.oid, 'EXECUTE'
           ), false)
           AND pg_catalog.has_function_privilege(
             'authenticated', procedure_record.oid, 'EXECUTE'
           ) IS NOT DISTINCT FROM (expected.allowed_role = 'authenticated')
           AND pg_catalog.has_function_privilege(
             'service_role', procedure_record.oid, 'EXECUTE'
           ) IS NOT DISTINCT FROM (expected.allowed_role = 'service_role')
           AND NOT EXISTS (
             SELECT 1
             FROM pg_catalog.aclexplode(COALESCE(
               procedure_record.proacl,
               pg_catalog.acldefault('f', procedure_record.proowner)
             )) AS privilege_record
             WHERE privilege_record.grantee = 0
               AND privilege_record.privilege_type = 'EXECUTE'
           )
         ) AS valid
  FROM expected_rpc AS expected
  LEFT JOIN pg_catalog.pg_proc AS procedure_record
    ON procedure_record.oid = pg_catalog.to_regprocedure(expected.signature)
),
account_deletion_contract AS (
  SELECT (CASE WHEN EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure_record
    WHERE procedure_record.oid = pg_catalog.to_regprocedure(
      'public.prepare_account_deletion_auth_delete(uuid,uuid)'
    )
      AND procedure_record.prosecdef
      AND pg_catalog.pg_get_userbyid(procedure_record.proowner) = 'postgres'
      AND procedure_record.proconfig IS NOT DISTINCT FROM ARRAY['search_path=""']::text[]
      AND pg_catalog.md5(procedure_record.prosrc) = '02eb24e9ed4178f0034ac1cc36940775'
      AND NOT COALESCE(pg_catalog.has_function_privilege(
        'anon', procedure_record.oid, 'EXECUTE'
      ), false)
      AND NOT COALESCE(pg_catalog.has_function_privilege(
        'authenticated', procedure_record.oid, 'EXECUTE'
      ), false)
      AND COALESCE(pg_catalog.has_function_privilege(
        'service_role', procedure_record.oid, 'EXECUTE'
      ), false)
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_record
    JOIN pg_catalog.pg_class AS relation_record
      ON relation_record.oid = constraint_record.conrelid
    JOIN pg_catalog.pg_namespace AS namespace_record
      ON namespace_record.oid = relation_record.relnamespace
    JOIN pg_catalog.pg_attribute AS column_record
      ON column_record.attrelid = constraint_record.conrelid
     AND constraint_record.conkey = ARRAY[column_record.attnum]::smallint[]
    JOIN pg_catalog.pg_attribute AS referenced_column
      ON referenced_column.attrelid = constraint_record.confrelid
     AND constraint_record.confkey = ARRAY[referenced_column.attnum]::smallint[]
    WHERE namespace_record.nspname = 'public'
      AND constraint_record.contype = 'f'
      AND constraint_record.confrelid = pg_catalog.to_regclass('auth.users')
      AND (
        NOT constraint_record.convalidated
        OR constraint_record.condeferrable
        OR constraint_record.condeferred
        OR constraint_record.confmatchtype <> 's'
        OR constraint_record.confupdtype <> 'a'
        OR referenced_column.attname <> 'id'
        OR referenced_column.attisdropped
        OR column_record.attisdropped
        OR constraint_record.confdeltype NOT IN ('c', 'n', 'r')
        OR (constraint_record.confdeltype = 'n' AND column_record.attnotnull)
        OR (
          constraint_record.confdeltype = 'r'
          AND constraint_record.conname <> 'vendors_owner_id_fkey'
        )
      )
  ) THEN 1 ELSE 0 END)::integer AS value
),
chat_trigger_contract AS (
  SELECT (CASE WHEN pg_catalog.count(*) = 1 THEN 1 ELSE 0 END)::integer AS value
  FROM pg_catalog.pg_trigger AS trigger_record
  JOIN pg_catalog.pg_proc AS procedure_record
    ON procedure_record.oid = trigger_record.tgfoid
  WHERE trigger_record.tgrelid = pg_catalog.to_regclass('public.chat_messages')
    AND trigger_record.tgname = 'trg_enforce_chat_partner_recipient'
    AND trigger_record.tgenabled = 'O'
    AND trigger_record.tgtype = 7
    AND NOT trigger_record.tgisinternal
    AND procedure_record.prosecdef
    AND procedure_record.provolatile = 'v'
    AND pg_catalog.pg_get_userbyid(procedure_record.proowner) = 'postgres'
    AND pg_catalog.pg_get_functiondef(procedure_record.oid) LIKE '%FOR SHARE%'
    AND pg_catalog.pg_get_functiondef(procedure_record.oid) LIKE '%partner_recipient_id%'
    AND NOT pg_catalog.has_function_privilege('anon', procedure_record.oid, 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('authenticated', procedure_record.oid, 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('service_role', procedure_record.oid, 'EXECUTE')
),
chat_select_policy_contract AS (
  SELECT (CASE WHEN
    pg_catalog.count(*) = 1
    AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_policies
         WHERE schemaname = 'public' AND tablename = 'chat_messages'
           AND cmd = 'SELECT') = 1
  THEN 1 ELSE 0 END)::integer AS value
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'chat_messages'
    AND policyname = 'chat_select_with_privacy'
    AND permissive = 'PERMISSIVE'
    AND cmd = 'SELECT'
    AND roles = ARRAY['authenticated'::name]
    AND qual LIKE '%partner_recipient_id%'
    AND qual LIKE '%auth.uid()%'
),
chat_insert_policy_contract AS (
  SELECT (CASE WHEN
    NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'chat_messages'
        AND cmd IN ('ALL', 'INSERT')
        AND roles && ARRAY[
          'public'::name, 'anon'::name, 'authenticated'::name
        ]
    )
    AND NOT pg_catalog.has_table_privilege(
      'authenticated', 'public.chat_messages', 'INSERT'
    )
    AND NOT pg_catalog.has_any_column_privilege(
      'authenticated', 'public.chat_messages', 'INSERT'
    )
    AND NOT pg_catalog.has_table_privilege(
      'anon', 'public.chat_messages', 'INSERT'
    )
    AND NOT pg_catalog.has_any_column_privilege(
      'anon', 'public.chat_messages', 'INSERT'
    )
    AND pg_catalog.has_table_privilege(
      'service_role', 'public.chat_messages', 'INSERT'
    )
  THEN 1 ELSE 0 END)::integer AS value
),
conversation_index_contract AS (
  SELECT pg_catalog.count(*)::integer AS value
  FROM (VALUES
    ('conversation_segments_one_active_shared'::name, '%(couple_id)%', '%status%active%'),
    ('conversation_segments_one_active_private_scope'::name, '%(couple_id, visibility)%', '%status%active%'),
    ('conversation_segments_one_active_private_owner'::name, '%(owner_user_id)%', '%status%active%')
  ) AS expected(index_name, key_fragment, predicate_fragment)
  JOIN pg_catalog.pg_class AS index_relation
    ON index_relation.relname = expected.index_name
  JOIN pg_catalog.pg_namespace AS index_namespace
    ON index_namespace.oid = index_relation.relnamespace
   AND index_namespace.nspname = 'public'
  JOIN pg_catalog.pg_index AS index_record
    ON index_record.indexrelid = index_relation.oid
   AND index_record.indrelid = pg_catalog.to_regclass('public.conversation_segments')
   AND index_record.indisunique
   AND index_record.indisvalid
   AND index_record.indisready
  WHERE pg_catalog.pg_get_indexdef(index_record.indexrelid) LIKE expected.key_fragment
    AND pg_catalog.pg_get_expr(index_record.indpred, index_record.indrelid)
      LIKE expected.predicate_fragment
),
conversation_fk_contract AS (
  SELECT pg_catalog.count(*)::integer AS value
  FROM pg_catalog.pg_constraint AS constraint_record
  WHERE constraint_record.conname IN (
      'chat_messages_segment_scope_fk',
      'chat_summaries_segment_scope_fk'
    )
    AND constraint_record.contype = 'f'
    AND constraint_record.confrelid = pg_catalog.to_regclass('public.conversation_segments')
    AND constraint_record.confdeltype = 'r'
    AND constraint_record.confupdtype = 'r'
    AND constraint_record.convalidated
    AND pg_catalog.cardinality(constraint_record.conkey) = 3
    AND pg_catalog.cardinality(constraint_record.confkey) = 3
),
conversation_policy_contract AS (
  SELECT (CASE WHEN
    relation_record.relrowsecurity
    AND pg_catalog.count(policy_record.*) = 1
    AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_policies
         WHERE schemaname = 'public' AND tablename = 'conversation_segments') = 1
  THEN 1 ELSE 0 END)::integer AS value
  FROM pg_catalog.pg_class AS relation_record
  LEFT JOIN pg_catalog.pg_policies AS policy_record
    ON policy_record.schemaname = 'public'
   AND policy_record.tablename = 'conversation_segments'
   AND policy_record.policyname = 'conversation_segments_select_scope'
   AND policy_record.cmd = 'SELECT'
   AND policy_record.roles = ARRAY['authenticated'::name]
   AND policy_record.qual LIKE '%can_access_couple_visibility%'
   AND policy_record.qual LIKE '%owner_user_id%auth.uid()%'
  WHERE relation_record.oid = pg_catalog.to_regclass('public.conversation_segments')
  GROUP BY relation_record.relrowsecurity
),
atomic_function_contract AS (
  SELECT private_record.oid AS private_oid,
         public_record.oid AS public_oid,
         CASE WHEN
           private_record.oid IS NOT NULL
           AND private_record.prosecdef
           AND pg_catalog.pg_get_userbyid(private_record.proowner) = 'postgres'
           AND private_record.proconfig @> ARRAY[
             'search_path=pg_catalog, public',
             'lock_timeout=5s',
             'statement_timeout=15s'
           ]::text[]
           AND NOT pg_catalog.has_function_privilege('anon', private_record.oid, 'EXECUTE')
           AND NOT pg_catalog.has_function_privilege('authenticated', private_record.oid, 'EXECUTE')
           AND NOT pg_catalog.has_function_privilege('service_role', private_record.oid, 'EXECUTE')
         THEN 1 ELSE 0 END::integer AS private_valid,
         CASE WHEN
           public_record.oid IS NOT NULL
           AND public_record.prosecdef
           AND pg_catalog.pg_get_userbyid(public_record.proowner) = 'postgres'
           AND public_record.proconfig @> ARRAY[
             'search_path=pg_catalog, public',
             'lock_timeout=5s',
             'statement_timeout=15s'
           ]::text[]
           AND NOT pg_catalog.has_function_privilege('anon', public_record.oid, 'EXECUTE')
           AND NOT pg_catalog.has_function_privilege('authenticated', public_record.oid, 'EXECUTE')
           AND pg_catalog.has_function_privilege('service_role', public_record.oid, 'EXECUTE')
         THEN 1 ELSE 0 END::integer AS public_valid,
         CASE WHEN
           pg_catalog.pg_get_functiondef(private_record.oid)
             LIKE '%WHEN v_value ->> ''categoryKey'' IN (''mc'', ''gift'') THEN ''/wedding/chat''%'
           AND pg_catalog.pg_get_functiondef(private_record.oid)
             NOT LIKE '%THEN ''/wedding/etiquette''%'
           AND pg_catalog.pg_get_functiondef(private_record.oid)
             LIKE '%char_length(btrim(regexp_replace(%title%'
           AND pg_catalog.pg_get_functiondef(private_record.oid)
             LIKE '%NULLIF(left(btrim(regexp_replace(%description%'
           AND pg_catalog.pg_get_functiondef(public_record.oid)
             LIKE '%apply_amora_atomic_tool_execution_pre_shared_revision%'
         THEN 1 ELSE 0 END::integer AS parity_valid
  FROM pg_catalog.pg_proc AS private_record
  CROSS JOIN pg_catalog.pg_proc AS public_record
  WHERE private_record.oid = pg_catalog.to_regprocedure(
          'public.apply_amora_atomic_tool_execution_pre_shared_revision(uuid,text,text,integer,text,jsonb,jsonb,jsonb)'
        )
    AND public_record.oid = pg_catalog.to_regprocedure(
          'public.apply_amora_atomic_tool_execution(uuid,text,text,integer,text,jsonb,jsonb,jsonb)'
        )
),
booking_provenance_contract AS (
  SELECT (CASE WHEN
    pg_catalog.md5(procedure_record.prosrc) = '8697f4a6b29816116d1573e6793fefe2'
  THEN 1 ELSE 0 END)::integer AS value
  FROM pg_catalog.pg_proc AS procedure_record
  WHERE procedure_record.oid = pg_catalog.to_regprocedure(
    'public.complete_amora_booking_outcome_atomic(uuid,uuid,numeric,numeric,integer,text,boolean)'
  )
),
member_model_contract AS (
  SELECT (CASE WHEN
    EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute
      WHERE attrelid = pg_catalog.to_regclass('public.couples')
        AND attname = 'member_model_version'
        AND atttypid = 'pg_catalog.int2'::regtype
        AND attnotnull
        AND NOT attisdropped
        AND pg_catalog.pg_get_expr(
          (SELECT adbin FROM pg_catalog.pg_attrdef
           WHERE adrelid = attrelid AND adnum = attnum),
          attrelid
        ) = '1'
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint
      WHERE conrelid = pg_catalog.to_regclass('public.couples')
        AND conname = 'couples_member_model_version_check'
        AND contype = 'c'
        AND convalidated
        AND pg_catalog.pg_get_constraintdef(oid) LIKE '%member_model_version%1%2%'
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_record
      JOIN pg_catalog.pg_proc AS procedure_record ON procedure_record.oid = trigger_record.tgfoid
      WHERE trigger_record.tgrelid = pg_catalog.to_regclass('public.couples')
        AND trigger_record.tgname = 'trg_enforce_couple_member_model_version'
        AND trigger_record.tgenabled = 'O'
        AND NOT trigger_record.tgisinternal
        AND procedure_record.prosecdef
        AND pg_catalog.pg_get_userbyid(procedure_record.proowner) = 'postgres'
        AND pg_catalog.pg_get_functiondef(procedure_record.oid) LIKE '%OLD.member_model_version = 1%'
        AND pg_catalog.pg_get_functiondef(procedure_record.oid) LIKE '%NEW.member_model_version = 2%'
        AND pg_catalog.pg_get_functiondef(procedure_record.oid) LIKE '%membership_sealed_at IS NULL%'
        AND NOT pg_catalog.has_function_privilege('anon', procedure_record.oid, 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege('authenticated', procedure_record.oid, 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege('service_role', procedure_record.oid, 'EXECUTE')
    )
  THEN 1 ELSE 0 END)::integer AS value
),
catch_up_private_contract AS (
  SELECT (CASE WHEN
    (SELECT pg_catalog.count(*)
     FROM pg_catalog.pg_class
     WHERE oid IN (
       pg_catalog.to_regclass('public.amora_preparation_catch_up_receipts'),
       pg_catalog.to_regclass('public.amora_preparation_catch_up_items')
     ) AND relrowsecurity) = 2
    AND NOT pg_catalog.has_table_privilege(
      'anon', 'public.amora_preparation_catch_up_receipts', 'SELECT,INSERT,UPDATE,DELETE'
    )
    AND NOT pg_catalog.has_table_privilege(
      'authenticated', 'public.amora_preparation_catch_up_receipts', 'SELECT,INSERT,UPDATE,DELETE'
    )
    AND NOT pg_catalog.has_table_privilege(
      'anon', 'public.amora_preparation_catch_up_items', 'SELECT,INSERT,UPDATE,DELETE'
    )
    AND NOT pg_catalog.has_table_privilege(
      'authenticated', 'public.amora_preparation_catch_up_items', 'SELECT,INSERT,UPDATE,DELETE'
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc
      WHERE oid = pg_catalog.to_regprocedure(
        'public.finalize_amora_preparation_catch_up_v1(uuid,uuid,uuid,bigint,jsonb)'
      )
        AND pg_catalog.pg_get_functiondef(oid)
          LIKE '%v_private_visibility := v_actor_role || ''_private''%'
        AND pg_catalog.pg_get_functiondef(oid)
          LIKE '%''actor_profile_id'', p_actor_user_id%'
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'decision_nodes'
        AND policyname = 'decision_nodes_select_with_privacy'
        AND cmd = 'SELECT'
        AND roles = ARRAY['authenticated'::name]
        AND qual LIKE '%preparation_catch_up%'
        AND qual LIKE '%actor_profile_id%auth.uid()%'
    )
  THEN 1 ELSE 0 END)::integer AS value
),
mediation_trigger_contract AS (
  SELECT (CASE WHEN pg_catalog.count(*) = 1 THEN 1 ELSE 0 END)::integer AS value
  FROM pg_catalog.pg_trigger AS trigger_record
  JOIN pg_catalog.pg_proc AS procedure_record ON procedure_record.oid = trigger_record.tgfoid
  WHERE trigger_record.tgrelid = pg_catalog.to_regclass('public.chat_messages')
    AND trigger_record.tgname = 'trg_enforce_amora_mediation_private_draft_boundary'
    AND trigger_record.tgenabled = 'O'
    AND NOT trigger_record.tgisinternal
    AND procedure_record.prosecdef
    AND pg_catalog.pg_get_userbyid(procedure_record.proowner) = 'postgres'
    AND pg_catalog.pg_get_functiondef(procedure_record.oid) LIKE '%mediation_source_draft_id%'
    AND pg_catalog.pg_get_functiondef(procedure_record.oid) LIKE '%mediation_draft_roster_fingerprint%'
    AND pg_catalog.pg_get_functiondef(procedure_record.oid) LIKE '%v_source.couple_id IS DISTINCT FROM NEW.couple_id%'
    AND NOT pg_catalog.has_function_privilege('anon', procedure_record.oid, 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('authenticated', procedure_record.oid, 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('service_role', procedure_record.oid, 'EXECUTE')
),
topic_criterion_trigger_contract AS (
  SELECT (CASE WHEN pg_catalog.count(*) = 1 THEN 1 ELSE 0 END)::integer AS value
  FROM pg_catalog.pg_trigger AS trigger_record
  JOIN pg_catalog.pg_proc AS procedure_record ON procedure_record.oid = trigger_record.tgfoid
  WHERE trigger_record.tgrelid = pg_catalog.to_regclass('public.amora_actions')
    AND trigger_record.tgname = 'trg_seal_amora_topic_criterion_action_context_v1'
    AND trigger_record.tgenabled = 'O'
    AND NOT trigger_record.tgisinternal
    AND procedure_record.prosecdef
    AND pg_catalog.pg_get_userbyid(procedure_record.proowner) = 'postgres'
    AND pg_catalog.pg_get_functiondef(procedure_record.oid) LIKE '%amora_topic_criterion_context_v1%'
    AND pg_catalog.pg_get_functiondef(procedure_record.oid) LIKE '%criterionDecisionId%'
    AND pg_catalog.pg_get_functiondef(procedure_record.oid) LIKE '%read_amora_couple_core_criterion_v1%'
    AND NOT pg_catalog.has_function_privilege('anon', procedure_record.oid, 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('authenticated', procedure_record.oid, 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('service_role', procedure_record.oid, 'EXECUTE')
),
shared_action_trigger_contract AS (
  SELECT (CASE WHEN pg_catalog.count(*) = 1 THEN 1 ELSE 0 END)::integer AS value
  FROM pg_catalog.pg_trigger AS trigger_record
  JOIN pg_catalog.pg_proc AS procedure_record ON procedure_record.oid = trigger_record.tgfoid
  WHERE trigger_record.tgrelid = pg_catalog.to_regclass('public.chat_messages')
    AND trigger_record.tgname = 'trg_bind_amora_shared_action_application'
    AND trigger_record.tgenabled = 'O'
    AND NOT trigger_record.tgisinternal
    AND procedure_record.prosecdef
    AND pg_catalog.pg_get_userbyid(procedure_record.proowner) = 'postgres'
    AND pg_catalog.pg_get_functiondef(procedure_record.oid)
      LIKE '%server_authoritative_first_use_action_application%'
    AND pg_catalog.pg_get_functiondef(procedure_record.oid)
      LIKE '%server_authoritative_provider_backed_add_action_application%'
    AND pg_catalog.pg_get_functiondef(procedure_record.oid)
      LIKE '%AMORA_SHARED_ACTION_CONFIRMATION_INVALID%'
    AND NOT pg_catalog.has_function_privilege('anon', procedure_record.oid, 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('authenticated', procedure_record.oid, 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('service_role', procedure_record.oid, 'EXECUTE')
),
vendor_review_trigger_contract AS (
  SELECT (CASE WHEN pg_catalog.count(*) = 1 THEN 1 ELSE 0 END)::integer AS value
  FROM pg_catalog.pg_trigger AS trigger_record
  JOIN pg_catalog.pg_proc AS procedure_record ON procedure_record.oid = trigger_record.tgfoid
  WHERE trigger_record.tgrelid = pg_catalog.to_regclass('public.vendor_reviews')
    AND trigger_record.tgname = 'update_vendor_rating_on_review'
    AND trigger_record.tgenabled = 'O'
    AND NOT trigger_record.tgisinternal
    AND NOT procedure_record.prosecdef
    AND pg_catalog.pg_get_userbyid(procedure_record.proowner) = 'postgres'
    AND procedure_record.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
    AND pg_catalog.pg_get_functiondef(procedure_record.oid) LIKE '%UPDATE public.vendors AS vendor%'
    AND pg_catalog.pg_get_functiondef(procedure_record.oid) LIKE '%FROM public.vendor_reviews AS review%'
    AND pg_catalog.pg_get_functiondef(procedure_record.oid) LIKE '%review.is_visible = true%'
    AND NOT pg_catalog.has_function_privilege('anon', procedure_record.oid, 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('authenticated', procedure_record.oid, 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('service_role', procedure_record.oid, 'EXECUTE')
),
decision_clock_trigger_contract AS (
  SELECT (CASE WHEN pg_catalog.count(*) = 1 THEN 1 ELSE 0 END)::integer AS value
  FROM pg_catalog.pg_trigger AS trigger_record
  JOIN pg_catalog.pg_proc AS procedure_record ON procedure_record.oid = trigger_record.tgfoid
  WHERE trigger_record.tgrelid = pg_catalog.to_regclass('public.decision_nodes')
    AND trigger_record.tgname = 'set_decision_nodes_updated_at'
    AND trigger_record.tgenabled = 'O'
    AND trigger_record.tgtype = 19
    AND trigger_record.tgqual IS NULL
    AND NOT trigger_record.tgisinternal
    AND NOT procedure_record.prosecdef
    AND pg_catalog.pg_get_userbyid(procedure_record.proowner) = 'postgres'
    AND procedure_record.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
    AND pg_catalog.pg_get_functiondef(procedure_record.oid)
      LIKE '%NEW.source IS NOT DISTINCT FROM ''vendor_booking''%'
    AND pg_catalog.pg_get_functiondef(procedure_record.oid)
      LIKE '%NEW.decision_type IS NOT DISTINCT FROM ''completed''%'
    AND pg_catalog.pg_get_functiondef(procedure_record.oid)
      LIKE '%NEW.updated_at := pg_catalog.clock_timestamp()%'
    AND pg_catalog.pg_get_functiondef(procedure_record.oid)
      LIKE '%NEW.updated_at := pg_catalog.now()%'
    AND NOT pg_catalog.has_function_privilege('anon', procedure_record.oid, 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('authenticated', procedure_record.oid, 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('service_role', procedure_record.oid, 'EXECUTE')
),
signup_trigger_contract AS (
  SELECT (CASE WHEN pg_catalog.count(*) = 1 THEN 1 ELSE 0 END)::integer AS value
  FROM pg_catalog.pg_trigger AS trigger_record
  JOIN pg_catalog.pg_proc AS procedure_record ON procedure_record.oid = trigger_record.tgfoid
  WHERE trigger_record.tgrelid = pg_catalog.to_regclass('auth.users')
    AND trigger_record.tgname = 'on_auth_user_created'
    AND trigger_record.tgenabled = 'O'
    AND trigger_record.tgtype = 5
    AND NOT trigger_record.tgisinternal
    AND procedure_record.proname = 'create_profile_on_signup'
    AND procedure_record.prosecdef
    AND pg_catalog.pg_get_userbyid(procedure_record.proowner) = 'postgres'
    AND procedure_record.proconfig @> ARRAY['search_path=pg_catalog, public']::text[]
    AND NOT pg_catalog.has_function_privilege('anon', procedure_record.oid, 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('authenticated', procedure_record.oid, 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('service_role', procedure_record.oid, 'EXECUTE')
),
invite_nullable_contract AS (
  SELECT (CASE WHEN
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid = pg_catalog.to_regclass('public.couples')
        AND attname = 'invite_code'
        AND atttypid = 'pg_catalog.text'::regtype
        AND NOT attnotnull
        AND NOT attisdropped
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint
      WHERE conrelid = pg_catalog.to_regclass('public.couples')
        AND conname = 'couples_invite_lifecycle_valid'
        AND contype = 'c'
        AND convalidated
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger
      WHERE tgrelid = pg_catalog.to_regclass('public.couples')
        AND tgname = 'trg_manage_couple_invite_lifecycle'
        AND tgenabled = 'O'
        AND NOT tgisinternal
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc
      WHERE oid = pg_catalog.to_regprocedure('public.join_couple_invite_core(uuid,text,text,text)')
        AND pg_catalog.pg_get_functiondef(oid) ~ 'invite_code[[:space:]]*=[[:space:]]*NULL'
    )
  THEN 1 ELSE 0 END)::integer AS value
),
plan_change_auth_fk_contract AS (
  SELECT pg_catalog.count(*)::integer AS value
  FROM pg_catalog.pg_constraint
  WHERE conrelid IN (
      pg_catalog.to_regclass('public.couple_plan_change_requests'),
      pg_catalog.to_regclass('public.couple_plan_change_acceptances')
    )
    AND contype = 'f'
    AND confrelid = pg_catalog.to_regclass('auth.users')
    AND confdeltype = 'c'
    AND convalidated
    AND NOT condeferrable
),
plan_change_terminal_contract AS (
  SELECT pg_catalog.count(*)::integer AS value
  FROM (VALUES
    ('change_applied'::text),
    ('change_rejected'::text),
    ('change_stale'::text)
  ) AS expected(event_kind)
  WHERE EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = pg_catalog.to_regclass('public.couple_change_notifications')
      AND conname = 'couple_change_notifications_event_kind_check'
      AND contype = 'c'
      AND convalidated
      AND pg_catalog.pg_get_constraintdef(oid) LIKE '%' || expected.event_kind || '%'
  )
),
plan_change_journey_fence_contract AS (
  SELECT pg_catalog.count(*)::integer AS value
  FROM (VALUES
    ('wedding_date'::text),
    ('venue'::text),
    ('total_budget'::text),
    ('progress'::text)
  ) AS expected(column_name)
  WHERE EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc
    WHERE oid = pg_catalog.to_regprocedure('public.enforce_couple_plan_change_write_boundary()')
      AND pg_catalog.pg_get_functiondef(oid) LIKE '%NEW.' || expected.column_name || '%'
      AND pg_catalog.pg_get_functiondef(oid) LIKE '%OLD.' || expected.column_name || '%'
      AND pg_catalog.pg_get_functiondef(oid) LIKE '%COUPLE_PLAN_CHANGE_APPROVAL_REQUIRED%'
  )
),
plan_change_trigger_contract AS (
  SELECT (CASE WHEN pg_catalog.count(*) = 1 THEN 1 ELSE 0 END)::integer AS value
  FROM pg_catalog.pg_trigger AS trigger_record
  JOIN pg_catalog.pg_proc AS procedure_record ON procedure_record.oid = trigger_record.tgfoid
  WHERE trigger_record.tgrelid = pg_catalog.to_regclass('public.wedding_journeys')
    AND trigger_record.tgname = 'trg_00_enforce_couple_plan_change_write_boundary'
    AND trigger_record.tgenabled = 'O'
    AND trigger_record.tgtype = 23
    AND NOT trigger_record.tgisinternal
    AND procedure_record.prosecdef
    AND pg_catalog.pg_get_userbyid(procedure_record.proowner) = 'postgres'
    AND NOT pg_catalog.has_function_privilege('anon', procedure_record.oid, 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('authenticated', procedure_record.oid, 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('service_role', procedure_record.oid, 'EXECUTE')
),
plan_change_display_contract AS (
  SELECT (CASE WHEN
    procedure_record.oid IS NOT NULL
    AND procedure_record.prosecdef
    AND procedure_record.provolatile = 'i'
    AND procedure_record.proisstrict
    AND pg_catalog.pg_get_userbyid(procedure_record.proowner) = 'postgres'
    AND procedure_record.proconfig @> ARRAY['search_path=pg_catalog, public']::text[]
    AND pg_catalog.pg_get_functiondef(procedure_record.oid) LIKE '%[[:cntrl:]]%'
    AND pg_catalog.pg_get_functiondef(procedure_record.oid) LIKE '%65279%'
    AND NOT pg_catalog.has_function_privilege('anon', procedure_record.oid, 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('authenticated', procedure_record.oid, 'EXECUTE')
    AND pg_catalog.has_function_privilege('service_role', procedure_record.oid, 'EXECUTE')
  THEN 1 ELSE 0 END)::integer AS value
  FROM pg_catalog.pg_proc AS procedure_record
  WHERE procedure_record.oid = pg_catalog.to_regprocedure(
    'public.couple_plan_change_has_unsafe_display_text(text)'
  )
),
plan_change_index_contract AS (
  SELECT (CASE WHEN pg_catalog.count(*) = 1 THEN 1 ELSE 0 END)::integer AS value
  FROM pg_catalog.pg_index AS index_record
  JOIN pg_catalog.pg_class AS index_relation ON index_relation.oid = index_record.indexrelid
  JOIN pg_catalog.pg_namespace AS index_namespace ON index_namespace.oid = index_relation.relnamespace
  WHERE index_namespace.nspname = 'public'
    AND index_relation.relname = 'couple_plan_change_submit_idempotency_idx'
    AND index_record.indrelid = pg_catalog.to_regclass('public.couple_plan_change_requests')
    AND index_record.indisunique
    AND index_record.indisvalid
    AND index_record.indisready
    AND pg_catalog.pg_get_indexdef(index_record.indexrelid)
      LIKE '%couple_id%actor_user_id%base_revision%change_digest%roster_fingerprint%'
    AND pg_catalog.pg_get_expr(index_record.indpred, index_record.indrelid)
      LIKE '%status%stale%'
),
wedding_court_fk_contract AS (
  SELECT pg_catalog.count(*)::integer AS value
  FROM pg_catalog.pg_constraint
  WHERE conrelid = pg_catalog.to_regclass('public.wedding_court_votes')
    AND contype = 'f'
    AND confrelid = pg_catalog.to_regclass('auth.users')
    AND confdeltype = 'c'
    AND convalidated
    AND pg_catalog.pg_get_constraintdef(oid)
      LIKE 'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE%'
),
chat_feedback_fk_contract AS (
  SELECT pg_catalog.count(*)::integer AS value
  FROM pg_catalog.pg_constraint
  WHERE conrelid = pg_catalog.to_regclass('public.chat_feedback')
    AND conname = 'chat_feedback_user_id_fkey'
    AND contype = 'f'
    AND confrelid = pg_catalog.to_regclass('auth.users')
    AND confdeltype = 'c'
    AND convalidated
    AND NOT condeferrable
),
payment_ledger_fk_contract AS (
  SELECT pg_catalog.count(*)::integer AS value
  FROM pg_catalog.pg_constraint
  WHERE conrelid = pg_catalog.to_regclass('public.wedding_payment_ledger')
    AND conname IN (
      'wedding_payment_ledger_couple_id_fkey',
      'wedding_payment_ledger_created_by_fkey',
      'wedding_payment_ledger_updated_by_fkey'
    )
    AND contype = 'f'
    AND convalidated
    AND (
      (conname = 'wedding_payment_ledger_couple_id_fkey'
       AND confrelid = pg_catalog.to_regclass('public.couples')
       AND confdeltype = 'c')
      OR
      (conname IN (
         'wedding_payment_ledger_created_by_fkey',
         'wedding_payment_ledger_updated_by_fkey'
       )
       AND confrelid = pg_catalog.to_regclass('public.profiles')
       AND confdeltype = 'n')
    )
),
evidence AS (
  SELECT
    (SELECT value FROM account_deletion_contract)
      AS account_deletion_auth_fk_contract_count,
    (SELECT value FROM chat_insert_policy_contract)
      AS chat_server_only_ingest_boundary_count,
    (SELECT value FROM chat_select_policy_contract)
      AS chat_partner_recipient_select_policy_count,
    (SELECT value FROM chat_trigger_contract)
      AS chat_partner_recipient_trigger_count,
    (SELECT value FROM conversation_index_contract)
      AS conversation_segment_active_index_count,
    (SELECT value FROM conversation_policy_contract)
      AS conversation_segment_rls_policy_count,
    (SELECT valid::integer FROM rpc_acl_contract
      WHERE signature = 'public.start_amora_conversation_segment(uuid,text,uuid,uuid,text)')
      AS conversation_segment_rpc_acl_count,
    (SELECT value FROM conversation_fk_contract)
      AS conversation_segment_scope_fk_count,
    (SELECT valid::integer FROM rpc_acl_contract
      WHERE signature = 'public.finalize_amora_first_use_action_application_v1(uuid,uuid,uuid,uuid,text,integer,bigint)')
      AS first_use_deterministic_application_rpc_acl_count,
    (SELECT valid::integer FROM rpc_acl_contract
      WHERE signature = 'public.finalize_amora_first_use_action_proposal_v1(uuid,uuid,uuid,text,integer,bigint)')
      AS first_use_deterministic_proposal_rpc_acl_count,
    (SELECT valid::integer FROM rpc_acl_contract
      WHERE signature = 'public.finalize_amora_provider_backed_add_action_application_v1(uuid,uuid,uuid,uuid,text,integer,bigint)')
      AS provider_backed_add_action_application_rpc_acl_count,
    COALESCE((SELECT private_valid FROM atomic_function_contract), 0)
      AS atomic_action_private_dispatcher_acl_count,
    COALESCE((SELECT public_valid FROM atomic_function_contract), 0)
      AS atomic_action_public_dispatcher_acl_count,
    COALESCE((SELECT parity_valid FROM atomic_function_contract), 0)
      AS atomic_action_href_whitespace_parity_count,
    (SELECT valid::integer FROM rpc_acl_contract
      WHERE signature = 'public.complete_amora_booking_outcome_atomic(uuid,uuid,numeric,numeric,integer,text,boolean)')
      AS booking_outcome_provenance_rpc_acl_count,
    COALESCE((SELECT value FROM booking_provenance_contract), 0)
      AS booking_outcome_provenance_v1_actor_time_contract_count,
    (SELECT pg_catalog.count(*)::integer FROM rpc_acl_contract
      WHERE valid AND signature IN (
        'public.create_neutral_preparation_space_for_current_user()',
        'public.join_neutral_preparation_space_server(uuid,text)'
      )) AS neutral_preparation_space_rpc_acl_count,
    (SELECT value FROM member_model_contract)
      AS neutral_preparation_space_member_model_contract_count,
    (SELECT valid::integer FROM rpc_acl_contract
      WHERE signature = 'public.finalize_amora_preparation_catch_up_v1(uuid,uuid,uuid,bigint,jsonb)')
      AS preparation_catch_up_rpc_acl_count,
    (SELECT value FROM catch_up_private_contract)
      AS preparation_catch_up_private_actor_binding_contract_count,
    (SELECT valid::integer FROM rpc_acl_contract
      WHERE signature = 'public.list_amora_preparation_notes_v1(uuid,uuid,bigint,text,timestamp with time zone,timestamp with time zone,uuid,integer)')
      AS preparation_notes_read_rpc_acl_count,
    (SELECT valid::integer FROM rpc_acl_contract
      WHERE signature = 'public.list_amora_preparation_action_receipt_bindings_v1(uuid,uuid,bigint,uuid[])')
      AS preparation_action_receipt_binding_read_rpc_acl_count,
    (SELECT value FROM mediation_trigger_contract)
      AS mediation_private_draft_boundary_trigger_count,
    (SELECT value FROM topic_criterion_trigger_contract)
      AS topic_criterion_action_context_trigger_count,
    (SELECT value FROM shared_action_trigger_contract)
      AS shared_action_receipt_trigger_contract_count,
    (SELECT value FROM vendor_review_trigger_contract)
      AS vendor_review_trigger_search_path_contract_count,
    (SELECT value FROM decision_clock_trigger_contract)
      AS decision_node_updated_at_clock_trigger_contract_count,
    (SELECT value FROM signup_trigger_contract)
      AS signup_profile_trigger_contract_count,
    (SELECT value FROM invite_nullable_contract)
      AS couple_invite_nullable_contract_count,
    (SELECT value FROM plan_change_auth_fk_contract)
      AS couple_plan_change_auth_user_fk_count,
    COALESCE((SELECT value FROM plan_change_display_contract), 0)
      AS couple_plan_change_display_guard_count,
    (SELECT value FROM plan_change_index_contract)
      AS couple_plan_change_idempotency_index_count,
    (SELECT value FROM plan_change_journey_fence_contract)
      AS couple_plan_change_journey_write_fence_count,
    (SELECT value FROM plan_change_terminal_contract)
      AS couple_plan_change_terminal_event_count,
    (SELECT value FROM plan_change_trigger_contract)
      AS couple_plan_change_write_boundary_trigger_count,
    (SELECT value FROM successor_table_contract)
      AS successor_created_table_count,
    (SELECT value FROM migration_ledger_contract)
      AS successor_migration_head_count,
    (SELECT value FROM wedding_court_fk_contract)
      AS wedding_court_auth_delete_fk_count,
    (SELECT value FROM chat_feedback_fk_contract)
      AS chat_feedback_auth_delete_fk_count,
    (SELECT value FROM payment_ledger_fk_contract)
      AS payment_ledger_fk_contract_count
)
SELECT
  (
    account_deletion_auth_fk_contract_count = 1
    AND chat_server_only_ingest_boundary_count = 1
    AND chat_partner_recipient_select_policy_count = 1
    AND chat_partner_recipient_trigger_count = 1
    AND conversation_segment_active_index_count = 3
    AND conversation_segment_rls_policy_count = 1
    AND conversation_segment_rpc_acl_count = 1
    AND conversation_segment_scope_fk_count = 2
    AND first_use_deterministic_application_rpc_acl_count = 1
    AND first_use_deterministic_proposal_rpc_acl_count = 1
    AND provider_backed_add_action_application_rpc_acl_count = 1
    AND atomic_action_private_dispatcher_acl_count = 1
    AND atomic_action_public_dispatcher_acl_count = 1
    AND atomic_action_href_whitespace_parity_count = 1
    AND booking_outcome_provenance_rpc_acl_count = 1
    AND booking_outcome_provenance_v1_actor_time_contract_count = 1
    AND neutral_preparation_space_rpc_acl_count = 2
    AND neutral_preparation_space_member_model_contract_count = 1
    AND preparation_catch_up_rpc_acl_count = 1
    AND preparation_catch_up_private_actor_binding_contract_count = 1
    AND preparation_notes_read_rpc_acl_count = 1
    AND preparation_action_receipt_binding_read_rpc_acl_count = 1
    AND mediation_private_draft_boundary_trigger_count = 1
    AND topic_criterion_action_context_trigger_count = 1
    AND shared_action_receipt_trigger_contract_count = 1
    AND vendor_review_trigger_search_path_contract_count = 1
    AND decision_node_updated_at_clock_trigger_contract_count = 1
    AND signup_profile_trigger_contract_count = 1
    AND couple_invite_nullable_contract_count = 1
    AND couple_plan_change_auth_user_fk_count = 4
    AND couple_plan_change_display_guard_count = 1
    AND couple_plan_change_idempotency_index_count = 1
    AND couple_plan_change_journey_write_fence_count = 4
    AND couple_plan_change_terminal_event_count = 3
    AND couple_plan_change_write_boundary_trigger_count = 1
    AND successor_created_table_count = 112
    AND successor_migration_head_count = 1
    AND wedding_court_auth_delete_fk_count = 1
    AND chat_feedback_auth_delete_fk_count = 1
    AND payment_ledger_fk_contract_count = 3
  ) AS verified,
  evidence.*
FROM evidence;

COMMIT;
