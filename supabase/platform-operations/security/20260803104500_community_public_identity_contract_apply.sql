BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $community_public_identity_contract_preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.community_profiles WHERE community_public_id IS NULL
    UNION ALL
    SELECT 1 FROM public.community_posts WHERE author_public_id IS NULL
    UNION ALL
    SELECT 1 FROM public.community_comments WHERE author_public_id IS NULL
  ) OR EXISTS (
    SELECT 1
      FROM public.community_profiles AS profile
      LEFT JOIN public.community_public_identities AS identity
        ON identity.user_id = profile.user_id
     WHERE identity.user_id IS NULL
        OR profile.community_public_id IS DISTINCT FROM identity.public_id
  ) OR EXISTS (
    SELECT 1
      FROM public.community_posts AS post
      LEFT JOIN public.community_public_identities AS identity
        ON identity.user_id = post.author_id
     WHERE identity.user_id IS NULL
        OR post.author_public_id IS DISTINCT FROM identity.public_id
  ) OR EXISTS (
    SELECT 1
      FROM public.community_comments AS comment
      LEFT JOIN public.community_public_identities AS identity
        ON identity.user_id = comment.author_id
     WHERE identity.user_id IS NULL
        OR comment.author_public_id IS DISTINCT FROM identity.public_id
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_PUBLIC_IDENTITY_CONTRACT_BACKFILL_INCOMPLETE'
      USING ERRCODE = '55000';
  END IF;
END;
$community_public_identity_contract_preflight$;

REVOKE SELECT ON TABLE
  public.community_posts,
  public.community_comments,
  public.community_profiles
FROM PUBLIC, anon, authenticated;

DO $revoke_legacy_community_columns$
DECLARE
  target_table text;
  all_columns text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'community_posts',
    'community_comments',
    'community_profiles'
  ]::text[]
  LOOP
    SELECT string_agg(format('%I', column_name), ', ' ORDER BY ordinal_position)
      INTO all_columns
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = target_table;

    IF all_columns IS NULL THEN
      RAISE EXCEPTION 'COMMUNITY_PUBLIC_IDENTITY_CONTRACT_TABLE_MISSING: %', target_table
        USING ERRCODE = '55000';
    END IF;

    EXECUTE format(
      'REVOKE SELECT (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated',
      all_columns,
      target_table
    );
  END LOOP;
END;
$revoke_legacy_community_columns$;

GRANT SELECT (
  id, author_public_id, category, title, content, images, slides, visibility,
  ad_disclosure, sponsorship_detail, ai_comment, is_resolved,
  is_verified_review, price_data, is_quick_review, rating, under_review,
  upvote_count, downvote_count, comment_count, view_count, bookmark_count,
  is_pinned, is_weekly_best, vendor_tags, tags, cost_data, search_vector,
  created_at, updated_at
) ON TABLE public.community_posts TO anon, authenticated;

GRANT SELECT (
  id, post_id, parent_id, author_public_id, content, upvote_count, is_deleted,
  created_at, updated_at
) ON TABLE public.community_comments TO anon, authenticated;

GRANT SELECT (
  community_public_id, nickname, avatar_url, badge, rank
) ON TABLE public.community_profiles TO anon;

GRANT SELECT (
  community_public_id, nickname, avatar_url, badge, rank, post_count,
  comment_count, total_upvotes_received
) ON TABLE public.community_profiles TO authenticated;

GRANT SELECT ON TABLE
  public.community_posts,
  public.community_comments,
  public.community_profiles,
  public.community_public_identities
TO service_role;

DO $remove_raw_community_wal_publication$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_publication AS publication
      JOIN pg_catalog.pg_publication_rel AS publication_relation
        ON publication_relation.prpubid = publication.oid
     WHERE publication.pubname = 'supabase_realtime'
       AND publication_relation.prrelid = 'public.community_posts'::regclass
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.community_posts;
  END IF;
END;
$remove_raw_community_wal_publication$;

DO $community_public_identity_contract_postcondition$
BEGIN
  IF has_column_privilege('anon', 'public.community_posts', 'author_id', 'SELECT')
     OR has_column_privilege('authenticated', 'public.community_posts', 'author_id', 'SELECT')
     OR has_column_privilege('anon', 'public.community_comments', 'author_id', 'SELECT')
     OR has_column_privilege('authenticated', 'public.community_comments', 'author_id', 'SELECT')
     OR has_column_privilege('anon', 'public.community_profiles', 'user_id', 'SELECT')
     OR has_column_privilege('authenticated', 'public.community_profiles', 'user_id', 'SELECT') THEN
    RAISE EXCEPTION 'COMMUNITY_AUTH_UUID_COLUMN_REMAINS_EXPOSED'
      USING ERRCODE = '55000';
  END IF;

  IF NOT has_column_privilege('anon', 'public.community_posts', 'author_public_id', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.community_comments', 'author_public_id', 'SELECT')
     OR NOT has_column_privilege('anon', 'public.community_profiles', 'community_public_id', 'SELECT') THEN
    RAISE EXCEPTION 'COMMUNITY_PUBLIC_ID_COLUMN_CLOSED'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    WITH expected(grantee, table_name, column_name) AS (
      VALUES
        ('anon', 'community_posts', 'id'),
        ('anon', 'community_posts', 'author_public_id'),
        ('anon', 'community_posts', 'category'),
        ('anon', 'community_posts', 'title'),
        ('anon', 'community_posts', 'content'),
        ('anon', 'community_posts', 'images'),
        ('anon', 'community_posts', 'slides'),
        ('anon', 'community_posts', 'visibility'),
        ('anon', 'community_posts', 'ad_disclosure'),
        ('anon', 'community_posts', 'sponsorship_detail'),
        ('anon', 'community_posts', 'ai_comment'),
        ('anon', 'community_posts', 'is_resolved'),
        ('anon', 'community_posts', 'is_verified_review'),
        ('anon', 'community_posts', 'price_data'),
        ('anon', 'community_posts', 'is_quick_review'),
        ('anon', 'community_posts', 'rating'),
        ('anon', 'community_posts', 'under_review'),
        ('anon', 'community_posts', 'upvote_count'),
        ('anon', 'community_posts', 'downvote_count'),
        ('anon', 'community_posts', 'comment_count'),
        ('anon', 'community_posts', 'view_count'),
        ('anon', 'community_posts', 'bookmark_count'),
        ('anon', 'community_posts', 'is_pinned'),
        ('anon', 'community_posts', 'is_weekly_best'),
        ('anon', 'community_posts', 'vendor_tags'),
        ('anon', 'community_posts', 'tags'),
        ('anon', 'community_posts', 'cost_data'),
        ('anon', 'community_posts', 'search_vector'),
        ('anon', 'community_posts', 'created_at'),
        ('anon', 'community_posts', 'updated_at'),
        ('anon', 'community_comments', 'id'),
        ('anon', 'community_comments', 'post_id'),
        ('anon', 'community_comments', 'parent_id'),
        ('anon', 'community_comments', 'author_public_id'),
        ('anon', 'community_comments', 'content'),
        ('anon', 'community_comments', 'upvote_count'),
        ('anon', 'community_comments', 'is_deleted'),
        ('anon', 'community_comments', 'created_at'),
        ('anon', 'community_comments', 'updated_at'),
        ('anon', 'community_profiles', 'community_public_id'),
        ('anon', 'community_profiles', 'nickname'),
        ('anon', 'community_profiles', 'avatar_url'),
        ('anon', 'community_profiles', 'badge'),
        ('anon', 'community_profiles', 'rank'),
        ('authenticated', 'community_posts', 'id'),
        ('authenticated', 'community_posts', 'author_public_id'),
        ('authenticated', 'community_posts', 'category'),
        ('authenticated', 'community_posts', 'title'),
        ('authenticated', 'community_posts', 'content'),
        ('authenticated', 'community_posts', 'images'),
        ('authenticated', 'community_posts', 'slides'),
        ('authenticated', 'community_posts', 'visibility'),
        ('authenticated', 'community_posts', 'ad_disclosure'),
        ('authenticated', 'community_posts', 'sponsorship_detail'),
        ('authenticated', 'community_posts', 'ai_comment'),
        ('authenticated', 'community_posts', 'is_resolved'),
        ('authenticated', 'community_posts', 'is_verified_review'),
        ('authenticated', 'community_posts', 'price_data'),
        ('authenticated', 'community_posts', 'is_quick_review'),
        ('authenticated', 'community_posts', 'rating'),
        ('authenticated', 'community_posts', 'under_review'),
        ('authenticated', 'community_posts', 'upvote_count'),
        ('authenticated', 'community_posts', 'downvote_count'),
        ('authenticated', 'community_posts', 'comment_count'),
        ('authenticated', 'community_posts', 'view_count'),
        ('authenticated', 'community_posts', 'bookmark_count'),
        ('authenticated', 'community_posts', 'is_pinned'),
        ('authenticated', 'community_posts', 'is_weekly_best'),
        ('authenticated', 'community_posts', 'vendor_tags'),
        ('authenticated', 'community_posts', 'tags'),
        ('authenticated', 'community_posts', 'cost_data'),
        ('authenticated', 'community_posts', 'search_vector'),
        ('authenticated', 'community_posts', 'created_at'),
        ('authenticated', 'community_posts', 'updated_at'),
        ('authenticated', 'community_comments', 'id'),
        ('authenticated', 'community_comments', 'post_id'),
        ('authenticated', 'community_comments', 'parent_id'),
        ('authenticated', 'community_comments', 'author_public_id'),
        ('authenticated', 'community_comments', 'content'),
        ('authenticated', 'community_comments', 'upvote_count'),
        ('authenticated', 'community_comments', 'is_deleted'),
        ('authenticated', 'community_comments', 'created_at'),
        ('authenticated', 'community_comments', 'updated_at'),
        ('authenticated', 'community_profiles', 'community_public_id'),
        ('authenticated', 'community_profiles', 'nickname'),
        ('authenticated', 'community_profiles', 'avatar_url'),
        ('authenticated', 'community_profiles', 'badge'),
        ('authenticated', 'community_profiles', 'rank'),
        ('authenticated', 'community_profiles', 'post_count'),
        ('authenticated', 'community_profiles', 'comment_count'),
        ('authenticated', 'community_profiles', 'total_upvotes_received')
    ), actual AS (
      SELECT privilege.grantee, privilege.table_name, privilege.column_name
        FROM information_schema.column_privileges AS privilege
       WHERE privilege.table_schema = 'public'
         AND privilege.table_name IN (
           'community_posts', 'community_comments', 'community_profiles'
         )
         AND privilege.privilege_type = 'SELECT'
         AND privilege.grantee IN ('PUBLIC', 'anon', 'authenticated')
    )
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
    UNION ALL
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_PUBLIC_IDENTITY_COLUMN_GRANT_DRIFT'
      USING ERRCODE = '55000';
  END IF;
END;
$community_public_identity_contract_postcondition$;

COMMIT;
