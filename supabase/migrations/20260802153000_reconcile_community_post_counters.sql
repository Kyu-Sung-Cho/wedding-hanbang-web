-- Make community_profiles.post_count an exact derivative of community_posts.
-- This closes partial-failure drift between the post write and the legacy
-- follow-up RPC used by older application revisions, including administrator
-- deletes and auth-user cascades.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $community_post_counter_preflight$
DECLARE
  missing_prerequisite text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'COMMUNITY_POST_COUNTER_REQUIRED_ROLE_MISSING'
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
    ('community_profiles', 'user_id'),
    ('community_profiles', 'post_count')
  ) AS prerequisite(table_name, column_name)
  LEFT JOIN information_schema.columns AS existing
    ON existing.table_schema = 'public'
   AND existing.table_name = prerequisite.table_name
   AND existing.column_name = prerequisite.column_name
  WHERE existing.column_name IS NULL;

  IF missing_prerequisite IS NOT NULL THEN
    RAISE EXCEPTION 'COMMUNITY_POST_COUNTER_PREREQUISITE_MISSING: %',
      missing_prerequisite
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_record
    JOIN pg_catalog.pg_attribute AS source_column
      ON source_column.attrelid = constraint_record.conrelid
     AND constraint_record.conkey = ARRAY[source_column.attnum]::smallint[]
    JOIN pg_catalog.pg_attribute AS target_column
      ON target_column.attrelid = constraint_record.confrelid
     AND constraint_record.confkey = ARRAY[target_column.attnum]::smallint[]
    WHERE constraint_record.contype = 'f'
      AND constraint_record.conrelid = 'public.community_posts'::pg_catalog.regclass
      AND constraint_record.confrelid = 'auth.users'::pg_catalog.regclass
      AND source_column.attname = 'author_id'
      AND target_column.attname = 'id'
      AND constraint_record.confdeltype = 'c'
      AND constraint_record.convalidated
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_POST_AUTHOR_CASCADE_FK_INVALID'
      USING ERRCODE = '55000';
  END IF;
END;
$community_post_counter_preflight$;

LOCK TABLE public.community_posts, public.community_profiles
IN SHARE ROW EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION public.community_post_counter_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $community_post_counter_sync$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.community_profiles AS profile
    SET post_count = COALESCE(profile.post_count, 0) + 1
    WHERE profile.user_id = NEW.author_id;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    UPDATE public.community_profiles AS profile
    SET post_count = GREATEST(COALESCE(profile.post_count, 0) - 1, 0)
    WHERE profile.user_id = OLD.author_id;
    RETURN OLD;
  END IF;

  IF OLD.author_id IS DISTINCT FROM NEW.author_id THEN
    UPDATE public.community_profiles AS profile
    SET post_count = GREATEST(COALESCE(profile.post_count, 0) - 1, 0)
    WHERE profile.user_id = OLD.author_id;

    UPDATE public.community_profiles AS profile
    SET post_count = COALESCE(profile.post_count, 0) + 1
    WHERE profile.user_id = NEW.author_id;
  END IF;

  RETURN NEW;
END;
$community_post_counter_sync$;

CREATE OR REPLACE FUNCTION public.community_profile_post_counter_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $community_profile_post_counter_guard$
BEGIN
  -- A profile can be created after posts already exist. Always derive its
  -- initial counter from source rows. For UPDATE, normalize top-level legacy
  -- writes while preserving nested lifecycle deltas.
  IF TG_OP = 'INSERT' OR pg_catalog.pg_trigger_depth() = 1 THEN
    SELECT pg_catalog.count(*)::integer
    INTO NEW.post_count
    FROM public.community_posts AS post
    WHERE post.author_id = NEW.user_id;
  END IF;

  RETURN NEW;
END;
$community_profile_post_counter_guard$;

ALTER FUNCTION public.community_post_counter_sync() OWNER TO postgres;
ALTER FUNCTION public.community_profile_post_counter_guard() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.community_post_counter_sync()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_profile_post_counter_guard()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_community_post_counter_sync
  ON public.community_posts;
CREATE CONSTRAINT TRIGGER trg_community_post_counter_sync
AFTER INSERT OR UPDATE OF author_id OR DELETE ON public.community_posts
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.community_post_counter_sync();

DROP TRIGGER IF EXISTS trg_community_profile_post_counter_guard
  ON public.community_profiles;
CREATE TRIGGER trg_community_profile_post_counter_guard
BEFORE INSERT OR UPDATE OF post_count ON public.community_profiles
FOR EACH ROW EXECUTE FUNCTION public.community_profile_post_counter_guard();

UPDATE public.community_profiles AS profile
SET post_count = (
  SELECT pg_catalog.count(*)::integer
  FROM public.community_posts AS post
  WHERE post.author_id = profile.user_id
)
WHERE profile.post_count IS DISTINCT FROM (
  SELECT pg_catalog.count(*)::integer
  FROM public.community_posts AS post
  WHERE post.author_id = profile.user_id
);

DO $community_post_counter_postcondition$
DECLARE
  function_signature text;
  function_record pg_catalog.pg_proc%ROWTYPE;
  trigger_record pg_catalog.pg_trigger%ROWTYPE;
BEGIN
  FOREACH function_signature IN ARRAY ARRAY[
    'public.community_post_counter_sync()',
    'public.community_profile_post_counter_guard()'
  ]::text[]
  LOOP
    SELECT * INTO function_record
    FROM pg_catalog.pg_proc AS proc
    WHERE proc.oid = pg_catalog.to_regprocedure(function_signature);

    IF NOT FOUND
       OR pg_catalog.pg_get_userbyid(function_record.proowner) <> 'postgres'
       OR function_record.prosecdef IS NOT TRUE
       OR function_record.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
       OR pg_catalog.has_function_privilege('anon', function_signature, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', function_signature, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', function_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'COMMUNITY_POST_COUNTER_FUNCTION_INVALID: %', function_signature
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  SELECT * INTO trigger_record
  FROM pg_catalog.pg_trigger AS trigger
  WHERE trigger.tgrelid = 'public.community_posts'::pg_catalog.regclass
    AND trigger.tgname = 'trg_community_post_counter_sync'
    AND trigger.tgisinternal IS FALSE;

  -- ROW (1) + INSERT (4) + DELETE (8) + UPDATE (16) = 29.
  IF NOT FOUND
     OR trigger_record.tgtype <> 29
     OR trigger_record.tgfoid <> pg_catalog.to_regprocedure(
       'public.community_post_counter_sync()'
     )
     OR trigger_record.tgdeferrable IS NOT TRUE
     OR trigger_record.tginitdeferred IS NOT TRUE
     OR pg_catalog.strpos(
       pg_catalog.pg_get_triggerdef(trigger_record.oid),
       'UPDATE OF author_id'
     ) = 0 THEN
    RAISE EXCEPTION 'COMMUNITY_POST_COUNTER_TRIGGER_INVALID'
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO trigger_record
  FROM pg_catalog.pg_trigger AS trigger
  WHERE trigger.tgrelid = 'public.community_profiles'::pg_catalog.regclass
    AND trigger.tgname = 'trg_community_profile_post_counter_guard'
    AND trigger.tgisinternal IS FALSE;

  IF NOT FOUND
     OR trigger_record.tgtype <> 23
     OR trigger_record.tgfoid <> pg_catalog.to_regprocedure(
       'public.community_profile_post_counter_guard()'
     )
     OR pg_catalog.strpos(
       pg_catalog.pg_get_triggerdef(trigger_record.oid),
       'UPDATE OF post_count'
     ) = 0 THEN
    RAISE EXCEPTION 'COMMUNITY_PROFILE_POST_COUNTER_GUARD_INVALID'
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
    RAISE EXCEPTION 'COMMUNITY_PROFILE_POST_COUNTER_BACKFILL_INVALID'
      USING ERRCODE = '55000';
  END IF;
END;
$community_post_counter_postcondition$;

COMMENT ON FUNCTION public.community_post_counter_sync() IS
  'Maintains exact profile post counts across create, delete, reauthor, and cascade lifecycles.';
COMMENT ON FUNCTION public.community_profile_post_counter_guard() IS
  'Derives profile post_count on insert and normalizes legacy top-level writes while allowing nested lifecycle deltas.';

COMMIT;
