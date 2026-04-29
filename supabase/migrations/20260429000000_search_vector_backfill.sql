-- =============================================
-- community_posts.search_vector 백필 (2026-04-29)
-- =============================================
-- 목적: 20260325_community.sql에서 trigger는 추가됐지만
--       기존 row 중 search_vector가 NULL인 케이스(데이터 시드 시점 trigger 누락 등)를
--       강제로 1회 update해서 인덱스가 정상 동작하도록 함.
-- 안전성:
--   - 비파괴(NULL인 row만 대상)
--   - trigger가 자동 갱신이므로 SET이 명시적이지 않아도 됨 (UPDATE 자체가 trigger fire)
-- =============================================

-- 1. 기존 NULL 백필 (trigger가 자동으로 search_vector 채움)
UPDATE community_posts
SET updated_at = updated_at  -- no-op update, trigger fires
WHERE search_vector IS NULL;

-- 2. 안전망: trigger가 어떤 이유로 실행되지 않은 경우 직접 채움
UPDATE community_posts
SET search_vector = to_tsvector(
  'simple',
  coalesce(title, '') || ' ' || coalesce(content, '') || ' ' || array_to_string(coalesce(tags, '{}'), ' ')
)
WHERE search_vector IS NULL;

-- =============================================
-- 검증 쿼리 (수동 실행):
--   SELECT COUNT(*) FROM community_posts WHERE search_vector IS NULL;
--   → 0이어야 정상
-- =============================================
