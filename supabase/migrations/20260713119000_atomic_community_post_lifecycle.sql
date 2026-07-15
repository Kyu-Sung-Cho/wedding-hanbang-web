-- Community post creation/deletion must never drift from the author's
-- denormalized post_count. A table trigger owns the count in the same
-- transaction for every service/admin path, while the public delete route uses
-- an actor-scoped RPC. Hard deletion is retained because the current schema has
-- no truthful soft-delete state, the user-facing action is irreversible, and
-- all dependent UGC tables already declare ON DELETE CASCADE. Admin moderation
-- should use the existing reversible hide action unless irreversible removal is
-- explicitly intended.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

LOCK TABLE public.community_posts IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.community_comments IN SHARE ROW EXCLUSIVE MODE;
-- SET NOT NULL below requires ACCESS EXCLUSIVE; take it now so lock_timeout
-- fails before reconciliation work instead of during a late lock upgrade.
LOCK TABLE public.community_profiles IN ACCESS EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION public.maintain_community_profile_post_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
  updated_rows integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.community_profiles AS profile
       SET post_count = COALESCE(profile.post_count, 0) + 1,
           updated_at = pg_catalog.clock_timestamp()
     WHERE profile.user_id = NEW.author_id;

    GET DIAGNOSTICS updated_rows = ROW_COUNT;
    IF updated_rows <> 1 THEN
      RAISE EXCEPTION 'community post author profile not found'
        USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    UPDATE public.community_profiles AS profile
       SET post_count = GREATEST(0, COALESCE(profile.post_count, 0) - 1),
           updated_at = pg_catalog.clock_timestamp()
     WHERE profile.user_id = OLD.author_id;

    GET DIAGNOSTICS updated_rows = ROW_COUNT;
    -- During auth-user deletion, both the profile and posts are cascade
    -- children and the profile may already be gone. That state has no counter
    -- left to reconcile. For a live account, a missing profile is corruption
    -- and the post deletion must roll back instead of silently drifting.
    IF updated_rows = 0 AND EXISTS (
      SELECT 1 FROM auth.users AS auth_user WHERE auth_user.id = OLD.author_id
    ) THEN
      RAISE EXCEPTION 'community post author profile not found'
        USING ERRCODE = '23503';
    END IF;
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'unsupported community post count operation'
    USING ERRCODE = '0A000';
END;
$function$;

ALTER FUNCTION public.maintain_community_profile_post_count() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.maintain_community_profile_post_count()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS maintain_community_profile_post_count
  ON public.community_posts;
CREATE TRIGGER maintain_community_profile_post_count
  AFTER INSERT OR DELETE ON public.community_posts
  FOR EACH ROW
  EXECUTE FUNCTION public.maintain_community_profile_post_count();

-- A physical comment delete can be initiated directly, by a post cascade, by
-- a self-referencing reply cascade, or by account cleanup. Capture every path
-- once through a transition table. Soft-deleted rows were already decremented
-- by community_soft_delete_comment and therefore must not be counted again.
CREATE OR REPLACE FUNCTION public.maintain_community_counts_after_comment_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
  count_group record;
  updated_rows integer;
BEGIN
  IF TG_OP <> 'DELETE' THEN
    RAISE EXCEPTION 'unsupported community comment count operation'
      USING ERRCODE = '0A000';
  END IF;

  -- Lock surviving parent posts in deterministic order. During an ON DELETE
  -- CASCADE the parent post is already gone, so its update is a safe no-op.
  FOR count_group IN
    SELECT deleted_comment.post_id,
           pg_catalog.count(*)::integer AS deleted_count
    FROM deleted_community_comments AS deleted_comment
    WHERE NOT COALESCE(deleted_comment.is_deleted, false)
    GROUP BY deleted_comment.post_id
    ORDER BY deleted_comment.post_id
  LOOP
    UPDATE public.community_posts AS post
       SET comment_count = GREATEST(
             0,
             COALESCE(post.comment_count, 0) - count_group.deleted_count
           )
     WHERE post.id = count_group.post_id;
  END LOOP;

  -- Lock author profiles in the same deterministic order for all delete
  -- statements. Missing profiles are tolerated only while their auth account
  -- is itself being deleted; otherwise the mutation rolls back fail-closed.
  FOR count_group IN
    SELECT deleted_comment.author_id,
           pg_catalog.count(*)::integer AS deleted_count
    FROM deleted_community_comments AS deleted_comment
    WHERE NOT COALESCE(deleted_comment.is_deleted, false)
    GROUP BY deleted_comment.author_id
    ORDER BY deleted_comment.author_id
  LOOP
    UPDATE public.community_profiles AS profile
       SET comment_count = GREATEST(
             0,
             COALESCE(profile.comment_count, 0) - count_group.deleted_count
           ),
           updated_at = pg_catalog.clock_timestamp()
     WHERE profile.user_id = count_group.author_id;

    GET DIAGNOSTICS updated_rows = ROW_COUNT;
    IF updated_rows = 0 AND EXISTS (
      SELECT 1
      FROM auth.users AS auth_user
      WHERE auth_user.id = count_group.author_id
    ) THEN
      RAISE EXCEPTION 'community comment author profile not found'
        USING ERRCODE = '23503';
    END IF;
  END LOOP;

  RETURN NULL;
END;
$function$;

ALTER FUNCTION public.maintain_community_counts_after_comment_delete()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.maintain_community_counts_after_comment_delete()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS maintain_community_counts_after_comment_delete
  ON public.community_comments;
CREATE TRIGGER maintain_community_counts_after_comment_delete
  AFTER DELETE ON public.community_comments
  REFERENCING OLD TABLE AS deleted_community_comments
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.maintain_community_counts_after_comment_delete();

-- Reconcile all historical counters while both tables are write-locked. This
-- becomes the single source of truth before the trigger starts serving traffic.
UPDATE public.community_profiles AS profile
   SET post_count = (
         SELECT pg_catalog.count(*)::integer
         FROM public.community_posts AS post
         WHERE post.author_id = profile.user_id
       ),
       updated_at = pg_catalog.clock_timestamp()
 WHERE profile.post_count IS DISTINCT FROM (
         SELECT pg_catalog.count(*)::integer
         FROM public.community_posts AS post
         WHERE post.author_id = profile.user_id
       );

ALTER TABLE public.community_profiles
  ALTER COLUMN post_count SET DEFAULT 0,
  ALTER COLUMN post_count SET NOT NULL;

-- Previous non-atomic hard deletes could cascade active comments without
-- adjusting either denormalized count. Establish a truthful baseline while
-- posts, comments, and profiles remain write-locked.
UPDATE public.community_posts AS post
   SET comment_count = (
         SELECT pg_catalog.count(*)::integer
         FROM public.community_comments AS comment
         WHERE comment.post_id = post.id
           AND NOT COALESCE(comment.is_deleted, false)
       )
 WHERE post.comment_count IS DISTINCT FROM (
         SELECT pg_catalog.count(*)::integer
         FROM public.community_comments AS comment
         WHERE comment.post_id = post.id
           AND NOT COALESCE(comment.is_deleted, false)
       );

UPDATE public.community_profiles AS profile
   SET comment_count = (
         SELECT pg_catalog.count(*)::integer
         FROM public.community_comments AS comment
         WHERE comment.author_id = profile.user_id
           AND NOT COALESCE(comment.is_deleted, false)
       ),
       updated_at = pg_catalog.clock_timestamp()
 WHERE profile.comment_count IS DISTINCT FROM (
         SELECT pg_catalog.count(*)::integer
         FROM public.community_comments AS comment
         WHERE comment.author_id = profile.user_id
           AND NOT COALESCE(comment.is_deleted, false)
       );

ALTER TABLE public.community_profiles
  ALTER COLUMN comment_count SET DEFAULT 0,
  ALTER COLUMN comment_count SET NOT NULL;

-- These generic manual counters are no longer a valid mutation surface. New
-- posts and hard deletes are counted by the trigger; comment creation is
-- retired and comment deletion has its own atomic RPC.
REVOKE ALL ON FUNCTION public.community_increment_profile_count(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_decrement_profile_count(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.community_hard_delete_post(
  p_actor_id uuid,
  p_post_id uuid
)
RETURNS TABLE(
  post_id uuid,
  author_id uuid,
  deleted boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
  target_author_id uuid;
  actor_is_admin boolean := false;
  deleted_rows integer;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'community post deletion requires service_role'
      USING ERRCODE = '42501';
  END IF;

  IF p_actor_id IS NULL OR p_post_id IS NULL THEN
    RAISE EXCEPTION 'invalid community post deletion input'
      USING ERRCODE = '22023';
  END IF;

  SELECT post.author_id
    INTO target_author_id
    FROM public.community_posts AS post
   WHERE post.id = p_post_id
   FOR UPDATE;

  IF NOT FOUND THEN
    -- A retry after a committed hard delete is a safe idempotent success and
    -- reveals no former author or moderation state.
    RETURN QUERY SELECT p_post_id, NULL::uuid, false;
    RETURN;
  END IF;

  IF target_author_id IS DISTINCT FROM p_actor_id THEN
    SELECT COALESCE(profile.is_admin, false)
      INTO actor_is_admin
      FROM public.profiles AS profile
     WHERE profile.id = p_actor_id
     FOR SHARE;

    IF NOT COALESCE(actor_is_admin, false) THEN
      RAISE EXCEPTION 'community post deletion forbidden'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  DELETE FROM public.community_posts AS post
   WHERE post.id = p_post_id
     AND post.author_id = target_author_id
     AND (
       target_author_id = p_actor_id
       OR COALESCE(actor_is_admin, false)
     );

  GET DIAGNOSTICS deleted_rows = ROW_COUNT;
  IF deleted_rows <> 1 THEN
    RAISE EXCEPTION 'community post deletion conflict'
      USING ERRCODE = '40001';
  END IF;

  -- The AFTER DELETE trigger has already decremented the author's post_count;
  -- any trigger/count failure rolls this hard delete and its cascades back.
  RETURN QUERY SELECT p_post_id, target_author_id, true;
END;
$function$;

ALTER FUNCTION public.community_hard_delete_post(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.community_hard_delete_post(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_hard_delete_post(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.maintain_community_profile_post_count() IS
  'Internal trigger only: keeps community_profiles.post_count atomic with community_posts INSERT/DELETE.';
COMMENT ON FUNCTION public.maintain_community_counts_after_comment_delete() IS
  'Internal statement trigger only: decrements active-comment counts for every physical community_comments DELETE path.';
COMMENT ON FUNCTION public.community_hard_delete_post(uuid, uuid) IS
  'Service-only row-locked hard delete for the post author or a currently authorized admin; count maintenance is trigger-owned.';

DO $assert_post_lifecycle_contract$
DECLARE
  trigger_function_oid oid;
  comment_delete_function_oid oid;
  delete_function_oid oid;
BEGIN
  trigger_function_oid := pg_catalog.to_regprocedure(
    'public.maintain_community_profile_post_count()'
  );
  delete_function_oid := pg_catalog.to_regprocedure(
    'public.community_hard_delete_post(uuid,uuid)'
  );
  comment_delete_function_oid := pg_catalog.to_regprocedure(
    'public.maintain_community_counts_after_comment_delete()'
  );

  IF trigger_function_oid IS NULL OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure_row
    WHERE procedure_row.oid = trigger_function_oid
      AND procedure_row.prosecdef
      AND pg_catalog.pg_get_userbyid(procedure_row.proowner) = 'postgres'
      AND procedure_row.proconfig =
        ARRAY['search_path=""', 'row_security=off']::text[]
      AND procedure_row.pronargs = 0
      AND pg_catalog.pg_get_function_result(procedure_row.oid) = 'trigger'
      AND NOT pg_catalog.has_function_privilege(
        'service_role', procedure_row.oid, 'EXECUTE'
      )
      AND NOT pg_catalog.has_function_privilege(
        'anon', procedure_row.oid, 'EXECUTE'
      )
      AND NOT pg_catalog.has_function_privilege(
        'authenticated', procedure_row.oid, 'EXECUTE'
      )
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_POST_COUNT_TRIGGER_FUNCTION_CONTRACT_MISMATCH'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.community_posts'::pg_catalog.regclass
      AND trigger_row.tgname = 'maintain_community_profile_post_count'
      AND NOT trigger_row.tgisinternal
      AND trigger_row.tgenabled = 'O'
      AND trigger_row.tgtype = 13
      AND trigger_row.tgfoid = trigger_function_oid
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_POST_COUNT_TRIGGER_BINDING_MISMATCH'
      USING ERRCODE = '55000';
  END IF;

  IF comment_delete_function_oid IS NULL OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure_row
    WHERE procedure_row.oid = comment_delete_function_oid
      AND procedure_row.prosecdef
      AND pg_catalog.pg_get_userbyid(procedure_row.proowner) = 'postgres'
      AND procedure_row.proconfig =
        ARRAY['search_path=""', 'row_security=off']::text[]
      AND procedure_row.pronargs = 0
      AND pg_catalog.pg_get_function_result(procedure_row.oid) = 'trigger'
      AND NOT pg_catalog.has_function_privilege(
        'service_role', procedure_row.oid, 'EXECUTE'
      )
      AND NOT pg_catalog.has_function_privilege(
        'anon', procedure_row.oid, 'EXECUTE'
      )
      AND NOT pg_catalog.has_function_privilege(
        'authenticated', procedure_row.oid, 'EXECUTE'
      )
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_COMMENT_DELETE_TRIGGER_FUNCTION_CONTRACT_MISMATCH'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.community_comments'::pg_catalog.regclass
      AND trigger_row.tgname = 'maintain_community_counts_after_comment_delete'
      AND NOT trigger_row.tgisinternal
      AND trigger_row.tgenabled = 'O'
      AND trigger_row.tgtype = 8
      AND trigger_row.tgfoid = comment_delete_function_oid
      AND trigger_row.tgoldtable = 'deleted_community_comments'
      AND trigger_row.tgnewtable IS NULL
      AND trigger_row.tgnargs = 0
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_COMMENT_DELETE_TRIGGER_BINDING_MISMATCH'
      USING ERRCODE = '55000';
  END IF;

  IF delete_function_oid IS NULL OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure_row
    WHERE procedure_row.oid = delete_function_oid
      AND procedure_row.prosecdef
      AND pg_catalog.pg_get_userbyid(procedure_row.proowner) = 'postgres'
      AND procedure_row.proconfig =
        ARRAY['search_path=""', 'row_security=off']::text[]
      AND procedure_row.pronargs = 2
      AND pg_catalog.pg_get_function_arguments(procedure_row.oid) =
        'p_actor_id uuid, p_post_id uuid'
      AND pg_catalog.pg_get_function_result(procedure_row.oid) =
        'TABLE(post_id uuid, author_id uuid, deleted boolean)'
      AND pg_catalog.has_function_privilege(
        'service_role', procedure_row.oid, 'EXECUTE'
      )
      AND NOT pg_catalog.has_function_privilege(
        'anon', procedure_row.oid, 'EXECUTE'
      )
      AND NOT pg_catalog.has_function_privilege(
        'authenticated', procedure_row.oid, 'EXECUTE'
      )
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_POST_DELETE_FUNCTION_CONTRACT_MISMATCH'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure_row
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        procedure_row.proacl,
        pg_catalog.acldefault('f', procedure_row.proowner)
      )
    ) AS privilege_row
    LEFT JOIN pg_catalog.pg_roles AS granted_role
      ON granted_role.oid = privilege_row.grantee
    WHERE procedure_row.oid = trigger_function_oid
      AND (
        privilege_row.privilege_type <> 'EXECUTE'
        OR privilege_row.grantee = 0
        OR granted_role.rolname <> 'postgres'
      )
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure_row
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        procedure_row.proacl,
        pg_catalog.acldefault('f', procedure_row.proowner)
      )
    ) AS privilege_row
    LEFT JOIN pg_catalog.pg_roles AS granted_role
      ON granted_role.oid = privilege_row.grantee
    WHERE procedure_row.oid = comment_delete_function_oid
      AND (
        privilege_row.privilege_type <> 'EXECUTE'
        OR privilege_row.grantee = 0
        OR granted_role.rolname <> 'postgres'
      )
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure_row
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        procedure_row.proacl,
        pg_catalog.acldefault('f', procedure_row.proowner)
      )
    ) AS privilege_row
    LEFT JOIN pg_catalog.pg_roles AS granted_role
      ON granted_role.oid = privilege_row.grantee
    WHERE procedure_row.oid = delete_function_oid
      AND (
        privilege_row.privilege_type <> 'EXECUTE'
        OR privilege_row.grantee = 0
        OR granted_role.rolname NOT IN ('postgres', 'service_role')
      )
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_POST_LIFECYCLE_FUNCTION_ACL_NOT_EXACT'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure_row
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        procedure_row.proacl,
        pg_catalog.acldefault('f', procedure_row.proowner)
      )
    ) AS privilege_row
    JOIN pg_catalog.pg_roles AS granted_role
      ON granted_role.oid = privilege_row.grantee
    JOIN pg_catalog.pg_roles AS grantor_role
      ON grantor_role.oid = privilege_row.grantor
    WHERE procedure_row.oid = delete_function_oid
      AND granted_role.rolname = 'service_role'
      AND grantor_role.rolname = 'postgres'
      AND privilege_row.privilege_type = 'EXECUTE'
      AND NOT privilege_row.is_grantable
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_POST_DELETE_SERVICE_EXECUTE_GRANT_MISSING'
      USING ERRCODE = '55000';
  END IF;

  IF pg_catalog.has_function_privilege(
       'service_role',
       'public.community_increment_profile_count(uuid,text)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role',
       'public.community_decrement_profile_count(uuid,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'LEGACY_COMMUNITY_PROFILE_COUNTER_STILL_CALLABLE'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.community_posts AS post
    WHERE post.comment_count IS DISTINCT FROM (
      SELECT pg_catalog.count(*)::integer
      FROM public.community_comments AS comment
      WHERE comment.post_id = post.id
        AND NOT COALESCE(comment.is_deleted, false)
    )
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_POST_COMMENT_COUNT_RECONCILIATION_FAILED'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.community_profiles AS profile
    WHERE profile.post_count IS DISTINCT FROM (
      SELECT pg_catalog.count(*)::integer
      FROM public.community_posts AS post
      WHERE post.author_id = profile.user_id
    )
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_PROFILE_POST_COUNT_RECONCILIATION_FAILED'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.community_profiles AS profile
    WHERE profile.comment_count IS DISTINCT FROM (
      SELECT pg_catalog.count(*)::integer
      FROM public.community_comments AS comment
      WHERE comment.author_id = profile.user_id
        AND NOT COALESCE(comment.is_deleted, false)
    )
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_PROFILE_COMMENT_COUNT_RECONCILIATION_FAILED'
      USING ERRCODE = '55000';
  END IF;
END;
$assert_post_lifecycle_contract$;

COMMIT;
