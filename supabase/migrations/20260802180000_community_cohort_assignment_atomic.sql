-- Make cohort membership assignment a single, serialized database decision.
--
-- The legacy API paths could deactivate the current membership before a later
-- room creation/upsert failed. They also trusted the cached member_count while
-- multiple requests could select the same nearly-full room. This replacement
-- keeps the same service-role-only RPC name, so every caller gets rollback,
-- capacity, and derived-count guarantees in one transaction.

CREATE OR REPLACE FUNCTION public.community_assign_cohort(
  p_user_id uuid,
  p_year integer,
  p_month integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_room_id uuid;
  v_room_number integer;
  v_old_room_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.users AS app_user WHERE app_user.id = p_user_id
  ) THEN
    RAISE EXCEPTION 'cohort assignment user not found'
      USING ERRCODE = '23503';
  END IF;

  IF p_year < 2020 OR p_year > 2100 OR p_month < 1 OR p_month > 12 THEN
    RAISE EXCEPTION 'invalid cohort period'
      USING ERRCODE = '22023';
  END IF;

  -- Cohort moves are low-volume, high-integrity writes. A single transaction
  -- advisory lock prevents competing room creation, over-capacity selection,
  -- cross-room swaps, and lost cached-count updates.
  PERFORM pg_advisory_xact_lock(7219026080218000::bigint);

  -- Lock and remember every legacy active row for this user. The function
  -- repairs an ambiguous legacy state only when the user explicitly assigns.
  PERFORM 1
  FROM public.cohort_members AS member
  WHERE member.user_id = p_user_id
    AND member.is_active IS TRUE
  ORDER BY member.id
  FOR UPDATE;

  SELECT COALESCE(array_agg(DISTINCT member.room_id), ARRAY[]::uuid[])
  INTO v_old_room_ids
  FROM public.cohort_members AS member
  WHERE member.user_id = p_user_id
    AND member.is_active IS TRUE;

  UPDATE public.cohort_members
  SET is_active = false
  WHERE user_id = p_user_id
    AND is_active IS TRUE;

  -- Capacity is derived from authoritative active membership rows, never the
  -- cached count. The global assignment lock makes this selection stable.
  SELECT room.id, room.room_number
  INTO v_room_id, v_room_number
  FROM public.cohort_rooms AS room
  WHERE room.year = p_year
    AND room.month = p_month
    AND room.is_active IS TRUE
    AND (
      SELECT count(*)
      FROM public.cohort_members AS member
      WHERE member.room_id = room.id
        AND member.is_active IS TRUE
    ) < 30
  ORDER BY room.room_number
  LIMIT 1
  FOR UPDATE OF room;

  IF v_room_id IS NULL THEN
    SELECT COALESCE(max(room.room_number), 0) + 1
    INTO v_room_number
    FROM public.cohort_rooms AS room
    WHERE room.year = p_year
      AND room.month = p_month;

    INSERT INTO public.cohort_rooms (
      year,
      month,
      room_number,
      name,
      is_active,
      member_count,
      message_count
    )
    VALUES (
      p_year,
      p_month,
      v_room_number,
      p_year::text || '년 ' || ceil(p_month / 3.0)::integer::text
        || '분기 결혼 동기'
        || CASE WHEN v_room_number > 1
          THEN ' ' || v_room_number::text || '방'
          ELSE ''
        END,
      true,
      0,
      0
    )
    RETURNING id INTO v_room_id;
  END IF;

  -- Lock all old rooms before recomputing their cache. Assignment calls are
  -- globally serialized, and moderation follows member-before-room ordering.
  PERFORM 1
  FROM public.cohort_rooms AS room
  WHERE room.id = ANY(v_old_room_ids)
  ORDER BY room.id
  FOR UPDATE;

  INSERT INTO public.cohort_members (
    room_id,
    user_id,
    joined_at,
    last_seen_at,
    is_active
  )
  VALUES (v_room_id, p_user_id, now(), now(), true)
  ON CONFLICT (room_id, user_id) DO UPDATE
  SET is_active = true,
      joined_at = CASE
        WHEN public.cohort_members.is_active IS TRUE
          THEN public.cohort_members.joined_at
        ELSE now()
      END,
      last_seen_at = now();

  UPDATE public.community_profiles
  SET wedding_year = p_year,
      wedding_month = p_month
  WHERE user_id = p_user_id;

  UPDATE public.cohort_rooms AS room
  SET member_count = (
    SELECT count(*)::integer
    FROM public.cohort_members AS member
    WHERE member.room_id = room.id
      AND member.is_active IS TRUE
  )
  WHERE room.id = v_room_id
    OR room.id = ANY(v_old_room_ids);

  RETURN v_room_id;
END;
$$;

REVOKE ALL
  ON FUNCTION public.community_assign_cohort(uuid, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE
  ON FUNCTION public.community_assign_cohort(uuid, integer, integer)
  TO service_role;

COMMENT ON FUNCTION public.community_assign_cohort(uuid, integer, integer) IS
  'Atomically moves one authenticated app user into a capacity-safe cohort; service role only.';
