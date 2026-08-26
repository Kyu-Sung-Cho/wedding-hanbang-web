-- 옮기기 카드가 "무엇을 어디서" 옮기는지 말하지 못했다.
--
-- ## 무엇이 있었나
--
-- 아모라가 일정을 옮기자고 제안하면 카드에 이렇게만 나온다:
--
--     다음 변경을 적용할까요?
--     - 변경: 일정 변경
--     - 날짜: 2027년 6월 20일
--     - 시간: "14:00"
--
-- 어느 일정을 어느 날짜에서 옮기는지가 없다. 본문에 설명을 붙일 수도 없다 —
-- `extractAmoraPendingAction` 이 표식을 찾으면 본문을 서버 확인문으로 통째로
-- 갈아치우기 때문이다(운영 실측: 카드가 붙은 AI 메시지 37건 전부 정형 문구뿐).
--
-- 형제 도구인 `cancel_schedule_event`·`restore_schedule_event` 는 이미
-- `expected_title`·`expected_date` 를 받고, 카드가 그것을 "대상 일정"·"현재 날짜"
-- 로 찍는다(FIELD_LABELS 에 라벨이 이미 있다). `update_schedule_event` 만 빠져 있다.
--
-- ## 왜 마이그레이션이 필요한가
--
-- 도구 스키마만 고치면 **운영에서 조용히 죽는다.** 이 트리거가 승인된 카드 입력을
-- 정확히 6개 키로 잠그고 있어서, 선언 안 된 키가 하나라도 있으면
-- `AMORA_SHARED_SCHEDULE_UPDATE_DELTA_INVALID`(22023) 로 적용 전체가 롤백된다.
-- 조사 중 기존 PGlite 테스트 입력에 두 필드를 넣어 실제로 그 예외를 재현했다.
--
-- ## 무엇만 바꾸나
--
-- update 갈래의 키 화이트리스트에 두 이름을 더하고, 그 둘의 타입(문자열)을
-- 형제 키들과 같은 모양으로 검사한다. **그게 전부다.** 델타 검증 로직은 손대지
-- 않는다 — expected_* 는 이벤트를 바꾸지 않으므로 before/after 비교와 무관하다.
--
-- 함수 본문은 손으로 옮겨 적지 않고 `20260802100000_amora_shared_schedule_decision_receipts.sql`
-- 의 정의를 그대로 떠서 위 두 곳만 치환해 만들었다(diff 로 두 hunk 만인 것을 확인).
--
-- ## 값 검증은 여기서 하지 않는다
--
-- 형제 도구는 앱에서 expected_* 를 현재 값과 대조한다. 그 대조를 DB 로 올리지
-- 않는 이유는, 프롬프트가 제목을 trim + 300자 절단해서 싣기 때문이다 — 원본과
-- 정확 일치를 요구하면 긴 제목의 일정은 **영구히 못 옮기게** 된다. 앱에서
-- 같은 정규화를 거친 뒤 느슨하게 대조한다.

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
         'event_id', 'date', 'time', 'title', 'memo', 'schedule_scope',
         'expected_title', 'expected_date'
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
         v_approved_input ? 'expected_title'
         AND jsonb_typeof(v_approved_input -> 'expected_title')
             IS DISTINCT FROM 'string'
       )
       OR (
         v_approved_input ? 'expected_date'
         AND jsonb_typeof(v_approved_input -> 'expected_date')
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
