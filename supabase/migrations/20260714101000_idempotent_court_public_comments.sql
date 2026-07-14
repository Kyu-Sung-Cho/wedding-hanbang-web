SET lock_timeout = '5s';
SET statement_timeout = '90s';

-- Give every historical comment an opaque request identity without firing the
-- row's update triggers. The short lock timeout fails closed if the table is
-- busy; the validated check lets SET NOT NULL avoid another full-table scan.
ALTER TABLE public.court_comments
  ADD COLUMN submission_request_id uuid DEFAULT pg_catalog.gen_random_uuid();

ALTER TABLE public.court_comments
  ADD CONSTRAINT court_comments_submission_request_id_present
  CHECK (submission_request_id IS NOT NULL) NOT VALID;

ALTER TABLE public.court_comments
  VALIDATE CONSTRAINT court_comments_submission_request_id_present;

ALTER TABLE public.court_comments
  ALTER COLUMN submission_request_id SET NOT NULL;

ALTER TABLE public.court_comments
  DROP CONSTRAINT court_comments_submission_request_id_present;

-- One client request identity belongs to exactly one logical comment for a
-- user, even when two server requests arrive concurrently.
ALTER TABLE public.court_comments
  ADD CONSTRAINT court_comments_user_submission_request_key
  UNIQUE (user_id, submission_request_id);

-- Repair upgrades from any earlier revision that granted table-wide owner
-- reads. The request identity and moderator-only fields never cross RLS even
-- when the owner policy matches.
REVOKE SELECT ON TABLE public.court_comments
  FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id, public_post_id, comment_type, body, moderation_status, created_at, updated_at
) ON TABLE public.court_comments TO authenticated;

CREATE OR REPLACE FUNCTION public.create_court_public_comment(
  p_public_post_id uuid,
  p_user_id uuid,
  p_submission_request_id uuid,
  p_comment_type text,
  p_body text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_case_id uuid;
  v_body text := pg_catalog.btrim(COALESCE(p_body, ''));
  v_comment public.court_comments%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_public_post_id IS NULL
    OR p_user_id IS NULL
    OR p_submission_request_id IS NULL
    OR p_comment_type IS NULL
    OR p_comment_type NOT IN ('empathy', 'experience', 'practical_advice', 'question')
    OR pg_catalog.char_length(v_body) NOT BETWEEN 2 AND 500
  THEN
    RAISE EXCEPTION 'invalid court comment arguments' USING ERRCODE = '22023';
  END IF;

  -- This profile lock shares the established account-deletion fence and also
  -- serializes same-user retries before the unique constraint is reached.
  PERFORM 1
  FROM public.profiles AS profile
  WHERE profile.id = p_user_id
    AND profile.account_deleting_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active court user is required' USING ERRCODE = '42501';
  END IF;

  -- Replay is checked before current publication availability. A lost ACK
  -- must still recover the original comment if comments were disabled later.
  SELECT comment.* INTO v_comment
  FROM public.court_comments AS comment
  WHERE comment.user_id = p_user_id
    AND comment.submission_request_id = p_submission_request_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_comment.public_post_id IS DISTINCT FROM p_public_post_id
      OR v_comment.comment_type IS DISTINCT FROM p_comment_type
      OR v_comment.body IS DISTINCT FROM v_body
    THEN
      RAISE EXCEPTION 'court_comment_submission_request_mismatch'
        USING ERRCODE = '22023';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'comment_id', v_comment.id,
      'moderation_status', v_comment.moderation_status,
      'reused', true
    );
  END IF;

  SELECT post.case_id INTO v_case_id
  FROM public.court_public_posts AS post
  WHERE post.id = p_public_post_id
    AND post.status = 'published'
    AND post.safety_level = 'normal'
    AND post.moderation_status = 'approved'
    AND post.comments_enabled
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court comments are unavailable' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.court_comments (
    public_post_id,
    user_id,
    submission_request_id,
    comment_type,
    body,
    moderation_status
  ) VALUES (
    p_public_post_id,
    p_user_id,
    p_submission_request_id,
    p_comment_type,
    v_body,
    'pending'
  )
  RETURNING * INTO v_comment;

  INSERT INTO public.court_case_events (
    case_id, actor_participant_id, event_type, metadata
  ) VALUES (
    v_case_id, NULL, 'public_comment_created',
    pg_catalog.jsonb_build_object('status', 'pending')
  );

  RETURN pg_catalog.jsonb_build_object(
    'comment_id', v_comment.id,
    'moderation_status', v_comment.moderation_status,
    'reused', false
  );
END;
$$;

-- A committed exact replay must remain reachable even when the user's hourly
-- write budget was consumed by the original request whose HTTP ACK was lost.
-- This function never inserts; the route calls it before applying the new-
-- write limiter and falls through only when `found` is false.
CREATE FUNCTION public.replay_court_public_comment(
  p_public_post_id uuid,
  p_user_id uuid,
  p_submission_request_id uuid,
  p_comment_type text,
  p_body text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_body text := pg_catalog.btrim(COALESCE(p_body, ''));
  v_comment public.court_comments%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_public_post_id IS NULL
    OR p_user_id IS NULL
    OR p_submission_request_id IS NULL
    OR p_comment_type IS NULL
    OR p_comment_type NOT IN ('empathy', 'experience', 'practical_advice', 'question')
    OR pg_catalog.char_length(v_body) NOT BETWEEN 2 AND 500
  THEN
    RAISE EXCEPTION 'invalid court comment replay arguments'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.profiles AS profile
  WHERE profile.id = p_user_id
    AND profile.account_deleting_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active court user is required' USING ERRCODE = '42501';
  END IF;

  SELECT comment.* INTO v_comment
  FROM public.court_comments AS comment
  WHERE comment.user_id = p_user_id
    AND comment.submission_request_id = p_submission_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('found', false);
  END IF;
  IF v_comment.public_post_id IS DISTINCT FROM p_public_post_id
    OR v_comment.comment_type IS DISTINCT FROM p_comment_type
    OR v_comment.body IS DISTINCT FROM v_body
  THEN
    RAISE EXCEPTION 'court_comment_submission_request_mismatch'
      USING ERRCODE = '22023';
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'found', true,
    'comment_id', v_comment.id,
    'moderation_status', v_comment.moderation_status,
    'reused', true
  );
END;
$$;

-- Keep older application deployments callable during a database-first
-- rollout. They receive a fresh identity per call and therefore preserve the
-- pre-migration behavior until the five-argument client is deployed.
CREATE OR REPLACE FUNCTION public.create_court_public_comment(
  p_public_post_id uuid,
  p_user_id uuid,
  p_comment_type text,
  p_body text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RETURN public.create_court_public_comment(
    p_public_post_id,
    p_user_id,
    pg_catalog.gen_random_uuid(),
    p_comment_type,
    p_body
  );
END;
$$;

ALTER FUNCTION public.create_court_public_comment(uuid, uuid, uuid, text, text)
  OWNER TO postgres;
ALTER FUNCTION public.create_court_public_comment(uuid, uuid, text, text)
  OWNER TO postgres;
ALTER FUNCTION public.replay_court_public_comment(uuid, uuid, uuid, text, text)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.create_court_public_comment(uuid, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_court_public_comment(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.replay_court_public_comment(uuid, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_court_public_comment(uuid, uuid, uuid, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.create_court_public_comment(uuid, uuid, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.replay_court_public_comment(uuid, uuid, uuid, text, text)
  TO service_role;

-- New writes must supply their identity explicitly. The default existed only
-- to make the expand/backfill window safe for the legacy function.
ALTER TABLE public.court_comments
  ALTER COLUMN submission_request_id DROP DEFAULT;

COMMENT ON COLUMN public.court_comments.submission_request_id IS
  'Service-only client request identity. Unique per user and never projected to public or authenticated readers.';
