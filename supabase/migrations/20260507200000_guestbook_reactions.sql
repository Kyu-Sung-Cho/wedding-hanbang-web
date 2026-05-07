-- =============================================
-- Guestbook Message Reactions (2026-05-07)
-- 이모지 리액션: 익명 IP 기반 dedup
-- =============================================
-- 시나리오: 메시지 작성 안 해도 "❤️ 🥰 😭" 한 번 누름 = 가벼운 참여
-- 비로그인 게스트 대상이라 user_id 없음 → ip_hash로 중복 방지
-- =============================================

CREATE TABLE IF NOT EXISTS guestbook_message_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES guestbook_messages(id) ON DELETE CASCADE,
  reaction_type TEXT NOT NULL CHECK (reaction_type IN ('love', 'congrats', 'touched')),
  ip_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(message_id, reaction_type, ip_hash)
);

CREATE INDEX IF NOT EXISTS idx_gb_reactions_message
  ON guestbook_message_reactions(message_id, reaction_type);

ALTER TABLE guestbook_message_reactions ENABLE ROW LEVEL SECURITY;

-- SELECT는 누구나 (집계용) — 부모 메시지가 보이는지는 앱에서 체크
DROP POLICY IF EXISTS "gb_reactions_select" ON guestbook_message_reactions;
CREATE POLICY "gb_reactions_select"
  ON guestbook_message_reactions FOR SELECT
  USING (TRUE);

-- INSERT/DELETE는 service role만 (앱에서 IP rate limit + 검증 후 처리)
-- 클라이언트 직접 INSERT 차단 (정책 없음 = 자동 거부)


-- =============================================
-- 검증:
--   SELECT count(*) FROM guestbook_message_reactions;  → 0 (초기)
--   INSERT INTO guestbook_message_reactions(message_id, reaction_type, ip_hash)
--     VALUES (some_msg_id, 'love', 'test_hash');  → service role로만 가능
-- =============================================
