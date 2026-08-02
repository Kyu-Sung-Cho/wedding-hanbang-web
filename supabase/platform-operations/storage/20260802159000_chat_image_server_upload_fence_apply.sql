-- FORWARD PLATFORM OPERATION / CHAT-IMAGE SERVER-OWNED UPLOAD FENCE.
--
-- Do not run through supabase db push or a normal SQL-editor session. Hosted
-- Supabase owns storage.objects as supabase_storage_admin. Reproduce this exact
-- reviewed policy removal through Dashboard > Storage > Policies after the
-- server-side sanitizer/storage path is deployed and its canary passes.
--
-- The service_role bypasses RLS and retains table INSERT/UPDATE/SELECT grants;
-- authenticated clients retain no storage.objects policy and therefore cannot
-- upload, overwrite, read, or delete an object directly. Existing objects are
-- inventoried but never deleted or rewritten by this operation.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $chat_image_server_upload_fence_apply$
DECLARE
  total_policy_count bigint;
  reviewed_direct_policy_count bigint;
  reviewed_freeze_policy_count bigint;
  chat_object_count_before bigint;
  reviewed_policy_name text;
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
    RAISE EXCEPTION 'CHAT_IMAGE_SERVER_UPLOAD_FENCE_RELATION_INVALID';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles AS role_record
    WHERE role_record.rolname = 'service_role'
      AND role_record.rolbypassrls
  )
  OR NOT pg_catalog.has_table_privilege(
    'service_role', 'storage.objects', 'SELECT'
  )
  OR NOT pg_catalog.has_table_privilege(
    'service_role', 'storage.objects', 'INSERT'
  )
  OR NOT pg_catalog.has_table_privilege(
    'service_role', 'storage.objects', 'UPDATE'
  ) THEN
    RAISE EXCEPTION 'CHAT_IMAGE_SERVER_UPLOAD_FENCE_SERVICE_ROLE_INVALID';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.buckets AS bucket
    WHERE bucket.id = 'chat-image'
      AND bucket.name = 'chat-image'
      AND bucket.public IS FALSE
      AND bucket.file_size_limit = 3 * 1024 * 1024
      AND bucket.allowed_mime_types = ARRAY[
        'image/jpeg', 'image/png', 'image/gif', 'image/webp'
      ]::text[]
  ) THEN
    RAISE EXCEPTION 'CHAT_IMAGE_SERVER_UPLOAD_FENCE_BUCKET_INVALID';
  END IF;

  SELECT count(*), count(*) FILTER (
    WHERE policy.permissive = 'PERMISSIVE'
      AND policy.roles = ARRAY['authenticated']::name[]
      AND policy.cmd = 'INSERT'
      AND pg_catalog.encode(extensions.digest(lower(pg_catalog.regexp_replace(
        COALESCE(policy.qual, '') || E'\n' || COALESCE(policy.with_check, ''),
        E'\\s+', '', 'g'
      )), 'sha256'), 'hex') =
        '7b9e967897a69bdc226f09e02a240db1ca64f0caeb58244912445ff0f5032482'
  ), count(*) FILTER (
    WHERE policy.permissive = 'PERMISSIVE'
      AND policy.roles = ARRAY['public']::name[]
      AND policy.cmd = 'SELECT'
      AND (
        (
          policy.policyname = 'Anyone can view chat image'
          AND pg_catalog.encode(extensions.digest(lower(pg_catalog.regexp_replace(
            COALESCE(policy.qual, '') || E'\n' || COALESCE(policy.with_check, ''),
            E'\\s+', '', 'g'
          )), 'sha256'), 'hex') =
            '11a6595c0534cd28fc75eace428725eb971ed106208189913fc328fafe4fed23'
        )
        OR (
          policy.policyname = 'Anyone can view chat images'
          AND pg_catalog.encode(extensions.digest(lower(pg_catalog.regexp_replace(
            COALESCE(policy.qual, '') || E'\n' || COALESCE(policy.with_check, ''),
            E'\\s+', '', 'g'
          )), 'sha256'), 'hex') =
            '3e004f601bc171c755a6dad45c4abac266024ae16b050ac53005dee54c0a3ddb'
        )
        OR (
          policy.policyname = '공개: 업체 이미지 조회'
          AND pg_catalog.encode(extensions.digest(lower(pg_catalog.regexp_replace(
            COALESCE(policy.qual, '') || E'\n' || COALESCE(policy.with_check, ''),
            E'\\s+', '', 'g'
          )), 'sha256'), 'hex') =
            '58225493db8405746e0170ff05141dfc86d73e4445ece3fbe33473420e0d8033'
        )
        OR (
          policy.policyname = '서비스: 사업자등록증 조회'
          AND pg_catalog.encode(extensions.digest(lower(pg_catalog.regexp_replace(
            COALESCE(policy.qual, '') || E'\n' || COALESCE(policy.with_check, ''),
            E'\\s+', '', 'g'
          )), 'sha256'), 'hex') =
            '1beeec48bf3997f33f65db1f2076e1efab8d014d5fb0d1df59e1f3b7a4afe177'
        )
      )
  )
  INTO total_policy_count, reviewed_direct_policy_count,
    reviewed_freeze_policy_count
  FROM pg_catalog.pg_policies AS policy
  WHERE policy.schemaname = 'storage' AND policy.tablename = 'objects';

  -- Accept the exact phase-1 four-read freeze, the reviewed transitional
  -- one-policy prestate, or an idempotent zero-policy retry. Any other read or
  -- mutation policy is drift and must fail closed.
  IF NOT (
    total_policy_count = 0
    OR (
      total_policy_count = 1
      AND reviewed_direct_policy_count = 1
      AND reviewed_freeze_policy_count = 0
    )
    OR (
      total_policy_count = 4
      AND reviewed_direct_policy_count = 0
      AND reviewed_freeze_policy_count = 4
    )
  ) THEN
    RAISE EXCEPTION 'CHAT_IMAGE_SERVER_UPLOAD_FENCE_POLICY_DRIFT';
  END IF;

  SELECT count(*)
  INTO chat_object_count_before
  FROM storage.objects AS storage_object
  WHERE storage_object.bucket_id = 'chat-image';

  FOR reviewed_policy_name IN
    SELECT policy.policyname::text
    FROM pg_catalog.pg_policies AS policy
    WHERE policy.schemaname = 'storage' AND policy.tablename = 'objects'
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY %I ON storage.objects', reviewed_policy_name
    );
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies AS policy
    WHERE policy.schemaname = 'storage' AND policy.tablename = 'objects'
  ) THEN
    RAISE EXCEPTION 'CHAT_IMAGE_SERVER_UPLOAD_FENCE_POLICY_REMOVAL_FAILED';
  END IF;

  IF (
    SELECT count(*)
    FROM storage.objects AS storage_object
    WHERE storage_object.bucket_id = 'chat-image'
  ) IS DISTINCT FROM chat_object_count_before THEN
    RAISE EXCEPTION 'CHAT_IMAGE_SERVER_UPLOAD_FENCE_OBJECT_INVENTORY_CHANGED';
  END IF;
END;
$chat_image_server_upload_fence_apply$;

COMMIT;
