-- READ ONLY / SAFE PHASE-2 ROLLBACK VERIFICATION.
-- Success means Storage is fail-closed with zero policies: no mutation and no
-- broad public reads. It does not authorize deployment or a global fence lift.

BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';

DO $storage_final_safe_rollback_verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'storage' AND relation.relname = 'objects'
      AND relation.relkind = 'r' AND relation.relrowsecurity
      AND NOT relation.relforcerowsecurity
      AND pg_catalog.pg_get_userbyid(relation.relowner) = 'supabase_storage_admin'
  ) OR pg_catalog.to_regprocedure('extensions.digest(text,text)') IS NULL THEN
    RAISE EXCEPTION 'STORAGE_FINAL_SAFE_ROLLBACK_VERIFY_RELATION_INVALID';
  END IF;

  IF EXISTS (
    WITH expected(id, is_public, file_size_limit, allowed_mime_types, object_count) AS (
      VALUES
        ('chat-image'::text, false, 3 * 1024 * 1024,
          ARRAY['image/jpeg','image/png','image/gif','image/webp']::text[], 6::bigint),
        ('cohort-images', false, NULL::bigint, NULL::text[], 0::bigint),
        ('community-images', true, 10 * 1024 * 1024, ARRAY['image/jpeg','image/png','image/gif','image/webp']::text[], 43::bigint),
        ('community-videos', true, 50 * 1024 * 1024, ARRAY['video/mp4','video/quicktime','video/webm']::text[], 0::bigint),
        ('guestbook-images', false, NULL::bigint, NULL::text[], 0::bigint),
        ('guestbook-uploads', false, 5 * 1024 * 1024, ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif']::text[], 0::bigint),
        ('invitation-photos', false, 10 * 1024 * 1024, ARRAY['image/jpeg','image/png','image/webp','image/heic']::text[], 0::bigint),
        ('user_photos', false, NULL::bigint, NULL::text[], 0::bigint),
        ('vendor-images', true, 5 * 1024 * 1024, ARRAY['image/jpeg','image/png','image/webp']::text[], 0::bigint),
        ('vendor-licenses', false, 10 * 1024 * 1024, ARRAY['image/jpeg','image/png','application/pdf']::text[], 0::bigint),
        ('community-media-staging', false, 6 * 1024 * 1024, ARRAY['image/jpeg','image/png','image/gif','image/webp']::text[], 0::bigint)
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
  ) THEN
    RAISE EXCEPTION 'STORAGE_FINAL_SAFE_ROLLBACK_VERIFY_BUCKET_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
  ) THEN
    RAISE EXCEPTION 'STORAGE_FINAL_SAFE_ROLLBACK_VERIFY_POLICY_INVALID';
  END IF;
END;
$storage_final_safe_rollback_verify$;

SELECT true AS rollback_verified;
COMMIT;
