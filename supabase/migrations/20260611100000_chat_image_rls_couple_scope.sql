-- =============================================
-- chat-image 버킷 RLS 강화 (2026-06-11)
-- =============================================
-- 문제: 기존 정책이 bucket_id만 검증 → 로그인한 아무 사용자나
--       타 커플 폴더의 채팅 이미지를 업로드/덮어쓰기/삭제 가능 (CRITICAL).
-- 수정: 경로 첫 폴더({couple_id})가 본인 profiles.couple_id와 일치할 때만 허용.
--       community-images의 "own folder" 패턴과 동일, 기준만 user.id → couple_id.
-- 업로드 코드: apps/web/src/stores/chatStore.ts
--   path = `{couple_id}/{ts}-{rand}.{ext}` — 코드 변경 불필요.
-- 전제: profiles_select_own 정책(20260210000000)으로 본인 프로필 조회 가능.
-- =============================================

-- INSERT: 본인 커플 폴더에만 업로드
DROP POLICY IF EXISTS "chat-image authenticated write" ON storage.objects;
DROP POLICY IF EXISTS "chat-image couple folder write" ON storage.objects;
CREATE POLICY "chat-image couple folder write"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-image'
    AND (storage.foldername(name))[1] IN (
      SELECT couple_id::text FROM public.profiles
      WHERE id = auth.uid() AND couple_id IS NOT NULL
    )
  );

-- UPDATE: 본인 커플 폴더만 (덮어쓰기 방지)
DROP POLICY IF EXISTS "chat-image authenticated update" ON storage.objects;
DROP POLICY IF EXISTS "chat-image couple folder update" ON storage.objects;
CREATE POLICY "chat-image couple folder update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'chat-image'
    AND (storage.foldername(name))[1] IN (
      SELECT couple_id::text FROM public.profiles
      WHERE id = auth.uid() AND couple_id IS NOT NULL
    )
  )
  WITH CHECK (
    bucket_id = 'chat-image'
    AND (storage.foldername(name))[1] IN (
      SELECT couple_id::text FROM public.profiles
      WHERE id = auth.uid() AND couple_id IS NOT NULL
    )
  );

-- DELETE: 본인 커플 폴더만
DROP POLICY IF EXISTS "chat-image authenticated delete" ON storage.objects;
DROP POLICY IF EXISTS "chat-image couple folder delete" ON storage.objects;
CREATE POLICY "chat-image couple folder delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'chat-image'
    AND (storage.foldername(name))[1] IN (
      SELECT couple_id::text FROM public.profiles
      WHERE id = auth.uid() AND couple_id IS NOT NULL
    )
  );

-- =============================================
-- 검증 쿼리 (수동 실행):
--   SELECT policyname FROM pg_policies
--   WHERE tablename = 'objects' AND policyname LIKE 'chat-image%';
--   → "chat-image couple folder write/update/delete" 3개만 나와야 함
-- =============================================
