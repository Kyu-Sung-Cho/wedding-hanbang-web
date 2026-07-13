-- 선제 이메일·문자·알림톡은 명시적 동의 원장, 즉시 철회, 중복 방지 E2E가
-- 모두 검증되기 전까지 발송하지 않는다. 과거 기본값(true)으로 생성된 프로필도
-- 안전한 false로 정규화한다. 이 migration은 데이터 삭제 없이 opt-in 상태만 해제한다.

ALTER TABLE public.profiles
  ALTER COLUMN care_notifications_enabled SET DEFAULT false;

UPDATE public.profiles
SET
  care_notifications_enabled = false,
  phone_care_consented_at = NULL
WHERE care_notifications_enabled IS DISTINCT FROM false
   OR phone_care_consented_at IS NOT NULL;

COMMENT ON COLUMN public.profiles.care_notifications_enabled IS
  '아모라 선제 아웃바운드 수신 여부. 기능 출시 전 기본값·기존값 모두 false';

COMMENT ON COLUMN public.profiles.phone IS
  '업체 상담 예약 요청 연락처(숫자만). 아모라 자동 알림에는 사용하지 않음';

COMMENT ON COLUMN public.profiles.phone_care_consented_at IS
  '문자·알림톡 수신 동의 시각. 선제 알림 기능 출시 전에는 항상 null';
