-- Linearizable, content-bound provider egress grants for Amora.
--
-- A provider token-count and a generation are separate content-bearing
-- egresses. Each one receives a distinct, five-second, single-use grant bound
-- to the exact SHA-256 request body. Couple membership, the privacy epoch, the
-- provider runtime control, and the durable provider receipt are all checked
-- again when the grant is consumed. No prompt or response content is stored.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preconditions$
BEGIN
  IF to_regclass('public.couples') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.ai_interactions_log') IS NULL
     OR to_regclass('public.amora_privacy_context_epochs') IS NULL
     OR to_regprocedure('auth.role()') IS NULL THEN
    RAISE EXCEPTION 'AMORA_PROVIDER_EGRESS_GRANT_PREREQUISITE_MISSING';
  END IF;
END
$preconditions$;

CREATE TABLE public.amora_provider_runtime_control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false,
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  reason text NOT NULL DEFAULT 'migration_default_off'
    CHECK (reason ~ '^[A-Za-z0-9_.:-]{1,120}$'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.amora_provider_runtime_control OWNER TO postgres;
ALTER TABLE public.amora_provider_runtime_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amora_provider_runtime_control FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.amora_provider_runtime_control
  FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO public.amora_provider_runtime_control(
  singleton, enabled, version, reason
) VALUES (true, false, 1, 'migration_default_off');

CREATE TABLE public.amora_provider_egress_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_token uuid NOT NULL DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL
    REFERENCES public.ai_interactions_log(id) ON DELETE CASCADE,
  receipt_claim_token uuid NOT NULL,
  actor_user_id uuid,
  couple_id uuid REFERENCES public.couples(id) ON DELETE CASCADE,
  visibility text,
  expected_privacy_epoch bigint,
  operation text NOT NULL CHECK (
    operation IN ('responses.input_tokens.count', 'responses.create')
  ),
  content_binding text NOT NULL CHECK (content_binding ~ '^[0-9a-f]{64}$'),
  issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  revoke_reason text,
  CONSTRAINT amora_provider_egress_scope_shape CHECK (
    (
      actor_user_id IS NULL
      AND couple_id IS NULL
      AND visibility IS NULL
      AND expected_privacy_epoch IS NULL
    )
    OR (
      actor_user_id IS NOT NULL
      AND couple_id IS NOT NULL
      AND visibility IN ('shared', 'bride_private', 'groom_private')
      AND expected_privacy_epoch >= 1
    )
  ),
  CONSTRAINT amora_provider_egress_terminal_shape CHECK (
    consumed_at IS NULL OR revoked_at IS NULL
  ),
  CONSTRAINT amora_provider_egress_expiry_shape CHECK (
    expires_at > issued_at AND expires_at <= issued_at + interval '5 seconds'
  ),
  UNIQUE (receipt_id, operation)
);

ALTER TABLE public.amora_provider_egress_grants OWNER TO postgres;
ALTER TABLE public.amora_provider_egress_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amora_provider_egress_grants FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.amora_provider_egress_grants
  FROM PUBLIC, anon, authenticated, service_role;

CREATE INDEX idx_amora_provider_egress_grants_active_scope
  ON public.amora_provider_egress_grants(couple_id, expected_privacy_epoch)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE INDEX idx_amora_provider_egress_grants_open_expiry
  ON public.amora_provider_egress_grants(expires_at)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE FUNCTION public.is_current_amora_provider_egress_actor(
  p_actor_user_id uuid,
  p_couple_id uuid,
  p_visibility text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.couples AS couple
    JOIN public.profiles AS profile
      ON profile.id = p_actor_user_id
     AND profile.couple_id = couple.id
    WHERE couple.id = p_couple_id
      AND (
        (
          p_visibility = 'shared'
          AND (
            couple.bride_id = p_actor_user_id
            OR couple.groom_id = p_actor_user_id
          )
          AND (
            (profile.role = 'bride' AND couple.bride_id = p_actor_user_id)
            OR (profile.role = 'groom' AND couple.groom_id = p_actor_user_id)
          )
        )
        OR (
          p_visibility = 'bride_private'
          AND couple.bride_id = p_actor_user_id
          AND profile.role = 'bride'
        )
        OR (
          p_visibility = 'groom_private'
          AND couple.groom_id = p_actor_user_id
          AND profile.role = 'groom'
        )
      )
  )
$function$;

ALTER FUNCTION public.is_current_amora_provider_egress_actor(uuid, uuid, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION
  public.is_current_amora_provider_egress_actor(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.issue_amora_provider_egress_grant(
  p_receipt_id uuid,
  p_receipt_claim_token uuid,
  p_actor_user_id uuid,
  p_couple_id uuid,
  p_visibility text,
  p_expected_privacy_epoch bigint,
  p_operation text,
  p_content_binding text
)
RETURNS TABLE(
  grant_id uuid,
  grant_token uuid,
  issued boolean,
  expires_at timestamptz,
  reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_receipt public.ai_interactions_log%ROWTYPE;
  v_grant public.amora_provider_egress_grants%ROWTYPE;
  v_epoch bigint;
  v_runtime_enabled boolean;
  v_scoped boolean := p_couple_id IS NOT NULL;
  v_issued_at timestamptz := clock_timestamp();
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_PROVIDER_EGRESS_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF p_receipt_id IS NULL
     OR p_receipt_claim_token IS NULL
     OR p_operation NOT IN (
       'responses.input_tokens.count', 'responses.create'
     )
     OR p_content_binding IS NULL
     OR p_content_binding !~ '^[0-9a-f]{64}$'
     OR (
       v_scoped
       AND (
         p_actor_user_id IS NULL
         OR p_visibility NOT IN ('shared', 'bride_private', 'groom_private')
         OR p_expected_privacy_epoch IS NULL
         OR p_expected_privacy_epoch < 1
       )
     )
     OR (
       NOT v_scoped
       AND (
         p_actor_user_id IS NOT NULL
         OR p_visibility IS NOT NULL
         OR p_expected_privacy_epoch IS NOT NULL
       )
     ) THEN
    RAISE EXCEPTION 'AMORA_PROVIDER_EGRESS_INVALID_ARGS'
      USING ERRCODE = '22023';
  END IF;

  -- Couple -> epoch is the same lock order used by roster mutation triggers.
  -- Whichever transaction wins is the linearization point: a committed
  -- unlink/consent change always wins before a later grant issue/consume.
  IF v_scoped THEN
    PERFORM 1
    FROM public.couples
    WHERE id = p_couple_id
    FOR KEY SHARE;
    IF NOT FOUND THEN
      RETURN QUERY SELECT NULL::uuid, NULL::uuid, false,
        NULL::timestamptz, 'scope_changed'::text;
      RETURN;
    END IF;

    SELECT epoch INTO v_epoch
    FROM public.amora_privacy_context_epochs
    WHERE couple_id = p_couple_id
    FOR SHARE;
    IF v_epoch IS DISTINCT FROM p_expected_privacy_epoch
       OR NOT public.is_current_amora_provider_egress_actor(
         p_actor_user_id, p_couple_id, p_visibility
       ) THEN
      RETURN QUERY SELECT NULL::uuid, NULL::uuid, false,
        NULL::timestamptz, 'privacy_context_changed'::text;
      RETURN;
    END IF;
  END IF;

  SELECT enabled INTO v_runtime_enabled
  FROM public.amora_provider_runtime_control
  WHERE singleton = true
  FOR SHARE;
  IF v_runtime_enabled IS DISTINCT FROM true THEN
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, false,
      NULL::timestamptz, 'runtime_disabled'::text;
    RETURN;
  END IF;

  SELECT * INTO v_receipt
  FROM public.ai_interactions_log
  WHERE id = p_receipt_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_receipt.amora_claim_token IS DISTINCT FROM p_receipt_claim_token
     OR v_receipt.user_id IS DISTINCT FROM p_actor_user_id
     OR v_receipt.couple_id IS DISTINCT FROM p_couple_id
     OR v_receipt.amora_cost_status NOT IN ('prepared', 'reserved')
     OR (
       p_operation = 'responses.create'
       AND v_receipt.amora_cost_status <> 'reserved'
     )
     OR (
       v_scoped
       AND v_receipt.amora_call_source NOT IN ('durable', 'conflict_check')
     )
     OR (
       NOT v_scoped
       AND v_receipt.amora_call_source NOT IN ('demo', 'release_eval')
     ) THEN
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, false,
      NULL::timestamptz, 'receipt_mismatch'::text;
    RETURN;
  END IF;

  INSERT INTO public.amora_provider_egress_grants(
    receipt_id,
    receipt_claim_token,
    actor_user_id,
    couple_id,
    visibility,
    expected_privacy_epoch,
    operation,
    content_binding,
    issued_at,
    expires_at
  ) VALUES (
    p_receipt_id,
    p_receipt_claim_token,
    p_actor_user_id,
    p_couple_id,
    p_visibility,
    p_expected_privacy_epoch,
    p_operation,
    p_content_binding,
    v_issued_at,
    v_issued_at + interval '5 seconds'
  )
  ON CONFLICT (receipt_id, operation) DO NOTHING
  RETURNING * INTO v_grant;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, false,
      NULL::timestamptz, 'already_issued'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT v_grant.id, v_grant.grant_token, true,
    v_grant.expires_at, NULL::text;
END
$function$;

CREATE FUNCTION public.consume_amora_provider_egress_grant(
  p_grant_id uuid,
  p_grant_token uuid,
  p_content_binding text
)
RETURNS TABLE(consumed boolean, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_hint public.amora_provider_egress_grants%ROWTYPE;
  v_grant public.amora_provider_egress_grants%ROWTYPE;
  v_receipt public.ai_interactions_log%ROWTYPE;
  v_epoch bigint;
  v_runtime_enabled boolean;
  v_now timestamptz;
  v_denial text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_PROVIDER_EGRESS_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;
  IF p_grant_id IS NULL
     OR p_grant_token IS NULL
     OR p_content_binding IS NULL
     OR p_content_binding !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'AMORA_PROVIDER_EGRESS_INVALID_ARGS'
      USING ERRCODE = '22023';
  END IF;

  -- Read only enough to establish the canonical lock order. Every field is
  -- re-read under row lock below before it can authorize anything.
  SELECT * INTO v_hint
  FROM public.amora_provider_egress_grants
  WHERE id = p_grant_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found'::text;
    RETURN;
  END IF;

  IF v_hint.couple_id IS NOT NULL THEN
    PERFORM 1
    FROM public.couples
    WHERE id = v_hint.couple_id
    FOR KEY SHARE;
    IF NOT FOUND THEN
      v_denial := 'scope_changed';
    ELSE
      SELECT epoch INTO v_epoch
      FROM public.amora_privacy_context_epochs
      WHERE couple_id = v_hint.couple_id
      FOR SHARE;
    END IF;
  END IF;

  SELECT enabled INTO v_runtime_enabled
  FROM public.amora_provider_runtime_control
  WHERE singleton = true
  FOR SHARE;

  SELECT * INTO v_grant
  FROM public.amora_provider_egress_grants
  WHERE id = p_grant_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found'::text;
    RETURN;
  END IF;

  v_now := clock_timestamp();
  IF v_grant.grant_token IS DISTINCT FROM p_grant_token THEN
    v_denial := 'token_mismatch';
  ELSIF v_grant.consumed_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'already_consumed'::text;
    RETURN;
  ELSIF v_grant.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT false, COALESCE(v_grant.revoke_reason, 'revoked');
    RETURN;
  ELSIF v_runtime_enabled IS DISTINCT FROM true THEN
    v_denial := 'runtime_disabled';
  ELSIF v_now >= v_grant.expires_at THEN
    v_denial := 'expired';
  ELSIF v_grant.content_binding IS DISTINCT FROM p_content_binding THEN
    v_denial := 'content_mismatch';
  ELSIF v_grant.couple_id IS NOT NULL AND (
    v_epoch IS DISTINCT FROM v_grant.expected_privacy_epoch
    OR NOT public.is_current_amora_provider_egress_actor(
      v_grant.actor_user_id,
      v_grant.couple_id,
      v_grant.visibility
    )
  ) THEN
    v_denial := 'privacy_context_changed';
  END IF;

  SELECT * INTO v_receipt
  FROM public.ai_interactions_log
  WHERE id = v_grant.receipt_id
  FOR SHARE;
  IF v_denial IS NULL AND (
    NOT FOUND
    OR v_receipt.amora_claim_token IS DISTINCT FROM v_grant.receipt_claim_token
    OR v_receipt.user_id IS DISTINCT FROM v_grant.actor_user_id
    OR v_receipt.couple_id IS DISTINCT FROM v_grant.couple_id
    OR v_receipt.amora_cost_status NOT IN ('prepared', 'reserved')
    OR (
      v_grant.operation = 'responses.create'
      AND v_receipt.amora_cost_status <> 'reserved'
    )
  ) THEN
    v_denial := 'receipt_mismatch';
  END IF;

  IF v_denial IS NOT NULL THEN
    UPDATE public.amora_provider_egress_grants
    SET revoked_at = COALESCE(revoked_at, v_now),
        revoke_reason = COALESCE(revoke_reason, v_denial)
    WHERE id = v_grant.id;
    RETURN QUERY SELECT false, v_denial;
    RETURN;
  END IF;

  UPDATE public.amora_provider_egress_grants
  SET consumed_at = v_now
  WHERE id = v_grant.id;
  RETURN QUERY SELECT true, NULL::text;
END
$function$;

CREATE FUNCTION public.set_amora_provider_runtime_control(
  p_enabled boolean,
  p_expected_version bigint,
  p_reason text
)
RETURNS TABLE(changed boolean, enabled boolean, version bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_control public.amora_provider_runtime_control%ROWTYPE;
  v_now timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_PROVIDER_EGRESS_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;
  IF p_enabled IS NULL
     OR p_expected_version IS NULL OR p_expected_version < 1
     OR p_reason IS NULL OR p_reason !~ '^[A-Za-z0-9_.:-]{1,120}$' THEN
    RAISE EXCEPTION 'AMORA_PROVIDER_RUNTIME_CONTROL_INVALID_ARGS'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_control
  FROM public.amora_provider_runtime_control
  WHERE singleton = true
  FOR UPDATE;
  IF v_control.version <> p_expected_version THEN
    RETURN QUERY SELECT false, v_control.enabled, v_control.version;
    RETURN;
  END IF;

  -- Capture time only after the runtime-control row lock is ours. This is the
  -- disable linearization point, not the potentially earlier function entry.
  v_now := clock_timestamp();
  UPDATE public.amora_provider_runtime_control AS control
  SET enabled = p_enabled,
      version = control.version + 1,
      reason = p_reason,
      updated_at = v_now
  WHERE singleton = true
  RETURNING * INTO v_control;

  IF NOT p_enabled THEN
    UPDATE public.amora_provider_egress_grants
    SET revoked_at = v_now,
        revoke_reason = 'runtime_disabled'
    WHERE consumed_at IS NULL
      AND revoked_at IS NULL
      AND expires_at > v_now;
  END IF;

  RETURN QUERY SELECT true, v_control.enabled, v_control.version;
END
$function$;

ALTER FUNCTION public.issue_amora_provider_egress_grant(
  uuid, uuid, uuid, uuid, text, bigint, text, text
) OWNER TO postgres;
ALTER FUNCTION public.consume_amora_provider_egress_grant(uuid, uuid, text)
  OWNER TO postgres;
ALTER FUNCTION public.set_amora_provider_runtime_control(boolean, bigint, text)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.issue_amora_provider_egress_grant(
  uuid, uuid, uuid, uuid, text, bigint, text, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.consume_amora_provider_egress_grant(
  uuid, uuid, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_amora_provider_runtime_control(
  boolean, bigint, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_amora_provider_egress_grant(
  uuid, uuid, uuid, uuid, text, bigint, text, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_amora_provider_egress_grant(
  uuid, uuid, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_amora_provider_runtime_control(
  boolean, bigint, text
) TO service_role;

COMMENT ON TABLE public.amora_provider_runtime_control IS
  'Fail-closed database kill switch for every content-bearing Amora provider request. The migration intentionally starts disabled.';
COMMENT ON TABLE public.amora_provider_egress_grants IS
  'Content-free, five-second, single-use capabilities bound to one provider receipt, privacy epoch, SDK operation, and SHA-256 request body.';
COMMENT ON FUNCTION public.issue_amora_provider_egress_grant(
  uuid, uuid, uuid, uuid, text, bigint, text, text
) IS 'Issues one short-lived content-bound provider capability after locking and validating current actor, scope, privacy epoch, runtime control, and receipt.';
COMMENT ON FUNCTION public.consume_amora_provider_egress_grant(uuid, uuid, text)
  IS 'Consumes one provider capability exactly once after repeating every mutable authorization check under the canonical lock order.';
