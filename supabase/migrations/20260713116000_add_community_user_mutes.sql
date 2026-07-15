-- Reversible, account-scoped author mutes for public community safety.
-- Browser roles never access this relationship directly; validated server
-- routes own all reads and writes, and every row disappears with either user.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.community_user_mutes (
  muter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  muted_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT community_user_mutes_pkey PRIMARY KEY (muter_id, muted_user_id),
  CONSTRAINT community_user_mutes_no_self CHECK (muter_id <> muted_user_id)
);

CREATE INDEX IF NOT EXISTS idx_community_user_mutes_muted_user
  ON public.community_user_mutes (muted_user_id, muter_id);

ALTER TABLE public.community_user_mutes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_user_mutes FORCE ROW LEVEL SECURITY;

-- Private mute relationships must never be streamed. A FOR ALL TABLES
-- publication cannot exclude one table, so fail the migration instead of
-- silently exposing future relationship changes.
DO $remove_mute_realtime$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_publication
    WHERE pubname = 'supabase_realtime'
      AND puballtables
  ) THEN
    RAISE EXCEPTION 'supabase_realtime publishes all tables; community_user_mutes cannot be private';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'community_user_mutes'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.community_user_mutes';
  END IF;
END;
$remove_mute_realtime$;

DO $drop_browser_policies$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'community_user_mutes'
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY IF EXISTS %I ON public.community_user_mutes',
      policy_row.policyname
    );
  END LOOP;
END;
$drop_browser_policies$;

REVOKE ALL ON TABLE public.community_user_mutes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.community_user_mutes FROM service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.community_user_mutes TO service_role;

-- RLS policies cannot read the private mute table as anon/authenticated. This
-- narrow definer function only answers whether the current JWT owner muted one
-- author; it never exposes the relationship rows or another user's state.
CREATE OR REPLACE FUNCTION public.community_author_is_muted(p_author_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.community_user_mutes AS mute
      WHERE mute.muter_id = auth.uid()
        AND mute.muted_user_id = p_author_id
    )
  END;
$function$;

ALTER FUNCTION public.community_author_is_muted(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.community_author_is_muted(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_author_is_muted(uuid) TO anon, authenticated;

-- Make the safety rule intrinsic to every browser read. API filtering remains
-- defense in depth, while these policies also protect direct Data API access
-- and prevent a cached/initial feed from briefly showing a muted author.
DROP POLICY IF EXISTS "cp_select_public" ON public.community_posts;
DROP POLICY IF EXISTS "cp_select_members" ON public.community_posts;
DROP POLICY IF EXISTS "cp_select_drafts" ON public.community_posts;
CREATE POLICY "cp_select_public" ON public.community_posts FOR SELECT
  USING (
    visibility = 'public'
    AND (NOT COALESCE(under_review, false) OR author_id = auth.uid())
    AND NOT public.community_author_is_muted(author_id)
  );
CREATE POLICY "cp_select_members" ON public.community_posts FOR SELECT
  USING (
    visibility = 'members'
    AND auth.role() = 'authenticated'
    AND (NOT COALESCE(under_review, false) OR author_id = auth.uid())
    AND NOT public.community_author_is_muted(author_id)
  );
CREATE POLICY "cp_select_drafts" ON public.community_posts FOR SELECT
  USING (visibility = 'draft' AND author_id = auth.uid());

DROP POLICY IF EXISTS "cc_select" ON public.community_comments;
CREATE POLICY "cc_select" ON public.community_comments FOR SELECT
  USING (
    NOT public.community_author_is_muted(community_comments.author_id)
    AND EXISTS (
      SELECT 1
      FROM public.community_posts AS post
      WHERE post.id = community_comments.post_id
        AND NOT public.community_author_is_muted(post.author_id)
        AND (
          post.visibility = 'public'
          OR (post.visibility = 'members' AND auth.role() = 'authenticated')
        )
        AND (NOT COALESCE(post.under_review, false) OR post.author_id = auth.uid())
    )
  );

DO $assert_mute_acl$
BEGIN
  IF pg_catalog.has_table_privilege('anon', 'public.community_user_mutes', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.community_user_mutes', 'SELECT')
     OR pg_catalog.has_table_privilege('anon', 'public.community_user_mutes', 'INSERT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.community_user_mutes', 'INSERT')
     OR pg_catalog.has_table_privilege('anon', 'public.community_user_mutes', 'DELETE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.community_user_mutes', 'DELETE') THEN
    RAISE EXCEPTION 'community_user_mutes browser ACL is open';
  END IF;

  IF NOT pg_catalog.has_table_privilege('service_role', 'public.community_user_mutes', 'SELECT')
     OR NOT pg_catalog.has_table_privilege('service_role', 'public.community_user_mutes', 'INSERT')
     OR NOT pg_catalog.has_table_privilege('service_role', 'public.community_user_mutes', 'DELETE')
     OR pg_catalog.has_table_privilege('service_role', 'public.community_user_mutes', 'UPDATE') THEN
    RAISE EXCEPTION 'community_user_mutes service ACL is not exact';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'community_user_mutes'
  ) THEN
    RAISE EXCEPTION 'community_user_mutes is exposed through realtime';
  END IF;
END;
$assert_mute_acl$;

DO $assert_mute_read_policies$
DECLARE
  public_post_qual text;
  member_post_qual text;
  comment_qual text;
BEGIN
  SELECT qual INTO public_post_qual
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'community_posts'
    AND policyname = 'cp_select_public';

  SELECT qual INTO member_post_qual
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'community_posts'
    AND policyname = 'cp_select_members';

  SELECT qual INTO comment_qual
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'community_comments'
    AND policyname = 'cc_select';

  IF pg_catalog.strpos(COALESCE(public_post_qual, ''), 'community_author_is_muted') = 0
     OR pg_catalog.strpos(COALESCE(member_post_qual, ''), 'community_author_is_muted') = 0
     OR pg_catalog.strpos(COALESCE(comment_qual, ''), 'community_author_is_muted') = 0 THEN
    RAISE EXCEPTION 'community mute read policies are incomplete';
  END IF;
END;
$assert_mute_read_policies$;

COMMENT ON TABLE public.community_user_mutes IS
  'Private reversible author-mute relationships. Server routes must scope every operation to the authenticated muter.';
COMMENT ON FUNCTION public.community_author_is_muted(uuid) IS
  'RLS helper: returns only whether the current authenticated user muted one author.';

COMMIT;
