-- 20260820150000: 만료된 초대 코드를 "코드가 틀렸다"고 말하지 않는다.
--
-- 20260812030000 이 초대 코드에 7일 창을 붙였다. 만료 자체는 그 마이그레이션의
-- 의도이고 되돌리지 않는다. 문제는 말이다: join_couple_invite_core 가 만료를
-- INVALID_INVITE_CODE 로 뭉쳐서 돌려주고, 화면은 "초대 코드가 올바르지 않습니다.
-- 코드를 다시 확인해주세요" 를 띄운다. 코드를 다시 봐도 맞게 적혀 있으니 사람은
-- 오타를 의심하며 반복 시도하고, 10분 10회 제한까지 걸린다. 정작 해야 할 일은
-- "초대한 사람에게 새 코드를 받는 것"인데 화면 어디에도 그 말이 없다.
--
-- 20260820120000 이 같은 이유로 LEGACY_PREPARATION_SPACE 를 갈라놨다.
-- 여기서는 만료를 가른다.
--
-- ## 이게 코드 탐색 오라클이 되지 않는가
--
-- 되지 않는다. EXPIRED 를 들으려면 이미 그 15자를 손에 쥐고 있어야 하고
-- (36^12 공간), 그 앞에 DB 레이트리밋(10분 10회, 행위자 단위)이 그대로 있다.
-- 그리고 sealed 커플이 보관 중인 코드는 invite_code_issued_at 이 NULL 이라
-- 이 조회에 아예 걸리지 않는다 - 끝난 커플의 옛 코드는 여전히 INVALID 다.
-- 즉 새로 새는 사실은 "내가 가진 이 코드가 한때 진짜였다" 하나뿐인데,
-- 그건 초대받은 본인이 알아야 하는 사실이다.
--
-- ## 파일을 새로 만드는 이유
--
-- 20260812030000 은 이미 릴리스 계약에 hash 로 고정돼 있다. 20260820120000 이
-- 쓴 방법과 같이, 원본은 두고 함수만 교체한다. 래퍼(join_couple_server /
-- join_couple)는 건드리지 않는다 - 20260820130000 이 거기에 중립공간 가드를
-- 걸어놨고, core 만 바꾸면 두 경로 모두 같은 사실을 말하게 된다.

-- ## 배포 순서 (지키지 않으면 지금보다 나빠진다)
--
-- **앱을 먼저 배포하고 이 마이그레이션을 나중에 적용한다.**
-- 반대로 하면, 현재 배포된 앱은 INVITE_CODE_EXPIRED 를 모르므로
-- membershipRpc 의 failureFor 폴백으로 떨어져 HTTP 500 "커플 연결을 완료하지
-- 못했습니다. 잠시 후 다시 시도해주세요" 를 낸다. 지금의 404 "코드가 올바르지
-- 않습니다" 보다 덜 실행 가능하고(이 마이그레이션이 없애려던 반복 시도 루프를
-- 오히려 부추긴다) 5xx 알람까지 켠다.
--
-- 앱이 먼저 나가는 순서는 안전하다 - 새 코드가 안 오면 기존 분기가 그대로 돈다.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $preconditions$
BEGIN
  IF pg_catalog.to_regprocedure(
       'public.join_couple_invite_core(uuid,text,text,text)'
     ) IS NULL THEN
    RAISE EXCEPTION 'INVITE_EXPIRY_TRUTH_CONSUMER_MISSING';
  END IF;

  IF NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public.couples'::regclass
         AND attname IN ('invite_code_issued_at', 'invite_code_expires_at')
         AND NOT attisdropped
       HAVING count(*) = 2
     ) THEN
    RAISE EXCEPTION 'INVITE_EXPIRY_TRUTH_LIFECYCLE_COLUMNS_MISSING';
  END IF;

  IF NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_constraint
       WHERE conrelid = 'public.couples'::regclass
         AND conname = 'couples_invite_lifecycle_valid'
         AND contype = 'c'
         AND convalidated
     ) THEN
    RAISE EXCEPTION 'INVITE_EXPIRY_TRUTH_LIFECYCLE_CONSTRAINT_INVALID';
  END IF;
END
$preconditions$;

CREATE OR REPLACE FUNCTION public.join_couple_invite_core(
  p_actor_user_id uuid,
  p_invite_code text,
  p_role text,
  p_call_path text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_now timestamptz := transaction_timestamp();
  v_code text := upper(btrim(COALESCE(p_invite_code, '')));
  v_role text := lower(btrim(COALESCE(p_role, '')));
  v_code_sha256 text;
  v_profile_couple_id uuid;
  v_profile_role text;
  v_slot_count integer;
  v_has_canonical_occurrence boolean;
  v_attempt_count integer;
  v_window_started_at timestamptz;
  v_retry_after_seconds integer;
  v_redemption public.couple_invite_redemptions%ROWTYPE;
  v_redemption_found boolean := false;
  v_couple_id uuid;
  v_invite_code text;
  v_invite_expires_at timestamptz;
  v_locked_couple_found boolean := false;
  v_bride_id uuid;
  v_groom_id uuid;
  v_membership_sealed_at timestamptz;
  v_owner_user_id uuid;
  v_owner_role text;
  v_updated_id uuid;
  v_profile_rows integer;
BEGIN
  IF p_call_path NOT IN ('server', 'legacy') THEN
    RAISE EXCEPTION 'COUPLE_INVITE_CALL_PATH_INVALID' USING ERRCODE = '22023';
  END IF;

  IF p_actor_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false, 'joined', false, 'idempotent', false,
      'error_code', 'AUTH_REQUIRED', 'error', 'Unauthenticated.'
    );
  END IF;

  IF v_role NOT IN ('bride', 'groom') THEN
    RETURN jsonb_build_object(
      'success', false, 'joined', false, 'idempotent', false,
      'error_code', 'INVALID_ROLE', 'error', 'Invalid role.'
    );
  END IF;

  IF v_code !~ '^WH-[A-Z0-9]{12}$' THEN
    RETURN jsonb_build_object(
      'success', false, 'joined', false, 'idempotent', false,
      'error_code', 'INVALID_INVITE_CODE', 'error', 'Invalid invite code.'
    );
  END IF;

  -- This first profile read is intentionally non-locking. Active-code joins
  -- later take the incumbent profile, joining profile, and couple locks in
  -- that order so they cannot deadlock with reset_current_couple_membership.
  SELECT profile.couple_id, profile.role
    INTO v_profile_couple_id, v_profile_role
  FROM public.profiles AS profile
  WHERE profile.id = p_actor_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false, 'joined', false, 'idempotent', false,
      'error_code', 'PROFILE_NOT_FOUND', 'error', 'Profile not found.'
    );
  END IF;

  v_code_sha256 := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_code, 'UTF8'), 'sha256'),
    'hex'
  );

  SELECT redemption.*
    INTO v_redemption
  FROM public.couple_invite_redemptions AS redemption
  WHERE redemption.invite_code_sha256 = v_code_sha256
  FOR UPDATE;
  v_redemption_found := FOUND;

  -- A retry by the exact actor is a read of its durable success receipt, not a
  -- new guess. It must remain available even after invalid-attempt exhaustion.
  IF v_redemption_found THEN
    SELECT joining_profile.couple_id, joining_profile.role
      INTO v_profile_couple_id, v_profile_role
    FROM public.profiles AS joining_profile
    WHERE joining_profile.id = p_actor_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'success', false, 'joined', false, 'idempotent', false,
        'error_code', 'PROFILE_NOT_FOUND', 'error', 'Profile not found.'
      );
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.profiles AS profile
      JOIN public.couples AS couple ON couple.id = profile.couple_id
      WHERE profile.id = p_actor_user_id
        AND profile.couple_id = v_redemption.couple_id
        AND profile.role = v_redemption.redeemed_role
        AND (
          (profile.role = 'bride' AND couple.bride_id = profile.id)
          OR (profile.role = 'groom' AND couple.groom_id = profile.id)
        )
    ) INTO v_has_canonical_occurrence;

    IF v_redemption.redeemed_by = p_actor_user_id
       AND v_redemption.redeemed_role = v_role
       AND v_has_canonical_occurrence THEN
      IF p_call_path = 'server' THEN
        UPDATE public.couple_invite_join_runtime_state
        SET last_server_attempt_at = v_now,
            last_server_success_at = v_now,
            updated_at = v_now
        WHERE singleton;
      ELSE
        UPDATE public.couple_invite_join_runtime_state
        SET last_legacy_attempt_at = v_now,
            last_legacy_success_at = v_now,
            updated_at = v_now
        WHERE singleton;
      END IF;
      RETURN jsonb_build_object(
        'success', true, 'joined', false, 'idempotent', true,
        'actor_user_id', p_actor_user_id,
        'couple_id', v_redemption.couple_id,
        'role', v_role,
        'invite_code', v_code
      );
    END IF;
  END IF;

  -- An actor that already has any canonical membership cannot join again. Do
  -- this before active-code lookup so its own state cannot become a validity
  -- oracle. The exact actor's durable redemption receipt above remains the
  -- sole idempotent exception.
  SELECT count(*)::integer
    INTO v_slot_count
  FROM (
    SELECT couple.id FROM public.couples AS couple
    WHERE couple.bride_id = p_actor_user_id
    UNION ALL
    SELECT couple.id FROM public.couples AS couple
    WHERE couple.groom_id = p_actor_user_id
  ) AS occurrence;

  IF v_profile_couple_id IS NOT NULL OR v_slot_count <> 0 THEN
    RETURN jsonb_build_object(
      'success', false, 'joined', false, 'idempotent', false,
      'error_code', 'ALREADY_LINKED',
      'error', 'This account is already linked to another couple.'
    );
  END IF;

  INSERT INTO public.couple_invite_join_attempts(
    actor_user_id, window_started_at, attempt_count, last_attempt_at, updated_at
  ) VALUES (
    p_actor_user_id, v_now, 1, v_now, v_now
  )
  ON CONFLICT (actor_user_id) DO UPDATE
  SET window_started_at = CASE
        WHEN couple_invite_join_attempts.window_started_at <= v_now - interval '10 minutes'
          THEN v_now
        ELSE couple_invite_join_attempts.window_started_at
      END,
      attempt_count = CASE
        WHEN couple_invite_join_attempts.window_started_at <= v_now - interval '10 minutes'
          THEN 1
        ELSE LEAST(couple_invite_join_attempts.attempt_count + 1, 2147483647)
      END,
      last_attempt_at = v_now,
      updated_at = v_now
  RETURNING attempt_count, window_started_at
    INTO v_attempt_count, v_window_started_at;

  IF v_attempt_count > 10 THEN
    v_retry_after_seconds := GREATEST(
      1,
      CEIL(EXTRACT(epoch FROM (
        v_window_started_at + interval '10 minutes' - v_now
      )))::integer
    );
    RETURN jsonb_build_object(
      'success', false, 'joined', false, 'idempotent', false,
      'error_code', 'RATE_LIMITED', 'error', 'Too many invite attempts.',
      'retry_after_seconds', v_retry_after_seconds
    );
  END IF;

  IF v_redemption_found THEN
    RETURN jsonb_build_object(
      'success', false, 'joined', false, 'idempotent', false,
      'error_code', 'INVALID_INVITE_CODE', 'error', 'Invalid invite code.'
    );
  END IF;

  -- Discover the incumbent without locking the couple. Taking the couple row
  -- here would invert reset_current_couple_membership's profile -> couple
  -- order. Every value is re-read and revalidated after the canonical locks.
  SELECT candidate_couple.id, candidate_couple.invite_code,
         candidate_couple.invite_code_expires_at,
         candidate_couple.bride_id, candidate_couple.groom_id,
         candidate_couple.membership_sealed_at
    INTO v_couple_id, v_invite_code, v_invite_expires_at,
         v_bride_id, v_groom_id, v_membership_sealed_at
  FROM public.couples AS candidate_couple
  WHERE candidate_couple.invite_code = v_code
    AND candidate_couple.invite_code_issued_at IS NOT NULL;

  IF NOT FOUND
     OR v_membership_sealed_at IS NOT NULL
     OR ((v_bride_id IS NOT NULL)::integer + (v_groom_id IS NOT NULL)::integer) <> 1 THEN
    RETURN jsonb_build_object(
      'success', false, 'joined', false, 'idempotent', false,
      'error_code', 'INVALID_INVITE_CODE', 'error', 'Invalid invite code.'
    );
  END IF;

  -- 만료는 오타가 아니다. 여기까지 온 코드는 실재하고, 아직 한 사람이 기다리는
  -- 초대였다. 이걸 'INVALID_INVITE_CODE' 로 뭉치면 상대는 자기 손가락을 의심하며
  -- 같은 코드를 다시 친다 - 몇 번을 다시 쳐도 되지 않고, 10분 10회 제한에 걸린다.
  -- 만료를 만료라고 말해야 "새 코드를 받아라" 라는 다음 행동이 나온다.
  IF v_invite_expires_at IS NULL OR v_invite_expires_at <= v_now THEN
    RETURN jsonb_build_object(
      'success', false, 'joined', false, 'idempotent', false,
      'error_code', 'INVITE_CODE_EXPIRED', 'error', 'Invite code expired.'
    );
  END IF;

  IF v_bride_id IS NOT NULL THEN
    v_owner_user_id := v_bride_id;
    v_owner_role := 'bride';
    IF v_role <> 'groom' THEN
      RETURN jsonb_build_object(
        'success', false, 'joined', false, 'idempotent', false,
        'error_code', 'INVALID_INVITE_CODE', 'error', 'Invalid invite code.'
      );
    END IF;
  ELSE
    v_owner_user_id := v_groom_id;
    v_owner_role := 'groom';
    IF v_role <> 'bride' THEN
      RETURN jsonb_build_object(
        'success', false, 'joined', false, 'idempotent', false,
        'error_code', 'INVALID_INVITE_CODE', 'error', 'Invalid invite code.'
      );
    END IF;
  END IF;

  IF p_actor_user_id = v_owner_user_id THEN
    RETURN jsonb_build_object(
      'success', false, 'joined', false, 'idempotent', false,
      'error_code', 'INVALID_INVITE_CODE', 'error', 'Invalid invite code.'
    );
  END IF;

  -- Canonical active-join order: incumbent profile -> joining profile ->
  -- couple-scoped reset advisory lock -> couple row. A concurrent owner reset
  -- either finishes before this block or waits before taking the couple row;
  -- neither side can hold the couple while waiting for the other's profile.
  PERFORM incumbent_profile.id
  FROM public.profiles AS incumbent_profile
  WHERE incumbent_profile.id = v_owner_user_id
    AND incumbent_profile.couple_id = v_couple_id
    AND incumbent_profile.role = v_owner_role
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false, 'joined', false, 'idempotent', false,
      'error_code', 'INVALID_INVITE_CODE', 'error', 'Invalid invite code.'
    );
  END IF;

  SELECT joining_profile.couple_id, joining_profile.role
    INTO v_profile_couple_id, v_profile_role
  FROM public.profiles AS joining_profile
  WHERE joining_profile.id = p_actor_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false, 'joined', false, 'idempotent', false,
      'error_code', 'PROFILE_NOT_FOUND', 'error', 'Profile not found.'
    );
  END IF;

  SELECT count(*)::integer
    INTO v_slot_count
  FROM (
    SELECT couple.id FROM public.couples AS couple
    WHERE couple.bride_id = p_actor_user_id
    UNION ALL
    SELECT couple.id FROM public.couples AS couple
    WHERE couple.groom_id = p_actor_user_id
  ) AS occurrence;

  IF v_profile_couple_id IS NOT NULL OR v_slot_count <> 0 THEN
    RETURN jsonb_build_object(
      'success', false, 'joined', false, 'idempotent', false,
      'error_code', 'ALREADY_LINKED',
      'error', 'This account is already linked to another couple.'
    );
  END IF;

  IF v_profile_role IS NOT NULL AND v_profile_role <> v_role THEN
    RETURN jsonb_build_object(
      'success', false, 'joined', false, 'idempotent', false,
      'error_code', 'INVALID_INVITE_CODE', 'error', 'Invalid invite code.'
    );
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_couple_id::text, 0)
  );

  SELECT locked_couple.id, locked_couple.invite_code,
         locked_couple.invite_code_expires_at,
         locked_couple.bride_id, locked_couple.groom_id,
         locked_couple.membership_sealed_at
    INTO v_couple_id, v_invite_code, v_invite_expires_at,
         v_bride_id, v_groom_id, v_membership_sealed_at
  FROM public.couples AS locked_couple
  WHERE locked_couple.id = v_couple_id
    AND locked_couple.invite_code = v_code
    AND locked_couple.invite_code_issued_at IS NOT NULL
  FOR UPDATE;

  v_locked_couple_found := FOUND;
  -- The transaction can wait first for the advisory lock and then for this
  -- couple row. Refresh only after both locks are owned so a code that expires
  -- during either wait cannot pass the final revalidation or UPDATE.
  v_now := clock_timestamp();

  IF NOT v_locked_couple_found
     OR v_membership_sealed_at IS NOT NULL
     OR ((v_bride_id IS NOT NULL)::integer + (v_groom_id IS NOT NULL)::integer) <> 1
     OR (
       v_owner_role = 'bride'
       AND (
         v_bride_id IS DISTINCT FROM v_owner_user_id
         OR v_groom_id IS NOT NULL
       )
     )
     OR (
       v_owner_role = 'groom'
       AND (
         v_groom_id IS DISTINCT FROM v_owner_user_id
         OR v_bride_id IS NOT NULL
       )
     ) THEN
    RETURN jsonb_build_object(
      'success', false, 'joined', false, 'idempotent', false,
      'error_code', 'INVALID_INVITE_CODE', 'error', 'Invalid invite code.'
    );
  END IF;

  -- 두 락을 기다리는 동안 창이 닫힐 수 있다. 같은 사실이므로 같은 말을 한다.
  IF v_invite_expires_at IS NULL OR v_invite_expires_at <= v_now THEN
    RETURN jsonb_build_object(
      'success', false, 'joined', false, 'idempotent', false,
      'error_code', 'INVITE_CODE_EXPIRED', 'error', 'Invite code expired.'
    );
  END IF;

  PERFORM pg_catalog.set_config('hanbang.allow_membership_write', 'on', true);
  v_updated_id := NULL;

  IF v_role = 'bride' THEN
    UPDATE public.couples
    SET bride_id = p_actor_user_id,
        invite_code = NULL,
        updated_at = v_now
    WHERE id = v_couple_id
      AND membership_sealed_at IS NULL
      AND invite_code = v_code
      AND invite_code_expires_at > v_now
      AND bride_id IS NULL
      AND groom_id = v_owner_user_id
    RETURNING id INTO v_updated_id;
  ELSE
    UPDATE public.couples
    SET groom_id = p_actor_user_id,
        invite_code = NULL,
        updated_at = v_now
    WHERE id = v_couple_id
      AND membership_sealed_at IS NULL
      AND invite_code = v_code
      AND invite_code_expires_at > v_now
      AND groom_id IS NULL
      AND bride_id = v_owner_user_id
    RETURNING id INTO v_updated_id;
  END IF;

  IF v_updated_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false, 'joined', false, 'idempotent', false,
      'error_code', 'INVALID_INVITE_CODE', 'error', 'Invalid invite code.'
    );
  END IF;

  INSERT INTO public.couple_invite_redemptions(
    invite_code_sha256, couple_id, redeemed_by, redeemed_role,
    redeemed_at, original_expires_at
  ) VALUES (
    v_code_sha256, v_couple_id, p_actor_user_id, v_role,
    v_now, v_invite_expires_at
  );

  UPDATE public.profiles
  SET couple_id = v_couple_id,
      role = v_role,
      updated_at = v_now
  WHERE id = p_actor_user_id
    AND couple_id IS NOT DISTINCT FROM v_profile_couple_id
    AND role IS NOT DISTINCT FROM v_profile_role;

  GET DIAGNOSTICS v_profile_rows = ROW_COUNT;
  IF v_profile_rows <> 1 THEN
    RAISE EXCEPTION 'JOIN_COUPLE_PROFILE_UPDATE_FAILED' USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1
  FROM public.profiles AS profile
  JOIN public.couples AS couple ON couple.id = profile.couple_id
  WHERE profile.id = p_actor_user_id
    AND profile.couple_id = v_couple_id
    AND profile.role = v_role
    AND couple.membership_sealed_at IS NOT NULL
    AND couple.invite_code IS NULL
    AND (
      (v_role = 'bride' AND couple.bride_id = p_actor_user_id)
      OR (v_role = 'groom' AND couple.groom_id = p_actor_user_id)
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'JOIN_COUPLE_POSTCONDITION_FAILED' USING ERRCODE = 'P0001';
  END IF;

  IF p_call_path = 'server' THEN
    UPDATE public.couple_invite_join_runtime_state
    SET last_server_attempt_at = v_now,
        last_server_success_at = v_now,
        updated_at = v_now
    WHERE singleton;
  ELSE
    UPDATE public.couple_invite_join_runtime_state
    SET last_legacy_attempt_at = v_now,
        last_legacy_success_at = v_now,
        updated_at = v_now
    WHERE singleton;
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'joined', true, 'idempotent', false,
    'actor_user_id', p_actor_user_id,
    'couple_id', v_couple_id,
    'role', v_role,
    'invite_code', v_code
  );
END
$function$;

ALTER FUNCTION public.join_couple_invite_core(uuid, text, text, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.join_couple_invite_core(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

DO $postconditions$
DECLARE
  v_definition text := pg_catalog.pg_get_functiondef(
    'public.join_couple_invite_core(uuid,text,text,text)'::regprocedure
  );
BEGIN
  -- 새 사실을 말할 수 있는가.
  IF v_definition !~ 'INVITE_CODE_EXPIRED' THEN
    RAISE EXCEPTION 'INVITE_EXPIRY_TRUTH_NOT_APPLIED';
  END IF;

  -- 만료된 코드로는 여전히 합류할 수 없어야 한다. 말만 바꾸고 문을 열어두면
  -- replay hardening 을 무른 것이 된다.
  --
  -- 두 표현을 따로 센다. 최종 UPDATE 두 곳은 'invite_code_expires_at > v_now',
  -- 락을 잡은 뒤의 재검증은 'v_invite_expires_at <= v_now' 로 문장이 다르다.
  -- 앞 것만 세면 뒤 것을 통째로 지워도 이 사후조건이 조용히 통과한다.
  IF pg_catalog.array_length(
       pg_catalog.string_to_array(v_definition, 'invite_code_expires_at > v_now'), 1
     ) < 3 THEN
    RAISE EXCEPTION 'INVITE_EXPIRY_TRUTH_WINDOW_LOST';
  END IF;

  IF pg_catalog.array_length(
       pg_catalog.string_to_array(v_definition, 'v_invite_expires_at <= v_now'), 1
     ) < 3 THEN
    RAISE EXCEPTION 'INVITE_EXPIRY_TRUTH_RECHECK_LOST';
  END IF;

  -- 20260818110000 이 이 문자열로 소비자 드리프트를 판정한다.
  IF v_definition !~ 'invite_code[[:space:]]*=[[:space:]]*NULL' THEN
    RAISE EXCEPTION 'INVITE_EXPIRY_TRUTH_NULLABLE_CONTRACT_LOST';
  END IF;

  -- core 는 계속 직접 호출 불가여야 하고, 래퍼 두 개는 그대로여야 한다.
  IF pg_catalog.has_function_privilege(
       'authenticated', 'public.join_couple_invite_core(uuid,text,text,text)', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon', 'public.join_couple_invite_core(uuid,text,text,text)', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role', 'public.join_couple_invite_core(uuid,text,text,text)', 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'service_role', 'public.join_couple_server(uuid,text,text)', 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'authenticated', 'public.join_couple(text,text)', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon', 'public.join_couple(text,text)', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'INVITE_EXPIRY_TRUTH_ACL_INVALID';
  END IF;
END
$postconditions$;

COMMIT;
