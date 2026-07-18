BEGIN;

-- Admin-only, content-addressed text derived from immutable disclosure files.
-- The public disclosure views intentionally remain unchanged and therefore do
-- not expose either preview keys or preview text.
ALTER TABLE public.official_prices
  ADD COLUMN IF NOT EXISTS source_preview_keys text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE public.official_agency_packages
  ADD COLUMN IF NOT EXISTS source_preview_keys text[] NOT NULL DEFAULT '{}'::text[];

CREATE OR REPLACE FUNCTION public.disclosure_preview_keys_are_safe(value text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $disclosure_preview_keys_are_safe$
  SELECT
    cardinality(COALESCE(value, '{}'::text[])) <= 16
    AND COALESCE((
      SELECT bool_and(object_key ~ '^[0-9a-f]{64}\.txt$')
      FROM unnest(COALESCE(value, '{}'::text[])) AS object_key
    ), true)
$disclosure_preview_keys_are_safe$;

REVOKE ALL ON FUNCTION public.disclosure_preview_keys_are_safe(text[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.disclosure_preview_keys_are_safe(text[])
  TO service_role;

DO $preview_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.official_prices'::regclass
      AND conname = 'official_prices_source_preview_keys_check'
  ) THEN
    ALTER TABLE public.official_prices
      ADD CONSTRAINT official_prices_source_preview_keys_check
      CHECK (public.disclosure_preview_keys_are_safe(source_preview_keys))
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.official_agency_packages'::regclass
      AND conname = 'official_agency_packages_source_preview_keys_check'
  ) THEN
    ALTER TABLE public.official_agency_packages
      ADD CONSTRAINT official_agency_packages_source_preview_keys_check
      CHECK (public.disclosure_preview_keys_are_safe(source_preview_keys))
      NOT VALID;
  END IF;
END
$preview_constraints$;

ALTER TABLE public.official_prices
  VALIDATE CONSTRAINT official_prices_source_preview_keys_check;
ALTER TABLE public.official_agency_packages
  VALIDATE CONSTRAINT official_agency_packages_source_preview_keys_check;

CREATE OR REPLACE FUNCTION public.freeze_disclosure_source_preview_keys()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $freeze_disclosure_source_preview_keys$
BEGIN
  -- Legacy rows may be backfilled exactly once. Once associated, provenance is
  -- immutable even for service-role replays and admin review RPCs.
  IF OLD.source_preview_keys IS DISTINCT FROM NEW.source_preview_keys
     AND cardinality(OLD.source_preview_keys) > 0 THEN
    RAISE EXCEPTION 'PREVIEW_KEYS_IMMUTABLE';
  END IF;
  RETURN NEW;
END
$freeze_disclosure_source_preview_keys$;

REVOKE ALL ON FUNCTION public.freeze_disclosure_source_preview_keys()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS official_prices_source_preview_keys_immutable
  ON public.official_prices;
CREATE TRIGGER official_prices_source_preview_keys_immutable
BEFORE UPDATE OF source_preview_keys ON public.official_prices
FOR EACH ROW
EXECUTE FUNCTION public.freeze_disclosure_source_preview_keys();

DROP TRIGGER IF EXISTS official_agency_packages_source_preview_keys_immutable
  ON public.official_agency_packages;
CREATE TRIGGER official_agency_packages_source_preview_keys_immutable
BEFORE UPDATE OF source_preview_keys ON public.official_agency_packages
FOR EACH ROW
EXECUTE FUNCTION public.freeze_disclosure_source_preview_keys();

-- Defense in depth: adding a column to a table with a table-level SELECT grant
-- would otherwise expose the new column. These staging tables are service-only;
-- consumers use explicit public views from the foundation migration.
REVOKE ALL ON TABLE public.official_prices, public.official_agency_packages
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.official_prices, public.official_agency_packages
  TO service_role;

-- No storage.objects policy is created. Only service-role server code can
-- upload/download these bounded text objects, and the admin API never signs a
-- preview URL or returns its content-addressed key.
INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'disclosure-preview',
  'disclosure-preview',
  false,
  2 * 1024 * 1024,
  ARRAY['text/plain']::text[]
)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

COMMIT;
