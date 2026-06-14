-- Harden community RPC trust boundaries.
-- User-facing RPCs must bind p_user_id to auth.uid().
-- Internal counter/XP/view RPCs are service_role only.

CREATE OR REPLACE FUNCTION public.community_vote_post(
  p_user_id UUID,
  p_post_id UUID,
  p_vote_type SMALLINT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_vote SMALLINT;
  inserted_id UUID;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
    AND (auth.uid() IS NULL OR auth.uid() <> p_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_vote_type NOT IN (0, 1) THEN
    RAISE EXCEPTION 'invalid_post_vote_type' USING ERRCODE = '22023';
  END IF;

  SELECT vote_type
  INTO old_vote
  FROM community_votes
  WHERE user_id = p_user_id
    AND post_id = p_post_id;

  IF p_vote_type = 0 THEN
    DELETE FROM community_votes
    WHERE user_id = p_user_id
      AND post_id = p_post_id;

    IF old_vote = 1 THEN
      UPDATE community_posts
      SET upvote_count = GREATEST(upvote_count - 1, 0),
          downvote_count = 0
      WHERE id = p_post_id;
    END IF;
  ELSIF old_vote IS NULL THEN
    INSERT INTO community_votes (user_id, post_id, vote_type)
    VALUES (p_user_id, p_post_id, 1)
    ON CONFLICT DO NOTHING
    RETURNING id INTO inserted_id;

    IF inserted_id IS NOT NULL THEN
      UPDATE community_posts
      SET upvote_count = upvote_count + 1,
          downvote_count = 0
      WHERE id = p_post_id;
    END IF;
  ELSIF old_vote <> 1 THEN
    UPDATE community_votes
    SET vote_type = 1
    WHERE user_id = p_user_id
      AND post_id = p_post_id;

    UPDATE community_posts
    SET upvote_count = upvote_count + 1,
        downvote_count = GREATEST(downvote_count - 1, 0)
    WHERE id = p_post_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_vote_comment(
  p_user_id UUID,
  p_comment_id UUID,
  p_vote_type SMALLINT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_vote SMALLINT;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
    AND (auth.uid() IS NULL OR auth.uid() <> p_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_vote_type NOT IN (-1, 0, 1) THEN
    RAISE EXCEPTION 'invalid_comment_vote_type' USING ERRCODE = '22023';
  END IF;

  SELECT vote_type
  INTO old_vote
  FROM community_votes
  WHERE user_id = p_user_id
    AND comment_id = p_comment_id;

  IF p_vote_type = 0 THEN
    DELETE FROM community_votes
    WHERE user_id = p_user_id
      AND comment_id = p_comment_id;

    IF old_vote = 1 THEN
      UPDATE community_comments
      SET upvote_count = GREATEST(upvote_count - 1, 0)
      WHERE id = p_comment_id;
    END IF;
  ELSIF old_vote IS NULL THEN
    INSERT INTO community_votes (user_id, comment_id, vote_type)
    VALUES (p_user_id, p_comment_id, p_vote_type);

    IF p_vote_type = 1 THEN
      UPDATE community_comments
      SET upvote_count = upvote_count + 1
      WHERE id = p_comment_id;
    END IF;
  ELSIF old_vote <> p_vote_type THEN
    UPDATE community_votes
    SET vote_type = p_vote_type
    WHERE user_id = p_user_id
      AND comment_id = p_comment_id;

    IF p_vote_type = 1 THEN
      UPDATE community_comments
      SET upvote_count = upvote_count + 1
      WHERE id = p_comment_id;
    ELSE
      UPDATE community_comments
      SET upvote_count = GREATEST(upvote_count - 1, 0)
      WHERE id = p_comment_id;
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_increment_view(p_post_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE community_posts
  SET view_count = COALESCE(view_count, 0) + 1
  WHERE id = p_post_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_update_bookmark_count(p_post_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE community_posts
  SET bookmark_count = (
    SELECT COUNT(*)::INT FROM community_bookmarks WHERE post_id = p_post_id
  )
  WHERE id = p_post_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_increment_profile_count(
  p_user_id UUID,
  p_field TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_field = 'post_count' THEN
    UPDATE community_profiles
    SET post_count = COALESCE(post_count, 0) + 1
    WHERE user_id = p_user_id;
  ELSIF p_field = 'comment_count' THEN
    UPDATE community_profiles
    SET comment_count = COALESCE(comment_count, 0) + 1
    WHERE user_id = p_user_id;
  ELSE
    RAISE EXCEPTION 'invalid_profile_count_field' USING ERRCODE = '22023';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_decrement_profile_count(
  p_user_id UUID,
  p_field TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_field = 'post_count' THEN
    UPDATE community_profiles
    SET post_count = GREATEST(0, COALESCE(post_count, 0) - 1)
    WHERE user_id = p_user_id;
  ELSIF p_field = 'comment_count' THEN
    UPDATE community_profiles
    SET comment_count = GREATEST(0, COALESCE(comment_count, 0) - 1)
    WHERE user_id = p_user_id;
  ELSE
    RAISE EXCEPTION 'invalid_profile_count_field' USING ERRCODE = '22023';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_cast_poll_vote(
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
  IF COALESCE(auth.role(), '') <> 'service_role'
    AND (auth.uid() IS NULL OR auth.uid() <> p_user_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT * INTO v_poll FROM community_polls WHERE id = p_poll_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'poll_not_found');
  END IF;

  IF v_poll.closes_at IS NOT NULL AND v_poll.closes_at < NOW() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'poll_closed');
  END IF;

  SELECT COUNT(*)
  INTO v_option_count
  FROM community_poll_options
  WHERE id = p_option_id
    AND poll_id = p_poll_id;

  IF v_option_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'option_invalid');
  END IF;

  SELECT p.visibility, p.author_id
  INTO v_post
  FROM community_posts p
  JOIN community_polls poll ON poll.post_id = p.id
  WHERE poll.id = p_poll_id;

  IF v_post.visibility = 'draft' AND v_post.author_id <> p_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM community_poll_votes
    WHERE option_id = p_option_id
      AND user_id = p_user_id
  )
  INTO v_already_voted;

  IF v_poll.allow_multiple THEN
    IF v_already_voted THEN
      DELETE FROM community_poll_votes
      WHERE option_id = p_option_id
        AND user_id = p_user_id;
      RETURN jsonb_build_object('ok', true, 'action', 'removed');
    END IF;

    INSERT INTO community_poll_votes (poll_id, option_id, user_id)
    VALUES (p_poll_id, p_option_id, p_user_id);
    RETURN jsonb_build_object('ok', true, 'action', 'added');
  END IF;

  IF v_already_voted THEN
    DELETE FROM community_poll_votes
    WHERE option_id = p_option_id
      AND user_id = p_user_id;
    RETURN jsonb_build_object('ok', true, 'action', 'removed');
  END IF;

  DELETE FROM community_poll_votes
  WHERE poll_id = p_poll_id
    AND user_id = p_user_id;

  INSERT INTO community_poll_votes (poll_id, option_id, user_id)
  VALUES (p_poll_id, p_option_id, p_user_id);
  RETURN jsonb_build_object('ok', true, 'action', 'switched');
END;
$$;

CREATE OR REPLACE FUNCTION public.community_record_login(p_user_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_streak community_streaks%ROWTYPE;
  v_today DATE := CURRENT_DATE;
  v_xp_earned INT := 0;
  v_streak_bonus INT := 0;
  v_new_streak INT;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
    AND (auth.uid() IS NULL OR auth.uid() <> p_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  INSERT INTO community_streaks (user_id, current_streak, longest_streak, last_login_date, total_logins)
  VALUES (p_user_id, 0, 0, NULL, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_streak FROM community_streaks WHERE user_id = p_user_id FOR UPDATE;

  IF v_streak.last_login_date = v_today THEN
    RETURN json_build_object('xp_earned', 0, 'streak', v_streak.current_streak, 'already_logged', true);
  END IF;

  IF v_streak.last_login_date = v_today - 1 THEN
    v_new_streak := v_streak.current_streak + 1;
  ELSE
    v_new_streak := 1;
  END IF;

  v_xp_earned := 20;

  IF v_new_streak > 0 AND v_new_streak % 7 = 0 THEN
    v_streak_bonus := 50;
    v_xp_earned := v_xp_earned + v_streak_bonus;
    INSERT INTO community_xp_log (user_id, action, xp)
    VALUES (p_user_id, 'streak_bonus', v_streak_bonus);
  END IF;

  UPDATE community_streaks
  SET current_streak = v_new_streak,
      longest_streak = GREATEST(v_streak.longest_streak, v_new_streak),
      last_login_date = v_today,
      total_logins = v_streak.total_logins + 1,
      updated_at = NOW()
  WHERE user_id = p_user_id;

  INSERT INTO community_xp_log (user_id, action, xp)
  VALUES (p_user_id, 'daily_login', 20);

  UPDATE community_profiles
  SET total_xp = COALESCE(total_xp, 0) + v_xp_earned,
      level = GREATEST(1, FLOOR(SQRT((COALESCE(total_xp, 0) + v_xp_earned) / 100.0)) + 1)
  WHERE user_id = p_user_id;

  RETURN json_build_object(
    'xp_earned', v_xp_earned,
    'streak', v_new_streak,
    'streak_bonus', v_streak_bonus,
    'already_logged', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.community_award_xp(
  p_user_id UUID,
  p_action TEXT,
  p_xp INT,
  p_reference_id UUID DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO community_xp_log (user_id, action, xp, reference_id)
  VALUES (p_user_id, p_action, p_xp, p_reference_id);

  UPDATE community_profiles
  SET total_xp = COALESCE(total_xp, 0) + p_xp,
      level = GREATEST(1, FLOOR(SQRT((COALESCE(total_xp, 0) + p_xp) / 100.0)) + 1)
  WHERE user_id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_unlock_achievement(
  p_user_id UUID,
  p_key TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.community_update_progress(
  p_user_id UUID,
  p_percent INT,
  p_event_type TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room_id UUID;
BEGIN
  IF p_percent < 0 OR p_percent > 100 THEN
    RAISE EXCEPTION 'invalid_progress_percent' USING ERRCODE = '22023';
  END IF;

  UPDATE community_profiles
  SET progress_percent = p_percent
  WHERE user_id = p_user_id;

  IF p_event_type IS NOT NULL THEN
    SELECT room_id
    INTO v_room_id
    FROM cohort_members
    WHERE user_id = p_user_id
      AND is_active = TRUE
    LIMIT 1;

    IF v_room_id IS NOT NULL THEN
      INSERT INTO cohort_timeline_events (room_id, user_id, event_type, description)
      VALUES (v_room_id, p_user_id, p_event_type, p_description);
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.community_vote_post(UUID, UUID, SMALLINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.community_vote_post(UUID, UUID, SMALLINT) FROM anon;
REVOKE ALL ON FUNCTION public.community_vote_post(UUID, UUID, SMALLINT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.community_vote_post(UUID, UUID, SMALLINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_vote_post(UUID, UUID, SMALLINT) TO service_role;

REVOKE ALL ON FUNCTION public.community_vote_comment(UUID, UUID, SMALLINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.community_vote_comment(UUID, UUID, SMALLINT) FROM anon;
REVOKE ALL ON FUNCTION public.community_vote_comment(UUID, UUID, SMALLINT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.community_vote_comment(UUID, UUID, SMALLINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_vote_comment(UUID, UUID, SMALLINT) TO service_role;

REVOKE ALL ON FUNCTION public.community_record_login(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.community_record_login(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.community_record_login(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.community_record_login(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_record_login(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.community_cast_poll_vote(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.community_cast_poll_vote(UUID, UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.community_cast_poll_vote(UUID, UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.community_cast_poll_vote(UUID, UUID, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.community_increment_view(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.community_increment_view(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.community_increment_view(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.community_increment_view(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.community_update_bookmark_count(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.community_update_bookmark_count(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.community_update_bookmark_count(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.community_update_bookmark_count(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.community_increment_profile_count(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.community_increment_profile_count(UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.community_increment_profile_count(UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.community_increment_profile_count(UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.community_decrement_profile_count(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.community_decrement_profile_count(UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.community_decrement_profile_count(UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.community_decrement_profile_count(UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.community_award_xp(UUID, TEXT, INT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.community_award_xp(UUID, TEXT, INT, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.community_award_xp(UUID, TEXT, INT, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.community_award_xp(UUID, TEXT, INT, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.community_unlock_achievement(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.community_unlock_achievement(UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.community_unlock_achievement(UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.community_unlock_achievement(UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.community_update_progress(UUID, INT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.community_update_progress(UUID, INT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.community_update_progress(UUID, INT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.community_update_progress(UUID, INT, TEXT, TEXT) TO service_role;
