-- Keep community post reactions as likes, not bidirectional votes.

DELETE FROM community_votes
WHERE post_id IS NOT NULL
  AND vote_type <> 1;

WITH ranked_post_votes AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, post_id
      ORDER BY created_at DESC, id DESC
    ) AS rn
  FROM community_votes
  WHERE post_id IS NOT NULL
)
DELETE FROM community_votes v
USING ranked_post_votes r
WHERE v.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS community_votes_one_post_like_per_user
  ON community_votes(user_id, post_id)
  WHERE post_id IS NOT NULL;

UPDATE community_posts p
SET
  upvote_count = COALESCE((
    SELECT COUNT(*)::INT
    FROM community_votes v
    WHERE v.post_id = p.id
      AND v.vote_type = 1
  ), 0),
  downvote_count = 0;

CREATE OR REPLACE FUNCTION community_vote_post(
  p_user_id UUID,
  p_post_id UUID,
  p_vote_type SMALLINT
)
RETURNS void AS $$
DECLARE
  old_vote SMALLINT;
  inserted_id UUID;
BEGIN
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
          downvote_count = GREATEST(downvote_count, 0)
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
          downvote_count = GREATEST(downvote_count, 0)
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
$$ LANGUAGE plpgsql SECURITY DEFINER;
