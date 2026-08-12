BEGIN;

-- The atomic dispatcher predates checklist v3. Keep its audited execution,
-- request-lock, idempotency and CAS body intact, and replace only the nested
-- checklist-item validator used by the two checklist mutation tools.
CREATE OR REPLACE FUNCTION public.amora_atomic_checklist_v3_item_is_valid(
  p_item jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_state text;
  v_date date;
  v_timestamp timestamptz;
  v_assignee jsonb;
BEGIN
  IF jsonb_typeof(p_item) IS DISTINCT FROM 'object'
     OR p_item - ARRAY[
       'id', 'label', 'done', 'state', 'assignee', 'dueDate', 'note',
       'completedAt', 'completedByProfileId'
     ]::text[] <> '{}'::jsonb
     OR NOT (p_item ?& ARRAY['id', 'label', 'done', 'state'])
     OR jsonb_typeof(p_item -> 'id') IS DISTINCT FROM 'string'
     OR p_item ->> 'id' !~ '^[A-Za-z0-9_.:-]{1,120}$'
     OR jsonb_typeof(p_item -> 'label') IS DISTINCT FROM 'string'
     OR char_length(p_item ->> 'label') NOT BETWEEN 1 AND 400
     OR btrim(p_item ->> 'label') = ''
     OR (p_item ->> 'label') ~ '[[:cntrl:]]'
     OR jsonb_typeof(p_item -> 'done') IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(p_item -> 'state') IS DISTINCT FROM 'string' THEN
    RETURN false;
  END IF;

  v_state := p_item ->> 'state';
  IF v_state NOT IN (
       'todo', 'in_progress', 'waiting', 'blocked',
       'completed', 'not_applicable'
     )
     OR (p_item ->> 'done')::boolean IS DISTINCT FROM
       (v_state = 'completed') THEN
    RETURN false;
  END IF;

  IF p_item ? 'assignee' THEN
    v_assignee := p_item -> 'assignee';
    IF v_assignee <> 'null'::jsonb THEN
      IF jsonb_typeof(v_assignee) IS DISTINCT FROM 'object'
         OR jsonb_typeof(v_assignee -> 'kind') IS DISTINCT FROM 'string' THEN
        RETURN false;
      END IF;
      IF v_assignee ->> 'kind' = 'couple' THEN
        IF v_assignee - 'kind' <> '{}'::jsonb THEN RETURN false; END IF;
      ELSIF v_assignee ->> 'kind' = 'member' THEN
        IF v_assignee - ARRAY['kind', 'profileId']::text[] <> '{}'::jsonb
           OR jsonb_typeof(v_assignee -> 'profileId') IS DISTINCT FROM 'string'
           OR v_assignee ->> 'profileId' !~
             '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
          RETURN false;
        END IF;
      ELSIF v_assignee ->> 'kind' = 'external' THEN
        IF v_assignee - ARRAY['kind', 'label']::text[] <> '{}'::jsonb
           OR jsonb_typeof(v_assignee -> 'label') IS DISTINCT FROM 'string'
           OR char_length(v_assignee ->> 'label') NOT BETWEEN 1 AND 80
           OR btrim(v_assignee ->> 'label') = ''
           OR (v_assignee ->> 'label') ~ '[[:cntrl:]]' THEN
          RETURN false;
        END IF;
      ELSE
        RETURN false;
      END IF;
    END IF;
  END IF;

  IF p_item ? 'dueDate' AND p_item -> 'dueDate' <> 'null'::jsonb THEN
    IF jsonb_typeof(p_item -> 'dueDate') IS DISTINCT FROM 'string'
       OR p_item ->> 'dueDate' !~ '^\d{4}-\d{2}-\d{2}$' THEN
      RETURN false;
    END IF;
    BEGIN
      v_date := (p_item ->> 'dueDate')::date;
    EXCEPTION WHEN OTHERS THEN
      RETURN false;
    END;
    IF to_char(v_date, 'YYYY-MM-DD') <> p_item ->> 'dueDate'
       OR left(p_item ->> 'dueDate', 4) = '0000' THEN
      RETURN false;
    END IF;
  END IF;

  IF p_item ? 'note'
     AND (
       jsonb_typeof(p_item -> 'note') IS DISTINCT FROM 'string'
       OR char_length(p_item ->> 'note') > 1000
       OR (p_item ->> 'note') ~ '[[:cntrl:]]'
     ) THEN
    RETURN false;
  END IF;

  IF (p_item ? 'completedAt' AND p_item -> 'completedAt' <> 'null'::jsonb)
     OR (p_item ? 'completedByProfileId'
       AND p_item -> 'completedByProfileId' <> 'null'::jsonb) THEN
    IF jsonb_typeof(p_item -> 'completedAt') IS DISTINCT FROM 'string'
       OR p_item ->> 'completedAt' !~
         '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
       OR jsonb_typeof(p_item -> 'completedByProfileId')
         IS DISTINCT FROM 'string'
       OR p_item ->> 'completedByProfileId' !~
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR v_state <> 'completed' THEN
      RETURN false;
    END IF;
    BEGIN
      v_timestamp := (p_item ->> 'completedAt')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      RETURN false;
    END;
  ELSIF NULLIF(p_item -> 'completedAt', 'null'::jsonb) IS NOT NULL
     OR NULLIF(p_item -> 'completedByProfileId', 'null'::jsonb) IS NOT NULL THEN
    RETURN false;
  END IF;

  IF (NULLIF(p_item -> 'completedAt', 'null'::jsonb) IS NULL)
       IS DISTINCT FROM
     (NULLIF(p_item -> 'completedByProfileId', 'null'::jsonb) IS NULL) THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.amora_atomic_validate_checklist_v3_toggle(
  p_expected jsonb,
  p_value jsonb,
  p_tool_input jsonb,
  p_result jsonb,
  p_actor_profile_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_item jsonb;
  v_old_item jsonb;
  v_target_id text := p_tool_input ->> 'item_id';
  v_target_count integer := 0;
  v_item_count integer := 0;
  v_distinct_count integer := 0;
  v_applicable_count integer := 0;
  v_completed_count integer := 0;
  v_todo_count integer := 0;
  v_expected_status text;
  v_done boolean := (p_tool_input ->> 'done')::boolean;
  v_old_state text;
  v_old_position integer;
  v_last_old_position integer := 0;
  v_old_found boolean;
BEGIN
  IF p_actor_profile_id IS NULL THEN
    RAISE EXCEPTION 'AMORA_ATOMIC_CHECKLIST_ACTOR_INVALID'
      USING ERRCODE = '22023';
  END IF;
  IF p_expected ? 'checklist'
     AND jsonb_typeof(p_expected -> 'checklist') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'AMORA_ATOMIC_CHECKLIST_EXPECTED_INVALID'
      USING ERRCODE = '22023';
  END IF;

  FOR v_item IN
    SELECT item.value
    FROM jsonb_array_elements(p_value -> 'checklist') AS item(value)
  LOOP
    IF NOT public.amora_atomic_checklist_v3_item_is_valid(v_item) THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_CHECKLIST_ITEM_INVALID'
        USING ERRCODE = '22023';
    END IF;
    v_item_count := v_item_count + 1;
    IF v_item ->> 'state' <> 'not_applicable' THEN
      v_applicable_count := v_applicable_count + 1;
      IF v_item ->> 'state' = 'completed' THEN
        v_completed_count := v_completed_count + 1;
      ELSIF v_item ->> 'state' = 'todo' THEN
        v_todo_count := v_todo_count + 1;
      END IF;
    END IF;

    SELECT old_item.value, old_item.position::integer
      INTO v_old_item, v_old_position
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(p_expected -> 'checklist') = 'array'
        THEN p_expected -> 'checklist' ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS old_item(value, position)
    WHERE old_item.value ->> 'id' = v_item ->> 'id'
    LIMIT 1;
    v_old_found := FOUND;
    IF v_old_found THEN
      IF v_old_position <= v_last_old_position THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_CHECKLIST_ORDER_CHANGED'
          USING ERRCODE = '22023';
      END IF;
      v_last_old_position := v_old_position;
      v_old_state := CASE
        WHEN v_old_item ->> 'state' IN (
          'todo', 'in_progress', 'waiting', 'blocked',
          'completed', 'not_applicable'
        ) THEN v_old_item ->> 'state'
        WHEN jsonb_typeof(v_old_item -> 'done') = 'boolean'
          AND (v_old_item ->> 'done')::boolean THEN 'completed'
        WHEN jsonb_typeof(v_old_item -> 'completed') = 'boolean'
          AND (v_old_item ->> 'completed')::boolean THEN 'completed'
        ELSE 'todo'
      END;
    ELSE
      v_old_state := NULL;
    END IF;

    IF v_item ->> 'id' = v_target_id THEN
      v_target_count := v_target_count + 1;
      IF (v_item ->> 'done')::boolean IS DISTINCT FROM v_done
         OR v_item ->> 'label' IS DISTINCT FROM
           p_result -> 'toolOutput' ->> 'item_label'
         OR (v_done AND (
           v_item ->> 'state' <> 'completed'
           OR v_item ->> 'completedByProfileId'
             IS DISTINCT FROM p_actor_profile_id::text
           OR NULLIF(v_item ->> 'completedAt', '') IS NULL
         ))
         OR (NOT v_done AND (
           v_item ->> 'state' <> 'todo'
           OR NULLIF(v_item -> 'completedAt', 'null'::jsonb) IS NOT NULL
           OR NULLIF(v_item -> 'completedByProfileId', 'null'::jsonb) IS NOT NULL
         )) THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_CHECKLIST_TARGET_INVALID'
          USING ERRCODE = '22023';
      END IF;
      IF v_old_found
         AND (
           v_item ->> 'label' IS DISTINCT FROM v_old_item ->> 'label'
           OR (v_done AND v_old_state = 'completed')
           OR (NOT v_done AND v_old_state <> 'completed')
           OR (
             NOT v_done
             AND NULLIF(v_old_item ->> 'completedByProfileId', '') IS NOT NULL
             AND v_old_item ->> 'completedByProfileId'
               IS DISTINCT FROM p_actor_profile_id::text
           )
         ) THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_CHECKLIST_TARGET_TRANSITION_INVALID'
          USING ERRCODE = '22023';
      END IF;
    END IF;

    IF v_old_found THEN
      IF NULLIF(v_item -> 'assignee', 'null'::jsonb) IS DISTINCT FROM
           NULLIF(v_old_item -> 'assignee', 'null'::jsonb)
         OR NULLIF(v_item -> 'dueDate', 'null'::jsonb) IS DISTINCT FROM
           NULLIF(v_old_item -> 'dueDate', 'null'::jsonb)
         OR COALESCE(v_item ->> 'note', '') IS DISTINCT FROM
           COALESCE(v_old_item ->> 'note', '') THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_CHECKLIST_METADATA_CHANGED'
          USING ERRCODE = '22023';
      END IF;
      IF v_item ->> 'id' <> v_target_id
         AND (
           v_item ->> 'state' IS DISTINCT FROM v_old_state
           OR NULLIF(v_item -> 'completedAt', 'null'::jsonb)
             IS DISTINCT FROM NULLIF(v_old_item -> 'completedAt', 'null'::jsonb)
           OR NULLIF(v_item -> 'completedByProfileId', 'null'::jsonb)
             IS DISTINCT FROM NULLIF(
               v_old_item -> 'completedByProfileId', 'null'::jsonb
             )
         ) THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_CHECKLIST_NON_TARGET_CHANGED'
          USING ERRCODE = '22023';
      END IF;
    ELSIF v_item ->> 'id' <> v_target_id
       AND (
         v_item ->> 'state' <> 'todo'
         OR v_item ? 'assignee'
         OR NULLIF(v_item -> 'dueDate', 'null'::jsonb) IS NOT NULL
         OR COALESCE(v_item ->> 'note', '') <> ''
         OR NULLIF(v_item -> 'completedAt', 'null'::jsonb) IS NOT NULL
         OR NULLIF(v_item -> 'completedByProfileId', 'null'::jsonb) IS NOT NULL
       ) THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_CHECKLIST_NEW_ITEM_INVALID'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  SELECT count(DISTINCT item.value ->> 'id')::integer
    INTO v_distinct_count
  FROM jsonb_array_elements(p_value -> 'checklist') AS item(value);
  IF v_item_count <> v_distinct_count OR v_target_count <> 1 THEN
    RAISE EXCEPTION 'AMORA_ATOMIC_CHECKLIST_ID_INVALID'
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(p_expected -> 'checklist') = 'array'
        THEN p_expected -> 'checklist' ELSE '[]'::jsonb END
    ) AS old_item(value)
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_value -> 'checklist') AS new_item(value)
      WHERE new_item.value ->> 'id' = old_item.value ->> 'id'
    )
  ) THEN
    RAISE EXCEPTION 'AMORA_ATOMIC_CHECKLIST_ITEM_REMOVED'
      USING ERRCODE = '22023';
  END IF;

  v_expected_status := CASE
    WHEN v_applicable_count = 0 THEN 'not_applicable'
    WHEN v_completed_count = v_applicable_count THEN 'completed'
    WHEN v_todo_count = v_applicable_count THEN 'not_started'
    ELSE 'in_progress'
  END;
  IF p_value ->> 'status' IS DISTINCT FROM v_expected_status THEN
    RAISE EXCEPTION 'AMORA_ATOMIC_CHECKLIST_STATUS_INVALID'
      USING ERRCODE = '22023';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.amora_atomic_validate_checklist_v3_status(
  p_expected jsonb,
  p_value jsonb,
  p_tool_input jsonb,
  p_result jsonb,
  p_actor_profile_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_item jsonb;
  v_old_item jsonb;
  v_old_state text;
  v_new_state text;
  v_requested_status text := p_tool_input ->> 'status';
  v_old_found boolean;
  v_old_position integer;
  v_last_old_position integer := 0;
  v_had_progress boolean := false;
  v_promoted_count integer := 0;
  v_item_count integer := 0;
  v_distinct_count integer := 0;
  v_applicable_count integer := 0;
  v_completed_count integer := 0;
  v_todo_count integer := 0;
  v_derived_status text;
BEGIN
  -- Preserve already-issued v2 status executions that predate item-level
  -- materialization. New operations always carry a checklist and take the v3
  -- path below.
  IF NOT (p_value ? 'checklist') AND NOT (p_expected ? 'checklist') THEN
    IF p_actor_profile_id IS NULL
       OR p_tool_input - ARRAY['category', 'status']::text[] <> '{}'::jsonb
       OR NOT (p_tool_input ?& ARRAY['category', 'status'])
       OR jsonb_typeof(p_tool_input -> 'category') IS DISTINCT FROM 'string'
       OR jsonb_typeof(p_tool_input -> 'status') IS DISTINCT FROM 'string'
       OR p_tool_input ->> 'category' NOT IN (
         'foundation', 'contracts', 'meeting', 'venue', 'studio',
         'dress', 'makeup', 'ring', 'hanbok', 'yedan', 'honeymoon',
         'houseware', 'housing', 'invitation', 'snap', 'shoes',
         'bouquet', 'gift', 'mc', 'ham', 'pyebaek', 'guests',
         'ceremony', 'home_admin', 'health_admin', 'aftercare',
         'special_cases'
       )
       OR v_requested_status NOT IN ('not_started', 'in_progress', 'completed')
       OR p_value ->> 'category' IS DISTINCT FROM p_tool_input ->> 'category'
       OR p_value ->> 'status' IS DISTINCT FROM v_requested_status
       OR p_value - ARRAY['category', 'status']::text[]
         IS DISTINCT FROM p_expected - ARRAY['category', 'status']::text[]
       OR (p_result -> 'toolOutput') - ARRAY[
         'category', 'status', 'progress_key', 'progress_value'
       ]::text[] <> '{}'::jsonb
       OR NOT ((p_result -> 'toolOutput') ?& ARRAY[
         'category', 'status', 'progress_key', 'progress_value'
       ])
       OR p_result -> 'toolOutput' ->> 'category'
         IS DISTINCT FROM p_tool_input ->> 'category'
       OR p_result -> 'toolOutput' ->> 'status'
         IS DISTINCT FROM v_requested_status
       OR p_result -> 'toolOutput' -> 'progress_value'
         IS DISTINCT FROM p_value THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_TASK_STATUS_INVALID'
        USING ERRCODE = '22023';
    END IF;
    RETURN;
  END IF;

  IF p_actor_profile_id IS NULL
     OR p_tool_input - ARRAY['category', 'status']::text[] <> '{}'::jsonb
     OR NOT (p_tool_input ?& ARRAY['category', 'status'])
     OR jsonb_typeof(p_tool_input -> 'category') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_tool_input -> 'status') IS DISTINCT FROM 'string'
     OR p_tool_input ->> 'category' NOT IN (
       'foundation', 'contracts', 'meeting', 'venue', 'studio',
       'dress', 'makeup', 'ring', 'hanbok', 'yedan', 'honeymoon',
       'houseware', 'housing', 'invitation', 'snap', 'shoes',
       'bouquet', 'gift', 'mc', 'ham', 'pyebaek', 'guests',
       'ceremony', 'home_admin', 'health_admin', 'aftercare',
       'special_cases'
     )
     OR v_requested_status NOT IN ('not_started', 'in_progress', 'completed')
     OR NOT (p_value ?& ARRAY['category', 'status', 'checklist'])
     OR p_value ->> 'category' IS DISTINCT FROM p_tool_input ->> 'category'
     OR p_value ->> 'status' IS DISTINCT FROM v_requested_status
     OR jsonb_typeof(p_value -> 'checklist') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_value -> 'checklist') NOT BETWEEN 1 AND 100
     OR p_value - ARRAY['category', 'status', 'checklist']::text[]
       IS DISTINCT FROM
       p_expected - ARRAY['category', 'status', 'checklist']::text[]
     OR p_result ->> 'success' IS DISTINCT FROM 'true'
     OR (p_result -> 'toolOutput') - ARRAY[
       'category', 'status', 'progress_key', 'progress_value'
     ]::text[] <> '{}'::jsonb
     OR NOT ((p_result -> 'toolOutput') ?& ARRAY[
       'category', 'status', 'progress_key', 'progress_value'
     ])
     OR p_result -> 'toolOutput' ->> 'category'
       IS DISTINCT FROM p_tool_input ->> 'category'
     OR p_result -> 'toolOutput' ->> 'status'
       IS DISTINCT FROM v_requested_status
     OR p_result -> 'toolOutput' -> 'progress_value'
       IS DISTINCT FROM p_value THEN
    RAISE EXCEPTION 'AMORA_ATOMIC_TASK_STATUS_INVALID'
      USING ERRCODE = '22023';
  END IF;
  IF p_expected ? 'checklist'
     AND jsonb_typeof(p_expected -> 'checklist') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'AMORA_ATOMIC_TASK_STATUS_EXPECTED_INVALID'
      USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(p_expected -> 'checklist') = 'array'
        THEN p_expected -> 'checklist' ELSE '[]'::jsonb END
    ) AS old_item(value)
    WHERE CASE
      WHEN old_item.value ->> 'state' IN (
        'todo', 'in_progress', 'waiting', 'blocked',
        'completed', 'not_applicable'
      ) THEN old_item.value ->> 'state' NOT IN ('todo', 'not_applicable')
      ELSE jsonb_typeof(old_item.value -> 'done') = 'boolean'
        AND (old_item.value ->> 'done')::boolean
    END
  ) INTO v_had_progress;

  FOR v_item IN
    SELECT item.value
    FROM jsonb_array_elements(p_value -> 'checklist') AS item(value)
  LOOP
    IF NOT public.amora_atomic_checklist_v3_item_is_valid(v_item) THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_CHECKLIST_ITEM_INVALID'
        USING ERRCODE = '22023';
    END IF;
    v_item_count := v_item_count + 1;
    v_new_state := v_item ->> 'state';
    IF v_new_state <> 'not_applicable' THEN
      v_applicable_count := v_applicable_count + 1;
      IF v_new_state = 'completed' THEN
        v_completed_count := v_completed_count + 1;
      ELSIF v_new_state = 'todo' THEN
        v_todo_count := v_todo_count + 1;
      END IF;
    END IF;

    SELECT old_item.value, old_item.position::integer
      INTO v_old_item, v_old_position
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(p_expected -> 'checklist') = 'array'
        THEN p_expected -> 'checklist' ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS old_item(value, position)
    WHERE old_item.value ->> 'id' = v_item ->> 'id'
    LIMIT 1;
    v_old_found := FOUND;
    IF v_old_found THEN
      IF v_old_position <= v_last_old_position
         OR v_item ->> 'label' IS DISTINCT FROM v_old_item ->> 'label'
         OR NULLIF(v_item -> 'assignee', 'null'::jsonb) IS DISTINCT FROM
           NULLIF(v_old_item -> 'assignee', 'null'::jsonb)
         OR NULLIF(v_item -> 'dueDate', 'null'::jsonb) IS DISTINCT FROM
           NULLIF(v_old_item -> 'dueDate', 'null'::jsonb)
         OR COALESCE(v_item ->> 'note', '') IS DISTINCT FROM
           COALESCE(v_old_item ->> 'note', '') THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_TASK_STATUS_METADATA_CHANGED'
          USING ERRCODE = '22023';
      END IF;
      v_last_old_position := v_old_position;
      v_old_state := CASE
        WHEN v_old_item ->> 'state' IN (
          'todo', 'in_progress', 'waiting', 'blocked',
          'completed', 'not_applicable'
        ) THEN v_old_item ->> 'state'
        WHEN jsonb_typeof(v_old_item -> 'done') = 'boolean'
          AND (v_old_item ->> 'done')::boolean THEN 'completed'
        WHEN jsonb_typeof(v_old_item -> 'completed') = 'boolean'
          AND (v_old_item ->> 'completed')::boolean THEN 'completed'
        ELSE 'todo'
      END;
    ELSE
      v_old_state := NULL;
      IF v_item ? 'assignee'
         OR NULLIF(v_item -> 'dueDate', 'null'::jsonb) IS NOT NULL
         OR COALESCE(v_item ->> 'note', '') <> '' THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_TASK_STATUS_NEW_ITEM_INVALID'
          USING ERRCODE = '22023';
      END IF;
    END IF;

    IF v_old_state = 'not_applicable' THEN
      IF v_new_state <> 'not_applicable'
         OR NULLIF(v_item -> 'completedAt', 'null'::jsonb) IS NOT NULL
         OR NULLIF(v_item -> 'completedByProfileId', 'null'::jsonb) IS NOT NULL THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_TASK_STATUS_TRANSITION_INVALID'
          USING ERRCODE = '22023';
      END IF;
    ELSIF v_requested_status = 'completed' THEN
      IF v_new_state <> 'completed' THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_TASK_STATUS_TRANSITION_INVALID'
          USING ERRCODE = '22023';
      END IF;
      IF v_old_state = 'completed' THEN
        IF NULLIF(v_item -> 'completedAt', 'null'::jsonb) IS DISTINCT FROM
             NULLIF(v_old_item -> 'completedAt', 'null'::jsonb)
           OR NULLIF(v_item -> 'completedByProfileId', 'null'::jsonb)
             IS DISTINCT FROM NULLIF(
               v_old_item -> 'completedByProfileId', 'null'::jsonb
             ) THEN
          RAISE EXCEPTION 'AMORA_ATOMIC_TASK_STATUS_AUDIT_CHANGED'
            USING ERRCODE = '22023';
        END IF;
      ELSIF v_item ->> 'completedByProfileId'
          IS DISTINCT FROM p_actor_profile_id::text
         OR NULLIF(v_item ->> 'completedAt', '') IS NULL THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_TASK_STATUS_ACTOR_INVALID'
          USING ERRCODE = '22023';
      END IF;
    ELSIF v_requested_status = 'not_started' THEN
      IF v_new_state <> 'todo'
         OR NULLIF(v_item -> 'completedAt', 'null'::jsonb) IS NOT NULL
         OR NULLIF(v_item -> 'completedByProfileId', 'null'::jsonb) IS NOT NULL THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_TASK_STATUS_TRANSITION_INVALID'
          USING ERRCODE = '22023';
      END IF;
    ELSE
      IF v_had_progress THEN
        IF v_old_found AND v_new_state IS DISTINCT FROM v_old_state THEN
          RAISE EXCEPTION 'AMORA_ATOMIC_TASK_STATUS_TRANSITION_INVALID'
            USING ERRCODE = '22023';
        ELSIF NOT v_old_found AND v_new_state <> 'todo' THEN
          RAISE EXCEPTION 'AMORA_ATOMIC_TASK_STATUS_TRANSITION_INVALID'
            USING ERRCODE = '22023';
        END IF;
      ELSIF v_new_state = 'in_progress' THEN
        v_promoted_count := v_promoted_count + 1;
      ELSIF v_new_state <> 'todo' THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_TASK_STATUS_TRANSITION_INVALID'
          USING ERRCODE = '22023';
      END IF;
      IF v_old_found AND v_new_state = v_old_state
         AND (
           NULLIF(v_item -> 'completedAt', 'null'::jsonb) IS DISTINCT FROM
             NULLIF(v_old_item -> 'completedAt', 'null'::jsonb)
           OR NULLIF(v_item -> 'completedByProfileId', 'null'::jsonb)
             IS DISTINCT FROM NULLIF(
               v_old_item -> 'completedByProfileId', 'null'::jsonb
             )
         ) THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_TASK_STATUS_AUDIT_CHANGED'
          USING ERRCODE = '22023';
      END IF;
    END IF;
  END LOOP;

  SELECT count(DISTINCT item.value ->> 'id')::integer
    INTO v_distinct_count
  FROM jsonb_array_elements(p_value -> 'checklist') AS item(value);
  IF v_item_count <> v_distinct_count
     OR (v_requested_status = 'in_progress' AND NOT v_had_progress
       AND v_promoted_count <> 1)
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(
         CASE WHEN jsonb_typeof(p_expected -> 'checklist') = 'array'
           THEN p_expected -> 'checklist' ELSE '[]'::jsonb END
       ) AS old_item(value)
       WHERE NOT EXISTS (
         SELECT 1
         FROM jsonb_array_elements(p_value -> 'checklist') AS new_item(value)
         WHERE new_item.value ->> 'id' = old_item.value ->> 'id'
       )
     ) THEN
    RAISE EXCEPTION 'AMORA_ATOMIC_TASK_STATUS_ID_INVALID'
      USING ERRCODE = '22023';
  END IF;

  v_derived_status := CASE
    WHEN v_applicable_count = 0 THEN 'not_applicable'
    WHEN v_completed_count = v_applicable_count THEN 'completed'
    WHEN v_todo_count = v_applicable_count THEN 'not_started'
    ELSE 'in_progress'
  END;
  IF v_derived_status IS DISTINCT FROM v_requested_status THEN
    RAISE EXCEPTION 'AMORA_ATOMIC_TASK_STATUS_DERIVATION_INVALID'
      USING ERRCODE = '22023';
  END IF;
END;
$function$;

DO $block$
DECLARE
  v_target regprocedure;
  v_definition text;
  v_old text := $legacy$
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
      END IF;$legacy$;
  v_new text := $replacement$
      PERFORM public.amora_atomic_validate_checklist_v3_toggle(
        v_expected, v_value, p_tool_input, p_result, v_request.user_id
      );$replacement$;
  v_old_task text := $task$
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
      END IF;$task$;
  v_new_task text := $task$
      PERFORM public.amora_atomic_validate_checklist_v3_status(
        v_expected, v_value, p_tool_input, p_result, v_request.user_id
      );$task$;
  v_old_categories text := $categories$
           'meeting', 'venue', 'studio', 'dress', 'makeup', 'ring',
           'hanbok', 'yedan', 'honeymoon', 'houseware', 'housing',
           'invitation', 'snap', 'shoes', 'bouquet', 'gift', 'mc',
           'ham', 'pyebaek'
         )$categories$;
  v_new_categories text := $categories$
           'foundation', 'contracts', 'meeting', 'venue', 'studio',
           'dress', 'makeup', 'ring', 'hanbok', 'yedan', 'honeymoon',
           'houseware', 'housing', 'invitation', 'snap', 'shoes',
           'bouquet', 'gift', 'mc', 'ham', 'pyebaek', 'guests',
           'ceremony', 'home_admin', 'health_admin', 'aftercare',
           'special_cases'
         )$categories$;
BEGIN
  v_target := COALESCE(
    to_regprocedure(
      'public.apply_amora_atomic_tool_execution_pre_shared_revision(uuid,text,text,integer,text,jsonb,jsonb,jsonb)'
    ),
    to_regprocedure(
      'public.apply_amora_atomic_tool_execution(uuid,text,text,integer,text,jsonb,jsonb,jsonb)'
    )
  );
  IF v_target IS NULL THEN
    RAISE EXCEPTION 'AMORA_ATOMIC_CHECKLIST_DISPATCHER_MISSING';
  END IF;
  v_definition := pg_get_functiondef(v_target::oid);
  IF strpos(v_definition, v_old) > 0 THEN
    v_definition := replace(v_definition, v_old, v_new);
  ELSIF strpos(v_definition, 'amora_atomic_validate_checklist_v3_toggle') = 0 THEN
    RAISE EXCEPTION 'AMORA_ATOMIC_CHECKLIST_VALIDATOR_PATCH_MISMATCH';
  END IF;
  IF strpos(v_definition, v_old_task) > 0 THEN
    v_definition := replace(v_definition, v_old_task, v_new_task);
  ELSIF strpos(v_definition, 'amora_atomic_validate_checklist_v3_status') = 0 THEN
    RAISE EXCEPTION 'AMORA_ATOMIC_TASK_STATUS_VALIDATOR_PATCH_MISMATCH';
  END IF;
  v_definition := replace(v_definition, v_old_categories, v_new_categories);
  EXECUTE v_definition;
END;
$block$;

ALTER FUNCTION public.amora_atomic_checklist_v3_item_is_valid(jsonb)
  OWNER TO postgres;
ALTER FUNCTION public.amora_atomic_validate_checklist_v3_toggle(
  jsonb, jsonb, jsonb, jsonb, uuid
) OWNER TO postgres;
ALTER FUNCTION public.amora_atomic_validate_checklist_v3_status(
  jsonb, jsonb, jsonb, jsonb, uuid
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.amora_atomic_checklist_v3_item_is_valid(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.amora_atomic_validate_checklist_v3_toggle(
  jsonb, jsonb, jsonb, jsonb, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.amora_atomic_validate_checklist_v3_status(
  jsonb, jsonb, jsonb, jsonb, uuid
) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
