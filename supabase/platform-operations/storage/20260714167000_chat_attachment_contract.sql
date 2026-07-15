-- PLATFORM OPERATION / CONTRACT PHASE (reference SQL for local verification).
-- Hosted Supabase owns storage.objects as supabase_storage_admin, so this file
-- MUST NOT be run through `supabase db push` or the SQL editor. Apply the bucket
-- and policy changes through Dashboard > Storage using the companion README.
--
-- After the new uploader path and signed-URL API pass canary, make the bucket
-- private and remove every known legacy public/couple mutation policy.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'chat-image own uploader folder write'
  ) <> 1 THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_EXPAND_UPLOAD_POLICY_MISSING';
  END IF;
END;
$$;

UPDATE storage.buckets
SET public = FALSE
WHERE id = 'chat-image';

DROP POLICY IF EXISTS "chat-image authenticated write" ON storage.objects;
DROP POLICY IF EXISTS "chat-image authenticated update" ON storage.objects;
DROP POLICY IF EXISTS "chat-image authenticated delete" ON storage.objects;
DROP POLICY IF EXISTS "chat-image couple folder write" ON storage.objects;
DROP POLICY IF EXISTS "chat-image couple folder update" ON storage.objects;
DROP POLICY IF EXISTS "chat-image couple folder delete" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view chat image" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload chat image" ON storage.objects;
DROP POLICY IF EXISTS "chat-image own uploader folder update" ON storage.objects;
DROP POLICY IF EXISTS "chat-image own uploader folder delete" ON storage.objects;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE id = 'chat-image' AND public
  ) OR EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname IN (
        'chat-image authenticated write',
        'chat-image authenticated update',
        'chat-image authenticated delete',
        'chat-image couple folder write',
        'chat-image couple folder update',
        'chat-image couple folder delete',
        'Anyone can view chat image',
        'Authenticated users can upload chat image',
        'chat-image own uploader folder update',
        'chat-image own uploader folder delete'
      )
  ) THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_CONTRACT_POSTCONDITION_FAILED';
  END IF;
END;
$$;

COMMENT ON POLICY "chat-image own uploader folder write" ON storage.objects IS
  'Private immutable chat attachments must use couple_id/auth.uid()/file; all reads use authorized signed URLs.';
