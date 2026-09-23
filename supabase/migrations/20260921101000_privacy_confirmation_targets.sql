BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Preserve the audited mutation, but remove every client entry without a target.
ALTER FUNCTION public.reset_current_couple_membership()
  RENAME TO reset_current_couple_membership_pre_confirmation;
REVOKE ALL ON FUNCTION public.reset_current_couple_membership_pre_confirmation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.reset_current_couple_membership()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $function$
BEGIN
  RAISE EXCEPTION 'PRIVACY_CONFIRMATION_REQUIRED' USING ERRCODE = '22023';
END;
$function$;
ALTER FUNCTION public.reset_current_couple_membership() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reset_current_couple_membership() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.reset_current_couple_membership() TO authenticated;

CREATE FUNCTION public.lock_privacy_confirmation_target(
  p_user_id uuid, p_couple_id uuid, p_privacy_epoch bigint, p_visibility text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
SET lock_timeout = '5s' SET statement_timeout = '15s'
AS $function$
DECLARE
  v_couple_id uuid;
  v_role text;
  v_bride_id uuid;
  v_groom_id uuid;
  v_epoch bigint;
  v_scope text;
BEGIN
  IF p_user_id IS NULL OR p_couple_id IS NULL OR p_privacy_epoch IS NULL OR p_privacy_epoch < 1
     OR p_visibility IS NULL OR p_visibility NOT IN ('shared','bride_private','groom_private','reset') THEN
    RAISE EXCEPTION 'PRIVACY_CONFIRMATION_CHANGED' USING ERRCODE = '40001';
  END IF;
  -- NO KEY UPDATE allows a scope-owning worker's FK KEY SHARE to finish.
  -- Scope locks precede epoch locks: memory writers advance epochs while holding a scope.
  SELECT couple_id, role INTO v_couple_id, v_role FROM public.profiles
  WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND OR v_couple_id IS DISTINCT FROM p_couple_id THEN
    RAISE EXCEPTION 'PRIVACY_CONFIRMATION_CHANGED' USING ERRCODE = '40001';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_couple_id::text,0));
  SELECT bride_id,groom_id INTO v_bride_id,v_groom_id FROM public.couples
  WHERE id=p_couple_id FOR NO KEY UPDATE;
  IF NOT FOUND
     OR NOT ((v_role='bride' AND v_bride_id IS NOT DISTINCT FROM p_user_id) OR (v_role='groom' AND v_groom_id IS NOT DISTINCT FROM p_user_id))
     OR v_role IS NULL
     OR (p_visibility='bride_private' AND v_role IS DISTINCT FROM 'bride')
     OR (p_visibility='groom_private' AND v_role IS DISTINCT FROM 'groom') THEN
    RAISE EXCEPTION 'PRIVACY_CONFIRMATION_CHANGED' USING ERRCODE = '40001';
  END IF;
  FOREACH v_scope IN ARRAY CASE WHEN p_visibility='reset'
    THEN ARRAY['shared','bride_private','groom_private']::text[] ELSE ARRAY[p_visibility] END LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'hanbang:amora-memory-consent:' || p_couple_id::text || ':' || v_scope,0
    ));
  END LOOP;
  SELECT epoch INTO v_epoch FROM public.amora_privacy_context_epochs
  WHERE couple_id=p_couple_id FOR UPDATE;
  IF NOT FOUND OR v_epoch IS DISTINCT FROM p_privacy_epoch THEN
    RAISE EXCEPTION 'PRIVACY_CONFIRMATION_CHANGED' USING ERRCODE = '40001';
  END IF;
END;
$function$;
ALTER FUNCTION public.lock_privacy_confirmation_target(uuid,uuid,bigint,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.lock_privacy_confirmation_target(uuid,uuid,bigint,text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.reset_current_couple_membership(
  p_expected_user_id uuid, p_expected_couple_id uuid, p_expected_privacy_epoch bigint
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
SET lock_timeout = '5s' SET statement_timeout = '15s'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_expected_user_id
     OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'PRIVACY_CONFIRMATION_CHANGED' USING ERRCODE = '42501';
  END IF;
  PERFORM public.lock_privacy_confirmation_target(
    p_expected_user_id,p_expected_couple_id,p_expected_privacy_epoch,'reset'
  );
  RETURN public.reset_current_couple_membership_pre_confirmation();
END;
$function$;
ALTER FUNCTION public.reset_current_couple_membership(uuid,uuid,bigint) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reset_current_couple_membership(uuid,uuid,bigint) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.reset_current_couple_membership(uuid,uuid,bigint) TO authenticated;

-- These primitives remain callable by their owner inside the fenced transaction only.
REVOKE ALL ON FUNCTION public.set_amora_memory_consent(uuid,text,uuid,boolean),
  public.clear_amora_memory_scope(uuid,text,uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.mutate_amora_memory_with_confirmation(
  p_user_id uuid, p_couple_id uuid, p_expected_privacy_epoch bigint,
  p_visibility text, p_action text, p_consented boolean
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
SET lock_timeout = '5s' SET statement_timeout = '30s'
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'PRIVACY_CONFIRMATION_CHANGED' USING ERRCODE = '42501';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('clear_scope','toggle')
     OR p_visibility IS NULL OR p_visibility NOT IN ('shared','bride_private','groom_private')
     OR (p_action='toggle' AND p_consented IS NULL)
     OR (p_action='clear_scope' AND p_consented IS NOT NULL) THEN
    RAISE EXCEPTION 'PRIVACY_CONFIRMATION_INVALID' USING ERRCODE = '22023';
  END IF;
  PERFORM public.lock_privacy_confirmation_target(p_user_id,p_couple_id,p_expected_privacy_epoch,p_visibility);
  IF p_action='clear_scope' THEN
    RETURN public.clear_amora_memory_scope(p_couple_id,p_visibility,p_user_id);
  END IF;
  RETURN public.set_amora_memory_consent(p_couple_id,p_visibility,p_user_id,p_consented);
END;
$function$;
ALTER FUNCTION public.mutate_amora_memory_with_confirmation(uuid,uuid,bigint,text,text,boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.mutate_amora_memory_with_confirmation(uuid,uuid,bigint,text,text,boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mutate_amora_memory_with_confirmation(uuid,uuid,bigint,text,text,boolean)
  TO service_role;

COMMIT;
