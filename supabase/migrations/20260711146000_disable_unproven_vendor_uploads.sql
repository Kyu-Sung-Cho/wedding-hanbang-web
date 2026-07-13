BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

-- Vendor uploads have no proven account-deletion ownership or retention model.
-- Freeze Storage writes before inspecting the legacy surface so no upload can
-- race the gate and policy removal. Existing objects require an explicit export
-- and product decision; this migration never deletes or rewrites them.
LOCK TABLE storage.objects IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  v_vendor_license_objects bigint;
  v_uuid_vendor_image_objects bigint;
BEGIN
  SELECT count(*) INTO v_vendor_license_objects
  FROM storage.objects
  WHERE bucket_id = 'vendor-licenses';

  SELECT count(*) INTO v_uuid_vendor_image_objects
  FROM storage.objects
  WHERE bucket_id = 'vendor-images'
    AND (storage.foldername(name))[1] ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

  IF v_vendor_license_objects <> 0 OR v_uuid_vendor_image_objects <> 0 THEN
    RAISE EXCEPTION
      'UNPROVEN_VENDOR_UPLOADS_PRESENT: vendor-licenses=%, UUID-scoped vendor-images=%',
      v_vendor_license_objects, v_uuid_vendor_image_objects
      USING ERRCODE = '55000',
        HINT = 'Export and classify these objects, then approve a provenance, retention, and account-deletion policy before retrying. Automatic deletion is forbidden.';
  END IF;
END;
$$;

DROP POLICY IF EXISTS "업체: 본인 이미지 업로드" ON storage.objects;
DROP POLICY IF EXISTS "업체: 사업자등록증 업로드" ON storage.objects;
DROP POLICY IF EXISTS "vendor images own folder insert" ON storage.objects;
DROP POLICY IF EXISTS "vendor licenses own folder insert" ON storage.objects;

-- Keep the reviewed community/guestbook lifecycle serialization intact while
-- denying both vendor buckets to every request except the trusted service JWT.
CREATE OR REPLACE FUNCTION public.guard_user_media_storage_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
  v_scope_text text;
  v_scope_id uuid;
  v_deleting_at timestamptz;
BEGIN
  IF NEW.bucket_id IN ('vendor-images', 'vendor-licenses') THEN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
      RAISE EXCEPTION 'vendor uploads are disabled pending provenance and retention review'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.bucket_id NOT IN (
    'community-images', 'community-videos', 'guestbook-uploads'
  ) THEN
    RETURN NEW;
  END IF;

  v_scope_text := (storage.foldername(NEW.name))[1];
  BEGIN
    v_scope_id := v_scope_text::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'invalid guarded storage owner path' USING ERRCODE = '22023';
  END;

  IF NEW.bucket_id IN ('community-images', 'community-videos') THEN
    SELECT account_deleting_at INTO v_deleting_at
    FROM public.profiles
    WHERE id = v_scope_id
    FOR UPDATE;
    IF NOT FOUND OR v_deleting_at IS NOT NULL THEN
      RAISE EXCEPTION 'community media owner is not active' USING ERRCODE = '42501';
    END IF;
  ELSE
    SELECT profile.account_deleting_at INTO v_deleting_at
    FROM public.guestbooks AS guestbook
    JOIN public.profiles AS profile ON profile.id = guestbook.owner_id
    WHERE guestbook.id = v_scope_id
    FOR UPDATE OF profile;
    IF NOT FOUND OR v_deleting_at IS NOT NULL THEN
      RAISE EXCEPTION 'guestbook media owner is not active' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.guard_user_media_storage_write() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_user_media_storage_write()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_user_media_storage_write()
  TO service_role;

DROP TRIGGER IF EXISTS trg_guard_user_media_storage_write ON storage.objects;
CREATE TRIGGER trg_guard_user_media_storage_write
  BEFORE INSERT OR UPDATE ON storage.objects
  FOR EACH ROW EXECUTE FUNCTION public.guard_user_media_storage_write();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM storage.objects
    WHERE bucket_id = 'vendor-licenses'
       OR (
         bucket_id = 'vendor-images'
         AND (storage.foldername(name))[1] ~*
           '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       )
  ) THEN
    RAISE EXCEPTION 'UNPROVEN_VENDOR_UPLOAD_OBJECT_GATE_MISMATCH'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname IN (
        '업체: 본인 이미지 업로드',
        '업체: 사업자등록증 업로드',
        'vendor images own folder insert',
        'vendor licenses own folder insert'
      )
  ) THEN
    RAISE EXCEPTION 'VENDOR_UPLOAD_INSERT_POLICY_STILL_PRESENT'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc procedure_row
    WHERE procedure_row.oid = to_regprocedure('public.guard_user_media_storage_write()')
      AND pg_get_function_result(procedure_row.oid) = 'trigger'
      AND procedure_row.prosecdef
      AND pg_get_userbyid(procedure_row.proowner) = 'postgres'
      AND procedure_row.proconfig @>
        ARRAY['search_path=public, storage, pg_temp']::text[]
      AND md5(replace(procedure_row.prosrc, chr(13), '')) =
        '2f2ef78416318e6dd8fbd66c3507a2f9'
      AND procedure_row.proargnames IS NULL
      AND has_function_privilege('service_role', procedure_row.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', procedure_row.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', procedure_row.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'VENDOR_UPLOAD_GUARD_FUNCTION_CONTRACT_MISMATCH'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger trigger_row
    WHERE trigger_row.tgrelid = to_regclass('storage.objects')
      AND trigger_row.tgname = 'trg_guard_user_media_storage_write'
      AND NOT trigger_row.tgisinternal
      AND trigger_row.tgenabled = 'O'
      AND trigger_row.tgfoid =
        to_regprocedure('public.guard_user_media_storage_write()')
      AND pg_get_triggerdef(trigger_row.oid, true) =
        'CREATE TRIGGER trg_guard_user_media_storage_write BEFORE INSERT OR UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION guard_user_media_storage_write()'
  ) THEN
    RAISE EXCEPTION 'VENDOR_UPLOAD_GUARD_TRIGGER_CONTRACT_MISMATCH'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

COMMIT;
