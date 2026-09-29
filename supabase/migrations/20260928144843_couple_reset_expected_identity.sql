-- 새 확인 화면이 승인한 계정·커플을 같은 잠금 아래 검증한다.
-- 기존 호출자의 호환성을 위해 reset_current_couple_membership()은 변경하지 않는다.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.reset_expected_couple_membership(
  p_expected_user_id uuid,
  p_expected_couple_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_couple_id uuid;
BEGIN
  IF v_user_id IS NULL
     OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;

  -- 기존 reset RPC와 같은 profile -> couple 순서다. 이 잠금은 내부 RPC의
  -- 재조회·분리 작업이 끝날 때까지 유지되어 검증 뒤 커플이 바뀌지 않는다.
  SELECT profile.couple_id
  INTO v_couple_id
  FROM public.profiles AS profile
  WHERE profile.id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF p_expected_user_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'couple_reset_user_changed' USING ERRCODE = 'P0001';
  END IF;
  IF p_expected_couple_id IS DISTINCT FROM v_couple_id THEN
    RAISE EXCEPTION 'couple_reset_couple_changed' USING ERRCODE = 'P0001';
  END IF;

  RETURN public.reset_current_couple_membership();
END;
$function$;

ALTER FUNCTION public.reset_expected_couple_membership(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reset_expected_couple_membership(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reset_expected_couple_membership(uuid, uuid)
  TO authenticated;

DO $$
BEGIN
  IF NOT has_function_privilege('authenticated',
       'public.reset_expected_couple_membership(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('anon',
       'public.reset_expected_couple_membership(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('service_role',
       'public.reset_expected_couple_membership(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'EXPECTED_COUPLE_RESET_ACL_INVALID';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.reset_expected_couple_membership(uuid, uuid) IS
  'Checks the confirmed actor and couple under a profile row lock before the existing atomic reset.';
