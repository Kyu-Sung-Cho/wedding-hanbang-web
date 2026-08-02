-- A public post response does not need its internal cohort-room UUID. Keeping
-- it readable through PostgREST expands room-enumeration and cross-endpoint
-- probing opportunities without supporting any current web or mobile reader.

REVOKE SELECT ON TABLE public.community_posts
  FROM PUBLIC, anon, authenticated;

DO $grant_public_post_without_internal_identifiers$
DECLARE
  public_columns text;
BEGIN
  SELECT string_agg(format('%I', column_name), ', ' ORDER BY ordinal_position)
    INTO public_columns
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'community_posts'
     AND column_name NOT IN ('verification_doc_url', 'cohort_room_id');

  IF public_columns IS NULL THEN
    RAISE EXCEPTION 'PUBLIC_POST_SAFE_PROJECTION_EMPTY'
      USING ERRCODE = '55000';
  END IF;

  EXECUTE format(
    'GRANT SELECT (%s) ON TABLE public.community_posts TO anon, authenticated',
    public_columns
  );
END;
$grant_public_post_without_internal_identifiers$;

GRANT SELECT (cohort_room_id) ON TABLE public.community_posts TO service_role;

DO $public_post_cohort_room_postcondition$
BEGIN
  IF has_column_privilege(
       'anon',
       'public.community_posts',
       'cohort_room_id',
       'SELECT'
     ) OR has_column_privilege(
       'authenticated',
       'public.community_posts',
       'cohort_room_id',
       'SELECT'
     ) THEN
    RAISE EXCEPTION 'PUBLIC_POST_COHORT_ROOM_IDENTIFIER_REMAINS_OPEN'
      USING ERRCODE = '55000';
  END IF;

  IF NOT has_column_privilege(
       'service_role',
       'public.community_posts',
       'cohort_room_id',
       'SELECT'
     ) THEN
    RAISE EXCEPTION 'SERVICE_POST_COHORT_ROOM_IDENTIFIER_CLOSED'
      USING ERRCODE = '55000';
  END IF;
END;
$public_post_cohort_room_postcondition$;

COMMENT ON COLUMN public.community_posts.cohort_room_id IS
  'Internal cohort routing identifier. Not part of the public post projection.';
