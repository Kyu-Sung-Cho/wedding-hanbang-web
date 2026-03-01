-- =============================================
-- 스키마 개선: 트리거, 인덱스, 제약조건
-- =============================================

-- 1) updated_at 자동 갱신 트리거 함수 (재사용)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2) 각 테이블에 updated_at 트리거 추가
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'contract_templates',
    'vendor_contract_templates',
    'contracts',
    'payments',
    'settlements'
  ]) LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS set_updated_at ON %I; CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();',
      tbl, tbl
    );
  END LOOP;
END;
$$;

-- 3) 누락된 인덱스 추가 (FK 및 자주 조회하는 컬럼)
CREATE INDEX IF NOT EXISTS idx_payments_vendor_id ON payments(vendor_id);
CREATE INDEX IF NOT EXISTS idx_payments_customer_id ON payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_payments_booking_id ON payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_settlements_payment_id ON settlements(payment_id);
CREATE INDEX IF NOT EXISTS idx_settlements_vendor_id ON settlements(vendor_id);
CREATE INDEX IF NOT EXISTS idx_settlements_booking_id ON settlements(booking_id);
CREATE INDEX IF NOT EXISTS idx_contracts_booking_id ON contracts(booking_id);
CREATE INDEX IF NOT EXISTS idx_contracts_vendor_id ON contracts(vendor_id);
CREATE INDEX IF NOT EXISTS idx_contracts_customer_id ON contracts(customer_id);
CREATE INDEX IF NOT EXISTS idx_vendor_contract_templates_vendor_id ON vendor_contract_templates(vendor_id);

-- vendor_bookings 복합 인덱스
CREATE INDEX IF NOT EXISTS idx_vendor_bookings_couple_id ON vendor_bookings(couple_id);
CREATE INDEX IF NOT EXISTS idx_vendor_bookings_vendor_date ON vendor_bookings(vendor_id, booking_date);
CREATE INDEX IF NOT EXISTS idx_vendor_bookings_status ON vendor_bookings(status);

-- 4) 상태 필드 CHECK 제약조건
ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_status_check;
ALTER TABLE contracts ADD CONSTRAINT contracts_status_check
  CHECK (status IN ('draft', 'sent', 'viewed', 'signed', 'cancelled'));

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check
  CHECK (status IN ('pending', 'paid', 'refunded', 'failed'));

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_type_check;
ALTER TABLE payments ADD CONSTRAINT payments_type_check
  CHECK (payment_type IN ('deposit', 'remaining', 'refund'));

ALTER TABLE settlements DROP CONSTRAINT IF EXISTS settlements_status_check;
ALTER TABLE settlements ADD CONSTRAINT settlements_status_check
  CHECK (status IN ('pending', 'processing', 'completed', 'failed'));

-- 5) 금액 양수 제약조건
ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_amount_positive;
ALTER TABLE contracts ADD CONSTRAINT contracts_amount_positive
  CHECK (contract_amount >= 0 AND deposit_amount >= 0);

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_amount_positive;
ALTER TABLE payments ADD CONSTRAINT payments_amount_positive
  CHECK (amount >= 0);

ALTER TABLE settlements DROP CONSTRAINT IF EXISTS settlements_amount_positive;
ALTER TABLE settlements ADD CONSTRAINT settlements_amount_positive
  CHECK (total_amount >= 0 AND settle_amount >= 0 AND commission_amount >= 0);

-- 6) 중복 방지: 예약당 하나의 활성 계약
CREATE UNIQUE INDEX IF NOT EXISTS idx_contracts_unique_active_booking
  ON contracts(booking_id) WHERE status != 'cancelled';

-- 7) 중복 방지: 결제당 하나의 정산
CREATE UNIQUE INDEX IF NOT EXISTS idx_settlements_unique_payment
  ON settlements(payment_id);
