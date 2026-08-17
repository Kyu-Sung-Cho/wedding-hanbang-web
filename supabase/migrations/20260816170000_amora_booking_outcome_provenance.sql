BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $amora_booking_outcome_provenance_preconditions$
BEGIN
  IF pg_catalog.to_regprocedure(
       'public.complete_amora_booking_outcome_atomic(uuid,uuid,numeric,numeric,integer,text,boolean)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.complete_vendor_booking_outcome(uuid,uuid,numeric,numeric,integer,text,boolean)'
     ) IS NULL
     OR pg_catalog.to_regprocedure('extensions.digest(bytea,text)') IS NULL
     OR pg_catalog.to_regclass('public.decision_nodes') IS NULL THEN
    RAISE EXCEPTION 'AMORA_BOOKING_OUTCOME_PROVENANCE_PREDECESSOR_MISSING'
      USING ERRCODE = '55000';
  END IF;
END
$amora_booking_outcome_provenance_preconditions$;

CREATE OR REPLACE FUNCTION public.complete_amora_booking_outcome_atomic(
  p_booking_id uuid,
  p_customer_id uuid,
  p_actual_amount numeric,
  p_contracted_amount numeric,
  p_rating integer,
  p_review text,
  p_share_public_review boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '20s'
AS $function$
DECLARE
  v_authorization_id uuid;
  v_couple_id uuid;
  v_actor_role text;
  v_profile_role text;
  v_was_exact boolean := false;
  v_authorization_remained boolean := false;
  v_result jsonb;
  v_decision_id uuid;
  v_delivery_status text;
  v_raw_bride_id uuid;
  v_raw_groom_id uuid;
  v_vendor_name_snapshot text;
  v_vendor_category_snapshot text;
  v_product_name_snapshot text;
  v_confirmed_at timestamptz := clock_timestamp();
  v_payload_digest text;
  v_booking_was_completed boolean := false;
  v_existing_decision_id uuid;
  v_existing_actor_role text;
  v_existing_actor_profile_id text;
  v_existing_confirmed_at timestamptz;
  v_existing_decided_at timestamptz;
  v_existing_payload_digest text;
  v_existing_provenance_version jsonb;
  v_is_exact_replay boolean := false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;

  SELECT profile.couple_id, profile.role
    INTO v_couple_id, v_profile_role
  FROM public.profiles AS profile
  WHERE profile.id = p_customer_id
    AND profile.couple_id IS NOT NULL
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking_outcome_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT couple.bride_id, couple.groom_id
    INTO v_raw_bride_id, v_raw_groom_id
  FROM public.couples AS couple
  WHERE couple.id = v_couple_id
  FOR SHARE;
  IF NOT FOUND
     OR (
       p_customer_id IS DISTINCT FROM v_raw_bride_id
       AND p_customer_id IS DISTINCT FROM v_raw_groom_id
     ) THEN
    RAISE EXCEPTION 'booking_outcome_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_actor_role := CASE
    WHEN p_customer_id IS NOT DISTINCT FROM v_raw_bride_id
         AND p_customer_id IS DISTINCT FROM v_raw_groom_id THEN 'bride'
    WHEN p_customer_id IS NOT DISTINCT FROM v_raw_groom_id
         AND p_customer_id IS DISTINCT FROM v_raw_bride_id THEN 'groom'
    ELSE NULL
  END;
  IF v_actor_role IS NULL
     OR v_profile_role IS DISTINCT FROM v_actor_role
     OR public.is_current_couple_member(
       p_customer_id,
       v_couple_id
     ) IS NOT TRUE THEN
    RAISE EXCEPTION 'booking_outcome_actor_binding_invalid'
      USING ERRCODE = '55000';
  END IF;
  IF v_raw_bride_id IS NOT NULL
     AND v_raw_groom_id IS NOT NULL
     AND v_raw_bride_id <> v_raw_groom_id
     AND public.is_current_couple_member(v_raw_bride_id, v_couple_id)
     AND public.is_current_couple_member(v_raw_groom_id, v_couple_id) THEN
    RAISE EXCEPTION 'booking_joint_approval_required'
      USING ERRCODE = 'P0001';
  END IF;

  v_payload_digest := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'actual_amount', p_actual_amount,
          'contracted_amount', p_contracted_amount,
          'rating', p_rating,
          'review', p_review,
          'share_public_review', p_share_public_review
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  SELECT
    booking.status = 'completed',
    booking.status = 'completed'
      AND booking.actual_amount IS NOT DISTINCT FROM p_actual_amount
      AND booking.contracted_amount IS NOT DISTINCT FROM p_contracted_amount,
    booking.vendor_delivery_status,
    booking.intent_vendor_name_snapshot,
    booking.intent_vendor_category_snapshot,
    booking.intent_product_name_snapshot
    INTO
      v_booking_was_completed,
      v_was_exact,
      v_delivery_status,
      v_vendor_name_snapshot,
      v_vendor_category_snapshot,
      v_product_name_snapshot
  FROM public.vendor_bookings AS booking
  WHERE booking.id = p_booking_id
    AND booking.couple_id = v_couple_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking_outcome_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_booking_was_completed THEN
    SELECT
      decision.id,
      decision.source_actor_role,
      decision.metadata ->> 'actor_profile_id',
      decision.user_confirmed_at,
      decision.decided_at,
      decision.metadata ->> 'outcome_payload_digest',
      decision.metadata -> 'outcome_provenance_version'
      INTO
        v_existing_decision_id,
        v_existing_actor_role,
        v_existing_actor_profile_id,
        v_existing_confirmed_at,
        v_existing_decided_at,
        v_existing_payload_digest,
        v_existing_provenance_version
    FROM public.decision_nodes AS decision
    WHERE decision.couple_id = v_couple_id
      AND decision.source = 'vendor_booking'
      AND decision.source_ref_id = p_booking_id
      AND decision.decision_type = 'completed'
    FOR UPDATE;

    IF NOT FOUND
       OR v_existing_actor_role NOT IN ('bride', 'groom')
       OR v_existing_actor_profile_id IS NULL
       OR v_existing_actor_profile_id !~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR v_existing_confirmed_at IS NULL
       OR v_existing_decided_at IS NULL
       OR v_existing_confirmed_at > v_existing_decided_at
       OR v_existing_payload_digest !~ '^[0-9a-f]{64}$'
       OR v_existing_provenance_version IS DISTINCT FROM '1'::jsonb THEN
      RAISE EXCEPTION 'booking_outcome_provenance_missing'
        USING ERRCODE = '55000';
    END IF;

    v_is_exact_replay := v_existing_payload_digest = v_payload_digest;
    IF v_is_exact_replay
       AND (
         v_existing_actor_profile_id IS DISTINCT FROM p_customer_id::text
         OR v_existing_actor_role IS DISTINCT FROM v_actor_role
       ) THEN
      RAISE EXCEPTION 'booking_outcome_replay_actor_mismatch'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  v_authorization_id := gen_random_uuid();
  INSERT INTO public.booking_outcome_write_authorizations (
    authorization_id,
    booking_id,
    couple_id,
    actor_profile_id,
    actual_amount,
    contracted_amount
  ) VALUES (
    v_authorization_id,
    p_booking_id,
    v_couple_id,
    p_customer_id,
    p_actual_amount,
    p_contracted_amount
  );
  PERFORM set_config(
    'hanbang.booking_outcome_authorization_id',
    v_authorization_id::text,
    true
  );

  v_result := public.complete_vendor_booking_outcome(
    p_booking_id,
    p_customer_id,
    p_actual_amount,
    p_contracted_amount,
    p_rating,
    p_review,
    p_share_public_review
  );

  DELETE FROM public.booking_outcome_write_authorizations AS authz
  WHERE authz.authorization_id = v_authorization_id
  RETURNING true INTO v_authorization_remained;
  IF COALESCE(v_authorization_remained, false) AND NOT v_was_exact THEN
    RAISE EXCEPTION 'booking_outcome_authorization_not_consumed'
      USING ERRCODE = '55000';
  END IF;
  PERFORM set_config('hanbang.booking_outcome_authorization_id', '', true);

  v_decision_id := NULLIF(v_result ->> 'decisionId', '')::uuid;
  IF v_is_exact_replay
     AND v_decision_id IS DISTINCT FROM v_existing_decision_id THEN
    RAISE EXCEPTION 'booking_outcome_decision_audit_mismatch'
      USING ERRCODE = '55000';
  END IF;
  v_vendor_name_snapshot := COALESCE(
    v_vendor_name_snapshot,
    v_result -> 'context' ->> 'vendorName',
    '업체'
  );
  v_vendor_category_snapshot := COALESCE(
    v_vendor_category_snapshot,
    v_result -> 'context' ->> 'vendorCategory',
    'vendor'
  );
  v_product_name_snapshot := COALESCE(
    v_product_name_snapshot,
    v_result -> 'context' ->> 'productName'
  );
  UPDATE public.decision_nodes
  SET category = v_vendor_category_snapshot,
      title = '사용자가 완료로 기록: ' || v_vendor_name_snapshot,
      chosen_value = COALESCE(chosen_value, '{}'::jsonb)
        || jsonb_build_object(
          'vendor_name', v_vendor_name_snapshot,
          'product_name', v_product_name_snapshot,
          'completion_evidence', 'user_reported',
          'vendor_delivery_status', v_delivery_status,
          'vendor_confirmation_status', 'unconfirmed'
        ),
      source_actor_role = CASE
        WHEN v_is_exact_replay THEN v_existing_actor_role
        ELSE v_actor_role
      END,
      user_confirmed_at = CASE
        WHEN v_is_exact_replay THEN v_existing_confirmed_at
        ELSE v_confirmed_at
      END,
      decided_at = CASE
        WHEN v_is_exact_replay THEN v_existing_decided_at
        ELSE v_confirmed_at
      END,
      metadata = COALESCE(metadata, '{}'::jsonb)
        || jsonb_build_object(
          'completion_evidence', 'user_reported',
          'vendor_delivery_status', v_delivery_status,
          'vendor_confirmation_status', 'unconfirmed',
          'actor_profile_id', CASE
            WHEN v_is_exact_replay THEN v_existing_actor_profile_id
            ELSE p_customer_id::text
          END,
          'outcome_provenance_version', 1,
          'outcome_payload_digest', CASE
            WHEN v_is_exact_replay THEN v_existing_payload_digest
            ELSE v_payload_digest
          END
        ),
      updated_at = clock_timestamp()
  WHERE id = v_decision_id
    AND couple_id = v_couple_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking_outcome_decision_audit_missing'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.decision_nodes
  SET chosen_value = COALESCE(chosen_value, '{}'::jsonb)
        || jsonb_build_object(
          'internal_request_status', 'completed_by_user_report',
          'completion_evidence', 'user_reported',
          'vendor_confirmation_status', 'unconfirmed'
        ),
      metadata = COALESCE(metadata, '{}'::jsonb)
        || jsonb_build_object(
          'supersededByBookingOutcomeDecisionId', v_decision_id,
          'completion_evidence', 'user_reported',
          'vendor_confirmation_status', 'unconfirmed'
        ),
      superseded_at = COALESCE(superseded_at, now()),
      superseded_by = v_decision_id,
      updated_at = now()
  WHERE couple_id = v_couple_id
    AND source = 'vendor_booking'
    AND source_ref_id = p_booking_id
    AND decision_type = 'considering';

  RETURN v_result || jsonb_build_object(
    'completionEvidence', 'user_reported',
    'vendorDeliveryStatus', v_delivery_status,
    'vendorConfirmationStatus', 'unconfirmed',
    'context', COALESCE(v_result -> 'context', '{}'::jsonb)
      || jsonb_build_object(
        'vendorName', v_vendor_name_snapshot,
        'vendorCategory', v_vendor_category_snapshot,
        'productName', v_product_name_snapshot
      )
  );
END;
$function$;

ALTER FUNCTION public.complete_amora_booking_outcome_atomic(
  uuid, uuid, numeric, numeric, integer, text, boolean
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.complete_amora_booking_outcome_atomic(
  uuid, uuid, numeric, numeric, integer, text, boolean
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_amora_booking_outcome_atomic(
  uuid, uuid, numeric, numeric, integer, text, boolean
) TO service_role;

DO $amora_booking_outcome_provenance_postconditions$
DECLARE
  wrapper regprocedure := pg_catalog.to_regprocedure(
    'public.complete_amora_booking_outcome_atomic(uuid,uuid,numeric,numeric,integer,text,boolean)'
  );
  legacy_writer regprocedure := pg_catalog.to_regprocedure(
    'public.complete_vendor_booking_outcome(uuid,uuid,numeric,numeric,integer,text,boolean)'
  );
  wrapper_owner name;
  wrapper_security_definer boolean;
  wrapper_config text[];
BEGIN
  SELECT role.rolname, proc.prosecdef, proc.proconfig
    INTO wrapper_owner, wrapper_security_definer, wrapper_config
  FROM pg_catalog.pg_proc AS proc
  JOIN pg_catalog.pg_roles AS role ON role.oid = proc.proowner
  WHERE proc.oid = wrapper;

  IF wrapper IS NULL
     OR legacy_writer IS NULL
     OR wrapper_owner IS DISTINCT FROM 'postgres'::name
     OR NOT wrapper_security_definer
     OR NOT COALESCE(
       wrapper_config @> ARRAY[
         'search_path=pg_catalog, public',
         'lock_timeout=5s',
         'statement_timeout=20s'
       ]::text[],
       false
     )
     OR pg_catalog.has_function_privilege('anon', wrapper, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
       'authenticated', wrapper, 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'service_role', wrapper, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege('anon', legacy_writer, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
       'authenticated', legacy_writer, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role', legacy_writer, 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'AMORA_BOOKING_OUTCOME_PROVENANCE_POSTCONDITION_FAILED'
      USING ERRCODE = '55000';
  END IF;
END
$amora_booking_outcome_provenance_postconditions$;

COMMIT;
