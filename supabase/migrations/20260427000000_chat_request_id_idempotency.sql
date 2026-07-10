-- =============================================
-- chat_messages idempotency via client_request_id
-- =============================================
-- 목적: 모바일 retry / 중복 fetch 시 같은 AI 응답이 2번 INSERT 되는 것 방지.
-- 클라이언트가 sendMessage 당 1개의 UUID를 발급하고,
-- 서버는 metadata->>'client_request_id' 로 idempotency 보장.

-- Fresh database baseline originally lacked metadata until a much later
-- migration. Add it before the expression index so the migration chain works.
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
-- 이 UNIQUE INDEX로 race condition 하에서도 중복 INSERT 자체가 실패함.
-- =============================================

CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_client_request_id_unique
  ON chat_messages (couple_id, (metadata->>'client_request_id'))
  WHERE metadata->>'client_request_id' IS NOT NULL;
