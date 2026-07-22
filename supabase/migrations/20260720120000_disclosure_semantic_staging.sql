BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Validate the two evidence-key arrays without permitting traversal, URLs,
-- absolute paths, NULL members, or unbounded arrays in this private table.
CREATE OR REPLACE FUNCTION public.disclosure_sha256_values_are_safe(
  p_values text[],
  p_allow_empty boolean
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $disclosure_sha256_values_are_safe$
  SELECT COALESCE(
    p_values IS NOT NULL
    AND cardinality(p_values) <= 16
    AND (p_allow_empty OR cardinality(p_values) >= 1)
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(p_values) AS candidate(value)
      WHERE value IS NULL OR value !~ '^[0-9a-f]{64}$'
    ),
    false
  );
$disclosure_sha256_values_are_safe$;

CREATE OR REPLACE FUNCTION public.disclosure_preview_keys_are_safe(
  value text[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $disclosure_preview_keys_are_safe$
  SELECT COALESCE(
    $1 IS NOT NULL
    AND cardinality($1) <= 16
    AND NOT EXISTS (
      SELECT 1
      FROM unnest($1) AS candidate(preview_key)
      WHERE candidate.preview_key IS NULL
        OR candidate.preview_key !~ '^[0-9a-f]{64}\.txt$'
    ),
    false
  );
$disclosure_preview_keys_are_safe$;

CREATE OR REPLACE FUNCTION public.disclosure_issue_codes_are_safe(
  p_values text[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $disclosure_issue_codes_are_safe$
  SELECT COALESCE(
    p_values IS NOT NULL
    AND cardinality(p_values) <= 500
    AND cardinality(p_values) = cardinality(ARRAY(SELECT DISTINCT value FROM unnest(p_values) AS item(value)))
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(p_values) AS candidate(value)
      WHERE value IS NULL OR length(value) NOT BETWEEN 1 AND 200
    ),
    false
  );
$disclosure_issue_codes_are_safe$;

-- The source agency is an immutable copy of the agency-root identity used by
-- the loader. Exact keys keep accidental/private extractor fields out of DB.
CREATE OR REPLACE FUNCTION public.disclosure_source_agency_is_safe(
  p_agency jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $disclosure_source_agency_is_safe$
  SELECT COALESCE(
    jsonb_typeof(p_agency) = 'object'
    AND (
      SELECT array_agg(key ORDER BY key)
      FROM jsonb_object_keys(p_agency) AS agency_key(key)
    ) = ARRAY[
      'corporate_name', 'name', 'normalized_name', 'region_code', 'source_file'
    ]::text[]
    AND jsonb_typeof(p_agency -> 'name') = 'string'
    AND length(p_agency ->> 'name') BETWEEN 1 AND 300
    AND jsonb_typeof(p_agency -> 'normalized_name') = 'string'
    AND length(p_agency ->> 'normalized_name') BETWEEN 1 AND 300
    AND (
      jsonb_typeof(p_agency -> 'corporate_name') = 'null'
      OR (
        jsonb_typeof(p_agency -> 'corporate_name') = 'string'
        AND length(p_agency ->> 'corporate_name') BETWEEN 1 AND 300
      )
    )
    AND jsonb_typeof(p_agency -> 'region_code') = 'string'
    AND length(p_agency ->> 'region_code') BETWEEN 1 AND 100
    AND jsonb_typeof(p_agency -> 'source_file') = 'string'
    AND length(p_agency ->> 'source_file') BETWEEN 1 AND 10000,
    false
  );
$disclosure_source_agency_is_safe$;

-- The three digests are intentionally independent: source_file_ids hash
-- path+raw-SHA identity, raw object-key stems hash raw bytes, and preview-key
-- stems hash converted text. SQL validates bounded shape and extensions;
-- writer preflight owns the manifest-backed positional mapping.
CREATE OR REPLACE FUNCTION public.disclosure_semantic_evidence_keys_are_safe(
  p_file_ids text[],
  p_object_keys text[],
  p_preview_keys text[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $disclosure_semantic_evidence_keys_are_safe$
  SELECT COALESCE(
    p_file_ids IS NOT NULL
    AND p_object_keys IS NOT NULL
    AND p_preview_keys IS NOT NULL
    AND cardinality(p_file_ids) = cardinality(p_object_keys)
    AND cardinality(p_file_ids) BETWEEN 1 AND 16
    AND cardinality(p_preview_keys) <= 16
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(p_file_ids) AS evidence(file_id)
      WHERE file_id IS NULL
        OR file_id !~ '^[0-9a-f]{64}$'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(p_object_keys) AS evidence(object_key)
      WHERE object_key IS NULL
        OR object_key !~ '^[0-9a-f]{64}\.(xlsx|docx|hwp|pdf|png)$'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(p_preview_keys) AS preview(preview_key)
      WHERE preview_key IS NULL
        OR preview_key !~ '^[0-9a-f]{64}\.txt$'
    ),
    false
  );
$disclosure_semantic_evidence_keys_are_safe$;

ALTER FUNCTION public.disclosure_sha256_values_are_safe(text[], boolean) OWNER TO postgres;
ALTER FUNCTION public.disclosure_preview_keys_are_safe(text[]) OWNER TO postgres;
ALTER FUNCTION public.disclosure_issue_codes_are_safe(text[]) OWNER TO postgres;
ALTER FUNCTION public.disclosure_source_agency_is_safe(jsonb) OWNER TO postgres;
ALTER FUNCTION public.disclosure_semantic_evidence_keys_are_safe(text[], text[], text[])
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.disclosure_sha256_values_are_safe(text[], boolean)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.disclosure_preview_keys_are_safe(text[])
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.disclosure_issue_codes_are_safe(text[])
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.disclosure_source_agency_is_safe(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.disclosure_semantic_evidence_keys_are_safe(text[], text[], text[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.disclosure_sha256_values_are_safe(text[], boolean)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.disclosure_preview_keys_are_safe(text[])
  TO service_role;
GRANT EXECUTE ON FUNCTION public.disclosure_issue_codes_are_safe(text[])
  TO service_role;
GRANT EXECUTE ON FUNCTION public.disclosure_source_agency_is_safe(jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.disclosure_semantic_evidence_keys_are_safe(text[], text[], text[])
  TO service_role;

-- This is an immutable review inbox, not a publication table. It intentionally
-- has no approved state, public view, or browser/mobile grant. A future,
-- separately reviewed promotion migration/API must copy approved semantics to
-- a purpose-built consumer contract rather than exposing this source table.
CREATE TABLE public.disclosure_semantic_staging (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES public.price_snapshots(id) ON DELETE CASCADE,
  schema_version smallint NOT NULL CHECK (schema_version = 2),
  unit_id text NOT NULL CHECK (unit_id ~ '^[0-9a-f]{64}$'),
  record_kind text NOT NULL CHECK (record_kind IN ('vendor_policy', 'document_section')),
  semantic_type text NOT NULL,
  subject_kind text NOT NULL CHECK (subject_kind IN ('vendor', 'agency')),
  subject_name text NOT NULL CHECK (length(subject_name) BETWEEN 1 AND 300),
  subject_normalized_name text NOT NULL
    CHECK (length(subject_normalized_name) BETWEEN 1 AND 300),
  vendor_category text,
  region_code text NOT NULL CHECK (length(region_code) BETWEEN 1 AND 100),
  title text,
  content_verbatim text NOT NULL CHECK (length(content_verbatim) BETWEEN 1 AND 20000),
  summary text,
  partner_record_ref text,
  partner_vendor_id uuid REFERENCES public.vendors(id) ON DELETE RESTRICT,
  official_price_id uuid REFERENCES public.official_prices(id) ON DELETE RESTRICT,
  source_agency jsonb,
  partner_link_status text NOT NULL CHECK (
    partner_link_status IN (
      'price_row_staged', 'policy_only_pending_identity', 'not_applicable'
    )
  ),
  review_status text NOT NULL DEFAULT 'pending' CHECK (review_status = 'pending'),
  needs_review boolean NOT NULL DEFAULT true,
  validation_issue_codes text[] NOT NULL DEFAULT '{}'::text[],
  source_file_ids text[] NOT NULL,
  source_file text NOT NULL CHECK (length(source_file) BETWEEN 1 AND 10000),
  source_object_keys text[] NOT NULL,
  source_preview_keys text[] NOT NULL DEFAULT '{}'::text[],
  source_quote text NOT NULL CHECK (length(source_quote) BETWEEN 1 AND 2000),
  source_fingerprint text NOT NULL CHECK (source_fingerprint ~ '^[0-9a-f]{64}$'),
  validation_fingerprint text NOT NULL CHECK (validation_fingerprint ~ '^[0-9a-f]{64}$'),
  confidence numeric NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  source_record_key text NOT NULL CHECK (source_record_key ~ '^[0-9a-f]{64}$'),
  content_fingerprint text NOT NULL CHECK (content_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (snapshot_id, source_record_key),
  CONSTRAINT disclosure_semantic_subject_contract CHECK (
    COALESCE(
      (
        record_kind = 'vendor_policy'
        AND semantic_type IN ('penalty', 'refund', 'change', 'other')
        AND subject_kind = 'vendor'
        AND vendor_category IS NOT NULL
        AND vendor_category IN ('studio', 'dress', 'makeup', 'hall', 'other')
        AND title IS NULL
        AND summary IS NULL
        AND partner_record_ref IS NOT NULL
        AND partner_record_ref ~ '^[0-9a-f]{64}$'
        AND partner_vendor_id IS NOT NULL
        AND partner_link_status IN (
          'price_row_staged', 'policy_only_pending_identity'
        )
        AND (
          (
            partner_link_status = 'price_row_staged'
            AND official_price_id IS NOT NULL
          ) OR (
            partner_link_status = 'policy_only_pending_identity'
            AND official_price_id IS NULL
          )
        )
        AND (
          source_agency IS NULL
          OR public.disclosure_source_agency_is_safe(source_agency)
        )
      ) OR (
        record_kind = 'document_section'
        AND semantic_type IN (
          'pricing_basis', 'refund_policy', 'penalty', 'contract_terms',
          'reservation', 'validity', 'included_items', 'usage_guide',
          'notice', 'other'
        )
        AND vendor_category IS NULL
        AND title IS NOT NULL
        AND length(title) BETWEEN 1 AND 300
        AND summary IS NOT NULL
        AND length(summary) BETWEEN 1 AND 1000
        AND partner_record_ref IS NULL
        AND partner_vendor_id IS NULL
        AND official_price_id IS NULL
        AND source_agency IS NULL
        AND partner_link_status = 'not_applicable'
      ),
      false
    )
  ),
  CONSTRAINT disclosure_semantic_issue_codes_check CHECK (
    public.disclosure_issue_codes_are_safe(validation_issue_codes)
  ),
  CONSTRAINT disclosure_semantic_source_file_ids_check CHECK (
    public.disclosure_sha256_values_are_safe(source_file_ids, false)
  ),
  CONSTRAINT disclosure_semantic_source_object_keys_check CHECK (
    cardinality(source_object_keys) = cardinality(source_file_ids)
    AND cardinality(source_object_keys) BETWEEN 1 AND 16
    AND public.disclosure_object_keys_are_safe(source_object_keys)
  ),
  CONSTRAINT disclosure_semantic_source_preview_keys_check CHECK (
    public.disclosure_preview_keys_are_safe(source_preview_keys)
  ),
  CONSTRAINT disclosure_semantic_evidence_identity_check CHECK (
    public.disclosure_semantic_evidence_keys_are_safe(
      source_file_ids,
      source_object_keys,
      source_preview_keys
    )
  )
);

COMMENT ON TABLE public.disclosure_semantic_staging IS
  'Private pending-only admin review inbox for verbatim disclosure policies and sections; never a consumer API source.';
COMMENT ON COLUMN public.disclosure_semantic_staging.summary IS
  'Non-authoritative extraction summary. NULL for vendor policies because that source contract has no generated summary.';
COMMENT ON COLUMN public.disclosure_semantic_staging.content_verbatim IS
  'Verbatim extracted disclosure content, preserved separately from generated summaries.';
COMMENT ON COLUMN public.disclosure_semantic_staging.partner_record_ref IS
  'Stable 64-hex extraction identity for the exact partner-vendor occurrence.';
COMMENT ON COLUMN public.disclosure_semantic_staging.partner_vendor_id IS
  'Durable private FK for the exact policy subject resolved by the guarded writer.';
COMMENT ON COLUMN public.disclosure_semantic_staging.official_price_id IS
  'Durable private FK for price-backed policies; NULL only for policy-only subjects and document sections.';
COMMENT ON COLUMN public.disclosure_semantic_staging.source_agency IS
  'Exact-key agency-root provenance object; NULL for vendor-root policies and document sections.';

CREATE INDEX idx_disclosure_semantic_staging_review
  ON public.disclosure_semantic_staging (snapshot_id, needs_review, created_at, id);
CREATE INDEX idx_disclosure_semantic_staging_subject
  ON public.disclosure_semantic_staging (
    snapshot_id,
    subject_kind,
    region_code,
    subject_normalized_name
  );
CREATE INDEX idx_disclosure_semantic_staging_partner_ref
  ON public.disclosure_semantic_staging (snapshot_id, partner_record_ref)
  WHERE partner_record_ref IS NOT NULL;
CREATE INDEX idx_disclosure_semantic_staging_partner_vendor
  ON public.disclosure_semantic_staging (snapshot_id, partner_vendor_id)
  WHERE partner_vendor_id IS NOT NULL;
CREATE INDEX idx_disclosure_semantic_staging_official_price
  ON public.disclosure_semantic_staging (official_price_id)
  WHERE official_price_id IS NOT NULL;

-- Serialize against snapshot promotion and reject semantic writes once a
-- snapshot is current or has ever been marked published.
CREATE OR REPLACE FUNCTION public.guard_disclosure_semantic_draft_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $guard_disclosure_semantic_draft_snapshot$
DECLARE
  snapshot_published boolean;
  snapshot_is_current boolean;
  snapshot_published_at date;
BEGIN
  -- official_prices UPDATE paths already hold the price row before their
  -- triggers lock the parent snapshot. Take locks in that same price->snapshot
  -- order here so concurrent semantic inserts cannot deadlock with them.
  IF NEW.record_kind = 'vendor_policy'
    AND NEW.partner_link_status = 'price_row_staged'
  THEN
    PERFORM 1
    FROM public.official_prices AS price
    WHERE price.id = NEW.official_price_id
      AND price.snapshot_id = NEW.snapshot_id
      AND price.vendor_id = NEW.partner_vendor_id
    FOR KEY SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'DISCLOSURE_SEMANTIC_PRICE_LINK_MISMATCH'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  SELECT snapshot.published, snapshot.is_current, snapshot.published_at
  INTO snapshot_published, snapshot_is_current, snapshot_published_at
  FROM public.price_snapshots AS snapshot
  WHERE snapshot.id = NEW.snapshot_id
  FOR UPDATE;

  IF NOT FOUND
    OR snapshot_published IS NOT FALSE
    OR snapshot_is_current IS NOT FALSE
    OR snapshot_published_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'DISCLOSURE_SEMANTIC_DRAFT_SNAPSHOT_REQUIRED'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END
$guard_disclosure_semantic_draft_snapshot$;

ALTER FUNCTION public.guard_disclosure_semantic_draft_snapshot() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_disclosure_semantic_draft_snapshot()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER disclosure_semantic_draft_snapshot_fence
BEFORE INSERT OR UPDATE OF
  snapshot_id, partner_vendor_id, official_price_id, partner_link_status
ON public.disclosure_semantic_staging
FOR EACH ROW
EXECUTE FUNCTION public.guard_disclosure_semantic_draft_snapshot();

CREATE OR REPLACE FUNCTION public.guard_and_sync_disclosure_semantic_price_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $guard_and_sync_disclosure_semantic_price_link$
BEGIN
  IF NEW.snapshot_id IS DISTINCT FROM OLD.snapshot_id
    AND EXISTS (
      SELECT 1
      FROM public.disclosure_semantic_staging AS semantic
      WHERE semantic.official_price_id = NEW.id
    )
  THEN
    RAISE EXCEPTION 'DISCLOSURE_SEMANTIC_PRICE_SNAPSHOT_IMMUTABLE'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.vendor_id IS NOT DISTINCT FROM OLD.vendor_id THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.disclosure_semantic_staging AS semantic
    WHERE semantic.official_price_id = NEW.id
  ) THEN
    RETURN NEW;
  END IF;

  IF NEW.vendor_id IS NULL THEN
    RAISE EXCEPTION 'DISCLOSURE_SEMANTIC_PRICE_VENDOR_REQUIRED'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.disclosure_semantic_staging
  SET partner_vendor_id = NEW.vendor_id
  WHERE official_price_id = NEW.id
    AND partner_vendor_id = OLD.vendor_id;

  IF EXISTS (
    SELECT 1
    FROM public.disclosure_semantic_staging AS semantic
    WHERE semantic.official_price_id = NEW.id
      AND semantic.partner_vendor_id IS DISTINCT FROM NEW.vendor_id
  ) THEN
    RAISE EXCEPTION 'DISCLOSURE_SEMANTIC_PRICE_LINK_MISMATCH'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END
$guard_and_sync_disclosure_semantic_price_link$;

ALTER FUNCTION public.guard_and_sync_disclosure_semantic_price_link() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_and_sync_disclosure_semantic_price_link()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER disclosure_semantic_price_link_sync
AFTER UPDATE OF vendor_id, snapshot_id ON public.official_prices
FOR EACH ROW
EXECUTE FUNCTION public.guard_and_sync_disclosure_semantic_price_link();

-- The approved vendor-dedupe RPC performs a catalog-wide FK audit before it
-- moves any known references. This successor table is therefore added to that
-- RPC's explicit handled set, then canonicalized immediately after draft price
-- rows move. Both price-backed and policy-only semantics keep their immutable
-- partner_record_ref provenance while their durable vendor FK follows the
-- preserved vendor. Any later failure rolls back prices, semantics, and the
-- vendor merge together because all statements remain in the caller's RPC
-- transaction.
DO $patch_vendor_dedupe_semantic_links$
DECLARE
  function_definition text;
  patched_definition text;
  reference_anchor constant text := $reference_anchor$('public.official_prices'::regclass, 'vendor_id'),$reference_anchor$;
  reference_replacement constant text := $reference_replacement$('public.official_prices'::regclass, 'vendor_id'),
        ('public.disclosure_semantic_staging'::regclass, 'partner_vendor_id'),$reference_replacement$;
  move_anchor constant text := $move_anchor$
  UPDATE public.official_prices
  SET vendor_id = p_preserved_vendor_id,
      updated_at = now()
  WHERE vendor_id = losing_vendor_id;
$move_anchor$;
  move_replacement constant text := $move_replacement$
  UPDATE public.official_prices
  SET vendor_id = p_preserved_vendor_id,
      updated_at = now()
  WHERE vendor_id = losing_vendor_id;

  UPDATE public.disclosure_semantic_staging
  SET partner_vendor_id = p_preserved_vendor_id
  WHERE partner_vendor_id = losing_vendor_id;
$move_replacement$;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.decide_vendor_dedupe_candidate(uuid,text,uuid,uuid)'::regprocedure
  )
  INTO function_definition;

  IF length(function_definition) - length(replace(function_definition, reference_anchor, ''))
    <> length(reference_anchor)
  THEN
    RAISE EXCEPTION 'DISCLOSURE_SEMANTIC_VENDOR_DEDUPE_REFERENCE_ANCHOR_INVALID'
      USING ERRCODE = '55000';
  END IF;
  patched_definition := replace(
    function_definition,
    reference_anchor,
    reference_replacement
  );
  IF patched_definition = function_definition THEN
    RAISE EXCEPTION 'DISCLOSURE_SEMANTIC_VENDOR_DEDUPE_REFERENCE_PATCH_FAILED'
      USING ERRCODE = '55000';
  END IF;
  function_definition := patched_definition;

  IF length(function_definition) - length(replace(function_definition, move_anchor, ''))
    <> length(move_anchor)
  THEN
    RAISE EXCEPTION 'DISCLOSURE_SEMANTIC_VENDOR_DEDUPE_MOVE_ANCHOR_INVALID'
      USING ERRCODE = '55000';
  END IF;
  patched_definition := replace(
    function_definition,
    move_anchor,
    move_replacement
  );
  IF patched_definition = function_definition THEN
    RAISE EXCEPTION 'DISCLOSURE_SEMANTIC_VENDOR_DEDUPE_MOVE_PATCH_FAILED'
      USING ERRCODE = '55000';
  END IF;

  EXECUTE patched_definition;
END
$patch_vendor_dedupe_semantic_links$;

ALTER FUNCTION public.decide_vendor_dedupe_candidate(
  uuid, text, uuid, uuid
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.decide_vendor_dedupe_candidate(
  uuid, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decide_vendor_dedupe_candidate(
  uuid, text, uuid, uuid
) TO service_role;

ALTER TABLE public.disclosure_semantic_staging ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disclosure_semantic_staging FORCE ROW LEVEL SECURITY;

CREATE POLICY disclosure_semantic_service_select
  ON public.disclosure_semantic_staging
  FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY disclosure_semantic_service_insert_pending
  ON public.disclosure_semantic_staging
  FOR INSERT
  TO service_role
  WITH CHECK (review_status = 'pending');

REVOKE ALL ON TABLE public.disclosure_semantic_staging
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.disclosure_semantic_staging
  TO service_role;

DO $disclosure_semantic_staging_postconditions$
DECLARE
  relation_oid oid := 'public.disclosure_semantic_staging'::regclass;
  dedupe_definition text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class
    WHERE oid = relation_oid
      AND relrowsecurity IS TRUE
      AND relforcerowsecurity IS TRUE
  ) THEN
    RAISE EXCEPTION 'DISCLOSURE_SEMANTIC_RLS_POSTCONDITION_FAILED'
      USING ERRCODE = '55000';
  END IF;

  IF has_table_privilege('anon', relation_oid, 'SELECT')
    OR has_table_privilege('anon', relation_oid, 'INSERT')
    OR has_table_privilege('authenticated', relation_oid, 'SELECT')
    OR has_table_privilege('authenticated', relation_oid, 'INSERT')
    OR NOT has_table_privilege('service_role', relation_oid, 'SELECT')
    OR NOT has_table_privilege('service_role', relation_oid, 'INSERT')
    OR has_table_privilege('service_role', relation_oid, 'UPDATE')
    OR has_table_privilege('service_role', relation_oid, 'DELETE')
  THEN
    RAISE EXCEPTION 'DISCLOSURE_SEMANTIC_PRIVILEGE_POSTCONDITION_FAILED'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = relation_oid
      AND contype = 'u'
      AND pg_get_constraintdef(oid) = 'UNIQUE (snapshot_id, source_record_key)'
  ) THEN
    RAISE EXCEPTION 'DISCLOSURE_SEMANTIC_IDEMPOTENCY_POSTCONDITION_FAILED'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = relation_oid
      AND tgname = 'disclosure_semantic_draft_snapshot_fence'
      AND tgenabled = 'O'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'DISCLOSURE_SEMANTIC_SNAPSHOT_FENCE_POSTCONDITION_FAILED'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.official_prices'::regclass
      AND tgname = 'disclosure_semantic_price_link_sync'
      AND tgenabled = 'O'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'DISCLOSURE_SEMANTIC_PRICE_SYNC_POSTCONDITION_FAILED'
      USING ERRCODE = '55000';
  END IF;

  IF has_function_privilege(
    'service_role',
    'public.guard_and_sync_disclosure_semantic_price_link()',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'DISCLOSURE_SEMANTIC_PRICE_SYNC_PRIVILEGE_POSTCONDITION_FAILED'
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'public.decide_vendor_dedupe_candidate(uuid,text,uuid,uuid)'::regprocedure
  )
  INTO dedupe_definition;
  IF position(
    '(''public.disclosure_semantic_staging''::regclass, ''partner_vendor_id'')'
    IN dedupe_definition
  ) = 0
    OR position(
      'UPDATE public.disclosure_semantic_staging'
      IN dedupe_definition
    ) = 0
    OR position(
      'SET partner_vendor_id = p_preserved_vendor_id'
      IN dedupe_definition
    ) = 0
  THEN
    RAISE EXCEPTION 'DISCLOSURE_SEMANTIC_VENDOR_DEDUPE_POSTCONDITION_FAILED'
      USING ERRCODE = '55000';
  END IF;
END
$disclosure_semantic_staging_postconditions$;

COMMIT;
