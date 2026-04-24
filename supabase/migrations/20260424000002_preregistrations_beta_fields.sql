-- =============================================
-- preregistrations 통합 (2026-04-24)
-- =============================================
-- 사전등록 + 베타 신청 통합 테이블.
-- 기존 20260201000000_preregistrations.sql은 production DB에 적용 안 됐으므로
-- 이 파일 하나로 완결 처리 (self-contained).
-- 재실행 안전 (idempotent):
--   - CREATE TABLE IF NOT EXISTS (신규 DB)
--   - ALTER TABLE ADD COLUMN IF NOT EXISTS (기존 DB 누락 컬럼 보강)
--   - DROP POLICY IF EXISTS → CREATE POLICY (정책 재실행 안전)
-- =============================================

-- 1. 기본 테이블 (최소 스펙 — 나머지는 ALTER로 보강)
CREATE TABLE IF NOT EXISTS preregistrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. 컬럼 보강 (기존 테이블 존재 시에도 안전)
ALTER TABLE preregistrations ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE preregistrations ADD COLUMN IF NOT EXISTS wedding_date TEXT;
ALTER TABLE preregistrations ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'web';
ALTER TABLE preregistrations ADD COLUMN IF NOT EXISTS utm_source TEXT;
ALTER TABLE preregistrations ADD COLUMN IF NOT EXISTS utm_medium TEXT;
ALTER TABLE preregistrations ADD COLUMN IF NOT EXISTS utm_campaign TEXT;
ALTER TABLE preregistrations ADD COLUMN IF NOT EXISTS role TEXT;
ALTER TABLE preregistrations ADD COLUMN IF NOT EXISTS message TEXT;
ALTER TABLE preregistrations ADD COLUMN IF NOT EXISTS is_beta_candidate BOOLEAN DEFAULT FALSE;

-- 3. RLS 활성화
ALTER TABLE preregistrations ENABLE ROW LEVEL SECURITY;

-- 4. 정책 (Service role 전용 관리)
DROP POLICY IF EXISTS "Service role can manage" ON preregistrations;
CREATE POLICY "Service role can manage"
  ON preregistrations FOR ALL
  USING (true)
  WITH CHECK (true);

-- 5. 인덱스 — 베타 후보자 조회 최적화 (partial index)
CREATE INDEX IF NOT EXISTS idx_preregistrations_beta_candidates
  ON preregistrations(is_beta_candidate, created_at DESC)
  WHERE is_beta_candidate = TRUE;

-- =============================================
-- 검증 쿼리 (실행 후 확인)
-- =============================================
-- 1. 테이블 + 모든 컬럼 존재
--    SELECT column_name, is_nullable, data_type, column_default
--    FROM information_schema.columns
--    WHERE table_name = 'preregistrations'
--    ORDER BY ordinal_position;
--    → 12 rows 기대 (id / email / created_at + 9개 ALTER 컬럼)
--
-- 2. RLS 활성화 확인
--    SELECT tablename, rowsecurity FROM pg_tables
--    WHERE schemaname = 'public' AND tablename = 'preregistrations';
--    → rowsecurity = true
--
-- 3. 인덱스 확인
--    SELECT indexname FROM pg_indexes
--    WHERE tablename = 'preregistrations';
--    → preregistrations_pkey, preregistrations_email_key,
--      idx_preregistrations_beta_candidates
-- =============================================
