-- READ ONLY / CHAT-IMAGE SERVER-OWNED UPLOAD PRESTATE INVENTORY.
--
-- Hosted Supabase owns storage.objects as supabase_storage_admin. Run this in
-- the SQL editor before the companion Dashboard policy operation and retain the
-- receipt outside git. Object paths are hashed here so an operational receipt
-- cannot become a second attachment-name disclosure surface.

BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';

SELECT policyname, permissive, roles, cmd,
  pg_catalog.encode(extensions.digest(lower(pg_catalog.regexp_replace(
    COALESCE(qual, '') || E'\n' || COALESCE(with_check, ''),
    E'\\s+', '', 'g'
  )), 'sha256'), 'hex') AS expression_sha256
FROM pg_catalog.pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
ORDER BY policyname;

SELECT bucket.id, bucket.name, bucket.public, bucket.file_size_limit,
  bucket.allowed_mime_types,
  count(storage_object.id)::bigint AS object_count,
  count(storage_object.id) FILTER (
    WHERE cardinality(pg_catalog.string_to_array(storage_object.name, '/')) = 2
  )::bigint AS legacy_two_segment_object_count,
  count(storage_object.id) FILTER (
    WHERE cardinality(pg_catalog.string_to_array(storage_object.name, '/')) = 3
  )::bigint AS server_path_object_count
FROM storage.buckets AS bucket
LEFT JOIN storage.objects AS storage_object
  ON storage_object.bucket_id = bucket.id
WHERE bucket.id = 'chat-image'
GROUP BY bucket.id, bucket.name, bucket.public, bucket.file_size_limit,
  bucket.allowed_mime_types;

SELECT
  pg_catalog.encode(extensions.digest(storage_object.name, 'sha256'), 'hex')
    AS object_path_sha256,
  cardinality(pg_catalog.string_to_array(storage_object.name, '/'))
    AS path_segment_count,
  lower(pg_catalog.split_part(storage_object.name, '.', -1)) AS extension,
  NULLIF(storage_object.metadata ->> 'mimetype', '') AS declared_mime_type,
  CASE
    WHEN COALESCE(storage_object.metadata ->> 'size', '') ~ '^[0-9]+$'
      THEN (storage_object.metadata ->> 'size')::bigint
    ELSE NULL
  END AS declared_size_bytes
FROM storage.objects AS storage_object
WHERE storage_object.bucket_id = 'chat-image'
ORDER BY object_path_sha256;

COMMIT;
