BEGIN;
SET TRANSACTION READ ONLY;

SELECT
  (SELECT count(*) FROM public.community_profiles WHERE community_public_id IS NULL)
    AS profile_public_id_nulls,
  (SELECT count(*) FROM public.community_posts WHERE author_public_id IS NULL)
    AS post_public_id_nulls,
  (SELECT count(*) FROM public.community_comments WHERE author_public_id IS NULL)
    AS comment_public_id_nulls,
  (
    SELECT count(*)
      FROM public.community_profiles AS profile
      LEFT JOIN public.community_public_identities AS identity
        ON identity.user_id = profile.user_id
     WHERE identity.user_id IS NULL
        OR profile.community_public_id IS DISTINCT FROM identity.public_id
  ) AS profile_identity_mismatches,
  (
    SELECT count(*)
      FROM public.community_posts AS post
      LEFT JOIN public.community_public_identities AS identity
        ON identity.user_id = post.author_id
     WHERE identity.user_id IS NULL
        OR post.author_public_id IS DISTINCT FROM identity.public_id
  ) AS post_identity_mismatches,
  (
    SELECT count(*)
      FROM public.community_comments AS comment
      LEFT JOIN public.community_public_identities AS identity
        ON identity.user_id = comment.author_id
     WHERE identity.user_id IS NULL
        OR comment.author_public_id IS DISTINCT FROM identity.public_id
  ) AS comment_identity_mismatches,
  has_column_privilege('anon', 'public.community_posts', 'author_id', 'SELECT')
    AS anon_can_read_post_auth_uuid,
  has_column_privilege('authenticated', 'public.community_posts', 'author_id', 'SELECT')
    AS authenticated_can_read_post_auth_uuid,
  has_column_privilege('anon', 'public.community_comments', 'author_id', 'SELECT')
    AS anon_can_read_comment_auth_uuid,
  has_column_privilege('authenticated', 'public.community_profiles', 'user_id', 'SELECT')
    AS authenticated_can_read_profile_auth_uuid,
  EXISTS (
    SELECT 1
      FROM pg_catalog.pg_publication AS publication
      JOIN pg_catalog.pg_publication_rel AS publication_relation
        ON publication_relation.prpubid = publication.oid
     WHERE publication.pubname = 'supabase_realtime'
       AND publication_relation.prrelid = 'public.community_posts'::regclass
  ) AS raw_post_wal_publication_enabled;

COMMIT;
