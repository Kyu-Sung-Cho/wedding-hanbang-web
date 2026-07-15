-- EXPAND PHASE: replace the two-request couple reset saga with one transaction.
-- The RPC is authenticated-user-only and derives the user/couple from auth.uid().

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.reset_current_couple_membership()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_couple_id uuid;
  v_bride_id uuid;
  v_groom_id uuid;
BEGIN
  IF v_user_id IS NULL
     OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;

  SELECT profile.couple_id
  INTO v_couple_id
  FROM public.profiles AS profile
  WHERE profile.id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Both the couple and profile membership guards require this transaction-
  -- local capability, including an idempotent retry where couple_id is null.
  PERFORM pg_catalog.set_config('hanbang.allow_membership_write', 'on', true);

  IF v_couple_id IS NOT NULL THEN
    -- Serialize membership changes for this couple before locking its row.
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_couple_id::text, 0)
    );

    SELECT couple.bride_id, couple.groom_id
    INTO v_bride_id, v_groom_id
    FROM public.couples AS couple
    WHERE couple.id = v_couple_id
    FOR UPDATE;

    IF FOUND THEN
      IF v_bride_id IS DISTINCT FROM v_user_id
         AND v_groom_id IS DISTINCT FROM v_user_id THEN
        RAISE EXCEPTION 'membership_inconsistent' USING ERRCODE = 'P0001';
      END IF;

      UPDATE public.couples
      SET bride_id = CASE WHEN bride_id = v_user_id THEN NULL ELSE bride_id END,
          groom_id = CASE WHEN groom_id = v_user_id THEN NULL ELSE groom_id END,
          updated_at = now()
      WHERE id = v_couple_id;
    END IF;
  END IF;

  UPDATE public.profiles
  SET couple_id = NULL,
      onboarding_completed = false,
      onboarding_step = 1,
      shared_chat_cleared_at = NULL,
      private_chat_cleared_at = NULL,
      updated_at = now()
  WHERE id = v_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'previous_couple_id', v_couple_id
  );
END;
$function$;

ALTER FUNCTION public.reset_current_couple_membership() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reset_current_couple_membership()
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.reset_current_couple_membership()
  TO authenticated;

DO $$
BEGIN
  IF NOT has_function_privilege(
       'authenticated',
       'public.reset_current_couple_membership()',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.reset_current_couple_membership()',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.reset_current_couple_membership()',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'ATOMIC_COUPLE_RESET_ACL_INVALID';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.reset_current_couple_membership() IS
  'Atomically detaches auth.uid() from its couple and resets onboarding state.';
