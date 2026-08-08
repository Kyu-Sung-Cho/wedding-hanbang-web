-- 개인별 아모라 도움 방식.
--
-- WeddingCode 원응답이나 성격·궁합 점수를 저장하지 않는다. 사용자가 직접
-- 확인한 다섯 가지 도움 방식만 보관하며, 커플 공동 계획과 분리된 본인 전용
-- singleton 행이다.
--
-- 롤백:
--   DROP FUNCTION public.clear_own_amora_personalization_preferences(bigint);
--   DROP FUNCTION public.set_own_amora_personalization_preferences(
--     bigint, text, text, text, text, text
--   );
--   DROP TABLE public.amora_personalization_preferences;

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE public.amora_personalization_preferences (
  owner_user_id uuid PRIMARY KEY
    REFERENCES public.profiles(id) ON DELETE CASCADE,
  decision_start text NOT NULL DEFAULT 'ask_each_time',
  answer_detail text NOT NULL DEFAULT 'adaptive',
  support_order text NOT NULL DEFAULT 'ask_each_time',
  work_mode text NOT NULL DEFAULT 'ask_each_time',
  family_order text NOT NULL DEFAULT 'ask_each_time',
  confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT amora_personalization_decision_start_check
    CHECK (decision_start IN (
      'recommend_first',
      'compare_first',
      'ask_each_time'
    )),
  CONSTRAINT amora_personalization_answer_detail_check
    CHECK (answer_detail IN ('brief', 'detailed', 'adaptive')),
  CONSTRAINT amora_personalization_support_order_check
    CHECK (support_order IN (
      'listen_first',
      'action_first',
      'ask_each_time'
    )),
  CONSTRAINT amora_personalization_work_mode_check
    CHECK (work_mode IN (
      'together',
      'owner_led',
      'hybrid',
      'ask_each_time'
    )),
  CONSTRAINT amora_personalization_family_order_check
    CHECK (family_order IN (
      'couple_first',
      'family_input_first',
      'case_by_case',
      'ask_each_time'
    )),
  CONSTRAINT amora_personalization_revision_check
    CHECK (revision BETWEEN 1 AND 9007199254740991)
);

ALTER TABLE public.amora_personalization_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amora_personalization_preferences FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS amora_personalization_select
  ON public.amora_personalization_preferences;
CREATE POLICY amora_personalization_select
  ON public.amora_personalization_preferences
  FOR SELECT
  TO authenticated
  USING (owner_user_id = (SELECT auth.uid()));

-- 브라우저와 service-role 모두 테이블을 직접 변경할 수 없다. 읽기는 본인
-- SELECT만 허용하고 변경은 아래의 auth.uid()-bound RPC만 통과한다.
REVOKE ALL ON TABLE public.amora_personalization_preferences
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.amora_personalization_preferences
  TO authenticated;

CREATE OR REPLACE FUNCTION public.set_own_amora_personalization_preferences(
  p_expected_revision bigint,
  p_decision_start text,
  p_answer_detail text,
  p_support_order text,
  p_work_mode text,
  p_family_order text
)
RETURNS TABLE (
  owner_user_id uuid,
  decision_start text,
  answer_detail text,
  support_order text,
  work_mode text,
  family_order text,
  confirmed_at timestamptz,
  revision bigint,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_owner_user_id uuid;
  v_current public.amora_personalization_preferences%ROWTYPE;
  v_now timestamptz;
BEGIN
  v_owner_user_id := auth.uid();
  IF v_owner_user_id IS NULL THEN
    RAISE EXCEPTION 'AMORA_PERSONALIZATION_AUTH_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF p_expected_revision IS NOT NULL
     AND p_expected_revision NOT BETWEEN 1 AND 9007199254740991 THEN
    RAISE EXCEPTION 'AMORA_PERSONALIZATION_INVALID_EXPECTED_REVISION'
      USING ERRCODE = '22023';
  END IF;

  IF p_decision_start IS NULL
     OR p_decision_start NOT IN (
       'recommend_first',
       'compare_first',
       'ask_each_time'
     )
     OR p_answer_detail IS NULL
     OR p_answer_detail NOT IN ('brief', 'detailed', 'adaptive')
     OR p_support_order IS NULL
     OR p_support_order NOT IN (
       'listen_first',
       'action_first',
       'ask_each_time'
     )
     OR p_work_mode IS NULL
     OR p_work_mode NOT IN (
       'together',
       'owner_led',
       'hybrid',
       'ask_each_time'
     )
     OR p_family_order IS NULL
     OR p_family_order NOT IN (
       'couple_first',
       'family_input_first',
       'case_by_case',
       'ask_each_time'
     ) THEN
    RAISE EXCEPTION 'AMORA_PERSONALIZATION_INVALID_PREFERENCES'
      USING ERRCODE = '22023';
  END IF;

  -- 같은 사용자의 insert/update/delete를 한 줄로 직렬화한다. advisory lock
  -- 뒤의 FOR UPDATE가 이미 존재하는 행에 대한 실제 row lock을 보장한다.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'amora-personalization-v1:' || v_owner_user_id::text,
      0
    )
  );

  SELECT preference.*
  INTO v_current
  FROM public.amora_personalization_preferences AS preference
  WHERE preference.owner_user_id = v_owner_user_id
  FOR UPDATE;

  IF FOUND THEN
    -- 네트워크 응답 유실 뒤 동일한 목표 상태를 다시 보내도 revision과
    -- confirmed_at을 올리지 않는다. 별도 client idempotency ledger가 필요 없다.
    IF ROW(
      v_current.decision_start,
      v_current.answer_detail,
      v_current.support_order,
      v_current.work_mode,
      v_current.family_order
    ) IS NOT DISTINCT FROM ROW(
      p_decision_start,
      p_answer_detail,
      p_support_order,
      p_work_mode,
      p_family_order
    ) THEN
      RETURN QUERY
      SELECT
        v_current.owner_user_id,
        v_current.decision_start,
        v_current.answer_detail,
        v_current.support_order,
        v_current.work_mode,
        v_current.family_order,
        v_current.confirmed_at,
        v_current.revision,
        v_current.updated_at;
      RETURN;
    END IF;

    IF p_expected_revision IS DISTINCT FROM v_current.revision THEN
      RAISE EXCEPTION 'AMORA_PERSONALIZATION_REVISION_CONFLICT'
        USING ERRCODE = '40001';
    END IF;

    IF v_current.revision >= 9007199254740991 THEN
      RAISE EXCEPTION 'AMORA_PERSONALIZATION_REVISION_EXHAUSTED'
        USING ERRCODE = '22003';
    END IF;

    v_now := clock_timestamp();
    UPDATE public.amora_personalization_preferences AS preference
    SET
      decision_start = p_decision_start,
      answer_detail = p_answer_detail,
      support_order = p_support_order,
      work_mode = p_work_mode,
      family_order = p_family_order,
      confirmed_at = v_now,
      revision = v_current.revision + 1,
      updated_at = v_now
    WHERE preference.owner_user_id = v_owner_user_id
      AND preference.revision = v_current.revision
    RETURNING preference.*
    INTO v_current;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'AMORA_PERSONALIZATION_REVISION_CONFLICT'
        USING ERRCODE = '40001';
    END IF;
  ELSE
    IF p_expected_revision IS NOT NULL THEN
      RAISE EXCEPTION 'AMORA_PERSONALIZATION_REVISION_CONFLICT'
        USING ERRCODE = '40001';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.profiles AS profile
      WHERE profile.id = v_owner_user_id
    ) THEN
      RAISE EXCEPTION 'AMORA_PERSONALIZATION_PROFILE_REQUIRED'
        USING ERRCODE = 'P0001';
    END IF;

    v_now := clock_timestamp();
    INSERT INTO public.amora_personalization_preferences (
      owner_user_id,
      decision_start,
      answer_detail,
      support_order,
      work_mode,
      family_order,
      confirmed_at,
      revision,
      created_at,
      updated_at
    )
    VALUES (
      v_owner_user_id,
      p_decision_start,
      p_answer_detail,
      p_support_order,
      p_work_mode,
      p_family_order,
      v_now,
      1,
      v_now,
      v_now
    )
    RETURNING *
    INTO v_current;
  END IF;

  RETURN QUERY
  SELECT
    v_current.owner_user_id,
    v_current.decision_start,
    v_current.answer_detail,
    v_current.support_order,
    v_current.work_mode,
    v_current.family_order,
    v_current.confirmed_at,
    v_current.revision,
    v_current.updated_at;
END;
$function$;

CREATE OR REPLACE FUNCTION public.clear_own_amora_personalization_preferences(
  p_expected_revision bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_owner_user_id uuid;
  v_current_revision bigint;
BEGIN
  v_owner_user_id := auth.uid();
  IF v_owner_user_id IS NULL THEN
    RAISE EXCEPTION 'AMORA_PERSONALIZATION_AUTH_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF p_expected_revision IS NOT NULL
     AND p_expected_revision NOT BETWEEN 1 AND 9007199254740991 THEN
    RAISE EXCEPTION 'AMORA_PERSONALIZATION_INVALID_EXPECTED_REVISION'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'amora-personalization-v1:' || v_owner_user_id::text,
      0
    )
  );

  SELECT preference.revision
  INTO v_current_revision
  FROM public.amora_personalization_preferences AS preference
  WHERE preference.owner_user_id = v_owner_user_id
  FOR UPDATE;

  -- 이미 지워졌다면 이전 DELETE 응답이 유실된 재시도일 수 있으므로 성공이다.
  IF NOT FOUND THEN
    RETURN true;
  END IF;

  IF p_expected_revision IS DISTINCT FROM v_current_revision THEN
    RAISE EXCEPTION 'AMORA_PERSONALIZATION_REVISION_CONFLICT'
      USING ERRCODE = '40001';
  END IF;

  DELETE FROM public.amora_personalization_preferences AS preference
  WHERE preference.owner_user_id = v_owner_user_id
    AND preference.revision = v_current_revision;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_PERSONALIZATION_REVISION_CONFLICT'
      USING ERRCODE = '40001';
  END IF;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION
  public.set_own_amora_personalization_preferences(
    bigint, text, text, text, text, text
  )
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.set_own_amora_personalization_preferences(
    bigint, text, text, text, text, text
  )
  TO authenticated;

REVOKE ALL ON FUNCTION
  public.clear_own_amora_personalization_preferences(bigint)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.clear_own_amora_personalization_preferences(bigint)
  TO authenticated;

COMMENT ON TABLE public.amora_personalization_preferences IS
  'Private singleton of five user-confirmed Amora help settings; never a personality or compatibility assessment.';
COMMENT ON FUNCTION
  public.set_own_amora_personalization_preferences(
    bigint, text, text, text, text, text
  )
  IS 'Full-state auth.uid()-owned CAS write; identical target retries preserve revision.';
COMMENT ON FUNCTION
  public.clear_own_amora_personalization_preferences(bigint)
  IS 'auth.uid()-owned CAS delete; an already-absent row is an idempotent success.';

COMMIT;
