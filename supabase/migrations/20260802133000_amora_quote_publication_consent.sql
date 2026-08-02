-- Private quote checks must not become public merely because their row id is
-- known. Existing rows remain private because PostgreSQL initializes the new
-- nullable column to NULL; publication is an explicit owner action through the
-- authenticated API boundary.

ALTER TABLE public.amora_quote_checks
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

COMMENT ON COLUMN public.amora_quote_checks.published_at IS
  'Explicit owner consent timestamp for the redacted public quote result. NULL means private.';
