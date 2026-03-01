-- ============================================
-- 결제 게이트웨이 마이그레이션: 포트원 → 토스페이먼츠
-- ============================================

-- payments 테이블 컬럼명 변경
ALTER TABLE payments RENAME COLUMN portone_payment_id TO toss_payment_key;
ALTER TABLE payments RENAME COLUMN portone_tx_id TO toss_transaction_key;

-- orderId 컬럼 추가 (토스 결제 시 필수)
ALTER TABLE payments ADD COLUMN IF NOT EXISTS order_id TEXT;
