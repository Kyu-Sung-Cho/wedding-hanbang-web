-- Close contracts that only become visible after the disclosure foundation,
-- consumer persistence, CAS review, and publication immutability migrations
-- coexist. This migration performs no production-only data import.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ALTER COLUMN TYPE is intentionally blocked by PostgreSQL when a view or an
-- UPDATE OF trigger depends on that column. Preserve the three consumer view
-- definitions before removing those dependencies. A missing view/trigger means
-- the required migration order was not applied, so fail instead of silently
-- creating a partial public-price contract.
CREATE TEMPORARY TABLE price_snapshot_published_at_view_backup (
  view_name name PRIMARY KEY,
  view_definition text NOT NULL
) ON COMMIT DROP;

INSERT INTO price_snapshot_published_at_view_backup (
  view_name,
  view_definition
)
SELECT
  relation.relname,
  pg_catalog.pg_get_viewdef(relation.oid, true)
FROM pg_catalog.pg_class AS relation
JOIN pg_catalog.pg_namespace AS namespace
  ON namespace.oid = relation.relnamespace
WHERE namespace.nspname = 'public'
  AND relation.relkind = 'v'
  AND relation.relname IN (
    'v_public_official_prices',
    'v_public_agency_packages',
    'v_public_prices'
  );

DO $price_snapshot_published_at_dependencies$
DECLARE
  captured_view_count integer;
  publication_trigger_function regprocedure;
BEGIN
  SELECT count(*)::integer
  INTO captured_view_count
  FROM price_snapshot_published_at_view_backup;

  IF captured_view_count <> 3 THEN
    RAISE EXCEPTION
      'PRICE_SNAPSHOT_PUBLISHED_AT_REQUIRED_VIEWS_MISSING: expected 3, found %',
      captured_view_count
      USING ERRCODE = '55000';
  END IF;

  SELECT trigger_row.tgfoid::regprocedure
  INTO publication_trigger_function
  FROM pg_catalog.pg_trigger AS trigger_row
  WHERE trigger_row.tgrelid = 'public.price_snapshots'::regclass
    AND trigger_row.tgname = 'price_snapshot_publication_write_fence'
    AND trigger_row.tgisinternal IS FALSE;

  IF publication_trigger_function IS DISTINCT FROM
    'public.guard_price_snapshot_publication_write()'::regprocedure
  THEN
    RAISE EXCEPTION
      'PRICE_SNAPSHOT_PUBLICATION_WRITE_FENCE_MISSING_OR_UNEXPECTED'
      USING ERRCODE = '55000';
  END IF;
END
$price_snapshot_published_at_dependencies$;

DROP TRIGGER price_snapshot_publication_write_fence
  ON public.price_snapshots;

DROP VIEW
  public.v_public_official_prices,
  public.v_public_agency_packages,
  public.v_public_prices;

-- A legacy publication date meant a UTC calendar date. Preserve that exact
-- meaning at midnight UTC; never reinterpret an already-zoned timestamp.
DO $price_snapshot_published_at_type$
DECLARE
  current_data_type text;
  current_default text;
BEGIN
  SELECT column_row.data_type, column_row.column_default
  INTO current_data_type, current_default
  FROM information_schema.columns AS column_row
  WHERE column_row.table_schema = 'public'
    AND column_row.table_name = 'price_snapshots'
    AND column_row.column_name = 'published_at';

  IF current_data_type IS NULL THEN
    RAISE EXCEPTION 'PRICE_SNAPSHOT_PUBLISHED_AT_COLUMN_MISSING'
      USING ERRCODE = '55000';
  END IF;
  IF current_default IS NOT NULL THEN
    RAISE EXCEPTION 'PRICE_SNAPSHOT_PUBLISHED_AT_UNEXPECTED_DEFAULT'
      USING ERRCODE = '55000';
  END IF;

  IF current_data_type = 'date' THEN
    EXECUTE $convert_date$
      ALTER TABLE public.price_snapshots
        ALTER COLUMN published_at TYPE timestamptz
        USING (published_at::timestamp AT TIME ZONE 'UTC')
    $convert_date$;
  ELSIF current_data_type = 'timestamp without time zone' THEN
    EXECUTE $convert_timestamp$
      ALTER TABLE public.price_snapshots
        ALTER COLUMN published_at TYPE timestamptz
        USING (published_at AT TIME ZONE 'UTC')
    $convert_timestamp$;
  ELSIF current_data_type <> 'timestamp with time zone' THEN
    RAISE EXCEPTION 'PRICE_SNAPSHOT_PUBLISHED_AT_UNSUPPORTED_TYPE: %',
      current_data_type
      USING ERRCODE = '55000';
  END IF;
END
$price_snapshot_published_at_type$;

DO $restore_price_snapshot_published_at_views$
DECLARE
  view_row record;
BEGIN
  FOR view_row IN
    SELECT backup.view_name, backup.view_definition
    FROM price_snapshot_published_at_view_backup AS backup
    ORDER BY backup.view_name
  LOOP
    EXECUTE pg_catalog.format(
      'CREATE VIEW public.%I WITH (security_barrier = true, security_invoker = false) AS %s',
      view_row.view_name,
      view_row.view_definition
    );
    EXECUTE pg_catalog.format(
      'ALTER VIEW public.%I OWNER TO postgres',
      view_row.view_name
    );
    EXECUTE pg_catalog.format(
      'REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role',
      view_row.view_name
    );
    EXECUTE pg_catalog.format(
      'GRANT SELECT ON TABLE public.%I TO anon, authenticated, service_role',
      view_row.view_name
    );
  END LOOP;
END
$restore_price_snapshot_published_at_views$;

CREATE TRIGGER price_snapshot_publication_write_fence
BEFORE INSERT OR UPDATE OF published, published_at
ON public.price_snapshots
FOR EACH ROW
EXECUTE FUNCTION public.guard_price_snapshot_publication_write();

DO $price_snapshot_published_at_postconditions$
DECLARE
  current_data_type text;
  restored_view_count integer;
BEGIN
  SELECT column_row.data_type
  INTO current_data_type
  FROM information_schema.columns AS column_row
  WHERE column_row.table_schema = 'public'
    AND column_row.table_name = 'price_snapshots'
    AND column_row.column_name = 'published_at';

  SELECT count(*)::integer
  INTO restored_view_count
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relkind = 'v'
    AND relation.relname IN (
      'v_public_official_prices',
      'v_public_agency_packages',
      'v_public_prices'
    );

  IF current_data_type <> 'timestamp with time zone'
    OR restored_view_count <> 3
    OR NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_row
      WHERE trigger_row.tgrelid = 'public.price_snapshots'::regclass
        AND trigger_row.tgname = 'price_snapshot_publication_write_fence'
        AND trigger_row.tgisinternal IS FALSE
    )
  THEN
    RAISE EXCEPTION 'PRICE_SNAPSHOT_PUBLISHED_AT_MIGRATION_POSTCONDITION_FAILED'
      USING ERRCODE = '55000';
  END IF;
END
$price_snapshot_published_at_postconditions$;

CREATE OR REPLACE FUNCTION public.mark_price_snapshot_published()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $mark_price_snapshot_published$
BEGIN
  IF NEW.is_current IS TRUE
    AND (
      TG_OP = 'INSERT'
      OR OLD.is_current IS DISTINCT FROM TRUE
    )
  THEN
    NEW.published := true;
    NEW.published_at := COALESCE(NEW.published_at, now());
  END IF;
  RETURN NEW;
END
$mark_price_snapshot_published$;

ALTER FUNCTION public.mark_price_snapshot_published() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.mark_price_snapshot_published()
  FROM PUBLIC, anon, authenticated, service_role;

-- Vendor merge lineage is explicit. Raw analytics rows retain their original
-- foreign key forever; read models resolve this lineage instead.
ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS merged_into_vendor_id uuid;

DO $vendor_merge_lineage_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.vendors'::regclass
      AND conname = 'vendors_merged_into_vendor_id_fkey'
  ) THEN
    ALTER TABLE public.vendors
      ADD CONSTRAINT vendors_merged_into_vendor_id_fkey
      FOREIGN KEY (merged_into_vendor_id)
      REFERENCES public.vendors(id)
      ON DELETE RESTRICT
      NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.vendors'::regclass
      AND conname = 'vendors_merged_into_vendor_not_self_check'
  ) THEN
    ALTER TABLE public.vendors
      ADD CONSTRAINT vendors_merged_into_vendor_not_self_check
      CHECK (
        merged_into_vendor_id IS NULL
        OR merged_into_vendor_id <> id
      ) NOT VALID;
  END IF;
END
$vendor_merge_lineage_constraints$;

-- Recover lineage from already-decided candidates, but refuse ambiguous audit
-- history instead of choosing a winner nondeterministically.
DO $vendor_merge_lineage_backfill$
DECLARE
  ambiguous_vendor_id uuid;
  conflicting_vendor_id uuid;
BEGIN
  WITH candidate_mappings AS (
    SELECT
      CASE
        WHEN candidate.left_vendor_id = candidate.preserved_vendor_id
          THEN candidate.right_vendor_id
        ELSE candidate.left_vendor_id
      END AS losing_vendor_id,
      candidate.preserved_vendor_id
    FROM public.vendor_dedupe_candidates AS candidate
    WHERE candidate.status = 'same'
      AND candidate.preserved_vendor_id IS NOT NULL
  )
  SELECT mapping.losing_vendor_id
  INTO ambiguous_vendor_id
  FROM candidate_mappings AS mapping
  GROUP BY mapping.losing_vendor_id
  HAVING count(DISTINCT mapping.preserved_vendor_id) <> 1
  LIMIT 1;

  IF ambiguous_vendor_id IS NOT NULL THEN
    RAISE EXCEPTION 'VENDOR_MERGE_LINEAGE_AMBIGUOUS: %',
      ambiguous_vendor_id
      USING ERRCODE = '55000';
  END IF;

  WITH candidate_mappings AS (
    SELECT DISTINCT
      CASE
        WHEN candidate.left_vendor_id = candidate.preserved_vendor_id
          THEN candidate.right_vendor_id
        ELSE candidate.left_vendor_id
      END AS losing_vendor_id,
      candidate.preserved_vendor_id
    FROM public.vendor_dedupe_candidates AS candidate
    WHERE candidate.status = 'same'
      AND candidate.preserved_vendor_id IS NOT NULL
  )
  SELECT vendor.id
  INTO conflicting_vendor_id
  FROM public.vendors AS vendor
  JOIN candidate_mappings AS mapping
    ON mapping.losing_vendor_id = vendor.id
  WHERE vendor.merged_into_vendor_id IS NOT NULL
    AND vendor.merged_into_vendor_id IS DISTINCT FROM mapping.preserved_vendor_id
  LIMIT 1;

  IF conflicting_vendor_id IS NOT NULL THEN
    RAISE EXCEPTION 'VENDOR_MERGE_LINEAGE_CONFLICT: %',
      conflicting_vendor_id
      USING ERRCODE = '55000';
  END IF;

  WITH candidate_mappings AS (
    SELECT DISTINCT
      CASE
        WHEN candidate.left_vendor_id = candidate.preserved_vendor_id
          THEN candidate.right_vendor_id
        ELSE candidate.left_vendor_id
      END AS losing_vendor_id,
      candidate.preserved_vendor_id
    FROM public.vendor_dedupe_candidates AS candidate
    WHERE candidate.status = 'same'
      AND candidate.preserved_vendor_id IS NOT NULL
  )
  UPDATE public.vendors AS vendor
  SET merged_into_vendor_id = mapping.preserved_vendor_id
  FROM candidate_mappings AS mapping
  WHERE vendor.id = mapping.losing_vendor_id
    AND vendor.merged_into_vendor_id IS NULL;
END
$vendor_merge_lineage_backfill$;

ALTER TABLE public.vendors
  VALIDATE CONSTRAINT vendors_merged_into_vendor_id_fkey;
ALTER TABLE public.vendors
  VALIDATE CONSTRAINT vendors_merged_into_vendor_not_self_check;

CREATE INDEX IF NOT EXISTS vendors_merged_into_vendor_idx
  ON public.vendors (merged_into_vendor_id)
  WHERE merged_into_vendor_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.canonical_price_vendor_id(p_vendor_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $canonical_price_vendor_id$
DECLARE
  current_id uuid := p_vendor_id;
  next_id uuid;
  seen_ids uuid[] := '{}'::uuid[];
BEGIN
  IF current_id IS NULL THEN
    RETURN NULL;
  END IF;

  FOR hop IN 1..100 LOOP
    IF current_id = ANY(seen_ids) THEN
      RAISE EXCEPTION 'VENDOR_MERGE_LINEAGE_CYCLE'
        USING ERRCODE = '55000';
    END IF;
    seen_ids := array_append(seen_ids, current_id);

    SELECT vendor.merged_into_vendor_id
    INTO next_id
    FROM public.vendors AS vendor
    WHERE vendor.id = current_id;

    IF NOT FOUND OR next_id IS NULL THEN
      RETURN current_id;
    END IF;
    current_id := next_id;
  END LOOP;

  RAISE EXCEPTION 'VENDOR_MERGE_LINEAGE_DEPTH_EXCEEDED'
    USING ERRCODE = '54001';
END
$canonical_price_vendor_id$;

CREATE OR REPLACE FUNCTION public.canonical_price_agency_id(p_agency_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $canonical_price_agency_id$
DECLARE
  current_id uuid := p_agency_id;
  next_id uuid;
  seen_ids uuid[] := '{}'::uuid[];
BEGIN
  IF current_id IS NULL THEN
    RETURN NULL;
  END IF;

  FOR hop IN 1..100 LOOP
    IF current_id = ANY(seen_ids) THEN
      RAISE EXCEPTION 'AGENCY_MERGE_LINEAGE_CYCLE'
        USING ERRCODE = '55000';
    END IF;
    seen_ids := array_append(seen_ids, current_id);

    SELECT agency.merged_into_agency_id
    INTO next_id
    FROM public.agencies AS agency
    WHERE agency.id = current_id;

    IF NOT FOUND OR next_id IS NULL THEN
      RETURN current_id;
    END IF;
    current_id := next_id;
  END LOOP;

  RAISE EXCEPTION 'AGENCY_MERGE_LINEAGE_DEPTH_EXCEEDED'
    USING ERRCODE = '54001';
END
$canonical_price_agency_id$;

ALTER FUNCTION public.canonical_price_vendor_id(uuid) OWNER TO postgres;
ALTER FUNCTION public.canonical_price_agency_id(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.canonical_price_vendor_id(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.canonical_price_agency_id(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.canonical_price_vendor_id(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.canonical_price_agency_id(uuid)
  TO service_role;

DO $merge_lineage_postcondition$
DECLARE
  lineage_row record;
BEGIN
  FOR lineage_row IN
    SELECT vendor.id FROM public.vendors AS vendor
    WHERE vendor.merged_into_vendor_id IS NOT NULL
  LOOP
    PERFORM public.canonical_price_vendor_id(lineage_row.id);
  END LOOP;
  FOR lineage_row IN
    SELECT agency.id FROM public.agencies AS agency
    WHERE agency.merged_into_agency_id IS NOT NULL
  LOOP
    PERFORM public.canonical_price_agency_id(lineage_row.id);
  END LOOP;
END
$merge_lineage_postcondition$;

-- "Active" is part of canonical agency identity, not merely a presentation
-- filter. Keep every existing and future agency-reference trigger on the same
-- row lock and reject both inactive and merged tombstones.
CREATE OR REPLACE FUNCTION public.enforce_active_agency_reference()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $enforce_active_agency_reference$
DECLARE
  target_is_active boolean;
  target_merged_into_agency_id uuid;
BEGIN
  IF NEW.agency_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT agency.is_active, agency.merged_into_agency_id
  INTO target_is_active, target_merged_into_agency_id
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
  IF target_is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'AGENCY_REFERENCE_INACTIVE'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$enforce_active_agency_reference$;

ALTER FUNCTION public.enforce_active_agency_reference() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enforce_active_agency_reference()
  FROM PUBLIC, anon, authenticated, service_role;

-- Rewrite only identity-valued object members, including any future nested
-- selection shape. Display strings and unrelated UUID-valued keys are untouched.
CREATE OR REPLACE FUNCTION public.rewrite_price_combo_identity(
  p_document jsonb,
  p_identity_key text,
  p_from_id uuid,
  p_to_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $rewrite_price_combo_identity$
DECLARE
  result jsonb;
BEGIN
  IF p_document IS NULL OR p_from_id IS NULL OR p_to_id IS NULL THEN
    RETURN p_document;
  END IF;

  IF jsonb_typeof(p_document) = 'object' THEN
    SELECT COALESCE(
      jsonb_object_agg(
        entry.key,
        CASE
          WHEN entry.key = p_identity_key
            AND jsonb_typeof(entry.value) = 'string'
            AND entry.value #>> '{}' = p_from_id::text
            THEN to_jsonb(p_to_id::text)
          ELSE public.rewrite_price_combo_identity(
            entry.value, p_identity_key, p_from_id, p_to_id
          )
        END
      ),
      '{}'::jsonb
    )
    INTO result
    FROM jsonb_each(p_document) AS entry;
    RETURN result;
  END IF;

  IF jsonb_typeof(p_document) = 'array' THEN
    SELECT COALESCE(
      jsonb_agg(
        public.rewrite_price_combo_identity(
          entry.value, p_identity_key, p_from_id, p_to_id
        )
        ORDER BY entry.ordinality
      ),
      '[]'::jsonb
    )
    INTO result
    FROM jsonb_array_elements(p_document)
      WITH ORDINALITY AS entry(value, ordinality);
    RETURN result;
  END IF;

  RETURN p_document;
END
$rewrite_price_combo_identity$;

CREATE OR REPLACE FUNCTION public.price_combo_contains_identity(
  p_document jsonb,
  p_identity_key text,
  p_identity_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $price_combo_contains_identity$
DECLARE
  entry record;
BEGIN
  IF p_document IS NULL OR p_identity_id IS NULL THEN
    RETURN false;
  END IF;

  IF jsonb_typeof(p_document) = 'object' THEN
    FOR entry IN SELECT * FROM jsonb_each(p_document)
    LOOP
      IF entry.key = p_identity_key
        AND jsonb_typeof(entry.value) = 'string'
        AND entry.value #>> '{}' = p_identity_id::text
      THEN
        RETURN true;
      END IF;
      IF public.price_combo_contains_identity(
        entry.value, p_identity_key, p_identity_id
      ) THEN
        RETURN true;
      END IF;
    END LOOP;
  ELSIF jsonb_typeof(p_document) = 'array' THEN
    FOR entry IN SELECT value FROM jsonb_array_elements(p_document)
    LOOP
      IF public.price_combo_contains_identity(
        entry.value, p_identity_key, p_identity_id
      ) THEN
        RETURN true;
      END IF;
    END LOOP;
  END IF;

  RETURN false;
END
$price_combo_contains_identity$;

ALTER FUNCTION public.rewrite_price_combo_identity(jsonb, text, uuid, uuid)
  OWNER TO postgres;
ALTER FUNCTION public.price_combo_contains_identity(jsonb, text, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.rewrite_price_combo_identity(
  jsonb, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.price_combo_contains_identity(jsonb, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.merge_price_consumer_vendor_references(
  p_losing_vendor_id uuid,
  p_preserved_vendor_id uuid
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $merge_price_consumer_vendor_references$
DECLARE
  favorite_row record;
  locked_vendor_count integer;
BEGIN
  IF p_losing_vendor_id IS NULL
    OR p_preserved_vendor_id IS NULL
    OR p_losing_vendor_id = p_preserved_vendor_id
  THEN
    RAISE EXCEPTION 'PRICE_CONSUMER_VENDOR_MERGE_IDS_INVALID'
      USING ERRCODE = '22023';
  END IF;

  PERFORM vendor.id
  FROM public.vendors AS vendor
  WHERE vendor.id IN (p_losing_vendor_id, p_preserved_vendor_id)
  ORDER BY vendor.id
  FOR UPDATE;

  GET DIAGNOSTICS locked_vendor_count = ROW_COUNT;
  IF locked_vendor_count <> 2 THEN
    RAISE EXCEPTION 'PRICE_CONSUMER_VENDOR_MERGE_TARGET_MISSING'
      USING ERRCODE = 'P0002';
  END IF;

  FOR favorite_row IN
    SELECT unioned.user_id, min(unioned.created_at) AS created_at
    FROM (
      SELECT wishlist.user_id, wishlist.created_at
      FROM public.wishlists AS wishlist
      WHERE wishlist.vendor_id = p_losing_vendor_id
      UNION ALL
      SELECT favorite.user_id, favorite.created_at
      FROM public.vendor_favorites AS favorite
      WHERE favorite.vendor_id = p_losing_vendor_id
    ) AS unioned
    GROUP BY unioned.user_id
  LOOP
    INSERT INTO public.wishlists AS wishlist (
      user_id, vendor_id, created_at
    ) VALUES (
      favorite_row.user_id, p_preserved_vendor_id, favorite_row.created_at
    )
    ON CONFLICT (user_id, vendor_id) DO UPDATE
    SET created_at = LEAST(wishlist.created_at, EXCLUDED.created_at);

    INSERT INTO public.vendor_favorites AS favorite (
      user_id, vendor_id, created_at
    ) VALUES (
      favorite_row.user_id, p_preserved_vendor_id, favorite_row.created_at
    )
    ON CONFLICT (user_id, vendor_id) DO UPDATE
    SET created_at = LEAST(favorite.created_at, EXCLUDED.created_at);
  END LOOP;

  DELETE FROM public.wishlists
  WHERE vendor_id = p_losing_vendor_id;
  DELETE FROM public.vendor_favorites
  WHERE vendor_id = p_losing_vendor_id;

  INSERT INTO public.price_alerts AS alert (
    user_id, vendor_id, created_at
  )
  SELECT alert.user_id, p_preserved_vendor_id, min(alert.created_at)
  FROM public.price_alerts AS alert
  WHERE alert.vendor_id IN (p_losing_vendor_id, p_preserved_vendor_id)
  GROUP BY alert.user_id
  ON CONFLICT (user_id, vendor_id) DO UPDATE
  SET created_at = LEAST(alert.created_at, EXCLUDED.created_at);

  DELETE FROM public.price_alerts
  WHERE vendor_id = p_losing_vendor_id;

  INSERT INTO public.vendor_demand_daily AS demand (
    day, vendor_id, impressions, detail_views, wishlist_adds, combo_adds,
    quote_requests, weighted_score, qualified_score
  )
  SELECT
    demand.day,
    p_preserved_vendor_id,
    sum(demand.impressions)::integer,
    sum(demand.detail_views)::integer,
    sum(demand.wishlist_adds)::integer,
    sum(demand.combo_adds)::integer,
    sum(demand.quote_requests)::integer,
    sum(demand.weighted_score),
    sum(demand.qualified_score)
  FROM public.vendor_demand_daily AS demand
  WHERE demand.vendor_id IN (p_losing_vendor_id, p_preserved_vendor_id)
  GROUP BY demand.day
  ON CONFLICT (day, vendor_id) DO UPDATE
  SET impressions = EXCLUDED.impressions,
      detail_views = EXCLUDED.detail_views,
      wishlist_adds = EXCLUDED.wishlist_adds,
      combo_adds = EXCLUDED.combo_adds,
      quote_requests = EXCLUDED.quote_requests,
      weighted_score = EXCLUDED.weighted_score,
      qualified_score = EXCLUDED.qualified_score;

  DELETE FROM public.vendor_demand_daily
  WHERE vendor_id = p_losing_vendor_id;

  UPDATE public.combos AS combo
  SET selections = public.rewrite_price_combo_identity(
        combo.selections,
        'vendor_id',
        p_losing_vendor_id,
        p_preserved_vendor_id
      ),
      updated_at = now()
  WHERE public.price_combo_contains_identity(
    combo.selections, 'vendor_id', p_losing_vendor_id
  );

  IF EXISTS (
    SELECT 1 FROM public.wishlists
    WHERE vendor_id = p_losing_vendor_id
    UNION ALL
    SELECT 1 FROM public.vendor_favorites
    WHERE vendor_id = p_losing_vendor_id
    UNION ALL
    SELECT 1 FROM public.price_alerts
    WHERE vendor_id = p_losing_vendor_id
    UNION ALL
    SELECT 1 FROM public.vendor_demand_daily
    WHERE vendor_id = p_losing_vendor_id
    UNION ALL
    SELECT 1 FROM public.combos AS combo
    WHERE public.price_combo_contains_identity(
      combo.selections, 'vendor_id', p_losing_vendor_id
    )
  ) THEN
    RAISE EXCEPTION 'PRICE_CONSUMER_VENDOR_REFERENCE_REWRITE_INCOMPLETE'
      USING ERRCODE = '55000';
  END IF;
END
$merge_price_consumer_vendor_references$;

CREATE OR REPLACE FUNCTION public.merge_price_consumer_agency_references(
  p_losing_agency_id uuid,
  p_preserved_agency_id uuid
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $merge_price_consumer_agency_references$
DECLARE
  locked_agency_count integer;
BEGIN
  IF p_losing_agency_id IS NULL
    OR p_preserved_agency_id IS NULL
    OR p_losing_agency_id = p_preserved_agency_id
  THEN
    RAISE EXCEPTION 'PRICE_CONSUMER_AGENCY_MERGE_IDS_INVALID'
      USING ERRCODE = '22023';
  END IF;

  PERFORM agency.id
  FROM public.agencies AS agency
  WHERE agency.id IN (p_losing_agency_id, p_preserved_agency_id)
  ORDER BY agency.id
  FOR UPDATE;

  GET DIAGNOSTICS locked_agency_count = ROW_COUNT;
  IF locked_agency_count <> 2 THEN
    RAISE EXCEPTION 'PRICE_CONSUMER_AGENCY_MERGE_TARGET_MISSING'
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.combos AS combo
  SET selections = public.rewrite_price_combo_identity(
        combo.selections,
        'agency_id',
        p_losing_agency_id,
        p_preserved_agency_id
      ),
      updated_at = now()
  WHERE public.price_combo_contains_identity(
    combo.selections, 'agency_id', p_losing_agency_id
  );

  IF EXISTS (
    SELECT 1 FROM public.combos AS combo
    WHERE public.price_combo_contains_identity(
      combo.selections, 'agency_id', p_losing_agency_id
    )
  ) THEN
    RAISE EXCEPTION 'PRICE_CONSUMER_AGENCY_REFERENCE_REWRITE_INCOMPLETE'
      USING ERRCODE = '55000';
  END IF;
END
$merge_price_consumer_agency_references$;

ALTER FUNCTION public.merge_price_consumer_vendor_references(uuid, uuid)
  OWNER TO postgres;
ALTER FUNCTION public.merge_price_consumer_agency_references(uuid, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.merge_price_consumer_vendor_references(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.merge_price_consumer_agency_references(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Reconcile consumer data for dedupes completed between the foundation and this
-- hardening migration.
DO $price_consumer_existing_merge_reconciliation$
DECLARE
  mapping record;
BEGIN
  FOR mapping IN
    SELECT vendor.id AS losing_id, vendor.merged_into_vendor_id AS preserved_id
    FROM public.vendors AS vendor
    WHERE vendor.merged_into_vendor_id IS NOT NULL
    ORDER BY vendor.id
  LOOP
    PERFORM public.merge_price_consumer_vendor_references(
      mapping.losing_id, public.canonical_price_vendor_id(mapping.preserved_id)
    );
  END LOOP;

  FOR mapping IN
    SELECT agency.id AS losing_id, agency.merged_into_agency_id AS preserved_id
    FROM public.agencies AS agency
    WHERE agency.merged_into_agency_id IS NOT NULL
    ORDER BY agency.id
  LOOP
    PERFORM public.merge_price_consumer_agency_references(
      mapping.losing_id, public.canonical_price_agency_id(mapping.preserved_id)
    );
  END LOOP;
END
$price_consumer_existing_merge_reconciliation$;

-- Wishlist membership is a mathematical set: clients add or remove a pair and
-- cannot mutate either identity in place.
DROP POLICY IF EXISTS price_consumer_owner_all ON public.wishlists;
DROP POLICY IF EXISTS price_consumer_owner_select ON public.wishlists;
DROP POLICY IF EXISTS price_consumer_owner_insert ON public.wishlists;
DROP POLICY IF EXISTS price_consumer_owner_delete ON public.wishlists;
CREATE POLICY price_consumer_owner_select ON public.wishlists
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY price_consumer_owner_insert ON public.wishlists
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY price_consumer_owner_delete ON public.wishlists
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

REVOKE UPDATE ON TABLE public.wishlists
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.wishlists
  TO authenticated, service_role;

-- The legacy favorite surface remains synchronized with wishlists, so it must
-- expose the same set semantics. In particular, UPDATE would bypass the
-- INSERT/DELETE synchronization triggers and create two sources of truth.
ALTER TABLE public.vendor_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_favorites FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vendor_favorites_select" ON public.vendor_favorites;
DROP POLICY IF EXISTS "vendor_favorites_manage" ON public.vendor_favorites;
DROP POLICY IF EXISTS "Enable read access for all users"
  ON public.vendor_favorites;
DROP POLICY IF EXISTS "Allow full access with service role"
  ON public.vendor_favorites;
DROP POLICY IF EXISTS price_consumer_legacy_favorite_owner_select
  ON public.vendor_favorites;
DROP POLICY IF EXISTS price_consumer_legacy_favorite_owner_insert
  ON public.vendor_favorites;
DROP POLICY IF EXISTS price_consumer_legacy_favorite_owner_delete
  ON public.vendor_favorites;

CREATE POLICY price_consumer_legacy_favorite_owner_select
  ON public.vendor_favorites
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY price_consumer_legacy_favorite_owner_insert
  ON public.vendor_favorites
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY price_consumer_legacy_favorite_owner_delete
  ON public.vendor_favorites
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

REVOKE UPDATE ON TABLE public.vendor_favorites
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.vendor_favorites
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guard_vendor_merge_mapping_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $guard_vendor_merge_mapping_write$
DECLARE
  dedupe_owner name;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.merged_into_vendor_id IS NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'VENDOR_MERGE_MAPPING_RPC_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.merged_into_vendor_id IS NOT DISTINCT FROM OLD.merged_into_vendor_id THEN
    RETURN NEW;
  END IF;

  SELECT pg_catalog.pg_get_userbyid(proc.proowner)
  INTO dedupe_owner
  FROM pg_catalog.pg_proc AS proc
  WHERE proc.oid =
    'public.decide_vendor_dedupe_candidate(uuid,text,uuid,uuid)'::regprocedure;

  IF current_user = dedupe_owner
    AND current_setting('hanbang.vendor_dedupe_mapping', true)
      = OLD.id::text || ':' || NEW.merged_into_vendor_id::text
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'VENDOR_MERGE_MAPPING_RPC_REQUIRED'
    USING ERRCODE = '42501';
END
$guard_vendor_merge_mapping_write$;

CREATE OR REPLACE FUNCTION public.guard_agency_merge_mapping_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $guard_agency_merge_mapping_write$
DECLARE
  dedupe_owner name;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.merged_into_agency_id IS NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'AGENCY_MERGE_MAPPING_RPC_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.merged_into_agency_id IS NOT DISTINCT FROM OLD.merged_into_agency_id THEN
    RETURN NEW;
  END IF;

  SELECT pg_catalog.pg_get_userbyid(proc.proowner)
  INTO dedupe_owner
  FROM pg_catalog.pg_proc AS proc
  WHERE proc.oid =
    'public.decide_agency_dedupe_candidate(uuid,text,uuid,uuid)'::regprocedure;

  IF current_user = dedupe_owner
    AND current_setting('hanbang.agency_dedupe_mapping', true)
      = OLD.id::text || ':' || NEW.merged_into_agency_id::text
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'AGENCY_MERGE_MAPPING_RPC_REQUIRED'
    USING ERRCODE = '42501';
END
$guard_agency_merge_mapping_write$;

ALTER FUNCTION public.guard_vendor_merge_mapping_write() OWNER TO postgres;
ALTER FUNCTION public.guard_agency_merge_mapping_write() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_vendor_merge_mapping_write()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_agency_merge_mapping_write()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS vendors_merge_mapping_write_fence ON public.vendors;
CREATE TRIGGER vendors_merge_mapping_write_fence
BEFORE INSERT OR UPDATE OF merged_into_vendor_id ON public.vendors
FOR EACH ROW
EXECUTE FUNCTION public.guard_vendor_merge_mapping_write();

DROP TRIGGER IF EXISTS agencies_merge_mapping_write_fence ON public.agencies;
CREATE TRIGGER agencies_merge_mapping_write_fence
BEFORE INSERT OR UPDATE OF merged_into_agency_id ON public.agencies
FOR EACH ROW
EXECUTE FUNCTION public.guard_agency_merge_mapping_write();


CREATE OR REPLACE FUNCTION public.decide_vendor_dedupe_candidate(
  p_candidate_id uuid,
  p_decision text,
  p_preserved_vendor_id uuid,
  p_decided_by uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
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
  -- STAGING_TWO_SESSION_VENDOR_DEDUPE_AGGREGATE_GATE: before production,
  -- verify with two real PostgreSQL sessions that a blocked aggregate resumes
  -- without recreating a losing vendor row. PGlite cannot prove lock waiting.
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718, 20300);

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

  IF preserved_row.merged_into_vendor_id IS NOT NULL
    OR losing_row.merged_into_vendor_id IS NOT NULL
  THEN
    RAISE EXCEPTION 'VENDOR_DEDUPE_ALREADY_MERGED'
      USING ERRCODE = '55000';
  END IF;

  -- Publication rows are historical facts and reviewed drafts are CAS-owned.
  -- A dedupe must wait for an explicit new snapshot/review decision instead of
  -- silently changing either relationship.
  IF EXISTS (
    SELECT 1
    FROM public.official_prices AS price_row
    JOIN public.price_snapshots AS snapshot_row
      ON snapshot_row.id = price_row.snapshot_id
    WHERE price_row.vendor_id = losing_vendor_id
      AND (
        snapshot_row.published IS TRUE
        OR NOT (
          price_row.review_status = 'pending'
          AND price_row.edited_by_admin = false
          AND price_row.reviewed_by IS NULL
          AND price_row.reviewed_at IS NULL
          AND price_row.review_action IS NULL
          AND price_row.review_version = 0
        )
      )
  ) THEN
    RAISE EXCEPTION 'VENDOR_DEDUPE_PRICE_REFERENCE_REQUIRES_NEW_SNAPSHOT'
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

  -- Consumer-owned references are a set union, not winner-takes-all. This
  -- clears every losing FK before the generic unknown-reference gate below.
  PERFORM public.merge_price_consumer_vendor_references(
    losing_vendor_id,
    p_preserved_vendor_id
  );

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
  PERFORM pg_catalog.set_config(
    'hanbang.vendor_dedupe_mapping',
    losing_vendor_id::text || ':' || p_preserved_vendor_id::text,
    true
  );

  UPDATE public.vendors
  SET status = 'rejected',
      enrichment_status = 'skip',
      merged_into_vendor_id = p_preserved_vendor_id,
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

  PERFORM pg_catalog.set_config(
    'hanbang.vendor_dedupe_mapping',
    '',
    true
  );
END;
$decide_vendor_dedupe_candidate$;

CREATE OR REPLACE FUNCTION public.decide_agency_dedupe_candidate(
  p_candidate_id uuid,
  p_decision text,
  p_preserved_agency_id uuid,
  p_decided_by uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $decide_agency_dedupe_candidate$
DECLARE
  candidate_row public.agency_dedupe_candidates%ROWTYPE;
  preserved_row public.agencies%ROWTYPE;
  losing_row public.agencies%ROWTYPE;
  losing_agency_id uuid;
  merged_aliases text[];
  merged_corporate_name text;
  merged_source_file text;
  merged_homepage_url text;
  merged_disclosure_url text;
  conflicting_extra_column text;
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
  IF preserved_row.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'AGENCY_DEDUPE_PRESERVED_INACTIVE'
      USING ERRCODE = '55000';
  END IF;
  IF preserved_row.region_code IS NULL
    OR losing_row.region_code IS NULL
    OR preserved_row.region_code IS DISTINCT FROM losing_row.region_code
  THEN
    RAISE EXCEPTION 'AGENCY_DEDUPE_REGION_MISMATCH' USING ERRCODE = '22023';
  END IF;

  IF NULLIF(btrim(preserved_row.corporate_name), '') IS NOT NULL
    AND NULLIF(btrim(losing_row.corporate_name), '') IS NOT NULL
    AND btrim(preserved_row.corporate_name)
      IS DISTINCT FROM btrim(losing_row.corporate_name)
  THEN
    RAISE EXCEPTION 'AGENCY_DEDUPE_CORPORATE_NAME_CONFLICT'
      USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(preserved_row.source_file), '') IS NOT NULL
    AND NULLIF(btrim(losing_row.source_file), '') IS NOT NULL
    AND btrim(preserved_row.source_file)
      IS DISTINCT FROM btrim(losing_row.source_file)
  THEN
    RAISE EXCEPTION 'AGENCY_DEDUPE_SOURCE_FILE_CONFLICT'
      USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(preserved_row.homepage_url), '') IS NOT NULL
    AND NULLIF(btrim(losing_row.homepage_url), '') IS NOT NULL
    AND btrim(preserved_row.homepage_url)
      IS DISTINCT FROM btrim(losing_row.homepage_url)
  THEN
    RAISE EXCEPTION 'AGENCY_DEDUPE_HOMEPAGE_URL_CONFLICT'
      USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(preserved_row.disclosure_url), '') IS NOT NULL
    AND NULLIF(btrim(losing_row.disclosure_url), '') IS NOT NULL
    AND btrim(preserved_row.disclosure_url)
      IS DISTINCT FROM btrim(losing_row.disclosure_url)
  THEN
    RAISE EXCEPTION 'AGENCY_DEDUPE_DISCLOSURE_URL_CONFLICT'
      USING ERRCODE = '22023';
  END IF;

  -- The fields below are either explicitly merged above/below or intentionally
  -- retained on the tombstone row. Any future agency field fails closed until
  -- its merge semantics are deliberately defined here.
  SELECT extra_field.key
  INTO conflicting_extra_column
  FROM jsonb_each(
    to_jsonb(losing_row) - ARRAY[
      'id',
      'name',
      'normalized_name',
      'aliases',
      'corporate_name',
      'region_code',
      'source_file',
      'merged_into_agency_id',
      'created_at',
      'updated_at',
      'slug',
      'display_name',
      'homepage_url',
      'disclosure_url',
      'is_active'
    ]::text[]
  ) AS extra_field(key, value)
  WHERE extra_field.value <> 'null'::jsonb
    AND extra_field.value IS DISTINCT FROM
      (to_jsonb(preserved_row) -> extra_field.key)
  ORDER BY extra_field.key
  LIMIT 1;
  IF conflicting_extra_column IS NOT NULL THEN
    RAISE EXCEPTION 'AGENCY_DEDUPE_UNMERGED_COLUMN_CONFLICT: %',
      conflicting_extra_column
      USING ERRCODE = '55000';
  END IF;

  merged_corporate_name := COALESCE(
    NULLIF(btrim(preserved_row.corporate_name), ''),
    NULLIF(btrim(losing_row.corporate_name), '')
  );
  merged_source_file := COALESCE(
    NULLIF(btrim(preserved_row.source_file), ''),
    NULLIF(btrim(losing_row.source_file), '')
  );
  merged_homepage_url := COALESCE(
    NULLIF(btrim(preserved_row.homepage_url), ''),
    NULLIF(btrim(losing_row.homepage_url), '')
  );
  merged_disclosure_url := COALESCE(
    NULLIF(btrim(preserved_row.disclosure_url), ''),
    NULLIF(btrim(losing_row.disclosure_url), '')
  );

  IF EXISTS (
    SELECT 1
    FROM public.official_prices AS price_row
    JOIN public.price_snapshots AS snapshot_row
      ON snapshot_row.id = price_row.snapshot_id
    WHERE price_row.agency_id = losing_agency_id
      AND (
        snapshot_row.published IS TRUE
        OR NOT (
          price_row.review_status = 'pending'
          AND price_row.edited_by_admin = false
          AND price_row.reviewed_by IS NULL
          AND price_row.reviewed_at IS NULL
          AND price_row.review_action IS NULL
          AND price_row.review_version = 0
        )
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.official_agency_packages AS package_row
    JOIN public.price_snapshots AS snapshot_row
      ON snapshot_row.id = package_row.snapshot_id
    WHERE package_row.agency_id = losing_agency_id
      AND (
        snapshot_row.published IS TRUE
        OR NOT (
          package_row.review_status = 'pending'
          AND package_row.edited_by_admin = false
          AND package_row.reviewed_by IS NULL
          AND package_row.reviewed_at IS NULL
          AND package_row.review_action IS NULL
          AND package_row.review_version = 0
        )
      )
  ) THEN
    RAISE EXCEPTION 'AGENCY_DEDUPE_PRICE_REFERENCE_REQUIRES_NEW_SNAPSHOT'
      USING ERRCODE = '55000';
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
      || ARRAY[losing_row.name, losing_row.display_name]
    ) AS alias_source(alias_value)
    WHERE NULLIF(btrim(alias_value), '') IS NOT NULL
      AND btrim(alias_value) <> preserved_row.name
  ) AS normalized_aliases;
  IF cardinality(merged_aliases) > 100 THEN
    RAISE EXCEPTION 'AGENCY_DEDUPE_ALIAS_LIMIT' USING ERRCODE = '22023';
  END IF;

  PERFORM public.merge_price_consumer_agency_references(
    losing_agency_id,
    p_preserved_agency_id
  );

  UPDATE public.agencies
  SET aliases = merged_aliases,
      corporate_name = merged_corporate_name,
      source_file = merged_source_file,
      homepage_url = merged_homepage_url,
      disclosure_url = merged_disclosure_url,
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

  PERFORM pg_catalog.set_config(
    'hanbang.agency_dedupe_mapping',
    losing_agency_id::text || ':' || p_preserved_agency_id::text,
    true
  );

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

  PERFORM pg_catalog.set_config(
    'hanbang.agency_dedupe_mapping',
    '',
    true
  );
END;
$decide_agency_dedupe_candidate$;

ALTER FUNCTION public.decide_vendor_dedupe_candidate(
  uuid, text, uuid, uuid
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.decide_vendor_dedupe_candidate(
  uuid, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decide_vendor_dedupe_candidate(
  uuid, text, uuid, uuid
) TO service_role;

ALTER FUNCTION public.decide_agency_dedupe_candidate(
  uuid, text, uuid, uuid
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.decide_agency_dedupe_candidate(
  uuid, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decide_agency_dedupe_candidate(
  uuid, text, uuid, uuid
) TO service_role;


-- New consumer writes serialize with dedupe row locks. A writer that commits
-- first is included in the union/rewrite; a writer that arrives after the
-- merge sees the tombstone and fails rather than creating a stale reference.
DROP TRIGGER IF EXISTS wishlists_active_vendor_fence ON public.wishlists;
CREATE TRIGGER wishlists_active_vendor_fence
BEFORE INSERT OR UPDATE OF vendor_id ON public.wishlists
FOR EACH ROW
EXECUTE FUNCTION public.enforce_non_rejected_vendor_reference();

DROP TRIGGER IF EXISTS vendor_favorites_active_vendor_fence
  ON public.vendor_favorites;
CREATE TRIGGER vendor_favorites_active_vendor_fence
BEFORE INSERT OR UPDATE OF vendor_id ON public.vendor_favorites
FOR EACH ROW
EXECUTE FUNCTION public.enforce_non_rejected_vendor_reference();

DROP TRIGGER IF EXISTS price_alerts_active_vendor_fence
  ON public.price_alerts;
CREATE TRIGGER price_alerts_active_vendor_fence
BEFORE INSERT OR UPDATE OF vendor_id ON public.price_alerts
FOR EACH ROW
EXECUTE FUNCTION public.enforce_non_rejected_vendor_reference();

DROP TRIGGER IF EXISTS events_active_agency_fence ON public.events;
CREATE TRIGGER events_active_agency_fence
BEFORE INSERT OR UPDATE OF agency_id ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.enforce_active_agency_reference();

CREATE OR REPLACE FUNCTION public.assert_price_combo_references_canonical(
  p_selections jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $assert_price_combo_references_canonical$
DECLARE
  selection_row record;
  selected_vendor_id uuid;
  selected_agency_id uuid;
  selected_vendor_status text;
  selected_vendor_merge_id uuid;
  selected_agency_active boolean;
  selected_agency_merge_id uuid;
BEGIN
  IF p_selections IS NULL OR jsonb_typeof(p_selections) <> 'object' THEN
    RAISE EXCEPTION 'PRICE_COMBO_SELECTIONS_OBJECT_REQUIRED'
      USING ERRCODE = '23514';
  END IF;

  FOR selection_row IN
    SELECT entry.key AS category, entry.value AS selection
    FROM jsonb_each(p_selections) AS entry
    ORDER BY entry.key
  LOOP
    IF selection_row.selection = 'null'::jsonb THEN
      CONTINUE;
    END IF;
    IF jsonb_typeof(selection_row.selection) <> 'object'
      OR NOT (selection_row.selection ? 'vendor_id')
      OR NOT (selection_row.selection ? 'agency_id')
      OR jsonb_typeof(selection_row.selection -> 'vendor_id') <> 'string'
    THEN
      RAISE EXCEPTION 'PRICE_COMBO_SELECTION_IDENTITY_INVALID: %',
        selection_row.category
        USING ERRCODE = '23514';
    END IF;

    BEGIN
      selected_vendor_id := (selection_row.selection ->> 'vendor_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'PRICE_COMBO_VENDOR_ID_INVALID: %',
        selection_row.category
        USING ERRCODE = '23514';
    END;

    SELECT vendor.status, vendor.merged_into_vendor_id
    INTO selected_vendor_status, selected_vendor_merge_id
    FROM public.vendors AS vendor
    WHERE vendor.id = selected_vendor_id
    FOR SHARE;

    IF NOT FOUND
      OR selected_vendor_status <> 'approved'
      OR selected_vendor_merge_id IS NOT NULL
    THEN
      RAISE EXCEPTION 'PRICE_COMBO_VENDOR_NOT_CANONICAL: %',
        selection_row.category
        USING ERRCODE = '23514';
    END IF;

    IF selection_row.selection -> 'agency_id' = 'null'::jsonb THEN
      CONTINUE;
    END IF;
    IF jsonb_typeof(selection_row.selection -> 'agency_id') <> 'string' THEN
      RAISE EXCEPTION 'PRICE_COMBO_AGENCY_ID_INVALID: %',
        selection_row.category
        USING ERRCODE = '23514';
    END IF;

    BEGIN
      selected_agency_id := (selection_row.selection ->> 'agency_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'PRICE_COMBO_AGENCY_ID_INVALID: %',
        selection_row.category
        USING ERRCODE = '23514';
    END;

    SELECT agency.is_active, agency.merged_into_agency_id
    INTO selected_agency_active, selected_agency_merge_id
    FROM public.agencies AS agency
    WHERE agency.id = selected_agency_id
    FOR SHARE;

    IF NOT FOUND
      OR selected_agency_active IS NOT TRUE
      OR selected_agency_merge_id IS NOT NULL
    THEN
      RAISE EXCEPTION 'PRICE_COMBO_AGENCY_NOT_CANONICAL: %',
        selection_row.category
        USING ERRCODE = '23514';
    END IF;
  END LOOP;
END
$assert_price_combo_references_canonical$;

CREATE OR REPLACE FUNCTION public.enforce_price_combo_canonical_references()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $enforce_price_combo_canonical_references$
BEGIN
  PERFORM public.assert_price_combo_references_canonical(NEW.selections);
  RETURN NEW;
END
$enforce_price_combo_canonical_references$;

ALTER FUNCTION public.assert_price_combo_references_canonical(jsonb)
  OWNER TO postgres;
ALTER FUNCTION public.enforce_price_combo_canonical_references()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.assert_price_combo_references_canonical(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enforce_price_combo_canonical_references()
  FROM PUBLIC, anon, authenticated, service_role;

DO $existing_price_combo_reference_postcondition$
DECLARE
  combo_row record;
BEGIN
  FOR combo_row IN
    SELECT combo.id, combo.selections
    FROM public.combos AS combo
    ORDER BY combo.id
  LOOP
    BEGIN
      PERFORM public.assert_price_combo_references_canonical(
        combo_row.selections
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'PRICE_COMBO_EXISTING_REFERENCE_INVALID: %: %',
        combo_row.id,
        SQLERRM
        USING ERRCODE = '55000';
    END;
  END LOOP;
END
$existing_price_combo_reference_postcondition$;

DROP TRIGGER IF EXISTS combos_canonical_reference_fence ON public.combos;
CREATE TRIGGER combos_canonical_reference_fence
BEFORE INSERT OR UPDATE OF selections ON public.combos
FOR EACH ROW
EXECUTE FUNCTION public.enforce_price_combo_canonical_references();

-- Raw event IDs are immutable evidence. Canonical IDs are a read-time
-- projection, including agency lineage, so no merge ever updates an event row.
CREATE OR REPLACE VIEW public.v_events_canonical
WITH (security_barrier = true, security_invoker = false)
AS
SELECT
  event_row.id,
  event_row.anon_id,
  event_row.user_id,
  event_row.session_id,
  event_row.vendor_id AS source_vendor_id,
  public.canonical_price_vendor_id(event_row.vendor_id) AS vendor_id,
  event_row.agency_id AS source_agency_id,
  public.canonical_price_agency_id(event_row.agency_id) AS agency_id,
  event_row.surface,
  event_row.event_type,
  event_row.metadata,
  event_row.context,
  event_row.weight,
  event_row.created_at
FROM public.events AS event_row;

ALTER VIEW public.v_events_canonical OWNER TO postgres;
REVOKE ALL ON TABLE public.v_events_canonical
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.v_events_canonical TO service_role;

CREATE OR REPLACE FUNCTION public.aggregate_vendor_demand_daily(
  p_day date DEFAULT ((now() AT TIME ZONE 'Asia/Seoul')::date - 1)
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $aggregate_vendor_demand_daily$
DECLARE
  affected_count integer;
BEGIN
  -- Serialize the statement snapshot with vendor lineage changes. Without this
  -- lock, an aggregate that read the old lineage could resume after a merge and
  -- recreate the losing vendor's daily row.
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718, 20300);

  IF p_day IS NULL OR p_day > (now() AT TIME ZONE 'Asia/Seoul')::date THEN
    RAISE EXCEPTION 'VENDOR_DEMAND_DAY_INVALID' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.vendor_demand_daily (
    day,
    vendor_id,
    impressions,
    detail_views,
    wishlist_adds,
    combo_adds,
    quote_requests,
    weighted_score,
    qualified_score
  )
  SELECT
    p_day,
    event_row.vendor_id,
    count(*) FILTER (WHERE event_row.event_type = 'vendor_impression'),
    count(*) FILTER (WHERE event_row.event_type = 'vendor_detail_view'),
    count(*) FILTER (WHERE event_row.event_type = 'wishlist_add'),
    count(*) FILTER (WHERE event_row.event_type = 'combo_add'),
    count(*) FILTER (WHERE event_row.event_type = 'quote_request'),
    COALESCE(sum(event_row.weight), 0),
    COALESCE(sum(
      CASE WHEN event_row.user_id IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.profiles AS profile
        JOIN public.wedding_journeys AS journey
          ON journey.couple_id = profile.couple_id
        WHERE profile.id = event_row.user_id
          AND journey.wedding_date IS NOT NULL
      ) THEN event_row.weight ELSE 0 END
    ), 0)
  FROM public.v_events_canonical AS event_row
  WHERE event_row.vendor_id IS NOT NULL
    AND event_row.created_at >= (
      p_day::timestamp AT TIME ZONE 'Asia/Seoul'
    )
    AND event_row.created_at < (
      (p_day + 1)::timestamp AT TIME ZONE 'Asia/Seoul'
    )
  GROUP BY event_row.vendor_id
  ON CONFLICT (day, vendor_id) DO UPDATE
  SET impressions = EXCLUDED.impressions,
      detail_views = EXCLUDED.detail_views,
      wishlist_adds = EXCLUDED.wishlist_adds,
      combo_adds = EXCLUDED.combo_adds,
      quote_requests = EXCLUDED.quote_requests,
      weighted_score = EXCLUDED.weighted_score,
      qualified_score = EXCLUDED.qualified_score;

  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RETURN affected_count;
END
$aggregate_vendor_demand_daily$;

ALTER FUNCTION public.aggregate_vendor_demand_daily(date) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.aggregate_vendor_demand_daily(date)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aggregate_vendor_demand_daily(date)
  TO service_role;

-- pg_cron is a required hosted-environment gate, not an optional best effort.
-- The extension defaults to GMT/UTC. If an installation explicitly overrides
-- cron.timezone, accept only exact UTC-equivalent names.
DO $price_demand_cron_contract$
DECLARE
  existing_count integer;
  exact_count integer;
  old_job_id bigint;
  scheduled_job_id bigint;
  cron_timezone text;
BEGIN
  IF pg_catalog.to_regclass('cron.job') IS NULL
    OR pg_catalog.to_regprocedure(
      'cron.schedule_in_database(text,text,text,text,text,boolean)'
    ) IS NULL
    OR pg_catalog.to_regprocedure('cron.unschedule(bigint)') IS NULL
  THEN
    RAISE EXCEPTION 'PRICE_DEMAND_CRON_EXTENSION_REQUIRED'
      USING ERRCODE = '55000';
  END IF;

  cron_timezone := current_setting('cron.timezone', true);
  IF NULLIF(cron_timezone, '') IS NOT NULL
    AND upper(cron_timezone) NOT IN ('UTC', 'GMT', 'ETC/UTC', 'ETC/GMT')
  THEN
    RAISE EXCEPTION 'PRICE_DEMAND_CRON_TIMEZONE_NOT_UTC: %', cron_timezone
      USING ERRCODE = '55000';
  END IF;

  -- A production release runs behind a write fence that requires zero active
  -- database cron jobs. Deactivate the current database/owner copy before any
  -- repair, and never use cron.schedule(), which creates an active row first.
  EXECUTE $deactivate_jobs$
    UPDATE cron.job
    SET active = false
    WHERE jobname = 'vendor-demand-daily-kst'
      AND database = current_database()
      AND username = current_user::text
  $deactivate_jobs$;

  EXECUTE $inspect_jobs$
    SELECT
      count(*)::integer,
      count(*) FILTER (
        WHERE schedule = '0 19 * * *'
          AND command = 'SELECT public.aggregate_vendor_demand_daily()'
          AND active IS FALSE
      )::integer
    FROM cron.job
    WHERE jobname = 'vendor-demand-daily-kst'
      AND database = current_database()
      AND username = current_user::text
  $inspect_jobs$
  INTO existing_count, exact_count;

  IF existing_count <> 1 OR exact_count <> 1 THEN
    FOR old_job_id IN EXECUTE $stale_jobs$
      SELECT jobid
      FROM cron.job
      WHERE jobname = 'vendor-demand-daily-kst'
        AND database = current_database()
        AND username = current_user::text
      ORDER BY jobid
    $stale_jobs$
    LOOP
      EXECUTE 'SELECT cron.unschedule($1)'
      USING old_job_id;
    END LOOP;

    EXECUTE
      'SELECT cron.schedule_in_database($1, $2, $3, $4, $5, $6)'
    INTO scheduled_job_id
    USING
      'vendor-demand-daily-kst',
      '0 19 * * *',
      'SELECT public.aggregate_vendor_demand_daily()',
      current_database(),
      current_user::text,
      false;

    IF scheduled_job_id IS NULL THEN
      RAISE EXCEPTION 'PRICE_DEMAND_CRON_SCHEDULE_FAILED'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  EXECUTE $verify_jobs$
    SELECT
      count(*)::integer,
      count(*) FILTER (
        WHERE schedule = '0 19 * * *'
          AND command = 'SELECT public.aggregate_vendor_demand_daily()'
          AND active IS FALSE
      )::integer
    FROM cron.job
    WHERE jobname = 'vendor-demand-daily-kst'
      AND database = current_database()
      AND username = current_user::text
  $verify_jobs$
  INTO existing_count, exact_count;

  IF existing_count <> 1 OR exact_count <> 1 THEN
    RAISE EXCEPTION 'PRICE_DEMAND_CRON_POSTCONDITION_FAILED'
      USING ERRCODE = '55000';
  END IF;
END
$price_demand_cron_contract$;

COMMIT;
