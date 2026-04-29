-- =============================================
-- Storage Buckets (2026-04-29)
-- 코드에서 실제 사용 중인 4개 버킷 + RLS 정책
-- =============================================
-- 사용 위치:
--   community-images  → /api/community/upload (path: {user.id}/{ts}_{rand}.{ext})
--   community-videos  → /api/community/upload (path: {user.id}/{ts}_{rand}.{ext})
--   invitation-photos → /api/invitations/[id]/photos/upload (admin client only)
--   chat-image        → stores/chatStore.ts (path: {couple_id}/{ts}-{rand}.{ext})
-- 모두 public read (URL 알면 조회 가능). 쓰기 정책은 버킷별로 분리.
-- =============================================


-- ---------------------------------------------
-- 1. 버킷 생성 (idempotent)
-- ---------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'community-images',
  'community-images',
  TRUE,
  10 * 1024 * 1024,  -- 10MB (GIF 포함, JPEG/PNG/WebP는 코드에서 5MB로 제한)
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'community-videos',
  'community-videos',
  TRUE,
  50 * 1024 * 1024,  -- 50MB
  ARRAY['video/mp4', 'video/quicktime', 'video/webm']
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'invitation-photos',
  'invitation-photos',
  TRUE,
  10 * 1024 * 1024,  -- 10MB
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-image',
  'chat-image',
  TRUE,
  10 * 1024 * 1024,  -- 10MB
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;


-- ---------------------------------------------
-- 2. RLS 정책 (storage.objects)
-- ---------------------------------------------
-- public bucket이라 SELECT는 anon/authenticated 모두 자동 허용
-- INSERT/UPDATE/DELETE만 정책 필요

-- ─── community-images ───
-- 본인 user.id 폴더에만 INSERT/UPDATE/DELETE
DROP POLICY IF EXISTS "community-images own folder write" ON storage.objects;
CREATE POLICY "community-images own folder write"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'community-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "community-images own folder update" ON storage.objects;
CREATE POLICY "community-images own folder update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'community-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "community-images own folder delete" ON storage.objects;
CREATE POLICY "community-images own folder delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'community-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );


-- ─── community-videos ───
DROP POLICY IF EXISTS "community-videos own folder write" ON storage.objects;
CREATE POLICY "community-videos own folder write"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'community-videos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "community-videos own folder update" ON storage.objects;
CREATE POLICY "community-videos own folder update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'community-videos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "community-videos own folder delete" ON storage.objects;
CREATE POLICY "community-videos own folder delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'community-videos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );


-- ─── invitation-photos ───
-- 코드는 service role(admin client)로만 업로드/삭제 → 사용자 정책 불필요.
-- service role은 RLS 우회되므로 별도 정책 없이도 동작.
-- 사용자 client로 업로드 시도 차단 (정책 없으면 INSERT 자동 거부됨 = 의도된 동작).


-- ─── chat-image ───
-- 인증 사용자가 직접 업로드. couple_id 검증은 클라이언트 path에 의존
-- (RLS에서 path → couple_id → couple membership 검증은 비용 큼, 일단 인증만)
DROP POLICY IF EXISTS "chat-image authenticated write" ON storage.objects;
CREATE POLICY "chat-image authenticated write"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'chat-image');

DROP POLICY IF EXISTS "chat-image authenticated update" ON storage.objects;
CREATE POLICY "chat-image authenticated update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'chat-image');

DROP POLICY IF EXISTS "chat-image authenticated delete" ON storage.objects;
CREATE POLICY "chat-image authenticated delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'chat-image');


-- =============================================
-- 검증 쿼리 (수동 실행):
--   SELECT id, name, public, file_size_limit FROM storage.buckets
--   WHERE id IN ('community-images', 'community-videos', 'invitation-photos', 'chat-image');
--   → 4개 row 나와야 함
-- =============================================
