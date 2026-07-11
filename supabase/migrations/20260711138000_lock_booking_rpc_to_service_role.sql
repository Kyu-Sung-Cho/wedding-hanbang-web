-- Lock the SECURITY DEFINER booking writer to the trusted server boundary.
--
-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. The prior
-- hotfix only revoked `authenticated`, so anon/authenticated callers still
-- inherited EXECUTE through PUBLIC and could forge a couple_id. Keep both the
-- ACL and an in-function role assertion so a later grant regression fails
-- closed.

CREATE OR REPLACE FUNCTION public.create_booking_atomic(
  p_vendor_id UUID,
  p_couple_id UUID,
  p_booking_date DATE,
  p_booking_time TEXT,
  p_product_id UUID DEFAULT NULL,
  p_staff_id UUID DEFAULT NULL,
  p_booking_type TEXT DEFAULT 'consultation',
  p_bride_name TEXT DEFAULT '',
  p_groom_name TEXT DEFAULT '',
  p_contact_phone TEXT DEFAULT '',
  p_amount NUMERIC DEFAULT 0,
  p_memo TEXT DEFAULT ''
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_day INT;
  v_hour INT;
  v_max_bookings INT;
  v_existing_count INT;
  v_booking_id UUID;
  v_staff_has_schedule BOOLEAN := FALSE;
  v_product_has_schedule BOOLEAN := FALSE;
  v_booking_time_typed TIME;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING
      ERRCODE = '42501',
      DETAIL = 'create_booking_atomic is only callable through the trusted server';
  END IF;

  IF p_vendor_id IS NULL OR p_couple_id IS NULL OR p_booking_date IS NULL OR p_booking_time IS NULL THEN
    RAISE EXCEPTION 'invalid_booking_input' USING ERRCODE = '22023';
  END IF;

  v_booking_time_typed := p_booking_time::time;
  IF EXTRACT(MINUTE FROM v_booking_time_typed) <> 0
     OR EXTRACT(SECOND FROM v_booking_time_typed) <> 0 THEN
    RAISE EXCEPTION 'invalid_booking_time' USING
      ERRCODE = '22023',
      DETAIL = 'booking time must match an hourly slot';
  END IF;

  IF p_booking_date < timezone('Asia/Seoul', now())::date THEN
    RAISE EXCEPTION 'booking_date_in_past' USING ERRCODE = '22023';
  END IF;

  IF p_amount IS NULL OR p_amount < 0 THEN
    RAISE EXCEPTION 'invalid_booking_amount' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.couples WHERE id = p_couple_id
  ) THEN
    RAISE EXCEPTION 'invalid_couple' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.vendors
    WHERE id = p_vendor_id AND status = 'approved'
  ) THEN
    RAISE EXCEPTION 'invalid_vendor' USING ERRCODE = 'P0001';
  END IF;

  v_day := (EXTRACT(DOW FROM p_booking_date)::INT + 6) % 7;
  v_hour := EXTRACT(HOUR FROM v_booking_time_typed)::INT;

  IF p_product_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.vendor_products
    WHERE id = p_product_id
      AND vendor_id = p_vendor_id
      AND COALESCE(is_active, TRUE) = TRUE
  ) THEN
    RAISE EXCEPTION 'invalid_product_vendor' USING
      ERRCODE = 'P0001',
      DETAIL = 'product_id does not belong to vendor_id or is inactive';
  END IF;

  IF p_staff_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.vendor_staff
    WHERE id = p_staff_id
      AND vendor_id = p_vendor_id
      AND COALESCE(is_active, TRUE) = TRUE
  ) THEN
    RAISE EXCEPTION 'invalid_staff_vendor' USING
      ERRCODE = 'P0001',
      DETAIL = 'staff_id does not belong to vendor_id or is inactive';
  END IF;

  IF p_staff_id IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM public.staff_timeslots
      WHERE staff_id = p_staff_id AND available = TRUE
    ) INTO v_staff_has_schedule;
  END IF;

  IF p_product_id IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM public.product_timeslots
      WHERE product_id = p_product_id AND available = TRUE
    ) INTO v_product_has_schedule;
  END IF;

  IF v_staff_has_schedule THEN
    SELECT max_bookings INTO v_max_bookings
    FROM public.staff_timeslots
    WHERE staff_id = p_staff_id
      AND day = v_day
      AND hour = v_hour
      AND available = TRUE
    LIMIT 1
    FOR UPDATE;
  ELSIF v_product_has_schedule THEN
    SELECT max_bookings INTO v_max_bookings
    FROM public.product_timeslots
    WHERE product_id = p_product_id
      AND day = v_day
      AND hour = v_hour
      AND available = TRUE
    LIMIT 1
    FOR UPDATE;
  ELSE
    SELECT max_bookings INTO v_max_bookings
    FROM public.vendor_timeslots
    WHERE vendor_id = p_vendor_id
      AND day = v_day
      AND hour = v_hour
      AND available = TRUE
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF v_max_bookings IS NULL OR v_max_bookings <= 0 THEN
    RAISE EXCEPTION 'slot_unavailable' USING
      ERRCODE = 'P0001',
      DETAIL = 'No timeslot configured for this day/hour';
  END IF;

  IF v_staff_has_schedule THEN
    SELECT COUNT(*) INTO v_existing_count
    FROM public.vendor_bookings
    WHERE vendor_id = p_vendor_id
      AND staff_id = p_staff_id
      AND booking_date = p_booking_date
      AND booking_time = v_booking_time_typed
      AND status <> 'cancelled';
  ELSIF v_product_has_schedule THEN
    SELECT COUNT(*) INTO v_existing_count
    FROM public.vendor_bookings
    WHERE vendor_id = p_vendor_id
      AND product_id = p_product_id
      AND booking_date = p_booking_date
      AND booking_time = v_booking_time_typed
      AND status <> 'cancelled';
  ELSE
    SELECT COUNT(*) INTO v_existing_count
    FROM public.vendor_bookings
    WHERE vendor_id = p_vendor_id
      AND booking_date = p_booking_date
      AND booking_time = v_booking_time_typed
      AND status <> 'cancelled';
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
    LEFT(COALESCE(p_bride_name, ''), 100),
    LEFT(COALESCE(p_groom_name, ''), 100),
    LEFT(COALESCE(p_contact_phone, ''), 30),
    'pending', p_amount, FALSE, LEFT(COALESCE(p_memo, ''), 1000)
  ) RETURNING id INTO v_booking_id;

  RETURN v_booking_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_booking_atomic(
  UUID, UUID, DATE, TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_booking_atomic(
  UUID, UUID, DATE, TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT
) TO service_role;

COMMENT ON FUNCTION public.create_booking_atomic(
  UUID, UUID, DATE, TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT
) IS 'Service-only atomic booking request creation with ownership-independent server authorization, vendor/product/staff validation, and serialized capacity checks.';
