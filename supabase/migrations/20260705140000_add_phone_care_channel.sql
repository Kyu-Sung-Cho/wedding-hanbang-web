-- 전화번호 수집 배선 — 카카오 알림톡/문자 케어 채널의 선행 작업.
-- phone: 숫자만 저장(01X + 7~8자리), 형식은 CHECK로 잠금.
-- phone_care_consented_at: 카톡·문자 채널 수신 동의 시각(법적 기록) — null=미동의.
--   번호를 지우면 동의도 함께 해제된다(/api/profile 라우트에서 강제).
-- profiles는 authenticated 직접 쓰기 REVOKE 상태 — 변경은 PATCH 라우트(service_role)만.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS phone_care_consented_at TIMESTAMPTZ;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_phone_format_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_phone_format_check
  CHECK (phone IS NULL OR phone ~ '^01[016789][0-9]{7,8}$');

COMMENT ON COLUMN public.profiles.phone IS
  '휴대폰 번호(숫자만) — 알림톡/문자 케어 채널용. 설정>알림에서 본인 입력';
COMMENT ON COLUMN public.profiles.phone_care_consented_at IS
  '카톡·문자 케어 수신 동의 시각 — null=미동의. 번호 삭제 시 함께 해제';
