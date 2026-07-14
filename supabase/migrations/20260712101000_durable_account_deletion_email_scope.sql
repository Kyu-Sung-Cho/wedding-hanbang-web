
SET lock_timeout = '5s';
SET statement_timeout = '120s';

-- The worker must be able to prove email-scoped PII deletion even after
-- GoTrue has already removed the auth row on a retry. The snapshot remains in
-- this service-only queue only while the deletion job is active and is scrubbed
-- atomically with the other subject identifiers at completion.
LOCK TABLE public.account_deletion_jobs IN ACCESS EXCLUSIVE MODE;

ALTER TABLE public.account_deletion_jobs
  ADD COLUMN email_scopes text[],
  ADD COLUMN email_snapshot_at timestamptz;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.account_deletion_jobs AS job
    LEFT JOIN auth.users AS auth_user ON auth_user.id = job.user_id
    WHERE job.status <> 'completed'
      AND (job.user_id IS NULL OR auth_user.id IS NULL)
  ) THEN
    RAISE EXCEPTION 'ACTIVE_DELETION_EMAIL_SNAPSHOT_RECONCILIATION_REQUIRED'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

UPDATE public.account_deletion_jobs AS job
SET email_scopes = CASE
      WHEN auth_user.email IS NULL THEN '{}'::text[]
      ELSE ARRAY[lower(btrim(auth_user.email))]
    END,
    email_snapshot_at = now(),
    updated_at = now()
FROM auth.users AS auth_user
WHERE job.status <> 'completed'
  AND job.user_id = auth_user.id;

CREATE OR REPLACE FUNCTION public.account_deletion_email_scopes_are_canonical(
  p_scopes text[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT cardinality(p_scopes) BETWEEN 0 AND 8
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(p_scopes) AS scope(value)
      WHERE scope.value IS NULL
        OR scope.value <> lower(btrim(scope.value))
        OR char_length(scope.value) < 3
        OR char_length(scope.value) > 320
        OR scope.value !~ '^[^[:space:]@]+@[^[:space:]@]+$'
    )
    AND cardinality(p_scopes) = (
      SELECT count(DISTINCT scope.value)
      FROM unnest(p_scopes) AS scope(value)
    );
$$;

ALTER FUNCTION public.account_deletion_email_scopes_are_canonical(text[])
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.account_deletion_email_scopes_are_canonical(text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_deletion_email_scopes_are_canonical(text[])
  TO service_role;

ALTER TABLE public.account_deletion_jobs
  ADD CONSTRAINT account_deletion_jobs_email_snapshot_lifecycle_check
    CHECK (
      (
        status = 'completed'
        AND email_scopes IS NULL
        AND email_snapshot_at IS NULL
      ) OR (
        status <> 'completed'
        AND email_scopes IS NOT NULL
        AND email_snapshot_at IS NOT NULL
      )
    ),
  ADD CONSTRAINT account_deletion_jobs_email_scopes_bounded_check
    CHECK (
      email_scopes IS NULL OR (
        cardinality(email_scopes) BETWEEN 0 AND 8
        AND array_position(email_scopes, NULL) IS NULL
      )
    ),
  ADD CONSTRAINT account_deletion_jobs_email_scopes_canonical_check
    CHECK (
      email_scopes IS NULL OR
      public.account_deletion_email_scopes_are_canonical(email_scopes)
    );

CREATE OR REPLACE FUNCTION public.request_account_deletion(
  p_user_id uuid,
  p_reason text DEFAULT 'unknown'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job public.account_deletion_jobs%ROWTYPE;
  v_inserted boolean := false;
  v_lifecycle jsonb := jsonb_build_object('profile_found', false);
  v_account_deleting_at timestamptz;
  v_reason text;
  v_subject_email text;
  v_email_scopes text[];
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user id is required' USING ERRCODE = '22023';
  END IF;

  SELECT lower(btrim(auth_user.email))
  INTO v_subject_email
  FROM auth.users AS auth_user
  WHERE auth_user.id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'auth subject is required for deletion snapshot'
      USING ERRCODE = '55000';
  END IF;
  v_email_scopes := CASE
    WHEN v_subject_email IS NULL THEN '{}'::text[]
    ELSE ARRAY[v_subject_email]
  END;

  v_reason := CASE
    WHEN p_reason IN (
      'unsatisfied', 'alternative', 'wedding_done', 'privacy',
      'low_usage', 'other', 'unknown'
    ) THEN p_reason
    ELSE 'unknown'
  END;

  INSERT INTO public.account_deletion_jobs (
    user_id, email_scopes, email_snapshot_at,
    reason, status, attempts, next_attempt_at
  ) VALUES (
    p_user_id, v_email_scopes, now(),
    v_reason, 'pending', 0, now()
  )
  ON CONFLICT (user_id) DO NOTHING
  RETURNING * INTO v_job;
  v_inserted := FOUND;

  IF NOT v_inserted THEN
    SELECT * INTO v_job
    FROM public.account_deletion_jobs
    WHERE user_id = p_user_id
    FOR UPDATE;

    -- A claimed worker owns the snapshot until it either completes or returns
    -- the job to retry. Mutating its scope concurrently could let completion
    -- scrub an address that worker has not deleted. Pending/retry/dead-letter
    -- rows are safe to extend append-only while this row lock is held.
    IF v_job.status <> 'processing' THEN
      UPDATE public.account_deletion_jobs
      SET email_scopes = ARRAY(
            SELECT DISTINCT scope
            FROM unnest(COALESCE(email_scopes, '{}'::text[]) || v_email_scopes)
              AS scope
            ORDER BY scope
          ),
          email_snapshot_at = now(),
          updated_at = now()
      WHERE id = v_job.id
      RETURNING * INTO v_job;
    END IF;
  END IF;

  SELECT account_deleting_at INTO v_account_deleting_at
  FROM public.profiles
  WHERE id = p_user_id;

  IF v_inserted OR v_account_deleting_at IS NULL THEN
    v_lifecycle := public.begin_account_deletion(p_user_id);
  ELSE
    v_lifecycle := jsonb_build_object(
      'profile_found', true,
      'account_deleting_at', v_account_deleting_at
    );
  END IF;

  RETURN jsonb_build_object(
    'job_id', v_job.id,
    'status', v_job.status,
    'attempts', v_job.attempts,
    'created', v_inserted,
    'profile_found', COALESCE((v_lifecycle->>'profile_found')::boolean, false)
  );
END;
$$;

ALTER FUNCTION public.request_account_deletion(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.request_account_deletion(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_account_deletion(uuid, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.renew_account_deletion_job_lease(
  p_job_id uuid,
  p_worker_token uuid,
  p_lease_seconds integer DEFAULT 600
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_renewed_id uuid;
BEGIN
  IF p_job_id IS NULL
    OR p_worker_token IS NULL
    OR p_lease_seconds IS NULL
    OR p_lease_seconds < 60
    OR p_lease_seconds > 600
  THEN
    RAISE EXCEPTION 'invalid account deletion lease arguments'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.account_deletion_jobs
  SET locked_until = GREATEST(
        locked_until,
        now() + make_interval(secs => p_lease_seconds)
      ),
      updated_at = now()
  WHERE id = p_job_id
    AND status = 'processing'
    AND lock_token = p_worker_token
    AND locked_until > now()
  RETURNING id INTO v_renewed_id;

  RETURN v_renewed_id = p_job_id;
END;
$$;

ALTER FUNCTION public.renew_account_deletion_job_lease(uuid, uuid, integer)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.renew_account_deletion_job_lease(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.renew_account_deletion_job_lease(uuid, uuid, integer)
  TO service_role;

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

  -- Central rollback-compatible guarantee: even an older web worker that does
  -- not know the research table cannot complete while email-scoped PII remains.
  DELETE FROM public.preregistrations
  WHERE email = ANY(v_email_scopes);
  DELETE FROM public.research_cohort_applications
  WHERE email = ANY(v_email_scopes);
  UPDATE public.account_deletions
  SET user_id = NULL,
      email = NULL,
      reason = 'unknown'
  WHERE email = ANY(v_email_scopes);

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

COMMENT ON TABLE public.account_deletion_jobs IS
  'Service-only durable deletion queue. Temporary subject identifiers and storage inventory are scrubbed on completion.';
COMMENT ON COLUMN public.account_deletion_jobs.email_scopes IS
  'Temporary normalized email scopes used only to prove email-scoped PII deletion across retries; NULL after completion.';
COMMENT ON COLUMN public.account_deletion_jobs.email_snapshot_at IS
  'Time the temporary email scope was captured or refreshed; NULL after completion.';
