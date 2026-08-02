-- SAFE FAIL-CLOSED ROLLBACK / NO PRIVILEGE RESTORATION.
--
-- The previous authenticated upload policy accepted caller-controlled bytes and
-- must never be restored as a rollback. If the server upload deployment is
-- rolled back, chat attachments remain unavailable until a forward fix ships.
-- Existing objects and the private bucket contract are left untouched.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $chat_image_server_upload_fence_safe_rollback$
DECLARE
  chat_object_count_before bigint;
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
    RAISE EXCEPTION 'CHAT_IMAGE_SERVER_UPLOAD_FENCE_ROLLBACK_RELATION_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies AS policy
    WHERE policy.schemaname = 'storage' AND policy.tablename = 'objects'
  ) THEN
    RAISE EXCEPTION 'CHAT_IMAGE_SERVER_UPLOAD_FENCE_ROLLBACK_POLICY_DRIFT';
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
    RAISE EXCEPTION 'CHAT_IMAGE_SERVER_UPLOAD_FENCE_ROLLBACK_BUCKET_INVALID';
  END IF;

  SELECT count(*)
  INTO chat_object_count_before
  FROM storage.objects AS storage_object
  WHERE storage_object.bucket_id = 'chat-image';

  -- Deliberate no-op: rollback never recreates a client mutation policy.
  IF (
    SELECT count(*)
    FROM storage.objects AS storage_object
    WHERE storage_object.bucket_id = 'chat-image'
  ) IS DISTINCT FROM chat_object_count_before THEN
    RAISE EXCEPTION 'CHAT_IMAGE_SERVER_UPLOAD_FENCE_ROLLBACK_OBJECT_CHANGED';
  END IF;
END;
$chat_image_server_upload_fence_safe_rollback$;

COMMIT;
