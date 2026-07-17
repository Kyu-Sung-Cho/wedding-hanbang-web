-- Read and patch the mobile identity + wedding settings surface through one
-- service-only database boundary. Expected old values prevent a stale device
-- from overwriting the same field, while provided flags preserve NULL vs omit.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.get_wedding_settings_snapshot(
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '10s'
AS $function$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_community_nickname text;
  v_wedding_date date;
  v_venue text;
  v_total_budget bigint;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'WEDDING_SETTINGS_INVALID_USER' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WEDDING_SETTINGS_PROFILE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  SELECT nickname INTO v_community_nickname
  FROM public.community_profiles
  WHERE user_id = p_user_id;

  IF v_profile.couple_id IS NOT NULL THEN
    SELECT wedding_date, venue, total_budget
      INTO v_wedding_date, v_venue, v_total_budget
    FROM public.wedding_journeys
    WHERE couple_id = v_profile.couple_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'WEDDING_SETTINGS_JOURNEY_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'user_id', v_profile.id,
    'couple_id', v_profile.couple_id,
    'name', v_profile.name,
    'community_nickname', v_community_nickname,
    'role', v_profile.role,
    'wedding_date', v_wedding_date,
    'venue', v_venue,
    'total_budget', v_total_budget,
    'care_notifications_enabled', v_profile.care_notifications_enabled,
    'care_notifications_consented_at', v_profile.care_notifications_consented_at
  );
END
$function$;

ALTER FUNCTION public.get_wedding_settings_snapshot(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_wedding_settings_snapshot(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_wedding_settings_snapshot(uuid)
  TO service_role;

COMMENT ON FUNCTION public.get_wedding_settings_snapshot(uuid) IS
  'Service-only consistent mobile identity and wedding settings snapshot.';

CREATE OR REPLACE FUNCTION public.patch_wedding_settings_atomic(
  p_user_id uuid,
  p_expected_couple_id uuid,
  p_expected_couple_id_provided boolean,
  p_name text,
  p_name_provided boolean,
  p_expected_name text,
  p_community_nickname text,
  p_community_nickname_provided boolean,
  p_expected_community_nickname text,
  p_wedding_date date,
  p_wedding_date_provided boolean,
  p_expected_wedding_date date,
  p_venue text,
  p_venue_provided boolean,
  p_expected_venue text,
  p_total_budget bigint,
  p_total_budget_provided boolean,
  p_expected_total_budget bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '20s'
AS $function$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_journey public.wedding_journeys%ROWTYPE;
  v_current_community_nickname text;
  v_profile_patch jsonb;
BEGIN
  IF p_user_id IS NULL
     OR p_expected_couple_id_provided IS DISTINCT FROM true
     OR p_name_provided IS NULL
     OR p_community_nickname_provided IS NULL
     OR p_wedding_date_provided IS NULL
     OR p_venue_provided IS NULL
     OR p_total_budget_provided IS NULL
     OR NOT (
       p_name_provided
       OR p_community_nickname_provided
       OR p_wedding_date_provided
       OR p_venue_provided
       OR p_total_budget_provided
     )
     OR (NOT p_name_provided AND (p_name IS NOT NULL OR p_expected_name IS NOT NULL))
     OR (p_name_provided AND p_name IS NULL)
     OR (
       NOT p_community_nickname_provided
       AND (
         p_community_nickname IS NOT NULL
         OR p_expected_community_nickname IS NOT NULL
       )
     )
     OR (p_community_nickname_provided AND p_community_nickname IS NULL)
     OR (
       NOT p_wedding_date_provided
       AND (p_wedding_date IS NOT NULL OR p_expected_wedding_date IS NOT NULL)
     )
     OR (
       NOT p_venue_provided
       AND (p_venue IS NOT NULL OR p_expected_venue IS NOT NULL)
     )
     OR (
       NOT p_total_budget_provided
       AND (p_total_budget IS NOT NULL OR p_expected_total_budget IS NOT NULL)
     ) THEN
    RAISE EXCEPTION 'WEDDING_SETTINGS_INVALID' USING ERRCODE = '22023';
  END IF;

  IF p_name_provided AND (
    btrim(p_name) = ''
    OR p_name IS DISTINCT FROM btrim(p_name)
    OR char_length(p_name) > 80
    OR p_name ~ '[[:cntrl:]]'
  ) THEN
    RAISE EXCEPTION 'WEDDING_SETTINGS_INVALID_NAME' USING ERRCODE = '22023';
  END IF;
  IF p_community_nickname_provided AND (
    btrim(p_community_nickname) = ''
    OR p_community_nickname IS DISTINCT FROM btrim(p_community_nickname)
    OR char_length(p_community_nickname) > 20
  ) THEN
    RAISE EXCEPTION 'WEDDING_SETTINGS_INVALID_NICKNAME' USING ERRCODE = '22023';
  END IF;
  IF p_venue_provided AND p_venue IS NOT NULL AND (
    btrim(p_venue) = ''
    OR p_venue IS DISTINCT FROM btrim(p_venue)
    OR char_length(p_venue) > 120
    OR p_venue ~ '[[:cntrl:]]'
  ) THEN
    RAISE EXCEPTION 'WEDDING_SETTINGS_INVALID_VENUE' USING ERRCODE = '22023';
  END IF;
  IF p_total_budget_provided
     AND p_total_budget IS NOT NULL
     AND (p_total_budget < 0 OR p_total_budget > 1000000000) THEN
    RAISE EXCEPTION 'WEDDING_SETTINGS_INVALID_BUDGET' USING ERRCODE = '22023';
  END IF;
  IF (p_name_provided AND p_name IS NOT DISTINCT FROM p_expected_name)
     OR (
       p_community_nickname_provided
       AND p_community_nickname IS NOT DISTINCT FROM p_expected_community_nickname
     )
     OR (
       p_wedding_date_provided
       AND p_wedding_date IS NOT DISTINCT FROM p_expected_wedding_date
     )
     OR (p_venue_provided AND p_venue IS NOT DISTINCT FROM p_expected_venue)
     OR (
       p_total_budget_provided
       AND p_total_budget IS NOT DISTINCT FROM p_expected_total_budget
     ) THEN
    RAISE EXCEPTION 'WEDDING_SETTINGS_INVALID_NOOP' USING ERRCODE = '22023';
  END IF;

  -- Global lock order for this surface: profile -> community profile -> journey.
  -- The called profile RPC uses the same profile -> community order.
  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WEDDING_SETTINGS_PROFILE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF v_profile.couple_id IS DISTINCT FROM p_expected_couple_id THEN
    RAISE EXCEPTION 'WEDDING_SETTINGS_COUPLE_CHANGED' USING ERRCODE = '40001';
  END IF;
  IF p_name_provided AND v_profile.name IS DISTINCT FROM p_expected_name THEN
    RAISE EXCEPTION 'WEDDING_SETTINGS_CONFLICT:name' USING ERRCODE = '40001';
  END IF;

  IF p_name_provided OR p_community_nickname_provided THEN
    SELECT nickname INTO v_current_community_nickname
    FROM public.community_profiles
    WHERE user_id = p_user_id
    FOR UPDATE;

    IF p_community_nickname_provided
       AND v_current_community_nickname IS DISTINCT FROM p_expected_community_nickname THEN
      RAISE EXCEPTION 'WEDDING_SETTINGS_CONFLICT:community_nickname'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  IF p_wedding_date_provided OR p_venue_provided OR p_total_budget_provided THEN
    IF v_profile.couple_id IS NULL THEN
      RAISE EXCEPTION 'WEDDING_SETTINGS_JOURNEY_REQUIRED' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_journey
    FROM public.wedding_journeys
    WHERE couple_id = v_profile.couple_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'WEDDING_SETTINGS_JOURNEY_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    IF p_wedding_date_provided
       AND v_journey.wedding_date IS DISTINCT FROM p_expected_wedding_date THEN
      RAISE EXCEPTION 'WEDDING_SETTINGS_CONFLICT:wedding_date'
        USING ERRCODE = '40001';
    END IF;
    IF p_venue_provided AND v_journey.venue IS DISTINCT FROM p_expected_venue THEN
      RAISE EXCEPTION 'WEDDING_SETTINGS_CONFLICT:venue' USING ERRCODE = '40001';
    END IF;
    IF p_total_budget_provided
       AND v_journey.total_budget IS DISTINCT FROM p_expected_total_budget THEN
      RAISE EXCEPTION 'WEDDING_SETTINGS_CONFLICT:total_budget'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  IF p_name_provided OR p_community_nickname_provided THEN
    SELECT public.patch_profile_atomic(
      p_user_id,
      CASE WHEN p_name_provided THEN p_name ELSE NULL END,
      NULL,
      false,
      NULL,
      NULL,
      CASE
        WHEN p_community_nickname_provided THEN p_community_nickname
        WHEN v_current_community_nickname IS NOT NULL THEN v_current_community_nickname
        ELSE p_name
      END,
      false,
      p_community_nickname_provided
    ) INTO v_profile_patch;
  END IF;

  IF p_wedding_date_provided OR p_venue_provided OR p_total_budget_provided THEN
    UPDATE public.wedding_journeys
    SET wedding_date = CASE
          WHEN p_wedding_date_provided THEN p_wedding_date
          ELSE v_journey.wedding_date
        END,
        venue = CASE
          WHEN p_venue_provided THEN p_venue
          ELSE v_journey.venue
        END,
        total_budget = CASE
          WHEN p_total_budget_provided THEN p_total_budget
          ELSE v_journey.total_budget
        END,
        updated_at = now()
    WHERE id = v_journey.id;
  END IF;

  RETURN public.get_wedding_settings_snapshot(p_user_id);
END
$function$;

ALTER FUNCTION public.patch_wedding_settings_atomic(
  uuid, uuid, boolean,
  text, boolean, text,
  text, boolean, text,
  date, boolean, date,
  text, boolean, text,
  bigint, boolean, bigint
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.patch_wedding_settings_atomic(
  uuid, uuid, boolean,
  text, boolean, text,
  text, boolean, text,
  date, boolean, date,
  text, boolean, text,
  bigint, boolean, bigint
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.patch_wedding_settings_atomic(
  uuid, uuid, boolean,
  text, boolean, text,
  text, boolean, text,
  date, boolean, date,
  text, boolean, text,
  bigint, boolean, bigint
) TO service_role;

COMMENT ON FUNCTION public.patch_wedding_settings_atomic(
  uuid, uuid, boolean,
  text, boolean, text,
  text, boolean, text,
  date, boolean, date,
  text, boolean, text,
  bigint, boolean, bigint
) IS
  'Service-only atomic profile, community nickname, and changed wedding journey patch with optimistic field fences.';
