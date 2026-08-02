-- READ ONLY / POST-PUSH CHAT-IMAGE SERVER-OWNED UPLOAD RECEIPT.

BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';

DO $chat_image_server_upload_release_check$
DECLARE
  production_fence_record pg_catalog.pg_proc%ROWTYPE;
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
  ) THEN
    RAISE EXCEPTION 'CHAT_IMAGE_SERVER_UPLOAD_RELEASE_RELATION_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies AS policy
    WHERE policy.schemaname = 'storage' AND policy.tablename = 'objects'
  ) THEN
    RAISE EXCEPTION 'CHAT_IMAGE_SERVER_UPLOAD_RELEASE_POLICY_PRESENT';
  END IF;

  SELECT * INTO production_fence_record
  FROM pg_catalog.pg_proc
  WHERE oid = pg_catalog.to_regprocedure(
    'public.production_storage_writes_allowed()'
  );
  IF NOT FOUND
     OR production_fence_record.prokind <> 'f'
     OR NOT production_fence_record.prosecdef
     OR production_fence_record.provolatile <> 's'
     OR pg_catalog.pg_get_userbyid(production_fence_record.proowner) <> 'postgres'
     OR production_fence_record.proconfig IS DISTINCT FROM
       ARRAY['search_path=""']::text[]
     OR pg_catalog.has_function_privilege(
       'anon', production_fence_record.oid, 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'authenticated', production_fence_record.oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role', production_fence_record.oid, 'EXECUTE'
     )
     OR position(
       'trg_production_write_fence_20260717' IN production_fence_record.prosrc
     ) = 0
     OR position(
       'evt_production_write_fence_20260717' IN production_fence_record.prosrc
     ) = 0
     OR position(
       'public.production_write_fence_guard_20260717()'
       IN production_fence_record.prosrc
     ) = 0
     OR position(
       'public.production_write_fence_attach_20260717()'
       IN production_fence_record.prosrc
     ) = 0
     OR pg_catalog.encode(extensions.digest(lower(pg_catalog.regexp_replace(
       production_fence_record.prosrc, E'\\s+', '', 'g'
     )), 'sha256'), 'hex') <>
       '2d68394af998108f9f35441e53d3ec1dfcde0f5f450e736aa78bd55efae50316'
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.aclexplode(COALESCE(
         production_fence_record.proacl,
         pg_catalog.acldefault('f', production_fence_record.proowner)
       )) AS acl_entry
       WHERE acl_entry.grantee = 0
         AND acl_entry.privilege_type = 'EXECUTE'
     )
     OR public.production_storage_writes_allowed() THEN
    RAISE EXCEPTION 'CHAT_IMAGE_SERVER_UPLOAD_RELEASE_PRODUCTION_FENCE_INVALID';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles AS role_record
    WHERE role_record.rolname = 'service_role'
      AND role_record.rolbypassrls
  )
  OR NOT pg_catalog.has_table_privilege(
    'service_role', 'storage.objects', 'SELECT'
  )
  OR NOT pg_catalog.has_table_privilege(
    'service_role', 'storage.objects', 'INSERT'
  )
  OR NOT pg_catalog.has_table_privilege(
    'service_role', 'storage.objects', 'UPDATE'
  ) THEN
    RAISE EXCEPTION 'CHAT_IMAGE_SERVER_UPLOAD_RELEASE_SERVICE_ROLE_INVALID';
  END IF;

  IF EXISTS (
    WITH expected(id, is_public, file_size_limit, allowed_mime_types, object_count) AS (
      VALUES
        ('chat-image'::text, false, 3 * 1024 * 1024,
          ARRAY['image/jpeg','image/png','image/gif','image/webp']::text[], 6::bigint),
        ('cohort-images', false, NULL::bigint, NULL::text[], 0::bigint),
        ('community-images', true, 10 * 1024 * 1024,
          ARRAY['image/jpeg','image/png','image/gif','image/webp']::text[], 43::bigint),
        ('community-videos', true, 50 * 1024 * 1024,
          ARRAY['video/mp4','video/quicktime','video/webm']::text[], 0::bigint),
        ('guestbook-images', false, NULL::bigint, NULL::text[], 0::bigint),
        ('guestbook-uploads', false, 5 * 1024 * 1024,
          ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif']::text[], 0::bigint),
        ('invitation-photos', false, 10 * 1024 * 1024,
          ARRAY['image/jpeg','image/png','image/webp','image/heic']::text[], 0::bigint),
        ('user_photos', false, NULL::bigint, NULL::text[], 0::bigint),
        ('vendor-images', true, 5 * 1024 * 1024,
          ARRAY['image/jpeg','image/png','image/webp']::text[], 0::bigint),
        ('vendor-licenses', false, 10 * 1024 * 1024,
          ARRAY['image/jpeg','image/png','application/pdf']::text[], 0::bigint),
        ('community-media-staging', false, 6 * 1024 * 1024,
          ARRAY['image/jpeg','image/png','image/gif','image/webp']::text[], 0::bigint)
    ), actual AS (
      SELECT bucket.id, bucket.name, bucket.public, bucket.file_size_limit,
        bucket.allowed_mime_types, count(storage_object.id)::bigint AS object_count
      FROM storage.buckets AS bucket
      LEFT JOIN storage.objects AS storage_object
        ON storage_object.bucket_id = bucket.id
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
    RAISE EXCEPTION 'CHAT_IMAGE_SERVER_UPLOAD_RELEASE_BUCKET_OR_OBJECT_INVALID';
  END IF;
END;
$chat_image_server_upload_release_check$;

SELECT
  1::bigint AS chat_image_server_upload_fence_verified_count,
  (
    SELECT count(*)::bigint
    FROM pg_catalog.pg_policies AS policy
    WHERE policy.schemaname = 'storage' AND policy.tablename = 'objects'
  ) AS storage_policy_count,
  (
    SELECT count(*)::bigint
    FROM pg_catalog.pg_policies AS policy
    WHERE policy.schemaname = 'storage'
      AND policy.tablename = 'objects'
      AND policy.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      AND (
        'authenticated'::name = ANY(policy.roles)
        OR 'public'::name = ANY(policy.roles)
      )
  ) AS authenticated_storage_mutation_policy_count,
  (SELECT count(*)::bigint FROM storage.buckets) AS storage_bucket_count,
  (SELECT count(*)::bigint FROM storage.objects) AS storage_object_count,
  (SELECT count(*)::bigint FROM storage.objects
    WHERE bucket_id = 'community-media-staging') AS storage_staging_object_count,
  (NOT public.production_storage_writes_allowed())::integer
    AS production_storage_fence_closed_count;

COMMIT;
