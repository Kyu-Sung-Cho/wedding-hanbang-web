-- 동기방 계약 익명성: 경계를 API에서 데이터 계층(RLS)으로 이동.
-- 기존 구멍: cohort_contracts SELECT 정책이 "방 멤버면 전체 행"이라
-- 브라우저의 anon key + 세션으로 PostgREST를 직접 호출하면 타인의
-- vendor_name·금액·notes·user_id를 통째로 읽을 수 있었다.
-- cohort_stats 뷰도 security_invoker 없이 생성되어 RLS를 우회했고
-- 5건 미만 표본의 평균까지 노출됐다.
--
-- 적용 후: 본인 행 외 원본은 서버(service role) 경로로만 흐르고,
-- 집계는 뷰 정의 자체에서 5건 미만을 NULL 처리한다.
-- (API는 이미 service role로 전환됨 — 적용 순서 무관하게 안전)

-- 1) 원본 행 SELECT을 본인 것으로 한정
DROP POLICY IF EXISTS "cohort_contracts_select" ON cohort_contracts;
DROP POLICY IF EXISTS "cohort_contracts_select_own" ON cohort_contracts;
CREATE POLICY "cohort_contracts_select_own" ON cohort_contracts
  FOR SELECT USING (auth.uid() = user_id);

-- 2) 집계 뷰: 호출자 RLS 적용(security_invoker) + 5건 게이트를 DB에 강제
CREATE OR REPLACE VIEW cohort_stats WITH (security_invoker = on) AS
SELECT
  room_id,
  category,
  COUNT(*) AS sample_size,
  CASE WHEN COUNT(*) >= 5 THEN ROUND(AVG(base_price))::INT END AS avg_base_price,
  CASE WHEN COUNT(*) >= 5 THEN ROUND(AVG(extra_price))::INT END AS avg_extra_price,
  CASE WHEN COUNT(*) >= 5 THEN ROUND(AVG(base_price + COALESCE(extra_price, 0)))::INT END AS avg_total
FROM cohort_contracts
GROUP BY room_id, category;

COMMENT ON VIEW cohort_stats IS
'동기방 계약 집계. security_invoker로 호출자 RLS 적용 — 일반 유저 경로는 본인 행만 집계되므로 방 전체 통계는 서버(service role) 경로 전용. 5건 미만 셀은 평균 NULL.';
