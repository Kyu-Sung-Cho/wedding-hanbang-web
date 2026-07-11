-- Idempotent provider-slot reservations and consumer-visible quota settlement.
-- Global provider attempts remain counted on ambiguous failure; the advertised
-- consultation quota is refunded when no completed answer was committed.

ALTER TABLE public.amora_request_claims
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
UPDATE public.amora_request_claims
SET lease_expires_at = COALESCE(lease_expires_at, updated_at + interval '7 minutes');
ALTER TABLE public.amora_request_claims
  ALTER COLUMN lease_expires_at SET DEFAULT (now() + interval '7 minutes'),
  ALTER COLUMN lease_expires_at SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amora_request_claims_stale_lease
  ON public.amora_request_claims(lease_expires_at)
  WHERE status = 'in_progress';

CREATE TABLE IF NOT EXISTS public.amora_usage_reservations (
  request_key text NOT NULL
    REFERENCES public.amora_request_claims(request_key) ON DELETE CASCADE,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  provider_ordinal smallint NOT NULL CHECK (provider_ordinal IN (0, 1)),
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  global_counter_key text NOT NULL,
  counted_user_turn boolean NOT NULL DEFAULT false,
  provider_state text NOT NULL DEFAULT 'reserved'
    CHECK (provider_state IN ('reserved', 'completed', 'failed_unknown')),
  visible_state text
    CHECK (visible_state IS NULL OR visible_state IN ('pending', 'consumed', 'refunded')),
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_key, provider_ordinal)
);

ALTER TABLE public.amora_usage_reservations
  DROP CONSTRAINT IF EXISTS amora_usage_reservations_provider_state_check;
ALTER TABLE public.amora_usage_reservations
  ADD CONSTRAINT amora_usage_reservations_provider_state_check
  CHECK (provider_state IN (
    'reserved', 'started', 'completed', 'failed_unstarted', 'failed_unknown'
  ));
CREATE UNIQUE INDEX IF NOT EXISTS uq_amora_one_visible_turn_per_request
  ON public.amora_usage_reservations(request_key)
  WHERE counted_user_turn;

ALTER TABLE public.amora_usage_reservations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS amora_usage_reservations_service_role_all
  ON public.amora_usage_reservations;
CREATE POLICY amora_usage_reservations_service_role_all
  ON public.amora_usage_reservations FOR ALL TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.amora_usage_reservations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.amora_usage_reservations TO service_role;

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
  v_effective_couple_cap integer := LEAST(p_couple_cap, 30);
  v_effective_global_cap integer := LEAST(p_global_provider_cap, 60);
  v_effective_couple_provider_cap integer := 20;
  v_global_count integer;
  v_couple_count integer;
  v_couple_provider_count integer;
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
    RETURN QUERY SELECT false, 'invalid_args'::text, NULL::integer, NULL::integer, false;
    RETURN;
  END IF;

  SELECT request_hash, status
  INTO v_claim_hash, v_claim_status
  FROM public.amora_request_claims
  WHERE request_key = p_request_key
  FOR SHARE;

  IF NOT FOUND OR v_claim_hash <> p_request_hash OR v_claim_status <> 'in_progress' THEN
    RETURN QUERY SELECT false, 'request_not_active'::text, NULL::integer, NULL::integer, false;
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
      -- A started exact-count slot may have no generation audit row. If a
      -- counter row ever needs lazy reconstruction, reservation tombstones
      -- keep that ambiguous provider work fail-closed.
      (SELECT count(*)::integer
       FROM public.amora_usage_reservations
       WHERE global_counter_key = v_global_key)
    )
  )
  ON CONFLICT (key) DO NOTHING;

  SELECT count INTO v_global_count
  FROM public.amora_turn_counters
  WHERE key = v_global_key
  FOR UPDATE;

  -- Every reservation path takes locks in global -> couple provider -> visible
  -- couple order. Replays take the same locks so remaining capacity is current
  -- and failure settlement can use one deterministic, deadlock-safe order.
  INSERT INTO public.amora_turn_counters (key, count)
  VALUES (
    v_couple_provider_key,
    GREATEST(
      (SELECT count(*)::integer
       FROM public.amora_usage_reservations
       WHERE couple_id = p_couple_id
         AND global_counter_key = v_global_key),
      -- On migration day there can be Luna/Terra calls recorded before the
      -- reservation table existed. Preserve that spend when lazily creating
      -- the per-couple breaker instead of resetting the couple to zero.
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
  SELECT count INTO v_couple_provider_count
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
      RETURN QUERY SELECT false, 'reservation_mismatch'::text, NULL::integer, NULL::integer, true;
      RETURN;
    END IF;

    IF p_count_user_turn THEN
      SELECT count INTO v_couple_count
      FROM public.amora_turn_counters
      WHERE key = v_couple_key
      FOR UPDATE;
    END IF;
    RETURN QUERY SELECT
      true,
      NULL::text,
      CASE WHEN p_count_user_turn
        THEN GREATEST(v_effective_couple_cap - COALESCE(v_couple_count, 0), 0)
        ELSE NULL::integer
      END,
      LEAST(
        GREATEST(v_effective_global_cap - v_global_count, 0),
        GREATEST(v_effective_couple_provider_cap - v_couple_provider_count, 0)
      ),
      true;
    RETURN;
  END IF;

  IF v_global_count >= v_effective_global_cap THEN
    RETURN QUERY SELECT false, 'global_daily'::text, NULL::integer, 0, false;
    RETURN;
  END IF;

  IF v_couple_provider_count >= v_effective_couple_provider_cap THEN
    RETURN QUERY SELECT false, 'couple_provider_daily'::text, NULL::integer, 0, false;
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

    SELECT count INTO v_couple_count
    FROM public.amora_turn_counters
    WHERE key = v_couple_key
    FOR UPDATE;

    IF v_couple_count >= v_effective_couple_cap THEN
      RETURN QUERY SELECT false, 'couple_quota'::text, 0,
        LEAST(
          GREATEST(v_effective_global_cap - v_global_count, 0),
          GREATEST(v_effective_couple_provider_cap - v_couple_provider_count, 0)
        ), false;
      RETURN;
    END IF;
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
  WHERE key = v_global_key
  RETURNING count INTO v_global_count;

  UPDATE public.amora_turn_counters
  SET count = count + 1, updated_at = now()
  WHERE key = v_couple_provider_key;

  IF p_count_user_turn THEN
    UPDATE public.amora_turn_counters
    SET count = count + 1, updated_at = now()
    WHERE key = v_couple_key
    RETURNING count INTO v_couple_count;
  END IF;

  RETURN QUERY SELECT
    true,
    NULL::text,
    CASE WHEN p_count_user_turn
      THEN GREATEST(v_effective_couple_cap - v_couple_count, 0)
      ELSE NULL::integer
    END,
    LEAST(
      GREATEST(v_effective_global_cap - v_global_count, 0),
      GREATEST(v_effective_couple_provider_cap - v_couple_provider_count - 1, 0)
    ),
    false;
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
DECLARE
  v_kst_day_start timestamptz :=
    date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul';
  v_global_key text :=
    'global:provider_calls:' || to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD');
  v_couple_key text := 'couple:user_turns:' || p_couple_id::text;
  v_couple_provider_key text :=
    'couple:provider_calls:' || p_couple_id::text || ':'
    || to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD');
  v_effective_couple_cap integer := LEAST(p_couple_cap, 30);
  v_effective_global_cap integer := LEAST(p_global_provider_cap, 60);
  v_effective_couple_provider_cap integer := 20;
  v_global_count integer;
  v_couple_count integer;
  v_couple_provider_count integer;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_couple_id IS NULL
    OR p_couple_cap IS NULL OR p_couple_cap < 1
    OR p_global_provider_cap IS NULL OR p_global_provider_cap < 1
    OR p_count_user_turn IS NULL
  THEN
    RETURN QUERY SELECT false, 'invalid_args'::text, NULL::integer, NULL::integer;
    RETURN;
  END IF;

  SELECT COALESCE(
    (SELECT count FROM public.amora_turn_counters WHERE key = v_global_key),
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
  ) INTO v_global_count;

  IF v_global_count >= v_effective_global_cap THEN
    RETURN QUERY SELECT false, 'global_daily'::text, NULL::integer, 0;
    RETURN;
  END IF;

  SELECT COALESCE(
    (SELECT count FROM public.amora_turn_counters WHERE key = v_couple_provider_key),
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
  ) INTO v_couple_provider_count;
  IF v_couple_provider_count >= v_effective_couple_provider_cap THEN
    RETURN QUERY SELECT false, 'couple_provider_daily'::text, NULL::integer, 0;
    RETURN;
  END IF;

  IF p_count_user_turn THEN
    SELECT COALESCE(
      (SELECT count FROM public.amora_turn_counters WHERE key = v_couple_key),
      (SELECT count(*)::integer
       FROM public.ai_interactions_log
       WHERE interaction_type = 'chat_turn'
         AND couple_id = p_couple_id
         AND metadata->>'quota_class' = 'user_turn'),
      0
    ) INTO v_couple_count;

    IF v_couple_count >= v_effective_couple_cap THEN
      RETURN QUERY SELECT false, 'couple_quota'::text, 0,
        LEAST(
          GREATEST(v_effective_global_cap - v_global_count, 0),
          GREATEST(v_effective_couple_provider_cap - v_couple_provider_count, 0)
        );
      RETURN;
    END IF;
  END IF;

  RETURN QUERY SELECT
    true,
    NULL::text,
    CASE WHEN p_count_user_turn
      THEN GREATEST(v_effective_couple_cap - COALESCE(v_couple_count, 0), 0)
      ELSE NULL::integer
    END,
    LEAST(
      GREATEST(v_effective_global_cap - v_global_count, 0),
      GREATEST(v_effective_couple_provider_cap - v_couple_provider_count, 0)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.check_amora_usage(uuid, integer, integer, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_amora_usage(uuid, integer, integer, boolean)
  TO service_role;

CREATE OR REPLACE FUNCTION public.mark_amora_provider_started(
  p_request_key text,
  p_request_hash text,
  p_provider_ordinal integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_state text;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_provider_ordinal NOT IN (0, 1) THEN RETURN false; END IF;

  UPDATE public.amora_usage_reservations reservation
  SET provider_state = 'started', updated_at = now()
  WHERE reservation.request_key = p_request_key
    AND reservation.request_hash = p_request_hash
    AND reservation.provider_ordinal = p_provider_ordinal
    AND reservation.provider_state = 'reserved'
    AND EXISTS (
      SELECT 1 FROM public.amora_request_claims claim
      WHERE claim.request_key = p_request_key
        AND claim.request_hash = p_request_hash
        AND claim.status = 'in_progress'
        AND claim.lease_expires_at > now()
    );

  SELECT provider_state INTO v_state
  FROM public.amora_usage_reservations
  WHERE request_key = p_request_key
    AND request_hash = p_request_hash
    AND provider_ordinal = p_provider_ordinal;
  RETURN v_state IN ('started', 'completed');
END;
$$;
REVOKE ALL ON FUNCTION public.mark_amora_provider_started(text, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_amora_provider_started(text, text, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.fail_amora_chat_request(
  p_request_key text,
  p_request_hash text,
  p_reason text DEFAULT NULL
)
RETURNS TABLE(final_status text, message_id uuid, visible_refunded boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim public.amora_request_claims%ROWTYPE;
  v_reservation public.amora_usage_reservations%ROWTYPE;
  v_couple_id uuid;
  v_couple_key text;
  v_couple_provider_key text;
  v_counter_key text;
  v_failure_code text;
  v_refunded boolean := false;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
    AND session_user NOT IN ('postgres', 'supabase_admin')
  THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_claim
  FROM public.amora_request_claims
  WHERE request_key = p_request_key
  FOR UPDATE;

  IF NOT FOUND OR v_claim.request_hash <> p_request_hash THEN
    RAISE EXCEPTION 'request_claim_mismatch' USING ERRCODE = 'P0001';
  END IF;

  v_failure_code := CASE
    WHEN p_reason IN (
      'preflight_denied', 'provider_limit', 'aborted', 'timeout',
      'input_too_large', 'provider_error', 'tool_error',
      'authorization_changed', 'stale_lease', 'request_failed', 'completed'
    ) THEN p_reason
    ELSE 'request_failed'
  END;

  IF v_claim.status = 'completed' THEN
    UPDATE public.amora_usage_reservations
    SET provider_state = 'completed',
        visible_state = CASE WHEN counted_user_turn THEN 'consumed' ELSE visible_state END,
        updated_at = now()
    WHERE request_key = p_request_key;
    RETURN QUERY SELECT 'completed'::text, v_claim.message_id, false;
    RETURN;
  END IF;

  -- Match reserve_amora_usage_v2's global -> couple-provider -> visible-couple
  -- -> reservation lock order. The previous visible-first settlement could
  -- deadlock with another request reserving a slot for the same couple.
  FOR v_counter_key IN
    SELECT DISTINCT reservation.global_counter_key
    FROM public.amora_usage_reservations reservation
    WHERE reservation.request_key = p_request_key
    ORDER BY reservation.global_counter_key
  LOOP
    PERFORM 1
    FROM public.amora_turn_counters
    WHERE key = v_counter_key
    FOR UPDATE;
  END LOOP;

  FOR v_counter_key IN
    SELECT DISTINCT
      'couple:provider_calls:' || reservation.couple_id::text || ':'
      || split_part(reservation.global_counter_key, ':', 3) AS counter_key
    FROM public.amora_usage_reservations reservation
    WHERE reservation.request_key = p_request_key
    ORDER BY counter_key
  LOOP
    PERFORM 1
    FROM public.amora_turn_counters
    WHERE key = v_counter_key
    FOR UPDATE;
  END LOOP;

  SELECT reservation.couple_id INTO v_couple_id
  FROM public.amora_usage_reservations reservation
  WHERE reservation.request_key = p_request_key
  ORDER BY reservation.provider_ordinal
  LIMIT 1;
  IF FOUND THEN
    v_couple_key := 'couple:user_turns:' || v_couple_id::text;
    PERFORM 1
    FROM public.amora_turn_counters
    WHERE key = v_couple_key
    FOR UPDATE;
  END IF;

  PERFORM reservation.provider_ordinal
  FROM public.amora_usage_reservations reservation
  WHERE reservation.request_key = p_request_key
  ORDER BY reservation.provider_ordinal
  FOR UPDATE;

  SELECT * INTO v_reservation
  FROM public.amora_usage_reservations
  WHERE request_key = p_request_key
    AND counted_user_turn
    AND visible_state = 'pending'
  ORDER BY provider_ordinal
  LIMIT 1
  FOR UPDATE;

  IF FOUND
  THEN
    UPDATE public.amora_turn_counters
    SET count = GREATEST(count - 1, 0), updated_at = now()
    WHERE key = v_couple_key;

    UPDATE public.amora_usage_reservations
    SET visible_state = 'refunded',
        failure_reason = v_failure_code,
        updated_at = now()
    WHERE request_key = p_request_key
      AND provider_ordinal = v_reservation.provider_ordinal;
    v_refunded := true;
  END IF;

  FOR v_reservation IN
    SELECT * FROM public.amora_usage_reservations
    WHERE request_key = p_request_key
    ORDER BY provider_ordinal
    FOR UPDATE
  LOOP
    IF v_reservation.provider_state = 'reserved' THEN
      UPDATE public.amora_turn_counters
      SET count = GREATEST(count - 1, 0), updated_at = now()
      WHERE key = v_reservation.global_counter_key;

      v_couple_provider_key :=
        'couple:provider_calls:' || v_reservation.couple_id::text || ':'
        || split_part(v_reservation.global_counter_key, ':', 3);
      UPDATE public.amora_turn_counters
      SET count = GREATEST(count - 1, 0), updated_at = now()
      WHERE key = v_couple_provider_key;

      UPDATE public.amora_usage_reservations
      SET provider_state = 'failed_unstarted',
          failure_reason = v_failure_code,
          updated_at = now()
      WHERE request_key = v_reservation.request_key
        AND provider_ordinal = v_reservation.provider_ordinal;
    ELSIF v_reservation.provider_state = 'started' THEN
      UPDATE public.amora_usage_reservations
      SET provider_state = 'failed_unknown',
          failure_reason = v_failure_code,
          updated_at = now()
      WHERE request_key = v_reservation.request_key
        AND provider_ordinal = v_reservation.provider_ordinal;
    END IF;
  END LOOP;

  -- Settle counters and reservation states before exposing the failed claim.
  -- The status trigger below is the last-resort path for any direct failed
  -- transition; ordering this update last preserves the specific failure code
  -- and makes normal reconciliation idempotent when that trigger re-enters.
  IF v_claim.status = 'in_progress' THEN
    UPDATE public.amora_request_claims
    SET status = 'failed', updated_at = now()
    WHERE request_key = p_request_key
      AND request_hash = p_request_hash
      AND status = 'in_progress';
  END IF;

  RETURN QUERY SELECT 'failed'::text, NULL::uuid, v_refunded;
END;
$$;

REVOKE ALL ON FUNCTION public.fail_amora_chat_request(text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_amora_chat_request(text, text, text)
  TO service_role;

-- A direct in_progress -> failed fallback must never strand a pending visible
-- turn or an unstarted provider counter. Normal failure reconciliation settles
-- first and updates the claim last; direct updates are reconciled here with a
-- bounded generic reason. The nested call does not recurse because the claim is
-- already failed and fail_amora_chat_request only updates in_progress claims.
CREATE OR REPLACE FUNCTION public.settle_amora_reservations_on_claim_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    UPDATE public.amora_usage_reservations
    SET provider_state = 'completed',
        visible_state = CASE WHEN counted_user_turn THEN 'consumed' ELSE visible_state END,
        updated_at = now()
    WHERE request_key = NEW.request_key
      AND request_hash = NEW.request_hash;
  ELSIF NEW.status = 'failed'
    AND OLD.status = 'in_progress'
    AND EXISTS (
      SELECT 1
      FROM public.amora_usage_reservations reservation
      WHERE reservation.request_key = NEW.request_key
        AND reservation.request_hash = NEW.request_hash
        AND (
          reservation.visible_state = 'pending'
          OR reservation.provider_state IN ('reserved', 'started')
        )
    )
  THEN
    PERFORM 1
    FROM public.fail_amora_chat_request(
      NEW.request_key,
      NEW.request_hash,
      'request_failed'
    )
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.settle_amora_reservations_on_claim_status()
  FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_settle_amora_reservations_on_claim_completion
  ON public.amora_request_claims;
DROP FUNCTION IF EXISTS public.settle_amora_reservations_on_claim_completion();
DROP TRIGGER IF EXISTS trg_settle_amora_reservations_on_claim_status
  ON public.amora_request_claims;
CREATE TRIGGER trg_settle_amora_reservations_on_claim_status
  AFTER UPDATE OF status ON public.amora_request_claims
  FOR EACH ROW EXECUTE FUNCTION public.settle_amora_reservations_on_claim_status();

CREATE OR REPLACE FUNCTION public.expire_stale_amora_chat_request(
  p_request_key text,
  p_request_hash text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_lease_expires_at timestamptz;
  v_final_status text;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  SELECT status, lease_expires_at
  INTO v_status, v_lease_expires_at
  FROM public.amora_request_claims
  WHERE request_key = p_request_key
    AND request_hash = p_request_hash;
  IF NOT FOUND OR v_status <> 'in_progress' OR v_lease_expires_at > now() THEN
    RETURN false;
  END IF;

  SELECT final_status INTO v_final_status
  FROM public.fail_amora_chat_request(p_request_key, p_request_hash, 'stale_lease');
  RETURN v_final_status = 'failed';
END;
$$;
REVOKE ALL ON FUNCTION public.expire_stale_amora_chat_request(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_amora_chat_request(text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_stale_amora_chat_requests(
  p_batch_limit integer DEFAULT 100
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim record;
  v_final_status text;
  v_reconciled integer := 0;
  v_batch_limit integer := LEAST(GREATEST(COALESCE(p_batch_limit, 100), 1), 500);
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
    AND session_user NOT IN ('postgres', 'supabase_admin')
  THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;

  FOR v_claim IN
    SELECT claim.request_key, claim.request_hash
    FROM public.amora_request_claims claim
    WHERE claim.status = 'in_progress'
      AND claim.lease_expires_at <= now()
    ORDER BY claim.lease_expires_at, claim.request_key
    LIMIT v_batch_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT final_status INTO v_final_status
    FROM public.fail_amora_chat_request(
      v_claim.request_key,
      v_claim.request_hash,
      'stale_lease'
    );
    IF v_final_status = 'failed' THEN
      v_reconciled := v_reconciled + 1;
    END IF;
  END LOOP;

  RETURN v_reconciled;
END;
$$;
REVOKE ALL ON FUNCTION public.reconcile_stale_amora_chat_requests(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_stale_amora_chat_requests(integer)
  TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id
  FROM cron.job
  WHERE jobname = 'reconcile-stale-amora-chat-requests'
  LIMIT 1;
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;
  PERFORM cron.schedule(
    'reconcile-stale-amora-chat-requests',
    '*/5 * * * *',
    'SELECT public.reconcile_stale_amora_chat_requests(100);'
  );
END;
$$;

COMMENT ON TABLE public.amora_usage_reservations IS
  'Idempotent per-request provider reservations; contains HMAC identifiers, not conversation text.';
COMMENT ON FUNCTION public.reserve_amora_usage_v2(
  uuid, integer, integer, boolean, text, text, integer
) IS 'Atomically reserves one Luna/Terra count-and-generation slot with hard 30 visible, 60 global daily, and 20 per-couple daily ceilings.';
COMMENT ON FUNCTION public.fail_amora_chat_request(text, text, text) IS
  'Atomically reconciles completed claims or fails a request and refunds only its pending visible consultation.';
COMMENT ON FUNCTION public.reconcile_stale_amora_chat_requests(integer) IS
  'Settles expired in-progress Amora claims in bounded SKIP LOCKED batches so crashed requests cannot strand visible quota or unstarted provider counters.';
