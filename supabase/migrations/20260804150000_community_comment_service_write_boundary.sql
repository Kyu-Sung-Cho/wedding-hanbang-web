BEGIN;

-- The legacy RPC trusted auth.uid(), which let an authenticated client bypass
-- the API's public-PII inspection. Close that entry point before exposing the
-- replacement service boundary below.
REVOKE ALL ON FUNCTION public.community_create_comment_with_notifications(
  uuid,
  uuid,
  text,
  uuid
) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.community_create_comment_with_notifications(
  uuid,
  uuid,
  text,
  uuid
) IS
  'Retired client RPC. EXECUTE is revoked because public comment writes must pass API PII inspection before the service-only atomic boundary.';

ALTER TABLE public.community_comment_commands
  ADD COLUMN IF NOT EXISTS response_payload jsonb;
ALTER TABLE public.community_comment_commands
  ADD COLUMN IF NOT EXISTS response_digest text;
ALTER TABLE public.community_comment_commands
  ADD CONSTRAINT community_comment_commands_response_digest
  CHECK (response_digest IS NULL OR response_digest ~ '^[0-9a-f]{64}$');

CREATE OR REPLACE FUNCTION public.community_comment_payload_digest(
  p_payload jsonb
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions, pg_temp
AS $$
  SELECT encode(
    extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256'),
    'hex'
  )
$$;

CREATE OR REPLACE FUNCTION public.community_comment_receipt_is_valid(
  p_actor_id uuid,
  p_post_id uuid,
  p_comment_id uuid,
  p_receipt jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    jsonb_typeof(p_receipt) = 'object'
    AND NOT (p_receipt ? 'replayed')
    AND (
      SELECT count(*) = 2
      FROM jsonb_object_keys(p_receipt)
    )
    AND jsonb_typeof(p_receipt -> 'comment') = 'object'
    AND p_receipt #>> '{comment,id}' = p_comment_id::text
    AND p_receipt #>> '{comment,post_id}' = p_post_id::text
    AND p_receipt #>> '{comment,author_id}' = p_actor_id::text
    AND p_receipt #>> '{comment,author,user_id}' = p_actor_id::text
    AND jsonb_typeof(p_receipt -> 'post_comment_count') = 'number'
    AND (p_receipt ->> 'post_comment_count') ~ '^[0-9]+$'
$$;

CREATE TABLE IF NOT EXISTS public.community_comment_delete_receipts (
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  comment_id uuid NOT NULL,
  response_payload jsonb NOT NULL,
  response_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (actor_id, comment_id),
  CONSTRAINT community_comment_delete_receipts_payload_object
    CHECK (jsonb_typeof(response_payload) = 'object'),
  CONSTRAINT community_comment_delete_receipts_response_digest
    CHECK (response_digest ~ '^[0-9a-f]{64}$')
);

ALTER TABLE public.community_comment_delete_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.community_comment_delete_receipts
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.community_comment_delete_receipt_is_valid(
  p_comment_id uuid,
  p_receipt jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    jsonb_typeof(p_receipt) = 'object'
    AND NOT (p_receipt ? 'replayed')
    AND (
      SELECT count(*) = 2
      FROM jsonb_object_keys(p_receipt)
    )
    AND p_receipt ->> 'comment_id' = p_comment_id::text
    AND jsonb_typeof(p_receipt -> 'post_comment_count') = 'number'
    AND (p_receipt ->> 'post_comment_count') ~ '^[0-9]+$'
$$;

CREATE OR REPLACE FUNCTION public.community_create_comment_with_notifications_service(
  p_actor_id uuid,
  p_post_id uuid,
  p_parent_id uuid,
  p_content text,
  p_profile_nickname text,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id uuid := p_actor_id;
  v_post public.community_posts%ROWTYPE;
  v_parent public.community_comments%ROWTYPE;
  v_existing public.community_comments%ROWTYPE;
  v_comment public.community_comments%ROWTYPE;
  v_command public.community_comment_commands%ROWTYPE;
  v_profile public.community_profiles%ROWTYPE;
  v_locked_actor_id uuid;
  v_runtime_mode text;
  v_profile_update_count integer;
  v_receipt jsonb;
BEGIN
  -- Do not fall back to current_user: SECURITY DEFINER would make an
  -- authenticated caller look like the function owner. Only a service JWT may
  -- carry a user id that the API already verified with auth.getUser().
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'COMMUNITY_SERVICE_ROLE_REQUIRED';
  END IF;

  -- Validate only the authenticated actor and canonical command payload before
  -- looking up a completed receipt. Runtime, suspension and target gates apply
  -- to new mutations, never to an exact retry whose transaction already won.
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'COMMUNITY_COMMENT_ACTOR_NOT_FOUND';
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

  p_profile_nickname := btrim(COALESCE(p_profile_nickname, ''));
  IF p_profile_nickname !~ '^user-[0-9a-f]{8}$' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'COMMUNITY_PROFILE_NICKNAME_INVALID';
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

    IF v_command.response_payload IS NULL
       OR v_command.response_digest IS NULL
       OR NOT public.community_comment_receipt_is_valid(
         v_actor_id,
         v_command.post_id,
         v_command.comment_id,
         v_command.response_payload
       ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'COMMUNITY_COMMENT_RECEIPT_INVALID';
    END IF;
    IF v_command.response_digest
       <> public.community_comment_payload_digest(v_command.response_payload) THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'COMMUNITY_COMMENT_RECEIPT_DIGEST_MISMATCH';
    END IF;
    RETURN v_command.response_payload;
  END IF;

  SELECT control.mode
    INTO v_runtime_mode
    FROM public.community_runtime_control AS control
   WHERE control.control_key = 'global'
   FOR SHARE;

  IF v_runtime_mode IS DISTINCT FROM 'normal' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'community is read-only';
  END IF;

  SELECT actor.id
    INTO v_locked_actor_id
    FROM auth.users AS actor
   WHERE actor.id = v_actor_id
   FOR UPDATE;

  IF v_locked_actor_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'COMMUNITY_COMMENT_ACTOR_NOT_FOUND';
  END IF;

  -- Bootstrap and lock the profile inside the same transaction as the comment.
  -- A deterministic longer suffix is the collision fallback; a second collision
  -- fails the whole command instead of committing counters without a profile.
  BEGIN
    INSERT INTO public.community_profiles (
      user_id,
      nickname,
      badge,
      post_count,
      comment_count,
      total_upvotes_received
    ) VALUES (
      v_actor_id,
      p_profile_nickname,
      'member',
      0,
      0,
      0
    )
    ON CONFLICT (user_id) DO NOTHING;
  EXCEPTION
    WHEN unique_violation THEN
      BEGIN
        INSERT INTO public.community_profiles (
          user_id,
          nickname,
          badge,
          post_count,
          comment_count,
          total_upvotes_received
        ) VALUES (
          v_actor_id,
          'u-' || right(replace(v_actor_id::text, '-', ''), 16),
          'member',
          0,
          0,
          0
        )
        ON CONFLICT (user_id) DO NOTHING;
      EXCEPTION
        WHEN unique_violation THEN
          RAISE EXCEPTION USING
            ERRCODE = '23505',
            MESSAGE = 'COMMUNITY_PROFILE_BOOTSTRAP_CONFLICT';
      END;
  END;

  SELECT profile.*
    INTO v_profile
    FROM public.community_profiles AS profile
   WHERE profile.user_id = v_actor_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'COMMUNITY_PROFILE_BOOTSTRAP_FAILED';
  END IF;

  IF COALESCE(v_profile.is_suspended, false) THEN
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

    IF v_command.response_payload IS NULL
       OR v_command.response_digest IS NULL
       OR NOT public.community_comment_receipt_is_valid(
         v_actor_id,
         v_command.post_id,
         v_command.comment_id,
         v_command.response_payload
       ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'COMMUNITY_COMMENT_RECEIPT_INVALID';
    END IF;
    IF v_command.response_digest
       <> public.community_comment_payload_digest(v_command.response_payload) THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'COMMUNITY_COMMENT_RECEIPT_DIGEST_MISMATCH';
    END IF;
    RETURN v_command.response_payload;
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

      IF v_command.response_payload IS NULL
         OR v_command.response_digest IS NULL
         OR NOT public.community_comment_receipt_is_valid(
           v_actor_id,
           v_command.post_id,
           v_command.comment_id,
           v_command.response_payload
         ) THEN
        RAISE EXCEPTION USING
          ERRCODE = '55000',
          MESSAGE = 'COMMUNITY_COMMENT_RECEIPT_INVALID';
      END IF;
      IF v_command.response_digest
         <> public.community_comment_payload_digest(v_command.response_payload) THEN
        RAISE EXCEPTION USING
          ERRCODE = '55000',
          MESSAGE = 'COMMUNITY_COMMENT_RECEIPT_DIGEST_MISMATCH';
      END IF;
      RETURN v_command.response_payload;
  END;

  UPDATE public.community_posts
     SET comment_count = COALESCE(comment_count, 0) + 1
   WHERE id = p_post_id
  RETURNING comment_count INTO v_post.comment_count;

  UPDATE public.community_profiles
     SET comment_count = COALESCE(comment_count, 0) + 1,
         updated_at = now()
   WHERE user_id = v_actor_id;

  GET DIAGNOSTICS v_profile_update_count = ROW_COUNT;
  IF v_profile_update_count <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'COMMUNITY_PROFILE_COUNTER_UNCONFIRMED';
  END IF;

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

  v_receipt := jsonb_build_object(
    'comment',
      (to_jsonb(v_comment) - 'client_idempotency_key')
      || jsonb_build_object(
        'author', jsonb_build_object(
          'user_id', v_profile.user_id,
          'nickname', v_profile.nickname,
          'avatar_url', to_jsonb(v_profile) -> 'avatar_url',
          'rank', COALESCE(
            to_jsonb(v_profile) -> 'rank',
            to_jsonb(v_profile) -> 'badge'
          ),
          'wedding_year', NULL,
          'wedding_month', NULL
        )
      ),
    'post_comment_count', v_post.comment_count
  );
  UPDATE public.community_comment_commands
     SET response_payload = v_receipt,
         response_digest = public.community_comment_payload_digest(v_receipt)
   WHERE author_id = v_actor_id
     AND idempotency_key = p_idempotency_key;
  RETURN v_receipt;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_replay_comment_command_service(
  p_actor_id uuid,
  p_post_id uuid,
  p_parent_id uuid,
  p_content text,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_command public.community_comment_commands%ROWTYPE;
  v_existing public.community_comments%ROWTYPE;
  v_post_count integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'COMMUNITY_SERVICE_ROLE_REQUIRED';
  END IF;
  IF p_actor_id IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'COMMUNITY_COMMENT_REPLAY_INPUT_INVALID';
  END IF;

  p_content := btrim(COALESCE(p_content, ''));
  IF length(p_content) < 1 OR length(p_content) > 5000 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'COMMUNITY_COMMENT_CONTENT_INVALID';
  END IF;

  SELECT command.*
    INTO v_command
    FROM public.community_comment_commands AS command
   WHERE command.author_id = p_actor_id
     AND command.idempotency_key = p_idempotency_key;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF v_command.post_id <> p_post_id
     OR v_command.parent_id IS DISTINCT FROM p_parent_id
     OR v_command.content <> p_content THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'COMMUNITY_COMMENT_IDEMPOTENCY_CONFLICT';
  END IF;

  IF v_command.response_payload IS NULL
     OR v_command.response_digest IS NULL
     OR NOT public.community_comment_receipt_is_valid(
       p_actor_id,
       v_command.post_id,
       v_command.comment_id,
       v_command.response_payload
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'COMMUNITY_COMMENT_RECEIPT_INVALID';
  END IF;
  IF v_command.response_digest
     <> public.community_comment_payload_digest(v_command.response_payload) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'COMMUNITY_COMMENT_RECEIPT_DIGEST_MISMATCH';
  END IF;
  RETURN v_command.response_payload;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_delete_comment_service(
  p_actor_id uuid,
  p_comment_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_comment public.community_comments%ROWTYPE;
  v_saved_receipt jsonb;
  v_saved_digest text;
  v_receipt jsonb;
  v_post_count integer;
  v_profile_update_count integer;
  v_deleted_at timestamptz := clock_timestamp();
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'COMMUNITY_SERVICE_ROLE_REQUIRED';
  END IF;
  IF p_actor_id IS NULL OR p_comment_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'COMMUNITY_COMMENT_DELETE_INPUT_INVALID';
  END IF;

  PERFORM 1
    FROM auth.users AS actor
   WHERE actor.id = p_actor_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'COMMUNITY_COMMENT_ACTOR_NOT_FOUND';
  END IF;

  SELECT receipt.response_payload, receipt.response_digest
    INTO v_saved_receipt, v_saved_digest
    FROM public.community_comment_delete_receipts AS receipt
   WHERE receipt.actor_id = p_actor_id
     AND receipt.comment_id = p_comment_id;
  IF FOUND THEN
    IF NOT public.community_comment_delete_receipt_is_valid(
      p_comment_id,
      v_saved_receipt
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'COMMUNITY_COMMENT_DELETE_RECEIPT_INVALID';
    END IF;
    IF v_saved_digest
       <> public.community_comment_payload_digest(v_saved_receipt) THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'COMMUNITY_COMMENT_DELETE_RECEIPT_DIGEST_MISMATCH';
    END IF;
    RETURN v_saved_receipt;
  END IF;

  SELECT comment.*
    INTO v_comment
    FROM public.community_comments AS comment
   WHERE comment.id = p_comment_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'COMMUNITY_COMMENT_NOT_FOUND';
  END IF;
  IF v_comment.author_id <> p_actor_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'COMMUNITY_COMMENT_DELETE_FORBIDDEN';
  END IF;

  IF v_comment.author_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'COMMUNITY_COMMENT_DELETE_RECEIPT_MISSING';
  END IF;

  UPDATE public.community_comments
     SET is_deleted = true,
         author_deleted_at = v_deleted_at,
         content = '삭제된 댓글입니다.',
         updated_at = v_deleted_at
   WHERE id = v_comment.id
     AND author_deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '40001',
      MESSAGE = 'COMMUNITY_COMMENT_DELETE_CONFLICT';
  END IF;

  UPDATE public.community_posts
     SET comment_count = GREATEST(0, COALESCE(comment_count, 0) - 1)
   WHERE id = v_comment.post_id
  RETURNING comment_count INTO v_post_count;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'COMMUNITY_POST_COUNTER_UNCONFIRMED';
  END IF;

  UPDATE public.community_profiles
     SET comment_count = GREATEST(0, COALESCE(comment_count, 0) - 1),
         updated_at = v_deleted_at
   WHERE user_id = p_actor_id;
  GET DIAGNOSTICS v_profile_update_count = ROW_COUNT;
  IF v_profile_update_count <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'COMMUNITY_PROFILE_COUNTER_UNCONFIRMED';
  END IF;

  v_receipt := jsonb_build_object(
    'comment_id', v_comment.id,
    'post_comment_count', v_post_count
  );
  INSERT INTO public.community_comment_delete_receipts (
    actor_id,
    comment_id,
    response_payload,
    response_digest
  ) VALUES (
    p_actor_id,
    v_comment.id,
    v_receipt,
    public.community_comment_payload_digest(v_receipt)
  );
  RETURN v_receipt;
END;
$$;

REVOKE ALL ON FUNCTION public.community_create_comment_with_notifications_service(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_create_comment_with_notifications_service(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid
) TO service_role;

REVOKE ALL ON FUNCTION public.community_replay_comment_command_service(
  uuid,
  uuid,
  uuid,
  text,
  uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_replay_comment_command_service(
  uuid,
  uuid,
  uuid,
  text,
  uuid
) TO service_role;

REVOKE ALL ON FUNCTION public.community_delete_comment_service(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_delete_comment_service(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.community_create_comment_with_notifications_service(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid
) IS
  'Service-only atomic comment boundary. The API supplies an actor verified with auth.getUser after public-PII screening; comment, counters, idempotency ledger, and notifications commit together.';

COMMENT ON FUNCTION public.community_replay_comment_command_service(
  uuid,
  uuid,
  uuid,
  text,
  uuid
) IS
  'Read-only exact-receipt lookup before rate, runtime, suspension and target gates. Returns null for a new command and conflicts on key reuse.';

COMMENT ON FUNCTION public.community_delete_comment_service(uuid, uuid) IS
  'Service-only idempotent author-delete intent. Comment state and post/profile counters commit in one transaction and moderation holds stay independent.';

COMMIT;
