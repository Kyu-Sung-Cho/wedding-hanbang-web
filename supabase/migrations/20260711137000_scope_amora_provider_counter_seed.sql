-- Count only actual OpenAI calls when lazily seeding the daily provider breaker.
-- Deterministic helpers also log non-null model labels and must not consume it.
-- Existing current-day rows are not reduced: they can contain failed/aborted
-- reservations with no complete audit row and safely expire at the next KST day.

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
  v_couple_provider_key text :=
    'couple:provider_calls:' || p_couple_id::text || ':'
    || to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD');
  v_global_count integer;
  v_couple_count integer;
  v_couple_provider_count integer;
  -- Database ceilings are authoritative. Old/rolling application instances
  -- may still submit the historical 100/300 caps.
  v_effective_couple_cap integer := LEAST(p_couple_cap, 30);
  v_effective_global_cap integer := LEAST(p_global_provider_cap, 60);
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_couple_id IS NULL
    OR p_couple_cap IS NULL OR p_couple_cap < 1
    OR p_global_provider_cap IS NULL OR p_global_provider_cap < 1
    OR p_count_user_turn IS NULL
  THEN
    RETURN QUERY SELECT false, 'invalid_args'::text, NULL::integer;
    RETURN;
  END IF;

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
     WHERE created_at >= v_kst_day_start
       AND (
         model IN ('gpt-5.6-luna', 'gpt-5.6-terra')
         OR model LIKE 'gpt-5.6-luna-%'
         OR model LIKE 'gpt-5.6-terra-%'
       ))
  )
  ON CONFLICT (key) DO NOTHING;

  SELECT count INTO v_global_count
  FROM public.amora_turn_counters
  WHERE key = v_global_key
  FOR UPDATE;

  IF v_global_count >= v_effective_global_cap THEN
    RETURN QUERY SELECT false, 'global_daily'::text, NULL::integer;
    RETURN;
  END IF;

  -- The legacy reservation path is still used by bounded auxiliary and
  -- conflict checks. Give it the same per-couple daily breaker as v2 so one
  -- couple cannot drain the shared Luna/Terra allowance.
  INSERT INTO public.amora_turn_counters (key, count)
  VALUES (
    v_couple_provider_key,
    (SELECT COALESCE(sum(
       CASE
         WHEN jsonb_typeof(metadata->'request_usage') = 'array'
           THEN GREATEST(jsonb_array_length(metadata->'request_usage'), 1)
         ELSE 1
       END
     ), 0)::integer
     FROM public.ai_interactions_log
     WHERE created_at >= v_kst_day_start
       AND couple_id = p_couple_id
       AND (
         model IN ('gpt-5.6-luna', 'gpt-5.6-terra')
         OR model LIKE 'gpt-5.6-luna-%'
         OR model LIKE 'gpt-5.6-terra-%'
       ))
  )
  ON CONFLICT (key) DO NOTHING;

  SELECT count INTO v_couple_provider_count
  FROM public.amora_turn_counters
  WHERE key = v_couple_provider_key
  FOR UPDATE;

  IF v_couple_provider_count >= 20 THEN
    RETURN QUERY SELECT false, 'couple_provider_daily'::text, NULL::integer;
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

    IF v_couple_count >= v_effective_couple_cap THEN
      RETURN QUERY SELECT false, 'couple_quota'::text, 0;
      RETURN;
    END IF;
  END IF;

  UPDATE public.amora_turn_counters
  SET count = count + 1, updated_at = now()
  WHERE key = v_global_key;

  UPDATE public.amora_turn_counters
  SET count = count + 1, updated_at = now()
  WHERE key = v_couple_provider_key;

  IF p_count_user_turn THEN
    UPDATE public.amora_turn_counters
    SET count = count + 1, updated_at = now()
    WHERE key = v_couple_key
    RETURNING count INTO v_couple_count;
    RETURN QUERY SELECT true, NULL::text, GREATEST(v_effective_couple_cap - v_couple_count, 0);
  ELSE
    RETURN QUERY SELECT true, NULL::text, NULL::integer;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_amora_usage(uuid, integer, integer, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_amora_usage(uuid, integer, integer, boolean) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_amora_usage(uuid, integer, integer, boolean) TO service_role;

COMMENT ON FUNCTION public.reserve_amora_usage(uuid, integer, integer, boolean) IS
  'Atomically reserves Luna/Terra calls with global and per-couple daily breakers; bootstrap counts only approved OpenAI audit rows.';
