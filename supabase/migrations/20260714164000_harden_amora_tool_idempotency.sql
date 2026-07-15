-- Amora mutating-tool idempotency and booking exact-retry hardening.
--
-- Safety properties:
--   1. One couple cannot hold two active bookings at the same vendor/date/time,
--      even when the slot capacity is greater than one.
--   2. create_booking_atomic returns the existing booking for an exact retry and
--      rejects a conflicting product/staff request for the occupied couple slot.
--   3. cancel_booking_atomic is row-locked and exact-retry safe. The application
--      may safely retry its idempotent schedule/budget reconciliation afterward.
--   4. Every Amora mutating tool is claimed by request + canonical operation.
--      A process crash leaves the operation uncertain; it is never automatically
--      reclaimed because the database cannot prove whether an external effect ran.

SET lock_timeout = '5s';
SET statement_timeout = '30s';

-- Do not silently decide which legacy duplicate is authoritative. A migration
-- failure here is an intentional release gate requiring an operator review.
DO $preflight$
DECLARE
  v_duplicate_groups integer;
BEGIN
  SELECT count(*)::integer
    INTO v_duplicate_groups
  FROM (
    SELECT couple_id, vendor_id, booking_date, booking_time
    FROM public.vendor_bookings
    WHERE status IS DISTINCT FROM 'cancelled'
    GROUP BY couple_id, vendor_id, booking_date, booking_time
    HAVING count(*) > 1
  ) AS duplicates;

  IF v_duplicate_groups > 0 THEN
    RAISE EXCEPTION 'ACTIVE_COUPLE_BOOKING_DUPLICATES_REQUIRE_REVIEW:%',
      v_duplicate_groups
      USING ERRCODE = '23505';
  END IF;
END;
$preflight$;

CREATE UNIQUE INDEX IF NOT EXISTS vendor_bookings_one_active_couple_vendor_slot
  ON public.vendor_bookings (couple_id, vendor_id, booking_date, booking_time)
  WHERE status IS DISTINCT FROM 'cancelled';

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
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_day integer;
  v_hour integer;
  v_max_bookings integer;
  v_existing_count integer;
  v_booking_id uuid;
  v_existing public.vendor_bookings%ROWTYPE;
  v_staff_has_schedule boolean := false;
  v_product_has_schedule boolean := false;
  v_booking_time_typed time;
  v_amount numeric := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'BOOKING_SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;

  IF p_vendor_id IS NULL
     OR p_couple_id IS NULL
     OR p_booking_date IS NULL
     OR p_booking_time IS NULL
     OR p_booking_time !~ '^(?:[01][0-9]|2[0-3]):00$'
     OR p_booking_type IS NULL
     OR char_length(btrim(p_booking_type)) NOT BETWEEN 1 AND 40 THEN
    RAISE EXCEPTION 'invalid_booking_input' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.vendors
    WHERE id = p_vendor_id
      AND status = 'approved'
  ) THEN
    RAISE EXCEPTION 'vendor_unavailable' USING ERRCODE = 'P0001';
  END IF;

  IF p_product_id IS NOT NULL THEN
    -- The database is the financial source of truth. p_amount remains in the
    -- signature only for mixed-version callers and is deliberately ignored.
    SELECT COALESCE(product.discount_price, product.price)
    INTO v_amount
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
    FROM public.vendor_staff
    WHERE id = p_staff_id
      AND vendor_id = p_vendor_id
  ) THEN
    RAISE EXCEPTION 'invalid_staff_vendor' USING ERRCODE = 'P0001';
  END IF;

  v_day := (EXTRACT(DOW FROM p_booking_date)::integer + 6) % 7;
  v_hour := split_part(p_booking_time, ':', 1)::integer;
  v_booking_time_typed := p_booking_time::time;

  IF p_booking_date + v_booking_time_typed <= (now() AT TIME ZONE 'Asia/Seoul') THEN
    RAISE EXCEPTION 'past_booking_datetime' USING ERRCODE = '22023';
  END IF;

  -- Serialize the domain invariant even when two requests select different
  -- staff/product timeslot rows. Hash collisions only serialize unrelated work.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_couple_id::text || ':' || p_vendor_id::text || ':' ||
    p_booking_date::text || ':' || v_booking_time_typed::text,
    0
  ));

  SELECT *
    INTO v_existing
  FROM public.vendor_bookings
  WHERE couple_id = p_couple_id
    AND vendor_id = p_vendor_id
    AND booking_date = p_booking_date
    AND booking_time = v_booking_time_typed
    AND status IS DISTINCT FROM 'cancelled'
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.product_id IS NOT DISTINCT FROM p_product_id
       AND v_existing.staff_id IS NOT DISTINCT FROM p_staff_id
       AND v_existing.booking_type IS NOT DISTINCT FROM p_booking_type THEN
      RETURN v_existing.id;
    END IF;

    RAISE EXCEPTION 'duplicate_couple_slot' USING
      ERRCODE = '23505',
      DETAIL = 'The couple already has a different active booking at this vendor/date/time';
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
    SELECT max_bookings
      INTO v_max_bookings
    FROM public.staff_timeslots
    WHERE staff_id = p_staff_id
      AND day = v_day
      AND hour = v_hour
      AND available = true
    LIMIT 1
    FOR UPDATE;
  ELSIF v_product_has_schedule THEN
    SELECT max_bookings
      INTO v_max_bookings
    FROM public.product_timeslots
    WHERE product_id = p_product_id
      AND day = v_day
      AND hour = v_hour
      AND available = true
    LIMIT 1
    FOR UPDATE;
  ELSE
    SELECT max_bookings
      INTO v_max_bookings
    FROM public.vendor_timeslots
    WHERE vendor_id = p_vendor_id
      AND day = v_day
      AND hour = v_hour
      AND available = true
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF v_max_bookings IS NULL OR v_max_bookings <= 0 THEN
    RAISE EXCEPTION 'slot_unavailable' USING ERRCODE = 'P0001';
  END IF;

  IF v_staff_has_schedule THEN
    SELECT count(*)::integer INTO v_existing_count
    FROM public.vendor_bookings
    WHERE vendor_id = p_vendor_id
      AND staff_id = p_staff_id
      AND booking_date = p_booking_date
      AND booking_time = v_booking_time_typed
      AND status IS DISTINCT FROM 'cancelled';
  ELSIF v_product_has_schedule THEN
    SELECT count(*)::integer INTO v_existing_count
    FROM public.vendor_bookings
    WHERE vendor_id = p_vendor_id
      AND product_id = p_product_id
      AND booking_date = p_booking_date
      AND booking_time = v_booking_time_typed
      AND status IS DISTINCT FROM 'cancelled';
  ELSE
    SELECT count(*)::integer INTO v_existing_count
    FROM public.vendor_bookings
    WHERE vendor_id = p_vendor_id
      AND booking_date = p_booking_date
      AND booking_time = v_booking_time_typed
      AND status IS DISTINCT FROM 'cancelled';
  END IF;

  IF v_existing_count >= v_max_bookings THEN
    RAISE EXCEPTION 'slot_full' USING
      ERRCODE = 'P0001',
      DETAIL = format('capacity %s/%s reached', v_existing_count, v_max_bookings);
  END IF;

  INSERT INTO public.vendor_bookings (
    vendor_id, couple_id, product_id, staff_id,
    booking_date, booking_time, booking_type,
    bride_name, groom_name, contact_phone,
    status, amount, is_paid, memo
  ) VALUES (
    p_vendor_id, p_couple_id, p_product_id, p_staff_id,
    p_booking_date, v_booking_time_typed, p_booking_type,
    left(COALESCE(p_bride_name, ''), 120),
    left(COALESCE(p_groom_name, ''), 120),
    left(COALESCE(p_contact_phone, ''), 40),
    'pending', v_amount, false, left(COALESCE(p_memo, ''), 1000)
  )
  RETURNING id INTO v_booking_id;

  RETURN v_booking_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_booking_atomic(
  uuid, uuid, date, text, uuid, uuid, text, text, text, text, numeric, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_booking_atomic(
  uuid, uuid, date, text, uuid, uuid, text, text, text, text, numeric, text
) TO service_role;

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
DECLARE
  v_booking public.vendor_bookings%ROWTYPE;
  v_idempotent boolean := false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'BOOKING_CANCEL_SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;

  IF p_booking_id IS NULL OR p_couple_id IS NULL THEN
    RAISE EXCEPTION 'invalid_booking_input' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_booking
  FROM public.vendor_bookings
  WHERE id = p_booking_id
    AND couple_id = p_couple_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_booking.status = 'cancelled' THEN
    v_idempotent := true;
  ELSIF v_booking.status IN ('in_service', 'service_completed', 'settled', 'completed') THEN
    RAISE EXCEPTION 'booking_not_cancellable' USING ERRCODE = 'P0001';
  ELSE
    UPDATE public.vendor_bookings
    SET status = 'cancelled', updated_at = now()
    WHERE id = p_booking_id
      AND couple_id = p_couple_id
    RETURNING * INTO v_booking;
  END IF;

  RETURN jsonb_build_object(
    'id', v_booking.id,
    'vendor_id', v_booking.vendor_id,
    'product_id', v_booking.product_id,
    'booking_date', v_booking.booking_date,
    'booking_time', to_char(v_booking.booking_time, 'HH24:MI'),
    'status', 'cancelled',
    'amount', v_booking.amount,
    'idempotent', v_idempotent
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_booking_atomic(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_booking_atomic(uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.apply_budget_plan_atomic(
  p_couple_id uuid,
  p_total_budget numeric,
  p_progress_patch jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_progress jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'BUDGET_PLAN_SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;

  IF p_couple_id IS NULL
     OR p_total_budget IS NULL
     OR p_total_budget < 0
     OR p_total_budget > 1000000000000
     OR p_progress_patch IS NULL
     OR jsonb_typeof(p_progress_patch) <> 'object'
     OR octet_length(p_progress_patch::text) > 262144 THEN
    RAISE EXCEPTION 'invalid_budget_plan_input' USING ERRCODE = '22023';
  END IF;

  UPDATE public.wedding_journeys
  SET total_budget = p_total_budget,
      progress = COALESCE(progress, '{}'::jsonb) || p_progress_patch
  WHERE couple_id = p_couple_id
  RETURNING progress INTO v_progress;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'wedding_journey_not_found' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_progress;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_budget_plan_atomic(uuid, numeric, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_budget_plan_atomic(uuid, numeric, jsonb)
  TO service_role;

CREATE TABLE IF NOT EXISTS public.amora_tool_executions (
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  request_key text NOT NULL,
  operation_key text NOT NULL,
  tool_name text NOT NULL,
  input_digest text NOT NULL,
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'completed', 'uncertain')),
  result jsonb,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  uncertain_at timestamptz,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (couple_id, request_key, operation_key),
  CHECK (char_length(request_key) BETWEEN 1 AND 160),
  CHECK (operation_key ~ '^[0-9a-f]{64}$'),
  CHECK (input_digest ~ '^[0-9a-f]{64}$'),
  CHECK (char_length(tool_name) BETWEEN 1 AND 80),
  CHECK ((status = 'completed') = (result IS NOT NULL))
);

ALTER TABLE public.amora_tool_executions ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.amora_tool_executions
  FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.amora_tool_executions TO service_role;

CREATE INDEX IF NOT EXISTS amora_tool_executions_status_claimed_idx
  ON public.amora_tool_executions (status, claimed_at);

CREATE OR REPLACE FUNCTION public.claim_amora_tool_execution(
  p_couple_id uuid,
  p_request_key text,
  p_operation_key text,
  p_tool_name text,
  p_input_digest text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_execution public.amora_tool_executions%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_TOOL_CLAIM_SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;

  IF p_couple_id IS NULL
     OR p_request_key !~* '^chat:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR p_operation_key !~ '^[0-9a-f]{64}$'
     OR p_input_digest !~ '^[0-9a-f]{64}$'
     OR p_tool_name NOT IN (
       'update_budget', 'update_wedding_date', 'update_task_status', 'update_venue',
       'update_category_budget', 'apply_budget_plan', 'add_custom_category',
       'delete_category', 'reset_category', 'add_schedule_event',
       'update_schedule_event', 'delete_schedule_event', 'toggle_checklist_item',
       'add_amora_action', 'update_amora_action', 'log_wedding_event',
       'create_booking', 'cancel_booking'
     ) THEN
    RAISE EXCEPTION 'AMORA_TOOL_CLAIM_INVALID_INPUT' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.amora_tool_executions (
    couple_id, request_key, operation_key, tool_name, input_digest
  ) VALUES (
    p_couple_id, p_request_key, p_operation_key, p_tool_name, p_input_digest
  )
  ON CONFLICT (couple_id, request_key, operation_key) DO NOTHING
  RETURNING * INTO v_execution;

  IF FOUND THEN
    RETURN jsonb_build_object('action', 'acquired');
  END IF;

  SELECT * INTO v_execution
  FROM public.amora_tool_executions
  WHERE couple_id = p_couple_id
    AND request_key = p_request_key
    AND operation_key = p_operation_key
  FOR UPDATE;

  IF v_execution.tool_name <> p_tool_name
     OR v_execution.input_digest <> p_input_digest THEN
    RETURN jsonb_build_object('action', 'conflict');
  END IF;

  IF v_execution.status = 'completed' THEN
    RETURN jsonb_build_object('action', 'completed', 'result', v_execution.result);
  END IF;

  IF v_execution.status = 'uncertain' THEN
    RETURN jsonb_build_object('action', 'uncertain');
  END IF;

  -- A process can disappear after the mutation claim and before its completion
  -- marker. Never execute it again, but do not leave callers seeing
  -- `in_progress` forever: expire the lease into an operator-review state.
  IF v_execution.status = 'processing'
     AND v_execution.claimed_at < now() - interval '6 minutes' THEN
    UPDATE public.amora_tool_executions
    SET status = 'uncertain',
        uncertain_at = now(),
        failure_code = 'PROCESSING_LEASE_EXPIRED',
        updated_at = now()
    WHERE couple_id = p_couple_id
      AND request_key = p_request_key
      AND operation_key = p_operation_key
      AND status = 'processing';
    RETURN jsonb_build_object('action', 'uncertain');
  END IF;

  RETURN jsonb_build_object('action', 'in_progress');
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_amora_tool_execution(
  p_couple_id uuid,
  p_request_key text,
  p_operation_key text,
  p_result jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_rows integer;
  v_existing jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_TOOL_COMPLETE_SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;

  IF p_result IS NULL
     OR jsonb_typeof(p_result) <> 'object'
     OR p_result ? 'toolInput'
     OR octet_length(p_result::text) > 65536 THEN
    RAISE EXCEPTION 'AMORA_TOOL_COMPLETE_INVALID_RESULT' USING ERRCODE = '22023';
  END IF;

  UPDATE public.amora_tool_executions
  SET status = 'completed',
      result = p_result,
      completed_at = now(),
      uncertain_at = NULL,
      failure_code = NULL,
      updated_at = now()
  WHERE couple_id = p_couple_id
    AND request_key = p_request_key
    AND operation_key = p_operation_key
    AND status = 'processing';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 1 THEN
    RETURN true;
  END IF;

  SELECT result INTO v_existing
  FROM public.amora_tool_executions
  WHERE couple_id = p_couple_id
    AND request_key = p_request_key
    AND operation_key = p_operation_key
    AND status = 'completed';

  RETURN FOUND AND v_existing = p_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_amora_tool_execution_uncertain(
  p_couple_id uuid,
  p_request_key text,
  p_operation_key text,
  p_failure_code text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_rows integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_TOOL_UNCERTAIN_SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;

  UPDATE public.amora_tool_executions
  SET status = 'uncertain',
      result = NULL,
      uncertain_at = now(),
      failure_code = left(regexp_replace(
        upper(COALESCE(p_failure_code, 'UNKNOWN')),
        '[^A-Z0-9_]', '', 'g'
      ), 64),
      updated_at = now()
  WHERE couple_id = p_couple_id
    AND request_key = p_request_key
    AND operation_key = p_operation_key
    AND status = 'processing';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_amora_tool_execution(uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_amora_tool_execution(uuid, text, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mark_amora_tool_execution_uncertain(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_amora_tool_execution(uuid, text, text, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_amora_tool_execution(uuid, text, text, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_amora_tool_execution_uncertain(uuid, text, text, text)
  TO service_role;

COMMENT ON INDEX public.vendor_bookings_one_active_couple_vendor_slot IS
  'Prevents one couple from holding duplicate active bookings at one vendor/date/time.';
COMMENT ON TABLE public.amora_tool_executions IS
  'Service-only exact-retry ledger for Amora mutating tools. Uncertain work is never auto-reclaimed.';

DO $postcondition$
BEGIN
  IF NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_class AS index_class
       JOIN pg_catalog.pg_namespace AS namespace
         ON namespace.oid = index_class.relnamespace
       JOIN pg_catalog.pg_index AS index_state
         ON index_state.indexrelid = index_class.oid
       WHERE namespace.nspname = 'public'
         AND index_class.relname = 'vendor_bookings_one_active_couple_vendor_slot'
         AND index_state.indisunique
         AND pg_catalog.pg_get_indexdef(index_class.oid)
           LIKE '%(couple_id, vendor_id, booking_date, booking_time)%'
         AND pg_catalog.pg_get_expr(index_state.indpred, index_state.indrelid)
           LIKE '%status IS DISTINCT FROM%'
     )
     OR to_regclass('public.amora_tool_executions') IS NULL
     OR has_table_privilege('authenticated', 'public.amora_tool_executions', 'SELECT')
     OR has_table_privilege('anon', 'public.amora_tool_executions', 'SELECT')
     OR has_function_privilege(
       'authenticated', 'public.create_booking_atomic(uuid,uuid,date,text,uuid,uuid,text,text,text,text,numeric,text)', 'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role', 'public.create_booking_atomic(uuid,uuid,date,text,uuid,uuid,text,text,text,text,numeric,text)', 'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated', 'public.cancel_booking_atomic(uuid,uuid)', 'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role', 'public.cancel_booking_atomic(uuid,uuid)', 'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated', 'public.apply_budget_plan_atomic(uuid,numeric,jsonb)', 'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role', 'public.apply_budget_plan_atomic(uuid,numeric,jsonb)', 'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated', 'public.claim_amora_tool_execution(uuid,text,text,text,text)', 'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role', 'public.claim_amora_tool_execution(uuid,text,text,text,text)', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'AMORA_TOOL_IDEMPOTENCY_POSTCONDITION_FAILED';
  END IF;
END;
$postcondition$;

RESET lock_timeout;
RESET statement_timeout;
