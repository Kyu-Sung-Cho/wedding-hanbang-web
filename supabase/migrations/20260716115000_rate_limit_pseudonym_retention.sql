BEGIN;

-- Remove expired legacy rate-limit identifiers and make expiry cleanup
-- deterministic and bounded. New application code stores HMAC-pseudonymous
-- subjects; active rolling-deploy buckets remain valid until their window
-- expires, then the next RPC call removes them.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $bounded_expired_bucket_purge$
DECLARE
  v_expired_count BIGINT;
  v_cutoff TIMESTAMPTZ := clock_timestamp();
BEGIN
  SELECT count(*)
    INTO v_expired_count
    FROM public.rate_limit_buckets
   WHERE reset_at <= v_cutoff;

  IF v_expired_count > 1000 THEN
    RAISE EXCEPTION
      'rate-limit retention purge refused: % expired rows exceeds the reviewed bound',
      v_expired_count;
  END IF;

  DELETE FROM public.rate_limit_buckets
   WHERE reset_at <= v_cutoff;
END;
$bounded_expired_bucket_purge$;

CREATE INDEX IF NOT EXISTS rate_limit_buckets_reset_at_idx
  ON public.rate_limit_buckets (reset_at);

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_key TEXT,
  p_max_requests INTEGER,
  p_window_ms INTEGER
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
  -- Production callers emit only the current keyed pseudonym contract. Keep
  -- the algorithm label in the stored key as an explicit rotation/version
  -- boundary and reject raw, unkeyed, uppercase, truncated, or oversized keys
  -- before any bucket row can be created.
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
     OR p_window_ms > 604800000 THEN
    RETURN QUERY SELECT false, v_window_seconds;
    RETURN;
  END IF;

  -- Expired buckets no longer enforce a window and may contain keys emitted by
  -- a pre-pseudonymization deployment. Bound each call to avoid cleanup spikes.
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

ALTER FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;

COMMIT;
