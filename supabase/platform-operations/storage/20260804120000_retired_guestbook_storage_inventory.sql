-- READ ONLY / PRE-VERIFY INVENTORY.
-- Run in hosted SQL Editor before the destination-fenced Storage API operation
-- and save every result set. No object names or bytes are emitted.

BEGIN TRANSACTION READ ONLY;

SET LOCAL statement_timeout = '60s';

SELECT
  relation.relkind,
  relation.relrowsecurity,
  relation.relforcerowsecurity,
  pg_catalog.pg_get_userbyid(relation.relowner) AS relation_owner,
  CASE
    WHEN relation.relkind = 'r'
      AND relation.relrowsecurity
      AND NOT relation.relforcerowsecurity
      AND pg_catalog.pg_get_userbyid(relation.relowner) = 'supabase_storage_admin'
      THEN 'EXACT_HOSTED_OWNER_CONTRACT'
    ELSE 'STOP_RELATION_CONTRACT_DRIFT'
  END AS contract_status
FROM pg_catalog.pg_class AS relation
JOIN pg_catalog.pg_namespace AS namespace
  ON namespace.oid = relation.relnamespace
WHERE namespace.nspname = 'storage'
  AND relation.relname = 'objects';

WITH expected(id) AS (
  VALUES ('guestbook-images'::text), ('guestbook-uploads'::text)
), object_counts AS (
  SELECT object.bucket_id, count(*)::bigint AS object_count
  FROM storage.objects AS object
  WHERE object.bucket_id IN ('guestbook-images', 'guestbook-uploads')
  GROUP BY object.bucket_id
)
SELECT
  expected.id,
  bucket.name,
  bucket.public,
  COALESCE(object_counts.object_count, 0) AS retained_object_count,
  CASE
    WHEN bucket.id IS NULL THEN 'STOP_BUCKET_MISSING'
    WHEN bucket.name IS DISTINCT FROM expected.id THEN 'STOP_BUCKET_IDENTITY_DRIFT'
    WHEN bucket.public THEN 'READY_TO_PRIVATIZE'
    ELSE 'ALREADY_PRIVATE'
  END AS contract_status
FROM expected
LEFT JOIN storage.buckets AS bucket ON bucket.id = expected.id
LEFT JOIN object_counts ON object_counts.bucket_id = expected.id
ORDER BY expected.id;

SELECT
  policy.policyname,
  policy.permissive,
  policy.roles,
  policy.cmd,
  policy.qual,
  policy.with_check,
  pg_catalog.encode(extensions.digest(
    lower(pg_catalog.regexp_replace(
      COALESCE(policy.qual, '') || E'\n' || COALESCE(policy.with_check, ''),
      E'\\s+', '', 'g'
    )),
    'sha256'
  ), 'hex') AS expression_sha256
FROM pg_catalog.pg_policies AS policy
WHERE policy.schemaname = 'storage'
  AND policy.tablename = 'objects'
ORDER BY policy.policyname;

COMMIT;
