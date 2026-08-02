BEGIN;

ALTER TABLE public.customer_survey_responses
  ADD COLUMN IF NOT EXISTS survey_consent_version text,
  ADD COLUMN IF NOT EXISTS survey_consented_at timestamptz;

ALTER TABLE public.customer_survey_responses
  DROP CONSTRAINT IF EXISTS customer_survey_consent_evidence_paired;
ALTER TABLE public.customer_survey_responses
  ADD CONSTRAINT customer_survey_consent_evidence_paired
  CHECK (
    (survey_consent_version IS NULL AND survey_consented_at IS NULL)
    OR (
      survey_consent_version = '2026-08-02'
      AND survey_consented_at IS NOT NULL
    )
  );

CREATE OR REPLACE FUNCTION public.enforce_customer_survey_consent_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.survey_consent_version IS DISTINCT FROM '2026-08-02'
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
REVOKE ALL ON FUNCTION public.enforce_customer_survey_consent_evidence() FROM anon, authenticated;

DROP TRIGGER IF EXISTS enforce_customer_survey_consent_evidence
  ON public.customer_survey_responses;
CREATE TRIGGER enforce_customer_survey_consent_evidence
BEFORE INSERT OR UPDATE OF survey_consent_version, survey_consented_at
ON public.customer_survey_responses
FOR EACH ROW
EXECUTE FUNCTION public.enforce_customer_survey_consent_evidence();

REVOKE SELECT (survey_consent_version, survey_consented_at)
  ON public.customer_survey_responses FROM anon, authenticated;

COMMENT ON COLUMN public.customer_survey_responses.survey_consent_version IS
  'Exact notice version explicitly accepted before this anonymous survey response was submitted; NULL denotes an unverifiable legacy row.';
COMMENT ON COLUMN public.customer_survey_responses.survey_consented_at IS
  'Server-recorded time of the current-version survey consent; immutable after insert.';

DO $verify$
DECLARE
  trigger_function oid := 'public.enforce_customer_survey_consent_evidence()'::regprocedure;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'public.customer_survey_responses'::regclass
      AND attname = 'survey_consent_version'
      AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'public.customer_survey_responses'::regclass
      AND attname = 'survey_consented_at'
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'customer survey consent evidence columns are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.customer_survey_responses'::regclass
      AND tgname = 'enforce_customer_survey_consent_evidence'
      AND tgfoid = trigger_function
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'customer survey consent evidence trigger is missing';
  END IF;

  IF has_function_privilege('anon', trigger_function, 'EXECUTE')
    OR has_function_privilege('authenticated', trigger_function, 'EXECUTE')
  THEN
    RAISE EXCEPTION 'customer survey consent trigger function remains executable by clients';
  END IF;
END;
$verify$;

COMMIT;
