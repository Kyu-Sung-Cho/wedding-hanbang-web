-- Expose only the mobile push state the signed-in client needs. The raw Expo
-- delivery token remains server-side and is represented only as a boolean.
--
-- Deliberately do not revoke authenticated SELECT(push_token) here: released
-- mobile versions still read that column. Revoke it in a follow-up migration
-- only after a minimum-version/forced-update gate proves legacy adoption safe.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.get_my_mobile_push_preferences(
  p_expected_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
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

ALTER FUNCTION public.get_my_mobile_push_preferences(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_my_mobile_push_preferences(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_mobile_push_preferences(uuid)
  TO authenticated;

COMMENT ON FUNCTION public.get_my_mobile_push_preferences(uuid) IS
  'Returns the current authenticated actor mobile push preferences without exposing the raw Expo delivery token.';

DO $$
DECLARE
  v_owner name;
  v_security_definer boolean;
  v_config text[];
BEGIN
  SELECT owner.rolname, proc.prosecdef, proc.proconfig
  INTO v_owner, v_security_definer, v_config
  FROM pg_catalog.pg_proc AS proc
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = proc.pronamespace
  JOIN pg_catalog.pg_roles AS owner
    ON owner.oid = proc.proowner
  WHERE namespace.nspname = 'public'
    AND proc.oid = 'public.get_my_mobile_push_preferences(uuid)'::regprocedure;

  IF v_owner IS DISTINCT FROM 'postgres'
     OR v_security_definer IS DISTINCT FROM true
     OR NOT COALESCE(v_config, ARRAY[]::text[]) @> ARRAY['search_path=""']::text[] THEN
    RAISE EXCEPTION 'get_my_mobile_push_preferences security contract drift';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
       'authenticated',
       'public.get_my_mobile_push_preferences(uuid)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon',
       'public.get_my_mobile_push_preferences(uuid)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role',
       'public.get_my_mobile_push_preferences(uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'get_my_mobile_push_preferences execute ACL drift';
  END IF;
END;
$$;

COMMIT;
