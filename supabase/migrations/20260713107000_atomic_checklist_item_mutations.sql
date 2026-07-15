BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Checklist state shares one JSON document with budget, schedule and private
-- metadata. Lock the journey and replace one canonical item only, so a stale
-- browser cannot overwrite a partner's unrelated or newer progress.
CREATE OR REPLACE FUNCTION public.mutate_journey_checklist_item(
  p_couple_id uuid,
  p_category_key text,
  p_item_id text,
  p_done boolean,
  p_expected_done boolean,
  p_default_checklist jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_progress jsonb;
  v_category jsonb;
  v_checklist jsonb;
  v_default_item jsonb;
  v_current_item jsonb;
  v_current_done boolean;
  v_done_count integer;
  v_total_count integer;
  v_status text;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'checklist item mutation requires service_role'
      USING ERRCODE = '42501';
  END IF;

  IF p_couple_id IS NULL
     OR p_category_key IS NULL
     OR p_category_key !~ '^[a-z][a-z0-9_-]{0,79}$'
     OR p_category_key IN ('constructor', 'prototype', '__proto__')
     OR p_item_id IS NULL
     OR p_item_id !~ '^[a-z][a-z0-9_-]{0,79}$'
     OR p_done IS NULL
     OR p_expected_done IS NULL
     OR p_done = p_expected_done THEN
    RAISE EXCEPTION 'invalid checklist item mutation'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_default_checklist) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_default_checklist) NOT BETWEEN 1 AND 100
     OR EXISTS (
       SELECT 1
         FROM jsonb_array_elements(p_default_checklist) AS default_item(value)
        WHERE jsonb_typeof(value) IS DISTINCT FROM 'object'
           OR (value - ARRAY['id', 'label', 'done']) <> '{}'::jsonb
           OR jsonb_typeof(value -> 'id') IS DISTINCT FROM 'string'
           OR COALESCE(value ->> 'id', '') !~ '^[a-z][a-z0-9_-]{0,79}$'
           OR jsonb_typeof(value -> 'label') IS DISTINCT FROM 'string'
           OR char_length(value ->> 'label') NOT BETWEEN 1 AND 300
           OR value ->> 'label' ~ '[[:cntrl:]]'
           OR jsonb_typeof(value -> 'done') IS DISTINCT FROM 'boolean'
           OR (value ->> 'done')::boolean IS DISTINCT FROM false
     )
     OR (
       SELECT count(*) IS DISTINCT FROM count(DISTINCT value ->> 'id')
         FROM jsonb_array_elements(p_default_checklist) AS default_item(value)
     ) THEN
    RAISE EXCEPTION 'invalid default checklist'
      USING ERRCODE = '22023';
  END IF;

  SELECT value
    INTO v_default_item
    FROM jsonb_array_elements(p_default_checklist) AS default_item(value)
   WHERE value ->> 'id' = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'checklist item is not canonical for category'
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

  IF v_progress ? p_category_key
     AND jsonb_typeof(v_progress -> p_category_key) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'checklist category is malformed'
      USING ERRCODE = '22023';
  END IF;
  v_category := COALESCE(v_progress -> p_category_key, '{}'::jsonb);

  IF v_category ? 'checklist' THEN
    v_checklist := v_category -> 'checklist';
    IF jsonb_typeof(v_checklist) IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_checklist) > 100
       OR EXISTS (
         SELECT 1
           FROM jsonb_array_elements(v_checklist) AS stored_item(value)
          WHERE jsonb_typeof(value) IS DISTINCT FROM 'object'
             OR (value - ARRAY['id', 'label', 'done']) <> '{}'::jsonb
             OR jsonb_typeof(value -> 'id') IS DISTINCT FROM 'string'
             OR COALESCE(value ->> 'id', '') !~ '^[a-z][a-z0-9_-]{0,79}$'
             OR jsonb_typeof(value -> 'label') IS DISTINCT FROM 'string'
             OR char_length(value ->> 'label') NOT BETWEEN 1 AND 300
             OR value ->> 'label' ~ '[[:cntrl:]]'
             OR jsonb_typeof(value -> 'done') IS DISTINCT FROM 'boolean'
       )
       OR (
         SELECT count(*) IS DISTINCT FROM count(DISTINCT value ->> 'id')
           FROM jsonb_array_elements(v_checklist) AS stored_item(value)
       ) THEN
      RAISE EXCEPTION 'stored checklist is malformed'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    v_checklist := p_default_checklist;
  END IF;

  SELECT value
    INTO v_current_item
    FROM jsonb_array_elements(v_checklist) AS stored_item(value)
   WHERE value ->> 'id' = p_item_id;
  IF NOT FOUND THEN
    v_current_item := v_default_item;
    v_checklist := v_checklist || jsonb_build_array(v_default_item);
  END IF;
  v_current_done := (v_current_item ->> 'done')::boolean;

  SELECT count(*)::integer,
         count(*) FILTER (WHERE (value ->> 'done')::boolean)::integer
    INTO v_total_count, v_done_count
    FROM jsonb_array_elements(v_checklist) AS stored_item(value);
  v_status := CASE
    WHEN v_done_count = 0 THEN 'not_started'
    WHEN v_done_count = v_total_count THEN 'completed'
    ELSE 'in_progress'
  END;
  v_category := v_category || jsonb_build_object(
    'category', p_category_key,
    'checklist', v_checklist,
    'status', v_status
  );
  v_progress := jsonb_set(v_progress, ARRAY[p_category_key], v_category, true);

  IF v_current_done IS DISTINCT FROM p_expected_done THEN
    RETURN jsonb_build_object(
      'conflict', true,
      'progress', v_progress,
      'categoryKey', p_category_key,
      'itemId', p_item_id,
      'item', v_current_item
    );
  END IF;

  SELECT jsonb_agg(
           CASE
             WHEN value ->> 'id' = p_item_id THEN
               jsonb_build_object(
                 'id', p_item_id,
                 'label', v_default_item ->> 'label',
                 'done', p_done
               )
             ELSE value
           END
           ORDER BY ordinal
         )
    INTO v_checklist
    FROM jsonb_array_elements(v_checklist) WITH ORDINALITY
      AS stored_item(value, ordinal);

  SELECT count(*)::integer,
         count(*) FILTER (WHERE (value ->> 'done')::boolean)::integer
    INTO v_total_count, v_done_count
    FROM jsonb_array_elements(v_checklist) AS stored_item(value);
  v_status := CASE
    WHEN v_done_count = 0 THEN 'not_started'
    WHEN v_done_count = v_total_count THEN 'completed'
    ELSE 'in_progress'
  END;
  v_category := v_category || jsonb_build_object(
    'category', p_category_key,
    'checklist', v_checklist,
    'status', v_status
  );
  v_progress := jsonb_set(v_progress, ARRAY[p_category_key], v_category, true);

  UPDATE public.wedding_journeys
     SET progress = v_progress,
         updated_at = clock_timestamp()
   WHERE couple_id = p_couple_id;

  SELECT value
    INTO v_current_item
    FROM jsonb_array_elements(v_checklist) AS stored_item(value)
   WHERE value ->> 'id' = p_item_id;

  RETURN jsonb_build_object(
    'conflict', false,
    'progress', v_progress,
    'categoryKey', p_category_key,
    'itemId', p_item_id,
    'item', v_current_item
  );
END;
$$;

ALTER FUNCTION public.mutate_journey_checklist_item(uuid, text, text, boolean, boolean, jsonb)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.mutate_journey_checklist_item(uuid, text, text, boolean, boolean, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mutate_journey_checklist_item(uuid, text, text, boolean, boolean, jsonb)
  TO service_role;

COMMENT ON FUNCTION public.mutate_journey_checklist_item(uuid, text, text, boolean, boolean, jsonb)
  IS 'Service-only row-locked compare-and-set for one canonical checklist item.';

COMMIT;
