SET lock_timeout = '5s';
SET statement_timeout = '90s';

-- Account deletion intentionally removes the complete two-person Court graph.
-- Preserve only the opaque provider-attempt identity required to settle one
-- already-started call. This table must never become a shadow case record.
CREATE TABLE public.court_provider_deletion_handoffs (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  request_key text NOT NULL UNIQUE CHECK (request_key ~ '^[a-f0-9]{64}$'),
  verdict_id uuid NOT NULL,
  lease_token uuid,
  handoff_state text NOT NULL CHECK (
    handoff_state IN ('provider_unknown', 'audit_pending', 'audited', 'resolved_no_charge')
  ),
  audit_model text CHECK (
    audit_model IS NULL OR audit_model ~ '^[A-Za-z0-9._:/-]{1,128}$'
  ),
  provider_input_tokens integer CHECK (
    provider_input_tokens IS NULL OR provider_input_tokens BETWEEN 0 AND 10000000
  ),
  provider_output_tokens integer CHECK (
    provider_output_tokens IS NULL OR provider_output_tokens BETWEEN 0 AND 10000000
  ),
  provider_cached_input_tokens integer CHECK (
    provider_cached_input_tokens IS NULL OR provider_cached_input_tokens BETWEEN 0 AND 10000000
  ),
  provider_cache_write_input_tokens integer CHECK (
    provider_cache_write_input_tokens IS NULL OR provider_cache_write_input_tokens BETWEEN 0 AND 10000000
  ),
  audit_cost_usd numeric(10,6) CHECK (
    audit_cost_usd IS NULL OR (
      audit_cost_usd >= 0 AND audit_cost_usd <= 9999.999999
    )
  ),
  paid_observed_at timestamptz,
  audit_pending_at timestamptz,
  audited_at timestamptz,
  resolved_at timestamptz,
  recovery_lease_token uuid,
  recovery_lease_expires_at timestamptz,
  recovery_attempt_count integer NOT NULL DEFAULT 0 CHECK (
    recovery_attempt_count BETWEEN 0 AND 10000
  ),
  recovery_last_error_code text CHECK (
    recovery_last_error_code IS NULL OR recovery_last_error_code ~ '^[a-z0-9_.-]{1,64}$'
  ),
  recovery_last_error_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT (
    pg_catalog.statement_timestamp() + pg_catalog.make_interval(days => 90)
  ),
  CONSTRAINT court_provider_deletion_handoffs_usage_check CHECK (
    (provider_input_tokens IS NULL
      AND provider_output_tokens IS NULL
      AND provider_cached_input_tokens IS NULL
      AND provider_cache_write_input_tokens IS NULL)
    OR (provider_input_tokens IS NOT NULL
      AND provider_output_tokens IS NOT NULL
      AND (provider_cached_input_tokens IS NULL
        OR provider_cached_input_tokens <= provider_input_tokens)
      AND (provider_cache_write_input_tokens IS NULL
        OR provider_cache_write_input_tokens <= provider_input_tokens))
  ),
  CONSTRAINT court_provider_deletion_handoffs_recovery_lease_check CHECK (
    (recovery_lease_token IS NULL AND recovery_lease_expires_at IS NULL)
    OR (handoff_state = 'audit_pending'
      AND recovery_lease_token IS NOT NULL
      AND recovery_lease_expires_at IS NOT NULL)
  ),
  CONSTRAINT court_provider_deletion_handoffs_recovery_error_check CHECK (
    (recovery_last_error_code IS NULL AND recovery_last_error_at IS NULL)
    OR (handoff_state = 'audit_pending'
      AND recovery_last_error_code IS NOT NULL
      AND recovery_last_error_at IS NOT NULL)
  ),
  CONSTRAINT court_provider_deletion_handoffs_lifecycle_check CHECK (
    (handoff_state = 'provider_unknown'
      AND lease_token IS NOT NULL AND audit_model IS NULL
      AND provider_input_tokens IS NULL AND provider_output_tokens IS NULL
      AND provider_cached_input_tokens IS NULL
      AND provider_cache_write_input_tokens IS NULL
      AND audit_cost_usd IS NULL AND paid_observed_at IS NULL
      AND audit_pending_at IS NULL AND audited_at IS NULL AND resolved_at IS NULL)
    OR (handoff_state = 'audit_pending'
      AND lease_token IS NOT NULL AND audit_model IS NOT NULL
      AND provider_input_tokens IS NOT NULL
      AND provider_output_tokens IS NOT NULL
      AND paid_observed_at IS NOT NULL AND audit_pending_at IS NOT NULL
      AND audited_at IS NULL AND resolved_at IS NULL)
    OR (handoff_state = 'audited'
      AND lease_token IS NULL AND audit_model IS NOT NULL
      AND provider_input_tokens IS NOT NULL
      AND provider_output_tokens IS NOT NULL
      AND paid_observed_at IS NOT NULL AND audit_pending_at IS NULL
      AND audited_at IS NOT NULL AND resolved_at IS NULL
      AND recovery_lease_token IS NULL AND recovery_lease_expires_at IS NULL)
    OR (handoff_state = 'resolved_no_charge'
      AND lease_token IS NULL AND audit_model IS NULL
      AND provider_input_tokens IS NULL AND provider_output_tokens IS NULL
      AND provider_cached_input_tokens IS NULL
      AND provider_cache_write_input_tokens IS NULL
      AND audit_cost_usd IS NULL AND paid_observed_at IS NULL
      AND audit_pending_at IS NULL AND audited_at IS NULL AND resolved_at IS NOT NULL
      AND recovery_lease_token IS NULL AND recovery_lease_expires_at IS NULL)
  ),
  CONSTRAINT court_provider_deletion_handoffs_retention_check CHECK (
    expires_at > created_at
      AND expires_at <= created_at + pg_catalog.make_interval(days => 90)
  )
);

CREATE INDEX court_provider_deletion_handoffs_recovery_idx
  ON public.court_provider_deletion_handoffs(handoff_state, created_at)
  WHERE handoff_state IN ('provider_unknown', 'audit_pending');
CREATE INDEX court_provider_deletion_handoffs_expiry_idx
  ON public.court_provider_deletion_handoffs(expires_at);

ALTER TABLE public.court_provider_deletion_handoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.court_provider_deletion_handoffs OWNER TO postgres;
REVOKE ALL ON TABLE public.court_provider_deletion_handoffs
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.court_provider_deletion_handoffs IS
  'Service-only, payload-free attempt handoff after a Court graph is deleted. No subject, case, input, request, verdict payload, mission, mode, category, tone, or safety-category data is retained.';

-- Cascading account/profile deletion can be initiated by a service RPC or by
-- an owner-operated maintenance statement. The refund primitive therefore
-- cannot depend on request JWT state. Keep the core owner-only and retain the
-- service-role gate on the public RPC wrapper.
CREATE FUNCTION public.settle_court_provider_failure_internal(
  p_verdict_id uuid,
  p_error_code text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_reservation public.court_provider_reservations%ROWTYPE;
  v_kst_day text;
  v_global_key text;
  v_scope_key text;
  v_next_state text;
BEGIN
  IF p_verdict_id IS NULL OR p_error_code IS NULL
    OR p_error_code !~ '^[a-z0-9_.-]{1,64}$'
  THEN
    RAISE EXCEPTION 'invalid court provider settlement arguments'
      USING ERRCODE = '22023';
  END IF;

  SELECT reservation.* INTO v_reservation
  FROM public.court_provider_reservations AS reservation
  WHERE reservation.verdict_id = p_verdict_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF v_reservation.provider_state NOT IN ('reserved', 'started', 'result_staged') THEN
    RETURN v_reservation.provider_state;
  END IF;

  IF v_reservation.provider_state = 'reserved' THEN
    v_kst_day := pg_catalog.to_char(
      v_reservation.created_at AT TIME ZONE 'Asia/Seoul',
      'YYYY-MM-DD'
    );
    v_global_key := 'global:provider_calls:' || v_kst_day;
    v_scope_key := 'couple:provider_calls:'
      || v_reservation.quota_scope_id::text || ':' || v_kst_day;

    UPDATE public.amora_turn_counters
    SET count = GREATEST(count - 1, 0),
        updated_at = pg_catalog.clock_timestamp()
    WHERE key = v_global_key;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'court_provider_counter_missing' USING ERRCODE = '55000';
    END IF;

    UPDATE public.amora_turn_counters
    SET count = GREATEST(count - 1, 0),
        updated_at = pg_catalog.clock_timestamp()
    WHERE key = v_scope_key;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'court_provider_counter_missing' USING ERRCODE = '55000';
    END IF;

    UPDATE public.court_provider_reservations
    SET provider_state = 'failed_unstarted',
        failed_at = pg_catalog.clock_timestamp(),
        completed_at = NULL,
        provider_error_code = p_error_code
    WHERE verdict_id = p_verdict_id
      AND provider_state = 'reserved';
    RETURN 'failed_unstarted';
  END IF;

  v_next_state := CASE
    WHEN v_reservation.provider_state = 'result_staged'
      OR p_error_code IN (
        'structured_output_invalid', 'safety_high_risk',
        'safety_level_changed', 'court_archived'
      )
      THEN 'failed_invalid'
    ELSE 'failed_unknown'
  END;

  UPDATE public.court_provider_reservations
  SET provider_state = v_next_state,
      staged_at = NULL,
      staged_result_json = NULL,
      staged_missions_json = NULL,
      staged_model = NULL,
      audit_model = CASE WHEN v_reservation.provider_state = 'result_staged'
        THEN v_reservation.audit_model ELSE NULL END,
      provider_audit_state = CASE WHEN v_reservation.provider_state = 'result_staged'
        THEN v_reservation.provider_audit_state ELSE 'not_required' END,
      provider_audit_pending_at = CASE WHEN v_reservation.provider_state = 'result_staged'
        THEN v_reservation.provider_audit_pending_at ELSE NULL END,
      provider_audited_at = CASE WHEN v_reservation.provider_state = 'result_staged'
        THEN v_reservation.provider_audited_at ELSE NULL END,
      provider_audit_recovery_lease_token = CASE
        WHEN v_reservation.provider_state = 'result_staged'
          THEN v_reservation.provider_audit_recovery_lease_token
        ELSE NULL END,
      provider_audit_recovery_lease_expires_at = CASE
        WHEN v_reservation.provider_state = 'result_staged'
          THEN v_reservation.provider_audit_recovery_lease_expires_at
        ELSE NULL END,
      provider_high_risk_categories = CASE
        WHEN v_reservation.provider_state = 'result_staged'
          THEN v_reservation.provider_high_risk_categories
        ELSE NULL END,
      provider_input_tokens = CASE WHEN v_reservation.provider_state = 'result_staged'
        THEN v_reservation.provider_input_tokens ELSE NULL END,
      provider_output_tokens = CASE WHEN v_reservation.provider_state = 'result_staged'
        THEN v_reservation.provider_output_tokens ELSE NULL END,
      provider_cached_input_tokens = CASE
        WHEN v_reservation.provider_state = 'result_staged'
          THEN v_reservation.provider_cached_input_tokens
        ELSE NULL END,
      provider_cache_write_input_tokens = CASE
        WHEN v_reservation.provider_state = 'result_staged'
          THEN v_reservation.provider_cache_write_input_tokens
        ELSE NULL END,
      failed_at = pg_catalog.clock_timestamp(),
      completed_at = NULL,
      provider_error_code = p_error_code
  WHERE verdict_id = p_verdict_id
    AND provider_state IN ('started', 'result_staged');
  RETURN v_next_state;
END;
$$;

ALTER FUNCTION public.settle_court_provider_failure_internal(uuid, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.settle_court_provider_failure_internal(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.settle_court_provider_failure(
  p_verdict_id uuid,
  p_error_code text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  RETURN public.settle_court_provider_failure_internal(
    p_verdict_id,
    p_error_code
  );
END;
$$;

ALTER FUNCTION public.settle_court_provider_failure(uuid, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.settle_court_provider_failure(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_court_provider_failure(uuid, text)
  TO service_role;

-- The ledger is evidence for the provider request, not a child of the private
-- case graph. Keep the AI-row FK, but do not cascade it with a reservation.
ALTER TABLE public.court_provider_audit_logs
  DROP CONSTRAINT court_provider_audit_logs_request_key_fkey;
COMMENT ON TABLE public.court_provider_audit_logs IS
  'Service-only retry ledger binding one opaque provider request key to one payload-free AI audit row; it survives private Court graph deletion.';

CREATE OR REPLACE FUNCTION public.handoff_court_provider_attempts_before_case_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_attempt record;
  v_lease_token uuid;
  v_expected_state text;
  v_handoff public.court_provider_deletion_handoffs%ROWTYPE;
  v_failure_state text;
  v_audit public.ai_interactions_log%ROWTYPE;
  v_redacted_metadata jsonb;
BEGIN
  -- DELETE already owns the case tuple lock. Lock descendants in the same
  -- case -> verdict -> reservation order used by staging/settlement.
  FOR v_attempt IN
    SELECT reservation.*, verdict.lease_token AS active_lease_token,
      verdict.terminal_lease_token
    FROM public.court_verdicts AS verdict
    JOIN public.court_provider_reservations AS reservation
      ON reservation.verdict_id = verdict.id
      AND reservation.case_id = verdict.case_id
    WHERE verdict.case_id = OLD.id
    ORDER BY verdict.id
    FOR UPDATE OF verdict, reservation
  LOOP
    v_expected_state := NULL;
    IF v_attempt.provider_state = 'reserved' THEN
      v_failure_state := public.settle_court_provider_failure_internal(
        v_attempt.verdict_id,
        'case_deleted_before_provider_start'
      );
      IF v_failure_state IS DISTINCT FROM 'failed_unstarted' THEN
        RAISE EXCEPTION 'court reserved provider quota was not refunded'
          USING ERRCODE = '55000';
      END IF;
      CONTINUE;
    END IF;

    v_lease_token := COALESCE(
      v_attempt.active_lease_token,
      v_attempt.terminal_lease_token
    );

    IF v_attempt.provider_audit_state = 'audited' THEN
      IF v_attempt.audit_model IS NULL
        OR v_attempt.provider_audited_at IS NULL
      THEN
        RAISE EXCEPTION 'court audited provider handoff is incomplete'
          USING ERRCODE = '55000';
      END IF;
      v_expected_state := 'audited';
      v_lease_token := NULL;
      INSERT INTO public.court_provider_deletion_handoffs (
        request_key, verdict_id, lease_token, handoff_state, audit_model,
        provider_input_tokens, provider_output_tokens,
        provider_cached_input_tokens, provider_cache_write_input_tokens,
        paid_observed_at, audited_at, recovery_attempt_count
      ) VALUES (
        v_attempt.request_key, v_attempt.verdict_id, NULL,
        'audited', v_attempt.audit_model,
        v_attempt.provider_input_tokens, v_attempt.provider_output_tokens,
        v_attempt.provider_cached_input_tokens,
        v_attempt.provider_cache_write_input_tokens,
        COALESCE(
          v_attempt.staged_at, v_attempt.failed_at, v_attempt.completed_at,
          v_attempt.provider_audited_at
        ),
        v_attempt.provider_audited_at,
        v_attempt.provider_audit_recovery_attempt_count
      )
      ON CONFLICT (request_key) DO NOTHING;
    ELSIF v_attempt.provider_audit_state = 'pending'
      AND v_attempt.audit_model IS NOT NULL
    THEN
      v_expected_state := 'audit_pending';
      IF v_lease_token IS NULL THEN
        RAISE EXCEPTION 'court paid provider handoff lease is unavailable'
          USING ERRCODE = '55000';
      END IF;
      INSERT INTO public.court_provider_deletion_handoffs (
        request_key, verdict_id, lease_token, handoff_state, audit_model,
        provider_input_tokens, provider_output_tokens,
        provider_cached_input_tokens, provider_cache_write_input_tokens,
        paid_observed_at, audit_pending_at, recovery_attempt_count,
        recovery_last_error_code, recovery_last_error_at
      ) VALUES (
        v_attempt.request_key, v_attempt.verdict_id, v_lease_token,
        'audit_pending', v_attempt.audit_model,
        v_attempt.provider_input_tokens, v_attempt.provider_output_tokens,
        v_attempt.provider_cached_input_tokens,
        v_attempt.provider_cache_write_input_tokens,
        COALESCE(v_attempt.staged_at, v_attempt.failed_at, pg_catalog.clock_timestamp()),
        COALESCE(v_attempt.provider_audit_pending_at, pg_catalog.clock_timestamp()),
        v_attempt.provider_audit_recovery_attempt_count,
        v_attempt.provider_audit_recovery_last_error_code,
        v_attempt.provider_audit_recovery_last_error_at
      )
      ON CONFLICT (request_key) DO NOTHING;
    ELSIF v_attempt.provider_state IN ('started', 'failed_unknown') THEN
      v_expected_state := 'provider_unknown';
      IF v_lease_token IS NULL THEN
        RAISE EXCEPTION 'court started provider handoff lease is unavailable'
          USING ERRCODE = '55000';
      END IF;
      INSERT INTO public.court_provider_deletion_handoffs (
        request_key, verdict_id, lease_token, handoff_state
      ) VALUES (
        v_attempt.request_key, v_attempt.verdict_id, v_lease_token,
        'provider_unknown'
      )
      ON CONFLICT (request_key) DO NOTHING;
    ELSE
      CONTINUE;
    END IF;

    SELECT handoff.* INTO v_handoff
    FROM public.court_provider_deletion_handoffs AS handoff
    WHERE handoff.request_key = v_attempt.request_key
    FOR UPDATE;
    IF NOT FOUND
      OR v_handoff.verdict_id IS DISTINCT FROM v_attempt.verdict_id
      OR v_handoff.lease_token IS DISTINCT FROM v_lease_token
      OR v_handoff.handoff_state IS DISTINCT FROM v_expected_state
      OR (
        v_expected_state IN ('audit_pending', 'audited')
        AND (
          v_handoff.audit_model IS DISTINCT FROM v_attempt.audit_model
          OR v_handoff.provider_input_tokens
            IS DISTINCT FROM v_attempt.provider_input_tokens
          OR v_handoff.provider_output_tokens
            IS DISTINCT FROM v_attempt.provider_output_tokens
          OR v_handoff.provider_cached_input_tokens
            IS DISTINCT FROM v_attempt.provider_cached_input_tokens
          OR v_handoff.provider_cache_write_input_tokens
            IS DISTINCT FROM v_attempt.provider_cache_write_input_tokens
          OR (
            v_expected_state = 'audited'
            AND v_handoff.audited_at
              IS DISTINCT FROM v_attempt.provider_audited_at
          )
        )
      )
    THEN
      RAISE EXCEPTION 'court provider deletion handoff identity mismatch'
        USING ERRCODE = '40001';
    END IF;

    -- A keyed audit may already have committed before account deletion won
    -- the case lock. Redact it in this same deletion transaction; never wait
    -- for a later route callback to remove subject-linked metadata.
    IF v_expected_state IN ('audit_pending', 'audited') THEN
      SELECT interaction.* INTO v_audit
      FROM public.court_provider_audit_logs AS audit_link
      JOIN public.ai_interactions_log AS interaction
        ON interaction.id = audit_link.ai_interaction_id
      WHERE audit_link.request_key = v_attempt.request_key
      FOR UPDATE OF interaction;
      IF FOUND THEN
        IF v_audit.interaction_type IS DISTINCT FROM 'couple_court_verdict'
          OR v_audit.specialist_type IS NOT NULL
          OR v_audit.user_input IS NOT NULL OR v_audit.ai_output IS NOT NULL
          OR v_audit.tool_name IS NOT NULL
          OR v_audit.tool_input IS NOT NULL OR v_audit.tool_output IS NOT NULL
          OR v_audit.success IS DISTINCT FROM true
          OR v_audit.error_message IS NOT NULL
          OR v_audit.model IS DISTINCT FROM v_handoff.audit_model
          OR v_audit.tokens_input
            IS DISTINCT FROM v_handoff.provider_input_tokens
          OR v_audit.tokens_output
            IS DISTINCT FROM v_handoff.provider_output_tokens
        THEN
          RAISE EXCEPTION 'court provider audit evidence cannot be redacted safely'
            USING ERRCODE = '55000';
        END IF;
        v_redacted_metadata := pg_catalog.jsonb_strip_nulls(
          pg_catalog.jsonb_build_object(
            'source', 'couple_court_judge',
            'quota_class', 'provider_call',
            'request_usage', CASE
              WHEN v_handoff.provider_input_tokens IS NULL THEN NULL
              ELSE pg_catalog.jsonb_build_object(
                'input_tokens', v_handoff.provider_input_tokens,
                'output_tokens', v_handoff.provider_output_tokens,
                'cached_input_tokens', v_handoff.provider_cached_input_tokens,
                'cache_write_input_tokens',
                  v_handoff.provider_cache_write_input_tokens
              )
            END,
            'account_deleted', true,
            'payload_redacted_at', v_handoff.created_at
          )
        );
        UPDATE public.ai_interactions_log
        SET user_id = NULL, couple_id = NULL, session_id = NULL,
            message_id = NULL, specialist_type = NULL,
            user_input = NULL, ai_output = NULL, tool_name = NULL,
            tool_input = NULL, tool_output = NULL,
            latency_ms = 0, success = true, error_message = NULL,
            metadata = v_redacted_metadata
        WHERE id = v_audit.id;

        -- A handoff must never outlive the evidence it references. If the
        -- one-year aggregate horizon has already elapsed, the completed audit
        -- needs no retry capability after this deletion transaction.
        IF v_audit.created_at + pg_catalog.make_interval(years => 1)
          <= v_handoff.created_at
        THEN
          DELETE FROM public.court_provider_audit_logs
          WHERE request_key = v_attempt.request_key;
          DELETE FROM public.court_provider_deletion_handoffs
          WHERE id = v_handoff.id;
          CONTINUE;
        END IF;
        UPDATE public.court_provider_deletion_handoffs
        SET audit_cost_usd = v_audit.cost_usd,
            expires_at = LEAST(
              expires_at,
              v_audit.created_at + pg_catalog.make_interval(years => 1)
            )
        WHERE id = v_handoff.id;
      ELSIF v_expected_state = 'audited' THEN
        IF v_attempt.provider_audited_at
          <= pg_catalog.clock_timestamp() - pg_catalog.make_interval(years => 1)
        THEN
          -- The retention job lawfully removed this already-complete audit.
          -- Do not let stale aggregate evidence block private graph deletion.
          DELETE FROM public.court_provider_deletion_handoffs
          WHERE id = v_handoff.id;
          CONTINUE;
        ELSE
          RAISE EXCEPTION 'court audited provider evidence is missing'
            USING ERRCODE = '55000';
        END IF;
      END IF;
    END IF;
  END LOOP;
  RETURN OLD;
END;
$$;

ALTER FUNCTION public.handoff_court_provider_attempts_before_case_delete()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.handoff_court_provider_attempts_before_case_delete()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER court_case_provider_handoff_before_delete
  BEFORE DELETE ON public.court_cases
  FOR EACH ROW
  EXECUTE FUNCTION public.handoff_court_provider_attempts_before_case_delete();

-- Keep the reviewed live-graph implementations intact and put the deletion
-- fallback in a narrow wrapper with the original public signature.
ALTER FUNCTION public.settle_court_unstaged_provider_result(
  uuid, uuid, text, text, text, integer, integer, integer, integer
) RENAME TO settle_court_unstaged_provider_result_live;
REVOKE ALL ON FUNCTION public.settle_court_unstaged_provider_result_live(
  uuid, uuid, text, text, text, integer, integer, integer, integer
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.settle_court_unstaged_provider_result(
  p_verdict_id uuid,
  p_lease_token uuid,
  p_input_hash text,
  p_request_key text,
  p_audit_model text,
  p_input_tokens integer DEFAULT NULL,
  p_output_tokens integer DEFAULT NULL,
  p_cached_input_tokens integer DEFAULT NULL,
  p_cache_write_input_tokens integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_handoff public.court_provider_deletion_handoffs%ROWTYPE;
  v_pending_at timestamptz;
  v_reused boolean;
  v_settlement jsonb;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  -- Serialize the live/deleted branch on the parent case. A bare EXISTS can
  -- observe a verdict and then lose it to the account-deletion cascade before
  -- the live implementation takes its own locks.
  PERFORM 1
  FROM public.court_cases AS court_case
  JOIN public.court_verdicts AS verdict ON verdict.case_id = court_case.id
  WHERE verdict.id = p_verdict_id
  FOR UPDATE OF court_case;
  IF FOUND THEN
    v_settlement := public.settle_court_unstaged_provider_result_live(
      p_verdict_id, p_lease_token, p_input_hash, p_request_key, p_audit_model,
      p_input_tokens, p_output_tokens, p_cached_input_tokens,
      p_cache_write_input_tokens
    );
    RETURN v_settlement || pg_catalog.jsonb_build_object(
      'subject_deleted', false
    );
  END IF;
  IF p_verdict_id IS NULL OR p_lease_token IS NULL
    OR p_input_hash IS NULL OR p_input_hash !~ '^[a-f0-9]{64}$'
    OR p_request_key IS NULL OR p_request_key !~ '^[a-f0-9]{64}$'
    OR p_audit_model IS NULL OR p_audit_model !~ '^[A-Za-z0-9._:/-]{1,128}$'
    OR (p_input_tokens IS NULL) <> (p_output_tokens IS NULL)
    OR (p_input_tokens IS NOT NULL AND p_input_tokens NOT BETWEEN 0 AND 10000000)
    OR (p_output_tokens IS NOT NULL AND p_output_tokens NOT BETWEEN 0 AND 10000000)
    OR (p_cached_input_tokens IS NOT NULL AND (
      p_input_tokens IS NULL OR p_cached_input_tokens NOT BETWEEN 0 AND p_input_tokens))
    OR (p_cache_write_input_tokens IS NOT NULL AND (
      p_input_tokens IS NULL OR p_cache_write_input_tokens NOT BETWEEN 0 AND p_input_tokens))
  THEN
    RAISE EXCEPTION 'invalid court deleted-subject settlement arguments'
      USING ERRCODE = '22023';
  END IF;
  SELECT handoff.* INTO v_handoff
  FROM public.court_provider_deletion_handoffs AS handoff
  WHERE handoff.request_key = p_request_key
    AND handoff.verdict_id = p_verdict_id
    AND handoff.expires_at > pg_catalog.clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court deleted-subject provider identity mismatch'
      USING ERRCODE = '42501';
  END IF;
  -- Finalization deliberately clears the lease. A replay that already reached
  -- audited is instead bound by the unique request/verdict pair and the exact
  -- model/usage identity below; in-progress states must still prove the lease.
  IF v_handoff.handoff_state IN ('provider_unknown', 'audit_pending')
    AND v_handoff.lease_token IS DISTINCT FROM p_lease_token
  THEN
    RAISE EXCEPTION 'court deleted-subject provider identity mismatch'
      USING ERRCODE = '42501';
  END IF;
  IF v_handoff.handoff_state IN ('audit_pending', 'audited') THEN
    v_reused := true;
    IF v_handoff.audit_model IS DISTINCT FROM p_audit_model
      OR v_handoff.provider_input_tokens IS DISTINCT FROM p_input_tokens
      OR v_handoff.provider_output_tokens IS DISTINCT FROM p_output_tokens
      OR v_handoff.provider_cached_input_tokens IS DISTINCT FROM p_cached_input_tokens
      OR v_handoff.provider_cache_write_input_tokens IS DISTINCT FROM p_cache_write_input_tokens
    THEN
      RAISE EXCEPTION 'court deleted-subject provider audit mismatch'
        USING ERRCODE = '42501';
    END IF;
  ELSIF v_handoff.handoff_state = 'provider_unknown' THEN
    v_reused := false;
    v_pending_at := pg_catalog.clock_timestamp();
    UPDATE public.court_provider_deletion_handoffs
    SET handoff_state = 'audit_pending', audit_model = p_audit_model,
        provider_input_tokens = p_input_tokens,
        provider_output_tokens = p_output_tokens,
        provider_cached_input_tokens = p_cached_input_tokens,
        provider_cache_write_input_tokens = p_cache_write_input_tokens,
        paid_observed_at = v_pending_at, audit_pending_at = v_pending_at
    WHERE id = v_handoff.id AND handoff_state = 'provider_unknown';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'court deleted-subject provider state changed concurrently'
        USING ERRCODE = '40001';
    END IF;
    v_handoff.handoff_state := 'audit_pending';
  ELSE
    RAISE EXCEPTION 'court deleted-subject provider attempt is terminal'
      USING ERRCODE = '55000';
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'verdict_id', p_verdict_id, 'case_id', NULL,
    'provider_state', 'failed_invalid',
    'provider_audit_state', CASE WHEN v_handoff.handoff_state = 'audited'
      THEN 'audited' ELSE 'pending' END,
    'provider_error_code', 'provider_result_unstaged',
    'subject_deleted', true,
    'reused', v_reused
  );
END;
$$;

ALTER FUNCTION public.settle_court_unstaged_provider_result(
  uuid, uuid, text, text, text, integer, integer, integer, integer
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.settle_court_unstaged_provider_result(
  uuid, uuid, text, text, text, integer, integer, integer, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_court_unstaged_provider_result(
  uuid, uuid, text, text, text, integer, integer, integer, integer
) TO service_role;

ALTER FUNCTION public.settle_court_high_risk_provider_result(
  uuid, uuid, uuid, text, text, text[], text, integer, integer, integer, integer
) RENAME TO settle_court_high_risk_provider_result_live;
REVOKE ALL ON FUNCTION public.settle_court_high_risk_provider_result_live(
  uuid, uuid, uuid, text, text, text[], text, integer, integer, integer, integer
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.settle_court_high_risk_provider_result(
  p_verdict_id uuid, p_user_id uuid, p_lease_token uuid, p_input_hash text,
  p_request_key text, p_categories text[], p_audit_model text,
  p_input_tokens integer DEFAULT NULL, p_output_tokens integer DEFAULT NULL,
  p_cached_input_tokens integer DEFAULT NULL,
  p_cache_write_input_tokens integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_settlement jsonb;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  -- The live high-risk function and account deletion both lock profile before
  -- case. Preserve that global order before adding the branch fence below.
  PERFORM 1
  FROM public.profiles AS profile
  WHERE profile.id = p_user_id
  FOR UPDATE;
  PERFORM 1
  FROM public.court_cases AS court_case
  JOIN public.court_verdicts AS verdict ON verdict.case_id = court_case.id
  WHERE verdict.id = p_verdict_id
  FOR UPDATE OF court_case;
  IF FOUND THEN
    v_settlement := public.settle_court_high_risk_provider_result_live(
      p_verdict_id, p_user_id, p_lease_token, p_input_hash, p_request_key,
      p_categories, p_audit_model, p_input_tokens, p_output_tokens,
      p_cached_input_tokens, p_cache_write_input_tokens
    );
    RETURN v_settlement || pg_catalog.jsonb_build_object(
      'subject_deleted', false
    );
  END IF;
  IF p_user_id IS NULL
    OR p_categories IS NULL
    OR pg_catalog.cardinality(p_categories) NOT BETWEEN 1 AND 12
    OR NOT public.court_safety_categories_are_valid(p_categories)
  THEN
    RAISE EXCEPTION 'invalid court deleted-subject high-risk categories'
      USING ERRCODE = '22023';
  END IF;
  v_settlement := public.settle_court_unstaged_provider_result(
    p_verdict_id, p_lease_token, p_input_hash, p_request_key, p_audit_model,
    p_input_tokens, p_output_tokens, p_cached_input_tokens,
    p_cache_write_input_tokens
  );
  RETURN v_settlement || pg_catalog.jsonb_build_object(
    'request_key', p_request_key,
    'provider_error_code', 'safety_high_risk',
    'safety_level', 'high_risk',
    -- Echo only to the current server call. Categories are never stored.
    'safety_categories', pg_catalog.to_jsonb(p_categories)
  );
END;
$$;

ALTER FUNCTION public.settle_court_high_risk_provider_result(
  uuid, uuid, uuid, text, text, text[], text, integer, integer, integer, integer
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.settle_court_high_risk_provider_result(
  uuid, uuid, uuid, text, text, text[], text, integer, integer, integer, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_court_high_risk_provider_result(
  uuid, uuid, uuid, text, text, text[], text, integer, integer, integer, integer
) TO service_role;

ALTER FUNCTION public.write_court_provider_audit(text, jsonb, numeric)
  RENAME TO write_court_provider_audit_live;
REVOKE ALL ON FUNCTION public.write_court_provider_audit_live(text, jsonb, numeric)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.write_court_provider_audit(
  p_request_key text, p_audit_identity jsonb, p_cost_usd numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_handoff public.court_provider_deletion_handoffs%ROWTYPE;
  v_audit public.ai_interactions_log%ROWTYPE;
  v_audit_id uuid;
  v_metadata jsonb;
  v_result jsonb;
  v_canonical_cost numeric(10,6);
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  -- ai_interactions_log.cost_usd is numeric(10,6). Canonicalize once before
  -- either branch so insertion, evidence checks, and replays use one value.
  IF p_cost_usd IS NOT NULL
    AND (p_cost_usd < 0 OR p_cost_usd > 9999.999999)
  THEN
    RAISE EXCEPTION 'invalid court provider audit cost'
      USING ERRCODE = '22023';
  END IF;
  v_canonical_cost := pg_catalog.round(p_cost_usd, 6)::numeric(10,6);
  PERFORM 1
  FROM public.court_cases AS court_case
  JOIN public.court_provider_reservations AS reservation
    ON reservation.case_id = court_case.id
  WHERE reservation.request_key = p_request_key
  FOR UPDATE OF court_case;
  IF FOUND THEN
    v_result := public.write_court_provider_audit_live(
      p_request_key, p_audit_identity, v_canonical_cost
    );
    SELECT interaction.* INTO v_audit
    FROM public.court_provider_audit_logs AS audit_link
    JOIN public.ai_interactions_log AS interaction
      ON interaction.id = audit_link.ai_interaction_id
    WHERE audit_link.request_key = p_request_key
    FOR UPDATE OF interaction;
    IF NOT FOUND
      OR v_audit.id::text IS DISTINCT FROM v_result ->> 'audit_log_id'
      OR v_audit.cost_usd IS DISTINCT FROM v_canonical_cost
    THEN
      RAISE EXCEPTION 'court live provider audit cost evidence mismatch'
        USING ERRCODE = '55000';
    END IF;
    RETURN v_result || pg_catalog.jsonb_build_object(
      'subject_deleted', false
    );
  END IF;
  IF p_request_key IS NULL OR p_request_key !~ '^[a-f0-9]{64}$'
    OR p_audit_identity IS NULL OR pg_catalog.jsonb_typeof(p_audit_identity) <> 'object'
  THEN
    RAISE EXCEPTION 'invalid court deleted-subject audit arguments'
      USING ERRCODE = '22023';
  END IF;
  SELECT handoff.* INTO v_handoff
  FROM public.court_provider_deletion_handoffs AS handoff
  WHERE handoff.request_key = p_request_key
    AND handoff.expires_at > pg_catalog.clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND OR v_handoff.handoff_state NOT IN ('audit_pending', 'audited')
    OR v_handoff.audit_model IS NULL
  THEN
    RAISE EXCEPTION 'court_provider_audit_not_ready' USING ERRCODE = '55000';
  END IF;
  IF p_audit_identity->>'interaction_type' IS DISTINCT FROM 'couple_court_verdict'
    OR COALESCE((p_audit_identity->>'success')::boolean, false) IS DISTINCT FROM true
    OR p_audit_identity->>'user_input' IS NOT NULL
    OR p_audit_identity->>'ai_output' IS NOT NULL
    OR p_audit_identity->>'tool_name' IS NOT NULL
    OR p_audit_identity->>'tool_input' IS NOT NULL
    OR p_audit_identity->>'tool_output' IS NOT NULL
    OR p_audit_identity->>'error_message' IS NOT NULL
    OR p_audit_identity->>'model' IS DISTINCT FROM v_handoff.audit_model
    OR NULLIF(p_audit_identity->>'tokens_input', '')::integer
      IS DISTINCT FROM v_handoff.provider_input_tokens
    OR NULLIF(p_audit_identity->>'tokens_output', '')::integer
      IS DISTINCT FROM v_handoff.provider_output_tokens
    OR COALESCE(
      NULLIF(p_audit_identity #>> '{metadata,cache_read_input_tokens}', '')::integer,
      0
    ) IS DISTINCT FROM COALESCE(v_handoff.provider_cached_input_tokens, 0)
    OR COALESCE(
      NULLIF(p_audit_identity #>> '{metadata,cache_write_input_tokens}', '')::integer,
      0
    ) IS DISTINCT FROM COALESCE(v_handoff.provider_cache_write_input_tokens, 0)
  THEN
    RAISE EXCEPTION 'court deleted-subject audit identity mismatch'
      USING ERRCODE = '55000';
  END IF;
  IF v_handoff.audit_cost_usd IS NOT NULL
    AND v_handoff.audit_cost_usd IS DISTINCT FROM v_canonical_cost
  THEN
    RAISE EXCEPTION 'court deleted-subject audit cost mismatch'
      USING ERRCODE = '55000';
  END IF;
  v_metadata := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'source', 'couple_court_judge',
    'quota_class', 'provider_call',
    'request_usage', CASE WHEN v_handoff.provider_input_tokens IS NULL THEN NULL
      ELSE pg_catalog.jsonb_build_object(
        'input_tokens', v_handoff.provider_input_tokens,
        'output_tokens', v_handoff.provider_output_tokens,
        'cached_input_tokens', v_handoff.provider_cached_input_tokens,
        'cache_write_input_tokens', v_handoff.provider_cache_write_input_tokens
      ) END,
    'account_deleted', true,
    'payload_redacted_at', v_handoff.created_at
  ));
  SELECT interaction.* INTO v_audit
  FROM public.court_provider_audit_logs AS audit_link
  JOIN public.ai_interactions_log AS interaction
    ON interaction.id = audit_link.ai_interaction_id
  WHERE audit_link.request_key = p_request_key;
  IF FOUND THEN
    IF v_audit.user_id IS NOT NULL OR v_audit.couple_id IS NOT NULL
      OR v_audit.session_id IS NOT NULL OR v_audit.message_id IS NOT NULL
      OR v_audit.interaction_type IS DISTINCT FROM 'couple_court_verdict'
      OR v_audit.specialist_type IS NOT NULL
      OR v_audit.user_input IS NOT NULL OR v_audit.ai_output IS NOT NULL
      OR v_audit.tool_name IS NOT NULL
      OR v_audit.tool_input IS NOT NULL OR v_audit.tool_output IS NOT NULL
      OR v_audit.latency_ms IS DISTINCT FROM 0
      OR v_audit.success IS DISTINCT FROM true
      OR v_audit.error_message IS NOT NULL
      OR v_audit.model IS DISTINCT FROM v_handoff.audit_model
      OR v_audit.tokens_input IS DISTINCT FROM v_handoff.provider_input_tokens
      OR v_audit.tokens_output IS DISTINCT FROM v_handoff.provider_output_tokens
      OR v_audit.cost_usd IS DISTINCT FROM v_canonical_cost
      OR v_audit.metadata IS DISTINCT FROM v_metadata
    THEN
      RAISE EXCEPTION 'court deleted-subject audit evidence mismatch'
        USING ERRCODE = '55000';
    END IF;
    UPDATE public.court_provider_deletion_handoffs
    SET audit_cost_usd = v_audit.cost_usd
    WHERE id = v_handoff.id
      AND audit_cost_usd IS NULL;
    RETURN pg_catalog.jsonb_build_object(
      'audit_log_id', v_audit.id, 'reused', true, 'subject_deleted', true
    );
  END IF;
  IF v_handoff.handoff_state = 'audited' THEN
    -- Never recreate historical evidence after the one-year AI-log retention
    -- cascade has removed it. An audited handoff without its ledger is an
    -- integrity incident, not a retryable write.
    RAISE EXCEPTION 'court_provider_audit_evidence_missing'
      USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.ai_interactions_log (
    user_id, couple_id, session_id, message_id, interaction_type,
    specialist_type, user_input, ai_output, tool_name, tool_input, tool_output,
    latency_ms, success, error_message, model, tokens_input, tokens_output,
    cost_usd, metadata
  ) VALUES (
    NULL, NULL, NULL, NULL, 'couple_court_verdict',
    NULL, NULL, NULL, NULL, NULL, NULL,
    0, true, NULL, v_handoff.audit_model,
    v_handoff.provider_input_tokens, v_handoff.provider_output_tokens,
    v_canonical_cost, v_metadata
  ) RETURNING id INTO v_audit_id;
  INSERT INTO public.court_provider_audit_logs (request_key, ai_interaction_id)
  VALUES (p_request_key, v_audit_id);
  UPDATE public.court_provider_deletion_handoffs
  SET audit_cost_usd = v_canonical_cost
  WHERE id = v_handoff.id;
  RETURN pg_catalog.jsonb_build_object(
    'audit_log_id', v_audit_id, 'reused', false, 'subject_deleted', true
  );
END;
$$;

ALTER FUNCTION public.write_court_provider_audit(text, jsonb, numeric)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.write_court_provider_audit(text, jsonb, numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.write_court_provider_audit(text, jsonb, numeric)
  TO service_role;

ALTER FUNCTION public.finalize_court_provider_audit(uuid, text)
  RENAME TO finalize_court_provider_audit_live;
REVOKE ALL ON FUNCTION public.finalize_court_provider_audit_live(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.finalize_court_provider_audit(
  p_verdict_id uuid, p_request_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_handoff public.court_provider_deletion_handoffs%ROWTYPE;
  v_audit public.ai_interactions_log%ROWTYPE;
  v_audited_at timestamptz;
  v_metadata jsonb;
  v_reused boolean;
  v_result jsonb;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  PERFORM 1
  FROM public.court_cases AS court_case
  JOIN public.court_provider_reservations AS reservation
    ON reservation.case_id = court_case.id
  WHERE reservation.request_key = p_request_key
    AND reservation.verdict_id = p_verdict_id
  FOR UPDATE OF court_case;
  IF FOUND THEN
    v_result := public.finalize_court_provider_audit_live(
      p_verdict_id, p_request_key
    );
    RETURN v_result || pg_catalog.jsonb_build_object(
      'subject_deleted', false
    );
  END IF;
  IF p_verdict_id IS NULL OR p_request_key IS NULL
    OR p_request_key !~ '^[a-f0-9]{64}$'
  THEN
    RAISE EXCEPTION 'invalid court deleted-subject audit finalization arguments'
      USING ERRCODE = '22023';
  END IF;
  SELECT handoff.* INTO v_handoff
  FROM public.court_provider_deletion_handoffs AS handoff
  WHERE handoff.request_key = p_request_key
    AND handoff.verdict_id = p_verdict_id
    AND handoff.expires_at > pg_catalog.clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND OR v_handoff.handoff_state NOT IN ('audit_pending', 'audited') THEN
    RAISE EXCEPTION 'court deleted-subject audit handoff is unavailable'
      USING ERRCODE = '55000';
  END IF;
  SELECT interaction.* INTO v_audit
  FROM public.court_provider_audit_logs AS audit_link
  JOIN public.ai_interactions_log AS interaction
    ON interaction.id = audit_link.ai_interaction_id
  WHERE audit_link.request_key = p_request_key
  FOR UPDATE OF interaction;
  IF NOT FOUND
    OR v_audit.interaction_type IS DISTINCT FROM 'couple_court_verdict'
    OR v_audit.specialist_type IS NOT NULL
    OR v_audit.user_input IS NOT NULL OR v_audit.ai_output IS NOT NULL
    OR v_audit.tool_name IS NOT NULL
    OR v_audit.tool_input IS NOT NULL OR v_audit.tool_output IS NOT NULL
    OR v_audit.success IS DISTINCT FROM true
    OR v_audit.error_message IS NOT NULL
    OR v_audit.model IS DISTINCT FROM v_handoff.audit_model
    OR v_audit.tokens_input IS DISTINCT FROM v_handoff.provider_input_tokens
    OR v_audit.tokens_output IS DISTINCT FROM v_handoff.provider_output_tokens
    OR (v_handoff.audit_cost_usd IS NOT NULL
      AND v_audit.cost_usd IS DISTINCT FROM v_handoff.audit_cost_usd)
    OR v_audit.user_input IS NOT NULL OR v_audit.ai_output IS NOT NULL
    OR v_audit.tool_input IS NOT NULL OR v_audit.tool_output IS NOT NULL
  THEN
    RAISE EXCEPTION 'court deleted-subject audit evidence mismatch'
      USING ERRCODE = '55000';
  END IF;
  v_metadata := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'source', 'couple_court_judge',
    'quota_class', 'provider_call',
    'request_usage', CASE WHEN v_handoff.provider_input_tokens IS NULL THEN NULL
      ELSE pg_catalog.jsonb_build_object(
        'input_tokens', v_handoff.provider_input_tokens,
        'output_tokens', v_handoff.provider_output_tokens,
        'cached_input_tokens', v_handoff.provider_cached_input_tokens,
        'cache_write_input_tokens', v_handoff.provider_cache_write_input_tokens
      ) END,
    'account_deleted', true,
    'payload_redacted_at', v_handoff.created_at
  ));
  UPDATE public.ai_interactions_log
  SET user_id = NULL, couple_id = NULL, session_id = NULL, message_id = NULL,
      specialist_type = NULL, user_input = NULL, ai_output = NULL,
      tool_name = NULL,
      tool_input = NULL, tool_output = NULL, error_message = NULL,
      latency_ms = 0, success = true,
      metadata = v_metadata
  WHERE id = v_audit.id;
  v_reused := v_handoff.handoff_state = 'audited';
  v_audited_at := COALESCE(v_handoff.audited_at, pg_catalog.clock_timestamp());
  UPDATE public.court_provider_deletion_handoffs
  SET handoff_state = 'audited', lease_token = NULL,
      audit_pending_at = NULL, audited_at = v_audited_at,
      audit_cost_usd = COALESCE(audit_cost_usd, v_audit.cost_usd),
      recovery_lease_token = NULL, recovery_lease_expires_at = NULL,
      recovery_last_error_code = NULL, recovery_last_error_at = NULL
  WHERE id = v_handoff.id;
  RETURN pg_catalog.jsonb_build_object(
    'verdict_id', p_verdict_id, 'case_id', NULL,
    'provider_audit_state', 'audited',
    'audited_at', v_audited_at, 'subject_deleted', true,
    'reused', v_reused
  );
END;
$$;

ALTER FUNCTION public.finalize_court_provider_audit(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.finalize_court_provider_audit(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_court_provider_audit(uuid, text)
  TO service_role;
