-- =============================================
-- "내 화면만 새 채팅" 지원 — per-user view reset timestamps
-- =============================================
-- 목적: "새 채팅" 클릭 시 4가지 모드 지원
--   1. view_reset_shared:  본인 프로필 timestamp만 업데이트 → 본인 화면에서만 안 보임
--   2. delete_shared:      DB의 shared 메시지 삭제 → 양쪽 모두 영향
--   3. view_reset_private: 본인 private timestamp 업데이트
--   4. delete_private:     본인 private 메시지 DB 삭제 (RLS로 본인 것만)
--
-- 이걸로:
--   - 신부가 "새 채팅" 눌러도 신랑의 비공개 상담 내용은 절대 안 사라짐
--   - 본인만 화면 정리 vs 둘 다 새 시작 선택권 줌
-- =============================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS shared_chat_cleared_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS private_chat_cleared_at TIMESTAMPTZ;

COMMENT ON COLUMN profiles.shared_chat_cleared_at IS
  '본인이 마지막으로 함께 대화 탭을 "내 화면만 정리"한 시각. 이 시각 이후 메시지만 본인 화면에 표시.';
COMMENT ON COLUMN profiles.private_chat_cleared_at IS
  '본인이 마지막으로 나만 (상담) 탭을 "내 화면만 정리"한 시각.';
