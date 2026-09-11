-- 승인된 예산 변경의 실제 delta와 결정 기록을 같은 거래에 남긴다.
-- 기존 승인 RPC/일정 영수증/포인터 제약은 변경하지 않는다. 과거 기록은 채우지 않는다.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.amora_shared_action_journey_mutation_receipts
  ADD COLUMN budget_delta jsonb;

COMMENT ON COLUMN public.amora_shared_action_journey_mutation_receipts.budget_delta IS
  '승인 예산 실행의 실제 OLD/NEW 금액 delta. NULL은 미캡처, 빈 categories와 totalBudget:null은 금액 변화 없음. 원문/지출/메모를 저장하지 않음.';

CREATE UNIQUE INDEX decision_nodes_shared_budget_action_unique
  ON public.decision_nodes(couple_id, source_ref_id)
  WHERE source = 'budget' AND metadata ->> 'origin' = 'amora_shared_budget_action';

CREATE FUNCTION public.capture_amora_shared_budget_delta()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_request text := NULLIF(current_setting('hanbang.amora_shared_action_request_key', true), '');
  v_operation text := NULLIF(current_setting('hanbang.amora_shared_action_operation_key', true), '');
  v_action text := NULLIF(current_setting('hanbang.amora_shared_action_action_id', true), '');
  v_couple text := NULLIF(current_setting('hanbang.amora_shared_action_couple_id', true), '');
  v_expected text := NULLIF(current_setting('hanbang.amora_shared_action_expected_revision', true), '');
  v_applied text := NULLIF(current_setting('hanbang.amora_shared_action_applied_revision', true), '');
  v_tool text;
  v_input jsonb;
  v_actor uuid;
  v_key text;
  v_target text;
  v_count integer;
  v_label text;
  v_before jsonb;
  v_after jsonb;
  v_categories jsonb := '[]'::jsonb;
  v_total jsonb := 'null'::jsonb;
  v_plan jsonb;
  v_delta jsonb;
  v_rows integer;
  v_labels constant jsonb := '{"greeting":"배우자 부모님께 첫인사","meeting":"부모님 첫 만남","venue":"결혼식장","studio":"웨딩 사진 촬영","dress":"드레스·예식 정장","makeup":"헤어·메이크업","ring":"결혼반지·기념 선물","hanbok":"한복","yedan":"예단","honeymoon":"신혼여행","houseware":"가전·가구·생활용품","housing":"신혼집","invitation":"종이·모바일 초대장","snap":"결혼식 날 사진·영상","shoes":"결혼식 신발","bouquet":"손에 드는 꽃·꽃 장식","gift":"결혼식에 온 분께 드릴 선물","mc":"결혼식 진행·축하 노래","ham":"가족에게 전하는 전통 혼례 선물","pyebaek":"폐백","registration":"혼인신고와 주소·보험 신고","reserve":"예비비·사용처 미정"}'::jsonb;
  v_ws constant text := U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+';
BEGIN
  -- 수동/개인/승인 없는 경로는 기존 정책을 그대로 따른다.
  IF v_request IS NULL AND v_operation IS NULL AND v_action IS NULL
     AND v_couple IS NULL AND v_expected IS NULL AND v_applied IS NULL THEN
    RETURN NEW;
  END IF;
  IF auth.role() IS DISTINCT FROM 'service_role'
     OR v_couple IS DISTINCT FROM NEW.couple_id::text
     OR OLD.couple_id IS DISTINCT FROM NEW.couple_id
     OR v_expected IS DISTINCT FROM OLD.state_revision::text
     OR v_applied IS DISTINCT FROM NEW.state_revision::text
     OR NEW.state_revision IS DISTINCT FROM OLD.state_revision + 1 THEN
    RAISE EXCEPTION 'AMORA_SHARED_BUDGET_DELTA_CONTEXT_INVALID' USING ERRCODE = '55000';
  END IF;

  -- 설정값 자체를 권한으로 삼지 않는다. 기존 승인 경계가 만든 실제 영수증과 소유자를 묶는다.
  SELECT e.tool_name, p.metadata #> '{pending_amora_action,input}', c.user_id
    INTO v_tool, v_input, v_actor
  FROM public.amora_tool_executions e
  JOIN public.amora_shared_action_journey_mutation_receipts r
    ON r.couple_id=e.couple_id AND r.request_key=e.request_key AND r.operation_key=e.operation_key
    AND r.action_id=e.pending_action_id AND r.expected_revision=OLD.state_revision
    AND r.applied_revision=NEW.state_revision
  JOIN public.amora_chat_request_claims c
    ON c.couple_id=e.couple_id AND c.request_key=e.request_key
    AND c.status='processing' AND c.visibility='shared' AND c.attempt_count=e.request_attempt_count
    AND c.user_message_id=r.confirmation_message_id
  JOIN public.chat_messages p ON p.id=r.source_message_id AND p.couple_id=e.couple_id
    AND p.sender_id IS NULL AND p.sender_type='ai' AND p.role='assistant' AND p.visibility='shared'
    AND COALESCE(p.metadata->>'target','') <> 'partner'
    AND p.metadata #>> '{pending_amora_action,actionId}'=e.pending_action_id::text
    AND p.metadata #>> '{pending_amora_action,tool}'=e.tool_name
    AND p.metadata #>> '{pending_amora_action,inputDigest}'=e.input_digest
    AND p.metadata #>> '{pending_amora_action,operationKey}'=e.operation_key
  JOIN public.chat_messages m ON m.id=r.confirmation_message_id AND m.couple_id=e.couple_id
    AND m.sender_id=c.user_id AND m.sender_type IN ('bride','groom') AND m.role='user' AND m.visibility='shared'
    AND COALESCE(m.metadata->>'target','') <> 'partner'
  WHERE e.couple_id=NEW.couple_id AND e.request_key=v_request AND e.operation_key=v_operation
    AND e.pending_action_id::text=v_action AND e.pending_action_journey_revision=OLD.state_revision
    AND e.status='processing' AND e.atomic_dispatch
    AND public.is_current_couple_member(c.user_id,e.couple_id);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_SHARED_BUDGET_DELTA_CONTEXT_INVALID' USING ERRCODE='55000';
  END IF;
  IF v_tool NOT IN ('update_budget','update_category_budget','add_custom_category','apply_budget_plan') THEN
    RETURN NEW;
  END IF;
  IF jsonb_typeof(v_input) IS DISTINCT FROM 'object'
     OR (v_tool='update_budget' AND OLD.progress IS DISTINCT FROM NEW.progress)
     OR (v_tool<>'update_budget' AND (
       jsonb_typeof(OLD.progress) IS DISTINCT FROM 'object'
       OR jsonb_typeof(NEW.progress) IS DISTINCT FROM 'object')) THEN
    RAISE EXCEPTION 'AMORA_SHARED_BUDGET_DELTA_INVALID' USING ERRCODE='22023';
  END IF;
  IF OLD.total_budget IS DISTINCT FROM NEW.total_budget THEN
    IF OLD.total_budget IS NULL OR NEW.total_budget IS NULL
       OR OLD.total_budget NOT BETWEEN 0 AND 1000000000
       OR NEW.total_budget NOT BETWEEN 0 AND 1000000000
       OR v_tool NOT IN ('update_budget','apply_budget_plan')
       OR jsonb_typeof(v_input->'total_budget') IS DISTINCT FROM 'number'
       OR v_input->'total_budget' IS DISTINCT FROM to_jsonb(NEW.total_budget) THEN
      RAISE EXCEPTION 'AMORA_SHARED_BUDGET_DELTA_INVALID' USING ERRCODE='22023';
    END IF;
    v_total := jsonb_build_object('before',OLD.total_budget,'after',NEW.total_budget);
  END IF;

  FOR v_key IN
    -- 총액만 변경하는 기존 RPC는 NULL progress도 보존한다. 이를 빈 객체로 저장하지 않는다.
    SELECT key FROM jsonb_object_keys(CASE WHEN v_tool='update_budget' THEN '{}'::jsonb
      ELSE OLD.progress || NEW.progress END) AS k(key)
    WHERE left(key,2) <> '__'
    ORDER BY key
  LOOP
    v_before := OLD.progress #> ARRAY[v_key,'budget'];
    v_after := NEW.progress #> ARRAY[v_key,'budget'];
    IF v_before IS NOT DISTINCT FROM v_after THEN CONTINUE; END IF;
    -- 명시 null과 키 없음은 모두 이전 배정액이 없는 상태이며 0원과 구별한다.
    v_before := NULLIF(v_before,'null'::jsonb);
    IF char_length(v_key) NOT BETWEEN 1 AND 120
       OR (NOT(v_labels ? v_key) AND left(v_key,7) <> 'custom_')
       OR (v_before IS NOT NULL AND (jsonb_typeof(v_before) IS DISTINCT FROM 'number'))
       OR jsonb_typeof(v_after) IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'AMORA_SHARED_BUDGET_DELTA_INVALID' USING ERRCODE='22023';
    END IF;
    IF (v_before IS NOT NULL AND ((v_before #>> '{}')::numeric NOT BETWEEN 0 AND 1000000000
          OR trunc((v_before #>> '{}')::numeric) <> (v_before #>> '{}')::numeric))
       OR (v_after #>> '{}')::numeric NOT BETWEEN 0 AND 1000000000
       OR trunc((v_after #>> '{}')::numeric) <> (v_after #>> '{}')::numeric THEN
      RAISE EXCEPTION 'AMORA_SHARED_BUDGET_DELTA_INVALID' USING ERRCODE='22023';
    END IF;
    v_label := CASE WHEN v_labels ? v_key THEN v_labels->>v_key ELSE NEW.progress #>> ARRAY[v_key,'label'] END;
    IF v_label IS NULL OR char_length(btrim(v_label)) NOT BETWEEN 1 AND 60 THEN
      RAISE EXCEPTION 'AMORA_SHARED_BUDGET_DELTA_INVALID' USING ERRCODE='22023';
    END IF;
    v_categories := v_categories || jsonb_build_array(jsonb_build_object(
      'key',v_key,'label',v_label,'beforeBudget',v_before,'afterBudget',v_after));
  END LOOP;
  IF jsonb_array_length(v_categories) > 21 THEN
    RAISE EXCEPTION 'AMORA_SHARED_BUDGET_DELTA_INVALID' USING ERRCODE='22023';
  END IF;

  IF v_tool='update_budget' THEN
    IF jsonb_array_length(v_categories) <> 0
       OR jsonb_typeof(v_input->'total_budget') IS DISTINCT FROM 'number'
       OR v_input->'total_budget' IS DISTINCT FROM to_jsonb(NEW.total_budget) THEN
      RAISE EXCEPTION 'AMORA_SHARED_BUDGET_DELTA_INVALID' USING ERRCODE='22023';
    END IF;
  ELSIF v_tool IN ('update_category_budget','add_custom_category') THEN
    IF v_total <> 'null'::jsonb THEN
      RAISE EXCEPTION 'AMORA_SHARED_BUDGET_DELTA_INVALID' USING ERRCODE='22023';
    END IF;
    IF v_tool='update_category_budget' THEN
      v_target := v_input->>'category';
      IF NOT COALESCE(v_labels ? v_target,false) THEN
        RAISE EXCEPTION 'AMORA_SHARED_BUDGET_DELTA_INVALID' USING ERRCODE='22023';
      END IF;
    ELSE
      SELECT count(*)::integer,min(key) INTO v_count,v_target FROM jsonb_each(NEW.progress)
      WHERE left(key,7)='custom_' AND jsonb_typeof(value)='object'
        AND lower(btrim(regexp_replace(value->>'label',v_ws,' ','g')))
          = lower(btrim(regexp_replace(v_input->>'label',v_ws,' ','g')));
      IF v_count <> 1 THEN
        RAISE EXCEPTION 'AMORA_SHARED_BUDGET_DELTA_INVALID' USING ERRCODE='22023';
      END IF;
    END IF;
    IF v_input ? 'budget' THEN
      IF jsonb_typeof(v_input->'budget') IS DISTINCT FROM 'number'
         OR v_input->'budget' IS DISTINCT FROM NEW.progress #> ARRAY[v_target,'budget']
         OR jsonb_array_length(v_categories)>1
         OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_categories) x WHERE x->>'key' <> v_target) THEN
        RAISE EXCEPTION 'AMORA_SHARED_BUDGET_DELTA_INVALID' USING ERRCODE='22023';
      END IF;
    ELSIF jsonb_array_length(v_categories) <> 0 THEN
      RAISE EXCEPTION 'AMORA_SHARED_BUDGET_DELTA_INVALID' USING ERRCODE='22023';
    END IF;
  ELSE
    v_plan := public.amora_resolve_budget_plan_allocations(NEW.couple_id,OLD.progress,v_input->'allocations');
    IF jsonb_typeof(v_input->'total_budget') IS DISTINCT FROM 'number'
       OR v_input->'total_budget' IS DISTINCT FROM to_jsonb(NEW.total_budget)
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_categories) x
         WHERE x->>'key' <> 'reserve' AND NOT EXISTS(
           SELECT 1 FROM jsonb_array_elements(v_plan) p
           WHERE p->>'category'=x->>'key' AND p->'budget'=x->'afterBudget')) THEN
      RAISE EXCEPTION 'AMORA_SHARED_BUDGET_DELTA_INVALID' USING ERRCODE='22023';
    END IF;
  END IF;

  v_delta := jsonb_build_object('schemaVersion',1,'totalBudget',v_total,'categories',v_categories);
  UPDATE public.amora_shared_action_journey_mutation_receipts
  SET budget_delta=v_delta
  WHERE couple_id=NEW.couple_id AND request_key=v_request AND operation_key=v_operation
    AND action_id::text=v_action AND expected_revision=OLD.state_revision
    AND applied_revision=NEW.state_revision AND budget_delta IS NULL;
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'AMORA_SHARED_BUDGET_DELTA_CONTEXT_INVALID' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION public.record_amora_shared_budget_decision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_receipt public.amora_shared_action_journey_mutation_receipts%ROWTYPE;
  v_delta jsonb;
  v_output jsonb;
  v_input jsonb;
  v_actor_role text;
  v_confirmed_at timestamptz;
  v_progress jsonb;
  v_total numeric;
  v_scope text;
  v_title text;
  v_value text;
  v_amount jsonb;
  v_categories jsonb;
  v_item jsonb;
  v_key text;
  v_recorded_at timestamptz := clock_timestamp();
BEGIN
  IF OLD.status='completed' OR NEW.status IS DISTINCT FROM 'completed'
     OR NEW.tool_name NOT IN ('update_budget','update_category_budget','add_custom_category','apply_budget_plan')
     OR NEW.result->'success' IS DISTINCT FROM 'true'::jsonb THEN RETURN NEW; END IF;
  -- 승인 없는 실행은 이 영수증의 대상이 아니다. 기존 실행 권한은 기존 트리거가 검증한다.
  IF NEW.pending_action_id IS NULL THEN RETURN NEW; END IF;
  IF auth.role() IS DISTINCT FROM 'service_role' OR NOT NEW.atomic_dispatch
     OR NEW.pending_action_journey_revision IS NULL
     OR NEW.result->>'toolName' IS DISTINCT FROM NEW.tool_name
     OR jsonb_typeof(NEW.result->'toolOutput') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'AMORA_SHARED_BUDGET_DECISION_CONTEXT_INVALID' USING ERRCODE='55000';
  END IF;
  SELECT r.* INTO v_receipt
  FROM public.amora_shared_action_journey_mutation_receipts r
  WHERE r.couple_id=NEW.couple_id AND r.request_key=NEW.request_key AND r.operation_key=NEW.operation_key
    AND r.action_id=NEW.pending_action_id AND r.expected_revision=NEW.pending_action_journey_revision
    AND r.applied_revision=NEW.pending_action_journey_revision+1
  FOR UPDATE;
  IF NOT FOUND OR v_receipt.budget_delta IS NULL THEN
    RAISE EXCEPTION 'AMORA_SHARED_BUDGET_DECISION_DELTA_MISSING' USING ERRCODE='55000';
  END IF;
  SELECT m.sender_type,m.created_at,p.metadata #> '{pending_amora_action,input}',j.progress,j.total_budget
    INTO v_actor_role,v_confirmed_at,v_input,v_progress,v_total
  FROM public.amora_chat_request_claims c
  JOIN public.chat_messages m ON m.id=v_receipt.confirmation_message_id AND m.couple_id=c.couple_id
    AND m.id=c.user_message_id AND m.sender_id=c.user_id AND m.sender_type IN ('bride','groom')
    AND m.role='user' AND m.visibility='shared' AND COALESCE(m.metadata->>'target','') <> 'partner'
  JOIN public.chat_messages p ON p.id=v_receipt.source_message_id AND p.couple_id=c.couple_id
    AND p.sender_id IS NULL AND p.sender_type='ai' AND p.role='assistant' AND p.visibility='shared'
    AND p.metadata #>> '{pending_amora_action,actionId}'=NEW.pending_action_id::text
    AND p.metadata #>> '{pending_amora_action,operationKey}'=NEW.operation_key
    AND p.metadata #>> '{pending_amora_action,inputDigest}'=NEW.input_digest
    AND p.metadata #>> '{pending_amora_action,tool}'=NEW.tool_name
  JOIN public.wedding_journeys j ON j.couple_id=c.couple_id AND j.state_revision=v_receipt.applied_revision
  WHERE c.couple_id=NEW.couple_id AND c.request_key=NEW.request_key AND c.visibility='shared'
    AND c.status='processing' AND c.attempt_count=NEW.request_attempt_count
    AND public.is_current_couple_member(c.user_id,c.couple_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_SHARED_BUDGET_DECISION_CONTEXT_INVALID' USING ERRCODE='55000';
  END IF;
  v_delta:=v_receipt.budget_delta;
  v_output:=NEW.result->'toolOutput';
  IF jsonb_typeof(v_delta) IS DISTINCT FROM 'object'
     OR v_delta-ARRAY['schemaVersion','totalBudget','categories'] <> '{}'::jsonb
     OR v_delta->'schemaVersion' IS DISTINCT FROM '1'::jsonb
     OR NOT(v_delta ?& ARRAY['totalBudget','categories'])
     OR jsonb_typeof(v_delta->'categories') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'AMORA_SHARED_BUDGET_DECISION_DELTA_INVALID' USING ERRCODE='22023';
  END IF;
  v_categories:=v_delta->'categories';
  IF jsonb_array_length(v_categories)>21
     OR (v_delta->'totalBudget' <> 'null'::jsonb AND (
       jsonb_typeof(v_delta#>'{totalBudget,before}') IS DISTINCT FROM 'number'
       OR v_delta#>'{totalBudget,after}' IS DISTINCT FROM to_jsonb(v_total))) THEN
    RAISE EXCEPTION 'AMORA_SHARED_BUDGET_DECISION_DELTA_INVALID' USING ERRCODE='22023';
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_categories) LOOP
    v_key:=v_item->>'key';
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object'
       OR v_item-ARRAY['key','label','beforeBudget','afterBudget'] <> '{}'::jsonb
       OR NOT(v_item ?& ARRAY['key','label','beforeBudget','afterBudget'])
       OR jsonb_typeof(v_item->'key') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_item->'label') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_item->'afterBudget') IS DISTINCT FROM 'number'
       OR (v_item->'beforeBudget' <> 'null'::jsonb AND jsonb_typeof(v_item->'beforeBudget') IS DISTINCT FROM 'number')
       OR v_item->'afterBudget' IS DISTINCT FROM v_progress#>ARRAY[v_key,'budget']
       OR v_item->'beforeBudget' IS NOT DISTINCT FROM v_item->'afterBudget'
       OR (SELECT count(*) FROM jsonb_array_elements(v_categories) x WHERE x->>'key'=v_key) <> 1 THEN
      RAISE EXCEPTION 'AMORA_SHARED_BUDGET_DECISION_DELTA_INVALID' USING ERRCODE='22023';
    END IF;
  END LOOP;

  IF NEW.tool_name='update_budget' THEN
    v_scope:='total';
    IF jsonb_array_length(v_categories) <> 0
       OR v_output->'total_budget' IS DISTINCT FROM to_jsonb(v_total)
       OR v_input->'total_budget' IS DISTINCT FROM to_jsonb(v_total)
       OR (v_delta->'totalBudget'<>'null'::jsonb AND
         v_output->'previous_budget' IS DISTINCT FROM v_delta#>'{totalBudget,before}') THEN
      RAISE EXCEPTION 'AMORA_SHARED_BUDGET_DECISION_RESULT_INVALID' USING ERRCODE='22023';
    END IF;
    v_amount:=to_jsonb(v_total);
    v_title:='총예산 '||to_char(v_total,'FM999,999,999,990')||'원 반영';
  ELSIF NEW.tool_name IN ('update_category_budget','add_custom_category') THEN
    v_scope:='category';
    v_key:=v_output->>'progress_key';
    IF jsonb_typeof(v_output->'progress_key') IS DISTINCT FROM 'string'
       OR v_output->'progress_value' IS DISTINCT FROM v_progress->v_key
       OR v_delta->'totalBudget'<>'null'::jsonb
       OR jsonb_array_length(v_categories)>1
       OR (v_input ? 'budget' AND v_input->'budget' IS DISTINCT FROM v_progress#>ARRAY[v_key,'budget'])
       OR (NOT(v_input ? 'budget') AND jsonb_array_length(v_categories)<>0)
       OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_categories) x WHERE x->>'key' <> v_key) THEN
      RAISE EXCEPTION 'AMORA_SHARED_BUDGET_DECISION_RESULT_INVALID' USING ERRCODE='22023';
    END IF;
    v_amount:=v_progress#>ARRAY[v_key,'budget'];
    v_title:=(v_categories->0->>'label')||' 예산 '||to_char((v_amount#>>'{}')::numeric,'FM999,999,999,990')||'원 반영';
  ELSE
    v_scope:='allocation';
    IF v_output->'total_budget' IS DISTINCT FROM to_jsonb(v_total)
       OR v_input->'total_budget' IS DISTINCT FROM to_jsonb(v_total)
       OR jsonb_typeof(v_output->'allocations') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'AMORA_SHARED_BUDGET_DECISION_RESULT_INVALID' USING ERRCODE='22023';
    END IF;
    IF jsonb_array_length(v_output->'allocations') NOT BETWEEN 1 AND 21
       OR v_output->'applied_count' IS DISTINCT FROM to_jsonb(jsonb_array_length(v_output->'allocations'))
       OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_output->'allocations') x
         WHERE jsonb_typeof(x->'category') IS DISTINCT FROM 'string'
           OR x->'budget' IS DISTINCT FROM v_progress#>ARRAY[x->>'category','budget']
           OR (SELECT count(*) FROM jsonb_array_elements(v_output->'allocations') y WHERE y->>'category'=x->>'category') <> 1)
       OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_categories) x
         WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_output->'allocations') y
           WHERE y->>'category'=x->>'key' AND y->'budget'=x->'afterBudget')) THEN
      RAISE EXCEPTION 'AMORA_SHARED_BUDGET_DECISION_RESULT_INVALID' USING ERRCODE='22023';
    END IF;
    v_title:='총예산 '||to_char(v_total,'FM999,999,999,990')||'원 기준 예산 배분 반영';
  END IF;
  -- 검증된 빈 delta는 지출만 변경한 경우 등이다. 추측하여 예산 결정을 만들지 않는다.
  IF v_delta->'totalBudget'='null'::jsonb AND jsonb_array_length(v_categories)=0 THEN RETURN NEW; END IF;
  v_value:=v_title;
  IF v_scope='allocation' AND jsonb_array_length(v_categories)>0 THEN
    SELECT v_title||': '||string_agg(
      (item->>'label')||' '||to_char((item->>'afterBudget')::numeric,'FM999,999,999,990')||'원',
      ', ' ORDER BY item->>'key') INTO v_value
    FROM jsonb_array_elements(v_categories) AS categories(item);
  END IF;

  INSERT INTO public.decision_nodes(
    couple_id,category,decision_type,title,chosen_value,options_considered,reasoning,confidence,
    decided_at,source,source_ref_id,source_message_id,source_actor_role,user_confirmed_at,metadata,visibility,
    created_at,updated_at
  ) VALUES (
    NEW.couple_id,'budget','decided',v_title,
    jsonb_build_object('schemaVersion',1,'budgetScope',v_scope,
      'snapshotRevision',v_receipt.applied_revision,'budgetDelta',v_delta,'value',v_value)
      || CASE WHEN v_scope='category' THEN jsonb_build_object('categoryKey',v_key,'amount',v_amount)
              WHEN v_scope='total' THEN jsonb_build_object('amount',v_amount)
              ELSE '{}'::jsonb END,
    '[]'::jsonb,'승인한 구성원의 예산 배정 변경'
      || CASE WHEN v_scope='allocation' THEN '. '||v_value ELSE '' END,
    1.00,v_recorded_at,'budget',
    NEW.pending_action_id,v_receipt.confirmation_message_id,v_actor_role,v_confirmed_at,
    jsonb_build_object('origin','amora_shared_budget_action','actionId',NEW.pending_action_id,
      'proposalMessageId',v_receipt.source_message_id,'confirmationMessageId',v_receipt.confirmation_message_id,
      'requestKey',NEW.request_key,'operationKey',NEW.operation_key),
    'shared',v_recorded_at,v_recorded_at
  );
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.capture_amora_shared_budget_delta() OWNER TO postgres;
ALTER FUNCTION public.record_amora_shared_budget_decision() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.capture_amora_shared_budget_delta() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.record_amora_shared_budget_decision() FROM PUBLIC,anon,authenticated,service_role;

CREATE TRIGGER trg_capture_amora_shared_budget_delta
  AFTER UPDATE ON public.wedding_journeys
  FOR EACH ROW EXECUTE FUNCTION public.capture_amora_shared_budget_delta();
CREATE TRIGGER trg_record_amora_shared_budget_decision
  AFTER UPDATE OF status ON public.amora_tool_executions
  FOR EACH ROW EXECUTE FUNCTION public.record_amora_shared_budget_decision();

DO $postcheck$
BEGIN
  IF (SELECT count(*) FROM pg_trigger WHERE
    (tgrelid='public.wedding_journeys'::regclass AND tgname='trg_capture_amora_shared_budget_delta'
      OR tgrelid='public.amora_tool_executions'::regclass AND tgname='trg_record_amora_shared_budget_decision')
    AND tgenabled='O' AND NOT tgisinternal) <> 2
    OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ('capture_amora_shared_budget_delta','record_amora_shared_budget_decision')
        AND (NOT p.prosecdef OR pg_get_userbyid(p.proowner)<>'postgres'
          OR has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE')
          OR has_function_privilege('service_role',p.oid,'EXECUTE'))) THEN
    RAISE EXCEPTION 'AMORA_SHARED_BUDGET_DECISION_POSTCHECK_FAILED';
  END IF;
END;
$postcheck$;
COMMIT;
