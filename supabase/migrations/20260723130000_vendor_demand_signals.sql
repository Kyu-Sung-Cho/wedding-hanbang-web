-- 업체 수요 신호 집계 (2026-07-23)
-- 목적: 소비자가 공시가 탐색에서 업체를 조회·클릭·찜·조합에 담는 행동을
-- 업체×일(KST)×지표 카운터로 1st-party 축적 — 이후 업체 제휴 대화에서
-- "지난 30일 조회 N회" 같은 근거 데이터로 사용. 개인 식별 정보는 저장하지 않는다.
BEGIN;

CREATE TABLE IF NOT EXISTS public.vendor_demand_daily (
  day date NOT NULL,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  metric text NOT NULL CHECK (metric IN (
    'impression',      -- 목록 카드가 1초 이상 화면에 노출
    'detail_click',    -- 목록에서 상세 보기 클릭
    'detail_view',     -- 업체 상세 페이지 열람
    'wishlist_add',    -- 찜 추가
    'combo_add'        -- 스드메 조합에 담기
  )),
  count bigint NOT NULL DEFAULT 0 CHECK (count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, vendor_id, metric)
);

CREATE INDEX IF NOT EXISTS vendor_demand_daily_vendor_idx
  ON public.vendor_demand_daily (vendor_id, day DESC);

ALTER TABLE public.vendor_demand_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vendor_demand_daily FROM PUBLIC, anon, authenticated;

-- 배치 기록 RPC: 이벤트 [{vendor_id, metric}] ≤ 50건을 KST 오늘 날짜로 증가.
-- 존재하지 않는 vendor_id·허용 외 지표는 조용히 버린다(공개 비컨 특성상 fail-open 집계).
CREATE OR REPLACE FUNCTION public.record_vendor_demand(p_events jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $record_vendor_demand$
DECLARE
  kst_day date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  applied integer := 0;
BEGIN
  IF p_events IS NULL OR jsonb_typeof(p_events) <> 'array'
     OR jsonb_array_length(p_events) < 1 OR jsonb_array_length(p_events) > 50 THEN
    RAISE EXCEPTION 'VENDOR_DEMAND_BATCH_INVALID' USING ERRCODE = '22023';
  END IF;

  WITH incoming AS (
    SELECT
      (event ->> 'vendor_id')::uuid AS vendor_id,
      event ->> 'metric' AS metric,
      count(*)::bigint AS n
    FROM jsonb_array_elements(p_events) AS event
    WHERE (event ->> 'vendor_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND (event ->> 'metric') IN ('impression','detail_click','detail_view','wishlist_add','combo_add')
    GROUP BY 1, 2
  ), valid AS (
    SELECT incoming.* FROM incoming
    JOIN public.vendors v ON v.id = incoming.vendor_id
  ), upserted AS (
    INSERT INTO public.vendor_demand_daily AS d (day, vendor_id, metric, count)
    SELECT kst_day, vendor_id, metric, n FROM valid
    ON CONFLICT (day, vendor_id, metric)
    DO UPDATE SET count = d.count + excluded.count, updated_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO applied FROM upserted;
  RETURN applied;
END;
$record_vendor_demand$;

ALTER FUNCTION public.record_vendor_demand(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_vendor_demand(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_vendor_demand(jsonb) TO service_role;

COMMIT;
