-- =============================================
-- preregistrations — 베타 신청 필드 추가 (2026-04-24)
-- =============================================
-- 베타 50쌍 모집용 추가 필드 (/beta 페이지)
-- 기존 컬럼 (email/name/wedding_date)은 유지.
-- 재실행 안전: ALTER TABLE ADD COLUMN IF NOT EXISTS
-- =============================================

ALTER TABLE preregistrations ADD COLUMN IF NOT EXISTS role TEXT;
  -- 'bride' | 'groom' | null

ALTER TABLE preregistrations ADD COLUMN IF NOT EXISTS message TEXT;
  -- 사용자 자유 메모 (베타 신청 이유 등)

ALTER TABLE preregistrations ADD COLUMN IF NOT EXISTS is_beta_candidate BOOLEAN DEFAULT FALSE;
  -- '베타' 신청 여부 구분 (기존 사전등록과 분리)

CREATE INDEX IF NOT EXISTS idx_preregistrations_beta_candidates
  ON preregistrations(is_beta_candidate, created_at DESC)
  WHERE is_beta_candidate = TRUE;
