BEGIN;

-- Atomic Amora daily provider-cost budget.
--
-- Turn counts alone do not bound spend because one turn can contain multiple
-- provider calls and Luna/Terra have different prices. Reserve a conservative
-- maximum micro-USD amount in the same transaction as the existing turn cap.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.amora_turn_counters
  ADD COLUMN IF NOT EXISTS reserved_cost_microusd bigint NOT NULL DEFAULT 0;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.amora_turn_counters'::regclass
      AND conname = 'amora_turn_counters_reserved_cost_nonnegative'
  ) THEN
    ALTER TABLE public.amora_turn_counters
      ADD CONSTRAINT amora_turn_counters_reserved_cost_nonnegative
      CHECK (reserved_cost_microusd >= 0)
      NOT VALID;
  END IF;
END;
$constraints$;

ALTER TABLE public.amora_turn_counters
  VALIDATE CONSTRAINT amora_turn_counters_reserved_cost_nonnegative;

-- Do not reset known cost for the current KST day when upgrading an existing
-- global counter. Unknown/prepared calls remain visible in the provider ledger
-- and release reconciliation gate; this seed only establishes a lower bound.
WITH known_today AS (
  SELECT COALESCE(
    ceil(sum(GREATEST(cost_usd, 0)) * 1000000),
    0
  )::bigint AS cost_microusd
  FROM public.ai_interactions_log
  WHERE (
      interaction_type = 'amora_director'
      OR COALESCE(metadata ->> 'ai_provider', '') = 'openai'
    )
    AND cost_usd IS NOT NULL
    AND created_at >= (
      date_trunc('day', now() AT TIME ZONE 'Asia/Seoul')
      AT TIME ZONE 'Asia/Seoul'
    )
)
UPDATE public.amora_turn_counters AS counter
SET reserved_cost_microusd = GREATEST(
      counter.reserved_cost_microusd,
      known_today.cost_microusd
    ),
    updated_at = now()
FROM known_today
WHERE counter.key = 'global:' || to_char(
  now() AT TIME ZONE 'Asia/Seoul',
  'YYYY-MM-DD'
);

CREATE OR REPLACE FUNCTION public.reserve_amora_turn(
  p_couple_id uuid,
  p_couple_cap integer,
  p_global_cap integer,
  p_reserve_cost_microusd bigint,
  p_global_cost_cap_microusd bigint
)
RETURNS TABLE(allowed boolean, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_kst_day_start timestamptz :=
    date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul';
  v_global_key text := 'global:' || to_char(
    now() AT TIME ZONE 'Asia/Seoul',
    'YYYY-MM-DD'
  );
  v_couple_key text;
  v_global_count integer;
  v_couple_count integer;
  v_reserved_cost_microusd bigint;
  v_known_cost_microusd bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_TURN_RESERVE_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF p_couple_id IS NULL
     OR p_couple_cap IS NULL OR p_couple_cap < 1
     OR p_global_cap IS NULL OR p_global_cap < 1
     OR p_reserve_cost_microusd IS NULL OR p_reserve_cost_microusd < 1
     OR p_global_cost_cap_microusd IS NULL OR p_global_cost_cap_microusd < 1 THEN
    RETURN QUERY SELECT false, 'invalid_args'::text;
    RETURN;
  END IF;

  v_couple_key := 'couple:' || p_couple_id::text;

  SELECT COALESCE(
    ceil(sum(GREATEST(cost_usd, 0)) * 1000000),
    0
  )::bigint INTO v_known_cost_microusd
  FROM public.ai_interactions_log
  WHERE (
      interaction_type = 'amora_director'
      OR COALESCE(metadata ->> 'ai_provider', '') = 'openai'
    )
    AND cost_usd IS NOT NULL
    AND created_at >= v_kst_day_start;

  INSERT INTO public.amora_turn_counters (
    key, count, reserved_cost_microusd
  ) VALUES (
    v_global_key,
    (
      SELECT count(*)::integer
      FROM public.ai_interactions_log
      WHERE interaction_type = 'chat_turn'
        AND created_at >= v_kst_day_start
    ),
    v_known_cost_microusd
  )
  ON CONFLICT (key) DO NOTHING;

  INSERT INTO public.amora_turn_counters (key, count)
  VALUES (
    v_couple_key,
    (
      SELECT count(*)::integer
      FROM public.ai_interactions_log
      WHERE interaction_type = 'chat_turn'
        AND couple_id = p_couple_id
    )
  )
  ON CONFLICT (key) DO NOTHING;

  -- Global first, then couple: stable lock order avoids deadlocks.
  SELECT count, reserved_cost_microusd
    INTO v_global_count, v_reserved_cost_microusd
  FROM public.amora_turn_counters
  WHERE key = v_global_key
  FOR UPDATE;

  -- Reconcile upward if a completed provider row became visible after this
  -- day's counter was first created. Never release conservative reservations.
  v_reserved_cost_microusd := GREATEST(
    v_reserved_cost_microusd,
    v_known_cost_microusd
  );
  UPDATE public.amora_turn_counters
  SET reserved_cost_microusd = v_reserved_cost_microusd,
      updated_at = now()
  WHERE key = v_global_key;

  IF v_global_count >= p_global_cap THEN
    RETURN QUERY SELECT false, 'global_daily'::text;
    RETURN;
  END IF;

  IF p_reserve_cost_microusd > p_global_cost_cap_microusd
     OR v_reserved_cost_microusd
          > p_global_cost_cap_microusd - p_reserve_cost_microusd THEN
    RETURN QUERY SELECT false, 'global_daily_budget'::text;
    RETURN;
  END IF;

  SELECT count INTO v_couple_count
  FROM public.amora_turn_counters
  WHERE key = v_couple_key
  FOR UPDATE;

  IF v_couple_count >= p_couple_cap THEN
    RETURN QUERY SELECT false, 'couple_quota'::text;
    RETURN;
  END IF;

  UPDATE public.amora_turn_counters
  SET count = count + 1,
      reserved_cost_microusd = reserved_cost_microusd + p_reserve_cost_microusd,
      updated_at = now()
  WHERE key = v_global_key;

  UPDATE public.amora_turn_counters
  SET count = count + 1,
      updated_at = now()
  WHERE key = v_couple_key;

  RETURN QUERY SELECT true, NULL::text;
END;
$function$;

-- Rolling-deploy compatibility: old application instances still call the
-- three-argument signature. Reserve the largest supported Terra-turn bound
-- against the conservative default $20 daily budget until all instances move.
CREATE OR REPLACE FUNCTION public.reserve_amora_turn(
  p_couple_id uuid,
  p_couple_cap integer,
  p_global_cap integer
)
RETURNS TABLE(allowed boolean, reason text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT *
  FROM public.reserve_amora_turn(
    p_couple_id,
    p_couple_cap,
    p_global_cap,
    636000::bigint,
    20000000::bigint
  );
$function$;

REVOKE ALL ON FUNCTION public.reserve_amora_turn(uuid, integer, integer, bigint, bigint)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reserve_amora_turn(uuid, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reserve_amora_turn(uuid, integer, integer, bigint, bigint)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_amora_turn(uuid, integer, integer)
  TO service_role;

COMMENT ON FUNCTION public.reserve_amora_turn(uuid, integer, integer, bigint, bigint) IS
  'Atomically reserves one Amora turn and its conservative maximum provider cost under KST daily count and USD caps.';
COMMENT ON COLUMN public.amora_turn_counters.reserved_cost_microusd IS
  'OpenAI provider cost in millionths of USD. Active/unknown receipts retain their reservation; completed receipts are atomically settled to actual usage.';

-- Amora provider receipts. The request/call/phase tuple is the durable
-- paid-generation boundary. A retry may reclaim only a receipt that is known
-- not to have reached the provider (released), or a stale pre-reservation
-- prepare. Reserved, unknown, and settled receipts are never regenerated.
ALTER TABLE public.ai_interactions_log
  ADD COLUMN IF NOT EXISTS amora_request_key text,
  ADD COLUMN IF NOT EXISTS amora_call_index integer,
  ADD COLUMN IF NOT EXISTS amora_call_source text,
  ADD COLUMN IF NOT EXISTS amora_call_phase text,
  ADD COLUMN IF NOT EXISTS amora_claim_token uuid,
  ADD COLUMN IF NOT EXISTS amora_cost_status text,
  ADD COLUMN IF NOT EXISTS amora_reserved_cost_microusd bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amora_actual_cost_microusd bigint,
  ADD COLUMN IF NOT EXISTS amora_global_counter_key text,
  ADD COLUMN IF NOT EXISTS amora_cost_couple_id uuid,
  ADD COLUMN IF NOT EXISTS amora_receipt_updated_at timestamptz;

DO $receipt_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.ai_interactions_log'::regclass
      AND conname = 'ai_log_amora_receipt_shape'
  ) THEN
    ALTER TABLE public.ai_interactions_log
      ADD CONSTRAINT ai_log_amora_receipt_shape CHECK (
        amora_request_key IS NULL
        OR (
          amora_request_key ~ '^[A-Za-z0-9_.:-]{1,240}$'
          AND amora_call_index BETWEEN 1 AND 3
          AND (
            (
              amora_call_source IN ('durable', 'demo', 'release_eval')
              AND amora_call_phase IN ('tool_round', 'final_no_tool')
            )
            OR (
              amora_call_source = 'conflict_check'
              AND amora_call_phase IN (
                'conflict_verify', 'conflict_mediation'
              )
            )
          )
          AND amora_claim_token IS NOT NULL
          AND amora_cost_status IN (
            'prepared', 'reserved', 'released', 'settled', 'unknown'
          )
          AND amora_reserved_cost_microusd >= 0
          AND (
            amora_actual_cost_microusd IS NULL
            OR amora_actual_cost_microusd >= 0
          )
        )
      ) NOT VALID;
  END IF;
END;
$receipt_constraints$;

ALTER TABLE public.ai_interactions_log
  VALIDATE CONSTRAINT ai_log_amora_receipt_shape;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_log_amora_provider_receipt
  ON public.ai_interactions_log (
    amora_request_key,
    amora_call_index,
    amora_call_phase
  )
  WHERE amora_request_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.amora_turn_requests (
  request_key text PRIMARY KEY
    CHECK (request_key ~ '^[A-Za-z0-9_.:-]{1,240}$'),
  couple_id uuid NOT NULL,
  kst_day date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.amora_turn_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS amora_turn_requests_service_role_all
  ON public.amora_turn_requests;
CREATE POLICY amora_turn_requests_service_role_all
  ON public.amora_turn_requests
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
REVOKE ALL ON public.amora_turn_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.amora_turn_requests TO service_role;

CREATE OR REPLACE FUNCTION public.prepare_amora_provider_call_receipt(
  p_user_id uuid,
  p_log_couple_id uuid,
  p_session_id text,
  p_specialist_type text,
  p_model text,
  p_request_key text,
  p_call_index integer,
  p_call_source text,
  p_call_phase text,
  p_metadata jsonb
)
RETURNS TABLE(
  receipt_id uuid,
  claim_token uuid,
  claimed boolean,
  receipt_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_receipt public.ai_interactions_log%ROWTYPE;
  v_claim_token uuid := gen_random_uuid();
  v_metadata jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_PROVIDER_RECEIPT_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF p_request_key IS NULL
     OR p_request_key !~ '^[A-Za-z0-9_.:-]{1,240}$'
     OR p_call_index IS NULL OR p_call_index NOT BETWEEN 1 AND 3
     OR p_call_source IS NULL
     OR p_call_phase IS NULL
     OR NOT (
       (
         p_call_source IN ('durable', 'demo', 'release_eval')
         AND p_call_phase IN ('tool_round', 'final_no_tool')
       )
       OR (
         p_call_source = 'conflict_check'
         AND p_call_phase IN ('conflict_verify', 'conflict_mediation')
       )
     )
     OR p_model IS NULL OR btrim(p_model) = ''
     OR p_metadata IS NULL OR jsonb_typeof(p_metadata) <> 'object' THEN
    RAISE EXCEPTION 'AMORA_PROVIDER_RECEIPT_INVALID_ARGS'
      USING ERRCODE = '22023';
  END IF;

  v_metadata := p_metadata || jsonb_build_object(
    'request_key', p_request_key,
    'provider_call_index', p_call_index,
    'provider_call_source', p_call_source,
    'provider_call_phase', p_call_phase,
    'content_logging', 'disabled',
    'ledger_status', 'prepared'
  );

  INSERT INTO public.ai_interactions_log (
    user_id,
    couple_id,
    session_id,
    message_id,
    interaction_type,
    specialist_type,
    user_input,
    ai_output,
    tool_name,
    tool_input,
    tool_output,
    latency_ms,
    success,
    error_message,
    model,
    tokens_input,
    tokens_output,
    cost_usd,
    metadata,
    amora_request_key,
    amora_call_index,
    amora_call_source,
    amora_call_phase,
    amora_claim_token,
    amora_cost_status,
    amora_reserved_cost_microusd,
    amora_actual_cost_microusd,
    amora_receipt_updated_at
  ) VALUES (
    p_user_id,
    p_log_couple_id,
    p_session_id,
    NULL,
    'amora_director',
    p_specialist_type,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    false,
    'provider_attempt_prepared',
    p_model,
    NULL,
    NULL,
    NULL,
    v_metadata,
    p_request_key,
    p_call_index,
    p_call_source,
    p_call_phase,
    v_claim_token,
    'prepared',
    0,
    NULL,
    now()
  )
  ON CONFLICT (
    amora_request_key,
    amora_call_index,
    amora_call_phase
  ) WHERE amora_request_key IS NOT NULL
  DO NOTHING
  RETURNING * INTO v_receipt;

  IF FOUND THEN
    RETURN QUERY SELECT v_receipt.id, v_receipt.amora_claim_token,
      true, v_receipt.amora_cost_status;
    RETURN;
  END IF;

  -- A released receipt is known not to have reached generation. Likewise, a
  -- prepared receipt that never reserved after ten minutes cannot have crossed
  -- the mandatory generation gate and is safe to reclaim.
  v_claim_token := gen_random_uuid();
  UPDATE public.ai_interactions_log
  SET user_id = p_user_id,
      couple_id = p_log_couple_id,
      session_id = p_session_id,
      specialist_type = p_specialist_type,
      latency_ms = NULL,
      success = false,
      error_message = 'provider_attempt_prepared',
      model = p_model,
      tokens_input = NULL,
      tokens_output = NULL,
      cost_usd = NULL,
      metadata = v_metadata,
      amora_claim_token = v_claim_token,
      amora_call_source = p_call_source,
      amora_cost_status = 'prepared',
      amora_reserved_cost_microusd = 0,
      amora_actual_cost_microusd = NULL,
      amora_global_counter_key = NULL,
      amora_cost_couple_id = NULL,
      amora_receipt_updated_at = now()
  WHERE amora_request_key = p_request_key
    AND amora_call_index = p_call_index
    AND amora_call_phase = p_call_phase
    AND (
      amora_cost_status = 'released'
      OR (
        amora_cost_status = 'prepared'
        AND amora_receipt_updated_at < now() - interval '10 minutes'
      )
    )
  RETURNING * INTO v_receipt;

  IF FOUND THEN
    RETURN QUERY SELECT v_receipt.id, v_receipt.amora_claim_token,
      true, v_receipt.amora_cost_status;
    RETURN;
  END IF;

  SELECT * INTO v_receipt
  FROM public.ai_interactions_log
  WHERE amora_request_key = p_request_key
    AND amora_call_index = p_call_index
    AND amora_call_phase = p_call_phase;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_PROVIDER_RECEIPT_LOOKUP_FAILED';
  END IF;

  RETURN QUERY SELECT v_receipt.id, v_receipt.amora_claim_token,
    false, v_receipt.amora_cost_status;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reserve_amora_provider_call(
  p_receipt_id uuid,
  p_claim_token uuid,
  p_request_key text,
  p_cost_couple_id uuid,
  p_couple_cap integer,
  p_global_cap integer,
  p_reserve_cost_microusd bigint,
  p_global_cost_cap_microusd bigint
)
RETURNS TABLE(allowed boolean, reason text, remaining integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_receipt public.ai_interactions_log%ROWTYPE;
  v_kst_day_start timestamptz :=
    date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul';
  v_kst_day date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_global_key text := 'global:' || to_char(
    now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD'
  );
  v_couple_key text;
  v_global_count integer;
  v_couple_count integer;
  v_reserved_cost_microusd bigint;
  v_known_cost_microusd bigint;
  v_existing_couple_id uuid;
  v_is_new_turn boolean;
  v_remaining integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_PROVIDER_RESERVE_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF p_receipt_id IS NULL OR p_claim_token IS NULL
     OR p_request_key IS NULL
        OR p_request_key !~ '^[A-Za-z0-9_.:-]{1,240}$'
     OR p_cost_couple_id IS NULL
     OR p_couple_cap IS NULL OR p_couple_cap < 1
     OR p_global_cap IS NULL OR p_global_cap < 1
     OR p_reserve_cost_microusd IS NULL OR p_reserve_cost_microusd < 1
     OR p_global_cost_cap_microusd IS NULL
        OR p_global_cost_cap_microusd < 1 THEN
    RETURN QUERY SELECT false, 'invalid_args'::text, NULL::integer;
    RETURN;
  END IF;

  SELECT * INTO v_receipt
  FROM public.ai_interactions_log
  WHERE id = p_receipt_id
    AND amora_request_key = p_request_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'invalid_receipt'::text, NULL::integer;
    RETURN;
  END IF;
  IF v_receipt.amora_claim_token IS DISTINCT FROM p_claim_token THEN
    RETURN QUERY SELECT false, 'stale_claim'::text, NULL::integer;
    RETURN;
  END IF;
  IF v_receipt.amora_cost_status IS DISTINCT FROM 'prepared' THEN
    RETURN QUERY SELECT false, 'receipt_not_prepared'::text, NULL::integer;
    RETURN;
  END IF;

  SELECT couple_id INTO v_existing_couple_id
  FROM public.amora_turn_requests
  WHERE request_key = p_request_key;
  v_is_new_turn := NOT FOUND;

  IF NOT v_is_new_turn
     AND v_existing_couple_id IS DISTINCT FROM p_cost_couple_id THEN
    RETURN QUERY SELECT false, 'invalid_args'::text, NULL::integer;
    RETURN;
  END IF;
  IF v_is_new_turn AND v_receipt.amora_call_index <> 1 THEN
    RETURN QUERY SELECT false, 'invalid_call_sequence'::text, NULL::integer;
    RETURN;
  END IF;

  v_couple_key := 'couple:' || p_cost_couple_id::text;

  SELECT COALESCE(
    ceil(sum(GREATEST(cost_usd, 0)) * 1000000), 0
  )::bigint INTO v_known_cost_microusd
  FROM public.ai_interactions_log
  WHERE (
      interaction_type = 'amora_director'
      OR COALESCE(metadata ->> 'ai_provider', '') = 'openai'
    )
    AND cost_usd IS NOT NULL
    AND created_at >= v_kst_day_start;

  INSERT INTO public.amora_turn_counters (
    key, count, reserved_cost_microusd
  ) VALUES (
    v_global_key,
    (
      SELECT count(*)::integer
      FROM public.ai_interactions_log
      WHERE interaction_type = 'chat_turn'
        AND created_at >= v_kst_day_start
    ),
    v_known_cost_microusd
  )
  ON CONFLICT (key) DO NOTHING;

  INSERT INTO public.amora_turn_counters (key, count)
  VALUES (
    v_couple_key,
    (
      SELECT count(*)::integer
      FROM public.ai_interactions_log
      WHERE interaction_type = 'chat_turn'
        AND couple_id = p_cost_couple_id
    )
  )
  ON CONFLICT (key) DO NOTHING;

  -- Stable global -> couple lock order.
  SELECT count, reserved_cost_microusd
    INTO v_global_count, v_reserved_cost_microusd
  FROM public.amora_turn_counters
  WHERE key = v_global_key
  FOR UPDATE;

  v_reserved_cost_microusd := GREATEST(
    v_reserved_cost_microusd,
    v_known_cost_microusd
  );
  UPDATE public.amora_turn_counters
  SET reserved_cost_microusd = v_reserved_cost_microusd,
      updated_at = now()
  WHERE key = v_global_key;

  SELECT count INTO v_couple_count
  FROM public.amora_turn_counters
  WHERE key = v_couple_key
  FOR UPDATE;

  IF v_is_new_turn AND v_global_count >= p_global_cap THEN
    RETURN QUERY SELECT false, 'global_daily'::text, NULL::integer;
    RETURN;
  END IF;
  IF v_is_new_turn AND v_couple_count >= p_couple_cap THEN
    RETURN QUERY SELECT false, 'couple_quota'::text, NULL::integer;
    RETURN;
  END IF;
  IF p_reserve_cost_microusd > p_global_cost_cap_microusd
     OR v_reserved_cost_microusd
          > p_global_cost_cap_microusd - p_reserve_cost_microusd THEN
    RETURN QUERY SELECT false, 'global_daily_budget'::text, NULL::integer;
    RETURN;
  END IF;

  IF v_is_new_turn THEN
    INSERT INTO public.amora_turn_requests (request_key, couple_id, kst_day)
    VALUES (p_request_key, p_cost_couple_id, v_kst_day);
  END IF;

  UPDATE public.amora_turn_counters
  SET count = count + CASE WHEN v_is_new_turn THEN 1 ELSE 0 END,
      reserved_cost_microusd =
        reserved_cost_microusd + p_reserve_cost_microusd,
      updated_at = now()
  WHERE key = v_global_key;

  IF v_is_new_turn THEN
    UPDATE public.amora_turn_counters
    SET count = count + 1,
        updated_at = now()
    WHERE key = v_couple_key;
    v_couple_count := v_couple_count + 1;
  END IF;

  UPDATE public.ai_interactions_log
  SET amora_cost_status = 'reserved',
      amora_reserved_cost_microusd = p_reserve_cost_microusd,
      amora_actual_cost_microusd = NULL,
      amora_global_counter_key = v_global_key,
      amora_cost_couple_id = p_cost_couple_id,
      amora_receipt_updated_at = now(),
      metadata = metadata || jsonb_build_object(
        'ledger_status', 'reserved',
        'reserved_cost_microusd', p_reserve_cost_microusd
      )
  WHERE id = p_receipt_id;

  v_remaining := GREATEST(p_couple_cap - v_couple_count, 0);
  RETURN QUERY SELECT true, NULL::text, v_remaining;
END;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_amora_provider_call_receipt(
  p_receipt_id uuid,
  p_claim_token uuid,
  p_provider_attempted boolean,
  p_usage_status text,
  p_actual_cost_microusd bigint,
  p_success boolean,
  p_error_message text,
  p_model text,
  p_tokens_input integer,
  p_tokens_output integer,
  p_latency_ms integer,
  p_metadata jsonb
)
RETURNS TABLE(finalized boolean, receipt_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_receipt public.ai_interactions_log%ROWTYPE;
  v_new_status text;
  v_global_cost_delta bigint := 0;
  v_couple_key text;
  v_turn_released boolean := false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_PROVIDER_FINALIZE_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF p_receipt_id IS NULL OR p_claim_token IS NULL
     OR p_provider_attempted IS NULL
     OR p_usage_status IS NULL
        OR p_usage_status NOT IN ('complete', 'unknown')
     OR p_success IS NULL
     OR p_metadata IS NULL OR jsonb_typeof(p_metadata) <> 'object'
     OR (
       p_actual_cost_microusd IS NOT NULL
       AND p_actual_cost_microusd < 0
     ) THEN
    RETURN QUERY SELECT false, 'invalid_args'::text;
    RETURN;
  END IF;

  SELECT * INTO v_receipt
  FROM public.ai_interactions_log
  WHERE id = p_receipt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'invalid_receipt'::text;
    RETURN;
  END IF;
  IF v_receipt.amora_claim_token IS DISTINCT FROM p_claim_token THEN
    RETURN QUERY SELECT false, 'stale_claim'::text;
    RETURN;
  END IF;
  IF v_receipt.amora_cost_status IN ('released', 'settled', 'unknown') THEN
    RETURN QUERY SELECT true, v_receipt.amora_cost_status;
    RETURN;
  END IF;
  IF v_receipt.amora_cost_status NOT IN ('prepared', 'reserved') THEN
    RETURN QUERY SELECT false, 'invalid_receipt_state'::text;
    RETURN;
  END IF;
  IF p_provider_attempted
     AND v_receipt.amora_cost_status <> 'reserved' THEN
    RETURN QUERY SELECT false, 'provider_without_reservation'::text;
    RETURN;
  END IF;

  IF NOT p_provider_attempted THEN
    v_new_status := 'released';
  ELSIF p_usage_status = 'complete'
        AND p_actual_cost_microusd IS NOT NULL THEN
    v_new_status := 'settled';
  ELSE
    -- An attempted call with unknown billing must retain its maximum
    -- reservation until explicit reconciliation.
    v_new_status := 'unknown';
  END IF;

  IF v_receipt.amora_cost_status = 'reserved' THEN
    PERFORM 1
    FROM public.amora_turn_counters
    WHERE key = v_receipt.amora_global_counter_key
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'AMORA_PROVIDER_GLOBAL_COUNTER_MISSING';
    END IF;

    IF v_new_status = 'released' THEN
      v_global_cost_delta := -v_receipt.amora_reserved_cost_microusd;
    ELSIF v_new_status = 'settled' THEN
      v_global_cost_delta :=
        p_actual_cost_microusd - v_receipt.amora_reserved_cost_microusd;
    END IF;

    UPDATE public.amora_turn_counters
    SET reserved_cost_microusd = GREATEST(
          reserved_cost_microusd + v_global_cost_delta,
          0
        ),
        updated_at = now()
    WHERE key = v_receipt.amora_global_counter_key;

    -- A first call that is proven not to have reached the provider should not
    -- consume the logical turn quota. Later calls cannot exist before call 1.
    IF v_new_status = 'released' AND v_receipt.amora_call_index = 1 THEN
      DELETE FROM public.amora_turn_requests
      WHERE request_key = v_receipt.amora_request_key
        AND couple_id = v_receipt.amora_cost_couple_id;
      v_turn_released := FOUND;

      IF v_turn_released THEN
        v_couple_key := 'couple:' || v_receipt.amora_cost_couple_id::text;
        PERFORM 1 FROM public.amora_turn_counters
        WHERE key = v_couple_key
        FOR UPDATE;

        UPDATE public.amora_turn_counters
        SET count = GREATEST(count - 1, 0),
            updated_at = now()
        WHERE key IN (v_receipt.amora_global_counter_key, v_couple_key);
      END IF;
    END IF;
  END IF;

  UPDATE public.ai_interactions_log
  SET latency_ms = p_latency_ms,
      success = p_success,
      error_message = p_error_message,
      model = p_model,
      tokens_input = p_tokens_input,
      tokens_output = p_tokens_output,
      cost_usd = CASE
        WHEN v_new_status = 'settled'
          THEN p_actual_cost_microusd::numeric / 1000000::numeric
        ELSE NULL
      END,
      metadata = metadata || p_metadata || jsonb_build_object(
        'ledger_status', v_new_status,
        'actual_cost_microusd', CASE
          WHEN v_new_status = 'settled' THEN p_actual_cost_microusd
          ELSE NULL
        END
      ),
      amora_cost_status = v_new_status,
      amora_actual_cost_microusd = CASE
        WHEN v_new_status = 'settled' THEN p_actual_cost_microusd
        ELSE NULL
      END,
      amora_receipt_updated_at = now()
  WHERE id = p_receipt_id;

  RETURN QUERY SELECT true, v_new_status;
END;
$function$;

REVOKE ALL ON FUNCTION public.prepare_amora_provider_call_receipt(
  uuid, uuid, text, text, text, text, integer, text, text, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reserve_amora_provider_call(
  uuid, uuid, text, uuid, integer, integer, bigint, bigint
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.finalize_amora_provider_call_receipt(
  uuid, uuid, boolean, text, bigint, boolean, text, text,
  integer, integer, integer, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prepare_amora_provider_call_receipt(
  uuid, uuid, text, text, text, text, integer, text, text, jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_amora_provider_call(
  uuid, uuid, text, uuid, integer, integer, bigint, bigint
) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_amora_provider_call_receipt(
  uuid, uuid, boolean, text, bigint, boolean, text, text,
  integer, integer, integer, jsonb
) TO service_role;

COMMENT ON FUNCTION public.prepare_amora_provider_call_receipt(
  uuid, uuid, text, text, text, text, integer, text, text, jsonb
) IS 'Claims one durable Amora provider receipt per request/call/phase; only known-unattempted receipts are reclaimable.';
COMMENT ON FUNCTION public.reserve_amora_provider_call(
  uuid, uuid, text, uuid, integer, integer, bigint, bigint
) IS 'Atomically claims a logical turn once and reserves one provider-call maximum against the KST daily budget.';
COMMENT ON FUNCTION public.finalize_amora_provider_call_receipt(
  uuid, uuid, boolean, text, bigint, boolean, text, text,
  integer, integer, integer, jsonb
) IS 'Idempotently settles a reserved provider call to actual micro-USD, releases proven pre-generation failures, or retains unknown reservations.';

DO $postchecks$
BEGIN
  IF to_regprocedure(
       'public.reserve_amora_turn(uuid,integer,integer,bigint,bigint)'
     ) IS NULL
     OR NOT has_function_privilege(
       'service_role',
       'public.reserve_amora_turn(uuid,integer,integer,bigint,bigint)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.reserve_amora_turn(uuid,integer,integer,bigint,bigint)',
       'EXECUTE'
     )
     OR to_regprocedure(
       'public.prepare_amora_provider_call_receipt(uuid,uuid,text,text,text,text,integer,text,text,jsonb)'
     ) IS NULL
     OR to_regprocedure(
       'public.reserve_amora_provider_call(uuid,uuid,text,uuid,integer,integer,bigint,bigint)'
     ) IS NULL
     OR to_regprocedure(
       'public.finalize_amora_provider_call_receipt(uuid,uuid,boolean,text,bigint,boolean,text,text,integer,integer,integer,jsonb)'
     ) IS NULL
     OR NOT has_function_privilege(
       'service_role',
       'public.prepare_amora_provider_call_receipt(uuid,uuid,text,text,text,text,integer,text,text,jsonb)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.prepare_amora_provider_call_receipt(uuid,uuid,text,text,text,text,integer,text,text,jsonb)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'AMORA_ATOMIC_COST_BUDGET_POSTCHECK_FAILED';
  END IF;
END;
$postchecks$;

COMMIT;
