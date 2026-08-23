-- 20260823120000: 두 사람 승인을 없애고 상대에게 알림만 보낸다.
--
-- 2026-08-23 파운더 결정. 원문: "그냥 파트너가 뭘 추가하거나 뭘 변경했거나
-- 삭제했을 때 알림을 그냥 상단에 텍스트 메시지처럼 보여주면 되지 않을까?"
--
-- 승인 경로가 둘이라 둘 다 바꾼다.
--
--   1) 아모라 카드   — `amora_shared_action_policy` 가 'couple' 을 돌려주면
--                      `authorize_amora_shared_action_execution` 이 정족수를 본다.
--   2) 앱 직접 수정  — `couple_plan_change_is_high_impact` 가 true 면
--                      `submit_couple_plan_change` 가 required_count 를 2 로 잡는다.
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
-- 되돌리려면 이 파일의 두 함수를 예전 정의로 다시 CREATE OR REPLACE 하면 된다.
-- 예전 정의는 20260805120000(정책)과 20260731123000(고영향 판정)에 있다.

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
-- 2) 앱 직접 수정: 고영향 판정을 끈다.
--
-- 함수를 지우지 않고 false 를 돌려주게 둔다. 인자 8개 서명과 호출부를 그대로
-- 두어야 submit_couple_plan_change 를 다시 쓰지 않아도 되고, 되돌리기가 한
-- 파일로 끝난다.
--
-- 이미 pending 인 옛 요청 행은 is_high_impact 컬럼에 true 가 저장돼 있어
-- 예전 경로 그대로 승인된다. 고아가 되지 않는다.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.couple_plan_change_is_high_impact(
  p_old_wedding_date date,
  p_new_wedding_date date,
  p_old_venue text,
  p_new_venue text,
  p_old_total_budget bigint,
  p_new_total_budget bigint,
  p_old_progress jsonb,
  p_new_progress jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  -- 2026-08-23 파운더 결정: 두 사람 승인 없음. 모든 계획 변경이 1인 확인으로
  -- 반영되고 상대에게는 change_applied 알림이 간다.
  SELECT false;
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

COMMIT;
