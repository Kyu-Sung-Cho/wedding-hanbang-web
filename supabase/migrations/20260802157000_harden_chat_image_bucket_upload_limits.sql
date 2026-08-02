-- Bound direct authenticated uploads to the private chat-image bucket.
--
-- The final Storage policy limits object paths and extensions, but clients can
-- call Storage directly and bypass application payload checks. Pin the bucket
-- metadata so Supabase Storage also rejects oversized and non-image uploads.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $chat_image_bucket_preflight$
DECLARE
  bucket_name text;
  bucket_public boolean;
  bucket_file_size_limit bigint;
  bucket_allowed_mime_types text[];
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE EXCEPTION 'CHAT_IMAGE_BUCKET_LIMIT_FENCE_RELATION_MISSING'
      USING ERRCODE = '55000';
  END IF;

  SELECT name, public, file_size_limit, allowed_mime_types
  INTO bucket_name, bucket_public, bucket_file_size_limit,
    bucket_allowed_mime_types
  FROM storage.buckets
  WHERE id = 'chat-image'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CHAT_IMAGE_BUCKET_LIMIT_FENCE_BUCKET_MISSING'
      USING ERRCODE = '55000';
  END IF;

  IF bucket_name IS DISTINCT FROM 'chat-image'
     OR bucket_public IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'CHAT_IMAGE_BUCKET_LIMIT_FENCE_IDENTITY_OR_PRIVACY_DRIFT'
      USING ERRCODE = '55000';
  END IF;

  -- Accept only the captured production prestate, the exact fresh-bootstrap
  -- state created by 20260429000001, or an idempotent retry. A different
  -- non-null limit/allowlist may be stricter or may reflect an unreviewed
  -- production change, so do not silently overwrite it.
  IF NOT (
    (
      bucket_file_size_limit IS NULL
      AND bucket_allowed_mime_types IS NULL
    )
    OR (
      bucket_file_size_limit = 10 * 1024 * 1024
      AND bucket_allowed_mime_types =
        ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']::text[]
    )
    OR (
      bucket_file_size_limit = 3 * 1024 * 1024
      AND bucket_allowed_mime_types =
        ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']::text[]
    )
  ) THEN
    RAISE EXCEPTION 'CHAT_IMAGE_BUCKET_LIMIT_FENCE_PRESTATE_DRIFT'
      USING ERRCODE = '55000';
  END IF;
END;
$chat_image_bucket_preflight$;

UPDATE storage.buckets
SET file_size_limit = 3 * 1024 * 1024,
    allowed_mime_types =
      ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']::text[]
WHERE id = 'chat-image';

DO $chat_image_bucket_postflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE id = 'chat-image'
      AND name = 'chat-image'
      AND public IS FALSE
      AND file_size_limit = 3 * 1024 * 1024
      AND allowed_mime_types =
        ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']::text[]
  ) THEN
    RAISE EXCEPTION 'CHAT_IMAGE_BUCKET_LIMIT_FENCE_POSTCONDITION_FAILED'
      USING ERRCODE = '55000';
  END IF;
END;
$chat_image_bucket_postflight$;

COMMIT;
