-- Make community_profiles.total_upvotes_received an exact derivative of the
-- canonical community_votes ledger.
--
-- Reputation semantics are intentionally narrow: count each surviving +1
-- vote attached to a post currently authored by the profile, plus each +1
-- vote attached to a non-deleted comment currently authored by the profile.
-- Visibility and moderation state do not erase legitimately received history,
-- while hard-deleted content and soft-deleted comments cannot retain rank.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $community_reputation_preflight$
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
    RAISE EXCEPTION 'COMMUNITY_REPUTATION_REQUIRED_ROLE_MISSING'
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.string_agg(
    pg_catalog.format('%I.%I', prerequisite.table_name, prerequisite.column_name),
    ', ' ORDER BY prerequisite.table_name, prerequisite.column_name
  )
  INTO missing_prerequisite
  FROM (VALUES
    ('community_profiles', 'user_id'),
    ('community_profiles', 'post_count'),
    ('community_profiles', 'comment_count'),
    ('community_profiles', 'total_upvotes_received'),
    ('community_profiles', 'wedding_completed'),
    ('community_profiles', 'rank'),
    ('community_posts', 'id'),
    ('community_posts', 'author_id'),
    ('community_posts', 'author_public_id'),
    ('community_comments', 'id'),
    ('community_comments', 'author_id'),
    ('community_comments', 'author_public_id'),
    ('community_comments', 'is_deleted'),
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
    RAISE EXCEPTION 'COMMUNITY_REPUTATION_PREREQUISITE_MISSING: %',
      missing_prerequisite
      USING ERRCODE = '55000';
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.ensure_community_public_identity(uuid)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.bind_community_author_public_identity()'
     ) IS NULL THEN
    RAISE EXCEPTION 'COMMUNITY_REPUTATION_PUBLIC_IDENTITY_PREREQUISITE_MISSING'
      USING ERRCODE = '55000';
  END IF;
END;
$community_reputation_preflight$;

LOCK TABLE
  public.community_profiles,
  public.community_posts,
  public.community_comments,
  public.community_votes
IN SHARE ROW EXCLUSIVE MODE;

-- A trusted re-author operation must rotate the denormalized public author ID
-- to the new account's immutable pseudonym. Supplying a different public ID
-- without changing author_id remains forbidden.
CREATE OR REPLACE FUNCTION public.bind_community_author_public_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $bind_community_author_public_identity$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.author_id IS NOT DISTINCT FROM OLD.author_id
     AND NEW.author_public_id IS DISTINCT FROM OLD.author_public_id THEN
    RAISE EXCEPTION 'COMMUNITY_AUTHOR_PUBLIC_ID_IMMUTABLE'
      USING ERRCODE = '23514';
  END IF;

  NEW.author_public_id :=
    public.ensure_community_public_identity(NEW.author_id);
  RETURN NEW;
END;
$bind_community_author_public_identity$;

ALTER FUNCTION public.bind_community_author_public_identity()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.bind_community_author_public_identity()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.community_recompute_profile_upvotes(
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $community_recompute_profile_upvotes$
DECLARE
  canonical_total integer;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  -- Serialize every reputation recomputation for one author. The count query
  -- is a separate READ COMMITTED statement, so it receives a fresh snapshot
  -- after waiting for a concurrent writer of the same profile.
  PERFORM 1
  FROM public.community_profiles AS profile
  WHERE profile.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Profiles may be initialized after their content. The profile INSERT
    -- guard below derives the complete value when that row appears.
    RETURN;
  END IF;

  SELECT pg_catalog.count(*)::integer
  INTO canonical_total
  FROM public.community_votes AS vote
  LEFT JOIN public.community_posts AS post
    ON post.id = vote.post_id
  LEFT JOIN public.community_comments AS comment
    ON comment.id = vote.comment_id
  WHERE vote.vote_type = 1
    AND (
      (vote.post_id IS NOT NULL AND post.author_id = p_user_id)
      OR (
        vote.comment_id IS NOT NULL
        AND comment.author_id = p_user_id
        AND comment.is_deleted IS NOT TRUE
      )
    );

  UPDATE public.community_profiles AS profile
  SET total_upvotes_received = canonical_total
  WHERE profile.user_id = p_user_id
    AND profile.total_upvotes_received IS DISTINCT FROM canonical_total;
END;
$community_recompute_profile_upvotes$;

CREATE OR REPLACE FUNCTION public.community_vote_reputation_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $community_vote_reputation_sync$
DECLARE
  old_author_id uuid;
  new_author_id uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF OLD.post_id IS NOT NULL THEN
      SELECT post.author_id
      INTO old_author_id
      FROM public.community_posts AS post
      WHERE post.id = OLD.post_id;
    ELSIF OLD.comment_id IS NOT NULL THEN
      SELECT comment.author_id
      INTO old_author_id
      FROM public.community_comments AS comment
      WHERE comment.id = OLD.comment_id;
    END IF;
  END IF;

  IF TG_OP <> 'DELETE' THEN
    IF NEW.post_id IS NOT NULL THEN
      SELECT post.author_id
      INTO new_author_id
      FROM public.community_posts AS post
      WHERE post.id = NEW.post_id;
    ELSIF NEW.comment_id IS NOT NULL THEN
      SELECT comment.author_id
      INTO new_author_id
      FROM public.community_comments AS comment
      WHERE comment.id = NEW.comment_id;
    END IF;
  END IF;

  -- Lock two affected profiles in UUID order. This prevents re-targeting or
  -- service-side repair transactions from deadlocking each other.
  IF old_author_id IS NULL THEN
    PERFORM public.community_recompute_profile_upvotes(new_author_id);
  ELSIF new_author_id IS NULL OR old_author_id = new_author_id THEN
    PERFORM public.community_recompute_profile_upvotes(old_author_id);
  ELSIF old_author_id < new_author_id THEN
    PERFORM public.community_recompute_profile_upvotes(old_author_id);
    PERFORM public.community_recompute_profile_upvotes(new_author_id);
  ELSE
    PERFORM public.community_recompute_profile_upvotes(new_author_id);
    PERFORM public.community_recompute_profile_upvotes(old_author_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$community_vote_reputation_sync$;

CREATE OR REPLACE FUNCTION public.community_content_reputation_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $community_content_reputation_sync$
DECLARE
  old_author_id uuid;
  new_author_id uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    old_author_id := OLD.author_id;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    new_author_id := NEW.author_id;
  END IF;

  IF old_author_id IS NULL THEN
    PERFORM public.community_recompute_profile_upvotes(new_author_id);
  ELSIF new_author_id IS NULL OR old_author_id = new_author_id THEN
    PERFORM public.community_recompute_profile_upvotes(old_author_id);
  ELSIF old_author_id < new_author_id THEN
    PERFORM public.community_recompute_profile_upvotes(old_author_id);
    PERFORM public.community_recompute_profile_upvotes(new_author_id);
  ELSE
    PERFORM public.community_recompute_profile_upvotes(new_author_id);
    PERFORM public.community_recompute_profile_upvotes(old_author_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$community_content_reputation_sync$;

CREATE OR REPLACE FUNCTION public.community_profile_upvote_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $community_profile_upvote_guard$
BEGIN
  -- Derive late profile inserts from the ledger. Nested updates issued by the
  -- canonical recompute helper already hold the exact value; top-level manual
  -- or rolling-deploy writes are normalized here.
  IF TG_OP = 'INSERT' OR pg_catalog.pg_trigger_depth() = 1 THEN
    SELECT pg_catalog.count(*)::integer
    INTO NEW.total_upvotes_received
    FROM public.community_votes AS vote
    LEFT JOIN public.community_posts AS post
      ON post.id = vote.post_id
    LEFT JOIN public.community_comments AS comment
      ON comment.id = vote.comment_id
    WHERE vote.vote_type = 1
      AND (
        (vote.post_id IS NOT NULL AND post.author_id = NEW.user_id)
        OR (
          vote.comment_id IS NOT NULL
          AND comment.author_id = NEW.user_id
          AND comment.is_deleted IS NOT TRUE
        )
      );
  END IF;

  RETURN NEW;
END;
$community_profile_upvote_guard$;

-- Replace the legacy AFTER trigger, which performed a recursive UPDATE, with
-- a final BEFORE guard. Trigger name ordering makes this run after the three
-- counter guards and gives late profile inserts the correct initial rank.
DROP TRIGGER IF EXISTS trg_recalc_rank ON public.community_profiles;

CREATE OR REPLACE FUNCTION public.community_recalc_rank()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $community_recalc_rank$
BEGIN
  NEW.rank := CASE
    WHEN NEW.wedding_completed IS TRUE THEN 'senior'
    WHEN COALESCE(NEW.post_count, 0) >= 50
         AND COALESCE(NEW.total_upvotes_received, 0) >= 100 THEN 'master'
    WHEN COALESCE(NEW.post_count, 0) >= 20
         AND COALESCE(NEW.comment_count, 0) >= 50 THEN 'expert'
    WHEN COALESCE(NEW.post_count, 0) >= 5
         OR COALESCE(NEW.comment_count, 0) >= 20 THEN 'preparing'
    ELSE 'sprout'
  END;
  RETURN NEW;
END;
$community_recalc_rank$;

ALTER FUNCTION public.community_recompute_profile_upvotes(uuid)
  OWNER TO postgres;
ALTER FUNCTION public.community_vote_reputation_sync()
  OWNER TO postgres;
ALTER FUNCTION public.community_content_reputation_sync()
  OWNER TO postgres;
ALTER FUNCTION public.community_profile_upvote_guard()
  OWNER TO postgres;
ALTER FUNCTION public.community_recalc_rank()
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.community_recompute_profile_upvotes(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_vote_reputation_sync()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_content_reputation_sync()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_profile_upvote_guard()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_recalc_rank()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_community_vote_reputation_sync
  ON public.community_votes;
CREATE CONSTRAINT TRIGGER trg_community_vote_reputation_sync
AFTER INSERT OR UPDATE OR DELETE ON public.community_votes
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.community_vote_reputation_sync();

DROP TRIGGER IF EXISTS trg_community_post_reputation_sync
  ON public.community_posts;
CREATE CONSTRAINT TRIGGER trg_community_post_reputation_sync
AFTER INSERT OR UPDATE OF author_id OR DELETE ON public.community_posts
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.community_content_reputation_sync();

DROP TRIGGER IF EXISTS trg_community_comment_reputation_sync
  ON public.community_comments;
CREATE CONSTRAINT TRIGGER trg_community_comment_reputation_sync
AFTER INSERT OR UPDATE OF author_id, is_deleted OR DELETE
ON public.community_comments
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.community_content_reputation_sync();

DROP TRIGGER IF EXISTS trg_community_profile_upvote_guard
  ON public.community_profiles;
CREATE TRIGGER trg_community_profile_upvote_guard
BEFORE INSERT OR UPDATE OF total_upvotes_received
ON public.community_profiles
FOR EACH ROW EXECUTE FUNCTION public.community_profile_upvote_guard();

CREATE TRIGGER trg_recalc_rank
BEFORE INSERT OR UPDATE OF
  post_count,
  comment_count,
  total_upvotes_received,
  wedding_completed,
  rank
ON public.community_profiles
FOR EACH ROW EXECUTE FUNCTION public.community_recalc_rank();

-- Repair historical drift and stale ranks under the coherent table snapshot.
WITH canonical_totals AS (
  SELECT
    profile.user_id,
    COALESCE(received.total_upvotes, 0)::integer AS total_upvotes
  FROM public.community_profiles AS profile
  LEFT JOIN (
    SELECT authored.author_id, pg_catalog.count(*)::integer AS total_upvotes
    FROM (
      SELECT post.author_id
      FROM public.community_votes AS vote
      JOIN public.community_posts AS post ON post.id = vote.post_id
      WHERE vote.vote_type = 1
      UNION ALL
      SELECT comment.author_id
      FROM public.community_votes AS vote
      JOIN public.community_comments AS comment ON comment.id = vote.comment_id
      WHERE vote.vote_type = 1
        AND comment.is_deleted IS NOT TRUE
    ) AS authored
    GROUP BY authored.author_id
  ) AS received ON received.author_id = profile.user_id
)
UPDATE public.community_profiles AS profile
SET total_upvotes_received = canonical.total_upvotes
FROM canonical_totals AS canonical
WHERE canonical.user_id = profile.user_id
  AND (
    profile.total_upvotes_received IS DISTINCT FROM canonical.total_upvotes
    OR profile.rank IS DISTINCT FROM CASE
      WHEN profile.wedding_completed IS TRUE THEN 'senior'
      WHEN COALESCE(profile.post_count, 0) >= 50
           AND canonical.total_upvotes >= 100 THEN 'master'
      WHEN COALESCE(profile.post_count, 0) >= 20
           AND COALESCE(profile.comment_count, 0) >= 50 THEN 'expert'
      WHEN COALESCE(profile.post_count, 0) >= 5
           OR COALESCE(profile.comment_count, 0) >= 20 THEN 'preparing'
      ELSE 'sprout'
    END
  );

DO $community_reputation_postcondition$
DECLARE
  function_signature text;
  function_record pg_catalog.pg_proc%ROWTYPE;
  trigger_record pg_catalog.pg_trigger%ROWTYPE;
BEGIN
  FOREACH function_signature IN ARRAY ARRAY[
    'public.bind_community_author_public_identity()',
    'public.community_recompute_profile_upvotes(uuid)',
    'public.community_vote_reputation_sync()',
    'public.community_content_reputation_sync()',
    'public.community_profile_upvote_guard()',
    'public.community_recalc_rank()'
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
       OR pg_catalog.has_function_privilege(
         'service_role', function_signature, 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'COMMUNITY_REPUTATION_FUNCTION_INVALID: %',
        function_signature
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM public.community_profiles AS profile
    WHERE profile.total_upvotes_received IS DISTINCT FROM (
      SELECT pg_catalog.count(*)::integer
      FROM public.community_votes AS vote
      LEFT JOIN public.community_posts AS post ON post.id = vote.post_id
      LEFT JOIN public.community_comments AS comment
        ON comment.id = vote.comment_id
      WHERE vote.vote_type = 1
        AND (
          (vote.post_id IS NOT NULL AND post.author_id = profile.user_id)
          OR (
            vote.comment_id IS NOT NULL
            AND comment.author_id = profile.user_id
            AND comment.is_deleted IS NOT TRUE
          )
        )
    )
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_REPUTATION_BACKFILL_INVALID'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.community_profiles AS profile
    WHERE profile.rank IS DISTINCT FROM CASE
      WHEN profile.wedding_completed IS TRUE THEN 'senior'
      WHEN COALESCE(profile.post_count, 0) >= 50
           AND COALESCE(profile.total_upvotes_received, 0) >= 100 THEN 'master'
      WHEN COALESCE(profile.post_count, 0) >= 20
           AND COALESCE(profile.comment_count, 0) >= 50 THEN 'expert'
      WHEN COALESCE(profile.post_count, 0) >= 5
           OR COALESCE(profile.comment_count, 0) >= 20 THEN 'preparing'
      ELSE 'sprout'
    END
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_REPUTATION_RANK_BACKFILL_INVALID'
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO trigger_record
  FROM pg_catalog.pg_trigger AS trigger
  WHERE trigger.tgrelid = 'public.community_profiles'::pg_catalog.regclass
    AND trigger.tgname = 'trg_recalc_rank'
    AND trigger.tgisinternal IS FALSE;

  IF NOT FOUND
     OR trigger_record.tgtype <> 23
     OR trigger_record.tgfoid <> pg_catalog.to_regprocedure(
       'public.community_recalc_rank()'
     ) THEN
    RAISE EXCEPTION 'COMMUNITY_REPUTATION_RANK_TRIGGER_INVALID'
      USING ERRCODE = '55000';
  END IF;
END;
$community_reputation_postcondition$;

COMMENT ON COLUMN public.community_profiles.total_upvotes_received IS
  'Exact count of +1 ledger votes on the profile current posts and non-deleted comments.';
COMMENT ON FUNCTION public.community_recompute_profile_upvotes(uuid) IS
  'Serially recomputes one profile reputation from the canonical community_votes ledger.';

COMMIT;
