-- vendors.category CHECK 제약 확장
--
-- 기존 CHECK: studio · dress · makeup · package · snap · dvd · hanbok · suit · jewelry · invitation
-- 한국 스드메 분류만 들어가 있어서 예식장·신혼여행·기타는 INSERT 자체가 거부됨.
--
-- 데모 seed (20260514000000~020000) 가 예식장·신혼여행 카테고리를 추가하려고 하므로,
-- 그 전에 enum을 확장한다. 멱등 — DROP IF EXISTS 후 재정의.
--
-- 기존 행 영향 없음: 30개 vendor가 모두 'dress'로 저장되어 있고, 새 CHECK 에도 'dress' 포함.

ALTER TABLE vendors DROP CONSTRAINT IF EXISTS vendors_category_check;

ALTER TABLE vendors ADD CONSTRAINT vendors_category_check
  CHECK (category = ANY (ARRAY[
    'studio'::text,
    'dress'::text,
    'makeup'::text,
    'package'::text,
    'snap'::text,
    'dvd'::text,
    'hanbok'::text,
    'suit'::text,
    'jewelry'::text,
    'invitation'::text,
    -- 신규 추가
    'venue'::text,
    'honeymoon'::text,
    'other'::text
  ]));
