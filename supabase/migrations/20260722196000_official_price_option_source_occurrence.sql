-- Preserve every disclosure option occurrence without weakening the legacy
-- admin/manual option identity contract. Disclosure rows receive a private,
-- deterministic occurrence key; ordinary rows retain the historical
-- (parent, name, unit, condition) uniqueness fence.

ALTER TABLE public.official_price_options
  ADD COLUMN IF NOT EXISTS source_occurrence_key text;

DO $official_price_option_source_occurrence_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.official_price_options'::regclass
      AND conname = 'official_price_options_source_occurrence_key_check'
  ) THEN
    ALTER TABLE public.official_price_options
      ADD CONSTRAINT official_price_options_source_occurrence_key_check
      CHECK (
        source_occurrence_key IS NULL
        OR source_occurrence_key ~ '^[0-9a-f]{64}:[0-9]+$'
      ) NOT VALID;
  END IF;
END
$official_price_option_source_occurrence_constraint$;

ALTER TABLE public.official_price_options
  VALIDATE CONSTRAINT official_price_options_source_occurrence_key_check;

DROP INDEX IF EXISTS public.idx_official_price_options_identity_unique;
CREATE UNIQUE INDEX idx_official_price_options_identity_unique
  ON public.official_price_options (
    official_price_id,
    name,
    COALESCE(unit, ''),
    COALESCE(condition, '')
  )
  WHERE source_occurrence_key IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_official_price_options_source_occurrence_unique
  ON public.official_price_options (official_price_id, source_occurrence_key)
  WHERE source_occurrence_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.assign_official_price_option_source_occurrence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, extensions, pg_temp
AS $assign_official_price_option_source_occurrence$
DECLARE
  atomic_run_sha256 text;
  parent_source_record_key text;
  parent_confidence numeric;
  canonical_source_object_keys jsonb;
  occurrence_base_sha256 text;
  occurrence_duplicate_rank bigint;
  next_sort_order_bigint bigint;
  stage_function_owner name;
  stage_call_context text;
BEGIN
  atomic_run_sha256 := NULLIF(btrim(current_setting(
    'app.vendor_disclosure_atomic_run_sha256',
    true
  )), '');

  IF NEW.source_occurrence_key IS NOT NULL THEN
    RAISE EXCEPTION 'OFFICIAL_PRICE_OPTION_SOURCE_OCCURRENCE_SERVER_DERIVED'
      USING ERRCODE = '22023';
  END IF;

  -- Admin upload and manual review rows keep the legacy nullable-key identity.
  IF atomic_run_sha256 IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT pg_catalog.pg_get_userbyid(function_row.proowner)
  INTO stage_function_owner
  FROM pg_catalog.pg_proc AS function_row
  WHERE function_row.oid = pg_catalog.to_regprocedure(
    'public.stage_vendor_disclosure_batch_atomic(text,text,text,text,text,integer,integer,text,text,text,text,text[],jsonb,jsonb)'
  );
  GET DIAGNOSTICS stage_call_context = PG_CONTEXT;

  -- A caller-set GUC is never authority. Only the exact postgres-owned stage
  -- RPC call stack may create disclosure occurrence identities.
  IF stage_function_owner IS NULL
    OR current_user <> stage_function_owner
    OR atomic_run_sha256 !~ '^[0-9a-f]{64}$'
    OR NOT (
      position(E'\nPL/pgSQL function stage_vendor_disclosure_batch_atomic(text,text,text,text,text,integer,integer,text,text,text,text,text[],jsonb,jsonb) '
        IN stage_call_context) > 0
      OR position(E'\nPL/pgSQL function public.stage_vendor_disclosure_batch_atomic(text,text,text,text,text,integer,integer,text,text,text,text,text[],jsonb,jsonb) '
        IN stage_call_context) > 0
    )
  THEN
    RETURN NEW;
  END IF;

  SELECT price.source_record_key, price.confidence
  INTO parent_source_record_key, parent_confidence
  FROM public.official_prices AS price
  JOIN public.vendor_disclosure_ingest_owned_rows AS owned
    ON owned.row_kind = 'official_price'
    AND owned.row_id = price.id
    AND owned.run_sha256 = atomic_run_sha256
  JOIN public.vendor_disclosure_ingest_runs AS run
    ON run.run_sha256 = owned.run_sha256
    AND run.status = 'active'
    AND run.snapshot_id = price.snapshot_id
  WHERE price.id = NEW.official_price_id;

  IF NOT FOUND OR NULLIF(btrim(parent_source_record_key), '') IS NULL THEN
    RAISE EXCEPTION 'OFFICIAL_PRICE_OPTION_ACTIVE_OWNED_PARENT_REQUIRED'
      USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(jsonb_agg(source_key ORDER BY source_key), '[]'::jsonb)
  INTO canonical_source_object_keys
  FROM (
    SELECT DISTINCT source_value.source_key
    FROM unnest(NEW.source_object_keys) AS source_value(source_key)
    WHERE source_value.source_key IS NOT NULL
  ) AS normalized_source_keys;

  occurrence_base_sha256 := encode(extensions.digest(convert_to(
    jsonb_build_object(
      'namespace', 'vendor_disclosure_option_occurrence_v1',
      'parent_source_record_key', parent_source_record_key,
      'name', NEW.name,
      'price_min_krw', NEW.price_min_krw,
      'price_max_krw', NEW.price_max_krw,
      'unit', NEW.unit,
      'condition', NEW.condition,
      'raw_text', NEW.raw_text,
      'source_quote', NEW.source_quote,
      'source_object_keys', canonical_source_object_keys
    )::text,
    'UTF8'
  ), 'sha256'), 'hex');

  SELECT count(*)::bigint
  INTO occurrence_duplicate_rank
  FROM public.official_price_options AS existing_option
  WHERE existing_option.official_price_id = NEW.official_price_id
    AND left(existing_option.source_occurrence_key, 65)
      = occurrence_base_sha256 || ':';

  SELECT COALESCE(max(existing_option.sort_order)::bigint + 1, 0)
  INTO next_sort_order_bigint
  FROM public.official_price_options AS existing_option
  WHERE existing_option.official_price_id = NEW.official_price_id;

  IF next_sort_order_bigint > 2147483647 THEN
    RAISE EXCEPTION 'OFFICIAL_PRICE_OPTION_SORT_ORDER_OVERFLOW'
      USING ERRCODE = '22003';
  END IF;

  NEW.source_occurrence_key := occurrence_base_sha256
    || ':' || occurrence_duplicate_rank::text;
  NEW.sort_order := next_sort_order_bigint::integer;
  NEW.confidence := parent_confidence;
  RETURN NEW;
END
$assign_official_price_option_source_occurrence$;

ALTER FUNCTION public.assign_official_price_option_source_occurrence()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.assign_official_price_option_source_occurrence()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guard_official_price_option_source_occurrence_key()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $guard_official_price_option_source_occurrence_key$
BEGIN
  IF OLD.source_occurrence_key IS DISTINCT FROM NEW.source_occurrence_key THEN
    RAISE EXCEPTION 'OFFICIAL_PRICE_OPTION_SOURCE_OCCURRENCE_IMMUTABLE'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$guard_official_price_option_source_occurrence_key$;

ALTER FUNCTION public.guard_official_price_option_source_occurrence_key()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_official_price_option_source_occurrence_key()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS official_price_options_10_source_occurrence
  ON public.official_price_options;
CREATE TRIGGER official_price_options_10_source_occurrence
BEFORE INSERT ON public.official_price_options
FOR EACH ROW
EXECUTE FUNCTION public.assign_official_price_option_source_occurrence();

DROP TRIGGER IF EXISTS official_price_options_20_source_occurrence_immutable
  ON public.official_price_options;
CREATE TRIGGER official_price_options_20_source_occurrence_immutable
BEFORE UPDATE OF source_occurrence_key ON public.official_price_options
FOR EACH ROW
EXECUTE FUNCTION public.guard_official_price_option_source_occurrence_key();

-- Option confidence is absent from the immutable extraction payload schema.
-- The trigger derives it from the already-hashed parent row, so the persisted
-- replay projection deliberately masks this server-only derivative as JSON
-- null. This preserves every existing run/payload/unit hash and paid
-- attestation while the stored value remains available to review gates.
CREATE OR REPLACE FUNCTION public.vendor_disclosure_persisted_unit_payload_sha256(
  p_run_sha256 text,
  p_unit_id text
)
RETURNS text
LANGUAGE sql
STABLE
STRICT
SET search_path = pg_catalog, public, extensions
AS $vendor_disclosure_persisted_unit_payload_sha256$
  SELECT encode(extensions.digest(convert_to(jsonb_build_object(
    'agency_packages', COALESCE((
      SELECT jsonb_agg(projected.entry ORDER BY projected.entry::text)
      FROM (
        SELECT jsonb_build_object(
          'record_ref', binding.record_ref,
          'package_name', package.package_name,
          'category_scope', package.category_scope,
          'price_min_krw', package.price_min_krw,
          'price_max_krw', package.price_max_krw,
          'vat_note', package.vat_note,
          'price_note', package.price_note,
          'options', package.options,
          'review_status', package.review_status,
          'needs_review', package.needs_review,
          'validation_issue_codes', package.validation_issue_codes,
          'source_file', package.source_file,
          'source_object_keys', package.source_object_keys,
          'source_preview_keys', package.source_preview_keys,
          'source_quote', package.source_quote,
          'confidence', package.confidence
        ) AS entry
        FROM public.vendor_disclosure_ingest_owned_rows AS owned
        JOIN public.official_agency_packages AS package
          ON owned.row_kind = 'agency_package' AND package.id = owned.row_id
        JOIN public.vendor_disclosure_ingest_record_bindings AS binding
          ON binding.run_sha256 = owned.run_sha256
          AND binding.unit_id = owned.unit_id
          AND binding.row_kind = owned.row_kind
          AND binding.row_id = owned.row_id
        WHERE owned.run_sha256 = p_run_sha256 AND owned.unit_id = p_unit_id
      ) AS projected
    ), '[]'::jsonb),
    'official_prices', COALESCE((
      SELECT jsonb_agg(projected.entry ORDER BY projected.entry::text)
      FROM (
        SELECT jsonb_build_object(
          'record_ref', binding.record_ref,
          'category', price.category,
          'item_name', price.item_name,
          'base_spec', price.base_spec,
          'price_min_krw', price.price_min_krw,
          'price_max_krw', price.price_max_krw,
          'vat_note', price.vat_note,
          'price_note', price.price_note,
          'options', COALESCE((
            SELECT jsonb_agg(option_projected.entry ORDER BY option_projected.entry::text)
            FROM (
              SELECT jsonb_build_object(
                'name', option_row.name,
                'price_min_krw', option_row.price_min_krw,
                'price_max_krw', option_row.price_max_krw,
                'unit', option_row.unit,
                'condition', option_row.condition,
                'raw_text', option_row.raw_text,
                'source_file', option_row.source_file,
                'source_quote', option_row.source_quote,
                'source_object_keys', option_row.source_object_keys,
                'confidence', NULL
              ) AS entry
              FROM public.official_price_options AS option_row
              WHERE option_row.official_price_id = price.id
            ) AS option_projected
          ), '[]'::jsonb),
          'review_status', price.review_status,
          'needs_review', price.needs_review,
          'validation_issue_codes', price.validation_issue_codes,
          'source_file', price.source_file,
          'source_object_keys', price.source_object_keys,
          'source_preview_keys', price.source_preview_keys,
          'source_quote', price.source_quote,
          'confidence', price.confidence,
          'source_record_key', price.source_record_key
        ) AS entry
        FROM public.vendor_disclosure_ingest_owned_rows AS owned
        JOIN public.official_prices AS price
          ON owned.row_kind = 'official_price' AND price.id = owned.row_id
        JOIN public.vendor_disclosure_ingest_record_bindings AS binding
          ON binding.run_sha256 = owned.run_sha256
          AND binding.unit_id = owned.unit_id
          AND binding.row_kind = owned.row_kind
          AND binding.row_id = owned.row_id
        WHERE owned.run_sha256 = p_run_sha256 AND owned.unit_id = p_unit_id
      ) AS projected
    ), '[]'::jsonb),
    'disclosure_semantics', COALESCE((
      SELECT jsonb_agg(projected.entry ORDER BY projected.entry::text)
      FROM (
        SELECT jsonb_build_object(
          'record_ref', binding.record_ref,
          'schema_version', semantic.schema_version,
          'record_kind', semantic.record_kind,
          'semantic_type', semantic.semantic_type,
          'subject_kind', semantic.subject_kind,
          'subject_name', semantic.subject_name,
          'subject_normalized_name', semantic.subject_normalized_name,
          'vendor_category', semantic.vendor_category,
          'region_code', semantic.region_code,
          'title', semantic.title,
          'content_verbatim', semantic.content_verbatim,
          'summary', semantic.summary,
          'partner_record_ref', semantic.partner_record_ref,
          'source_agency', semantic.source_agency,
          'partner_link_status', semantic.partner_link_status,
          'review_status', semantic.review_status,
          'needs_review', semantic.needs_review,
          'validation_issue_codes', semantic.validation_issue_codes,
          'source_file_ids', semantic.source_file_ids,
          'source_file', semantic.source_file,
          'source_object_keys', semantic.source_object_keys,
          'source_preview_keys', semantic.source_preview_keys,
          'source_quote', semantic.source_quote,
          'source_fingerprint', semantic.source_fingerprint,
          'validation_fingerprint', semantic.validation_fingerprint,
          'confidence', semantic.confidence,
          'source_record_key', semantic.source_record_key,
          'content_fingerprint', semantic.content_fingerprint
        ) AS entry
        FROM public.vendor_disclosure_ingest_owned_rows AS owned
        JOIN public.disclosure_semantic_staging AS semantic
          ON owned.row_kind = 'semantic' AND semantic.id = owned.row_id
        JOIN public.vendor_disclosure_ingest_record_bindings AS binding
          ON binding.run_sha256 = owned.run_sha256
          AND binding.unit_id = owned.unit_id
          AND binding.row_kind = owned.row_kind
          AND binding.row_id = owned.row_id
        WHERE owned.run_sha256 = p_run_sha256 AND owned.unit_id = p_unit_id
      ) AS projected
    ), '[]'::jsonb)
  )::text, 'UTF8'), 'sha256'), 'hex');
$vendor_disclosure_persisted_unit_payload_sha256$;

ALTER FUNCTION public.vendor_disclosure_persisted_unit_payload_sha256(text, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.vendor_disclosure_persisted_unit_payload_sha256(text, text)
  FROM PUBLIC, anon, authenticated, service_role;

DO $official_price_option_source_occurrence_postcondition$
DECLARE
  legacy_index_predicate text;
  occurrence_index_predicate text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.official_price_options'::regclass
      AND constraint_row.conname = 'official_price_options_source_occurrence_key_check'
      AND constraint_row.convalidated
  ) THEN
    RAISE EXCEPTION 'OFFICIAL_PRICE_OPTION_SOURCE_OCCURRENCE_CONSTRAINT_INVALID';
  END IF;

  SELECT pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid)
  INTO legacy_index_predicate
  FROM pg_catalog.pg_index AS index_row
  JOIN pg_catalog.pg_class AS index_class ON index_class.oid = index_row.indexrelid
  WHERE index_class.oid = 'public.idx_official_price_options_identity_unique'::regclass
    AND index_row.indisunique;

  IF legacy_index_predicate IS NULL
    OR position('source_occurrence_key IS NULL' IN legacy_index_predicate) = 0
  THEN
    RAISE EXCEPTION 'OFFICIAL_PRICE_OPTION_LEGACY_IDENTITY_FENCE_MISSING';
  END IF;

  SELECT pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid)
  INTO occurrence_index_predicate
  FROM pg_catalog.pg_index AS index_row
  JOIN pg_catalog.pg_class AS index_class ON index_class.oid = index_row.indexrelid
  WHERE index_class.oid = 'public.idx_official_price_options_source_occurrence_unique'::regclass
    AND index_row.indisunique;

  IF occurrence_index_predicate IS NULL
    OR position('source_occurrence_key IS NOT NULL' IN occurrence_index_predicate) = 0
  THEN
    RAISE EXCEPTION 'OFFICIAL_PRICE_OPTION_SOURCE_OCCURRENCE_FENCE_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.official_price_options'::regclass
      AND trigger_row.tgname = 'official_price_options_10_source_occurrence'
      AND trigger_row.tgenabled = 'O'
      AND NOT trigger_row.tgisinternal
  ) THEN
    RAISE EXCEPTION 'OFFICIAL_PRICE_OPTION_SOURCE_OCCURRENCE_TRIGGER_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.official_price_options'::regclass
      AND trigger_row.tgname = 'official_price_options_20_source_occurrence_immutable'
      AND trigger_row.tgenabled = 'O'
      AND NOT trigger_row.tgisinternal
  ) THEN
    RAISE EXCEPTION 'OFFICIAL_PRICE_OPTION_SOURCE_OCCURRENCE_IMMUTABILITY_MISSING';
  END IF;

  IF pg_catalog.pg_get_userbyid(
    (
      SELECT function_row.proowner
      FROM pg_catalog.pg_proc AS function_row
      WHERE function_row.oid = pg_catalog.to_regprocedure(
        'public.assign_official_price_option_source_occurrence()'
      )
    )
  ) <> 'postgres' THEN
    RAISE EXCEPTION 'OFFICIAL_PRICE_OPTION_SOURCE_OCCURRENCE_OWNER_INVALID';
  END IF;

  IF pg_catalog.pg_get_userbyid(
    (
      SELECT function_row.proowner
      FROM pg_catalog.pg_proc AS function_row
      WHERE function_row.oid = pg_catalog.to_regprocedure(
        'public.guard_official_price_option_source_occurrence_key()'
      )
    )
  ) <> 'postgres' THEN
    RAISE EXCEPTION 'OFFICIAL_PRICE_OPTION_SOURCE_OCCURRENCE_GUARD_OWNER_INVALID';
  END IF;

  IF has_function_privilege(
      'anon',
      'public.assign_official_price_option_source_occurrence()',
      'EXECUTE'
    )
    OR has_function_privilege(
      'authenticated',
      'public.assign_official_price_option_source_occurrence()',
      'EXECUTE'
    )
    OR has_function_privilege(
      'service_role',
      'public.assign_official_price_option_source_occurrence()',
      'EXECUTE'
    )
    OR has_function_privilege(
      'anon',
      'public.guard_official_price_option_source_occurrence_key()',
      'EXECUTE'
    )
    OR has_function_privilege(
      'authenticated',
      'public.guard_official_price_option_source_occurrence_key()',
      'EXECUTE'
    )
    OR has_function_privilege(
      'service_role',
      'public.guard_official_price_option_source_occurrence_key()',
      'EXECUTE'
    )
  THEN
    RAISE EXCEPTION 'OFFICIAL_PRICE_OPTION_SOURCE_OCCURRENCE_ACL_INVALID';
  END IF;
END
$official_price_option_source_occurrence_postcondition$;

COMMENT ON COLUMN public.official_price_options.source_occurrence_key IS
  'Private deterministic key for one source disclosure occurrence. NULL preserves legacy admin/manual identity semantics.';
