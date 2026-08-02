-- Close the community bookmark visibility bypass.
--
-- Bookmark membership is no longer a client-owned write. Authenticated clients
-- may read their own state, while the canonical API toggles it atomically after
-- checking the target post's current visibility.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
DECLARE
  missing_prerequisite text;
BEGIN
  SELECT pg_catalog.string_agg(
    pg_catalog.format('%I.%I', prerequisite.table_name, prerequisite.column_name),
    ', ' ORDER BY prerequisite.table_name, prerequisite.column_name
  )
  INTO missing_prerequisite
  FROM (VALUES
    ('community_bookmarks', 'id'),
    ('community_bookmarks', 'user_id'),
    ('community_bookmarks', 'post_id'),
    ('community_bookmarks', 'created_at'),
    ('community_posts', 'id'),
    ('community_posts', 'author_id'),
    ('community_posts', 'visibility'),
    ('community_posts', 'under_review'),
    ('community_posts', 'bookmark_count')
  ) AS prerequisite(table_name, column_name)
  LEFT JOIN information_schema.columns AS existing
    ON existing.table_schema = 'public'
   AND existing.table_name = prerequisite.table_name
   AND existing.column_name = prerequisite.column_name
  WHERE existing.column_name IS NULL;

  IF missing_prerequisite IS NOT NULL THEN
    RAISE EXCEPTION 'COMMUNITY_BOOKMARK_PREREQUISITE_MISSING: %', missing_prerequisite
      USING ERRCODE = '55000';
  END IF;

  IF pg_catalog.to_regprocedure('auth.uid()') IS NULL
     OR pg_catalog.to_regprocedure('auth.role()') IS NULL THEN
    RAISE EXCEPTION 'COMMUNITY_BOOKMARK_AUTH_HELPER_MISSING'
      USING ERRCODE = '55000';
  END IF;
END;
$preflight$;

ALTER TABLE public.community_bookmarks ENABLE ROW LEVEL SECURITY;
LOCK TABLE
  public.community_bookmarks,
  public.community_posts
IN SHARE ROW EXCLUSIVE MODE;

DO $drop_existing_policies$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT policy.policyname
    FROM pg_catalog.pg_policies AS policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename = 'community_bookmarks'
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY %I ON public.community_bookmarks',
      policy_row.policyname
    );
  END LOOP;
END;
$drop_existing_policies$;

CREATE POLICY community_bookmarks_select_own
  ON public.community_bookmarks
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL PRIVILEGES ON TABLE public.community_bookmarks
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE INSERT (id, user_id, post_id, created_at),
  UPDATE (id, user_id, post_id, created_at),
  REFERENCES (id, user_id, post_id, created_at)
  ON TABLE public.community_bookmarks
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.community_bookmarks TO authenticated;

CREATE OR REPLACE FUNCTION public.community_toggle_bookmark(
  p_user_id uuid,
  p_post_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $community_toggle_bookmark$
DECLARE
  v_author_id uuid;
  v_visibility text;
  v_under_review boolean;
  v_readable boolean;
  v_deleted_id uuid;
  v_bookmarked boolean;
  v_bookmark_count integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL OR p_post_id IS NULL THEN
    RAISE EXCEPTION 'invalid bookmark target'
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
  WHERE post.id = p_post_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'community_post_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  v_readable := CASE
    WHEN v_under_review IS TRUE THEN v_author_id = p_user_id
    WHEN v_visibility = 'public' THEN true
    WHEN v_visibility = 'members' THEN true
    WHEN v_visibility = 'draft' THEN v_author_id = p_user_id
    ELSE false
  END;

  IF v_readable IS NOT TRUE THEN
    RAISE EXCEPTION 'community_post_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  DELETE FROM public.community_bookmarks AS bookmark
  WHERE bookmark.user_id = p_user_id
    AND bookmark.post_id = p_post_id
  RETURNING bookmark.id INTO v_deleted_id;

  IF v_deleted_id IS NULL THEN
    INSERT INTO public.community_bookmarks (user_id, post_id)
    VALUES (p_user_id, p_post_id);
    v_bookmarked := true;
  ELSE
    v_bookmarked := false;
  END IF;

  SELECT pg_catalog.count(*)::integer
  INTO v_bookmark_count
  FROM public.community_bookmarks AS bookmark
  WHERE bookmark.post_id = p_post_id;

  UPDATE public.community_posts AS post
  -- A DELETE schedules the deferred cascade-safe counter trigger. Preserve the
  -- pre-delete value until COMMIT so that trigger performs the one decrement;
  -- the value returned to the caller is still the exact post-delete count.
  SET bookmark_count = v_bookmark_count + CASE WHEN v_bookmarked THEN 0 ELSE 1 END
  WHERE post.id = p_post_id;

  RETURN pg_catalog.jsonb_build_object(
    'bookmarked', v_bookmarked,
    'bookmark_count', v_bookmark_count
  );
END;
$community_toggle_bookmark$;

-- Auth deletion cascades directly through community_bookmarks without calling
-- the toggle RPC. Keep the denormalized counter exact for that path as well.
-- Defer the trigger until the deleting statement/transaction has completed so
-- a post deletion can cascade through bookmarks without trying to update the
-- same parent row while PostgreSQL is deleting it.
CREATE OR REPLACE FUNCTION public.community_bookmark_counter_after_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $community_bookmark_counter_after_delete$
BEGIN
  UPDATE public.community_posts AS post
  SET bookmark_count = GREATEST(post.bookmark_count - 1, 0)
  WHERE post.id = OLD.post_id;

  RETURN OLD;
END;
$community_bookmark_counter_after_delete$;

ALTER FUNCTION public.community_toggle_bookmark(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.community_bookmark_counter_after_delete() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.community_toggle_bookmark(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.community_toggle_bookmark(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.community_toggle_bookmark(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.community_toggle_bookmark(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.community_bookmark_counter_after_delete()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_community_bookmark_counter_after_delete
  ON public.community_bookmarks;
CREATE CONSTRAINT TRIGGER trg_community_bookmark_counter_after_delete
AFTER DELETE ON public.community_bookmarks
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.community_bookmark_counter_after_delete();

-- Repair counter drift that may already exist before the cascade trigger is
-- installed. The table locks above make this a coherent snapshot.
UPDATE public.community_posts AS post
SET bookmark_count = (
  SELECT pg_catalog.count(*)::integer
  FROM public.community_bookmarks AS bookmark
  WHERE bookmark.post_id = post.id
)
WHERE post.bookmark_count IS DISTINCT FROM (
  SELECT pg_catalog.count(*)::integer
  FROM public.community_bookmarks AS bookmark
  WHERE bookmark.post_id = post.id
);

DO $postcondition$
DECLARE
  column_name text;
  write_policy_count integer;
  policy_count integer;
  select_policy_name text;
  select_policy_command text;
  select_policy_roles name[];
  select_policy_qual text;
  select_policy_with_check text;
  rls_enabled boolean;
  function_owner text;
  function_is_security_definer boolean;
  function_config text[];
  delete_function_owner text;
  delete_function_is_security_definer boolean;
  delete_function_config text[];
  delete_trigger_count integer;
  delete_trigger_type smallint;
  delete_trigger_function oid;
  delete_trigger_is_deferrable boolean;
  delete_trigger_is_initially_deferred boolean;
BEGIN
  SELECT relation.relrowsecurity
  INTO rls_enabled
  FROM pg_catalog.pg_class AS relation
  WHERE relation.oid = 'public.community_bookmarks'::pg_catalog.regclass;

  IF rls_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'COMMUNITY_BOOKMARK_RLS_DISABLED'
      USING ERRCODE = '55000';
  END IF;

  IF NOT pg_catalog.has_table_privilege(
    'authenticated', 'public.community_bookmarks', 'SELECT'
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_BOOKMARK_AUTHENTICATED_SELECT_MISSING'
      USING ERRCODE = '55000';
  END IF;

  IF pg_catalog.has_table_privilege(
    'authenticated', 'public.community_bookmarks',
    'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
  ) OR pg_catalog.has_table_privilege(
    'service_role', 'public.community_bookmarks',
    'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
  ) OR pg_catalog.has_table_privilege(
    'anon', 'public.community_bookmarks',
    'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_BOOKMARK_TABLE_PRIVILEGE_REMAINS'
      USING ERRCODE = '55000';
  END IF;

  FOREACH column_name IN ARRAY ARRAY['id', 'user_id', 'post_id', 'created_at']
  LOOP
    IF pg_catalog.has_column_privilege(
      'authenticated', 'public.community_bookmarks', column_name, 'INSERT, UPDATE, REFERENCES'
    ) OR pg_catalog.has_column_privilege(
      'service_role', 'public.community_bookmarks', column_name, 'INSERT, UPDATE, REFERENCES'
    ) OR pg_catalog.has_column_privilege(
      'anon', 'public.community_bookmarks', column_name, 'INSERT, UPDATE, REFERENCES'
    ) THEN
      RAISE EXCEPTION 'COMMUNITY_BOOKMARK_COLUMN_WRITE_PRIVILEGE_REMAINS: %', column_name
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  SELECT pg_catalog.count(*)::integer
  INTO write_policy_count
  FROM pg_catalog.pg_policies AS policy
  WHERE policy.schemaname = 'public'
    AND policy.tablename = 'community_bookmarks'
    AND policy.cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE');

  IF write_policy_count <> 0 THEN
    RAISE EXCEPTION 'COMMUNITY_BOOKMARK_WRITE_POLICY_REMAINS: %', write_policy_count
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.count(*)::integer
  INTO policy_count
  FROM pg_catalog.pg_policies AS policy
  WHERE policy.schemaname = 'public'
    AND policy.tablename = 'community_bookmarks';

  SELECT
    policy.policyname,
    policy.cmd,
    policy.roles,
    policy.qual,
    policy.with_check
  INTO
    select_policy_name,
    select_policy_command,
    select_policy_roles,
    select_policy_qual,
    select_policy_with_check
  FROM pg_catalog.pg_policies AS policy
  WHERE policy.schemaname = 'public'
    AND policy.tablename = 'community_bookmarks';

  IF policy_count <> 1
     OR select_policy_name IS DISTINCT FROM 'community_bookmarks_select_own'
     OR select_policy_command IS DISTINCT FROM 'SELECT'
     OR select_policy_roles IS DISTINCT FROM ARRAY['authenticated']::name[]
     OR pg_catalog.regexp_replace(
       pg_catalog.lower(select_policy_qual),
       '[[:space:]()]',
       '',
       'g'
     ) IS DISTINCT FROM 'user_id=auth.uid'
     OR select_policy_with_check IS NOT NULL THEN
    RAISE EXCEPTION 'COMMUNITY_BOOKMARK_SELECT_POLICY_INVALID'
      USING ERRCODE = '55000';
  END IF;

  IF pg_catalog.has_function_privilege(
    'anon', 'public.community_toggle_bookmark(uuid, uuid)', 'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'authenticated', 'public.community_toggle_bookmark(uuid, uuid)', 'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    'service_role', 'public.community_toggle_bookmark(uuid, uuid)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_BOOKMARK_FUNCTION_GRANT_INVALID'
      USING ERRCODE = '55000';
  END IF;

  SELECT
    pg_catalog.pg_get_userbyid(proc.proowner),
    proc.prosecdef,
    proc.proconfig
  INTO function_owner, function_is_security_definer, function_config
  FROM pg_catalog.pg_proc AS proc
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = proc.pronamespace
  WHERE namespace.nspname = 'public'
    AND proc.proname = 'community_toggle_bookmark'
    AND pg_catalog.pg_get_function_identity_arguments(proc.oid) = 'p_user_id uuid, p_post_id uuid';

  IF function_owner IS DISTINCT FROM 'postgres'
     OR function_is_security_definer IS NOT TRUE
     OR function_config IS DISTINCT FROM ARRAY['search_path=""']::text[] THEN
    RAISE EXCEPTION 'COMMUNITY_BOOKMARK_FUNCTION_AUTHORITY_INVALID'
      USING ERRCODE = '55000';
  END IF;

  SELECT
    pg_catalog.pg_get_userbyid(proc.proowner),
    proc.prosecdef,
    proc.proconfig
  INTO
    delete_function_owner,
    delete_function_is_security_definer,
    delete_function_config
  FROM pg_catalog.pg_proc AS proc
  WHERE proc.oid = pg_catalog.to_regprocedure(
    'public.community_bookmark_counter_after_delete()'
  );

  IF delete_function_owner IS DISTINCT FROM 'postgres'
     OR delete_function_is_security_definer IS NOT TRUE
     OR delete_function_config IS DISTINCT FROM ARRAY['search_path=""']::text[]
     OR pg_catalog.has_function_privilege(
       'anon', 'public.community_bookmark_counter_after_delete()', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated', 'public.community_bookmark_counter_after_delete()', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role', 'public.community_bookmark_counter_after_delete()', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'COMMUNITY_BOOKMARK_DELETE_FUNCTION_INVALID'
      USING ERRCODE = '55000';
  END IF;

  SELECT
    pg_catalog.count(*)::integer,
    pg_catalog.min(trigger.tgtype)::smallint,
    pg_catalog.min(trigger.tgfoid),
    pg_catalog.bool_and(trigger.tgdeferrable),
    pg_catalog.bool_and(trigger.tginitdeferred)
  INTO
    delete_trigger_count,
    delete_trigger_type,
    delete_trigger_function,
    delete_trigger_is_deferrable,
    delete_trigger_is_initially_deferred
  FROM pg_catalog.pg_trigger AS trigger
  WHERE trigger.tgrelid = 'public.community_bookmarks'::pg_catalog.regclass
    AND trigger.tgname = 'trg_community_bookmark_counter_after_delete'
    AND trigger.tgisinternal IS FALSE;

  -- ROW (1) + DELETE (8) = 9; AFTER contributes no BEFORE bit.
  IF delete_trigger_count <> 1
     OR delete_trigger_type IS DISTINCT FROM 9::smallint
     OR delete_trigger_function IS DISTINCT FROM pg_catalog.to_regprocedure(
       'public.community_bookmark_counter_after_delete()'
     )
     OR delete_trigger_is_deferrable IS NOT TRUE
     OR delete_trigger_is_initially_deferred IS NOT TRUE THEN
    RAISE EXCEPTION 'COMMUNITY_BOOKMARK_DELETE_TRIGGER_INVALID'
      USING ERRCODE = '55000';
  END IF;
END;
$postcondition$;

COMMIT;
