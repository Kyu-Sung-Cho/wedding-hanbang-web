-- Emergency fail-closed retirement of the experimental WeddingCode pairing
-- capability. Historical QA artifacts exposed response UUIDs and plaintext
-- couple tokens, while the original design had no expiry or revocation.
--
-- The web surface is independently code-hard-disabled. This database fence is
-- required as defense in depth and makes an old rolling-deploy server fail
-- closed instead of reattaching or returning a compromised token.

BEGIN;

UPDATE public.wedding_code_responses
SET couple_token = NULL
WHERE couple_token IS NOT NULL;

DROP FUNCTION IF EXISTS public.pair_wedding_code_response(UUID, UUID);

ALTER TABLE public.wedding_code_responses
  DROP CONSTRAINT IF EXISTS wedding_code_pairing_hard_disabled;
ALTER TABLE public.wedding_code_responses
  ADD CONSTRAINT wedding_code_pairing_hard_disabled
  CHECK (couple_token IS NULL);

COMMENT ON COLUMN public.wedding_code_responses.couple_token IS
  'Retired plaintext capability. Must remain NULL until a hashed, expiring, revocable replacement is approved.';

COMMIT;
