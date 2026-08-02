-- READ ONLY / CHAT-IMAGE SERVER-OWNED UPLOAD FENCE VERIFICATION.

BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';

DO $chat_image_server_upload_fence_verify$
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
    RAISE EXCEPTION 'CHAT_IMAGE_SERVER_UPLOAD_FENCE_VERIFY_RELATION_INVALID';
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
    RAISE EXCEPTION 'CHAT_IMAGE_SERVER_UPLOAD_FENCE_VERIFY_SERVICE_ROLE_INVALID';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.buckets AS bucket
    WHERE bucket.id = 'chat-image'
      AND bucket.name = 'chat-image'
      AND bucket.public IS FALSE
      AND bucket.file_size_limit = 3 * 1024 * 1024
      AND bucket.allowed_mime_types = ARRAY[
        'image/jpeg', 'image/png', 'image/gif', 'image/webp'
      ]::text[]
  ) THEN
    RAISE EXCEPTION 'CHAT_IMAGE_SERVER_UPLOAD_FENCE_VERIFY_BUCKET_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies AS policy
    WHERE policy.schemaname = 'storage' AND policy.tablename = 'objects'
  ) THEN
    RAISE EXCEPTION 'CHAT_IMAGE_SERVER_UPLOAD_FENCE_VERIFY_POLICY_PRESENT';
  END IF;
END;
$chat_image_server_upload_fence_verify$;

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
  ) AS authenticated_storage_mutation_policy_count;

SELECT
  count(*)::bigint AS chat_image_object_count,
  count(*) FILTER (
    WHERE cardinality(pg_catalog.string_to_array(storage_object.name, '/')) = 2
  )::bigint AS legacy_two_segment_object_count,
  count(*) FILTER (
    WHERE cardinality(pg_catalog.string_to_array(storage_object.name, '/')) = 3
  )::bigint AS server_path_object_count
FROM storage.objects AS storage_object
WHERE storage_object.bucket_id = 'chat-image';

COMMIT;
