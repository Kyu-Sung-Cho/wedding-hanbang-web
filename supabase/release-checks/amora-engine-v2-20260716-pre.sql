-- READ ONLY. Run only after the pre-backup Storage write freeze and the verified
-- backup/restore rehearsal, immediately before the hash-pinned database push.
-- Every failure is a hard stop.

BEGIN TRANSACTION READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $pre_ledger$
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
BEGIN
  IF pg_catalog.cardinality(v_expected) <> 27 THEN
    RAISE EXCEPTION 'PRE_PENDING_SET_CARDINALITY_INVALID';
  END IF;

  SELECT max(version::text)
    INTO v_head
    FROM supabase_migrations.schema_migrations;

  IF v_head IS DISTINCT FROM '20260715210000' THEN
    RAISE EXCEPTION 'PRE_LEDGER_HEAD_MISMATCH';
  END IF;

  SELECT count(*)::integer
    INTO v_applied
    FROM supabase_migrations.schema_migrations
   WHERE version::text = ANY(v_expected);

  IF v_applied <> 0 THEN
    RAISE EXCEPTION 'PRE_PENDING_LEDGER_DIRTY';
  END IF;
END;
$pre_ledger$;

DO $pre_acl_hotfix$
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
    RAISE EXCEPTION 'PRE_AI_LOG_RETENTION_ACL_INVALID';
  END IF;
END;
$pre_acl_hotfix$;

DO $pre_auth_fk_1170$
DECLARE
  expected_names text[] := ARRAY[
    'ai_interactions_log_user_id_fkey',
    'amora_actions_created_by_fkey',
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
    'vendor_views_viewer_id_fkey',
    'vendors_owner_id_fkey'
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
         constraint_record.conname = ANY(nullable_cascade_names)
         AND constraint_record.confdeltype = 'c'
         AND NOT column_record.attnotnull
       )
       OR (
         NOT (constraint_record.conname = ANY(set_null_names))
         AND NOT (constraint_record.conname = ANY(nullable_cascade_names))
         AND constraint_record.confdeltype = 'c'
         AND column_record.attnotnull
       )
     );

  IF total_auth_fk_count <> pg_catalog.cardinality(expected_names)
     OR compliant_names IS DISTINCT FROM expected_names THEN
    RAISE EXCEPTION 'PRE_1170_AUTH_FK_CONTRACT_INVALID';
  END IF;
END;
$pre_auth_fk_1170$;

DO $pre_storage_1080$
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
    RAISE EXCEPTION 'PRE_1080_STORAGE_CONTRACT_INVALID';
  END IF;

  IF EXISTS (
    WITH expected(id, is_public, file_size_limit, allowed_mime_types, object_count) AS (
      VALUES
        ('chat-image'::text, false, NULL::bigint, NULL::text[], 6::bigint),
        ('cohort-images', true, NULL::bigint, NULL::text[], 0::bigint),
        ('community-images', true, 10 * 1024 * 1024,
          ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']::text[], 43::bigint),
        ('community-videos', true, 50 * 1024 * 1024,
          ARRAY['video/mp4', 'video/quicktime', 'video/webm']::text[], 0::bigint),
        ('guestbook-images', true, NULL::bigint, NULL::text[], 0::bigint),
        ('guestbook-uploads', true, 5 * 1024 * 1024,
          ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']::text[], 0::bigint),
        ('invitation-photos', true, 10 * 1024 * 1024,
          ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']::text[], 0::bigint),
        ('user_photos', true, NULL::bigint, NULL::text[], 0::bigint),
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
  ) OR EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'community-media-staging'
  ) OR (SELECT count(*) FROM storage.objects
         WHERE bucket_id = 'community-media-staging') <> 0 THEN
    RAISE EXCEPTION 'PRE_1080_STORAGE_CONTRACT_INVALID';
  END IF;

  IF EXISTS (
    WITH expected(policyname, permissive, roles, cmd, expression_sha256) AS (
      VALUES
        ('Anyone can view chat image', 'PERMISSIVE', ARRAY['public']::name[], 'SELECT', '11a6595c0534cd28fc75eace428725eb971ed106208189913fc328fafe4fed23'),
        ('Anyone can view chat images', 'PERMISSIVE', ARRAY['public']::name[], 'SELECT', '3e004f601bc171c755a6dad45c4abac266024ae16b050ac53005dee54c0a3ddb'),
        ('공개: 업체 이미지 조회', 'PERMISSIVE', ARRAY['public']::name[], 'SELECT', '58225493db8405746e0170ff05141dfc86d73e4445ece3fbe33473420e0d8033'),
        ('서비스: 사업자등록증 조회', 'PERMISSIVE', ARRAY['public']::name[], 'SELECT', '1beeec48bf3997f33f65db1f2076e1efab8d014d5fb0d1df59e1f3b7a4afe177')
    ), actual AS (
      SELECT policyname::text, permissive::text, roles, cmd::text,
        pg_catalog.encode(extensions.digest(
          lower(pg_catalog.regexp_replace(
            COALESCE(qual, '') || E'\n' || COALESCE(with_check, ''),
            E'\\s+', '', 'g'
          )), 'sha256'
        ), 'hex') AS expression_sha256
      FROM pg_catalog.pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
    )
    SELECT 1
    FROM expected FULL JOIN actual USING (policyname)
    WHERE expected.policyname IS NULL OR actual.policyname IS NULL
       OR actual.permissive IS DISTINCT FROM expected.permissive
       OR actual.roles IS DISTINCT FROM expected.roles
       OR actual.cmd IS DISTINCT FROM expected.cmd
       OR actual.expression_sha256 IS DISTINCT FROM expected.expression_sha256
  ) THEN
    RAISE EXCEPTION 'PRE_1080_STORAGE_CONTRACT_INVALID';
  END IF;
END;
$pre_storage_1080$;

DO $pre_data_shape$
DECLARE
  v_stale_bride_slots integer;
  v_stale_groom_slots integer;
  v_canonical_role_mismatches integer;
  v_reverse_link_mismatches integer;
  v_duplicate_users integer;
  v_same_user_both_roles integer;
  v_projected_ownerless integer;
  v_expired_rate_limits bigint;
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.chat_summaries
     WHERE to_message_id IS NOT NULL
     GROUP BY couple_id, visibility, to_message_id
    HAVING count(*) > 1
  )
  OR EXISTS (
    SELECT 1
      FROM public.wedding_journeys
     GROUP BY couple_id
    HAVING couple_id IS NULL OR count(*) > 1
  )
  OR EXISTS (
    SELECT 1
      FROM public.vendor_reviews
     WHERE booking_id IS NOT NULL AND customer_id IS NOT NULL
     GROUP BY booking_id, customer_id
    HAVING count(*) > 1
  )
  OR EXISTS (
    SELECT 1
      FROM public.decision_nodes
     WHERE source = 'vendor_booking'
       AND decision_type = 'completed'
       AND source_ref_id IS NOT NULL
     GROUP BY couple_id, source_ref_id, source, decision_type
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'PRE_DUPLICATE_DATA_INVALID';
  END IF;

  WITH slot_rows AS (
    SELECT couple.id AS couple_id, 'bride'::text AS slot_role,
           couple.bride_id AS user_id
      FROM public.couples AS couple
     WHERE couple.bride_id IS NOT NULL
    UNION ALL
    SELECT couple.id AS couple_id, 'groom'::text AS slot_role,
           couple.groom_id AS user_id
      FROM public.couples AS couple
     WHERE couple.groom_id IS NOT NULL
  ), slot_audit AS (
    SELECT slot.couple_id, slot.slot_role, slot.user_id,
           profile.couple_id AS profile_couple_id,
           profile.role AS profile_role
      FROM slot_rows AS slot
      LEFT JOIN public.profiles AS profile ON profile.id = slot.user_id
  )
  SELECT
    count(*) FILTER (
      WHERE slot_role = 'bride'
        AND profile_couple_id IS DISTINCT FROM couple_id
    )::integer,
    count(*) FILTER (
      WHERE slot_role = 'groom'
        AND profile_couple_id IS DISTINCT FROM couple_id
    )::integer,
    count(*) FILTER (
      WHERE profile_couple_id = couple_id
        AND profile_role IS DISTINCT FROM slot_role
    )::integer
    INTO v_stale_bride_slots, v_stale_groom_slots,
         v_canonical_role_mismatches
    FROM slot_audit;

  SELECT count(*)::integer
    INTO v_reverse_link_mismatches
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
     );

  WITH slots AS (
    SELECT bride_id AS user_id FROM public.couples WHERE bride_id IS NOT NULL
    UNION ALL
    SELECT groom_id AS user_id FROM public.couples WHERE groom_id IS NOT NULL
  )
  SELECT count(*)::integer
    INTO v_duplicate_users
    FROM (
      SELECT user_id FROM slots GROUP BY user_id HAVING count(*) > 1
    ) AS duplicate_member;

  SELECT count(*)::integer
    INTO v_same_user_both_roles
    FROM public.couples
   WHERE bride_id IS NOT NULL AND bride_id = groom_id;

  SELECT count(*)::integer
    INTO v_projected_ownerless
    FROM public.couples AS couple
   WHERE (couple.bride_id IS NOT NULL OR couple.groom_id IS NOT NULL)
     AND NOT EXISTS (
       SELECT 1 FROM public.profiles AS bride
        WHERE bride.id = couple.bride_id AND bride.couple_id = couple.id
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.profiles AS groom
        WHERE groom.id = couple.groom_id AND groom.couple_id = couple.id
     );

  IF v_stale_bride_slots <> 0
     OR v_stale_groom_slots <> 34
     OR v_canonical_role_mismatches <> 0
     OR v_reverse_link_mismatches <> 0
     OR v_duplicate_users <> 3
     OR v_same_user_both_roles <> 0
     OR v_projected_ownerless <> 33 THEN
    RAISE EXCEPTION 'PRE_1140_CANDIDATE_SET_INVALID';
  END IF;

  IF pg_catalog.to_regclass('public.rate_limit_buckets') IS NULL THEN
    RAISE EXCEPTION 'PRE_1150_CANDIDATE_BOUND_INVALID';
  END IF;

  SELECT count(*)
    INTO v_expired_rate_limits
    FROM public.rate_limit_buckets
   WHERE reset_at <= pg_catalog.clock_timestamp();

  IF v_expired_rate_limits > 1000
     OR EXISTS (
       SELECT 1 FROM public.rate_limit_buckets WHERE key LIKE '%@%'
     ) THEN
    RAISE EXCEPTION 'PRE_1150_CANDIDATE_BOUND_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM (VALUES
        ('amora_memory_settings'),
        ('amora_memory_consents'),
        ('amora_memory_jobs'),
        ('amora_mediation_acceptances'),
        ('amora_care_scan_states'),
        ('amora_care_jobs'),
        ('amora_care_deliveries'),
        ('amora_turn_requests'),
        ('booking_projection_jobs'),
        ('amora_conflict_check_claims'),
        ('community_upload_sessions'),
        ('account_deletion_jobs'),
        ('account_deletion_media_manifest')
      ) AS required_absence(relation_name)
     WHERE pg_catalog.to_regclass(
       'public.' || required_absence.relation_name
     ) IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'PRE_NEW_RELATION_ALREADY_EXISTS';
  END IF;
END;
$pre_data_shape$;

SELECT
  true AS verified,
  1 AS pre_release_contract_verified_count;
COMMIT;
