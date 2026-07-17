-- READ ONLY. Controller-compatible receipt for the pre-backup Storage freeze.
-- Run twice only after the two-hour signed-upload token TTL plus the approved
-- grace interval. The controller, not this snapshot query, proves receipt time.

BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';

DO $storage_freeze_release_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'storage' AND relation.relname = 'objects'
      AND relation.relkind = 'r' AND relation.relrowsecurity
      AND NOT relation.relforcerowsecurity
      AND pg_catalog.pg_get_userbyid(relation.relowner) = 'supabase_storage_admin'
  ) OR pg_catalog.to_regprocedure('extensions.digest(text,text)') IS NULL THEN
    RAISE EXCEPTION 'STORAGE_FREEZE_RELEASE_CHECK_RELATION_INVALID';
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
        pg_catalog.encode(extensions.digest(lower(pg_catalog.regexp_replace(
          COALESCE(qual, '') || E'\n' || COALESCE(with_check, ''),
          E'\\s+', '', 'g')), 'sha256'), 'hex') AS expression_sha256
      FROM pg_catalog.pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
    )
    SELECT 1 FROM expected FULL JOIN actual USING (policyname)
    WHERE expected.policyname IS NULL OR actual.policyname IS NULL
       OR actual.permissive IS DISTINCT FROM expected.permissive
       OR actual.roles IS DISTINCT FROM expected.roles
       OR actual.cmd IS DISTINCT FROM expected.cmd
       OR actual.expression_sha256 IS DISTINCT FROM expected.expression_sha256
  ) THEN
    RAISE EXCEPTION 'STORAGE_FREEZE_RELEASE_CHECK_POLICY_INVALID';
  END IF;

  IF EXISTS (
    WITH expected(id, is_public, file_size_limit, allowed_mime_types, object_count) AS (
      VALUES
        ('chat-image'::text, false, NULL::bigint, NULL::text[], 6::bigint),
        ('cohort-images', true, NULL::bigint, NULL::text[], 0::bigint),
        ('community-images', true, 10 * 1024 * 1024, ARRAY['image/jpeg','image/png','image/gif','image/webp']::text[], 43::bigint),
        ('community-videos', true, 50 * 1024 * 1024, ARRAY['video/mp4','video/quicktime','video/webm']::text[], 0::bigint),
        ('guestbook-images', true, NULL::bigint, NULL::text[], 0::bigint),
        ('guestbook-uploads', true, 5 * 1024 * 1024, ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif']::text[], 0::bigint),
        ('invitation-photos', true, 10 * 1024 * 1024, ARRAY['image/jpeg','image/png','image/webp','image/heic']::text[], 0::bigint),
        ('user_photos', true, NULL::bigint, NULL::text[], 0::bigint),
        ('vendor-images', true, 5 * 1024 * 1024, ARRAY['image/jpeg','image/png','image/webp']::text[], 0::bigint),
        ('vendor-licenses', false, 10 * 1024 * 1024, ARRAY['image/jpeg','image/png','application/pdf']::text[], 0::bigint)
    ), actual AS (
      SELECT bucket.id, bucket.name, bucket.public, bucket.file_size_limit,
        bucket.allowed_mime_types, count(storage_object.id)::bigint AS object_count
      FROM storage.buckets AS bucket
      LEFT JOIN storage.objects AS storage_object ON storage_object.bucket_id = bucket.id
      GROUP BY bucket.id, bucket.name, bucket.public,
        bucket.file_size_limit, bucket.allowed_mime_types
    )
    SELECT 1 FROM expected FULL JOIN actual USING (id)
    WHERE expected.id IS NULL OR actual.id IS NULL
       OR actual.name IS DISTINCT FROM expected.id
       OR actual.public IS DISTINCT FROM expected.is_public
       OR actual.file_size_limit IS DISTINCT FROM expected.file_size_limit
       OR actual.allowed_mime_types IS DISTINCT FROM expected.allowed_mime_types
       OR actual.object_count IS DISTINCT FROM expected.object_count
  ) OR EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'community-media-staging'
  ) OR EXISTS (
    SELECT 1 FROM storage.objects WHERE bucket_id = 'community-media-staging'
  ) THEN
    RAISE EXCEPTION 'STORAGE_FREEZE_RELEASE_CHECK_BUCKET_OR_OBJECT_INVALID';
  END IF;
END;
$storage_freeze_release_check$;

SELECT
  true AS verified,
  (SELECT count(*)::integer FROM pg_catalog.pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects') AS storage_policy_count,
  (SELECT count(*)::integer FROM pg_catalog.pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND cmd <> 'SELECT') AS storage_mutation_policy_count,
  (SELECT count(*)::integer FROM storage.buckets) AS storage_bucket_count,
  (SELECT count(*)::integer FROM storage.objects) AS storage_object_count,
  (SELECT count(*)::integer FROM storage.objects
    WHERE bucket_id = 'chat-image') AS storage_chat_object_count,
  (SELECT count(*)::integer FROM storage.objects
    WHERE bucket_id = 'community-images') AS storage_community_image_object_count;

COMMIT;
