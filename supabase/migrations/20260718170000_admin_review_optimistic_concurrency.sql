BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- A monotonically increasing opaque token prevents an older admin form from
-- overwriting a newer save/approve/reject decision. Keep the value within the
-- JavaScript safe-integer range because PostgREST serializes bigint as JSON.
ALTER TABLE public.official_prices
  ADD COLUMN IF NOT EXISTS review_version bigint NOT NULL DEFAULT 0;
ALTER TABLE public.official_agency_packages
  ADD COLUMN IF NOT EXISTS review_version bigint NOT NULL DEFAULT 0;

DO $review_version_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.official_prices'::regclass
      AND conname = 'official_prices_review_version_check'
  ) THEN
    ALTER TABLE public.official_prices
      ADD CONSTRAINT official_prices_review_version_check
      CHECK (review_version BETWEEN 0 AND 9007199254740991)
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.official_agency_packages'::regclass
      AND conname = 'official_agency_packages_review_version_check'
  ) THEN
    ALTER TABLE public.official_agency_packages
      ADD CONSTRAINT official_agency_packages_review_version_check
      CHECK (review_version BETWEEN 0 AND 9007199254740991)
      NOT VALID;
  END IF;
END
$review_version_constraints$;

ALTER TABLE public.official_prices
  VALIDATE CONSTRAINT official_prices_review_version_check;
ALTER TABLE public.official_agency_packages
  VALIDATE CONSTRAINT official_agency_packages_review_version_check;

-- Audit records intentionally contain no source text, file path, object key or
-- preview key. A SHA-256 digest proves which submitted value set was reviewed
-- without duplicating unpublished evidence into another table.
CREATE TABLE IF NOT EXISTS public.official_review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_kind text NOT NULL,
  entity_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  action text NOT NULL,
  from_status text NOT NULL,
  to_status text NOT NULL,
  from_review_version bigint NOT NULL,
  to_review_version bigint NOT NULL,
  change_hash text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT official_review_events_entity_kind_check
    CHECK (entity_kind IN ('price', 'agency_package')),
  CONSTRAINT official_review_events_action_check
    CHECK (action IN ('save', 'approve', 'reject')),
  CONSTRAINT official_review_events_status_check
    CHECK (
      from_status IN ('pending', 'approved', 'rejected')
      AND to_status IN ('pending', 'approved', 'rejected')
    ),
  CONSTRAINT official_review_events_version_check
    CHECK (
      from_review_version >= 0
      AND to_review_version = from_review_version + 1
      AND to_review_version <= 9007199254740991
    ),
  CONSTRAINT official_review_events_change_hash_check
    CHECK (change_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT official_review_events_entity_version_key
    UNIQUE (entity_kind, entity_id, to_review_version)
);

CREATE INDEX IF NOT EXISTS official_review_events_entity_timeline_idx
  ON public.official_review_events (
    entity_kind,
    entity_id,
    occurred_at,
    id
  );

CREATE OR REPLACE FUNCTION public.guard_official_review_event_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $guard_official_review_event_append_only$
BEGIN
  RAISE EXCEPTION 'OFFICIAL_REVIEW_EVENT_APPEND_ONLY'
    USING ERRCODE = '55000';
END
$guard_official_review_event_append_only$;

ALTER FUNCTION public.guard_official_review_event_append_only()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_official_review_event_append_only()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS official_review_events_append_only
  ON public.official_review_events;
CREATE TRIGGER official_review_events_append_only
BEFORE UPDATE OR DELETE ON public.official_review_events
FOR EACH ROW
EXECUTE FUNCTION public.guard_official_review_event_append_only();

DROP TRIGGER IF EXISTS official_review_events_no_truncate
  ON public.official_review_events;
CREATE TRIGGER official_review_events_no_truncate
BEFORE TRUNCATE ON public.official_review_events
FOR EACH STATEMENT
EXECUTE FUNCTION public.guard_official_review_event_append_only();

ALTER TABLE public.official_review_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.official_review_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.official_review_events
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.official_review_events TO service_role;

-- Canonical price CAS. It deliberately delegates all value, option and
-- provenance validation to the existing five-argument function. Nested
-- SECURITY DEFINER calls retain the postgres function owner, so the existing
-- option write fence and source-preview immutability remain in force.
CREATE OR REPLACE FUNCTION public.review_official_price(
  p_price_id uuid,
  p_actor_id uuid,
  p_action text,
  p_values jsonb,
  p_options jsonb,
  p_expected_review_version bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $review_official_price_cas$
DECLARE
  current_review_version bigint;
  current_review_status text;
  next_review_status text;
  submitted_change_hash text;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles AS actor_profile
    WHERE actor_profile.id = p_actor_id
      AND actor_profile.is_admin = true
  ) THEN
    RAISE EXCEPTION 'PRICE_REVIEW_ADMIN_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF p_expected_review_version IS NULL
    OR p_expected_review_version < 0
    OR p_expected_review_version > 9007199254740991
  THEN
    RAISE EXCEPTION 'PRICE_REVIEW_EXPECTED_VERSION_REQUIRED'
      USING ERRCODE = '22023';
  END IF;

  SELECT price.review_version, price.review_status
  INTO current_review_version, current_review_status
  FROM public.official_prices AS price
  WHERE price.id = p_price_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRICE_REVIEW_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  IF current_review_version <> p_expected_review_version THEN
    RAISE EXCEPTION 'PRICE_REVIEW_VERSION_CONFLICT'
      USING ERRCODE = '40001';
  END IF;

  IF current_review_version = 9007199254740991 THEN
    RAISE EXCEPTION 'PRICE_REVIEW_VERSION_EXHAUSTED'
      USING ERRCODE = '54000';
  END IF;

  PERFORM set_config(
    'hanbang.review_official_price_parent_id',
    p_price_id::text,
    true
  );

  PERFORM public.review_official_price(
    p_price_id,
    p_actor_id,
    p_action,
    p_values,
    p_options
  );

  UPDATE public.official_prices AS price
  SET review_version = current_review_version + 1
  WHERE price.id = p_price_id
  RETURNING price.review_status INTO next_review_status;

  submitted_change_hash := current_setting(
    'hanbang.review_official_price_change_hash',
    true
  );
  IF submitted_change_hash IS NULL
    OR submitted_change_hash !~ '^[0-9a-f]{64}$'
  THEN
    submitted_change_hash := encode(
      extensions.digest(
        jsonb_build_object(
          'action', p_action,
          'values', p_values,
          'options', p_options
        )::text,
        'sha256'
      ),
      'hex'
    );
  END IF;

  INSERT INTO public.official_review_events (
    entity_kind,
    entity_id,
    actor_id,
    action,
    from_status,
    to_status,
    from_review_version,
    to_review_version,
    change_hash
  ) VALUES (
    'price',
    p_price_id,
    p_actor_id,
    p_action,
    current_review_status,
    next_review_status,
    current_review_version,
    current_review_version + 1,
    submitted_change_hash
  );

  PERFORM set_config('hanbang.review_official_price_parent_id', '', true);
  PERFORM set_config('hanbang.review_official_price_change_hash', '', true);
END
$review_official_price_cas$;

ALTER FUNCTION public.review_official_price(
  uuid, uuid, text, jsonb, jsonb, bigint
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.review_official_price(
  uuid, uuid, text, jsonb, jsonb, bigint
) FROM PUBLIC, anon, authenticated, service_role;

-- Package review uses the same compare-and-swap contract. The service role can
-- call this overload directly because packages do not have the price alias
-- proposal wrapper.
CREATE OR REPLACE FUNCTION public.review_official_agency_package(
  p_package_id uuid,
  p_actor_id uuid,
  p_action text,
  p_values jsonb,
  p_options jsonb,
  p_expected_review_version bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $review_official_agency_package_cas$
DECLARE
  current_review_version bigint;
  current_review_status text;
  next_review_status text;
  submitted_change_hash text;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles AS actor_profile
    WHERE actor_profile.id = p_actor_id
      AND actor_profile.is_admin = true
  ) THEN
    RAISE EXCEPTION 'AGENCY_PACKAGE_REVIEW_ADMIN_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF p_expected_review_version IS NULL
    OR p_expected_review_version < 0
    OR p_expected_review_version > 9007199254740991
  THEN
    RAISE EXCEPTION 'AGENCY_PACKAGE_REVIEW_EXPECTED_VERSION_REQUIRED'
      USING ERRCODE = '22023';
  END IF;

  submitted_change_hash := encode(
    extensions.digest(
      jsonb_build_object(
        'action', p_action,
        'values', p_values,
        'options', p_options
      )::text,
      'sha256'
    ),
    'hex'
  );

  SELECT package_row.review_version, package_row.review_status
  INTO current_review_version, current_review_status
  FROM public.official_agency_packages AS package_row
  WHERE package_row.id = p_package_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AGENCY_PACKAGE_REVIEW_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  IF current_review_version <> p_expected_review_version THEN
    IF current_review_version = p_expected_review_version + 1
      AND EXISTS (
        SELECT 1
        FROM public.official_review_events AS review_event
        WHERE review_event.entity_kind = 'agency_package'
          AND review_event.entity_id = p_package_id
          AND review_event.actor_id = p_actor_id
          AND review_event.action = p_action
          AND review_event.from_review_version = p_expected_review_version
          AND review_event.to_review_version = current_review_version
          AND review_event.change_hash = submitted_change_hash
      )
    THEN
      RETURN;
    END IF;

    RAISE EXCEPTION 'AGENCY_PACKAGE_REVIEW_VERSION_CONFLICT'
      USING ERRCODE = '40001';
  END IF;

  IF current_review_version = 9007199254740991 THEN
    RAISE EXCEPTION 'AGENCY_PACKAGE_REVIEW_VERSION_EXHAUSTED'
      USING ERRCODE = '54000';
  END IF;

  PERFORM set_config(
    'hanbang.review_official_agency_package_parent_id',
    p_package_id::text,
    true
  );

  PERFORM public.review_official_agency_package(
    p_package_id,
    p_actor_id,
    p_action,
    p_values,
    p_options
  );

  UPDATE public.official_agency_packages AS package_row
  SET review_version = current_review_version + 1
  WHERE package_row.id = p_package_id
  RETURNING package_row.review_status INTO next_review_status;

  INSERT INTO public.official_review_events (
    entity_kind,
    entity_id,
    actor_id,
    action,
    from_status,
    to_status,
    from_review_version,
    to_review_version,
    change_hash
  ) VALUES (
    'agency_package',
    p_package_id,
    p_actor_id,
    p_action,
    current_review_status,
    next_review_status,
    current_review_version,
    current_review_version + 1,
    submitted_change_hash
  );

  PERFORM set_config(
    'hanbang.review_official_agency_package_parent_id',
    '',
    true
  );
END
$review_official_agency_package_cas$;

ALTER FUNCTION public.review_official_agency_package(
  uuid, uuid, text, jsonb, jsonb, bigint
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.review_official_agency_package(
  uuid, uuid, text, jsonb, jsonb, bigint
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.review_official_agency_package(
  uuid, uuid, text, jsonb, jsonb, bigint
) TO service_role;

-- Final price entry point: preserve the alias proposal transaction and route
-- its price mutation through the canonical CAS overload above.
CREATE OR REPLACE FUNCTION public.review_official_price_with_alias_proposals(
  p_price_id uuid,
  p_actor_id uuid,
  p_action text,
  p_values jsonb,
  p_options jsonb,
  p_selected_proposal_ids uuid[],
  p_expected_review_version bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $review_official_price_with_alias_proposals_cas$
DECLARE
  discovered_vendor_id uuid;
  current_vendor_id uuid;
  current_review_version bigint;
  proposal_row record;
  decision_time timestamptz := statement_timestamp();
  approved_aliases text[] := '{}'::text[];
  requested_change_hash text;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles AS actor_profile
    WHERE actor_profile.id = p_actor_id
      AND actor_profile.is_admin = true
  ) THEN
    RAISE EXCEPTION 'PRICE_ALIAS_REVIEW_ADMIN_REQUIRED'
      USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('save', 'approve', 'reject') THEN
    RAISE EXCEPTION 'PRICE_ALIAS_REVIEW_INVALID_ACTION'
      USING ERRCODE = '22023';
  END IF;
  IF p_expected_review_version IS NULL
    OR p_expected_review_version < 0
    OR p_expected_review_version > 9007199254740991
  THEN
    RAISE EXCEPTION 'PRICE_REVIEW_EXPECTED_VERSION_REQUIRED'
      USING ERRCODE = '22023';
  END IF;
  IF p_selected_proposal_ids IS NULL
    OR cardinality(p_selected_proposal_ids) > 100
    OR EXISTS (
      SELECT 1
      FROM unnest(p_selected_proposal_ids) AS selected(id)
      WHERE id IS NULL
    )
    OR cardinality(p_selected_proposal_ids) <> (
      SELECT count(DISTINCT selected.id)::integer
      FROM unnest(p_selected_proposal_ids) AS selected(id)
    )
  THEN
    RAISE EXCEPTION 'PRICE_ALIAS_REVIEW_INVALID_SELECTION'
      USING ERRCODE = '22023';
  END IF;
  IF p_action IN ('save', 'reject')
    AND cardinality(p_selected_proposal_ids) <> 0
  THEN
    RAISE EXCEPTION 'PRICE_ALIAS_REVIEW_SELECTION_FORBIDDEN'
      USING ERRCODE = '22023';
  END IF;

  requested_change_hash := encode(
    extensions.digest(
      jsonb_build_object(
        'action', p_action,
        'values', p_values,
        'options', p_options,
        'selected_alias_proposal_ids', to_jsonb(p_selected_proposal_ids)
      )::text,
      'sha256'
    ),
    'hex'
  );

  PERFORM pg_advisory_xact_lock(
    hashtext('official_price_alias_review:' || p_price_id::text)::bigint
  );

  -- Vendor dedupe locks vendors before moving their prices. Discover the
  -- current relationship without a row lock, then acquire the same
  -- vendor -> price order. If a concurrent merge changes the relationship
  -- while we wait, fail with a retryable serialization conflict instead of
  -- reviewing against a stale vendor or creating a vendor <-> price deadlock.
  SELECT price.vendor_id
  INTO discovered_vendor_id
  FROM public.official_prices AS price
  WHERE price.id = p_price_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRICE_REVIEW_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;
  IF discovered_vendor_id IS NOT NULL THEN
    PERFORM 1
    FROM public.vendors AS vendor
    WHERE vendor.id = discovered_vendor_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRICE_ALIAS_REVIEW_VENDOR_NOT_FOUND'
      USING ERRCODE = 'P0002';
    END IF;
  END IF;
  SELECT price.vendor_id, price.review_version
  INTO current_vendor_id, current_review_version
  FROM public.official_prices AS price
  WHERE price.id = p_price_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRICE_REVIEW_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;
  IF current_vendor_id IS DISTINCT FROM discovered_vendor_id THEN
    RAISE EXCEPTION 'PRICE_ALIAS_REVIEW_VENDOR_CHANGED_RETRY'
      USING ERRCODE = '40001';
  END IF;
  FOR proposal_row IN
    SELECT proposal.id
    FROM public.vendor_alias_proposals AS proposal
    WHERE proposal.official_price_id = p_price_id
    ORDER BY proposal.id
    FOR UPDATE
  LOOP
    NULL;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM unnest(p_selected_proposal_ids) AS selected(id)
    LEFT JOIN public.vendor_alias_proposals AS proposal
      ON proposal.id = selected.id
      AND proposal.official_price_id = p_price_id
      AND proposal.vendor_id = current_vendor_id
    WHERE proposal.id IS NULL
  ) THEN
    RAISE EXCEPTION 'PRICE_ALIAS_REVIEW_SELECTION_OUT_OF_SCOPE'
      USING ERRCODE = '22023';
  END IF;

  -- A transport retry of the exact same committed request is a no-op. It is
  -- accepted only for the immediately following version, with the same actor,
  -- action, canonical payload hash, and the same final proposal decisions.
  IF current_review_version <> p_expected_review_version THEN
    IF current_review_version = p_expected_review_version + 1
      AND EXISTS (
        SELECT 1
        FROM public.official_review_events AS review_event
        WHERE review_event.entity_kind = 'price'
          AND review_event.entity_id = p_price_id
          AND review_event.actor_id = p_actor_id
          AND review_event.action = p_action
          AND review_event.from_review_version = p_expected_review_version
          AND review_event.to_review_version = current_review_version
          AND review_event.change_hash = requested_change_hash
      )
      AND (
        p_action = 'save'
        OR NOT EXISTS (
          SELECT 1
          FROM public.vendor_alias_proposals AS proposal
          WHERE proposal.official_price_id = p_price_id
            AND proposal.status IS DISTINCT FROM CASE
              WHEN p_action = 'approve'
                AND proposal.id = ANY(p_selected_proposal_ids)
                THEN 'approved'
              ELSE 'rejected'
            END
        )
      )
    THEN
      RETURN;
    END IF;

    RAISE EXCEPTION 'PRICE_REVIEW_VERSION_CONFLICT'
      USING ERRCODE = '40001';
  END IF;

  IF p_action IN ('approve', 'reject') AND EXISTS (
    SELECT 1
    FROM public.vendor_alias_proposals AS proposal
    WHERE proposal.official_price_id = p_price_id
      AND proposal.status <> 'pending'
      AND proposal.status <> CASE
        WHEN p_action = 'approve'
          AND proposal.id = ANY(p_selected_proposal_ids)
          THEN 'approved'
        ELSE 'rejected'
      END
  ) THEN
    RAISE EXCEPTION 'PRICE_ALIAS_REVIEW_CONFLICTING_REPLAY'
      USING ERRCODE = '55000';
  END IF;

  PERFORM set_config(
    'hanbang.review_official_price_change_hash',
    requested_change_hash,
    true
  );

  PERFORM public.review_official_price(
    p_price_id,
    p_actor_id,
    p_action,
    p_values,
    p_options,
    p_expected_review_version
  );

  IF p_action IN ('approve', 'reject') THEN
    UPDATE public.vendor_alias_proposals AS proposal
    SET status = CASE
          WHEN p_action = 'approve'
            AND proposal.id = ANY(p_selected_proposal_ids)
            THEN 'approved'
          ELSE 'rejected'
        END,
        reviewed_by = p_actor_id,
        reviewed_at = decision_time
    WHERE proposal.official_price_id = p_price_id
      AND proposal.status = 'pending';
  END IF;

  IF p_action = 'approve' THEN
    SELECT COALESCE(
      array_agg(proposal.alias ORDER BY proposal.id),
      '{}'::text[]
    )
    INTO approved_aliases
    FROM public.vendor_alias_proposals AS proposal
    WHERE proposal.official_price_id = p_price_id
      AND proposal.id = ANY(p_selected_proposal_ids)
      AND proposal.status = 'approved';
    IF cardinality(approved_aliases) > 0 THEN
      IF current_vendor_id IS NULL THEN
        RAISE EXCEPTION 'PRICE_ALIAS_REVIEW_VENDOR_REQUIRED'
          USING ERRCODE = '22023';
      END IF;
      PERFORM public.merge_vendor_aliases(current_vendor_id, approved_aliases);
    END IF;
  END IF;
END
$review_official_price_with_alias_proposals_cas$;

ALTER FUNCTION public.review_official_price_with_alias_proposals(
  uuid, uuid, text, jsonb, jsonb, uuid[], bigint
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.review_official_price_with_alias_proposals(
  uuid, uuid, text, jsonb, jsonb, uuid[], bigint
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.review_official_price_with_alias_proposals(
  uuid, uuid, text, jsonb, jsonb, uuid[], bigint
) TO service_role;

-- Remove every older service-callable path so expected version cannot be
-- omitted. Postgres-owned wrappers remain able to call their inner functions.
REVOKE EXECUTE ON FUNCTION public.review_official_price(
  uuid, uuid, text, jsonb, jsonb
) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.review_official_agency_package(
  uuid, uuid, text, jsonb, jsonb
) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.review_official_price_with_alias_proposals(
  uuid, uuid, text, jsonb, jsonb, uuid[]
) FROM service_role;

-- The foundation grants service_role broad staging-table DML for ingestion.
-- Preserve virgin pending partial-recovery writes, but once an admin review has
-- touched a row, every business/evidence/review mutation must carry the CAS
-- token through the postgres-owned review function. A custom GUC alone is not
-- a bypass: the trigger also checks current_user against the function owner.
CREATE OR REPLACE FUNCTION public.guard_official_review_parent_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $guard_official_review_parent_write$
DECLARE
  review_function_owner name;
  review_context text;
  row_id uuid;
  old_is_virgin_pending boolean := false;
  new_is_virgin_pending boolean := false;
BEGIN
  IF TG_TABLE_NAME = 'official_prices' THEN
    SELECT pg_catalog.pg_get_userbyid(function_row.proowner)
    INTO review_function_owner
    FROM pg_catalog.pg_proc AS function_row
    WHERE function_row.oid =
      'public.review_official_price(uuid,uuid,text,jsonb,jsonb,bigint)'::regprocedure;
    review_context := current_setting(
      'hanbang.review_official_price_parent_id',
      true
    );
  ELSIF TG_TABLE_NAME = 'official_agency_packages' THEN
    SELECT pg_catalog.pg_get_userbyid(function_row.proowner)
    INTO review_function_owner
    FROM pg_catalog.pg_proc AS function_row
    WHERE function_row.oid =
      'public.review_official_agency_package(uuid,uuid,text,jsonb,jsonb,bigint)'::regprocedure;
    review_context := current_setting(
      'hanbang.review_official_agency_package_parent_id',
      true
    );
  ELSE
    RAISE EXCEPTION 'OFFICIAL_REVIEW_PARENT_TABLE_UNSUPPORTED'
      USING ERRCODE = '55000';
  END IF;

  row_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  IF current_user = review_function_owner
    AND review_context = row_id::text
  THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    old_is_virgin_pending :=
      OLD.review_status = 'pending'
      AND OLD.edited_by_admin = false
      AND OLD.reviewed_by IS NULL
      AND OLD.reviewed_at IS NULL
      AND OLD.review_action IS NULL
      AND OLD.review_version = 0;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    new_is_virgin_pending :=
      NEW.review_status = 'pending'
      AND NEW.edited_by_admin = false
      AND NEW.reviewed_by IS NULL
      AND NEW.reviewed_at IS NULL
      AND NEW.review_action IS NULL
      AND NEW.review_version = 0;
  END IF;

  IF TG_OP = 'INSERT' AND new_is_virgin_pending THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
    AND old_is_virgin_pending
    AND new_is_virgin_pending
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'OFFICIAL_REVIEW_PARENT_WRITE_RPC_REQUIRED'
    USING ERRCODE = '42501';
END
$guard_official_review_parent_write$;

ALTER FUNCTION public.guard_official_review_parent_write() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_official_review_parent_write()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS official_prices_parent_review_write_fence
  ON public.official_prices;
CREATE TRIGGER official_prices_parent_review_write_fence
BEFORE INSERT OR UPDATE OF
  snapshot_id,
  category,
  item_name,
  base_spec,
  price_min_krw,
  price_max_krw,
  vat_note,
  price_note,
  review_status,
  needs_review,
  validation_issue_codes,
  source_file,
  source_quote,
  source_object_keys,
  source_preview_keys,
  source_record_key,
  confidence,
  edited_by_admin,
  reviewed_by,
  reviewed_at,
  review_action,
  review_version
OR DELETE ON public.official_prices
FOR EACH ROW
EXECUTE FUNCTION public.guard_official_review_parent_write();

DROP TRIGGER IF EXISTS official_agency_packages_parent_review_write_fence
  ON public.official_agency_packages;
CREATE TRIGGER official_agency_packages_parent_review_write_fence
BEFORE INSERT OR UPDATE OF
  snapshot_id,
  package_name,
  category_scope,
  price_min_krw,
  price_max_krw,
  vat_note,
  price_note,
  options,
  review_status,
  needs_review,
  validation_issue_codes,
  source_file,
  source_quote,
  source_object_keys,
  source_preview_keys,
  confidence,
  edited_by_admin,
  reviewed_by,
  reviewed_at,
  review_action,
  review_version
OR DELETE ON public.official_agency_packages
FOR EACH ROW
EXECUTE FUNCTION public.guard_official_review_parent_write();

COMMENT ON COLUMN public.official_prices.review_version IS
  'Opaque optimistic-concurrency token; clients must echo the latest value.';
COMMENT ON COLUMN public.official_agency_packages.review_version IS
  'Opaque optimistic-concurrency token; clients must echo the latest value.';
COMMENT ON FUNCTION public.review_official_price_with_alias_proposals(
  uuid, uuid, text, jsonb, jsonb, uuid[], bigint
) IS 'Atomically reviews price/options/aliases only when expected review_version matches.';

COMMIT;
