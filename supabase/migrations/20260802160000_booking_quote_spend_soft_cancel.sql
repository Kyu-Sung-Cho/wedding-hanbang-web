BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Existing booking rows may represent pre-boundary marketplace state. Only a
-- row whose vendor_delivery_status is `not_sent` is a private Amora intent.
-- `amount` remains quote/provenance only; only `actual_amount` may contribute
-- to recorded spend. Cancellation audit data is persisted on the row so an
-- outbox retry never invents a different actor or time.
ALTER TABLE public.vendor_bookings
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by_profile_id uuid,
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS contracted_amount numeric,
  ADD COLUMN IF NOT EXISTS intent_created_by_profile_id uuid,
  ADD COLUMN IF NOT EXISTS intent_vendor_name_snapshot text,
  ADD COLUMN IF NOT EXISTS intent_vendor_category_snapshot text,
  ADD COLUMN IF NOT EXISTS intent_product_name_snapshot text,
  ADD COLUMN IF NOT EXISTS vendor_delivery_status text;

-- Existing rows predate the Amora-internal intent boundary. Keep their prior
-- marketplace visibility/capacity semantics, but do not claim that delivery
-- was ever observed. Only the new, separately named intent RPC writes
-- `not_sent`.
UPDATE public.vendor_bookings
SET vendor_delivery_status = 'legacy_unknown'
WHERE vendor_delivery_status IS NULL;

ALTER TABLE public.vendor_bookings
  ALTER COLUMN vendor_delivery_status SET DEFAULT 'legacy_unknown',
  ALTER COLUMN vendor_delivery_status SET NOT NULL;

DO $delivery_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.vendor_bookings'::regclass
      AND conname = 'vendor_bookings_delivery_status_check'
  ) THEN
    ALTER TABLE public.vendor_bookings
      ADD CONSTRAINT vendor_bookings_delivery_status_check
      CHECK (vendor_delivery_status IN ('legacy_unknown', 'not_sent'));
  END IF;
END;
$delivery_constraint$;

COMMENT ON COLUMN public.vendor_bookings.vendor_delivery_status IS
  'legacy_unknown preserves pre-boundary behavior; not_sent is a private Amora intent that is vendor-invisible and capacity-neutral. Immutable until a future audited submit RPC exists.';
COMMENT ON COLUMN public.vendor_bookings.intent_created_by_profile_id IS
  'Immutable current-couple actor who created a not_sent Amora intent. Exact partner retries never rewrite this audit identity.';

ALTER TABLE public.booking_projection_jobs
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS review_reason text;

-- A private intent remains visible to its current couple, never to the vendor.
-- Direct authenticated INSERT is closed: service-only atomic RPCs own booking
-- identity, financial truth, and decision audit creation.
ALTER TABLE public.vendor_bookings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_bookings_select ON public.vendor_bookings;
DROP POLICY IF EXISTS vendor_bookings_insert ON public.vendor_bookings;
DROP POLICY IF EXISTS vendor_bookings_update ON public.vendor_bookings;

DO $booking_policies$
DECLARE
  v_vendor_has_owner boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'vendors'
      AND column_name = 'owner_id'
  ) INTO v_vendor_has_owner;

  IF v_vendor_has_owner THEN
    EXECUTE $policy$CREATE POLICY vendor_bookings_select
      ON public.vendor_bookings FOR SELECT TO authenticated
      USING (
        public.is_couple_member(couple_id)
        OR (
          vendor_delivery_status <> 'not_sent'
          AND public.is_vendor_owner(vendor_id)
        )
      )$policy$;
    EXECUTE $policy$CREATE POLICY vendor_bookings_update
      ON public.vendor_bookings FOR UPDATE TO authenticated
      USING (
        public.is_couple_member(couple_id)
        OR (
          vendor_delivery_status <> 'not_sent'
          AND public.is_vendor_owner(vendor_id)
        )
      )
      WITH CHECK (
        public.is_couple_member(couple_id)
        OR (
          vendor_delivery_status <> 'not_sent'
          AND public.is_vendor_owner(vendor_id)
        )
      )$policy$;
  ELSE
    CREATE POLICY vendor_bookings_select
      ON public.vendor_bookings FOR SELECT TO authenticated
      USING (public.is_couple_member(couple_id));
    CREATE POLICY vendor_bookings_update
      ON public.vendor_bookings FOR UPDATE TO authenticated
      USING (public.is_couple_member(couple_id))
      WITH CHECK (public.is_couple_member(couple_id));
  END IF;

  CREATE POLICY vendor_bookings_insert
    ON public.vendor_bookings FOR INSERT TO authenticated
    WITH CHECK (false);
END;
$booking_policies$;

COMMENT ON COLUMN public.vendor_bookings.amount IS
  'Internal booking-request quote. Not proof of vendor delivery, confirmation, payment, or recorded spend.';
COMMENT ON COLUMN public.vendor_bookings.actual_amount IS
  'Explicitly recorded actual spend. The only vendor_booking amount eligible for budget spent projection.';
COMMENT ON COLUMN public.vendor_bookings.cancelled_at IS
  'Server-recorded time when the Amora internal booking record was marked cancelled; not proof of vendor cancellation.';
COMMENT ON COLUMN public.vendor_bookings.cancelled_by_profile_id IS
  'Verified couple-member profile that marked the Amora internal booking record cancelled.';

-- Cancellation membership is checked against the exact roster at issuance.
-- This private, immutable receipt then lets queued projection finish even if a
-- legitimately cancelling member later leaves the couple.
CREATE TABLE IF NOT EXISTS public.booking_cancellation_receipts (
  booking_id uuid PRIMARY KEY
    REFERENCES public.vendor_bookings(id) ON DELETE CASCADE,
  couple_id uuid NOT NULL,
  actor_profile_id uuid NOT NULL,
  cancelled_at timestamptz NOT NULL,
  issue_bride_id uuid,
  issue_groom_id uuid,
  issue_required_count smallint NOT NULL CHECK (
    issue_required_count IN (1, 2)
  ),
  roster_fingerprint text NOT NULL CHECK (
    roster_fingerprint ~ '^[a-f0-9]{32}$'
  ),
  vendor_id uuid NOT NULL,
  product_id uuid,
  staff_id uuid,
  booking_date date NOT NULL,
  booking_time time NOT NULL,
  quoted_amount numeric NOT NULL CHECK (quoted_amount >= 0),
  actual_amount numeric CHECK (actual_amount >= 0),
  cancel_reason text,
  snapshot_digest text NOT NULL CHECK (
    snapshot_digest ~ '^[a-f0-9]{64}$'
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (issue_required_count = 1
      AND num_nonnulls(issue_bride_id, issue_groom_id) = 1)
    OR (
      issue_required_count = 2
      AND issue_bride_id IS NOT NULL
      AND issue_groom_id IS NOT NULL
      AND issue_bride_id <> issue_groom_id
    )
  ),
  CHECK (
    actor_profile_id = issue_bride_id
    OR actor_profile_id = issue_groom_id
  )
);

ALTER TABLE public.booking_cancellation_receipts OWNER TO postgres;
ALTER TABLE public.booking_cancellation_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.booking_cancellation_receipts
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.booking_cancellation_write_authorizations (
  authorization_id uuid PRIMARY KEY,
  booking_id uuid NOT NULL,
  couple_id uuid NOT NULL,
  actor_profile_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.booking_cancellation_write_authorizations OWNER TO postgres;
ALTER TABLE public.booking_cancellation_write_authorizations
  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.booking_cancellation_write_authorizations
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.booking_intent_write_authorizations (
  authorization_id uuid PRIMARY KEY,
  booking_id uuid NOT NULL,
  couple_id uuid NOT NULL,
  actor_profile_id uuid NOT NULL,
  vendor_id uuid NOT NULL,
  product_id uuid,
  staff_id uuid,
  booking_date date NOT NULL,
  booking_time time NOT NULL,
  quoted_amount numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS public.booking_outcome_write_authorizations (
  authorization_id uuid PRIMARY KEY,
  booking_id uuid NOT NULL,
  couple_id uuid NOT NULL,
  actor_profile_id uuid NOT NULL,
  actual_amount numeric NOT NULL,
  contracted_amount numeric,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.booking_intent_write_authorizations OWNER TO postgres;
ALTER TABLE public.booking_outcome_write_authorizations OWNER TO postgres;
ALTER TABLE public.booking_intent_write_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_outcome_write_authorizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.booking_intent_write_authorizations
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.booking_outcome_write_authorizations
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.authorize_booking_protected_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '5s'
AS $function$
DECLARE
  v_authorization_text text;
  v_authorization_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.vendor_delivery_status <> 'not_sent' THEN
      -- PostgreSQL-owner maintenance remains possible, but application roles
      -- cannot mint vendor-visible/capacity rows without a future submit RPC.
      IF auth.role() IS NOT NULL THEN
        RAISE EXCEPTION 'booking_external_submit_rpc_unavailable'
          USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
    v_authorization_text := current_setting(
      'hanbang.booking_intent_authorization_id',
      true
    );
    IF auth.role() IS DISTINCT FROM 'service_role'
       OR NEW.status IS DISTINCT FROM 'pending'
       OR COALESCE(v_authorization_text, '') !~
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'booking_intent_rpc_required'
        USING ERRCODE = '42501';
    END IF;
    v_authorization_id := v_authorization_text::uuid;
    DELETE FROM public.booking_intent_write_authorizations AS authz
    WHERE authz.authorization_id = v_authorization_id
      AND authz.booking_id = NEW.id
      AND authz.couple_id = NEW.couple_id
      AND authz.vendor_id = NEW.vendor_id
      AND authz.product_id IS NOT DISTINCT FROM NEW.product_id
      AND authz.staff_id IS NOT DISTINCT FROM NEW.staff_id
      AND authz.booking_date = NEW.booking_date
      AND authz.booking_time = NEW.booking_time
      AND authz.actor_profile_id = NEW.intent_created_by_profile_id
      AND authz.quoted_amount = greatest(COALESCE(NEW.amount, 0), 0);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'booking_intent_rpc_required'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.vendor_delivery_status IS DISTINCT FROM OLD.vendor_delivery_status THEN
    RAISE EXCEPTION 'booking_delivery_status_immutable'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.vendor_id IS NOT DISTINCT FROM OLD.vendor_id
     AND NEW.couple_id IS NOT DISTINCT FROM OLD.couple_id
     AND NEW.product_id IS NOT DISTINCT FROM OLD.product_id
     AND NEW.staff_id IS NOT DISTINCT FROM OLD.staff_id
     AND NEW.booking_date IS NOT DISTINCT FROM OLD.booking_date
     AND NEW.booking_time IS NOT DISTINCT FROM OLD.booking_time
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.amount IS NOT DISTINCT FROM OLD.amount
     AND NEW.intent_created_by_profile_id
       IS NOT DISTINCT FROM OLD.intent_created_by_profile_id
     AND NEW.intent_vendor_name_snapshot
       IS NOT DISTINCT FROM OLD.intent_vendor_name_snapshot
     AND NEW.intent_vendor_category_snapshot
       IS NOT DISTINCT FROM OLD.intent_vendor_category_snapshot
     AND NEW.intent_product_name_snapshot
       IS NOT DISTINCT FROM OLD.intent_product_name_snapshot
     AND (to_jsonb(NEW) -> 'booking_type')
       IS NOT DISTINCT FROM (to_jsonb(OLD) -> 'booking_type')
     AND (to_jsonb(NEW) -> 'bride_name')
       IS NOT DISTINCT FROM (to_jsonb(OLD) -> 'bride_name')
     AND (to_jsonb(NEW) -> 'groom_name')
       IS NOT DISTINCT FROM (to_jsonb(OLD) -> 'groom_name')
     AND (to_jsonb(NEW) -> 'contact_phone')
       IS NOT DISTINCT FROM (to_jsonb(OLD) -> 'contact_phone')
     AND (to_jsonb(NEW) -> 'memo')
       IS NOT DISTINCT FROM (to_jsonb(OLD) -> 'memo')
     AND NEW.actual_amount IS NOT DISTINCT FROM OLD.actual_amount
     AND NEW.contracted_amount IS NOT DISTINCT FROM OLD.contracted_amount
     AND NEW.cancelled_at IS NOT DISTINCT FROM OLD.cancelled_at
     AND NEW.cancelled_by_profile_id IS NOT DISTINCT FROM OLD.cancelled_by_profile_id
     AND NEW.cancel_reason IS NOT DISTINCT FROM OLD.cancel_reason
     AND (to_jsonb(NEW) -> 'is_paid')
       IS NOT DISTINCT FROM (to_jsonb(OLD) -> 'is_paid')
     AND (to_jsonb(NEW) -> 'payment_status')
       IS NOT DISTINCT FROM (to_jsonb(OLD) -> 'payment_status')
     AND (to_jsonb(NEW) -> 'contract_status')
       IS NOT DISTINCT FROM (to_jsonb(OLD) -> 'contract_status')
     AND (to_jsonb(NEW) -> 'contract_signed_at')
       IS NOT DISTINCT FROM (to_jsonb(OLD) -> 'contract_signed_at')
     AND (to_jsonb(NEW) -> 'receipt_verified_at')
       IS NOT DISTINCT FROM (to_jsonb(OLD) -> 'receipt_verified_at')
     AND (to_jsonb(NEW) -> 'receipt_verified_by')
       IS NOT DISTINCT FROM (to_jsonb(OLD) -> 'receipt_verified_by')
     AND (to_jsonb(NEW) -> 'user_uploaded_receipt_url')
       IS NOT DISTINCT FROM (to_jsonb(OLD) -> 'user_uploaded_receipt_url') THEN
    RETURN NEW;
  END IF;

  -- Cancellation has its own exact actor-bound capability, consumed by the
  -- following cancellation transition trigger in the same BEFORE phase.
  IF OLD.status IS DISTINCT FROM 'cancelled'
     AND NEW.status = 'cancelled' THEN
    v_authorization_text := current_setting(
      'hanbang.booking_cancellation_authorization_id',
      true
    );
    IF auth.role() IS DISTINCT FROM 'service_role'
       OR COALESCE(v_authorization_text, '') !~
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR NOT EXISTS (
         SELECT 1
         FROM public.booking_cancellation_write_authorizations AS authz
         WHERE authz.authorization_id = v_authorization_text::uuid
           AND authz.booking_id = OLD.id
           AND authz.couple_id = OLD.couple_id
           AND authz.actor_profile_id
             IS NOT DISTINCT FROM NEW.cancelled_by_profile_id
       ) THEN
      RAISE EXCEPTION 'booking_cancel_rpc_required'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  v_authorization_text := current_setting(
    'hanbang.booking_outcome_authorization_id',
    true
  );
  IF auth.role() IS DISTINCT FROM 'service_role'
     OR COALESCE(v_authorization_text, '') !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'booking_protected_write_rpc_required'
      USING ERRCODE = '42501';
  END IF;
  v_authorization_id := v_authorization_text::uuid;
  DELETE FROM public.booking_outcome_write_authorizations AS authz
  WHERE authz.authorization_id = v_authorization_id
    AND authz.booking_id = OLD.id
    AND authz.couple_id = OLD.couple_id
    AND authz.actual_amount IS NOT DISTINCT FROM NEW.actual_amount
    AND authz.contracted_amount IS NOT DISTINCT FROM NEW.contracted_amount
    AND NEW.status = 'completed'
    AND NEW.vendor_id IS NOT DISTINCT FROM OLD.vendor_id
    AND NEW.couple_id IS NOT DISTINCT FROM OLD.couple_id
    AND NEW.product_id IS NOT DISTINCT FROM OLD.product_id
    AND NEW.staff_id IS NOT DISTINCT FROM OLD.staff_id
    AND NEW.booking_date IS NOT DISTINCT FROM OLD.booking_date
    AND NEW.booking_time IS NOT DISTINCT FROM OLD.booking_time
    AND NEW.amount IS NOT DISTINCT FROM OLD.amount
    AND NEW.intent_created_by_profile_id
      IS NOT DISTINCT FROM OLD.intent_created_by_profile_id
    AND NEW.intent_vendor_name_snapshot
      IS NOT DISTINCT FROM OLD.intent_vendor_name_snapshot
    AND NEW.intent_vendor_category_snapshot
      IS NOT DISTINCT FROM OLD.intent_vendor_category_snapshot
    AND NEW.intent_product_name_snapshot
      IS NOT DISTINCT FROM OLD.intent_product_name_snapshot
    AND (to_jsonb(NEW) -> 'booking_type')
      IS NOT DISTINCT FROM (to_jsonb(OLD) -> 'booking_type')
    AND (to_jsonb(NEW) -> 'bride_name')
      IS NOT DISTINCT FROM (to_jsonb(OLD) -> 'bride_name')
    AND (to_jsonb(NEW) -> 'groom_name')
      IS NOT DISTINCT FROM (to_jsonb(OLD) -> 'groom_name')
    AND (to_jsonb(NEW) -> 'contact_phone')
      IS NOT DISTINCT FROM (to_jsonb(OLD) -> 'contact_phone')
    AND (to_jsonb(NEW) -> 'memo')
      IS NOT DISTINCT FROM (to_jsonb(OLD) -> 'memo')
    AND NEW.vendor_delivery_status IS NOT DISTINCT FROM OLD.vendor_delivery_status
    AND NEW.cancelled_at IS NOT DISTINCT FROM OLD.cancelled_at
    AND NEW.cancelled_by_profile_id IS NOT DISTINCT FROM OLD.cancelled_by_profile_id
    AND NEW.cancel_reason IS NOT DISTINCT FROM OLD.cancel_reason
    AND (to_jsonb(NEW) -> 'is_paid')
      IS NOT DISTINCT FROM (to_jsonb(OLD) -> 'is_paid')
    AND (to_jsonb(NEW) -> 'payment_status')
      IS NOT DISTINCT FROM (to_jsonb(OLD) -> 'payment_status')
    AND (to_jsonb(NEW) -> 'contract_status')
      IS NOT DISTINCT FROM (to_jsonb(OLD) -> 'contract_status')
    AND (to_jsonb(NEW) -> 'contract_signed_at')
      IS NOT DISTINCT FROM (to_jsonb(OLD) -> 'contract_signed_at')
    AND (to_jsonb(NEW) -> 'receipt_verified_at')
      IS NOT DISTINCT FROM (to_jsonb(OLD) -> 'receipt_verified_at')
    AND (to_jsonb(NEW) -> 'receipt_verified_by')
      IS NOT DISTINCT FROM (to_jsonb(OLD) -> 'receipt_verified_by')
    AND (to_jsonb(NEW) -> 'user_uploaded_receipt_url')
      IS NOT DISTINCT FROM (to_jsonb(OLD) -> 'user_uploaded_receipt_url');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking_protected_write_rpc_required'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.authorize_booking_protected_write() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.authorize_booking_protected_write()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_00_authorize_booking_protected_write
  ON public.vendor_bookings;
CREATE TRIGGER trg_00_authorize_booking_protected_write
  BEFORE INSERT OR UPDATE ON public.vendor_bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.authorize_booking_protected_write();

-- Retire only the old route's explicitly self-labelled internal `booked`
-- nodes. Their booking rows predate the delivery boundary, so visibility is
-- truthfully legacy_unknown rather than retroactively asserted as not_sent.
UPDATE public.decision_nodes AS decision
SET decision_type = 'considering',
    title = regexp_replace(
      COALESCE(decision.title, '아모라 방문·상담 요청 기록'),
      '예약 요청',
      '방문·상담 후보 기록',
      'g'
    ),
    chosen_value = COALESCE(decision.chosen_value, '{}'::jsonb)
      || jsonb_build_object(
        'vendor_delivery_status', 'legacy_unknown',
        'vendor_confirmation_status', 'unconfirmed',
        'internal_request_status', 'recorded'
      ),
    metadata = COALESCE(decision.metadata, '{}'::jsonb)
      || jsonb_build_object(
        'truthStateMigratedAt', now(),
        'vendor_delivery_status', 'legacy_unknown',
        'vendor_confirmation_status', 'unconfirmed'
      ),
    decided_at = NULL,
    updated_at = now()
WHERE decision.source = 'vendor_booking'
  AND decision.decision_type = 'booked'
  AND decision.source_ref_id IS NOT NULL
  AND decision.metadata ->> 'execution_scope' = 'amora_internal_record'
  AND decision.metadata ->> 'vendor_delivery_status' = 'not_sent';

ALTER TABLE public.decision_nodes
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_by uuid;

-- Retain duplicate history but detach older rows from the canonical booking
-- identity before establishing an exact retry key.
WITH ranked_intent_decisions AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY couple_id, source_ref_id, source, decision_type
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS position
  FROM public.decision_nodes
  WHERE source = 'vendor_booking'
    AND decision_type = 'considering'
    AND source_ref_id IS NOT NULL
)
UPDATE public.decision_nodes AS decision
SET source_ref_id = NULL,
    metadata = COALESCE(decision.metadata, '{}'::jsonb)
      || jsonb_build_object(
        'bookingIntentDuplicateRetired', true,
        'bookingIntentDuplicateRetiredAt', now()
      ),
    updated_at = now()
FROM ranked_intent_decisions AS ranked
WHERE ranked.id = decision.id
  AND ranked.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS decision_nodes_booking_intent_unique
  ON public.decision_nodes (couple_id, source_ref_id, source, decision_type)
  WHERE source = 'vendor_booking'
    AND decision_type = 'considering'
    AND source_ref_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.upsert_amora_booking_intent_decision(
  p_booking_id uuid,
  p_actor_profile_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_booking public.vendor_bookings%ROWTYPE;
  v_vendor_name text;
  v_vendor_category text;
  v_decision_id uuid;
BEGIN
  SELECT booking.* INTO v_booking
  FROM public.vendor_bookings AS booking
  WHERE booking.id = p_booking_id
    AND booking.vendor_delivery_status = 'not_sent';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking_intent_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_vendor_name := v_booking.intent_vendor_name_snapshot;
  v_vendor_category := v_booking.intent_vendor_category_snapshot;
  IF v_vendor_name IS NULL OR v_vendor_category IS NULL THEN
    RAISE EXCEPTION 'booking_intent_context_missing' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.decision_nodes (
    couple_id,
    category,
    decision_type,
    title,
    chosen_value,
    confidence,
    source,
    source_ref_id,
    metadata,
    visibility
  ) VALUES (
    v_booking.couple_id,
    COALESCE(NULLIF(btrim(v_vendor_category), ''), 'vendor'),
    'considering',
    '아모라 방문·상담 후보 기록: ' ||
      COALESCE(NULLIF(btrim(v_vendor_name), ''), '업체'),
    jsonb_build_object(
      'booking_id', v_booking.id,
      'vendor_id', v_booking.vendor_id,
      'vendor_name', v_vendor_name,
      'product_id', v_booking.product_id,
      'product_name', v_booking.intent_product_name_snapshot,
      'booking_date', v_booking.booking_date,
      'booking_time', to_char(v_booking.booking_time, 'HH24:MI'),
      'quoted_amount', greatest(COALESCE(v_booking.amount, 0), 0),
      'amount_basis', 'quote',
      'internal_request_status', 'recorded',
      'vendor_delivery_status', 'not_sent',
      'vendor_confirmation_status', 'unconfirmed'
    ),
    0.50,
    'vendor_booking',
    v_booking.id,
    jsonb_build_object(
      'hook', 'booking_intent',
      'execution_scope', 'amora_internal_record',
      'actor_profile_id', p_actor_profile_id,
      'vendor_delivery_status', 'not_sent',
      'vendor_confirmation_status', 'unconfirmed'
    ),
    'shared'
  )
  ON CONFLICT (couple_id, source_ref_id, source, decision_type)
    WHERE source = 'vendor_booking'
      AND decision_type = 'considering'
      AND source_ref_id IS NOT NULL
  DO UPDATE SET id = decision_nodes.id
  RETURNING id INTO v_decision_id;

  RETURN v_decision_id;
END;
$function$;

ALTER FUNCTION public.upsert_amora_booking_intent_decision(uuid, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.upsert_amora_booking_intent_decision(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_amora_booking_intent_atomic(
  p_vendor_id uuid,
  p_couple_id uuid,
  p_actor_profile_id uuid,
  p_booking_date date,
  p_booking_time text,
  p_product_id uuid DEFAULT NULL,
  p_staff_id uuid DEFAULT NULL,
  p_booking_type text DEFAULT 'consultation',
  p_bride_name text DEFAULT '',
  p_groom_name text DEFAULT '',
  p_contact_phone text DEFAULT '',
  p_memo text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_day integer;
  v_hour integer;
  v_booking_time_typed time;
  v_amount numeric := 0;
  v_booking_id uuid;
  v_existing public.vendor_bookings%ROWTYPE;
  v_staff_has_schedule boolean := false;
  v_product_has_schedule boolean := false;
  v_max_bookings integer;
  v_existing_count integer;
  v_raw_bride_id uuid;
  v_raw_groom_id uuid;
  v_authorization_id uuid;
  v_vendor_name text;
  v_vendor_category text;
  v_product_name text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'BOOKING_SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_vendor_id IS NULL
     OR p_couple_id IS NULL
     OR p_actor_profile_id IS NULL
     OR p_booking_date IS NULL
     OR p_booking_time IS NULL
     OR p_booking_time !~ '^(?:[01][0-9]|2[0-3]):00$'
     OR p_booking_type IS NULL
     OR char_length(btrim(p_booking_type)) NOT BETWEEN 1 AND 40 THEN
    RAISE EXCEPTION 'invalid_booking_input' USING ERRCODE = '22023';
  END IF;

  SELECT couple.bride_id, couple.groom_id
    INTO v_raw_bride_id, v_raw_groom_id
  FROM public.couples AS couple
  WHERE couple.id = p_couple_id
  FOR SHARE;
  IF NOT FOUND
     OR (
       p_actor_profile_id IS DISTINCT FROM v_raw_bride_id
       AND p_actor_profile_id IS DISTINCT FROM v_raw_groom_id
     )
     OR public.is_current_couple_member(
       p_actor_profile_id,
       p_couple_id
     ) IS NOT TRUE THEN
    RAISE EXCEPTION 'booking_intent_actor_not_member'
      USING ERRCODE = '42501';
  END IF;
  IF v_raw_bride_id IS NOT NULL
     AND v_raw_groom_id IS NOT NULL
     AND v_raw_bride_id <> v_raw_groom_id
     AND public.is_current_couple_member(v_raw_bride_id, p_couple_id)
     AND public.is_current_couple_member(v_raw_groom_id, p_couple_id) THEN
    RAISE EXCEPTION 'booking_joint_approval_required'
      USING ERRCODE = 'P0001';
  END IF;

  -- Exact durable replay is resolved from the immutable stored payload before
  -- any live catalog/capacity check. A lost response must remain repairable
  -- even if the vendor, product, staff, or slot changes afterward.
  v_booking_time_typed := p_booking_time::time;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_couple_id::text || ':' || p_vendor_id::text || ':' ||
    p_booking_date::text || ':' || v_booking_time_typed::text,
    0
  ));
  SELECT booking.* INTO v_existing
  FROM public.vendor_bookings AS booking
  WHERE booking.couple_id = p_couple_id
    AND booking.vendor_id = p_vendor_id
    AND booking.booking_date = p_booking_date
    AND booking.booking_time = v_booking_time_typed
  ORDER BY booking.updated_at DESC NULLS LAST, booking.id DESC
  LIMIT 1
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.status = 'cancelled' THEN
      RAISE EXCEPTION 'booking_intent_already_cancelled'
        USING ERRCODE = 'P0001',
          DETAIL = 'An explicit future rebook flow is required';
    END IF;
    IF v_existing.vendor_delivery_status = 'not_sent'
       AND v_existing.product_id IS NOT DISTINCT FROM p_product_id
       AND v_existing.staff_id IS NOT DISTINCT FROM p_staff_id
       AND v_existing.booking_type IS NOT DISTINCT FROM p_booking_type
       AND COALESCE(v_existing.bride_name, '') =
         left(COALESCE(p_bride_name, ''), 120)
       AND COALESCE(v_existing.groom_name, '') =
         left(COALESCE(p_groom_name, ''), 120)
       AND COALESCE(v_existing.contact_phone, '') =
         left(COALESCE(p_contact_phone, ''), 40)
       AND COALESCE(v_existing.memo, '') =
         left(COALESCE(p_memo, ''), 1000) THEN
      IF v_existing.intent_created_by_profile_id IS NULL THEN
        RAISE EXCEPTION 'booking_intent_audit_missing'
          USING ERRCODE = '55000';
      END IF;
      PERFORM public.upsert_amora_booking_intent_decision(
        v_existing.id,
        v_existing.intent_created_by_profile_id
      );
      RETURN v_existing.id;
    END IF;
    RAISE EXCEPTION 'duplicate_couple_slot' USING ERRCODE = '23505';
  END IF;

  SELECT vendor.name, vendor.category
    INTO v_vendor_name, v_vendor_category
  FROM public.vendors AS vendor
  WHERE vendor.id = p_vendor_id
    AND vendor.status = 'approved';
  IF NOT FOUND
     OR NULLIF(btrim(COALESCE(v_vendor_name, '')), '') IS NULL
     OR NULLIF(btrim(COALESCE(v_vendor_category, '')), '') IS NULL THEN
    RAISE EXCEPTION 'vendor_unavailable' USING ERRCODE = 'P0001';
  END IF;

  IF p_product_id IS NOT NULL THEN
    SELECT COALESCE(product.discount_price, product.price), product.name
      INTO v_amount, v_product_name
    FROM public.vendor_products AS product
    WHERE product.id = p_product_id
      AND product.vendor_id = p_vendor_id
      AND COALESCE(product.is_active, true) = true;
    IF NOT FOUND
       OR v_amount IS NULL
       OR v_amount < 0
       OR v_amount > 1000000000000 THEN
      RAISE EXCEPTION 'invalid_product_vendor' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_staff_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.vendor_staff AS staff
    WHERE staff.id = p_staff_id
      AND staff.vendor_id = p_vendor_id
  ) THEN
    RAISE EXCEPTION 'invalid_staff_vendor' USING ERRCODE = 'P0001';
  END IF;

  v_day := (EXTRACT(DOW FROM p_booking_date)::integer + 6) % 7;
  v_hour := split_part(p_booking_time, ':', 1)::integer;
  IF p_booking_date + v_booking_time_typed <=
     (now() AT TIME ZONE 'Asia/Seoul') THEN
    RAISE EXCEPTION 'past_booking_datetime' USING ERRCODE = '22023';
  END IF;

  IF p_staff_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.staff_timeslots
      WHERE staff_id = p_staff_id AND available = true
    ) INTO v_staff_has_schedule;
  END IF;
  IF p_product_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.product_timeslots
      WHERE product_id = p_product_id AND available = true
    ) INTO v_product_has_schedule;
  END IF;

  IF v_staff_has_schedule THEN
    SELECT max_bookings INTO v_max_bookings
    FROM public.staff_timeslots
    WHERE staff_id = p_staff_id
      AND day = v_day
      AND hour = v_hour
      AND available = true
      AND max_bookings > 0
    LIMIT 1
    FOR UPDATE;
  ELSIF v_product_has_schedule THEN
    SELECT max_bookings INTO v_max_bookings
    FROM public.product_timeslots
    WHERE product_id = p_product_id
      AND day = v_day
      AND hour = v_hour
      AND available = true
      AND max_bookings > 0
    LIMIT 1
    FOR UPDATE;
  ELSE
    SELECT max_bookings INTO v_max_bookings
    FROM public.vendor_timeslots
    WHERE vendor_id = p_vendor_id
      AND day = v_day
      AND hour = v_hour
      AND available = true
      AND max_bookings > 0
    LIMIT 1
    FOR UPDATE;
  END IF;
  IF v_max_bookings IS NULL OR v_max_bookings <= 0 THEN
    RAISE EXCEPTION 'slot_unavailable' USING ERRCODE = 'P0001';
  END IF;

  IF v_staff_has_schedule THEN
    SELECT count(*)::integer INTO v_existing_count
    FROM public.vendor_bookings AS booking
    WHERE booking.vendor_id = p_vendor_id
      AND booking.staff_id = p_staff_id
      AND booking.booking_date = p_booking_date
      AND booking.booking_time = v_booking_time_typed
      AND booking.status IS DISTINCT FROM 'cancelled'
      AND booking.vendor_delivery_status <> 'not_sent';
  ELSIF v_product_has_schedule THEN
    SELECT count(*)::integer INTO v_existing_count
    FROM public.vendor_bookings AS booking
    WHERE booking.vendor_id = p_vendor_id
      AND booking.product_id = p_product_id
      AND booking.booking_date = p_booking_date
      AND booking.booking_time = v_booking_time_typed
      AND booking.status IS DISTINCT FROM 'cancelled'
      AND booking.vendor_delivery_status <> 'not_sent';
  ELSE
    SELECT count(*)::integer INTO v_existing_count
    FROM public.vendor_bookings AS booking
    WHERE booking.vendor_id = p_vendor_id
      AND booking.booking_date = p_booking_date
      AND booking.booking_time = v_booking_time_typed
      AND booking.status IS DISTINCT FROM 'cancelled'
      AND booking.vendor_delivery_status <> 'not_sent';
  END IF;
  IF v_existing_count >= v_max_bookings THEN
    RAISE EXCEPTION 'slot_full' USING ERRCODE = 'P0001';
  END IF;

  v_booking_id := gen_random_uuid();
  v_authorization_id := gen_random_uuid();
  INSERT INTO public.booking_intent_write_authorizations (
    authorization_id,
    booking_id,
    couple_id,
    actor_profile_id,
    vendor_id,
    product_id,
    staff_id,
    booking_date,
    booking_time,
    quoted_amount
  ) VALUES (
    v_authorization_id,
    v_booking_id,
    p_couple_id,
    p_actor_profile_id,
    p_vendor_id,
    p_product_id,
    p_staff_id,
    p_booking_date,
    v_booking_time_typed,
    v_amount
  );
  PERFORM set_config(
    'hanbang.booking_intent_authorization_id',
    v_authorization_id::text,
    true
  );

  INSERT INTO public.vendor_bookings (
    id,
    vendor_id,
    couple_id,
    product_id,
    staff_id,
    booking_date,
    booking_time,
    booking_type,
    bride_name,
    groom_name,
    contact_phone,
    status,
    amount,
    is_paid,
    memo,
    intent_created_by_profile_id,
    intent_vendor_name_snapshot,
    intent_vendor_category_snapshot,
    intent_product_name_snapshot,
    vendor_delivery_status
  ) VALUES (
    v_booking_id,
    p_vendor_id,
    p_couple_id,
    p_product_id,
    p_staff_id,
    p_booking_date,
    v_booking_time_typed,
    p_booking_type,
    left(COALESCE(p_bride_name, ''), 120),
    left(COALESCE(p_groom_name, ''), 120),
    left(COALESCE(p_contact_phone, ''), 40),
    'pending',
    v_amount,
    false,
    left(COALESCE(p_memo, ''), 1000),
    p_actor_profile_id,
    left(v_vendor_name, 300),
    left(v_vendor_category, 80),
    CASE
      WHEN v_product_name IS NULL THEN NULL
      ELSE left(v_product_name, 300)
    END,
    'not_sent'
  );

  IF EXISTS (
    SELECT 1
    FROM public.booking_intent_write_authorizations AS authz
    WHERE authz.authorization_id = v_authorization_id
  ) THEN
    RAISE EXCEPTION 'booking_intent_authorization_not_consumed'
      USING ERRCODE = '55000';
  END IF;
  PERFORM set_config('hanbang.booking_intent_authorization_id', '', true);

  PERFORM public.upsert_amora_booking_intent_decision(
    v_booking_id,
    p_actor_profile_id
  );
  RETURN v_booking_id;
END;
$function$;

ALTER FUNCTION public.create_amora_booking_intent_atomic(
  uuid, uuid, uuid, date, text, uuid, uuid, text, text, text, text, text
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_amora_booking_intent_atomic(
  uuid, uuid, uuid, date, text, uuid, uuid, text, text, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_amora_booking_intent_atomic(
  uuid, uuid, uuid, date, text, uuid, uuid, text, text, text, text, text
) TO service_role;

-- There is no audited vendor-submit/accept transport in this release. Leaving
-- the old marketplace creator executable would let a service caller create a
-- vendor-visible, capacity-consuming legacy_unknown row and bypass the intent
-- truth boundary. Keep the signature only as a fail-closed compatibility
-- symbol; a future external execution flow must introduce its own audited RPC.
CREATE OR REPLACE FUNCTION public.create_booking_atomic(
  p_vendor_id uuid,
  p_couple_id uuid,
  p_booking_date date,
  p_booking_time text,
  p_product_id uuid DEFAULT NULL,
  p_staff_id uuid DEFAULT NULL,
  p_booking_type text DEFAULT 'consultation',
  p_bride_name text DEFAULT '',
  p_groom_name text DEFAULT '',
  p_contact_phone text DEFAULT '',
  p_amount numeric DEFAULT 0,
  p_memo text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  RAISE EXCEPTION 'legacy_booking_create_disabled_use_amora_intent'
    USING ERRCODE = '42501';
END;
$function$;

ALTER FUNCTION public.create_booking_atomic(
  uuid, uuid, date, text, uuid, uuid, text, text, text, text, numeric, text
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_booking_atomic(
  uuid, uuid, date, text, uuid, uuid, text, text, text, text, numeric, text
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.complete_amora_booking_outcome_atomic(
  p_booking_id uuid,
  p_customer_id uuid,
  p_actual_amount numeric,
  p_contracted_amount numeric,
  p_rating integer,
  p_review text,
  p_share_public_review boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '20s'
AS $function$
DECLARE
  v_authorization_id uuid;
  v_couple_id uuid;
  v_was_exact boolean := false;
  v_authorization_remained boolean := false;
  v_result jsonb;
  v_decision_id uuid;
  v_delivery_status text;
  v_raw_bride_id uuid;
  v_raw_groom_id uuid;
  v_vendor_name_snapshot text;
  v_vendor_category_snapshot text;
  v_product_name_snapshot text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;

  SELECT profile.couple_id
    INTO v_couple_id
  FROM public.profiles AS profile
  WHERE profile.id = p_customer_id
    AND profile.couple_id IS NOT NULL
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking_outcome_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT couple.bride_id, couple.groom_id
    INTO v_raw_bride_id, v_raw_groom_id
  FROM public.couples AS couple
  WHERE couple.id = v_couple_id
  FOR SHARE;
  IF NOT FOUND
     OR (
       p_customer_id IS DISTINCT FROM v_raw_bride_id
       AND p_customer_id IS DISTINCT FROM v_raw_groom_id
     )
     OR public.is_current_couple_member(
       p_customer_id,
       v_couple_id
     ) IS NOT TRUE THEN
    RAISE EXCEPTION 'booking_outcome_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_raw_bride_id IS NOT NULL
     AND v_raw_groom_id IS NOT NULL
     AND v_raw_bride_id <> v_raw_groom_id
     AND public.is_current_couple_member(v_raw_bride_id, v_couple_id)
     AND public.is_current_couple_member(v_raw_groom_id, v_couple_id) THEN
    RAISE EXCEPTION 'booking_joint_approval_required'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT
    booking.status = 'completed'
      AND booking.actual_amount IS NOT DISTINCT FROM p_actual_amount
      AND booking.contracted_amount IS NOT DISTINCT FROM p_contracted_amount,
    booking.vendor_delivery_status,
    booking.intent_vendor_name_snapshot,
    booking.intent_vendor_category_snapshot,
    booking.intent_product_name_snapshot
    INTO
      v_was_exact,
      v_delivery_status,
      v_vendor_name_snapshot,
      v_vendor_category_snapshot,
      v_product_name_snapshot
  FROM public.vendor_bookings AS booking
  WHERE booking.id = p_booking_id
    AND booking.couple_id = v_couple_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking_outcome_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_authorization_id := gen_random_uuid();
  INSERT INTO public.booking_outcome_write_authorizations (
    authorization_id,
    booking_id,
    couple_id,
    actor_profile_id,
    actual_amount,
    contracted_amount
  ) VALUES (
    v_authorization_id,
    p_booking_id,
    v_couple_id,
    p_customer_id,
    p_actual_amount,
    p_contracted_amount
  );
  PERFORM set_config(
    'hanbang.booking_outcome_authorization_id',
    v_authorization_id::text,
    true
  );

  v_result := public.complete_vendor_booking_outcome(
    p_booking_id,
    p_customer_id,
    p_actual_amount,
    p_contracted_amount,
    p_rating,
    p_review,
    p_share_public_review
  );

  DELETE FROM public.booking_outcome_write_authorizations AS authz
  WHERE authz.authorization_id = v_authorization_id
  RETURNING true INTO v_authorization_remained;
  IF COALESCE(v_authorization_remained, false) AND NOT v_was_exact THEN
    RAISE EXCEPTION 'booking_outcome_authorization_not_consumed'
      USING ERRCODE = '55000';
  END IF;
  PERFORM set_config('hanbang.booking_outcome_authorization_id', '', true);

  v_decision_id := NULLIF(v_result ->> 'decisionId', '')::uuid;
  v_vendor_name_snapshot := COALESCE(
    v_vendor_name_snapshot,
    v_result -> 'context' ->> 'vendorName',
    '업체'
  );
  v_vendor_category_snapshot := COALESCE(
    v_vendor_category_snapshot,
    v_result -> 'context' ->> 'vendorCategory',
    'vendor'
  );
  v_product_name_snapshot := COALESCE(
    v_product_name_snapshot,
    v_result -> 'context' ->> 'productName'
  );
  UPDATE public.decision_nodes
  SET category = v_vendor_category_snapshot,
      title = '사용자가 완료로 기록: ' || v_vendor_name_snapshot,
      chosen_value = COALESCE(chosen_value, '{}'::jsonb)
        || jsonb_build_object(
          'vendor_name', v_vendor_name_snapshot,
          'product_name', v_product_name_snapshot,
          'completion_evidence', 'user_reported',
          'vendor_delivery_status', v_delivery_status,
          'vendor_confirmation_status', 'unconfirmed'
        ),
      metadata = COALESCE(metadata, '{}'::jsonb)
        || jsonb_build_object(
          'completion_evidence', 'user_reported',
          'vendor_delivery_status', v_delivery_status,
          'vendor_confirmation_status', 'unconfirmed'
        ),
      updated_at = now()
  WHERE id = v_decision_id
    AND couple_id = v_couple_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking_outcome_decision_audit_missing'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.decision_nodes
  SET chosen_value = COALESCE(chosen_value, '{}'::jsonb)
        || jsonb_build_object(
          'internal_request_status', 'completed_by_user_report',
          'completion_evidence', 'user_reported',
          'vendor_confirmation_status', 'unconfirmed'
        ),
      metadata = COALESCE(metadata, '{}'::jsonb)
        || jsonb_build_object(
          'supersededByBookingOutcomeDecisionId', v_decision_id,
          'completion_evidence', 'user_reported',
          'vendor_confirmation_status', 'unconfirmed'
        ),
      superseded_at = COALESCE(superseded_at, now()),
      superseded_by = v_decision_id,
      updated_at = now()
  WHERE couple_id = v_couple_id
    AND source = 'vendor_booking'
    AND source_ref_id = p_booking_id
    AND decision_type = 'considering';

  RETURN v_result || jsonb_build_object(
    'completionEvidence', 'user_reported',
    'vendorDeliveryStatus', v_delivery_status,
    'vendorConfirmationStatus', 'unconfirmed',
    'context', COALESCE(v_result -> 'context', '{}'::jsonb)
      || jsonb_build_object(
        'vendorName', v_vendor_name_snapshot,
        'vendorCategory', v_vendor_category_snapshot,
        'productName', v_product_name_snapshot
      )
  );
END;
$function$;

ALTER FUNCTION public.complete_amora_booking_outcome_atomic(
  uuid, uuid, numeric, numeric, integer, text, boolean
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.complete_amora_booking_outcome_atomic(
  uuid, uuid, numeric, numeric, integer, text, boolean
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_amora_booking_outcome_atomic(
  uuid, uuid, numeric, numeric, integer, text, boolean
) TO service_role;

-- Only the fenced wrapper may invoke the legacy implementation now. The
-- conditional keeps this additive migration safe in reduced local schemas.
DO $revoke_legacy_outcome$
BEGIN
  IF to_regprocedure(
    'public.complete_vendor_booking_outcome(uuid,uuid,numeric,numeric,integer,text,boolean)'
  ) IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.complete_vendor_booking_outcome(
      uuid, uuid, numeric, numeric, integer, text, boolean
    ) FROM PUBLIC, anon, authenticated, service_role;
  END IF;
END;
$revoke_legacy_outcome$;

CREATE OR REPLACE FUNCTION public.authorize_booking_cancellation_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '5s'
AS $function$
DECLARE
  v_authorization_text text;
  v_authorization_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'cancelled' THEN
      RAISE EXCEPTION 'booking_cancel_rpc_required'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status IS DISTINCT FROM 'cancelled'
     AND NEW.status = 'cancelled' THEN
    v_authorization_text := current_setting(
      'hanbang.booking_cancellation_authorization_id',
      true
    );
    IF auth.role() IS DISTINCT FROM 'service_role'
       OR COALESCE(v_authorization_text, '') !~
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'booking_cancel_rpc_required'
        USING ERRCODE = '42501';
    END IF;
    v_authorization_id := v_authorization_text::uuid;
    DELETE FROM public.booking_cancellation_write_authorizations AS authz
    WHERE authz.authorization_id = v_authorization_id
      AND authz.booking_id = OLD.id
      AND authz.couple_id = OLD.couple_id
      AND authz.actor_profile_id
        IS NOT DISTINCT FROM NEW.cancelled_by_profile_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'booking_cancel_rpc_required'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.authorize_booking_cancellation_transition()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.authorize_booking_cancellation_transition()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_authorize_booking_cancellation_transition
  ON public.vendor_bookings;
CREATE TRIGGER trg_authorize_booking_cancellation_transition
  BEFORE INSERT OR UPDATE ON public.vendor_bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.authorize_booking_cancellation_transition();

CREATE OR REPLACE FUNCTION public.booking_cancellation_snapshot_digest(
  p_booking_id uuid,
  p_couple_id uuid,
  p_actor_profile_id uuid,
  p_cancelled_at timestamptz,
  p_issue_bride_id uuid,
  p_issue_groom_id uuid,
  p_issue_required_count smallint,
  p_roster_fingerprint text,
  p_vendor_id uuid,
  p_product_id uuid,
  p_staff_id uuid,
  p_booking_date date,
  p_booking_time time,
  p_quoted_amount numeric,
  p_actual_amount numeric,
  p_cancel_reason text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'schemaVersion', 1,
          'bookingId', p_booking_id,
          'coupleId', p_couple_id,
          'actorProfileId', p_actor_profile_id,
          'cancelledAt', to_char(
            p_cancelled_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          ),
          'issueBrideId', p_issue_bride_id,
          'issueGroomId', p_issue_groom_id,
          'issueRequiredCount', p_issue_required_count,
          'rosterFingerprint', p_roster_fingerprint,
          'vendorId', p_vendor_id,
          'productId', p_product_id,
          'staffId', p_staff_id,
          'bookingDate', p_booking_date,
          'bookingTime', to_char(p_booking_time, 'HH24:MI'),
          'quotedAmount', greatest(COALESCE(p_quoted_amount, 0), 0),
          'actualAmount', p_actual_amount,
          'cancelReason', p_cancel_reason
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
$function$;

ALTER FUNCTION public.booking_cancellation_snapshot_digest(
  uuid, uuid, uuid, timestamptz, uuid, uuid, smallint, text,
  uuid, uuid, uuid, date, time, numeric, numeric, text
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.booking_cancellation_snapshot_digest(
  uuid, uuid, uuid, timestamptz, uuid, uuid, smallint, text,
  uuid, uuid, uuid, date, time, numeric, numeric, text
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reject_booking_cancellation_receipt_rewrite()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '5s'
AS $function$
BEGIN
  IF TG_OP = 'DELETE'
     AND NOT EXISTS (
       SELECT 1
       FROM public.vendor_bookings AS booking
       WHERE booking.id = OLD.booking_id
     ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'booking_cancellation_receipt_immutable'
    USING ERRCODE = '55000';
END;
$function$;

ALTER FUNCTION public.reject_booking_cancellation_receipt_rewrite()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reject_booking_cancellation_receipt_rewrite()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_reject_booking_cancellation_receipt_rewrite
  ON public.booking_cancellation_receipts;
CREATE TRIGGER trg_reject_booking_cancellation_receipt_rewrite
  BEFORE UPDATE OR DELETE ON public.booking_cancellation_receipts
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_booking_cancellation_receipt_rewrite();

CREATE OR REPLACE FUNCTION public.enforce_cancelled_booking_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '5s'
AS $function$
BEGIN
  IF OLD.status = 'cancelled'
     AND (
       NEW.status IS DISTINCT FROM 'cancelled'
       OR NEW.id IS DISTINCT FROM OLD.id
       OR NEW.couple_id IS DISTINCT FROM OLD.couple_id
       OR NEW.vendor_id IS DISTINCT FROM OLD.vendor_id
       OR NEW.product_id IS DISTINCT FROM OLD.product_id
       OR NEW.staff_id IS DISTINCT FROM OLD.staff_id
       OR NEW.booking_date IS DISTINCT FROM OLD.booking_date
       OR NEW.booking_time IS DISTINCT FROM OLD.booking_time
       OR greatest(COALESCE(NEW.amount, 0), 0)
            IS DISTINCT FROM greatest(COALESCE(OLD.amount, 0), 0)
       OR NEW.actual_amount IS DISTINCT FROM OLD.actual_amount
       OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
       OR NEW.cancelled_by_profile_id
            IS DISTINCT FROM OLD.cancelled_by_profile_id
       OR NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason
     ) THEN
    RAISE EXCEPTION 'booking_cancelled_state_immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.enforce_cancelled_booking_snapshot() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enforce_cancelled_booking_snapshot()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_enforce_cancelled_booking_snapshot
  ON public.vendor_bookings;
CREATE TRIGGER trg_enforce_cancelled_booking_snapshot
  BEFORE UPDATE ON public.vendor_bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_cancelled_booking_snapshot();

CREATE OR REPLACE FUNCTION public.booking_cancellation_receipt_is_valid(
  p_booking_id uuid,
  p_couple_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_booking public.vendor_bookings%ROWTYPE;
  v_receipt public.booking_cancellation_receipts%ROWTYPE;
BEGIN
  SELECT booking.* INTO v_booking
  FROM public.vendor_bookings AS booking
  WHERE booking.id = p_booking_id
    AND booking.couple_id = p_couple_id;
  IF NOT FOUND OR v_booking.status IS DISTINCT FROM 'cancelled' THEN
    RETURN false;
  END IF;

  SELECT receipt.* INTO v_receipt
  FROM public.booking_cancellation_receipts AS receipt
  WHERE receipt.booking_id = p_booking_id
    AND receipt.couple_id = p_couple_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  RETURN v_receipt.actor_profile_id
           IS NOT DISTINCT FROM v_booking.cancelled_by_profile_id
    AND v_receipt.cancelled_at IS NOT DISTINCT FROM v_booking.cancelled_at
    AND v_receipt.vendor_id IS NOT DISTINCT FROM v_booking.vendor_id
    AND v_receipt.product_id IS NOT DISTINCT FROM v_booking.product_id
    AND v_receipt.staff_id IS NOT DISTINCT FROM v_booking.staff_id
    AND v_receipt.booking_date IS NOT DISTINCT FROM v_booking.booking_date
    AND v_receipt.booking_time IS NOT DISTINCT FROM v_booking.booking_time
    AND v_receipt.quoted_amount IS NOT DISTINCT FROM
      greatest(COALESCE(v_booking.amount, 0), 0)
    AND v_receipt.actual_amount IS NOT DISTINCT FROM v_booking.actual_amount
    AND v_receipt.cancel_reason IS NOT DISTINCT FROM v_booking.cancel_reason
    AND v_receipt.roster_fingerprint = md5(
      COALESCE(v_receipt.issue_bride_id::text, '-') || ':' ||
      COALESCE(v_receipt.issue_groom_id::text, '-')
    )
    AND v_receipt.issue_required_count = CASE
      WHEN v_receipt.issue_bride_id IS NOT NULL
       AND v_receipt.issue_groom_id IS NOT NULL THEN 2
      ELSE 1
    END
    AND (
      v_receipt.actor_profile_id = v_receipt.issue_bride_id
      OR v_receipt.actor_profile_id = v_receipt.issue_groom_id
    )
    AND v_receipt.snapshot_digest =
      public.booking_cancellation_snapshot_digest(
        v_receipt.booking_id,
        v_receipt.couple_id,
        v_receipt.actor_profile_id,
        v_receipt.cancelled_at,
        v_receipt.issue_bride_id,
        v_receipt.issue_groom_id,
        v_receipt.issue_required_count,
        v_receipt.roster_fingerprint,
        v_receipt.vendor_id,
        v_receipt.product_id,
        v_receipt.staff_id,
        v_receipt.booking_date,
        v_receipt.booking_time,
        v_receipt.quoted_amount,
        v_receipt.actual_amount,
        v_receipt.cancel_reason
      );
END;
$function$;

ALTER FUNCTION public.booking_cancellation_receipt_is_valid(uuid, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.booking_cancellation_receipt_is_valid(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

WITH ranked_cancel_decisions AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY couple_id, source_ref_id
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS position
  FROM public.decision_nodes
  WHERE source = 'vendor_booking'
    AND decision_type = 'decided'
    AND source_ref_id IS NOT NULL
    AND metadata ->> 'hook' = 'booking_internal_cancel'
)
UPDATE public.decision_nodes AS decision
SET source_ref_id = NULL,
    metadata = COALESCE(decision.metadata, '{}'::jsonb)
      || jsonb_build_object(
        'bookingCancelDuplicateRetired', true,
        'bookingCancelDuplicateRetiredAt', now()
      ),
    updated_at = now()
FROM ranked_cancel_decisions AS ranked
WHERE ranked.id = decision.id
  AND ranked.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS decision_nodes_booking_internal_cancel_unique
  ON public.decision_nodes (couple_id, source_ref_id)
  WHERE source = 'vendor_booking'
    AND decision_type = 'decided'
    AND source_ref_id IS NOT NULL
    AND metadata ->> 'hook' = 'booking_internal_cancel';

CREATE OR REPLACE FUNCTION public.upsert_booking_internal_cancel_decision(
  p_booking_id uuid,
  p_actor_profile_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_booking public.vendor_bookings%ROWTYPE;
  v_vendor_name text;
  v_vendor_category text;
  v_decision_id uuid;
BEGIN
  SELECT booking.* INTO v_booking
  FROM public.vendor_bookings AS booking
  WHERE booking.id = p_booking_id
    AND booking.status = 'cancelled';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cancelled_booking_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT vendor.name, vendor.category
    INTO v_vendor_name, v_vendor_category
  FROM public.vendors AS vendor
  WHERE vendor.id = v_booking.vendor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking_cancel_context_missing' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.decision_nodes (
    couple_id,
    category,
    decision_type,
    title,
    chosen_value,
    confidence,
    decided_at,
    source,
    source_ref_id,
    metadata,
    visibility
  ) VALUES (
    v_booking.couple_id,
    COALESCE(NULLIF(btrim(v_vendor_category), ''), 'vendor'),
    'decided',
    '아모라 방문·상담 후보 기록 취소: ' ||
      COALESCE(NULLIF(btrim(v_vendor_name), ''), '업체'),
    jsonb_build_object(
      'booking_id', v_booking.id,
      'vendor_id', v_booking.vendor_id,
      'vendor_name', v_vendor_name,
      'internal_request_status', 'cancelled',
      'vendor_delivery_status', v_booking.vendor_delivery_status,
      'vendor_cancellation_status', 'unconfirmed',
      'refund_status', 'unknown',
      'quoted_amount', greatest(COALESCE(v_booking.amount, 0), 0),
      'actual_amount', v_booking.actual_amount
    ),
    0.95,
    v_booking.cancelled_at,
    'vendor_booking',
    v_booking.id,
    jsonb_build_object(
      'hook', 'booking_internal_cancel',
      'execution_scope', 'amora_internal_record',
      'actor_profile_id', p_actor_profile_id,
      'supersedes_internal_request', true,
      'vendor_cancellation_status', 'unconfirmed',
      'refund_status', 'unknown'
    ),
    'shared'
  )
  ON CONFLICT (couple_id, source_ref_id)
    WHERE source = 'vendor_booking'
      AND decision_type = 'decided'
      AND source_ref_id IS NOT NULL
      AND metadata ->> 'hook' = 'booking_internal_cancel'
  DO UPDATE SET
    category = EXCLUDED.category,
    title = EXCLUDED.title,
    chosen_value = EXCLUDED.chosen_value,
    confidence = EXCLUDED.confidence,
    decided_at = EXCLUDED.decided_at,
    metadata = EXCLUDED.metadata,
    visibility = 'shared',
    updated_at = now()
  RETURNING id INTO v_decision_id;

  UPDATE public.decision_nodes
  SET chosen_value = COALESCE(chosen_value, '{}'::jsonb)
        || jsonb_build_object(
          'internal_request_status', 'cancelled',
          'vendor_cancellation_status', 'unconfirmed',
          'refund_status', 'unknown'
        ),
      metadata = COALESCE(metadata, '{}'::jsonb)
        || jsonb_build_object(
          'supersededByInternalCancellationDecisionId', v_decision_id,
          'internalRequestCancelledAt', v_booking.cancelled_at,
          'vendor_cancellation_status', 'unconfirmed',
          'refund_status', 'unknown'
        ),
      superseded_at = COALESCE(superseded_at, v_booking.cancelled_at),
      superseded_by = v_decision_id,
      updated_at = now()
  WHERE couple_id = v_booking.couple_id
    AND source = 'vendor_booking'
    AND source_ref_id = v_booking.id
    AND decision_type = 'considering';

  RETURN v_decision_id;
END;
$function$;

ALTER FUNCTION public.upsert_booking_internal_cancel_decision(uuid, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.upsert_booking_internal_cancel_decision(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cancel_booking_atomic(
  p_booking_id uuid,
  p_couple_id uuid,
  p_actor_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_booking public.vendor_bookings%ROWTYPE;
  v_receipt public.booking_cancellation_receipts%ROWTYPE;
  v_raw_bride_id uuid;
  v_raw_groom_id uuid;
  v_issue_bride_id uuid;
  v_issue_groom_id uuid;
  v_issue_required_count smallint;
  v_roster_fingerprint text;
  v_cancelled_at timestamptz;
  v_cancel_reason text := '아모라 내부 예약 기록 취소';
  v_snapshot_digest text;
  v_authorization_id uuid;
  v_idempotent boolean := false;
  v_cancelled_at_text text;
  v_joint_approval_required boolean := false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'BOOKING_CANCEL_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;
  IF p_booking_id IS NULL
     OR p_couple_id IS NULL
     OR p_actor_profile_id IS NULL THEN
    RAISE EXCEPTION 'invalid_booking_input' USING ERRCODE = '22023';
  END IF;
  PERFORM 1
  FROM public.booking_projection_jobs AS job
  WHERE job.booking_id = p_booking_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking_projection_context_missing'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT couple.bride_id, couple.groom_id
    INTO v_raw_bride_id, v_raw_groom_id
  FROM public.couples AS couple
  WHERE couple.id = p_couple_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking_cancel_actor_not_member'
      USING ERRCODE = '42501';
  END IF;

  SELECT booking.* INTO v_booking
  FROM public.vendor_bookings AS booking
  WHERE booking.id = p_booking_id
    AND booking.couple_id = p_couple_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_joint_approval_required := v_raw_bride_id IS NOT NULL
    AND v_raw_groom_id IS NOT NULL
    AND v_raw_bride_id <> v_raw_groom_id
    AND public.is_current_couple_member(v_raw_bride_id, p_couple_id)
    AND public.is_current_couple_member(v_raw_groom_id, p_couple_id);

  IF v_booking.status = 'cancelled' THEN
    v_idempotent := true;
    SELECT receipt.* INTO v_receipt
    FROM public.booking_cancellation_receipts AS receipt
    WHERE receipt.booking_id = p_booking_id
      AND receipt.couple_id = p_couple_id;
    IF NOT FOUND
       OR v_receipt.actor_profile_id IS DISTINCT FROM p_actor_profile_id
       OR public.booking_cancellation_receipt_is_valid(
         p_booking_id,
         p_couple_id
       ) IS NOT TRUE THEN
      RAISE EXCEPTION 'booking_cancellation_receipt_mismatch'
        USING ERRCODE = '55000';
    END IF;
  ELSIF v_booking.status IN (
    'in_service', 'service_completed', 'settled', 'completed'
  ) THEN
    RAISE EXCEPTION 'booking_not_cancellable' USING ERRCODE = 'P0001';
  ELSE
    IF v_joint_approval_required THEN
      RAISE EXCEPTION 'booking_joint_approval_required'
        USING ERRCODE = 'P0001';
    END IF;
    IF v_raw_bride_id IS NOT NULL
       AND v_raw_bride_id = v_raw_groom_id THEN
      RAISE EXCEPTION 'booking_cancel_actor_not_member'
        USING ERRCODE = '42501';
    END IF;
    v_issue_bride_id := CASE
      WHEN public.is_current_couple_member(v_raw_bride_id, p_couple_id)
        THEN v_raw_bride_id
      ELSE NULL
    END;
    v_issue_groom_id := CASE
      WHEN public.is_current_couple_member(v_raw_groom_id, p_couple_id)
        THEN v_raw_groom_id
      ELSE NULL
    END;
    IF p_actor_profile_id IS DISTINCT FROM v_issue_bride_id
       AND p_actor_profile_id IS DISTINCT FROM v_issue_groom_id THEN
      RAISE EXCEPTION 'booking_cancel_actor_not_member'
        USING ERRCODE = '42501';
    END IF;
    v_issue_required_count := CASE
      WHEN v_issue_bride_id IS NOT NULL
       AND v_issue_groom_id IS NOT NULL THEN 2
      ELSE 1
    END;
    v_roster_fingerprint := md5(
      COALESCE(v_issue_bride_id::text, '-') || ':' ||
      COALESCE(v_issue_groom_id::text, '-')
    );
    IF v_booking.actual_amount < 0 THEN
      RAISE EXCEPTION 'invalid_booking_actual_amount'
        USING ERRCODE = '22023';
    END IF;
    v_cancelled_at := clock_timestamp();
    v_authorization_id := gen_random_uuid();
    INSERT INTO public.booking_cancellation_write_authorizations (
      authorization_id,
      booking_id,
      couple_id,
      actor_profile_id
    ) VALUES (
      v_authorization_id,
      v_booking.id,
      v_booking.couple_id,
      p_actor_profile_id
    );
    PERFORM set_config(
      'hanbang.booking_cancellation_authorization_id',
      v_authorization_id::text,
      true
    );
    UPDATE public.vendor_bookings
    SET status = 'cancelled',
        cancelled_at = v_cancelled_at,
        cancelled_by_profile_id = p_actor_profile_id,
        cancel_reason = v_cancel_reason,
        updated_at = now()
    WHERE id = p_booking_id
      AND couple_id = p_couple_id
    RETURNING * INTO v_booking;
    IF EXISTS (
      SELECT 1
      FROM public.booking_cancellation_write_authorizations AS authz
      WHERE authz.authorization_id = v_authorization_id
    ) THEN
      RAISE EXCEPTION 'booking_cancellation_authorization_not_consumed'
        USING ERRCODE = '55000';
    END IF;
    PERFORM set_config(
      'hanbang.booking_cancellation_authorization_id',
      '',
      true
    );

    v_snapshot_digest := public.booking_cancellation_snapshot_digest(
      v_booking.id,
      v_booking.couple_id,
      p_actor_profile_id,
      v_cancelled_at,
      v_issue_bride_id,
      v_issue_groom_id,
      v_issue_required_count,
      v_roster_fingerprint,
      v_booking.vendor_id,
      v_booking.product_id,
      v_booking.staff_id,
      v_booking.booking_date,
      v_booking.booking_time,
      greatest(COALESCE(v_booking.amount, 0), 0),
      v_booking.actual_amount,
      v_cancel_reason
    );
    INSERT INTO public.booking_cancellation_receipts (
      booking_id,
      couple_id,
      actor_profile_id,
      cancelled_at,
      issue_bride_id,
      issue_groom_id,
      issue_required_count,
      roster_fingerprint,
      vendor_id,
      product_id,
      staff_id,
      booking_date,
      booking_time,
      quoted_amount,
      actual_amount,
      cancel_reason,
      snapshot_digest
    ) VALUES (
      v_booking.id,
      v_booking.couple_id,
      p_actor_profile_id,
      v_cancelled_at,
      v_issue_bride_id,
      v_issue_groom_id,
      v_issue_required_count,
      v_roster_fingerprint,
      v_booking.vendor_id,
      v_booking.product_id,
      v_booking.staff_id,
      v_booking.booking_date,
      v_booking.booking_time,
      greatest(COALESCE(v_booking.amount, 0), 0),
      v_booking.actual_amount,
      v_cancel_reason,
      v_snapshot_digest
    );
  END IF;

  -- The cancellation decision is part of the same transaction as the booking
  -- state and receipt. An HTTP/process crash can no longer leave the required
  -- decision audit missing, and an exact retry repairs an older missing node.
  IF NOT (v_idempotent AND v_joint_approval_required) THEN
    PERFORM public.upsert_booking_internal_cancel_decision(
      v_booking.id,
      p_actor_profile_id
    );
  END IF;

  v_cancelled_at_text := to_char(
    v_booking.cancelled_at AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  RETURN jsonb_build_object(
    'id', v_booking.id,
    'vendor_id', v_booking.vendor_id,
    'product_id', v_booking.product_id,
    'booking_date', v_booking.booking_date,
    'booking_time', to_char(v_booking.booking_time, 'HH24:MI'),
    'status', 'cancelled',
    'amount', v_booking.amount,
    'actual_amount', v_booking.actual_amount,
    'cancelled_at', v_cancelled_at_text,
    'cancelled_by_profile_id', v_booking.cancelled_by_profile_id,
    'cancel_reason', v_booking.cancel_reason,
    'vendor_cancellation_status', 'unconfirmed',
    'refund_status', 'unknown',
    'idempotent', v_idempotent
  );
END;
$function$;

-- The legacy signature cannot safely infer an actor from a service-role JWT.
-- Keep the symbol for compatibility, but fail closed instead of fabricating an
-- audit identity.
CREATE OR REPLACE FUNCTION public.cancel_booking_atomic(
  p_booking_id uuid,
  p_couple_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
BEGIN
  RAISE EXCEPTION 'booking_cancel_actor_required' USING ERRCODE = '22023';
END;
$function$;

ALTER FUNCTION public.cancel_booking_atomic(uuid, uuid, uuid)
  OWNER TO postgres;
ALTER FUNCTION public.cancel_booking_atomic(uuid, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cancel_booking_atomic(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cancel_booking_atomic(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_booking_atomic(uuid, uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_booking_atomic(uuid, uuid)
  TO service_role;

-- Claim payload keeps quote, actual spend, and cancellation audit separate.
CREATE OR REPLACE FUNCTION public.claim_booking_projection_job(
  p_booking_id uuid DEFAULT NULL,
  p_lease_seconds integer DEFAULT 300
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_job public.booking_projection_jobs%ROWTYPE;
  v_booking public.vendor_bookings%ROWTYPE;
  v_vendor record;
  v_claim_token uuid := gen_random_uuid();
  v_cancellation jsonb := NULL;
  v_cancelled_at_text text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_lease_seconds < 30 OR p_lease_seconds > 900 THEN
    RAISE EXCEPTION 'invalid_projection_lease' USING ERRCODE = '22023';
  END IF;

  UPDATE public.booking_projection_jobs
  SET status = 'pending',
      available_at = now(),
      claimed_at = NULL,
      claim_token = NULL,
      completed_at = NULL,
      last_error_code = 'PROCESSING_LEASE_EXPIRED',
      updated_at = now()
  WHERE status = 'processing'
    AND claimed_at < now() - make_interval(secs => p_lease_seconds);

  -- A legacy or forged cancelled row must not poison the global FIFO forever.
  -- Quarantine it durably, then let this claim continue to the next valid job.
  UPDATE public.booking_projection_jobs AS invalid_job
  SET status = 'failed',
      claimed_at = NULL,
      claim_token = NULL,
      completed_at = now(),
      last_error_code = 'BOOKING_CANCELLATION_RECEIPT_INVALID',
      updated_at = now()
  FROM public.vendor_bookings AS invalid_booking
  WHERE invalid_job.booking_id = invalid_booking.id
    AND invalid_job.desired_state = 'cancelled'
    AND invalid_job.status = 'pending'
    AND (
      invalid_booking.status IS DISTINCT FROM 'cancelled'
      OR invalid_booking.cancelled_at IS NULL
      OR invalid_booking.cancelled_by_profile_id IS NULL
      OR public.booking_cancellation_receipt_is_valid(
        invalid_booking.id,
        invalid_job.couple_id
      ) IS NOT TRUE
    );

  SELECT candidate.* INTO v_job
  FROM public.booking_projection_jobs AS candidate
  JOIN public.couples AS projection_couple
    ON projection_couple.id = candidate.couple_id
  WHERE candidate.status = 'pending'
    AND candidate.available_at <= now()
    AND (p_booking_id IS NULL OR candidate.booking_id = p_booking_id)
    AND NOT EXISTS (
      SELECT 1
      FROM public.booking_projection_jobs AS running
      WHERE running.couple_id = candidate.couple_id
        AND running.status = 'processing'
    )
  ORDER BY candidate.available_at, candidate.created_at, candidate.booking_id
  FOR UPDATE OF candidate, projection_couple SKIP LOCKED
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.booking_projection_jobs
  SET status = 'processing',
      attempt_count = attempt_count + 1,
      claimed_at = now(),
      claim_token = v_claim_token,
      completed_at = NULL,
      updated_at = now()
  WHERE booking_id = v_job.booking_id
  RETURNING * INTO v_job;

  SELECT * INTO v_booking
  FROM public.vendor_bookings
  WHERE id = v_job.booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking_projection_context_missing'
      USING ERRCODE = 'P0002';
  END IF;
  SELECT
    COALESCE(v_booking.intent_vendor_name_snapshot, vendor.name, '업체') AS name,
    COALESCE(v_booking.intent_vendor_category_snapshot, vendor.category) AS category
  INTO v_vendor
  FROM (VALUES (true)) AS seed(always_row)
  LEFT JOIN public.vendors AS vendor
    ON vendor.id = v_booking.vendor_id;

  IF v_job.desired_state = 'cancelled' THEN
    IF v_booking.status IS DISTINCT FROM 'cancelled'
       OR v_booking.cancelled_at IS NULL
       OR v_booking.cancelled_by_profile_id IS NULL
       OR public.booking_cancellation_receipt_is_valid(
         v_booking.id,
         v_job.couple_id
       ) IS NOT TRUE THEN
      RAISE EXCEPTION 'booking_cancellation_receipt_mismatch'
        USING ERRCODE = '55000';
    END IF;
    v_cancelled_at_text := to_char(
      v_booking.cancelled_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    );
    v_cancellation := jsonb_build_object(
      'cancelledAt', v_cancelled_at_text,
      'cancelledByProfileId', v_booking.cancelled_by_profile_id
    ) || CASE
      WHEN NULLIF(btrim(COALESCE(v_booking.cancel_reason, '')), '') IS NULL
        THEN '{}'::jsonb
      ELSE jsonb_build_object('reason', v_booking.cancel_reason)
    END;
  END IF;

  RETURN jsonb_build_object(
    'bookingId', v_job.booking_id,
    'coupleId', v_job.couple_id,
    'desiredState', v_job.desired_state,
    'generation', v_job.generation,
    'attemptCount', v_job.attempt_count,
    'claimToken', v_job.claim_token,
    'booking', jsonb_build_object(
      'date', v_booking.booking_date::text,
      'time', to_char(v_booking.booking_time, 'HH24:MI'),
      'quotedAmount', greatest(COALESCE(v_booking.amount, 0), 0),
      'actualAmount', v_booking.actual_amount,
      'cancellation', v_cancellation,
      'status', v_booking.status,
      'vendorId', v_booking.vendor_id,
      'productId', v_booking.product_id,
      'staffId', v_booking.staff_id,
      'vendorName', v_vendor.name,
      'vendorCategory', v_vendor.category
    )
  );
END;
$function$;

ALTER FUNCTION public.claim_booking_projection_job(uuid, integer)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_booking_projection_job(uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_booking_projection_job(uuid, integer)
  TO service_role;

-- Replace only the private implementation renamed by 20260802140000. The
-- public wrapper, nonce table, and journey authorization triggers remain the
-- transaction boundary. Lock order stays job -> journey and exactly one
-- wedding_journeys UPDATE consumes exactly one nonce.
CREATE OR REPLACE FUNCTION public.apply_booking_progress_projection_before_manual_schedule(
  p_couple_id uuid,
  p_booking_id uuid,
  p_desired_state text,
  p_event jsonb,
  p_category_key text,
  p_amount numeric,
  p_generation bigint,
  p_claim_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_job public.booking_projection_jobs%ROWTYPE;
  v_booking public.vendor_bookings%ROWTYPE;
  v_vendor record;
  v_progress jsonb;
  v_events jsonb;
  v_costs jsonb;
  v_existing_event jsonb;
  v_next_event jsonb;
  v_event_id text := 'evt_booking_' || p_booking_id::text;
  v_legacy_event_id text := 'evt_booking_' || left(p_booking_id::text, 8);
  v_source_key text := 'booking:' || p_booking_id::text;
  v_target_event_id text;
  v_category_key text;
  v_existing_category_key text;
  v_stored_category_key text;
  v_previous_category_key text;
  v_stored_cost jsonb;
  v_stored_basis text := 'none';
  v_quote numeric := 0;
  v_actual numeric;
  v_previous_contribution numeric := 0;
  v_next_contribution numeric := 0;
  v_delta numeric := 0;
  v_previous_spent numeric := 0;
  v_next_spent numeric := 0;
  v_budget numeric := 0;
  v_match_count integer := 0;
  v_has_stored_contribution boolean := false;
  v_legacy_quote_evidence boolean := false;
  v_schedule_added boolean := false;
  v_schedule_updated boolean := false;
  v_schedule_cancelled boolean := false;
  v_completed_schedule_preserved boolean := false;
  v_recorded_spend_preserved boolean := false;
  v_quote_corrected boolean := false;
  v_quote_correction_amount numeric := 0;
  v_budget_updated boolean := false;
  v_needs_review boolean := false;
  v_review_reason text;
  v_preserve_cost_ledger boolean := false;
  v_terminal_schedule_preserved boolean := false;
  v_now_text text;
  v_cancelled_at_text text;
  v_cancellation jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_desired_state NOT IN ('active', 'cancelled') THEN
    RAISE EXCEPTION 'invalid_booking_projection_state'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_job
  FROM public.booking_projection_jobs
  WHERE booking_id = p_booking_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'accepted', false, 'reason', 'not_found', 'status', 'missing'
    );
  END IF;
  IF v_job.status <> 'processing'
     OR v_job.claim_token IS DISTINCT FROM p_claim_token THEN
    RETURN jsonb_build_object(
      'accepted', false, 'reason', 'stale_claim', 'status', v_job.status
    );
  END IF;
  IF v_job.generation <> p_generation
     OR v_job.desired_state <> p_desired_state THEN
    UPDATE public.booking_projection_jobs
    SET status = 'pending',
        available_at = now(),
        claimed_at = NULL,
        claim_token = NULL,
        completed_at = NULL,
        last_error_code = 'SUPERSEDED_BY_NEWER_BOOKING_STATE',
        updated_at = now()
    WHERE booking_id = p_booking_id;
    RETURN jsonb_build_object(
      'accepted', false, 'reason', 'superseded', 'status', 'pending'
    );
  END IF;
  IF v_job.couple_id IS DISTINCT FROM p_couple_id THEN
    RAISE EXCEPTION 'booking_projection_claim_mismatch'
      USING ERRCODE = '22023';
  END IF;

  SELECT booking.* INTO v_booking
  FROM public.vendor_bookings AS booking
  WHERE booking.id = p_booking_id
    AND booking.couple_id = p_couple_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking_projection_context_missing'
      USING ERRCODE = 'P0002';
  END IF;
  SELECT
    COALESCE(
      v_booking.intent_vendor_name_snapshot,
      vendor.name,
      '업체'
    ) AS projection_vendor_name,
    COALESCE(
      v_booking.intent_vendor_category_snapshot,
      vendor.category
    ) AS projection_vendor_category
  INTO v_vendor
  FROM (VALUES (true)) AS seed(always_row)
  LEFT JOIN public.vendors AS vendor
    ON vendor.id = v_booking.vendor_id;
  IF v_vendor.projection_vendor_category IS NULL THEN
    RAISE EXCEPTION 'booking_projection_context_missing'
      USING ERRCODE = 'P0002';
  END IF;
  v_quote := greatest(COALESCE(v_booking.amount, 0), 0);
  v_actual := CASE
    WHEN v_booking.actual_amount IS NULL THEN NULL
    ELSE greatest(v_booking.actual_amount, 0)
  END;
  IF p_amount IS NULL
     OR p_amount < 0
     OR trunc(p_amount) <> p_amount
     OR p_amount IS DISTINCT FROM COALESCE(v_actual, 0) THEN
    RAISE EXCEPTION 'booking_projection_amount_mismatch'
      USING ERRCODE = '22023';
  END IF;
  v_category_key := NULLIF(btrim(COALESCE(
    v_booking.intent_vendor_category_snapshot,
    v_vendor.projection_vendor_category,
    ''
  )), '');
  IF NULLIF(btrim(COALESCE(p_category_key, '')), '')
       IS DISTINCT FROM v_category_key
     OR (v_category_key IS NOT NULL AND (
       length(v_category_key) > 80 OR left(v_category_key, 2) = '__'
     )) THEN
    RAISE EXCEPTION 'invalid_booking_projection_category'
      USING ERRCODE = '22023';
  END IF;
  IF (p_desired_state = 'cancelled') IS DISTINCT FROM
     (v_booking.status = 'cancelled') THEN
    RAISE EXCEPTION 'booking_projection_state_mismatch'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(progress, '{}'::jsonb) INTO v_progress
  FROM public.wedding_journeys
  WHERE couple_id = p_couple_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'journey_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_progress ? '__events'
     AND jsonb_typeof(v_progress -> '__events') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid_booking_schedule_projection'
      USING ERRCODE = '22023';
  END IF;
  IF v_progress ? '__booking_costs'
     AND jsonb_typeof(v_progress -> '__booking_costs')
       IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid_booking_cost_projection'
      USING ERRCODE = '22023';
  END IF;
  v_events := COALESCE(v_progress -> '__events', '[]'::jsonb);
  v_costs := COALESCE(v_progress -> '__booking_costs', '{}'::jsonb);
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_events) AS source(event)
    WHERE jsonb_typeof(event) IS DISTINCT FROM 'object'
  ) THEN
    RAISE EXCEPTION 'invalid_booking_schedule_projection'
      USING ERRCODE = '22023';
  END IF;
  SELECT count(*)::integer INTO v_match_count
  FROM jsonb_array_elements(v_events) AS source(event)
  WHERE event ->> 'id' IN (v_event_id, v_legacy_event_id)
     OR event ->> 'sourceKey' = v_source_key;
  IF v_match_count > 1 THEN
    RAISE EXCEPTION 'ambiguous_booking_schedule_projection'
      USING ERRCODE = '22023';
  END IF;
  SELECT event INTO v_existing_event
  FROM jsonb_array_elements(v_events) AS source(event)
  WHERE event ->> 'id' IN (v_event_id, v_legacy_event_id)
     OR event ->> 'sourceKey' = v_source_key
  LIMIT 1;

  v_existing_category_key := NULLIF(
    btrim(COALESCE(v_existing_event ->> 'categoryKey', '')), ''
  );
  IF v_existing_category_key IS NOT NULL AND (
    length(v_existing_category_key) > 80
    OR left(v_existing_category_key, 2) = '__'
  ) THEN
    v_existing_category_key := NULL;
  END IF;
  v_has_stored_contribution := v_costs ? p_booking_id::text;
  v_stored_cost := v_costs -> p_booking_id::text;
  IF v_has_stored_contribution
     AND jsonb_typeof(v_stored_cost) = 'object'
     AND (v_stored_cost ->> 'amount') ~ '^[0-9]+([.][0-9]+)?$' THEN
    v_previous_contribution := (v_stored_cost ->> 'amount')::numeric;
    v_stored_category_key := NULLIF(
      btrim(COALESCE(v_stored_cost ->> 'categoryKey', '')), ''
    );
    v_stored_basis := CASE
      WHEN v_stored_cost ->> 'basis' IN ('none', 'actual')
        THEN v_stored_cost ->> 'basis'
      ELSE 'legacy_unknown'
    END;
  ELSIF v_has_stored_contribution
     AND (v_costs ->> p_booking_id::text) ~ '^[0-9]+([.][0-9]+)?$' THEN
    v_previous_contribution := (v_costs ->> p_booking_id::text)::numeric;
    v_stored_basis := 'legacy_unknown';
  END IF;
  IF v_stored_category_key IS NOT NULL AND (
    length(v_stored_category_key) > 80
    OR left(v_stored_category_key, 2) = '__'
  ) THEN
    v_stored_category_key := NULL;
  END IF;
  -- A persisted ledger category is immutable attribution provenance. A live
  -- vendor reclassification or user-edited schedule category must not move
  -- previously recorded spend.
  v_previous_category_key := v_stored_category_key;
  IF v_stored_category_key IS NOT NULL THEN
    v_category_key := v_stored_category_key;
  END IF;
  v_legacy_quote_evidence := v_actual IS NULL
    AND v_quote > 0
    AND v_stored_basis = 'legacy_unknown'
    AND v_previous_contribution = v_quote;
  IF v_has_stored_contribution
     AND v_previous_contribution > 0
     AND v_stored_category_key IS NULL THEN
    v_needs_review := true;
    v_review_reason := 'LEGACY_BOOKING_CONTRIBUTION_CATEGORY_AMBIGUOUS';
    v_preserve_cost_ledger := true;
  END IF;
  v_now_text := to_char(
    clock_timestamp() AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );

  IF p_desired_state = 'active' THEN
    IF jsonb_typeof(p_event) IS DISTINCT FROM 'object'
       OR p_event ->> 'date' IS DISTINCT FROM v_booking.booking_date::text
       OR p_event ->> 'time' IS DISTINCT FROM
          to_char(v_booking.booking_time, 'HH24:MI') THEN
      RAISE EXCEPTION 'booking_projection_event_required'
        USING ERRCODE = '22023';
    END IF;
    IF v_existing_event IS NULL THEN
      v_target_event_id := v_event_id;
      v_next_event := (p_event - 'cancellation') || jsonb_build_object(
        'id', v_target_event_id,
        'sourceKey', v_source_key,
        'status', 'planned',
        'memo', '아모라 내부 방문·상담 후보 견적: '
          || trunc(v_quote)::text
          || '원 · 결제·지출 기록 아님 · 업체 전달·확정 미확인',
        'createdAt', COALESCE(
          p_event -> 'createdAt',
          to_jsonb(v_now_text)
        ),
        'updatedAt', COALESCE(p_event -> 'updatedAt', to_jsonb(v_now_text))
      );
      v_events := v_events || jsonb_build_array(v_next_event);
      v_schedule_added := true;
    ELSIF COALESCE(v_existing_event ->> 'status', 'planned')
      IN ('completed', 'cancelled') THEN
      -- Terminal schedule state and every user-owned field are canonical.
      -- Outcome/actual-spend repair may reconcile only the ledger below.
      v_next_event := v_existing_event;
      v_terminal_schedule_preserved := true;
      v_completed_schedule_preserved :=
        v_existing_event ->> 'status' = 'completed';
    ELSE
      v_target_event_id := COALESCE(v_existing_event ->> 'id', v_event_id);
      v_next_event := v_existing_event || jsonb_build_object(
        'id', v_target_event_id,
        'sourceKey', v_source_key,
        'date', v_booking.booking_date::text,
        'time', to_char(v_booking.booking_time, 'HH24:MI')
      );
      IF v_next_event IS DISTINCT FROM v_existing_event THEN
        v_next_event := v_next_event || jsonb_build_object(
          'updatedAt', v_now_text
        );
      END IF;
      SELECT COALESCE(jsonb_agg(
        CASE
          WHEN event ->> 'id' IN (v_event_id, v_legacy_event_id)
            OR event ->> 'sourceKey' = v_source_key
            THEN v_next_event
          ELSE event
        END ORDER BY ordinality
      ), '[]'::jsonb)
      INTO v_events
      FROM jsonb_array_elements(v_events) WITH ORDINALITY
        AS source(event, ordinality);
      v_schedule_updated := v_existing_event IS DISTINCT FROM v_next_event;
    END IF;

    v_next_contribution := CASE
      WHEN v_category_key IS NOT NULL AND v_actual IS NOT NULL THEN v_actual
      WHEN v_stored_basis IN ('actual', 'legacy_unknown')
        THEN v_previous_contribution
      ELSE 0
    END;
    IF v_stored_basis = 'legacy_unknown' AND v_previous_contribution > 0 THEN
      v_needs_review := true;
      v_review_reason := 'LEGACY_BOOKING_CONTRIBUTION_PROVENANCE_AMBIGUOUS';
      v_preserve_cost_ledger := true;
    END IF;
  ELSE
    IF v_booking.cancelled_at IS NULL
       OR v_booking.cancelled_by_profile_id IS NULL
       OR public.booking_cancellation_receipt_is_valid(
         v_booking.id,
         p_couple_id
       ) IS NOT TRUE THEN
      RAISE EXCEPTION 'booking_cancellation_receipt_mismatch'
        USING ERRCODE = '55000';
    END IF;
    v_cancelled_at_text := to_char(
      v_booking.cancelled_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    );
    v_cancellation := jsonb_build_object(
      'cancelledAt', v_cancelled_at_text,
      'cancelledByProfileId', v_booking.cancelled_by_profile_id
    ) || CASE
      WHEN NULLIF(btrim(COALESCE(v_booking.cancel_reason, '')), '') IS NULL
        THEN '{}'::jsonb
      ELSE jsonb_build_object('reason', v_booking.cancel_reason)
    END;
    IF v_existing_event IS NULL THEN
      v_next_event := jsonb_build_object(
        'id', v_event_id,
        'date', v_booking.booking_date::text,
        'time', to_char(v_booking.booking_time, 'HH24:MI'),
        'title', to_char(v_booking.booking_time, 'HH24:MI') || ' '
          || COALESCE(v_vendor.projection_vendor_name, '업체') || ' 상담',
        'memo', '아모라 내부 예약 요청 금액(견적): '
          || trunc(v_quote)::text
          || '원 · 결제·지출 기록 아님 · 업체 전달·확정 미확인',
        'categoryKey', v_category_key,
        'sourceKey', v_source_key,
        'status', 'cancelled',
        'cancellation', v_cancellation,
        'createdAt', v_cancelled_at_text,
        'updatedAt', v_cancelled_at_text
      );
      v_events := v_events || jsonb_build_array(v_next_event);
      v_schedule_added := true;
      v_schedule_cancelled := true;
    ELSIF COALESCE(v_existing_event ->> 'status', 'planned') = 'completed' THEN
      v_next_event := v_existing_event;
      v_completed_schedule_preserved := true;
    ELSIF COALESCE(v_existing_event ->> 'status', 'planned') = 'cancelled' THEN
      -- A user may have cancelled the schedule item before cancelling the
      -- internal booking record. Preserve that first, canonical schedule audit
      -- instead of overwriting it with the later booking-row audit.
      IF jsonb_typeof(v_existing_event -> 'cancellation')
           IS DISTINCT FROM 'object'
         OR (v_existing_event -> 'cancellation')
              - ARRAY['cancelledAt', 'cancelledByProfileId', 'reason']
              <> '{}'::jsonb
         OR length(COALESCE(
              v_existing_event -> 'cancellation' ->> 'cancelledAt', ''
            )) > 100
         OR COALESCE(v_existing_event -> 'cancellation' ->> 'cancelledAt', '')
              !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,3})?(Z|[+-][0-9]{2}:[0-9]{2})$'
         OR COALESCE(
              v_existing_event -> 'cancellation' ->> 'cancelledByProfileId', ''
            ) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         OR (
           (v_existing_event -> 'cancellation') ? 'reason'
           AND (
             jsonb_typeof(v_existing_event -> 'cancellation' -> 'reason')
               IS DISTINCT FROM 'string'
             OR length(v_existing_event -> 'cancellation' ->> 'reason')
               NOT BETWEEN 1 AND 500
           )
         ) THEN
        RAISE EXCEPTION 'invalid_booking_schedule_cancellation'
          USING ERRCODE = '22023';
      END IF;
      v_next_event := v_existing_event;
    ELSE
      v_next_event := v_existing_event || jsonb_build_object(
        'status', 'cancelled',
        'cancellation', v_cancellation,
        'updatedAt', v_cancelled_at_text
      );
      SELECT COALESCE(jsonb_agg(
        CASE
          WHEN event ->> 'id' IN (v_event_id, v_legacy_event_id)
            OR event ->> 'sourceKey' = v_source_key
            THEN v_next_event
          ELSE event
        END ORDER BY ordinality
      ), '[]'::jsonb)
      INTO v_events
      FROM jsonb_array_elements(v_events) WITH ORDINALITY
        AS source(event, ordinality);
      v_schedule_cancelled := true;
    END IF;

    v_category_key := COALESCE(v_previous_category_key, v_category_key);
    v_recorded_spend_preserved := v_actual IS NOT NULL
      OR v_stored_basis = 'actual';
    IF v_category_key IS NULL THEN
      v_next_contribution := 0;
    ELSIF v_actual IS NOT NULL THEN
      v_next_contribution := v_actual;
    ELSIF v_legacy_quote_evidence THEN
      -- A legacy quote-shaped ledger is not an immutable proof that the quote
      -- itself was added to spend. Preserve both aggregate and ledger for
      -- manual review instead of subtracting potentially unrelated money.
      v_next_contribution := v_previous_contribution;
      v_needs_review := true;
      v_review_reason := 'LEGACY_BOOKING_CONTRIBUTION_PROVENANCE_AMBIGUOUS';
      v_preserve_cost_ledger := true;
    ELSE
      v_next_contribution := v_previous_contribution;
    END IF;
  END IF;

  IF v_category_key IS NOT NULL AND NOT v_preserve_cost_ledger THEN
    v_previous_spent := CASE
      WHEN (v_progress -> v_category_key ->> 'spent')
        ~ '^[0-9]+([.][0-9]+)?$'
        THEN (v_progress -> v_category_key ->> 'spent')::numeric
      ELSE 0
    END;
    v_budget := CASE
      WHEN (v_progress -> v_category_key ->> 'budget')
        ~ '^[0-9]+([.][0-9]+)?$'
        THEN (v_progress -> v_category_key ->> 'budget')::numeric
      ELSE 0
    END;
    v_delta := v_next_contribution - v_previous_contribution;
    IF v_delta < 0 AND v_previous_spent < abs(v_delta) THEN
      v_needs_review := true;
      v_review_reason := 'BOOKING_CONTRIBUTION_AGGREGATE_UNDERFLOW';
      v_preserve_cost_ledger := true;
      v_next_contribution := v_previous_contribution;
      v_delta := 0;
    END IF;
    v_next_spent := v_previous_spent + v_delta;
    IF v_delta <> 0 THEN
      v_progress := jsonb_set(
        v_progress,
        ARRAY[v_category_key],
        CASE
          WHEN jsonb_typeof(v_progress -> v_category_key) = 'object'
            THEN v_progress -> v_category_key
          ELSE '{}'::jsonb
        END || jsonb_build_object('spent', v_next_spent),
        true
      );
      v_budget_updated := true;
    END IF;
  END IF;
  IF NOT v_preserve_cost_ledger THEN
    v_costs := jsonb_set(
      v_costs,
      ARRAY[p_booking_id::text],
      jsonb_build_object(
        'amount', CASE WHEN v_category_key IS NULL THEN 0 ELSE v_next_contribution END,
        'categoryKey', v_category_key,
        'basis', CASE
          WHEN v_category_key IS NOT NULL
            AND (v_actual IS NOT NULL OR (
              v_actual IS NULL AND v_stored_basis = 'actual'
                AND NOT v_quote_corrected
            )) THEN 'actual'
          ELSE 'none'
        END,
        'quotedAmount', v_quote
      ),
      true
    );
  END IF;
  v_progress := jsonb_set(v_progress, '{__events}', v_events, true);
  v_progress := jsonb_set(v_progress, '{__booking_costs}', v_costs, true);

  UPDATE public.wedding_journeys
  SET progress = v_progress,
      updated_at = now()
  WHERE couple_id = p_couple_id;

  UPDATE public.booking_projection_jobs
  SET status = 'completed',
      claimed_at = NULL,
      claim_token = NULL,
      completed_at = now(),
      last_error_code = CASE
        WHEN v_needs_review THEN 'BOOKING_PROJECTION_REVIEW_REQUIRED'
        ELSE NULL
      END,
      needs_review = v_needs_review,
      review_reason = v_review_reason,
      updated_at = now()
  WHERE booking_id = p_booking_id;

  RETURN jsonb_build_object(
    'accepted', true,
    'status', 'completed',
    'progress', v_progress,
    'event', v_next_event,
    'scheduleAdded', v_schedule_added,
    'scheduleUpdated', v_schedule_updated,
    'scheduleCancelled', v_schedule_cancelled,
    'completedSchedulePreserved', v_completed_schedule_preserved,
    'terminalSchedulePreserved', v_terminal_schedule_preserved,
    'recordedSpendPreserved', v_recorded_spend_preserved,
    'quoteContributionCorrected', v_quote_corrected,
    'quoteCorrectionAmount', v_quote_correction_amount,
    'needsReview', v_needs_review,
    'reviewReason', v_review_reason,
    'scheduleRemoved', false,
    'budgetUpdated', v_budget_updated,
    'budgetReverted', false,
    'budgetDelta', v_delta,
    'budgetExceededBy', CASE
      WHEN v_budget > 0 AND v_next_spent > v_budget
        THEN v_next_spent - v_budget
      ELSE 0
    END,
    'categoryBudgetLimit', v_budget,
    'categoryKey', v_category_key,
    'newSpent', CASE WHEN v_budget_updated THEN v_next_spent ELSE NULL END,
    'revertedAmount', 0,
    'removedEventId', NULL
  );
END;
$function$;

ALTER FUNCTION public.apply_booking_progress_projection_before_manual_schedule(
  uuid, uuid, text, jsonb, text, numeric, bigint, uuid
) OWNER TO postgres;
REVOKE ALL ON FUNCTION
  public.apply_booking_progress_projection_before_manual_schedule(
    uuid, uuid, text, jsonb, text, numeric, bigint, uuid
  ) FROM PUBLIC, anon, authenticated, service_role;

-- Do not sweep/requeue historical active rows during an expand migration.
-- Ambiguous legacy ledgers remain byte-preserved and require review. New
-- intent/outcome/cancellation writes enqueue their own exact outbox generation.

UPDATE public.booking_projection_jobs AS invalid_job
SET status = 'failed',
    claimed_at = NULL,
    claim_token = NULL,
    completed_at = now(),
    last_error_code = 'BOOKING_CANCELLATION_RECEIPT_INVALID',
    updated_at = now()
FROM public.vendor_bookings AS invalid_booking
WHERE invalid_job.booking_id = invalid_booking.id
  AND invalid_job.desired_state = 'cancelled'
  AND invalid_job.status IN ('pending', 'processing')
  AND (
    invalid_booking.status IS DISTINCT FROM 'cancelled'
    OR invalid_booking.cancelled_at IS NULL
    OR invalid_booking.cancelled_by_profile_id IS NULL
    OR public.booking_cancellation_receipt_is_valid(
      invalid_booking.id,
      invalid_job.couple_id
    ) IS NOT TRUE
  );

DO $booking_cancellation_receipt_postchecks$
BEGIN
  IF NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_class AS relation
       WHERE relation.oid =
         'public.booking_cancellation_receipts'::regclass
         AND relation.relrowsecurity
     )
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_policy AS policy
       WHERE policy.polrelid =
         'public.booking_cancellation_receipts'::regclass
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_class AS relation
       WHERE relation.oid =
         'public.booking_cancellation_write_authorizations'::regclass
         AND relation.relrowsecurity
     )
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_policy AS policy
       WHERE policy.polrelid =
         'public.booking_cancellation_write_authorizations'::regclass
     )
     OR has_table_privilege(
       'service_role', 'public.booking_cancellation_receipts', 'SELECT'
     )
     OR has_table_privilege(
       'service_role', 'public.booking_cancellation_receipts', 'INSERT'
     )
     OR has_table_privilege(
       'service_role', 'public.booking_cancellation_receipts', 'UPDATE'
     )
     OR has_table_privilege(
       'service_role', 'public.booking_cancellation_receipts', 'DELETE'
     )
     OR has_table_privilege(
       'service_role',
       'public.booking_cancellation_write_authorizations',
       'SELECT'
     )
     OR has_table_privilege(
       'service_role',
       'public.booking_cancellation_write_authorizations',
       'INSERT'
     )
     OR has_table_privilege(
       'service_role',
       'public.booking_cancellation_write_authorizations',
       'UPDATE'
     )
     OR has_table_privilege(
       'service_role',
       'public.booking_cancellation_write_authorizations',
       'DELETE'
     )
     OR has_function_privilege(
       'service_role',
       'public.booking_cancellation_snapshot_digest(uuid,uuid,uuid,timestamp with time zone,uuid,uuid,smallint,text,uuid,uuid,uuid,date,time without time zone,numeric,numeric,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.booking_cancellation_receipt_is_valid(uuid,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.reject_booking_cancellation_receipt_rewrite()',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.enforce_cancelled_booking_snapshot()',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.authorize_booking_cancellation_transition()',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'booking_cancellation_receipt_boundary_invalid';
  END IF;
END
$booking_cancellation_receipt_postchecks$;

DO $booking_intent_outcome_boundary_postchecks$
BEGIN
  IF NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_class AS relation
       WHERE relation.oid =
         'public.booking_intent_write_authorizations'::regclass
         AND relation.relrowsecurity
     )
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_policy AS policy
       WHERE policy.polrelid =
         'public.booking_intent_write_authorizations'::regclass
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_class AS relation
       WHERE relation.oid =
         'public.booking_outcome_write_authorizations'::regclass
         AND relation.relrowsecurity
     )
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_policy AS policy
       WHERE policy.polrelid =
         'public.booking_outcome_write_authorizations'::regclass
     )
     OR has_table_privilege(
       'service_role', 'public.booking_intent_write_authorizations', 'SELECT'
     )
     OR has_table_privilege(
       'service_role', 'public.booking_intent_write_authorizations', 'INSERT'
     )
     OR has_table_privilege(
       'service_role', 'public.booking_intent_write_authorizations', 'UPDATE'
     )
     OR has_table_privilege(
       'service_role', 'public.booking_intent_write_authorizations', 'DELETE'
     )
     OR has_table_privilege(
       'service_role', 'public.booking_outcome_write_authorizations', 'SELECT'
     )
     OR has_table_privilege(
       'service_role', 'public.booking_outcome_write_authorizations', 'INSERT'
     )
     OR has_table_privilege(
       'service_role', 'public.booking_outcome_write_authorizations', 'UPDATE'
     )
     OR has_table_privilege(
       'service_role', 'public.booking_outcome_write_authorizations', 'DELETE'
     )
     OR has_function_privilege(
       'service_role', 'public.authorize_booking_protected_write()', 'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.upsert_amora_booking_intent_decision(uuid,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.create_booking_atomic(uuid,uuid,date,text,uuid,uuid,text,text,text,text,numeric,text)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.create_amora_booking_intent_atomic(uuid,uuid,uuid,date,text,uuid,uuid,text,text,text,text,text)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.complete_amora_booking_outcome_atomic(uuid,uuid,numeric,numeric,integer,text,boolean)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.create_amora_booking_intent_atomic(uuid,uuid,uuid,date,text,uuid,uuid,text,text,text,text,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.complete_amora_booking_outcome_atomic(uuid,uuid,numeric,numeric,integer,text,boolean)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'booking_intent_outcome_boundary_invalid';
  END IF;

  IF to_regprocedure(
       'public.complete_vendor_booking_outcome(uuid,uuid,numeric,numeric,integer,text,boolean)'
     ) IS NOT NULL
     AND has_function_privilege(
       'service_role',
       'public.complete_vendor_booking_outcome(uuid,uuid,numeric,numeric,integer,text,boolean)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'booking_legacy_outcome_boundary_invalid';
  END IF;
END
$booking_intent_outcome_boundary_postchecks$;

COMMENT ON TABLE public.booking_cancellation_receipts IS
  'Private immutable proof that a current roster member cancelled an Amora internal booking record at issuance; never vendor cancellation or refund evidence.';

COMMENT ON FUNCTION public.apply_booking_progress_projection_before_manual_schedule(
  uuid, uuid, text, jsonb, text, numeric, bigint, uuid
) IS
  'Private booking projection implementation: quote is provenance only, explicit actual_amount is spend, cancellation soft-cancels with exact audit. Invoked only through the nonce-protected public wrapper.';

COMMIT;
