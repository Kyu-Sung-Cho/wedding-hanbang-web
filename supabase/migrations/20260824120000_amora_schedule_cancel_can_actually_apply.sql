-- 20260824120000: 아모라의 일정 취소가 실제로 반영되게 한다.
--
-- `cancel_schedule_event` 는 2026-08-02 에 들어왔는데 **도입 이래 한 번도
-- 반영된 적이 없다.** 사용자가 겪는 모양은 이렇다.
--
--     카드가 나온다 → 확인을 누른다 → 도구가 호출된다 → 조용히 멈춘다
--
-- 관문이 둘이었고, 둘 다 같은 이유로 막았다 — 도구 허용 목록이 2026-07-16 판
-- 그대로였고 은퇴한 `delete_schedule_event` 만 들어 있었다.
--
--   1) claim_amora_tool_execution        (2026-08-23 에 고침)
--   2) apply_amora_atomic_tool_execution_v1  ← 이 파일
--
-- 1번을 고치자 2번이 드러났다. 2번의 오류는 코드가 `catch {}` 로 삼켜서
-- 로그에 남지 않았고, 그래서 원인 후보를 SQL 로 하나씩 되짚어야 했다
-- (델타 함수·영수증 조인·행위자 신원·커플 로스터·트리거 충돌·가드 설정 —
-- 전부 정상이었다). 삼킨 자리에 로깅을 넣은 뒤에야 한 줄로 나왔다.
--
--     [amora-tool] atomic commit rejected
--       tool: 'cancel_schedule_event', code: '22023',
--       message: 'AMORA_ATOMIC_SCHEDULE_MUTATION_INVALID'
--
-- 아래 정의는 운영 DB 에서 그대로 받아 **목록 한 곳만** 치환한 것이다. 손으로
-- 옮겨 적지 않았다.

BEGIN;

CREATE OR REPLACE FUNCTION public.apply_amora_atomic_tool_execution_v1(p_couple_id uuid, p_request_key text, p_operation_key text, p_request_attempt_count integer, p_input_digest text, p_tool_input jsonb, p_domain_mutation jsonb, p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '5s'
 SET statement_timeout TO '15s'
AS $function$
DECLARE
  v_request public.amora_chat_request_claims%ROWTYPE;
  v_execution public.amora_tool_executions%ROWTYPE;
  v_journey public.wedding_journeys%ROWTYPE;
  v_kind text;
  v_expected_budget numeric;
  v_next_budget numeric;
  v_progress_key text;
  v_expected_present boolean;
  v_current_present boolean;
  v_event jsonb;
  v_event_date date;
  v_event_count integer := 0;
  v_distinct_event_count integer := 0;
  v_effective_result jsonb := p_result;
  v_rows integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_ATOMIC_TOOL_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF p_couple_id IS NULL
     OR p_request_key IS NULL
     OR p_operation_key !~ '^[0-9a-f]{64}$'
     OR p_request_attempt_count IS NULL
     OR p_request_attempt_count < 1
     OR p_input_digest !~ '^[0-9a-f]{64}$'
     OR jsonb_typeof(p_tool_input) <> 'object'
     OR octet_length(p_tool_input::text) > 16384
     OR jsonb_typeof(p_domain_mutation) <> 'object'
     OR octet_length(p_domain_mutation::text) > 2097152
     OR jsonb_typeof(p_result) <> 'object'
     OR octet_length(p_result::text) > 65536
     OR p_result ? 'toolInput'
     OR p_result - ARRAY[
       'toolName', 'toolOutput', 'success', 'displayMessage'
     ] <> '{}'::jsonb
     OR jsonb_typeof(p_result -> 'toolOutput') <> 'object'
     OR jsonb_typeof(p_result -> 'success') <> 'boolean'
     OR jsonb_typeof(p_result -> 'displayMessage') <> 'string'
     OR char_length(p_result ->> 'displayMessage') > 4000 THEN
    RAISE EXCEPTION 'AMORA_ATOMIC_TOOL_INVALID_INPUT'
      USING ERRCODE = '22023';
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

  v_kind := p_domain_mutation ->> 'kind';
  IF v_kind = 'none' THEN
    IF p_result ->> 'success' <> 'false'
       OR p_domain_mutation - 'kind' <> '{}'::jsonb THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_TOOL_NOOP_INVALID'
        USING ERRCODE = '22023';
    END IF;
  ELSIF v_kind = 'journey_total_budget_cas' THEN
    IF v_execution.tool_name <> 'update_budget'
       OR p_domain_mutation - ARRAY['kind', 'expected', 'value'] <> '{}'::jsonb
       OR jsonb_typeof(p_domain_mutation -> 'expected') <> 'number'
       OR jsonb_typeof(p_domain_mutation -> 'value') <> 'number'
       OR jsonb_typeof(p_tool_input -> 'total_budget') <> 'number'
       OR p_tool_input -> 'total_budget' <> p_domain_mutation -> 'value'
       OR p_result ->> 'success' <> 'true'
       OR p_result -> 'toolOutput' -> 'total_budget'
          <> p_domain_mutation -> 'value'
       OR p_result -> 'toolOutput' -> 'previous_budget'
          <> p_domain_mutation -> 'expected' THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_BUDGET_MUTATION_INVALID'
        USING ERRCODE = '22023';
    END IF;

    BEGIN
      v_expected_budget := (p_domain_mutation ->> 'expected')::numeric;
      v_next_budget := (p_domain_mutation ->> 'value')::numeric;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_BUDGET_MUTATION_INVALID'
        USING ERRCODE = '22023';
    END;
    IF trunc(v_expected_budget) <> v_expected_budget
       OR trunc(v_next_budget) <> v_next_budget
       OR v_expected_budget NOT BETWEEN 0 AND 1000000000000
       OR v_next_budget NOT BETWEEN 0 AND 1000000000000 THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_BUDGET_MUTATION_INVALID'
        USING ERRCODE = '22023';
    END IF;

    SELECT journey.* INTO v_journey
    FROM public.wedding_journeys AS journey
    WHERE journey.couple_id = p_couple_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_JOURNEY_NOT_FOUND'
        USING ERRCODE = 'P0002';
    END IF;

    IF v_journey.total_budget IS DISTINCT FROM v_expected_budget THEN
      v_effective_result := jsonb_build_object(
        'toolName', v_execution.tool_name,
        'toolOutput', jsonb_build_object(
          'error', 'domain_state_changed',
          'retryable', false
        ),
        'success', false,
        'displayMessage',
          '다른 변경이 먼저 반영되어 이번 요청은 적용하지 않았어요. 현재 상태를 다시 확인해 주세요.'
      );
    ELSE
      UPDATE public.wedding_journeys
      SET total_budget = v_next_budget,
          updated_at = now()
      WHERE couple_id = p_couple_id;
    END IF;
  ELSIF v_kind = 'journey_progress_key_cas' THEN
    IF v_execution.tool_name NOT IN (
         'add_schedule_event', 'update_schedule_event', 'delete_schedule_event',
         -- 2026-08-24: 이 둘이 빠져 있어서 아모라의 일정 취소·복원이 도입 이래
         -- 한 번도 반영되지 못했다. 목록은 2026-07-16 판 그대로였고 두 도구는
         -- 2026-08-02 에 들어왔다. 은퇴한 delete_schedule_event 만 남아 있었다.
         'cancel_schedule_event', 'restore_schedule_event'
       )
       OR p_domain_mutation - ARRAY[
         'kind', 'key', 'expectedPresent', 'expected', 'value'
       ] <> '{}'::jsonb
       OR p_domain_mutation ->> 'key' <> '__events'
       OR jsonb_typeof(p_domain_mutation -> 'expectedPresent') <> 'boolean'
       OR jsonb_typeof(p_domain_mutation -> 'value') <> 'array'
       OR jsonb_array_length(p_domain_mutation -> 'value') > 500
       OR octet_length((p_domain_mutation -> 'value')::text) > 1572864
       OR p_result ->> 'success' <> 'true' THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_SCHEDULE_MUTATION_INVALID'
        USING ERRCODE = '22023';
    END IF;

    v_progress_key := p_domain_mutation ->> 'key';
    v_expected_present := (p_domain_mutation ->> 'expectedPresent')::boolean;
    IF (v_expected_present AND NOT p_domain_mutation ? 'expected')
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
      RAISE EXCEPTION 'AMORA_ATOMIC_SCHEDULE_EXPECTATION_INVALID'
        USING ERRCODE = '22023';
    END IF;

    IF v_execution.tool_name = 'delete_schedule_event' THEN
      IF NOT v_expected_present
         OR jsonb_typeof(p_result -> 'toolOutput' -> 'deleted_event') <> 'object'
         OR p_tool_input ->> 'event_id'
            <> p_result -> 'toolOutput' -> 'deleted_event' ->> 'id'
         OR p_tool_input ->> 'confirmed' <> 'true'
         OR NOT (
           p_domain_mutation -> 'expected'
           @> jsonb_build_array(p_result -> 'toolOutput' -> 'deleted_event')
         )
         OR EXISTS (
           SELECT 1
           FROM jsonb_array_elements(p_domain_mutation -> 'value') AS remaining(value)
           WHERE remaining.value ->> 'id'
             = p_result -> 'toolOutput' -> 'deleted_event' ->> 'id'
         )
         OR jsonb_array_length(p_domain_mutation -> 'expected')
            <> jsonb_array_length(p_domain_mutation -> 'value') + 1
         OR EXISTS (
           SELECT 1
           FROM jsonb_array_elements(p_domain_mutation -> 'expected') AS prior(value)
           WHERE prior.value ->> 'id'
                 <> p_result -> 'toolOutput' -> 'deleted_event' ->> 'id'
             AND NOT (
               p_domain_mutation -> 'value' @> jsonb_build_array(prior.value)
             )
         ) THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_SCHEDULE_DELETE_INVALID'
          USING ERRCODE = '22023';
      END IF;
    ELSE
      IF jsonb_typeof(p_result -> 'toolOutput' -> 'event') <> 'object'
         OR NOT (
           p_domain_mutation -> 'value'
           @> jsonb_build_array(p_result -> 'toolOutput' -> 'event')
         )
         OR (
           v_execution.tool_name = 'add_schedule_event'
           AND (
             p_tool_input ->> 'date'
               <> p_result -> 'toolOutput' -> 'event' ->> 'date'
             OR p_tool_input ->> 'title'
               <> p_result -> 'toolOutput' -> 'event' ->> 'title'
           )
         )
         OR (
           v_execution.tool_name = 'update_schedule_event'
           AND p_tool_input ->> 'event_id'
             <> p_result -> 'toolOutput' -> 'event' ->> 'id'
         ) THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_SCHEDULE_UPSERT_INVALID'
          USING ERRCODE = '22023';
      END IF;
    END IF;

    FOR v_event IN
      SELECT value FROM jsonb_array_elements(p_domain_mutation -> 'value')
      UNION ALL
      SELECT value
      FROM jsonb_array_elements(
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
        RAISE EXCEPTION 'AMORA_ATOMIC_SCHEDULE_EVENT_INVALID'
          USING ERRCODE = '22023';
      END IF;
      BEGIN
        v_event_date := (v_event ->> 'date')::date;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_SCHEDULE_EVENT_INVALID'
          USING ERRCODE = '22023';
      END;
      IF to_char(v_event_date, 'YYYY-MM-DD') <> v_event ->> 'date' THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_SCHEDULE_EVENT_INVALID'
          USING ERRCODE = '22023';
      END IF;
    END LOOP;

    SELECT count(*)::integer, count(DISTINCT value ->> 'id')::integer
      INTO v_event_count, v_distinct_event_count
    FROM jsonb_array_elements(p_domain_mutation -> 'value');
    IF v_event_count <> v_distinct_event_count THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_SCHEDULE_EVENT_ID_DUPLICATE'
        USING ERRCODE = '22023';
    END IF;
    IF v_expected_present THEN
      SELECT count(*)::integer, count(DISTINCT value ->> 'id')::integer
        INTO v_event_count, v_distinct_event_count
      FROM jsonb_array_elements(p_domain_mutation -> 'expected');
      IF v_event_count <> v_distinct_event_count THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_SCHEDULE_EXPECTED_ID_DUPLICATE'
          USING ERRCODE = '22023';
      END IF;
    END IF;

    SELECT journey.* INTO v_journey
    FROM public.wedding_journeys AS journey
    WHERE journey.couple_id = p_couple_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_JOURNEY_NOT_FOUND'
        USING ERRCODE = 'P0002';
    END IF;
    v_current_present := v_journey.progress ? v_progress_key;
    IF v_current_present IS DISTINCT FROM v_expected_present
       OR (
         v_expected_present
         AND v_journey.progress -> v_progress_key
             IS DISTINCT FROM p_domain_mutation -> 'expected'
       ) THEN
      v_effective_result := jsonb_build_object(
        'toolName', v_execution.tool_name,
        'toolOutput', jsonb_build_object(
          'error', 'domain_state_changed',
          'retryable', false
        ),
        'success', false,
        'displayMessage',
          '다른 일정 변경이 먼저 반영되어 이번 요청은 적용하지 않았어요. 현재 일정을 다시 확인해 주세요.'
      );
    ELSE
      UPDATE public.wedding_journeys
      SET progress = jsonb_set(
            progress,
            ARRAY[v_progress_key],
            p_domain_mutation -> 'value',
            true
          ),
          updated_at = now()
      WHERE couple_id = p_couple_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'AMORA_ATOMIC_TOOL_MUTATION_KIND_UNSUPPORTED'
      USING ERRCODE = '22023';
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

COMMIT;
