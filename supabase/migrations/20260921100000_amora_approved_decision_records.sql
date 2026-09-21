-- Approved decision-board records only. No private-to-shared promotion and no
-- journey, schedule or budget mutation. One member's confirmation is not joint consent.
-- Preserve the audited dispatcher by delegation; only the new mutation is added.
BEGIN;

CREATE OR REPLACE FUNCTION public.amora_shared_action_policy(
  p_tool_name text,
  p_tool_input jsonb
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT CASE
    WHEN p_tool_name IN (
      'create_booking',
      'cancel_booking',
      'delete_category',
      'reset_category',
      'delete_schedule_event',
      'update_amora_action'
    ) THEN 'blocked'
    WHEN jsonb_typeof(p_tool_input) IS DISTINCT FROM 'object' THEN 'blocked'
    WHEN p_tool_name IN (
      -- 예전 'couple' 목록. 이제 한 사람 확인으로 반영되고 상대에게 알림이 간다.
      'update_budget',
      'update_wedding_date',
      'update_venue',
      'apply_budget_plan',
      'log_wedding_event',
      'add_schedule_event',
      'update_schedule_event',
      'cancel_schedule_event',
      'restore_schedule_event',
      -- 원래부터 'single' 이던 것들.
      'update_task_status',
      'update_category_budget',
      'add_custom_category',
      'toggle_checklist_item',
      'add_amora_action',
      'add_decision_record'
    ) THEN 'single'
    ELSE 'blocked'
  END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_amora_tool_execution(p_couple_id uuid, p_request_key text, p_operation_key text, p_tool_name text, p_input_digest text, p_request_attempt_count integer, p_pending_action_id uuid, p_provider_call_index integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '5s'
 SET statement_timeout TO '15s'
AS $function$
DECLARE
  v_request public.amora_chat_request_claims%ROWTYPE;
  v_execution public.amora_tool_executions%ROWTYPE;
  v_authorized boolean := false;
  v_latest_context_message_id uuid;
  v_decision_source_id uuid;
  v_decision_context jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_TOOL_CLAIM_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF p_tool_name = 'add_decision_record' AND (
    p_pending_action_id IS NULL OR p_provider_call_index IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'AMORA_DECISION_APPROVAL_REQUIRED' USING ERRCODE = '42501';
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
       'add_amora_action', 'add_decision_record', 'update_amora_action', 'log_wedding_event',
       -- 2026-08-23: 이 둘이 목록에 없어서 아모라의 일정 취소·복원이 도입
       -- 이래로 한 번도 실행되지 못했다. 카드는 나오고, 사용자가 확인하고,
       -- 그다음 "같은 변경이 두 번 들어가지 않게 확인하는 중에 문제가 생겨서"
       -- 로 조용히 멈췄다. 은퇴한 `delete_schedule_event` 만 남아 있었다.
       'cancel_schedule_event', 'restore_schedule_event',
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

  -- A completed decision receipt must not cross a changed roster either.
  -- Reuse the exact canonical proposal/confirmation authorization before replay.
  IF p_tool_name = 'add_decision_record' THEN
    SELECT prior.id INTO v_decision_source_id FROM (
      SELECT message.id, lag(message.id) OVER (ORDER BY message.created_at,message.id) AS prior_id
      FROM public.chat_messages AS message WHERE message.couple_id=p_couple_id
        AND message.visibility='shared' AND COALESCE(message.metadata->>'target','') <> 'partner'
    ) AS ordered JOIN public.chat_messages AS prior ON prior.id=ordered.prior_id
    WHERE ordered.id=v_request.user_message_id
      AND prior.metadata #>> '{pending_amora_action,actionId}'=p_pending_action_id::text;
    v_decision_context := public.authorize_amora_shared_action_execution(
      p_pending_action_id,p_couple_id,v_decision_source_id,v_request.user_message_id,v_request.user_id
    );
    IF v_decision_context ->> 'tool' IS DISTINCT FROM p_tool_name
       OR v_decision_context ->> 'inputDigest' IS DISTINCT FROM p_input_digest
       OR v_decision_context ->> 'operationKey' IS DISTINCT FROM p_operation_key THEN
      RAISE EXCEPTION 'AMORA_DECISION_APPROVED_INPUT_MISMATCH' USING ERRCODE = '23514';
    END IF;
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

-- The legacy overload remains unchanged for every older tool. The new tool
-- always uses the strict atomic/pending overload, never legacy unapproved dispatch.
ALTER FUNCTION public.claim_amora_tool_execution(uuid,text,text,text,text,integer,uuid)
  RENAME TO claim_amora_tool_execution_pre_decision_record;
REVOKE ALL ON FUNCTION public.claim_amora_tool_execution_pre_decision_record(
  uuid,text,text,text,text,integer,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.claim_amora_tool_execution(
  p_couple_id uuid, p_request_key text, p_operation_key text, p_tool_name text,
  p_input_digest text, p_request_attempt_count integer, p_pending_action_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public SET lock_timeout = '5s' SET statement_timeout = '15s'
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_TOOL_CLAIM_SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_tool_name = 'add_decision_record' THEN
    RETURN public.claim_amora_tool_execution(
      p_couple_id,p_request_key,p_operation_key,p_tool_name,p_input_digest,
      p_request_attempt_count,p_pending_action_id,NULL::integer
    );
  END IF;
  RETURN public.claim_amora_tool_execution_pre_decision_record(
    p_couple_id,p_request_key,p_operation_key,p_tool_name,p_input_digest,
    p_request_attempt_count,p_pending_action_id
  );
END;
$function$;
ALTER FUNCTION public.claim_amora_tool_execution(uuid,text,text,text,text,integer,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_amora_tool_execution(uuid,text,text,text,text,integer,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_amora_tool_execution(uuid,text,text,text,text,integer,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_amora_shared_action_execution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_claim public.amora_chat_request_claims%ROWTYPE;
  v_source_message_id uuid;
  v_context jsonb;
  v_current_journey_revision bigint;
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.couple_id IS DISTINCT FROM OLD.couple_id
    OR NEW.request_key IS DISTINCT FROM OLD.request_key
    OR NEW.operation_key IS DISTINCT FROM OLD.operation_key
    OR NEW.tool_name IS DISTINCT FROM OLD.tool_name
    OR NEW.input_digest IS DISTINCT FROM OLD.input_digest
    OR NEW.pending_action_id IS DISTINCT FROM OLD.pending_action_id
    OR NEW.pending_action_journey_revision
      IS DISTINCT FROM OLD.pending_action_journey_revision
  ) THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_EXECUTION_IMMUTABLE'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE'
     AND NOT (
       OLD.status IS DISTINCT FROM 'completed'
       AND NEW.status = 'completed'
       AND jsonb_typeof(NEW.result -> 'success') = 'boolean'
       AND (NEW.result ->> 'success')::boolean
     ) THEN
    RETURN NEW;
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role'
     OR NEW.pending_action_id IS NULL
     OR (
       TG_OP = 'INSERT'
       AND NEW.status IS DISTINCT FROM 'processing'
     ) THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_EXECUTION_NOT_AUTHORIZED'
      USING ERRCODE = '42501';
  END IF;

  SELECT claim.*
    INTO v_claim
  FROM public.amora_chat_request_claims AS claim
  WHERE claim.couple_id = NEW.couple_id
    AND claim.request_key = NEW.request_key
    AND claim.status = 'processing'
    AND claim.visibility = 'shared'
    AND claim.user_message_id IS NOT NULL
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_EXECUTION_CLAIM_INVALID'
      USING ERRCODE = '55000';
  END IF;

  SELECT prior.id
    INTO v_source_message_id
  FROM (
    SELECT message.id,
           lag(message.id) OVER (
             ORDER BY message.created_at, message.id
           ) AS prior_id
    FROM public.chat_messages AS message
    WHERE message.couple_id = NEW.couple_id
      AND message.visibility = 'shared'
      AND COALESCE(message.metadata ->> 'target', '') <> 'partner'
  ) AS ordered
  JOIN public.chat_messages AS prior ON prior.id = ordered.prior_id
  WHERE ordered.id = v_claim.user_message_id
    AND prior.metadata #>> '{pending_amora_action,actionId}'
      = NEW.pending_action_id::text;

  IF v_source_message_id IS NULL THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_EXECUTION_CONTEXT_INVALID'
      USING ERRCODE = '55000';
  END IF;

  v_context := public.authorize_amora_shared_action_execution(
    NEW.pending_action_id,
    NEW.couple_id,
    v_source_message_id,
    v_claim.user_message_id,
    v_claim.user_id
  );

  IF v_context ->> 'tool' IS DISTINCT FROM NEW.tool_name
     OR v_context ->> 'inputDigest' IS DISTINCT FROM NEW.input_digest
     OR v_context ->> 'operationKey' IS DISTINCT FROM NEW.operation_key THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_EXECUTION_MISMATCH'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT journey.state_revision
      INTO v_current_journey_revision
    FROM public.wedding_journeys AS journey
    WHERE journey.couple_id = NEW.couple_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'AMORA_SHARED_ACTION_PROPOSAL_CHANGED'
        USING ERRCODE = '55000';
    END IF;

    IF NEW.tool_name IN (
      'update_budget',
      'update_wedding_date',
      'update_venue',
      'apply_budget_plan',
      'update_category_budget',
      'add_custom_category',
      'update_task_status',
      'add_schedule_event',
      'update_schedule_event',
      'cancel_schedule_event',
      'restore_schedule_event',
      'toggle_checklist_item',
      'log_wedding_event'
    ) THEN
      IF v_current_journey_revision IS DISTINCT FROM
           NEW.pending_action_journey_revision + 1
         OR NOT EXISTS (
           SELECT 1
           FROM public.amora_shared_action_journey_mutation_receipts AS receipt
           WHERE receipt.couple_id = NEW.couple_id
             AND receipt.request_key = NEW.request_key
             AND receipt.operation_key = NEW.operation_key
             AND receipt.action_id = NEW.pending_action_id
             AND receipt.source_message_id = v_source_message_id
             AND receipt.confirmation_message_id =
               v_claim.user_message_id
             AND receipt.expected_revision =
               NEW.pending_action_journey_revision
             AND receipt.applied_revision = v_current_journey_revision
         ) THEN
        RAISE EXCEPTION 'AMORA_SHARED_ACTION_PROPOSAL_CHANGED'
          USING ERRCODE = '55000';
      END IF;
    ELSIF NEW.tool_name IN ('add_amora_action', 'add_decision_record') THEN
      IF v_current_journey_revision IS DISTINCT FROM
           NEW.pending_action_journey_revision
         OR EXISTS (
           SELECT 1
           FROM public.amora_shared_action_journey_mutation_receipts AS receipt
           WHERE receipt.couple_id = NEW.couple_id
             AND receipt.request_key = NEW.request_key
             AND receipt.operation_key = NEW.operation_key
         ) THEN
        RAISE EXCEPTION 'AMORA_SHARED_ACTION_PROPOSAL_CHANGED'
          USING ERRCODE = '55000';
      END IF;
      IF NEW.tool_name = 'add_decision_record' AND NOT EXISTS (
        SELECT 1 FROM public.decision_nodes AS decision
        WHERE decision.id = NEW.pending_action_id
          AND decision.couple_id = NEW.couple_id
          AND decision.source = 'chat'
          AND decision.source_ref_id = NEW.pending_action_id
          AND decision.source_message_id = v_claim.user_message_id
          AND decision.visibility = 'shared'
          AND decision.metadata ->> 'origin' = 'amora_shared_decision_record'
          AND decision.metadata ->> 'actor_user_id' = v_claim.user_id::text
          AND NEW.result -> 'toolOutput' = jsonb_build_object(
            'verified', true,
            'decision', jsonb_build_object(
              'id', decision.id, 'title', decision.title,
              'status', decision.decision_type, 'memo', decision.reasoning,
              'category_key', decision.category, 'created_at', decision.created_at
            )
          )
      ) THEN
        RAISE EXCEPTION 'AMORA_DECISION_RECEIPT_MISSING' USING ERRCODE = '23514';
      END IF;
    ELSE
      RAISE EXCEPTION 'AMORA_SHARED_ACTION_BLOCKED'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.pending_action_journey_revision :=
      (v_context ->> 'journeyRevision')::bigint;
  ELSIF NEW.pending_action_journey_revision IS NULL THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_PROPOSAL_CHANGED'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.apply_amora_atomic_tool_execution_pre_shared_revision(
  uuid,text,text,integer,text,jsonb,jsonb,jsonb
) RENAME TO apply_amora_atomic_tool_execution_pre_decision_record;
REVOKE ALL ON FUNCTION public.apply_amora_atomic_tool_execution_pre_decision_record(
  uuid,text,text,integer,text,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.apply_amora_atomic_tool_execution_pre_shared_revision(
  p_couple_id uuid, p_request_key text, p_operation_key text,
  p_request_attempt_count integer, p_input_digest text, p_tool_input jsonb,
  p_domain_mutation jsonb, p_result jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public SET lock_timeout = '5s' SET statement_timeout = '15s'
AS $function$
DECLARE
  v_request public.amora_chat_request_claims%ROWTYPE;
  v_execution public.amora_tool_executions%ROWTYPE;
  v_decision public.decision_nodes%ROWTYPE;
  v_source_id uuid;
  v_context jsonb;
  v_record jsonb;
  v_result jsonb;
  v_actor_role text;
  v_revision bigint;
  v_rows integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_ATOMIC_TOOL_SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_domain_mutation ->> 'kind' IS DISTINCT FROM 'decision_record_insert' THEN
    RETURN public.apply_amora_atomic_tool_execution_pre_decision_record(
      p_couple_id,p_request_key,p_operation_key,p_request_attempt_count,
      p_input_digest,p_tool_input,p_domain_mutation,p_result
    );
  END IF;
  IF p_couple_id IS NULL OR p_request_key IS NULL
     OR COALESCE(p_operation_key,'') !~ '^[0-9a-f]{64}$'
     OR COALESCE(p_input_digest,'') !~ '^[0-9a-f]{64}$'
     OR p_request_attempt_count IS NULL OR p_request_attempt_count < 1
     OR jsonb_typeof(p_tool_input) IS DISTINCT FROM 'object'
     OR octet_length(p_tool_input::text) > 16384
     OR jsonb_typeof(p_domain_mutation) IS DISTINCT FROM 'object'
     OR octet_length(p_domain_mutation::text) > 16384
     OR p_domain_mutation - ARRAY['kind','record'] <> '{}'::jsonb
     OR jsonb_typeof(p_result) IS DISTINCT FROM 'object'
     OR octet_length(p_result::text) > 65536
     OR p_result - ARRAY['toolName','toolOutput','success','displayMessage'] <> '{}'::jsonb
     OR NOT (p_result ?& ARRAY['toolName','toolOutput','success','displayMessage'])
     OR p_result ->> 'toolName' IS DISTINCT FROM 'add_decision_record'
     OR p_result -> 'success' IS DISTINCT FROM 'true'::jsonb
     OR jsonb_typeof(p_result -> 'toolOutput') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_result -> 'displayMessage') IS DISTINCT FROM 'string'
     OR char_length(p_result ->> 'displayMessage') > 4000
     OR p_tool_input - ARRAY['title','status','memo','category_key'] <> '{}'::jsonb
     OR jsonb_typeof(p_tool_input -> 'title') IS DISTINCT FROM 'string'
     OR char_length(p_tool_input ->> 'title') NOT BETWEEN 1 AND 160
     OR btrim(p_tool_input ->> 'title') = ''
     OR jsonb_typeof(p_tool_input -> 'status') IS DISTINCT FROM 'string'
     OR p_tool_input ->> 'status' NOT IN ('exploring','considering','decided')
     OR (p_tool_input ? 'memo' AND (
       jsonb_typeof(p_tool_input -> 'memo') IS DISTINCT FROM 'string'
       OR char_length(p_tool_input ->> 'memo') > 1000
     ))
     OR (p_tool_input ? 'category_key' AND (
       jsonb_typeof(p_tool_input -> 'category_key') IS DISTINCT FROM 'string'
       OR p_tool_input ->> 'category_key' NOT IN (
         'general','meeting','venue','studio','dress','makeup','ring','hanbok','yedan',
         'honeymoon','houseware','housing','invitation','snap','shoes','bouquet','gift',
         'mc','ham','pyebaek'
       )
     )) THEN
    RAISE EXCEPTION 'AMORA_DECISION_INVALID_INPUT' USING ERRCODE = '22023';
  END IF;

  v_record := jsonb_build_object(
    'title', p_tool_input ->> 'title', 'decision_type', p_tool_input ->> 'status',
    'reasoning', p_tool_input ->> 'memo', 'category', COALESCE(p_tool_input ->> 'category_key','general')
  );
  IF p_domain_mutation -> 'record' IS DISTINCT FROM v_record THEN
    RAISE EXCEPTION 'AMORA_DECISION_INPUT_MISMATCH' USING ERRCODE = '23514';
  END IF;

  -- Keep the existing request -> execution -> authorization -> journey lock order.
  SELECT claim.* INTO v_request FROM public.amora_chat_request_claims AS claim
  WHERE claim.couple_id=p_couple_id AND claim.request_key=p_request_key FOR UPDATE;
  IF NOT FOUND OR v_request.status <> 'processing'
     OR v_request.attempt_count <> p_request_attempt_count
     OR v_request.visibility IS DISTINCT FROM 'shared'
     OR v_request.user_message_id IS NULL THEN
    RAISE EXCEPTION 'AMORA_ATOMIC_TOOL_CLAIM_STALE' USING ERRCODE = '40001';
  END IF;
  SELECT execution.* INTO v_execution FROM public.amora_tool_executions AS execution
  WHERE execution.couple_id=p_couple_id AND execution.request_key=p_request_key
    AND execution.operation_key=p_operation_key FOR UPDATE;
  IF NOT FOUND OR v_execution.input_digest IS DISTINCT FROM p_input_digest
     OR v_execution.tool_name IS DISTINCT FROM 'add_decision_record'
     OR NOT v_execution.atomic_dispatch
     OR v_execution.request_attempt_count IS DISTINCT FROM p_request_attempt_count
     OR v_execution.pending_action_id IS NULL THEN
    RAISE EXCEPTION 'AMORA_ATOMIC_TOOL_EXECUTION_MISMATCH' USING ERRCODE = '23514';
  END IF;
  IF v_execution.status NOT IN ('processing','completed') THEN
    RAISE EXCEPTION 'AMORA_ATOMIC_TOOL_EXECUTION_NOT_PROCESSING' USING ERRCODE = '55000';
  END IF;

  SELECT prior.id INTO v_source_id FROM (
    SELECT message.id, lag(message.id) OVER (ORDER BY message.created_at,message.id) AS prior_id
    FROM public.chat_messages AS message WHERE message.couple_id=p_couple_id
      AND message.visibility='shared' AND COALESCE(message.metadata->>'target','') <> 'partner'
  ) AS ordered JOIN public.chat_messages AS prior ON prior.id=ordered.prior_id
  WHERE ordered.id=v_request.user_message_id
    AND prior.metadata #>> '{pending_amora_action,actionId}'=v_execution.pending_action_id::text;
  v_context := public.authorize_amora_shared_action_execution(
    v_execution.pending_action_id,p_couple_id,v_source_id,v_request.user_message_id,v_request.user_id
  );
  IF v_context ->> 'tool' IS DISTINCT FROM 'add_decision_record'
     OR v_context -> 'input' IS DISTINCT FROM p_tool_input
     OR v_context ->> 'inputDigest' IS DISTINCT FROM p_input_digest
     OR v_context ->> 'operationKey' IS DISTINCT FROM p_operation_key THEN
    RAISE EXCEPTION 'AMORA_DECISION_APPROVED_INPUT_MISMATCH' USING ERRCODE = '23514';
  END IF;
  IF v_execution.status = 'completed' THEN RETURN v_execution.result; END IF;
  SELECT journey.state_revision INTO v_revision FROM public.wedding_journeys AS journey
  WHERE journey.couple_id=p_couple_id FOR UPDATE;
  IF NOT FOUND OR v_revision IS DISTINCT FROM v_execution.pending_action_journey_revision THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_PROPOSAL_CHANGED' USING ERRCODE = '55000';
  END IF;
  -- authorize가 현재 couple 행을 이미 잠갔다. reset/join은 profile -> couple
  -- 순서로 잠근 뒤에만 소속을 바꾸므로 여기서 profile 행 잠금을 더 잡으면
  -- 역순 대기가 생긴다. 현재 소속/역할 재검증은 읽기로 유지한다.
  SELECT profile.role INTO v_actor_role FROM public.profiles AS profile
  WHERE profile.id=v_request.user_id AND profile.couple_id=p_couple_id;
  IF v_actor_role IS NULL OR v_actor_role NOT IN ('bride','groom') THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_SCOPE_DENIED' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.decision_nodes(
    id,couple_id,title,decision_type,reasoning,category,source,source_ref_id,
    source_message_id,source_actor_role,visibility,user_confirmed_at,decided_at,metadata
  ) VALUES (
    v_execution.pending_action_id,p_couple_id,v_record->>'title',v_record->>'decision_type',
    v_record->>'reasoning',v_record->>'category','chat',v_execution.pending_action_id,
    v_request.user_message_id,v_actor_role,'shared',now(),
    CASE WHEN v_record->>'decision_type'='decided' THEN now() ELSE NULL END,
    jsonb_build_object('origin','amora_shared_decision_record','actor_user_id',v_request.user_id,
      'proposal_message_id',v_source_id,'operation_key',p_operation_key)
  ) RETURNING * INTO v_decision;

  -- Never trust the caller/model's display text, identifier or optimistic receipt.
  v_result := jsonb_build_object(
    'toolName','add_decision_record','success',true,
    'displayMessage','확인한 내용을 함께 보는 결정 기록에 저장했어요.',
    'toolOutput',jsonb_build_object('verified',true,'decision',jsonb_build_object(
      'id',v_decision.id,'title',v_decision.title,'status',v_decision.decision_type,
      'memo',v_decision.reasoning,'category_key',v_decision.category,'created_at',v_decision.created_at
    ))
  );
  UPDATE public.amora_tool_executions SET status='completed',result=v_result,
    completed_at=now(),updated_at=now(),failure_code=NULL
  WHERE couple_id=p_couple_id AND request_key=p_request_key AND operation_key=p_operation_key
    AND status='processing';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'AMORA_ATOMIC_TOOL_COMPLETION_RACE' USING ERRCODE = '40001';
  END IF;
  RETURN v_result;
END;
$function$;
ALTER FUNCTION public.apply_amora_atomic_tool_execution_pre_shared_revision(
  uuid,text,text,integer,text,jsonb,jsonb,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.apply_amora_atomic_tool_execution_pre_shared_revision(
  uuid,text,text,integer,text,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.claim_amora_tool_execution(uuid,text,text,text,text,integer,uuid,integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_amora_tool_execution(uuid,text,text,text,text,integer,uuid,integer)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_amora_tool_execution(uuid,text,text,text,text,integer,uuid,integer) TO service_role;
COMMIT;
