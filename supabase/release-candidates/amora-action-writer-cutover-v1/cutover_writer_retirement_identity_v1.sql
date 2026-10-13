-- 로컬 검증 후보: v2 설치 후 구 무버전 수정만 닫는다. 생성 계약은 유지한다.
-- hosted 적용 승인이 아니며, service-role 직접 UPDATE 경계는 별도 작업이다.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.mutate_own_amora_action(
  p_couple_id uuid, p_action_id text, p_operation text, p_values jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
SET lock_timeout = '5s' SET statement_timeout = '15s'
AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.lock_own_amora_action_couple(p_couple_id);
  IF p_action_id IS NULL OR p_action_id !~ '^[a-zA-Z0-9_-]{4,120}$'
     OR p_operation IS NULL OR p_operation NOT IN ('create','update') THEN
    RAISE EXCEPTION 'AMORA_ACTION_INVALID_INPUT' USING ERRCODE = '22023';
  END IF;
  PERFORM public.validate_manual_amora_action_values(p_values, p_operation = 'create');
  IF p_operation = 'update' THEN
    RAISE EXCEPTION 'AMORA_ACTION_UNVERSIONED_UPDATE_RETIRED' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.amora_actions AS action (
    id, couple_id, title, description, due_date, category_key,
    priority, status, source, href, created_by
  ) VALUES (
    p_action_id, p_couple_id, pg_catalog.btrim(p_values ->> 'title'),
    p_values ->> 'description', p_values ->> 'due_date', p_values ->> 'category_key',
    COALESCE(p_values ->> 'priority','medium'), COALESCE(p_values ->> 'status','open'),
    COALESCE(p_values ->> 'source','manual'), p_values ->> 'href', auth.uid()
  ) RETURNING pg_catalog.to_jsonb(action) INTO v_result;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_own_legacy_amora_action(
  p_couple_id uuid, p_journey_id uuid, p_action_id text,
  p_expected_revision bigint, p_values jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
SET lock_timeout = '5s' SET statement_timeout = '15s'
AS $function$
BEGIN
  PERFORM public.lock_own_amora_action_couple(p_couple_id);
  IF p_action_id IS NULL OR p_action_id !~ '^[a-zA-Z0-9_-]{4,120}$'
     OR p_expected_revision IS NULL OR p_expected_revision < 0 OR p_expected_revision >= 9007199254740991 THEN
    RAISE EXCEPTION 'AMORA_ACTION_INVALID_INPUT' USING ERRCODE = '22023';
  END IF;
  PERFORM public.validate_manual_amora_action_values(p_values, false);
  RAISE EXCEPTION 'AMORA_ACTION_UNVERSIONED_UPDATE_RETIRED' USING ERRCODE = '55000';
END;
$function$;

-- v2와 같은 식별자 잠금을 먼저 시도한다. AI 경로가 journey를 먼저 잡은 경우에도
-- 잠금 순서가 뒤집혀 대기하지 않도록 busy를 즉시 충돌로 닫는다.
CREATE FUNCTION public.guard_amora_action_insert_identity_cutover_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_progress jsonb; v_actions jsonb;
BEGIN
  IF NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(NEW.id,710041)) THEN
    RAISE EXCEPTION 'AMORA_ACTION_IDENTITY_BUSY' USING ERRCODE = '40001';
  END IF;
  -- INSERT 트리거는 ON CONFLICT의 UPDATE보다 먼저 실행된다. 기존 requestId는
  -- 그대로 23505이며, 무버전 upsert도 이 지점에서 UPDATE 없이 거절된다.
  IF EXISTS(SELECT 1 FROM public.amora_actions WHERE id = NEW.id) THEN
    RAISE EXCEPTION 'AMORA_ACTION_IDENTITY_EXISTS' USING ERRCODE = '23505';
  END IF;
  SELECT progress INTO v_progress FROM public.wedding_journeys
  WHERE couple_id = NEW.couple_id FOR UPDATE;
  -- 기존 no-journey 생성 호환을 유지한다. 행 부재에 대한 미래 journey INSERT나
  -- 별도 progress writer까지 보호했다는 의미는 아니며, 공동 writer 경계는 별도 승인이다.
  IF FOUND THEN
    IF pg_catalog.jsonb_typeof(v_progress) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'AMORA_ACTION_UNAVAILABLE' USING ERRCODE = '55000';
    END IF;
    IF v_progress ? '__amora_actions' THEN
      v_actions := v_progress -> '__amora_actions';
      IF pg_catalog.jsonb_typeof(v_actions) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'AMORA_ACTION_UNAVAILABLE' USING ERRCODE = '55000';
      END IF;
      IF EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(v_actions)
        WHERE value ->> 'id' = NEW.id) THEN
        RAISE EXCEPTION 'AMORA_ACTION_LEGACY_IDENTITY_CONFLICT' USING ERRCODE = '40001';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.guard_amora_action_insert_identity_cutover_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_amora_action_insert_identity_cutover_v1() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER guard_amora_action_insert_identity_cutover_v1
BEFORE INSERT ON public.amora_actions
FOR EACH ROW EXECUTE FUNCTION public.guard_amora_action_insert_identity_cutover_v1();

COMMIT;
