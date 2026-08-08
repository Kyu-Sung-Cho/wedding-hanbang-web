-- Community answer -> notification -> return loop.
-- This migration is intentionally forward-only and must be applied through the
-- repository release controller after hosted staging verification.

CREATE TABLE IF NOT EXISTS public.community_comment_commands (
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  post_id uuid NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.community_comments(id) ON DELETE CASCADE,
  content text NOT NULL CHECK (length(btrim(content)) BETWEEN 1 AND 5000),
  comment_id uuid NOT NULL UNIQUE
    REFERENCES public.community_comments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (author_id, idempotency_key)
);

ALTER TABLE public.community_comment_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.community_comment_commands
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.community_comment_commands TO service_role;

CREATE TABLE IF NOT EXISTS public.community_reply_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  comment_id uuid NOT NULL REFERENCES public.community_comments(id) ON DELETE CASCADE,
  parent_comment_id uuid REFERENCES public.community_comments(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('post_reply', 'comment_reply')),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_reply_notifications_no_self
    CHECK (recipient_id <> actor_id),
  CONSTRAINT community_reply_notifications_recipient_comment_unique
    UNIQUE (recipient_id, comment_id)
);

CREATE INDEX IF NOT EXISTS community_reply_notifications_recipient_unread_idx
  ON public.community_reply_notifications (recipient_id, created_at DESC, id DESC)
  WHERE read_at IS NULL;

ALTER TABLE public.community_reply_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS community_reply_notifications_recipient_select
  ON public.community_reply_notifications;
CREATE POLICY community_reply_notifications_recipient_select
  ON public.community_reply_notifications
  FOR SELECT
  TO authenticated
  USING (recipient_id = auth.uid());

DROP POLICY IF EXISTS community_reply_notifications_recipient_read
  ON public.community_reply_notifications;
CREATE POLICY community_reply_notifications_recipient_read
  ON public.community_reply_notifications
  FOR UPDATE
  TO authenticated
  USING (recipient_id = auth.uid())
  WITH CHECK (recipient_id = auth.uid());

REVOKE ALL ON TABLE public.community_reply_notifications
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE (read_at)
  ON TABLE public.community_reply_notifications TO authenticated;
GRANT ALL ON TABLE public.community_reply_notifications TO service_role;

CREATE OR REPLACE FUNCTION public.community_guard_reply_notification_read()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (to_jsonb(NEW) - 'read_at') IS DISTINCT FROM (to_jsonb(OLD) - 'read_at')
     OR (OLD.read_at IS NOT NULL AND NEW.read_at IS DISTINCT FROM OLD.read_at)
     OR (OLD.read_at IS NULL AND NEW.read_at IS NULL) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'COMMUNITY_REPLY_NOTIFICATION_READ_ONLY';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.community_guard_reply_notification_read()
  FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_community_reply_notifications_read_only
  ON public.community_reply_notifications;
CREATE TRIGGER trg_community_reply_notifications_read_only
BEFORE UPDATE ON public.community_reply_notifications
FOR EACH ROW
EXECUTE FUNCTION public.community_guard_reply_notification_read();

-- A member comment must go through the atomic RPC. Existing server-side AI and
-- moderation paths retain service-role access.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.community_comments
  FROM anon, authenticated;
GRANT ALL ON TABLE public.community_comments TO service_role;

DROP POLICY IF EXISTS "cc_insert" ON public.community_comments;
DROP POLICY IF EXISTS "cc_update" ON public.community_comments;
DROP POLICY IF EXISTS "cc_delete" ON public.community_comments;

CREATE OR REPLACE FUNCTION public.community_create_comment_with_notifications(
  p_post_id uuid,
  p_parent_id uuid,
  p_content text,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_post public.community_posts%ROWTYPE;
  v_parent public.community_comments%ROWTYPE;
  v_existing public.community_comments%ROWTYPE;
  v_comment public.community_comments%ROWTYPE;
  v_command public.community_comment_commands%ROWTYPE;
  v_is_suspended boolean := false;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'COMMUNITY_AUTH_REQUIRED';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'COMMUNITY_COMMENT_IDEMPOTENCY_REQUIRED';
  END IF;

  p_content := btrim(COALESCE(p_content, ''));
  IF length(p_content) < 1 OR length(p_content) > 5000 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'COMMUNITY_COMMENT_CONTENT_INVALID';
  END IF;

  SELECT profile.is_suspended
    INTO v_is_suspended
    FROM public.community_profiles AS profile
   WHERE profile.user_id = v_actor_id;

  IF COALESCE(v_is_suspended, false) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'COMMUNITY_SUSPENDED';
  END IF;

  SELECT post.*
    INTO v_post
    FROM public.community_posts AS post
   WHERE post.id = p_post_id
   FOR UPDATE;

  IF NOT FOUND OR NOT (
    (v_post.visibility IN ('public', 'members') AND v_post.under_review IS NOT TRUE)
    OR (
      v_post.author_id = v_actor_id
      AND v_post.visibility = 'draft'
    )
    OR (
      v_post.author_id = v_actor_id
      AND v_post.under_review IS TRUE
    )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'COMMUNITY_POST_NOT_ACCESSIBLE';
  END IF;

  IF p_parent_id IS NOT NULL THEN
    SELECT comment.*
      INTO v_parent
      FROM public.community_comments AS comment
     WHERE comment.id = p_parent_id
     FOR UPDATE;

    IF NOT FOUND OR v_parent.is_deleted THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0002',
        MESSAGE = 'COMMUNITY_PARENT_COMMENT_NOT_FOUND';
    END IF;
    IF v_parent.post_id <> p_post_id THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'COMMUNITY_PARENT_POST_MISMATCH';
    END IF;
    IF v_parent.parent_id IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'COMMUNITY_NESTED_REPLY_NOT_ALLOWED';
    END IF;
  END IF;

  SELECT command.*
    INTO v_command
    FROM public.community_comment_commands AS command
   WHERE command.author_id = v_actor_id
     AND command.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_command.post_id <> p_post_id
       OR v_command.parent_id IS DISTINCT FROM p_parent_id
       OR v_command.content <> p_content THEN
      RAISE EXCEPTION USING
        ERRCODE = '23505',
        MESSAGE = 'COMMUNITY_COMMENT_IDEMPOTENCY_CONFLICT';
    END IF;

    SELECT comment.*
      INTO STRICT v_existing
      FROM public.community_comments AS comment
     WHERE comment.id = v_command.comment_id;

    RETURN jsonb_build_object(
      'comment', to_jsonb(v_existing) - 'client_idempotency_key',
      'replayed', true,
      'post_comment_count', COALESCE(v_post.comment_count, 0)
    );
  END IF;

  BEGIN
    INSERT INTO public.community_comments (
      post_id,
      parent_id,
      author_id,
      content,
      upvote_count,
      is_deleted
    )
    VALUES (
      p_post_id,
      p_parent_id,
      v_actor_id,
      p_content,
      0,
      false
    )
    RETURNING * INTO v_comment;

    INSERT INTO public.community_comment_commands (
      author_id,
      idempotency_key,
      post_id,
      parent_id,
      content,
      comment_id
    )
    VALUES (
      v_actor_id,
      p_idempotency_key,
      p_post_id,
      p_parent_id,
      p_content,
      v_comment.id
    );
  EXCEPTION
    WHEN unique_violation THEN
      SELECT command.*
        INTO v_command
        FROM public.community_comment_commands AS command
       WHERE command.author_id = v_actor_id
         AND command.idempotency_key = p_idempotency_key;

      IF NOT FOUND
         OR v_command.post_id <> p_post_id
         OR v_command.parent_id IS DISTINCT FROM p_parent_id
         OR v_command.content <> p_content THEN
        RAISE EXCEPTION USING
          ERRCODE = '23505',
          MESSAGE = 'COMMUNITY_COMMENT_IDEMPOTENCY_CONFLICT';
      END IF;

      SELECT comment.*
        INTO STRICT v_existing
        FROM public.community_comments AS comment
       WHERE comment.id = v_command.comment_id;

      RETURN jsonb_build_object(
        'comment', to_jsonb(v_existing) - 'client_idempotency_key',
        'replayed', true,
        'post_comment_count', COALESCE(v_post.comment_count, 0)
      );
  END;

  UPDATE public.community_posts
     SET comment_count = COALESCE(comment_count, 0) + 1
   WHERE id = p_post_id
  RETURNING comment_count INTO v_post.comment_count;

  UPDATE public.community_profiles
     SET comment_count = COALESCE(comment_count, 0) + 1,
         updated_at = now()
   WHERE user_id = v_actor_id;

  WITH recipient_candidates AS (
    SELECT
      v_post.author_id AS recipient_id,
      'post_reply'::text AS kind,
      2 AS priority
    UNION ALL
    SELECT
      v_parent.author_id AS recipient_id,
      'comment_reply'::text AS kind,
      1 AS priority
    WHERE p_parent_id IS NOT NULL
  ),
  recipients AS (
    SELECT DISTINCT ON (candidate.recipient_id)
      candidate.recipient_id,
      candidate.kind
    FROM recipient_candidates AS candidate
    WHERE candidate.recipient_id <> v_actor_id
    ORDER BY candidate.recipient_id, candidate.priority
  )
  INSERT INTO public.community_reply_notifications (
    recipient_id,
    actor_id,
    post_id,
    comment_id,
    parent_comment_id,
    kind
  )
  SELECT
    recipient.recipient_id,
    v_actor_id,
    p_post_id,
    v_comment.id,
    p_parent_id,
    recipient.kind
  FROM recipients AS recipient
  ON CONFLICT (recipient_id, comment_id) DO NOTHING;

  RETURN jsonb_build_object(
    'comment', to_jsonb(v_comment) - 'client_idempotency_key',
    'replayed', false,
    'post_comment_count', v_post.comment_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.community_create_comment_with_notifications(
  uuid,
  uuid,
  text,
  uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.community_create_comment_with_notifications(
  uuid,
  uuid,
  text,
  uuid
) TO authenticated;

COMMENT ON TABLE public.community_reply_notifications IS
  'Durable in-app return notifications created atomically with community comments.';
COMMENT ON TABLE public.community_comment_commands IS
  'Private replay ledger for client-generated community comment idempotency keys.';
COMMENT ON FUNCTION public.community_create_comment_with_notifications(
  uuid,
  uuid,
  text,
  uuid
) IS
  'Creates one comment, counters, and post/parent-author notifications in one transaction.';
