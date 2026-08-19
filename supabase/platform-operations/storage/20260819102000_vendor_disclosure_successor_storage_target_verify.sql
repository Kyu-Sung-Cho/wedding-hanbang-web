-- READ-ONLY successor final target verifier. No statement in this file mutates Storage.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';

WITH expected_buckets(id, is_public, file_size_limit, allowed_mime_types) AS (
  VALUES
    ('chat-image'::text, false, NULL::bigint, NULL::text[]),
    ('cohort-images', true, NULL::bigint, NULL::text[]),
    ('community-images', true, 10485760::bigint, ARRAY['image/jpeg','image/png','image/gif','image/webp']::text[]),
    ('community-videos', true, 52428800::bigint, ARRAY['video/mp4','video/quicktime','video/webm']::text[]),
    ('community-media-staging', false, 6291456::bigint, ARRAY['image/jpeg','image/png','image/gif','image/webp']::text[]),
    ('disclosure-preview', false, 2097152::bigint, ARRAY['text/plain']::text[]),
    ('disclosure-raw', false, 52428800::bigint,
      ARRAY['application/haansofthwp','application/json','application/pdf',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/x-hwp','image/png']::text[]),
    ('guestbook-images', false, NULL::bigint, NULL::text[]),
    ('guestbook-uploads', false, 5242880::bigint, ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif']::text[]),
    ('invitation-photos', true, 10485760::bigint, ARRAY['image/jpeg','image/png','image/webp','image/heic']::text[]),
    ('user_photos', true, NULL::bigint, NULL::text[]),
    ('vendor-images', true, 5242880::bigint, ARRAY['image/jpeg','image/png','image/webp']::text[]),
    ('vendor-licenses', false, 10485760::bigint, ARRAY['image/jpeg','image/png','application/pdf']::text[])
), expected_policies(semantic_key, permissive, roles, cmd, expression_sha256) AS (
  VALUES
    ('chat-image-strict-insert'::text, 'PERMISSIVE', ARRAY['authenticated']::name[], 'INSERT', '64bbc946e4c70b9629b21e9a151e5faa95c228acb80dfa4f26778f472b246e19'),
    ('disclosure_evidence_client_select_fence', 'RESTRICTIVE', ARRAY['anon','authenticated']::name[], 'SELECT', 'ff185265a9865290b5ba9ff77472377fa8d0b707e7bfef65c1ee40f759d1389f'),
    ('disclosure_evidence_client_insert_fence', 'RESTRICTIVE', ARRAY['anon','authenticated']::name[], 'INSERT', '24edd073465ecb17ec3baee29c679abda37160c55eb8bda58ecd20e0c7e625de'),
    ('disclosure_evidence_client_update_fence', 'RESTRICTIVE', ARRAY['anon','authenticated']::name[], 'UPDATE', '2443f1653a213dde8c5e3edec0c42258c90ac94464397cd644ce6c2d1ddc60ac'),
    ('disclosure_evidence_client_delete_fence', 'RESTRICTIVE', ARRAY['anon','authenticated']::name[], 'DELETE', 'ff185265a9865290b5ba9ff77472377fa8d0b707e7bfef65c1ee40f759d1389f')
), actual_buckets AS (
  SELECT id::text, name::text, public, file_size_limit, allowed_mime_types FROM storage.buckets
), raw_policies AS (
  SELECT policyname::text, permissive::text, roles, cmd::text,
    pg_catalog.encode(extensions.digest(
      COALESCE(qual, '') || E'\n' || COALESCE(with_check, ''), 'sha256'), 'hex') AS expression_sha256
  FROM pg_catalog.pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
), actual_policies AS (
  SELECT CASE WHEN permissive = 'PERMISSIVE' AND roles = ARRAY['authenticated']::name[]
      AND cmd = 'INSERT' AND expression_sha256 = '64bbc946e4c70b9629b21e9a151e5faa95c228acb80dfa4f26778f472b246e19'
    THEN 'chat-image-strict-insert' ELSE policyname END AS semantic_key,
    permissive, roles, cmd, expression_sha256 FROM raw_policies
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
    (SELECT id, id AS name, is_public AS public, file_size_limit, allowed_mime_types FROM expected_buckets
      EXCEPT ALL SELECT * FROM actual_buckets)
    UNION ALL
    (SELECT * FROM actual_buckets EXCEPT ALL
      SELECT id, id, is_public, file_size_limit, allowed_mime_types FROM expected_buckets)
  ) AS exact_bucket_contract_verified,
  NOT EXISTS (
    (SELECT * FROM expected_policies EXCEPT ALL SELECT * FROM actual_policies)
    UNION ALL (SELECT * FROM actual_policies EXCEPT ALL SELECT * FROM expected_policies)
  ) AS exact_policy_contract_verified,
  (SELECT count(*)::integer FROM object_rows) AS object_count,
  upper(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(COALESCE((
    SELECT pg_catalog.string_agg(row_sha256, '' ORDER BY bucket_id, name, object_id)
    FROM object_rows), ''), 'UTF8')), 'hex')) AS object_inventory_sha256,
  0::integer AS required_storage_object_mutation_count;

ROLLBACK;
