-- Close account-switch TOCTOU windows in current mobile push mutations. Each
-- v2 entry point binds the client-observed actor to auth.uid() before calling
-- the established consent/token mutation. Legacy RPCs remain temporarily for
-- released clients and must be retired after the minimum-version gate lands.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.set_my_mobile_push_preferences_v2(
  p_expected_user_id uuid,
  p_push_enabled boolean DEFAULT NULL,
  p_community_enabled boolean DEFAULT NULL,
  p_partner_enabled boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_push_enabled boolean;
  v_community_enabled boolean;
  v_partner_enabled boolean;
  v_consented_at timestamptz;
  v_token_attached boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  IF p_expected_user_id IS NULL OR p_expected_user_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'push_actor_mismatch' USING ERRCODE = '42501';
  END IF;

  PERFORM public.set_my_mobile_push_preferences(
    p_push_enabled,
    p_community_enabled,
    p_partner_enabled
  );

  SELECT
    p.push_notifications_enabled,
    p.community_push_notifications_enabled,
    p.partner_push_notifications_enabled,
    p.push_notifications_consented_at,
    p.push_token IS NOT NULL
  INTO
    v_push_enabled,
    v_community_enabled,
    v_partner_enabled,
    v_consented_at,
    v_token_attached
  FROM public.profiles AS p
  WHERE p.id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'pushEnabled', v_push_enabled,
    'communityEnabled', v_community_enabled,
    'partnerEnabled', v_partner_enabled,
    'consentedAt', v_consented_at,
    'tokenAttached', v_token_attached
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.attach_my_mobile_push_token_v2(
  p_expected_user_id uuid,
  p_token text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  IF p_expected_user_id IS NULL OR p_expected_user_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'push_actor_mismatch' USING ERRCODE = '42501';
  END IF;

  RETURN public.attach_my_mobile_push_token(p_token);
END;
$$;

CREATE OR REPLACE FUNCTION public.detach_my_mobile_push_token_v2(
  p_expected_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  IF p_expected_user_id IS NULL OR p_expected_user_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'push_actor_mismatch' USING ERRCODE = '42501';
  END IF;

  RETURN public.detach_my_mobile_push_token();
END;
$$;

ALTER FUNCTION public.set_my_mobile_push_preferences_v2(uuid, boolean, boolean, boolean)
  OWNER TO postgres;
ALTER FUNCTION public.attach_my_mobile_push_token_v2(uuid, text)
  OWNER TO postgres;
ALTER FUNCTION public.detach_my_mobile_push_token_v2(uuid)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.set_my_mobile_push_preferences_v2(uuid, boolean, boolean, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.attach_my_mobile_push_token_v2(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.detach_my_mobile_push_token_v2(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.set_my_mobile_push_preferences_v2(uuid, boolean, boolean, boolean)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.attach_my_mobile_push_token_v2(uuid, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.detach_my_mobile_push_token_v2(uuid)
  TO authenticated;

COMMENT ON FUNCTION public.set_my_mobile_push_preferences_v2(uuid, boolean, boolean, boolean) IS
  'Mutates mobile push preferences only when the client-observed actor still equals auth.uid().';
COMMENT ON FUNCTION public.attach_my_mobile_push_token_v2(uuid, text) IS
  'Attaches an Expo delivery token only when the client-observed actor still equals auth.uid().';
COMMENT ON FUNCTION public.detach_my_mobile_push_token_v2(uuid) IS
  'Detaches an Expo delivery token only when the client-observed actor still equals auth.uid().';

DO $$
DECLARE
  v_signature text;
  v_owner name;
  v_security_definer boolean;
  v_config text[];
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.set_my_mobile_push_preferences_v2(uuid,boolean,boolean,boolean)',
    'public.attach_my_mobile_push_token_v2(uuid,text)',
    'public.detach_my_mobile_push_token_v2(uuid)'
  ] LOOP
    SELECT owner.rolname, proc.prosecdef, proc.proconfig
    INTO v_owner, v_security_definer, v_config
    FROM pg_catalog.pg_proc AS proc
    JOIN pg_catalog.pg_roles AS owner
      ON owner.oid = proc.proowner
    WHERE proc.oid = v_signature::regprocedure;

    IF v_owner IS DISTINCT FROM 'postgres'
       OR v_security_definer IS DISTINCT FROM true
       OR NOT COALESCE(v_config, ARRAY[]::text[]) @> ARRAY['search_path=""']::text[] THEN
      RAISE EXCEPTION '% security contract drift', v_signature;
    END IF;

    IF NOT pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION '% execute ACL drift', v_signature;
    END IF;
  END LOOP;
END;
$$;

COMMIT;
