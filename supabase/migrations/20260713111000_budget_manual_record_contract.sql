BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Keep the existing row-locked mutation surface, but separate user-planned
-- budget from manually confirmed contract and payment facts. Historical
-- spent/cost/payer values are never reclassified; they can only be removed.
CREATE OR REPLACE FUNCTION public.mutate_journey_budget_category(
  p_couple_id uuid,
  p_category_key text,
  p_set_fields jsonb,
  p_remove_fields text[],
  p_visibility text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_progress jsonb;
  v_category jsonb;
  v_hidden jsonb;
  v_remove_fields text[] := COALESCE(p_remove_fields, ARRAY[]::text[]);
  v_field text;
  v_amount numeric;
  v_next_payment_date text;
  v_contracted_total numeric;
  v_paid_to_date numeric;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'budget category mutation requires service_role'
      USING ERRCODE = '42501';
  END IF;

  IF p_couple_id IS NULL THEN
    RAISE EXCEPTION 'invalid couple id'
      USING ERRCODE = '22023';
  END IF;

  IF p_category_key IS NULL
     OR p_category_key !~ '^[a-z][a-z0-9_-]{0,79}$'
     OR p_category_key IN ('constructor', 'prototype', '__proto__') THEN
    RAISE EXCEPTION 'invalid budget category key'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_set_fields) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid budget category set fields'
      USING ERRCODE = '22023';
  END IF;

  IF (p_set_fields - ARRAY['budget', 'contractedTotal', 'paidToDate', 'nextPaymentAmount', 'nextPaymentDate', 'label']) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'unsupported budget category set field'
      USING ERRCODE = '22023';
  END IF;

  FOREACH v_field IN ARRAY ARRAY['budget', 'contractedTotal', 'paidToDate', 'nextPaymentAmount'] LOOP
    IF p_set_fields ? v_field THEN
      IF jsonb_typeof(p_set_fields -> v_field) IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'invalid budget category amount'
          USING ERRCODE = '22023';
      END IF;
      v_amount := (p_set_fields ->> v_field)::numeric;
      IF v_amount < 0
         OR v_amount > 10000000000
         OR v_amount <> trunc(v_amount) THEN
        RAISE EXCEPTION 'invalid budget category amount'
          USING ERRCODE = '22023';
      END IF;
    END IF;
  END LOOP;

  IF p_set_fields ? 'nextPaymentDate' THEN
    IF jsonb_typeof(p_set_fields -> 'nextPaymentDate') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'invalid next payment date'
        USING ERRCODE = '22023';
    END IF;
    v_next_payment_date := p_set_fields ->> 'nextPaymentDate';
    IF v_next_payment_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      RAISE EXCEPTION 'invalid next payment date'
        USING ERRCODE = '22023';
    END IF;
    IF substring(v_next_payment_date FROM 1 FOR 4)::integer = 0 THEN
      RAISE EXCEPTION 'invalid next payment date'
        USING ERRCODE = '22023';
    END IF;
    BEGIN
      PERFORM v_next_payment_date::date;
    EXCEPTION
      WHEN invalid_datetime_format OR datetime_field_overflow THEN
        RAISE EXCEPTION 'invalid next payment date'
          USING ERRCODE = '22023';
    END;
    IF to_char(v_next_payment_date::date, 'YYYY-MM-DD') IS DISTINCT FROM v_next_payment_date THEN
      RAISE EXCEPTION 'invalid next payment date'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_set_fields ? 'label'
     AND (
       p_category_key !~ '^custom_'
       OR jsonb_typeof(p_set_fields -> 'label') IS DISTINCT FROM 'string'
       OR char_length(p_set_fields ->> 'label') NOT BETWEEN 1 AND 60
       OR p_set_fields ->> 'label' IS DISTINCT FROM btrim(p_set_fields ->> 'label')
       OR p_set_fields ->> 'label' ~ '[[:cntrl:]]'
     ) THEN
    RAISE EXCEPTION 'invalid budget category label'
      USING ERRCODE = '22023';
  END IF;

  IF cardinality(v_remove_fields) > 9
     OR EXISTS (
       SELECT 1
         FROM unnest(v_remove_fields) AS removed(field_name)
        WHERE field_name <> ALL(ARRAY['budget', 'contractedTotal', 'paidToDate', 'nextPaymentAmount', 'nextPaymentDate', 'spent', 'cost', 'payer', 'label'])
     ) THEN
    RAISE EXCEPTION 'unsupported budget category remove field'
      USING ERRCODE = '22023';
  END IF;

  IF cardinality(v_remove_fields) IS DISTINCT FROM (
    SELECT count(DISTINCT field_name)::integer
      FROM unnest(v_remove_fields) AS removed(field_name)
  ) THEN
    RAISE EXCEPTION 'duplicate budget category remove field'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM unnest(v_remove_fields) AS removed(field_name)
     WHERE p_set_fields ? field_name
  ) THEN
    RAISE EXCEPTION 'budget category field cannot be set and removed together'
      USING ERRCODE = '22023';
  END IF;

  IF p_visibility IS NOT NULL
     AND p_visibility NOT IN ('visible', 'hidden') THEN
    RAISE EXCEPTION 'invalid budget category visibility'
      USING ERRCODE = '22023';
  END IF;

  IF p_set_fields = '{}'::jsonb
     AND cardinality(v_remove_fields) = 0
     AND p_visibility IS NULL THEN
    RAISE EXCEPTION 'empty budget category mutation'
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
    RAISE EXCEPTION 'budget category state is malformed'
      USING ERRCODE = '22023';
  END IF;

  v_hidden := COALESCE(v_progress -> '__hidden', '[]'::jsonb);
  IF jsonb_typeof(v_hidden) IS DISTINCT FROM 'array'
     OR jsonb_array_length(v_hidden) > 100
     OR EXISTS (
       SELECT 1
         FROM jsonb_array_elements(v_hidden) AS hidden_item(value)
        WHERE jsonb_typeof(value) IS DISTINCT FROM 'string'
           OR COALESCE(value #>> '{}', '') !~ '^[a-z][a-z0-9_-]{0,79}$'
           OR COALESCE(value #>> '{}', '') IN ('constructor', 'prototype', '__proto__')
     )
     OR (
       SELECT count(*) IS DISTINCT FROM count(DISTINCT value #>> '{}')
         FROM jsonb_array_elements(v_hidden) AS hidden_item(value)
     ) THEN
    RAISE EXCEPTION 'budget category visibility state is malformed'
      USING ERRCODE = '22023';
  END IF;

  IF p_set_fields <> '{}'::jsonb OR cardinality(v_remove_fields) > 0 THEN
    v_category := COALESCE(v_progress -> p_category_key, '{}'::jsonb);
    v_category := v_category - v_remove_fields;
    v_category := v_category || p_set_fields || jsonb_build_object(
      'category', p_category_key
    );

    -- Validate the final merged record, not just the request. This catches a
    -- paid-only update that exceeds a contracted total already on the row.
    FOREACH v_field IN ARRAY ARRAY['budget', 'contractedTotal', 'paidToDate', 'nextPaymentAmount'] LOOP
      IF v_category ? v_field THEN
        IF jsonb_typeof(v_category -> v_field) IS DISTINCT FROM 'number' THEN
          RAISE EXCEPTION 'invalid budget category amount'
            USING ERRCODE = '22023';
        END IF;
        v_amount := (v_category ->> v_field)::numeric;
        IF v_amount < 0
           OR v_amount > 10000000000
           OR v_amount <> trunc(v_amount) THEN
          RAISE EXCEPTION 'invalid budget category amount'
            USING ERRCODE = '22023';
        END IF;
      END IF;
    END LOOP;

    IF v_category ? 'nextPaymentDate' THEN
      IF jsonb_typeof(v_category -> 'nextPaymentDate') IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'invalid next payment date'
          USING ERRCODE = '22023';
      END IF;
      v_next_payment_date := v_category ->> 'nextPaymentDate';
      IF v_next_payment_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
        RAISE EXCEPTION 'invalid next payment date'
          USING ERRCODE = '22023';
      END IF;
      IF substring(v_next_payment_date FROM 1 FOR 4)::integer = 0 THEN
        RAISE EXCEPTION 'invalid next payment date'
          USING ERRCODE = '22023';
      END IF;
      BEGIN
        PERFORM v_next_payment_date::date;
      EXCEPTION
        WHEN invalid_datetime_format OR datetime_field_overflow THEN
          RAISE EXCEPTION 'invalid next payment date'
            USING ERRCODE = '22023';
      END;
      IF to_char(v_next_payment_date::date, 'YYYY-MM-DD') IS DISTINCT FROM v_next_payment_date THEN
        RAISE EXCEPTION 'invalid next payment date'
          USING ERRCODE = '22023';
      END IF;
    END IF;

    IF v_category ? 'contractedTotal' AND v_category ? 'paidToDate' THEN
      v_contracted_total := (v_category ->> 'contractedTotal')::numeric;
      v_paid_to_date := (v_category ->> 'paidToDate')::numeric;
      IF v_paid_to_date > v_contracted_total THEN
        RAISE EXCEPTION 'paid to date exceeds contracted total'
          USING ERRCODE = '22023';
      END IF;
    END IF;

    v_progress := jsonb_set(v_progress, ARRAY[p_category_key], v_category, true);
  END IF;

  IF p_visibility = 'hidden' THEN
    IF NOT EXISTS (
      SELECT 1
        FROM jsonb_array_elements(v_hidden) AS hidden_item(value)
       WHERE value #>> '{}' = p_category_key
    ) THEN
      v_hidden := v_hidden || jsonb_build_array(p_category_key);
    END IF;
    v_progress := jsonb_set(v_progress, '{__hidden}', v_hidden, true);
  ELSIF p_visibility = 'visible' THEN
    SELECT COALESCE(jsonb_agg(value ORDER BY ordinal), '[]'::jsonb)
      INTO v_hidden
      FROM jsonb_array_elements(v_hidden) WITH ORDINALITY
        AS hidden_item(value, ordinal)
     WHERE value #>> '{}' IS DISTINCT FROM p_category_key;
    IF jsonb_array_length(v_hidden) = 0 THEN
      v_progress := v_progress - '__hidden';
    ELSE
      v_progress := jsonb_set(v_progress, '{__hidden}', v_hidden, true);
    END IF;
  END IF;

  UPDATE public.wedding_journeys
     SET progress = v_progress,
         updated_at = clock_timestamp()
   WHERE couple_id = p_couple_id;

  RETURN jsonb_build_object(
    'progress', v_progress,
    'categoryKey', p_category_key
  );
END;
$$;

ALTER FUNCTION public.mutate_journey_budget_category(uuid, text, jsonb, text[], text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.mutate_journey_budget_category(uuid, text, jsonb, text[], text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mutate_journey_budget_category(uuid, text, jsonb, text[], text)
  TO service_role;

COMMENT ON FUNCTION public.mutate_journey_budget_category(uuid, text, jsonb, text[], text)
  IS 'Service-only row-locked merge of planned budget and user-confirmed contract/payment facts; legacy spent/cost/payer are removal-only.';

COMMIT;
