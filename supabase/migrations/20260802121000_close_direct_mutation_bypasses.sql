-- Close direct PostgREST mutation paths that bypass canonical API/RPC checks.
--
-- Covered boundaries:
--   * reports: duplicate/self/inaccessible-target reports and auto-hide counts
--   * vendor messages: sender identity, thread identity, body, and read state
--   * comments: trusted counters/links, soft-delete semantics, and reply trees
--   * post/comment votes: trusted counters and atomic toggle semantics
--   * poll votes: close/access/choice rules and option-to-poll consistency
--   * cohort writes: the supplied room must be an active membership
--   * cohort messages: force creation/moderation through the validated API
--   * guestbook messages: remove the unused anonymous instant-publication path
--
-- This migration is forward-only DDL. It deliberately fails closed when
-- historical duplicate reports or mismatched poll votes need human review;
-- it never rewrites or deletes those audit-bearing rows automatically.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $direct_bypass_preflight$
DECLARE
  missing_prerequisite text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'DIRECT_BYPASS_FENCE_REQUIRED_ROLE_MISSING'
      USING ERRCODE = '55000';
  END IF;

  SELECT string_agg(
    format('%I.%I', prerequisite.table_name, prerequisite.column_name),
    ', ' ORDER BY prerequisite.table_name, prerequisite.column_name
  )
  INTO missing_prerequisite
  FROM (VALUES
    ('community_reports', 'reporter_id'),
    ('community_reports', 'post_id'),
    ('community_reports', 'comment_id'),
    ('community_reports', 'status'),
    ('community_posts', 'author_id'),
    ('community_posts', 'visibility'),
    ('community_posts', 'under_review'),
    ('vendor_messages', 'vendor_id'),
    ('vendor_messages', 'customer_id'),
    ('vendor_messages', 'sender_type'),
    ('vendor_messages', 'content'),
    ('vendor_messages', 'is_read'),
    ('vendor_messages', 'booking_id'),
    ('community_comments', 'post_id'),
    ('community_comments', 'parent_id'),
    ('community_comments', 'author_id'),
    ('community_comments', 'content'),
    ('community_comments', 'upvote_count'),
    ('community_comments', 'is_deleted'),
    ('community_votes', 'user_id'),
    ('community_votes', 'post_id'),
    ('community_votes', 'comment_id'),
    ('community_votes', 'vote_type'),
    ('cohort_members', 'room_id'),
    ('cohort_members', 'user_id'),
    ('cohort_members', 'is_active'),
    ('cohort_contracts', 'room_id'),
    ('cohort_contracts', 'user_id'),
    ('cohort_timeline_events', 'room_id'),
    ('cohort_timeline_events', 'user_id'),
    ('cohort_messages', 'room_id'),
    ('cohort_messages', 'author_id'),
    ('cohort_messages', 'content'),
    ('cohort_messages', 'images'),
    ('cohort_messages', 'reply_to'),
    ('cohort_messages', 'is_deleted'),
    ('cohort_messages', 'created_at'),
    ('community_poll_options', 'id'),
    ('community_poll_options', 'poll_id'),
    ('community_poll_votes', 'poll_id'),
    ('community_poll_votes', 'option_id'),
    ('community_poll_votes', 'user_id'),
    ('guestbook_messages', 'guestbook_id'),
    ('guestbook_messages', 'is_approved')
  ) AS prerequisite(table_name, column_name)
  LEFT JOIN information_schema.columns AS existing
    ON existing.table_schema = 'public'
   AND existing.table_name = prerequisite.table_name
   AND existing.column_name = prerequisite.column_name
  WHERE existing.column_name IS NULL;

  IF missing_prerequisite IS NOT NULL THEN
    RAISE EXCEPTION 'DIRECT_BYPASS_FENCE_PREREQUISITE_MISSING: %',
      missing_prerequisite
      USING ERRCODE = '55000';
  END IF;

  IF to_regprocedure('public.is_cohort_member(uuid)') IS NULL THEN
    RAISE EXCEPTION 'DIRECT_BYPASS_FENCE_COHORT_HELPER_MISSING'
      USING ERRCODE = '55000';
  END IF;

  IF to_regprocedure('public.community_vote_post(uuid,uuid,smallint)') IS NULL
     OR to_regprocedure('public.community_vote_comment(uuid,uuid,smallint)') IS NULL
     OR to_regprocedure('public.community_cast_poll_vote(uuid,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'DIRECT_BYPASS_FENCE_CANONICAL_VOTE_RPC_MISSING'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.community_reports
    WHERE post_id IS NOT NULL
    GROUP BY reporter_id, post_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'DIRECT_BYPASS_FENCE_DUPLICATE_POST_REPORTS_REQUIRE_REVIEW'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.community_reports
    WHERE comment_id IS NOT NULL
    GROUP BY reporter_id, comment_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'DIRECT_BYPASS_FENCE_DUPLICATE_COMMENT_REPORTS_REQUIRE_REVIEW'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.community_poll_votes AS vote
    LEFT JOIN public.community_poll_options AS option
      ON option.id = vote.option_id
     AND option.poll_id = vote.poll_id
    WHERE option.id IS NULL
  ) THEN
    RAISE EXCEPTION 'DIRECT_BYPASS_FENCE_MISMATCHED_POLL_VOTES_REQUIRE_REVIEW'
      USING ERRCODE = '55000';
  END IF;
END;
$direct_bypass_preflight$;

-- Reports now enter through the validated server endpoint only.
DROP POLICY IF EXISTS cr_insert ON public.community_reports;
DROP POLICY IF EXISTS community_reports_insert_own ON public.community_reports;

-- Message identity/read-state mutations now enter through /api/messages.
DROP POLICY IF EXISTS vendor_messages_insert ON public.vendor_messages;
DROP POLICY IF EXISTS vendor_messages_update ON public.vendor_messages;

-- Comment creation/edit/soft-delete now enter through the community APIs.
DROP POLICY IF EXISTS cc_insert ON public.community_comments;
DROP POLICY IF EXISTS cc_update ON public.community_comments;
DROP POLICY IF EXISTS cc_delete ON public.community_comments;

-- Cohort messages now enter through the membership/rate/content validated API.
DROP POLICY IF EXISTS cohort_messages_insert ON public.cohort_messages;
DROP POLICY IF EXISTS cohort_messages_update ON public.cohort_messages;
DROP POLICY IF EXISTS cohort_messages_delete ON public.cohort_messages;

-- Post/comment reactions now enter through their atomic counter RPCs only.
DROP POLICY IF EXISTS cv_insert ON public.community_votes;
DROP POLICY IF EXISTS cv_update ON public.community_votes;
DROP POLICY IF EXISTS cv_delete ON public.community_votes;

-- Poll changes now enter through community_cast_poll_vote only.
DROP POLICY IF EXISTS poll_votes_insert_own ON public.community_poll_votes;
DROP POLICY IF EXISTS poll_votes_delete_own ON public.community_poll_votes;

-- No guestbook submission surface is shipped. Close the historical anonymous
-- instant-publication policy until a rate-limited moderation API exists.
DROP POLICY IF EXISTS gb_messages_insert_anon ON public.guestbook_messages;

DO $revoke_fenced_columns$
DECLARE
  target_table text;
  all_columns text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'community_reports',
    'vendor_messages',
    'community_comments',
    'cohort_messages',
    'community_votes',
    'community_poll_votes'
  ]::text[]
  LOOP
    SELECT string_agg(format('%I', column_name), ', ' ORDER BY ordinal_position)
    INTO all_columns
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = target_table;

    IF all_columns IS NULL THEN
      RAISE EXCEPTION 'DIRECT_BYPASS_FENCE_TABLE_MISSING: %', target_table
        USING ERRCODE = '55000';
    END IF;

    EXECUTE format(
      'REVOKE INSERT (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated',
      all_columns,
      target_table
    );
    EXECUTE format(
      'REVOKE UPDATE (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated',
      all_columns,
      target_table
    );
  END LOOP;
END;
$revoke_fenced_columns$;

DO $revoke_guestbook_insert_columns$
DECLARE
  all_columns text;
BEGIN
  SELECT string_agg(format('%I', column_name), ', ' ORDER BY ordinal_position)
  INTO all_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'guestbook_messages';

  IF all_columns IS NULL THEN
    RAISE EXCEPTION 'DIRECT_BYPASS_FENCE_TABLE_MISSING: guestbook_messages'
      USING ERRCODE = '55000';
  END IF;

  EXECUTE format(
    'REVOKE INSERT (%s) ON TABLE public.guestbook_messages FROM PUBLIC, anon, authenticated',
    all_columns
  );
END;
$revoke_guestbook_insert_columns$;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.community_reports
  FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.vendor_messages
  FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.community_comments
  FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.cohort_messages
  FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.community_votes
  FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.community_poll_votes
  FROM PUBLIC, anon, authenticated;
REVOKE INSERT ON TABLE public.guestbook_messages
  FROM PUBLIC, anon, authenticated;

GRANT INSERT, UPDATE, DELETE ON TABLE
  public.community_reports,
  public.vendor_messages,
  public.community_comments,
  public.cohort_messages,
  public.community_votes,
  public.community_poll_votes
TO service_role;
GRANT INSERT ON TABLE public.guestbook_messages TO service_role;

-- The post/comment vote RPCs are intentionally authenticated-callable. Guard
-- their SECURITY DEFINER table writes against guessed hidden/draft targets.
CREATE OR REPLACE FUNCTION public.community_vote_target_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $vote_guard$
DECLARE
  target_author uuid;
  target_visibility text;
  target_under_review boolean;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND (auth.uid() IS NULL OR auth.uid() <> NEW.user_id) THEN
    RAISE EXCEPTION 'vote_user_mismatch'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.post_id IS NOT NULL THEN
    SELECT post.author_id, post.visibility, post.under_review
    INTO target_author, target_visibility, target_under_review
    FROM public.community_posts AS post
    WHERE post.id = NEW.post_id;
  ELSE
    SELECT post.author_id, post.visibility, post.under_review
    INTO target_author, target_visibility, target_under_review
    FROM public.community_comments AS comment
    JOIN public.community_posts AS post ON post.id = comment.post_id
    WHERE comment.id = NEW.comment_id
      AND comment.is_deleted = FALSE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'vote_target_not_found'
      USING ERRCODE = '23503';
  END IF;

  IF COALESCE(auth.role(), '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF COALESCE(target_under_review, FALSE)
     AND target_author <> NEW.user_id THEN
    RAISE EXCEPTION 'vote_target_not_accessible'
      USING ERRCODE = '42501';
  END IF;

  IF target_visibility = 'public'
     OR target_visibility = 'members'
     OR (target_visibility = 'draft' AND target_author = NEW.user_id) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'vote_target_not_accessible'
    USING ERRCODE = '42501';
END;
$vote_guard$;

REVOKE ALL ON FUNCTION public.community_vote_target_guard()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_community_vote_target_guard
  ON public.community_votes;
CREATE TRIGGER trg_community_vote_target_guard
BEFORE INSERT OR UPDATE ON public.community_votes
FOR EACH ROW EXECUTE FUNCTION public.community_vote_target_guard();

-- Preserve one report per reporter/target. The preflight above refuses to
-- discard historical duplicates silently.
CREATE UNIQUE INDEX IF NOT EXISTS community_reports_reporter_post_uidx
  ON public.community_reports (reporter_id, post_id)
  WHERE post_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS community_reports_reporter_comment_uidx
  ON public.community_reports (reporter_id, comment_id)
  WHERE comment_id IS NOT NULL;

-- Enforce target visibility and block self-reporting at the database boundary
-- even though the canonical endpoint performs the same checks.
CREATE OR REPLACE FUNCTION public.community_report_target_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $report_guard$
DECLARE
  target_author uuid;
  target_visibility text;
  target_under_review boolean;
BEGIN
  IF NEW.post_id IS NOT NULL THEN
    SELECT post.author_id, post.visibility, post.under_review
    INTO target_author, target_visibility, target_under_review
    FROM public.community_posts AS post
    WHERE post.id = NEW.post_id;
  ELSE
    SELECT comment.author_id, post.visibility, post.under_review
    INTO target_author, target_visibility, target_under_review
    FROM public.community_comments AS comment
    JOIN public.community_posts AS post ON post.id = comment.post_id
    WHERE comment.id = NEW.comment_id
      AND comment.is_deleted = FALSE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'report_target_not_found'
      USING ERRCODE = '23503';
  END IF;

  IF target_author = NEW.reporter_id THEN
    RAISE EXCEPTION 'self_report_not_allowed'
      USING ERRCODE = '22023';
  END IF;

  IF COALESCE(target_under_review, FALSE)
     OR target_visibility NOT IN ('public', 'members') THEN
    RAISE EXCEPTION 'report_target_not_accessible'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$report_guard$;

REVOKE ALL ON FUNCTION public.community_report_target_guard()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_community_report_target_guard
  ON public.community_reports;
CREATE TRIGGER trg_community_report_target_guard
BEFORE INSERT ON public.community_reports
FOR EACH ROW EXECUTE FUNCTION public.community_report_target_guard();

-- Historical duplicates cannot inflate this threshold after the migration,
-- and DISTINCT remains a second line of defense against future drift.
CREATE OR REPLACE FUNCTION public.community_report_auto_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $report_auto_review$
DECLARE
  reporter_count integer;
BEGIN
  IF NEW.post_id IS NOT NULL AND NEW.status = 'pending' THEN
    SELECT count(DISTINCT report.reporter_id)
    INTO reporter_count
    FROM public.community_reports AS report
    WHERE report.post_id = NEW.post_id
      AND report.status = 'pending';

    IF reporter_count >= 3 THEN
      UPDATE public.community_posts
      SET under_review = TRUE
      WHERE id = NEW.post_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$report_auto_review$;

REVOKE ALL ON FUNCTION public.community_report_auto_review()
  FROM PUBLIC, anon, authenticated;

-- The existing trigger keeps its name and picks up the replaced function.
DROP TRIGGER IF EXISTS trg_report_auto_review ON public.community_reports;
CREATE TRIGGER trg_report_auto_review
AFTER INSERT ON public.community_reports
FOR EACH ROW EXECUTE FUNCTION public.community_report_auto_review();

-- option_id and poll_id previously had independent foreign keys, which still
-- allowed an option from poll B to be recorded against poll A.
CREATE UNIQUE INDEX IF NOT EXISTS community_poll_options_id_poll_id_uidx
  ON public.community_poll_options (id, poll_id);

DO $poll_vote_composite_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.community_poll_votes'::regclass
      AND conname = 'community_poll_votes_option_poll_fkey'
      AND contype = 'f'
  ) THEN
    ALTER TABLE public.community_poll_votes
      ADD CONSTRAINT community_poll_votes_option_poll_fkey
      FOREIGN KEY (option_id, poll_id)
      REFERENCES public.community_poll_options (id, poll_id)
      ON DELETE CASCADE;
  END IF;
END;
$poll_vote_composite_fk$;

-- Cohort content remains directly writable for compatible clients, but only
-- while the caller is an active member of the exact supplied room.
DROP POLICY IF EXISTS cohort_contracts_insert ON public.cohort_contracts;
DROP POLICY IF EXISTS cohort_contracts_update ON public.cohort_contracts;
DROP POLICY IF EXISTS cohort_contracts_delete ON public.cohort_contracts;

CREATE POLICY cohort_contracts_insert ON public.cohort_contracts
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_cohort_member(room_id)
  );
CREATE POLICY cohort_contracts_update ON public.cohort_contracts
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    AND public.is_cohort_member(room_id)
  )
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_cohort_member(room_id)
  );
CREATE POLICY cohort_contracts_delete ON public.cohort_contracts
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    AND public.is_cohort_member(room_id)
  );

DROP POLICY IF EXISTS cohort_timeline_select ON public.cohort_timeline_events;
DROP POLICY IF EXISTS cohort_timeline_insert ON public.cohort_timeline_events;

CREATE POLICY cohort_timeline_select ON public.cohort_timeline_events
  FOR SELECT TO authenticated
  USING (public.is_cohort_member(room_id));
CREATE POLICY cohort_timeline_insert ON public.cohort_timeline_events
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_cohort_member(room_id)
  );

-- Remove PUBLIC/anon compatibility grants while preserving authenticated
-- writes that are now protected by the active-room policies above.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.cohort_contracts
  FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.cohort_timeline_events
  FROM PUBLIC, anon;
GRANT INSERT, UPDATE, DELETE ON TABLE public.cohort_contracts
  TO authenticated, service_role;
GRANT INSERT ON TABLE public.cohort_timeline_events
  TO authenticated, service_role;

DO $direct_bypass_postcondition$
DECLARE
  target_table text;
  target_role text;
  unsafe_policy text;
BEGIN
  FOREACH target_role IN ARRAY ARRAY['anon', 'authenticated']::text[]
  LOOP
    FOREACH target_table IN ARRAY ARRAY[
      'community_reports',
      'vendor_messages',
      'community_comments',
      'cohort_messages',
      'community_votes',
      'community_poll_votes'
    ]::text[]
    LOOP
      IF has_table_privilege(
           target_role,
           format('public.%I', target_table),
           'INSERT'
         )
         OR has_any_column_privilege(
           target_role,
           format('public.%I', target_table),
           'INSERT'
         )
         OR has_table_privilege(
           target_role,
           format('public.%I', target_table),
           'UPDATE'
         )
         OR has_any_column_privilege(
           target_role,
           format('public.%I', target_table),
           'UPDATE'
         )
         OR has_table_privilege(
           target_role,
           format('public.%I', target_table),
           'DELETE'
         ) THEN
        RAISE EXCEPTION 'DIRECT_BYPASS_FENCE_WRITE_OPEN: %.%',
          target_role,
          target_table
          USING ERRCODE = '55000';
      END IF;
    END LOOP;

    IF has_table_privilege(
         target_role,
         'public.guestbook_messages',
         'INSERT'
       ) OR has_any_column_privilege(
         target_role,
         'public.guestbook_messages',
         'INSERT'
       ) THEN
      RAISE EXCEPTION 'DIRECT_BYPASS_FENCE_GUESTBOOK_INSERT_OPEN: %', target_role
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  SELECT format('%I.%I policy %I', namespace.nspname, relation.relname, policy.polname)
  INTO unsafe_policy
  FROM pg_catalog.pg_policy AS policy
  JOIN pg_catalog.pg_class AS relation
    ON relation.oid = policy.polrelid
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND (
      (
        relation.relname IN (
          'community_reports',
          'vendor_messages',
          'community_comments',
          'cohort_messages',
          'community_votes',
          'community_poll_votes'
        )
        AND policy.polcmd IN ('*', 'a', 'w', 'd')
      )
      OR (
        relation.relname = 'guestbook_messages'
        AND policy.polcmd IN ('*', 'a')
      )
    )
    AND (
      0::oid = ANY(policy.polroles)
      OR (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'authenticated')
         = ANY(policy.polroles)
    )
  ORDER BY relation.relname, policy.polname
  LIMIT 1;

  IF unsafe_policy IS NOT NULL THEN
    RAISE EXCEPTION 'DIRECT_BYPASS_FENCE_WRITE_POLICY_REMAINS: %', unsafe_policy
      USING ERRCODE = '55000';
  END IF;

  FOREACH target_table IN ARRAY ARRAY[
    'community_reports',
    'vendor_messages',
    'community_comments',
    'cohort_messages',
    'community_votes',
    'community_poll_votes'
  ]::text[]
  LOOP
    IF NOT has_table_privilege(
         'service_role',
         format('public.%I', target_table),
         'INSERT'
       )
       OR NOT has_table_privilege(
         'service_role',
         format('public.%I', target_table),
         'UPDATE'
       )
       OR NOT has_table_privilege(
         'service_role',
         format('public.%I', target_table),
         'DELETE'
       ) THEN
      RAISE EXCEPTION 'DIRECT_BYPASS_FENCE_SERVICE_WRITE_CLOSED: %', target_table
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  IF NOT has_table_privilege(
       'service_role',
       'public.guestbook_messages',
       'INSERT'
     ) THEN
    RAISE EXCEPTION 'DIRECT_BYPASS_FENCE_SERVICE_GUESTBOOK_INSERT_CLOSED'
      USING ERRCODE = '55000';
  END IF;

  IF NOT has_function_privilege(
       'authenticated',
       'public.community_vote_post(uuid,uuid,smallint)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       'public.community_vote_comment(uuid,uuid,smallint)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.community_cast_poll_vote(uuid,uuid,uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'DIRECT_BYPASS_FENCE_CANONICAL_VOTE_RPC_CLOSED'
      USING ERRCODE = '55000';
  END IF;

  IF NOT has_table_privilege(
       'authenticated',
       'public.cohort_contracts',
       'INSERT'
     )
     OR NOT has_table_privilege(
       'authenticated',
       'public.cohort_contracts',
       'UPDATE'
     )
     OR NOT has_table_privilege(
       'authenticated',
       'public.cohort_contracts',
       'DELETE'
     )
     OR NOT has_table_privilege(
       'authenticated',
       'public.cohort_timeline_events',
       'INSERT'
     ) THEN
    RAISE EXCEPTION 'DIRECT_BYPASS_FENCE_COHORT_CANONICAL_WRITE_CLOSED'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.community_poll_votes'::regclass
      AND conname = 'community_poll_votes_option_poll_fkey'
      AND contype = 'f'
      AND convalidated
  ) THEN
    RAISE EXCEPTION 'DIRECT_BYPASS_FENCE_POLL_COMPOSITE_FK_MISSING'
      USING ERRCODE = '55000';
  END IF;
END;
$direct_bypass_postcondition$;

COMMIT;
