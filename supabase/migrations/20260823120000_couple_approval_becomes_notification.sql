-- 20260823120000: 두 사람 승인을 없애고 상대에게 알림만 보낸다.
--
-- 2026-08-23 파운더 결정. 원문: "그냥 파트너가 뭘 추가하거나 뭘 변경했거나
-- 삭제했을 때 알림을 그냥 상단에 텍스트 메시지처럼 보여주면 되지 않을까?"
--
-- 승인 경로가 둘이라 둘 다 바꾼다.
--
--   1) 아모라 카드   — `amora_shared_action_policy` 가 'couple' 을 돌려주면
--                      `authorize_amora_shared_action_execution` 이 정족수를 본다.
--   2) 앱 직접 수정  — 세 함수가 각자 required_count 를 2 로 계산한다.
--
-- 알림은 새로 만들 것이 없다. 두 경로 모두 **1인 확인으로 반영될 때 상대에게
-- change_applied 를 이미 보낸다**:
--   - 카드: 트리거 trg_notify_amora_shared_action_completion 이
--           amora_tool_executions 에 붙어 있고 승인 방식을 보지 않는다.
--   - 직접 수정: apply_couple_plan_change_locked 가
--           finalize_couple_plan_change_notifications_locked(..., 'change_applied')
--           을 부르고, required_count = 1 분기가 상대에게 새 행을 넣는다
--           ("함께 쓰는 계획이 변경됐어요").
--
-- 되돌리려면 이 파일의 함수들을 예전 정의로 다시 CREATE OR REPLACE 하면 된다.
-- 적용 직전 정의는 릴리스 원장의 롤백 자료로 함께 남겼다.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) 아모라 카드: 'couple' 을 더 이상 돌려주지 않는다.
--
-- 'blocked' 는 그대로 둔다. 승인을 한 사람으로 줄이는 것과, 아모라가 아예 손대지
-- 않기로 한 것(예약·삭제)을 푸는 것은 다른 이야기다.
--
-- TTL 주의: amora_shared_action_context 는 발급 TTL 을 정책에서 파생해
-- 대조한다(couple=86400000, 그 외=600000). 이제 'couple' 이 나오지 않으므로
-- 기대값은 항상 600000 이고, 서버의 getAmoraPendingActionTtlMs 도 같은 값을
-- 발급한다. 두 값이 어긋나면 사용자 카드가 AMORA_SHARED_ACTION_EXPIRED 로 죽는다.
-- 이 변경 직전에 발급된 24시간 카드는 만료로 거부된다 — 사용자에게는 "다시
-- 요청해 주세요" 로 보이며, 아무것도 잘못 반영되지 않는다.
-- ---------------------------------------------------------------------------
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
      -- 예전 'couple' 목록. 이제 한 사람 확인으로 반영되고 상대에게 알림이 간다.
      'update_budget',
      'update_wedding_date',
      'update_venue',
      'apply_budget_plan',
      'log_wedding_event',
      'add_schedule_event',
      'update_schedule_event',
      'cancel_schedule_event',
      'restore_schedule_event',
      -- 원래부터 'single' 이던 것들.
      'update_task_status',
      'update_category_budget',
      'add_custom_category',
      'toggle_checklist_item',
      'add_amora_action'
    ) THEN 'single'
    ELSE 'blocked'
  END;
$function$;

-- ---------------------------------------------------------------------------
-- 2) 앱 직접 수정: 필요한 승인 인원을 1로 내린다.
--
-- 처음에는 `couple_plan_change_is_high_impact` 를 통째로 false 로 만들었다.
-- 스테이징에서 일정 화면이 503 으로 죽어서 알았다 — 그 판정은 **몇 명이
-- 승인하나** 가 아니라 **이 쓰기가 감사 경로를 타야 하나** 를 뜻한다.
-- `enforce_couple_plan_change_write_boundary` 가 그 값으로 표식 없는 직접
-- 쓰기를 막는다. false 로 만들면 그 방어선이 통째로 꺼지고, 승인을 없앤 지금
-- 상대를 지키는 것은 알림 하나뿐이라 그 손실이 크다.
--
-- 그래서 분류기는 그대로 두고 **정족수만** 내린다. 세 곳이 각자 2를 계산한다.
--
--   submit_couple_plan_change_before_manual_schedule_clock  요청을 만들 때
--   prepare_amora_manual_plan_change_request                수동 일정 삽입 검사
--   enforce_couple_plan_change_write_boundary               적용된 쓰기 검증
--
-- 아래 세 정의는 운영 DB 에서 그대로 받아 **바꿀 곳만 치환**했다. 손으로 옮겨
-- 적지 않았다. 운영과 스테이징의 정의가 바이트 단위로 같은 것도 확인했다.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.submit_couple_plan_change_before_manual_schedule_clock(p_couple_id uuid, p_actor_user_id uuid, p_expected_revision bigint, p_changes jsonb, p_surface text, p_summary text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '5s'
 SET statement_timeout TO '20s'
AS $function$
DECLARE
  v_raw_bride_id uuid;
  v_raw_groom_id uuid;
  v_bride_id uuid;
  v_groom_id uuid;
  v_partner_user_id uuid;
  v_roster_fingerprint text;
  v_required_count smallint;
  v_changes jsonb;
  v_change_digest text;
  v_remove_keys text[];
  v_next_date date;
  v_next_venue text;
  v_next_budget bigint;
  v_next_progress jsonb;
  v_is_high_impact boolean;
  v_summary text;
  v_journey public.wedding_journeys%ROWTYPE;
  v_existing public.couple_plan_change_requests%ROWTYPE;
  v_request_id uuid := gen_random_uuid();
  v_now timestamptz := clock_timestamp();
  v_initial_status text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_SCOPE_DENIED'
      USING ERRCODE = '42501';
  END IF;
  IF p_couple_id IS NULL
     OR p_actor_user_id IS NULL
     OR p_expected_revision IS NULL
     OR p_expected_revision NOT BETWEEN 0 AND 9007199254740990
     OR p_surface NOT IN ('/schedule', '/budget', '/dashboard')
     OR p_summary IS NULL
     OR char_length(p_summary) NOT BETWEEN 1 AND 240
     OR p_summary IS DISTINCT FROM btrim(p_summary)
     OR public.couple_plan_change_has_unsafe_display_text(p_summary) THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_INPUT'
      USING ERRCODE = '22023';
  END IF;

  v_changes := public.normalize_couple_plan_changes(p_changes);
  v_change_digest := public.couple_plan_change_digest(v_changes);

  -- Global order for every public RPC: couple -> journey -> request.
  SELECT couple.bride_id, couple.groom_id
    INTO v_raw_bride_id, v_raw_groom_id
  FROM public.couples AS couple
  WHERE couple.id = p_couple_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  v_bride_id := CASE
    WHEN public.is_current_couple_member(v_raw_bride_id, p_couple_id)
      THEN v_raw_bride_id
    ELSE NULL
  END;
  v_groom_id := CASE
    WHEN public.is_current_couple_member(v_raw_groom_id, p_couple_id)
      THEN v_raw_groom_id
    ELSE NULL
  END;

  IF p_actor_user_id IS DISTINCT FROM v_bride_id
     AND p_actor_user_id IS DISTINCT FROM v_groom_id THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_SCOPE_DENIED'
      USING ERRCODE = '42501';
  END IF;

  v_partner_user_id := CASE
    WHEN p_actor_user_id = v_bride_id THEN v_groom_id
    WHEN p_actor_user_id = v_groom_id THEN v_bride_id
    ELSE NULL
  END;
  IF v_partner_user_id = p_actor_user_id THEN
    v_partner_user_id := NULL;
  END IF;
  v_roster_fingerprint := md5(
    COALESCE(v_bride_id::text, '-')
      || ':' ||
    COALESCE(v_groom_id::text, '-')
  );

  SELECT journey.*
    INTO v_journey
  FROM public.wedding_journeys AS journey
  WHERE journey.couple_id = p_couple_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  -- This lookup intentionally precedes no-op detection. A committed apply
  -- followed by a lost HTTP response makes the requested value equal current
  -- state; the durable receipt must win over a misleading INVALID response.
  -- An applied receipt always wins, even after the roster changes: this is the
  -- lost-response exact-once recovery path.
  SELECT request.*
    INTO v_existing
  FROM public.couple_plan_change_requests AS request
  WHERE request.couple_id = p_couple_id
    AND request.actor_user_id = p_actor_user_id
    AND request.base_revision = p_expected_revision
    AND request.change_digest = v_change_digest
    AND request.status = 'applied'
  ORDER BY request.applied_at DESC, request.id DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    RETURN public.couple_plan_change_result(v_existing.id);
  END IF;

  -- Active/rejected idempotency is roster-scoped. Stale receipts are excluded
  -- so an expired request or a changed roster can express a fresh intent.
  SELECT request.*
    INTO v_existing
  FROM public.couple_plan_change_requests AS request
  WHERE request.couple_id = p_couple_id
    AND request.actor_user_id = p_actor_user_id
    AND request.base_revision = p_expected_revision
    AND request.change_digest = v_change_digest
    AND request.roster_fingerprint = v_roster_fingerprint
    AND request.status <> 'stale'
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.status = 'pending'
       AND (
         v_existing.expires_at <= v_now
         OR v_existing.roster_fingerprint IS DISTINCT FROM
           v_roster_fingerprint
         OR v_existing.base_revision IS DISTINCT FROM
           v_journey.state_revision
       ) THEN
      UPDATE public.couple_plan_change_requests AS request
      SET status = 'stale',
          stale_at = v_now,
          stale_reason = CASE
            WHEN v_existing.expires_at <= v_now THEN 'expired'
            WHEN v_existing.roster_fingerprint IS DISTINCT FROM
              v_roster_fingerprint THEN 'roster_changed'
            ELSE 'revision_changed'
          END
      WHERE request.id = v_existing.id
        AND request.status = 'pending';
      PERFORM public.finalize_couple_plan_change_notifications_locked(
        v_existing.id,
        p_actor_user_id,
        'change_stale'
      );
      -- A changed revision cannot be retried with the old CAS token. Expiry or
      -- roster change at the same revision may continue into a new request.
      IF v_existing.base_revision IS DISTINCT FROM
           v_journey.state_revision THEN
        RETURN public.couple_plan_change_result(v_existing.id);
      END IF;
    ELSE
      RETURN public.couple_plan_change_result(v_existing.id);
    END IF;
  END IF;

  SELECT COALESCE(array_agg(item.key ORDER BY item.key), '{}'::text[])
    INTO v_remove_keys
  FROM jsonb_array_elements_text(
    COALESCE(v_changes -> 'progress_remove_keys', '[]'::jsonb)
  ) AS item(key);

  v_next_date := CASE
    WHEN v_changes ? 'wedding_date'
      THEN (v_changes ->> 'wedding_date')::date
    ELSE v_journey.wedding_date
  END;
  v_next_venue := CASE
    WHEN v_changes ? 'venue'
      THEN v_changes ->> 'venue'
    ELSE v_journey.venue
  END;
  v_next_budget := CASE
    WHEN v_changes ? 'total_budget'
      THEN (v_changes ->> 'total_budget')::bigint
    ELSE v_journey.total_budget
  END;
  v_next_progress := (
    COALESCE(v_journey.progress, '{}'::jsonb) - v_remove_keys
  ) || COALESCE(v_changes -> 'progress_patch', '{}'::jsonb);

  IF v_next_date IS NOT DISTINCT FROM v_journey.wedding_date
     AND v_next_venue IS NOT DISTINCT FROM v_journey.venue
     AND v_next_budget IS NOT DISTINCT FROM v_journey.total_budget
     AND v_next_progress IS NOT DISTINCT FROM v_journey.progress THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_INPUT'
      USING ERRCODE = '22023';
  END IF;

  v_is_high_impact := public.couple_plan_change_is_high_impact(
    v_journey.wedding_date,
    v_next_date,
    v_journey.venue,
    v_next_venue,
    v_journey.total_budget,
    v_next_budget,
    v_journey.progress,
    v_next_progress
  );
  v_summary := CASE
    WHEN v_is_high_impact THEN
      public.couple_plan_change_exact_high_summary(
        v_journey.wedding_date,
        v_next_date,
        v_journey.venue,
        v_next_venue,
        v_journey.total_budget,
        v_next_budget,
        v_journey.progress,
        v_next_progress,
        v_bride_id,
        v_groom_id
      )
    ELSE p_summary
  END;
  -- 2026-08-23 파운더 결정: 두 사람 승인 없음. 상대에게는 알림이 간다.
  -- `is_high_impact` 는 그대로 둔다 — 그 값은 "몇 명이 승인하나" 가 아니라
  -- "이 쓰기가 감사 경로를 타야 하나" 를 뜻하고,
  -- `enforce_couple_plan_change_write_boundary` 가 그걸로 직접 쓰기를 막는다.
  v_required_count := 1;

  IF v_is_high_impact THEN
    SELECT request.*
      INTO v_existing
    FROM public.couple_plan_change_requests AS request
    WHERE request.couple_id = p_couple_id
      AND request.status = 'pending'
      AND request.is_high_impact
    FOR UPDATE;

    IF FOUND THEN
      IF v_existing.expires_at <= v_now
         OR v_existing.roster_fingerprint IS DISTINCT FROM
           v_roster_fingerprint
         OR v_existing.base_revision IS DISTINCT FROM
           v_journey.state_revision THEN
        UPDATE public.couple_plan_change_requests AS request
        SET status = 'stale',
            stale_at = v_now,
            stale_reason = CASE
              WHEN v_existing.expires_at <= v_now THEN 'expired'
              WHEN v_existing.roster_fingerprint IS DISTINCT FROM
                v_roster_fingerprint THEN 'roster_changed'
              ELSE 'revision_changed'
            END
        WHERE request.id = v_existing.id
          AND request.status = 'pending';
        PERFORM public.finalize_couple_plan_change_notifications_locked(
          v_existing.id,
          p_actor_user_id,
          'change_stale'
        );
      ELSE
        RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_ACTIVE_REQUEST'
          USING ERRCODE = '55000';
      END IF;
    END IF;
  END IF;

  v_initial_status := CASE
    WHEN v_journey.state_revision IS DISTINCT FROM p_expected_revision
      THEN 'stale'
    ELSE 'pending'
  END;

  INSERT INTO public.couple_plan_change_requests(
    id,
    couple_id,
    actor_user_id,
    base_revision,
    changes,
    change_digest,
    roster_fingerprint,
    surface_href,
    summary,
    is_high_impact,
    required_count,
    status,
    created_at,
    expires_at,
    actor_accepted_at,
    stale_at,
    stale_reason
  ) VALUES (
    v_request_id,
    p_couple_id,
    p_actor_user_id,
    p_expected_revision,
    v_changes,
    v_change_digest,
    v_roster_fingerprint,
    p_surface,
    v_summary,
    v_is_high_impact,
    v_required_count,
    v_initial_status,
    v_now,
    v_now + interval '24 hours',
    v_now,
    CASE WHEN v_initial_status = 'stale' THEN v_now ELSE NULL END,
    CASE
      WHEN v_initial_status = 'stale' THEN 'revision_changed'
      ELSE NULL
    END
  );

  INSERT INTO public.couple_plan_change_acceptances(
    request_id,
    couple_id,
    user_id,
    change_digest,
    roster_fingerprint,
    accepted_at
  ) VALUES (
    v_request_id,
    p_couple_id,
    p_actor_user_id,
    v_change_digest,
    v_roster_fingerprint,
    v_now
  );

  IF v_initial_status = 'stale' THEN
    RETURN public.couple_plan_change_result(v_request_id);
  END IF;

  IF v_required_count = 1 THEN
    UPDATE public.couple_plan_change_requests AS request
    SET status = 'applying',
        applying_at = clock_timestamp()
    WHERE request.id = v_request_id
      AND request.status = 'pending';

    PERFORM public.apply_couple_plan_change_locked(
      v_request_id,
      p_actor_user_id
    );
    RETURN public.couple_plan_change_result(v_request_id);
  END IF;

  INSERT INTO public.couple_change_notifications(
    couple_id,
    recipient_user_id,
    actor_user_id,
    source_message_id,
    action_id,
    event_kind,
    tool_name,
    title,
    message,
    href
  ) VALUES
    (
      p_couple_id,
      v_partner_user_id,
      p_actor_user_id,
      v_request_id,
      v_request_id,
      'approval_requested',
      'manual_plan_change',
      '함께 확인할 계획 변경이 있어요',
      v_summary,
      p_surface
    ),
    (
      p_couple_id,
      p_actor_user_id,
      p_actor_user_id,
      v_request_id,
      v_request_id,
      'approval_pending',
      'manual_plan_change',
      '파트너 확인을 기다리는 계획 변경이에요',
      v_summary,
      p_surface
    )
  ON CONFLICT (
    couple_id, recipient_user_id, action_id, event_kind
  ) DO NOTHING;

  RETURN public.couple_plan_change_result(v_request_id);
END;
$function$;


CREATE OR REPLACE FUNCTION public.prepare_amora_manual_plan_change_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '5s'
 SET statement_timeout TO '15s'
AS $function$
DECLARE
  v_journey public.wedding_journeys%ROWTYPE;
  v_couple public.couples%ROWTYPE;
  v_bride_id uuid;
  v_groom_id uuid;
  v_remove_keys text[];
  v_next_progress jsonb;
  v_delta jsonb;
  v_expected_required smallint;
  v_expected_fingerprint text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.couple_id IS DISTINCT FROM OLD.couple_id
       OR NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id
       OR NEW.base_revision IS DISTINCT FROM OLD.base_revision
       OR NEW.changes IS DISTINCT FROM OLD.changes
       OR NEW.change_digest IS DISTINCT FROM OLD.change_digest
       OR NEW.roster_fingerprint IS DISTINCT FROM OLD.roster_fingerprint
       OR NEW.surface_href IS DISTINCT FROM OLD.surface_href
       OR NEW.summary IS DISTINCT FROM OLD.summary
       OR NEW.is_high_impact IS DISTINCT FROM OLD.is_high_impact
       OR NEW.required_count IS DISTINCT FROM OLD.required_count
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
       OR NEW.actor_accepted_at IS DISTINCT FROM OLD.actor_accepted_at
       OR NEW.schedule_mutation_kind IS DISTINCT FROM
          OLD.schedule_mutation_kind
       OR NEW.schedule_event_id IS DISTINCT FROM OLD.schedule_event_id
       OR NEW.schedule_before_event IS DISTINCT FROM
          OLD.schedule_before_event
       OR NEW.schedule_after_event IS DISTINCT FROM OLD.schedule_after_event THEN
      RAISE EXCEPTION 'AMORA_MANUAL_PLAN_REQUEST_IMMUTABLE'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.schedule_mutation_kind IS NOT NULL
     OR NEW.schedule_event_id IS NOT NULL
     OR NEW.schedule_before_event IS NOT NULL
     OR NEW.schedule_after_event IS NOT NULL THEN
    RAISE EXCEPTION 'AMORA_MANUAL_SCHEDULE_RECEIPT_SERVER_OWNED'
      USING ERRCODE = '42501';
  END IF;

  SELECT journey.* INTO v_journey
  FROM public.wedding_journeys AS journey
  WHERE journey.couple_id = NEW.couple_id;
  SELECT couple.* INTO v_couple
  FROM public.couples AS couple
  WHERE couple.id = NEW.couple_id;
  IF v_journey.id IS NULL OR v_couple.id IS NULL THEN
    RAISE EXCEPTION 'AMORA_MANUAL_SCHEDULE_SCOPE_INVALID'
      USING ERRCODE = '55000';
  END IF;
  v_bride_id := CASE
    WHEN public.is_current_couple_member(v_couple.bride_id, NEW.couple_id)
      THEN v_couple.bride_id ELSE NULL
  END;
  v_groom_id := CASE
    WHEN public.is_current_couple_member(v_couple.groom_id, NEW.couple_id)
      THEN v_couple.groom_id ELSE NULL
  END;

  SELECT COALESCE(array_agg(item.key ORDER BY item.key), '{}'::text[])
    INTO v_remove_keys
  FROM jsonb_array_elements_text(
    COALESCE(NEW.changes -> 'progress_remove_keys', '[]'::jsonb)
  ) AS item(key);
  v_next_progress := (
    COALESCE(v_journey.progress, '{}'::jsonb) - v_remove_keys
  ) || COALESCE(NEW.changes -> 'progress_patch', '{}'::jsonb);

  IF (COALESCE(v_journey.progress, '{}'::jsonb) -> '__events')
       IS DISTINCT FROM
     (COALESCE(v_next_progress, '{}'::jsonb) -> '__events') THEN
    v_delta := public.amora_manual_schedule_delta(
      v_journey.progress, v_next_progress, v_bride_id, v_groom_id
    );
    IF v_delta ->> 'mutationKind' = 'cancel'
       AND (
         v_delta #>> '{after,cancellation,cancelledByProfileId}'
       )::uuid IS DISTINCT FROM NEW.actor_user_id THEN
      RAISE EXCEPTION 'AMORA_MANUAL_SCHEDULE_CANCEL_ACTOR_MISMATCH'
        USING ERRCODE = '42501';
    END IF;
    -- 2026-08-23: 한 사람 확인으로 반영된다. 나머지 검사(행위자가 커플 구성원인가,
    -- 로스터 지문·다이제스트가 맞는가, 변경이 __events 뿐인가)는 그대로 둔다.
    v_expected_required := 1;
    v_expected_fingerprint := md5(
      COALESCE(v_bride_id::text, '-') || ':' ||
      COALESCE(v_groom_id::text, '-')
    );
    IF NEW.actor_user_id IS DISTINCT FROM v_bride_id
          AND NEW.actor_user_id IS DISTINCT FROM v_groom_id
       OR NEW.required_count IS DISTINCT FROM v_expected_required
       OR NEW.roster_fingerprint IS DISTINCT FROM v_expected_fingerprint
       OR NEW.change_digest IS DISTINCT FROM
          public.couple_plan_change_digest(NEW.changes)
       OR NEW.changes - ARRAY[
         'progress_patch', 'progress_remove_keys'
       ]::text[] <> '{}'::jsonb
       OR jsonb_typeof(NEW.changes -> 'progress_patch')
          IS DISTINCT FROM 'object'
       OR (NEW.changes -> 'progress_patch') - '__events' <> '{}'::jsonb
       OR (
         NEW.changes ? 'progress_remove_keys'
         AND NEW.changes -> 'progress_remove_keys' <> '[]'::jsonb
       ) THEN
      RAISE EXCEPTION 'AMORA_MANUAL_SCHEDULE_APPROVAL_REQUIRED'
        USING ERRCODE = '42501';
    END IF;
    NEW.summary := v_delta ->> 'summary';
    NEW.schedule_mutation_kind := v_delta ->> 'mutationKind';
    NEW.schedule_event_id := v_delta ->> 'eventId';
    NEW.schedule_before_event := NULLIF(v_delta -> 'before', 'null'::jsonb);
    NEW.schedule_after_event := v_delta -> 'after';
  END IF;
  RETURN NEW;
END;
$function$;


CREATE OR REPLACE FUNCTION public.enforce_couple_plan_change_write_boundary()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_amora_couple text := NULLIF(current_setting(
    'hanbang.amora_shared_action_couple_id', true
  ), '');
  v_amora_request text := NULLIF(current_setting(
    'hanbang.amora_shared_action_request_key', true
  ), '');
  v_amora_operation text := NULLIF(current_setting(
    'hanbang.amora_shared_action_operation_key', true
  ), '');
  v_amora_action text := NULLIF(current_setting(
    'hanbang.amora_shared_action_action_id', true
  ), '');
  v_amora_revision text := NULLIF(current_setting(
    'hanbang.amora_shared_action_expected_revision', true
  ), '');
  v_plan_request text := NULLIF(current_setting(
    'hanbang.couple_plan_change_request_id', true
  ), '');
  v_plan_couple text := NULLIF(current_setting(
    'hanbang.couple_plan_change_couple_id', true
  ), '');
  v_plan_revision text := NULLIF(current_setting(
    'hanbang.couple_plan_change_base_revision', true
  ), '');
  v_plan_digest text := NULLIF(current_setting(
    'hanbang.couple_plan_change_digest', true
  ), '');
  v_raw_bride_id uuid;
  v_raw_groom_id uuid;
  v_bride_id uuid;
  v_groom_id uuid;
  v_roster_fingerprint text;
  v_request public.couple_plan_change_requests%ROWTYPE;
  v_expected_date date;
  v_expected_venue text;
  v_expected_budget bigint;
  v_expected_progress jsonb;
  v_remove_keys text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.wedding_date IS NOT NULL
       OR NEW.venue IS NOT NULL
       OR COALESCE(NEW.total_budget, 0) <> 0
       OR COALESCE(NEW.progress, '{}'::jsonb) <> '{}'::jsonb THEN
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_APPROVAL_REQUIRED'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.couple_id IS DISTINCT FROM OLD.couple_id THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_SCOPE_DENIED'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.couple_plan_change_is_high_impact(
    OLD.wedding_date,
    NEW.wedding_date,
    OLD.venue,
    NEW.venue,
    OLD.total_budget,
    NEW.total_budget,
    OLD.progress,
    NEW.progress
  ) THEN
    RETURN NEW;
  END IF;

  -- Do not duplicate the existing Amora authority checks. A complete marker
  -- set is routed onward; trg_advance_wedding_journey_state_revision validates
  -- it against the immutable proposal, execution, acceptance, and receipt.
  IF v_amora_couple IS NOT NULL
     AND v_amora_request IS NOT NULL
     AND v_amora_operation IS NOT NULL
     AND v_amora_action IS NOT NULL
     AND v_amora_revision IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Reject ordinary direct writes before touching the couple row. UPDATE has
  -- already locked the journey row, while plan RPCs deliberately lock
  -- couple -> journey. Taking the couple lock for an unmarked member write
  -- would invert that order and let repeated rejected writes deadlock valid
  -- partner decisions. Solo high-impact writes use the same 1/1 plan RPC.
  IF auth.role() IS DISTINCT FROM 'service_role'
     OR v_plan_request IS NULL
     OR v_plan_couple IS NULL
     OR v_plan_revision IS NULL
     OR v_plan_digest IS NULL
     OR v_plan_request !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR v_plan_couple IS DISTINCT FROM OLD.couple_id::text
     OR v_plan_revision !~ '^(0|[1-9][0-9]{0,15})$'
     OR v_plan_digest !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_APPROVAL_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  -- A row lock here serializes partner link/unlink with the linked-boundary
  -- decision. Plan RPCs take this couple lock before the journey lock.
  SELECT couple.bride_id, couple.groom_id
    INTO v_raw_bride_id, v_raw_groom_id
  FROM public.couples AS couple
  WHERE couple.id = OLD.couple_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_SCOPE_DENIED'
      USING ERRCODE = '42501';
  END IF;

  v_bride_id := CASE
    WHEN public.is_current_couple_member(v_raw_bride_id, OLD.couple_id)
      THEN v_raw_bride_id
    ELSE NULL
  END;
  v_groom_id := CASE
    WHEN public.is_current_couple_member(v_raw_groom_id, OLD.couple_id)
      THEN v_raw_groom_id
    ELSE NULL
  END;

  -- Solo journeys remain writable through their one-person plan RPC. The
  -- global 2/2 fence only exists while two distinct current members are valid.
  IF v_bride_id IS NULL
     OR v_groom_id IS NULL
     OR v_bride_id = v_groom_id THEN
    RETURN NEW;
  END IF;

  SELECT request.*
    INTO v_request
  FROM public.couple_plan_change_requests AS request
  WHERE request.id = v_plan_request::uuid
    AND request.couple_id = OLD.couple_id
    AND request.base_revision = v_plan_revision::bigint
    AND request.change_digest = v_plan_digest
    AND request.status = 'applying';

  v_roster_fingerprint := md5(
    v_bride_id::text || ':' || v_groom_id::text
  );

  IF NOT FOUND
     OR v_request.is_high_impact IS DISTINCT FROM true
     OR v_request.required_count <> 1
     OR v_request.roster_fingerprint IS DISTINCT FROM v_roster_fingerprint
     OR v_request.change_digest IS DISTINCT FROM
       public.couple_plan_change_digest(v_request.changes)
     OR OLD.state_revision IS DISTINCT FROM v_request.base_revision
     OR v_request.applied_at IS NOT NULL
     OR v_request.applied_revision IS NOT NULL THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_CONFLICT'
      USING ERRCODE = '40001';
  END IF;

  SELECT COALESCE(array_agg(item.key ORDER BY item.key), '{}'::text[])
    INTO v_remove_keys
  FROM jsonb_array_elements_text(
    COALESCE(
      v_request.changes -> 'progress_remove_keys',
      '[]'::jsonb
    )
  ) AS item(key);

  v_expected_date := CASE
    WHEN v_request.changes ? 'wedding_date'
      THEN (v_request.changes ->> 'wedding_date')::date
    ELSE OLD.wedding_date
  END;
  v_expected_venue := CASE
    WHEN v_request.changes ? 'venue'
      THEN v_request.changes ->> 'venue'
    ELSE OLD.venue
  END;
  v_expected_budget := CASE
    WHEN v_request.changes ? 'total_budget'
      THEN (v_request.changes ->> 'total_budget')::bigint
    ELSE OLD.total_budget
  END;
  v_expected_progress := (
    COALESCE(OLD.progress, '{}'::jsonb) - v_remove_keys
  ) || COALESCE(
    v_request.changes -> 'progress_patch',
    '{}'::jsonb
  );

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.couple_id IS DISTINCT FROM OLD.couple_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.updated_at IS DISTINCT FROM OLD.updated_at
     OR NEW.state_revision IS DISTINCT FROM OLD.state_revision
     OR NEW.wedding_date IS DISTINCT FROM v_expected_date
     OR NEW.venue IS DISTINCT FROM v_expected_venue
     OR NEW.total_budget IS DISTINCT FROM v_expected_budget
     OR NEW.progress IS DISTINCT FROM v_expected_progress THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_CONFLICT'
      USING ERRCODE = '40001';
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3) 발급 TTL 검증을 정책에서 떼어낸다.
--
-- 아래는 20260730102000 의 함수 본문을 **그대로 옮기고 TTL 검증 한 곳만** 바꾼
-- 것이다. 손으로 다시 타자하지 않고 파일에서 추출해 치환했다 — 옮겨 적으면
-- 문구가 조용히 바뀐다.
--
-- 이름이 `_pre_roster_binding` 인 이유: 20260802170000 이 원래 함수를 이 이름으로
-- RENAME 하고, 같은 이름의 새 래퍼를 만들어 감쌌다. 래퍼는 proposalDigest·
-- rosterFingerprint·requiredCount·partnerLinked 만 덮어쓰고 'policy' 와 TTL 검증은
-- 안쪽 것을 그대로 쓴다. 그래서 고칠 곳은 안쪽이다.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.amora_shared_action_context_pre_roster_binding(
  p_action_id uuid,
  p_couple_id uuid,
  p_source_message_id uuid,
  p_user_id uuid,
  p_context_mode text,
  p_confirmation_message_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_bride_id uuid;
  v_groom_id uuid;
  v_required_count integer;
  v_roster_fingerprint text;
  v_action jsonb;
  v_tool_name text;
  v_tool_input jsonb;
  v_policy text;
  v_proposal_digest text;
  v_issued_at numeric;
  v_expires_at numeric;
  v_expected_ttl_ms numeric;
  v_now_ms numeric;
  v_latest_ids uuid[];
  v_journey_revision_json jsonb;
  v_expected_journey_revision bigint;
  v_current_journey_revision bigint;
  v_guard_couple text;
  v_guard_request text;
  v_guard_operation text;
  v_guard_action text;
  v_guard_expected text;
  v_guard_applied text;
  v_self_applied_revision boolean := false;
BEGIN
  IF p_action_id IS NULL
     OR p_couple_id IS NULL
     OR p_source_message_id IS NULL
     OR p_user_id IS NULL
     OR p_context_mode NOT IN ('proposal_latest', 'execution')
     OR (p_context_mode = 'proposal_latest' AND p_confirmation_message_id IS NOT NULL)
     OR (p_context_mode = 'execution' AND p_confirmation_message_id IS NULL) THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_INVALID_INPUT'
      USING ERRCODE = '22023';
  END IF;

  -- The couple row is the first lock for acceptance, authorization, and the
  -- execution trigger. Its immediate chat-message FK prevents a concurrent
  -- canonical insert from crossing the freshness check.
  SELECT couple.bride_id, couple.groom_id
    INTO v_bride_id, v_groom_id
  FROM public.couples AS couple
  WHERE couple.id = p_couple_id
  FOR UPDATE;

  IF NOT FOUND
     OR NOT EXISTS (
       SELECT 1
       FROM public.profiles AS profile
       WHERE profile.id = p_user_id
         AND profile.couple_id = p_couple_id
         AND (
           (profile.role = 'bride' AND v_bride_id = p_user_id)
           OR (profile.role = 'groom' AND v_groom_id = p_user_id)
         )
     ) THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_SCOPE_DENIED'
      USING ERRCODE = '42501';
  END IF;

  v_required_count :=
    CASE
      WHEN v_bride_id IS NOT NULL
       AND v_groom_id IS NOT NULL
       AND v_bride_id <> v_groom_id THEN 2
      ELSE 1
    END;
  v_roster_fingerprint := md5(
    COALESCE(v_bride_id::text, '-') || ':' || COALESCE(v_groom_id::text, '-')
  );

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'hanbang:amora-shared-action:'
        || p_couple_id::text || ':' || p_action_id::text,
      0
    )
  );

  SELECT message.metadata -> 'pending_amora_action',
         message.metadata -> 'pending_amora_action_journey_revision'
    INTO v_action, v_journey_revision_json
  FROM public.chat_messages AS message
  WHERE message.id = p_source_message_id
    AND message.couple_id = p_couple_id
    AND message.sender_id IS NULL
    AND message.sender_type = 'ai'
    AND message.role = 'assistant'
    AND message.visibility = 'shared'
    AND COALESCE(message.metadata ->> 'target', '') <> 'partner'
  FOR SHARE;

  IF NOT FOUND
     OR jsonb_typeof(v_action) IS DISTINCT FROM 'object'
     OR v_action - ARRAY[
       'version', 'actionId', 'tool', 'input', 'inputDigest',
       'operationKey', 'confirmation', 'issuedAt', 'expiresAt'
     ] <> '{}'::jsonb
     OR v_action ->> 'version' IS DISTINCT FROM '2'
     OR COALESCE(v_action ->> 'actionId', '') !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR (v_action ->> 'actionId')::uuid IS DISTINCT FROM p_action_id
     OR char_length(COALESCE(v_action ->> 'tool', '')) NOT BETWEEN 1 AND 80
     OR jsonb_typeof(v_action -> 'input') IS DISTINCT FROM 'object'
     OR octet_length((v_action -> 'input')::text) > 16384
     OR COALESCE(v_action ->> 'inputDigest', '') !~ '^[a-f0-9]{64}$'
     OR COALESCE(v_action ->> 'operationKey', '') !~ '^[a-f0-9]{64}$'
     OR jsonb_typeof(v_action -> 'confirmation') IS DISTINCT FROM 'string'
     OR char_length(v_action ->> 'confirmation') NOT BETWEEN 1 AND 2000
     OR COALESCE(v_action ->> 'issuedAt', '') !~ '^[0-9]{1,16}$'
     OR COALESCE(v_action ->> 'expiresAt', '') !~ '^[0-9]{1,16}$'
     OR jsonb_typeof(v_journey_revision_json) IS DISTINCT FROM 'number'
     OR COALESCE(v_journey_revision_json #>> '{}', '') !~
       '^(0|[1-9][0-9]{0,15})$' THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_PROPOSAL_INVALID'
      USING ERRCODE = '22023';
  END IF;

  v_expected_journey_revision :=
    (v_journey_revision_json #>> '{}')::bigint;
  IF v_expected_journey_revision > 9007199254740991 THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_PROPOSAL_INVALID'
      USING ERRCODE = '22023';
  END IF;

  -- This is deliberately a non-locking fail-fast read. The atomic mutation
  -- boundary performs the authoritative comparison after it owns the journey
  -- row, preserving the established execution/request -> journey lock order.
  SELECT journey.state_revision
    INTO v_current_journey_revision
  FROM public.wedding_journeys AS journey
  WHERE journey.couple_id = p_couple_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_PROPOSAL_CHANGED'
      USING ERRCODE = '55000';
  END IF;

  IF v_current_journey_revision IS DISTINCT FROM
       v_expected_journey_revision THEN
    -- The only valid mismatch is the r -> r+1 mutation performed by this
    -- exact execution earlier in the same atomic dispatcher transaction.
    -- Transaction-local settings are routing hints, never authority alone:
    -- the receipt and all durable request/execution/action bindings must match.
    v_guard_couple := NULLIF(current_setting(
      'hanbang.amora_shared_action_couple_id', true
    ), '');
    v_guard_request := NULLIF(current_setting(
      'hanbang.amora_shared_action_request_key', true
    ), '');
    v_guard_operation := NULLIF(current_setting(
      'hanbang.amora_shared_action_operation_key', true
    ), '');
    v_guard_action := NULLIF(current_setting(
      'hanbang.amora_shared_action_action_id', true
    ), '');
    v_guard_expected := NULLIF(current_setting(
      'hanbang.amora_shared_action_expected_revision', true
    ), '');
    v_guard_applied := NULLIF(current_setting(
      'hanbang.amora_shared_action_applied_revision', true
    ), '');

    IF p_context_mode = 'execution'
       AND auth.role() = 'service_role'
       AND v_expected_journey_revision < 9007199254740991
       AND v_current_journey_revision =
         v_expected_journey_revision + 1
       AND v_guard_couple = p_couple_id::text
       AND v_guard_request IS NOT NULL
       AND char_length(v_guard_request) BETWEEN 1 AND 160
       AND v_guard_operation ~ '^[a-f0-9]{64}$'
       AND v_guard_action = p_action_id::text
       AND v_guard_expected =
         v_expected_journey_revision::text
       AND v_guard_applied =
         v_current_journey_revision::text
       AND EXISTS (
         SELECT 1
         FROM public.amora_shared_action_journey_mutation_receipts AS receipt
         JOIN public.amora_tool_executions AS execution
           ON execution.couple_id = receipt.couple_id
          AND execution.request_key = receipt.request_key
          AND execution.operation_key = receipt.operation_key
         JOIN public.amora_chat_request_claims AS request
           ON request.couple_id = execution.couple_id
          AND request.request_key = execution.request_key
         WHERE receipt.couple_id = p_couple_id
           AND receipt.request_key = v_guard_request
           AND receipt.operation_key = v_guard_operation
           AND receipt.action_id = p_action_id
           AND receipt.source_message_id = p_source_message_id
           AND receipt.confirmation_message_id =
             p_confirmation_message_id
           AND receipt.expected_revision =
             v_expected_journey_revision
           AND receipt.applied_revision =
             v_current_journey_revision
           AND execution.pending_action_id = p_action_id
           AND execution.pending_action_journey_revision =
             v_expected_journey_revision
           AND execution.status = 'processing'
           AND request.status = 'processing'
           AND request.visibility = 'shared'
           AND request.user_id = p_user_id
           AND request.user_message_id =
             p_confirmation_message_id
       ) THEN
      v_self_applied_revision := true;
    END IF;

    IF NOT v_self_applied_revision THEN
      RAISE EXCEPTION 'AMORA_SHARED_ACTION_PROPOSAL_CHANGED'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  v_tool_name := v_action ->> 'tool';
  v_tool_input := v_action -> 'input';
  v_policy := public.amora_shared_action_policy(v_tool_name, v_tool_input);
  IF v_policy = 'blocked' THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_BLOCKED'
      USING ERRCODE = '42501';
  END IF;

  v_issued_at := (v_action ->> 'issuedAt')::numeric;
  v_expires_at := (v_action ->> 'expiresAt')::numeric;
  -- 2026-08-23: 예전에는 기대 TTL을 정책에서 뽑았다(couple=24시간, 그 외 10분).
  -- 정책이 전부 'single' 이 되면서 그대로 두면 **이미 발급된 24시간 카드가 전부
  -- 만료로 죽는다.** 사용자에게는 방금 받은 확인 버튼이 갑자기 "확인 시간이
  -- 지났어요" 로 바뀌는 것으로 보인다.
  --
  -- 그렇다고 여기에 도구 목록을 한 벌 더 두면 그게 다음 드리프트가 된다 — 오늘
  -- 정책을 TS와 SQL 두 곳에 둔 대가를 이미 치렀다. 그래서 **서버가 도구별로
  -- 정하고, DB는 아는 두 값만 허용한다.** 24시간은 어제까지 이 도구들에 이미
  -- 허용되던 값이므로 새로 생기는 권한은 없다.
  v_expected_ttl_ms := NULL;
  v_now_ms := floor(extract(epoch FROM clock_timestamp()) * 1000);
  IF v_issued_at > v_now_ms
     OR v_expires_at <= v_now_ms
     OR v_expires_at - v_issued_at NOT IN (600000, 86400000) THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_EXPIRED'
      USING ERRCODE = '55000';
  END IF;

  v_proposal_digest := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'pending_amora_action', v_action,
          'pending_amora_action_journey_revision',
            v_expected_journey_revision
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  SELECT array_agg(recent.id ORDER BY recent.created_at DESC, recent.id DESC)
    INTO v_latest_ids
  FROM (
    SELECT message.id, message.created_at
    FROM public.chat_messages AS message
    WHERE message.couple_id = p_couple_id
      AND message.visibility = 'shared'
      AND COALESCE(message.metadata ->> 'target', '') <> 'partner'
    ORDER BY message.created_at DESC, message.id DESC
    LIMIT CASE WHEN p_context_mode = 'execution' THEN 2 ELSE 1 END
  ) AS recent;

  IF p_context_mode = 'proposal_latest' THEN
    IF COALESCE(array_length(v_latest_ids, 1), 0) <> 1
       OR v_latest_ids[1] IS DISTINCT FROM p_source_message_id THEN
      RAISE EXCEPTION 'AMORA_SHARED_ACTION_STALE_CONTEXT'
        USING ERRCODE = '55000';
    END IF;
  ELSE
    IF COALESCE(array_length(v_latest_ids, 1), 0) <> 2
       OR v_latest_ids[1] IS DISTINCT FROM p_confirmation_message_id
       OR v_latest_ids[2] IS DISTINCT FROM p_source_message_id
       OR NOT EXISTS (
         SELECT 1
         FROM public.chat_messages AS confirmation
         WHERE confirmation.id = p_confirmation_message_id
           AND confirmation.couple_id = p_couple_id
           AND confirmation.sender_id = p_user_id
           AND confirmation.sender_type IN ('bride', 'groom')
           AND confirmation.role = 'user'
           AND confirmation.visibility = 'shared'
           AND COALESCE(confirmation.metadata ->> 'target', '') <> 'partner'
       ) THEN
      RAISE EXCEPTION 'AMORA_SHARED_ACTION_STALE_CONTEXT'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'actionId', p_action_id,
    'sourceMessageId', p_source_message_id,
    'tool', v_tool_name,
    'input', v_tool_input,
    'inputDigest', v_action ->> 'inputDigest',
    'operationKey', v_action ->> 'operationKey',
    'journeyRevision', v_expected_journey_revision,
    'policy', v_policy,
    'proposalDigest', v_proposal_digest,
    'rosterFingerprint', v_roster_fingerprint,
    'requiredCount', v_required_count,
    'partnerLinked', v_required_count = 2
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4) 일정 취소·복원이 멱등성 관문을 통과하게 한다. (기존 결함, 이 변경과 무관)
--
-- `claim_amora_tool_execution` 의 허용 도구 목록에 `cancel_schedule_event` 와
-- `restore_schedule_event` 가 없었다. 두 도구는 2026-08-02 에 들어왔는데 목록은
-- 2026-07-16 판 그대로였고, 은퇴한 `delete_schedule_event` 만 남아 있었다.
--
-- 그래서 아모라의 일정 취소는 **한 번도 반영된 적이 없다.** 카드는 정상적으로
-- 나오고, 사용자가 확인을 누르고, 도구까지 호출되고, 그다음 조용히 멈췄다:
--
--     "같은 변경이 두 번 들어가지 않게 확인하는 중에 문제가 생겨서,
--      아무것도 바꾸지 않고 멈췄어요."
--
-- 스테이징에서 일정을 실제로 하나 만들고 취소를 끝까지 눌러 보다가 찾았다.
-- 저장된 일정이 없으면 이 경로를 밟을 수 없어서 그동안 안 보였다.
--
-- 같은 허용 목록을 가진 오버로드 둘을 함께 고친다.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_amora_tool_execution(p_couple_id uuid, p_request_key text, p_operation_key text, p_tool_name text, p_input_digest text, p_request_attempt_count integer, p_pending_action_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '5s'
 SET statement_timeout TO '15s'
AS $function$
DECLARE
  v_execution public.amora_tool_executions%ROWTYPE;
  v_request public.amora_chat_request_claims%ROWTYPE;
  v_latest_context_message_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_TOOL_CLAIM_SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;

  IF p_couple_id IS NULL
     OR p_request_key !~* '^chat:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR p_operation_key !~ '^[0-9a-f]{64}$'
     OR p_input_digest !~ '^[0-9a-f]{64}$'
     OR p_request_attempt_count IS NULL
     OR p_request_attempt_count < 1
     OR p_tool_name NOT IN (
       'update_budget', 'update_wedding_date', 'update_task_status', 'update_venue',
       'update_category_budget', 'apply_budget_plan', 'add_custom_category',
       'delete_category', 'reset_category', 'add_schedule_event',
       'update_schedule_event', 'delete_schedule_event', 'toggle_checklist_item',
       'add_amora_action', 'update_amora_action', 'log_wedding_event',
       -- 2026-08-23: 이 둘이 목록에 없어서 아모라의 일정 취소·복원이 도입
       -- 이래로 한 번도 실행되지 못했다. 카드는 나오고, 사용자가 확인하고,
       -- 그다음 "같은 변경이 두 번 들어가지 않게 확인하는 중에 문제가 생겨서"
       -- 로 조용히 멈췄다. 은퇴한 `delete_schedule_event` 만 남아 있었다.
       'cancel_schedule_event', 'restore_schedule_event',
       'create_booking', 'cancel_booking'
     ) THEN
    RAISE EXCEPTION 'AMORA_TOOL_CLAIM_INVALID_INPUT' USING ERRCODE = '22023';
  END IF;

  -- This parent-row lock serializes all operation claims for one chat request
  -- and proves that this caller still owns the current attempt.
  SELECT claim.* INTO v_request
  FROM public.amora_chat_request_claims AS claim
  WHERE claim.couple_id = p_couple_id
    AND claim.request_key = p_request_key
  FOR UPDATE;

  IF NOT FOUND
     OR v_request.status <> 'processing'
     OR v_request.attempt_count <> p_request_attempt_count THEN
    RETURN jsonb_build_object('action', 'stale_attempt');
  END IF;

  SELECT execution.* INTO v_execution
  FROM public.amora_tool_executions AS execution
  WHERE execution.couple_id = p_couple_id
    AND execution.request_key = p_request_key
    AND execution.operation_key = p_operation_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_execution.tool_name <> p_tool_name
       OR v_execution.input_digest <> p_input_digest
       OR v_execution.pending_action_id IS DISTINCT FROM p_pending_action_id THEN
      RETURN jsonb_build_object('action', 'conflict');
    END IF;

    IF v_execution.status = 'completed' THEN
      RETURN jsonb_build_object('action', 'completed', 'result', v_execution.result);
    END IF;

    IF v_execution.status = 'uncertain' THEN
      RETURN jsonb_build_object('action', 'uncertain');
    END IF;

    IF v_execution.status = 'processing'
       AND v_execution.claimed_at < now() - interval '6 minutes' THEN
      UPDATE public.amora_tool_executions
      SET status = 'uncertain',
          uncertain_at = now(),
          failure_code = 'PROCESSING_LEASE_EXPIRED',
          updated_at = now()
      WHERE couple_id = p_couple_id
        AND request_key = p_request_key
        AND operation_key = p_operation_key
        AND status = 'processing';
      RETURN jsonb_build_object('action', 'uncertain');
    END IF;

    RETURN jsonb_build_object('action', 'in_progress');
  END IF;

  -- The action capability is couple-scoped rather than request-scoped. This
  -- lookup makes exact replays deterministic across partner accounts and
  -- request keys. The partial unique index below serializes the insert race.
  IF p_pending_action_id IS NOT NULL THEN
    SELECT execution.* INTO v_execution
    FROM public.amora_tool_executions AS execution
    WHERE execution.couple_id = p_couple_id
      AND execution.pending_action_id = p_pending_action_id
    FOR UPDATE;

    IF FOUND THEN
      IF v_execution.operation_key <> p_operation_key
         OR v_execution.tool_name <> p_tool_name
         OR v_execution.input_digest <> p_input_digest THEN
        RETURN jsonb_build_object('action', 'conflict');
      END IF;

      IF v_execution.status = 'completed' THEN
        RETURN jsonb_build_object('action', 'completed', 'result', v_execution.result);
      END IF;

      IF v_execution.status = 'uncertain' THEN
        RETURN jsonb_build_object('action', 'uncertain');
      END IF;

      IF v_execution.status = 'processing'
         AND v_execution.claimed_at < now() - interval '6 minutes' THEN
        UPDATE public.amora_tool_executions
        SET status = 'uncertain',
            uncertain_at = now(),
            failure_code = 'PROCESSING_LEASE_EXPIRED',
            updated_at = now()
        WHERE couple_id = v_execution.couple_id
          AND request_key = v_execution.request_key
          AND operation_key = v_execution.operation_key
          AND status = 'processing';
        RETURN jsonb_build_object('action', 'uncertain');
      END IF;

      RETURN jsonb_build_object('action', 'in_progress');
    END IF;
  END IF;

  -- A reclaimed attempt may only inspect/replay exact operations already in
  -- the ledger. To request a different mutation, the user must send a new
  -- client request id so intent is re-established explicitly.
  IF p_request_attempt_count > 1 THEN
    RETURN jsonb_build_object('action', 'retry_new_operation_blocked');
  END IF;

  -- Linearization point for a new mutation. chat_messages.couple_id has an
  -- immediate foreign key to this parent row, so FOR UPDATE conflicts with
  -- the key-share lock taken by a concurrent message insert. A message that
  -- started first commits before the query below; one that starts later waits
  -- until this mutation claim commits.
  PERFORM 1
  FROM public.couples AS couple
  WHERE couple.id = p_couple_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_request.user_message_id IS NULL
     OR v_request.visibility <> 'shared' THEN
    RETURN jsonb_build_object('action', 'stale_context');
  END IF;

  SELECT message.id
    INTO v_latest_context_message_id
  FROM public.chat_messages AS message
  WHERE message.couple_id = p_couple_id
    AND message.visibility = 'shared'
    AND COALESCE(message.metadata ->> 'target', '') <> 'partner'
  ORDER BY message.created_at DESC, message.id DESC
  LIMIT 1;

  IF v_latest_context_message_id IS DISTINCT FROM v_request.user_message_id
     OR NOT EXISTS (
       SELECT 1
       FROM public.chat_messages AS bound_message
       WHERE bound_message.id = v_request.user_message_id
         AND bound_message.couple_id = p_couple_id
         AND bound_message.sender_id = v_request.user_id
         AND bound_message.sender_type IN ('bride', 'groom')
         AND bound_message.role = 'user'
         AND bound_message.visibility = 'shared'
         AND COALESCE(bound_message.metadata ->> 'target', '') <> 'partner'
     ) THEN
    RETURN jsonb_build_object('action', 'stale_context');
  END IF;

  INSERT INTO public.amora_tool_executions (
    couple_id, request_key, operation_key, tool_name, input_digest,
    pending_action_id
  ) VALUES (
    p_couple_id, p_request_key, p_operation_key, p_tool_name, p_input_digest,
    p_pending_action_id
  )
  ON CONFLICT DO NOTHING
  RETURNING * INTO v_execution;

  IF FOUND THEN
    RETURN jsonb_build_object('action', 'acquired');
  END IF;

  -- A concurrent request won either the request-operation primary-key race or
  -- the pending-action unique-index race. Read the matching committed row via
  -- the applicable identity; `= NULL` must never turn a legacy exact replay
  -- into a false conflict.
  IF p_pending_action_id IS NULL THEN
    SELECT execution.* INTO v_execution
    FROM public.amora_tool_executions AS execution
    WHERE execution.couple_id = p_couple_id
      AND execution.request_key = p_request_key
      AND execution.operation_key = p_operation_key
    FOR UPDATE;
  ELSE
    SELECT execution.* INTO v_execution
    FROM public.amora_tool_executions AS execution
    WHERE execution.couple_id = p_couple_id
      AND execution.pending_action_id = p_pending_action_id
    FOR UPDATE;
  END IF;

  IF NOT FOUND
     OR v_execution.operation_key <> p_operation_key
     OR v_execution.tool_name <> p_tool_name
     OR v_execution.input_digest <> p_input_digest
     OR v_execution.pending_action_id IS DISTINCT FROM p_pending_action_id THEN
    RETURN jsonb_build_object('action', 'conflict');
  END IF;

  IF v_execution.status = 'completed' THEN
    RETURN jsonb_build_object('action', 'completed', 'result', v_execution.result);
  END IF;

  IF v_execution.status = 'uncertain' THEN
    RETURN jsonb_build_object('action', 'uncertain');
  END IF;

  RETURN jsonb_build_object('action', 'in_progress');
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_amora_tool_execution(p_couple_id uuid, p_request_key text, p_operation_key text, p_tool_name text, p_input_digest text, p_request_attempt_count integer, p_pending_action_id uuid, p_provider_call_index integer)
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
  v_authorized boolean := false;
  v_latest_context_message_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_TOOL_CLAIM_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF p_couple_id IS NULL
     OR p_request_key !~* '^chat:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR p_operation_key !~ '^[0-9a-f]{64}$'
     OR p_input_digest !~ '^[0-9a-f]{64}$'
     OR p_request_attempt_count IS NULL
     OR p_request_attempt_count < 1
     OR NOT (
       (
         p_pending_action_id IS NULL
         AND p_provider_call_index BETWEEN 1 AND 2
       )
       OR (
         p_pending_action_id IS NOT NULL
         AND p_provider_call_index IS NULL
       )
     )
     OR p_tool_name NOT IN (
       'update_budget', 'update_wedding_date', 'update_task_status', 'update_venue',
       'update_category_budget', 'apply_budget_plan', 'add_custom_category',
       'delete_category', 'reset_category', 'add_schedule_event',
       'update_schedule_event', 'delete_schedule_event', 'toggle_checklist_item',
       'add_amora_action', 'update_amora_action', 'log_wedding_event',
       -- 2026-08-23: 이 둘이 목록에 없어서 아모라의 일정 취소·복원이 도입
       -- 이래로 한 번도 실행되지 못했다. 카드는 나오고, 사용자가 확인하고,
       -- 그다음 "같은 변경이 두 번 들어가지 않게 확인하는 중에 문제가 생겨서"
       -- 로 조용히 멈췄다. 은퇴한 `delete_schedule_event` 만 남아 있었다.
       'cancel_schedule_event', 'restore_schedule_event',
       'create_booking', 'cancel_booking'
     ) THEN
    RAISE EXCEPTION 'AMORA_TOOL_CLAIM_INVALID_INPUT'
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
    RETURN jsonb_build_object('action', 'stale_attempt');
  END IF;

  IF p_pending_action_id IS NULL THEN
    IF v_request.tool_round_journal_expires_at <= now() THEN
      RETURN jsonb_build_object('action', 'stale_context');
    END IF;

    SELECT true INTO v_authorized
    FROM jsonb_array_elements(v_request.tool_round_journal) AS checkpoint(value)
    CROSS JOIN LATERAL jsonb_array_elements(
      checkpoint.value -> 'toolCalls'
    ) AS tool(value)
    WHERE checkpoint.value ->> 'callIndex' = p_provider_call_index::text
      AND tool.value ->> 'name' = p_tool_name
      AND tool.value ->> 'inputDigest' = p_input_digest
      AND tool.value ->> 'operationKey' = p_operation_key
    LIMIT 1;

    IF NOT COALESCE(v_authorized, false) THEN
      RETURN jsonb_build_object('action', 'stale_context');
    END IF;
  END IF;

  -- Retain the DB-linearized freshness check from the 0960 claim. The couples
  -- parent lock serializes against concurrent chat inserts through the
  -- immediate chat_messages.couple_id foreign key.
  PERFORM 1 FROM public.couples AS couple
  WHERE couple.id = p_couple_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_request.user_message_id IS NULL
     OR v_request.visibility <> 'shared' THEN
    RETURN jsonb_build_object('action', 'stale_context');
  END IF;

  SELECT message.id INTO v_latest_context_message_id
  FROM public.chat_messages AS message
  WHERE message.couple_id = p_couple_id
    AND message.visibility = 'shared'
    AND COALESCE(message.metadata ->> 'target', '') <> 'partner'
  ORDER BY message.created_at DESC, message.id DESC
  LIMIT 1;

  IF v_latest_context_message_id IS DISTINCT FROM v_request.user_message_id
     OR NOT EXISTS (
       SELECT 1 FROM public.chat_messages AS bound_message
       WHERE bound_message.id = v_request.user_message_id
         AND bound_message.couple_id = p_couple_id
         AND bound_message.sender_id = v_request.user_id
         AND bound_message.sender_type IN ('bride', 'groom')
         AND bound_message.role = 'user'
         AND bound_message.visibility = 'shared'
         AND COALESCE(bound_message.metadata ->> 'target', '') <> 'partner'
     ) THEN
    RETURN jsonb_build_object('action', 'stale_context');
  END IF;

  IF p_pending_action_id IS NULL THEN
    SELECT execution.* INTO v_execution
    FROM public.amora_tool_executions AS execution
    WHERE execution.couple_id = p_couple_id
      AND execution.request_key = p_request_key
      AND execution.operation_key = p_operation_key
    FOR UPDATE;
  ELSE
    SELECT execution.* INTO v_execution
    FROM public.amora_tool_executions AS execution
    WHERE execution.couple_id = p_couple_id
      AND execution.pending_action_id = p_pending_action_id
    FOR UPDATE;
  END IF;

  IF FOUND THEN
    IF v_execution.tool_name <> p_tool_name
       OR v_execution.input_digest <> p_input_digest
       OR v_execution.operation_key <> p_operation_key
       OR v_execution.pending_action_id IS DISTINCT FROM p_pending_action_id THEN
      RETURN jsonb_build_object('action', 'conflict');
    END IF;
    IF v_execution.status = 'completed' THEN
      RETURN jsonb_build_object(
        'action', 'completed', 'result', v_execution.result
      );
    END IF;
    IF v_execution.status = 'uncertain' OR NOT v_execution.atomic_dispatch THEN
      RETURN jsonb_build_object('action', 'uncertain');
    END IF;

    IF v_execution.request_key = p_request_key
       AND (
         v_execution.request_attempt_count < p_request_attempt_count
         OR v_execution.claimed_at < now() - interval '6 minutes'
       ) THEN
      UPDATE public.amora_tool_executions
      SET request_attempt_count = p_request_attempt_count,
          claimed_at = now(),
          updated_at = now()
      WHERE couple_id = v_execution.couple_id
        AND request_key = v_execution.request_key
        AND operation_key = v_execution.operation_key;
      RETURN jsonb_build_object('action', 'acquired');
    END IF;
    RETURN jsonb_build_object('action', 'in_progress');
  END IF;

  INSERT INTO public.amora_tool_executions (
    couple_id, request_key, operation_key, tool_name, input_digest,
    pending_action_id, atomic_dispatch, request_attempt_count
  ) VALUES (
    p_couple_id, p_request_key, p_operation_key, p_tool_name, p_input_digest,
    p_pending_action_id, true, p_request_attempt_count
  )
  ON CONFLICT DO NOTHING
  RETURNING * INTO v_execution;

  IF FOUND THEN
    RETURN jsonb_build_object('action', 'acquired');
  END IF;

  IF p_pending_action_id IS NULL THEN
    SELECT execution.* INTO v_execution
    FROM public.amora_tool_executions AS execution
    WHERE execution.couple_id = p_couple_id
      AND execution.request_key = p_request_key
      AND execution.operation_key = p_operation_key
    FOR UPDATE;
  ELSE
    SELECT execution.* INTO v_execution
    FROM public.amora_tool_executions AS execution
    WHERE execution.couple_id = p_couple_id
      AND execution.pending_action_id = p_pending_action_id
    FOR UPDATE;
  END IF;
  IF FOUND
     AND v_execution.operation_key = p_operation_key
     AND v_execution.tool_name = p_tool_name
     AND v_execution.input_digest = p_input_digest
     AND v_execution.pending_action_id IS NOT DISTINCT FROM p_pending_action_id
     AND v_execution.atomic_dispatch THEN
    IF v_execution.status = 'completed' THEN
      RETURN jsonb_build_object(
        'action', 'completed', 'result', v_execution.result
      );
    END IF;
    RETURN jsonb_build_object('action', 'in_progress');
  END IF;
  RETURN jsonb_build_object('action', 'conflict');
END;
$function$;

COMMIT;
