-- 예식장 위약금이 공개 경로에 도달하게 한다.
--
-- 증상(2026-09-02 라이브 실측): `/price/vendor/venue-ingest-*` 189곳 전부에서
-- 위약금·환불 카드가 0장이고 "위약금"이라는 단어조차 0회 나온다. 표본 5곳
-- ((주)라비돌 · (주)플로팅아일랜드 · 계룡 스파텔 · 규수당 운정점 · 그래머시코엑스)
-- 모두 같다. 스튜디오는 데이터가 있는 곳에서 카드가 나온다.
--
-- 원인은 데이터 부재가 아니라 적재 모양의 차이다.
--   · 스드메 공시는 대행사 문서 하나에 제휴 업체 행이 여러 개 들어 있어서
--     위약금이 `partner_vendors[].policies[]`로 업체 행에 붙는다
--     (scripts/ingest/schemas.ts `VendorPolicySchema`). → `record_kind='vendor_policy'`,
--     `partner_vendor_id`·`official_price_id`가 채워진다.
--   · 예식장 공시는 문서 하나가 곧 그 예식장이다. `HallDisclosureSchema`에는
--     policies 필드가 아예 없고, 추출 지시(prompt.ts 규칙 23)도 "공통 위약금·환불은
--     sections에 둔다"고 못박는다. → `record_kind='document_section'`이 되고,
--     테이블 CHECK(`disclosure_semantic_subject_contract`)가 그 종류에는
--     `partner_vendor_id IS NULL`·`official_price_id IS NULL`을 강제한다.
--
-- 그래서 `v_public_vendor_policies`의 세 조건(`record_kind='vendor_policy'`,
-- `partner_vendor_id IS NOT NULL`, `official_prices` inner join)에 예식장 행은
-- 구조적으로 하나도 걸리지 않았다. 특정 예식장의 데이터가 빠진 게 아니라
-- **모든 예식장이 어떤 데이터를 갖고 있어도 통과할 수 없는** 상태였다.
--
-- 2026-07-26 뷰가 document_section을 뺀 이유는 유효했다: 대행사 문서의 섹션은
-- 문서 전체에 걸려 있어 어느 제휴 업체의 규정인지 확정할 수 없었다(824건 전부
-- 업체 매칭 실패). 그 판단이 예식장까지 함께 덮은 것이 이 결함이다 —
-- 예식장 문서의 섹션은 주체가 애매하지 않다. 문서가 그 예식장이다.
--
-- 그 "애매하지 않음"을 이름 대조로 증명하지 않는다. 적재 쪽 정규화
-- (`normalizeVendorName`: `(주)` 접두어 제거)와 DB 쪽 정규화
-- (`normalize_price_vendor_name`: 구두점 전체 제거)는 결과가 다르다 —
-- `(주)라비돌`은 각각 `라비돌`·`주라비돌`이 된다. 대신 **같은 원본 파일**을
-- 근거로 쓴다: 섹션과 가격 행은 같은 문서에서 나왔으므로 `source_object_keys`가
-- 겹친다. 겹치는 가격 행이 전부 같은 업체의 예식장 행일 때만 공개한다.
-- 한 파일에 두 업체가 섞여 있으면 아무것도 공개하지 않는다(닫히는 방향).
--
-- 증거 기준은 branch A와 글자 그대로 같게 유지한다: 발행된 스냅샷 · 사람이
-- 승인하고 재검토 표시가 없는 가격 행 · 승인된 업체 · confidence ≥ 0.9 ·
-- source_quote와 source_file_ids 존재. 낮은 신뢰도 행을 예식장이라는 이유로
-- 통과시키지 않는다. 그 결과 공개할 것이 없는 예식장은 계속 0장이지만,
-- 화면은 이제 빈 자리가 아니라 "이 경로 공시에는 위약금·환불 원문이 없다"를
-- 명시한다(apps/web PriceVendorPolicySection).
--
-- 새 열 `policy_scope`: 'vendor'는 업체 행에 붙은 규정, 'hall_document'는
-- 예식장 공시 문서의 공통 규정이다. 화면이 출처를 사실대로 말하기 위한 값이며
-- 품질 등급이 아니다.
--
-- 되돌리기: 이 파일 아래 ROLLBACK 주석의 SQL을 실행하면
-- 20260726090000 시점의 뷰 정의로 돌아간다.

-- 섹션 ↔ 가격 행을 원본 객체로 잇는다. 배열 겹침(&&)은 GIN 없이는 매 조회마다
-- 전수 비교가 되므로 인덱스를 함께 만든다.
CREATE INDEX IF NOT EXISTS official_prices_source_object_keys_gin
  ON public.official_prices USING gin (source_object_keys);

CREATE INDEX IF NOT EXISTS disclosure_semantic_staging_source_object_keys_gin
  ON public.disclosure_semantic_staging USING gin (source_object_keys);

DROP VIEW IF EXISTS public.v_public_vendor_policies;

CREATE VIEW public.v_public_vendor_policies
WITH (security_barrier = true, security_invoker = false)
AS
-- Branch A — 업체 행에 붙은 위약금·환불(스드메). 20260726090000과 동일하며
-- policy_scope 열만 추가된다.
SELECT
  semantic.id,
  snapshot.period_label,
  semantic.semantic_type,
  semantic.vendor_category,
  semantic.partner_vendor_id AS vendor_id,
  vendor.slug                AS vendor_slug,
  vendor.name                AS vendor_name,
  -- source_agency는 JSONB이고 안에 내부 원본 파일 경로(source_file)가 들어 있다.
  -- 공개 표면에는 대행사 이름만 내보낸다.
  NULLIF(btrim(semantic.source_agency ->> 'name'), '') AS source_agency,
  semantic.title,
  -- 원문 그대로만 내보낸다. 요약을 노출하면 우리가 해석한 값이 계약 판단에
  -- 쓰이게 되고, 그건 이 제품이 금지한 "판정"이다.
  semantic.content_verbatim,
  snapshot.published_at,
  'vendor'::text AS policy_scope
FROM public.disclosure_semantic_staging AS semantic
JOIN public.official_prices AS price
  ON price.id = semantic.official_price_id
JOIN public.price_snapshots AS snapshot
  ON snapshot.id = price.snapshot_id
JOIN public.vendors AS vendor
  ON vendor.id = semantic.partner_vendor_id
-- 발행 게이트와 업체 게이트는 v_public_official_prices와 글자 그대로 같게 맞춘다.
-- 가격은 안 보이는데 그 업체 위약금만 보이는 상태가 생기면 안 된다.
WHERE snapshot.published IS TRUE
  AND price.review_status = 'approved'
  AND price.needs_review = false
  -- 정책이 엉뚱한 업체에 붙는 사고를 막는다: 딸려 온 가격 행과 업체가 같아야 한다.
  AND price.vendor_id = semantic.partner_vendor_id
  AND vendor.status = 'approved'
  AND NULLIF(btrim(vendor.slug), '') IS NOT NULL
  AND vendor.slug ~ '^[a-z0-9][a-z0-9-]{0,119}$'
  AND semantic.record_kind = 'vendor_policy'
  AND NULLIF(btrim(semantic.content_verbatim), '') IS NOT NULL
  AND semantic.partner_vendor_id IS NOT NULL
  -- 추출 신뢰도가 낮은 행은 내보내지 않는다.
  AND semantic.confidence IS NOT NULL
  AND semantic.confidence >= 0.9
  -- 원문·출처가 실제로 남아 있는 행만 — 가격 뷰와 같은 증빙 기준.
  AND NULLIF(btrim(semantic.source_quote), '') IS NOT NULL
  AND cardinality(semantic.source_file_ids) > 0

UNION ALL

-- Branch B — 예식장 공시 문서의 공통 위약금·환불.
--
-- 같은 섹션에 승인된 가격 행이 여러 개 겹칠 수 있으므로(홀·식대·대관료가 각각
-- 한 행) DISTINCT로 섹션당 한 장만 남긴다. 아래 NOT EXISTS가 업체를 하나로
-- 확정하므로 DISTINCT 결과는 섹션당 정확히 한 행이다.
SELECT DISTINCT
  semantic.id,
  snapshot.period_label,
  semantic.semantic_type,
  -- document_section 행의 vendor_category는 CHECK상 항상 NULL이다. 소비자
  -- 카테고리는 겹친 가격 행에서 확정했으므로 그 값을 채워 내보낸다.
  'hall'::text AS vendor_category,
  price.vendor_id,
  vendor.slug AS vendor_slug,
  vendor.name AS vendor_name,
  -- 예식장은 자기 문서로 공시한다. 중간 대행사가 없으므로 이 자리는 비어 있는
  -- 것이 사실이다(document_section 행은 CHECK상 source_agency IS NULL).
  NULL::text AS source_agency,
  semantic.title,
  semantic.content_verbatim,
  snapshot.published_at,
  'hall_document'::text AS policy_scope
FROM public.official_prices AS price
JOIN public.disclosure_semantic_staging AS semantic
  ON semantic.snapshot_id = price.snapshot_id
 AND semantic.source_object_keys && price.source_object_keys
JOIN public.price_snapshots AS snapshot
  ON snapshot.id = semantic.snapshot_id
JOIN public.vendors AS vendor
  ON vendor.id = price.vendor_id
WHERE snapshot.published IS TRUE
  -- 사람이 승인해 발행한 가격 행에 딸려 온 원문만 공개한다(branch A와 같은 기준).
  AND price.review_status = 'approved'
  AND price.needs_review = false
  AND price.category = 'hall'
  AND price.vendor_id IS NOT NULL
  AND vendor.status = 'approved'
  -- vendors는 예식장을 'venue'로 저장한다(vendorDatabaseCategory).
  AND vendor.category = 'venue'
  AND NULLIF(btrim(vendor.slug), '') IS NOT NULL
  AND vendor.slug ~ '^[a-z0-9][a-z0-9-]{0,119}$'
  AND semantic.record_kind = 'document_section'
  -- kind_hint가 'hall'인 단위만 subject_kind='vendor'가 된다. 대행사 문서의
  -- 섹션은 'agency'이므로 여기 들어오지 않는다(load.ts).
  AND semantic.subject_kind = 'vendor'
  AND semantic.semantic_type IN ('penalty', 'refund_policy')
  AND NULLIF(btrim(semantic.content_verbatim), '') IS NOT NULL
  AND semantic.confidence IS NOT NULL
  AND semantic.confidence >= 0.9
  AND NULLIF(btrim(semantic.source_quote), '') IS NOT NULL
  AND cardinality(semantic.source_file_ids) > 0
  -- 귀속을 확정한다. 이 섹션의 원본 객체를 공유하는 가격 행이 전부 같은 업체의
  -- 예식장 행이어야 한다. 한 파일에 두 업체가 섞여 있거나 스드메 행이 함께
  -- 들어 있으면 이 섹션은 공개하지 않는다 — 틀린 업체에 붙는 위약금은
  -- 안 보이는 위약금보다 나쁘다.
  AND NOT EXISTS (
    SELECT 1
    FROM public.official_prices AS sibling
    WHERE sibling.snapshot_id = semantic.snapshot_id
      AND sibling.source_object_keys && semantic.source_object_keys
      AND (
        sibling.category <> 'hall'
        OR sibling.vendor_id IS NULL
        OR sibling.vendor_id <> price.vendor_id
      )
  );

ALTER VIEW public.v_public_vendor_policies OWNER TO postgres;

REVOKE ALL ON TABLE public.v_public_vendor_policies
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE public.v_public_vendor_policies
TO anon, authenticated, service_role;

COMMENT ON VIEW public.v_public_vendor_policies IS
  '발행·승인된 가격 행에 딸려 온 위약금·환불·계약 조건 원문. policy_scope=vendor는 업체 행에 붙은 규정, hall_document는 예식장 공시 문서의 공통 규정. 요약·해석은 제외한다.';

-- ROLLBACK (수동):
--   DROP VIEW IF EXISTS public.v_public_vendor_policies;
--   그리고 supabase/migrations/20260726090000_public_vendor_policies.sql의
--   CREATE VIEW ~ COMMENT ON VIEW 구간을 그대로 다시 실행한다.
--   인덱스는 남겨도 무해하다(읽기 경로만 빠르게 한다):
--   DROP INDEX IF EXISTS public.official_prices_source_object_keys_gin;
--   DROP INDEX IF EXISTS public.disclosure_semantic_staging_source_object_keys_gin;
