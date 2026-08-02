-- Serialize community vote mutations and collapse inaccessible-target signals.
--
-- The client-callable vote RPCs previously read a user's old vote without
-- locking the target. Concurrent toggles could therefore apply the same stale
-- counter delta more than once. The target guard also returned a different
-- SQLSTATE for an inaccessible target and a nonexistent target.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
DECLARE
  missing_prerequisite text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'postgres'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role'
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_VOTE_REQUIRED_ROLE_MISSING'
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.string_agg(
    pg_catalog.format('%I.%I', prerequisite.table_name, prerequisite.column_name),
    ', ' ORDER BY prerequisite.table_name, prerequisite.column_name
  )
  INTO missing_prerequisite
  FROM (VALUES
    ('community_posts', 'id'),
    ('community_posts', 'author_id'),
    ('community_posts', 'visibility'),
    ('community_posts', 'under_review'),
    ('community_posts', 'upvote_count'),
    ('community_posts', 'downvote_count'),
    ('community_comments', 'id'),
    ('community_comments', 'post_id'),
    ('community_comments', 'is_deleted'),
    ('community_comments', 'upvote_count'),
    ('community_votes', 'user_id'),
    ('community_votes', 'post_id'),
    ('community_votes', 'comment_id'),
    ('community_votes', 'vote_type')
  ) AS prerequisite(table_name, column_name)
  LEFT JOIN information_schema.columns AS existing
    ON existing.table_schema = 'public'
   AND existing.table_name = prerequisite.table_name
   AND existing.column_name = prerequisite.column_name
  WHERE existing.column_name IS NULL;

  IF missing_prerequisite IS NOT NULL THEN
    RAISE EXCEPTION 'COMMUNITY_VOTE_PREREQUISITE_MISSING: %', missing_prerequisite
      USING ERRCODE = '55000';
  END IF;

  IF pg_catalog.to_regprocedure('auth.uid()') IS NULL
     OR pg_catalog.to_regprocedure('auth.role()') IS NULL THEN
    RAISE EXCEPTION 'COMMUNITY_VOTE_AUTH_HELPER_MISSING'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns AS existing
    WHERE existing.table_schema = 'auth'
      AND existing.table_name = 'users'
      AND existing.column_name = 'id'
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_VOTE_AUTH_USERS_ID_MISSING'
      USING ERRCODE = '55000';
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.community_vote_post(uuid,uuid,smallint)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.community_vote_comment(uuid,uuid,smallint)'
     ) IS NULL THEN
    RAISE EXCEPTION 'COMMUNITY_VOTE_RPC_MISSING'
      USING ERRCODE = '55000';
  END IF;
END;
$preflight$;

LOCK TABLE
  public.community_posts,
  public.community_comments,
  public.community_votes
IN SHARE ROW EXCLUSIVE MODE;

-- Post reactions have been likes-only since 20260531000000. Refuse to hide
-- unexpected legacy rows behind a forced zero downvote counter.
DO $post_vote_invariant$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.community_votes AS vote
    WHERE vote.post_id IS NOT NULL
      AND vote.vote_type <> 1
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_VOTE_UNEXPECTED_POST_DOWNVOTE_REQUIRES_REVIEW'
      USING ERRCODE = '55000';
  END IF;
END;
$post_vote_invariant$;

CREATE OR REPLACE FUNCTION public.community_vote_post(
  p_user_id uuid,
  p_post_id uuid,
  p_vote_type smallint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $community_vote_post$
DECLARE
  v_author_id uuid;
  v_visibility text;
  v_under_review boolean;
  v_readable boolean;
  v_upvote_count integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (
       auth.role() IS DISTINCT FROM 'authenticated'
       OR auth.uid() IS NULL
       OR auth.uid() <> p_user_id
     ) THEN
    RAISE EXCEPTION 'community_vote_user_mismatch'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL OR p_post_id IS NULL THEN
    RAISE EXCEPTION 'invalid_community_vote_target'
      USING ERRCODE = '22023';
  END IF;

  IF p_vote_type IS NULL OR p_vote_type NOT IN (0, 1) THEN
    RAISE EXCEPTION 'invalid_post_vote_type'
      USING ERRCODE = '22023';
  END IF;

  -- Match account-deletion lock order (auth user -> target) so a concurrent
  -- delete either waits for this vote transaction or makes this call fail.
  PERFORM 1
  FROM auth.users AS actor
  WHERE actor.id = p_user_id
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'community_vote_user_mismatch'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    post.author_id,
    post.visibility,
    COALESCE(post.under_review, false)
  INTO
    v_author_id,
    v_visibility,
    v_under_review
  FROM public.community_posts AS post
  WHERE post.id = p_post_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'community_vote_target_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  v_readable := CASE
    WHEN v_under_review IS TRUE THEN v_author_id = p_user_id
    WHEN v_visibility = 'public' THEN true
    WHEN v_visibility = 'members' THEN p_user_id IS NOT NULL
    WHEN v_visibility = 'draft' THEN v_author_id = p_user_id
    ELSE false
  END;

  IF v_readable IS NOT TRUE THEN
    RAISE EXCEPTION 'community_vote_target_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_vote_type = 0 THEN
    DELETE FROM public.community_votes AS vote
    WHERE vote.user_id = p_user_id
      AND vote.post_id = p_post_id;
  ELSE
    INSERT INTO public.community_votes AS vote (
      user_id,
      post_id,
      vote_type
    ) VALUES (
      p_user_id,
      p_post_id,
      1
    )
    ON CONFLICT (user_id, post_id)
    DO UPDATE SET vote_type = EXCLUDED.vote_type;
  END IF;

  SELECT pg_catalog.count(*)::integer
  INTO v_upvote_count
  FROM public.community_votes AS vote
  WHERE vote.post_id = p_post_id
    AND vote.vote_type = 1;

  UPDATE public.community_posts AS post
  SET upvote_count = v_upvote_count,
      downvote_count = 0
  WHERE post.id = p_post_id;
END;
$community_vote_post$;

CREATE OR REPLACE FUNCTION public.community_vote_comment(
  p_user_id uuid,
  p_comment_id uuid,
  p_vote_type smallint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $community_vote_comment$
DECLARE
  v_post_id uuid;
  v_locked_comment_post_id uuid;
  v_comment_is_deleted boolean;
  v_post_author_id uuid;
  v_post_visibility text;
  v_post_under_review boolean;
  v_readable boolean;
  v_upvote_count integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (
       auth.role() IS DISTINCT FROM 'authenticated'
       OR auth.uid() IS NULL
       OR auth.uid() <> p_user_id
     ) THEN
    RAISE EXCEPTION 'community_vote_user_mismatch'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL OR p_comment_id IS NULL THEN
    RAISE EXCEPTION 'invalid_community_vote_target'
      USING ERRCODE = '22023';
  END IF;

  IF p_vote_type IS NULL OR p_vote_type NOT IN (-1, 0, 1) THEN
    RAISE EXCEPTION 'invalid_comment_vote_type'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM auth.users AS actor
  WHERE actor.id = p_user_id
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'community_vote_user_mismatch'
      USING ERRCODE = '42501';
  END IF;

  -- Resolve the parent first, then lock parent -> comment in a fixed order.
  -- The second lookup revalidates the relationship after both row locks.
  SELECT comment.post_id
  INTO v_post_id
  FROM public.community_comments AS comment
  WHERE comment.id = p_comment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'community_vote_target_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT
    post.author_id,
    post.visibility,
    COALESCE(post.under_review, false)
  INTO
    v_post_author_id,
    v_post_visibility,
    v_post_under_review
  FROM public.community_posts AS post
  WHERE post.id = v_post_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'community_vote_target_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT
    comment.post_id,
    COALESCE(comment.is_deleted, false)
  INTO
    v_locked_comment_post_id,
    v_comment_is_deleted
  FROM public.community_comments AS comment
  WHERE comment.id = p_comment_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_comment_is_deleted IS TRUE
     OR v_locked_comment_post_id IS DISTINCT FROM v_post_id THEN
    RAISE EXCEPTION 'community_vote_target_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  v_readable := CASE
    WHEN v_post_under_review IS TRUE THEN v_post_author_id = p_user_id
    WHEN v_post_visibility = 'public' THEN true
    WHEN v_post_visibility = 'members' THEN p_user_id IS NOT NULL
    WHEN v_post_visibility = 'draft' THEN v_post_author_id = p_user_id
    ELSE false
  END;

  IF v_readable IS NOT TRUE THEN
    RAISE EXCEPTION 'community_vote_target_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_vote_type = 0 THEN
    DELETE FROM public.community_votes AS vote
    WHERE vote.user_id = p_user_id
      AND vote.comment_id = p_comment_id;
  ELSE
    INSERT INTO public.community_votes AS vote (
      user_id,
      comment_id,
      vote_type
    ) VALUES (
      p_user_id,
      p_comment_id,
      p_vote_type
    )
    ON CONFLICT (user_id, comment_id)
    DO UPDATE SET vote_type = EXCLUDED.vote_type;
  END IF;

  SELECT pg_catalog.count(*)::integer
  INTO v_upvote_count
  FROM public.community_votes AS vote
  WHERE vote.comment_id = p_comment_id
    AND vote.vote_type = 1;

  UPDATE public.community_comments AS comment
  SET upvote_count = v_upvote_count
  WHERE comment.id = p_comment_id;
END;
$community_vote_comment$;

CREATE OR REPLACE FUNCTION public.community_vote_target_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $community_vote_target_guard$
DECLARE
  v_actor_id uuid;
  v_author_id uuid;
  v_visibility text;
  v_under_review boolean;
  v_readable boolean;
BEGIN
  v_actor_id := NEW.user_id;

  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (
       auth.role() IS DISTINCT FROM 'authenticated'
       OR auth.uid() IS NULL
       OR auth.uid() <> v_actor_id
     ) THEN
    RAISE EXCEPTION 'community_vote_user_mismatch'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM auth.users AS actor
  WHERE actor.id = v_actor_id
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'community_vote_user_mismatch'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.post_id IS NOT NULL AND NEW.comment_id IS NULL THEN
    IF NEW.vote_type IS DISTINCT FROM 1::smallint THEN
      RAISE EXCEPTION 'invalid_post_vote_type'
        USING ERRCODE = '22023';
    END IF;

    SELECT
      post.author_id,
      post.visibility,
      COALESCE(post.under_review, false)
    INTO
      v_author_id,
      v_visibility,
      v_under_review
    FROM public.community_posts AS post
    WHERE post.id = NEW.post_id
    FOR UPDATE;
  ELSIF NEW.comment_id IS NOT NULL AND NEW.post_id IS NULL THEN
    SELECT
      post.author_id,
      post.visibility,
      COALESCE(post.under_review, false)
    INTO
      v_author_id,
      v_visibility,
      v_under_review
    FROM public.community_comments AS comment
    JOIN public.community_posts AS post
      ON post.id = comment.post_id
    WHERE comment.id = NEW.comment_id
      AND COALESCE(comment.is_deleted, false) IS FALSE
    FOR UPDATE OF post, comment;
  ELSE
    RAISE EXCEPTION 'invalid_community_vote_target'
      USING ERRCODE = '22023';
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'community_vote_target_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  v_readable := CASE
    WHEN v_under_review IS TRUE THEN v_author_id = v_actor_id
    WHEN v_visibility = 'public' THEN true
    WHEN v_visibility = 'members' THEN v_actor_id IS NOT NULL
    WHEN v_visibility = 'draft' THEN v_author_id = v_actor_id
    ELSE false
  END;

  IF v_readable IS NOT TRUE THEN
    RAISE EXCEPTION 'community_vote_target_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN NEW;
END;
$community_vote_target_guard$;

-- Votes can also disappear through auth.users -> community_votes ON DELETE
-- CASCADE. This DELETE-only trigger keeps denormalized counters correct without
-- duplicating RPC handling for INSERT or UPDATE. Each arithmetic UPDATE is a
-- single row-locked PostgreSQL statement, so concurrent cascades cannot lose a
-- decrement. If the target itself is being cascaded away, updating zero rows is
-- intentionally harmless.
CREATE OR REPLACE FUNCTION public.community_vote_delete_counter_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $community_vote_delete_counter_sync$
DECLARE
  v_remaining_upvotes integer;
BEGIN
  IF OLD.vote_type = 1::smallint THEN
    IF OLD.post_id IS NOT NULL THEN
      PERFORM 1
      FROM public.community_posts AS post
      WHERE post.id = OLD.post_id
      FOR UPDATE;

      IF FOUND THEN
        SELECT pg_catalog.count(*)::integer
        INTO v_remaining_upvotes
        FROM public.community_votes AS vote
        WHERE vote.post_id = OLD.post_id
          AND vote.vote_type = 1;

        UPDATE public.community_posts AS post
        SET upvote_count = CASE
          WHEN COALESCE(post.upvote_count, 0) > v_remaining_upvotes
            THEN GREATEST(COALESCE(post.upvote_count, 0) - 1, 0)
          ELSE v_remaining_upvotes
        END
        WHERE post.id = OLD.post_id;
      END IF;
    ELSIF OLD.comment_id IS NOT NULL THEN
      PERFORM 1
      FROM public.community_comments AS comment
      WHERE comment.id = OLD.comment_id
      FOR UPDATE;

      IF FOUND THEN
        SELECT pg_catalog.count(*)::integer
        INTO v_remaining_upvotes
        FROM public.community_votes AS vote
        WHERE vote.comment_id = OLD.comment_id
          AND vote.vote_type = 1;

        UPDATE public.community_comments AS comment
        SET upvote_count = CASE
          WHEN COALESCE(comment.upvote_count, 0) > v_remaining_upvotes
            THEN GREATEST(COALESCE(comment.upvote_count, 0) - 1, 0)
          ELSE v_remaining_upvotes
        END
        WHERE comment.id = OLD.comment_id;
      END IF;
    END IF;
  END IF;

  RETURN OLD;
END;
$community_vote_delete_counter_sync$;

ALTER FUNCTION public.community_vote_post(uuid, uuid, smallint)
  OWNER TO postgres;
ALTER FUNCTION public.community_vote_comment(uuid, uuid, smallint)
  OWNER TO postgres;
ALTER FUNCTION public.community_vote_target_guard()
  OWNER TO postgres;
ALTER FUNCTION public.community_vote_delete_counter_sync()
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.community_vote_post(uuid, uuid, smallint)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_vote_comment(uuid, uuid, smallint)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_vote_target_guard()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_vote_delete_counter_sync()
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.community_vote_post(uuid, uuid, smallint)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_vote_comment(uuid, uuid, smallint)
  TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_community_vote_target_guard
  ON public.community_votes;
CREATE TRIGGER trg_community_vote_target_guard
BEFORE INSERT OR UPDATE ON public.community_votes
FOR EACH ROW EXECUTE FUNCTION public.community_vote_target_guard();

DROP TRIGGER IF EXISTS trg_community_vote_delete_counter_sync
  ON public.community_votes;
CREATE CONSTRAINT TRIGGER trg_community_vote_delete_counter_sync
AFTER DELETE ON public.community_votes
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.community_vote_delete_counter_sync();

-- Repair any counter drift already present before the serialized functions are
-- installed. The table locks above keep this snapshot coherent.
UPDATE public.community_posts AS post
SET upvote_count = (
      SELECT pg_catalog.count(*)::integer
      FROM public.community_votes AS vote
      WHERE vote.post_id = post.id
        AND vote.vote_type = 1
    ),
    downvote_count = 0
WHERE post.upvote_count IS DISTINCT FROM (
        SELECT pg_catalog.count(*)::integer
        FROM public.community_votes AS vote
        WHERE vote.post_id = post.id
          AND vote.vote_type = 1
      )
   OR post.downvote_count IS DISTINCT FROM 0;

UPDATE public.community_comments AS comment
SET upvote_count = (
      SELECT pg_catalog.count(*)::integer
      FROM public.community_votes AS vote
      WHERE vote.comment_id = comment.id
        AND vote.vote_type = 1
    )
WHERE comment.upvote_count IS DISTINCT FROM (
  SELECT pg_catalog.count(*)::integer
  FROM public.community_votes AS vote
  WHERE vote.comment_id = comment.id
    AND vote.vote_type = 1
);

DO $postcondition$
DECLARE
  function_row record;
  function_owner text;
  function_is_security_definer boolean;
  function_config text[];
  unexpected_grantee text;
  trigger_count integer;
  trigger_type smallint;
  trigger_function oid;
  delete_trigger_count integer;
  delete_trigger_type smallint;
  delete_trigger_function oid;
  delete_trigger_is_constraint boolean;
  delete_trigger_is_deferrable boolean;
  delete_trigger_is_initially_deferred boolean;
BEGIN
  FOR function_row IN
    SELECT *
    FROM (VALUES
      (
        'public.community_vote_post(uuid,uuid,smallint)'::text,
        true,
        true
      ),
      (
        'public.community_vote_comment(uuid,uuid,smallint)'::text,
        true,
        true
      ),
      (
        'public.community_vote_target_guard()'::text,
        false,
        false
      ),
      (
        'public.community_vote_delete_counter_sync()'::text,
        false,
        false
      )
    ) AS expected(signature, authenticated_execute, service_execute)
  LOOP
    SELECT
      pg_catalog.pg_get_userbyid(proc.proowner),
      proc.prosecdef,
      proc.proconfig
    INTO
      function_owner,
      function_is_security_definer,
      function_config
    FROM pg_catalog.pg_proc AS proc
    WHERE proc.oid = pg_catalog.to_regprocedure(function_row.signature);

    IF function_owner IS DISTINCT FROM 'postgres'
       OR function_is_security_definer IS NOT TRUE
       OR function_config IS DISTINCT FROM ARRAY['search_path=""']::text[] THEN
      RAISE EXCEPTION 'COMMUNITY_VOTE_FUNCTION_AUTHORITY_INVALID: %',
        function_row.signature
        USING ERRCODE = '55000';
    END IF;

    IF pg_catalog.has_function_privilege(
         'anon', function_row.signature, 'EXECUTE'
       )
       OR pg_catalog.has_function_privilege(
         'authenticated', function_row.signature, 'EXECUTE'
       ) IS DISTINCT FROM function_row.authenticated_execute
       OR pg_catalog.has_function_privilege(
         'service_role', function_row.signature, 'EXECUTE'
       ) IS DISTINCT FROM function_row.service_execute THEN
      RAISE EXCEPTION 'COMMUNITY_VOTE_FUNCTION_GRANT_INVALID: %',
        function_row.signature
        USING ERRCODE = '55000';
    END IF;

    SELECT pg_catalog.string_agg(
      COALESCE(grantee.rolname, 'PUBLIC'),
      ', ' ORDER BY COALESCE(grantee.rolname, 'PUBLIC')
    )
    INTO unexpected_grantee
    FROM pg_catalog.pg_proc AS proc
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        proc.proacl,
        pg_catalog.acldefault('f', proc.proowner)
      )
    ) AS privilege
    LEFT JOIN pg_catalog.pg_roles AS grantee
      ON grantee.oid = privilege.grantee
    WHERE proc.oid = pg_catalog.to_regprocedure(function_row.signature)
      AND privilege.privilege_type = 'EXECUTE'
      AND privilege.grantee <> proc.proowner
      AND NOT (
        function_row.authenticated_execute
        AND grantee.rolname = 'authenticated'
      )
      AND NOT (
        function_row.service_execute
        AND grantee.rolname = 'service_role'
      );

    IF unexpected_grantee IS NOT NULL THEN
      RAISE EXCEPTION 'COMMUNITY_VOTE_UNEXPECTED_FUNCTION_GRANTEE: % -> %',
        function_row.signature,
        unexpected_grantee
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  SELECT
    pg_catalog.count(*)::integer,
    pg_catalog.min(trigger.tgtype)::smallint,
    pg_catalog.min(trigger.tgfoid)
  INTO trigger_count, trigger_type, trigger_function
  FROM pg_catalog.pg_trigger AS trigger
  WHERE trigger.tgrelid = 'public.community_votes'::pg_catalog.regclass
    AND trigger.tgname = 'trg_community_vote_target_guard'
    AND trigger.tgisinternal IS FALSE;

  -- ROW (1) + BEFORE (2) + INSERT (4) + UPDATE (16) = 23.
  IF trigger_count <> 1
     OR trigger_type IS DISTINCT FROM 23::smallint
     OR trigger_function IS DISTINCT FROM pg_catalog.to_regprocedure(
       'public.community_vote_target_guard()'
     ) THEN
    RAISE EXCEPTION 'COMMUNITY_VOTE_TARGET_TRIGGER_INVALID'
      USING ERRCODE = '55000';
  END IF;

  SELECT
    pg_catalog.count(*)::integer,
    pg_catalog.min(trigger.tgtype)::smallint,
    pg_catalog.min(trigger.tgfoid),
    pg_catalog.bool_and(trigger.tgconstraint <> 0::oid),
    pg_catalog.bool_and(trigger.tgdeferrable),
    pg_catalog.bool_and(trigger.tginitdeferred)
  INTO
    delete_trigger_count,
    delete_trigger_type,
    delete_trigger_function,
    delete_trigger_is_constraint,
    delete_trigger_is_deferrable,
    delete_trigger_is_initially_deferred
  FROM pg_catalog.pg_trigger AS trigger
  WHERE trigger.tgrelid = 'public.community_votes'::pg_catalog.regclass
    AND trigger.tgname = 'trg_community_vote_delete_counter_sync'
    AND trigger.tgisinternal IS FALSE;

  -- ROW (1) + DELETE (8) = 9. AFTER contributes no BEFORE bit.
  IF delete_trigger_count <> 1
     OR delete_trigger_type IS DISTINCT FROM 9::smallint
     OR delete_trigger_is_constraint IS NOT TRUE
     OR delete_trigger_is_deferrable IS NOT TRUE
     OR delete_trigger_is_initially_deferred IS NOT TRUE
     OR delete_trigger_function IS DISTINCT FROM pg_catalog.to_regprocedure(
       'public.community_vote_delete_counter_sync()'
     ) THEN
    RAISE EXCEPTION 'COMMUNITY_VOTE_DELETE_COUNTER_TRIGGER_INVALID'
      USING ERRCODE = '55000';
  END IF;
END;
$postcondition$;

COMMIT;
