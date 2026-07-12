-- Read-only, exact post-deploy contract. Names alone are insufficient: the
-- app depends on exact RPC signatures, return shapes, definer/search-path
-- safety, role privileges, column types/nullability, real tables, and RLS.
WITH required_functions(
  signature, expected_result, expected_search_path, expected_source_md5
) AS (
  VALUES
    ('public.apply_journey_progress_patch(uuid,jsonb,text[])', 'jsonb', 'search_path=public', '8fb08367706397c9a1d00e299a48e7d5'),
    ('public.create_booking_atomic(uuid,uuid,date,text,uuid,uuid,text,text,text,text,numeric,text)', 'uuid', 'search_path=public', '3493fa940491a5a5efcce1bf1f6ac497'),
    ('public.check_rate_limit(text,integer,integer)', 'TABLE(allowed boolean, retry_after_seconds integer)', 'search_path=public', 'dbaddace99dcf6ddbe99da5eefe0797a'),
    ('public.check_rate_limit(text,integer,integer,uuid)', 'TABLE(allowed boolean, retry_after_seconds integer)', 'search_path=public', '7583f22c1daf9cebea4f7a847a6a507f'),
    (
      'public.reserve_amora_usage(uuid,integer,integer,boolean)',
      'TABLE(allowed boolean, reason text, remaining integer)',
      'search_path=public', 'c9fb8a9c1170a3643fd3035422a6180e'
    ),
    (
      'public.check_amora_usage(uuid,integer,integer,boolean)',
      'TABLE(allowed boolean, reason text, remaining integer, provider_remaining integer)',
      'search_path=public', '1a5fbd827bd8926a03798420f4c766e6'
    ),
    (
      'public.reserve_amora_usage_v2(uuid,integer,integer,boolean,text,text,integer)',
      'TABLE(allowed boolean, reason text, remaining integer, provider_remaining integer, reused boolean)',
      'search_path=public', '466ddd79bdaec3fba35454a4986d32b9'
    ),
    ('public.mark_amora_provider_started(text,text,integer)', 'boolean', 'search_path=public', 'aae3c73e3fd4b9e6b4b54440d7e688b6'),
    (
      'public.fail_amora_chat_request(text,text,text)',
      'TABLE(final_status text, message_id uuid, visible_refunded boolean)',
      'search_path=public', 'b3d3255b9b758387041938c3371616fa'
    ),
    ('public.expire_stale_amora_chat_request(text,text)', 'boolean', 'search_path=public', 'a8f07da1189b1cb3172f6fa1ae43b868'),
    ('public.reconcile_stale_amora_chat_requests(integer)', 'integer', 'search_path=public', 'f5da3d6b4c7b0511856da991e59caee1'),
    (
      'public.complete_amora_chat_request(uuid,uuid,text,text,text,jsonb,text,text,text,timestamp with time zone,bigint,bigint,text,text,integer,text,integer,integer,numeric,jsonb)',
      'TABLE(message_id uuid, created_at timestamp with time zone)',
      'search_path=public', 'd647047288a7970a224acc624ffc2405'
    ),
    (
      'public.acquire_amora_provider_lease(uuid,uuid,bigint,bigint,text,timestamp with time zone)',
      'uuid', 'search_path=public', '5317c379fef8569cd23356e541ec87c5'
    ),
    ('public.release_amora_provider_lease(uuid)', 'void', 'search_path=public', '7860c39280199d718988cefeb446222d'),
    ('public.get_or_rotate_invite_code_safely(uuid,boolean)', 'jsonb', 'search_path=public', 'b59b6d67618d1241ee6a155e08b51b04'),
    ('public.join_couple_server(uuid,text,text,date,text,numeric,jsonb,date)', 'jsonb', 'search_path=public', 'ee8467fbf8f57cbd067e2685d25b153a'),
    ('public.restart_blocked_amora_couple_safely(uuid)', 'jsonb', 'search_path=public', '781faeb180024da7962356665c49ee33'),
    ('public.leave_amora_couple_safely(uuid,text)', 'jsonb', 'search_path=public', 'd5ac8d47bd2e6caa5bbef9a33dc6e988'),
    ('public.create_amora_couple_safely(uuid,text,date,text,numeric,jsonb)', 'jsonb', 'search_path=public', 'b5cd665ed905621cfebe74e5bd78a44a'),
    ('public.begin_amora_membership_reset(uuid)', 'jsonb', 'search_path=public', '5773439ce4fc5146794e5b127c53fbc9'),
    ('public.count_active_amora_provider_leases(uuid)', 'integer', 'search_path=public', 'bf69f64824787e41e5c186993812c320'),
    ('public.count_active_amora_couple_provider_leases(uuid)', 'integer', 'search_path=public', '38564f585b8754142855eecedf8816d0'),
    ('public.generate_invite_code()', 'text', 'search_path=public', 'bbdbfa819d82e20868be4f69ef3257bc'),
    ('public.begin_account_deletion(uuid)', 'jsonb', 'search_path=public', '57a2cda57caef4083baab89ae619502d'),
    ('public.delete_private_amora_data(uuid,uuid,text)', 'integer', 'search_path=public', 'a4d613928f6a67e966fa52bdb4e82bb6'),
    ('public.redact_user_ai_data(uuid)', 'integer', 'search_path=public', '7bef551a2dc6c927e7c95bd0d7c2ba3f'),
    ('public.redact_old_ai_interactions(interval)', 'integer', 'search_path=public', '571f7b3674ee36b941bb19064f8b1cb0'),
    ('public.enforce_ai_interaction_retention()', 'TABLE(redacted integer, deleted integer)', 'search_path=public', '85cb9b5ccafca3cca9b3cdf74ee4eddc'),
    ('public.enforce_application_survey_retention()', 'TABLE(preregistrations_deleted integer, survey_responses_deleted integer)', 'search_path=public', '04d9b06eedd9eec0c19cf29e5b1a9968'),
    ('public.delete_expired_rate_limit_buckets()', 'integer', 'search_path=public', '667f711d08313c214c99cf4a8023b513'),
    ('public.count_active_community_upload_leases(uuid)', 'bigint', 'search_path=public, pg_temp', 'b1594dc15e570d225357dd90e10930f2'),
    ('public.prevent_profile_membership_self_change()', 'trigger', 'search_path=public', 'e3c62718b1fbc242933e9d83acbbce1a'),
    ('public.insert_amora_user_message(uuid,uuid,text,text,text)', 'jsonb', 'search_path=public', 'bb01ea6d87b3b1cf8e067f5ef24ce789'),
    ('public.reset_my_amora_chat_view(uuid,uuid,text)', 'timestamp with time zone', 'search_path=public', '87cc1177d84600a1bf07a552cf6e51d6'),
    ('public.respond_amora_shared_clear_request(uuid,uuid,text)', 'jsonb', 'search_path=public', '0e532efaf9160d49977badfe320b5d17'),
    ('public.begin_private_amora_delete(uuid,uuid,text)', 'jsonb', 'search_path=public', '2d77bfe6a34abd0d578f295432991dd6'),
    ('public.count_active_amora_private_provider_leases(uuid,text)', 'integer', 'search_path=public', '75074f443cf3c453790537156e1a188f'),
    ('public.apply_amora_budget_plan(uuid,uuid,numeric,jsonb)', 'jsonb', 'search_path=public', '42e8ed79ef7f4d9376c1ad54051a3921'),
    ('public.save_amora_feedback(uuid,uuid,text,text,text)', 'uuid', 'search_path=public', '17eee9cb5a76de4ba40262d90b7ab419'),
    ('public.delete_expired_amora_request_claims()', 'integer', 'search_path=public', 'dce4955b686ff0f1386e1d9460324758'),
    ('public.guard_user_media_storage_write()', 'trigger', 'search_path=public, storage, pg_temp', '2f2ef78416318e6dd8fbd66c3507a2f9'),
    ('public.guard_account_deletion_user_reference()', 'trigger', 'search_path=public, pg_temp', '0518d47d1da58e822a8b6ba662bd06eb'),
    ('public.guard_account_deletion_rate_limit_write()', 'trigger', 'search_path=public, pg_temp', 'b8ebd5bbf8df5b250d36404f4d6f0a5c'),
    ('public.account_deletion_queue_health()', 'jsonb', 'search_path=public, pg_temp', 'b0184ebdb2888d329ef714726d7f76f6'),
    ('public.requeue_dead_account_deletion_job(uuid)', 'boolean', 'search_path=public, pg_temp', '29fe1226857032d271e78f585f887956'),
    ('public.account_deletion_email_scopes_are_canonical(text[])', 'boolean', 'search_path=pg_catalog, pg_temp', '221d594a0a3f55f12d8baf2d8b18ce91'),
    ('public.request_account_deletion(uuid,text)', 'jsonb', 'search_path=public, pg_temp', '08f9136df3b8fc79f1abf1ee33a0bb95'),
    (
      'public.claim_account_deletion_jobs(uuid,integer,integer)',
      'TABLE(job_id uuid, user_id uuid, reason text, attempts integer, storage_inventory jsonb)',
      'search_path=public, pg_temp', '2f21c2198582104158923a9726cf6d8f'
    ),
    ('public.save_account_deletion_storage_inventory(uuid,uuid,jsonb)', 'boolean', 'search_path=public, pg_temp', '14602d5c4e9ccc3eb90f4c5618549f9d'),
    ('public.fail_account_deletion_job(uuid,uuid,text)', 'text', 'search_path=public, pg_temp', '9795091031826ac0a932ec01249834a8'),
    ('public.renew_account_deletion_job_lease(uuid,uuid,integer)', 'boolean', 'search_path=public, pg_temp', 'ba6534442ff7bc582d4bdefc396bc841'),
    ('public.complete_account_deletion_job(uuid,uuid)', 'boolean', 'search_path=public, pg_temp', '7224cdd797c3db1613059d9fc79e7fb4')
), service_denied_functions(signature) AS (
  VALUES
    ('public.guard_account_deletion_user_reference()'),
    ('public.guard_account_deletion_rate_limit_write()')
), function_status AS (
  SELECT required.signature,
         procedure_row.oid IS NOT NULL AS present,
         CASE WHEN procedure_row.oid IS NULL THEN NULL
              ELSE pg_get_function_result(procedure_row.oid) END AS actual_result,
         COALESCE(procedure_row.prosecdef, false) AS security_definer,
         CASE WHEN procedure_row.oid IS NULL THEN NULL
              ELSE pg_get_userbyid(procedure_row.proowner) END AS owner,
         COALESCE(
           procedure_row.proconfig @> ARRAY[required.expected_search_path]::text[],
           false
         ) AS safe_search_path,
         CASE WHEN procedure_row.oid IS NULL THEN NULL
              ELSE md5(replace(procedure_row.prosrc, chr(13), '')) END AS source_md5,
         CASE WHEN procedure_row.oid IS NULL THEN false ELSE
           has_function_privilege('service_role', procedure_row.oid, 'EXECUTE')
         END AS service_role_execute,
         NOT EXISTS (
           SELECT 1 FROM service_denied_functions denied
           WHERE denied.signature = required.signature
         ) AS expected_service_role_execute,
         CASE WHEN procedure_row.oid IS NULL THEN false ELSE
           has_function_privilege('anon', procedure_row.oid, 'EXECUTE')
         END AS anon_execute,
         CASE WHEN procedure_row.oid IS NULL THEN false ELSE
           has_function_privilege('authenticated', procedure_row.oid, 'EXECUTE')
         END AS authenticated_execute,
         procedure_row.oid IS NOT NULL
           AND pg_get_function_result(procedure_row.oid) = required.expected_result
           AND procedure_row.prosecdef
           AND pg_get_userbyid(procedure_row.proowner) = 'postgres'
           AND procedure_row.proconfig @> ARRAY[required.expected_search_path]::text[]
           AND (
             required.expected_source_md5 IS NULL
             OR md5(replace(procedure_row.prosrc, chr(13), '')) =
               required.expected_source_md5
           )
           AND has_function_privilege('service_role', procedure_row.oid, 'EXECUTE') =
             NOT EXISTS (
               SELECT 1 FROM service_denied_functions denied
               WHERE denied.signature = required.signature
             )
           AND NOT has_function_privilege('anon', procedure_row.oid, 'EXECUTE')
           AND NOT has_function_privilege('authenticated', procedure_row.oid, 'EXECUTE')
           AS exact
  FROM required_functions required
  LEFT JOIN pg_proc procedure_row
    ON procedure_row.oid = to_regprocedure(required.signature)
), required_client_denied_trigger_functions(signature, expected_source_md5) AS (
  VALUES
    ('public.community_recalc_rank()', 'c742d9e87a9c815491d03c574690772c'),
    ('public.create_profile_on_signup()', '84a6f9f7f2c366bb87703fcc25cc2f22'),
    ('public.guard_amora_user_message_insert()', '3b3a72bfb77bfd27a0b7f43b718cb4c0'),
    ('public.guard_profile_self_insert()', 'e1a79bcb72eb8b1df1c5edb70f181e44'),
    ('public.prevent_cohort_membership_client_write()', '5947d166102367678683a8ae71c2b72d'),
    ('public.prevent_couple_ownership_self_change()', '697c40535a23d739a271b0b4e3b2ffbf'),
    ('public.prevent_couple_slot_self_change()', 'c795f37d371b8143d50b45d65de96411'),
    ('public.prevent_is_admin_self_change()', '9395ea55bfc5192e10ef000e0421d7b3')
), client_denied_trigger_function_status AS (
  SELECT required.signature,
         procedure_row.oid IS NOT NULL
           AND pg_get_function_result(procedure_row.oid) = 'trigger'
           AND procedure_row.prosecdef
           AND pg_get_userbyid(procedure_row.proowner) = 'postgres'
           AND procedure_row.proconfig @> ARRAY['search_path=public']::text[]
           AND md5(replace(procedure_row.prosrc, chr(13), '')) =
             required.expected_source_md5
           AND has_function_privilege('service_role', procedure_row.oid, 'EXECUTE')
           AND NOT has_function_privilege('anon', procedure_row.oid, 'EXECUTE')
           AND NOT has_function_privilege('authenticated', procedure_row.oid, 'EXECUTE')
           AS exact
  FROM required_client_denied_trigger_functions required
  LEFT JOIN pg_catalog.pg_proc procedure_row
    ON procedure_row.oid = to_regprocedure(required.signature)
), required_client_denied_trigger_bindings(
  schema_name, table_name, trigger_name, function_signature, definition
) AS (
  VALUES
    ('public', 'community_profiles', 'trg_recalc_rank',
      'public.community_recalc_rank()',
      'CREATE TRIGGER trg_recalc_rank AFTER UPDATE OF post_count, comment_count, total_upvotes_received, wedding_completed ON community_profiles FOR EACH ROW EXECUTE FUNCTION community_recalc_rank()'),
    ('auth', 'users', 'on_auth_user_created',
      'public.create_profile_on_signup()',
      'CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION create_profile_on_signup()'),
    ('public', 'chat_messages', 'trg_guard_amora_user_message_insert',
      'public.guard_amora_user_message_insert()',
      'CREATE TRIGGER trg_guard_amora_user_message_insert BEFORE INSERT ON chat_messages FOR EACH ROW EXECUTE FUNCTION guard_amora_user_message_insert()'),
    ('public', 'profiles', 'trg_guard_profile_self_insert',
      'public.guard_profile_self_insert()',
      'CREATE TRIGGER trg_guard_profile_self_insert BEFORE INSERT ON profiles FOR EACH ROW EXECUTE FUNCTION guard_profile_self_insert()'),
    ('public', 'cohort_members', 'trg_prevent_cohort_membership_client_write',
      'public.prevent_cohort_membership_client_write()',
      'CREATE TRIGGER trg_prevent_cohort_membership_client_write BEFORE INSERT OR DELETE OR UPDATE ON cohort_members FOR EACH ROW EXECUTE FUNCTION prevent_cohort_membership_client_write()'),
    ('public', 'profiles', 'trg_prevent_couple_ownership_self_change',
      'public.prevent_couple_ownership_self_change()',
      'CREATE TRIGGER trg_prevent_couple_ownership_self_change BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION prevent_couple_ownership_self_change()'),
    ('public', 'couples', 'trg_prevent_couple_slot_self_change',
      'public.prevent_couple_slot_self_change()',
      'CREATE TRIGGER trg_prevent_couple_slot_self_change BEFORE UPDATE ON couples FOR EACH ROW EXECUTE FUNCTION prevent_couple_slot_self_change()'),
    ('public', 'profiles', 'trg_prevent_is_admin_self_change',
      'public.prevent_is_admin_self_change()',
      'CREATE TRIGGER trg_prevent_is_admin_self_change BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION prevent_is_admin_self_change()')
), client_denied_trigger_binding_status AS (
  SELECT required.schema_name,
         required.table_name,
         required.trigger_name,
         trigger_row.oid IS NOT NULL
           AND NOT trigger_row.tgisinternal
           AND trigger_row.tgenabled = 'O'
           AND trigger_row.tgfoid = to_regprocedure(required.function_signature)
           AND pg_get_triggerdef(trigger_row.oid, true) = required.definition
           AS exact
  FROM required_client_denied_trigger_bindings required
  LEFT JOIN pg_catalog.pg_trigger trigger_row
    ON trigger_row.tgrelid = to_regclass(
      required.schema_name || '.' || required.table_name
    )
   AND trigger_row.tgname = required.trigger_name
), required_maintenance_crons(job_name, expected_schedule, expected_command) AS (
  VALUES
    ('delete-expired-amora-request-claims', '29 18 * * *',
      'SELECT public.delete_expired_amora_request_claims();'),
    ('reconcile-stale-amora-chat-requests', '*/5 * * * *',
      'SELECT public.reconcile_stale_amora_chat_requests(100);'),
    ('enforce-ai-interaction-retention', '17 18 * * *',
      'SELECT public.enforce_ai_interaction_retention();'),
    ('enforce-application-survey-retention', '41 18 * * *',
      'SELECT public.enforce_application_survey_retention();'),
    ('delete-expired-rate-limit-buckets', '47 18 * * *',
      'SELECT public.delete_expired_rate_limit_buckets();')
), maintenance_cron_status AS (
  SELECT required.job_name,
         count(job_row.jobid) AS existing_count,
         count(job_row.jobid) = 1 AND bool_and(
           job_row.schedule = required.expected_schedule
           AND job_row.command = required.expected_command
           AND job_row.active
         ) AS exact
  FROM required_maintenance_crons required
  LEFT JOIN cron.job job_row ON job_row.jobname = required.job_name
  GROUP BY required.job_name
), required_columns(table_name, column_name, data_type, not_null) AS (
  VALUES
    ('profiles', 'account_deleting_at', 'timestamp with time zone', false),
    ('profiles', 'private_chat_deleting_at', 'timestamp with time zone', false),
    ('profiles', 'amora_membership_resetting_at', 'timestamp with time zone', false),
    ('profiles', 'amora_membership_generation', 'bigint', true),
    ('rate_limit_buckets', 'subject_user_id', 'uuid', false),
    ('couples', 'invite_code', 'text', false),
    ('couples', 'amora_shared_resetting_at', 'timestamp with time zone', false),
    ('couples', 'amora_context_generation', 'bigint', true),
    ('couples', 'amora_replacement_blocked_at', 'timestamp with time zone', false),
    ('wedding_code_responses', 'scoring_version', 'text', false),
    ('amora_request_claims', 'request_key', 'text', true),
    ('amora_request_claims', 'request_hash', 'text', true),
    ('amora_request_claims', 'status', 'text', true),
    ('amora_request_claims', 'lease_expires_at', 'timestamp with time zone', true),
    ('amora_provider_leases', 'id', 'uuid', true),
    ('amora_provider_leases', 'user_id', 'uuid', true),
    ('amora_provider_leases', 'couple_id', 'uuid', true),
    ('amora_provider_leases', 'membership_generation', 'bigint', true),
    ('amora_provider_leases', 'couple_context_generation', 'bigint', true),
    ('amora_provider_leases', 'visibility', 'text', true),
    ('amora_provider_leases', 'expires_at', 'timestamp with time zone', true),
    ('amora_usage_reservations', 'request_key', 'text', true),
    ('amora_usage_reservations', 'request_hash', 'text', true),
    ('amora_usage_reservations', 'provider_ordinal', 'smallint', true),
    ('amora_usage_reservations', 'provider_state', 'text', true),
    ('amora_usage_reservations', 'visible_state', 'text', false),
    ('amora_usage_reservations', 'counted_user_turn', 'boolean', true),
    ('account_deletion_jobs', 'id', 'uuid', true),
    ('account_deletion_jobs', 'user_id', 'uuid', false),
    ('account_deletion_jobs', 'reason', 'text', true),
    ('account_deletion_jobs', 'status', 'text', true),
    ('account_deletion_jobs', 'attempts', 'integer', true),
    ('account_deletion_jobs', 'next_attempt_at', 'timestamp with time zone', false),
    ('account_deletion_jobs', 'lock_token', 'uuid', false),
    ('account_deletion_jobs', 'locked_until', 'timestamp with time zone', false),
    ('account_deletion_jobs', 'storage_inventory', 'jsonb', false),
    ('account_deletion_jobs', 'last_error_code', 'text', false),
    ('account_deletion_jobs', 'last_attempt_at', 'timestamp with time zone', false),
    ('account_deletion_jobs', 'dead_lettered_at', 'timestamp with time zone', false),
    ('account_deletion_jobs', 'completed_at', 'timestamp with time zone', false),
    ('account_deletion_jobs', 'created_at', 'timestamp with time zone', true),
    ('account_deletion_jobs', 'updated_at', 'timestamp with time zone', true),
    ('account_deletion_jobs', 'email_scopes', 'text[]', false),
    ('account_deletion_jobs', 'email_snapshot_at', 'timestamp with time zone', false),
    ('research_cohort_applications', 'id', 'uuid', true),
    ('research_cohort_applications', 'cohort_code', 'text', true),
    ('research_cohort_applications', 'email', 'text', true),
    ('research_cohort_applications', 'name', 'text', false),
    ('research_cohort_applications', 'wedding_date', 'date', false),
    ('research_cohort_applications', 'role', 'text', true),
    ('research_cohort_applications', 'message', 'text', false),
    ('research_cohort_applications', 'source', 'text', true),
    ('research_cohort_applications', 'utm_source', 'text', false),
    ('research_cohort_applications', 'utm_medium', 'text', false),
    ('research_cohort_applications', 'utm_campaign', 'text', false),
    ('research_cohort_applications', 'privacy_consent_at', 'timestamp with time zone', true),
    ('research_cohort_applications', 'privacy_policy_version', 'text', true),
    ('research_cohort_applications', 'email_verified_at', 'timestamp with time zone', false),
    ('research_cohort_applications', 'receipt_email_status', 'text', true),
    ('research_cohort_applications', 'receipt_email_attempted_at', 'timestamp with time zone', false),
    ('research_cohort_applications', 'created_at', 'timestamp with time zone', true),
    ('research_cohort_applications', 'expires_at', 'timestamp with time zone', true)
), column_status AS (
  SELECT required.table_name,
         required.column_name,
         format_type(attribute_row.atttypid, attribute_row.atttypmod) AS actual_type,
         attribute_row.attnotnull AS actual_not_null,
         attribute_row.attname IS NOT NULL
           AND format_type(attribute_row.atttypid, attribute_row.atttypmod)
             = required.data_type
           AND attribute_row.attnotnull = required.not_null AS exact
  FROM required_columns required
  LEFT JOIN pg_class table_row
    ON table_row.oid = to_regclass('public.' || required.table_name)
   AND table_row.relkind = 'r'
  LEFT JOIN pg_attribute attribute_row
    ON attribute_row.attrelid = table_row.oid
   AND attribute_row.attname = required.column_name
   AND attribute_row.attnum > 0
   AND NOT attribute_row.attisdropped
), required_tables(table_name) AS (
  VALUES
    ('amora_request_claims'),
    ('amora_provider_leases'),
    ('amora_usage_reservations'),
    ('research_cohort_applications')
), table_status AS (
  SELECT required.table_name,
         table_row.relkind,
         table_row.relkind = 'r' AS exact
  FROM required_tables required
  LEFT JOIN pg_class table_row
    ON table_row.oid = to_regclass('public.' || required.table_name)
), sensitive_tables(table_name, expected_force_rls) AS (
  VALUES
    ('profiles', false),
    ('couples', false),
    ('wedding_journeys', false),
    ('account_deletions', false),
    ('customer_survey_responses', false),
    ('chat_feedback', false),
    ('community_reports', false),
    ('cohort_member_reports', false),
    ('cohort_members', false),
    ('cohort_messages', false),
    ('research_cohort_applications', false)
), sensitive_status AS (
  SELECT required.table_name,
         table_row.relkind,
         table_row.relrowsecurity AS rls_enabled,
         table_row.relforcerowsecurity AS force_rls,
         CASE WHEN table_row.oid IS NULL THEN NULL ELSE
           has_table_privilege(
             'anon', format('public.%I', required.table_name), 'SELECT'
           )
         END AS anon_select,
         EXISTS (
           SELECT 1
           FROM pg_policies policy
           WHERE policy.schemaname = 'public'
             AND policy.tablename = required.table_name
             AND policy.roles && ARRAY['anon'::name, 'public'::name]
         ) AS anon_policy_present,
         table_row.relkind = 'r'
           AND table_row.relrowsecurity
           AND table_row.relforcerowsecurity = required.expected_force_rls
           AND NOT has_table_privilege(
             'anon', format('public.%I', required.table_name), 'SELECT'
           )
           AND NOT EXISTS (
             SELECT 1
             FROM pg_policies policy
             WHERE policy.schemaname = 'public'
               AND policy.tablename = required.table_name
               AND policy.roles && ARRAY['anon'::name, 'public'::name]
           ) AS exact
  FROM sensitive_tables required
  LEFT JOIN pg_class table_row
    ON table_row.oid = to_regclass('public.' || required.table_name)
), internal_tables(table_name, policy_name) AS (
  VALUES
    ('amora_request_claims', 'amora_request_claims_service_role_all'),
    ('account_deletion_jobs', 'account_deletion_jobs_service_only')
), internal_acl_status AS (
  SELECT required.table_name,
         table_row.relkind = 'r'
           AND table_row.relrowsecurity
           AND has_table_privilege(
             'service_role', format('public.%I', required.table_name), 'SELECT'
           )
           AND has_table_privilege(
             'service_role', format('public.%I', required.table_name), 'INSERT'
           )
           AND has_table_privilege(
             'service_role', format('public.%I', required.table_name), 'UPDATE'
           )
           AND has_table_privilege(
             'service_role', format('public.%I', required.table_name), 'DELETE'
           )
           AND NOT has_table_privilege(
             'anon', format('public.%I', required.table_name),
             'SELECT,INSERT,UPDATE,DELETE'
           )
           AND NOT has_table_privilege(
             'authenticated', format('public.%I', required.table_name),
             'SELECT,INSERT,UPDATE,DELETE'
           )
           AND 1 = (
             SELECT count(*)
             FROM pg_policies policy
             WHERE policy.schemaname = 'public'
               AND policy.tablename = required.table_name
               AND policy.policyname = required.policy_name
               AND policy.cmd = 'ALL'
               AND policy.roles = ARRAY['service_role'::name]
               AND policy.qual = 'true'
               AND policy.with_check = 'true'
           ) AS exact
  FROM internal_tables required
  LEFT JOIN pg_class table_row
    ON table_row.oid = to_regclass('public.' || required.table_name)
), account_deletion_job_defaults AS (
  SELECT 6 = (
    SELECT count(*)
    FROM pg_attrdef default_row
    WHERE default_row.adrelid = to_regclass('public.account_deletion_jobs')
  ) AND NOT EXISTS (
    SELECT 1
    FROM (VALUES
      ('id', 'gen_random_uuid()'),
      ('reason', '''unknown''::text'),
      ('status', '''pending''::text'),
      ('attempts', '0'),
      ('created_at', 'now()'),
      ('updated_at', 'now()')
    ) expected(column_name, expected_default)
    LEFT JOIN pg_attribute attribute_row
      ON attribute_row.attrelid = to_regclass('public.account_deletion_jobs')
     AND attribute_row.attname = expected.column_name
     AND attribute_row.attnum > 0
     AND NOT attribute_row.attisdropped
    LEFT JOIN pg_attrdef default_row
      ON default_row.adrelid = attribute_row.attrelid
     AND default_row.adnum = attribute_row.attnum
    WHERE default_row.oid IS NULL
       OR pg_get_expr(default_row.adbin, default_row.adrelid)
         IS DISTINCT FROM expected.expected_default
  ) AND 2 = (
    SELECT count(*)
    FROM pg_attribute attribute_row
    LEFT JOIN pg_attrdef default_row
      ON default_row.adrelid = attribute_row.attrelid
     AND default_row.adnum = attribute_row.attnum
    WHERE attribute_row.attrelid = to_regclass('public.account_deletion_jobs')
      AND attribute_row.attname IN ('email_scopes', 'email_snapshot_at')
      AND attribute_row.attnum > 0
      AND NOT attribute_row.attisdropped
      AND attribute_row.attidentity = ''
      AND attribute_row.attgenerated = ''
      AND default_row.oid IS NULL
  ) AS exact
), account_deletion_job_constraints AS (
  SELECT EXISTS (
      SELECT 1 FROM pg_constraint constraint_row
      WHERE constraint_row.conrelid = to_regclass('public.account_deletion_jobs')
        AND constraint_row.conname = 'account_deletion_jobs_pkey'
        AND constraint_row.convalidated
        AND pg_get_constraintdef(constraint_row.oid, true) = 'PRIMARY KEY (id)'
    ) AND NOT EXISTS (
      SELECT 1
      FROM (VALUES
        ('account_deletion_jobs_user_id_key',
          'UNIQUE (user_id)'),
        ('account_deletion_jobs_reason_check',
          'CHECK (reason = ANY (ARRAY[''unsatisfied''::text, ''alternative''::text, ''wedding_done''::text, ''privacy''::text, ''low_usage''::text, ''other''::text, ''unknown''::text]))'),
        ('account_deletion_jobs_status_check',
          'CHECK (status = ANY (ARRAY[''pending''::text, ''processing''::text, ''retry''::text, ''dead_letter''::text, ''completed''::text]))'),
        ('account_deletion_jobs_attempts_check',
          'CHECK (attempts >= 0 AND attempts <= 8)'),
        ('account_deletion_jobs_check',
          'CHECK ((status = ''completed''::text) = (completed_at IS NOT NULL))'),
        ('account_deletion_jobs_check1',
          'CHECK (status <> ''completed''::text OR user_id IS NULL)'),
        ('account_deletion_jobs_check2',
          'CHECK (status <> ''processing''::text OR lock_token IS NOT NULL AND locked_until IS NOT NULL)'),
        ('account_deletion_jobs_check3',
          'CHECK (status = ''processing''::text OR lock_token IS NULL AND locked_until IS NULL)'),
        ('account_deletion_jobs_last_error_code_check',
          'CHECK (last_error_code IS NULL OR last_error_code ~ ''^[A-Z0-9_]{1,64}$''::text)'),
        ('account_deletion_jobs_storage_inventory_check',
          'CHECK (storage_inventory IS NULL OR jsonb_typeof(storage_inventory) = ''array''::text)'),
        ('account_deletion_jobs_email_snapshot_lifecycle_check',
          'CHECK (status = ''completed''::text AND email_scopes IS NULL AND email_snapshot_at IS NULL OR status <> ''completed''::text AND email_scopes IS NOT NULL AND email_snapshot_at IS NOT NULL)'),
        ('account_deletion_jobs_email_scopes_bounded_check',
          'CHECK (email_scopes IS NULL OR cardinality(email_scopes) >= 0 AND cardinality(email_scopes) <= 8 AND array_position(email_scopes, NULL::text) IS NULL)'),
        ('account_deletion_jobs_email_scopes_canonical_check',
          'CHECK (email_scopes IS NULL OR account_deletion_email_scopes_are_canonical(email_scopes))')
      ) expected(constraint_name, expected_definition)
      LEFT JOIN pg_constraint constraint_row
        ON constraint_row.conrelid = to_regclass('public.account_deletion_jobs')
       AND constraint_row.conname = expected.constraint_name
      WHERE constraint_row.oid IS NULL
         OR NOT constraint_row.convalidated
         OR pg_get_constraintdef(constraint_row.oid, true)
           IS DISTINCT FROM expected.expected_definition
    ) AS exact
), account_deletion_job_indexes AS (
  SELECT NOT EXISTS (
    SELECT 1
    FROM (VALUES
      ('account_deletion_jobs_due_idx',
        'CREATE INDEX account_deletion_jobs_due_idx ON public.account_deletion_jobs USING btree (next_attempt_at, created_at) WHERE (status = ANY (ARRAY[''pending''::text, ''retry''::text]))'),
      ('account_deletion_jobs_stale_lock_idx',
        'CREATE INDEX account_deletion_jobs_stale_lock_idx ON public.account_deletion_jobs USING btree (locked_until) WHERE (status = ''processing''::text)'),
      ('account_deletion_jobs_dead_letter_idx',
        'CREATE INDEX account_deletion_jobs_dead_letter_idx ON public.account_deletion_jobs USING btree (dead_lettered_at DESC) WHERE (status = ''dead_letter''::text)')
    ) expected(index_name, expected_definition)
    LEFT JOIN pg_class index_class
      ON index_class.relnamespace = 'public'::regnamespace
     AND index_class.relname = expected.index_name
    LEFT JOIN pg_index index_row ON index_row.indexrelid = index_class.oid
    WHERE index_class.oid IS NULL
       OR NOT index_row.indisvalid
       OR NOT index_row.indisready
       OR pg_get_indexdef(index_class.oid)
         IS DISTINCT FROM expected.expected_definition
  ) AS exact
), required_triggers(
  schema_name, table_name, trigger_name, function_signature, definition
) AS (
  VALUES
    ('public', 'chat_summaries', 'guard_delete_chat_summaries', 'public.guard_account_deletion_user_reference()', 'CREATE TRIGGER guard_delete_chat_summaries BEFORE INSERT OR UPDATE ON chat_summaries FOR EACH ROW EXECUTE FUNCTION guard_account_deletion_user_reference(''user_id'')'),
    ('public', 'chat_feedback', 'guard_delete_chat_feedback', 'public.guard_account_deletion_user_reference()', 'CREATE TRIGGER guard_delete_chat_feedback BEFORE INSERT OR UPDATE ON chat_feedback FOR EACH ROW EXECUTE FUNCTION guard_account_deletion_user_reference(''user_id'')'),
    ('public', 'search_logs', 'guard_delete_search_logs', 'public.guard_account_deletion_user_reference()', 'CREATE TRIGGER guard_delete_search_logs BEFORE INSERT OR UPDATE ON search_logs FOR EACH ROW EXECUTE FUNCTION guard_account_deletion_user_reference(''user_id'')'),
    ('public', 'vendor_photo_likes', 'guard_delete_vendor_photo_likes', 'public.guard_account_deletion_user_reference()', 'CREATE TRIGGER guard_delete_vendor_photo_likes BEFORE INSERT OR UPDATE ON vendor_photo_likes FOR EACH ROW EXECUTE FUNCTION guard_account_deletion_user_reference(''user_id'')'),
    ('public', 'customer_events', 'guard_delete_customer_events', 'public.guard_account_deletion_user_reference()', 'CREATE TRIGGER guard_delete_customer_events BEFORE INSERT OR UPDATE ON customer_events FOR EACH ROW EXECUTE FUNCTION guard_account_deletion_user_reference(''user_id'')'),
    ('public', 'amora_quote_checks', 'guard_delete_quote_checks', 'public.guard_account_deletion_user_reference()', 'CREATE TRIGGER guard_delete_quote_checks BEFORE INSERT OR UPDATE ON amora_quote_checks FOR EACH ROW EXECUTE FUNCTION guard_account_deletion_user_reference(''user_id'')'),
    ('public', 'vendor_reviews', 'guard_delete_vendor_reviews', 'public.guard_account_deletion_user_reference()', 'CREATE TRIGGER guard_delete_vendor_reviews BEFORE INSERT OR UPDATE ON vendor_reviews FOR EACH ROW EXECUTE FUNCTION guard_account_deletion_user_reference(''customer_id'')'),
    ('public', 'vendor_views', 'guard_delete_vendor_views', 'public.guard_account_deletion_user_reference()', 'CREATE TRIGGER guard_delete_vendor_views BEFORE INSERT OR UPDATE ON vendor_views FOR EACH ROW EXECUTE FUNCTION guard_account_deletion_user_reference(''viewer_id'')'),
    ('public', 'ai_interactions_log', 'guard_delete_ai_logs', 'public.guard_account_deletion_user_reference()', 'CREATE TRIGGER guard_delete_ai_logs BEFORE INSERT OR UPDATE ON ai_interactions_log FOR EACH ROW EXECUTE FUNCTION guard_account_deletion_user_reference(''user_id'')'),
    ('public', 'congratulatory_money', 'guard_delete_money', 'public.guard_account_deletion_user_reference()', 'CREATE TRIGGER guard_delete_money BEFORE INSERT OR UPDATE ON congratulatory_money FOR EACH ROW EXECUTE FUNCTION guard_account_deletion_user_reference(''owner_user_id'')'),
    ('public', 'community_agent_personas', 'guard_delete_agent_personas', 'public.guard_account_deletion_user_reference()', 'CREATE TRIGGER guard_delete_agent_personas BEFORE INSERT OR UPDATE ON community_agent_personas FOR EACH ROW EXECUTE FUNCTION guard_account_deletion_user_reference(''backing_user_id'')'),
    ('public', 'amora_actions', 'guard_delete_amora_actions', 'public.guard_account_deletion_user_reference()', 'CREATE TRIGGER guard_delete_amora_actions BEFORE INSERT OR UPDATE ON amora_actions FOR EACH ROW EXECUTE FUNCTION guard_account_deletion_user_reference(''created_by'')'),
    ('public', 'rate_limit_buckets', 'guard_delete_rate_limit_buckets', 'public.guard_account_deletion_rate_limit_write()', 'CREATE TRIGGER guard_delete_rate_limit_buckets BEFORE INSERT OR UPDATE ON rate_limit_buckets FOR EACH ROW EXECUTE FUNCTION guard_account_deletion_rate_limit_write()'),
    ('public', 'profiles', 'trg_prevent_profile_membership_self_change', 'public.prevent_profile_membership_self_change()', 'CREATE TRIGGER trg_prevent_profile_membership_self_change BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION prevent_profile_membership_self_change()'),
    ('storage', 'objects', 'trg_guard_user_media_storage_write', 'public.guard_user_media_storage_write()', 'CREATE TRIGGER trg_guard_user_media_storage_write BEFORE INSERT OR UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION guard_user_media_storage_write()')
), trigger_status AS (
  SELECT required.schema_name,
         required.table_name,
         required.trigger_name,
         EXISTS (
           SELECT 1
           FROM pg_trigger trigger_row
           WHERE trigger_row.tgrelid = to_regclass(
               required.schema_name || '.' || required.table_name
             )
             AND trigger_row.tgname = required.trigger_name
             AND NOT trigger_row.tgisinternal
             AND trigger_row.tgenabled = 'O'
             AND trigger_row.tgfoid = to_regprocedure(required.function_signature)
             AND pg_get_triggerdef(trigger_row.oid, true) = required.definition
         ) AS exact
  FROM required_triggers required
), blocked_invite_constraint AS (
  SELECT constraint_row.convalidated
           AND pg_get_constraintdef(constraint_row.oid, true)
             = 'CHECK (amora_replacement_blocked_at IS NULL OR invite_code IS NULL)'
           AS exact
  FROM pg_constraint constraint_row
  WHERE constraint_row.conrelid = 'public.couples'::regclass
    AND constraint_row.conname = 'couples_blocked_invite_revoked'
)
SELECT jsonb_build_object(
  'migration_count', (
    SELECT count(*) FROM supabase_migrations.schema_migrations
  ),
  'latest_migration', (
    SELECT max(version) FROM supabase_migrations.schema_migrations
  ),
  'tables', jsonb_build_object(
    'amora_request_claims', COALESCE((
      SELECT exact FROM table_status WHERE table_name = 'amora_request_claims'
    ), false),
    'amora_provider_leases', COALESCE((
      SELECT exact FROM table_status WHERE table_name = 'amora_provider_leases'
    ), false),
    'amora_usage_reservations', COALESCE((
      SELECT exact FROM table_status WHERE table_name = 'amora_usage_reservations'
    ), false),
    'invitations_retired',
      to_regclass('public.invitation_visits') IS NULL
      AND to_regclass('public.invitation_guestbook') IS NULL
      AND to_regclass('public.invitation_rsvp') IS NULL
      AND to_regclass('public.invitation_accounts') IS NULL
      AND to_regclass('public.invitation_photos') IS NULL
      AND to_regclass('public.invitations') IS NULL
      AND to_regclass('public.invitation_templates') IS NULL
      AND to_regclass('public.ai_scripts') IS NULL
  ),
  'all_functions_present', NOT EXISTS (
    SELECT 1 FROM function_status WHERE NOT exact
  ),
  'function_status', (
    SELECT jsonb_object_agg(signature, to_jsonb(status_row) - 'signature'
      ORDER BY signature)
    FROM function_status status_row
  ),
  'all_client_denied_trigger_functions_exact', NOT EXISTS (
    SELECT 1 FROM client_denied_trigger_function_status WHERE NOT exact
  ),
  'client_denied_trigger_function_status', (
    SELECT jsonb_object_agg(signature, to_jsonb(status_row) - 'signature'
      ORDER BY signature)
    FROM client_denied_trigger_function_status status_row
  ),
  'all_client_denied_trigger_bindings_exact', NOT EXISTS (
    SELECT 1 FROM client_denied_trigger_binding_status WHERE NOT exact
  ),
  'client_denied_trigger_binding_status', (
    SELECT jsonb_object_agg(
      schema_name || '.' || table_name || '.' || trigger_name,
      to_jsonb(status_row) - 'schema_name' - 'table_name' - 'trigger_name'
      ORDER BY schema_name, table_name, trigger_name
    )
    FROM client_denied_trigger_binding_status status_row
  ),
  'all_maintenance_crons_exact', NOT EXISTS (
    SELECT 1 FROM maintenance_cron_status WHERE NOT exact
  ),
  'maintenance_cron_status', (
    SELECT jsonb_object_agg(
      job_name,
      to_jsonb(status_row) - 'job_name'
      ORDER BY job_name
    ) FROM maintenance_cron_status status_row
  ),
  'vendor_upload_insert_policies_absent', NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies policy_row
    WHERE policy_row.schemaname = 'storage'
      AND policy_row.tablename = 'objects'
      AND policy_row.policyname IN (
        '업체: 본인 이미지 업로드',
        '업체: 사업자등록증 업로드',
        'vendor images own folder insert',
        'vendor licenses own folder insert'
      )
  ),
  'unproven_vendor_upload_objects_absent', NOT EXISTS (
    SELECT 1
    FROM storage.objects object_row
    WHERE object_row.bucket_id = 'vendor-licenses'
       OR (
         object_row.bucket_id = 'vendor-images'
         AND (storage.foldername(object_row.name))[1] ~*
           '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       )
  ),
  'all_columns_present', NOT EXISTS (
    SELECT 1 FROM column_status WHERE NOT exact
  ),
  'column_status', (
    SELECT jsonb_object_agg(
      table_name || '.' || column_name,
      to_jsonb(status_row) - 'table_name' - 'column_name'
      ORDER BY table_name, column_name
    )
    FROM column_status status_row
  ),
  'research_cohort_application_identity_exact',
    EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class table_row
      WHERE table_row.oid = to_regclass('public.research_cohort_applications')
        AND table_row.relkind = 'r'
        AND table_row.relrowsecurity
        AND NOT table_row.relforcerowsecurity
        AND pg_get_userbyid(table_row.relowner) = 'postgres'
    )
    AND 5 = (
      SELECT count(*)
      FROM pg_catalog.pg_attrdef default_row
      WHERE default_row.adrelid = to_regclass('public.research_cohort_applications')
    )
    AND NOT EXISTS (
      SELECT count(*)
      FROM (VALUES
        ('id', 'gen_random_uuid()'),
        ('source', '''research''::text'),
        ('receipt_email_status', '''pending''::text'),
        ('created_at', 'now()'),
        ('expires_at', '(now() + ''180 days''::interval)')
      ) expected(column_name, expected_default)
      LEFT JOIN pg_catalog.pg_attribute attribute_row
        ON attribute_row.attrelid = to_regclass('public.research_cohort_applications')
       AND attribute_row.attname = expected.column_name
       AND attribute_row.attnum > 0
       AND NOT attribute_row.attisdropped
      LEFT JOIN pg_catalog.pg_attrdef default_row
        ON default_row.adrelid = attribute_row.attrelid
       AND default_row.adnum = attribute_row.attnum
      WHERE default_row.oid IS NULL
         OR pg_get_expr(default_row.adbin, default_row.adrelid)
           IS DISTINCT FROM expected.expected_default
      HAVING count(*) > 0
    )
    AND 18 = (
      SELECT count(*)
      FROM pg_catalog.pg_constraint constraint_row
      WHERE constraint_row.conrelid = to_regclass('public.research_cohort_applications')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM (VALUES
        ('research_cohort_applications_pkey',
          'p'::"char", 'PRIMARY KEY (id)'),
        ('research_cohort_applications_identity_key',
          'u'::"char", 'UNIQUE (cohort_code, email)'),
        ('research_cohort_applications_cohort_check',
          'c'::"char", 'CHECK (cohort_code = ''research-2026-h2''::text)'),
        ('research_cohort_applications_email_identity_check',
          'c'::"char", 'CHECK (email = lower(btrim(email)) AND char_length(email) >= 3 AND char_length(email) <= 254 AND email ~ ''^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$''::text)'),
        ('research_cohort_applications_name_check',
          'c'::"char", 'CHECK (name IS NULL OR name = btrim(name) AND char_length(name) >= 1 AND char_length(name) <= 60)'),
        ('research_cohort_applications_wedding_date_window_check',
          'c'::"char", 'CHECK (wedding_date IS NULL OR wedding_date >= ''2026-07-01''::date AND wedding_date <= ''2026-12-31''::date)'),
        ('research_cohort_applications_role_check',
          'c'::"char", 'CHECK (role = ANY (ARRAY[''bride''::text, ''groom''::text]))'),
        ('research_cohort_applications_message_check',
          'c'::"char", 'CHECK (message IS NULL OR message = btrim(message) AND char_length(message) >= 1 AND char_length(message) <= 500)'),
        ('research_cohort_applications_source_check',
          'c'::"char", 'CHECK (source = ''research''::text)'),
        ('research_cohort_applications_utm_source_check',
          'c'::"char", 'CHECK (utm_source IS NULL OR utm_source = btrim(utm_source) AND char_length(utm_source) >= 1 AND char_length(utm_source) <= 80)'),
        ('research_cohort_applications_utm_medium_check',
          'c'::"char", 'CHECK (utm_medium IS NULL OR utm_medium = btrim(utm_medium) AND char_length(utm_medium) >= 1 AND char_length(utm_medium) <= 80)'),
        ('research_cohort_applications_utm_campaign_check',
          'c'::"char", 'CHECK (utm_campaign IS NULL OR utm_campaign = btrim(utm_campaign) AND char_length(utm_campaign) >= 1 AND char_length(utm_campaign) <= 120)'),
        ('research_cohort_applications_privacy_consent_timestamp_check',
          'c'::"char", 'CHECK (privacy_consent_at = created_at)'),
        ('research_cohort_applications_privacy_policy_check',
          'c'::"char", 'CHECK (privacy_policy_version = ''2026-07-12''::text)'),
        ('research_cohort_applications_receipt_status_check',
          'c'::"char", 'CHECK (receipt_email_status = ANY (ARRAY[''pending''::text, ''sent''::text, ''failed''::text]))'),
        ('research_cohort_applications_receipt_lifecycle_check',
          'c'::"char", 'CHECK (receipt_email_status = ''pending''::text AND receipt_email_attempted_at IS NULL OR (receipt_email_status = ANY (ARRAY[''sent''::text, ''failed''::text])) AND receipt_email_attempted_at IS NOT NULL AND receipt_email_attempted_at >= created_at AND receipt_email_attempted_at <= expires_at)'),
        ('research_cohort_applications_retention_cap',
          'c'::"char", 'CHECK (expires_at >= created_at AND expires_at <= (created_at + ''180 days''::interval))'),
        ('research_cohort_applications_email_verification_window_check',
          'c'::"char", 'CHECK (email_verified_at IS NULL OR email_verified_at >= created_at AND email_verified_at <= expires_at)')
      ) expected(constraint_name, constraint_type, expected_definition)
      LEFT JOIN pg_catalog.pg_constraint constraint_row
        ON constraint_row.conrelid = to_regclass('public.research_cohort_applications')
       AND constraint_row.conname = expected.constraint_name
      WHERE constraint_row.oid IS NULL
         OR constraint_row.contype IS DISTINCT FROM expected.constraint_type
         OR NOT constraint_row.convalidated
         OR pg_get_constraintdef(constraint_row.oid, true)
           IS DISTINCT FROM expected.expected_definition
    )
    AND 4 = (
      SELECT count(*)
      FROM pg_catalog.pg_index index_row
      WHERE index_row.indrelid = to_regclass('public.research_cohort_applications')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM (VALUES
        ('idx_research_cohort_applications_expires_at',
          'CREATE INDEX idx_research_cohort_applications_expires_at ON public.research_cohort_applications USING btree (expires_at)'),
        ('idx_research_cohort_applications_current',
          'CREATE INDEX idx_research_cohort_applications_current ON public.research_cohort_applications USING btree (cohort_code, created_at DESC) WHERE (privacy_consent_at IS NOT NULL AND email_verified_at IS NOT NULL)')
      ) expected(index_name, expected_definition)
      LEFT JOIN pg_catalog.pg_class index_class
        ON index_class.relnamespace = 'public'::regnamespace
       AND index_class.relname = expected.index_name
      LEFT JOIN pg_catalog.pg_index index_row
        ON index_row.indexrelid = index_class.oid
       AND index_row.indrelid = to_regclass('public.research_cohort_applications')
      WHERE index_class.oid IS NULL
         OR index_row.indexrelid IS NULL
         OR NOT index_row.indisvalid
         OR NOT index_row.indisready
         OR pg_get_indexdef(index_class.oid)
           IS DISTINCT FROM expected.expected_definition
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_index index_row
      JOIN pg_catalog.pg_attribute email_column
        ON email_column.attrelid = index_row.indrelid
       AND email_column.attname = 'email'
       AND email_column.attnum > 0
       AND NOT email_column.attisdropped
      WHERE index_row.indrelid = to_regclass('public.research_cohort_applications')
        AND index_row.indisunique
        AND index_row.indnkeyatts = 1
        AND index_row.indkey[0] = email_column.attnum
    )
    AND 1 = (
      SELECT count(*)
      FROM pg_catalog.pg_trigger trigger_row
      WHERE trigger_row.tgrelid = to_regclass('public.research_cohort_applications')
        AND NOT trigger_row.tgisinternal
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger trigger_row
      WHERE trigger_row.tgrelid = to_regclass('public.research_cohort_applications')
        AND trigger_row.tgname = 'trg_clamp_research_cohort_application_retention'
        AND NOT trigger_row.tgisinternal
        AND trigger_row.tgenabled = 'O'
        AND trigger_row.tgfoid = to_regprocedure('public.clamp_preregistration_retention()')
        AND pg_get_triggerdef(trigger_row.oid, true) =
          'CREATE TRIGGER trg_clamp_research_cohort_application_retention BEFORE INSERT OR UPDATE OF created_at, expires_at ON research_cohort_applications FOR EACH ROW EXECUTE FUNCTION clamp_preregistration_retention()'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policies policy_row
      WHERE policy_row.schemaname = 'public'
        AND policy_row.tablename = 'research_cohort_applications'
    )
    AND has_table_privilege('service_role', 'public.research_cohort_applications', 'SELECT')
    AND has_table_privilege('service_role', 'public.research_cohort_applications', 'INSERT')
    AND has_table_privilege('service_role', 'public.research_cohort_applications', 'UPDATE')
    AND has_table_privilege('service_role', 'public.research_cohort_applications', 'DELETE')
    AND NOT has_table_privilege('service_role', 'public.research_cohort_applications', 'TRUNCATE')
    AND NOT has_table_privilege('service_role', 'public.research_cohort_applications', 'REFERENCES')
    AND NOT has_any_column_privilege('service_role', 'public.research_cohort_applications', 'REFERENCES')
    AND NOT has_table_privilege('service_role', 'public.research_cohort_applications', 'TRIGGER')
    AND NOT has_table_privilege('anon', 'public.research_cohort_applications', 'SELECT')
    AND NOT has_any_column_privilege('anon', 'public.research_cohort_applications', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.research_cohort_applications', 'INSERT')
    AND NOT has_any_column_privilege('anon', 'public.research_cohort_applications', 'INSERT')
    AND NOT has_table_privilege('anon', 'public.research_cohort_applications', 'UPDATE')
    AND NOT has_any_column_privilege('anon', 'public.research_cohort_applications', 'UPDATE')
    AND NOT has_table_privilege('anon', 'public.research_cohort_applications', 'DELETE')
    AND NOT has_table_privilege('anon', 'public.research_cohort_applications', 'TRUNCATE')
    AND NOT has_table_privilege('anon', 'public.research_cohort_applications', 'REFERENCES')
    AND NOT has_any_column_privilege('anon', 'public.research_cohort_applications', 'REFERENCES')
    AND NOT has_table_privilege('anon', 'public.research_cohort_applications', 'TRIGGER')
    AND NOT has_table_privilege('authenticated', 'public.research_cohort_applications', 'SELECT')
    AND NOT has_any_column_privilege('authenticated', 'public.research_cohort_applications', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.research_cohort_applications', 'INSERT')
    AND NOT has_any_column_privilege('authenticated', 'public.research_cohort_applications', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.research_cohort_applications', 'UPDATE')
    AND NOT has_any_column_privilege('authenticated', 'public.research_cohort_applications', 'UPDATE')
    AND NOT has_table_privilege('authenticated', 'public.research_cohort_applications', 'DELETE')
    AND NOT has_table_privilege('authenticated', 'public.research_cohort_applications', 'TRUNCATE')
    AND NOT has_table_privilege('authenticated', 'public.research_cohort_applications', 'REFERENCES')
    AND NOT has_any_column_privilege('authenticated', 'public.research_cohort_applications', 'REFERENCES')
    AND NOT has_table_privilege('authenticated', 'public.research_cohort_applications', 'TRIGGER'),
  'rate_limit_subject_contract_exact', EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute attribute_row
    LEFT JOIN pg_catalog.pg_attrdef default_row
      ON default_row.adrelid = attribute_row.attrelid
     AND default_row.adnum = attribute_row.attnum
    WHERE attribute_row.attrelid = to_regclass('public.rate_limit_buckets')
      AND attribute_row.attname = 'subject_user_id'
      AND attribute_row.atttypid = 'uuid'::regtype
      AND NOT attribute_row.attnotnull
      AND NOT attribute_row.attisdropped
      AND attribute_row.attidentity = ''
      AND attribute_row.attgenerated = ''
      AND default_row.oid IS NULL
  ) AND EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint constraint_row
    WHERE constraint_row.conrelid = to_regclass('public.rate_limit_buckets')
      AND constraint_row.conname = 'rate_limit_buckets_subject_user_id_fkey'
      AND constraint_row.convalidated
      AND pg_get_constraintdef(constraint_row.oid, true) =
        'FOREIGN KEY (subject_user_id) REFERENCES profiles(id) ON DELETE CASCADE'
  ) AND EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class index_class
    JOIN pg_catalog.pg_index index_row ON index_row.indexrelid = index_class.oid
    WHERE index_class.relnamespace = 'public'::regnamespace
      AND index_class.relname = 'idx_rate_limit_buckets_subject_user_id'
      AND index_row.indisvalid
      AND index_row.indisready
      AND pg_get_indexdef(index_class.oid) =
        'CREATE INDEX idx_rate_limit_buckets_subject_user_id ON public.rate_limit_buckets USING btree (subject_user_id) WHERE (subject_user_id IS NOT NULL)'
  )
  AND has_table_privilege(
    'service_role', 'public.rate_limit_buckets', 'SELECT'
  )
  AND has_table_privilege(
    'service_role', 'public.rate_limit_buckets', 'DELETE'
  )
  AND NOT has_table_privilege(
    'service_role', 'public.rate_limit_buckets', 'INSERT'
  )
  AND NOT has_any_column_privilege(
    'service_role', 'public.rate_limit_buckets', 'INSERT'
  )
  AND NOT has_table_privilege(
    'service_role', 'public.rate_limit_buckets', 'UPDATE'
  )
  AND NOT has_any_column_privilege(
    'service_role', 'public.rate_limit_buckets', 'UPDATE'
  )
  AND NOT has_table_privilege(
    'service_role', 'public.rate_limit_buckets', 'TRUNCATE'
  )
  AND NOT has_table_privilege(
    'service_role', 'public.rate_limit_buckets', 'REFERENCES'
  )
  AND NOT has_any_column_privilege(
    'service_role', 'public.rate_limit_buckets', 'REFERENCES'
  )
  AND NOT has_table_privilege(
    'service_role', 'public.rate_limit_buckets', 'TRIGGER'
  ),
  'blocked_invite_constraint_valid', COALESCE(
    (SELECT exact FROM blocked_invite_constraint), false
  ),
  'public_schema_create_locked',
    NOT has_schema_privilege('anon', 'public', 'CREATE')
    AND NOT has_schema_privilege('authenticated', 'public', 'CREATE'),
  'internal_service_acl_exact', NOT EXISTS (
    SELECT 1 FROM internal_acl_status WHERE NOT exact
  ),
  'account_deletion_jobs_catalog_exact',
    NOT EXISTS (
      SELECT 1 FROM column_status
      WHERE table_name = 'account_deletion_jobs' AND NOT exact
    )
    AND coalesce((SELECT exact FROM account_deletion_job_defaults), false)
    AND coalesce((SELECT exact FROM account_deletion_job_constraints), false)
    AND coalesce((SELECT exact FROM account_deletion_job_indexes), false),
  'internal_acl_status', (
    SELECT jsonb_object_agg(table_name, exact ORDER BY table_name)
    FROM internal_acl_status
  ),
  'account_deletion_triggers_present', NOT EXISTS (
    SELECT 1 FROM trigger_status WHERE NOT exact
  ),
  'trigger_status', (
    SELECT jsonb_object_agg(
      schema_name || '.' || table_name || '.' || trigger_name,
      exact ORDER BY schema_name, table_name, trigger_name
    )
    FROM trigger_status
  ),
  'all_sensitive_rls_present', NOT EXISTS (
    SELECT 1 FROM sensitive_status WHERE NOT exact
  ),
  'sensitive_status', (
    SELECT jsonb_object_agg(table_name, to_jsonb(status_row) - 'table_name'
      ORDER BY table_name)
    FROM sensitive_status status_row
  ),
  'legacy_invitation_photo_objects', (
    SELECT count(*) FROM storage.objects WHERE bucket_id = 'invitation-photos'
  ),
  'legacy_invitation_bucket_present', EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'invitation-photos'
  ),
  'retired_invitation_inventory_jobs', (
    SELECT count(*)
    FROM public.account_deletion_jobs AS job
    WHERE job.storage_inventory IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(job.storage_inventory) AS item(value)
        WHERE item.value->>'bucket' = 'invitation-photos'
      )
  )
) AS contract;
