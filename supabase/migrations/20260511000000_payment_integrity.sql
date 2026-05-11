-- 결제/정산 무결성 보강 (2026-05-11)
-- - 같은 결제의 정산 레코드 중복 방지
-- - Toss order_id 중복 방지
-- - 같은 계약/결제타입의 pending/paid 중복 준비 방지

CREATE UNIQUE INDEX IF NOT EXISTS idx_settlements_payment_id_unique
  ON settlements(payment_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_order_id_unique
  ON payments(order_id)
  WHERE order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_contract_type_active_unique
  ON payments(contract_id, payment_type)
  WHERE status IN ('pending', 'paid');
