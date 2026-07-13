BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

LOCK TABLE auth.users IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.account_deletion_jobs IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE;

-- Drain an identity update that started before the deletion marker, and keep
-- later GoTrue updates behind the auth.users fence installed immediately
-- before this migration. The deletion snapshot therefore observes the last
-- committed provider email before account deletion starts.
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
  WHERE auth_user.id = p_user_id
  FOR UPDATE OF auth_user;
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
    -- the job to retry. Pending/retry/dead-letter rows are safe to extend while
    -- this row lock is held; a processing worker performs its own final read.
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

COMMENT ON FUNCTION public.request_account_deletion(uuid, text) IS
  'Creates a durable deletion job after draining and locking provider identity updates.';

COMMIT;
