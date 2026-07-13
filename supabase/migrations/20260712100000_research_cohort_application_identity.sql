BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- A separate table preserves rollback compatibility with the currently
-- deployed preregistration API, whose email-only uniqueness must remain intact.
-- No legacy consent is inferred as consent for this specific research cohort.
CREATE TABLE public.research_cohort_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_code text NOT NULL,
  email text NOT NULL,
  name text,
  wedding_date date,
  role text NOT NULL,
  message text,
  source text NOT NULL DEFAULT 'research',
  utm_source text,
  utm_medium text,
  utm_campaign text,
  privacy_consent_at timestamptz NOT NULL,
  privacy_policy_version text NOT NULL,
  email_verified_at timestamptz,
  receipt_email_status text NOT NULL DEFAULT 'pending',
  receipt_email_attempted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '180 days'),
  CONSTRAINT research_cohort_applications_identity_key
    UNIQUE (cohort_code, email),
  CONSTRAINT research_cohort_applications_cohort_check
    CHECK (cohort_code = 'research-2026-h2'),
  CONSTRAINT research_cohort_applications_email_identity_check
    CHECK (
      email = lower(btrim(email))
      AND char_length(email) BETWEEN 3 AND 254
      AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    ),
  CONSTRAINT research_cohort_applications_name_check
    CHECK (
      name IS NULL OR (
        name = btrim(name)
        AND char_length(name) BETWEEN 1 AND 60
      )
    ),
  CONSTRAINT research_cohort_applications_wedding_date_window_check
    CHECK (
      wedding_date IS NULL OR
      wedding_date BETWEEN DATE '2026-07-01' AND DATE '2026-12-31'
    ),
  CONSTRAINT research_cohort_applications_role_check
    CHECK (role IN ('bride', 'groom')),
  CONSTRAINT research_cohort_applications_message_check
    CHECK (
      message IS NULL OR (
        message = btrim(message)
        AND char_length(message) BETWEEN 1 AND 500
      )
    ),
  CONSTRAINT research_cohort_applications_source_check
    CHECK (source = 'research'),
  CONSTRAINT research_cohort_applications_utm_source_check
    CHECK (
      utm_source IS NULL OR (
        utm_source = btrim(utm_source)
        AND char_length(utm_source) BETWEEN 1 AND 80
      )
    ),
  CONSTRAINT research_cohort_applications_utm_medium_check
    CHECK (
      utm_medium IS NULL OR (
        utm_medium = btrim(utm_medium)
        AND char_length(utm_medium) BETWEEN 1 AND 80
      )
    ),
  CONSTRAINT research_cohort_applications_utm_campaign_check
    CHECK (
      utm_campaign IS NULL OR (
        utm_campaign = btrim(utm_campaign)
        AND char_length(utm_campaign) BETWEEN 1 AND 120
      )
    ),
  CONSTRAINT research_cohort_applications_privacy_consent_timestamp_check
    CHECK (privacy_consent_at = created_at),
  CONSTRAINT research_cohort_applications_privacy_policy_check
    CHECK (privacy_policy_version = '2026-07-12'),
  CONSTRAINT research_cohort_applications_receipt_status_check
    CHECK (receipt_email_status IN ('pending', 'sent', 'failed')),
  CONSTRAINT research_cohort_applications_receipt_lifecycle_check
    CHECK (
      (
        receipt_email_status = 'pending'
        AND receipt_email_attempted_at IS NULL
      ) OR (
        receipt_email_status IN ('sent', 'failed')
        AND receipt_email_attempted_at IS NOT NULL
        AND receipt_email_attempted_at >= created_at
        AND receipt_email_attempted_at <= expires_at
      )
    ),
  CONSTRAINT research_cohort_applications_retention_cap
    CHECK (
      expires_at >= created_at
      AND expires_at <= created_at + interval '180 days'
    ),
  CONSTRAINT research_cohort_applications_email_verification_window_check
    CHECK (
      email_verified_at IS NULL OR (
        email_verified_at >= created_at
        AND email_verified_at <= expires_at
      )
    )
);

ALTER TABLE public.research_cohort_applications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.research_cohort_applications
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.research_cohort_applications TO service_role;

CREATE INDEX idx_research_cohort_applications_expires_at
  ON public.research_cohort_applications(expires_at);
CREATE INDEX idx_research_cohort_applications_current
  ON public.research_cohort_applications(cohort_code, created_at DESC)
  WHERE privacy_consent_at IS NOT NULL AND email_verified_at IS NOT NULL;

CREATE TRIGGER trg_clamp_research_cohort_application_retention
  BEFORE INSERT OR UPDATE OF created_at, expires_at
  ON public.research_cohort_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.clamp_preregistration_retention();

CREATE OR REPLACE FUNCTION public.enforce_application_survey_retention()
RETURNS TABLE(preregistrations_deleted integer, survey_responses_deleted integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_preregistrations integer := 0;
  v_research_applications integer := 0;
  v_surveys integer := 0;
BEGIN
  DELETE FROM public.preregistrations
  WHERE expires_at <= now();
  GET DIAGNOSTICS v_preregistrations = ROW_COUNT;

  DELETE FROM public.research_cohort_applications
  WHERE expires_at <= now();
  GET DIAGNOSTICS v_research_applications = ROW_COUNT;

  DELETE FROM public.customer_survey_responses
  WHERE expires_at <= now();
  GET DIAGNOSTICS v_surveys = ROW_COUNT;

  preregistrations_deleted := v_preregistrations + v_research_applications;
  survey_responses_deleted := v_surveys;
  RETURN NEXT;
END;
$$;

ALTER FUNCTION public.enforce_application_survey_retention() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enforce_application_survey_retention()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_application_survey_retention()
  TO service_role;

COMMENT ON TABLE public.research_cohort_applications IS
  'Purpose-scoped applications for the 2026 H2 six-week user research cohort.';
COMMENT ON COLUMN public.research_cohort_applications.receipt_email_status IS
  'Best-effort email-verification delivery state; selection notifications are separate.';
COMMENT ON COLUMN public.research_cohort_applications.email_verified_at IS
  'Mailbox-ownership confirmation time. Only verified rows are selection-eligible.';

COMMIT;
