-- =============================================
-- 웨딩한방 커뮤니티 게이미피케이션 마이그레이션
-- =============================================

-- 1. community_xp_log: XP 이력
CREATE TABLE IF NOT EXISTS community_xp_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('post_create', 'comment_create', 'receive_upvote', 'daily_login', 'streak_bonus', 'achievement_unlock', 'weekly_best')),
  xp INT NOT NULL,
  reference_id UUID, -- post or comment id
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_xp_user ON community_xp_log(user_id);
CREATE INDEX idx_xp_created ON community_xp_log(created_at DESC);

ALTER TABLE community_xp_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "xp_select" ON community_xp_log FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "xp_insert" ON community_xp_log FOR INSERT WITH CHECK (false); -- only via RPC

-- 2. community_streaks: 출석 스트릭
CREATE TABLE IF NOT EXISTS community_streaks (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  current_streak INT DEFAULT 0,
  longest_streak INT DEFAULT 0,
  last_login_date DATE,
  total_logins INT DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE community_streaks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "streak_select" ON community_streaks FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "streak_insert" ON community_streaks FOR INSERT WITH CHECK (user_id = auth.uid());

-- 3. community_achievements: 유저가 획득한 뱃지
CREATE TABLE IF NOT EXISTS community_achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  achievement_key TEXT NOT NULL,
  unlocked_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, achievement_key)
);

CREATE INDEX idx_ach_user ON community_achievements(user_id);
ALTER TABLE community_achievements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ach_select" ON community_achievements FOR SELECT USING (true); -- public read
CREATE POLICY "ach_insert" ON community_achievements FOR INSERT WITH CHECK (false); -- only via RPC

-- 4. Add xp fields to community_profiles
ALTER TABLE community_profiles ADD COLUMN IF NOT EXISTS total_xp INT DEFAULT 0;
ALTER TABLE community_profiles ADD COLUMN IF NOT EXISTS level INT DEFAULT 1;

-- =============================================
-- RPC Functions
-- =============================================

-- 출석 기록 및 스트릭 업데이트
CREATE OR REPLACE FUNCTION community_record_login(p_user_id UUID)
RETURNS JSON AS $$
DECLARE
  v_streak community_streaks%ROWTYPE;
  v_today DATE := CURRENT_DATE;
  v_xp_earned INT := 0;
  v_streak_bonus INT := 0;
  v_new_streak INT;
BEGIN
  -- Get or create streak record
  INSERT INTO community_streaks (user_id, current_streak, longest_streak, last_login_date, total_logins)
  VALUES (p_user_id, 0, 0, NULL, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_streak FROM community_streaks WHERE user_id = p_user_id FOR UPDATE;

  -- 이미 오늘 로그인한 경우
  IF v_streak.last_login_date = v_today THEN
    RETURN json_build_object('xp_earned', 0, 'streak', v_streak.current_streak, 'already_logged', true);
  END IF;

  -- 스트릭 계산
  IF v_streak.last_login_date = v_today - 1 THEN
    v_new_streak := v_streak.current_streak + 1;
  ELSE
    v_new_streak := 1;
  END IF;

  -- 기본 로그인 XP
  v_xp_earned := 20;

  -- 7일 연속 보너스
  IF v_new_streak > 0 AND v_new_streak % 7 = 0 THEN
    v_streak_bonus := 50;
    v_xp_earned := v_xp_earned + v_streak_bonus;
    INSERT INTO community_xp_log (user_id, action, xp) VALUES (p_user_id, 'streak_bonus', v_streak_bonus);
  END IF;

  -- 스트릭 업데이트
  UPDATE community_streaks SET
    current_streak = v_new_streak,
    longest_streak = GREATEST(v_streak.longest_streak, v_new_streak),
    last_login_date = v_today,
    total_logins = v_streak.total_logins + 1,
    updated_at = NOW()
  WHERE user_id = p_user_id;

  -- 일일 로그인 XP 기록
  INSERT INTO community_xp_log (user_id, action, xp) VALUES (p_user_id, 'daily_login', 20);

  -- 총 XP 및 레벨 업데이트
  UPDATE community_profiles SET
    total_xp = total_xp + v_xp_earned,
    level = GREATEST(1, FLOOR(SQRT((total_xp + v_xp_earned) / 100.0)) + 1)
  WHERE user_id = p_user_id;

  RETURN json_build_object('xp_earned', v_xp_earned, 'streak', v_new_streak, 'streak_bonus', v_streak_bonus, 'already_logged', false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 액션별 XP 부여
CREATE OR REPLACE FUNCTION community_award_xp(p_user_id UUID, p_action TEXT, p_xp INT, p_reference_id UUID DEFAULT NULL)
RETURNS void AS $$
BEGIN
  INSERT INTO community_xp_log (user_id, action, xp, reference_id) VALUES (p_user_id, p_action, p_xp, p_reference_id);
  UPDATE community_profiles SET
    total_xp = total_xp + p_xp,
    level = GREATEST(1, FLOOR(SQRT((total_xp + p_xp) / 100.0)) + 1)
  WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 업적 달성
CREATE OR REPLACE FUNCTION community_unlock_achievement(p_user_id UUID, p_key TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  INSERT INTO community_achievements (user_id, achievement_key)
  VALUES (p_user_id, p_key)
  ON CONFLICT (user_id, achievement_key) DO NOTHING;

  IF FOUND THEN
    PERFORM community_award_xp(p_user_id, 'achievement_unlock', 100);
    RETURN true;
  END IF;
  RETURN false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 주간 리더보드
CREATE OR REPLACE FUNCTION community_weekly_leaderboard(p_limit INT DEFAULT 5)
RETURNS TABLE(user_id UUID, nickname TEXT, avatar_url TEXT, badge TEXT, level INT, weekly_xp BIGINT) AS $$
BEGIN
  RETURN QUERY
  SELECT
    xl.user_id,
    cp.nickname,
    cp.avatar_url,
    cp.badge,
    cp.level,
    SUM(xl.xp) as weekly_xp
  FROM community_xp_log xl
  JOIN community_profiles cp ON cp.user_id = xl.user_id
  WHERE xl.created_at >= date_trunc('week', CURRENT_DATE)
  GROUP BY xl.user_id, cp.nickname, cp.avatar_url, cp.badge, cp.level
  ORDER BY weekly_xp DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
