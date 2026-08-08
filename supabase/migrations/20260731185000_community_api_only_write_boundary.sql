BEGIN;

-- Community post text must pass the server's disclosure, moderation, origin,
-- and media checks. RLS ownership alone is not a content-safety boundary:
-- an authenticated client could otherwise call PostgREST directly and bypass
-- every API validator.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.community_posts
  FROM anon, authenticated;

-- Reads remain client-accessible under the existing public/member/own-draft
-- SELECT policies. Server APIs and controlled SECURITY DEFINER functions keep
-- their existing service-role access.
GRANT SELECT ON TABLE public.community_posts TO anon, authenticated;
GRANT ALL ON TABLE public.community_posts TO service_role;

DROP POLICY IF EXISTS "cp_insert" ON public.community_posts;
DROP POLICY IF EXISTS "cp_update" ON public.community_posts;
DROP POLICY IF EXISTS "cp_delete" ON public.community_posts;

COMMENT ON TABLE public.community_posts IS
  'Community posts are readable through RLS; member mutations are API-only so disclosure and moderation checks cannot be bypassed.';

COMMIT;
