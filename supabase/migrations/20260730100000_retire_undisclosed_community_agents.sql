-- Permanently retire the undisclosed community-persona experiment.
--
-- The backing accounts were rendered as ordinary members. Keeping that content
-- public would contradict the product's AI disclosure promise. This migration
-- contains existing synthetic activity without deleting the authored text, then
-- adds a database fence so retired backing accounts cannot publish again.

UPDATE public.community_agent_personas
SET status = 'retired',
    updated_at = now()
WHERE status IS DISTINCT FROM 'retired';

UPDATE public.community_agent_content_drafts
SET auto_publish = false,
    status = CASE
      WHEN status IN ('draft', 'needs_review', 'approved') THEN 'archived'
      ELSE status
    END,
    updated_at = now()
WHERE agent_id IN (SELECT id FROM public.community_agent_personas);

UPDATE public.community_posts AS post
SET visibility = 'draft',
    is_pinned = false,
    is_weekly_best = false,
    updated_at = now()
WHERE post.author_id IN (
  SELECT backing_user_id
  FROM public.community_agent_personas
  WHERE backing_user_id IS NOT NULL
);

UPDATE public.community_comments AS comment
SET is_deleted = true,
    updated_at = now()
WHERE comment.author_id IN (
  SELECT backing_user_id
  FROM public.community_agent_personas
  WHERE backing_user_id IS NOT NULL
);

UPDATE public.cohort_messages AS message
SET is_deleted = true
WHERE message.author_id IN (
  SELECT backing_user_id
  FROM public.community_agent_personas
  WHERE backing_user_id IS NOT NULL
);

-- Synthetic reactions must not remain as social proof or inflate human metrics.
DELETE FROM public.community_votes AS vote
WHERE vote.user_id IN (
  SELECT backing_user_id
  FROM public.community_agent_personas
  WHERE backing_user_id IS NOT NULL
);

UPDATE public.community_posts AS post
SET upvote_count = (
      SELECT count(*)::int
      FROM public.community_votes AS vote
      WHERE vote.post_id = post.id AND vote.vote_type = 1
    ),
    downvote_count = (
      SELECT count(*)::int
      FROM public.community_votes AS vote
      WHERE vote.post_id = post.id AND vote.vote_type = -1
    ),
    comment_count = (
      SELECT count(*)::int
      FROM public.community_comments AS comment
      WHERE comment.post_id = post.id AND comment.is_deleted = false
    );

UPDATE public.community_comments AS comment
SET upvote_count = (
  SELECT count(*)::int
  FROM public.community_votes AS vote
  WHERE vote.comment_id = comment.id AND vote.vote_type = 1
);

UPDATE public.community_profiles AS profile
SET total_upvotes_received =
      COALESCE((
        SELECT sum(post.upvote_count)
        FROM public.community_posts AS post
        WHERE post.author_id = profile.user_id
      ), 0)
      + COALESCE((
        SELECT sum(comment.upvote_count)
        FROM public.community_comments AS comment
        WHERE comment.author_id = profile.user_id
          AND comment.is_deleted = false
      ), 0),
    updated_at = now();

UPDATE public.community_profiles AS profile
SET nickname = 'AI 콘텐츠(중단) ' || agent.slug,
    avatar_url = null,
    post_count = 0,
    comment_count = 0,
    total_upvotes_received = 0,
    updated_at = now()
FROM public.community_agent_personas AS agent
WHERE agent.backing_user_id = profile.user_id;

CREATE OR REPLACE FUNCTION public.block_retired_community_agent_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_id uuid;
  row_data jsonb := to_jsonb(NEW);
  is_contained boolean := false;
BEGIN
  actor_id := CASE
    WHEN TG_TABLE_NAME = 'community_votes' THEN (row_data ->> 'user_id')::uuid
    ELSE (row_data ->> 'author_id')::uuid
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM public.community_agent_personas AS agent
    WHERE agent.backing_user_id = actor_id
      AND agent.status = 'retired'
  ) THEN
    RETURN NEW;
  END IF;

  is_contained := CASE
    WHEN TG_TABLE_NAME = 'community_posts'
      THEN row_data ->> 'visibility' = 'draft'
    WHEN TG_TABLE_NAME IN ('community_comments', 'cohort_messages')
      THEN COALESCE((row_data ->> 'is_deleted')::boolean, false)
    ELSE false
  END;

  IF is_contained THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'retired community agent accounts cannot create public activity'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_block_retired_agent_posts ON public.community_posts;
CREATE TRIGGER trg_block_retired_agent_posts
BEFORE INSERT OR UPDATE ON public.community_posts
FOR EACH ROW EXECUTE FUNCTION public.block_retired_community_agent_activity();

DROP TRIGGER IF EXISTS trg_block_retired_agent_comments ON public.community_comments;
CREATE TRIGGER trg_block_retired_agent_comments
BEFORE INSERT OR UPDATE ON public.community_comments
FOR EACH ROW EXECUTE FUNCTION public.block_retired_community_agent_activity();

DROP TRIGGER IF EXISTS trg_block_retired_agent_votes ON public.community_votes;
CREATE TRIGGER trg_block_retired_agent_votes
BEFORE INSERT OR UPDATE ON public.community_votes
FOR EACH ROW EXECUTE FUNCTION public.block_retired_community_agent_activity();

DROP TRIGGER IF EXISTS trg_block_retired_agent_cohort_messages ON public.cohort_messages;
CREATE TRIGGER trg_block_retired_agent_cohort_messages
BEFORE INSERT OR UPDATE ON public.cohort_messages
FOR EACH ROW EXECUTE FUNCTION public.block_retired_community_agent_activity();

REVOKE ALL ON FUNCTION public.block_retired_community_agent_activity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.block_retired_community_agent_activity() TO service_role;
