-- Build the official-disclosure foundation before any ingestion or public API
-- is enabled. This migration never imports or rewrites disclosure rows. Its
-- existing-row writes are limited to a conservative HTTPS-only legacy URL
-- backfill, deterministic tag seed upserts, and bucket hardening; apply only
-- through the release workflow with a database backup and rollback runbook.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS region_code text,
  ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS official_url text,
  ADD COLUMN IF NOT EXISTS instagram_url text,
  ADD COLUMN IF NOT EXISTS naver_place_url text,
  ADD COLUMN IF NOT EXISTS attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS enrichment_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS enriched_at timestamptz;

UPDATE public.vendors
SET official_url = NULLIF(btrim(website), '')
WHERE official_url IS NULL
  AND website ~ '^https://[^[:space:]]+$';

UPDATE public.vendors
SET instagram_url = NULLIF(btrim(instagram), '')
WHERE instagram_url IS NULL
  AND instagram ~ '^https://[^[:space:]]+$';

ALTER TABLE public.vendors
  DROP CONSTRAINT IF EXISTS vendors_public_attributes_check;

DO $vendor_enrichment_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.vendors'::regclass
      AND conname = 'vendors_enrichment_status_check'
  ) THEN
    ALTER TABLE public.vendors
      ADD CONSTRAINT vendors_enrichment_status_check
      CHECK (enrichment_status IN ('pending', 'in_progress', 'done', 'skip'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.vendors'::regclass
      AND conname = 'vendors_public_attributes_check'
  ) THEN
    ALTER TABLE public.vendors
      ADD CONSTRAINT vendors_public_attributes_check
      CHECK (
        jsonb_typeof(attributes) = 'object'
        AND NOT (
          attributes ?| ARRAY['notes_internal', 'price_band']::text[]
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.vendors'::regclass
      AND conname = 'vendors_aliases_check'
  ) THEN
    ALTER TABLE public.vendors
      ADD CONSTRAINT vendors_aliases_check
      CHECK (
        cardinality(aliases) <= 100
        AND array_position(aliases, '') IS NULL
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.vendors'::regclass
      AND conname = 'vendors_slug_check'
  ) THEN
    ALTER TABLE public.vendors
      ADD CONSTRAINT vendors_slug_check
      CHECK (
        slug IS NULL
        OR slug ~ '^[a-z0-9][a-z0-9-]{0,119}$'
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.vendors'::regclass
      AND conname = 'vendors_enrichment_urls_check'
  ) THEN
    ALTER TABLE public.vendors
      ADD CONSTRAINT vendors_enrichment_urls_check
      CHECK (
        (official_url IS NULL OR official_url ~ '^https://[^[:space:]]+$')
        AND (instagram_url IS NULL OR instagram_url ~ '^https://[^[:space:]]+$')
        AND (
          naver_place_url IS NULL
          OR naver_place_url ~ '^https://[^[:space:]]+$'
        )
      ) NOT VALID;
  END IF;
END;
$vendor_enrichment_constraints$;

ALTER TABLE public.vendors VALIDATE CONSTRAINT vendors_slug_check;
ALTER TABLE public.vendors VALIDATE CONSTRAINT vendors_enrichment_urls_check;

-- Work assignment and notes are intentionally separated from the public-readable
-- vendors row. The admin API validates the combined form, then stores only the
-- public keys in vendors.attributes and these private keys here.
CREATE TABLE IF NOT EXISTS public.vendor_enrichment_private (
  vendor_id uuid PRIMARY KEY REFERENCES public.vendors(id) ON DELETE CASCADE,
  price_band text,
  notes_internal text,
  enriched_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.vendor_enrichment_private
  ADD COLUMN IF NOT EXISTS price_band text;

DO $vendor_enrichment_private_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.vendor_enrichment_private'::regclass
      AND conname = 'vendor_enrichment_private_price_band_check'
  ) THEN
    ALTER TABLE public.vendor_enrichment_private
      ADD CONSTRAINT vendor_enrichment_private_price_band_check
      CHECK (
        price_band IS NULL
        OR price_band IN ('budget', 'mid', 'premium', 'luxury', 'unknown')
      );
  END IF;
END;
$vendor_enrichment_private_constraints$;

CREATE TABLE IF NOT EXISTS public.vendor_dedupe_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  left_vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  right_vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  reason text,
  similarity numeric,
  status text NOT NULL DEFAULT 'pending',
  preserved_vendor_id uuid REFERENCES public.vendors(id) ON DELETE CASCADE,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (left_vendor_id, right_vendor_id)
);

CREATE TABLE IF NOT EXISTS public.agencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  normalized_name text,
  aliases text[] NOT NULL DEFAULT '{}'::text[],
  corporate_name text,
  region_code text,
  source_file text,
  merged_into_agency_id uuid REFERENCES public.agencies(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agencies
  ADD COLUMN IF NOT EXISTS normalized_name text,
  ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS corporate_name text,
  ADD COLUMN IF NOT EXISTS region_code text,
  ADD COLUMN IF NOT EXISTS source_file text,
  ADD COLUMN IF NOT EXISTS merged_into_agency_id uuid REFERENCES public.agencies(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.agency_dedupe_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  left_agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  right_agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  reason text,
  similarity numeric,
  status text NOT NULL DEFAULT 'pending',
  preserved_agency_id uuid REFERENCES public.agencies(id) ON DELETE RESTRICT,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agency_dedupe_candidates_pair_order_check
    CHECK (left_agency_id < right_agency_id),
  CONSTRAINT agency_dedupe_candidates_similarity_check
    CHECK (similarity IS NULL OR similarity BETWEEN 0 AND 1),
  CONSTRAINT agency_dedupe_candidates_state_check
    CHECK (
      status IN ('pending', 'same', 'different', 'superseded')
      AND (
        (status = 'pending' AND preserved_agency_id IS NULL AND decided_by IS NULL AND decided_at IS NULL)
        OR (status = 'same' AND preserved_agency_id IN (left_agency_id, right_agency_id) AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
        OR (status = 'different' AND preserved_agency_id IS NULL AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
        OR (status = 'superseded' AND preserved_agency_id IS NULL AND decided_by IS NULL AND decided_at IS NOT NULL)
      )
    ),
  UNIQUE (left_agency_id, right_agency_id)
);

CREATE TABLE IF NOT EXISTS public.price_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_label text NOT NULL,
  source text NOT NULL DEFAULT 'kca_tprice',
  source_url text,
  published_at date,
  is_current boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.price_snapshots
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS published_at date,
  ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.official_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES public.price_snapshots(id) ON DELETE CASCADE,
  vendor_id uuid REFERENCES public.vendors(id) ON DELETE SET NULL,
  agency_id uuid REFERENCES public.agencies(id) ON DELETE SET NULL,
  category text NOT NULL,
  item_name text NOT NULL,
  base_spec text,
  price_min_krw integer,
  price_max_krw integer,
  vat_note text,
  price_note text,
  review_status text NOT NULL DEFAULT 'pending',
  needs_review boolean NOT NULL DEFAULT true,
  validation_issue_codes text[] NOT NULL DEFAULT '{}'::text[],
  source_file text,
  source_quote text,
  source_object_keys text[] NOT NULL DEFAULT '{}'::text[],
  source_record_key text,
  confidence numeric,
  edited_by_admin boolean NOT NULL DEFAULT false,
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_action text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.official_prices
  ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES public.vendors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS agency_id uuid REFERENCES public.agencies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS base_spec text,
  ADD COLUMN IF NOT EXISTS price_min_krw integer,
  ADD COLUMN IF NOT EXISTS price_max_krw integer,
  ADD COLUMN IF NOT EXISTS vat_note text,
  ADD COLUMN IF NOT EXISTS price_note text,
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS validation_issue_codes text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS source_file text,
  ADD COLUMN IF NOT EXISTS source_quote text,
  ADD COLUMN IF NOT EXISTS source_object_keys text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS source_record_key text,
  ADD COLUMN IF NOT EXISTS confidence numeric,
  ADD COLUMN IF NOT EXISTS edited_by_admin boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_action text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.official_price_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  official_price_id uuid NOT NULL REFERENCES public.official_prices(id) ON DELETE CASCADE,
  name text NOT NULL,
  price_min_krw integer,
  price_max_krw integer,
  unit text,
  condition text,
  raw_text text,
  source_file text,
  source_quote text,
  source_object_keys text[] NOT NULL DEFAULT '{}'::text[],
  confidence numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.official_price_options
  ADD COLUMN IF NOT EXISTS price_min_krw integer,
  ADD COLUMN IF NOT EXISTS price_max_krw integer,
  ADD COLUMN IF NOT EXISTS unit text,
  ADD COLUMN IF NOT EXISTS condition text,
  ADD COLUMN IF NOT EXISTS raw_text text,
  ADD COLUMN IF NOT EXISTS source_file text,
  ADD COLUMN IF NOT EXISTS source_quote text,
  ADD COLUMN IF NOT EXISTS source_object_keys text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS confidence numeric,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.official_agency_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES public.price_snapshots(id) ON DELETE CASCADE,
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE RESTRICT,
  package_name text NOT NULL,
  category_scope text[] NOT NULL DEFAULT '{}'::text[],
  price_min_krw integer,
  price_max_krw integer,
  vat_note text,
  price_note text,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  review_status text NOT NULL DEFAULT 'pending',
  needs_review boolean NOT NULL DEFAULT true,
  validation_issue_codes text[] NOT NULL DEFAULT '{}'::text[],
  source_file text,
  source_quote text,
  source_object_keys text[] NOT NULL DEFAULT '{}'::text[],
  confidence numeric,
  edited_by_admin boolean NOT NULL DEFAULT false,
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_action text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.official_agency_packages
  ADD COLUMN IF NOT EXISTS category_scope text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS price_min_krw integer,
  ADD COLUMN IF NOT EXISTS price_max_krw integer,
  ADD COLUMN IF NOT EXISTS vat_note text,
  ADD COLUMN IF NOT EXISTS price_note text,
  ADD COLUMN IF NOT EXISTS options jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS validation_issue_codes text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS source_file text,
  ADD COLUMN IF NOT EXISTS source_quote text,
  ADD COLUMN IF NOT EXISTS source_object_keys text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS confidence numeric,
  ADD COLUMN IF NOT EXISTS edited_by_admin boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_action text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anon_id text NOT NULL,
  vendor_id uuid REFERENCES public.vendors(id) ON DELETE SET NULL,
  surface text NOT NULL,
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES public.vendors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text,
  tag_group text NOT NULL,
  slug text NOT NULL,
  label text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tags
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.vendor_tags (
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'team',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (vendor_id, tag_id)
);

ALTER TABLE public.vendor_tags
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'team',
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- IF NOT EXISTS protects compatible first-pass tables, but it must not turn a
-- name collision with an incompatible table into a late, opaque index error.
DO $vendor_disclosure_required_columns$
DECLARE
  required_column record;
BEGIN
  FOR required_column IN
    SELECT *
    FROM (VALUES
      ('vendors', 'id'), ('vendors', 'name'), ('vendors', 'category'),
      ('vendors', 'status'), ('vendors', 'website'), ('vendors', 'instagram'),
      ('vendors', 'updated_at'),
      ('profiles', 'id'), ('profiles', 'is_admin'),
      ('agencies', 'id'), ('agencies', 'name'), ('agencies', 'aliases'),
      ('agency_dedupe_candidates', 'id'),
      ('agency_dedupe_candidates', 'left_agency_id'),
      ('agency_dedupe_candidates', 'right_agency_id'),
      ('price_snapshots', 'id'), ('price_snapshots', 'period_label'),
      ('price_snapshots', 'source'),
      ('official_prices', 'id'), ('official_prices', 'snapshot_id'),
      ('official_prices', 'category'), ('official_prices', 'item_name'),
      ('official_price_options', 'id'),
      ('official_price_options', 'official_price_id'),
      ('official_price_options', 'name'),
      ('official_agency_packages', 'id'),
      ('official_agency_packages', 'snapshot_id'),
      ('official_agency_packages', 'agency_id'),
      ('official_agency_packages', 'package_name'),
      ('events', 'id'), ('events', 'anon_id'), ('events', 'surface'),
      ('events', 'event_type'),
      ('tags', 'id'), ('tags', 'tag_group'), ('tags', 'slug'), ('tags', 'label'),
      ('vendor_tags', 'vendor_id'), ('vendor_tags', 'tag_id'),
      ('ai_interactions_log', 'interaction_type'),
      ('ai_interactions_log', 'metadata')
    ) AS required(table_name, column_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns AS existing_column
      WHERE existing_column.table_schema = 'public'
        AND existing_column.table_name = required_column.table_name
        AND existing_column.column_name = required_column.column_name
    ) THEN
      RAISE EXCEPTION 'VENDOR_DISCLOSURE_INCOMPATIBLE_SCHEMA: %.% missing',
        required_column.table_name,
        required_column.column_name
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END;
$vendor_disclosure_required_columns$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vendors_slug_unique
  ON public.vendors (slug)
  WHERE slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vendors_enrichment_queue
  ON public.vendors (enrichment_status, category, region_code);

CREATE INDEX IF NOT EXISTS idx_vendor_dedupe_candidates_queue
  ON public.vendor_dedupe_candidates (status, similarity DESC, created_at);
CREATE INDEX IF NOT EXISTS idx_vendor_dedupe_candidates_right_vendor
  ON public.vendor_dedupe_candidates (right_vendor_id);

DROP INDEX IF EXISTS public.idx_agencies_region_normalized_name_unique;
CREATE UNIQUE INDEX idx_agencies_region_normalized_name_unique
  ON public.agencies (region_code, normalized_name)
  WHERE region_code IS NOT NULL
    AND normalized_name IS NOT NULL
    AND merged_into_agency_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_agency_dedupe_candidates_queue
  ON public.agency_dedupe_candidates (status, similarity DESC, created_at);
CREATE INDEX IF NOT EXISTS idx_agency_dedupe_candidates_right_agency
  ON public.agency_dedupe_candidates (right_agency_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_price_snapshots_source_period_unique
  ON public.price_snapshots (source, period_label);
CREATE UNIQUE INDEX IF NOT EXISTS idx_price_snapshots_one_current_per_source
  ON public.price_snapshots (source)
  WHERE is_current = true;

CREATE INDEX IF NOT EXISTS idx_official_prices_snapshot_review
  ON public.official_prices (snapshot_id, review_status);
CREATE INDEX IF NOT EXISTS idx_official_prices_vendor_snapshot
  ON public.official_prices (vendor_id, snapshot_id)
  WHERE vendor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_official_prices_agency_snapshot
  ON public.official_prices (agency_id, snapshot_id)
  WHERE agency_id IS NOT NULL;
DROP INDEX IF EXISTS public.idx_official_prices_source_identity_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_official_prices_source_record_unique
  ON public.official_prices (snapshot_id, source_record_key)
  WHERE source_record_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_official_price_options_price
  ON public.official_price_options (official_price_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_official_price_options_identity_unique
  ON public.official_price_options (
    official_price_id,
    name,
    COALESCE(unit, ''),
    COALESCE(condition, '')
  );

CREATE INDEX IF NOT EXISTS idx_official_agency_packages_snapshot_review
  ON public.official_agency_packages (snapshot_id, review_status);
CREATE INDEX IF NOT EXISTS idx_official_agency_packages_agency_snapshot
  ON public.official_agency_packages (agency_id, snapshot_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_official_agency_packages_identity_unique
  ON public.official_agency_packages (
    snapshot_id,
    agency_id,
    package_name,
    COALESCE(source_file, '')
  );

CREATE INDEX IF NOT EXISTS idx_events_surface_type_created
  ON public.events (surface, event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_vendor_created
  ON public.events (vendor_id, created_at DESC)
  WHERE vendor_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_slug_unique
  ON public.tags (slug);
CREATE INDEX IF NOT EXISTS idx_tags_category_group_active
  ON public.tags (category, tag_group)
  WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_vendor_tags_tag_vendor
  ON public.vendor_tags (tag_id, vendor_id);

-- Keep the global AI audit vocabulary compatible with the disclosure loader.
-- This changes constraint metadata only and preserves every existing log row.
ALTER TABLE public.ai_interactions_log
  DROP CONSTRAINT IF EXISTS ai_interactions_log_interaction_type_check;
ALTER TABLE public.ai_interactions_log
  ADD CONSTRAINT ai_interactions_log_interaction_type_check
  CHECK (interaction_type IN (
    'chat_turn',
    'tool_call',
    'tool_result',
    'amora_director',
    'vendor_recommendation',
    'feedback',
    'community_amora_comment',
    'community_agent_auto',
    'disclosure_extraction'
  )) NOT VALID;
ALTER TABLE public.ai_interactions_log
  VALIDATE CONSTRAINT ai_interactions_log_interaction_type_check;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_log_disclosure_ingest_call_unique
  ON public.ai_interactions_log ((metadata ->> 'ingest_call_id'))
  WHERE interaction_type = 'disclosure_extraction'
    AND NULLIF(metadata ->> 'ingest_call_id', '') IS NOT NULL;

-- Storage object keys are intentionally stricter than human-readable
-- source_file paths. The loader stores immutable evidence as `{sha256}.{ext}`;
-- this validator prevents absolute paths, traversal, and URLs. Repeated keys
-- are allowed because source_file and source_object_keys retain positional
-- provenance when two differently named originals have identical bytes.
CREATE OR REPLACE FUNCTION public.disclosure_object_keys_are_safe(
  p_object_keys text[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $disclosure_object_keys_are_safe$
  SELECT
    p_object_keys IS NOT NULL
    AND cardinality(p_object_keys) <= 100
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(p_object_keys) AS object_key(value)
      WHERE value IS NULL
        OR value !~ '^[0-9a-f]{64}\.(xlsx|docx|hwp|pdf|png)$'
    );
$disclosure_object_keys_are_safe$;

REVOKE ALL ON FUNCTION public.disclosure_object_keys_are_safe(text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.disclosure_object_keys_are_safe(text[])
  TO service_role;

-- Replace the earlier approved-row checks so all newly approved rows must
-- point at immutable Storage evidence. NOT VALID deliberately preserves a
-- safe migration path for legacy approved rows; public views hide those rows
-- until an admin re-reviews them with mapped evidence keys.
ALTER TABLE public.official_prices
  DROP CONSTRAINT IF EXISTS official_prices_approved_provenance_check;
ALTER TABLE public.official_agency_packages
  DROP CONSTRAINT IF EXISTS official_agency_packages_approved_provenance_check;
ALTER TABLE public.vendor_dedupe_candidates
  DROP CONSTRAINT IF EXISTS vendor_dedupe_candidates_state_check;

DO $disclosure_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.agencies'::regclass
      AND conname = 'agencies_name_not_blank_check'
  ) THEN
    ALTER TABLE public.agencies
      ADD CONSTRAINT agencies_name_not_blank_check
      CHECK (btrim(name) <> '') NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.agencies'::regclass
      AND conname = 'agencies_aliases_and_merge_check'
  ) THEN
    ALTER TABLE public.agencies
      ADD CONSTRAINT agencies_aliases_and_merge_check
      CHECK (
        cardinality(aliases) <= 100
        AND array_position(aliases, '') IS NULL
        AND (merged_into_agency_id IS NULL OR merged_into_agency_id <> id)
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.price_snapshots'::regclass
      AND conname = 'price_snapshots_identity_not_blank_check'
  ) THEN
    ALTER TABLE public.price_snapshots
      ADD CONSTRAINT price_snapshots_identity_not_blank_check
      CHECK (btrim(period_label) <> '' AND btrim(source) <> '') NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.official_prices'::regclass
      AND conname = 'official_prices_category_check'
  ) THEN
    ALTER TABLE public.official_prices
      ADD CONSTRAINT official_prices_category_check
      CHECK (category IN ('studio', 'dress', 'makeup', 'hall', 'other'))
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.official_prices'::regclass
      AND conname = 'official_prices_review_status_check'
  ) THEN
    ALTER TABLE public.official_prices
      ADD CONSTRAINT official_prices_review_status_check
      CHECK (review_status IN ('pending', 'approved', 'rejected')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.official_prices'::regclass
      AND conname = 'official_prices_value_check'
  ) THEN
    ALTER TABLE public.official_prices
      ADD CONSTRAINT official_prices_value_check
      CHECK (
        btrim(category) <> ''
        AND btrim(item_name) <> ''
        AND (price_min_krw IS NULL OR price_min_krw >= 0)
        AND (price_max_krw IS NULL OR price_max_krw >= 0)
        AND (
          price_min_krw IS NULL
          OR price_max_krw IS NULL
          OR price_min_krw <= price_max_krw
        )
        AND (confidence IS NULL OR confidence BETWEEN 0 AND 1)
        AND cardinality(validation_issue_codes) <= 100
        AND array_position(validation_issue_codes, '') IS NULL
        AND (
          (
            reviewed_by IS NULL
            AND reviewed_at IS NULL
            AND review_action IS NULL
          )
          OR (
            reviewed_by IS NOT NULL
            AND reviewed_at IS NOT NULL
            AND review_action IN ('save', 'approve', 'reject')
          )
        )
        AND (
          source_record_key IS NULL
          OR NULLIF(btrim(source_record_key), '') IS NOT NULL
        )
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.official_prices'::regclass
      AND conname = 'official_prices_source_object_keys_check'
  ) THEN
    ALTER TABLE public.official_prices
      ADD CONSTRAINT official_prices_source_object_keys_check
      CHECK (public.disclosure_object_keys_are_safe(source_object_keys))
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.official_prices'::regclass
      AND conname = 'official_prices_approved_provenance_check'
  ) THEN
    ALTER TABLE public.official_prices
      ADD CONSTRAINT official_prices_approved_provenance_check
      CHECK (
        review_status <> 'approved'
        OR (
          needs_review = false
          AND NULLIF(btrim(source_file), '') IS NOT NULL
          AND NULLIF(btrim(source_quote), '') IS NOT NULL
          AND cardinality(source_object_keys) > 0
          AND confidence IS NOT NULL
        )
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.official_price_options'::regclass
      AND conname = 'official_price_options_source_object_keys_check'
  ) THEN
    ALTER TABLE public.official_price_options
      ADD CONSTRAINT official_price_options_source_object_keys_check
      CHECK (public.disclosure_object_keys_are_safe(source_object_keys))
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.official_price_options'::regclass
      AND conname = 'official_price_options_value_check'
  ) THEN
    ALTER TABLE public.official_price_options
      ADD CONSTRAINT official_price_options_value_check
      CHECK (
        btrim(name) <> ''
        AND (price_min_krw IS NULL OR price_min_krw >= 0)
        AND (price_max_krw IS NULL OR price_max_krw >= 0)
        AND (
          price_min_krw IS NULL
          OR price_max_krw IS NULL
          OR price_min_krw <= price_max_krw
        )
        AND (confidence IS NULL OR confidence BETWEEN 0 AND 1)
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.official_agency_packages'::regclass
      AND conname = 'official_agency_packages_source_object_keys_check'
  ) THEN
    ALTER TABLE public.official_agency_packages
      ADD CONSTRAINT official_agency_packages_source_object_keys_check
      CHECK (public.disclosure_object_keys_are_safe(source_object_keys))
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.official_agency_packages'::regclass
      AND conname = 'official_agency_packages_review_status_check'
  ) THEN
    ALTER TABLE public.official_agency_packages
      ADD CONSTRAINT official_agency_packages_review_status_check
      CHECK (review_status IN ('pending', 'approved', 'rejected')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.official_agency_packages'::regclass
      AND conname = 'official_agency_packages_value_check'
  ) THEN
    ALTER TABLE public.official_agency_packages
      ADD CONSTRAINT official_agency_packages_value_check
      CHECK (
        btrim(package_name) <> ''
        AND jsonb_typeof(options) = 'array'
        AND (price_min_krw IS NULL OR price_min_krw >= 0)
        AND (price_max_krw IS NULL OR price_max_krw >= 0)
        AND (
          price_min_krw IS NULL
          OR price_max_krw IS NULL
          OR price_min_krw <= price_max_krw
        )
        AND (confidence IS NULL OR confidence BETWEEN 0 AND 1)
        AND cardinality(validation_issue_codes) <= 100
        AND array_position(validation_issue_codes, '') IS NULL
        AND (
          (
            reviewed_by IS NULL
            AND reviewed_at IS NULL
            AND review_action IS NULL
          )
          OR (
            reviewed_by IS NOT NULL
            AND reviewed_at IS NOT NULL
            AND review_action IN ('save', 'approve', 'reject')
          )
        )
        AND category_scope <@ ARRAY['studio', 'dress', 'makeup', 'venue']::text[]
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.official_agency_packages'::regclass
      AND conname = 'official_agency_packages_approved_provenance_check'
  ) THEN
    ALTER TABLE public.official_agency_packages
      ADD CONSTRAINT official_agency_packages_approved_provenance_check
      CHECK (
        review_status <> 'approved'
        OR (
          needs_review = false
          AND
          NULLIF(btrim(source_file), '') IS NOT NULL
          AND NULLIF(btrim(source_quote), '') IS NOT NULL
          AND cardinality(source_object_keys) > 0
          AND confidence IS NOT NULL
        )
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.events'::regclass
      AND conname = 'events_identity_not_blank_check'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_identity_not_blank_check
      CHECK (
        btrim(anon_id) <> ''
        AND btrim(surface) <> ''
        AND btrim(event_type) <> ''
        AND jsonb_typeof(metadata) = 'object'
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.tags'::regclass
      AND conname = 'tags_identity_check'
  ) THEN
    ALTER TABLE public.tags
      ADD CONSTRAINT tags_identity_check
      CHECK (
        btrim(tag_group) <> ''
        AND slug ~ '^[a-z0-9][a-z0-9_-]*$'
        AND btrim(label) <> ''
        AND (category IS NULL OR category IN ('studio', 'dress', 'makeup', 'venue'))
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.vendor_tags'::regclass
      AND conname = 'vendor_tags_source_check'
  ) THEN
    ALTER TABLE public.vendor_tags
      ADD CONSTRAINT vendor_tags_source_check
      CHECK (source IN ('team', 'official_doc', 'user_review')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.vendor_dedupe_candidates'::regclass
      AND conname = 'vendor_dedupe_candidates_state_check'
  ) THEN
    ALTER TABLE public.vendor_dedupe_candidates
      ADD CONSTRAINT vendor_dedupe_candidates_state_check
      CHECK (
        left_vendor_id < right_vendor_id
        AND (similarity IS NULL OR similarity BETWEEN 0 AND 1)
        AND status IN ('pending', 'same', 'different', 'superseded')
        AND (
          (
            status = 'pending'
            AND preserved_vendor_id IS NULL
            AND decided_by IS NULL
            AND decided_at IS NULL
          )
          OR (
            status = 'same'
            AND preserved_vendor_id IN (left_vendor_id, right_vendor_id)
            AND decided_by IS NOT NULL
            AND decided_at IS NOT NULL
          )
          OR (
            status = 'different'
            AND preserved_vendor_id IS NULL
            AND decided_by IS NOT NULL
            AND decided_at IS NOT NULL
          )
          OR (
            status = 'superseded'
            AND preserved_vendor_id IS NULL
            AND decided_by IS NOT NULL
            AND decided_at IS NOT NULL
          )
        )
      ) NOT VALID;
  END IF;
END;
$disclosure_constraints$;

ALTER TABLE public.agencies
  VALIDATE CONSTRAINT agencies_name_not_blank_check;
ALTER TABLE public.agencies
  VALIDATE CONSTRAINT agencies_aliases_and_merge_check;
ALTER TABLE public.price_snapshots
  VALIDATE CONSTRAINT price_snapshots_identity_not_blank_check;
ALTER TABLE public.official_prices
  VALIDATE CONSTRAINT official_prices_review_status_check;
ALTER TABLE public.official_prices
  VALIDATE CONSTRAINT official_prices_value_check;
ALTER TABLE public.official_prices
  VALIDATE CONSTRAINT official_prices_source_object_keys_check;
ALTER TABLE public.official_price_options
  VALIDATE CONSTRAINT official_price_options_value_check;
ALTER TABLE public.official_price_options
  VALIDATE CONSTRAINT official_price_options_source_object_keys_check;
ALTER TABLE public.official_agency_packages
  VALIDATE CONSTRAINT official_agency_packages_review_status_check;
ALTER TABLE public.official_agency_packages
  VALIDATE CONSTRAINT official_agency_packages_value_check;
ALTER TABLE public.official_agency_packages
  VALIDATE CONSTRAINT official_agency_packages_source_object_keys_check;
ALTER TABLE public.events
  VALIDATE CONSTRAINT events_identity_not_blank_check;
ALTER TABLE public.tags
  VALIDATE CONSTRAINT tags_identity_check;
ALTER TABLE public.vendor_tags
  VALIDATE CONSTRAINT vendor_tags_source_check;
ALTER TABLE public.vendor_dedupe_candidates
  VALIDATE CONSTRAINT vendor_dedupe_candidates_state_check;

INSERT INTO public.tags (category, tag_group, slug, label)
VALUES
  ('studio', 'shoot_style', 'studio-portrait-focus', '인물중심'),
  ('studio', 'shoot_style', 'studio-background-focus', '배경중심'),
  ('studio', 'shoot_style', 'studio-natural-light', '자연광'),
  ('studio', 'shoot_style', 'studio-film-mood', '필름감성'),
  ('studio', 'shoot_style', 'studio-black-and-white', '흑백'),
  ('studio', 'shoot_style', 'studio-cinematic', '시네마틱'),
  ('studio', 'shoot_style', 'studio-classic', '클래식'),
  ('studio', 'shoot_style', 'studio-minimal', '미니멀'),
  ('studio', 'shoot_style', 'studio-kitsch', '키치'),
  ('studio', 'shoot_style', 'studio-editorial', '화보풍'),
  ('studio', 'shoot_style', 'studio-lovely', '러블리'),
  ('studio', 'shoot_style', 'studio-unique', '유니크'),
  ('dress', 'dress_detail', 'dress-beading', '비즈'),
  ('dress', 'dress_detail', 'dress-lace', '레이스'),
  ('dress', 'dress_detail', 'dress-silk', '실크'),
  ('dress', 'dress_detail', 'dress-satin', '새틴'),
  ('dress', 'dress_detail', 'dress-minimal', '미니멀'),
  ('dress', 'dress_detail', 'dress-vintage', '빈티지'),
  ('dress', 'dress_detail', 'dress-volume', '볼륨'),
  ('dress', 'dress_detail', 'dress-romantic', '로맨틱'),
  ('dress', 'dress_detail', 'dress-modern', '모던'),
  ('dress', 'dress_detail', 'dress-classic', '클래식'),
  ('dress', 'dress_detail', 'dress-off-shoulder', '오프숄더'),
  ('dress', 'dress_detail', 'dress-halter-neck', '홀터넥'),
  ('makeup', 'makeup_style', 'makeup-natural', '내추럴'),
  ('makeup', 'makeup_style', 'makeup-glam', '글램'),
  ('makeup', 'makeup_style', 'makeup-dewy', '물광'),
  ('makeup', 'makeup_style', 'makeup-matte', '매트'),
  ('makeup', 'makeup_style', 'makeup-pure', '청순'),
  ('makeup', 'makeup_style', 'makeup-bright', '화사'),
  ('makeup', 'makeup_style', 'makeup-hanbok-glam', '한복글램'),
  ('venue', 'hall_mood', 'venue-daylight', '채광좋음'),
  ('venue', 'hall_mood', 'venue-high-ceiling', '고천장'),
  ('venue', 'hall_mood', 'venue-modern', '모던'),
  ('venue', 'hall_mood', 'venue-classic', '클래식'),
  ('venue', 'hall_mood', 'venue-garden-view', '가든뷰'),
  ('venue', 'hall_mood', 'venue-city-view', '시티뷰'),
  ('venue', 'hall_mood', 'venue-small-wedding', '스몰웨딩적합')
ON CONFLICT (slug) DO UPDATE
SET category = EXCLUDED.category,
    tag_group = EXCLUDED.tag_group,
    label = EXCLUDED.label,
    is_active = true,
    updated_at = now();

DO $service_only_rls$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'vendor_enrichment_private',
    'vendor_dedupe_candidates',
    'agency_dedupe_candidates',
    'agencies',
    'price_snapshots',
    'official_prices',
    'official_price_options',
    'official_agency_packages',
    'events',
    'tags',
    'vendor_tags'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'DROP POLICY IF EXISTS vendor_disclosure_service_all ON public.%I',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY vendor_disclosure_service_all ON public.%I '
      || 'FOR ALL TO service_role USING (true) WITH CHECK (true)',
      table_name
    );
  END LOOP;
END;
$service_only_rls$;

REVOKE ALL ON TABLE
  public.vendor_enrichment_private,
  public.vendor_dedupe_candidates,
  public.agency_dedupe_candidates,
  public.agencies,
  public.price_snapshots,
  public.official_prices,
  public.official_price_options,
  public.official_agency_packages,
  public.events,
  public.tags,
  public.vendor_tags
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.vendor_enrichment_private,
  public.vendor_dedupe_candidates,
  public.agency_dedupe_candidates,
  public.agencies,
  public.price_snapshots,
  public.official_prices,
  public.official_price_options,
  public.official_agency_packages,
  public.events,
  public.tags,
  public.vendor_tags
TO service_role;

-- Row-level approval policies cannot protect sensitive or future columns on an
-- approved vendor. Browser/mobile roles never read this base table directly;
-- public reads use a safe public view or a server-owned service-role allow-list.
-- Revoke both table-wide and historical per-column grants. V2 enrichment
-- remains available through the safe public view below.
REVOKE SELECT ON TABLE public.vendors FROM PUBLIC, anon, authenticated;

DO $vendor_public_column_privileges$
DECLARE
  all_columns text;
  exposed_column text;
BEGIN
  SELECT string_agg(format('%I', column_name), ', ' ORDER BY ordinal_position)
  INTO all_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'vendors';

  IF all_columns IS NULL THEN
    RAISE EXCEPTION 'VENDOR_PUBLIC_COLUMNS_TABLE_MISSING'
      USING ERRCODE = '55000';
  END IF;

  EXECUTE format(
    'REVOKE SELECT (%s) ON TABLE public.vendors FROM PUBLIC, anon, authenticated',
    all_columns
  );

  IF has_table_privilege('anon', 'public.vendors', 'SELECT')
    OR has_table_privilege('authenticated', 'public.vendors', 'SELECT')
  THEN
    RAISE EXCEPTION 'VENDOR_PUBLIC_TABLE_SELECT_STILL_GRANTED'
      USING ERRCODE = '55000';
  END IF;

  SELECT existing.column_name
  INTO exposed_column
  FROM information_schema.columns AS existing
  WHERE existing.table_schema = 'public'
    AND existing.table_name = 'vendors'
    AND (
      has_column_privilege(
        'anon', 'public.vendors', existing.column_name, 'SELECT'
      )
      OR has_column_privilege(
        'authenticated', 'public.vendors', existing.column_name, 'SELECT'
      )
    )
  ORDER BY existing.ordinal_position
  LIMIT 1;

  IF exposed_column IS NOT NULL THEN
    RAISE EXCEPTION 'VENDOR_PUBLIC_COLUMN_SELECT_STILL_GRANTED: %',
      exposed_column
      USING ERRCODE = '55000';
  END IF;
END;
$vendor_public_column_privileges$;

CREATE OR REPLACE FUNCTION public.merge_vendor_aliases(
  p_vendor_id uuid,
  p_aliases text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $merge_vendor_aliases$
DECLARE
  vendor_name text;
  existing_aliases text[];
  merged_aliases text[];
BEGIN
  IF p_aliases IS NULL OR cardinality(p_aliases) > 100 THEN
    RAISE EXCEPTION 'VENDOR_ALIASES_INVALID_INPUT'
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(p_aliases) AS requested(alias_value)
    WHERE alias_value IS NULL
      OR NULLIF(btrim(alias_value), '') IS NULL
      OR length(btrim(alias_value)) > 200
  ) THEN
    RAISE EXCEPTION 'VENDOR_ALIASES_INVALID_VALUE'
      USING ERRCODE = '22023';
  END IF;

  SELECT name, aliases
  INTO vendor_name, existing_aliases
  FROM public.vendors
  WHERE id = p_vendor_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VENDOR_ALIASES_VENDOR_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(
    array_agg(normalized.alias_value ORDER BY normalized.alias_value),
    '{}'::text[]
  )
  INTO merged_aliases
  FROM (
    SELECT DISTINCT btrim(alias_value) AS alias_value
    FROM unnest(
      COALESCE(existing_aliases, '{}'::text[]) || p_aliases
    ) AS alias_source(alias_value)
    WHERE NULLIF(btrim(alias_value), '') IS NOT NULL
      AND btrim(alias_value) <> btrim(vendor_name)
  ) AS normalized;

  IF cardinality(merged_aliases) > 100 THEN
    RAISE EXCEPTION 'VENDOR_ALIASES_LIMIT_EXCEEDED'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.vendors
  SET aliases = merged_aliases,
      updated_at = now()
  WHERE id = p_vendor_id
    AND aliases IS DISTINCT FROM merged_aliases;
END;
$merge_vendor_aliases$;

REVOKE ALL ON FUNCTION public.merge_vendor_aliases(uuid, text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_vendor_aliases(uuid, text[])
  TO service_role;

CREATE OR REPLACE FUNCTION public.assign_vendor_enrichment(
  p_vendor_id uuid,
  p_actor_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $assign_vendor_enrichment$
DECLARE
  vendor_state text;
  vendor_public_status text;
  current_actor uuid;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'VENDOR_ENRICHMENT_ACTOR_REQUIRED'
      USING ERRCODE = '22023';
  END IF;

  SELECT enrichment_status, status
  INTO vendor_state, vendor_public_status
  FROM public.vendors
  WHERE id = p_vendor_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VENDOR_ENRICHMENT_VENDOR_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;
  IF vendor_public_status IS NULL
    OR vendor_public_status NOT IN ('pending', 'approved')
  THEN
    RAISE EXCEPTION 'VENDOR_ENRICHMENT_VENDOR_INACTIVE'
      USING ERRCODE = '55000';
  END IF;
  IF vendor_state = 'done' THEN
    RAISE EXCEPTION 'VENDOR_ENRICHMENT_VENDOR_DONE'
      USING ERRCODE = '55000';
  END IF;
  IF vendor_state = 'skip' THEN
    RAISE EXCEPTION 'VENDOR_ENRICHMENT_VENDOR_SKIPPED'
      USING ERRCODE = '55000';
  END IF;

  SELECT enriched_by
  INTO current_actor
  FROM public.vendor_enrichment_private
  WHERE vendor_id = p_vendor_id;

  IF vendor_state = 'in_progress'
    AND current_actor IS NOT NULL
    AND current_actor <> p_actor_id
  THEN
    RAISE EXCEPTION 'VENDOR_ENRICHMENT_ALREADY_ASSIGNED'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.vendor_enrichment_private (
    vendor_id, enriched_by, updated_at
  ) VALUES (
    p_vendor_id, p_actor_id, now()
  )
  ON CONFLICT (vendor_id) DO UPDATE
  SET enriched_by = EXCLUDED.enriched_by,
      updated_at = EXCLUDED.updated_at;

  UPDATE public.vendors
  SET enrichment_status = 'in_progress',
      updated_at = now()
  WHERE id = p_vendor_id;
END;
$assign_vendor_enrichment$;

-- Match the admin API trust boundary inside the write RPC as well. The helper
-- is deliberately conservative and does not fetch or resolve the URL: it only
-- accepts HTTPS, no credentials, no non-standard port, and (when supplied) an
-- exact hostname or subdomain boundary. This prevents a service-role caller
-- from bypassing the API parser with instagram.com.evil.example-style values.
CREATE OR REPLACE FUNCTION public.vendor_enrichment_url_is_allowed(
  p_url text,
  p_allowed_domains text[]
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $vendor_enrichment_url_is_allowed$
DECLARE
  authority text;
  hostname text;
  port_text text;
BEGIN
  IF p_url IS NULL THEN
    RETURN true;
  END IF;
  IF p_url <> btrim(p_url)
    OR char_length(p_url) > 2000
    OR p_url !~ '^https://'
    OR p_url ~ '[[:space:]\\]'
  THEN
    RETURN false;
  END IF;

  authority := substring(p_url FROM '^https://([^/?#]*)');
  IF authority IS NULL OR authority = '' OR position('@' IN authority) > 0 THEN
    RETURN false;
  END IF;

  IF authority ~ '^\[[0-9A-Fa-f:.]+\](?::[0-9]+)?$' THEN
    hostname := substring(authority FROM '^\[([0-9A-Fa-f:.]+)\]');
    port_text := substring(authority FROM '\]:([0-9]+)$');
  ELSIF authority ~ '^[^:]+(?::[0-9]+)?$' THEN
    hostname := regexp_replace(authority, ':[0-9]+$', '');
    port_text := substring(authority FROM ':([0-9]+)$');
  ELSE
    RETURN false;
  END IF;

  IF port_text IS NOT NULL AND port_text !~ '^0*443$' THEN
    RETURN false;
  END IF;
  hostname := lower(regexp_replace(hostname, '\.$', ''));
  IF hostname = ''
    OR hostname ~ '[%]'
    OR hostname ~ '^\.'
    OR hostname ~ '\.\.'
  THEN
    RETURN false;
  END IF;

  IF cardinality(COALESCE(p_allowed_domains, '{}'::text[])) > 0
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(p_allowed_domains) AS allowed(domain)
      WHERE hostname = lower(allowed.domain)
        OR right(hostname, char_length(allowed.domain) + 1)
          = '.' || lower(allowed.domain)
    )
  THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$vendor_enrichment_url_is_allowed$;

REVOKE ALL ON FUNCTION public.vendor_enrichment_url_is_allowed(text, text[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vendor_enrichment_url_is_allowed(text, text[])
  TO anon, authenticated;

DROP FUNCTION IF EXISTS public.save_vendor_enrichment(
  uuid, uuid, text, text, text, jsonb, text, uuid[], boolean
);

CREATE OR REPLACE FUNCTION public.save_vendor_enrichment(
  p_vendor_id uuid,
  p_actor_id uuid,
  p_official_url text,
  p_instagram_url text,
  p_naver_place_url text,
  p_attributes jsonb,
  p_price_band text,
  p_notes_internal text,
  p_tag_ids uuid[],
  p_complete boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $save_vendor_enrichment$
DECLARE
  vendor_category text;
  vendor_state text;
  vendor_public_status text;
  current_actor uuid;
  normalized_tag_ids uuid[] := COALESCE(p_tag_ids, '{}'::uuid[]);
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'VENDOR_ENRICHMENT_ACTOR_REQUIRED'
      USING ERRCODE = '22023';
  END IF;
  IF p_complete IS NULL THEN
    RAISE EXCEPTION 'VENDOR_ENRICHMENT_COMPLETION_REQUIRED'
      USING ERRCODE = '22023';
  END IF;
  IF p_attributes IS NULL OR jsonb_typeof(p_attributes) <> 'object' THEN
    RAISE EXCEPTION 'VENDOR_ENRICHMENT_ATTRIBUTES_NOT_OBJECT'
      USING ERRCODE = '22023';
  END IF;
  IF p_attributes ?| ARRAY['notes_internal', 'price_band']::text[] THEN
    RAISE EXCEPTION 'VENDOR_ENRICHMENT_PRIVATE_VALUE_IN_PUBLIC_ATTRIBUTES'
      USING ERRCODE = '22023';
  END IF;
  IF p_price_band IS NOT NULL
    AND p_price_band NOT IN ('budget', 'mid', 'premium', 'luxury', 'unknown')
  THEN
    RAISE EXCEPTION 'VENDOR_ENRICHMENT_INVALID_PRICE_BAND'
      USING ERRCODE = '22023';
  END IF;
  IF p_notes_internal IS NOT NULL AND length(p_notes_internal) > 5000 THEN
    RAISE EXCEPTION 'VENDOR_ENRICHMENT_NOTE_TOO_LONG'
      USING ERRCODE = '22023';
  END IF;
  IF NOT public.vendor_enrichment_url_is_allowed(
    p_official_url,
    '{}'::text[]
  ) THEN
    RAISE EXCEPTION 'VENDOR_ENRICHMENT_URL_INVALID: official_url'
      USING ERRCODE = '22023';
  END IF;
  IF NOT public.vendor_enrichment_url_is_allowed(
    p_instagram_url,
    ARRAY['instagram.com']::text[]
  ) THEN
    RAISE EXCEPTION 'VENDOR_ENRICHMENT_URL_INVALID: instagram_url'
      USING ERRCODE = '22023';
  END IF;
  IF NOT public.vendor_enrichment_url_is_allowed(
    p_naver_place_url,
    ARRAY['naver.com', 'naver.me']::text[]
  ) THEN
    RAISE EXCEPTION 'VENDOR_ENRICHMENT_URL_INVALID: naver_place_url'
      USING ERRCODE = '22023';
  END IF;

  SELECT category, enrichment_status, status
  INTO vendor_category, vendor_state, vendor_public_status
  FROM public.vendors
  WHERE id = p_vendor_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VENDOR_ENRICHMENT_VENDOR_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;
  IF vendor_public_status IS NULL
    OR vendor_public_status NOT IN ('pending', 'approved')
  THEN
    RAISE EXCEPTION 'VENDOR_ENRICHMENT_VENDOR_INACTIVE'
      USING ERRCODE = '55000';
  END IF;
  IF vendor_state = 'skip' THEN
    RAISE EXCEPTION 'VENDOR_ENRICHMENT_VENDOR_SKIPPED'
      USING ERRCODE = '55000';
  END IF;

  SELECT enriched_by
  INTO current_actor
  FROM public.vendor_enrichment_private
  WHERE vendor_id = p_vendor_id;

  IF current_actor IS NOT NULL AND current_actor <> p_actor_id THEN
    RAISE EXCEPTION 'VENDOR_ENRICHMENT_ASSIGNMENT_MISMATCH'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(normalized_tag_ids) AS requested(tag_id)
    LEFT JOIN public.tags AS tag_row
      ON tag_row.id = requested.tag_id
    WHERE tag_row.id IS NULL
      OR tag_row.is_active = false
      OR (tag_row.category IS NOT NULL AND tag_row.category <> vendor_category)
  ) THEN
    RAISE EXCEPTION 'VENDOR_ENRICHMENT_TAG_CATEGORY_MISMATCH'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.vendors
  SET website = p_official_url,
      instagram = p_instagram_url,
      official_url = p_official_url,
      instagram_url = p_instagram_url,
      naver_place_url = p_naver_place_url,
      attributes = p_attributes,
      enrichment_status = CASE WHEN p_complete THEN 'done' ELSE 'in_progress' END,
      enriched_at = CASE WHEN p_complete THEN now() ELSE NULL END,
      updated_at = now()
  WHERE id = p_vendor_id;

  INSERT INTO public.vendor_enrichment_private (
    vendor_id, price_band, notes_internal, enriched_by, updated_at
  ) VALUES (
    p_vendor_id, p_price_band, p_notes_internal, p_actor_id, now()
  )
  ON CONFLICT (vendor_id) DO UPDATE
  SET price_band = EXCLUDED.price_band,
      notes_internal = EXCLUDED.notes_internal,
      enriched_by = EXCLUDED.enriched_by,
      updated_at = EXCLUDED.updated_at;

  DELETE FROM public.vendor_tags
  WHERE vendor_id = p_vendor_id
    AND source = 'team';

  INSERT INTO public.vendor_tags (vendor_id, tag_id, source)
  SELECT p_vendor_id, requested.tag_id, 'team'
  FROM (
    SELECT DISTINCT tag_id
    FROM unnest(normalized_tag_ids) AS input(tag_id)
  ) AS requested
  -- A document/review assertion has stronger provenance than a team checkbox.
  -- The current PK cannot store both, so preserve the existing non-team row.
  ON CONFLICT (vendor_id, tag_id) DO NOTHING;
END;
$save_vendor_enrichment$;

REVOKE ALL ON FUNCTION public.assign_vendor_enrichment(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_vendor_enrichment(uuid, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.save_vendor_enrichment(
  uuid, uuid, text, text, text, jsonb, text, text, uuid[], boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_vendor_enrichment(
  uuid, uuid, text, text, text, jsonb, text, text, uuid[], boolean
) TO service_role;

-- One transaction owns parent review state and its complete option set. The
-- RPC never accepts source_file/source_object_keys, so evidence identity cannot
-- be rewritten from an admin form. It validates quotes; it never invents them.
CREATE OR REPLACE FUNCTION public.review_official_price(
  p_price_id uuid,
  p_actor_id uuid,
  p_action text,
  p_values jsonb,
  p_options jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $review_official_price$
DECLARE
  current_price public.official_prices%ROWTYPE;
  current_option public.official_price_options%ROWTYPE;
  value_keys constant text[] := ARRAY[
    'category', 'item_name', 'base_spec', 'price_min_krw',
    'price_max_krw', 'vat_note', 'price_note', 'source_quote', 'confidence'
  ];
  option_keys constant text[] := ARRAY[
    'id', 'name', 'price_min_krw', 'price_max_krw', 'unit',
    'condition', 'raw_text', 'source_quote', 'confidence'
  ];
  new_category text;
  new_item_name text;
  new_base_spec text;
  new_price_min integer;
  new_price_max integer;
  new_vat_note text;
  new_price_note text;
  new_source_quote text;
  new_confidence numeric;
  option_value jsonb;
  normalized_options jsonb := '[]'::jsonb;
  option_id uuid;
  option_name text;
  option_price_min integer;
  option_price_max integer;
  option_unit text;
  option_condition text;
  option_raw_text text;
  option_source_quote text;
  option_confidence numeric;
  option_source_file text;
  option_source_object_keys text[];
  option_identity text;
  requested_ids uuid[] := '{}'::uuid[];
  requested_identities text[] := '{}'::text[];
  existing_option_count integer;
  parent_changed boolean := false;
  options_changed boolean := false;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'PRICE_REVIEW_ACTOR_REQUIRED'
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS actor_profile
    WHERE actor_profile.id = p_actor_id
      AND actor_profile.is_admin = true
  ) THEN
    RAISE EXCEPTION 'PRICE_REVIEW_ADMIN_REQUIRED'
      USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('save', 'approve', 'reject') THEN
    RAISE EXCEPTION 'PRICE_REVIEW_INVALID_ACTION'
      USING ERRCODE = '22023';
  END IF;
  IF p_values IS NULL OR jsonb_typeof(p_values) <> 'object'
    OR NOT (p_values ?& value_keys)
    OR EXISTS (
      SELECT 1
      FROM jsonb_object_keys(p_values) AS provided(key)
      WHERE provided.key <> ALL(value_keys)
    )
  THEN
    RAISE EXCEPTION 'PRICE_REVIEW_INVALID_VALUES_SHAPE'
      USING ERRCODE = '22023';
  END IF;
  IF p_options IS NULL OR jsonb_typeof(p_options) <> 'array'
    OR jsonb_array_length(p_options) > 200
  THEN
    RAISE EXCEPTION 'PRICE_REVIEW_INVALID_OPTIONS_SHAPE'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_values -> 'category') <> 'string'
    OR jsonb_typeof(p_values -> 'item_name') <> 'string'
    OR jsonb_typeof(p_values -> 'base_spec') NOT IN ('string', 'null')
    OR jsonb_typeof(p_values -> 'price_min_krw') NOT IN ('number', 'null')
    OR jsonb_typeof(p_values -> 'price_max_krw') NOT IN ('number', 'null')
    OR jsonb_typeof(p_values -> 'vat_note') NOT IN ('string', 'null')
    OR jsonb_typeof(p_values -> 'price_note') NOT IN ('string', 'null')
    OR jsonb_typeof(p_values -> 'source_quote') NOT IN ('string', 'null')
    OR jsonb_typeof(p_values -> 'confidence') NOT IN ('number', 'null')
  THEN
    RAISE EXCEPTION 'PRICE_REVIEW_INVALID_VALUES_TYPES'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    CASE
      WHEN btrim(value_row.category) = 'venue' THEN 'hall'
      ELSE btrim(value_row.category)
    END,
    btrim(value_row.item_name),
    NULLIF(btrim(value_row.base_spec), ''),
    value_row.price_min_krw,
    value_row.price_max_krw,
    NULLIF(btrim(value_row.vat_note), ''),
    NULLIF(btrim(value_row.price_note), ''),
    NULLIF(btrim(value_row.source_quote), ''),
    value_row.confidence
  INTO
    new_category, new_item_name, new_base_spec, new_price_min, new_price_max,
    new_vat_note, new_price_note, new_source_quote, new_confidence
  FROM jsonb_to_record(p_values) AS value_row(
    category text,
    item_name text,
    base_spec text,
    price_min_krw integer,
    price_max_krw integer,
    vat_note text,
    price_note text,
    source_quote text,
    confidence numeric
  );

  IF new_category IS NULL
    OR new_category NOT IN ('studio', 'dress', 'makeup', 'hall', 'other')
    OR new_item_name IS NULL OR new_item_name = '' OR length(new_item_name) > 200
    OR length(COALESCE(new_base_spec, '')) > 2000
    OR length(COALESCE(new_vat_note, '')) > 500
    OR length(COALESCE(new_price_note, '')) > 2000
    OR length(COALESCE(new_source_quote, '')) > 4000
    OR new_price_min < 0 OR new_price_max < 0
    OR (
      new_price_min IS NOT NULL
      AND new_price_max IS NOT NULL
      AND new_price_min > new_price_max
    )
    OR new_confidence < 0 OR new_confidence > 1
  THEN
    RAISE EXCEPTION 'PRICE_REVIEW_INVALID_VALUES'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO current_price
  FROM public.official_prices
  WHERE id = p_price_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRICE_REVIEW_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  -- The child-option trigger accepts approved-row mutations only while this
  -- SECURITY DEFINER review owns the parent row lock. The owner check in the
  -- trigger prevents a service client from spoofing this transaction-local key.
  PERFORM set_config(
    'hanbang.review_official_price_id',
    p_price_id::text,
    true
  );

  parent_changed :=
    current_price.category IS DISTINCT FROM new_category
    OR current_price.item_name IS DISTINCT FROM new_item_name
    OR current_price.base_spec IS DISTINCT FROM new_base_spec
    OR current_price.price_min_krw IS DISTINCT FROM new_price_min
    OR current_price.price_max_krw IS DISTINCT FROM new_price_max
    OR current_price.vat_note IS DISTINCT FROM new_vat_note
    OR current_price.price_note IS DISTINCT FROM new_price_note
    OR current_price.source_quote IS DISTINCT FROM new_source_quote
    OR current_price.confidence IS DISTINCT FROM new_confidence;

  IF p_action = 'approve' AND (
    NULLIF(btrim(current_price.source_file), '') IS NULL
    OR cardinality(current_price.source_object_keys) = 0
    OR new_source_quote IS NULL
    OR new_confidence IS NULL
  ) THEN
    RAISE EXCEPTION 'PRICE_REVIEW_APPROVAL_PROVENANCE_REQUIRED'
      USING ERRCODE = '22023';
  END IF;

  FOR option_value IN
    SELECT option_input.value
    FROM jsonb_array_elements(p_options) AS option_input(value)
  LOOP
    IF jsonb_typeof(option_value) <> 'object'
      OR NOT (option_value ?& option_keys)
      OR EXISTS (
        SELECT 1
        FROM jsonb_object_keys(option_value) AS provided(key)
        WHERE provided.key <> ALL(option_keys)
      )
      OR jsonb_typeof(option_value -> 'id') NOT IN ('string', 'null')
      OR jsonb_typeof(option_value -> 'name') <> 'string'
      OR jsonb_typeof(option_value -> 'price_min_krw') NOT IN ('number', 'null')
      OR jsonb_typeof(option_value -> 'price_max_krw') NOT IN ('number', 'null')
      OR jsonb_typeof(option_value -> 'unit') NOT IN ('string', 'null')
      OR jsonb_typeof(option_value -> 'condition') NOT IN ('string', 'null')
      OR jsonb_typeof(option_value -> 'raw_text') NOT IN ('string', 'null')
      OR jsonb_typeof(option_value -> 'source_quote') NOT IN ('string', 'null')
      OR jsonb_typeof(option_value -> 'confidence') NOT IN ('number', 'null')
    THEN
      RAISE EXCEPTION 'PRICE_REVIEW_INVALID_OPTION_SHAPE'
        USING ERRCODE = '22023';
    END IF;

    SELECT
      option_row.id,
      btrim(option_row.name),
      option_row.price_min_krw,
      option_row.price_max_krw,
      NULLIF(btrim(option_row.unit), ''),
      NULLIF(btrim(option_row.condition), ''),
      NULLIF(btrim(option_row.raw_text), ''),
      NULLIF(btrim(option_row.source_quote), ''),
      option_row.confidence
    INTO
      option_id, option_name, option_price_min, option_price_max,
      option_unit, option_condition, option_raw_text,
      option_source_quote, option_confidence
    FROM jsonb_to_record(option_value) AS option_row(
      id uuid,
      name text,
      price_min_krw integer,
      price_max_krw integer,
      unit text,
      condition text,
      raw_text text,
      source_quote text,
      confidence numeric
    );

    IF option_name IS NULL OR option_name = '' OR length(option_name) > 200
      OR length(COALESCE(option_unit, '')) > 200
      OR length(COALESCE(option_condition, '')) > 2000
      OR length(COALESCE(option_raw_text, '')) > 4000
      OR length(COALESCE(option_source_quote, '')) > 4000
      OR option_price_min < 0 OR option_price_max < 0
      OR (
        option_price_min IS NOT NULL
        AND option_price_max IS NOT NULL
        AND option_price_min > option_price_max
      )
      OR option_confidence < 0 OR option_confidence > 1
    THEN
      RAISE EXCEPTION 'PRICE_REVIEW_INVALID_OPTION_VALUES'
        USING ERRCODE = '22023';
    END IF;

    option_identity := jsonb_build_array(
      option_name, option_unit, option_condition
    )::text;
    IF option_identity = ANY(requested_identities) THEN
      RAISE EXCEPTION 'PRICE_REVIEW_DUPLICATE_OPTION_IDENTITY'
        USING ERRCODE = '22023';
    END IF;
    requested_identities := array_append(requested_identities, option_identity);

    IF option_id IS NULL THEN
      option_id := gen_random_uuid();
      option_source_file := current_price.source_file;
      option_source_object_keys := current_price.source_object_keys;
      options_changed := true;
    ELSE
      IF option_id = ANY(requested_ids) THEN
        RAISE EXCEPTION 'PRICE_REVIEW_DUPLICATE_OPTION_ID'
          USING ERRCODE = '22023';
      END IF;
      SELECT *
      INTO current_option
      FROM public.official_price_options
      WHERE id = option_id
        AND official_price_id = p_price_id
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'PRICE_REVIEW_OPTION_NOT_OWNED'
          USING ERRCODE = '22023';
      END IF;
      option_source_file := current_option.source_file;
      option_source_object_keys := current_option.source_object_keys;
      options_changed := options_changed
        OR current_option.name IS DISTINCT FROM option_name
        OR current_option.price_min_krw IS DISTINCT FROM option_price_min
        OR current_option.price_max_krw IS DISTINCT FROM option_price_max
        OR current_option.unit IS DISTINCT FROM option_unit
        OR current_option.condition IS DISTINCT FROM option_condition
        OR current_option.raw_text IS DISTINCT FROM option_raw_text
        OR current_option.source_quote IS DISTINCT FROM option_source_quote
        OR current_option.confidence IS DISTINCT FROM option_confidence;
    END IF;

    IF p_action = 'approve' AND (
      NULLIF(btrim(option_source_file), '') IS NULL
      OR cardinality(option_source_object_keys) = 0
      OR option_source_quote IS NULL
      OR option_confidence IS NULL
    ) THEN
      RAISE EXCEPTION 'PRICE_REVIEW_OPTION_PROVENANCE_REQUIRED'
        USING ERRCODE = '22023';
    END IF;

    requested_ids := array_append(requested_ids, option_id);
    normalized_options := normalized_options || jsonb_build_array(
      jsonb_build_object(
        'id', option_id,
        'name', option_name,
        'price_min_krw', option_price_min,
        'price_max_krw', option_price_max,
        'unit', option_unit,
        'condition', option_condition,
        'raw_text', option_raw_text,
        'source_quote', option_source_quote,
        'confidence', option_confidence,
        'source_file', option_source_file,
        'source_object_keys', option_source_object_keys
      )
    );
  END LOOP;

  SELECT count(*)::integer
  INTO existing_option_count
  FROM public.official_price_options
  WHERE official_price_id = p_price_id;
  options_changed := options_changed
    OR existing_option_count <> jsonb_array_length(normalized_options);

  -- Temporary unique names make two-option name swaps safe under the existing
  -- non-deferrable identity index; any later error rolls the statement back.
  UPDATE public.official_price_options
  SET name = '__review_staging_' || replace(id::text, '-', '')
  WHERE official_price_id = p_price_id
    AND id = ANY(requested_ids);

  DELETE FROM public.official_price_options
  WHERE official_price_id = p_price_id
    AND NOT (id = ANY(requested_ids));

  FOR option_value IN
    SELECT option_input.value
    FROM jsonb_array_elements(normalized_options) AS option_input(value)
  LOOP
    option_id := (option_value ->> 'id')::uuid;
    option_name := option_value ->> 'name';
    option_price_min := (option_value ->> 'price_min_krw')::integer;
    option_price_max := (option_value ->> 'price_max_krw')::integer;
    option_unit := option_value ->> 'unit';
    option_condition := option_value ->> 'condition';
    option_raw_text := option_value ->> 'raw_text';
    option_source_quote := option_value ->> 'source_quote';
    option_confidence := (option_value ->> 'confidence')::numeric;

    UPDATE public.official_price_options
    SET name = option_name,
        price_min_krw = option_price_min,
        price_max_krw = option_price_max,
        unit = option_unit,
        condition = option_condition,
        raw_text = option_raw_text,
        source_quote = option_source_quote,
        confidence = option_confidence
    WHERE id = option_id
      AND official_price_id = p_price_id;

    IF NOT FOUND THEN
      INSERT INTO public.official_price_options (
        id, official_price_id, name, price_min_krw, price_max_krw,
        unit, condition, raw_text, source_file, source_quote,
        source_object_keys, confidence
      ) VALUES (
        option_id, p_price_id, option_name, option_price_min, option_price_max,
        option_unit, option_condition, option_raw_text,
        option_value ->> 'source_file', option_source_quote,
        ARRAY(
          SELECT jsonb_array_elements_text(option_value -> 'source_object_keys')
        ),
        option_confidence
      );
    END IF;
  END LOOP;

  UPDATE public.official_prices
  SET category = new_category,
      item_name = new_item_name,
      base_spec = new_base_spec,
      price_min_krw = new_price_min,
      price_max_krw = new_price_max,
      vat_note = new_vat_note,
      price_note = new_price_note,
      source_quote = new_source_quote,
      confidence = new_confidence,
      review_status = CASE p_action
        WHEN 'approve' THEN 'approved'
        WHEN 'reject' THEN 'rejected'
        ELSE 'pending'
      END,
      needs_review = p_action <> 'approve',
      edited_by_admin = current_price.edited_by_admin
        OR parent_changed
        OR options_changed,
      reviewed_by = p_actor_id,
      reviewed_at = now(),
      review_action = p_action,
      updated_at = now()
  WHERE id = p_price_id;

  PERFORM set_config('hanbang.review_official_price_id', '', true);
END;
$review_official_price$;

REVOKE ALL ON FUNCTION public.review_official_price(
  uuid, uuid, text, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_official_price(
  uuid, uuid, text, jsonb, jsonb
) TO service_role;

-- Serialize direct extraction writes with review. A direct service-role writer
-- may mutate options only while the parent is unedited and pending. The review
-- RPC is the sole path that may edit an approved/admin-edited option set.
CREATE OR REPLACE FUNCTION public.guard_official_price_option_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $guard_official_price_option_write$
DECLARE
  parent_ids uuid[];
  parent_row record;
  locked_parent_count integer := 0;
  review_function_owner name;
  review_context text := current_setting(
    'hanbang.review_official_price_id',
    true
  );
BEGIN
  SELECT array_agg(parent_id ORDER BY parent_id)
  INTO parent_ids
  FROM (
    SELECT DISTINCT parent_id
    FROM unnest(ARRAY[
      CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.official_price_id END,
      CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.official_price_id END
    ]::uuid[]) AS parent_source(parent_id)
    WHERE parent_id IS NOT NULL
  ) AS distinct_parents;

  SELECT pg_catalog.pg_get_userbyid(function_row.proowner)
  INTO review_function_owner
  FROM pg_catalog.pg_proc AS function_row
  WHERE function_row.oid =
    'public.review_official_price(uuid,uuid,text,jsonb,jsonb)'::regprocedure;

  FOR parent_row IN
    SELECT price.id, price.review_status, price.edited_by_admin
    FROM public.official_prices AS price
    WHERE price.id = ANY(parent_ids)
    ORDER BY price.id
    FOR SHARE
  LOOP
    locked_parent_count := locked_parent_count + 1;
    IF current_user = review_function_owner
      AND review_context = parent_row.id::text
    THEN
      CONTINUE;
    END IF;
    IF parent_row.review_status <> 'pending'
      OR parent_row.edited_by_admin
    THEN
      RAISE EXCEPTION 'OFFICIAL_PRICE_OPTION_PARENT_NOT_WRITABLE'
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  IF locked_parent_count <> cardinality(parent_ids) THEN
    RAISE EXCEPTION 'OFFICIAL_PRICE_OPTION_PARENT_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$guard_official_price_option_write$;

REVOKE ALL ON FUNCTION public.guard_official_price_option_write()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS guard_official_price_option_write
  ON public.official_price_options;
CREATE TRIGGER guard_official_price_option_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.official_price_options
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_official_price_option_write();

-- Agency-package review is also a single service-only write fence. Original
-- file identities remain immutable: the form may edit quoted/structured data,
-- but it cannot replace source_file or source_object_keys.
CREATE OR REPLACE FUNCTION public.review_official_agency_package(
  p_package_id uuid,
  p_actor_id uuid,
  p_action text,
  p_values jsonb,
  p_options jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $review_official_agency_package$
DECLARE
  current_package public.official_agency_packages%ROWTYPE;
  value_keys constant text[] := ARRAY[
    'package_name', 'category_scope', 'price_min_krw', 'price_max_krw',
    'vat_note', 'price_note', 'source_quote', 'confidence'
  ];
  option_keys constant text[] := ARRAY[
    'name', 'price_min_krw', 'price_max_krw', 'unit',
    'condition', 'raw_text', 'source_quote'
  ];
  new_package_name text;
  new_category_scope text[] := '{}'::text[];
  new_price_min integer;
  new_price_max integer;
  new_vat_note text;
  new_price_note text;
  new_source_quote text;
  new_confidence numeric;
  option_value jsonb;
  normalized_options jsonb := '[]'::jsonb;
  option_name text;
  option_price_min integer;
  option_price_max integer;
  option_unit text;
  option_condition text;
  option_raw_text text;
  option_source_quote text;
  option_identity text;
  requested_identities text[] := '{}'::text[];
  has_price boolean := false;
  values_changed boolean := false;
  options_changed boolean := false;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'AGENCY_PACKAGE_REVIEW_ACTOR_REQUIRED'
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS actor_profile
    WHERE actor_profile.id = p_actor_id
      AND actor_profile.is_admin = true
  ) THEN
    RAISE EXCEPTION 'AGENCY_PACKAGE_REVIEW_ADMIN_REQUIRED'
      USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('save', 'approve', 'reject') THEN
    RAISE EXCEPTION 'AGENCY_PACKAGE_REVIEW_INVALID_ACTION'
      USING ERRCODE = '22023';
  END IF;
  IF p_values IS NULL OR jsonb_typeof(p_values) <> 'object'
    OR NOT (p_values ?& value_keys)
    OR EXISTS (
      SELECT 1
      FROM jsonb_object_keys(p_values) AS provided(key)
      WHERE provided.key <> ALL(value_keys)
    )
  THEN
    RAISE EXCEPTION 'AGENCY_PACKAGE_REVIEW_INVALID_VALUES_SHAPE'
      USING ERRCODE = '22023';
  END IF;
  IF p_options IS NULL OR jsonb_typeof(p_options) <> 'array'
    OR jsonb_array_length(p_options) > 100
  THEN
    RAISE EXCEPTION 'AGENCY_PACKAGE_REVIEW_INVALID_OPTIONS_SHAPE'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_values -> 'package_name') <> 'string'
    OR jsonb_typeof(p_values -> 'category_scope') <> 'array'
    OR jsonb_array_length(p_values -> 'category_scope') > 4
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_values -> 'category_scope') AS scope(value)
      WHERE jsonb_typeof(scope.value) <> 'string'
    )
    OR jsonb_typeof(p_values -> 'price_min_krw') NOT IN ('number', 'null')
    OR jsonb_typeof(p_values -> 'price_max_krw') NOT IN ('number', 'null')
    OR jsonb_typeof(p_values -> 'vat_note') NOT IN ('string', 'null')
    OR jsonb_typeof(p_values -> 'price_note') NOT IN ('string', 'null')
    OR jsonb_typeof(p_values -> 'source_quote') NOT IN ('string', 'null')
    OR jsonb_typeof(p_values -> 'confidence') NOT IN ('number', 'null')
  THEN
    RAISE EXCEPTION 'AGENCY_PACKAGE_REVIEW_INVALID_VALUES_TYPES'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    btrim(value_row.package_name),
    value_row.price_min_krw,
    value_row.price_max_krw,
    NULLIF(btrim(value_row.vat_note), ''),
    NULLIF(btrim(value_row.price_note), ''),
    NULLIF(btrim(value_row.source_quote), ''),
    value_row.confidence
  INTO
    new_package_name, new_price_min, new_price_max, new_vat_note,
    new_price_note, new_source_quote, new_confidence
  FROM jsonb_to_record(p_values) AS value_row(
    package_name text,
    price_min_krw integer,
    price_max_krw integer,
    vat_note text,
    price_note text,
    source_quote text,
    confidence numeric
  );

  SELECT COALESCE(
    array_agg(btrim(scope.value #>> '{}') ORDER BY scope.ordinality),
    '{}'::text[]
  )
  INTO new_category_scope
  FROM jsonb_array_elements(p_values -> 'category_scope')
    WITH ORDINALITY AS scope(value, ordinality);

  IF new_package_name IS NULL OR new_package_name = ''
    OR length(new_package_name) > 300
    OR length(COALESCE(new_vat_note, '')) > 1000
    OR length(COALESCE(new_price_note, '')) > 2000
    OR length(COALESCE(new_source_quote, '')) > 1000
    OR new_price_min < 0 OR new_price_max < 0
    OR (
      new_price_min IS NOT NULL
      AND new_price_max IS NOT NULL
      AND new_price_min > new_price_max
    )
    OR new_confidence < 0 OR new_confidence > 1
    OR EXISTS (
      SELECT 1
      FROM unnest(new_category_scope) AS requested_scope(value)
      WHERE requested_scope.value NOT IN ('studio', 'dress', 'makeup', 'venue')
    )
    OR cardinality(new_category_scope) <> (
      SELECT count(DISTINCT requested_scope.value)::integer
      FROM unnest(new_category_scope) AS requested_scope(value)
    )
  THEN
    RAISE EXCEPTION 'AGENCY_PACKAGE_REVIEW_INVALID_VALUES'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO current_package
  FROM public.official_agency_packages
  WHERE id = p_package_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AGENCY_PACKAGE_REVIEW_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  has_price := new_price_min IS NOT NULL OR new_price_max IS NOT NULL;

  FOR option_value IN
    SELECT option_input.value
    FROM jsonb_array_elements(p_options) AS option_input(value)
  LOOP
    IF jsonb_typeof(option_value) <> 'object'
      OR NOT (option_value ?& option_keys)
      OR EXISTS (
        SELECT 1
        FROM jsonb_object_keys(option_value) AS provided(key)
        WHERE provided.key <> ALL(option_keys)
      )
      OR jsonb_typeof(option_value -> 'name') <> 'string'
      OR jsonb_typeof(option_value -> 'price_min_krw') NOT IN ('number', 'null')
      OR jsonb_typeof(option_value -> 'price_max_krw') NOT IN ('number', 'null')
      OR jsonb_typeof(option_value -> 'unit') NOT IN ('string', 'null')
      OR jsonb_typeof(option_value -> 'condition') NOT IN ('string', 'null')
      OR jsonb_typeof(option_value -> 'raw_text') NOT IN ('string', 'null')
      OR jsonb_typeof(option_value -> 'source_quote') NOT IN ('string', 'null')
    THEN
      RAISE EXCEPTION 'AGENCY_PACKAGE_REVIEW_INVALID_OPTION_SHAPE'
        USING ERRCODE = '22023';
    END IF;

    SELECT
      btrim(option_row.name),
      option_row.price_min_krw,
      option_row.price_max_krw,
      NULLIF(btrim(option_row.unit), ''),
      NULLIF(btrim(option_row.condition), ''),
      NULLIF(btrim(option_row.raw_text), ''),
      NULLIF(btrim(option_row.source_quote), '')
    INTO
      option_name, option_price_min, option_price_max, option_unit,
      option_condition, option_raw_text, option_source_quote
    FROM jsonb_to_record(option_value) AS option_row(
      name text,
      price_min_krw integer,
      price_max_krw integer,
      unit text,
      condition text,
      raw_text text,
      source_quote text
    );

    IF option_name IS NULL OR option_name = '' OR length(option_name) > 300
      OR length(COALESCE(option_unit, '')) > 100
      OR length(COALESCE(option_condition, '')) > 1000
      OR length(COALESCE(option_raw_text, '')) > 2000
      OR length(COALESCE(option_source_quote, '')) > 1000
      OR option_price_min < 0 OR option_price_max < 0
      OR (
        option_price_min IS NOT NULL
        AND option_price_max IS NOT NULL
        AND option_price_min > option_price_max
      )
      OR (p_action = 'approve' AND option_source_quote IS NULL)
    THEN
      RAISE EXCEPTION 'AGENCY_PACKAGE_REVIEW_INVALID_OPTION_VALUES'
        USING ERRCODE = '22023';
    END IF;

    option_identity := jsonb_build_array(
      option_name, option_unit, option_condition
    )::text;
    IF option_identity = ANY(requested_identities) THEN
      RAISE EXCEPTION 'AGENCY_PACKAGE_REVIEW_DUPLICATE_OPTION_IDENTITY'
        USING ERRCODE = '22023';
    END IF;
    requested_identities := array_append(requested_identities, option_identity);
    has_price := has_price
      OR option_price_min IS NOT NULL
      OR option_price_max IS NOT NULL;
    normalized_options := normalized_options || jsonb_build_array(
      jsonb_build_object(
        'name', option_name,
        'price_min_krw', option_price_min,
        'price_max_krw', option_price_max,
        'unit', option_unit,
        'condition', option_condition,
        'raw_text', option_raw_text,
        'source_quote', option_source_quote
      )
    );
  END LOOP;

  IF p_action = 'approve' AND (
    cardinality(new_category_scope) = 0
    OR NOT has_price
    OR NULLIF(btrim(current_package.source_file), '') IS NULL
    OR cardinality(current_package.source_object_keys) = 0
    OR NOT public.disclosure_object_keys_are_safe(
      current_package.source_object_keys
    )
    OR new_source_quote IS NULL
    OR new_confidence IS NULL
  ) THEN
    RAISE EXCEPTION 'AGENCY_PACKAGE_REVIEW_APPROVAL_PROVENANCE_REQUIRED'
      USING ERRCODE = '22023';
  END IF;

  values_changed :=
    current_package.package_name IS DISTINCT FROM new_package_name
    OR current_package.category_scope IS DISTINCT FROM new_category_scope
    OR current_package.price_min_krw IS DISTINCT FROM new_price_min
    OR current_package.price_max_krw IS DISTINCT FROM new_price_max
    OR current_package.vat_note IS DISTINCT FROM new_vat_note
    OR current_package.price_note IS DISTINCT FROM new_price_note
    OR current_package.source_quote IS DISTINCT FROM new_source_quote
    OR current_package.confidence IS DISTINCT FROM new_confidence;
  options_changed := current_package.options IS DISTINCT FROM normalized_options;

  UPDATE public.official_agency_packages
  SET package_name = new_package_name,
      category_scope = new_category_scope,
      price_min_krw = new_price_min,
      price_max_krw = new_price_max,
      vat_note = new_vat_note,
      price_note = new_price_note,
      options = normalized_options,
      source_quote = new_source_quote,
      confidence = new_confidence,
      review_status = CASE p_action
        WHEN 'approve' THEN 'approved'
        WHEN 'reject' THEN 'rejected'
        ELSE 'pending'
      END,
      needs_review = p_action <> 'approve',
      edited_by_admin = current_package.edited_by_admin
        OR values_changed
        OR options_changed,
      reviewed_by = p_actor_id,
      reviewed_at = now(),
      review_action = p_action,
      updated_at = now()
  WHERE id = p_package_id;
END;
$review_official_agency_package$;

REVOKE ALL ON FUNCTION public.review_official_agency_package(
  uuid, uuid, text, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_official_agency_package(
  uuid, uuid, text, jsonb, jsonb
) TO service_role;

CREATE OR REPLACE FUNCTION public.decide_vendor_dedupe_candidate(
  p_candidate_id uuid,
  p_decision text,
  p_preserved_vendor_id uuid,
  p_decided_by uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $decide_vendor_dedupe_candidate$
DECLARE
  candidate_row public.vendor_dedupe_candidates%ROWTYPE;
  preserved_row public.vendors%ROWTYPE;
  losing_row public.vendors%ROWTYPE;
  preserved_private public.vendor_enrichment_private%ROWTYPE;
  losing_private public.vendor_enrichment_private%ROWTYPE;
  losing_vendor_id uuid;
  merged_aliases text[];
  merged_attributes jsonb;
  merged_enrichment_status text;
  merged_enriched_at timestamptz;
  official_url_values text[];
  instagram_url_values text[];
  conflicting_extra_column text;
  extra_column record;
  extra_default_expression text;
  extra_default_type_schema text;
  extra_default_value jsonb;
  reference_row record;
  has_unhandled_reference boolean;
BEGIN
  IF p_decision NOT IN ('same', 'different') THEN
    RAISE EXCEPTION 'VENDOR_DEDUPE_INVALID_DECISION'
      USING ERRCODE = '22023';
  END IF;
  IF p_decided_by IS NULL THEN
    RAISE EXCEPTION 'VENDOR_DEDUPE_ACTOR_REQUIRED'
      USING ERRCODE = '22023';
  END IF;
  IF p_decision = 'different' AND p_preserved_vendor_id IS NOT NULL THEN
    RAISE EXCEPTION 'VENDOR_DEDUPE_PRESERVED_FOR_DIFFERENT'
      USING ERRCODE = '22023';
  END IF;
  IF p_decision = 'same' AND p_preserved_vendor_id IS NULL THEN
    RAISE EXCEPTION 'VENDOR_DEDUPE_PRESERVED_REQUIRED'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO candidate_row
  FROM public.vendor_dedupe_candidates
  WHERE id = p_candidate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VENDOR_DEDUPE_CANDIDATE_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  IF candidate_row.status <> 'pending' THEN
    IF candidate_row.status = p_decision
      AND (
        p_decision = 'different'
        OR candidate_row.preserved_vendor_id = p_preserved_vendor_id
      )
    THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'VENDOR_DEDUPE_ALREADY_DECIDED'
      USING ERRCODE = '55000';
  END IF;

  -- Lock both vendors in UUID order so concurrent candidate decisions cannot
  -- invert locks and deadlock.
  PERFORM vendor.id
  FROM public.vendors AS vendor
  WHERE vendor.id IN (candidate_row.left_vendor_id, candidate_row.right_vendor_id)
  ORDER BY vendor.id
  FOR UPDATE;

  IF p_decision = 'different' THEN
    UPDATE public.vendor_dedupe_candidates
    SET status = 'different',
        preserved_vendor_id = NULL,
        decided_by = p_decided_by,
        decided_at = now(),
        updated_at = now()
    WHERE id = p_candidate_id;
    RETURN;
  END IF;

  IF p_preserved_vendor_id NOT IN (
    candidate_row.left_vendor_id,
    candidate_row.right_vendor_id
  ) THEN
    RAISE EXCEPTION 'VENDOR_DEDUPE_PRESERVED_NOT_IN_PAIR'
      USING ERRCODE = '22023';
  END IF;

  losing_vendor_id := CASE
    WHEN p_preserved_vendor_id = candidate_row.left_vendor_id
      THEN candidate_row.right_vendor_id
    ELSE candidate_row.left_vendor_id
  END;

  SELECT * INTO preserved_row
  FROM public.vendors
  WHERE id = p_preserved_vendor_id;
  SELECT * INTO losing_row
  FROM public.vendors
  WHERE id = losing_vendor_id;

  IF preserved_row.id IS NULL OR losing_row.id IS NULL THEN
    RAISE EXCEPTION 'VENDOR_DEDUPE_VENDOR_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;
  IF preserved_row.category <> losing_row.category THEN
    RAISE EXCEPTION 'VENDOR_DEDUPE_CATEGORY_MISMATCH'
      USING ERRCODE = '22023';
  END IF;
  IF preserved_row.region_code IS DISTINCT FROM losing_row.region_code THEN
    RAISE EXCEPTION 'VENDOR_DEDUPE_REGION_MISMATCH'
      USING ERRCODE = '22023';
  END IF;
  IF losing_row.status <> 'pending' OR losing_row.owner_id IS NOT NULL THEN
    RAISE EXCEPTION 'VENDOR_DEDUPE_OPERATIONAL_VENDOR_CANNOT_LOSE'
      USING ERRCODE = '55000';
  END IF;

  -- A slug is a durable public identity. Move it only when the preserved row
  -- has no slug; two different public identities require explicit review.
  IF preserved_row.slug IS NOT NULL
    AND losing_row.slug IS NOT NULL
    AND preserved_row.slug <> losing_row.slug
  THEN
    RAISE EXCEPTION 'VENDOR_DEDUPE_SLUG_CONFLICT'
      USING ERRCODE = '55000';
  END IF;

  -- Legacy and canonical URL columns describe the same destinations. Merge a
  -- single corroborated value, but never choose between conflicting values.
  SELECT COALESCE(array_agg(url_value ORDER BY url_value), '{}'::text[])
  INTO official_url_values
  FROM (
    SELECT DISTINCT btrim(url_value) AS url_value
    FROM unnest(ARRAY[
      preserved_row.website,
      preserved_row.official_url,
      losing_row.website,
      losing_row.official_url
    ]) AS url_source(url_value)
    WHERE NULLIF(btrim(url_value), '') IS NOT NULL
  ) AS distinct_urls;
  IF cardinality(official_url_values) > 1 THEN
    RAISE EXCEPTION 'VENDOR_DEDUPE_OFFICIAL_URL_CONFLICT'
      USING ERRCODE = '55000';
  END IF;

  SELECT COALESCE(array_agg(url_value ORDER BY url_value), '{}'::text[])
  INTO instagram_url_values
  FROM (
    SELECT DISTINCT btrim(url_value) AS url_value
    FROM unnest(ARRAY[
      preserved_row.instagram,
      preserved_row.instagram_url,
      losing_row.instagram,
      losing_row.instagram_url
    ]) AS url_source(url_value)
    WHERE NULLIF(btrim(url_value), '') IS NOT NULL
  ) AS distinct_urls;
  IF cardinality(instagram_url_values) > 1 THEN
    RAISE EXCEPTION 'VENDOR_DEDUPE_INSTAGRAM_URL_CONFLICT'
      USING ERRCODE = '55000';
  END IF;
  IF NULLIF(btrim(preserved_row.naver_place_url), '') IS NOT NULL
    AND NULLIF(btrim(losing_row.naver_place_url), '') IS NOT NULL
    AND btrim(preserved_row.naver_place_url) <> btrim(losing_row.naver_place_url)
  THEN
    RAISE EXCEPTION 'VENDOR_DEDUPE_NAVER_URL_CONFLICT'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_each(preserved_row.attributes) AS preserved_attribute(key, value)
    JOIN jsonb_each(losing_row.attributes) AS losing_attribute(key, value)
      USING (key)
    WHERE preserved_attribute.value IS DISTINCT FROM losing_attribute.value
  ) THEN
    RAISE EXCEPTION 'VENDOR_DEDUPE_ATTRIBUTE_CONFLICT'
      USING ERRCODE = '55000';
  END IF;
  merged_attributes := preserved_row.attributes || losing_row.attributes;

  IF preserved_row.enrichment_status <> losing_row.enrichment_status
    AND preserved_row.enrichment_status <> 'pending'
    AND losing_row.enrichment_status <> 'pending'
  THEN
    RAISE EXCEPTION 'VENDOR_DEDUPE_ENRICHMENT_STATUS_CONFLICT'
      USING ERRCODE = '55000';
  END IF;
  merged_enrichment_status := CASE
    WHEN preserved_row.enrichment_status = 'pending'
      THEN losing_row.enrichment_status
    ELSE preserved_row.enrichment_status
  END;
  IF preserved_row.enriched_at IS NOT NULL
    AND losing_row.enriched_at IS NOT NULL
    AND preserved_row.enriched_at <> losing_row.enriched_at
  THEN
    RAISE EXCEPTION 'VENDOR_DEDUPE_ENRICHED_AT_CONFLICT'
      USING ERRCODE = '55000';
  END IF;
  merged_enriched_at := COALESCE(
    preserved_row.enriched_at,
    losing_row.enriched_at
  );

  SELECT * INTO preserved_private
  FROM public.vendor_enrichment_private
  WHERE vendor_id = p_preserved_vendor_id
  FOR UPDATE;
  SELECT * INTO losing_private
  FROM public.vendor_enrichment_private
  WHERE vendor_id = losing_vendor_id
  FOR UPDATE;
  IF preserved_private.vendor_id IS NOT NULL
    AND losing_private.vendor_id IS NOT NULL
    AND (
      preserved_private.price_band IS DISTINCT FROM losing_private.price_band
        AND preserved_private.price_band IS NOT NULL
        AND losing_private.price_band IS NOT NULL
      OR preserved_private.notes_internal IS DISTINCT FROM losing_private.notes_internal
        AND preserved_private.notes_internal IS NOT NULL
        AND losing_private.notes_internal IS NOT NULL
      OR preserved_private.enriched_by IS DISTINCT FROM losing_private.enriched_by
        AND preserved_private.enriched_by IS NOT NULL
        AND losing_private.enriched_by IS NOT NULL
    )
  THEN
    RAISE EXCEPTION 'VENDOR_DEDUPE_PRIVATE_ENRICHMENT_CONFLICT'
      USING ERRCODE = '55000';
  END IF;

  -- The production vendors table has accumulated domain columns over time.
  -- A loader-created, unowned pending row inherits many legacy defaults (0,
  -- false, empty arrays, stock business hours, and so on). Those placeholders
  -- must not block a merge into a populated winner, but a non-default losing
  -- value still represents data this generic function does not understand and
  -- therefore fails closed. No extra-column value is ever copied over the
  -- winner. Only catalog defaults without function calls are evaluated.
  conflicting_extra_column := NULL;
  FOR extra_column IN
    SELECT
      losing_field.key,
      losing_field.value,
      preserved_field.value AS preserved_value
    FROM jsonb_each(
      to_jsonb(losing_row) - ARRAY[
        'id', 'owner_id', 'name', 'aliases', 'category', 'status',
        'created_at', 'updated_at', 'slug', 'region_code', 'website',
        'instagram', 'official_url', 'instagram_url', 'naver_place_url',
        'attributes', 'enrichment_status', 'enriched_at'
      ]::text[]
    ) AS losing_field(key, value)
    LEFT JOIN jsonb_each(to_jsonb(preserved_row)) AS preserved_field(key, value)
      USING (key)
    WHERE losing_field.value <> 'null'::jsonb
      AND losing_field.value IS DISTINCT FROM preserved_field.value
    ORDER BY losing_field.key
  LOOP
    -- Explicitly empty loader values are semantically absent even when an old
    -- schema column itself has no DEFAULT (notably location = '').
    IF (
      jsonb_typeof(extra_column.value) = 'string'
      AND btrim(extra_column.value #>> '{}') = ''
    ) OR extra_column.value IN ('[]'::jsonb, '{}'::jsonb) THEN
      CONTINUE;
    END IF;

    SELECT
      pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid),
      type_namespace.nspname
    INTO extra_default_expression, extra_default_type_schema
    FROM pg_catalog.pg_attribute AS attribute_row
    LEFT JOIN pg_catalog.pg_attrdef AS default_row
      ON default_row.adrelid = attribute_row.attrelid
      AND default_row.adnum = attribute_row.attnum
    JOIN pg_catalog.pg_type AS type_row
      ON type_row.oid = attribute_row.atttypid
    JOIN pg_catalog.pg_namespace AS type_namespace
      ON type_namespace.oid = type_row.typnamespace
    WHERE attribute_row.attrelid = 'public.vendors'::regclass
      AND attribute_row.attname = extra_column.key
      AND attribute_row.attnum > 0
      AND NOT attribute_row.attisdropped;

    extra_default_value := NULL;
    IF extra_default_expression IS NOT NULL
      AND extra_default_type_schema = 'pg_catalog'
      AND position('(' IN extra_default_expression) = 0
      AND position(';' IN extra_default_expression) = 0
      AND extra_default_expression !~* 'current_'
    THEN
      BEGIN
        EXECUTE format(
          'SELECT to_jsonb(%s)',
          extra_default_expression
        ) INTO extra_default_value;
      EXCEPTION WHEN OTHERS THEN
        -- An unfamiliar default remains meaningful and therefore blocks below.
        extra_default_value := NULL;
      END;
    END IF;

    IF extra_default_value IS NOT NULL
      AND extra_column.value IS NOT DISTINCT FROM extra_default_value
    THEN
      CONTINUE;
    END IF;

    conflicting_extra_column := extra_column.key;
    EXIT;
  END LOOP;
  IF conflicting_extra_column IS NOT NULL THEN
    RAISE EXCEPTION 'VENDOR_DEDUPE_UNMERGED_COLUMN_CONFLICT: %',
      conflicting_extra_column
      USING ERRCODE = '55000';
  END IF;

  -- Known V2 relations are moved below. Any other foreign-key reference is a
  -- domain-specific merge decision and therefore blocks this generic merge.
  FOR reference_row IN
    SELECT
      constraint_row.conrelid::regclass::text AS table_name,
      source_attribute.attname AS column_name
    FROM pg_catalog.pg_constraint AS constraint_row
    JOIN LATERAL unnest(constraint_row.conkey) WITH ORDINALITY
      AS source_key(attnum, position) ON true
    JOIN LATERAL unnest(constraint_row.confkey) WITH ORDINALITY
      AS target_key(attnum, position)
      ON target_key.position = source_key.position
    JOIN pg_catalog.pg_attribute AS source_attribute
      ON source_attribute.attrelid = constraint_row.conrelid
      AND source_attribute.attnum = source_key.attnum
    JOIN pg_catalog.pg_attribute AS target_attribute
      ON target_attribute.attrelid = constraint_row.confrelid
      AND target_attribute.attnum = target_key.attnum
    WHERE constraint_row.contype = 'f'
      AND constraint_row.confrelid = 'public.vendors'::regclass
      AND target_attribute.attname = 'id'
      AND (constraint_row.conrelid, source_attribute.attname) NOT IN (
        ('public.vendor_enrichment_private'::regclass, 'vendor_id'),
        ('public.vendor_dedupe_candidates'::regclass, 'left_vendor_id'),
        ('public.vendor_dedupe_candidates'::regclass, 'right_vendor_id'),
        ('public.vendor_dedupe_candidates'::regclass, 'preserved_vendor_id'),
        ('public.official_prices'::regclass, 'vendor_id'),
        ('public.events'::regclass, 'vendor_id'),
        ('public.vendor_tags'::regclass, 'vendor_id')
      )
  LOOP
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1)',
      reference_row.table_name,
      reference_row.column_name
    ) INTO has_unhandled_reference USING losing_vendor_id;
    IF has_unhandled_reference THEN
      RAISE EXCEPTION 'VENDOR_DEDUPE_UNHANDLED_REFERENCE: %.%',
        reference_row.table_name,
        reference_row.column_name
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  SELECT COALESCE(array_agg(alias_value ORDER BY alias_value), '{}'::text[])
  INTO merged_aliases
  FROM (
    SELECT DISTINCT btrim(alias_value) AS alias_value
    FROM unnest(
      COALESCE(preserved_row.aliases, '{}'::text[])
      || COALESCE(losing_row.aliases, '{}'::text[])
      || ARRAY[losing_row.name]
    ) AS alias_source(alias_value)
    WHERE NULLIF(btrim(alias_value), '') IS NOT NULL
      AND btrim(alias_value) <> preserved_row.name
  ) AS normalized_aliases;

  IF cardinality(merged_aliases) > 100 THEN
    RAISE EXCEPTION 'VENDOR_DEDUPE_ALIAS_LIMIT'
      USING ERRCODE = '54000';
  END IF;

  -- Release a moved slug before assigning it to the preserved row. The whole
  -- function is transactional, so a later failure restores both identities.
  IF preserved_row.slug IS NULL AND losing_row.slug IS NOT NULL THEN
    UPDATE public.vendors
    SET slug = NULL,
        updated_at = now()
    WHERE id = losing_vendor_id;
  END IF;

  UPDATE public.vendors
  SET aliases = merged_aliases,
      slug = COALESCE(preserved_row.slug, losing_row.slug),
      website = official_url_values[1],
      official_url = CASE
        WHEN official_url_values[1] ~ '^https://'
          THEN official_url_values[1]
        ELSE NULL
      END,
      instagram = instagram_url_values[1],
      instagram_url = CASE
        WHEN instagram_url_values[1] ~ '^https://'
          THEN instagram_url_values[1]
        ELSE NULL
      END,
      naver_place_url = COALESCE(
        NULLIF(btrim(preserved_row.naver_place_url), ''),
        NULLIF(btrim(losing_row.naver_place_url), '')
      ),
      attributes = merged_attributes,
      enrichment_status = merged_enrichment_status,
      enriched_at = merged_enriched_at,
      updated_at = now()
  WHERE id = p_preserved_vendor_id;

  UPDATE public.official_prices
  SET vendor_id = p_preserved_vendor_id,
      updated_at = now()
  WHERE vendor_id = losing_vendor_id;

  UPDATE public.events
  SET vendor_id = p_preserved_vendor_id
  WHERE vendor_id = losing_vendor_id;

  IF losing_private.vendor_id IS NOT NULL THEN
    INSERT INTO public.vendor_enrichment_private (
      vendor_id,
      price_band,
      notes_internal,
      enriched_by,
      updated_at
    ) VALUES (
      p_preserved_vendor_id,
      COALESCE(preserved_private.price_band, losing_private.price_band),
      COALESCE(
        preserved_private.notes_internal,
        losing_private.notes_internal
      ),
      COALESCE(preserved_private.enriched_by, losing_private.enriched_by),
      CASE
        WHEN preserved_private.vendor_id IS NULL THEN losing_private.updated_at
        ELSE GREATEST(preserved_private.updated_at, losing_private.updated_at)
      END
    )
    ON CONFLICT (vendor_id) DO UPDATE
    SET price_band = EXCLUDED.price_band,
        notes_internal = EXCLUDED.notes_internal,
        enriched_by = EXCLUDED.enriched_by,
        updated_at = EXCLUDED.updated_at;

    DELETE FROM public.vendor_enrichment_private
    WHERE vendor_id = losing_vendor_id;
  END IF;

  INSERT INTO public.vendor_tags AS preserved_tag (
    vendor_id, tag_id, source, created_at
  )
  SELECT p_preserved_vendor_id, tag_id, source, created_at
  FROM public.vendor_tags
  WHERE vendor_id = losing_vendor_id
  ON CONFLICT (vendor_id, tag_id) DO UPDATE
  SET source = CASE
        WHEN CASE EXCLUDED.source
          WHEN 'official_doc' THEN 3
          WHEN 'user_review' THEN 2
          ELSE 1
        END > CASE preserved_tag.source
          WHEN 'official_doc' THEN 3
          WHEN 'user_review' THEN 2
          ELSE 1
        END
          THEN EXCLUDED.source
        ELSE preserved_tag.source
      END,
      created_at = LEAST(preserved_tag.created_at, EXCLUDED.created_at);

  DELETE FROM public.vendor_tags
  WHERE vendor_id = losing_vendor_id;

  -- Preserve the losing row and its private audit trail. It is hidden from
  -- enrichment/recommendation queues instead of being destructively deleted.
  UPDATE public.vendors
  SET status = 'rejected',
      enrichment_status = 'skip',
      updated_at = now()
  WHERE id = losing_vendor_id;

  UPDATE public.vendor_dedupe_candidates
  SET status = 'superseded',
      preserved_vendor_id = NULL,
      decided_by = p_decided_by,
      decided_at = now(),
      updated_at = now()
  WHERE id <> p_candidate_id
    AND status = 'pending'
    AND (
      left_vendor_id = losing_vendor_id
      OR right_vendor_id = losing_vendor_id
    );

  UPDATE public.vendor_dedupe_candidates
  SET status = 'same',
      preserved_vendor_id = p_preserved_vendor_id,
      decided_by = p_decided_by,
      decided_at = now(),
      updated_at = now()
  WHERE id = p_candidate_id;
END;
$decide_vendor_dedupe_candidate$;

REVOKE ALL ON FUNCTION public.decide_vendor_dedupe_candidate(
  uuid, text, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decide_vendor_dedupe_candidate(
  uuid, text, uuid, uuid
) TO service_role;

-- Serialize V2 writes with vendor merges. Rejected vendors are tombstones for
-- this pipeline: a writer that commits first is moved by the merge; a writer
-- that arrives after the merge observes the rejected row and fails closed.
CREATE OR REPLACE FUNCTION public.enforce_non_rejected_vendor_reference()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $enforce_non_rejected_vendor_reference$
DECLARE
  target_status text;
BEGIN
  IF NEW.vendor_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT vendor.status
  INTO target_status
  FROM public.vendors AS vendor
  WHERE vendor.id = NEW.vendor_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VENDOR_REFERENCE_NOT_FOUND'
      USING ERRCODE = '23503';
  END IF;
  IF target_status = 'rejected' THEN
    RAISE EXCEPTION 'VENDOR_REFERENCE_REJECTED'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$enforce_non_rejected_vendor_reference$;

REVOKE ALL ON FUNCTION public.enforce_non_rejected_vendor_reference()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS vendor_enrichment_private_active_vendor_fence
  ON public.vendor_enrichment_private;
CREATE TRIGGER vendor_enrichment_private_active_vendor_fence
BEFORE INSERT OR UPDATE OF vendor_id ON public.vendor_enrichment_private
FOR EACH ROW
EXECUTE FUNCTION public.enforce_non_rejected_vendor_reference();

DROP TRIGGER IF EXISTS official_prices_active_vendor_fence
  ON public.official_prices;
CREATE TRIGGER official_prices_active_vendor_fence
BEFORE INSERT OR UPDATE OF vendor_id ON public.official_prices
FOR EACH ROW
EXECUTE FUNCTION public.enforce_non_rejected_vendor_reference();

DROP TRIGGER IF EXISTS events_active_vendor_fence ON public.events;
CREATE TRIGGER events_active_vendor_fence
BEFORE INSERT OR UPDATE OF vendor_id ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.enforce_non_rejected_vendor_reference();

DROP TRIGGER IF EXISTS vendor_tags_active_vendor_fence ON public.vendor_tags;
CREATE TRIGGER vendor_tags_active_vendor_fence
BEFORE INSERT OR UPDATE OF vendor_id ON public.vendor_tags
FOR EACH ROW
EXECUTE FUNCTION public.enforce_non_rejected_vendor_reference();

-- Serialize disclosure writes with agency merges. A foreign-key check only
-- protects the agency primary key; it does not conflict with an UPDATE of
-- merged_into_agency_id. This explicit row lock ensures either (a) a writer
-- commits first and the merge moves its row, or (b) the merge commits first
-- and the writer observes the tombstone and fails closed.
CREATE OR REPLACE FUNCTION public.enforce_active_agency_reference()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $enforce_active_agency_reference$
DECLARE
  target_merged_into_agency_id uuid;
BEGIN
  IF NEW.agency_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT agency.merged_into_agency_id
  INTO target_merged_into_agency_id
  FROM public.agencies AS agency
  WHERE agency.id = NEW.agency_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AGENCY_REFERENCE_NOT_FOUND'
      USING ERRCODE = '23503';
  END IF;
  IF target_merged_into_agency_id IS NOT NULL THEN
    RAISE EXCEPTION 'AGENCY_REFERENCE_MERGED'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$enforce_active_agency_reference$;

REVOKE ALL ON FUNCTION public.enforce_active_agency_reference()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS official_agency_packages_active_agency_fence
  ON public.official_agency_packages;
CREATE TRIGGER official_agency_packages_active_agency_fence
BEFORE INSERT OR UPDATE OF agency_id ON public.official_agency_packages
FOR EACH ROW
EXECUTE FUNCTION public.enforce_active_agency_reference();

DROP TRIGGER IF EXISTS official_prices_active_agency_fence
  ON public.official_prices;
CREATE TRIGGER official_prices_active_agency_fence
BEFORE INSERT OR UPDATE OF agency_id ON public.official_prices
FOR EACH ROW
EXECUTE FUNCTION public.enforce_active_agency_reference();

CREATE OR REPLACE FUNCTION public.decide_agency_dedupe_candidate(
  p_candidate_id uuid,
  p_decision text,
  p_preserved_agency_id uuid,
  p_decided_by uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $decide_agency_dedupe_candidate$
DECLARE
  candidate_row public.agency_dedupe_candidates%ROWTYPE;
  preserved_row public.agencies%ROWTYPE;
  losing_row public.agencies%ROWTYPE;
  losing_agency_id uuid;
  merged_aliases text[];
BEGIN
  IF p_decision NOT IN ('same', 'different') THEN
    RAISE EXCEPTION 'AGENCY_DEDUPE_INVALID_DECISION' USING ERRCODE = '22023';
  END IF;
  IF p_decided_by IS NULL THEN
    RAISE EXCEPTION 'AGENCY_DEDUPE_ACTOR_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF p_decision = 'different' AND p_preserved_agency_id IS NOT NULL THEN
    RAISE EXCEPTION 'AGENCY_DEDUPE_PRESERVED_FOR_DIFFERENT' USING ERRCODE = '22023';
  END IF;
  IF p_decision = 'same' AND p_preserved_agency_id IS NULL THEN
    RAISE EXCEPTION 'AGENCY_DEDUPE_PRESERVED_REQUIRED' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO candidate_row
  FROM public.agency_dedupe_candidates
  WHERE id = p_candidate_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AGENCY_DEDUPE_CANDIDATE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF candidate_row.status <> 'pending' THEN
    IF candidate_row.status = p_decision
      AND (
        p_decision = 'different'
        OR candidate_row.preserved_agency_id = p_preserved_agency_id
      )
    THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'AGENCY_DEDUPE_ALREADY_DECIDED' USING ERRCODE = '55000';
  END IF;

  PERFORM agency.id
  FROM public.agencies AS agency
  WHERE agency.id IN (candidate_row.left_agency_id, candidate_row.right_agency_id)
  ORDER BY agency.id
  FOR UPDATE;

  IF p_decision = 'different' THEN
    UPDATE public.agency_dedupe_candidates
    SET status = 'different',
        preserved_agency_id = NULL,
        decided_by = p_decided_by,
        decided_at = now(),
        updated_at = now()
    WHERE id = p_candidate_id;
    RETURN;
  END IF;

  IF p_preserved_agency_id NOT IN (
    candidate_row.left_agency_id,
    candidate_row.right_agency_id
  ) THEN
    RAISE EXCEPTION 'AGENCY_DEDUPE_PRESERVED_NOT_IN_PAIR' USING ERRCODE = '22023';
  END IF;
  losing_agency_id := CASE
    WHEN p_preserved_agency_id = candidate_row.left_agency_id
      THEN candidate_row.right_agency_id
    ELSE candidate_row.left_agency_id
  END;

  SELECT * INTO preserved_row FROM public.agencies WHERE id = p_preserved_agency_id;
  SELECT * INTO losing_row FROM public.agencies WHERE id = losing_agency_id;
  IF preserved_row.id IS NULL OR losing_row.id IS NULL THEN
    RAISE EXCEPTION 'AGENCY_DEDUPE_AGENCY_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF preserved_row.merged_into_agency_id IS NOT NULL
    OR losing_row.merged_into_agency_id IS NOT NULL
  THEN
    RAISE EXCEPTION 'AGENCY_DEDUPE_ALREADY_MERGED' USING ERRCODE = '55000';
  END IF;
  IF preserved_row.region_code IS NULL
    OR losing_row.region_code IS NULL
    OR preserved_row.region_code IS DISTINCT FROM losing_row.region_code
  THEN
    RAISE EXCEPTION 'AGENCY_DEDUPE_REGION_MISMATCH' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.official_agency_packages AS losing_package
    JOIN public.official_agency_packages AS preserved_package
      ON preserved_package.snapshot_id = losing_package.snapshot_id
      AND preserved_package.agency_id = p_preserved_agency_id
      AND preserved_package.package_name = losing_package.package_name
      AND COALESCE(preserved_package.source_file, '') = COALESCE(losing_package.source_file, '')
    WHERE losing_package.agency_id = losing_agency_id
  ) THEN
    RAISE EXCEPTION 'AGENCY_DEDUPE_PACKAGE_COLLISION' USING ERRCODE = '23505';
  END IF;

  SELECT COALESCE(array_agg(alias_value ORDER BY alias_value), '{}'::text[])
  INTO merged_aliases
  FROM (
    SELECT DISTINCT btrim(alias_value) AS alias_value
    FROM unnest(
      COALESCE(preserved_row.aliases, '{}'::text[])
      || COALESCE(losing_row.aliases, '{}'::text[])
      || ARRAY[losing_row.name]
    ) AS alias_source(alias_value)
    WHERE NULLIF(btrim(alias_value), '') IS NOT NULL
      AND btrim(alias_value) <> preserved_row.name
  ) AS normalized_aliases;
  IF cardinality(merged_aliases) > 100 THEN
    RAISE EXCEPTION 'AGENCY_DEDUPE_ALIAS_LIMIT' USING ERRCODE = '22023';
  END IF;

  UPDATE public.agencies
  SET aliases = merged_aliases,
      updated_at = now()
  WHERE id = p_preserved_agency_id;

  UPDATE public.official_agency_packages
  SET agency_id = p_preserved_agency_id,
      updated_at = now()
  WHERE agency_id = losing_agency_id;

  UPDATE public.official_prices
  SET agency_id = p_preserved_agency_id,
      updated_at = now()
  WHERE agency_id = losing_agency_id;

  UPDATE public.agencies
  SET normalized_name = NULL,
      merged_into_agency_id = p_preserved_agency_id,
      updated_at = now()
  WHERE id = losing_agency_id;

  UPDATE public.agency_dedupe_candidates
  SET status = 'superseded',
      preserved_agency_id = NULL,
      decided_by = NULL,
      decided_at = now(),
      updated_at = now()
  WHERE id <> p_candidate_id
    AND status = 'pending'
    AND (
      left_agency_id = losing_agency_id
      OR right_agency_id = losing_agency_id
    );

  UPDATE public.agency_dedupe_candidates
  SET status = 'same',
      preserved_agency_id = p_preserved_agency_id,
      decided_by = p_decided_by,
      decided_at = now(),
      updated_at = now()
  WHERE id = p_candidate_id;
END;
$decide_agency_dedupe_candidate$;

REVOKE ALL ON FUNCTION public.decide_agency_dedupe_candidate(
  uuid, text, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decide_agency_dedupe_candidate(
  uuid, text, uuid, uuid
) TO service_role;

CREATE OR REPLACE VIEW public.v_public_official_prices
WITH (security_barrier = true, security_invoker = false)
AS
SELECT
  price.id,
  price.snapshot_id,
  snapshot.period_label,
  snapshot.source,
  snapshot.published_at,
  snapshot.is_current,
  price.vendor_id,
  vendor.slug AS vendor_slug,
  vendor.name AS vendor_name,
  vendor.category AS vendor_category,
  vendor.region_code,
  price.agency_id,
  agency.name AS agency_name,
  price.category AS price_category,
  price.item_name,
  price.base_spec,
  price.price_min_krw,
  price.price_max_krw,
  price.vat_note,
  price.price_note,
  price.source_quote,
  price.created_at,
  price.updated_at
FROM public.official_prices AS price
JOIN public.price_snapshots AS snapshot
  ON snapshot.id = price.snapshot_id
LEFT JOIN public.vendors AS vendor
  ON vendor.id = price.vendor_id
LEFT JOIN public.agencies AS agency
  ON agency.id = price.agency_id
WHERE price.review_status = 'approved'
  AND price.needs_review = false
  AND price.category IN ('studio', 'dress', 'makeup', 'hall', 'other')
  AND cardinality(price.source_object_keys) > 0
  AND NULLIF(btrim(price.source_quote), '') IS NOT NULL
  AND price.confidence IS NOT NULL
  AND (
    price.agency_id IS NULL
    OR agency.merged_into_agency_id IS NULL
  )
  AND (price.vendor_id IS NULL OR vendor.status = 'approved');

CREATE OR REPLACE VIEW public.v_public_official_price_options
WITH (security_barrier = true, security_invoker = false)
AS
SELECT
  option_row.id,
  option_row.official_price_id,
  option_row.name,
  option_row.price_min_krw,
  option_row.price_max_krw,
  option_row.unit,
  option_row.condition,
  option_row.raw_text,
  option_row.source_quote,
  option_row.created_at
FROM public.official_price_options AS option_row
JOIN public.official_prices AS price
  ON price.id = option_row.official_price_id
LEFT JOIN public.vendors AS vendor
  ON vendor.id = price.vendor_id
LEFT JOIN public.agencies AS agency
  ON agency.id = price.agency_id
WHERE price.review_status = 'approved'
  AND price.needs_review = false
  AND price.category IN ('studio', 'dress', 'makeup', 'hall', 'other')
  AND cardinality(price.source_object_keys) > 0
  AND NULLIF(btrim(price.source_quote), '') IS NOT NULL
  AND price.confidence IS NOT NULL
  AND cardinality(option_row.source_object_keys) > 0
  AND NULLIF(btrim(option_row.source_quote), '') IS NOT NULL
  AND option_row.confidence IS NOT NULL
  AND (
    price.agency_id IS NULL
    OR agency.merged_into_agency_id IS NULL
  )
  AND (price.vendor_id IS NULL OR vendor.status = 'approved');

CREATE OR REPLACE VIEW public.v_public_agency_packages
WITH (security_barrier = true, security_invoker = false)
AS
SELECT
  package_row.id,
  package_row.snapshot_id,
  snapshot.period_label,
  snapshot.source,
  snapshot.published_at,
  package_row.agency_id,
  agency.name AS agency_name,
  agency.region_code,
  package_row.package_name,
  package_row.category_scope,
  package_row.price_min_krw,
  package_row.price_max_krw,
  package_row.vat_note,
  package_row.price_note,
  package_row.options,
  package_row.source_quote,
  package_row.created_at,
  package_row.updated_at
FROM public.official_agency_packages AS package_row
JOIN public.price_snapshots AS snapshot
  ON snapshot.id = package_row.snapshot_id
JOIN public.agencies AS agency
  ON agency.id = package_row.agency_id
WHERE package_row.review_status = 'approved'
  AND package_row.needs_review = false
  AND cardinality(package_row.source_object_keys) > 0
  AND NULLIF(btrim(package_row.source_quote), '') IS NOT NULL
  AND package_row.confidence IS NOT NULL
  AND agency.merged_into_agency_id IS NULL;

CREATE OR REPLACE VIEW public.v_public_vendor_enrichment
WITH (security_barrier = true, security_invoker = false)
AS
SELECT
  vendor.id,
  vendor.slug,
  vendor.name,
  vendor.category,
  vendor.region_code,
  CASE
    WHEN public.vendor_enrichment_url_is_allowed(
      vendor.official_url,
      '{}'::text[]
    ) THEN vendor.official_url
    ELSE NULL
  END AS official_url,
  CASE
    WHEN public.vendor_enrichment_url_is_allowed(
      vendor.instagram_url,
      ARRAY['instagram.com']::text[]
    ) THEN vendor.instagram_url
    ELSE NULL
  END AS instagram_url,
  CASE
    WHEN public.vendor_enrichment_url_is_allowed(
      vendor.naver_place_url,
      ARRAY['naver.com', 'naver.me']::text[]
    ) THEN vendor.naver_place_url
    ELSE NULL
  END AS naver_place_url,
  -- Public attributes are reconstructed from an explicit category allow-list.
  -- Filtering known private keys is not sufficient: a future/legacy key would
  -- otherwise become public by default. jsonb_each preserves the distinction
  -- between an absent key and an explicitly present JSON null value.
  COALESCE(
    (
      SELECT jsonb_object_agg(attribute.key, attribute.value)
      FROM jsonb_each(COALESCE(vendor.attributes, '{}'::jsonb)) AS attribute
      WHERE (
        vendor.category = 'studio'
        AND attribute.key = ANY (ARRAY[
          'shoot_locations', 'original_files_policy', 'parents_shot',
          'pet_friendly'
        ]::text[])
      ) OR (
        vendor.category = 'dress'
        AND attribute.key = ANY (ARRAY[
          'origin', 'lines', 'size_inclusive', 'fitting_fee_krw'
        ]::text[])
      ) OR (
        vendor.category = 'makeup'
        AND attribute.key = ANY (ARRAY[
          'director_designation', 'early_morning', 'parents_makeup',
          'mens_grooming'
        ]::text[])
      ) OR (
        vendor.category IN ('venue', 'hall')
        AND attribute.key = ANY (ARRAY[
          'hall_type', 'brightness', 'single_hall', 'meal_type',
          'guarantee_min', 'interval_minutes', 'parking'
        ]::text[])
      )
    ),
    '{}'::jsonb
  ) AS attributes,
  COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'slug', tag_row.slug,
          'label', tag_row.label,
          'group', tag_row.tag_group
        )
        ORDER BY tag_row.tag_group, tag_row.slug
      )
      FROM public.vendor_tags AS assignment
      JOIN public.tags AS tag_row
        ON tag_row.id = assignment.tag_id
      WHERE assignment.vendor_id = vendor.id
        AND tag_row.is_active = true
    ),
    '[]'::jsonb
  ) AS tags
FROM public.vendors AS vendor
WHERE vendor.status = 'approved';

ALTER VIEW public.v_public_official_prices OWNER TO postgres;
ALTER VIEW public.v_public_official_price_options OWNER TO postgres;
ALTER VIEW public.v_public_agency_packages OWNER TO postgres;
ALTER VIEW public.v_public_vendor_enrichment OWNER TO postgres;

REVOKE ALL ON TABLE
  public.v_public_official_prices,
  public.v_public_official_price_options,
  public.v_public_agency_packages,
  public.v_public_vendor_enrichment
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE
  public.v_public_official_prices,
  public.v_public_official_price_options,
  public.v_public_agency_packages,
  public.v_public_vendor_enrichment
TO anon, authenticated, service_role;

-- Raw disclosure evidence is private. Only server-side service-role code may
-- upload/download it; no storage.objects policy is intentionally created.
INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'disclosure-raw',
  'disclosure-raw',
  false,
  50 * 1024 * 1024,
  ARRAY[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/x-hwp',
    'application/haansofthwp',
    'image/png'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

COMMIT;
