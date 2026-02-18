-- ============================================================
-- 웨딩한방 업체 포털 시스템 (Vendor Portal)
-- 002_vendor_system.sql
-- ============================================================
-- 실행 순서: Supabase SQL Editor에서 전체 복사 후 실행
-- ============================================================

-- 0. Extension 확인
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. ENUM 타입 정의
-- ============================================================

DO $$ BEGIN
  CREATE TYPE vendor_category AS ENUM (
    '스튜디오', '드레스', '메이크업', '예식장', '한복', '예물', '신혼여행', '기타'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE vendor_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE booking_status AS ENUM ('pending', 'confirmed', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ============================================================
-- 2. vendors (업체 정보)
-- ============================================================

CREATE TABLE IF NOT EXISTS vendors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,  -- 업체 소유자 계정

  -- 기본 정보
  name TEXT NOT NULL,
  category vendor_category NOT NULL DEFAULT '기타',
  owner_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,

  -- 위치
  location TEXT,            -- 간략 (예: "서울 강남구")
  address TEXT,             -- 상세 주소

  -- 소개
  description TEXT,
  tags TEXT[] DEFAULT '{}',
  thumbnail_url TEXT,       -- 대표 이미지

  -- 가격
  price_range TEXT,         -- 표시용 (예: "250~350만원")
  price_min INTEGER DEFAULT 0,
  price_max INTEGER DEFAULT 0,

  -- 평점/리뷰
  rating NUMERIC(2,1) DEFAULT 0.0,
  review_count INTEGER DEFAULT 0,

  -- 심사
  status vendor_status DEFAULT 'pending',
  reject_reason TEXT,       -- 반려 사유
  approved_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,

  -- 사업자 인증
  business_number TEXT,
  business_license_url TEXT, -- 사업자등록증 이미지

  -- AI 추천
  ai_recommend BOOLEAN DEFAULT false,

  -- 영업시간 (JSON)
  business_hours JSONB DEFAULT '{"mon":"10:00-19:00","tue":"10:00-19:00","wed":"10:00-19:00","thu":"10:00-19:00","fri":"10:00-19:00","sat":"10:00-18:00","sun":"휴무"}',

  -- 타임스탬프
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_vendors_user_id ON vendors(user_id);
CREATE INDEX IF NOT EXISTS idx_vendors_category ON vendors(category);
CREATE INDEX IF NOT EXISTS idx_vendors_status ON vendors(status);
CREATE INDEX IF NOT EXISTS idx_vendors_rating ON vendors(rating DESC);


-- ============================================================
-- 3. vendor_products (상품/패키지)
-- ============================================================

CREATE TABLE IF NOT EXISTS vendor_products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,

  -- 기본
  name TEXT NOT NULL,
  description TEXT,
  price INTEGER NOT NULL DEFAULT 0,        -- 원 단위
  discount_price INTEGER,                   -- 할인가 (null = 할인 없음)
  duration INTEGER NOT NULL DEFAULT 60,     -- 소요 시간 (분)

  -- 상태
  is_active BOOLEAN DEFAULT true,
  is_popular BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,

  -- 카테고리별 상세 필드 (JSONB로 유연하게)
  -- 예: {"photographerRank":"원장","shootingHours":"3시간","editedPhotos":40,...}
  category_fields JSONB DEFAULT '{}',

  -- 포함 항목
  includes TEXT[] DEFAULT '{}',

  -- 이미지
  images TEXT[] DEFAULT '{}',

  -- 타임스탬프
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendor_products_vendor ON vendor_products(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_products_active ON vendor_products(vendor_id, is_active);


-- ============================================================
-- 4. vendor_timeslots (업체 기본 주간 스케줄)
-- ============================================================

CREATE TABLE IF NOT EXISTS vendor_timeslots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,

  day SMALLINT NOT NULL CHECK (day >= 0 AND day <= 6),   -- 0=월 ~ 6=일
  hour SMALLINT NOT NULL CHECK (hour >= 0 AND hour <= 23), -- 0~23
  available BOOLEAN DEFAULT false,
  max_bookings SMALLINT DEFAULT 1,

  UNIQUE(vendor_id, day, hour)
);

CREATE INDEX IF NOT EXISTS idx_vendor_timeslots_vendor ON vendor_timeslots(vendor_id);


-- ============================================================
-- 5. product_timeslots (상품별 예약 가능 시간)
-- ============================================================

CREATE TABLE IF NOT EXISTS product_timeslots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES vendor_products(id) ON DELETE CASCADE,

  day SMALLINT NOT NULL CHECK (day >= 0 AND day <= 6),
  hour SMALLINT NOT NULL CHECK (hour >= 0 AND hour <= 23),
  available BOOLEAN DEFAULT false,
  max_bookings SMALLINT DEFAULT 1,

  UNIQUE(product_id, day, hour)
);

CREATE INDEX IF NOT EXISTS idx_product_timeslots_product ON product_timeslots(product_id);


-- ============================================================
-- 6. bookings (예약)
-- ============================================================

CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  product_id UUID REFERENCES vendor_products(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- 고객 정보 (비회원 예약 대비)
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  customer_email TEXT,

  -- 예약 일시
  booking_date DATE NOT NULL,
  booking_time TEXT NOT NULL,       -- "14:00"

  -- 상태
  status booking_status DEFAULT 'pending',
  cancel_reason TEXT,

  -- 메모
  customer_memo TEXT,               -- 고객 메모
  vendor_memo TEXT,                 -- 업체 내부 메모

  -- 타임스탬프
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bookings_vendor ON bookings(vendor_id);
CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(vendor_id, booking_date);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(vendor_id, status);


-- ============================================================
-- 7. vendor_reviews (리뷰)
-- ============================================================

CREATE TABLE IF NOT EXISTS vendor_reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  product_id UUID REFERENCES vendor_products(id) ON DELETE SET NULL,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  rating SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  content TEXT,
  images TEXT[] DEFAULT '{}',

  -- 업체 답변
  reply TEXT,
  replied_at TIMESTAMPTZ,

  is_visible BOOLEAN DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendor_reviews_vendor ON vendor_reviews(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_reviews_rating ON vendor_reviews(vendor_id, rating);


-- ============================================================
-- 8. vendor_images (업체 갤러리)
-- ============================================================

CREATE TABLE IF NOT EXISTS vendor_images (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  product_id UUID REFERENCES vendor_products(id) ON DELETE SET NULL,

  url TEXT NOT NULL,
  alt_text TEXT,
  sort_order INTEGER DEFAULT 0,
  is_thumbnail BOOLEAN DEFAULT false,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendor_images_vendor ON vendor_images(vendor_id);


-- ============================================================
-- 9. RLS (Row Level Security) 정책
-- ============================================================

ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_timeslots ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_timeslots ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_images ENABLE ROW LEVEL SECURITY;

-- ── vendors ──

-- 승인된 업체는 누구나 조회 가능
CREATE POLICY "공개: 승인 업체 조회"
  ON vendors FOR SELECT
  USING (status = 'approved');

-- 업체 소유자는 자기 업체 전체 조회
CREATE POLICY "업체: 본인 업체 조회"
  ON vendors FOR SELECT
  USING (auth.uid() = user_id);

-- 업체 소유자는 자기 업체 수정
CREATE POLICY "업체: 본인 업체 수정"
  ON vendors FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 회원이면 업체 등록 가능
CREATE POLICY "업체: 신규 등록"
  ON vendors FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 서비스 역할: 전체 관리 (관리자 API용)
CREATE POLICY "서비스: 전체 관리"
  ON vendors FOR ALL
  USING (auth.role() = 'service_role');


-- ── vendor_products ──

-- 승인 업체의 활성 상품은 누구나 조회
CREATE POLICY "공개: 활성 상품 조회"
  ON vendor_products FOR SELECT
  USING (
    is_active = true
    AND EXISTS (
      SELECT 1 FROM vendors WHERE vendors.id = vendor_products.vendor_id AND vendors.status = 'approved'
    )
  );

-- 업체 소유자는 자기 상품 전체 관리
CREATE POLICY "업체: 본인 상품 조회"
  ON vendor_products FOR SELECT
  USING (EXISTS (SELECT 1 FROM vendors WHERE vendors.id = vendor_products.vendor_id AND vendors.user_id = auth.uid()));

CREATE POLICY "업체: 본인 상품 추가"
  ON vendor_products FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM vendors WHERE vendors.id = vendor_products.vendor_id AND vendors.user_id = auth.uid()));

CREATE POLICY "업체: 본인 상품 수정"
  ON vendor_products FOR UPDATE
  USING (EXISTS (SELECT 1 FROM vendors WHERE vendors.id = vendor_products.vendor_id AND vendors.user_id = auth.uid()));

CREATE POLICY "업체: 본인 상품 삭제"
  ON vendor_products FOR DELETE
  USING (EXISTS (SELECT 1 FROM vendors WHERE vendors.id = vendor_products.vendor_id AND vendors.user_id = auth.uid()));

CREATE POLICY "서비스: 상품 전체 관리"
  ON vendor_products FOR ALL
  USING (auth.role() = 'service_role');


-- ── vendor_timeslots ──

CREATE POLICY "공개: 승인 업체 타임슬롯 조회"
  ON vendor_timeslots FOR SELECT
  USING (EXISTS (SELECT 1 FROM vendors WHERE vendors.id = vendor_timeslots.vendor_id AND vendors.status = 'approved'));

CREATE POLICY "업체: 본인 타임슬롯 관리"
  ON vendor_timeslots FOR ALL
  USING (EXISTS (SELECT 1 FROM vendors WHERE vendors.id = vendor_timeslots.vendor_id AND vendors.user_id = auth.uid()));

CREATE POLICY "서비스: 타임슬롯 전체 관리"
  ON vendor_timeslots FOR ALL
  USING (auth.role() = 'service_role');


-- ── product_timeslots ──

CREATE POLICY "공개: 활성 상품 타임슬롯 조회"
  ON product_timeslots FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM vendor_products vp
    JOIN vendors v ON v.id = vp.vendor_id
    WHERE vp.id = product_timeslots.product_id
      AND vp.is_active = true
      AND v.status = 'approved'
  ));

CREATE POLICY "업체: 본인 상품 타임슬롯 관리"
  ON product_timeslots FOR ALL
  USING (EXISTS (
    SELECT 1 FROM vendor_products vp
    JOIN vendors v ON v.id = vp.vendor_id
    WHERE vp.id = product_timeslots.product_id
      AND v.user_id = auth.uid()
  ));

CREATE POLICY "서비스: 상품 타임슬롯 전체 관리"
  ON product_timeslots FOR ALL
  USING (auth.role() = 'service_role');


-- ── bookings ──

-- 고객은 자기 예약만 조회
CREATE POLICY "고객: 본인 예약 조회"
  ON bookings FOR SELECT
  USING (auth.uid() = customer_id);

-- 고객은 예약 생성 가능
CREATE POLICY "고객: 예약 생성"
  ON bookings FOR INSERT
  WITH CHECK (auth.uid() = customer_id);

-- 고객은 본인 예약 취소(수정) 가능
CREATE POLICY "고객: 본인 예약 수정"
  ON bookings FOR UPDATE
  USING (auth.uid() = customer_id);

-- 업체는 자기 업체 예약 조회/관리
CREATE POLICY "업체: 본인 예약 조회"
  ON bookings FOR SELECT
  USING (EXISTS (SELECT 1 FROM vendors WHERE vendors.id = bookings.vendor_id AND vendors.user_id = auth.uid()));

CREATE POLICY "업체: 본인 예약 관리"
  ON bookings FOR UPDATE
  USING (EXISTS (SELECT 1 FROM vendors WHERE vendors.id = bookings.vendor_id AND vendors.user_id = auth.uid()));

CREATE POLICY "서비스: 예약 전체 관리"
  ON bookings FOR ALL
  USING (auth.role() = 'service_role');


-- ── vendor_reviews ──

CREATE POLICY "공개: 리뷰 조회"
  ON vendor_reviews FOR SELECT
  USING (is_visible = true);

CREATE POLICY "고객: 리뷰 작성"
  ON vendor_reviews FOR INSERT
  WITH CHECK (auth.uid() = customer_id);

CREATE POLICY "고객: 본인 리뷰 수정"
  ON vendor_reviews FOR UPDATE
  USING (auth.uid() = customer_id);

CREATE POLICY "업체: 본인 리뷰 조회"
  ON vendor_reviews FOR SELECT
  USING (EXISTS (SELECT 1 FROM vendors WHERE vendors.id = vendor_reviews.vendor_id AND vendors.user_id = auth.uid()));

CREATE POLICY "업체: 리뷰 답변"
  ON vendor_reviews FOR UPDATE
  USING (EXISTS (SELECT 1 FROM vendors WHERE vendors.id = vendor_reviews.vendor_id AND vendors.user_id = auth.uid()));

CREATE POLICY "서비스: 리뷰 전체 관리"
  ON vendor_reviews FOR ALL
  USING (auth.role() = 'service_role');


-- ── vendor_images ──

CREATE POLICY "공개: 승인 업체 이미지 조회"
  ON vendor_images FOR SELECT
  USING (EXISTS (SELECT 1 FROM vendors WHERE vendors.id = vendor_images.vendor_id AND vendors.status = 'approved'));

CREATE POLICY "업체: 본인 이미지 관리"
  ON vendor_images FOR ALL
  USING (EXISTS (SELECT 1 FROM vendors WHERE vendors.id = vendor_images.vendor_id AND vendors.user_id = auth.uid()));

CREATE POLICY "서비스: 이미지 전체 관리"
  ON vendor_images FOR ALL
  USING (auth.role() = 'service_role');


-- ============================================================
-- 10. updated_at 자동 갱신 트리거
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_vendors_updated_at
  BEFORE UPDATE ON vendors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_vendor_products_updated_at
  BEFORE UPDATE ON vendor_products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_bookings_updated_at
  BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_vendor_reviews_updated_at
  BEFORE UPDATE ON vendor_reviews
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ============================================================
-- 11. 업체 평점 자동 업데이트 함수
-- ============================================================

CREATE OR REPLACE FUNCTION update_vendor_rating()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE vendors SET
    rating = (SELECT COALESCE(AVG(rating), 0) FROM vendor_reviews WHERE vendor_id = COALESCE(NEW.vendor_id, OLD.vendor_id) AND is_visible = true),
    review_count = (SELECT COUNT(*) FROM vendor_reviews WHERE vendor_id = COALESCE(NEW.vendor_id, OLD.vendor_id) AND is_visible = true)
  WHERE id = COALESCE(NEW.vendor_id, OLD.vendor_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_vendor_rating_on_review
  AFTER INSERT OR UPDATE OR DELETE ON vendor_reviews
  FOR EACH ROW EXECUTE FUNCTION update_vendor_rating();


-- ============================================================
-- 12. 타임슬롯 일괄 생성 함수 (업체 등록 시 호출)
-- ============================================================

-- 업체 기본 타임슬롯 일괄 생성 (9시~20시, 월~일)
CREATE OR REPLACE FUNCTION create_default_vendor_timeslots(p_vendor_id UUID)
RETURNS VOID AS $$
DECLARE
  d SMALLINT;
  h SMALLINT;
BEGIN
  FOR d IN 0..6 LOOP
    FOR h IN 9..20 LOOP
      INSERT INTO vendor_timeslots (vendor_id, day, hour, available, max_bookings)
      VALUES (p_vendor_id, d, h, false, 1)
      ON CONFLICT (vendor_id, day, hour) DO NOTHING;
    END LOOP;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- 상품 타임슬롯 일괄 생성
CREATE OR REPLACE FUNCTION create_default_product_timeslots(p_product_id UUID)
RETURNS VOID AS $$
DECLARE
  d SMALLINT;
  h SMALLINT;
BEGIN
  FOR d IN 0..6 LOOP
    FOR h IN 9..20 LOOP
      INSERT INTO product_timeslots (product_id, day, hour, available, max_bookings)
      VALUES (p_product_id, d, h, false, 1)
      ON CONFLICT (product_id, day, hour) DO NOTHING;
    END LOOP;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- 업체 생성 시 자동으로 기본 타임슬롯 생성
CREATE OR REPLACE FUNCTION auto_create_vendor_timeslots()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM create_default_vendor_timeslots(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER auto_vendor_timeslots
  AFTER INSERT ON vendors
  FOR EACH ROW EXECUTE FUNCTION auto_create_vendor_timeslots();

-- 상품 생성 시 자동으로 타임슬롯 생성
CREATE OR REPLACE FUNCTION auto_create_product_timeslots()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM create_default_product_timeslots(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER auto_product_timeslots
  AFTER INSERT ON vendor_products
  FOR EACH ROW EXECUTE FUNCTION auto_create_product_timeslots();


-- ============================================================
-- 13. 유용한 뷰 (View)
-- ============================================================

-- 관리자용: 심사 대기 업체
CREATE OR REPLACE VIEW admin_pending_vendors AS
SELECT
  v.id, v.name, v.category, v.owner_name, v.phone, v.email,
  v.business_number, v.business_license_url,
  v.location, v.description,
  v.created_at,
  (SELECT COUNT(*) FROM vendor_products WHERE vendor_id = v.id) AS product_count
FROM vendors v
WHERE v.status = 'pending'
ORDER BY v.created_at ASC;

-- 고객용: 승인 업체 + 상품 수 + 가능 슬롯 수
CREATE OR REPLACE VIEW public_vendors AS
SELECT
  v.id, v.name, v.category, v.location, v.description,
  v.price_range, v.price_min, v.price_max,
  v.rating, v.review_count,
  v.tags, v.thumbnail_url, v.ai_recommend,
  (SELECT COUNT(*) FROM vendor_products WHERE vendor_id = v.id AND is_active = true) AS active_product_count,
  (SELECT COUNT(*) FROM vendor_timeslots WHERE vendor_id = v.id AND available = true) AS available_slot_count
FROM vendors v
WHERE v.status = 'approved'
ORDER BY v.ai_recommend DESC, v.rating DESC;

-- 업체용: 오늘의 예약
CREATE OR REPLACE VIEW vendor_today_bookings AS
SELECT
  b.*,
  vp.name AS product_name,
  vp.duration AS product_duration
FROM bookings b
LEFT JOIN vendor_products vp ON vp.id = b.product_id
WHERE b.booking_date = CURRENT_DATE
ORDER BY b.booking_time ASC;


-- ============================================================
-- 14. Storage 버킷 (이미지 업로드용)
-- ============================================================

-- Supabase Dashboard > Storage에서 생성하거나 아래 SQL 실행
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('vendor-images', 'vendor-images', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('vendor-licenses', 'vendor-licenses', false, 10485760, ARRAY['image/jpeg', 'image/png', 'application/pdf'])
ON CONFLICT (id) DO NOTHING;

-- vendor-images: 공개 (고객이 볼 수 있음)
CREATE POLICY "공개: 업체 이미지 조회"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'vendor-images');

CREATE POLICY "업체: 본인 이미지 업로드"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'vendor-images'
    AND auth.role() = 'authenticated'
  );

CREATE POLICY "업체: 본인 이미지 삭제"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'vendor-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- vendor-licenses: 비공개 (관리자만)
CREATE POLICY "업체: 사업자등록증 업로드"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'vendor-licenses'
    AND auth.role() = 'authenticated'
  );

CREATE POLICY "서비스: 사업자등록증 조회"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'vendor-licenses'
    AND auth.role() = 'service_role'
  );


-- ============================================================
-- 완료! 테이블 8개 + 뷰 3개 + 트리거 6개 + Storage 2개
-- ============================================================
