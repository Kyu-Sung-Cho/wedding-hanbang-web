-- 카드 게시물 (인스타 캐러셀 형식) 지원
--
-- community_posts.slides JSONB — null 이면 일반 글, 배열이면 카드 게시물.
-- 형식: [{ "type": "image" | "video", "url": "...", "width"?: number, "height"?: number, "thumbnail_url"?: string }]
--
-- 기존 images TEXT[] 컬럼은 첨부 이미지(본문과 별개)로 그대로 유지.
-- 카드 게시물은 본문(content) 대신 slides 가 주 미디어, content 는 캡션 역할.

ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS slides JSONB DEFAULT NULL;

-- 카드 게시물만 빠르게 필터링 — 피드/탐색에서 활용
CREATE INDEX IF NOT EXISTS idx_community_posts_slides_notnull
  ON community_posts ((slides IS NOT NULL))
  WHERE slides IS NOT NULL;
