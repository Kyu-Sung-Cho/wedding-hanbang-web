-- =============================================
-- 웨딩한방 커뮤니티 V2 (전략 프롬프트 기반 재설계)
-- 동기방 / 광고표시 / AI 가격코멘트 / 방명록 / 진행률 / 5개 게시판
-- =============================================

-- ────────────────────────────────────────────
-- 1. community_posts 컬럼 추가 (광고표시, AI코멘트, 해결됨, 인증후기, 동기방연결)
-- ────────────────────────────────────────────
ALTER TABLE community_posts
  ADD COLUMN IF NOT EXISTS ad_disclosure TEXT NOT NULL DEFAULT 'general'
    CHECK (ad_disclosure IN ('general', 'sponsored', 'ad')),
  ADD COLUMN IF NOT EXISTS sponsorship_detail TEXT,
  ADD COLUMN IF NOT EXISTS ai_comment JSONB,
  ADD COLUMN IF NOT EXISTS is_resolved BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_verified_review BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS verification_doc_url TEXT,
  ADD COLUMN IF NOT EXISTS price_data JSONB,
  ADD COLUMN IF NOT EXISTS is_quick_review BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS rating SMALLINT CHECK (rating BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS cohort_room_id UUID,
  ADD COLUMN IF NOT EXISTS under_review BOOLEAN DEFAULT FALSE;

-- 카테고리 체크 제약 갱신: 신규 5개 + 레거시 호환
ALTER TABLE community_posts DROP CONSTRAINT IF EXISTS community_posts_category_check;
ALTER TABLE community_posts ADD CONSTRAINT community_posts_category_check
  CHECK (category IN (
    -- 신규 5개 게시판
    'is_normal', 'tour_review', 'tips_v2', 'ama', 'free',
    -- 레거시 (마이그레이션용)
    'sdme_review', 'venue_review', 'cost_share', 'tips', 'free_board', 'honeymoon', 'qa'
  ));

CREATE INDEX IF NOT EXISTS idx_cp_ad_disclosure ON community_posts(ad_disclosure);
CREATE INDEX IF NOT EXISTS idx_cp_resolved ON community_posts(is_resolved);
CREATE INDEX IF NOT EXISTS idx_cp_verified ON community_posts(is_verified_review);
CREATE INDEX IF NOT EXISTS idx_cp_cohort ON community_posts(cohort_room_id);

-- ────────────────────────────────────────────
-- 2. community_profiles 확장 (계급, 동기, 진행률, 결혼여부)
-- ────────────────────────────────────────────
ALTER TABLE community_profiles
  ADD COLUMN IF NOT EXISTS rank TEXT NOT NULL DEFAULT 'sprout'
    CHECK (rank IN ('sprout', 'preparing', 'expert', 'master', 'senior')),
  ADD COLUMN IF NOT EXISTS wedding_year INT,
  ADD COLUMN IF NOT EXISTS wedding_month INT CHECK (wedding_month BETWEEN 1 AND 12),
  ADD COLUMN IF NOT EXISTS wedding_completed BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS progress_percent INT DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS region TEXT,
  ADD COLUMN IF NOT EXISTS warning_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN DEFAULT FALSE;

-- ────────────────────────────────────────────
-- 3. 동기방 (cohort_rooms) — 핵심 엔진
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cohort_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year INT NOT NULL,
  month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  room_number INT NOT NULL DEFAULT 1, -- 30명 넘으면 분리: 1방, 2방
  name TEXT NOT NULL,                  -- "2026년 10월 결혼 동기"
  member_count INT DEFAULT 0,
  message_count INT DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (year, month, room_number)
);

CREATE INDEX IF NOT EXISTS idx_cohort_year_month ON cohort_rooms(year, month);

ALTER TABLE cohort_rooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cohort_rooms_select_all" ON cohort_rooms FOR SELECT USING (true);

-- 동기방 멤버
CREATE TABLE IF NOT EXISTS cohort_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES cohort_rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE,
  UNIQUE (room_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_cohort_members_room ON cohort_members(room_id);
CREATE INDEX IF NOT EXISTS idx_cohort_members_user ON cohort_members(user_id);

ALTER TABLE cohort_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cohort_members_select" ON cohort_members FOR SELECT USING (
  -- 본인 또는 같은 방 멤버
  user_id = auth.uid() OR
  EXISTS (SELECT 1 FROM cohort_members m WHERE m.room_id = cohort_members.room_id AND m.user_id = auth.uid())
);
CREATE POLICY "cohort_members_insert" ON cohort_members FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "cohort_members_update" ON cohort_members FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "cohort_members_delete" ON cohort_members FOR DELETE USING (auth.uid() = user_id);

-- 동기방 메시지 (실시간 채팅)
CREATE TABLE IF NOT EXISTS cohort_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES cohort_rooms(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  thread_topic TEXT CHECK (thread_topic IN ('price', 'review', 'concern', 'chat')),
  images TEXT[] DEFAULT '{}',
  reply_to UUID REFERENCES cohort_messages(id) ON DELETE SET NULL,
  is_deleted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cohort_messages_room ON cohort_messages(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cohort_messages_topic ON cohort_messages(room_id, thread_topic);

ALTER TABLE cohort_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cohort_messages_select" ON cohort_messages FOR SELECT USING (
  EXISTS (SELECT 1 FROM cohort_members m WHERE m.room_id = cohort_messages.room_id AND m.user_id = auth.uid())
);
CREATE POLICY "cohort_messages_insert" ON cohort_messages FOR INSERT WITH CHECK (
  auth.uid() = author_id AND
  EXISTS (SELECT 1 FROM cohort_members m WHERE m.room_id = cohort_messages.room_id AND m.user_id = auth.uid())
);
CREATE POLICY "cohort_messages_update" ON cohort_messages FOR UPDATE USING (auth.uid() = author_id);
CREATE POLICY "cohort_messages_delete" ON cohort_messages FOR DELETE USING (auth.uid() = author_id);

-- Realtime 활성화
ALTER PUBLICATION supabase_realtime ADD TABLE cohort_messages;

-- 동기방 정보판: 멤버 계약 정보
CREATE TABLE IF NOT EXISTS cohort_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES cohort_rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vendor_name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('venue', 'studio', 'dress', 'makeup', 'snap', 'honeymoon', 'ring', 'other')),
  base_price INT,             -- 만원 단위
  extra_price INT,            -- 추가금 만원
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cohort_contracts_room ON cohort_contracts(room_id, category);

ALTER TABLE cohort_contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cohort_contracts_select" ON cohort_contracts FOR SELECT USING (
  EXISTS (SELECT 1 FROM cohort_members m WHERE m.room_id = cohort_contracts.room_id AND m.user_id = auth.uid())
);
CREATE POLICY "cohort_contracts_insert" ON cohort_contracts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "cohort_contracts_update" ON cohort_contracts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "cohort_contracts_delete" ON cohort_contracts FOR DELETE USING (auth.uid() = user_id);

-- 동기방 타임라인 이벤트 (진행 상황 피드)
CREATE TABLE IF NOT EXISTS cohort_timeline_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES cohort_rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'venue_booked', 'studio_booked', 'dress_booked', 'makeup_booked',
    'tour_done', 'contract_done', 'invitation_sent', 'progress_update', 'wedding_done'
  )),
  description TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cohort_timeline_room ON cohort_timeline_events(room_id, created_at DESC);

ALTER TABLE cohort_timeline_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cohort_timeline_select" ON cohort_timeline_events FOR SELECT USING (
  EXISTS (SELECT 1 FROM cohort_members m WHERE m.room_id = cohort_timeline_events.room_id AND m.user_id = auth.uid())
);
CREATE POLICY "cohort_timeline_insert" ON cohort_timeline_events FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ────────────────────────────────────────────
-- 4. 동기방 자동 배정 RPC
-- ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION community_assign_cohort(
  p_user_id UUID,
  p_year INT,
  p_month INT
) RETURNS UUID AS $$
DECLARE
  v_room_id UUID;
  v_room_name TEXT;
  v_room_number INT := 1;
  v_member_count INT;
BEGIN
  -- 가장 최근 방 찾기 (인원 30 미만)
  SELECT id, member_count INTO v_room_id, v_member_count
  FROM cohort_rooms
  WHERE year = p_year AND month = p_month AND is_active = TRUE
  ORDER BY room_number DESC
  LIMIT 1;

  -- 방이 없거나 30명 꽉찬 경우 새 방 생성
  IF v_room_id IS NULL OR v_member_count >= 30 THEN
    SELECT COALESCE(MAX(room_number), 0) + 1 INTO v_room_number
    FROM cohort_rooms WHERE year = p_year AND month = p_month;

    v_room_name := p_year || '년 ' || p_month || '월 결혼 동기' ||
      CASE WHEN v_room_number > 1 THEN ' (' || v_room_number || '방)' ELSE '' END;

    INSERT INTO cohort_rooms (year, month, room_number, name)
    VALUES (p_year, p_month, v_room_number, v_room_name)
    RETURNING id INTO v_room_id;
  END IF;

  -- 멤버 등록
  INSERT INTO cohort_members (room_id, user_id)
  VALUES (v_room_id, p_user_id)
  ON CONFLICT (room_id, user_id) DO NOTHING;

  -- 멤버 카운트 갱신
  UPDATE cohort_rooms
  SET member_count = (SELECT COUNT(*) FROM cohort_members WHERE room_id = v_room_id)
  WHERE id = v_room_id;

  -- 프로필에 결혼 시기 저장
  UPDATE community_profiles
  SET wedding_year = p_year, wedding_month = p_month
  WHERE user_id = p_user_id;

  RETURN v_room_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 동기방 메시지 카운트 트리거
CREATE OR REPLACE FUNCTION cohort_message_count_trigger() RETURNS TRIGGER AS $$
BEGIN
  UPDATE cohort_rooms SET message_count = message_count + 1 WHERE id = NEW.room_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cohort_msg_count ON cohort_messages;
CREATE TRIGGER trg_cohort_msg_count AFTER INSERT ON cohort_messages
FOR EACH ROW EXECUTE FUNCTION cohort_message_count_trigger();

-- ────────────────────────────────────────────
-- 5. 업체 태그 시스템 (vendor_tags 자동 집계)
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS community_vendor_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_name TEXT NOT NULL UNIQUE,
  category TEXT,
  region TEXT,
  mention_count INT DEFAULT 0,
  avg_rating NUMERIC(3,2),
  avg_base_price INT,
  avg_extra_price INT,
  extra_rate NUMERIC(5,2), -- 추가금 발생률 %
  last_mentioned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendor_tags_name ON community_vendor_tags(vendor_name);
CREATE INDEX IF NOT EXISTS idx_vendor_tags_mentions ON community_vendor_tags(mention_count DESC);

ALTER TABLE community_vendor_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vendor_tags_select" ON community_vendor_tags FOR SELECT USING (true);

-- ────────────────────────────────────────────
-- 6. 방명록 (Guestbook) — 바이럴 + 메인 기능
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS guestbooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  bride_name TEXT NOT NULL,
  groom_name TEXT NOT NULL,
  wedding_date DATE NOT NULL,
  venue TEXT,
  cover_image_url TEXT,
  our_story TEXT,
  proposal_story TEXT,
  thank_you_message TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  message_count INT DEFAULT 0,
  view_count INT DEFAULT 0,
  rolling_paper_url TEXT,
  rolling_paper_generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guestbooks_slug ON guestbooks(slug);
CREATE INDEX IF NOT EXISTS idx_guestbooks_owner ON guestbooks(owner_id);

ALTER TABLE guestbooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "guestbooks_select_active" ON guestbooks FOR SELECT USING (is_active = TRUE);
CREATE POLICY "guestbooks_insert" ON guestbooks FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "guestbooks_update" ON guestbooks FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "guestbooks_delete" ON guestbooks FOR DELETE USING (auth.uid() = owner_id);

-- 방명록 메시지 (하객 메시지, 무가입 가능)
CREATE TABLE IF NOT EXISTS guestbook_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guestbook_id UUID NOT NULL REFERENCES guestbooks(id) ON DELETE CASCADE,
  guest_name TEXT NOT NULL,
  relation TEXT CHECK (relation IN ('university_friend', 'work_colleague', 'family', 'old_friend', 'partner', 'other')),
  message TEXT NOT NULL,
  image_url TEXT,
  message_type TEXT DEFAULT 'general' CHECK (message_type IN ('general', 'congratulations', 'speech', 'photo')),
  is_approved BOOLEAN DEFAULT TRUE,
  ip_hash TEXT,                       -- 어뷰징 방지용
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gb_messages_guestbook ON guestbook_messages(guestbook_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gb_messages_relation ON guestbook_messages(guestbook_id, relation);

ALTER TABLE guestbook_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gb_messages_select" ON guestbook_messages FOR SELECT USING (is_approved = TRUE);
-- 익명 INSERT 허용 (앱 레이어에서 ip_hash + rate limit으로 보호)
CREATE POLICY "gb_messages_insert_anon" ON guestbook_messages FOR INSERT WITH CHECK (true);
-- 방 주인만 삭제/숨김
CREATE POLICY "gb_messages_owner_update" ON guestbook_messages FOR UPDATE USING (
  EXISTS (SELECT 1 FROM guestbooks g WHERE g.id = guestbook_id AND g.owner_id = auth.uid())
);
CREATE POLICY "gb_messages_owner_delete" ON guestbook_messages FOR DELETE USING (
  EXISTS (SELECT 1 FROM guestbooks g WHERE g.id = guestbook_id AND g.owner_id = auth.uid())
);

-- 방명록 메시지 카운트 트리거
CREATE OR REPLACE FUNCTION gb_message_count_trigger() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE guestbooks SET message_count = message_count + 1 WHERE id = NEW.guestbook_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE guestbooks SET message_count = GREATEST(0, message_count - 1) WHERE id = OLD.guestbook_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_gb_msg_count ON guestbook_messages;
CREATE TRIGGER trg_gb_msg_count AFTER INSERT OR DELETE ON guestbook_messages
FOR EACH ROW EXECUTE FUNCTION gb_message_count_trigger();

-- ────────────────────────────────────────────
-- 7. 신고 자동 처리 (3건 이상 → under_review)
-- ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION community_report_auto_review() RETURNS TRIGGER AS $$
DECLARE v_count INT;
BEGIN
  IF NEW.post_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_count FROM community_reports
    WHERE post_id = NEW.post_id AND status = 'pending';
    IF v_count >= 3 THEN
      UPDATE community_posts SET under_review = TRUE WHERE id = NEW.post_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_report_auto_review ON community_reports;
CREATE TRIGGER trg_report_auto_review AFTER INSERT ON community_reports
FOR EACH ROW EXECUTE FUNCTION community_report_auto_review();

-- ────────────────────────────────────────────
-- 8. 진행률 RPC + 동기방 알림
-- ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION community_update_progress(
  p_user_id UUID,
  p_percent INT,
  p_event_type TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL
) RETURNS void AS $$
DECLARE v_room_id UUID;
BEGIN
  UPDATE community_profiles SET progress_percent = p_percent WHERE user_id = p_user_id;

  IF p_event_type IS NOT NULL THEN
    SELECT room_id INTO v_room_id FROM cohort_members
    WHERE user_id = p_user_id AND is_active = TRUE LIMIT 1;

    IF v_room_id IS NOT NULL THEN
      INSERT INTO cohort_timeline_events (room_id, user_id, event_type, description)
      VALUES (v_room_id, p_user_id, p_event_type, p_description);
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ────────────────────────────────────────────
-- 9. 계급 자동 갱신 트리거
-- ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION community_recalc_rank() RETURNS TRIGGER AS $$
DECLARE
  v_posts INT;
  v_comments INT;
  v_upvotes INT;
  v_completed BOOLEAN;
  v_new_rank TEXT;
BEGIN
  SELECT post_count, comment_count, total_upvotes_received, wedding_completed
    INTO v_posts, v_comments, v_upvotes, v_completed
  FROM community_profiles WHERE user_id = NEW.user_id;

  IF v_completed THEN
    v_new_rank := 'senior';
  ELSIF v_posts >= 50 AND v_upvotes >= 100 THEN
    v_new_rank := 'master';
  ELSIF v_posts >= 20 AND v_comments >= 50 THEN
    v_new_rank := 'expert';
  ELSIF v_posts >= 5 OR v_comments >= 20 THEN
    v_new_rank := 'preparing';
  ELSE
    v_new_rank := 'sprout';
  END IF;

  UPDATE community_profiles SET rank = v_new_rank WHERE user_id = NEW.user_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_recalc_rank ON community_profiles;
CREATE TRIGGER trg_recalc_rank AFTER UPDATE OF post_count, comment_count, total_upvotes_received, wedding_completed
ON community_profiles
FOR EACH ROW EXECUTE FUNCTION community_recalc_rank();

-- ────────────────────────────────────────────
-- 10. 동기방 정보판 집계 뷰
-- ────────────────────────────────────────────
CREATE OR REPLACE VIEW cohort_stats AS
SELECT
  room_id,
  category,
  COUNT(*) AS sample_size,
  ROUND(AVG(base_price))::INT AS avg_base_price,
  ROUND(AVG(extra_price))::INT AS avg_extra_price,
  ROUND(AVG(base_price + COALESCE(extra_price, 0)))::INT AS avg_total
FROM cohort_contracts
GROUP BY room_id, category;

-- ────────────────────────────────────────────
-- 11. Storage 버킷
-- ────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public) VALUES ('guestbook-images', 'guestbook-images', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public) VALUES ('cohort-images', 'cohort-images', true)
ON CONFLICT (id) DO NOTHING;

-- ────────────────────────────────────────────
-- 12. 레거시 카테고리 → 신규 5개 매핑 (기존 글이 있는 경우)
-- ────────────────────────────────────────────
UPDATE community_posts SET category = 'tour_review'
  WHERE category IN ('sdme_review', 'venue_review');
UPDATE community_posts SET category = 'tips_v2'
  WHERE category IN ('tips', 'cost_share', 'honeymoon');
UPDATE community_posts SET category = 'is_normal'
  WHERE category = 'qa';
UPDATE community_posts SET category = 'free'
  WHERE category = 'free_board';

-- 마이그레이션 후 레거시 제거
ALTER TABLE community_posts DROP CONSTRAINT IF EXISTS community_posts_category_check;
ALTER TABLE community_posts ADD CONSTRAINT community_posts_category_check
  CHECK (category IN ('is_normal', 'tour_review', 'tips_v2', 'ama', 'free'));
