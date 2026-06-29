-- Shared rate limit buckets for serverless API routes.
-- Server code calls check_rate_limit with service_role; anon/authenticated roles
-- do not get direct table access.

CREATE TABLE IF NOT EXISTS public.rate_limit_buckets (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  reset_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rate_limit_buckets_service_role_all ON public.rate_limit_buckets;
CREATE POLICY rate_limit_buckets_service_role_all
  ON public.rate_limit_buckets
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON public.rate_limit_buckets FROM anon, authenticated;
GRANT ALL ON public.rate_limit_buckets TO service_role;

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

REVOKE ALL ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;
