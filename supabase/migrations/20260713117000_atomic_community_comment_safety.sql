-- Existing comments remain editable/deletable only through authenticated,
-- rate-limited server routes. This function makes deletion and both counters a
-- single row-locked transaction while re-checking actor=author inside the DB.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.community_soft_delete_comment(
  p_actor_id uuid,
  p_comment_id uuid
)
RETURNS TABLE(
  comment_id uuid,
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
  v_post_id uuid;
  v_author_id uuid;
  v_is_deleted boolean;
  v_updated_rows integer;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'community comment deletion requires service_role'
      USING ERRCODE = '42501';
  END IF;

  IF p_actor_id IS NULL OR p_comment_id IS NULL THEN
    RAISE EXCEPTION 'invalid community comment deletion input'
      USING ERRCODE = '22023';
  END IF;

  -- Resolve ownership without locking, then acquire locks in the same
  -- post -> comment -> profile order as hard post deletion and FK cascades.
  -- Every value is re-read under the comment lock before mutation.
  SELECT comment.post_id
    INTO v_post_id
    FROM public.community_comments AS comment
   WHERE comment.id = p_comment_id
     AND comment.author_id = p_actor_id;

  IF NOT FOUND THEN
    -- Do not reveal whether another author owns the supplied identifier.
    RAISE EXCEPTION 'community comment not found'
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
  FROM public.community_posts AS post
  WHERE post.id = v_post_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'community comment parent post not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT comment.post_id, comment.author_id, comment.is_deleted
    INTO v_post_id, v_author_id, v_is_deleted
    FROM public.community_comments AS comment
   WHERE comment.id = p_comment_id
     AND comment.author_id = p_actor_id
     AND comment.post_id = v_post_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'community comment not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_is_deleted, false) THEN
    RETURN QUERY SELECT p_comment_id, v_post_id, v_author_id, false;
    RETURN;
  END IF;

  UPDATE public.community_comments AS comment
     SET is_deleted = true,
         content = '삭제된 댓글입니다.',
         updated_at = pg_catalog.clock_timestamp()
   WHERE comment.id = p_comment_id
     AND comment.author_id = p_actor_id
     AND NOT COALESCE(comment.is_deleted, false);

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
  IF v_updated_rows <> 1 THEN
    RAISE EXCEPTION 'community comment deletion conflict'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.community_posts AS post
     SET comment_count = GREATEST(0, COALESCE(post.comment_count, 0) - 1)
   WHERE post.id = v_post_id;

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
  IF v_updated_rows <> 1 THEN
    RAISE EXCEPTION 'community comment parent post not found'
      USING ERRCODE = 'P0002';
  END IF;

  -- Historical comments may predate a community profile. When the profile
  -- exists, its denormalized count is updated in this same transaction.
  UPDATE public.community_profiles AS profile
     SET comment_count = GREATEST(0, COALESCE(profile.comment_count, 0) - 1),
         updated_at = pg_catalog.clock_timestamp()
   WHERE profile.user_id = v_author_id;

  RETURN QUERY SELECT p_comment_id, v_post_id, v_author_id, true;
END;
$function$;

ALTER FUNCTION public.community_soft_delete_comment(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.community_soft_delete_comment(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_soft_delete_comment(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.community_soft_delete_comment(uuid, uuid) IS
  'Service-only actor-scoped, idempotent soft deletion of one community comment with atomic post/profile count updates.';

DO $assert_comment_delete_contract$
DECLARE
  function_oid oid;
BEGIN
  function_oid := pg_catalog.to_regprocedure(
    'public.community_soft_delete_comment(uuid,uuid)'
  );

  IF function_oid IS NULL OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure_row
    WHERE procedure_row.oid = function_oid
      AND procedure_row.prosecdef
      AND pg_catalog.pg_get_userbyid(procedure_row.proowner) = 'postgres'
      AND procedure_row.proconfig =
        ARRAY['search_path=""', 'row_security=off']::text[]
      AND procedure_row.pronargs = 2
      AND pg_catalog.pg_get_function_arguments(procedure_row.oid) =
        'p_actor_id uuid, p_comment_id uuid'
      AND pg_catalog.pg_get_function_result(procedure_row.oid) =
        'TABLE(comment_id uuid, post_id uuid, author_id uuid, deleted boolean)'
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
    RAISE EXCEPTION 'COMMUNITY_COMMENT_DELETE_FUNCTION_CONTRACT_MISMATCH'
      USING ERRCODE = '55000';
  END IF;

  -- Exact function ACL: owner plus service_role only; no PUBLIC or surprise
  -- role may inherit an explicit EXECUTE grant.
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
    WHERE procedure_row.oid = function_oid
      AND (
        privilege_row.privilege_type <> 'EXECUTE'
        OR privilege_row.grantee = 0
        OR granted_role.rolname NOT IN ('postgres', 'service_role')
      )
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_COMMENT_DELETE_FUNCTION_ACL_NOT_EXACT'
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
    WHERE procedure_row.oid = function_oid
      AND granted_role.rolname = 'service_role'
      AND grantor_role.rolname = 'postgres'
      AND privilege_row.privilege_type = 'EXECUTE'
      AND NOT privilege_row.is_grantable
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_COMMENT_DELETE_SERVICE_EXECUTE_GRANT_MISSING'
      USING ERRCODE = '55000';
  END IF;
END;
$assert_comment_delete_contract$;

COMMIT;
