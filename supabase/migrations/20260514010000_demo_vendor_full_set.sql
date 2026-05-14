-- 데모용 풍부한 vendor seed
--
-- 20260514000000_demo_vendor_seed.sql 의 A 스튜디오에 더해서:
--   • 카테고리별 vendor 3종 (스튜디오 / 드레스 / 메이크업)
--   • 각 vendor에 상품 2~3개 (category_fields 까지 채움 — mockVendors.ts 형식)
--   • 각 vendor에 스태프 2~3명 + 스태프별 슬롯
--   • vendor 단위 주간 슬롯 (월~토, 10~18시)
--
-- 안전장치
--   • ON CONFLICT DO NOTHING — 반복 적용 시 중복 INSERT 없음
--   • owner_id = NULL — 실제 업주 계정과 충돌 없음
--   • 모든 데이터 status='approved' → 일반 조회에서 매칭됨
--   • 운영 시 정리하려면 vendors 4개 id로 DELETE (cascade로 product/staff/slot 자동 삭제)
--
-- 데모 흐름
--   1) /community/vendor/A%20스튜디오 (또는 강남 미니멀)
--   2) /community/vendor/B%20드레스 (청담 우아)
--   3) /community/vendor/C%20메이크업 (압구정 내추럴)
--   4) catchtable 슬롯 / 스태프 선택 / 예약 클릭 → /vendors/[id]?product=…


-- ============================================================
-- 1) Vendors — 3개 (기존 A 스튜디오 + B 드레스 + C 메이크업)
-- ============================================================

INSERT INTO vendors (
  id, owner_id, name, category, location, region, address,
  description, price_range, price_min, price_max,
  rating, review_count, tags, style_tags,
  ai_recommend, status, thumbnail_url, created_at, updated_at
)
VALUES
  -- B 드레스 — 청담 / 우아·클래식
  (
    '22222222-2222-2222-2222-222222222222', NULL,
    'B 드레스', '드레스', '서울 청담', '서울',
    '서울 강남구 청담동 45-7',
    '청담 라인의 우아한 클래식 드레스 전문. 베라왕·로사클라라 등 디자이너 라인업과 합리적 패키지를 함께 운영합니다.',
    '200~500만원대', 2000000, 5500000,
    4.8, 96,
    ARRAY['우아','클래식','프리미엄','청담','디자이너']::text[],
    ARRAY['우아','클래식','심플','로맨틱']::text[],
    TRUE, 'approved', NULL, NOW(), NOW()
  ),
  -- C 메이크업 — 압구정 / 내추럴·글래스
  (
    '33333333-3333-3333-3333-333333333333', NULL,
    'C 메이크업', '메이크업', '서울 압구정', '서울',
    '서울 강남구 압구정로 109',
    '내추럴 글래스 메이크업 전문 샵. 본식+리허설 패키지와 출장 서비스, 혼주 메이크업까지 한 곳에서.',
    '40~120만원', 400000, 1200000,
    4.9, 152,
    ARRAY['내추럴','글래스','압구정','출장가능']::text[],
    ARRAY['내추럴','글래스','우아','심플']::text[],
    TRUE, 'approved', NULL, NOW(), NOW()
  )
ON CONFLICT (id) DO NOTHING;

-- 기존 A 스튜디오에 style_tags 보강 (기존 INSERT에는 없었음)
UPDATE vendors
SET style_tags = ARRAY['미니멀','자연광','시네마틱','심플']::text[]
WHERE id = '11111111-1111-1111-1111-111111111111'
  AND (style_tags IS NULL OR cardinality(style_tags) = 0);


-- ============================================================
-- 2) Vendor Products
--    각 vendor당 2~3개, category_fields JSON 까지 mockVendors.ts 형식대로
-- ============================================================

-- A 스튜디오 — 기존 (11111111-2222-2222-2222-111111111111 / 222...) 외에 추가 상품 1개
INSERT INTO vendor_products (
  id, vendor_id, name, description, price, discount_price, duration_minutes,
  is_active, is_popular, sort_order, category_fields, includes, images, created_at, updated_at
)
VALUES
  -- A 스튜디오 — 기존 두 상품의 category_fields 보강용 (별도 id로 추가)
  (
    '11111111-2222-2222-2222-333333333333',
    '11111111-1111-1111-1111-111111111111',
    '시네마틱 풀패키지',
    '본식 스냅 + 야외 1시간 + 시네마틱 무비 + 원본 전체 + 앨범 12x12 30p',
    5500000, 4900000, 480,
    TRUE, FALSE, 3,
    jsonb_build_object(
      'photographerRank', '원장',
      'shootingHours', '4시간',
      'conceptCount', 4,
      'outfitCount', 4,
      'editedPhotos', 80,
      'originalProvide', '전체 제공',
      'albumType', '12x12 (30p)',
      'additionalAlbum', '양가 부모님 앨범 2권',
      'frameType', '16x20 1개',
      'videoIncluded', '시네마틱 무비',
      'hairMakeup', false,
      'outdoorAvailable', true,
      'assistantIncluded', true,
      'retouchDelivery', '4주'
    ),
    ARRAY['본식 스냅 120컷', '보정본 80컷', '원본 데이터', '야외 1시간', '시네마틱 무비', '12x12 앨범 30p', '부모님 앨범 2권', '액자 1개']::text[],
    ARRAY[]::text[],
    NOW(), NOW()
  ),

  -- B 드레스
  (
    '22222222-2222-2222-2222-aaaaaaaaaaaa',
    '22222222-2222-2222-2222-222222222222',
    '프리미엄 디자이너 패키지',
    '베라왕·로사클라라 라인 본식 + 컬러 드레스 + 헬퍼 포함',
    2800000, NULL, 240,
    TRUE, TRUE, 1,
    jsonb_build_object(
      'dressType', '웨딩 드레스',
      'dressLine', jsonb_build_array('A라인','머메이드'),
      'grade', '프리미엄',
      'brand', 'Vera Wang · Rosa Clara',
      'rentalPeriod', '1박2일',
      'fittingCount', '3회',
      'alterationIncluded', true,
      'accessories', jsonb_build_array('베일','글러브','티아라'),
      'undergarment', '드레스용 속옷 세트',
      'additionalDress', '1벌 추가 가능',
      'cleaningFee', false,
      'insuranceAvailable', true
    ),
    ARRAY['본식 드레스 1벌','컬러 드레스 1벌','피팅 3회','수선 포함','베일·글러브','속옷 세트','헬퍼 1명']::text[],
    ARRAY[]::text[],
    NOW(), NOW()
  ),
  (
    '22222222-2222-2222-2222-bbbbbbbbbbbb',
    '22222222-2222-2222-2222-222222222222',
    '럭셔리 수입 오리지널',
    '수입 오리지널 드레스 + 본식·2부 드레스 + 풀 액세서리',
    4800000, 4500000, 240,
    TRUE, FALSE, 2,
    jsonb_build_object(
      'dressType', '웨딩 드레스',
      'dressLine', jsonb_build_array('볼가운','프린세스'),
      'grade', '수입 오리지널',
      'brand', 'Pronovias · Monique Lhuillier',
      'rentalPeriod', '2박3일',
      'fittingCount', '무제한',
      'alterationIncluded', true,
      'accessories', jsonb_build_array('베일','글러브','티아라','이어링','목걸이'),
      'undergarment', '드레스용 속옷 세트',
      'additionalDress', '2벌 추가 가능',
      'cleaningFee', false,
      'insuranceAvailable', true
    ),
    ARRAY['수입 본식 드레스','2부 드레스','피팅 무제한','수선 포함','풀 액세서리','드레스 보험','헬퍼 1명']::text[],
    ARRAY[]::text[],
    NOW(), NOW()
  ),

  -- C 메이크업
  (
    '33333333-3333-3333-3333-aaaaaaaaaaaa',
    '33333333-3333-3333-3333-333333333333',
    '본식 + 리허설 패키지',
    '신부 본식 + 리허설 + 혼주 1명 + 출장 가능',
    750000, NULL, 180,
    TRUE, TRUE, 1,
    jsonb_build_object(
      'serviceType', '본식+리허설 패키지',
      'includesHair', true,
      'includesMakeup', true,
      'artistLevel', '실장',
      'brideIncluded', true,
      'motherCount', '1명',
      'familyMakeup', '1인 추가 가능',
      'touchUpCount', '2회',
      'onLocation', '출장 가능 (추가비 별도)',
      'consultIncluded', true,
      'cosmeticsGrade', '백화점 브랜드'
    ),
    ARRAY['신부 본식 헤어/메이크업','리허설 헤어/메이크업','혼주 1명','터치업 2회','사전 상담']::text[],
    ARRAY[]::text[],
    NOW(), NOW()
  ),
  (
    '33333333-3333-3333-3333-bbbbbbbbbbbb',
    '33333333-3333-3333-3333-333333333333',
    '올인원 럭셔리',
    '신부 + 혼주 2명 + 가족 2인 + 무제한 터치업 + 하이엔드 화장품',
    1150000, 1050000, 240,
    TRUE, FALSE, 2,
    jsonb_build_object(
      'serviceType', '올인원 패키지',
      'includesHair', true,
      'includesMakeup', true,
      'artistLevel', '원장',
      'brideIncluded', true,
      'motherCount', '2명',
      'familyMakeup', '2인 추가 가능',
      'touchUpCount', '무제한',
      'onLocation', '출장 가능 (추가비 없음)',
      'consultIncluded', true,
      'cosmeticsGrade', '하이엔드 (샤넬, 디올 등)'
    ),
    ARRAY['신부 본식·리허설','혼주 2명','가족 2인','무제한 터치업','출장 무료','하이엔드 화장품']::text[],
    ARRAY[]::text[],
    NOW(), NOW()
  )
ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- 3) Vendor Staff — 각 vendor 2~3명
-- ============================================================

INSERT INTO vendor_staff (id, vendor_id, name, role, description, is_active, sort_order, created_at)
VALUES
  -- A 스튜디오
  ('aaaa1111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '이지훈 작가', '원장', '미니멀 자연광 12년 경력, 시네마틱 영상까지', TRUE, 1, NOW()),
  ('aaaa1111-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '박서연 작가', '실장', '인물 위주 따뜻한 톤, 야외 촬영 전문', TRUE, 2, NOW()),
  ('aaaa1111-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '김태우 작가', '수석', '컨셉 풍부, 다양한 라이트 활용', TRUE, 3, NOW()),

  -- B 드레스
  ('bbbb2222-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '최유진 실장', '원장', '디자이너 라인 큐레이션, 체형별 맞춤 컨설팅', TRUE, 1, NOW()),
  ('bbbb2222-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', '한소영 디자이너', '부원장', '수입 오리지널 전문, 영문 상담 가능', TRUE, 2, NOW()),

  -- C 메이크업
  ('cccc3333-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', '정혜린 원장', '원장', '내추럴 글래스의 정석, 15년 경력', TRUE, 1, NOW()),
  ('cccc3333-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333', '윤주아 부원장', '부원장', '광채 베이스 전문, 사진발 잘 받는 룩', TRUE, 2, NOW()),
  ('cccc3333-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333', '서민지 실장', '실장', '혼주 메이크업·헤어 통합 케어', TRUE, 3, NOW())
ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- 4) Vendor Timeslots — 업체 기본 주간 스케줄
--    월(0)~토(5) / 10시~17시 — 일요일 휴무
-- ============================================================

-- A 스튜디오
INSERT INTO vendor_timeslots (vendor_id, day, hour, available, max_bookings)
SELECT '11111111-1111-1111-1111-111111111111', d, h, TRUE, 2
FROM generate_series(0, 5) d, generate_series(10, 17) h
ON CONFLICT (vendor_id, day, hour) DO NOTHING;

-- B 드레스
INSERT INTO vendor_timeslots (vendor_id, day, hour, available, max_bookings)
SELECT '22222222-2222-2222-2222-222222222222', d, h, TRUE, 2
FROM generate_series(0, 5) d, generate_series(11, 18) h
ON CONFLICT (vendor_id, day, hour) DO NOTHING;

-- C 메이크업 — 새벽 출장 대비 9시부터
INSERT INTO vendor_timeslots (vendor_id, day, hour, available, max_bookings)
SELECT '33333333-3333-3333-3333-333333333333', d, h, TRUE, 3
FROM generate_series(0, 5) d, generate_series(9, 17) h
ON CONFLICT (vendor_id, day, hour) DO NOTHING;


-- ============================================================
-- 5) Staff Timeslots — 스태프별 개별 슬롯 (vendor 슬롯 안에서)
--    각 스태프가 모든 시간을 다 잡지는 않게 변형 (요일별 휴무)
-- ============================================================

-- A 스튜디오 작가별 슬롯
INSERT INTO staff_timeslots (staff_id, day, hour, available, max_bookings)
SELECT 'aaaa1111-0000-0000-0000-000000000001', d, h, TRUE, 1
FROM generate_series(0, 5) d, generate_series(10, 17) h
WHERE d <> 1  -- 이지훈 작가: 화요일 휴무
ON CONFLICT (staff_id, day, hour) DO NOTHING;

INSERT INTO staff_timeslots (staff_id, day, hour, available, max_bookings)
SELECT 'aaaa1111-0000-0000-0000-000000000002', d, h, TRUE, 1
FROM generate_series(0, 5) d, generate_series(10, 17) h
WHERE d <> 2  -- 박서연 작가: 수요일 휴무
ON CONFLICT (staff_id, day, hour) DO NOTHING;

INSERT INTO staff_timeslots (staff_id, day, hour, available, max_bookings)
SELECT 'aaaa1111-0000-0000-0000-000000000003', d, h, TRUE, 1
FROM generate_series(2, 5) d, generate_series(10, 17) h  -- 김태우 작가: 수~토만
ON CONFLICT (staff_id, day, hour) DO NOTHING;

-- B 드레스 스태프
INSERT INTO staff_timeslots (staff_id, day, hour, available, max_bookings)
SELECT 'bbbb2222-0000-0000-0000-000000000001', d, h, TRUE, 1
FROM generate_series(0, 5) d, generate_series(11, 18) h
WHERE d <> 0  -- 최유진 실장: 월요일 휴무
ON CONFLICT (staff_id, day, hour) DO NOTHING;

INSERT INTO staff_timeslots (staff_id, day, hour, available, max_bookings)
SELECT 'bbbb2222-0000-0000-0000-000000000002', d, h, TRUE, 1
FROM generate_series(1, 5) d, generate_series(11, 18) h  -- 한소영: 화~토
ON CONFLICT (staff_id, day, hour) DO NOTHING;

-- C 메이크업 스태프
INSERT INTO staff_timeslots (staff_id, day, hour, available, max_bookings)
SELECT 'cccc3333-0000-0000-0000-000000000001', d, h, TRUE, 1
FROM generate_series(0, 5) d, generate_series(9, 17) h
WHERE d <> 3  -- 정혜린 원장: 목요일 휴무
ON CONFLICT (staff_id, day, hour) DO NOTHING;

INSERT INTO staff_timeslots (staff_id, day, hour, available, max_bookings)
SELECT 'cccc3333-0000-0000-0000-000000000002', d, h, TRUE, 1
FROM generate_series(0, 5) d, generate_series(9, 17) h
WHERE d <> 4  -- 윤주아 부원장: 금요일 휴무
ON CONFLICT (staff_id, day, hour) DO NOTHING;

INSERT INTO staff_timeslots (staff_id, day, hour, available, max_bookings)
SELECT 'cccc3333-0000-0000-0000-000000000003', d, h, TRUE, 1
FROM generate_series(0, 5) d, generate_series(9, 15) h  -- 서민지: 단축 근무
ON CONFLICT (staff_id, day, hour) DO NOTHING;
