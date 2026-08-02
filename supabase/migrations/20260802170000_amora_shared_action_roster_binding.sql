BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.amora_shared_action_roster_bindings (
  source_message_id uuid PRIMARY KEY,
  action_id uuid NOT NULL,
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  bride_id uuid,
  groom_id uuid,
  required_count smallint NOT NULL CHECK (required_count IN (1, 2)),
  roster_fingerprint text NOT NULL CHECK (
    roster_fingerprint ~ '^[a-f0-9]{32}$'
  ),
  initial_proposal_digest text NOT NULL CHECK (
    initial_proposal_digest ~ '^[a-f0-9]{64}$'
  ),
  proposal_digest text NOT NULL CHECK (
    proposal_digest ~ '^[a-f0-9]{64}$'
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (couple_id, source_message_id, action_id),
  CHECK (
    (required_count = 1 AND num_nonnulls(bride_id, groom_id) = 1)
    OR (
      required_count = 2
      AND bride_id IS NOT NULL
      AND groom_id IS NOT NULL
      AND bride_id <> groom_id
    )
  )
);

ALTER TABLE public.amora_shared_action_roster_bindings OWNER TO postgres;
ALTER TABLE public.amora_shared_action_roster_bindings
  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.amora_shared_action_roster_bindings
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.amora_shared_action_current_roster(
  p_couple_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_raw_bride_id uuid;
  v_raw_groom_id uuid;
  v_bride_id uuid;
  v_groom_id uuid;
  v_required_count smallint;
  v_roster_fingerprint text;
BEGIN
  IF p_couple_id IS NULL THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_PROPOSAL_CHANGED'
      USING ERRCODE = '55000';
  END IF;

  SELECT couple.bride_id, couple.groom_id
    INTO v_raw_bride_id, v_raw_groom_id
  FROM public.couples AS couple
  WHERE couple.id = p_couple_id
  FOR UPDATE;

  IF NOT FOUND
     OR (
       v_raw_bride_id IS NOT NULL
       AND v_raw_bride_id = v_raw_groom_id
     ) THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_PROPOSAL_CHANGED'
      USING ERRCODE = '55000';
  END IF;

  v_bride_id := CASE
    WHEN public.is_current_couple_member(v_raw_bride_id, p_couple_id)
      THEN v_raw_bride_id
    ELSE NULL
  END;
  v_groom_id := CASE
    WHEN public.is_current_couple_member(v_raw_groom_id, p_couple_id)
      THEN v_raw_groom_id
    ELSE NULL
  END;
  IF v_bride_id IS NULL AND v_groom_id IS NULL THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_PROPOSAL_CHANGED'
      USING ERRCODE = '55000';
  END IF;

  v_required_count := CASE
    WHEN v_bride_id IS NOT NULL AND v_groom_id IS NOT NULL THEN 2
    ELSE 1
  END;
  v_roster_fingerprint := md5(
    COALESCE(v_bride_id::text, '-') || ':' ||
    COALESCE(v_groom_id::text, '-')
  );

  RETURN jsonb_build_object(
    'brideId', v_bride_id,
    'groomId', v_groom_id,
    'requiredCount', v_required_count,
    'rosterFingerprint', v_roster_fingerprint
  );
END;
$function$;

ALTER FUNCTION public.amora_shared_action_current_roster(uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.amora_shared_action_current_roster(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.amora_shared_action_bound_proposal_digest(
  p_initial_proposal_digest text,
  p_couple_id uuid,
  p_source_message_id uuid,
  p_action_id uuid,
  p_bride_id uuid,
  p_groom_id uuid,
  p_required_count smallint,
  p_roster_fingerprint text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'schemaVersion', 1,
          'initialProposalDigest', p_initial_proposal_digest,
          'coupleId', p_couple_id,
          'sourceMessageId', p_source_message_id,
          'actionId', p_action_id,
          'brideId', p_bride_id,
          'groomId', p_groom_id,
          'requiredCount', p_required_count,
          'rosterFingerprint', p_roster_fingerprint
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
$function$;

ALTER FUNCTION public.amora_shared_action_bound_proposal_digest(
  text, uuid, uuid, uuid, uuid, uuid, smallint, text
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.amora_shared_action_bound_proposal_digest(
  text, uuid, uuid, uuid, uuid, uuid, smallint, text
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.bind_amora_shared_action_roster()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_action jsonb;
  v_action_id uuid;
  v_revision_json jsonb;
  v_journey_revision bigint;
  v_roster jsonb;
  v_bride_id uuid;
  v_groom_id uuid;
  v_required_count smallint;
  v_roster_fingerprint text;
  v_initial_proposal_digest text;
  v_proposal_digest text;
BEGIN
  IF jsonb_typeof(COALESCE(NEW.metadata, '{}'::jsonb)) <> 'object'
     OR NOT COALESCE(NEW.metadata, '{}'::jsonb) ? 'pending_amora_action'
     OR NEW.sender_id IS NOT NULL
     OR NEW.sender_type IS DISTINCT FROM 'ai'
     OR NEW.role IS DISTINCT FROM 'assistant'
     OR NEW.visibility IS DISTINCT FROM 'shared'
     OR COALESCE(NEW.metadata ->> 'target', '') = 'partner' THEN
    RETURN NEW;
  END IF;

  v_action := NEW.metadata -> 'pending_amora_action';
  v_revision_json :=
    NEW.metadata -> 'pending_amora_action_journey_revision';
  IF NEW.id IS NULL
     OR NEW.couple_id IS NULL
     OR jsonb_typeof(v_action) IS DISTINCT FROM 'object'
     OR COALESCE(v_action ->> 'actionId', '') !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR jsonb_typeof(v_revision_json) IS DISTINCT FROM 'number'
     OR COALESCE(v_revision_json #>> '{}', '') !~
       '^(0|[1-9][0-9]{0,15})$' THEN
    RETURN NEW;
  END IF;

  v_action_id := (v_action ->> 'actionId')::uuid;
  v_journey_revision := (v_revision_json #>> '{}')::bigint;
  IF v_journey_revision > 9007199254740991 THEN
    RETURN NEW;
  END IF;

  v_roster := public.amora_shared_action_current_roster(NEW.couple_id);
  v_bride_id := NULLIF(v_roster ->> 'brideId', '')::uuid;
  v_groom_id := NULLIF(v_roster ->> 'groomId', '')::uuid;
  v_required_count := (v_roster ->> 'requiredCount')::smallint;
  v_roster_fingerprint := v_roster ->> 'rosterFingerprint';
  v_initial_proposal_digest := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'pending_amora_action', v_action,
          'pending_amora_action_journey_revision', v_journey_revision
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  v_proposal_digest := public.amora_shared_action_bound_proposal_digest(
    v_initial_proposal_digest,
    NEW.couple_id,
    NEW.id,
    v_action_id,
    v_bride_id,
    v_groom_id,
    v_required_count,
    v_roster_fingerprint
  );

  INSERT INTO public.amora_shared_action_roster_bindings(
    source_message_id,
    action_id,
    couple_id,
    bride_id,
    groom_id,
    required_count,
    roster_fingerprint,
    initial_proposal_digest,
    proposal_digest
  ) VALUES (
    NEW.id,
    v_action_id,
    NEW.couple_id,
    v_bride_id,
    v_groom_id,
    v_required_count,
    v_roster_fingerprint,
    v_initial_proposal_digest,
    v_proposal_digest
  );

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.bind_amora_shared_action_roster()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.bind_amora_shared_action_roster()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_bind_amora_shared_action_roster
  ON public.chat_messages;
CREATE TRIGGER trg_bind_amora_shared_action_roster
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.bind_amora_shared_action_roster();

CREATE OR REPLACE FUNCTION public.reject_amora_shared_action_roster_rewrite()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '5s'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF pg_trigger_depth() < 2 THEN
      RAISE EXCEPTION 'AMORA_SHARED_ACTION_ROSTER_BINDING_IMMUTABLE'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE'
     AND NOT EXISTS (
       SELECT 1
       FROM public.couples AS couple
       WHERE couple.id = OLD.couple_id
     ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'AMORA_SHARED_ACTION_ROSTER_BINDING_IMMUTABLE'
    USING ERRCODE = '55000';
END;
$function$;

ALTER FUNCTION public.reject_amora_shared_action_roster_rewrite()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reject_amora_shared_action_roster_rewrite()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_reject_amora_shared_action_roster_rewrite
  ON public.amora_shared_action_roster_bindings;
CREATE TRIGGER trg_reject_amora_shared_action_roster_rewrite
  BEFORE INSERT OR UPDATE OR DELETE
  ON public.amora_shared_action_roster_bindings
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_amora_shared_action_roster_rewrite();

DO $rename_context$
BEGIN
  IF to_regprocedure(
       'public.amora_shared_action_context_pre_roster_binding(uuid,uuid,uuid,uuid,text,uuid)'
     ) IS NULL THEN
    IF to_regprocedure(
         'public.amora_shared_action_context(uuid,uuid,uuid,uuid,text,uuid)'
       ) IS NULL THEN
      RAISE EXCEPTION 'AMORA_SHARED_ACTION_CONTEXT_MISSING';
    END IF;
    ALTER FUNCTION public.amora_shared_action_context(
      uuid, uuid, uuid, uuid, text, uuid
    ) RENAME TO amora_shared_action_context_pre_roster_binding;
  END IF;
END
$rename_context$;

ALTER FUNCTION public.amora_shared_action_context_pre_roster_binding(
  uuid, uuid, uuid, uuid, text, uuid
) OWNER TO postgres;
REVOKE ALL ON FUNCTION
  public.amora_shared_action_context_pre_roster_binding(
    uuid, uuid, uuid, uuid, text, uuid
  ) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.amora_shared_action_context(
  p_action_id uuid,
  p_couple_id uuid,
  p_source_message_id uuid,
  p_user_id uuid,
  p_context_mode text,
  p_confirmation_message_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_context jsonb;
  v_roster jsonb;
  v_binding public.amora_shared_action_roster_bindings%ROWTYPE;
  v_bride_id uuid;
  v_groom_id uuid;
  v_required_count smallint;
  v_roster_fingerprint text;
  v_proposal_digest text;
BEGIN
  v_context := public.amora_shared_action_context_pre_roster_binding(
    p_action_id,
    p_couple_id,
    p_source_message_id,
    p_user_id,
    p_context_mode,
    p_confirmation_message_id
  );
  v_roster := public.amora_shared_action_current_roster(p_couple_id);
  v_bride_id := NULLIF(v_roster ->> 'brideId', '')::uuid;
  v_groom_id := NULLIF(v_roster ->> 'groomId', '')::uuid;
  v_required_count := (v_roster ->> 'requiredCount')::smallint;
  v_roster_fingerprint := v_roster ->> 'rosterFingerprint';

  SELECT binding.*
    INTO v_binding
  FROM public.amora_shared_action_roster_bindings AS binding
  WHERE binding.source_message_id = p_source_message_id;

  IF NOT FOUND
     OR v_binding.action_id IS DISTINCT FROM p_action_id
     OR v_binding.couple_id IS DISTINCT FROM p_couple_id
     OR v_binding.bride_id IS DISTINCT FROM v_bride_id
     OR v_binding.groom_id IS DISTINCT FROM v_groom_id
     OR v_binding.required_count IS DISTINCT FROM v_required_count
     OR v_binding.roster_fingerprint IS DISTINCT FROM v_roster_fingerprint
     OR v_binding.initial_proposal_digest
       IS DISTINCT FROM v_context ->> 'proposalDigest' THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_PROPOSAL_CHANGED'
      USING ERRCODE = '55000';
  END IF;

  v_proposal_digest := public.amora_shared_action_bound_proposal_digest(
    v_binding.initial_proposal_digest,
    v_binding.couple_id,
    v_binding.source_message_id,
    v_binding.action_id,
    v_binding.bride_id,
    v_binding.groom_id,
    v_binding.required_count,
    v_binding.roster_fingerprint
  );
  IF v_binding.proposal_digest IS DISTINCT FROM v_proposal_digest THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_PROPOSAL_CHANGED'
      USING ERRCODE = '55000';
  END IF;

  RETURN v_context || jsonb_build_object(
    'proposalDigest', v_binding.proposal_digest,
    'rosterFingerprint', v_binding.roster_fingerprint,
    'requiredCount', v_binding.required_count,
    'partnerLinked', v_binding.required_count = 2
  );
END;
$function$;

ALTER FUNCTION public.amora_shared_action_context(
  uuid, uuid, uuid, uuid, text, uuid
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.amora_shared_action_context(
  uuid, uuid, uuid, uuid, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.advance_wedding_journey_state_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_guard_couple text :=
    NULLIF(current_setting(
      'hanbang.amora_shared_action_couple_id', true
    ), '');
  v_guard_request text :=
    NULLIF(current_setting(
      'hanbang.amora_shared_action_request_key', true
    ), '');
  v_guard_operation text :=
    NULLIF(current_setting(
      'hanbang.amora_shared_action_operation_key', true
    ), '');
  v_guard_action text :=
    NULLIF(current_setting(
      'hanbang.amora_shared_action_action_id', true
    ), '');
  v_guard_expected text :=
    NULLIF(current_setting(
      'hanbang.amora_shared_action_expected_revision', true
    ), '');
  v_guard_applied text :=
    NULLIF(current_setting(
      'hanbang.amora_shared_action_applied_revision', true
    ), '');
  v_expected_revision bigint;
  v_action_id uuid;
  v_source_message_id uuid;
  v_confirmation_message_id uuid;
  v_inserted integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.state_revision := 0;
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
  END IF;

  IF OLD.state_revision >= 9007199254740991 THEN
    RAISE EXCEPTION 'AMORA_JOURNEY_STATE_REVISION_EXHAUSTED'
      USING ERRCODE = '22003';
  END IF;

  IF v_guard_couple IS NULL
     AND v_guard_request IS NULL
     AND v_guard_operation IS NULL
     AND v_guard_action IS NULL
     AND v_guard_expected IS NULL
     AND v_guard_applied IS NULL THEN
    NEW.state_revision := OLD.state_revision + 1;
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role'
     OR v_guard_couple IS NULL
     OR v_guard_request IS NULL
     OR v_guard_operation IS NULL
     OR v_guard_action IS NULL
     OR v_guard_expected IS NULL
     OR v_guard_applied IS NOT NULL
     OR v_guard_couple !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR v_guard_action !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR v_guard_operation !~ '^[0-9a-f]{64}$'
     OR char_length(v_guard_request) NOT BETWEEN 1 AND 160
     OR v_guard_expected !~ '^(0|[1-9][0-9]{0,15})$' THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_PROPOSAL_CHANGED'
      USING ERRCODE = '55000';
  END IF;

  v_expected_revision := v_guard_expected::bigint;
  v_action_id := v_guard_action::uuid;
  IF v_expected_revision > 9007199254740990
     OR OLD.couple_id::text IS DISTINCT FROM v_guard_couple
     OR OLD.state_revision IS DISTINCT FROM v_expected_revision THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_PROPOSAL_CHANGED'
      USING ERRCODE = '55000';
  END IF;

  SELECT application.source_message_id,
         application.confirmation_message_id
    INTO v_source_message_id, v_confirmation_message_id
  FROM public.amora_tool_executions AS execution
  JOIN public.amora_chat_request_claims AS request
    ON request.couple_id = execution.couple_id
   AND request.request_key = execution.request_key
  JOIN public.amora_shared_action_application_claims AS application
    ON application.couple_id = execution.couple_id
   AND application.action_id = execution.pending_action_id
   AND application.confirmation_message_id = request.user_message_id
   AND application.claimed_by_user_id = request.user_id
  JOIN public.amora_shared_action_roster_bindings AS binding
    ON binding.couple_id = execution.couple_id
   AND binding.source_message_id = application.source_message_id
   AND binding.action_id = execution.pending_action_id
  JOIN public.chat_messages AS source
    ON source.id = application.source_message_id
   AND source.couple_id = execution.couple_id
  JOIN public.chat_messages AS confirmation
    ON confirmation.id = application.confirmation_message_id
   AND confirmation.couple_id = execution.couple_id
  JOIN public.couples AS current_couple
    ON current_couple.id = execution.couple_id
  WHERE execution.couple_id = OLD.couple_id
    AND execution.request_key = v_guard_request
    AND execution.operation_key = v_guard_operation
    AND execution.pending_action_id = v_action_id
    AND execution.pending_action_journey_revision = v_expected_revision
    AND execution.status = 'processing'
    AND request.status = 'processing'
    AND request.visibility = 'shared'
    AND source.sender_id IS NULL
    AND source.sender_type = 'ai'
    AND source.role = 'assistant'
    AND source.visibility = 'shared'
    AND COALESCE(source.metadata ->> 'target', '') <> 'partner'
    AND source.metadata #>> '{pending_amora_action,actionId}'
      = v_action_id::text
    AND source.metadata #>> '{pending_amora_action,operationKey}'
      = execution.operation_key
    AND source.metadata #>> '{pending_amora_action,inputDigest}'
      = execution.input_digest
    AND source.metadata #>> '{pending_amora_action,tool}'
      = execution.tool_name
    AND jsonb_typeof(
      source.metadata -> 'pending_amora_action_journey_revision'
    ) = 'number'
    AND source.metadata
      #>> '{pending_amora_action_journey_revision}'
      = v_expected_revision::text
    AND binding.initial_proposal_digest = encode(
      extensions.digest(
        convert_to(
          jsonb_build_object(
            'pending_amora_action',
              source.metadata -> 'pending_amora_action',
            'pending_amora_action_journey_revision',
              v_expected_revision
          )::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
    AND binding.proposal_digest =
      public.amora_shared_action_bound_proposal_digest(
        binding.initial_proposal_digest,
        binding.couple_id,
        binding.source_message_id,
        binding.action_id,
        binding.bride_id,
        binding.groom_id,
        binding.required_count,
        binding.roster_fingerprint
      )
    AND application.proposal_digest = binding.proposal_digest
    AND application.roster_fingerprint = binding.roster_fingerprint
    AND binding.bride_id IS NOT DISTINCT FROM CASE
      WHEN public.is_current_couple_member(
        current_couple.bride_id,
        execution.couple_id
      ) THEN current_couple.bride_id
      ELSE NULL
    END
    AND binding.groom_id IS NOT DISTINCT FROM CASE
      WHEN public.is_current_couple_member(
        current_couple.groom_id,
        execution.couple_id
      ) THEN current_couple.groom_id
      ELSE NULL
    END
    AND binding.required_count = CASE
      WHEN binding.bride_id IS NOT NULL
       AND binding.groom_id IS NOT NULL THEN 2
      ELSE 1
    END
    AND binding.roster_fingerprint = md5(
      COALESCE(binding.bride_id::text, '-') || ':' ||
      COALESCE(binding.groom_id::text, '-')
    )
    AND confirmation.sender_id = request.user_id
    AND confirmation.sender_type IN ('bride', 'groom')
    AND confirmation.role = 'user'
    AND confirmation.visibility = 'shared'
    AND COALESCE(confirmation.metadata ->> 'target', '') <> 'partner'
    AND confirmation.metadata ->> 'confirmed_amora_action_id'
      = v_action_id::text;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_PROPOSAL_CHANGED'
      USING ERRCODE = '55000';
  END IF;

  NEW.state_revision := OLD.state_revision + 1;
  NEW.updated_at := clock_timestamp();

  INSERT INTO public.amora_shared_action_journey_mutation_receipts(
    couple_id,
    request_key,
    operation_key,
    action_id,
    source_message_id,
    confirmation_message_id,
    expected_revision,
    applied_revision
  ) VALUES (
    OLD.couple_id,
    v_guard_request,
    v_guard_operation,
    v_action_id,
    v_source_message_id,
    v_confirmation_message_id,
    v_expected_revision,
    NEW.state_revision
  )
  ON CONFLICT (couple_id, request_key, operation_key) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted <> 1 THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_PROPOSAL_CHANGED'
      USING ERRCODE = '55000';
  END IF;

  PERFORM set_config(
    'hanbang.amora_shared_action_applied_revision',
    NEW.state_revision::text,
    true
  );
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.advance_wedding_journey_state_revision()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.advance_wedding_journey_state_revision()
  FROM PUBLIC, anon, authenticated, service_role;

DO $postchecks$
BEGIN
  IF NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_class AS relation
       WHERE relation.oid =
         'public.amora_shared_action_roster_bindings'::regclass
         AND relation.relrowsecurity
     )
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_policy AS policy
       WHERE policy.polrelid =
         'public.amora_shared_action_roster_bindings'::regclass
     )
     OR has_table_privilege(
       'service_role',
       'public.amora_shared_action_roster_bindings',
       'SELECT'
     )
     OR has_table_privilege(
       'service_role',
       'public.amora_shared_action_roster_bindings',
       'INSERT'
     )
     OR has_table_privilege(
       'service_role',
       'public.amora_shared_action_roster_bindings',
       'UPDATE'
     )
     OR has_table_privilege(
       'service_role',
       'public.amora_shared_action_roster_bindings',
       'DELETE'
     )
     OR has_function_privilege(
       'service_role',
       'public.amora_shared_action_current_roster(uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.amora_shared_action_bound_proposal_digest(text,uuid,uuid,uuid,uuid,uuid,smallint,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.amora_shared_action_context_pre_roster_binding(uuid,uuid,uuid,uuid,text,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.amora_shared_action_context(uuid,uuid,uuid,uuid,text,uuid)',
       'EXECUTE'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_trigger AS trigger
       WHERE trigger.tgrelid = 'public.chat_messages'::regclass
         AND trigger.tgname = 'trg_bind_amora_shared_action_roster'
         AND NOT trigger.tgisinternal
         AND trigger.tgenabled <> 'D'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_trigger AS trigger
       WHERE trigger.tgrelid =
         'public.amora_shared_action_roster_bindings'::regclass
         AND trigger.tgname =
           'trg_reject_amora_shared_action_roster_rewrite'
         AND NOT trigger.tgisinternal
         AND trigger.tgenabled <> 'D'
     ) THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_ROSTER_BINDING_POSTCHECK_FAILED';
  END IF;
END
$postchecks$;

COMMIT;
