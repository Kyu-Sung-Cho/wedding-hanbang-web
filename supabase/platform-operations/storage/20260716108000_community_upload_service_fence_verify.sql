-- READ ONLY / PHASE 2 FINAL HOSTED VERIFICATION.
-- Run after the post-migration Dashboard operation and before any app deploy.

BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';

DO $community_upload_platform_verify$
DECLARE
  procedure_record pg_catalog.pg_proc%ROWTYPE;
  production_fence_record pg_catalog.pg_proc%ROWTYPE;
  membership_record pg_catalog.pg_proc%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'storage' AND relation.relname = 'objects'
      AND relation.relkind = 'r' AND relation.relrowsecurity
      AND NOT relation.relforcerowsecurity
      AND pg_catalog.pg_get_userbyid(relation.relowner) = 'supabase_storage_admin'
  ) OR pg_catalog.to_regprocedure('extensions.digest(text,text)') IS NULL THEN
    RAISE EXCEPTION 'COMMUNITY_UPLOAD_PLATFORM_VERIFY_FAILED: relation contract';
  END IF;

  SELECT * INTO procedure_record FROM pg_catalog.pg_proc
  WHERE oid = pg_catalog.to_regprocedure(
    'public.account_deletion_storage_writes_allowed()'
  );
  IF NOT FOUND OR procedure_record.prokind <> 'f'
     OR NOT procedure_record.prosecdef OR procedure_record.provolatile <> 'v'
     OR pg_catalog.pg_get_userbyid(procedure_record.proowner) <> 'postgres'
     OR procedure_record.proconfig IS DISTINCT FROM ARRAY[
       'search_path=""', 'lock_timeout=5s', 'statement_timeout=10s'
     ]::text[]
     OR pg_catalog.has_function_privilege('anon', procedure_record.oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', procedure_record.oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', procedure_record.oid, 'EXECUTE')
     OR position('pg_advisory_xact_lock' IN procedure_record.prosrc) = 0
     OR position('hashtextextended(v_user_id::text, 0)' IN procedure_record.prosrc) = 0
     OR position('job.status <> ''completed''' IN procedure_record.prosrc) = 0
     OR pg_catalog.encode(extensions.digest(lower(pg_catalog.regexp_replace(
       procedure_record.prosrc, E'\\s+', '', 'g'
     )), 'sha256'), 'hex') <>
       '0b785a6700c258851930b44d1502a2c595de5e7e3d19e10183dfe2d25c454930'
     OR EXISTS (
       SELECT 1 FROM pg_catalog.aclexplode(COALESCE(
         procedure_record.proacl,
         pg_catalog.acldefault('f', procedure_record.proowner)
       )) AS acl_entry
       WHERE acl_entry.grantee = 0 AND acl_entry.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'COMMUNITY_UPLOAD_PLATFORM_VERIFY_FAILED: deletion fence';
  END IF;

  SELECT * INTO membership_record FROM pg_catalog.pg_proc
  WHERE oid = pg_catalog.to_regprocedure(
    'public.is_current_couple_path_member(text)'
  );
  IF NOT FOUND OR membership_record.prokind <> 'f'
     OR NOT membership_record.prosecdef
     OR membership_record.provolatile <> 's'
     OR pg_catalog.pg_get_userbyid(membership_record.proowner) <> 'postgres'
     OR membership_record.proconfig IS DISTINCT FROM ARRAY[
       'search_path=pg_catalog, public', 'statement_timeout=5s'
     ]::text[]
     OR pg_catalog.has_function_privilege('anon', membership_record.oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', membership_record.oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', membership_record.oid, 'EXECUTE')
     OR position('lower(btrim(p_couple_id_text))' IN membership_record.prosrc) = 0
     OR position('couple.bride_id = profile.id' IN membership_record.prosrc) = 0
     OR position('couple.groom_id = profile.id' IN membership_record.prosrc) = 0
     OR pg_catalog.encode(extensions.digest(lower(pg_catalog.regexp_replace(
       membership_record.prosrc, E'\\s+', '', 'g'
     )), 'sha256'), 'hex') <>
       '72019e8324f0d8e014f06fbdb6e4dfb4dffa80254a58c421b11631d85dff4e5e'
     OR EXISTS (
       SELECT 1 FROM pg_catalog.aclexplode(COALESCE(
         membership_record.proacl,
         pg_catalog.acldefault('f', membership_record.proowner)
       )) AS acl_entry
       WHERE acl_entry.grantee = 0 AND acl_entry.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'COMMUNITY_UPLOAD_PLATFORM_VERIFY_FAILED: membership fence';
  END IF;

  SELECT * INTO production_fence_record FROM pg_catalog.pg_proc
  WHERE oid = pg_catalog.to_regprocedure(
    'public.production_storage_writes_allowed()'
  );
  IF NOT FOUND OR production_fence_record.prokind <> 'f'
     OR NOT production_fence_record.prosecdef
     OR production_fence_record.provolatile <> 's'
     OR pg_catalog.pg_get_userbyid(production_fence_record.proowner) <> 'postgres'
     OR production_fence_record.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
     OR pg_catalog.has_function_privilege('anon', production_fence_record.oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', production_fence_record.oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', production_fence_record.oid, 'EXECUTE')
     OR position('trg_production_write_fence_20260717' IN production_fence_record.prosrc) = 0
     OR position('evt_production_write_fence_20260717' IN production_fence_record.prosrc) = 0
     OR position('public.production_write_fence_guard_20260717()' IN production_fence_record.prosrc) = 0
     OR position('public.production_write_fence_attach_20260717()' IN production_fence_record.prosrc) = 0
     OR pg_catalog.encode(extensions.digest(lower(pg_catalog.regexp_replace(
       production_fence_record.prosrc, E'\\s+', '', 'g'
     )), 'sha256'), 'hex') <>
       '2d68394af998108f9f35441e53d3ec1dfcde0f5f450e736aa78bd55efae50316'
     OR EXISTS (
       SELECT 1 FROM pg_catalog.aclexplode(COALESCE(
         production_fence_record.proacl,
         pg_catalog.acldefault('f', production_fence_record.proowner)
       )) AS acl_entry
       WHERE acl_entry.grantee = 0 AND acl_entry.privilege_type = 'EXECUTE'
     )
     OR public.production_storage_writes_allowed() THEN
    RAISE EXCEPTION 'COMMUNITY_UPLOAD_PLATFORM_VERIFY_FAILED: production fence';
  END IF;

  IF EXISTS (
    WITH expected(id, is_public, file_size_limit, allowed_mime_types, object_count) AS (
      VALUES
        ('chat-image'::text, false, 3 * 1024 * 1024,
          ARRAY['image/jpeg','image/png','image/gif','image/webp']::text[], 6::bigint),
        ('cohort-images', false, NULL::bigint, NULL::text[], 0::bigint),
        ('community-images', true, 10 * 1024 * 1024, ARRAY['image/jpeg','image/png','image/gif','image/webp']::text[], 43::bigint),
        ('community-videos', true, 50 * 1024 * 1024, ARRAY['video/mp4','video/quicktime','video/webm']::text[], 0::bigint),
        ('guestbook-images', false, NULL::bigint, NULL::text[], 0::bigint),
        ('guestbook-uploads', false, 5 * 1024 * 1024, ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif']::text[], 0::bigint),
        ('invitation-photos', false, 10 * 1024 * 1024, ARRAY['image/jpeg','image/png','image/webp','image/heic']::text[], 0::bigint),
        ('user_photos', false, NULL::bigint, NULL::text[], 0::bigint),
        ('vendor-images', true, 5 * 1024 * 1024, ARRAY['image/jpeg','image/png','image/webp']::text[], 0::bigint),
        ('vendor-licenses', false, 10 * 1024 * 1024, ARRAY['image/jpeg','image/png','application/pdf']::text[], 0::bigint),
        ('community-media-staging', false, 6 * 1024 * 1024, ARRAY['image/jpeg','image/png','image/gif','image/webp']::text[], 0::bigint)
    ), actual AS (
      SELECT bucket.id, bucket.name, bucket.public, bucket.file_size_limit,
        bucket.allowed_mime_types, count(storage_object.id)::bigint AS object_count
      FROM storage.buckets AS bucket
      LEFT JOIN storage.objects AS storage_object ON storage_object.bucket_id = bucket.id
      GROUP BY bucket.id, bucket.name, bucket.public,
        bucket.file_size_limit, bucket.allowed_mime_types
    )
    SELECT 1 FROM expected FULL JOIN actual USING (id)
    WHERE expected.id IS NULL OR actual.id IS NULL
       OR actual.name IS DISTINCT FROM expected.id
       OR actual.public IS DISTINCT FROM expected.is_public
       OR actual.file_size_limit IS DISTINCT FROM expected.file_size_limit
       OR actual.allowed_mime_types IS DISTINCT FROM expected.allowed_mime_types
       OR actual.object_count IS DISTINCT FROM expected.object_count
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_UPLOAD_PLATFORM_VERIFY_FAILED: bucket contract';
  END IF;

  IF EXISTS (
    -- Ignore Dashboard-generated policy-name suffixes. Require exactly one
    -- policy with this command/role/predicate semantic fingerprint.
    WITH expected(permissive, roles, cmd, expression_sha256) AS (
      VALUES
        ('PERMISSIVE', ARRAY['authenticated']::name[], 'INSERT', '7b9e967897a69bdc226f09e02a240db1ca64f0caeb58244912445ff0f5032482')
    ), actual AS (
      SELECT permissive::text, roles, cmd::text,
        pg_catalog.encode(extensions.digest(lower(pg_catalog.regexp_replace(
          COALESCE(qual, '') || E'\n' || COALESCE(with_check, ''),
          E'\\s+', '', 'g')), 'sha256'), 'hex') AS expression_sha256
      FROM pg_catalog.pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
    )
    (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_UPLOAD_PLATFORM_VERIFY_FAILED: policy manifest';
  END IF;
END;
$community_upload_platform_verify$;

SELECT policyname, permissive, roles, cmd, qual, with_check,
  pg_catalog.encode(extensions.digest(lower(pg_catalog.regexp_replace(
    COALESCE(qual, '') || E'\n' || COALESCE(with_check, ''),
    E'\\s+', '', 'g')), 'sha256'), 'hex') AS expression_sha256
FROM pg_catalog.pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
ORDER BY policyname;

SELECT true AS storage_final_verified;
COMMIT;
