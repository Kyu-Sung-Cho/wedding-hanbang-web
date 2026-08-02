-- Make empty legacy Storage buckets private while they have no shipped
-- web/mobile consumer and no object whose public URL must remain compatible.
-- A future feature must introduce an explicit read path instead of silently
-- reopening bucket-wide public delivery.

BEGIN;

DO $relation_preflight$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE EXCEPTION 'DORMANT_STORAGE_PRIVACY_FENCE_BUCKETS_RELATION_MISSING'
      USING ERRCODE = '55000';
  END IF;

  IF to_regclass('storage.objects') IS NULL THEN
    RAISE EXCEPTION 'DORMANT_STORAGE_PRIVACY_FENCE_OBJECTS_RELATION_MISSING'
      USING ERRCODE = '55000';
  END IF;
END;
$relation_preflight$;

DO $state_preflight$
DECLARE
  target_object_count bigint;
BEGIN
  -- A Storage object insert takes a key-share lock on its referenced bucket.
  -- Locking these rows prevents a new target object from racing the zero-count
  -- check without requiring ownership of Supabase-managed storage.objects.
  PERFORM bucket.id
  FROM storage.buckets AS bucket
  WHERE bucket.id IN ('cohort-images', 'invitation-photos', 'user_photos')
  ORDER BY bucket.id
  FOR UPDATE;

  -- Some clean installations never created every retired bucket. Absence is
  -- already the safest state, so do not manufacture a dormant public surface
  -- or reject fresh-bootstrap replay. Production inventory separately pins
  -- the exact live bucket set before this successor migration is authorized.

  SELECT count(*)::bigint
  INTO target_object_count
  FROM storage.objects
  WHERE bucket_id IN ('cohort-images', 'invitation-photos', 'user_photos');

  IF target_object_count <> 0 THEN
    RAISE EXCEPTION 'DORMANT_STORAGE_PRIVACY_FENCE_BUCKET_NOT_EMPTY: %',
      target_object_count
      USING ERRCODE = '55000';
  END IF;
END;
$state_preflight$;

UPDATE storage.buckets
SET public = FALSE
WHERE id IN ('cohort-images', 'invitation-photos', 'user_photos');

DO $postflight$
DECLARE
  exposed_bucket_count integer;
  target_object_count bigint;
BEGIN
  SELECT count(*)::integer
  INTO exposed_bucket_count
  FROM storage.buckets
  WHERE id IN ('cohort-images', 'invitation-photos', 'user_photos')
    AND public IS DISTINCT FROM FALSE;

  IF exposed_bucket_count <> 0 THEN
    RAISE EXCEPTION 'DORMANT_STORAGE_PRIVACY_FENCE_PUBLIC_BUCKET_REMAINS: %',
      exposed_bucket_count
      USING ERRCODE = '55000';
  END IF;

  SELECT count(*)::bigint
  INTO target_object_count
  FROM storage.objects
  WHERE bucket_id IN ('cohort-images', 'invitation-photos', 'user_photos');

  IF target_object_count <> 0 THEN
    RAISE EXCEPTION 'DORMANT_STORAGE_PRIVACY_FENCE_OBJECT_COUNT_DRIFT: %',
      target_object_count
      USING ERRCODE = '55000';
  END IF;
END;
$postflight$;

COMMIT;
