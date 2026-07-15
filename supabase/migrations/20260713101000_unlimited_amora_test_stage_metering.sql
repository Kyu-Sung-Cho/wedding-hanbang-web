-- During the product test stage Amora usage is metered but never blocked by a
-- lifetime, per-couple daily, or global daily counter. Keep the provider-call
-- reservation lifecycle so retries, crashes, and unknown provider outcomes
-- remain auditable without turning those counters into an availability gate.

CREATE OR REPLACE FUNCTION public.reserve_amora_usage_unlimited_v1(
  p_couple_id uuid,
  p_request_key text,
  p_request_hash text,
  p_provider_ordinal integer
)
RETURNS TABLE(
  allowed boolean,
  reason text,
  remaining integer,
  provider_remaining integer,
  reused boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kst_day_start timestamptz :=
    date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul';
  v_global_key text :=
    'global:provider_calls:' || to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD');
  v_couple_provider_key text :=
    'couple:provider_calls:' || p_couple_id::text || ':'
    || to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD');
  v_claim_hash text;
  v_claim_status text;
  v_existing public.amora_usage_reservations%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_couple_id IS NULL
    OR p_request_key IS NULL OR p_request_key !~ '^[a-f0-9]{64}$'
    OR p_request_hash IS NULL OR p_request_hash !~ '^[a-f0-9]{64}$'
    OR p_provider_ordinal IS NULL OR p_provider_ordinal NOT IN (0, 1)
  THEN
    RETURN QUERY SELECT false, 'invalid_args'::text,
      NULL::integer, NULL::integer, false;
    RETURN;
  END IF;

  SELECT request_hash, status
  INTO v_claim_hash, v_claim_status
  FROM public.amora_request_claims
  WHERE request_key = p_request_key
  FOR SHARE;

  IF NOT FOUND OR v_claim_hash <> p_request_hash OR v_claim_status <> 'in_progress' THEN
    RETURN QUERY SELECT false, 'request_not_active'::text,
      NULL::integer, NULL::integer, false;
    RETURN;
  END IF;

  INSERT INTO public.amora_turn_counters (key, count)
  VALUES (
    v_global_key,
    GREATEST(
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
         )),
      (SELECT count(*)::integer
       FROM public.amora_usage_reservations
       WHERE global_counter_key = v_global_key)
    )
  )
  ON CONFLICT (key) DO NOTHING;

  -- Keep the existing global -> couple lock order used by settlement RPCs.
  PERFORM 1
  FROM public.amora_turn_counters
  WHERE key = v_global_key
  FOR UPDATE;

  INSERT INTO public.amora_turn_counters (key, count)
  VALUES (
    v_couple_provider_key,
    GREATEST(
      (SELECT count(*)::integer
       FROM public.amora_usage_reservations
       WHERE couple_id = p_couple_id
         AND global_counter_key = v_global_key),
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
  )
  ON CONFLICT (key) DO NOTHING;

  PERFORM 1
  FROM public.amora_turn_counters
  WHERE key = v_couple_provider_key
  FOR UPDATE;

  SELECT * INTO v_existing
  FROM public.amora_usage_reservations
  WHERE request_key = p_request_key
    AND provider_ordinal = p_provider_ordinal;

  IF FOUND THEN
    IF v_existing.request_hash <> p_request_hash
      OR v_existing.couple_id <> p_couple_id
      OR v_existing.counted_user_turn
    THEN
      RETURN QUERY SELECT false, 'reservation_mismatch'::text,
        NULL::integer, NULL::integer, true;
      RETURN;
    END IF;
    RETURN QUERY SELECT true, NULL::text,
      NULL::integer, NULL::integer, true;
    RETURN;
  END IF;

  INSERT INTO public.amora_usage_reservations (
    request_key,
    request_hash,
    provider_ordinal,
    couple_id,
    global_counter_key,
    counted_user_turn,
    visible_state
  ) VALUES (
    p_request_key,
    p_request_hash,
    p_provider_ordinal,
    p_couple_id,
    v_global_key,
    false,
    NULL
  );

  UPDATE public.amora_turn_counters
  SET count = count + 1, updated_at = now()
  WHERE key IN (v_global_key, v_couple_provider_key);

  RETURN QUERY SELECT true, NULL::text,
    NULL::integer, NULL::integer, false;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_amora_usage_unlimited_v1(
  uuid, text, text, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_amora_usage_unlimited_v1(
  uuid, text, text, integer
) TO service_role;

-- Provider-only helpers do not own a request claim, but their attempts still
-- increment the same KST-day counters for operational cost observation.
CREATE OR REPLACE FUNCTION public.meter_amora_provider_usage_unlimited_v1(
  p_couple_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kst_day_start timestamptz :=
    date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul';
  v_global_key text :=
    'global:provider_calls:' || to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD');
  v_couple_provider_key text :=
    'couple:provider_calls:' || p_couple_id::text || ':'
    || to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD');
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_couple_id IS NULL THEN
    RETURN false;
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
  PERFORM 1
  FROM public.amora_turn_counters
  WHERE key = v_global_key
  FOR UPDATE;

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
  PERFORM 1
  FROM public.amora_turn_counters
  WHERE key = v_couple_provider_key
  FOR UPDATE;

  UPDATE public.amora_turn_counters
  SET count = count + 1, updated_at = now()
  WHERE key IN (v_global_key, v_couple_provider_key);

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.meter_amora_provider_usage_unlimited_v1(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meter_amora_provider_usage_unlimited_v1(uuid)
  TO service_role;

COMMENT ON FUNCTION public.reserve_amora_usage_unlimited_v1(
  uuid, text, text, integer
) IS
  'Test-stage idempotent provider reservation and metering without usage caps.';
COMMENT ON FUNCTION public.meter_amora_provider_usage_unlimited_v1(uuid) IS
  'Test-stage provider-only metering without usage caps.';

-- Database migrations are applied before the new application revision is
-- promoted. Override every RPC used by the previous revision as part of the
-- same transaction so a rolling old instance cannot keep enforcing the
-- dormant 20/60 breakers after this migration lands.
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

  -- This legacy signature has no request identity and therefore cannot own an
  -- idempotent reservation. Keep its historical provider-attempt accounting,
  -- but do not grow or consult the retired consumer-visible quota counter.
  PERFORM public.meter_amora_provider_usage_unlimited_v1(p_couple_id);
  RETURN QUERY SELECT true, NULL::text, NULL::integer;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_amora_usage(uuid, integer, integer, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_amora_usage(uuid, integer, integer, boolean)
  TO service_role;

-- The currently deployed legacy application calls this oldest signature
-- directly. Recreate it in the same forward migration instead of relying on
-- an earlier wrapper surviving without catalog drift.
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

REVOKE ALL ON FUNCTION public.reserve_amora_turn(uuid, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_amora_turn(uuid, integer, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_amora_usage_v2(
  p_couple_id uuid,
  p_couple_cap integer,
  p_global_provider_cap integer,
  p_count_user_turn boolean,
  p_request_key text,
  p_request_hash text,
  p_provider_ordinal integer
)
RETURNS TABLE(
  allowed boolean,
  reason text,
  remaining integer,
  provider_remaining integer,
  reused boolean
)
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
  v_claim_hash text;
  v_claim_status text;
  v_existing public.amora_usage_reservations%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_couple_id IS NULL
    OR p_couple_cap IS NULL OR p_couple_cap < 1
    OR p_global_provider_cap IS NULL OR p_global_provider_cap < 1
    OR p_count_user_turn IS NULL
    OR p_request_key IS NULL OR p_request_key !~ '^[a-f0-9]{64}$'
    OR p_request_hash IS NULL OR p_request_hash !~ '^[a-f0-9]{64}$'
    OR p_provider_ordinal IS NULL OR p_provider_ordinal NOT IN (0, 1)
    OR (p_count_user_turn AND p_provider_ordinal <> 0)
  THEN
    RETURN QUERY SELECT false, 'invalid_args'::text,
      NULL::integer, NULL::integer, false;
    RETURN;
  END IF;

  SELECT request_hash, status
  INTO v_claim_hash, v_claim_status
  FROM public.amora_request_claims
  WHERE request_key = p_request_key
  FOR SHARE;

  IF NOT FOUND OR v_claim_hash <> p_request_hash OR v_claim_status <> 'in_progress' THEN
    RETURN QUERY SELECT false, 'request_not_active'::text,
      NULL::integer, NULL::integer, false;
    RETURN;
  END IF;

  INSERT INTO public.amora_turn_counters (key, count)
  VALUES (
    v_global_key,
    GREATEST(
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
         )),
      (SELECT count(*)::integer
       FROM public.amora_usage_reservations
       WHERE global_counter_key = v_global_key)
    )
  )
  ON CONFLICT (key) DO NOTHING;

  -- Preserve the global -> couple-provider -> visible-couple lock order used
  -- by fail_amora_chat_request, even though these counters no longer gate use.
  PERFORM 1
  FROM public.amora_turn_counters
  WHERE key = v_global_key
  FOR UPDATE;

  INSERT INTO public.amora_turn_counters (key, count)
  VALUES (
    v_couple_provider_key,
    GREATEST(
      (SELECT count(*)::integer
       FROM public.amora_usage_reservations
       WHERE couple_id = p_couple_id
         AND global_counter_key = v_global_key),
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
  )
  ON CONFLICT (key) DO NOTHING;

  PERFORM 1
  FROM public.amora_turn_counters
  WHERE key = v_couple_provider_key
  FOR UPDATE;

  SELECT * INTO v_existing
  FROM public.amora_usage_reservations
  WHERE request_key = p_request_key
    AND provider_ordinal = p_provider_ordinal;

  IF FOUND THEN
    IF v_existing.request_hash <> p_request_hash
      OR v_existing.couple_id <> p_couple_id
      OR v_existing.counted_user_turn <> p_count_user_turn
    THEN
      RETURN QUERY SELECT false, 'reservation_mismatch'::text,
        NULL::integer, NULL::integer, true;
      RETURN;
    END IF;

    IF p_count_user_turn THEN
      PERFORM 1
      FROM public.amora_turn_counters
      WHERE key = v_couple_key
      FOR UPDATE;
    END IF;
    RETURN QUERY SELECT true, NULL::text,
      NULL::integer, NULL::integer, true;
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
           AND metadata->>'quota_class' = 'user_turn'),
        COALESCE((
          SELECT count FROM public.amora_turn_counters
          WHERE key = 'couple:' || p_couple_id::text
        ), 0)
      )
    )
    ON CONFLICT (key) DO NOTHING;

    PERFORM 1
    FROM public.amora_turn_counters
    WHERE key = v_couple_key
    FOR UPDATE;
  END IF;

  INSERT INTO public.amora_usage_reservations (
    request_key,
    request_hash,
    provider_ordinal,
    couple_id,
    global_counter_key,
    counted_user_turn,
    visible_state
  ) VALUES (
    p_request_key,
    p_request_hash,
    p_provider_ordinal,
    p_couple_id,
    v_global_key,
    p_count_user_turn,
    CASE WHEN p_count_user_turn THEN 'pending' ELSE NULL END
  );

  UPDATE public.amora_turn_counters
  SET count = count + 1, updated_at = now()
  WHERE key IN (v_global_key, v_couple_provider_key);

  IF p_count_user_turn THEN
    UPDATE public.amora_turn_counters
    SET count = count + 1, updated_at = now()
    WHERE key = v_couple_key;
  END IF;

  RETURN QUERY SELECT true, NULL::text,
    NULL::integer, NULL::integer, false;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_amora_usage_v2(
  uuid, integer, integer, boolean, text, text, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_amora_usage_v2(
  uuid, integer, integer, boolean, text, text, integer
) TO service_role;

CREATE OR REPLACE FUNCTION public.check_amora_usage(
  p_couple_id uuid,
  p_couple_cap integer,
  p_global_provider_cap integer,
  p_count_user_turn boolean
)
RETURNS TABLE(
  allowed boolean,
  reason text,
  remaining integer,
  provider_remaining integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_couple_id IS NULL
    OR p_couple_cap IS NULL OR p_couple_cap < 1
    OR p_global_provider_cap IS NULL OR p_global_provider_cap < 1
    OR p_count_user_turn IS NULL
  THEN
    RETURN QUERY SELECT false, 'invalid_args'::text,
      NULL::integer, NULL::integer;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, NULL::text,
    NULL::integer, NULL::integer;
END;
$$;

REVOKE ALL ON FUNCTION public.check_amora_usage(uuid, integer, integer, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_amora_usage(uuid, integer, integer, boolean)
  TO service_role;

COMMENT ON FUNCTION public.reserve_amora_usage(uuid, integer, integer, boolean) IS
  'Rolling-deploy compatibility: meters legacy provider attempts without usage caps.';
COMMENT ON FUNCTION public.reserve_amora_turn(uuid, integer, integer) IS
  'Rolling-deploy compatibility: oldest application reservation without usage caps.';
COMMENT ON FUNCTION public.reserve_amora_usage_v2(
  uuid, integer, integer, boolean, text, text, integer
) IS
  'Rolling-deploy compatibility: idempotent provider reservations without usage caps.';
COMMENT ON FUNCTION public.check_amora_usage(uuid, integer, integer, boolean) IS
  'Rolling-deploy compatibility: validates callers but does not apply usage caps.';
