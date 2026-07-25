-- 위약금·환불 규정 공개 뷰.
--
-- 공시 원본에는 업체별 위약금·환불·계약 조건이 들어 있고 적재도 끝나 있었다
-- (disclosure_semantic_staging: vendor_policy 895행). 그런데 공개 경로가 없어
-- 소비자 화면에는 추가금만 보이고 위약금은 보이지 않았다. 계약 직전에 가장 알고
-- 싶은 정보인데 갖고 있으면서 안 보여준 셈이다.
--
-- 무엇을 "검수된 것"으로 볼 것인가:
--   시맨틱 행에는 자체 review_status가 있지만 이 테이블은 원자 적재 RPC만 쓸 수
--   있게 잠겨 있고(guard_vendor_disclosure_atomic_protected_write), 그 값을 사후에
--   승인해 주는 정식 경로가 없다. 대신 모든 정책 행은 official_price_id로 가격
--   행에 묶여 들어온다 — 그 가격 행은 사람이 검수(approved·needs_review=false)
--   하고 발행한 바로 그 행이다(2026-07-26 실측: 895/895가 승인·발행된 가격 행에
--   연결, 업체 불일치 0건). 그래서 "사람이 승인해 발행한 가격 행에 딸려 온
--   원문"만 공개한다. 이 조건이 곧 검수 증거다.
--
-- 안전 원칙은 가격 뷰와 같다.
--   · 발행 스냅샷 + 승인된 가격 행 + 승인된 업체만 노출한다.
--   · 원문(content_verbatim)만 내보내고 요약·해석은 판정이 되므로 쓰지 않는다.
--   · security_barrier + security_invoker=false, anon은 SELECT만.
--
-- 되돌리기: DROP VIEW public.v_public_vendor_policies;

DROP VIEW IF EXISTS public.v_public_vendor_policies;

CREATE VIEW public.v_public_vendor_policies
WITH (security_barrier = true, security_invoker = false)
AS
-- 공개에 필요한 것만 고른다. snapshot_id·record_kind·confidence 같은 내부 열은
-- 내보내지 않는다. 특히 confidence는 추출 신뢰도인데 밖에서는 "90% 맞다"로
-- 읽히기 쉬워, 우리가 금지한 판정처럼 쓰이게 된다.
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
  snapshot.published_at
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
  -- 업체에 붙는 위약금·환불만 공개한다. document_section은 대행사 문서 전체에
  -- 걸린 항목이라 어느 업체의 규정인지 확정할 수 없다 — 원본 대조에서도 824건
  -- 전부 업체 매칭이 되지 않았다(2026-07-26). 잘못된 업체에 붙으면 계약 판단을
  -- 그르치므로 이번 공개 범위에서 뺀다.
  AND semantic.record_kind = 'vendor_policy'
  AND NULLIF(btrim(semantic.content_verbatim), '') IS NOT NULL
  AND semantic.partner_vendor_id IS NOT NULL
  -- 추출 신뢰도가 낮은 행은 내보내지 않는다(2026-07-26 기준 64행 제외).
  AND semantic.confidence IS NOT NULL
  AND semantic.confidence >= 0.9
  -- 원문·출처가 실제로 남아 있는 행만 — 가격 뷰와 같은 증빙 기준.
  AND NULLIF(btrim(semantic.source_quote), '') IS NOT NULL
  AND cardinality(semantic.source_file_ids) > 0;

ALTER VIEW public.v_public_vendor_policies OWNER TO postgres;

REVOKE ALL ON TABLE public.v_public_vendor_policies
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE public.v_public_vendor_policies
TO anon, authenticated, service_role;

COMMENT ON VIEW public.v_public_vendor_policies IS
  '발행·승인된 가격 행에 딸려 온 위약금·환불·계약 조건 원문. 요약·해석은 제외한다.';
