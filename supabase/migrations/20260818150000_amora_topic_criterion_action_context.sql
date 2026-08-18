BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- A topic may say that a shared criterion accompanied an action only when the
-- server-authoritative shared-action transaction can prove the exact proposal,
-- confirmation, current criterion receipt, topic, and action revision. The
-- criterion text itself stays in its canonical decision row; action metadata
-- carries only the immutable join receipt.
CREATE OR REPLACE FUNCTION public.seal_amora_topic_criterion_action_context_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_context_couple_id text := current_setting(
    'hanbang.amora_shared_action_couple_id',
    true
  );
  v_request_key text := current_setting(
    'hanbang.amora_shared_action_request_key',
    true
  );
  v_operation_key text := current_setting(
    'hanbang.amora_shared_action_operation_key',
    true
  );
  v_pending_action_id text := current_setting(
    'hanbang.amora_shared_action_action_id',
    true
  );
  v_expected_revision text := current_setting(
    'hanbang.amora_shared_action_expected_revision',
    true
  );
  v_execution record;
  v_confirmation_message_id uuid;
  v_actor_user_id uuid;
  v_source_message_id uuid;
  v_source public.chat_messages%ROWTYPE;
  v_criterion_decision_id_text text;
  v_current_criterion jsonb;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.metadata -> 'amora_topic_criterion_context_v1'
         IS DISTINCT FROM
       OLD.metadata -> 'amora_topic_criterion_context_v1' THEN
      RAISE EXCEPTION 'AMORA_TOPIC_CRITERION_ACTION_CONTEXT_IMMUTABLE'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.metadata ? 'amora_topic_criterion_context_v1' THEN
    RAISE EXCEPTION 'AMORA_TOPIC_CRITERION_ACTION_CONTEXT_INJECTION'
      USING ERRCODE = '42501';
  END IF;

  -- Ordinary or unrelated inserts do not gain a personalization claim merely
  -- because they have an action-like shape. Only the atomic shared-action
  -- execution context may continue below.
  IF COALESCE(v_context_couple_id, '') !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR COALESCE(v_pending_action_id, '') !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR COALESCE(v_request_key, '') = ''
     OR COALESCE(v_operation_key, '') !~ '^[a-f0-9]{64}$'
     OR COALESCE(v_expected_revision, '') !~ '^(0|[1-9][0-9]{0,15})$'
  THEN
    RETURN NEW;
  END IF;

  SELECT execution.tool_name,
         execution.status,
         execution.pending_action_id,
         execution.pending_action_journey_revision
    INTO v_execution
  FROM public.amora_tool_executions AS execution
  WHERE execution.couple_id = v_context_couple_id::uuid
    AND execution.request_key = v_request_key
    AND execution.operation_key = v_operation_key
    AND execution.pending_action_id = v_pending_action_id::uuid
  FOR SHARE;
  IF NOT FOUND
     OR v_execution.tool_name IS DISTINCT FROM 'add_amora_action'
     OR v_execution.status IS DISTINCT FROM 'processing'
     OR v_execution.pending_action_journey_revision IS DISTINCT FROM
       v_expected_revision::bigint THEN
    RETURN NEW;
  END IF;

  SELECT claim.user_message_id, claim.user_id
    INTO v_confirmation_message_id, v_actor_user_id
  FROM public.amora_chat_request_claims AS claim
  WHERE claim.couple_id = v_context_couple_id::uuid
    AND claim.request_key = v_request_key
    AND claim.status = 'processing'
    AND claim.visibility = 'shared'
    AND claim.user_message_id IS NOT NULL
  FOR SHARE;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT application.source_message_id
    INTO v_source_message_id
  FROM public.amora_shared_action_application_claims AS application
  WHERE application.couple_id = v_context_couple_id::uuid
    AND application.action_id = v_pending_action_id::uuid
    AND application.confirmation_message_id = v_confirmation_message_id
    AND application.claimed_by_user_id = v_actor_user_id
  FOR SHARE;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT source.*
    INTO v_source
  FROM public.chat_messages AS source
  WHERE source.id = v_source_message_id
    AND source.couple_id = v_context_couple_id::uuid
  FOR SHARE;
  IF NOT FOUND
     OR v_source.sender_id IS NOT NULL
     OR v_source.sender_type IS DISTINCT FROM 'ai'
     OR v_source.sender_role IS NOT NULL
     OR v_source.role IS DISTINCT FROM 'assistant'
     OR v_source.visibility IS DISTINCT FROM 'shared'
     OR COALESCE(v_source.metadata ->> 'target', '') = 'partner'
     OR v_source.metadata -> 'amora_add_action_proposal_origin_v1'
       IS DISTINCT FROM to_jsonb('ordinary_provider'::text)
     OR v_source.metadata -> 'question_scope'
       IS DISTINCT FROM to_jsonb('W0_wedding_core'::text)
     OR v_source.metadata ? 'response_origin'
     OR v_source.metadata ? 'provider_call_count'
     OR v_source.metadata ? 'persistence_terminal_source'
     OR v_source.metadata ? 'amora_first_use_grounding'
     OR v_source.metadata ? 'amora_first_use_action_promotion_v1'
     OR v_source.metadata ? 'amora_first_use_promotion_id'
     OR v_source.metadata ? 'amora_schedule_care_follow_up_v1'
     OR v_source.metadata ? 'amora_schedule_care_action_draft_v1'
     OR v_source.content IS DISTINCT FROM
       v_source.metadata #>> '{pending_amora_action,confirmation}'
     OR v_source.metadata #>> '{pending_amora_action,actionId}'
       IS DISTINCT FROM v_pending_action_id
     OR v_source.metadata #>> '{pending_amora_action,tool}'
       IS DISTINCT FROM 'add_amora_action'
     OR v_source.metadata -> 'pending_amora_action_journey_revision'
       IS DISTINCT FROM to_jsonb(v_expected_revision::bigint)
     OR v_source.metadata -> 'amora_wedding_context_revision'
       IS DISTINCT FROM to_jsonb(v_expected_revision::bigint)
     OR jsonb_typeof(
       v_source.metadata #> '{pending_amora_action,input}'
     ) IS DISTINCT FROM 'object'
     OR NEW.couple_id IS DISTINCT FROM v_context_couple_id::uuid
     OR NEW.category_key IS NULL
     OR NEW.category_key NOT IN (
       'meeting', 'venue', 'studio', 'dress', 'makeup', 'ring', 'hanbok',
       'yedan', 'honeymoon', 'houseware', 'housing', 'invitation', 'snap',
       'shoes', 'bouquet', 'gift', 'mc', 'ham', 'pyebaek'
     )
     OR v_source.metadata #>> '{pending_amora_action,input,category_key}'
       IS DISTINCT FROM NEW.category_key
     OR NEW.first_use_promotion_id IS NOT NULL
     OR NEW.follow_up_revision IS DISTINCT FROM 1 THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(
       v_source.metadata -> 'amora_couple_criterion_decision_id'
     ) IS DISTINCT FROM 'string' THEN
    RETURN NEW;
  END IF;
  v_criterion_decision_id_text :=
    v_source.metadata ->> 'amora_couple_criterion_decision_id';
  IF COALESCE(v_criterion_decision_id_text, '') !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RETURN NEW;
  END IF;

  v_current_criterion := public.read_amora_couple_core_criterion_v1(
    v_context_couple_id::uuid,
    v_actor_user_id
  );
  IF v_current_criterion -> 'linked' IS DISTINCT FROM 'true'::jsonb
     OR jsonb_typeof(v_current_criterion -> 'current')
       IS DISTINCT FROM 'object'
     OR v_current_criterion #>> '{current,decisionId}'
       IS DISTINCT FROM v_criterion_decision_id_text THEN
    RETURN NEW;
  END IF;

  NEW.metadata := NEW.metadata || jsonb_build_object(
    'amora_topic_criterion_context_v1',
    jsonb_build_object(
      'version', 1,
      'scope', 'couple',
      'criterionDecisionId', v_criterion_decision_id_text::uuid,
      'topicKey', NEW.category_key,
      'affects', 'action',
      'sourceMessageId', v_source_message_id,
      'sourceJourneyRevision', v_expected_revision::bigint,
      'actionRevision', NEW.follow_up_revision
    )
  );
  RETURN NEW;
END
$function$;

ALTER FUNCTION public.seal_amora_topic_criterion_action_context_v1()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.seal_amora_topic_criterion_action_context_v1()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_seal_amora_topic_criterion_action_context_v1
  ON public.amora_actions;
CREATE TRIGGER trg_seal_amora_topic_criterion_action_context_v1
  BEFORE INSERT OR UPDATE ON public.amora_actions
  FOR EACH ROW
  EXECUTE FUNCTION public.seal_amora_topic_criterion_action_context_v1();

COMMENT ON FUNCTION public.seal_amora_topic_criterion_action_context_v1() IS
  'Seals only a current confirmed couple-criterion prompt-context receipt onto the exact server-authoritative categorized action. Criterion text is never copied.';

COMMIT;
