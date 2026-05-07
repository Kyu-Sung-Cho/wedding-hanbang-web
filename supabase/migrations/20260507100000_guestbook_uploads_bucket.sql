-- =============================================
-- Storage Bucket: guestbook-uploads (2026-05-07)
-- 방명록에 익명 게스트가 첨부하는 사진 저장소
-- =============================================
-- 사용 위치:
--   /api/guestbook/upload (anonymous, IP rate-limited via app layer)
--   path: {guestbook_id}/{ts}_{rand}.{ext}
-- 모두 public read (URL 알면 조회 가능). 쓰기는 service role만 — 게스트가 익명이라
-- supabase auth가 없으므로 앱 레이어 rate limit + IP hash + 매직바이트 검증으로 보호.
-- =============================================


-- ---------------------------------------------
-- 1. 버킷 생성 (idempotent)
-- ---------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'guestbook-uploads',
  'guestbook-uploads',
  TRUE,
  5 * 1024 * 1024,  -- 5MB (방명록 폴라로이드 1장 컨셉)
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO NOTHING;


-- ---------------------------------------------
-- 2. RLS 정책 (storage.objects)
-- ---------------------------------------------
-- public bucket이라 SELECT는 anon/authenticated 모두 자동 허용.
-- INSERT/UPDATE/DELETE는 service role만 — 별도 정책 없이도 service role은 RLS 우회됨.
-- 사용자 client로 업로드 시도 차단 (정책 없음 = INSERT 자동 거부 = 의도된 동작).


-- =============================================
-- 검증 쿼리 (수동 실행):
--   SELECT id, name, public, file_size_limit FROM storage.buckets
--   WHERE id = 'guestbook-uploads';
--   → 1개 row 나와야 함
-- =============================================
