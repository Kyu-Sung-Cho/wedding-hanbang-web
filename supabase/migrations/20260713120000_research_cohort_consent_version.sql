-- Preserve historical consent provenance while allowing only the current
-- privacy notice for any future, separately reviewed research-intake release.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- DROP/ADD CONSTRAINT requires ACCESS EXCLUSIVE. Acquire it up front so the
-- bounded lock timeout fails before any validation work or DDL lock upgrade.
LOCK TABLE public.research_cohort_applications IN ACCESS EXCLUSIVE MODE;

ALTER TABLE public.research_cohort_applications
  DROP CONSTRAINT IF EXISTS research_cohort_applications_privacy_policy_check;

ALTER TABLE public.research_cohort_applications
  ADD CONSTRAINT research_cohort_applications_privacy_policy_check
  CHECK (privacy_policy_version IN ('2026-07-12', '2026-07-14'))
  NOT VALID;

ALTER TABLE public.research_cohort_applications
  VALIDATE CONSTRAINT research_cohort_applications_privacy_policy_check;

COMMENT ON COLUMN public.research_cohort_applications.privacy_policy_version IS
  'Exact privacy-notice version accepted at submission; historical 2026-07-12 consent remains unchanged and new submissions use 2026-07-14.';

DO $$
DECLARE
  v_constraint_definition text;
BEGIN
  SELECT pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
  INTO v_constraint_definition
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid =
        'public.research_cohort_applications'::pg_catalog.regclass
    AND constraint_row.conname =
        'research_cohort_applications_privacy_policy_check'
    AND constraint_row.contype = 'c'
    AND constraint_row.convalidated;

  IF v_constraint_definition IS DISTINCT FROM
       'CHECK (privacy_policy_version = ANY (ARRAY[''2026-07-12''::text, ''2026-07-14''::text]))' THEN
    RAISE EXCEPTION 'research cohort privacy-policy version constraint is not exact';
  END IF;
END
$$;

COMMIT;
