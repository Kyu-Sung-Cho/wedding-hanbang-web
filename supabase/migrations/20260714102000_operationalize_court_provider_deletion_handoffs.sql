SET lock_timeout = '5s';
SET statement_timeout = '90s';

-- Preserve the reviewed live-graph recovery implementation and add a
-- payload-free deleted-subject queue behind the same service-only RPC.
ALTER FUNCTION public.claim_court_provider_audit_recovery(uuid, integer)
  RENAME TO claim_court_provider_audit_recovery_live;
REVOKE ALL ON FUNCTION public.claim_court_provider_audit_recovery_live(uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.claim_court_provider_audit_recovery(
  p_admin_user_id uuid,
  p_lease_seconds integer DEFAULT 120
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_handoff public.court_provider_deletion_handoffs%ROWTYPE;
  v_lease_token uuid;
  v_lease_expires_at timestamptz;
  v_live_claim jsonb;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_admin_user_id IS NULL OR p_lease_seconds IS NULL
    OR p_lease_seconds NOT BETWEEN 30 AND 300
  THEN
    RAISE EXCEPTION 'invalid court provider audit recovery claim arguments'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.profiles AS profile
  WHERE profile.id = p_admin_user_id
    AND profile.account_deleting_at IS NULL
    AND profile.is_admin = true
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court provider audit recovery requires an active admin'
      USING ERRCODE = '42501';
  END IF;

  SELECT handoff.* INTO v_handoff
  FROM public.court_provider_deletion_handoffs AS handoff
  WHERE handoff.handoff_state = 'audit_pending'
    AND handoff.audit_model IS NOT NULL
    AND handoff.recovery_attempt_count < 10000
    AND handoff.expires_at
      > pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => 30)
    AND (
      handoff.recovery_lease_expires_at IS NULL
      OR handoff.recovery_lease_expires_at <= pg_catalog.clock_timestamp()
    )
  ORDER BY handoff.audit_pending_at, handoff.verdict_id
  LIMIT 1
  FOR UPDATE OF handoff SKIP LOCKED;

  IF FOUND THEN
    v_lease_token := pg_catalog.gen_random_uuid();
    v_lease_expires_at := LEAST(
      v_handoff.expires_at,
      pg_catalog.clock_timestamp()
        + pg_catalog.make_interval(secs => p_lease_seconds)
    );
    UPDATE public.court_provider_deletion_handoffs
    SET recovery_lease_token = v_lease_token,
        recovery_lease_expires_at = v_lease_expires_at,
        recovery_attempt_count = recovery_attempt_count + 1
    WHERE id = v_handoff.id
      AND handoff_state = 'audit_pending'
    RETURNING * INTO v_handoff;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'court deleted-subject audit recovery claim changed concurrently'
        USING ERRCODE = '40001';
    END IF;

    -- request_key is returned only through this service-role RPC to the
    -- existing server recovery worker. The browser response never includes it.
    RETURN pg_catalog.jsonb_build_object(
      'claim_status', 'execute',
      'subject_deleted', true,
      'verdict_id', v_handoff.verdict_id,
      'provider_audit_state', 'pending',
      'provider_audit_pending_at', v_handoff.audit_pending_at,
      'recovery_attempt_count', v_handoff.recovery_attempt_count,
      'recovery_lease_token', v_lease_token,
      'recovery_lease_expires_at', v_lease_expires_at,
      'request_key', v_handoff.request_key,
      'audit_model', v_handoff.audit_model,
      'audit_cost_usd', v_handoff.audit_cost_usd,
      'usage', pg_catalog.jsonb_build_object(
        'input_tokens', v_handoff.provider_input_tokens,
        'output_tokens', v_handoff.provider_output_tokens,
        'cached_input_tokens', v_handoff.provider_cached_input_tokens,
        'cache_write_input_tokens',
          v_handoff.provider_cache_write_input_tokens
      )
    );
  END IF;

  v_live_claim := public.claim_court_provider_audit_recovery_live(
    p_admin_user_id,
    p_lease_seconds
  );
  RETURN v_live_claim || pg_catalog.jsonb_build_object(
    'subject_deleted', false
  );
END;
$$;

ALTER FUNCTION public.claim_court_provider_audit_recovery(uuid, integer)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_court_provider_audit_recovery(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_court_provider_audit_recovery(uuid, integer)
  TO service_role;

-- Serialize the live/deleted failure-recording branch on the parent case. A
-- case deletion that is already in flight either commits its handoff first or
-- rolls back before this function chooses a storage location.
ALTER FUNCTION public.record_court_provider_audit_recovery_failure(
  uuid, uuid, uuid, text
) RENAME TO record_court_provider_audit_recovery_failure_live;
REVOKE ALL ON FUNCTION public.record_court_provider_audit_recovery_failure_live(
  uuid, uuid, uuid, text
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.record_court_provider_audit_recovery_failure(
  p_verdict_id uuid,
  p_admin_user_id uuid,
  p_recovery_lease_token uuid,
  p_error_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_handoff public.court_provider_deletion_handoffs%ROWTYPE;
  v_live_result jsonb;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_verdict_id IS NULL OR p_admin_user_id IS NULL
    OR p_recovery_lease_token IS NULL
    OR p_error_code NOT IN (
      'recovery_claim_invalid',
      'required_audit_write_failed',
      'audit_finalize_failed'
    )
  THEN
    RAISE EXCEPTION 'invalid court provider audit recovery failure arguments'
      USING ERRCODE = '22023';
  END IF;

  -- Match the account-deletion lock order: profile -> case -> descendants.
  PERFORM 1
  FROM public.profiles AS profile
  WHERE profile.id = p_admin_user_id
    AND profile.account_deleting_at IS NULL
    AND profile.is_admin = true
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court provider audit recovery requires an active admin'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.court_cases AS court_case
  JOIN public.court_verdicts AS verdict
    ON verdict.case_id = court_case.id
  WHERE verdict.id = p_verdict_id
  FOR UPDATE OF court_case;
  IF FOUND THEN
    v_live_result := public.record_court_provider_audit_recovery_failure_live(
      p_verdict_id,
      p_admin_user_id,
      p_recovery_lease_token,
      p_error_code
    );
    RETURN v_live_result || pg_catalog.jsonb_build_object(
      'subject_deleted', false
    );
  END IF;

  SELECT handoff.* INTO v_handoff
  FROM public.court_provider_deletion_handoffs AS handoff
  WHERE handoff.verdict_id = p_verdict_id
  FOR UPDATE;
  IF NOT FOUND OR v_handoff.handoff_state <> 'audit_pending'
    OR v_handoff.recovery_lease_token IS DISTINCT FROM p_recovery_lease_token
    OR v_handoff.recovery_lease_expires_at IS NULL
    OR v_handoff.recovery_lease_expires_at <= pg_catalog.clock_timestamp()
    OR v_handoff.expires_at <= pg_catalog.clock_timestamp()
  THEN
    RAISE EXCEPTION 'court provider audit recovery lease is no longer valid'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.court_provider_deletion_handoffs
  SET recovery_last_error_code = p_error_code,
      recovery_last_error_at = pg_catalog.clock_timestamp()
  WHERE id = v_handoff.id
    AND handoff_state = 'audit_pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court deleted-subject audit recovery changed concurrently'
      USING ERRCODE = '40001';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'verdict_id', p_verdict_id,
    'provider_audit_state', 'pending',
    'error_code', p_error_code,
    'retry_after', v_handoff.recovery_lease_expires_at,
    'subject_deleted', true
  );
END;
$$;

ALTER FUNCTION public.record_court_provider_audit_recovery_failure(
  uuid, uuid, uuid, text
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_court_provider_audit_recovery_failure(
  uuid, uuid, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_court_provider_audit_recovery_failure(
  uuid, uuid, uuid, text
) TO service_role;

-- A verdict has one provider reservation and therefore one deletion handoff.
-- Make that invariant explicit before exposing a verdict-addressed resolver.
ALTER TABLE public.court_provider_deletion_handoffs
  ADD CONSTRAINT court_provider_deletion_handoffs_verdict_id_key UNIQUE (verdict_id),
  ADD COLUMN provider_resolution_action text,
  ADD COLUMN provider_resolution_at timestamptz,
  ADD COLUMN provider_reported_cost_usd numeric(10,6);
ALTER TABLE public.court_provider_deletion_handoffs
  ADD CONSTRAINT court_provider_deletion_handoffs_resolution_check CHECK (
    (provider_resolution_action IS NULL
      AND provider_resolution_at IS NULL
      AND provider_reported_cost_usd IS NULL)
    OR (provider_resolution_action = 'confirm_no_charge'
      AND handoff_state = 'resolved_no_charge'
      AND provider_resolution_at IS NOT NULL
      AND provider_reported_cost_usd IS NULL)
    OR (provider_resolution_action = 'record_paid'
      AND handoff_state IN ('audit_pending', 'audited')
      AND provider_resolution_at IS NOT NULL
      AND audit_model IS NOT NULL
      AND provider_input_tokens IS NOT NULL
      AND provider_output_tokens IS NOT NULL
      AND (provider_reported_cost_usd IS NULL
        OR (provider_reported_cost_usd >= 0
          AND provider_reported_cost_usd <= 9999.999999)))
  );

-- This RPC records only the provider-dashboard conclusion. It deliberately
-- stores no administrator id, user id, case data, payload, or free-form note.
CREATE FUNCTION public.resolve_court_provider_deletion_handoff(
  p_verdict_id uuid,
  p_admin_user_id uuid,
  p_action text,
  p_confirmation text,
  p_audit_model text DEFAULT NULL,
  p_input_tokens integer DEFAULT NULL,
  p_output_tokens integer DEFAULT NULL,
  p_cached_input_tokens integer DEFAULT NULL,
  p_cache_write_input_tokens integer DEFAULT NULL,
  p_cost_usd numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_handoff public.court_provider_deletion_handoffs%ROWTYPE;
  v_resolution_at timestamptz;
  v_canonical_cost numeric(10,6);
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_verdict_id IS NULL OR p_admin_user_id IS NULL
    OR p_action IS NULL
    OR p_action NOT IN ('confirm_no_charge', 'record_paid')
    OR (p_action = 'confirm_no_charge' AND (
      p_confirmation IS DISTINCT FROM 'CONFIRM_PROVIDER_NO_CHARGE'
      OR p_audit_model IS NOT NULL
      OR p_input_tokens IS NOT NULL OR p_output_tokens IS NOT NULL
      OR p_cached_input_tokens IS NOT NULL
      OR p_cache_write_input_tokens IS NOT NULL
      OR p_cost_usd IS NOT NULL
    ))
    OR (p_action = 'record_paid' AND (
      p_confirmation IS DISTINCT FROM 'CONFIRM_PROVIDER_PAID'
      OR p_audit_model IS NULL
      OR p_audit_model !~ '^[A-Za-z0-9._:/-]{1,128}$'
      OR p_input_tokens IS NULL
      OR p_output_tokens IS NULL
      OR p_input_tokens NOT BETWEEN 0 AND 10000000
      OR p_output_tokens NOT BETWEEN 0 AND 10000000
      OR COALESCE(p_cached_input_tokens, 0) NOT BETWEEN 0 AND p_input_tokens
      OR COALESCE(p_cache_write_input_tokens, 0)
        NOT BETWEEN 0 AND p_input_tokens
      OR (p_cost_usd IS NOT NULL
        AND (p_cost_usd < 0 OR p_cost_usd > 9999.999999))
    ))
  THEN
    RAISE EXCEPTION 'invalid court provider deletion handoff resolution arguments'
      USING ERRCODE = '22023';
  END IF;
  v_canonical_cost := pg_catalog.round(p_cost_usd, 6)::numeric(10,6);

  PERFORM 1
  FROM public.profiles AS profile
  WHERE profile.id = p_admin_user_id
    AND profile.account_deleting_at IS NULL
    AND profile.is_admin = true
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court provider deletion handoff resolution requires an active admin'
      USING ERRCODE = '42501';
  END IF;

  SELECT handoff.* INTO v_handoff
  FROM public.court_provider_deletion_handoffs AS handoff
  WHERE handoff.verdict_id = p_verdict_id
  FOR UPDATE;
  IF NOT FOUND OR v_handoff.expires_at <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'court provider deletion handoff is unavailable'
      USING ERRCODE = '55000';
  END IF;

  IF v_handoff.provider_resolution_action IS NOT NULL THEN
    IF v_handoff.provider_resolution_action IS DISTINCT FROM p_action
      OR (p_action = 'confirm_no_charge'
        AND v_handoff.handoff_state <> 'resolved_no_charge')
      OR (p_action = 'record_paid' AND (
        v_handoff.handoff_state NOT IN ('audit_pending', 'audited')
        OR v_handoff.audit_model IS DISTINCT FROM p_audit_model
        OR v_handoff.provider_input_tokens IS DISTINCT FROM p_input_tokens
        OR v_handoff.provider_output_tokens IS DISTINCT FROM p_output_tokens
        OR v_handoff.provider_cached_input_tokens
          IS DISTINCT FROM p_cached_input_tokens
        OR v_handoff.provider_cache_write_input_tokens
          IS DISTINCT FROM p_cache_write_input_tokens
        OR v_handoff.provider_reported_cost_usd IS DISTINCT FROM v_canonical_cost
      ))
    THEN
      RAISE EXCEPTION 'court_provider_deletion_resolution_already_recorded'
        USING ERRCODE = '55000';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'verdict_id', p_verdict_id,
      'handoff_state', v_handoff.handoff_state,
      'action', p_action,
      'resolved_at', v_handoff.provider_resolution_at,
      'subject_deleted', true,
      'reused', true
    );
  END IF;

  IF v_handoff.handoff_state <> 'provider_unknown' THEN
    RAISE EXCEPTION 'court provider deletion handoff resolution is not required'
      USING ERRCODE = '55000';
  END IF;
  IF p_action = 'record_paid'
    AND v_handoff.expires_at
      <= pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => 30)
  THEN
    RAISE EXCEPTION 'court provider deletion handoff has insufficient audit time'
      USING ERRCODE = '55000';
  END IF;

  v_resolution_at := pg_catalog.clock_timestamp();
  IF p_action = 'confirm_no_charge' THEN
    UPDATE public.court_provider_deletion_handoffs
    SET handoff_state = 'resolved_no_charge',
        lease_token = NULL,
        resolved_at = v_resolution_at,
        provider_resolution_action = p_action,
        provider_resolution_at = v_resolution_at,
        provider_reported_cost_usd = NULL,
        recovery_lease_token = NULL,
        recovery_lease_expires_at = NULL,
        recovery_last_error_code = NULL,
        recovery_last_error_at = NULL
    WHERE id = v_handoff.id
      AND handoff_state = 'provider_unknown';
  ELSE
    UPDATE public.court_provider_deletion_handoffs
    SET handoff_state = 'audit_pending',
        audit_model = p_audit_model,
        provider_input_tokens = p_input_tokens,
        provider_output_tokens = p_output_tokens,
        provider_cached_input_tokens = p_cached_input_tokens,
        provider_cache_write_input_tokens = p_cache_write_input_tokens,
        audit_cost_usd = v_canonical_cost,
        paid_observed_at = v_resolution_at,
        audit_pending_at = v_resolution_at,
        provider_resolution_action = p_action,
        provider_resolution_at = v_resolution_at,
        provider_reported_cost_usd = v_canonical_cost,
        recovery_lease_token = NULL,
        recovery_lease_expires_at = NULL,
        recovery_last_error_code = NULL,
        recovery_last_error_at = NULL
    WHERE id = v_handoff.id
      AND handoff_state = 'provider_unknown';
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court provider deletion handoff changed concurrently'
      USING ERRCODE = '40001';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'verdict_id', p_verdict_id,
    'handoff_state', CASE p_action
      WHEN 'confirm_no_charge' THEN 'resolved_no_charge'
      ELSE 'audit_pending'
    END,
    'action', p_action,
    'resolved_at', v_resolution_at,
    'subject_deleted', true,
    'reused', false
  );
END;
$$;

ALTER FUNCTION public.resolve_court_provider_deletion_handoff(
  uuid, uuid, text, text, text, integer, integer, integer, integer, numeric
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resolve_court_provider_deletion_handoff(
  uuid, uuid, text, text, text, integer, integer, integer, integer, numeric
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_court_provider_deletion_handoff(
  uuid, uuid, text, text, text, integer, integer, integer, integer, numeric
) TO service_role;

-- Aggregate-only operational evidence. No row in this table can be joined
-- back to a request, verdict, case, account, couple, or provider model.
CREATE TABLE public.court_provider_deletion_handoff_metrics (
  metric_day date NOT NULL,
  metric_code text NOT NULL CHECK (metric_code IN (
    'expired_provider_unknown',
    'expired_audit_pending_missing',
    'expired_audited_missing',
    'expired_resolved_no_charge',
    'expired_evidence_preserved',
    'raw_horizon_evidence_preserved',
    'aggregate_horizon_evidence_deleted',
    'evidence_invalid_deleted'
  )),
  event_count bigint NOT NULL DEFAULT 0 CHECK (event_count >= 0),
  tokens_input bigint NOT NULL DEFAULT 0 CHECK (tokens_input >= 0),
  tokens_output bigint NOT NULL DEFAULT 0 CHECK (tokens_output >= 0),
  cost_usd numeric NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  PRIMARY KEY (metric_day, metric_code)
);
ALTER TABLE public.court_provider_deletion_handoff_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.court_provider_deletion_handoff_metrics OWNER TO postgres;
REVOKE ALL ON TABLE public.court_provider_deletion_handoff_metrics
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.court_provider_deletion_handoff_metrics TO service_role;
COMMENT ON TABLE public.court_provider_deletion_handoff_metrics IS
  'Two-year aggregate-only deletion-handoff cleanup metrics. Contains no identifiers, request keys, model names, free text, or payloads.';

CREATE FUNCTION public.enforce_court_provider_deletion_handoff_retention(
  p_batch_size integer DEFAULT 1000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_handoff public.court_provider_deletion_handoffs%ROWTYPE;
  v_audit public.ai_interactions_log%ROWTYPE;
  v_has_audit boolean;
  v_evidence_valid boolean;
  v_delete_audit boolean;
  v_handoff_expired boolean;
  v_expected_usage jsonb;
  v_safe_metadata jsonb;
  v_metric_code text;
  v_metric_tokens_input bigint;
  v_metric_tokens_output bigint;
  v_metric_cost numeric;
  v_processed integer := 0;
  v_preserved integer := 0;
  v_deleted integer := 0;
  v_missing integer := 0;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'invalid court provider deletion handoff retention batch size'
      USING ERRCODE = '22023';
  END IF;

  -- Hourly cron, the daily AI-retention wrapper, and an operator RPC can
  -- overlap. Serialize complete batches so two sessions cannot acquire daily
  -- metric rows in opposite orders and roll a cleanup transaction back.
  PERFORM pg_catalog.pg_advisory_xact_lock(20260714102000::bigint);

  -- Handoffs are always the first lock. The linked ledger and AI row follow,
  -- matching the deletion trigger, writer, and finalizer lock order.
  FOR v_handoff IN
    SELECT handoff.*
    FROM public.court_provider_deletion_handoffs AS handoff
    WHERE (
      handoff.expires_at <= pg_catalog.clock_timestamp()
      OR EXISTS (
        SELECT 1
        FROM public.court_provider_audit_logs AS audit_link
        JOIN public.ai_interactions_log AS interaction
          ON interaction.id = audit_link.ai_interaction_id
        WHERE audit_link.request_key = handoff.request_key
          AND interaction.created_at <= pg_catalog.clock_timestamp()
            - pg_catalog.make_interval(days => 90)
      )
    )
      AND (
        handoff.recovery_lease_expires_at IS NULL
        OR handoff.recovery_lease_expires_at <= pg_catalog.clock_timestamp()
      )
    ORDER BY handoff.expires_at, handoff.id
    LIMIT p_batch_size
    FOR UPDATE OF handoff SKIP LOCKED
  LOOP
    SELECT interaction.* INTO v_audit
    FROM public.court_provider_audit_logs AS audit_link
    JOIN public.ai_interactions_log AS interaction
      ON interaction.id = audit_link.ai_interaction_id
    WHERE audit_link.request_key = v_handoff.request_key
    FOR UPDATE OF audit_link, interaction;
    v_has_audit := FOUND;
    v_handoff_expired :=
      v_handoff.expires_at <= pg_catalog.clock_timestamp();
    v_expected_usage := CASE
      WHEN v_handoff.provider_input_tokens IS NULL THEN NULL
      ELSE pg_catalog.jsonb_build_object(
        'input_tokens', v_handoff.provider_input_tokens,
        'output_tokens', v_handoff.provider_output_tokens,
        'cached_input_tokens', v_handoff.provider_cached_input_tokens,
        'cache_write_input_tokens',
          v_handoff.provider_cache_write_input_tokens
      )
    END;

    v_evidence_valid := COALESCE(v_has_audit
      AND v_handoff.handoff_state IN ('audit_pending', 'audited')
      AND v_handoff.audit_model IS NOT NULL
      AND v_audit.user_id IS NULL
      AND v_audit.couple_id IS NULL
      AND v_audit.session_id IS NULL
      AND v_audit.message_id IS NULL
      AND v_audit.interaction_type = 'couple_court_verdict'
      AND v_audit.specialist_type IS NULL
      AND v_audit.user_input IS NULL
      AND v_audit.ai_output IS NULL
      AND v_audit.tool_name IS NULL
      AND v_audit.tool_input IS NULL
      AND v_audit.tool_output IS NULL
      AND v_audit.latency_ms = 0
      AND v_audit.success = true
      AND v_audit.error_message IS NULL
      AND v_audit.model IS NOT DISTINCT FROM v_handoff.audit_model
      AND v_audit.tokens_input
        IS NOT DISTINCT FROM v_handoff.provider_input_tokens
      AND v_audit.tokens_output
        IS NOT DISTINCT FROM v_handoff.provider_output_tokens
      AND (v_handoff.audit_cost_usd IS NULL
        OR v_audit.cost_usd IS NOT DISTINCT FROM v_handoff.audit_cost_usd)
      AND pg_catalog.jsonb_typeof(v_audit.metadata) = 'object'
      AND v_audit.metadata ->> 'source' = 'couple_court_judge'
      AND v_audit.metadata ->> 'quota_class' = 'provider_call'
      AND v_audit.metadata -> 'request_usage' IS NOT DISTINCT FROM v_expected_usage
      AND (
        NOT (v_audit.metadata ? 'account_deleted')
        OR v_audit.metadata ->> 'account_deleted' = 'true'
      )
      AND (
        NOT (v_audit.metadata ? 'retention_policy')
        OR v_audit.metadata ->> 'retention_policy' IN (
          'raw_payload_and_identifiers_90d',
          'court_deleted_subject_aggregate'
        )
      )
      AND (
        v_audit.metadata - ARRAY[
          'source', 'quota_class', 'request_usage', 'account_deleted',
          'payload_redacted_at', 'visibility', 'endpoint',
          'retention_redacted_at', 'retention_policy'
        ]::text[]
      ) = '{}'::jsonb, false);

    v_delete_audit := v_has_audit AND (
      NOT v_evidence_valid
      OR v_audit.created_at <= pg_catalog.clock_timestamp()
        - pg_catalog.make_interval(years => 1)
    );
    v_metric_tokens_input := CASE WHEN v_evidence_valid
      THEN COALESCE(v_audit.tokens_input, 0)::bigint ELSE 0 END;
    v_metric_tokens_output := CASE WHEN v_evidence_valid
      THEN COALESCE(v_audit.tokens_output, 0)::bigint ELSE 0 END;
    v_metric_cost := CASE WHEN v_evidence_valid
      THEN COALESCE(v_audit.cost_usd, 0) ELSE 0 END;

    IF v_evidence_valid THEN
      v_safe_metadata := pg_catalog.jsonb_strip_nulls(
        pg_catalog.jsonb_build_object(
          'source', 'couple_court_judge',
          'quota_class', 'provider_call',
          'request_usage', v_expected_usage,
          'account_deleted', true,
          'payload_redacted_at', v_handoff.created_at,
          'retention_policy', 'court_deleted_subject_aggregate'
        )
      );
      UPDATE public.ai_interactions_log
      SET user_id = NULL,
          couple_id = NULL,
          session_id = NULL,
          message_id = NULL,
          specialist_type = NULL,
          user_input = NULL,
          ai_output = NULL,
          tool_name = NULL,
          tool_input = NULL,
          tool_output = NULL,
          latency_ms = 0,
          success = true,
          error_message = NULL,
          metadata = v_safe_metadata
      WHERE id = v_audit.id;

      IF v_delete_audit THEN
        v_metric_code := 'aggregate_horizon_evidence_deleted';
        v_deleted := v_deleted + 1;
      ELSIF v_handoff_expired THEN
        v_metric_code := 'expired_evidence_preserved';
        v_preserved := v_preserved + 1;
      ELSE
        v_metric_code := 'raw_horizon_evidence_preserved';
        v_preserved := v_preserved + 1;
      END IF;
    ELSIF v_has_audit THEN
      v_metric_code := 'evidence_invalid_deleted';
      v_deleted := v_deleted + 1;
    ELSE
      v_metric_code := CASE v_handoff.handoff_state
        WHEN 'provider_unknown' THEN 'expired_provider_unknown'
        WHEN 'audit_pending' THEN 'expired_audit_pending_missing'
        WHEN 'audited' THEN 'expired_audited_missing'
        ELSE 'expired_resolved_no_charge'
      END;
      v_missing := v_missing + 1;
    END IF;

    INSERT INTO public.court_provider_deletion_handoff_metrics (
      metric_day, metric_code, event_count, tokens_input, tokens_output,
      cost_usd, updated_at
    ) VALUES (
      (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::date,
      v_metric_code, 1, v_metric_tokens_input, v_metric_tokens_output,
      v_metric_cost, pg_catalog.clock_timestamp()
    )
    ON CONFLICT (metric_day, metric_code) DO UPDATE
    SET event_count =
          court_provider_deletion_handoff_metrics.event_count + 1,
        tokens_input =
          court_provider_deletion_handoff_metrics.tokens_input
            + EXCLUDED.tokens_input,
        tokens_output =
          court_provider_deletion_handoff_metrics.tokens_output
            + EXCLUDED.tokens_output,
        cost_usd =
          court_provider_deletion_handoff_metrics.cost_usd
            + EXCLUDED.cost_usd,
        updated_at = EXCLUDED.updated_at;

    IF v_delete_audit THEN
      DELETE FROM public.ai_interactions_log
      WHERE id = v_audit.id;
    ELSIF v_has_audit THEN
      DELETE FROM public.court_provider_audit_logs
      WHERE request_key = v_handoff.request_key;
    END IF;
    DELETE FROM public.court_provider_deletion_handoffs
    WHERE id = v_handoff.id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'court provider deletion handoff retention changed concurrently'
        USING ERRCODE = '40001';
    END IF;
    v_processed := v_processed + 1;
  END LOOP;

  DELETE FROM public.court_provider_deletion_handoff_metrics
  WHERE metric_day
    < (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::date
      - pg_catalog.make_interval(years => 2);

  RETURN pg_catalog.jsonb_build_object(
    'processed', v_processed,
    'evidence_preserved', v_preserved,
    'evidence_deleted', v_deleted,
    'evidence_missing', v_missing
  );
END;
$$;

ALTER FUNCTION public.enforce_court_provider_deletion_handoff_retention(integer)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enforce_court_provider_deletion_handoff_retention(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_court_provider_deletion_handoff_retention(integer)
  TO service_role;

-- The legacy function performs both 90-day redaction and one-year deletion.
-- Fence both horizons before it can touch an AI row linked to a deletion
-- handoff, while retaining its reviewed implementation as owner-only code.
REVOKE ALL ON FUNCTION public.redact_old_ai_interactions(interval)
  FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION public.enforce_ai_interaction_retention()
  RENAME TO enforce_ai_interaction_retention_live;
REVOKE ALL ON FUNCTION public.enforce_ai_interaction_retention_live()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.enforce_ai_interaction_retention()
RETURNS TABLE(redacted integer, deleted integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_handoff_result jsonb;
  v_handoff_deleted integer;
BEGIN
  v_handoff_result :=
    public.enforce_court_provider_deletion_handoff_retention(10000);
  v_handoff_deleted := COALESCE(
    NULLIF(v_handoff_result ->> 'evidence_deleted', '')::integer,
    0
  );
  IF EXISTS (
    SELECT 1
    FROM public.court_provider_deletion_handoffs AS handoff
    JOIN public.court_provider_audit_logs AS audit_link
      ON audit_link.request_key = handoff.request_key
    JOIN public.ai_interactions_log AS interaction
      ON interaction.id = audit_link.ai_interaction_id
    WHERE interaction.created_at <= pg_catalog.clock_timestamp()
      - pg_catalog.make_interval(days => 90)
  ) THEN
    RAISE EXCEPTION 'court provider deletion handoff retention fence is incomplete'
      USING ERRCODE = '55000';
  END IF;
  RETURN QUERY
  SELECT live_result.redacted, live_result.deleted + v_handoff_deleted
  FROM public.enforce_ai_interaction_retention_live() AS live_result;
END;
$$;

ALTER FUNCTION public.enforce_ai_interaction_retention() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enforce_ai_interaction_retention()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_ai_interaction_retention()
  TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$
DECLARE
  v_job_id bigint;
BEGIN
  FOR v_job_id IN
    SELECT jobid
    FROM cron.job
    WHERE jobname = 'enforce-court-provider-deletion-handoff-retention'
  LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;
  PERFORM cron.schedule(
    'enforce-court-provider-deletion-handoff-retention',
    '7 * * * *',
    'SELECT public.enforce_court_provider_deletion_handoff_retention(1000);'
  );
END;
$$;
