
SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- Some environments recorded the original 100700 definition before the
-- invitation feature was retired. Reinstall the current storage lifecycle
-- guard so no trigger body can retain the deleted invitations table or the
-- retired invitation-photos bucket.
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
REVOKE ALL ON FUNCTION public.guard_user_media_storage_write()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_user_media_storage_write()
  TO service_role;

DROP TRIGGER IF EXISTS trg_guard_user_media_storage_write ON storage.objects;
CREATE TRIGGER trg_guard_user_media_storage_write
  BEFORE INSERT OR UPDATE ON storage.objects
  FOR EACH ROW EXECUTE FUNCTION public.guard_user_media_storage_write();

-- Reinstall the current inventory validator. The historical function accepted
-- invitation scopes that no longer have a bucket/table and could dead-letter
-- an otherwise valid account-deletion job after the invitation retirement.
CREATE OR REPLACE FUNCTION public.save_account_deletion_storage_inventory(
  p_job_id uuid,
  p_worker_token uuid,
  p_inventory jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF p_inventory IS NULL OR jsonb_typeof(p_inventory) <> 'array' THEN
    RAISE EXCEPTION 'invalid storage inventory' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_inventory) > 500 THEN
    RAISE EXCEPTION 'invalid storage inventory' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_inventory) AS item(value)
    WHERE jsonb_typeof(item.value) <> 'object'
  ) THEN
    RAISE EXCEPTION 'invalid storage inventory' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_inventory) AS item(value)
      WHERE COALESCE(item.value->>'bucket', '') NOT IN (
          'community-images', 'community-videos', 'guestbook-uploads', 'chat-image'
        )
        OR COALESCE(item.value->>'prefix', '') !~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        OR (SELECT count(*) FROM jsonb_object_keys(item.value)) <> 2
    ) THEN
    RAISE EXCEPTION 'invalid storage inventory' USING ERRCODE = '22023';
  END IF;

  UPDATE public.account_deletion_jobs
  SET storage_inventory = p_inventory,
      updated_at = now()
  WHERE id = p_job_id
    AND status = 'processing'
    AND lock_token = p_worker_token
    AND locked_until > now()
    AND storage_inventory IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 1 THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.account_deletion_jobs
    WHERE id = p_job_id
      AND status = 'processing'
      AND lock_token = p_worker_token
      AND locked_until > now()
      AND storage_inventory = p_inventory
  );
END;
$$;
REVOKE ALL ON FUNCTION public.save_account_deletion_storage_inventory(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_account_deletion_storage_inventory(uuid, uuid, jsonb)
  TO service_role;

-- Pin the membership-protection trigger function to the same service-only
-- privilege boundary used by the rest of the lifecycle dependency closure.
REVOKE ALL ON FUNCTION public.prevent_profile_membership_self_change()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prevent_profile_membership_self_change()
  TO service_role;
