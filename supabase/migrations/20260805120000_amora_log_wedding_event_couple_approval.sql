-- log_wedding_event를 두 사람 확인 대상으로 옮긴다.
--
-- 왜:
--   이 도구는 이름이 "기록"이지만 add_schedule_event와 **같은 공유 일정 배열**
--   (wedding_journeys.progress -> '__events')에 쓴다. 그런데 승인 정책만 달랐다.
--
--     add_schedule_event  {schedule_scope: 'shared_commitment', '2027-03-12', '예식장 투어'}  -> couple
--     log_wedding_event   {moment_type: 'venue_tour',           '2027-03-12', '예식장 투어'}  -> single
--
--   파트너 화면에는 똑같이 보이는데 어느 경로를 쓸지는 모델이 정했다. 게다가
--   log_wedding_event는 날짜에 과거/미래 제한이 없어서(형식 검사만 한다) 아직 오지
--   않은 날짜를 그대로 받는다. 상견례·예식장 방문처럼 둘이 함께 가는 자리가 합의 없이
--   공유 캘린더에 박히는데, 지우려면 cancel_schedule_event가 필요하고 그건 couple이다.
--   넣기는 혼자, 빼기는 둘이라는 비대칭이었다.
--
-- 왜 날짜로 가르지 않는가:
--   "지난 날짜면 single, 앞날이면 couple"이 더 정밀해 보이지만 이 함수는 IMMUTABLE이라
--   시계를 볼 수 없다. STABLE로 낮추면 제안 시점과 실행 시점의 판정이 갈릴 수 있고,
--   그러면 couple로 제안된 건이 자정을 넘겨 single로 느슨해진다. 서버가 제안 시점에
--   성격을 입력에 적어 넣는 방법도 있으나, log_wedding_event의 입력 키 집합은
--   apply_amora_atomic_tool_execution이 엄격히 강제한다
--   (20260716112000: p_tool_input - ARRAY['moment_type','date','title','memo'] <> '{}').
--   키 하나를 늘리려고 1,400줄짜리 함수를 재작성하는 위험을 지지 않는다.
--
--   이미 지난 일을 혼자 기록하는 길은 그대로 남는다 — add_schedule_event에
--   schedule_scope: 'confirmed_fact'를 주면 single이다. 성격을 명시적으로 밝힌
--   요청만 한 사람 확인을 얻는다는 규칙이 오히려 선명해진다.
--
-- 배포 순서:
--   이 마이그레이션 없이 앱만 배포해도 안전하다. 앱은 두 사람 확인을 모으고 DB는
--   그보다 관대하므로 기존 동작이 깨지지 않는다. 반대로 이 마이그레이션만 먼저
--   적용해도, 한 사람 확인으로 들어온 요청이 거부될 뿐 데이터가 손상되지 않는다.
--   다만 두 층의 판정이 어긋난 채로 오래 두지 않는다.
--
-- 변경 범위:
--   public.amora_shared_action_policy 한 함수. 20260802140000의 본문에서
--   log_wedding_event를 'single' 목록에서 빼고 'couple' 분기로 옮긴 것 외에는
--   한 글자도 바꾸지 않았다.

BEGIN;

CREATE OR REPLACE FUNCTION public.amora_shared_action_policy(
  p_tool_name text,
  p_tool_input jsonb
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT CASE
    WHEN p_tool_name IN (
      'create_booking',
      'cancel_booking',
      'delete_category',
      'reset_category',
      'delete_schedule_event',
      'update_amora_action'
    ) THEN 'blocked'
    WHEN jsonb_typeof(p_tool_input) IS DISTINCT FROM 'object' THEN 'blocked'
    WHEN p_tool_name IN (
      'update_budget',
      'update_wedding_date',
      'update_venue',
      'apply_budget_plan',
      'cancel_schedule_event',
      'restore_schedule_event',
      -- 공유 일정에 쓰는데 성격을 밝힐 자리가 없으므로 두 사람 확인을 받는다.
      'log_wedding_event'
    ) THEN 'couple'
    WHEN p_tool_name IN ('update_category_budget', 'add_custom_category')
      AND p_tool_input ? 'budget'
      THEN 'couple'
    WHEN p_tool_name = 'add_schedule_event'
      AND p_tool_input ->> 'schedule_scope' = 'confirmed_fact'
      THEN 'single'
    WHEN p_tool_name IN ('add_schedule_event', 'update_schedule_event')
      THEN 'couple'
    WHEN p_tool_name IN (
      'update_task_status',
      'update_category_budget',
      'add_custom_category',
      'toggle_checklist_item',
      'add_amora_action'
    ) THEN 'single'
    ELSE 'blocked'
  END;
$function$;

REVOKE ALL ON FUNCTION public.amora_shared_action_policy(text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.amora_shared_action_policy(text, jsonb)
  TO service_role;

DO $postchecks$
BEGIN
  -- 공유 일정에 쓰는 세 도구가 전부 두 사람 확인 대상인지 확인한다.
  IF public.amora_shared_action_policy(
       'log_wedding_event',
       jsonb_build_object('moment_type', 'venue_tour', 'date', '2027-03-12')
     ) <> 'couple' THEN
    RAISE EXCEPTION 'AMORA_LOG_WEDDING_EVENT_POLICY_POSTCHECK_FAILED';
  END IF;

  IF public.amora_shared_action_policy(
       'add_schedule_event',
       jsonb_build_object('date', '2027-03-12', 'schedule_scope', 'shared_commitment')
     ) <> 'couple' THEN
    RAISE EXCEPTION 'AMORA_ADD_SCHEDULE_EVENT_POLICY_POSTCHECK_FAILED';
  END IF;

  -- 성격을 밝힌 확정 사실 기록은 그대로 한 사람 확인으로 남는다.
  IF public.amora_shared_action_policy(
       'add_schedule_event',
       jsonb_build_object('date', '2020-03-12', 'schedule_scope', 'confirmed_fact')
     ) <> 'single' THEN
    RAISE EXCEPTION 'AMORA_CONFIRMED_FACT_POLICY_POSTCHECK_FAILED';
  END IF;

  -- 일정과 무관한 한 사람 확인 도구는 건드리지 않았다.
  IF public.amora_shared_action_policy('toggle_checklist_item', '{}'::jsonb) <> 'single'
     OR public.amora_shared_action_policy('add_amora_action', '{}'::jsonb) <> 'single'
     OR public.amora_shared_action_policy('update_task_status', '{}'::jsonb) <> 'single' THEN
    RAISE EXCEPTION 'AMORA_SINGLE_APPROVAL_POLICY_POSTCHECK_FAILED';
  END IF;

  -- 차단 목록도 그대로다.
  IF public.amora_shared_action_policy('delete_schedule_event', '{}'::jsonb) <> 'blocked'
     OR public.amora_shared_action_policy('create_booking', '{}'::jsonb) <> 'blocked' THEN
    RAISE EXCEPTION 'AMORA_BLOCKED_POLICY_POSTCHECK_FAILED';
  END IF;
END;
$postchecks$;

COMMIT;
