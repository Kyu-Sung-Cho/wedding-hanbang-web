-- 같은 커플이 동일 업체/일시/상품/담당자 예약을 네트워크 재시도로
-- 중복 생성하지 못하게 한다. 과거 중복이 있으면 임의 삭제하지 않고 배포를 중단해
-- 운영자가 먼저 실제 예약을 확인하도록 한다.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.vendor_bookings
    WHERE status <> 'cancelled'
      AND couple_id IS NOT NULL
    GROUP BY
      couple_id,
      vendor_id,
      booking_date,
      booking_time,
      COALESCE(product_id, '00000000-0000-0000-0000-000000000000'::uuid),
      COALESCE(staff_id, '00000000-0000-0000-0000-000000000000'::uuid)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate_active_bookings_require_manual_review';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS vendor_bookings_active_request_unique
ON public.vendor_bookings (
  couple_id,
  vendor_id,
  booking_date,
  booking_time,
  COALESCE(product_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(staff_id, '00000000-0000-0000-0000-000000000000'::uuid)
)
WHERE status <> 'cancelled' AND couple_id IS NOT NULL;
