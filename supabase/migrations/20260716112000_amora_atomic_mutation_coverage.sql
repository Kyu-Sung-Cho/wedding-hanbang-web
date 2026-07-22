BEGIN;

-- Complete the crash-safe Amora mutation dispatcher.
--
-- The 1100 dispatcher remains as a private implementation for its already
-- audited budget and schedule operations. This migration installs a strict
-- wrapper for every other mutation exposed during beta. The wrapper owns the
-- domain write and durable tool-ledger completion in one transaction.

ALTER FUNCTION public.apply_amora_atomic_tool_execution(
  uuid, text, text, integer, text, jsonb, jsonb, jsonb
) RENAME TO apply_amora_atomic_tool_execution_v1;

REVOKE ALL ON FUNCTION public.apply_amora_atomic_tool_execution_v1(
  uuid, text, text, integer, text, jsonb, jsonb, jsonb
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.apply_amora_atomic_tool_execution(
  p_couple_id uuid,
  p_request_key text,
  p_operation_key text,
  p_request_attempt_count integer,
  p_input_digest text,
  p_tool_input jsonb,
  p_domain_mutation jsonb,
  p_result jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_request public.amora_chat_request_claims%ROWTYPE;
  v_execution public.amora_tool_executions%ROWTYPE;
  v_journey public.wedding_journeys%ROWTYPE;
  v_action public.amora_actions%ROWTYPE;
  v_kind text := p_domain_mutation ->> 'kind';
  v_effective_result jsonb := p_result;
  v_rows integer;
  v_key text;
  v_expected_present boolean;
  v_current_present boolean;
  v_expected jsonb;
  v_value jsonb;
  v_current_progress jsonb;
  v_entry jsonb;
  v_item jsonb;
  v_event jsonb;
  v_prior_event jsonb;
  v_event_date date;
  v_expected_date date;
  v_next_date date;
  v_expected_budget numeric;
  v_next_budget numeric;
  v_allocation_sum numeric := 0;
  v_allocation_budget numeric;
  v_remainder numeric;
  v_expected_entry_count integer;
  v_count integer;
  v_distinct_count integer;
  v_done_count integer;
  v_changed boolean := false;
  v_stale boolean := false;
  v_normalized text;
  v_expected_action_id text;
  v_action_json jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_ATOMIC_TOOL_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF p_couple_id IS NULL
     OR p_request_key IS NULL
     OR p_operation_key IS NULL
     OR p_operation_key !~ '^[0-9a-f]{64}$'
     OR p_request_attempt_count IS NULL
     OR p_request_attempt_count < 1
     OR p_input_digest IS NULL
     OR p_input_digest !~ '^[0-9a-f]{64}$'
     OR jsonb_typeof(p_tool_input) IS DISTINCT FROM 'object'
     OR octet_length(p_tool_input::text) > 16384
     OR jsonb_typeof(p_domain_mutation) IS DISTINCT FROM 'object'
     OR octet_length(p_domain_mutation::text) > 2097152
     OR NOT (p_domain_mutation ? 'kind')
     OR jsonb_typeof(p_domain_mutation -> 'kind') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_result) IS DISTINCT FROM 'object'
     OR octet_length(p_result::text) > 65536
     OR p_result ? 'toolInput'
     OR NOT (p_result ?& ARRAY[
       'toolName', 'toolOutput', 'success', 'displayMessage'
     ])
     OR p_result - ARRAY[
       'toolName', 'toolOutput', 'success', 'displayMessage'
     ] <> '{}'::jsonb
     OR jsonb_typeof(p_result -> 'toolName') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_result -> 'toolOutput') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_result -> 'success') IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(p_result -> 'displayMessage') IS DISTINCT FROM 'string'
     OR char_length(p_result ->> 'displayMessage') > 4000 THEN
    RAISE EXCEPTION 'AMORA_ATOMIC_TOOL_INVALID_INPUT'
      USING ERRCODE = '22023';
  END IF;

  -- Retain the audited 1100 implementation for its original mutation kinds,
  -- but only after this public boundary has validated the common envelope.
  IF v_kind IN ('none', 'journey_total_budget_cas')
     OR (
       v_kind = 'journey_progress_key_cas'
       AND p_result ->> 'toolName' <> 'log_wedding_event'
     ) THEN
    RETURN public.apply_amora_atomic_tool_execution_v1(
      p_couple_id, p_request_key, p_operation_key,
      p_request_attempt_count, p_input_digest, p_tool_input,
      p_domain_mutation, p_result
    );
  END IF;

  SELECT claim.* INTO v_request
  FROM public.amora_chat_request_claims AS claim
  WHERE claim.couple_id = p_couple_id
    AND claim.request_key = p_request_key
  FOR UPDATE;
  IF NOT FOUND
     OR v_request.status <> 'processing'
     OR v_request.attempt_count <> p_request_attempt_count THEN
    RAISE EXCEPTION 'AMORA_ATOMIC_TOOL_CLAIM_STALE'
      USING ERRCODE = '40001';
  END IF;

  SELECT execution.* INTO v_execution
  FROM public.amora_tool_executions AS execution
  WHERE execution.couple_id = p_couple_id
    AND execution.request_key = p_request_key
    AND execution.operation_key = p_operation_key
  FOR UPDATE;
  IF NOT FOUND
     OR v_execution.input_digest <> p_input_digest
     OR p_result ->> 'toolName' <> v_execution.tool_name
     OR NOT v_execution.atomic_dispatch
     OR v_execution.request_attempt_count <> p_request_attempt_count THEN
    RAISE EXCEPTION 'AMORA_ATOMIC_TOOL_EXECUTION_MISMATCH'
      USING ERRCODE = '23514';
  END IF;
  IF v_execution.status = 'completed' THEN
    RETURN v_execution.result;
  END IF;
  IF v_execution.status <> 'processing' THEN
    RAISE EXCEPTION 'AMORA_ATOMIC_TOOL_EXECUTION_NOT_PROCESSING'
      USING ERRCODE = '55000';
  END IF;

  IF v_kind = 'journey_wedding_date_cas' THEN
    IF v_execution.tool_name <> 'update_wedding_date'
       OR p_domain_mutation - ARRAY['kind', 'expected', 'value'] <> '{}'::jsonb
       OR jsonb_typeof(p_domain_mutation -> 'expected') NOT IN ('null', 'string')
       OR jsonb_typeof(p_domain_mutation -> 'value') <> 'string'
       OR p_tool_input - 'wedding_date' <> '{}'::jsonb
       OR jsonb_typeof(p_tool_input -> 'wedding_date') <> 'string'
       OR p_tool_input -> 'wedding_date' <> p_domain_mutation -> 'value'
       OR p_result ->> 'success' <> 'true'
       OR NOT ((p_result -> 'toolOutput') ?& ARRAY[
         'wedding_date', 'previous_date', 'd_day'
       ])
       OR (p_result -> 'toolOutput') - ARRAY[
         'wedding_date', 'previous_date', 'd_day'
       ] <> '{}'::jsonb
       OR p_result -> 'toolOutput' -> 'wedding_date'
          <> p_domain_mutation -> 'value'
       OR p_result -> 'toolOutput' -> 'previous_date'
          IS DISTINCT FROM p_domain_mutation -> 'expected'
       OR jsonb_typeof(p_result -> 'toolOutput' -> 'd_day') <> 'number' THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_WEDDING_DATE_INVALID'
        USING ERRCODE = '22023';
    END IF;
    BEGIN
      IF jsonb_typeof(p_domain_mutation -> 'expected') = 'string' THEN
        v_expected_date := (p_domain_mutation ->> 'expected')::date;
        IF to_char(v_expected_date, 'YYYY-MM-DD')
           <> p_domain_mutation ->> 'expected' THEN
          RAISE EXCEPTION 'invalid expected date';
        END IF;
      ELSE
        v_expected_date := NULL;
      END IF;
      v_next_date := (p_domain_mutation ->> 'value')::date;
      IF to_char(v_next_date, 'YYYY-MM-DD') <> p_domain_mutation ->> 'value'
         OR v_next_date < (now() AT TIME ZONE 'Asia/Seoul')::date
         OR (p_result -> 'toolOutput' ->> 'd_day')::integer
            <> v_next_date - (now() AT TIME ZONE 'Asia/Seoul')::date THEN
        RAISE EXCEPTION 'invalid next date';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_WEDDING_DATE_INVALID'
        USING ERRCODE = '22023';
    END;

    SELECT journey.* INTO v_journey
    FROM public.wedding_journeys AS journey
    WHERE journey.couple_id = p_couple_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_JOURNEY_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF v_journey.wedding_date IS DISTINCT FROM v_expected_date THEN
      v_stale := true;
    ELSIF v_journey.wedding_date IS NOT DISTINCT FROM v_next_date THEN
      v_effective_result := jsonb_build_object(
        'toolName', v_execution.tool_name,
        'toolOutput', jsonb_build_object('error', 'no_change', 'retryable', false),
        'success', false,
        'displayMessage', '이미 같은 결혼 예정일로 설정되어 있어요.'
      );
    ELSE
      UPDATE public.wedding_journeys
      SET wedding_date = v_next_date, updated_at = now()
      WHERE couple_id = p_couple_id;
    END IF;

  ELSIF v_kind = 'journey_venue_cas' THEN
    IF v_execution.tool_name <> 'update_venue'
       OR p_domain_mutation - ARRAY['kind', 'expected', 'value'] <> '{}'::jsonb
       OR jsonb_typeof(p_domain_mutation -> 'expected') NOT IN ('null', 'string')
       OR jsonb_typeof(p_domain_mutation -> 'value') <> 'string'
       OR char_length(p_domain_mutation ->> 'value') NOT BETWEEN 1 AND 200
       OR p_tool_input - 'venue' <> '{}'::jsonb
       OR jsonb_typeof(p_tool_input -> 'venue') <> 'string'
       OR regexp_replace(btrim(p_tool_input ->> 'venue'), '[[:space:]]+', ' ', 'g')
          <> p_domain_mutation ->> 'value'
       OR p_result ->> 'success' <> 'true'
       OR NOT ((p_result -> 'toolOutput') ?& ARRAY['venue', 'previous_venue'])
       OR (p_result -> 'toolOutput') - ARRAY['venue', 'previous_venue'] <> '{}'::jsonb
       OR p_result -> 'toolOutput' -> 'venue' <> p_domain_mutation -> 'value'
       OR p_result -> 'toolOutput' -> 'previous_venue'
          IS DISTINCT FROM p_domain_mutation -> 'expected' THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_VENUE_INVALID'
        USING ERRCODE = '22023';
    END IF;
    SELECT journey.* INTO v_journey
    FROM public.wedding_journeys AS journey
    WHERE journey.couple_id = p_couple_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_JOURNEY_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF v_journey.venue IS DISTINCT FROM (p_domain_mutation ->> 'expected') THEN
      v_stale := true;
    ELSIF v_journey.venue IS NOT DISTINCT FROM (p_domain_mutation ->> 'value') THEN
      v_effective_result := jsonb_build_object(
        'toolName', v_execution.tool_name,
        'toolOutput', jsonb_build_object('error', 'no_change', 'retryable', false),
        'success', false,
        'displayMessage', '이미 같은 예식장으로 설정되어 있어요.'
      );
    ELSE
      UPDATE public.wedding_journeys
      SET venue = p_domain_mutation ->> 'value', updated_at = now()
      WHERE couple_id = p_couple_id;
    END IF;

  ELSIF v_kind = 'journey_progress_entry_cas' THEN
    IF v_execution.tool_name NOT IN (
         'update_task_status', 'update_category_budget',
         'add_custom_category', 'toggle_checklist_item'
       )
       OR p_domain_mutation - ARRAY[
         'kind', 'key', 'expectedPresent', 'expected', 'value'
       ] <> '{}'::jsonb
       OR NOT (p_domain_mutation ?& ARRAY['key', 'expectedPresent', 'value'])
       OR jsonb_typeof(p_domain_mutation -> 'key') <> 'string'
       OR char_length(p_domain_mutation ->> 'key') NOT BETWEEN 1 AND 120
       OR jsonb_typeof(p_domain_mutation -> 'expectedPresent') <> 'boolean'
       OR jsonb_typeof(p_domain_mutation -> 'value') <> 'object'
       OR octet_length((p_domain_mutation -> 'value')::text) > 131072
       OR p_result ->> 'success' <> 'true'
       OR NOT ((p_result -> 'toolOutput') ?& ARRAY[
         'progress_key', 'progress_value'
       ])
       OR p_result -> 'toolOutput' ->> 'progress_key'
          <> p_domain_mutation ->> 'key'
       OR p_result -> 'toolOutput' -> 'progress_value'
          IS DISTINCT FROM p_domain_mutation -> 'value' THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_PROGRESS_ENTRY_INVALID'
        USING ERRCODE = '22023';
    END IF;
    v_key := p_domain_mutation ->> 'key';
    v_value := p_domain_mutation -> 'value';
    v_expected_present := (p_domain_mutation ->> 'expectedPresent')::boolean;
    IF (v_expected_present AND NOT (p_domain_mutation ? 'expected'))
       OR (NOT v_expected_present AND p_domain_mutation ? 'expected')
       OR (
         v_expected_present
         AND jsonb_typeof(p_domain_mutation -> 'expected') <> 'object'
       )
       OR (
         v_expected_present
         AND octet_length((p_domain_mutation -> 'expected')::text) > 131072
       ) THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_PROGRESS_EXPECTATION_INVALID'
        USING ERRCODE = '22023';
    END IF;
    v_expected := CASE
      WHEN v_expected_present THEN p_domain_mutation -> 'expected'
      ELSE '{}'::jsonb
    END;

    IF v_execution.tool_name = 'update_task_status' THEN
      IF p_tool_input - ARRAY['category', 'status'] <> '{}'::jsonb
         OR NOT (p_tool_input ?& ARRAY['category', 'status'])
         OR jsonb_typeof(p_tool_input -> 'category') <> 'string'
         OR jsonb_typeof(p_tool_input -> 'status') <> 'string'
         OR v_key <> p_tool_input ->> 'category'
         OR v_key NOT IN (
           'meeting', 'venue', 'studio', 'dress', 'makeup', 'ring',
           'hanbok', 'yedan', 'honeymoon', 'houseware', 'housing',
           'invitation', 'snap', 'shoes', 'bouquet', 'gift', 'mc',
           'ham', 'pyebaek'
         )
         OR p_tool_input ->> 'status' NOT IN (
           'not_started', 'in_progress', 'completed'
         )
         OR NOT (v_value ?& ARRAY['category', 'status'])
         OR v_value ->> 'category' <> v_key
         OR v_value ->> 'status' <> p_tool_input ->> 'status'
         OR v_value - ARRAY['category', 'status']
            IS DISTINCT FROM v_expected - ARRAY['category', 'status']
         OR (p_result -> 'toolOutput') - ARRAY[
           'category', 'status',
           'progress_key', 'progress_value'
         ] <> '{}'::jsonb
         OR NOT ((p_result -> 'toolOutput') ?& ARRAY[
           'category', 'status',
           'progress_key', 'progress_value'
         ])
         OR p_result -> 'toolOutput' ->> 'category' <> v_key
         OR p_result -> 'toolOutput' ->> 'status'
            <> p_tool_input ->> 'status' THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_TASK_STATUS_INVALID'
          USING ERRCODE = '22023';
      END IF;

    ELSIF v_execution.tool_name = 'update_category_budget' THEN
      IF p_tool_input - ARRAY['category', 'budget', 'spent'] <> '{}'::jsonb
         OR NOT (p_tool_input ? 'category')
         OR (NOT (p_tool_input ? 'budget') AND NOT (p_tool_input ? 'spent'))
         OR jsonb_typeof(p_tool_input -> 'category') <> 'string'
         OR v_key <> p_tool_input ->> 'category'
         OR v_key NOT IN (
           'meeting', 'venue', 'studio', 'dress', 'makeup', 'ring',
           'hanbok', 'yedan', 'honeymoon', 'houseware', 'housing',
           'invitation', 'snap', 'shoes', 'bouquet', 'gift', 'mc',
           'ham', 'pyebaek', 'reserve'
         )
         OR NOT (v_value ?& ARRAY['category', 'status'])
         OR v_value ->> 'category' <> v_key
         OR v_value ->> 'status' NOT IN (
           'not_started', 'in_progress', 'completed'
         )
         OR v_value - ARRAY['category', 'status', 'budget', 'spent']
            IS DISTINCT FROM v_expected - ARRAY['category', 'status', 'budget', 'spent']
         OR (p_result -> 'toolOutput') - ARRAY[
           'category', 'budget', 'spent',
           'progress_key', 'progress_value'
         ] <> '{}'::jsonb
         OR NOT ((p_result -> 'toolOutput') ?& ARRAY[
           'category', 'progress_key', 'progress_value'
         ])
         OR p_result -> 'toolOutput' ->> 'category' <> v_key THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_CATEGORY_BUDGET_INVALID'
          USING ERRCODE = '22023';
      END IF;
      FOREACH v_normalized IN ARRAY ARRAY['budget', 'spent'] LOOP
        IF p_tool_input ? v_normalized THEN
          IF jsonb_typeof(p_tool_input -> v_normalized) <> 'number'
             OR NOT ((p_result -> 'toolOutput') ? v_normalized)
             OR p_tool_input -> v_normalized <> v_value -> v_normalized
             OR p_result -> 'toolOutput' -> v_normalized
                <> p_tool_input -> v_normalized THEN
            RAISE EXCEPTION 'AMORA_ATOMIC_CATEGORY_BUDGET_INVALID'
              USING ERRCODE = '22023';
          END IF;
          BEGIN
            v_next_budget := (p_tool_input ->> v_normalized)::numeric;
          EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'AMORA_ATOMIC_CATEGORY_BUDGET_INVALID'
              USING ERRCODE = '22023';
          END;
          IF trunc(v_next_budget) <> v_next_budget
             OR v_next_budget NOT BETWEEN 0 AND 1000000000000 THEN
            RAISE EXCEPTION 'AMORA_ATOMIC_CATEGORY_BUDGET_INVALID'
              USING ERRCODE = '22023';
          END IF;
        END IF;
      END LOOP;

    ELSIF v_execution.tool_name = 'add_custom_category' THEN
      IF p_tool_input - ARRAY['label', 'budget', 'spent'] <> '{}'::jsonb
         OR NOT (p_tool_input ? 'label')
         OR jsonb_typeof(p_tool_input -> 'label') <> 'string'
         OR char_length(v_key) <> 31
         OR v_key !~ '^custom_[0-9a-f]{24}$'
         OR NOT (v_value ?& ARRAY['category', 'label', 'status'])
         OR v_value ->> 'category' <> v_key
         OR jsonb_typeof(v_value -> 'label') <> 'string'
         OR char_length(v_value ->> 'label') NOT BETWEEN 1 AND 60
         OR v_value ->> 'status' NOT IN (
           'not_started', 'in_progress', 'completed'
         )
         OR v_value - ARRAY['category', 'label', 'status', 'budget', 'spent']
            IS DISTINCT FROM v_expected - ARRAY['category', 'label', 'status', 'budget', 'spent']
         OR (p_result -> 'toolOutput') - ARRAY[
           'key', 'label', 'created', 'progress_key', 'progress_value'
         ] <> '{}'::jsonb
         OR NOT ((p_result -> 'toolOutput') ?& ARRAY[
           'key', 'label', 'created', 'progress_key', 'progress_value'
         ])
         OR p_result -> 'toolOutput' ->> 'key' <> v_key
         OR p_result -> 'toolOutput' ->> 'label' <> v_value ->> 'label'
         OR jsonb_typeof(p_result -> 'toolOutput' -> 'created') <> 'boolean'
         OR (p_result -> 'toolOutput' ->> 'created')::boolean
            IS DISTINCT FROM NOT v_expected_present THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_CUSTOM_CATEGORY_INVALID'
          USING ERRCODE = '22023';
      END IF;
      v_normalized := lower(regexp_replace(
        btrim(p_tool_input ->> 'label'), '[[:space:]]+', ' ', 'g'
      ));
      IF v_value ->> 'label' <> left(
           regexp_replace(btrim(p_tool_input ->> 'label'), '[[:space:]]+', ' ', 'g'),
           60
         )
         OR char_length(regexp_replace(
           btrim(p_tool_input ->> 'label'), '[[:space:]]+', ' ', 'g'
         )) NOT BETWEEN 1 AND 60
         OR (
           NOT v_expected_present
           AND v_key <> 'custom_' || left(md5(p_couple_id::text || E'\n' || v_normalized), 24)
         )
         OR (
           v_expected_present
           AND lower(regexp_replace(
             btrim(v_expected ->> 'label'), '[[:space:]]+', ' ', 'g'
           )) <> v_normalized
         ) THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_CUSTOM_CATEGORY_INVALID'
          USING ERRCODE = '22023';
      END IF;
      FOREACH v_normalized IN ARRAY ARRAY['budget', 'spent'] LOOP
        IF p_tool_input ? v_normalized THEN
          IF jsonb_typeof(p_tool_input -> v_normalized) <> 'number'
             OR p_tool_input -> v_normalized <> v_value -> v_normalized THEN
            RAISE EXCEPTION 'AMORA_ATOMIC_CUSTOM_CATEGORY_AMOUNT_INVALID'
              USING ERRCODE = '22023';
          END IF;
          BEGIN
            v_next_budget := (p_tool_input ->> v_normalized)::numeric;
          EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'AMORA_ATOMIC_CUSTOM_CATEGORY_AMOUNT_INVALID'
              USING ERRCODE = '22023';
          END;
          IF trunc(v_next_budget) <> v_next_budget
             OR v_next_budget NOT BETWEEN 0 AND 1000000000000 THEN
            RAISE EXCEPTION 'AMORA_ATOMIC_CUSTOM_CATEGORY_AMOUNT_INVALID'
              USING ERRCODE = '22023';
          END IF;
        END IF;
      END LOOP;

    ELSE
      IF p_tool_input - ARRAY['category', 'item_id', 'done'] <> '{}'::jsonb
         OR NOT (p_tool_input ?& ARRAY['category', 'item_id', 'done'])
         OR jsonb_typeof(p_tool_input -> 'category') <> 'string'
         OR jsonb_typeof(p_tool_input -> 'item_id') <> 'string'
         OR jsonb_typeof(p_tool_input -> 'done') <> 'boolean'
         OR v_key <> p_tool_input ->> 'category'
         OR v_key NOT IN (
           'meeting', 'venue', 'studio', 'dress', 'makeup', 'ring',
           'hanbok', 'yedan', 'honeymoon', 'houseware', 'housing',
           'invitation', 'snap', 'shoes', 'bouquet', 'gift', 'mc',
           'ham', 'pyebaek'
         )
         OR NOT (v_value ?& ARRAY['category', 'status', 'checklist'])
         OR v_value ->> 'category' <> v_key
         OR v_value ->> 'status' NOT IN (
           'not_started', 'in_progress', 'completed'
         )
         OR jsonb_typeof(v_value -> 'checklist') <> 'array'
         OR jsonb_array_length(v_value -> 'checklist') NOT BETWEEN 1 AND 100
         OR v_value - ARRAY['category', 'status', 'checklist']
            IS DISTINCT FROM v_expected - ARRAY['category', 'status', 'checklist']
         OR (p_result -> 'toolOutput') - ARRAY[
           'category', 'item_id', 'done', 'new_status', 'item_label',
           'progress_key', 'progress_value'
         ] <> '{}'::jsonb
         OR NOT ((p_result -> 'toolOutput') ?& ARRAY[
           'category', 'item_id', 'done', 'new_status', 'item_label',
           'progress_key', 'progress_value'
         ])
         OR p_result -> 'toolOutput' ->> 'category' <> v_key
         OR p_result -> 'toolOutput' ->> 'item_id'
            <> p_tool_input ->> 'item_id'
         OR p_result -> 'toolOutput' -> 'done' <> p_tool_input -> 'done'
         OR p_result -> 'toolOutput' ->> 'new_status' <> v_value ->> 'status'
         OR jsonb_typeof(p_result -> 'toolOutput' -> 'item_label') <> 'string' THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_CHECKLIST_INVALID'
          USING ERRCODE = '22023';
      END IF;
      v_count := 0;
      v_done_count := 0;
      FOR v_item IN SELECT value FROM jsonb_array_elements(v_value -> 'checklist') LOOP
        IF jsonb_typeof(v_item) <> 'object'
           OR v_item - ARRAY['id', 'label', 'done'] <> '{}'::jsonb
           OR NOT (v_item ?& ARRAY['id', 'label', 'done'])
           OR jsonb_typeof(v_item -> 'id') <> 'string'
           OR jsonb_typeof(v_item -> 'label') <> 'string'
           OR jsonb_typeof(v_item -> 'done') <> 'boolean'
           OR char_length(v_item ->> 'id') NOT BETWEEN 1 AND 120
           OR char_length(v_item ->> 'label') NOT BETWEEN 1 AND 500 THEN
          RAISE EXCEPTION 'AMORA_ATOMIC_CHECKLIST_ITEM_INVALID'
            USING ERRCODE = '22023';
        END IF;
        IF (v_item ->> 'done')::boolean THEN v_done_count := v_done_count + 1; END IF;
        IF v_item ->> 'id' = p_tool_input ->> 'item_id' THEN
          v_count := v_count + 1;
          IF v_item -> 'done' <> p_tool_input -> 'done'
             OR v_item ->> 'label' <> p_result -> 'toolOutput' ->> 'item_label' THEN
            RAISE EXCEPTION 'AMORA_ATOMIC_CHECKLIST_TARGET_INVALID'
              USING ERRCODE = '22023';
          END IF;
        END IF;
      END LOOP;
      IF v_count <> 1
         OR (
           CASE
             WHEN v_done_count = 0 THEN 'not_started'
             WHEN v_done_count = jsonb_array_length(v_value -> 'checklist') THEN 'completed'
             ELSE 'in_progress'
           END
         ) <> v_value ->> 'status' THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_CHECKLIST_STATUS_INVALID'
          USING ERRCODE = '22023';
      END IF;
      SELECT count(*)::integer, count(DISTINCT value ->> 'id')::integer
      INTO v_count, v_distinct_count
      FROM jsonb_array_elements(v_value -> 'checklist');
      IF v_count <> v_distinct_count THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_CHECKLIST_ID_DUPLICATE'
          USING ERRCODE = '22023';
      END IF;
    END IF;

    SELECT journey.* INTO v_journey
    FROM public.wedding_journeys AS journey
    WHERE journey.couple_id = p_couple_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_JOURNEY_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    v_current_present := v_journey.progress ? v_key;
    IF v_current_present IS DISTINCT FROM v_expected_present
       OR (
         v_expected_present
         AND v_journey.progress -> v_key IS DISTINCT FROM v_expected
       ) THEN
      v_stale := true;
    ELSIF v_journey.progress -> v_key IS NOT DISTINCT FROM v_value THEN
      v_effective_result := jsonb_build_object(
        'toolName', v_execution.tool_name,
        'toolOutput', jsonb_build_object('error', 'no_change', 'retryable', false),
        'success', false,
        'displayMessage', '이미 같은 내용으로 저장되어 있어요.'
      );
    ELSE
      UPDATE public.wedding_journeys
      SET progress = jsonb_set(progress, ARRAY[v_key], v_value, true),
          updated_at = now()
      WHERE couple_id = p_couple_id;
    END IF;
  ELSIF v_kind = 'journey_budget_plan_cas' THEN
    IF v_execution.tool_name <> 'apply_budget_plan'
       OR p_domain_mutation - ARRAY[
         'kind', 'expectedBudget', 'valueBudget', 'entries'
       ] <> '{}'::jsonb
       OR NOT (p_domain_mutation ?& ARRAY[
         'expectedBudget', 'valueBudget', 'entries'
       ])
       OR jsonb_typeof(p_domain_mutation -> 'expectedBudget') <> 'number'
       OR jsonb_typeof(p_domain_mutation -> 'valueBudget') <> 'number'
       OR jsonb_typeof(p_domain_mutation -> 'entries') <> 'array'
       OR jsonb_array_length(p_domain_mutation -> 'entries') NOT BETWEEN 1 AND 20
       OR p_tool_input - ARRAY[
         'total_budget', 'allocations', 'intake_summary'
       ] <> '{}'::jsonb
       OR NOT (p_tool_input ?& ARRAY['total_budget', 'allocations'])
       OR jsonb_typeof(p_tool_input -> 'total_budget') <> 'number'
       OR jsonb_typeof(p_tool_input -> 'allocations') <> 'array'
       OR jsonb_array_length(p_tool_input -> 'allocations') NOT BETWEEN 1 AND 20
       OR (
         p_tool_input ? 'intake_summary'
         AND (
           jsonb_typeof(p_tool_input -> 'intake_summary') <> 'string'
           OR char_length(p_tool_input ->> 'intake_summary') > 2000
         )
       )
       OR p_tool_input -> 'total_budget'
          <> p_domain_mutation -> 'valueBudget'
       OR p_result ->> 'success' <> 'true'
       OR NOT ((p_result -> 'toolOutput') ?& ARRAY[
         'total_budget', 'previous_budget', 'applied_count',
         'remainder_to_reserve', 'allocations'
       ])
       OR (p_result -> 'toolOutput') - ARRAY[
         'total_budget', 'previous_budget', 'applied_count',
         'remainder_to_reserve', 'allocations'
       ] <> '{}'::jsonb
       OR p_result -> 'toolOutput' -> 'total_budget'
          <> p_domain_mutation -> 'valueBudget'
       OR p_result -> 'toolOutput' -> 'previous_budget'
          <> p_domain_mutation -> 'expectedBudget'
       OR jsonb_typeof(p_result -> 'toolOutput' -> 'applied_count') <> 'number'
       OR jsonb_typeof(p_result -> 'toolOutput' -> 'remainder_to_reserve') <> 'number'
       OR jsonb_typeof(p_result -> 'toolOutput' -> 'allocations') <> 'array' THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_BUDGET_PLAN_INVALID'
        USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_expected_budget := (p_domain_mutation ->> 'expectedBudget')::numeric;
      v_next_budget := (p_domain_mutation ->> 'valueBudget')::numeric;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_BUDGET_PLAN_INVALID'
        USING ERRCODE = '22023';
    END;
    IF trunc(v_expected_budget) <> v_expected_budget
       OR trunc(v_next_budget) <> v_next_budget
       OR v_expected_budget NOT BETWEEN 0 AND 1000000000000
       OR v_next_budget NOT BETWEEN 0 AND 1000000000000 THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_BUDGET_PLAN_INVALID'
        USING ERRCODE = '22023';
    END IF;

    v_allocation_sum := 0;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_tool_input -> 'allocations') LOOP
      IF jsonb_typeof(v_item) <> 'object'
         OR v_item - ARRAY['category', 'budget', 'rationale'] <> '{}'::jsonb
         OR NOT (v_item ?& ARRAY['category', 'budget'])
         OR jsonb_typeof(v_item -> 'category') <> 'string'
         OR jsonb_typeof(v_item -> 'budget') <> 'number'
         OR v_item ->> 'category' NOT IN (
           'meeting', 'venue', 'studio', 'dress', 'makeup', 'ring',
           'hanbok', 'yedan', 'honeymoon', 'houseware', 'housing',
           'invitation', 'snap', 'shoes', 'bouquet', 'gift', 'mc',
           'ham', 'pyebaek', 'reserve'
         )
         OR (
           v_item ? 'rationale'
           AND (
             jsonb_typeof(v_item -> 'rationale') <> 'string'
             OR char_length(v_item ->> 'rationale') > 500
           )
         ) THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_BUDGET_ALLOCATION_INVALID'
          USING ERRCODE = '22023';
      END IF;
      BEGIN
        v_allocation_budget := (v_item ->> 'budget')::numeric;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_BUDGET_ALLOCATION_INVALID'
          USING ERRCODE = '22023';
      END;
      IF trunc(v_allocation_budget) <> v_allocation_budget
         OR v_allocation_budget NOT BETWEEN 0 AND 1000000000000 THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_BUDGET_ALLOCATION_INVALID'
          USING ERRCODE = '22023';
      END IF;
      v_allocation_sum := v_allocation_sum + v_allocation_budget;
    END LOOP;
    SELECT count(*)::integer, count(DISTINCT value ->> 'category')::integer
    INTO v_count, v_distinct_count
    FROM jsonb_array_elements(p_tool_input -> 'allocations');
    IF v_count <> v_distinct_count OR v_allocation_sum > v_next_budget THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_BUDGET_ALLOCATION_INVALID'
        USING ERRCODE = '22023';
    END IF;
    v_remainder := v_next_budget - v_allocation_sum;
    v_expected_entry_count := v_count;
    IF v_remainder > 0
       AND NOT EXISTS (
         SELECT 1
         FROM jsonb_array_elements(p_tool_input -> 'allocations') AS allocation(value)
         WHERE allocation.value ->> 'category' = 'reserve'
       ) THEN
      v_expected_entry_count := v_expected_entry_count + 1;
    END IF;
    IF jsonb_array_length(p_domain_mutation -> 'entries') <> v_expected_entry_count
       OR jsonb_array_length(p_result -> 'toolOutput' -> 'allocations')
          <> v_expected_entry_count
       OR (p_result -> 'toolOutput' ->> 'applied_count')::integer
          <> v_expected_entry_count
       OR (p_result -> 'toolOutput' ->> 'remainder_to_reserve')::numeric
          <> v_remainder THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_BUDGET_PLAN_SUMMARY_INVALID'
        USING ERRCODE = '22023';
    END IF;

    FOR v_entry IN SELECT value FROM jsonb_array_elements(p_domain_mutation -> 'entries') LOOP
      IF jsonb_typeof(v_entry) <> 'object'
         OR v_entry - ARRAY['key', 'expectedPresent', 'expected', 'value'] <> '{}'::jsonb
         OR NOT (v_entry ?& ARRAY['key', 'expectedPresent', 'value'])
         OR jsonb_typeof(v_entry -> 'key') <> 'string'
         OR jsonb_typeof(v_entry -> 'expectedPresent') <> 'boolean'
         OR jsonb_typeof(v_entry -> 'value') <> 'object'
         OR v_entry ->> 'key' NOT IN (
           'meeting', 'venue', 'studio', 'dress', 'makeup', 'ring',
           'hanbok', 'yedan', 'honeymoon', 'houseware', 'housing',
           'invitation', 'snap', 'shoes', 'bouquet', 'gift', 'mc',
           'ham', 'pyebaek', 'reserve'
         )
         OR v_entry -> 'value' ->> 'category' <> v_entry ->> 'key'
         OR v_entry -> 'value' ->> 'status' NOT IN (
           'not_started', 'in_progress', 'completed'
         )
         OR jsonb_typeof(v_entry -> 'value' -> 'budget') <> 'number' THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_BUDGET_PLAN_ENTRY_INVALID'
          USING ERRCODE = '22023';
      END IF;
      v_expected_present := (v_entry ->> 'expectedPresent')::boolean;
      IF (v_expected_present AND NOT (v_entry ? 'expected'))
         OR (NOT v_expected_present AND v_entry ? 'expected')
         OR (
           v_expected_present
           AND jsonb_typeof(v_entry -> 'expected') <> 'object'
         ) THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_BUDGET_PLAN_ENTRY_INVALID'
          USING ERRCODE = '22023';
      END IF;
      v_expected := CASE
        WHEN v_expected_present THEN v_entry -> 'expected'
        ELSE '{}'::jsonb
      END;
      IF (v_entry -> 'value') - ARRAY['category', 'status', 'budget']
         IS DISTINCT FROM v_expected - ARRAY['category', 'status', 'budget'] THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_BUDGET_PLAN_ENTRY_INVALID'
          USING ERRCODE = '22023';
      END IF;
      v_allocation_budget := NULL;
      SELECT (allocation.value ->> 'budget')::numeric
      INTO v_allocation_budget
      FROM jsonb_array_elements(p_tool_input -> 'allocations') AS allocation(value)
      WHERE allocation.value ->> 'category' = v_entry ->> 'key';
      IF v_entry ->> 'key' = 'reserve' THEN
        v_allocation_budget := COALESCE(v_allocation_budget, 0) + v_remainder;
      ELSIF v_allocation_budget IS NULL THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_BUDGET_PLAN_ENTRY_UNBOUND'
          USING ERRCODE = '22023';
      END IF;
      IF (v_entry -> 'value' ->> 'budget')::numeric <> v_allocation_budget THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_BUDGET_PLAN_ENTRY_AMOUNT_INVALID'
          USING ERRCODE = '22023';
      END IF;
      SELECT count(*)::integer INTO v_count
      FROM jsonb_array_elements(p_result -> 'toolOutput' -> 'allocations') AS output(value)
      WHERE output.value = jsonb_build_object(
        'category', v_entry ->> 'key', 'budget', v_allocation_budget
      );
      IF v_count <> 1 THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_BUDGET_PLAN_RESULT_INVALID'
          USING ERRCODE = '22023';
      END IF;
    END LOOP;
    SELECT count(*)::integer, count(DISTINCT value ->> 'key')::integer
    INTO v_count, v_distinct_count
    FROM jsonb_array_elements(p_domain_mutation -> 'entries');
    IF v_count <> v_distinct_count THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_BUDGET_PLAN_ENTRY_DUPLICATE'
        USING ERRCODE = '22023';
    END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_result -> 'toolOutput' -> 'allocations') LOOP
      IF jsonb_typeof(v_item) <> 'object'
         OR v_item - ARRAY['category', 'budget'] <> '{}'::jsonb
         OR NOT (v_item ?& ARRAY['category', 'budget']) THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_BUDGET_PLAN_RESULT_INVALID'
          USING ERRCODE = '22023';
      END IF;
    END LOOP;

    SELECT journey.* INTO v_journey
    FROM public.wedding_journeys AS journey
    WHERE journey.couple_id = p_couple_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_JOURNEY_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF v_journey.total_budget IS DISTINCT FROM v_expected_budget THEN
      v_stale := true;
    END IF;
    FOR v_entry IN SELECT value FROM jsonb_array_elements(p_domain_mutation -> 'entries') LOOP
      v_key := v_entry ->> 'key';
      v_expected_present := (v_entry ->> 'expectedPresent')::boolean;
      v_current_present := v_journey.progress ? v_key;
      IF v_current_present IS DISTINCT FROM v_expected_present
         OR (
           v_expected_present
           AND v_journey.progress -> v_key
               IS DISTINCT FROM v_entry -> 'expected'
         ) THEN
        v_stale := true;
      END IF;
      IF v_journey.progress -> v_key IS DISTINCT FROM v_entry -> 'value' THEN
        v_changed := true;
      END IF;
    END LOOP;
    IF NOT v_stale THEN
      IF v_journey.total_budget IS DISTINCT FROM v_next_budget THEN
        v_changed := true;
      END IF;
      IF NOT v_changed THEN
        v_effective_result := jsonb_build_object(
          'toolName', v_execution.tool_name,
          'toolOutput', jsonb_build_object('error', 'no_change', 'retryable', false),
          'success', false,
          'displayMessage', '이미 같은 예산안이 적용되어 있어요.'
        );
      ELSE
        v_current_progress := v_journey.progress;
        FOR v_entry IN SELECT value FROM jsonb_array_elements(p_domain_mutation -> 'entries') LOOP
          v_current_progress := jsonb_set(
            v_current_progress,
            ARRAY[v_entry ->> 'key'],
            v_entry -> 'value',
            true
          );
        END LOOP;
        UPDATE public.wedding_journeys
        SET total_budget = v_next_budget,
            progress = v_current_progress,
            updated_at = now()
        WHERE couple_id = p_couple_id;
      END IF;
    END IF;
  ELSIF v_kind = 'journey_progress_key_cas'
        AND v_execution.tool_name = 'log_wedding_event' THEN
    IF p_domain_mutation - ARRAY[
         'kind', 'key', 'expectedPresent', 'expected', 'value'
       ] <> '{}'::jsonb
       OR NOT (p_domain_mutation ?& ARRAY[
         'key', 'expectedPresent', 'value'
       ])
       OR p_domain_mutation ->> 'key' <> '__events'
       OR jsonb_typeof(p_domain_mutation -> 'expectedPresent') <> 'boolean'
       OR jsonb_typeof(p_domain_mutation -> 'value') <> 'array'
       OR jsonb_array_length(p_domain_mutation -> 'value') > 500
       OR octet_length((p_domain_mutation -> 'value')::text) > 1572864
       OR p_tool_input - ARRAY[
         'moment_type', 'date', 'title', 'memo'
       ] <> '{}'::jsonb
       OR NOT (p_tool_input ?& ARRAY['moment_type', 'date'])
       OR jsonb_typeof(p_tool_input -> 'moment_type') <> 'string'
       OR p_tool_input ->> 'moment_type' NOT IN (
         'family_greeting', 'sanggyeonrye', 'venue_tour', 'dress_tour',
         'studio_shoot', 'dress_fitting', 'invitation_meeting', 'first_holiday'
       )
       OR jsonb_typeof(p_tool_input -> 'date') <> 'string'
       OR (
         p_tool_input ? 'title'
         AND (
           jsonb_typeof(p_tool_input -> 'title') <> 'string'
           OR char_length(regexp_replace(
             btrim(p_tool_input ->> 'title'), '[[:space:]]+', ' ', 'g'
           )) NOT BETWEEN 1 AND 60
         )
       )
       OR (
         p_tool_input ? 'memo'
         AND (
           jsonb_typeof(p_tool_input -> 'memo') <> 'string'
           OR char_length(p_tool_input ->> 'memo') > 300
         )
       )
       OR p_result ->> 'success' <> 'true'
       OR NOT ((p_result -> 'toolOutput') ?& ARRAY[
         'event', 'created'
       ])
       OR (p_result -> 'toolOutput') - ARRAY[
         'event', 'created'
       ] <> '{}'::jsonb
       OR jsonb_typeof(p_result -> 'toolOutput' -> 'event') <> 'object'
       OR jsonb_typeof(p_result -> 'toolOutput' -> 'created') <> 'boolean'
       OR NOT (
         p_domain_mutation -> 'value'
         @> jsonb_build_array(p_result -> 'toolOutput' -> 'event')
       )
       OR p_result -> 'toolOutput' -> 'event' ->> 'momentType'
          <> p_tool_input ->> 'moment_type'
       OR p_result -> 'toolOutput' -> 'event' ->> 'date'
          <> p_tool_input ->> 'date' THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_WEDDING_EVENT_INVALID'
        USING ERRCODE = '22023';
    END IF;
    v_expected_present := (p_domain_mutation ->> 'expectedPresent')::boolean;
    IF (v_expected_present AND NOT (p_domain_mutation ? 'expected'))
       OR (NOT v_expected_present AND p_domain_mutation ? 'expected')
       OR (
         v_expected_present
         AND jsonb_typeof(p_domain_mutation -> 'expected') <> 'array'
       )
       OR (
         v_expected_present
         AND (
           jsonb_array_length(p_domain_mutation -> 'expected') > 500
           OR octet_length((p_domain_mutation -> 'expected')::text) > 1572864
         )
       ) THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_WEDDING_EVENT_EXPECTATION_INVALID'
        USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_event_date := (p_tool_input ->> 'date')::date;
      IF to_char(v_event_date, 'YYYY-MM-DD') <> p_tool_input ->> 'date' THEN
        RAISE EXCEPTION 'invalid date';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_WEDDING_EVENT_INVALID'
        USING ERRCODE = '22023';
    END;
    IF p_tool_input ? 'title'
       AND regexp_replace(
         btrim(p_tool_input ->> 'title'), '[[:space:]]+', ' ', 'g'
       ) <> p_result -> 'toolOutput' -> 'event' ->> 'title' THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_WEDDING_EVENT_TITLE_INVALID'
        USING ERRCODE = '22023';
    END IF;
    IF p_tool_input ? 'memo'
       AND left(p_tool_input ->> 'memo', 300)
           <> COALESCE(p_result -> 'toolOutput' -> 'event' ->> 'memo', '') THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_WEDDING_EVENT_MEMO_INVALID'
        USING ERRCODE = '22023';
    END IF;

    FOR v_event IN
      SELECT value FROM jsonb_array_elements(p_domain_mutation -> 'value')
      UNION ALL
      SELECT value FROM jsonb_array_elements(
        CASE
          WHEN v_expected_present THEN p_domain_mutation -> 'expected'
          ELSE '[]'::jsonb
        END
      )
    LOOP
      IF jsonb_typeof(v_event) <> 'object'
         OR char_length(COALESCE(v_event ->> 'id', '')) NOT BETWEEN 1 AND 200
         OR COALESCE(v_event ->> 'date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
         OR char_length(btrim(COALESCE(v_event ->> 'title', ''))) NOT BETWEEN 1 AND 500
         OR char_length(COALESCE(v_event ->> 'createdAt', '')) NOT BETWEEN 1 AND 100
         OR char_length(COALESCE(v_event ->> 'updatedAt', '')) NOT BETWEEN 1 AND 100
         OR (v_event ? 'memo' AND jsonb_typeof(v_event -> 'memo') <> 'string')
         OR char_length(COALESCE(v_event ->> 'memo', '')) > 2000
         OR (v_event ? 'categoryKey' AND jsonb_typeof(v_event -> 'categoryKey') <> 'string')
         OR char_length(COALESCE(v_event ->> 'categoryKey', '')) > 100
         OR (v_event ? 'sourceKey' AND jsonb_typeof(v_event -> 'sourceKey') <> 'string')
         OR char_length(COALESCE(v_event ->> 'sourceKey', '')) > 200
         OR (v_event ? 'momentType' AND jsonb_typeof(v_event -> 'momentType') <> 'string')
         OR char_length(COALESCE(v_event ->> 'momentType', '')) > 100 THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_WEDDING_EVENT_SHAPE_INVALID'
          USING ERRCODE = '22023';
      END IF;
      BEGIN
        v_event_date := (v_event ->> 'date')::date;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_WEDDING_EVENT_SHAPE_INVALID'
          USING ERRCODE = '22023';
      END;
      IF to_char(v_event_date, 'YYYY-MM-DD') <> v_event ->> 'date' THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_WEDDING_EVENT_SHAPE_INVALID'
          USING ERRCODE = '22023';
      END IF;
    END LOOP;
    SELECT count(*)::integer, count(DISTINCT value ->> 'id')::integer
    INTO v_count, v_distinct_count
    FROM jsonb_array_elements(p_domain_mutation -> 'value');
    IF v_count <> v_distinct_count THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_WEDDING_EVENT_ID_DUPLICATE'
        USING ERRCODE = '22023';
    END IF;
    IF v_expected_present THEN
      SELECT count(*)::integer, count(DISTINCT value ->> 'id')::integer
      INTO v_count, v_distinct_count
      FROM jsonb_array_elements(p_domain_mutation -> 'expected');
      IF v_count <> v_distinct_count THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_WEDDING_EVENT_EXPECTED_ID_DUPLICATE'
          USING ERRCODE = '22023';
      END IF;
    END IF;

    v_event := p_result -> 'toolOutput' -> 'event';
    IF (p_result -> 'toolOutput' ->> 'created')::boolean THEN
      IF (
           v_expected_present
           AND EXISTS (
             SELECT 1
             FROM jsonb_array_elements(p_domain_mutation -> 'expected') AS prior(value)
             WHERE prior.value ->> 'momentType' = p_tool_input ->> 'moment_type'
               AND prior.value ->> 'date' = p_tool_input ->> 'date'
           )
         )
         OR jsonb_array_length(p_domain_mutation -> 'value')
            <> COALESCE(jsonb_array_length(p_domain_mutation -> 'expected'), 0) + 1 THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_WEDDING_EVENT_CREATE_INVALID'
          USING ERRCODE = '22023';
      END IF;
    ELSE
      IF NOT v_expected_present
         OR jsonb_array_length(p_domain_mutation -> 'value')
            <> jsonb_array_length(p_domain_mutation -> 'expected') THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_WEDDING_EVENT_UPDATE_INVALID'
          USING ERRCODE = '22023';
      END IF;
      SELECT value INTO v_prior_event
      FROM jsonb_array_elements(p_domain_mutation -> 'expected') AS prior(value)
      WHERE prior.value ->> 'id' = v_event ->> 'id';
      IF v_prior_event IS NULL
         OR v_prior_event ->> 'momentType' <> p_tool_input ->> 'moment_type'
         OR v_prior_event ->> 'date' <> p_tool_input ->> 'date' THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_WEDDING_EVENT_UPDATE_INVALID'
          USING ERRCODE = '22023';
      END IF;
    END IF;
    IF v_expected_present AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_domain_mutation -> 'expected') AS prior(value)
      WHERE prior.value ->> 'id' <> v_event ->> 'id'
        AND NOT (
          p_domain_mutation -> 'value' @> jsonb_build_array(prior.value)
        )
    ) THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_WEDDING_EVENT_CONCURRENT_VALUE_INVALID'
        USING ERRCODE = '22023';
    END IF;

    SELECT journey.* INTO v_journey
    FROM public.wedding_journeys AS journey
    WHERE journey.couple_id = p_couple_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_JOURNEY_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    v_current_present := v_journey.progress ? '__events';
    IF v_current_present IS DISTINCT FROM v_expected_present
       OR (
         v_expected_present
         AND v_journey.progress -> '__events'
             IS DISTINCT FROM p_domain_mutation -> 'expected'
       ) THEN
      v_stale := true;
    ELSIF v_journey.progress -> '__events'
          IS NOT DISTINCT FROM p_domain_mutation -> 'value' THEN
      v_effective_result := jsonb_build_object(
        'toolName', v_execution.tool_name,
        'toolOutput', jsonb_build_object('error', 'no_change', 'retryable', false),
        'success', false,
        'displayMessage', '이미 같은 웨딩 일정이 저장되어 있어요.'
      );
    ELSE
      UPDATE public.wedding_journeys
      SET progress = jsonb_set(
            progress, ARRAY['__events'], p_domain_mutation -> 'value', true
          ),
          updated_at = now()
      WHERE couple_id = p_couple_id;
    END IF;
  ELSIF v_kind = 'amora_action_insert' THEN
    v_value := p_domain_mutation -> 'action';
    IF v_execution.tool_name <> 'add_amora_action'
       OR p_domain_mutation - ARRAY['kind', 'action'] <> '{}'::jsonb
       OR jsonb_typeof(v_value) <> 'object'
       OR v_value - ARRAY[
         'id', 'title', 'description', 'dueDate', 'categoryKey',
         'priority', 'status', 'source', 'href'
       ] <> '{}'::jsonb
       OR NOT (v_value ?& ARRAY[
         'id', 'title', 'description', 'dueDate', 'categoryKey',
         'priority', 'status', 'source', 'href'
       ])
       OR p_tool_input - ARRAY[
         'title', 'description', 'due_date', 'category_key',
         'priority', 'source', 'href'
       ] <> '{}'::jsonb
       OR NOT (p_tool_input ? 'title')
       OR p_result ->> 'success' <> 'true'
       OR NOT ((p_result -> 'toolOutput') ? 'action')
       OR (p_result -> 'toolOutput') - 'action' <> '{}'::jsonb
       OR p_result -> 'toolOutput' -> 'action' IS DISTINCT FROM v_value THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_ACTION_INSERT_INVALID'
        USING ERRCODE = '22023';
    END IF;
    v_expected_action_id := 'act_'
      || replace(lower(substring(
        p_request_key FROM ':([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$'
      )), '-', '')
      || '_' || left(p_operation_key, 24);
    IF v_expected_action_id IS NULL
       OR jsonb_typeof(v_value -> 'id') <> 'string'
       OR v_value ->> 'id' <> v_expected_action_id
       OR jsonb_typeof(v_value -> 'title') <> 'string'
       OR char_length(v_value ->> 'title') NOT BETWEEN 1 AND 120
       OR jsonb_typeof(v_value -> 'description') NOT IN ('null', 'string')
       OR char_length(COALESCE(v_value ->> 'description', '')) > 500
       OR jsonb_typeof(v_value -> 'dueDate') NOT IN ('null', 'string')
       OR char_length(COALESCE(v_value ->> 'dueDate', '')) > 40
       OR jsonb_typeof(v_value -> 'categoryKey') NOT IN ('null', 'string')
       OR (
         jsonb_typeof(v_value -> 'categoryKey') = 'string'
         AND v_value ->> 'categoryKey' NOT IN (
           'meeting', 'venue', 'studio', 'dress', 'makeup', 'ring',
           'hanbok', 'yedan', 'honeymoon', 'houseware', 'housing',
           'invitation', 'snap', 'shoes', 'bouquet', 'gift', 'mc',
           'ham', 'pyebaek'
         )
       )
       OR v_value ->> 'priority' NOT IN ('high', 'medium', 'low')
       OR v_value ->> 'status' <> 'open'
       OR v_value ->> 'source' NOT IN (
         'chat', 'quote', 'schedule', 'budget', 'guardrail', 'manual'
       )
       OR jsonb_typeof(v_value -> 'href') <> 'string'
       OR left(v_value ->> 'href', 1) <> '/'
       OR char_length(v_value ->> 'href') > 180 THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_ACTION_INSERT_INVALID'
        USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(p_tool_input -> 'title') <> 'string'
       OR char_length(regexp_replace(
         btrim(p_tool_input ->> 'title'), '[[:space:]]+', ' ', 'g'
       )) NOT BETWEEN 1 AND 120
       OR left(regexp_replace(
         btrim(p_tool_input ->> 'title'), '[[:space:]]+', ' ', 'g'
       ), 120) <> v_value ->> 'title'
       OR (
         p_tool_input ? 'description'
         AND (
           jsonb_typeof(p_tool_input -> 'description') <> 'string'
           OR char_length(regexp_replace(
             btrim(p_tool_input ->> 'description'), '[[:space:]]+', ' ', 'g'
           )) > 500
           OR NULLIF(left(regexp_replace(
             btrim(p_tool_input ->> 'description'), '[[:space:]]+', ' ', 'g'
           ), 500), '') IS DISTINCT FROM v_value ->> 'description'
         )
       )
       OR (
         NOT (p_tool_input ? 'description')
         AND jsonb_typeof(v_value -> 'description') <> 'null'
       )
       OR (
         p_tool_input ? 'category_key'
         AND (
           jsonb_typeof(p_tool_input -> 'category_key') <> 'string'
           OR NULLIF(p_tool_input ->> 'category_key', 'general')
              IS DISTINCT FROM v_value ->> 'categoryKey'
         )
       )
       OR (
         NOT (p_tool_input ? 'category_key')
         AND jsonb_typeof(v_value -> 'categoryKey') <> 'null'
       )
       OR COALESCE(p_tool_input ->> 'priority', 'medium')
          <> v_value ->> 'priority'
       OR COALESCE(p_tool_input ->> 'source', 'chat')
          <> v_value ->> 'source' THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_ACTION_INSERT_INPUT_MISMATCH'
        USING ERRCODE = '22023';
    END IF;
    IF p_tool_input ? 'due_date' THEN
      IF jsonb_typeof(p_tool_input -> 'due_date') <> 'string'
         OR p_tool_input ->> 'due_date' <> v_value ->> 'dueDate' THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_ACTION_DUE_DATE_INVALID'
          USING ERRCODE = '22023';
      END IF;
      BEGIN
        v_event_date := (v_value ->> 'dueDate')::date;
        IF to_char(v_event_date, 'YYYY-MM-DD') <> v_value ->> 'dueDate' THEN
          RAISE EXCEPTION 'invalid date';
        END IF;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_ACTION_DUE_DATE_INVALID'
          USING ERRCODE = '22023';
      END;
    ELSIF jsonb_typeof(v_value -> 'dueDate') <> 'null' THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_ACTION_DUE_DATE_INVALID'
        USING ERRCODE = '22023';
    END IF;
    IF p_tool_input ? 'href' THEN
      IF jsonb_typeof(p_tool_input -> 'href') <> 'string'
         OR p_tool_input ->> 'href' <> v_value ->> 'href' THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_ACTION_HREF_INVALID'
          USING ERRCODE = '22023';
      END IF;
    ELSE
      v_normalized := CASE
        WHEN v_value ->> 'source' = 'quote' THEN '/wedding/community/quote-check'
        WHEN v_value ->> 'source' = 'budget' THEN '/wedding/budget'
        WHEN v_value ->> 'source' = 'schedule'
          OR v_value ->> 'categoryKey' = 'invitation' THEN '/wedding/schedule'
        WHEN v_value ->> 'categoryKey' IN ('mc', 'gift') THEN '/wedding/etiquette'
        ELSE '/wedding/lounge'
      END;
      IF v_value ->> 'href' <> v_normalized THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_ACTION_HREF_INVALID'
          USING ERRCODE = '22023';
      END IF;
    END IF;

    INSERT INTO public.amora_actions (
      id, couple_id, title, description, due_date, category_key,
      priority, status, source, href, metadata, created_by
    ) VALUES (
      v_value ->> 'id', p_couple_id, v_value ->> 'title',
      v_value ->> 'description', v_value ->> 'dueDate',
      v_value ->> 'categoryKey', v_value ->> 'priority', 'open',
      v_value ->> 'source', v_value ->> 'href', '{}'::jsonb, NULL
    ) RETURNING * INTO v_action;
    v_action_json := jsonb_strip_nulls(jsonb_build_object(
      'id', v_action.id,
      'title', v_action.title,
      'description', v_action.description,
      'dueDate', v_action.due_date,
      'categoryKey', v_action.category_key,
      'priority', v_action.priority,
      'status', v_action.status,
      'source', v_action.source,
      'href', v_action.href,
      'createdAt', v_action.created_at,
      'updatedAt', v_action.updated_at,
      'completedAt', v_action.completed_at
    ));
    v_effective_result := jsonb_set(
      p_result,
      ARRAY['toolOutput'],
      jsonb_build_object('action', v_action_json)
    );

  ELSIF v_kind = 'amora_action_update' THEN
    v_key := p_domain_mutation ->> 'actionId';
    v_value := p_domain_mutation -> 'updates';
    IF v_execution.tool_name <> 'update_amora_action'
       OR p_domain_mutation - ARRAY['kind', 'actionId', 'updates'] <> '{}'::jsonb
       OR jsonb_typeof(p_domain_mutation -> 'actionId') <> 'string'
       OR jsonb_typeof(v_value) <> 'object'
       OR v_value = '{}'::jsonb
       OR v_value - ARRAY[
         'title', 'description', 'dueDate', 'priority', 'status', 'href'
       ] <> '{}'::jsonb
       OR p_tool_input - ARRAY[
         'action_id', 'title', 'description', 'due_date',
         'priority', 'status', 'href'
       ] <> '{}'::jsonb
       OR NOT (p_tool_input ? 'action_id')
       OR p_tool_input ->> 'action_id' <> v_key
       OR v_key !~ '^[0-9A-Za-z_-]{1,200}$'
       OR p_result ->> 'success' <> 'true'
       OR NOT ((p_result -> 'toolOutput') ?& ARRAY['action_id', 'updates'])
       OR (p_result -> 'toolOutput') - ARRAY['action_id', 'updates'] <> '{}'::jsonb
       OR p_result -> 'toolOutput' ->> 'action_id' <> v_key
       OR p_result -> 'toolOutput' -> 'updates' IS DISTINCT FROM v_value THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_ACTION_UPDATE_INVALID'
        USING ERRCODE = '22023';
    END IF;
    IF v_value ? 'title' THEN
      IF jsonb_typeof(v_value -> 'title') <> 'string'
         OR char_length(v_value ->> 'title') NOT BETWEEN 1 AND 120
         OR jsonb_typeof(p_tool_input -> 'title') <> 'string'
         OR char_length(regexp_replace(
           btrim(p_tool_input ->> 'title'), '[[:space:]]+', ' ', 'g'
         )) NOT BETWEEN 1 AND 120
         OR left(regexp_replace(
           btrim(p_tool_input ->> 'title'), '[[:space:]]+', ' ', 'g'
         ), 120) <> v_value ->> 'title' THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_ACTION_UPDATE_TITLE_INVALID'
          USING ERRCODE = '22023';
      END IF;
    END IF;
    IF v_value ? 'description' THEN
      IF jsonb_typeof(v_value -> 'description') NOT IN ('null', 'string')
         OR char_length(COALESCE(v_value ->> 'description', '')) > 500
         OR jsonb_typeof(p_tool_input -> 'description') <> 'string'
         OR char_length(regexp_replace(
           btrim(p_tool_input ->> 'description'), '[[:space:]]+', ' ', 'g'
         )) > 500
         OR NULLIF(left(regexp_replace(
           btrim(p_tool_input ->> 'description'), '[[:space:]]+', ' ', 'g'
         ), 500), '') IS DISTINCT FROM v_value ->> 'description' THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_ACTION_UPDATE_DESCRIPTION_INVALID'
          USING ERRCODE = '22023';
      END IF;
    END IF;
    IF v_value ? 'dueDate' THEN
      IF jsonb_typeof(v_value -> 'dueDate') NOT IN ('null', 'string')
         OR jsonb_typeof(p_tool_input -> 'due_date') <> 'string'
         OR NULLIF(regexp_replace(
           btrim(p_tool_input ->> 'due_date'), '[[:space:]]+', ' ', 'g'
         ), '') IS DISTINCT FROM v_value ->> 'dueDate' THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_ACTION_UPDATE_DUE_DATE_INVALID'
          USING ERRCODE = '22023';
      END IF;
      IF jsonb_typeof(v_value -> 'dueDate') = 'string' THEN
        BEGIN
          v_event_date := (v_value ->> 'dueDate')::date;
          IF to_char(v_event_date, 'YYYY-MM-DD') <> v_value ->> 'dueDate' THEN
            RAISE EXCEPTION 'invalid date';
          END IF;
        EXCEPTION WHEN OTHERS THEN
          RAISE EXCEPTION 'AMORA_ATOMIC_ACTION_UPDATE_DUE_DATE_INVALID'
            USING ERRCODE = '22023';
        END;
      END IF;
    END IF;
    IF v_value ? 'priority' AND (
      v_value ->> 'priority' NOT IN ('high', 'medium', 'low')
      OR p_tool_input -> 'priority' <> v_value -> 'priority'
    ) THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_ACTION_UPDATE_PRIORITY_INVALID'
        USING ERRCODE = '22023';
    END IF;
    IF v_value ? 'status' AND (
      v_value ->> 'status' NOT IN ('open', 'done', 'dismissed')
      OR p_tool_input -> 'status' <> v_value -> 'status'
    ) THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_ACTION_UPDATE_STATUS_INVALID'
        USING ERRCODE = '22023';
    END IF;
    IF v_value ? 'href' THEN
      IF jsonb_typeof(v_value -> 'href') NOT IN ('null', 'string')
         OR char_length(COALESCE(v_value ->> 'href', '')) > 180
         OR (
           jsonb_typeof(v_value -> 'href') = 'string'
           AND left(v_value ->> 'href', 1) <> '/'
         )
         OR jsonb_typeof(p_tool_input -> 'href') <> 'string'
         OR NULLIF(p_tool_input ->> 'href', '') IS DISTINCT FROM v_value ->> 'href' THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_ACTION_UPDATE_HREF_INVALID'
          USING ERRCODE = '22023';
      END IF;
    END IF;
    -- Every requested update must have a matching source input and vice versa.
    IF (p_tool_input ? 'title') IS DISTINCT FROM (v_value ? 'title')
       OR (p_tool_input ? 'description') IS DISTINCT FROM (v_value ? 'description')
       OR (p_tool_input ? 'due_date') IS DISTINCT FROM (v_value ? 'dueDate')
       OR (p_tool_input ? 'priority') IS DISTINCT FROM (v_value ? 'priority')
       OR (p_tool_input ? 'status') IS DISTINCT FROM (v_value ? 'status')
       OR (p_tool_input ? 'href') IS DISTINCT FROM (v_value ? 'href') THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_ACTION_UPDATE_INPUT_MISMATCH'
        USING ERRCODE = '22023';
    END IF;

    SELECT action.* INTO v_action
    FROM public.amora_actions AS action
    WHERE action.couple_id = p_couple_id AND action.id = v_key
    FOR UPDATE;
    IF NOT FOUND THEN
      v_effective_result := jsonb_build_object(
        'toolName', v_execution.tool_name,
        'toolOutput', jsonb_build_object(
          'error', 'action_not_found', 'action_id', v_key, 'retryable', false
        ),
        'success', false,
        'displayMessage', '변경할 아모라 행동 카드를 찾지 못했어요.'
      );
    ELSE
      v_changed :=
        (v_value ? 'title' AND v_action.title IS DISTINCT FROM v_value ->> 'title')
        OR (v_value ? 'description' AND v_action.description IS DISTINCT FROM v_value ->> 'description')
        OR (v_value ? 'dueDate' AND v_action.due_date IS DISTINCT FROM v_value ->> 'dueDate')
        OR (v_value ? 'priority' AND v_action.priority IS DISTINCT FROM v_value ->> 'priority')
        OR (v_value ? 'status' AND v_action.status IS DISTINCT FROM v_value ->> 'status')
        OR (v_value ? 'href' AND v_action.href IS DISTINCT FROM v_value ->> 'href');
      IF NOT v_changed THEN
        v_effective_result := jsonb_build_object(
          'toolName', v_execution.tool_name,
          'toolOutput', jsonb_build_object('error', 'no_change', 'retryable', false),
          'success', false,
          'displayMessage', '이미 같은 행동 카드 내용으로 저장되어 있어요.'
        );
      ELSE
        UPDATE public.amora_actions
        SET title = CASE WHEN v_value ? 'title' THEN v_value ->> 'title' ELSE title END,
            description = CASE WHEN v_value ? 'description' THEN v_value ->> 'description' ELSE description END,
            due_date = CASE WHEN v_value ? 'dueDate' THEN v_value ->> 'dueDate' ELSE due_date END,
            priority = CASE WHEN v_value ? 'priority' THEN v_value ->> 'priority' ELSE priority END,
            status = CASE WHEN v_value ? 'status' THEN v_value ->> 'status' ELSE status END,
            href = CASE WHEN v_value ? 'href' THEN v_value ->> 'href' ELSE href END
        WHERE couple_id = p_couple_id AND id = v_key
        RETURNING * INTO v_action;
        v_action_json := jsonb_strip_nulls(jsonb_build_object(
          'id', v_action.id,
          'title', v_action.title,
          'description', v_action.description,
          'dueDate', v_action.due_date,
          'categoryKey', v_action.category_key,
          'priority', v_action.priority,
          'status', v_action.status,
          'source', v_action.source,
          'href', v_action.href,
          'createdAt', v_action.created_at,
          'updatedAt', v_action.updated_at,
          'completedAt', v_action.completed_at
        ));
        v_effective_result := jsonb_set(
          p_result,
          ARRAY['toolOutput'],
          jsonb_build_object('action', v_action_json)
        );
      END IF;
    END IF;
  ELSE
    RAISE EXCEPTION 'AMORA_ATOMIC_TOOL_MUTATION_KIND_UNSUPPORTED'
      USING ERRCODE = '22023';
  END IF;

  IF v_stale THEN
    v_effective_result := jsonb_build_object(
      'toolName', v_execution.tool_name,
      'toolOutput', jsonb_build_object(
        'error', 'domain_state_changed', 'retryable', false
      ),
      'success', false,
      'displayMessage',
        '다른 변경이 먼저 반영되어 이번 요청은 적용하지 않았어요. 최신 상태를 다시 확인해 주세요.'
    );
  END IF;

  UPDATE public.amora_tool_executions
  SET status = 'completed',
      result = v_effective_result,
      completed_at = now(),
      uncertain_at = NULL,
      failure_code = NULL,
      updated_at = now()
  WHERE couple_id = p_couple_id
    AND request_key = p_request_key
    AND operation_key = p_operation_key
    AND status = 'processing';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'AMORA_ATOMIC_TOOL_COMPLETION_RACE'
      USING ERRCODE = '40001';
  END IF;
  RETURN v_effective_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_amora_atomic_tool_execution(
  uuid, text, text, integer, text, jsonb, jsonb, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_amora_atomic_tool_execution(
  uuid, text, text, integer, text, jsonb, jsonb, jsonb
) TO service_role;

COMMENT ON FUNCTION public.apply_amora_atomic_tool_execution(
  uuid, text, text, integer, text, jsonb, jsonb, jsonb
) IS 'Crash-safe Amora mutation dispatcher: validates input/result correspondence and commits one domain mutation with its durable execution result.';

COMMENT ON FUNCTION public.apply_amora_atomic_tool_execution_v1(
  uuid, text, text, integer, text, jsonb, jsonb, jsonb
) IS 'Private 1100 implementation used only by the current atomic dispatcher for audited total-budget and schedule mutations.';

DO $postchecks$
BEGIN
  IF to_regprocedure(
       'public.apply_amora_atomic_tool_execution(uuid,text,text,integer,text,jsonb,jsonb,jsonb)'
     ) IS NULL
     OR to_regprocedure(
       'public.apply_amora_atomic_tool_execution_v1(uuid,text,text,integer,text,jsonb,jsonb,jsonb)'
     ) IS NULL
     OR has_function_privilege(
       'authenticated',
       'public.apply_amora_atomic_tool_execution(uuid,text,text,integer,text,jsonb,jsonb,jsonb)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.apply_amora_atomic_tool_execution_v1(uuid,text,text,integer,text,jsonb,jsonb,jsonb)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.apply_amora_atomic_tool_execution(uuid,text,text,integer,text,jsonb,jsonb,jsonb)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'AMORA_ATOMIC_MUTATION_COVERAGE_POSTCHECK_FAILED';
  END IF;
END;
$postchecks$;

COMMIT;
