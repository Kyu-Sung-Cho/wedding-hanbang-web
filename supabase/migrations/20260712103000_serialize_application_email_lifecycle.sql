
SET lock_timeout = '5s';
SET statement_timeout = '90s';

LOCK TABLE public.account_deletion_jobs IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.preregistrations IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.research_cohort_applications IN SHARE ROW EXCLUSIVE MODE;

-- New public research intake and account-deletion completion share the same
-- normalized-email transaction lock. Existing application emails are immutable:
-- ordinary receipt/verification status updates take no advisory lock, so they
-- cannot invert the completion path's advisory-lock -> row-lock order.
CREATE OR REPLACE FUNCTION public.lock_application_email_lifecycle_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_email text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.email IS DISTINCT FROM OLD.email THEN
      RAISE EXCEPTION 'application email is immutable'
        USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;

  v_email := lower(btrim(NEW.email));
  IF v_email IS NULL
    OR char_length(v_email) < 3
    OR char_length(v_email) > 320
    OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+$'
  THEN
    RAISE EXCEPTION 'canonical application email is required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'hanbang:application-email-lifecycle:' || v_email,
      0
    )
  );
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.lock_application_email_lifecycle_write()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.lock_application_email_lifecycle_write()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lock_application_email_lifecycle_write()
  TO service_role;

DROP TRIGGER IF EXISTS trg_lock_preregistration_email_lifecycle
  ON public.preregistrations;
CREATE TRIGGER trg_lock_preregistration_email_lifecycle
  BEFORE INSERT OR UPDATE ON public.preregistrations
  FOR EACH ROW
  EXECUTE FUNCTION public.lock_application_email_lifecycle_write();

DROP TRIGGER IF EXISTS trg_lock_research_cohort_application_email_lifecycle
  ON public.research_cohort_applications;
CREATE TRIGGER trg_lock_research_cohort_application_email_lifecycle
  BEFORE INSERT OR UPDATE ON public.research_cohort_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.lock_application_email_lifecycle_write();

CREATE OR REPLACE FUNCTION public.complete_account_deletion_job(
  p_job_id uuid,
  p_worker_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reason text;
  v_email_scopes text[];
  v_email_scope text;
BEGIN
  SELECT reason, email_scopes INTO v_reason, v_email_scopes
  FROM public.account_deletion_jobs
  WHERE id = p_job_id
    AND status = 'processing'
    AND lock_token = p_worker_token
    AND locked_until > now()
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF v_email_scopes IS NULL THEN
    RAISE EXCEPTION 'account deletion email scope is not attested'
      USING ERRCODE = '55000';
  END IF;

  -- Acquire multiple scopes in canonical order so retries cannot deadlock each
  -- other. Hash collisions only serialize unrelated addresses; they never
  -- weaken deletion.
  FOR v_email_scope IN
    SELECT DISTINCT lower(btrim(scope.value))
    FROM unnest(v_email_scopes) AS scope(value)
    ORDER BY 1
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'hanbang:application-email-lifecycle:' || v_email_scope,
        0
      )
    );
  END LOOP;

  -- Case-fold at deletion time as well so legacy rows created before canonical
  -- email constraints cannot survive a subject deletion.
  DELETE FROM public.preregistrations
  WHERE lower(btrim(email)) = ANY(v_email_scopes);
  DELETE FROM public.research_cohort_applications
  WHERE lower(btrim(email)) = ANY(v_email_scopes);
  UPDATE public.account_deletions
  SET user_id = NULL,
      email = NULL,
      reason = 'unknown'
  WHERE lower(btrim(email)) = ANY(v_email_scopes);

  INSERT INTO public.account_deletions (user_id, email, reason, deleted_at)
  VALUES (NULL, NULL, v_reason, now());

  UPDATE public.account_deletion_jobs
  SET user_id = NULL,
      email_scopes = NULL,
      email_snapshot_at = NULL,
      status = 'completed',
      lock_token = NULL,
      locked_until = NULL,
      storage_inventory = NULL,
      next_attempt_at = NULL,
      last_error_code = NULL,
      completed_at = now(),
      dead_lettered_at = NULL,
      updated_at = now()
  WHERE id = p_job_id;

  RETURN true;
END;
$$;

ALTER FUNCTION public.complete_account_deletion_job(uuid, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.complete_account_deletion_job(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_account_deletion_job(uuid, uuid)
  TO service_role;

DO $$
DECLARE
  v_expected_function oid :=
    'public.lock_application_email_lifecycle_write()'::regprocedure;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      VALUES
        ('public'::text, 'preregistrations'::text,
          'trg_lock_preregistration_email_lifecycle'::text),
        ('public'::text, 'research_cohort_applications'::text,
          'trg_lock_research_cohort_application_email_lifecycle'::text)
    ) AS expected(schema_name, table_name, trigger_name)
    LEFT JOIN pg_catalog.pg_namespace AS namespace_row
      ON namespace_row.nspname = expected.schema_name
    LEFT JOIN pg_catalog.pg_class AS table_row
      ON table_row.relnamespace = namespace_row.oid
     AND table_row.relname = expected.table_name
    LEFT JOIN pg_catalog.pg_trigger AS trigger_row
      ON trigger_row.tgrelid = table_row.oid
     AND trigger_row.tgname = expected.trigger_name
     AND NOT trigger_row.tgisinternal
    WHERE trigger_row.oid IS NULL
      OR trigger_row.tgfoid IS DISTINCT FROM v_expected_function
      OR trigger_row.tgenabled <> 'O'
  ) THEN
    RAISE EXCEPTION 'APPLICATION_EMAIL_LIFECYCLE_TRIGGER_CONTRACT_MISMATCH'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.lock_application_email_lifecycle_write() IS
  'Serializes application INSERT with account-deletion completion and rejects email mutation without locking ordinary status UPDATEs.';
