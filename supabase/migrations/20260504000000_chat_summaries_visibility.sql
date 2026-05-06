-- =============================================
-- chat_summaries.visibility (2026-05-04)
-- =============================================
-- 목적: chat_summaries에 visibility 컬럼 추가 → 요약도 shared/private 격리.
-- 기존 row는 모두 'shared'로 백필 (지금까지의 요약은 안전 가정).
-- =============================================

ALTER TABLE chat_summaries ADD COLUMN IF NOT EXISTS visibility TEXT
  DEFAULT 'shared'
  CHECK (visibility IN ('shared', 'bride_private', 'groom_private'));

UPDATE chat_summaries SET visibility = 'shared' WHERE visibility IS NULL;
ALTER TABLE chat_summaries ALTER COLUMN visibility SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_summaries_couple_visibility
  ON chat_summaries(couple_id, visibility);

COMMENT ON COLUMN chat_summaries.visibility IS
  'shared = 공유 대화 요약(둘 다 회상), bride_private/groom_private = 본인만 회상. private turn에서 생성된 mixed 요약은 본인 visibility로 저장.';
