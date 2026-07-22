BEGIN;

-- Amora crash recovery and atomic mutating-tool commit boundary.
--
-- A non-terminal OpenAI response is useful only when its exact replayable
-- output survives the same commit as provider-cost settlement. The journal is
-- deliberately transient and bounded: at most two tool rounds, one tool call
-- per round, encrypted reasoning only, no input conversation, and a 24-hour
-- recovery window. Terminal claims erase it.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.amora_chat_request_claims
  ADD COLUMN IF NOT EXISTS tool_round_journal jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS tool_round_journal_expires_at timestamptz;

DO $journal_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.amora_chat_request_claims'::regclass
      AND conname = 'amora_chat_request_tool_round_journal_shape'
  ) THEN
    ALTER TABLE public.amora_chat_request_claims
      ADD CONSTRAINT amora_chat_request_tool_round_journal_shape CHECK (
        jsonb_typeof(tool_round_journal) = 'array'
        AND jsonb_array_length(tool_round_journal) <= 2
        AND octet_length(tool_round_journal::text) <= 196608
        AND (
          (tool_round_journal = '[]'::jsonb AND tool_round_journal_expires_at IS NULL)
          OR
          (tool_round_journal <> '[]'::jsonb AND tool_round_journal_expires_at IS NOT NULL)
        )
      ) NOT VALID;
  END IF;
END;
$journal_constraints$;

ALTER TABLE public.amora_chat_request_claims
  VALIDATE CONSTRAINT amora_chat_request_tool_round_journal_shape;

CREATE OR REPLACE FUNCTION public.amora_validate_tool_round_checkpoint(
  p_checkpoint jsonb,
  p_call_index integer
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_tool jsonb;
  v_output jsonb;
  v_matching_calls integer := 0;
  v_arguments jsonb;
BEGIN
  IF p_checkpoint IS NULL
     OR jsonb_typeof(p_checkpoint) <> 'object'
     OR octet_length(p_checkpoint::text) > 98304
     OR p_checkpoint - ARRAY[
       'version', 'callIndex', 'phase', 'toolCalls', 'outputItems'
     ] <> '{}'::jsonb
     OR p_checkpoint ->> 'version' <> '1'
     OR p_checkpoint ->> 'callIndex' <> p_call_index::text
     OR p_call_index NOT BETWEEN 1 AND 2
     OR p_checkpoint ->> 'phase' <> 'tool_round'
     OR jsonb_typeof(p_checkpoint -> 'toolCalls') <> 'array'
     OR jsonb_array_length(p_checkpoint -> 'toolCalls') <> 1
     OR jsonb_typeof(p_checkpoint -> 'outputItems') <> 'array'
     OR jsonb_array_length(p_checkpoint -> 'outputItems') NOT BETWEEN 1 AND 8 THEN
    RETURN false;
  END IF;

  v_tool := p_checkpoint -> 'toolCalls' -> 0;
  IF jsonb_typeof(v_tool) <> 'object'
     OR v_tool - ARRAY[
       'callId', 'name', 'input', 'parseError', 'inputDigest', 'operationKey'
     ] <> '{}'::jsonb
     OR char_length(COALESCE(v_tool ->> 'callId', '')) NOT BETWEEN 1 AND 128
     OR COALESCE(v_tool ->> 'name', '') !~ '^[A-Za-z0-9_-]{1,64}$'
     OR jsonb_typeof(v_tool -> 'input') <> 'object'
     OR octet_length((v_tool -> 'input')::text) > 16384
     OR COALESCE(v_tool ->> 'inputDigest', '') !~ '^[0-9a-f]{64}$'
     OR COALESCE(v_tool ->> 'operationKey', '') !~ '^[0-9a-f]{64}$'
     OR (
       v_tool ? 'parseError'
       AND v_tool ->> 'parseError' NOT IN (
         'invalid_json', 'invalid_shape', 'schema_validation'
       )
     ) THEN
    RETURN false;
  END IF;

  FOR v_output IN
    SELECT value FROM jsonb_array_elements(p_checkpoint -> 'outputItems')
  LOOP
    IF jsonb_typeof(v_output) <> 'object'
       OR v_output ->> 'type' NOT IN ('message', 'function_call', 'reasoning') THEN
      RETURN false;
    END IF;

    IF v_output ->> 'type' = 'reasoning'
       AND (
         jsonb_typeof(v_output -> 'encrypted_content') <> 'string'
         OR char_length(v_output ->> 'encrypted_content') NOT BETWEEN 1 AND 65536
         OR v_output - ARRAY[
           'type', 'id', 'summary', 'encrypted_content', 'status'
         ] <> '{}'::jsonb
         OR (
           v_output ? 'summary'
           AND (
             jsonb_typeof(v_output -> 'summary') <> 'array'
             OR jsonb_array_length(v_output -> 'summary') <> 0
           )
         )
       ) THEN
      RETURN false;
    END IF;

    IF v_output ->> 'type' = 'function_call'
       AND (
         v_output ->> 'call_id' IS DISTINCT FROM v_tool ->> 'callId'
         OR v_output ->> 'name' IS DISTINCT FROM v_tool ->> 'name'
       ) THEN
      RETURN false;
    END IF;

    IF v_output ->> 'type' = 'function_call' THEN
      v_matching_calls := v_matching_calls + 1;
      IF jsonb_typeof(v_output -> 'arguments') <> 'string' THEN
        RETURN false;
      END IF;
      IF COALESCE(v_tool ->> 'parseError', '') <> 'invalid_json' THEN
        BEGIN
          v_arguments := (v_output ->> 'arguments')::jsonb;
        EXCEPTION WHEN OTHERS THEN
          RETURN false;
        END;
        IF jsonb_typeof(v_arguments) <> 'object'
           OR v_arguments <> v_tool -> 'input' THEN
          RETURN false;
        END IF;
      END IF;
    END IF;
  END LOOP;

  RETURN v_matching_calls = 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.amora_validate_tool_round_checkpoint(jsonb, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.amora_validate_tool_round_checkpoint(jsonb, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_amora_tool_round_receipt(
  p_receipt_id uuid,
  p_receipt_claim_token uuid,
  p_chat_couple_id uuid,
  p_chat_request_key text,
  p_chat_claim_attempt_count integer,
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
  p_receipt_metadata jsonb
)
RETURNS TABLE(finalized boolean, receipt_status text, checkpointed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_receipt public.ai_interactions_log%ROWTYPE;
  v_claim public.amora_chat_request_claims%ROWTYPE;
  v_call_index integer;
  v_existing jsonb;
  v_finalized boolean;
  v_receipt_status text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_TOOL_ROUND_FINALIZE_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  BEGIN
    v_call_index := (p_checkpoint ->> 'callIndex')::integer;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'AMORA_TOOL_ROUND_CHECKPOINT_INVALID'
      USING ERRCODE = '22023';
  END;

  IF p_chat_couple_id IS NULL
     OR p_chat_request_key IS NULL
     OR p_chat_claim_attempt_count IS NULL
     OR p_chat_claim_attempt_count < 1
     OR p_provider_attempted IS DISTINCT FROM true
     OR p_success IS DISTINCT FROM true
     OR NOT public.amora_validate_tool_round_checkpoint(
       p_checkpoint,
       v_call_index
     ) THEN
    RAISE EXCEPTION 'AMORA_TOOL_ROUND_CHECKPOINT_INVALID'
      USING ERRCODE = '22023';
  END IF;

  SELECT receipt.* INTO v_receipt
  FROM public.ai_interactions_log AS receipt
  WHERE receipt.id = p_receipt_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_receipt.amora_claim_token IS DISTINCT FROM p_receipt_claim_token
     OR v_receipt.couple_id IS DISTINCT FROM p_chat_couple_id
     OR v_receipt.amora_request_key IS DISTINCT FROM p_chat_request_key
     OR v_receipt.amora_call_index IS DISTINCT FROM v_call_index
     OR v_receipt.amora_call_source IS DISTINCT FROM 'durable'
     OR v_receipt.amora_call_phase IS DISTINCT FROM 'tool_round' THEN
    RAISE EXCEPTION 'AMORA_TOOL_ROUND_RECEIPT_MISMATCH'
      USING ERRCODE = '23514';
  END IF;

  SELECT claim.* INTO v_claim
  FROM public.amora_chat_request_claims AS claim
  WHERE claim.couple_id = p_chat_couple_id
    AND claim.request_key = p_chat_request_key
  FOR UPDATE;

  IF NOT FOUND
     OR v_claim.status <> 'processing'
     OR v_claim.attempt_count <> p_chat_claim_attempt_count THEN
    RAISE EXCEPTION 'AMORA_TOOL_ROUND_CLAIM_STALE'
      USING ERRCODE = '40001';
  END IF;

  SELECT value INTO v_existing
  FROM jsonb_array_elements(v_claim.tool_round_journal) AS entry(value)
  WHERE entry.value ->> 'callIndex' = v_call_index::text;

  IF FOUND AND v_existing <> p_checkpoint THEN
    RAISE EXCEPTION 'AMORA_TOOL_ROUND_CHECKPOINT_CONFLICT'
      USING ERRCODE = '23505';
  END IF;
  IF NOT FOUND
     AND jsonb_array_length(v_claim.tool_round_journal) <> v_call_index - 1 THEN
    RAISE EXCEPTION 'AMORA_TOOL_ROUND_CHECKPOINT_GAP'
      USING ERRCODE = '23514';
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
    RAISE EXCEPTION 'AMORA_TOOL_ROUND_RECEIPT_FINALIZE_FAILED';
  END IF;

  IF v_existing IS NULL THEN
    UPDATE public.amora_chat_request_claims
    SET tool_round_journal = tool_round_journal || jsonb_build_array(p_checkpoint),
        tool_round_journal_expires_at = now() + interval '24 hours'
    WHERE couple_id = p_chat_couple_id
      AND request_key = p_chat_request_key;
  END IF;

  RETURN QUERY SELECT true, v_receipt_status, true;
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_amora_tool_round_receipt(
  uuid, uuid, uuid, text, integer, jsonb, boolean, text, bigint, boolean,
  text, text, integer, integer, integer, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_amora_tool_round_receipt(
  uuid, uuid, uuid, text, integer, jsonb, boolean, text, bigint, boolean,
  text, text, integer, integer, integer, jsonb
) TO service_role;

CREATE OR REPLACE FUNCTION public.get_amora_tool_round_journal(
  p_couple_id uuid,
  p_request_key text,
  p_attempt_count integer
)
RETURNS jsonb
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
    RAISE EXCEPTION 'AMORA_TOOL_ROUND_JOURNAL_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  SELECT claim.* INTO v_claim
  FROM public.amora_chat_request_claims AS claim
  WHERE claim.couple_id = p_couple_id
    AND claim.request_key = p_request_key
  FOR UPDATE;

  IF NOT FOUND
     OR v_claim.status <> 'processing'
     OR v_claim.attempt_count <> p_attempt_count THEN
    RETURN jsonb_build_object('action', 'stale');
  END IF;

  IF v_claim.tool_round_journal <> '[]'::jsonb
     AND v_claim.tool_round_journal_expires_at <= now() THEN
    UPDATE public.amora_chat_request_claims
    SET tool_round_journal = '[]'::jsonb,
        tool_round_journal_expires_at = NULL
    WHERE couple_id = p_couple_id
      AND request_key = p_request_key;
    RETURN jsonb_build_object('action', 'expired');
  END IF;

  RETURN jsonb_build_object(
    'action', 'loaded',
    'journal', v_claim.tool_round_journal
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_amora_tool_round_journal(uuid, text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_amora_tool_round_journal(uuid, text, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.clear_amora_tool_round_journal_on_completion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.status = 'completed' THEN
    NEW.tool_round_journal := '[]'::jsonb;
    NEW.tool_round_journal_expires_at := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS amora_chat_request_clear_tool_round_journal
  ON public.amora_chat_request_claims;
CREATE TRIGGER amora_chat_request_clear_tool_round_journal
  BEFORE UPDATE OF status ON public.amora_chat_request_claims
  FOR EACH ROW
  WHEN (NEW.status = 'completed')
  EXECUTE FUNCTION public.clear_amora_tool_round_journal_on_completion();

REVOKE ALL ON FUNCTION public.clear_amora_tool_round_journal_on_completion()
  FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.amora_tool_executions
  ADD COLUMN IF NOT EXISTS atomic_dispatch boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS request_attempt_count integer;

DO $atomic_tool_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.amora_tool_executions'::regclass
      AND conname = 'amora_tool_atomic_attempt_shape'
  ) THEN
    ALTER TABLE public.amora_tool_executions
      ADD CONSTRAINT amora_tool_atomic_attempt_shape CHECK (
        (NOT atomic_dispatch AND request_attempt_count IS NULL)
        OR (atomic_dispatch AND request_attempt_count > 0)
      ) NOT VALID;
  END IF;
END;
$atomic_tool_constraints$;

ALTER TABLE public.amora_tool_executions
  VALIDATE CONSTRAINT amora_tool_atomic_attempt_shape;

-- Automatic model mutations and exact server-confirmed actions use this
-- atomic-dispatch overload. Automatic calls require a journal call index;
-- confirmed actions require the server-issued pending-action capability. The
-- historical 5/6/7-argument overloads remain for rolling-deploy compatibility.
CREATE OR REPLACE FUNCTION public.claim_amora_tool_execution(
  p_couple_id uuid,
  p_request_key text,
  p_operation_key text,
  p_tool_name text,
  p_input_digest text,
  p_request_attempt_count integer,
  p_pending_action_id uuid,
  p_provider_call_index integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_request public.amora_chat_request_claims%ROWTYPE;
  v_execution public.amora_tool_executions%ROWTYPE;
  v_authorized boolean := false;
  v_latest_context_message_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_TOOL_CLAIM_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF p_couple_id IS NULL
     OR p_request_key !~* '^chat:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR p_operation_key !~ '^[0-9a-f]{64}$'
     OR p_input_digest !~ '^[0-9a-f]{64}$'
     OR p_request_attempt_count IS NULL
     OR p_request_attempt_count < 1
     OR NOT (
       (
         p_pending_action_id IS NULL
         AND p_provider_call_index BETWEEN 1 AND 2
       )
       OR (
         p_pending_action_id IS NOT NULL
         AND p_provider_call_index IS NULL
       )
     )
     OR p_tool_name NOT IN (
       'update_budget', 'update_wedding_date', 'update_task_status', 'update_venue',
       'update_category_budget', 'apply_budget_plan', 'add_custom_category',
       'delete_category', 'reset_category', 'add_schedule_event',
       'update_schedule_event', 'delete_schedule_event', 'toggle_checklist_item',
       'add_amora_action', 'update_amora_action', 'log_wedding_event',
       'create_booking', 'cancel_booking'
     ) THEN
    RAISE EXCEPTION 'AMORA_TOOL_CLAIM_INVALID_INPUT'
      USING ERRCODE = '22023';
  END IF;

  SELECT claim.* INTO v_request
  FROM public.amora_chat_request_claims AS claim
  WHERE claim.couple_id = p_couple_id
    AND claim.request_key = p_request_key
  FOR UPDATE;

  IF NOT FOUND
     OR v_request.status <> 'processing'
     OR v_request.attempt_count <> p_request_attempt_count THEN
    RETURN jsonb_build_object('action', 'stale_attempt');
  END IF;

  IF p_pending_action_id IS NULL THEN
    IF v_request.tool_round_journal_expires_at <= now() THEN
      RETURN jsonb_build_object('action', 'stale_context');
    END IF;

    SELECT true INTO v_authorized
    FROM jsonb_array_elements(v_request.tool_round_journal) AS checkpoint(value)
    CROSS JOIN LATERAL jsonb_array_elements(
      checkpoint.value -> 'toolCalls'
    ) AS tool(value)
    WHERE checkpoint.value ->> 'callIndex' = p_provider_call_index::text
      AND tool.value ->> 'name' = p_tool_name
      AND tool.value ->> 'inputDigest' = p_input_digest
      AND tool.value ->> 'operationKey' = p_operation_key
    LIMIT 1;

    IF NOT COALESCE(v_authorized, false) THEN
      RETURN jsonb_build_object('action', 'stale_context');
    END IF;
  END IF;

  -- Retain the DB-linearized freshness check from the 0960 claim. The couples
  -- parent lock serializes against concurrent chat inserts through the
  -- immediate chat_messages.couple_id foreign key.
  PERFORM 1 FROM public.couples AS couple
  WHERE couple.id = p_couple_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_request.user_message_id IS NULL
     OR v_request.visibility <> 'shared' THEN
    RETURN jsonb_build_object('action', 'stale_context');
  END IF;

  SELECT message.id INTO v_latest_context_message_id
  FROM public.chat_messages AS message
  WHERE message.couple_id = p_couple_id
    AND message.visibility = 'shared'
    AND COALESCE(message.metadata ->> 'target', '') <> 'partner'
  ORDER BY message.created_at DESC, message.id DESC
  LIMIT 1;

  IF v_latest_context_message_id IS DISTINCT FROM v_request.user_message_id
     OR NOT EXISTS (
       SELECT 1 FROM public.chat_messages AS bound_message
       WHERE bound_message.id = v_request.user_message_id
         AND bound_message.couple_id = p_couple_id
         AND bound_message.sender_id = v_request.user_id
         AND bound_message.sender_type IN ('bride', 'groom')
         AND bound_message.role = 'user'
         AND bound_message.visibility = 'shared'
         AND COALESCE(bound_message.metadata ->> 'target', '') <> 'partner'
     ) THEN
    RETURN jsonb_build_object('action', 'stale_context');
  END IF;

  IF p_pending_action_id IS NULL THEN
    SELECT execution.* INTO v_execution
    FROM public.amora_tool_executions AS execution
    WHERE execution.couple_id = p_couple_id
      AND execution.request_key = p_request_key
      AND execution.operation_key = p_operation_key
    FOR UPDATE;
  ELSE
    SELECT execution.* INTO v_execution
    FROM public.amora_tool_executions AS execution
    WHERE execution.couple_id = p_couple_id
      AND execution.pending_action_id = p_pending_action_id
    FOR UPDATE;
  END IF;

  IF FOUND THEN
    IF v_execution.tool_name <> p_tool_name
       OR v_execution.input_digest <> p_input_digest
       OR v_execution.operation_key <> p_operation_key
       OR v_execution.pending_action_id IS DISTINCT FROM p_pending_action_id THEN
      RETURN jsonb_build_object('action', 'conflict');
    END IF;
    IF v_execution.status = 'completed' THEN
      RETURN jsonb_build_object(
        'action', 'completed', 'result', v_execution.result
      );
    END IF;
    IF v_execution.status = 'uncertain' OR NOT v_execution.atomic_dispatch THEN
      RETURN jsonb_build_object('action', 'uncertain');
    END IF;

    IF v_execution.request_key = p_request_key
       AND (
         v_execution.request_attempt_count < p_request_attempt_count
         OR v_execution.claimed_at < now() - interval '6 minutes'
       ) THEN
      UPDATE public.amora_tool_executions
      SET request_attempt_count = p_request_attempt_count,
          claimed_at = now(),
          updated_at = now()
      WHERE couple_id = v_execution.couple_id
        AND request_key = v_execution.request_key
        AND operation_key = v_execution.operation_key;
      RETURN jsonb_build_object('action', 'acquired');
    END IF;
    RETURN jsonb_build_object('action', 'in_progress');
  END IF;

  INSERT INTO public.amora_tool_executions (
    couple_id, request_key, operation_key, tool_name, input_digest,
    pending_action_id, atomic_dispatch, request_attempt_count
  ) VALUES (
    p_couple_id, p_request_key, p_operation_key, p_tool_name, p_input_digest,
    p_pending_action_id, true, p_request_attempt_count
  )
  ON CONFLICT DO NOTHING
  RETURNING * INTO v_execution;

  IF FOUND THEN
    RETURN jsonb_build_object('action', 'acquired');
  END IF;

  IF p_pending_action_id IS NULL THEN
    SELECT execution.* INTO v_execution
    FROM public.amora_tool_executions AS execution
    WHERE execution.couple_id = p_couple_id
      AND execution.request_key = p_request_key
      AND execution.operation_key = p_operation_key
    FOR UPDATE;
  ELSE
    SELECT execution.* INTO v_execution
    FROM public.amora_tool_executions AS execution
    WHERE execution.couple_id = p_couple_id
      AND execution.pending_action_id = p_pending_action_id
    FOR UPDATE;
  END IF;
  IF FOUND
     AND v_execution.operation_key = p_operation_key
     AND v_execution.tool_name = p_tool_name
     AND v_execution.input_digest = p_input_digest
     AND v_execution.pending_action_id IS NOT DISTINCT FROM p_pending_action_id
     AND v_execution.atomic_dispatch THEN
    IF v_execution.status = 'completed' THEN
      RETURN jsonb_build_object(
        'action', 'completed', 'result', v_execution.result
      );
    END IF;
    RETURN jsonb_build_object('action', 'in_progress');
  END IF;
  RETURN jsonb_build_object('action', 'conflict');
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_amora_tool_execution(
  uuid, text, text, text, text, integer, uuid, integer
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_amora_tool_execution(
  uuid, text, text, text, text, integer, uuid, integer
) TO service_role;

-- New application instances never perform a domain write followed by the
-- legacy completion RPC. This dispatcher owns both writes in one transaction.
-- Its initial release covers total-budget and schedule-event mutations; an
-- unsupported mutation is durably completed as a no-op failure, never passed
-- through to a split application path.
CREATE OR REPLACE FUNCTION public.apply_amora_atomic_tool_execution(
  p_couple_id uuid,
  p_request_key text,
  p_operation_key text,
  p_request_attempt_count integer,
  p_input_digest text,
  p_tool_input jsonb,
  p_domain_mutation jsonb,
  p_result jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_request public.amora_chat_request_claims%ROWTYPE;
  v_execution public.amora_tool_executions%ROWTYPE;
  v_journey public.wedding_journeys%ROWTYPE;
  v_kind text;
  v_expected_budget numeric;
  v_next_budget numeric;
  v_progress_key text;
  v_expected_present boolean;
  v_current_present boolean;
  v_event jsonb;
  v_event_date date;
  v_event_count integer := 0;
  v_distinct_event_count integer := 0;
  v_effective_result jsonb := p_result;
  v_rows integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_ATOMIC_TOOL_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF p_couple_id IS NULL
     OR p_request_key IS NULL
     OR p_operation_key !~ '^[0-9a-f]{64}$'
     OR p_request_attempt_count IS NULL
     OR p_request_attempt_count < 1
     OR p_input_digest !~ '^[0-9a-f]{64}$'
     OR jsonb_typeof(p_tool_input) <> 'object'
     OR octet_length(p_tool_input::text) > 16384
     OR jsonb_typeof(p_domain_mutation) <> 'object'
     OR octet_length(p_domain_mutation::text) > 2097152
     OR jsonb_typeof(p_result) <> 'object'
     OR octet_length(p_result::text) > 65536
     OR p_result ? 'toolInput'
     OR p_result - ARRAY[
       'toolName', 'toolOutput', 'success', 'displayMessage'
     ] <> '{}'::jsonb
     OR jsonb_typeof(p_result -> 'toolOutput') <> 'object'
     OR jsonb_typeof(p_result -> 'success') <> 'boolean'
     OR jsonb_typeof(p_result -> 'displayMessage') <> 'string'
     OR char_length(p_result ->> 'displayMessage') > 4000 THEN
    RAISE EXCEPTION 'AMORA_ATOMIC_TOOL_INVALID_INPUT'
      USING ERRCODE = '22023';
  END IF;

  SELECT claim.* INTO v_request
  FROM public.amora_chat_request_claims AS claim
  WHERE claim.couple_id = p_couple_id
    AND claim.request_key = p_request_key
  FOR UPDATE;

  IF NOT FOUND
     OR v_request.status <> 'processing'
     OR v_request.attempt_count <> p_request_attempt_count THEN
    RAISE EXCEPTION 'AMORA_ATOMIC_TOOL_CLAIM_STALE'
      USING ERRCODE = '40001';
  END IF;

  SELECT execution.* INTO v_execution
  FROM public.amora_tool_executions AS execution
  WHERE execution.couple_id = p_couple_id
    AND execution.request_key = p_request_key
    AND execution.operation_key = p_operation_key
  FOR UPDATE;

  IF NOT FOUND
     OR v_execution.input_digest <> p_input_digest
     OR p_result ->> 'toolName' <> v_execution.tool_name
     OR NOT v_execution.atomic_dispatch
     OR v_execution.request_attempt_count <> p_request_attempt_count THEN
    RAISE EXCEPTION 'AMORA_ATOMIC_TOOL_EXECUTION_MISMATCH'
      USING ERRCODE = '23514';
  END IF;

  IF v_execution.status = 'completed' THEN
    RETURN v_execution.result;
  END IF;
  IF v_execution.status <> 'processing' THEN
    RAISE EXCEPTION 'AMORA_ATOMIC_TOOL_EXECUTION_NOT_PROCESSING'
      USING ERRCODE = '55000';
  END IF;

  v_kind := p_domain_mutation ->> 'kind';
  IF v_kind = 'none' THEN
    IF p_result ->> 'success' <> 'false'
       OR p_domain_mutation - 'kind' <> '{}'::jsonb THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_TOOL_NOOP_INVALID'
        USING ERRCODE = '22023';
    END IF;
  ELSIF v_kind = 'journey_total_budget_cas' THEN
    IF v_execution.tool_name <> 'update_budget'
       OR p_domain_mutation - ARRAY['kind', 'expected', 'value'] <> '{}'::jsonb
       OR jsonb_typeof(p_domain_mutation -> 'expected') <> 'number'
       OR jsonb_typeof(p_domain_mutation -> 'value') <> 'number'
       OR jsonb_typeof(p_tool_input -> 'total_budget') <> 'number'
       OR p_tool_input -> 'total_budget' <> p_domain_mutation -> 'value'
       OR p_result ->> 'success' <> 'true'
       OR p_result -> 'toolOutput' -> 'total_budget'
          <> p_domain_mutation -> 'value'
       OR p_result -> 'toolOutput' -> 'previous_budget'
          <> p_domain_mutation -> 'expected' THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_BUDGET_MUTATION_INVALID'
        USING ERRCODE = '22023';
    END IF;

    BEGIN
      v_expected_budget := (p_domain_mutation ->> 'expected')::numeric;
      v_next_budget := (p_domain_mutation ->> 'value')::numeric;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_BUDGET_MUTATION_INVALID'
        USING ERRCODE = '22023';
    END;
    IF trunc(v_expected_budget) <> v_expected_budget
       OR trunc(v_next_budget) <> v_next_budget
       OR v_expected_budget NOT BETWEEN 0 AND 1000000000000
       OR v_next_budget NOT BETWEEN 0 AND 1000000000000 THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_BUDGET_MUTATION_INVALID'
        USING ERRCODE = '22023';
    END IF;

    SELECT journey.* INTO v_journey
    FROM public.wedding_journeys AS journey
    WHERE journey.couple_id = p_couple_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_JOURNEY_NOT_FOUND'
        USING ERRCODE = 'P0002';
    END IF;

    IF v_journey.total_budget IS DISTINCT FROM v_expected_budget THEN
      v_effective_result := jsonb_build_object(
        'toolName', v_execution.tool_name,
        'toolOutput', jsonb_build_object(
          'error', 'domain_state_changed',
          'retryable', false
        ),
        'success', false,
        'displayMessage',
          '다른 변경이 먼저 반영되어 이번 요청은 적용하지 않았어요. 현재 상태를 다시 확인해 주세요.'
      );
    ELSE
      UPDATE public.wedding_journeys
      SET total_budget = v_next_budget,
          updated_at = now()
      WHERE couple_id = p_couple_id;
    END IF;
  ELSIF v_kind = 'journey_progress_key_cas' THEN
    IF v_execution.tool_name NOT IN (
         'add_schedule_event', 'update_schedule_event', 'delete_schedule_event'
       )
       OR p_domain_mutation - ARRAY[
         'kind', 'key', 'expectedPresent', 'expected', 'value'
       ] <> '{}'::jsonb
       OR p_domain_mutation ->> 'key' <> '__events'
       OR jsonb_typeof(p_domain_mutation -> 'expectedPresent') <> 'boolean'
       OR jsonb_typeof(p_domain_mutation -> 'value') <> 'array'
       OR jsonb_array_length(p_domain_mutation -> 'value') > 500
       OR octet_length((p_domain_mutation -> 'value')::text) > 1572864
       OR p_result ->> 'success' <> 'true' THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_SCHEDULE_MUTATION_INVALID'
        USING ERRCODE = '22023';
    END IF;

    v_progress_key := p_domain_mutation ->> 'key';
    v_expected_present := (p_domain_mutation ->> 'expectedPresent')::boolean;
    IF (v_expected_present AND NOT p_domain_mutation ? 'expected')
       OR (NOT v_expected_present AND p_domain_mutation ? 'expected')
       OR (
         v_expected_present
         AND jsonb_typeof(p_domain_mutation -> 'expected') <> 'array'
       )
       OR (
         v_expected_present
         AND (
           jsonb_array_length(p_domain_mutation -> 'expected') > 500
           OR octet_length((p_domain_mutation -> 'expected')::text) > 1572864
         )
       ) THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_SCHEDULE_EXPECTATION_INVALID'
        USING ERRCODE = '22023';
    END IF;

    IF v_execution.tool_name = 'delete_schedule_event' THEN
      IF NOT v_expected_present
         OR jsonb_typeof(p_result -> 'toolOutput' -> 'deleted_event') <> 'object'
         OR p_tool_input ->> 'event_id'
            <> p_result -> 'toolOutput' -> 'deleted_event' ->> 'id'
         OR p_tool_input ->> 'confirmed' <> 'true'
         OR NOT (
           p_domain_mutation -> 'expected'
           @> jsonb_build_array(p_result -> 'toolOutput' -> 'deleted_event')
         )
         OR EXISTS (
           SELECT 1
           FROM jsonb_array_elements(p_domain_mutation -> 'value') AS remaining(value)
           WHERE remaining.value ->> 'id'
             = p_result -> 'toolOutput' -> 'deleted_event' ->> 'id'
         )
         OR jsonb_array_length(p_domain_mutation -> 'expected')
            <> jsonb_array_length(p_domain_mutation -> 'value') + 1
         OR EXISTS (
           SELECT 1
           FROM jsonb_array_elements(p_domain_mutation -> 'expected') AS prior(value)
           WHERE prior.value ->> 'id'
                 <> p_result -> 'toolOutput' -> 'deleted_event' ->> 'id'
             AND NOT (
               p_domain_mutation -> 'value' @> jsonb_build_array(prior.value)
             )
         ) THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_SCHEDULE_DELETE_INVALID'
          USING ERRCODE = '22023';
      END IF;
    ELSE
      IF jsonb_typeof(p_result -> 'toolOutput' -> 'event') <> 'object'
         OR NOT (
           p_domain_mutation -> 'value'
           @> jsonb_build_array(p_result -> 'toolOutput' -> 'event')
         )
         OR (
           v_execution.tool_name = 'add_schedule_event'
           AND (
             p_tool_input ->> 'date'
               <> p_result -> 'toolOutput' -> 'event' ->> 'date'
             OR p_tool_input ->> 'title'
               <> p_result -> 'toolOutput' -> 'event' ->> 'title'
           )
         )
         OR (
           v_execution.tool_name = 'update_schedule_event'
           AND p_tool_input ->> 'event_id'
             <> p_result -> 'toolOutput' -> 'event' ->> 'id'
         ) THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_SCHEDULE_UPSERT_INVALID'
          USING ERRCODE = '22023';
      END IF;
    END IF;

    FOR v_event IN
      SELECT value FROM jsonb_array_elements(p_domain_mutation -> 'value')
      UNION ALL
      SELECT value
      FROM jsonb_array_elements(
        CASE
          WHEN v_expected_present THEN p_domain_mutation -> 'expected'
          ELSE '[]'::jsonb
        END
      )
    LOOP
      IF jsonb_typeof(v_event) <> 'object'
         OR char_length(COALESCE(v_event ->> 'id', '')) NOT BETWEEN 1 AND 200
         OR COALESCE(v_event ->> 'date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
         OR char_length(btrim(COALESCE(v_event ->> 'title', ''))) NOT BETWEEN 1 AND 500
         OR char_length(COALESCE(v_event ->> 'createdAt', '')) NOT BETWEEN 1 AND 100
         OR char_length(COALESCE(v_event ->> 'updatedAt', '')) NOT BETWEEN 1 AND 100
         OR (v_event ? 'memo' AND jsonb_typeof(v_event -> 'memo') <> 'string')
         OR char_length(COALESCE(v_event ->> 'memo', '')) > 2000
         OR (v_event ? 'categoryKey' AND jsonb_typeof(v_event -> 'categoryKey') <> 'string')
         OR char_length(COALESCE(v_event ->> 'categoryKey', '')) > 100
         OR (v_event ? 'sourceKey' AND jsonb_typeof(v_event -> 'sourceKey') <> 'string')
         OR char_length(COALESCE(v_event ->> 'sourceKey', '')) > 200
         OR (v_event ? 'momentType' AND jsonb_typeof(v_event -> 'momentType') <> 'string')
         OR char_length(COALESCE(v_event ->> 'momentType', '')) > 100 THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_SCHEDULE_EVENT_INVALID'
          USING ERRCODE = '22023';
      END IF;
      BEGIN
        v_event_date := (v_event ->> 'date')::date;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_SCHEDULE_EVENT_INVALID'
          USING ERRCODE = '22023';
      END;
      IF to_char(v_event_date, 'YYYY-MM-DD') <> v_event ->> 'date' THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_SCHEDULE_EVENT_INVALID'
          USING ERRCODE = '22023';
      END IF;
    END LOOP;

    SELECT count(*)::integer, count(DISTINCT value ->> 'id')::integer
      INTO v_event_count, v_distinct_event_count
    FROM jsonb_array_elements(p_domain_mutation -> 'value');
    IF v_event_count <> v_distinct_event_count THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_SCHEDULE_EVENT_ID_DUPLICATE'
        USING ERRCODE = '22023';
    END IF;
    IF v_expected_present THEN
      SELECT count(*)::integer, count(DISTINCT value ->> 'id')::integer
        INTO v_event_count, v_distinct_event_count
      FROM jsonb_array_elements(p_domain_mutation -> 'expected');
      IF v_event_count <> v_distinct_event_count THEN
        RAISE EXCEPTION 'AMORA_ATOMIC_SCHEDULE_EXPECTED_ID_DUPLICATE'
          USING ERRCODE = '22023';
      END IF;
    END IF;

    SELECT journey.* INTO v_journey
    FROM public.wedding_journeys AS journey
    WHERE journey.couple_id = p_couple_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'AMORA_ATOMIC_JOURNEY_NOT_FOUND'
        USING ERRCODE = 'P0002';
    END IF;
    v_current_present := v_journey.progress ? v_progress_key;
    IF v_current_present IS DISTINCT FROM v_expected_present
       OR (
         v_expected_present
         AND v_journey.progress -> v_progress_key
             IS DISTINCT FROM p_domain_mutation -> 'expected'
       ) THEN
      v_effective_result := jsonb_build_object(
        'toolName', v_execution.tool_name,
        'toolOutput', jsonb_build_object(
          'error', 'domain_state_changed',
          'retryable', false
        ),
        'success', false,
        'displayMessage',
          '다른 일정 변경이 먼저 반영되어 이번 요청은 적용하지 않았어요. 현재 일정을 다시 확인해 주세요.'
      );
    ELSE
      UPDATE public.wedding_journeys
      SET progress = jsonb_set(
            progress,
            ARRAY[v_progress_key],
            p_domain_mutation -> 'value',
            true
          ),
          updated_at = now()
      WHERE couple_id = p_couple_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'AMORA_ATOMIC_TOOL_MUTATION_KIND_UNSUPPORTED'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.amora_tool_executions
  SET status = 'completed',
      result = v_effective_result,
      completed_at = now(),
      uncertain_at = NULL,
      failure_code = NULL,
      updated_at = now()
  WHERE couple_id = p_couple_id
    AND request_key = p_request_key
    AND operation_key = p_operation_key
    AND status = 'processing';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'AMORA_ATOMIC_TOOL_COMPLETION_RACE'
      USING ERRCODE = '40001';
  END IF;

  RETURN v_effective_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_amora_atomic_tool_execution(
  uuid, text, text, integer, text, jsonb, jsonb, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_amora_atomic_tool_execution(
  uuid, text, text, integer, text, jsonb, jsonb, jsonb
) TO service_role;

COMMENT ON COLUMN public.amora_chat_request_claims.tool_round_journal IS
  'Transient, service-only replay journal for at most two paid OpenAI tool rounds; excludes conversation input and requires encrypted reasoning.';
COMMENT ON FUNCTION public.finalize_amora_tool_round_receipt(
  uuid, uuid, uuid, text, integer, jsonb, boolean, text, bigint, boolean,
  text, text, integer, integer, integer, jsonb
) IS 'Atomically settles one paid non-terminal provider receipt and appends its bounded replay checkpoint.';

DO $journal_postchecks$
BEGIN
  IF to_regprocedure(
       'public.finalize_amora_tool_round_receipt(uuid,uuid,uuid,text,integer,jsonb,boolean,text,bigint,boolean,text,text,integer,integer,integer,jsonb)'
     ) IS NULL
     OR to_regprocedure(
       'public.get_amora_tool_round_journal(uuid,text,integer)'
     ) IS NULL
     OR to_regprocedure(
       'public.apply_amora_atomic_tool_execution(uuid,text,text,integer,text,jsonb,jsonb,jsonb)'
     ) IS NULL
     OR to_regprocedure(
       'public.claim_amora_tool_execution(uuid,text,text,text,text,integer,uuid,integer)'
     ) IS NULL
     OR has_function_privilege(
       'authenticated',
       'public.finalize_amora_tool_round_receipt(uuid,uuid,uuid,text,integer,jsonb,boolean,text,bigint,boolean,text,text,integer,integer,integer,jsonb)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.finalize_amora_tool_round_receipt(uuid,uuid,uuid,text,integer,jsonb,boolean,text,bigint,boolean,text,text,integer,integer,integer,jsonb)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.get_amora_tool_round_journal(uuid,text,integer)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.get_amora_tool_round_journal(uuid,text,integer)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.claim_amora_tool_execution(uuid,text,text,text,text,integer,uuid,integer)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.claim_amora_tool_execution(uuid,text,text,text,text,integer,uuid,integer)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.apply_amora_atomic_tool_execution(uuid,text,text,integer,text,jsonb,jsonb,jsonb)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.apply_amora_atomic_tool_execution(uuid,text,text,integer,text,jsonb,jsonb,jsonb)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'AMORA_TOOL_ROUND_JOURNAL_POSTCHECK_FAILED';
  END IF;
END;
$journal_postchecks$;

COMMIT;
