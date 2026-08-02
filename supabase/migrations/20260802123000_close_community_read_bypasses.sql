-- Close community read paths that exposed moderation-only or private fields.
--
-- RLS previously treated an under-review post as readable solely from its
-- visibility. Child comments and polls repeated the same mistake. In addition,
-- table-wide SELECT grants exposed verification document URLs and every
-- community profile field through PostgREST. Keep the public product projection
-- working while moving sensitive profile fields and verification evidence
-- behind service-owned APIs.
--
-- This migration changes policies and privileges only. It does not inspect or
-- rewrite customer rows.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $community_read_preflight$
DECLARE
  missing_prerequisite text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'COMMUNITY_READ_FENCE_REQUIRED_ROLE_MISSING'
      USING ERRCODE = '55000';
  END IF;

  SELECT string_agg(
    format('%I.%I', prerequisite.table_name, prerequisite.column_name),
    ', ' ORDER BY prerequisite.table_name, prerequisite.column_name
  )
  INTO missing_prerequisite
  FROM (VALUES
    ('community_profiles', 'user_id'),
    ('community_profiles', 'nickname'),
    ('community_profiles', 'avatar_url'),
    ('community_profiles', 'badge'),
    ('community_profiles', 'rank'),
    ('community_profiles', 'wedding_year'),
    ('community_profiles', 'wedding_month'),
    ('community_profiles', 'wedding_completed'),
    ('community_profiles', 'progress_percent'),
    ('community_profiles', 'region'),
    ('community_profiles', 'post_count'),
    ('community_profiles', 'comment_count'),
    ('community_profiles', 'total_upvotes_received'),
    ('community_profiles', 'total_xp'),
    ('community_profiles', 'level'),
    ('community_profiles', 'warning_count'),
    ('community_profiles', 'is_suspended'),
    ('community_profiles', 'created_at'),
    ('community_profiles', 'updated_at'),
    ('community_posts', 'id'),
    ('community_posts', 'author_id'),
    ('community_posts', 'visibility'),
    ('community_posts', 'under_review'),
    ('community_posts', 'verification_doc_url'),
    ('community_comments', 'post_id'),
    ('community_polls', 'post_id'),
    ('community_poll_options', 'poll_id')
  ) AS prerequisite(table_name, column_name)
  LEFT JOIN information_schema.columns AS existing
    ON existing.table_schema = 'public'
   AND existing.table_name = prerequisite.table_name
   AND existing.column_name = prerequisite.column_name
  WHERE existing.column_name IS NULL;

  IF missing_prerequisite IS NOT NULL THEN
    RAISE EXCEPTION 'COMMUNITY_READ_FENCE_PREREQUISITE_MISSING: %',
      missing_prerequisite
      USING ERRCODE = '55000';
  END IF;
END;
$community_read_preflight$;

-- Keep the intentionally public pseudonymous profile directory scoped to the
-- only API roles that use it. Column grants below define its visible fields.
DROP POLICY IF EXISTS community_profiles_select ON public.community_profiles;
CREATE POLICY community_profiles_select ON public.community_profiles
  FOR SELECT TO anon, authenticated
  USING (TRUE);

-- A post under moderation remains visible to its author for status and appeal
-- context, but is hidden from every other public/member reader.
DROP POLICY IF EXISTS cp_select_public ON public.community_posts;
CREATE POLICY cp_select_public ON public.community_posts
  FOR SELECT TO anon, authenticated
  USING (
    visibility = 'public'
    AND (
      NOT COALESCE(under_review, FALSE)
      OR author_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS cp_select_members ON public.community_posts;
CREATE POLICY cp_select_members ON public.community_posts
  FOR SELECT TO authenticated
  USING (
    visibility = 'members'
    AND (
      NOT COALESCE(under_review, FALSE)
      OR author_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS cp_select_drafts ON public.community_posts;
CREATE POLICY cp_select_drafts ON public.community_posts
  FOR SELECT TO authenticated
  USING (
    visibility = 'draft'
    AND author_id = auth.uid()
  );

-- Child rows must never reveal the existence or contents of a moderated post.
DROP POLICY IF EXISTS cc_select ON public.community_comments;
CREATE POLICY cc_select ON public.community_comments
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.community_posts AS post
      WHERE post.id = community_comments.post_id
        AND (
          post.visibility = 'public'
          OR (
            post.visibility = 'members'
            AND auth.role() = 'authenticated'
          )
        )
        AND (
          NOT COALESCE(post.under_review, FALSE)
          OR post.author_id = auth.uid()
        )
    )
  );

DROP POLICY IF EXISTS polls_select ON public.community_polls;
CREATE POLICY polls_select ON public.community_polls
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.community_posts AS post
      WHERE post.id = community_polls.post_id
        AND (
          post.visibility = 'public'
          OR (
            post.visibility = 'members'
            AND auth.role() = 'authenticated'
          )
          OR (
            post.visibility = 'draft'
            AND post.author_id = auth.uid()
          )
        )
        AND (
          NOT COALESCE(post.under_review, FALSE)
          OR post.author_id = auth.uid()
        )
    )
  );

DROP POLICY IF EXISTS poll_options_select ON public.community_poll_options;
CREATE POLICY poll_options_select ON public.community_poll_options
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.community_polls AS poll
      JOIN public.community_posts AS post ON post.id = poll.post_id
      WHERE poll.id = community_poll_options.poll_id
        AND (
          post.visibility = 'public'
          OR (
            post.visibility = 'members'
            AND auth.role() = 'authenticated'
          )
          OR (
            post.visibility = 'draft'
            AND post.author_id = auth.uid()
          )
        )
        AND (
          NOT COALESCE(post.under_review, FALSE)
          OR post.author_id = auth.uid()
        )
    )
  );

-- Table-level SELECT overrides a column revoke. Clear both table and historical
-- column grants before applying the explicit projections below.
REVOKE SELECT ON TABLE public.community_posts, public.community_profiles
  FROM PUBLIC, anon, authenticated;

DO $revoke_community_read_columns$
DECLARE
  target_table text;
  all_columns text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'community_posts',
    'community_profiles'
  ]::text[]
  LOOP
    SELECT string_agg(format('%I', column_name), ', ' ORDER BY ordinal_position)
    INTO all_columns
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = target_table;

    IF all_columns IS NULL THEN
      RAISE EXCEPTION 'COMMUNITY_READ_FENCE_TABLE_MISSING: %', target_table
        USING ERRCODE = '55000';
    END IF;

    EXECUTE format(
      'REVOKE SELECT (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated',
      all_columns,
      target_table
    );
  END LOOP;
END;
$revoke_community_read_columns$;

-- Every post field used by the public product remains readable except the
-- private verification artifact supplied to moderators.
DO $grant_public_post_projection$
DECLARE
  public_columns text;
BEGIN
  SELECT string_agg(format('%I', column_name), ', ' ORDER BY ordinal_position)
  INTO public_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'community_posts'
    AND column_name <> 'verification_doc_url';

  IF public_columns IS NULL THEN
    RAISE EXCEPTION 'COMMUNITY_READ_FENCE_POST_PROJECTION_EMPTY'
      USING ERRCODE = '55000';
  END IF;

  EXECUTE format(
    'GRANT SELECT (%s) ON TABLE public.community_posts TO anon, authenticated',
    public_columns
  );
END;
$grant_public_post_projection$;

-- Anonymous readers need only the pseudonymous author card. Authenticated
-- clients additionally consume public activity counters on the mobile profile.
-- Wedding timing drives cohort assignment but is not part of the public author
-- card: exposing it here would bypass the same-room API authorization boundary.
GRANT SELECT (
  user_id,
  nickname,
  avatar_url,
  badge,
  rank
) ON TABLE public.community_profiles TO anon;

GRANT SELECT (
  user_id,
  nickname,
  avatar_url,
  badge,
  rank,
  post_count,
  comment_count,
  total_upvotes_received
) ON TABLE public.community_profiles TO authenticated;

GRANT SELECT ON TABLE public.community_posts, public.community_profiles
  TO service_role;

DO $community_read_postcondition$
DECLARE
  target_role text;
  unexpected_profile_column text;
  missing_policy text;
BEGIN
  FOREACH target_role IN ARRAY ARRAY['anon', 'authenticated']::text[]
  LOOP
    IF has_table_privilege(
         target_role,
         'public.community_posts',
         'SELECT'
       ) OR has_column_privilege(
         target_role,
         'public.community_posts',
         'verification_doc_url',
         'SELECT'
       ) THEN
      RAISE EXCEPTION 'COMMUNITY_READ_FENCE_VERIFICATION_DOCUMENT_OPEN: %',
        target_role
        USING ERRCODE = '55000';
    END IF;

    IF NOT has_column_privilege(
         target_role,
         'public.community_posts',
         'id',
         'SELECT'
       ) OR NOT has_column_privilege(
         target_role,
         'public.community_posts',
         'title',
         'SELECT'
       ) THEN
      RAISE EXCEPTION 'COMMUNITY_READ_FENCE_PUBLIC_POST_PROJECTION_CLOSED: %',
        target_role
        USING ERRCODE = '55000';
    END IF;

    SELECT column_name
    INTO unexpected_profile_column
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'community_profiles'
      AND has_column_privilege(
        target_role,
        'public.community_profiles',
        column_name,
        'SELECT'
      )
      AND NOT (
        column_name = ANY (
          CASE target_role
            WHEN 'anon' THEN ARRAY[
              'user_id', 'nickname', 'avatar_url', 'badge', 'rank'
            ]::text[]
            ELSE ARRAY[
              'user_id', 'nickname', 'avatar_url', 'badge', 'rank', 'post_count',
              'comment_count', 'total_upvotes_received'
            ]::text[]
          END
        )
      )
    ORDER BY ordinal_position
    LIMIT 1;

    IF unexpected_profile_column IS NOT NULL THEN
      RAISE EXCEPTION 'COMMUNITY_READ_FENCE_PROFILE_COLUMN_OPEN: %.%',
        target_role,
        unexpected_profile_column
        USING ERRCODE = '55000';
    END IF;

    IF NOT has_column_privilege(
         target_role,
         'public.community_profiles',
         'nickname',
         'SELECT'
       ) THEN
      RAISE EXCEPTION 'COMMUNITY_READ_FENCE_PUBLIC_PROFILE_PROJECTION_CLOSED: %',
        target_role
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  SELECT expected.policy_name
  INTO missing_policy
  FROM (VALUES
    ('community_profiles', 'community_profiles_select'),
    ('community_posts', 'cp_select_public'),
    ('community_posts', 'cp_select_members'),
    ('community_posts', 'cp_select_drafts'),
    ('community_comments', 'cc_select'),
    ('community_polls', 'polls_select'),
    ('community_poll_options', 'poll_options_select')
  ) AS expected(table_name, policy_name)
  LEFT JOIN pg_catalog.pg_policy AS policy
    ON policy.polrelid = format('public.%I', expected.table_name)::regclass
   AND policy.polname = expected.policy_name
   AND policy.polcmd = 'r'
  WHERE policy.oid IS NULL
  LIMIT 1;

  IF missing_policy IS NOT NULL THEN
    RAISE EXCEPTION 'COMMUNITY_READ_FENCE_POLICY_MISSING: %', missing_policy
      USING ERRCODE = '55000';
  END IF;

  IF NOT has_table_privilege(
       'service_role',
       'public.community_posts',
       'SELECT'
     ) OR NOT has_table_privilege(
       'service_role',
       'public.community_profiles',
       'SELECT'
     ) THEN
    RAISE EXCEPTION 'COMMUNITY_READ_FENCE_SERVICE_READ_CLOSED'
      USING ERRCODE = '55000';
  END IF;
END;
$community_read_postcondition$;

COMMIT;
