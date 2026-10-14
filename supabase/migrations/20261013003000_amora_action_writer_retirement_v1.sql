-- 정식 마이그레이션 검수 후보: Amora old writer retirement + identity boundary + non-retrying conflict transport. 운영에 적용되거나 승인된 릴리스가 아니다.
BEGIN;
-- Frozen companion supabase/release-candidates/amora-action-writer-cutover-v1/cutover_writer_retirement_identity_v1.sql SHA256 25b78629def538a85e13848df70f5e9142df8469f5ee75aa1096dfb1183ef2ca
-- 로컬 검증 후보: v2 설치 후 구 무버전 수정만 닫는다. 생성 계약은 유지한다.
-- hosted 적용 승인이 아니며, service-role 직접 UPDATE 경계는 별도 작업이다.
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


-- Frozen companion supabase/release-candidates/amora-action-writer-retirement-v1/retirement_service_writers_v1.sql SHA256 56edb08862ce7e178a35a357abd323954a8b35debd1fe8f2c0906aa51b6588d4
-- 로컬 companion 후보: e313 v2 및 25b786 최소 identity cutover 설치 후 사용한다.
-- 정상 owner SECURITY DEFINER 수동/승인 dispatcher 계약은 변경하지 않는다.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

REVOKE UPDATE ON TABLE public.amora_actions FROM service_role;

CREATE OR REPLACE FUNCTION public.apply_journey_progress_patch(
  p_couple_id uuid,
  p_patch jsonb DEFAULT '{}'::jsonb,
  p_remove_keys text[] DEFAULT '{}'::text[]
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE v_progress jsonb;
BEGIN
  IF p_patch ? '__amora_actions'
     OR '__amora_actions' = ANY(coalesce(p_remove_keys,'{}'::text[])) THEN
    RAISE EXCEPTION 'AMORA_ACTION_GENERIC_WRITER_RETIRED' USING ERRCODE = '55000';
  END IF;
  UPDATE wedding_journeys
     SET progress = (coalesce(progress, '{}'::jsonb) - p_remove_keys) || coalesce(p_patch, '{}'::jsonb),
         updated_at = now()
   WHERE couple_id = p_couple_id
   RETURNING progress INTO v_progress;
  IF v_progress IS NULL THEN
    RAISE EXCEPTION 'wedding_journeys row not found for couple_id=%', p_couple_id
      USING ERRCODE = 'no_data_found';
  END IF;
  RETURN v_progress;
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_journey_progress_item_patch(
  p_couple_id uuid,
  p_item_key text,
  p_item_patch jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $function$
DECLARE v_item jsonb;
BEGIN
  IF p_item_key IS NULL OR btrim(p_item_key) = '' THEN
    RAISE EXCEPTION 'progress item key is required' USING ERRCODE = '22023';
  END IF;
  IF p_item_patch IS NULL OR jsonb_typeof(p_item_patch) <> 'object' THEN
    RAISE EXCEPTION 'progress item patch must be a JSON object' USING ERRCODE = '22023';
  END IF;
  IF p_item_key = '__amora_actions' THEN
    RAISE EXCEPTION 'AMORA_ACTION_GENERIC_WRITER_RETIRED' USING ERRCODE = '55000';
  END IF;
  UPDATE public.wedding_journeys
     SET progress = jsonb_set(
       coalesce(progress, '{}'::jsonb),array[p_item_key],
       (CASE
          WHEN jsonb_typeof(coalesce(progress, '{}'::jsonb) -> p_item_key) = 'object'
            THEN coalesce(progress, '{}'::jsonb) -> p_item_key
          ELSE '{}'::jsonb
        END) || p_item_patch,true
     ),updated_at = now()
   WHERE couple_id = p_couple_id
   RETURNING progress -> p_item_key INTO v_item;
  IF v_item IS NULL THEN
    RAISE EXCEPTION 'wedding_journeys row not found for couple_id=%', p_couple_id USING ERRCODE = 'P0002';
  END IF;
  RETURN v_item;
END;
$function$;


-- Frozen companion supabase/release-candidates/amora-action-writer-retirement-v1/retirement_reserved_plan_writers_v1.sql SHA256 20138aab7a821c4e6ddc105b3a480160942800c389157afd500efccc91d2380d
-- 로컬 companion 후보: 실제 기존 plan-lane 함수가 설치된 schema에만 적용한다.
-- 새 action 승인/lock/GUC를 만들지 않고 일반 plan의 예약 action 입력만 닫는다.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $guard$
BEGIN
  IF pg_catalog.to_regprocedure('public.normalize_couple_plan_changes(jsonb)') IS NULL
     OR pg_catalog.to_regprocedure('public.apply_couple_plan_change_locked(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'AMORA_ACTION_PLAN_LANE_BASELINE_UNAVAILABLE' USING ERRCODE = '55000';
  END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.normalize_couple_plan_changes(
  p_changes jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_result jsonb := '{}'::jsonb;
  v_text text;
  v_date date;
  v_budget bigint;
  v_remove_keys jsonb;
  v_item_count integer;
BEGIN
  -- 신규 일반 준비정보 변경에서 action-view 승인 경계를 우회하지 않는다.
  IF (p_changes -> 'progress_patch') ? '__amora_actions'
     OR (p_changes -> 'progress_remove_keys') ? '__amora_actions' THEN
    RAISE EXCEPTION 'AMORA_ACTION_RESERVED_PLAN_WRITER_RETIRED' USING ERRCODE = '55000';
  END IF;
  IF p_changes IS NULL
     OR jsonb_typeof(p_changes) IS DISTINCT FROM 'object'
     OR p_changes = '{}'::jsonb
     OR p_changes - ARRAY[
       'wedding_date',
       'venue',
       'total_budget',
       'progress_patch',
       'progress_remove_keys'
     ] <> '{}'::jsonb
     OR octet_length(p_changes::text) > 131072 THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_INPUT'
      USING ERRCODE = '22023';
  END IF;

  IF p_changes ? 'wedding_date' THEN
    IF jsonb_typeof(p_changes -> 'wedding_date') = 'null' THEN
      v_result := v_result || jsonb_build_object('wedding_date', NULL);
    ELSIF jsonb_typeof(p_changes -> 'wedding_date') = 'string' THEN
      v_text := p_changes ->> 'wedding_date';
      IF v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
        RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_INPUT'
          USING ERRCODE = '22023';
      END IF;
      BEGIN
        v_date := v_text::date;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_INPUT'
          USING ERRCODE = '22023';
      END;
      IF to_char(v_date, 'YYYY-MM-DD') IS DISTINCT FROM v_text THEN
        RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_INPUT'
          USING ERRCODE = '22023';
      END IF;
      v_result := v_result || jsonb_build_object('wedding_date', v_text);
    ELSE
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_INPUT'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_changes ? 'venue' THEN
    IF jsonb_typeof(p_changes -> 'venue') = 'null' THEN
      v_result := v_result || jsonb_build_object('venue', NULL);
    ELSIF jsonb_typeof(p_changes -> 'venue') = 'string' THEN
      v_text := p_changes ->> 'venue';
      IF char_length(v_text) NOT BETWEEN 1 AND 120
         OR v_text IS DISTINCT FROM btrim(v_text)
         OR public.couple_plan_change_has_unsafe_display_text(v_text) THEN
        RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_INPUT'
          USING ERRCODE = '22023';
      END IF;
      v_result := v_result || jsonb_build_object('venue', v_text);
    ELSE
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_INPUT'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_changes ? 'total_budget' THEN
    IF jsonb_typeof(p_changes -> 'total_budget') = 'null' THEN
      v_result := v_result || jsonb_build_object('total_budget', NULL);
    ELSIF jsonb_typeof(p_changes -> 'total_budget') = 'number' THEN
      v_text := p_changes ->> 'total_budget';
      IF v_text !~ '^(0|[1-9][0-9]{0,9})$' THEN
        RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_INPUT'
          USING ERRCODE = '22023';
      END IF;
      v_budget := v_text::bigint;
      IF v_budget > 1000000000 THEN
        RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_INPUT'
          USING ERRCODE = '22023';
      END IF;
      v_result := v_result || jsonb_build_object('total_budget', v_budget);
    ELSE
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_INPUT'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_changes ? 'progress_patch' THEN
    IF jsonb_typeof(p_changes -> 'progress_patch') IS DISTINCT FROM 'object'
       OR octet_length((p_changes -> 'progress_patch')::text) > 131072 THEN
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_INPUT'
        USING ERRCODE = '22023';
    END IF;
    SELECT count(*)::integer
      INTO v_item_count
    FROM jsonb_object_keys(p_changes -> 'progress_patch');
    IF v_item_count > 300
       OR EXISTS (
         SELECT 1
         FROM jsonb_object_keys(p_changes -> 'progress_patch') AS item(key)
         WHERE item.key !~ '^[a-zA-Z0-9_.:-]{1,80}$'
       ) THEN
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_INPUT'
        USING ERRCODE = '22023';
    END IF;
    v_result := v_result
      || jsonb_build_object('progress_patch', p_changes -> 'progress_patch');
  END IF;

  IF p_changes ? 'progress_remove_keys' THEN
    IF jsonb_typeof(p_changes -> 'progress_remove_keys')
         IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_changes -> 'progress_remove_keys') > 50
       OR EXISTS (
         SELECT 1
         FROM jsonb_array_elements(
           p_changes -> 'progress_remove_keys'
         ) AS item(value)
         WHERE jsonb_typeof(item.value) IS DISTINCT FROM 'string'
       ) THEN
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_INPUT'
        USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(
             jsonb_agg(to_jsonb(keys.key) ORDER BY keys.key),
             '[]'::jsonb
           )
      INTO v_remove_keys
    FROM (
      SELECT item.value #>> '{}' AS key
      FROM jsonb_array_elements(
        p_changes -> 'progress_remove_keys'
      ) AS item(value)
      GROUP BY item.value #>> '{}'
    ) AS keys;

    IF jsonb_array_length(v_remove_keys)
         IS DISTINCT FROM jsonb_array_length(
           p_changes -> 'progress_remove_keys'
         )
       OR EXISTS (
         SELECT 1
         FROM jsonb_array_elements_text(v_remove_keys) AS item(key)
         WHERE item.key !~ '^[a-zA-Z0-9_.:-]{1,80}$'
       )
       OR (
         p_changes ? 'progress_patch'
         AND EXISTS (
           SELECT 1
           FROM jsonb_object_keys(
             p_changes -> 'progress_patch'
           ) AS patched(key)
           WHERE v_remove_keys ? patched.key
         )
       ) THEN
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_INPUT'
        USING ERRCODE = '22023';
    END IF;
    v_result := v_result
      || jsonb_build_object('progress_remove_keys', v_remove_keys);
  END IF;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_couple_plan_change_locked(
  p_request_id uuid,
  p_apply_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_request public.couple_plan_change_requests%ROWTYPE;
  v_journey public.wedding_journeys%ROWTYPE;
  v_raw_bride_id uuid;
  v_raw_groom_id uuid;
  v_bride_id uuid;
  v_groom_id uuid;
  v_recipient_user_id uuid;
  v_roster_fingerprint text;
  v_accepted_count integer;
  v_remove_keys text[];
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_SCOPE_DENIED'
      USING ERRCODE = '42501';
  END IF;

  SELECT request.*
    INTO v_request
  FROM public.couple_plan_change_requests AS request
  WHERE request.id = p_request_id;

  IF NOT FOUND OR v_request.status <> 'applying' THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_CONFLICT'
      USING ERRCODE = '40001';
  END IF;

  -- 이전에 승인 대기로 남긴 일반 plan도 예약 action 값을 쓰기 전에 재검증한다.
  PERFORM public.normalize_couple_plan_changes(v_request.changes);

  SELECT couple.bride_id, couple.groom_id
    INTO v_raw_bride_id, v_raw_groom_id
  FROM public.couples AS couple
  WHERE couple.id = v_request.couple_id;

  v_bride_id := CASE
    WHEN public.is_current_couple_member(
      v_raw_bride_id, v_request.couple_id
    ) THEN v_raw_bride_id
    ELSE NULL
  END;
  v_groom_id := CASE
    WHEN public.is_current_couple_member(
      v_raw_groom_id, v_request.couple_id
    ) THEN v_raw_groom_id
    ELSE NULL
  END;
  v_roster_fingerprint := md5(
    COALESCE(v_bride_id::text, '-')
      || ':' ||
    COALESCE(v_groom_id::text, '-')
  );

  IF p_apply_user_id IS NULL
     OR (
       p_apply_user_id IS DISTINCT FROM v_bride_id
       AND p_apply_user_id IS DISTINCT FROM v_groom_id
     ) THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_SCOPE_DENIED'
      USING ERRCODE = '42501';
  END IF;

  IF v_request.roster_fingerprint IS DISTINCT FROM v_roster_fingerprint
     OR v_request.expires_at <= clock_timestamp()
     OR v_request.change_digest IS DISTINCT FROM
       public.couple_plan_change_digest(v_request.changes) THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_CONFLICT'
      USING ERRCODE = '40001';
  END IF;

  SELECT count(*)::integer
    INTO v_accepted_count
  FROM public.couple_plan_change_acceptances AS acceptance
  WHERE acceptance.request_id = v_request.id
    AND acceptance.couple_id = v_request.couple_id
    AND acceptance.change_digest = v_request.change_digest
    AND acceptance.roster_fingerprint = v_request.roster_fingerprint
    AND acceptance.user_id IN (v_bride_id, v_groom_id);

  IF v_accepted_count < v_request.required_count THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_APPROVAL_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(array_agg(item.key ORDER BY item.key), '{}'::text[])
    INTO v_remove_keys
  FROM jsonb_array_elements_text(
    COALESCE(
      v_request.changes -> 'progress_remove_keys',
      '[]'::jsonb
    )
  ) AS item(key);

  PERFORM set_config(
    'hanbang.couple_plan_change_request_id',
    v_request.id::text,
    true
  );
  PERFORM set_config(
    'hanbang.couple_plan_change_couple_id',
    v_request.couple_id::text,
    true
  );
  PERFORM set_config(
    'hanbang.couple_plan_change_base_revision',
    v_request.base_revision::text,
    true
  );
  PERFORM set_config(
    'hanbang.couple_plan_change_digest',
    v_request.change_digest,
    true
  );

  BEGIN
    UPDATE public.wedding_journeys AS journey
    SET wedding_date = CASE
          WHEN v_request.changes ? 'wedding_date'
            THEN (v_request.changes ->> 'wedding_date')::date
          ELSE journey.wedding_date
        END,
        venue = CASE
          WHEN v_request.changes ? 'venue'
            THEN v_request.changes ->> 'venue'
          ELSE journey.venue
        END,
        total_budget = CASE
          WHEN v_request.changes ? 'total_budget'
            THEN (v_request.changes ->> 'total_budget')::bigint
          ELSE journey.total_budget
        END,
        progress = (
          COALESCE(journey.progress, '{}'::jsonb) - v_remove_keys
        ) || COALESCE(
          v_request.changes -> 'progress_patch',
          '{}'::jsonb
        )
    WHERE journey.couple_id = v_request.couple_id
      AND journey.state_revision = v_request.base_revision
    RETURNING journey.* INTO v_journey;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('hanbang.couple_plan_change_request_id', '', true);
    PERFORM set_config('hanbang.couple_plan_change_couple_id', '', true);
    PERFORM set_config('hanbang.couple_plan_change_base_revision', '', true);
    PERFORM set_config('hanbang.couple_plan_change_digest', '', true);
    RAISE;
  END;

  PERFORM set_config('hanbang.couple_plan_change_request_id', '', true);
  PERFORM set_config('hanbang.couple_plan_change_couple_id', '', true);
  PERFORM set_config('hanbang.couple_plan_change_base_revision', '', true);
  PERFORM set_config('hanbang.couple_plan_change_digest', '', true);

  IF v_journey.id IS NULL
     OR v_journey.couple_id IS DISTINCT FROM v_request.couple_id
     OR v_journey.state_revision IS DISTINCT FROM
       v_request.base_revision + 1 THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_CONFLICT'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.couple_plan_change_requests AS request
  SET status = 'applied',
      applied_at = clock_timestamp(),
      applied_by_user_id = p_apply_user_id,
      applied_revision = v_journey.state_revision
  WHERE request.id = v_request.id
    AND request.status = 'applying';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_CONFLICT'
      USING ERRCODE = '40001';
  END IF;

  PERFORM public.finalize_couple_plan_change_notifications_locked(
    v_request.id,
    p_apply_user_id,
    'change_applied'
  );

  RETURN to_jsonb(v_journey);
END;
$function$;


-- Frozen companion supabase/release-candidates/amora-action-writer-retirement-v1/retirement_direct_journey_guard_v1.sql SHA256 3b98d9c86e1092fa5e1cd10561cfc1d25cb30e405dfc144320e9e717ddc9103c
-- 로컬 companion 후보: 직접 service DML의 예약값 변경만 거절한다.
-- INVOKER 신원은 거절 조건이지 승인의 근거가 아니다. 기존 owner SDF의
-- actor/claim/roster 검사를 대체하거나 postgres/admin의 임의 변경을 보호하지 않는다.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE FUNCTION public.guard_amora_reserved_journey_direct_dml_retirement_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $function$
BEGIN
  IF CURRENT_USER = 'service_role' AND (
    (TG_OP = 'INSERT'
      AND coalesce(NEW.progress,'{}'::jsonb) ? '__amora_actions'
      AND (NEW.progress -> '__amora_actions') IS DISTINCT FROM '[]'::jsonb)
    OR (TG_OP = 'UPDATE' AND (
      (coalesce(NEW.progress,'{}'::jsonb) ? '__amora_actions') IS DISTINCT FROM
        (coalesce(OLD.progress,'{}'::jsonb) ? '__amora_actions')
      OR (coalesce(NEW.progress,'{}'::jsonb) -> '__amora_actions') IS DISTINCT FROM
        (coalesce(OLD.progress,'{}'::jsonb) -> '__amora_actions')
    ))
  ) THEN
    RAISE EXCEPTION 'AMORA_ACTION_DIRECT_JOURNEY_WRITER_RETIRED' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.guard_amora_reserved_journey_direct_dml_retirement_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_amora_reserved_journey_direct_dml_retirement_v1() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER guard_amora_reserved_journey_direct_dml_retirement_v1
BEFORE INSERT OR UPDATE ON public.wedding_journeys
FOR EACH ROW EXECUTE FUNCTION public.guard_amora_reserved_journey_direct_dml_retirement_v1();


-- Frozen companion supabase/release-candidates/amora-action-writer-retirement-v1/transport_conflict_response_v1.sql SHA256 fecd2ad16a1f2e8613cb61010a6eb066e28be34c6112059e239caaca33f6eb0b
-- B2 로컬 후보: 이미 릴리스된 B1 원문은 수정하지 않는다.
-- logical stale 두 곳만 HTTP409로 반환하며 실제 serialization/nested55000은 번역하지 않는다.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.patch_own_amora_action_view_v2(
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
      RAISE EXCEPTION 'AMORA_ACTION_CONFLICT' USING ERRCODE = 'PT409';
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
    RAISE EXCEPTION 'AMORA_ACTION_CONFLICT' USING ERRCODE = 'PT409';
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
-- 새 INSERT identity guard의 명시적 충돌도 엔진 serialization과 분리한다.
-- frozen25b는 보존하며 함수/trigger identity, 잠금 순서, 23505 재전송은 바꾸지 않는다.
CREATE OR REPLACE FUNCTION public.guard_amora_action_insert_identity_cutover_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_progress jsonb; v_actions jsonb;
BEGIN
  IF NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(NEW.id,710041)) THEN
    RAISE EXCEPTION 'AMORA_ACTION_IDENTITY_BUSY' USING ERRCODE = 'PT409';
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
        RAISE EXCEPTION 'AMORA_ACTION_LEGACY_IDENTITY_CONFLICT' USING ERRCODE = 'PT409';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
ALTER FUNCTION public.guard_amora_action_insert_identity_cutover_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_amora_action_insert_identity_cutover_v1() FROM PUBLIC, anon, authenticated, service_role;

-- 이미 같은 B2에서 교체하는 private plan apply의 명시적 상태 충돌 4개만 분리한다.
-- 승인·roster·잠금·원자적 상태 전이와 중첩 엔진 오류의 RAISE는 그대로 유지한다.
CREATE OR REPLACE FUNCTION public.apply_couple_plan_change_locked(
  p_request_id uuid,
  p_apply_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_request public.couple_plan_change_requests%ROWTYPE;
  v_journey public.wedding_journeys%ROWTYPE;
  v_raw_bride_id uuid;
  v_raw_groom_id uuid;
  v_bride_id uuid;
  v_groom_id uuid;
  v_recipient_user_id uuid;
  v_roster_fingerprint text;
  v_accepted_count integer;
  v_remove_keys text[];
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_SCOPE_DENIED'
      USING ERRCODE = '42501';
  END IF;

  SELECT request.*
    INTO v_request
  FROM public.couple_plan_change_requests AS request
  WHERE request.id = p_request_id;

  IF NOT FOUND OR v_request.status <> 'applying' THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_CONFLICT'
      USING ERRCODE = 'PT409';
  END IF;

  -- 이전에 승인 대기로 남긴 일반 plan도 예약 action 값을 쓰기 전에 재검증한다.
  PERFORM public.normalize_couple_plan_changes(v_request.changes);

  SELECT couple.bride_id, couple.groom_id
    INTO v_raw_bride_id, v_raw_groom_id
  FROM public.couples AS couple
  WHERE couple.id = v_request.couple_id;

  v_bride_id := CASE
    WHEN public.is_current_couple_member(
      v_raw_bride_id, v_request.couple_id
    ) THEN v_raw_bride_id
    ELSE NULL
  END;
  v_groom_id := CASE
    WHEN public.is_current_couple_member(
      v_raw_groom_id, v_request.couple_id
    ) THEN v_raw_groom_id
    ELSE NULL
  END;
  v_roster_fingerprint := md5(
    COALESCE(v_bride_id::text, '-')
      || ':' ||
    COALESCE(v_groom_id::text, '-')
  );

  IF p_apply_user_id IS NULL
     OR (
       p_apply_user_id IS DISTINCT FROM v_bride_id
       AND p_apply_user_id IS DISTINCT FROM v_groom_id
     ) THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_SCOPE_DENIED'
      USING ERRCODE = '42501';
  END IF;

  IF v_request.roster_fingerprint IS DISTINCT FROM v_roster_fingerprint
     OR v_request.expires_at <= clock_timestamp()
     OR v_request.change_digest IS DISTINCT FROM
       public.couple_plan_change_digest(v_request.changes) THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_CONFLICT'
      USING ERRCODE = 'PT409';
  END IF;

  SELECT count(*)::integer
    INTO v_accepted_count
  FROM public.couple_plan_change_acceptances AS acceptance
  WHERE acceptance.request_id = v_request.id
    AND acceptance.couple_id = v_request.couple_id
    AND acceptance.change_digest = v_request.change_digest
    AND acceptance.roster_fingerprint = v_request.roster_fingerprint
    AND acceptance.user_id IN (v_bride_id, v_groom_id);

  IF v_accepted_count < v_request.required_count THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_APPROVAL_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(array_agg(item.key ORDER BY item.key), '{}'::text[])
    INTO v_remove_keys
  FROM jsonb_array_elements_text(
    COALESCE(
      v_request.changes -> 'progress_remove_keys',
      '[]'::jsonb
    )
  ) AS item(key);

  PERFORM set_config(
    'hanbang.couple_plan_change_request_id',
    v_request.id::text,
    true
  );
  PERFORM set_config(
    'hanbang.couple_plan_change_couple_id',
    v_request.couple_id::text,
    true
  );
  PERFORM set_config(
    'hanbang.couple_plan_change_base_revision',
    v_request.base_revision::text,
    true
  );
  PERFORM set_config(
    'hanbang.couple_plan_change_digest',
    v_request.change_digest,
    true
  );

  BEGIN
    UPDATE public.wedding_journeys AS journey
    SET wedding_date = CASE
          WHEN v_request.changes ? 'wedding_date'
            THEN (v_request.changes ->> 'wedding_date')::date
          ELSE journey.wedding_date
        END,
        venue = CASE
          WHEN v_request.changes ? 'venue'
            THEN v_request.changes ->> 'venue'
          ELSE journey.venue
        END,
        total_budget = CASE
          WHEN v_request.changes ? 'total_budget'
            THEN (v_request.changes ->> 'total_budget')::bigint
          ELSE journey.total_budget
        END,
        progress = (
          COALESCE(journey.progress, '{}'::jsonb) - v_remove_keys
        ) || COALESCE(
          v_request.changes -> 'progress_patch',
          '{}'::jsonb
        )
    WHERE journey.couple_id = v_request.couple_id
      AND journey.state_revision = v_request.base_revision
    RETURNING journey.* INTO v_journey;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('hanbang.couple_plan_change_request_id', '', true);
    PERFORM set_config('hanbang.couple_plan_change_couple_id', '', true);
    PERFORM set_config('hanbang.couple_plan_change_base_revision', '', true);
    PERFORM set_config('hanbang.couple_plan_change_digest', '', true);
    RAISE;
  END;

  PERFORM set_config('hanbang.couple_plan_change_request_id', '', true);
  PERFORM set_config('hanbang.couple_plan_change_couple_id', '', true);
  PERFORM set_config('hanbang.couple_plan_change_base_revision', '', true);
  PERFORM set_config('hanbang.couple_plan_change_digest', '', true);

  IF v_journey.id IS NULL
     OR v_journey.couple_id IS DISTINCT FROM v_request.couple_id
     OR v_journey.state_revision IS DISTINCT FROM
       v_request.base_revision + 1 THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_CONFLICT'
      USING ERRCODE = 'PT409';
  END IF;

  UPDATE public.couple_plan_change_requests AS request
  SET status = 'applied',
      applied_at = clock_timestamp(),
      applied_by_user_id = p_apply_user_id,
      applied_revision = v_journey.state_revision
  WHERE request.id = v_request.id
    AND request.status = 'applying';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_CONFLICT'
      USING ERRCODE = 'PT409';
  END IF;

  PERFORM public.finalize_couple_plan_change_notifications_locked(
    v_request.id,
    p_apply_user_id,
    'change_applied'
  );

  RETURN to_jsonb(v_journey);
END;
$function$;

COMMIT;
