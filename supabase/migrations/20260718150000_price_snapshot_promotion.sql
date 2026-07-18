BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Promote a fully reviewed disclosure snapshot without ever exposing an
-- intermediate state. The unlocked first read discovers the source only; all
-- snapshots in that source (including the target) are then locked in UUID
-- order. Concurrent promotions therefore use one deterministic lock order.
CREATE OR REPLACE FUNCTION public.promote_price_snapshot(
  p_snapshot_id uuid,
  p_actor_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $promote_price_snapshot$
DECLARE
  target_source text;
  locked_target_source text;
  current_count integer;
  current_is_target boolean;
BEGIN
  IF p_snapshot_id IS NULL THEN
    RAISE EXCEPTION 'PRICE_SNAPSHOT_ID_REQUIRED'
      USING ERRCODE = '22023';
  END IF;

  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'PRICE_SNAPSHOT_ACTOR_REQUIRED'
      USING ERRCODE = '22023';
  END IF;

  -- Passing an arbitrary UUID is not authorization. The actor must still be a
  -- current admin profile, while function EXECUTE remains service_role-only.
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS actor
    WHERE actor.id = p_actor_id
      AND actor.is_admin = true
  ) THEN
    RAISE EXCEPTION 'PRICE_SNAPSHOT_ADMIN_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  SELECT snapshot_row.source
  INTO target_source
  FROM public.price_snapshots AS snapshot_row
  WHERE snapshot_row.id = p_snapshot_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRICE_SNAPSHOT_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  -- Never lock the selected target first: two promotions in one source could
  -- otherwise each hold a different target and deadlock. Every caller locks
  -- the full source set in the same UUID order.
  PERFORM snapshot_row.id
  FROM public.price_snapshots AS snapshot_row
  WHERE snapshot_row.source = target_source
  ORDER BY snapshot_row.id
  FOR UPDATE;

  SELECT snapshot_row.source
  INTO locked_target_source
  FROM public.price_snapshots AS snapshot_row
  WHERE snapshot_row.id = p_snapshot_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRICE_SNAPSHOT_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  IF locked_target_source IS DISTINCT FROM target_source THEN
    RAISE EXCEPTION 'PRICE_SNAPSHOT_SOURCE_CHANGED_RETRY'
      USING ERRCODE = '40001';
  END IF;

  -- A rejected row is intentionally allowed to remain incomplete. Public
  -- disclosure views require review_status = 'approved', so rejected rows are
  -- retained for audit but can never be disclosed to consumers.
  IF EXISTS (
    SELECT 1
    FROM public.official_prices AS price_row
    WHERE price_row.snapshot_id = p_snapshot_id
      AND NOT (
        price_row.review_status IS NOT DISTINCT FROM 'rejected'
        OR (
          price_row.review_status IS NOT DISTINCT FROM 'approved'
          AND price_row.needs_review IS FALSE
          AND NULLIF(btrim(price_row.source_file), '') IS NOT NULL
          AND NULLIF(btrim(price_row.source_quote), '') IS NOT NULL
          AND COALESCE(cardinality(price_row.source_object_keys), 0) > 0
          AND price_row.confidence IS NOT NULL
        )
      )
  ) THEN
    RAISE EXCEPTION 'PRICE_SNAPSHOT_OFFICIAL_PRICES_NOT_READY'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.official_agency_packages AS package_row
    WHERE package_row.snapshot_id = p_snapshot_id
      AND NOT (
        package_row.review_status IS NOT DISTINCT FROM 'rejected'
        OR (
          package_row.review_status IS NOT DISTINCT FROM 'approved'
          AND package_row.needs_review IS FALSE
          AND NULLIF(btrim(package_row.source_file), '') IS NOT NULL
          AND NULLIF(btrim(package_row.source_quote), '') IS NOT NULL
          AND COALESCE(cardinality(package_row.source_object_keys), 0) > 0
          AND package_row.confidence IS NOT NULL
        )
      )
  ) THEN
    RAISE EXCEPTION 'PRICE_SNAPSHOT_AGENCY_PACKAGES_NOT_READY'
      USING ERRCODE = '55000';
  END IF;

  -- Empty and rejected-only snapshots would erase the visible disclosure for
  -- this source. Require at least one complete approved price or package.
  IF NOT EXISTS (
    SELECT 1
    FROM public.official_prices AS price_row
    WHERE price_row.snapshot_id = p_snapshot_id
      AND price_row.review_status IS NOT DISTINCT FROM 'approved'
      AND price_row.needs_review IS FALSE
      AND NULLIF(btrim(price_row.source_file), '') IS NOT NULL
      AND NULLIF(btrim(price_row.source_quote), '') IS NOT NULL
      AND COALESCE(cardinality(price_row.source_object_keys), 0) > 0
      AND price_row.confidence IS NOT NULL
    UNION ALL
    SELECT 1
    FROM public.official_agency_packages AS package_row
    WHERE package_row.snapshot_id = p_snapshot_id
      AND package_row.review_status IS NOT DISTINCT FROM 'approved'
      AND package_row.needs_review IS FALSE
      AND NULLIF(btrim(package_row.source_file), '') IS NOT NULL
      AND NULLIF(btrim(package_row.source_quote), '') IS NOT NULL
      AND COALESCE(cardinality(package_row.source_object_keys), 0) > 0
      AND package_row.confidence IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'PRICE_SNAPSHOT_NO_PUBLISHABLE_ROWS'
      USING ERRCODE = '55000';
  END IF;

  -- Two statements avoid a transient partial-unique-index collision. They are
  -- still one atomic transaction: an exception in either statement or in the
  -- invariant check rolls both changes back.
  UPDATE public.price_snapshots AS snapshot_row
  SET is_current = false
  WHERE snapshot_row.source = target_source
    AND snapshot_row.id <> p_snapshot_id
    AND snapshot_row.is_current = true;

  UPDATE public.price_snapshots AS snapshot_row
  SET is_current = true
  WHERE snapshot_row.id = p_snapshot_id
    AND snapshot_row.is_current = false;

  SELECT
    count(*)::integer,
    COALESCE(bool_and(snapshot_row.id = p_snapshot_id), false)
  INTO current_count, current_is_target
  FROM public.price_snapshots AS snapshot_row
  WHERE snapshot_row.source = target_source
    AND snapshot_row.is_current = true;

  IF current_count <> 1 OR current_is_target IS NOT TRUE THEN
    RAISE EXCEPTION 'PRICE_SNAPSHOT_CURRENT_INVARIANT_FAILED'
      USING ERRCODE = '55000';
  END IF;
END
$promote_price_snapshot$;

ALTER FUNCTION public.promote_price_snapshot(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.promote_price_snapshot(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.promote_price_snapshot(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.promote_price_snapshot(uuid, uuid) IS
  'Atomically promotes one reviewed price snapshot. Rejected rows remain audit-only; empty, pending, needs-review, or incomplete-approved targets fail closed.';

-- The service role already owns broad table DML from the foundation migration.
-- Force every transition of is_current through the audited RPC, while still
-- allowing ordinary creation of a draft snapshot with is_current = false.
CREATE OR REPLACE FUNCTION public.guard_price_snapshot_current_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $guard_price_snapshot_current_write$
DECLARE
  promotion_owner text;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.is_current = false THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' AND OLD.is_current = false THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE'
    AND NEW.is_current IS NOT DISTINCT FROM OLD.is_current
    AND (
      NEW.source IS NOT DISTINCT FROM OLD.source
      OR (OLD.is_current = false AND NEW.is_current = false)
    )
  THEN
    RETURN NEW;
  END IF;

  SELECT pg_catalog.pg_get_userbyid(function_row.proowner)
  INTO promotion_owner
  FROM pg_catalog.pg_proc AS function_row
  WHERE function_row.oid =
    'public.promote_price_snapshot(uuid,uuid)'::regprocedure;

  IF current_user::text IS DISTINCT FROM promotion_owner THEN
    RAISE EXCEPTION 'PRICE_SNAPSHOT_PROMOTION_RPC_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END
$guard_price_snapshot_current_write$;

ALTER FUNCTION public.guard_price_snapshot_current_write() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_price_snapshot_current_write()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS price_snapshot_current_write_fence
  ON public.price_snapshots;
CREATE TRIGGER price_snapshot_current_write_fence
BEFORE INSERT OR UPDATE OF is_current, source OR DELETE
ON public.price_snapshots
FOR EACH ROW
EXECUTE FUNCTION public.guard_price_snapshot_current_write();

-- Child writes take an exclusive lock on every referenced snapshot, also in UUID
-- order. This closes the check-then-promote race: a writer that wins first is
-- observed by promotion; a writer that arrives later sees the snapshot current
-- and may only write a rejected row or a complete approved row. Exclusive
-- parent locks also serialize two writers that could otherwise remove the last
-- two publishable rows concurrently.
CREATE OR REPLACE FUNCTION public.guard_price_snapshot_review_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $guard_price_snapshot_review_write$
DECLARE
  old_snapshot_id uuid;
  snapshot_row record;
  new_snapshot_is_current boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    old_snapshot_id := OLD.snapshot_id;
  ELSE
    old_snapshot_id := NEW.snapshot_id;
  END IF;

  FOR snapshot_row IN
    SELECT snapshot.id, snapshot.is_current
    FROM public.price_snapshots AS snapshot
    WHERE snapshot.id = ANY (
      ARRAY[NEW.snapshot_id, old_snapshot_id]::uuid[]
    )
    ORDER BY snapshot.id
    FOR UPDATE
  LOOP
    IF snapshot_row.id = NEW.snapshot_id THEN
      new_snapshot_is_current := snapshot_row.is_current;
    END IF;
  END LOOP;

  IF new_snapshot_is_current
    AND NOT (
      NEW.review_status IS NOT DISTINCT FROM 'rejected'
      OR (
        NEW.review_status IS NOT DISTINCT FROM 'approved'
        AND NEW.needs_review IS FALSE
        AND NULLIF(btrim(NEW.source_file), '') IS NOT NULL
        AND NULLIF(btrim(NEW.source_quote), '') IS NOT NULL
        AND COALESCE(cardinality(NEW.source_object_keys), 0) > 0
        AND NEW.confidence IS NOT NULL
      )
    )
  THEN
    RAISE EXCEPTION 'PRICE_SNAPSHOT_CURRENT_ROW_NOT_READY'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END
$guard_price_snapshot_review_write$;

ALTER FUNCTION public.guard_price_snapshot_review_write() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_price_snapshot_review_write()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS official_prices_snapshot_review_fence
  ON public.official_prices;
CREATE TRIGGER official_prices_snapshot_review_fence
BEFORE INSERT OR UPDATE OF
  snapshot_id,
  review_status,
  needs_review,
  source_file,
  source_quote,
  source_object_keys,
  confidence
ON public.official_prices
FOR EACH ROW
EXECUTE FUNCTION public.guard_price_snapshot_review_write();

DROP TRIGGER IF EXISTS official_agency_packages_snapshot_review_fence
  ON public.official_agency_packages;
CREATE TRIGGER official_agency_packages_snapshot_review_fence
BEFORE INSERT OR UPDATE OF
  snapshot_id,
  review_status,
  needs_review,
  source_file,
  source_quote,
  source_object_keys,
  confidence
ON public.official_agency_packages
FOR EACH ROW
EXECUTE FUNCTION public.guard_price_snapshot_review_write();

-- Re-check the source-wide publication floor after each child mutation. The
-- BEFORE trigger above holds the affected parent rows FOR UPDATE until commit,
-- so two concurrent reject/delete operations cannot both observe a stale
-- publishable sibling and reduce a current snapshot to zero public rows.
CREATE OR REPLACE FUNCTION public.assert_current_price_snapshot_publishable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $assert_current_price_snapshot_publishable$
DECLARE
  old_snapshot_id uuid;
  new_snapshot_id uuid;
  snapshot_row record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    old_snapshot_id := NEW.snapshot_id;
    new_snapshot_id := NEW.snapshot_id;
  ELSIF TG_OP = 'DELETE' THEN
    old_snapshot_id := OLD.snapshot_id;
    new_snapshot_id := OLD.snapshot_id;
  ELSE
    old_snapshot_id := OLD.snapshot_id;
    new_snapshot_id := NEW.snapshot_id;
  END IF;

  FOR snapshot_row IN
    SELECT snapshot.id, snapshot.is_current
    FROM public.price_snapshots AS snapshot
    WHERE snapshot.id = ANY (
      ARRAY[old_snapshot_id, new_snapshot_id]::uuid[]
    )
    ORDER BY snapshot.id
    FOR UPDATE
  LOOP
    IF snapshot_row.is_current
      AND NOT EXISTS (
        SELECT 1
        FROM public.official_prices AS price_row
        WHERE price_row.snapshot_id = snapshot_row.id
          AND price_row.review_status IS NOT DISTINCT FROM 'approved'
          AND price_row.needs_review IS FALSE
          AND NULLIF(btrim(price_row.source_file), '') IS NOT NULL
          AND NULLIF(btrim(price_row.source_quote), '') IS NOT NULL
          AND COALESCE(cardinality(price_row.source_object_keys), 0) > 0
          AND price_row.confidence IS NOT NULL
        UNION ALL
        SELECT 1
        FROM public.official_agency_packages AS package_row
        WHERE package_row.snapshot_id = snapshot_row.id
          AND package_row.review_status IS NOT DISTINCT FROM 'approved'
          AND package_row.needs_review IS FALSE
          AND NULLIF(btrim(package_row.source_file), '') IS NOT NULL
          AND NULLIF(btrim(package_row.source_quote), '') IS NOT NULL
          AND COALESCE(cardinality(package_row.source_object_keys), 0) > 0
          AND package_row.confidence IS NOT NULL
      )
    THEN
      RAISE EXCEPTION 'PRICE_SNAPSHOT_CURRENT_NO_PUBLISHABLE_ROWS'
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  RETURN NULL;
END
$assert_current_price_snapshot_publishable$;

ALTER FUNCTION public.assert_current_price_snapshot_publishable()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.assert_current_price_snapshot_publishable()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS official_prices_snapshot_publication_floor
  ON public.official_prices;
CREATE TRIGGER official_prices_snapshot_publication_floor
AFTER INSERT OR UPDATE OR DELETE ON public.official_prices
FOR EACH ROW
EXECUTE FUNCTION public.assert_current_price_snapshot_publishable();

DROP TRIGGER IF EXISTS official_agency_packages_snapshot_publication_floor
  ON public.official_agency_packages;
CREATE TRIGGER official_agency_packages_snapshot_publication_floor
AFTER INSERT OR UPDATE OR DELETE ON public.official_agency_packages
FOR EACH ROW
EXECUTE FUNCTION public.assert_current_price_snapshot_publishable();

COMMIT;
