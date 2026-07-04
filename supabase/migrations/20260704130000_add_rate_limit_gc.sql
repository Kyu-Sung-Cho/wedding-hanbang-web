-- rate_limit_buckets 만료 행 GC (감사 2.2 M2 파생 — 테이블 무한 증식 방지).
-- 기존 check_rate_limit(20260615103000)에는 DELETE 경로가 없어 익명 키가
-- 영구 행으로 쌓였다. 호출의 ~2%에서 하루 이상 지난 만료 행을 기회적으로
-- 정리한다 (pg_cron 불필요, 트래픽이 곧 청소부).
-- 함수 본문 외 나머지(테이블/권한/정책)는 20260615103000 그대로 유지.

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_key TEXT,
  p_max_requests INTEGER,
  p_window_ms INTEGER
)
RETURNS TABLE(allowed BOOLEAN, retry_after_seconds INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_reset_at TIMESTAMPTZ;
  v_count INTEGER;
  v_window_seconds INTEGER := GREATEST(1, CEIL(p_window_ms / 1000.0)::INTEGER);
BEGIN
  IF p_key IS NULL OR length(trim(p_key)) = 0 THEN
    RETURN QUERY SELECT false, v_window_seconds;
    RETURN;
  END IF;

  IF p_max_requests < 1 OR p_window_ms < 1000 THEN
    RETURN QUERY SELECT false, v_window_seconds;
    RETURN;
  END IF;

  -- 기회적 GC: 만료 후 하루 지난 버킷 삭제 (호출의 ~2%)
  IF random() < 0.02 THEN
    DELETE FROM public.rate_limit_buckets
      WHERE reset_at < v_now - INTERVAL '1 day';
  END IF;

  INSERT INTO public.rate_limit_buckets(key, count, reset_at, updated_at)
  VALUES (p_key, 0, v_now + make_interval(secs => v_window_seconds), v_now)
  ON CONFLICT (key) DO NOTHING;

  SELECT count, reset_at
    INTO v_count, v_reset_at
    FROM public.rate_limit_buckets
    WHERE key = p_key
    FOR UPDATE;

  IF v_reset_at <= v_now THEN
    UPDATE public.rate_limit_buckets
      SET count = 1,
          reset_at = v_now + make_interval(secs => v_window_seconds),
          updated_at = v_now
      WHERE key = p_key;
    RETURN QUERY SELECT true, 0;
    RETURN;
  END IF;

  IF v_count >= p_max_requests THEN
    RETURN QUERY SELECT
      false,
      GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_reset_at - v_now)))::INTEGER);
    RETURN;
  END IF;

  UPDATE public.rate_limit_buckets
    SET count = count + 1,
        updated_at = v_now
    WHERE key = p_key;

  RETURN QUERY SELECT true, 0;
END;
$$;
