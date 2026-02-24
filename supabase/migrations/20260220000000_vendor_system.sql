-- ===================================================
-- 웨딩한방 서비스 마이그레이션: 누락 테이블 + RLS
-- 기존 테이블: vendors, vendor_products, vendor_bookings, vendor_timeslots,
--   product_timeslots, vendor_images, vendor_reviews, vendor_favorites,
--   vendor_submissions, messages (AI chat)
-- 신규 테이블: vendor_messages (고객↔업체 메시지), vendor_views (조회수)
-- ===================================================

-- ──── vendors: 알림 설정 컬럼 추가 ────
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS notification_settings JSONB NOT NULL DEFAULT '{"booking": true, "message": true, "marketing": false}';

-- ──── vendor_messages (고객↔업체 메시지) ────
CREATE TABLE IF NOT EXISTS vendor_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('customer', 'vendor')),
  content TEXT NOT NULL DEFAULT '',
  is_read BOOLEAN NOT NULL DEFAULT false,
  booking_id UUID REFERENCES vendor_bookings(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ──── vendor_views (조회수 추적) ────
CREATE TABLE IF NOT EXISTS vendor_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  viewer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ──── 인덱스 ────
CREATE INDEX IF NOT EXISTS idx_vendor_messages_vendor_id ON vendor_messages(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_messages_customer_id ON vendor_messages(customer_id);
CREATE INDEX IF NOT EXISTS idx_vendor_views_vendor_id ON vendor_views(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_views_created_at ON vendor_views(created_at);

-- ──── RLS: vendors ────
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vendors_select_approved" ON vendors;
DROP POLICY IF EXISTS "vendors_insert_own" ON vendors;
DROP POLICY IF EXISTS "vendors_update_own" ON vendors;
DROP POLICY IF EXISTS "vendors_delete_own" ON vendors;
DROP POLICY IF EXISTS "Enable read access for all users" ON vendors;
DROP POLICY IF EXISTS "Allow full access with service role" ON vendors;

CREATE POLICY "vendors_select_approved" ON vendors
  FOR SELECT USING (status = 'approved' OR owner_id = auth.uid());

CREATE POLICY "vendors_insert_own" ON vendors
  FOR INSERT WITH CHECK (owner_id = auth.uid());

CREATE POLICY "vendors_update_own" ON vendors
  FOR UPDATE USING (owner_id = auth.uid());

CREATE POLICY "vendors_delete_own" ON vendors
  FOR DELETE USING (owner_id = auth.uid());

-- ──── RLS: vendor_products ────
ALTER TABLE vendor_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vendor_products_select" ON vendor_products;
DROP POLICY IF EXISTS "vendor_products_insert" ON vendor_products;
DROP POLICY IF EXISTS "vendor_products_update" ON vendor_products;
DROP POLICY IF EXISTS "vendor_products_delete" ON vendor_products;
DROP POLICY IF EXISTS "Enable read access for all users" ON vendor_products;
DROP POLICY IF EXISTS "Allow full access with service role" ON vendor_products;

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

-- ──── RLS: vendor_bookings ────
ALTER TABLE vendor_bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vendor_bookings_select" ON vendor_bookings;
DROP POLICY IF EXISTS "vendor_bookings_insert" ON vendor_bookings;
DROP POLICY IF EXISTS "vendor_bookings_update" ON vendor_bookings;
DROP POLICY IF EXISTS "Enable read access for all users" ON vendor_bookings;
DROP POLICY IF EXISTS "Allow full access with service role" ON vendor_bookings;

CREATE POLICY "vendor_bookings_select" ON vendor_bookings
  FOR SELECT USING (
    couple_id IN (SELECT p.couple_id FROM profiles p WHERE p.id = auth.uid())
    OR EXISTS (SELECT 1 FROM vendors WHERE vendors.id = vendor_bookings.vendor_id AND vendors.owner_id = auth.uid())
  );

CREATE POLICY "vendor_bookings_insert" ON vendor_bookings
  FOR INSERT WITH CHECK (
    couple_id IN (SELECT p.couple_id FROM profiles p WHERE p.id = auth.uid())
  );

CREATE POLICY "vendor_bookings_update" ON vendor_bookings
  FOR UPDATE USING (
    couple_id IN (SELECT p.couple_id FROM profiles p WHERE p.id = auth.uid())
    OR EXISTS (SELECT 1 FROM vendors WHERE vendors.id = vendor_bookings.vendor_id AND vendors.owner_id = auth.uid())
  );

-- ──── RLS: vendor_timeslots ────
ALTER TABLE vendor_timeslots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vendor_timeslots_select" ON vendor_timeslots;
DROP POLICY IF EXISTS "vendor_timeslots_insert" ON vendor_timeslots;
DROP POLICY IF EXISTS "vendor_timeslots_update" ON vendor_timeslots;
DROP POLICY IF EXISTS "vendor_timeslots_delete" ON vendor_timeslots;
DROP POLICY IF EXISTS "Enable read access for all users" ON vendor_timeslots;
DROP POLICY IF EXISTS "Allow full access with service role" ON vendor_timeslots;

CREATE POLICY "vendor_timeslots_select" ON vendor_timeslots
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM vendors WHERE vendors.id = vendor_timeslots.vendor_id AND (vendors.status = 'approved' OR vendors.owner_id = auth.uid()))
  );

CREATE POLICY "vendor_timeslots_manage" ON vendor_timeslots
  FOR ALL USING (
    EXISTS (SELECT 1 FROM vendors WHERE vendors.id = vendor_timeslots.vendor_id AND vendors.owner_id = auth.uid())
  );

-- ──── RLS: product_timeslots ────
ALTER TABLE product_timeslots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_timeslots_select" ON product_timeslots;
DROP POLICY IF EXISTS "product_timeslots_manage" ON product_timeslots;
DROP POLICY IF EXISTS "Enable read access for all users" ON product_timeslots;
DROP POLICY IF EXISTS "Allow full access with service role" ON product_timeslots;

CREATE POLICY "product_timeslots_select" ON product_timeslots
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM vendor_products vp
      JOIN vendors v ON v.id = vp.vendor_id
      WHERE vp.id = product_timeslots.product_id AND (v.status = 'approved' OR v.owner_id = auth.uid())
    )
  );

CREATE POLICY "product_timeslots_manage" ON product_timeslots
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM vendor_products vp
      JOIN vendors v ON v.id = vp.vendor_id
      WHERE vp.id = product_timeslots.product_id AND v.owner_id = auth.uid()
    )
  );

-- ──── RLS: vendor_messages ────
ALTER TABLE vendor_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vendor_messages_select" ON vendor_messages
  FOR SELECT USING (
    customer_id = auth.uid()
    OR EXISTS (SELECT 1 FROM vendors WHERE vendors.id = vendor_messages.vendor_id AND vendors.owner_id = auth.uid())
  );

CREATE POLICY "vendor_messages_insert" ON vendor_messages
  FOR INSERT WITH CHECK (
    customer_id = auth.uid()
    OR EXISTS (SELECT 1 FROM vendors WHERE vendors.id = vendor_messages.vendor_id AND vendors.owner_id = auth.uid())
  );

CREATE POLICY "vendor_messages_update" ON vendor_messages
  FOR UPDATE USING (
    customer_id = auth.uid()
    OR EXISTS (SELECT 1 FROM vendors WHERE vendors.id = vendor_messages.vendor_id AND vendors.owner_id = auth.uid())
  );

-- ──── RLS: vendor_views ────
ALTER TABLE vendor_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vendor_views_select" ON vendor_views
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM vendors WHERE vendors.id = vendor_views.vendor_id AND vendors.owner_id = auth.uid())
  );

CREATE POLICY "vendor_views_insert" ON vendor_views
  FOR INSERT WITH CHECK (true);

-- ──── RLS: vendor_favorites ────
ALTER TABLE vendor_favorites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vendor_favorites_select" ON vendor_favorites;
DROP POLICY IF EXISTS "vendor_favorites_manage" ON vendor_favorites;
DROP POLICY IF EXISTS "Enable read access for all users" ON vendor_favorites;
DROP POLICY IF EXISTS "Allow full access with service role" ON vendor_favorites;

CREATE POLICY "vendor_favorites_select" ON vendor_favorites
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "vendor_favorites_manage" ON vendor_favorites
  FOR ALL USING (user_id = auth.uid());

-- ──── RLS: vendor_reviews ────
ALTER TABLE vendor_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vendor_reviews_select" ON vendor_reviews;
DROP POLICY IF EXISTS "vendor_reviews_insert" ON vendor_reviews;
DROP POLICY IF EXISTS "vendor_reviews_update" ON vendor_reviews;
DROP POLICY IF EXISTS "Enable read access for all users" ON vendor_reviews;
DROP POLICY IF EXISTS "Allow full access with service role" ON vendor_reviews;

CREATE POLICY "vendor_reviews_select" ON vendor_reviews
  FOR SELECT USING (is_visible = true OR customer_id = auth.uid());

CREATE POLICY "vendor_reviews_insert" ON vendor_reviews
  FOR INSERT WITH CHECK (customer_id = auth.uid());

CREATE POLICY "vendor_reviews_update_own" ON vendor_reviews
  FOR UPDATE USING (customer_id = auth.uid());
