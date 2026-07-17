-- Durable, serialized schedule/budget projection for vendor bookings.
--
-- The trigger records the desired projection state in the same transaction as
-- vendor_bookings INSERT/cancellation. Workers claim one job per couple, and a
-- generation token prevents a stale create projection from acknowledging a
-- newer cancellation. Projection itself mutates one booking event/contribution
-- while holding the wedding_journeys row lock; callers never replace a stale
-- __events array.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.booking_projection_jobs (
  booking_id uuid PRIMARY KEY
    REFERENCES public.vendor_bookings(id) ON DELETE CASCADE,
  couple_id uuid NOT NULL
    REFERENCES public.couples(id) ON DELETE CASCADE,
  desired_state text NOT NULL
    CHECK (desired_state IN ('active', 'cancelled')),
  generation bigint NOT NULL DEFAULT 1
    CHECK (generation > 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0
    CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  claim_token uuid,
  completed_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS booking_projection_jobs_ready_idx
  ON public.booking_projection_jobs (available_at, created_at)
  WHERE status = 'pending';

-- A journey is a single JSONB aggregate. Never allow two workers to project
-- different bookings for the same couple at the same time.
CREATE UNIQUE INDEX IF NOT EXISTS booking_projection_jobs_one_processing_per_couple
  ON public.booking_projection_jobs (couple_id)
  WHERE status = 'processing';

ALTER TABLE public.booking_projection_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_projection_jobs FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.booking_projection_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.booking_projection_jobs TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_booking_projection_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_desired_state text;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.actual_amount IS NOT DISTINCT FROM OLD.actual_amount THEN
    RETURN NEW;
  END IF;

  -- A non-cancellation status label does not change the desired projection by
  -- itself. actual_amount is different: it replaces the quoted contribution
  -- and must always create durable projection work.
  IF TG_OP = 'UPDATE'
     AND NEW.actual_amount IS NOT DISTINCT FROM OLD.actual_amount
     AND NEW.status IS DISTINCT FROM 'cancelled'
     AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    RETURN NEW;
  END IF;

  v_desired_state := CASE
    WHEN NEW.status = 'cancelled' THEN 'cancelled'
    ELSE 'active'
  END;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.booking_projection_jobs (
      booking_id,
      couple_id,
      desired_state
    ) VALUES (
      NEW.id,
      NEW.couple_id,
      v_desired_state
    )
    ON CONFLICT (booking_id) DO NOTHING;
    RETURN NEW;
  END IF;

  INSERT INTO public.booking_projection_jobs (
    booking_id,
    couple_id,
    desired_state
  ) VALUES (
    NEW.id,
    NEW.couple_id,
    v_desired_state
  )
  ON CONFLICT (booking_id) DO UPDATE
  SET couple_id = EXCLUDED.couple_id,
      desired_state = EXCLUDED.desired_state,
      generation = public.booking_projection_jobs.generation + 1,
      -- Preserve the lease while an older generation is running. Its finish
      -- call will observe the generation mismatch and release this row back to
      -- pending. This avoids concurrent active/cancelled projection workers.
      status = CASE
        WHEN public.booking_projection_jobs.status = 'processing'
          THEN 'processing'
        ELSE 'pending'
      END,
      attempt_count = 0,
      available_at = now(),
      claimed_at = CASE
        WHEN public.booking_projection_jobs.status = 'processing'
          THEN public.booking_projection_jobs.claimed_at
        ELSE NULL
      END,
      claim_token = CASE
        WHEN public.booking_projection_jobs.status = 'processing'
          THEN public.booking_projection_jobs.claim_token
        ELSE NULL
      END,
      completed_at = NULL,
      last_error_code = NULL,
      updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vendor_bookings_projection_outbox
  ON public.vendor_bookings;
CREATE TRIGGER vendor_bookings_projection_outbox
AFTER INSERT OR UPDATE OF status, actual_amount ON public.vendor_bookings
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_booking_projection_job();

REVOKE ALL ON FUNCTION public.enqueue_booking_projection_job() FROM PUBLIC;

-- Repair the pre-migration gap as durable work. The projection RPC is
-- idempotent: an existing booking event/contribution is adopted without being
-- charged twice, while a genuinely missing projection is restored.
INSERT INTO public.booking_projection_jobs (
  booking_id,
  couple_id,
  desired_state
)
SELECT
  booking.id,
  booking.couple_id,
  CASE WHEN booking.status = 'cancelled' THEN 'cancelled' ELSE 'active' END
FROM public.vendor_bookings AS booking
ON CONFLICT (booking_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.claim_booking_projection_job(
  p_booking_id uuid DEFAULT NULL,
  p_lease_seconds integer DEFAULT 300
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.booking_projection_jobs%ROWTYPE;
  v_booking public.vendor_bookings%ROWTYPE;
  v_vendor record;
  v_claim_token uuid := gen_random_uuid();
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;

  IF p_lease_seconds < 30 OR p_lease_seconds > 900 THEN
    RAISE EXCEPTION 'invalid_projection_lease' USING ERRCODE = '22023';
  END IF;

  -- A crashed worker becomes retryable. Idempotent booking projections and the
  -- claim token make a late finish unable to acknowledge a reclaimed attempt.
  UPDATE public.booking_projection_jobs
  SET status = 'pending',
      available_at = now(),
      claimed_at = NULL,
      claim_token = NULL,
      completed_at = NULL,
      last_error_code = 'PROCESSING_LEASE_EXPIRED',
      updated_at = now()
  WHERE status = 'processing'
    AND claimed_at < now() - make_interval(secs => p_lease_seconds);

  SELECT candidate.*
  INTO v_job
  FROM public.booking_projection_jobs AS candidate
  JOIN public.couples AS projection_couple
    ON projection_couple.id = candidate.couple_id
  WHERE candidate.status = 'pending'
    AND candidate.available_at <= now()
    AND (p_booking_id IS NULL OR candidate.booking_id = p_booking_id)
    AND NOT EXISTS (
      SELECT 1
      FROM public.booking_projection_jobs AS running
      WHERE running.couple_id = candidate.couple_id
        AND running.status = 'processing'
    )
  ORDER BY candidate.available_at, candidate.created_at, candidate.booking_id
  -- Lock the couple row as well as the candidate. Two concurrent claimers can
  -- otherwise select two different pending jobs for one couple before either
  -- transaction creates the partial-index processing row.
  FOR UPDATE OF candidate, projection_couple SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.booking_projection_jobs
  SET status = 'processing',
      attempt_count = attempt_count + 1,
      claimed_at = now(),
      claim_token = v_claim_token,
      completed_at = NULL,
      updated_at = now()
  WHERE booking_id = v_job.booking_id
  RETURNING * INTO v_job;

  SELECT * INTO v_booking
  FROM public.vendor_bookings
  WHERE id = v_job.booking_id;

  SELECT name, category INTO v_vendor
  FROM public.vendors
  WHERE id = v_booking.vendor_id;

  IF v_booking.id IS NULL OR NOT FOUND THEN
    RAISE EXCEPTION 'booking_projection_context_missing' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'bookingId', v_job.booking_id,
    'coupleId', v_job.couple_id,
    'desiredState', v_job.desired_state,
    'generation', v_job.generation,
    'attemptCount', v_job.attempt_count,
    'claimToken', v_job.claim_token,
    'booking', jsonb_build_object(
      'date', v_booking.booking_date::text,
      'time', to_char(v_booking.booking_time, 'HH24:MI'),
      -- Once an outcome is recorded it becomes the canonical budget
      -- contribution. Keeping this choice in the claim prevents an HTTP
      -- handler snapshot from becoming the source of truth.
      'amount', COALESCE(v_booking.actual_amount, v_booking.amount, 0),
      'status', v_booking.status,
      'vendorId', v_booking.vendor_id,
      'productId', v_booking.product_id,
      'staffId', v_booking.staff_id,
      'vendorName', COALESCE(v_vendor.name, '업체'),
      'vendorCategory', v_vendor.category
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_booking_projection_job(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_booking_projection_job(uuid, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.finish_booking_projection_job(
  p_booking_id uuid,
  p_generation bigint,
  p_claim_token uuid,
  p_succeeded boolean,
  p_error_code text DEFAULT NULL,
  p_max_attempts integer DEFAULT 8
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.booking_projection_jobs%ROWTYPE;
  v_delay_seconds integer;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;

  IF p_max_attempts < 1 OR p_max_attempts > 20 THEN
    RAISE EXCEPTION 'invalid_projection_max_attempts' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_job
  FROM public.booking_projection_jobs
  WHERE booking_id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'accepted', false,
      'reason', 'not_found',
      'status', 'missing'
    );
  END IF;

  IF v_job.status <> 'processing'
     OR v_job.claim_token IS DISTINCT FROM p_claim_token THEN
    RETURN jsonb_build_object(
      'accepted', false,
      'reason', 'stale_claim',
      'status', v_job.status
    );
  END IF;

  IF v_job.generation <> p_generation THEN
    UPDATE public.booking_projection_jobs
    SET status = 'pending',
        available_at = now(),
        claimed_at = NULL,
        claim_token = NULL,
        completed_at = NULL,
        last_error_code = 'SUPERSEDED_BY_NEWER_BOOKING_STATE',
        updated_at = now()
    WHERE booking_id = p_booking_id;

    RETURN jsonb_build_object(
      'accepted', false,
      'reason', 'superseded',
      'status', 'pending'
    );
  END IF;

  IF p_succeeded THEN
    UPDATE public.booking_projection_jobs
    SET status = 'completed',
        claimed_at = NULL,
        claim_token = NULL,
        completed_at = now(),
        last_error_code = NULL,
        updated_at = now()
    WHERE booking_id = p_booking_id;

    RETURN jsonb_build_object(
      'accepted', true,
      'status', 'completed'
    );
  END IF;

  IF v_job.attempt_count >= p_max_attempts THEN
    UPDATE public.booking_projection_jobs
    SET status = 'failed',
        claimed_at = NULL,
        claim_token = NULL,
        completed_at = NULL,
        last_error_code = left(COALESCE(p_error_code, 'PROJECTION_FAILED'), 160),
        updated_at = now()
    WHERE booking_id = p_booking_id;

    RETURN jsonb_build_object(
      'accepted', true,
      'status', 'failed',
      'retryable', false,
      'attemptCount', v_job.attempt_count
    );
  END IF;

  v_delay_seconds := least(
    900,
    (5 * power(2::numeric, greatest(v_job.attempt_count - 1, 0)))::integer
  );

  UPDATE public.booking_projection_jobs
  SET status = 'pending',
      available_at = now() + make_interval(secs => v_delay_seconds),
      claimed_at = NULL,
      claim_token = NULL,
      completed_at = NULL,
      last_error_code = left(COALESCE(p_error_code, 'PROJECTION_FAILED'), 160),
      updated_at = now()
  WHERE booking_id = p_booking_id;

  RETURN jsonb_build_object(
    'accepted', true,
    'status', 'pending',
    'retryable', true,
    'attemptCount', v_job.attempt_count,
    'retryAfterSeconds', v_delay_seconds
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finish_booking_projection_job(
  uuid, bigint, uuid, boolean, text, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_booking_projection_job(
  uuid, bigint, uuid, boolean, text, integer
) TO service_role;

CREATE OR REPLACE FUNCTION public.get_booking_projection_queue_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pending integer;
  v_processing integer;
  v_failed integer;
  v_oldest_active_age_seconds integer;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;

  SELECT
    count(*) FILTER (WHERE status = 'pending')::integer,
    count(*) FILTER (WHERE status = 'processing')::integer,
    count(*) FILTER (WHERE status = 'failed')::integer,
    COALESCE(
      floor(extract(epoch FROM now() - min(created_at) FILTER (
        WHERE status IN ('pending', 'processing')
      )))::integer,
      0
    )
  INTO v_pending, v_processing, v_failed, v_oldest_active_age_seconds
  FROM public.booking_projection_jobs;

  RETURN jsonb_build_object(
    'pending', v_pending,
    'processing', v_processing,
    'failed', v_failed,
    'activeBacklog', v_pending + v_processing,
    'oldestActiveAgeSeconds', greatest(v_oldest_active_age_seconds, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_booking_projection_queue_stats()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_booking_projection_queue_stats()
  TO service_role;

CREATE OR REPLACE FUNCTION public.retry_booking_projection_job(
  p_booking_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status text;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.booking_projection_jobs
  SET status = 'pending',
      attempt_count = 0,
      available_at = now(),
      claimed_at = NULL,
      claim_token = NULL,
      completed_at = NULL,
      last_error_code = NULL,
      updated_at = now()
  WHERE booking_id = p_booking_id
    AND status = 'failed'
  RETURNING status INTO v_status;

  IF FOUND THEN
    RETURN jsonb_build_object('replayed', true, 'status', v_status);
  END IF;

  SELECT status INTO v_status
  FROM public.booking_projection_jobs
  WHERE booking_id = p_booking_id;
  RETURN jsonb_build_object(
    'replayed', false,
    'status', COALESCE(v_status, 'missing')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.retry_booking_projection_job(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retry_booking_projection_job(uuid)
  TO service_role;

-- Atomic event/contribution projection. This function deliberately accepts a
-- single event, not an __events snapshot, so unrelated schedules written after
-- the caller started cannot be lost.
CREATE OR REPLACE FUNCTION public.apply_booking_progress_projection(
  p_couple_id uuid,
  p_booking_id uuid,
  p_desired_state text,
  p_event jsonb,
  p_category_key text,
  p_amount numeric,
  p_generation bigint,
  p_claim_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.booking_projection_jobs%ROWTYPE;
  v_progress jsonb;
  v_events jsonb;
  v_costs jsonb;
  v_existing_event jsonb;
  v_next_event jsonb;
  v_event_id text := 'evt_booking_' || p_booking_id::text;
  v_legacy_event_id text := 'evt_booking_' || left(p_booking_id::text, 8);
  v_source_key text := 'booking:' || p_booking_id::text;
  v_category_key text := NULLIF(btrim(COALESCE(p_category_key, '')), '');
  v_existing_category_key text;
  v_stored_category_key text;
  v_previous_category_key text;
  v_stored_cost jsonb;
  v_quoted_contribution numeric := 0;
  v_previous_contribution numeric := 0;
  v_next_contribution numeric := greatest(COALESCE(p_amount, 0), 0);
  v_delta numeric := 0;
  v_previous_spent numeric := 0;
  v_next_spent numeric := 0;
  v_budget numeric := 0;
  v_has_stored_contribution boolean := false;
  v_schedule_added boolean := false;
  v_schedule_updated boolean := false;
  v_schedule_removed boolean := false;
  v_budget_updated boolean := false;
  v_budget_reverted boolean := false;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;

  IF p_desired_state NOT IN ('active', 'cancelled') THEN
    RAISE EXCEPTION 'invalid_booking_projection_state' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_job
  FROM public.booking_projection_jobs
  WHERE booking_id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'accepted', false,
      'reason', 'not_found',
      'status', 'missing'
    );
  END IF;

  IF v_job.status <> 'processing'
     OR v_job.claim_token IS DISTINCT FROM p_claim_token THEN
    RETURN jsonb_build_object(
      'accepted', false,
      'reason', 'stale_claim',
      'status', v_job.status
    );
  END IF;

  IF v_job.generation <> p_generation
     OR v_job.desired_state <> p_desired_state THEN
    UPDATE public.booking_projection_jobs
    SET status = 'pending',
        available_at = now(),
        claimed_at = NULL,
        claim_token = NULL,
        completed_at = NULL,
        last_error_code = 'SUPERSEDED_BY_NEWER_BOOKING_STATE',
        updated_at = now()
    WHERE booking_id = p_booking_id;

    RETURN jsonb_build_object(
      'accepted', false,
      'reason', 'superseded',
      'status', 'pending'
    );
  END IF;

  IF v_job.couple_id <> p_couple_id THEN
    RAISE EXCEPTION 'booking_projection_claim_mismatch' USING ERRCODE = '22023';
  END IF;

  -- Legacy schedule projections were created from vendor_bookings.amount (the
  -- quote), before the structured __booking_costs ledger existed. Keep that
  -- source distinct from p_amount, which is the desired canonical amount and
  -- may now be actual_amount. Without this distinction a quote of 500 followed
  -- by an actual amount of 300 would adopt 300 as the prior contribution,
  -- leaving 200 of ghost spend in the journey budget.
  SELECT greatest(COALESCE(amount, 0), 0)
  INTO v_quoted_contribution
  FROM public.vendor_bookings
  WHERE id = p_booking_id
    AND couple_id = p_couple_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking_projection_context_missing' USING ERRCODE = 'P0002';
  END IF;

  IF v_category_key IS NOT NULL
     AND (length(v_category_key) > 80 OR left(v_category_key, 2) = '__') THEN
    RAISE EXCEPTION 'invalid_booking_projection_category' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(progress, '{}'::jsonb)
  INTO v_progress
  FROM public.wedding_journeys
  WHERE couple_id = p_couple_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'journey_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_events := CASE
    WHEN jsonb_typeof(v_progress -> '__events') = 'array'
      THEN v_progress -> '__events'
    ELSE '[]'::jsonb
  END;
  v_costs := CASE
    WHEN jsonb_typeof(v_progress -> '__booking_costs') = 'object'
      THEN v_progress -> '__booking_costs'
    ELSE '{}'::jsonb
  END;

  SELECT event
  INTO v_existing_event
  FROM jsonb_array_elements(v_events) AS event
  WHERE event ->> 'id' IN (v_event_id, v_legacy_event_id)
     OR event ->> 'sourceKey' = v_source_key
  LIMIT 1;

  v_existing_category_key := NULLIF(
    btrim(COALESCE(v_existing_event ->> 'categoryKey', '')),
    ''
  );
  IF v_existing_category_key IS NOT NULL
     AND (length(v_existing_category_key) > 80 OR left(v_existing_category_key, 2) = '__') THEN
    v_existing_category_key := NULL;
  END IF;

  v_has_stored_contribution := v_costs ? p_booking_id::text;
  v_stored_cost := v_costs -> p_booking_id::text;
  IF v_has_stored_contribution
     AND jsonb_typeof(v_stored_cost) = 'object'
     AND (v_stored_cost ->> 'amount') ~ '^[0-9]+([.][0-9]+)?$' THEN
    v_previous_contribution := (v_stored_cost ->> 'amount')::numeric;
    v_stored_category_key := NULLIF(
      btrim(COALESCE(v_stored_cost ->> 'categoryKey', '')),
      ''
    );
  ELSIF v_has_stored_contribution
     AND (v_costs ->> p_booking_id::text) ~ '^[0-9]+([.][0-9]+)?$' THEN
    -- Backward compatibility for the pre-structured numeric ledger.
    v_previous_contribution := (v_costs ->> p_booking_id::text)::numeric;
  ELSIF v_existing_event IS NOT NULL THEN
    -- Legacy projections predate __booking_costs. The existing event proves the
    -- quoted booking amount was already counted. The desired contribution may
    -- now be a lower or higher actual amount and must be applied as a delta.
    v_previous_contribution := v_quoted_contribution;
  END IF;
  IF v_stored_category_key IS NOT NULL
     AND (length(v_stored_category_key) > 80 OR left(v_stored_category_key, 2) = '__') THEN
    v_stored_category_key := NULL;
  END IF;
  v_previous_category_key := COALESCE(
    v_stored_category_key,
    v_existing_category_key
  );

  IF p_desired_state = 'active' THEN
    IF jsonb_typeof(p_event) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'booking_projection_event_required' USING ERRCODE = '22023';
    END IF;

    v_next_event := p_event || jsonb_build_object(
      'id', v_event_id,
      'sourceKey', v_source_key,
      'createdAt', COALESCE(
        v_existing_event -> 'createdAt',
        p_event -> 'createdAt',
        to_jsonb(now()::text)
      ),
      'updatedAt', COALESCE(p_event -> 'updatedAt', to_jsonb(now()::text))
    );

    SELECT COALESCE(jsonb_agg(event ORDER BY ordinality), '[]'::jsonb)
    INTO v_events
    FROM jsonb_array_elements(v_events) WITH ORDINALITY AS source(event, ordinality)
    WHERE COALESCE(event ->> 'id', '') NOT IN (v_event_id, v_legacy_event_id)
      AND COALESCE(event ->> 'sourceKey', '') <> v_source_key;
    v_events := v_events || jsonb_build_array(v_next_event);
    v_schedule_added := v_existing_event IS NULL;
    v_schedule_updated := v_existing_event IS NOT NULL;

    -- If a vendor category changed, reverse the old category contribution
    -- before applying the booking to the current one.
    IF v_previous_category_key IS NOT NULL
       AND v_previous_category_key IS DISTINCT FROM v_category_key THEN
      v_previous_spent := CASE
        WHEN (v_progress -> v_previous_category_key ->> 'spent') ~ '^[0-9]+([.][0-9]+)?$'
          THEN (v_progress -> v_previous_category_key ->> 'spent')::numeric
        ELSE 0
      END;
      v_progress := jsonb_set(
        v_progress,
        ARRAY[v_previous_category_key],
        CASE
          WHEN jsonb_typeof(v_progress -> v_previous_category_key) = 'object'
            THEN v_progress -> v_previous_category_key
          ELSE '{}'::jsonb
        END
          || jsonb_build_object(
            'spent', greatest(0, v_previous_spent - v_previous_contribution)
          ),
        true
      );
      v_previous_contribution := 0;
    END IF;

    IF v_category_key IS NOT NULL THEN
      v_delta := v_next_contribution - v_previous_contribution;
      v_previous_spent := CASE
        WHEN (v_progress -> v_category_key ->> 'spent') ~ '^[0-9]+([.][0-9]+)?$'
          THEN (v_progress -> v_category_key ->> 'spent')::numeric
        ELSE 0
      END;
      v_budget := CASE
        WHEN (v_progress -> v_category_key ->> 'budget') ~ '^[0-9]+([.][0-9]+)?$'
          THEN (v_progress -> v_category_key ->> 'budget')::numeric
        ELSE 0
      END;
      v_next_spent := greatest(0, v_previous_spent + v_delta);
      IF v_delta <> 0 THEN
        v_progress := jsonb_set(
          v_progress,
          ARRAY[v_category_key],
          CASE
            WHEN jsonb_typeof(v_progress -> v_category_key) = 'object'
              THEN v_progress -> v_category_key
            ELSE '{}'::jsonb
          END
            || jsonb_build_object('spent', v_next_spent),
          true
        );
        v_budget_updated := true;
      END IF;
    END IF;

    v_costs := jsonb_set(
      v_costs,
      ARRAY[p_booking_id::text],
      jsonb_build_object(
        'amount', CASE
          WHEN v_category_key IS NULL THEN 0::numeric
          ELSE v_next_contribution
        END,
        'categoryKey', v_category_key
      ),
      true
    );
  ELSE
    SELECT COALESCE(jsonb_agg(event ORDER BY ordinality), '[]'::jsonb)
    INTO v_events
    FROM jsonb_array_elements(v_events) WITH ORDINALITY AS source(event, ordinality)
    WHERE COALESCE(event ->> 'id', '') NOT IN (v_event_id, v_legacy_event_id)
      AND COALESCE(event ->> 'sourceKey', '') <> v_source_key;
    v_schedule_removed := v_existing_event IS NOT NULL;
    v_costs := v_costs - p_booking_id::text;

    IF v_previous_category_key IS NOT NULL THEN
      v_category_key := v_previous_category_key;
    END IF;

    IF v_category_key IS NOT NULL AND v_previous_contribution > 0 THEN
      v_previous_spent := CASE
        WHEN (v_progress -> v_category_key ->> 'spent') ~ '^[0-9]+([.][0-9]+)?$'
          THEN (v_progress -> v_category_key ->> 'spent')::numeric
        ELSE 0
      END;
      v_budget := CASE
        WHEN (v_progress -> v_category_key ->> 'budget') ~ '^[0-9]+([.][0-9]+)?$'
          THEN (v_progress -> v_category_key ->> 'budget')::numeric
        ELSE 0
      END;
      v_next_spent := greatest(0, v_previous_spent - v_previous_contribution);
      v_progress := jsonb_set(
        v_progress,
        ARRAY[v_category_key],
        CASE
          WHEN jsonb_typeof(v_progress -> v_category_key) = 'object'
            THEN v_progress -> v_category_key
          ELSE '{}'::jsonb
        END
          || jsonb_build_object('spent', v_next_spent),
        true
      );
      v_budget_reverted := true;
    END IF;
  END IF;

  v_progress := jsonb_set(v_progress, '{__events}', v_events, true);
  v_progress := jsonb_set(v_progress, '{__booking_costs}', v_costs, true);

  UPDATE public.wedding_journeys
  SET progress = v_progress,
      updated_at = now()
  WHERE couple_id = p_couple_id;

  -- Acknowledge the exact claimed generation in the same transaction as the
  -- journey write. A worker can therefore never publish a stale projection and
  -- discover only afterwards that a newer booking state superseded it.
  UPDATE public.booking_projection_jobs
  SET status = 'completed',
      claimed_at = NULL,
      claim_token = NULL,
      completed_at = now(),
      last_error_code = NULL,
      updated_at = now()
  WHERE booking_id = p_booking_id;

  RETURN jsonb_build_object(
    'accepted', true,
    'status', 'completed',
    'progress', v_progress,
    'event', CASE WHEN p_desired_state = 'active' THEN v_next_event ELSE NULL END,
    'scheduleAdded', v_schedule_added,
    'scheduleUpdated', v_schedule_updated,
    'scheduleRemoved', v_schedule_removed,
    'budgetUpdated', v_budget_updated,
    'budgetReverted', v_budget_reverted,
    'budgetDelta', CASE
      WHEN p_desired_state = 'active' THEN v_delta
      ELSE -v_previous_contribution
    END,
    'budgetExceededBy', CASE
      WHEN v_budget > 0 AND v_next_spent > v_budget THEN v_next_spent - v_budget
      ELSE 0
    END,
    'categoryBudgetLimit', v_budget,
    'categoryKey', v_category_key,
    'newSpent', CASE
      WHEN v_budget_updated OR v_budget_reverted THEN v_next_spent
      ELSE NULL
    END,
    'revertedAmount', CASE
      WHEN p_desired_state = 'cancelled' THEN v_previous_contribution
      ELSE 0
    END,
    'removedEventId', CASE
      WHEN p_desired_state = 'cancelled' THEN v_existing_event ->> 'id'
      ELSE NULL
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_booking_progress_projection(
  uuid, uuid, text, jsonb, text, numeric, bigint, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_booking_progress_projection(
  uuid, uuid, text, jsonb, text, numeric, bigint, uuid
) TO service_role;

COMMENT ON TABLE public.booking_projection_jobs IS
  'Durable desired-state outbox for booking schedule/budget projection.';
COMMENT ON FUNCTION public.apply_booking_progress_projection(
  uuid, uuid, text, jsonb, text, numeric, bigint, uuid
) IS
  'Validates a claimed generation, atomically merges/removes one booking projection, and acknowledges that claim in the same transaction.';
