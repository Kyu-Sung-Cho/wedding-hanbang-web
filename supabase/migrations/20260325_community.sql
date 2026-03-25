-- =============================================
-- 웨딩한방 커뮤니티 DB 마이그레이션
-- =============================================

-- 1. community_profiles (커뮤니티 닉네임/뱃지)
CREATE TABLE IF NOT EXISTS community_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  avatar_url TEXT,
  badge TEXT DEFAULT 'member' CHECK (badge IN ('member', 'verified_couple', 'top_contributor', 'admin')),
  post_count INT DEFAULT 0,
  comment_count INT DEFAULT 0,
  total_upvotes_received INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE community_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "community_profiles_select" ON community_profiles FOR SELECT USING (true);
CREATE POLICY "community_profiles_insert" ON community_profiles FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "community_profiles_update" ON community_profiles FOR UPDATE USING (user_id = auth.uid());

-- 2. community_posts (게시글)
CREATE TABLE IF NOT EXISTS community_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('sdme_review', 'venue_review', 'cost_share', 'tips', 'free_board', 'honeymoon', 'qa')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  images TEXT[] DEFAULT '{}',
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'members', 'draft')),
  upvote_count INT DEFAULT 0,
  downvote_count INT DEFAULT 0,
  comment_count INT DEFAULT 0,
  view_count INT DEFAULT 0,
  bookmark_count INT DEFAULT 0,
  is_pinned BOOLEAN DEFAULT FALSE,
  is_weekly_best BOOLEAN DEFAULT FALSE,
  vendor_tags UUID[] DEFAULT '{}',
  tags TEXT[] DEFAULT '{}',
  -- 비용공유 구조화 데이터
  cost_data JSONB,  -- { totalCost, region, guestCount, weddingDate, categories: [{key, label, cost, vendor, notes}] }
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(content, '') || ' ' || array_to_string(coalesce(tags, '{}'), ' '))
  ) STORED,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cp_category ON community_posts(category);
CREATE INDEX idx_cp_author ON community_posts(author_id);
CREATE INDEX idx_cp_created ON community_posts(created_at DESC);
CREATE INDEX idx_cp_visibility ON community_posts(visibility);
CREATE INDEX idx_cp_hot ON community_posts(upvote_count DESC, comment_count DESC, created_at DESC);
CREATE INDEX idx_cp_search ON community_posts USING gin(search_vector);
CREATE INDEX idx_cp_tags ON community_posts USING gin(tags);
CREATE INDEX idx_cp_vendor_tags ON community_posts USING gin(vendor_tags);

ALTER TABLE community_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cp_select_public" ON community_posts FOR SELECT USING (visibility = 'public');
CREATE POLICY "cp_select_members" ON community_posts FOR SELECT USING (visibility = 'members' AND auth.role() = 'authenticated');
CREATE POLICY "cp_select_drafts" ON community_posts FOR SELECT USING (visibility = 'draft' AND author_id = auth.uid());
CREATE POLICY "cp_insert" ON community_posts FOR INSERT WITH CHECK (auth.uid() = author_id);
CREATE POLICY "cp_update" ON community_posts FOR UPDATE USING (author_id = auth.uid());
CREATE POLICY "cp_delete" ON community_posts FOR DELETE USING (author_id = auth.uid());

-- 3. community_comments (댓글)
CREATE TABLE IF NOT EXISTS community_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES community_comments(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  upvote_count INT DEFAULT 0,
  is_deleted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cc_post ON community_comments(post_id, created_at);
CREATE INDEX idx_cc_parent ON community_comments(parent_id);
CREATE INDEX idx_cc_author ON community_comments(author_id);

ALTER TABLE community_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cc_select" ON community_comments FOR SELECT USING (
  EXISTS (SELECT 1 FROM community_posts p WHERE p.id = post_id AND (p.visibility = 'public' OR (p.visibility = 'members' AND auth.role() = 'authenticated')))
);
CREATE POLICY "cc_insert" ON community_comments FOR INSERT WITH CHECK (auth.uid() = author_id);
CREATE POLICY "cc_update" ON community_comments FOR UPDATE USING (author_id = auth.uid());
CREATE POLICY "cc_delete" ON community_comments FOR DELETE USING (author_id = auth.uid());

-- 4. community_votes (투표)
CREATE TABLE IF NOT EXISTS community_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  post_id UUID REFERENCES community_posts(id) ON DELETE CASCADE,
  comment_id UUID REFERENCES community_comments(id) ON DELETE CASCADE,
  vote_type SMALLINT NOT NULL CHECK (vote_type IN (1, -1)),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK ((post_id IS NOT NULL AND comment_id IS NULL) OR (post_id IS NULL AND comment_id IS NOT NULL)),
  UNIQUE (user_id, post_id),
  UNIQUE (user_id, comment_id)
);

CREATE INDEX idx_cv_user ON community_votes(user_id);
CREATE INDEX idx_cv_post ON community_votes(post_id);
CREATE INDEX idx_cv_comment ON community_votes(comment_id);

ALTER TABLE community_votes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cv_select" ON community_votes FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "cv_insert" ON community_votes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "cv_update" ON community_votes FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "cv_delete" ON community_votes FOR DELETE USING (user_id = auth.uid());

-- 5. community_bookmarks (북마크)
CREATE TABLE IF NOT EXISTS community_bookmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, post_id)
);

ALTER TABLE community_bookmarks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cb_all" ON community_bookmarks FOR ALL USING (user_id = auth.uid());

-- 6. community_reports (신고)
CREATE TABLE IF NOT EXISTS community_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  post_id UUID REFERENCES community_posts(id) ON DELETE CASCADE,
  comment_id UUID REFERENCES community_comments(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (reason IN ('spam', 'abuse', 'ad', 'inappropriate', 'other')),
  description TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'resolved', 'dismissed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK ((post_id IS NOT NULL AND comment_id IS NULL) OR (post_id IS NULL AND comment_id IS NOT NULL))
);

ALTER TABLE community_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cr_insert" ON community_reports FOR INSERT WITH CHECK (auth.uid() = reporter_id);
CREATE POLICY "cr_select" ON community_reports FOR SELECT USING (reporter_id = auth.uid());

-- 7. RPC 함수: 게시글 투표 (atomic)
CREATE OR REPLACE FUNCTION community_vote_post(p_user_id UUID, p_post_id UUID, p_vote_type SMALLINT)
RETURNS void AS $$
DECLARE old_vote SMALLINT;
BEGIN
  SELECT vote_type INTO old_vote FROM community_votes WHERE user_id = p_user_id AND post_id = p_post_id;

  IF p_vote_type = 0 THEN
    DELETE FROM community_votes WHERE user_id = p_user_id AND post_id = p_post_id;
    IF old_vote = 1 THEN UPDATE community_posts SET upvote_count = upvote_count - 1 WHERE id = p_post_id;
    ELSIF old_vote = -1 THEN UPDATE community_posts SET downvote_count = downvote_count - 1 WHERE id = p_post_id;
    END IF;
  ELSIF old_vote IS NULL THEN
    INSERT INTO community_votes (user_id, post_id, vote_type) VALUES (p_user_id, p_post_id, p_vote_type);
    IF p_vote_type = 1 THEN UPDATE community_posts SET upvote_count = upvote_count + 1 WHERE id = p_post_id;
    ELSE UPDATE community_posts SET downvote_count = downvote_count + 1 WHERE id = p_post_id;
    END IF;
  ELSIF old_vote != p_vote_type THEN
    UPDATE community_votes SET vote_type = p_vote_type WHERE user_id = p_user_id AND post_id = p_post_id;
    IF p_vote_type = 1 THEN UPDATE community_posts SET upvote_count = upvote_count + 1, downvote_count = downvote_count - 1 WHERE id = p_post_id;
    ELSE UPDATE community_posts SET upvote_count = upvote_count - 1, downvote_count = downvote_count + 1 WHERE id = p_post_id;
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. RPC 함수: 댓글 투표 (atomic)
CREATE OR REPLACE FUNCTION community_vote_comment(p_user_id UUID, p_comment_id UUID, p_vote_type SMALLINT)
RETURNS void AS $$
DECLARE old_vote SMALLINT;
BEGIN
  SELECT vote_type INTO old_vote FROM community_votes WHERE user_id = p_user_id AND comment_id = p_comment_id;

  IF p_vote_type = 0 THEN
    DELETE FROM community_votes WHERE user_id = p_user_id AND comment_id = p_comment_id;
    IF old_vote = 1 THEN UPDATE community_comments SET upvote_count = upvote_count - 1 WHERE id = p_comment_id; END IF;
  ELSIF old_vote IS NULL THEN
    INSERT INTO community_votes (user_id, comment_id, vote_type) VALUES (p_user_id, p_comment_id, p_vote_type);
    IF p_vote_type = 1 THEN UPDATE community_comments SET upvote_count = upvote_count + 1 WHERE id = p_comment_id; END IF;
  ELSIF old_vote != p_vote_type THEN
    UPDATE community_votes SET vote_type = p_vote_type WHERE user_id = p_user_id AND comment_id = p_comment_id;
    IF p_vote_type = 1 THEN UPDATE community_comments SET upvote_count = upvote_count + 1 WHERE id = p_comment_id;
    ELSE UPDATE community_comments SET upvote_count = upvote_count - 1 WHERE id = p_comment_id;
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 9. RPC: 조회수 증가
CREATE OR REPLACE FUNCTION community_increment_view(p_post_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE community_posts SET view_count = view_count + 1 WHERE id = p_post_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 10. Storage 버킷
INSERT INTO storage.buckets (id, name, public) VALUES ('community-images', 'community-images', true)
ON CONFLICT (id) DO NOTHING;
