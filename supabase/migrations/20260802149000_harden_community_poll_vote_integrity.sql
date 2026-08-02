-- Make poll voting a serialized, database-enforced operation.
--
-- Lock order for both the RPC and its write guard is:
--   auth.users -> community_posts -> community_polls -> poll option.
-- Holding the poll row FOR UPDATE serializes every vote/mode change for the
-- same poll. Counters are then derived from vote rows instead of incremented.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $poll_vote_integrity_preflight$
DECLARE
  missing_prerequisite text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'postgres')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'POLL_VOTE_INTEGRITY_REQUIRED_ROLE_MISSING'
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.string_agg(
    pg_catalog.format('%I.%I', prerequisite.table_name, prerequisite.column_name),
    ', ' ORDER BY prerequisite.table_name, prerequisite.column_name
  )
  INTO missing_prerequisite
  FROM (VALUES
    ('users', 'id'),
    ('community_posts', 'id'),
    ('community_posts', 'author_id'),
    ('community_posts', 'visibility'),
    ('community_posts', 'under_review'),
    ('community_polls', 'id'),
    ('community_polls', 'post_id'),
    ('community_polls', 'allow_multiple'),
    ('community_polls', 'closes_at'),
    ('community_polls', 'total_voters'),
    ('community_polls', 'total_votes'),
    ('community_poll_options', 'id'),
    ('community_poll_options', 'poll_id'),
    ('community_poll_options', 'vote_count'),
    ('community_poll_votes', 'id'),
    ('community_poll_votes', 'poll_id'),
    ('community_poll_votes', 'option_id'),
    ('community_poll_votes', 'user_id'),
    ('community_poll_votes', 'created_at')
  ) AS prerequisite(table_name, column_name)
  LEFT JOIN information_schema.columns AS existing
    ON existing.table_schema = CASE
      WHEN prerequisite.table_name = 'users' THEN 'auth'
      ELSE 'public'
    END
   AND existing.table_name = prerequisite.table_name
   AND existing.column_name = prerequisite.column_name
  WHERE existing.column_name IS NULL;

  IF missing_prerequisite IS NOT NULL THEN
    RAISE EXCEPTION 'POLL_VOTE_INTEGRITY_PREREQUISITE_MISSING: %',
      missing_prerequisite
      USING ERRCODE = '55000';
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.community_cast_poll_vote(uuid,uuid,uuid)'
     ) IS NULL THEN
    RAISE EXCEPTION 'POLL_VOTE_INTEGRITY_RPC_MISSING'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.community_poll_votes'::pg_catalog.regclass
      AND conname = 'community_poll_votes_option_poll_fkey'
      AND contype = 'f'
      AND convalidated
  ) THEN
    RAISE EXCEPTION 'POLL_VOTE_INTEGRITY_COMPOSITE_FK_MISSING'
      USING ERRCODE = '55000';
  END IF;
END;
$poll_vote_integrity_preflight$;

LOCK TABLE
  public.community_polls,
  public.community_poll_options,
  public.community_poll_votes
IN SHARE ROW EXCLUSIVE MODE;

-- Remove the legacy read-then-write counter trigger before repairing rows.
DROP TRIGGER IF EXISTS trg_poll_votes_recount
  ON public.community_poll_votes;
DROP TRIGGER IF EXISTS trg_community_poll_vote_delete_recount
  ON public.community_poll_votes;
DROP FUNCTION IF EXISTS public.community_poll_recount();

-- A single-choice poll can retain only the latest recorded choice per user.
WITH ranked_single_choices AS (
  SELECT
    vote.id,
    pg_catalog.row_number() OVER (
      PARTITION BY vote.poll_id, vote.user_id
      ORDER BY vote.created_at DESC, vote.id DESC
    ) AS choice_rank
  FROM public.community_poll_votes AS vote
  JOIN public.community_polls AS poll ON poll.id = vote.poll_id
  WHERE poll.allow_multiple IS FALSE
)
DELETE FROM public.community_poll_votes AS vote
USING ranked_single_choices AS ranked
WHERE vote.id = ranked.id
  AND ranked.choice_rank > 1;

-- Repair all historical counters from the authoritative vote rows.
UPDATE public.community_poll_options AS option
SET vote_count = (
  SELECT pg_catalog.count(*)::integer
  FROM public.community_poll_votes AS vote
  WHERE vote.option_id = option.id
);

UPDATE public.community_polls AS poll
SET total_votes = (
      SELECT pg_catalog.count(*)::integer
      FROM public.community_poll_votes AS vote
      WHERE vote.poll_id = poll.id
    ),
    total_voters = (
      SELECT pg_catalog.count(DISTINCT vote.user_id)::integer
      FROM public.community_poll_votes AS vote
      WHERE vote.poll_id = poll.id
    );

-- A privileged direct INSERT still has to obey actor, target, close-time, and
-- single-choice invariants. Vote rows are immutable; changes are delete+insert.
CREATE OR REPLACE FUNCTION public.community_poll_vote_target_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $poll_vote_target_guard$
DECLARE
  target_post_id uuid;
  target_author_id uuid;
  target_visibility text;
  target_under_review boolean;
  target_allow_multiple boolean;
  target_closes_at timestamptz;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'poll_vote_rows_are_immutable'
      USING ERRCODE = '0A000';
  END IF;

  IF COALESCE(auth.role(), '') <> 'service_role'
     AND (auth.uid() IS NULL OR auth.uid() <> NEW.user_id) THEN
    RAISE EXCEPTION 'poll_vote_actor_mismatch'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM auth.users AS actor
  WHERE actor.id = NEW.user_id
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'poll_vote_actor_mismatch'
      USING ERRCODE = '42501';
  END IF;

  SELECT poll.post_id
  INTO target_post_id
  FROM public.community_polls AS poll
  WHERE poll.id = NEW.poll_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'poll_vote_target_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT post.author_id, post.visibility, post.under_review
  INTO target_author_id, target_visibility, target_under_review
  FROM public.community_posts AS post
  WHERE post.id = target_post_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'poll_vote_target_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT poll.allow_multiple, poll.closes_at
  INTO target_allow_multiple, target_closes_at
  FROM public.community_polls AS poll
  WHERE poll.id = NEW.poll_id
    AND poll.post_id = target_post_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'poll_vote_target_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(target_under_review, FALSE) THEN
    IF target_author_id <> NEW.user_id THEN
      RAISE EXCEPTION 'poll_vote_target_not_found'
        USING ERRCODE = 'P0002';
    END IF;
  ELSIF NOT (
    target_visibility = 'public'
    OR target_visibility = 'members'
    OR (target_visibility = 'draft' AND target_author_id = NEW.user_id)
  ) THEN
    RAISE EXCEPTION 'poll_vote_target_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF target_closes_at IS NOT NULL
     AND target_closes_at <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'poll_closed'
      USING ERRCODE = '55000';
  END IF;

  PERFORM 1
  FROM public.community_poll_options AS option
  WHERE option.id = NEW.option_id
    AND option.poll_id = NEW.poll_id
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'poll_vote_option_invalid'
      USING ERRCODE = '23503';
  END IF;

  IF NOT target_allow_multiple
     AND EXISTS (
       SELECT 1
       FROM public.community_poll_votes AS existing_vote
       WHERE existing_vote.poll_id = NEW.poll_id
         AND existing_vote.user_id = NEW.user_id
         AND existing_vote.id <> NEW.id
     ) THEN
    RAISE EXCEPTION 'poll_single_choice_conflict'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$poll_vote_target_guard$;

ALTER FUNCTION public.community_poll_vote_target_guard() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.community_poll_vote_target_guard()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_community_poll_vote_target_guard
  ON public.community_poll_votes;
CREATE TRIGGER trg_community_poll_vote_target_guard
BEFORE INSERT OR UPDATE ON public.community_poll_votes
FOR EACH ROW EXECUTE FUNCTION public.community_poll_vote_target_guard();

-- A poll cannot be changed from multi-choice to single-choice while any user
-- still has multiple rows. The poll update and vote insert share the row lock.
CREATE OR REPLACE FUNCTION public.community_poll_mode_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $poll_mode_guard$
BEGIN
  IF OLD.allow_multiple
     AND NOT NEW.allow_multiple
     AND EXISTS (
       SELECT 1
       FROM public.community_poll_votes AS vote
       WHERE vote.poll_id = NEW.id
       GROUP BY vote.user_id
       HAVING pg_catalog.count(*) > 1
     ) THEN
    RAISE EXCEPTION 'poll_has_multiple_choices'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$poll_mode_guard$;

ALTER FUNCTION public.community_poll_mode_guard() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.community_poll_mode_guard()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_community_poll_mode_guard
  ON public.community_polls;
CREATE TRIGGER trg_community_poll_mode_guard
BEFORE UPDATE OF allow_multiple ON public.community_polls
FOR EACH ROW EXECUTE FUNCTION public.community_poll_mode_guard();

-- Cascaded account/option deletion bypasses the RPC. Recount at transaction
-- end, after every cascade has settled. If the poll was also cascaded away,
-- there is intentionally nothing left to update.
CREATE OR REPLACE FUNCTION public.community_poll_vote_delete_recount()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $poll_vote_delete_recount$
BEGIN
  PERFORM 1
  FROM public.community_polls AS poll
  WHERE poll.id = OLD.poll_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN OLD;
  END IF;

  UPDATE public.community_poll_options AS option
  SET vote_count = (
    SELECT pg_catalog.count(*)::integer
    FROM public.community_poll_votes AS vote
    WHERE vote.option_id = option.id
  )
  WHERE option.poll_id = OLD.poll_id;

  UPDATE public.community_polls AS poll
  SET total_votes = (
        SELECT pg_catalog.count(*)::integer
        FROM public.community_poll_votes AS vote
        WHERE vote.poll_id = OLD.poll_id
      ),
      total_voters = (
        SELECT pg_catalog.count(DISTINCT vote.user_id)::integer
        FROM public.community_poll_votes AS vote
        WHERE vote.poll_id = OLD.poll_id
      )
  WHERE poll.id = OLD.poll_id;

  RETURN OLD;
END;
$poll_vote_delete_recount$;

ALTER FUNCTION public.community_poll_vote_delete_recount() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.community_poll_vote_delete_recount()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE CONSTRAINT TRIGGER trg_community_poll_vote_delete_recount
AFTER DELETE ON public.community_poll_votes
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.community_poll_vote_delete_recount();

CREATE OR REPLACE FUNCTION public.community_cast_poll_vote(
  p_poll_id uuid,
  p_option_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $cast_poll_vote$
DECLARE
  target_post_id uuid;
  target_author_id uuid;
  target_visibility text;
  target_under_review boolean;
  target_allow_multiple boolean;
  target_closes_at timestamptz;
  selected_already boolean;
  existing_option_id uuid;
  result_action text;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND (auth.uid() IS NULL OR auth.uid() <> p_user_id) THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', FALSE,
      'error', 'forbidden'
    );
  END IF;

  PERFORM 1
  FROM auth.users AS actor
  WHERE actor.id = p_user_id
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', FALSE,
      'error', 'forbidden'
    );
  END IF;

  SELECT poll.post_id
  INTO target_post_id
  FROM public.community_polls AS poll
  WHERE poll.id = p_poll_id;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', FALSE,
      'error', 'poll_not_found'
    );
  END IF;

  SELECT post.author_id, post.visibility, post.under_review
  INTO target_author_id, target_visibility, target_under_review
  FROM public.community_posts AS post
  WHERE post.id = target_post_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', FALSE,
      'error', 'poll_not_found'
    );
  END IF;

  SELECT poll.allow_multiple, poll.closes_at
  INTO target_allow_multiple, target_closes_at
  FROM public.community_polls AS poll
  WHERE poll.id = p_poll_id
    AND poll.post_id = target_post_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', FALSE,
      'error', 'poll_not_found'
    );
  END IF;

  IF COALESCE(target_under_review, FALSE) THEN
    IF target_author_id <> p_user_id THEN
      RETURN pg_catalog.jsonb_build_object(
        'ok', FALSE,
        'error', 'poll_not_found'
      );
    END IF;
  ELSIF NOT (
    target_visibility = 'public'
    OR target_visibility = 'members'
    OR (target_visibility = 'draft' AND target_author_id = p_user_id)
  ) THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', FALSE,
      'error', 'poll_not_found'
    );
  END IF;

  IF target_closes_at IS NOT NULL
     AND target_closes_at <= pg_catalog.clock_timestamp() THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', FALSE,
      'error', 'poll_closed'
    );
  END IF;

  PERFORM 1
  FROM public.community_poll_options AS option
  WHERE option.id = p_option_id
    AND option.poll_id = p_poll_id
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', FALSE,
      'error', 'option_invalid'
    );
  END IF;

  IF target_allow_multiple THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.community_poll_votes AS vote
      WHERE vote.poll_id = p_poll_id
        AND vote.option_id = p_option_id
        AND vote.user_id = p_user_id
    )
    INTO selected_already;

    IF selected_already THEN
      DELETE FROM public.community_poll_votes AS vote
      WHERE vote.poll_id = p_poll_id
        AND vote.option_id = p_option_id
        AND vote.user_id = p_user_id;
      result_action := 'removed';
    ELSE
      INSERT INTO public.community_poll_votes (poll_id, option_id, user_id)
      VALUES (p_poll_id, p_option_id, p_user_id);
      result_action := 'added';
    END IF;
  ELSE
    SELECT vote.option_id
    INTO existing_option_id
    FROM public.community_poll_votes AS vote
    WHERE vote.poll_id = p_poll_id
      AND vote.user_id = p_user_id;

    IF FOUND AND existing_option_id = p_option_id THEN
      DELETE FROM public.community_poll_votes AS vote
      WHERE vote.poll_id = p_poll_id
        AND vote.user_id = p_user_id;
      result_action := 'removed';
    ELSE
      DELETE FROM public.community_poll_votes AS vote
      WHERE vote.poll_id = p_poll_id
        AND vote.user_id = p_user_id;

      INSERT INTO public.community_poll_votes (poll_id, option_id, user_id)
      VALUES (p_poll_id, p_option_id, p_user_id);
      result_action := 'switched';
    END IF;
  END IF;

  UPDATE public.community_poll_options AS option
  SET vote_count = (
    SELECT pg_catalog.count(*)::integer
    FROM public.community_poll_votes AS vote
    WHERE vote.option_id = option.id
  )
  WHERE option.poll_id = p_poll_id;

  UPDATE public.community_polls AS poll
  SET total_votes = (
        SELECT pg_catalog.count(*)::integer
        FROM public.community_poll_votes AS vote
        WHERE vote.poll_id = p_poll_id
      ),
      total_voters = (
        SELECT pg_catalog.count(DISTINCT vote.user_id)::integer
        FROM public.community_poll_votes AS vote
        WHERE vote.poll_id = p_poll_id
      )
  WHERE poll.id = p_poll_id;

  RETURN pg_catalog.jsonb_build_object(
    'ok', TRUE,
    'action', result_action
  );
END;
$cast_poll_vote$;

ALTER FUNCTION public.community_cast_poll_vote(uuid, uuid, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.community_cast_poll_vote(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_cast_poll_vote(uuid, uuid, uuid)
  TO service_role;

-- All vote mutation now passes through the SECURITY DEFINER RPC. Keep only the
-- own-vote SELECT path used to render a viewer's selected option(s).
DO $drop_poll_vote_write_policies$
DECLARE
  write_policy record;
BEGIN
  FOR write_policy IN
    SELECT policy.polname
    FROM pg_catalog.pg_policy AS policy
    WHERE policy.polrelid = 'public.community_poll_votes'::pg_catalog.regclass
      AND policy.polcmd IN ('*', 'a', 'w', 'd')
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY %I ON public.community_poll_votes',
      write_policy.polname
    );
  END LOOP;
END;
$drop_poll_vote_write_policies$;

DO $revoke_poll_vote_write_columns$
DECLARE
  all_columns text;
BEGIN
  SELECT pg_catalog.string_agg(
    pg_catalog.format('%I', column_name),
    ', ' ORDER BY ordinal_position
  )
  INTO all_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'community_poll_votes';

  IF all_columns IS NULL THEN
    RAISE EXCEPTION 'POLL_VOTE_INTEGRITY_TABLE_MISSING'
      USING ERRCODE = '55000';
  END IF;

  EXECUTE pg_catalog.format(
    'REVOKE INSERT (%s) ON TABLE public.community_poll_votes FROM PUBLIC, anon, authenticated, service_role',
    all_columns
  );
  EXECUTE pg_catalog.format(
    'REVOKE UPDATE (%s) ON TABLE public.community_poll_votes FROM PUBLIC, anon, authenticated, service_role',
    all_columns
  );
END;
$revoke_poll_vote_write_columns$;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.community_poll_votes
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.community_poll_votes TO service_role;

DO $poll_vote_integrity_postcondition$
DECLARE
  target_role text;
  function_name text;
  unsafe_policy text;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.community_poll_votes AS vote
    JOIN public.community_polls AS poll ON poll.id = vote.poll_id
    WHERE poll.allow_multiple IS FALSE
    GROUP BY vote.poll_id, vote.user_id
    HAVING pg_catalog.count(*) > 1
  ) THEN
    RAISE EXCEPTION 'POLL_VOTE_INTEGRITY_SINGLE_CHOICE_DUPLICATE_REMAINS'
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
    RAISE EXCEPTION 'POLL_VOTE_INTEGRITY_OPTION_POLL_MISMATCH_REMAINS'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.community_poll_options AS option
    WHERE option.vote_count <> (
      SELECT pg_catalog.count(*)::integer
      FROM public.community_poll_votes AS vote
      WHERE vote.option_id = option.id
    )
  ) OR EXISTS (
    SELECT 1
    FROM public.community_polls AS poll
    WHERE poll.total_votes <> (
            SELECT pg_catalog.count(*)::integer
            FROM public.community_poll_votes AS vote
            WHERE vote.poll_id = poll.id
          )
       OR poll.total_voters <> (
            SELECT pg_catalog.count(DISTINCT vote.user_id)::integer
            FROM public.community_poll_votes AS vote
            WHERE vote.poll_id = poll.id
          )
  ) THEN
    RAISE EXCEPTION 'POLL_VOTE_INTEGRITY_COUNTER_DRIFT_REMAINS'
      USING ERRCODE = '55000';
  END IF;

  SELECT policy.polname
  INTO unsafe_policy
  FROM pg_catalog.pg_policy AS policy
  WHERE policy.polrelid = 'public.community_poll_votes'::pg_catalog.regclass
    AND policy.polcmd IN ('*', 'a', 'w', 'd')
  ORDER BY policy.polname
  LIMIT 1;

  IF unsafe_policy IS NOT NULL THEN
    RAISE EXCEPTION 'POLL_VOTE_INTEGRITY_WRITE_POLICY_REMAINS: %', unsafe_policy
      USING ERRCODE = '55000';
  END IF;

  FOREACH target_role IN ARRAY ARRAY[
    'anon', 'authenticated', 'service_role'
  ]::text[]
  LOOP
    IF pg_catalog.has_table_privilege(
         target_role,
         'public.community_poll_votes',
         'INSERT'
       )
       OR pg_catalog.has_any_column_privilege(
         target_role,
         'public.community_poll_votes',
         'INSERT'
       )
       OR pg_catalog.has_table_privilege(
         target_role,
         'public.community_poll_votes',
         'UPDATE'
       )
       OR pg_catalog.has_any_column_privilege(
         target_role,
         'public.community_poll_votes',
         'UPDATE'
       )
       OR pg_catalog.has_table_privilege(
         target_role,
         'public.community_poll_votes',
         'DELETE'
       )
       OR pg_catalog.has_table_privilege(
         target_role,
         'public.community_poll_votes',
         'TRUNCATE'
       ) THEN
      RAISE EXCEPTION 'POLL_VOTE_INTEGRITY_DIRECT_WRITE_OPEN: %', target_role
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  IF NOT pg_catalog.has_table_privilege(
       'service_role',
       'public.community_poll_votes',
       'SELECT'
     ) THEN
    RAISE EXCEPTION 'POLL_VOTE_INTEGRITY_SERVICE_READ_CLOSED'
      USING ERRCODE = '55000';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
       'service_role',
       'public.community_cast_poll_vote(uuid,uuid,uuid)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon',
       'public.community_cast_poll_vote(uuid,uuid,uuid)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated',
       'public.community_cast_poll_vote(uuid,uuid,uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'POLL_VOTE_INTEGRITY_RPC_GRANT_DRIFT'
      USING ERRCODE = '55000';
  END IF;

  FOREACH function_name IN ARRAY ARRAY[
    'community_poll_vote_target_guard',
    'community_poll_mode_guard',
    'community_poll_vote_delete_recount'
  ]::text[]
  LOOP
    IF pg_catalog.has_function_privilege(
         'service_role',
         pg_catalog.format('public.%I()', function_name),
         'EXECUTE'
       )
       OR pg_catalog.has_function_privilege(
         'authenticated',
         pg_catalog.format('public.%I()', function_name),
         'EXECUTE'
       )
       OR pg_catalog.has_function_privilege(
         'anon',
         pg_catalog.format('public.%I()', function_name),
         'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'POLL_VOTE_INTEGRITY_TRIGGER_FUNCTION_EXPOSED: %',
        function_name
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    JOIN pg_catalog.pg_roles AS owner
      ON owner.oid = procedure.proowner
    WHERE namespace.nspname = 'public'
      AND procedure.proname IN (
        'community_cast_poll_vote',
        'community_poll_vote_target_guard',
        'community_poll_mode_guard',
        'community_poll_vote_delete_recount'
      )
      AND (
        NOT procedure.prosecdef
        OR owner.rolname <> 'postgres'
        OR NOT EXISTS (
          SELECT 1
          FROM pg_catalog.unnest(procedure.proconfig) AS config(setting)
          WHERE config.setting IN ('search_path=', 'search_path=""')
        )
      )
  ) OR (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname IN (
        'community_cast_poll_vote',
        'community_poll_vote_target_guard',
        'community_poll_mode_guard',
        'community_poll_vote_delete_recount'
      )
  ) <> 4 THEN
    RAISE EXCEPTION 'POLL_VOTE_INTEGRITY_FUNCTION_HARDENING_DRIFT'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger
    WHERE trigger.tgrelid = 'public.community_poll_votes'::pg_catalog.regclass
      AND trigger.tgname = 'trg_community_poll_vote_target_guard'
      AND NOT trigger.tgisinternal
      AND trigger.tgtype = 23
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger
    WHERE trigger.tgrelid = 'public.community_poll_votes'::pg_catalog.regclass
      AND trigger.tgname = 'trg_community_poll_vote_delete_recount'
      AND NOT trigger.tgisinternal
      AND trigger.tgtype = 9
      AND trigger.tgdeferrable
      AND trigger.tginitdeferred
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger
    WHERE trigger.tgrelid = 'public.community_polls'::pg_catalog.regclass
      AND trigger.tgname = 'trg_community_poll_mode_guard'
      AND NOT trigger.tgisinternal
      AND trigger.tgtype = 19
  ) THEN
    RAISE EXCEPTION 'POLL_VOTE_INTEGRITY_TRIGGER_DRIFT'
      USING ERRCODE = '55000';
  END IF;

  IF pg_catalog.to_regprocedure('public.community_poll_recount()') IS NOT NULL
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_trigger AS trigger
       WHERE trigger.tgrelid = 'public.community_poll_votes'::pg_catalog.regclass
         AND trigger.tgname = 'trg_poll_votes_recount'
         AND NOT trigger.tgisinternal
     ) THEN
    RAISE EXCEPTION 'POLL_VOTE_INTEGRITY_LEGACY_RECOUNT_REMAINS'
      USING ERRCODE = '55000';
  END IF;
END;
$poll_vote_integrity_postcondition$;

COMMIT;
