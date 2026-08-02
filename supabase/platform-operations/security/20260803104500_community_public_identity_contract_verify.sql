BEGIN;
SET TRANSACTION READ ONLY;

DO $community_public_identity_contract_verify$
BEGIN
  IF has_column_privilege('anon', 'public.community_posts', 'author_id', 'SELECT')
     OR has_column_privilege('authenticated', 'public.community_posts', 'author_id', 'SELECT')
     OR has_column_privilege('anon', 'public.community_comments', 'author_id', 'SELECT')
     OR has_column_privilege('authenticated', 'public.community_comments', 'author_id', 'SELECT')
     OR has_column_privilege('anon', 'public.community_profiles', 'user_id', 'SELECT')
     OR has_column_privilege('authenticated', 'public.community_profiles', 'user_id', 'SELECT')
     OR has_table_privilege('anon', 'public.community_public_identities', 'SELECT')
     OR has_table_privilege('authenticated', 'public.community_public_identities', 'SELECT') THEN
    RAISE EXCEPTION 'COMMUNITY_PUBLIC_IDENTITY_CONTRACT_NOT_CLOSED'
      USING ERRCODE = '55000';
  END IF;

  IF NOT has_column_privilege('anon', 'public.community_posts', 'author_public_id', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.community_comments', 'author_public_id', 'SELECT')
     OR NOT has_column_privilege('anon', 'public.community_profiles', 'community_public_id', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.community_posts', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.community_comments', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.community_profiles', 'SELECT') THEN
    RAISE EXCEPTION 'COMMUNITY_PUBLIC_IDENTITY_SAFE_PROJECTION_MISSING'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS table_record
     WHERE table_record.oid = 'public.community_public_identities'::regclass
       AND table_record.relrowsecurity IS TRUE
       AND table_record.relforcerowsecurity IS TRUE
  ) OR has_function_privilege(
    'anon', 'public.ensure_community_public_identity(uuid)', 'EXECUTE'
  ) OR has_function_privilege(
    'authenticated', 'public.ensure_community_public_identity(uuid)', 'EXECUTE'
  ) OR NOT has_table_privilege(
    'service_role', 'public.community_public_identities', 'SELECT'
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_PUBLIC_IDENTITY_PRIVATE_MAP_FENCE_INVALID'
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

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_publication AS publication
      JOIN pg_catalog.pg_publication_rel AS publication_relation
        ON publication_relation.prpubid = publication.oid
     WHERE publication.pubname = 'supabase_realtime'
       AND publication_relation.prrelid = 'public.community_posts'::regclass
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_POST_RAW_WAL_PUBLICATION_REMAINS_ENABLED'
      USING ERRCODE = '55000';
  END IF;
END;
$community_public_identity_contract_verify$;

SELECT 1 AS community_public_identity_contract_verified;

COMMIT;
