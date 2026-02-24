-- ============================================
-- 관리자 역할 추가
-- ============================================

-- profiles 테이블에 is_admin 컬럼 추가
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;

-- 인덱스 추가 (관리자 조회 최적화)
CREATE INDEX IF NOT EXISTS idx_profiles_is_admin ON profiles (is_admin) WHERE is_admin = true;
