-- Converge fresh and already-applied preview care queues on humane delivery
-- hours, a per-user/day email reservation, observable queue health, and an
-- exact consent invariant. No pre-policy active payload may resume delivery.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Match the worker's jobs -> deliveries lock order and hold queue writers until
-- quarantine, function replacement, and postconditions commit. Reads remain
-- available, and the unrelated profiles table is never locked for the full
-- migration. The production release gate keeps outbound care disabled while
-- this convergence migration is pending.
LOCK TABLE public.amora_care_jobs IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.amora_care_deliveries IN SHARE ROW EXCLUSIVE MODE;

-- Fresh databases already received this column in 0930. Avoid even a no-op
-- ALTER TABLE (and its ACCESS EXCLUSIVE lock) on that normal release path.
DO $add_send_day_only_when_missing$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'amora_care_deliveries'
      AND column_name = 'send_day'
      AND data_type = 'date'
  ) THEN
    ALTER TABLE public.amora_care_deliveries ADD COLUMN send_day date;
  END IF;
END
$add_send_day_only_when_missing$;

-- Preserve one conservative reservation for every user/day on which an old
-- worker made an attempt. This blocks a second email after an ambiguous send.
WITH attempted AS (
  SELECT
    delivery.id,
    (
      COALESCE(
        delivery.claimed_at,
        delivery.completed_at,
        delivery.updated_at,
        delivery.created_at
      ) AT TIME ZONE 'Asia/Seoul'
    )::date AS attempted_day,
    row_number() OVER (
      PARTITION BY delivery.user_id, (
        COALESCE(
          delivery.claimed_at,
          delivery.completed_at,
          delivery.updated_at,
          delivery.created_at
        ) AT TIME ZONE 'Asia/Seoul'
      )::date
      ORDER BY delivery.claimed_at NULLS LAST, delivery.created_at, delivery.id
    ) AS reservation_rank
  FROM public.amora_care_deliveries AS delivery
  WHERE delivery.attempt_count > 0
    AND delivery.send_day IS NULL
)
UPDATE public.amora_care_deliveries AS delivery
SET send_day = attempted.attempted_day,
    updated_at = now()
FROM attempted
WHERE delivery.id = attempted.id
  AND attempted.reservation_rank = 1;

-- If an edited preview schema already had a non-unique send_day, retain one
-- conservative reservation and clear only redundant markers before sealing it.
WITH ranked_reservations AS (
  SELECT
    delivery.id,
    row_number() OVER (
      PARTITION BY delivery.user_id, delivery.send_day
      ORDER BY delivery.claimed_at NULLS LAST, delivery.created_at, delivery.id
    ) AS reservation_rank
  FROM public.amora_care_deliveries AS delivery
  WHERE delivery.send_day IS NOT NULL
)
UPDATE public.amora_care_deliveries AS delivery
SET send_day = NULL,
    updated_at = now()
FROM ranked_reservations AS ranked
WHERE delivery.id = ranked.id
  AND ranked.reservation_rank > 1;

-- An already-durable pre-policy job cannot be proved to have been prepared in
-- the new window. Quarantine all active work and scrub copied payloads first.
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
      WHEN delivery.status IN ('pending', 'processing')
        THEN 'delivery_policy_upgrade_quarantine'
      ELSE delivery.last_error
    END,
    updated_at = now()
FROM public.amora_care_jobs AS job
WHERE delivery.job_id = job.id
  AND (
    job.status IN ('pending', 'processing')
    OR delivery.status IN ('pending', 'processing')
  );

UPDATE public.amora_care_jobs
SET status = 'cancelled',
    completed_at = now(),
    lease_token = NULL,
    lease_expires_at = NULL,
    last_error = 'delivery_policy_upgrade_quarantine',
    content = '[redacted]',
    email_subject = NULL,
    email_html = NULL,
    metadata = '{}'::jsonb,
    updated_at = now()
WHERE status IN ('pending', 'processing');

DROP INDEX IF EXISTS public.amora_care_deliveries_user_send_day_uidx;
CREATE UNIQUE INDEX amora_care_deliveries_user_send_day_uidx
  ON public.amora_care_deliveries (user_id, send_day)
  WHERE send_day IS NOT NULL;

CREATE INDEX IF NOT EXISTS amora_care_jobs_scan_status_idx
  ON public.amora_care_jobs (scan_day, status);

CREATE INDEX IF NOT EXISTS amora_care_jobs_active_age_idx
  ON public.amora_care_jobs (created_at)
  WHERE status IN ('pending', 'processing');

-- Repair toward disabled, never toward implicit opt-in. On a fresh release the
-- 0930 constraint is already valid, so the UPDATE is a zero-row operation and
-- the conditional block below avoids taking a profiles DDL lock at all.
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

DO $converge_care_consent_constraint$
DECLARE
  v_constraint_exists boolean;
  v_constraint_valid boolean;
BEGIN
  SELECT true, constraint_info.convalidated
  INTO v_constraint_exists, v_constraint_valid
  FROM pg_constraint AS constraint_info
  WHERE constraint_info.conrelid = 'public.profiles'::regclass
    AND constraint_info.conname = 'profiles_care_consent_state_valid'
    AND constraint_info.contype = 'c';

  IF NOT COALESCE(v_constraint_exists, false) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_care_consent_state_valid
      CHECK (
        care_notifications_enabled = (care_notifications_consented_at IS NOT NULL)
      ) NOT VALID;
    v_constraint_valid := false;
  END IF;

  IF NOT COALESCE(v_constraint_valid, false) THEN
    ALTER TABLE public.profiles
      VALIDATE CONSTRAINT profiles_care_consent_state_valid;
  END IF;
END
$converge_care_consent_constraint$;

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

-- Keep the already-reviewed queue implementation behind small policy
-- wrappers. This lets an edited fresh 0930 and an immutable preview 0930
-- converge without duplicating hundreds of lines of consent/roster logic.
ALTER FUNCTION public.enqueue_amora_care_job(uuid, date, text, text, jsonb, text, text)
  RENAME TO enqueue_amora_care_job_pre_delivery_policy;

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
  v_result jsonb;
  v_job public.amora_care_jobs%ROWTYPE;
  v_expires_at timestamptz;
  v_policy_now timestamptz;
  v_available_at timestamptz;
  v_deferred boolean;
BEGIN
  v_result := public.enqueue_amora_care_job_pre_delivery_policy(
    p_couple_id,
    p_scan_day,
    p_dedupe_key,
    p_content,
    p_metadata,
    p_email_subject,
    p_email_html
  );
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

  IF COALESCE((v_result->>'inserted')::boolean, false) THEN
    UPDATE public.amora_care_jobs
    SET expires_at = v_expires_at,
        status = CASE WHEN v_expires_at <= v_policy_now THEN 'expired' ELSE 'pending' END,
        available_at = v_available_at,
        completed_at = CASE WHEN v_expires_at <= v_policy_now THEN now() ELSE NULL END,
        last_error = CASE
          WHEN v_expires_at <= v_policy_now THEN 'scan_day_expired'
          WHEN v_deferred THEN 'outside_delivery_window'
          ELSE NULL
        END,
        content = CASE WHEN v_expires_at <= v_policy_now THEN '[redacted]' ELSE content END,
        email_subject = CASE WHEN v_expires_at <= v_policy_now THEN NULL ELSE email_subject END,
        email_html = CASE WHEN v_expires_at <= v_policy_now THEN NULL ELSE email_html END,
        metadata = CASE WHEN v_expires_at <= v_policy_now THEN '{}'::jsonb ELSE metadata END,
        updated_at = now()
    WHERE id = (v_result->>'id')::uuid;
  END IF;

  SELECT * INTO STRICT v_job
  FROM public.amora_care_jobs
  WHERE id = (v_result->>'id')::uuid;
  RETURN jsonb_build_object(
    'id', v_job.id,
    'inserted', COALESCE((v_result->>'inserted')::boolean, false),
    'status', v_job.status,
    'expires_at', v_job.expires_at
  );
END
$function$;

ALTER FUNCTION public.prepare_amora_care_job(uuid, uuid, boolean)
  RENAME TO prepare_amora_care_job_pre_delivery_policy;

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

  v_policy_now := public.amora_care_delivery_clock();
  IF v_job.expires_at <= v_policy_now THEN
    UPDATE public.amora_care_deliveries
    SET status = 'expired', completed_at = now(), updated_at = now(),
        recipient_email = NULL, recipient_name = NULL,
        last_error = 'scan_day_expired'
    WHERE job_id = v_job.id AND status IN ('pending', 'processing');
    UPDATE public.amora_care_jobs
    SET status = 'expired', completed_at = now(), updated_at = now(),
        lease_token = NULL, lease_expires_at = NULL,
        last_error = 'scan_day_expired', content = '[redacted]',
        email_subject = NULL, email_html = NULL, metadata = '{}'::jsonb
    WHERE id = v_job.id;
    RETURN jsonb_build_object('state', 'expired');
  END IF;

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

  RETURN public.prepare_amora_care_job_pre_delivery_policy(
    p_job_id,
    p_lease_token,
    p_email_enabled
  );
END
$function$;

ALTER FUNCTION public.claim_amora_care_email_delivery(uuid, uuid)
  RENAME TO claim_amora_care_email_delivery_pre_delivery_policy;

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
  v_result jsonb;
  v_delivery_id uuid;
  v_user_id uuid;
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

  v_policy_now := public.amora_care_delivery_clock();
  IF v_job.expires_at <= v_policy_now THEN
    UPDATE public.amora_care_deliveries
    SET status = 'expired', completed_at = now(), updated_at = now(),
        recipient_email = NULL, recipient_name = NULL,
        last_error = 'scan_day_expired'
    WHERE job_id = v_job.id AND status IN ('pending', 'processing');
    UPDATE public.amora_care_jobs
    SET status = 'expired', completed_at = now(), updated_at = now(),
        lease_token = NULL, lease_expires_at = NULL,
        last_error = 'scan_day_expired', content = '[redacted]',
        email_subject = NULL, email_html = NULL, metadata = '{}'::jsonb
    WHERE id = v_job.id;
    RETURN jsonb_build_object('state', 'expired');
  END IF;

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

  v_result := public.claim_amora_care_email_delivery_pre_delivery_policy(
    p_job_id,
    p_lease_token
  );
  IF v_result IS NULL OR v_result->>'state' <> 'ready' THEN
    RETURN v_result;
  END IF;

  v_delivery_id := (v_result->>'id')::uuid;
  v_user_id := (v_result->>'user_id')::uuid;
  v_send_day := (v_policy_now AT TIME ZONE 'Asia/Seoul')::date;
  BEGIN
    UPDATE public.amora_care_deliveries
    SET send_day = v_send_day, updated_at = now()
    WHERE id = v_delivery_id;
  EXCEPTION WHEN unique_violation THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.amora_care_deliveries AS reserved
      WHERE reserved.user_id = v_user_id
        AND reserved.send_day = v_send_day
        AND reserved.id <> v_delivery_id
    ) THEN
      RAISE;
    END IF;
    UPDATE public.amora_care_deliveries
    SET status = 'skipped', completed_at = now(), updated_at = now(),
        recipient_email = NULL, recipient_name = NULL, send_day = NULL,
        last_error = 'daily_frequency_limit'
    WHERE id = v_delivery_id;
    RETURN jsonb_build_object(
      'state', 'skipped',
      'id', v_delivery_id,
      'reason', 'daily_frequency_limit'
    );
  END;
  RETURN v_result;
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
  SELECT count(*)::integer INTO v_failed
  FROM public.amora_care_jobs
  WHERE scan_day = p_scan_day AND status = 'failed';
  SELECT count(*)::integer,
         COALESCE(
           GREATEST(0, floor(extract(epoch FROM now() - min(created_at)))::bigint),
           0
         )
  INTO v_active_backlog, v_oldest_active_age_seconds
  FROM public.amora_care_jobs
  WHERE status IN ('pending', 'processing');
  SELECT count(*)::integer INTO v_deferred
  FROM public.amora_care_jobs
  WHERE scan_day = p_scan_day
    AND status = 'pending'
    AND last_error = 'outside_delivery_window';
  SELECT count(*)::integer INTO v_frequency_skipped
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

ALTER FUNCTION public.enqueue_amora_care_job(uuid, date, text, text, jsonb, text, text)
  OWNER TO postgres;
ALTER FUNCTION public.enqueue_amora_care_job_pre_delivery_policy(uuid, date, text, text, jsonb, text, text)
  OWNER TO postgres;
ALTER FUNCTION public.prepare_amora_care_job(uuid, uuid, boolean)
  OWNER TO postgres;
ALTER FUNCTION public.prepare_amora_care_job_pre_delivery_policy(uuid, uuid, boolean)
  OWNER TO postgres;
ALTER FUNCTION public.claim_amora_care_email_delivery(uuid, uuid)
  OWNER TO postgres;
ALTER FUNCTION public.claim_amora_care_email_delivery_pre_delivery_policy(uuid, uuid)
  OWNER TO postgres;
ALTER FUNCTION public.get_amora_care_queue_stats(date) OWNER TO postgres;
ALTER FUNCTION public.amora_care_delivery_clock() OWNER TO postgres;
ALTER FUNCTION public.amora_care_is_delivery_window(timestamptz) OWNER TO postgres;
ALTER FUNCTION public.amora_care_next_delivery_window(timestamptz) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.enqueue_amora_care_job_pre_delivery_policy(uuid, date, text, text, jsonb, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.prepare_amora_care_job_pre_delivery_policy(uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_amora_care_email_delivery_pre_delivery_policy(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enqueue_amora_care_job(uuid, date, text, text, jsonb, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prepare_amora_care_job(uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_amora_care_email_delivery(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_amora_care_queue_stats(date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.amora_care_delivery_clock()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.amora_care_is_delivery_window(timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.amora_care_next_delivery_window(timestamptz)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.enqueue_amora_care_job(uuid, date, text, text, jsonb, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.prepare_amora_care_job(uuid, uuid, boolean)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_amora_care_email_delivery(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_amora_care_queue_stats(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.amora_care_delivery_clock() TO service_role;
GRANT EXECUTE ON FUNCTION public.amora_care_is_delivery_window(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.amora_care_next_delivery_window(timestamptz) TO service_role;

DO $postconditions$
BEGIN
  IF public.amora_care_is_delivery_window(
       TIMESTAMPTZ '2099-01-01 08:59:59+09'
     )
     OR NOT public.amora_care_is_delivery_window(
       TIMESTAMPTZ '2099-01-01 09:00:00+09'
     )
     OR NOT public.amora_care_is_delivery_window(
       TIMESTAMPTZ '2099-01-01 19:59:59+09'
     )
     OR public.amora_care_is_delivery_window(
       TIMESTAMPTZ '2099-01-01 20:00:00+09'
     ) THEN
    RAISE EXCEPTION 'AMORA_CARE_DELIVERY_WINDOW_POSTCONDITION_FAILED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE care_notifications_enabled IS DISTINCT FROM
          (care_notifications_consented_at IS NOT NULL)
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_care_consent_state_valid'
      AND contype = 'c'
      AND convalidated
  ) THEN
    RAISE EXCEPTION 'AMORA_CARE_CONSENT_INVARIANT_POSTCONDITION_FAILED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.amora_care_jobs
    WHERE status IN ('pending', 'processing')
  ) OR EXISTS (
    SELECT 1 FROM public.amora_care_deliveries
    WHERE status IN ('pending', 'processing')
  ) OR EXISTS (
    SELECT 1
    FROM public.amora_care_jobs
    WHERE status = 'cancelled'
      AND last_error = 'delivery_policy_upgrade_quarantine'
      AND (
        content <> '[redacted]'
        OR email_subject IS NOT NULL
        OR email_html IS NOT NULL
        OR metadata <> '{}'::jsonb
      )
  ) THEN
    RAISE EXCEPTION 'AMORA_CARE_PRE_POLICY_QUEUE_NOT_QUARANTINED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'amora_care_deliveries'
      AND column_name = 'send_day'
      AND data_type = 'date'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_index
    WHERE indexrelid = 'public.amora_care_deliveries_user_send_day_uidx'::regclass
      AND indisunique
      AND indpred IS NOT NULL
  ) OR to_regprocedure('public.get_amora_care_queue_stats(date)') IS NULL
     OR NOT has_function_privilege(
       'service_role', 'public.get_amora_care_queue_stats(date)', 'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated', 'public.get_amora_care_queue_stats(date)', 'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.enqueue_amora_care_job(uuid,date,text,text,jsonb,text,text)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.prepare_amora_care_job(uuid,uuid,boolean)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.claim_amora_care_email_delivery(uuid,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.claim_amora_care_email_delivery(uuid,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.enqueue_amora_care_job_pre_delivery_policy(uuid,date,text,text,jsonb,text,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.prepare_amora_care_job_pre_delivery_policy(uuid,uuid,boolean)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.claim_amora_care_email_delivery_pre_delivery_policy(uuid,uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'AMORA_CARE_DELIVERY_POLICY_POSTCONDITION_FAILED';
  END IF;
END
$postconditions$;
