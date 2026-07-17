-- Amora mutating-tool retry fence
--
-- Exact operation replays remain safe, but a failed/reclaimed chat request must
-- not let a later model attempt invent different write arguments under the
-- same request key. Bind every new tool claim to the current durable chat
-- attempt and fail closed on reclaimed attempts.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.amora_tool_executions
  ADD COLUMN IF NOT EXISTS pending_action_id uuid;

-- A normal chat claim must retain the exact durable user row that established
-- its intent. The legacy four-argument claim remains available during rolling
-- deploys, but it records NULL and therefore cannot authorize a new mutation.
ALTER TABLE public.amora_chat_request_claims
  ADD COLUMN IF NOT EXISTS user_message_id uuid;

DO $user_message_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.amora_chat_request_claims'::regclass
      AND constraint_row.conname = 'amora_chat_request_claims_user_message_id_fkey'
  ) THEN
    ALTER TABLE public.amora_chat_request_claims
      ADD CONSTRAINT amora_chat_request_claims_user_message_id_fkey
      FOREIGN KEY (user_message_id)
      REFERENCES public.chat_messages(id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;
END
$user_message_fk$;

ALTER TABLE public.amora_chat_request_claims
  VALIDATE CONSTRAINT amora_chat_request_claims_user_message_id_fkey;

-- The parent-row freshness lock below is sound only while every couple-bound
-- chat insert performs an immediate, validated FK check against couples.
DO $chat_parent_fk_precondition$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_state
    JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = constraint_state.conrelid
     AND attribute.attnum = ANY (constraint_state.conkey)
    WHERE constraint_state.contype = 'f'
      AND constraint_state.conrelid = 'public.chat_messages'::regclass
      AND constraint_state.confrelid = 'public.couples'::regclass
      AND constraint_state.convalidated
      AND NOT constraint_state.condeferrable
      AND attribute.attname = 'couple_id'
  ) THEN
    RAISE EXCEPTION 'AMORA_TOOL_FRESHNESS_CHAT_COUPLE_FK_REQUIRED';
  END IF;
END;
$chat_parent_fk_precondition$;

CREATE OR REPLACE FUNCTION public.claim_amora_chat_request(
  p_couple_id uuid,
  p_request_key text,
  p_user_id uuid,
  p_visibility text,
  p_user_message_id uuid
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
  v_profile_role text;
  v_expected_chat_prefix text := 'chat:' || p_user_id::text || ':';
  v_expected_greeting_key text := 'greeting:' || p_user_id::text;
  v_is_system_request boolean := p_request_key ~ '^(mediation|lifecycle):[0-9a-f]{64}$';
  v_is_chat_request boolean :=
    p_request_key LIKE v_expected_chat_prefix || '%'
    AND substring(p_request_key FROM char_length(v_expected_chat_prefix) + 1)
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_CHAT_CLAIM_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF p_couple_id IS NULL OR p_user_id IS NULL OR p_request_key IS NULL
     OR p_visibility NOT IN ('shared', 'bride_private', 'groom_private')
     OR NOT (
       p_request_key = v_expected_greeting_key
       OR v_is_system_request
       OR v_is_chat_request
     )
     OR (NOT v_is_chat_request AND p_user_message_id IS NOT NULL) THEN
    RAISE EXCEPTION 'AMORA_CHAT_CLAIM_INVALID_INPUT'
      USING ERRCODE = '22023';
  END IF;

  SELECT profile.role
    INTO v_profile_role
  FROM public.profiles AS profile
  WHERE profile.id = p_user_id
    AND profile.couple_id = p_couple_id;

  IF NOT FOUND
     OR (p_visibility = 'bride_private' AND v_profile_role <> 'bride')
     OR (p_visibility = 'groom_private' AND v_profile_role <> 'groom') THEN
    RAISE EXCEPTION 'AMORA_CHAT_CLAIM_SCOPE_DENIED'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_message_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.chat_messages AS message
       WHERE message.id = p_user_message_id
         AND message.couple_id = p_couple_id
         AND message.sender_id = p_user_id
         AND message.sender_type IN ('bride', 'groom')
         AND message.role = 'user'
         AND message.visibility = p_visibility
         AND COALESCE(message.metadata ->> 'target', '') <> 'partner'
     ) THEN
    -- The row id comes from an untrusted client request. Report a bounded
    -- conflict and leave no claim behind instead of turning this into a 5xx.
    RETURN jsonb_build_object('action', 'conflict');
  END IF;

  INSERT INTO public.amora_chat_request_claims (
    couple_id, request_key, user_id, visibility, user_message_id
  )
  VALUES (
    p_couple_id, p_request_key, p_user_id, p_visibility, p_user_message_id
  )
  ON CONFLICT (couple_id, request_key) DO NOTHING
  RETURNING * INTO v_claim;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'action', 'acquired',
      'attempt_count', v_claim.attempt_count,
      'reclaimed', false
    );
  END IF;

  SELECT claim.*
    INTO v_claim
  FROM public.amora_chat_request_claims AS claim
  WHERE claim.couple_id = p_couple_id
    AND claim.request_key = p_request_key
  FOR UPDATE;

  IF v_claim.visibility <> p_visibility
     OR v_claim.user_message_id IS DISTINCT FROM p_user_message_id
     OR (NOT v_is_system_request AND v_claim.user_id <> p_user_id) THEN
    RETURN jsonb_build_object('action', 'conflict');
  END IF;

  IF v_claim.status = 'completed' AND v_claim.message_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'action', 'completed',
      'message_id', v_claim.message_id,
      'attempt_count', v_claim.attempt_count
    );
  END IF;

  IF v_claim.status = 'processing'
     AND v_claim.claimed_at >= now() - interval '6 minutes' THEN
    RETURN jsonb_build_object(
      'action', 'in_progress',
      'retry_after_ms', 2000,
      'attempt_count', v_claim.attempt_count
    );
  END IF;

  UPDATE public.amora_chat_request_claims
  SET status = 'processing',
      user_id = CASE WHEN v_is_system_request THEN p_user_id ELSE user_id END,
      message_id = NULL,
      claimed_at = now(),
      completed_at = NULL,
      failed_at = NULL,
      failure_code = NULL,
      attempt_count = attempt_count + 1
  WHERE couple_id = p_couple_id
    AND request_key = p_request_key
  RETURNING * INTO v_claim;

  RETURN jsonb_build_object(
    'action', 'acquired',
    'attempt_count', v_claim.attempt_count,
    'reclaimed', true
  );
END;
$function$;

-- Expand/contract compatibility for application instances that have not yet
-- started sending the durable user-message binding. They can still answer,
-- but the tool claim below fails closed before any new mutation.
CREATE OR REPLACE FUNCTION public.claim_amora_chat_request(
  p_couple_id uuid,
  p_request_key text,
  p_user_id uuid,
  p_visibility text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
BEGIN
  RETURN public.claim_amora_chat_request(
    p_couple_id,
    p_request_key,
    p_user_id,
    p_visibility,
    NULL::uuid
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_amora_chat_request(uuid, text, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_amora_chat_request(uuid, text, uuid, text, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.claim_amora_chat_request(uuid, text, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_amora_chat_request(uuid, text, uuid, text)
  TO service_role;

-- One server-issued approval capability can authorize at most one durable
-- mutation for a couple, even when both partners submit it from different
-- chat request keys at the same time.
CREATE UNIQUE INDEX IF NOT EXISTS amora_tool_executions_one_pending_action_per_couple
  ON public.amora_tool_executions (couple_id, pending_action_id)
  WHERE pending_action_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.claim_amora_tool_execution(
  p_couple_id uuid,
  p_request_key text,
  p_operation_key text,
  p_tool_name text,
  p_input_digest text,
  p_request_attempt_count integer,
  p_pending_action_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_execution public.amora_tool_executions%ROWTYPE;
  v_request public.amora_chat_request_claims%ROWTYPE;
  v_latest_context_message_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_TOOL_CLAIM_SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;

  IF p_couple_id IS NULL
     OR p_request_key !~* '^chat:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR p_operation_key !~ '^[0-9a-f]{64}$'
     OR p_input_digest !~ '^[0-9a-f]{64}$'
     OR p_request_attempt_count IS NULL
     OR p_request_attempt_count < 1
     OR p_tool_name NOT IN (
       'update_budget', 'update_wedding_date', 'update_task_status', 'update_venue',
       'update_category_budget', 'apply_budget_plan', 'add_custom_category',
       'delete_category', 'reset_category', 'add_schedule_event',
       'update_schedule_event', 'delete_schedule_event', 'toggle_checklist_item',
       'add_amora_action', 'update_amora_action', 'log_wedding_event',
       'create_booking', 'cancel_booking'
     ) THEN
    RAISE EXCEPTION 'AMORA_TOOL_CLAIM_INVALID_INPUT' USING ERRCODE = '22023';
  END IF;

  -- This parent-row lock serializes all operation claims for one chat request
  -- and proves that this caller still owns the current attempt.
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

  SELECT execution.* INTO v_execution
  FROM public.amora_tool_executions AS execution
  WHERE execution.couple_id = p_couple_id
    AND execution.request_key = p_request_key
    AND execution.operation_key = p_operation_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_execution.tool_name <> p_tool_name
       OR v_execution.input_digest <> p_input_digest
       OR v_execution.pending_action_id IS DISTINCT FROM p_pending_action_id THEN
      RETURN jsonb_build_object('action', 'conflict');
    END IF;

    IF v_execution.status = 'completed' THEN
      RETURN jsonb_build_object('action', 'completed', 'result', v_execution.result);
    END IF;

    IF v_execution.status = 'uncertain' THEN
      RETURN jsonb_build_object('action', 'uncertain');
    END IF;

    IF v_execution.status = 'processing'
       AND v_execution.claimed_at < now() - interval '6 minutes' THEN
      UPDATE public.amora_tool_executions
      SET status = 'uncertain',
          uncertain_at = now(),
          failure_code = 'PROCESSING_LEASE_EXPIRED',
          updated_at = now()
      WHERE couple_id = p_couple_id
        AND request_key = p_request_key
        AND operation_key = p_operation_key
        AND status = 'processing';
      RETURN jsonb_build_object('action', 'uncertain');
    END IF;

    RETURN jsonb_build_object('action', 'in_progress');
  END IF;

  -- The action capability is couple-scoped rather than request-scoped. This
  -- lookup makes exact replays deterministic across partner accounts and
  -- request keys. The partial unique index below serializes the insert race.
  IF p_pending_action_id IS NOT NULL THEN
    SELECT execution.* INTO v_execution
    FROM public.amora_tool_executions AS execution
    WHERE execution.couple_id = p_couple_id
      AND execution.pending_action_id = p_pending_action_id
    FOR UPDATE;

    IF FOUND THEN
      IF v_execution.operation_key <> p_operation_key
         OR v_execution.tool_name <> p_tool_name
         OR v_execution.input_digest <> p_input_digest THEN
        RETURN jsonb_build_object('action', 'conflict');
      END IF;

      IF v_execution.status = 'completed' THEN
        RETURN jsonb_build_object('action', 'completed', 'result', v_execution.result);
      END IF;

      IF v_execution.status = 'uncertain' THEN
        RETURN jsonb_build_object('action', 'uncertain');
      END IF;

      IF v_execution.status = 'processing'
         AND v_execution.claimed_at < now() - interval '6 minutes' THEN
        UPDATE public.amora_tool_executions
        SET status = 'uncertain',
            uncertain_at = now(),
            failure_code = 'PROCESSING_LEASE_EXPIRED',
            updated_at = now()
        WHERE couple_id = v_execution.couple_id
          AND request_key = v_execution.request_key
          AND operation_key = v_execution.operation_key
          AND status = 'processing';
        RETURN jsonb_build_object('action', 'uncertain');
      END IF;

      RETURN jsonb_build_object('action', 'in_progress');
    END IF;
  END IF;

  -- A reclaimed attempt may only inspect/replay exact operations already in
  -- the ledger. To request a different mutation, the user must send a new
  -- client request id so intent is re-established explicitly.
  IF p_request_attempt_count > 1 THEN
    RETURN jsonb_build_object('action', 'retry_new_operation_blocked');
  END IF;

  -- Linearization point for a new mutation. chat_messages.couple_id has an
  -- immediate foreign key to this parent row, so FOR UPDATE conflicts with
  -- the key-share lock taken by a concurrent message insert. A message that
  -- started first commits before the query below; one that starts later waits
  -- until this mutation claim commits.
  PERFORM 1
  FROM public.couples AS couple
  WHERE couple.id = p_couple_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_request.user_message_id IS NULL
     OR v_request.visibility <> 'shared' THEN
    RETURN jsonb_build_object('action', 'stale_context');
  END IF;

  SELECT message.id
    INTO v_latest_context_message_id
  FROM public.chat_messages AS message
  WHERE message.couple_id = p_couple_id
    AND message.visibility = 'shared'
    AND COALESCE(message.metadata ->> 'target', '') <> 'partner'
  ORDER BY message.created_at DESC, message.id DESC
  LIMIT 1;

  IF v_latest_context_message_id IS DISTINCT FROM v_request.user_message_id
     OR NOT EXISTS (
       SELECT 1
       FROM public.chat_messages AS bound_message
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

  INSERT INTO public.amora_tool_executions (
    couple_id, request_key, operation_key, tool_name, input_digest,
    pending_action_id
  ) VALUES (
    p_couple_id, p_request_key, p_operation_key, p_tool_name, p_input_digest,
    p_pending_action_id
  )
  ON CONFLICT DO NOTHING
  RETURNING * INTO v_execution;

  IF FOUND THEN
    RETURN jsonb_build_object('action', 'acquired');
  END IF;

  -- A concurrent request won either the request-operation primary-key race or
  -- the pending-action unique-index race. Read the matching committed row via
  -- the applicable identity; `= NULL` must never turn a legacy exact replay
  -- into a false conflict.
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

  IF NOT FOUND
     OR v_execution.operation_key <> p_operation_key
     OR v_execution.tool_name <> p_tool_name
     OR v_execution.input_digest <> p_input_digest
     OR v_execution.pending_action_id IS DISTINCT FROM p_pending_action_id THEN
    RETURN jsonb_build_object('action', 'conflict');
  END IF;

  IF v_execution.status = 'completed' THEN
    RETURN jsonb_build_object('action', 'completed', 'result', v_execution.result);
  END IF;

  IF v_execution.status = 'uncertain' THEN
    RETURN jsonb_build_object('action', 'uncertain');
  END IF;

  RETURN jsonb_build_object('action', 'in_progress');
END;
$function$;

-- Existing application instances keep using the request-scoped six-argument
-- contract. NULL intentionally bypasses only the couple-wide action index;
-- all request-attempt and operation fences still run in the seven-argument
-- implementation above.
CREATE OR REPLACE FUNCTION public.claim_amora_tool_execution(
  p_couple_id uuid,
  p_request_key text,
  p_operation_key text,
  p_tool_name text,
  p_input_digest text,
  p_request_attempt_count integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
BEGIN
  RETURN public.claim_amora_tool_execution(
    p_couple_id,
    p_request_key,
    p_operation_key,
    p_tool_name,
    p_input_digest,
    p_request_attempt_count,
    NULL::uuid
  );
END;
$function$;

-- Expand/contract compatibility: production applies database migrations
-- before every web instance has restarted. Keep the five-argument signature
-- as a service-only wrapper that derives the currently locked request attempt;
-- it cannot bypass the retry fence because the six-argument function locks and
-- revalidates that exact attempt before admitting any mutation.
CREATE OR REPLACE FUNCTION public.claim_amora_tool_execution(
  p_couple_id uuid,
  p_request_key text,
  p_operation_key text,
  p_tool_name text,
  p_input_digest text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_attempt_count integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_TOOL_CLAIM_SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT claim.attempt_count
  INTO v_attempt_count
  FROM public.amora_chat_request_claims AS claim
  WHERE claim.couple_id = p_couple_id
    AND claim.request_key = p_request_key
    AND claim.status = 'processing';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('action', 'stale_attempt');
  END IF;

  RETURN public.claim_amora_tool_execution(
    p_couple_id,
    p_request_key,
    p_operation_key,
    p_tool_name,
    p_input_digest,
    v_attempt_count
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_amora_tool_execution(uuid, text, text, text, text, integer, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_amora_tool_execution(uuid, text, text, text, text, integer, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.claim_amora_tool_execution(uuid, text, text, text, text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_amora_tool_execution(uuid, text, text, text, text, integer)
  TO service_role;
REVOKE ALL ON FUNCTION public.claim_amora_tool_execution(uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_amora_tool_execution(uuid, text, text, text, text)
  TO service_role;

COMMENT ON COLUMN public.amora_tool_executions.pending_action_id IS
  'Optional server-issued approval capability. Couple-scoped uniqueness prevents cross-partner double application.';
COMMENT ON COLUMN public.amora_chat_request_claims.user_message_id IS
  'Exact durable normal-chat user row that establishes mutation freshness; NULL legacy/system claims cannot authorize a new mutation.';
COMMENT ON FUNCTION public.claim_amora_chat_request(uuid, text, uuid, text, uuid) IS
  'Service-only durable chat claim bound to one validated user message for DB-linearized mutation freshness.';
COMMENT ON FUNCTION public.claim_amora_chat_request(uuid, text, uuid, text) IS
  'Rolling-deploy compatibility claim without a user-message binding; answer-compatible but mutation-ineligible.';
COMMENT ON FUNCTION public.claim_amora_tool_execution(uuid, text, text, text, text, integer, uuid) IS
  'Service-only exact-retry ledger bound to the active request attempt, latest durable user context, and optional couple-wide pending action.';
COMMENT ON FUNCTION public.claim_amora_tool_execution(uuid, text, text, text, text, integer) IS
  'Rolling-deploy request-scoped wrapper for the seven-argument pending-action fence.';
COMMENT ON FUNCTION public.claim_amora_tool_execution(uuid, text, text, text, text) IS
  'Rolling-deploy compatibility wrapper; derives and revalidates the active request attempt in the fenced six-argument function.';

DO $postchecks$
BEGIN
  IF to_regprocedure(
    'public.claim_amora_chat_request(uuid,text,uuid,text,uuid)'
  ) IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_attribute AS attribute
       WHERE attribute.attrelid = 'public.amora_chat_request_claims'::regclass
         AND attribute.attname = 'user_message_id'
         AND NOT attribute.attisdropped
     ) THEN
    RAISE EXCEPTION 'AMORA_CHAT_USER_MESSAGE_BINDING_SCHEMA_POSTCHECK_FAILED';
  END IF;

  IF has_function_privilege(
       'authenticated',
       'public.claim_amora_chat_request(uuid,text,uuid,text,uuid)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.claim_amora_chat_request(uuid,text,uuid,text,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.claim_amora_chat_request(uuid,text,uuid,text)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.claim_amora_chat_request(uuid,text,uuid,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'AMORA_CHAT_USER_MESSAGE_BINDING_PRIVILEGE_POSTCHECK_FAILED';
  END IF;

  IF to_regprocedure(
    'public.claim_amora_tool_execution(uuid,text,text,text,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'AMORA_TOOL_RETRY_FENCE_COMPAT_SIGNATURE_MISSING';
  END IF;

  IF to_regprocedure(
    'public.claim_amora_tool_execution(uuid,text,text,text,text,integer)'
  ) IS NULL THEN
    RAISE EXCEPTION 'AMORA_TOOL_RETRY_FENCE_ATTEMPT_SIGNATURE_MISSING';
  END IF;

  IF to_regprocedure(
    'public.claim_amora_tool_execution(uuid,text,text,text,text,integer,uuid)'
  ) IS NULL THEN
    RAISE EXCEPTION 'AMORA_TOOL_RETRY_FENCE_PENDING_ACTION_SIGNATURE_MISSING';
  END IF;

  IF has_function_privilege(
       'authenticated',
       'public.claim_amora_tool_execution(uuid,text,text,text,text,integer)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.claim_amora_tool_execution(uuid,text,text,text,text,integer)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'AMORA_TOOL_RETRY_FENCE_PRIVILEGE_POSTCHECK_FAILED';
  END IF;

  IF has_function_privilege(
       'authenticated',
       'public.claim_amora_tool_execution(uuid,text,text,text,text,integer,uuid)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.claim_amora_tool_execution(uuid,text,text,text,text,integer,uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'AMORA_TOOL_PENDING_ACTION_PRIVILEGE_POSTCHECK_FAILED';
  END IF;

  IF has_function_privilege(
       'authenticated',
       'public.claim_amora_tool_execution(uuid,text,text,text,text)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.claim_amora_tool_execution(uuid,text,text,text,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'AMORA_TOOL_RETRY_FENCE_COMPAT_PRIVILEGE_POSTCHECK_FAILED';
  END IF;

  IF NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_attribute AS attribute
       WHERE attribute.attrelid = 'public.amora_tool_executions'::regclass
         AND attribute.attname = 'pending_action_id'
         AND NOT attribute.attisdropped
     )
     OR to_regclass(
       'public.amora_tool_executions_one_pending_action_per_couple'
     ) IS NULL THEN
    RAISE EXCEPTION 'AMORA_TOOL_PENDING_ACTION_SCHEMA_POSTCHECK_FAILED';
  END IF;
END;
$postchecks$;
