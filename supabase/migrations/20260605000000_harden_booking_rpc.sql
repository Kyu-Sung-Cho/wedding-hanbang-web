-- ============================================================
-- Harden atomic booking RPC
-- ============================================================
-- 1) Reject product_id / staff_id that do not belong to p_vendor_id.
-- 2) Count capacity at the same scope used by slot lookup:
--    staff schedule -> staff bookings, product schedule -> product bookings,
--    vendor fallback -> vendor-wide bookings.

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
  v_day := (EXTRACT(DOW FROM p_booking_date)::INT + 6) % 7;
  v_hour := SPLIT_PART(p_booking_time, ':', 1)::INT;
  v_booking_time_typed := p_booking_time::time;

  IF p_product_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM vendor_products
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
    FROM vendor_staff
    WHERE id = p_staff_id
      AND vendor_id = p_vendor_id
  ) THEN
    RAISE EXCEPTION 'invalid_staff_vendor' USING
      ERRCODE = 'P0001',
      DETAIL = 'staff_id does not belong to vendor_id';
  END IF;

  IF p_staff_id IS NOT NULL THEN
    SELECT EXISTS(SELECT 1 FROM staff_timeslots WHERE staff_id = p_staff_id AND available = TRUE)
      INTO v_staff_has_schedule;
  END IF;
  IF p_product_id IS NOT NULL THEN
    SELECT EXISTS(SELECT 1 FROM product_timeslots WHERE product_id = p_product_id AND available = TRUE)
      INTO v_product_has_schedule;
  END IF;

  IF v_staff_has_schedule THEN
    SELECT max_bookings INTO v_max_bookings
    FROM staff_timeslots
    WHERE staff_id = p_staff_id
      AND day = v_day
      AND hour = v_hour
      AND available = TRUE
    LIMIT 1
    FOR UPDATE;
  ELSIF v_product_has_schedule THEN
    SELECT max_bookings INTO v_max_bookings
    FROM product_timeslots
    WHERE product_id = p_product_id
      AND day = v_day
      AND hour = v_hour
      AND available = TRUE
    LIMIT 1
    FOR UPDATE;
  ELSE
    SELECT max_bookings INTO v_max_bookings
    FROM vendor_timeslots
    WHERE vendor_id = p_vendor_id
      AND day = v_day
      AND hour = v_hour
      AND available = TRUE
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF v_max_bookings IS NULL THEN
    RAISE EXCEPTION 'slot_unavailable' USING
      ERRCODE = 'P0001',
      DETAIL = 'No timeslot configured for this day/hour';
  END IF;

  IF v_staff_has_schedule THEN
    SELECT COUNT(*) INTO v_existing_count
    FROM vendor_bookings
    WHERE vendor_id = p_vendor_id
      AND staff_id = p_staff_id
      AND booking_date = p_booking_date
      AND booking_time = v_booking_time_typed
      AND status <> 'cancelled';
  ELSIF v_product_has_schedule THEN
    SELECT COUNT(*) INTO v_existing_count
    FROM vendor_bookings
    WHERE vendor_id = p_vendor_id
      AND product_id = p_product_id
      AND booking_date = p_booking_date
      AND booking_time = v_booking_time_typed
      AND status <> 'cancelled';
  ELSE
    SELECT COUNT(*) INTO v_existing_count
    FROM vendor_bookings
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

  INSERT INTO vendor_bookings (
    vendor_id, couple_id, product_id, staff_id,
    booking_date, booking_time, booking_type,
    bride_name, groom_name, contact_phone,
    status, amount, is_paid, memo
  ) VALUES (
    p_vendor_id, p_couple_id, p_product_id, p_staff_id,
    p_booking_date, v_booking_time_typed, p_booking_type,
    p_bride_name, p_groom_name, p_contact_phone,
    'pending', p_amount, FALSE, p_memo
  ) RETURNING id INTO v_booking_id;

  RETURN v_booking_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_booking_atomic(
  UUID, UUID, DATE, TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT
) TO authenticated, service_role;

COMMENT ON FUNCTION public.create_booking_atomic(
  UUID, UUID, DATE, TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT
) IS 'Atomic booking creation with vendor-owned product/staff validation and scope-consistent capacity checks.';
