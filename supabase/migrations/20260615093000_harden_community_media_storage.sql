-- Harden community media storage writes.
--
-- The API now accepts only media URLs that came from these buckets and belong
-- to the post author. This migration makes the storage layer match that rule:
-- authenticated users can write/update/delete only inside their own top-level
-- folder in community media buckets.

UPDATE storage.buckets
SET
  public = TRUE,
  file_size_limit = 10 * 1024 * 1024,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']
WHERE id = 'community-images';

UPDATE storage.buckets
SET
  public = TRUE,
  file_size_limit = 50 * 1024 * 1024,
  allowed_mime_types = ARRAY['video/mp4', 'video/quicktime', 'video/webm']
WHERE id = 'community-videos';

DROP POLICY IF EXISTS "community-images authenticated write" ON storage.objects;
DROP POLICY IF EXISTS "community-images authenticated update" ON storage.objects;
DROP POLICY IF EXISTS "community-images authenticated delete" ON storage.objects;
DROP POLICY IF EXISTS "community-videos authenticated write" ON storage.objects;
DROP POLICY IF EXISTS "community-videos authenticated update" ON storage.objects;
DROP POLICY IF EXISTS "community-videos authenticated delete" ON storage.objects;

DROP POLICY IF EXISTS "community-images own folder write" ON storage.objects;
CREATE POLICY "community-images own folder write"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'community-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND array_length(storage.foldername(name), 1) >= 1
  );

DROP POLICY IF EXISTS "community-images own folder update" ON storage.objects;
CREATE POLICY "community-images own folder update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'community-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'community-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND array_length(storage.foldername(name), 1) >= 1
  );

DROP POLICY IF EXISTS "community-images own folder delete" ON storage.objects;
CREATE POLICY "community-images own folder delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'community-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "community-videos own folder write" ON storage.objects;
CREATE POLICY "community-videos own folder write"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'community-videos'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND array_length(storage.foldername(name), 1) >= 1
  );

DROP POLICY IF EXISTS "community-videos own folder update" ON storage.objects;
CREATE POLICY "community-videos own folder update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'community-videos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'community-videos'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND array_length(storage.foldername(name), 1) >= 1
  );

DROP POLICY IF EXISTS "community-videos own folder delete" ON storage.objects;
CREATE POLICY "community-videos own folder delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'community-videos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
