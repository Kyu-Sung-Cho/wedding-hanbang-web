BEGIN;

-- Durable, roster-bound consent and recipient-fixed activity for Amora's
-- shared mutations. Application checks remain useful UX, but this migration
-- is the fail-closed authority at the database write boundary.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.wedding_journeys
  ADD COLUMN state_revision bigint NOT NULL DEFAULT 0
  CHECK (state_revision BETWEEN 0 AND 9007199254740991);

CREATE OR REPLACE FUNCTION public.advance_wedding_journey_state_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
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

  -- The revision is server-owned: every UPDATE advances exactly once even
  -- when a client tries to supply its own value.
  NEW.state_revision := OLD.state_revision + 1;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.advance_wedding_journey_state_revision()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.advance_wedding_journey_state_revision()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_advance_wedding_journey_state_revision
  ON public.wedding_journeys;
CREATE TRIGGER trg_advance_wedding_journey_state_revision
  BEFORE INSERT OR UPDATE ON public.wedding_journeys
  FOR EACH ROW
  EXECUTE FUNCTION public.advance_wedding_journey_state_revision();

ALTER TABLE public.amora_tool_executions
  ADD COLUMN pending_action_journey_revision bigint
  CHECK (
    pending_action_journey_revision IS NULL
    OR pending_action_journey_revision BETWEEN 0 AND 9007199254740991
  );

CREATE TABLE IF NOT EXISTS public.amora_shared_action_acceptances (
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  -- Deliberately not an FK: clearing chat must not erase the consent receipt.
  source_message_id uuid NOT NULL,
  action_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  proposal_digest text NOT NULL CHECK (proposal_digest ~ '^[a-f0-9]{64}$'),
  roster_fingerprint text NOT NULL CHECK (roster_fingerprint ~ '^[a-f0-9]{32}$'),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CHECK (revoked_at IS NULL OR revoked_at >= accepted_at),
  PRIMARY KEY (couple_id, source_message_id, action_id, user_id)
);

CREATE INDEX IF NOT EXISTS amora_shared_action_acceptances_lookup_idx
  ON public.amora_shared_action_acceptances (
    couple_id, source_message_id, action_id, proposal_digest, roster_fingerprint
  )
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.amora_shared_action_application_claims (
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  -- Chat clearing must not erase an application/execution authority receipt.
  source_message_id uuid NOT NULL,
  action_id uuid NOT NULL,
  claimed_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  proposal_digest text NOT NULL CHECK (proposal_digest ~ '^[a-f0-9]{64}$'),
  roster_fingerprint text NOT NULL CHECK (roster_fingerprint ~ '^[a-f0-9]{32}$'),
  claimed_at timestamptz NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  -- Deliberately not an FK for the same durable-receipt reason as the source.
  confirmation_message_id uuid,
  PRIMARY KEY (couple_id, source_message_id, action_id),
  CHECK (lease_expires_at > claimed_at),
  CHECK (
    confirmation_message_id IS NULL
    OR confirmation_message_id <> source_message_id
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS amora_shared_action_application_confirmation_idx
  ON public.amora_shared_action_application_claims(confirmation_message_id)
  WHERE confirmation_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.amora_shared_action_journey_mutation_receipts (
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  request_key text NOT NULL,
  operation_key text NOT NULL CHECK (operation_key ~ '^[a-f0-9]{64}$'),
  action_id uuid NOT NULL,
  source_message_id uuid NOT NULL,
  confirmation_message_id uuid NOT NULL,
  expected_revision bigint NOT NULL CHECK (
    expected_revision BETWEEN 0 AND 9007199254740990
  ),
  applied_revision bigint NOT NULL CHECK (
    applied_revision = expected_revision + 1
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (couple_id, request_key, operation_key),
  FOREIGN KEY (couple_id, request_key, operation_key)
    REFERENCES public.amora_tool_executions(
      couple_id, request_key, operation_key
    )
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.couple_change_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Preserve the immutable audit reference even if the chat transcript clears.
  source_message_id uuid NOT NULL,
  action_id uuid NOT NULL,
  event_kind text NOT NULL CHECK (
    event_kind IN (
      'approval_requested',
      'approval_ready',
      'approval_withdrawn',
      'change_applied'
    )
  ),
  tool_name text NOT NULL CHECK (char_length(tool_name) BETWEEN 1 AND 80),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 240),
  href text NOT NULL CHECK (
    href IN ('/chat', '/budget', '/schedule', '/dashboard', '/settings', '/lounge')
  ),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (actor_user_id <> recipient_user_id),
  UNIQUE (couple_id, recipient_user_id, action_id, event_kind)
);

CREATE INDEX IF NOT EXISTS couple_change_notifications_recipient_idx
  ON public.couple_change_notifications (
    recipient_user_id, read_at, created_at DESC, id DESC
  );

ALTER TABLE public.amora_shared_action_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amora_shared_action_application_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amora_shared_action_journey_mutation_receipts
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.couple_change_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY amora_shared_action_acceptances_service_all
  ON public.amora_shared_action_acceptances
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY amora_shared_action_application_claims_service_all
  ON public.amora_shared_action_application_claims
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY amora_shared_action_journey_mutation_receipts_service_all
  ON public.amora_shared_action_journey_mutation_receipts
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY couple_change_notifications_recipient_select
  ON public.couple_change_notifications
  FOR SELECT TO authenticated
  USING (recipient_user_id = auth.uid());

CREATE POLICY couple_change_notifications_recipient_read
  ON public.couple_change_notifications
  FOR UPDATE TO authenticated
  USING (recipient_user_id = auth.uid())
  WITH CHECK (recipient_user_id = auth.uid());

CREATE POLICY couple_change_notifications_service_all
  ON public.couple_change_notifications
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.amora_shared_action_acceptances
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.amora_shared_action_application_claims
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.amora_shared_action_journey_mutation_receipts
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.couple_change_notifications
  FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.amora_shared_action_acceptances TO service_role;
GRANT ALL ON TABLE public.amora_shared_action_application_claims TO service_role;
GRANT ALL ON TABLE public.amora_shared_action_journey_mutation_receipts
  TO service_role;
GRANT ALL ON TABLE public.couple_change_notifications TO service_role;
GRANT SELECT, UPDATE (read_at)
  ON TABLE public.couple_change_notifications TO authenticated;

-- Replace the basic revision trigger body now that the durable shared-action
-- tables exist. Ordinary writes still advance monotonically. A guarded atomic
-- apply additionally has to prove that its transaction-local marker matches a
-- real processing execution, its bound confirmation, and the exact source
-- proposal before the already-locked journey row may move from r to r+1.
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
    AND application.proposal_digest = encode(
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
    AND application.roster_fingerprint = md5(
      COALESCE(current_couple.bride_id::text, '-')
      || ':' ||
      COALESCE(current_couple.groom_id::text, '-')
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

-- Keep one strict permissive INSERT policy. Leaving any legacy permissive
-- policy would OR it with this one and reopen metadata forgery.
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.chat_messages FROM anon, authenticated;
GRANT SELECT ON TABLE public.chat_messages TO authenticated;
GRANT INSERT (
  couple_id, sender_id, sender_type, role, content, metadata, stage_tag, visibility
) ON public.chat_messages TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.chat_messages TO service_role;

DROP POLICY IF EXISTS "Allow AI message insert" ON public.chat_messages;
DROP POLICY IF EXISTS chat_insert_couple ON public.chat_messages;
DROP POLICY IF EXISTS couple_members_can_insert_messages ON public.chat_messages;
DROP POLICY IF EXISTS couple_members_can_delete_messages ON public.chat_messages;
DROP POLICY IF EXISTS chat_messages_insert_own_user ON public.chat_messages;

CREATE POLICY chat_messages_insert_own_user ON public.chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND role = 'user'
    AND sender_type IN ('bride', 'groom')
    AND sender_role IS NULL
    AND specialist_type IS NULL
    AND (
      stage_tag IS NULL
      OR stage_tag IN (
        'planning_0', 'preparation_1', 'execution_2',
        'ceremony_3', 'settlement_4'
      )
    )
    AND char_length(content) BETWEEN 1 AND 20000
    AND btrim(content) <> ''
    AND created_at BETWEEN now() - interval '5 minutes' AND now() + interval '1 minute'
    AND (
      (
        sender_type = 'bride'
        AND public.can_access_couple_visibility(couple_id, 'bride_private')
      )
      OR (
        sender_type = 'groom'
        AND public.can_access_couple_visibility(couple_id, 'groom_private')
      )
    )
    AND public.can_access_couple_visibility(couple_id, visibility)
    AND (
      metadata IS NULL
      OR (
        jsonb_typeof(metadata) = 'object'
        AND metadata - ARRAY[
          'target', 'imagePaths', 'confirmed_amora_action_id'
        ]::text[] = '{}'::jsonb
        AND (
          (
            metadata ? 'confirmed_amora_action_id'
            AND visibility = 'shared'
            AND (
              NOT metadata ? 'target'
              OR metadata ->> 'target' <> 'partner'
            )
            AND jsonb_typeof(
              metadata -> 'confirmed_amora_action_id'
            ) = 'string'
            AND COALESCE(
              metadata ->> 'confirmed_amora_action_id',
              ''
            ) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          )
          OR (
            NOT metadata ? 'confirmed_amora_action_id'
            AND (
              NOT metadata ? 'target'
              OR metadata ->> 'target' = 'partner'
            )
          )
        )
        AND (
          NOT metadata ? 'imagePaths'
          OR (
            jsonb_typeof(metadata -> 'imagePaths') = 'array'
            AND jsonb_array_length(metadata -> 'imagePaths') <= 5
            AND NOT EXISTS (
              SELECT 1
              FROM jsonb_array_elements(metadata -> 'imagePaths')
                AS image_path(value)
              WHERE jsonb_typeof(image_path.value) <> 'string'
                 OR char_length(image_path.value #>> '{}') NOT BETWEEN 1 AND 512
                 OR image_path.value #>> '{}'
                   NOT LIKE chat_messages.couple_id::text || '/%'
                 OR image_path.value #>> '{}' LIKE '%..%'
            )
          )
        )
      )
    )
  );

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
      -- Updating an existing action needs its own row-version/hash CAS. The
      -- journey revision cannot detect a concurrent manual action PATCH.
      'update_amora_action'
    ) THEN 'blocked'
    WHEN jsonb_typeof(p_tool_input) IS DISTINCT FROM 'object' THEN 'blocked'
    WHEN p_tool_name IN (
      'update_budget',
      'update_wedding_date',
      'update_venue',
      'apply_budget_plan'
    ) THEN 'couple'
    WHEN p_tool_name IN ('update_category_budget', 'add_custom_category')
      AND p_tool_input ? 'budget'
      THEN 'couple'
    WHEN p_tool_name IN (
      'update_task_status',
      'update_category_budget',
      'add_custom_category',
      'add_schedule_event',
      'update_schedule_event',
      'toggle_checklist_item',
      'add_amora_action',
      'log_wedding_event'
    ) THEN 'single'
    ELSE 'blocked'
  END;
$function$;

REVOKE ALL ON FUNCTION public.amora_shared_action_policy(text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.amora_shared_action_policy(text, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.amora_shared_action_notification_copy(
  p_tool_name text,
  p_event_kind text
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT CASE p_event_kind
    WHEN 'approval_requested' THEN jsonb_build_object(
      'title', '함께 확인할 변경이 있어요',
      'message', CASE p_tool_name
        WHEN 'update_budget' THEN '총예산 변경을 함께 확인해 주세요.'
        WHEN 'update_wedding_date' THEN '결혼식 날짜 변경을 함께 확인해 주세요.'
        WHEN 'update_venue' THEN '결혼식장 변경을 함께 확인해 주세요.'
        WHEN 'apply_budget_plan' THEN '전체 예산안 변경을 함께 확인해 주세요.'
        WHEN 'update_category_budget' THEN '카테고리 예산 변경을 함께 확인해 주세요.'
        ELSE '함께 쓰는 정보의 변경을 확인해 주세요.'
      END,
      'href', '/chat'
    )
    WHEN 'approval_ready' THEN jsonb_build_object(
      'title', '두 사람의 확인이 끝났어요',
      'message', '변경을 적용할 준비가 됐어요.',
      'href', '/chat'
    )
    WHEN 'approval_withdrawn' THEN jsonb_build_object(
      'title', '공동 확인이 철회됐어요',
      'message', '변경 적용 요청 전 공동 확인 한 건이 철회됐어요.',
      'href', '/chat'
    )
    WHEN 'change_applied' THEN jsonb_build_object(
      'title', '함께 쓰는 정보가 변경됐어요',
      'message', CASE
        WHEN p_tool_name IN (
          'update_budget', 'update_category_budget', 'apply_budget_plan',
          'add_custom_category'
        ) THEN '예산 정보에 새 변경이 반영됐어요.'
        WHEN p_tool_name IN (
          'update_wedding_date', 'add_schedule_event',
          'update_schedule_event'
        ) THEN '일정 정보에 새 변경이 반영됐어요.'
        WHEN p_tool_name = 'update_venue'
          THEN '결혼식장 정보에 새 변경이 반영됐어요.'
        ELSE '준비 정보에 새 변경이 반영됐어요.'
      END,
      'href', CASE
        WHEN p_tool_name IN (
          'update_budget', 'update_category_budget', 'apply_budget_plan',
          'add_custom_category'
        ) THEN '/budget'
        WHEN p_tool_name IN (
          'update_wedding_date', 'add_schedule_event',
          'update_schedule_event'
        ) THEN '/schedule'
        ELSE '/dashboard'
      END
    )
    ELSE NULL
  END;
$function$;

REVOKE ALL ON FUNCTION public.amora_shared_action_notification_copy(text, text)
  FROM PUBLIC, anon, authenticated, service_role;

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
  v_bride_id uuid;
  v_groom_id uuid;
  v_required_count integer;
  v_roster_fingerprint text;
  v_action jsonb;
  v_tool_name text;
  v_tool_input jsonb;
  v_policy text;
  v_proposal_digest text;
  v_issued_at numeric;
  v_expires_at numeric;
  v_expected_ttl_ms numeric;
  v_now_ms numeric;
  v_latest_ids uuid[];
  v_journey_revision_json jsonb;
  v_expected_journey_revision bigint;
  v_current_journey_revision bigint;
  v_guard_couple text;
  v_guard_request text;
  v_guard_operation text;
  v_guard_action text;
  v_guard_expected text;
  v_guard_applied text;
  v_self_applied_revision boolean := false;
BEGIN
  IF p_action_id IS NULL
     OR p_couple_id IS NULL
     OR p_source_message_id IS NULL
     OR p_user_id IS NULL
     OR p_context_mode NOT IN ('proposal_latest', 'execution')
     OR (p_context_mode = 'proposal_latest' AND p_confirmation_message_id IS NOT NULL)
     OR (p_context_mode = 'execution' AND p_confirmation_message_id IS NULL) THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_INVALID_INPUT'
      USING ERRCODE = '22023';
  END IF;

  -- The couple row is the first lock for acceptance, authorization, and the
  -- execution trigger. Its immediate chat-message FK prevents a concurrent
  -- canonical insert from crossing the freshness check.
  SELECT couple.bride_id, couple.groom_id
    INTO v_bride_id, v_groom_id
  FROM public.couples AS couple
  WHERE couple.id = p_couple_id
  FOR UPDATE;

  IF NOT FOUND
     OR NOT EXISTS (
       SELECT 1
       FROM public.profiles AS profile
       WHERE profile.id = p_user_id
         AND profile.couple_id = p_couple_id
         AND (
           (profile.role = 'bride' AND v_bride_id = p_user_id)
           OR (profile.role = 'groom' AND v_groom_id = p_user_id)
         )
     ) THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_SCOPE_DENIED'
      USING ERRCODE = '42501';
  END IF;

  v_required_count :=
    CASE
      WHEN v_bride_id IS NOT NULL
       AND v_groom_id IS NOT NULL
       AND v_bride_id <> v_groom_id THEN 2
      ELSE 1
    END;
  v_roster_fingerprint := md5(
    COALESCE(v_bride_id::text, '-') || ':' || COALESCE(v_groom_id::text, '-')
  );

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'hanbang:amora-shared-action:'
        || p_couple_id::text || ':' || p_action_id::text,
      0
    )
  );

  SELECT message.metadata -> 'pending_amora_action',
         message.metadata -> 'pending_amora_action_journey_revision'
    INTO v_action, v_journey_revision_json
  FROM public.chat_messages AS message
  WHERE message.id = p_source_message_id
    AND message.couple_id = p_couple_id
    AND message.sender_id IS NULL
    AND message.sender_type = 'ai'
    AND message.role = 'assistant'
    AND message.visibility = 'shared'
    AND COALESCE(message.metadata ->> 'target', '') <> 'partner'
  FOR SHARE;

  IF NOT FOUND
     OR jsonb_typeof(v_action) IS DISTINCT FROM 'object'
     OR v_action - ARRAY[
       'version', 'actionId', 'tool', 'input', 'inputDigest',
       'operationKey', 'confirmation', 'issuedAt', 'expiresAt'
     ] <> '{}'::jsonb
     OR v_action ->> 'version' IS DISTINCT FROM '2'
     OR COALESCE(v_action ->> 'actionId', '') !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR (v_action ->> 'actionId')::uuid IS DISTINCT FROM p_action_id
     OR char_length(COALESCE(v_action ->> 'tool', '')) NOT BETWEEN 1 AND 80
     OR jsonb_typeof(v_action -> 'input') IS DISTINCT FROM 'object'
     OR octet_length((v_action -> 'input')::text) > 16384
     OR COALESCE(v_action ->> 'inputDigest', '') !~ '^[a-f0-9]{64}$'
     OR COALESCE(v_action ->> 'operationKey', '') !~ '^[a-f0-9]{64}$'
     OR jsonb_typeof(v_action -> 'confirmation') IS DISTINCT FROM 'string'
     OR char_length(v_action ->> 'confirmation') NOT BETWEEN 1 AND 2000
     OR COALESCE(v_action ->> 'issuedAt', '') !~ '^[0-9]{1,16}$'
     OR COALESCE(v_action ->> 'expiresAt', '') !~ '^[0-9]{1,16}$'
     OR jsonb_typeof(v_journey_revision_json) IS DISTINCT FROM 'number'
     OR COALESCE(v_journey_revision_json #>> '{}', '') !~
       '^(0|[1-9][0-9]{0,15})$' THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_PROPOSAL_INVALID'
      USING ERRCODE = '22023';
  END IF;

  v_expected_journey_revision :=
    (v_journey_revision_json #>> '{}')::bigint;
  IF v_expected_journey_revision > 9007199254740991 THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_PROPOSAL_INVALID'
      USING ERRCODE = '22023';
  END IF;

  -- This is deliberately a non-locking fail-fast read. The atomic mutation
  -- boundary performs the authoritative comparison after it owns the journey
  -- row, preserving the established execution/request -> journey lock order.
  SELECT journey.state_revision
    INTO v_current_journey_revision
  FROM public.wedding_journeys AS journey
  WHERE journey.couple_id = p_couple_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_PROPOSAL_CHANGED'
      USING ERRCODE = '55000';
  END IF;

  IF v_current_journey_revision IS DISTINCT FROM
       v_expected_journey_revision THEN
    -- The only valid mismatch is the r -> r+1 mutation performed by this
    -- exact execution earlier in the same atomic dispatcher transaction.
    -- Transaction-local settings are routing hints, never authority alone:
    -- the receipt and all durable request/execution/action bindings must match.
    v_guard_couple := NULLIF(current_setting(
      'hanbang.amora_shared_action_couple_id', true
    ), '');
    v_guard_request := NULLIF(current_setting(
      'hanbang.amora_shared_action_request_key', true
    ), '');
    v_guard_operation := NULLIF(current_setting(
      'hanbang.amora_shared_action_operation_key', true
    ), '');
    v_guard_action := NULLIF(current_setting(
      'hanbang.amora_shared_action_action_id', true
    ), '');
    v_guard_expected := NULLIF(current_setting(
      'hanbang.amora_shared_action_expected_revision', true
    ), '');
    v_guard_applied := NULLIF(current_setting(
      'hanbang.amora_shared_action_applied_revision', true
    ), '');

    IF p_context_mode = 'execution'
       AND auth.role() = 'service_role'
       AND v_expected_journey_revision < 9007199254740991
       AND v_current_journey_revision =
         v_expected_journey_revision + 1
       AND v_guard_couple = p_couple_id::text
       AND v_guard_request IS NOT NULL
       AND char_length(v_guard_request) BETWEEN 1 AND 160
       AND v_guard_operation ~ '^[a-f0-9]{64}$'
       AND v_guard_action = p_action_id::text
       AND v_guard_expected =
         v_expected_journey_revision::text
       AND v_guard_applied =
         v_current_journey_revision::text
       AND EXISTS (
         SELECT 1
         FROM public.amora_shared_action_journey_mutation_receipts AS receipt
         JOIN public.amora_tool_executions AS execution
           ON execution.couple_id = receipt.couple_id
          AND execution.request_key = receipt.request_key
          AND execution.operation_key = receipt.operation_key
         JOIN public.amora_chat_request_claims AS request
           ON request.couple_id = execution.couple_id
          AND request.request_key = execution.request_key
         WHERE receipt.couple_id = p_couple_id
           AND receipt.request_key = v_guard_request
           AND receipt.operation_key = v_guard_operation
           AND receipt.action_id = p_action_id
           AND receipt.source_message_id = p_source_message_id
           AND receipt.confirmation_message_id =
             p_confirmation_message_id
           AND receipt.expected_revision =
             v_expected_journey_revision
           AND receipt.applied_revision =
             v_current_journey_revision
           AND execution.pending_action_id = p_action_id
           AND execution.pending_action_journey_revision =
             v_expected_journey_revision
           AND execution.status = 'processing'
           AND request.status = 'processing'
           AND request.visibility = 'shared'
           AND request.user_id = p_user_id
           AND request.user_message_id =
             p_confirmation_message_id
       ) THEN
      v_self_applied_revision := true;
    END IF;

    IF NOT v_self_applied_revision THEN
      RAISE EXCEPTION 'AMORA_SHARED_ACTION_PROPOSAL_CHANGED'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  v_tool_name := v_action ->> 'tool';
  v_tool_input := v_action -> 'input';
  v_policy := public.amora_shared_action_policy(v_tool_name, v_tool_input);
  IF v_policy = 'blocked' THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_BLOCKED'
      USING ERRCODE = '42501';
  END IF;

  v_issued_at := (v_action ->> 'issuedAt')::numeric;
  v_expires_at := (v_action ->> 'expiresAt')::numeric;
  v_expected_ttl_ms := CASE
    WHEN v_policy = 'couple' THEN 86400000
    ELSE 600000
  END;
  v_now_ms := floor(extract(epoch FROM clock_timestamp()) * 1000);
  IF v_issued_at > v_now_ms
     OR v_expires_at <= v_now_ms
     OR v_expires_at - v_issued_at <> v_expected_ttl_ms THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_EXPIRED'
      USING ERRCODE = '55000';
  END IF;

  v_proposal_digest := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'pending_amora_action', v_action,
          'pending_amora_action_journey_revision',
            v_expected_journey_revision
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  SELECT array_agg(recent.id ORDER BY recent.created_at DESC, recent.id DESC)
    INTO v_latest_ids
  FROM (
    SELECT message.id, message.created_at
    FROM public.chat_messages AS message
    WHERE message.couple_id = p_couple_id
      AND message.visibility = 'shared'
      AND COALESCE(message.metadata ->> 'target', '') <> 'partner'
    ORDER BY message.created_at DESC, message.id DESC
    LIMIT CASE WHEN p_context_mode = 'execution' THEN 2 ELSE 1 END
  ) AS recent;

  IF p_context_mode = 'proposal_latest' THEN
    IF COALESCE(array_length(v_latest_ids, 1), 0) <> 1
       OR v_latest_ids[1] IS DISTINCT FROM p_source_message_id THEN
      RAISE EXCEPTION 'AMORA_SHARED_ACTION_STALE_CONTEXT'
        USING ERRCODE = '55000';
    END IF;
  ELSE
    IF COALESCE(array_length(v_latest_ids, 1), 0) <> 2
       OR v_latest_ids[1] IS DISTINCT FROM p_confirmation_message_id
       OR v_latest_ids[2] IS DISTINCT FROM p_source_message_id
       OR NOT EXISTS (
         SELECT 1
         FROM public.chat_messages AS confirmation
         WHERE confirmation.id = p_confirmation_message_id
           AND confirmation.couple_id = p_couple_id
           AND confirmation.sender_id = p_user_id
           AND confirmation.sender_type IN ('bride', 'groom')
           AND confirmation.role = 'user'
           AND confirmation.visibility = 'shared'
           AND COALESCE(confirmation.metadata ->> 'target', '') <> 'partner'
       ) THEN
      RAISE EXCEPTION 'AMORA_SHARED_ACTION_STALE_CONTEXT'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'actionId', p_action_id,
    'sourceMessageId', p_source_message_id,
    'tool', v_tool_name,
    'input', v_tool_input,
    'inputDigest', v_action ->> 'inputDigest',
    'operationKey', v_action ->> 'operationKey',
    'journeyRevision', v_expected_journey_revision,
    'policy', v_policy,
    'proposalDigest', v_proposal_digest,
    'rosterFingerprint', v_roster_fingerprint,
    'requiredCount', v_required_count,
    'partnerLinked', v_required_count = 2
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.amora_shared_action_context(
  uuid, uuid, uuid, uuid, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_amora_shared_action_status(
  p_action_id uuid,
  p_couple_id uuid,
  p_source_message_id uuid,
  p_user_id uuid
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
  v_accepted_count integer;
  v_accepted boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  v_context := public.amora_shared_action_context(
    p_action_id,
    p_couple_id,
    p_source_message_id,
    p_user_id,
    'proposal_latest',
    NULL
  );

  IF EXISTS (
    SELECT 1
    FROM public.amora_shared_action_acceptances AS acceptance
    WHERE acceptance.couple_id = p_couple_id
      AND acceptance.source_message_id = p_source_message_id
      AND acceptance.action_id = p_action_id
      AND (
        acceptance.proposal_digest IS DISTINCT FROM v_context ->> 'proposalDigest'
        OR acceptance.roster_fingerprint IS DISTINCT FROM v_context ->> 'rosterFingerprint'
      )
  ) THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_PROPOSAL_CHANGED'
      USING ERRCODE = '55000';
  END IF;

  SELECT count(*)::integer,
         COALESCE(bool_or(acceptance.user_id = p_user_id), false)
    INTO v_accepted_count, v_accepted
  FROM public.amora_shared_action_acceptances AS acceptance
  JOIN public.profiles AS profile
    ON profile.id = acceptance.user_id
   AND profile.couple_id = acceptance.couple_id
  JOIN public.couples AS couple ON couple.id = acceptance.couple_id
  WHERE acceptance.couple_id = p_couple_id
    AND acceptance.source_message_id = p_source_message_id
    AND acceptance.action_id = p_action_id
    AND acceptance.proposal_digest = v_context ->> 'proposalDigest'
    AND acceptance.roster_fingerprint = v_context ->> 'rosterFingerprint'
    AND acceptance.revoked_at IS NULL
    AND (
      (profile.role = 'bride' AND couple.bride_id = profile.id)
      OR (profile.role = 'groom' AND couple.groom_id = profile.id)
    );

  RETURN v_context || jsonb_build_object(
    'approvalMode', v_context ->> 'policy',
    'accepted', v_accepted,
    'acceptedCount', v_accepted_count,
    'ready', CASE
      WHEN v_context ->> 'policy' = 'single' THEN true
      ELSE v_accepted_count >= (v_context ->> 'requiredCount')::integer
    END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.accept_amora_shared_action(
  p_action_id uuid,
  p_couple_id uuid,
  p_source_message_id uuid,
  p_user_id uuid
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
  v_status jsonb;
  v_recipient_user_id uuid;
  v_copy jsonb;
  v_inserted integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  v_context := public.amora_shared_action_context(
    p_action_id,
    p_couple_id,
    p_source_message_id,
    p_user_id,
    'proposal_latest',
    NULL
  );
  IF v_context ->> 'policy' <> 'couple' THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_COUPLE_APPROVAL_NOT_REQUIRED'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.amora_shared_action_acceptances AS acceptance
    WHERE acceptance.couple_id = p_couple_id
      AND acceptance.source_message_id = p_source_message_id
      AND acceptance.action_id = p_action_id
      AND (
        acceptance.proposal_digest IS DISTINCT FROM v_context ->> 'proposalDigest'
        OR acceptance.roster_fingerprint IS DISTINCT FROM v_context ->> 'rosterFingerprint'
      )
  ) THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_PROPOSAL_CHANGED'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.amora_shared_action_acceptances(
    couple_id,
    source_message_id,
    action_id,
    user_id,
    proposal_digest,
    roster_fingerprint
  ) VALUES (
    p_couple_id,
    p_source_message_id,
    p_action_id,
    p_user_id,
    v_context ->> 'proposalDigest',
    v_context ->> 'rosterFingerprint'
  )
  ON CONFLICT (couple_id, source_message_id, action_id, user_id)
    DO UPDATE
      SET accepted_at = now(),
          revoked_at = NULL
      WHERE amora_shared_action_acceptances.revoked_at IS NOT NULL;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  v_status := public.get_amora_shared_action_status(
    p_action_id,
    p_couple_id,
    p_source_message_id,
    p_user_id
  );

  IF v_inserted = 1 AND (v_status ->> 'ready')::boolean THEN
    -- A 2/2 state supersedes the earlier request. Keep the durable history,
    -- but do not leave a contradictory unread "please approve" badge.
    UPDATE public.couple_change_notifications AS notification
       SET read_at = COALESCE(notification.read_at, now())
     WHERE notification.couple_id = p_couple_id
       AND notification.source_message_id = p_source_message_id
       AND notification.action_id = p_action_id
       AND notification.event_kind IN (
         'approval_requested', 'approval_ready', 'approval_withdrawn'
       );
  END IF;

  -- Keep pre-apply activity quiet: only the first high-impact 1/2 vote asks
  -- the other member for approval. Routine 1/1 and high-impact 2/2 create no
  -- "ready but not yet applied" event; durable success is notified later.
  IF v_inserted = 1
     AND (v_context ->> 'requiredCount')::integer = 2
     AND (v_status ->> 'acceptedCount')::integer = 1
     AND NOT (v_status ->> 'ready')::boolean THEN
    SELECT CASE
      WHEN couple.bride_id = p_user_id THEN couple.groom_id
      ELSE couple.bride_id
    END
      INTO v_recipient_user_id
    FROM public.couples AS couple
    WHERE couple.id = p_couple_id;

    IF v_recipient_user_id IS NULL
       OR v_recipient_user_id = p_user_id
       OR NOT public.is_current_couple_member(
         v_recipient_user_id,
         p_couple_id
       ) THEN
      RAISE EXCEPTION 'AMORA_SHARED_ACTION_NOTIFICATION_RECIPIENT_INVALID'
        USING ERRCODE = '55000';
    END IF;

    UPDATE public.couple_change_notifications AS notification
       SET read_at = COALESCE(notification.read_at, now())
     WHERE notification.couple_id = p_couple_id
       AND notification.source_message_id = p_source_message_id
       AND notification.action_id = p_action_id
       AND notification.event_kind IN (
         'approval_ready', 'approval_withdrawn'
       );

    v_copy := public.amora_shared_action_notification_copy(
      v_context ->> 'tool',
      'approval_requested'
    );

    INSERT INTO public.couple_change_notifications(
      couple_id,
      recipient_user_id,
      actor_user_id,
      source_message_id,
      action_id,
      event_kind,
      tool_name,
      title,
      message,
      href
    ) VALUES (
      p_couple_id,
      v_recipient_user_id,
      p_user_id,
      p_source_message_id,
      p_action_id,
      'approval_requested',
      v_context ->> 'tool',
      v_copy ->> 'title',
      v_copy ->> 'message',
      v_copy ->> 'href'
    )
    ON CONFLICT (couple_id, recipient_user_id, action_id, event_kind)
      DO UPDATE
        SET actor_user_id = EXCLUDED.actor_user_id,
            source_message_id = EXCLUDED.source_message_id,
            tool_name = EXCLUDED.tool_name,
            title = EXCLUDED.title,
            message = EXCLUDED.message,
            href = EXCLUDED.href,
            read_at = NULL,
            created_at = now();
  END IF;

  RETURN v_status;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_amora_shared_action_application(
  p_action_id uuid,
  p_couple_id uuid,
  p_source_message_id uuid,
  p_user_id uuid
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
  v_accepted_count integer := 0;
  v_now timestamptz;
  v_inserted integer;
  v_claim public.amora_shared_action_application_claims%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  -- Context acquires the canonical couple-row then action-advisory locks.
  -- Claim, authorization, and withdrawal never acquire the lease row first.
  v_context := public.amora_shared_action_context(
    p_action_id,
    p_couple_id,
    p_source_message_id,
    p_user_id,
    'proposal_latest',
    NULL
  );

  IF v_context ->> 'policy' = 'couple' THEN
    IF EXISTS (
      SELECT 1
      FROM public.amora_shared_action_acceptances AS acceptance
      WHERE acceptance.couple_id = p_couple_id
        AND acceptance.source_message_id = p_source_message_id
        AND acceptance.action_id = p_action_id
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
    WHERE acceptance.couple_id = p_couple_id
      AND acceptance.source_message_id = p_source_message_id
      AND acceptance.action_id = p_action_id
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

  v_now := clock_timestamp();
  INSERT INTO public.amora_shared_action_application_claims(
    couple_id,
    source_message_id,
    action_id,
    claimed_by_user_id,
    proposal_digest,
    roster_fingerprint,
    claimed_at,
    lease_expires_at
  ) VALUES (
    p_couple_id,
    p_source_message_id,
    p_action_id,
    p_user_id,
    v_context ->> 'proposalDigest',
    v_context ->> 'rosterFingerprint',
    v_now,
    v_now + interval '60 seconds'
  )
  ON CONFLICT (couple_id, source_message_id, action_id)
    DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted = 1 THEN
    RETURN jsonb_build_object(
      'applicationGranted', true,
      'retryAfterMs', 0
    );
  END IF;

  SELECT claim.*
    INTO v_claim
  FROM public.amora_shared_action_application_claims AS claim
  WHERE claim.couple_id = p_couple_id
    AND claim.source_message_id = p_source_message_id
    AND claim.action_id = p_action_id
  FOR UPDATE;

  -- ON CONFLICT may have waited behind the winning transaction. Re-sample
  -- wall time after the row lock so takeover and retry timing are not stale.
  v_now := clock_timestamp();

  IF v_claim.confirmation_message_id IS NULL
     AND v_claim.lease_expires_at > v_now
     AND v_claim.claimed_by_user_id = p_user_id
     AND v_claim.proposal_digest = v_context ->> 'proposalDigest'
     AND v_claim.roster_fingerprint = v_context ->> 'rosterFingerprint' THEN
    RETURN jsonb_build_object(
      'applicationGranted', true,
      'retryAfterMs', 0
    );
  END IF;

  IF v_claim.confirmation_message_id IS NULL
     AND v_claim.lease_expires_at <= v_now THEN
    UPDATE public.amora_shared_action_application_claims AS claim
       SET claimed_by_user_id = p_user_id,
           proposal_digest = v_context ->> 'proposalDigest',
           roster_fingerprint = v_context ->> 'rosterFingerprint',
           claimed_at = v_now,
           lease_expires_at = v_now + interval '60 seconds'
     WHERE claim.couple_id = p_couple_id
       AND claim.source_message_id = p_source_message_id
       AND claim.action_id = p_action_id
       AND claim.confirmation_message_id IS NULL
       AND claim.lease_expires_at <= v_now;

    RETURN jsonb_build_object(
      'applicationGranted', true,
      'retryAfterMs', 0
    );
  END IF;

  RETURN jsonb_build_object(
    'applicationGranted', false,
    'retryAfterMs', CASE
      WHEN v_claim.confirmation_message_id IS NOT NULL THEN 0
      ELSE GREATEST(
        1,
        ceil(
          extract(epoch FROM (v_claim.lease_expires_at - v_now)) * 1000
        )::bigint
      )
    END
  );
END;
$function$;

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
BEGIN
  IF jsonb_typeof(COALESCE(NEW.metadata, '{}'::jsonb)) <> 'object'
     OR NOT (
       COALESCE(NEW.metadata, '{}'::jsonb) ? 'confirmed_amora_action_id'
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

  -- This read acquires no lock. The context call below establishes the global
  -- couple-row -> action-advisory order before the claim row is touched.
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

REVOKE ALL ON FUNCTION public.bind_amora_shared_action_application()
  FROM PUBLIC, anon, authenticated, service_role;

-- PostgreSQL orders same-kind triggers by name. The earlier mediation trigger
-- returns immediately for this user/non-mediation shape, so it takes no lock;
-- this trigger alone owns the couple -> action -> claim order.
CREATE TRIGGER trg_bind_amora_shared_action_application
  BEFORE INSERT ON public.chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.bind_amora_shared_action_application();

CREATE OR REPLACE FUNCTION public.revoke_amora_shared_action_acceptance(
  p_action_id uuid,
  p_couple_id uuid,
  p_source_message_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_bride_id uuid;
  v_groom_id uuid;
  v_context jsonb;
  v_status jsonb;
  v_recipient_user_id uuid;
  v_copy jsonb;
  v_revoked integer;
  v_had_approval_request boolean := false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;
  IF p_action_id IS NULL
     OR p_couple_id IS NULL
     OR p_source_message_id IS NULL
     OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_INVALID_INPUT'
      USING ERRCODE = '22023';
  END IF;

  -- Match the lock order used by acceptance and execution. Withdrawal is
  -- intentionally allowed only while the proposal is latest; after an apply
  -- confirmation is recorded, the context check below fails closed. If this
  -- lock wins before that confirmation insert, later execution sees the
  -- missing vote. Durable success always returns the explicit error below.
  SELECT couple.bride_id, couple.groom_id
    INTO v_bride_id, v_groom_id
  FROM public.couples AS couple
  WHERE couple.id = p_couple_id
  FOR UPDATE;

  IF NOT FOUND
     OR NOT EXISTS (
       SELECT 1
       FROM public.profiles AS profile
       WHERE profile.id = p_user_id
         AND profile.couple_id = p_couple_id
         AND (
           (profile.role = 'bride' AND v_bride_id = p_user_id)
           OR (profile.role = 'groom' AND v_groom_id = p_user_id)
         )
     ) THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_SCOPE_DENIED'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'hanbang:amora-shared-action:'
        || p_couple_id::text || ':' || p_action_id::text,
      0
    )
  );

  -- A completed action cannot still have its proposal as the latest message.
  -- Give the durable success ledger precedence; only non-applied actions
  -- proceed to exact source, proposal, roster, freshness, and expiry checks.
  IF EXISTS (
    SELECT 1
    FROM public.amora_tool_executions AS execution
    WHERE execution.couple_id = p_couple_id
      AND execution.pending_action_id = p_action_id
      AND execution.status = 'completed'
      AND jsonb_typeof(execution.result -> 'success') = 'boolean'
      AND (execution.result ->> 'success')::boolean
  ) THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_ALREADY_APPLIED'
      USING ERRCODE = '55000';
  END IF;

  -- This repeats the canonical proposal, roster, latest-message, and expiry
  -- checks under the same re-entrant couple/action locks.
  v_context := public.amora_shared_action_context(
    p_action_id,
    p_couple_id,
    p_source_message_id,
    p_user_id,
    'proposal_latest',
    NULL
  );
  IF v_context ->> 'policy' <> 'couple' THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_COUPLE_APPROVAL_NOT_REQUIRED'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.amora_shared_action_acceptances AS acceptance
    WHERE acceptance.couple_id = p_couple_id
      AND acceptance.source_message_id = p_source_message_id
      AND acceptance.action_id = p_action_id
      AND (
        acceptance.proposal_digest IS DISTINCT FROM v_context ->> 'proposalDigest'
        OR acceptance.roster_fingerprint IS DISTINCT FROM v_context ->> 'rosterFingerprint'
      )
  ) THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_PROPOSAL_CHANGED'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.amora_shared_action_acceptances AS acceptance
     SET revoked_at = now()
   WHERE acceptance.couple_id = p_couple_id
     AND acceptance.source_message_id = p_source_message_id
     AND acceptance.action_id = p_action_id
     AND acceptance.user_id = p_user_id
     AND acceptance.proposal_digest = v_context ->> 'proposalDigest'
     AND acceptance.roster_fingerprint = v_context ->> 'rosterFingerprint'
     AND acceptance.revoked_at IS NULL;
  GET DIAGNOSTICS v_revoked = ROW_COUNT;

  IF v_revoked = 1 THEN
    DELETE FROM public.amora_shared_action_application_claims AS claim
    WHERE claim.couple_id = p_couple_id
      AND claim.source_message_id = p_source_message_id
      AND claim.action_id = p_action_id
      AND claim.confirmation_message_id IS NULL;
  END IF;

  v_status := public.get_amora_shared_action_status(
    p_action_id,
    p_couple_id,
    p_source_message_id,
    p_user_id
  );

  IF v_revoked = 1 AND (v_context ->> 'requiredCount')::integer = 2 THEN
    v_recipient_user_id := CASE
      WHEN v_bride_id = p_user_id THEN v_groom_id
      ELSE v_bride_id
    END;

    SELECT EXISTS (
      SELECT 1
      FROM public.couple_change_notifications AS requested
      WHERE requested.couple_id = p_couple_id
        AND requested.recipient_user_id = v_recipient_user_id
        AND requested.actor_user_id = p_user_id
        AND requested.source_message_id = p_source_message_id
        AND requested.action_id = p_action_id
        AND requested.event_kind = 'approval_requested'
    ) INTO v_had_approval_request;

    UPDATE public.couple_change_notifications AS notification
       SET read_at = COALESCE(notification.read_at, now())
     WHERE notification.couple_id = p_couple_id
       AND notification.source_message_id = p_source_message_id
       AND notification.action_id = p_action_id
       AND notification.event_kind IN (
         'approval_requested', 'approval_ready'
       );

    IF v_had_approval_request AND (
         v_recipient_user_id = p_user_id
         OR NOT public.is_current_couple_member(
           v_recipient_user_id,
           p_couple_id
         )
       ) THEN
      RAISE EXCEPTION 'AMORA_SHARED_ACTION_NOTIFICATION_RECIPIENT_INVALID'
        USING ERRCODE = '55000';
    END IF;

    IF v_had_approval_request THEN
      v_copy := public.amora_shared_action_notification_copy(
        v_context ->> 'tool',
        'approval_withdrawn'
      );

      INSERT INTO public.couple_change_notifications(
        couple_id,
        recipient_user_id,
        actor_user_id,
        source_message_id,
        action_id,
        event_kind,
        tool_name,
        title,
        message,
        href
      ) VALUES (
        p_couple_id,
        v_recipient_user_id,
        p_user_id,
        p_source_message_id,
        p_action_id,
        'approval_withdrawn',
        v_context ->> 'tool',
        v_copy ->> 'title',
        v_copy ->> 'message',
        v_copy ->> 'href'
      )
      ON CONFLICT (couple_id, recipient_user_id, action_id, event_kind)
        DO UPDATE
          SET actor_user_id = EXCLUDED.actor_user_id,
              source_message_id = EXCLUDED.source_message_id,
              tool_name = EXCLUDED.tool_name,
              title = EXCLUDED.title,
              message = EXCLUDED.message,
              href = EXCLUDED.href,
              read_at = NULL,
              created_at = now();
    END IF;
  END IF;

  RETURN v_status;
END;
$function$;

ALTER FUNCTION public.get_amora_shared_action_status(uuid, uuid, uuid, uuid)
  OWNER TO postgres;
ALTER FUNCTION public.accept_amora_shared_action(uuid, uuid, uuid, uuid)
  OWNER TO postgres;
ALTER FUNCTION public.claim_amora_shared_action_application(
  uuid, uuid, uuid, uuid
) OWNER TO postgres;
ALTER FUNCTION public.revoke_amora_shared_action_acceptance(
  uuid, uuid, uuid, uuid
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_amora_shared_action_status(
  uuid, uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.accept_amora_shared_action(
  uuid, uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_amora_shared_action_application(
  uuid, uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.revoke_amora_shared_action_acceptance(
  uuid, uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_amora_shared_action_status(
  uuid, uuid, uuid, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION public.accept_amora_shared_action(
  uuid, uuid, uuid, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_amora_shared_action_application(
  uuid, uuid, uuid, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_amora_shared_action_acceptance(
  uuid, uuid, uuid, uuid
) TO service_role;

-- Put the shared-action revision guard around the already-audited atomic
-- dispatcher without changing its request -> execution -> journey lock order.
-- This wrapper performs only a non-locking fence read. The private dispatcher
-- still obtains the authoritative locks, and the journey trigger above checks
-- the exact r -> r+1 transition while that row is locked.
ALTER FUNCTION public.apply_amora_atomic_tool_execution(
  uuid, text, text, integer, text, jsonb, jsonb, jsonb
) RENAME TO apply_amora_atomic_tool_execution_pre_shared_revision;

ALTER FUNCTION public.apply_amora_atomic_tool_execution_pre_shared_revision(
  uuid, text, text, integer, text, jsonb, jsonb, jsonb
) OWNER TO postgres;
REVOKE ALL ON FUNCTION
  public.apply_amora_atomic_tool_execution_pre_shared_revision(
    uuid, text, text, integer, text, jsonb, jsonb, jsonb
  )
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.apply_amora_atomic_tool_execution(
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
  v_pending_action_id uuid;
  v_pending_revision bigint;
  v_execution_status text;
  v_execution_tool_name text;
  v_execution_input_digest text;
  v_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_ATOMIC_TOOL_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  -- Deliberately no FOR UPDATE/SHARE here. The private dispatcher owns the
  -- established lock order and repeats the execution envelope validation.
  SELECT execution.pending_action_id,
         execution.pending_action_journey_revision,
         execution.status,
         execution.tool_name,
         execution.input_digest
    INTO v_pending_action_id,
         v_pending_revision,
         v_execution_status,
         v_execution_tool_name,
         v_execution_input_digest
  FROM public.amora_tool_executions AS execution
  WHERE execution.couple_id = p_couple_id
    AND execution.request_key = p_request_key
    AND execution.operation_key = p_operation_key;

  IF NOT FOUND OR v_pending_action_id IS NULL THEN
    RETURN public.apply_amora_atomic_tool_execution_pre_shared_revision(
      p_couple_id,
      p_request_key,
      p_operation_key,
      p_request_attempt_count,
      p_input_digest,
      p_tool_input,
      p_domain_mutation,
      p_result
    );
  END IF;

  -- Completed calls are delegated without installing a mutation marker so
  -- the private dispatcher's existing idempotent-result behavior is retained.
  IF v_execution_status = 'completed' THEN
    RETURN public.apply_amora_atomic_tool_execution_pre_shared_revision(
      p_couple_id,
      p_request_key,
      p_operation_key,
      p_request_attempt_count,
      p_input_digest,
      p_tool_input,
      p_domain_mutation,
      p_result
    );
  END IF;

  IF v_execution_status IS DISTINCT FROM 'processing'
     OR v_pending_revision IS NULL
     OR v_pending_revision NOT BETWEEN 0 AND 9007199254740991
     OR v_execution_input_digest IS DISTINCT FROM p_input_digest
     OR v_execution_tool_name IS DISTINCT FROM p_result ->> 'toolName'
     OR p_operation_key !~ '^[a-f0-9]{64}$'
     OR p_request_key IS NULL
     OR char_length(p_request_key) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_PROPOSAL_CHANGED'
      USING ERRCODE = '55000';
  END IF;

  PERFORM set_config(
    'hanbang.amora_shared_action_couple_id',
    p_couple_id::text,
    true
  );
  PERFORM set_config(
    'hanbang.amora_shared_action_request_key',
    p_request_key,
    true
  );
  PERFORM set_config(
    'hanbang.amora_shared_action_operation_key',
    p_operation_key,
    true
  );
  PERFORM set_config(
    'hanbang.amora_shared_action_action_id',
    v_pending_action_id::text,
    true
  );
  PERFORM set_config(
    'hanbang.amora_shared_action_expected_revision',
    v_pending_revision::text,
    true
  );
  PERFORM set_config(
    'hanbang.amora_shared_action_applied_revision',
    '',
    true
  );

  BEGIN
    v_result :=
      public.apply_amora_atomic_tool_execution_pre_shared_revision(
        p_couple_id,
        p_request_key,
        p_operation_key,
        p_request_attempt_count,
        p_input_digest,
        p_tool_input,
        p_domain_mutation,
        p_result
      );
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config(
      'hanbang.amora_shared_action_couple_id', '', true
    );
    PERFORM set_config(
      'hanbang.amora_shared_action_request_key', '', true
    );
    PERFORM set_config(
      'hanbang.amora_shared_action_operation_key', '', true
    );
    PERFORM set_config(
      'hanbang.amora_shared_action_action_id', '', true
    );
    PERFORM set_config(
      'hanbang.amora_shared_action_expected_revision', '', true
    );
    PERFORM set_config(
      'hanbang.amora_shared_action_applied_revision', '', true
    );
    RAISE;
  END;

  PERFORM set_config(
    'hanbang.amora_shared_action_couple_id', '', true
  );
  PERFORM set_config(
    'hanbang.amora_shared_action_request_key', '', true
  );
  PERFORM set_config(
    'hanbang.amora_shared_action_operation_key', '', true
  );
  PERFORM set_config(
    'hanbang.amora_shared_action_action_id', '', true
  );
  PERFORM set_config(
    'hanbang.amora_shared_action_expected_revision', '', true
  );
  PERFORM set_config(
    'hanbang.amora_shared_action_applied_revision', '', true
  );
  RETURN v_result;
END;
$function$;

ALTER FUNCTION public.apply_amora_atomic_tool_execution(
  uuid, text, text, integer, text, jsonb, jsonb, jsonb
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.apply_amora_atomic_tool_execution(
  uuid, text, text, integer, text, jsonb, jsonb, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_amora_atomic_tool_execution(
  uuid, text, text, integer, text, jsonb, jsonb, jsonb
) TO service_role;

CREATE OR REPLACE FUNCTION public.authorize_amora_shared_action_execution(
  p_action_id uuid,
  p_couple_id uuid,
  p_source_message_id uuid,
  p_confirmation_message_id uuid,
  p_user_id uuid
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
  v_accepted_count integer := 0;
  v_application_claim public.amora_shared_action_application_claims%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  v_context := public.amora_shared_action_context(
    p_action_id,
    p_couple_id,
    p_source_message_id,
    p_user_id,
    'execution',
    p_confirmation_message_id
  );

  IF v_context ->> 'policy' = 'couple' THEN
    IF EXISTS (
      SELECT 1
      FROM public.amora_shared_action_acceptances AS acceptance
      WHERE acceptance.couple_id = p_couple_id
        AND acceptance.source_message_id = p_source_message_id
        AND acceptance.action_id = p_action_id
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
    WHERE acceptance.couple_id = p_couple_id
      AND acceptance.source_message_id = p_source_message_id
      AND acceptance.action_id = p_action_id
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

  -- The chat INSERT trigger is the only place allowed to bind a lease. The
  -- execution boundary therefore accepts only that already-bound, exact
  -- confirmation. A lease may expire after it was atomically consumed; expiry
  -- is intentionally irrelevant once confirmation_message_id is durable.
  SELECT claim.*
    INTO v_application_claim
  FROM public.amora_shared_action_application_claims AS claim
  WHERE claim.couple_id = p_couple_id
    AND claim.source_message_id = p_source_message_id
    AND claim.action_id = p_action_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_application_claim.claimed_by_user_id IS DISTINCT FROM p_user_id
     OR v_application_claim.proposal_digest
       IS DISTINCT FROM v_context ->> 'proposalDigest'
     OR v_application_claim.roster_fingerprint
       IS DISTINCT FROM v_context ->> 'rosterFingerprint'
     OR v_application_claim.confirmation_message_id
       IS DISTINCT FROM p_confirmation_message_id THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_APPLICATION_CLAIM_INVALID'
      USING ERRCODE = '55000';
  END IF;

  RETURN v_context || jsonb_build_object(
    'authorized', true,
    'approvalMode', v_context ->> 'policy',
    'acceptedCount', v_accepted_count,
    'ready', true
  );
END;
$function$;

ALTER FUNCTION public.authorize_amora_shared_action_execution(
  uuid, uuid, uuid, uuid, uuid
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.authorize_amora_shared_action_execution(
  uuid, uuid, uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.authorize_amora_shared_action_execution(
  uuid, uuid, uuid, uuid, uuid
) TO service_role;

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

  -- A processing insert is the pre-domain-write fence. A successful
  -- completion is checked again so an atomic dispatcher rolls its domain
  -- mutation back if the canonical context changed in flight.
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

  -- Resolve only the canonical row immediately before the claim's durable
  -- confirmation. This prevents a duplicate action UUID elsewhere in history
  -- from becoming an alternate authority.
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
             AND receipt.applied_revision =
               v_current_journey_revision
         ) THEN
        RAISE EXCEPTION 'AMORA_SHARED_ACTION_PROPOSAL_CHANGED'
          USING ERRCODE = '55000';
      END IF;
    ELSIF NEW.tool_name = 'add_amora_action' THEN
      -- A new action row is independent of existing action state. It must
      -- complete against unchanged journey state and never borrow a receipt.
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
    ELSE
      RAISE EXCEPTION 'AMORA_SHARED_ACTION_BLOCKED'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Ignore any caller-supplied value. The immutable execution fence stores
    -- only the revision authenticated from the exact source proposal.
    NEW.pending_action_journey_revision :=
      (v_context ->> 'journeyRevision')::bigint;
  ELSIF NEW.pending_action_journey_revision IS NULL THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_PROPOSAL_CHANGED'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_amora_shared_action_execution()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_enforce_amora_shared_action_execution
  BEFORE INSERT OR UPDATE
  ON public.amora_tool_executions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_amora_shared_action_execution();

CREATE OR REPLACE FUNCTION public.notify_amora_shared_action_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_actor_user_id uuid;
  v_confirmation_message_id uuid;
  v_source_message_id uuid;
  v_recipient_user_id uuid;
  v_copy jsonb;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status IS NOT DISTINCT FROM 'completed'
       OR NEW.status IS DISTINCT FROM 'completed' THEN
      RETURN NEW;
    END IF;
  ELSIF NEW.status IS DISTINCT FROM 'completed' THEN
    RETURN NEW;
  END IF;

  IF NEW.pending_action_id IS NULL
     OR jsonb_typeof(NEW.result -> 'success') IS DISTINCT FROM 'boolean'
     OR NOT (NEW.result ->> 'success')::boolean THEN
    RETURN NEW;
  END IF;

  SELECT claim.user_id, claim.user_message_id
    INTO v_actor_user_id, v_confirmation_message_id
  FROM public.amora_chat_request_claims AS claim
  WHERE claim.couple_id = NEW.couple_id
    AND claim.request_key = NEW.request_key
    AND claim.status = 'processing'
    AND claim.visibility = 'shared'
    AND claim.user_message_id IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_EXECUTION_CLAIM_INVALID'
      USING ERRCODE = '55000';
  END IF;

  -- Bind the notification to the exact proposal immediately before the
  -- durable confirmation, matching the execution fence above.
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
  WHERE ordered.id = v_confirmation_message_id
    AND prior.sender_id IS NULL
    AND prior.sender_type = 'ai'
    AND prior.role = 'assistant'
    AND prior.metadata #>> '{pending_amora_action,actionId}'
      = NEW.pending_action_id::text
    AND prior.metadata #>> '{pending_amora_action,tool}' = NEW.tool_name;
  IF v_source_message_id IS NULL THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_EXECUTION_CONTEXT_INVALID'
      USING ERRCODE = '55000';
  END IF;

  SELECT CASE
      WHEN couple.bride_id = v_actor_user_id THEN couple.groom_id
      WHEN couple.groom_id = v_actor_user_id THEN couple.bride_id
      ELSE NULL
    END
    INTO v_recipient_user_id
  FROM public.couples AS couple
  WHERE couple.id = NEW.couple_id;

  IF v_recipient_user_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF v_recipient_user_id = v_actor_user_id
     OR NOT public.is_current_couple_member(
       v_recipient_user_id,
       NEW.couple_id
     ) THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_NOTIFICATION_RECIPIENT_INVALID'
      USING ERRCODE = '55000';
  END IF;

  v_copy := public.amora_shared_action_notification_copy(
    NEW.tool_name,
    'change_applied'
  );

  -- Success supersedes every pre-apply state for both members. Preserve those
  -- rows as audit history while leaving only the applied event unread.
  UPDATE public.couple_change_notifications AS notification
     SET read_at = COALESCE(notification.read_at, now())
   WHERE notification.couple_id = NEW.couple_id
     AND notification.source_message_id = v_source_message_id
     AND notification.action_id = NEW.pending_action_id
     AND notification.event_kind IN (
       'approval_requested', 'approval_ready', 'approval_withdrawn'
     );

  INSERT INTO public.couple_change_notifications(
    couple_id,
    recipient_user_id,
    actor_user_id,
    source_message_id,
    action_id,
    event_kind,
    tool_name,
    title,
    message,
    href
  ) VALUES (
    NEW.couple_id,
    v_recipient_user_id,
    v_actor_user_id,
    v_source_message_id,
    NEW.pending_action_id,
    'change_applied',
    NEW.tool_name,
    v_copy ->> 'title',
    v_copy ->> 'message',
    v_copy ->> 'href'
  )
  ON CONFLICT (couple_id, recipient_user_id, action_id, event_kind)
    DO NOTHING;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_amora_shared_action_completion()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_notify_amora_shared_action_completion
  AFTER INSERT OR UPDATE
  ON public.amora_tool_executions
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_amora_shared_action_completion();

DO $realtime_publication$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_publication
    WHERE pubname = 'supabase_realtime'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'couple_change_notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.couple_change_notifications;
  END IF;
END
$realtime_publication$;

DO $postchecks$
BEGIN
  IF to_regprocedure(
       'public.apply_amora_atomic_tool_execution(uuid,text,text,integer,text,jsonb,jsonb,jsonb)'
     ) IS NULL
     OR to_regprocedure(
       'public.apply_amora_atomic_tool_execution_pre_shared_revision(uuid,text,text,integer,text,jsonb,jsonb,jsonb)'
     ) IS NULL
     OR has_function_privilege(
       'authenticated',
       'public.apply_amora_atomic_tool_execution(uuid,text,text,integer,text,jsonb,jsonb,jsonb)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.apply_amora_atomic_tool_execution(uuid,text,text,integer,text,jsonb,jsonb,jsonb)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.apply_amora_atomic_tool_execution_pre_shared_revision(uuid,text,text,integer,text,jsonb,jsonb,jsonb)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_REVISION_POSTCHECK_FAILED';
  END IF;
END
$postchecks$;

COMMIT;
