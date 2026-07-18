-- Charge batched analytics and other weighted operations atomically. The
-- existing three-argument RPC remains unchanged for rollback compatibility.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.check_rate_limit_cost(
  p_key TEXT,
  p_max_requests INTEGER,
  p_window_ms INTEGER,
  p_cost INTEGER
)
RETURNS TABLE(allowed BOOLEAN, retry_after_seconds INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_reset_at TIMESTAMPTZ;
  v_count INTEGER;
  v_window_seconds INTEGER := GREATEST(1, CEIL(p_window_ms / 1000.0)::INTEGER);
BEGIN
  IF p_key IS NULL
     OR p_key !~ '^[a-z][a-z0-9:_-]{0,127}:hmac-sha256:[0-9a-f]{64}$' THEN
    RETURN QUERY SELECT false, v_window_seconds;
    RETURN;
  END IF;

  IF p_max_requests IS NULL
     OR p_max_requests < 1
     OR p_max_requests > 1000000
     OR p_window_ms IS NULL
     OR p_window_ms < 1000
     OR p_window_ms > 604800000
     OR p_cost IS NULL
     OR p_cost < 1
     OR p_cost > 1000000 THEN
    RETURN QUERY SELECT false, v_window_seconds;
    RETURN;
  END IF;

  WITH expired AS (
    SELECT bucket.key
      FROM public.rate_limit_buckets AS bucket
     WHERE bucket.reset_at <= v_now
     ORDER BY bucket.reset_at, bucket.key
     LIMIT 128
     FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.rate_limit_buckets AS bucket
   USING expired
   WHERE bucket.key = expired.key;

  INSERT INTO public.rate_limit_buckets(key, count, reset_at, updated_at)
  VALUES (p_key, 0, v_now + make_interval(secs => v_window_seconds), v_now)
  ON CONFLICT (key) DO NOTHING;

  SELECT count, reset_at
    INTO v_count, v_reset_at
    FROM public.rate_limit_buckets
   WHERE key = p_key
   FOR UPDATE;

  IF v_reset_at <= v_now THEN
    IF p_cost > p_max_requests THEN
      UPDATE public.rate_limit_buckets
         SET count = 0,
             reset_at = v_now + make_interval(secs => v_window_seconds),
             updated_at = v_now
       WHERE key = p_key;
      RETURN QUERY SELECT false, v_window_seconds;
      RETURN;
    END IF;

    UPDATE public.rate_limit_buckets
       SET count = p_cost,
           reset_at = v_now + make_interval(secs => v_window_seconds),
           updated_at = v_now
     WHERE key = p_key;
    RETURN QUERY SELECT true, 0;
    RETURN;
  END IF;

  IF p_cost > p_max_requests OR v_count > p_max_requests - p_cost THEN
    RETURN QUERY SELECT
      false,
      GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_reset_at - v_now)))::INTEGER);
    RETURN;
  END IF;

  UPDATE public.rate_limit_buckets
     SET count = count + p_cost,
         updated_at = v_now
   WHERE key = p_key;

  RETURN QUERY SELECT true, 0;
END;
$$;

ALTER FUNCTION public.check_rate_limit_cost(TEXT, INTEGER, INTEGER, INTEGER)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.check_rate_limit_cost(TEXT, INTEGER, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit_cost(TEXT, INTEGER, INTEGER, INTEGER)
  TO service_role;
