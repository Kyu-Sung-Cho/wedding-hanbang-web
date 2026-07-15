-- EXPAND PHASE: persist Expo push tokens used by the shipped mobile client.
-- The production schema drifted from the mobile write path and had no column,
-- causing registration failures to be swallowed on every physical device.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS push_token text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_push_token_shape_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_push_token_shape_check
  CHECK (
    push_token IS NULL
    OR (
      octet_length(push_token) BETWEEN 16 AND 512
      AND push_token !~ '[[:space:][:cntrl:]]'
    )
  );

-- One Expo token represents one app installation and must not target multiple
-- accounts after a sign-out/sign-in handoff on the same device.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_push_token_unique_idx
  ON public.profiles (push_token)
  WHERE push_token IS NOT NULL;

COMMENT ON COLUMN public.profiles.push_token IS
  'Expo Push Token for the most recently registered device; sensitive delivery identifier.';
