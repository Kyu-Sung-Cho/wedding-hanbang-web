-- Public disclosure rows expose normalized facts, approved short option text,
-- and bounded provenance only. Source quotes stay service-only, while every
-- reviewed write is fenced against contact data and excessive length before it
-- can become consumer-visible.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.disclosure_public_text_is_safe(
  p_value text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $disclosure_public_text_is_safe$
  SELECT p_value IS NULL OR NOT (
    p_value ~* '[[:alnum:]_.%+\-]+@[[:alnum:].\-]+\.[[:alpha:]]{2,}'
    OR p_value ~* 'https?://|www\.|open\.kakao\.com/|pf\.kakao\.com/|mailto:|tel:|sms:'
    OR p_value ~* '(^|[[:space:]<(])([[:alnum:]\-]+\.)+[[:alpha:]]{2,}([/#?][^[:space:]<>]*)?($|[[:space:]>),])'
    OR p_value ~ '(^|[^0-9])((\+?82[ .\-]?)?0?1[016789][ .\-]?[0-9]{3,4}[ .\-]?[0-9]{4})([^0-9]|$)'
    OR p_value ~ '(^|[^0-9])0(2|[3-6][1-5])[ .\-]?[0-9]{3,4}[ .\-]?[0-9]{4}([^0-9]|$)'
    OR p_value ~ '(^|[^0-9])[0-9]{6}[ .\-]?[1-4][0-9]{6}([^0-9]|$)'
    OR p_value ~* '(^|[[:space:]<(])@[[:alnum:]_.\-]{2,}'
    OR p_value ~* '(카카오(톡)?|오픈채팅|인스타(그램)?|텔레그램|라인|연락처|연락|전화|주소)[[:space:]]*[:：][[:space:]]*[^[:space:]]{2,}'
  )
$disclosure_public_text_is_safe$;

ALTER FUNCTION public.disclosure_public_text_is_safe(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.disclosure_public_text_is_safe(text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.assert_disclosure_public_text_safe(
  p_field text,
  p_value text
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $assert_disclosure_public_text_safe$
DECLARE
  maximum_length integer := CASE p_field
    WHEN 'period_label' THEN 100
    WHEN 'item_name' THEN 200
    WHEN 'base_spec' THEN 2000
    WHEN 'vat_note' THEN 1000
    WHEN 'price_note' THEN 2000
    WHEN 'option_name' THEN 300
    WHEN 'option_unit' THEN 100
    WHEN 'option_condition' THEN 1000
    WHEN 'option_raw_text' THEN 2000
    WHEN 'option_source_quote' THEN 4000
    WHEN 'package_name' THEN 300
    WHEN 'package_vat_note' THEN 1000
    WHEN 'package_price_note' THEN 2000
    WHEN 'package_option_name' THEN 300
    WHEN 'package_option_unit' THEN 100
    WHEN 'package_option_condition' THEN 1000
    WHEN 'package_option_raw_text' THEN 2000
    WHEN 'package_option_source_quote' THEN 1000
    WHEN 'package_source_quote' THEN 1000
    WHEN 'source_quote' THEN 4000
    ELSE 1000
  END;
BEGIN
  IF p_value IS NOT NULL AND length(p_value) > maximum_length THEN
    RAISE EXCEPTION 'DISCLOSURE_PUBLIC_TEXT_LENGTH_BLOCKED:%', p_field
      USING ERRCODE = '22023';
  END IF;
  IF NOT public.disclosure_public_text_is_safe(p_value) THEN
    RAISE EXCEPTION 'DISCLOSURE_PUBLIC_TEXT_PII_BLOCKED:%', p_field
      USING ERRCODE = '22023';
  END IF;
END
$assert_disclosure_public_text_safe$;

ALTER FUNCTION public.assert_disclosure_public_text_safe(text, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.assert_disclosure_public_text_safe(text, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- Fail closed before replacing the public contract if an already-published
-- normalized fact contains contact data or exceeds its public size bound.
-- Source quotes remain private, but approved raw option text is public and is
-- therefore included in this fail-closed preflight.
DO $existing_public_disclosure_text_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.price_snapshots AS snapshot
    WHERE snapshot.published IS TRUE
      AND (
        NOT public.disclosure_public_text_is_safe(snapshot.period_label)
        OR length(COALESCE(snapshot.period_label, '')) > 100
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.official_prices AS price
    JOIN public.price_snapshots AS snapshot ON snapshot.id = price.snapshot_id
    WHERE snapshot.published IS TRUE
      AND price.review_status = 'approved'
      AND (
        NOT public.disclosure_public_text_is_safe(price.item_name)
        OR NOT public.disclosure_public_text_is_safe(price.base_spec)
        OR NOT public.disclosure_public_text_is_safe(price.vat_note)
        OR NOT public.disclosure_public_text_is_safe(price.price_note)
        OR length(COALESCE(price.item_name, '')) > 200
        OR length(COALESCE(price.base_spec, '')) > 2000
        OR length(COALESCE(price.vat_note, '')) > 1000
        OR length(COALESCE(price.price_note, '')) > 2000
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.official_price_options AS option_row
    JOIN public.official_prices AS price
      ON price.id = option_row.official_price_id
    JOIN public.price_snapshots AS snapshot ON snapshot.id = price.snapshot_id
    WHERE snapshot.published IS TRUE
      AND price.review_status = 'approved'
      AND (
        NOT public.disclosure_public_text_is_safe(option_row.name)
        OR NOT public.disclosure_public_text_is_safe(option_row.unit)
        OR NOT public.disclosure_public_text_is_safe(option_row.condition)
        OR NOT public.disclosure_public_text_is_safe(option_row.raw_text)
        OR length(COALESCE(option_row.name, '')) > 300
        OR length(COALESCE(option_row.unit, '')) > 100
        OR length(COALESCE(option_row.condition, '')) > 1000
        OR length(COALESCE(option_row.raw_text, '')) > 2000
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.official_agency_packages AS package_row
    JOIN public.price_snapshots AS snapshot
      ON snapshot.id = package_row.snapshot_id
    WHERE snapshot.published IS TRUE
      AND package_row.review_status = 'approved'
      AND (
        NOT public.disclosure_public_text_is_safe(package_row.package_name)
        OR NOT public.disclosure_public_text_is_safe(package_row.vat_note)
        OR NOT public.disclosure_public_text_is_safe(package_row.price_note)
        OR length(COALESCE(package_row.package_name, '')) > 300
        OR length(COALESCE(package_row.vat_note, '')) > 1000
        OR length(COALESCE(package_row.price_note, '')) > 2000
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(package_row.options) AS option_value(value)
          WHERE NOT public.disclosure_public_text_is_safe(option_value.value ->> 'name')
            OR NOT public.disclosure_public_text_is_safe(option_value.value ->> 'unit')
            OR NOT public.disclosure_public_text_is_safe(option_value.value ->> 'condition')
            OR NOT public.disclosure_public_text_is_safe(option_value.value ->> 'raw_text')
            OR length(COALESCE(option_value.value ->> 'name', '')) > 300
            OR length(COALESCE(option_value.value ->> 'unit', '')) > 100
            OR length(COALESCE(option_value.value ->> 'condition', '')) > 1000
            OR length(COALESCE(option_value.value ->> 'raw_text', '')) > 2000
        )
      )
  ) THEN
    RAISE EXCEPTION 'EXISTING_PUBLIC_DISCLOSURE_TEXT_REQUIRES_PRIVACY_REVIEW'
      USING ERRCODE = '55000';
  END IF;
END
$existing_public_disclosure_text_preflight$;

CREATE OR REPLACE FUNCTION public.guard_disclosure_review_public_text()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $guard_disclosure_review_public_text$
DECLARE
  should_validate boolean := false;
  option_row record;
  price_row record;
  package_row record;
BEGIN
  IF TG_TABLE_NAME = 'price_snapshots' THEN
    IF NEW.published IS TRUE THEN
      PERFORM public.assert_disclosure_public_text_safe(
        'period_label', NEW.period_label
      );

      FOR price_row IN
        SELECT candidate.*
        FROM public.official_prices AS candidate
        WHERE candidate.snapshot_id = NEW.id
          AND candidate.review_status = 'approved'
          AND candidate.needs_review = false
        ORDER BY candidate.id
      LOOP
        PERFORM public.assert_disclosure_public_text_safe(
          'item_name', price_row.item_name
        );
        PERFORM public.assert_disclosure_public_text_safe(
          'base_spec', price_row.base_spec
        );
        PERFORM public.assert_disclosure_public_text_safe(
          'vat_note', price_row.vat_note
        );
        PERFORM public.assert_disclosure_public_text_safe(
          'price_note', price_row.price_note
        );
        PERFORM public.assert_disclosure_public_text_safe(
          'source_quote', price_row.source_quote
        );

        FOR option_row IN
          SELECT candidate.*
          FROM public.official_price_options AS candidate
          WHERE candidate.official_price_id = price_row.id
          ORDER BY candidate.id
        LOOP
          PERFORM public.assert_disclosure_public_text_safe(
            'option_name', option_row.name
          );
          PERFORM public.assert_disclosure_public_text_safe(
            'option_unit', option_row.unit
          );
          PERFORM public.assert_disclosure_public_text_safe(
            'option_condition', option_row.condition
          );
          PERFORM public.assert_disclosure_public_text_safe(
            'option_raw_text', option_row.raw_text
          );
          PERFORM public.assert_disclosure_public_text_safe(
            'option_source_quote', option_row.source_quote
          );
        END LOOP;
      END LOOP;

      FOR package_row IN
        SELECT candidate.*
        FROM public.official_agency_packages AS candidate
        WHERE candidate.snapshot_id = NEW.id
          AND candidate.review_status = 'approved'
          AND candidate.needs_review = false
        ORDER BY candidate.id
      LOOP
        PERFORM public.assert_disclosure_public_text_safe(
          'package_name', package_row.package_name
        );
        PERFORM public.assert_disclosure_public_text_safe(
          'package_vat_note', package_row.vat_note
        );
        PERFORM public.assert_disclosure_public_text_safe(
          'package_price_note', package_row.price_note
        );
        PERFORM public.assert_disclosure_public_text_safe(
          'package_source_quote', package_row.source_quote
        );

        FOR option_row IN
          SELECT option_value.value
          FROM jsonb_array_elements(package_row.options) WITH ORDINALITY
            AS option_value(value, ordinality)
          ORDER BY option_value.ordinality
        LOOP
          PERFORM public.assert_disclosure_public_text_safe(
            'package_option_name', option_row.value ->> 'name'
          );
          PERFORM public.assert_disclosure_public_text_safe(
            'package_option_unit', option_row.value ->> 'unit'
          );
          PERFORM public.assert_disclosure_public_text_safe(
            'package_option_condition', option_row.value ->> 'condition'
          );
          PERFORM public.assert_disclosure_public_text_safe(
            'package_option_raw_text', option_row.value ->> 'raw_text'
          );
          PERFORM public.assert_disclosure_public_text_safe(
            'package_option_source_quote', option_row.value ->> 'source_quote'
          );
        END LOOP;
      END LOOP;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'official_price_options' THEN
    SELECT price.review_status = 'approved' OR price.reviewed_by IS NOT NULL
    INTO should_validate
    FROM public.official_prices AS price
    WHERE price.id = NEW.official_price_id;

    IF COALESCE(should_validate, false) THEN
      PERFORM public.assert_disclosure_public_text_safe('option_name', NEW.name);
      PERFORM public.assert_disclosure_public_text_safe('option_unit', NEW.unit);
      PERFORM public.assert_disclosure_public_text_safe(
        'option_condition', NEW.condition
      );
      PERFORM public.assert_disclosure_public_text_safe(
        'option_raw_text', NEW.raw_text
      );
      PERFORM public.assert_disclosure_public_text_safe(
        'option_source_quote', NEW.source_quote
      );
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'official_prices' THEN
    should_validate := NEW.review_status = 'approved' OR NEW.reviewed_by IS NOT NULL;
    IF should_validate THEN
      PERFORM public.assert_disclosure_public_text_safe('item_name', NEW.item_name);
      PERFORM public.assert_disclosure_public_text_safe('base_spec', NEW.base_spec);
      PERFORM public.assert_disclosure_public_text_safe('vat_note', NEW.vat_note);
      PERFORM public.assert_disclosure_public_text_safe('price_note', NEW.price_note);

      FOR option_row IN
        SELECT option_value.*
        FROM public.official_price_options AS option_value
        WHERE option_value.official_price_id = NEW.id
        ORDER BY option_value.id
      LOOP
        PERFORM public.assert_disclosure_public_text_safe(
          'option_name', option_row.name
        );
        PERFORM public.assert_disclosure_public_text_safe(
          'option_unit', option_row.unit
        );
        PERFORM public.assert_disclosure_public_text_safe(
          'option_condition', option_row.condition
        );
        PERFORM public.assert_disclosure_public_text_safe(
          'option_raw_text', option_row.raw_text
        );
        PERFORM public.assert_disclosure_public_text_safe(
          'option_source_quote', option_row.source_quote
        );
      END LOOP;

      PERFORM public.assert_disclosure_public_text_safe(
        'source_quote', NEW.source_quote
      );
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'official_agency_packages' THEN
    should_validate := NEW.review_status = 'approved' OR NEW.reviewed_by IS NOT NULL;
    IF should_validate THEN
      PERFORM public.assert_disclosure_public_text_safe(
        'package_name', NEW.package_name
      );
      PERFORM public.assert_disclosure_public_text_safe(
        'package_vat_note', NEW.vat_note
      );
      PERFORM public.assert_disclosure_public_text_safe(
        'package_price_note', NEW.price_note
      );

      FOR option_row IN
        SELECT option_value.value
        FROM jsonb_array_elements(NEW.options) WITH ORDINALITY
          AS option_value(value, ordinality)
        ORDER BY option_value.ordinality
      LOOP
        PERFORM public.assert_disclosure_public_text_safe(
          'package_option_name', option_row.value ->> 'name'
        );
        PERFORM public.assert_disclosure_public_text_safe(
          'package_option_unit', option_row.value ->> 'unit'
        );
        PERFORM public.assert_disclosure_public_text_safe(
          'package_option_condition', option_row.value ->> 'condition'
        );
        PERFORM public.assert_disclosure_public_text_safe(
          'package_option_raw_text', option_row.value ->> 'raw_text'
        );
        PERFORM public.assert_disclosure_public_text_safe(
          'package_option_source_quote', option_row.value ->> 'source_quote'
        );
      END LOOP;

      PERFORM public.assert_disclosure_public_text_safe(
        'package_source_quote', NEW.source_quote
      );
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'DISCLOSURE_PUBLIC_TEXT_UNSUPPORTED_TABLE:%', TG_TABLE_NAME
    USING ERRCODE = '55000';
END
$guard_disclosure_review_public_text$;

ALTER FUNCTION public.guard_disclosure_review_public_text() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_disclosure_review_public_text()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS price_snapshots_public_text_privacy
  ON public.price_snapshots;
CREATE TRIGGER price_snapshots_public_text_privacy
BEFORE INSERT OR UPDATE OF period_label, published
ON public.price_snapshots
FOR EACH ROW
EXECUTE FUNCTION public.guard_disclosure_review_public_text();

DROP TRIGGER IF EXISTS official_prices_public_text_privacy
  ON public.official_prices;
CREATE TRIGGER official_prices_public_text_privacy
BEFORE INSERT OR UPDATE OF
  item_name,
  base_spec,
  vat_note,
  price_note,
  source_quote,
  review_status,
  reviewed_by,
  review_action
ON public.official_prices
FOR EACH ROW
EXECUTE FUNCTION public.guard_disclosure_review_public_text();

DROP TRIGGER IF EXISTS official_price_options_public_text_privacy
  ON public.official_price_options;
CREATE TRIGGER official_price_options_public_text_privacy
BEFORE INSERT OR UPDATE OF
  name,
  unit,
  condition,
  raw_text,
  source_quote
ON public.official_price_options
FOR EACH ROW
EXECUTE FUNCTION public.guard_disclosure_review_public_text();

DROP TRIGGER IF EXISTS official_agency_packages_public_text_privacy
  ON public.official_agency_packages;
CREATE TRIGGER official_agency_packages_public_text_privacy
BEFORE INSERT OR UPDATE OF
  package_name,
  vat_note,
  price_note,
  options,
  source_quote,
  review_status,
  reviewed_by,
  review_action
ON public.official_agency_packages
FOR EACH ROW
EXECUTE FUNCTION public.guard_disclosure_review_public_text();

-- Private evidence projections depend on their public fact projections after a
-- successful run, so remove them first to keep this migration replay-safe.
DROP VIEW IF EXISTS
  public.v_private_admin_official_price_options,
  public.v_private_admin_official_prices,
  public.v_private_admin_agency_packages;

DROP VIEW IF EXISTS
  public.v_public_official_price_options,
  public.v_public_official_prices,
  public.v_public_agency_packages,
  public.v_public_price_options,
  public.v_public_prices;

CREATE VIEW public.v_public_official_prices
WITH (security_barrier = true, security_invoker = false)
AS
SELECT
  price.id,
  price.snapshot_id,
  snapshot.period_label,
  snapshot.source,
  CASE snapshot.source
    WHEN 'kca_tprice' THEN '한국소비자원 참가격'
    WHEN 'agency_site' THEN '업체 공식 공시'
    WHEN 'mixed' THEN '복수 공식 자료'
    ELSE '공식 공시 자료'
  END || ' · ' || snapshot.period_label AS source_label,
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
  price.created_at,
  price.updated_at,
  vendor.aliases AS vendor_aliases,
  agency.slug AS agency_slug,
  agency.display_name AS agency_display_name,
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

CREATE VIEW public.v_public_official_price_options
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

CREATE VIEW public.v_public_agency_packages
WITH (security_barrier = true, security_invoker = false)
AS
SELECT
  package_row.id,
  package_row.snapshot_id,
  snapshot.period_label,
  snapshot.source,
  CASE snapshot.source
    WHEN 'kca_tprice' THEN '한국소비자원 참가격'
    WHEN 'agency_site' THEN '업체 공식 공시'
    WHEN 'mixed' THEN '복수 공식 자료'
    ELSE '공식 공시 자료'
  END || ' · ' || snapshot.period_label AS source_label,
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
  COALESCE(safe_options.options, '[]'::jsonb) AS options,
  package_row.created_at,
  package_row.updated_at,
  agency.slug AS agency_slug,
  agency.display_name AS agency_display_name,
  snapshot.published AS snapshot_published,
  snapshot.is_current
FROM public.official_agency_packages AS package_row
JOIN public.price_snapshots AS snapshot ON snapshot.id = package_row.snapshot_id
JOIN public.agencies AS agency ON agency.id = package_row.agency_id
LEFT JOIN LATERAL (
  SELECT jsonb_agg(
    jsonb_build_object(
      'name', option_value.value -> 'name',
      'price_min_krw', option_value.value -> 'price_min_krw',
      'price_max_krw', option_value.value -> 'price_max_krw',
      'unit', option_value.value -> 'unit',
      'condition', option_value.value -> 'condition',
      'raw_text', option_value.value -> 'raw_text'
    ) ORDER BY option_value.ordinality
  ) AS options
  FROM jsonb_array_elements(package_row.options) WITH ORDINALITY
    AS option_value(value, ordinality)
  WHERE jsonb_typeof(option_value.value) = 'object'
) AS safe_options ON true
WHERE snapshot.published IS TRUE
  AND package_row.review_status = 'approved'
  AND package_row.needs_review = false
  AND cardinality(package_row.source_object_keys) > 0
  AND NULLIF(btrim(package_row.source_quote), '') IS NOT NULL
  AND package_row.confidence IS NOT NULL
  AND agency.is_active IS TRUE
  AND agency.merged_into_agency_id IS NULL;

CREATE VIEW public.v_public_prices
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
  snapshot.period_label,
  snapshot.source,
  CASE snapshot.source
    WHEN 'kca_tprice' THEN '한국소비자원 참가격'
    WHEN 'agency_site' THEN '업체 공식 공시'
    WHEN 'mixed' THEN '복수 공식 자료'
    ELSE '공식 공시 자료'
  END || ' · ' || snapshot.period_label AS source_label,
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

CREATE VIEW public.v_public_price_options
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

CREATE VIEW public.v_private_admin_official_prices
WITH (security_barrier = true, security_invoker = false)
AS
SELECT public_price.*, price.source_quote
FROM public.v_public_official_prices AS public_price
JOIN public.official_prices AS price ON price.id = public_price.id;

CREATE VIEW public.v_private_admin_official_price_options
WITH (security_barrier = true, security_invoker = false)
AS
SELECT public_option.*, option_row.source_quote
FROM public.v_public_official_price_options AS public_option
JOIN public.official_price_options AS option_row ON option_row.id = public_option.id;

CREATE VIEW public.v_private_admin_agency_packages
WITH (security_barrier = true, security_invoker = false)
AS
SELECT
  public_package.id,
  public_package.snapshot_id,
  public_package.period_label,
  public_package.source,
  public_package.source_label,
  public_package.published_at,
  public_package.agency_id,
  public_package.agency_name,
  public_package.region_code,
  public_package.package_name,
  public_package.category_scope,
  public_package.price_min_krw,
  public_package.price_max_krw,
  public_package.vat_note,
  public_package.price_note,
  package_row.options,
  package_row.source_quote,
  public_package.created_at,
  public_package.updated_at,
  public_package.agency_slug,
  public_package.agency_display_name,
  public_package.snapshot_published,
  public_package.is_current
FROM public.v_public_agency_packages AS public_package
JOIN public.official_agency_packages AS package_row
  ON package_row.id = public_package.id;

ALTER VIEW public.v_public_official_prices OWNER TO postgres;
ALTER VIEW public.v_public_official_price_options OWNER TO postgres;
ALTER VIEW public.v_public_agency_packages OWNER TO postgres;
ALTER VIEW public.v_public_prices OWNER TO postgres;
ALTER VIEW public.v_public_price_options OWNER TO postgres;
ALTER VIEW public.v_private_admin_official_prices OWNER TO postgres;
ALTER VIEW public.v_private_admin_official_price_options OWNER TO postgres;
ALTER VIEW public.v_private_admin_agency_packages OWNER TO postgres;

REVOKE ALL ON TABLE
  public.v_public_official_prices,
  public.v_public_official_price_options,
  public.v_public_agency_packages,
  public.v_public_prices,
  public.v_public_price_options,
  public.v_private_admin_official_prices,
  public.v_private_admin_official_price_options,
  public.v_private_admin_agency_packages
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE
  public.v_public_official_prices,
  public.v_public_official_price_options,
  public.v_public_agency_packages,
  public.v_public_prices,
  public.v_public_price_options
TO anon, authenticated, service_role;

GRANT SELECT ON TABLE
  public.v_private_admin_official_prices,
  public.v_private_admin_official_price_options,
  public.v_private_admin_agency_packages
TO service_role;

DO $public_disclosure_evidence_privacy_postconditions$
DECLARE
  leaked_column_count integer;
  required_raw_text_column_count integer;
  private_client_grant_count integer;
BEGIN
  SELECT count(*)::integer
  INTO leaked_column_count
  FROM information_schema.columns AS column_row
  WHERE column_row.table_schema = 'public'
    AND column_row.table_name IN (
      'v_public_official_prices',
      'v_public_official_price_options',
      'v_public_agency_packages',
      'v_public_prices',
      'v_public_price_options'
    )
    AND column_row.column_name IN ('source_quote', 'source_note');

  SELECT count(*)::integer
  INTO required_raw_text_column_count
  FROM information_schema.columns AS column_row
  WHERE column_row.table_schema = 'public'
    AND column_row.table_name IN (
      'v_public_official_price_options',
      'v_public_price_options'
    )
    AND column_row.column_name = 'raw_text';

  SELECT count(*)::integer
  INTO private_client_grant_count
  FROM information_schema.role_table_grants AS table_grant
  WHERE table_grant.table_schema = 'public'
    AND table_grant.table_name IN (
      'v_private_admin_official_prices',
      'v_private_admin_official_price_options',
      'v_private_admin_agency_packages'
    )
    AND table_grant.grantee IN ('PUBLIC', 'anon', 'authenticated');

  IF leaked_column_count <> 0
    OR required_raw_text_column_count <> 2
    OR private_client_grant_count <> 0
  THEN
    RAISE EXCEPTION 'PUBLIC_DISCLOSURE_EVIDENCE_PRIVACY_POSTCONDITION_FAILED'
      USING ERRCODE = '55000';
  END IF;
END
$public_disclosure_evidence_privacy_postconditions$;

COMMENT ON VIEW public.v_public_official_prices IS
  'Consumer price facts with bounded source labels; source quotes are private.';
COMMENT ON VIEW public.v_public_official_price_options IS
  'Consumer option facts with approved, privacy-fenced short raw text.';
COMMENT ON VIEW public.v_private_admin_official_prices IS
  'Service-role-only evidence projection for authenticated admin/internal APIs.';

COMMIT;
