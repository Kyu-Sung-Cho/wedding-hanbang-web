BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- This ledger deliberately stores no question body, exact wedding date,
-- private budget, venue, or precise region. Matching is limited to the first
-- controlled-beta topic and broad experience scopes. Availability timestamps
-- are operational opt-in boundaries, not the responder's wedding date.
CREATE TABLE public.responder_capacity_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  responder_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  responder_origin text NOT NULL DEFAULT 'member',
  topic text NOT NULL,
  experience_scope text NOT NULL,
  experience_period text NOT NULL,
  experience_basis text NOT NULL DEFAULT 'self_declared',
  commercial_relationship text NOT NULL,
  has_conflict boolean NOT NULL,
  available_from timestamptz NOT NULL,
  available_until timestamptz NOT NULL,
  weekly_request_limit smallint NOT NULL,
  cooldown_hours smallint NOT NULL,
  max_open_requests smallint NOT NULL,
  opt_in_status text NOT NULL DEFAULT 'active',
  eligibility_status text NOT NULL DEFAULT 'pending_review',
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewer_erased_at timestamptz,
  review_reason_code text,
  review_idempotency_key uuid UNIQUE,
  consent_idempotency_key uuid NOT NULL,
  revoked_at timestamptz,
  revocation_reason_code text,
  revocation_idempotency_key uuid,
  consumed_request_id uuid UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT responder_capacity_slots_human_origin
    CHECK (responder_origin IN ('member', 'industry_professional')),
  CONSTRAINT responder_capacity_slots_p0_topic
    CHECK (topic = 'contract_extra_cost'),
  CONSTRAINT responder_capacity_slots_broad_scope
    CHECK (
      experience_scope IN (
        'contract_terms',
        'extra_charge',
        'vendor_response',
        'cancellation_refund'
      )
    ),
  CONSTRAINT responder_capacity_slots_coarse_experience_period
    CHECK (
      experience_period IN (
        'within_3_months',
        'within_6_months',
        'within_12_months',
        'over_12_months'
      )
    ),
  CONSTRAINT responder_capacity_slots_experience_basis
    CHECK (experience_basis = 'self_declared'),
  CONSTRAINT responder_capacity_slots_commercial_relationship
    CHECK (
      commercial_relationship IN (
        'none',
        'gift',
        'discount',
        'refund',
        'affiliate',
        'paid',
        'employee',
        'owner_or_family',
        'platform_research_compensation'
      )
    ),
  CONSTRAINT responder_capacity_slots_availability
    CHECK (available_from < available_until),
  CONSTRAINT responder_capacity_slots_weekly_limit
    CHECK (weekly_request_limit BETWEEN 1 AND 7),
  CONSTRAINT responder_capacity_slots_cooldown
    CHECK (cooldown_hours BETWEEN 1 AND 168),
  CONSTRAINT responder_capacity_slots_open_limit
    CHECK (max_open_requests BETWEEN 1 AND 3),
  CONSTRAINT responder_capacity_slots_opt_in_status
    CHECK (opt_in_status IN ('active', 'revoked')),
  CONSTRAINT responder_capacity_slots_eligibility_status
    CHECK (
      eligibility_status IN (
        'pending_review',
        'verified_human_experience',
        'rejected'
      )
    ),
  CONSTRAINT responder_capacity_slots_review_state
    CHECK (
      (
        eligibility_status = 'pending_review'
        AND reviewed_at IS NULL
        AND reviewed_by IS NULL
        AND reviewer_erased_at IS NULL
        AND review_reason_code IS NULL
        AND review_idempotency_key IS NULL
      )
      OR (
        eligibility_status <> 'pending_review'
        AND reviewed_at IS NOT NULL
        AND (
          (reviewed_by IS NOT NULL AND reviewer_erased_at IS NULL)
          OR (reviewed_by IS NULL AND reviewer_erased_at IS NOT NULL)
        )
        AND review_reason_code IS NOT NULL
        AND review_idempotency_key IS NOT NULL
      )
    ),
  CONSTRAINT responder_capacity_slots_revocation_state
    CHECK (
      (
        opt_in_status = 'active'
        AND revoked_at IS NULL
        AND revocation_reason_code IS NULL
        AND revocation_idempotency_key IS NULL
      )
      OR (
        opt_in_status = 'revoked'
        AND revoked_at IS NOT NULL
        AND revocation_reason_code IS NOT NULL
        AND revocation_idempotency_key IS NOT NULL
      )
    ),
  CONSTRAINT responder_capacity_slots_consent_idempotency
    UNIQUE (responder_id, consent_idempotency_key),
  CONSTRAINT responder_capacity_slots_revocation_idempotency
    UNIQUE (responder_id, revocation_idempotency_key)
);

-- This is a private supply gate, not a public post. The future DecisionThread
-- integration supplies the same stable UUID and must atomically re-check the
-- derived view before publishing.
CREATE TABLE public.community_responder_questions (
  id uuid PRIMARY KEY,
  topic text NOT NULL,
  experience_scope text NOT NULL,
  intake_status text NOT NULL DEFAULT 'private_waitlist',
  created_by_operator uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_responder_questions_p0_topic
    CHECK (topic = 'contract_extra_cost'),
  CONSTRAINT community_responder_questions_broad_scope
    CHECK (
      experience_scope IN (
        'contract_terms',
        'extra_charge',
        'vendor_response',
        'cancellation_refund'
      )
    ),
  CONSTRAINT community_responder_questions_private_state
    CHECK (intake_status IN ('private_waitlist', 'withdrawn'))
);

CREATE TABLE public.community_responder_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL
    REFERENCES public.community_responder_questions(id) ON DELETE CASCADE,
  capacity_slot_id uuid NOT NULL
    REFERENCES public.responder_capacity_slots(id) ON DELETE CASCADE,
  responder_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_role text NOT NULL,
  responder_origin text NOT NULL,
  supply_lane text NOT NULL,
  topic text NOT NULL,
  experience_scope text NOT NULL,
  experience_period text NOT NULL,
  commercial_relationship_at_request text NOT NULL,
  conflict_at_request boolean NOT NULL,
  status text NOT NULL DEFAULT 'requested',
  request_idempotency_key uuid NOT NULL UNIQUE,
  response_idempotency_key uuid,
  expiry_idempotency_key uuid,
  response_commercial_relationship text,
  response_has_conflict boolean,
  decline_reason_code text,
  expiry_reason_code text,
  created_by_operator uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  declined_at timestamptz,
  expired_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_responder_requests_role
    CHECK (requested_role IN ('primary', 'backup')),
  CONSTRAINT community_responder_requests_human_origin
    CHECK (responder_origin IN ('member', 'industry_professional')),
  CONSTRAINT community_responder_requests_supply_lane
    CHECK (
      (responder_origin = 'member' AND supply_lane = 'peer_member')
      OR (
        responder_origin = 'industry_professional'
        AND supply_lane = 'industry_professional'
      )
    ),
  CONSTRAINT community_responder_requests_p0_topic
    CHECK (topic = 'contract_extra_cost'),
  CONSTRAINT community_responder_requests_broad_scope
    CHECK (
      experience_scope IN (
        'contract_terms',
        'extra_charge',
        'vendor_response',
        'cancellation_refund'
      )
    ),
  CONSTRAINT community_responder_requests_coarse_experience_period
    CHECK (
      experience_period IN (
        'within_3_months',
        'within_6_months',
        'within_12_months',
        'over_12_months'
      )
    ),
  CONSTRAINT community_responder_requests_commercial_relationship_at_request
    CHECK (
      commercial_relationship_at_request IN (
        'none',
        'gift',
        'discount',
        'refund',
        'affiliate',
        'paid',
        'employee',
        'owner_or_family',
        'platform_research_compensation'
      )
    ),
  CONSTRAINT community_responder_requests_response_relationship
    CHECK (
      response_commercial_relationship IS NULL
      OR response_commercial_relationship IN (
        'none',
        'gift',
        'discount',
        'refund',
        'affiliate',
        'paid',
        'employee',
        'owner_or_family',
        'platform_research_compensation'
      )
    ),
  CONSTRAINT community_responder_requests_status
    CHECK (status IN ('requested', 'accepted', 'declined', 'expired')),
  CONSTRAINT community_responder_requests_expiry
    CHECK (created_at < expires_at),
  CONSTRAINT community_responder_requests_accept_state
    CHECK (
      status <> 'accepted'
      OR (
        accepted_at IS NOT NULL
        AND response_idempotency_key IS NOT NULL
        AND response_commercial_relationship IS NOT NULL
        AND response_has_conflict IS FALSE
      )
    ),
  CONSTRAINT community_responder_requests_decline_state
    CHECK (
      status <> 'declined'
      OR (
        declined_at IS NOT NULL
        AND response_idempotency_key IS NOT NULL
        AND decline_reason_code IS NOT NULL
      )
    ),
  CONSTRAINT community_responder_requests_expired_state
    CHECK (
      status <> 'expired'
      OR (
        expired_at IS NOT NULL
        AND expiry_idempotency_key IS NOT NULL
        AND expiry_reason_code IS NOT NULL
      )
    ),
  CONSTRAINT community_responder_requests_response_idempotency
    UNIQUE (responder_id, response_idempotency_key),
  CONSTRAINT community_responder_requests_expiry_idempotency
    UNIQUE (expiry_idempotency_key)
);

-- A consumed slot is a terminal one-shot marker. Keep the request UUID even if
-- the requester later erases their account and the request row cascades away;
-- ON DELETE SET NULL would silently make already-used capacity reusable.
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

CREATE TRIGGER responder_capacity_slots_terminal_consumption
BEFORE INSERT OR UPDATE OF consumed_request_id
ON public.responder_capacity_slots
FOR EACH ROW
EXECUTE FUNCTION public.community_guard_slot_terminal_consumption();

-- A capacity unit can have at most one concurrent assignment, and one person
-- cannot fill both primary and backup for the same question.
CREATE UNIQUE INDEX community_responder_requests_open_slot_unique
  ON public.community_responder_requests(capacity_slot_id)
  WHERE status IN ('requested', 'accepted');

CREATE UNIQUE INDEX community_responder_requests_open_question_role_unique
  ON public.community_responder_requests(
    question_id,
    supply_lane,
    requested_role
  )
  WHERE status IN ('requested', 'accepted');

CREATE UNIQUE INDEX community_responder_requests_open_question_person_unique
  ON public.community_responder_requests(question_id, responder_id)
  WHERE status IN ('requested', 'accepted');

CREATE TABLE public.community_responder_supply_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  question_id uuid
    REFERENCES public.community_responder_questions(id) ON DELETE SET NULL,
  request_id uuid
    REFERENCES public.community_responder_requests(id) ON DELETE SET NULL,
  capacity_slot_id uuid
    REFERENCES public.responder_capacity_slots(id) ON DELETE SET NULL,
  actor_type text NOT NULL,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_erased_at timestamptz,
  operation_idempotency_key uuid NOT NULL,
  previous_status text,
  new_status text,
  reason_code text,
  commercial_relationship text,
  has_conflict boolean,
  subject_erased_at timestamptz,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_responder_supply_events_type
    CHECK (
      event_type IN (
        'slot_registered',
        'slot_reviewed',
        'slot_revoked',
        'request_created',
        'request_accepted',
        'request_declined',
        'request_expired'
      )
    ),
  CONSTRAINT community_responder_supply_events_actor
    CHECK (
      actor_type IN ('responder', 'operator')
      AND (
        (actor_id IS NOT NULL AND actor_erased_at IS NULL)
        OR (actor_id IS NULL AND actor_erased_at IS NOT NULL)
      )
    ),
  CONSTRAINT community_responder_supply_events_subject
    CHECK (
      (
        (
          question_id IS NOT NULL
          OR request_id IS NOT NULL
          OR capacity_slot_id IS NOT NULL
        )
        AND subject_erased_at IS NULL
      )
      OR (
        question_id IS NULL
        AND request_id IS NULL
        AND capacity_slot_id IS NULL
        AND subject_erased_at IS NOT NULL
      )
    ),
  CONSTRAINT community_responder_supply_events_reason
    CHECK (
      reason_code IS NULL
      OR reason_code ~ '^[a-z][a-z0-9_]{1,63}$'
    ),
  CONSTRAINT community_responder_supply_events_relationship
    CHECK (
      commercial_relationship IS NULL
      OR commercial_relationship IN (
        'none',
        'gift',
        'discount',
        'refund',
        'affiliate',
        'paid',
        'employee',
        'owner_or_family',
        'platform_research_compensation'
      )
    ),
  CONSTRAINT community_responder_supply_events_idempotency
    UNIQUE (actor_type, actor_id, event_type, operation_idempotency_key)
);

CREATE OR REPLACE FUNCTION public.community_tombstone_responder_reviewer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- The only automatic identity rewrite is the FK's ON DELETE SET NULL path.
  -- Keep the review decision while making erasure explicit and auditable.
  IF pg_trigger_depth() > 1
    AND OLD.reviewed_by IS NOT NULL
    AND NEW.reviewed_by IS NULL
    AND NEW.reviewer_erased_at IS NULL THEN
    NEW.reviewer_erased_at := clock_timestamp();
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER responder_capacity_slot_reviewer_tombstone
BEFORE UPDATE OF reviewed_by
ON public.responder_capacity_slots
FOR EACH ROW
EXECUTE FUNCTION public.community_tombstone_responder_reviewer();

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

CREATE OR REPLACE FUNCTION public.community_guard_responder_supply_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT'
    AND COALESCE(
      current_setting('hanbang.community_responder_event_write', true),
      ''
    ) = 'on' THEN
    RETURN NEW;
  END IF;

  -- FK cleanup is an internal nested trigger. It may only erase referenced
  -- identities/subjects; every event fact remains byte-for-byte unchanged.
  IF TG_OP = 'UPDATE'
    AND pg_trigger_depth() > 1
    AND (
      NEW.question_id IS NOT DISTINCT FROM OLD.question_id
      OR (OLD.question_id IS NOT NULL AND NEW.question_id IS NULL)
    )
    AND (
      NEW.request_id IS NOT DISTINCT FROM OLD.request_id
      OR (OLD.request_id IS NOT NULL AND NEW.request_id IS NULL)
    )
    AND (
      NEW.capacity_slot_id IS NOT DISTINCT FROM OLD.capacity_slot_id
      OR (OLD.capacity_slot_id IS NOT NULL AND NEW.capacity_slot_id IS NULL)
    )
    AND (
      NEW.actor_id IS NOT DISTINCT FROM OLD.actor_id
      OR (OLD.actor_id IS NOT NULL AND NEW.actor_id IS NULL)
    )
    AND (
      to_jsonb(NEW) - ARRAY[
        'question_id', 'request_id', 'capacity_slot_id', 'actor_id',
        'actor_erased_at', 'subject_erased_at'
      ]
    ) IS NOT DISTINCT FROM (
      to_jsonb(OLD) - ARRAY[
        'question_id', 'request_id', 'capacity_slot_id', 'actor_id',
        'actor_erased_at', 'subject_erased_at'
      ]
    ) THEN
    IF NEW.actor_id IS NULL THEN
      NEW.actor_erased_at := COALESCE(
        OLD.actor_erased_at,
        clock_timestamp()
      );
    ELSE
      NEW.actor_erased_at := OLD.actor_erased_at;
    END IF;

    IF NEW.question_id IS NULL
      AND NEW.request_id IS NULL
      AND NEW.capacity_slot_id IS NULL THEN
      NEW.subject_erased_at := COALESCE(
        OLD.subject_erased_at,
        clock_timestamp()
      );
    ELSE
      NEW.subject_erased_at := OLD.subject_erased_at;
    END IF;

    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'community responder audit events are append-only'
    USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER community_responder_supply_event_append_only
BEFORE INSERT OR UPDATE OR DELETE
ON public.community_responder_supply_events
FOR EACH ROW
EXECUTE FUNCTION public.community_guard_responder_supply_event();

CREATE OR REPLACE FUNCTION public.community_write_responder_supply_event(
  p_event_type text,
  p_question_id uuid,
  p_request_id uuid,
  p_capacity_slot_id uuid,
  p_actor_type text,
  p_actor_id uuid,
  p_operation_idempotency_key uuid,
  p_previous_status text,
  p_new_status text,
  p_reason_code text,
  p_commercial_relationship text,
  p_has_conflict boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
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
    operation_idempotency_key,
    previous_status,
    new_status,
    reason_code,
    commercial_relationship,
    has_conflict
  ) VALUES (
    p_event_type,
    p_question_id,
    p_request_id,
    p_capacity_slot_id,
    p_actor_type,
    p_actor_id,
    p_operation_idempotency_key,
    p_previous_status,
    p_new_status,
    p_reason_code,
    p_commercial_relationship,
    p_has_conflict
  );

  PERFORM set_config(
    'hanbang.community_responder_event_write',
    'off',
    true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.community_assert_responder_operator(
  p_operator_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.community_request_is_service()
    OR p_operator_id IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM public.profiles AS profile
      WHERE profile.id = p_operator_id
        AND profile.is_admin IS TRUE
    ) THEN
    RAISE EXCEPTION 'verified service operator required'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_assert_responder_runtime_normal()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_mode text;
BEGIN
  v_mode := public.community_runtime_mode();
  IF v_mode IS DISTINCT FROM 'normal' THEN
    RAISE EXCEPTION 'community responder supply is not accepting new work'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_lock_responder_identity(
  p_responder_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  IF p_responder_id IS NULL THEN
    RAISE EXCEPTION 'responder identity required'
      USING ERRCODE = '42501';
  END IF;

  -- Global lock order for this subsystem is auth user -> community profile ->
  -- capacity slot -> request. This also serializes account deletion and a
  -- moderator suspension with every state-changing responder command.
  SELECT users.id
  INTO v_user_id
  FROM auth.users AS users
  WHERE users.id = p_responder_id
  FOR UPDATE;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'responder identity unavailable'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.community_profiles AS profile
  WHERE profile.user_id = p_responder_id
  FOR UPDATE;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_assert_responder_eligible(
  p_responder_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.community_lock_responder_identity(p_responder_id);

  IF NOT EXISTS (
      SELECT 1
      FROM public.community_profiles AS profile
      WHERE profile.user_id = p_responder_id
        AND COALESCE(profile.is_suspended, false) = false
    )
    OR EXISTS (
      SELECT 1
      FROM public.community_agent_personas AS persona
      WHERE persona.backing_user_id = p_responder_id
    ) THEN
    RAISE EXCEPTION 'eligible human responder required'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_register_responder_capacity_slot(
  p_responder_id uuid,
  p_responder_origin text,
  p_topic text,
  p_experience_scope text,
  p_experience_period text,
  p_commercial_relationship text,
  p_has_conflict boolean,
  p_available_from timestamptz,
  p_available_until timestamptz,
  p_weekly_request_limit smallint,
  p_cooldown_hours smallint,
  p_max_open_requests smallint,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_responder_id uuid := p_responder_id;
  v_slot public.responder_capacity_slots%ROWTYPE;
  v_active_slot_count integer;
BEGIN
  IF NOT public.community_request_is_service()
    OR v_responder_id IS NULL THEN
    RAISE EXCEPTION 'verified service responder actor required'
      USING ERRCODE = '42501';
  END IF;

  IF p_idempotency_key IS NULL
    OR p_responder_origin NOT IN ('member', 'industry_professional')
    OR p_topic <> 'contract_extra_cost'
    OR p_experience_scope NOT IN (
      'contract_terms',
      'extra_charge',
      'vendor_response',
      'cancellation_refund'
    )
    OR p_experience_period NOT IN (
      'within_3_months',
      'within_6_months',
      'within_12_months',
      'over_12_months'
    )
    OR p_commercial_relationship NOT IN (
      'none',
      'gift',
      'discount',
      'refund',
      'affiliate',
      'paid',
      'employee',
      'owner_or_family',
      'platform_research_compensation'
    )
    OR p_has_conflict IS NULL
    OR p_available_from IS NULL
    OR p_available_until IS NULL
    OR p_available_from >= p_available_until
    OR p_available_until <= clock_timestamp()
    OR p_weekly_request_limit NOT BETWEEN 1 AND 7
    OR p_cooldown_hours NOT BETWEEN 1 AND 168
    OR p_max_open_requests NOT BETWEEN 1 AND 3 THEN
    RAISE EXCEPTION 'invalid responder capacity opt-in'
      USING ERRCODE = '22023';
  END IF;

  -- Receipt reads remain available in read_only/disabled and after a later
  -- suspension. They never create work or consume another registration unit.
  SELECT slot.*
  INTO v_slot
  FROM public.responder_capacity_slots AS slot
  WHERE slot.responder_id = v_responder_id
    AND slot.consent_idempotency_key = p_idempotency_key;

  IF v_slot.id IS NOT NULL THEN
    IF v_slot.responder_origin IS DISTINCT FROM p_responder_origin
      OR v_slot.topic IS DISTINCT FROM p_topic
      OR v_slot.experience_scope IS DISTINCT FROM p_experience_scope
      OR v_slot.experience_period IS DISTINCT FROM p_experience_period
      OR v_slot.commercial_relationship IS DISTINCT FROM p_commercial_relationship
      OR v_slot.has_conflict IS DISTINCT FROM p_has_conflict
      OR v_slot.available_from IS DISTINCT FROM p_available_from
      OR v_slot.available_until IS DISTINCT FROM p_available_until
      OR v_slot.weekly_request_limit IS DISTINCT FROM p_weekly_request_limit
      OR v_slot.cooldown_hours IS DISTINCT FROM p_cooldown_hours
      OR v_slot.max_open_requests IS DISTINCT FROM p_max_open_requests THEN
      RAISE EXCEPTION 'capacity idempotency key reused with different payload'
        USING ERRCODE = '22023';
    END IF;

    RETURN jsonb_build_object(
      'slot_id', v_slot.id,
      'responder_id', v_slot.responder_id,
      'topic', v_slot.topic,
      'experience_scope', v_slot.experience_scope,
      'experience_period', v_slot.experience_period,
      'opt_in_status', v_slot.opt_in_status,
      'eligibility_status', v_slot.eligibility_status,
      'available_from', v_slot.available_from,
      'available_until', v_slot.available_until,
      'replayed', true
    );
  END IF;

  PERFORM public.community_assert_responder_runtime_normal();
  PERFORM public.community_assert_responder_eligible(v_responder_id);

  -- The identity/profile lock serializes every registration for this person.
  -- Re-check after waiting so a concurrent exact retry is still a receipt.
  SELECT slot.*
  INTO v_slot
  FROM public.responder_capacity_slots AS slot
  WHERE slot.responder_id = v_responder_id
    AND slot.consent_idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF v_slot.id IS NOT NULL THEN
    IF v_slot.responder_origin IS DISTINCT FROM p_responder_origin
      OR v_slot.topic IS DISTINCT FROM p_topic
      OR v_slot.experience_scope IS DISTINCT FROM p_experience_scope
      OR v_slot.experience_period IS DISTINCT FROM p_experience_period
      OR v_slot.commercial_relationship IS DISTINCT FROM p_commercial_relationship
      OR v_slot.has_conflict IS DISTINCT FROM p_has_conflict
      OR v_slot.available_from IS DISTINCT FROM p_available_from
      OR v_slot.available_until IS DISTINCT FROM p_available_until
      OR v_slot.weekly_request_limit IS DISTINCT FROM p_weekly_request_limit
      OR v_slot.cooldown_hours IS DISTINCT FROM p_cooldown_hours
      OR v_slot.max_open_requests IS DISTINCT FROM p_max_open_requests THEN
      RAISE EXCEPTION 'capacity idempotency key reused with different payload'
        USING ERRCODE = '22023';
    END IF;

    RETURN jsonb_build_object(
      'slot_id', v_slot.id,
      'responder_id', v_slot.responder_id,
      'topic', v_slot.topic,
      'experience_scope', v_slot.experience_scope,
      'experience_period', v_slot.experience_period,
      'opt_in_status', v_slot.opt_in_status,
      'eligibility_status', v_slot.eligibility_status,
      'available_from', v_slot.available_from,
      'available_until', v_slot.available_until,
      'replayed', true
    );
  END IF;

  SELECT count(*)::integer
  INTO v_active_slot_count
  FROM public.responder_capacity_slots AS slot
  WHERE slot.responder_id = v_responder_id
    AND slot.opt_in_status = 'active';

  IF v_active_slot_count >= 8 THEN
    RAISE EXCEPTION 'responder registration limit reached'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.responder_capacity_slots (
    responder_id,
    responder_origin,
    topic,
    experience_scope,
    experience_period,
    commercial_relationship,
    has_conflict,
    available_from,
    available_until,
    weekly_request_limit,
    cooldown_hours,
    max_open_requests,
    consent_idempotency_key
  ) VALUES (
    v_responder_id,
    p_responder_origin,
    p_topic,
    p_experience_scope,
    p_experience_period,
    p_commercial_relationship,
    p_has_conflict,
    p_available_from,
    p_available_until,
    p_weekly_request_limit,
    p_cooldown_hours,
    p_max_open_requests,
    p_idempotency_key
  )
  RETURNING * INTO v_slot;

  PERFORM public.community_write_responder_supply_event(
    'slot_registered',
    NULL,
    NULL,
    v_slot.id,
    'responder',
    v_responder_id,
    p_idempotency_key,
    NULL,
    'pending_review',
    NULL,
    p_commercial_relationship,
    p_has_conflict
  );

  RETURN jsonb_build_object(
    'slot_id', v_slot.id,
    'responder_id', v_slot.responder_id,
    'topic', v_slot.topic,
    'experience_scope', v_slot.experience_scope,
    'experience_period', v_slot.experience_period,
    'opt_in_status', v_slot.opt_in_status,
    'eligibility_status', v_slot.eligibility_status,
    'available_from', v_slot.available_from,
    'available_until', v_slot.available_until,
    'replayed', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.community_review_responder_capacity_slot(
  p_slot_id uuid,
  p_operator_id uuid,
  p_decision text,
  p_reason_code text,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_slot public.responder_capacity_slots%ROWTYPE;
  v_target_status text;
BEGIN
  PERFORM public.community_assert_responder_operator(p_operator_id);

  IF p_slot_id IS NULL
    OR p_idempotency_key IS NULL
    OR p_decision NOT IN ('verify', 'reject')
    OR p_reason_code NOT IN (
      'founding_cohort_human_check_passed',
      'industry_identity_and_experience_verified',
      'direct_experience_not_confirmed',
      'identity_not_confirmed',
      'conflict_detected'
    ) THEN
    RAISE EXCEPTION 'invalid capacity review'
      USING ERRCODE = '22023';
  END IF;

  v_target_status := CASE
    WHEN p_decision = 'verify' THEN 'verified_human_experience'
    ELSE 'rejected'
  END;

  SELECT slot.*
  INTO v_slot
  FROM public.responder_capacity_slots AS slot
  WHERE slot.id = p_slot_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'capacity slot not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_slot.review_idempotency_key = p_idempotency_key THEN
    IF v_slot.eligibility_status IS DISTINCT FROM v_target_status
      OR v_slot.reviewed_by IS DISTINCT FROM p_operator_id
      OR v_slot.review_reason_code IS DISTINCT FROM p_reason_code THEN
      RAISE EXCEPTION 'capacity review idempotency key reused with different payload'
        USING ERRCODE = '22023';
    END IF;

    RETURN jsonb_build_object(
      'slot_id', v_slot.id,
      'eligibility_status', v_slot.eligibility_status,
      'replayed', true
    );
  END IF;

  PERFORM public.community_assert_responder_runtime_normal();
  IF p_decision = 'verify' THEN
    PERFORM public.community_assert_responder_eligible(v_slot.responder_id);
  ELSE
    PERFORM public.community_lock_responder_identity(v_slot.responder_id);
  END IF;

  SELECT slot.*
  INTO v_slot
  FROM public.responder_capacity_slots AS slot
  WHERE slot.id = p_slot_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'capacity slot not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_slot.review_idempotency_key = p_idempotency_key THEN
    IF v_slot.eligibility_status IS DISTINCT FROM v_target_status
      OR v_slot.reviewed_by IS DISTINCT FROM p_operator_id
      OR v_slot.review_reason_code IS DISTINCT FROM p_reason_code THEN
      RAISE EXCEPTION 'capacity review idempotency key reused with different payload'
        USING ERRCODE = '22023';
    END IF;

    RETURN jsonb_build_object(
      'slot_id', v_slot.id,
      'eligibility_status', v_slot.eligibility_status,
      'replayed', true
    );
  END IF;

  IF v_slot.eligibility_status <> 'pending_review' THEN
    RAISE EXCEPTION 'capacity slot review is already final'
      USING ERRCODE = '55000';
  END IF;

  IF p_decision = 'verify'
    AND p_reason_code = 'founding_cohort_human_check_passed'
    AND v_slot.has_conflict IS FALSE
    AND v_slot.commercial_relationship IN (
      'affiliate',
      'paid',
      'employee',
      'owner_or_family'
    ) THEN
    RAISE EXCEPTION 'verified peer lane requires a non-industry relationship'
      USING ERRCODE = '42501';
  END IF;

  IF p_decision = 'verify'
    AND (
      v_slot.has_conflict
      OR v_slot.opt_in_status <> 'active'
      OR v_slot.available_until <= clock_timestamp()
      OR (
        v_slot.responder_origin = 'member'
        AND p_reason_code <> 'founding_cohort_human_check_passed'
      )
      OR (
        v_slot.responder_origin = 'industry_professional'
        AND p_reason_code <> 'industry_identity_and_experience_verified'
      )
    ) THEN
    RAISE EXCEPTION 'conflict-free active human experience is required'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.responder_capacity_slots
  SET eligibility_status = v_target_status,
      reviewed_at = clock_timestamp(),
      reviewed_by = p_operator_id,
      review_reason_code = p_reason_code,
      review_idempotency_key = p_idempotency_key,
      updated_at = clock_timestamp()
  WHERE id = p_slot_id
  RETURNING * INTO v_slot;

  PERFORM public.community_write_responder_supply_event(
    'slot_reviewed',
    NULL,
    NULL,
    v_slot.id,
    'operator',
    p_operator_id,
    p_idempotency_key,
    'pending_review',
    v_target_status,
    p_reason_code,
    v_slot.commercial_relationship,
    v_slot.has_conflict
  );

  RETURN jsonb_build_object(
    'slot_id', v_slot.id,
    'eligibility_status', v_slot.eligibility_status,
    'review_reason_code', v_slot.review_reason_code,
    'replayed', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.community_create_responder_request(
  p_question_id uuid,
  p_capacity_slot_id uuid,
  p_requested_role text,
  p_topic text,
  p_experience_scope text,
  p_expires_at timestamptz,
  p_operator_id uuid,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_slot public.responder_capacity_slots%ROWTYPE;
  v_request public.community_responder_requests%ROWTYPE;
  v_question public.community_responder_questions%ROWTYPE;
  v_last_request_at timestamptz;
  v_weekly_count integer;
  v_open_count integer;
  v_inserted boolean := false;
BEGIN
  PERFORM public.community_assert_responder_operator(p_operator_id);

  IF p_question_id IS NULL
    OR p_capacity_slot_id IS NULL
    OR p_idempotency_key IS NULL
    OR p_requested_role NOT IN ('primary', 'backup')
    OR p_topic <> 'contract_extra_cost'
    OR p_experience_scope NOT IN (
      'contract_terms',
      'extra_charge',
      'vendor_response',
      'cancellation_refund'
    )
    OR p_expires_at IS NULL
    OR p_expires_at <= v_now THEN
    RAISE EXCEPTION 'invalid responder request'
      USING ERRCODE = '22023';
  END IF;

  SELECT request.*
  INTO v_request
  FROM public.community_responder_requests AS request
  WHERE request.request_idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_request.question_id IS DISTINCT FROM p_question_id
      OR v_request.capacity_slot_id IS DISTINCT FROM p_capacity_slot_id
      OR v_request.requested_role IS DISTINCT FROM p_requested_role
      OR v_request.topic IS DISTINCT FROM p_topic
      OR v_request.experience_scope IS DISTINCT FROM p_experience_scope
      OR v_request.expires_at IS DISTINCT FROM p_expires_at
      OR v_request.created_by_operator IS DISTINCT FROM p_operator_id THEN
      RAISE EXCEPTION 'responder request idempotency key reused with different payload'
        USING ERRCODE = '22023';
    END IF;

    RETURN jsonb_build_object(
      'request_id', v_request.id,
      'question_id', v_request.question_id,
      'status', v_request.status,
      'requested_role', v_request.requested_role,
      'question_state', (
        SELECT supply.question_state
        FROM public.community_responder_question_supply AS supply
        WHERE supply.question_id = v_request.question_id
      ),
      'replayed', true
    );
  END IF;

  -- A receipt lookup is safe during an incident; only a genuinely new request
  -- is fenced by read_only/disabled.
  PERFORM public.community_assert_responder_runtime_normal();

  SELECT slot.responder_id
  INTO v_slot.responder_id
  FROM public.responder_capacity_slots AS slot
  WHERE slot.id = p_capacity_slot_id;

  IF v_slot.responder_id IS NULL THEN
    RAISE EXCEPTION 'capacity slot not found'
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.community_assert_responder_eligible(v_slot.responder_id);

  -- Serialize limits across every capacity unit owned by this responder.
  PERFORM 1
  FROM public.responder_capacity_slots AS slot
  WHERE slot.responder_id = v_slot.responder_id
  ORDER BY slot.id
  FOR UPDATE;

  SELECT slot.*
  INTO v_slot
  FROM public.responder_capacity_slots AS slot
  WHERE slot.id = p_capacity_slot_id;

  IF v_slot.consumed_request_id IS NOT NULL THEN
    RAISE EXCEPTION 'capacity slot has already been consumed'
      USING ERRCODE = '55000';
  END IF;

  IF v_slot.eligibility_status <> 'verified_human_experience'
    OR v_slot.opt_in_status <> 'active'
    OR v_slot.has_conflict
    OR v_slot.available_from > v_now
    OR v_slot.available_until <= v_now
    OR p_expires_at > v_slot.available_until THEN
    RAISE EXCEPTION 'eligible conflict-free capacity slot required'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.community_responder_requests AS request
    WHERE request.capacity_slot_id = p_capacity_slot_id
      AND request.status IN ('requested', 'accepted')
  ) THEN
    RAISE EXCEPTION 'capacity slot already assigned'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.community_responder_questions (
    id,
    topic,
    experience_scope,
    created_by_operator
  ) VALUES (
    p_question_id,
    p_topic,
    p_experience_scope,
    p_operator_id
  )
  ON CONFLICT (id) DO NOTHING;

  SELECT question.*
  INTO v_question
  FROM public.community_responder_questions AS question
  WHERE question.id = p_question_id
  FOR UPDATE;

  IF v_question.topic IS DISTINCT FROM p_topic
    OR v_question.experience_scope IS DISTINCT FROM p_experience_scope
    OR v_question.intake_status <> 'private_waitlist' THEN
    RAISE EXCEPTION 'question supply gate does not match request'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.community_responder_requests AS request
    WHERE request.question_id = p_question_id
      AND request.responder_id = v_slot.responder_id
      AND request.status IN ('requested', 'accepted')
  ) THEN
    RAISE EXCEPTION 'one responder cannot fill two slots for a question'
      USING ERRCODE = '23505';
  END IF;

  SELECT max(request.created_at),
         count(*) FILTER (
           WHERE request.created_at > v_now - interval '7 days'
         )::integer,
         count(*) FILTER (
           WHERE request.status IN ('requested', 'accepted')
         )::integer
  INTO v_last_request_at, v_weekly_count, v_open_count
  FROM public.community_responder_requests AS request
  WHERE request.responder_id = v_slot.responder_id;

  IF v_weekly_count >= v_slot.weekly_request_limit THEN
    RAISE EXCEPTION 'responder weekly request limit reached'
      USING ERRCODE = '55000';
  END IF;

  IF v_open_count >= v_slot.max_open_requests THEN
    RAISE EXCEPTION 'responder open request limit reached'
      USING ERRCODE = '55000';
  END IF;

  IF v_last_request_at IS NOT NULL
    AND v_last_request_at + make_interval(hours => v_slot.cooldown_hours) > v_now THEN
    RAISE EXCEPTION 'responder request cooldown is active'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.community_responder_requests (
    question_id,
    capacity_slot_id,
    responder_id,
    requested_role,
    responder_origin,
    supply_lane,
    topic,
    experience_scope,
    experience_period,
    commercial_relationship_at_request,
    conflict_at_request,
    request_idempotency_key,
    created_by_operator,
    created_at,
    expires_at,
    updated_at
  ) VALUES (
    p_question_id,
    p_capacity_slot_id,
    v_slot.responder_id,
    p_requested_role,
    v_slot.responder_origin,
    CASE v_slot.review_reason_code
      WHEN 'founding_cohort_human_check_passed' THEN 'peer_member'
      WHEN 'industry_identity_and_experience_verified' THEN 'industry_professional'
      ELSE NULL
    END,
    p_topic,
    p_experience_scope,
    v_slot.experience_period,
    v_slot.commercial_relationship,
    v_slot.has_conflict,
    p_idempotency_key,
    p_operator_id,
    v_now,
    p_expires_at,
    v_now
  )
  ON CONFLICT (request_idempotency_key) DO NOTHING
  RETURNING * INTO v_request;
  v_inserted := FOUND;

  IF NOT v_inserted THEN
    SELECT request.*
    INTO v_request
    FROM public.community_responder_requests AS request
    WHERE request.request_idempotency_key = p_idempotency_key
    FOR UPDATE;

    IF v_request.question_id IS DISTINCT FROM p_question_id
      OR v_request.capacity_slot_id IS DISTINCT FROM p_capacity_slot_id
      OR v_request.requested_role IS DISTINCT FROM p_requested_role
      OR v_request.topic IS DISTINCT FROM p_topic
      OR v_request.experience_scope IS DISTINCT FROM p_experience_scope
      OR v_request.expires_at IS DISTINCT FROM p_expires_at
      OR v_request.created_by_operator IS DISTINCT FROM p_operator_id THEN
      RAISE EXCEPTION 'responder request idempotency key reused with different payload'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_inserted THEN
    PERFORM public.community_write_responder_supply_event(
      'request_created',
      v_request.question_id,
      v_request.id,
      v_request.capacity_slot_id,
      'operator',
      p_operator_id,
      p_idempotency_key,
      NULL,
      'requested',
      NULL,
      v_request.commercial_relationship_at_request,
      v_request.conflict_at_request
    );
  END IF;

  RETURN jsonb_build_object(
    'request_id', v_request.id,
    'question_id', v_request.question_id,
    'responder_id', v_request.responder_id,
    'status', v_request.status,
    'requested_role', v_request.requested_role,
    'question_state', 'private_waitlist',
    'replayed', NOT v_inserted
  );
END;
$$;

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
  v_now timestamptz := clock_timestamp();
  v_responder_id uuid := p_responder_id;
  v_request public.community_responder_requests%ROWTYPE;
  v_slot public.responder_capacity_slots%ROWTYPE;
  v_question_state text;
  v_expected_status text;
BEGIN
  IF NOT public.community_request_is_service()
    OR v_responder_id IS NULL THEN
    RAISE EXCEPTION 'verified service responder actor required'
      USING ERRCODE = '42501';
  END IF;

  IF p_request_id IS NULL
    OR p_idempotency_key IS NULL
    OR p_decision NOT IN ('accept', 'decline')
    OR p_commercial_relationship NOT IN (
      'none',
      'gift',
      'discount',
      'refund',
      'affiliate',
      'paid',
      'employee',
      'owner_or_family',
      'platform_research_compensation'
    )
    OR p_has_conflict IS NULL
    OR (
      p_decision = 'decline'
      AND p_decline_reason_code NOT IN (
        'not_available',
        'not_my_experience',
        'conflict',
        'too_many_requests',
        'prefer_not_to_say'
      )
    )
    OR (
      p_decision = 'decline'
      AND (
        (p_decline_reason_code = 'conflict')
        IS DISTINCT FROM p_has_conflict
      )
    )
    OR (p_decision = 'accept' AND p_decline_reason_code IS NOT NULL) THEN
    RAISE EXCEPTION 'invalid responder decision'
      USING ERRCODE = '22023';
  END IF;

  v_expected_status := CASE
    WHEN p_decision = 'accept' THEN 'accepted'
    ELSE 'declined'
  END;

  SELECT request.*
  INTO v_request
  FROM public.community_responder_requests AS request
  WHERE request.id = p_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'responder request not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_request.responder_id IS DISTINCT FROM v_responder_id THEN
    RAISE EXCEPTION 'only the requested responder can decide'
      USING ERRCODE = '42501';
  END IF;

  IF v_request.response_idempotency_key = p_idempotency_key THEN
    IF v_request.status IS DISTINCT FROM v_expected_status
      OR v_request.response_commercial_relationship
        IS DISTINCT FROM p_commercial_relationship
      OR v_request.response_has_conflict IS DISTINCT FROM p_has_conflict
      OR v_request.decline_reason_code IS DISTINCT FROM p_decline_reason_code THEN
      RAISE EXCEPTION 'responder decision idempotency key reused with different payload'
        USING ERRCODE = '22023';
    END IF;

    SELECT supply.question_state
    INTO v_question_state
    FROM public.community_responder_question_supply AS supply
    WHERE supply.question_id = v_request.question_id;

    RETURN jsonb_build_object(
      'request_id', v_request.id,
      'status', v_request.status,
      'question_state', v_question_state,
      'replayed', true
    );
  END IF;

  IF p_decision = 'accept' THEN
    PERFORM public.community_assert_responder_eligible(v_responder_id);
  ELSE
    PERFORM public.community_lock_responder_identity(v_responder_id);
  END IF;

  SELECT slot.*
  INTO v_slot
  FROM public.responder_capacity_slots AS slot
  WHERE slot.id = v_request.capacity_slot_id
  FOR UPDATE;

  SELECT request.*
  INTO v_request
  FROM public.community_responder_requests AS request
  WHERE request.id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'responder request not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_request.responder_id IS DISTINCT FROM v_responder_id
    OR v_request.capacity_slot_id IS DISTINCT FROM v_slot.id THEN
    RAISE EXCEPTION 'only the requested responder can decide'
      USING ERRCODE = '42501';
  END IF;

  IF v_request.response_idempotency_key = p_idempotency_key THEN
    IF v_request.status IS DISTINCT FROM v_expected_status
      OR v_request.response_commercial_relationship
        IS DISTINCT FROM p_commercial_relationship
      OR v_request.response_has_conflict IS DISTINCT FROM p_has_conflict
      OR v_request.decline_reason_code IS DISTINCT FROM p_decline_reason_code THEN
      RAISE EXCEPTION 'responder decision idempotency key reused with different payload'
        USING ERRCODE = '22023';
    END IF;

    SELECT supply.question_state
    INTO v_question_state
    FROM public.community_responder_question_supply AS supply
    WHERE supply.question_id = v_request.question_id;

    RETURN jsonb_build_object(
      'request_id', v_request.id,
      'status', v_request.status,
      'question_state', v_question_state,
      'replayed', true
    );
  END IF;

  IF v_request.status <> 'requested' THEN
    RAISE EXCEPTION 'responder request is already final'
      USING ERRCODE = '55000';
  END IF;

  IF p_decision = 'accept' THEN
    PERFORM public.community_assert_responder_runtime_normal();

    IF p_commercial_relationship
        IS DISTINCT FROM v_slot.commercial_relationship THEN
      RAISE EXCEPTION 'commercial relationship changed; new reviewed opt-in required'
        USING ERRCODE = '42501';
    END IF;

    IF p_has_conflict
      OR v_request.expires_at <= v_now
      OR v_slot.responder_id IS DISTINCT FROM v_responder_id
      OR v_slot.opt_in_status <> 'active'
      OR v_slot.eligibility_status <> 'verified_human_experience'
      OR v_slot.has_conflict
      OR v_slot.available_from > v_now
      OR v_slot.available_until <= v_now
      OR (
        v_slot.consumed_request_id IS NOT NULL
        AND v_slot.consumed_request_id IS DISTINCT FROM v_request.id
      ) THEN
      RAISE EXCEPTION 'request no longer has conflict-free confirmed capacity'
        USING ERRCODE = '42501';
    END IF;

    UPDATE public.community_responder_requests
    SET status = 'accepted',
        response_idempotency_key = p_idempotency_key,
        response_commercial_relationship = p_commercial_relationship,
        response_has_conflict = false,
        accepted_at = v_now,
        updated_at = v_now
    WHERE id = v_request.id
    RETURNING * INTO v_request;

    UPDATE public.responder_capacity_slots
    SET consumed_request_id = v_request.id,
        updated_at = v_now
    WHERE id = v_slot.id;

    PERFORM public.community_write_responder_supply_event(
      'request_accepted',
      v_request.question_id,
      v_request.id,
      v_request.capacity_slot_id,
      'responder',
      v_responder_id,
      p_idempotency_key,
      'requested',
      'accepted',
      NULL,
      p_commercial_relationship,
      false
    );
  ELSE
    UPDATE public.community_responder_requests
    SET status = 'declined',
        response_idempotency_key = p_idempotency_key,
        response_commercial_relationship = p_commercial_relationship,
        response_has_conflict = p_has_conflict,
        decline_reason_code = p_decline_reason_code,
        declined_at = v_now,
        updated_at = v_now
    WHERE id = v_request.id
    RETURNING * INTO v_request;

    PERFORM public.community_write_responder_supply_event(
      'request_declined',
      v_request.question_id,
      v_request.id,
      v_request.capacity_slot_id,
      'responder',
      v_responder_id,
      p_idempotency_key,
      'requested',
      'declined',
      p_decline_reason_code,
      p_commercial_relationship,
      p_has_conflict
    );

    -- A conflict declaration invalidates this broad opt-in unit. It cannot be
    -- silently reused for another question; the responder must create a fresh
    -- slot and the service must review that new declaration.
    IF p_has_conflict THEN
      UPDATE public.responder_capacity_slots
      SET has_conflict = true,
          commercial_relationship = p_commercial_relationship,
          opt_in_status = 'revoked',
          revoked_at = v_now,
          revocation_reason_code = 'conflict_declared',
          revocation_idempotency_key = p_idempotency_key,
          updated_at = v_now
      WHERE id = v_slot.id;

      PERFORM public.community_write_responder_supply_event(
        'slot_revoked',
        v_request.question_id,
        v_request.id,
        v_request.capacity_slot_id,
        'responder',
        v_responder_id,
        p_idempotency_key,
        'active',
        'revoked',
        'conflict_declared',
        p_commercial_relationship,
        true
      );
    END IF;
  END IF;

  SELECT supply.question_state
  INTO v_question_state
  FROM public.community_responder_question_supply AS supply
  WHERE supply.question_id = v_request.question_id;

  RETURN jsonb_build_object(
    'request_id', v_request.id,
    'status', v_request.status,
    'question_state', v_question_state,
    'replayed', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.community_revoke_responder_capacity_slot(
  p_responder_id uuid,
  p_slot_id uuid,
  p_reason_code text,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_responder_id uuid := p_responder_id;
  v_slot public.responder_capacity_slots%ROWTYPE;
  v_request public.community_responder_requests%ROWTYPE;
  v_previous_request_status text;
BEGIN
  IF NOT public.community_request_is_service()
    OR v_responder_id IS NULL THEN
    RAISE EXCEPTION 'verified service responder actor required'
      USING ERRCODE = '42501';
  END IF;

  IF p_slot_id IS NULL
    OR p_idempotency_key IS NULL
    OR p_reason_code NOT IN (
      'topic_opt_out',
      'temporary_unavailable',
      'too_many_requests',
      'prefer_not_to_say'
    ) THEN
    RAISE EXCEPTION 'invalid responder capacity revocation'
      USING ERRCODE = '22023';
  END IF;

  SELECT slot.*
  INTO v_slot
  FROM public.responder_capacity_slots AS slot
  WHERE slot.id = p_slot_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'capacity slot not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_slot.responder_id IS DISTINCT FROM v_responder_id THEN
    RAISE EXCEPTION 'only the slot owner can revoke opt-in'
      USING ERRCODE = '42501';
  END IF;

  IF v_slot.revocation_idempotency_key = p_idempotency_key THEN
    IF v_slot.revocation_reason_code IS DISTINCT FROM p_reason_code THEN
      RAISE EXCEPTION 'capacity revocation idempotency key reused with different payload'
        USING ERRCODE = '22023';
    END IF;

    RETURN jsonb_build_object(
      'slot_id', v_slot.id,
      'opt_in_status', v_slot.opt_in_status,
      'replayed', true
    );
  END IF;

  PERFORM public.community_lock_responder_identity(v_responder_id);

  SELECT slot.*
  INTO v_slot
  FROM public.responder_capacity_slots AS slot
  WHERE slot.id = p_slot_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'capacity slot not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_slot.responder_id IS DISTINCT FROM v_responder_id THEN
    RAISE EXCEPTION 'only the slot owner can revoke opt-in'
      USING ERRCODE = '42501';
  END IF;

  IF v_slot.revocation_idempotency_key = p_idempotency_key THEN
    IF v_slot.revocation_reason_code IS DISTINCT FROM p_reason_code THEN
      RAISE EXCEPTION 'capacity revocation idempotency key reused with different payload'
        USING ERRCODE = '22023';
    END IF;

    RETURN jsonb_build_object(
      'slot_id', v_slot.id,
      'opt_in_status', v_slot.opt_in_status,
      'replayed', true
    );
  END IF;

  IF v_slot.opt_in_status <> 'active' THEN
    RAISE EXCEPTION 'capacity slot is already revoked'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.responder_capacity_slots
  SET opt_in_status = 'revoked',
      revoked_at = v_now,
      revocation_reason_code = p_reason_code,
      revocation_idempotency_key = p_idempotency_key,
      updated_at = v_now
  WHERE id = v_slot.id
  RETURNING * INTO v_slot;

  SELECT request.*
  INTO v_request
  FROM public.community_responder_requests AS request
  WHERE request.capacity_slot_id = v_slot.id
    AND request.status IN ('requested', 'accepted')
  FOR UPDATE;

  IF FOUND THEN
    v_previous_request_status := v_request.status;

    IF v_request.status = 'requested' THEN
      UPDATE public.community_responder_requests
      SET status = 'declined',
          response_idempotency_key = p_idempotency_key,
          response_commercial_relationship = v_slot.commercial_relationship,
          response_has_conflict = v_slot.has_conflict,
          decline_reason_code = CASE
            WHEN p_reason_code = 'too_many_requests' THEN 'too_many_requests'
            ELSE 'not_available'
          END,
          declined_at = v_now,
          updated_at = v_now
      WHERE id = v_request.id
      RETURNING * INTO v_request;

      PERFORM public.community_write_responder_supply_event(
        'request_declined',
        v_request.question_id,
        v_request.id,
        v_request.capacity_slot_id,
        'responder',
        v_responder_id,
        p_idempotency_key,
        v_previous_request_status,
        'declined',
        v_request.decline_reason_code,
        v_slot.commercial_relationship,
        v_slot.has_conflict
      );
    ELSE
      UPDATE public.community_responder_requests
      SET status = 'expired',
          expiry_idempotency_key = p_idempotency_key,
          expiry_reason_code = 'responder_opt_out',
          expired_at = v_now,
          updated_at = v_now
      WHERE id = v_request.id
      RETURNING * INTO v_request;

      PERFORM public.community_write_responder_supply_event(
        'request_expired',
        v_request.question_id,
        v_request.id,
        v_request.capacity_slot_id,
        'responder',
        v_responder_id,
        p_idempotency_key,
        v_previous_request_status,
        'expired',
        'responder_opt_out',
        v_slot.commercial_relationship,
        v_slot.has_conflict
      );
    END IF;
  END IF;

  PERFORM public.community_write_responder_supply_event(
    'slot_revoked',
    CASE WHEN v_request.id IS NULL THEN NULL ELSE v_request.question_id END,
    CASE WHEN v_request.id IS NULL THEN NULL ELSE v_request.id END,
    v_slot.id,
    'responder',
    v_responder_id,
    p_idempotency_key,
    'active',
    'revoked',
    p_reason_code,
    v_slot.commercial_relationship,
    v_slot.has_conflict
  );

  RETURN jsonb_build_object(
    'slot_id', v_slot.id,
    'opt_in_status', v_slot.opt_in_status,
    'affected_request_id', v_request.id,
    'replayed', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.community_expire_responder_request(
  p_request_id uuid,
  p_operator_id uuid,
  p_reason_code text,
  p_effective_at timestamptz,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_request public.community_responder_requests%ROWTYPE;
  v_slot public.responder_capacity_slots%ROWTYPE;
  v_previous_status text;
BEGIN
  PERFORM public.community_assert_responder_operator(p_operator_id);

  IF p_request_id IS NULL
    OR p_idempotency_key IS NULL
    OR p_effective_at IS NULL
    OR p_effective_at > clock_timestamp() + interval '5 minutes'
    OR p_reason_code NOT IN (
      'request_deadline',
      'slot_availability_ended',
      'operator_capacity_withdrawal'
    ) THEN
    RAISE EXCEPTION 'invalid responder request expiration'
      USING ERRCODE = '22023';
  END IF;

  SELECT request.*
  INTO v_request
  FROM public.community_responder_requests AS request
  WHERE request.id = p_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'responder request not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_request.expiry_idempotency_key = p_idempotency_key THEN
    IF v_request.status <> 'expired'
      OR v_request.expiry_reason_code IS DISTINCT FROM p_reason_code THEN
      RAISE EXCEPTION 'request expiration idempotency key reused with different payload'
        USING ERRCODE = '22023';
    END IF;

    RETURN jsonb_build_object(
      'request_id', v_request.id,
      'status', v_request.status,
      'replayed', true
    );
  END IF;

  PERFORM public.community_lock_responder_identity(v_request.responder_id);

  SELECT slot.*
  INTO v_slot
  FROM public.responder_capacity_slots AS slot
  WHERE slot.id = v_request.capacity_slot_id
  FOR UPDATE;

  SELECT request.*
  INTO v_request
  FROM public.community_responder_requests AS request
  WHERE request.id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'responder request not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_request.capacity_slot_id IS DISTINCT FROM v_slot.id THEN
    RAISE EXCEPTION 'responder request capacity changed'
      USING ERRCODE = '40001';
  END IF;

  IF v_request.expiry_idempotency_key = p_idempotency_key THEN
    IF v_request.status <> 'expired'
      OR v_request.expiry_reason_code IS DISTINCT FROM p_reason_code THEN
      RAISE EXCEPTION 'request expiration idempotency key reused with different payload'
        USING ERRCODE = '22023';
    END IF;

    RETURN jsonb_build_object(
      'request_id', v_request.id,
      'status', v_request.status,
      'replayed', true
    );
  END IF;

  IF v_request.status NOT IN ('requested', 'accepted') THEN
    RAISE EXCEPTION 'responder request is already final'
      USING ERRCODE = '55000';
  END IF;

  IF (
      p_reason_code = 'request_deadline'
      AND (
        v_request.status <> 'requested'
        OR p_effective_at < v_request.expires_at
      )
    )
    OR (
      p_reason_code = 'slot_availability_ended'
      AND p_effective_at < v_slot.available_until
      AND v_slot.opt_in_status = 'active'
    ) THEN
    RAISE EXCEPTION 'responder request is not due for expiration'
      USING ERRCODE = '55000';
  END IF;

  v_previous_status := v_request.status;

  UPDATE public.community_responder_requests
  SET status = 'expired',
      expiry_idempotency_key = p_idempotency_key,
      expiry_reason_code = p_reason_code,
      expired_at = p_effective_at,
      updated_at = clock_timestamp()
  WHERE id = v_request.id
  RETURNING * INTO v_request;

  PERFORM public.community_write_responder_supply_event(
    'request_expired',
    v_request.question_id,
    v_request.id,
    v_request.capacity_slot_id,
    'operator',
    p_operator_id,
    p_idempotency_key,
    v_previous_status,
    'expired',
    p_reason_code,
    COALESCE(
      v_request.response_commercial_relationship,
      v_request.commercial_relationship_at_request
    ),
    COALESCE(v_request.response_has_conflict, v_request.conflict_at_request)
  );

  RETURN jsonb_build_object(
    'request_id', v_request.id,
    'status', v_request.status,
    'previous_status', v_previous_status,
    'question_state', (
      SELECT supply.question_state
      FROM public.community_responder_question_supply AS supply
      WHERE supply.question_id = v_request.question_id
    ),
    'replayed', false
  );
END;
$$;

-- Every responder mutation now publishes one immutable command receipt. The
-- business functions above remain the mutation implementations, while the
-- public service RPCs below claim and complete this ledger before exposing a
-- result. This makes retries independent of current runtime, suspension,
-- visibility, capacity, or question state.
CREATE TABLE public.community_responder_command_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL,
  operation text NOT NULL,
  idempotency_key uuid NOT NULL,
  request_payload jsonb NOT NULL,
  request_digest text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  response_payload jsonb,
  response_digest text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  CONSTRAINT community_responder_command_receipts_identity_unique
    UNIQUE (actor_id, operation, idempotency_key),
  CONSTRAINT community_responder_command_receipts_operation_valid
    CHECK (operation IN (
      'register_capacity',
      'review_capacity',
      'create_request',
      'respond_request',
      'revoke_capacity',
      'expire_request'
    )),
  CONSTRAINT community_responder_command_receipts_payload_object
    CHECK (jsonb_typeof(request_payload) = 'object'),
  CONSTRAINT community_responder_command_receipts_status_valid
    CHECK (status IN ('pending', 'completed')),
  CONSTRAINT community_responder_command_receipts_completion_valid
    CHECK (
      (
        status = 'pending'
        AND response_payload IS NULL
        AND response_digest IS NULL
        AND completed_at IS NULL
      )
      OR
      (
        status = 'completed'
        AND jsonb_typeof(response_payload) = 'object'
        AND response_digest IS NOT NULL
        AND completed_at IS NOT NULL
      )
    ),
  CONSTRAINT community_responder_command_receipts_request_digest_valid
    CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT community_responder_command_receipts_response_digest_valid
    CHECK (response_digest IS NULL OR response_digest ~ '^[0-9a-f]{64}$')
);

ALTER TABLE public.community_responder_command_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.community_responder_command_receipts
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.community_responder_canonical_command_payload(
  p_operation text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid responder command payload'
      USING ERRCODE = '22023';
  END IF;

  CASE p_operation
    WHEN 'register_capacity' THEN
      RETURN jsonb_build_object(
        'responder_origin', p_payload ->> 'responder_origin',
        'topic', p_payload ->> 'topic',
        'experience_scope', p_payload ->> 'experience_scope',
        'experience_period', p_payload ->> 'experience_period',
        'commercial_relationship', p_payload ->> 'commercial_relationship',
        'has_conflict', (p_payload ->> 'has_conflict')::boolean,
        'available_from', (p_payload ->> 'available_from')::timestamptz,
        'available_until', (p_payload ->> 'available_until')::timestamptz,
        'weekly_request_limit', (p_payload ->> 'weekly_request_limit')::smallint,
        'cooldown_hours', (p_payload ->> 'cooldown_hours')::smallint,
        'max_open_requests', (p_payload ->> 'max_open_requests')::smallint
      );
    WHEN 'review_capacity' THEN
      RETURN jsonb_build_object(
        'slot_id', (p_payload ->> 'slot_id')::uuid,
        'decision', p_payload ->> 'decision',
        'reason_code', p_payload ->> 'reason_code'
      );
    WHEN 'create_request' THEN
      RETURN jsonb_build_object(
        'question_id', (p_payload ->> 'question_id')::uuid,
        'capacity_slot_id', (p_payload ->> 'capacity_slot_id')::uuid,
        'requested_role', p_payload ->> 'requested_role',
        'topic', p_payload ->> 'topic',
        'experience_scope', p_payload ->> 'experience_scope',
        'expires_at', (p_payload ->> 'expires_at')::timestamptz
      );
    WHEN 'respond_request' THEN
      RETURN jsonb_build_object(
        'request_id', (p_payload ->> 'request_id')::uuid,
        'decision', p_payload ->> 'decision',
        'commercial_relationship', p_payload ->> 'commercial_relationship',
        'has_conflict', (p_payload ->> 'has_conflict')::boolean,
        'decline_reason_code', p_payload ->> 'decline_reason_code'
      );
    WHEN 'revoke_capacity' THEN
      RETURN jsonb_build_object(
        'slot_id', (p_payload ->> 'slot_id')::uuid,
        'reason_code', p_payload ->> 'reason_code'
      );
    WHEN 'expire_request' THEN
      RETURN jsonb_build_object(
        'request_id', (p_payload ->> 'request_id')::uuid,
        'reason_code', p_payload ->> 'reason_code',
        'effective_at', (p_payload ->> 'effective_at')::timestamptz
      );
    ELSE
      RAISE EXCEPTION 'invalid responder command operation'
        USING ERRCODE = '22023';
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_responder_command_digest(
  p_payload jsonb
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, extensions, pg_temp
AS $$
  SELECT encode(
    extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256'),
    'hex'
  )
$$;

CREATE OR REPLACE FUNCTION public.community_claim_responder_command(
  p_actor_id uuid,
  p_operation text,
  p_idempotency_key uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_payload jsonb;
  v_digest text;
  v_receipt public.community_responder_command_receipts%ROWTYPE;
  v_id uuid;
BEGIN
  v_payload := public.community_responder_canonical_command_payload(
    p_operation,
    p_payload
  );
  v_digest := public.community_responder_command_digest(v_payload);

  INSERT INTO public.community_responder_command_receipts (
    actor_id,
    operation,
    idempotency_key,
    request_payload,
    request_digest
  ) VALUES (
    p_actor_id,
    p_operation,
    p_idempotency_key,
    v_payload,
    v_digest
  )
  ON CONFLICT (actor_id, operation, idempotency_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('claimed', true, 'command_id', v_id);
  END IF;

  SELECT receipt.*
  INTO v_receipt
  FROM public.community_responder_command_receipts AS receipt
  WHERE receipt.actor_id = p_actor_id
    AND receipt.operation = p_operation
    AND receipt.idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'responder command receipt is unavailable'
      USING ERRCODE = '55000';
  END IF;
  IF v_receipt.request_digest IS DISTINCT FROM v_digest
    OR v_receipt.request_payload IS DISTINCT FROM v_payload THEN
    RAISE EXCEPTION 'responder idempotency key reused with different payload'
      USING ERRCODE = '22023';
  END IF;
  IF v_receipt.status <> 'completed'
    OR v_receipt.response_payload IS NULL
    OR v_receipt.response_digest IS NULL
    OR jsonb_typeof(v_receipt.response_payload) IS DISTINCT FROM 'object'
    OR v_receipt.response_payload ? 'replayed' THEN
    RAISE EXCEPTION 'responder command receipt is unavailable'
      USING ERRCODE = '55000';
  END IF;
  IF v_receipt.response_digest
    <> public.community_responder_command_digest(v_receipt.response_payload) THEN
    RAISE EXCEPTION 'responder command receipt digest mismatch'
      USING ERRCODE = '55000';
  END IF;

  RETURN jsonb_build_object(
    'claimed', false,
    'response_payload', v_receipt.response_payload
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.community_complete_responder_command(
  p_command_id uuid,
  p_response_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_response jsonb;
BEGIN
  IF jsonb_typeof(p_response_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'responder command receipt is invalid'
      USING ERRCODE = '55000';
  END IF;
  v_response := p_response_payload - 'replayed';
  IF v_response ? 'replayed' THEN
    RAISE EXCEPTION 'responder command receipt is invalid'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.community_responder_command_receipts
  SET status = 'completed',
      response_payload = v_response,
      response_digest = public.community_responder_command_digest(v_response),
      completed_at = clock_timestamp()
  WHERE id = p_command_id
    AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'responder command receipt cannot be completed'
      USING ERRCODE = '55000';
  END IF;
  RETURN v_response;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_replay_responder_command_service(
  p_actor_id uuid,
  p_operation text,
  p_idempotency_key uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_payload jsonb;
  v_digest text;
  v_receipt public.community_responder_command_receipts%ROWTYPE;
BEGIN
  IF NOT public.community_request_is_service()
    OR p_actor_id IS NULL
    OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'verified service responder actor required'
      USING ERRCODE = '42501';
  END IF;
  v_payload := public.community_responder_canonical_command_payload(
    p_operation,
    p_payload
  );
  v_digest := public.community_responder_command_digest(v_payload);

  SELECT receipt.*
  INTO v_receipt
  FROM public.community_responder_command_receipts AS receipt
  WHERE receipt.actor_id = p_actor_id
    AND receipt.operation = p_operation
    AND receipt.idempotency_key = p_idempotency_key;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF v_receipt.request_digest IS DISTINCT FROM v_digest
    OR v_receipt.request_payload IS DISTINCT FROM v_payload THEN
    RAISE EXCEPTION 'responder idempotency key reused with different payload'
      USING ERRCODE = '22023';
  END IF;
  IF v_receipt.status <> 'completed'
    OR v_receipt.response_payload IS NULL
    OR v_receipt.response_digest IS NULL
    OR jsonb_typeof(v_receipt.response_payload) IS DISTINCT FROM 'object'
    OR v_receipt.response_payload ? 'replayed' THEN
    RAISE EXCEPTION 'responder command receipt is unavailable'
      USING ERRCODE = '55000';
  END IF;
  IF v_receipt.response_digest
    <> public.community_responder_command_digest(v_receipt.response_payload) THEN
    RAISE EXCEPTION 'responder command receipt digest mismatch'
      USING ERRCODE = '55000';
  END IF;
  RETURN v_receipt.response_payload;
END;
$$;

ALTER FUNCTION public.community_register_responder_capacity_slot(
  uuid, text, text, text, text, text, boolean, timestamptz, timestamptz,
  smallint, smallint, smallint, uuid
) RENAME TO community_register_responder_capacity_slot_receipt_impl;
ALTER FUNCTION public.community_review_responder_capacity_slot(
  uuid, uuid, text, text, uuid
) RENAME TO community_review_responder_capacity_slot_receipt_impl;
ALTER FUNCTION public.community_create_responder_request(
  uuid, uuid, text, text, text, timestamptz, uuid, uuid
) RENAME TO community_create_responder_request_receipt_impl;
ALTER FUNCTION public.community_respond_responder_request(
  uuid, uuid, text, text, boolean, text, uuid
) RENAME TO community_respond_responder_request_receipt_impl;
ALTER FUNCTION public.community_revoke_responder_capacity_slot(
  uuid, uuid, text, uuid
) RENAME TO community_revoke_responder_capacity_slot_receipt_impl;
ALTER FUNCTION public.community_expire_responder_request(
  uuid, uuid, text, timestamptz, uuid
) RENAME TO community_expire_responder_request_receipt_impl;

CREATE OR REPLACE FUNCTION public.community_register_responder_capacity_slot(
  p_responder_id uuid,
  p_responder_origin text,
  p_topic text,
  p_experience_scope text,
  p_experience_period text,
  p_commercial_relationship text,
  p_has_conflict boolean,
  p_available_from timestamptz,
  p_available_until timestamptz,
  p_weekly_request_limit smallint,
  p_cooldown_hours smallint,
  p_max_open_requests smallint,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_claim jsonb;
  v_payload jsonb;
  v_result jsonb;
BEGIN
  IF NOT public.community_request_is_service()
    OR p_responder_id IS NULL
    OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'verified service responder actor required'
      USING ERRCODE = '42501';
  END IF;
  v_payload := jsonb_build_object(
    'responder_origin', p_responder_origin,
    'topic', p_topic,
    'experience_scope', p_experience_scope,
    'experience_period', p_experience_period,
    'commercial_relationship', p_commercial_relationship,
    'has_conflict', p_has_conflict,
    'available_from', p_available_from,
    'available_until', p_available_until,
    'weekly_request_limit', p_weekly_request_limit,
    'cooldown_hours', p_cooldown_hours,
    'max_open_requests', p_max_open_requests
  );
  v_claim := public.community_claim_responder_command(
    p_responder_id, 'register_capacity', p_idempotency_key, v_payload
  );
  IF NOT (v_claim ->> 'claimed')::boolean THEN
    RETURN v_claim -> 'response_payload';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.responder_capacity_slots
    WHERE responder_id = p_responder_id
      AND consent_idempotency_key = p_idempotency_key
  ) THEN
    RAISE EXCEPTION 'responder command receipt is unavailable'
      USING ERRCODE = '55000';
  END IF;
  v_result := public.community_register_responder_capacity_slot_receipt_impl(
    p_responder_id, p_responder_origin, p_topic, p_experience_scope,
    p_experience_period, p_commercial_relationship, p_has_conflict,
    p_available_from, p_available_until, p_weekly_request_limit,
    p_cooldown_hours, p_max_open_requests, p_idempotency_key
  );
  RETURN public.community_complete_responder_command(
    (v_claim ->> 'command_id')::uuid,
    v_result
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.community_review_responder_capacity_slot(
  p_slot_id uuid,
  p_operator_id uuid,
  p_decision text,
  p_reason_code text,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_claim jsonb;
  v_result jsonb;
BEGIN
  IF NOT public.community_request_is_service()
    OR p_operator_id IS NULL
    OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'verified service responder actor required'
      USING ERRCODE = '42501';
  END IF;
  v_claim := public.community_claim_responder_command(
    p_operator_id,
    'review_capacity',
    p_idempotency_key,
    jsonb_build_object(
      'slot_id', p_slot_id,
      'decision', p_decision,
      'reason_code', p_reason_code
    )
  );
  IF NOT (v_claim ->> 'claimed')::boolean THEN
    RETURN v_claim -> 'response_payload';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.responder_capacity_slots
    WHERE review_idempotency_key = p_idempotency_key
  ) THEN
    RAISE EXCEPTION 'responder command receipt is unavailable'
      USING ERRCODE = '55000';
  END IF;
  v_result := public.community_review_responder_capacity_slot_receipt_impl(
    p_slot_id, p_operator_id, p_decision, p_reason_code, p_idempotency_key
  );
  RETURN public.community_complete_responder_command(
    (v_claim ->> 'command_id')::uuid,
    v_result
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.community_create_responder_request(
  p_question_id uuid,
  p_capacity_slot_id uuid,
  p_requested_role text,
  p_topic text,
  p_experience_scope text,
  p_expires_at timestamptz,
  p_operator_id uuid,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_claim jsonb;
  v_result jsonb;
BEGIN
  IF NOT public.community_request_is_service()
    OR p_operator_id IS NULL
    OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'verified service responder actor required'
      USING ERRCODE = '42501';
  END IF;
  v_claim := public.community_claim_responder_command(
    p_operator_id,
    'create_request',
    p_idempotency_key,
    jsonb_build_object(
      'question_id', p_question_id,
      'capacity_slot_id', p_capacity_slot_id,
      'requested_role', p_requested_role,
      'topic', p_topic,
      'experience_scope', p_experience_scope,
      'expires_at', p_expires_at
    )
  );
  IF NOT (v_claim ->> 'claimed')::boolean THEN
    RETURN v_claim -> 'response_payload';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.community_responder_requests
    WHERE request_idempotency_key = p_idempotency_key
  ) THEN
    RAISE EXCEPTION 'responder command receipt is unavailable'
      USING ERRCODE = '55000';
  END IF;
  v_result := public.community_create_responder_request_receipt_impl(
    p_question_id, p_capacity_slot_id, p_requested_role, p_topic,
    p_experience_scope, p_expires_at, p_operator_id, p_idempotency_key
  );
  RETURN public.community_complete_responder_command(
    (v_claim ->> 'command_id')::uuid,
    v_result
  );
END;
$$;

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
  v_claim jsonb;
  v_result jsonb;
BEGIN
  IF NOT public.community_request_is_service()
    OR p_responder_id IS NULL
    OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'verified service responder actor required'
      USING ERRCODE = '42501';
  END IF;
  v_claim := public.community_claim_responder_command(
    p_responder_id,
    'respond_request',
    p_idempotency_key,
    jsonb_build_object(
      'request_id', p_request_id,
      'decision', p_decision,
      'commercial_relationship', p_commercial_relationship,
      'has_conflict', p_has_conflict,
      'decline_reason_code', p_decline_reason_code
    )
  );
  IF NOT (v_claim ->> 'claimed')::boolean THEN
    RETURN v_claim -> 'response_payload';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.community_responder_requests
    WHERE responder_id = p_responder_id
      AND response_idempotency_key = p_idempotency_key
  ) THEN
    RAISE EXCEPTION 'responder command receipt is unavailable'
      USING ERRCODE = '55000';
  END IF;
  v_result := public.community_respond_responder_request_receipt_impl(
    p_responder_id, p_request_id, p_decision, p_commercial_relationship,
    p_has_conflict, p_decline_reason_code, p_idempotency_key
  );
  RETURN public.community_complete_responder_command(
    (v_claim ->> 'command_id')::uuid,
    v_result
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.community_revoke_responder_capacity_slot(
  p_responder_id uuid,
  p_slot_id uuid,
  p_reason_code text,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_claim jsonb;
  v_result jsonb;
BEGIN
  IF NOT public.community_request_is_service()
    OR p_responder_id IS NULL
    OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'verified service responder actor required'
      USING ERRCODE = '42501';
  END IF;
  v_claim := public.community_claim_responder_command(
    p_responder_id,
    'revoke_capacity',
    p_idempotency_key,
    jsonb_build_object('slot_id', p_slot_id, 'reason_code', p_reason_code)
  );
  IF NOT (v_claim ->> 'claimed')::boolean THEN
    RETURN v_claim -> 'response_payload';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.responder_capacity_slots
    WHERE responder_id = p_responder_id
      AND revocation_idempotency_key = p_idempotency_key
  ) THEN
    RAISE EXCEPTION 'responder command receipt is unavailable'
      USING ERRCODE = '55000';
  END IF;
  v_result := public.community_revoke_responder_capacity_slot_receipt_impl(
    p_responder_id, p_slot_id, p_reason_code, p_idempotency_key
  );
  RETURN public.community_complete_responder_command(
    (v_claim ->> 'command_id')::uuid,
    v_result
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.community_expire_responder_request(
  p_request_id uuid,
  p_operator_id uuid,
  p_reason_code text,
  p_effective_at timestamptz,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_claim jsonb;
  v_result jsonb;
BEGIN
  IF NOT public.community_request_is_service()
    OR p_operator_id IS NULL
    OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'verified service responder actor required'
      USING ERRCODE = '42501';
  END IF;
  v_claim := public.community_claim_responder_command(
    p_operator_id,
    'expire_request',
    p_idempotency_key,
    jsonb_build_object(
      'request_id', p_request_id,
      'reason_code', p_reason_code,
      'effective_at', p_effective_at
    )
  );
  IF NOT (v_claim ->> 'claimed')::boolean THEN
    RETURN v_claim -> 'response_payload';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.community_responder_requests
    WHERE expiry_idempotency_key = p_idempotency_key
  ) THEN
    RAISE EXCEPTION 'responder command receipt is unavailable'
      USING ERRCODE = '55000';
  END IF;
  v_result := public.community_expire_responder_request_receipt_impl(
    p_request_id, p_operator_id, p_reason_code, p_effective_at,
    p_idempotency_key
  );
  RETURN public.community_complete_responder_command(
    (v_claim ->> 'command_id')::uuid,
    v_result
  );
END;
$$;

REVOKE ALL ON FUNCTION public.community_responder_canonical_command_payload(text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_responder_command_digest(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_claim_responder_command(uuid, text, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_complete_responder_command(uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_replay_responder_command_service(
  uuid, text, uuid, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_replay_responder_command_service(
  uuid, text, uuid, jsonb
) TO service_role;

REVOKE ALL ON FUNCTION public.community_register_responder_capacity_slot_receipt_impl(
  uuid, text, text, text, text, text, boolean, timestamptz, timestamptz,
  smallint, smallint, smallint, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_review_responder_capacity_slot_receipt_impl(
  uuid, uuid, text, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_create_responder_request_receipt_impl(
  uuid, uuid, text, text, text, timestamptz, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_respond_responder_request_receipt_impl(
  uuid, uuid, text, text, boolean, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_revoke_responder_capacity_slot_receipt_impl(
  uuid, uuid, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_expire_responder_request_receipt_impl(
  uuid, uuid, text, timestamptz, uuid
) FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.responder_capacity_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_responder_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_responder_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_responder_supply_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE
  public.responder_capacity_slots,
  public.community_responder_questions,
  public.community_responder_requests,
  public.community_responder_supply_events
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL PRIVILEGES ON TABLE
  public.community_responder_question_supply
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE
  public.responder_capacity_slots,
  public.community_responder_questions,
  public.community_responder_requests,
  public.community_responder_supply_events,
  public.community_responder_question_supply
  TO service_role;

GRANT SELECT (
  id,
  responder_id,
  responder_origin,
  topic,
  experience_scope,
  experience_period,
  experience_basis,
  commercial_relationship,
  has_conflict,
  available_from,
  available_until,
  weekly_request_limit,
  cooldown_hours,
  max_open_requests,
  opt_in_status,
  eligibility_status,
  review_reason_code,
  revoked_at,
  revocation_reason_code,
  consumed_request_id,
  created_at,
  updated_at
) ON public.responder_capacity_slots TO authenticated;

GRANT SELECT (
  id,
  question_id,
  capacity_slot_id,
  responder_id,
  requested_role,
  responder_origin,
  supply_lane,
  topic,
  experience_scope,
  experience_period,
  commercial_relationship_at_request,
  conflict_at_request,
  status,
  response_commercial_relationship,
  response_has_conflict,
  decline_reason_code,
  expiry_reason_code,
  created_at,
  expires_at,
  accepted_at,
  declined_at,
  expired_at,
  updated_at
) ON public.community_responder_requests TO authenticated;

CREATE POLICY responder_capacity_slots_owner_select
  ON public.responder_capacity_slots
  FOR SELECT TO authenticated
  USING (responder_id = auth.uid());

CREATE POLICY community_runtime_read_fence
  ON public.responder_capacity_slots
  AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (public.community_runtime_mode() <> 'disabled');

CREATE POLICY responder_capacity_slots_service_select
  ON public.responder_capacity_slots
  FOR SELECT TO service_role
  USING (true);

CREATE POLICY community_responder_questions_service_select
  ON public.community_responder_questions
  FOR SELECT TO service_role
  USING (true);

CREATE POLICY community_responder_requests_owner_select
  ON public.community_responder_requests
  FOR SELECT TO authenticated
  USING (responder_id = auth.uid());

CREATE POLICY community_runtime_read_fence
  ON public.community_responder_requests
  AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (public.community_runtime_mode() <> 'disabled');

CREATE POLICY community_responder_requests_service_select
  ON public.community_responder_requests
  FOR SELECT TO service_role
  USING (true);

CREATE POLICY community_responder_supply_events_service_select
  ON public.community_responder_supply_events
  FOR SELECT TO service_role
  USING (true);

REVOKE ALL ON FUNCTION public.community_guard_responder_supply_event()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_tombstone_responder_reviewer()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_write_responder_supply_event(
  text, uuid, uuid, uuid, text, uuid, uuid, text, text, text, text, boolean
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_assert_responder_operator(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_assert_responder_runtime_normal()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_lock_responder_identity(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_assert_responder_eligible(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.community_register_responder_capacity_slot(
  uuid, text, text, text, text, text, boolean, timestamptz, timestamptz,
  smallint, smallint, smallint, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_register_responder_capacity_slot(
  uuid, text, text, text, text, text, boolean, timestamptz, timestamptz,
  smallint, smallint, smallint, uuid
) TO service_role;

REVOKE ALL ON FUNCTION public.community_review_responder_capacity_slot(
  uuid, uuid, text, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_review_responder_capacity_slot(
  uuid, uuid, text, text, uuid
) TO service_role;

REVOKE ALL ON FUNCTION public.community_create_responder_request(
  uuid, uuid, text, text, text, timestamptz, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_create_responder_request(
  uuid, uuid, text, text, text, timestamptz, uuid, uuid
) TO service_role;

REVOKE ALL ON FUNCTION public.community_respond_responder_request(
  uuid, uuid, text, text, boolean, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_respond_responder_request(
  uuid, uuid, text, text, boolean, text, uuid
) TO service_role;

REVOKE ALL ON FUNCTION public.community_revoke_responder_capacity_slot(
  uuid, uuid, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_revoke_responder_capacity_slot(
  uuid, uuid, text, uuid
) TO service_role;

REVOKE ALL ON FUNCTION public.community_expire_responder_request(
  uuid, uuid, text, timestamptz, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_expire_responder_request(
  uuid, uuid, text, timestamptz, uuid
) TO service_role;

COMMENT ON TABLE public.responder_capacity_slots IS
  'Responder-owned opt-in units with coarse direct-experience scope, explicit disclosures, burden limits, and one-time consumption.';
COMMENT ON TABLE public.community_responder_questions IS
  'Private supply-gate references only; no question body or sensitive wedding context is stored here.';
COMMENT ON VIEW public.community_responder_question_supply IS
  'Service-only truth projection. Human, peer-member, and industry lanes are counted separately; ready_for_review requires distinct current peer-member primary and backup slots.';
COMMENT ON FUNCTION public.community_create_responder_request(
  uuid, uuid, text, text, text, timestamptz, uuid, uuid
) IS
  'Service-only request issuer. Applies opt-in, human review, conflict, cooldown, weekly, WIP, distinct responder, and one-slot concurrency gates.';
COMMENT ON FUNCTION public.community_respond_responder_request(
  uuid, uuid, text, text, boolean, text, uuid
) IS
  'Service-only, actor-explicit accept/decline command. Accept is blocked outside normal runtime mode; decline and opt-out remain available.';

-- Intentionally no community_posts foreign key or publication mutation yet.
-- The DecisionThread/API integration must:
--   1. create a private draft UUID and issue primary + backup requests;
--   2. read community_responder_question_supply with service role;
--   3. atomically lock the question, re-check ready_for_review, run PII/source
--      review, and only then create/publish the public question;
--   4. never count candidate, sent, requested, AI, operator, or declined rows as
--      confirmed human capacity or as a human answer.

COMMIT;
