-- 로컬 companion 후보: 실제 기존 plan-lane 함수가 설치된 schema에만 적용한다.
-- 새 action 승인/lock/GUC를 만들지 않고 일반 plan의 예약 action 입력만 닫는다.
BEGIN;
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

COMMIT;
