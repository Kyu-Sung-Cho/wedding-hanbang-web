-- Read-only, exact post-deploy contract. Names alone are insufficient: the
-- app depends on exact RPC signatures, return shapes, definer/search-path
-- safety, role privileges, column types/nullability, real tables, and RLS.
WITH required_functions(
  signature, expected_result, expected_search_path, expected_source_md5
) AS (
  VALUES
    ('public.apply_journey_progress_patch(uuid,jsonb,text[])', 'jsonb', 'search_path=public', '8fb08367706397c9a1d00e299a48e7d5'),
    ('public.mutate_journey_schedule_event(uuid,text,jsonb,text,text)', 'jsonb', 'search_path=public', '217b8691f857b169fa8c314f38640bd6'),
    ('public.mutate_journey_budget_category(uuid,text,jsonb,text[],text)', 'jsonb', 'search_path=public', 'fffd63cefb9c2060940e5609236edcb6'),
    ('public.mutate_journey_checklist_item(uuid,text,text,boolean,boolean,jsonb)', 'jsonb', 'search_path=public', 'a32a763bd398ca9f867f500173c66e08'),
    ('public.patch_journey_preferences(uuid,jsonb)', 'jsonb', 'search_path=public', '27ee61ddb94b4c726d010371c1b5c8d5'),
    ('public.community_soft_delete_comment(uuid,uuid)',
      'TABLE(comment_id uuid, post_id uuid, author_id uuid, deleted boolean)',
      'search_path=""', '1f94340d26771efa8d1fcf13e4eb875b'),
    ('public.community_hard_delete_post(uuid,uuid)',
      'TABLE(post_id uuid, author_id uuid, deleted boolean)',
      'search_path=""', '6aac47ba565ff0f44bed0466a6d7b5d0'),
    ('public.community_update_post(uuid,uuid,jsonb)',
      'TABLE(post_id uuid, updated boolean, viewer_is_author boolean)',
      'search_path=""', '0b72e707092ed3bc704bb19ff3df9aff'),
    ('public.create_booking_atomic(uuid,uuid,date,text,uuid,uuid,text,text,text,text,numeric,text)', 'uuid', 'search_path=public', '3493fa940491a5a5efcce1bf1f6ac497'),
    ('public.check_rate_limit(text,integer,integer)', 'TABLE(allowed boolean, retry_after_seconds integer)', 'search_path=public', 'dbaddace99dcf6ddbe99da5eefe0797a'),
    ('public.check_rate_limit(text,integer,integer,uuid)', 'TABLE(allowed boolean, retry_after_seconds integer)', 'search_path=public', '7583f22c1daf9cebea4f7a847a6a507f'),
    (
      'public.reserve_amora_usage(uuid,integer,integer,boolean)',
      'TABLE(allowed boolean, reason text, remaining integer)',
      'search_path=public', '018d1031722afb3dc806adbd4b569d3f'
    ),
    (
      'public.reserve_amora_turn(uuid,integer,integer)',
      'TABLE(allowed boolean, reason text)',
      'search_path=public', '7bd558dfbfd475f3d1a2826d641aaf12'
    ),
    (
      'public.check_amora_usage(uuid,integer,integer,boolean)',
      'TABLE(allowed boolean, reason text, remaining integer, provider_remaining integer)',
      'search_path=public', '8c93415f249a7cffb2708c90f6ea6977'
    ),
    (
      'public.reserve_amora_usage_v2(uuid,integer,integer,boolean,text,text,integer)',
      'TABLE(allowed boolean, reason text, remaining integer, provider_remaining integer, reused boolean)',
      'search_path=public', '1ac065d727628555b5722812b161991a'
    ),
    (
      'public.reserve_amora_usage_unlimited_v1(uuid,text,text,integer)',
      'TABLE(allowed boolean, reason text, remaining integer, provider_remaining integer, reused boolean)',
      'search_path=public', '49059944da0d4e326cc4ab3d85565836'
    ),
    (
      'public.meter_amora_provider_usage_unlimited_v1(uuid)',
      'boolean', 'search_path=public', '4f050e1d62e323fc8e64c5368bb0f55f'
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
    ('public.complete_account_deletion_job(uuid,uuid)', 'boolean', 'search_path=public, pg_temp', 'b1e4030efdc81da7dcd4697206221ffc')
), service_denied_functions(signature) AS (
  VALUES
    ('public.guard_account_deletion_user_reference()'),
    ('public.guard_account_deletion_rate_limit_write()')
), required_function_argument_names(signature, expected_arg_names) AS (
  VALUES
    ('public.community_soft_delete_comment(uuid,uuid)',
      ARRAY[
        'p_actor_id', 'p_comment_id', 'comment_id', 'post_id', 'author_id',
        'deleted'
      ]::text[]),
    ('public.community_hard_delete_post(uuid,uuid)',
      ARRAY[
        'p_actor_id', 'p_post_id', 'post_id', 'author_id', 'deleted'
      ]::text[]),
    ('public.community_update_post(uuid,uuid,jsonb)',
      ARRAY[
        'p_actor_id', 'p_post_id', 'p_patch', 'post_id', 'updated',
        'viewer_is_author'
      ]::text[])
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
           AND (
             argument_contract.signature IS NULL
             OR procedure_row.proargnames IS NOT DISTINCT FROM
               argument_contract.expected_arg_names
           )
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
  LEFT JOIN required_function_argument_names argument_contract
    ON argument_contract.signature = required.signature
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
    ('public.sync_community_actor_identity()',
      '65e9cb5b5a27f8446bdfbe5153c74366',
      'search_path=""', false),
    ('public.maintain_community_profile_post_count()',
      '728309d11c41d182e4b3fe827004e90c',
      'search_path=""', false),
    ('public.maintain_community_counts_after_comment_delete()',
      'b322f9adb70968e2a4220f404d138b0b',
      'search_path=""', false)
), client_denied_trigger_function_status AS (
  SELECT required.signature,
         procedure_row.oid IS NOT NULL
           AND pg_get_function_result(procedure_row.oid) = 'trigger'
           AND procedure_row.prosecdef
           AND pg_get_userbyid(procedure_row.proowner) = 'postgres'
           AND procedure_row.proconfig
             @> ARRAY[required.expected_search_path]::text[]
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
    ('public', 'community_profiles', 'sync_community_profile_actor_id',
      'public.sync_community_actor_identity()',
      'CREATE TRIGGER sync_community_profile_actor_id BEFORE INSERT OR UPDATE OF public_actor_id ON community_profiles FOR EACH ROW EXECUTE FUNCTION sync_community_actor_identity()'),
    ('public', 'community_posts', 'sync_community_post_actor_id',
      'public.sync_community_actor_identity()',
      'CREATE TRIGGER sync_community_post_actor_id BEFORE INSERT OR UPDATE OF author_id, author_public_id ON community_posts FOR EACH ROW EXECUTE FUNCTION sync_community_actor_identity()'),
    ('public', 'community_comments', 'sync_community_comment_actor_id',
      'public.sync_community_actor_identity()',
      'CREATE TRIGGER sync_community_comment_actor_id BEFORE INSERT OR UPDATE OF author_id, author_public_id ON community_comments FOR EACH ROW EXECUTE FUNCTION sync_community_actor_identity()'),
    ('public', 'community_posts', 'maintain_community_profile_post_count',
      'public.maintain_community_profile_post_count()',
      'CREATE TRIGGER maintain_community_profile_post_count AFTER INSERT OR DELETE ON community_posts FOR EACH ROW EXECUTE FUNCTION maintain_community_profile_post_count()'),
    ('public', 'community_comments',
      'maintain_community_counts_after_comment_delete',
      'public.maintain_community_counts_after_comment_delete()',
      'CREATE TRIGGER maintain_community_counts_after_comment_delete AFTER DELETE ON community_comments REFERENCING OLD TABLE AS deleted_community_comments FOR EACH STATEMENT EXECUTE FUNCTION maintain_community_counts_after_comment_delete()')
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
      'SELECT public.delete_expired_rate_limit_buckets();'),
    ('enforce-raw-customer-tracking-retention', '23 18 * * *',
      'SELECT public.enforce_raw_customer_tracking_retention();')
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
           AND 1 >= (
             SELECT count(*)
             FROM pg_catalog.aclexplode(view_row.relacl) privilege_row
             WHERE privilege_row.grantee = (
               SELECT role_row.oid FROM pg_catalog.pg_roles role_row
               WHERE role_row.rolname = 'service_role'
             )
           )
           AND NOT EXISTS (
             SELECT 1
             FROM pg_catalog.aclexplode(view_row.relacl) privilege_row
             JOIN pg_catalog.pg_roles grantor
               ON grantor.oid = privilege_row.grantor
             WHERE privilege_row.grantee = (
               SELECT role_row.oid FROM pg_catalog.pg_roles role_row
               WHERE role_row.rolname = 'service_role'
             )
               AND (
                 privilege_row.privilege_type <> 'SELECT'
                 OR privilege_row.is_grantable
                 OR grantor.rolname <> 'postgres'
               )
           )
           AND NOT EXISTS (
             SELECT 1
             FROM pg_catalog.pg_attribute attribute_row
             CROSS JOIN LATERAL pg_catalog.aclexplode(attribute_row.attacl)
               privilege_row
             WHERE attribute_row.attrelid = view_row.oid
               AND attribute_row.attnum > 0
               AND NOT attribute_row.attisdropped
               AND privilege_row.grantee = (
                 SELECT role_row.oid FROM pg_catalog.pg_roles role_row
                 WHERE role_row.rolname = 'service_role'
               )
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
           AND NOT has_table_privilege(
             'service_role', view_row.oid, 'MAINTAIN'
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
    OR (
      expected.grantee = 'service_role'
      AND coalesce((
        SELECT array_agg(
          privilege_row.privilege_type::text
          ORDER BY privilege_row.privilege_type::text
        )
        FROM information_schema.table_privileges privilege_row
        WHERE privilege_row.table_schema = 'public'
          AND privilege_row.table_name = expected.view_name
          AND privilege_row.grantee = expected.grantee
      ), ARRAY[]::text[]) = ARRAY[]::text[]
    )
  ), false) AS exact
  FROM privacy_expected_view_acl expected
), privacy_profile_column_acl AS (
  SELECT coalesce(bool_and(
    NOT has_column_privilege(
      'anon', attribute_row.attrelid, attribute_row.attnum, 'INSERT'
    )
    AND NOT has_column_privilege(
      'anon', attribute_row.attrelid, attribute_row.attnum, 'UPDATE'
    )
    AND NOT has_column_privilege(
      'anon', attribute_row.attrelid, attribute_row.attnum, 'REFERENCES'
    )
    AND NOT has_column_privilege(
      'authenticated', attribute_row.attrelid, attribute_row.attnum, 'INSERT'
    )
    AND NOT has_column_privilege(
      'authenticated', attribute_row.attrelid, attribute_row.attnum, 'UPDATE'
    )
    AND NOT has_column_privilege(
      'authenticated', attribute_row.attrelid, attribute_row.attnum, 'REFERENCES'
    )
  ), false)
  AND (
    coalesce(bool_and(
      has_column_privilege(
        'anon', attribute_row.attrelid, attribute_row.attnum, 'SELECT'
      ) = (attribute_row.attname = ANY (
        ARRAY['user_id', 'nickname', 'avatar_url', 'badge', 'rank']::name[]
      ))
      AND has_column_privilege(
        'authenticated', attribute_row.attrelid, attribute_row.attnum, 'SELECT'
      ) = (attribute_row.attname = ANY (
        ARRAY['user_id', 'nickname', 'avatar_url', 'badge', 'rank']::name[]
      ))
    ), false)
    OR coalesce(bool_and(
      has_column_privilege(
        'anon', attribute_row.attrelid, attribute_row.attnum, 'SELECT'
      ) = (attribute_row.attname = ANY (
        ARRAY['public_actor_id', 'nickname', 'avatar_url']::name[]
      ))
      AND has_column_privilege(
        'authenticated', attribute_row.attrelid, attribute_row.attnum, 'SELECT'
      ) = (attribute_row.attname = ANY (
        ARRAY['public_actor_id', 'nickname', 'avatar_url']::name[]
      ))
    ), false)
  ) AS exact
  FROM pg_catalog.pg_attribute attribute_row
  WHERE attribute_row.attrelid = to_regclass('public.community_profiles')
    AND attribute_row.attnum > 0
    AND NOT attribute_row.attisdropped
), privacy_expected_table_acl(
  table_name, grantee, expected_privileges
) AS (
  VALUES
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
    actual.privileges = expected.expected_privileges
    OR actual.privileges = CASE
      WHEN expected.table_name = 'community_profiles'
        AND expected.grantee = 'service_role'
      THEN ARRAY['INSERT', 'SELECT', 'UPDATE']::text[]
      WHEN expected.table_name IN (
        'community_achievements', 'community_vendor_tags'
      ) AND expected.grantee = 'service_role'
      THEN ARRAY[]::text[]
      ELSE NULL::text[]
    END
  ), false) AS exact
  FROM privacy_expected_table_acl expected
  CROSS JOIN LATERAL (
    SELECT coalesce(array_agg(
      privilege_row.privilege_type::text
      ORDER BY privilege_row.privilege_type::text
    ), ARRAY[]::text[]) AS privileges
    FROM information_schema.table_privileges privilege_row
    WHERE privilege_row.table_schema = 'public'
      AND privilege_row.table_name = expected.table_name
      AND privilege_row.grantee = expected.grantee
  ) actual
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
      WHEN expected.grantee = 'service_role'
        AND expected.object_name = 'community_profiles' THEN
        NOT EXISTS (
          SELECT 1
          FROM unnest(ARRAY[
            'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'
          ]::text[]) privilege
          WHERE pg_catalog.has_table_privilege(
            expected.grantee,
            pg_catalog.to_regclass('public.' || expected.object_name),
            privilege
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]) privilege
          WHERE NOT pg_catalog.has_table_privilege(
            expected.grantee,
            pg_catalog.to_regclass('public.' || expected.object_name),
            privilege
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]) privilege
          WHERE NOT pg_catalog.has_any_column_privilege(
            expected.grantee,
            pg_catalog.to_regclass('public.' || expected.object_name),
            privilege
          )
        )
        AND NOT pg_catalog.has_any_column_privilege(
          expected.grantee,
          pg_catalog.to_regclass('public.' || expected.object_name),
          'REFERENCES'
        )
      WHEN expected.grantee = 'service_role'
        AND expected.object_name = 'community_achievements' THEN
        NOT EXISTS (
          SELECT 1
          FROM unnest(ARRAY[
            'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'
          ]::text[]) privilege
          WHERE pg_catalog.has_table_privilege(
            expected.grantee,
            pg_catalog.to_regclass('public.' || expected.object_name),
            privilege
          )
        )
        AND (
          (
            NOT EXISTS (
              SELECT 1
              FROM unnest(ARRAY[
                'SELECT', 'INSERT', 'UPDATE', 'DELETE'
              ]::text[]) privilege
              WHERE NOT pg_catalog.has_table_privilege(
                expected.grantee,
                pg_catalog.to_regclass('public.' || expected.object_name),
                privilege
              )
            )
            AND NOT EXISTS (
              SELECT 1
              FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE']::text[])
                privilege
              WHERE NOT pg_catalog.has_any_column_privilege(
                expected.grantee,
                pg_catalog.to_regclass('public.' || expected.object_name),
                privilege
              )
            )
          )
          OR (
            NOT has_table_privilege(
              expected.grantee,
              pg_catalog.to_regclass('public.' || expected.object_name),
              'SELECT,INSERT,UPDATE,DELETE'
            )
            AND NOT has_any_column_privilege(
              expected.grantee,
              pg_catalog.to_regclass('public.' || expected.object_name),
              'SELECT,INSERT,UPDATE,REFERENCES'
            )
          )
        )
      WHEN expected.grantee = 'service_role'
        AND expected.object_name IN (
          'cohort_stats', 'cohort_room_contributor_stats',
          'community_vendor_tags'
        ) THEN
        NOT EXISTS (
          SELECT 1
          FROM unnest(ARRAY[
            'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
            'REFERENCES', 'TRIGGER', 'MAINTAIN'
          ]::text[]) privilege
          WHERE pg_catalog.has_table_privilege(
            expected.grantee,
            pg_catalog.to_regclass('public.' || expected.object_name),
            privilege
          )
        )
        AND pg_catalog.has_table_privilege(
          expected.grantee,
          pg_catalog.to_regclass('public.' || expected.object_name),
          'SELECT'
        ) = pg_catalog.has_any_column_privilege(
          expected.grantee,
          pg_catalog.to_regclass('public.' || expected.object_name),
          'SELECT'
        )
        AND NOT pg_catalog.has_any_column_privilege(
          expected.grantee,
          pg_catalog.to_regclass('public.' || expected.object_name),
          'INSERT,UPDATE,REFERENCES'
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
            'REFERENCES', 'TRIGGER', 'MAINTAIN'
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
    AND 2 = (
      SELECT count(*) FROM pg_catalog.pg_policies
      WHERE schemaname = 'public'
        AND tablename IN (
          'community_profiles', 'community_achievements',
          'community_vendor_tags'
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
), vendor_catalog_relations(table_name) AS (
  VALUES
    ('vendors'),
    ('vendor_products'),
    ('vendor_images'),
    ('vendor_timeslots'),
    ('product_timeslots'),
    ('vendor_reviews'),
    ('vendor_staff'),
    ('staff_timeslots'),
    ('community_vendor_tags')
), vendor_service_acl_expected(table_name, privileges) AS (
  VALUES
    ('vendors', ARRAY['SELECT']::text[]),
    ('vendor_products', ARRAY['SELECT']::text[]),
    ('vendor_images', ARRAY[]::text[]),
    ('vendor_timeslots', ARRAY[]::text[]),
    ('product_timeslots', ARRAY[]::text[]),
    ('vendor_reviews', ARRAY['DELETE']::text[]),
    ('vendor_staff', ARRAY[]::text[]),
    ('staff_timeslots', ARRAY[]::text[]),
    ('community_vendor_tags', ARRAY[]::text[]),
    ('vendor_favorites', ARRAY['SELECT']::text[]),
    ('vendor_photo_likes', ARRAY['DELETE']::text[])
), vendor_catalog_lockdown_status AS (
  SELECT
    NOT EXISTS (
      SELECT 1
      FROM vendor_catalog_relations relation
      WHERE to_regclass('public.' || relation.table_name) IS NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM vendor_catalog_relations relation
      CROSS JOIN unnest(ARRAY['anon', 'authenticated']::text[])
        AS client(role_name)
      CROSS JOIN unnest(ARRAY[
        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
        'REFERENCES', 'TRIGGER', 'MAINTAIN'
      ]::text[]) AS permission(privilege_name)
      WHERE pg_catalog.has_table_privilege(
        client.role_name,
        to_regclass('public.' || relation.table_name),
        permission.privilege_name
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM vendor_catalog_relations relation
      CROSS JOIN unnest(ARRAY['anon', 'authenticated']::text[])
        AS client(role_name)
      CROSS JOIN unnest(ARRAY[
        'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'
      ]::text[]) AS permission(privilege_name)
      WHERE pg_catalog.has_any_column_privilege(
        client.role_name,
        to_regclass('public.' || relation.table_name),
        permission.privilege_name
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM vendor_service_acl_expected relation
      CROSS JOIN unnest(ARRAY[
        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
        'REFERENCES', 'TRIGGER', 'MAINTAIN'
      ]::text[]) AS permission(privilege_name)
      WHERE pg_catalog.has_table_privilege(
        'service_role',
        to_regclass('public.' || relation.table_name),
        permission.privilege_name
      ) IS DISTINCT FROM (
        permission.privilege_name = ANY(relation.privileges)
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policies policy_row
      WHERE policy_row.schemaname = 'public'
        AND policy_row.tablename IN (
          SELECT relation.table_name FROM vendor_catalog_relations relation
        )
        AND policy_row.roles && ARRAY[
          'public'::name, 'anon'::name, 'authenticated'::name
        ]
    )
    AND NOT EXISTS (
      SELECT 1
      FROM (VALUES
        ('vendor_favorites', 'vendor_favorites_select_own'),
        ('vendor_photo_likes', 'vendor_photo_likes_select_own')
      ) expected(table_name, policy_name)
      LEFT JOIN pg_catalog.pg_policies policy_row
        ON policy_row.schemaname = 'public'
       AND policy_row.tablename = expected.table_name
       AND policy_row.policyname = expected.policy_name
      WHERE policy_row.policyname IS NULL
         OR policy_row.permissive <> 'PERMISSIVE'
         OR policy_row.roles IS DISTINCT FROM ARRAY['authenticated'::name]
         OR policy_row.cmd <> 'SELECT'
         OR replace(regexp_replace(
              lower(coalesce(policy_row.qual, '')),
              '[[:space:]()"]+', '', 'g'
            ), 'public.', '') <> 'userid=auth.uid'
         OR policy_row.with_check IS NOT NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policies policy_row
      WHERE policy_row.schemaname = 'public'
        AND policy_row.tablename IN (
          'vendor_favorites', 'vendor_photo_likes'
        )
        AND policy_row.roles && ARRAY[
          'public'::name, 'anon'::name, 'authenticated'::name
        ]
        AND (
          (policy_row.tablename, policy_row.policyname) NOT IN (
            ('vendor_favorites', 'vendor_favorites_select'),
            ('vendor_favorites', 'vendor_favorites_select_own'),
            ('vendor_photo_likes', 'vendor_photo_likes_select_own')
          )
          OR policy_row.permissive <> 'PERMISSIVE'
          OR policy_row.cmd <> 'SELECT'
          OR replace(regexp_replace(
               lower(coalesce(policy_row.qual, '')),
               '[[:space:]()"]+', '', 'g'
             ), 'public.', '') <> 'userid=auth.uid'
          OR policy_row.with_check IS NOT NULL
        )
    )
    AND (
      SELECT count(*)
      FROM pg_catalog.pg_policies policy_row
      WHERE policy_row.schemaname = 'public'
        AND policy_row.tablename IN (
          'vendor_favorites', 'vendor_photo_likes'
        )
        AND policy_row.roles && ARRAY[
          'public'::name, 'anon'::name, 'authenticated'::name
        ]
    ) BETWEEN 2 AND 3
    AND NOT EXISTS (
      SELECT 1
      FROM (VALUES ('vendor_favorites'), ('vendor_photo_likes'))
        AS relation(table_name)
      CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE', 'DELETE']::text[])
        AS permission(privilege_name)
      CROSS JOIN unnest(ARRAY['anon', 'authenticated']::text[])
        AS client(role_name)
      WHERE pg_catalog.has_table_privilege(
        client.role_name,
        to_regclass('public.' || relation.table_name),
        permission.privilege_name
      )
         OR pg_catalog.has_any_column_privilege(
              client.role_name,
              to_regclass('public.' || relation.table_name),
              permission.privilege_name
            )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM (VALUES ('vendor_favorites'), ('vendor_photo_likes'))
        AS relation(table_name)
      CROSS JOIN unnest(ARRAY[
        'SELECT', 'INSERT', 'UPDATE', 'DELETE'
      ]::text[]) AS permission(privilege_name)
      WHERE NOT pg_catalog.has_table_privilege(
        'service_role', to_regclass('public.' || relation.table_name),
        permission.privilege_name
      )
    )
    AND pg_catalog.has_column_privilege(
      'anon', 'public.community_posts', 'id', 'SELECT'
    )
    AND pg_catalog.has_column_privilege(
      'authenticated', 'public.community_posts', 'id', 'SELECT'
    )
    AND NOT pg_catalog.has_column_privilege(
      'anon', 'public.community_posts', 'vendor_id', 'SELECT'
    )
    AND NOT pg_catalog.has_column_privilege(
      'authenticated', 'public.community_posts', 'vendor_id', 'SELECT'
    )
    AND 2 = (
      SELECT count(*)
      FROM storage.buckets bucket_row
      WHERE bucket_row.id IN ('vendor-images', 'vendor-licenses')
        AND bucket_row.public = false
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policies policy_row
      WHERE policy_row.schemaname = 'storage'
        AND policy_row.tablename = 'objects'
        AND policy_row.roles && ARRAY[
          'public'::name, 'anon'::name, 'authenticated'::name
        ]
        AND concat_ws(
          ' ', coalesce(policy_row.qual, ''),
          coalesce(policy_row.with_check, '')
        ) ~ 'vendor-(images|licenses)'
    ) AS exact
), cohort_browser_relations(table_name, service_privileges) AS (
  VALUES
    ('cohort_rooms', ARRAY['SELECT', 'UPDATE']::text[]),
    ('cohort_members', ARRAY['SELECT', 'UPDATE']::text[]),
    ('cohort_messages', ARRAY[]::text[]),
    ('cohort_contracts', ARRAY[]::text[]),
    ('cohort_timeline_events', ARRAY[]::text[]),
    ('cohort_member_reports', ARRAY['SELECT', 'UPDATE']::text[]),
    ('cohort_stats', ARRAY[]::text[]),
    ('cohort_room_contributor_stats', ARRAY[]::text[])
), community_mutation_relations(table_name) AS (
  VALUES
    ('community_posts'),
    ('community_comments'),
    ('community_profiles'),
    ('community_votes'),
    ('community_bookmarks'),
    ('community_reports'),
    ('community_polls'),
    ('community_poll_options'),
    ('community_poll_votes'),
    ('community_xp_log'),
    ('community_streaks'),
    ('community_achievements')
), community_service_acl_expected(table_name, privileges) AS (
  VALUES
    (
      'community_posts',
      ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]
    ),
    ('community_comments', ARRAY['SELECT']::text[]),
    ('community_profiles', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('community_votes', ARRAY['SELECT']::text[]),
    (
      'community_bookmarks',
      ARRAY['SELECT', 'INSERT', 'DELETE']::text[]
    ),
    (
      'community_reports',
      ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]
    ),
    ('community_polls', ARRAY['SELECT']::text[]),
    ('community_poll_options', ARRAY['SELECT']::text[]),
    ('community_poll_votes', ARRAY['SELECT']::text[]),
    ('community_xp_log', ARRAY[]::text[]),
    ('community_streaks', ARRAY[]::text[]),
    ('community_achievements', ARRAY[]::text[])
), community_mutation_functions(signature) AS (
  VALUES
    ('public.community_vote_post(uuid,uuid,smallint)'),
    ('public.community_vote_comment(uuid,uuid,smallint)'),
    ('public.community_record_login(uuid)'),
    ('public.community_cast_poll_vote(uuid,uuid,uuid)'),
    ('public.community_increment_view(uuid)'),
    ('public.community_update_bookmark_count(uuid)'),
    ('public.community_increment_profile_count(uuid,text)'),
    ('public.community_decrement_profile_count(uuid,text)'),
    ('public.community_award_xp(uuid,text,integer,uuid)'),
    ('public.community_unlock_achievement(uuid,text)'),
    ('public.community_update_progress(uuid,integer,text,text)')
), disabled_browser_write_lockdown_status AS (
  SELECT
    (
      NOT EXISTS (
        SELECT 1
        FROM cohort_browser_relations relation
        WHERE to_regclass('public.' || relation.table_name) IS NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM cohort_browser_relations relation
        CROSS JOIN unnest(ARRAY['anon', 'authenticated']::text[])
          AS client(role_name)
        CROSS JOIN unnest(ARRAY[
          'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
          'REFERENCES', 'TRIGGER', 'MAINTAIN'
        ]::text[]) AS permission(privilege_name)
        WHERE pg_catalog.has_table_privilege(
          client.role_name,
          to_regclass('public.' || relation.table_name),
          permission.privilege_name
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM cohort_browser_relations relation
        CROSS JOIN unnest(ARRAY['anon', 'authenticated']::text[])
          AS client(role_name)
        CROSS JOIN unnest(ARRAY[
          'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'
        ]::text[]) AS permission(privilege_name)
        WHERE pg_catalog.has_any_column_privilege(
          client.role_name,
          to_regclass('public.' || relation.table_name),
          permission.privilege_name
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM cohort_browser_relations relation
        CROSS JOIN unnest(ARRAY[
          'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
          'REFERENCES', 'TRIGGER', 'MAINTAIN'
        ]::text[]) AS permission(privilege_name)
        WHERE pg_catalog.has_table_privilege(
          'service_role',
          to_regclass('public.' || relation.table_name),
          permission.privilege_name
        ) IS DISTINCT FROM (
          permission.privilege_name = ANY(relation.service_privileges)
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'public'
          AND policy_row.tablename IN (
            'cohort_rooms', 'cohort_members', 'cohort_messages',
            'cohort_contracts', 'cohort_timeline_events',
            'cohort_member_reports'
          )
          AND policy_row.roles && ARRAY[
            'public'::name, 'anon'::name, 'authenticated'::name
          ]
      )
      AND to_regprocedure('public.is_cohort_member(uuid)') IS NOT NULL
      AND pg_catalog.has_function_privilege(
        'service_role', 'public.is_cohort_member(uuid)', 'EXECUTE'
      )
      AND NOT pg_catalog.has_function_privilege(
        'anon', 'public.is_cohort_member(uuid)', 'EXECUTE'
      )
      AND NOT pg_catalog.has_function_privilege(
        'authenticated', 'public.is_cohort_member(uuid)', 'EXECUTE'
      )
      AND EXISTS (
        SELECT 1 FROM storage.buckets bucket_row
        WHERE bucket_row.id = 'cohort-images'
          AND bucket_row.public = false
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'storage'
          AND policy_row.tablename = 'objects'
          AND policy_row.roles && ARRAY[
            'public'::name, 'anon'::name, 'authenticated'::name
          ]
          AND concat_ws(
            ' ', coalesce(policy_row.qual, ''),
            coalesce(policy_row.with_check, '')
          ) LIKE '%cohort-images%'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_publication_tables publication_table
        WHERE publication_table.pubname = 'supabase_realtime'
          AND publication_table.schemaname = 'public'
          AND publication_table.tablename = 'cohort_messages'
      )
    ) AS cohort_exact,
    (
      to_regclass('public.wedding_journeys') IS NOT NULL
      AND pg_catalog.has_table_privilege(
        'authenticated', 'public.wedding_journeys', 'SELECT'
      )
      AND pg_catalog.has_any_column_privilege(
        'authenticated', 'public.wedding_journeys', 'SELECT'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(ARRAY[
          'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER',
          'MAINTAIN'
        ]::text[]) AS permission(privilege_name)
        WHERE pg_catalog.has_table_privilege(
          'authenticated', 'public.wedding_journeys',
          permission.privilege_name
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(ARRAY['INSERT', 'UPDATE', 'REFERENCES']::text[])
          AS permission(privilege_name)
        WHERE pg_catalog.has_any_column_privilege(
          'authenticated', 'public.wedding_journeys',
          permission.privilege_name
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(ARRAY['anon']::text[]) AS client(role_name)
        CROSS JOIN unnest(ARRAY[
          'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
          'REFERENCES', 'TRIGGER', 'MAINTAIN'
        ]::text[]) AS permission(privilege_name)
        WHERE pg_catalog.has_table_privilege(
          client.role_name, 'public.wedding_journeys',
          permission.privilege_name
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(ARRAY[
          'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'
        ]::text[]) AS permission(privilege_name)
        WHERE pg_catalog.has_any_column_privilege(
          'anon', 'public.wedding_journeys', permission.privilege_name
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'public'
          AND policy_row.tablename = 'wedding_journeys'
          AND policy_row.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
          AND policy_row.roles && ARRAY[
            'public'::name, 'anon'::name, 'authenticated'::name
          ]
      )
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'public'
          AND policy_row.tablename = 'wedding_journeys'
          AND policy_row.policyname = 'journeys_select_couple'
          AND policy_row.permissive = 'PERMISSIVE'
          AND policy_row.roles = ARRAY['authenticated'::name]
          AND policy_row.cmd = 'SELECT'
          AND replace(regexp_replace(
                lower(coalesce(policy_row.qual, '')),
                '[[:space:]()"]+', '', 'g'
              ), 'public.', '') = 'is_couple_membercouple_id'
          AND policy_row.with_check IS NULL
      )
      AND 1 = (
        SELECT count(*)
        FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'public'
          AND policy_row.tablename = 'wedding_journeys'
          AND policy_row.roles && ARRAY[
            'public'::name, 'anon'::name, 'authenticated'::name
          ]
      )
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(ARRAY[
          'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
          'REFERENCES', 'TRIGGER', 'MAINTAIN'
        ]::text[]) AS permission(privilege_name)
        WHERE pg_catalog.has_table_privilege(
          'service_role', 'public.wedding_journeys',
          permission.privilege_name
        ) IS DISTINCT FROM (
          permission.privilege_name = ANY(ARRAY['SELECT', 'UPDATE']::text[])
        )
      )
    ) AS journey_exact,
    (
      to_regclass('public.chat_messages') IS NOT NULL
      AND pg_catalog.has_table_privilege(
        'authenticated', 'public.chat_messages', 'SELECT'
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
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'public'
          AND policy_row.tablename = 'chat_messages'
          AND policy_row.cmd IN ('INSERT', 'ALL')
          AND policy_row.roles && ARRAY[
            'public'::name, 'anon'::name, 'authenticated'::name
          ]
      )
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'public'
          AND policy_row.tablename = 'chat_messages'
          AND policy_row.policyname = 'chat_select_with_privacy'
          AND policy_row.permissive = 'PERMISSIVE'
          AND policy_row.roles = ARRAY['authenticated'::name]
          AND policy_row.cmd = 'SELECT'
      )
      AND 1 = (
        SELECT count(*)
        FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'public'
          AND policy_row.tablename = 'chat_messages'
          AND policy_row.roles && ARRAY[
            'public'::name, 'anon'::name, 'authenticated'::name
          ]
      )
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(ARRAY[
          'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
          'REFERENCES', 'TRIGGER', 'MAINTAIN'
        ]::text[]) AS permission(privilege_name)
        WHERE pg_catalog.has_table_privilege(
          'service_role', 'public.chat_messages',
          permission.privilege_name
        ) IS DISTINCT FROM (
          permission.privilege_name = ANY(
            ARRAY['SELECT', 'INSERT', 'DELETE']::text[]
          )
        )
      )
      AND EXISTS (
        SELECT 1 FROM storage.buckets bucket_row
        WHERE bucket_row.id = 'chat-image'
          AND bucket_row.public = false
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'storage'
          AND policy_row.tablename = 'objects'
          AND policy_row.roles && ARRAY[
            'public'::name, 'anon'::name, 'authenticated'::name
          ]
          AND concat_ws(
            ' ', coalesce(policy_row.qual, ''),
            coalesce(policy_row.with_check, '')
          ) LIKE '%chat-image%'
      )
    ) AS chat_exact,
    (
      NOT EXISTS (
        SELECT 1
        FROM community_mutation_relations relation
        WHERE to_regclass('public.' || relation.table_name) IS NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM community_mutation_relations relation
        CROSS JOIN unnest(ARRAY['anon', 'authenticated']::text[])
          AS client(role_name)
        CROSS JOIN unnest(ARRAY[
          'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
          'REFERENCES', 'TRIGGER', 'MAINTAIN'
        ]::text[])
          AS permission(privilege_name)
        WHERE pg_catalog.has_table_privilege(
          client.role_name,
          to_regclass('public.' || relation.table_name),
          permission.privilege_name
        )
           OR (
             permission.privilege_name IN ('INSERT', 'UPDATE')
             AND pg_catalog.has_any_column_privilege(
               client.role_name,
               to_regclass('public.' || relation.table_name),
               permission.privilege_name
             )
           )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM community_service_acl_expected relation
        CROSS JOIN unnest(ARRAY[
          'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
          'REFERENCES', 'TRIGGER', 'MAINTAIN'
        ]::text[]) AS permission(privilege_name)
        WHERE pg_catalog.has_table_privilege(
          'service_role',
          to_regclass('public.' || relation.table_name),
          permission.privilege_name
        ) IS DISTINCT FROM (
          permission.privilege_name = ANY(relation.privileges)
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'public'
          AND policy_row.tablename IN (
            SELECT relation.table_name
            FROM community_mutation_relations relation
          )
          AND policy_row.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
          AND policy_row.roles && ARRAY[
            'public'::name, 'anon'::name, 'authenticated'::name
          ]
      )
      AND NOT EXISTS (
        SELECT 1
        FROM community_mutation_functions function_contract
        WHERE to_regprocedure(function_contract.signature) IS NULL
           OR NOT pg_catalog.has_function_privilege(
                'service_role', function_contract.signature, 'EXECUTE'
              )
           OR pg_catalog.has_function_privilege(
                'anon', function_contract.signature, 'EXECUTE'
              )
           OR pg_catalog.has_function_privilege(
                'authenticated', function_contract.signature, 'EXECUTE'
              )
      )
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'public'
          AND policy_row.tablename = 'community_bookmarks'
          AND policy_row.policyname = 'community_bookmarks_select_own'
          AND policy_row.permissive = 'PERMISSIVE'
          AND policy_row.roles = ARRAY['authenticated'::name]
          AND policy_row.cmd = 'SELECT'
          AND replace(regexp_replace(
                lower(coalesce(policy_row.qual, '')),
                '[[:space:]()"]+', '', 'g'
              ), 'public.', '') = 'userid=auth.uid'
          AND policy_row.with_check IS NULL
      )
      AND 1 = (
        SELECT count(*)
        FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'public'
          AND policy_row.tablename = 'community_bookmarks'
          AND policy_row.roles && ARRAY[
            'public'::name, 'anon'::name, 'authenticated'::name
          ]
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'storage'
          AND policy_row.tablename = 'objects'
          AND policy_row.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
          AND policy_row.roles && ARRAY[
            'public'::name, 'anon'::name, 'authenticated'::name
          ]
          AND concat_ws(
            ' ', coalesce(policy_row.qual, ''),
            coalesce(policy_row.with_check, '')
          ) ~ 'community-(images|videos)'
      )
    ) AS community_exact
), preview_smoke_function_arguments(signature, expected_arguments) AS (
  VALUES
    ('private.assert_preview_smoke_authorized(text)', 'p_project_ref text'),
    ('private.assert_preview_smoke_user(uuid)', 'p_user_id uuid'),
    ('public.assert_preview_smoke_ready(text)', 'p_project_ref text'),
    ('public.prepare_preview_lifecycle_smoke_fixture(text,text,uuid,uuid)',
      'p_project_ref text, p_operation text, p_user_id uuid, p_couple_id uuid'),
    ('public.inspect_preview_amora_smoke_turn(text,uuid,uuid,text)',
      'p_project_ref text, p_user_id uuid, p_couple_id uuid, p_client_request_id text'),
    ('public.cleanup_preview_smoke_fixture(text,uuid[])',
      'p_project_ref text, p_user_ids uuid[]')
), trusted_beta_function_contracts(
  signature, expected_result, expected_language, expected_volatility,
  expected_security_definer, expected_proconfig, expected_source_md5,
  service_role_execute, anon_execute, authenticated_execute, creator_version
) AS (
  VALUES
    ('public.block_retired_raw_customer_tracking_writes()', 'trigger',
      'plpgsql', 'v', false, 'search_path=""',
      'f031cc768a520d401c88ff041fe54f6a', true, false, false, '20260713112000'),
    ('public.enforce_raw_customer_tracking_retention()',
      'TABLE(customer_events_deleted integer, search_logs_deleted integer)',
      'plpgsql', 'v', true, 'search_path=pg_catalog',
      '54e4f6ece31461d0f63ffbcb1d15ee6e', true, false, false, '20260713112000'),
    ('public.get_my_partner_public()', 'TABLE(id uuid, name text, role text)',
      'sql', 's', true, 'search_path=pg_catalog',
      '4a127cecbf5bc39fed3ab8200e3ffaca', true, false, true, '20260713112500'),
    ('public.get_my_profile_safe()',
      'TABLE(id uuid, name text, role text, couple_id uuid, onboarding_completed boolean, onboarding_step integer, has_phone boolean)',
      'sql', 's', true, 'search_path=pg_catalog',
      '0663224c1e2322c2c02d39945cb1e659', true, false, true, '20260713112500'),
    ('public.get_my_chat_view_state()',
      'TABLE(shared_cleared_at timestamp with time zone, private_cleared_at timestamp with time zone)',
      'sql', 's', true, 'search_path=pg_catalog',
      '5caa2a873cc53ade8dd64ba5163e80a1', true, false, true, '20260713112500'),
    ('public.block_retired_community_media_object_writes()', 'trigger',
      'plpgsql', 'v', false, 'search_path=""',
      '49a00b8e5ed57e5ccc46d71edce8001d', true, false, false, '20260713113000'),
    ('public.block_retired_community_post_media_writes()', 'trigger',
      'plpgsql', 'v', false, 'search_path=""',
      '8154296e2bd4b97fb2ab8b52ead5b39e', true, false, false, '20260713113000'),
    ('public.block_retired_community_poll_writes()', 'trigger',
      'plpgsql', 'v', false, 'search_path=""',
      '993ce2d6eac939878a835e4c39eb4749', true, false, false, '20260713113000'),
    ('public.reject_congratulatory_money_write()', 'trigger',
      'plpgsql', 'v', false, 'search_path=pg_catalog,public',
      '06a4a3cfd01028b6bc8efffe4d308c45', true, false, false, '20260713114000'),
    ('public.block_retired_community_structured_fields()', 'trigger',
      'plpgsql', 'v', false, 'search_path=""',
      '8b0a42a25c812f05ba84cc060dcfc24e', true, false, false, '20260713115000'),
    ('public.community_soft_delete_comment(uuid,uuid)',
      'TABLE(comment_id uuid, post_id uuid, author_id uuid, deleted boolean)',
      'plpgsql', 'v', true, 'search_path="",row_security=off',
      '1f94340d26771efa8d1fcf13e4eb875b', true, false, false,
      '20260713117000'),
    ('public.sync_community_actor_identity()', 'trigger',
      'plpgsql', 'v', true, 'search_path="",row_security=off',
      '65e9cb5b5a27f8446bdfbe5153c74366', false, false, false,
      '20260713118000'),
    ('public.maintain_community_profile_post_count()', 'trigger',
      'plpgsql', 'v', true, 'search_path="",row_security=off',
      '728309d11c41d182e4b3fe827004e90c', false, false, false,
      '20260713119000'),
    ('public.maintain_community_counts_after_comment_delete()', 'trigger',
      'plpgsql', 'v', true, 'search_path="",row_security=off',
      'b322f9adb70968e2a4220f404d138b0b', false, false, false,
      '20260713119000'),
    ('public.community_hard_delete_post(uuid,uuid)',
      'TABLE(post_id uuid, author_id uuid, deleted boolean)',
      'plpgsql', 'v', true, 'search_path="",row_security=off',
      '6aac47ba565ff0f44bed0466a6d7b5d0', true, false, false,
      '20260713119000'),
    ('public.community_update_post(uuid,uuid,jsonb)',
      'TABLE(post_id uuid, updated boolean, viewer_is_author boolean)',
      'plpgsql', 'v', true, 'search_path="",row_security=off',
      '0b72e707092ed3bc704bb19ff3df9aff', true, false, false,
      '20260713121000'),
    ('private.assert_preview_smoke_authorized(text)', 'void',
      'plpgsql', 'v', true, 'search_path="",row_security=off',
      'e4772be082666fdac6408bcc2dae4f42', false, false, false,
      '20260713123000'),
    ('private.assert_preview_smoke_user(uuid)', 'void',
      'plpgsql', 'v', true, 'search_path="",row_security=off',
      'c08a3f7b64c7784a7c944212443cd162', false, false, false,
      '20260713123000'),
    ('public.assert_preview_smoke_ready(text)', 'jsonb',
      'plpgsql', 'v', true, 'search_path="",row_security=off',
      'a0f9da46ab4f7e6a178efe06addd5d47', true, false, false,
      '20260713123000'),
    ('public.prepare_preview_lifecycle_smoke_fixture(text,text,uuid,uuid)',
      'jsonb', 'plpgsql', 'v', true,
      'search_path="",row_security=off',
      '907fd91bfaf189113890376f07ecaaae', true, false, false,
      '20260713123000'),
    ('public.inspect_preview_amora_smoke_turn(text,uuid,uuid,text)',
      'jsonb', 'plpgsql', 'v', true,
      'search_path="",row_security=off',
      'bd999b81c877d9f6bba03635df005e72', true, false, false,
      '20260713123000'),
    ('public.cleanup_preview_smoke_fixture(text,uuid[])', 'jsonb',
      'plpgsql', 'v', true, 'search_path="",row_security=off',
      'fadd1a5db3bf53d0625b97eadb329c22', true, false, false,
      '20260713123000')
), trusted_beta_function_status AS (
  SELECT required.signature,
         required.creator_version,
         procedure_row.oid IS NULL OR (
           pg_get_function_result(procedure_row.oid) = required.expected_result
           AND (
             argument_contract.signature IS NULL
             OR pg_get_function_arguments(procedure_row.oid) =
               argument_contract.expected_arguments
           )
         )
           AS replaceable,
         procedure_row.oid IS NOT NULL
           AND pg_get_function_result(procedure_row.oid) = required.expected_result
           AND (
             argument_contract.signature IS NULL
             OR pg_get_function_arguments(procedure_row.oid) =
               argument_contract.expected_arguments
           )
           AND language_row.lanname = required.expected_language
           AND procedure_row.provolatile = required.expected_volatility::"char"
           AND procedure_row.prosecdef = required.expected_security_definer
           AND pg_get_userbyid(procedure_row.proowner) = 'postgres'
           AND regexp_replace(
             coalesce(array_to_string(procedure_row.proconfig, ','), ''),
             '[[:space:]]+', '', 'g'
           ) = required.expected_proconfig
           AND md5(replace(procedure_row.prosrc, chr(13), '')) =
             required.expected_source_md5
           AND has_function_privilege(
             'service_role', procedure_row.oid, 'EXECUTE'
           ) = required.service_role_execute
           AND has_function_privilege(
             'anon', procedure_row.oid, 'EXECUTE'
           ) = required.anon_execute
           AND has_function_privilege(
             'authenticated', procedure_row.oid, 'EXECUTE'
           ) = required.authenticated_execute
           AS exact
  FROM trusted_beta_function_contracts required
  LEFT JOIN preview_smoke_function_arguments argument_contract
    ON argument_contract.signature = required.signature
  LEFT JOIN pg_catalog.pg_proc procedure_row
    ON procedure_row.oid = to_regprocedure(required.signature)
  LEFT JOIN pg_catalog.pg_language language_row
    ON language_row.oid = procedure_row.prolang
), trusted_beta_trigger_contracts(
  schema_name, table_name, trigger_name, function_signature, creator_version
) AS (
  VALUES
    ('public', 'customer_events', 'block_retired_customer_events_writes',
      'public.block_retired_raw_customer_tracking_writes()', '20260713112000'),
    ('public', 'search_logs', 'block_retired_search_logs_writes',
      'public.block_retired_raw_customer_tracking_writes()', '20260713112000'),
    ('storage', 'objects', 'block_retired_community_media_object_writes',
      'public.block_retired_community_media_object_writes()', '20260713113000'),
    ('public', 'community_posts', 'block_retired_community_post_media_writes',
      'public.block_retired_community_post_media_writes()', '20260713113000'),
    ('public', 'community_polls', 'block_retired_community_poll_writes',
      'public.block_retired_community_poll_writes()', '20260713113000'),
    ('public', 'community_poll_options',
      'block_retired_community_poll_option_writes',
      'public.block_retired_community_poll_writes()', '20260713113000'),
    ('public', 'community_poll_votes',
      'block_retired_community_poll_vote_writes',
      'public.block_retired_community_poll_writes()', '20260713113000'),
    ('public', 'congratulatory_money',
      'trg_reject_congratulatory_money_write',
      'public.reject_congratulatory_money_write()', '20260713114000'),
    ('public', 'community_posts',
      'block_retired_community_structured_fields',
      'public.block_retired_community_structured_fields()', '20260713115000')
), trusted_beta_trigger_status AS (
  SELECT required.trigger_name,
         required.creator_version,
         trigger_row.oid IS NOT NULL
           AND NOT trigger_row.tgisinternal
           AND trigger_row.tgenabled = 'O'
           AND trigger_row.tgtype = 23
           AND trigger_row.tgfoid = to_regprocedure(required.function_signature)
           AS exact
  FROM trusted_beta_trigger_contracts required
  LEFT JOIN pg_catalog.pg_trigger trigger_row
    ON trigger_row.tgrelid = to_regclass(
      required.schema_name || '.' || required.table_name
    )
   AND trigger_row.tgname = required.trigger_name
), trusted_beta_community_post_columns(column_name) AS (
  VALUES
    ('id'), ('author_id'), ('category'), ('title'), ('content'),
    ('visibility'), ('ad_disclosure'), ('sponsorship_detail'),
    ('is_resolved'), ('under_review'), ('upvote_count'), ('downvote_count'),
    ('comment_count'), ('view_count'), ('bookmark_count'), ('is_pinned'),
    ('is_weekly_best'), ('tags'), ('created_at'), ('updated_at')
), trusted_beta_function_acl_contracts(
  signature, allowed_roles, required_explicit_roles
) AS (
  VALUES
    ('public.community_author_is_muted(uuid)',
      ARRAY['postgres', 'anon', 'authenticated']::name[],
      ARRAY['anon', 'authenticated']::name[]),
    ('public.community_soft_delete_comment(uuid,uuid)',
      ARRAY['postgres', 'service_role']::name[],
      ARRAY['service_role']::name[]),
    ('public.sync_community_actor_identity()',
      ARRAY['postgres']::name[], ARRAY[]::name[]),
    ('public.maintain_community_profile_post_count()',
      ARRAY['postgres']::name[], ARRAY[]::name[]),
    ('public.maintain_community_counts_after_comment_delete()',
      ARRAY['postgres']::name[], ARRAY[]::name[]),
    ('public.community_hard_delete_post(uuid,uuid)',
      ARRAY['postgres', 'service_role']::name[],
      ARRAY['service_role']::name[]),
    ('public.community_update_post(uuid,uuid,jsonb)',
      ARRAY['postgres', 'service_role']::name[],
      ARRAY['service_role']::name[]),
    ('public.community_increment_profile_count(uuid,text)',
      ARRAY['postgres']::name[], ARRAY[]::name[]),
    ('public.community_decrement_profile_count(uuid,text)',
      ARRAY['postgres']::name[], ARRAY[]::name[]),
    ('private.assert_preview_smoke_authorized(text)',
      ARRAY['postgres']::name[], ARRAY[]::name[]),
    ('private.assert_preview_smoke_user(uuid)',
      ARRAY['postgres']::name[], ARRAY[]::name[]),
    ('public.assert_preview_smoke_ready(text)',
      ARRAY['postgres', 'service_role']::name[],
      ARRAY['service_role']::name[]),
    ('public.prepare_preview_lifecycle_smoke_fixture(text,text,uuid,uuid)',
      ARRAY['postgres', 'service_role']::name[],
      ARRAY['service_role']::name[]),
    ('public.inspect_preview_amora_smoke_turn(text,uuid,uuid,text)',
      ARRAY['postgres', 'service_role']::name[],
      ARRAY['service_role']::name[]),
    ('public.cleanup_preview_smoke_fixture(text,uuid[])',
      ARRAY['postgres', 'service_role']::name[],
      ARRAY['service_role']::name[])
), trusted_beta_function_acl_status AS (
  SELECT required.signature,
         procedure_row.oid IS NOT NULL
           AND NOT EXISTS (
             SELECT 1
             FROM pg_catalog.aclexplode(COALESCE(
               procedure_row.proacl,
               pg_catalog.acldefault('f', procedure_row.proowner)
             )) privilege_row
             LEFT JOIN pg_catalog.pg_roles granted_role
               ON granted_role.oid = privilege_row.grantee
             WHERE privilege_row.privilege_type <> 'EXECUTE'
                OR privilege_row.grantee = 0
                OR NOT (
                  granted_role.rolname = ANY(required.allowed_roles)
                )
           )
           AND NOT EXISTS (
             SELECT 1
             FROM unnest(required.required_explicit_roles)
               expected(role_name)
             WHERE NOT EXISTS (
               SELECT 1
               FROM pg_catalog.aclexplode(COALESCE(
                 procedure_row.proacl,
                 pg_catalog.acldefault('f', procedure_row.proowner)
               )) privilege_row
               JOIN pg_catalog.pg_roles granted_role
                 ON granted_role.oid = privilege_row.grantee
               JOIN pg_catalog.pg_roles grantor_role
                 ON grantor_role.oid = privilege_row.grantor
               WHERE granted_role.rolname = expected.role_name
                 AND grantor_role.rolname = 'postgres'
                 AND privilege_row.privilege_type = 'EXECUTE'
                 AND NOT privilege_row.is_grantable
             )
           ) AS exact
  FROM trusted_beta_function_acl_contracts required
  LEFT JOIN pg_catalog.pg_proc procedure_row
    ON procedure_row.oid = to_regprocedure(required.signature)
), trusted_beta_mute_helper_status AS (
  SELECT procedure_row.oid IS NOT NULL
           AND pg_get_function_result(procedure_row.oid) = 'boolean'
           AND pg_get_function_arguments(procedure_row.oid) =
             'p_author_public_id uuid'
           AND language_row.lanname = 'sql'
           AND procedure_row.provolatile = 's'
           AND procedure_row.prosecdef
           AND pg_get_userbyid(procedure_row.proowner) = 'postgres'
           AND regexp_replace(
             coalesce(array_to_string(procedure_row.proconfig, ','), ''),
             '[[:space:]]+', '', 'g'
           ) = 'search_path="",row_security=off'
           AND md5(replace(procedure_row.prosrc, chr(13), '')) =
             '618d8f9a6968a99f285f4a09ab8da44e'
           AND coalesce((
             SELECT exact FROM trusted_beta_function_acl_status
             WHERE signature = 'public.community_author_is_muted(uuid)'
           ), false) AS exact
  FROM (SELECT to_regprocedure(
    'public.community_author_is_muted(uuid)'
  ) AS oid) target
  LEFT JOIN pg_catalog.pg_proc procedure_row
    ON procedure_row.oid = target.oid
  LEFT JOIN pg_catalog.pg_language language_row
    ON language_row.oid = procedure_row.prolang
), trusted_beta_actor_public_columns(table_name, column_name) AS (
  VALUES
    ('community_profiles', 'public_actor_id'),
    ('community_profiles', 'nickname'),
    ('community_profiles', 'avatar_url'),
    ('community_posts', 'id'),
    ('community_posts', 'author_public_id'),
    ('community_posts', 'category'),
    ('community_posts', 'title'),
    ('community_posts', 'content'),
    ('community_posts', 'visibility'),
    ('community_posts', 'ad_disclosure'),
    ('community_posts', 'sponsorship_detail'),
    ('community_posts', 'is_resolved'),
    ('community_posts', 'under_review'),
    ('community_posts', 'upvote_count'),
    ('community_posts', 'downvote_count'),
    ('community_posts', 'comment_count'),
    ('community_posts', 'view_count'),
    ('community_posts', 'bookmark_count'),
    ('community_posts', 'is_pinned'),
    ('community_posts', 'is_weekly_best'),
    ('community_posts', 'tags'),
    ('community_posts', 'created_at'),
    ('community_posts', 'updated_at'),
    ('community_comments', 'id'),
    ('community_comments', 'post_id'),
    ('community_comments', 'parent_id'),
    ('community_comments', 'author_public_id'),
    ('community_comments', 'content'),
    ('community_comments', 'upvote_count'),
    ('community_comments', 'is_deleted'),
    ('community_comments', 'created_at'),
    ('community_comments', 'updated_at')
), trusted_beta_mute_policy_status AS (
  SELECT count(*) = 4 AND bool_and(
    policy_row.permissive = 'PERMISSIVE'
    AND policy_row.roles = ARRAY['public'::name]
    AND policy_row.cmd = 'SELECT'
    AND policy_row.with_check IS NULL
    AND CASE policy_row.policyname
      WHEN 'cp_select_public' THEN
        pg_catalog.strpos(
          lower(coalesce(policy_row.qual, '')),
          'community_author_is_muted(author_public_id)'
        ) > 0
        AND pg_catalog.strpos(lower(policy_row.qual), 'visibility') > 0
        AND pg_catalog.strpos(lower(policy_row.qual), '''public''') > 0
        AND pg_catalog.strpos(lower(policy_row.qual), 'author_public_id') > 0
        AND pg_catalog.strpos(lower(policy_row.qual), 'under_review') > 0
      WHEN 'cp_select_members' THEN
        pg_catalog.strpos(
          lower(coalesce(policy_row.qual, '')),
          'community_author_is_muted(author_public_id)'
        ) > 0
        AND pg_catalog.strpos(lower(policy_row.qual), 'visibility') > 0
        AND pg_catalog.strpos(lower(policy_row.qual), '''members''') > 0
        AND pg_catalog.strpos(lower(policy_row.qual), 'auth.role') > 0
        AND pg_catalog.strpos(lower(policy_row.qual), 'author_public_id') > 0
        AND pg_catalog.strpos(lower(policy_row.qual), 'under_review') > 0
      WHEN 'cp_select_drafts' THEN
        pg_catalog.strpos(lower(policy_row.qual), 'visibility') > 0
        AND pg_catalog.strpos(lower(policy_row.qual), '''draft''') > 0
        AND pg_catalog.strpos(lower(policy_row.qual), 'author_id') > 0
        AND pg_catalog.strpos(lower(policy_row.qual), 'auth.uid') > 0
        AND pg_catalog.strpos(
          lower(coalesce(policy_row.qual, '')),
          'community_author_is_muted'
        ) = 0
      WHEN 'cc_select' THEN
        pg_catalog.strpos(
          lower(coalesce(policy_row.qual, '')),
          'community_author_is_muted(community_comments.author_public_id)'
        ) > 0
        AND pg_catalog.strpos(
          lower(policy_row.qual),
          'community_author_is_muted(post.author_public_id)'
        ) > 0
        AND pg_catalog.strpos(lower(policy_row.qual), 'post.visibility') > 0
        AND pg_catalog.strpos(lower(policy_row.qual), 'post.under_review') > 0
      ELSE false
    END
  ) AND 4 = (
    SELECT count(*)
    FROM pg_catalog.pg_policies client_read_policy
    WHERE client_read_policy.schemaname = 'public'
      AND client_read_policy.tablename IN (
        'community_posts', 'community_comments'
      )
      AND client_read_policy.cmd IN ('SELECT', 'ALL')
      AND client_read_policy.roles && ARRAY[
        'public'::name, 'anon'::name, 'authenticated'::name
      ]
  ) AND coalesce((
    SELECT exact FROM trusted_beta_mute_helper_status
  ), false) AS exact
  FROM pg_catalog.pg_policies policy_row
  WHERE (policy_row.tablename, policy_row.policyname) IN (
    ('community_posts', 'cp_select_public'),
    ('community_posts', 'cp_select_members'),
    ('community_posts', 'cp_select_drafts'),
    ('community_comments', 'cc_select')
  )
    AND policy_row.schemaname = 'public'
), trusted_beta_actor_boundary_status AS (
  SELECT
    3 = (
      SELECT count(*)
      FROM (VALUES
        ('community_profiles'), ('community_posts'), ('community_comments')
      ) expected(table_name)
      JOIN pg_catalog.pg_class table_row
        ON table_row.oid = to_regclass('public.' || expected.table_name)
      WHERE table_row.relkind = 'r'
        AND table_row.relrowsecurity
        AND pg_get_userbyid(table_row.relowner) = 'postgres'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM (VALUES
        ('community_profiles', 'public_actor_id',
          'uuid', true, 'extensions.gen_random_uuid()'),
        ('community_posts', 'author_public_id',
          'uuid', true, NULL::text),
        ('community_comments', 'author_public_id',
          'uuid', true, NULL::text)
      ) expected(
        table_name, column_name, data_type, not_null, expected_default
      )
      LEFT JOIN pg_catalog.pg_attribute attribute_row
        ON attribute_row.attrelid = to_regclass(
          'public.' || expected.table_name
        )
       AND attribute_row.attname = expected.column_name
       AND attribute_row.attnum > 0 AND NOT attribute_row.attisdropped
      LEFT JOIN pg_catalog.pg_attrdef default_row
        ON default_row.adrelid = attribute_row.attrelid
       AND default_row.adnum = attribute_row.attnum
      WHERE attribute_row.attname IS NULL
         OR format_type(attribute_row.atttypid, attribute_row.atttypmod)
            IS DISTINCT FROM expected.data_type
         OR attribute_row.attnotnull IS DISTINCT FROM expected.not_null
         OR pg_get_expr(default_row.adbin, default_row.adrelid)
            IS DISTINCT FROM expected.expected_default
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint constraint_row
      WHERE constraint_row.conrelid =
          'public.community_profiles'::regclass
        AND constraint_row.conname =
          'community_profiles_public_actor_id_key'
        AND constraint_row.contype = 'u'
        AND constraint_row.convalidated
        AND constraint_row.conkey = ARRAY[(
          SELECT attribute_row.attnum
          FROM pg_catalog.pg_attribute attribute_row
          WHERE attribute_row.attrelid =
              'public.community_profiles'::regclass
            AND attribute_row.attname = 'public_actor_id'
        )]::smallint[]
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint constraint_row
      WHERE constraint_row.conrelid =
          'public.community_profiles'::regclass
        AND constraint_row.conname =
          'community_profiles_public_nickname_nonempty'
        AND constraint_row.contype = 'c'
        AND constraint_row.convalidated
        AND pg_get_constraintdef(constraint_row.oid, true) =
          'CHECK (btrim(nickname) <> ''''::text)'
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint constraint_row
      WHERE constraint_row.conrelid =
          'public.community_profiles'::regclass
        AND constraint_row.conname =
          'community_profiles_public_avatar_emoji_only'
        AND constraint_row.contype = 'c'
        AND constraint_row.convalidated
        AND pg_get_constraintdef(constraint_row.oid, true) LIKE
          '%avatar_url = btrim(avatar_url)%'
        AND pg_get_constraintdef(constraint_row.oid, true) LIKE
          '%char_length(avatar_url)%BETWEEN 1 AND 8%'
        AND pg_get_constraintdef(constraint_row.oid, true) LIKE
          '%avatar_url ~%01F000%01FAFF%2600%27BF%'
        AND pg_get_constraintdef(constraint_row.oid, true) LIKE
          '%avatar_url !~%200D%FE0F%'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM (VALUES
        ('community_posts', 'community_posts_author_public_id_fkey'),
        ('community_comments', 'community_comments_author_public_id_fkey')
      ) expected(table_name, constraint_name)
      LEFT JOIN pg_catalog.pg_constraint constraint_row
        ON constraint_row.conrelid = to_regclass(
          'public.' || expected.table_name
        )
       AND constraint_row.conname = expected.constraint_name
      WHERE constraint_row.oid IS NULL
         OR constraint_row.contype <> 'f'
         OR NOT constraint_row.convalidated
         OR constraint_row.confrelid <>
              'public.community_profiles'::regclass
         OR constraint_row.confupdtype <> 'r'
         OR constraint_row.confdeltype <> 'c'
         OR constraint_row.conkey <> ARRAY[(
              SELECT attribute_row.attnum
              FROM pg_catalog.pg_attribute attribute_row
              WHERE attribute_row.attrelid = to_regclass(
                  'public.' || expected.table_name
                )
                AND attribute_row.attname = 'author_public_id'
            )]::smallint[]
         OR constraint_row.confkey <> ARRAY[(
              SELECT attribute_row.attnum
              FROM pg_catalog.pg_attribute attribute_row
              WHERE attribute_row.attrelid =
                  'public.community_profiles'::regclass
                AND attribute_row.attname = 'public_actor_id'
            )]::smallint[]
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_class index_class
      JOIN pg_catalog.pg_index index_row
        ON index_row.indexrelid = index_class.oid
      WHERE index_class.relnamespace = 'public'::regnamespace
        AND index_class.relname = 'idx_community_posts_author_public_id'
        AND index_row.indisvalid AND index_row.indisready
        AND pg_get_indexdef(index_class.oid) =
          'CREATE INDEX idx_community_posts_author_public_id ON public.community_posts USING btree (author_public_id, created_at DESC)'
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_class index_class
      JOIN pg_catalog.pg_index index_row
        ON index_row.indexrelid = index_class.oid
      WHERE index_class.relnamespace = 'public'::regnamespace
        AND index_class.relname =
          'idx_community_comments_author_public_id'
        AND index_row.indisvalid AND index_row.indisready
        AND pg_get_indexdef(index_class.oid) =
          'CREATE INDEX idx_community_comments_author_public_id ON public.community_comments USING btree (author_public_id, created_at)'
    )
    AND NOT EXISTS (
      SELECT 1 FROM trusted_beta_actor_public_columns allowed
      LEFT JOIN pg_catalog.pg_attribute attribute_row
        ON attribute_row.attrelid = to_regclass(
          'public.' || allowed.table_name
        )
       AND attribute_row.attname = allowed.column_name
       AND attribute_row.attnum > 0 AND NOT attribute_row.attisdropped
      WHERE attribute_row.attname IS NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM (VALUES
        ('community_profiles'), ('community_posts'), ('community_comments')
      ) expected(table_name)
      CROSS JOIN unnest(ARRAY['anon', 'authenticated']::text[])
        client(role_name)
      WHERE has_table_privilege(
        client.role_name, 'public.' || expected.table_name,
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
      ) OR has_any_column_privilege(
        client.role_name, 'public.' || expected.table_name,
        'INSERT,UPDATE,REFERENCES'
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM (VALUES
        ('community_profiles'), ('community_posts'), ('community_comments')
      ) expected(table_name)
      CROSS JOIN unnest(ARRAY['anon', 'authenticated']::text[])
        client(role_name)
      JOIN pg_catalog.pg_attribute attribute_row
        ON attribute_row.attrelid = to_regclass(
          'public.' || expected.table_name
        )
       AND attribute_row.attnum > 0 AND NOT attribute_row.attisdropped
      WHERE has_column_privilege(
        client.role_name, attribute_row.attrelid,
        attribute_row.attnum, 'SELECT'
      ) IS DISTINCT FROM EXISTS (
        SELECT 1 FROM trusted_beta_actor_public_columns allowed
        WHERE allowed.table_name = expected.table_name
          AND allowed.column_name = attribute_row.attname
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM (VALUES
        ('community_profiles'), ('community_posts')
      ) expected(table_name)
      WHERE NOT has_table_privilege(
              'service_role', 'public.' || expected.table_name, 'SELECT'
            )
         OR NOT has_table_privilege(
              'service_role', 'public.' || expected.table_name, 'INSERT'
            )
         OR NOT has_table_privilege(
              'service_role', 'public.' || expected.table_name, 'UPDATE'
            )
         OR has_table_privilege(
              'service_role', 'public.' || expected.table_name, 'DELETE'
            ) IS DISTINCT FROM (
              expected.table_name = 'community_posts'
            )
         OR has_table_privilege(
           'service_role', 'public.' || expected.table_name, 'TRUNCATE'
         )
         OR has_table_privilege(
           'service_role', 'public.' || expected.table_name, 'REFERENCES'
         )
         OR has_table_privilege(
           'service_role', 'public.' || expected.table_name, 'TRIGGER'
         )
         OR has_table_privilege(
           'service_role', 'public.' || expected.table_name, 'MAINTAIN'
         )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM (VALUES
        (
          'community_profiles',
          ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]
        ),
        (
          'community_posts',
          ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]
        ),
        ('community_comments', ARRAY['SELECT']::text[])
      ) expected(table_name, privileges)
      JOIN pg_catalog.pg_class table_row
        ON table_row.oid = to_regclass('public.' || expected.table_name)
      WHERE EXISTS (
        SELECT 1 FROM pg_catalog.aclexplode(table_row.relacl) privilege_row
        WHERE privilege_row.grantee = 0
      )
      OR NOT coalesce((
        SELECT
          count(*) = cardinality(expected.privileges)
          AND coalesce(bool_and(
            privilege_row.privilege_type = ANY(expected.privileges)
            AND NOT privilege_row.is_grantable
            AND grantor.rolname = 'postgres'
          ), true)
        FROM pg_catalog.aclexplode(table_row.relacl) privilege_row
        JOIN pg_catalog.pg_roles grantor
          ON grantor.oid = privilege_row.grantor
        WHERE privilege_row.grantee = (
          SELECT role_row.oid FROM pg_catalog.pg_roles role_row
          WHERE role_row.rolname = 'service_role'
        )
      ), false)
    )
    AND has_table_privilege(
      'service_role', 'public.community_comments', 'SELECT'
    )
    AND NOT has_table_privilege(
      'service_role', 'public.community_comments', 'INSERT'
    )
    AND NOT has_table_privilege(
      'service_role', 'public.community_comments', 'UPDATE'
    )
    AND NOT has_table_privilege(
      'service_role', 'public.community_comments', 'DELETE'
    )
    AND NOT has_table_privilege(
      'service_role', 'public.community_comments', 'TRUNCATE'
    )
    AND NOT has_table_privilege(
      'service_role', 'public.community_comments', 'REFERENCES'
    )
    AND NOT has_table_privilege(
      'service_role', 'public.community_comments', 'TRIGGER'
    )
    AND NOT has_table_privilege(
      'service_role', 'public.community_comments', 'MAINTAIN'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute attribute_row
      WHERE attribute_row.attrelid =
          'public.community_comments'::regclass
        AND attribute_row.attnum > 0 AND NOT attribute_row.attisdropped
        AND (
          has_column_privilege(
            'service_role', attribute_row.attrelid, attribute_row.attnum,
            'INSERT'
          )
          OR has_column_privilege(
            'service_role', attribute_row.attrelid, attribute_row.attnum,
            'REFERENCES'
          )
          OR has_column_privilege(
            'service_role', attribute_row.attrelid, attribute_row.attnum,
            'UPDATE'
          ) IS DISTINCT FROM (
            attribute_row.attname = ANY (
              ARRAY['content', 'updated_at']::name[]
            )
          )
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM (VALUES
        ('community_profiles'), ('community_posts')
      ) expected(table_name)
      JOIN pg_catalog.pg_attribute attribute_row
        ON attribute_row.attrelid = to_regclass(
          'public.' || expected.table_name
        )
       AND attribute_row.attnum > 0 AND NOT attribute_row.attisdropped
      WHERE has_column_privilege(
        'service_role', attribute_row.attrelid, attribute_row.attnum,
        'REFERENCES'
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM (VALUES
        ('community_profiles'),
        ('community_posts'),
        ('community_comments')
      ) expected(table_name)
      JOIN pg_catalog.pg_attribute attribute_row
        ON attribute_row.attrelid = to_regclass(
            'public.' || expected.table_name
          )
       AND attribute_row.attnum > 0 AND NOT attribute_row.attisdropped
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute_row.attacl)
        privilege_row
      LEFT JOIN pg_catalog.pg_roles grantor
        ON grantor.oid = privilege_row.grantor
      WHERE privilege_row.grantee = 0
         OR (
           privilege_row.grantee = (
             SELECT role_row.oid FROM pg_catalog.pg_roles role_row
             WHERE role_row.rolname = 'service_role'
           )
           AND (
             expected.table_name <> 'community_comments'
             OR attribute_row.attname <> ALL(
               ARRAY['content', 'updated_at']::name[]
             )
             OR privilege_row.privilege_type <> 'UPDATE'
             OR privilege_row.is_grantable
             OR grantor.rolname <> 'postgres'
           )
         )
    )
    AND 2 = (
      SELECT count(*)
      FROM pg_catalog.pg_attribute attribute_row
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute_row.attacl)
        privilege_row
      WHERE attribute_row.attrelid =
            'public.community_comments'::regclass
        AND attribute_row.attnum > 0 AND NOT attribute_row.attisdropped
        AND privilege_row.grantee = (
          SELECT role_row.oid FROM pg_catalog.pg_roles role_row
          WHERE role_row.rolname = 'service_role'
        )
    )
    AND coalesce((
      SELECT exact FROM privacy_policy_status
      WHERE table_name = 'community_profiles'
        AND policy_name = 'community_profiles_select_public_card'
    ), false)
    AND coalesce((SELECT exact FROM trusted_beta_mute_helper_status), false)
    AND coalesce((SELECT exact FROM trusted_beta_mute_policy_status), false)
    AND NOT EXISTS (
      SELECT 1 FROM trusted_beta_function_status status
      WHERE status.creator_version = '20260713118000' AND NOT status.exact
    )
    AND coalesce((
      SELECT exact FROM trusted_beta_function_acl_status
      WHERE signature = 'public.sync_community_actor_identity()'
    ), false)
    AND NOT EXISTS (
      SELECT 1 FROM client_denied_trigger_function_status status
      WHERE status.signature = 'public.sync_community_actor_identity()'
        AND NOT status.exact
    )
    AND NOT EXISTS (
      SELECT 1 FROM client_denied_trigger_binding_status status
      WHERE status.trigger_name IN (
          'sync_community_profile_actor_id',
          'sync_community_post_actor_id',
          'sync_community_comment_actor_id'
        )
        AND NOT status.exact
    )
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_publication publication_row
      WHERE publication_row.pubname = 'supabase_realtime'
        AND publication_row.puballtables
    )
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_publication_tables publication_table
      WHERE publication_table.pubname = 'supabase_realtime'
        AND publication_table.schemaname = 'public'
        AND publication_table.tablename IN (
          'community_profiles', 'community_posts', 'community_comments'
        )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.community_profiles community_profile
      LEFT JOIN public.profiles account_profile
        ON account_profile.id = community_profile.user_id
      WHERE community_profile.public_actor_id IS NULL
         OR btrim(community_profile.nickname) = ''
         OR (
           account_profile.name IS NOT NULL
           AND btrim(community_profile.nickname) = btrim(account_profile.name)
         )
         OR community_profile.nickname ~ '^웨딩친구-[a-z0-9]{12}$'
         OR (
           community_profile.avatar_url IS NOT NULL
           AND (
             community_profile.avatar_url <>
               btrim(community_profile.avatar_url)
             OR char_length(community_profile.avatar_url) NOT BETWEEN 1 AND 8
             OR community_profile.avatar_url !~
               U&'[\+01F000-\+01FAFF\2600-\27BF]'
             OR community_profile.avatar_url ~
               U&'[^\+01F000-\+01FAFF\2600-\27BF\200D\FE0F]'
           )
         )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.community_profiles community_profile
      JOIN auth.users auth_user
        ON auth_user.id = community_profile.public_actor_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.community_posts post
      LEFT JOIN public.community_profiles profile
        ON profile.user_id = post.author_id
      WHERE post.author_public_id IS NULL
         OR post.author_public_id IS DISTINCT FROM profile.public_actor_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.community_comments comment_row
      LEFT JOIN public.community_profiles profile
        ON profile.user_id = comment_row.author_id
      WHERE comment_row.author_public_id IS NULL
         OR comment_row.author_public_id IS DISTINCT FROM
              profile.public_actor_id
    ) AS exact
), trusted_beta_surface_contract AS (
  SELECT
    (
      to_regclass('public.customer_events') IS NOT NULL
      AND to_regclass('public.search_logs') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM trusted_beta_function_status status
        WHERE status.creator_version = '20260713112000'
          AND NOT status.replaceable
      )
    ) AS raw_tracking_retirement_replaceable,
    (
      NOT EXISTS (
        SELECT 1
        FROM (VALUES ('customer_events'), ('search_logs')) expected(table_name)
        JOIN pg_catalog.pg_class table_row
          ON table_row.oid = to_regclass('public.' || expected.table_name)
        WHERE NOT table_row.relrowsecurity OR NOT table_row.relforcerowsecurity
      )
      AND 2 = (
        SELECT count(*)
        FROM (VALUES ('customer_events'), ('search_logs')) expected(table_name)
        WHERE to_regclass('public.' || expected.table_name) IS NOT NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM (VALUES ('customer_events'), ('search_logs')) expected(table_name)
        CROSS JOIN unnest(ARRAY['anon', 'authenticated']::text[])
          client(role_name)
        WHERE has_table_privilege(
          client.role_name, to_regclass('public.' || expected.table_name),
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
        ) OR has_any_column_privilege(
          client.role_name, to_regclass('public.' || expected.table_name),
          'SELECT,INSERT,UPDATE,REFERENCES'
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'public'
          AND policy_row.tablename IN ('customer_events', 'search_logs')
      )
      AND NOT EXISTS (
        SELECT 1
        FROM (VALUES
          ('customer_events', ARRAY['SELECT', 'DELETE']::text[]),
          ('search_logs', ARRAY['DELETE']::text[])
        ) expected(table_name, privileges)
        CROSS JOIN unnest(ARRAY[
          'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
          'REFERENCES', 'TRIGGER', 'MAINTAIN'
        ]::text[]) permission(privilege_name)
        WHERE has_table_privilege(
          'service_role', to_regclass('public.' || expected.table_name),
          permission.privilege_name
        ) IS DISTINCT FROM (
          permission.privilege_name = ANY(expected.privileges)
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM (VALUES
          ('customer_events', ARRAY['SELECT', 'DELETE']::text[]),
          ('search_logs', ARRAY['DELETE']::text[])
        ) expected(table_name, privileges)
        JOIN pg_catalog.pg_class table_row
          ON table_row.oid = to_regclass('public.' || expected.table_name)
        WHERE EXISTS (
          SELECT 1
          FROM pg_catalog.aclexplode(table_row.relacl) privilege_row
          WHERE privilege_row.grantee = 0
        )
        OR NOT coalesce((
          SELECT
            count(*) = cardinality(expected.privileges)
            AND coalesce(bool_and(
              privilege_row.privilege_type = ANY(expected.privileges)
              AND NOT privilege_row.is_grantable
              AND grantor.rolname = 'postgres'
            ), true)
          FROM pg_catalog.aclexplode(table_row.relacl) privilege_row
          JOIN pg_catalog.pg_roles grantor
            ON grantor.oid = privilege_row.grantor
          WHERE privilege_row.grantee = (
            SELECT role_row.oid FROM pg_catalog.pg_roles role_row
            WHERE role_row.rolname = 'service_role'
          )
        ), false)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM (VALUES ('customer_events'), ('search_logs')) expected(table_name)
        JOIN pg_catalog.pg_attribute attribute_row
          ON attribute_row.attrelid = to_regclass(
            'public.' || expected.table_name
          )
         AND attribute_row.attnum > 0 AND NOT attribute_row.attisdropped
        CROSS JOIN LATERAL pg_catalog.aclexplode(attribute_row.attacl)
          privilege_row
        WHERE privilege_row.grantee = 0
           OR privilege_row.grantee = (
             SELECT role_row.oid FROM pg_catalog.pg_roles role_row
             WHERE role_row.rolname = 'service_role'
           )
      )
      AND NOT EXISTS (
        SELECT 1 FROM trusted_beta_function_status status
        WHERE status.creator_version = '20260713112000' AND NOT status.exact
      )
      AND NOT EXISTS (
        SELECT 1 FROM trusted_beta_trigger_status status
        WHERE status.creator_version = '20260713112000' AND NOT status.exact
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.customer_events
        WHERE created_at < now() - interval '90 days'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.search_logs
        WHERE created_at < now() - interval '90 days'
      )
    ) AS raw_tracking_retirement_exact,
    (
      to_regclass('public.profiles') IS NOT NULL
      AND to_regclass('public.couples') IS NOT NULL
      AND to_regprocedure('public.can_read_profile(uuid)') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM trusted_beta_function_status status
        WHERE status.creator_version = '20260713112500'
          AND NOT status.replaceable
      )
    ) AS profiles_direct_select_closure_replaceable,
    (
      to_regclass('public.profiles') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(ARRAY['anon', 'authenticated']::text[]) client(role_name)
        WHERE has_table_privilege(
          client.role_name, 'public.profiles',
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
        ) OR has_any_column_privilege(
          client.role_name, 'public.profiles',
          'SELECT,INSERT,UPDATE,REFERENCES'
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.table_privileges privilege_row
        WHERE privilege_row.table_schema = 'public'
          AND privilege_row.table_name = 'profiles'
          AND privilege_row.grantee = 'PUBLIC'
      )
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.column_privileges privilege_row
        WHERE privilege_row.table_schema = 'public'
          AND privilege_row.table_name = 'profiles'
          AND privilege_row.grantee = 'PUBLIC'
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'public'
          AND policy_row.tablename = 'profiles'
          AND policy_row.roles && ARRAY[
            'public'::name, 'anon'::name, 'authenticated'::name
          ]
      )
      AND has_table_privilege(
        'service_role', 'public.profiles', 'SELECT'
      )
      AND has_table_privilege(
        'service_role', 'public.profiles', 'INSERT'
      )
      AND has_table_privilege(
        'service_role', 'public.profiles', 'UPDATE'
      )
      AND NOT has_table_privilege(
        'service_role', 'public.profiles', 'DELETE'
      )
      AND NOT has_table_privilege(
        'service_role', 'public.profiles', 'TRUNCATE'
      )
      AND NOT has_table_privilege(
        'service_role', 'public.profiles', 'REFERENCES'
      )
      AND NOT has_table_privilege(
        'service_role', 'public.profiles', 'TRIGGER'
      )
      AND NOT has_table_privilege(
        'service_role', 'public.profiles', 'MAINTAIN'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class table_row
        CROSS JOIN LATERAL pg_catalog.aclexplode(table_row.relacl)
          privilege_row
        WHERE table_row.oid = 'public.profiles'::regclass
          AND privilege_row.grantee = 0
      )
      AND coalesce((
        SELECT
          count(*) = 3
          AND bool_and(
            privilege_row.privilege_type = ANY(
              ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]
            )
            AND NOT privilege_row.is_grantable
            AND grantor.rolname = 'postgres'
          )
        FROM pg_catalog.pg_class table_row
        CROSS JOIN LATERAL pg_catalog.aclexplode(table_row.relacl)
          privilege_row
        JOIN pg_catalog.pg_roles grantor
          ON grantor.oid = privilege_row.grantor
        WHERE table_row.oid = 'public.profiles'::regclass
          AND privilege_row.grantee = (
            SELECT role_row.oid FROM pg_catalog.pg_roles role_row
            WHERE role_row.rolname = 'service_role'
          )
      ), false)
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_attribute attribute_row
        CROSS JOIN LATERAL pg_catalog.aclexplode(attribute_row.attacl)
          privilege_row
        WHERE attribute_row.attrelid = 'public.profiles'::regclass
          AND attribute_row.attnum > 0 AND NOT attribute_row.attisdropped
          AND (
            privilege_row.grantee = 0
            OR privilege_row.grantee = (
              SELECT role_row.oid FROM pg_catalog.pg_roles role_row
              WHERE role_row.rolname = 'service_role'
            )
          )
      )
      AND NOT has_function_privilege(
        'anon', 'public.can_read_profile(uuid)', 'EXECUTE'
      )
      AND NOT has_function_privilege(
        'authenticated', 'public.can_read_profile(uuid)', 'EXECUTE'
      )
      AND has_function_privilege(
        'service_role', 'public.can_read_profile(uuid)', 'EXECUTE'
      )
      AND NOT EXISTS (
        SELECT 1 FROM trusted_beta_function_status status
        WHERE status.creator_version = '20260713112500' AND NOT status.exact
      )
    ) AS profiles_direct_select_closure_exact,
    (
      to_regclass('storage.objects') IS NOT NULL
      AND to_regclass('public.community_posts') IS NOT NULL
      AND to_regclass('public.community_polls') IS NOT NULL
      AND to_regclass('public.community_poll_options') IS NOT NULL
      AND to_regclass('public.community_poll_votes') IS NOT NULL
      AND 2 = (
        SELECT count(*) FROM storage.buckets
        WHERE id IN ('community-images', 'community-videos')
      )
      AND NOT EXISTS (
        SELECT 1 FROM trusted_beta_function_status status
        WHERE status.creator_version = '20260713113000'
          AND NOT status.replaceable
      )
    ) AS community_media_retirement_replaceable,
    (
      2 = (
        SELECT count(*) FROM storage.buckets
        WHERE id IN ('community-images', 'community-videos') AND NOT public
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'storage'
          AND policy_row.tablename = 'objects'
          AND concat_ws(
            ' ', coalesce(policy_row.qual, ''),
            coalesce(policy_row.with_check, '')
          ) ~ 'community-(images|videos)'
      )
      AND NOT EXISTS (
        SELECT 1 FROM trusted_beta_function_status status
        WHERE status.creator_version = '20260713113000' AND NOT status.exact
      )
      AND NOT EXISTS (
        SELECT 1 FROM trusted_beta_trigger_status status
        WHERE status.creator_version = '20260713113000' AND NOT status.exact
      )
    ) AS community_media_retirement_exact,
    (
      to_regclass('public.congratulatory_money') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM trusted_beta_function_status status
        WHERE status.creator_version = '20260713114000'
          AND NOT status.replaceable
      )
    ) AS congratulatory_money_retirement_replaceable,
    (
      NOT EXISTS (
        SELECT 1
        FROM unnest(ARRAY['anon', 'authenticated']::text[]) client(role_name)
        WHERE has_table_privilege(
          client.role_name, 'public.congratulatory_money',
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
        ) OR has_any_column_privilege(
          client.role_name, 'public.congratulatory_money',
          'SELECT,INSERT,UPDATE,REFERENCES'
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'public'
          AND policy_row.tablename = 'congratulatory_money'
      )
      AND NOT has_table_privilege(
        'service_role', 'public.congratulatory_money', 'SELECT'
      )
      AND has_table_privilege(
        'service_role', 'public.congratulatory_money', 'DELETE'
      )
      AND NOT has_table_privilege(
        'service_role', 'public.congratulatory_money',
        'INSERT,UPDATE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute attribute_row
        WHERE attribute_row.attrelid = 'public.congratulatory_money'::regclass
          AND attribute_row.attnum > 0 AND NOT attribute_row.attisdropped
          AND has_column_privilege(
            'service_role', attribute_row.attrelid, attribute_row.attnum, 'SELECT'
          ) IS DISTINCT FROM (
            attribute_row.attname = ANY(
              ARRAY['id', 'owner_user_id', 'couple_id']::name[]
            )
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM trusted_beta_function_status status
        WHERE status.creator_version = '20260713114000' AND NOT status.exact
      )
      AND NOT EXISTS (
        SELECT 1 FROM trusted_beta_trigger_status status
        WHERE status.creator_version = '20260713114000' AND NOT status.exact
      )
    ) AS congratulatory_money_retirement_exact,
    (
      to_regclass('public.community_posts') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM trusted_beta_function_status status
        WHERE status.creator_version = '20260713115000'
          AND NOT status.replaceable
      )
    ) AS community_text_only_boundary_replaceable,
    (
      NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_attribute attribute_row
        CROSS JOIN unnest(ARRAY['anon', 'authenticated']::text[])
          client(role_name)
        WHERE attribute_row.attrelid = 'public.community_posts'::regclass
          AND attribute_row.attnum > 0 AND NOT attribute_row.attisdropped
          AND has_column_privilege(
            client.role_name, attribute_row.attrelid,
            attribute_row.attnum, 'SELECT'
          ) IS DISTINCT FROM EXISTS (
            SELECT 1 FROM trusted_beta_community_post_columns allowed
            WHERE allowed.column_name = attribute_row.attname
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(ARRAY['anon', 'authenticated']::text[]) client(role_name)
        WHERE has_table_privilege(
          client.role_name, 'public.community_posts',
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
        ) OR has_any_column_privilege(
          client.role_name, 'public.community_posts',
          'INSERT,UPDATE,REFERENCES'
        )
      )
      AND has_table_privilege(
        'service_role', 'public.community_posts', 'SELECT'
      )
      AND has_table_privilege(
        'service_role', 'public.community_posts', 'INSERT'
      )
      AND has_table_privilege(
        'service_role', 'public.community_posts', 'UPDATE'
      )
      AND has_table_privilege(
        'service_role', 'public.community_posts', 'DELETE'
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_publication_tables publication_table
        WHERE publication_table.pubname = 'supabase_realtime'
          AND publication_table.schemaname = 'public'
          AND publication_table.tablename = 'community_posts'
      )
      AND NOT EXISTS (
        SELECT 1 FROM trusted_beta_function_status status
        WHERE status.creator_version = '20260713115000' AND NOT status.exact
      )
      AND NOT EXISTS (
        SELECT 1 FROM trusted_beta_trigger_status status
        WHERE status.creator_version = '20260713115000' AND NOT status.exact
      )
    ) AS community_text_only_boundary_exact,
    (
      (
        to_regclass('public.community_user_mutes') IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM trusted_beta_function_status status
          WHERE status.creator_version = '20260713116000'
            AND NOT status.replaceable
        )
      )
      OR (
        SELECT count(*) = 1 AND bool_and(
          table_row.relkind = 'r'
          AND table_row.relrowsecurity
          AND table_row.relforcerowsecurity
          AND pg_get_userbyid(table_row.relowner) = 'postgres'
          AND coalesce((
            SELECT exact FROM trusted_beta_mute_policy_status
          ), false)
          AND coalesce((
            SELECT exact FROM trusted_beta_mute_helper_status
          ), false)
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_policies policy_row
            WHERE policy_row.schemaname = 'public'
              AND policy_row.tablename = 'community_user_mutes'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM unnest(ARRAY['anon', 'authenticated']::text[])
              client(role_name)
            WHERE has_table_privilege(
              client.role_name, table_row.oid,
              'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
            ) OR has_any_column_privilege(
              client.role_name, table_row.oid,
              'SELECT,INSERT,UPDATE,REFERENCES'
            )
          )
          AND has_table_privilege(
            'service_role', table_row.oid, 'SELECT'
          )
          AND has_table_privilege(
            'service_role', table_row.oid, 'INSERT'
          )
          AND has_table_privilege(
            'service_role', table_row.oid, 'DELETE'
          )
          AND NOT has_table_privilege(
            'service_role', table_row.oid,
            'UPDATE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
          )
          AND NOT has_any_column_privilege(
            'service_role', table_row.oid, 'UPDATE,REFERENCES'
          )
          AND 3 = (
            SELECT count(*) FROM pg_catalog.pg_attribute attribute_row
            WHERE attribute_row.attrelid = table_row.oid
              AND attribute_row.attnum > 0 AND NOT attribute_row.attisdropped
          )
          AND NOT EXISTS (
            SELECT 1
            FROM (VALUES
              ('muter_id', 'uuid', true, NULL::text),
              ('muted_user_id', 'uuid', true, NULL::text),
              ('created_at', 'timestamp with time zone', true, 'now()')
            ) expected(column_name, data_type, not_null, expected_default)
            LEFT JOIN pg_catalog.pg_attribute attribute_row
              ON attribute_row.attrelid = table_row.oid
             AND attribute_row.attname = expected.column_name
             AND attribute_row.attnum > 0 AND NOT attribute_row.attisdropped
            LEFT JOIN pg_catalog.pg_attrdef default_row
              ON default_row.adrelid = attribute_row.attrelid
             AND default_row.adnum = attribute_row.attnum
            WHERE attribute_row.attname IS NULL
               OR format_type(attribute_row.atttypid, attribute_row.atttypmod)
                  IS DISTINCT FROM expected.data_type
               OR attribute_row.attnotnull IS DISTINCT FROM expected.not_null
               OR pg_get_expr(default_row.adbin, default_row.adrelid)
                  IS DISTINCT FROM expected.expected_default
          )
          AND 4 = (
            SELECT count(*) FROM pg_catalog.pg_constraint constraint_row
            WHERE constraint_row.conrelid = table_row.oid
          )
          AND EXISTS (
            SELECT 1 FROM pg_catalog.pg_constraint constraint_row
            WHERE constraint_row.conrelid = table_row.oid
              AND constraint_row.conname = 'community_user_mutes_pkey'
              AND constraint_row.convalidated
              AND pg_get_constraintdef(constraint_row.oid, true) =
                'PRIMARY KEY (muter_id, muted_user_id)'
          )
          AND EXISTS (
            SELECT 1 FROM pg_catalog.pg_constraint constraint_row
            WHERE constraint_row.conrelid = table_row.oid
              AND constraint_row.conname = 'community_user_mutes_no_self'
              AND constraint_row.convalidated
              AND pg_get_constraintdef(constraint_row.oid, true) =
                'CHECK (muter_id <> muted_user_id)'
          )
          AND 2 = (
            SELECT count(*) FROM pg_catalog.pg_constraint constraint_row
            WHERE constraint_row.conrelid = table_row.oid
              AND constraint_row.contype = 'f'
              AND constraint_row.confrelid = 'auth.users'::regclass
              AND constraint_row.confdeltype = 'c'
              AND constraint_row.convalidated
          )
          AND EXISTS (
            SELECT 1 FROM pg_catalog.pg_constraint constraint_row
            WHERE constraint_row.conrelid = table_row.oid
              AND constraint_row.conname =
                'community_user_mutes_muter_id_fkey'
              AND constraint_row.convalidated
              AND pg_get_constraintdef(constraint_row.oid, true) =
                'FOREIGN KEY (muter_id) REFERENCES auth.users(id) ON DELETE CASCADE'
          )
          AND EXISTS (
            SELECT 1 FROM pg_catalog.pg_constraint constraint_row
            WHERE constraint_row.conrelid = table_row.oid
              AND constraint_row.conname =
                'community_user_mutes_muted_user_id_fkey'
              AND constraint_row.convalidated
              AND pg_get_constraintdef(constraint_row.oid, true) =
                'FOREIGN KEY (muted_user_id) REFERENCES auth.users(id) ON DELETE CASCADE'
          )
          AND EXISTS (
            SELECT 1
            FROM pg_catalog.pg_class index_class
            JOIN pg_catalog.pg_index index_row
              ON index_row.indexrelid = index_class.oid
            WHERE index_class.relnamespace = 'public'::regnamespace
              AND index_class.relname = 'idx_community_user_mutes_muted_user'
              AND index_row.indrelid = table_row.oid
              AND index_row.indisvalid AND index_row.indisready
              AND regexp_replace(
                pg_get_indexdef(index_class.oid), '[[:space:]]+', ' ', 'g'
              ) = 'CREATE INDEX idx_community_user_mutes_muted_user ON public.community_user_mutes USING btree (muted_user_id, muter_id)'
          )
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_publication_tables publication_table
            WHERE publication_table.pubname = 'supabase_realtime'
              AND publication_table.schemaname = 'public'
              AND publication_table.tablename = 'community_user_mutes'
          )
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_publication publication_row
            WHERE publication_row.pubname = 'supabase_realtime'
              AND publication_row.puballtables
          )
        )
        FROM pg_catalog.pg_class table_row
        WHERE table_row.oid = to_regclass('public.community_user_mutes')
      )
    ) AS community_user_mutes_replaceable,
    (
      to_regclass('public.community_user_mutes') IS NOT NULL
      AND (
        SELECT count(*) = 1 AND bool_and(
          table_row.relkind = 'r'
          AND table_row.relrowsecurity
          AND table_row.relforcerowsecurity
          AND pg_get_userbyid(table_row.relowner) = 'postgres'
          AND coalesce((
            SELECT exact FROM trusted_beta_mute_policy_status
          ), false)
          AND coalesce((
            SELECT exact FROM trusted_beta_mute_helper_status
          ), false)
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_policies policy_row
            WHERE policy_row.schemaname = 'public'
              AND policy_row.tablename = 'community_user_mutes'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM unnest(ARRAY['anon', 'authenticated']::text[])
              client(role_name)
            WHERE has_table_privilege(
              client.role_name, table_row.oid,
              'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
            ) OR has_any_column_privilege(
              client.role_name, table_row.oid,
              'SELECT,INSERT,UPDATE,REFERENCES'
            )
          )
          AND has_table_privilege(
            'service_role', table_row.oid, 'SELECT'
          )
          AND has_table_privilege(
            'service_role', table_row.oid, 'INSERT'
          )
          AND has_table_privilege(
            'service_role', table_row.oid, 'DELETE'
          )
          AND NOT has_table_privilege(
            'service_role', table_row.oid,
            'UPDATE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
          )
          AND NOT has_any_column_privilege(
            'service_role', table_row.oid, 'UPDATE,REFERENCES'
          )
          AND 3 = (
            SELECT count(*) FROM pg_catalog.pg_attribute attribute_row
            WHERE attribute_row.attrelid = table_row.oid
              AND attribute_row.attnum > 0 AND NOT attribute_row.attisdropped
          )
          AND NOT EXISTS (
            SELECT 1
            FROM (VALUES
              ('muter_id', 'uuid', true, NULL::text),
              ('muted_user_id', 'uuid', true, NULL::text),
              ('created_at', 'timestamp with time zone', true, 'now()')
            ) expected(column_name, data_type, not_null, expected_default)
            LEFT JOIN pg_catalog.pg_attribute attribute_row
              ON attribute_row.attrelid = table_row.oid
             AND attribute_row.attname = expected.column_name
             AND attribute_row.attnum > 0 AND NOT attribute_row.attisdropped
            LEFT JOIN pg_catalog.pg_attrdef default_row
              ON default_row.adrelid = attribute_row.attrelid
             AND default_row.adnum = attribute_row.attnum
            WHERE attribute_row.attname IS NULL
               OR format_type(attribute_row.atttypid, attribute_row.atttypmod)
                  IS DISTINCT FROM expected.data_type
               OR attribute_row.attnotnull IS DISTINCT FROM expected.not_null
               OR pg_get_expr(default_row.adbin, default_row.adrelid)
                  IS DISTINCT FROM expected.expected_default
          )
          AND 4 = (
            SELECT count(*) FROM pg_catalog.pg_constraint constraint_row
            WHERE constraint_row.conrelid = table_row.oid
          )
          AND EXISTS (
            SELECT 1 FROM pg_catalog.pg_constraint constraint_row
            WHERE constraint_row.conrelid = table_row.oid
              AND constraint_row.conname = 'community_user_mutes_pkey'
              AND constraint_row.convalidated
              AND pg_get_constraintdef(constraint_row.oid, true) =
                'PRIMARY KEY (muter_id, muted_user_id)'
          )
          AND EXISTS (
            SELECT 1 FROM pg_catalog.pg_constraint constraint_row
            WHERE constraint_row.conrelid = table_row.oid
              AND constraint_row.conname = 'community_user_mutes_no_self'
              AND constraint_row.convalidated
              AND pg_get_constraintdef(constraint_row.oid, true) =
                'CHECK (muter_id <> muted_user_id)'
          )
          AND 2 = (
            SELECT count(*) FROM pg_catalog.pg_constraint constraint_row
            WHERE constraint_row.conrelid = table_row.oid
              AND constraint_row.contype = 'f'
              AND constraint_row.confrelid = 'auth.users'::regclass
              AND constraint_row.confdeltype = 'c'
              AND constraint_row.convalidated
          )
          AND EXISTS (
            SELECT 1 FROM pg_catalog.pg_constraint constraint_row
            WHERE constraint_row.conrelid = table_row.oid
              AND constraint_row.conname =
                'community_user_mutes_muter_id_fkey'
              AND constraint_row.convalidated
              AND pg_get_constraintdef(constraint_row.oid, true) =
                'FOREIGN KEY (muter_id) REFERENCES auth.users(id) ON DELETE CASCADE'
          )
          AND EXISTS (
            SELECT 1 FROM pg_catalog.pg_constraint constraint_row
            WHERE constraint_row.conrelid = table_row.oid
              AND constraint_row.conname =
                'community_user_mutes_muted_user_id_fkey'
              AND constraint_row.convalidated
              AND pg_get_constraintdef(constraint_row.oid, true) =
                'FOREIGN KEY (muted_user_id) REFERENCES auth.users(id) ON DELETE CASCADE'
          )
          AND EXISTS (
            SELECT 1
            FROM pg_catalog.pg_class index_class
            JOIN pg_catalog.pg_index index_row
              ON index_row.indexrelid = index_class.oid
            WHERE index_class.relnamespace = 'public'::regnamespace
              AND index_class.relname = 'idx_community_user_mutes_muted_user'
              AND index_row.indrelid = table_row.oid
              AND index_row.indisvalid AND index_row.indisready
              AND regexp_replace(
                pg_get_indexdef(index_class.oid), '[[:space:]]+', ' ', 'g'
              ) = 'CREATE INDEX idx_community_user_mutes_muted_user ON public.community_user_mutes USING btree (muted_user_id, muter_id)'
          )
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_publication_tables publication_table
            WHERE publication_table.pubname = 'supabase_realtime'
              AND publication_table.schemaname = 'public'
              AND publication_table.tablename = 'community_user_mutes'
          )
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_publication publication_row
            WHERE publication_row.pubname = 'supabase_realtime'
              AND publication_row.puballtables
          )
        )
        FROM pg_catalog.pg_class table_row
        WHERE table_row.oid = to_regclass('public.community_user_mutes')
      )
    ) AS community_user_mutes_exact,
    (
      NOT EXISTS (
        SELECT 1 FROM trusted_beta_function_status status
        WHERE status.creator_version = '20260713117000' AND NOT status.exact
      )
      AND coalesce((
        SELECT exact FROM function_status
        WHERE signature = 'public.community_soft_delete_comment(uuid,uuid)'
      ), false)
      AND coalesce((
        SELECT exact FROM trusted_beta_function_acl_status
        WHERE signature = 'public.community_soft_delete_comment(uuid,uuid)'
      ), false)
    ) AS community_comment_safety_exact,
    coalesce((
      SELECT exact FROM trusted_beta_actor_boundary_status
    ), false) AS community_opaque_actor_boundary_exact,
    (
      NOT EXISTS (
        SELECT 1 FROM trusted_beta_function_status status
        WHERE status.creator_version = '20260713119000' AND NOT status.exact
      )
      AND coalesce((
        SELECT exact FROM function_status
        WHERE signature = 'public.community_hard_delete_post(uuid,uuid)'
      ), false)
      AND coalesce((
        SELECT exact FROM client_denied_trigger_function_status status
        WHERE status.signature =
          'public.maintain_community_profile_post_count()'
      ), false)
      AND coalesce((
        SELECT exact FROM client_denied_trigger_function_status status
        WHERE status.signature =
          'public.maintain_community_counts_after_comment_delete()'
      ), false)
      AND coalesce((
        SELECT exact FROM client_denied_trigger_binding_status status
        WHERE status.trigger_name = 'maintain_community_profile_post_count'
      ), false)
      AND coalesce((
        SELECT exact FROM client_denied_trigger_binding_status status
        WHERE status.trigger_name =
          'maintain_community_counts_after_comment_delete'
      ), false)
      AND NOT EXISTS (
        SELECT 1 FROM (VALUES
          ('public.maintain_community_profile_post_count()'),
          ('public.maintain_community_counts_after_comment_delete()'),
          ('public.community_hard_delete_post(uuid,uuid)'),
          ('public.community_increment_profile_count(uuid,text)'),
          ('public.community_decrement_profile_count(uuid,text)')
        ) required(signature)
        LEFT JOIN trusted_beta_function_acl_status status
          ON status.signature = required.signature
        WHERE NOT coalesce(status.exact, false)
      )
      AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute attribute_row
        LEFT JOIN pg_catalog.pg_attrdef default_row
          ON default_row.adrelid = attribute_row.attrelid
         AND default_row.adnum = attribute_row.attnum
        WHERE attribute_row.attrelid =
            'public.community_profiles'::regclass
          AND attribute_row.attname = 'post_count'
          AND attribute_row.attnum > 0 AND NOT attribute_row.attisdropped
          AND attribute_row.attnotnull
          AND format_type(attribute_row.atttypid, attribute_row.atttypmod) =
            'integer'
          AND pg_get_expr(default_row.adbin, default_row.adrelid) = '0'
      )
      AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute attribute_row
        LEFT JOIN pg_catalog.pg_attrdef default_row
          ON default_row.adrelid = attribute_row.attrelid
         AND default_row.adnum = attribute_row.attnum
        WHERE attribute_row.attrelid =
            'public.community_profiles'::regclass
          AND attribute_row.attname = 'comment_count'
          AND attribute_row.attnum > 0 AND NOT attribute_row.attisdropped
          AND attribute_row.attnotnull
          AND format_type(attribute_row.atttypid, attribute_row.atttypmod) =
            'integer'
          AND pg_get_expr(default_row.adbin, default_row.adrelid) = '0'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.community_posts post
        WHERE post.comment_count IS DISTINCT FROM (
          SELECT count(*)::integer FROM public.community_comments comment_row
          WHERE comment_row.post_id = post.id
            AND NOT coalesce(comment_row.is_deleted, false)
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.community_profiles profile
        WHERE profile.post_count IS DISTINCT FROM (
          SELECT count(*)::integer FROM public.community_posts post
          WHERE post.author_id = profile.user_id
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.community_profiles profile
        WHERE profile.comment_count IS DISTINCT FROM (
          SELECT count(*)::integer FROM public.community_comments comment_row
          WHERE comment_row.author_id = profile.user_id
            AND NOT coalesce(comment_row.is_deleted, false)
        )
      )
    ) AS community_post_lifecycle_exact,
    (
      NOT EXISTS (
        SELECT 1 FROM trusted_beta_function_status status
        WHERE status.creator_version = '20260713121000' AND NOT status.exact
      )
      AND coalesce((
        SELECT exact FROM function_status
        WHERE signature = 'public.community_update_post(uuid,uuid,jsonb)'
      ), false)
      AND coalesce((
        SELECT exact FROM trusted_beta_function_acl_status
        WHERE signature = 'public.community_update_post(uuid,uuid,jsonb)'
      ), false)
    ) AS community_post_update_exact
), preview_smoke_required_columns(
  table_name, column_name, expected_type, expected_not_null, expected_default
) AS (
  VALUES
    ('preview_smoke_projects', 'project_ref', 'text', true, NULL::text),
    ('preview_smoke_projects', 'created_at',
      'timestamp with time zone', true, 'clock_timestamp()'),
    ('preview_smoke_projects', 'enabled_until',
      'timestamp with time zone', true, NULL::text),
    ('preview_smoke_projects', 'reason', 'text', true, NULL::text),
    ('preview_smoke_fixture_couples', 'couple_id', 'uuid', true, NULL::text),
    ('preview_smoke_fixture_couples', 'project_ref', 'text', true, NULL::text),
    ('preview_smoke_fixture_couples', 'owner_user_id', 'uuid', true, NULL::text),
    ('preview_smoke_fixture_couples', 'created_at',
      'timestamp with time zone', true, 'clock_timestamp()')
), preview_smoke_column_status AS (
  SELECT count(*) = 8
    AND bool_and(
      attribute_row.attname IS NOT NULL
      AND format_type(attribute_row.atttypid, attribute_row.atttypmod) =
        required.expected_type
      AND attribute_row.attnotnull = required.expected_not_null
      AND pg_get_expr(default_row.adbin, default_row.adrelid)
        IS NOT DISTINCT FROM required.expected_default
    )
    AND 8 = (
      SELECT count(*)
      FROM pg_catalog.pg_attribute actual_attribute
      WHERE actual_attribute.attrelid IN (
          to_regclass('private.preview_smoke_projects'),
          to_regclass('private.preview_smoke_fixture_couples')
        )
        AND actual_attribute.attnum > 0
        AND NOT actual_attribute.attisdropped
    ) AS exact
  FROM preview_smoke_required_columns required
  LEFT JOIN pg_catalog.pg_attribute attribute_row
    ON attribute_row.attrelid = to_regclass(
      'private.' || required.table_name
    )
   AND attribute_row.attname = required.column_name
   AND attribute_row.attnum > 0
   AND NOT attribute_row.attisdropped
  LEFT JOIN pg_catalog.pg_attrdef default_row
    ON default_row.adrelid = attribute_row.attrelid
   AND default_row.adnum = attribute_row.attnum
), preview_smoke_catalog_status AS (
  SELECT
    namespace_row.oid IS NULL
      AND to_regclass('private.preview_smoke_projects') IS NULL
      AND to_regclass('private.preview_smoke_fixture_couples') IS NULL AS absent,
    namespace_row.oid IS NOT NULL
      AND pg_get_userbyid(namespace_row.nspowner) = 'postgres'
      AND NOT has_schema_privilege('anon', namespace_row.oid, 'USAGE,CREATE')
      AND NOT has_schema_privilege(
        'authenticated', namespace_row.oid, 'USAGE,CREATE'
      )
      AND NOT has_schema_privilege(
        'service_role', namespace_row.oid, 'USAGE,CREATE'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(namespace_row.nspacl) privilege_row
        LEFT JOIN pg_catalog.pg_roles granted_role
          ON granted_role.oid = privilege_row.grantee
        JOIN pg_catalog.pg_roles grantor_role
          ON grantor_role.oid = privilege_row.grantor
        WHERE privilege_row.grantee = 0
           OR coalesce(granted_role.rolname, '') <> 'postgres'
           OR privilege_row.is_grantable
           OR grantor_role.rolname <> 'postgres'
      )
      AND 2 = (
        SELECT count(*) FROM pg_catalog.pg_class private_relation
        WHERE private_relation.relnamespace = namespace_row.oid
          AND private_relation.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
      )
      AND 2 = (
        SELECT count(*) FROM pg_catalog.pg_proc private_function
        WHERE private_function.pronamespace = namespace_row.oid
      )
      AND coalesce((SELECT exact FROM preview_smoke_column_status), false)
      AND NOT EXISTS (
        SELECT 1
        FROM (VALUES
          ('preview_smoke_projects'),
          ('preview_smoke_fixture_couples')
        ) expected(table_name)
        LEFT JOIN pg_catalog.pg_class table_row
          ON table_row.oid = to_regclass('private.' || expected.table_name)
        WHERE table_row.oid IS NULL
           OR table_row.relkind <> 'r'
           OR pg_get_userbyid(table_row.relowner) <> 'postgres'
           OR table_row.relrowsecurity
           OR table_row.relforcerowsecurity
           OR has_table_privilege(
             'anon', table_row.oid,
             'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
           )
           OR has_table_privilege(
             'authenticated', table_row.oid,
             'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
           )
           OR EXISTS (
             SELECT 1 FROM unnest(ARRAY[
               'SELECT', 'INSERT', 'UPDATE', 'DELETE',
               'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'
             ]::text[]) forbidden(privilege_name)
             WHERE has_table_privilege(
               'service_role', table_row.oid, forbidden.privilege_name
             )
           )
           OR has_any_column_privilege(
             'anon', table_row.oid, 'SELECT,INSERT,UPDATE,REFERENCES'
           )
           OR has_any_column_privilege(
             'authenticated', table_row.oid,
             'SELECT,INSERT,UPDATE,REFERENCES'
           )
           OR EXISTS (
             SELECT 1 FROM unnest(ARRAY[
               'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'
             ]::text[]) forbidden(privilege_name)
             WHERE has_any_column_privilege(
               'service_role', table_row.oid, forbidden.privilege_name
             )
           )
           OR EXISTS (
             SELECT 1 FROM pg_catalog.aclexplode(table_row.relacl) acl_row
             LEFT JOIN pg_catalog.pg_roles acl_grantee
               ON acl_grantee.oid = acl_row.grantee
             JOIN pg_catalog.pg_roles acl_grantor
               ON acl_grantor.oid = acl_row.grantor
             WHERE acl_row.grantee = 0
                OR coalesce(acl_grantee.rolname, '') <> 'postgres'
                OR acl_row.is_grantable
                OR acl_grantor.rolname <> 'postgres'
           )
           OR EXISTS (
             SELECT 1 FROM pg_catalog.pg_attribute acl_attribute
             CROSS JOIN LATERAL pg_catalog.aclexplode(acl_attribute.attacl)
               column_acl
             WHERE acl_attribute.attrelid = table_row.oid
               AND acl_attribute.attnum > 0
               AND NOT acl_attribute.attisdropped
           )
      )
      AND 10 = (
        SELECT count(*) FROM pg_catalog.pg_constraint constraint_row
        WHERE constraint_row.conrelid IN (
          to_regclass('private.preview_smoke_projects'),
          to_regclass('private.preview_smoke_fixture_couples')
        )
          AND constraint_row.convalidated
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint constraint_row
        WHERE constraint_row.conrelid IN (
          to_regclass('private.preview_smoke_projects'),
          to_regclass('private.preview_smoke_fixture_couples')
        )
          AND NOT constraint_row.convalidated
      )
      AND 5 = (
        SELECT count(*) FROM pg_catalog.pg_constraint constraint_row
        WHERE constraint_row.conrelid =
            to_regclass('private.preview_smoke_projects')
          AND constraint_row.contype = 'c'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM (VALUES
          ('preview_smoke_projects_project_ref_check', ARRAY[
            'CHECKproject_ref~''^[a-z0-9]{8,64}$'''
          ]::text[]),
          ('preview_smoke_projects_reason_check', ARRAY[
            'CHECKchar_lengthbtrimreason>=8ANDchar_lengthbtrimreason<=200',
            'CHECKchar_lengthbtrimreasonBETWEEN8AND200'
          ]::text[]),
          ('preview_smoke_projects_check', ARRAY[
            'CHECKenabled_until>created_at'
          ]::text[]),
          ('preview_smoke_projects_check1', ARRAY[
            'CHECKenabled_until<=created_at+''24:00:00''',
            'CHECKenabled_until<=created_at+''1day''',
            'CHECKenabled_until<=created_at+''24hours'''
          ]::text[]),
          ('preview_smoke_projects_production_ref_check', ARRAY[
            'CHECKproject_ref<>ALLARRAY[''slrtobkksjmxgzatjyqb'']'
          ]::text[])
        ) expected(constraint_name, allowed_definitions)
        LEFT JOIN pg_catalog.pg_constraint constraint_row
          ON constraint_row.conrelid =
            to_regclass('private.preview_smoke_projects')
         AND constraint_row.conname = expected.constraint_name
        WHERE constraint_row.oid IS NULL
           OR regexp_replace(
             regexp_replace(
               pg_get_constraintdef(constraint_row.oid, true),
               '[[:space:]()]', '', 'g'
             ),
             '::(text|interval)(\[\])?', '', 'g'
           ) <> ALL (expected.allowed_definitions)
      )
      AND 2 = (
        SELECT count(*) FROM pg_catalog.pg_constraint constraint_row
        WHERE constraint_row.conrelid IN (
          to_regclass('private.preview_smoke_projects'),
          to_regclass('private.preview_smoke_fixture_couples')
        )
          AND constraint_row.contype = 'p'
      )
      AND 3 = (
        SELECT count(*) FROM pg_catalog.pg_constraint constraint_row
        WHERE constraint_row.conrelid =
            to_regclass('private.preview_smoke_fixture_couples')
          AND constraint_row.contype = 'f'
      )
      AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint constraint_row
        WHERE constraint_row.conrelid =
            to_regclass('private.preview_smoke_projects')
          AND constraint_row.conname =
            'preview_smoke_projects_production_ref_check'
          AND regexp_replace(
            regexp_replace(
              pg_get_constraintdef(constraint_row.oid, true),
              '[[:space:]]+', '', 'g'
            ),
            '::text(\[\])?', '', 'g'
          ) = ANY (ARRAY[
            'CHECK(project_ref<>ALL(ARRAY[''slrtobkksjmxgzatjyqb'']))',
            'CHECK((project_ref<>ALL(ARRAY[''slrtobkksjmxgzatjyqb''])))'
          ]::text[])
      )
      AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint constraint_row
        WHERE constraint_row.conrelid =
            to_regclass('private.preview_smoke_projects')
          AND constraint_row.contype = 'p'
          AND pg_get_constraintdef(constraint_row.oid, true) =
            'PRIMARY KEY (project_ref)'
      )
      AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint constraint_row
        WHERE constraint_row.conrelid =
            to_regclass('private.preview_smoke_fixture_couples')
          AND constraint_row.contype = 'p'
          AND pg_get_constraintdef(constraint_row.oid, true) =
            'PRIMARY KEY (couple_id)'
      )
      AND 3 = (
        SELECT count(DISTINCT constraint_row.confrelid)
        FROM pg_catalog.pg_constraint constraint_row
        WHERE constraint_row.conrelid =
            to_regclass('private.preview_smoke_fixture_couples')
          AND constraint_row.contype = 'f'
          AND constraint_row.convalidated
          AND constraint_row.confrelid IN (
            to_regclass('public.couples'),
            to_regclass('private.preview_smoke_projects'),
            to_regclass('auth.users')
          )
          AND (
            (
              constraint_row.confrelid = to_regclass('public.couples')
              AND constraint_row.confdeltype = 'c'
              AND constraint_row.conkey = ARRAY[(
                SELECT attribute_row.attnum
                FROM pg_catalog.pg_attribute attribute_row
                WHERE attribute_row.attrelid =
                    to_regclass('private.preview_smoke_fixture_couples')
                  AND attribute_row.attname = 'couple_id'
              )]::smallint[]
              AND constraint_row.confkey = ARRAY[(
                SELECT attribute_row.attnum
                FROM pg_catalog.pg_attribute attribute_row
                WHERE attribute_row.attrelid = to_regclass('public.couples')
                  AND attribute_row.attname = 'id'
              )]::smallint[]
            )
            OR (
              constraint_row.confrelid =
                to_regclass('private.preview_smoke_projects')
              AND constraint_row.confdeltype = 'a'
              AND constraint_row.conkey = ARRAY[(
                SELECT attribute_row.attnum
                FROM pg_catalog.pg_attribute attribute_row
                WHERE attribute_row.attrelid =
                    to_regclass('private.preview_smoke_fixture_couples')
                  AND attribute_row.attname = 'project_ref'
              )]::smallint[]
              AND constraint_row.confkey = ARRAY[(
                SELECT attribute_row.attnum
                FROM pg_catalog.pg_attribute attribute_row
                WHERE attribute_row.attrelid =
                    to_regclass('private.preview_smoke_projects')
                  AND attribute_row.attname = 'project_ref'
              )]::smallint[]
            )
            OR (
              constraint_row.confrelid = to_regclass('auth.users')
              AND constraint_row.confdeltype = 'a'
              AND constraint_row.conkey = ARRAY[(
                SELECT attribute_row.attnum
                FROM pg_catalog.pg_attribute attribute_row
                WHERE attribute_row.attrelid =
                    to_regclass('private.preview_smoke_fixture_couples')
                  AND attribute_row.attname = 'owner_user_id'
              )]::smallint[]
              AND constraint_row.confkey = ARRAY[(
                SELECT attribute_row.attnum
                FROM pg_catalog.pg_attribute attribute_row
                WHERE attribute_row.attrelid = to_regclass('auth.users')
                  AND attribute_row.attname = 'id'
              )]::smallint[]
            )
          )
          AND constraint_row.confupdtype = 'a'
          AND constraint_row.confmatchtype = 's'
      ) AS exact
  FROM (SELECT true AS one_row) seed
  LEFT JOIN pg_catalog.pg_namespace namespace_row
    ON namespace_row.nspname = 'private'
), preview_smoke_harness_status AS (
  SELECT
    (
      catalog_status.absent OR catalog_status.exact
    )
      AND coalesce((
        SELECT count(*) = 6 AND bool_and(function_status.replaceable)
        FROM trusted_beta_function_status function_status
        WHERE function_status.creator_version = '20260713123000'
      ), false) AS replaceable,
    catalog_status.exact
      AND coalesce((
        SELECT count(*) = 6 AND bool_and(function_status.exact)
        FROM trusted_beta_function_status function_status
        WHERE function_status.creator_version = '20260713123000'
      ), false)
      AND coalesce((
        SELECT count(*) = 6 AND bool_and(acl_status.exact)
        FROM trusted_beta_function_acl_status acl_status
        WHERE acl_status.signature = ANY (ARRAY[
          'private.assert_preview_smoke_authorized(text)',
          'private.assert_preview_smoke_user(uuid)',
          'public.assert_preview_smoke_ready(text)',
          'public.prepare_preview_lifecycle_smoke_fixture(text,text,uuid,uuid)',
          'public.inspect_preview_amora_smoke_turn(text,uuid,uuid,text)',
          'public.cleanup_preview_smoke_fixture(text,uuid[])'
        ]::text[])
      ), false) AS exact
  FROM preview_smoke_catalog_status catalog_status
), service_role_table_acl_expected(table_name, expected_privileges) AS (
  VALUES
    ('amora_turn_counters', ARRAY[]::text[]),
    ('amora_usage_reservations', ARRAY[]::text[]),
    ('rate_limit_buckets', ARRAY['SELECT', 'DELETE']::text[]),
    ('couples', ARRAY['SELECT']::text[]),
    ('account_deletions', ARRAY['UPDATE']::text[]),
    ('customer_survey_responses', ARRAY[]::text[]),
    ('chat_feedback', ARRAY['SELECT', 'DELETE']::text[]),
    ('chat_summaries', ARRAY['SELECT', 'INSERT', 'DELETE']::text[]),
    ('amora_actions', ARRAY[]::text[]),
    ('wedding_code_responses', ARRAY[]::text[]),
    ('community_upload_reservations', ARRAY[]::text[]),
    ('account_deletion_jobs', ARRAY['SELECT', 'UPDATE']::text[]),
    (
      'amora_request_claims',
      ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]
    ),
    ('amora_provider_leases', ARRAY[]::text[])
), service_role_table_acl_status AS (
  SELECT
    count(*) = 14 AND bool_and(
      table_row.oid IS NOT NULL AND table_row.relkind = 'r'
    ) AS replaceable,
    count(*) = 14 AND bool_and(
      table_row.oid IS NOT NULL
      AND table_row.relkind = 'r'
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(ARRAY[
          'SELECT', 'INSERT', 'UPDATE', 'DELETE',
          'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'
        ]::text[]) required(privilege_name)
        WHERE has_table_privilege(
          'service_role', table_row.oid, required.privilege_name
        ) IS DISTINCT FROM (
          required.privilege_name = ANY(expected.expected_privileges)
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(table_row.relacl) privilege_row
        WHERE privilege_row.grantee = 0
      )
      AND coalesce((
        SELECT
          count(*) = cardinality(expected.expected_privileges)
          AND coalesce(bool_and(
            privilege_row.privilege_type = ANY(
              expected.expected_privileges
            )
            AND NOT privilege_row.is_grantable
            AND grantor.rolname = 'postgres'
          ), true)
        FROM pg_catalog.aclexplode(table_row.relacl) privilege_row
        JOIN pg_catalog.pg_roles grantor
          ON grantor.oid = privilege_row.grantor
        WHERE privilege_row.grantee = (
          SELECT role_row.oid FROM pg_catalog.pg_roles role_row
          WHERE role_row.rolname = 'service_role'
        )
      ), false)
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_attribute attribute_row
        CROSS JOIN LATERAL pg_catalog.aclexplode(attribute_row.attacl)
          privilege_row
        WHERE attribute_row.attrelid = table_row.oid
          AND attribute_row.attnum > 0
          AND NOT attribute_row.attisdropped
          AND (
            privilege_row.grantee = 0
            OR privilege_row.grantee = (
              SELECT role_row.oid FROM pg_catalog.pg_roles role_row
              WHERE role_row.rolname = 'service_role'
            )
          )
      )
    ) AS exact
  FROM service_role_table_acl_expected expected
  LEFT JOIN pg_catalog.pg_class table_row
    ON table_row.oid = to_regclass('public.' || expected.table_name)
), research_consent_version_status AS (
  SELECT
    table_row.oid IS NOT NULL
      AND column_row.attname IS NOT NULL
      AND format_type(column_row.atttypid, column_row.atttypmod) = 'text'
      AND column_row.attnotnull
      AND constraint_row.oid IS NOT NULL
      AND constraint_row.contype = 'c'
      AND constraint_row.convalidated
      AND pg_get_constraintdef(constraint_row.oid, true) =
        'CHECK (privacy_policy_version = ANY (ARRAY[''2026-07-12''::text, ''2026-07-14''::text]))'
      AND NOT EXISTS (
        SELECT 1 FROM public.research_cohort_applications application
        WHERE application.privacy_policy_version NOT IN (
          '2026-07-12', '2026-07-14'
        )
      ) AS exact,
    (
      SELECT count(*)::bigint
      FROM public.research_cohort_applications application
      WHERE application.privacy_policy_version NOT IN (
        '2026-07-12', '2026-07-14'
      )
    ) AS invalid_rows
  FROM (SELECT to_regclass(
    'public.research_cohort_applications'
  ) AS oid) table_target
  LEFT JOIN pg_catalog.pg_class table_row
    ON table_row.oid = table_target.oid
  LEFT JOIN pg_catalog.pg_attribute column_row
    ON column_row.attrelid = table_row.oid
   AND column_row.attname = 'privacy_policy_version'
   AND column_row.attnum > 0 AND NOT column_row.attisdropped
  LEFT JOIN pg_catalog.pg_constraint constraint_row
    ON constraint_row.conrelid = table_row.oid
   AND constraint_row.conname =
     'research_cohort_applications_privacy_policy_check'
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
  'atomic_journey_rpc_contract_exact', coalesce((
    SELECT count(*) = 2 AND bool_and(exact)
    FROM function_status
    WHERE signature IN (
      'public.mutate_journey_schedule_event(uuid,text,jsonb,text,text)',
      'public.mutate_journey_budget_category(uuid,text,jsonb,text[],text)'
    )
  ), false),
  'vendor_catalog_lockdown_exact', coalesce((
    SELECT exact FROM vendor_catalog_lockdown_status
  ), false),
  'cohort_browser_lockdown_exact', coalesce((
    SELECT cohort_exact FROM disabled_browser_write_lockdown_status
  ), false),
  'journey_browser_write_lockdown_exact', coalesce((
    SELECT journey_exact FROM disabled_browser_write_lockdown_status
  ), false),
  'chat_browser_write_lockdown_exact', coalesce((
    SELECT chat_exact FROM disabled_browser_write_lockdown_status
  ), false),
  'community_browser_write_lockdown_exact', coalesce((
    SELECT community_exact FROM disabled_browser_write_lockdown_status
  ), false),
  'disabled_browser_write_lockdown_exact', coalesce((
    SELECT cohort_exact AND journey_exact AND chat_exact AND community_exact
    FROM disabled_browser_write_lockdown_status
  ), false),
  'raw_tracking_retirement_exact', coalesce((
    SELECT raw_tracking_retirement_exact FROM trusted_beta_surface_contract
  ), false),
  'profiles_direct_select_closure_exact', coalesce((
    SELECT profiles_direct_select_closure_exact
    FROM trusted_beta_surface_contract
  ), false),
  'community_media_retirement_exact', coalesce((
    SELECT community_media_retirement_exact
    FROM trusted_beta_surface_contract
  ), false),
  'congratulatory_money_retirement_exact', coalesce((
    SELECT congratulatory_money_retirement_exact
    FROM trusted_beta_surface_contract
  ), false),
  'community_text_only_boundary_exact', coalesce((
    SELECT community_text_only_boundary_exact
    FROM trusted_beta_surface_contract
  ), false),
  'community_user_mutes_exact', coalesce((
    SELECT community_user_mutes_exact FROM trusted_beta_surface_contract
  ), false),
  'community_comment_safety_exact', coalesce((
    SELECT community_comment_safety_exact FROM trusted_beta_surface_contract
  ), false),
  'community_opaque_actor_boundary_exact', coalesce((
    SELECT community_opaque_actor_boundary_exact
    FROM trusted_beta_surface_contract
  ), false),
  'community_post_lifecycle_exact', coalesce((
    SELECT community_post_lifecycle_exact FROM trusted_beta_surface_contract
  ), false),
  'research_consent_version_exact', coalesce((
    SELECT exact FROM research_consent_version_status
  ), false),
  'research_consent_version_invalid_rows', coalesce((
    SELECT invalid_rows FROM research_consent_version_status
  ), 0::bigint),
  'community_post_update_exact', coalesce((
    SELECT community_post_update_exact FROM trusted_beta_surface_contract
  ), false),
  'service_role_table_acl_exact', coalesce((
    SELECT exact FROM service_role_table_acl_status
  ), false),
  'preview_smoke_harness_exact', coalesce((
    SELECT exact FROM preview_smoke_harness_status
  ), false),
  'raw_customer_events_expired', (
    SELECT count(*) FROM public.customer_events
    WHERE created_at < now() - interval '90 days'
  ),
  'raw_search_logs_expired', (
    SELECT count(*) FROM public.search_logs
    WHERE created_at < now() - interval '90 days'
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
          'c'::"char", 'CHECK (privacy_policy_version = ANY (ARRAY[''2026-07-12''::text, ''2026-07-14''::text]))'),
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
    AND NOT has_table_privilege('service_role', 'public.research_cohort_applications', 'MAINTAIN')
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
    AND NOT has_table_privilege('anon', 'public.research_cohort_applications', 'MAINTAIN')
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
    AND NOT has_table_privilege('authenticated', 'public.research_cohort_applications', 'TRIGGER')
    AND NOT has_table_privilege('authenticated', 'public.research_cohort_applications', 'MAINTAIN'),
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
  )
  AND NOT has_table_privilege(
    'service_role', 'public.rate_limit_buckets', 'MAINTAIN'
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
