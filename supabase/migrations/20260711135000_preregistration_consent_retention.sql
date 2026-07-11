-- Explicit beta/preregistration consent and bounded retention.
-- Expand-only: existing clients may continue inserting old-shaped rows, but admin/API
-- consumers must ignore rows without explicit consent.

ALTER TABLE public.preregistrations
  ADD COLUMN IF NOT EXISTS privacy_consent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS privacy_policy_version TEXT,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Consent cannot be inferred retroactively. Bound legacy rows and keep them out of
-- active applicant views until a fresh explicit application is submitted.
UPDATE public.preregistrations
SET expires_at = LEAST(created_at + INTERVAL '180 days', NOW() + INTERVAL '30 days')
WHERE expires_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_preregistrations_active_consent
  ON public.preregistrations (expires_at, created_at DESC)
  WHERE privacy_consent_at IS NOT NULL;

COMMENT ON COLUMN public.preregistrations.privacy_consent_at IS
  'Timestamp of explicit beta application privacy consent; NULL means not eligible for active use.';
COMMENT ON COLUMN public.preregistrations.privacy_policy_version IS
  'Policy version shown at consent time.';
COMMENT ON COLUMN public.preregistrations.expires_at IS
  'Hard application retention deadline; expired rows are purged opportunistically and by retention jobs.';
