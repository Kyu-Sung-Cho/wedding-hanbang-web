-- READ ONLY / SAFE FAIL-CLOSED ROLLBACK VERIFICATION.

BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';

DO $chat_image_server_upload_fence_rollback_verify$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies AS policy
    WHERE policy.schemaname = 'storage' AND policy.tablename = 'objects'
  ) THEN
    RAISE EXCEPTION 'CHAT_IMAGE_SERVER_UPLOAD_FENCE_ROLLBACK_VERIFY_POLICY_PRESENT';
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
    RAISE EXCEPTION 'CHAT_IMAGE_SERVER_UPLOAD_FENCE_ROLLBACK_VERIFY_BUCKET_INVALID';
  END IF;
END;
$chat_image_server_upload_fence_rollback_verify$;

SELECT 1::bigint AS chat_image_server_upload_fence_rollback_verified_count;
COMMIT;
