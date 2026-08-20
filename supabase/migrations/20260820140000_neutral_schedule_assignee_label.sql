-- 20260820140000: 일정 담당자 라벨이 성별을 요약문에 굳혀 저장하지 않게 한다.
--
-- amora_manual_schedule_assignee_label 은 담당자를 커플 로스터 슬롯과 대조해
-- '예비 신부'/'예비 신랑' 문자열을 만든다. role 컬럼조차 보지 않고 슬롯만으로
-- 성별이 생긴다. 그 문자열은 couple_plan_change_requests.summary 에 저장되고,
-- 알림 문구로 복사돼 화면에 뜬다.
--
-- 저장 경로라서 나중에 고치면 이미 저장된 행은 안 고쳐진다. 그래서 플래그를
-- 켜기 전에 넣는다.
--
-- IMMUTABLE -> STABLE 로 바꾼다. 커플의 member_model_version 과 이름을 읽어야
-- 하기 때문이다. 이 함수는 인덱스·생성컬럼에 쓰이지 않아(실측) 안전하다.
BEGIN;

CREATE OR REPLACE FUNCTION public.amora_manual_schedule_assignee_label(
  p_assignee jsonb,
  p_bride_id uuid,
  p_groom_id uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_profile_id uuid;
  v_neutral boolean := false;
  v_name text;
BEGIN
  IF p_assignee IS NULL OR p_assignee = 'null'::jsonb THEN
    RETURN '확인 필요';
  END IF;
  IF p_assignee ->> 'kind' = 'couple' THEN
    RETURN '함께';
  END IF;
  IF p_assignee ->> 'kind' = 'external' THEN
    RETURN '외부 ' || (p_assignee ->> 'label');
  END IF;
  IF p_assignee ->> 'kind' = 'member' THEN
    v_profile_id := (p_assignee ->> 'profileId')::uuid;

    SELECT couple.member_model_version = 2
      INTO v_neutral
    FROM public.couples AS couple
    WHERE (p_bride_id IS NOT NULL AND couple.bride_id = p_bride_id)
       OR (p_groom_id IS NOT NULL AND couple.groom_id = p_groom_id)
    LIMIT 1;
    v_neutral := COALESCE(v_neutral, false);

    IF v_neutral THEN
      -- 역할을 고른 적 없는 사람에게 성별 라벨을 붙이지 않는다. 이 요약은
      -- 두 사람만 보므로 이름이 가장 분명하다.
      SELECT profile.name INTO v_name
      FROM public.profiles AS profile
      WHERE profile.id = v_profile_id;

      IF v_name IS NOT NULL AND btrim(v_name) <> '' THEN
        RETURN v_name;
      END IF;
      -- 이름이 없으면 슬롯을 노출하지 않으면서 두 사람을 구분한다.
      IF v_profile_id = p_bride_id THEN
        RETURN '구성원 1';
      END IF;
      IF v_profile_id = p_groom_id THEN
        RETURN '구성원 2';
      END IF;
      RETURN '확인 필요';
    END IF;

    IF v_profile_id = p_bride_id THEN
      RETURN '예비 신부';
    END IF;
    IF v_profile_id = p_groom_id THEN
      RETURN '예비 신랑';
    END IF;
  END IF;
  RETURN '확인 필요';
EXCEPTION WHEN OTHERS THEN
  RETURN '확인 필요';
END;
$function$;

ALTER FUNCTION public.amora_manual_schedule_assignee_label(jsonb, uuid, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.amora_manual_schedule_assignee_label(jsonb, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
