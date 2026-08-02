BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Moment care is derived from a wedding_journeys snapshot. Keep the source
-- revision check, unanimous shared-care consent check, and message insert in
-- one transaction so a completed or edited schedule cannot race the insert.
CREATE OR REPLACE FUNCTION public.insert_amora_moment_care_message(
  p_couple_id uuid,
  p_expected_journey_revision bigint,
  p_content text,
  p_metadata jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_current_revision bigint;
  v_message_id uuid;
BEGIN
  IF p_expected_journey_revision IS NULL
     OR p_expected_journey_revision < 0
     OR p_expected_journey_revision > 9007199254740991 THEN
    RAISE EXCEPTION 'AMORA_MOMENT_CARE_REVISION_INVALID' USING ERRCODE = '22023';
  END IF;

  -- Match the established couple -> journey lock order. The existing deep
  -- insert module then reuses the couple lock and owns consent + insertion.
  PERFORM 1
  FROM public.couples AS couple
  WHERE couple.id = p_couple_id
  FOR SHARE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'source_stale');
  END IF;

  SELECT journey.state_revision
  INTO v_current_revision
  FROM public.wedding_journeys AS journey
  WHERE journey.couple_id = p_couple_id
  FOR SHARE;

  IF NOT FOUND OR v_current_revision IS DISTINCT FROM p_expected_journey_revision THEN
    RETURN jsonb_build_object(
      'state', 'source_stale',
      'current_revision', v_current_revision
    );
  END IF;

  v_message_id := public.insert_amora_care_message(
    p_couple_id,
    p_content,
    p_metadata
  );

  IF v_message_id IS NULL THEN
    RETURN jsonb_build_object('state', 'consent_required');
  END IF;

  RETURN jsonb_build_object(
    'state', 'inserted',
    'message_id', v_message_id
  );
END
$function$;

ALTER FUNCTION public.insert_amora_moment_care_message(uuid, bigint, text, jsonb)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.insert_amora_moment_care_message(uuid, bigint, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_amora_moment_care_message(uuid, bigint, text, jsonb)
  TO service_role;

COMMENT ON FUNCTION public.insert_amora_moment_care_message(uuid, bigint, text, jsonb) IS
  'Atomically inserts shared moment care only when journey revision and unanimous explicit care consent are current.';

COMMIT;
