-- READ ONLY / RELEASE-BLOCKING HOSTED VERIFICATION.
-- Run after migration 20260804120000 and the existing final Storage owner
-- operation. Green means both retired buckets are private, retained bytes were
-- not enumerated, and the exact global policy manifest exposes no read or write
-- path to either guestbook bucket. It does not authorize production by itself.

BEGIN TRANSACTION READ ONLY;

SET LOCAL statement_timeout = '60s';

DO $retired_guestbook_storage_verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'storage'
      AND relation.relname = 'objects'
      AND relation.relkind = 'r'
      AND relation.relrowsecurity
      AND NOT relation.relforcerowsecurity
      AND pg_catalog.pg_get_userbyid(relation.relowner) = 'supabase_storage_admin'
  ) OR pg_catalog.to_regprocedure('extensions.digest(text,text)') IS NULL THEN
    RAISE EXCEPTION
      'RETIRED_GUESTBOOK_STORAGE_VERIFY_FAILED: relation contract';
  END IF;

  IF EXISTS (
    WITH expected(id, is_public) AS (
      VALUES
        ('guestbook-images'::text, false),
        ('guestbook-uploads'::text, false)
    ), actual AS (
      SELECT bucket.id, bucket.name, bucket.public
      FROM storage.buckets AS bucket
      WHERE bucket.id IN ('guestbook-images', 'guestbook-uploads')
    )
    SELECT 1
    FROM expected
    FULL JOIN actual USING (id)
    WHERE expected.id IS NULL
      OR actual.id IS NULL
      OR actual.name IS DISTINCT FROM expected.id
      OR actual.public IS DISTINCT FROM expected.is_public
  ) THEN
    RAISE EXCEPTION
      'RETIRED_GUESTBOOK_STORAGE_VERIFY_FAILED: bucket contract';
  END IF;

  IF EXISTS (
    WITH expected(permissive, roles, cmd, expression_sha256) AS (
      VALUES (
        'PERMISSIVE'::text,
        ARRAY['authenticated']::name[],
        'INSERT'::text,
        '7b9e967897a69bdc226f09e02a240db1ca64f0caeb58244912445ff0f5032482'::text
      )
    ), actual AS (
      SELECT
        policy.permissive::text,
        policy.roles,
        policy.cmd::text,
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
    )
    (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
  ) THEN
    RAISE EXCEPTION
      'RETIRED_GUESTBOOK_STORAGE_VERIFY_FAILED: policy manifest';
  END IF;
END;
$retired_guestbook_storage_verify$;

SELECT
  bucket.id,
  bucket.public,
  count(object.id)::bigint AS retained_object_count
FROM storage.buckets AS bucket
LEFT JOIN storage.objects AS object ON object.bucket_id = bucket.id
WHERE bucket.id IN ('guestbook-images', 'guestbook-uploads')
GROUP BY bucket.id, bucket.public
ORDER BY bucket.id;

SELECT true AS retired_guestbook_storage_verified;

COMMIT;
