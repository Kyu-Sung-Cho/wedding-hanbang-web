-- =============================================
-- Realtime Publication: community_posts (2026-05-07)
-- =============================================
-- 증상: useCommunityRealtime 훅이 wired up 되어 있는데
-- 새 글이 다른 사용자 화면에 즉시 안 나타남.
-- 원인: community_posts가 supabase_realtime publication에 없어서
-- Supabase Realtime이 INSERT/UPDATE/DELETE 이벤트를 broadcast 안 함.
-- 해결: 명시적으로 publication에 추가.
-- =============================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'community_posts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE community_posts;
  END IF;
END $$;


-- =============================================
-- 검증:
--   SELECT pubname, tablename FROM pg_publication_tables
--   WHERE pubname = 'supabase_realtime' AND tablename = 'community_posts';
--   → 1 row 나와야 함
-- =============================================
