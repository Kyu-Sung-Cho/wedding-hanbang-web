-- RELEASE CANDIDATE ONLY / PHASE B.
-- Promote only after Phase A has been live for at least 24 hours, a successful
-- server-only join has been observed, and no legacy RPC attempt was observed
-- during the same 24-hour drain window. This file is deliberately outside the
-- active migration directory.
--
-- PostgreSQL cannot durably record a call that later times out, is cancelled,
-- or aborts: its telemetry write rolls back with that call. Before promotion,
-- an operator must therefore inspect external PostgREST/API logs and supported
-- client-fleet deployment evidence, then atomically record the 24-hour window,
-- verification time, and a non-secret evidence reference in
-- couple_invite_join_runtime_state. The gate below rejects stale or missing
-- attestations; DB telemetry alone is intentionally insufficient.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

LOCK TABLE public.couple_invite_join_runtime_state
  IN SHARE ROW EXCLUSIVE MODE;

DO $canary_precondition$
DECLARE
  v_state public.couple_invite_join_runtime_state%ROWTYPE;
BEGIN
  SELECT * INTO v_state
  FROM public.couple_invite_join_runtime_state
  WHERE singleton
  FOR UPDATE;

  IF NOT FOUND
     OR pg_catalog.to_regprocedure('public.join_couple_server(uuid,text,text)') IS NULL
     OR NOT pg_catalog.has_function_privilege(
       'service_role', 'public.join_couple_server(uuid,text,text)', 'EXECUTE'
     )
     OR v_state.expanded_at > transaction_timestamp() - interval '24 hours'
     OR v_state.last_server_success_at IS NULL
     OR v_state.last_server_success_at < v_state.expanded_at
     OR v_state.external_legacy_drain_started_at IS NULL
     OR v_state.external_legacy_drain_started_at < v_state.expanded_at
     OR v_state.external_legacy_drain_verified_at IS NULL
     OR v_state.external_legacy_drain_verified_at
          < v_state.external_legacy_drain_started_at + interval '24 hours'
     OR v_state.external_legacy_drain_verified_at
          < transaction_timestamp() - interval '1 hour'
     OR v_state.external_legacy_drain_verified_at
          > transaction_timestamp() + interval '5 minutes'
     OR v_state.external_legacy_drain_evidence IS NULL
     OR pg_catalog.btrim(v_state.external_legacy_drain_evidence) = ''
     OR v_state.last_server_success_at
          < v_state.external_legacy_drain_started_at
     OR (
        v_state.last_legacy_attempt_at IS NOT NULL
        AND (
          v_state.last_legacy_attempt_at
            > transaction_timestamp() - interval '24 hours'
          OR v_state.last_legacy_attempt_at
            >= v_state.external_legacy_drain_started_at
        )
      ) THEN
    RAISE EXCEPTION 'COUPLE_INVITE_LEGACY_REVOKE_CANARY_NOT_DRAINED';
  END IF;
END
$canary_precondition$;

REVOKE ALL ON FUNCTION public.join_couple(text, text)
  FROM PUBLIC, anon, authenticated, service_role;

UPDATE public.couple_invite_join_runtime_state
SET legacy_rpc_revoked_at = transaction_timestamp(),
    updated_at = transaction_timestamp()
WHERE singleton;

DO $postconditions$
BEGIN
  IF pg_catalog.has_function_privilege(
       'authenticated', 'public.join_couple(text,text)', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon', 'public.join_couple(text,text)', 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'service_role', 'public.join_couple_server(uuid,text,text)', 'EXECUTE'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.couple_invite_join_runtime_state
       WHERE singleton AND legacy_rpc_revoked_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'COUPLE_INVITE_LEGACY_REVOKE_POSTCONDITION_INVALID';
  END IF;
END
$postconditions$;

COMMIT;
