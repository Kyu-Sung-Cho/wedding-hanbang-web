-- Read only the public binding fields needed to reconstruct a verified
-- preparation-action receipt. Keep the underlying table private, including
-- from service-role PostgREST clients.

CREATE FUNCTION public.list_amora_preparation_action_receipt_bindings_v1(
  p_couple_id uuid,
  p_recipient_user_id uuid,
  p_expected_privacy_epoch bigint,
  p_promotion_ids uuid[]
)
RETURNS TABLE (
  proposal_message_id uuid,
  couple_id uuid,
  action_id uuid,
  promotion_id uuid,
  proposal_journey_revision bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_promotion_count integer;
  v_distinct_promotion_count integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_ACTION_RECEIPT_BINDING_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  v_promotion_count := cardinality(p_promotion_ids);
  IF p_couple_id IS NULL
     OR p_recipient_user_id IS NULL
     OR p_expected_privacy_epoch IS NULL
     OR p_expected_privacy_epoch < 1
     OR p_promotion_ids IS NULL
     OR v_promotion_count NOT BETWEEN 1 AND 192
     OR EXISTS (
       SELECT 1
       FROM unnest(p_promotion_ids) AS requested(promotion_id)
       WHERE requested.promotion_id IS NULL
     ) THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_ACTION_RECEIPT_BINDING_INVALID'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(DISTINCT requested.promotion_id)::integer
    INTO v_distinct_promotion_count
  FROM unnest(p_promotion_ids) AS requested(promotion_id);
  IF v_distinct_promotion_count IS DISTINCT FROM v_promotion_count THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_ACTION_RECEIPT_BINDING_INVALID'
      USING ERRCODE = '22023';
  END IF;

  PERFORM public.amora_preparation_topic_message_ref_context_v1(
    p_couple_id,
    p_recipient_user_id,
    p_expected_privacy_epoch,
    false
  );

  RETURN QUERY
  SELECT binding.proposal_message_id,
         binding.couple_id,
         binding.action_id,
         binding.promotion_id,
         binding.proposal_journey_revision
  FROM public.amora_first_use_action_proposal_bindings AS binding
  WHERE binding.couple_id = p_couple_id
    AND binding.promotion_id = ANY(p_promotion_ids)
  ORDER BY array_position(p_promotion_ids, binding.promotion_id);
END
$function$;

ALTER FUNCTION public.list_amora_preparation_action_receipt_bindings_v1(
  uuid, uuid, bigint, uuid[]
) OWNER TO postgres;
REVOKE ALL ON FUNCTION
  public.list_amora_preparation_action_receipt_bindings_v1(
    uuid, uuid, bigint, uuid[]
  ) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.list_amora_preparation_action_receipt_bindings_v1(
    uuid, uuid, bigint, uuid[]
  ) TO service_role;
