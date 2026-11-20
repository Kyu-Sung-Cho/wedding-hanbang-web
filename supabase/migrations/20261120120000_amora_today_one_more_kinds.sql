BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 2026-11-20 (설계 25장 2절, 결정 D-8·D-86): 오늘의 한 가지가 고르는 종류에 넷을 더한다.
--
--   task_deadline    함께 쓰는 할 일의 마감이 오늘·내일·사흘 뒤다.        다음 행동 "할 일 보기"  → /lounge
--   couple_decision  두 분이 정할 것(업체가 제안한 상담 시간, 편지 확인).  다음 행동 "정할 것 보기" → /halls/consultation, /halls/letter
--   inquiry_waiting  보낸 문의가 48시간 넘게 답이 없다.                 다음 행동 "문의 보기"   → /halls/consultation
--   task_done        아모라가 맡은 일이 끝났다(갈래 4).                 다음 행동 "맡은 일 보기" → /lounge
--
-- task_done 은 자리만 둔다. 고르는 코드는 갈래 4가 서버에 더하고(TODAY_ONE_EXTRA_SOURCES), 그 전에는 이 종류의
-- 카드가 만들어지지 않는다. 검사 함수와 종류 CHECK 를 여기 한곳에서 정의해 두 벌로 갈라지지 않게 한다.
--
-- 고르는 것은 서버 코드의 규칙이고 문장은 정해진 틀이다. 이 함수는 종류마다 다음 행동의 글과 주소를 정확한 짝으로
-- 다시 지킨다. 바깥 연락·발송·새 실행 권한은 더하지 않는다(카드는 앱 안에만 보인다).
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
     OR p_value->>'kind' NOT IN (
       'schedule_moment', 'budget_guardrail',
       'task_deadline', 'couple_decision', 'inquiry_waiting', 'task_done'
     )
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
     ))
     OR (v_kind = 'task_deadline' AND (
       v_label <> '할 일 보기' OR v_href <> '/lounge'
     ))
     OR (v_kind = 'couple_decision' AND (
       v_label <> '정할 것 보기'
       OR v_href NOT IN ('/halls/consultation', '/halls/letter')
     ))
     OR (v_kind = 'inquiry_waiting' AND (
       v_label <> '문의 보기' OR v_href <> '/halls/consultation'
     ))
     OR (v_kind = 'task_done' AND (
       v_label <> '맡은 일 보기' OR v_href <> '/lounge'
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
  DROP CONSTRAINT IF EXISTS amora_today_one_signals_kind_check;
ALTER TABLE public.amora_today_one_signals
  ADD CONSTRAINT amora_today_one_signals_kind_check
    CHECK (kind IN (
      'schedule_moment', 'budget_guardrail',
      'task_deadline', 'couple_decision', 'inquiry_waiting', 'task_done'
    )) NOT VALID;
ALTER TABLE public.amora_today_one_signals
  VALIDATE CONSTRAINT amora_today_one_signals_kind_check;

ALTER FUNCTION public.amora_today_one_presentation_is_valid(jsonb)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.amora_today_one_presentation_is_valid(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.amora_today_one_presentation_is_valid(jsonb) IS
  'Exact TodayOne presentation validator: schedule_moment, budget_guardrail, task_deadline, couple_decision, inquiry_waiting, task_done with fixed next actions.';
COMMENT ON TABLE public.amora_today_one_signals IS
  'Latest recipient-scoped, source-revision-bound in-app TodayOne evidence (schedule, recorded spend, shared to-dos, couple decisions, waiting inquiries, finished Amora tasks). The card itself is never sent outside the app.';

DO $postconditions$
DECLARE
  v_kind_definition text;
  v_kind text;
BEGIN
  SELECT pg_get_constraintdef(constraint_row.oid)
  INTO v_kind_definition
  FROM pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.amora_today_one_signals'::regclass
    AND constraint_row.conname = 'amora_today_one_signals_kind_check'
    AND constraint_row.convalidated;

  IF v_kind_definition IS NULL THEN
    RAISE EXCEPTION 'AMORA_TODAY_ONE_MORE_KINDS_POSTCONDITION_FAILED';
  END IF;
  FOREACH v_kind IN ARRAY ARRAY[
    'schedule_moment', 'budget_guardrail',
    'task_deadline', 'couple_decision', 'inquiry_waiting', 'task_done'
  ] LOOP
    IF position(v_kind IN v_kind_definition) = 0 THEN
      RAISE EXCEPTION 'AMORA_TODAY_ONE_MORE_KINDS_POSTCONDITION_FAILED';
    END IF;
  END LOOP;

  IF NOT EXISTS (
       SELECT 1
       FROM pg_constraint AS constraint_row
       WHERE constraint_row.conrelid = 'public.amora_today_one_signals'::regclass
         AND constraint_row.conname = 'amora_today_one_signals_kind_presentation_check'
         AND constraint_row.convalidated
     ) THEN
    RAISE EXCEPTION 'AMORA_TODAY_ONE_MORE_KINDS_POSTCONDITION_FAILED';
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
    RAISE EXCEPTION 'AMORA_TODAY_ONE_MORE_KINDS_VALIDATOR_ACL_POSTCONDITION_FAILED';
  END IF;
END
$postconditions$;

COMMIT;
