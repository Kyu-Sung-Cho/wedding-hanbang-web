-- Quote-check submissions are analysis-only by default.
-- Rows created after this migration must carry an explicit storage-consent receipt
-- before they can participate in aggregate price research.

ALTER TABLE public.amora_quote_checks
  ADD COLUMN IF NOT EXISTS storage_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS vendor_signal_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS consent_version text;

UPDATE public.amora_quote_checks
SET excluded_from_stats = true
WHERE storage_consent_at IS NULL;

-- The retired route also created internal vendor leads from free-text vendor names
-- without a separate disclosure-signal consent. Remove those signals from ranking.
DO $$
BEGIN
  IF to_regclass('public.vendor_leads') IS NOT NULL THEN
    UPDATE public.vendor_leads
    SET mention_count = 0,
        priority_score = 0,
        status = CASE WHEN status = 'raw' THEN 'rejected' ELSE status END,
        owner_notes = concat_ws(
          E'\n',
          NULLIF(owner_notes, ''),
          '[2026-07-30] Quarantined: quote-check vendor signal lacked separate consent.'
        )
    WHERE source = 'user_mention'
      AND source_place_id LIKE 'amora-quote:%';
  END IF;
END;
$$;

ALTER TABLE public.amora_quote_checks
  DROP CONSTRAINT IF EXISTS amora_quote_checks_consent_receipt_check;

ALTER TABLE public.amora_quote_checks
  ADD CONSTRAINT amora_quote_checks_consent_receipt_check
  CHECK (
    (storage_consent_at IS NULL AND consent_version IS NULL AND excluded_from_stats = true)
    OR
    (storage_consent_at IS NOT NULL AND consent_version IS NOT NULL)
  );

ALTER TABLE public.amora_quote_checks
  DROP CONSTRAINT IF EXISTS amora_quote_checks_vendor_signal_consent_check;

ALTER TABLE public.amora_quote_checks
  ADD CONSTRAINT amora_quote_checks_vendor_signal_consent_check
  CHECK (
    vendor_signal_consent_at IS NULL
    OR storage_consent_at IS NOT NULL
  );

DROP INDEX IF EXISTS public.idx_amora_quote_checks_channel_cell;
CREATE INDEX idx_amora_quote_checks_channel_cell
  ON public.amora_quote_checks(category, region, booking_channel, quote_stage, created_at DESC)
  WHERE excluded_from_stats = false
    AND storage_consent_at IS NOT NULL;

COMMENT ON COLUMN public.amora_quote_checks.storage_consent_at IS
  'Explicit opt-in receipt for account storage and anonymized aggregate price research.';

COMMENT ON COLUMN public.amora_quote_checks.vendor_signal_consent_at IS
  'Separate explicit opt-in receipt for using vendor/category/region as an internal disclosure-review signal.';

COMMENT ON COLUMN public.amora_quote_checks.consent_version IS
  'Version of the user-facing quote-check consent copy accepted at submission time.';
