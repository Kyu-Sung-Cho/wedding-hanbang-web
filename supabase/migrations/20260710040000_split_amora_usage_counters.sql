-- Separate user-visible consultation quota from actual provider calls.
-- Hidden Luna jobs and Terra tool rounds consume the global spend breaker but do
-- not silently consume a couple's advertised free consultation count.

CREATE OR REPLACE FUNCTION public.reserve_amora_usage(
  p_couple_id uuid,
  p_couple_cap integer,
  p_global_provider_cap integer,
  p_count_user_turn boolean
)
RETURNS TABLE(allowed boolean, reason text, remaining integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kst_day_start timestamptz :=
    date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul';
  v_global_key text :=
    'global:provider_calls:' || to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD');
  v_couple_key text := 'couple:user_turns:' || p_couple_id::text;
  v_global_count integer;
  v_couple_count integer;
BEGIN
  IF p_couple_id IS NULL
    OR p_couple_cap IS NULL OR p_couple_cap < 1
    OR p_global_provider_cap IS NULL OR p_global_provider_cap < 1
    OR p_count_user_turn IS NULL
  THEN
    RETURN QUERY SELECT false, 'invalid_args'::text, NULL::integer;
    RETURN;
  END IF;

  -- Historical seed is conservative but cannot reconstruct multiple provider
  -- rounds aggregated into one old audit row. Every call after this migration is exact.
  INSERT INTO public.amora_turn_counters (key, count)
  VALUES (
    v_global_key,
    (SELECT COALESCE(sum(
       CASE
         WHEN jsonb_typeof(metadata->'request_usage') = 'array'
           THEN GREATEST(jsonb_array_length(metadata->'request_usage'), 1)
         ELSE 1
       END
     ), 0)::integer
     FROM public.ai_interactions_log
     WHERE created_at >= v_kst_day_start AND model IS NOT NULL)
  )
  ON CONFLICT (key) DO NOTHING;

  SELECT count INTO v_global_count
  FROM public.amora_turn_counters
  WHERE key = v_global_key
  FOR UPDATE;

  IF v_global_count >= p_global_provider_cap THEN
    RETURN QUERY SELECT false, 'global_daily'::text, NULL::integer;
    RETURN;
  END IF;

  IF p_count_user_turn THEN
    INSERT INTO public.amora_turn_counters (key, count)
    VALUES (
      v_couple_key,
      GREATEST(
        (SELECT count(*)::integer
         FROM public.ai_interactions_log
         WHERE interaction_type = 'chat_turn'
           AND couple_id = p_couple_id
           AND (
             metadata->>'quota_class' = 'user_turn'
             OR (
               metadata->>'quota_class' IS NULL
               AND metadata->>'endpoint' IS NULL
               AND metadata->>'source' IS NULL
             )
           )),
        COALESCE((
          SELECT count FROM public.amora_turn_counters
          WHERE key = 'couple:' || p_couple_id::text
        ), 0)
      )
    )
    ON CONFLICT (key) DO NOTHING;

    SELECT count INTO v_couple_count
    FROM public.amora_turn_counters
    WHERE key = v_couple_key
    FOR UPDATE;

    IF v_couple_count >= p_couple_cap THEN
      RETURN QUERY SELECT false, 'couple_quota'::text, 0;
      RETURN;
    END IF;
  END IF;

  UPDATE public.amora_turn_counters
  SET count = count + 1, updated_at = now()
  WHERE key = v_global_key;

  IF p_count_user_turn THEN
    UPDATE public.amora_turn_counters
    SET count = count + 1, updated_at = now()
    WHERE key = v_couple_key
    RETURNING count INTO v_couple_count;
    RETURN QUERY SELECT true, NULL::text, GREATEST(p_couple_cap - v_couple_count, 0);
  ELSE
    RETURN QUERY SELECT true, NULL::text, NULL::integer;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_amora_usage(uuid, integer, integer, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_amora_usage(uuid, integer, integer, boolean) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_amora_usage(uuid, integer, integer, boolean) TO service_role;

COMMENT ON FUNCTION public.reserve_amora_usage(uuid, integer, integer, boolean) IS
  'Atomically reserves one provider call and optionally one user-visible Amora consultation.';

-- Backfill an explicit row even when the exact visible-turn count is zero.
-- Without that zero tombstone, the lazy fallback would inherit the legacy
-- counter that also included hidden detector/helper calls and could block a
-- couple before their first real consultation.
WITH candidate_couples AS (
  SELECT id::text AS couple_id_text FROM public.couples
  UNION
  SELECT DISTINCT couple_id::text
  FROM public.ai_interactions_log
  WHERE couple_id IS NOT NULL
  UNION
  SELECT substring(key FROM 8) AS couple_id_text
  FROM public.amora_turn_counters
  WHERE key ~ '^couple:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
), exact_user_turns AS (
  SELECT couple_id::text AS couple_id_text, count(*)::integer AS turn_count
  FROM public.ai_interactions_log
  WHERE interaction_type = 'chat_turn'
    AND couple_id IS NOT NULL
    AND (
      metadata->>'quota_class' = 'user_turn'
      OR (
        metadata->>'quota_class' IS NULL
        AND metadata->>'endpoint' IS NULL
        AND metadata->>'source' IS NULL
      )
    )
  GROUP BY couple_id
)
INSERT INTO public.amora_turn_counters (key, count)
SELECT
  'couple:user_turns:' || candidates.couple_id_text,
  COALESCE(exact.turn_count, 0)
FROM candidate_couples candidates
LEFT JOIN exact_user_turns exact USING (couple_id_text)
ON CONFLICT (key) DO NOTHING;

-- Rolling/rollback instances still call the legacy signature. Route it into the
-- same global provider ledger; over-counting old hidden calls as user turns is
-- safer than allowing a second independent breaker.
CREATE OR REPLACE FUNCTION public.reserve_amora_turn(
  p_couple_id uuid,
  p_couple_cap integer,
  p_global_cap integer
)
RETURNS TABLE(allowed boolean, reason text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT usage.allowed, usage.reason
  FROM public.reserve_amora_usage(
    p_couple_id,
    p_couple_cap,
    p_global_cap,
    true
  ) AS usage;
$$;
REVOKE ALL ON FUNCTION public.reserve_amora_turn(uuid, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_amora_turn(uuid, integer, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_amora_turn(uuid, integer, integer) TO service_role;
