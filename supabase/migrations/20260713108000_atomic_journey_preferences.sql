BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.patch_journey_preferences(
  p_couple_id uuid,
  p_patch jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_progress jsonb;
  v_preferences jsonb;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'journey preference patch requires service_role'
      USING ERRCODE = '42501';
  END IF;

  IF p_couple_id IS NULL
     OR jsonb_typeof(p_patch) IS DISTINCT FROM 'object'
     OR p_patch = '{}'::jsonb
     OR (p_patch - ARRAY['weddingStyle', 'priorities', 'budgetTendency', 'guestCount']) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'invalid journey preference patch'
      USING ERRCODE = '22023';
  END IF;

  IF p_patch ? 'weddingStyle'
     AND NOT (
       jsonb_typeof(p_patch -> 'weddingStyle') = 'null'
       OR (
         jsonb_typeof(p_patch -> 'weddingStyle') = 'string'
         AND p_patch ->> 'weddingStyle' IN ('minimal', 'classic', 'fancy', 'natural')
       )
     ) THEN
    RAISE EXCEPTION 'invalid wedding style preference'
      USING ERRCODE = '22023';
  END IF;

  IF p_patch ? 'budgetTendency'
     AND NOT (
       jsonb_typeof(p_patch -> 'budgetTendency') = 'null'
       OR (
         jsonb_typeof(p_patch -> 'budgetTendency') = 'string'
         AND p_patch ->> 'budgetTendency' IN ('saving', 'balanced', 'premium')
       )
     ) THEN
    RAISE EXCEPTION 'invalid budget tendency preference'
      USING ERRCODE = '22023';
  END IF;

  IF p_patch ? 'guestCount'
     AND NOT (
       jsonb_typeof(p_patch -> 'guestCount') = 'null'
       OR (
         jsonb_typeof(p_patch -> 'guestCount') = 'string'
         AND p_patch ->> 'guestCount' IN ('under50', '50to100', '100to200', '200to300', 'over300')
       )
     ) THEN
    RAISE EXCEPTION 'invalid guest count preference'
      USING ERRCODE = '22023';
  END IF;

  IF p_patch ? 'priorities'
     AND (
       jsonb_typeof(p_patch -> 'priorities') IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_patch -> 'priorities') > 6
       OR EXISTS (
         SELECT 1
           FROM jsonb_array_elements(p_patch -> 'priorities') AS priority(value)
          WHERE jsonb_typeof(value) IS DISTINCT FROM 'string'
             OR value #>> '{}' NOT IN ('sdm', 'venue', 'rings', 'honeymoon', 'ceremony', 'housing')
       )
       OR (
         SELECT count(*) IS DISTINCT FROM count(DISTINCT value #>> '{}')
           FROM jsonb_array_elements(p_patch -> 'priorities') AS priority(value)
       )
     ) THEN
    RAISE EXCEPTION 'invalid priority preferences'
      USING ERRCODE = '22023';
  END IF;

  SELECT progress
    INTO v_progress
    FROM public.wedding_journeys
   WHERE couple_id = p_couple_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wedding journey not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_progress IS NULL THEN
    v_progress := '{}'::jsonb;
  ELSIF jsonb_typeof(v_progress) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'journey progress is not an object'
      USING ERRCODE = '22023';
  END IF;

  v_preferences := COALESCE(v_progress -> '__preferences', '{}'::jsonb);
  IF jsonb_typeof(v_preferences) IS DISTINCT FROM 'object'
     OR (v_preferences - ARRAY['weddingStyle', 'priorities', 'budgetTendency', 'guestCount']) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'stored journey preferences are malformed'
      USING ERRCODE = '22023';
  END IF;

  v_preferences := v_preferences || p_patch;

  -- Reuse the same validation rules on the merged value. This also protects
  -- the API from returning legacy malformed state as if it were authoritative.
  IF (v_preferences ? 'weddingStyle' AND NOT (
       jsonb_typeof(v_preferences -> 'weddingStyle') = 'null'
       OR (jsonb_typeof(v_preferences -> 'weddingStyle') = 'string'
           AND v_preferences ->> 'weddingStyle' IN ('minimal', 'classic', 'fancy', 'natural'))
     ))
     OR (v_preferences ? 'budgetTendency' AND NOT (
       jsonb_typeof(v_preferences -> 'budgetTendency') = 'null'
       OR (jsonb_typeof(v_preferences -> 'budgetTendency') = 'string'
           AND v_preferences ->> 'budgetTendency' IN ('saving', 'balanced', 'premium'))
     ))
     OR (v_preferences ? 'guestCount' AND NOT (
       jsonb_typeof(v_preferences -> 'guestCount') = 'null'
       OR (jsonb_typeof(v_preferences -> 'guestCount') = 'string'
           AND v_preferences ->> 'guestCount' IN ('under50', '50to100', '100to200', '200to300', 'over300'))
     ))
     OR (v_preferences ? 'priorities' AND (
       jsonb_typeof(v_preferences -> 'priorities') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_preferences -> 'priorities') > 6
       OR EXISTS (
         SELECT 1
           FROM jsonb_array_elements(v_preferences -> 'priorities') AS priority(value)
          WHERE jsonb_typeof(value) IS DISTINCT FROM 'string'
             OR value #>> '{}' NOT IN ('sdm', 'venue', 'rings', 'honeymoon', 'ceremony', 'housing')
       )
       OR (
         SELECT count(*) IS DISTINCT FROM count(DISTINCT value #>> '{}')
           FROM jsonb_array_elements(v_preferences -> 'priorities') AS priority(value)
       )
     )) THEN
    RAISE EXCEPTION 'merged journey preferences are malformed'
      USING ERRCODE = '22023';
  END IF;

  v_progress := jsonb_set(v_progress, '{__preferences}', v_preferences, true);
  UPDATE public.wedding_journeys
     SET progress = v_progress,
         updated_at = clock_timestamp()
   WHERE couple_id = p_couple_id;

  RETURN jsonb_build_object(
    'progress', v_progress,
    'preferences', v_preferences
  );
END;
$$;

ALTER FUNCTION public.patch_journey_preferences(uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.patch_journey_preferences(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.patch_journey_preferences(uuid, jsonb)
  TO service_role;

COMMENT ON FUNCTION public.patch_journey_preferences(uuid, jsonb)
  IS 'Service-only row-locked partial patch for the canonical __preferences object.';

COMMIT;
