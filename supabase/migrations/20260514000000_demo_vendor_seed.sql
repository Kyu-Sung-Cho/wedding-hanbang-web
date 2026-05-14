-- 데모용 vendor seed (catchtable 슬롯 화면 보장)
--
-- 이 마이그레이션은 데모 영상 녹화·시연용으로 vendors / vendor_products / vendor_timeslots 에
-- 안전한 샘플 한 세트를 추가합니다.
--
-- 안전장치:
--   1) ON CONFLICT (id) DO NOTHING — 같은 마이그레이션이 두 번 적용돼도 중복 INSERT 안 됨.
--   2) owner_id = NULL — 실제 업주 계정과 충돌 X.
--   3) status = 'approved' — 일반 조회에서 매칭됨.
--   4) 운영 후 제거하려면: DELETE FROM vendors WHERE id IN ('11111111-1111-1111-1111-111111111111');
--      (FK CASCADE 또는 products/timeslots 먼저 DELETE)
--
-- 데모 시 커뮤니티 사이드바의 "자주 언급된 업체"에서 'A 스튜디오'를 클릭하거나,
-- 직접 /community/vendor/A%20%EC%8A%A4%ED%8A%9C%EB%94%94%EC%98%A4 로 진입하면
-- BookingSection이 활성화돼서 catchtable 슬롯 그리드가 보입니다.

INSERT INTO vendors (
  id, owner_id, name, category, location, region, address,
  description, price_range, price_min, price_max,
  rating, review_count, tags,
  ai_recommend, status, thumbnail_url, created_at, updated_at
)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  NULL,
  'A 스튜디오',
  '스튜디오',
  '서울 강남',
  '서울',
  '서울 강남구 테헤란로 123',
  '미니멀 스타일 자연광 스튜디오. 추가금 발생률 낮은 투명 견적으로 알려져 있습니다.',
  '300~400만원대',
  3000000, 4500000,
  4.7, 128,
  ARRAY['미니멀','자연광','강남','투명견적'],
  TRUE, 'approved',
  NULL,
  NOW(), NOW()
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO vendor_products (
  id, vendor_id, name, description, price, discount_price, duration_minutes,
  is_active, is_popular, sort_order, category_fields, includes, images, created_at, updated_at
)
VALUES
  (
    '11111111-2222-2222-2222-111111111111',
    '11111111-1111-1111-1111-111111111111',
    '기본 미니멀 패키지',
    '본식 스냅 + 보정 30컷 + 원본 데이터 포함',
    3500000, NULL, 240,
    TRUE, TRUE, 1,
    '{}'::jsonb,
    ARRAY['본식 스냅 60컷', '보정본 30컷', '원본 데이터 전체']::text[],
    ARRAY[]::text[],
    NOW(), NOW()
  ),
  (
    '11111111-2222-2222-2222-222222222222',
    '11111111-1111-1111-1111-111111111111',
    '프리미엄 미니멀',
    '기본 + 추가 보정 + 야외 촬영',
    4200000, 3950000, 360,
    TRUE, FALSE, 2,
    '{}'::jsonb,
    ARRAY['본식 스냅 100컷', '보정본 60컷', '원본 데이터', '야외 1시간']::text[],
    ARRAY[]::text[],
    NOW(), NOW()
  )
ON CONFLICT (id) DO NOTHING;

-- vendor_timeslots 는 스키마 따라 채움. 현재는 7일 mockSlot UI가 deterministic하게 생성하므로
-- 비워둬도 페이지가 작동합니다. 실제 슬롯 매칭은 vendor_timeslots 연동 시 자동 활성화 예정.
