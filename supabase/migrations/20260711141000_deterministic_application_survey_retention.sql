-- Deterministic retention for public application/survey collection.

-- Prevent rolling old-shape inserts from racing the NULL backfill and NOT NULL
-- transition. The migration runner's per-file transaction contract is a
-- staging release gate.
LOCK TABLE public.preregistrations IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.customer_survey_responses IN ACCESS EXCLUSIVE MODE;

-- Close the rolling-deploy gap left by the earlier nullable expand step. Old
-- clients may omit these fields, but the database now supplies and clamps the
-- deletion deadline instead of allowing indefinitely retained NULL rows.
UPDATE public.preregistrations
SET created_at = COALESCE(created_at, now()),
    expires_at = LEAST(
  COALESCE(expires_at, COALESCE(created_at, now()) + interval '180 days'),
  COALESCE(created_at, now()) + interval '180 days'
);

ALTER TABLE public.preregistrations
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '180 days'),
  ALTER COLUMN expires_at SET NOT NULL;

ALTER TABLE public.preregistrations
  DROP CONSTRAINT IF EXISTS preregistrations_retention_cap;
ALTER TABLE public.preregistrations
  ADD CONSTRAINT preregistrations_retention_cap
  CHECK (expires_at <= created_at + interval '180 days');

CREATE OR REPLACE FUNCTION public.clamp_preregistration_retention()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_created_at timestamptz := COALESCE(NEW.created_at, now());
BEGIN
  NEW.expires_at := LEAST(
    COALESCE(NEW.expires_at, v_created_at + interval '180 days'),
    v_created_at + interval '180 days'
  );
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.clamp_preregistration_retention()
  FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_clamp_preregistration_retention ON public.preregistrations;
CREATE TRIGGER trg_clamp_preregistration_retention
  BEFORE INSERT OR UPDATE OF created_at, expires_at ON public.preregistrations
  FOR EACH ROW EXECUTE FUNCTION public.clamp_preregistration_retention();

ALTER TABLE public.customer_survey_responses
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

UPDATE public.customer_survey_responses
SET expires_at = LEAST(
  COALESCE(expires_at, COALESCE(created_at, now()) + interval '365 days'),
  COALESCE(created_at, now()) + interval '365 days'
);

ALTER TABLE public.customer_survey_responses
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '365 days'),
  ALTER COLUMN expires_at SET NOT NULL;

ALTER TABLE public.customer_survey_responses
  DROP CONSTRAINT IF EXISTS customer_survey_responses_retention_cap;
ALTER TABLE public.customer_survey_responses
  ADD CONSTRAINT customer_survey_responses_retention_cap
  CHECK (expires_at <= created_at + interval '365 days');

CREATE OR REPLACE FUNCTION public.clamp_customer_survey_retention()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_created_at timestamptz := COALESCE(NEW.created_at, now());
BEGIN
  NEW.expires_at := LEAST(
    COALESCE(NEW.expires_at, v_created_at + interval '365 days'),
    v_created_at + interval '365 days'
  );
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.clamp_customer_survey_retention()
  FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_clamp_customer_survey_retention
  ON public.customer_survey_responses;
CREATE TRIGGER trg_clamp_customer_survey_retention
  BEFORE INSERT OR UPDATE OF created_at, expires_at ON public.customer_survey_responses
  FOR EACH ROW EXECUTE FUNCTION public.clamp_customer_survey_retention();

-- Contact collection was removed. Scrub legacy values rather than retaining a
-- dormant direct identifier in otherwise anonymous research rows.
UPDATE public.customer_survey_responses
SET q23_contact = NULL,
    user_agent = NULL
WHERE q23_contact IS NOT NULL
   OR user_agent IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customer_survey_expires_at
  ON public.customer_survey_responses(expires_at);
CREATE INDEX IF NOT EXISTS idx_preregistrations_expires_at
  ON public.preregistrations(expires_at);
CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_reset_at
  ON public.rate_limit_buckets(reset_at);

CREATE OR REPLACE FUNCTION public.enforce_application_survey_retention()
RETURNS TABLE(preregistrations_deleted integer, survey_responses_deleted integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prereg integer;
  v_survey integer;
BEGIN
  DELETE FROM public.preregistrations
  WHERE expires_at <= now();
  GET DIAGNOSTICS v_prereg = ROW_COUNT;

  DELETE FROM public.customer_survey_responses
  WHERE expires_at <= now();
  GET DIAGNOSTICS v_survey = ROW_COUNT;

  RETURN QUERY SELECT v_prereg, v_survey;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_application_survey_retention()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_application_survey_retention()
  TO service_role;

CREATE OR REPLACE FUNCTION public.delete_expired_rate_limit_buckets()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.rate_limit_buckets
  WHERE reset_at < now() - interval '1 day';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_expired_rate_limit_buckets()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_expired_rate_limit_buckets()
  TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id
  FROM cron.job
  WHERE jobname = 'enforce-application-survey-retention'
  LIMIT 1;
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;
  PERFORM cron.schedule(
    'enforce-application-survey-retention',
    '41 18 * * *',
    'SELECT public.enforce_application_survey_retention();'
  );

  SELECT jobid INTO v_job_id
  FROM cron.job
  WHERE jobname = 'delete-expired-rate-limit-buckets'
  LIMIT 1;
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;
  PERFORM cron.schedule(
    'delete-expired-rate-limit-buckets',
    '47 18 * * *',
    'SELECT public.delete_expired_rate_limit_buckets();'
  );
END;
$$;

COMMENT ON COLUMN public.customer_survey_responses.expires_at IS
  'Anonymous product-research response deletion deadline (maximum 365 days).';
COMMENT ON FUNCTION public.enforce_application_survey_retention() IS
  'Daily deterministic deletion of expired beta applications and anonymous survey responses.';
