BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- 본인이 고른 표시 역할이다. 가입 슬롯·사진·권한과 독립적으로 보관한다.
CREATE TABLE public.profile_wedding_roles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  confirmed_role text CHECK (confirmed_role IN ('bride', 'groom')),
  revision uuid NOT NULL DEFAULT gen_random_uuid(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.profile_wedding_roles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.profile_wedding_roles FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.profile_wedding_roles TO service_role;

CREATE FUNCTION public.save_profile_wedding_role(p_user_id uuid, p_confirmed_role text, p_expected_revision uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_current public.profile_wedding_roles;
BEGIN
  IF p_user_id IS NULL OR (p_confirmed_role IS NOT NULL AND p_confirmed_role NOT IN ('bride', 'groom')) THEN
    RAISE EXCEPTION 'PROFILE_ROLE_INVALID';
  END IF;
  -- 계정 삭제와 같은 소유자 잠금. 잠금 뒤 사용자 존재와 삭제 접수를 다시 확인한다.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'PROFILE_ROLE_OWNER_MISSING';
  END IF;
  IF EXISTS (SELECT 1 FROM public.account_deletion_jobs WHERE user_id = p_user_id AND status <> 'completed') THEN
    RAISE EXCEPTION 'PROFILE_ROLE_DELETION_PENDING';
  END IF;
  SELECT * INTO v_current FROM public.profile_wedding_roles WHERE user_id = p_user_id FOR UPDATE;
  IF v_current.revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'PROFILE_ROLE_CONFLICT';
  END IF;
  INSERT INTO public.profile_wedding_roles(user_id, confirmed_role, revision)
    VALUES (p_user_id, p_confirmed_role, pg_catalog.gen_random_uuid())
    ON CONFLICT (user_id) DO UPDATE SET confirmed_role = EXCLUDED.confirmed_role,
      revision = EXCLUDED.revision, updated_at = clock_timestamp()
    RETURNING * INTO v_current;
  RETURN jsonb_build_object('user_id', v_current.user_id, 'confirmed_role', v_current.confirmed_role, 'revision', v_current.revision);
END;
$$;
REVOKE ALL ON FUNCTION public.save_profile_wedding_role(uuid,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_profile_wedding_role(uuid,text,uuid) TO service_role;

-- 하나의 snapshot에서 현재 양쪽 프로필과 커플 슬롯이 모두 일치하는 상대만 반환한다.
CREATE FUNCTION public.read_profile_wedding_roles(p_user_id uuid)
RETURNS TABLE(user_id uuid, confirmed_role text, revision uuid, couple_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH owner AS (
    SELECT u.id, p.couple_id FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id WHERE u.id = p_user_id
  ), visible_users AS (
    SELECT o.id, o.couple_id FROM owner o
    UNION
    SELECT p.id, p.couple_id FROM owner o
      JOIN public.couples c ON c.id = o.couple_id AND o.id IN (c.bride_id, c.groom_id)
      JOIN public.profiles p ON p.id = CASE WHEN c.bride_id = o.id THEN c.groom_id ELSE c.bride_id END
        AND p.couple_id = c.id AND p.id <> o.id
      JOIN auth.users u ON u.id = p.id
  )
  SELECT v.id, r.confirmed_role, r.revision, v.couple_id FROM visible_users v
    LEFT JOIN public.profile_wedding_roles r ON r.user_id = v.id;
$$;
REVOKE ALL ON FUNCTION public.read_profile_wedding_roles(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_profile_wedding_roles(uuid) TO service_role;

COMMIT;
