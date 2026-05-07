-- ════════════════════════════════════════════════════════════════════
-- Community Polls (게시글 임베드 투표/설문)
-- ════════════════════════════════════════════════════════════════════
-- 웨딩 도메인 사용 시나리오:
--   • "두 드레스 중 어떤 게 나을까?" (이미지 옵션 + 단일 선택)
--   • "스튜디오 4곳 중 추천?"        (텍스트 옵션 + 단일 선택)
--   • "축의금 얼마가 적정?"          (객관식 + 익명)
--   • "이 청첩장 디자인 어때?"       (다중 선택)
-- ════════════════════════════════════════════════════════════════════

-- 1. community_polls (게시글 1:1)
CREATE TABLE IF NOT EXISTS community_polls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL UNIQUE REFERENCES community_posts(id) ON DELETE CASCADE,
  question TEXT NOT NULL CHECK (char_length(question) BETWEEN 1 AND 200),
  allow_multiple BOOLEAN NOT NULL DEFAULT false,
  is_anonymous BOOLEAN NOT NULL DEFAULT false,
  hide_results_until_voted BOOLEAN NOT NULL DEFAULT false,
  closes_at TIMESTAMPTZ,
  total_voters INT NOT NULL DEFAULT 0,
  total_votes INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_polls_post ON community_polls(post_id);
CREATE INDEX IF NOT EXISTS idx_polls_closes ON community_polls(closes_at) WHERE closes_at IS NOT NULL;

-- 2. community_poll_options (한 폴당 2~10개)
CREATE TABLE IF NOT EXISTS community_poll_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL REFERENCES community_polls(id) ON DELETE CASCADE,
  position INT NOT NULL CHECK (position BETWEEN 0 AND 9),
  label TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 100),
  image_url TEXT,
  vote_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(poll_id, position)
);

CREATE INDEX IF NOT EXISTS idx_poll_options_poll ON community_poll_options(poll_id, position);

-- 3. community_poll_votes (멤버 1표 / 옵션마다 row, 다중 선택 시 여러 row)
CREATE TABLE IF NOT EXISTS community_poll_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL REFERENCES community_polls(id) ON DELETE CASCADE,
  option_id UUID NOT NULL REFERENCES community_poll_options(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(option_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_poll_votes_poll_user ON community_poll_votes(poll_id, user_id);
CREATE INDEX IF NOT EXISTS idx_poll_votes_user ON community_poll_votes(user_id);

-- ════════════════════════════════════════════════════════════════════
-- RLS
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE community_polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_poll_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_poll_votes ENABLE ROW LEVEL SECURITY;

-- Polls: 부모 게시글 가시성에 따라 SELECT
DROP POLICY IF EXISTS "polls_select" ON community_polls;
CREATE POLICY "polls_select" ON community_polls FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM community_posts p
    WHERE p.id = post_id
      AND (
        p.visibility = 'public'
        OR (p.visibility = 'members' AND auth.role() = 'authenticated')
        OR (p.visibility = 'draft' AND p.author_id = auth.uid())
      )
  )
);

-- Options: 폴 SELECT 가능하면 보임
DROP POLICY IF EXISTS "poll_options_select" ON community_poll_options;
CREATE POLICY "poll_options_select" ON community_poll_options FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM community_polls poll
    JOIN community_posts p ON p.id = poll.post_id
    WHERE poll.id = poll_id
      AND (
        p.visibility = 'public'
        OR (p.visibility = 'members' AND auth.role() = 'authenticated')
        OR (p.visibility = 'draft' AND p.author_id = auth.uid())
      )
  )
);

-- Votes: 자기 투표만 SELECT/INSERT/DELETE (집계는 trigger로 vote_count에 반영)
DROP POLICY IF EXISTS "poll_votes_select_own" ON community_poll_votes;
CREATE POLICY "poll_votes_select_own" ON community_poll_votes FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "poll_votes_insert_own" ON community_poll_votes;
CREATE POLICY "poll_votes_insert_own" ON community_poll_votes FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "poll_votes_delete_own" ON community_poll_votes;
CREATE POLICY "poll_votes_delete_own" ON community_poll_votes FOR DELETE USING (user_id = auth.uid());

-- INSERT/UPDATE/DELETE on polls/options 은 service-role만 (글 생성/수정 API에서)

-- ════════════════════════════════════════════════════════════════════
-- 카운트 동기화 트리거
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION community_poll_recount()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_poll_id UUID;
  v_option_id UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_poll_id := NEW.poll_id;
    v_option_id := NEW.option_id;
  ELSE
    v_poll_id := OLD.poll_id;
    v_option_id := OLD.option_id;
  END IF;

  -- option vote_count 재계산
  UPDATE community_poll_options
  SET vote_count = (SELECT COUNT(*) FROM community_poll_votes WHERE option_id = v_option_id)
  WHERE id = v_option_id;

  -- poll total_votes (옵션 row 합) + total_voters (DISTINCT user)
  UPDATE community_polls
  SET
    total_votes = (SELECT COUNT(*) FROM community_poll_votes WHERE poll_id = v_poll_id),
    total_voters = (SELECT COUNT(DISTINCT user_id) FROM community_poll_votes WHERE poll_id = v_poll_id)
  WHERE id = v_poll_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_poll_votes_recount ON community_poll_votes;
CREATE TRIGGER trg_poll_votes_recount
AFTER INSERT OR DELETE ON community_poll_votes
FOR EACH ROW EXECUTE FUNCTION community_poll_recount();

-- ════════════════════════════════════════════════════════════════════
-- RPC: cast_poll_vote
--   single-choice: 기존 선택을 모두 삭제 후 새 옵션 추가
--   multi-choice : 토글 (있으면 삭제, 없으면 추가)
--   마감 / 부모글 권한 검증 포함
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION community_cast_poll_vote(
  p_poll_id UUID,
  p_option_id UUID,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_poll RECORD;
  v_option_count INT;
  v_already_voted BOOLEAN;
  v_post RECORD;
BEGIN
  -- 폴 조회
  SELECT * INTO v_poll FROM community_polls WHERE id = p_poll_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'poll_not_found');
  END IF;

  -- 마감 체크
  IF v_poll.closes_at IS NOT NULL AND v_poll.closes_at < NOW() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'poll_closed');
  END IF;

  -- 옵션이 이 폴에 속하는지 검증
  SELECT COUNT(*) INTO v_option_count
  FROM community_poll_options
  WHERE id = p_option_id AND poll_id = p_poll_id;

  IF v_option_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'option_invalid');
  END IF;

  -- 부모 게시글 가시성 검증 (draft는 작성자만, members는 인증유저, public은 누구나)
  SELECT p.visibility, p.author_id INTO v_post
  FROM community_posts p
  JOIN community_polls poll ON poll.post_id = p.id
  WHERE poll.id = p_poll_id;

  IF v_post.visibility = 'draft' AND v_post.author_id <> p_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  -- 같은 옵션에 이미 투표했나?
  SELECT EXISTS (
    SELECT 1 FROM community_poll_votes
    WHERE option_id = p_option_id AND user_id = p_user_id
  ) INTO v_already_voted;

  IF v_poll.allow_multiple THEN
    -- 다중 선택: 토글
    IF v_already_voted THEN
      DELETE FROM community_poll_votes
      WHERE option_id = p_option_id AND user_id = p_user_id;
      RETURN jsonb_build_object('ok', true, 'action', 'removed');
    ELSE
      INSERT INTO community_poll_votes (poll_id, option_id, user_id)
      VALUES (p_poll_id, p_option_id, p_user_id);
      RETURN jsonb_build_object('ok', true, 'action', 'added');
    END IF;
  ELSE
    -- 단일 선택: 같은 옵션 토글, 다른 옵션이면 교체
    IF v_already_voted THEN
      DELETE FROM community_poll_votes
      WHERE option_id = p_option_id AND user_id = p_user_id;
      RETURN jsonb_build_object('ok', true, 'action', 'removed');
    ELSE
      DELETE FROM community_poll_votes
      WHERE poll_id = p_poll_id AND user_id = p_user_id;
      INSERT INTO community_poll_votes (poll_id, option_id, user_id)
      VALUES (p_poll_id, p_option_id, p_user_id);
      RETURN jsonb_build_object('ok', true, 'action', 'switched');
    END IF;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION community_cast_poll_vote(UUID, UUID, UUID) TO authenticated;
