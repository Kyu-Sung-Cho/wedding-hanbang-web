BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Upgrade databases that already installed the original responder foundation:
-- deleting a request must retain the consumed UUID as a terminal tombstone.
ALTER TABLE public.responder_capacity_slots
  DROP CONSTRAINT IF EXISTS responder_capacity_slots_consumed_request;

CREATE OR REPLACE FUNCTION public.community_guard_slot_terminal_consumption()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.consumed_request_id IS NOT NULL
    AND NEW.consumed_request_id IS DISTINCT FROM OLD.consumed_request_id THEN
    RAISE EXCEPTION 'consumed_request_id is terminal one-shot'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.consumed_request_id IS NOT NULL
    AND (
      TG_OP = 'INSERT'
      OR OLD.consumed_request_id IS NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.community_responder_requests AS request
      WHERE request.id = NEW.consumed_request_id
        AND request.capacity_slot_id = NEW.id
        AND request.status = 'accepted'
    ) THEN
    RAISE EXCEPTION 'consumed_request_id requires accepted request for slot'
      USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.community_guard_slot_terminal_consumption()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS responder_capacity_slots_terminal_consumption
  ON public.responder_capacity_slots;
CREATE TRIGGER responder_capacity_slots_terminal_consumption
BEFORE INSERT OR UPDATE OF consumed_request_id
ON public.responder_capacity_slots
FOR EACH ROW
EXECUTE FUNCTION public.community_guard_slot_terminal_consumption();

-- A block is a private viewer control, not a moderation verdict. The target is
-- never notified, report/appeal evidence is untouched, and public logged-out
-- URLs retain their existing publication contract.
CREATE TABLE public.community_viewer_controls (
  blocker_user_id uuid NOT NULL
    REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_user_id uuid NOT NULL
    REFERENCES auth.users(id) ON DELETE CASCADE,
  reason_category text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  PRIMARY KEY (blocker_user_id, blocked_user_id),
  CONSTRAINT community_viewer_controls_not_self
    CHECK (blocker_user_id <> blocked_user_id),
  CONSTRAINT community_viewer_controls_reason
    CHECK (
      reason_category IS NULL
      OR reason_category IN (
        'safety',
        'harassment',
        'unwanted_contact',
        'irrelevant',
        'other'
      )
    ),
  CONSTRAINT community_viewer_controls_time_order
    CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX community_viewer_controls_blocked_active_idx
  ON public.community_viewer_controls(blocked_user_id, blocker_user_id)
  WHERE revoked_at IS NULL;

CREATE TABLE public.community_viewer_control_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  blocker_erased_at timestamptz,
  blocked_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  blocked_erased_at timestamptz,
  action text NOT NULL CHECK (action IN ('block', 'unblock')),
  reason_category text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT community_viewer_control_events_not_self
    CHECK (blocker_user_id <> blocked_user_id),
  CONSTRAINT community_viewer_control_events_blocker_identity
    CHECK (
      (blocker_user_id IS NOT NULL AND blocker_erased_at IS NULL)
      OR (blocker_user_id IS NULL AND blocker_erased_at IS NOT NULL)
    ),
  CONSTRAINT community_viewer_control_events_blocked_identity
    CHECK (
      (blocked_user_id IS NOT NULL AND blocked_erased_at IS NULL)
      OR (blocked_user_id IS NULL AND blocked_erased_at IS NOT NULL)
    ),
  CONSTRAINT community_viewer_control_events_reason
    CHECK (
      reason_category IS NULL
      OR reason_category IN (
        'safety',
        'harassment',
        'unwanted_contact',
        'irrelevant',
        'other'
      )
    )
);

ALTER TABLE public.community_viewer_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_viewer_control_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.community_viewer_controls
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT (
  blocked_user_id,
  reason_category,
  created_at,
  updated_at,
  revoked_at
) ON public.community_viewer_controls TO authenticated;
GRANT SELECT ON public.community_viewer_controls TO service_role;

REVOKE ALL ON TABLE public.community_viewer_control_events
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.community_viewer_control_events TO service_role;

CREATE POLICY community_viewer_controls_owner_select
  ON public.community_viewer_controls
  FOR SELECT TO authenticated
  USING (blocker_user_id = auth.uid());

CREATE POLICY community_viewer_controls_service_select
  ON public.community_viewer_controls
  FOR SELECT TO service_role
  USING (true);

CREATE POLICY community_viewer_control_events_service_select
  ON public.community_viewer_control_events
  FOR SELECT TO service_role
  USING (true);

CREATE SCHEMA IF NOT EXISTS community_private;
REVOKE ALL ON SCHEMA community_private FROM PUBLIC;
REVOKE ALL ON SCHEMA community_private FROM anon, authenticated;
GRANT USAGE ON SCHEMA community_private TO service_role;

-- Kept out of the exposed public API schema so a caller cannot probe whether
-- somebody else blocked them. RLS policies and triggers share this one
-- symmetric predicate.
CREATE OR REPLACE FUNCTION community_private.users_are_blocked(
  p_left_user_id uuid,
  p_right_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN p_left_user_id IS NULL
      OR p_right_user_id IS NULL
      OR p_left_user_id = p_right_user_id THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.community_viewer_controls AS control
      WHERE control.revoked_at IS NULL
        AND (
          (
            control.blocker_user_id = p_left_user_id
            AND control.blocked_user_id = p_right_user_id
          )
          OR (
            control.blocker_user_id = p_right_user_id
            AND control.blocked_user_id = p_left_user_id
          )
        )
    )
  END
$$;

REVOKE ALL ON FUNCTION community_private.users_are_blocked(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- RLS needs a row predicate, but exposing a parameterized predicate from the
-- PostgREST `public` schema would let a signed-in user probe who blocked whom.
-- The policy helper is executable by authenticated row readers while the
-- private schema itself remains unusable, so it cannot be called as an RPC.
CREATE OR REPLACE FUNCTION community_private.viewer_can_see_current_user(
  p_other_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL OR p_other_user_id IS NULL THEN true
    ELSE NOT community_private.users_are_blocked(
      auth.uid(),
      p_other_user_id
    )
  END
$$;

REVOKE ALL ON FUNCTION
  community_private.viewer_can_see_current_user(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  community_private.viewer_can_see_current_user(uuid)
  TO anon, authenticated, service_role;

-- Server routes authenticate the caller first, then ask this actor-explicit
-- service-only function. Never derive the viewer from a service JWT: its
-- `auth.uid()` is normally null and would silently bypass the block boundary.
DROP FUNCTION IF EXISTS public.community_viewer_can_see(uuid);
CREATE OR REPLACE FUNCTION public.community_viewer_can_see(
  p_viewer_user_id uuid,
  p_other_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.community_request_is_service() THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'service role required';
  END IF;
  IF p_viewer_user_id IS NULL OR p_other_user_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'viewer and other user are required';
  END IF;
  RETURN NOT community_private.users_are_blocked(
    p_viewer_user_id,
    p_other_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.community_viewer_can_see(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_viewer_can_see(uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION community_private.guard_viewer_control_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT'
    AND COALESCE(
      current_setting('hanbang.community_viewer_control_event_write', true),
      ''
    ) = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
    AND COALESCE(
      current_setting(
        'hanbang.community_viewer_control_event_tombstone_write',
        true
      ),
      ''
    ) = 'on'
    AND NEW.id IS NOT DISTINCT FROM OLD.id
    AND NEW.action IS NOT DISTINCT FROM OLD.action
    AND NEW.reason_category IS NOT DISTINCT FROM OLD.reason_category
    AND NEW.metadata IS NOT DISTINCT FROM OLD.metadata
    AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
    AND (
      (
        NEW.blocker_user_id IS NOT DISTINCT FROM OLD.blocker_user_id
        AND NEW.blocker_erased_at IS NOT DISTINCT FROM OLD.blocker_erased_at
      )
      OR (
        OLD.blocker_user_id IS NOT NULL
        AND OLD.blocker_erased_at IS NULL
        AND NEW.blocker_user_id IS NULL
        AND NEW.blocker_erased_at IS NOT NULL
      )
    )
    AND (
      (
        NEW.blocked_user_id IS NOT DISTINCT FROM OLD.blocked_user_id
        AND NEW.blocked_erased_at IS NOT DISTINCT FROM OLD.blocked_erased_at
      )
      OR (
        OLD.blocked_user_id IS NOT NULL
        AND OLD.blocked_erased_at IS NULL
        AND NEW.blocked_user_id IS NULL
        AND NEW.blocked_erased_at IS NOT NULL
      )
    ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'viewer control events are append-only'
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION community_private.guard_viewer_control_event()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER community_viewer_control_events_append_only
BEFORE INSERT OR UPDATE OR DELETE
ON public.community_viewer_control_events
FOR EACH ROW
EXECUTE FUNCTION community_private.guard_viewer_control_event();

CREATE OR REPLACE FUNCTION community_private.tombstone_viewer_control_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM set_config(
    'hanbang.community_viewer_control_event_tombstone_write',
    'on',
    true
  );

  UPDATE public.community_viewer_control_events
  SET blocker_user_id = NULL,
      blocker_erased_at = clock_timestamp()
  WHERE blocker_user_id = OLD.id;

  UPDATE public.community_viewer_control_events
  SET blocked_user_id = NULL,
      blocked_erased_at = clock_timestamp()
  WHERE blocked_user_id = OLD.id;

  PERFORM set_config(
    'hanbang.community_viewer_control_event_tombstone_write',
    'off',
    true
  );
  RETURN OLD;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config(
    'hanbang.community_viewer_control_event_tombstone_write',
    'off',
    true
  );
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION community_private.tombstone_viewer_control_events()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER community_viewer_control_events_user_tombstone
BEFORE DELETE ON auth.users
FOR EACH ROW
EXECUTE FUNCTION community_private.tombstone_viewer_control_events();

-- Remove the old arbitrary two-user probe entirely. Internal definer-owned
-- policies use the private predicate without exposing an exact block oracle.
DROP FUNCTION IF EXISTS public.community_service_users_are_blocked(uuid, uuid);

-- The private responder supply ledger must bind a question to the member who
-- asked it before any direct responder request can exist. No question body,
-- exact date, budget, venue, or region is added here.
ALTER TABLE public.community_responder_questions
  ADD COLUMN requester_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN requester_bound_at timestamptz,
  ADD COLUMN requester_binding_idempotency_key uuid UNIQUE;

-- Questions created before requester identity became mandatory cannot be
-- attributed safely. Do not guess ownership from nearby profile/couple data.
-- Withdraw those questions, close their open work, release capacity, and leave
-- the same append-only audit evidence as every other request finalization.
DO $$
DECLARE
  v_candidate record;
  v_request public.community_responder_requests%ROWTYPE;
  v_slot public.responder_capacity_slots%ROWTYPE;
  v_expiry_key uuid;
  v_actor_id uuid;
  v_previous_status text;
BEGIN
  UPDATE public.community_responder_questions
  SET intake_status = 'withdrawn'
  WHERE requester_id IS NULL;

  FOR v_candidate IN
    SELECT
      request.id,
      request.responder_id,
      request.capacity_slot_id
    FROM public.community_responder_requests AS request
    JOIN public.community_responder_questions AS question
      ON question.id = request.question_id
    WHERE question.requester_id IS NULL
      AND request.status IN ('requested', 'accepted')
    ORDER BY
      request.responder_id,
      request.capacity_slot_id,
      request.id
  LOOP
    -- Match the established responder transition lock order: identity, slot,
    -- then request. The migration itself is atomic, but preserving this order
    -- also prevents a deploy-time worker from deadlocking the quarantine.
    PERFORM public.community_lock_responder_identity(v_candidate.responder_id);

    SELECT slot.*
    INTO v_slot
    FROM public.responder_capacity_slots AS slot
    WHERE slot.id = v_candidate.capacity_slot_id
    FOR UPDATE;

    SELECT request.*
    INTO v_request
    FROM public.community_responder_requests AS request
    JOIN public.community_responder_questions AS question
      ON question.id = request.question_id
    WHERE request.id = v_candidate.id
      AND question.requester_id IS NULL
      AND request.status IN ('requested', 'accepted')
    FOR UPDATE OF request;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_previous_status := v_request.status;
    v_expiry_key := gen_random_uuid();
    v_actor_id := v_request.created_by_operator;

    UPDATE public.community_responder_requests
    SET status = 'expired',
        expiry_idempotency_key = v_expiry_key,
        expiry_reason_code = 'requester_identity_unbound',
        expired_at = clock_timestamp(),
        updated_at = clock_timestamp()
    WHERE id = v_request.id
    RETURNING * INTO v_request;

    IF v_actor_id IS NOT NULL THEN
      PERFORM public.community_write_responder_supply_event(
        'request_expired',
        v_request.question_id,
        v_request.id,
        v_request.capacity_slot_id,
        'operator',
        v_actor_id,
        v_expiry_key,
        v_previous_status,
        'expired',
        'requester_identity_unbound',
        COALESCE(
          v_request.response_commercial_relationship,
          v_request.commercial_relationship_at_request
        ),
        COALESCE(v_request.response_has_conflict, v_request.conflict_at_request)
      );
    ELSE
      -- A deleted legacy operator is represented as erased, never guessed.
      PERFORM set_config(
        'hanbang.community_responder_event_write',
        'on',
        true
      );
      INSERT INTO public.community_responder_supply_events (
        event_type,
        question_id,
        request_id,
        capacity_slot_id,
        actor_type,
        actor_id,
        actor_erased_at,
        operation_idempotency_key,
        previous_status,
        new_status,
        reason_code,
        commercial_relationship,
        has_conflict
      ) VALUES (
        'request_expired',
        v_request.question_id,
        v_request.id,
        v_request.capacity_slot_id,
        'operator',
        NULL,
        clock_timestamp(),
        v_expiry_key,
        v_previous_status,
        'expired',
        'requester_identity_unbound',
        COALESCE(
          v_request.response_commercial_relationship,
          v_request.commercial_relationship_at_request
        ),
        COALESCE(v_request.response_has_conflict, v_request.conflict_at_request)
      );
      PERFORM set_config(
        'hanbang.community_responder_event_write',
        'off',
        true
      );
    END IF;
  END LOOP;
END
$$;

-- All commands that can create or terminate direct work between two members
-- take these identity rows in UUID order. The rows already exist, so this gives
-- both block and request creation one deterministic, transaction-scoped mutex
-- without exposing a probeable pair table.
CREATE OR REPLACE FUNCTION community_private.lock_user_pair(
  p_left_user_id uuid,
  p_right_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_locked_count integer;
BEGIN
  IF p_left_user_id IS NULL
    OR p_right_user_id IS NULL
    OR p_left_user_id = p_right_user_id THEN
    RAISE EXCEPTION 'invalid community user pair'
      USING ERRCODE = '22023';
  END IF;

  PERFORM app_user.id
  FROM auth.users AS app_user
  WHERE app_user.id IN (p_left_user_id, p_right_user_id)
  ORDER BY app_user.id
  FOR UPDATE;
  GET DIAGNOSTICS v_locked_count = ROW_COUNT;

  IF v_locked_count <> 2 THEN
    RAISE EXCEPTION 'community user pair not found'
      USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION community_private.lock_user_pair(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- A requester can now be the truthful initiator of a request-expiration event
-- when their private viewer control terminates direct responder work.
ALTER TABLE public.community_responder_supply_events
  DROP CONSTRAINT community_responder_supply_events_actor;
ALTER TABLE public.community_responder_supply_events
  ADD CONSTRAINT community_responder_supply_events_actor
  CHECK (
    actor_type IN ('responder', 'operator', 'requester')
    AND (
      (actor_id IS NOT NULL AND actor_erased_at IS NULL)
      OR (actor_id IS NULL AND actor_erased_at IS NOT NULL)
    )
  );

CREATE OR REPLACE FUNCTION public.community_bind_responder_question_requester(
  p_question_id uuid,
  p_requester_id uuid,
  p_topic text,
  p_experience_scope text,
  p_operator_id uuid,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_question public.community_responder_questions%ROWTYPE;
  v_replayed boolean := false;
BEGIN
  PERFORM public.community_assert_responder_operator(p_operator_id);
  PERFORM public.community_assert_responder_runtime_normal();

  IF p_question_id IS NULL
    OR p_requester_id IS NULL
    OR p_idempotency_key IS NULL
    OR p_topic <> 'contract_extra_cost'
    OR p_experience_scope NOT IN (
      'contract_terms',
      'extra_charge',
      'vendor_response',
      'cancellation_refund'
    )
    OR NOT EXISTS (
      SELECT 1 FROM auth.users AS app_user
      WHERE app_user.id = p_requester_id
    ) THEN
    RAISE EXCEPTION 'invalid responder question requester binding'
      USING ERRCODE = '22023';
  END IF;

  -- Serialize same-requester binding attempts before the question row exists.
  PERFORM 1
  FROM auth.users AS app_user
  WHERE app_user.id = p_requester_id
  FOR UPDATE;

  SELECT question.*
  INTO v_question
  FROM public.community_responder_questions AS question
  WHERE question.id = p_question_id
     OR question.requester_binding_idempotency_key = p_idempotency_key
  ORDER BY (question.id = p_question_id) DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF v_question.id IS DISTINCT FROM p_question_id
      OR v_question.requester_id IS DISTINCT FROM p_requester_id
      OR v_question.topic IS DISTINCT FROM p_topic
      OR v_question.experience_scope IS DISTINCT FROM p_experience_scope
      OR v_question.created_by_operator IS DISTINCT FROM p_operator_id
      OR v_question.requester_binding_idempotency_key
        IS DISTINCT FROM p_idempotency_key THEN
      RAISE EXCEPTION 'responder question binding idempotency conflict'
        USING ERRCODE = '23505';
    END IF;
    v_replayed := true;
  ELSE
    INSERT INTO public.community_responder_questions (
      id,
      requester_id,
      requester_bound_at,
      requester_binding_idempotency_key,
      topic,
      experience_scope,
      created_by_operator
    ) VALUES (
      p_question_id,
      p_requester_id,
      clock_timestamp(),
      p_idempotency_key,
      p_topic,
      p_experience_scope,
      p_operator_id
    )
    RETURNING * INTO v_question;
  END IF;

  RETURN jsonb_build_object(
    'question_id', v_question.id,
    'requester_id', v_question.requester_id,
    'topic', v_question.topic,
    'experience_scope', v_question.experience_scope,
    'replayed', v_replayed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.community_bind_responder_question_requester(
  uuid, uuid, text, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;

-- The only externally callable request issuer after this migration binds the
-- requester and consumes responder capacity in one transaction. The legacy
-- eight-argument issuer remains owner-internal so the wrapper can reuse the
-- mature supply checks without allowing a service caller to omit identity.
CREATE OR REPLACE FUNCTION public.community_create_bound_responder_request(
  p_question_id uuid,
  p_requester_id uuid,
  p_capacity_slot_id uuid,
  p_requested_role text,
  p_topic text,
  p_experience_scope text,
  p_expires_at timestamptz,
  p_operator_id uuid,
  p_requester_binding_idempotency_key uuid,
  p_request_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_responder_id uuid;
  v_locked_responder_id uuid;
  v_existing_request public.community_responder_requests%ROWTYPE;
  v_existing_requester_id uuid;
  v_existing_binding_key uuid;
BEGIN
  PERFORM public.community_assert_responder_operator(p_operator_id);

  IF p_requester_binding_idempotency_key IS NULL
    OR p_request_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'requester-aware responder request requires idempotency keys'
      USING ERRCODE = '22023';
  END IF;

  SELECT slot.responder_id
  INTO v_responder_id
  FROM public.responder_capacity_slots AS slot
  WHERE slot.id = p_capacity_slot_id;

  IF v_responder_id IS NULL THEN
    RAISE EXCEPTION 'capacity slot not found'
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM community_private.lock_user_pair(
    p_requester_id,
    v_responder_id
  );

  -- The responder identity is immutable through supported commands. Re-read it
  -- after the pair lock and fail retryably if an out-of-band owner mutation
  -- raced this command instead of ever locking the wrong pair.
  SELECT slot.responder_id
  INTO v_locked_responder_id
  FROM public.responder_capacity_slots AS slot
  WHERE slot.id = p_capacity_slot_id;

  IF v_locked_responder_id IS DISTINCT FROM v_responder_id THEN
    RAISE EXCEPTION 'capacity responder changed while locking pair'
      USING ERRCODE = '40001';
  END IF;

  SELECT request.*
  INTO v_existing_request
  FROM public.community_responder_requests AS request
  WHERE request.request_idempotency_key = p_request_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    SELECT
      question.requester_id,
      question.requester_binding_idempotency_key
    INTO v_existing_requester_id, v_existing_binding_key
    FROM public.community_responder_questions AS question
    WHERE question.id = v_existing_request.question_id;

    IF v_existing_request.question_id IS DISTINCT FROM p_question_id
      OR v_existing_requester_id IS DISTINCT FROM p_requester_id
      OR v_existing_binding_key
        IS DISTINCT FROM p_requester_binding_idempotency_key THEN
      RAISE EXCEPTION 'bound responder request idempotency conflict'
        USING ERRCODE = '22023';
    END IF;

    RETURN public.community_create_responder_request(
      p_question_id,
      p_capacity_slot_id,
      p_requested_role,
      p_topic,
      p_experience_scope,
      p_expires_at,
      p_operator_id,
      p_request_idempotency_key
    );
  END IF;

  PERFORM public.community_bind_responder_question_requester(
    p_question_id,
    p_requester_id,
    p_topic,
    p_experience_scope,
    p_operator_id,
    p_requester_binding_idempotency_key
  );

  RETURN public.community_create_responder_request(
    p_question_id,
    p_capacity_slot_id,
    p_requested_role,
    p_topic,
    p_experience_scope,
    p_expires_at,
    p_operator_id,
    p_request_idempotency_key
  );
END;
$$;

REVOKE ALL ON FUNCTION public.community_create_responder_request(
  uuid, uuid, text, text, text, timestamptz, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_create_bound_responder_request(
  uuid, uuid, uuid, text, text, text, timestamptz, uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_create_bound_responder_request(
  uuid, uuid, uuid, text, text, text, timestamptz, uuid, uuid, uuid
) TO service_role;

CREATE OR REPLACE FUNCTION community_private.guard_responder_request_block()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_requester_id uuid;
BEGIN
  SELECT question.requester_id
  INTO v_requester_id
  FROM public.community_responder_questions AS question
  WHERE question.id = NEW.question_id;

  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'responder question requester binding required'
      USING ERRCODE = '42501';
  END IF;

  IF community_private.users_are_blocked(
    v_requester_id,
    NEW.responder_id
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_INTERACTION_BLOCKED'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION community_private.guard_responder_request_block()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER community_responder_requests_block_boundary
BEFORE INSERT OR UPDATE OF question_id, responder_id
ON public.community_responder_requests
FOR EACH ROW
EXECUTE FUNCTION community_private.guard_responder_request_block();

-- Preserve the mature responder transition implementation as an owner-only
-- primitive, then put the block pair lock and final block recheck in front of
-- every new acceptance. Declines remain an always-available safety exit.
ALTER FUNCTION public.community_respond_responder_request(
  uuid, uuid, text, text, boolean, text, uuid
) RENAME TO community_respond_responder_request_without_viewer_control;

REVOKE ALL ON FUNCTION public.community_respond_responder_request_without_viewer_control(
  uuid, uuid, text, text, boolean, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.community_respond_responder_request(
  p_responder_id uuid,
  p_request_id uuid,
  p_decision text,
  p_commercial_relationship text,
  p_has_conflict boolean,
  p_decline_reason_code text,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_request public.community_responder_requests%ROWTYPE;
  v_requester_id uuid;
  v_locked_requester_id uuid;
  v_locked_responder_id uuid;
BEGIN
  IF NOT public.community_request_is_service()
    OR p_responder_id IS NULL THEN
    RAISE EXCEPTION 'verified service responder actor required'
      USING ERRCODE = '42501';
  END IF;

  IF p_decision <> 'accept' THEN
    RETURN public.community_respond_responder_request_without_viewer_control(
      p_responder_id,
      p_request_id,
      p_decision,
      p_commercial_relationship,
      p_has_conflict,
      p_decline_reason_code,
      p_idempotency_key
    );
  END IF;

  SELECT request.*
  INTO v_request
  FROM public.community_responder_requests AS request
  WHERE request.id = p_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'responder request not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT question.requester_id
  INTO v_requester_id
  FROM public.community_responder_questions AS question
  WHERE question.id = v_request.question_id;

  -- Exact completed receipts are reads of an earlier decision, not a new
  -- interaction. The owner-only primitive still validates the full payload.
  IF v_request.response_idempotency_key = p_idempotency_key THEN
    RETURN public.community_respond_responder_request_without_viewer_control(
      p_responder_id,
      p_request_id,
      p_decision,
      p_commercial_relationship,
      p_has_conflict,
      p_decline_reason_code,
      p_idempotency_key
    );
  END IF;

  IF v_request.responder_id IS DISTINCT FROM p_responder_id
    OR v_requester_id IS NULL THEN
    RAISE EXCEPTION 'only the requested responder can decide'
      USING ERRCODE = '42501';
  END IF;

  PERFORM community_private.lock_user_pair(
    v_requester_id,
    p_responder_id
  );

  SELECT question.requester_id, request.responder_id
  INTO v_locked_requester_id, v_locked_responder_id
  FROM public.community_responder_requests AS request
  JOIN public.community_responder_questions AS question
    ON question.id = request.question_id
  WHERE request.id = p_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'responder request not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_locked_requester_id IS DISTINCT FROM v_requester_id
    OR v_locked_responder_id IS DISTINCT FROM p_responder_id THEN
    RAISE EXCEPTION 'responder request pair changed while locking'
      USING ERRCODE = '40001';
  END IF;

  IF community_private.users_are_blocked(
    v_locked_requester_id,
    v_locked_responder_id
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_INTERACTION_BLOCKED'
      USING ERRCODE = '42501';
  END IF;

  RETURN public.community_respond_responder_request_without_viewer_control(
    p_responder_id,
    p_request_id,
    p_decision,
    p_commercial_relationship,
    p_has_conflict,
    p_decline_reason_code,
    p_idempotency_key
  );
END;
$$;

REVOKE ALL ON FUNCTION public.community_respond_responder_request(
  uuid, uuid, text, text, boolean, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_respond_responder_request(
  uuid, uuid, text, text, boolean, text, uuid
) TO service_role;

-- Historical acceptance remains auditable, but a currently blocked pair can
-- never contribute confirmed supply or move a question to ready-for-review.
CREATE OR REPLACE VIEW public.community_responder_question_supply
WITH (security_barrier = true)
AS
WITH request_supply AS (
  SELECT
    question.id AS question_id,
    question.topic,
    question.experience_scope,
    question.intake_status,
    request.id AS request_id,
    request.status,
    request.requested_role,
    request.responder_origin,
    request.supply_lane,
    slot.id AS slot_id,
    CASE
      WHEN request.status = 'accepted'
        AND slot.consumed_request_id = request.id
        AND slot.opt_in_status = 'active'
        AND slot.eligibility_status = 'verified_human_experience'
        AND slot.has_conflict IS FALSE
        AND request.response_has_conflict IS FALSE
        AND slot.available_from <= now()
        AND slot.available_until > now()
        AND EXISTS (
          SELECT 1
          FROM public.community_profiles AS profile
          WHERE profile.user_id = slot.responder_id
            AND COALESCE(profile.is_suspended, false) = false
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.community_agent_personas AS persona
          WHERE persona.backing_user_id = slot.responder_id
        )
        AND NOT community_private.users_are_blocked(
          question.requester_id,
          slot.responder_id
        )
        THEN true
      ELSE false
    END AS is_confirmed
  FROM public.community_responder_questions AS question
  LEFT JOIN public.community_responder_requests AS request
    ON request.question_id = question.id
  LEFT JOIN public.responder_capacity_slots AS slot
    ON slot.id = request.capacity_slot_id
)
SELECT
  supply.question_id,
  supply.topic,
  supply.experience_scope,
  supply.intake_status,
  count(supply.request_id)::integer AS issued_request_count,
  count(supply.request_id) FILTER (
    WHERE supply.status = 'accepted'
  )::integer AS historical_accept_count,
  count(DISTINCT supply.slot_id) FILTER (
    WHERE supply.is_confirmed
  )::integer AS confirmed_slot_count,
  count(DISTINCT supply.slot_id) FILTER (
    WHERE supply.is_confirmed
      AND supply.supply_lane = 'peer_member'
  )::integer AS peer_member_confirmed_slot_count,
  count(DISTINCT supply.slot_id) FILTER (
    WHERE supply.is_confirmed
      AND supply.supply_lane = 'industry_professional'
  )::integer AS industry_professional_confirmed_slot_count,
  count(DISTINCT supply.slot_id) FILTER (
    WHERE supply.is_confirmed
      AND supply.requested_role = 'primary'
  )::integer AS primary_confirmed_count,
  count(DISTINCT supply.slot_id) FILTER (
    WHERE supply.is_confirmed
      AND supply.requested_role = 'backup'
  )::integer AS backup_confirmed_count,
  count(DISTINCT supply.slot_id) FILTER (
    WHERE supply.is_confirmed
      AND supply.supply_lane = 'peer_member'
      AND supply.requested_role = 'primary'
  )::integer AS peer_member_primary_confirmed_count,
  count(DISTINCT supply.slot_id) FILTER (
    WHERE supply.is_confirmed
      AND supply.supply_lane = 'peer_member'
      AND supply.requested_role = 'backup'
  )::integer AS peer_member_backup_confirmed_count,
  count(DISTINCT supply.slot_id) FILTER (
    WHERE supply.is_confirmed
      AND supply.supply_lane = 'industry_professional'
      AND supply.requested_role = 'primary'
  )::integer AS industry_professional_primary_confirmed_count,
  count(DISTINCT supply.slot_id) FILTER (
    WHERE supply.is_confirmed
      AND supply.supply_lane = 'industry_professional'
      AND supply.requested_role = 'backup'
  )::integer AS industry_professional_backup_confirmed_count,
  CASE
    WHEN supply.intake_status = 'withdrawn' THEN 'withdrawn'
    WHEN
      count(DISTINCT supply.slot_id) FILTER (
        WHERE supply.is_confirmed
          AND supply.supply_lane = 'peer_member'
          AND supply.requested_role = 'primary'
      ) >= 1
      AND count(DISTINCT supply.slot_id) FILTER (
        WHERE supply.is_confirmed
          AND supply.supply_lane = 'peer_member'
          AND supply.requested_role = 'backup'
      ) >= 1
      THEN 'ready_for_review'
    ELSE 'private_waitlist'
  END AS question_state
FROM request_supply AS supply
GROUP BY
  supply.question_id,
  supply.topic,
  supply.experience_scope,
  supply.intake_status;

-- A notification hidden by a block is historical delivery state. Unblocking
-- permits future interactions, but must never resurrect an old unread prompt.
ALTER TABLE public.community_reply_notifications
  ADD COLUMN viewer_control_hidden_at timestamptz;

-- Blocking is a safety exit and remains available in read_only/disabled mode.
-- Unblocking changes only future eligibility and filtered source visibility;
-- tombstoned notifications and finalized responder requests stay final.
DROP FUNCTION IF EXISTS public.community_set_user_block(uuid, boolean, text);

CREATE OR REPLACE FUNCTION public.community_set_user_block(
  p_actor_id uuid,
  p_blocked_user_id uuid,
  p_blocked boolean,
  p_reason_category text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid := p_actor_id;
  v_control public.community_viewer_controls%ROWTYPE;
  v_changed boolean := false;
  v_expired_request_ids uuid[] := ARRAY[]::uuid[];
  v_hidden_notification_count integer := 0;
  v_candidate record;
  v_request public.community_responder_requests%ROWTYPE;
  v_slot public.responder_capacity_slots%ROWTYPE;
  v_requester_id uuid;
  v_expiry_key uuid;
  v_previous_status text;
  v_event_actor_type text;
BEGIN
  IF NOT public.community_request_is_service() THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  IF v_actor_id IS NULL
    OR p_blocked_user_id IS NULL
    OR p_blocked IS NULL
    OR p_blocked_user_id = v_actor_id
    OR NOT EXISTS (
      SELECT 1 FROM auth.users AS app_user
      WHERE app_user.id = p_blocked_user_id
    )
    OR NOT EXISTS (
      SELECT 1 FROM auth.users AS app_user
      WHERE app_user.id = v_actor_id
    )
    OR (
      p_reason_category IS NOT NULL
      AND p_reason_category NOT IN (
        'safety',
        'harassment',
        'unwanted_contact',
        'irrelevant',
        'other'
      )
    ) THEN
    RAISE EXCEPTION 'invalid viewer control' USING ERRCODE = '22023';
  END IF;

  PERFORM community_private.lock_user_pair(
    v_actor_id,
    p_blocked_user_id
  );

  SELECT control.*
  INTO v_control
  FROM public.community_viewer_controls AS control
  WHERE control.blocker_user_id = v_actor_id
    AND control.blocked_user_id = p_blocked_user_id
  FOR UPDATE;

  IF p_blocked THEN
    IF NOT FOUND THEN
      INSERT INTO public.community_viewer_controls (
        blocker_user_id,
        blocked_user_id,
        reason_category
      ) VALUES (
        v_actor_id,
        p_blocked_user_id,
        p_reason_category
      )
      RETURNING * INTO v_control;
      v_changed := true;
    ELSIF v_control.revoked_at IS NOT NULL THEN
      UPDATE public.community_viewer_controls
      SET reason_category = p_reason_category,
          created_at = clock_timestamp(),
          updated_at = clock_timestamp(),
          revoked_at = NULL
      WHERE blocker_user_id = v_actor_id
        AND blocked_user_id = p_blocked_user_id
      RETURNING * INTO v_control;
      v_changed := true;
    END IF;
  ELSIF FOUND AND v_control.revoked_at IS NULL THEN
    UPDATE public.community_viewer_controls
    SET updated_at = clock_timestamp(),
        revoked_at = clock_timestamp()
    WHERE blocker_user_id = v_actor_id
      AND blocked_user_id = p_blocked_user_id
    RETURNING * INTO v_control;
    v_changed := true;
  END IF;

  IF v_changed THEN
    IF p_blocked THEN
      UPDATE public.community_reply_notifications
      SET viewer_control_hidden_at = clock_timestamp()
      WHERE viewer_control_hidden_at IS NULL
        AND (
          (
            recipient_id = v_actor_id
            AND actor_id = p_blocked_user_id
          )
          OR (
            recipient_id = p_blocked_user_id
            AND actor_id = v_actor_id
          )
        );
      GET DIAGNOSTICS v_hidden_notification_count = ROW_COUNT;

      FOR v_candidate IN
        SELECT
          request.id,
          request.responder_id,
          request.capacity_slot_id
        FROM public.community_responder_requests AS request
        JOIN public.community_responder_questions AS question
          ON question.id = request.question_id
        WHERE request.status IN ('requested', 'accepted')
          AND question.requester_id IS NOT NULL
          AND (
            (
              question.requester_id = v_actor_id
              AND request.responder_id = p_blocked_user_id
            )
            OR (
              question.requester_id = p_blocked_user_id
              AND request.responder_id = v_actor_id
            )
          )
        ORDER BY
          request.responder_id,
          request.capacity_slot_id,
          request.id
      LOOP
        -- Keep the responder foundation's transition order so block cannot
        -- deadlock accept/decline/expiry: identity, slot, then request.
        PERFORM public.community_lock_responder_identity(
          v_candidate.responder_id
        );

        SELECT slot.*
        INTO v_slot
        FROM public.responder_capacity_slots AS slot
        WHERE slot.id = v_candidate.capacity_slot_id
        FOR UPDATE;

        SELECT request.*
        INTO v_request
        FROM public.community_responder_requests AS request
        JOIN public.community_responder_questions AS question
          ON question.id = request.question_id
        WHERE request.id = v_candidate.id
          AND request.status IN ('requested', 'accepted')
          AND (
            (
              question.requester_id = v_actor_id
              AND request.responder_id = p_blocked_user_id
            )
            OR (
              question.requester_id = p_blocked_user_id
              AND request.responder_id = v_actor_id
            )
          )
        FOR UPDATE OF request;

        IF NOT FOUND THEN
          CONTINUE;
        END IF;

        SELECT question.requester_id
        INTO v_requester_id
        FROM public.community_responder_questions AS question
        WHERE question.id = v_request.question_id;

        v_previous_status := v_request.status;
        v_expiry_key := gen_random_uuid();
        v_event_actor_type := CASE
          WHEN v_requester_id = v_actor_id THEN 'requester'
          ELSE 'responder'
        END;

        UPDATE public.community_responder_requests
        SET status = 'expired',
            expiry_idempotency_key = v_expiry_key,
            expiry_reason_code = 'requester_unavailable',
            expired_at = clock_timestamp(),
            updated_at = clock_timestamp()
        WHERE id = v_request.id
        RETURNING * INTO v_request;

        PERFORM public.community_write_responder_supply_event(
          'request_expired',
          v_request.question_id,
          v_request.id,
          v_request.capacity_slot_id,
          v_event_actor_type,
          v_actor_id,
          v_expiry_key,
          v_previous_status,
          'expired',
          'requester_unavailable',
          COALESCE(
            v_request.response_commercial_relationship,
            v_request.commercial_relationship_at_request
          ),
          COALESCE(v_request.response_has_conflict, v_request.conflict_at_request)
        );

        v_expired_request_ids := array_append(
          v_expired_request_ids,
          v_request.id
        );
      END LOOP;
    END IF;

    PERFORM set_config(
      'hanbang.community_viewer_control_event_write',
      'on',
      true
    );
    INSERT INTO public.community_viewer_control_events (
      blocker_user_id,
      blocked_user_id,
      action,
      reason_category,
      metadata
    ) VALUES (
      v_actor_id,
      p_blocked_user_id,
      CASE WHEN p_blocked THEN 'block' ELSE 'unblock' END,
      CASE WHEN p_blocked THEN p_reason_category ELSE NULL END,
      jsonb_build_object(
        'hidden_notification_count',
        v_hidden_notification_count,
        'expired_responder_request_count',
        cardinality(v_expired_request_ids)
      )
    );
    PERFORM set_config(
      'hanbang.community_viewer_control_event_write',
      'off',
      true
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'blocked_user_id', p_blocked_user_id,
    'blocked', p_blocked,
    'changed', v_changed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.community_set_user_block(
  uuid, uuid, boolean, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_set_user_block(
  uuid, uuid, boolean, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.community_list_user_blocks()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
BEGIN
  IF COALESCE(auth.role(), '') <> 'authenticated'
    OR v_actor_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'blocked_user_id', control.blocked_user_id,
        'reason_category', control.reason_category,
        'created_at', control.created_at
      )
      ORDER BY control.created_at DESC, control.blocked_user_id DESC
    )
    FROM public.community_viewer_controls AS control
    WHERE control.blocker_user_id = v_actor_id
      AND control.revoked_at IS NULL
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.community_list_user_blocks()
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.community_list_user_blocks()
  TO authenticated;

-- Logged-in read models use one symmetric block predicate. Logged-out public
-- URLs intentionally remain governed by publication/moderation policies.
CREATE POLICY community_posts_viewer_block_boundary
  ON public.community_posts
  AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (
      author_id = auth.uid()
      OR community_private.viewer_can_see_current_user(author_id)
    )
  );

CREATE POLICY community_comments_viewer_block_boundary
  ON public.community_comments
  AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (
      author_id = auth.uid()
      OR community_private.viewer_can_see_current_user(author_id)
    )
  );

CREATE POLICY cohort_messages_viewer_block_boundary
  ON public.cohort_messages
  AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (
      author_id = auth.uid()
      OR community_private.viewer_can_see_current_user(author_id)
    )
  );

CREATE POLICY community_reply_notifications_viewer_block_select
  ON public.community_reply_notifications
  AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (
    recipient_id = auth.uid()
    AND viewer_control_hidden_at IS NULL
    AND community_private.viewer_can_see_current_user(actor_id)
  );

CREATE POLICY community_reply_notifications_viewer_block_update
  ON public.community_reply_notifications
  AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (
    recipient_id = auth.uid()
    AND viewer_control_hidden_at IS NULL
    AND community_private.viewer_can_see_current_user(actor_id)
  )
  WITH CHECK (
    recipient_id = auth.uid()
    AND viewer_control_hidden_at IS NULL
    AND community_private.viewer_can_see_current_user(actor_id)
  );

CREATE OR REPLACE VIEW public.community_public_profiles
WITH (security_barrier = true)
AS
SELECT
  profile.user_id,
  profile.nickname,
  profile.avatar_url,
  profile.badge,
  profile.rank
FROM public.community_profiles AS profile
WHERE public.community_runtime_mode() <> 'disabled'
  AND COALESCE(profile.is_suspended, false) = false
  AND (
    auth.uid() IS NULL
    OR profile.user_id = auth.uid()
    OR community_private.viewer_can_see_current_user(profile.user_id)
  );

REVOKE ALL PRIVILEGES ON TABLE public.community_public_profiles
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.community_public_profiles
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION community_private.guard_comment_interaction_block()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_post_author_id uuid;
  v_parent_author_id uuid;
BEGIN
  SELECT post.author_id
  INTO v_post_author_id
  FROM public.community_posts AS post
  WHERE post.id = NEW.post_id;

  IF community_private.users_are_blocked(
    NEW.author_id,
    v_post_author_id
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_INTERACTION_BLOCKED'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.parent_id IS NOT NULL THEN
    SELECT comment.author_id
    INTO v_parent_author_id
    FROM public.community_comments AS comment
    WHERE comment.id = NEW.parent_id;

    IF community_private.users_are_blocked(
      NEW.author_id,
      v_parent_author_id
    ) THEN
      RAISE EXCEPTION 'COMMUNITY_INTERACTION_BLOCKED'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION community_private.guard_notification_interaction_block()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF community_private.users_are_blocked(NEW.recipient_id, NEW.actor_id) THEN
    RAISE EXCEPTION 'COMMUNITY_INTERACTION_BLOCKED'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION community_private.guard_cohort_reply_block()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_reply_author_id uuid;
BEGIN
  IF NEW.reply_to IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT message.author_id
  INTO v_reply_author_id
  FROM public.cohort_messages AS message
  WHERE message.id = NEW.reply_to;

  IF community_private.users_are_blocked(
    NEW.author_id,
    v_reply_author_id
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_INTERACTION_BLOCKED'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION community_private.guard_engagement_block()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_row jsonb := to_jsonb(NEW);
  v_actor_id uuid := NULLIF(v_row ->> 'user_id', '')::uuid;
  v_target_author_id uuid;
  v_post_id uuid;
  v_comment_id uuid;
  v_poll_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'community_bookmarks' THEN
    v_post_id := NULLIF(v_row ->> 'post_id', '')::uuid;
  ELSIF TG_TABLE_NAME = 'community_votes' THEN
    v_post_id := NULLIF(v_row ->> 'post_id', '')::uuid;
    v_comment_id := NULLIF(v_row ->> 'comment_id', '')::uuid;
  ELSIF TG_TABLE_NAME = 'community_poll_votes' THEN
    v_poll_id := NULLIF(v_row ->> 'poll_id', '')::uuid;
    SELECT poll.post_id INTO v_post_id
    FROM public.community_polls AS poll
    WHERE poll.id = v_poll_id;
  END IF;

  IF v_comment_id IS NOT NULL THEN
    SELECT comment.author_id INTO v_target_author_id
    FROM public.community_comments AS comment
    WHERE comment.id = v_comment_id;
  ELSIF v_post_id IS NOT NULL THEN
    SELECT post.author_id INTO v_target_author_id
    FROM public.community_posts AS post
    WHERE post.id = v_post_id;
  END IF;

  IF community_private.users_are_blocked(v_actor_id, v_target_author_id) THEN
    RAISE EXCEPTION 'COMMUNITY_INTERACTION_BLOCKED'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION community_private.guard_comment_interaction_block()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION community_private.guard_notification_interaction_block()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION community_private.guard_cohort_reply_block()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION community_private.guard_engagement_block()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER community_comments_viewer_block_write
BEFORE INSERT OR UPDATE OF author_id, post_id, parent_id
ON public.community_comments
FOR EACH ROW
EXECUTE FUNCTION community_private.guard_comment_interaction_block();

CREATE TRIGGER community_reply_notifications_viewer_block_write
BEFORE INSERT OR UPDATE OF recipient_id, actor_id
ON public.community_reply_notifications
FOR EACH ROW
EXECUTE FUNCTION community_private.guard_notification_interaction_block();

CREATE TRIGGER cohort_messages_viewer_block_reply_write
BEFORE INSERT OR UPDATE OF author_id, reply_to
ON public.cohort_messages
FOR EACH ROW
EXECUTE FUNCTION community_private.guard_cohort_reply_block();

CREATE TRIGGER community_bookmarks_viewer_block_write
BEFORE INSERT OR UPDATE OF user_id, post_id
ON public.community_bookmarks
FOR EACH ROW
EXECUTE FUNCTION community_private.guard_engagement_block();

CREATE TRIGGER community_votes_viewer_block_write
BEFORE INSERT OR UPDATE OF user_id, post_id, comment_id
ON public.community_votes
FOR EACH ROW
EXECUTE FUNCTION community_private.guard_engagement_block();

CREATE TRIGGER community_poll_votes_viewer_block_write
BEFORE INSERT OR UPDATE OF user_id, poll_id
ON public.community_poll_votes
FOR EACH ROW
EXECUTE FUNCTION community_private.guard_engagement_block();

COMMENT ON TABLE public.community_viewer_controls IS
  'Private per-user block intent. It filters authenticated read models and interaction eligibility but never changes source moderation state.';
COMMENT ON FUNCTION public.community_set_user_block(
  uuid, uuid, boolean, text
) IS
  'Service-only mutation with an explicit actor; sets private block intent atomically without notifying the target.';

COMMIT;
