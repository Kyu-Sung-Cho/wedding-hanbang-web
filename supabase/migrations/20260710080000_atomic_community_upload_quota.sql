-- Atomic daily community-upload quota. This is intentionally service-only:
-- clients authenticate at the API boundary and cannot mint/release slots.
-- Lifecycle invariant: 0500's trg_guard_user_media_storage_write locks the
-- same profile row and rejects Storage INSERT/UPDATE once account_deleting_at
-- is set. If Storage wins the lock, deletion waits then sweeps the prefix; if
-- deletion wins, even a late service-role upload commit is rejected.
-- Quota invariant: a community-images metadata INSERT must consume an active
-- reservation in the same database transaction. An upload that arrives after
-- lease expiry is therefore rejected instead of silently exceeding quota.

CREATE TABLE IF NOT EXISTS public.community_upload_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  upload_date date NOT NULL,
  object_path text NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'reserved'
    CHECK (state IN ('reserved', 'completed', 'released')),
  lease_expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  released_at timestamptz
);

CREATE INDEX IF NOT EXISTS community_upload_reservations_daily_idx
  ON public.community_upload_reservations (user_id, upload_date, state);
CREATE INDEX IF NOT EXISTS community_upload_reservations_active_lease_idx
  ON public.community_upload_reservations (user_id, lease_expires_at)
  WHERE state = 'reserved';

ALTER TABLE public.community_upload_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.community_upload_reservations FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.community_upload_reservations TO service_role;

DROP POLICY IF EXISTS community_upload_reservations_service_only
  ON public.community_upload_reservations;
CREATE POLICY community_upload_reservations_service_only
  ON public.community_upload_reservations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Supabase Storage writes its durable object metadata to storage.objects.
-- Complete the quota reservation in that same transaction so a committed
-- object and its ledger row cannot diverge. This also makes it safe for the
-- reservation function to release expired ghost slots: a late metadata INSERT
-- cannot consume a released/expired reservation.
CREATE OR REPLACE FUNCTION public.consume_community_upload_reservation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
  v_user_text text;
  v_user_id uuid;
  v_upload_date date;
  v_state text;
  v_lease_expires_at timestamptz;
  v_account_deleting_at timestamptz;
BEGIN
  IF NEW.bucket_id <> 'community-images' THEN
    RETURN NEW;
  END IF;

  -- Expand/contract compatibility window: the published mobile binary uploads
  -- directly with an authenticated JWT and cannot create a reservation first.
  -- Its existing own-folder RLS policy plus 0500's lifecycle trigger remain the
  -- authorization boundary. The new server route uses service_role and must
  -- consume a reservation. Authenticated bypass is removed only by the gated
  -- future contract migration after old-client traffic reaches zero.
  IF COALESCE(auth.role(), '') = 'authenticated' THEN
    RETURN NEW;
  END IF;

  v_user_text := (storage.foldername(NEW.name))[1];
  BEGIN
    v_user_id := v_user_text::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'invalid community upload owner path' USING ERRCODE = '22023';
  END;

  -- Independently retain the account-deletion fence even if trigger ordering
  -- changes in a later migration.
  SELECT account_deleting_at INTO v_account_deleting_at
  FROM public.profiles
  WHERE id = v_user_id
  FOR UPDATE;
  IF NOT FOUND OR v_account_deleting_at IS NOT NULL THEN
    RAISE EXCEPTION 'community media owner is not active' USING ERRCODE = '42501';
  END IF;

  -- Read the immutable date first, then acquire locks in the same order as
  -- reserve_community_upload: profile -> advisory -> reservation row.
  SELECT upload_date
    INTO v_upload_date
  FROM public.community_upload_reservations
  WHERE user_id = v_user_id
    AND object_path = NEW.name;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active community upload reservation is required'
      USING ERRCODE = '42501';
  END IF;

  -- Match reserve_community_upload's per-user/day lock. This serializes a
  -- metadata commit with new quota decisions without introducing a global lock.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'community-upload:' || v_user_id::text || ':' || v_upload_date::text,
      0
    )
  );

  SELECT state, lease_expires_at
    INTO v_state, v_lease_expires_at
  FROM public.community_upload_reservations
  WHERE user_id = v_user_id
    AND upload_date = v_upload_date
    AND object_path = NEW.name
  FOR UPDATE;
  IF NOT FOUND OR v_state <> 'reserved' OR v_lease_expires_at <= now() THEN
    RAISE EXCEPTION 'active community upload reservation is required'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.community_upload_reservations
  SET state = 'completed',
      completed_at = now(),
      released_at = NULL
  WHERE user_id = v_user_id
    AND object_path = NEW.name
    AND state = 'reserved'
    AND lease_expires_at > now();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'community upload reservation expired'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_community_upload_reservation()
  FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_consume_community_upload_reservation ON storage.objects;
CREATE TRIGGER trg_consume_community_upload_reservation
  BEFORE INSERT ON storage.objects
  FOR EACH ROW EXECUTE FUNCTION public.consume_community_upload_reservation();

CREATE OR REPLACE FUNCTION public.reserve_community_upload(
  p_user_id uuid,
  p_object_path text,
  p_daily_limit integer DEFAULT 20
)
RETURNS TABLE (
  allowed boolean,
  reservation_id uuid,
  reason text,
  reservation_state text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today date := (timezone('utc', now()))::date;
  v_count integer;
  v_id uuid;
  v_state text;
  v_lease_expires_at timestamptz;
  v_account_deleting_at timestamptz;
  v_expected_prefix text;
BEGIN
  IF p_user_id IS NULL
    OR p_daily_limit IS NULL
    OR p_daily_limit < 1
    OR p_daily_limit > 100
  THEN
    RETURN QUERY SELECT false, NULL::uuid, 'invalid_args'::text, NULL::text;
    RETURN;
  END IF;

  -- Serialize against begin_account_deletion(), which locks this same profile
  -- row before setting its lifecycle marker. This closes the marker-read ->
  -- storage-write orphan race.
  SELECT account_deleting_at
    INTO v_account_deleting_at
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;
  IF NOT FOUND OR v_account_deleting_at IS NOT NULL THEN
    RETURN QUERY SELECT false, NULL::uuid, 'account_deleting'::text, NULL::text;
    RETURN;
  END IF;

  v_expected_prefix := p_user_id::text || '/' || v_today::text || '/';
  IF p_object_path IS NULL
     OR length(p_object_path) > 300
     OR left(p_object_path, length(v_expected_prefix)) <> v_expected_prefix THEN
    RETURN QUERY SELECT false, NULL::uuid, 'invalid_object_path'::text, NULL::text;
    RETURN;
  END IF;

  -- Serialize all quota decisions for one user/day without a global lock.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('community-upload:' || p_user_id::text || ':' || v_today::text, 0)
  );

  SELECT id, state, lease_expires_at
    INTO v_id, v_state, v_lease_expires_at
  FROM public.community_upload_reservations
  WHERE user_id = p_user_id
    AND upload_date = v_today
    AND object_path = p_object_path
  FOR UPDATE;

  -- A retry for the same decoded bytes reuses the canonical object path and
  -- ledger row. The API reconciles reserved rows with Storage before upload.
  IF FOUND AND v_state = 'completed' THEN
    RETURN QUERY SELECT true, v_id, 'existing'::text, v_state;
    RETURN;
  END IF;
  IF FOUND AND v_state = 'reserved' THEN
    IF v_lease_expires_at > now() THEN
      RETURN QUERY SELECT false, v_id, 'in_progress'::text, v_state;
      RETURN;
    END IF;
    UPDATE public.community_upload_reservations
    SET lease_expires_at = now() + interval '5 minutes'
    WHERE id = v_id;
    RETURN QUERY SELECT true, v_id, 'reclaimed'::text, v_state;
    RETURN;
  END IF;

  -- A crashed request can leave a reservation without a Storage metadata row.
  -- The Storage trigger above rejects any late commit after lease expiry, so
  -- these stale rows can be released without creating an over-quota object.
  UPDATE public.community_upload_reservations
  SET state = 'released',
      released_at = now()
  WHERE user_id = p_user_id
    AND upload_date = v_today
    AND state = 'reserved'
    AND lease_expires_at <= now();

  SELECT count(*)::integer
    INTO v_count
  FROM public.community_upload_reservations
  WHERE user_id = p_user_id
    AND upload_date = v_today
    AND state IN ('reserved', 'completed');

  IF v_count >= p_daily_limit THEN
    RETURN QUERY SELECT false, NULL::uuid, 'daily_quota'::text, NULL::text;
    RETURN;
  END IF;

  IF v_id IS NOT NULL THEN
    UPDATE public.community_upload_reservations
    SET state = 'reserved',
        completed_at = NULL,
        released_at = NULL,
        lease_expires_at = now() + interval '5 minutes',
        created_at = now()
    WHERE id = v_id
      AND state = 'released';
  ELSE
    INSERT INTO public.community_upload_reservations (
      user_id, upload_date, object_path, state, lease_expires_at
    ) VALUES (
      p_user_id, v_today, p_object_path, 'reserved', now() + interval '5 minutes'
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN QUERY SELECT true, v_id, NULL::text, 'reserved'::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_community_upload(
  p_user_id uuid,
  p_reservation_id uuid,
  p_object_path text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_state text;
BEGIN
  SELECT state INTO v_state
  FROM public.community_upload_reservations
  WHERE id = p_reservation_id
    AND user_id = p_user_id
    AND object_path = p_object_path
  FOR UPDATE;

  IF NOT FOUND OR v_state = 'released' THEN
    RETURN false;
  END IF;
  IF v_state = 'completed' THEN
    RETURN true;
  END IF;

  UPDATE public.community_upload_reservations
  SET state = 'completed', completed_at = now(), released_at = NULL
  WHERE id = p_reservation_id
    AND user_id = p_user_id
    AND object_path = p_object_path
    AND state = 'reserved'
    AND lease_expires_at > now();
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.count_active_community_upload_leases(p_user_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT count(*)
  FROM public.community_upload_reservations
  WHERE user_id = p_user_id
    AND state = 'reserved'
    AND lease_expires_at > now();
$$;

CREATE OR REPLACE FUNCTION public.release_community_upload(
  p_user_id uuid,
  p_reservation_id uuid,
  p_object_path text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.community_upload_reservations
  SET state = 'released', released_at = now()
  WHERE id = p_reservation_id
    AND user_id = p_user_id
    AND object_path = p_object_path
    AND state = 'reserved'
    AND lease_expires_at <= now();
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_community_upload(uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_community_upload(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_community_upload(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.count_active_community_upload_leases(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_community_upload(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_community_upload(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_community_upload(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.count_active_community_upload_leases(uuid) TO service_role;

COMMENT ON TABLE public.community_upload_reservations IS
  'Service-only, fail-closed daily quota ledger atomically consumed by Storage metadata inserts.';
