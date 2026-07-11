-- 모바일 알림 종류별 설정과 토큰 폐기 수명주기가 실제 발송 경로에 연결되기 전까지
-- 과거 자동 등록 토큰을 비활성화한다. 명시적 opt-in 재도입 시 새 토큰을 등록한다.
UPDATE public.profiles
SET push_token = NULL
WHERE push_token IS NOT NULL;
