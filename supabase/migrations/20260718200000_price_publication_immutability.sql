-- Published disclosure snapshots are append-only history. Any correction,
-- reassignment, or re-review must be represented by a new draft snapshot and
-- promoted atomically after review.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $price_snapshot_source_preflight$
DECLARE
  invalid_source_count bigint;
BEGIN
  SELECT count(*)
  INTO invalid_source_count
  FROM public.price_snapshots AS snapshot
  WHERE snapshot.source IS NULL
     OR snapshot.source NOT IN ('kca_tprice', 'agency_site', 'mixed');

  IF invalid_source_count > 0 THEN
    RAISE EXCEPTION 'PRICE_SNAPSHOT_SOURCE_LEGACY_VALUES_FOUND'
      USING
        ERRCODE = '55000',
        DETAIL = pg_catalog.format(
          '%s snapshot row(s) require an explicit source mapping before retry',
          invalid_source_count
        );
  END IF;
END
$price_snapshot_source_preflight$;

-- Promotion and every public projection require one approved vendor with a
-- stable public slug. Refuse to silently carry older, already-published rows
-- across this stricter boundary: an operator must repair them by publishing a
-- new reviewed snapshot first.
DO $price_snapshot_public_vendor_preflight$
DECLARE
  invalid_vendor_count bigint;
BEGIN
  SELECT count(*)
  INTO invalid_vendor_count
  FROM public.official_prices AS price
  JOIN public.price_snapshots AS snapshot ON snapshot.id = price.snapshot_id
  LEFT JOIN public.vendors AS vendor ON vendor.id = price.vendor_id
  WHERE snapshot.published IS TRUE
    AND price.review_status = 'approved'
    AND (
      vendor.id IS NULL
      OR vendor.status IS DISTINCT FROM 'approved'
      OR NULLIF(btrim(vendor.slug), '') IS NULL
      OR vendor.slug !~ '^[a-z0-9][a-z0-9-]{0,119}$'
    );

  IF invalid_vendor_count > 0 THEN
    RAISE EXCEPTION 'PRICE_SNAPSHOT_PUBLIC_VENDOR_LEGACY_VALUES_FOUND'
      USING
        ERRCODE = '55000',
        DETAIL = pg_catalog.format(
          '%s published approved price row(s) need a new reviewed snapshot with an approved vendor and stable slug',
          invalid_vendor_count
        );
  END IF;
END
$price_snapshot_public_vendor_preflight$;

ALTER TABLE public.price_snapshots
  DROP CONSTRAINT IF EXISTS price_snapshots_source_check;
ALTER TABLE public.price_snapshots
  ADD CONSTRAINT price_snapshots_source_check
  CHECK (source IN ('kca_tprice', 'agency_site', 'mixed')) NOT VALID;
ALTER TABLE public.price_snapshots
  VALIDATE CONSTRAINT price_snapshots_source_check;

-- Hosted Supabase normally installs pg_trgm in `extensions`, while an
-- existing local database may have installed it elsewhere. Bind one private
-- wrapper to the extension's catalog-owned namespace at migration time rather
-- than relying on a SECURITY DEFINER search_path or a spoofable public helper.
DO $bind_price_trigram_similarity$
DECLARE
  trigram_schema name;
BEGIN
  SELECT namespace.nspname
  INTO trigram_schema
  FROM pg_catalog.pg_extension AS extension_row
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = extension_row.extnamespace
  WHERE extension_row.extname = 'pg_trgm';

  IF trigram_schema IS NULL
    OR pg_catalog.to_regprocedure(
      pg_catalog.format('%I.similarity(text,text)', trigram_schema)
    ) IS NULL
  THEN
    RAISE EXCEPTION 'PRICE_TRIGRAM_EXTENSION_FUNCTION_NOT_FOUND'
      USING ERRCODE = '55000';
  END IF;

  EXECUTE pg_catalog.format(
    $wrapper_definition$
      CREATE OR REPLACE FUNCTION public.price_trigram_similarity(text, text)
      RETURNS real
      LANGUAGE sql
      IMMUTABLE
      STRICT
      PARALLEL SAFE
      SET search_path = pg_catalog, public, pg_temp
      AS $wrapper_body$
        SELECT %I.similarity($1, $2)
      $wrapper_body$
    $wrapper_definition$,
    trigram_schema
  );
END
$bind_price_trigram_similarity$;

ALTER FUNCTION public.price_trigram_similarity(text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.price_trigram_similarity(text, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.match_vendor_for_price_upload(
  p_name text,
  p_category text
)
RETURNS TABLE (
  vendor_id uuid,
  vendor_name text,
  vendor_slug text,
  aliases text[],
  similarity double precision,
  match_kind text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $match_vendor_for_price_upload$
  WITH input AS (
    SELECT
      public.normalize_price_vendor_name(p_name) AS normalized_name,
      CASE WHEN p_category = 'hall' THEN 'venue' ELSE p_category END
        AS normalized_category
  ), candidates AS (
    SELECT
      vendor.id,
      vendor.name,
      vendor.slug,
      vendor.aliases,
      public.normalize_price_vendor_name(vendor.name) = input.normalized_name
        AS exact_name,
      COALESCE(alias_score.exact_alias, false) AS exact_alias,
      GREATEST(
        public.price_trigram_similarity(
          public.normalize_price_vendor_name(vendor.name),
          input.normalized_name
        )::double precision,
        COALESCE(alias_score.best_similarity, 0::double precision)
      ) AS score
    FROM input
    JOIN public.vendors AS vendor
      ON vendor.category = input.normalized_category
     AND vendor.status IN ('pending', 'approved', 'draft')
    LEFT JOIN LATERAL (
      SELECT
        bool_or(
          public.normalize_price_vendor_name(alias_value)
            = input.normalized_name
        ) AS exact_alias,
        max(
          public.price_trigram_similarity(
            public.normalize_price_vendor_name(alias_value),
            input.normalized_name
          )
        )::double precision AS best_similarity
      FROM unnest(vendor.aliases) AS alias_value
    ) AS alias_score ON true
    WHERE input.normalized_name <> ''
  )
  SELECT
    candidate.id,
    candidate.name,
    candidate.slug,
    candidate.aliases,
    CASE
      WHEN candidate.exact_name OR candidate.exact_alias
        THEN 1::double precision
      ELSE candidate.score
    END,
    CASE
      WHEN candidate.exact_name THEN 'exact_name'
      WHEN candidate.exact_alias THEN 'exact_alias'
      ELSE 'similar'
    END
  FROM candidates AS candidate
  WHERE candidate.exact_name
     OR candidate.exact_alias
     OR candidate.score >= 0.6
  ORDER BY
    CASE
      WHEN candidate.exact_name THEN 0
      WHEN candidate.exact_alias THEN 1
      ELSE 2
    END,
    candidate.score DESC,
    candidate.id
  LIMIT 5
$match_vendor_for_price_upload$;

ALTER FUNCTION public.match_vendor_for_price_upload(text, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.match_vendor_for_price_upload(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.match_vendor_for_price_upload(text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.lookup_public_price_vendors(
  p_query text,
  p_category text DEFAULT NULL,
  p_limit integer DEFAULT 3
)
RETURNS TABLE (
  vendor_id uuid,
  vendor_slug text,
  vendor_name text,
  vendor_category text,
  aliases text[],
  similarity double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $lookup_public_price_vendors$
  WITH input AS (
    SELECT public.normalize_price_vendor_name(p_query) AS normalized_query
  ), published_vendors AS (
    SELECT DISTINCT
      price.vendor_id,
      price.vendor_slug,
      price.vendor_name,
      price.category,
      price.aliases
    FROM public.v_public_prices AS price
    WHERE price.is_current IS TRUE
      AND (
        p_category IS NULL
        OR p_category = ''
        OR price.category = CASE
          WHEN p_category = 'venue' THEN 'hall'
          ELSE p_category
        END
      )
  ), scored AS (
    SELECT
      vendor.*,
      GREATEST(
        public.price_trigram_similarity(
          public.normalize_price_vendor_name(vendor.vendor_name),
          input.normalized_query
        )::double precision,
        COALESCE(alias_score.best_similarity, 0::double precision)
      ) AS score
    FROM input
    JOIN published_vendors AS vendor ON input.normalized_query <> ''
    LEFT JOIN LATERAL (
      SELECT max(
        public.price_trigram_similarity(
          public.normalize_price_vendor_name(alias_value),
          input.normalized_query
        )
      )::double precision AS best_similarity
      FROM unnest(vendor.aliases) AS alias_value
    ) AS alias_score ON true
  )
  SELECT
    scored.vendor_id,
    scored.vendor_slug,
    scored.vendor_name,
    scored.category,
    scored.aliases,
    scored.score
  FROM scored
  WHERE scored.score >= 0.3
  ORDER BY scored.score DESC, scored.vendor_id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 3), 1), 3)
$lookup_public_price_vendors$;

ALTER FUNCTION public.lookup_public_price_vendors(text, text, integer)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.lookup_public_price_vendors(text, text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lookup_public_price_vendors(text, text, integer)
  TO service_role;

-- Defense in depth: an agency can become inactive after a historical snapshot
-- was published. Every consumer price/package projection enforces active,
-- unmerged agency identity at read time; direct disclosures with agency_id NULL
-- remain visible.
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
  price.updated_at,
  vendor.aliases AS vendor_aliases,
  agency.slug AS agency_slug,
  agency.display_name AS agency_display_name,
  snapshot.source_note,
  snapshot.published AS snapshot_published
FROM public.official_prices AS price
JOIN public.price_snapshots AS snapshot ON snapshot.id = price.snapshot_id
LEFT JOIN public.vendors AS vendor ON vendor.id = price.vendor_id
LEFT JOIN public.agencies AS agency ON agency.id = price.agency_id
WHERE snapshot.published IS TRUE
  AND price.review_status = 'approved'
  AND price.needs_review = false
  AND price.category IN ('studio', 'dress', 'makeup', 'hall', 'other')
  AND cardinality(price.source_object_keys) > 0
  AND NULLIF(btrim(price.source_quote), '') IS NOT NULL
  AND price.confidence IS NOT NULL
  AND (
    price.agency_id IS NULL
    OR (
      agency.is_active IS TRUE
      AND agency.merged_into_agency_id IS NULL
    )
  )
  AND vendor.id IS NOT NULL
  AND vendor.status = 'approved'
  AND NULLIF(btrim(vendor.slug), '') IS NOT NULL
  AND vendor.slug ~ '^[a-z0-9][a-z0-9-]{0,119}$';

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
  option_row.created_at,
  option_row.is_effectively_mandatory,
  option_row.sort_order
FROM public.official_price_options AS option_row
JOIN public.official_prices AS price ON price.id = option_row.official_price_id
JOIN public.price_snapshots AS snapshot ON snapshot.id = price.snapshot_id
LEFT JOIN public.vendors AS vendor ON vendor.id = price.vendor_id
LEFT JOIN public.agencies AS agency ON agency.id = price.agency_id
WHERE snapshot.published IS TRUE
  AND price.review_status = 'approved'
  AND price.needs_review = false
  AND price.category IN ('studio', 'dress', 'makeup', 'hall', 'other')
  AND cardinality(price.source_object_keys) > 0
  AND NULLIF(btrim(price.source_quote), '') IS NOT NULL
  AND price.confidence IS NOT NULL
  AND cardinality(option_row.source_object_keys) > 0
  AND NULLIF(btrim(option_row.source_quote), '') IS NOT NULL
  AND NULLIF(btrim(option_row.raw_text), '') IS NOT NULL
  AND option_row.confidence IS NOT NULL
  AND (
    price.agency_id IS NULL
    OR (
      agency.is_active IS TRUE
      AND agency.merged_into_agency_id IS NULL
    )
  )
  AND vendor.id IS NOT NULL
  AND vendor.status = 'approved'
  AND NULLIF(btrim(vendor.slug), '') IS NOT NULL
  AND vendor.slug ~ '^[a-z0-9][a-z0-9-]{0,119}$';

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
  package_row.updated_at,
  agency.slug AS agency_slug,
  agency.display_name AS agency_display_name,
  snapshot.source_note,
  snapshot.published AS snapshot_published,
  snapshot.is_current
FROM public.official_agency_packages AS package_row
JOIN public.price_snapshots AS snapshot ON snapshot.id = package_row.snapshot_id
JOIN public.agencies AS agency ON agency.id = package_row.agency_id
WHERE snapshot.published IS TRUE
  AND package_row.review_status = 'approved'
  AND package_row.needs_review = false
  AND cardinality(package_row.source_object_keys) > 0
  AND NULLIF(btrim(package_row.source_quote), '') IS NOT NULL
  AND package_row.confidence IS NOT NULL
  AND agency.is_active IS TRUE
  AND agency.merged_into_agency_id IS NULL;

CREATE OR REPLACE VIEW public.v_public_prices
WITH (security_barrier = true, security_invoker = false)
AS
SELECT
  price.id AS official_price_id,
  vendor.id AS vendor_id,
  vendor.slug AS vendor_slug,
  vendor.name AS vendor_name,
  CASE WHEN vendor.category = 'venue' THEN 'hall' ELSE vendor.category END
    AS category,
  vendor.region_code,
  vendor.aliases,
  agency.id AS agency_id,
  agency.slug AS agency_slug,
  agency.display_name AS agency_name,
  price.item_name,
  price.price_min_krw,
  price.price_max_krw,
  price.price_note,
  price.base_spec,
  price.vat_note,
  price.source_quote,
  snapshot.period_label,
  snapshot.source,
  snapshot.source_note,
  snapshot.published_at,
  snapshot.is_current
FROM public.official_prices AS price
JOIN public.price_snapshots AS snapshot ON snapshot.id = price.snapshot_id
JOIN public.vendors AS vendor ON vendor.id = price.vendor_id
LEFT JOIN public.agencies AS agency ON agency.id = price.agency_id
WHERE snapshot.published IS TRUE
  AND price.review_status = 'approved'
  AND price.needs_review = false
  AND vendor.id IS NOT NULL
  AND vendor.status = 'approved'
  AND NULLIF(btrim(vendor.slug), '') IS NOT NULL
  AND vendor.slug ~ '^[a-z0-9][a-z0-9-]{0,119}$'
  AND cardinality(price.source_object_keys) > 0
  AND NULLIF(btrim(price.source_quote), '') IS NOT NULL
  AND price.confidence IS NOT NULL
  AND (
    agency.id IS NULL
    OR (
      agency.is_active IS TRUE
      AND agency.merged_into_agency_id IS NULL
    )
  );

CREATE OR REPLACE VIEW public.v_public_price_options
WITH (security_barrier = true, security_invoker = false)
AS
SELECT
  option_row.id,
  option_row.official_price_id,
  price.vendor_id,
  price.agency_id,
  option_row.name,
  option_row.price_min_krw,
  option_row.price_max_krw,
  option_row.unit,
  option_row.condition,
  option_row.raw_text,
  option_row.is_effectively_mandatory,
  option_row.sort_order
FROM public.official_price_options AS option_row
JOIN public.official_prices AS price ON price.id = option_row.official_price_id
JOIN public.price_snapshots AS snapshot ON snapshot.id = price.snapshot_id
JOIN public.vendors AS vendor ON vendor.id = price.vendor_id
LEFT JOIN public.agencies AS agency ON agency.id = price.agency_id
WHERE snapshot.published IS TRUE
  AND price.review_status = 'approved'
  AND price.needs_review = false
  AND vendor.id IS NOT NULL
  AND vendor.status = 'approved'
  AND NULLIF(btrim(vendor.slug), '') IS NOT NULL
  AND vendor.slug ~ '^[a-z0-9][a-z0-9-]{0,119}$'
  AND cardinality(price.source_object_keys) > 0
  AND NULLIF(btrim(price.source_quote), '') IS NOT NULL
  AND price.confidence IS NOT NULL
  AND cardinality(option_row.source_object_keys) > 0
  AND NULLIF(btrim(option_row.source_quote), '') IS NOT NULL
  AND NULLIF(btrim(option_row.raw_text), '') IS NOT NULL
  AND option_row.confidence IS NOT NULL
  AND (
    agency.id IS NULL
    OR (
      agency.is_active IS TRUE
      AND agency.merged_into_agency_id IS NULL
    )
  );

ALTER VIEW public.v_public_official_prices OWNER TO postgres;
ALTER VIEW public.v_public_official_price_options OWNER TO postgres;
ALTER VIEW public.v_public_agency_packages OWNER TO postgres;
ALTER VIEW public.v_public_prices OWNER TO postgres;
ALTER VIEW public.v_public_price_options OWNER TO postgres;

REVOKE ALL ON TABLE
  public.v_public_official_prices,
  public.v_public_official_price_options,
  public.v_public_agency_packages,
  public.v_public_prices,
  public.v_public_price_options
FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE
  public.v_public_official_prices,
  public.v_public_official_price_options,
  public.v_public_agency_packages,
  public.v_public_prices,
  public.v_public_price_options
TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guard_published_price_snapshot_child_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $guard_published_price_snapshot_child_write$
DECLARE
  old_snapshot_id uuid;
  new_snapshot_id uuid;
  old_price_id uuid;
  new_price_id uuid;
  price_row record;
  snapshot_row record;
  old_price_found boolean := false;
  new_price_found boolean := false;
  old_snapshot_found boolean := false;
  new_snapshot_found boolean := false;
BEGIN
  IF TG_TABLE_NAME IN ('official_prices', 'official_agency_packages') THEN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      old_snapshot_id := OLD.snapshot_id;
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      new_snapshot_id := NEW.snapshot_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'official_price_options' THEN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      old_price_id := OLD.official_price_id;
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      new_price_id := NEW.official_price_id;
    END IF;

    -- Lock the referenced prices before their snapshots. This matches the
    -- parent-update path and prevents a price from changing snapshots between
    -- option-parent resolution and the publication check.
    FOR price_row IN
      SELECT price.id, price.snapshot_id
      FROM public.official_prices AS price
      WHERE price.id IN (old_price_id, new_price_id)
      ORDER BY price.id
      FOR SHARE
    LOOP
      IF price_row.id = old_price_id THEN
        old_price_found := true;
        old_snapshot_id := price_row.snapshot_id;
      END IF;
      IF price_row.id = new_price_id THEN
        new_price_found := true;
        new_snapshot_id := price_row.snapshot_id;
      END IF;
    END LOOP;

    IF TG_OP IN ('INSERT', 'UPDATE') AND new_price_found IS NOT TRUE THEN
      RAISE EXCEPTION 'PRICE_OPTION_PARENT_NOT_FOUND'
        USING ERRCODE = '23503';
    END IF;
    IF TG_OP = 'UPDATE' AND old_price_found IS NOT TRUE THEN
      RAISE EXCEPTION 'PRICE_OPTION_PARENT_NOT_FOUND'
        USING ERRCODE = '23503';
    END IF;
    IF TG_OP = 'DELETE' AND old_price_found IS NOT TRUE THEN
      -- The only valid missing-parent case is ON DELETE CASCADE. The parent
      -- price fence already rejected the cascade if that parent was published.
      RETURN OLD;
    END IF;
  ELSE
    RAISE EXCEPTION 'PRICE_SNAPSHOT_CHILD_TABLE_UNSUPPORTED'
      USING ERRCODE = '55000';
  END IF;

  -- Take the same exclusive parent lock as the pre-existing review fence from
  -- the first trigger onward. Taking SHARE here and upgrading to UPDATE in the
  -- next trigger lets two concurrent draft writers deadlock while both try to
  -- upgrade their locks.
  FOR snapshot_row IN
    SELECT snapshot.id, snapshot.published
    FROM public.price_snapshots AS snapshot
    WHERE snapshot.id IN (old_snapshot_id, new_snapshot_id)
    ORDER BY snapshot.id
    FOR UPDATE
  LOOP
    IF snapshot_row.id = old_snapshot_id THEN
      old_snapshot_found := true;
    END IF;
    IF snapshot_row.id = new_snapshot_id THEN
      new_snapshot_found := true;
    END IF;
    IF snapshot_row.published IS TRUE THEN
      RAISE EXCEPTION 'PRICE_SNAPSHOT_PUBLISHED_CHILD_IMMUTABLE'
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  -- Missing parents are valid only while an allowed draft snapshot DELETE is
  -- cascading. INSERT/UPDATE must never bypass an absent snapshot.
  IF TG_OP IN ('INSERT', 'UPDATE') AND new_snapshot_found IS NOT TRUE THEN
    RAISE EXCEPTION 'PRICE_SNAPSHOT_CHILD_SNAPSHOT_NOT_FOUND'
      USING ERRCODE = '23503';
  END IF;
  IF TG_OP = 'UPDATE' AND old_snapshot_found IS NOT TRUE THEN
    RAISE EXCEPTION 'PRICE_SNAPSHOT_CHILD_SNAPSHOT_NOT_FOUND'
      USING ERRCODE = '23503';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$guard_published_price_snapshot_child_write$;

ALTER FUNCTION public.guard_published_price_snapshot_child_write()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_published_price_snapshot_child_write()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guard_published_price_snapshot_history_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $guard_published_price_snapshot_history_write$
DECLARE
  promotion_owner text;
BEGIN
  -- A snapshot is always born as a non-current, unpublished draft. Promotion
  -- updates an existing reviewed draft; no direct INSERT path may create
  -- public history, even when executed by a database owner.
  IF TG_OP = 'INSERT' THEN
    IF NEW.published IS FALSE
      AND NEW.published_at IS NULL
      AND NEW.is_current IS FALSE
    THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'PRICE_SNAPSHOT_PROMOTION_RPC_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.published IS TRUE THEN
      RAISE EXCEPTION 'PRICE_SNAPSHOT_PUBLISHED_IMMUTABLE'
        USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.published IS TRUE THEN
    -- Promotion may move the current pointer to a newer snapshot. Every other
    -- column is historical evidence once published, including future columns
    -- added after this migration.
    IF (pg_catalog.to_jsonb(NEW) - 'is_current')
      IS DISTINCT FROM (pg_catalog.to_jsonb(OLD) - 'is_current')
    THEN
      RAISE EXCEPTION 'PRICE_SNAPSHOT_PUBLISHED_IMMUTABLE'
        USING ERRCODE = '55000';
    END IF;
  ELSIF NEW.published IS NOT DISTINCT FROM OLD.published
    AND NEW.published_at IS NOT DISTINCT FROM OLD.published_at
    AND NEW.is_current IS NOT DISTINCT FROM OLD.is_current
  THEN
    -- Ordinary draft metadata remains editable before review and promotion.
    RETURN NEW;
  END IF;

  IF NEW.is_current IS DISTINCT FROM OLD.is_current
    OR NEW.published IS DISTINCT FROM OLD.published
    OR NEW.published_at IS DISTINCT FROM OLD.published_at
  THEN
    SELECT pg_catalog.pg_get_userbyid(function_row.proowner)
    INTO promotion_owner
    FROM pg_catalog.pg_proc AS function_row
    WHERE function_row.oid =
      'public.promote_price_snapshot(uuid,uuid)'::regprocedure;

    IF promotion_owner IS NULL
      OR current_user::text IS DISTINCT FROM promotion_owner
    THEN
      RAISE EXCEPTION 'PRICE_SNAPSHOT_PROMOTION_RPC_REQUIRED'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END
$guard_published_price_snapshot_history_write$;

ALTER FUNCTION public.guard_published_price_snapshot_history_write()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_published_price_snapshot_history_write()
  FROM PUBLIC, anon, authenticated, service_role;

-- These functions and triggers originate in the promotion/consumer migrations.
-- Re-pin them here because this migration relies on their functional behavior
-- and must fail closed when an older environment has unsafe ownership or ACL
-- drift.
ALTER FUNCTION public.guard_price_snapshot_current_write()
  OWNER TO postgres;
ALTER FUNCTION public.guard_price_snapshot_current_write()
  SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION public.guard_price_snapshot_current_write()
  FROM PUBLIC, anon, authenticated, service_role;

ALTER FUNCTION public.guard_price_snapshot_publication_write()
  OWNER TO postgres;
ALTER FUNCTION public.guard_price_snapshot_publication_write()
  SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION public.guard_price_snapshot_publication_write()
  FROM PUBLIC, anon, authenticated, service_role;

ALTER FUNCTION public.mark_price_snapshot_published()
  OWNER TO postgres;
ALTER FUNCTION public.mark_price_snapshot_published()
  SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION public.mark_price_snapshot_published()
  FROM PUBLIC, anon, authenticated, service_role;

ALTER FUNCTION public.promote_price_snapshot(uuid, uuid)
  OWNER TO postgres;
ALTER FUNCTION public.promote_price_snapshot(uuid, uuid)
  SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION public.promote_price_snapshot(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.promote_price_snapshot(uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.assert_price_snapshot_public_identities()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $assert_price_snapshot_public_identities$
BEGIN
  IF NEW.is_current IS NOT TRUE
    OR (TG_OP = 'UPDATE' AND OLD.is_current IS TRUE)
  THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.official_prices AS price
    LEFT JOIN public.vendors AS vendor ON vendor.id = price.vendor_id
    WHERE price.snapshot_id = NEW.id
      AND price.review_status = 'approved'
      AND (
        vendor.id IS NULL
        OR vendor.status IS DISTINCT FROM 'approved'
        OR NULLIF(btrim(vendor.slug), '') IS NULL
        OR vendor.slug !~ '^[a-z0-9][a-z0-9-]{0,119}$'
      )
  ) THEN
    RAISE EXCEPTION 'PRICE_SNAPSHOT_VENDOR_NOT_PUBLIC'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.official_prices AS price
    LEFT JOIN public.agencies AS agency ON agency.id = price.agency_id
    WHERE price.snapshot_id = NEW.id
      AND price.review_status = 'approved'
      AND price.agency_id IS NOT NULL
      AND (
        agency.id IS NULL
        OR agency.is_active IS NOT TRUE
        OR agency.merged_into_agency_id IS NOT NULL
      )
    UNION ALL
    SELECT 1
    FROM public.official_agency_packages AS package_row
    LEFT JOIN public.agencies AS agency ON agency.id = package_row.agency_id
    WHERE package_row.snapshot_id = NEW.id
      AND package_row.review_status = 'approved'
      AND (
        agency.id IS NULL
        OR agency.is_active IS NOT TRUE
        OR agency.merged_into_agency_id IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'PRICE_SNAPSHOT_AGENCY_NOT_PUBLIC'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END
$assert_price_snapshot_public_identities$;

ALTER FUNCTION public.assert_price_snapshot_public_identities()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.assert_price_snapshot_public_identities()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS price_snapshots_10_public_identity_fence
  ON public.price_snapshots;
CREATE TRIGGER price_snapshots_10_public_identity_fence
BEFORE INSERT OR UPDATE OF is_current ON public.price_snapshots
FOR EACH ROW
EXECUTE FUNCTION public.assert_price_snapshot_public_identities();

DROP TRIGGER IF EXISTS price_snapshots_00_published_immutability_fence
  ON public.price_snapshots;
CREATE TRIGGER price_snapshots_00_published_immutability_fence
BEFORE INSERT OR UPDATE OR DELETE
ON public.price_snapshots
FOR EACH ROW
EXECUTE FUNCTION public.guard_published_price_snapshot_history_write();

DROP TRIGGER IF EXISTS official_prices_00_published_immutability_fence
  ON public.official_prices;
CREATE TRIGGER official_prices_00_published_immutability_fence
BEFORE INSERT OR UPDATE OR DELETE ON public.official_prices
FOR EACH ROW
EXECUTE FUNCTION public.guard_published_price_snapshot_child_write();

DROP TRIGGER IF EXISTS official_price_options_00_published_immutability_fence
  ON public.official_price_options;
CREATE TRIGGER official_price_options_00_published_immutability_fence
BEFORE INSERT OR UPDATE OR DELETE ON public.official_price_options
FOR EACH ROW
EXECUTE FUNCTION public.guard_published_price_snapshot_child_write();

DROP TRIGGER IF EXISTS official_agency_packages_00_published_immutability_fence
  ON public.official_agency_packages;
CREATE TRIGGER official_agency_packages_00_published_immutability_fence
BEFORE INSERT OR UPDATE OR DELETE ON public.official_agency_packages
FOR EACH ROW
EXECUTE FUNCTION public.guard_published_price_snapshot_child_write();

-- Do not leave ownership columns (or future business columns) outside the CAS
-- boundary. Virgin pending draft rows remain writable because the existing
-- guard explicitly permits that ingest/recovery state. Reviewed rows require
-- the versioned review RPC regardless of which column an UPDATE mentions.
DROP TRIGGER IF EXISTS official_prices_parent_review_write_fence
  ON public.official_prices;
CREATE TRIGGER official_prices_parent_review_write_fence
BEFORE INSERT OR UPDATE OR DELETE ON public.official_prices
FOR EACH ROW
EXECUTE FUNCTION public.guard_official_review_parent_write();

DROP TRIGGER IF EXISTS official_agency_packages_parent_review_write_fence
  ON public.official_agency_packages;
CREATE TRIGGER official_agency_packages_parent_review_write_fence
BEFORE INSERT OR UPDATE OR DELETE ON public.official_agency_packages
FOR EACH ROW
EXECUTE FUNCTION public.guard_official_review_parent_write();

DO $price_publication_immutability_postconditions$
DECLARE
  relation_name text;
BEGIN
  IF (
    SELECT count(*)
    FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgname IN (
      'official_prices_parent_review_write_fence',
      'official_agency_packages_parent_review_write_fence'
    )
      AND trigger_row.tgenabled = 'O'
      AND trigger_row.tgisinternal = false
  ) <> 2
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_row
      WHERE trigger_row.tgname IN (
        'official_prices_parent_review_write_fence',
        'official_agency_packages_parent_review_write_fence'
      )
        AND pg_catalog.pg_get_triggerdef(trigger_row.oid) LIKE '%UPDATE OF%'
    )
  THEN
    RAISE EXCEPTION
      'PRICE_PUBLICATION_IMMUTABILITY_POSTCONDITION_FAILED: parent CAS triggers'
      USING ERRCODE = '55000';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgname IN (
      'official_prices_00_published_immutability_fence',
      'official_price_options_00_published_immutability_fence',
      'official_agency_packages_00_published_immutability_fence',
      'price_snapshots_00_published_immutability_fence',
      'price_snapshots_10_public_identity_fence'
    )
      AND trigger_row.tgenabled = 'O'
      AND trigger_row.tgisinternal = false
  ) <> 5
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_row
      WHERE trigger_row.tgname =
        'price_snapshots_00_published_immutability_fence'
        AND pg_catalog.pg_get_triggerdef(trigger_row.oid) LIKE '%UPDATE OF%'
    )
  THEN
    RAISE EXCEPTION
      'PRICE_PUBLICATION_IMMUTABILITY_POSTCONDITION_FAILED: publication triggers'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      VALUES
        (
          'price_snapshot_current_write_fence'::text,
          'public.price_snapshots'::regclass,
          'public.guard_price_snapshot_current_write()'::regprocedure
        ),
        (
          'price_snapshot_publication_write_fence'::text,
          'public.price_snapshots'::regclass,
          'public.guard_price_snapshot_publication_write()'::regprocedure
        ),
        (
          'price_snapshot_mark_published'::text,
          'public.price_snapshots'::regclass,
          'public.mark_price_snapshot_published()'::regprocedure
        )
    ) AS required_trigger(trigger_name, relation_oid, function_oid)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_row
      WHERE trigger_row.tgname = required_trigger.trigger_name
        AND trigger_row.tgrelid = required_trigger.relation_oid
        AND trigger_row.tgfoid = required_trigger.function_oid
        AND trigger_row.tgenabled = 'O'
        AND trigger_row.tgisinternal = false
    )
  ) THEN
    RAISE EXCEPTION
      'PRICE_PUBLICATION_IMMUTABILITY_POSTCONDITION_FAILED: legacy publication triggers'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS function_row
    WHERE function_row.oid IN (
      'public.guard_published_price_snapshot_child_write()'::regprocedure,
      'public.guard_published_price_snapshot_history_write()'::regprocedure,
      'public.assert_price_snapshot_public_identities()'::regprocedure,
      'public.guard_price_snapshot_current_write()'::regprocedure,
      'public.guard_price_snapshot_publication_write()'::regprocedure,
      'public.mark_price_snapshot_published()'::regprocedure,
      'public.price_trigram_similarity(text,text)'::regprocedure
    )
      AND (
        pg_catalog.pg_get_userbyid(function_row.proowner) <> 'postgres'
        OR function_row.prosecdef
        OR COALESCE(
          function_row.proconfig @>
            ARRAY['search_path=pg_catalog, public, pg_temp']::text[],
          false
        ) IS NOT TRUE
        OR has_function_privilege('anon', function_row.oid, 'EXECUTE')
        OR has_function_privilege(
          'authenticated', function_row.oid, 'EXECUTE'
        )
        OR has_function_privilege('service_role', function_row.oid, 'EXECUTE')
      )
  ) THEN
    RAISE EXCEPTION
      'PRICE_PUBLICATION_IMMUTABILITY_POSTCONDITION_FAILED: private helpers'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS function_row
    WHERE function_row.oid =
      'public.promote_price_snapshot(uuid,uuid)'::regprocedure
      AND (
        pg_catalog.pg_get_userbyid(function_row.proowner) <> 'postgres'
        OR function_row.prosecdef IS NOT TRUE
        OR COALESCE(
          function_row.proconfig @>
            ARRAY['search_path=pg_catalog, public, pg_temp']::text[],
          false
        ) IS NOT TRUE
        OR has_function_privilege('anon', function_row.oid, 'EXECUTE')
        OR has_function_privilege(
          'authenticated', function_row.oid, 'EXECUTE'
        )
        OR NOT has_function_privilege(
          'service_role', function_row.oid, 'EXECUTE'
        )
      )
  ) THEN
    RAISE EXCEPTION
      'PRICE_PUBLICATION_IMMUTABILITY_POSTCONDITION_FAILED: promotion RPC ACL'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS function_row
    WHERE function_row.oid IN (
      'public.match_vendor_for_price_upload(text,text)'::regprocedure,
      'public.lookup_public_price_vendors(text,text,integer)'::regprocedure
    )
      AND (
        pg_catalog.pg_get_userbyid(function_row.proowner) <> 'postgres'
        OR function_row.prosecdef IS NOT TRUE
        OR COALESCE(
          function_row.proconfig @>
            ARRAY['search_path=pg_catalog, public, pg_temp']::text[],
          false
        ) IS NOT TRUE
        OR has_function_privilege('anon', function_row.oid, 'EXECUTE')
        OR has_function_privilege(
          'authenticated', function_row.oid, 'EXECUTE'
        )
        OR NOT has_function_privilege(
          'service_role', function_row.oid, 'EXECUTE'
        )
      )
  ) THEN
    RAISE EXCEPTION
      'PRICE_PUBLICATION_IMMUTABILITY_POSTCONDITION_FAILED: lookup RPC ACL'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.price_snapshots'::regclass
      AND constraint_row.conname = 'price_snapshots_source_check'
      AND constraint_row.convalidated
  ) THEN
    RAISE EXCEPTION
      'PRICE_PUBLICATION_IMMUTABILITY_POSTCONDITION_FAILED: source constraint'
      USING ERRCODE = '55000';
  END IF;

  FOREACH relation_name IN ARRAY ARRAY[
    'v_public_official_prices',
    'v_public_official_price_options',
    'v_public_agency_packages',
    'v_public_prices',
    'v_public_price_options'
  ]
  LOOP
    IF position(
      'is_active'
      IN pg_catalog.pg_get_viewdef(
        pg_catalog.to_regclass('public.' || relation_name),
        true
      )
    ) = 0 THEN
      RAISE EXCEPTION
        'PRICE_PUBLICATION_IMMUTABILITY_POSTCONDITION_FAILED: % agency filter',
        relation_name
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  FOREACH relation_name IN ARRAY ARRAY[
    'v_public_official_prices',
    'v_public_official_price_options',
    'v_public_prices',
    'v_public_price_options'
  ]
  LOOP
    IF position(
      'vendor.id IS NOT NULL'
      IN pg_catalog.pg_get_viewdef(
        pg_catalog.to_regclass('public.' || relation_name),
        true
      )
    ) = 0
      OR position(
        'vendor.status = ''approved'''
        IN pg_catalog.pg_get_viewdef(
          pg_catalog.to_regclass('public.' || relation_name),
          true
        )
      ) = 0
      OR position(
        '^[a-z0-9][a-z0-9-]{0,119}$'
        IN pg_catalog.pg_get_viewdef(
          pg_catalog.to_regclass('public.' || relation_name),
          true
        )
      ) = 0
    THEN
      RAISE EXCEPTION
        'PRICE_PUBLICATION_IMMUTABILITY_POSTCONDITION_FAILED: % vendor filter',
        relation_name
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$price_publication_immutability_postconditions$;

COMMIT;
