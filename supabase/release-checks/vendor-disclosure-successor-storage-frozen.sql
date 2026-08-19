BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';

WITH expected_buckets(id, is_public, file_size_limit, allowed_mime_types) AS (
  VALUES
    ('chat-image'::text, false, NULL::bigint, NULL::text[]),
    ('cohort-images', true, NULL::bigint, NULL::text[]),
    ('community-images', true, 10485760::bigint, ARRAY['image/jpeg','image/png','image/gif','image/webp']::text[]),
    ('community-videos', true, 52428800::bigint, ARRAY['video/mp4','video/quicktime','video/webm']::text[]),
    ('disclosure-preview', false, 2097152::bigint, ARRAY['text/plain']::text[]),
    ('disclosure-raw', false, 52428800::bigint,
      ARRAY['application/haansofthwp','application/json','application/pdf',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/x-hwp','image/png']::text[]),
    ('guestbook-images', true, NULL::bigint, NULL::text[]),
    ('guestbook-uploads', true, 5242880::bigint, ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif']::text[]),
    ('invitation-photos', true, 10485760::bigint, ARRAY['image/jpeg','image/png','image/webp','image/heic']::text[]),
    ('user_photos', true, NULL::bigint, NULL::text[]),
    ('vendor-images', true, 5242880::bigint, ARRAY['image/jpeg','image/png','image/webp']::text[]),
    ('vendor-licenses', false, 10485760::bigint, ARRAY['image/jpeg','image/png','application/pdf']::text[])
), expected_policies(policyname, permissive, roles, cmd, hash_mode, expression_sha256) AS (
  VALUES
    ('Anyone can view chat image', 'PERMISSIVE', ARRAY['public']::name[], 'SELECT', 'normalized', '11a6595c0534cd28fc75eace428725eb971ed106208189913fc328fafe4fed23'),
    ('Anyone can view chat images', 'PERMISSIVE', ARRAY['public']::name[], 'SELECT', 'normalized', '3e004f601bc171c755a6dad45c4abac266024ae16b050ac53005dee54c0a3ddb'),
    ('공개: 업체 이미지 조회', 'PERMISSIVE', ARRAY['public']::name[], 'SELECT', 'normalized', '58225493db8405746e0170ff05141dfc86d73e4445ece3fbe33473420e0d8033'),
    ('서비스: 사업자등록증 조회', 'PERMISSIVE', ARRAY['public']::name[], 'SELECT', 'normalized', '1beeec48bf3997f33f65db1f2076e1efab8d014d5fb0d1df59e1f3b7a4afe177'),
    ('disclosure_evidence_client_select_fence', 'RESTRICTIVE', ARRAY['anon','authenticated']::name[], 'SELECT', 'raw', 'ff185265a9865290b5ba9ff77472377fa8d0b707e7bfef65c1ee40f759d1389f')
), actual_buckets AS (
  SELECT id::text, name::text, public, file_size_limit, allowed_mime_types FROM storage.buckets
), actual_policies AS (
  SELECT policyname::text, permissive::text, roles, cmd::text,
    pg_catalog.encode(extensions.digest(lower(pg_catalog.regexp_replace(
      COALESCE(qual, '') || E'\n' || COALESCE(with_check, ''), E'\s+', '', 'g')),
      'sha256'), 'hex') AS normalized_sha256,
    pg_catalog.encode(extensions.digest(
      COALESCE(qual, '') || E'\n' || COALESCE(with_check, ''), 'sha256'), 'hex') AS raw_sha256
  FROM pg_catalog.pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
), exact_state AS (
  SELECT
    NOT EXISTS (
      (SELECT id, id AS name, is_public AS public, file_size_limit, allowed_mime_types
        FROM expected_buckets EXCEPT ALL SELECT * FROM actual_buckets)
      UNION ALL
      (SELECT * FROM actual_buckets EXCEPT ALL
        SELECT id, id, is_public, file_size_limit, allowed_mime_types FROM expected_buckets)
    ) AS buckets_ok,
    NOT EXISTS (
      SELECT 1 FROM expected_policies AS expected FULL JOIN actual_policies AS actual USING (policyname)
      WHERE expected.policyname IS NULL OR actual.policyname IS NULL
        OR actual.permissive IS DISTINCT FROM expected.permissive
        OR actual.roles IS DISTINCT FROM expected.roles OR actual.cmd IS DISTINCT FROM expected.cmd
        OR CASE expected.hash_mode WHEN 'normalized' THEN actual.normalized_sha256
             ELSE actual.raw_sha256 END IS DISTINCT FROM expected.expression_sha256
    ) AS policies_ok,
    (SELECT count(*) FROM actual_buckets) = 12 AS bucket_count_ok,
    (SELECT count(*) FROM actual_policies) = 5 AS policy_count_ok,
    (SELECT count(*) FROM actual_policies WHERE cmd IN ('INSERT','UPDATE','DELETE','ALL')) = 0
      AS mutation_policy_count_ok
)
SELECT true AS verified,
  CASE WHEN buckets_ok AND policies_ok AND bucket_count_ok
    AND policy_count_ok AND mutation_policy_count_ok THEN 1 ELSE 0 END::integer
  AS successor_storage_frozen_verified_count
FROM exact_state;

ROLLBACK;
