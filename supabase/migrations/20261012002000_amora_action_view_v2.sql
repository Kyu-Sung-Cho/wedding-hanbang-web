-- 정식 마이그레이션 검수 후보다. 운영에 적용되거나 승인된 릴리스가 아니다.
-- 기존 버전 없는 쓰기는 호환 유지하며 그 덮어쓰기 위험은 아직 남는다.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE FUNCTION public.advance_amora_action_view_token_v2()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $function$
BEGIN
  NEW.updated_at := GREATEST(pg_catalog.clock_timestamp(),OLD.updated_at + interval '1 microsecond');
  RETURN NEW;
END;
$function$;
ALTER FUNCTION public.advance_amora_action_view_token_v2() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.advance_amora_action_view_token_v2() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER set_amora_actions_updated_at ON public.amora_actions;
CREATE TRIGGER set_amora_actions_updated_at BEFORE UPDATE ON public.amora_actions
FOR EACH ROW EXECUTE FUNCTION public.advance_amora_action_view_token_v2();

CREATE FUNCTION public.patch_own_amora_action_view_v2(
  p_couple_id uuid, p_action_id text, p_expected_updated_at text, p_values jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
SET lock_timeout = '5s' SET statement_timeout = '15s'
AS $function$
DECLARE
  v_expected timestamptz; v_current timestamptz; v_result jsonb;
  v_canonical_before jsonb; v_canonical_expected jsonb; v_canonical_saved jsonb;
  v_expected_completed timestamptz; v_expected_dismissed timestamptz;
  v_journey_id uuid; v_progress jsonb; v_revision bigint; v_saved_revision bigint; v_actions jsonb;
  v_expected_progress jsonb; v_saved_progress jsonb;
  v_actual_progress jsonb; v_actual_revision bigint;
  v_item jsonb; v_updated jsonb; v_index integer; v_count integer; v_entry record; v_time_key text; v_href text;
BEGIN
  PERFORM public.lock_own_amora_action_couple(p_couple_id);
  IF p_action_id IS NULL OR p_action_id !~ '^[a-zA-Z0-9_-]{4,120}$'
     OR p_expected_updated_at IS NULL
     OR p_expected_updated_at !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' THEN
    RAISE EXCEPTION 'AMORA_ACTION_INVALID_INPUT' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_expected := p_expected_updated_at::timestamptz;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_time_zone_displacement_value THEN
    RAISE EXCEPTION 'AMORA_ACTION_INVALID_INPUT' USING ERRCODE = '22023';
  END;
  IF NOT pg_catalog.isfinite(v_expected) THEN
    RAISE EXCEPTION 'AMORA_ACTION_INVALID_INPUT' USING ERRCODE = '22023';
  END IF;
  PERFORM public.validate_manual_amora_action_values(p_values, false);
  -- v2만 내부 경로를 엄격히 검사한다. U+0000은 text/jsonb 입력 자체가 거절한다.
  v_href := p_values ->> 'href';
  IF v_href IS NOT NULL AND (pg_catalog.left(v_href,1)<>'/' OR pg_catalog.left(v_href,2)='//'
     OR pg_catalog.strpos(v_href,pg_catalog.chr(92))>0 OR pg_catalog.char_length(v_href)>180
     OR EXISTS (SELECT 1 FROM pg_catalog.generate_series(1,pg_catalog.char_length(v_href)) AS chars(pos)
       WHERE pg_catalog.ascii(pg_catalog.substr(v_href,chars.pos,1)) BETWEEN 1 AND 31
          OR pg_catalog.ascii(pg_catalog.substr(v_href,chars.pos,1))=127)) THEN
    RAISE EXCEPTION 'AMORA_ACTION_INVALID_INPUT' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_action_id,710041));
  SELECT id,progress,state_revision INTO v_journey_id,v_progress,v_revision
    FROM public.wedding_journeys WHERE couple_id=p_couple_id FOR UPDATE;
  SELECT action.updated_at,pg_catalog.to_jsonb(action) INTO v_current,v_canonical_before
    FROM public.amora_actions AS action WHERE id=p_action_id AND couple_id=p_couple_id FOR UPDATE;
  IF FOUND THEN
    IF v_current IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION 'AMORA_ACTION_CONFLICT' USING ERRCODE = '40001';
    END IF;
    v_canonical_expected := v_canonical_before;
    FOR v_entry IN SELECT key,value FROM pg_catalog.jsonb_each(p_values) LOOP
      v_canonical_expected := pg_catalog.jsonb_set(v_canonical_expected,ARRAY[v_entry.key],
        CASE WHEN v_entry.key='title' THEN pg_catalog.to_jsonb(pg_catalog.btrim(v_entry.value #>> '{}')) ELSE v_entry.value END);
    END LOOP;
    -- 잘못된 기존 링크는 명시 수리/삭제만 허용하고 untouched 재저장은 쓰기 전에 막는다.
    v_href := v_canonical_expected ->> 'href';
    IF v_href IS NOT NULL AND (pg_catalog.left(v_href,1)<>'/' OR pg_catalog.left(v_href,2)='//'
       OR pg_catalog.strpos(v_href,pg_catalog.chr(92))>0 OR pg_catalog.char_length(v_href)>180
       OR EXISTS (SELECT 1 FROM pg_catalog.generate_series(1,pg_catalog.char_length(v_href)) AS chars(pos)
         WHERE pg_catalog.ascii(pg_catalog.substr(v_href,chars.pos,1)) BETWEEN 1 AND 31
            OR pg_catalog.ascii(pg_catalog.substr(v_href,chars.pos,1))=127)) THEN
      RAISE EXCEPTION 'AMORA_ACTION_UNAVAILABLE' USING ERRCODE = '55000';
    END IF;
    -- 기존 상태 trigger의 정확한 전환만 허용한다. 과거 null 시각을 임의 수리하지 않는다.
    v_expected_completed := (v_canonical_before ->> 'completed_at')::timestamptz;
    v_expected_dismissed := (v_canonical_before ->> 'dismissed_at')::timestamptz;
    IF v_canonical_expected ->> 'status'='done' AND v_canonical_before ->> 'status' IS DISTINCT FROM 'done' THEN
      v_expected_completed := COALESCE(v_expected_completed,pg_catalog.now());
      v_expected_dismissed := NULL;
    ELSIF v_canonical_expected ->> 'status'='dismissed' AND v_canonical_before ->> 'status' IS DISTINCT FROM 'dismissed' THEN
      v_expected_dismissed := COALESCE(v_expected_dismissed,pg_catalog.now());
      v_expected_completed := NULL;
    ELSIF v_canonical_expected ->> 'status'='open' THEN
      v_expected_completed := NULL;
      v_expected_dismissed := NULL;
    END IF;
    -- 구 public update의 종료가 새 checked 경로를 함께 닫지 않게 독립 실행한다.
    -- scope/값/원문 버전은 위에서 검증했으며 실제 저장 행만 영수증으로 반환한다.
    UPDATE public.amora_actions AS action SET
      title=CASE WHEN p_values ? 'title' THEN pg_catalog.btrim(p_values ->> 'title') ELSE action.title END,
      description=CASE WHEN p_values ? 'description' THEN p_values ->> 'description' ELSE action.description END,
      due_date=CASE WHEN p_values ? 'due_date' THEN p_values ->> 'due_date' ELSE action.due_date END,
      category_key=CASE WHEN p_values ? 'category_key' THEN p_values ->> 'category_key' ELSE action.category_key END,
      priority=COALESCE(p_values ->> 'priority',action.priority),
      status=COALESCE(p_values ->> 'status',action.status),
      href=CASE WHEN p_values ? 'href' THEN p_values ->> 'href' ELSE action.href END
    WHERE action.id=p_action_id AND action.couple_id=p_couple_id AND action.updated_at=v_expected
    RETURNING pg_catalog.to_jsonb(action) INTO v_result;
    -- 즉시 AFTER의 후속 쓰기는 RETURNING의 바깥 행 snapshot에 반영되지 않는다.
    -- 같은 행 잠금을 유지하며 최종 row와 snapshot이 같을 때만 성공을 반환한다.
    SELECT pg_catalog.to_jsonb(action) INTO v_canonical_saved FROM public.amora_actions AS action
      WHERE action.id=p_action_id AND action.couple_id=p_couple_id FOR UPDATE;
    IF NOT FOUND OR v_canonical_saved IS DISTINCT FROM v_result THEN
      RAISE EXCEPTION 'AMORA_ACTION_UNAVAILABLE' USING ERRCODE = '55000';
    END IF;
    v_result := v_canonical_saved;
    IF pg_catalog.jsonb_typeof(v_result -> 'updated_at') IS DISTINCT FROM 'string'
       OR (v_result ->> 'updated_at') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' THEN
      RAISE EXCEPTION 'AMORA_ACTION_UNAVAILABLE' USING ERRCODE = '55000';
    END IF;
    IF NOT pg_catalog.isfinite((v_result ->> 'updated_at')::timestamptz)
       OR (v_result ->> 'updated_at')::timestamptz <= v_expected THEN
      RAISE EXCEPTION 'AMORA_ACTION_UNAVAILABLE' USING ERRCODE = '55000';
    END IF;
    -- 실제 영수증이더라도 승인값/소유권/출처를 trigger가 바꾸면 전체 롤백한다.
    -- 정본 trigger가 소유하는 세 시각 필드의 변경은 여기서 일괄 거절하지 않는다.
    IF (v_result - ARRAY['updated_at','completed_at','dismissed_at']) IS DISTINCT FROM
       (v_canonical_expected - ARRAY['updated_at','completed_at','dismissed_at']) THEN
      RAISE EXCEPTION 'AMORA_ACTION_UNAVAILABLE' USING ERRCODE = '55000';
    END IF;
    IF (v_result ->> 'completed_at')::timestamptz IS DISTINCT FROM v_expected_completed
       OR (v_result ->> 'dismissed_at')::timestamptz IS DISTINCT FROM v_expected_dismissed THEN
      RAISE EXCEPTION 'AMORA_ACTION_UNAVAILABLE' USING ERRCODE = '55000';
    END IF;
    RETURN v_result;
  END IF;
  IF v_journey_id IS NULL THEN RETURN NULL; END IF;
  IF pg_catalog.jsonb_typeof(v_progress) IS DISTINCT FROM 'object'
     OR v_revision IS NULL OR v_revision < 0 OR v_revision >= 9007199254740991 THEN
    RAISE EXCEPTION 'AMORA_ACTION_UNAVAILABLE' USING ERRCODE = '55000';
  END IF;
  v_actions := v_progress -> '__amora_actions';
  IF v_actions IS NULL THEN RETURN NULL; END IF;
  IF pg_catalog.jsonb_typeof(v_actions) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'AMORA_ACTION_UNAVAILABLE' USING ERRCODE = '55000';
  END IF;
  SELECT count(*)::integer INTO v_count FROM pg_catalog.jsonb_array_elements(v_actions)
    WHERE value ->> 'id'=p_action_id;
  IF v_count=0 THEN RETURN NULL; END IF;
  IF v_count<>1 THEN
    RAISE EXCEPTION 'AMORA_ACTION_UNAVAILABLE' USING ERRCODE = '55000';
  END IF;
  SELECT value,(ordinality-1)::integer INTO v_item,v_index
    FROM pg_catalog.jsonb_array_elements(v_actions) WITH ORDINALITY WHERE value ->> 'id'=p_action_id;
  IF pg_catalog.jsonb_typeof(v_item) IS DISTINCT FROM 'object'
     OR pg_catalog.jsonb_typeof(v_item -> 'id') IS DISTINCT FROM 'string'
     OR pg_catalog.jsonb_typeof(v_item -> 'title') IS DISTINCT FROM 'string'
     OR pg_catalog.char_length(pg_catalog.btrim(v_item ->> 'title')) NOT BETWEEN 1 AND 120
     OR pg_catalog.jsonb_typeof(v_item -> 'updatedAt') IS DISTINCT FROM 'string'
     OR (v_item ->> 'updatedAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' THEN
    RAISE EXCEPTION 'AMORA_ACTION_UNAVAILABLE' USING ERRCODE = '55000';
  END IF;
  BEGIN
    v_current := (v_item ->> 'updatedAt')::timestamptz;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_time_zone_displacement_value THEN
    RAISE EXCEPTION 'AMORA_ACTION_UNAVAILABLE' USING ERRCODE = '55000';
  END;
  IF NOT pg_catalog.isfinite(v_current) THEN
    RAISE EXCEPTION 'AMORA_ACTION_UNAVAILABLE' USING ERRCODE = '55000';
  END IF;
  IF v_current IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'AMORA_ACTION_CONFLICT' USING ERRCODE = '40001';
  END IF;
  v_updated := v_item;
  FOR v_entry IN SELECT key,value FROM pg_catalog.jsonb_each(p_values) LOOP
    v_updated := pg_catalog.jsonb_set(v_updated,ARRAY[CASE v_entry.key
      WHEN 'due_date' THEN 'dueDate' WHEN 'category_key' THEN 'categoryKey' ELSE v_entry.key END],
      CASE WHEN v_entry.key='title' THEN pg_catalog.to_jsonb(pg_catalog.btrim(v_entry.value #>> '{}')) ELSE v_entry.value END);
  END LOOP;
  v_updated := v_updated || pg_catalog.jsonb_build_object('updatedAt',
    GREATEST(pg_catalog.clock_timestamp(),v_current + interval '1 microsecond'));
  IF p_values ->> 'status'='done' THEN
    IF v_item ->> 'status' IS DISTINCT FROM 'done' THEN
      v_updated := v_updated || pg_catalog.jsonb_build_object('completedAt',pg_catalog.clock_timestamp());
    END IF;
    v_updated := v_updated - 'dismissedAt';
  ELSIF p_values ->> 'status'='dismissed' THEN
    IF v_item ->> 'status' IS DISTINCT FROM 'dismissed' THEN
      v_updated := v_updated || pg_catalog.jsonb_build_object('dismissedAt',pg_catalog.clock_timestamp());
    END IF;
    v_updated := v_updated - 'completedAt';
  ELSIF p_values ->> 'status'='open' THEN
    v_updated := v_updated - 'completedAt' - 'dismissedAt';
  END IF;
  v_href := v_updated ->> 'href';
  IF v_href IS NOT NULL AND (pg_catalog.left(v_href,1)<>'/' OR pg_catalog.left(v_href,2)='//'
     OR pg_catalog.strpos(v_href,pg_catalog.chr(92))>0 OR pg_catalog.char_length(v_href)>180
     OR EXISTS (SELECT 1 FROM pg_catalog.generate_series(1,pg_catalog.char_length(v_href)) AS chars(pos)
       WHERE pg_catalog.ascii(pg_catalog.substr(v_href,chars.pos,1)) BETWEEN 1 AND 31
          OR pg_catalog.ascii(pg_catalog.substr(v_href,chars.pos,1))=127)) THEN
    RAISE EXCEPTION 'AMORA_ACTION_UNAVAILABLE' USING ERRCODE = '55000';
  END IF;
  -- 과거의 불량 known 필드를 정상 저장 영수증으로 위장하지 않는다.
  -- caller가 명시적으로 수리한 칸은 검사하며 unknown 원문은 DB 안에 보존한다.
  BEGIN
    PERFORM public.validate_manual_amora_action_values(pg_catalog.jsonb_build_object(
      'title',v_updated -> 'title','description',v_updated -> 'description',
      'due_date',v_updated -> 'dueDate','category_key',v_updated -> 'categoryKey',
      'priority',v_updated -> 'priority','status',v_updated -> 'status',
      'source',v_updated -> 'source','href',v_updated -> 'href'),true);
  EXCEPTION WHEN invalid_parameter_value THEN
    RAISE EXCEPTION 'AMORA_ACTION_UNAVAILABLE' USING ERRCODE = '55000';
  END;
  FOREACH v_time_key IN ARRAY ARRAY['createdAt','updatedAt','completedAt','dismissedAt'] LOOP
    IF v_updated ? v_time_key AND pg_catalog.jsonb_typeof(v_updated -> v_time_key) IS DISTINCT FROM 'null' THEN
      IF pg_catalog.jsonb_typeof(v_updated -> v_time_key) IS DISTINCT FROM 'string'
         OR (v_updated ->> v_time_key) !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' THEN
        RAISE EXCEPTION 'AMORA_ACTION_UNAVAILABLE' USING ERRCODE = '55000';
      END IF;
      BEGIN
        v_current := (v_updated ->> v_time_key)::timestamptz;
      EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_time_zone_displacement_value THEN
        RAISE EXCEPTION 'AMORA_ACTION_UNAVAILABLE' USING ERRCODE = '55000';
      END;
      IF NOT pg_catalog.isfinite(v_current) THEN
        RAISE EXCEPTION 'AMORA_ACTION_UNAVAILABLE' USING ERRCODE = '55000';
      END IF;
    END IF;
  END LOOP;
  v_expected_progress := pg_catalog.jsonb_set(v_progress,ARRAY['__amora_actions',v_index::text],v_updated);
  UPDATE public.wedding_journeys SET progress=v_expected_progress
    WHERE id=v_journey_id AND couple_id=p_couple_id AND state_revision=v_revision
    RETURNING progress,state_revision INTO v_saved_progress,v_saved_revision;
  IF NOT FOUND OR v_saved_revision IS DISTINCT FROM v_revision+1
     OR v_saved_progress IS DISTINCT FROM v_expected_progress THEN
    RAISE EXCEPTION 'AMORA_ACTION_UNAVAILABLE' USING ERRCODE = '55000';
  END IF;
  SELECT progress,state_revision INTO v_actual_progress,v_actual_revision FROM public.wedding_journeys
    WHERE id=v_journey_id AND couple_id=p_couple_id FOR UPDATE;
  IF NOT FOUND OR v_actual_revision IS DISTINCT FROM v_saved_revision
     OR v_actual_progress IS DISTINCT FROM v_saved_progress THEN
    RAISE EXCEPTION 'AMORA_ACTION_UNAVAILABLE' USING ERRCODE = '55000';
  END IF;
  v_updated := v_actual_progress -> '__amora_actions' -> v_index;
  RETURN pg_catalog.jsonb_build_object(
    'id',p_action_id,'couple_id',p_couple_id,'title',v_updated -> 'title',
    'description',v_updated -> 'description','priority',v_updated -> 'priority',
    'status',v_updated -> 'status','source',v_updated -> 'source','href',v_updated -> 'href',
    'due_date',v_updated -> 'dueDate','category_key',v_updated -> 'categoryKey',
    'created_at',v_updated -> 'createdAt','updated_at',v_updated -> 'updatedAt',
    'completed_at',v_updated -> 'completedAt','dismissed_at',v_updated -> 'dismissedAt');
END;
$function$;

ALTER FUNCTION public.patch_own_amora_action_view_v2(uuid,text,text,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.patch_own_amora_action_view_v2(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.patch_own_amora_action_view_v2(uuid,text,text,jsonb) TO authenticated;
COMMIT;
