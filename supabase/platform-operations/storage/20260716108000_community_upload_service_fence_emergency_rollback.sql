-- EMERGENCY SECURITY-REGRESSING PRESTATE RESTORE / MANUAL REFERENCE ONLY.
-- DO NOT run through db push or SQL Editor. Normal rollback disables upload
-- entry points and keeps the Storage fence. Only a time-bounded incident
-- approval may reproduce these 19 pre-operation policies in
-- Dashboard > Storage > Policies.
-- This exact inverse reopens public reads, unsigned writes, update/delete, and
-- vendor cost/validation bypasses; it reopens the cost-control bypass. Run
-- rollback_verify.sql immediately after.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $storage_emergency_rollback_precondition$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'storage' AND relation.relname = 'objects'
      AND relation.relkind = 'r' AND relation.relrowsecurity
      AND NOT relation.relforcerowsecurity
      AND pg_catalog.pg_get_userbyid(relation.relowner) = 'supabase_storage_admin'
  ) OR pg_catalog.to_regprocedure('extensions.digest(text,text)') IS NULL THEN
    RAISE EXCEPTION 'STORAGE_EMERGENCY_ROLLBACK_RELATION_INVALID';
  END IF;

  IF EXISTS (
    WITH allowed(policyname, permissive, roles, cmd, expression_sha256) AS (
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
      SELECT policyname::text, permissive::text, roles, cmd::text,
        pg_catalog.encode(extensions.digest(lower(pg_catalog.regexp_replace(
          COALESCE(qual, '') || E'\n' || COALESCE(with_check, ''),
          E'\\s+', '', 'g')), 'sha256'), 'hex') AS expression_sha256
      FROM pg_catalog.pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
    )
    SELECT 1 FROM actual
    WHERE NOT EXISTS (
      SELECT 1 FROM allowed
      WHERE allowed.policyname = actual.policyname
        AND allowed.permissive = actual.permissive
        AND allowed.roles = actual.roles
        AND allowed.cmd = actual.cmd
        AND allowed.expression_sha256 = actual.expression_sha256
    ) AND NOT (
      actual.permissive = 'PERMISSIVE'
      AND actual.roles = ARRAY['authenticated']::name[]
      AND actual.cmd = 'INSERT'
      AND actual.expression_sha256 = '7b9e967897a69bdc226f09e02a240db1ca64f0caeb58244912445ff0f5032482'
    )
  ) THEN
    RAISE EXCEPTION 'STORAGE_EMERGENCY_ROLLBACK_UNKNOWN_POLICY';
  END IF;
END;
$storage_emergency_rollback_precondition$;

-- The precondition accepts only exact historical definitions or the exact
-- provisional final semantic policy. Drop by catalog name so generated suffix
-- drift cannot strand a policy before recreating the 19-row incident prestate.
DO $storage_emergency_rollback_drop_reviewed_policies$
DECLARE
  reviewed_policy_name text;
BEGIN
  FOR reviewed_policy_name IN
    SELECT policyname::text
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY %I ON storage.objects', reviewed_policy_name
    );
  END LOOP;
END;
$storage_emergency_rollback_drop_reviewed_policies$;

CREATE POLICY "Anyone can view chat image"
  ON storage.objects AS PERMISSIVE FOR SELECT TO public
  USING (bucket_id = 'chat-image');

CREATE POLICY "Anyone can view chat images"
  ON storage.objects AS PERMISSIVE FOR SELECT TO public
  USING (bucket_id = 'chat-images');

CREATE POLICY "Authenticated users can upload chat image"
  ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'chat-image');

CREATE POLICY "Authenticated users can upload chat images"
  ON storage.objects AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (bucket_id = 'chat-images' AND auth.role() = 'authenticated');

CREATE POLICY "chat-image couple folder write"
  ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-image'
    AND (storage.foldername(name))[1] IN (
      SELECT couple_id::text
      FROM public.profiles
      WHERE id = auth.uid() AND couple_id IS NOT NULL
    )
  );

CREATE POLICY "chat-image couple folder update"
  ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    bucket_id = 'chat-image'
    AND (storage.foldername(name))[1] IN (
      SELECT couple_id::text
      FROM public.profiles
      WHERE id = auth.uid() AND couple_id IS NOT NULL
    )
  )
  WITH CHECK (
    bucket_id = 'chat-image'
    AND (storage.foldername(name))[1] IN (
      SELECT couple_id::text
      FROM public.profiles
      WHERE id = auth.uid() AND couple_id IS NOT NULL
    )
  );

CREATE POLICY "chat-image couple folder delete"
  ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
  USING (
    bucket_id = 'chat-image'
    AND (storage.foldername(name))[1] IN (
      SELECT couple_id::text
      FROM public.profiles
      WHERE id = auth.uid() AND couple_id IS NOT NULL
    )
  );

CREATE POLICY "chat-image own uploader folder write pf46ue_0"
  ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-image'
    AND array_length(storage.foldername(name), 1) = 2
    AND (storage.foldername(name))[1] IN (
      SELECT couple_id::text FROM public.profiles
      WHERE id = auth.uid() AND couple_id IS NOT NULL
    )
    AND (storage.foldername(name))[2] = auth.uid()::text
    AND char_length(name) <= 512
    AND split_part(name, '/', 3) ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    AND strpos(name, E'\\') = 0
    AND name !~ '(^|/)\.\.?(/|$)'
    AND name !~* '%(2e|2f|5c|25)'
    AND name !~ '[?#]'
  );

CREATE POLICY "community-images own folder write"
  ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'community-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND array_length(storage.foldername(name), 1) >= 1
  );

CREATE POLICY "community-images own folder update"
  ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    bucket_id = 'community-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'community-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND array_length(storage.foldername(name), 1) >= 1
  );

CREATE POLICY "community-images own folder delete"
  ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
  USING (
    bucket_id = 'community-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "community-videos own folder write"
  ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'community-videos'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND array_length(storage.foldername(name), 1) >= 1
  );

CREATE POLICY "community-videos own folder update"
  ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    bucket_id = 'community-videos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'community-videos'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND array_length(storage.foldername(name), 1) >= 1
  );

CREATE POLICY "community-videos own folder delete"
  ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
  USING (
    bucket_id = 'community-videos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "공개: 업체 이미지 조회"
  ON storage.objects AS PERMISSIVE FOR SELECT TO public
  USING (bucket_id = 'vendor-images');

CREATE POLICY "서비스: 사업자등록증 조회"
  ON storage.objects AS PERMISSIVE FOR SELECT TO public
  USING (bucket_id = 'vendor-licenses' AND auth.role() = 'service_role');

CREATE POLICY "업체: 본인 이미지 업로드"
  ON storage.objects AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (bucket_id = 'vendor-images' AND auth.role() = 'authenticated');

CREATE POLICY "업체: 본인 이미지 삭제"
  ON storage.objects AS PERMISSIVE FOR DELETE TO public
  USING (
    bucket_id = 'vendor-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "업체: 사업자등록증 업로드"
  ON storage.objects AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (bucket_id = 'vendor-licenses' AND auth.role() = 'authenticated');

DO $storage_exact_rollback_postcondition$
BEGIN
  IF EXISTS (
    WITH expected(policyname, permissive, roles, cmd, expression_sha256) AS (
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
      SELECT policyname::text, permissive::text, roles, cmd::text,
        pg_catalog.encode(extensions.digest(
          lower(pg_catalog.regexp_replace(
            COALESCE(qual, '') || E'\n' || COALESCE(with_check, ''),
            E'\\s+', '', 'g'
          )), 'sha256'
        ), 'hex') AS expression_sha256
      FROM pg_catalog.pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
    )
    SELECT 1
    FROM expected FULL JOIN actual USING (policyname)
    WHERE expected.policyname IS NULL OR actual.policyname IS NULL
       OR actual.permissive IS DISTINCT FROM expected.permissive
       OR actual.roles IS DISTINCT FROM expected.roles
       OR actual.cmd IS DISTINCT FROM expected.cmd
       OR actual.expression_sha256 IS DISTINCT FROM expected.expression_sha256
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_UPLOAD_PLATFORM_ROLLBACK_INCOMPLETE'
      USING ERRCODE = '42501';
  END IF;
END;
$storage_exact_rollback_postcondition$;

COMMIT;
