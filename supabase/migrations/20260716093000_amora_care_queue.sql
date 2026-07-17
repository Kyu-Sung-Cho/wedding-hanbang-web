-- Durable, consent-fenced outbound-care scan and delivery queue.
-- The feature remains disabled unless AMORA_CARE_OUTBOUND_ENABLED=true.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE INDEX IF NOT EXISTS wedding_journeys_care_scan_idx
  ON public.wedding_journeys (couple_id, id)
  WHERE couple_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.amora_care_scan_states (
  scan_day date PRIMARY KEY,
  status text NOT NULL DEFAULT 'scanning'
    CHECK (status IN ('scanning', 'completed', 'expired')),
  last_couple_id uuid,
  last_journey_id uuid,
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  scanned_count integer NOT NULL DEFAULT 0
    CHECK (scanned_count BETWEEN 0 AND 100000000),
  enqueued_count integer NOT NULL DEFAULT 0
    CHECK (enqueued_count BETWEEN 0 AND 100000000),
  lease_token uuid,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK ((last_couple_id IS NULL) = (last_journey_id IS NULL)),
  CHECK (
    (status = 'scanning' AND completed_at IS NULL)
    OR (status IN ('completed', 'expired') AND completed_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.amora_care_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  scan_day date NOT NULL,
  dedupe_key text NOT NULL CHECK (char_length(dedupe_key) BETWEEN 1 AND 200),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2000),
  email_subject text CHECK (email_subject IS NULL OR char_length(email_subject) BETWEEN 1 AND 300),
  email_html text CHECK (email_html IS NULL OR char_length(email_html) BETWEEN 1 AND 20000),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object' AND pg_column_size(metadata) <= 8192),
  roster_member_ids uuid[] NOT NULL
    CHECK (
      cardinality(roster_member_ids) BETWEEN 1 AND 2
      AND array_position(roster_member_ids, NULL) IS NULL
    ),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'expired', 'cancelled')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
  available_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  lease_token uuid,
  lease_expires_at timestamptz,
  chat_message_id uuid REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  last_error text CHECK (last_error IS NULL OR char_length(last_error) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (couple_id, dedupe_key),
  CHECK (
    (status IN ('pending', 'processing') AND completed_at IS NULL)
    OR (status IN ('completed', 'failed', 'expired', 'cancelled') AND completed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS amora_care_jobs_claim_idx
  ON public.amora_care_jobs (available_at, created_at, id)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS amora_care_jobs_scan_status_idx
  ON public.amora_care_jobs (scan_day, status);

CREATE INDEX IF NOT EXISTS amora_care_jobs_active_age_idx
  ON public.amora_care_jobs (created_at)
  WHERE status IN ('pending', 'processing');

CREATE TABLE IF NOT EXISTS public.amora_care_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.amora_care_jobs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  channel text NOT NULL DEFAULT 'email' CHECK (channel = 'email'),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'skipped', 'expired', 'cancelled')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
  available_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  recipient_email text CHECK (recipient_email IS NULL OR char_length(recipient_email) <= 320),
  recipient_name text CHECK (recipient_name IS NULL OR char_length(recipient_name) <= 200),
  idempotency_key text NOT NULL UNIQUE
    CHECK (char_length(idempotency_key) BETWEEN 1 AND 256),
  provider_message_id text CHECK (provider_message_id IS NULL OR char_length(provider_message_id) <= 300),
  -- Set atomically at claim time. Keeping the reservation even after a
  -- provider ambiguity prevents a second care email to the same person/day.
  send_day date,
  last_error text CHECK (last_error IS NULL OR char_length(last_error) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (job_id, user_id),
  CHECK (
    (status IN ('pending', 'processing') AND completed_at IS NULL)
    OR (status IN ('completed', 'failed', 'skipped', 'expired', 'cancelled') AND completed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS amora_care_deliveries_claim_idx
  ON public.amora_care_deliveries (job_id, available_at, user_id)
  WHERE status IN ('pending', 'processing');

CREATE UNIQUE INDEX IF NOT EXISTS amora_care_deliveries_user_send_day_uidx
  ON public.amora_care_deliveries (user_id, send_day)
  WHERE send_day IS NOT NULL;

-- Never turn a disabled profile back on while repairing historical mismatch.
-- A timestamp without an enabled flag is stale evidence and is cleared; an
-- enabled flag without evidence is disabled.
UPDATE public.profiles
SET care_notifications_enabled = (
      care_notifications_enabled = true
      AND care_notifications_consented_at IS NOT NULL
    ),
    care_notifications_consented_at = CASE
      WHEN care_notifications_enabled = true
        AND care_notifications_consented_at IS NOT NULL
        THEN care_notifications_consented_at
      ELSE NULL
    END
WHERE care_notifications_enabled IS DISTINCT FROM
      (care_notifications_consented_at IS NOT NULL);

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_care_consent_state_valid;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_care_consent_state_valid
  CHECK (
    care_notifications_enabled = (care_notifications_consented_at IS NOT NULL)
  ) NOT VALID;
ALTER TABLE public.profiles
  VALIDATE CONSTRAINT profiles_care_consent_state_valid;

ALTER TABLE public.amora_care_scan_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amora_care_scan_states FORCE ROW LEVEL SECURITY;
ALTER TABLE public.amora_care_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amora_care_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.amora_care_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amora_care_deliveries FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.amora_care_scan_states FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.amora_care_jobs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.amora_care_deliveries FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.amora_care_scan_states TO service_role;
GRANT ALL ON TABLE public.amora_care_jobs TO service_role;
GRANT ALL ON TABLE public.amora_care_deliveries TO service_role;

-- A no-argument, postgres-owned clock keeps the policy deterministic in DB
-- tests without allowing service callers to choose an arbitrary send time.
CREATE OR REPLACE FUNCTION public.amora_care_delivery_clock()
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
  SELECT statement_timestamp()
$function$;

CREATE OR REPLACE FUNCTION public.amora_care_is_delivery_window(
  p_at timestamptz
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
  SELECT (p_at AT TIME ZONE 'Asia/Seoul')::time >= TIME '09:00:00'
     AND (p_at AT TIME ZONE 'Asia/Seoul')::time < TIME '20:00:00'
$function$;

CREATE OR REPLACE FUNCTION public.amora_care_next_delivery_window(
  p_at timestamptz
)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
STRICT
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
  SELECT (
    CASE
      WHEN (p_at AT TIME ZONE 'Asia/Seoul')::time < TIME '09:00:00'
        THEN (p_at AT TIME ZONE 'Asia/Seoul')::date
      ELSE (p_at AT TIME ZONE 'Asia/Seoul')::date + 1
    END::date + TIME '09:00:00'
  ) AT TIME ZONE 'Asia/Seoul'
$function$;

CREATE OR REPLACE FUNCTION public.claim_amora_care_scan(
  p_scan_day date,
  p_lease_seconds integer DEFAULT 90
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_state public.amora_care_scan_states%ROWTYPE;
  v_token uuid := gen_random_uuid();
BEGIN
  IF p_scan_day IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 120 THEN
    RAISE EXCEPTION 'AMORA_CARE_SCAN_INVALID' USING ERRCODE = '22023';
  END IF;

  UPDATE public.amora_care_scan_states
  SET status = 'expired', completed_at = now(), updated_at = now(),
      lease_token = NULL, lease_expires_at = NULL
  WHERE status = 'scanning' AND scan_day < p_scan_day;

  INSERT INTO public.amora_care_scan_states(scan_day)
  VALUES (p_scan_day)
  ON CONFLICT (scan_day) DO NOTHING;

  SELECT * INTO v_state
  FROM public.amora_care_scan_states
  WHERE scan_day = p_scan_day
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', false, 'state', 'busy');
  END IF;
  IF v_state.status <> 'scanning' THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'state', v_state.status,
      'last_couple_id', v_state.last_couple_id,
      'last_journey_id', v_state.last_journey_id,
      'snapshot_at', v_state.snapshot_at
    );
  END IF;
  IF v_state.lease_expires_at IS NOT NULL AND v_state.lease_expires_at > now() THEN
    RETURN jsonb_build_object('claimed', false, 'state', 'busy');
  END IF;

  UPDATE public.amora_care_scan_states
  SET lease_token = v_token,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      updated_at = now()
  WHERE scan_day = p_scan_day
  RETURNING * INTO v_state;

  RETURN jsonb_build_object(
    'claimed', true,
    'state', 'scanning',
    'scan_day', v_state.scan_day,
    'last_couple_id', v_state.last_couple_id,
    'last_journey_id', v_state.last_journey_id,
    'snapshot_at', v_state.snapshot_at,
    'lease_token', v_state.lease_token
  );
END
$function$;

-- Consent writes must pass through set_amora_care_consent so withdrawal and
-- queued-payload scrubbing commit atomically. This guard also protects legacy
-- databases that still grant authenticated a table-level UPDATE privilege.
CREATE OR REPLACE FUNCTION public.prevent_direct_amora_care_consent_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF current_user IN ('anon', 'authenticated')
     AND (
       NEW.care_notifications_enabled IS DISTINCT FROM OLD.care_notifications_enabled
       OR NEW.care_notifications_consented_at IS DISTINCT FROM OLD.care_notifications_consented_at
     ) THEN
    RAISE EXCEPTION 'AMORA_CARE_CONSENT_DIRECT_UPDATE_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_prevent_direct_amora_care_consent_change ON public.profiles;
CREATE TRIGGER trg_prevent_direct_amora_care_consent_change
  BEFORE UPDATE OF care_notifications_enabled, care_notifications_consented_at
  ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_direct_amora_care_consent_change();

CREATE OR REPLACE FUNCTION public.advance_amora_care_scan(
  p_scan_day date,
  p_lease_token uuid,
  p_last_couple_id uuid,
  p_last_journey_id uuid,
  p_scanned_count integer,
  p_completed boolean,
  p_enqueued_count integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_state public.amora_care_scan_states%ROWTYPE;
BEGIN
  IF p_scan_day IS NULL OR p_lease_token IS NULL
     OR p_scanned_count NOT BETWEEN 0 AND 10000
     OR p_enqueued_count NOT BETWEEN 0 AND 100000
     OR (p_last_couple_id IS NULL) <> (p_last_journey_id IS NULL)
     OR (p_scanned_count > 0 AND p_last_couple_id IS NULL) THEN
    RAISE EXCEPTION 'AMORA_CARE_SCAN_ADVANCE_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_state
  FROM public.amora_care_scan_states
  WHERE scan_day = p_scan_day
  FOR UPDATE;

  IF NOT FOUND OR v_state.status <> 'scanning'
     OR v_state.lease_token IS DISTINCT FROM p_lease_token
     OR v_state.lease_expires_at <= now() THEN
    RAISE EXCEPTION 'AMORA_CARE_SCAN_LEASE_LOST' USING ERRCODE = '55000';
  END IF;
  IF p_last_couple_id IS NOT NULL AND v_state.last_couple_id IS NOT NULL
     AND (
       p_last_couple_id < v_state.last_couple_id
       OR (
         p_last_couple_id = v_state.last_couple_id
         AND p_last_journey_id <= v_state.last_journey_id
       )
     ) THEN
    RAISE EXCEPTION 'AMORA_CARE_SCAN_CURSOR_NOT_MONOTONIC' USING ERRCODE = '22023';
  END IF;

  UPDATE public.amora_care_scan_states
  SET last_couple_id = COALESCE(p_last_couple_id, last_couple_id),
      last_journey_id = COALESCE(p_last_journey_id, last_journey_id),
      scanned_count = scanned_count + p_scanned_count,
      enqueued_count = enqueued_count + p_enqueued_count,
      status = CASE WHEN p_completed THEN 'completed' ELSE 'scanning' END,
      completed_at = CASE WHEN p_completed THEN now() ELSE NULL END,
      lease_token = CASE WHEN p_completed THEN NULL ELSE lease_token END,
      lease_expires_at = CASE
        WHEN p_completed THEN NULL
        ELSE now() + interval '90 seconds'
      END,
      updated_at = now()
  WHERE scan_day = p_scan_day
  RETURNING * INTO v_state;

  RETURN jsonb_build_object(
    'state', v_state.status,
    'last_couple_id', v_state.last_couple_id,
    'last_journey_id', v_state.last_journey_id,
    'scanned_count', v_state.scanned_count,
    'enqueued_count', v_state.enqueued_count
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_amora_care_job(
  p_couple_id uuid,
  p_scan_day date,
  p_dedupe_key text,
  p_content text,
  p_metadata jsonb,
  p_email_subject text DEFAULT NULL,
  p_email_html text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_job public.amora_care_jobs%ROWTYPE;
  v_expires_at timestamptz;
  v_inserted boolean := false;
  v_bride_id uuid;
  v_groom_id uuid;
  v_roster_member_ids uuid[];
  v_policy_now timestamptz;
  v_available_at timestamptz;
  v_deferred boolean;
BEGIN
  IF p_couple_id IS NULL OR p_scan_day IS NULL
     OR char_length(p_dedupe_key) NOT BETWEEN 1 AND 200
     OR char_length(p_content) NOT BETWEEN 1 AND 2000
     OR (p_email_subject IS NULL) <> (p_email_html IS NULL)
     OR (p_email_subject IS NOT NULL AND char_length(p_email_subject) NOT BETWEEN 1 AND 300)
     OR (p_email_html IS NOT NULL AND char_length(p_email_html) NOT BETWEEN 1 AND 20000)
     OR jsonb_typeof(COALESCE(p_metadata, '{}'::jsonb)) <> 'object'
     OR pg_column_size(COALESCE(p_metadata, '{}'::jsonb)) > 8192 THEN
    RAISE EXCEPTION 'AMORA_CARE_JOB_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT bride_id, groom_id INTO v_bride_id, v_groom_id
  FROM public.couples
  WHERE id = p_couple_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_CARE_COUPLE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  SELECT COALESCE(array_agg(member_id ORDER BY member_id), ARRAY[]::uuid[])
  INTO v_roster_member_ids
  FROM (
    SELECT DISTINCT member_id
    FROM unnest(ARRAY[v_bride_id, v_groom_id]::uuid[]) AS roster(member_id)
    WHERE member_id IS NOT NULL
  ) AS members;
  IF cardinality(v_roster_member_ids) = 0 THEN
    RAISE EXCEPTION 'AMORA_CARE_EMPTY_ROSTER' USING ERRCODE = '23514';
  END IF;

  -- Each scan day is eligible only during that day's humane KST window.
  -- The midnight scan may enqueue work, but it is not claimable before 09:00;
  -- prepare repeats the same fence for targeted claims and boundary races.
  v_expires_at := ((p_scan_day + TIME '20:00:00') AT TIME ZONE 'Asia/Seoul');
  v_policy_now := public.amora_care_delivery_clock();
  v_available_at := CASE
    WHEN p_scan_day > (v_policy_now AT TIME ZONE 'Asia/Seoul')::date
      OR (
        p_scan_day = (v_policy_now AT TIME ZONE 'Asia/Seoul')::date
        AND (v_policy_now AT TIME ZONE 'Asia/Seoul')::time < TIME '09:00:00'
      )
      THEN ((p_scan_day + TIME '09:00:00') AT TIME ZONE 'Asia/Seoul')
    ELSE now()
  END;
  v_deferred := v_expires_at > v_policy_now AND v_available_at > v_policy_now;
  INSERT INTO public.amora_care_jobs(
    couple_id, scan_day, dedupe_key, content, email_subject, email_html, metadata,
    roster_member_ids, status, available_at,
    expires_at, last_error, completed_at
  ) VALUES (
    p_couple_id, p_scan_day, p_dedupe_key,
    CASE WHEN v_expires_at <= v_policy_now THEN '[redacted]' ELSE p_content END,
    CASE WHEN v_expires_at <= v_policy_now THEN NULL ELSE p_email_subject END,
    CASE WHEN v_expires_at <= v_policy_now THEN NULL ELSE p_email_html END,
    CASE
      WHEN v_expires_at <= v_policy_now THEN '{}'::jsonb
      ELSE COALESCE(p_metadata, '{}'::jsonb) - 'client_request_id'
    END,
    v_roster_member_ids,
    CASE WHEN v_expires_at <= v_policy_now THEN 'expired' ELSE 'pending' END,
    v_available_at,
    v_expires_at,
    CASE
      WHEN v_expires_at <= v_policy_now THEN 'scan_day_expired'
      WHEN v_deferred THEN 'outside_delivery_window'
      ELSE NULL
    END,
    CASE WHEN v_expires_at <= v_policy_now THEN now() ELSE NULL END
  )
  ON CONFLICT (couple_id, dedupe_key) DO NOTHING
  RETURNING * INTO v_job;

  IF FOUND THEN
    v_inserted := true;
  ELSE
    SELECT * INTO STRICT v_job
    FROM public.amora_care_jobs
    WHERE couple_id = p_couple_id AND dedupe_key = p_dedupe_key;
  END IF;

  RETURN jsonb_build_object(
    'id', v_job.id,
    'inserted', v_inserted,
    'status', v_job.status,
    'expires_at', v_job.expires_at
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.claim_amora_care_job(
  p_lease_seconds integer DEFAULT 90,
  p_job_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_job public.amora_care_jobs%ROWTYPE;
  v_token uuid := gen_random_uuid();
BEGIN
  IF p_lease_seconds NOT BETWEEN 30 AND 120 THEN
    RAISE EXCEPTION 'AMORA_CARE_JOB_LEASE_INVALID' USING ERRCODE = '22023';
  END IF;

  UPDATE public.amora_care_jobs
  SET status = 'expired', completed_at = now(), updated_at = now(),
      lease_token = NULL, lease_expires_at = NULL,
      last_error = 'scan_day_expired',
      content = '[redacted]', email_subject = NULL, email_html = NULL,
      metadata = '{}'::jsonb
  WHERE status IN ('pending', 'processing') AND expires_at <= now()
    AND (p_job_id IS NULL OR id = p_job_id);
  UPDATE public.amora_care_deliveries AS delivery
  SET status = 'expired', completed_at = now(), updated_at = now(),
      recipient_email = NULL, recipient_name = NULL,
      last_error = 'scan_day_expired'
  FROM public.amora_care_jobs AS job
  WHERE delivery.job_id = job.id
    AND job.status = 'expired'
    AND (p_job_id IS NULL OR job.id = p_job_id)
    AND delivery.status IN ('pending', 'processing');

  UPDATE public.amora_care_jobs
  SET status = 'failed', completed_at = now(), updated_at = now(),
      lease_token = NULL, lease_expires_at = NULL,
      last_error = COALESCE(last_error, 'attempts_exhausted'),
      content = '[redacted]', email_subject = NULL, email_html = NULL,
      metadata = '{}'::jsonb
  WHERE status IN ('pending', 'processing') AND attempt_count >= 5
    AND (status = 'pending' OR lease_expires_at <= now())
    AND (p_job_id IS NULL OR id = p_job_id);
  UPDATE public.amora_care_deliveries AS delivery
  SET status = 'failed', completed_at = now(), updated_at = now(),
      recipient_email = NULL, recipient_name = NULL,
      last_error = COALESCE(delivery.last_error, 'job_attempts_exhausted')
  FROM public.amora_care_jobs AS job
  WHERE delivery.job_id = job.id
    AND job.status = 'failed'
    AND (p_job_id IS NULL OR job.id = p_job_id)
    AND delivery.status IN ('pending', 'processing');

  SELECT * INTO v_job
  FROM public.amora_care_jobs
  WHERE (p_job_id IS NULL OR id = p_job_id)
    AND attempt_count < 5
    AND expires_at > now()
    AND (
      (status = 'pending' AND available_at <= now())
      OR (status = 'processing' AND lease_expires_at <= now())
    )
  ORDER BY available_at, created_at, id
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.amora_care_deliveries
  SET status = CASE WHEN attempt_count >= 5 THEN 'failed' ELSE 'pending' END,
      completed_at = CASE WHEN attempt_count >= 5 THEN now() ELSE NULL END,
      recipient_email = CASE WHEN attempt_count >= 5 THEN NULL ELSE recipient_email END,
      recipient_name = CASE WHEN attempt_count >= 5 THEN NULL ELSE recipient_name END,
      available_at = now(), updated_at = now(),
      last_error = CASE WHEN attempt_count >= 5 THEN 'attempts_exhausted' ELSE last_error END
  WHERE job_id = v_job.id AND status = 'processing';

  UPDATE public.amora_care_jobs
  SET status = 'processing',
      attempt_count = attempt_count + 1,
      claimed_at = now(),
      lease_token = v_token,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      last_error = CASE
        WHEN last_error = 'outside_delivery_window' THEN NULL
        ELSE last_error
      END,
      updated_at = now()
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  RETURN to_jsonb(v_job);
END
$function$;

CREATE OR REPLACE FUNCTION public.prepare_amora_care_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_email_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '20s'
AS $function$
DECLARE
  v_job public.amora_care_jobs%ROWTYPE;
  v_bride_id uuid;
  v_groom_id uuid;
  v_required integer;
  v_consented integer;
  v_current_member_ids uuid[];
  v_existing_deliveries integer;
  v_message_id uuid;
  v_request_key text;
  v_member record;
  v_delivery_status text;
  v_policy_now timestamptz;
  v_available_at timestamptz;
BEGIN
  SELECT * INTO v_job
  FROM public.amora_care_jobs
  WHERE id = p_job_id
  FOR UPDATE;
  IF NOT FOUND OR v_job.status <> 'processing'
     OR v_job.lease_token IS DISTINCT FROM p_lease_token
     OR v_job.lease_expires_at <= now() THEN
    RAISE EXCEPTION 'AMORA_CARE_JOB_LEASE_LOST' USING ERRCODE = '55000';
  END IF;

  IF v_job.expires_at <= now() THEN
    UPDATE public.amora_care_jobs
    SET status = 'expired', completed_at = now(), updated_at = now(),
        lease_token = NULL, lease_expires_at = NULL, last_error = 'scan_day_expired',
        content = '[redacted]', email_subject = NULL, email_html = NULL,
        metadata = '{}'::jsonb
    WHERE id = v_job.id;
    UPDATE public.amora_care_deliveries
    SET status = 'expired', completed_at = now(), updated_at = now(),
        recipient_email = NULL, recipient_name = NULL, last_error = 'scan_day_expired'
    WHERE job_id = v_job.id AND status IN ('pending', 'processing');
    RETURN jsonb_build_object('state', 'expired');
  END IF;

  v_policy_now := public.amora_care_delivery_clock();
  IF NOT public.amora_care_is_delivery_window(v_policy_now)
     OR v_job.scan_day IS DISTINCT FROM
        (v_policy_now AT TIME ZONE 'Asia/Seoul')::date THEN
    v_available_at := CASE
      WHEN v_job.scan_day > (v_policy_now AT TIME ZONE 'Asia/Seoul')::date
        THEN ((v_job.scan_day + TIME '09:00:00') AT TIME ZONE 'Asia/Seoul')
      ELSE public.amora_care_next_delivery_window(v_policy_now)
    END;
    UPDATE public.amora_care_jobs
    SET status = 'pending',
        attempt_count = GREATEST(0, attempt_count - 1),
        available_at = v_available_at,
        claimed_at = NULL,
        lease_token = NULL,
        lease_expires_at = NULL,
        last_error = 'outside_delivery_window',
        updated_at = now()
    WHERE id = v_job.id;
    RETURN jsonb_build_object(
      'state', 'deferred',
      'reason', 'outside_delivery_window',
      'available_at', v_available_at
    );
  END IF;

  SELECT bride_id, groom_id INTO v_bride_id, v_groom_id
  FROM public.couples
  WHERE id = v_job.couple_id
  FOR SHARE;
  SELECT COALESCE(array_agg(member_id ORDER BY member_id), ARRAY[]::uuid[])
  INTO v_current_member_ids
  FROM (
    SELECT DISTINCT member_id
    FROM unnest(ARRAY[v_bride_id, v_groom_id]::uuid[]) AS roster(member_id)
    WHERE member_id IS NOT NULL
  ) AS members;
  v_required := cardinality(v_current_member_ids);
  IF v_required = 0 OR v_job.roster_member_ids IS DISTINCT FROM v_current_member_ids THEN
    UPDATE public.amora_care_jobs
    SET status = 'cancelled', completed_at = now(), updated_at = now(),
        lease_token = NULL, lease_expires_at = NULL, last_error = 'member_roster_changed',
        content = '[redacted]', email_subject = NULL, email_html = NULL,
        metadata = '{}'::jsonb
    WHERE id = v_job.id;
    UPDATE public.amora_care_deliveries
    SET status = 'cancelled', completed_at = now(), updated_at = now(),
        recipient_email = NULL, recipient_name = NULL,
        last_error = 'member_roster_changed'
    WHERE job_id = v_job.id AND status IN ('pending', 'processing');
    RETURN jsonb_build_object('state', 'cancelled');
  END IF;
  PERFORM 1
  FROM public.profiles
  WHERE id IN (v_bride_id, v_groom_id)
  ORDER BY id
  FOR SHARE;
  SELECT count(*)::integer INTO v_consented
  FROM public.profiles
  WHERE id IN (v_bride_id, v_groom_id)
    AND care_notifications_enabled = true
    AND care_notifications_consented_at IS NOT NULL;

  IF v_required = 0 OR v_consented <> v_required THEN
    UPDATE public.amora_care_jobs
    SET status = 'cancelled', completed_at = now(), updated_at = now(),
        lease_token = NULL, lease_expires_at = NULL, last_error = 'consent_or_roster_changed',
        content = '[redacted]', email_subject = NULL, email_html = NULL,
        metadata = '{}'::jsonb
    WHERE id = v_job.id;
    UPDATE public.amora_care_deliveries
    SET status = 'cancelled', completed_at = now(), updated_at = now(),
        recipient_email = NULL, recipient_name = NULL,
        last_error = 'consent_or_roster_changed'
    WHERE job_id = v_job.id AND status IN ('pending', 'processing');
    RETURN jsonb_build_object('state', 'cancelled');
  END IF;

  SELECT count(*)::integer INTO v_existing_deliveries
  FROM public.amora_care_deliveries
  WHERE job_id = v_job.id;
  IF v_existing_deliveries > 0 AND (
    v_existing_deliveries <> v_required OR EXISTS (
      SELECT 1
      FROM public.amora_care_deliveries AS delivery
      WHERE delivery.job_id = v_job.id
        AND NOT EXISTS (
          SELECT 1
          FROM (VALUES (v_bride_id), (v_groom_id)) AS current_members(user_id)
          WHERE current_members.user_id IS NOT NULL
            AND current_members.user_id = delivery.user_id
        )
    )
  ) THEN
    UPDATE public.amora_care_jobs
    SET status = 'cancelled', completed_at = now(), updated_at = now(),
        lease_token = NULL, lease_expires_at = NULL, last_error = 'member_roster_changed',
        content = '[redacted]', email_subject = NULL, email_html = NULL,
        metadata = '{}'::jsonb
    WHERE id = v_job.id;
    UPDATE public.amora_care_deliveries
    SET status = 'cancelled', completed_at = now(), updated_at = now(),
        recipient_email = NULL, recipient_name = NULL,
        last_error = 'member_roster_changed'
    WHERE job_id = v_job.id AND status IN ('pending', 'processing');
    RETURN jsonb_build_object('state', 'cancelled');
  END IF;

  v_request_key := 'moment:' || v_job.dedupe_key;
  v_message_id := v_job.chat_message_id;
  IF v_message_id IS NULL THEN
    SELECT id INTO v_message_id
    FROM public.chat_messages
    WHERE couple_id = v_job.couple_id
      AND metadata->>'client_request_id' = v_request_key
      AND sender_id IS NULL
      AND sender_type = 'ai'
      AND role = 'assistant'
      AND visibility = 'shared'
    ORDER BY created_at, id
    LIMIT 1;
  END IF;
  IF v_message_id IS NULL THEN
    BEGIN
      INSERT INTO public.chat_messages(
        couple_id, sender_id, sender_type, role, content, visibility, metadata
      ) VALUES (
        v_job.couple_id, NULL, 'ai', 'assistant', v_job.content, 'shared',
        (v_job.metadata - 'client_request_id') || jsonb_build_object('client_request_id', v_request_key)
      ) RETURNING id INTO v_message_id;
    EXCEPTION WHEN unique_violation THEN
      SELECT id INTO v_message_id
      FROM public.chat_messages
      WHERE couple_id = v_job.couple_id
        AND metadata->>'client_request_id' = v_request_key
        AND sender_id IS NULL
        AND sender_type = 'ai'
        AND role = 'assistant'
        AND visibility = 'shared'
      ORDER BY created_at, id
      LIMIT 1;
    END;
  END IF;
  IF v_message_id IS NULL THEN
    RAISE EXCEPTION 'AMORA_CARE_CHAT_IDEMPOTENCY_FAILED' USING ERRCODE = '55000';
  END IF;
  PERFORM 1
  FROM public.chat_messages
  WHERE id = v_message_id
    AND couple_id = v_job.couple_id
    AND metadata->>'client_request_id' = v_request_key
    AND sender_id IS NULL
    AND sender_type = 'ai'
    AND role = 'assistant'
    AND visibility = 'shared';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_CARE_CHAT_IDEMPOTENCY_COLLISION' USING ERRCODE = '55000';
  END IF;
  UPDATE public.amora_care_jobs
  SET chat_message_id = v_message_id, updated_at = now()
  WHERE id = v_job.id;

  FOR v_member IN
    SELECT id
    FROM public.profiles
    WHERE id IN (v_bride_id, v_groom_id)
    ORDER BY id
  LOOP
    v_delivery_status := CASE
      WHEN NOT COALESCE(p_email_enabled, false) THEN 'skipped'
      ELSE 'pending'
    END;
    INSERT INTO public.amora_care_deliveries(
      job_id, user_id, status, recipient_email, idempotency_key,
      last_error, completed_at
    ) VALUES (
      v_job.id, v_member.id, v_delivery_status,
      NULL,
      'amora-care-' || replace(v_job.id::text, '-', '') || '-' || replace(v_member.id::text, '-', ''),
      CASE
        WHEN NOT COALESCE(p_email_enabled, false) THEN 'resend_disabled'
        ELSE NULL
      END,
      CASE WHEN v_delivery_status = 'skipped' THEN now() ELSE NULL END
    )
    ON CONFLICT (job_id, user_id) DO NOTHING;
  END LOOP;

  RETURN jsonb_build_object(
    'state', 'ready',
    'chat_message_id', v_message_id,
    'delivery_count', v_required
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.claim_amora_care_email_delivery(
  p_job_id uuid,
  p_lease_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '20s'
AS $function$
DECLARE
  v_job public.amora_care_jobs%ROWTYPE;
  v_delivery public.amora_care_deliveries%ROWTYPE;
  v_bride_id uuid;
  v_groom_id uuid;
  v_required integer;
  v_consented integer;
  v_delivery_count integer;
  v_email text;
  v_policy_now timestamptz;
  v_available_at timestamptz;
  v_send_day date;
BEGIN
  SELECT * INTO v_job
  FROM public.amora_care_jobs
  WHERE id = p_job_id
  FOR UPDATE;
  IF NOT FOUND OR v_job.status <> 'processing'
     OR v_job.lease_token IS DISTINCT FROM p_lease_token
     OR v_job.lease_expires_at <= now() THEN
    RAISE EXCEPTION 'AMORA_CARE_JOB_LEASE_LOST' USING ERRCODE = '55000';
  END IF;
  IF v_job.expires_at <= now() THEN
    UPDATE public.amora_care_jobs
    SET status = 'expired', completed_at = now(), updated_at = now(),
        lease_token = NULL, lease_expires_at = NULL, last_error = 'scan_day_expired',
        content = '[redacted]', email_subject = NULL, email_html = NULL,
        metadata = '{}'::jsonb
    WHERE id = v_job.id;
    UPDATE public.amora_care_deliveries
    SET status = 'expired', completed_at = now(), updated_at = now(),
        recipient_email = NULL, recipient_name = NULL, last_error = 'scan_day_expired'
    WHERE job_id = v_job.id AND status IN ('pending', 'processing');
    RETURN jsonb_build_object('state', 'expired');
  END IF;

  v_policy_now := public.amora_care_delivery_clock();
  IF NOT public.amora_care_is_delivery_window(v_policy_now)
     OR v_job.scan_day IS DISTINCT FROM
        (v_policy_now AT TIME ZONE 'Asia/Seoul')::date THEN
    v_available_at := CASE
      WHEN v_job.scan_day > (v_policy_now AT TIME ZONE 'Asia/Seoul')::date
        THEN ((v_job.scan_day + TIME '09:00:00') AT TIME ZONE 'Asia/Seoul')
      ELSE public.amora_care_next_delivery_window(v_policy_now)
    END;
    UPDATE public.amora_care_deliveries
    SET status = 'pending', updated_at = now()
    WHERE job_id = v_job.id AND status = 'processing';
    UPDATE public.amora_care_jobs
    SET status = 'pending',
        attempt_count = GREATEST(0, attempt_count - 1),
        available_at = v_available_at,
        claimed_at = NULL,
        lease_token = NULL,
        lease_expires_at = NULL,
        last_error = 'outside_delivery_window',
        updated_at = now()
    WHERE id = v_job.id;
    RETURN jsonb_build_object(
      'state', 'deferred',
      'reason', 'outside_delivery_window',
      'available_at', v_available_at
    );
  END IF;
  v_send_day := (v_policy_now AT TIME ZONE 'Asia/Seoul')::date;

  SELECT bride_id, groom_id INTO v_bride_id, v_groom_id
  FROM public.couples
  WHERE id = v_job.couple_id
  FOR SHARE;
  SELECT count(DISTINCT member_id)::integer INTO v_required
  FROM (VALUES (v_bride_id), (v_groom_id)) AS members(member_id)
  WHERE member_id IS NOT NULL;
  PERFORM 1
  FROM public.profiles
  WHERE id IN (v_bride_id, v_groom_id)
  ORDER BY id
  FOR SHARE;
  SELECT count(*)::integer INTO v_consented
  FROM public.profiles
  WHERE id IN (v_bride_id, v_groom_id)
    AND care_notifications_enabled = true
    AND care_notifications_consented_at IS NOT NULL;
  SELECT count(*)::integer INTO v_delivery_count
  FROM public.amora_care_deliveries
  WHERE job_id = v_job.id;

  IF v_required = 0 OR v_consented <> v_required OR v_delivery_count <> v_required
     OR EXISTS (
       SELECT 1
       FROM public.amora_care_deliveries AS delivery
       WHERE delivery.job_id = v_job.id
         AND NOT EXISTS (
           SELECT 1
           FROM (VALUES (v_bride_id), (v_groom_id)) AS current_members(user_id)
           WHERE current_members.user_id IS NOT NULL
             AND current_members.user_id = delivery.user_id
         )
     ) THEN
    UPDATE public.amora_care_jobs
    SET status = 'cancelled', completed_at = now(), updated_at = now(),
        lease_token = NULL, lease_expires_at = NULL, last_error = 'consent_or_roster_changed',
        content = '[redacted]', email_subject = NULL, email_html = NULL,
        metadata = '{}'::jsonb
    WHERE id = v_job.id;
    UPDATE public.amora_care_deliveries
    SET status = 'cancelled', completed_at = now(), updated_at = now(),
        recipient_email = NULL, recipient_name = NULL,
        last_error = 'consent_or_roster_changed'
    WHERE job_id = v_job.id AND status IN ('pending', 'processing');
    RETURN jsonb_build_object('state', 'cancelled');
  END IF;

  UPDATE public.amora_care_deliveries
  SET status = 'failed', completed_at = now(), updated_at = now(),
      recipient_email = NULL, recipient_name = NULL, last_error = 'attempts_exhausted'
  WHERE job_id = v_job.id AND status = 'pending' AND attempt_count >= 5;

  SELECT * INTO v_delivery
  FROM public.amora_care_deliveries
  WHERE job_id = v_job.id AND status = 'pending'
    AND attempt_count < 5 AND available_at <= now()
  ORDER BY user_id
  FOR UPDATE SKIP LOCKED
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT CASE
           WHEN auth_user.email_confirmed_at IS NOT NULL THEN auth_user.email
           ELSE NULL
         END
  INTO v_email
  FROM auth.users AS auth_user
  WHERE auth_user.id = v_delivery.user_id;
  IF v_email IS NULL OR char_length(v_email) > 320
     OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' THEN
    UPDATE public.amora_care_deliveries
    SET status = 'skipped', completed_at = now(), updated_at = now(),
        recipient_email = NULL, recipient_name = NULL, last_error = 'invalid_email'
    WHERE id = v_delivery.id;
    RETURN jsonb_build_object('state', 'warning', 'id', v_delivery.id, 'reason', 'invalid_email');
  END IF;
  IF v_delivery.attempt_count > 0
     AND v_delivery.recipient_email IS DISTINCT FROM v_email THEN
    -- Resend requires one idempotency key to replay the exact same request.
    -- Never reuse that key with a changed recipient after an ambiguous send.
    UPDATE public.amora_care_deliveries
    SET status = 'cancelled', completed_at = now(), updated_at = now(),
        recipient_email = NULL, recipient_name = NULL,
        last_error = 'recipient_changed_after_attempt'
    WHERE id = v_delivery.id;
    RETURN jsonb_build_object(
      'state', 'warning', 'id', v_delivery.id, 'reason', 'recipient_changed_after_attempt'
    );
  END IF;
  IF v_delivery.attempt_count > 0 THEN
    v_email := v_delivery.recipient_email;
  END IF;

  BEGIN
    UPDATE public.amora_care_deliveries
    SET status = 'processing', attempt_count = attempt_count + 1,
        claimed_at = now(), recipient_email = v_email,
        recipient_name = NULL, send_day = v_send_day,
        updated_at = now()
    WHERE id = v_delivery.id
    RETURNING * INTO v_delivery;
  EXCEPTION WHEN unique_violation THEN
    -- The unique (user_id, send_day) reservation is the concurrency fence.
    -- Only convert this row to a frequency skip when another delivery owns it;
    -- an unrelated uniqueness failure must remain loud.
    IF NOT EXISTS (
      SELECT 1
      FROM public.amora_care_deliveries AS reserved
      WHERE reserved.user_id = v_delivery.user_id
        AND reserved.send_day = v_send_day
        AND reserved.id <> v_delivery.id
    ) THEN
      RAISE;
    END IF;
    UPDATE public.amora_care_deliveries
    SET status = 'skipped', completed_at = now(), updated_at = now(),
        recipient_email = NULL, recipient_name = NULL, send_day = NULL,
        last_error = 'daily_frequency_limit'
    WHERE id = v_delivery.id;
    RETURN jsonb_build_object(
      'state', 'skipped',
      'id', v_delivery.id,
      'reason', 'daily_frequency_limit'
    );
  END;

  RETURN jsonb_build_object(
    'state', 'ready',
    'id', v_delivery.id,
    'user_id', v_delivery.user_id,
    'email', v_email,
    'idempotency_key', v_delivery.idempotency_key
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.finish_amora_care_email_delivery(
  p_delivery_id uuid,
  p_lease_token uuid,
  p_success boolean,
  p_provider_message_id text DEFAULT NULL,
  p_error text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_job_id uuid;
  v_job public.amora_care_jobs%ROWTYPE;
  v_delivery public.amora_care_deliveries%ROWTYPE;
  v_status text;
BEGIN
  SELECT job_id INTO v_job_id
  FROM public.amora_care_deliveries
  WHERE id = p_delivery_id;
  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'AMORA_CARE_DELIVERY_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_job FROM public.amora_care_jobs WHERE id = v_job_id FOR UPDATE;
  SELECT * INTO v_delivery FROM public.amora_care_deliveries WHERE id = p_delivery_id FOR UPDATE;
  IF v_job.status <> 'processing' OR v_job.lease_token IS DISTINCT FROM p_lease_token
     OR v_job.lease_expires_at <= now() OR v_delivery.status <> 'processing' THEN
    RAISE EXCEPTION 'AMORA_CARE_DELIVERY_LEASE_LOST' USING ERRCODE = '55000';
  END IF;

  IF p_success THEN
    v_status := 'completed';
    UPDATE public.amora_care_deliveries
    SET status = v_status, provider_message_id = left(p_provider_message_id, 300),
        recipient_email = NULL, recipient_name = NULL,
        last_error = NULL, completed_at = now(), updated_at = now()
    WHERE id = v_delivery.id;
  ELSE
    v_status := CASE WHEN v_delivery.attempt_count >= 5 THEN 'failed' ELSE 'pending' END;
    UPDATE public.amora_care_deliveries
    SET status = v_status,
        available_at = now() + make_interval(mins => LEAST(15, attempt_count * attempt_count)),
        recipient_email = CASE WHEN v_status = 'failed' THEN NULL ELSE recipient_email END,
        recipient_name = CASE WHEN v_status = 'failed' THEN NULL ELSE recipient_name END,
        last_error = left(COALESCE(NULLIF(p_error, ''), 'provider_error'), 500),
        completed_at = CASE WHEN v_status = 'failed' THEN now() ELSE NULL END,
        updated_at = now()
    WHERE id = v_delivery.id;
  END IF;
  RETURN jsonb_build_object('state', v_status, 'id', v_delivery.id);
END
$function$;

CREATE OR REPLACE FUNCTION public.finish_amora_care_job(
  p_job_id uuid,
  p_lease_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_job public.amora_care_jobs%ROWTYPE;
  v_pending integer;
  v_failed integer;
  v_incomplete integer;
  v_next timestamptz;
BEGIN
  SELECT * INTO v_job
  FROM public.amora_care_jobs
  WHERE id = p_job_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_CARE_JOB_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_job.status IN ('completed', 'failed', 'expired', 'cancelled') THEN
    UPDATE public.amora_care_deliveries
    SET recipient_email = NULL, recipient_name = NULL, updated_at = now()
    WHERE job_id = v_job.id
      AND (recipient_email IS NOT NULL OR recipient_name IS NOT NULL);
    UPDATE public.amora_care_jobs
    SET content = '[redacted]', email_subject = NULL, email_html = NULL,
        metadata = '{}'::jsonb, updated_at = now()
    WHERE id = v_job.id;
    RETURN jsonb_build_object(
      'state', CASE
        WHEN v_job.status = 'completed' AND v_job.last_error IS NOT NULL
          THEN 'completed_with_warning'
        ELSE v_job.status
      END
    );
  END IF;
  IF v_job.status <> 'processing' OR v_job.lease_token IS DISTINCT FROM p_lease_token
     OR v_job.lease_expires_at <= now() THEN
    RAISE EXCEPTION 'AMORA_CARE_JOB_LEASE_LOST' USING ERRCODE = '55000';
  END IF;

  IF v_job.expires_at <= now() THEN
    UPDATE public.amora_care_deliveries
    SET status = 'expired', completed_at = now(), updated_at = now(),
        recipient_email = NULL, recipient_name = NULL, last_error = 'scan_day_expired'
    WHERE job_id = v_job.id AND status IN ('pending', 'processing');
    UPDATE public.amora_care_jobs
    SET status = 'expired', completed_at = now(), updated_at = now(),
        lease_token = NULL, lease_expires_at = NULL, last_error = 'scan_day_expired',
        content = '[redacted]', email_subject = NULL, email_html = NULL,
        metadata = '{}'::jsonb
    WHERE id = v_job.id;
    RETURN jsonb_build_object('state', 'expired');
  END IF;

  SELECT count(*) FILTER (WHERE status IN ('pending', 'processing'))::integer,
         count(*) FILTER (WHERE status = 'failed')::integer,
         count(*) FILTER (WHERE status IN ('skipped', 'cancelled'))::integer,
         min(available_at) FILTER (WHERE status = 'pending')
  INTO v_pending, v_failed, v_incomplete, v_next
  FROM public.amora_care_deliveries
  WHERE job_id = v_job.id;

  IF v_failed > 0 OR (v_pending > 0 AND v_job.attempt_count >= 5) THEN
    UPDATE public.amora_care_deliveries
    SET status = 'failed', completed_at = now(), updated_at = now(),
        recipient_email = NULL, recipient_name = NULL,
        last_error = COALESCE(last_error, 'job_attempts_exhausted')
    WHERE job_id = v_job.id AND status IN ('pending', 'processing');
    UPDATE public.amora_care_deliveries
    SET recipient_email = NULL, recipient_name = NULL, updated_at = now()
    WHERE job_id = v_job.id;
    UPDATE public.amora_care_jobs
    SET status = 'failed', completed_at = now(), updated_at = now(),
        lease_token = NULL, lease_expires_at = NULL,
        content = '[redacted]', email_subject = NULL, email_html = NULL,
        metadata = '{}'::jsonb,
        last_error = COALESCE(last_error, 'delivery_failed')
    WHERE id = v_job.id;
    RETURN jsonb_build_object('state', 'failed');
  ELSIF v_pending > 0 THEN
    UPDATE public.amora_care_deliveries
    SET status = 'pending', updated_at = now()
    WHERE job_id = v_job.id AND status = 'processing';
    UPDATE public.amora_care_jobs
    SET status = 'pending', available_at = GREATEST(now(), COALESCE(v_next, now())),
        lease_token = NULL, lease_expires_at = NULL, updated_at = now()
    WHERE id = v_job.id;
    RETURN jsonb_build_object('state', 'pending');
  ELSIF v_incomplete > 0 THEN
    UPDATE public.amora_care_deliveries
    SET recipient_email = NULL, recipient_name = NULL, updated_at = now()
    WHERE job_id = v_job.id;
    UPDATE public.amora_care_jobs
    SET status = 'completed', completed_at = now(), updated_at = now(),
        lease_token = NULL, lease_expires_at = NULL,
        last_error = 'email_delivery_incomplete',
        content = '[redacted]', email_subject = NULL, email_html = NULL,
        metadata = '{}'::jsonb
    WHERE id = v_job.id;
    RETURN jsonb_build_object('state', 'completed_with_warning');
  ELSE
    UPDATE public.amora_care_deliveries
    SET recipient_email = NULL, recipient_name = NULL, updated_at = now()
    WHERE job_id = v_job.id;
    UPDATE public.amora_care_jobs
    SET status = 'completed', completed_at = now(), updated_at = now(),
        lease_token = NULL, lease_expires_at = NULL, last_error = NULL,
        content = '[redacted]', email_subject = NULL, email_html = NULL,
        metadata = '{}'::jsonb
    WHERE id = v_job.id;
    RETURN jsonb_build_object('state', 'completed');
  END IF;
END
$function$;

CREATE OR REPLACE FUNCTION public.set_amora_care_consent(
  p_user_id uuid,
  p_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '20s'
AS $function$
DECLARE
  v_couple_id uuid;
  v_profile public.profiles%ROWTYPE;
  v_cancelled_jobs integer := 0;
BEGIN
  IF p_user_id IS NULL OR p_enabled IS NULL THEN
    RAISE EXCEPTION 'AMORA_CARE_CONSENT_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_couple_id
  FROM public.couples
  WHERE bride_id = p_user_id OR groom_id = p_user_id
  ORDER BY id
  LIMIT 1;

  IF NOT p_enabled AND v_couple_id IS NOT NULL THEN
    -- Match the worker lock order: jobs first, then profile. This makes consent
    -- withdrawal and payload scrubbing one transaction without lock inversion.
    PERFORM 1
    FROM public.amora_care_jobs
    WHERE couple_id = v_couple_id AND status IN ('pending', 'processing')
    ORDER BY id
    FOR UPDATE;
  END IF;

  UPDATE public.profiles
  SET care_notifications_enabled = p_enabled,
      care_notifications_consented_at = CASE WHEN p_enabled THEN now() ELSE NULL END
  WHERE id = p_user_id
  RETURNING * INTO v_profile;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_CARE_CONSENT_PROFILE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF NOT p_enabled AND v_couple_id IS NOT NULL THEN
    UPDATE public.amora_care_deliveries AS delivery
    SET status = CASE
          WHEN delivery.status IN ('pending', 'processing') THEN 'cancelled'
          ELSE delivery.status
        END,
        completed_at = CASE
          WHEN delivery.status IN ('pending', 'processing') THEN now()
          ELSE delivery.completed_at
        END,
        recipient_email = NULL,
        recipient_name = NULL,
        last_error = CASE
          WHEN delivery.status IN ('pending', 'processing') THEN 'consent_withdrawn'
          ELSE delivery.last_error
        END,
        updated_at = now()
    FROM public.amora_care_jobs AS job
    WHERE delivery.job_id = job.id
      AND job.couple_id = v_couple_id
      AND job.status IN ('pending', 'processing');

    UPDATE public.amora_care_jobs
    SET status = 'cancelled', completed_at = now(), updated_at = now(),
        lease_token = NULL, lease_expires_at = NULL,
        last_error = 'consent_withdrawn',
        content = '[redacted]', email_subject = NULL, email_html = NULL,
        metadata = '{}'::jsonb
    WHERE couple_id = v_couple_id AND status IN ('pending', 'processing');
    GET DIAGNOSTICS v_cancelled_jobs = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'profile', to_jsonb(v_profile),
    'cancelled_jobs', v_cancelled_jobs
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.quarantine_amora_care_queue(
  p_reason text DEFAULT 'outbound_disabled'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '20s'
AS $function$
DECLARE
  v_jobs integer := 0;
  v_deliveries integer := 0;
BEGIN
  IF p_reason IS NULL OR p_reason !~ '^[a-z0-9_:-]{1,64}$' THEN
    RAISE EXCEPTION 'AMORA_CARE_QUARANTINE_REASON_INVALID' USING ERRCODE = '22023';
  END IF;

  -- Match worker lock order. A kill switch must make every not-yet-terminal
  -- payload ineligible and remove copied content/recipient PII before it can
  -- be re-enabled later the same day.
  PERFORM 1
  FROM public.amora_care_jobs
  WHERE status IN ('pending', 'processing')
  ORDER BY id
  FOR UPDATE;

  UPDATE public.amora_care_deliveries AS delivery
  SET status = CASE
        WHEN delivery.status IN ('pending', 'processing') THEN 'cancelled'
        ELSE delivery.status
      END,
      completed_at = CASE
        WHEN delivery.status IN ('pending', 'processing') THEN now()
        ELSE delivery.completed_at
      END,
      recipient_email = NULL,
      recipient_name = NULL,
      last_error = CASE
        WHEN delivery.status IN ('pending', 'processing') THEN p_reason
        ELSE delivery.last_error
      END,
      updated_at = now()
  FROM public.amora_care_jobs AS job
  WHERE delivery.job_id = job.id
    AND job.status IN ('pending', 'processing');
  GET DIAGNOSTICS v_deliveries = ROW_COUNT;

  UPDATE public.amora_care_jobs
  SET status = 'cancelled', completed_at = now(), updated_at = now(),
      lease_token = NULL, lease_expires_at = NULL,
      last_error = p_reason,
      content = '[redacted]', email_subject = NULL, email_html = NULL,
      metadata = '{}'::jsonb
  WHERE status IN ('pending', 'processing');
  GET DIAGNOSTICS v_jobs = ROW_COUNT;

  RETURN jsonb_build_object('jobs', v_jobs, 'deliveries', v_deliveries);
END
$function$;

CREATE OR REPLACE FUNCTION public.get_amora_care_queue_stats(
  p_scan_day date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_failed integer;
  v_active_backlog integer;
  v_oldest_active_age_seconds bigint;
  v_deferred integer;
  v_frequency_skipped integer;
BEGIN
  IF p_scan_day IS NULL THEN
    RAISE EXCEPTION 'AMORA_CARE_STATS_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT count(*)::integer
  INTO v_failed
  FROM public.amora_care_jobs
  WHERE scan_day = p_scan_day AND status = 'failed';

  SELECT count(*)::integer,
         COALESCE(
           GREATEST(
             0,
             floor(extract(epoch FROM now() - min(created_at)))::bigint
           ),
           0
         )
  INTO v_active_backlog, v_oldest_active_age_seconds
  FROM public.amora_care_jobs
  WHERE status IN ('pending', 'processing');

  SELECT count(*)::integer
  INTO v_deferred
  FROM public.amora_care_jobs
  WHERE scan_day = p_scan_day
    AND status = 'pending'
    AND last_error = 'outside_delivery_window';

  SELECT count(*)::integer
  INTO v_frequency_skipped
  FROM public.amora_care_deliveries AS delivery
  JOIN public.amora_care_jobs AS job ON job.id = delivery.job_id
  WHERE job.scan_day = p_scan_day
    AND delivery.status = 'skipped'
    AND delivery.last_error = 'daily_frequency_limit';

  RETURN jsonb_build_object(
    'failed', v_failed,
    'active_backlog', v_active_backlog,
    'oldest_active_age_seconds', v_oldest_active_age_seconds,
    'deferred', v_deferred,
    'frequency_skipped', v_frequency_skipped
  );
END
$function$;

REVOKE ALL ON FUNCTION public.claim_amora_care_scan(date, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.advance_amora_care_scan(date, uuid, uuid, uuid, integer, boolean, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_amora_care_job(uuid, date, text, text, jsonb, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_amora_care_job(integer, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prepare_amora_care_job(uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_amora_care_email_delivery(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_amora_care_email_delivery(uuid, uuid, boolean, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_amora_care_job(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_amora_care_consent(uuid, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.quarantine_amora_care_queue(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_amora_care_queue_stats(date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.amora_care_delivery_clock()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.amora_care_is_delivery_window(timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.amora_care_next_delivery_window(timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_direct_amora_care_consent_change()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_amora_care_scan(date, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.advance_amora_care_scan(date, uuid, uuid, uuid, integer, boolean, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_amora_care_job(uuid, date, text, text, jsonb, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_amora_care_job(integer, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.prepare_amora_care_job(uuid, uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_amora_care_email_delivery(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_amora_care_email_delivery(uuid, uuid, boolean, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_amora_care_job(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_amora_care_consent(uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.quarantine_amora_care_queue(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_amora_care_queue_stats(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.amora_care_delivery_clock() TO service_role;
GRANT EXECUTE ON FUNCTION public.amora_care_is_delivery_window(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.amora_care_next_delivery_window(timestamptz) TO service_role;

-- Converge both legacy and contract-applied databases on one strict INSERT
-- policy. PostgreSQL combines permissive policies with OR, so leaving even one
-- legacy policy would reopen AI identity/server metadata forgery.
REVOKE ALL PRIVILEGES ON TABLE public.chat_messages FROM anon, authenticated;
GRANT SELECT ON TABLE public.chat_messages TO authenticated;
GRANT INSERT (
  couple_id, sender_id, sender_type, role, content, metadata, stage_tag, visibility
) ON public.chat_messages TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.chat_messages TO service_role;

DROP POLICY IF EXISTS "Allow AI message insert" ON public.chat_messages;
DROP POLICY IF EXISTS chat_insert_couple ON public.chat_messages;
DROP POLICY IF EXISTS couple_members_can_insert_messages ON public.chat_messages;
DROP POLICY IF EXISTS couple_members_can_delete_messages ON public.chat_messages;
DROP POLICY IF EXISTS chat_messages_insert_own_user ON public.chat_messages;

CREATE POLICY chat_messages_insert_own_user ON public.chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND role = 'user'
    AND sender_type IN ('bride', 'groom')
    AND sender_role IS NULL
    AND specialist_type IS NULL
    AND (stage_tag IS NULL OR stage_tag IN (
      'planning_0', 'preparation_1', 'execution_2', 'ceremony_3', 'settlement_4'
    ))
    AND char_length(content) BETWEEN 1 AND 20000
    AND btrim(content) <> ''
    AND created_at BETWEEN now() - interval '5 minutes' AND now() + interval '1 minute'
    AND EXISTS (
      SELECT 1
      FROM public.couples AS couple
      WHERE couple.id = chat_messages.couple_id
        AND (
          (sender_type = 'bride' AND couple.bride_id = auth.uid())
          OR (sender_type = 'groom' AND couple.groom_id = auth.uid())
        )
        AND (
          visibility = 'shared'
          OR (sender_type = 'bride' AND visibility = 'bride_private')
          OR (sender_type = 'groom' AND visibility = 'groom_private')
        )
    )
    AND (
      metadata IS NULL
      OR (
        jsonb_typeof(metadata) = 'object'
        AND metadata - ARRAY['target', 'imagePaths']::text[] = '{}'::jsonb
        AND (NOT metadata ? 'target' OR metadata->>'target' = 'partner')
        AND (
          NOT metadata ? 'imagePaths'
          OR (
            jsonb_typeof(metadata->'imagePaths') = 'array'
            AND jsonb_array_length(metadata->'imagePaths') <= 5
            AND NOT EXISTS (
              SELECT 1
              FROM jsonb_array_elements(metadata->'imagePaths') AS image_path(value)
              WHERE jsonb_typeof(image_path.value) <> 'string'
                 OR char_length(image_path.value #>> '{}') NOT BETWEEN 1 AND 512
                 OR image_path.value #>> '{}' NOT LIKE chat_messages.couple_id::text || '/%'
                 OR image_path.value #>> '{}' LIKE '%..%'
            )
          )
        )
      )
    )
  );

DO $policy_check$
BEGIN
  IF (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chat_messages'
      AND cmd IN ('ALL', 'INSERT')
      AND roles && ARRAY['public'::name, 'authenticated'::name]
  ) <> 1
  OR NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chat_messages'
      AND policyname = 'chat_messages_insert_own_user'
      AND cmd = 'INSERT'
      AND roles && ARRAY['authenticated'::name]
  ) THEN
    RAISE EXCEPTION 'AMORA_CARE_CHAT_INSERT_POLICY_INVALID';
  END IF;
END
$policy_check$;

COMMENT ON TABLE public.amora_care_scan_states IS
  'Service-only KST day keyset cursor for bounded outbound-care scans.';
COMMENT ON TABLE public.amora_care_jobs IS
  'Durable consent-fenced care chat jobs; terminal rows retain audit keys but scrub copied message/email payloads.';
COMMENT ON TABLE public.amora_care_deliveries IS
  'Per-member durable email deliveries with stable Resend idempotency keys; terminal rows scrub recipient PII.';
