-- 아모라 비용 가드 원자화 (감사 2.3 H1 — costGuard TOCTOU 레이스 해소).
--
-- 기존: costGuard가 ai_interactions_log의 chat_turn 카운트를 SELECT로 읽고,
-- 현재 턴은 fire-and-forget으로 나중에 기록 → 동시 요청이 커플/전역 상한을 초과.
--
-- 해소: 전용 카운터 테이블 + FOR UPDATE 잠금 RPC로 "체크+예약"을 한 트랜잭션에서 수행.
--  - 키: 'couple:<uuid>' (누적) / 'global:<KST날짜>' (일일)
--  - 첫 접근 시 ai_interactions_log에서 자동 시드 → 기존 커플 사용량이 리셋되지 않음
--  - 거부된 요청은 카운터를 소모하지 않음 (체크 후 증가)
--  - 잠금 순서는 항상 global → couple 고정 (데드락 방지)
--  - 서버 코드는 RPC 부재/실패 시 기존 읽기전용 가드로 폴백 (무중단 배포)
--
-- 테이블 크기: 커플당 1행 + 하루 1행(global) — GC 불필요.

CREATE TABLE IF NOT EXISTS public.amora_turn_counters (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.amora_turn_counters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS amora_turn_counters_service_role_all ON public.amora_turn_counters;
CREATE POLICY amora_turn_counters_service_role_all
  ON public.amora_turn_counters
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON public.amora_turn_counters FROM anon, authenticated;
GRANT ALL ON public.amora_turn_counters TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_amora_turn(
  p_couple_id UUID,
  p_couple_cap INTEGER,
  p_global_cap INTEGER
)
RETURNS TABLE(allowed BOOLEAN, reason TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kst_day_start TIMESTAMPTZ :=
    date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul';
  v_global_key TEXT := 'global:' || to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD');
  v_couple_key TEXT;
  v_global_count INTEGER;
  v_couple_count INTEGER;
BEGIN
  IF p_couple_id IS NULL OR p_couple_cap IS NULL OR p_global_cap IS NULL THEN
    -- 서버 코드가 항상 값을 넘기므로 정상 경로에서 도달 불가. 알 수 없는 reason은
    -- 서버 쪽에서 fail-open 처리된다 (가드 오류가 정상 사용을 막으면 안 됨).
    RETURN QUERY SELECT false, 'invalid_args'::TEXT;
    RETURN;
  END IF;

  v_couple_key := 'couple:' || p_couple_id::TEXT;

  -- 첫 접근 시드: 기존 장부(ai_interactions_log)에서 현재 카운트를 가져온다.
  -- 동시 첫 접근은 ON CONFLICT DO NOTHING으로 한쪽만 반영 → 이후 FOR UPDATE로 직렬화.
  INSERT INTO public.amora_turn_counters (key, count)
  VALUES (
    v_global_key,
    (SELECT count(*)::INTEGER FROM public.ai_interactions_log
      WHERE interaction_type = 'chat_turn' AND created_at >= v_kst_day_start)
  )
  ON CONFLICT (key) DO NOTHING;

  INSERT INTO public.amora_turn_counters (key, count)
  VALUES (
    v_couple_key,
    (SELECT count(*)::INTEGER FROM public.ai_interactions_log
      WHERE interaction_type = 'chat_turn' AND couple_id = p_couple_id)
  )
  ON CONFLICT (key) DO NOTHING;

  -- 잠금 순서 고정: global → couple
  SELECT count INTO v_global_count
    FROM public.amora_turn_counters WHERE key = v_global_key FOR UPDATE;
  IF v_global_count >= p_global_cap THEN
    RETURN QUERY SELECT false, 'global_daily'::TEXT;
    RETURN;
  END IF;

  SELECT count INTO v_couple_count
    FROM public.amora_turn_counters WHERE key = v_couple_key FOR UPDATE;
  IF v_couple_count >= p_couple_cap THEN
    RETURN QUERY SELECT false, 'couple_quota'::TEXT;
    RETURN;
  END IF;

  UPDATE public.amora_turn_counters
    SET count = count + 1, updated_at = NOW()
    WHERE key IN (v_global_key, v_couple_key);

  RETURN QUERY SELECT true, NULL::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_amora_turn(UUID, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_amora_turn(UUID, INTEGER, INTEGER) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_amora_turn(UUID, INTEGER, INTEGER) TO service_role;
