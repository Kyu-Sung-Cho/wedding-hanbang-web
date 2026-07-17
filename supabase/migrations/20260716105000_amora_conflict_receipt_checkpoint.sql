-- Atomically settle a successful conflict-verification provider receipt and
-- persist the bounded detection checkpoint needed to resume at mediation.
-- Neither write may become visible without the other.

CREATE OR REPLACE FUNCTION public.finalize_amora_conflict_verify_receipt(
  p_receipt_id uuid,
  p_receipt_claim_token uuid,
  p_conflict_couple_id uuid,
  p_message_digest text,
  p_conflict_claim_token uuid,
  p_checkpoint jsonb,
  p_provider_attempted boolean,
  p_usage_status text,
  p_actual_cost_microusd bigint,
  p_success boolean,
  p_error_message text,
  p_model text,
  p_tokens_input integer,
  p_tokens_output integer,
  p_latency_ms integer,
  p_metadata jsonb
)
RETURNS TABLE(
  finalized boolean,
  receipt_status text,
  checkpointed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_receipt public.ai_interactions_log%ROWTYPE;
  v_finalized boolean;
  v_receipt_status text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_CONFLICT_RECEIPT_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF p_receipt_id IS NULL
     OR p_receipt_claim_token IS NULL
     OR p_conflict_couple_id IS NULL
     OR p_conflict_claim_token IS NULL
     OR p_message_digest IS NULL
     OR p_message_digest !~ '^[0-9a-f]{64}$'
     OR p_provider_attempted IS DISTINCT FROM true
     OR p_success IS DISTINCT FROM true
     OR p_checkpoint IS NULL
     OR jsonb_typeof(p_checkpoint) IS DISTINCT FROM 'object'
     OR pg_column_size(p_checkpoint) > 32768
     OR NOT (p_checkpoint ?& ARRAY[
       'stage',
       'triggered',
       'score',
       'reason',
       'conflictContext',
       'llmVerified'
     ])
     OR (
       p_checkpoint - ARRAY[
         'stage',
         'triggered',
         'score',
         'reason',
         'conflictContext',
         'llmVerified'
       ]::text[]
     ) <> '{}'::jsonb
     OR p_checkpoint ->> 'stage' IS DISTINCT FROM 'detection_complete'
     OR jsonb_typeof(p_checkpoint -> 'triggered') IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(p_checkpoint -> 'score') IS DISTINCT FROM 'number'
     OR (p_checkpoint ->> 'score') !~ '^[0-9]+$'
     OR (p_checkpoint ->> 'score')::numeric NOT BETWEEN 0 AND 1000
     OR jsonb_typeof(p_checkpoint -> 'reason') IS DISTINCT FROM 'string'
     OR length(p_checkpoint ->> 'reason') NOT BETWEEN 1 AND 2000
     OR jsonb_typeof(p_checkpoint -> 'conflictContext') IS DISTINCT FROM 'string'
     OR length(p_checkpoint ->> 'conflictContext') > 2000
     OR jsonb_typeof(p_checkpoint -> 'llmVerified') IS DISTINCT FROM 'boolean'
  THEN
    RAISE EXCEPTION 'AMORA_CONFLICT_CHECKPOINT_INVALID'
      USING ERRCODE = '22023';
  END IF;

  -- Receipt first, then conflict claim, then the cost counter inside the
  -- existing finalizer: this is the stable lock order for this boundary.
  SELECT * INTO v_receipt
  FROM public.ai_interactions_log
  WHERE id = p_receipt_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_receipt.amora_claim_token IS DISTINCT FROM p_receipt_claim_token
     OR v_receipt.amora_request_key IS DISTINCT FROM
          'conflict:' || p_message_digest
     OR v_receipt.amora_call_source IS DISTINCT FROM 'conflict_check'
     OR v_receipt.amora_call_phase IS DISTINCT FROM 'conflict_verify'
     OR v_receipt.amora_call_index IS DISTINCT FROM 1
     OR v_receipt.couple_id IS DISTINCT FROM p_conflict_couple_id
     OR v_receipt.amora_cost_status NOT IN ('reserved', 'settled', 'unknown')
  THEN
    RAISE EXCEPTION 'AMORA_CONFLICT_RECEIPT_INVALID'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.amora_conflict_check_claims
  WHERE couple_id = p_conflict_couple_id
    AND message_digest = p_message_digest
    AND claim_token = p_conflict_claim_token
    AND status = 'processing'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_CONFLICT_CLAIM_STALE'
      USING ERRCODE = '40001';
  END IF;

  SELECT result.finalized, result.receipt_status
  INTO v_finalized, v_receipt_status
  FROM public.finalize_amora_provider_call_receipt(
    p_receipt_id,
    p_receipt_claim_token,
    p_provider_attempted,
    p_usage_status,
    p_actual_cost_microusd,
    p_success,
    p_error_message,
    p_model,
    p_tokens_input,
    p_tokens_output,
    p_latency_ms,
    p_metadata
  ) AS result;

  IF v_finalized IS DISTINCT FROM true
     OR v_receipt_status NOT IN ('settled', 'unknown') THEN
    RAISE EXCEPTION 'AMORA_CONFLICT_RECEIPT_FINALIZE_FAILED';
  END IF;

  UPDATE public.amora_conflict_check_claims
  SET checkpoint = p_checkpoint,
      updated_at = now()
  WHERE couple_id = p_conflict_couple_id
    AND message_digest = p_message_digest
    AND claim_token = p_conflict_claim_token
    AND status = 'processing';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_CONFLICT_CLAIM_STALE'
      USING ERRCODE = '40001';
  END IF;

  RETURN QUERY SELECT true, v_receipt_status, true;
END;
$function$;

ALTER FUNCTION public.finalize_amora_conflict_verify_receipt(
  uuid, uuid, uuid, text, uuid, jsonb, boolean, text, bigint, boolean,
  text, text, integer, integer, integer, jsonb
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.finalize_amora_conflict_verify_receipt(
  uuid, uuid, uuid, text, uuid, jsonb, boolean, text, bigint, boolean,
  text, text, integer, integer, integer, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_amora_conflict_verify_receipt(
  uuid, uuid, uuid, text, uuid, jsonb, boolean, text, bigint, boolean,
  text, text, integer, integer, integer, jsonb
) TO service_role;

COMMENT ON FUNCTION public.finalize_amora_conflict_verify_receipt(
  uuid, uuid, uuid, text, uuid, jsonb, boolean, text, bigint, boolean,
  text, text, integer, integer, integer, jsonb
) IS
  'Atomically settles one conflict-verification provider receipt and stores its lease-fenced, bounded mediation replay checkpoint.';

DO $postcheck$
BEGIN
  IF NOT has_function_privilege(
       'service_role',
       'public.finalize_amora_conflict_verify_receipt(uuid,uuid,uuid,text,uuid,jsonb,boolean,text,bigint,boolean,text,text,integer,integer,integer,jsonb)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.finalize_amora_conflict_verify_receipt(uuid,uuid,uuid,text,uuid,jsonb,boolean,text,bigint,boolean,text,text,integer,integer,integer,jsonb)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'AMORA_CONFLICT_RECEIPT_CHECKPOINT_POSTCHECK_FAILED';
  END IF;
END;
$postcheck$;
