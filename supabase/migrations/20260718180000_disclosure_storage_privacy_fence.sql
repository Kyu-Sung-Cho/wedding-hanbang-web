BEGIN;

-- Supabase Storage keeps ownership through supabase_storage_admin. Hosted
-- migrations can manage policies as postgres, but that managed role explicitly
-- forbids assuming membership in the reserved Storage role. Preserve ownership
-- and avoid changing RLS or granting clients any new table privilege.
SET LOCAL lock_timeout = '5s';

-- A private bucket flag controls public URLs, but it does not neutralize an
-- old permissive storage.objects policy. Keep both evidence buckets private
-- and add restrictive policies that are AND-ed with every permissive policy.
UPDATE storage.buckets
SET public = false
WHERE id IN ('disclosure-raw', 'disclosure-preview');

DROP POLICY IF EXISTS disclosure_evidence_client_select_fence
  ON storage.objects;
CREATE POLICY disclosure_evidence_client_select_fence
  ON storage.objects
  AS RESTRICTIVE
  FOR SELECT
  TO anon, authenticated
  USING (
    bucket_id <> ALL (
      ARRAY['disclosure-raw', 'disclosure-preview']::text[]
    )
  );

DROP POLICY IF EXISTS disclosure_evidence_client_insert_fence
  ON storage.objects;
CREATE POLICY disclosure_evidence_client_insert_fence
  ON storage.objects
  AS RESTRICTIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    bucket_id <> ALL (
      ARRAY['disclosure-raw', 'disclosure-preview']::text[]
    )
  );

DROP POLICY IF EXISTS disclosure_evidence_client_update_fence
  ON storage.objects;
CREATE POLICY disclosure_evidence_client_update_fence
  ON storage.objects
  AS RESTRICTIVE
  FOR UPDATE
  TO anon, authenticated
  USING (
    bucket_id <> ALL (
      ARRAY['disclosure-raw', 'disclosure-preview']::text[]
    )
  )
  WITH CHECK (
    bucket_id <> ALL (
      ARRAY['disclosure-raw', 'disclosure-preview']::text[]
    )
  );

DROP POLICY IF EXISTS disclosure_evidence_client_delete_fence
  ON storage.objects;
CREATE POLICY disclosure_evidence_client_delete_fence
  ON storage.objects
  AS RESTRICTIVE
  FOR DELETE
  TO anon, authenticated
  USING (
    bucket_id <> ALL (
      ARRAY['disclosure-raw', 'disclosure-preview']::text[]
    )
  );

DO $disclosure_storage_privacy_postconditions$
DECLARE
  policy_count integer;
BEGIN
  IF (
    SELECT count(*)
    FROM storage.buckets
    WHERE id IN ('disclosure-raw', 'disclosure-preview')
      AND public = false
  ) <> 2 THEN
    RAISE EXCEPTION 'DISCLOSURE_STORAGE_PRIVATE_BUCKET_POSTCONDITION_FAILED';
  END IF;

  SELECT count(*)
  INTO policy_count
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND policyname IN (
      'disclosure_evidence_client_select_fence',
      'disclosure_evidence_client_insert_fence',
      'disclosure_evidence_client_update_fence',
      'disclosure_evidence_client_delete_fence'
    )
    AND permissive = 'RESTRICTIVE'
    AND roles @> ARRAY['anon'::name, 'authenticated'::name];

  IF policy_count <> 4 THEN
    RAISE EXCEPTION 'DISCLOSURE_STORAGE_POLICY_POSTCONDITION_FAILED';
  END IF;
END
$disclosure_storage_privacy_postconditions$;

COMMIT;
