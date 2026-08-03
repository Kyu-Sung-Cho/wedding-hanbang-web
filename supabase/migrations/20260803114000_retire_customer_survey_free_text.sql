BEGIN;

-- Anonymous survey rows cannot be reliably mapped back to a person for later
-- access/deletion requests. Until reviewed DLP plus a bounded retention worker
-- exists, remove every historical free-text lane and make the retirement a DB
-- invariant rather than relying only on the current web route.
UPDATE public.customer_survey_responses
SET q7_other = NULL,
    q8_2_other = NULL,
    q11_other = NULL,
    q12_other = NULL,
    q17_other = NULL,
    q18_other = NULL,
    q21_feedback = NULL
WHERE q7_other IS NOT NULL
   OR q8_2_other IS NOT NULL
   OR q11_other IS NOT NULL
   OR q12_other IS NOT NULL
   OR q17_other IS NOT NULL
   OR q18_other IS NOT NULL
   OR q21_feedback IS NOT NULL;

ALTER TABLE public.customer_survey_responses
  DROP CONSTRAINT IF EXISTS customer_survey_responses_free_text_retired;
ALTER TABLE public.customer_survey_responses
  ADD CONSTRAINT customer_survey_responses_free_text_retired
  CHECK (
    q7_other IS NULL
    AND q8_2_other IS NULL
    AND q11_other IS NULL
    AND q12_other IS NULL
    AND q17_other IS NULL
    AND q18_other IS NULL
    AND q21_feedback IS NULL
  ) NOT VALID;
ALTER TABLE public.customer_survey_responses
  VALIDATE CONSTRAINT customer_survey_responses_free_text_retired;

COMMENT ON CONSTRAINT customer_survey_responses_free_text_retired
  ON public.customer_survey_responses IS
  'Fail-closed privacy fence: anonymous survey free text stays retired until reviewed DLP and automatic retention/deletion are deployed.';

DO $verify_customer_survey_free_text_retirement$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.customer_survey_responses
    WHERE q7_other IS NOT NULL
       OR q8_2_other IS NOT NULL
       OR q11_other IS NOT NULL
       OR q12_other IS NOT NULL
       OR q17_other IS NOT NULL
       OR q18_other IS NOT NULL
       OR q21_feedback IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'CUSTOMER_SURVEY_FREE_TEXT_REDACTION_INCOMPLETE'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.customer_survey_responses'::regclass
      AND conname = 'customer_survey_responses_free_text_retired'
      AND contype = 'c'
      AND convalidated
  ) THEN
    RAISE EXCEPTION 'CUSTOMER_SURVEY_FREE_TEXT_CONSTRAINT_MISSING'
      USING ERRCODE = '55000';
  END IF;
END;
$verify_customer_survey_free_text_retirement$;

COMMIT;
