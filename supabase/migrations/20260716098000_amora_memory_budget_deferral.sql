-- Release a memory-compiler lease when the paid-call budget is unavailable.
-- This is an upgrade migration because 0900 may already exist in preview DBs.

CREATE OR REPLACE FUNCTION public.defer_amora_memory_job(
  p_job_id uuid,
  p_attempt_count integer,
  p_defer_seconds integer,
  p_reason_code text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_rows integer;
BEGIN
  IF p_attempt_count NOT BETWEEN 1 AND 5
     OR p_defer_seconds NOT BETWEEN 60 AND 86400
     OR p_reason_code IS NULL
     OR p_reason_code !~ '^[A-Z0-9_]{1,64}$' THEN
    RAISE EXCEPTION 'AMORA_MEMORY_JOB_DEFER_INVALID' USING ERRCODE = '22023';
  END IF;

  UPDATE public.amora_memory_jobs
  SET status = 'pending',
      attempt_count = attempt_count - 1,
      available_at = now() + make_interval(secs => p_defer_seconds),
      claimed_at = NULL,
      completed_at = NULL,
      last_error_code = p_reason_code,
      updated_at = now()
  WHERE id = p_job_id
    AND status = 'processing'
    AND attempt_count = p_attempt_count;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END
$function$;

ALTER FUNCTION public.defer_amora_memory_job(uuid, integer, integer, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.defer_amora_memory_job(uuid, integer, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.defer_amora_memory_job(uuid, integer, integer, text)
  TO service_role;

DO $postconditions$
DECLARE
  v_acl aclitem[];
BEGIN
  IF to_regprocedure('public.defer_amora_memory_job(uuid,integer,integer,text)') IS NULL THEN
    RAISE EXCEPTION 'AMORA_MEMORY_BUDGET_DEFERRAL_FUNCTION_MISSING';
  END IF;

  SELECT proacl INTO v_acl
  FROM pg_catalog.pg_proc
  WHERE oid = to_regprocedure('public.defer_amora_memory_job(uuid,integer,integer,text)');

  IF pg_catalog.has_function_privilege(
       'anon', 'public.defer_amora_memory_job(uuid,integer,integer,text)', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated', 'public.defer_amora_memory_job(uuid,integer,integer,text)', 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'service_role', 'public.defer_amora_memory_job(uuid,integer,integer,text)', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'AMORA_MEMORY_BUDGET_DEFERRAL_ACL_INVALID: %', v_acl;
  END IF;
END
$postconditions$;

COMMENT ON FUNCTION public.defer_amora_memory_job(uuid, integer, integer, text) IS
  'Service-only stale-attempt-fenced lease release for pre-generation budget/config deferral.';
