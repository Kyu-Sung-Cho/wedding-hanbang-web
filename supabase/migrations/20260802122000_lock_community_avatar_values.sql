-- Community avatars are intentionally limited to the six product-provided emoji.
-- URL-backed avatars can issue credentialed same-origin GET requests or external
-- tracking requests when another member views a community surface.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.community_profiles') IS NULL THEN
    RAISE EXCEPTION 'Required table public.community_profiles is missing';
  END IF;
END
$$;

LOCK TABLE public.community_profiles IN SHARE ROW EXCLUSIVE MODE;

UPDATE public.community_profiles
SET avatar_url = NULL,
    updated_at = now()
WHERE avatar_url IS NOT NULL
  AND avatar_url NOT IN ('🌿', '💍', '🌸', '🤍', '✨', '👑');

ALTER TABLE public.community_profiles
  DROP CONSTRAINT IF EXISTS community_profiles_avatar_allowlist;

ALTER TABLE public.community_profiles
  ADD CONSTRAINT community_profiles_avatar_allowlist
  CHECK (
    avatar_url IS NULL
    OR avatar_url IN ('🌿', '💍', '🌸', '🤍', '✨', '👑')
  );

COMMIT;
