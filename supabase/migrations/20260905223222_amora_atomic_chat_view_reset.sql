-- 화면 정리와 답변 저장을 같은 privacy epoch 순서로 직렬화한다.
-- shared-clear-request의 요청 메시지 시점 계약은 바꾸지 않는다.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preconditions$
BEGIN
  IF to_regprocedure('public.get_own_amora_privacy_epoch(uuid,text)') IS NULL
     OR to_regprocedure('public.capture_amora_profile_privacy_epoch()') IS NULL
     OR to_regclass('public.amora_privacy_context_epochs') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_trigger
       WHERE tgrelid = 'public.profiles'::regclass
         AND tgname = 'trg_amora_privacy_epoch_profiles'
         AND tgfoid = to_regprocedure('public.capture_amora_profile_privacy_epoch()')
         AND tgenabled IN ('O', 'A')
     )
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'profiles'
         AND column_name = 'shared_chat_cleared_at'
     )
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'profiles'
         AND column_name = 'private_chat_cleared_at'
     ) THEN
    RAISE EXCEPTION 'AMORA_CHAT_VIEW_RESET_PRIVACY_BASELINE_REQUIRED';
  END IF;
END;
$preconditions$;

-- 기존 roster 경계에 화면 커서 변경도 포함한다. 다른 reset RPC가 쓰는
-- 과거 시점 커서는 그대로 두고, 진행 중인 답변만 새 epoch로 무효화한다.
CREATE OR REPLACE FUNCTION public.capture_amora_profile_privacy_epoch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_old_couple_id uuid;
  v_new_couple_id uuid;
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.couple_id IS NOT DISTINCT FROM NEW.couple_id
     AND OLD.role IS NOT DISTINCT FROM NEW.role
     AND OLD.shared_chat_cleared_at IS NOT DISTINCT FROM NEW.shared_chat_cleared_at
     AND OLD.private_chat_cleared_at IS NOT DISTINCT FROM NEW.private_chat_cleared_at THEN
    RETURN NEW;
  END IF;

  IF TG_OP <> 'INSERT'
     AND public.is_amora_profile_roster_binding(OLD.id, OLD.couple_id, OLD.role) THEN
    v_old_couple_id := OLD.couple_id;
  END IF;
  IF TG_OP <> 'DELETE'
     AND public.is_amora_profile_roster_binding(NEW.id, NEW.couple_id, NEW.role) THEN
    v_new_couple_id := NEW.couple_id;
  END IF;

  PERFORM public.advance_amora_privacy_context_epoch(v_old_couple_id);
  IF v_new_couple_id IS DISTINCT FROM v_old_couple_id THEN
    PERFORM public.advance_amora_privacy_context_epoch(v_new_couple_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;
ALTER FUNCTION public.capture_amora_profile_privacy_epoch() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.capture_amora_profile_privacy_epoch()
  FROM PUBLIC, anon, authenticated, service_role;

-- STABLE 한 statement snapshot에서 커서와 epoch를 함께 읽는다.
-- 옛 cursor 조회와 새 epoch 조회가 섞이는 요청 시작 경쟁을 막는다.
CREATE FUNCTION public.get_own_amora_chat_view_snapshot(
  p_couple_id uuid,
  p_visibility text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '5s'
AS $function$
DECLARE
  v_epoch bigint;
  v_shared timestamptz;
  v_private timestamptz;
BEGIN
  v_epoch := public.get_own_amora_privacy_epoch(p_couple_id, p_visibility);
  SELECT profile.shared_chat_cleared_at, profile.private_chat_cleared_at
  INTO v_shared, v_private
  FROM public.profiles AS profile
  WHERE profile.id = auth.uid() AND profile.couple_id = p_couple_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_CHAT_VIEW_SCOPE_DENIED' USING ERRCODE = '42501';
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'version', 1, 'privacyEpoch', v_epoch,
    'shared', v_shared, 'private', v_private
  );
END;
$function$;
ALTER FUNCTION public.get_own_amora_chat_view_snapshot(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_own_amora_chat_view_snapshot(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_own_amora_chat_view_snapshot(uuid, text)
  TO authenticated;

CREATE FUNCTION public.reset_own_amora_chat_view(
  p_couple_id uuid,
  p_scope text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_role text;
  v_visibility text;
  v_previous_cursor timestamptz;
  v_cleared_at timestamptz;
  v_epoch bigint;
  v_next_epoch bigint;
BEGIN
  IF v_user_id IS NULL OR p_couple_id IS NULL
     OR p_scope IS NULL OR p_scope NOT IN ('shared', 'private') THEN
    RAISE EXCEPTION 'AMORA_CHAT_VIEW_SCOPE_DENIED' USING ERRCODE = '42501';
  END IF;

  -- 프로필 변경 경로와 같은 profile -> epoch 순서. 커서 시각은 epoch 잠금을
  -- 얻은 뒤에 정하므로 먼저 저장을 마친 답변까지 확실히 화면에서 제외된다.
  SELECT profile.role,
    CASE WHEN p_scope = 'shared'
      THEN profile.shared_chat_cleared_at ELSE profile.private_chat_cleared_at END
  INTO v_role, v_previous_cursor
  FROM public.profiles AS profile
  WHERE profile.id = v_user_id AND profile.couple_id = p_couple_id
  FOR NO KEY UPDATE;
  IF NOT FOUND OR v_role IS NULL OR v_role NOT IN ('bride', 'groom') THEN
    RAISE EXCEPTION 'AMORA_CHAT_VIEW_SCOPE_DENIED' USING ERRCODE = '42501';
  END IF;
  v_visibility := CASE WHEN p_scope = 'shared' THEN 'shared' ELSE v_role || '_private' END;

  PERFORM 1 FROM public.amora_privacy_context_epochs
  WHERE couple_id = p_couple_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_PRIVACY_CONTEXT_EPOCH_MISSING';
  END IF;
  -- 잠금을 기다리는 사이 roster가 바뀌었으면 현재 권한으로 거절한다.
  v_epoch := public.get_own_amora_privacy_epoch(p_couple_id, v_visibility);
  v_cleared_at := GREATEST(
    pg_catalog.clock_timestamp(),
    v_previous_cursor + interval '1 microsecond'
  );
  IF p_scope = 'shared' THEN
    UPDATE public.profiles SET shared_chat_cleared_at = v_cleared_at WHERE id = v_user_id;
  ELSE
    UPDATE public.profiles SET private_chat_cleared_at = v_cleared_at WHERE id = v_user_id;
  END IF;
  SELECT epoch INTO v_next_epoch FROM public.amora_privacy_context_epochs WHERE couple_id = p_couple_id;
  IF v_next_epoch IS NULL OR v_next_epoch <= v_epoch THEN
    RAISE EXCEPTION 'AMORA_CHAT_VIEW_RESET_EPOCH_NOT_ADVANCED';
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'success', true, 'scope', p_scope, 'clearedAt', v_cleared_at, 'privacyEpoch', v_next_epoch
  );
END;
$function$;
ALTER FUNCTION public.reset_own_amora_chat_view(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reset_own_amora_chat_view(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reset_own_amora_chat_view(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.get_own_amora_chat_view_snapshot(uuid, text)
  IS 'Authenticated current-roster view cursors and privacy epoch from one statement snapshot; no chat content.';
COMMENT ON FUNCTION public.reset_own_amora_chat_view(uuid, text)
  IS 'Authenticated own-screen reset; profile then privacy-epoch lock, server clock cursor, no message or memory deletion.';
COMMIT;
