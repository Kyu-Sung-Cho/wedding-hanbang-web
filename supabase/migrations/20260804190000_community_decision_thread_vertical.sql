BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';

-- DecisionThread P0 is deliberately one text-only public topic. Private
-- couple ids, exact wedding dates, exact addresses, private budgets, partner
-- conversations, and media references do not belong in these tables.
ALTER TABLE public.community_posts
  ADD COLUMN IF NOT EXISTS post_format text,
  ADD COLUMN IF NOT EXISTS topic_category text,
  ADD COLUMN IF NOT EXISTS publication_state text,
  ADD COLUMN IF NOT EXISTS audience_scope text,
  ADD COLUMN IF NOT EXISTS commercial_relationship text;

ALTER TABLE public.community_posts
  ADD CONSTRAINT community_posts_decision_post_format
    CHECK (
      post_format IS NULL
      OR post_format IN ('experience_question', 'condition_check', 'outcome_update')
    ),
  ADD CONSTRAINT community_posts_decision_topic
    CHECK (topic_category IS NULL OR topic_category = 'contract_extra_cost'),
  ADD CONSTRAINT community_posts_publication_state
    CHECK (
      publication_state IS NULL
      OR publication_state IN ('draft', 'published', 'failed', 'withdrawn')
    ),
  ADD CONSTRAINT community_posts_audience_scope
    CHECK (
      audience_scope IS NULL
      OR audience_scope IN ('public', 'members', 'cohort')
    ),
  ADD CONSTRAINT community_posts_commercial_relationship
    CHECK (
      commercial_relationship IS NULL
      OR commercial_relationship IN (
        'none', 'gift', 'discount', 'refund', 'affiliate', 'paid',
        'employee', 'owner_or_family', 'platform_research_compensation'
      )
    );

CREATE TABLE public.community_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  operation text NOT NULL,
  idempotency_key uuid NOT NULL,
  payload_hash text NOT NULL,
  hash_schema_version smallint NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending',
  result_reference uuid,
  result_payload jsonb,
  safe_error_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT community_commands_operation
    CHECK (operation IN (
      'decision_thread_publish',
      'decision_thread_answer',
      'decision_thread_applicability',
      'decision_thread_resolve',
      'decision_thread_outcome',
      'decision_thread_withdraw'
    )),
  CONSTRAINT community_commands_hash
    CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT community_commands_hash_version
    CHECK (hash_schema_version = 1),
  CONSTRAINT community_commands_status
    CHECK (status IN (
      'pending', 'waiting_for_supply', 'succeeded', 'failed',
      'state_unconfirmed', 'terminal'
    )),
  CONSTRAINT community_commands_result_shape CHECK (
    (status IN ('succeeded', 'terminal') AND result_payload IS NOT NULL)
    OR (status NOT IN ('succeeded', 'terminal') AND result_payload IS NULL)
  ),
  CONSTRAINT community_commands_identity
    UNIQUE (actor_id, operation, idempotency_key)
);

CREATE TABLE public.community_decision_beta_members (
  author_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.community_decision_thread_intakes (
  question_id uuid PRIMARY KEY,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  command_id uuid NOT NULL UNIQUE
    REFERENCES public.community_commands(id) ON DELETE RESTRICT,
  payload_hash text NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  topic_category text NOT NULL,
  experience_scope text NOT NULL,
  coarse_region text,
  preparation_stage text NOT NULL,
  contract_phase text NOT NULL,
  desired_answer text NOT NULL,
  commercial_relationship text NOT NULL,
  sponsorship_detail text,
  status text NOT NULL DEFAULT 'private_waitlist',
  published_post_id uuid UNIQUE,
  published_thread_id uuid UNIQUE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT community_decision_intakes_hash
    CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT community_decision_intakes_title
    CHECK (char_length(btrim(title)) BETWEEN 8 AND 160),
  CONSTRAINT community_decision_intakes_content
    CHECK (char_length(btrim(content)) BETWEEN 20 AND 5000),
  CONSTRAINT community_decision_intakes_topic
    CHECK (topic_category = 'contract_extra_cost'),
  CONSTRAINT community_decision_intakes_scope
    CHECK (experience_scope IN (
      'contract_terms', 'extra_charge', 'vendor_response',
      'cancellation_refund'
    )),
  CONSTRAINT community_decision_intakes_region
    CHECK (
      coarse_region IS NULL
      OR char_length(btrim(coarse_region)) BETWEEN 2 AND 40
    ),
  CONSTRAINT community_decision_intakes_stage
    CHECK (preparation_stage IN (
      'vendor_search', 'contract_review', 'contracted',
      'dispute_or_cancellation'
    )),
  CONSTRAINT community_decision_intakes_phase
    CHECK (contract_phase IN (
      'before_contract', 'after_contract', 'cancellation_or_refund'
    )),
  CONSTRAINT community_decision_intakes_desired_answer
    CHECK (char_length(btrim(desired_answer)) BETWEEN 5 AND 300),
  CONSTRAINT community_decision_intakes_relationship
    CHECK (commercial_relationship IN (
      'none', 'gift', 'discount', 'refund', 'affiliate', 'paid',
      'employee', 'owner_or_family', 'platform_research_compensation'
    )),
  CONSTRAINT community_decision_intakes_disclosure
    CHECK (
      (commercial_relationship = 'none' AND sponsorship_detail IS NULL)
      OR (
        commercial_relationship <> 'none'
        AND char_length(btrim(sponsorship_detail)) BETWEEN 3 AND 500
      )
    ),
  CONSTRAINT community_decision_intakes_status
    CHECK (status IN ('private_waitlist', 'published', 'withdrawn')),
  CONSTRAINT community_decision_intakes_publication_shape
    CHECK (
      (status = 'published' AND published_thread_id IS NOT NULL)
      OR (status <> 'published' AND published_post_id IS NULL
        AND published_thread_id IS NULL)
    )
);

CREATE TABLE public.community_decision_threads (
  id uuid PRIMARY KEY,
  post_id uuid UNIQUE
    REFERENCES public.community_posts(id) ON DELETE SET NULL,
  author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'experience_question',
  topic_category text NOT NULL,
  experience_scope text NOT NULL,
  coarse_region text,
  preparation_stage text NOT NULL,
  contract_phase text NOT NULL,
  desired_answer text NOT NULL,
  state text NOT NULL DEFAULT 'open',
  version bigint NOT NULL DEFAULT 1,
  qualified_peer_answer_count integer NOT NULL DEFAULT 0,
  qualified_professional_answer_count integer NOT NULL DEFAULT 0,
  resolved_at timestamptz,
  next_action text,
  resolution_reason text,
  outcome_due_at timestamptz,
  outcome_timezone text,
  completed_at timestamptz,
  closed_reason text,
  source_unavailable_at timestamptz,
  new_applications_allowed boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT community_decision_threads_kind
    CHECK (kind = 'experience_question'),
  CONSTRAINT community_decision_threads_topic
    CHECK (topic_category = 'contract_extra_cost'),
  CONSTRAINT community_decision_threads_scope
    CHECK (experience_scope IN (
      'contract_terms', 'extra_charge', 'vendor_response',
      'cancellation_refund'
    )),
  CONSTRAINT community_decision_threads_stage
    CHECK (preparation_stage IN (
      'vendor_search', 'contract_review', 'contracted',
      'dispute_or_cancellation'
    )),
  CONSTRAINT community_decision_threads_phase
    CHECK (contract_phase IN (
      'before_contract', 'after_contract', 'cancellation_or_refund'
    )),
  CONSTRAINT community_decision_threads_state
    CHECK (state IN (
      'open', 'answered', 'resolved', 'followup_scheduled',
      'completed', 'closed'
    )),
  CONSTRAINT community_decision_threads_version CHECK (version > 0),
  CONSTRAINT community_decision_threads_counts CHECK (
    qualified_peer_answer_count >= 0
    AND qualified_professional_answer_count >= 0
  ),
  CONSTRAINT community_decision_threads_resolved_shape CHECK (
    state NOT IN ('resolved', 'followup_scheduled', 'completed')
    OR (resolved_at IS NOT NULL AND next_action IS NOT NULL
      AND resolution_reason IS NOT NULL)
  ),
  CONSTRAINT community_decision_threads_followup_shape CHECK (
    state <> 'followup_scheduled'
    OR (outcome_due_at IS NOT NULL AND outcome_timezone IS NOT NULL)
  ),
  CONSTRAINT community_decision_threads_completed_shape CHECK (
    state <> 'completed' OR completed_at IS NOT NULL
  ),
  CONSTRAINT community_decision_threads_closed_shape CHECK (
    state <> 'closed' OR closed_reason IS NOT NULL
  ),
  CONSTRAINT community_decision_threads_source_shape CHECK (
    (source_unavailable_at IS NULL AND new_applications_allowed)
    OR (source_unavailable_at IS NOT NULL AND NOT new_applications_allowed)
  )
);

ALTER TABLE public.community_decision_thread_intakes
  ADD CONSTRAINT community_decision_intakes_published_post
    FOREIGN KEY (published_post_id)
    REFERENCES public.community_posts(id) ON DELETE SET NULL,
  ADD CONSTRAINT community_decision_intakes_published_thread
    FOREIGN KEY (published_thread_id)
    REFERENCES public.community_decision_threads(id) ON DELETE RESTRICT;

CREATE TABLE public.community_decision_thread_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL
    REFERENCES public.community_decision_threads(id) ON DELETE CASCADE,
  thread_version bigint NOT NULL,
  event_type text NOT NULL,
  actor_type text NOT NULL,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_erased_at timestamptz,
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  reason_code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT community_decision_thread_events_version
    UNIQUE (thread_id, thread_version),
  CONSTRAINT community_decision_thread_events_type CHECK (event_type IN (
    'thread_published', 'qualified_answer_added',
    'qualified_answer_count_changed', 'qualified_answer_withdrawn',
    'applicability_recorded', 'thread_resolved',
    'outcome_recorded', 'outcome_revised',
    'source_unavailable', 'source_restored', 'source_withdrawn'
  )),
  CONSTRAINT community_decision_thread_events_actor CHECK (
    actor_type IN ('author', 'answerer', 'service')
    AND (
      (actor_type = 'service' AND actor_id IS NULL)
      OR (actor_type <> 'service' AND (
        (actor_id IS NOT NULL AND actor_erased_at IS NULL)
        OR (actor_id IS NULL AND actor_erased_at IS NOT NULL)
      ))
    )
  ),
  CONSTRAINT community_decision_thread_events_reason
    CHECK (reason_code ~ '^[a-z][a-z0-9_]{1,63}$')
);

CREATE TABLE public.community_decision_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL
    REFERENCES public.community_decision_threads(id) ON DELETE CASCADE,
  comment_id uuid UNIQUE
    REFERENCES public.community_comments(id) ON DELETE SET NULL,
  author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Keep the accepted request UUID after account/question erasure. The
  -- command boundary validates the live request before insert; this durable
  -- scalar is the answer's audit tombstone and must never be nulled by an FK.
  responder_request_id uuid UNIQUE,
  response_kind text NOT NULL,
  content_origin text NOT NULL,
  direct_experience boolean NOT NULL,
  experience_period text NOT NULL,
  experience_stage text NOT NULL,
  coarse_region text,
  action_taken text,
  result_summary text,
  next_check text,
  fact_opinion_boundary text NOT NULL,
  commercial_relationship text NOT NULL,
  sponsorship_detail text,
  rubric_version smallint NOT NULL DEFAULT 1,
  is_qualified boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT community_decision_answers_actor UNIQUE (thread_id, author_id),
  CONSTRAINT community_decision_answers_kind
    CHECK (response_kind IN ('answer', 'experience')),
  CONSTRAINT community_decision_answers_origin
    CHECK (content_origin IN ('member', 'industry_professional')),
  CONSTRAINT community_decision_answers_direct CHECK (direct_experience),
  CONSTRAINT community_decision_answers_period CHECK (experience_period IN (
    'within_3_months', 'within_6_months', 'within_12_months',
    'over_12_months'
  )),
  CONSTRAINT community_decision_answers_stage CHECK (experience_stage IN (
    'vendor_search', 'contract_review', 'contracted',
    'dispute_or_cancellation'
  )),
  CONSTRAINT community_decision_answers_region CHECK (
    coarse_region IS NULL
    OR char_length(btrim(coarse_region)) BETWEEN 2 AND 40
  ),
  CONSTRAINT community_decision_answers_evidence CHECK (
    action_taken IS NOT NULL OR result_summary IS NOT NULL OR next_check IS NOT NULL
  ),
  CONSTRAINT community_decision_answers_boundary CHECK (
    char_length(btrim(fact_opinion_boundary)) BETWEEN 3 AND 500
  ),
  CONSTRAINT community_decision_answers_relationship CHECK (
    commercial_relationship IN (
      'none', 'gift', 'discount', 'refund', 'affiliate', 'paid',
      'employee', 'owner_or_family', 'platform_research_compensation'
    )
  ),
  CONSTRAINT community_decision_answers_disclosure CHECK (
    (commercial_relationship = 'none' AND sponsorship_detail IS NULL)
    OR (
      commercial_relationship <> 'none'
      AND char_length(btrim(sponsorship_detail)) BETWEEN 3 AND 500
    )
  ),
  CONSTRAINT community_decision_answers_rubric CHECK (
    rubric_version = 1 AND is_qualified
  )
);

CREATE TABLE public.community_thread_evidence_selections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL
    REFERENCES public.community_decision_threads(id) ON DELETE CASCADE,
  author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  answer_id uuid NOT NULL
    REFERENCES public.community_decision_answers(id) ON DELETE RESTRICT,
  comment_id uuid
    REFERENCES public.community_comments(id) ON DELETE SET NULL,
  applicability text NOT NULL,
  included_in_resolution_at timestamptz,
  selected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT community_thread_evidence_per_answer
    UNIQUE (thread_id, answer_id, author_id),
  CONSTRAINT community_thread_evidence_applicability CHECK (
    applicability IN (
      'applies', 'conditions_differ', 'need_more_info',
      'taken_as_next_action'
    )
  )
);

CREATE TABLE public.community_decision_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL
    REFERENCES public.community_decision_threads(id) ON DELETE CASCADE,
  author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revision integer NOT NULL,
  supersedes_outcome_id uuid
    REFERENCES public.community_decision_outcomes(id) ON DELETE RESTRICT,
  action_taken text NOT NULL,
  result_summary text NOT NULL,
  applicable_conditions text NOT NULL,
  public_consent boolean NOT NULL DEFAULT false,
  consent_version smallint NOT NULL DEFAULT 1,
  commercial_relationship text NOT NULL,
  sponsorship_detail text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT community_decision_outcomes_revision UNIQUE (thread_id, revision),
  CONSTRAINT community_decision_outcomes_content CHECK (
    char_length(btrim(action_taken)) BETWEEN 3 AND 2000
    AND char_length(btrim(result_summary)) BETWEEN 3 AND 3000
    AND char_length(btrim(applicable_conditions)) BETWEEN 3 AND 2000
  ),
  CONSTRAINT community_decision_outcomes_consent CHECK (consent_version = 1),
  CONSTRAINT community_decision_outcomes_relationship CHECK (
    commercial_relationship IN (
      'none', 'gift', 'discount', 'refund', 'affiliate', 'paid',
      'employee', 'owner_or_family', 'platform_research_compensation'
    )
  ),
  CONSTRAINT community_decision_outcomes_disclosure CHECK (
    (commercial_relationship = 'none' AND sponsorship_detail IS NULL)
    OR (
      commercial_relationship <> 'none'
      AND char_length(btrim(sponsorship_detail)) BETWEEN 3 AND 500
    )
  )
);

CREATE INDEX community_decision_threads_public_feed
  ON public.community_decision_threads(topic_category, state, created_at DESC);
CREATE INDEX community_decision_answers_thread
  ON public.community_decision_answers(thread_id, created_at);
CREATE INDEX community_decision_outcomes_thread
  ON public.community_decision_outcomes(thread_id, revision DESC);

ALTER TABLE public.community_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_decision_beta_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_decision_thread_intakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_decision_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_decision_thread_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_decision_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_thread_evidence_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_decision_outcomes ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE
  public.community_commands,
  public.community_decision_beta_members,
  public.community_decision_thread_intakes,
  public.community_decision_threads,
  public.community_decision_thread_events,
  public.community_decision_answers,
  public.community_thread_evidence_selections,
  public.community_decision_outcomes
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE
  public.community_commands,
  public.community_decision_beta_members,
  public.community_decision_thread_intakes,
  public.community_decision_threads,
  public.community_decision_thread_events,
  public.community_decision_answers,
  public.community_thread_evidence_selections,
  public.community_decision_outcomes
  TO service_role;

CREATE POLICY community_decision_threads_service_select
  ON public.community_decision_threads
  FOR SELECT TO service_role USING (true);
CREATE POLICY community_decision_intakes_service_select
  ON public.community_decision_thread_intakes
  FOR SELECT TO service_role USING (true);
CREATE POLICY community_commands_service_select
  ON public.community_commands
  FOR SELECT TO service_role USING (true);
CREATE POLICY community_decision_beta_members_service_select
  ON public.community_decision_beta_members
  FOR SELECT TO service_role USING (true);
CREATE POLICY community_decision_events_service_select
  ON public.community_decision_thread_events
  FOR SELECT TO service_role USING (true);
CREATE POLICY community_decision_answers_service_select
  ON public.community_decision_answers
  FOR SELECT TO service_role USING (true);
CREATE POLICY community_thread_evidence_service_select
  ON public.community_thread_evidence_selections
  FOR SELECT TO service_role USING (true);
CREATE POLICY community_decision_outcomes_service_select
  ON public.community_decision_outcomes
  FOR SELECT TO service_role USING (true);

CREATE OR REPLACE FUNCTION public.community_decision_public_text_is_safe(
  p_value text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT p_value IS NULL OR NOT (
    p_value ~* '[[:alnum:]_.%+\-]+@[[:alnum:].\-]+\.[[:alpha:]]{2,}'
    OR p_value ~* 'https?://|www\.|mailto:|tel:|sms:|open\.kakao\.com/'
    OR p_value ~ '(^|[^0-9])((\+?82[ .\-]?)?0?1[016789][ .\-]?[0-9]{3,4}[ .\-]?[0-9]{4})([^0-9]|$)'
    OR p_value ~ '(^|[^0-9])0(2|[3-6][1-5])[ .\-]?[0-9]{3,4}[ .\-]?[0-9]{4}([^0-9]|$)'
    OR p_value ~ '(^|[^0-9])[0-9]{6}[ .\-]?[1-4][0-9]{6}([^0-9]|$)'
    OR p_value ~* '(^|[[:space:]<(])@[[:alnum:]_.\-]{2,}'
    OR p_value ~ '(19|20)[0-9]{2}[[:space:]]*([-./][[:space:]]*(0?[1-9]|1[0-2])[[:space:]]*[-./][[:space:]]*(0?[1-9]|[12][0-9]|3[01])|년[[:space:]]*(0?[1-9]|1[0-2])[[:space:]]*월[[:space:]]*(0?[1-9]|[12][0-9]|3[01])[[:space:]]*일?)'
    OR p_value ~ '(대로|로|길)[[:space:]]*[0-9]{1,5}([[:space:]\-][0-9]{1,5})?'
  )
$$;

CREATE OR REPLACE FUNCTION public.community_decision_payload_digest(
  p_payload jsonb
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public, extensions
AS $$
  SELECT encode(
    extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256'),
    'hex'
  )
$$;

CREATE OR REPLACE FUNCTION public.community_guard_decision_command_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE'
    OR COALESCE(
      current_setting('hanbang.community_decision_command_write', true),
      ''
    ) <> 'on' THEN
    RAISE EXCEPTION 'decision commands require the service command boundary'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_guard_decision_event_append()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND pg_trigger_depth() > 1
    AND OLD.actor_id IS NOT NULL
    AND NEW.actor_id IS NULL
    AND OLD.actor_erased_at IS NULL
    AND NEW.actor_erased_at IS NULL THEN
    NEW.actor_erased_at := clock_timestamp();
    RETURN NEW;
  END IF;

  IF TG_OP <> 'INSERT'
    OR COALESCE(
      current_setting('hanbang.community_decision_event_write', true),
      ''
    ) <> 'on' THEN
    RAISE EXCEPTION 'decision thread events are append-only'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER community_decision_commands_write_boundary
BEFORE INSERT OR UPDATE OR DELETE ON public.community_commands
FOR EACH ROW EXECUTE FUNCTION public.community_guard_decision_command_write();

CREATE TRIGGER community_decision_events_append_only
BEFORE INSERT OR UPDATE OR DELETE ON public.community_decision_thread_events
FOR EACH ROW EXECUTE FUNCTION public.community_guard_decision_event_append();

CREATE OR REPLACE FUNCTION public.community_assert_decision_service()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.community_request_is_service() THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_assert_decision_actor_active(
  p_actor_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_actor_id IS NULL OR EXISTS (
    SELECT 1
    FROM public.community_profiles AS profile
    WHERE profile.user_id = p_actor_id
      AND COALESCE(profile.is_suspended, false)
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_ACTOR_SUSPENDED'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_open_decision_command(
  p_actor_id uuid,
  p_operation text,
  p_idempotency_key uuid,
  p_payload jsonb
)
RETURNS public.community_commands
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_command public.community_commands%ROWTYPE;
  v_payload_hash text := public.community_decision_payload_digest(p_payload);
BEGIN
  PERFORM public.community_assert_decision_service();
  IF p_actor_id IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_COMMAND_INVALID'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM auth.users AS app_user
  WHERE app_user.id = p_actor_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_ACTOR_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT command.* INTO v_command
  FROM public.community_commands AS command
  WHERE command.actor_id = p_actor_id
    AND command.operation = p_operation
    AND command.idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_command.payload_hash <> v_payload_hash
      OR v_command.hash_schema_version <> 1 THEN
      RAISE EXCEPTION 'COMMUNITY_DECISION_IDEMPOTENCY_CONFLICT'
        USING ERRCODE = '23505';
    END IF;
    RETURN v_command;
  END IF;

  IF public.community_runtime_mode() <> 'normal'
    AND p_operation <> 'decision_thread_withdraw' THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_RUNTIME_BLOCKED'
      USING ERRCODE = '55000';
  END IF;

  PERFORM set_config('hanbang.community_decision_command_write', 'on', true);
  INSERT INTO public.community_commands (
    actor_id, operation, idempotency_key, payload_hash
  ) VALUES (
    p_actor_id, p_operation, p_idempotency_key, v_payload_hash
  ) RETURNING * INTO v_command;
  PERFORM set_config('hanbang.community_decision_command_write', 'off', true);
  RETURN v_command;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_complete_decision_command(
  p_command_id uuid,
  p_status text,
  p_result_reference uuid,
  p_safe_error_code text DEFAULT NULL,
  p_result_payload jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM set_config('hanbang.community_decision_command_write', 'on', true);
  UPDATE public.community_commands
  SET status = p_status,
      result_reference = p_result_reference,
      result_payload = p_result_payload,
      safe_error_code = p_safe_error_code,
      updated_at = clock_timestamp()
  WHERE id = p_command_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_COMMAND_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;
  PERFORM set_config('hanbang.community_decision_command_write', 'off', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.community_append_decision_event(
  p_thread_id uuid,
  p_thread_version bigint,
  p_event_type text,
  p_actor_type text,
  p_actor_id uuid,
  p_before_state jsonb,
  p_after_state jsonb,
  p_reason_code text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_event_id uuid;
BEGIN
  PERFORM set_config('hanbang.community_decision_event_write', 'on', true);
  INSERT INTO public.community_decision_thread_events (
    thread_id, thread_version, event_type, actor_type, actor_id,
    before_state, after_state, reason_code
  ) VALUES (
    p_thread_id, p_thread_version, p_event_type, p_actor_type, p_actor_id,
    p_before_state, p_after_state, p_reason_code
  ) RETURNING id INTO v_event_id;
  PERFORM set_config('hanbang.community_decision_event_write', 'off', true);
  RETURN v_event_id;
END;
$$;

-- Author intake may exist before an operator assigns responders. Preserve the
-- 1800 requester binding contract while allowing the first verified operator
-- to claim only the operational `created_by_operator` field. Identity, topic,
-- scope, and idempotency key must already match exactly.
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
  IF p_question_id IS NULL OR p_requester_id IS NULL
    OR p_idempotency_key IS NULL
    OR p_topic <> 'contract_extra_cost'
    OR p_experience_scope NOT IN (
      'contract_terms', 'extra_charge', 'vendor_response',
      'cancellation_refund'
    ) THEN
    RAISE EXCEPTION 'invalid responder question requester binding'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM auth.users AS app_user
  WHERE app_user.id = p_requester_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid responder question requester binding'
      USING ERRCODE = '22023';
  END IF;

  SELECT question.* INTO v_question
  FROM public.community_responder_questions AS question
  WHERE question.id = p_question_id
     OR question.requester_binding_idempotency_key = p_idempotency_key
  ORDER BY (question.id = p_question_id) DESC
  LIMIT 1 FOR UPDATE;

  IF FOUND THEN
    IF v_question.id <> p_question_id
      OR v_question.requester_id IS DISTINCT FROM p_requester_id
      OR v_question.topic <> p_topic
      OR v_question.experience_scope <> p_experience_scope
      OR v_question.requester_binding_idempotency_key
        IS DISTINCT FROM p_idempotency_key
      OR v_question.intake_status <> 'private_waitlist'
      OR (
        v_question.created_by_operator IS NOT NULL
        AND v_question.created_by_operator <> p_operator_id
      ) THEN
      RAISE EXCEPTION 'responder question binding idempotency conflict'
        USING ERRCODE = '23505';
    END IF;
    IF v_question.created_by_operator IS NULL THEN
      UPDATE public.community_responder_questions
      SET created_by_operator = p_operator_id
      WHERE id = p_question_id
      RETURNING * INTO v_question;
    ELSE
      v_replayed := true;
    END IF;
  ELSE
    INSERT INTO public.community_responder_questions (
      id, requester_id, requester_bound_at,
      requester_binding_idempotency_key, topic, experience_scope,
      created_by_operator
    ) VALUES (
      p_question_id, p_requester_id, clock_timestamp(),
      p_idempotency_key, p_topic, p_experience_scope, p_operator_id
    ) RETURNING * INTO v_question;
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

CREATE OR REPLACE FUNCTION public.community_publish_decision_thread(
  p_actor_id uuid,
  p_idempotency_key uuid,
  p_question_id uuid,
  p_title text,
  p_content text,
  p_topic_category text,
  p_experience_scope text,
  p_coarse_region text,
  p_preparation_stage text,
  p_contract_phase text,
  p_desired_answer text,
  p_commercial_relationship text,
  p_sponsorship_detail text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_payload jsonb;
  v_payload_hash text;
  v_command public.community_commands%ROWTYPE;
  v_intake public.community_decision_thread_intakes%ROWTYPE;
  v_question public.community_responder_questions%ROWTYPE;
  v_supply record;
  v_post_id uuid;
  v_thread public.community_decision_threads%ROWTYPE;
  v_profile_update_count integer;
  v_candidate record;
  v_receipt jsonb;
  v_active_thread_count integer;
  v_replayed boolean := false;
BEGIN
  PERFORM public.community_assert_decision_service();
  p_title := btrim(COALESCE(p_title, ''));
  p_content := btrim(COALESCE(p_content, ''));
  p_coarse_region := NULLIF(btrim(COALESCE(p_coarse_region, '')), '');
  p_desired_answer := btrim(COALESCE(p_desired_answer, ''));
  p_sponsorship_detail := NULLIF(
    btrim(COALESCE(p_sponsorship_detail, '')), ''
  );
  IF NOT public.community_decision_public_text_is_safe(p_title)
    OR NOT public.community_decision_public_text_is_safe(p_content)
    OR NOT public.community_decision_public_text_is_safe(p_coarse_region)
    OR NOT public.community_decision_public_text_is_safe(p_desired_answer)
    OR NOT public.community_decision_public_text_is_safe(p_sponsorship_detail)
    THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_PUBLIC_TEXT_BLOCKED'
      USING ERRCODE = '22023';
  END IF;

  v_payload := jsonb_build_object(
    'v', 1, 'question_id', p_question_id, 'title', p_title,
    'content', p_content, 'topic_category', p_topic_category,
    'experience_scope', p_experience_scope,
    'coarse_region', p_coarse_region,
    'preparation_stage', p_preparation_stage,
    'contract_phase', p_contract_phase,
    'desired_answer', p_desired_answer,
    'commercial_relationship', p_commercial_relationship,
    'sponsorship_detail', p_sponsorship_detail,
    'media', jsonb_build_array()
  );
  v_payload_hash := public.community_decision_payload_digest(v_payload);
  v_command := public.community_open_decision_command(
    p_actor_id, 'decision_thread_publish', p_idempotency_key, v_payload
  );
  v_replayed := v_command.status <> 'pending';

  IF v_command.status IN ('succeeded', 'terminal') THEN
    IF v_command.result_payload IS NULL THEN
      RAISE EXCEPTION 'COMMUNITY_DECISION_STATE_UNCONFIRMED'
        USING ERRCODE = '55000';
    END IF;
    RETURN v_command.result_payload;
  END IF;

  IF v_command.status = 'waiting_for_supply'
    AND public.community_runtime_mode() <> 'normal' THEN
    RETURN jsonb_build_object(
      'status', 'private_waitlist', 'question_id', p_question_id,
      'command_id', v_command.id, 'operation_key', p_idempotency_key,
      'replayed', false
    );
  END IF;
  IF public.community_runtime_mode() <> 'normal' THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_RUNTIME_BLOCKED'
      USING ERRCODE = '55000';
  END IF;
  PERFORM public.community_assert_decision_actor_active(p_actor_id);

  IF p_question_id IS NULL OR p_topic_category <> 'contract_extra_cost'
    OR p_experience_scope NOT IN (
      'contract_terms', 'extra_charge', 'vendor_response',
      'cancellation_refund'
    ) OR char_length(p_title) NOT BETWEEN 8 AND 160
    OR char_length(p_content) NOT BETWEEN 20 AND 5000
    OR p_preparation_stage NOT IN (
      'vendor_search', 'contract_review', 'contracted',
      'dispute_or_cancellation'
    ) OR p_contract_phase NOT IN (
      'before_contract', 'after_contract', 'cancellation_or_refund'
    ) OR char_length(p_desired_answer) NOT BETWEEN 5 AND 300
    OR p_commercial_relationship NOT IN (
      'none', 'gift', 'discount', 'refund', 'affiliate', 'paid',
      'employee', 'owner_or_family', 'platform_research_compensation'
    ) OR (
      p_commercial_relationship = 'none'
      AND p_sponsorship_detail IS NOT NULL
    ) OR (
      p_commercial_relationship <> 'none'
      AND COALESCE(char_length(p_sponsorship_detail), 0) NOT BETWEEN 3 AND 500
    ) THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_PUBLICATION_INVALID'
      USING ERRCODE = '22023';
  END IF;

  SELECT intake.* INTO v_intake
  FROM public.community_decision_thread_intakes AS intake
  WHERE intake.question_id = p_question_id FOR UPDATE;
  IF FOUND AND (
    v_intake.author_id <> p_actor_id
    OR v_intake.payload_hash <> v_payload_hash
    OR v_intake.command_id <> v_command.id
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_QUESTION_CONFLICT'
      USING ERRCODE = '23505';
  END IF;

  IF NOT FOUND THEN
    INSERT INTO public.community_decision_thread_intakes (
      question_id, author_id, command_id, payload_hash, title, content,
      topic_category, experience_scope, coarse_region, preparation_stage,
      contract_phase, desired_answer, commercial_relationship,
      sponsorship_detail
    ) VALUES (
      p_question_id, p_actor_id, v_command.id, v_payload_hash, p_title,
      p_content, p_topic_category, p_experience_scope, p_coarse_region,
      p_preparation_stage, p_contract_phase, p_desired_answer,
      p_commercial_relationship, p_sponsorship_detail
    ) RETURNING * INTO v_intake;
  END IF;

  SELECT question.* INTO v_question
  FROM public.community_responder_questions AS question
  WHERE question.id = p_question_id FOR UPDATE;
  IF FOUND THEN
    IF v_question.requester_id IS DISTINCT FROM p_actor_id
      OR v_question.topic <> p_topic_category
      OR v_question.experience_scope <> p_experience_scope
      OR v_question.intake_status <> 'private_waitlist' THEN
      RAISE EXCEPTION 'COMMUNITY_DECISION_SUPPLY_BINDING_CONFLICT'
        USING ERRCODE = '23505';
    END IF;
  ELSE
    INSERT INTO public.community_responder_questions (
      id, topic, experience_scope, requester_id, requester_bound_at,
      requester_binding_idempotency_key
    ) VALUES (
      p_question_id, p_topic_category, p_experience_scope, p_actor_id,
      clock_timestamp(), p_idempotency_key
    ) RETURNING * INTO v_question;
  END IF;

  -- Follow the supply ledger's identity -> slot -> request lock order before
  -- the final readiness read. A revoke/expiry cannot race publication.
  FOR v_candidate IN
    SELECT DISTINCT request.responder_id
    FROM public.community_responder_requests AS request
    WHERE request.question_id = p_question_id
      AND request.status = 'accepted'
    ORDER BY request.responder_id
  LOOP
    PERFORM public.community_lock_responder_identity(v_candidate.responder_id);
  END LOOP;
  PERFORM slot.id FROM public.responder_capacity_slots AS slot
  JOIN public.community_responder_requests AS request
    ON request.capacity_slot_id = slot.id
  WHERE request.question_id = p_question_id
    AND request.status = 'accepted'
  ORDER BY slot.id FOR UPDATE OF slot;
  PERFORM request.id FROM public.community_responder_requests AS request
  WHERE request.question_id = p_question_id
    AND request.status = 'accepted'
  ORDER BY request.id FOR UPDATE;

  SELECT supply.* INTO v_supply
  FROM public.community_responder_question_supply AS supply
  WHERE supply.question_id = p_question_id;
  IF NOT FOUND OR v_supply.question_state <> 'ready_for_review'
    OR v_supply.peer_member_primary_confirmed_count < 1
    OR v_supply.peer_member_backup_confirmed_count < 1 THEN
    PERFORM public.community_complete_decision_command(
      v_command.id, 'waiting_for_supply', p_question_id, 'supply_not_ready'
    );
    RETURN jsonb_build_object(
      'status', 'private_waitlist', 'question_id', p_question_id,
      'command_id', v_command.id, 'operation_key', p_idempotency_key,
      'replayed', false
    );
  END IF;

  -- P0 is a deliberately capped founding beta. One transaction-scoped lock
  -- serializes both mutable capacity gates with the publication insert.
  PERFORM pg_advisory_xact_lock(20260804190000::bigint);

  -- A slot is released only by a terminal lifecycle state (completed/closed)
  -- or the durable publication_state='withdrawn' written by author withdrawal.
  -- Moderation visibility, under_review, source_unavailable, and restoration
  -- do not release capacity. A missing/invalid source counts fail-closed.
  SELECT count(*)::integer INTO v_active_thread_count
  FROM public.community_decision_threads AS thread
  LEFT JOIN public.community_posts AS post ON post.id = thread.post_id
  WHERE thread.state NOT IN ('completed', 'closed')
    AND (
      post.id IS NULL
      OR post.publication_state IS DISTINCT FROM 'withdrawn'
    );
  IF v_active_thread_count >= 20 THEN
    PERFORM public.community_complete_decision_command(
      v_command.id, 'waiting_for_supply', p_question_id,
      'active_thread_capacity_full'
    );
    RETURN jsonb_build_object(
      'status', 'private_waitlist', 'question_id', p_question_id,
      'command_id', v_command.id, 'operation_key', p_idempotency_key,
      'replayed', v_replayed
    );
  END IF;

  -- The active-thread cap does not replace the distinct-author beta boundary.
  IF NOT EXISTS (
    SELECT 1 FROM public.community_decision_beta_members AS member
    WHERE member.author_id = p_actor_id
  ) AND (
    SELECT count(*) FROM public.community_decision_beta_members
  ) >= 20 THEN
    PERFORM public.community_complete_decision_command(
      v_command.id, 'waiting_for_supply', p_question_id, 'beta_capacity_full'
    );
    RETURN jsonb_build_object(
      'status', 'private_waitlist', 'question_id', p_question_id,
      'command_id', v_command.id, 'operation_key', p_idempotency_key,
      'replayed', v_replayed
    );
  END IF;
  INSERT INTO public.community_decision_beta_members(author_id)
  VALUES (p_actor_id) ON CONFLICT (author_id) DO NOTHING;

  -- Bootstrap only a pseudonymous community profile. No private profile or
  -- couple context is copied into the public question.
  INSERT INTO public.community_profiles (
    user_id, nickname, badge, post_count, comment_count,
    total_upvotes_received
  ) VALUES (
    p_actor_id,
    'u-' || right(replace(p_actor_id::text, '-', ''), 16),
    'member', 0, 0, 0
  ) ON CONFLICT (user_id) DO NOTHING;

  SELECT gen_random_uuid() INTO v_post_id;
  INSERT INTO public.community_posts (
    id, author_id, category, title, content, images, visibility,
    author_visibility, tags, ad_disclosure, sponsorship_detail,
    is_resolved, under_review, content_origin, post_format,
    topic_category, publication_state, audience_scope,
    commercial_relationship
  ) VALUES (
    v_post_id, p_actor_id, 'is_normal', p_title, p_content, ARRAY[]::text[],
    'public', 'public', ARRAY[p_topic_category, p_experience_scope],
    CASE WHEN p_commercial_relationship = 'none' THEN 'general'
      ELSE 'sponsored' END,
    p_sponsorship_detail, false, false, 'member',
    'experience_question', p_topic_category, 'published', 'public',
    p_commercial_relationship
  );

  INSERT INTO public.community_decision_threads (
    id, post_id, author_id, topic_category, experience_scope,
    coarse_region, preparation_stage, contract_phase, desired_answer
  ) VALUES (
    p_question_id, v_post_id, p_actor_id, p_topic_category,
    p_experience_scope, p_coarse_region, p_preparation_stage,
    p_contract_phase, p_desired_answer
  ) RETURNING * INTO v_thread;

  PERFORM public.community_append_decision_event(
    v_thread.id, v_thread.version, 'thread_published', 'author', p_actor_id,
    '{}'::jsonb,
    jsonb_build_object(
      'state', v_thread.state, 'peer_answer_count', 0,
      'professional_answer_count', 0, 'publication_state', 'published'
    ),
    'supply_gate_confirmed'
  );
  UPDATE public.community_decision_thread_intakes
  SET status = 'published', published_post_id = v_post_id,
      published_thread_id = v_thread.id, updated_at = clock_timestamp()
  WHERE question_id = p_question_id;
  UPDATE public.community_profiles
  SET post_count = COALESCE(post_count, 0) + 1, updated_at = clock_timestamp()
  WHERE user_id = p_actor_id;
  GET DIAGNOSTICS v_profile_update_count = ROW_COUNT;
  IF v_profile_update_count <> 1 THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_PROFILE_COUNTER_UNCONFIRMED'
      USING ERRCODE = '55000';
  END IF;
  v_receipt := jsonb_build_object(
    'status', 'published', 'question_id', p_question_id,
    'thread_id', v_thread.id, 'post_id', v_thread.post_id,
    'publication_version', 1,
    'current_state', v_thread.state,
    'current_version', v_thread.version,
    'command_id', v_command.id, 'operation_key', p_idempotency_key,
    'replayed', false
  );
  PERFORM public.community_complete_decision_command(
    v_command.id, 'succeeded', v_thread.id, NULL, v_receipt
  );
  RETURN v_receipt;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_recalculate_decision_thread(
  p_thread_id uuid,
  p_actor_type text,
  p_actor_id uuid,
  p_reason_code text
)
RETURNS public.community_decision_threads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, community_private
AS $$
DECLARE
  v_intake public.community_decision_thread_intakes%ROWTYPE;
  v_thread public.community_decision_threads%ROWTYPE;
  v_peer_count integer;
  v_professional_count integer;
  v_post_available boolean;
  v_selected_source_available boolean;
  v_new_state text;
  v_new_source_unavailable_at timestamptz;
  v_new_applications_allowed boolean;
  v_before jsonb;
  v_after jsonb;
  v_event_type text;
BEGIN
  SELECT thread.* INTO v_thread
  FROM public.community_decision_threads AS thread
  WHERE thread.id = p_thread_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_THREAD_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT
    count(*) FILTER (WHERE answer.content_origin = 'member')::integer,
    count(*) FILTER (
      WHERE answer.content_origin = 'industry_professional'
    )::integer
  INTO v_peer_count, v_professional_count
  FROM public.community_decision_answers AS answer
  JOIN public.community_comments AS comment ON comment.id = answer.comment_id
  JOIN public.community_profiles AS profile
    ON profile.user_id = answer.author_id
  WHERE answer.thread_id = p_thread_id
    AND answer.is_qualified
    AND comment.is_deleted = false
    AND COALESCE(profile.is_suspended, false) = false;

  SELECT COALESCE((
    SELECT post.publication_state = 'published'
      AND post.audience_scope = 'public'
      AND post.visibility = 'public'
      AND post.author_visibility = 'public'
      AND COALESCE(post.under_review, false) = false
      AND EXISTS (
        SELECT 1 FROM public.community_profiles AS author_profile
        WHERE author_profile.user_id = post.author_id
          AND COALESCE(author_profile.is_suspended, false) = false
      )
    FROM public.community_posts AS post
    WHERE post.id = v_thread.post_id
  ), false) INTO v_post_available;

  SELECT NOT EXISTS (
    SELECT 1
    FROM public.community_thread_evidence_selections AS selection
    JOIN public.community_decision_answers AS answer
      ON answer.id = selection.answer_id
    LEFT JOIN public.community_comments AS comment
      ON comment.id = answer.comment_id
    LEFT JOIN public.community_profiles AS answer_profile
      ON answer_profile.user_id = answer.author_id
    WHERE selection.thread_id = p_thread_id
      AND selection.included_in_resolution_at IS NOT NULL
      AND (
        comment.id IS NULL OR comment.is_deleted
        OR answer_profile.user_id IS NULL
        OR COALESCE(answer_profile.is_suspended, false)
        OR community_private.users_are_blocked(
          v_thread.author_id,
          answer.author_id
        )
      )
  ) INTO v_selected_source_available;

  v_before := jsonb_build_object(
    'state', v_thread.state,
    'peer_answer_count', v_thread.qualified_peer_answer_count,
    'professional_answer_count', v_thread.qualified_professional_answer_count,
    'source_unavailable_at', v_thread.source_unavailable_at,
    'new_applications_allowed', v_thread.new_applications_allowed
  );
  v_new_state := v_thread.state;
  IF v_thread.state = 'open' AND v_peer_count + v_professional_count > 0 THEN
    v_new_state := 'answered';
    v_event_type := 'qualified_answer_added';
  ELSIF v_thread.state = 'answered'
    AND v_peer_count + v_professional_count = 0 THEN
    v_new_state := 'open';
    v_event_type := 'qualified_answer_withdrawn';
  ELSIF v_peer_count <> v_thread.qualified_peer_answer_count
    OR v_professional_count <> v_thread.qualified_professional_answer_count THEN
    v_event_type := 'qualified_answer_count_changed';
  END IF;

  v_new_source_unavailable_at := v_thread.source_unavailable_at;
  v_new_applications_allowed := v_thread.new_applications_allowed;
  IF NOT v_post_available
    OR (
      v_thread.state IN ('resolved', 'followup_scheduled', 'completed')
      AND NOT v_selected_source_available
    ) THEN
    IF v_thread.source_unavailable_at IS NULL THEN
      v_new_source_unavailable_at := clock_timestamp();
      v_new_applications_allowed := false;
      v_event_type := 'source_unavailable';
    END IF;
  ELSIF v_thread.source_unavailable_at IS NOT NULL
    AND v_post_available
    AND (
      v_thread.state NOT IN ('resolved', 'followup_scheduled', 'completed')
      OR v_selected_source_available
    ) THEN
    v_new_source_unavailable_at := NULL;
    v_new_applications_allowed := true;
    v_event_type := 'source_restored';
  END IF;

  IF v_event_type IS NULL THEN
    RETURN v_thread;
  END IF;

  UPDATE public.community_decision_threads
  SET state = v_new_state,
      version = version + 1,
      qualified_peer_answer_count = v_peer_count,
      qualified_professional_answer_count = v_professional_count,
      source_unavailable_at = v_new_source_unavailable_at,
      new_applications_allowed = v_new_applications_allowed,
      updated_at = clock_timestamp()
  WHERE id = p_thread_id
  RETURNING * INTO v_thread;

  v_after := jsonb_build_object(
    'state', v_thread.state,
    'peer_answer_count', v_thread.qualified_peer_answer_count,
    'professional_answer_count', v_thread.qualified_professional_answer_count,
    'source_unavailable_at', v_thread.source_unavailable_at,
    'new_applications_allowed', v_thread.new_applications_allowed
  );
  PERFORM public.community_append_decision_event(
    v_thread.id, v_thread.version, v_event_type, p_actor_type, p_actor_id,
    v_before, v_after, p_reason_code
  );
  RETURN v_thread;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_create_decision_answer(
  p_actor_id uuid,
  p_thread_id uuid,
  p_idempotency_key uuid,
  p_content text,
  p_response_kind text,
  p_direct_experience boolean,
  p_experience_period text,
  p_experience_stage text,
  p_coarse_region text,
  p_action_taken text,
  p_result_summary text,
  p_next_check text,
  p_fact_opinion_boundary text,
  p_commercial_relationship text,
  p_sponsorship_detail text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, community_private
AS $$
DECLARE
  v_payload jsonb;
  v_command public.community_commands%ROWTYPE;
  v_thread public.community_decision_threads%ROWTYPE;
  v_post public.community_posts%ROWTYPE;
  v_request public.community_responder_requests%ROWTYPE;
  v_comment public.community_comments%ROWTYPE;
  v_answer public.community_decision_answers%ROWTYPE;
  v_receipt jsonb;
  v_replayed boolean := false;
BEGIN
  PERFORM public.community_assert_decision_service();
  p_content := btrim(COALESCE(p_content, ''));
  p_coarse_region := NULLIF(btrim(COALESCE(p_coarse_region, '')), '');
  p_action_taken := NULLIF(btrim(COALESCE(p_action_taken, '')), '');
  p_result_summary := NULLIF(btrim(COALESCE(p_result_summary, '')), '');
  p_next_check := NULLIF(btrim(COALESCE(p_next_check, '')), '');
  p_fact_opinion_boundary := btrim(COALESCE(p_fact_opinion_boundary, ''));
  p_sponsorship_detail := NULLIF(
    btrim(COALESCE(p_sponsorship_detail, '')), ''
  );
  IF NOT public.community_decision_public_text_is_safe(p_content)
    OR NOT public.community_decision_public_text_is_safe(p_coarse_region)
    OR NOT public.community_decision_public_text_is_safe(p_action_taken)
    OR NOT public.community_decision_public_text_is_safe(p_result_summary)
    OR NOT public.community_decision_public_text_is_safe(p_next_check)
    OR NOT public.community_decision_public_text_is_safe(p_fact_opinion_boundary)
    OR NOT public.community_decision_public_text_is_safe(p_sponsorship_detail)
    THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_PUBLIC_TEXT_BLOCKED'
      USING ERRCODE = '22023';
  END IF;
  v_payload := jsonb_build_object(
    'v', 1, 'thread_id', p_thread_id, 'content', p_content,
    'response_kind', p_response_kind,
    'direct_experience', p_direct_experience,
    'experience_period', p_experience_period,
    'experience_stage', p_experience_stage,
    'coarse_region', p_coarse_region, 'action_taken', p_action_taken,
    'result_summary', p_result_summary, 'next_check', p_next_check,
    'fact_opinion_boundary', p_fact_opinion_boundary,
    'commercial_relationship', p_commercial_relationship,
    'sponsorship_detail', p_sponsorship_detail
  );
  v_command := public.community_open_decision_command(
    p_actor_id, 'decision_thread_answer', p_idempotency_key, v_payload
  );
  v_replayed := v_command.status <> 'pending';
  IF v_command.status IN ('succeeded', 'terminal') THEN
    IF v_command.result_payload IS NULL THEN
      RAISE EXCEPTION 'COMMUNITY_DECISION_STATE_UNCONFIRMED'
        USING ERRCODE = '55000';
    END IF;
    RETURN v_command.result_payload;
  END IF;
  IF public.community_runtime_mode() <> 'normal' THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_RUNTIME_BLOCKED'
      USING ERRCODE = '55000';
  END IF;
  PERFORM public.community_assert_decision_actor_active(p_actor_id);

  IF char_length(p_content) NOT BETWEEN 10 AND 5000
    OR p_response_kind NOT IN ('answer', 'experience')
    OR p_direct_experience IS NOT TRUE
    OR p_experience_period NOT IN (
      'within_3_months', 'within_6_months', 'within_12_months',
      'over_12_months'
    ) OR p_experience_stage NOT IN (
      'vendor_search', 'contract_review', 'contracted',
      'dispute_or_cancellation'
    ) OR (p_action_taken IS NULL AND p_result_summary IS NULL
      AND p_next_check IS NULL)
    OR char_length(p_fact_opinion_boundary) NOT BETWEEN 3 AND 500
    OR p_commercial_relationship NOT IN (
      'none', 'gift', 'discount', 'refund', 'affiliate', 'paid',
      'employee', 'owner_or_family', 'platform_research_compensation'
    ) OR (p_commercial_relationship = 'none'
      AND p_sponsorship_detail IS NOT NULL)
    OR (p_commercial_relationship <> 'none'
      AND COALESCE(char_length(p_sponsorship_detail), 0) NOT BETWEEN 3 AND 500)
    THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_ANSWER_RUBRIC_INVALID'
      USING ERRCODE = '22023';
  END IF;

  SELECT thread.* INTO v_thread
  FROM public.community_decision_threads AS thread
  WHERE thread.id = p_thread_id FOR UPDATE;
  IF NOT FOUND OR v_thread.post_id IS NULL THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_THREAD_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_thread.author_id = p_actor_id THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_AUTHOR_CANNOT_QUALIFY_OWN_ANSWER'
      USING ERRCODE = '42501';
  END IF;
  IF v_thread.state NOT IN ('open', 'answered') THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_ANSWER_STATE_CONFLICT'
      USING ERRCODE = '55000';
  END IF;
  IF v_thread.source_unavailable_at IS NOT NULL
    OR NOT v_thread.new_applications_allowed THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_SOURCE_UNAVAILABLE'
      USING ERRCODE = '55000';
  END IF;

  SELECT post.* INTO v_post FROM public.community_posts AS post
  WHERE post.id = v_thread.post_id FOR UPDATE;
  IF v_post.publication_state <> 'published'
    OR v_post.visibility <> 'public'
    OR v_post.author_visibility <> 'public'
    OR v_post.audience_scope <> 'public'
    OR COALESCE(v_post.under_review, false) THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_THREAD_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;
  IF community_private.users_are_blocked(p_actor_id, v_thread.author_id) THEN
    RAISE EXCEPTION 'COMMUNITY_INTERACTION_BLOCKED'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.community_profiles AS responder_profile
    WHERE responder_profile.user_id = p_actor_id
      AND COALESCE(responder_profile.is_suspended, false) = false
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_RESPONDER_UNAVAILABLE'
      USING ERRCODE = '42501';
  END IF;

  SELECT request.* INTO v_request
  FROM public.community_responder_requests AS request
  WHERE request.question_id = p_thread_id
    AND request.responder_id = p_actor_id
    AND request.status = 'accepted'
    AND request.expires_at > clock_timestamp()
    AND request.response_has_conflict IS FALSE
    AND request.responder_origin IN ('member', 'industry_professional')
  ORDER BY request.accepted_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_ACCEPTED_HUMAN_RESPONDER_REQUIRED'
      USING ERRCODE = '42501';
  END IF;
  IF v_request.response_commercial_relationship
      IS DISTINCT FROM p_commercial_relationship THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_RELATIONSHIP_CHANGED'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.community_comments (
    post_id, parent_id, author_id, content, upvote_count, is_deleted,
    content_origin
  ) VALUES (
    v_thread.post_id, NULL, p_actor_id, p_content, 0, false,
    v_request.responder_origin::public.community_content_origin
  ) RETURNING * INTO v_comment;
  INSERT INTO public.community_decision_answers (
    thread_id, comment_id, author_id, responder_request_id, response_kind,
    content_origin, direct_experience, experience_period, experience_stage,
    coarse_region, action_taken, result_summary, next_check,
    fact_opinion_boundary, commercial_relationship, sponsorship_detail
  ) VALUES (
    p_thread_id, v_comment.id, p_actor_id, v_request.id, p_response_kind,
    v_request.responder_origin, true, p_experience_period,
    p_experience_stage, p_coarse_region, p_action_taken, p_result_summary,
    p_next_check, p_fact_opinion_boundary, p_commercial_relationship,
    p_sponsorship_detail
  ) RETURNING * INTO v_answer;

  UPDATE public.community_posts
  SET comment_count = COALESCE(comment_count, 0) + 1
  WHERE id = v_thread.post_id;
  UPDATE public.community_profiles
  SET comment_count = COALESCE(comment_count, 0) + 1,
      updated_at = clock_timestamp()
  WHERE user_id = p_actor_id;
  INSERT INTO public.community_reply_notifications (
    recipient_id, actor_id, post_id, comment_id, parent_comment_id, kind
  ) VALUES (
    v_thread.author_id, p_actor_id, v_thread.post_id, v_comment.id,
    NULL, 'post_reply'
  ) ON CONFLICT (recipient_id, comment_id) DO NOTHING;

  v_thread := public.community_recalculate_decision_thread(
    p_thread_id, 'answerer', p_actor_id, 'qualified_human_answer_created'
  );
  v_receipt := jsonb_build_object(
    'status', 'answered', 'answer_id', v_answer.id,
    'comment_id', v_answer.comment_id, 'thread_id', v_thread.id,
    'state', v_thread.state, 'version', v_thread.version,
    'qualified_peer_answer_count', v_thread.qualified_peer_answer_count,
    'qualified_professional_answer_count',
      v_thread.qualified_professional_answer_count,
    'command_id', v_command.id, 'operation_key', p_idempotency_key,
    'replayed', v_replayed
  );
  PERFORM public.community_complete_decision_command(
    v_command.id, 'succeeded', v_answer.id, NULL, v_receipt
  );
  RETURN v_receipt;
END;
$$;

-- Applicability is an answer-scoped set-intent. It never declares the thread
-- resolved by itself, so an author can compare several answers honestly.
CREATE OR REPLACE FUNCTION public.community_set_decision_applicability(
  p_actor_id uuid,
  p_thread_id uuid,
  p_expected_version bigint,
  p_answer_id uuid,
  p_applicability text,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, community_private
AS $$
DECLARE
  v_payload jsonb;
  v_command public.community_commands%ROWTYPE;
  v_thread public.community_decision_threads%ROWTYPE;
  v_answer public.community_decision_answers%ROWTYPE;
  v_comment public.community_comments%ROWTYPE;
  v_post public.community_posts%ROWTYPE;
  v_selection public.community_thread_evidence_selections%ROWTYPE;
  v_before jsonb;
  v_receipt jsonb;
  v_replayed boolean := false;
BEGIN
  PERFORM public.community_assert_decision_service();
  v_payload := jsonb_build_object(
    'v', 1, 'thread_id', p_thread_id,
    'expected_version', p_expected_version, 'answer_id', p_answer_id,
    'applicability', p_applicability
  );
  v_command := public.community_open_decision_command(
    p_actor_id, 'decision_thread_applicability', p_idempotency_key, v_payload
  );
  v_replayed := v_command.status <> 'pending';
  IF v_command.status IN ('succeeded', 'terminal') THEN
    IF v_command.result_payload IS NULL THEN
      RAISE EXCEPTION 'COMMUNITY_DECISION_STATE_UNCONFIRMED'
        USING ERRCODE = '55000';
    END IF;
    RETURN v_command.result_payload;
  END IF;
  IF public.community_runtime_mode() <> 'normal' THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_RUNTIME_BLOCKED'
      USING ERRCODE = '55000';
  END IF;
  PERFORM public.community_assert_decision_actor_active(p_actor_id);
  IF p_applicability NOT IN (
    'applies', 'conditions_differ', 'need_more_info',
    'taken_as_next_action'
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_APPLICABILITY_INVALID'
      USING ERRCODE = '22023';
  END IF;
  SELECT thread.* INTO v_thread
  FROM public.community_decision_threads AS thread
  WHERE thread.id = p_thread_id FOR UPDATE;
  IF NOT FOUND OR v_thread.author_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_THREAD_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_thread.version <> p_expected_version THEN
    v_receipt := jsonb_build_object(
      'status', 'stale', 'thread_id', v_thread.id,
      'state', v_thread.state, 'current_version', v_thread.version,
      'command_id', v_command.id, 'operation_key', p_idempotency_key,
      'replayed', v_replayed
    );
    PERFORM public.community_complete_decision_command(
      v_command.id, 'terminal', v_thread.id, 'stale_version', v_receipt
    );
    RETURN v_receipt;
  END IF;
  IF v_thread.state <> 'answered'
    OR v_thread.source_unavailable_at IS NOT NULL
    OR NOT v_thread.new_applications_allowed
    OR v_thread.post_id IS NULL THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_APPLICABILITY_STATE_CONFLICT'
      USING ERRCODE = '55000';
  END IF;
  SELECT post.* INTO v_post FROM public.community_posts AS post
  WHERE post.id = v_thread.post_id FOR UPDATE;
  IF NOT FOUND OR v_post.publication_state <> 'published'
    OR v_post.visibility <> 'public' OR v_post.author_visibility <> 'public'
    OR v_post.audience_scope <> 'public'
    OR COALESCE(v_post.under_review, false) THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_SOURCE_UNAVAILABLE'
      USING ERRCODE = '55000';
  END IF;
  SELECT answer.* INTO v_answer
  FROM public.community_decision_answers AS answer
  WHERE answer.id = p_answer_id AND answer.thread_id = p_thread_id
    AND answer.is_qualified FOR UPDATE;
  IF NOT FOUND OR v_answer.comment_id IS NULL
    OR community_private.users_are_blocked(p_actor_id, v_answer.author_id)
    OR NOT EXISTS (
      SELECT 1 FROM public.community_profiles AS answer_profile
      WHERE answer_profile.user_id = v_answer.author_id
        AND COALESCE(answer_profile.is_suspended, false) = false
    ) THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_ANSWER_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;
  SELECT comment.* INTO v_comment FROM public.community_comments AS comment
  WHERE comment.id = v_answer.comment_id AND comment.is_deleted = false
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_ANSWER_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT selection.* INTO v_selection
  FROM public.community_thread_evidence_selections AS selection
  WHERE selection.thread_id = p_thread_id
    AND selection.answer_id = p_answer_id
    AND selection.author_id = p_actor_id
  FOR UPDATE;
  v_before := jsonb_build_object(
    'state', v_thread.state, 'version', v_thread.version,
    'answer_id', p_answer_id,
    'applicability', CASE WHEN FOUND THEN v_selection.applicability ELSE NULL END
  );
  IF FOUND THEN
    UPDATE public.community_thread_evidence_selections
    SET applicability = p_applicability, updated_at = clock_timestamp()
    WHERE id = v_selection.id RETURNING * INTO v_selection;
  ELSE
    INSERT INTO public.community_thread_evidence_selections (
      thread_id, author_id, answer_id, comment_id, applicability
    ) VALUES (
      p_thread_id, p_actor_id, p_answer_id, v_answer.comment_id,
      p_applicability
    ) RETURNING * INTO v_selection;
  END IF;
  UPDATE public.community_decision_threads
  SET version = version + 1, updated_at = clock_timestamp()
  WHERE id = p_thread_id RETURNING * INTO v_thread;
  PERFORM public.community_append_decision_event(
    v_thread.id, v_thread.version, 'applicability_recorded', 'author',
    p_actor_id, v_before,
    jsonb_build_object(
      'state', v_thread.state, 'version', v_thread.version,
      'answer_id', p_answer_id, 'applicability', p_applicability
    ), 'author_set_answer_applicability'
  );
  v_receipt := jsonb_build_object(
    'status', 'applicability_recorded', 'thread_id', v_thread.id,
    'state', v_thread.state, 'version', v_thread.version,
    'selection_id', v_selection.id, 'answer_id', v_selection.answer_id,
    'applicability', v_selection.applicability,
    'command_id', v_command.id, 'operation_key', p_idempotency_key,
    'replayed', v_replayed
  );
  PERFORM public.community_complete_decision_command(
    v_command.id, 'succeeded', v_selection.id, NULL, v_receipt
  );
  RETURN v_receipt;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_finalize_decision_thread_resolution(
  p_actor_id uuid,
  p_thread_id uuid,
  p_expected_version bigint,
  p_answer_ids uuid[],
  p_next_action text,
  p_reason text,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, community_private
AS $$
DECLARE
  v_payload jsonb;
  v_command public.community_commands%ROWTYPE;
  v_thread public.community_decision_threads%ROWTYPE;
  v_post public.community_posts%ROWTYPE;
  v_before jsonb;
  v_valid_count integer;
  v_selection_ids uuid[];
  v_resolution_at timestamptz;
  v_receipt jsonb;
  v_replayed boolean := false;
BEGIN
  PERFORM public.community_assert_decision_service();
  p_next_action := btrim(COALESCE(p_next_action, ''));
  p_reason := btrim(COALESCE(p_reason, ''));
  IF NOT public.community_decision_public_text_is_safe(p_next_action)
    OR NOT public.community_decision_public_text_is_safe(p_reason) THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_PUBLIC_TEXT_BLOCKED'
      USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(
    array_agg(DISTINCT answer_id ORDER BY answer_id), ARRAY[]::uuid[]
  )
  INTO p_answer_ids
  FROM unnest(COALESCE(p_answer_ids, ARRAY[]::uuid[])) AS input(answer_id);
  v_payload := jsonb_build_object(
    'v', 1, 'thread_id', p_thread_id,
    'expected_version', p_expected_version, 'answer_ids', p_answer_ids,
    'next_action', p_next_action, 'reason', p_reason
  );
  v_command := public.community_open_decision_command(
    p_actor_id, 'decision_thread_resolve', p_idempotency_key, v_payload
  );
  v_replayed := v_command.status <> 'pending';
  IF v_command.status IN ('succeeded', 'terminal') THEN
    IF v_command.result_payload IS NULL THEN
      RAISE EXCEPTION 'COMMUNITY_DECISION_STATE_UNCONFIRMED'
        USING ERRCODE = '55000';
    END IF;
    RETURN v_command.result_payload;
  END IF;
  IF public.community_runtime_mode() <> 'normal' THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_RUNTIME_BLOCKED'
      USING ERRCODE = '55000';
  END IF;
  PERFORM public.community_assert_decision_actor_active(p_actor_id);
  IF cardinality(p_answer_ids) NOT BETWEEN 1 AND 10
    OR cardinality(p_answer_ids) <> (
      SELECT count(DISTINCT id)
      FROM unnest(p_answer_ids) AS input(id)
    ) OR char_length(p_next_action) NOT BETWEEN 3 AND 1000
    OR char_length(p_reason) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_RESOLUTION_INVALID'
      USING ERRCODE = '22023';
  END IF;
  SELECT thread.* INTO v_thread
  FROM public.community_decision_threads AS thread
  WHERE thread.id = p_thread_id FOR UPDATE;
  IF NOT FOUND OR v_thread.author_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_THREAD_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_thread.version <> p_expected_version THEN
    v_receipt := jsonb_build_object(
      'status', 'stale', 'thread_id', v_thread.id,
      'state', v_thread.state, 'current_version', v_thread.version,
      'command_id', v_command.id, 'operation_key', p_idempotency_key,
      'replayed', v_replayed
    );
    PERFORM public.community_complete_decision_command(
      v_command.id, 'terminal', v_thread.id, 'stale_version', v_receipt
    );
    RETURN v_receipt;
  END IF;
  IF v_thread.state <> 'answered'
    OR v_thread.source_unavailable_at IS NOT NULL
    OR NOT v_thread.new_applications_allowed
    OR v_thread.post_id IS NULL THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_RESOLVE_STATE_CONFLICT'
      USING ERRCODE = '55000';
  END IF;
  SELECT post.* INTO v_post FROM public.community_posts AS post
  WHERE post.id = v_thread.post_id FOR UPDATE;
  IF NOT FOUND OR v_post.publication_state <> 'published'
    OR v_post.visibility <> 'public' OR v_post.author_visibility <> 'public'
    OR v_post.audience_scope <> 'public'
    OR COALESCE(v_post.under_review, false) THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_SOURCE_UNAVAILABLE'
      USING ERRCODE = '55000';
  END IF;
  SELECT count(*)::integer INTO v_valid_count
  FROM public.community_thread_evidence_selections AS selection
  JOIN public.community_decision_answers AS answer
    ON answer.id = selection.answer_id
  JOIN public.community_comments AS comment
    ON comment.id = answer.comment_id AND comment.is_deleted = false
  WHERE selection.thread_id = p_thread_id
    AND selection.author_id = p_actor_id
    AND selection.answer_id = ANY(p_answer_ids)
    AND answer.is_qualified
    AND NOT community_private.users_are_blocked(p_actor_id, answer.author_id)
    AND EXISTS (
      SELECT 1 FROM public.community_profiles AS answer_profile
      WHERE answer_profile.user_id = answer.author_id
        AND COALESCE(answer_profile.is_suspended, false) = false
    );
  IF v_valid_count <> cardinality(p_answer_ids) THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_SELECTED_SOURCE_UNAVAILABLE'
      USING ERRCODE = '55000';
  END IF;

  v_resolution_at := clock_timestamp();
  UPDATE public.community_thread_evidence_selections
  SET included_in_resolution_at = CASE
        WHEN answer_id = ANY(p_answer_ids) THEN v_resolution_at
        ELSE NULL
      END,
      updated_at = clock_timestamp()
  WHERE thread_id = p_thread_id AND author_id = p_actor_id;
  SELECT COALESCE(array_agg(selection.id ORDER BY selection.id), ARRAY[]::uuid[])
  INTO v_selection_ids
  FROM public.community_thread_evidence_selections AS selection
  WHERE selection.thread_id = p_thread_id
    AND selection.author_id = p_actor_id
    AND selection.included_in_resolution_at = v_resolution_at;
  IF cardinality(v_selection_ids) <> cardinality(p_answer_ids) THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_SELECTION_PERSISTENCE_UNCONFIRMED'
      USING ERRCODE = '55000';
  END IF;

  v_before := jsonb_build_object(
    'state', v_thread.state, 'version', v_thread.version,
    'next_action', v_thread.next_action
  );
  UPDATE public.community_decision_threads
  SET state = 'resolved', version = version + 1,
      resolved_at = v_resolution_at, next_action = p_next_action,
      resolution_reason = p_reason, updated_at = clock_timestamp()
  WHERE id = p_thread_id RETURNING * INTO v_thread;
  PERFORM set_config('hanbang.community_decision_legacy_projection', 'on', true);
  UPDATE public.community_posts SET is_resolved = true
  WHERE id = v_thread.post_id;
  PERFORM set_config('hanbang.community_decision_legacy_projection', 'off', true);
  PERFORM public.community_append_decision_event(
    v_thread.id, v_thread.version, 'thread_resolved', 'author', p_actor_id,
    v_before,
    jsonb_build_object(
      'state', v_thread.state, 'version', v_thread.version,
      'next_action', v_thread.next_action, 'answer_ids', p_answer_ids,
      'selection_ids', v_selection_ids
    ), 'author_finalized_next_action'
  );
  v_receipt := jsonb_build_object(
    'status', 'resolved', 'thread_id', v_thread.id,
    'state', v_thread.state, 'version', v_thread.version,
    'next_action', v_thread.next_action, 'answer_ids', p_answer_ids,
    'selection_ids', v_selection_ids,
    'command_id', v_command.id, 'operation_key', p_idempotency_key,
    'replayed', v_replayed
  );
  PERFORM public.community_complete_decision_command(
    v_command.id, 'succeeded', v_thread.id, NULL, v_receipt
  );
  RETURN v_receipt;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_record_decision_outcome(
  p_actor_id uuid,
  p_thread_id uuid,
  p_expected_version bigint,
  p_current_outcome_id uuid,
  p_action_taken text,
  p_result_summary text,
  p_applicable_conditions text,
  p_public_consent boolean,
  p_commercial_relationship text,
  p_sponsorship_detail text,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_payload jsonb;
  v_command public.community_commands%ROWTYPE;
  v_thread public.community_decision_threads%ROWTYPE;
  v_post public.community_posts%ROWTYPE;
  v_current public.community_decision_outcomes%ROWTYPE;
  v_outcome public.community_decision_outcomes%ROWTYPE;
  v_before jsonb;
  v_receipt jsonb;
  v_replayed boolean := false;
BEGIN
  PERFORM public.community_assert_decision_service();
  p_action_taken := btrim(COALESCE(p_action_taken, ''));
  p_result_summary := btrim(COALESCE(p_result_summary, ''));
  p_applicable_conditions := btrim(COALESCE(p_applicable_conditions, ''));
  p_sponsorship_detail := NULLIF(
    btrim(COALESCE(p_sponsorship_detail, '')), ''
  );
  IF NOT public.community_decision_public_text_is_safe(p_action_taken)
    OR NOT public.community_decision_public_text_is_safe(p_result_summary)
    OR NOT public.community_decision_public_text_is_safe(p_applicable_conditions)
    OR NOT public.community_decision_public_text_is_safe(p_sponsorship_detail)
    THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_PUBLIC_TEXT_BLOCKED'
      USING ERRCODE = '22023';
  END IF;
  v_payload := jsonb_build_object(
    'v', 1, 'thread_id', p_thread_id,
    'expected_version', p_expected_version,
    'current_outcome_id', p_current_outcome_id,
    'action_taken', p_action_taken, 'result_summary', p_result_summary,
    'applicable_conditions', p_applicable_conditions,
    'public_consent', p_public_consent,
    'commercial_relationship', p_commercial_relationship,
    'sponsorship_detail', p_sponsorship_detail
  );
  v_command := public.community_open_decision_command(
    p_actor_id, 'decision_thread_outcome', p_idempotency_key, v_payload
  );
  v_replayed := v_command.status <> 'pending';
  IF v_command.status IN ('succeeded', 'terminal') THEN
    IF v_command.result_payload IS NULL THEN
      RAISE EXCEPTION 'COMMUNITY_DECISION_STATE_UNCONFIRMED'
        USING ERRCODE = '55000';
    END IF;
    RETURN v_command.result_payload;
  END IF;
  IF public.community_runtime_mode() <> 'normal' THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_RUNTIME_BLOCKED'
      USING ERRCODE = '55000';
  END IF;
  PERFORM public.community_assert_decision_actor_active(p_actor_id);
  IF char_length(p_action_taken) NOT BETWEEN 3 AND 2000
    OR char_length(p_result_summary) NOT BETWEEN 3 AND 3000
    OR char_length(p_applicable_conditions) NOT BETWEEN 3 AND 2000
    OR p_public_consent IS NULL
    OR p_commercial_relationship NOT IN (
      'none', 'gift', 'discount', 'refund', 'affiliate', 'paid',
      'employee', 'owner_or_family', 'platform_research_compensation'
    ) OR (p_commercial_relationship = 'none'
      AND p_sponsorship_detail IS NOT NULL)
    OR (p_commercial_relationship <> 'none'
      AND COALESCE(char_length(p_sponsorship_detail), 0) NOT BETWEEN 3 AND 500)
    THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_OUTCOME_INVALID'
      USING ERRCODE = '22023';
  END IF;

  SELECT thread.* INTO v_thread
  FROM public.community_decision_threads AS thread
  WHERE thread.id = p_thread_id FOR UPDATE;
  IF NOT FOUND OR v_thread.author_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_THREAD_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_thread.version <> p_expected_version THEN
    v_receipt := jsonb_build_object(
      'status', 'stale', 'thread_id', v_thread.id,
      'state', v_thread.state, 'current_version', v_thread.version,
      'command_id', v_command.id, 'operation_key', p_idempotency_key,
      'replayed', v_replayed
    );
    PERFORM public.community_complete_decision_command(
      v_command.id, 'terminal', v_thread.id, 'stale_version', v_receipt
    );
    RETURN v_receipt;
  END IF;
  IF v_thread.state NOT IN ('resolved', 'followup_scheduled', 'completed') THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_OUTCOME_STATE_CONFLICT'
      USING ERRCODE = '55000';
  END IF;
  IF p_public_consent THEN
    IF v_thread.post_id IS NULL
      OR v_thread.source_unavailable_at IS NOT NULL
      OR NOT v_thread.new_applications_allowed THEN
      RAISE EXCEPTION 'COMMUNITY_DECISION_PUBLIC_OUTCOME_SOURCE_UNAVAILABLE'
        USING ERRCODE = '55000';
    END IF;
    SELECT post.* INTO v_post FROM public.community_posts AS post
    WHERE post.id = v_thread.post_id FOR UPDATE;
    IF NOT FOUND OR v_post.publication_state <> 'published'
      OR v_post.visibility <> 'public' OR v_post.author_visibility <> 'public'
      OR v_post.audience_scope <> 'public'
      OR COALESCE(v_post.under_review, false)
      OR NOT EXISTS (
        SELECT 1 FROM public.community_profiles AS profile
        WHERE profile.user_id = p_actor_id
          AND COALESCE(profile.is_suspended, false) = false
      ) THEN
      RAISE EXCEPTION 'COMMUNITY_DECISION_PUBLIC_OUTCOME_SOURCE_UNAVAILABLE'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  SELECT outcome.* INTO v_current
  FROM public.community_decision_outcomes AS outcome
  WHERE outcome.thread_id = p_thread_id
  ORDER BY outcome.revision DESC LIMIT 1 FOR UPDATE;
  IF (FOUND AND p_current_outcome_id IS DISTINCT FROM v_current.id)
    OR (NOT FOUND AND p_current_outcome_id IS NOT NULL) THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_OUTCOME_SUPERSEDE_STALE'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.community_decision_outcomes (
    thread_id, author_id, revision, supersedes_outcome_id,
    action_taken, result_summary, applicable_conditions, public_consent,
    commercial_relationship, sponsorship_detail
  ) VALUES (
    p_thread_id, p_actor_id, COALESCE(v_current.revision, 0) + 1,
    v_current.id, p_action_taken, p_result_summary, p_applicable_conditions,
    p_public_consent, p_commercial_relationship, p_sponsorship_detail
  ) RETURNING * INTO v_outcome;

  v_before := jsonb_build_object(
    'state', v_thread.state, 'version', v_thread.version,
    'outcome_revision', COALESCE(v_current.revision, 0)
  );
  UPDATE public.community_decision_threads
  SET state = 'completed', version = version + 1,
      completed_at = COALESCE(completed_at, clock_timestamp()),
      updated_at = clock_timestamp()
  WHERE id = p_thread_id RETURNING * INTO v_thread;
  PERFORM set_config('hanbang.community_decision_legacy_projection', 'on', true);
  UPDATE public.community_posts SET is_resolved = true
  WHERE id = v_thread.post_id;
  PERFORM set_config('hanbang.community_decision_legacy_projection', 'off', true);
  PERFORM public.community_append_decision_event(
    v_thread.id, v_thread.version,
    CASE WHEN v_outcome.revision = 1 THEN 'outcome_recorded'
      ELSE 'outcome_revised' END,
    'author', p_actor_id, v_before,
    jsonb_build_object(
      'state', v_thread.state, 'version', v_thread.version,
      'outcome_revision', v_outcome.revision,
      'public_consent', v_outcome.public_consent
    ),
    CASE WHEN v_outcome.revision = 1 THEN 'author_recorded_outcome'
      ELSE 'author_superseded_outcome' END
  );
  v_receipt := jsonb_build_object(
    'status', 'completed', 'thread_id', v_thread.id,
    'state', v_thread.state, 'version', v_thread.version,
    'outcome_id', v_outcome.id, 'revision', v_outcome.revision,
    'command_id', v_command.id, 'operation_key', p_idempotency_key,
    'replayed', v_replayed
  );
  PERFORM public.community_complete_decision_command(
    v_command.id, 'succeeded', v_outcome.id, NULL, v_receipt
  );
  RETURN v_receipt;
END;
$$;

-- The stable id is the question id, which equals thread id after publication.
-- Self-withdraw remains
-- available in read_only/disabled as a service-authenticated safety action.
CREATE OR REPLACE FUNCTION public.community_withdraw_decision_thread(
  p_actor_id uuid,
  p_thread_id uuid,
  p_expected_version bigint,
  p_reason text,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_payload jsonb;
  v_command public.community_commands%ROWTYPE;
  v_intake public.community_decision_thread_intakes%ROWTYPE;
  v_thread public.community_decision_threads%ROWTYPE;
  v_request public.community_responder_requests%ROWTYPE;
  v_candidate record;
  v_expiry_key uuid;
  v_before jsonb;
  v_receipt jsonb;
  v_replayed boolean := false;
BEGIN
  PERFORM public.community_assert_decision_service();
  PERFORM set_config('app.community_safety_bypass', 'on', true);
  p_reason := btrim(COALESCE(p_reason, ''));
  v_payload := jsonb_build_object(
    'v', 2, 'question_id', p_thread_id,
    'expected_version', p_expected_version, 'reason', p_reason
  );
  v_command := public.community_open_decision_command(
    p_actor_id, 'decision_thread_withdraw', p_idempotency_key, v_payload
  );
  v_replayed := v_command.status <> 'pending';

  SELECT intake.* INTO v_intake
  FROM public.community_decision_thread_intakes AS intake
  WHERE intake.question_id = p_thread_id FOR UPDATE;
  IF NOT FOUND OR v_intake.author_id <> p_actor_id THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_THREAD_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_command.status IN ('succeeded', 'terminal') THEN
    IF v_command.result_payload IS NULL THEN
      RAISE EXCEPTION 'COMMUNITY_DECISION_STATE_UNCONFIRMED'
        USING ERRCODE = '55000';
    END IF;
    PERFORM set_config('app.community_safety_bypass', 'off', true);
    RETURN v_command.result_payload;
  END IF;
  IF char_length(p_reason) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_WITHDRAW_REASON_INVALID'
      USING ERRCODE = '22023';
  END IF;

  IF v_intake.status = 'private_waitlist' THEN
    IF p_expected_version IS NOT NULL THEN
      RAISE EXCEPTION 'COMMUNITY_DECISION_WAITLIST_VERSION_MUST_BE_NULL'
        USING ERRCODE = '22023';
    END IF;
    FOR v_candidate IN
      SELECT request.id, request.responder_id, request.capacity_slot_id
      FROM public.community_responder_requests AS request
      WHERE request.question_id = p_thread_id
        AND request.status IN ('requested', 'accepted')
      ORDER BY request.responder_id, request.capacity_slot_id, request.id
    LOOP
      PERFORM public.community_lock_responder_identity(v_candidate.responder_id);
      PERFORM 1 FROM public.responder_capacity_slots AS slot
      WHERE slot.id = v_candidate.capacity_slot_id FOR UPDATE;
      SELECT request.* INTO v_request
      FROM public.community_responder_requests AS request
      WHERE request.id = v_candidate.id
        AND request.status IN ('requested', 'accepted') FOR UPDATE;
      IF NOT FOUND THEN CONTINUE; END IF;
      v_expiry_key := gen_random_uuid();
      UPDATE public.community_responder_requests
      SET status = 'expired', expiry_idempotency_key = v_expiry_key,
          expiry_reason_code = 'requester_unavailable',
          expired_at = clock_timestamp(), updated_at = clock_timestamp()
      WHERE id = v_request.id;
      -- Accepted capacity is a terminal one-shot. Withdrawing the question
      -- expires the request, but the consumed request UUID remains as its
      -- durable tombstone so this slot can never be silently reused.
      PERFORM public.community_write_responder_supply_event(
        'request_expired', v_request.question_id, v_request.id,
        v_request.capacity_slot_id, 'requester', p_actor_id, v_expiry_key,
        v_request.status, 'expired', 'requester_unavailable',
        COALESCE(v_request.response_commercial_relationship,
          v_request.commercial_relationship_at_request),
        COALESCE(v_request.response_has_conflict,
          v_request.conflict_at_request)
      );
    END LOOP;
    UPDATE public.community_responder_questions
    SET intake_status = 'withdrawn' WHERE id = p_thread_id;
    UPDATE public.community_decision_thread_intakes
    SET status = 'withdrawn', updated_at = clock_timestamp()
    WHERE question_id = p_thread_id;
    v_receipt := jsonb_build_object(
      'status', 'withdrawn', 'question_id', p_thread_id,
      'thread_id', NULL, 'state', NULL, 'version', NULL,
      'source_unavailable_at', NULL,
      'command_id', v_command.id, 'operation_key', p_idempotency_key,
      'replayed', v_replayed
    );
    PERFORM public.community_complete_decision_command(
      v_command.id, 'succeeded', p_thread_id, NULL, v_receipt
    );
    PERFORM set_config('app.community_safety_bypass', 'off', true);
    RETURN v_receipt;
  END IF;

  IF v_intake.status <> 'published' THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_SOURCE_ALREADY_UNAVAILABLE'
      USING ERRCODE = '55000';
  END IF;
  SELECT thread.* INTO v_thread
  FROM public.community_decision_threads AS thread
  WHERE thread.id = p_thread_id FOR UPDATE;
  IF NOT FOUND OR v_thread.author_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_THREAD_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_version IS NULL OR v_thread.version <> p_expected_version THEN
    v_receipt := jsonb_build_object(
      'status', 'stale', 'question_id', p_thread_id,
      'thread_id', v_thread.id, 'state', v_thread.state,
      'current_version', v_thread.version,
      'command_id', v_command.id, 'operation_key', p_idempotency_key,
      'replayed', v_replayed
    );
    PERFORM public.community_complete_decision_command(
      v_command.id, 'terminal', v_thread.id, 'stale_version', v_receipt
    );
    PERFORM set_config('app.community_safety_bypass', 'off', true);
    RETURN v_receipt;
  END IF;
  v_before := jsonb_build_object(
    'state', v_thread.state, 'version', v_thread.version,
    'source_unavailable_at', v_thread.source_unavailable_at
  );
  PERFORM set_config('hanbang.community_decision_source_write', 'on', true);
  UPDATE public.community_posts
  SET publication_state = 'withdrawn', visibility = 'draft'
  WHERE id = v_thread.post_id;
  PERFORM set_config('hanbang.community_decision_source_write', 'off', true);
  UPDATE public.community_decision_threads
  SET version = version + 1,
      source_unavailable_at = COALESCE(source_unavailable_at, clock_timestamp()),
      new_applications_allowed = false, updated_at = clock_timestamp()
  WHERE id = p_thread_id RETURNING * INTO v_thread;
  UPDATE public.community_decision_thread_intakes
  SET status = 'withdrawn', published_post_id = NULL,
      published_thread_id = NULL, updated_at = clock_timestamp()
  WHERE question_id = p_thread_id;
  UPDATE public.community_responder_questions
  SET intake_status = 'withdrawn' WHERE id = p_thread_id;
  PERFORM public.community_append_decision_event(
    v_thread.id, v_thread.version, 'source_withdrawn', 'author', p_actor_id,
    v_before,
    jsonb_build_object(
      'state', v_thread.state, 'version', v_thread.version,
      'source_unavailable_at', v_thread.source_unavailable_at,
      'new_applications_allowed', false
    ), 'author_withdrew_public_source'
  );
  v_receipt := jsonb_build_object(
    'status', 'withdrawn', 'question_id', p_thread_id,
    'thread_id', v_thread.id, 'state', v_thread.state,
    'version', v_thread.version,
    'source_unavailable_at', v_thread.source_unavailable_at,
    'command_id', v_command.id, 'operation_key', p_idempotency_key,
    'replayed', v_replayed
  );
  PERFORM public.community_complete_decision_command(
    v_command.id, 'succeeded', v_thread.id, NULL, v_receipt
  );
  PERFORM set_config('app.community_safety_bypass', 'off', true);
  RETURN v_receipt;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_get_decision_thread(
  p_thread_id uuid,
  p_viewer_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, community_private
AS $$
DECLARE
  v_intake public.community_decision_thread_intakes%ROWTYPE;
  v_thread public.community_decision_threads%ROWTYPE;
  v_post public.community_posts%ROWTYPE;
  v_is_author boolean := false;
  v_publicly_available boolean := false;
  v_author_profile jsonb;
  v_answers jsonb;
  v_selection jsonb := '[]'::jsonb;
  v_outcomes jsonb := '[]'::jsonb;
  v_can_answer boolean := false;
  v_visible_peer_count integer := 0;
  v_visible_professional_count integer := 0;
BEGIN
  PERFORM public.community_assert_decision_service();
  IF p_thread_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT thread.* INTO v_thread
  FROM public.community_decision_threads AS thread
  WHERE thread.id = p_thread_id;
  IF NOT FOUND THEN
    SELECT intake.* INTO v_intake
    FROM public.community_decision_thread_intakes AS intake
    WHERE intake.question_id = p_thread_id
      AND intake.status = 'private_waitlist'
      AND intake.author_id = p_viewer_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    RETURN jsonb_build_object(
      'status', 'private_waitlist',
      'intake', jsonb_build_object(
        'questionId', v_intake.question_id,
        'title', v_intake.title,
        'content', v_intake.content,
        'topicCategory', v_intake.topic_category,
        'experienceScope', v_intake.experience_scope,
        'coarseRegion', v_intake.coarse_region,
        'preparationStage', v_intake.preparation_stage,
        'contractPhase', v_intake.contract_phase,
        'desiredAnswer', v_intake.desired_answer,
        'commercialRelationship', v_intake.commercial_relationship,
        'sponsorshipDetail', v_intake.sponsorship_detail,
        'createdAt', v_intake.created_at
      ),
      'thread', NULL, 'post', NULL, 'answers', jsonb_build_array(),
      'viewer', jsonb_build_object(
        'isAuthor', true, 'canAnswer', false, 'canResolve', false,
        'canRecordOutcome', false, 'canWithdraw', true,
        'selection', jsonb_build_array(), 'outcomes', jsonb_build_array()
      )
    );
  END IF;
  v_is_author := p_viewer_id IS NOT NULL
    AND v_thread.author_id IS NOT DISTINCT FROM p_viewer_id;

  SELECT intake.* INTO v_intake
  FROM public.community_decision_thread_intakes AS intake
  WHERE intake.question_id = p_thread_id;

  IF v_thread.post_id IS NOT NULL THEN
    SELECT post.* INTO v_post
    FROM public.community_posts AS post WHERE post.id = v_thread.post_id;
    v_publicly_available := FOUND
      AND v_post.publication_state = 'published'
      AND v_post.audience_scope = 'public'
      AND v_post.visibility = 'public'
      AND v_post.author_visibility = 'public'
      AND COALESCE(v_post.under_review, false) = false
      AND public.community_runtime_mode() <> 'disabled';
  END IF;
  SELECT jsonb_build_object(
    'nickname', profile.nickname,
    'badge', profile.badge
  ) INTO v_author_profile
  FROM public.community_profiles AS profile
  WHERE profile.user_id = v_thread.author_id
    AND COALESCE(profile.is_suspended, false) = false;

  IF NOT v_is_author
    AND (NOT v_publicly_available OR v_author_profile IS NULL) THEN
    RETURN NULL;
  END IF;
  IF p_viewer_id IS NOT NULL AND NOT v_is_author
    AND community_private.users_are_blocked(p_viewer_id, v_thread.author_id)
    THEN RETURN NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', answer.id,
    'commentId', comment.id,
    'content', comment.content,
    'responseKind', answer.response_kind,
    'contentOrigin', answer.content_origin,
    'directExperience', answer.direct_experience,
    'experiencePeriod', answer.experience_period,
    'experienceStage', answer.experience_stage,
    'coarseRegion', answer.coarse_region,
    'actionTaken', answer.action_taken,
    'resultSummary', answer.result_summary,
    'nextCheck', answer.next_check,
    'factOpinionBoundary', answer.fact_opinion_boundary,
    'commercialRelationship', answer.commercial_relationship,
    'sponsorshipDetail', answer.sponsorship_detail,
    'rubricVersion', answer.rubric_version,
    'author', jsonb_build_object(
      'nickname', profile.nickname,
      'badge', profile.badge
    ),
    'createdAt', answer.created_at
  ) ORDER BY answer.created_at, answer.id), '[]'::jsonb)
  INTO v_answers
  FROM public.community_decision_answers AS answer
  JOIN public.community_comments AS comment ON comment.id = answer.comment_id
  LEFT JOIN public.community_profiles AS profile
    ON profile.user_id = answer.author_id
  WHERE answer.thread_id = p_thread_id
    AND answer.is_qualified
    AND comment.is_deleted = false
    AND profile.user_id IS NOT NULL
    AND COALESCE(profile.is_suspended, false) = false
    AND (
      p_viewer_id IS NULL
      OR answer.author_id = p_viewer_id
      OR NOT community_private.users_are_blocked(p_viewer_id, answer.author_id)
    );

  SELECT
    count(*) FILTER (WHERE answer.content_origin = 'member')::integer,
    count(*) FILTER (
      WHERE answer.content_origin = 'industry_professional'
    )::integer
  INTO v_visible_peer_count, v_visible_professional_count
  FROM public.community_decision_answers AS answer
  JOIN public.community_comments AS comment ON comment.id = answer.comment_id
  LEFT JOIN public.community_profiles AS profile
    ON profile.user_id = answer.author_id
  WHERE answer.thread_id = p_thread_id
    AND answer.is_qualified
    AND comment.is_deleted = false
    AND profile.user_id IS NOT NULL
    AND COALESCE(profile.is_suspended, false) = false
    AND (
      p_viewer_id IS NULL
      OR answer.author_id = p_viewer_id
      OR NOT community_private.users_are_blocked(p_viewer_id, answer.author_id)
    );

  IF v_is_author THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', selection.id,
      'answerId', selection.answer_id,
      'commentId', selection.comment_id,
      'applicability', selection.applicability,
      'selectedAt', selection.selected_at,
      'includedInResolutionAt', selection.included_in_resolution_at
    ) ORDER BY selection.selected_at), '[]'::jsonb)
    INTO v_selection
    FROM public.community_thread_evidence_selections AS selection
    JOIN public.community_decision_answers AS selected_answer
      ON selected_answer.id = selection.answer_id
    JOIN public.community_comments AS selected_comment
      ON selected_comment.id = selection.comment_id
      AND selected_comment.is_deleted = false
    JOIN public.community_profiles AS selected_profile
      ON selected_profile.user_id = selected_answer.author_id
      AND COALESCE(selected_profile.is_suspended, false) = false
    WHERE selection.thread_id = p_thread_id
      AND selection.author_id = p_viewer_id
      AND NOT community_private.users_are_blocked(
        p_viewer_id, selected_answer.author_id
      );

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', outcome.id,
      'revision', outcome.revision,
      'supersedesOutcomeId', outcome.supersedes_outcome_id,
      'actionTaken', outcome.action_taken,
      'resultSummary', outcome.result_summary,
      'applicableConditions', outcome.applicable_conditions,
      'publicConsent', outcome.public_consent,
      'commercialRelationship', outcome.commercial_relationship,
      'sponsorshipDetail', outcome.sponsorship_detail,
      'createdAt', outcome.created_at
    ) ORDER BY outcome.revision), '[]'::jsonb)
    INTO v_outcomes
    FROM public.community_decision_outcomes AS outcome
    WHERE outcome.thread_id = p_thread_id
      AND outcome.author_id = p_viewer_id;
  END IF;

  IF p_viewer_id IS NOT NULL AND NOT v_is_author
    AND v_thread.state IN ('open', 'answered')
    AND v_publicly_available
    AND v_thread.source_unavailable_at IS NULL
    AND v_thread.new_applications_allowed THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.community_responder_requests AS request
      WHERE request.question_id = p_thread_id
        AND request.responder_id = p_viewer_id
        AND request.status = 'accepted'
        AND request.expires_at > clock_timestamp()
        AND request.response_has_conflict IS FALSE
        AND EXISTS (
          SELECT 1 FROM public.community_profiles AS viewer_profile
          WHERE viewer_profile.user_id = p_viewer_id
            AND COALESCE(viewer_profile.is_suspended, false) = false
        )
    ) INTO v_can_answer;
  END IF;

  RETURN jsonb_build_object(
    'thread', jsonb_build_object(
      'id', v_thread.id,
      'postId', v_thread.post_id,
      'state', v_thread.state,
      'version', v_thread.version,
      'kind', v_thread.kind,
      'topicCategory', v_thread.topic_category,
      'experienceScope', v_thread.experience_scope,
      'coarseRegion', v_thread.coarse_region,
      'preparationStage', v_thread.preparation_stage,
      'contractPhase', v_thread.contract_phase,
      'desiredAnswer', v_thread.desired_answer,
      'qualifiedPeerAnswerCount', v_visible_peer_count,
      'qualifiedProfessionalAnswerCount',
        v_visible_professional_count,
      'nextAction', v_thread.next_action,
      'resolvedAt', v_thread.resolved_at,
      'completedAt', v_thread.completed_at,
      'sourceUnavailableAt', v_thread.source_unavailable_at,
      'newApplicationsAllowed', v_thread.new_applications_allowed,
      'createdAt', v_thread.created_at
    ),
    'post', CASE WHEN v_post.id IS NULL THEN NULL ELSE jsonb_build_object(
      'title', v_post.title,
      'content', v_post.content,
      'contentOrigin', v_post.content_origin,
      'commercialRelationship', v_post.commercial_relationship,
      'sponsorshipDetail', v_post.sponsorship_detail,
      'publicationState', v_post.publication_state,
      'author', v_author_profile,
      'createdAt', v_post.created_at
    ) END,
    'answers', v_answers,
    'viewer', jsonb_build_object(
      'isAuthor', v_is_author,
      'canAnswer', v_can_answer,
      'canResolve', v_is_author AND v_thread.state = 'answered'
        AND v_thread.source_unavailable_at IS NULL
        AND v_thread.new_applications_allowed
        AND v_visible_peer_count + v_visible_professional_count > 0,
      'canRecordOutcome', v_is_author
        AND v_thread.state IN ('resolved', 'followup_scheduled', 'completed')
        AND v_thread.source_unavailable_at IS NULL
        AND v_thread.new_applications_allowed,
      'canWithdraw', COALESCE(
        v_is_author AND v_intake.status = 'published', false
      ),
      'selection', v_selection,
      'outcomes', v_outcomes
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.community_guard_decision_legacy_projection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.is_resolved IS DISTINCT FROM OLD.is_resolved
    AND EXISTS (
      SELECT 1 FROM public.community_decision_threads AS thread
      WHERE thread.post_id = OLD.id
    )
    AND COALESCE(
      current_setting('hanbang.community_decision_legacy_projection', true),
      ''
    ) <> 'on' THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_USE_THREAD_LIFECYCLE'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_guard_decision_source_content()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.community_decision_threads AS thread
    WHERE thread.post_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_PUBLIC_SOURCE_IS_IMMUTABLE'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_guard_decision_answer_content()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.community_decision_answers AS answer
    WHERE answer.comment_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_ANSWER_SOURCE_IS_IMMUTABLE'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_recalculate_post_source_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_thread_id uuid;
BEGIN
  IF COALESCE(
    current_setting('hanbang.community_decision_source_write', true), ''
  ) = 'on' THEN RETURN NEW; END IF;
  SELECT thread.id INTO v_thread_id
  FROM public.community_decision_threads AS thread
  WHERE thread.post_id = NEW.id;
  IF v_thread_id IS NOT NULL THEN
    PERFORM public.community_recalculate_decision_thread(
      v_thread_id, 'service', NULL, 'post_source_visibility_changed'
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_mark_deleted_post_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_thread public.community_decision_threads%ROWTYPE;
  v_before jsonb;
BEGIN
  SELECT thread.* INTO v_thread
  FROM public.community_decision_threads AS thread
  WHERE thread.post_id = OLD.id FOR UPDATE;
  IF FOUND AND v_thread.source_unavailable_at IS NULL THEN
    v_before := jsonb_build_object(
      'state', v_thread.state, 'version', v_thread.version,
      'source_unavailable_at', v_thread.source_unavailable_at
    );
    UPDATE public.community_decision_threads
    SET version = version + 1, source_unavailable_at = clock_timestamp(),
        new_applications_allowed = false, updated_at = clock_timestamp()
    WHERE id = v_thread.id RETURNING * INTO v_thread;
    PERFORM public.community_append_decision_event(
      v_thread.id, v_thread.version, 'source_unavailable', 'service', NULL,
      v_before,
      jsonb_build_object(
        'state', v_thread.state, 'version', v_thread.version,
        'source_unavailable_at', v_thread.source_unavailable_at,
        'new_applications_allowed', false
      ), 'post_source_deleted'
    );
  END IF;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_recalculate_answer_source_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_thread_id uuid;
BEGIN
  SELECT answer.thread_id INTO v_thread_id
  FROM public.community_decision_answers AS answer
  WHERE answer.comment_id = NEW.id;
  IF v_thread_id IS NOT NULL THEN
    PERFORM public.community_recalculate_decision_thread(
      v_thread_id, 'service', NULL, 'answer_source_visibility_changed'
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_detach_deleted_answer_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_thread_id uuid;
BEGIN
  UPDATE public.community_decision_answers
  SET comment_id = NULL
  WHERE comment_id = OLD.id
  RETURNING thread_id INTO v_thread_id;
  IF v_thread_id IS NOT NULL THEN
    PERFORM public.community_recalculate_decision_thread(
      v_thread_id, 'service', NULL, 'answer_source_deleted'
    );
  END IF;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_recalculate_profile_sources_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_thread_id uuid;
BEGIN
  IF NEW.is_suspended IS NOT DISTINCT FROM OLD.is_suspended THEN
    RETURN NEW;
  END IF;
  FOR v_thread_id IN
    SELECT thread.id
    FROM public.community_decision_threads AS thread
    WHERE thread.author_id = NEW.user_id
    UNION
    SELECT answer.thread_id
    FROM public.community_decision_answers AS answer
    WHERE answer.author_id = NEW.user_id
  LOOP
    PERFORM public.community_recalculate_decision_thread(
      v_thread_id, 'service', NULL, 'profile_visibility_changed'
    );
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_recalculate_blocked_decision_sources_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_left_user_id uuid := COALESCE(NEW.blocker_user_id, OLD.blocker_user_id);
  v_right_user_id uuid := COALESCE(NEW.blocked_user_id, OLD.blocked_user_id);
  v_thread_id uuid;
BEGIN
  PERFORM set_config('app.community_safety_bypass', 'on', true);
  FOR v_thread_id IN
    SELECT DISTINCT selection.thread_id
    FROM public.community_thread_evidence_selections AS selection
    JOIN public.community_decision_threads AS thread
      ON thread.id = selection.thread_id
    JOIN public.community_decision_answers AS answer
      ON answer.id = selection.answer_id
    WHERE selection.included_in_resolution_at IS NOT NULL
      AND (
        (thread.author_id = v_left_user_id
          AND answer.author_id = v_right_user_id)
        OR (thread.author_id = v_right_user_id
          AND answer.author_id = v_left_user_id)
      )
  LOOP
    PERFORM public.community_recalculate_decision_thread(
      v_thread_id, 'service', NULL, 'selected_source_block_changed'
    );
  END LOOP;
  PERFORM set_config('app.community_safety_bypass', 'off', true);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.community_safety_bypass', 'off', true);
  RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_recalculate_erased_decision_actor_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_thread_id uuid;
BEGIN
  IF OLD.author_id IS NULL OR NEW.author_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  v_thread_id := CASE
    WHEN TG_TABLE_NAME = 'community_decision_threads'
      THEN (to_jsonb(NEW) ->> 'id')::uuid
    ELSE (to_jsonb(NEW) ->> 'thread_id')::uuid
  END;
  PERFORM set_config('app.community_safety_bypass', 'on', true);
  PERFORM public.community_recalculate_decision_thread(
    v_thread_id, 'service', NULL, 'decision_actor_erased'
  );
  PERFORM set_config('app.community_safety_bypass', 'off', true);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.community_safety_bypass', 'off', true);
  RAISE;
END;
$$;

CREATE TRIGGER community_decision_legacy_projection_boundary
BEFORE UPDATE OF is_resolved ON public.community_posts
FOR EACH ROW EXECUTE FUNCTION public.community_guard_decision_legacy_projection();
CREATE TRIGGER community_decision_post_content_boundary
BEFORE UPDATE OF
  title, content, images, post_format, topic_category, audience_scope,
  commercial_relationship, sponsorship_detail
ON public.community_posts
FOR EACH ROW EXECUTE FUNCTION public.community_guard_decision_source_content();
CREATE TRIGGER community_decision_answer_content_boundary
BEFORE UPDATE OF post_id, parent_id, author_id, content, content_origin
ON public.community_comments
FOR EACH ROW EXECUTE FUNCTION public.community_guard_decision_answer_content();
CREATE TRIGGER community_decision_post_source_update
AFTER UPDATE OF visibility, author_visibility, under_review, publication_state
ON public.community_posts
FOR EACH ROW EXECUTE FUNCTION public.community_recalculate_post_source_trigger();
CREATE TRIGGER community_decision_post_source_delete
BEFORE DELETE ON public.community_posts
FOR EACH ROW EXECUTE FUNCTION public.community_mark_deleted_post_source();
CREATE TRIGGER community_decision_answer_source_update
AFTER UPDATE OF is_deleted ON public.community_comments
FOR EACH ROW EXECUTE FUNCTION public.community_recalculate_answer_source_trigger();
CREATE TRIGGER community_decision_answer_source_delete
BEFORE DELETE ON public.community_comments
FOR EACH ROW EXECUTE FUNCTION public.community_detach_deleted_answer_source();
CREATE TRIGGER community_decision_profile_source_update
AFTER UPDATE OF is_suspended ON public.community_profiles
FOR EACH ROW
EXECUTE FUNCTION public.community_recalculate_profile_sources_trigger();
CREATE TRIGGER community_decision_selected_source_block_change
AFTER INSERT OR UPDATE OF revoked_at OR DELETE
ON public.community_viewer_controls
FOR EACH ROW
EXECUTE FUNCTION public.community_recalculate_blocked_decision_sources_trigger();
CREATE TRIGGER community_decision_thread_author_erased
AFTER UPDATE OF author_id ON public.community_decision_threads
FOR EACH ROW
EXECUTE FUNCTION public.community_recalculate_erased_decision_actor_trigger();
CREATE TRIGGER community_decision_answer_author_erased
AFTER UPDATE OF author_id ON public.community_decision_answers
FOR EACH ROW
EXECUTE FUNCTION public.community_recalculate_erased_decision_actor_trigger();

DO $$
DECLARE
  v_table_name text;
BEGIN
  FOREACH v_table_name IN ARRAY ARRAY[
    'community_commands',
    'community_decision_beta_members',
    'community_decision_thread_intakes',
    'community_decision_threads',
    'community_decision_thread_events',
    'community_decision_answers',
    'community_thread_evidence_selections',
    'community_decision_outcomes'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER community_runtime_write_fence '
      || 'BEFORE INSERT OR UPDATE OR DELETE ON public.%I '
      || 'FOR EACH ROW EXECUTE FUNCTION public.community_guard_runtime_write()',
      v_table_name
    );
  END LOOP;
END
$$;

REVOKE ALL ON FUNCTION public.community_decision_payload_digest(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_decision_public_text_is_safe(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_guard_decision_command_write()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_guard_decision_event_append()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_assert_decision_service()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_assert_decision_actor_active(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_open_decision_command(
  uuid, text, uuid, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_complete_decision_command(
  uuid, text, uuid, text, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_append_decision_event(
  uuid, bigint, text, text, uuid, jsonb, jsonb, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_recalculate_decision_thread(
  uuid, text, uuid, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_guard_decision_legacy_projection()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_guard_decision_source_content()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_guard_decision_answer_content()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_recalculate_post_source_trigger()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_mark_deleted_post_source()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_recalculate_answer_source_trigger()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_detach_deleted_answer_source()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_recalculate_profile_sources_trigger()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_recalculate_blocked_decision_sources_trigger()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_recalculate_erased_decision_actor_trigger()
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.community_bind_responder_question_requester(
  uuid, uuid, text, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_bind_responder_question_requester(
  uuid, uuid, text, text, uuid, uuid
) TO service_role;

REVOKE ALL ON FUNCTION public.community_publish_decision_thread(
  uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_publish_decision_thread(
  uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, text
) TO service_role;

REVOKE ALL ON FUNCTION public.community_create_decision_answer(
  uuid, uuid, uuid, text, text, boolean, text, text, text, text, text,
  text, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_create_decision_answer(
  uuid, uuid, uuid, text, text, boolean, text, text, text, text, text,
  text, text, text, text
) TO service_role;

REVOKE ALL ON FUNCTION public.community_set_decision_applicability(
  uuid, uuid, bigint, uuid, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_set_decision_applicability(
  uuid, uuid, bigint, uuid, text, uuid
) TO service_role;

REVOKE ALL ON FUNCTION public.community_finalize_decision_thread_resolution(
  uuid, uuid, bigint, uuid[], text, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_finalize_decision_thread_resolution(
  uuid, uuid, bigint, uuid[], text, text, uuid
) TO service_role;

REVOKE ALL ON FUNCTION public.community_record_decision_outcome(
  uuid, uuid, bigint, uuid, text, text, text, boolean, text, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_record_decision_outcome(
  uuid, uuid, bigint, uuid, text, text, text, boolean, text, text, uuid
) TO service_role;

REVOKE ALL ON FUNCTION public.community_withdraw_decision_thread(
  uuid, uuid, bigint, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_withdraw_decision_thread(
  uuid, uuid, bigint, text, uuid
) TO service_role;

REVOKE ALL ON FUNCTION public.community_get_decision_thread(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_get_decision_thread(uuid, uuid)
  TO service_role;

COMMENT ON TABLE public.community_decision_thread_intakes IS
  'Private text-only P0 intake. Contains no couple id, exact date, address, private budget, partner conversation, or media.';
COMMENT ON TABLE public.community_decision_threads IS
  'Decision lifecycle projection, separate from publication, moderation, audience, and legacy is_resolved.';
COMMENT ON TABLE public.community_decision_answers IS
  'Structured human rubric projection. Only accepted member/industry responder requests can create rows; AI/operator/vendor responses never count.';
COMMENT ON FUNCTION public.community_publish_decision_thread(
  uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, text
) IS
  'Author-owned idempotent publication command. Returns private_waitlist until distinct accepted peer primary and backup capacity is locked and rechecked.';

COMMIT;
