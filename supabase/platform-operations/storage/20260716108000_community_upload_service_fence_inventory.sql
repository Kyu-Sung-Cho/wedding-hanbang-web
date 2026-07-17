-- READ ONLY / PRE-CHANGE INVENTORY.
-- Safe in the hosted SQL editor. Save every result set as the rollback receipt
-- before editing Dashboard > Storage > Policies. This records expressions and
-- counts only; object names, user folders, and object bytes are not emitted.

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

WITH expected(
  id, is_public, file_size_limit, allowed_mime_types, may_be_absent_before_apply
) AS (
  VALUES
    ('chat-image'::text, false, NULL::bigint, NULL::text[], false),
    ('cohort-images', true, NULL::bigint, NULL::text[], false),
    ('community-images', true, 10 * 1024 * 1024,
      ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']::text[], false),
    ('community-videos', true, 50 * 1024 * 1024,
      ARRAY['video/mp4', 'video/quicktime', 'video/webm']::text[], false),
    ('community-media-staging', false, 6 * 1024 * 1024,
      ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']::text[], true),
    ('guestbook-images', true, NULL::bigint, NULL::text[], false),
    ('guestbook-uploads', true, 5 * 1024 * 1024,
      ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']::text[], false),
    ('invitation-photos', true, 10 * 1024 * 1024,
      ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']::text[], false),
    ('user_photos', true, NULL::bigint, NULL::text[], false),
    ('vendor-images', true, 5 * 1024 * 1024,
      ARRAY['image/jpeg', 'image/png', 'image/webp']::text[], false),
    ('vendor-licenses', false, 10 * 1024 * 1024,
      ARRAY['image/jpeg', 'image/png', 'application/pdf']::text[], false)
), object_counts AS (
  SELECT bucket_id, count(*)::bigint AS object_count
  FROM storage.objects
  GROUP BY bucket_id
)
SELECT
  COALESCE(expected.id, bucket.id) AS id,
  bucket.name,
  bucket.public,
  bucket.file_size_limit,
  bucket.allowed_mime_types,
  pg_catalog.cardinality(bucket.allowed_mime_types) AS mime_cardinality,
  COALESCE(object_counts.object_count, 0) AS object_count,
  CASE
    WHEN expected.id IS NULL
      THEN 'STOP_UNEXPECTED_BUCKET'
    WHEN bucket.id IS NULL AND expected.may_be_absent_before_apply
      THEN 'EXPECTED_CREATE_PREREQUISITE'
    WHEN bucket.id IS NULL
      THEN 'STOP_BUCKET_MISSING'
    WHEN bucket.name IS DISTINCT FROM expected.id
      OR bucket.public IS DISTINCT FROM expected.is_public
      OR bucket.file_size_limit IS DISTINCT FROM expected.file_size_limit
      OR bucket.allowed_mime_types IS DISTINCT FROM expected.allowed_mime_types
      THEN 'STOP_BUCKET_CONTRACT_DRIFT'
    WHEN expected.id = 'community-media-staging'
      AND COALESCE(object_counts.object_count, 0) <> 0
      THEN 'STOP_STAGING_NOT_EMPTY'
    ELSE 'EXACT_BUCKET_CONTRACT'
  END AS contract_status
FROM expected
FULL JOIN storage.buckets AS bucket ON bucket.id = expected.id
LEFT JOIN object_counts ON object_counts.bucket_id = COALESCE(expected.id, bucket.id)
ORDER BY COALESCE(expected.id, bucket.id);

-- The expected pre-operation manifest is the 19-policy production inventory
-- captured on 2026-07-17. `expression_sha256` hashes the whitespace-insensitive
-- lower-case serialization `coalesce(qual,'') || E'\n' || coalesce(with_check,'')`.
WITH expected(
  policyname, permissive, roles, cmd, expression_sha256
) AS (
  VALUES
    ('Anyone can view chat image', 'PERMISSIVE', ARRAY['public']::name[], 'SELECT', '11a6595c0534cd28fc75eace428725eb971ed106208189913fc328fafe4fed23'),
    ('Anyone can view chat images', 'PERMISSIVE', ARRAY['public']::name[], 'SELECT', '3e004f601bc171c755a6dad45c4abac266024ae16b050ac53005dee54c0a3ddb'),
    ('Authenticated users can upload chat image', 'PERMISSIVE', ARRAY['authenticated']::name[], 'INSERT', '11a6595c0534cd28fc75eace428725eb971ed106208189913fc328fafe4fed23'),
    ('Authenticated users can upload chat images', 'PERMISSIVE', ARRAY['public']::name[], 'INSERT', 'd7d7e2d69798ddc14af5a099832e43736eec3265642a0db2511d412aa1474c89'),
    ('chat-image couple folder delete', 'PERMISSIVE', ARRAY['authenticated']::name[], 'DELETE', 'dcb622ff406e58ef473070451e76f983e3095f62f641d9d945a55dd31aadda24'),
    ('chat-image couple folder update', 'PERMISSIVE', ARRAY['authenticated']::name[], 'UPDATE', '984bc44a860747705227991f24756dfceea7107ff285fdc8e23448faf556868e'),
    ('chat-image couple folder write', 'PERMISSIVE', ARRAY['authenticated']::name[], 'INSERT', 'dcb622ff406e58ef473070451e76f983e3095f62f641d9d945a55dd31aadda24'),
    ('chat-image own uploader folder write pf46ue_0', 'PERMISSIVE', ARRAY['authenticated']::name[], 'INSERT', '19967963f55c6cc31cd2b8e3e98f0c670bfb3ee106fafbadf8e28a83dea7bc17'),
    ('community-images own folder delete', 'PERMISSIVE', ARRAY['authenticated']::name[], 'DELETE', 'ee2204eda749969683c0ab8e5a5d0a31a52a977365c9fdfea32d9e2d77292d6f'),
    ('community-images own folder update', 'PERMISSIVE', ARRAY['authenticated']::name[], 'UPDATE', 'a6fe6edbd7ff8fe79508d0918e9cbc06d17e332ff3c76e42ccf29cf7785d1e12'),
    ('community-images own folder write', 'PERMISSIVE', ARRAY['authenticated']::name[], 'INSERT', 'f156756e63363808c0c189e552924864f955c8e61bb5e755421f6aa3963202aa'),
    ('community-videos own folder delete', 'PERMISSIVE', ARRAY['authenticated']::name[], 'DELETE', 'f1c1868271060d90a95d2c0af220af3ca566e5fe91f61d3b08b3c453f558810a'),
    ('community-videos own folder update', 'PERMISSIVE', ARRAY['authenticated']::name[], 'UPDATE', '2f674615a3ba870cc1bf51a0ba7c241dc218b6c8b8af8b9734065740ab50c9a0'),
    ('community-videos own folder write', 'PERMISSIVE', ARRAY['authenticated']::name[], 'INSERT', 'd88191baca148ad4d7f44b50536b748af0601b7b864156bdae25c55563796bca'),
    ('공개: 업체 이미지 조회', 'PERMISSIVE', ARRAY['public']::name[], 'SELECT', '58225493db8405746e0170ff05141dfc86d73e4445ece3fbe33473420e0d8033'),
    ('서비스: 사업자등록증 조회', 'PERMISSIVE', ARRAY['public']::name[], 'SELECT', '1beeec48bf3997f33f65db1f2076e1efab8d014d5fb0d1df59e1f3b7a4afe177'),
    ('업체: 본인 이미지 삭제', 'PERMISSIVE', ARRAY['public']::name[], 'DELETE', '2fd4177bf48502b90bdc96ef4eb855dbabfa3d52cde9ff7979afb3f6e1115c4d'),
    ('업체: 본인 이미지 업로드', 'PERMISSIVE', ARRAY['public']::name[], 'INSERT', '64c9be7005b6e29a2a191c57993b87ab07737435741477b51afeb1ac0934a05a'),
    ('업체: 사업자등록증 업로드', 'PERMISSIVE', ARRAY['public']::name[], 'INSERT', '39d6dea915159213c91ebbddc4ec69f303a221f75b17600e919ca8cc021bb25f')
), actual AS (
  SELECT
    policyname::text,
    permissive::text,
    roles,
    cmd::text,
    pg_catalog.encode(extensions.digest(
      lower(pg_catalog.regexp_replace(
        COALESCE(qual, '') || E'\n' || COALESCE(with_check, ''),
        E'\\s+', '', 'g'
      )),
      'sha256'
    ), 'hex') AS expression_sha256,
    qual,
    with_check
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
)
SELECT
  COALESCE(actual.policyname, expected.policyname) AS policyname,
  actual.permissive,
  actual.roles,
  actual.cmd,
  actual.qual,
  actual.with_check,
  actual.expression_sha256,
  expected.expression_sha256 AS expected_expression_sha256,
  CASE
    WHEN expected.policyname IS NULL THEN 'STOP_UNEXPECTED_POLICY'
    WHEN actual.policyname IS NULL THEN 'STOP_EXPECTED_POLICY_MISSING'
    WHEN actual.permissive IS DISTINCT FROM expected.permissive
      OR actual.roles IS DISTINCT FROM expected.roles
      OR actual.cmd IS DISTINCT FROM expected.cmd
      OR actual.expression_sha256 IS DISTINCT FROM expected.expression_sha256
      THEN 'STOP_POLICY_CONTRACT_DRIFT'
    ELSE 'EXACT_PRE_POLICY_CONTRACT'
  END AS contract_status
FROM expected
FULL JOIN actual USING (policyname)
ORDER BY policyname;

COMMIT;
