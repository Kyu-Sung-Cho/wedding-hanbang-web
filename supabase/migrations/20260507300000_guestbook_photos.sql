-- =============================================
-- Guestbook Wedding Photos (2026-05-07)
-- 결혼식 사진 갤러리 — 오너가 여러 장 업로드 (방명록 책 컨셉)
-- =============================================
-- cover_image_url(단일)과 별개. 책의 사진 챕터로 사용.
-- 한 방명록당 최대 30장 (앱에서 enforce)
-- =============================================

CREATE TABLE IF NOT EXISTS guestbook_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guestbook_id UUID NOT NULL REFERENCES guestbooks(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  caption TEXT CHECK (caption IS NULL OR char_length(caption) <= 100),
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gb_photos_guestbook
  ON guestbook_photos(guestbook_id, position);

ALTER TABLE guestbook_photos ENABLE ROW LEVEL SECURITY;

-- SELECT: 활성 방명록의 사진은 누구나 (공개 책)
DROP POLICY IF EXISTS "gb_photos_select" ON guestbook_photos;
CREATE POLICY "gb_photos_select"
  ON guestbook_photos FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM guestbooks g
      WHERE g.id = guestbook_id AND g.is_active = TRUE
    )
  );

-- INSERT/UPDATE/DELETE: 방명록 오너만
DROP POLICY IF EXISTS "gb_photos_insert_owner" ON guestbook_photos;
CREATE POLICY "gb_photos_insert_owner"
  ON guestbook_photos FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM guestbooks g
      WHERE g.id = guestbook_id AND g.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "gb_photos_update_owner" ON guestbook_photos;
CREATE POLICY "gb_photos_update_owner"
  ON guestbook_photos FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM guestbooks g
      WHERE g.id = guestbook_id AND g.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "gb_photos_delete_owner" ON guestbook_photos;
CREATE POLICY "gb_photos_delete_owner"
  ON guestbook_photos FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM guestbooks g
      WHERE g.id = guestbook_id AND g.owner_id = auth.uid()
    )
  );


-- =============================================
-- 검증:
--   SELECT count(*) FROM guestbook_photos;  → 0 (초기)
-- =============================================
