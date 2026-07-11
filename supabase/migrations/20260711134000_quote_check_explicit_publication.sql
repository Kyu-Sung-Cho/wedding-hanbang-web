-- Quote-check privacy contract:
-- 1. every existing and future account-saved result is private by default;
-- 2. publication is an explicit, reversible owner action;
-- 3. publication state always has a matching timestamp.

ALTER TABLE public.amora_quote_checks
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

-- A UUID used to be enough to render a row. Fail closed for every historical row,
-- including rows that may have been shared under the old implicit-public behavior.
UPDATE public.amora_quote_checks
SET is_public = FALSE,
    published_at = NULL;

ALTER TABLE public.amora_quote_checks
  ALTER COLUMN is_public SET DEFAULT FALSE,
  ALTER COLUMN is_public SET NOT NULL;

ALTER TABLE public.amora_quote_checks
  DROP CONSTRAINT IF EXISTS amora_quote_checks_publication_state_check;

ALTER TABLE public.amora_quote_checks
  ADD CONSTRAINT amora_quote_checks_publication_state_check
  CHECK (
    (is_public = FALSE AND published_at IS NULL)
    OR (is_public = TRUE AND published_at IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_amora_quote_checks_public_id
  ON public.amora_quote_checks(id)
  WHERE is_public = TRUE;

COMMENT ON COLUMN public.amora_quote_checks.is_public IS
'False by default. Set true only after the authenticated owner explicitly enables a public share link.';

COMMENT ON COLUMN public.amora_quote_checks.published_at IS
'Timestamp of the latest explicit public-share activation; cleared when the owner revokes the link.';

-- Remove internal leads that were created solely from quote-check vendor-name input
-- without a separate vendor-discovery opt-in. For pre-existing leads whose source
-- was not overwritten, remove the synthetic quote-check place identifier. Their
-- historical mention counter cannot be safely decomposed from other sources.
DELETE FROM public.vendor_leads
WHERE source = 'user_mention'
  AND source_place_id LIKE 'amora-quote:%';

UPDATE public.vendor_leads
SET source_place_id = NULL
WHERE source_place_id LIKE 'amora-quote:%';
