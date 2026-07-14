SET lock_timeout = '5s';
SET statement_timeout = '90s';

-- A provider idempotency key is a privileged operational secret. Queue reads
-- return only an opaque verdict id and timestamps. Revealing one key requires
-- an active administrator and atomically appends an audit event that never
-- duplicates the key, case, subject, request payload, or provider evidence.
CREATE TABLE public.court_provider_request_key_reveal_audits (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  target_scope text NOT NULL CHECK (
    target_scope IN ('live_reservation', 'deleted_handoff')
  ),
  target_id uuid NOT NULL,
  actor_admin_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action = 'request_key_revealed'),
  revealed_at timestamptz NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT (
    pg_catalog.statement_timestamp() + pg_catalog.make_interval(years => 1)
  ),
  CONSTRAINT court_provider_request_key_reveal_audits_retention_check CHECK (
    expires_at > revealed_at
      AND expires_at <= revealed_at + pg_catalog.make_interval(years => 1)
  )
);

CREATE INDEX court_provider_request_key_reveal_audits_target_idx
  ON public.court_provider_request_key_reveal_audits(
    target_scope, target_id, revealed_at DESC
  );
CREATE INDEX court_provider_request_key_reveal_audits_actor_idx
  ON public.court_provider_request_key_reveal_audits(actor_admin_id, revealed_at DESC)
  WHERE actor_admin_id IS NOT NULL;
CREATE INDEX court_provider_request_key_reveal_audits_expiry_idx
  ON public.court_provider_request_key_reveal_audits(expires_at, id);

ALTER TABLE public.court_provider_request_key_reveal_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.court_provider_request_key_reveal_audits OWNER TO postgres;
REVOKE ALL ON TABLE public.court_provider_request_key_reveal_audits
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.court_provider_request_key_reveal_audits TO service_role;
CREATE POLICY court_provider_request_key_reveal_audits_service_select
  ON public.court_provider_request_key_reveal_audits
  FOR SELECT
  TO service_role
  USING (true);

COMMENT ON TABLE public.court_provider_request_key_reveal_audits IS
  'Append-only one-year administrator audit of individual live or deleted-subject provider-key reveals. Contains an opaque target scope/id, administrator actor, action, and timestamps only; never a request key, subject, case, payload, model, usage, cost, or free-form text.';
COMMENT ON COLUMN public.court_provider_request_key_reveal_audits.actor_admin_id IS
  'Active administrator who revealed the key. ON DELETE SET NULL anonymizes the audit if that administrator deletes their account.';
COMMENT ON COLUMN public.court_provider_request_key_reveal_audits.expires_at IS
  'Hard one-year row-level audit horizon, aligned with the maximum AI audit row horizon while retaining no AI payload or provider key.';

-- Reassert that the base table has no direct service-role capability. All
-- operational reads use active-admin SECURITY DEFINER functions with fixed
-- result shapes.
REVOKE ALL ON TABLE public.court_provider_deletion_handoffs FROM service_role;

CREATE FUNCTION public.list_court_provider_deletion_handoffs(
  p_actor_id uuid,
  p_limit integer DEFAULT 50
)
RETURNS TABLE(
  verdict_id uuid,
  created_at timestamptz,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_actor_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'invalid court provider deletion handoff list arguments'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.profiles AS profile
  WHERE profile.id = p_actor_id
    AND profile.account_deleting_at IS NULL
    AND profile.is_admin = true
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court provider deletion handoff list requires an active admin'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT handoff.verdict_id, handoff.created_at, handoff.expires_at
  FROM public.court_provider_deletion_handoffs AS handoff
  WHERE handoff.handoff_state = 'provider_unknown'
    AND handoff.expires_at > pg_catalog.clock_timestamp()
  ORDER BY handoff.created_at, handoff.verdict_id
  LIMIT p_limit;
END;
$$;

ALTER FUNCTION public.list_court_provider_deletion_handoffs(uuid, integer)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_court_provider_deletion_handoffs(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_court_provider_deletion_handoffs(uuid, integer)
  TO service_role;

CREATE FUNCTION public.list_court_provider_reconciliations(
  p_actor_id uuid,
  p_limit integer DEFAULT 50
)
RETURNS TABLE(
  verdict_id uuid,
  provider_state text,
  started_at timestamptz,
  failed_at timestamptz,
  provider_error_code text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_actor_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'invalid court provider reconciliation list arguments'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.profiles AS profile
  WHERE profile.id = p_actor_id
    AND profile.account_deleting_at IS NULL
    AND profile.is_admin = true
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court provider reconciliation list requires an active admin'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT reservation.verdict_id,
         reservation.provider_state,
         reservation.started_at,
         reservation.failed_at,
         reservation.provider_error_code,
         reservation.created_at,
         reservation.updated_at
  FROM public.court_provider_reservations AS reservation
  WHERE (
    reservation.provider_state = 'failed_unknown'
      AND reservation.provider_error_code
        IS DISTINCT FROM 'safety_escalation_failed'
  ) OR (
    reservation.provider_state = 'failed_invalid'
      AND reservation.provider_error_code = 'provider_result_unstaged'
      AND reservation.provider_audit_state = 'audited'
  )
  ORDER BY reservation.failed_at NULLS FIRST, reservation.verdict_id
  LIMIT p_limit;
END;
$$;

ALTER FUNCTION public.list_court_provider_reconciliations(uuid, integer)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_court_provider_reconciliations(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_court_provider_reconciliations(uuid, integer)
  TO service_role;

CREATE FUNCTION public.reveal_court_provider_deletion_handoff_request_key(
  p_verdict_id uuid,
  p_admin_user_id uuid,
  p_confirmation text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_handoff public.court_provider_deletion_handoffs%ROWTYPE;
  v_revealed_at timestamptz;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_verdict_id IS NULL OR p_admin_user_id IS NULL
    OR p_confirmation IS DISTINCT FROM 'REVEAL_PROVIDER_REQUEST_KEY'
  THEN
    RAISE EXCEPTION 'invalid court provider deletion handoff reveal arguments'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.profiles AS profile
  WHERE profile.id = p_admin_user_id
    AND profile.account_deleting_at IS NULL
    AND profile.is_admin = true
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court provider deletion handoff reveal requires an active admin'
      USING ERRCODE = '42501';
  END IF;

  SELECT handoff.* INTO v_handoff
  FROM public.court_provider_deletion_handoffs AS handoff
  WHERE handoff.verdict_id = p_verdict_id
    AND handoff.handoff_state = 'provider_unknown'
    AND handoff.expires_at > pg_catalog.clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court provider deletion handoff is unavailable'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.court_provider_request_key_reveal_audits (
    target_scope,
    target_id,
    actor_admin_id,
    action
  ) VALUES (
    'deleted_handoff',
    v_handoff.id,
    p_admin_user_id,
    'request_key_revealed'
  )
  RETURNING revealed_at INTO v_revealed_at;

  RETURN pg_catalog.jsonb_build_object(
    'verdict_id', v_handoff.verdict_id,
    'request_key', v_handoff.request_key,
    'revealed_at', v_revealed_at
  );
END;
$$;

ALTER FUNCTION public.reveal_court_provider_deletion_handoff_request_key(
  uuid, uuid, text
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reveal_court_provider_deletion_handoff_request_key(
  uuid, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reveal_court_provider_deletion_handoff_request_key(
  uuid, uuid, text
) TO service_role;

CREATE FUNCTION public.reveal_court_provider_reconciliation_request_key(
  p_verdict_id uuid,
  p_admin_user_id uuid,
  p_confirmation text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_reservation public.court_provider_reservations%ROWTYPE;
  v_revealed_at timestamptz;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_verdict_id IS NULL OR p_admin_user_id IS NULL
    OR p_confirmation IS DISTINCT FROM 'REVEAL_PROVIDER_REQUEST_KEY'
  THEN
    RAISE EXCEPTION 'invalid court provider reconciliation reveal arguments'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.profiles AS profile
  WHERE profile.id = p_admin_user_id
    AND profile.account_deleting_at IS NULL
    AND profile.is_admin = true
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court provider reconciliation reveal requires an active admin'
      USING ERRCODE = '42501';
  END IF;

  SELECT reservation.* INTO v_reservation
  FROM public.court_provider_reservations AS reservation
  WHERE reservation.verdict_id = p_verdict_id
    AND ((
      reservation.provider_state = 'failed_unknown'
        AND reservation.provider_error_code
          IS DISTINCT FROM 'safety_escalation_failed'
    ) OR (
      reservation.provider_state = 'failed_invalid'
        AND reservation.provider_error_code = 'provider_result_unstaged'
        AND reservation.provider_audit_state = 'audited'
    ))
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court provider reconciliation is unavailable'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.court_provider_request_key_reveal_audits (
    target_scope,
    target_id,
    actor_admin_id,
    action
  ) VALUES (
    'live_reservation',
    v_reservation.verdict_id,
    p_admin_user_id,
    'request_key_revealed'
  )
  RETURNING revealed_at INTO v_revealed_at;

  RETURN pg_catalog.jsonb_build_object(
    'verdict_id', v_reservation.verdict_id,
    'request_key', v_reservation.request_key,
    'revealed_at', v_revealed_at
  );
END;
$$;

ALTER FUNCTION public.reveal_court_provider_reconciliation_request_key(
  uuid, uuid, text
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reveal_court_provider_reconciliation_request_key(
  uuid, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reveal_court_provider_reconciliation_request_key(
  uuid, uuid, text
) TO service_role;

CREATE FUNCTION public.enforce_court_provider_request_key_reveal_audit_retention(
  p_batch_size integer DEFAULT 1000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'invalid court provider handoff reveal audit retention batch size'
      USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(20260714103000::bigint);

  WITH due AS MATERIALIZED (
    SELECT audit.id
    FROM public.court_provider_request_key_reveal_audits AS audit
    WHERE audit.expires_at <= pg_catalog.clock_timestamp()
    ORDER BY audit.expires_at, audit.id
    LIMIT p_batch_size
    FOR UPDATE OF audit SKIP LOCKED
  )
  DELETE FROM public.court_provider_request_key_reveal_audits AS audit
  USING due
  WHERE audit.id = due.id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

ALTER FUNCTION public.enforce_court_provider_request_key_reveal_audit_retention(integer)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enforce_court_provider_request_key_reveal_audit_retention(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_court_provider_request_key_reveal_audit_retention(integer)
  TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$
DECLARE
  v_job_id bigint;
BEGIN
  FOR v_job_id IN
    SELECT jobid
    FROM cron.job
    WHERE jobname = 'enforce-court-provider-request-key-reveal-audit-retention'
  LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;
  PERFORM cron.schedule(
    'enforce-court-provider-request-key-reveal-audit-retention',
    '37 * * * *',
    'SELECT public.enforce_court_provider_request_key_reveal_audit_retention(1000);'
  );
END;
$$;
