-- ============================================================
-- Atomic booking RPC — TOCTOU 방어용 단일 트랜잭션 함수
-- ============================================================
-- 배경: 이전엔 client 가 "기존 예약 수 COUNT → max_bookings 초과 체크 → INSERT"
-- 를 3개 statement 로 나눠 호출. 두 client 가 동시에 같은 슬롯을 노리면 둘 다
-- COUNT 단계에서 capacity 통과 → 둘 다 INSERT → max_bookings 초과 발생.
--
-- 해결: 이 함수는 SELECT ... FOR UPDATE 로 timeslot row 를 락한 뒤 COUNT + INSERT.
-- 두 번째 동시 호출은 락에서 대기 → 첫 INSERT 완료 후 카운트 다시 조회 →
-- capacity 초과면 명시적 에러. 트랜잭션 단일성으로 race 원천 차단.
--
-- 슬롯 폴백 우선순위: staff > product > vendor.
-- 단, "엔티티가 자체 일정 row 를 하나도 안 정의했을 때만" 상위로 폴백.
-- (특정 시간만 없는 경우 폴백 X — 상품이 제공 안 하는 시간 예약 방어).
--
-- 타입 주의: vendor_bookings.booking_time 컬럼이 TIME 타입이라 TEXT 입력을
-- 받아도 내부에서 ::time 캐스팅 필요. 1차 deploy 후 WHERE 비교에서 타입
-- 불일치 에러 (operator does not exist: time = text) 발생해 fix 반영.

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
  -- vendor_bookings.booking_time 이 TIME 타입이라 TEXT 그대로 비교 불가 →
  -- 한 번 ::time 으로 변환해서 COUNT WHERE / INSERT 양쪽에서 재사용.
  v_booking_time_typed TIME;
BEGIN
  -- 요일 (0=월~6=일) — PG EXTRACT(DOW): 0=일~6=토 → +6 mod 7 로 월요일=0 정렬
  v_day := (EXTRACT(DOW FROM p_booking_date)::INT + 6) % 7;
  v_hour := SPLIT_PART(p_booking_time, ':', 1)::INT;
  v_booking_time_typed := p_booking_time::time;

  -- staff/product 자체 일정 정의 여부 (특정 시간 슬롯 유무가 아닌 row 존재 여부)
  IF p_staff_id IS NOT NULL THEN
    SELECT EXISTS(SELECT 1 FROM staff_timeslots WHERE staff_id = p_staff_id)
      INTO v_staff_has_schedule;
  END IF;
  IF p_product_id IS NOT NULL THEN
    SELECT EXISTS(SELECT 1 FROM product_timeslots WHERE product_id = p_product_id)
      INTO v_product_has_schedule;
  END IF;

  -- 슬롯 row 락 (FOR UPDATE) — 같은 슬롯을 노리는 동시 호출 직렬화
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

  -- 슬롯 자체 없음 → 해당 시간 영업 안 함
  IF v_max_bookings IS NULL THEN
    RAISE EXCEPTION 'slot_unavailable' USING
      ERRCODE = 'P0001',
      DETAIL = 'No timeslot configured for this day/hour';
  END IF;

  -- 락 보호하에 기존 예약 수 COUNT (TIME 컬럼이라 ::time 변환된 변수 사용)
  SELECT COUNT(*) INTO v_existing_count
  FROM vendor_bookings
  WHERE vendor_id = p_vendor_id
    AND booking_date = p_booking_date
    AND booking_time = v_booking_time_typed
    AND status <> 'cancelled';

  IF v_existing_count >= v_max_bookings THEN
    RAISE EXCEPTION 'slot_full' USING
      ERRCODE = 'P0001',
      DETAIL = format('capacity %s/%s reached', v_existing_count, v_max_bookings);
  END IF;

  -- INSERT (락 보호하에 — 다음 동시 호출은 이 INSERT 가 COMMIT 될 때까지 대기)
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

-- 호출 권한 — 인증된 사용자 + service_role
GRANT EXECUTE ON FUNCTION public.create_booking_atomic(
  UUID, UUID, DATE, TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT
) TO authenticated, service_role;

COMMENT ON FUNCTION public.create_booking_atomic(
  UUID, UUID, DATE, TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT
) IS 'Atomic booking creation with TOCTOU-safe capacity check. Raises slot_unavailable / slot_full exceptions on capacity violations.';
