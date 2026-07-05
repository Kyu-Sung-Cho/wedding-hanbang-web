-- 아모라 케어 알림(아웃바운드) 수신 설정 — "먼저 연락하는 친언니" 채널의 opt-out.
-- 모멘트(상견례·청첩장 모임 등 D-3/D-1/D+1)를 크론이 이메일로 먼저 보내는데,
-- 서비스 이용 안내(본인이 입력한 일정 리마인더)라도 끄고 싶은 사용자는 끌 수 있어야
-- 신뢰가 유지된다. 기본 켬(사용자 일정 기반 케어가 제품 본체이므로).
-- profiles는 authenticated 직접 쓰기가 REVOKE된 테이블 — 변경은 /api/profile PATCH(service_role)만.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS care_notifications_enabled BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.profiles.care_notifications_enabled IS
  '아모라 케어 아웃바운드(모멘트 이메일 등) 수신 여부 — 설정>알림에서 토글';
