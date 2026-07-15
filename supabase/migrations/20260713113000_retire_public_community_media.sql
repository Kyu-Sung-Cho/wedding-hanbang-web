-- Community media lacks a durable draft/link/delete lifecycle. Keep legacy
-- objects for controlled service-role review, but make them private and reject
-- every new browser, API, or direct-database media write.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

UPDATE storage.buckets
SET public = FALSE
WHERE id IN ('community-images', 'community-videos');

DO $policy_cleanup$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND (
        COALESCE(qual, '') LIKE '%community-images%'
        OR COALESCE(with_check, '') LIKE '%community-images%'
        OR COALESCE(qual, '') LIKE '%community-videos%'
        OR COALESCE(with_check, '') LIKE '%community-videos%'
      )
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY IF EXISTS %I ON storage.objects',
      policy_row.policyname
    );
  END LOOP;
END;
$policy_cleanup$;

CREATE OR REPLACE FUNCTION public.block_retired_community_media_object_writes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NEW.bucket_id IN ('community-images', 'community-videos') THEN
    RAISE EXCEPTION 'community_media_retired'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.block_retired_community_media_object_writes()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.block_retired_community_media_object_writes()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.block_retired_community_media_object_writes()
  TO service_role;

DROP TRIGGER IF EXISTS block_retired_community_media_object_writes
  ON storage.objects;
CREATE TRIGGER block_retired_community_media_object_writes
  BEFORE INSERT OR UPDATE ON storage.objects
  FOR EACH ROW
  EXECUTE FUNCTION public.block_retired_community_media_object_writes();

CREATE OR REPLACE FUNCTION public.block_retired_community_post_media_writes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(pg_catalog.array_length(NEW.images, 1), 0) > 0
       OR NEW.slides IS NOT NULL
       OR COALESCE(NEW.content, '') ~* '<[[:space:]]*img([[:space:]]|>)' THEN
      RAISE EXCEPTION 'community_media_retired'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.images IS DISTINCT FROM OLD.images
     AND COALESCE(pg_catalog.array_length(NEW.images, 1), 0) > 0 THEN
    RAISE EXCEPTION 'community_media_retired'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.slides IS DISTINCT FROM OLD.slides AND NEW.slides IS NOT NULL THEN
    RAISE EXCEPTION 'community_media_retired'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.content IS DISTINCT FROM OLD.content
     AND COALESCE(NEW.content, '') ~* '<[[:space:]]*img([[:space:]]|>)' THEN
    RAISE EXCEPTION 'community_media_retired'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.block_retired_community_post_media_writes()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.block_retired_community_post_media_writes()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.block_retired_community_post_media_writes()
  TO service_role;

DROP TRIGGER IF EXISTS block_retired_community_post_media_writes
  ON public.community_posts;
CREATE TRIGGER block_retired_community_post_media_writes
  BEFORE INSERT OR UPDATE ON public.community_posts
  FOR EACH ROW
  EXECUTE FUNCTION public.block_retired_community_post_media_writes();

COMMENT ON FUNCTION public.block_retired_community_post_media_writes() IS
  'Blocks new community images, slides, and inline image HTML while allowing legacy media fields to remain unchanged or be cleared.';

CREATE OR REPLACE FUNCTION public.block_retired_community_poll_writes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'community_poll_writes_retired'
    USING ERRCODE = '55000';
END;
$function$;

ALTER FUNCTION public.block_retired_community_poll_writes()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.block_retired_community_poll_writes()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.block_retired_community_poll_writes()
  TO service_role;

DROP TRIGGER IF EXISTS block_retired_community_poll_writes
  ON public.community_polls;
CREATE TRIGGER block_retired_community_poll_writes
  BEFORE INSERT OR UPDATE ON public.community_polls
  FOR EACH ROW EXECUTE FUNCTION public.block_retired_community_poll_writes();

DROP TRIGGER IF EXISTS block_retired_community_poll_option_writes
  ON public.community_poll_options;
CREATE TRIGGER block_retired_community_poll_option_writes
  BEFORE INSERT OR UPDATE ON public.community_poll_options
  FOR EACH ROW EXECUTE FUNCTION public.block_retired_community_poll_writes();

DROP TRIGGER IF EXISTS block_retired_community_poll_vote_writes
  ON public.community_poll_votes;
CREATE TRIGGER block_retired_community_poll_vote_writes
  BEFORE INSERT OR UPDATE ON public.community_poll_votes
  FOR EACH ROW EXECUTE FUNCTION public.block_retired_community_poll_writes();
