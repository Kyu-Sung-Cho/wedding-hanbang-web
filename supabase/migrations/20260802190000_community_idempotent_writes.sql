-- Make bookmark intent and cohort message delivery retry-safe.
--
-- A toggle endpoint can invert a user's intent when a response is lost and the
-- client retries. Cohort messages previously had no stable request identity,
-- so an uncertain network outcome could create duplicates. Both writes now go
-- through service-role-only atomic RPCs.

REVOKE INSERT, UPDATE, DELETE ON TABLE public.community_bookmarks
  FROM anon, authenticated;
GRANT SELECT ON TABLE public.community_bookmarks TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.community_bookmarks TO service_role;

CREATE OR REPLACE FUNCTION public.community_set_post_bookmark(
  p_user_id uuid,
  p_post_id uuid,
  p_bookmarked boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_user_id IS NULL OR p_post_id IS NULL OR p_bookmarked IS NULL THEN
    RAISE EXCEPTION 'invalid bookmark intent' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM auth.users AS app_user WHERE app_user.id = p_user_id
  ) THEN
    RAISE EXCEPTION 'bookmark user not found' USING ERRCODE = '23503';
  END IF;

  -- The post row serializes all bookmark writers for this post. Count is
  -- always derived while this lock is held, so cached count cannot drift.
  PERFORM 1
  FROM public.community_posts AS post
  WHERE post.id = p_post_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bookmark post not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_bookmarked AND EXISTS (
    SELECT 1
    FROM public.community_profiles AS profile
    WHERE profile.user_id = p_user_id
      AND profile.is_suspended IS TRUE
  ) THEN
    RAISE EXCEPTION 'community write suspended' USING ERRCODE = '42501';
  END IF;

  IF p_bookmarked THEN
    INSERT INTO public.community_bookmarks(user_id, post_id)
    VALUES (p_user_id, p_post_id)
    ON CONFLICT (user_id, post_id) DO NOTHING;
  ELSE
    DELETE FROM public.community_bookmarks
    WHERE user_id = p_user_id
      AND post_id = p_post_id;
  END IF;

  SELECT count(*)::integer
  INTO v_count
  FROM public.community_bookmarks AS bookmark
  WHERE bookmark.post_id = p_post_id;

  UPDATE public.community_posts
  SET bookmark_count = v_count
  WHERE id = p_post_id;

  RETURN jsonb_build_object(
    'bookmarked', p_bookmarked,
    'bookmark_count', v_count
  );
END;
$$;

REVOKE ALL
  ON FUNCTION public.community_set_post_bookmark(uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE
  ON FUNCTION public.community_set_post_bookmark(uuid, uuid, boolean)
  TO service_role;

ALTER TABLE public.cohort_messages
  ADD COLUMN IF NOT EXISTS client_request_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS cohort_messages_client_request_unique
  ON public.cohort_messages(room_id, author_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.cohort_messages
  FROM anon, authenticated;
GRANT SELECT ON TABLE public.cohort_messages TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.cohort_messages TO service_role;

CREATE OR REPLACE FUNCTION public.community_create_cohort_message(
  p_user_id uuid,
  p_room_id uuid,
  p_client_request_id uuid,
  p_content text,
  p_thread_topic text DEFAULT NULL,
  p_reply_to uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_message public.cohort_messages%ROWTYPE;
  v_inserted boolean := false;
BEGIN
  IF p_user_id IS NULL
     OR p_room_id IS NULL
     OR p_client_request_id IS NULL
     OR p_content IS NULL
     OR char_length(p_content) < 1
     OR char_length(p_content) > 2000
     OR p_content IS DISTINCT FROM btrim(p_content)
     OR p_thread_topic IS NOT NULL
        AND p_thread_topic NOT IN ('price', 'review', 'concern', 'chat') THEN
    RAISE EXCEPTION 'invalid cohort message request' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.cohort_members AS member
    WHERE member.room_id = p_room_id
      AND member.user_id = p_user_id
      AND member.is_active IS TRUE
  ) THEN
    RAISE EXCEPTION 'active cohort member required' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.community_profiles AS profile
    WHERE profile.user_id = p_user_id
      AND profile.is_suspended IS TRUE
  ) THEN
    RAISE EXCEPTION 'community write suspended' USING ERRCODE = '42501';
  END IF;

  IF p_reply_to IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.cohort_messages AS parent
    WHERE parent.id = p_reply_to
      AND parent.room_id = p_room_id
      AND parent.is_deleted IS FALSE
  ) THEN
    RAISE EXCEPTION 'reply target is not an active message in this room'
      USING ERRCODE = '23503';
  END IF;

  SELECT message.*
  INTO v_message
  FROM public.cohort_messages AS message
  WHERE message.room_id = p_room_id
    AND message.author_id = p_user_id
    AND message.client_request_id = p_client_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.cohort_messages(
      room_id,
      author_id,
      client_request_id,
      content,
      thread_topic,
      reply_to
    )
    VALUES (
      p_room_id,
      p_user_id,
      p_client_request_id,
      p_content,
      p_thread_topic,
      p_reply_to
    )
    ON CONFLICT (room_id, author_id, client_request_id)
      WHERE client_request_id IS NOT NULL
      DO NOTHING
    RETURNING * INTO v_message;
    v_inserted := FOUND;

    IF NOT v_inserted THEN
      SELECT message.*
      INTO v_message
      FROM public.cohort_messages AS message
      WHERE message.room_id = p_room_id
        AND message.author_id = p_user_id
        AND message.client_request_id = p_client_request_id
      FOR UPDATE;
    END IF;
  END IF;

  IF v_message.id IS NULL THEN
    RAISE EXCEPTION 'cohort message idempotency state unavailable'
      USING ERRCODE = '40001';
  END IF;

  IF v_message.content IS DISTINCT FROM p_content
     OR v_message.thread_topic IS DISTINCT FROM p_thread_topic
     OR v_message.reply_to IS DISTINCT FROM p_reply_to THEN
    RAISE EXCEPTION 'cohort message idempotency key reused with different payload'
      USING ERRCODE = '22023';
  END IF;

  RETURN to_jsonb(v_message) || jsonb_build_object('replayed', NOT v_inserted);
END;
$$;

REVOKE ALL
  ON FUNCTION public.community_create_cohort_message(
    uuid, uuid, uuid, text, text, uuid
  )
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE
  ON FUNCTION public.community_create_cohort_message(
    uuid, uuid, uuid, text, text, uuid
  )
  TO service_role;

COMMENT ON FUNCTION public.community_set_post_bookmark(uuid, uuid, boolean) IS
  'Sets explicit bookmark intent and atomically derives the post count; service role only.';
COMMENT ON FUNCTION public.community_create_cohort_message(
  uuid, uuid, uuid, text, text, uuid
) IS
  'Creates or replays one owner-bound cohort message by client request UUID; service role only.';
