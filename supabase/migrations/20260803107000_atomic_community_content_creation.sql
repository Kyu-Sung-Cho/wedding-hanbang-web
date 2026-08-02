-- Move community comment creation and post+poll creation behind service-only
-- transactional RPCs. Every target and payload invariant is checked again
-- inside the same transaction that creates the rows.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $atomic_community_create_preflight$
DECLARE
  missing_prerequisite text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated'
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role'
     ) THEN
    RAISE EXCEPTION 'ATOMIC_COMMUNITY_CREATE_REQUIRED_ROLE_MISSING'
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.string_agg(
    pg_catalog.format('%I.%I', prerequisite.table_name, prerequisite.column_name),
    ', ' ORDER BY prerequisite.table_name, prerequisite.column_name
  )
  INTO missing_prerequisite
  FROM (VALUES
    ('community_profiles', 'user_id'),
    ('community_profiles', 'nickname'),
    ('community_profiles', 'is_suspended'),
    ('community_profiles', 'badge'),
    ('community_profiles', 'post_count'),
    ('community_profiles', 'comment_count'),
    ('community_profiles', 'total_upvotes_received'),
    ('community_posts', 'id'),
    ('community_posts', 'author_id'),
    ('community_posts', 'category'),
    ('community_posts', 'title'),
    ('community_posts', 'content'),
    ('community_posts', 'images'),
    ('community_posts', 'visibility'),
    ('community_posts', 'under_review'),
    ('community_posts', 'slides'),
    ('community_posts', 'vendor_tags'),
    ('community_posts', 'tags'),
    ('community_posts', 'cost_data'),
    ('community_posts', 'ad_disclosure'),
    ('community_posts', 'sponsorship_detail'),
    ('community_posts', 'price_data'),
    ('community_posts', 'is_quick_review'),
    ('community_posts', 'rating'),
    ('community_posts', 'upvote_count'),
    ('community_posts', 'downvote_count'),
    ('community_posts', 'comment_count'),
    ('community_posts', 'view_count'),
    ('community_posts', 'bookmark_count'),
    ('community_posts', 'is_pinned'),
    ('community_posts', 'is_weekly_best'),
    ('community_comments', 'id'),
    ('community_comments', 'post_id'),
    ('community_comments', 'parent_id'),
    ('community_comments', 'author_id'),
    ('community_comments', 'content'),
    ('community_comments', 'upvote_count'),
    ('community_comments', 'is_deleted'),
    ('community_polls', 'id'),
    ('community_polls', 'post_id'),
    ('community_polls', 'question'),
    ('community_polls', 'allow_multiple'),
    ('community_polls', 'is_anonymous'),
    ('community_polls', 'hide_results_until_voted'),
    ('community_polls', 'closes_at'),
    ('community_poll_options', 'poll_id'),
    ('community_poll_options', 'position'),
    ('community_poll_options', 'label'),
    ('community_poll_options', 'image_url')
  ) AS prerequisite(table_name, column_name)
  LEFT JOIN information_schema.columns AS existing
    ON existing.table_schema = 'public'
   AND existing.table_name = prerequisite.table_name
   AND existing.column_name = prerequisite.column_name
  WHERE existing.column_name IS NULL;

  IF missing_prerequisite IS NOT NULL THEN
    RAISE EXCEPTION 'ATOMIC_COMMUNITY_CREATE_PREREQUISITE_MISSING: %',
      missing_prerequisite
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns AS existing
    WHERE existing.table_schema = 'auth'
      AND existing.table_name = 'users'
      AND existing.column_name = 'id'
  ) THEN
    RAISE EXCEPTION 'ATOMIC_COMMUNITY_CREATE_AUTH_USER_PREREQUISITE_MISSING'
      USING ERRCODE = '55000';
  END IF;

  IF pg_catalog.to_regprocedure('auth.role()') IS NULL THEN
    RAISE EXCEPTION 'ATOMIC_COMMUNITY_CREATE_AUTH_ROLE_MISSING'
      USING ERRCODE = '55000';
  END IF;
END;
$atomic_community_create_preflight$;

CREATE OR REPLACE FUNCTION public.community_create_comment_atomic(
  p_actor_id uuid,
  p_post_id uuid,
  p_parent_id uuid,
  p_content text,
  p_default_nickname text
)
RETURNS public.community_comments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $community_create_comment_atomic$
DECLARE
  expected_nickname text;
  actor_is_suspended boolean;
  target_author_id uuid;
  target_visibility text;
  target_under_review boolean;
  parent_post_id uuid;
  parent_parent_id uuid;
  parent_is_deleted boolean;
  created_comment public.community_comments%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'community_create_service_role_required'
      USING ERRCODE = '42501';
  END IF;

  IF p_actor_id IS NULL OR p_post_id IS NULL THEN
    RAISE EXCEPTION 'community_create_identifier_required'
      USING ERRCODE = '22023';
  END IF;

  expected_nickname := 'user-' || pg_catalog.substr(
    pg_catalog.replace(p_actor_id::text, '-', ''), 1, 8
  );
  IF p_default_nickname IS DISTINCT FROM expected_nickname THEN
    RAISE EXCEPTION 'community_create_default_nickname_invalid'
      USING ERRCODE = '22023';
  END IF;

  IF p_content IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_content)) < 1
     OR pg_catalog.char_length(p_content) > 5000 THEN
    RAISE EXCEPTION 'community_comment_content_invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM auth.users AS actor
  WHERE actor.id = p_actor_id
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'community_create_actor_not_found'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    post.author_id,
    post.visibility,
    COALESCE(post.under_review, false)
  INTO
    target_author_id,
    target_visibility,
    target_under_review
  FROM public.community_posts AS post
  WHERE post.id = p_post_id
  -- Freeze visibility, moderation, ownership, and deletion until the comment
  -- insert completes. FOR KEY SHARE would still allow non-key updates.
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'community_comment_target_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF (target_under_review AND target_author_id <> p_actor_id)
     OR (
       NOT target_under_review
       AND target_visibility = 'draft'
       AND target_author_id <> p_actor_id
     )
     OR target_visibility NOT IN ('public', 'members', 'draft') THEN
    RAISE EXCEPTION 'community_comment_target_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_parent_id IS NOT NULL THEN
    SELECT
      comment.post_id,
      comment.parent_id,
      COALESCE(comment.is_deleted, false)
    INTO
      parent_post_id,
      parent_parent_id,
      parent_is_deleted
    FROM public.community_comments AS comment
    WHERE comment.id = p_parent_id
    -- Freeze soft deletion, re-parenting, and deletion through the insert.
    FOR UPDATE;

    IF NOT FOUND OR parent_is_deleted THEN
      RAISE EXCEPTION 'community_comment_parent_not_found'
        USING ERRCODE = 'P0002';
    END IF;
    IF parent_post_id IS DISTINCT FROM p_post_id THEN
      RAISE EXCEPTION 'community_comment_parent_post_mismatch'
        USING ERRCODE = '22023';
    END IF;
    IF parent_parent_id IS NOT NULL THEN
      RAISE EXCEPTION 'community_comment_depth_exceeded'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.community_profiles (
    user_id,
    nickname,
    badge,
    post_count,
    comment_count,
    total_upvotes_received
  ) VALUES (
    p_actor_id,
    p_default_nickname,
    'member',
    0,
    0,
    0
  )
  ON CONFLICT DO NOTHING;

  SELECT COALESCE(profile.is_suspended, true)
  INTO actor_is_suspended
  FROM public.community_profiles AS profile
  WHERE profile.user_id = p_actor_id
  -- Freeze suspension and deletion until the content insert completes.
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'community_profile_initialization_failed'
      USING ERRCODE = '23505';
  END IF;
  IF actor_is_suspended THEN
    RAISE EXCEPTION 'community_create_actor_suspended'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.community_comments (
    post_id,
    parent_id,
    author_id,
    content,
    upvote_count,
    is_deleted
  ) VALUES (
    p_post_id,
    p_parent_id,
    p_actor_id,
    p_content,
    0,
    false
  )
  RETURNING * INTO created_comment;

  RETURN created_comment;
END;
$community_create_comment_atomic$;

CREATE OR REPLACE FUNCTION public.community_create_post_with_poll_atomic(
  p_actor_id uuid,
  p_default_nickname text,
  p_category text,
  p_title text,
  p_content text,
  p_images text[],
  p_slides jsonb,
  p_visibility text,
  p_vendor_tags uuid[],
  p_tags text[],
  p_cost_data jsonb,
  p_ad_disclosure text,
  p_sponsorship_detail text,
  p_price_data jsonb,
  p_is_quick_review boolean,
  p_rating smallint,
  p_poll jsonb
)
RETURNS public.community_posts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $community_create_post_with_poll_atomic$
DECLARE
  expected_nickname text;
  actor_is_suspended boolean;
  created_post public.community_posts%ROWTYPE;
  created_poll_id uuid;
  closes_at_value timestamptz;
  poll_option_count integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'community_create_service_role_required'
      USING ERRCODE = '42501';
  END IF;

  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'community_create_identifier_required'
      USING ERRCODE = '22023';
  END IF;

  expected_nickname := 'user-' || pg_catalog.substr(
    pg_catalog.replace(p_actor_id::text, '-', ''), 1, 8
  );
  IF p_default_nickname IS DISTINCT FROM expected_nickname THEN
    RAISE EXCEPTION 'community_create_default_nickname_invalid'
      USING ERRCODE = '22023';
  END IF;

  IF p_category IS NULL
     OR p_category NOT IN ('is_normal', 'tour_review', 'tips_v2', 'ama', 'free')
     OR p_visibility IS NULL
     OR p_visibility NOT IN ('public', 'members', 'draft') THEN
    RAISE EXCEPTION 'community_post_classification_invalid'
      USING ERRCODE = '22023';
  END IF;

  IF p_title IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_title)) < 1
     OR pg_catalog.char_length(p_title) > 200
     OR p_content IS NULL
     OR pg_catalog.char_length(p_content) > 50000 THEN
    RAISE EXCEPTION 'community_post_text_invalid'
      USING ERRCODE = '22023';
  END IF;

  IF p_images IS NULL
     OR pg_catalog.cardinality(p_images) > 10
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.unnest(p_images) AS image(url)
       WHERE image.url IS NULL
          OR pg_catalog.char_length(image.url) > 2048
          OR image.url !~ '^https://'
     ) THEN
    RAISE EXCEPTION 'community_post_images_invalid'
      USING ERRCODE = '22023';
  END IF;

  IF p_slides IS NOT NULL THEN
    IF pg_catalog.jsonb_typeof(p_slides) <> 'array'
       OR pg_catalog.jsonb_array_length(p_slides) > 10 THEN
      RAISE EXCEPTION 'community_post_slides_invalid'
        USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_slides) AS slide(value)
      WHERE pg_catalog.jsonb_typeof(slide.value) <> 'object'
         OR NOT (slide.value ? 'type')
         OR NOT (slide.value ? 'url')
         OR EXISTS (
           SELECT 1
           FROM pg_catalog.jsonb_object_keys(slide.value) AS key(name)
           WHERE key.name <> ALL (
             ARRAY['type', 'url', 'width', 'height', 'thumbnail_url']::text[]
           )
         )
         OR slide.value->>'type' <> 'image'
         OR pg_catalog.jsonb_typeof(slide.value->'url') <> 'string'
         OR pg_catalog.char_length(slide.value->>'url') > 2048
         OR slide.value->>'url' !~ '^https://'
         OR (
           slide.value ? 'thumbnail_url'
           AND pg_catalog.jsonb_typeof(slide.value->'thumbnail_url')
             NOT IN ('string', 'null')
         )
         OR (
           pg_catalog.jsonb_typeof(slide.value->'thumbnail_url') = 'string'
           AND (
             pg_catalog.char_length(slide.value->>'thumbnail_url') > 2048
             OR slide.value->>'thumbnail_url' !~ '^https://'
           )
         )
         OR (
           slide.value ? 'width'
           AND pg_catalog.jsonb_typeof(slide.value->'width') NOT IN ('number', 'null')
         )
         OR (
           slide.value ? 'height'
           AND pg_catalog.jsonb_typeof(slide.value->'height') NOT IN ('number', 'null')
         )
         OR (
           pg_catalog.jsonb_typeof(slide.value->'width') = 'number'
           AND slide.value->>'width' !~ '^[0-9]+$'
         )
         OR (
           pg_catalog.jsonb_typeof(slide.value->'height') = 'number'
           AND slide.value->>'height' !~ '^[0-9]+$'
         )
    ) THEN
      RAISE EXCEPTION 'community_post_slides_invalid'
        USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_slides) AS slide(value)
      WHERE (
        pg_catalog.jsonb_typeof(slide.value->'width') = 'number'
        AND (slide.value->>'width')::numeric NOT BETWEEN 1 AND 8192
      ) OR (
        pg_catalog.jsonb_typeof(slide.value->'height') = 'number'
        AND (slide.value->>'height')::numeric NOT BETWEEN 1 AND 8192
      )
    ) THEN
      RAISE EXCEPTION 'community_post_slide_dimensions_invalid'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF pg_catalog.char_length(pg_catalog.btrim(p_content)) = 0
     AND (p_slides IS NULL OR pg_catalog.jsonb_array_length(p_slides) = 0) THEN
    RAISE EXCEPTION 'community_post_body_required'
      USING ERRCODE = '22023';
  END IF;

  IF p_vendor_tags IS NULL
     OR pg_catalog.cardinality(p_vendor_tags) > 5
     OR p_tags IS NULL
     OR pg_catalog.cardinality(p_tags) > 10
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.unnest(p_tags) AS tag(value)
       WHERE tag.value IS NULL
          OR pg_catalog.char_length(pg_catalog.btrim(tag.value)) < 1
          OR pg_catalog.char_length(tag.value) > 30
     ) THEN
    RAISE EXCEPTION 'community_post_tags_invalid'
      USING ERRCODE = '22023';
  END IF;

  IF p_cost_data IS NOT NULL
     AND (
       pg_catalog.jsonb_typeof(p_cost_data) <> 'object'
       OR pg_catalog.octet_length(p_cost_data::text) > 131072
     ) THEN
    RAISE EXCEPTION 'community_post_cost_data_invalid'
      USING ERRCODE = '22023';
  END IF;

  IF p_ad_disclosure IS NULL
     OR p_ad_disclosure NOT IN ('general', 'sponsored', 'ad')
     OR (
       p_ad_disclosure = 'sponsored'
       AND (
         p_sponsorship_detail IS NULL
         OR pg_catalog.char_length(pg_catalog.btrim(p_sponsorship_detail)) < 5
         OR pg_catalog.char_length(p_sponsorship_detail) > 500
       )
     )
     OR (
       p_ad_disclosure <> 'sponsored'
       AND p_sponsorship_detail IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'community_post_disclosure_invalid'
      USING ERRCODE = '22023';
  END IF;

  IF p_price_data IS NOT NULL THEN
    IF pg_catalog.jsonb_typeof(p_price_data) <> 'object'
       OR NOT (p_price_data ? 'vendor_category')
       OR NOT (p_price_data ? 'base_price')
       OR EXISTS (
         SELECT 1
         FROM pg_catalog.jsonb_object_keys(p_price_data) AS key(name)
         WHERE key.name <> ALL (
           ARRAY[
             'vendor_category', 'base_price', 'extra_price', 'vendor_name',
             'region', 'details'
           ]::text[]
         )
       )
       OR pg_catalog.jsonb_typeof(p_price_data->'vendor_category') <> 'string'
       OR p_price_data->>'vendor_category' NOT IN (
         'venue', 'studio', 'dress', 'makeup', 'snap', 'ring', 'honeymoon', 'other'
       )
       OR pg_catalog.jsonb_typeof(p_price_data->'base_price') <> 'number'
       OR p_price_data->>'base_price' !~ '^[0-9]+$'
       OR (
         p_price_data ? 'extra_price'
         AND pg_catalog.jsonb_typeof(p_price_data->'extra_price')
           NOT IN ('number', 'null')
       )
       OR (
         pg_catalog.jsonb_typeof(p_price_data->'extra_price') = 'number'
         AND p_price_data->>'extra_price' !~ '^[0-9]+$'
       )
       OR EXISTS (
         SELECT 1
         FROM (VALUES
           ('vendor_name', 100),
           ('region', 100),
           ('details', 1000)
         ) AS text_field(field_name, max_length)
         WHERE p_price_data ? text_field.field_name
           AND (
             pg_catalog.jsonb_typeof(
               p_price_data->text_field.field_name
             ) NOT IN ('string', 'null')
             OR pg_catalog.char_length(
               p_price_data->>text_field.field_name
             ) > text_field.max_length
           )
       ) THEN
      RAISE EXCEPTION 'community_post_price_data_invalid'
        USING ERRCODE = '22023';
    END IF;

    IF (p_price_data->>'base_price')::numeric NOT BETWEEN 1 AND 1000000000
       OR (
         pg_catalog.jsonb_typeof(p_price_data->'extra_price') = 'number'
         AND (p_price_data->>'extra_price')::numeric NOT BETWEEN 0 AND 1000000000
       ) THEN
      RAISE EXCEPTION 'community_post_price_amount_invalid'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_is_quick_review IS NULL
     OR (p_rating IS NOT NULL AND p_rating NOT BETWEEN 1 AND 5) THEN
    RAISE EXCEPTION 'community_post_review_metadata_invalid'
      USING ERRCODE = '22023';
  END IF;

  IF p_poll IS NOT NULL THEN
    IF pg_catalog.jsonb_typeof(p_poll) <> 'object'
       OR NOT (p_poll ? 'question')
       OR NOT (p_poll ? 'options')
       OR NOT (p_poll ? 'allow_multiple')
       OR NOT (p_poll ? 'is_anonymous')
       OR NOT (p_poll ? 'hide_results_until_voted')
       OR NOT (p_poll ? 'closes_at')
       OR EXISTS (
         SELECT 1
         FROM pg_catalog.jsonb_object_keys(p_poll) AS key(name)
         WHERE key.name <> ALL (
           ARRAY[
             'question', 'options', 'allow_multiple', 'is_anonymous',
             'hide_results_until_voted', 'closes_at'
           ]::text[]
         )
       )
       OR pg_catalog.jsonb_typeof(p_poll->'question') <> 'string'
       OR pg_catalog.char_length(pg_catalog.btrim(p_poll->>'question')) < 1
       OR pg_catalog.char_length(p_poll->>'question') > 200
       OR pg_catalog.jsonb_typeof(p_poll->'options') <> 'array'
       OR pg_catalog.jsonb_array_length(p_poll->'options') NOT BETWEEN 2 AND 10
       OR pg_catalog.jsonb_typeof(p_poll->'allow_multiple') <> 'boolean'
       OR pg_catalog.jsonb_typeof(p_poll->'is_anonymous') <> 'boolean'
       OR pg_catalog.jsonb_typeof(p_poll->'hide_results_until_voted') <> 'boolean'
       OR pg_catalog.jsonb_typeof(p_poll->'closes_at') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'community_poll_payload_invalid'
        USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_poll->'options') AS option(value)
      WHERE pg_catalog.jsonb_typeof(option.value) <> 'object'
         OR NOT (option.value ? 'position')
         OR NOT (option.value ? 'label')
         OR NOT (option.value ? 'image_url')
         OR EXISTS (
           SELECT 1
           FROM pg_catalog.jsonb_object_keys(option.value) AS key(name)
           WHERE key.name <> ALL (
             ARRAY['position', 'label', 'image_url']::text[]
           )
         )
         OR pg_catalog.jsonb_typeof(option.value->'position') <> 'number'
         OR option.value->>'position' !~ '^[0-9]+$'
         OR pg_catalog.jsonb_typeof(option.value->'label') <> 'string'
         OR pg_catalog.char_length(pg_catalog.btrim(option.value->>'label')) < 1
         OR pg_catalog.char_length(option.value->>'label') > 100
         OR pg_catalog.jsonb_typeof(option.value->'image_url')
           NOT IN ('string', 'null')
         OR (
           pg_catalog.jsonb_typeof(option.value->'image_url') = 'string'
           AND (
             pg_catalog.char_length(option.value->>'image_url') > 2048
             OR option.value->>'image_url' !~ '^https://'
           )
         )
    ) THEN
      RAISE EXCEPTION 'community_poll_options_invalid'
        USING ERRCODE = '22023';
    END IF;

    SELECT pg_catalog.count(*)::integer
    INTO poll_option_count
    FROM (
      SELECT DISTINCT (option.value->>'position')::numeric AS position
      FROM pg_catalog.jsonb_array_elements(p_poll->'options') AS option(value)
      WHERE (option.value->>'position')::numeric BETWEEN 0 AND 9
    ) AS positions;

    IF poll_option_count <> pg_catalog.jsonb_array_length(p_poll->'options')
       OR NOT EXISTS (
         SELECT 1
         FROM (
          SELECT
            pg_catalog.min((option.value->>'position')::numeric) AS minimum,
            pg_catalog.max((option.value->>'position')::numeric) AS maximum
          FROM pg_catalog.jsonb_array_elements(p_poll->'options') AS option(value)
         ) AS bounds
         WHERE bounds.minimum = 0
           AND bounds.maximum = pg_catalog.jsonb_array_length(p_poll->'options') - 1
       ) THEN
      RAISE EXCEPTION 'community_poll_option_positions_invalid'
        USING ERRCODE = '22023';
    END IF;

    IF pg_catalog.jsonb_typeof(p_poll->'closes_at') = 'string' THEN
      closes_at_value := (p_poll->>'closes_at')::timestamptz;
      IF NOT pg_catalog.isfinite(closes_at_value)
         OR closes_at_value <= pg_catalog.now() THEN
        RAISE EXCEPTION 'community_poll_close_time_invalid'
          USING ERRCODE = '22023';
      END IF;
    ELSE
      closes_at_value := NULL;
    END IF;
  END IF;

  PERFORM 1
  FROM auth.users AS actor
  WHERE actor.id = p_actor_id
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'community_create_actor_not_found'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.community_profiles (
    user_id,
    nickname,
    badge,
    post_count,
    comment_count,
    total_upvotes_received
  ) VALUES (
    p_actor_id,
    p_default_nickname,
    'member',
    0,
    0,
    0
  )
  ON CONFLICT DO NOTHING;

  SELECT COALESCE(profile.is_suspended, true)
  INTO actor_is_suspended
  FROM public.community_profiles AS profile
  WHERE profile.user_id = p_actor_id
  -- Freeze suspension and deletion until the post/poll insert completes.
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'community_profile_initialization_failed'
      USING ERRCODE = '23505';
  END IF;
  IF actor_is_suspended THEN
    RAISE EXCEPTION 'community_create_actor_suspended'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.community_posts (
    author_id,
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
    p_category,
    p_title,
    p_content,
    p_images,
    p_slides,
    p_visibility,
    p_vendor_tags,
    p_tags,
    p_cost_data,
    p_ad_disclosure,
    p_sponsorship_detail,
    p_price_data,
    p_is_quick_review,
    p_rating,
    0,
    0,
    0,
    0,
    0,
    false,
    false
  )
  RETURNING * INTO created_post;

  IF p_poll IS NOT NULL THEN
    INSERT INTO public.community_polls (
      post_id,
      question,
      allow_multiple,
      is_anonymous,
      hide_results_until_voted,
      closes_at
    ) VALUES (
      created_post.id,
      p_poll->>'question',
      (p_poll->>'allow_multiple')::boolean,
      (p_poll->>'is_anonymous')::boolean,
      (p_poll->>'hide_results_until_voted')::boolean,
      closes_at_value
    )
    RETURNING id INTO created_poll_id;

    INSERT INTO public.community_poll_options (
      poll_id,
      position,
      label,
      image_url
    )
    SELECT
      created_poll_id,
      (option.value->>'position')::integer,
      option.value->>'label',
      CASE
        WHEN pg_catalog.jsonb_typeof(option.value->'image_url') = 'string'
          THEN option.value->>'image_url'
        ELSE NULL
      END
    FROM pg_catalog.jsonb_array_elements(p_poll->'options') AS option(value);
  END IF;

  RETURN created_post;
END;
$community_create_post_with_poll_atomic$;

ALTER FUNCTION public.community_create_comment_atomic(
  uuid, uuid, uuid, text, text
) OWNER TO postgres;
ALTER FUNCTION public.community_create_post_with_poll_atomic(
  uuid, text, text, text, text, text[], jsonb, text, uuid[], text[], jsonb,
  text, text, jsonb, boolean, smallint, jsonb
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.community_create_comment_atomic(
  uuid, uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_create_post_with_poll_atomic(
  uuid, text, text, text, text, text[], jsonb, text, uuid[], text[], jsonb,
  text, text, jsonb, boolean, smallint, jsonb
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.community_create_comment_atomic(
  uuid, uuid, uuid, text, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.community_create_post_with_poll_atomic(
  uuid, text, text, text, text, text[], jsonb, text, uuid[], text[], jsonb,
  text, text, jsonb, boolean, smallint, jsonb
) TO service_role;

DO $atomic_community_create_postcondition$
DECLARE
  function_signature text;
  function_record pg_catalog.pg_proc%ROWTYPE;
BEGIN
  FOREACH function_signature IN ARRAY ARRAY[
    'public.community_create_comment_atomic(uuid,uuid,uuid,text,text)',
    'public.community_create_post_with_poll_atomic(uuid,text,text,text,text,text[],jsonb,text,uuid[],text[],jsonb,text,text,jsonb,boolean,smallint,jsonb)'
  ]::text[]
  LOOP
    SELECT * INTO function_record
    FROM pg_catalog.pg_proc AS proc
    WHERE proc.oid = pg_catalog.to_regprocedure(function_signature);

    IF NOT FOUND
       OR pg_catalog.pg_get_userbyid(function_record.proowner) <> 'postgres'
       OR function_record.prosecdef IS NOT TRUE
       OR NOT (
         'search_path=""' = ANY(function_record.proconfig)
         AND 'row_security=off' = ANY(function_record.proconfig)
       )
       OR pg_catalog.has_function_privilege(
         'anon', function_signature, 'EXECUTE'
       )
       OR pg_catalog.has_function_privilege(
         'authenticated', function_signature, 'EXECUTE'
       )
       OR NOT pg_catalog.has_function_privilege(
         'service_role', function_signature, 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'ATOMIC_COMMUNITY_CREATE_FUNCTION_INVALID: %',
        function_signature
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END;
$atomic_community_create_postcondition$;

COMMENT ON FUNCTION public.community_create_comment_atomic(
  uuid, uuid, uuid, text, text
) IS 'Service-only atomic profile+comment creation with target and parent revalidation.';
COMMENT ON FUNCTION public.community_create_post_with_poll_atomic(
  uuid, text, text, text, text, text[], jsonb, text, uuid[], text[], jsonb,
  text, text, jsonb, boolean, smallint, jsonb
) IS 'Service-only atomic profile+post+optional poll creation with strict payload validation.';

COMMIT;
