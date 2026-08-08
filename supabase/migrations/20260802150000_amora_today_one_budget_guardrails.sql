BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Add one narrowly-scoped in-app budget kind. This migration does not add an
-- outbound channel, queue, provider call, or new execution privilege.
CREATE OR REPLACE FUNCTION public.amora_today_one_presentation_is_valid(
  p_value jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_kind text;
  v_next_action jsonb;
  v_choices jsonb;
  v_href text;
  v_label text;
BEGIN
  IF p_value IS NULL
     OR jsonb_typeof(p_value) <> 'object'
     OR pg_column_size(p_value) > 8192
     OR NOT p_value ?& ARRAY[
       'kind', 'whyNow', 'confirmed', 'unknown', 'nextAction', 'impact', 'choices'
     ]
     OR (SELECT count(*) FROM jsonb_object_keys(p_value)) <> 7
     OR p_value->>'kind' NOT IN ('schedule_moment', 'budget_guardrail')
     OR NOT public.amora_today_one_text_is_safe(p_value->>'whyNow', 1, 240)
     OR NOT public.amora_today_one_text_is_safe(p_value->>'impact', 1, 180)
     OR jsonb_typeof(p_value->'confirmed') <> 'array'
     OR jsonb_array_length(p_value->'confirmed') NOT BETWEEN 1 AND 4
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(p_value->'confirmed') AS item(value)
       WHERE jsonb_typeof(item.value) <> 'string'
          OR NOT public.amora_today_one_text_is_safe(item.value #>> '{}', 1, 180)
     )
     OR jsonb_typeof(p_value->'unknown') <> 'array'
     OR jsonb_array_length(p_value->'unknown') NOT BETWEEN 0 AND 4
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(p_value->'unknown') AS item(value)
       WHERE jsonb_typeof(item.value) <> 'string'
          OR NOT public.amora_today_one_text_is_safe(item.value #>> '{}', 1, 180)
     ) THEN
    RETURN false;
  END IF;

  v_kind := p_value->>'kind';
  v_next_action := p_value->'nextAction';
  IF jsonb_typeof(v_next_action) <> 'object'
     OR NOT v_next_action ?& ARRAY['label', 'href']
     OR (SELECT count(*) FROM jsonb_object_keys(v_next_action)) <> 2
     OR NOT public.amora_today_one_text_is_safe(v_next_action->>'label', 1, 80)
     OR NOT public.amora_today_one_text_is_safe(v_next_action->>'href', 1, 240) THEN
    RETURN false;
  END IF;

  v_label := v_next_action->>'label';
  v_href := v_next_action->>'href';
  IF left(v_href, 1) <> '/'
     OR left(v_href, 2) = '//'
     OR position(E'\\' IN v_href) > 0
     OR (v_kind = 'schedule_moment' AND (
       v_label <> '일정 열기' OR v_href <> '/schedule'
     ))
     OR (v_kind = 'budget_guardrail' AND (
       v_label <> '예산 열기' OR v_href <> '/budget'
     )) THEN
    RETURN false;
  END IF;

  v_choices := p_value->'choices';
  IF jsonb_typeof(v_choices) <> 'array'
     OR jsonb_array_length(v_choices) NOT BETWEEN 2 AND 4
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(v_choices) AS choice(value)
       WHERE jsonb_typeof(choice.value) <> 'object'
          OR NOT choice.value ?& ARRAY['action', 'label']
          OR (SELECT count(*) FROM jsonb_object_keys(choice.value)) <> 2
          OR choice.value->>'action' NOT IN (
            'open_source', 'snooze', 'dismiss', 'mute_source'
          )
          OR NOT public.amora_today_one_text_is_safe(
            choice.value->>'label', 1, 40
          )
     )
     OR (
       SELECT count(DISTINCT choice.value->>'action')
       FROM jsonb_array_elements(v_choices) AS choice(value)
     ) <> jsonb_array_length(v_choices) THEN
    RETURN false;
  END IF;

  RETURN true;
END
$function$;

ALTER TABLE public.amora_today_one_signals
  DROP CONSTRAINT IF EXISTS amora_today_one_signals_kind_presentation_check;
ALTER TABLE public.amora_today_one_signals
  DROP CONSTRAINT IF EXISTS amora_today_one_signals_kind_check;
ALTER TABLE public.amora_today_one_signals
  ADD CONSTRAINT amora_today_one_signals_kind_check
    CHECK (kind IN ('schedule_moment', 'budget_guardrail')) NOT VALID;
ALTER TABLE public.amora_today_one_signals
  ADD CONSTRAINT amora_today_one_signals_kind_presentation_check
    CHECK (kind = presentation->>'kind') NOT VALID;
ALTER TABLE public.amora_today_one_signals
  VALIDATE CONSTRAINT amora_today_one_signals_kind_check;
ALTER TABLE public.amora_today_one_signals
  VALIDATE CONSTRAINT amora_today_one_signals_kind_presentation_check;

ALTER FUNCTION public.amora_today_one_presentation_is_valid(jsonb)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.amora_today_one_presentation_is_valid(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.amora_today_one_presentation_is_valid(jsonb) IS
  'Exact TodayOne schedule_moment or recorded-spend-only budget_guardrail presentation validator.';
COMMENT ON TABLE public.amora_today_one_signals IS
  'Latest recipient-scoped, source-revision-bound in-app schedule or explicit budget evidence. No outbound delivery.';

DO $postconditions$
DECLARE
  v_kind_definition text;
BEGIN
  SELECT pg_get_constraintdef(constraint_row.oid)
  INTO v_kind_definition
  FROM pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.amora_today_one_signals'::regclass
    AND constraint_row.conname = 'amora_today_one_signals_kind_check'
    AND constraint_row.convalidated;

  IF v_kind_definition IS NULL
     OR position('schedule_moment' IN v_kind_definition) = 0
     OR position('budget_guardrail' IN v_kind_definition) = 0
     OR NOT EXISTS (
       SELECT 1
       FROM pg_constraint AS constraint_row
       WHERE constraint_row.conrelid = 'public.amora_today_one_signals'::regclass
         AND constraint_row.conname = 'amora_today_one_signals_kind_presentation_check'
         AND constraint_row.convalidated
     ) THEN
    RAISE EXCEPTION 'AMORA_TODAY_ONE_BUDGET_KIND_POSTCONDITION_FAILED';
  END IF;

  IF has_function_privilege(
       'authenticated',
       'public.amora_today_one_presentation_is_valid(jsonb)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.amora_today_one_presentation_is_valid(jsonb)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'AMORA_TODAY_ONE_BUDGET_VALIDATOR_ACL_POSTCONDITION_FAILED';
  END IF;
END
$postconditions$;

COMMIT;
