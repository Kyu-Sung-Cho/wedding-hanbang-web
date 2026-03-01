-- ============================================
-- 계약 & 결제 시스템
-- ============================================

-- 1) 플랫폼 표준 계약 템플릿 (카테고리별)
CREATE TABLE IF NOT EXISTS contract_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  content JSONB NOT NULL DEFAULT '[]',
  cancellation_policy JSONB DEFAULT '[]',
  default_deposit_rate NUMERIC DEFAULT 0.3,
  is_active BOOLEAN DEFAULT true,
  version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE contract_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "공개: 활성 템플릿 조회" ON contract_templates FOR SELECT USING (is_active = true);
CREATE POLICY "서비스: 전체 관리" ON contract_templates FOR ALL USING (auth.role() = 'service_role');

-- 2) 업체 커스텀 계약 템플릿
CREATE TABLE IF NOT EXISTS vendor_contract_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  base_template_id UUID REFERENCES contract_templates(id),
  title TEXT NOT NULL,
  content JSONB NOT NULL DEFAULT '[]',
  cancellation_policy JSONB DEFAULT '[]',
  deposit_rate NUMERIC DEFAULT 0.3,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE vendor_contract_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "업체: 본인 템플릿 조회" ON vendor_contract_templates FOR SELECT
  USING (vendor_id IN (SELECT id FROM vendors WHERE owner_id = auth.uid()));
CREATE POLICY "업체: 본인 템플릿 관리" ON vendor_contract_templates FOR ALL
  USING (vendor_id IN (SELECT id FROM vendors WHERE owner_id = auth.uid()));
CREATE POLICY "서비스: 전체 관리" ON vendor_contract_templates FOR ALL USING (auth.role() = 'service_role');

-- 3) 계약 인스턴스 (예약당 1개)
CREATE TABLE IF NOT EXISTS contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES vendor_bookings(id),
  vendor_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  template_id UUID,
  content JSONB NOT NULL DEFAULT '[]',
  contract_amount NUMERIC NOT NULL,
  deposit_amount NUMERIC NOT NULL,
  deposit_rate NUMERIC NOT NULL DEFAULT 0.3,
  cancellation_policy JSONB DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  sent_at TIMESTAMPTZ,
  viewed_at TIMESTAMPTZ,
  signed_at TIMESTAMPTZ,
  signed_name TEXT,
  cancelled_at TIMESTAMPTZ,
  cancel_reason TEXT,
  version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "고객: 본인 계약 조회" ON contracts FOR SELECT USING (customer_id = auth.uid());
CREATE POLICY "업체: 본인 계약 조회" ON contracts FOR SELECT
  USING (vendor_id IN (SELECT id FROM vendors WHERE owner_id = auth.uid()));
CREATE POLICY "업체: 본인 계약 관리" ON contracts FOR ALL
  USING (vendor_id IN (SELECT id FROM vendors WHERE owner_id = auth.uid()));
CREATE POLICY "서비스: 전체 관리" ON contracts FOR ALL USING (auth.role() = 'service_role');

-- 4) 결제 트랜잭션
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES contracts(id),
  booking_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  vendor_id UUID NOT NULL,
  payment_type TEXT NOT NULL DEFAULT 'deposit',
  amount NUMERIC NOT NULL,
  method TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  portone_payment_id TEXT,
  portone_tx_id TEXT,
  paid_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  fail_reason TEXT,
  refunded_at TIMESTAMPTZ,
  refund_amount NUMERIC,
  receipt_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "고객: 본인 결제 조회" ON payments FOR SELECT USING (customer_id = auth.uid());
CREATE POLICY "업체: 본인 결제 조회" ON payments FOR SELECT
  USING (vendor_id IN (SELECT id FROM vendors WHERE owner_id = auth.uid()));
CREATE POLICY "서비스: 전체 관리" ON payments FOR ALL USING (auth.role() = 'service_role');

-- 5) 정산
CREATE TABLE IF NOT EXISTS settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES payments(id),
  vendor_id UUID NOT NULL,
  booking_id UUID NOT NULL,
  total_amount NUMERIC NOT NULL,
  commission_rate NUMERIC NOT NULL,
  commission_amount NUMERIC NOT NULL,
  settle_amount NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  settled_at TIMESTAMPTZ,
  bank_name TEXT,
  account_number TEXT,
  account_holder TEXT,
  memo TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "업체: 본인 정산 조회" ON settlements FOR SELECT
  USING (vendor_id IN (SELECT id FROM vendors WHERE owner_id = auth.uid()));
CREATE POLICY "서비스: 전체 관리" ON settlements FOR ALL USING (auth.role() = 'service_role');

-- 6) 기존 테이블 확장
ALTER TABLE vendor_bookings ADD COLUMN IF NOT EXISTS contract_status TEXT;
ALTER TABLE vendor_bookings ADD COLUMN IF NOT EXISTS payment_status TEXT;

ALTER TABLE vendors ADD COLUMN IF NOT EXISTS bank_name TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS account_number TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS account_holder TEXT;

-- 7) 인덱스
CREATE INDEX IF NOT EXISTS idx_contracts_booking_id ON contracts(booking_id);
CREATE INDEX IF NOT EXISTS idx_contracts_vendor_id ON contracts(vendor_id);
CREATE INDEX IF NOT EXISTS idx_contracts_customer_id ON contracts(customer_id);
CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status);
CREATE INDEX IF NOT EXISTS idx_payments_contract_id ON payments(contract_id);
CREATE INDEX IF NOT EXISTS idx_payments_booking_id ON payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_settlements_vendor_id ON settlements(vendor_id);
CREATE INDEX IF NOT EXISTS idx_settlements_status ON settlements(status);
