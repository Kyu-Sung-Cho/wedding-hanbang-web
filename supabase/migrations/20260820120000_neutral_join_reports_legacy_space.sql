-- 20260820120000: 중립 join이 '기존(v1) 준비 공간'을 구분해서 알려준다.
--
-- 20260816180000의 join_neutral_preparation_space_server 는 초대 코드를
-- member_model_version = 2 로만 조회했다. 그래서 플래그를 켜는 순간 이미 발급된
-- v1 커플의 초대 코드가 전부 INVALID_INVITE_CODE 가 되고, 화면에는 "초대 코드가
-- 올바르지 않습니다"만 떴다. 파트너를 아직 연결하지 않은 기존 사용자는 영원히
-- 연결하지 못한다.
--
-- 기존 파일을 고치지 않고 함수만 교체한다 — 20260816180000 이 이미 적용된
-- 환경에서 원장 해시가 어긋나지 않게.
BEGIN;

CREATE OR REPLACE FUNCTION public.join_neutral_preparation_space_server(
  p_actor_user_id uuid,
  p_invite_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_code text := upper(btrim(COALESCE(p_invite_code, '')));
  v_profile_couple_id uuid;
  v_profile_role text;
  v_internal_role text;
  v_target_couple_id uuid;
  v_bride_id uuid;
  v_groom_id uuid;
  v_member_model_version smallint;
  v_membership_sealed_at timestamptz;
  v_result jsonb;
  v_result_couple_id uuid;
  v_post_profile_couple_id uuid;
  v_post_profile_role text;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'joined', false,
      'idempotent', false,
      'error_code', 'AUTH_REQUIRED',
      'error', 'Unauthenticated.'
    );
  END IF;

  IF v_code !~ '^WH-[A-Z0-9]{12}$' THEN
    RETURN jsonb_build_object(
      'success', false,
      'joined', false,
      'idempotent', false,
      'error_code', 'INVALID_INVITE_CODE',
      'error', 'Invalid invite code.'
    );
  END IF;

  SELECT profile.couple_id, profile.role
    INTO v_profile_couple_id, v_profile_role
  FROM public.profiles AS profile
  WHERE profile.id = p_actor_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'joined', false,
      'idempotent', false,
      'error_code', 'PROFILE_NOT_FOUND',
      'error', 'Profile not found.'
    );
  END IF;

  IF v_profile_couple_id IS NOT NULL THEN
    SELECT couple.id, couple.bride_id, couple.groom_id,
           couple.member_model_version, couple.membership_sealed_at
      INTO v_target_couple_id, v_bride_id, v_groom_id,
           v_member_model_version, v_membership_sealed_at
    FROM public.couples AS couple
    WHERE couple.id = v_profile_couple_id;

    IF NOT FOUND
       OR v_member_model_version <> 2
       OR v_profile_role NOT IN ('bride', 'groom')
       OR NOT (
         (v_profile_role = 'bride' AND v_bride_id = p_actor_user_id)
         OR (v_profile_role = 'groom' AND v_groom_id = p_actor_user_id)
       ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'joined', false,
        'idempotent', false,
        'error_code', 'ALREADY_LINKED',
        'error', 'This account is already linked.'
      );
    END IF;
    v_internal_role := v_profile_role;
  ELSE
    -- 버전으로 거르지 않고 먼저 찾는다. "틀린 코드"와 "맞는 코드인데 기존 방식"은
    -- 사용자가 할 일이 다르므로 같은 오류로 뭉치지 않는다.
    SELECT couple.id, couple.bride_id, couple.groom_id,
           couple.member_model_version, couple.membership_sealed_at
      INTO v_target_couple_id, v_bride_id, v_groom_id,
           v_member_model_version, v_membership_sealed_at
    FROM public.couples AS couple
    WHERE couple.invite_code = v_code;

    IF FOUND AND v_member_model_version <> 2 THEN
      RETURN jsonb_build_object(
        'success', false,
        'joined', false,
        'idempotent', false,
        'error_code', 'LEGACY_PREPARATION_SPACE',
        'error', 'Invite code belongs to a role-based preparation space.'
      );
    END IF;

    IF NOT FOUND
       OR v_membership_sealed_at IS NOT NULL
       OR ((v_bride_id IS NOT NULL)::integer + (v_groom_id IS NOT NULL)::integer) <> 1 THEN
      RETURN jsonb_build_object(
        'success', false,
        'joined', false,
        'idempotent', false,
        'error_code', 'INVALID_INVITE_CODE',
        'error', 'Invalid invite code.'
      );
    END IF;

    v_internal_role := CASE
      WHEN v_bride_id IS NULL THEN 'bride'
      ELSE 'groom'
    END;
  END IF;

  -- join_couple_server 는 core 를 그대로 넘기는 얇은 래퍼인데, 20260820130000 이
  -- 거기에 "v2 공간에는 역할로 합류 불가" 가드를 건다. 중립 합류가 그 가드에
  -- 걸리지 않도록 core 를 직접 부른다 — 호출 경로 'server' 는 동일하다.
  v_result := public.join_couple_invite_core(
    p_actor_user_id,
    v_code,
    v_internal_role,
    'server'
  );

  IF COALESCE(v_result ->> 'success', 'false') <> 'true' THEN
    RETURN v_result - 'role';
  END IF;

  v_result_couple_id := NULLIF(v_result ->> 'couple_id', '')::uuid;
  SELECT profile.couple_id, profile.role,
         couple.bride_id, couple.groom_id, couple.member_model_version
    INTO v_post_profile_couple_id, v_post_profile_role,
         v_bride_id, v_groom_id, v_member_model_version
  FROM public.profiles AS profile
  JOIN public.couples AS couple ON couple.id = profile.couple_id
  WHERE profile.id = p_actor_user_id;

  IF NOT FOUND
     OR v_result_couple_id IS NULL
     OR v_post_profile_couple_id IS DISTINCT FROM v_result_couple_id
     OR v_result_couple_id IS DISTINCT FROM v_target_couple_id
     OR v_member_model_version <> 2
     OR v_post_profile_role IS DISTINCT FROM v_internal_role
     OR NOT (
       (v_internal_role = 'bride' AND v_bride_id = p_actor_user_id)
       OR (v_internal_role = 'groom' AND v_groom_id = p_actor_user_id)
     ) THEN
    RAISE EXCEPTION 'NEUTRAL_PREPARATION_SPACE_JOIN_RESULT_INVALID'
      USING ERRCODE = '55000';
  END IF;

  RETURN (v_result - 'role') || jsonb_build_object('member_model_version', 2);
END
$function$;

ALTER FUNCTION public.join_neutral_preparation_space_server(uuid, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.join_neutral_preparation_space_server(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.join_neutral_preparation_space_server(uuid, text)
  TO service_role;

COMMIT;
