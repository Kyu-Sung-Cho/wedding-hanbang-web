-- PLATFORM OPERATION / EXPAND PHASE (reference SQL for local verification).
-- Hosted Supabase owns storage.objects as supabase_storage_admin, so this file
-- MUST NOT be run through `supabase db push` or the SQL editor. Apply the three
-- policies through Dashboard > Storage > Policies using the companion README.
--
-- Add an uploader-bound chat attachment INSERT policy without removing
-- the legacy couple/file writer used by already-deployed browser bundles.
-- Attachments are immutable after upload. Do not create UPDATE, DELETE, or
-- SELECT policies: hosted Dashboard auto-adds SELECT when UPDATE/DELETE is
-- selected, which would bypass the signed-URL-only read boundary.
--
-- New object layout:
--   {couple_id}/{auth.uid()}/{opaque_file_name}
--
-- Historical clients use {couple_id}/{opaque_file_name}. Their overlap policy
-- and the public bucket are removed only by the post-canary contract migration.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DROP POLICY IF EXISTS "chat-image own uploader folder write" ON storage.objects;
DROP POLICY IF EXISTS "chat-image own uploader folder update" ON storage.objects;
DROP POLICY IF EXISTS "chat-image own uploader folder delete" ON storage.objects;

CREATE POLICY "chat-image own uploader folder write"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-image'
    AND array_length(storage.foldername(name), 1) = 2
    AND (storage.foldername(name))[1] IN (
      SELECT couple_id::text
      FROM public.profiles
      WHERE id = auth.uid()
        AND couple_id IS NOT NULL
    )
    AND (storage.foldername(name))[2] = auth.uid()::text
    AND char_length(name) <= 512
    AND split_part(name, '/', 3) ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    AND strpos(name, E'\\') = 0
    AND name !~ '(^|/)\.\.?(/|$)'
    AND name !~* '%(2e|2f|5c|25)'
    AND name !~ '[?#]'
  );

COMMENT ON POLICY "chat-image own uploader folder write" ON storage.objects IS
  'Immutable chat attachments use couple_id/auth.uid()/file during the mixed-version overlap window.';
