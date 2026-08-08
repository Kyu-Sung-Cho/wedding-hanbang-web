BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';

CREATE TABLE IF NOT EXISTS public.community_post_write_commands (
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  payload_digest text NOT NULL,
  payload jsonb NOT NULL,
  post_id uuid NOT NULL,
  response_payload jsonb NOT NULL,
  response_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (actor_id, idempotency_key),
  CONSTRAINT community_post_write_commands_digest
    CHECK (payload_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT community_post_write_commands_payload_object
    CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT community_post_write_commands_receipt_object
    CHECK (jsonb_typeof(response_payload) = 'object'),
  CONSTRAINT community_post_write_commands_response_digest
    CHECK (response_digest ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS public.community_post_delete_receipts (
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  post_id uuid NOT NULL,
  response_payload jsonb NOT NULL,
  response_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (actor_id, post_id),
  CONSTRAINT community_post_delete_receipts_payload_object
    CHECK (jsonb_typeof(response_payload) = 'object'),
  CONSTRAINT community_post_delete_receipts_response_digest
    CHECK (response_digest ~ '^[0-9a-f]{64}$')
);

ALTER TABLE public.community_post_write_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_post_delete_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE
  public.community_post_write_commands,
  public.community_post_delete_receipts
FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.community_post_payload_digest(p_payload jsonb)
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

CREATE OR REPLACE FUNCTION public.community_post_receipt_is_valid(
  p_actor_id uuid,
  p_post_id uuid,
  p_receipt jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    jsonb_typeof(p_receipt) = 'object'
    AND jsonb_typeof(p_receipt -> 'post') = 'object'
    AND p_receipt #>> '{post,id}' = p_post_id::text
    AND p_receipt #>> '{post,author_id}' = p_actor_id::text
    AND p_receipt ? 'poll_id'
    AND (
      p_receipt -> 'poll_id' = 'null'::jsonb
      OR jsonb_typeof(p_receipt -> 'poll_id') = 'string'
    )
    AND jsonb_typeof(p_receipt -> 'post_count') = 'number'
    AND (p_receipt ->> 'post_count') ~ '^[0-9]+$'
    AND NOT (p_receipt ? 'replayed')
$$;

CREATE OR REPLACE FUNCTION public.community_post_delete_receipt_is_valid(
  p_actor_id uuid,
  p_post_id uuid,
  p_receipt jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    jsonb_typeof(p_receipt) = 'object'
    AND p_receipt ->> 'post_id' = p_post_id::text
    AND p_receipt ->> 'actor_id' = p_actor_id::text
    AND p_receipt -> 'deleted' = 'true'::jsonb
    AND jsonb_typeof(p_receipt -> 'post_count') = 'number'
    AND (p_receipt ->> 'post_count') ~ '^[0-9]+$'
    AND NOT (p_receipt ? 'replayed')
$$;

CREATE OR REPLACE FUNCTION public.community_replay_post_command_service(
  p_actor_id uuid,
  p_idempotency_key uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_command public.community_post_write_commands%ROWTYPE;
  v_digest text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'COMMUNITY_SERVICE_ROLE_REQUIRED';
  END IF;
  IF p_actor_id IS NULL
     OR p_idempotency_key IS NULL
     OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'COMMUNITY_POST_COMMAND_INPUT_INVALID';
  END IF;

  v_digest := public.community_post_payload_digest(p_payload);
  SELECT command.*
    INTO v_command
    FROM public.community_post_write_commands AS command
   WHERE command.actor_id = p_actor_id
     AND command.idempotency_key = p_idempotency_key;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF v_command.payload_digest <> v_digest OR v_command.payload <> p_payload THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'COMMUNITY_POST_IDEMPOTENCY_CONFLICT';
  END IF;
  IF NOT public.community_post_receipt_is_valid(
    p_actor_id,
    v_command.post_id,
    v_command.response_payload
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'COMMUNITY_POST_RECEIPT_INVALID';
  END IF;
  IF v_command.response_digest
     <> public.community_post_payload_digest(v_command.response_payload) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'COMMUNITY_POST_RECEIPT_DIGEST_MISMATCH';
  END IF;

  RETURN v_command.response_payload;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_create_post_service(
  p_actor_id uuid,
  p_idempotency_key uuid,
  p_profile_nickname text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_actor_id uuid;
  v_runtime_mode text;
  v_profile public.community_profiles%ROWTYPE;
  v_post public.community_posts%ROWTYPE;
  v_poll_id uuid;
  v_poll jsonb := p_payload -> 'poll';
  v_options jsonb;
  v_option_count integer;
  v_profile_update_count integer;
  v_content_origin public.community_content_origin := 'member';
  v_digest text;
  v_replay jsonb;
  v_receipt jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'COMMUNITY_SERVICE_ROLE_REQUIRED';
  END IF;
  IF p_actor_id IS NULL
     OR p_idempotency_key IS NULL
     OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'COMMUNITY_POST_COMMAND_INPUT_INVALID';
  END IF;
  p_profile_nickname := btrim(COALESCE(p_profile_nickname, ''));
  IF p_profile_nickname !~ '^user-[0-9a-f]{8}$' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'COMMUNITY_PROFILE_NICKNAME_INVALID';
  END IF;

  -- Validate the canonical API payload again at the transactional boundary.
  IF jsonb_typeof(p_payload -> 'category') IS DISTINCT FROM 'string'
     OR length(p_payload ->> 'category') < 1
     OR jsonb_typeof(p_payload -> 'title') IS DISTINCT FROM 'string'
     OR length(p_payload ->> 'title') NOT BETWEEN 1 AND 200
     OR jsonb_typeof(p_payload -> 'content') IS DISTINCT FROM 'string'
     OR length(p_payload ->> 'content') > 50000
     OR jsonb_typeof(p_payload -> 'images') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_payload -> 'images') > 10
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_payload -> 'images') AS item(value)
       WHERE jsonb_typeof(item.value) IS DISTINCT FROM 'string'
     )
     OR (
       p_payload -> 'slides' <> 'null'::jsonb
       AND (
         jsonb_typeof(p_payload -> 'slides') IS DISTINCT FROM 'array'
         OR jsonb_array_length(p_payload -> 'slides') > 10
       )
     )
     OR jsonb_typeof(p_payload -> 'vendor_tags') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_payload -> 'vendor_tags') > 5
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_payload -> 'vendor_tags') AS item(value)
       WHERE jsonb_typeof(item.value) IS DISTINCT FROM 'string'
          OR (item.value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     )
     OR jsonb_typeof(p_payload -> 'tags') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_payload -> 'tags') > 10
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_payload -> 'tags') AS item(value)
       WHERE jsonb_typeof(item.value) IS DISTINCT FROM 'string'
     )
     OR p_payload ->> 'visibility' NOT IN ('public', 'members', 'draft')
     OR p_payload ->> 'ad_disclosure' NOT IN ('general', 'sponsored', 'ad')
     OR jsonb_typeof(p_payload -> 'is_quick_review') IS DISTINCT FROM 'boolean'
     OR (
       p_payload -> 'rating' <> 'null'::jsonb
       AND (
         jsonb_typeof(p_payload -> 'rating') IS DISTINCT FROM 'number'
         OR (p_payload ->> 'rating') !~ '^[1-5]$'
       )
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'COMMUNITY_POST_PAYLOAD_INVALID';
  END IF;
  IF p_payload ->> 'ad_disclosure' = 'sponsored'
     AND length(btrim(COALESCE(p_payload ->> 'sponsorship_detail', ''))) < 5 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'COMMUNITY_POST_SPONSORSHIP_DETAIL_INVALID';
  END IF;

  IF v_poll IS NOT NULL AND v_poll <> 'null'::jsonb THEN
    IF jsonb_typeof(v_poll) IS DISTINCT FROM 'object'
       OR length(v_poll ->> 'question') NOT BETWEEN 1 AND 200
       OR jsonb_typeof(v_poll -> 'options') IS DISTINCT FROM 'array'
       OR jsonb_typeof(v_poll -> 'allow_multiple') IS DISTINCT FROM 'boolean'
       OR jsonb_typeof(v_poll -> 'is_anonymous') IS DISTINCT FROM 'boolean'
       OR jsonb_typeof(v_poll -> 'hide_results_until_voted') IS DISTINCT FROM 'boolean'
       OR (
         v_poll -> 'closes_at' <> 'null'::jsonb
         AND (
           jsonb_typeof(v_poll -> 'closes_at') IS DISTINCT FROM 'string'
           OR (v_poll ->> 'closes_at')::timestamptz <= clock_timestamp()
         )
       ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'COMMUNITY_POST_POLL_INVALID';
    END IF;
    v_options := v_poll -> 'options';
    v_option_count := jsonb_array_length(v_options);
    IF v_option_count NOT BETWEEN 2 AND 10
       OR EXISTS (
         SELECT 1
         FROM jsonb_array_elements(v_options) WITH ORDINALITY AS option(value, ordinality)
         WHERE jsonb_typeof(option.value) IS DISTINCT FROM 'object'
            OR (option.value ->> 'position') !~ '^[0-9]+$'
            OR (option.value ->> 'position')::integer <> option.ordinality - 1
            OR length(option.value ->> 'label') NOT BETWEEN 1 AND 100
            OR NOT (option.value ? 'image_url')
            OR (
              option.value -> 'image_url' <> 'null'::jsonb
              AND jsonb_typeof(option.value -> 'image_url') IS DISTINCT FROM 'string'
            )
       ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'COMMUNITY_POST_POLL_OPTIONS_INVALID';
    END IF;
  END IF;

  v_replay := public.community_replay_post_command_service(
    p_actor_id,
    p_idempotency_key,
    p_payload
  );
  IF v_replay IS NOT NULL THEN
    RETURN v_replay;
  END IF;

  -- The auth row is the actor-ownership and per-actor serialization lock. It
  -- closes profile bootstrap races and same-key concurrent creates.
  SELECT actor.id
    INTO v_actor_id
    FROM auth.users AS actor
   WHERE actor.id = p_actor_id
   FOR UPDATE;
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'COMMUNITY_POST_ACTOR_NOT_FOUND';
  END IF;

  v_replay := public.community_replay_post_command_service(
    p_actor_id,
    p_idempotency_key,
    p_payload
  );
  IF v_replay IS NOT NULL THEN
    RETURN v_replay;
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

  BEGIN
    INSERT INTO public.community_profiles (
      user_id,
      nickname,
      badge,
      post_count,
      comment_count,
      total_upvotes_received
    ) VALUES (
      p_actor_id,
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
          p_actor_id,
          'u-' || right(replace(p_actor_id::text, '-', ''), 16),
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
   WHERE profile.user_id = p_actor_id
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

  SELECT CASE WHEN profile.is_admin THEN 'operator' ELSE 'member' END::public.community_content_origin
    INTO v_content_origin
    FROM public.profiles AS profile
   WHERE profile.id = p_actor_id
   FOR SHARE;
  v_content_origin := COALESCE(v_content_origin, 'member'::public.community_content_origin);

  INSERT INTO public.community_posts (
    author_id,
    content_origin,
    category,
    title,
    content,
    images,
    slides,
    visibility,
    vendor_tags,
    tags,
    cost_data,
    ad_disclosure,
    sponsorship_detail,
    price_data,
    is_quick_review,
    rating,
    upvote_count,
    downvote_count,
    comment_count,
    view_count,
    bookmark_count,
    is_pinned,
    is_weekly_best
  ) VALUES (
    p_actor_id,
    v_content_origin,
    p_payload ->> 'category',
    p_payload ->> 'title',
    p_payload ->> 'content',
    ARRAY(SELECT jsonb_array_elements_text(p_payload -> 'images')),
    CASE WHEN p_payload -> 'slides' = 'null'::jsonb THEN NULL ELSE p_payload -> 'slides' END,
    p_payload ->> 'visibility',
    ARRAY(
      SELECT value::uuid
      FROM jsonb_array_elements_text(p_payload -> 'vendor_tags') AS value
    ),
    ARRAY(SELECT jsonb_array_elements_text(p_payload -> 'tags')),
    CASE WHEN p_payload -> 'cost_data' = 'null'::jsonb THEN NULL ELSE p_payload -> 'cost_data' END,
    p_payload ->> 'ad_disclosure',
    CASE WHEN p_payload -> 'sponsorship_detail' = 'null'::jsonb THEN NULL ELSE p_payload ->> 'sponsorship_detail' END,
    CASE WHEN p_payload -> 'price_data' = 'null'::jsonb THEN NULL ELSE p_payload -> 'price_data' END,
    (p_payload ->> 'is_quick_review')::boolean,
    CASE WHEN p_payload -> 'rating' = 'null'::jsonb THEN NULL ELSE (p_payload ->> 'rating')::smallint END,
    0,
    0,
    0,
    0,
    0,
    false,
    false
  )
  RETURNING * INTO v_post;

  IF v_poll IS NOT NULL AND v_poll <> 'null'::jsonb THEN
    INSERT INTO public.community_polls (
      post_id,
      question,
      allow_multiple,
      is_anonymous,
      hide_results_until_voted,
      closes_at
    ) VALUES (
      v_post.id,
      v_poll ->> 'question',
      (v_poll ->> 'allow_multiple')::boolean,
      (v_poll ->> 'is_anonymous')::boolean,
      (v_poll ->> 'hide_results_until_voted')::boolean,
      CASE WHEN v_poll -> 'closes_at' = 'null'::jsonb THEN NULL ELSE (v_poll ->> 'closes_at')::timestamptz END
    )
    RETURNING id INTO v_poll_id;

    INSERT INTO public.community_poll_options (
      poll_id,
      position,
      label,
      image_url
    )
    SELECT
      v_poll_id,
      (option.value ->> 'position')::integer,
      option.value ->> 'label',
      CASE WHEN option.value -> 'image_url' = 'null'::jsonb THEN NULL ELSE option.value ->> 'image_url' END
    FROM jsonb_array_elements(v_options) AS option(value)
    ORDER BY (option.value ->> 'position')::integer;
  END IF;

  UPDATE public.community_profiles
     SET post_count = COALESCE(post_count, 0) + 1,
         updated_at = clock_timestamp()
   WHERE user_id = p_actor_id
  RETURNING post_count INTO v_profile.post_count;
  GET DIAGNOSTICS v_profile_update_count = ROW_COUNT;
  IF v_profile_update_count <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'COMMUNITY_PROFILE_COUNTER_UNCONFIRMED';
  END IF;

  v_digest := public.community_post_payload_digest(p_payload);
  v_receipt := jsonb_build_object(
    'post', to_jsonb(v_post),
    'poll_id', v_poll_id,
    'post_count', v_profile.post_count
  );
  IF NOT public.community_post_receipt_is_valid(p_actor_id, v_post.id, v_receipt) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'COMMUNITY_POST_RECEIPT_BUILD_FAILED';
  END IF;

  INSERT INTO public.community_post_write_commands (
    actor_id,
    idempotency_key,
    payload_digest,
    payload,
    post_id,
    response_payload,
    response_digest
  ) VALUES (
    p_actor_id,
    p_idempotency_key,
    v_digest,
    p_payload,
    v_post.id,
    v_receipt,
    public.community_post_payload_digest(v_receipt)
  );

  RETURN v_receipt;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_delete_post_service(
  p_actor_id uuid,
  p_post_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id uuid;
  v_post public.community_posts%ROWTYPE;
  v_profile public.community_profiles%ROWTYPE;
  v_saved_receipt jsonb;
  v_saved_digest text;
  v_receipt jsonb;
  v_post_count integer;
  v_profile_update_count integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'COMMUNITY_SERVICE_ROLE_REQUIRED';
  END IF;
  IF p_actor_id IS NULL OR p_post_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'COMMUNITY_POST_DELETE_INPUT_INVALID';
  END IF;

  SELECT actor.id
    INTO v_actor_id
    FROM auth.users AS actor
   WHERE actor.id = p_actor_id
   FOR UPDATE;
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'COMMUNITY_POST_ACTOR_NOT_FOUND';
  END IF;

  SELECT receipt.response_payload, receipt.response_digest
    INTO v_saved_receipt, v_saved_digest
    FROM public.community_post_delete_receipts AS receipt
   WHERE receipt.actor_id = p_actor_id
     AND receipt.post_id = p_post_id;
  IF FOUND THEN
    IF NOT public.community_post_delete_receipt_is_valid(
      p_actor_id,
      p_post_id,
      v_saved_receipt
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'COMMUNITY_POST_DELETE_RECEIPT_INVALID';
    END IF;
    IF v_saved_digest <> public.community_post_payload_digest(v_saved_receipt) THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'COMMUNITY_POST_DELETE_RECEIPT_DIGEST_MISMATCH';
    END IF;
    RETURN v_saved_receipt;
  END IF;

  SELECT post.*
    INTO v_post
    FROM public.community_posts AS post
   WHERE post.id = p_post_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'COMMUNITY_POST_NOT_FOUND';
  END IF;
  IF v_post.author_id <> p_actor_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'COMMUNITY_POST_DELETE_FORBIDDEN';
  END IF;

  -- Legacy posts may predate a community profile. Bootstrap under the actor
  -- lock, then recompute the exact remaining count instead of decrementing a
  -- possibly stale counter.
  BEGIN
    INSERT INTO public.community_profiles (
      user_id, nickname, badge, post_count, comment_count, total_upvotes_received
    ) VALUES (
      p_actor_id,
      'user-' || left(replace(p_actor_id::text, '-', ''), 8),
      'member',
      0,
      0,
      0
    )
    ON CONFLICT (user_id) DO NOTHING;
  EXCEPTION
    WHEN unique_violation THEN
      INSERT INTO public.community_profiles (
        user_id, nickname, badge, post_count, comment_count, total_upvotes_received
      ) VALUES (
        p_actor_id,
        'u-' || right(replace(p_actor_id::text, '-', ''), 16),
        'member',
        0,
        0,
        0
      )
      ON CONFLICT (user_id) DO NOTHING;
  END;
  SELECT profile.*
    INTO v_profile
    FROM public.community_profiles AS profile
   WHERE profile.user_id = p_actor_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'COMMUNITY_PROFILE_BOOTSTRAP_FAILED';
  END IF;

  -- Author withdrawal is a safety/control exit even while ordinary writes are
  -- frozen. The runtime trigger accepts this capability only for service JWTs.
  PERFORM set_config('app.community_safety_bypass', 'on', true);
  DELETE FROM public.community_posts
   WHERE id = p_post_id
     AND author_id = p_actor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '40001',
      MESSAGE = 'COMMUNITY_POST_DELETE_CONFLICT';
  END IF;

  SELECT count(*)::integer
    INTO v_post_count
    FROM public.community_posts AS post
   WHERE post.author_id = p_actor_id;
  UPDATE public.community_profiles
     SET post_count = v_post_count,
         updated_at = clock_timestamp()
   WHERE user_id = p_actor_id;
  GET DIAGNOSTICS v_profile_update_count = ROW_COUNT;
  IF v_profile_update_count <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'COMMUNITY_PROFILE_COUNTER_UNCONFIRMED';
  END IF;

  v_receipt := jsonb_build_object(
    'post_id', p_post_id,
    'actor_id', p_actor_id,
    'deleted', true,
    'post_count', v_post_count
  );
  IF NOT public.community_post_delete_receipt_is_valid(
    p_actor_id,
    p_post_id,
    v_receipt
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'COMMUNITY_POST_DELETE_RECEIPT_BUILD_FAILED';
  END IF;
  INSERT INTO public.community_post_delete_receipts (
    actor_id,
    post_id,
    response_payload,
    response_digest
  ) VALUES (
    p_actor_id,
    p_post_id,
    v_receipt,
    public.community_post_payload_digest(v_receipt)
  );
  RETURN v_receipt;
END;
$$;

REVOKE ALL ON FUNCTION public.community_post_payload_digest(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_post_receipt_is_valid(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_post_delete_receipt_is_valid(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_replay_post_command_service(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_create_post_service(uuid, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_delete_post_service(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.community_replay_post_command_service(uuid, uuid, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.community_create_post_service(uuid, uuid, text, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.community_delete_post_service(uuid, uuid)
  TO service_role;

COMMENT ON TABLE public.community_post_write_commands IS
  'Closed exact-payload command ledger for API-validated post creation receipts.';
COMMENT ON TABLE public.community_post_delete_receipts IS
  'Closed author-withdrawal receipts; retained independently of the deleted post for stable retry.';
COMMENT ON FUNCTION public.community_create_post_service(uuid, uuid, text, jsonb) IS
  'Service-only atomic boundary: verified actor, post, optional poll/options, profile counter and exact receipt commit together.';
COMMENT ON FUNCTION public.community_replay_post_command_service(uuid, uuid, jsonb) IS
  'Service-only exact receipt lookup before mutable runtime, suspension and rate gates.';
COMMENT ON FUNCTION public.community_delete_post_service(uuid, uuid) IS
  'Service-only idempotent author withdrawal; ownership, deletion and exact profile count commit together.';

COMMIT;
