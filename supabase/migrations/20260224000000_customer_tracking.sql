-- 고객 행동 추적 시스템
-- customer_events: 모든 고객 행동 이벤트 기록
-- search_logs: 검색어 로그
-- vendor_daily_stats: 일별 업체 집계 (분석용)

-- 1. 고객 행동 이벤트 테이블
CREATE TABLE IF NOT EXISTS customer_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE SET NULL,
  couple_id UUID,
  event_type TEXT NOT NULL,
  vendor_id UUID REFERENCES vendors(id) ON DELETE CASCADE,
  product_id UUID REFERENCES vendor_products(id) ON DELETE SET NULL,
  metadata JSONB DEFAULT '{}',
  duration_seconds INTEGER,
  session_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_customer_events_user ON customer_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_events_vendor ON customer_events(vendor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_events_type ON customer_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_events_date ON customer_events(created_at);

-- RLS
ALTER TABLE customer_events ENABLE ROW LEVEL SECURITY;

-- 인증된 사용자는 자신의 이벤트만 삽입 가능
CREATE POLICY "Users can insert own events" ON customer_events
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 업체 오너는 자기 업체 이벤트 조회 가능
CREATE POLICY "Vendor owners can view their events" ON customer_events
  FOR SELECT USING (
    vendor_id IN (SELECT id FROM vendors WHERE owner_id = auth.uid())
  );

-- 본인 이벤트 조회
CREATE POLICY "Users can view own events" ON customer_events
  FOR SELECT USING (auth.uid() = user_id);

-- 2. 검색어 로그 테이블
CREATE TABLE IF NOT EXISTS search_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE SET NULL,
  query TEXT NOT NULL,
  category TEXT,
  result_count INTEGER DEFAULT 0,
  clicked_vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_search_logs_user ON search_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_logs_query ON search_logs(query, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_logs_vendor ON search_logs(clicked_vendor_id, created_at DESC);

ALTER TABLE search_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own searches" ON search_logs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Vendor owners can view search logs for their vendor" ON search_logs
  FOR SELECT USING (
    clicked_vendor_id IN (SELECT id FROM vendors WHERE owner_id = auth.uid())
    OR auth.uid() = user_id
  );

-- 3. 일별 업체 집계 테이블
CREATE TABLE IF NOT EXISTS vendor_daily_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID REFERENCES vendors(id) ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,
  views INTEGER DEFAULT 0,
  unique_visitors INTEGER DEFAULT 0,
  product_views INTEGER DEFAULT 0,
  favorites INTEGER DEFAULT 0,
  inquiries INTEGER DEFAULT 0,
  booking_requests INTEGER DEFAULT 0,
  booking_confirms INTEGER DEFAULT 0,
  avg_view_duration INTEGER DEFAULT 0,
  top_products JSONB DEFAULT '[]',
  search_appearances INTEGER DEFAULT 0,
  UNIQUE(vendor_id, date)
);

CREATE INDEX IF NOT EXISTS idx_vendor_daily_stats_vendor ON vendor_daily_stats(vendor_id, date DESC);

ALTER TABLE vendor_daily_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vendor owners can view own stats" ON vendor_daily_stats
  FOR SELECT USING (
    vendor_id IN (SELECT id FROM vendors WHERE owner_id = auth.uid())
  );

-- service_role이 집계 작업 수행 가능
CREATE POLICY "Service role can manage stats" ON vendor_daily_stats
  FOR ALL USING (true);

-- 4. 스태프 테이블 (Phase 5용, 미리 생성)
CREATE TABLE IF NOT EXISTS vendor_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID REFERENCES vendors(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  role TEXT,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendor_staff_vendor ON vendor_staff(vendor_id);

ALTER TABLE vendor_staff ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view active staff" ON vendor_staff
  FOR SELECT USING (
    is_active = true AND vendor_id IN (SELECT id FROM vendors WHERE status = 'approved')
  );

CREATE POLICY "Vendor owners can manage staff" ON vendor_staff
  FOR ALL USING (
    vendor_id IN (SELECT id FROM vendors WHERE owner_id = auth.uid())
  );

-- 5. 스태프 타임슬롯 테이블
CREATE TABLE IF NOT EXISTS staff_timeslots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID REFERENCES vendor_staff(id) ON DELETE CASCADE NOT NULL,
  day SMALLINT NOT NULL CHECK (day BETWEEN 0 AND 6),
  hour SMALLINT NOT NULL CHECK (hour BETWEEN 0 AND 23),
  available BOOLEAN DEFAULT true,
  max_bookings SMALLINT DEFAULT 1,
  UNIQUE(staff_id, day, hour)
);

ALTER TABLE staff_timeslots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view staff timeslots" ON staff_timeslots
  FOR SELECT USING (
    staff_id IN (
      SELECT vs.id FROM vendor_staff vs
      JOIN vendors v ON vs.vendor_id = v.id
      WHERE v.status = 'approved' AND vs.is_active = true
    )
  );

CREATE POLICY "Vendor owners can manage staff timeslots" ON staff_timeslots
  FOR ALL USING (
    staff_id IN (
      SELECT vs.id FROM vendor_staff vs
      JOIN vendors v ON vs.vendor_id = v.id
      WHERE v.owner_id = auth.uid()
    )
  );

-- 6. vendor_bookings에 staff_id 컬럼 추가
ALTER TABLE vendor_bookings ADD COLUMN IF NOT EXISTS staff_id UUID REFERENCES vendor_staff(id) ON DELETE SET NULL;
