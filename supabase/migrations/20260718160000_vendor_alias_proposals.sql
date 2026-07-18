-- Extracted historical names are untrusted evidence. They are staged privately
-- and may reach vendors.aliases only through an explicit admin price review.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE UNIQUE INDEX IF NOT EXISTS official_prices_alias_proposal_vendor_identity_idx
  ON public.official_prices (id, vendor_id);

CREATE TABLE IF NOT EXISTS public.vendor_alias_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  official_price_id uuid NOT NULL,
  vendor_id uuid NOT NULL,
  alias text NOT NULL,
  normalized_alias text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vendor_alias_proposals_price_vendor_fkey
    FOREIGN KEY (official_price_id, vendor_id)
    REFERENCES public.official_prices(id, vendor_id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  CONSTRAINT vendor_alias_proposals_alias_shape_check CHECK (
    alias = btrim(alias)
    AND length(alias) BETWEEN 1 AND 200
    AND normalized_alias = btrim(normalized_alias)
    AND length(normalized_alias) BETWEEN 1 AND 200
    AND normalized_alias = lower(normalized_alias)
    AND normalized_alias !~ '[^0-9a-z가-힣]'
  ),
  CONSTRAINT vendor_alias_proposals_status_check CHECK (
    status IN ('pending', 'approved', 'rejected')
  ),
  CONSTRAINT vendor_alias_proposals_review_audit_check CHECK (
    (status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (status IN ('approved', 'rejected') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  ),
  CONSTRAINT vendor_alias_proposals_price_identity_key
    UNIQUE (official_price_id, normalized_alias)
);

CREATE INDEX IF NOT EXISTS vendor_alias_proposals_pending_queue_idx
  ON public.vendor_alias_proposals (status, created_at, id);
CREATE INDEX IF NOT EXISTS vendor_alias_proposals_vendor_status_idx
  ON public.vendor_alias_proposals (vendor_id, status, id);

CREATE OR REPLACE FUNCTION public.guard_vendor_alias_proposal_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $guard_vendor_alias_proposal_write$
DECLARE
  current_price_vendor_id uuid;
  current_price_review_status text;
  vendor_cascade_only boolean := false;
BEGIN
  SELECT price.vendor_id, price.review_status
  INTO current_price_vendor_id, current_price_review_status
  FROM public.official_prices AS price
  WHERE price.id = NEW.official_price_id;

  IF NOT FOUND OR current_price_vendor_id IS DISTINCT FROM NEW.vendor_id THEN
    RAISE EXCEPTION 'VENDOR_ALIAS_PROPOSAL_PRICE_VENDOR_MISMATCH'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF current_price_review_status <> 'pending' THEN
      RAISE EXCEPTION 'VENDOR_ALIAS_PROPOSAL_PRICE_ALREADY_REVIEWED'
        USING ERRCODE = '55000';
    END IF;
    IF NEW.status <> 'pending' OR NEW.reviewed_by IS NOT NULL OR NEW.reviewed_at IS NOT NULL THEN
      RAISE EXCEPTION 'VENDOR_ALIAS_PROPOSAL_MUST_START_PENDING'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  vendor_cascade_only :=
    OLD.vendor_id IS DISTINCT FROM NEW.vendor_id
    AND OLD.official_price_id = NEW.official_price_id
    AND OLD.alias = NEW.alias
    AND OLD.normalized_alias = NEW.normalized_alias
    AND OLD.status = NEW.status
    AND OLD.reviewed_by IS NOT DISTINCT FROM NEW.reviewed_by
    AND OLD.reviewed_at IS NOT DISTINCT FROM NEW.reviewed_at
    AND OLD.created_at = NEW.created_at
    AND OLD.updated_at = NEW.updated_at;
  IF vendor_cascade_only THEN
    -- Canonical vendor merge updates official_prices.vendor_id first; the
    -- composite FK then carries the private proposal without changing its
    -- content or review decision.
    RETURN NEW;
  END IF;

  IF OLD.official_price_id <> NEW.official_price_id
    OR OLD.vendor_id <> NEW.vendor_id
    OR OLD.alias <> NEW.alias
    OR OLD.normalized_alias <> NEW.normalized_alias
    OR OLD.created_at <> NEW.created_at
  THEN
    RAISE EXCEPTION 'VENDOR_ALIAS_PROPOSAL_IDENTITY_IMMUTABLE'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status <> 'pending' THEN
    IF NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'VENDOR_ALIAS_PROPOSAL_REVIEWED_IMMUTABLE'
        USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.status = 'pending' THEN
    IF NEW.reviewed_by IS NOT NULL OR NEW.reviewed_at IS NOT NULL THEN
      RAISE EXCEPTION 'VENDOR_ALIAS_PROPOSAL_PENDING_AUDIT_FORBIDDEN'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.status IN ('approved', 'rejected') THEN
    IF NEW.reviewed_by IS NULL OR NEW.reviewed_at IS NULL THEN
      RAISE EXCEPTION 'VENDOR_ALIAS_PROPOSAL_REVIEW_AUDIT_REQUIRED'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'VENDOR_ALIAS_PROPOSAL_INVALID_STATUS'
      USING ERRCODE = '22023';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$guard_vendor_alias_proposal_write$;

ALTER FUNCTION public.guard_vendor_alias_proposal_write() OWNER TO postgres;

DROP TRIGGER IF EXISTS guard_vendor_alias_proposal_write
  ON public.vendor_alias_proposals;
CREATE TRIGGER guard_vendor_alias_proposal_write
BEFORE INSERT OR UPDATE ON public.vendor_alias_proposals
FOR EACH ROW EXECUTE FUNCTION public.guard_vendor_alias_proposal_write();

ALTER TABLE public.vendor_alias_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_alias_proposals FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.vendor_alias_proposals
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.vendor_alias_proposals TO service_role;
REVOKE ALL ON FUNCTION public.guard_vendor_alias_proposal_write()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.review_official_price_with_alias_proposals(
  p_price_id uuid,
  p_actor_id uuid,
  p_action text,
  p_values jsonb,
  p_options jsonb,
  p_selected_proposal_ids uuid[] DEFAULT '{}'::uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $review_official_price_with_alias_proposals$
DECLARE
  current_vendor_id uuid;
  proposal_row record;
  decision_time timestamptz := statement_timestamp();
  approved_aliases text[] := '{}'::text[];
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
  IF p_selected_proposal_ids IS NULL
    OR cardinality(p_selected_proposal_ids) > 100
    OR EXISTS (SELECT 1 FROM unnest(p_selected_proposal_ids) AS selected(id) WHERE id IS NULL)
    OR cardinality(p_selected_proposal_ids) <> (
      SELECT count(DISTINCT selected.id)::integer
      FROM unnest(p_selected_proposal_ids) AS selected(id)
    )
  THEN
    RAISE EXCEPTION 'PRICE_ALIAS_REVIEW_INVALID_SELECTION'
      USING ERRCODE = '22023';
  END IF;
  IF p_action IN ('save', 'reject') AND cardinality(p_selected_proposal_ids) <> 0 THEN
    RAISE EXCEPTION 'PRICE_ALIAS_REVIEW_SELECTION_FORBIDDEN'
      USING ERRCODE = '22023';
  END IF;

  -- The advisory fence serializes the wrapper before its deterministic row
  -- lock order: price, vendor, then proposals by UUID.
  PERFORM pg_advisory_xact_lock(hashtext('official_price_alias_review:' || p_price_id::text)::bigint);
  SELECT price.vendor_id
  INTO current_vendor_id
  FROM public.official_prices AS price
  WHERE price.id = p_price_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRICE_REVIEW_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;
  IF current_vendor_id IS NOT NULL THEN
    PERFORM 1
    FROM public.vendors AS vendor
    WHERE vendor.id = current_vendor_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRICE_ALIAS_REVIEW_VENDOR_NOT_FOUND'
        USING ERRCODE = 'P0002';
    END IF;
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

  IF p_action IN ('approve', 'reject') AND EXISTS (
    SELECT 1
    FROM public.vendor_alias_proposals AS proposal
    WHERE proposal.official_price_id = p_price_id
      AND proposal.status <> 'pending'
      AND proposal.status <> CASE
        WHEN p_action = 'approve' AND proposal.id = ANY(p_selected_proposal_ids)
          THEN 'approved'
        ELSE 'rejected'
      END
  ) THEN
    RAISE EXCEPTION 'PRICE_ALIAS_REVIEW_CONFLICTING_REPLAY'
      USING ERRCODE = '55000';
  END IF;

  -- The existing review function performs the full price/option provenance
  -- validation. A failure rolls back proposal decisions and alias union too.
  PERFORM public.review_official_price(
    p_price_id,
    p_actor_id,
    p_action,
    p_values,
    p_options
  );

  IF p_action IN ('approve', 'reject') THEN
    UPDATE public.vendor_alias_proposals AS proposal
    SET status = CASE
          WHEN p_action = 'approve' AND proposal.id = ANY(p_selected_proposal_ids)
            THEN 'approved'
          ELSE 'rejected'
        END,
        reviewed_by = p_actor_id,
        reviewed_at = decision_time
    WHERE proposal.official_price_id = p_price_id
      AND proposal.status = 'pending';
  END IF;

  IF p_action = 'approve' THEN
    SELECT COALESCE(array_agg(proposal.alias ORDER BY proposal.id), '{}'::text[])
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
END;
$review_official_price_with_alias_proposals$;

ALTER FUNCTION public.review_official_price_with_alias_proposals(
  uuid, uuid, text, jsonb, jsonb, uuid[]
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.review_official_price_with_alias_proposals(
  uuid, uuid, text, jsonb, jsonb, uuid[]
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_official_price_with_alias_proposals(
  uuid, uuid, text, jsonb, jsonb, uuid[]
) TO service_role;

-- Close legacy service-role bypasses. The postgres-owned wrapper can still call
-- both functions inside its single transaction.
REVOKE EXECUTE ON FUNCTION public.review_official_price(
  uuid, uuid, text, jsonb, jsonb
) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.merge_vendor_aliases(uuid, text[])
  FROM service_role;

COMMENT ON TABLE public.vendor_alias_proposals IS
  'Private, untrusted old-name proposals staged from disclosure extraction; never public.';
COMMENT ON FUNCTION public.review_official_price_with_alias_proposals(
  uuid, uuid, text, jsonb, jsonb, uuid[]
) IS 'Atomically reviews a price and explicitly decides its staged alias proposals.';

COMMIT;
