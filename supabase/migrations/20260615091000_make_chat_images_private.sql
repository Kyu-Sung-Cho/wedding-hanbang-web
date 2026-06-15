-- Make private chat attachments private at the storage layer.
--
-- Chat images can include quotes, contracts, and personal wedding documents.
-- Store them in a private bucket and serve them only through short-lived signed
-- URLs after the API verifies the current user belongs to the image's couple.

UPDATE storage.buckets
SET public = FALSE
WHERE id = 'chat-image';

DROP POLICY IF EXISTS "chat-image authenticated write" ON storage.objects;
DROP POLICY IF EXISTS "chat-image authenticated update" ON storage.objects;
DROP POLICY IF EXISTS "chat-image authenticated delete" ON storage.objects;

DROP POLICY IF EXISTS "chat-image couple folder write" ON storage.objects;
CREATE POLICY "chat-image couple folder write"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-image'
    AND (storage.foldername(name))[1] IN (
      SELECT couple_id::text
      FROM public.profiles
      WHERE id = auth.uid()
        AND couple_id IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "chat-image couple folder update" ON storage.objects;
CREATE POLICY "chat-image couple folder update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'chat-image'
    AND (storage.foldername(name))[1] IN (
      SELECT couple_id::text
      FROM public.profiles
      WHERE id = auth.uid()
        AND couple_id IS NOT NULL
    )
  )
  WITH CHECK (
    bucket_id = 'chat-image'
    AND (storage.foldername(name))[1] IN (
      SELECT couple_id::text
      FROM public.profiles
      WHERE id = auth.uid()
        AND couple_id IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "chat-image couple folder delete" ON storage.objects;
CREATE POLICY "chat-image couple folder delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'chat-image'
    AND (storage.foldername(name))[1] IN (
      SELECT couple_id::text
      FROM public.profiles
      WHERE id = auth.uid()
        AND couple_id IS NOT NULL
    )
  );
