-- READ ONLY. Run after the exact 27-migration push and final hosted Storage
-- operation, before any application deploy or feature enablement. Every failure
-- is a hard stop.

BEGIN TRANSACTION READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $post_ledger$
DECLARE
  v_expected text[] := ARRAY[
    '20260716090000', '20260716091000', '20260716092000',
    '20260716093000', '20260716094000', '20260716095000',
    '20260716096000', '20260716097000', '20260716098000',
    '20260716099000', '20260716100000', '20260716102000',
    '20260716103000', '20260716104000', '20260716105000',
    '20260716106000', '20260716107000', '20260716108000',
    '20260716109000', '20260716110000', '20260716111000',
    '20260716112000', '20260716113000', '20260716114000',
    '20260716115000', '20260716116000', '20260716117000'
  ];
  v_head text;
  v_applied integer;
  v_unexpected integer;
BEGIN
  SELECT max(version::text)
    INTO v_head
    FROM supabase_migrations.schema_migrations;

  SELECT count(*)::integer
    INTO v_applied
    FROM supabase_migrations.schema_migrations
   WHERE version::text = ANY(v_expected);

  SELECT count(*)::integer
    INTO v_unexpected
    FROM supabase_migrations.schema_migrations
   WHERE version::text >= '20260716090000'
     AND version::text <= '20260716117000'
     AND NOT (version::text = ANY(v_expected));

  IF pg_catalog.cardinality(v_expected) <> 27
     OR v_head IS DISTINCT FROM '20260716117000'
     OR v_applied <> 27
     OR v_unexpected <> 0 THEN
    RAISE EXCEPTION 'POST_LEDGER_INVALID';
  END IF;
END;
$post_ledger$;

DO $post_core_relations$
BEGIN
  IF EXISTS (
    WITH required(relation_name, force_rls) AS (VALUES
      ('amora_memory_settings', false),
      ('amora_memory_consents', false),
      ('amora_memory_jobs', false),
      ('amora_mediation_acceptances', false),
      ('amora_care_scan_states', true),
      ('amora_care_jobs', true),
      ('amora_care_deliveries', true),
      ('amora_turn_requests', false),
      ('booking_projection_jobs', true),
      ('amora_conflict_check_claims', true),
      ('community_upload_sessions', true),
      ('account_deletion_jobs', true),
      ('account_deletion_media_manifest', true)
    )
    SELECT 1
      FROM required
      LEFT JOIN pg_catalog.pg_namespace AS namespace_record
        ON namespace_record.nspname = 'public'
      LEFT JOIN pg_catalog.pg_class AS relation_record
        ON relation_record.relnamespace = namespace_record.oid
       AND relation_record.relname = required.relation_name
     WHERE relation_record.oid IS NULL
        OR relation_record.relkind NOT IN ('r', 'p')
        OR NOT relation_record.relrowsecurity
        OR (required.force_rls AND NOT relation_record.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'POST_CORE_RELATION_RLS_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM (VALUES
        ('amora_memory_jobs'),
        ('amora_care_scan_states'),
        ('amora_care_jobs'),
        ('amora_care_deliveries'),
        ('amora_turn_requests'),
        ('booking_projection_jobs'),
        ('amora_conflict_check_claims'),
        ('community_upload_sessions'),
        ('account_deletion_jobs'),
        ('account_deletion_media_manifest')
      ) AS service_table(relation_name)
     WHERE pg_catalog.has_table_privilege(
       'anon', format('public.%I', service_table.relation_name), 'SELECT'
     )
        OR pg_catalog.has_table_privilege(
          'anon', format('public.%I', service_table.relation_name), 'INSERT'
        )
        OR pg_catalog.has_table_privilege(
          'anon', format('public.%I', service_table.relation_name), 'UPDATE'
        )
        OR pg_catalog.has_table_privilege(
          'anon', format('public.%I', service_table.relation_name), 'DELETE'
        )
        OR pg_catalog.has_table_privilege(
          'authenticated', format('public.%I', service_table.relation_name), 'SELECT'
        )
        OR pg_catalog.has_table_privilege(
          'authenticated', format('public.%I', service_table.relation_name), 'INSERT'
        )
        OR pg_catalog.has_table_privilege(
          'authenticated', format('public.%I', service_table.relation_name), 'UPDATE'
        )
        OR pg_catalog.has_table_privilege(
          'authenticated', format('public.%I', service_table.relation_name), 'DELETE'
        )
        OR NOT pg_catalog.has_table_privilege(
          'service_role', format('public.%I', service_table.relation_name), 'SELECT'
        )
        OR NOT pg_catalog.has_table_privilege(
          'service_role', format('public.%I', service_table.relation_name), 'INSERT'
        )
        OR NOT pg_catalog.has_table_privilege(
          'service_role', format('public.%I', service_table.relation_name), 'UPDATE'
        )
        OR NOT pg_catalog.has_table_privilege(
          'service_role', format('public.%I', service_table.relation_name), 'DELETE'
        )
  ) THEN
    RAISE EXCEPTION 'POST_CORE_RELATION_RLS_INVALID';
  END IF;
END;
$post_core_relations$;

DO $post_core_objects$
DECLARE
  procedure_record pg_catalog.pg_proc%ROWTYPE;
  signature text;
BEGIN
  FOR signature IN
    SELECT required.signature
      FROM (VALUES
        ('public.claim_amora_memory_job(integer,uuid)'),
        ('public.accept_amora_mediation(uuid,uuid,uuid,text,text,uuid,text)'),
        ('public.set_amora_care_consent(uuid,boolean)'),
        ('public.reserve_amora_provider_call(uuid,uuid,text,uuid,integer,integer,bigint,bigint)'),
        ('public.apply_journey_progress_item_patch(uuid,text,jsonb)'),
        ('public.claim_booking_projection_job(uuid,integer)'),
        ('public.claim_amora_conflict_check(uuid,text,uuid)'),
        ('public.patch_profile_atomic(uuid,text,text,boolean,boolean,boolean,text,boolean,boolean)'),
        ('public.finalize_amora_conflict_verify_receipt(uuid,uuid,uuid,text,uuid,jsonb,boolean,text,bigint,boolean,text,text,integer,integer,integer,jsonb)'),
        ('public.finalize_amora_chat_response(uuid,uuid,uuid,uuid,text,text,integer,text,jsonb,text,text,boolean,text,bigint,boolean,text,text,integer,integer,integer,jsonb)'),
        ('public.patch_wedding_settings_atomic(uuid,uuid,boolean,text,boolean,text,text,boolean,text,date,boolean,date,text,boolean,text,bigint,boolean,bigint)'),
        ('public.claim_community_upload_session(uuid,uuid,uuid,timestamp with time zone)'),
        ('public.complete_vendor_booking_outcome(uuid,uuid,numeric,numeric,integer,text,boolean)'),
        ('public.get_amora_tool_round_journal(uuid,text,integer)'),
        ('public.apply_amora_atomic_tool_execution(uuid,text,text,integer,text,jsonb,jsonb,jsonb)'),
        ('public.begin_account_deletion_job(uuid,text)'),
        ('public.is_current_couple_member(uuid,uuid)'),
        ('public.check_rate_limit(text,integer,integer)'),
        ('public.redact_old_ai_interactions(interval)')
      ) AS required(signature)
  LOOP
    SELECT *
      INTO procedure_record
      FROM pg_catalog.pg_proc
     WHERE oid = pg_catalog.to_regprocedure(signature);

    IF NOT FOUND
       OR procedure_record.prokind <> 'f'
       OR NOT procedure_record.prosecdef
       OR pg_catalog.pg_get_userbyid(procedure_record.proowner) <> 'postgres'
       OR pg_catalog.has_function_privilege(
         'anon', procedure_record.oid, 'EXECUTE'
       )
       OR pg_catalog.has_function_privilege(
         'authenticated', procedure_record.oid, 'EXECUTE'
       )
       OR NOT pg_catalog.has_function_privilege(
         'service_role', procedure_record.oid, 'EXECUTE'
       )
       OR EXISTS (
         SELECT 1
           FROM pg_catalog.aclexplode(COALESCE(
             procedure_record.proacl,
             pg_catalog.acldefault('f', procedure_record.proowner)
           )) AS acl_entry
          WHERE acl_entry.grantee = 0
            AND acl_entry.privilege_type = 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'POST_CORE_OBJECT_INVALID';
    END IF;
  END LOOP;
END;
$post_core_objects$;

DO $post_storage_1080$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'storage'
      AND relation.relname = 'objects'
      AND relation.relkind = 'r'
      AND relation.relrowsecurity
      AND NOT relation.relforcerowsecurity
      AND pg_catalog.pg_get_userbyid(relation.relowner) = 'supabase_storage_admin'
  ) OR pg_catalog.to_regprocedure('extensions.digest(text,text)') IS NULL THEN
    RAISE EXCEPTION 'POST_1080_STORAGE_CONTRACT_INVALID';
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.production_storage_writes_allowed()'
     ) IS NULL
     OR public.production_storage_writes_allowed() THEN
    RAISE EXCEPTION 'POST_1080_STORAGE_CONTRACT_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      (
        'public.account_deletion_storage_writes_allowed()',
        '0b785a6700c258851930b44d1502a2c595de5e7e3d19e10183dfe2d25c454930'
      ),
      (
        'public.production_storage_writes_allowed()',
        '2d68394af998108f9f35441e53d3ec1dfcde0f5f450e736aa78bd55efae50316'
      ),
      (
        'public.is_current_couple_path_member(text)',
        '72019e8324f0d8e014f06fbdb6e4dfb4dffa80254a58c421b11631d85dff4e5e'
      )
    ) AS expected(signature, body_sha256)
    LEFT JOIN pg_catalog.pg_proc AS procedure_record
      ON procedure_record.oid = pg_catalog.to_regprocedure(expected.signature)
    WHERE procedure_record.oid IS NULL
       OR pg_catalog.encode(extensions.digest(lower(pg_catalog.regexp_replace(
         procedure_record.prosrc, E'\\s+', '', 'g'
       )), 'sha256'), 'hex') IS DISTINCT FROM expected.body_sha256
  ) THEN
    RAISE EXCEPTION 'POST_1080_STORAGE_CONTRACT_INVALID';
  END IF;

  IF EXISTS (
    WITH expected(id, is_public, file_size_limit, allowed_mime_types, object_count) AS (
      VALUES
        ('chat-image'::text, false, 3 * 1024 * 1024,
          ARRAY['image/jpeg','image/png','image/gif','image/webp']::text[], 6::bigint),
        ('cohort-images', false, NULL::bigint, NULL::text[], 0::bigint),
        ('community-images', true, 10 * 1024 * 1024,
          ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']::text[], 43::bigint),
        ('community-videos', true, 50 * 1024 * 1024,
          ARRAY['video/mp4', 'video/quicktime', 'video/webm']::text[], 0::bigint),
        ('community-media-staging', false, 6 * 1024 * 1024,
          ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']::text[], 0::bigint),
        ('guestbook-images', false, NULL::bigint, NULL::text[], 0::bigint),
        ('guestbook-uploads', false, 5 * 1024 * 1024,
          ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']::text[], 0::bigint),
        ('invitation-photos', false, 10 * 1024 * 1024,
          ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']::text[], 0::bigint),
        ('user_photos', false, NULL::bigint, NULL::text[], 0::bigint),
        ('vendor-images', true, 5 * 1024 * 1024,
          ARRAY['image/jpeg', 'image/png', 'image/webp']::text[], 0::bigint),
        ('vendor-licenses', false, 10 * 1024 * 1024,
          ARRAY['image/jpeg', 'image/png', 'application/pdf']::text[], 0::bigint)
    ), actual AS (
      SELECT bucket.id, bucket.name, bucket.public, bucket.file_size_limit,
        bucket.allowed_mime_types, count(storage_object.id)::bigint AS object_count
      FROM storage.buckets AS bucket
      LEFT JOIN storage.objects AS storage_object ON storage_object.bucket_id = bucket.id
      GROUP BY bucket.id, bucket.name, bucket.public,
        bucket.file_size_limit, bucket.allowed_mime_types
    )
    SELECT 1
    FROM expected FULL JOIN actual USING (id)
    WHERE expected.id IS NULL OR actual.id IS NULL
       OR actual.name IS DISTINCT FROM expected.id
       OR actual.public IS DISTINCT FROM expected.is_public
       OR actual.file_size_limit IS DISTINCT FROM expected.file_size_limit
       OR actual.allowed_mime_types IS DISTINCT FROM expected.allowed_mime_types
       OR actual.object_count IS DISTINCT FROM expected.object_count
  ) THEN
    RAISE EXCEPTION 'POST_1080_STORAGE_CONTRACT_INVALID';
  END IF;

  IF EXISTS (
    -- Policy-name suffixes may be regenerated by the Dashboard. Pin the exact
    -- one-row semantic multiset instead of non-security display metadata.
    WITH expected(permissive, roles, cmd, expression_sha256) AS (
      VALUES
        ('PERMISSIVE', ARRAY['authenticated']::name[], 'INSERT', '7b9e967897a69bdc226f09e02a240db1ca64f0caeb58244912445ff0f5032482')
    ), actual AS (
      SELECT permissive::text, roles, cmd::text,
        pg_catalog.encode(extensions.digest(
          lower(pg_catalog.regexp_replace(
            COALESCE(qual, '') || E'\n' || COALESCE(with_check, ''),
            E'\\s+', '', 'g'
          )), 'sha256'
        ), 'hex') AS expression_sha256
      FROM pg_catalog.pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
    )
    (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
  ) THEN
    RAISE EXCEPTION 'POST_1080_STORAGE_CONTRACT_INVALID';
  END IF;
END;
$post_storage_1080$;

DO $post_database_1080$
DECLARE
  procedure_record pg_catalog.pg_proc%ROWTYPE;
BEGIN
  SELECT *
    INTO procedure_record
    FROM pg_catalog.pg_proc
   WHERE oid = pg_catalog.to_regprocedure(
     'public.claim_community_upload_session(uuid,uuid,uuid,timestamp with time zone)'
   );

  IF NOT FOUND
     OR NOT procedure_record.prosecdef
     OR pg_catalog.pg_get_userbyid(procedure_record.proowner) <> 'postgres'
     OR procedure_record.proconfig IS DISTINCT FROM
       ARRAY['search_path=""']::text[]
     OR pg_catalog.has_function_privilege(
       'anon', procedure_record.oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated', procedure_record.oid, 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'service_role', procedure_record.oid, 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'POST_1080_DATABASE_CONTRACT_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM (VALUES
        ('content_sha256'), ('sanitized_at'), ('token_cleanup_at'),
        ('attached_table'), ('attached_id'), ('attached_at'),
        ('final_deleted_at'), ('attachment_cleanup_token'),
        ('attachment_cleanup_started_at')
      ) AS required_column(column_name)
     WHERE NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_attribute
        WHERE attrelid = 'public.community_upload_sessions'::regclass
          AND attname = required_column.column_name
          AND attnum > 0
          AND NOT attisdropped
     )
  )
  OR EXISTS (
    SELECT 1
      FROM (VALUES
        ('community_upload_sessions_completion_state'),
        ('community_upload_sessions_attachment_state'),
        ('community_upload_sessions_cleanup_claim_state')
      ) AS required_constraint(constraint_name)
     WHERE NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.community_upload_sessions'::regclass
          AND conname = required_constraint.constraint_name
          AND convalidated
     )
  ) THEN
    RAISE EXCEPTION 'POST_1080_DATABASE_CONTRACT_INVALID';
  END IF;
END;
$post_database_1080$;

DO $post_lifecycle_1110$
DECLARE
  procedure_record pg_catalog.pg_proc%ROWTYPE;
  signature text;
  expected_service_execute boolean;
BEGIN
  IF EXISTS (
    SELECT 1
      FROM (VALUES
        ('content_sha256', 'text'),
        ('sanitized_at', 'timestamp with time zone'),
        ('token_cleanup_at', 'timestamp with time zone'),
        ('attached_table', 'text'),
        ('attached_id', 'uuid'),
        ('attached_at', 'timestamp with time zone'),
        ('final_deleted_at', 'timestamp with time zone'),
        ('attachment_cleanup_token', 'uuid'),
        ('attachment_cleanup_started_at', 'timestamp with time zone')
      ) AS required_column(column_name, data_type)
     WHERE NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_attribute AS attribute
        WHERE attribute.attrelid = 'public.community_upload_sessions'::regclass
          AND attribute.attname = required_column.column_name
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
          AND NOT attribute.attnotnull
          AND pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
            = required_column.data_type
     )
  ) OR EXISTS (
    SELECT 1
      FROM (VALUES
        ('community_upload_sessions_completion_state'),
        ('community_upload_sessions_attachment_state'),
        ('community_upload_sessions_cleanup_claim_state')
      ) AS required_constraint(constraint_name)
     WHERE NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_constraint AS constraint_record
        WHERE constraint_record.conrelid =
          'public.community_upload_sessions'::regclass
          AND constraint_record.conname = required_constraint.constraint_name
          AND constraint_record.contype = 'c'
          AND constraint_record.convalidated
     )
  ) OR EXISTS (
    SELECT 1
      FROM (VALUES
        (
          'community_upload_sessions_token_cleanup_idx',
          ARRAY['expires_at']::text[],
          '(token_cleanup_at IS NULL)'::text
        ),
        (
          'community_upload_sessions_unattached_cleanup_idx',
          ARRAY['status', 'completed_at', 'updated_at']::text[],
          NULL::text
        ),
        (
          'community_upload_sessions_attachment_idx',
          ARRAY['attached_table', 'attached_id']::text[],
          '(attached_at IS NOT NULL)'::text
        )
      ) AS required_index(index_name, key_columns, exact_simple_predicate)
     WHERE NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_index AS index_record
        WHERE index_record.indexrelid = pg_catalog.to_regclass(format(
          'public.%I', required_index.index_name
        ))
          AND index_record.indrelid = 'public.community_upload_sessions'::regclass
          AND index_record.indisvalid
          AND index_record.indisready
          AND NOT index_record.indisunique
          AND ARRAY(
            SELECT attribute.attname::text
              FROM unnest(index_record.indkey::smallint[]) WITH ORDINALITY
                AS index_key(attnum, ordinal)
              JOIN pg_catalog.pg_attribute AS attribute
                ON attribute.attrelid = index_record.indrelid
               AND attribute.attnum = index_key.attnum
             WHERE index_key.ordinal <= index_record.indnkeyatts
             ORDER BY index_key.ordinal
          ) = required_index.key_columns
          AND (
            required_index.exact_simple_predicate IS NULL
            OR pg_catalog.pg_get_expr(
              index_record.indpred, index_record.indrelid
            ) = required_index.exact_simple_predicate
          )
     )
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_index AS index_record
     WHERE index_record.indexrelid = pg_catalog.to_regclass(
       'public.community_upload_sessions_unattached_cleanup_idx'
     )
       AND pg_catalog.pg_get_expr(index_record.indpred, index_record.indrelid)
         ~ $$^\(\(status = ANY \(ARRAY\['completed'::text, 'rejected'::text, 'expired'::text\]\)\) AND \(attached_at IS NULL\) AND \(final_deleted_at IS NULL\)\)$$
  ) THEN
    RAISE EXCEPTION 'POST_1110_LIFECYCLE_CONTRACT_INVALID';
  END IF;

  FOR signature, expected_service_execute IN
    SELECT required.signature, required.service_execute
      FROM (VALUES
        ('public.reconcile_community_upload_target(text,uuid,uuid,text)', false),
        ('public.reconcile_community_post_uploads(uuid)', false),
        ('public.community_upload_post_attachment_trigger()', false),
        ('public.community_upload_poll_option_attachment_trigger()', false),
        ('public.community_upload_poll_attachment_trigger()', false),
        ('public.community_upload_cohort_attachment_trigger()', false),
        ('public.checkpoint_community_upload_token_cleanup(uuid,text)', true),
        ('public.claim_unattached_community_upload_sessions(uuid,timestamp with time zone,timestamp with time zone,integer)', true),
        ('public.finalize_unattached_community_upload_cleanup(uuid,uuid)', true)
      ) AS required(signature, service_execute)
  LOOP
    SELECT * INTO procedure_record
      FROM pg_catalog.pg_proc
     WHERE oid = pg_catalog.to_regprocedure(signature);

    IF NOT FOUND
       OR procedure_record.prokind <> 'f'
       OR NOT procedure_record.prosecdef
       OR pg_catalog.pg_get_userbyid(procedure_record.proowner) <> 'postgres'
       OR procedure_record.proconfig IS DISTINCT FROM
         ARRAY['search_path=""']::text[]
       OR pg_catalog.has_function_privilege(
         'anon', procedure_record.oid, 'EXECUTE'
       )
       OR pg_catalog.has_function_privilege(
         'authenticated', procedure_record.oid, 'EXECUTE'
       )
       OR pg_catalog.has_function_privilege(
         'service_role', procedure_record.oid, 'EXECUTE'
       ) IS DISTINCT FROM expected_service_execute
       OR EXISTS (
         SELECT 1
           FROM pg_catalog.aclexplode(COALESCE(
             procedure_record.proacl,
             pg_catalog.acldefault('f', procedure_record.proowner)
           )) AS acl_entry
          WHERE acl_entry.grantee = 0
            AND acl_entry.privilege_type = 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'POST_1110_LIFECYCLE_CONTRACT_INVALID';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM (VALUES
        (
          'community_posts', 'community_upload_post_attachment',
          'public.community_upload_post_attachment_trigger()',
          'CREATE TRIGGER community_upload_post_attachment AFTER INSERT OR DELETE OR UPDATE OF author_id, content, images, slides ON public.community_posts FOR EACH ROW EXECUTE FUNCTION community_upload_post_attachment_trigger()'
        ),
        (
          'community_poll_options', 'community_upload_poll_option_attachment',
          'public.community_upload_poll_option_attachment_trigger()',
          'CREATE TRIGGER community_upload_poll_option_attachment AFTER INSERT OR DELETE OR UPDATE OF image_url ON public.community_poll_options FOR EACH ROW EXECUTE FUNCTION community_upload_poll_option_attachment_trigger()'
        ),
        (
          'community_polls', 'community_upload_poll_attachment',
          'public.community_upload_poll_attachment_trigger()',
          'CREATE TRIGGER community_upload_poll_attachment AFTER DELETE OR UPDATE OF post_id ON public.community_polls FOR EACH ROW EXECUTE FUNCTION community_upload_poll_attachment_trigger()'
        ),
        (
          'cohort_messages', 'community_upload_cohort_attachment',
          'public.community_upload_cohort_attachment_trigger()',
          'CREATE TRIGGER community_upload_cohort_attachment AFTER INSERT OR DELETE OR UPDATE OF author_id, content, images, is_deleted ON public.cohort_messages FOR EACH ROW EXECUTE FUNCTION community_upload_cohort_attachment_trigger()'
        )
      ) AS required_trigger(
        table_name, trigger_name, function_signature, trigger_definition
      )
     WHERE NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_trigger AS trigger_record
        WHERE trigger_record.tgrelid = format(
          'public.%I', required_trigger.table_name
        )::regclass
          AND trigger_record.tgname = required_trigger.trigger_name
          AND NOT trigger_record.tgisinternal
          AND trigger_record.tgenabled IN ('O', 'A')
          AND trigger_record.tgfoid = pg_catalog.to_regprocedure(
            required_trigger.function_signature
          )
          AND pg_catalog.pg_get_triggerdef(trigger_record.oid, false)
            = required_trigger.trigger_definition
     )
  ) OR EXISTS (
    SELECT 1
      FROM public.community_upload_sessions AS session
     WHERE (
       session.status = 'completed'
       AND (
         session.completed_at IS NULL
         OR session.sanitized_at IS NULL
         OR session.actual_size IS NULL
         OR session.actual_size <= 0
         OR session.actual_size > 6 * 1024 * 1024
         OR session.actual_mime_type IS DISTINCT FROM session.declared_mime_type
         OR session.content_sha256 IS NULL
         OR session.content_sha256 !~ '^[0-9a-f]{64}$'
         OR session.staging_deleted_at IS NULL
         OR session.final_deleted_at IS NOT NULL
       )
     ) OR (
       (session.attached_table IS NULL) <> (session.attached_id IS NULL)
       OR (session.attached_table IS NULL) <> (session.attached_at IS NULL)
     ) OR (
       (session.attachment_cleanup_token IS NULL)
         <> (session.attachment_cleanup_started_at IS NULL)
     ) OR (
       session.token_cleanup_at IS NULL
       AND session.expires_at + interval '5 minutes' <= pg_catalog.clock_timestamp()
     ) OR (
       session.attachment_cleanup_token IS NOT NULL
       AND session.attachment_cleanup_started_at <=
         pg_catalog.clock_timestamp() - interval '15 minutes'
     )
  ) THEN
    RAISE EXCEPTION 'POST_1110_LIFECYCLE_CONTRACT_INVALID';
  END IF;
END;
$post_lifecycle_1110$;

DO $post_deletion_1130$
DECLARE
  procedure_record pg_catalog.pg_proc%ROWTYPE;
  signature text;
BEGIN
  FOR signature IN
    SELECT required.signature
      FROM (VALUES
        ('public.begin_account_deletion_job(uuid,text)'),
        ('public.claim_account_deletion_job(uuid,uuid,timestamp with time zone)'),
        ('public.replace_account_deletion_media_manifest(uuid,uuid,jsonb)'),
        ('public.release_account_deletion_job(uuid,uuid,text)'),
        ('public.mark_account_deletion_manual_review(uuid,uuid,text)'),
        ('public.resume_account_deletion_after_manual_review(uuid)'),
        ('public.checkpoint_account_deletion_media(uuid,uuid,text,text)'),
        ('public.prepare_account_deletion_auth_delete(uuid,uuid)'),
        ('public.finalize_account_deletion_job(uuid,uuid)')
      ) AS required(signature)
  LOOP
    SELECT *
      INTO procedure_record
      FROM pg_catalog.pg_proc
     WHERE oid = pg_catalog.to_regprocedure(signature);

    IF NOT FOUND
       OR NOT procedure_record.prosecdef
       OR pg_catalog.pg_get_userbyid(procedure_record.proowner) <> 'postgres'
       OR procedure_record.proconfig IS DISTINCT FROM
         ARRAY['search_path=""']::text[]
       OR pg_catalog.has_function_privilege(
         'anon', procedure_record.oid, 'EXECUTE'
       )
       OR pg_catalog.has_function_privilege(
         'authenticated', procedure_record.oid, 'EXECUTE'
       )
       OR NOT pg_catalog.has_function_privilege(
         'service_role', procedure_record.oid, 'EXECUTE'
       )
       OR (
         SELECT pg_catalog.array_agg(
           DISTINCT pg_catalog.pg_get_userbyid(acl_entry.grantee)
           ORDER BY pg_catalog.pg_get_userbyid(acl_entry.grantee)
         )
           FROM pg_catalog.aclexplode(COALESCE(
             procedure_record.proacl,
             pg_catalog.acldefault('f', procedure_record.proowner)
           )) AS acl_entry
          WHERE acl_entry.privilege_type = 'EXECUTE'
       ) IS DISTINCT FROM ARRAY['postgres', 'service_role']::name[]
       OR EXISTS (
         SELECT 1
           FROM pg_catalog.aclexplode(COALESCE(
             procedure_record.proacl,
             pg_catalog.acldefault('f', procedure_record.proowner)
           )) AS acl_entry
          WHERE acl_entry.privilege_type = 'EXECUTE'
            AND pg_catalog.pg_get_userbyid(acl_entry.grantee) = 'service_role'
            AND acl_entry.is_grantable
       )
       OR EXISTS (
         SELECT 1
           FROM pg_catalog.aclexplode(COALESCE(
             procedure_record.proacl,
             pg_catalog.acldefault('f', procedure_record.proowner)
           )) AS acl_entry
          WHERE acl_entry.grantee = 0
            AND acl_entry.privilege_type = 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'POST_1130_DELETION_CONTRACT_INVALID';
    END IF;
  END LOOP;

  FOR signature IN
    SELECT required.signature
      FROM (VALUES
        ('public.account_deletion_storage_writes_allowed()'),
        ('public.production_storage_writes_allowed()')
      ) AS required(signature)
  LOOP
    SELECT *
      INTO procedure_record
      FROM pg_catalog.pg_proc
     WHERE oid = pg_catalog.to_regprocedure(signature);

    IF NOT FOUND
       OR pg_catalog.pg_get_userbyid(procedure_record.proowner) <> 'postgres'
       OR (
         SELECT pg_catalog.array_agg(
           DISTINCT pg_catalog.pg_get_userbyid(acl_entry.grantee)
           ORDER BY pg_catalog.pg_get_userbyid(acl_entry.grantee)
         )
           FROM pg_catalog.aclexplode(COALESCE(
             procedure_record.proacl,
             pg_catalog.acldefault('f', procedure_record.proowner)
           )) AS acl_entry
          WHERE acl_entry.privilege_type = 'EXECUTE'
       ) IS DISTINCT FROM ARRAY['authenticated', 'postgres']::name[]
       OR EXISTS (
         SELECT 1
           FROM pg_catalog.aclexplode(COALESCE(
             procedure_record.proacl,
             pg_catalog.acldefault('f', procedure_record.proowner)
           )) AS acl_entry
          WHERE acl_entry.privilege_type = 'EXECUTE'
            AND pg_catalog.pg_get_userbyid(acl_entry.grantee) = 'authenticated'
            AND acl_entry.is_grantable
       ) THEN
      RAISE EXCEPTION 'POST_1130_DELETION_CONTRACT_INVALID';
    END IF;
  END LOOP;

  SELECT *
    INTO procedure_record
    FROM pg_catalog.pg_proc
   WHERE oid = pg_catalog.to_regprocedure(
     'public.prepare_account_deletion_auth_delete(uuid,uuid)'
   );
  IF NOT FOUND
     OR position(
       'FROM public.vendors AS vendor' IN procedure_record.prosrc
     ) = 0
     OR position(
       'vendor.owner_id = job.user_id' IN procedure_record.prosrc
     ) = 0 THEN
    RAISE EXCEPTION 'POST_1130_DELETION_CONTRACT_INVALID';
  END IF;

  SELECT *
    INTO procedure_record
    FROM pg_catalog.pg_proc
   WHERE oid = pg_catalog.to_regprocedure(
     'public.account_deletion_storage_writes_allowed()'
   );

  IF NOT FOUND
     OR procedure_record.prokind <> 'f'
     OR NOT procedure_record.prosecdef
     OR procedure_record.provolatile <> 'v'
     OR pg_catalog.pg_get_userbyid(procedure_record.proowner) <> 'postgres'
     OR procedure_record.proconfig IS DISTINCT FROM ARRAY[
       'search_path=""', 'lock_timeout=5s', 'statement_timeout=10s'
     ]::text[]
     OR pg_catalog.has_function_privilege(
       'anon', procedure_record.oid, 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'authenticated', procedure_record.oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role', procedure_record.oid, 'EXECUTE'
     )
     OR position('pg_advisory_xact_lock' IN procedure_record.prosrc) = 0
     OR position('hashtextextended(v_user_id::text, 0)' IN procedure_record.prosrc) = 0
     OR position('job.status <> ''completed''' IN procedure_record.prosrc) = 0
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.aclexplode(COALESCE(
           procedure_record.proacl,
           pg_catalog.acldefault('f', procedure_record.proowner)
         )) AS acl_entry
        WHERE acl_entry.grantee = 0
          AND acl_entry.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'POST_1130_DELETION_CONTRACT_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM (VALUES
        ('account_deletion_jobs_status'),
        ('account_deletion_jobs_reason'),
        ('account_deletion_jobs_quarantine'),
        ('account_deletion_jobs_error_code'),
        ('account_deletion_jobs_claim_state'),
        ('account_deletion_jobs_identity_state'),
        ('account_deletion_media_bucket'),
        ('account_deletion_media_source'),
        ('account_deletion_media_path_shape'),
        ('account_deletion_media_quarantine_state'),
        ('account_deletion_media_chat_quarantine_only')
      ) AS required_constraint(constraint_name)
     WHERE NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conname = required_constraint.constraint_name
          AND convalidated
          AND conrelid IN (
            'public.account_deletion_jobs'::regclass,
            'public.account_deletion_media_manifest'::regclass
          )
     )
  )
  OR EXISTS (
    SELECT 1
      FROM public.account_deletion_jobs
     WHERE status = 'completed'
       AND (
         user_id IS NOT NULL
         OR reason IS NOT NULL
         OR completed_at IS NULL
         OR auth_deleted_at IS NULL
       )
  )
  OR EXISTS (
    SELECT 1
      FROM public.account_deletion_media_manifest AS manifest
      LEFT JOIN public.account_deletion_jobs AS job ON job.id = manifest.job_id
     WHERE job.id IS NULL
  ) THEN
    RAISE EXCEPTION 'POST_1130_DELETION_CONTRACT_INVALID';
  END IF;
END;
$post_deletion_1130$;

DO $post_membership_1140_data$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.couples AS couple
      LEFT JOIN public.profiles AS bride ON bride.id = couple.bride_id
      LEFT JOIN public.profiles AS groom ON groom.id = couple.groom_id
     WHERE (couple.bride_id IS NOT NULL
       AND (
         bride.couple_id IS DISTINCT FROM couple.id
         OR bride.role IS DISTINCT FROM 'bride'
       ))
        OR (couple.groom_id IS NOT NULL
       AND (
         groom.couple_id IS DISTINCT FROM couple.id
         OR groom.role IS DISTINCT FROM 'groom'
       ))
  )
  OR EXISTS (
    SELECT 1
      FROM public.profiles AS profile
      LEFT JOIN public.couples AS couple ON couple.id = profile.couple_id
     WHERE profile.couple_id IS NOT NULL
       AND NOT (
         (
           profile.role IS NOT DISTINCT FROM 'bride'
           AND couple.bride_id IS NOT DISTINCT FROM profile.id
         )
         OR (
           profile.role IS NOT DISTINCT FROM 'groom'
           AND couple.groom_id IS NOT DISTINCT FROM profile.id
         )
       )
  )
  OR EXISTS (
    WITH slots AS (
      SELECT bride_id AS user_id FROM public.couples WHERE bride_id IS NOT NULL
      UNION ALL
      SELECT groom_id AS user_id FROM public.couples WHERE groom_id IS NOT NULL
    )
    SELECT 1 FROM slots GROUP BY user_id HAVING count(*) > 1
  )
  OR EXISTS (
    SELECT 1 FROM public.couples
     WHERE bride_id IS NOT NULL AND bride_id = groom_id
  )
  OR EXISTS (
    SELECT 1 FROM public.couples
     WHERE bride_id IS NULL
       AND groom_id IS NULL
       AND membership_sealed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'POST_1140_DATA_INVALID';
  END IF;
END;
$post_membership_1140_data$;

DO $post_membership_1140_structure$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_index AS index_record
      JOIN pg_catalog.pg_attribute AS attribute
        ON attribute.attrelid = index_record.indrelid
       AND attribute.attnum = index_record.indkey[0]
     WHERE index_record.indexrelid =
       'public.couples_bride_id_current_unique_idx'::regclass
       AND index_record.indrelid = 'public.couples'::regclass
       AND index_record.indisunique
       AND index_record.indisvalid
       AND index_record.indnkeyatts = 1
       AND attribute.attname = 'bride_id'
       AND pg_catalog.pg_get_expr(index_record.indpred, index_record.indrelid)
         = '(bride_id IS NOT NULL)'
  )
  OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_index AS index_record
      JOIN pg_catalog.pg_attribute AS attribute
        ON attribute.attrelid = index_record.indrelid
       AND attribute.attnum = index_record.indkey[0]
     WHERE index_record.indexrelid =
       'public.couples_groom_id_current_unique_idx'::regclass
       AND index_record.indrelid = 'public.couples'::regclass
       AND index_record.indisunique
       AND index_record.indisvalid
       AND index_record.indnkeyatts = 1
       AND attribute.attname = 'groom_id'
       AND pg_catalog.pg_get_expr(index_record.indpred, index_record.indrelid)
         = '(groom_id IS NOT NULL)'
  )
  OR NOT pg_catalog.has_function_privilege(
    'authenticated', 'public.is_couple_member(uuid)', 'EXECUTE'
  )
  OR NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.can_access_couple_visibility(uuid,text)',
    'EXECUTE'
  )
  OR NOT pg_catalog.has_function_privilege(
    'authenticated', 'public.can_read_profile(uuid)', 'EXECUTE'
  )
  OR NOT pg_catalog.has_function_privilege(
    'authenticated', 'public.is_current_couple_path_member(text)', 'EXECUTE'
  )
  OR pg_catalog.has_function_privilege(
    'anon', 'public.is_couple_member(uuid)', 'EXECUTE'
  )
  OR pg_catalog.has_function_privilege(
    'authenticated', 'public.is_current_couple_member(uuid,uuid)', 'EXECUTE'
  )
  OR NOT pg_catalog.has_function_privilege(
    'service_role', 'public.is_current_couple_member(uuid,uuid)', 'EXECUTE'
  )
  OR EXISTS (
    SELECT 1
      FROM (VALUES
        ('couples', 'couples_select_own'),
        ('profiles', 'profiles_select_safe_related'),
        ('chat_messages', 'chat_select_with_privacy'),
        ('chat_messages', 'chat_messages_insert_own_user'),
        ('chat_summaries', 'chat_summaries_select_with_privacy'),
        ('decision_nodes', 'decision_nodes_select_with_privacy')
      ) AS required_policy(table_name, policy_name)
     WHERE NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_policies
        WHERE schemaname = 'public'
          AND tablename = required_policy.table_name
          AND policyname = required_policy.policy_name
     )
  )
  OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policies AS policy
     WHERE ('authenticated' = ANY(policy.roles) OR 'public' = ANY(policy.roles))
       AND lower(COALESCE(policy.qual, '') || ' ' || COALESCE(policy.with_check, ''))
         ~ '(bride_id|groom_id)'
       AND lower(COALESCE(policy.qual, '') || ' ' || COALESCE(policy.with_check, ''))
         ~ 'auth[.]uid'
  )
  OR EXISTS (
    SELECT 1
      FROM (VALUES
        ('couples', 'trg_guard_new_couple_membership', false),
        ('couples', 'trg_enforce_couple_roster_epoch', false),
        ('couples', 'trg_seal_ownerless_couple_membership_epoch', false),
        ('couples', 'trg_current_couple_row_integrity', true),
        ('profiles', 'trg_current_couple_profile_integrity', true)
      ) AS required_trigger(table_name, trigger_name, must_be_deferred)
     WHERE NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_trigger AS trigger_record
        WHERE trigger_record.tgrelid = format(
          'public.%I', required_trigger.table_name
        )::regclass
          AND trigger_record.tgname = required_trigger.trigger_name
          AND NOT trigger_record.tgisinternal
          AND trigger_record.tgenabled IN ('O', 'A')
          AND (
            NOT required_trigger.must_be_deferred
            OR (trigger_record.tgdeferrable AND trigger_record.tginitdeferred)
          )
     )
  ) THEN
    RAISE EXCEPTION 'POST_1140_STRUCTURE_INVALID';
  END IF;
END;
$post_membership_1140_structure$;

DO $post_membership_1140_helpers$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM (VALUES
        (
          'public.is_current_couple_member(uuid,uuid)',
          ARRAY['search_path=pg_catalog, public', 'statement_timeout=5s']::text[],
          false, true
        ),
        (
          'public.is_couple_member(uuid)',
          ARRAY['search_path=pg_catalog, public', 'statement_timeout=5s']::text[],
          true, true
        ),
        (
          'public.can_access_couple_visibility(uuid,text)',
          ARRAY['search_path=pg_catalog, public', 'statement_timeout=5s']::text[],
          true, true
        ),
        (
          'public.can_read_profile(uuid)',
          ARRAY['search_path=pg_catalog, public', 'statement_timeout=5s']::text[],
          true, true
        ),
        (
          'public.is_current_couple_path_member(text)',
          ARRAY['search_path=pg_catalog, public', 'statement_timeout=5s']::text[],
          true, true
        ),
        (
          'public.enforce_current_couple_membership_integrity()',
          ARRAY[
            'search_path=pg_catalog, public', 'lock_timeout=5s',
            'statement_timeout=15s'
          ]::text[],
          false, false
        ),
        (
          'public.seal_ownerless_couple_membership_epoch()',
          ARRAY['search_path=pg_catalog, public']::text[],
          false, false
        )
      ) AS helper(
        signature, expected_config, authenticated_execute, service_execute
      )
      LEFT JOIN pg_catalog.pg_proc AS procedure_record
        ON procedure_record.oid = pg_catalog.to_regprocedure(helper.signature)
     WHERE procedure_record.oid IS NULL
        OR procedure_record.prokind <> 'f'
        OR NOT procedure_record.prosecdef
        OR pg_catalog.pg_get_userbyid(procedure_record.proowner) <> 'postgres'
        OR procedure_record.proconfig IS DISTINCT FROM helper.expected_config
        OR pg_catalog.has_function_privilege(
          'anon', procedure_record.oid, 'EXECUTE'
        )
        OR pg_catalog.has_function_privilege(
          'authenticated', procedure_record.oid, 'EXECUTE'
        ) IS DISTINCT FROM helper.authenticated_execute
        OR pg_catalog.has_function_privilege(
          'service_role', procedure_record.oid, 'EXECUTE'
        ) IS DISTINCT FROM helper.service_execute
        OR EXISTS (
          SELECT 1
            FROM pg_catalog.aclexplode(COALESCE(
              procedure_record.proacl,
              pg_catalog.acldefault('f', procedure_record.proowner)
            )) AS acl_entry
           WHERE acl_entry.grantee = 0
             AND acl_entry.privilege_type = 'EXECUTE'
        )
  ) OR EXISTS (
    SELECT 1
      FROM (VALUES
        (
          'couples', 'trg_guard_new_couple_membership',
          'public.guard_new_couple_membership()',
          'CREATE TRIGGER trg_guard_new_couple_membership BEFORE INSERT OR UPDATE OF bride_id, groom_id ON public.couples FOR EACH ROW EXECUTE FUNCTION guard_new_couple_membership()',
          false
        ),
        (
          'couples', 'trg_enforce_couple_roster_epoch',
          'public.enforce_couple_roster_epoch()',
          'CREATE TRIGGER trg_enforce_couple_roster_epoch BEFORE INSERT OR UPDATE ON public.couples FOR EACH ROW EXECUTE FUNCTION enforce_couple_roster_epoch()',
          false
        ),
        (
          'couples', 'trg_delete_empty_couple_after_membership_change',
          'public.delete_empty_couple_after_membership_change()',
          'CREATE TRIGGER trg_delete_empty_couple_after_membership_change AFTER UPDATE OF bride_id, groom_id ON public.couples FOR EACH ROW WHEN (((new.bride_id IS NULL) AND (new.groom_id IS NULL))) EXECUTE FUNCTION delete_empty_couple_after_membership_change()',
          false
        ),
        (
          'couples', 'trg_reset_amora_memory_after_membership_change',
          'public.reset_amora_memory_after_membership_change()',
          'CREATE TRIGGER trg_reset_amora_memory_after_membership_change AFTER UPDATE OF bride_id, groom_id ON public.couples FOR EACH ROW WHEN (((old.bride_id IS DISTINCT FROM new.bride_id) OR (old.groom_id IS DISTINCT FROM new.groom_id))) EXECUTE FUNCTION reset_amora_memory_after_membership_change()',
          false
        ),
        (
          'couples', 'trg_reset_amora_mediation_after_membership_change',
          'public.reset_amora_mediation_after_membership_change()',
          'CREATE TRIGGER trg_reset_amora_mediation_after_membership_change AFTER UPDATE OF bride_id, groom_id ON public.couples FOR EACH ROW WHEN (((old.bride_id IS DISTINCT FROM new.bride_id) OR (old.groom_id IS DISTINCT FROM new.groom_id))) EXECUTE FUNCTION reset_amora_mediation_after_membership_change()',
          false
        ),
        (
          'couples', 'trg_seal_ownerless_couple_membership_epoch',
          'public.seal_ownerless_couple_membership_epoch()',
          'CREATE TRIGGER trg_seal_ownerless_couple_membership_epoch BEFORE UPDATE OF bride_id, groom_id ON public.couples FOR EACH ROW EXECUTE FUNCTION seal_ownerless_couple_membership_epoch()',
          false
        ),
        (
          'couples', 'trg_current_couple_row_integrity',
          'public.enforce_current_couple_membership_integrity()',
          'CREATE CONSTRAINT TRIGGER trg_current_couple_row_integrity AFTER INSERT OR DELETE OR UPDATE ON public.couples DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_current_couple_membership_integrity()',
          true
        ),
        (
          'profiles', 'trg_current_couple_profile_integrity',
          'public.enforce_current_couple_membership_integrity()',
          'CREATE CONSTRAINT TRIGGER trg_current_couple_profile_integrity AFTER INSERT OR DELETE OR UPDATE ON public.profiles DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_current_couple_membership_integrity()',
          true
        )
      ) AS required_trigger(
        table_name, trigger_name, function_signature, trigger_definition,
        must_be_deferred
      )
     WHERE NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_trigger AS trigger_record
        WHERE trigger_record.tgrelid = format(
          'public.%I', required_trigger.table_name
        )::regclass
          AND trigger_record.tgname = required_trigger.trigger_name
          AND NOT trigger_record.tgisinternal
          AND trigger_record.tgenabled IN ('O', 'A')
          AND trigger_record.tgfoid = pg_catalog.to_regprocedure(
            required_trigger.function_signature
          )
          AND pg_catalog.pg_get_triggerdef(trigger_record.oid, false)
            = required_trigger.trigger_definition
          AND (
            NOT required_trigger.must_be_deferred
            OR (trigger_record.tgdeferrable AND trigger_record.tginitdeferred)
          )
     )
  ) THEN
    RAISE EXCEPTION 'POST_1140_HELPER_CONTRACT_INVALID';
  END IF;
END;
$post_membership_1140_helpers$;

DO $post_membership_1140_policies$
BEGIN
  IF EXISTS (
    WITH expected(table_name, policy_name, contract_md5) AS (VALUES
      ('chat_messages', 'chat_messages_insert_own_user', '48c182459e66881b136652eabe7ee08c'),
      ('chat_messages', 'chat_select_with_privacy', 'fb023cd759a7743a3ce8b39622205f0d'),
      ('chat_summaries', 'chat_summaries_select_with_privacy', 'fb023cd759a7743a3ce8b39622205f0d'),
      ('couples', 'couples_select_own', '36ee69e97368f83068ca43593527a472'),
      ('decision_nodes', 'decision_nodes_select_with_privacy', 'fb023cd759a7743a3ce8b39622205f0d'),
      ('profiles', 'profiles_insert_own', 'bdea55417fe3838960614724cd523fe5'),
      ('profiles', 'profiles_select_safe_related', '395dd22058959cf8881abd6feb64746e'),
      ('profiles', 'profiles_update_own', '1375863c707138d0f78ec5ebff3322a2'),
      ('wedding_journeys', 'journeys_insert_couple', '0b4d8d411f50a3bb55f532785991f5fc'),
      ('wedding_journeys', 'journeys_select_couple', '91d3a3d0f1c29cbc1658641efc0c9129'),
      ('wedding_journeys', 'journeys_update_couple', 'b0faf9a8390f6406cadc6e36ed00d706')
    ), actual AS (
      SELECT policy.tablename::text AS table_name,
        policy.policyname::text AS policy_name,
        policy.roles,
        pg_catalog.md5(pg_catalog.concat_ws(
          pg_catalog.chr(31), policy.cmd,
          pg_catalog.array_to_string(policy.roles, ','),
          COALESCE(policy.qual, ''), COALESCE(policy.with_check, '')
        )) AS contract_md5
        FROM pg_catalog.pg_policies AS policy
       WHERE policy.schemaname = 'public'
         AND policy.tablename IN (
           'couples', 'profiles', 'wedding_journeys',
           'chat_messages', 'chat_summaries', 'decision_nodes'
         )
         AND (
           'authenticated' = ANY(policy.roles)
           OR 'public' = ANY(policy.roles)
         )
    )
    SELECT 1
      FROM expected
      FULL JOIN actual USING (table_name, policy_name)
     WHERE expected.table_name IS NULL
        OR actual.table_name IS NULL
        OR actual.roles IS DISTINCT FROM ARRAY['authenticated']::name[]
        OR actual.contract_md5 IS DISTINCT FROM expected.contract_md5
  ) THEN
    RAISE EXCEPTION 'POST_1140_POLICY_CONTRACT_INVALID';
  END IF;
END;
$post_membership_1140_policies$;

DO $post_pending_security_definer$
DECLARE
  signature text;
  procedure_record pg_catalog.pg_proc%ROWTYPE;
BEGIN
  FOR signature IN
    SELECT required.signature
      FROM (VALUES
        ('public.accept_amora_mediation(uuid,uuid,uuid,text,text,uuid,text)'),
        ('public.account_deletion_storage_writes_allowed()'),
        ('public.advance_amora_care_scan(date,uuid,uuid,uuid,integer,boolean,integer)'),
        ('public.apply_amora_atomic_tool_execution_v1(uuid,text,text,integer,text,jsonb,jsonb,jsonb)'),
        ('public.apply_amora_atomic_tool_execution(uuid,text,text,integer,text,jsonb,jsonb,jsonb)'),
        ('public.apply_booking_progress_projection(uuid,uuid,text,jsonb,text,numeric,bigint,uuid)'),
        ('public.apply_journey_progress_item_patch(uuid,text,jsonb)'),
        ('public.begin_account_deletion_job(uuid,text)'),
        ('public.bind_amora_mediation_proposal()'),
        ('public.can_access_couple_visibility(uuid,text)'),
        ('public.can_read_profile(uuid)'),
        ('public.check_rate_limit(text,integer,integer)'),
        ('public.checkpoint_account_deletion_media(uuid,uuid,text,text)'),
        ('public.checkpoint_amora_conflict_check(uuid,text,uuid,jsonb)'),
        ('public.checkpoint_community_upload_token_cleanup(uuid,text)'),
        ('public.claim_account_deletion_job(uuid,uuid,timestamptz)'),
        ('public.claim_amora_care_email_delivery_pre_delivery_policy(uuid,uuid)'),
        ('public.claim_amora_care_email_delivery(uuid,uuid)'),
        ('public.claim_amora_care_job(integer,uuid)'),
        ('public.claim_amora_care_scan(date,integer)'),
        ('public.claim_amora_chat_request(uuid,text,uuid,text,uuid)'),
        ('public.claim_amora_chat_request(uuid,text,uuid,text)'),
        ('public.claim_amora_conflict_check(uuid,text,uuid)'),
        ('public.claim_amora_memory_job(integer,uuid)'),
        ('public.claim_amora_tool_execution(uuid,text,text,text,text,integer,uuid,integer)'),
        ('public.claim_amora_tool_execution(uuid,text,text,text,text,integer,uuid)'),
        ('public.claim_amora_tool_execution(uuid,text,text,text,text,integer)'),
        ('public.claim_amora_tool_execution(uuid,text,text,text,text)'),
        ('public.claim_booking_projection_job(uuid,integer)'),
        ('public.claim_community_upload_session(uuid,uuid,uuid,timestamptz)'),
        ('public.claim_unattached_community_upload_sessions(uuid,timestamptz,timestamptz,integer)'),
        ('public.clear_amora_memory_scope(uuid,text,uuid)'),
        ('public.commit_amora_memory_job(uuid,integer,jsonb,text,integer,uuid,uuid)'),
        ('public.community_upload_cohort_attachment_trigger()'),
        ('public.community_upload_poll_attachment_trigger()'),
        ('public.community_upload_poll_option_attachment_trigger()'),
        ('public.community_upload_post_attachment_trigger()'),
        ('public.complete_amora_conflict_check(uuid,text,uuid,jsonb)'),
        ('public.complete_vendor_booking_outcome(uuid,uuid,numeric,numeric,integer,text,boolean)'),
        ('public.defer_amora_memory_job(uuid,integer,integer,text)'),
        ('public.delete_amora_memory_node(uuid,text,uuid,uuid)'),
        ('public.enforce_couple_roster_epoch()'),
        ('public.enforce_current_couple_membership_integrity()'),
        ('public.enqueue_amora_care_job_pre_delivery_policy(uuid,date,text,text,jsonb,text,text)'),
        ('public.enqueue_amora_care_job(uuid,date,text,text,jsonb,text,text)'),
        ('public.enqueue_amora_memory_job(uuid,uuid,text,uuid)'),
        ('public.enqueue_booking_projection_job()'),
        ('public.fail_amora_conflict_check(uuid,text,uuid,text)'),
        ('public.finalize_account_deletion_job(uuid,uuid)'),
        ('public.finalize_amora_chat_response(uuid,uuid,uuid,uuid,text,text,integer,text,jsonb,text,text,boolean,text,bigint,boolean,text,text,integer,integer,integer,jsonb)'),
        ('public.finalize_amora_conflict_verify_receipt(uuid,uuid,uuid,text,uuid,jsonb,boolean,text,bigint,boolean,text,text,integer,integer,integer,jsonb)'),
        ('public.finalize_amora_provider_call_receipt(uuid,uuid,boolean,text,bigint,boolean,text,text,integer,integer,integer,jsonb)'),
        ('public.finalize_amora_tool_round_receipt(uuid,uuid,uuid,text,integer,jsonb,boolean,text,bigint,boolean,text,text,integer,integer,integer,jsonb)'),
        ('public.finalize_unattached_community_upload_cleanup(uuid,uuid)'),
        ('public.finish_amora_care_email_delivery(uuid,uuid,boolean,text,text)'),
        ('public.finish_amora_care_job(uuid,uuid)'),
        ('public.finish_amora_memory_job(uuid,boolean,text,integer)'),
        ('public.finish_booking_projection_job(uuid,bigint,uuid,boolean,text,integer)'),
        ('public.get_amora_care_queue_stats(date)'),
        ('public.get_amora_tool_round_journal(uuid,text,integer)'),
        ('public.get_booking_projection_queue_stats()'),
        ('public.get_wedding_settings_snapshot(uuid)'),
        ('public.has_current_amora_memory_consent(uuid,text)'),
        ('public.insert_amora_care_message(uuid,text,jsonb)'),
        ('public.insert_amora_memory_summary(uuid,uuid,text,text,integer,uuid,uuid)'),
        ('public.is_couple_member(uuid)'),
        ('public.is_current_couple_member(uuid,uuid)'),
        ('public.is_current_couple_path_member(text)'),
        ('public.mark_account_deletion_manual_review(uuid,uuid,text)'),
        ('public.patch_profile_atomic(uuid,text,text,boolean,boolean,boolean,text,boolean,boolean)'),
        ('public.patch_wedding_settings_atomic(uuid,uuid,boolean,text,boolean,text,text,boolean,text,date,boolean,date,text,boolean,text,bigint,boolean,bigint)'),
        ('public.prepare_account_deletion_auth_delete(uuid,uuid)'),
        ('public.prepare_amora_care_job_pre_delivery_policy(uuid,uuid,boolean)'),
        ('public.prepare_amora_care_job(uuid,uuid,boolean)'),
        ('public.prepare_amora_provider_call_receipt(uuid,uuid,text,text,text,text,integer,text,text,jsonb)'),
        ('public.quarantine_amora_care_queue(text)'),
        ('public.reconcile_amora_chat_response(uuid,text,uuid,text,uuid)'),
        ('public.reconcile_community_upload_target(text,uuid,uuid,text)'),
        ('public.reconcile_community_post_uploads(uuid)'),
        ('public.redact_old_ai_interactions(interval)'),
        ('public.release_account_deletion_job(uuid,uuid,text)'),
        ('public.replace_account_deletion_media_manifest(uuid,uuid,jsonb)'),
        ('public.reserve_amora_provider_call(uuid,uuid,text,uuid,integer,integer,bigint,bigint)'),
        ('public.reserve_amora_turn(uuid,integer,integer,bigint,bigint)'),
        ('public.reserve_amora_turn(uuid,integer,integer)'),
        ('public.reset_amora_mediation_after_membership_change()'),
        ('public.reset_amora_memory_after_membership_change()'),
        ('public.resume_account_deletion_after_manual_review(uuid)'),
        ('public.retry_booking_projection_job(uuid)'),
        ('public.revoke_amora_mediation_acceptance(uuid,uuid,uuid)'),
        ('public.seal_ownerless_couple_membership_epoch()'),
        ('public.set_amora_care_consent(uuid,boolean)'),
        ('public.set_amora_memory_consent(uuid,text,uuid,boolean)'),
        ('public.update_amora_memory_node(uuid,text,uuid,uuid,text,text)'),
        ('public.upsert_amora_memory_node(uuid,text,text,text,text,text,text,numeric,text,uuid,jsonb)')
      ) AS required(signature)
  LOOP
    SELECT * INTO procedure_record
      FROM pg_catalog.pg_proc
     WHERE oid = pg_catalog.to_regprocedure(signature);

    IF NOT FOUND
       OR procedure_record.prokind <> 'f'
       OR NOT procedure_record.prosecdef
       OR pg_catalog.pg_get_userbyid(procedure_record.proowner) <> 'postgres'
       OR EXISTS (
         SELECT 1
           FROM pg_catalog.aclexplode(COALESCE(
             procedure_record.proacl,
             pg_catalog.acldefault('f', procedure_record.proowner)
           )) AS acl_entry
          WHERE acl_entry.grantee = 0
            AND acl_entry.privilege_type = 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'POST_PENDING_SECURITY_DEFINER_INVALID';
    END IF;
  END LOOP;
END;
$post_pending_security_definer$;

DO $post_rate_limit_1150$
DECLARE
  procedure_record pg_catalog.pg_proc%ROWTYPE;
BEGIN
  SELECT *
    INTO procedure_record
    FROM pg_catalog.pg_proc
   WHERE oid = pg_catalog.to_regprocedure(
     'public.check_rate_limit(text,integer,integer)'
   );

  IF NOT FOUND
     OR NOT procedure_record.prosecdef
     OR pg_catalog.pg_get_userbyid(procedure_record.proowner) <> 'postgres'
     OR NOT ('search_path=public' = ANY(COALESCE(
       procedure_record.proconfig, ARRAY[]::text[]
     )))
     OR NOT ('lock_timeout=5s' = ANY(COALESCE(
       procedure_record.proconfig, ARRAY[]::text[]
     )))
     OR NOT ('statement_timeout=10s' = ANY(COALESCE(
       procedure_record.proconfig, ARRAY[]::text[]
     )))
     OR position('LIMIT 128' IN procedure_record.prosrc) = 0
     OR position(
       '^[a-z][a-z0-9:_-]{0,127}:hmac-sha256:[0-9a-f]{64}$'
       IN procedure_record.prosrc
     ) = 0
     OR pg_catalog.has_function_privilege(
       'anon', procedure_record.oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated', procedure_record.oid, 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'service_role', procedure_record.oid, 'EXECUTE'
     )
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_index AS index_record
         JOIN pg_catalog.pg_attribute AS attribute
           ON attribute.attrelid = index_record.indrelid
          AND attribute.attnum = index_record.indkey[0]
        WHERE index_record.indexrelid =
          'public.rate_limit_buckets_reset_at_idx'::regclass
          AND index_record.indrelid = 'public.rate_limit_buckets'::regclass
          AND index_record.indisvalid
          AND attribute.attname = 'reset_at'
     )
     OR (
       SELECT count(*)
         FROM public.rate_limit_buckets
        WHERE reset_at <= pg_catalog.clock_timestamp()
     ) > 1000
     OR EXISTS (
       SELECT 1 FROM public.rate_limit_buckets WHERE key LIKE '%@%'
     ) THEN
    RAISE EXCEPTION 'POST_1150_CONTRACT_INVALID';
  END IF;
END;
$post_rate_limit_1150$;

DO $post_ai_retention_1160$
DECLARE
  procedure_record pg_catalog.pg_proc%ROWTYPE;
BEGIN
  SELECT *
    INTO procedure_record
    FROM pg_catalog.pg_proc
   WHERE oid = pg_catalog.to_regprocedure(
     'public.redact_old_ai_interactions(interval)'
   );

  IF NOT FOUND
     OR NOT procedure_record.prosecdef
     OR procedure_record.prokind <> 'f'
     OR procedure_record.provolatile <> 'v'
     OR procedure_record.pronargs <> 1
     OR procedure_record.pronargdefaults <> 1
     OR pg_catalog.pg_get_userbyid(procedure_record.proowner) <> 'postgres'
     OR procedure_record.proconfig IS DISTINCT FROM
       ARRAY['search_path=""']::text[]
     OR pg_catalog.pg_get_function_result(procedure_record.oid) <> 'integer'
     OR position(
       'UPDATE public.ai_interactions_log' IN procedure_record.prosrc
     ) = 0
     OR position(
       'pg_catalog.now() - interval ''90 days''' IN procedure_record.prosrc
     ) = 0
     OR position(
       'retention interval must be exactly 90 days' IN procedure_record.prosrc
     ) = 0
     OR position(
       'pg_catalog.jsonb_typeof(metadata) = ''object'''
       IN procedure_record.prosrc
     ) = 0
     OR position(
       'metadata->>''retention_policy'' IS DISTINCT FROM ''raw_payload_90d'''
       IN procedure_record.prosrc
     ) = 0
     OR position(
       'metadata->>''retention_redacted_at'' IS NULL'
       IN procedure_record.prosrc
     ) = 0
     OR position(
       'error_message <> ''[redacted_after_retention]'''
       IN procedure_record.prosrc
     ) = 0
     OR position('metadata - ARRAY[' IN procedure_record.prosrc) = 0
     OR position(
       '''cache_read_input_tokens''' IN procedure_record.prosrc
     ) = 0
     OR (
       SELECT pg_catalog.array_agg(
         DISTINCT pg_catalog.pg_get_userbyid(acl_entry.grantee)
         ORDER BY pg_catalog.pg_get_userbyid(acl_entry.grantee)
       )
       FROM pg_catalog.aclexplode(COALESCE(
         procedure_record.proacl,
         pg_catalog.acldefault('f', procedure_record.proowner)
       )) AS acl_entry
       WHERE acl_entry.privilege_type = 'EXECUTE'
     ) IS DISTINCT FROM ARRAY['postgres', 'service_role']::name[]
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.aclexplode(COALESCE(
         procedure_record.proacl,
         pg_catalog.acldefault('f', procedure_record.proowner)
       )) AS acl_entry
       WHERE acl_entry.privilege_type = 'EXECUTE'
         AND pg_catalog.pg_get_userbyid(acl_entry.grantee) = 'service_role'
         AND acl_entry.is_grantable
     )
     OR EXISTS (
       SELECT 1
         FROM public.ai_interactions_log
         WHERE metadata->>'retention_policy' = 'raw_payload_90d'
           AND (
             pg_catalog.jsonb_typeof(metadata) IS DISTINCT FROM 'object'
             OR
             (user_input IS NOT NULL
              AND user_input <> '[redacted_after_retention]')
            OR (ai_output IS NOT NULL
              AND ai_output <> '[redacted_after_retention]')
            OR tool_input IS NOT NULL
            OR tool_output IS NOT NULL
            OR (error_message IS NOT NULL
              AND error_message <> '[redacted_after_retention]')
            OR metadata->>'retention_redacted_at' IS NULL
            OR pg_catalog.jsonb_typeof(
              metadata->'retention_redacted_at'
            ) IS DISTINCT FROM 'string'
            OR metadata - ARRAY[
              'ledger_status', 'provider_attempted', 'usage_status',
              'unknown_paid_attempt', 'cache_creation_input_tokens',
              'cache_read_input_tokens', 'retention_redacted_at',
              'retention_policy'
            ]::text[] <> '{}'::jsonb
            OR CASE
              WHEN NOT (metadata ? 'ledger_status') THEN false
              WHEN pg_catalog.jsonb_typeof(metadata->'ledger_status')
                   IS DISTINCT FROM 'string' THEN true
              ELSE metadata->>'ledger_status' NOT IN (
                'prepared', 'reserved', 'released', 'settled',
                'unknown', 'finalized'
              )
            END
            OR CASE
              WHEN NOT (metadata ? 'provider_attempted') THEN false
              ELSE pg_catalog.jsonb_typeof(metadata->'provider_attempted')
                IS DISTINCT FROM 'boolean'
            END
            OR CASE
              WHEN NOT (metadata ? 'usage_status') THEN false
              WHEN pg_catalog.jsonb_typeof(metadata->'usage_status')
                   IS DISTINCT FROM 'string' THEN true
              ELSE metadata->>'usage_status' NOT IN ('complete', 'unknown')
            END
            OR CASE
              WHEN NOT (metadata ? 'unknown_paid_attempt') THEN false
              ELSE pg_catalog.jsonb_typeof(metadata->'unknown_paid_attempt')
                IS DISTINCT FROM 'boolean'
            END
            OR CASE
              WHEN NOT (metadata ? 'cache_creation_input_tokens') THEN false
              WHEN pg_catalog.jsonb_typeof(
                metadata->'cache_creation_input_tokens'
              ) IS DISTINCT FROM 'number' THEN true
              ELSE (metadata->>'cache_creation_input_tokens')::numeric
                NOT BETWEEN 0 AND 1000000000
            END
            OR CASE
              WHEN NOT (metadata ? 'cache_read_input_tokens') THEN false
              WHEN pg_catalog.jsonb_typeof(
                metadata->'cache_read_input_tokens'
              ) IS DISTINCT FROM 'number' THEN true
              ELSE (metadata->>'cache_read_input_tokens')::numeric
                NOT BETWEEN 0 AND 1000000000
            END
          )
     ) THEN
    RAISE EXCEPTION 'POST_1160_CONTRACT_INVALID';
  END IF;
END;
$post_ai_retention_1160$;

DO $post_auth_fk_1170$
DECLARE
  expected_names text[] := ARRAY[
    'ai_interactions_log_user_id_fkey',
    'amora_actions_created_by_fkey',
    'amora_mediation_acceptances_user_id_fkey',
    'amora_memory_consents_user_id_fkey',
    'amora_memory_jobs_user_id_fkey',
    'amora_memory_settings_enabled_by_fkey',
    'amora_quote_checks_user_id_fkey',
    'chat_messages_sender_id_fkey',
    'chat_summaries_user_id_delete_cascade_fkey',
    'cohort_contracts_user_id_fkey',
    'cohort_member_reports_reported_user_id_fkey',
    'cohort_member_reports_reporter_id_fkey',
    'cohort_members_user_id_fkey',
    'cohort_messages_author_id_fkey',
    'cohort_timeline_events_user_id_fkey',
    'community_achievements_user_id_fkey',
    'community_agent_personas_backing_user_id_fkey',
    'community_bookmarks_user_id_fkey',
    'community_comments_author_id_fkey',
    'community_poll_votes_user_id_fkey',
    'community_posts_author_id_fkey',
    'community_profiles_user_id_fkey',
    'community_reports_reporter_id_fkey',
    'community_streaks_user_id_fkey',
    'community_upload_sessions_user_id_fkey',
    'community_votes_user_id_fkey',
    'community_xp_log_user_id_fkey',
    'couples_bride_id_fkey',
    'couples_groom_id_fkey',
    'customer_events_user_id_fkey',
    'fitting_requests_user_id_fkey',
    'fitting_usage_user_id_fkey',
    'guestbooks_owner_id_fkey',
    'messages_sender_id_fkey',
    'profiles_id_fkey',
    'search_logs_user_id_fkey',
    'submission_verifications_user_id_fkey',
    'user_fitting_photos_user_id_fkey',
    'user_trust_scores_user_id_fkey',
    'vendor_bookings_receipt_verified_by_fkey',
    'vendor_favorites_user_id_fkey',
    'vendor_messages_customer_id_fkey',
    'vendor_photo_likes_user_id_fkey',
    'vendor_reports_reporter_id_fkey',
    'vendor_reviews_customer_id_fkey',
    'vendor_submissions_user_id_fkey',
    'vendor_views_viewer_id_fkey',
    'vendors_owner_id_fkey'
  ]::text[];
  set_null_names text[] := ARRAY[
    'ai_interactions_log_user_id_fkey',
    'amora_actions_created_by_fkey',
    'amora_memory_jobs_user_id_fkey',
    'amora_memory_settings_enabled_by_fkey',
    'amora_quote_checks_user_id_fkey',
    'chat_messages_sender_id_fkey',
    'community_agent_personas_backing_user_id_fkey',
    'couples_bride_id_fkey',
    'couples_groom_id_fkey',
    'customer_events_user_id_fkey',
    'messages_sender_id_fkey',
    'search_logs_user_id_fkey',
    'vendor_bookings_receipt_verified_by_fkey',
    'vendor_reviews_customer_id_fkey',
    'vendor_views_viewer_id_fkey'
  ]::text[];
  nullable_cascade_names text[] := ARRAY[
    'chat_summaries_user_id_delete_cascade_fkey',
    'submission_verifications_user_id_fkey',
    'vendor_reports_reporter_id_fkey',
    'vendor_submissions_user_id_fkey'
  ]::text[];
  total_auth_fk_count bigint;
  compliant_names text[];
BEGIN
  SELECT count(*)
    INTO total_auth_fk_count
    FROM pg_catalog.pg_constraint AS constraint_record
    JOIN pg_catalog.pg_class AS relation_record
      ON relation_record.oid = constraint_record.conrelid
    JOIN pg_catalog.pg_namespace AS namespace_record
      ON namespace_record.oid = relation_record.relnamespace
   WHERE constraint_record.contype = 'f'
     AND constraint_record.confrelid = 'auth.users'::regclass
     AND namespace_record.nspname = 'public';

  SELECT pg_catalog.array_agg(
           constraint_record.conname::text
           ORDER BY constraint_record.conname::text
         )
    INTO compliant_names
    FROM pg_catalog.pg_constraint AS constraint_record
    JOIN pg_catalog.pg_class AS relation_record
      ON relation_record.oid = constraint_record.conrelid
    JOIN pg_catalog.pg_namespace AS namespace_record
      ON namespace_record.oid = relation_record.relnamespace
    JOIN pg_catalog.pg_attribute AS column_record
      ON column_record.attrelid = constraint_record.conrelid
     AND constraint_record.conkey =
       ARRAY[column_record.attnum]::smallint[]
    JOIN pg_catalog.pg_attribute AS referenced_column
      ON referenced_column.attrelid = constraint_record.confrelid
     AND constraint_record.confkey =
       ARRAY[referenced_column.attnum]::smallint[]
   WHERE constraint_record.contype = 'f'
     AND constraint_record.confrelid = 'auth.users'::regclass
     AND namespace_record.nspname = 'public'
     AND referenced_column.attname = 'id'
     AND NOT referenced_column.attisdropped
     AND NOT column_record.attisdropped
     AND constraint_record.convalidated
     AND NOT constraint_record.condeferrable
     AND NOT constraint_record.condeferred
     AND constraint_record.confmatchtype = 's'
     AND constraint_record.confupdtype = 'a'
     AND constraint_record.conname = CASE
       WHEN relation_record.relname = 'chat_summaries'
        AND column_record.attname = 'user_id'
         THEN 'chat_summaries_user_id_delete_cascade_fkey'
       ELSE relation_record.relname || '_' || column_record.attname || '_fkey'
     END
     AND (
       (
         constraint_record.conname = ANY(set_null_names)
         AND constraint_record.confdeltype = 'n'
         AND NOT column_record.attnotnull
       )
       OR (
         constraint_record.conname = 'vendors_owner_id_fkey'
         AND constraint_record.confdeltype = 'r'
         AND NOT column_record.attnotnull
       )
       OR (
         constraint_record.conname = ANY(nullable_cascade_names)
         AND constraint_record.confdeltype = 'c'
         AND NOT column_record.attnotnull
       )
       OR (
         NOT (constraint_record.conname = ANY(set_null_names))
         AND constraint_record.conname <> 'vendors_owner_id_fkey'
         AND NOT (constraint_record.conname = ANY(nullable_cascade_names))
         AND constraint_record.confdeltype = 'c'
         AND column_record.attnotnull
       )
     );

  IF total_auth_fk_count <> pg_catalog.cardinality(expected_names)
     OR compliant_names IS DISTINCT FROM expected_names
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc AS procedure_record
       WHERE procedure_record.oid = pg_catalog.to_regprocedure(
         'public.prepare_account_deletion_auth_delete(uuid,uuid)'
       )
         AND procedure_record.prosecdef
         AND pg_catalog.pg_get_userbyid(procedure_record.proowner) = 'postgres'
         AND procedure_record.proconfig IS NOT DISTINCT FROM
           ARRAY['search_path=""']::text[]
         AND pg_catalog.md5(procedure_record.prosrc) =
           '02eb24e9ed4178f0034ac1cc36940775'
     ) THEN
    RAISE EXCEPTION 'POST_1170_AUTH_FK_CONTRACT_INVALID';
  END IF;
END;
$post_auth_fk_1170$;

SELECT
  true AS verified,
  1 AS post_release_contract_verified_count;
COMMIT;
