-- Bind remote push delivery to an app installation and the authenticated
-- Supabase Auth session that proved ownership. Delivery workers only receive
-- bindings whose exact Auth session still exists. Access JWT expiry is not a
-- session-expiry signal for a backgrounded app; logout/session deletion is.
-- Legacy profiles.push_token values are deliberately retired because
-- they cannot prove either installation or session ownership.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public.mobile_push_device_tokens (
  installation_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES auth.sessions(id) ON DELETE CASCADE,
  push_token text,
  platform text NOT NULL,
  binding_epoch bigint NOT NULL DEFAULT 1,
  bound_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  last_access_token_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoke_reason text,
  CONSTRAINT mobile_push_device_tokens_platform_check
    CHECK (platform IN ('ios', 'android', 'legacy')),
  CONSTRAINT mobile_push_device_tokens_epoch_check
    CHECK (binding_epoch > 0),
  CONSTRAINT mobile_push_device_tokens_time_check
    CHECK (last_seen_at >= bound_at),
  CONSTRAINT mobile_push_device_tokens_state_check CHECK (
    (
      revoked_at IS NULL
      AND revoke_reason IS NULL
      AND push_token IS NOT NULL
      AND pg_catalog.octet_length(push_token) BETWEEN 31 AND 512
      AND push_token ~ '^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$'
    )
    OR (
      revoked_at IS NOT NULL
      AND revoke_reason IS NOT NULL
      AND pg_catalog.octet_length(revoke_reason) BETWEEN 1 AND 64
      AND push_token IS NULL
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS mobile_push_device_tokens_active_token_idx
  ON public.mobile_push_device_tokens(push_token)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS mobile_push_device_tokens_delivery_idx
  ON public.mobile_push_device_tokens(user_id, session_id)
  WHERE revoked_at IS NULL;

ALTER TABLE public.mobile_push_device_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobile_push_device_tokens FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mobile_push_device_tokens_client_deny
  ON public.mobile_push_device_tokens;
CREATE POLICY mobile_push_device_tokens_client_deny
  ON public.mobile_push_device_tokens
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON TABLE public.mobile_push_device_tokens
  FROM PUBLIC, anon, authenticated, service_role;

-- A profile token has no installation/session proof. Keeping it populated
-- would leave a legacy delivery path capable of crossing account boundaries.
LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE;
UPDATE public.profiles SET push_token = NULL WHERE push_token IS NOT NULL;
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_push_token_shape_check;
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_push_token_retired_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_push_token_retired_check CHECK (push_token IS NULL);

CREATE OR REPLACE FUNCTION public.bind_mobile_push_token(
  p_installation_id uuid,
  p_push_token text,
  p_platform text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_claims jsonb := auth.jwt();
  v_session_id uuid;
  v_session_exp bigint;
  v_session_expires_at timestamptz;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_existing public.mobile_push_device_tokens%ROWTYPE;
  v_token_owner public.mobile_push_device_tokens%ROWTYPE;
  v_active_count integer;
  v_insert_epoch bigint := 1;
BEGIN
  IF v_user_id IS NULL OR COALESCE(auth.role(), '') <> 'authenticated' THEN
    RAISE EXCEPTION 'PUSH_AUTHENTICATION_REQUIRED';
  END IF;
  IF p_installation_id IS NULL THEN
    RAISE EXCEPTION 'PUSH_INSTALLATION_INVALID';
  END IF;
  IF p_push_token IS NULL
     OR p_push_token <> pg_catalog.btrim(p_push_token)
     OR pg_catalog.octet_length(p_push_token) NOT BETWEEN 31 AND 512
     OR p_push_token !~ '^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$' THEN
    RAISE EXCEPTION 'PUSH_TOKEN_INVALID';
  END IF;
  IF p_platform IS NULL OR p_platform NOT IN ('ios', 'android', 'legacy') THEN
    RAISE EXCEPTION 'PUSH_PLATFORM_INVALID';
  END IF;

  BEGIN
    v_session_id := NULLIF(v_claims ->> 'session_id', '')::uuid;
    IF COALESCE(v_claims ->> 'exp', '') !~ '^[0-9]{1,12}$' THEN
      RAISE EXCEPTION 'invalid exp';
    END IF;
    v_session_exp := (v_claims ->> 'exp')::bigint;
    v_session_expires_at := pg_catalog.to_timestamp(v_session_exp);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'PUSH_SESSION_INVALID';
  END;
  IF v_session_id IS NULL THEN
    RAISE EXCEPTION 'PUSH_SESSION_INVALID';
  END IF;
  IF v_session_expires_at <= v_now THEN
    RAISE EXCEPTION 'PUSH_SESSION_EXPIRED';
  END IF;

  -- Bind is low-frequency and security-sensitive. A single lock gives token
  -- transfer, installation transfer, stale cleanup and device-cap checks one
  -- deterministic order without cross-key deadlocks.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('mobile-push-bindings', 0)
  );

  PERFORM 1
    FROM public.profiles
   WHERE id = v_user_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PUSH_PROFILE_NOT_FOUND';
  END IF;

  PERFORM 1
    FROM auth.sessions
   WHERE id = v_session_id
     AND user_id = v_user_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PUSH_SESSION_NOT_ACTIVE';
  END IF;

  -- Expired/deleted sessions never consume the active-device cap and cannot
  -- retain a reusable delivery secret.
  UPDATE public.mobile_push_device_tokens AS binding
     SET push_token = NULL,
         revoked_at = v_now,
         revoke_reason = 'session_inactive',
         last_seen_at = v_now
   WHERE binding.user_id = v_user_id
     AND binding.revoked_at IS NULL
     AND (
       NOT EXISTS (
         SELECT 1
           FROM auth.sessions AS active_session
          WHERE active_session.id = binding.session_id
            AND active_session.user_id = binding.user_id
       )
     );

  SELECT binding.*
    INTO v_existing
    FROM public.mobile_push_device_tokens AS binding
   WHERE binding.installation_id = p_installation_id
   FOR UPDATE;
  IF FOUND
     AND v_existing.revoked_at IS NULL
     AND (
       v_existing.user_id <> v_user_id
       OR v_existing.session_id <> v_session_id
     ) THEN
    IF EXISTS (
         SELECT 1
           FROM auth.sessions AS active_session
          WHERE active_session.id = v_existing.session_id
            AND active_session.user_id = v_existing.user_id
       ) THEN
      RAISE EXCEPTION 'PUSH_INSTALLATION_ALREADY_BOUND';
    END IF;
    UPDATE public.mobile_push_device_tokens
       SET push_token = NULL,
           revoked_at = v_now,
           revoke_reason = 'session_inactive',
           last_seen_at = v_now
     WHERE installation_id = p_installation_id;
  END IF;

  SELECT binding.*
    INTO v_token_owner
    FROM public.mobile_push_device_tokens AS binding
   WHERE binding.push_token = p_push_token
     AND binding.revoked_at IS NULL
     AND binding.installation_id <> p_installation_id
   FOR UPDATE;
  IF FOUND THEN
    IF EXISTS (
         SELECT 1
           FROM auth.sessions AS active_session
          WHERE active_session.id = v_token_owner.session_id
            AND active_session.user_id = v_token_owner.user_id
       ) THEN
      IF v_token_owner.user_id = v_user_id
         AND v_token_owner.session_id = v_session_id
         AND v_token_owner.installation_id = v_session_id
         AND v_token_owner.platform = 'legacy' THEN
        v_insert_epoch := v_token_owner.binding_epoch + 1;
        UPDATE public.mobile_push_device_tokens
           SET push_token = NULL,
               revoked_at = v_now,
               revoke_reason = 'legacy_installation_upgraded',
               last_seen_at = v_now
         WHERE installation_id = v_token_owner.installation_id;
      ELSE
        RAISE EXCEPTION 'PUSH_TOKEN_ALREADY_BOUND';
      END IF;
    ELSE
      UPDATE public.mobile_push_device_tokens
         SET push_token = NULL,
             revoked_at = v_now,
             revoke_reason = 'token_reclaimed',
             last_seen_at = v_now
       WHERE installation_id = v_token_owner.installation_id;
    END IF;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO v_active_count
    FROM public.mobile_push_device_tokens AS binding
   WHERE binding.user_id = v_user_id
     AND binding.revoked_at IS NULL
     AND binding.installation_id <> p_installation_id;
  IF v_active_count >= 8 THEN
    RAISE EXCEPTION 'PUSH_ACTIVE_DEVICE_LIMIT';
  END IF;

  INSERT INTO public.mobile_push_device_tokens (
    installation_id,
    user_id,
    session_id,
    push_token,
    platform,
    binding_epoch,
    bound_at,
    last_seen_at,
    last_access_token_expires_at,
    revoked_at,
    revoke_reason
  ) VALUES (
    p_installation_id,
    v_user_id,
    v_session_id,
    p_push_token,
    p_platform,
    v_insert_epoch,
    v_now,
    v_now,
    v_session_expires_at,
    NULL,
    NULL
  )
  ON CONFLICT (installation_id) DO UPDATE
  SET binding_epoch = CASE
        WHEN mobile_push_device_tokens.user_id = EXCLUDED.user_id
         AND mobile_push_device_tokens.session_id = EXCLUDED.session_id
         AND mobile_push_device_tokens.push_token = EXCLUDED.push_token
         AND mobile_push_device_tokens.platform = EXCLUDED.platform
         AND mobile_push_device_tokens.revoked_at IS NULL
          THEN mobile_push_device_tokens.binding_epoch
        ELSE mobile_push_device_tokens.binding_epoch + 1
      END,
      user_id = EXCLUDED.user_id,
      session_id = EXCLUDED.session_id,
      push_token = EXCLUDED.push_token,
      platform = EXCLUDED.platform,
      bound_at = CASE
        WHEN mobile_push_device_tokens.user_id = EXCLUDED.user_id
         AND mobile_push_device_tokens.session_id = EXCLUDED.session_id
         AND mobile_push_device_tokens.push_token = EXCLUDED.push_token
         AND mobile_push_device_tokens.platform = EXCLUDED.platform
         AND mobile_push_device_tokens.revoked_at IS NULL
          THEN mobile_push_device_tokens.bound_at
        ELSE EXCLUDED.bound_at
      END,
      last_seen_at = EXCLUDED.last_seen_at,
      last_access_token_expires_at = EXCLUDED.last_access_token_expires_at,
      revoked_at = NULL,
      revoke_reason = NULL;

  RETURN true;
END;
$$;

-- Current client: compare-and-revoke one exact installation/token/session.
CREATE OR REPLACE FUNCTION public.release_mobile_push_token(
  p_installation_id uuid,
  p_push_token text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_session_id uuid;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF v_user_id IS NULL OR COALESCE(auth.role(), '') <> 'authenticated' THEN
    RAISE EXCEPTION 'PUSH_AUTHENTICATION_REQUIRED';
  END IF;
  BEGIN
    v_session_id := NULLIF(auth.jwt() ->> 'session_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'PUSH_SESSION_INVALID';
  END;
  IF p_installation_id IS NULL OR v_session_id IS NULL THEN
    RAISE EXCEPTION 'PUSH_SESSION_INVALID';
  END IF;
  IF p_push_token IS NULL
     OR pg_catalog.octet_length(p_push_token) NOT BETWEEN 31 AND 512
     OR p_push_token !~ '^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$' THEN
    RAISE EXCEPTION 'PUSH_TOKEN_INVALID';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('mobile-push-bindings', 0)
  );
  UPDATE public.mobile_push_device_tokens
     SET push_token = NULL,
         revoked_at = v_now,
         revoke_reason = 'session_logout',
         last_seen_at = v_now
   WHERE installation_id = p_installation_id
     AND user_id = v_user_id
     AND session_id = v_session_id
     AND push_token = p_push_token
     AND revoked_at IS NULL;
  IF NOT FOUND AND EXISTS (
    SELECT 1
      FROM public.mobile_push_device_tokens AS binding
     WHERE binding.installation_id = p_installation_id
       AND binding.user_id = v_user_id
       AND binding.session_id = v_session_id
       AND binding.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'PUSH_BINDING_MISMATCH';
  END IF;
  -- No matching row and no active binding owned by this JWT session is a
  -- confirmed safe boundary: a stale release cannot revoke a newer owner.
  RETURN true;
END;
$$;

-- Transitional client used by the current internal build: token+JWT session.
CREATE OR REPLACE FUNCTION public.release_mobile_push_token(p_push_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_session_id uuid;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF v_user_id IS NULL OR COALESCE(auth.role(), '') <> 'authenticated' THEN
    RAISE EXCEPTION 'PUSH_AUTHENTICATION_REQUIRED';
  END IF;
  BEGIN
    v_session_id := NULLIF(auth.jwt() ->> 'session_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'PUSH_SESSION_INVALID';
  END;
  IF v_session_id IS NULL THEN
    RAISE EXCEPTION 'PUSH_SESSION_INVALID';
  END IF;
  IF p_push_token IS NULL
     OR pg_catalog.octet_length(p_push_token) NOT BETWEEN 31 AND 512
     OR p_push_token !~ '^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$' THEN
    RAISE EXCEPTION 'PUSH_TOKEN_INVALID';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('mobile-push-bindings', 0)
  );
  UPDATE public.mobile_push_device_tokens
     SET push_token = NULL,
         revoked_at = v_now,
         revoke_reason = 'session_logout',
         last_seen_at = v_now
   WHERE user_id = v_user_id
     AND session_id = v_session_id
     AND push_token = p_push_token
     AND revoked_at IS NULL;
  IF NOT FOUND AND EXISTS (
    SELECT 1
      FROM public.mobile_push_device_tokens AS binding
     WHERE binding.user_id = v_user_id
       AND binding.session_id = v_session_id
       AND binding.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'PUSH_BINDING_MISMATCH';
  END IF;
  RETURN true;
END;
$$;

-- Oldest client compatibility: session-scoped, never uid-wide.
CREATE OR REPLACE FUNCTION public.release_mobile_push_token()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_session_id uuid;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF v_user_id IS NULL OR COALESCE(auth.role(), '') <> 'authenticated' THEN
    RAISE EXCEPTION 'PUSH_AUTHENTICATION_REQUIRED';
  END IF;
  BEGIN
    v_session_id := NULLIF(auth.jwt() ->> 'session_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'PUSH_SESSION_INVALID';
  END;
  IF v_session_id IS NULL THEN
    RAISE EXCEPTION 'PUSH_SESSION_INVALID';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('mobile-push-bindings', 0)
  );
  UPDATE public.mobile_push_device_tokens
     SET push_token = NULL,
         revoked_at = v_now,
         revoke_reason = 'session_logout',
         last_seen_at = v_now
   WHERE user_id = v_user_id
     AND session_id = v_session_id
     AND revoked_at IS NULL;
  RETURN true;
END;
$$;

-- Old client bind compatibility. The session UUID is a collision-resistant,
-- session-scoped pseudo-installation; a new build replaces it with the durable
-- app installation UUID without weakening account isolation.
CREATE OR REPLACE FUNCTION public.bind_mobile_push_token(p_push_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $$
DECLARE
  v_session_id uuid;
BEGIN
  BEGIN
    v_session_id := NULLIF(auth.jwt() ->> 'session_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'PUSH_SESSION_INVALID';
  END;
  IF v_session_id IS NULL THEN
    RAISE EXCEPTION 'PUSH_SESSION_INVALID';
  END IF;
  RETURN public.bind_mobile_push_token(v_session_id, p_push_token, 'legacy');
END;
$$;

CREATE OR REPLACE FUNCTION public.get_mobile_push_delivery_targets(p_target_user_id uuid)
RETURNS TABLE (
  installation_id uuid,
  push_token text,
  platform text,
  binding_epoch bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $$
  SELECT binding.installation_id,
         binding.push_token,
         binding.platform,
         binding.binding_epoch
    FROM public.mobile_push_device_tokens AS binding
   WHERE p_target_user_id IS NOT NULL
     AND binding.user_id = p_target_user_id
     AND binding.revoked_at IS NULL
     AND binding.push_token IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM auth.sessions AS active_session
        WHERE active_session.id = binding.session_id
          AND active_session.user_id = binding.user_id
     )
   ORDER BY binding.installation_id
$$;

ALTER FUNCTION public.bind_mobile_push_token(uuid, text, text) OWNER TO postgres;
ALTER FUNCTION public.bind_mobile_push_token(text) OWNER TO postgres;
ALTER FUNCTION public.release_mobile_push_token(uuid, text) OWNER TO postgres;
ALTER FUNCTION public.release_mobile_push_token(text) OWNER TO postgres;
ALTER FUNCTION public.release_mobile_push_token() OWNER TO postgres;
ALTER FUNCTION public.get_mobile_push_delivery_targets(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.bind_mobile_push_token(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.bind_mobile_push_token(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.release_mobile_push_token(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.release_mobile_push_token(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.release_mobile_push_token()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_mobile_push_delivery_targets(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.bind_mobile_push_token(uuid, text, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.bind_mobile_push_token(text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_mobile_push_token(uuid, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_mobile_push_token(text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_mobile_push_token()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_mobile_push_delivery_targets(uuid)
  TO service_role;

COMMENT ON TABLE public.mobile_push_device_tokens IS
  'Current remote-push ownership by durable installation and live Auth session; revoked rows have their delivery secret scrubbed.';
COMMENT ON FUNCTION public.bind_mobile_push_token(uuid, text, text) IS
  'Binds an Expo token to auth.uid(), JWT session_id and a durable app installation with an eight-device cap.';
COMMENT ON FUNCTION public.release_mobile_push_token(uuid, text) IS
  'Compare-and-revokes only the exact installation, token, auth.uid() and JWT session binding.';
COMMENT ON FUNCTION public.get_mobile_push_delivery_targets(uuid) IS
  'Service-only delivery projection that excludes revoked bindings and missing or deleted Auth session rows.';

DO $notification_session_ownership_contract$
DECLARE
  v_client_functions oid[] := ARRAY[
    'public.bind_mobile_push_token(uuid,text,text)'::regprocedure,
    'public.bind_mobile_push_token(text)'::regprocedure,
    'public.release_mobile_push_token(uuid,text)'::regprocedure,
    'public.release_mobile_push_token(text)'::regprocedure,
    'public.release_mobile_push_token()'::regprocedure
  ];
  v_delivery oid := 'public.get_mobile_push_delivery_targets(uuid)'::regprocedure;
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure_record
     WHERE procedure_record.oid = ANY(v_client_functions || v_delivery)
       AND (
         NOT procedure_record.prosecdef
         OR pg_catalog.pg_get_userbyid(procedure_record.proowner) <> 'postgres'
         OR procedure_record.proconfig IS DISTINCT FROM ARRAY[
           'search_path=""', 'lock_timeout=5s', 'statement_timeout=10s'
         ]::text[]
       )
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure_record
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
        procedure_record.proacl,
        pg_catalog.acldefault('f', procedure_record.proowner)
      )) AS acl_entry
     WHERE procedure_record.oid = ANY(v_client_functions)
       AND acl_entry.privilege_type = 'EXECUTE'
       AND (
         pg_catalog.pg_get_userbyid(acl_entry.grantee)
           NOT IN ('postgres', 'authenticated')
         OR (
           pg_catalog.pg_get_userbyid(acl_entry.grantee) = 'authenticated'
           AND acl_entry.is_grantable
         )
       )
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.unnest(v_client_functions) AS client_function(oid)
     WHERE NOT pg_catalog.has_function_privilege(
       'authenticated', client_function.oid, 'EXECUTE'
     )
       OR pg_catalog.has_function_privilege('anon', client_function.oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege(
         'service_role', client_function.oid, 'EXECUTE'
       )
  ) OR pg_catalog.has_function_privilege('anon', v_delivery, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_delivery, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_delivery, 'EXECUTE')
     OR pg_catalog.has_table_privilege(
       'authenticated', 'public.mobile_push_device_tokens', 'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       'service_role', 'public.mobile_push_device_tokens', 'SELECT'
     ) THEN
    RAISE EXCEPTION 'PUSH_SESSION_OWNERSHIP_CONTRACT_INVALID';
  END IF;
END;
$notification_session_ownership_contract$;
