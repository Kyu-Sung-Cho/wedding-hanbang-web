-- 웨딩코드 커플 토큰 — 경량 페어링 (미러 프로필 v0, 지시서 §6).
-- 무의미 난수(UUID v4)만 저장, PII 없음. 페어는 최대 2행 규칙(3번째 제출부터는
-- 토큰 무시하고 일반 저장)을 API 레이어에서 강제한다.
-- 비교 리포트 화면은 이번 스코프 아님 — 페어링 저장까지만.

ALTER TABLE public.wedding_code_responses
  ADD COLUMN IF NOT EXISTS couple_token UUID;

CREATE INDEX IF NOT EXISTS idx_wc_responses_couple_token
  ON public.wedding_code_responses (couple_token)
  WHERE couple_token IS NOT NULL;

COMMENT ON COLUMN public.wedding_code_responses.couple_token IS
  '커플 페어링용 무의미 난수 토큰(UUID v4) — 최대 2행/토큰, API에서 강제';
