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
    ('public.enforce_ai_interaction_retention()', 'TABLE(redacted integer, deleted integer)', 'search_path=pg_catalog, pg_temp', '806dc01af7ffe1047f9ffd381bf539c2'),
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
    ('public.request_account_deletion(uuid,text)', 'jsonb', 'search_path=public, pg_temp', 'd375108d46ea6663f58a7fbe80fa3d93'),
    (
      'public.claim_account_deletion_jobs(uuid,integer,integer)',
      'TABLE(job_id uuid, user_id uuid, reason text, attempts integer, storage_inventory jsonb)',
      'search_path=public, pg_temp', '2f21c2198582104158923a9726cf6d8f'
    ),
    ('public.save_account_deletion_storage_inventory(uuid,uuid,jsonb)', 'boolean', 'search_path=public, pg_temp', '14602d5c4e9ccc3eb90f4c5618549f9d'),
    ('public.fail_account_deletion_job(uuid,uuid,text)', 'text', 'search_path=public, pg_temp', '9795091031826ac0a932ec01249834a8'),
    ('public.renew_account_deletion_job_lease(uuid,uuid,integer)', 'boolean', 'search_path=public, pg_temp', 'ba6534442ff7bc582d4bdefc396bc841'),
    ('public.list_account_deletion_owned_storage_objects(uuid,uuid,text,text,integer)', 'TABLE(bucket_id text, object_name text)', 'search_path=pg_catalog, pg_temp', '4aee5587c9f133ff8e23609c23bfbd86'),
    ('public.mark_account_deletion_cleanup_ready(uuid,uuid,integer)', 'boolean', 'search_path=pg_catalog, pg_temp', '2bed182fdddecbf115ecd0856e14aed7'),
    ('public.complete_account_deletion_job(uuid,uuid)', 'boolean', 'search_path=public, pg_temp', 'b1e4030efdc81da7dcd4697206221ffc'),
    ('public.settle_court_provider_failure_internal(uuid,text)', 'text', 'search_path=pg_catalog, pg_temp', '7e2fb50315c4552e2048c0fe17db370a'),
    ('public.settle_court_provider_failure(uuid,text)', 'text', 'search_path=pg_catalog, pg_temp', 'f31008554a1e23b840674bbcfd634a0a'),
    ('public.settle_court_unstaged_provider_result_live(uuid,uuid,text,text,text,integer,integer,integer,integer)', 'jsonb', 'search_path=pg_catalog, pg_temp', '86f7199746ac3fb7d19b12c629b7c5e2'),
    ('public.settle_court_unstaged_provider_result(uuid,uuid,text,text,text,integer,integer,integer,integer)', 'jsonb', 'search_path=pg_catalog, pg_temp', '55e200a85ab23811e1de8ac0f699bb0f'),
    ('public.settle_court_high_risk_provider_result_live(uuid,uuid,uuid,text,text,text[],text,integer,integer,integer,integer)', 'jsonb', 'search_path=pg_catalog, pg_temp', 'df11c175cf296be4faeb8918eb5ba589'),
    ('public.settle_court_high_risk_provider_result(uuid,uuid,uuid,text,text,text[],text,integer,integer,integer,integer)', 'jsonb', 'search_path=pg_catalog, pg_temp', 'c25632c52a04e56677ced9e0629f8c1e'),
    ('public.write_court_provider_audit_live(text,jsonb,numeric)', 'jsonb', 'search_path=pg_catalog, pg_temp', '58e16d0d0323e86cb6b132f7fa7dc62e'),
    ('public.write_court_provider_audit(text,jsonb,numeric)', 'jsonb', 'search_path=pg_catalog, pg_temp', '4ee8cc03e1b68332882856c0ea2fb6e0'),
    ('public.finalize_court_provider_audit_live(uuid,text)', 'jsonb', 'search_path=pg_catalog, pg_temp', '179562b354f34b518327b1228d0baa1e'),
    ('public.finalize_court_provider_audit(uuid,text)', 'jsonb', 'search_path=pg_catalog, pg_temp', '948e284af8b1991a25c3eda178bed604'),
    ('public.claim_court_provider_audit_recovery_live(uuid,integer)', 'jsonb', 'search_path=pg_catalog, pg_temp', '41b7ea2a658a52bccb3e37795281128d'),
    ('public.claim_court_provider_audit_recovery(uuid,integer)', 'jsonb', 'search_path=pg_catalog, pg_temp', '36340ba20f40fd6f8cab0491d03990ec'),
    ('public.record_court_provider_audit_recovery_failure_live(uuid,uuid,uuid,text)', 'jsonb', 'search_path=pg_catalog, pg_temp', 'e01e0ecec59db41b376271c68973a312'),
    ('public.record_court_provider_audit_recovery_failure(uuid,uuid,uuid,text)', 'jsonb', 'search_path=pg_catalog, pg_temp', '4ad83a53a4a60dee093fab369d520c4f'),
    ('public.resolve_court_provider_deletion_handoff(uuid,uuid,text,text,text,integer,integer,integer,integer,numeric)', 'jsonb', 'search_path=pg_catalog, pg_temp', '7c774ec3289924fcae465251e8c18d0b'),
    ('public.enforce_court_provider_deletion_handoff_retention(integer)', 'jsonb', 'search_path=pg_catalog, pg_temp', '605f4f2ccf181a0de3861ad819a7dcb7'),
    ('public.enforce_ai_interaction_retention_live()', 'TABLE(redacted integer, deleted integer)', 'search_path=public', '85cb9b5ccafca3cca9b3cdf74ee4eddc'),
    ('public.list_court_provider_deletion_handoffs(uuid,integer)', 'TABLE(verdict_id uuid, created_at timestamp with time zone, expires_at timestamp with time zone)', 'search_path=pg_catalog, pg_temp', 'f3b9c678533ed27570420f01fb50d190'),
    ('public.list_court_provider_reconciliations(uuid,integer)', 'TABLE(verdict_id uuid, provider_state text, started_at timestamp with time zone, failed_at timestamp with time zone, provider_error_code text, created_at timestamp with time zone, updated_at timestamp with time zone)', 'search_path=pg_catalog, pg_temp', '6455d31459a942fce5bb88bcf35cb5bc'),
    ('public.reveal_court_provider_deletion_handoff_request_key(uuid,uuid,text)', 'jsonb', 'search_path=pg_catalog, pg_temp', '6a91b7a0a9c3a0191a7d87b7b5623d37'),
    ('public.reveal_court_provider_reconciliation_request_key(uuid,uuid,text)', 'jsonb', 'search_path=pg_catalog, pg_temp', '658c9c2eadfc38e07fcbffc536a6c443'),
    ('public.enforce_court_provider_request_key_reveal_audit_retention(integer)', 'integer', 'search_path=pg_catalog, pg_temp', 'e87a1188dffd2880a2291c2e5005524b')
), service_denied_functions(signature) AS (
  VALUES
    ('public.guard_account_deletion_user_reference()'),
    ('public.guard_account_deletion_rate_limit_write()'),
    ('public.redact_old_ai_interactions(interval)'),
    ('public.settle_court_provider_failure_internal(uuid,text)'),
    ('public.settle_court_unstaged_provider_result_live(uuid,uuid,text,text,text,integer,integer,integer,integer)'),
    ('public.settle_court_high_risk_provider_result_live(uuid,uuid,uuid,text,text,text[],text,integer,integer,integer,integer)'),
    ('public.write_court_provider_audit_live(text,jsonb,numeric)'),
    ('public.finalize_court_provider_audit_live(uuid,text)'),
    ('public.claim_court_provider_audit_recovery_live(uuid,integer)'),
    ('public.record_court_provider_audit_recovery_failure_live(uuid,uuid,uuid,text)'),
    ('public.enforce_ai_interaction_retention_live()')
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
          ) AND cardinality(procedure_row.proconfig) = 1 AS safe_search_path,
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
           AND cardinality(procedure_row.proconfig) = 1
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
), required_client_denied_trigger_functions(
  signature, expected_source_md5, expected_search_path,
  expected_service_role_execute
) AS (
  VALUES
    ('public.community_recalc_rank()', 'c742d9e87a9c815491d03c574690772c',
      'search_path=public', true),
    ('public.create_profile_on_signup()', '84a6f9f7f2c366bb87703fcc25cc2f22',
      'search_path=public', true),
    ('public.guard_amora_user_message_insert()', '3b3a72bfb77bfd27a0b7f43b718cb4c0',
      'search_path=public', true),
    ('public.guard_profile_self_insert()', 'e1a79bcb72eb8b1df1c5edb70f181e44',
      'search_path=public', true),
    ('public.prevent_cohort_membership_client_write()', '5947d166102367678683a8ae71c2b72d',
      'search_path=public', true),
    ('public.prevent_couple_ownership_self_change()', '697c40535a23d739a271b0b4e3b2ffbf',
      'search_path=public', true),
    ('public.prevent_couple_slot_self_change()', 'c795f37d371b8143d50b45d65de96411',
      'search_path=public', true),
    ('public.prevent_is_admin_self_change()', '9395ea55bfc5192e10ef000e0421d7b3',
      'search_path=public', true),
    ('public.lock_application_email_lifecycle_write()',
      '07ad809b73c9daac9ea0ebe7d90e2809',
      'search_path=pg_catalog, pg_temp', true),
    ('public.block_auth_user_update_during_account_deletion()',
      '7ccae1027d97c12b32d9d04c92a54002',
      'search_path=pg_catalog, pg_temp', false),
    ('public.block_storage_owner_write_during_account_deletion()',
      '32d02e88418f75f08d788ab5da07c9af',
      'search_path=pg_catalog, pg_temp', false),
    ('public.block_auth_user_delete_until_account_cleanup_ready()',
      '868a650d26b5bf4aff730c73b99f009e',
      'search_path=pg_catalog, pg_temp', false),
    ('public.handoff_court_provider_attempts_before_case_delete()',
      '4a60d39c0e0059451559e46d8bd9837b',
      'search_path=pg_catalog, pg_temp', false)
), client_denied_trigger_function_status AS (
  SELECT required.signature,
         procedure_row.oid IS NOT NULL
           AND pg_get_function_result(procedure_row.oid) = 'trigger'
           AND procedure_row.prosecdef
           AND pg_get_userbyid(procedure_row.proowner) = 'postgres'
           AND procedure_row.proconfig
             @> ARRAY[required.expected_search_path]::text[]
           AND cardinality(procedure_row.proconfig) = 1
           AND md5(replace(procedure_row.prosrc, chr(13), '')) =
             required.expected_source_md5
           AND has_function_privilege(
             'service_role', procedure_row.oid, 'EXECUTE'
           ) = required.expected_service_role_execute
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
      'CREATE TRIGGER trg_prevent_is_admin_self_change BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION prevent_is_admin_self_change()'),
    ('public', 'preregistrations',
      'trg_lock_preregistration_email_lifecycle',
      'public.lock_application_email_lifecycle_write()',
      'CREATE TRIGGER trg_lock_preregistration_email_lifecycle BEFORE INSERT OR UPDATE ON preregistrations FOR EACH ROW EXECUTE FUNCTION lock_application_email_lifecycle_write()'),
    ('public', 'research_cohort_applications',
      'trg_lock_research_cohort_application_email_lifecycle',
      'public.lock_application_email_lifecycle_write()',
      'CREATE TRIGGER trg_lock_research_cohort_application_email_lifecycle BEFORE INSERT OR UPDATE ON research_cohort_applications FOR EACH ROW EXECUTE FUNCTION lock_application_email_lifecycle_write()'),
    ('auth', 'users',
      'trg_block_auth_user_update_during_account_deletion',
      'public.block_auth_user_update_during_account_deletion()',
      'CREATE TRIGGER trg_block_auth_user_update_during_account_deletion BEFORE UPDATE ON auth.users FOR EACH ROW EXECUTE FUNCTION block_auth_user_update_during_account_deletion()'),
    ('storage', 'objects',
      'trg_block_storage_owner_write_during_account_deletion',
      'public.block_storage_owner_write_during_account_deletion()',
      'CREATE TRIGGER trg_block_storage_owner_write_during_account_deletion BEFORE INSERT OR UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION block_storage_owner_write_during_account_deletion()'),
    ('auth', 'users',
      'trg_block_auth_user_delete_until_account_cleanup_ready',
      'public.block_auth_user_delete_until_account_cleanup_ready()',
      'CREATE TRIGGER trg_block_auth_user_delete_until_account_cleanup_ready BEFORE DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION block_auth_user_delete_until_account_cleanup_ready()'),
    ('public', 'court_cases',
      'court_case_provider_handoff_before_delete',
      'public.handoff_court_provider_attempts_before_case_delete()',
      'CREATE TRIGGER court_case_provider_handoff_before_delete BEFORE DELETE ON court_cases FOR EACH ROW EXECUTE FUNCTION handoff_court_provider_attempts_before_case_delete()')
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
    ('enforce-court-provider-deletion-handoff-retention', '7 * * * *',
      'SELECT public.enforce_court_provider_deletion_handoff_retention(1000);'),
    ('enforce-court-provider-request-key-reveal-audit-retention', '37 * * * *',
      'SELECT public.enforce_court_provider_request_key_reveal_audit_retention(1000);'),
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
           AND job_row.database = current_database()
           AND job_row.username = 'postgres'
         ) AS definition_exact,
         count(job_row.jobid) = 1 AND bool_and(
           job_row.schedule = required.expected_schedule
           AND job_row.command = required.expected_command
           AND job_row.database = current_database()
           AND job_row.username = 'postgres'
           AND NOT job_row.active
         ) AS inactive_exact,
         count(job_row.jobid) = 1 AND bool_and(
           job_row.schedule = required.expected_schedule
           AND job_row.command = required.expected_command
           AND job_row.database = current_database()
           AND job_row.username = 'postgres'
           AND job_row.active
         ) AS exact
  FROM required_maintenance_crons required
  LEFT JOIN cron.job job_row ON job_row.jobname = required.job_name
  GROUP BY required.job_name
), maintenance_cron_runtime AS (
  SELECT
    coalesce(current_setting('cron.launch_active_jobs', true), '')
      AS launcher_state,
    coalesce(current_setting('cron.timezone', true), '') AS timezone,
    current_database() AS database,
    'postgres'::text AS scheduler_role,
    (
      SELECT count(*)::bigint
      FROM cron.job_run_details run_detail
      WHERE run_detail.status = 'running'
    ) AS running_job_count
), court_provider_required_columns(
  table_name, column_name, data_type, not_null, expected_default,
  introduced_version
) AS (
  VALUES
    ('court_provider_deletion_handoffs', 'id', 'uuid', true, 'gen_random_uuid()', '20260714100000'),
    ('court_provider_deletion_handoffs', 'request_key', 'text', true, NULL::text, '20260714100000'),
    ('court_provider_deletion_handoffs', 'verdict_id', 'uuid', true, NULL::text, '20260714100000'),
    ('court_provider_deletion_handoffs', 'lease_token', 'uuid', false, NULL::text, '20260714100000'),
    ('court_provider_deletion_handoffs', 'handoff_state', 'text', true, NULL::text, '20260714100000'),
    ('court_provider_deletion_handoffs', 'audit_model', 'text', false, NULL::text, '20260714100000'),
    ('court_provider_deletion_handoffs', 'provider_input_tokens', 'integer', false, NULL::text, '20260714100000'),
    ('court_provider_deletion_handoffs', 'provider_output_tokens', 'integer', false, NULL::text, '20260714100000'),
    ('court_provider_deletion_handoffs', 'provider_cached_input_tokens', 'integer', false, NULL::text, '20260714100000'),
    ('court_provider_deletion_handoffs', 'provider_cache_write_input_tokens', 'integer', false, NULL::text, '20260714100000'),
    ('court_provider_deletion_handoffs', 'audit_cost_usd', 'numeric(10,6)', false, NULL::text, '20260714100000'),
    ('court_provider_deletion_handoffs', 'paid_observed_at', 'timestamp with time zone', false, NULL::text, '20260714100000'),
    ('court_provider_deletion_handoffs', 'audit_pending_at', 'timestamp with time zone', false, NULL::text, '20260714100000'),
    ('court_provider_deletion_handoffs', 'audited_at', 'timestamp with time zone', false, NULL::text, '20260714100000'),
    ('court_provider_deletion_handoffs', 'resolved_at', 'timestamp with time zone', false, NULL::text, '20260714100000'),
    ('court_provider_deletion_handoffs', 'recovery_lease_token', 'uuid', false, NULL::text, '20260714100000'),
    ('court_provider_deletion_handoffs', 'recovery_lease_expires_at', 'timestamp with time zone', false, NULL::text, '20260714100000'),
    ('court_provider_deletion_handoffs', 'recovery_attempt_count', 'integer', true, '0', '20260714100000'),
    ('court_provider_deletion_handoffs', 'recovery_last_error_code', 'text', false, NULL::text, '20260714100000'),
    ('court_provider_deletion_handoffs', 'recovery_last_error_at', 'timestamp with time zone', false, NULL::text, '20260714100000'),
    ('court_provider_deletion_handoffs', 'created_at', 'timestamp with time zone', true, 'statement_timestamp()', '20260714100000'),
    ('court_provider_deletion_handoffs', 'expires_at', 'timestamp with time zone', true, '(statement_timestamp() + make_interval(days => 90))', '20260714100000'),
    ('court_provider_deletion_handoffs', 'provider_resolution_action', 'text', false, NULL::text, '20260714102000'),
    ('court_provider_deletion_handoffs', 'provider_resolution_at', 'timestamp with time zone', false, NULL::text, '20260714102000'),
    ('court_provider_deletion_handoffs', 'provider_reported_cost_usd', 'numeric(10,6)', false, NULL::text, '20260714102000'),
    ('court_provider_deletion_handoff_metrics', 'metric_day', 'date', true, NULL::text, '20260714102000'),
    ('court_provider_deletion_handoff_metrics', 'metric_code', 'text', true, NULL::text, '20260714102000'),
    ('court_provider_deletion_handoff_metrics', 'event_count', 'bigint', true, '0', '20260714102000'),
    ('court_provider_deletion_handoff_metrics', 'tokens_input', 'bigint', true, '0', '20260714102000'),
    ('court_provider_deletion_handoff_metrics', 'tokens_output', 'bigint', true, '0', '20260714102000'),
    ('court_provider_deletion_handoff_metrics', 'cost_usd', 'numeric', true, '0', '20260714102000'),
    ('court_provider_deletion_handoff_metrics', 'updated_at', 'timestamp with time zone', true, 'statement_timestamp()', '20260714102000'),
    ('court_provider_request_key_reveal_audits', 'id', 'uuid', true, 'gen_random_uuid()', '20260714103000'),
    ('court_provider_request_key_reveal_audits', 'target_scope', 'text', true, NULL::text, '20260714103000'),
    ('court_provider_request_key_reveal_audits', 'target_id', 'uuid', true, NULL::text, '20260714103000'),
    ('court_provider_request_key_reveal_audits', 'actor_admin_id', 'uuid', false, NULL::text, '20260714103000'),
    ('court_provider_request_key_reveal_audits', 'action', 'text', true, NULL::text, '20260714103000'),
    ('court_provider_request_key_reveal_audits', 'revealed_at', 'timestamp with time zone', true, 'statement_timestamp()', '20260714103000'),
    ('court_provider_request_key_reveal_audits', 'expires_at', 'timestamp with time zone', true, '(statement_timestamp() + make_interval(years => 1))', '20260714103000')
), court_provider_required_named_constraints(table_name, constraint_name, introduced_version) AS (
  VALUES
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_pkey', '20260714100000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_request_key_key', '20260714100000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_request_key_check', '20260714100000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_handoff_state_check', '20260714100000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_audit_model_check', '20260714100000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_provider_input_tokens_check', '20260714100000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_provider_output_tokens_check', '20260714100000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_provider_cached_input_tokens_c', '20260714100000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_provider_cache_write_input_tok', '20260714100000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_audit_cost_usd_check', '20260714100000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_recovery_attempt_count_check', '20260714100000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_recovery_last_error_code_check', '20260714100000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_usage_check', '20260714100000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_recovery_lease_check', '20260714100000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_recovery_error_check', '20260714100000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_lifecycle_check', '20260714100000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_retention_check', '20260714100000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_verdict_id_key', '20260714102000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_resolution_check', '20260714102000'),
    ('court_provider_deletion_handoff_metrics', 'court_provider_deletion_handoff_metrics_pkey', '20260714102000'),
    ('court_provider_deletion_handoff_metrics', 'court_provider_deletion_handoff_metrics_metric_code_check', '20260714102000'),
    ('court_provider_deletion_handoff_metrics', 'court_provider_deletion_handoff_metrics_event_count_check', '20260714102000'),
    ('court_provider_deletion_handoff_metrics', 'court_provider_deletion_handoff_metrics_tokens_input_check', '20260714102000'),
    ('court_provider_deletion_handoff_metrics', 'court_provider_deletion_handoff_metrics_tokens_output_check', '20260714102000'),
    ('court_provider_deletion_handoff_metrics', 'court_provider_deletion_handoff_metrics_cost_usd_check', '20260714102000'),
    ('court_provider_request_key_reveal_audits', 'court_provider_request_key_reveal_audits_pkey', '20260714103000'),
    ('court_provider_request_key_reveal_audits', 'court_provider_request_key_reveal_audits_target_scope_check', '20260714103000'),
    ('court_provider_request_key_reveal_audits', 'court_provider_request_key_reveal_audits_actor_admin_id_fkey', '20260714103000'),
    ('court_provider_request_key_reveal_audits', 'court_provider_request_key_reveal_audits_action_check', '20260714103000'),
    ('court_provider_request_key_reveal_audits', 'court_provider_request_key_reveal_audits_retention_check', '20260714103000')
), court_provider_required_constraint_fragments(
  table_name, constraint_name, normalized_fragment, minimum_occurrences,
  introduced_version
) AS (
  VALUES
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_lifecycle_check', 'audit_modelisnotnullandprovider_input_tokensisnotnullandprovider_output_tokensisnotnull', 2, '20260714100000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_resolution_check', 'audit_modelisnotnullandprovider_input_tokensisnotnullandprovider_output_tokensisnotnull', 1, '20260714102000')
), court_provider_required_named_indexes(table_name, index_name, introduced_version) AS (
  VALUES
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_recovery_idx', '20260714100000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_expiry_idx', '20260714100000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_pkey', '20260714100000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_request_key_key', '20260714100000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_verdict_id_key', '20260714102000'),
    ('court_provider_deletion_handoff_metrics', 'court_provider_deletion_handoff_metrics_pkey', '20260714102000'),
    ('court_provider_request_key_reveal_audits', 'court_provider_request_key_reveal_audits_pkey', '20260714103000'),
    ('court_provider_request_key_reveal_audits', 'court_provider_request_key_reveal_audits_target_idx', '20260714103000'),
    ('court_provider_request_key_reveal_audits', 'court_provider_request_key_reveal_audits_actor_idx', '20260714103000'),
    ('court_provider_request_key_reveal_audits', 'court_provider_request_key_reveal_audits_expiry_idx', '20260714103000')
), court_provider_required_table_stages(
  stage_name, table_name, max_version, expected_column_count,
  expected_constraint_count, expected_index_count, expected_policy_count,
  expected_service_select, expected_comment
) AS (
  VALUES
    ('handoff_1000', 'court_provider_deletion_handoffs', '20260714100000', 22, 17, 4, 0, false, 'Service-only, payload-free attempt handoff after a Court graph is deleted. No subject, case, input, request, verdict payload, mission, mode, category, tone, or safety-category data is retained.'),
    ('handoff_1020', 'court_provider_deletion_handoffs', '20260714102000', 25, 19, 5, 0, false, 'Service-only, payload-free attempt handoff after a Court graph is deleted. No subject, case, input, request, verdict payload, mission, mode, category, tone, or safety-category data is retained.'),
    ('handoff_1030', 'court_provider_deletion_handoffs', '20260714102000', 25, 19, 5, 0, false, 'Service-only, payload-free attempt handoff after a Court graph is deleted. No subject, case, input, request, verdict payload, mission, mode, category, tone, or safety-category data is retained.'),
    ('metrics_1020', 'court_provider_deletion_handoff_metrics', '20260714102000', 7, 6, 1, 0, true, 'Two-year aggregate-only deletion-handoff cleanup metrics. Contains no identifiers, request keys, model names, free text, or payloads.'),
    ('reveal_audit_1030', 'court_provider_request_key_reveal_audits', '20260714103000', 7, 5, 4, 1, true, 'Append-only one-year administrator audit of individual live or deleted-subject provider-key reveals. Contains an opaque target scope/id, administrator actor, action, and timestamps only; never a request key, subject, case, payload, model, usage, cost, or free-form text.')
), court_provider_table_stage_status AS (
  SELECT stage.stage_name, stage.table_name,
         table_row.oid IS NOT NULL AS present,
         CASE WHEN table_row.oid IS NULL THEN false ELSE
           table_row.relkind = 'r' AND table_row.relpersistence = 'p'
           AND table_row.relrowsecurity AND NOT table_row.relforcerowsecurity
           AND pg_get_userbyid(table_row.relowner) = 'postgres'
           AND obj_description(table_row.oid, 'pg_class') = stage.expected_comment
           AND (SELECT count(*) FROM pg_catalog.pg_attribute attribute_row WHERE attribute_row.attrelid = table_row.oid AND attribute_row.attnum > 0 AND NOT attribute_row.attisdropped) = stage.expected_column_count
           AND NOT EXISTS (
             SELECT 1 FROM court_provider_required_columns expected
             LEFT JOIN pg_catalog.pg_attribute attribute_row ON attribute_row.attrelid = table_row.oid AND attribute_row.attname = expected.column_name AND attribute_row.attnum > 0 AND NOT attribute_row.attisdropped
             LEFT JOIN pg_catalog.pg_attrdef default_row ON default_row.adrelid = attribute_row.attrelid AND default_row.adnum = attribute_row.attnum
             WHERE expected.table_name = stage.table_name AND expected.introduced_version <= stage.max_version
               AND (attribute_row.attname IS NULL OR format_type(attribute_row.atttypid, attribute_row.atttypmod) IS DISTINCT FROM expected.data_type OR attribute_row.attnotnull IS DISTINCT FROM expected.not_null OR attribute_row.attidentity <> '' OR attribute_row.attgenerated <> '' OR pg_get_expr(default_row.adbin, default_row.adrelid) IS DISTINCT FROM expected.expected_default)
           )
           AND (SELECT count(*) FROM pg_catalog.pg_constraint constraint_row WHERE constraint_row.conrelid = table_row.oid) = stage.expected_constraint_count
           AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint constraint_row WHERE constraint_row.conrelid = table_row.oid AND NOT constraint_row.convalidated)
           AND NOT EXISTS (
             SELECT 1 FROM court_provider_required_named_constraints expected
             LEFT JOIN pg_catalog.pg_constraint constraint_row ON constraint_row.conrelid = table_row.oid AND constraint_row.conname = expected.constraint_name
             WHERE expected.table_name = stage.table_name AND expected.introduced_version <= stage.max_version AND constraint_row.oid IS NULL
           )
           AND NOT EXISTS (
             SELECT 1 FROM court_provider_required_constraint_fragments expected
             LEFT JOIN pg_catalog.pg_constraint constraint_row ON constraint_row.conrelid = table_row.oid AND constraint_row.conname = expected.constraint_name
             CROSS JOIN LATERAL (SELECT regexp_replace(lower(coalesce(pg_get_constraintdef(constraint_row.oid, true), '')), '[[:space:]()"]+', '', 'g') AS definition) normalized
             WHERE expected.table_name = stage.table_name
               AND expected.introduced_version <= stage.max_version
               AND (constraint_row.oid IS NULL OR (length(normalized.definition) - length(replace(normalized.definition, expected.normalized_fragment, ''))) / length(expected.normalized_fragment) < expected.minimum_occurrences)
           )
           AND (SELECT count(*) FROM pg_catalog.pg_index index_row WHERE index_row.indrelid = table_row.oid) = stage.expected_index_count
           AND NOT EXISTS (
             SELECT 1 FROM court_provider_required_named_indexes expected
             LEFT JOIN pg_catalog.pg_class index_class ON index_class.relnamespace = 'public'::regnamespace AND index_class.relname = expected.index_name
             LEFT JOIN pg_catalog.pg_index index_row ON index_row.indexrelid = index_class.oid AND index_row.indrelid = table_row.oid
             WHERE expected.table_name = stage.table_name AND expected.introduced_version <= stage.max_version AND (index_row.indexrelid IS NULL OR NOT index_row.indisvalid OR NOT index_row.indisready)
           )
           AND (SELECT count(*) FROM pg_catalog.pg_policies policy_row WHERE policy_row.schemaname = 'public' AND policy_row.tablename = stage.table_name) = stage.expected_policy_count
           AND (stage.table_name <> 'court_provider_request_key_reveal_audits' OR EXISTS (
             SELECT 1 FROM pg_catalog.pg_policies policy_row WHERE policy_row.schemaname = 'public' AND policy_row.tablename = stage.table_name AND policy_row.policyname = 'court_provider_request_key_reveal_audits_service_select' AND policy_row.permissive = 'PERMISSIVE' AND policy_row.roles = ARRAY['service_role'::name] AND policy_row.cmd = 'SELECT' AND policy_row.qual = 'true' AND policy_row.with_check IS NULL
           ))
           AND has_table_privilege('service_role', table_row.oid, 'SELECT') = stage.expected_service_select
           AND has_any_column_privilege('service_role', table_row.oid, 'SELECT') = stage.expected_service_select
           AND NOT has_table_privilege('service_role', table_row.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
           AND NOT has_any_column_privilege('service_role', table_row.oid, 'INSERT,UPDATE,REFERENCES')
           AND NOT has_table_privilege('anon', table_row.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
           AND NOT has_table_privilege('authenticated', table_row.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
           AND NOT has_any_column_privilege('anon', table_row.oid, 'SELECT,INSERT,UPDATE,REFERENCES')
           AND NOT has_any_column_privilege('authenticated', table_row.oid, 'SELECT,INSERT,UPDATE,REFERENCES')
         END AS exact
  FROM court_provider_required_table_stages stage
  LEFT JOIN pg_catalog.pg_class table_row
    ON table_row.oid = to_regclass('public.' || stage.table_name)
), wedding_code_collection_retirement_inventory AS (
  SELECT
    table_row.oid IS NOT NULL AS table_present,
    table_row.oid IS NOT NULL
      AND table_row.relkind = 'r'
      AND table_row.relpersistence = 'p'
      AND table_row.relrowsecurity
      AND NOT table_row.relforcerowsecurity
      AND pg_get_userbyid(table_row.relowner) = 'postgres'
      AND obj_description(table_row.oid, 'pg_class') =
        'Retired WeddingCode collection. Historical rows are preserved; any deletion requires a separate approved retention/purge migration.'
      AS table_contract_exact,
    table_row.oid IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'anon', 'authenticated', 'service_role'
      ]::text[]) AS application_role(role_name)
      CROSS JOIN unnest(ARRAY[
        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
        'REFERENCES', 'TRIGGER'
      ]::text[]) AS table_privilege(privilege_name)
      WHERE has_table_privilege(
        application_role.role_name,
        table_row.oid,
        table_privilege.privilege_name
      )
    ) AS table_acl_closed,
    table_row.oid IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'anon', 'authenticated', 'service_role'
      ]::text[]) AS application_role(role_name)
      CROSS JOIN unnest(ARRAY[
        'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'
      ]::text[]) AS column_privilege(privilege_name)
      WHERE has_any_column_privilege(
        application_role.role_name,
        table_row.oid,
        column_privilege.privilege_name
      )
    ) AS column_acl_closed,
    (SELECT count(*)
     FROM pg_catalog.pg_policy policy_row
     WHERE policy_row.polrelid = table_row.oid) AS policy_count,
    EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint constraint_row
      WHERE constraint_row.conrelid = table_row.oid
        AND constraint_row.conname = 'wedding_code_collection_retired'
    ) AS constraint_present,
    EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint constraint_row
      WHERE constraint_row.conrelid = table_row.oid
        AND constraint_row.conname = 'wedding_code_collection_retired'
        AND constraint_row.contype = 'c'
        AND NOT constraint_row.convalidated
        AND NOT constraint_row.condeferrable
        AND NOT constraint_row.condeferred
        AND NOT constraint_row.connoinherit
        AND constraint_row.conislocal
        AND constraint_row.coninhcount = 0
        AND pg_get_expr(
          constraint_row.conbin, constraint_row.conrelid, true
        ) IN ('false', '(false)')
        AND pg_get_constraintdef(constraint_row.oid, true) =
          'CHECK (false) NOT VALID'
        AND obj_description(constraint_row.oid, 'pg_constraint') =
          'Retirement fence: rejects every INSERT and UPDATE without scanning preserved historical rows. DELETE requires a separate approved purge migration.'
    ) AS constraint_exact,
    (SELECT count(*)
     FROM pg_catalog.pg_proc procedure_row
     JOIN pg_catalog.pg_namespace namespace_row
       ON namespace_row.oid = procedure_row.pronamespace
     WHERE namespace_row.nspname = 'public'
       AND procedure_row.proname = 'insert_wedding_code_response')
      AS insert_rpc_overload_count,
    (SELECT count(*)
     FROM pg_catalog.pg_proc procedure_row
     JOIN pg_catalog.pg_namespace namespace_row
       ON namespace_row.oid = procedure_row.pronamespace
     WHERE namespace_row.nspname = 'public'
       AND procedure_row.proname = 'pair_wedding_code_response')
      AS pair_rpc_overload_count
  FROM (SELECT
    to_regclass('public.wedding_code_responses') AS table_oid
  ) object_ids
  LEFT JOIN pg_catalog.pg_class table_row
    ON table_row.oid = object_ids.table_oid
), wedding_code_collection_retirement_modes AS (
  SELECT inventory.*,
         NOT inventory.table_present
           AND inventory.insert_rpc_overload_count = 0
           AND inventory.pair_rpc_overload_count = 0 AS absent_exact,
         inventory.table_contract_exact
           AND inventory.table_acl_closed
           AND inventory.column_acl_closed
           AND inventory.policy_count = 0
           AND inventory.constraint_exact
           AND inventory.insert_rpc_overload_count = 0
           AND inventory.pair_rpc_overload_count = 0 AS retired_exact
  FROM wedding_code_collection_retirement_inventory inventory
), wedding_code_collection_retirement_status AS (
  SELECT mode_row.*,
         CASE
           WHEN mode_row.absent_exact THEN 'absent'
           WHEN mode_row.retired_exact THEN 'retired'
           ELSE 'unsafe'
         END AS boundary_mode,
         mode_row.absent_exact OR mode_row.retired_exact AS exact
  FROM wedding_code_collection_retirement_modes mode_row
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
    ('account_deletion_jobs', 'auth_delete_ready_until', 'timestamp with time zone', false),
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
), amora_reset_read_helper_status AS (
  SELECT 'public.can_read_amora_couple_data(uuid,text)'::text AS signature,
         procedure_row.oid IS NOT NULL AS present,
         CASE WHEN procedure_row.oid IS NULL THEN NULL ELSE
           pg_get_userbyid(procedure_row.proowner)
         END AS actual_owner,
         CASE WHEN procedure_row.oid IS NULL THEN NULL ELSE
           pg_get_function_result(procedure_row.oid)
         END AS actual_result,
         procedure_row.prosecdef AS actual_security_definer,
         procedure_row.provolatile AS actual_volatility,
         procedure_row.proconfig AS actual_config,
         CASE WHEN procedure_row.oid IS NULL THEN NULL ELSE
           md5(replace(procedure_row.prosrc, chr(13), ''))
         END AS actual_source_md5,
         procedure_row.oid IS NOT NULL
           AND procedure_row.prokind = 'f'
           AND language_row.lanname = 'sql'
           AND pg_get_function_result(procedure_row.oid) = 'boolean'
           AND procedure_row.prosecdef
           AND procedure_row.provolatile = 's'
           AND pg_get_userbyid(procedure_row.proowner) = 'postgres'
           AND procedure_row.proconfig @> ARRAY[
             'search_path=pg_catalog, pg_temp',
             'row_security=off'
           ]::text[]
           AND cardinality(procedure_row.proconfig) = 2
           AND md5(replace(procedure_row.prosrc, chr(13), '')) =
             '668077b0545119cc3af092bbf4cb98ae'
           AND has_function_privilege(
             'authenticated', procedure_row.oid, 'EXECUTE'
           )
           AND NOT has_function_privilege('anon', procedure_row.oid, 'EXECUTE')
           AND NOT has_function_privilege(
             'service_role', procedure_row.oid, 'EXECUTE'
           ) AS exact
  FROM (SELECT to_regprocedure(
    'public.can_read_amora_couple_data(uuid,text)'
  ) AS oid) AS target
  LEFT JOIN pg_catalog.pg_proc AS procedure_row
    ON procedure_row.oid = target.oid
  LEFT JOIN pg_catalog.pg_language AS language_row
    ON language_row.oid = procedure_row.prolang
), required_amora_reset_read_policies(table_name, policy_name) AS (
  VALUES
    ('amora_couple_profiles', 'amora_couple_profiles_select_with_privacy'),
    ('chat_messages', 'chat_select_with_privacy'),
    ('chat_summaries', 'chat_summaries_select_with_privacy'),
    ('decision_nodes', 'decision_nodes_select_with_privacy')
), amora_reset_read_policy_status AS (
  SELECT required.table_name,
         required.policy_name,
         policy_row.policyname IS NOT NULL AS present,
         policy_row.permissive AS actual_permissive,
         policy_row.roles AS actual_roles,
         policy_row.cmd AS actual_cmd,
         policy_row.qual AS actual_qual,
         policy_row.with_check AS actual_with_check,
         table_row.relrowsecurity AS rls_enabled,
         (
           SELECT count(*)
           FROM pg_catalog.pg_policies AS client_policy
           WHERE client_policy.schemaname = 'public'
             AND client_policy.tablename = required.table_name
             AND client_policy.cmd IN ('SELECT', 'ALL')
             AND EXISTS (
               SELECT 1
               FROM unnest(client_policy.roles) AS policy_role(role_name)
               WHERE CASE
                 WHEN policy_role.role_name = 'public'::name THEN true
                 ELSE pg_has_role(
                   'authenticated', policy_role.role_name, 'MEMBER'
                 )
               END
             )
         ) AS client_read_policy_count,
         table_row.oid IS NOT NULL
           AND policy_row.policyname IS NOT NULL
           AND table_row.relkind = 'r'
           AND table_row.relrowsecurity
           AND policy_row.permissive = 'PERMISSIVE'
           AND policy_row.roles = ARRAY['authenticated'::name]
           AND policy_row.cmd = 'SELECT'
           AND policy_row.with_check IS NULL
           AND has_table_privilege(
             'authenticated', format('public.%I', required.table_name), 'SELECT'
           )
           AND NOT has_table_privilege(
             'anon', format('public.%I', required.table_name), 'SELECT'
           )
           AND coalesce((
             SELECT exact FROM amora_reset_read_helper_status
           ), false)
           AND replace(replace(replace(
             regexp_replace(coalesce(policy_row.qual, ''), '[[:space:]]+', '', 'g'),
             '"', ''
           ), '(', ''), ')', '') ~ (
             '^(public\.)?can_read_amora_couple_data'
             || '((public\.)?' || required.table_name || '\.)?couple_id,'
             || '((public\.)?' || required.table_name || '\.)?visibility::text$'
           )
           AND 1 = (
             SELECT count(*)
             FROM pg_catalog.pg_policies AS client_policy
             WHERE client_policy.schemaname = 'public'
               AND client_policy.tablename = required.table_name
               AND client_policy.cmd IN ('SELECT', 'ALL')
               AND EXISTS (
                 SELECT 1
                 FROM unnest(client_policy.roles) AS policy_role(role_name)
                 WHERE CASE
                   WHEN policy_role.role_name = 'public'::name THEN true
                   ELSE pg_has_role(
                     'authenticated', policy_role.role_name, 'MEMBER'
                   )
                 END
               )
           ) AS exact
  FROM required_amora_reset_read_policies AS required
  LEFT JOIN pg_catalog.pg_class AS table_row
    ON table_row.oid = to_regclass('public.' || required.table_name)
   AND table_row.relkind = 'r'
  LEFT JOIN pg_catalog.pg_policies AS policy_row
    ON policy_row.schemaname = 'public'
   AND policy_row.tablename = required.table_name
   AND policy_row.policyname = required.policy_name
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
  ) AND 3 = (
    SELECT count(*)
    FROM pg_attribute attribute_row
    LEFT JOIN pg_attrdef default_row
      ON default_row.adrelid = attribute_row.attrelid
     AND default_row.adnum = attribute_row.attnum
    WHERE attribute_row.attrelid = to_regclass('public.account_deletion_jobs')
      AND attribute_row.attname IN (
        'email_scopes', 'email_snapshot_at', 'auth_delete_ready_until'
      )
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
    ('storage', 'objects', 'trg_guard_user_media_storage_write', 'public.guard_user_media_storage_write()', 'CREATE TRIGGER trg_guard_user_media_storage_write BEFORE INSERT OR UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION guard_user_media_storage_write()'),
    ('storage', 'objects', 'trg_block_storage_owner_write_during_account_deletion', 'public.block_storage_owner_write_during_account_deletion()', 'CREATE TRIGGER trg_block_storage_owner_write_during_account_deletion BEFORE INSERT OR UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION block_storage_owner_write_during_account_deletion()'),
    ('auth', 'users', 'trg_block_auth_user_delete_until_account_cleanup_ready', 'public.block_auth_user_delete_until_account_cleanup_ready()', 'CREATE TRIGGER trg_block_auth_user_delete_until_account_cleanup_ready BEFORE DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION block_auth_user_delete_until_account_cleanup_ready()')
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
), privacy_required_constraints(
  table_name, constraint_name, expected_definition
) AS (
  VALUES
    ('cohort_contracts', 'cohort_contracts_base_price_range',
      'CHECK (base_price IS NULL OR base_price >= 1 AND base_price <= 1000000)'),
    ('cohort_contracts', 'cohort_contracts_extra_price_range',
      'CHECK (extra_price IS NULL OR extra_price >= 0 AND extra_price <= 1000000)'),
    ('cohort_contracts', 'cohort_contracts_vendor_name_length',
      'CHECK (vendor_name = btrim(vendor_name) AND char_length(vendor_name) >= 1 AND char_length(vendor_name) <= 200)'),
    ('cohort_contracts', 'cohort_contracts_notes_length',
      'CHECK (notes IS NULL OR char_length(notes) <= 1000)'),
    ('customer_survey_responses', 'customer_survey_q23_contact_is_null',
      'CHECK (q23_contact IS NULL)'),
    ('customer_survey_responses', 'customer_survey_user_agent_is_null',
      'CHECK (user_agent IS NULL)')
), privacy_constraint_status AS (
  SELECT required.table_name,
         required.constraint_name,
         constraint_row.oid IS NOT NULL
           AND constraint_row.contype = 'c'
           AND constraint_row.convalidated
           AND pg_get_constraintdef(constraint_row.oid, true) =
             required.expected_definition AS exact
  FROM privacy_required_constraints required
  LEFT JOIN pg_catalog.pg_constraint constraint_row
    ON constraint_row.conrelid = to_regclass('public.' || required.table_name)
   AND constraint_row.conname = required.constraint_name
), privacy_required_policies(
  table_name, policy_name, expected_roles, expected_command,
  expected_qual, expected_with_check
) AS (
  VALUES
    ('cohort_contracts', 'cohort_contracts_select_own',
      ARRAY['authenticated'::name], 'SELECT', 'user_id=auth.uid', NULL::text),
    ('cohort_contracts', 'cohort_contracts_insert_active_member',
      ARRAY['authenticated'::name], 'INSERT', NULL::text,
      'user_id=auth.uidandis_cohort_memberroom_id'),
    ('cohort_contracts', 'cohort_contracts_update_active_member',
      ARRAY['authenticated'::name], 'UPDATE',
      'user_id=auth.uidandis_cohort_memberroom_id',
      'user_id=auth.uidandis_cohort_memberroom_id'),
    ('cohort_contracts', 'cohort_contracts_delete_own',
      ARRAY['authenticated'::name], 'DELETE', 'user_id=auth.uid', NULL::text),
    ('community_profiles', 'community_profiles_select_public_card',
      ARRAY['anon'::name, 'authenticated'::name], 'SELECT', 'true', NULL::text),
    ('community_achievements', 'community_achievements_select_own',
      ARRAY['authenticated'::name], 'SELECT', 'user_id=auth.uid', NULL::text)
), privacy_policy_status AS (
  SELECT required.table_name,
         required.policy_name,
         policy_row.policyname IS NOT NULL
           AND policy_row.permissive = 'PERMISSIVE'
           AND policy_row.roles @> required.expected_roles
           AND policy_row.roles <@ required.expected_roles
           AND cardinality(policy_row.roles) = cardinality(required.expected_roles)
           AND policy_row.cmd = required.expected_command
           AND replace(regexp_replace(
             lower(coalesce(policy_row.qual, '')),
             '[[:space:]()"]+', '', 'g'
           ), 'public.', '') IS NOT DISTINCT FROM
             coalesce(required.expected_qual, '')
           AND replace(regexp_replace(
             lower(coalesce(policy_row.with_check, '')),
             '[[:space:]()"]+', '', 'g'
           ), 'public.', '') IS NOT DISTINCT FROM
             coalesce(required.expected_with_check, '') AS exact
  FROM privacy_required_policies required
  LEFT JOIN pg_catalog.pg_policies policy_row
    ON policy_row.schemaname = 'public'
   AND policy_row.tablename = required.table_name
   AND policy_row.policyname = required.policy_name
),
-- PROVISIONAL_ACTIVE_ADMIN_POLICY_CANONICAL: the legacy strings below were
-- captured read-only from the linked production catalog. The active strings
-- are the reviewed PostgreSQL 15 deparse expected from migration
-- 20260713110100, but must be captured from an applied disposable database
-- before the protected-production hard stop in supabase-ship-safe is removed.
active_admin_policy_expressions AS (
  SELECT
    'existsselect1fromprofileswhereprofiles.id=auth.uidandprofiles.is_admin=true'::text
      AS legacy_admin,
    'existsselect1fromprofileswhereprofiles.id=auth.uidandprofiles.is_admin=trueorauth.role=''service_role''::text'::text
      AS legacy_admin_service,
    'existsselect1fromprofilesprofilewhereprofile.id=selectauth.uidasuidandprofile.is_admin=trueandprofile.account_deleting_atisnull'::text
      AS active_admin,
    'selectauth.roleasrole=''service_role''::textorexistsselect1fromprofilesprofilewhereprofile.id=selectauth.uidasuidandprofile.is_admin=trueandprofile.account_deleting_atisnull'::text
      AS active_admin_service
), required_active_admin_policies(
  table_name, policy_name, expected_command, qual_kind,
  legacy_with_check, active_with_check
) AS (
  VALUES
    ('settlements', '관리자: 전체 정산 관리', 'ALL', 'admin', false, true),
    ('vendor_leads', 'vendor_leads_admin_all', 'ALL', 'admin_service', true, true),
    ('amora_quote_checks', 'amora_quote_checks_admin_select', 'SELECT', 'admin', false, false),
    ('community_agent_personas', 'community_agent_personas_admin_select', 'SELECT', 'admin', false, false),
    ('community_agent_personas', 'community_agent_personas_admin_write', 'ALL', 'admin', true, true),
    ('community_agent_content_drafts', 'community_agent_drafts_admin_select', 'SELECT', 'admin', false, false),
    ('community_agent_content_drafts', 'community_agent_drafts_admin_write', 'ALL', 'admin', true, true),
    ('community_agent_activity_log', 'community_agent_activity_admin_select', 'SELECT', 'admin', false, false),
    ('community_agent_activity_log', 'community_agent_activity_admin_write', 'ALL', 'admin', true, true),
    ('community_agent_daily_state', 'community_agent_daily_state_admin_select', 'SELECT', 'admin', false, false),
    ('community_agent_daily_state', 'community_agent_daily_state_admin_write', 'ALL', 'admin', true, true),
    ('community_agent_automation_runs', 'community_agent_automation_runs_admin_select', 'SELECT', 'admin', false, false),
    ('community_agent_automation_runs', 'community_agent_automation_runs_admin_write', 'ALL', 'admin', true, true)
), required_active_admin_table_policy_allowlist(table_name, policy_name) AS (
  VALUES
    ('settlements', '관리자: 전체 정산 관리'),
    ('settlements', '서비스: 전체 관리'),
    ('settlements', '업체: 본인 정산 조회'),
    ('vendor_leads', 'vendor_leads_admin_all'),
    ('amora_quote_checks', 'amora_quote_checks_admin_select'),
    ('amora_quote_checks', 'amora_quote_checks_owner_select'),
    ('amora_quote_checks', 'amora_quote_checks_service_all'),
    ('community_agent_personas', 'community_agent_personas_admin_select'),
    ('community_agent_personas', 'community_agent_personas_admin_write'),
    ('community_agent_content_drafts', 'community_agent_drafts_admin_select'),
    ('community_agent_content_drafts', 'community_agent_drafts_admin_write'),
    ('community_agent_activity_log', 'community_agent_activity_admin_select'),
    ('community_agent_activity_log', 'community_agent_activity_admin_write'),
    ('community_agent_daily_state', 'community_agent_daily_state_admin_select'),
    ('community_agent_daily_state', 'community_agent_daily_state_admin_write'),
    ('community_agent_automation_runs', 'community_agent_automation_runs_admin_select'),
    ('community_agent_automation_runs', 'community_agent_automation_runs_admin_write')
), active_admin_policy_allowlist_inventory AS (
  SELECT
    (SELECT count(*) FROM required_active_admin_table_policy_allowlist)
      AS expected_count,
    (
      SELECT count(*)
      FROM pg_catalog.pg_policies policy_row
      WHERE policy_row.schemaname = 'public'
        AND EXISTS (
          SELECT 1
          FROM required_active_admin_table_policy_allowlist required_table
          WHERE required_table.table_name = policy_row.tablename
        )
    ) AS actual_count,
    (
      SELECT count(*)
      FROM required_active_admin_table_policy_allowlist required
      LEFT JOIN pg_catalog.pg_policies policy_row
        ON policy_row.schemaname = 'public'
       AND policy_row.tablename = required.table_name
       AND policy_row.policyname = required.policy_name
      WHERE policy_row.policyname IS NULL
    ) AS missing_count,
    (
      SELECT count(*)
      FROM pg_catalog.pg_policies policy_row
      WHERE policy_row.schemaname = 'public'
        AND EXISTS (
          SELECT 1
          FROM required_active_admin_table_policy_allowlist required_table
          WHERE required_table.table_name = policy_row.tablename
        )
        AND NOT EXISTS (
          SELECT 1
          FROM required_active_admin_table_policy_allowlist required
          WHERE required.table_name = policy_row.tablename
            AND required.policy_name = policy_row.policyname
        )
    ) AS unexpected_count
), active_admin_policy_allowlist_status AS (
  SELECT inventory.*,
         inventory.expected_count = 17
           AND inventory.actual_count = 17
           AND inventory.missing_count = 0
           AND inventory.unexpected_count = 0 AS exact
  FROM active_admin_policy_allowlist_inventory inventory
), active_admin_policy_status AS (
  SELECT required.table_name,
         required.policy_name,
         policy_row.policyname IS NOT NULL AS present,
         table_row.oid IS NOT NULL
           AND table_row.relkind = 'r'
           AND table_row.relrowsecurity
           AND policy_row.policyname IS NOT NULL
           AND policy_row.permissive = 'PERMISSIVE'
           AND policy_row.roles = ARRAY['public'::name]
           AND policy_row.cmd = required.expected_command
           AND (
             (
               normalized.qual = CASE required.qual_kind
                 WHEN 'admin_service' THEN expressions.legacy_admin_service
                 ELSE expressions.legacy_admin
               END
               AND CASE required.legacy_with_check
                 WHEN true THEN normalized.with_check = CASE required.qual_kind
                   WHEN 'admin_service' THEN expressions.legacy_admin_service
                   ELSE expressions.legacy_admin
                 END
                 ELSE policy_row.with_check IS NULL
               END
             )
             OR (
               normalized.qual = CASE required.qual_kind
                 WHEN 'admin_service' THEN expressions.active_admin_service
                 ELSE expressions.active_admin
               END
               AND CASE required.active_with_check
                 WHEN true THEN normalized.with_check = CASE required.qual_kind
                   WHEN 'admin_service' THEN expressions.active_admin_service
                   ELSE expressions.active_admin
                 END
                 ELSE policy_row.with_check IS NULL
               END
             )
           ) AS existing_replaceable,
         table_row.oid IS NOT NULL
           AND table_row.relkind = 'r'
           AND table_row.relrowsecurity
           AND policy_row.policyname IS NOT NULL
           AND policy_row.permissive = 'PERMISSIVE'
           AND policy_row.roles = ARRAY['public'::name]
           AND policy_row.cmd = required.expected_command
           AND normalized.qual = CASE required.qual_kind
             WHEN 'admin_service' THEN expressions.active_admin_service
             ELSE expressions.active_admin
           END
           AND CASE required.active_with_check
             WHEN true THEN normalized.with_check = CASE required.qual_kind
               WHEN 'admin_service' THEN expressions.active_admin_service
               ELSE expressions.active_admin
             END
             ELSE policy_row.with_check IS NULL
           END AS exact
  FROM required_active_admin_policies required
  CROSS JOIN active_admin_policy_expressions expressions
  LEFT JOIN pg_catalog.pg_class table_row
    ON table_row.oid = to_regclass('public.' || required.table_name)
  LEFT JOIN pg_catalog.pg_policies policy_row
    ON policy_row.schemaname = 'public'
   AND policy_row.tablename = required.table_name
   AND policy_row.policyname = required.policy_name
  CROSS JOIN LATERAL (
    SELECT
      replace(regexp_replace(
        lower(coalesce(policy_row.qual, '')),
        '[[:space:]()"]+', '', 'g'
      ), 'public.', '') AS qual,
      replace(regexp_replace(
        lower(coalesce(policy_row.with_check, '')),
        '[[:space:]()"]+', '', 'g'
      ), 'public.', '') AS with_check
  ) normalized
), active_admin_policy_contract AS (
  SELECT count(*) = 13
           AND coalesce(bool_and(status.existing_replaceable), false)
           AND coalesce((
             SELECT exact FROM active_admin_policy_allowlist_status
           ), false) AS replacement_safe,
         count(*) = 13
           AND coalesce(bool_and(status.exact), false)
           AND coalesce((
             SELECT exact FROM active_admin_policy_allowlist_status
           ), false) AS exact
  FROM active_admin_policy_status status
), privacy_required_functions(
  signature, expected_result, expected_security_definer,
  expected_volatility, expected_config, expected_source_md5,
  expected_authenticated_execute
) AS (
  VALUES
    ('public.enforce_cohort_contract_server_fields()', 'trigger', false, 'v'::"char",
      ARRAY['search_path=pg_catalog, pg_temp']::text[],
      'c9b67618721a1503d4b5cde6ea80b49c', false),
    ('public.get_my_community_activity_stats()',
      'TABLE(post_count integer, comment_count integer, total_upvotes_received integer)',
      true, 's'::"char",
      ARRAY['search_path=pg_catalog, pg_temp', 'row_security=off']::text[],
      '24ea2a1c3be0546fc47e0a1e97af5c99', true),
    ('public.redact_customer_survey_identifiers()', 'trigger', false, 'v'::"char",
      ARRAY['search_path=pg_catalog, pg_temp']::text[],
      'e0861e3c38e6df56c87deafd2c799a19', false)
), privacy_function_status AS (
  SELECT required.signature,
         procedure_row.oid IS NOT NULL
           AND pg_get_function_result(procedure_row.oid) = required.expected_result
           AND procedure_row.prosecdef = required.expected_security_definer
           AND procedure_row.provolatile = required.expected_volatility
           AND procedure_row.prokind = 'f'
           AND pg_get_userbyid(procedure_row.proowner) = 'postgres'
           AND coalesce(cardinality(procedure_row.proconfig), 0) =
             cardinality(required.expected_config)
           AND coalesce(
             procedure_row.proconfig @> required.expected_config,
             false
           )
           AND md5(replace(procedure_row.prosrc, chr(13), '')) =
             required.expected_source_md5
           AND NOT has_function_privilege('anon', procedure_row.oid, 'EXECUTE')
           AND has_function_privilege(
             'authenticated', procedure_row.oid, 'EXECUTE'
           ) = required.expected_authenticated_execute
           AND NOT has_function_privilege(
             'service_role', procedure_row.oid, 'EXECUTE'
           ) AS exact
  FROM privacy_required_functions required
  LEFT JOIN pg_catalog.pg_proc procedure_row
    ON procedure_row.oid = to_regprocedure(required.signature)
), privacy_required_triggers(
  table_name, trigger_name, function_signature
) AS (
  VALUES
    ('cohort_contracts', 'cohort_contracts_enforce_server_fields',
      'public.enforce_cohort_contract_server_fields()'),
    ('customer_survey_responses', 'customer_survey_identifiers_are_redacted',
      'public.redact_customer_survey_identifiers()')
), privacy_trigger_status AS (
  SELECT required.table_name,
         required.trigger_name,
         trigger_row.oid IS NOT NULL
           AND trigger_row.tgenabled = 'O'
           AND trigger_row.tgtype = 23
           AND octet_length(trigger_row.tgargs) = 0
           AND trigger_row.tgfoid =
             to_regprocedure(required.function_signature) AS exact
  FROM privacy_required_triggers required
  LEFT JOIN pg_catalog.pg_trigger trigger_row
    ON trigger_row.tgrelid = to_regclass('public.' || required.table_name)
   AND trigger_row.tgname = required.trigger_name
   AND NOT trigger_row.tgisinternal
), privacy_required_view_columns(
  view_name, ordinal_position, column_name, expected_type
) AS (
  VALUES
    ('cohort_stats', 1, 'room_id', 'uuid'),
    ('cohort_stats', 2, 'category', 'text'),
    ('cohort_stats', 3, 'sample_size', 'bigint'),
    ('cohort_stats', 4, 'avg_base_price', 'integer'),
    ('cohort_stats', 5, 'avg_extra_price', 'integer'),
    ('cohort_stats', 6, 'avg_total', 'integer'),
    ('cohort_room_contributor_stats', 1, 'room_id', 'uuid'),
    ('cohort_room_contributor_stats', 2, 'contributor_count', 'bigint'),
    ('cohort_room_contributor_stats', 3, 'threshold_met', 'boolean')
), privacy_view_status AS (
  SELECT required_view.view_name,
         view_row.oid IS NOT NULL
           AND view_row.relkind = 'v'
           AND view_row.reloptions = ARRAY['security_invoker=true']::text[]
           AND pg_get_userbyid(view_row.relowner) = 'postgres'
           AND has_table_privilege(
             'service_role', view_row.oid, 'SELECT'
           )
           AND NOT has_table_privilege(
             'service_role', view_row.oid, 'INSERT'
           )
           AND NOT has_table_privilege(
             'service_role', view_row.oid, 'UPDATE'
           )
           AND NOT has_table_privilege(
             'service_role', view_row.oid, 'DELETE'
           )
           AND NOT has_table_privilege(
             'service_role', view_row.oid, 'TRUNCATE'
           )
           AND NOT has_table_privilege(
             'service_role', view_row.oid, 'REFERENCES'
           )
           AND NOT has_table_privilege(
             'service_role', view_row.oid, 'TRIGGER'
           )
           AND NOT has_any_column_privilege(
             'anon', view_row.oid, 'SELECT'
           )
           AND NOT has_any_column_privilege(
             'authenticated', view_row.oid, 'SELECT'
           )
           AND NOT EXISTS (
             SELECT 1
             FROM privacy_required_view_columns expected
             LEFT JOIN pg_catalog.pg_attribute attribute_row
               ON attribute_row.attrelid = view_row.oid
              AND attribute_row.attnum = expected.ordinal_position
              AND attribute_row.attname = expected.column_name
              AND pg_catalog.format_type(
                attribute_row.atttypid, attribute_row.atttypmod
              ) = expected.expected_type
              AND NOT attribute_row.attisdropped
             WHERE expected.view_name = required_view.view_name
               AND attribute_row.attrelid IS NULL
           )
           AND (
             SELECT count(*)
             FROM pg_catalog.pg_attribute attribute_row
             WHERE attribute_row.attrelid = view_row.oid
               AND attribute_row.attnum > 0
               AND NOT attribute_row.attisdropped
           ) = required_view.expected_column_count
           AND CASE required_view.view_name
             WHEN 'cohort_stats' THEN
               strpos(required_view.normalized_definition,
                 'distinctoncontract.room_id,contract.category,contract.user_id') > 0
               AND required_view.normalized_definition ~
                 'casewhencount\*>=5thencount\*(elsenull::bigint)?endassample_size'
               AND required_view.normalized_definition ~
                 'casewhencount\*>=5thenroundavglatest\.base_price::integer(elsenull::integer)?endasavg_base_price'
               AND required_view.normalized_definition ~
                 'casewhencountlatest\.extra_price>=5andcountlatest\.extra_price=count\*thenroundavglatest\.extra_price::integer(elsenull::integer)?endasavg_extra_price'
               AND required_view.normalized_definition ~
                 'casewhencountlatest\.extra_price>=5andcountlatest\.extra_price=count\*thenroundavglatest\.base_price\+latest\.extra_pricefilterwherelatest\.extra_priceisnotnull::integer(elsenull::integer)?endasavg_total'
               AND strpos(required_view.normalized_definition,
                 'contract.base_price>=1') > 0
               AND strpos(required_view.normalized_definition,
                 'contract.base_price<=1000000') > 0
               AND strpos(required_view.normalized_definition,
                 'contract.extra_priceisnull') > 0
               AND strpos(required_view.normalized_definition,
                 'contract.extra_price>=0') > 0
               AND strpos(required_view.normalized_definition,
                 'contract.extra_price<=1000000') > 0
               AND strpos(required_view.normalized_definition,
                 'orderbycontract.room_id,contract.category,contract.user_id,contract.created_atdescnullslast,contract.iddesc') > 0
             WHEN 'cohort_room_contributor_stats' THEN
               strpos(required_view.normalized_definition,
                 'selectdistinctcontract.room_id,contract.user_id') > 0
               AND required_view.normalized_definition ~
                 'casewhencount\*>=5thencount\*(elsenull::bigint)?endascontributor_count'
               AND required_view.normalized_definition ~
                 'count\*>=5asthreshold_met'
               AND strpos(required_view.normalized_definition,
                 'contract.base_price>=1') > 0
               AND strpos(required_view.normalized_definition,
                 'contract.base_price<=1000000') > 0
               AND strpos(required_view.normalized_definition,
                 'contract.extra_priceisnull') > 0
               AND strpos(required_view.normalized_definition,
                 'contract.extra_price>=0') > 0
               AND strpos(required_view.normalized_definition,
                 'contract.extra_price<=1000000') > 0
             ELSE false
           END AS exact
  FROM (
    SELECT expected.view_name,
           count(*)::bigint AS expected_column_count,
           regexp_replace(
             lower(coalesce(pg_get_viewdef(
               to_regclass('public.' || expected.view_name), true
             ), '')),
             '[[:space:]()"]+', '', 'g'
           ) AS normalized_definition
    FROM privacy_required_view_columns expected
    GROUP BY expected.view_name
  ) required_view
  LEFT JOIN pg_catalog.pg_class view_row
    ON view_row.oid = to_regclass('public.' || required_view.view_name)
), privacy_expected_view_acl(
  view_name, grantee, expected_privileges
) AS (
  VALUES
    ('cohort_stats', 'PUBLIC', ARRAY[]::text[]),
    ('cohort_stats', 'anon', ARRAY[]::text[]),
    ('cohort_stats', 'authenticated', ARRAY[]::text[]),
    ('cohort_stats', 'service_role', ARRAY['SELECT']::text[]),
    ('cohort_room_contributor_stats', 'PUBLIC', ARRAY[]::text[]),
    ('cohort_room_contributor_stats', 'anon', ARRAY[]::text[]),
    ('cohort_room_contributor_stats', 'authenticated', ARRAY[]::text[]),
    ('cohort_room_contributor_stats', 'service_role', ARRAY['SELECT']::text[])
), privacy_view_acl AS (
  SELECT coalesce(bool_and(
    coalesce((
      SELECT array_agg(
        privilege_row.privilege_type::text
        ORDER BY privilege_row.privilege_type::text
      )
      FROM information_schema.table_privileges privilege_row
      WHERE privilege_row.table_schema = 'public'
        AND privilege_row.table_name = expected.view_name
        AND privilege_row.grantee = expected.grantee
    ), ARRAY[]::text[]) = expected.expected_privileges
  ), false) AS exact
  FROM privacy_expected_view_acl expected
), privacy_profile_column_acl AS (
  SELECT coalesce(bool_and(
    has_column_privilege(
      'anon', attribute_row.attrelid, attribute_row.attnum, 'SELECT'
    ) = (attribute_row.attname = ANY (
      ARRAY['user_id', 'nickname', 'avatar_url', 'badge', 'rank']
    ))
    AND NOT has_column_privilege(
      'anon', attribute_row.attrelid, attribute_row.attnum, 'INSERT'
    )
    AND NOT has_column_privilege(
      'anon', attribute_row.attrelid, attribute_row.attnum, 'UPDATE'
    )
    AND NOT has_column_privilege(
      'anon', attribute_row.attrelid, attribute_row.attnum, 'REFERENCES'
    )
    AND has_column_privilege(
      'authenticated', attribute_row.attrelid, attribute_row.attnum, 'SELECT'
    ) = (attribute_row.attname = ANY (
      ARRAY['user_id', 'nickname', 'avatar_url', 'badge', 'rank']
    ))
    AND NOT has_column_privilege(
      'authenticated', attribute_row.attrelid, attribute_row.attnum, 'INSERT'
    )
    AND NOT has_column_privilege(
      'authenticated', attribute_row.attrelid, attribute_row.attnum, 'UPDATE'
    )
    AND NOT has_column_privilege(
      'authenticated', attribute_row.attrelid, attribute_row.attnum, 'REFERENCES'
    )
  ), false) AS exact
  FROM pg_catalog.pg_attribute attribute_row
  WHERE attribute_row.attrelid = to_regclass('public.community_profiles')
    AND attribute_row.attnum > 0
    AND NOT attribute_row.attisdropped
), privacy_expected_table_acl(
  table_name, grantee, expected_privileges
) AS (
  VALUES
    ('cohort_contracts', 'PUBLIC', ARRAY[]::text[]),
    ('cohort_contracts', 'anon', ARRAY[]::text[]),
    ('cohort_contracts', 'authenticated',
      ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[]),
    ('cohort_contracts', 'service_role',
      ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[]),
    ('community_profiles', 'PUBLIC', ARRAY[]::text[]),
    ('community_profiles', 'anon', ARRAY[]::text[]),
    ('community_profiles', 'authenticated', ARRAY[]::text[]),
    ('community_profiles', 'service_role',
      ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[]),
    ('community_achievements', 'PUBLIC', ARRAY[]::text[]),
    ('community_achievements', 'anon', ARRAY[]::text[]),
    ('community_achievements', 'authenticated', ARRAY['SELECT']::text[]),
    ('community_achievements', 'service_role',
      ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[]),
    ('community_vendor_tags', 'PUBLIC', ARRAY[]::text[]),
    ('community_vendor_tags', 'anon', ARRAY[]::text[]),
    ('community_vendor_tags', 'authenticated', ARRAY[]::text[]),
    ('community_vendor_tags', 'service_role', ARRAY['SELECT']::text[])
), privacy_table_acl AS (
  SELECT coalesce(bool_and(
    coalesce((
      SELECT array_agg(
        privilege_row.privilege_type::text
        ORDER BY privilege_row.privilege_type::text
      )
      FROM information_schema.table_privileges privilege_row
      WHERE privilege_row.table_schema = 'public'
        AND privilege_row.table_name = expected.table_name
        AND privilege_row.grantee = expected.grantee
    ), ARRAY[]::text[]) = expected.expected_privileges
  ), false) AS exact
  FROM privacy_expected_table_acl expected
), privacy_expected_effective_acl AS (
  SELECT
    expected.table_name AS object_name,
    expected.grantee,
    expected.expected_privileges AS expected_table_privileges,
    CASE
      WHEN expected.table_name = 'community_profiles'
        AND expected.grantee IN ('anon', 'authenticated')
      THEN ARRAY['SELECT']::text[]
      ELSE ARRAY(
        SELECT privilege
        FROM unnest(expected.expected_privileges) privilege
        WHERE privilege = ANY (
          ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']::text[]
        )
        ORDER BY privilege
      )
    END AS expected_column_privileges
  FROM privacy_expected_table_acl expected

  UNION ALL

  SELECT
    expected.view_name AS object_name,
    expected.grantee,
    expected.expected_privileges AS expected_table_privileges,
    ARRAY(
      SELECT privilege
      FROM unnest(expected.expected_privileges) privilege
      WHERE privilege = ANY (
        ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']::text[]
      )
      ORDER BY privilege
    ) AS expected_column_privileges
  FROM privacy_expected_view_acl expected
), privacy_effective_acl AS (
  SELECT coalesce(bool_and(
    CASE
      WHEN expected.grantee = 'PUBLIC' THEN
        cardinality(expected.expected_table_privileges) = 0
        AND cardinality(expected.expected_column_privileges) = 0
        AND NOT EXISTS (
          SELECT 1
          FROM information_schema.table_privileges privilege_row
          WHERE privilege_row.table_schema = 'public'
            AND privilege_row.table_name = expected.object_name
            AND privilege_row.grantee = 'PUBLIC'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM information_schema.column_privileges privilege_row
          WHERE privilege_row.table_schema = 'public'
            AND privilege_row.table_name = expected.object_name
            AND privilege_row.grantee = 'PUBLIC'
        )
      ELSE
        coalesce((
          SELECT bool_and(
            pg_catalog.has_table_privilege(
              expected.grantee,
              pg_catalog.to_regclass('public.' || expected.object_name),
              privilege
            ) = (privilege = ANY (expected.expected_table_privileges))
          )
          FROM unnest(ARRAY[
            'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
            'REFERENCES', 'TRIGGER'
          ]::text[]) privilege
        ), false)
        AND coalesce((
          SELECT bool_and(
            pg_catalog.has_any_column_privilege(
              expected.grantee,
              pg_catalog.to_regclass('public.' || expected.object_name),
              privilege
            ) = (privilege = ANY (expected.expected_column_privileges))
          )
          FROM unnest(ARRAY[
            'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'
          ]::text[]) privilege
        ), false)
    END
  ), false) AS exact
  FROM privacy_expected_effective_acl expected
), privacy_minimum_contract AS (
  SELECT
    NOT EXISTS (
      SELECT 1 FROM privacy_constraint_status
      WHERE exact IS DISTINCT FROM true
    )
    AND NOT EXISTS (
      SELECT 1 FROM privacy_policy_status
      WHERE exact IS DISTINCT FROM true
    )
    AND 6 = (
      SELECT count(*) FROM pg_catalog.pg_policies
      WHERE schemaname = 'public'
        AND tablename IN (
          'cohort_contracts', 'community_profiles',
          'community_achievements', 'community_vendor_tags'
        )
    )
    AND NOT EXISTS (
      SELECT 1 FROM privacy_function_status
      WHERE exact IS DISTINCT FROM true
    )
    AND NOT EXISTS (
      SELECT 1 FROM privacy_trigger_status
      WHERE exact IS DISTINCT FROM true
    )
    AND NOT EXISTS (
      SELECT 1 FROM privacy_view_status
      WHERE exact IS DISTINCT FROM true
    )
    AND coalesce((SELECT exact FROM privacy_view_acl), false)
    AND coalesce((SELECT exact FROM privacy_profile_column_acl), false)
    AND coalesce((SELECT exact FROM privacy_table_acl), false)
    AND coalesce((SELECT exact FROM privacy_effective_acl), false)
    AND NOT has_any_column_privilege(
      'anon', 'public.cohort_contracts', 'SELECT'
    )
    AND NOT has_any_column_privilege(
      'anon', 'public.community_achievements', 'SELECT'
    )
    AND NOT has_any_column_privilege(
      'anon', 'public.community_vendor_tags', 'SELECT'
    )
    AND NOT has_any_column_privilege(
      'authenticated', 'public.community_vendor_tags', 'SELECT'
    )
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class table_row
      WHERE table_row.oid IN (
        to_regclass('public.cohort_contracts'),
        to_regclass('public.community_profiles'),
        to_regclass('public.community_achievements'),
        to_regclass('public.community_vendor_tags')
      )
        AND (table_row.relkind <> 'r' OR NOT table_row.relrowsecurity)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.customer_survey_responses
      WHERE q23_contact IS NOT NULL OR user_agent IS NOT NULL
    ) AS exact
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
  'privacy_minimum_contract_exact', coalesce((
    SELECT exact FROM privacy_minimum_contract
  ), false),
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
  'wedding_code_collection_absent_exact', coalesce((
    SELECT absent_exact FROM wedding_code_collection_retirement_status
  ), false),
  'wedding_code_collection_retirement_exact', coalesce((
    SELECT retired_exact FROM wedding_code_collection_retirement_status
  ), false),
  'wedding_code_collection_disabled_exact', coalesce((
    SELECT exact FROM wedding_code_collection_retirement_status
  ), false),
  'wedding_code_collection_retirement_status', (
    SELECT to_jsonb(status_row)
    FROM wedding_code_collection_retirement_status status_row
  ),
  'court_provider_tables_exact',
    3 = (
      SELECT count(*) FROM court_provider_table_stage_status status_row
      WHERE status_row.stage_name IN (
        'handoff_1030', 'metrics_1020', 'reveal_audit_1030'
      ) AND status_row.exact
    ),
  'court_provider_table_stage_status', (
    SELECT jsonb_object_agg(
      stage_name,
      to_jsonb(status_row) - 'stage_name'
      ORDER BY stage_name
    ) FROM court_provider_table_stage_status status_row
  ),
  'all_amora_reset_read_policies_exact', NOT EXISTS (
    SELECT 1 FROM amora_reset_read_policy_status WHERE NOT exact
  ),
  'amora_reset_read_helper_exact', coalesce((
    SELECT exact FROM amora_reset_read_helper_status
  ), false),
  'amora_reset_read_helper_status', (
    SELECT to_jsonb(status_row) - 'signature'
    FROM amora_reset_read_helper_status AS status_row
  ),
  'amora_reset_read_policy_status', (
    SELECT jsonb_object_agg(
      table_name || '.' || policy_name,
      to_jsonb(status_row) - 'table_name' - 'policy_name'
      ORDER BY table_name, policy_name
    )
    FROM amora_reset_read_policy_status AS status_row
  ),
  'all_active_admin_policies_exact', coalesce((
    SELECT exact FROM active_admin_policy_contract
  ), false),
  'active_admin_policy_allowlist_exact', coalesce((
    SELECT exact FROM active_admin_policy_allowlist_status
  ), false),
  'active_admin_policy_allowlist_status', (
    SELECT to_jsonb(status_row)
    FROM active_admin_policy_allowlist_status AS status_row
  ),
  'active_admin_policy_status', (
    SELECT jsonb_object_agg(
      table_name || '.' || policy_name,
      to_jsonb(status_row) - 'table_name' - 'policy_name'
      ORDER BY table_name, policy_name
    )
    FROM active_admin_policy_status AS status_row
  ),
  'all_maintenance_crons_exact',
    NOT EXISTS (SELECT 1 FROM maintenance_cron_status WHERE NOT exact)
    AND (SELECT count(*) FROM cron.job) =
      (SELECT count(*) FROM required_maintenance_crons),
  'all_maintenance_cron_definitions_exact',
    NOT EXISTS (
      SELECT 1 FROM maintenance_cron_status WHERE NOT definition_exact
    )
    AND (SELECT count(*) FROM cron.job) =
      (SELECT count(*) FROM required_maintenance_crons),
  'all_maintenance_crons_inactive_exact',
    NOT EXISTS (
      SELECT 1 FROM maintenance_cron_status WHERE NOT inactive_exact
    )
    AND (SELECT count(*) FROM cron.job) =
      (SELECT count(*) FROM required_maintenance_crons),
  'maintenance_cron_runtime', (
    SELECT to_jsonb(runtime_row) FROM maintenance_cron_runtime runtime_row
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
    AND 2 = (
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
  ) AND NOT EXISTS (
    SELECT 1 FROM amora_reset_read_policy_status WHERE NOT exact
  ) AND coalesce((
    SELECT exact FROM amora_reset_read_helper_status
  ), false),
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
  'unattributed_chat_image_objects', (
    SELECT count(*)
    FROM storage.objects AS object_row
    WHERE object_row.bucket_id = 'chat-image'
      AND COALESCE(object_row.owner_id, '') !~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  'orphaned_chat_image_objects', (
    SELECT count(*)
    FROM storage.objects AS object_row
    WHERE object_row.bucket_id = 'chat-image'
      AND CASE
        WHEN COALESCE(object_row.owner_id, '') ~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN NOT EXISTS (
          SELECT 1
          FROM auth.users AS auth_owner
          WHERE auth_owner.id = object_row.owner_id::uuid
        )
        ELSE false
      END
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
