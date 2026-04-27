-- =============================================
-- chat_messages + decision_nodes private visibility
-- =============================================
-- 신부/신랑이 각자 아모라에게 단독으로 고민을 털어놓을 수 있는 private 채팅 지원.
-- visibility:
--   'shared'         (default) — 신부·신랑·아모라 모두 SELECT 가능
--   'bride_private'  — 신부 + 아모라만. 신랑 SELECT 불가.
--   'groom_private'  — 신랑 + 아모라만. 신부 SELECT 불가.
--
-- RLS로 강제 → Realtime/폴링도 이를 따름. 파트너가 우회해서 못 봄.
-- =============================================

-- 1. chat_messages.visibility
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS visibility TEXT
  DEFAULT 'shared'
  CHECK (visibility IN ('shared', 'bride_private', 'groom_private'));

UPDATE chat_messages SET visibility = 'shared' WHERE visibility IS NULL;
ALTER TABLE chat_messages ALTER COLUMN visibility SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_messages_couple_visibility
  ON chat_messages(couple_id, visibility);

-- 2. decision_nodes.visibility (메모리도 visibility 격리)
ALTER TABLE decision_nodes ADD COLUMN IF NOT EXISTS visibility TEXT
  DEFAULT 'shared'
  CHECK (visibility IN ('shared', 'bride_private', 'groom_private'));

UPDATE decision_nodes SET visibility = 'shared' WHERE visibility IS NULL;
ALTER TABLE decision_nodes ALTER COLUMN visibility SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_decision_nodes_couple_visibility
  ON decision_nodes(couple_id, visibility);

-- 3. chat_messages SELECT RLS — visibility 반영
DROP POLICY IF EXISTS "chat_select_couple" ON chat_messages;
DROP POLICY IF EXISTS "chat_select_with_privacy" ON chat_messages;
CREATE POLICY "chat_select_with_privacy" ON chat_messages FOR SELECT
USING (
  couple_id IN (
    SELECT id FROM couples
    WHERE bride_id = auth.uid() OR groom_id = auth.uid()
  )
  AND (
    visibility = 'shared'
    OR (
      visibility = 'bride_private'
      AND EXISTS (
        SELECT 1 FROM couples
        WHERE id = chat_messages.couple_id AND bride_id = auth.uid()
      )
    )
    OR (
      visibility = 'groom_private'
      AND EXISTS (
        SELECT 1 FROM couples
        WHERE id = chat_messages.couple_id AND groom_id = auth.uid()
      )
    )
  )
);

-- 4. decision_nodes SELECT RLS — 같은 패턴
-- (기존 policy 이름은 환경 따라 다를 수 있음 — IF EXISTS로 방어)
DROP POLICY IF EXISTS "decision_nodes_select" ON decision_nodes;
DROP POLICY IF EXISTS "decision_select_couple" ON decision_nodes;
DROP POLICY IF EXISTS "decision_nodes_select_with_privacy" ON decision_nodes;
CREATE POLICY "decision_nodes_select_with_privacy" ON decision_nodes FOR SELECT
USING (
  couple_id IN (
    SELECT id FROM couples
    WHERE bride_id = auth.uid() OR groom_id = auth.uid()
  )
  AND (
    visibility = 'shared'
    OR (
      visibility = 'bride_private'
      AND EXISTS (
        SELECT 1 FROM couples
        WHERE id = decision_nodes.couple_id AND bride_id = auth.uid()
      )
    )
    OR (
      visibility = 'groom_private'
      AND EXISTS (
        SELECT 1 FROM couples
        WHERE id = decision_nodes.couple_id AND groom_id = auth.uid()
      )
    )
  )
);

-- 코멘트
COMMENT ON COLUMN chat_messages.visibility IS
  'shared = 둘 다 볼 수 있음, bride_private = 신부 단독 채팅, groom_private = 신랑 단독 채팅. AI 응답도 같은 visibility로 저장.';
COMMENT ON COLUMN decision_nodes.visibility IS
  'shared = 공유 결정, bride_private = 신부의 개인 메모, groom_private = 신랑의 개인 메모. private 결정은 본인 채팅에만 회상됨.';
