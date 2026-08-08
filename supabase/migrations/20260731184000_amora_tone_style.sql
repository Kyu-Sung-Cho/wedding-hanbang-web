-- 개인별 아모라 말투 설정을 기존 도움 방식에 추가한다.
--
-- 기존 5필드 RPC는 그대로 유지한다. 새 행은 adaptive로 시작하고, 기존 RPC로
-- 다른 도움 방식을 바꿀 때도 tone_style은 현재 값을 보존한다. 새 6필드 전체
-- 상태 저장만 v2 RPC를 사용한다.
--
-- 롤백:
--   DROP FUNCTION public.set_own_amora_personalization_preferences_v2(
--     bigint, text, text, text, text, text, text
--   );
--   ALTER TABLE public.amora_personalization_preferences
--     DROP CONSTRAINT amora_personalization_tone_style_check,
--     DROP COLUMN tone_style;

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.amora_personalization_preferences
  ADD COLUMN tone_style text NOT NULL DEFAULT 'adaptive',
  ADD CONSTRAINT amora_personalization_tone_style_check
    CHECK (tone_style IN ('adaptive', 'warm', 'calm_clear', 'friendly_honest'));

CREATE FUNCTION public.set_own_amora_personalization_preferences_v2(
  p_expected_revision bigint,
  p_decision_start text,
  p_answer_detail text,
  p_support_order text,
  p_work_mode text,
  p_family_order text,
  p_tone_style text
)
RETURNS TABLE (
  owner_user_id uuid,
  decision_start text,
  answer_detail text,
  support_order text,
  work_mode text,
  family_order text,
  tone_style text,
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
     )
     OR p_tone_style IS NULL
     OR p_tone_style NOT IN (
       'adaptive',
       'warm',
       'calm_clear',
       'friendly_honest'
     ) THEN
    RAISE EXCEPTION 'AMORA_PERSONALIZATION_INVALID_PREFERENCES'
      USING ERRCODE = '22023';
  END IF;

  -- 기존 5필드 RPC와 DELETE까지 같은 사용자 키로 직렬화한다.
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
    IF ROW(
      v_current.decision_start,
      v_current.answer_detail,
      v_current.support_order,
      v_current.work_mode,
      v_current.family_order,
      v_current.tone_style
    ) IS NOT DISTINCT FROM ROW(
      p_decision_start,
      p_answer_detail,
      p_support_order,
      p_work_mode,
      p_family_order,
      p_tone_style
    ) THEN
      RETURN QUERY
      SELECT
        v_current.owner_user_id,
        v_current.decision_start,
        v_current.answer_detail,
        v_current.support_order,
        v_current.work_mode,
        v_current.family_order,
        v_current.tone_style,
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
      tone_style = p_tone_style,
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
      tone_style,
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
      p_tone_style,
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
    v_current.tone_style,
    v_current.confirmed_at,
    v_current.revision,
    v_current.updated_at;
END;
$function$;

REVOKE ALL ON FUNCTION
  public.set_own_amora_personalization_preferences_v2(
    bigint, text, text, text, text, text, text
  )
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.set_own_amora_personalization_preferences_v2(
    bigint, text, text, text, text, text, text
  )
  TO authenticated;

COMMENT ON COLUMN public.amora_personalization_preferences.tone_style IS
  'User-confirmed expression style; always polite Korean and never an expertise, identity, or personality claim.';
COMMENT ON TABLE public.amora_personalization_preferences IS
  'Private singleton of six user-confirmed Amora help settings; never a personality or compatibility assessment.';
COMMENT ON FUNCTION
  public.set_own_amora_personalization_preferences_v2(
    bigint, text, text, text, text, text, text
  )
  IS 'Six-field auth.uid()-owned CAS write using the same lock and revision as the legacy five-field RPC.';

COMMIT;
