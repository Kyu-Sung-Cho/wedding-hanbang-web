BEGIN;

-- Extend the durable shared-action receipt with the exact schedule delta and
-- its matching decision node. The existing shared-action migration remains
-- the authority for consent, execution identity, lock order, and r -> r+1 CAS.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.amora_shared_action_journey_mutation_receipts
  ADD COLUMN IF NOT EXISTS mutation_kind text,
  ADD COLUMN IF NOT EXISTS schedule_scope text,
  ADD COLUMN IF NOT EXISTS schedule_event_id text,
  ADD COLUMN IF NOT EXISTS before_event jsonb,
  ADD COLUMN IF NOT EXISTS after_event jsonb,
  ADD COLUMN IF NOT EXISTS decision_node_id uuid,
  ADD COLUMN IF NOT EXISTS decision_recorded_at timestamptz;

DO $block$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'amora_shared_schedule_receipt_decision_node_fkey'
      AND conrelid =
        'public.amora_shared_action_journey_mutation_receipts'::regclass
  ) THEN
    ALTER TABLE public.amora_shared_action_journey_mutation_receipts
      ADD CONSTRAINT amora_shared_schedule_receipt_decision_node_fkey
      FOREIGN KEY (decision_node_id)
      REFERENCES public.decision_nodes(id)
      ON DELETE NO ACTION
      DEFERRABLE INITIALLY DEFERRED
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'amora_shared_schedule_receipt_delta_check'
      AND conrelid =
        'public.amora_shared_action_journey_mutation_receipts'::regclass
  ) THEN
    ALTER TABLE public.amora_shared_action_journey_mutation_receipts
      ADD CONSTRAINT amora_shared_schedule_receipt_delta_check
      CHECK (
        (
          mutation_kind IS NULL
          AND schedule_scope IS NULL
          AND schedule_event_id IS NULL
          AND before_event IS NULL
          AND after_event IS NULL
        )
        OR (
          mutation_kind = 'add'
          AND (
            schedule_scope IS NULL
            OR schedule_scope IN (
              'confirmed_fact',
              'shared_commitment',
              'external_commitment'
            )
          )
          AND schedule_event_id IS NOT NULL
          AND char_length(btrim(schedule_event_id)) BETWEEN 1 AND 200
          AND before_event IS NULL
          AND after_event IS NOT NULL
          AND jsonb_typeof(after_event) = 'object'
          AND jsonb_typeof(after_event -> 'id') = 'string'
          AND after_event ->> 'id' = schedule_event_id
        )
        OR (
          mutation_kind = 'update'
          AND (
            schedule_scope IS NULL
            OR schedule_scope IN (
              'confirmed_fact',
              'shared_commitment',
              'external_commitment'
            )
          )
          AND schedule_event_id IS NOT NULL
          AND char_length(btrim(schedule_event_id)) BETWEEN 1 AND 200
          AND before_event IS NOT NULL
          AND after_event IS NOT NULL
          AND jsonb_typeof(before_event) = 'object'
          AND jsonb_typeof(after_event) = 'object'
          AND jsonb_typeof(before_event -> 'id') = 'string'
          AND jsonb_typeof(after_event -> 'id') = 'string'
          AND before_event ->> 'id' = schedule_event_id
          AND after_event ->> 'id' = schedule_event_id
          AND before_event IS DISTINCT FROM after_event
        )
      )
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'amora_shared_schedule_receipt_decision_pair_check'
      AND conrelid =
        'public.amora_shared_action_journey_mutation_receipts'::regclass
  ) THEN
    ALTER TABLE public.amora_shared_action_journey_mutation_receipts
      ADD CONSTRAINT amora_shared_schedule_receipt_decision_pair_check
      CHECK (
        (
          mutation_kind IS NULL
          AND decision_node_id IS NULL
          AND decision_recorded_at IS NULL
        )
        OR (
          mutation_kind IS NOT NULL
          AND (
            (decision_node_id IS NULL AND decision_recorded_at IS NULL)
            OR
            (decision_node_id IS NOT NULL AND decision_recorded_at IS NOT NULL)
          )
        )
      )
      NOT VALID;
  END IF;
END
$block$;

ALTER TABLE public.amora_shared_action_journey_mutation_receipts
  VALIDATE CONSTRAINT amora_shared_schedule_receipt_decision_node_fkey;
ALTER TABLE public.amora_shared_action_journey_mutation_receipts
  VALIDATE CONSTRAINT amora_shared_schedule_receipt_delta_check;
ALTER TABLE public.amora_shared_action_journey_mutation_receipts
  VALIDATE CONSTRAINT amora_shared_schedule_receipt_decision_pair_check;

CREATE UNIQUE INDEX IF NOT EXISTS
  amora_shared_schedule_receipt_decision_node_unique
  ON public.amora_shared_action_journey_mutation_receipts(decision_node_id)
  WHERE decision_node_id IS NOT NULL;

COMMENT ON COLUMN
  public.amora_shared_action_journey_mutation_receipts.mutation_kind IS
  'Exact guarded schedule delta: add or update. NULL for non-schedule receipts.';
COMMENT ON COLUMN
  public.amora_shared_action_journey_mutation_receipts.schedule_scope IS
  'Approved schedule intent scope used by the separate shared-action policy.';
COMMENT ON COLUMN
  public.amora_shared_action_journey_mutation_receipts.before_event IS
  'Canonical event immediately before the guarded mutation; NULL for add.';
COMMENT ON COLUMN
  public.amora_shared_action_journey_mutation_receipts.after_event IS
  'Canonical event immediately after the guarded mutation.';
COMMENT ON COLUMN
  public.amora_shared_action_journey_mutation_receipts.decision_node_id IS
  'Decision node inserted in the same transaction as the schedule mutation.';

-- Trigger names are intentionally ordered. PostgreSQL runs triggers with the
-- same timing/event alphabetically, so this capture trigger runs after
-- trg_advance_wedding_journey_state_revision has authenticated the exact
-- shared action, advanced the revision, and inserted the base receipt.
CREATE OR REPLACE FUNCTION public.capture_amora_shared_schedule_delta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_guard_couple text := NULLIF(current_setting(
    'hanbang.amora_shared_action_couple_id', true
  ), '');
  v_guard_request text := NULLIF(current_setting(
    'hanbang.amora_shared_action_request_key', true
  ), '');
  v_guard_operation text := NULLIF(current_setting(
    'hanbang.amora_shared_action_operation_key', true
  ), '');
  v_guard_action text := NULLIF(current_setting(
    'hanbang.amora_shared_action_action_id', true
  ), '');
  v_guard_expected text := NULLIF(current_setting(
    'hanbang.amora_shared_action_expected_revision', true
  ), '');
  v_guard_applied text := NULLIF(current_setting(
    'hanbang.amora_shared_action_applied_revision', true
  ), '');
  v_tool_name text;
  v_approved_input jsonb;
  v_old_events jsonb;
  v_new_events jsonb;
  v_old_count integer;
  v_new_count integer;
  v_index integer;
  v_changed_count integer := 0;
  v_before_event jsonb;
  v_after_event jsonb;
  v_mutation_kind text;
  v_schedule_event_id text;
  v_rows integer;
BEGIN
  IF v_guard_couple IS NULL
     AND v_guard_request IS NULL
     AND v_guard_operation IS NULL
     AND v_guard_action IS NULL
     AND v_guard_expected IS NULL
     AND v_guard_applied IS NULL THEN
    RETURN NEW;
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role'
     OR v_guard_couple IS NULL
     OR v_guard_request IS NULL
     OR v_guard_operation IS NULL
     OR v_guard_action IS NULL
     OR v_guard_expected IS NULL
     OR v_guard_applied IS NULL
     OR v_guard_couple !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR v_guard_action !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR v_guard_operation !~ '^[a-f0-9]{64}$'
     OR char_length(v_guard_request) NOT BETWEEN 1 AND 160
     OR v_guard_expected !~ '^(0|[1-9][0-9]{0,15})$'
     OR v_guard_applied !~ '^(0|[1-9][0-9]{0,15})$'
     OR OLD.couple_id::text IS DISTINCT FROM v_guard_couple
     OR NEW.couple_id IS DISTINCT FROM OLD.couple_id
     OR OLD.state_revision IS DISTINCT FROM v_guard_expected::bigint
     OR NEW.state_revision IS DISTINCT FROM v_guard_applied::bigint
     OR NEW.state_revision IS DISTINCT FROM OLD.state_revision + 1 THEN
    RAISE EXCEPTION 'AMORA_SHARED_SCHEDULE_DELTA_CONTEXT_INVALID'
      USING ERRCODE = '55000';
  END IF;

  SELECT execution.tool_name,
         source.metadata #> '{pending_amora_action,input}'
    INTO v_tool_name, v_approved_input
  FROM public.amora_tool_executions AS execution
  JOIN public.amora_shared_action_journey_mutation_receipts AS receipt
    ON receipt.couple_id = execution.couple_id
   AND receipt.request_key = execution.request_key
   AND receipt.operation_key = execution.operation_key
   AND receipt.action_id = execution.pending_action_id
   AND receipt.expected_revision = OLD.state_revision
   AND receipt.applied_revision = NEW.state_revision
  JOIN public.chat_messages AS source
    ON source.id = receipt.source_message_id
   AND source.couple_id = receipt.couple_id
  WHERE execution.couple_id = OLD.couple_id
    AND execution.request_key = v_guard_request
    AND execution.operation_key = v_guard_operation
    AND execution.pending_action_id = v_guard_action::uuid
    AND execution.pending_action_journey_revision = OLD.state_revision
    AND execution.status = 'processing';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_SHARED_SCHEDULE_DELTA_CONTEXT_INVALID'
      USING ERRCODE = '55000';
  END IF;

  IF v_tool_name NOT IN ('add_schedule_event', 'update_schedule_event') THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(v_approved_input) IS DISTINCT FROM 'object'
     OR jsonb_typeof(OLD.progress) IS DISTINCT FROM 'object'
     OR jsonb_typeof(NEW.progress) IS DISTINCT FROM 'object'
     OR (OLD.progress - '__events') IS DISTINCT FROM
        (NEW.progress - '__events') THEN
    RAISE EXCEPTION 'AMORA_SHARED_SCHEDULE_DELTA_INVALID'
      USING ERRCODE = '22023';
  END IF;

  IF OLD.progress ? '__events' THEN
    IF jsonb_typeof(OLD.progress -> '__events') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'AMORA_SHARED_SCHEDULE_DELTA_INVALID'
        USING ERRCODE = '22023';
    END IF;
    v_old_events := OLD.progress -> '__events';
  ELSE
    v_old_events := '[]'::jsonb;
  END IF;

  IF NOT (NEW.progress ? '__events')
     OR jsonb_typeof(NEW.progress -> '__events') IS DISTINCT FROM 'array'
     OR jsonb_array_length(NEW.progress -> '__events') > 500
     OR octet_length((NEW.progress -> '__events')::text) > 1572864 THEN
    RAISE EXCEPTION 'AMORA_SHARED_SCHEDULE_DELTA_INVALID'
      USING ERRCODE = '22023';
  END IF;
  v_new_events := NEW.progress -> '__events';
  v_old_count := jsonb_array_length(v_old_events);
  v_new_count := jsonb_array_length(v_new_events);

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_new_events) AS event(value)
    WHERE jsonb_typeof(event.value) IS DISTINCT FROM 'object'
       OR char_length(btrim(COALESCE(event.value ->> 'id', '')))
          NOT BETWEEN 1 AND 200
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_new_events) AS event(value)
    GROUP BY event.value ->> 'id'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'AMORA_SHARED_SCHEDULE_DELTA_INVALID'
      USING ERRCODE = '22023';
  END IF;

  IF v_tool_name = 'add_schedule_event' THEN
    v_mutation_kind := 'add';
    IF v_approved_input - ARRAY[
         'date', 'time', 'title', 'memo', 'category_key', 'schedule_scope'
       ] <> '{}'::jsonb
       OR jsonb_typeof(v_approved_input -> 'date') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_approved_input -> 'title') IS DISTINCT FROM 'string'
       OR (
         v_approved_input ? 'time'
         AND jsonb_typeof(v_approved_input -> 'time') IS DISTINCT FROM 'string'
       )
       OR (
         v_approved_input ? 'memo'
         AND jsonb_typeof(v_approved_input -> 'memo') IS DISTINCT FROM 'string'
       )
       OR (
         v_approved_input ? 'category_key'
         AND jsonb_typeof(v_approved_input -> 'category_key')
             IS DISTINCT FROM 'string'
       )
       OR (
         v_approved_input ? 'schedule_scope'
         AND (
           jsonb_typeof(v_approved_input -> 'schedule_scope')
             IS DISTINCT FROM 'string'
           OR v_approved_input ->> 'schedule_scope' NOT IN (
             'confirmed_fact',
             'shared_commitment',
             'external_commitment'
           )
         )
       )
       OR v_new_count IS DISTINCT FROM v_old_count + 1 THEN
      RAISE EXCEPTION 'AMORA_SHARED_SCHEDULE_ADD_DELTA_INVALID'
        USING ERRCODE = '22023';
    END IF;

    IF v_old_count > 0 THEN
      FOR v_index IN 0..v_old_count - 1 LOOP
        IF v_old_events -> v_index IS DISTINCT FROM v_new_events -> v_index THEN
          RAISE EXCEPTION 'AMORA_SHARED_SCHEDULE_ADD_DELTA_INVALID'
            USING ERRCODE = '22023';
        END IF;
      END LOOP;
    END IF;

    v_after_event := v_new_events -> v_old_count;
    IF v_after_event - ARRAY[
         'id', 'date', 'time', 'title', 'memo', 'categoryKey', 'sourceKey',
         'status', 'createdAt', 'updatedAt'
       ] <> '{}'::jsonb
       OR jsonb_typeof(v_after_event -> 'id') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_after_event -> 'date') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_after_event -> 'title') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_after_event -> 'createdAt') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_after_event -> 'updatedAt') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_after_event -> 'status') IS DISTINCT FROM 'string'
       OR (
         v_after_event ? 'time'
         AND (
           jsonb_typeof(v_after_event -> 'time') IS DISTINCT FROM 'string'
           OR v_after_event ->> 'time'
              !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
         )
       )
       OR (
         v_after_event ? 'memo'
         AND jsonb_typeof(v_after_event -> 'memo') IS DISTINCT FROM 'string'
       )
       OR (
         v_after_event ? 'categoryKey'
         AND jsonb_typeof(v_after_event -> 'categoryKey')
             IS DISTINCT FROM 'string'
       )
       OR (
         v_after_event ? 'sourceKey'
         AND jsonb_typeof(v_after_event -> 'sourceKey') IS DISTINCT FROM 'string'
       )
       OR v_after_event -> 'date' IS DISTINCT FROM v_approved_input -> 'date'
       OR v_after_event -> 'title' IS DISTINCT FROM v_approved_input -> 'title'
       OR (
         v_approved_input ? 'time'
         AND v_after_event -> 'time' IS DISTINCT FROM v_approved_input -> 'time'
       )
       OR (
         NOT (v_approved_input ? 'time')
         AND v_after_event ? 'time'
       )
       OR (
         v_approved_input ? 'memo'
         AND v_after_event -> 'memo' IS DISTINCT FROM v_approved_input -> 'memo'
       )
       OR (
         NOT (v_approved_input ? 'memo')
         AND v_after_event ? 'memo'
       )
       OR (
         v_approved_input ? 'category_key'
         AND v_after_event -> 'categoryKey'
             IS DISTINCT FROM v_approved_input -> 'category_key'
       )
       OR (
         NOT (v_approved_input ? 'category_key')
         AND v_after_event ? 'categoryKey'
       )
       OR (
         COALESCE(v_approved_input ->> 'category_key', 'general') <> 'general'
         AND v_after_event ->> 'sourceKey' IS DISTINCT FROM
             'category:' || (v_approved_input ->> 'category_key')
       )
       OR (
         COALESCE(v_approved_input ->> 'category_key', 'general') = 'general'
         AND v_after_event ? 'sourceKey'
       )
       OR v_after_event ->> 'status' <> 'planned'
       OR v_after_event ->> 'createdAt'
          IS DISTINCT FROM v_after_event ->> 'updatedAt' THEN
      RAISE EXCEPTION 'AMORA_SHARED_SCHEDULE_ADD_DELTA_INVALID'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    v_mutation_kind := 'update';
    IF v_approved_input - ARRAY[
         'event_id', 'date', 'time', 'title', 'memo', 'schedule_scope'
       ] <> '{}'::jsonb
       OR jsonb_typeof(v_approved_input -> 'event_id')
          IS DISTINCT FROM 'string'
       OR (
         v_approved_input ? 'date'
         AND jsonb_typeof(v_approved_input -> 'date') IS DISTINCT FROM 'string'
       )
       OR (
         v_approved_input ? 'time'
         AND jsonb_typeof(v_approved_input -> 'time') IS DISTINCT FROM 'string'
       )
       OR (
         v_approved_input ? 'title'
         AND jsonb_typeof(v_approved_input -> 'title') IS DISTINCT FROM 'string'
       )
       OR (
         v_approved_input ? 'memo'
         AND jsonb_typeof(v_approved_input -> 'memo') IS DISTINCT FROM 'string'
       )
       OR (
         v_approved_input ? 'schedule_scope'
         AND (
           jsonb_typeof(v_approved_input -> 'schedule_scope')
             IS DISTINCT FROM 'string'
           OR v_approved_input ->> 'schedule_scope' NOT IN (
             'confirmed_fact',
             'shared_commitment',
             'external_commitment'
           )
         )
       )
       OR v_new_count IS DISTINCT FROM v_old_count
       OR v_old_count = 0 THEN
      RAISE EXCEPTION 'AMORA_SHARED_SCHEDULE_UPDATE_DELTA_INVALID'
        USING ERRCODE = '22023';
    END IF;

    FOR v_index IN 0..v_old_count - 1 LOOP
      IF v_old_events -> v_index ->> 'id'
         IS DISTINCT FROM v_new_events -> v_index ->> 'id' THEN
        RAISE EXCEPTION 'AMORA_SHARED_SCHEDULE_UPDATE_DELTA_INVALID'
          USING ERRCODE = '22023';
      END IF;
      IF v_old_events -> v_index IS DISTINCT FROM v_new_events -> v_index THEN
        v_changed_count := v_changed_count + 1;
        v_before_event := v_old_events -> v_index;
        v_after_event := v_new_events -> v_index;
      END IF;
    END LOOP;

    IF v_changed_count <> 1
       OR v_before_event ->> 'id' IS DISTINCT FROM
          v_approved_input ->> 'event_id'
       OR (v_before_event - ARRAY['date', 'time', 'title', 'memo', 'updatedAt'])
          IS DISTINCT FROM
          (v_after_event - ARRAY['date', 'time', 'title', 'memo', 'updatedAt'])
       OR (
         v_approved_input ? 'date'
         AND v_after_event -> 'date' IS DISTINCT FROM v_approved_input -> 'date'
       )
       OR (
         NOT (v_approved_input ? 'date')
         AND v_after_event -> 'date' IS DISTINCT FROM v_before_event -> 'date'
       )
       OR (
         v_approved_input ? 'time'
         AND v_after_event -> 'time' IS DISTINCT FROM v_approved_input -> 'time'
       )
       OR (
         NOT (v_approved_input ? 'time')
         AND v_after_event -> 'time' IS DISTINCT FROM v_before_event -> 'time'
       )
       OR (
         v_approved_input ? 'title'
         AND v_after_event -> 'title' IS DISTINCT FROM v_approved_input -> 'title'
       )
       OR (
         NOT (v_approved_input ? 'title')
         AND v_after_event -> 'title' IS DISTINCT FROM v_before_event -> 'title'
       )
       OR (
         v_approved_input ? 'memo'
         AND v_after_event -> 'memo' IS DISTINCT FROM v_approved_input -> 'memo'
       )
       OR (
         NOT (v_approved_input ? 'memo')
         AND v_after_event -> 'memo' IS DISTINCT FROM v_before_event -> 'memo'
       )
       OR (v_before_event - 'updatedAt')
          IS NOT DISTINCT FROM (v_after_event - 'updatedAt') THEN
      RAISE EXCEPTION 'AMORA_SHARED_SCHEDULE_UPDATE_DELTA_INVALID'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  v_schedule_event_id := v_after_event ->> 'id';
  IF (
       v_after_event ? 'time'
       AND (
         jsonb_typeof(v_after_event -> 'time') IS DISTINCT FROM 'string'
         OR v_after_event ->> 'time'
            !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
       )
     )
     OR char_length(btrim(COALESCE(v_schedule_event_id, '')))
       NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'AMORA_SHARED_SCHEDULE_DELTA_INVALID'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.amora_shared_action_journey_mutation_receipts
  SET mutation_kind = v_mutation_kind,
      schedule_scope = v_approved_input ->> 'schedule_scope',
      schedule_event_id = v_schedule_event_id,
      before_event = v_before_event,
      after_event = v_after_event
  WHERE couple_id = OLD.couple_id
    AND request_key = v_guard_request
    AND operation_key = v_guard_operation
    AND action_id = v_guard_action::uuid
    AND expected_revision = OLD.state_revision
    AND applied_revision = NEW.state_revision
    AND mutation_kind IS NULL
    AND schedule_scope IS NULL
    AND schedule_event_id IS NULL
    AND before_event IS NULL
    AND after_event IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'AMORA_SHARED_SCHEDULE_RECEIPT_INVALID'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.capture_amora_shared_schedule_delta() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.capture_amora_shared_schedule_delta()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_capture_amora_shared_schedule_delta
  ON public.wedding_journeys;
CREATE TRIGGER trg_capture_amora_shared_schedule_delta
  BEFORE UPDATE ON public.wedding_journeys
  FOR EACH ROW
  EXECUTE FUNCTION public.capture_amora_shared_schedule_delta();

-- Successful execution completion is the final boundary in the pre-existing
-- atomic dispatcher. Recording here makes state, the exact delta receipt, and
-- the user-confirmed decision succeed or roll back as one transaction.
CREATE OR REPLACE FUNCTION public.record_amora_shared_schedule_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_receipt
    public.amora_shared_action_journey_mutation_receipts%ROWTYPE;
  v_actor_role text;
  v_confirmed_at timestamptz;
  v_decision_node_id uuid := gen_random_uuid();
  v_recorded_at timestamptz := clock_timestamp();
  v_category text;
  v_title text;
  v_value text;
  v_rows integer;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM 'completed'
     OR NEW.status IS DISTINCT FROM 'completed'
     OR NEW.tool_name NOT IN ('add_schedule_event', 'update_schedule_event')
     OR jsonb_typeof(NEW.result -> 'success') IS DISTINCT FROM 'boolean'
     OR (NEW.result ->> 'success')::boolean IS DISTINCT FROM true THEN
    RETURN NEW;
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role'
     OR NEW.pending_action_id IS NULL
     OR NEW.pending_action_journey_revision IS NULL THEN
    RAISE EXCEPTION 'AMORA_SHARED_SCHEDULE_DECISION_NOT_AUTHORIZED'
      USING ERRCODE = '42501';
  END IF;

  SELECT receipt.*
    INTO v_receipt
  FROM public.amora_shared_action_journey_mutation_receipts AS receipt
  WHERE receipt.couple_id = NEW.couple_id
    AND receipt.request_key = NEW.request_key
    AND receipt.operation_key = NEW.operation_key
    AND receipt.action_id = NEW.pending_action_id
    AND receipt.expected_revision = NEW.pending_action_journey_revision
    AND receipt.applied_revision = NEW.pending_action_journey_revision + 1
    AND receipt.mutation_kind = CASE NEW.tool_name
      WHEN 'add_schedule_event' THEN 'add'
      ELSE 'update'
    END
    AND receipt.schedule_event_id IS NOT NULL
    AND receipt.after_event IS NOT NULL
    AND receipt.decision_node_id IS NULL
    AND receipt.decision_recorded_at IS NULL
  FOR UPDATE;

  IF NOT FOUND
     OR NEW.result ->> 'toolName' IS DISTINCT FROM NEW.tool_name
     OR NEW.result #> '{toolOutput,event}'
        IS DISTINCT FROM v_receipt.after_event
     OR (
       v_receipt.mutation_kind = 'add'
       AND v_receipt.before_event IS NOT NULL
     )
     OR (
       v_receipt.mutation_kind = 'update'
       AND (
         NEW.result #> '{toolOutput,previous_event}'
           IS DISTINCT FROM v_receipt.before_event
         OR jsonb_typeof(NEW.result #> '{toolOutput,updates}')
           IS DISTINCT FROM 'object'
       )
     ) THEN
    RAISE EXCEPTION 'AMORA_SHARED_SCHEDULE_DECISION_RECEIPT_INVALID'
      USING ERRCODE = '55000';
  END IF;

  SELECT confirmation.sender_type, confirmation.created_at
    INTO v_actor_role, v_confirmed_at
  FROM public.chat_messages AS confirmation
  WHERE confirmation.id = v_receipt.confirmation_message_id
    AND confirmation.couple_id = NEW.couple_id
    AND confirmation.sender_id IS NOT NULL
    AND confirmation.sender_type IN ('bride', 'groom')
    AND confirmation.role = 'user'
    AND confirmation.visibility = 'shared'
    AND confirmation.metadata ->> 'confirmed_amora_action_id'
      = NEW.pending_action_id::text;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_SHARED_SCHEDULE_DECISION_CONFIRMATION_INVALID'
      USING ERRCODE = '55000';
  END IF;

  v_category := COALESCE(
    NULLIF(btrim(v_receipt.after_event ->> 'categoryKey'), ''),
    'schedule'
  );
  v_title := left(
    CASE v_receipt.mutation_kind
      WHEN 'add' THEN '일정 추가 · '
      ELSE '일정 수정 · '
    END || COALESCE(NULLIF(btrim(v_receipt.after_event ->> 'title'), ''), '일정'),
    500
  );
  v_value := left(
    concat_ws(
      ' · ',
      NULLIF(btrim(v_receipt.after_event ->> 'date'), ''),
      NULLIF(btrim(v_receipt.after_event ->> 'time'), ''),
      NULLIF(btrim(v_receipt.after_event ->> 'title'), '')
    ),
    1000
  );

  INSERT INTO public.decision_nodes(
    id,
    couple_id,
    category,
    decision_type,
    title,
    chosen_value,
    options_considered,
    reasoning,
    confidence,
    decided_at,
    source,
    source_ref_id,
    source_message_id,
    source_actor_role,
    user_confirmed_at,
    metadata,
    visibility,
    created_at,
    updated_at
  ) VALUES (
    v_decision_node_id,
    NEW.couple_id,
    v_category,
    'scheduled',
    v_title,
    jsonb_build_object(
      'value', v_value,
      'schemaVersion', 1,
      'operation', v_receipt.mutation_kind,
      'scheduleScope', v_receipt.schedule_scope,
      'eventId', v_receipt.schedule_event_id,
      'before', v_receipt.before_event,
      'after', v_receipt.after_event,
      'expectedRevision', v_receipt.expected_revision,
      'appliedRevision', v_receipt.applied_revision
    ),
    '[]'::jsonb,
    '공유 채팅에서 사용자가 확인한 일정 변경',
    1.00,
    v_recorded_at,
    'schedule',
    v_receipt.action_id,
    v_receipt.confirmation_message_id,
    v_actor_role,
    v_confirmed_at,
    jsonb_build_object(
      'origin', 'amora_shared_action',
      'actionId', v_receipt.action_id,
      'proposalMessageId', v_receipt.source_message_id,
      'confirmationMessageId', v_receipt.confirmation_message_id,
      'requestKey', v_receipt.request_key,
      'operationKey', v_receipt.operation_key,
      'scheduleScope', v_receipt.schedule_scope,
      'eventId', v_receipt.schedule_event_id,
      'receiptExpectedRevision', v_receipt.expected_revision,
      'receiptAppliedRevision', v_receipt.applied_revision
    ),
    'shared',
    v_recorded_at,
    v_recorded_at
  );

  UPDATE public.amora_shared_action_journey_mutation_receipts
  SET decision_node_id = v_decision_node_id,
      decision_recorded_at = v_recorded_at
  WHERE couple_id = v_receipt.couple_id
    AND request_key = v_receipt.request_key
    AND operation_key = v_receipt.operation_key
    AND decision_node_id IS NULL
    AND decision_recorded_at IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'AMORA_SHARED_SCHEDULE_DECISION_RECEIPT_INVALID'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.record_amora_shared_schedule_decision()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_amora_shared_schedule_decision()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_record_amora_shared_schedule_decision
  ON public.amora_tool_executions;
CREATE TRIGGER trg_record_amora_shared_schedule_decision
  AFTER UPDATE OF status ON public.amora_tool_executions
  FOR EACH ROW
  EXECUTE FUNCTION public.record_amora_shared_schedule_decision();

DO $postcheck$
DECLARE
  v_capture_trigger_count integer;
  v_decision_trigger_count integer;
  v_insecure_function_count integer;
BEGIN
  SELECT count(*)::integer
    INTO v_capture_trigger_count
  FROM pg_trigger
  WHERE tgrelid = 'public.wedding_journeys'::regclass
    AND tgname = 'trg_capture_amora_shared_schedule_delta'
    AND tgenabled = 'O'
    AND NOT tgisinternal;

  SELECT count(*)::integer
    INTO v_decision_trigger_count
  FROM pg_trigger
  WHERE tgrelid = 'public.amora_tool_executions'::regclass
    AND tgname = 'trg_record_amora_shared_schedule_decision'
    AND tgenabled = 'O'
    AND NOT tgisinternal;

  SELECT count(*)::integer
    INTO v_insecure_function_count
  FROM pg_proc AS procedure
  JOIN pg_namespace AS namespace
    ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.proname IN (
      'capture_amora_shared_schedule_delta',
      'record_amora_shared_schedule_decision'
    )
    AND (
      NOT procedure.prosecdef
      OR pg_get_userbyid(procedure.proowner) <> 'postgres'
      OR COALESCE(procedure.proconfig, ARRAY[]::text[])
         @> ARRAY['search_path=public']::text[]
      OR has_function_privilege(
        'anon', procedure.oid, 'EXECUTE'
      )
      OR has_function_privilege(
        'authenticated', procedure.oid, 'EXECUTE'
      )
      OR has_function_privilege(
        'service_role', procedure.oid, 'EXECUTE'
      )
    );

  IF v_capture_trigger_count <> 1
     OR v_decision_trigger_count <> 1
     OR v_insecure_function_count <> 0 THEN
    RAISE EXCEPTION 'AMORA_SHARED_SCHEDULE_DECISION_POSTCHECK_FAILED'
      USING ERRCODE = '55000';
  END IF;
END
$postcheck$;

COMMIT;
