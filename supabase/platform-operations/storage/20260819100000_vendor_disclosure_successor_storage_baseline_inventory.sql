-- READ-ONLY successor baseline inventory. Production mutation is forbidden.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';

WITH expected_buckets(id, is_public, file_size_limit, allowed_mime_types) AS (
  VALUES
    ('chat-image'::text, false, NULL::bigint, NULL::text[]),
    ('cohort-images', true, NULL::bigint, NULL::text[]),
    ('community-images', true, 10485760::bigint,
      ARRAY['image/jpeg','image/png','image/gif','image/webp']::text[]),
    ('community-videos', true, 52428800::bigint,
      ARRAY['video/mp4','video/quicktime','video/webm']::text[]),
    ('disclosure-preview', false, 2097152::bigint, ARRAY['text/plain']::text[]),
    ('disclosure-raw', false, 52428800::bigint,
      ARRAY['application/haansofthwp','application/json','application/pdf',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/x-hwp','image/png']::text[]),
    ('guestbook-images', true, NULL::bigint, NULL::text[]),
    ('guestbook-uploads', true, 5242880::bigint,
      ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif']::text[]),
    ('invitation-photos', true, 10485760::bigint,
      ARRAY['image/jpeg','image/png','image/webp','image/heic']::text[]),
    ('user_photos', true, NULL::bigint, NULL::text[]),
    ('vendor-images', true, 5242880::bigint,
      ARRAY['image/jpeg','image/png','image/webp']::text[]),
    ('vendor-licenses', false, 10485760::bigint,
      ARRAY['image/jpeg','image/png','application/pdf']::text[])
), expected_policies(policyname, permissive, roles, cmd, hash_mode, expression_sha256) AS (
  VALUES
    ('Anyone can view chat image', 'PERMISSIVE', ARRAY['public']::name[], 'SELECT', 'normalized', '11a6595c0534cd28fc75eace428725eb971ed106208189913fc328fafe4fed23'),
    ('Anyone can view chat images', 'PERMISSIVE', ARRAY['public']::name[], 'SELECT', 'normalized', '3e004f601bc171c755a6dad45c4abac266024ae16b050ac53005dee54c0a3ddb'),
    ('Authenticated users can upload chat image', 'PERMISSIVE', ARRAY['authenticated']::name[], 'INSERT', 'normalized', '11a6595c0534cd28fc75eace428725eb971ed106208189913fc328fafe4fed23'),
    ('Authenticated users can upload chat images', 'PERMISSIVE', ARRAY['public']::name[], 'INSERT', 'normalized', 'd7d7e2d69798ddc14af5a099832e43736eec3265642a0db2511d412aa1474c89'),
    ('chat-image couple folder delete', 'PERMISSIVE', ARRAY['authenticated']::name[], 'DELETE', 'normalized', 'dcb622ff406e58ef473070451e76f983e3095f62f641d9d945a55dd31aadda24'),
    ('chat-image couple folder update', 'PERMISSIVE', ARRAY['authenticated']::name[], 'UPDATE', 'normalized', '984bc44a860747705227991f24756dfceea7107ff285fdc8e23448faf556868e'),
    ('chat-image couple folder write', 'PERMISSIVE', ARRAY['authenticated']::name[], 'INSERT', 'normalized', 'dcb622ff406e58ef473070451e76f983e3095f62f641d9d945a55dd31aadda24'),
    ('chat-image own uploader folder write pf46ue_0', 'PERMISSIVE', ARRAY['authenticated']::name[], 'INSERT', 'normalized', '19967963f55c6cc31cd2b8e3e98f0c670bfb3ee106fafbadf8e28a83dea7bc17'),
    ('community-images own folder delete', 'PERMISSIVE', ARRAY['authenticated']::name[], 'DELETE', 'normalized', 'ee2204eda749969683c0ab8e5a5d0a31a52a977365c9fdfea32d9e2d77292d6f'),
    ('community-images own folder update', 'PERMISSIVE', ARRAY['authenticated']::name[], 'UPDATE', 'normalized', 'a6fe6edbd7ff8fe79508d0918e9cbc06d17e332ff3c76e42ccf29cf7785d1e12'),
    ('community-images own folder write', 'PERMISSIVE', ARRAY['authenticated']::name[], 'INSERT', 'normalized', 'f156756e63363808c0c189e552924864f955c8e61bb5e755421f6aa3963202aa'),
    ('community-videos own folder delete', 'PERMISSIVE', ARRAY['authenticated']::name[], 'DELETE', 'normalized', 'f1c1868271060d90a95d2c0af220af3ca566e5fe91f61d3b08b3c453f558810a'),
    ('community-videos own folder update', 'PERMISSIVE', ARRAY['authenticated']::name[], 'UPDATE', 'normalized', '2f674615a3ba870cc1bf51a0ba7c241dc218b6c8b8af8b9734065740ab50c9a0'),
    ('community-videos own folder write', 'PERMISSIVE', ARRAY['authenticated']::name[], 'INSERT', 'normalized', 'd88191baca148ad4d7f44b50536b748af0601b7b864156bdae25c55563796bca'),
    ('공개: 업체 이미지 조회', 'PERMISSIVE', ARRAY['public']::name[], 'SELECT', 'normalized', '58225493db8405746e0170ff05141dfc86d73e4445ece3fbe33473420e0d8033'),
    ('서비스: 사업자등록증 조회', 'PERMISSIVE', ARRAY['public']::name[], 'SELECT', 'normalized', '1beeec48bf3997f33f65db1f2076e1efab8d014d5fb0d1df59e1f3b7a4afe177'),
    ('업체: 본인 이미지 삭제', 'PERMISSIVE', ARRAY['public']::name[], 'DELETE', 'normalized', '2fd4177bf48502b90bdc96ef4eb855dbabfa3d52cde9ff7979afb3f6e1115c4d'),
    ('업체: 본인 이미지 업로드', 'PERMISSIVE', ARRAY['public']::name[], 'INSERT', 'normalized', '64c9be7005b6e29a2a191c57993b87ab07737435741477b51afeb1ac0934a05a'),
    ('업체: 사업자등록증 업로드', 'PERMISSIVE', ARRAY['public']::name[], 'INSERT', 'normalized', '39d6dea915159213c91ebbddc4ec69f303a221f75b17600e919ca8cc021bb25f'),
    ('disclosure_evidence_client_select_fence', 'RESTRICTIVE', ARRAY['anon','authenticated']::name[], 'SELECT', 'raw', 'ff185265a9865290b5ba9ff77472377fa8d0b707e7bfef65c1ee40f759d1389f'),
    ('disclosure_evidence_client_insert_fence', 'RESTRICTIVE', ARRAY['anon','authenticated']::name[], 'INSERT', 'raw', '24edd073465ecb17ec3baee29c679abda37160c55eb8bda58ecd20e0c7e625de'),
    ('disclosure_evidence_client_update_fence', 'RESTRICTIVE', ARRAY['anon','authenticated']::name[], 'UPDATE', 'raw', '2443f1653a213dde8c5e3edec0c42258c90ac94464397cd644ce6c2d1ddc60ac'),
    ('disclosure_evidence_client_delete_fence', 'RESTRICTIVE', ARRAY['anon','authenticated']::name[], 'DELETE', 'raw', 'ff185265a9865290b5ba9ff77472377fa8d0b707e7bfef65c1ee40f759d1389f')
), actual_buckets AS (
  SELECT id::text, name::text, public, file_size_limit, allowed_mime_types
  FROM storage.buckets
), actual_policies AS (
  SELECT policyname::text, permissive::text, roles, cmd::text,
    pg_catalog.encode(extensions.digest(lower(pg_catalog.regexp_replace(
      COALESCE(qual, '') || E'\n' || COALESCE(with_check, ''), E'\s+', '', 'g')),
      'sha256'), 'hex') AS normalized_sha256,
    pg_catalog.encode(extensions.digest(
      COALESCE(qual, '') || E'\n' || COALESCE(with_check, ''), 'sha256'), 'hex') AS raw_sha256
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
), object_rows AS (
  SELECT object.bucket_id, object.name, COALESCE(object.id::text, '') AS object_id,
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.to_jsonb(object)::text, 'UTF8')), 'hex') AS row_sha256
  FROM storage.objects AS object
)
SELECT pg_catalog.statement_timestamp()::text AS observed_at,
  (SELECT count(*)::integer FROM actual_buckets) AS bucket_count,
  (SELECT count(*)::integer FROM actual_policies) AS policy_count,
  NOT EXISTS (
    (SELECT id, id AS name, is_public AS public, file_size_limit, allowed_mime_types
       FROM expected_buckets EXCEPT ALL SELECT * FROM actual_buckets)
    UNION ALL
    (SELECT * FROM actual_buckets EXCEPT ALL
       SELECT id, id, is_public, file_size_limit, allowed_mime_types FROM expected_buckets)
  ) AS exact_bucket_contract_verified,
  NOT EXISTS (
    SELECT 1 FROM expected_policies AS expected FULL JOIN actual_policies AS actual
      USING (policyname)
    WHERE expected.policyname IS NULL OR actual.policyname IS NULL
      OR actual.permissive IS DISTINCT FROM expected.permissive
      OR actual.roles IS DISTINCT FROM expected.roles
      OR actual.cmd IS DISTINCT FROM expected.cmd
      OR CASE expected.hash_mode WHEN 'normalized' THEN actual.normalized_sha256
           ELSE actual.raw_sha256 END IS DISTINCT FROM expected.expression_sha256
  ) AS exact_policy_contract_verified,
  (SELECT count(*)::integer FROM object_rows) AS object_count,
  upper(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(COALESCE((
    SELECT pg_catalog.string_agg(row_sha256, '' ORDER BY bucket_id, name, object_id)
    FROM object_rows), ''), 'UTF8')), 'hex')) AS object_inventory_sha256,
  0::integer AS required_storage_object_mutation_count;

ROLLBACK;
