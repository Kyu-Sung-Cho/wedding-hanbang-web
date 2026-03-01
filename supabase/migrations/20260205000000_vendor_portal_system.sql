-- ============================================================
-- 웨딩한방 업체 포털 시스템 (기존 스키마 위에 추가)
-- 002_vendor_system.sql
-- ============================================================
-- ⚠️ 기존 스키마(깨끗한 스키마 + 업체 관리 시스템)가 이미 실행된 상태에서 실행
-- ⚠️ 기존 vendors, vendor_products, vendor_images 테이블은 ALTER로 확장
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. 기존 vendors 테이블에 누락된 컬럼 추가
-- ============================================================
-- 기존: id, name, category(TEXT), region, address, phone, website, instagram,
--       description, style_tags, is_fixed_price, is_verified, rating, review_count,
--       thumbnail_url, owner_id, commission_rate, bank_account, business_number,
--       created_at, updated_at

ALTER TABLE vendors ADD COLUMN IF NOT EXISTS owner_name TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS location TEXT;        -- 간략 위치 (예: "서울 강남구")
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS price_range TEXT;     -- 표시용 "250~350만원"
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS price_min INTEGER DEFAULT 0;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS price_max INTEGER DEFAULT 0;

-- 심사 시스템
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS reject_reason TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;

-- 사업자등록증 이미지
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS business_license_url TEXT;

-- AI 추천
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS ai_recommend BOOLEAN DEFAULT false;

-- 영업시간
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS business_hours JSONB DEFAULT '{"mon":"10:00-19:00","tue":"10:00-19:00","wed":"10:00-19:00","thu":"10:00-19:00","fri":"10:00-19:00","sat":"10:00-18:00","sun":"휴무"}';

-- status 체크 제약 (이미 없으면 추가)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vendors_status_check'
  ) THEN
    ALTER TABLE vendors
    ADD CONSTRAINT vendors_status_check
    CHECK (status IN ('pending', 'approved', 'rejected'));
  END IF;
END $$;

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_vendors_status ON vendors(status);
CREATE INDEX IF NOT EXISTS idx_vendors_rating_desc ON vendors(rating DESC);


-- ============================================================
-- 2. 기존 vendor_products 테이블에 누락된 컬럼 추가
-- ============================================================
-- 기존: id, vendor_id, name, price, original_price, includes, excludes,
--       duration(TEXT), notes, is_popular, sort_order, created_at, updated_at

ALTER TABLE vendor_products ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE vendor_products ADD COLUMN IF NOT EXISTS discount_price INTEGER;
ALTER TABLE vendor_products ADD COLUMN IF NOT EXISTS duration_minutes INTEGER DEFAULT 60;  -- 분 단위 (기존 duration은 TEXT)
ALTER TABLE vendor_products ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE vendor_products ADD COLUMN IF NOT EXISTS category_fields JSONB DEFAULT '{}';
ALTER TABLE vendor_products ADD COLUMN IF NOT EXISTS images TEXT[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_vendor_products_active ON vendor_products(vendor_id, is_active);


-- ============================================================
-- 3. 기존 vendor_images 테이블에 누락된 컬럼 추가
-- ============================================================
-- 기존: id, vendor_id, image_url, image_type, sort_order, created_at

ALTER TABLE vendor_images ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES vendor_products(id) ON DELETE SET NULL;
ALTER TABLE vendor_images ADD COLUMN IF NOT EXISTS alt_text TEXT;
ALTER TABLE vendor_images ADD COLUMN IF NOT EXISTS is_thumbnail BOOLEAN DEFAULT false;


-- ============================================================
-- 4. vendor_timeslots (업체 기본 주간 스케줄) — 신규
-- ============================================================

CREATE TABLE IF NOT EXISTS vendor_timeslots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  day SMALLINT NOT NULL CHECK (day >= 0 AND day <= 6),   -- 0=월 ~ 6=일
  hour SMALLINT NOT NULL CHECK (hour >= 0 AND hour <= 23),
  available BOOLEAN DEFAULT false,
  max_bookings SMALLINT DEFAULT 1,
  UNIQUE(vendor_id, day, hour)
);

CREATE INDEX IF NOT EXISTS idx_vendor_timeslots_vendor ON vendor_timeslots(vendor_id);


-- ============================================================
-- 5. product_timeslots (상품별 예약 가능 시간) — 신규
-- ============================================================

CREATE TABLE IF NOT EXISTS product_timeslots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES vendor_products(id) ON DELETE CASCADE,
  day SMALLINT NOT NULL CHECK (day >= 0 AND day <= 6),
  hour SMALLINT NOT NULL CHECK (hour >= 0 AND hour <= 23),
  available BOOLEAN DEFAULT false,
  max_bookings SMALLINT DEFAULT 1,
  UNIQUE(product_id, day, hour)
);

CREATE INDEX IF NOT EXISTS idx_product_timeslots_product ON product_timeslots(product_id);


-- ============================================================
-- 6. vendor_reviews (리뷰) — 신규
-- ============================================================

CREATE TABLE IF NOT EXISTS vendor_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  product_id UUID REFERENCES vendor_products(id) ON DELETE SET NULL,
  booking_id UUID REFERENCES vendor_bookings(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  rating SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  content TEXT,
  images TEXT[] DEFAULT '{}',
  reply TEXT,
  replied_at TIMESTAMPTZ,
  is_visible BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendor_reviews_vendor ON vendor_reviews(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_reviews_rating ON vendor_reviews(vendor_id, rating);


-- ============================================================
-- 7. RLS 정책 (기존 정책과 충돌 방지: DROP IF EXISTS 후 재생성)
-- ============================================================

-- ── vendor_timeslots ──
ALTER TABLE vendor_timeslots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "공개: 승인 업체 타임슬롯 조회"
  ON vendor_timeslots FOR SELECT
  USING (EXISTS (SELECT 1 FROM vendors WHERE vendors.id = vendor_timeslots.vendor_id AND vendors.status = 'approved'));

CREATE POLICY "업체: 본인 타임슬롯 관리"
  ON vendor_timeslots FOR ALL
  USING (EXISTS (SELECT 1 FROM vendors WHERE vendors.id = vendor_timeslots.vendor_id AND vendors.owner_id = auth.uid()));

CREATE POLICY "서비스: 타임슬롯 전체 관리"
  ON vendor_timeslots FOR ALL
  USING (auth.role() = 'service_role');


-- ── product_timeslots ──
ALTER TABLE product_timeslots ENABLE ROW LEVEL SECURITY;

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
      AND v.owner_id = auth.uid()
  ));

CREATE POLICY "서비스: 상품 타임슬롯 전체 관리"
  ON product_timeslots FOR ALL
  USING (auth.role() = 'service_role');


-- ── vendor_reviews ──
ALTER TABLE vendor_reviews ENABLE ROW LEVEL SECURITY;

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
  USING (EXISTS (SELECT 1 FROM vendors WHERE vendors.id = vendor_reviews.vendor_id AND vendors.owner_id = auth.uid()));

CREATE POLICY "업체: 리뷰 답변"
  ON vendor_reviews FOR UPDATE
  USING (EXISTS (SELECT 1 FROM vendors WHERE vendors.id = vendor_reviews.vendor_id AND vendors.owner_id = auth.uid()));

CREATE POLICY "서비스: 리뷰 전체 관리"
  ON vendor_reviews FOR ALL
  USING (auth.role() = 'service_role');


-- ── vendors 추가 정책 (owner_id 기반, 기존 정책에 없는 것만) ──
DROP POLICY IF EXISTS "업체: 본인 업체 조회" ON vendors;
DROP POLICY IF EXISTS "업체: 본인 업체 수정" ON vendors;
DROP POLICY IF EXISTS "업체: 신규 등록" ON vendors;
DROP POLICY IF EXISTS "서비스: 전체 관리" ON vendors;
DROP POLICY IF EXISTS "공개: 승인 업체 조회" ON vendors;

CREATE POLICY "공개: 승인 업체 조회"
  ON vendors FOR SELECT
  USING (status = 'approved');

CREATE POLICY "업체: 본인 업체 조회"
  ON vendors FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "업체: 본인 업체 수정"
  ON vendors FOR UPDATE
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "업체: 신규 등록"
  ON vendors FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "서비스: vendors 전체 관리"
  ON vendors FOR ALL
  USING (auth.role() = 'service_role');


-- ── vendor_products 추가 정책 (owner_id 기반) ──
DROP POLICY IF EXISTS "업체: 본인 상품 조회" ON vendor_products;
DROP POLICY IF EXISTS "업체: 본인 상품 추가" ON vendor_products;
DROP POLICY IF EXISTS "업체: 본인 상품 수정" ON vendor_products;
DROP POLICY IF EXISTS "업체: 본인 상품 삭제" ON vendor_products;
DROP POLICY IF EXISTS "공개: 활성 상품 조회" ON vendor_products;
DROP POLICY IF EXISTS "서비스: 상품 전체 관리" ON vendor_products;

CREATE POLICY "공개: 활성 상품 조회"
  ON vendor_products FOR SELECT
  USING (
    is_active = true
    AND EXISTS (SELECT 1 FROM vendors WHERE vendors.id = vendor_products.vendor_id AND vendors.status = 'approved')
  );

CREATE POLICY "업체: 본인 상품 조회"
  ON vendor_products FOR SELECT
  USING (EXISTS (SELECT 1 FROM vendors WHERE vendors.id = vendor_products.vendor_id AND vendors.owner_id = auth.uid()));

CREATE POLICY "업체: 본인 상품 추가"
  ON vendor_products FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM vendors WHERE vendors.id = vendor_products.vendor_id AND vendors.owner_id = auth.uid()));

CREATE POLICY "업체: 본인 상품 수정"
  ON vendor_products FOR UPDATE
  USING (EXISTS (SELECT 1 FROM vendors WHERE vendors.id = vendor_products.vendor_id AND vendors.owner_id = auth.uid()));

CREATE POLICY "업체: 본인 상품 삭제"
  ON vendor_products FOR DELETE
  USING (EXISTS (SELECT 1 FROM vendors WHERE vendors.id = vendor_products.vendor_id AND vendors.owner_id = auth.uid()));

CREATE POLICY "서비스: 상품 전체 관리"
  ON vendor_products FOR ALL
  USING (auth.role() = 'service_role');


-- ── vendor_images 추가 정책 (owner_id 기반) ──
DROP POLICY IF EXISTS "업체: 본인 이미지 관리" ON vendor_images;
DROP POLICY IF EXISTS "공개: 승인 업체 이미지 조회" ON vendor_images;
DROP POLICY IF EXISTS "서비스: 이미지 전체 관리" ON vendor_images;

CREATE POLICY "공개: 승인 업체 이미지 조회"
  ON vendor_images FOR SELECT
  USING (EXISTS (SELECT 1 FROM vendors WHERE vendors.id = vendor_images.vendor_id AND vendors.status = 'approved'));

CREATE POLICY "업체: 본인 이미지 관리"
  ON vendor_images FOR ALL
  USING (EXISTS (SELECT 1 FROM vendors WHERE vendors.id = vendor_images.vendor_id AND vendors.owner_id = auth.uid()));

CREATE POLICY "서비스: 이미지 전체 관리"
  ON vendor_images FOR ALL
  USING (auth.role() = 'service_role');


-- ============================================================
-- 8. 트리거 & 함수
-- ============================================================

-- updated_at 자동 갱신 (이미 있으면 교체)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- vendor_reviews용 트리거
DROP TRIGGER IF EXISTS set_vendor_reviews_updated_at ON vendor_reviews;
CREATE TRIGGER set_vendor_reviews_updated_at
  BEFORE UPDATE ON vendor_reviews
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 업체 평점 자동 계산
CREATE OR REPLACE FUNCTION update_vendor_rating()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE vendors SET
    rating = (SELECT COALESCE(AVG(rating)::NUMERIC(2,1), 0) FROM vendor_reviews WHERE vendor_id = COALESCE(NEW.vendor_id, OLD.vendor_id) AND is_visible = true),
    review_count = (SELECT COUNT(*)::INTEGER FROM vendor_reviews WHERE vendor_id = COALESCE(NEW.vendor_id, OLD.vendor_id) AND is_visible = true)
  WHERE id = COALESCE(NEW.vendor_id, OLD.vendor_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_vendor_rating_on_review ON vendor_reviews;
CREATE TRIGGER update_vendor_rating_on_review
  AFTER INSERT OR UPDATE OR DELETE ON vendor_reviews
  FOR EACH ROW EXECUTE FUNCTION update_vendor_rating();


-- ============================================================
-- 9. 타임슬롯 자동 생성 함수
-- ============================================================

-- 업체 기본 타임슬롯 (9~20시, 월~일 = 84개)
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

-- 상품 타임슬롯 (9~20시, 월~일 = 84개)
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

-- 업체 생성 → 타임슬롯 자동 생성
CREATE OR REPLACE FUNCTION auto_create_vendor_timeslots()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM create_default_vendor_timeslots(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS auto_vendor_timeslots ON vendors;
CREATE TRIGGER auto_vendor_timeslots
  AFTER INSERT ON vendors
  FOR EACH ROW EXECUTE FUNCTION auto_create_vendor_timeslots();

-- 상품 생성 → 타임슬롯 자동 생성
CREATE OR REPLACE FUNCTION auto_create_product_timeslots()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM create_default_product_timeslots(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS auto_product_timeslots ON vendor_products;
CREATE TRIGGER auto_product_timeslots
  AFTER INSERT ON vendor_products
  FOR EACH ROW EXECUTE FUNCTION auto_create_product_timeslots();


-- ============================================================
-- 10. 유용한 뷰
-- ============================================================

-- 관리자용: 심사 대기 업체
CREATE OR REPLACE VIEW admin_pending_vendors AS
SELECT
  v.id, v.name, v.category, v.owner_name, v.phone, v.email,
  v.business_number, v.business_license_url,
  v.location, v.region, v.description,
  v.created_at,
  (SELECT COUNT(*) FROM vendor_products WHERE vendor_id = v.id) AS product_count
FROM vendors v
WHERE v.status = 'pending'
ORDER BY v.created_at ASC;

-- 고객용: 승인 업체 목록
CREATE OR REPLACE VIEW public_vendors AS
SELECT
  v.id, v.name, v.category, v.location, v.region, v.description,
  v.price_range, v.price_min, v.price_max,
  v.rating, v.review_count,
  v.tags, v.style_tags, v.thumbnail_url, v.ai_recommend,
  (SELECT COUNT(*) FROM vendor_products WHERE vendor_id = v.id AND is_active = true) AS active_product_count,
  (SELECT COUNT(*) FROM vendor_timeslots WHERE vendor_id = v.id AND available = true) AS available_slot_count
FROM vendors v
WHERE v.status = 'approved'
ORDER BY v.ai_recommend DESC, v.rating DESC;

-- 업체용: 오늘의 예약 (기존 vendor_bookings 테이블 사용)
CREATE OR REPLACE VIEW vendor_today_bookings AS
SELECT
  b.*,
  vp.name AS product_name,
  vp.duration_minutes AS product_duration
FROM vendor_bookings b
LEFT JOIN vendor_products vp ON vp.id = b.product_id
WHERE b.booking_date = CURRENT_DATE
ORDER BY b.booking_time ASC;


-- ============================================================
-- 11. Storage 버킷
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('vendor-images', 'vendor-images', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('vendor-licenses', 'vendor-licenses', false, 10485760, ARRAY['image/jpeg', 'image/png', 'application/pdf'])
ON CONFLICT (id) DO NOTHING;

-- vendor-images: 공개
DO $$ BEGIN
  CREATE POLICY "공개: 업체 이미지 조회"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'vendor-images');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "업체: 본인 이미지 업로드"
    ON storage.objects FOR INSERT
    WITH CHECK (bucket_id = 'vendor-images' AND auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "업체: 본인 이미지 삭제"
    ON storage.objects FOR DELETE
    USING (bucket_id = 'vendor-images' AND auth.uid()::text = (storage.foldername(name))[1]);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- vendor-licenses: 비공개
DO $$ BEGIN
  CREATE POLICY "업체: 사업자등록증 업로드"
    ON storage.objects FOR INSERT
    WITH CHECK (bucket_id = 'vendor-licenses' AND auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "서비스: 사업자등록증 조회"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'vendor-licenses' AND auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ============================================================
-- 완료!
-- 추가: 테이블 3개 (vendor_timeslots, product_timeslots, vendor_reviews)
-- 확장: 기존 테이블 3개에 컬럼 추가 (vendors, vendor_products, vendor_images)
-- Storage 버킷 2개, 뷰 3개, 트리거 4개
-- ============================================================
SELECT '업체 포털 시스템 설치 완료!' as result;
