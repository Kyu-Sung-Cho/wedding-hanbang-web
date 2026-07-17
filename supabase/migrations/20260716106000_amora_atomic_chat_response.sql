-- Commit a terminal Amora response as one database fact: the paid-provider
-- receipt settlement, the idempotent assistant message, and the durable chat
-- request completion either all become visible or none do. Conversation text
-- is stored only in chat_messages, never in ai_interactions_log.

CREATE OR REPLACE FUNCTION public.finalize_amora_chat_response(
  p_receipt_id uuid,
  p_receipt_claim_token uuid,
  p_chat_couple_id uuid,
  p_chat_user_id uuid,
  p_chat_request_key text,
  p_chat_visibility text,
  p_chat_claim_attempt_count integer,
  p_message_content text,
  p_message_metadata jsonb,
  p_message_stage_tag text,
  p_message_specialist_type text,
  p_provider_attempted boolean,
  p_usage_status text,
  p_actual_cost_microusd bigint,
  p_success boolean,
  p_error_message text,
  p_model text,
  p_tokens_input integer,
  p_tokens_output integer,
  p_latency_ms integer,
  p_receipt_metadata jsonb
)
RETURNS TABLE(
  finalized boolean,
  receipt_status text,
  outcome text,
  message_id uuid,
  message_created_at timestamptz,
  message_content text,
  message_metadata jsonb,
  message_stage_tag text,
  message_specialist_type text,
  message_visibility text,
  message_reused boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_receipt public.ai_interactions_log%ROWTYPE;
  v_claim public.amora_chat_request_claims%ROWTYPE;
  v_message public.chat_messages%ROWTYPE;
  v_finalized boolean;
  v_receipt_status text;
  v_message_reused boolean := false;
  v_expected_request_key boolean;
  v_is_conflict_mediation boolean := false;
  v_cooldown_race_lost boolean := false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_CHAT_RESPONSE_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF p_receipt_id IS NULL
     OR p_receipt_claim_token IS NULL
     OR p_chat_couple_id IS NULL
     OR p_chat_user_id IS NULL
     OR p_chat_request_key IS NULL
     OR char_length(p_chat_request_key) NOT BETWEEN 1 AND 160
     OR p_chat_visibility NOT IN (
       'shared', 'bride_private', 'groom_private'
     )
     OR p_chat_claim_attempt_count IS NULL
     OR p_chat_claim_attempt_count < 1
     OR p_message_content IS NULL
     OR char_length(btrim(p_message_content)) < 1
     OR octet_length(p_message_content) > 131072
     OR p_message_metadata IS NULL
     OR jsonb_typeof(p_message_metadata) IS DISTINCT FROM 'object'
     OR pg_column_size(p_message_metadata) > 262144
     OR (
       p_message_stage_tag IS NOT NULL
       AND char_length(p_message_stage_tag) > 100
     )
     OR (
       p_message_specialist_type IS NOT NULL
       AND char_length(p_message_specialist_type) > 100
     )
     OR p_provider_attempted IS DISTINCT FROM true
     OR p_success IS DISTINCT FROM true
     OR p_receipt_metadata IS NULL
     OR jsonb_typeof(p_receipt_metadata) IS DISTINCT FROM 'object'
     OR pg_column_size(p_receipt_metadata) > 65536
  THEN
    RAISE EXCEPTION 'AMORA_CHAT_RESPONSE_INVALID_INPUT'
      USING ERRCODE = '22023';
  END IF;

  -- Receipt -> chat claim -> cost counter is the stable lock order. The base
  -- receipt finalizer reuses this transaction and the already-held row lock.
  SELECT * INTO v_receipt
  FROM public.ai_interactions_log
  WHERE id = p_receipt_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_receipt.amora_claim_token IS DISTINCT FROM p_receipt_claim_token
     OR v_receipt.couple_id IS DISTINCT FROM p_chat_couple_id
     OR v_receipt.user_id IS DISTINCT FROM p_chat_user_id
     OR v_receipt.amora_cost_status NOT IN ('reserved', 'settled', 'unknown')
  THEN
    RAISE EXCEPTION 'AMORA_CHAT_RESPONSE_RECEIPT_INVALID'
      USING ERRCODE = '22023';
  END IF;

  v_expected_request_key :=
    (
      v_receipt.amora_call_source = 'durable'
      AND v_receipt.amora_call_phase IN ('tool_round', 'final_no_tool')
      AND v_receipt.amora_request_key = p_chat_request_key
    )
    OR (
      v_receipt.amora_call_source = 'conflict_check'
      AND v_receipt.amora_call_phase = 'conflict_mediation'
      AND v_receipt.amora_request_key ~ '^conflict:[0-9a-f]{64}$'
      AND p_chat_request_key =
        'mediation:' || substring(
          v_receipt.amora_request_key
          FROM char_length('conflict:') + 1
        )
      AND p_chat_visibility = 'shared'
    );
  v_is_conflict_mediation :=
    v_receipt.amora_call_source = 'conflict_check'
    AND v_receipt.amora_call_phase = 'conflict_mediation';
  IF v_expected_request_key IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'AMORA_CHAT_RESPONSE_RECEIPT_SCOPE_MISMATCH'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_claim
  FROM public.amora_chat_request_claims
  WHERE couple_id = p_chat_couple_id
    AND request_key = p_chat_request_key
  FOR UPDATE;

  IF NOT FOUND
     OR v_claim.user_id IS DISTINCT FROM p_chat_user_id
     OR v_claim.visibility IS DISTINCT FROM p_chat_visibility
     OR v_claim.attempt_count IS DISTINCT FROM p_chat_claim_attempt_count
  THEN
    RAISE EXCEPTION 'AMORA_CHAT_RESPONSE_CLAIM_STALE'
      USING ERRCODE = '40001';
  END IF;

  -- A lost RPC response is retried with the same two ownership fences. Return
  -- the already committed message only when every durable identity agrees.
  IF v_claim.status = 'completed' AND v_claim.message_id IS NOT NULL THEN
    SELECT * INTO v_message
    FROM public.chat_messages
    WHERE id = v_claim.message_id
      AND couple_id = p_chat_couple_id
      AND sender_id IS NULL
      AND sender_type = 'ai'
      AND role = 'assistant'
      AND visibility = p_chat_visibility
      AND metadata->>'client_request_id' = p_chat_request_key;

    IF NOT FOUND
       OR v_receipt.amora_cost_status NOT IN ('settled', 'unknown') THEN
      RAISE EXCEPTION 'AMORA_CHAT_RESPONSE_COMMITTED_STATE_INVALID';
    END IF;

    RETURN QUERY SELECT
      true,
      v_receipt.amora_cost_status,
      'persisted'::text,
      v_message.id,
      v_message.created_at,
      v_message.content,
      v_message.metadata,
      v_message.stage_tag,
      v_message.specialist_type,
      v_message.visibility,
      true;
    RETURN;
  END IF;

  IF v_is_conflict_mediation
     AND v_claim.status = 'failed'
     AND v_claim.failure_code = 'COOLDOWN_RACE_LOST'
     AND v_claim.message_id IS NULL
     AND v_receipt.amora_cost_status IN ('settled', 'unknown') THEN
    RETURN QUERY SELECT
      true,
      v_receipt.amora_cost_status,
      'cooldown_race_lost'::text,
      NULL::uuid,
      NULL::timestamptz,
      NULL::text,
      NULL::jsonb,
      NULL::text,
      NULL::text,
      NULL::text,
      false;
    RETURN;
  END IF;

  IF v_claim.status IS DISTINCT FROM 'processing'
     OR v_receipt.amora_cost_status IS DISTINCT FROM 'reserved' THEN
    -- A legacy split finalizer may leave a settled receipt without a durable
    -- answer. Never invent or regenerate that answer: it needs reconciliation.
    RAISE EXCEPTION 'AMORA_CHAT_RESPONSE_RECONCILIATION_REQUIRED'
      USING ERRCODE = '55000';
  END IF;

  IF v_is_conflict_mediation THEN
    -- Different message digests can race through independent request claims.
    -- Serialize their final insertion on the couple row, then re-check the
    -- product's ten-minute mediation cooldown inside this transaction.
    PERFORM 1
    FROM public.couples
    WHERE id = p_chat_couple_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'AMORA_CHAT_RESPONSE_COUPLE_MISSING';
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.chat_messages AS message
      WHERE message.couple_id = p_chat_couple_id
        AND message.sender_id IS NULL
        AND message.sender_type = 'ai'
        AND message.role = 'assistant'
        AND message.visibility = 'shared'
        AND message.created_at >= now() - interval '10 minutes'
        AND message.metadata->>'client_request_id' IS DISTINCT FROM
              p_chat_request_key
        AND (
          message.metadata->>'kind' = 'mediation'
          OR COALESCE(message.metadata, '{}'::jsonb) ? 'mediation'
        )
    ) INTO v_cooldown_race_lost;
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
    p_receipt_metadata
  ) AS result;

  IF v_finalized IS DISTINCT FROM true
     OR v_receipt_status NOT IN ('settled', 'unknown') THEN
    RAISE EXCEPTION 'AMORA_CHAT_RESPONSE_RECEIPT_FINALIZE_FAILED';
  END IF;

  IF v_cooldown_race_lost THEN
    UPDATE public.amora_chat_request_claims
    SET status = 'failed',
        message_id = NULL,
        completed_at = NULL,
        failed_at = now(),
        failure_code = 'COOLDOWN_RACE_LOST'
    WHERE couple_id = p_chat_couple_id
      AND request_key = p_chat_request_key
      AND user_id = p_chat_user_id
      AND visibility = p_chat_visibility
      AND attempt_count = p_chat_claim_attempt_count
      AND status = 'processing';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'AMORA_CHAT_RESPONSE_CLAIM_STALE'
        USING ERRCODE = '40001';
    END IF;

    RETURN QUERY SELECT
      true,
      v_receipt_status,
      'cooldown_race_lost'::text,
      NULL::uuid,
      NULL::timestamptz,
      NULL::text,
      NULL::jsonb,
      NULL::text,
      NULL::text,
      NULL::text,
      false;
    RETURN;
  END IF;

  INSERT INTO public.chat_messages (
    couple_id,
    sender_id,
    sender_type,
    role,
    content,
    metadata,
    stage_tag,
    specialist_type,
    visibility
  ) VALUES (
    p_chat_couple_id,
    NULL,
    'ai',
    'assistant',
    p_message_content,
    (p_message_metadata - 'client_request_id') || jsonb_build_object(
      'client_request_id', p_chat_request_key
    ),
    p_message_stage_tag,
    p_message_specialist_type,
    p_chat_visibility
  )
  ON CONFLICT DO NOTHING
  RETURNING * INTO v_message;

  IF NOT FOUND THEN
    v_message_reused := true;
    SELECT * INTO v_message
    FROM public.chat_messages
    WHERE couple_id = p_chat_couple_id
      AND metadata->>'client_request_id' = p_chat_request_key
      AND sender_id IS NULL
      AND sender_type = 'ai'
      AND role = 'assistant'
      AND visibility = p_chat_visibility
    LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'AMORA_CHAT_RESPONSE_IDEMPOTENCY_CONFLICT'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  UPDATE public.amora_chat_request_claims
  SET status = 'completed',
      message_id = v_message.id,
      completed_at = now(),
      failed_at = NULL,
      failure_code = NULL
  WHERE couple_id = p_chat_couple_id
    AND request_key = p_chat_request_key
    AND user_id = p_chat_user_id
    AND visibility = p_chat_visibility
    AND attempt_count = p_chat_claim_attempt_count
    AND status = 'processing';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_CHAT_RESPONSE_CLAIM_STALE'
      USING ERRCODE = '40001';
  END IF;

  RETURN QUERY SELECT
    true,
    v_receipt_status,
    'persisted'::text,
    v_message.id,
    v_message.created_at,
    v_message.content,
    v_message.metadata,
    v_message.stage_tag,
    v_message.specialist_type,
    v_message.visibility,
    v_message_reused;
END;
$function$;

-- A rolling-deploy worker may have used the legacy message-first path and
-- lost the HTTP response before completing its request claim. Repair that
-- already durable response before replay; this function never creates or
-- changes message content.
CREATE OR REPLACE FUNCTION public.reconcile_amora_chat_response(
  p_couple_id uuid,
  p_request_key text,
  p_user_id uuid,
  p_visibility text,
  p_message_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_claim public.amora_chat_request_claims%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_CHAT_RECONCILE_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;
  IF p_couple_id IS NULL
     OR p_user_id IS NULL
     OR p_message_id IS NULL
     OR p_request_key IS NULL
     OR char_length(p_request_key) NOT BETWEEN 1 AND 160
     OR p_visibility NOT IN ('shared', 'bride_private', 'groom_private')
  THEN
    RAISE EXCEPTION 'AMORA_CHAT_RECONCILE_INVALID_INPUT'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.chat_messages AS message
    WHERE message.id = p_message_id
      AND message.couple_id = p_couple_id
      AND message.sender_id IS NULL
      AND message.sender_type = 'ai'
      AND message.role = 'assistant'
      AND message.visibility = p_visibility
      AND message.metadata->>'client_request_id' = p_request_key
  ) THEN
    RAISE EXCEPTION 'AMORA_CHAT_RECONCILE_MESSAGE_MISMATCH'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_claim
  FROM public.amora_chat_request_claims
  WHERE couple_id = p_couple_id
    AND request_key = p_request_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF v_claim.user_id IS DISTINCT FROM p_user_id
     OR v_claim.visibility IS DISTINCT FROM p_visibility THEN
    RAISE EXCEPTION 'AMORA_CHAT_RECONCILE_SCOPE_MISMATCH'
      USING ERRCODE = '42501';
  END IF;
  IF v_claim.status = 'completed' THEN
    RETURN v_claim.message_id = p_message_id;
  END IF;
  IF v_claim.status NOT IN ('processing', 'failed') THEN
    RETURN false;
  END IF;

  UPDATE public.amora_chat_request_claims
  SET status = 'completed',
      message_id = p_message_id,
      completed_at = now(),
      failed_at = NULL,
      failure_code = NULL
  WHERE couple_id = p_couple_id
    AND request_key = p_request_key
    AND user_id = p_user_id
    AND visibility = p_visibility;
  RETURN FOUND;
END;
$function$;

ALTER FUNCTION public.finalize_amora_chat_response(
  uuid, uuid, uuid, uuid, text, text, integer, text, jsonb, text, text,
  boolean, text, bigint, boolean, text, text, integer, integer, integer, jsonb
) OWNER TO postgres;
ALTER FUNCTION public.reconcile_amora_chat_response(
  uuid, text, uuid, text, uuid
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.finalize_amora_chat_response(
  uuid, uuid, uuid, uuid, text, text, integer, text, jsonb, text, text,
  boolean, text, bigint, boolean, text, text, integer, integer, integer, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_amora_chat_response(
  uuid, uuid, uuid, uuid, text, text, integer, text, jsonb, text, text,
  boolean, text, bigint, boolean, text, text, integer, integer, integer, jsonb
) TO service_role;

REVOKE ALL ON FUNCTION public.reconcile_amora_chat_response(
  uuid, text, uuid, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_amora_chat_response(
  uuid, text, uuid, text, uuid
) TO service_role;

COMMENT ON FUNCTION public.finalize_amora_chat_response(
  uuid, uuid, uuid, uuid, text, text, integer, text, jsonb, text, text,
  boolean, text, bigint, boolean, text, text, integer, integer, integer, jsonb
) IS
  'Atomically settles one successful terminal Amora provider receipt, inserts its idempotent assistant message, and completes the generation-fenced chat claim.';
COMMENT ON FUNCTION public.reconcile_amora_chat_response(
  uuid, text, uuid, text, uuid
) IS
  'Repairs a legacy message-first terminal response by completing only its exact couple/user/visibility-scoped durable chat claim.';

DO $postcheck$
BEGIN
  IF NOT has_function_privilege(
       'service_role',
       'public.finalize_amora_chat_response(uuid,uuid,uuid,uuid,text,text,integer,text,jsonb,text,text,boolean,text,bigint,boolean,text,text,integer,integer,integer,jsonb)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.finalize_amora_chat_response(uuid,uuid,uuid,uuid,text,text,integer,text,jsonb,text,text,boolean,text,bigint,boolean,text,text,integer,integer,integer,jsonb)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.reconcile_amora_chat_response(uuid,text,uuid,text,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.reconcile_amora_chat_response(uuid,text,uuid,text,uuid)',
       'EXECUTE'
     )
  THEN
    RAISE EXCEPTION 'AMORA_ATOMIC_CHAT_RESPONSE_POSTCHECK_FAILED';
  END IF;
END;
$postcheck$;
