BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Schedule events still live inside wedding_journeys.progress for compatibility.
-- Mutate one event while holding the journey row lock so two partners editing
-- different events cannot replace each other's stale __events arrays.
CREATE OR REPLACE FUNCTION public.mutate_journey_schedule_event(
  p_couple_id uuid,
  p_operation text,
  p_event jsonb,
  p_event_id text,
  p_expected_updated_at text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_progress jsonb;
  v_events jsonb;
  v_current_event jsonb;
  v_next_events jsonb;
  v_result_event jsonb;
  v_match_count integer;
  v_source_key text;
  v_now_text text := to_char(
    clock_timestamp() AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'schedule event mutation requires service_role'
      USING ERRCODE = '42501';
  END IF;

  IF p_operation NOT IN ('add', 'update', 'delete') THEN
    RAISE EXCEPTION 'unsupported schedule event operation'
      USING ERRCODE = '22023';
  END IF;

  IF p_event_id IS NULL
     OR p_event_id !~ '^[a-zA-Z0-9:_-]{1,120}$' THEN
    RAISE EXCEPTION 'invalid schedule event id'
      USING ERRCODE = '22023';
  END IF;

  IF p_operation IN ('add', 'update') THEN
    IF jsonb_typeof(p_event) IS DISTINCT FROM 'object'
       OR p_event ->> 'id' IS DISTINCT FROM p_event_id
       OR COALESCE(length(p_event ->> 'date'), 0) <> 10
       OR COALESCE(length(btrim(p_event ->> 'title')), 0) NOT BETWEEN 1 AND 160
       OR COALESCE(length(p_event ->> 'createdAt'), 0) NOT BETWEEN 20 AND 30
       OR COALESCE(length(p_event ->> 'updatedAt'), 0) NOT BETWEEN 20 AND 30
       OR (p_event ? 'time' AND (jsonb_typeof(p_event -> 'time') IS DISTINCT FROM 'string'
         OR p_event ->> 'time' !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'))
       OR (p_event ? 'memo' AND jsonb_typeof(p_event -> 'memo') IS DISTINCT FROM 'string')
       OR (p_event ? 'categoryKey' AND jsonb_typeof(p_event -> 'categoryKey') IS DISTINCT FROM 'string')
       OR (p_event ? 'sourceKey' AND jsonb_typeof(p_event -> 'sourceKey') IS DISTINCT FROM 'string')
       OR (p_event ? 'momentType' AND jsonb_typeof(p_event -> 'momentType') IS DISTINCT FROM 'string')
       OR (p_event - ARRAY[
         'id', 'date', 'title', 'time', 'memo', 'categoryKey', 'sourceKey',
         'momentType', 'createdAt', 'updatedAt'
       ]) <> '{}'::jsonb THEN
      RAISE EXCEPTION 'invalid schedule event payload'
        USING ERRCODE = '22023';
    END IF;
  ELSIF p_event IS NOT NULL THEN
    RAISE EXCEPTION 'delete does not accept an event payload'
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

  IF v_progress ? '__events'
     AND jsonb_typeof(v_progress -> '__events') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'journey schedule state is malformed'
      USING ERRCODE = '22023';
  END IF;

  v_events := COALESCE(v_progress -> '__events', '[]'::jsonb);
  IF jsonb_array_length(v_events) > 300 THEN
    RAISE EXCEPTION 'journey schedule event limit exceeded'
      USING ERRCODE = '54000';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(v_events) AS event_value
     WHERE jsonb_typeof(event_value) IS DISTINCT FROM 'object'
        OR COALESCE(event_value ->> 'id', '') !~ '^[a-zA-Z0-9:_-]{1,120}$'
        OR COALESCE(event_value ->> 'date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
         OR COALESCE(length(btrim(event_value ->> 'title')), 0) NOT BETWEEN 1 AND 160
         OR COALESCE(event_value ->> 'createdAt', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
         OR COALESCE(event_value ->> 'updatedAt', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
         OR (event_value ? 'time' AND (jsonb_typeof(event_value -> 'time') IS DISTINCT FROM 'string'
           OR event_value ->> 'time' !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'))
         OR (event_value ? 'memo' AND jsonb_typeof(event_value -> 'memo') IS DISTINCT FROM 'string')
        OR (event_value ? 'categoryKey' AND jsonb_typeof(event_value -> 'categoryKey') IS DISTINCT FROM 'string')
        OR (event_value ? 'sourceKey' AND jsonb_typeof(event_value -> 'sourceKey') IS DISTINCT FROM 'string')
        OR (event_value ? 'momentType' AND jsonb_typeof(event_value -> 'momentType') IS DISTINCT FROM 'string')
  ) THEN
    RAISE EXCEPTION 'journey schedule event payload is malformed'
      USING ERRCODE = '22023';
  END IF;

  IF (
    SELECT count(*) IS DISTINCT FROM count(DISTINCT event_value ->> 'id')
      FROM jsonb_array_elements(v_events) AS event_value
  ) THEN
    RAISE EXCEPTION 'duplicate schedule event ids require repair'
      USING ERRCODE = '22000';
  END IF;

  SELECT count(*)
    INTO v_match_count
    FROM jsonb_array_elements(v_events) AS event_value
   WHERE event_value ->> 'id' = p_event_id;

  IF v_match_count > 1 THEN
    RAISE EXCEPTION 'duplicate schedule event ids require repair'
      USING ERRCODE = '22000';
  END IF;

  SELECT event_value
    INTO v_current_event
    FROM jsonb_array_elements(v_events) AS event_value
   WHERE event_value ->> 'id' = p_event_id
   LIMIT 1;

  IF p_operation = 'add' THEN
    IF v_current_event IS NOT NULL THEN
      IF (v_current_event - ARRAY['createdAt', 'updatedAt'])
         IS DISTINCT FROM (p_event - ARRAY['createdAt', 'updatedAt']) THEN
        RAISE EXCEPTION 'schedule_event_conflict'
          USING ERRCODE = '40001';
      END IF;
      v_next_events := v_events;
      v_result_event := v_current_event;
    ELSE
      v_source_key := NULLIF(btrim(p_event ->> 'sourceKey'), '');
      IF v_source_key IS NOT NULL AND EXISTS (
        SELECT 1
          FROM jsonb_array_elements(v_events) AS event_value
         WHERE event_value ->> 'sourceKey' = v_source_key
      ) THEN
        RAISE EXCEPTION 'schedule_event_conflict'
          USING ERRCODE = '40001';
      END IF;

      v_result_event := p_event || jsonb_build_object(
        'createdAt', v_now_text,
        'updatedAt', v_now_text
      );
      v_next_events := v_events || jsonb_build_array(v_result_event);
    END IF;
  ELSIF p_operation = 'update' THEN
    IF v_current_event IS NULL
       OR p_expected_updated_at IS NULL
       OR v_current_event ->> 'updatedAt' IS DISTINCT FROM p_expected_updated_at THEN
      RAISE EXCEPTION 'schedule_event_conflict'
        USING ERRCODE = '40001';
    END IF;

    v_result_event := p_event || jsonb_build_object(
      'createdAt', v_current_event ->> 'createdAt',
      'updatedAt', v_now_text
    );
    SELECT COALESCE(
      jsonb_agg(
        CASE WHEN event_value ->> 'id' = p_event_id
          THEN v_result_event
          ELSE event_value
        END
        ORDER BY ordinal
      ),
      '[]'::jsonb
    )
      INTO v_next_events
      FROM jsonb_array_elements(v_events) WITH ORDINALITY
        AS item(event_value, ordinal);
  ELSE
    IF v_current_event IS NULL THEN
      -- A retried delete is safely idempotent and cannot remove another event.
      v_next_events := v_events;
    ELSIF p_expected_updated_at IS NULL
       OR v_current_event ->> 'updatedAt' IS DISTINCT FROM p_expected_updated_at THEN
      RAISE EXCEPTION 'schedule_event_conflict'
        USING ERRCODE = '40001';
    ELSE
      SELECT COALESCE(jsonb_agg(event_value ORDER BY ordinal), '[]'::jsonb)
        INTO v_next_events
        FROM jsonb_array_elements(v_events) WITH ORDINALITY
          AS item(event_value, ordinal)
       WHERE event_value ->> 'id' IS DISTINCT FROM p_event_id;
    END IF;
    v_result_event := NULL;
  END IF;

  v_progress := jsonb_set(v_progress, '{__events}', v_next_events, true);
  UPDATE public.wedding_journeys
     SET progress = v_progress,
         updated_at = clock_timestamp()
   WHERE couple_id = p_couple_id;

  RETURN jsonb_build_object(
    'progress', v_progress,
    'event', v_result_event,
    'eventId', p_event_id
  );
END;
$$;

ALTER FUNCTION public.mutate_journey_schedule_event(uuid, text, jsonb, text, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.mutate_journey_schedule_event(uuid, text, jsonb, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mutate_journey_schedule_event(uuid, text, jsonb, text, text)
  TO service_role;

COMMENT ON FUNCTION public.mutate_journey_schedule_event(uuid, text, jsonb, text, text)
  IS 'Service-only stable-id schedule mutation. Locks one couple journey and rejects stale same-event edits.';

COMMIT;
