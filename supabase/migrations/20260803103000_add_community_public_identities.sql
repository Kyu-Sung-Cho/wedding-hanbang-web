-- Decouple community-facing author identifiers from Supabase Auth UUIDs.
--
-- This is the expand phase. Existing internal user_id/author_id columns remain
-- available to trusted server code and RLS. Public readers receive the new
-- mirrors; the follow-up platform operation revokes the legacy columns only
-- after every supported client has moved to the public-ID contract.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $community_public_identity_preflight$
DECLARE
  missing_table text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'COMMUNITY_PUBLIC_IDENTITY_REQUIRED_ROLE_MISSING'
      USING ERRCODE = '55000';
  END IF;

  SELECT expected.table_name
    INTO missing_table
    FROM (VALUES
      ('community_profiles'),
      ('community_posts'),
      ('community_comments')
    ) AS expected(table_name)
    LEFT JOIN information_schema.tables AS existing
      ON existing.table_schema = 'public'
     AND existing.table_name = expected.table_name
   WHERE existing.table_name IS NULL
   LIMIT 1;

  IF missing_table IS NOT NULL THEN
    RAISE EXCEPTION 'COMMUNITY_PUBLIC_IDENTITY_TABLE_MISSING: %', missing_table
      USING ERRCODE = '55000';
  END IF;
END;
$community_public_identity_preflight$;

CREATE TABLE IF NOT EXISTS public.community_public_identities (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  public_id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_public_identities_public_id_key UNIQUE (public_id),
  CONSTRAINT community_public_identities_user_public_key UNIQUE (user_id, public_id)
);

ALTER TABLE public.community_public_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_public_identities FORCE ROW LEVEL SECURITY;
ALTER TABLE public.community_public_identities OWNER TO postgres;

REVOKE ALL ON TABLE public.community_public_identities
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.community_public_identities TO service_role;

CREATE OR REPLACE FUNCTION public.bind_community_public_identity_registry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
SET row_security = off
AS $function$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (
       NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.public_id IS DISTINCT FROM OLD.public_id
     ) THEN
    RAISE EXCEPTION 'COMMUNITY_PUBLIC_IDENTITY_REGISTRY_IMMUTABLE'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Ignore every caller-supplied value. Public identifiers are generated
    -- only inside the database and are never chosen by an API client.
    NEW.public_id := gen_random_uuid();
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.bind_community_public_identity_registry()
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.bind_community_public_identity_registry()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bind_community_public_identity_registry
  ON public.community_public_identities;
CREATE TRIGGER bind_community_public_identity_registry
BEFORE INSERT OR UPDATE OF user_id, public_id
ON public.community_public_identities
FOR EACH ROW
EXECUTE FUNCTION public.bind_community_public_identity_registry();

ALTER TABLE public.community_profiles
  ADD COLUMN IF NOT EXISTS community_public_id uuid;
ALTER TABLE public.community_posts
  ADD COLUMN IF NOT EXISTS author_public_id uuid;
ALTER TABLE public.community_comments
  ADD COLUMN IF NOT EXISTS author_public_id uuid;

CREATE OR REPLACE FUNCTION public.ensure_community_public_identity(
  p_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
SET row_security = off
AS $function$
DECLARE
  resolved_public_id uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'COMMUNITY_PUBLIC_IDENTITY_USER_REQUIRED'
      USING ERRCODE = '23502';
  END IF;

  INSERT INTO public.community_public_identities (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT identity.public_id
    INTO resolved_public_id
    FROM public.community_public_identities AS identity
   WHERE identity.user_id = p_user_id;

  IF resolved_public_id IS NULL THEN
    RAISE EXCEPTION 'COMMUNITY_PUBLIC_IDENTITY_RESOLUTION_FAILED'
      USING ERRCODE = '55000';
  END IF;

  RETURN resolved_public_id;
END;
$function$;

ALTER FUNCTION public.ensure_community_public_identity(uuid)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.ensure_community_public_identity(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_community_public_identity(uuid)
  TO service_role;

-- Include authors who may have historical posts/comments but no profile row.
INSERT INTO public.community_public_identities (user_id)
SELECT source.user_id
  FROM (
    SELECT user_id FROM public.community_profiles
    UNION
    SELECT author_id FROM public.community_posts
    UNION
    SELECT author_id FROM public.community_comments
  ) AS source
 WHERE source.user_id IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;

UPDATE public.community_profiles AS profile
   SET community_public_id = identity.public_id
  FROM public.community_public_identities AS identity
 WHERE identity.user_id = profile.user_id
   AND profile.community_public_id IS DISTINCT FROM identity.public_id;

UPDATE public.community_posts AS post
   SET author_public_id = identity.public_id
  FROM public.community_public_identities AS identity
 WHERE identity.user_id = post.author_id
   AND post.author_public_id IS DISTINCT FROM identity.public_id;

UPDATE public.community_comments AS comment
   SET author_public_id = identity.public_id
  FROM public.community_public_identities AS identity
 WHERE identity.user_id = comment.author_id
   AND comment.author_public_id IS DISTINCT FROM identity.public_id;

ALTER TABLE public.community_profiles
  ALTER COLUMN community_public_id SET NOT NULL;
ALTER TABLE public.community_posts
  ALTER COLUMN author_public_id SET NOT NULL;
ALTER TABLE public.community_comments
  ALTER COLUMN author_public_id SET NOT NULL;

ALTER TABLE public.community_profiles
  DROP CONSTRAINT IF EXISTS community_profiles_public_identity_fkey;
ALTER TABLE public.community_profiles
  ADD CONSTRAINT community_profiles_public_identity_fkey
  FOREIGN KEY (user_id, community_public_id)
  REFERENCES public.community_public_identities (user_id, public_id)
  ON DELETE CASCADE
  NOT VALID;

ALTER TABLE public.community_posts
  DROP CONSTRAINT IF EXISTS community_posts_public_identity_fkey;
ALTER TABLE public.community_posts
  ADD CONSTRAINT community_posts_public_identity_fkey
  FOREIGN KEY (author_id, author_public_id)
  REFERENCES public.community_public_identities (user_id, public_id)
  ON DELETE CASCADE
  NOT VALID;

ALTER TABLE public.community_comments
  DROP CONSTRAINT IF EXISTS community_comments_public_identity_fkey;
ALTER TABLE public.community_comments
  ADD CONSTRAINT community_comments_public_identity_fkey
  FOREIGN KEY (author_id, author_public_id)
  REFERENCES public.community_public_identities (user_id, public_id)
  ON DELETE CASCADE
  NOT VALID;

ALTER TABLE public.community_profiles
  VALIDATE CONSTRAINT community_profiles_public_identity_fkey;
ALTER TABLE public.community_posts
  VALIDATE CONSTRAINT community_posts_public_identity_fkey;
ALTER TABLE public.community_comments
  VALIDATE CONSTRAINT community_comments_public_identity_fkey;

CREATE UNIQUE INDEX IF NOT EXISTS community_profiles_public_id_key
  ON public.community_profiles (community_public_id);
CREATE INDEX IF NOT EXISTS community_posts_author_public_id_idx
  ON public.community_posts (author_public_id);
CREATE INDEX IF NOT EXISTS community_comments_author_public_id_idx
  ON public.community_comments (author_public_id);

CREATE OR REPLACE FUNCTION public.bind_community_profile_public_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
SET row_security = off
AS $function$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (
       NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.community_public_id IS DISTINCT FROM OLD.community_public_id
     ) THEN
    RAISE EXCEPTION 'COMMUNITY_PUBLIC_IDENTITY_IMMUTABLE'
      USING ERRCODE = '23514';
  END IF;

  NEW.community_public_id := public.ensure_community_public_identity(NEW.user_id);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bind_community_author_public_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
SET row_security = off
AS $function$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (
       NEW.author_id IS DISTINCT FROM OLD.author_id
       OR NEW.author_public_id IS DISTINCT FROM OLD.author_public_id
     ) THEN
    RAISE EXCEPTION 'COMMUNITY_AUTHOR_IDENTITY_IMMUTABLE'
      USING ERRCODE = '23514';
  END IF;

  NEW.author_public_id := public.ensure_community_public_identity(NEW.author_id);
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.bind_community_profile_public_identity()
  OWNER TO postgres;
ALTER FUNCTION public.bind_community_author_public_identity()
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.bind_community_profile_public_identity()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bind_community_author_public_identity()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bind_community_profile_public_identity
  ON public.community_profiles;
CREATE TRIGGER bind_community_profile_public_identity
BEFORE INSERT OR UPDATE OF user_id, community_public_id
ON public.community_profiles
FOR EACH ROW
EXECUTE FUNCTION public.bind_community_profile_public_identity();

DROP TRIGGER IF EXISTS bind_community_post_public_identity
  ON public.community_posts;
CREATE TRIGGER bind_community_post_public_identity
BEFORE INSERT OR UPDATE OF author_id, author_public_id
ON public.community_posts
FOR EACH ROW
EXECUTE FUNCTION public.bind_community_author_public_identity();

DROP TRIGGER IF EXISTS bind_community_comment_public_identity
  ON public.community_comments;
CREATE TRIGGER bind_community_comment_public_identity
BEFORE INSERT OR UPDATE OF author_id, author_public_id
ON public.community_comments
FOR EACH ROW
EXECUTE FUNCTION public.bind_community_author_public_identity();

-- Expand the safe projection without removing legacy IDs yet. Column-level
-- contract removal is deliberately gated on the minimum supported client.
GRANT SELECT (community_public_id)
  ON TABLE public.community_profiles TO anon, authenticated;
GRANT SELECT (author_public_id)
  ON TABLE public.community_posts, public.community_comments TO anon, authenticated;
GRANT SELECT (community_public_id)
  ON TABLE public.community_profiles TO service_role;
GRANT SELECT (author_public_id)
  ON TABLE public.community_posts, public.community_comments TO service_role;

REVOKE INSERT (community_public_id), UPDATE (community_public_id)
  ON TABLE public.community_profiles FROM PUBLIC, anon, authenticated;
REVOKE INSERT (author_public_id), UPDATE (author_public_id)
  ON TABLE public.community_posts, public.community_comments
  FROM PUBLIC, anon, authenticated;

DO $community_public_identity_postcondition$
DECLARE
  mismatch_count bigint;
BEGIN
  SELECT
    (SELECT count(*)
       FROM public.community_profiles AS profile
       JOIN public.community_public_identities AS identity
         ON identity.user_id = profile.user_id
      WHERE profile.community_public_id IS DISTINCT FROM identity.public_id)
    +
    (SELECT count(*)
       FROM public.community_posts AS post
       JOIN public.community_public_identities AS identity
         ON identity.user_id = post.author_id
      WHERE post.author_public_id IS DISTINCT FROM identity.public_id)
    +
    (SELECT count(*)
       FROM public.community_comments AS comment
       JOIN public.community_public_identities AS identity
         ON identity.user_id = comment.author_id
      WHERE comment.author_public_id IS DISTINCT FROM identity.public_id)
    INTO mismatch_count;

  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'COMMUNITY_PUBLIC_IDENTITY_BACKFILL_MISMATCH: %', mismatch_count
      USING ERRCODE = '55000';
  END IF;

  IF has_table_privilege('anon', 'public.community_public_identities', 'SELECT')
     OR has_table_privilege('authenticated', 'public.community_public_identities', 'SELECT')
     OR has_function_privilege(
       'anon',
       'public.ensure_community_public_identity(uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.ensure_community_public_identity(uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'COMMUNITY_PUBLIC_IDENTITY_INTERNAL_MAP_EXPOSED'
      USING ERRCODE = '55000';
  END IF;

  IF NOT has_column_privilege(
       'anon',
       'public.community_posts',
       'author_public_id',
       'SELECT'
     ) OR NOT has_column_privilege(
       'authenticated',
       'public.community_profiles',
       'community_public_id',
       'SELECT'
     ) THEN
    RAISE EXCEPTION 'COMMUNITY_PUBLIC_IDENTITY_PUBLIC_PROJECTION_CLOSED'
      USING ERRCODE = '55000';
  END IF;
END;
$community_public_identity_postcondition$;

COMMENT ON TABLE public.community_public_identities IS
  'Private mapping between Supabase Auth UUIDs and stable community pseudonyms.';
COMMENT ON COLUMN public.community_profiles.community_public_id IS
  'Stable community-facing pseudonym. Never expose user_id beside this value.';
COMMENT ON COLUMN public.community_posts.author_public_id IS
  'Public author pseudonym derived from author_id by a trusted trigger.';
COMMENT ON COLUMN public.community_comments.author_public_id IS
  'Public author pseudonym derived from author_id by a trusted trigger.';

COMMIT;
