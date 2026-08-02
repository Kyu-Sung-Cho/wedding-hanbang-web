-- Keep denormalized community comment counters exact across every lifecycle.
--
-- Comments can disappear without passing through the application when either
-- auth.users, a parent comment, or a post cascades a DELETE. The application
-- previously performed legacy counter writes after creating or soft-deleting a
-- comment. Deferred row triggers cover cascades safely, while the two guard
-- triggers keep rolling deployments and manual repairs pinned to the
-- authoritative active comment rows instead of double-counting them.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $community_comment_counter_preflight$
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
    RAISE EXCEPTION 'COMMUNITY_COMMENT_COUNTER_REQUIRED_ROLE_MISSING'
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.string_agg(
    pg_catalog.format('%I.%I', prerequisite.table_name, prerequisite.column_name),
    ', ' ORDER BY prerequisite.table_name, prerequisite.column_name
  )
  INTO missing_prerequisite
  FROM (VALUES
    ('community_comments', 'id'),
    ('community_comments', 'post_id'),
    ('community_comments', 'parent_id'),
    ('community_comments', 'author_id'),
    ('community_comments', 'is_deleted'),
    ('community_posts', 'id'),
    ('community_posts', 'comment_count'),
    ('community_profiles', 'user_id'),
    ('community_profiles', 'comment_count')
  ) AS prerequisite(table_name, column_name)
  LEFT JOIN information_schema.columns AS existing
    ON existing.table_schema = 'public'
   AND existing.table_name = prerequisite.table_name
   AND existing.column_name = prerequisite.column_name
  WHERE existing.column_name IS NULL;

  IF missing_prerequisite IS NOT NULL THEN
    RAISE EXCEPTION 'COMMUNITY_COMMENT_COUNTER_PREREQUISITE_MISSING: %',
      missing_prerequisite
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_record
    JOIN pg_catalog.pg_attribute AS source_column
      ON source_column.attrelid = constraint_record.conrelid
     AND constraint_record.conkey =
       ARRAY[source_column.attnum]::smallint[]
    JOIN pg_catalog.pg_attribute AS target_column
      ON target_column.attrelid = constraint_record.confrelid
     AND constraint_record.confkey =
       ARRAY[target_column.attnum]::smallint[]
    WHERE constraint_record.contype = 'f'
      AND constraint_record.conrelid =
        'public.community_comments'::pg_catalog.regclass
      AND constraint_record.confrelid =
        'auth.users'::pg_catalog.regclass
      AND source_column.attname = 'author_id'
      AND target_column.attname = 'id'
      AND constraint_record.confdeltype = 'c'
      AND constraint_record.convalidated
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_COMMENT_AUTHOR_CASCADE_FK_INVALID'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_record
    JOIN pg_catalog.pg_attribute AS source_column
      ON source_column.attrelid = constraint_record.conrelid
     AND constraint_record.conkey =
       ARRAY[source_column.attnum]::smallint[]
    JOIN pg_catalog.pg_attribute AS target_column
      ON target_column.attrelid = constraint_record.confrelid
     AND constraint_record.confkey =
       ARRAY[target_column.attnum]::smallint[]
    WHERE constraint_record.contype = 'f'
      AND constraint_record.conrelid =
        'public.community_comments'::pg_catalog.regclass
      AND constraint_record.confrelid =
        'public.community_posts'::pg_catalog.regclass
      AND source_column.attname = 'post_id'
      AND target_column.attname = 'id'
      AND constraint_record.confdeltype = 'c'
      AND constraint_record.convalidated
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_COMMENT_POST_CASCADE_FK_INVALID'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_record
    JOIN pg_catalog.pg_attribute AS source_column
      ON source_column.attrelid = constraint_record.conrelid
     AND constraint_record.conkey =
       ARRAY[source_column.attnum]::smallint[]
    JOIN pg_catalog.pg_attribute AS target_column
      ON target_column.attrelid = constraint_record.confrelid
     AND constraint_record.confkey =
       ARRAY[target_column.attnum]::smallint[]
    WHERE constraint_record.contype = 'f'
      AND constraint_record.conrelid =
        'public.community_comments'::pg_catalog.regclass
      AND constraint_record.confrelid =
        'public.community_comments'::pg_catalog.regclass
      AND source_column.attname = 'parent_id'
      AND target_column.attname = 'id'
      AND constraint_record.confdeltype = 'c'
      AND constraint_record.convalidated
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_COMMENT_PARENT_CASCADE_FK_INVALID'
      USING ERRCODE = '55000';
  END IF;
END;
$community_comment_counter_preflight$;

-- Hold one coherent snapshot while replacing trigger code and repairing any
-- drift. SHARE ROW EXCLUSIVE blocks concurrent writes without blocking reads.
LOCK TABLE
  public.community_comments,
  public.community_posts,
  public.community_profiles
IN SHARE ROW EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION public.community_comment_counter_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $community_comment_counter_sync$
DECLARE
  old_is_active boolean;
  new_is_active boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_deleted IS NOT TRUE THEN
      UPDATE public.community_posts AS post
      SET comment_count = COALESCE(post.comment_count, 0) + 1
      WHERE post.id = NEW.post_id;

      UPDATE public.community_profiles AS profile
      SET comment_count = COALESCE(profile.comment_count, 0) + 1
      WHERE profile.user_id = NEW.author_id;
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.is_deleted IS NOT TRUE THEN
      UPDATE public.community_posts AS post
      SET comment_count = GREATEST(COALESCE(post.comment_count, 0) - 1, 0)
      WHERE post.id = OLD.post_id;

      UPDATE public.community_profiles AS profile
      SET comment_count = GREATEST(COALESCE(profile.comment_count, 0) - 1, 0)
      WHERE profile.user_id = OLD.author_id;
    END IF;

    RETURN OLD;
  END IF;

  old_is_active := OLD.is_deleted IS NOT TRUE;
  new_is_active := NEW.is_deleted IS NOT TRUE;

  IF old_is_active
     AND (
       NOT new_is_active
       OR OLD.post_id IS DISTINCT FROM NEW.post_id
     ) THEN
    UPDATE public.community_posts AS post
    SET comment_count = GREATEST(COALESCE(post.comment_count, 0) - 1, 0)
    WHERE post.id = OLD.post_id;
  END IF;

  IF new_is_active
     AND (
       NOT old_is_active
       OR OLD.post_id IS DISTINCT FROM NEW.post_id
     ) THEN
    UPDATE public.community_posts AS post
    SET comment_count = COALESCE(post.comment_count, 0) + 1
    WHERE post.id = NEW.post_id;
  END IF;

  IF old_is_active
     AND (
       NOT new_is_active
       OR OLD.author_id IS DISTINCT FROM NEW.author_id
     ) THEN
    UPDATE public.community_profiles AS profile
    SET comment_count = GREATEST(COALESCE(profile.comment_count, 0) - 1, 0)
    WHERE profile.user_id = OLD.author_id;
  END IF;

  IF new_is_active
     AND (
       NOT old_is_active
       OR OLD.author_id IS DISTINCT FROM NEW.author_id
     ) THEN
    UPDATE public.community_profiles AS profile
    SET comment_count = COALESCE(profile.comment_count, 0) + 1
    WHERE profile.user_id = NEW.author_id;
  END IF;

  RETURN NEW;
END;
$community_comment_counter_sync$;

CREATE OR REPLACE FUNCTION public.community_post_comment_counter_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $community_post_comment_counter_guard$
BEGIN
  -- A top-level UPDATE is a legacy/manual counter write. Replace it with the
  -- authoritative count. An UPDATE issued by the comment lifecycle trigger is
  -- nested (depth > 1) and must retain its atomic arithmetic delta.
  IF pg_catalog.pg_trigger_depth() = 1 THEN
    SELECT pg_catalog.count(*)::integer
    INTO NEW.comment_count
    FROM public.community_comments AS comment
    WHERE comment.post_id = OLD.id
      AND comment.is_deleted IS NOT TRUE;
  END IF;

  RETURN NEW;
END;
$community_post_comment_counter_guard$;

CREATE OR REPLACE FUNCTION public.community_profile_comment_counter_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $community_profile_comment_counter_guard$
BEGIN
  -- A profile can be created after comments already exist (for example after a
  -- partial profile-initialization failure). Always derive its initial counter
  -- from source rows. For UPDATE, retain nested lifecycle deltas and normalize
  -- only top-level legacy/manual writes.
  IF TG_OP = 'INSERT' OR pg_catalog.pg_trigger_depth() = 1 THEN
    SELECT pg_catalog.count(*)::integer
    INTO NEW.comment_count
    FROM public.community_comments AS comment
    WHERE comment.author_id = NEW.user_id
      AND comment.is_deleted IS NOT TRUE;
  END IF;

  RETURN NEW;
END;
$community_profile_comment_counter_guard$;

ALTER FUNCTION public.community_comment_counter_sync()
  OWNER TO postgres;
ALTER FUNCTION public.community_post_comment_counter_guard()
  OWNER TO postgres;
ALTER FUNCTION public.community_profile_comment_counter_guard()
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.community_comment_counter_sync()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_post_comment_counter_guard()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_profile_comment_counter_guard()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_community_comment_counter_sync
  ON public.community_comments;
CREATE CONSTRAINT TRIGGER trg_community_comment_counter_sync
AFTER INSERT OR UPDATE OR DELETE ON public.community_comments
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.community_comment_counter_sync();

DROP TRIGGER IF EXISTS trg_community_post_comment_counter_guard
  ON public.community_posts;
CREATE TRIGGER trg_community_post_comment_counter_guard
BEFORE UPDATE OF comment_count ON public.community_posts
FOR EACH ROW EXECUTE FUNCTION public.community_post_comment_counter_guard();

DROP TRIGGER IF EXISTS trg_community_profile_comment_counter_guard
  ON public.community_profiles;
CREATE TRIGGER trg_community_profile_comment_counter_guard
BEFORE INSERT OR UPDATE OF comment_count ON public.community_profiles
FOR EACH ROW EXECUTE FUNCTION public.community_profile_comment_counter_guard();

-- Repair historical drift under the locks acquired above. NULL is treated as
-- active to match the lifecycle trigger's fail-safe `IS NOT TRUE` predicate.
UPDATE public.community_posts AS post
SET comment_count = (
  SELECT pg_catalog.count(*)::integer
  FROM public.community_comments AS comment
  WHERE comment.post_id = post.id
    AND comment.is_deleted IS NOT TRUE
)
WHERE post.comment_count IS DISTINCT FROM (
  SELECT pg_catalog.count(*)::integer
  FROM public.community_comments AS comment
  WHERE comment.post_id = post.id
    AND comment.is_deleted IS NOT TRUE
);

UPDATE public.community_profiles AS profile
SET comment_count = (
  SELECT pg_catalog.count(*)::integer
  FROM public.community_comments AS comment
  WHERE comment.author_id = profile.user_id
    AND comment.is_deleted IS NOT TRUE
)
WHERE profile.comment_count IS DISTINCT FROM (
  SELECT pg_catalog.count(*)::integer
  FROM public.community_comments AS comment
  WHERE comment.author_id = profile.user_id
    AND comment.is_deleted IS NOT TRUE
);

DO $community_comment_counter_postcondition$
DECLARE
  function_signature text;
  function_owner text;
  function_is_security_definer boolean;
  function_config text[];
  unexpected_grantee text;
  trigger_count integer;
  trigger_type smallint;
  trigger_function oid;
  trigger_is_deferrable boolean;
  trigger_is_initially_deferred boolean;
  guard_definition text;
BEGIN
  FOREACH function_signature IN ARRAY ARRAY[
    'public.community_comment_counter_sync()',
    'public.community_post_comment_counter_guard()',
    'public.community_profile_comment_counter_guard()'
  ]::text[]
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
    WHERE proc.oid = pg_catalog.to_regprocedure(function_signature);

    IF function_owner IS DISTINCT FROM 'postgres'
       OR function_is_security_definer IS NOT TRUE
       OR function_config IS DISTINCT FROM ARRAY['search_path=""']::text[] THEN
      RAISE EXCEPTION 'COMMUNITY_COMMENT_COUNTER_FUNCTION_INVALID: %',
        function_signature
        USING ERRCODE = '55000';
    END IF;

    IF pg_catalog.has_function_privilege(
         'anon', function_signature, 'EXECUTE'
       )
       OR pg_catalog.has_function_privilege(
         'authenticated', function_signature, 'EXECUTE'
       )
       OR pg_catalog.has_function_privilege(
         'service_role', function_signature, 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'COMMUNITY_COMMENT_COUNTER_FUNCTION_GRANT_INVALID: %',
        function_signature
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
    WHERE proc.oid = pg_catalog.to_regprocedure(function_signature)
      AND privilege.privilege_type = 'EXECUTE'
      AND privilege.grantee <> proc.proowner;

    IF unexpected_grantee IS NOT NULL THEN
      RAISE EXCEPTION 'COMMUNITY_COMMENT_COUNTER_UNEXPECTED_GRANTEE: % -> %',
        function_signature,
        unexpected_grantee
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  SELECT
    pg_catalog.count(*)::integer,
    pg_catalog.min(trigger.tgtype)::smallint,
    pg_catalog.min(trigger.tgfoid),
    pg_catalog.bool_and(trigger.tgdeferrable),
    pg_catalog.bool_and(trigger.tginitdeferred)
  INTO
    trigger_count,
    trigger_type,
    trigger_function,
    trigger_is_deferrable,
    trigger_is_initially_deferred
  FROM pg_catalog.pg_trigger AS trigger
  WHERE trigger.tgrelid =
      'public.community_comments'::pg_catalog.regclass
    AND trigger.tgname = 'trg_community_comment_counter_sync'
    AND trigger.tgisinternal IS FALSE;

  -- ROW (1) + INSERT (4) + DELETE (8) + UPDATE (16) = 29.
  IF trigger_count <> 1
     OR trigger_type IS DISTINCT FROM 29::smallint
     OR trigger_function IS DISTINCT FROM pg_catalog.to_regprocedure(
       'public.community_comment_counter_sync()'
     )
     OR trigger_is_deferrable IS NOT TRUE
     OR trigger_is_initially_deferred IS NOT TRUE THEN
    RAISE EXCEPTION 'COMMUNITY_COMMENT_COUNTER_TRIGGER_INVALID'
      USING ERRCODE = '55000';
  END IF;

  SELECT
    pg_catalog.count(*)::integer,
    pg_catalog.min(trigger.tgtype)::smallint,
    pg_catalog.min(trigger.tgfoid),
    pg_catalog.min(pg_catalog.pg_get_triggerdef(trigger.oid))
  INTO trigger_count, trigger_type, trigger_function, guard_definition
  FROM pg_catalog.pg_trigger AS trigger
  WHERE trigger.tgrelid = 'public.community_posts'::pg_catalog.regclass
    AND trigger.tgname = 'trg_community_post_comment_counter_guard'
    AND trigger.tgisinternal IS FALSE;

  IF trigger_count <> 1
     OR trigger_type IS DISTINCT FROM 19::smallint
     OR trigger_function IS DISTINCT FROM pg_catalog.to_regprocedure(
       'public.community_post_comment_counter_guard()'
     )
     OR pg_catalog.strpos(
       guard_definition, 'UPDATE OF comment_count'
     ) = 0 THEN
    RAISE EXCEPTION 'COMMUNITY_POST_COMMENT_COUNTER_GUARD_INVALID'
      USING ERRCODE = '55000';
  END IF;

  SELECT
    pg_catalog.count(*)::integer,
    pg_catalog.min(trigger.tgtype)::smallint,
    pg_catalog.min(trigger.tgfoid),
    pg_catalog.min(pg_catalog.pg_get_triggerdef(trigger.oid))
  INTO trigger_count, trigger_type, trigger_function, guard_definition
  FROM pg_catalog.pg_trigger AS trigger
  WHERE trigger.tgrelid = 'public.community_profiles'::pg_catalog.regclass
    AND trigger.tgname = 'trg_community_profile_comment_counter_guard'
    AND trigger.tgisinternal IS FALSE;

  IF trigger_count <> 1
     OR trigger_type IS DISTINCT FROM 23::smallint
     OR trigger_function IS DISTINCT FROM pg_catalog.to_regprocedure(
       'public.community_profile_comment_counter_guard()'
     )
     OR pg_catalog.strpos(
       guard_definition, 'UPDATE OF comment_count'
     ) = 0 THEN
    RAISE EXCEPTION 'COMMUNITY_PROFILE_COMMENT_COUNTER_GUARD_INVALID'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.community_posts AS post
    WHERE post.comment_count IS DISTINCT FROM (
      SELECT pg_catalog.count(*)::integer
      FROM public.community_comments AS comment
      WHERE comment.post_id = post.id
        AND comment.is_deleted IS NOT TRUE
    )
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_POST_COMMENT_COUNTER_BACKFILL_INVALID'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.community_profiles AS profile
    WHERE profile.comment_count IS DISTINCT FROM (
      SELECT pg_catalog.count(*)::integer
      FROM public.community_comments AS comment
      WHERE comment.author_id = profile.user_id
        AND comment.is_deleted IS NOT TRUE
    )
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_PROFILE_COMMENT_COUNTER_BACKFILL_INVALID'
      USING ERRCODE = '55000';
  END IF;
END;
$community_comment_counter_postcondition$;

COMMENT ON FUNCTION public.community_comment_counter_sync() IS
  'Maintains active post/profile comment counters across insert, soft-delete, relink, and cascade delete transitions.';
COMMENT ON FUNCTION public.community_post_comment_counter_guard() IS
  'Normalizes top-level legacy post comment_count writes while allowing nested lifecycle deltas.';
COMMENT ON FUNCTION public.community_profile_comment_counter_guard() IS
  'Derives profile comment_count on insert and normalizes top-level legacy writes while allowing nested lifecycle deltas.';

COMMIT;
