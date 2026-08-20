-- 20260820130000: 역할 기반 합류가 중립 준비 공간(v2)을 건드리지 못하게 한다.
--
-- join_couple_invite_core 는 member_model_version 을 보지 않는다. 그래서 웹에서
-- 플래그를 켜도, 구버전 앱을 쓰는 사람은 v2 커플에 'bride'/'groom' 을 박은 채
-- 합류할 수 있었다 — 역할을 묻지 않기로 한 공간에 역할이 생긴다.
-- 앱 스토어 배포와 플래그 on 사이의 사고 구간을 DB에서 닫는다.
--
-- core(459줄)를 복제하지 않고 진입점 두 개만 감싼다. 복제하면 원본이 바뀔 때
-- 조용히 갈라진다. 중립 join(join_neutral_preparation_space_server)은 이 core 를
-- 쓰지 않으므로 영향이 없다.
BEGIN;

-- 코드가 v2 공간을 가리키는지 판정한다. 코드가 없거나 v1 이면 false 다.
CREATE OR REPLACE FUNCTION public.couple_invite_targets_neutral_space(
  p_invite_code text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.couples AS couple
    WHERE couple.invite_code = upper(btrim(COALESCE(p_invite_code, '')))
      AND couple.member_model_version = 2
  )
$function$;

ALTER FUNCTION public.couple_invite_targets_neutral_space(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.couple_invite_targets_neutral_space(text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.join_couple_server(
  p_actor_user_id uuid,
  p_invite_code text,
  p_role text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
  SELECT CASE
    WHEN public.couple_invite_targets_neutral_space(p_invite_code) THEN
      jsonb_build_object(
        'success', false, 'joined', false, 'idempotent', false,
        'error_code', 'NEUTRAL_PREPARATION_SPACE',
        'error', 'This space does not use roles.'
      )
    ELSE
      public.join_couple_invite_core(
        p_actor_user_id,
        p_invite_code,
        p_role,
        'server'
      )
  END
$function$;

ALTER FUNCTION public.join_couple_server(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.join_couple_server(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.join_couple_server(uuid, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.join_couple(
  p_invite_code text,
  p_role text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
  SELECT CASE
    WHEN public.couple_invite_targets_neutral_space(p_invite_code) THEN
      jsonb_build_object(
        'success', false, 'joined', false, 'idempotent', false,
        'error_code', 'NEUTRAL_PREPARATION_SPACE',
        'error', 'This space does not use roles.'
      )
    ELSE
      public.join_couple_invite_core(
        auth.uid(),
        p_invite_code,
        p_role,
        'legacy'
      )
  END
$function$;

ALTER FUNCTION public.join_couple(text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.join_couple(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.join_couple(text, text)
  TO authenticated;

DO $postconditions$
BEGIN
  IF pg_catalog.to_regprocedure(
       'public.couple_invite_targets_neutral_space(text)'
     ) IS NULL THEN
    RAISE EXCEPTION 'NEUTRAL_SPACE_JOIN_GUARD_MISSING';
  END IF;
END
$postconditions$;

COMMIT;
