-- Authenticated PostgREST clients can call membership RPCs without traversing
-- the web API. Preserve those compatibility signatures, but place durable,
-- atomic account-scoped limits in front of invite-code lookup and the other
-- membership mutations. The existing transaction-safe implementations become
-- private helpers and remain the sole owners of membership state changes.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'postgres'
  ) OR pg_catalog.to_regprocedure(
    'public.create_couple_for_current_user(text)'
  ) IS NULL OR pg_catalog.to_regprocedure(
    'public.join_couple(text,text)'
  ) IS NULL OR pg_catalog.to_regprocedure(
    'public.reset_current_couple_membership()'
  ) IS NULL OR pg_catalog.to_regprocedure(
    'public.check_rate_limit_cost(text,integer,integer,integer)'
  ) IS NULL OR pg_catalog.to_regprocedure(
    'auth.uid()'
  ) IS NULL OR pg_catalog.to_regprocedure(
    'auth.role()'
  ) IS NULL OR pg_catalog.to_regprocedure(
    'extensions.digest(bytea,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'COUPLE_MEMBERSHIP_RATE_LIMIT_PREREQUISITE_MISSING'
      USING ERRCODE = '55000';
  END IF;

  IF pg_catalog.to_regprocedure(
    'public.create_couple_for_current_user_internal_20260803(text)'
  ) IS NOT NULL OR pg_catalog.to_regprocedure(
    'public.join_couple_internal_20260803(text,text)'
  ) IS NOT NULL OR pg_catalog.to_regprocedure(
    'public.reset_current_couple_membership_internal_20260803()'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'COUPLE_MEMBERSHIP_RATE_LIMIT_INTERNAL_NAME_COLLISION'
      USING ERRCODE = '55000';
  END IF;
END;
$preflight$;

ALTER FUNCTION public.create_couple_for_current_user(text)
  RENAME TO create_couple_for_current_user_internal_20260803;
ALTER FUNCTION public.join_couple(text, text)
  RENAME TO join_couple_internal_20260803;
ALTER FUNCTION public.reset_current_couple_membership()
  RENAME TO reset_current_couple_membership_internal_20260803;

ALTER FUNCTION public.create_couple_for_current_user_internal_20260803(text)
  OWNER TO postgres;
ALTER FUNCTION public.join_couple_internal_20260803(text, text)
  OWNER TO postgres;
ALTER FUNCTION public.reset_current_couple_membership_internal_20260803()
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.create_couple_for_current_user_internal_20260803(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.join_couple_internal_20260803(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reset_current_couple_membership_internal_20260803()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.consume_direct_couple_membership_rate_limit(
  p_action text,
  p_user_id uuid,
  p_max_requests integer,
  p_window_ms integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $consume_direct_couple_membership_rate_limit$
DECLARE
  v_digest text;
  v_allowed boolean;
BEGIN
  IF p_user_id IS NULL OR NOT (
    (p_action = 'create-hour' AND p_max_requests = 20 AND p_window_ms = 3600000)
    OR (p_action = 'create-day' AND p_max_requests = 50 AND p_window_ms = 86400000)
    OR (p_action = 'join-ten-minute' AND p_max_requests = 10 AND p_window_ms = 600000)
    OR (p_action = 'join-day' AND p_max_requests = 30 AND p_window_ms = 86400000)
    OR (p_action = 'reset-ten-minute' AND p_max_requests = 5 AND p_window_ms = 600000)
    OR (p_action = 'reset-day' AND p_max_requests = 10 AND p_window_ms = 86400000)
  ) THEN
    RETURN false;
  END IF;

  -- Auth UUIDs carry enough random entropy for a non-reversible bucket key;
  -- no invite code, role, email, or raw account identifier is persisted.
  v_digest := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'hanbang:couple-membership:v1' || pg_catalog.chr(31) || p_user_id::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  SELECT result.allowed
  INTO v_allowed
  FROM public.check_rate_limit_cost(
    'couple:direct:' || p_action || ':hmac-sha256:' || v_digest,
    p_max_requests,
    p_window_ms,
    1
  ) AS result;

  RETURN COALESCE(v_allowed, false);
EXCEPTION
  WHEN OTHERS THEN
    -- Membership operations fail closed if their shared limiter is unavailable.
    RETURN false;
END;
$consume_direct_couple_membership_rate_limit$;

CREATE FUNCTION public.create_couple_for_current_user(p_role text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $create_couple_for_current_user$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR v_user_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'success', false, 'created', false, 'idempotent', false,
      'error_code', 'AUTH_REQUIRED', 'error', 'Unauthenticated.'
    );
  END IF;

  IF public.consume_direct_couple_membership_rate_limit(
       'create-hour', v_user_id, 20, 3600000
     ) IS NOT TRUE OR public.consume_direct_couple_membership_rate_limit(
       'create-day', v_user_id, 50, 86400000
     ) IS NOT TRUE THEN
    RETURN pg_catalog.jsonb_build_object(
      'success', false, 'created', false, 'idempotent', false,
      'error_code', 'RATE_LIMITED', 'error', 'Too many membership requests.'
    );
  END IF;

  RETURN public.create_couple_for_current_user_internal_20260803(p_role);
END;
$create_couple_for_current_user$;

CREATE FUNCTION public.join_couple(p_invite_code text, p_role text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $join_couple$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR v_user_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'success', false, 'joined', false, 'idempotent', false,
      'error_code', 'AUTH_REQUIRED', 'error', 'Unauthenticated.'
    );
  END IF;

  IF public.consume_direct_couple_membership_rate_limit(
       'join-ten-minute', v_user_id, 10, 600000
     ) IS NOT TRUE OR public.consume_direct_couple_membership_rate_limit(
       'join-day', v_user_id, 30, 86400000
     ) IS NOT TRUE THEN
    RETURN pg_catalog.jsonb_build_object(
      'success', false, 'joined', false, 'idempotent', false,
      'error_code', 'RATE_LIMITED', 'error', 'Too many membership requests.'
    );
  END IF;

  RETURN public.join_couple_internal_20260803(p_invite_code, p_role);
END;
$join_couple$;

CREATE FUNCTION public.reset_current_couple_membership()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $reset_current_couple_membership$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;

  IF public.consume_direct_couple_membership_rate_limit(
       'reset-ten-minute', v_user_id, 5, 600000
     ) IS NOT TRUE OR public.consume_direct_couple_membership_rate_limit(
       'reset-day', v_user_id, 10, 86400000
     ) IS NOT TRUE THEN
    RAISE EXCEPTION 'couple_membership_rate_limit_exceeded'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN public.reset_current_couple_membership_internal_20260803();
END;
$reset_current_couple_membership$;

ALTER FUNCTION public.consume_direct_couple_membership_rate_limit(
  text, uuid, integer, integer
) OWNER TO postgres;
ALTER FUNCTION public.create_couple_for_current_user(text) OWNER TO postgres;
ALTER FUNCTION public.join_couple(text, text) OWNER TO postgres;
ALTER FUNCTION public.reset_current_couple_membership() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.consume_direct_couple_membership_rate_limit(
  text, uuid, integer, integer
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_couple_for_current_user(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.join_couple(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reset_current_couple_membership()
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.create_couple_for_current_user(text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_couple(text, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_current_couple_membership()
  TO authenticated;

DO $postcondition$
DECLARE
  signature text;
  procedure_record pg_catalog.pg_proc%ROWTYPE;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.create_couple_for_current_user(text)',
    'public.join_couple(text,text)',
    'public.reset_current_couple_membership()'
  ]::text[]
  LOOP
    SELECT * INTO procedure_record
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.oid = pg_catalog.to_regprocedure(signature);

    IF NOT FOUND
       OR pg_catalog.pg_get_userbyid(procedure_record.proowner) <> 'postgres'
       OR procedure_record.prosecdef IS NOT TRUE
       OR procedure_record.proconfig IS DISTINCT FROM (CASE signature
         WHEN 'public.reset_current_couple_membership()' THEN ARRAY[
           'search_path=""', 'lock_timeout=5s', 'statement_timeout=15s'
         ]::text[]
         ELSE ARRAY[
           'search_path=""', 'lock_timeout=5s', 'statement_timeout=30s'
         ]::text[]
       END)
       OR pg_catalog.has_function_privilege('anon', signature, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'COUPLE_MEMBERSHIP_RATE_LIMIT_WRAPPER_INVALID: %', signature
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  FOREACH signature IN ARRAY ARRAY[
    'public.consume_direct_couple_membership_rate_limit(text,uuid,integer,integer)',
    'public.create_couple_for_current_user_internal_20260803(text)',
    'public.join_couple_internal_20260803(text,text)',
    'public.reset_current_couple_membership_internal_20260803()'
  ]::text[]
  LOOP
    IF pg_catalog.has_function_privilege('anon', signature, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'COUPLE_MEMBERSHIP_INTERNAL_FUNCTION_EXPOSED: %', signature
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END;
$postcondition$;

COMMENT ON FUNCTION public.consume_direct_couple_membership_rate_limit(
  text, uuid, integer, integer
) IS 'Private exact-contract persistent limiter for direct membership RPC calls.';
COMMENT ON FUNCTION public.join_couple(text, text) IS
  'Authenticated compatibility wrapper with atomic 10/10-minute and 30/day invite lookup limits.';
COMMENT ON FUNCTION public.create_couple_for_current_user(text) IS
  'Authenticated compatibility wrapper with atomic 20/hour and 50/day creation limits.';
COMMENT ON FUNCTION public.reset_current_couple_membership() IS
  'Authenticated compatibility wrapper with atomic 5/10-minute and 10/day reset limits.';

COMMIT;
