BEGIN;

-- The anonymous survey notice changed when every free-text lane was retired.
-- Preserve the exact version on older rows, but require the new notice for all
-- submissions created after this migration.
ALTER TABLE public.customer_survey_responses
  DROP CONSTRAINT IF EXISTS customer_survey_consent_evidence_paired;
ALTER TABLE public.customer_survey_responses
  ADD CONSTRAINT customer_survey_consent_evidence_paired
  CHECK (
    (survey_consent_version IS NULL AND survey_consented_at IS NULL)
    OR (
      survey_consent_version IN ('2026-08-02', '2026-08-03')
      AND survey_consented_at IS NOT NULL
    )
  ) NOT VALID;
ALTER TABLE public.customer_survey_responses
  VALIDATE CONSTRAINT customer_survey_consent_evidence_paired;

CREATE OR REPLACE FUNCTION public.enforce_customer_survey_consent_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.survey_consent_version IS DISTINCT FROM '2026-08-03'
      OR NEW.survey_consented_at IS NULL
      OR NEW.survey_consented_at < statement_timestamp() - interval '24 hours'
      OR NEW.survey_consented_at > statement_timestamp() + interval '5 minutes'
    THEN
      RAISE EXCEPTION 'current customer survey consent evidence is required'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.survey_consent_version IS DISTINCT FROM OLD.survey_consent_version
    OR NEW.survey_consented_at IS DISTINCT FROM OLD.survey_consented_at
  THEN
    RAISE EXCEPTION 'customer survey consent evidence is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_customer_survey_consent_evidence() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_customer_survey_consent_evidence()
  FROM anon, authenticated;

COMMENT ON COLUMN public.customer_survey_responses.survey_consent_version IS
  'Exact anonymous-survey notice version accepted by the respondent; NULL denotes an unverifiable legacy row.';

DO $verify_customer_survey_consent_version$
DECLARE
  trigger_function oid := 'public.enforce_customer_survey_consent_evidence()'::regprocedure;
  consent_constraint text;
  trigger_definition text;
BEGIN
  SELECT pg_get_constraintdef(oid)
  INTO consent_constraint
  FROM pg_catalog.pg_constraint
  WHERE conrelid = 'public.customer_survey_responses'::regclass
    AND conname = 'customer_survey_consent_evidence_paired'
    AND contype = 'c'
    AND convalidated;

  IF consent_constraint IS NULL
    OR position('2026-08-02' IN consent_constraint) = 0
    OR position('2026-08-03' IN consent_constraint) = 0
  THEN
    RAISE EXCEPTION 'CUSTOMER_SURVEY_CONSENT_VERSION_CONSTRAINT_INVALID'
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_get_functiondef(trigger_function) INTO trigger_definition;
  IF trigger_definition IS NULL
    OR position('2026-08-03' IN trigger_definition) = 0
  THEN
    RAISE EXCEPTION 'CUSTOMER_SURVEY_CURRENT_CONSENT_TRIGGER_INVALID'
      USING ERRCODE = '55000';
  END IF;

  IF has_function_privilege('anon', trigger_function, 'EXECUTE')
    OR has_function_privilege('authenticated', trigger_function, 'EXECUTE')
  THEN
    RAISE EXCEPTION 'customer survey consent trigger function remains executable by clients';
  END IF;
END;
$verify_customer_survey_consent_version$;

COMMIT;
