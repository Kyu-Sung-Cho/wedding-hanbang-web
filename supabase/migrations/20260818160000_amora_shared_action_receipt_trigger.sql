BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $preconditions$
DECLARE
  v_function_oid oid := to_regprocedure(
    'public.bind_amora_shared_action_application()'
  );
BEGIN
  IF v_function_oid IS NULL
     OR to_regclass('public.chat_messages') IS NULL
     OR to_regclass('public.amora_shared_action_application_claims') IS NULL
     OR to_regclass('public.amora_shared_action_acceptances') IS NULL
     OR to_regprocedure(
       'public.amora_shared_action_context(uuid,uuid,uuid,uuid,text,uuid)'
     ) IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc AS procedure
       WHERE procedure.oid = v_function_oid
         AND procedure.prosecdef
         AND procedure.proconfig @> ARRAY[
           'search_path=pg_catalog, public',
           'lock_timeout=5s',
           'statement_timeout=15s'
         ]
         AND pg_catalog.pg_get_functiondef(procedure.oid)
           LIKE '%AMORA_SHARED_ACTION_CONFIRMATION_INVALID%'
         AND pg_catalog.pg_get_functiondef(procedure.oid)
           LIKE '%confirmed_amora_action_id%'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_trigger AS trigger
       WHERE trigger.tgrelid = 'public.chat_messages'::regclass
         AND trigger.tgname = 'trg_bind_amora_shared_action_application'
         AND trigger.tgfoid = v_function_oid
         AND NOT trigger.tgisinternal
     ) THEN
    RAISE EXCEPTION
      'AMORA_SHARED_ACTION_RECEIPT_TRIGGER_PREREQUISITE_MISSING';
  END IF;
END
$preconditions$;

CREATE OR REPLACE FUNCTION public.bind_amora_shared_action_application()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_action_id uuid;
  v_source_message_id uuid;
  v_context jsonb;
  v_accepted_count integer := 0;
  v_bound integer;
  v_receipt_keys text[];
  v_response_origin text;
BEGIN
  IF jsonb_typeof(COALESCE(NEW.metadata, '{}'::jsonb)) <> 'object'
     OR NOT (
       COALESCE(NEW.metadata, '{}'::jsonb) ? 'confirmed_amora_action_id'
     ) THEN
    RETURN NEW;
  END IF;

  -- Canonical application finalizers persist an assistant receipt containing
  -- the confirmed capability UUID. It is a terminal server receipt, not a
  -- second user confirmation, so it must bypass only this confirmation binder.
  v_response_origin := NEW.metadata ->> 'response_origin';
  v_receipt_keys := CASE v_response_origin
    WHEN 'server_authoritative_first_use_action_application' THEN ARRAY[
      'client_request_id', 'client_visible_request_id',
      'in_reply_to_user_message_id', 'confirmed_amora_action_id',
      'question_scope', 'memory_eligible', 'memory_enqueue_requested',
      'amora_wedding_context_revision', 'amora_first_use_promotion_id',
      'toolResults', 'toolsUsed', 'persistence_terminal_source',
      'response_origin', 'provider_call_count'
    ]
    WHEN 'server_authoritative_provider_backed_add_action_application' THEN ARRAY[
      'client_request_id', 'client_visible_request_id',
      'in_reply_to_user_message_id', 'confirmed_amora_action_id',
      'source_amora_action_message_id', 'question_scope',
      'memory_eligible', 'memory_enqueue_requested',
      'amora_wedding_context_revision', 'toolResults', 'toolsUsed',
      'persistence_terminal_source', 'response_origin',
      'provider_call_count'
    ]
    ELSE NULL
  END;
  IF v_receipt_keys IS NOT NULL
     AND auth.role() = 'service_role'
     AND NEW.id IS NOT NULL
     AND NEW.couple_id IS NOT NULL
     AND NEW.sender_id IS NULL
     AND NEW.sender_type IS NOT DISTINCT FROM 'ai'
     AND NEW.sender_role IS NULL
     AND NEW.role IS NOT DISTINCT FROM 'assistant'
     AND NEW.visibility IS NOT DISTINCT FROM 'shared'
     AND NEW.stage_tag IS NULL
     AND NEW.specialist_type IS NOT DISTINCT FROM 'general'
     AND NEW.metadata ?& v_receipt_keys
     AND NEW.metadata - v_receipt_keys = '{}'::jsonb
     AND jsonb_typeof(NEW.metadata -> 'confirmed_amora_action_id') = 'string'
     AND COALESCE(NEW.metadata ->> 'confirmed_amora_action_id', '') ~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     AND jsonb_typeof(NEW.metadata -> 'in_reply_to_user_message_id') = 'string'
     AND COALESCE(NEW.metadata ->> 'in_reply_to_user_message_id', '') ~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     AND jsonb_typeof(NEW.metadata -> 'client_request_id') = 'string'
     AND jsonb_typeof(NEW.metadata -> 'client_visible_request_id') = 'string'
     AND NEW.metadata -> 'question_scope'
       IS NOT DISTINCT FROM to_jsonb('W0_wedding_core'::text)
     AND NEW.metadata -> 'memory_eligible' IS NOT DISTINCT FROM 'false'::jsonb
     AND NEW.metadata -> 'memory_enqueue_requested'
       IS NOT DISTINCT FROM 'false'::jsonb
     AND jsonb_typeof(NEW.metadata -> 'amora_wedding_context_revision') = 'number'
     AND NEW.metadata -> 'toolsUsed'
       IS NOT DISTINCT FROM '["add_amora_action"]'::jsonb
     AND NEW.metadata -> 'persistence_terminal_source'
       IS NOT DISTINCT FROM to_jsonb('server_mutation_receipts'::text)
     AND NEW.metadata -> 'provider_call_count' IS NOT DISTINCT FROM '0'::jsonb
     AND jsonb_typeof(NEW.metadata -> 'toolResults') = 'array'
     AND jsonb_array_length(NEW.metadata -> 'toolResults') = 1
     AND NEW.metadata #>> '{toolResults,0,toolName}' = 'add_amora_action'
     AND NEW.metadata #> '{toolResults,0,success}' = 'true'::jsonb
     AND NEW.content = NEW.metadata #>> '{toolResults,0,displayMessage}'
     AND (
       (
         v_response_origin = 'server_authoritative_first_use_action_application'
         AND jsonb_typeof(NEW.metadata -> 'amora_first_use_promotion_id') = 'string'
         AND COALESCE(NEW.metadata ->> 'amora_first_use_promotion_id', '') ~
           '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       )
       OR (
         v_response_origin =
           'server_authoritative_provider_backed_add_action_application'
         AND jsonb_typeof(NEW.metadata -> 'source_amora_action_message_id') = 'string'
         AND COALESCE(NEW.metadata ->> 'source_amora_action_message_id', '') ~
           '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       )
     ) THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS NULL
     OR NEW.couple_id IS NULL
     OR NEW.sender_id IS NULL
     OR NEW.sender_type IS NULL
     OR NEW.sender_type NOT IN ('bride', 'groom')
     OR NEW.role IS DISTINCT FROM 'user'
     OR NEW.visibility IS DISTINCT FROM 'shared'
     OR COALESCE(NEW.metadata ->> 'target', '') = 'partner'
     OR jsonb_typeof(NEW.metadata -> 'confirmed_amora_action_id')
       IS DISTINCT FROM 'string'
     OR COALESCE(NEW.metadata ->> 'confirmed_amora_action_id', '') !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_CONFIRMATION_INVALID'
      USING ERRCODE = '22023';
  END IF;
  v_action_id := (NEW.metadata ->> 'confirmed_amora_action_id')::uuid;

  SELECT source.id
    INTO v_source_message_id
  FROM public.chat_messages AS source
  WHERE source.couple_id = NEW.couple_id
    AND source.sender_id IS NULL
    AND source.sender_type = 'ai'
    AND source.role = 'assistant'
    AND source.visibility = 'shared'
    AND COALESCE(source.metadata ->> 'target', '') <> 'partner'
    AND source.metadata #>> '{pending_amora_action,actionId}'
      = v_action_id::text
  ORDER BY source.created_at DESC, source.id DESC
  LIMIT 1;
  IF v_source_message_id IS NULL THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_CONFIRMATION_INVALID'
      USING ERRCODE = '22023';
  END IF;

  v_context := public.amora_shared_action_context(
    v_action_id,
    NEW.couple_id,
    v_source_message_id,
    NEW.sender_id,
    'proposal_latest',
    NULL
  );

  IF v_context ->> 'policy' = 'couple' THEN
    IF EXISTS (
      SELECT 1
      FROM public.amora_shared_action_acceptances AS acceptance
      WHERE acceptance.couple_id = NEW.couple_id
        AND acceptance.source_message_id = v_source_message_id
        AND acceptance.action_id = v_action_id
        AND (
          acceptance.proposal_digest IS DISTINCT FROM v_context ->> 'proposalDigest'
          OR acceptance.roster_fingerprint IS DISTINCT FROM v_context ->> 'rosterFingerprint'
        )
    ) THEN
      RAISE EXCEPTION 'AMORA_SHARED_ACTION_PROPOSAL_CHANGED'
        USING ERRCODE = '55000';
    END IF;

    SELECT count(*)::integer
      INTO v_accepted_count
    FROM public.amora_shared_action_acceptances AS acceptance
    JOIN public.profiles AS profile
      ON profile.id = acceptance.user_id
     AND profile.couple_id = acceptance.couple_id
    JOIN public.couples AS couple ON couple.id = acceptance.couple_id
    WHERE acceptance.couple_id = NEW.couple_id
      AND acceptance.source_message_id = v_source_message_id
      AND acceptance.action_id = v_action_id
      AND acceptance.proposal_digest = v_context ->> 'proposalDigest'
      AND acceptance.roster_fingerprint = v_context ->> 'rosterFingerprint'
      AND acceptance.revoked_at IS NULL
      AND (
        (profile.role = 'bride' AND couple.bride_id = profile.id)
        OR (profile.role = 'groom' AND couple.groom_id = profile.id)
      );

    IF v_accepted_count < (v_context ->> 'requiredCount')::integer THEN
      RAISE EXCEPTION 'AMORA_SHARED_ACTION_APPROVAL_REQUIRED'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  UPDATE public.amora_shared_action_application_claims AS claim
     SET confirmation_message_id = NEW.id
   WHERE claim.couple_id = NEW.couple_id
     AND claim.source_message_id = v_source_message_id
     AND claim.action_id = v_action_id
     AND claim.claimed_by_user_id = NEW.sender_id
     AND claim.proposal_digest = v_context ->> 'proposalDigest'
     AND claim.roster_fingerprint = v_context ->> 'rosterFingerprint'
     AND claim.confirmation_message_id IS NULL
     AND claim.lease_expires_at > clock_timestamp();
  GET DIAGNOSTICS v_bound = ROW_COUNT;

  IF v_bound <> 1 THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_APPLICATION_CLAIM_INVALID'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.bind_amora_shared_action_application() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.bind_amora_shared_action_application()
  FROM PUBLIC, anon, authenticated, service_role;

DO $postchecks$
DECLARE
  v_function_oid oid := to_regprocedure(
    'public.bind_amora_shared_action_application()'
  );
BEGIN
  IF v_function_oid IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc AS procedure
       WHERE procedure.oid = v_function_oid
         AND procedure.prosecdef
         AND procedure.proowner = 'postgres'::regrole
         AND procedure.proconfig @> ARRAY[
           'search_path=pg_catalog, public',
           'lock_timeout=5s',
           'statement_timeout=15s'
         ]
         AND pg_catalog.pg_get_functiondef(procedure.oid)
           LIKE '%server_authoritative_first_use_action_application%'
         AND pg_catalog.pg_get_functiondef(procedure.oid)
           LIKE '%server_authoritative_provider_backed_add_action_application%'
     )
     OR has_function_privilege(
       'anon', 'public.bind_amora_shared_action_application()', 'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated', 'public.bind_amora_shared_action_application()', 'EXECUTE'
     )
     OR has_function_privilege(
       'service_role', 'public.bind_amora_shared_action_application()', 'EXECUTE'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_trigger AS trigger
       WHERE trigger.tgrelid = 'public.chat_messages'::regclass
         AND trigger.tgname = 'trg_bind_amora_shared_action_application'
         AND trigger.tgfoid = v_function_oid
         AND NOT trigger.tgisinternal
     ) THEN
    RAISE EXCEPTION
      'AMORA_SHARED_ACTION_RECEIPT_TRIGGER_POSTCHECK_FAILED';
  END IF;
END
$postchecks$;

COMMIT;
