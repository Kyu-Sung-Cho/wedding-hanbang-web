-- ===================================================
-- 웨딩한방 서비스 DB 마이그레이션
-- Phase 1: vendors, vendor_products, bookings, messages, vendor_views
-- ===================================================

-- 1. vendors 테이블
CREATE TABLE IF NOT EXISTS vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('스튜디오', '드레스', '메이크업', '예식장', '한복', '예물', '신혼여행', '기타')),
  location TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  owner_name TEXT NOT NULL DEFAULT '',
  email TEXT,
  description TEXT NOT NULL DEFAULT '',
  price_range TEXT NOT NULL DEFAULT '',
  price_min INTEGER NOT NULL DEFAULT 0,
  price_max INTEGER NOT NULL DEFAULT 0,
  rating NUMERIC(2,1) NOT NULL DEFAULT 0.0,
  review_count INTEGER NOT NULL DEFAULT 0,
  tags TEXT[] NOT NULL DEFAULT '{}',
  ai_recommend BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  business_number TEXT NOT NULL DEFAULT '',
  business_doc_url TEXT,
  time_slots JSONB NOT NULL DEFAULT '[]',
  notification_settings JSONB NOT NULL DEFAULT '{"booking": true, "message": true, "marketing": false}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. vendor_products 테이블
CREATE TABLE IF NOT EXISTS vendor_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL DEFAULT 0,
  discount_price INTEGER,
  duration INTEGER NOT NULL DEFAULT 60,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_popular BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  category_fields JSONB NOT NULL DEFAULT '{}',
  includes TEXT[] NOT NULL DEFAULT '{}',
  images TEXT[] NOT NULL DEFAULT '{}',
  time_slots JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. bookings 테이블
CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  product_id UUID REFERENCES vendor_products(id) ON DELETE SET NULL,
  customer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  couple_id UUID REFERENCES couples(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  date DATE NOT NULL,
  time TEXT NOT NULL,
  day_of_week INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled')),
  memo TEXT NOT NULL DEFAULT '',
  vendor_memo TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. messages 테이블
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('customer', 'vendor')),
  content TEXT NOT NULL DEFAULT '',
  is_read BOOLEAN NOT NULL DEFAULT false,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. vendor_views 테이블
CREATE TABLE IF NOT EXISTS vendor_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  viewer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===================================================
-- 인덱스
-- ===================================================
CREATE INDEX IF NOT EXISTS idx_vendors_owner_id ON vendors(owner_id);
CREATE INDEX IF NOT EXISTS idx_vendors_category ON vendors(category);
CREATE INDEX IF NOT EXISTS idx_vendors_status ON vendors(status);
CREATE INDEX IF NOT EXISTS idx_vendor_products_vendor_id ON vendor_products(vendor_id);
CREATE INDEX IF NOT EXISTS idx_bookings_vendor_id ON bookings(vendor_id);
CREATE INDEX IF NOT EXISTS idx_bookings_customer_id ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);
CREATE INDEX IF NOT EXISTS idx_messages_vendor_id ON messages(vendor_id);
CREATE INDEX IF NOT EXISTS idx_messages_customer_id ON messages(customer_id);
CREATE INDEX IF NOT EXISTS idx_vendor_views_vendor_id ON vendor_views(vendor_id);

-- ===================================================
-- updated_at 자동 업데이트 트리거
-- ===================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'vendors_updated_at') THEN
    CREATE TRIGGER vendors_updated_at BEFORE UPDATE ON vendors FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'vendor_products_updated_at') THEN
    CREATE TRIGGER vendor_products_updated_at BEFORE UPDATE ON vendor_products FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'bookings_updated_at') THEN
    CREATE TRIGGER bookings_updated_at BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END;
$$;

-- ===================================================
-- RLS (Row Level Security)
-- ===================================================

-- vendors RLS
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vendors_select_approved" ON vendors
  FOR SELECT USING (status = 'approved' OR owner_id = auth.uid());

CREATE POLICY "vendors_insert_own" ON vendors
  FOR INSERT WITH CHECK (owner_id = auth.uid());

CREATE POLICY "vendors_update_own" ON vendors
  FOR UPDATE USING (owner_id = auth.uid());

CREATE POLICY "vendors_delete_own" ON vendors
  FOR DELETE USING (owner_id = auth.uid());

-- vendor_products RLS
ALTER TABLE vendor_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vendor_products_select" ON vendor_products
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM vendors WHERE vendors.id = vendor_products.vendor_id AND (vendors.status = 'approved' OR vendors.owner_id = auth.uid()))
  );

CREATE POLICY "vendor_products_insert" ON vendor_products
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM vendors WHERE vendors.id = vendor_products.vendor_id AND vendors.owner_id = auth.uid())
  );

CREATE POLICY "vendor_products_update" ON vendor_products
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM vendors WHERE vendors.id = vendor_products.vendor_id AND vendors.owner_id = auth.uid())
  );

CREATE POLICY "vendor_products_delete" ON vendor_products
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM vendors WHERE vendors.id = vendor_products.vendor_id AND vendors.owner_id = auth.uid())
  );

-- bookings RLS
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bookings_select" ON bookings
  FOR SELECT USING (
    customer_id = auth.uid()
    OR EXISTS (SELECT 1 FROM vendors WHERE vendors.id = bookings.vendor_id AND vendors.owner_id = auth.uid())
  );

CREATE POLICY "bookings_insert" ON bookings
  FOR INSERT WITH CHECK (customer_id = auth.uid());

CREATE POLICY "bookings_update" ON bookings
  FOR UPDATE USING (
    customer_id = auth.uid()
    OR EXISTS (SELECT 1 FROM vendors WHERE vendors.id = bookings.vendor_id AND vendors.owner_id = auth.uid())
  );

-- messages RLS
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "messages_select" ON messages
  FOR SELECT USING (
    customer_id = auth.uid()
    OR EXISTS (SELECT 1 FROM vendors WHERE vendors.id = messages.vendor_id AND vendors.owner_id = auth.uid())
  );

CREATE POLICY "messages_insert" ON messages
  FOR INSERT WITH CHECK (
    customer_id = auth.uid()
    OR EXISTS (SELECT 1 FROM vendors WHERE vendors.id = messages.vendor_id AND vendors.owner_id = auth.uid())
  );

CREATE POLICY "messages_update_read" ON messages
  FOR UPDATE USING (
    customer_id = auth.uid()
    OR EXISTS (SELECT 1 FROM vendors WHERE vendors.id = messages.vendor_id AND vendors.owner_id = auth.uid())
  );

-- vendor_views RLS
ALTER TABLE vendor_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vendor_views_select" ON vendor_views
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM vendors WHERE vendors.id = vendor_views.vendor_id AND vendors.owner_id = auth.uid())
  );

CREATE POLICY "vendor_views_insert" ON vendor_views
  FOR INSERT WITH CHECK (true);
