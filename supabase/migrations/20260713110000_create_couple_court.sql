BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- Couple Court is deliberately isolated from couple-wide authorization.
-- A court case can remain private to one member of an otherwise-linked couple;
-- every private read is therefore participant-based, never couple_id-based.

CREATE OR REPLACE FUNCTION public.court_safety_categories_are_valid(
  p_categories text[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT p_categories IS NOT NULL
    AND pg_catalog.cardinality(p_categories) <= 12
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.unnest(p_categories) AS category(value)
      WHERE category.value IS NULL OR category.value NOT IN (
        'self_harm', 'violence', 'threat', 'coercive_control',
        'confinement', 'stalking', 'sexual_coercion', 'financial_control',
        'harm_to_others', 'minor', 'immediate_danger'
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.court_event_metadata_is_safe(
  p_metadata jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT pg_catalog.jsonb_typeof(COALESCE(p_metadata, '{}'::jsonb)) = 'object'
    AND pg_catalog.octet_length(COALESCE(p_metadata, '{}'::jsonb)::text) <= 2048
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_object_keys(COALESCE(p_metadata, '{}'::jsonb)) AS key(value)
      WHERE key.value NOT IN (
        'mode', 'category', 'tone', 'from_status', 'to_status', 'revision',
        'role', 'reason_code', 'safety_level', 'safety_categories',
        'mission_count', 'snapshot_version', 'consent', 'choice', 'status'
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_each(COALESCE(p_metadata, '{}'::jsonb)) AS entry(key, value)
      WHERE CASE
        WHEN entry.key = 'safety_categories' THEN CASE
          WHEN pg_catalog.jsonb_typeof(entry.value) IS DISTINCT FROM 'array' THEN true
          ELSE pg_catalog.jsonb_array_length(entry.value) > 12
            OR EXISTS (
              SELECT 1
              FROM pg_catalog.jsonb_array_elements(entry.value) AS category(value)
              WHERE pg_catalog.jsonb_typeof(category.value) IS DISTINCT FROM 'string'
                OR category.value #>> '{}' NOT IN (
                  'self_harm', 'violence', 'threat', 'coercive_control',
                  'confinement', 'stalking', 'sexual_coercion', 'financial_control',
                  'harm_to_others', 'minor', 'immediate_danger'
                )
            )
          END
        WHEN entry.key IN ('revision', 'mission_count', 'snapshot_version') THEN
          pg_catalog.jsonb_typeof(entry.value) IS DISTINCT FROM 'number'
            OR entry.value #>> '{}' !~ '^[0-9]{1,6}$'
        WHEN entry.key = 'consent' THEN
          pg_catalog.jsonb_typeof(entry.value) IS DISTINCT FROM 'boolean'
        WHEN entry.key = 'reason_code'
          AND pg_catalog.jsonb_typeof(entry.value) = 'null' THEN false
        ELSE
          pg_catalog.jsonb_typeof(entry.value) IS DISTINCT FROM 'string'
            OR pg_catalog.char_length(entry.value #>> '{}') NOT BETWEEN 1 AND 64
      END
    );
$$;

CREATE OR REPLACE FUNCTION public.court_verdict_result_is_valid(
  p_result jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT p_result IS NOT NULL
    AND pg_catalog.jsonb_typeof(p_result) = 'object'
    AND pg_catalog.octet_length(p_result::text) <= 65536
    AND p_result ?& ARRAY[
      'schemaVersion', 'safety', 'caseMeta', 'caseSummary', 'sharedFacts',
      'differentViews', 'applicantNeeds', 'partnerNeeds', 'coreConflict',
      'responsibility', 'verdict', 'conversationScript', 'missions',
      'checkIn', 'confidence', 'limitations', 'publicCard'
    ]
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_object_keys(p_result) AS key(value)
      WHERE key.value NOT IN (
        'schemaVersion', 'safety', 'caseMeta', 'caseSummary', 'sharedFacts',
        'differentViews', 'applicantNeeds', 'partnerNeeds', 'coreConflict',
        'responsibility', 'verdict', 'conversationScript', 'missions',
        'checkIn', 'confidence', 'limitations', 'publicCard'
      )
    )
    AND p_result ->> 'schemaVersion' = '1.0';
$$;

CREATE OR REPLACE FUNCTION public.court_public_snapshot_is_valid(
  p_snapshot jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT p_snapshot IS NOT NULL
    AND pg_catalog.jsonb_typeof(p_snapshot) = 'object'
    AND pg_catalog.octet_length(p_snapshot::text) <= 32768
    AND p_snapshot ?& ARRAY[
      'snapshotVersion', 'category', 'tone', 'mode', 'provisional', 'safeTitle',
      'oneLine', 'resultLabel', 'hashtags'
    ]
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_object_keys(p_snapshot) AS key(value)
      WHERE key.value NOT IN (
        'snapshotVersion', 'category', 'tone', 'mode', 'provisional', 'safeTitle',
        'oneLine', 'resultLabel', 'hashtags'
      )
    )
    AND pg_catalog.jsonb_typeof(p_snapshot -> 'snapshotVersion') = 'string'
    AND p_snapshot ->> 'snapshotVersion' = '1.0'
    AND pg_catalog.jsonb_typeof(p_snapshot -> 'category') = 'string'
    AND (p_snapshot ->> 'category') IN (
      'budget', 'planning_roles', 'venue', 'studio_dress_makeup',
      'family', 'guests_invitations', 'honeymoon', 'home_setup',
      'communication', 'formalwear_shooting', 'ceremony_events', 'other'
    )
    AND pg_catalog.jsonb_typeof(p_snapshot -> 'tone') = 'string'
    AND (p_snapshot ->> 'tone') IN ('gentle', 'practical', 'spicy')
    AND pg_catalog.jsonb_typeof(p_snapshot -> 'mode') = 'string'
    AND (p_snapshot ->> 'mode') IN ('solo', 'couple')
    AND pg_catalog.jsonb_typeof(p_snapshot -> 'provisional') = 'boolean'
    AND pg_catalog.jsonb_typeof(p_snapshot -> 'safeTitle') = 'string'
    AND pg_catalog.char_length(p_snapshot ->> 'safeTitle') BETWEEN 1 AND 80
    AND pg_catalog.jsonb_typeof(p_snapshot -> 'oneLine') = 'string'
    AND pg_catalog.char_length(p_snapshot ->> 'oneLine') BETWEEN 1 AND 180
    AND pg_catalog.jsonb_typeof(p_snapshot -> 'resultLabel') = 'string'
    AND pg_catalog.char_length(p_snapshot ->> 'resultLabel') BETWEEN 1 AND 60
    AND pg_catalog.jsonb_typeof(p_snapshot -> 'hashtags') = 'array'
    AND pg_catalog.jsonb_array_length(p_snapshot -> 'hashtags') <= 4
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'hashtags') AS hashtag(value)
      WHERE pg_catalog.jsonb_typeof(hashtag.value) IS DISTINCT FROM 'string'
        OR pg_catalog.char_length(pg_catalog.btrim(hashtag.value #>> '{}')) NOT BETWEEN 1 AND 20
    )
    AND (
      ((p_snapshot ->> 'mode') = 'solo' AND (p_snapshot ->> 'provisional') = 'true')
      OR ((p_snapshot ->> 'mode') = 'couple' AND (p_snapshot ->> 'provisional') = 'false')
    );
$$;

CREATE OR REPLACE FUNCTION public.court_redacted_verdict_result(
  p_safety_level text
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE WHEN p_safety_level IN ('sensitive', 'high_risk') THEN
    pg_catalog.jsonb_build_object(
      'schemaVersion', '1.0',
      'safety', pg_catalog.jsonb_build_object(
        'level', p_safety_level,
        'redacted', true
      ),
      'caseMeta', pg_catalog.jsonb_build_object('redacted', true),
      'caseSummary', '',
      'sharedFacts', '[]'::jsonb,
      'differentViews', '[]'::jsonb,
      'applicantNeeds', '[]'::jsonb,
      'partnerNeeds', '[]'::jsonb,
      'coreConflict', '',
      'responsibility', pg_catalog.jsonb_build_object('redacted', true),
      'verdict', pg_catalog.jsonb_build_object('redacted', true),
      'conversationScript', '[]'::jsonb,
      'missions', '[]'::jsonb,
      'checkIn', pg_catalog.jsonb_build_object('redacted', true),
      'confidence', 0,
      'limitations', pg_catalog.jsonb_build_array('safety_redacted'),
      'publicCard', pg_catalog.jsonb_build_object('redacted', true)
    )
  ELSE NULL END;
$$;

CREATE OR REPLACE FUNCTION public.court_missions_json_is_valid(
  p_missions jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_item jsonb;
  v_due_text text;
BEGIN
  IF p_missions IS NULL
    OR pg_catalog.jsonb_typeof(p_missions) IS DISTINCT FROM 'array'
  THEN
    RETURN false;
  END IF;
  IF pg_catalog.jsonb_array_length(p_missions) < 1
    OR pg_catalog.jsonb_array_length(p_missions) > 3
  THEN
    RETURN false;
  END IF;

  FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_missions)
  LOOP
    IF pg_catalog.jsonb_typeof(v_item) <> 'object'
      OR NOT (v_item ?& ARRAY[
        'title', 'description', 'owner', 'dueInMinutes',
        'completionCheck', 'funTag', 'relatedFeature'
      ])
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_object_keys(v_item) AS key(value)
        WHERE key.value NOT IN (
          'title', 'description', 'owner', 'dueInMinutes',
          'completionCheck', 'funTag', 'relatedFeature'
        )
      )
      OR pg_catalog.jsonb_typeof(v_item -> 'title') <> 'string'
      OR pg_catalog.char_length(pg_catalog.btrim(v_item ->> 'title')) NOT BETWEEN 1 AND 120
      OR pg_catalog.jsonb_typeof(v_item -> 'description') <> 'string'
      OR pg_catalog.char_length(pg_catalog.btrim(v_item ->> 'description')) NOT BETWEEN 1 AND 600
      OR pg_catalog.jsonb_typeof(v_item -> 'owner') <> 'string'
      OR (v_item ->> 'owner') NOT IN ('applicant', 'partner', 'both')
      OR pg_catalog.jsonb_typeof(v_item -> 'completionCheck') <> 'string'
      OR pg_catalog.char_length(pg_catalog.btrim(v_item ->> 'completionCheck')) NOT BETWEEN 1 AND 300
      OR (
        pg_catalog.jsonb_typeof(v_item -> 'funTag') NOT IN ('string', 'null')
        OR (
          pg_catalog.jsonb_typeof(v_item -> 'funTag') = 'string'
          AND pg_catalog.char_length(v_item ->> 'funTag') > 40
        )
      )
      OR pg_catalog.jsonb_typeof(v_item -> 'relatedFeature') <> 'string'
      OR (v_item ->> 'relatedFeature') <> 'task'
    THEN
      RETURN false;
    END IF;

    v_due_text := v_item ->> 'dueInMinutes';
    IF pg_catalog.jsonb_typeof(v_item -> 'dueInMinutes') <> 'number'
      OR v_due_text !~ '^[0-9]{1,4}$'
    THEN
      RETURN false;
    END IF;
    IF v_due_text::integer NOT BETWEEN 10 AND 4320 THEN
      RETURN false;
    END IF;
  END LOOP;

  RETURN true;
END;
$$;

ALTER FUNCTION public.court_safety_categories_are_valid(text[]) OWNER TO postgres;
ALTER FUNCTION public.court_event_metadata_is_safe(jsonb) OWNER TO postgres;
ALTER FUNCTION public.court_verdict_result_is_valid(jsonb) OWNER TO postgres;
ALTER FUNCTION public.court_public_snapshot_is_valid(jsonb) OWNER TO postgres;
ALTER FUNCTION public.court_redacted_verdict_result(text) OWNER TO postgres;
ALTER FUNCTION public.court_missions_json_is_valid(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.court_safety_categories_are_valid(text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.court_event_metadata_is_safe(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.court_verdict_result_is_valid(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.court_public_snapshot_is_valid(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.court_redacted_verdict_result(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.court_missions_json_is_valid(jsonb) FROM PUBLIC, anon, authenticated;

CREATE TABLE public.court_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  creation_request_id uuid NOT NULL,
  couple_id uuid REFERENCES public.couples(id) ON DELETE SET NULL,
  origin_couple_id uuid REFERENCES public.couples(id) ON DELETE SET NULL,
  mode text NOT NULL CHECK (mode IN ('solo', 'couple')),
  origin_mode text NOT NULL CHECK (origin_mode IN ('solo', 'couple')),
  solo_provisional_verdict_id uuid,
  category text NOT NULL CHECK (category IN (
    'budget', 'planning_roles', 'venue', 'studio_dress_makeup',
    'family', 'guests_invitations', 'honeymoon', 'home_setup',
    'communication', 'formalwear_shooting', 'ceremony_events', 'other'
  )),
  tone text NOT NULL CHECK (tone IN ('gentle', 'practical', 'spicy')),
  workflow_status text NOT NULL DEFAULT 'awaiting_applicant_statement'
    CHECK (workflow_status IN (
      'draft', 'awaiting_applicant_statement', 'awaiting_partner',
      'awaiting_partner_statement', 'statements_complete', 'judging',
      'verdict_ready', 'mission_active', 'resolved', 'archived'
    )),
  safety_level text NOT NULL DEFAULT 'normal'
    CHECK (safety_level IN ('normal', 'sensitive', 'high_risk')),
  safety_review_status text NOT NULL DEFAULT 'none'
    CHECK (safety_review_status IN ('none', 'pending', 'approved', 'rejected')),
  safety_categories text[] NOT NULL DEFAULT ARRAY[]::text[]
    CHECK (public.court_safety_categories_are_valid(safety_categories)),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  lock_version bigint NOT NULL DEFAULT 1 CHECK (lock_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT court_cases_mode_origin_check CHECK (
    (origin_mode = 'couple' AND mode = 'couple') OR origin_mode = 'solo'
  ),
  CONSTRAINT court_cases_solo_provisional_pointer_check CHECK (
    solo_provisional_verdict_id IS NULL
    OR (origin_mode = 'solo' AND mode = 'couple')
  ),
  CONSTRAINT court_cases_archived_state_check CHECK (
    (workflow_status = 'archived') = (archived_at IS NOT NULL)
  ),
  UNIQUE (creator_user_id, creation_request_id)
);

CREATE TABLE public.court_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.court_cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('applicant', 'partner')),
  participation_status text NOT NULL DEFAULT 'active'
    CHECK (participation_status IN ('active', 'left')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, case_id),
  UNIQUE (id, case_id, role),
  CONSTRAINT court_participants_left_state_check CHECK (
    (participation_status = 'left') = (left_at IS NOT NULL)
  )
);

-- A partner who leaves before submitting must remain an immutable historical
-- identity for event attribution. Only active membership is unique; a later
-- acceptance creates a new participant row instead of reassigning the old one.
CREATE UNIQUE INDEX court_participants_one_active_role
  ON public.court_participants(case_id, role)
  WHERE participation_status = 'active';
CREATE UNIQUE INDEX court_participants_one_active_user
  ON public.court_participants(case_id, user_id)
  WHERE participation_status = 'active';

CREATE TABLE public.court_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.court_cases(id) ON DELETE CASCADE,
  issued_by_participant_id uuid NOT NULL REFERENCES public.court_participants(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'partner' CHECK (role = 'partner'),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_by_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  rejected_at timestamptz,
  rejected_by_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT court_invites_expiry_check CHECK (
    expires_at > created_at AND expires_at <= created_at + interval '7 days'
  ),
  -- Profile deletion anonymizes the actor FK but must not reopen a terminal
  -- invite. The timestamp therefore remains the source of terminal truth.
  CONSTRAINT court_invites_consumption_check CHECK (
    (consumed_at IS NULL AND consumed_by_user_id IS NULL)
    OR consumed_at IS NOT NULL
  ),
  CONSTRAINT court_invites_rejection_check CHECK (
    rejected_at IS NOT NULL OR rejected_by_user_id IS NULL
  ),
  CONSTRAINT court_invites_terminal_state_check CHECK (
    (consumed_at IS NOT NULL)::integer
      + (revoked_at IS NOT NULL)::integer
      + (rejected_at IS NOT NULL)::integer <= 1
  )
);

CREATE UNIQUE INDEX court_invites_one_open_per_case
  ON public.court_invites(case_id)
  WHERE consumed_at IS NULL AND revoked_at IS NULL AND rejected_at IS NULL;

CREATE TABLE public.court_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.court_cases(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('applicant', 'partner')),
  submission_request_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision BETWEEN 1 AND 100),
  facts text NOT NULL CHECK (char_length(btrim(facts)) BETWEEN 10 AND 4000),
  feelings text NOT NULL CHECK (char_length(btrim(feelings)) BETWEEN 1 AND 2000),
  expectations text NOT NULL CHECK (char_length(btrim(expectations)) BETWEEN 1 AND 2000),
  attempts text NOT NULL DEFAULT '' CHECK (char_length(attempts) <= 2000),
  desired_agreement text NOT NULL CHECK (char_length(btrim(desired_agreement)) BETWEEN 1 AND 2000),
  submitted_safety_level text NOT NULL
    CHECK (submitted_safety_level IN ('normal', 'sensitive', 'high_risk')),
  submitted_safety_categories text[] NOT NULL
    CHECK (public.court_safety_categories_are_valid(submitted_safety_categories)),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (participant_id, case_id, role)
    REFERENCES public.court_participants(id, case_id, role) ON DELETE CASCADE,
  UNIQUE (case_id, participant_id, revision),
  UNIQUE (participant_id, submission_request_id)
);

CREATE TABLE public.court_verdicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.court_cases(id) ON DELETE CASCADE,
  input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  prompt_version text NOT NULL CHECK (prompt_version ~ '^[A-Za-z0-9._-]{1,64}$'),
  schema_version text NOT NULL CHECK (schema_version ~ '^[A-Za-z0-9._-]{1,64}$'),
  model text NOT NULL CHECK (
    model IN ('gpt-5.6-terra', 'couple-court-development-mock-v1')
  ),
  generation_version integer NOT NULL CHECK (generation_version BETWEEN 1 AND 1000),
  generation_status text NOT NULL DEFAULT 'in_progress'
    CHECK (generation_status IN ('in_progress', 'ready', 'failed', 'superseded')),
  claimed_by_participant_id uuid REFERENCES public.court_participants(id) ON DELETE SET NULL,
  lease_expires_at timestamptz,
  lease_token uuid,
  terminal_lease_token uuid,
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count BETWEEN 1 AND 10),
  result_json jsonb,
  error_code text CHECK (
    error_code IS NULL OR error_code ~ '^[a-z0-9_.-]{1,64}$'
  ),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  failed_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, generation_version),
  UNIQUE (id, case_id),
  CONSTRAINT court_verdicts_result_check CHECK (
    result_json IS NULL OR public.court_verdict_result_is_valid(result_json)
  ),
  CONSTRAINT court_verdicts_lifecycle_check CHECK (
    (generation_status = 'in_progress'
      AND lease_expires_at IS NOT NULL
      AND lease_token IS NOT NULL
      AND terminal_lease_token IS NULL
      AND result_json IS NULL
      AND completed_at IS NULL
      AND failed_at IS NULL
      AND superseded_at IS NULL
      AND error_code IS NULL)
    OR (generation_status = 'ready'
      AND lease_expires_at IS NULL
      AND lease_token IS NULL
      AND terminal_lease_token IS NOT NULL
      AND result_json IS NOT NULL
      AND completed_at IS NOT NULL
      AND failed_at IS NULL
      AND superseded_at IS NULL
      AND error_code IS NULL)
    OR (generation_status = 'failed'
      AND lease_expires_at IS NULL
      AND lease_token IS NULL
      AND terminal_lease_token IS NOT NULL
      AND result_json IS NULL
      AND completed_at IS NULL
      AND failed_at IS NOT NULL
      AND superseded_at IS NULL
      AND error_code IS NOT NULL)
    OR (generation_status = 'superseded'
      AND lease_expires_at IS NULL
      AND lease_token IS NULL
      AND terminal_lease_token IS NOT NULL
      AND result_json IS NOT NULL
      AND completed_at IS NOT NULL
      AND failed_at IS NULL
      AND superseded_at IS NOT NULL
      AND error_code IS NULL)
  )
);

CREATE UNIQUE INDEX court_verdicts_active_content_unique
  ON public.court_verdicts(case_id, input_hash, prompt_version, schema_version)
  WHERE generation_status IN ('in_progress', 'ready');
CREATE UNIQUE INDEX court_verdicts_one_ready_per_case
  ON public.court_verdicts(case_id)
  WHERE generation_status = 'ready';

ALTER TABLE public.court_cases
  ADD CONSTRAINT court_cases_solo_provisional_verdict_fk
  FOREIGN KEY (solo_provisional_verdict_id, id)
  REFERENCES public.court_verdicts(id, case_id)
  ON DELETE SET NULL (solo_provisional_verdict_id);

CREATE TABLE public.court_provider_reservations (
  verdict_id uuid PRIMARY KEY,
  case_id uuid NOT NULL,
  input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  request_key text NOT NULL UNIQUE CHECK (request_key ~ '^[a-f0-9]{64}$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  quota_scope_id uuid NOT NULL,
  quota_scope_kind text NOT NULL CHECK (quota_scope_kind IN ('couple', 'user')),
  audit_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  audit_couple_id uuid REFERENCES public.couples(id) ON DELETE SET NULL,
  audit_preflight_safety_level text NOT NULL CHECK (
    audit_preflight_safety_level IN ('normal', 'sensitive')
  ),
  provider_state text NOT NULL DEFAULT 'reserved' CHECK (
    provider_state IN (
      'reserved', 'started', 'result_staged', 'completed',
      'failed_unstarted', 'failed_invalid', 'failed_unknown', 'retry_allowed'
    )
  ),
  started_at timestamptz,
  staged_at timestamptz,
  staged_result_json jsonb,
  staged_missions_json jsonb,
  staged_model text CHECK (
    staged_model IS NULL OR staged_model = 'gpt-5.6-terra'
  ),
  audit_model text CHECK (
    audit_model IS NULL OR audit_model ~ '^[A-Za-z0-9._:/-]{1,128}$'
  ),
  provider_audit_state text NOT NULL DEFAULT 'not_required' CHECK (
    provider_audit_state IN ('not_required', 'pending', 'audited')
  ),
  provider_audit_pending_at timestamptz,
  provider_audited_at timestamptz,
  provider_audit_recovery_lease_token uuid,
  provider_audit_recovery_lease_expires_at timestamptz,
  provider_audit_recovery_attempt_count integer NOT NULL DEFAULT 0 CHECK (
    provider_audit_recovery_attempt_count BETWEEN 0 AND 10000
  ),
  provider_audit_recovery_last_error_code text CHECK (
    provider_audit_recovery_last_error_code IS NULL
      OR provider_audit_recovery_last_error_code ~ '^[a-z0-9_.-]{1,64}$'
  ),
  provider_audit_recovery_last_error_at timestamptz,
  provider_high_risk_categories text[],
  provider_input_tokens integer CHECK (
    provider_input_tokens IS NULL OR provider_input_tokens BETWEEN 0 AND 10000000
  ),
  provider_output_tokens integer CHECK (
    provider_output_tokens IS NULL OR provider_output_tokens BETWEEN 0 AND 10000000
  ),
  provider_cached_input_tokens integer CHECK (
    provider_cached_input_tokens IS NULL
      OR provider_cached_input_tokens BETWEEN 0 AND 10000000
  ),
  provider_cache_write_input_tokens integer CHECK (
    provider_cache_write_input_tokens IS NULL
      OR provider_cache_write_input_tokens BETWEEN 0 AND 10000000
  ),
  completed_at timestamptz,
  failed_at timestamptz,
  provider_error_code text CHECK (
    provider_error_code IS NULL OR provider_error_code ~ '^[a-z0-9_.-]{1,64}$'
  ),
  reconciled_at timestamptz,
  reconciled_by_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reconciliation_action text CHECK (
    reconciliation_action IS NULL OR reconciliation_action = 'allow_retry'
  ),
  reconciliation_reason_code text CHECK (
    reconciliation_reason_code IS NULL
      OR reconciliation_reason_code ~ '^[a-z0-9_]{1,64}$'
  ),
  reconciliation_confirmation text CHECK (
    reconciliation_confirmation IS NULL
      OR reconciliation_confirmation = 'ALLOW_RETRY_AFTER_PROVIDER_REVIEW'
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (verdict_id, case_id)
    REFERENCES public.court_verdicts(id, case_id) ON DELETE CASCADE,
  CONSTRAINT court_provider_reservations_staged_result_check CHECK (
    staged_result_json IS NULL
      OR public.court_verdict_result_is_valid(staged_result_json)
  ),
  CONSTRAINT court_provider_reservations_staged_missions_check CHECK (
    staged_missions_json IS NULL
      OR public.court_missions_json_is_valid(staged_missions_json)
  ),
  CONSTRAINT court_provider_reservations_staged_payload_match_check CHECK (
    staged_result_json IS NULL
      OR staged_result_json -> 'missions' IS NOT DISTINCT FROM staged_missions_json
  ),
  CONSTRAINT court_provider_reservations_usage_check CHECK (
    (provider_input_tokens IS NULL
      AND provider_output_tokens IS NULL
      AND provider_cached_input_tokens IS NULL
      AND provider_cache_write_input_tokens IS NULL)
    OR (provider_input_tokens IS NOT NULL
      AND provider_output_tokens IS NOT NULL
      AND (provider_cached_input_tokens IS NULL
        OR provider_cached_input_tokens <= provider_input_tokens)
      AND (provider_cache_write_input_tokens IS NULL
        OR provider_cache_write_input_tokens <= provider_input_tokens))
  ),
  CONSTRAINT court_provider_reservations_audit_recovery_lease_check CHECK (
    (provider_audit_recovery_lease_token IS NULL
      AND provider_audit_recovery_lease_expires_at IS NULL)
    OR (provider_audit_state = 'pending'
      AND provider_audit_recovery_lease_token IS NOT NULL
      AND provider_audit_recovery_lease_expires_at IS NOT NULL)
  ),
  CONSTRAINT court_provider_reservations_audit_recovery_error_check CHECK (
    (provider_audit_recovery_last_error_code IS NULL
      AND provider_audit_recovery_last_error_at IS NULL)
    OR (provider_audit_state = 'pending'
      AND provider_audit_recovery_last_error_code IS NOT NULL
      AND provider_audit_recovery_last_error_at IS NOT NULL)
  ),
  CONSTRAINT court_provider_reservations_high_risk_categories_check CHECK (
    provider_high_risk_categories IS NULL
      OR (pg_catalog.cardinality(provider_high_risk_categories) BETWEEN 1 AND 12
        AND public.court_safety_categories_are_valid(provider_high_risk_categories)
        AND provider_state = 'failed_invalid'
        AND provider_error_code = 'safety_high_risk'
        AND provider_audit_state IN ('pending', 'audited'))
  ),
  CONSTRAINT court_provider_reservations_lifecycle_check CHECK (
    (provider_state = 'reserved'
      AND started_at IS NULL AND staged_at IS NULL
      AND staged_result_json IS NULL AND staged_missions_json IS NULL
      AND staged_model IS NULL AND audit_model IS NULL
      AND provider_audit_state = 'not_required'
      AND provider_audit_pending_at IS NULL AND provider_audited_at IS NULL
      AND provider_audit_recovery_lease_token IS NULL
      AND provider_audit_recovery_lease_expires_at IS NULL
      AND provider_high_risk_categories IS NULL
      AND completed_at IS NULL AND failed_at IS NULL
      AND provider_input_tokens IS NULL AND provider_output_tokens IS NULL
      AND provider_cached_input_tokens IS NULL
      AND provider_cache_write_input_tokens IS NULL
      AND provider_error_code IS NULL AND reconciled_at IS NULL
      AND reconciled_by_user_id IS NULL AND reconciliation_action IS NULL
      AND reconciliation_reason_code IS NULL
      AND reconciliation_confirmation IS NULL)
    OR (provider_state = 'started'
      AND started_at IS NOT NULL AND staged_at IS NULL
      AND staged_result_json IS NULL AND staged_missions_json IS NULL
      AND staged_model IS NULL AND audit_model IS NULL
      AND provider_audit_state = 'not_required'
      AND provider_audit_pending_at IS NULL AND provider_audited_at IS NULL
      AND provider_audit_recovery_lease_token IS NULL
      AND provider_audit_recovery_lease_expires_at IS NULL
      AND provider_high_risk_categories IS NULL
      AND completed_at IS NULL AND failed_at IS NULL
      AND provider_input_tokens IS NULL AND provider_output_tokens IS NULL
      AND provider_cached_input_tokens IS NULL
      AND provider_cache_write_input_tokens IS NULL
      AND provider_error_code IS NULL AND reconciled_at IS NULL
      AND reconciled_by_user_id IS NULL AND reconciliation_action IS NULL
      AND reconciliation_reason_code IS NULL
      AND reconciliation_confirmation IS NULL)
    OR (provider_state = 'result_staged'
      AND started_at IS NOT NULL AND staged_at IS NOT NULL
      AND staged_result_json IS NOT NULL AND staged_missions_json IS NOT NULL
      AND staged_model IS NOT NULL AND audit_model IS NOT NULL
      AND provider_high_risk_categories IS NULL
      AND completed_at IS NULL AND failed_at IS NULL
      AND provider_error_code IS NULL AND reconciled_at IS NULL
      AND reconciled_by_user_id IS NULL AND reconciliation_action IS NULL
      AND reconciliation_reason_code IS NULL
      AND reconciliation_confirmation IS NULL
      AND (
        (provider_audit_state = 'pending'
          AND provider_audit_pending_at IS NOT NULL AND provider_audited_at IS NULL)
        OR (provider_audit_state = 'audited'
          AND provider_audit_pending_at IS NULL AND provider_audited_at IS NOT NULL
          AND provider_audit_recovery_lease_token IS NULL
          AND provider_audit_recovery_lease_expires_at IS NULL)
      ))
    OR (provider_state = 'completed'
      AND started_at IS NOT NULL AND staged_at IS NOT NULL
      AND staged_result_json IS NULL AND staged_missions_json IS NULL
      AND staged_model IS NOT NULL AND audit_model IS NOT NULL
      AND provider_audit_state = 'audited'
      AND provider_audit_pending_at IS NULL AND provider_audited_at IS NOT NULL
      AND provider_audit_recovery_lease_token IS NULL
      AND provider_audit_recovery_lease_expires_at IS NULL
      AND provider_high_risk_categories IS NULL
      AND completed_at IS NOT NULL AND failed_at IS NULL
      AND provider_error_code IS NULL AND reconciled_at IS NULL
      AND reconciled_by_user_id IS NULL AND reconciliation_action IS NULL
      AND reconciliation_reason_code IS NULL
      AND reconciliation_confirmation IS NULL)
    OR (provider_state = 'failed_unstarted'
      AND started_at IS NULL AND staged_at IS NULL
      AND staged_result_json IS NULL AND staged_missions_json IS NULL
      AND staged_model IS NULL AND audit_model IS NULL
      AND provider_audit_state = 'not_required'
      AND provider_audit_pending_at IS NULL AND provider_audited_at IS NULL
      AND provider_audit_recovery_lease_token IS NULL
      AND provider_audit_recovery_lease_expires_at IS NULL
      AND provider_high_risk_categories IS NULL
      AND completed_at IS NULL AND failed_at IS NOT NULL
      AND provider_input_tokens IS NULL AND provider_output_tokens IS NULL
      AND provider_cached_input_tokens IS NULL
      AND provider_cache_write_input_tokens IS NULL
      AND provider_error_code IS NOT NULL AND reconciled_at IS NULL
      AND reconciled_by_user_id IS NULL AND reconciliation_action IS NULL
      AND reconciliation_reason_code IS NULL
      AND reconciliation_confirmation IS NULL)
    OR (provider_state = 'failed_invalid'
      AND started_at IS NOT NULL AND staged_at IS NULL
      AND staged_result_json IS NULL AND staged_missions_json IS NULL
      AND staged_model IS NULL
      AND completed_at IS NULL AND failed_at IS NOT NULL
      AND provider_error_code IS NOT NULL AND reconciled_at IS NULL
      AND reconciled_by_user_id IS NULL AND reconciliation_action IS NULL
      AND reconciliation_reason_code IS NULL
      AND reconciliation_confirmation IS NULL
      AND (
        (provider_audit_state = 'not_required'
          AND audit_model IS NULL
          AND provider_input_tokens IS NULL AND provider_output_tokens IS NULL
          AND provider_cached_input_tokens IS NULL
          AND provider_cache_write_input_tokens IS NULL
          AND provider_audit_pending_at IS NULL AND provider_audited_at IS NULL
          AND provider_audit_recovery_lease_token IS NULL
          AND provider_audit_recovery_lease_expires_at IS NULL
          AND provider_high_risk_categories IS NULL)
        OR (provider_audit_state = 'pending'
          AND audit_model IS NOT NULL
          AND provider_audit_pending_at IS NOT NULL AND provider_audited_at IS NULL
          AND provider_error_code IN (
            'safety_high_risk', 'safety_level_changed', 'court_archived'
          ))
        OR (provider_audit_state = 'audited'
          AND audit_model IS NOT NULL
          AND provider_audit_pending_at IS NULL AND provider_audited_at IS NOT NULL
          AND provider_audit_recovery_lease_token IS NULL
          AND provider_audit_recovery_lease_expires_at IS NULL
          AND provider_error_code IN (
            'safety_high_risk', 'safety_level_changed', 'court_archived'
          ))
      ))
    OR (provider_state = 'failed_unknown'
      AND started_at IS NOT NULL AND staged_at IS NULL
      AND staged_result_json IS NULL AND staged_missions_json IS NULL
      AND staged_model IS NULL AND audit_model IS NULL
      AND provider_audit_state = 'not_required'
      AND provider_audit_pending_at IS NULL AND provider_audited_at IS NULL
      AND provider_audit_recovery_lease_token IS NULL
      AND provider_audit_recovery_lease_expires_at IS NULL
      AND provider_high_risk_categories IS NULL
      AND completed_at IS NULL AND failed_at IS NOT NULL
      AND provider_input_tokens IS NULL AND provider_output_tokens IS NULL
      AND provider_cached_input_tokens IS NULL
      AND provider_cache_write_input_tokens IS NULL
      AND provider_error_code IS NOT NULL AND reconciled_at IS NULL
      AND reconciled_by_user_id IS NULL AND reconciliation_action IS NULL
      AND reconciliation_reason_code IS NULL
      AND reconciliation_confirmation IS NULL)
    OR (provider_state = 'retry_allowed'
      AND started_at IS NOT NULL AND staged_at IS NULL
      AND staged_result_json IS NULL AND staged_missions_json IS NULL
      AND staged_model IS NULL AND audit_model IS NULL
      AND provider_audit_state = 'not_required'
      AND provider_audit_pending_at IS NULL AND provider_audited_at IS NULL
      AND provider_audit_recovery_lease_token IS NULL
      AND provider_audit_recovery_lease_expires_at IS NULL
      AND provider_high_risk_categories IS NULL
      AND completed_at IS NULL AND failed_at IS NOT NULL
      AND provider_input_tokens IS NULL AND provider_output_tokens IS NULL
      AND provider_cached_input_tokens IS NULL
      AND provider_cache_write_input_tokens IS NULL
      AND provider_error_code IS NOT NULL AND reconciled_at IS NOT NULL
      AND reconciliation_action = 'allow_retry'
      AND reconciliation_reason_code IS NOT NULL
      AND reconciliation_confirmation = 'ALLOW_RETRY_AFTER_PROVIDER_REVIEW')
  )
);

CREATE INDEX court_provider_reservations_reconciliation_queue_idx
  ON public.court_provider_reservations(failed_at DESC, case_id)
  WHERE provider_state = 'failed_unknown';

CREATE INDEX court_provider_reservations_audit_recovery_queue_idx
  ON public.court_provider_reservations(
    provider_audit_pending_at,
    provider_audit_recovery_lease_expires_at,
    provider_audit_recovery_attempt_count,
    verdict_id
  )
  WHERE provider_audit_state = 'pending';

-- Settle a claimed provider slot exactly once. A reservation that never
-- crossed the provider boundary refunds both legacy counters using the same
-- global -> scope lock order as reserve_amora_usage(); an ambiguous started
-- call remains counted and requires manual reconciliation.
CREATE OR REPLACE FUNCTION public.settle_court_provider_failure(
  p_verdict_id uuid,
  p_error_code text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_reservation public.court_provider_reservations%ROWTYPE;
  v_kst_day text;
  v_global_key text;
  v_scope_key text;
  v_next_state text;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_verdict_id IS NULL OR p_error_code IS NULL
    OR p_error_code !~ '^[a-z0-9_.-]{1,64}$'
  THEN
    RAISE EXCEPTION 'invalid court provider settlement arguments'
      USING ERRCODE = '22023';
  END IF;

  SELECT reservation.* INTO v_reservation
  FROM public.court_provider_reservations AS reservation
  WHERE reservation.verdict_id = p_verdict_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF v_reservation.provider_state NOT IN ('reserved', 'started', 'result_staged') THEN
    RETURN v_reservation.provider_state;
  END IF;

  IF v_reservation.provider_state = 'reserved' THEN
    v_kst_day := pg_catalog.to_char(
      v_reservation.created_at AT TIME ZONE 'Asia/Seoul',
      'YYYY-MM-DD'
    );
    v_global_key := 'global:provider_calls:' || v_kst_day;
    v_scope_key := 'couple:provider_calls:'
      || v_reservation.quota_scope_id::text || ':' || v_kst_day;

    UPDATE public.amora_turn_counters
    SET count = GREATEST(count - 1, 0),
        updated_at = pg_catalog.clock_timestamp()
    WHERE key = v_global_key;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'court_provider_counter_missing' USING ERRCODE = '55000';
    END IF;

    UPDATE public.amora_turn_counters
    SET count = GREATEST(count - 1, 0),
        updated_at = pg_catalog.clock_timestamp()
    WHERE key = v_scope_key;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'court_provider_counter_missing' USING ERRCODE = '55000';
    END IF;

    UPDATE public.court_provider_reservations
    SET provider_state = 'failed_unstarted',
        failed_at = pg_catalog.clock_timestamp(),
        completed_at = NULL,
        provider_error_code = p_error_code
    WHERE verdict_id = p_verdict_id
      AND provider_state = 'reserved';
    RETURN 'failed_unstarted';
  END IF;

  v_next_state := CASE
    WHEN v_reservation.provider_state = 'result_staged'
      OR p_error_code IN (
        'structured_output_invalid', 'safety_high_risk',
        'safety_level_changed', 'court_archived'
      )
      THEN 'failed_invalid'
    ELSE 'failed_unknown'
  END;

  UPDATE public.court_provider_reservations
  SET provider_state = v_next_state,
      staged_at = NULL,
      staged_result_json = NULL,
      staged_missions_json = NULL,
      staged_model = NULL,
      audit_model = CASE WHEN v_reservation.provider_state = 'result_staged'
        THEN v_reservation.audit_model ELSE NULL END,
      provider_audit_state = CASE WHEN v_reservation.provider_state = 'result_staged'
        THEN v_reservation.provider_audit_state ELSE 'not_required' END,
      provider_audit_pending_at = CASE WHEN v_reservation.provider_state = 'result_staged'
        THEN v_reservation.provider_audit_pending_at ELSE NULL END,
      provider_audited_at = CASE WHEN v_reservation.provider_state = 'result_staged'
        THEN v_reservation.provider_audited_at ELSE NULL END,
      provider_audit_recovery_lease_token = CASE
        WHEN v_reservation.provider_state = 'result_staged'
          THEN v_reservation.provider_audit_recovery_lease_token
        ELSE NULL END,
      provider_audit_recovery_lease_expires_at = CASE
        WHEN v_reservation.provider_state = 'result_staged'
          THEN v_reservation.provider_audit_recovery_lease_expires_at
        ELSE NULL END,
      provider_high_risk_categories = CASE
        WHEN v_reservation.provider_state = 'result_staged'
          THEN v_reservation.provider_high_risk_categories
        ELSE NULL END,
      provider_input_tokens = CASE WHEN v_reservation.provider_state = 'result_staged'
        THEN v_reservation.provider_input_tokens ELSE NULL END,
      provider_output_tokens = CASE WHEN v_reservation.provider_state = 'result_staged'
        THEN v_reservation.provider_output_tokens ELSE NULL END,
      provider_cached_input_tokens = CASE
        WHEN v_reservation.provider_state = 'result_staged'
          THEN v_reservation.provider_cached_input_tokens
        ELSE NULL END,
      provider_cache_write_input_tokens = CASE
        WHEN v_reservation.provider_state = 'result_staged'
          THEN v_reservation.provider_cache_write_input_tokens
        ELSE NULL END,
      failed_at = pg_catalog.clock_timestamp(),
      completed_at = NULL,
      provider_error_code = p_error_code
  WHERE verdict_id = p_verdict_id
    AND provider_state IN ('started', 'result_staged');
  RETURN v_next_state;
END;
$$;

ALTER FUNCTION public.settle_court_provider_failure(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.settle_court_provider_failure(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_court_provider_failure(uuid, text)
  TO service_role;

CREATE TABLE public.court_missions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.court_cases(id) ON DELETE CASCADE,
  verdict_id uuid NOT NULL,
  owner_role text NOT NULL CHECK (owner_role IN ('applicant', 'partner', 'both')),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  description text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 1 AND 600),
  completion_check text NOT NULL CHECK (char_length(btrim(completion_check)) BETWEEN 1 AND 300),
  due_in_minutes integer NOT NULL CHECK (due_in_minutes BETWEEN 10 AND 4320),
  fun_tag text CHECK (fun_tag IS NULL OR char_length(fun_tag) <= 40),
  related_feature text NOT NULL CHECK (related_feature = 'task'),
  mission_status text NOT NULL DEFAULT 'proposed'
    CHECK (mission_status IN ('proposed', 'accepted', 'completed', 'dismissed')),
  amora_action_id text REFERENCES public.amora_actions(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  completed_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (verdict_id, id),
  UNIQUE (id, case_id),
  FOREIGN KEY (verdict_id, case_id)
    REFERENCES public.court_verdicts(id, case_id) ON DELETE CASCADE,
  CONSTRAINT court_missions_timestamps_check CHECK (
    (mission_status = 'proposed' AND accepted_at IS NULL AND completed_at IS NULL AND dismissed_at IS NULL)
    OR (mission_status = 'accepted' AND accepted_at IS NOT NULL AND completed_at IS NULL AND dismissed_at IS NULL)
    OR (mission_status = 'completed' AND accepted_at IS NOT NULL AND completed_at IS NOT NULL AND dismissed_at IS NULL)
    OR (mission_status = 'dismissed' AND completed_at IS NULL AND dismissed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX court_missions_amora_action_unique
  ON public.court_missions(amora_action_id)
  WHERE amora_action_id IS NOT NULL;

CREATE TABLE public.court_mission_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.court_cases(id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  completion_status text NOT NULL CHECK (
    completion_status IN ('accepted', 'completed', 'dismissed')
  ),
  accepted_at timestamptz,
  completed_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mission_id, participant_id),
  FOREIGN KEY (mission_id, case_id)
    REFERENCES public.court_missions(id, case_id) ON DELETE CASCADE,
  FOREIGN KEY (participant_id, case_id)
    REFERENCES public.court_participants(id, case_id) ON DELETE CASCADE,
  CONSTRAINT court_mission_completions_timestamps_check CHECK (
    (completion_status = 'accepted' AND accepted_at IS NOT NULL AND completed_at IS NULL AND dismissed_at IS NULL)
    OR (completion_status = 'completed' AND accepted_at IS NOT NULL AND completed_at IS NOT NULL AND dismissed_at IS NULL)
    OR (completion_status = 'dismissed' AND completed_at IS NULL AND dismissed_at IS NOT NULL)
  )
);

CREATE TABLE public.court_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.court_cases(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL,
  verdict_id uuid,
  satisfaction smallint NOT NULL CHECK (satisfaction BETWEEN 1 AND 5),
  remaining_issue text CHECK (
    remaining_issue IS NULL OR char_length(remaining_issue) <= 2000
  ),
  note text CHECK (note IS NULL OR char_length(note) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (participant_id, case_id)
    REFERENCES public.court_participants(id, case_id) ON DELETE CASCADE,
  FOREIGN KEY (verdict_id, case_id)
    REFERENCES public.court_verdicts(id, case_id)
    ON DELETE SET NULL (verdict_id)
);

CREATE UNIQUE INDEX court_followups_one_per_participant_verdict
  ON public.court_followups(participant_id, verdict_id)
  WHERE verdict_id IS NOT NULL;

CREATE TABLE public.court_case_events (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES public.court_cases(id) ON DELETE CASCADE,
  actor_participant_id uuid REFERENCES public.court_participants(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'case_created', 'statement_submitted', 'invite_issued', 'invite_revoked',
    'invite_accepted', 'invite_rejected', 'participant_left',
    'safety_changed', 'verdict_claimed', 'verdict_ready', 'verdict_failed',
    'provider_reconciled',
    'mission_status_changed', 'mission_action_linked', 'followup_recorded',
    'public_snapshot_prepared', 'public_consent_changed', 'public_reviewed',
    'public_published', 'public_hidden', 'case_archived',
    'public_vote_cast', 'public_comment_created', 'public_report_created',
    'public_comment_reviewed', 'public_comments_toggled',
    'public_report_reviewed'
  )),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (public.court_event_metadata_is_safe(metadata)),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.court_public_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.court_cases(id) ON DELETE CASCADE,
  sanitized_snapshot_json jsonb NOT NULL
    CHECK (public.court_public_snapshot_is_valid(sanitized_snapshot_json)),
  snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^[a-f0-9]{64}$'),
  snapshot_version integer NOT NULL CHECK (snapshot_version BETWEEN 1 AND 100),
  status text NOT NULL DEFAULT 'awaiting_consents'
    CHECK (status IN (
      'awaiting_consents', 'pending_review', 'published', 'hidden', 'rejected'
    )),
  safety_level text NOT NULL CHECK (safety_level = 'normal'),
  moderation_status text NOT NULL DEFAULT 'pending'
    CHECK (moderation_status IN ('pending', 'approved', 'rejected')),
  moderation_reason_code text CHECK (
    moderation_reason_code IS NULL OR moderation_reason_code ~ '^[a-z0-9_]{1,64}$'
  ),
  reviewed_by_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  comments_enabled boolean NOT NULL DEFAULT true,
  published_at timestamptz,
  hidden_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, snapshot_version),
  UNIQUE (id, snapshot_hash),
  CONSTRAINT court_public_posts_lifecycle_check CHECK (
    (status = 'published' AND published_at IS NOT NULL AND hidden_at IS NULL
      AND moderation_status = 'approved')
    OR (status = 'hidden' AND hidden_at IS NOT NULL)
    OR (status = 'rejected' AND moderation_status = 'rejected')
    OR (status IN ('awaiting_consents', 'pending_review')
      AND published_at IS NULL AND hidden_at IS NULL)
  )
);

CREATE UNIQUE INDEX court_public_posts_one_active_per_case
  ON public.court_public_posts(case_id)
  WHERE status IN ('awaiting_consents', 'pending_review', 'published');

CREATE TABLE public.court_public_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_post_id uuid NOT NULL,
  participant_id uuid NOT NULL REFERENCES public.court_participants(id) ON DELETE CASCADE,
  snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^[a-f0-9]{64}$'),
  consented_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (public_post_id, snapshot_hash)
    REFERENCES public.court_public_posts(id, snapshot_hash) ON DELETE CASCADE,
  UNIQUE (public_post_id, participant_id, snapshot_hash)
);

CREATE TABLE public.court_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_post_id uuid NOT NULL REFERENCES public.court_public_posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  choice text NOT NULL CHECK (choice IN (
    'applicant_more_at_fault', 'partner_more_at_fault',
    'both_need_change', 'need_more_info'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (public_post_id, user_id)
);

CREATE TABLE public.court_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_post_id uuid NOT NULL REFERENCES public.court_public_posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  comment_type text NOT NULL CHECK (
    comment_type IN ('empathy', 'experience', 'practical_advice', 'question')
  ),
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 1000),
  moderation_status text NOT NULL DEFAULT 'pending'
    CHECK (moderation_status IN ('pending', 'visible', 'hidden', 'rejected')),
  moderation_reason_code text CHECK (
    moderation_reason_code IS NULL OR moderation_reason_code ~ '^[a-z0-9_]{1,64}$'
  ),
  reviewed_by_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (id, public_post_id)
);

CREATE TABLE public.court_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_post_id uuid NOT NULL REFERENCES public.court_public_posts(id) ON DELETE CASCADE,
  comment_id uuid,
  reporter_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('post', 'comment')),
  reason_code text NOT NULL CHECK (reason_code IN (
    'harassment', 'pii', 'threat', 'hate', 'spam', 'minor_safety', 'other'
  )),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
  reviewed_by_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  resolution_reason_code text CHECK (
    resolution_reason_code IS NULL OR resolution_reason_code ~ '^[a-z0-9_]{1,64}$'
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (comment_id, public_post_id)
    REFERENCES public.court_comments(id, public_post_id) ON DELETE CASCADE,
  CONSTRAINT court_reports_target_check CHECK (
    (target_type = 'post' AND comment_id IS NULL)
    OR (target_type = 'comment' AND comment_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX court_reports_unique_post_reporter
  ON public.court_reports(public_post_id, reporter_user_id)
  WHERE target_type = 'post';
CREATE UNIQUE INDEX court_reports_unique_comment_reporter
  ON public.court_reports(comment_id, reporter_user_id)
  WHERE target_type = 'comment';

CREATE INDEX court_cases_creator_updated_idx
  ON public.court_cases(creator_user_id, updated_at DESC);
CREATE INDEX court_cases_couple_updated_idx
  ON public.court_cases(couple_id, updated_at DESC) WHERE couple_id IS NOT NULL;
CREATE INDEX court_participants_user_case_idx
  ON public.court_participants(user_id, case_id);
CREATE INDEX court_statements_case_role_revision_idx
  ON public.court_statements(case_id, role, revision DESC);
CREATE INDEX court_verdicts_case_created_idx
  ON public.court_verdicts(case_id, created_at DESC);
CREATE INDEX court_verdicts_stale_lease_idx
  ON public.court_verdicts(lease_expires_at)
  WHERE generation_status = 'in_progress';
CREATE INDEX court_provider_reservations_case_created_idx
  ON public.court_provider_reservations(case_id, created_at DESC);
CREATE INDEX court_missions_case_status_idx
  ON public.court_missions(case_id, mission_status, created_at);
CREATE INDEX court_mission_completions_participant_idx
  ON public.court_mission_completions(participant_id, updated_at DESC);
CREATE INDEX court_followups_case_created_idx
  ON public.court_followups(case_id, created_at DESC);
CREATE INDEX court_case_events_case_created_idx
  ON public.court_case_events(case_id, created_at DESC);
CREATE INDEX court_public_posts_status_published_idx
  ON public.court_public_posts(status, published_at DESC);
CREATE INDEX court_public_consents_post_active_idx
  ON public.court_public_consents(public_post_id, participant_id)
  WHERE revoked_at IS NULL;
CREATE INDEX court_votes_post_choice_idx
  ON public.court_votes(public_post_id, choice);
CREATE INDEX court_comments_post_visible_idx
  ON public.court_comments(public_post_id, created_at)
  WHERE moderation_status = 'visible' AND deleted_at IS NULL;
CREATE INDEX court_reports_status_created_idx
  ON public.court_reports(status, created_at);

-- Amora actions remain normalized. A mission can link to at most one action,
-- and the linking RPC below verifies the action is a court action for the same
-- couple and creator.
ALTER TABLE public.amora_actions
  DROP CONSTRAINT IF EXISTS amora_actions_source_check;
ALTER TABLE public.amora_actions
  ADD CONSTRAINT amora_actions_source_check
  CHECK (source IN ('chat', 'quote', 'schedule', 'budget', 'guardrail', 'manual', 'court'));

-- Successful provider audits can be retried after a staged-result recovery.
-- Legacy rows have no key; exclude those NULLs from the new unique index so
-- its build and ongoing footprint stay bounded to exactly-once writes.
ALTER TABLE public.ai_interactions_log
  ADD COLUMN idempotency_key text;
ALTER TABLE public.ai_interactions_log
  ADD CONSTRAINT ai_interactions_log_idempotency_key_check
  CHECK (
    idempotency_key IS NULL
      OR idempotency_key ~ '^[a-f0-9]{64}$'
  );
CREATE UNIQUE INDEX ai_interactions_log_idempotency_key_unique
  ON public.ai_interactions_log(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- A payload-free compliance audit must outlive an optional couple deletion.
-- Match the reservation envelope's SET NULL identity semantics so a pending
-- exact-finalize comparison cannot be invalidated by a parent-row cascade.
ALTER TABLE public.ai_interactions_log
  DROP CONSTRAINT IF EXISTS ai_interactions_log_couple_id_fkey;
ALTER TABLE public.ai_interactions_log
  ADD CONSTRAINT ai_interactions_log_couple_id_fkey
  FOREIGN KEY (couple_id) REFERENCES public.couples(id) ON DELETE SET NULL;

ALTER TABLE public.ai_interactions_log
  DROP CONSTRAINT IF EXISTS ai_interactions_log_interaction_type_check;
ALTER TABLE public.ai_interactions_log
  ADD CONSTRAINT ai_interactions_log_interaction_type_check
  CHECK (interaction_type IN (
    'chat_turn', 'tool_call', 'tool_result', 'amora_director',
    'vendor_recommendation', 'feedback', 'community_amora_comment',
    'community_agent_auto', 'couple_court_verdict'
  ));

CREATE OR REPLACE FUNCTION public.set_court_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  NEW.updated_at := pg_catalog.clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_submitted_court_statement()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'submitted court statements are immutable'
    USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_court_public_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.case_id IS DISTINCT FROM OLD.case_id
    OR NEW.sanitized_snapshot_json IS DISTINCT FROM OLD.sanitized_snapshot_json
    OR NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash
    OR NEW.snapshot_version IS DISTINCT FROM OLD.snapshot_version
    OR NEW.safety_level IS DISTINCT FROM OLD.safety_level
  THEN
    RAISE EXCEPTION 'published candidate snapshots are immutable; create a new version'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_court_mission_action_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_case_couple_id uuid;
  v_action_couple_id uuid;
  v_action_source text;
BEGIN
  IF NEW.amora_action_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.related_feature IS DISTINCT FROM 'task' THEN
    RAISE EXCEPTION 'only task missions can link an Amora action'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.court_verdicts AS verdict
  WHERE verdict.id = NEW.verdict_id
    AND verdict.case_id = NEW.case_id
    AND verdict.generation_status = 'ready';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'only the current court verdict can create a shared action'
      USING ERRCODE = '42501';
  END IF;

  SELECT court_case.couple_id
  INTO v_case_couple_id
  FROM public.court_cases AS court_case
  WHERE court_case.id = NEW.case_id;

  SELECT action.couple_id, action.source
  INTO v_action_couple_id, v_action_source
  FROM public.amora_actions AS action
  WHERE action.id = NEW.amora_action_id;

  IF v_case_couple_id IS NULL
    OR v_action_couple_id IS DISTINCT FROM v_case_couple_id
    OR v_action_source IS DISTINCT FROM 'court'
  THEN
    RAISE EXCEPTION 'court mission action link is outside its case boundary'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- A two-sided court record cannot be reliably redacted participant-by-
-- participant: the verdict, missions and followups are all derived from both
-- statements. The conservative account-deletion boundary therefore removes
-- the complete case as soon as either active participant starts deletion. A
-- historical partner who left before submitting has no two-sided payload and
-- is detached without erasing the applicant's restored case.
CREATE OR REPLACE FUNCTION public.hide_court_publication_for_deleting_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.account_deleting_at IS NULL
    OR NEW.account_deleting_at IS NOT DISTINCT FROM OLD.account_deleting_at
  THEN
    RETURN NEW;
  END IF;

  DELETE FROM public.court_votes
  WHERE user_id = NEW.id;
  DELETE FROM public.court_comments
  WHERE user_id = NEW.id;
  DELETE FROM public.court_reports
  WHERE reporter_user_id = NEW.id;

  DELETE FROM public.court_cases AS court_case
  WHERE court_case.id IN (
    SELECT participant.case_id
    FROM public.court_participants AS participant
    WHERE participant.user_id = NEW.id
      AND participant.participation_status = 'active'
  );

  RETURN NEW;
END;
$$;

-- Direct active-participant deletion (including a profile cascade that
-- bypasses the lifecycle marker) receives the same whole-case erasure.
-- Deferral prevents a recursive cascade: by the time this runs, an
-- already-deleted parent case is simply a no-op.
CREATE OR REPLACE FUNCTION public.delete_court_case_after_participant_removal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF OLD.participation_status <> 'active' THEN
    RETURN OLD;
  END IF;

  DELETE FROM public.court_cases
  WHERE id = OLD.case_id;
  RETURN OLD;
END;
$$;

-- Defense in depth for administrative/direct profile deletion paths that do
-- not pass through begin_account_deletion(). A removed participant can no
-- longer provide the dual consent required by a published snapshot.
CREATE OR REPLACE FUNCTION public.hide_court_publication_for_removed_participant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF OLD.participation_status <> 'active' THEN
    RETURN OLD;
  END IF;

  UPDATE public.court_public_posts AS post
  SET status = 'hidden',
      hidden_at = COALESCE(post.hidden_at, pg_catalog.clock_timestamp())
  WHERE post.case_id = OLD.case_id
    AND post.status IN ('awaiting_consents', 'pending_review', 'published');

  UPDATE public.court_public_consents AS consent
  SET revoked_at = COALESCE(consent.revoked_at, pg_catalog.clock_timestamp())
  FROM public.court_public_posts AS post
  WHERE post.case_id = OLD.case_id
    AND consent.public_post_id = post.id
    AND consent.revoked_at IS NULL;

  UPDATE public.court_invites AS invite
  SET revoked_at = COALESCE(invite.revoked_at, pg_catalog.clock_timestamp())
  WHERE invite.case_id = OLD.case_id
    AND invite.consumed_at IS NULL
    AND invite.revoked_at IS NULL
    AND invite.rejected_at IS NULL;

  RETURN OLD;
END;
$$;

-- Court-derived Amora actions carry verdict/mission text but are referenced in
-- the opposite FK direction. Delete them before a case or verdict cascade so
-- privacy deletion and high-risk suppression cannot leave orphaned advice in
-- the shared couple workspace.
CREATE OR REPLACE FUNCTION public.delete_court_actions_for_removed_case()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  DELETE FROM public.amora_actions AS action
  USING public.court_missions AS mission
  WHERE mission.case_id = OLD.id
    AND mission.amora_action_id = action.id
    AND action.source = 'court';
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_court_actions_for_removed_verdict()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  DELETE FROM public.amora_actions AS action
  USING public.court_missions AS mission
  WHERE mission.verdict_id = OLD.id
    AND mission.amora_action_id = action.id
    AND action.source = 'court';
  RETURN OLD;
END;
$$;

ALTER FUNCTION public.set_court_updated_at() OWNER TO postgres;
ALTER FUNCTION public.protect_submitted_court_statement() OWNER TO postgres;
ALTER FUNCTION public.protect_court_public_snapshot() OWNER TO postgres;
ALTER FUNCTION public.guard_court_mission_action_link() OWNER TO postgres;
ALTER FUNCTION public.hide_court_publication_for_deleting_profile() OWNER TO postgres;
ALTER FUNCTION public.hide_court_publication_for_removed_participant() OWNER TO postgres;
ALTER FUNCTION public.delete_court_case_after_participant_removal() OWNER TO postgres;
ALTER FUNCTION public.delete_court_actions_for_removed_case() OWNER TO postgres;
ALTER FUNCTION public.delete_court_actions_for_removed_verdict() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_court_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_submitted_court_statement() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_court_public_snapshot() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_court_mission_action_link() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hide_court_publication_for_deleting_profile()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hide_court_publication_for_removed_participant()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_court_case_after_participant_removal()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_court_actions_for_removed_case()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_court_actions_for_removed_verdict()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER court_cases_touch_updated_at
  BEFORE UPDATE ON public.court_cases
  FOR EACH ROW EXECUTE FUNCTION public.set_court_updated_at();
CREATE TRIGGER court_participants_touch_updated_at
  BEFORE UPDATE ON public.court_participants
  FOR EACH ROW EXECUTE FUNCTION public.set_court_updated_at();
CREATE TRIGGER court_statements_are_immutable
  BEFORE UPDATE ON public.court_statements
  FOR EACH ROW EXECUTE FUNCTION public.protect_submitted_court_statement();
CREATE TRIGGER court_verdicts_touch_updated_at
  BEFORE UPDATE ON public.court_verdicts
  FOR EACH ROW EXECUTE FUNCTION public.set_court_updated_at();
CREATE TRIGGER court_provider_reservations_touch_updated_at
  BEFORE UPDATE ON public.court_provider_reservations
  FOR EACH ROW EXECUTE FUNCTION public.set_court_updated_at();
CREATE TRIGGER court_missions_touch_updated_at
  BEFORE UPDATE ON public.court_missions
  FOR EACH ROW EXECUTE FUNCTION public.set_court_updated_at();
CREATE TRIGGER court_missions_guard_action_link
  BEFORE INSERT OR UPDATE OF amora_action_id, related_feature, case_id
  ON public.court_missions
  FOR EACH ROW EXECUTE FUNCTION public.guard_court_mission_action_link();
CREATE TRIGGER court_mission_completions_touch_updated_at
  BEFORE UPDATE ON public.court_mission_completions
  FOR EACH ROW EXECUTE FUNCTION public.set_court_updated_at();
CREATE TRIGGER court_public_posts_touch_updated_at
  BEFORE UPDATE ON public.court_public_posts
  FOR EACH ROW EXECUTE FUNCTION public.set_court_updated_at();
CREATE TRIGGER court_public_posts_snapshot_immutable
  BEFORE UPDATE ON public.court_public_posts
  FOR EACH ROW EXECUTE FUNCTION public.protect_court_public_snapshot();
CREATE TRIGGER court_public_consents_touch_updated_at
  BEFORE UPDATE ON public.court_public_consents
  FOR EACH ROW EXECUTE FUNCTION public.set_court_updated_at();
CREATE TRIGGER court_votes_touch_updated_at
  BEFORE UPDATE ON public.court_votes
  FOR EACH ROW EXECUTE FUNCTION public.set_court_updated_at();
CREATE TRIGGER court_comments_touch_updated_at
  BEFORE UPDATE ON public.court_comments
  FOR EACH ROW EXECUTE FUNCTION public.set_court_updated_at();
CREATE TRIGGER court_reports_touch_updated_at
  BEFORE UPDATE ON public.court_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_court_updated_at();

CREATE TRIGGER court_profile_deletion_hides_publication
  AFTER UPDATE OF account_deleting_at ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.hide_court_publication_for_deleting_profile();
CREATE TRIGGER court_participant_removal_hides_publication
  BEFORE DELETE ON public.court_participants
  FOR EACH ROW EXECUTE FUNCTION public.hide_court_publication_for_removed_participant();
CREATE CONSTRAINT TRIGGER court_participant_removal_deletes_case
  AFTER DELETE ON public.court_participants
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.delete_court_case_after_participant_removal();
CREATE TRIGGER court_case_removal_deletes_actions
  BEFORE DELETE ON public.court_cases
  FOR EACH ROW EXECUTE FUNCTION public.delete_court_actions_for_removed_case();
CREATE TRIGGER court_verdict_removal_deletes_actions
  BEFORE DELETE ON public.court_verdicts
  FOR EACH ROW EXECUTE FUNCTION public.delete_court_actions_for_removed_verdict();

-- Share the established account-deletion/profile-row lock with every direct
-- user reference. If the court write wins, deletion later cascades or redacts;
-- if deletion wins, the write fails before retaining private payload.
CREATE TRIGGER guard_delete_court_cases
  BEFORE INSERT OR UPDATE ON public.court_cases
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_deletion_user_reference('creator_user_id');
CREATE TRIGGER guard_delete_court_participants
  BEFORE INSERT OR UPDATE ON public.court_participants
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_deletion_user_reference('user_id');
CREATE TRIGGER guard_delete_court_invite_consumers
  BEFORE INSERT OR UPDATE OF consumed_by_user_id ON public.court_invites
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_deletion_user_reference('consumed_by_user_id');
CREATE TRIGGER guard_delete_court_invite_rejecters
  BEFORE INSERT OR UPDATE OF rejected_by_user_id ON public.court_invites
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_deletion_user_reference('rejected_by_user_id');
CREATE TRIGGER guard_delete_court_provider_reconcilers
  BEFORE INSERT OR UPDATE OF reconciled_by_user_id ON public.court_provider_reservations
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_deletion_user_reference('reconciled_by_user_id');
CREATE TRIGGER guard_delete_court_provider_audit_users
  BEFORE INSERT OR UPDATE OF audit_user_id ON public.court_provider_reservations
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_deletion_user_reference('audit_user_id');
CREATE TRIGGER guard_delete_court_public_reviewers
  BEFORE INSERT OR UPDATE OF reviewed_by_user_id ON public.court_public_posts
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_deletion_user_reference('reviewed_by_user_id');
CREATE TRIGGER guard_delete_court_votes
  BEFORE INSERT OR UPDATE ON public.court_votes
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_deletion_user_reference('user_id');
CREATE TRIGGER guard_delete_court_comments
  BEFORE INSERT OR UPDATE ON public.court_comments
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_deletion_user_reference('user_id');
CREATE TRIGGER guard_delete_court_comment_reviewers
  BEFORE INSERT OR UPDATE OF reviewed_by_user_id ON public.court_comments
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_deletion_user_reference('reviewed_by_user_id');
CREATE TRIGGER guard_delete_court_reporters
  BEFORE INSERT OR UPDATE ON public.court_reports
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_deletion_user_reference('reporter_user_id');
CREATE TRIGGER guard_delete_court_report_reviewers
  BEFORE INSERT OR UPDATE OF reviewed_by_user_id ON public.court_reports
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_deletion_user_reference('reviewed_by_user_id');

CREATE OR REPLACE FUNCTION public.is_court_participant(p_case_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.court_participants AS participant
    JOIN public.profiles AS profile ON profile.id = participant.user_id
    WHERE participant.case_id = p_case_id
      AND participant.user_id = auth.uid()
      AND participant.participation_status = 'active'
      AND profile.account_deleting_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.is_court_statement_owner(
  p_case_id uuid,
  p_participant_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.court_participants AS participant
    JOIN public.profiles AS profile ON profile.id = participant.user_id
    WHERE participant.id = p_participant_id
      AND participant.case_id = p_case_id
      AND participant.user_id = auth.uid()
      AND participant.participation_status = 'active'
      AND profile.account_deleting_at IS NULL
  );
$$;

ALTER FUNCTION public.is_court_participant(uuid) OWNER TO postgres;
ALTER FUNCTION public.is_court_statement_owner(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_court_participant(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_court_statement_owner(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_court_participant(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_court_statement_owner(uuid, uuid) TO authenticated, service_role;

ALTER TABLE public.court_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.court_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.court_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.court_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.court_verdicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.court_provider_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.court_missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.court_mission_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.court_followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.court_case_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.court_public_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.court_public_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.court_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.court_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.court_reports ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'court_cases', 'court_participants', 'court_invites', 'court_statements',
    'court_verdicts', 'court_provider_reservations', 'court_missions',
    'court_mission_completions',
    'court_followups', 'court_case_events', 'court_public_posts',
    'court_public_consents', 'court_votes', 'court_comments', 'court_reports'
  ]
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated',
      v_table
    );
    EXECUTE pg_catalog.format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role',
      v_table
    );
    EXECUTE pg_catalog.format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      v_table || '_service_role_all',
      v_table
    );
  END LOOP;
END;
$$;

GRANT SELECT ON TABLE public.court_statements TO authenticated;
-- Verdicts and missions intentionally remain service-only. A solo provisional
-- verdict must not become directly readable by a newly invited partner before
-- that partner submits and a new formal verdict is generated.
GRANT SELECT ON TABLE public.court_followups TO authenticated;
GRANT SELECT ON TABLE public.court_public_consents TO authenticated;
GRANT SELECT ON TABLE public.court_votes TO authenticated;
GRANT SELECT ON TABLE public.court_comments TO authenticated;
GRANT SELECT ON TABLE public.court_reports TO authenticated;

CREATE POLICY court_statements_owner_select
  ON public.court_statements FOR SELECT TO authenticated
  USING (public.is_court_statement_owner(case_id, participant_id));
CREATE POLICY court_followups_owner_select
  ON public.court_followups FOR SELECT TO authenticated
  USING (public.is_court_statement_owner(case_id, participant_id));
CREATE POLICY court_public_consents_owner_select
  ON public.court_public_consents FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.court_participants AS participant
      WHERE participant.id = participant_id
        AND participant.user_id = auth.uid()
    )
  );
CREATE POLICY court_votes_owner_select
  ON public.court_votes FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY court_comments_owner_select
  ON public.court_comments FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY court_reports_owner_select
  ON public.court_reports FOR SELECT TO authenticated
  USING (reporter_user_id = auth.uid());

CREATE OR REPLACE VIEW public.court_public_feed
WITH (security_barrier = true)
AS
SELECT
  post.id,
  post.sanitized_snapshot_json,
  post.snapshot_hash,
  post.snapshot_version,
  post.sanitized_snapshot_json ->> 'category' AS category,
  post.sanitized_snapshot_json ->> 'tone' AS tone,
  post.sanitized_snapshot_json ->> 'mode' AS mode,
  post.comments_enabled,
  (
    SELECT pg_catalog.count(*)
    FROM public.court_votes AS vote
    WHERE vote.public_post_id = post.id
  ) AS vote_count,
  (
    SELECT pg_catalog.jsonb_build_object(
      'applicant_more_at_fault', pg_catalog.count(*) FILTER (
        WHERE vote.choice = 'applicant_more_at_fault'
      ),
      'partner_more_at_fault', pg_catalog.count(*) FILTER (
        WHERE vote.choice = 'partner_more_at_fault'
      ),
      'both_need_change', pg_catalog.count(*) FILTER (
        WHERE vote.choice = 'both_need_change'
      ),
      'need_more_info', pg_catalog.count(*) FILTER (
        WHERE vote.choice = 'need_more_info'
      )
    )
    FROM public.court_votes AS vote
    WHERE vote.public_post_id = post.id
  ) AS vote_counts,
  (
    SELECT pg_catalog.count(*)
    FROM public.court_comments AS comment
    WHERE comment.public_post_id = post.id
      AND comment.moderation_status = 'visible'
      AND comment.deleted_at IS NULL
  ) AS comment_count,
  post.published_at,
  post.updated_at
FROM public.court_public_posts AS post
JOIN public.court_cases AS court_case ON court_case.id = post.case_id
WHERE post.status = 'published'
  AND post.safety_level = 'normal'
  AND post.moderation_status = 'approved'
  AND court_case.safety_level = 'normal'
  AND court_case.workflow_status <> 'archived';

CREATE OR REPLACE VIEW public.court_public_comment_feed
WITH (security_barrier = true)
AS
SELECT
  comment.id,
  comment.public_post_id,
  comment.comment_type,
  comment.body,
  comment.created_at,
  comment.updated_at
FROM public.court_comments AS comment
JOIN public.court_public_posts AS post ON post.id = comment.public_post_id
JOIN public.court_cases AS court_case ON court_case.id = post.case_id
WHERE post.status = 'published'
  AND post.safety_level = 'normal'
  AND post.moderation_status = 'approved'
  AND court_case.safety_level = 'normal'
  AND court_case.workflow_status <> 'archived'
  AND post.comments_enabled
  AND comment.moderation_status = 'visible'
  AND comment.deleted_at IS NULL;

ALTER VIEW public.court_public_feed OWNER TO postgres;
ALTER VIEW public.court_public_comment_feed OWNER TO postgres;
REVOKE ALL ON TABLE public.court_public_feed FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.court_public_comment_feed FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.court_public_feed TO anon, authenticated, service_role;
GRANT SELECT ON TABLE public.court_public_comment_feed TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_court_case_with_applicant(
  p_user_id uuid,
  p_creation_request_id uuid,
  p_mode text,
  p_category text,
  p_tone text,
  p_title text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_couple_id uuid;
  v_case_id uuid;
  v_participant_id uuid;
  v_existing_case public.court_cases%ROWTYPE;
  v_title text;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  v_title := pg_catalog.btrim(COALESCE(p_title, ''));
  IF p_user_id IS NULL OR p_creation_request_id IS NULL
    OR p_mode IS NULL OR p_mode NOT IN ('solo', 'couple')
    OR p_category IS NULL OR p_category NOT IN (
      'budget', 'planning_roles', 'venue', 'studio_dress_makeup',
      'family', 'guests_invitations', 'honeymoon', 'home_setup',
      'communication', 'formalwear_shooting', 'ceremony_events', 'other'
    )
    OR p_tone IS NULL OR p_tone NOT IN ('gentle', 'practical', 'spicy')
    OR pg_catalog.char_length(v_title) NOT BETWEEN 1 AND 120
  THEN
    RAISE EXCEPTION 'invalid court case arguments' USING ERRCODE = '22023';
  END IF;

  SELECT profile.couple_id
  INTO v_couple_id
  FROM public.profiles AS profile
  WHERE profile.id = p_user_id
    AND profile.account_deleting_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active court user is required' USING ERRCODE = '42501';
  END IF;

  SELECT court_case.* INTO v_existing_case
  FROM public.court_cases AS court_case
  WHERE court_case.creator_user_id = p_user_id
    AND court_case.creation_request_id = p_creation_request_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing_case.origin_mode IS DISTINCT FROM p_mode
      OR v_existing_case.category IS DISTINCT FROM p_category
      OR v_existing_case.tone IS DISTINCT FROM p_tone
      OR v_existing_case.title IS DISTINCT FROM v_title
    THEN
      RAISE EXCEPTION 'court_case_creation_request_mismatch'
        USING ERRCODE = '42501';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'case_id', v_existing_case.id,
      'status', v_existing_case.workflow_status,
      'reused', true
    );
  END IF;

  INSERT INTO public.court_cases (
    creator_user_id, creation_request_id, couple_id, origin_couple_id, mode, origin_mode,
    category, tone, title,
    workflow_status, safety_level, safety_review_status
  ) VALUES (
    p_user_id, p_creation_request_id, v_couple_id, v_couple_id,
    p_mode, p_mode, p_category, p_tone,
    v_title, 'awaiting_applicant_statement',
    'normal', 'none'
  )
  RETURNING id INTO v_case_id;

  INSERT INTO public.court_participants (case_id, user_id, role)
  VALUES (v_case_id, p_user_id, 'applicant')
  RETURNING id INTO v_participant_id;

  INSERT INTO public.court_case_events (
    case_id, actor_participant_id, event_type, metadata
  ) VALUES (
    v_case_id,
    v_participant_id,
    'case_created',
    pg_catalog.jsonb_build_object(
      'mode', p_mode,
      'category', p_category,
      'tone', p_tone,
      'to_status', 'awaiting_applicant_statement'
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'case_id', v_case_id,
    'status', 'awaiting_applicant_statement',
    'reused', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_court_statement(
  p_case_id uuid,
  p_user_id uuid,
  p_submission_request_id uuid,
  p_facts text,
  p_feelings text,
  p_expectations text,
  p_attempts text,
  p_desired_agreement text,
  p_safety_level text,
  p_safety_categories text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_case public.court_cases%ROWTYPE;
  v_participant public.court_participants%ROWTYPE;
  v_request_statement public.court_statements%ROWTYPE;
  v_latest_statement public.court_statements%ROWTYPE;
  v_revision integer;
  v_statement_id uuid;
  v_previous_status text;
  v_next_status text;
  v_has_previous boolean;
  v_safety_result jsonb;
  v_facts text;
  v_feelings text;
  v_expectations text;
  v_attempts text;
  v_desired_agreement text;
  v_submitted_safety_categories text[];
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;

  -- Persist and compare one canonical representation. This gives a caller
  -- that lost the first successful HTTP response a durable exact replay
  -- fence without allowing a different statement to reuse that response.
  v_facts := pg_catalog.btrim(COALESCE(p_facts, ''));
  v_feelings := pg_catalog.btrim(COALESCE(p_feelings, ''));
  v_expectations := pg_catalog.btrim(COALESCE(p_expectations, ''));
  v_attempts := pg_catalog.btrim(COALESCE(p_attempts, ''));
  v_desired_agreement := pg_catalog.btrim(COALESCE(p_desired_agreement, ''));
  SELECT COALESCE(
    pg_catalog.array_agg(DISTINCT category ORDER BY category),
    ARRAY[]::text[]
  )
  INTO v_submitted_safety_categories
  FROM pg_catalog.unnest(
    COALESCE(p_safety_categories, ARRAY[]::text[])
  ) AS submitted_category(category);

  IF p_case_id IS NULL OR p_user_id IS NULL OR p_submission_request_id IS NULL
    OR pg_catalog.char_length(v_facts) NOT BETWEEN 10 AND 4000
    OR pg_catalog.char_length(v_feelings) NOT BETWEEN 1 AND 2000
    OR pg_catalog.char_length(v_expectations) NOT BETWEEN 1 AND 2000
    OR pg_catalog.char_length(v_attempts) > 2000
    OR pg_catalog.char_length(v_desired_agreement) NOT BETWEEN 1 AND 2000
    OR p_safety_level IS NULL
    OR p_safety_level NOT IN ('normal', 'sensitive', 'high_risk')
    OR NOT public.court_safety_categories_are_valid(
      COALESCE(p_safety_categories, ARRAY[]::text[])
    )
  THEN
    RAISE EXCEPTION 'invalid court statement arguments' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.profiles AS profile
  WHERE profile.id = p_user_id AND profile.account_deleting_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active court user is required' USING ERRCODE = '42501';
  END IF;

  SELECT court_case.* INTO v_case
  FROM public.court_cases AS court_case
  WHERE court_case.id = p_case_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court case is unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT participant.* INTO v_participant
  FROM public.court_participants AS participant
  WHERE participant.case_id = p_case_id
    AND participant.user_id = p_user_id
    AND participant.participation_status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court participant is required' USING ERRCODE = '42501';
  END IF;

  SELECT statement.* INTO v_request_statement
  FROM public.court_statements AS statement
  WHERE statement.case_id = p_case_id
    AND statement.participant_id = v_participant.id
    AND statement.submission_request_id = p_submission_request_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_request_statement.facts IS DISTINCT FROM v_facts
      OR v_request_statement.feelings IS DISTINCT FROM v_feelings
      OR v_request_statement.expectations IS DISTINCT FROM v_expectations
      OR v_request_statement.attempts IS DISTINCT FROM v_attempts
      OR v_request_statement.desired_agreement IS DISTINCT FROM v_desired_agreement
      OR v_request_statement.submitted_safety_level IS DISTINCT FROM p_safety_level
      OR v_request_statement.submitted_safety_categories
        IS DISTINCT FROM v_submitted_safety_categories
    THEN
      RAISE EXCEPTION 'court_statement_submission_request_mismatch'
        USING ERRCODE = '42501';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'statement_id', v_request_statement.id,
      'revision', v_request_statement.revision,
      'case_id', p_case_id,
      'status', v_case.workflow_status,
      'safety_level', v_case.safety_level,
      'safety_categories', pg_catalog.to_jsonb(v_case.safety_categories),
      'reused', true
    );
  END IF;

  IF v_case.workflow_status = 'archived' THEN
    RAISE EXCEPTION 'court case is unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT statement.* INTO v_latest_statement
  FROM public.court_statements AS statement
  WHERE statement.case_id = p_case_id
    AND statement.participant_id = v_participant.id
  ORDER BY statement.revision DESC
  LIMIT 1
  FOR UPDATE;
  v_has_previous := FOUND;

  IF NOT v_has_previous THEN
    IF v_participant.role = 'applicant'
      AND v_case.workflow_status <> 'awaiting_applicant_statement'
    THEN
      RAISE EXCEPTION 'applicant statement is not expected in this state'
        USING ERRCODE = '22023';
    ELSIF v_participant.role = 'partner'
      AND v_case.workflow_status <> 'awaiting_partner_statement'
    THEN
      RAISE EXCEPTION 'partner statement is not expected in this state'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    -- A submitted statement is locked until a complete prior judgment exists.
    -- This prevents either side from changing their account after the other
    -- side submits but before judgment. One revision is allowed only from a
    -- post-verdict appeal state; submitting it moves the case out of that
    -- state, so another revision requires a new completed verdict first.
    IF v_case.workflow_status NOT IN ('verdict_ready', 'mission_active', 'resolved')
      OR NOT EXISTS (
        SELECT 1
        FROM public.court_verdicts AS verdict
        WHERE verdict.case_id = p_case_id
          AND verdict.generation_status = 'ready'
      )
    THEN
      RAISE EXCEPTION 'court_statement_locked'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT COALESCE(pg_catalog.max(statement.revision), 0) + 1
  INTO v_revision
  FROM public.court_statements AS statement
  WHERE statement.case_id = p_case_id
    AND statement.participant_id = v_participant.id;
  IF v_revision > 100 THEN
    RAISE EXCEPTION 'court statement revision limit reached' USING ERRCODE = '54000';
  END IF;

  INSERT INTO public.court_statements (
    case_id, participant_id, role, submission_request_id, revision, facts, feelings,
    expectations, attempts, desired_agreement,
    submitted_safety_level, submitted_safety_categories
  ) VALUES (
    p_case_id,
    v_participant.id,
    v_participant.role,
    p_submission_request_id,
    v_revision,
    v_facts,
    v_feelings,
    v_expectations,
    v_attempts,
    v_desired_agreement,
    p_safety_level,
    v_submitted_safety_categories
  )
  RETURNING id INTO v_statement_id;

  -- A submitted revision defines a new judgment generation. Likewise, the
  -- partner's first statement ends the solo provisional generation retained
  -- during the invite wait. Keep the prior result and missions as immutable
  -- history, but remove its shared action and mark the generation superseded
  -- before the workflow becomes statements_complete. Current-state queries
  -- and mission mutations below are scoped to the sole ready generation.
  IF v_has_previous OR v_participant.role = 'partner' THEN
    DELETE FROM public.amora_actions AS action
    USING public.court_missions AS mission,
          public.court_verdicts AS verdict
    WHERE verdict.case_id = p_case_id
      AND verdict.generation_status = 'ready'
      AND mission.verdict_id = verdict.id
      AND mission.amora_action_id = action.id
      AND action.source = 'court';

    UPDATE public.court_verdicts AS verdict
    SET generation_status = 'superseded',
        superseded_at = pg_catalog.clock_timestamp()
    WHERE verdict.case_id = p_case_id
      AND verdict.generation_status = 'ready';
  END IF;

  v_previous_status := v_case.workflow_status;
  IF NOT v_has_previous AND v_participant.role = 'applicant' THEN
    v_next_status := CASE WHEN v_case.mode = 'solo'
      THEN 'statements_complete' ELSE 'awaiting_partner' END;
  ELSIF NOT v_has_previous AND v_participant.role = 'partner' THEN
    v_next_status := 'statements_complete';
  ELSIF v_case.workflow_status IN ('awaiting_partner', 'awaiting_partner_statement') THEN
    v_next_status := v_case.workflow_status;
  ELSE
    v_next_status := 'statements_complete';
  END IF;

  UPDATE public.court_cases
  SET workflow_status = v_next_status,
      solo_provisional_verdict_id = CASE
        WHEN v_participant.role = 'partner' THEN NULL
        ELSE solo_provisional_verdict_id
      END,
      lock_version = lock_version + 1
  WHERE id = p_case_id;

  IF v_has_previous THEN
    UPDATE public.court_public_posts
    SET status = 'hidden', hidden_at = COALESCE(hidden_at, pg_catalog.clock_timestamp())
    WHERE case_id = p_case_id
      AND status IN ('awaiting_consents', 'pending_review', 'published');
    UPDATE public.court_public_consents AS consent
    SET revoked_at = COALESCE(consent.revoked_at, pg_catalog.clock_timestamp())
    FROM public.court_public_posts AS post
    WHERE post.case_id = p_case_id
      AND consent.public_post_id = post.id
      AND consent.revoked_at IS NULL;
  END IF;

  INSERT INTO public.court_case_events (
    case_id, actor_participant_id, event_type, metadata
  ) VALUES (
    p_case_id,
    v_participant.id,
    'statement_submitted',
    pg_catalog.jsonb_build_object(
      'role', v_participant.role,
      'revision', v_revision,
      'from_status', v_previous_status,
      'to_status', v_next_status
    )
  );

  -- Persist the statement and its safety classification in one database
  -- transaction. A route must never mark safety in a separate call because
  -- a crash between the calls can leave either the statement or escalation
  -- missing. The monotonic safety RPC re-locks this same case row safely.
  v_safety_result := public.mark_court_case_safety(
    p_case_id,
    p_user_id,
    p_safety_level,
    COALESCE(p_safety_categories, ARRAY[]::text[])
  );

  RETURN pg_catalog.jsonb_build_object(
    'statement_id', v_statement_id,
    'revision', v_revision,
    'case_id', p_case_id,
    'status', v_safety_result ->> 'status',
    'safety_level', v_safety_result ->> 'safety_level',
    'safety_categories', v_safety_result -> 'safety_categories',
    'reused', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_court_invite(
  p_case_id uuid,
  p_user_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_case public.court_cases%ROWTYPE;
  v_participant_id uuid;
  v_invite_id uuid;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_case_id IS NULL OR p_user_id IS NULL
    OR p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$'
    OR p_expires_at IS NULL
    OR p_expires_at <= pg_catalog.clock_timestamp()
    OR p_expires_at > pg_catalog.clock_timestamp() + interval '7 days'
  THEN
    RAISE EXCEPTION 'invalid court invite arguments' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.profiles AS profile
  WHERE profile.id = p_user_id AND profile.account_deleting_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active court user is required' USING ERRCODE = '42501';
  END IF;

  SELECT court_case.* INTO v_case
  FROM public.court_cases AS court_case
  WHERE court_case.id = p_case_id
  FOR UPDATE;
  IF NOT FOUND OR v_case.safety_level = 'high_risk'
    OR NOT (
      (v_case.mode = 'couple' AND v_case.workflow_status = 'awaiting_partner')
      OR (
        v_case.mode = 'solo'
        AND v_case.workflow_status IN ('verdict_ready', 'mission_active', 'resolved')
      )
    )
  THEN
    RAISE EXCEPTION 'court invite is unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT participant.id INTO v_participant_id
  FROM public.court_participants AS participant
  WHERE participant.case_id = p_case_id
    AND participant.user_id = p_user_id
    AND participant.role = 'applicant'
    AND participant.participation_status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'only the applicant can issue this invite' USING ERRCODE = '42501';
  END IF;

  IF v_case.mode = 'solo' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.court_verdicts AS verdict
      WHERE verdict.case_id = p_case_id AND verdict.generation_status = 'ready'
    ) THEN
      RAISE EXCEPTION 'a provisional verdict is required before inviting a partner'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE public.court_invites
  SET revoked_at = pg_catalog.clock_timestamp()
  WHERE case_id = p_case_id
    AND consumed_at IS NULL
    AND revoked_at IS NULL
    AND rejected_at IS NULL;

  INSERT INTO public.court_invites (
    case_id, issued_by_participant_id, token_hash, expires_at
  ) VALUES (
    p_case_id, v_participant_id, p_token_hash, p_expires_at
  )
  RETURNING id INTO v_invite_id;

  INSERT INTO public.court_case_events (
    case_id, actor_participant_id, event_type, metadata
  ) VALUES (
    p_case_id, v_participant_id, 'invite_issued',
    pg_catalog.jsonb_build_object(
      'role', 'partner',
      'mode', v_case.mode,
      'from_status', v_case.workflow_status,
      'to_status', v_case.workflow_status,
      'status', 'active'
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'invite_id', v_invite_id,
    'case_id', p_case_id,
    'expires_at', p_expires_at,
    'mode', v_case.mode,
    'status', v_case.workflow_status
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_court_invite(
  p_case_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_case public.court_cases%ROWTYPE;
  v_participant_id uuid;
  v_revoked_count integer := 0;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_case_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid court invite cancellation arguments'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.profiles AS profile
  WHERE profile.id = p_user_id
    AND profile.account_deleting_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active court user is required' USING ERRCODE = '42501';
  END IF;

  SELECT court_case.* INTO v_case
  FROM public.court_cases AS court_case
  WHERE court_case.id = p_case_id
  FOR UPDATE;
  IF NOT FOUND OR v_case.workflow_status = 'archived' THEN
    RAISE EXCEPTION 'court case is unavailable' USING ERRCODE = '42501';
  END IF;
  IF v_case.creator_user_id IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'only the court applicant can cancel an invite'
      USING ERRCODE = '42501';
  END IF;

  SELECT participant.id INTO v_participant_id
  FROM public.court_participants AS participant
  WHERE participant.case_id = p_case_id
    AND participant.user_id = p_user_id
    AND participant.role = 'applicant'
    AND participant.participation_status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active court applicant is required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.court_invites AS invite
  SET revoked_at = pg_catalog.clock_timestamp()
  WHERE invite.case_id = p_case_id
    AND invite.consumed_at IS NULL
    AND invite.revoked_at IS NULL
    AND invite.rejected_at IS NULL;
  GET DIAGNOSTICS v_revoked_count = ROW_COUNT;

  IF v_revoked_count > 0 THEN
    INSERT INTO public.court_case_events (
      case_id, actor_participant_id, event_type, metadata
    ) VALUES (
      p_case_id,
      v_participant_id,
      'invite_revoked',
      pg_catalog.jsonb_build_object('status', 'revoked')
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'case_id', p_case_id,
    'revoked', v_revoked_count > 0,
    'revoked_count', v_revoked_count,
    'status', CASE WHEN v_revoked_count > 0
      THEN 'revoked' ELSE 'no_active_invite' END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_court_invite(
  p_token_hash text,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_case_id uuid;
  v_case public.court_cases%ROWTYPE;
  v_invite public.court_invites%ROWTYPE;
  v_rejecter_couple_id uuid;
  v_rejected_at timestamptz;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid court invite rejection arguments' USING ERRCODE = '22023';
  END IF;

  SELECT profile.couple_id INTO v_rejecter_couple_id
  FROM public.profiles AS profile
  WHERE profile.id = p_user_id
    AND profile.account_deleting_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active court user is required' USING ERRCODE = '42501';
  END IF;

  SELECT invite.case_id INTO v_case_id
  FROM public.court_invites AS invite
  WHERE invite.token_hash = p_token_hash;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court_invite_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT court_case.* INTO v_case
  FROM public.court_cases AS court_case
  WHERE court_case.id = v_case_id
  FOR UPDATE;
  IF NOT FOUND OR v_case.workflow_status = 'archived' THEN
    RAISE EXCEPTION 'court_invite_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT invite.* INTO v_invite
  FROM public.court_invites AS invite
  WHERE invite.token_hash = p_token_hash
    AND invite.case_id = v_case_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court_invite_invalid' USING ERRCODE = '22023';
  ELSIF v_invite.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'court_invite_used' USING ERRCODE = '22023';
  ELSIF v_invite.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'court_invite_revoked' USING ERRCODE = '22023';
  ELSIF v_invite.rejected_at IS NOT NULL THEN
    IF v_invite.rejected_by_user_id = p_user_id THEN
      RETURN pg_catalog.jsonb_build_object(
        'case_id', v_case_id,
        'status', 'rejected',
        'rejected_at', v_invite.rejected_at,
        'reused', true
      );
    END IF;
    RAISE EXCEPTION 'court_invite_rejected' USING ERRCODE = '22023';
  ELSIF v_invite.expires_at <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'court_invite_expired' USING ERRCODE = '22023';
  END IF;

  IF v_case.creator_user_id = p_user_id THEN
    RAISE EXCEPTION 'court applicant cannot reject their own invite'
      USING ERRCODE = '42501';
  END IF;
  IF v_case.couple_id IS NOT NULL
    AND v_rejecter_couple_id IS DISTINCT FROM v_case.couple_id
  THEN
    RAISE EXCEPTION 'court_invite_couple_mismatch' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    (
      v_case.origin_mode = 'solo'
      AND v_case.mode = 'solo'
      AND v_case.workflow_status IN ('verdict_ready', 'mission_active', 'resolved')
    )
    OR (
      v_case.mode = 'couple'
      AND v_case.workflow_status = 'awaiting_partner'
    )
  ) THEN
    RAISE EXCEPTION 'court invite is unavailable' USING ERRCODE = '42501';
  END IF;

  v_rejected_at := pg_catalog.clock_timestamp();
  UPDATE public.court_invites
  SET rejected_at = v_rejected_at,
      rejected_by_user_id = p_user_id
  WHERE id = v_invite.id
    AND consumed_at IS NULL
    AND revoked_at IS NULL
    AND rejected_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court invite rejection changed concurrently'
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.court_case_events (
    case_id, actor_participant_id, event_type, metadata
  ) VALUES (
    v_case_id,
    NULL,
    'invite_rejected',
    pg_catalog.jsonb_build_object(
      'mode', v_case.mode,
      'from_status', v_case.workflow_status,
      'to_status', v_case.workflow_status,
      'status', 'rejected'
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'case_id', v_case_id,
    'status', 'rejected',
    'rejected_at', v_rejected_at,
    'reused', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_court_invite(
  p_token_hash text,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_case_id uuid;
  v_case public.court_cases%ROWTYPE;
  v_invite public.court_invites%ROWTYPE;
  v_applicant_user_id uuid;
  v_applicant_couple_id uuid;
  v_invitee_couple_id uuid;
  v_bound_couple_id uuid;
  v_existing_partner public.court_participants%ROWTYPE;
  v_participant_id uuid;
  v_provisional_verdict_id uuid;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid court invite claim arguments' USING ERRCODE = '22023';
  END IF;

  SELECT invite.case_id INTO v_case_id
  FROM public.court_invites AS invite
  WHERE invite.token_hash = p_token_hash;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court_invite_invalid' USING ERRCODE = '22023';
  END IF;

  -- Discover immutable identities without locks, then take the applicant
  -- profile before the case row. Applicant issue/cancel flows use that same
  -- order, avoiding a case -> applicant deadlock during concurrent accept.
  SELECT court_case.creator_user_id INTO v_applicant_user_id
  FROM public.court_cases AS court_case
  WHERE court_case.id = v_case_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court_invite_invalid' USING ERRCODE = '22023';
  END IF;

  -- Lock both account rows in UUID order so reciprocal cross-case accepts
  -- cannot deadlock while each user is the applicant of the other case.
  PERFORM profile.id
  FROM public.profiles AS profile
  WHERE profile.id IN (v_applicant_user_id, p_user_id)
    AND profile.account_deleting_at IS NULL
  ORDER BY profile.id
  FOR UPDATE;

  SELECT profile.couple_id INTO v_applicant_couple_id
  FROM public.profiles AS profile
  WHERE profile.id = v_applicant_user_id
    AND profile.account_deleting_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court invite applicant is unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT profile.couple_id INTO v_invitee_couple_id
  FROM public.profiles AS profile
  WHERE profile.id = p_user_id
    AND profile.account_deleting_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active court user is required' USING ERRCODE = '42501';
  END IF;

  SELECT court_case.* INTO v_case
  FROM public.court_cases AS court_case
  WHERE court_case.id = v_case_id
  FOR UPDATE;
  IF NOT FOUND OR v_case.creator_user_id IS DISTINCT FROM v_applicant_user_id THEN
    RAISE EXCEPTION 'court_invite_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT invite.* INTO v_invite
  FROM public.court_invites AS invite
  WHERE invite.token_hash = p_token_hash
    AND invite.case_id = v_case_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court_invite_invalid' USING ERRCODE = '22023';
  ELSIF v_invite.consumed_at IS NOT NULL THEN
    IF v_invite.consumed_by_user_id = p_user_id
      AND v_case.mode = 'couple'
    THEN
      SELECT participant.* INTO v_existing_partner
      FROM public.court_participants AS participant
      WHERE participant.case_id = v_case_id
        AND participant.user_id = p_user_id
        AND participant.role = 'partner'
        AND participant.participation_status = 'active'
      FOR UPDATE;
      IF FOUND THEN
        RETURN pg_catalog.jsonb_build_object(
          'case_id', v_case_id,
          'participant_id', v_existing_partner.id,
          'status', v_case.workflow_status,
          'reused', true
        );
      END IF;
    END IF;
    RAISE EXCEPTION 'court_invite_used' USING ERRCODE = '22023';
  ELSIF v_invite.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'court_invite_revoked' USING ERRCODE = '22023';
  ELSIF v_invite.rejected_at IS NOT NULL THEN
    RAISE EXCEPTION 'court_invite_rejected' USING ERRCODE = '22023';
  ELSIF v_invite.expires_at <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'court_invite_expired' USING ERRCODE = '22023';
  END IF;

  IF v_case.safety_level = 'high_risk'
    OR NOT (
      (
        v_case.origin_mode = 'solo'
        AND v_case.mode = 'solo'
        AND v_case.workflow_status IN ('verdict_ready', 'mission_active', 'resolved')
      )
      OR (
        v_case.mode = 'couple'
        AND v_case.workflow_status = 'awaiting_partner'
      )
    )
  THEN
    RAISE EXCEPTION 'court invite is unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT participant.user_id
  INTO v_applicant_user_id
  FROM public.court_participants AS participant
  WHERE participant.case_id = v_case_id
    AND participant.role = 'applicant'
    AND participant.participation_status = 'active'
  FOR UPDATE OF participant;
  IF NOT FOUND OR v_applicant_user_id = p_user_id THEN
    RAISE EXCEPTION 'court invite cannot be accepted by this user' USING ERRCODE = '42501';
  END IF;

  -- A case already bound to a real couple may only admit that couple's other
  -- active profile. An unbound case remains participant-private; it is bound
  -- only when both profiles independently prove the same non-null couple.
  IF v_case.couple_id IS NOT NULL THEN
    IF v_applicant_couple_id IS DISTINCT FROM v_case.couple_id
      OR v_invitee_couple_id IS DISTINCT FROM v_case.couple_id
    THEN
      RAISE EXCEPTION 'court_invite_couple_mismatch' USING ERRCODE = '42501';
    END IF;
    v_bound_couple_id := v_case.couple_id;
  ELSIF v_applicant_couple_id IS NOT NULL
    AND v_applicant_couple_id IS NOT DISTINCT FROM v_invitee_couple_id
  THEN
    v_bound_couple_id := v_applicant_couple_id;
  ELSIF v_applicant_couple_id IS NULL AND v_invitee_couple_id IS NULL THEN
    v_bound_couple_id := NULL;
  ELSE
    RAISE EXCEPTION 'court_invite_couple_mismatch' USING ERRCODE = '42501';
  END IF;

  SELECT participant.* INTO v_existing_partner
  FROM public.court_participants AS participant
  WHERE participant.case_id = v_case_id
    AND participant.role = 'partner'
    AND participant.participation_status = 'active'
  FOR UPDATE;

  IF FOUND THEN
    RAISE EXCEPTION 'court partner already exists' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.court_participants AS participant
    WHERE participant.case_id = v_case_id
      AND participant.user_id = p_user_id
      AND participant.participation_status = 'active'
  ) THEN
    RAISE EXCEPTION 'court invite cannot be accepted by this user' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.court_participants (case_id, user_id, role)
  VALUES (v_case_id, p_user_id, 'partner')
  RETURNING id INTO v_participant_id;

  IF v_case.origin_mode = 'solo' AND v_case.mode = 'solo' THEN
    SELECT verdict.id INTO v_provisional_verdict_id
    FROM public.court_verdicts AS verdict
    WHERE verdict.case_id = v_case_id
      AND verdict.generation_status = 'ready'
    ORDER BY verdict.generation_version DESC
    LIMIT 1
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'a provisional verdict is required before accepting a partner'
        USING ERRCODE = '22023';
    END IF;

    DELETE FROM public.amora_actions AS action
    USING public.court_missions AS mission
    WHERE mission.verdict_id = v_provisional_verdict_id
      AND mission.amora_action_id = action.id
      AND action.source = 'court';

    UPDATE public.court_verdicts
    SET generation_status = 'superseded',
        superseded_at = pg_catalog.clock_timestamp()
    WHERE id = v_provisional_verdict_id;
  END IF;

  UPDATE public.court_invites
  SET consumed_at = pg_catalog.clock_timestamp(),
      consumed_by_user_id = p_user_id
  WHERE id = v_invite.id;

  UPDATE public.court_cases
  SET couple_id = v_bound_couple_id,
      mode = 'couple',
      workflow_status = 'awaiting_partner_statement',
      solo_provisional_verdict_id = v_provisional_verdict_id,
      lock_version = lock_version + 1
  WHERE id = v_case_id;

  UPDATE public.court_public_posts
  SET status = 'hidden',
      hidden_at = COALESCE(hidden_at, pg_catalog.clock_timestamp())
  WHERE case_id = v_case_id
    AND status IN ('awaiting_consents', 'pending_review', 'published');
  UPDATE public.court_public_consents AS consent
  SET revoked_at = COALESCE(consent.revoked_at, pg_catalog.clock_timestamp())
  FROM public.court_public_posts AS post
  WHERE post.case_id = v_case_id
    AND consent.public_post_id = post.id
    AND consent.revoked_at IS NULL;

  INSERT INTO public.court_case_events (
    case_id, actor_participant_id, event_type, metadata
  ) VALUES (
    v_case_id, v_participant_id, 'invite_accepted',
    pg_catalog.jsonb_build_object(
      'role', 'partner',
      'from_status', v_case.workflow_status,
      'to_status', 'awaiting_partner_statement'
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'case_id', v_case_id,
    'participant_id', v_participant_id,
    'status', 'awaiting_partner_statement',
    'reused', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_court_case(
  p_case_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_case public.court_cases%ROWTYPE;
  v_partner public.court_participants%ROWTYPE;
  v_next_mode text;
  v_next_status text;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_case_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid court leave arguments' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.profiles AS profile
  WHERE profile.id = p_user_id
    AND profile.account_deleting_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active court user is required' USING ERRCODE = '42501';
  END IF;

  SELECT court_case.* INTO v_case
  FROM public.court_cases AS court_case
  WHERE court_case.id = p_case_id
  FOR UPDATE;
  IF NOT FOUND OR v_case.workflow_status = 'archived' THEN
    RAISE EXCEPTION 'court case is unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT participant.* INTO v_partner
  FROM public.court_participants AS participant
  WHERE participant.case_id = p_case_id
    AND participant.user_id = p_user_id
    AND participant.role = 'partner'
    AND participant.participation_status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    SELECT participant.* INTO v_partner
    FROM public.court_participants AS participant
    WHERE participant.case_id = p_case_id
      AND participant.user_id = p_user_id
      AND participant.role = 'partner'
      AND participant.participation_status = 'left'
    ORDER BY participant.left_at DESC
    LIMIT 1
    FOR UPDATE;

    IF FOUND
      AND NOT EXISTS (
        SELECT 1
        FROM public.court_participants AS active_partner
        WHERE active_partner.case_id = p_case_id
          AND active_partner.role = 'partner'
          AND active_partner.participation_status = 'active'
      )
      AND v_case.solo_provisional_verdict_id IS NULL
      AND (
        (
          v_case.origin_mode = 'solo'
          AND v_case.mode = 'solo'
          AND v_case.workflow_status IN ('verdict_ready', 'statements_complete')
        )
        OR (
          v_case.origin_mode = 'couple'
          AND v_case.mode = 'couple'
          AND v_case.workflow_status = 'awaiting_partner'
        )
      )
    THEN
      RETURN pg_catalog.jsonb_build_object(
        'case_id', p_case_id,
        'mode', v_case.mode,
        'status', v_case.workflow_status,
        'left', true,
        'reused', true
      );
    END IF;

    RAISE EXCEPTION 'active court partner is required' USING ERRCODE = '42501';
  END IF;

  IF v_case.mode <> 'couple'
    OR v_case.workflow_status <> 'awaiting_partner_statement'
    OR EXISTS (
      SELECT 1
      FROM public.court_statements AS statement
      WHERE statement.case_id = p_case_id
        AND statement.participant_id = v_partner.id
    )
    OR EXISTS (
      SELECT 1
      FROM public.court_verdicts AS verdict
      WHERE verdict.case_id = p_case_id
        AND verdict.generation_status = 'in_progress'
    )
  THEN
    RAISE EXCEPTION 'court_partner_leave_locked' USING ERRCODE = '42501';
  END IF;

  IF v_case.origin_mode = 'solo' THEN
    IF v_case.solo_provisional_verdict_id IS NULL THEN
      IF v_case.safety_level = 'normal' THEN
        RAISE EXCEPTION 'court solo provisional verdict cannot be restored'
          USING ERRCODE = '55000';
      END IF;
      -- An upward safety transition deliberately invalidates the playful
      -- provisional result. Restore the solo intake, but require a new safe
      -- judgment instead of reviving content generated under the old level.
      v_next_status := 'statements_complete';
    ELSE
      UPDATE public.court_verdicts AS verdict
      SET generation_status = 'ready',
          superseded_at = NULL
      WHERE verdict.id = v_case.solo_provisional_verdict_id
        AND verdict.case_id = p_case_id
        AND verdict.generation_status = 'superseded';
      IF NOT FOUND THEN
        RAISE EXCEPTION 'court solo provisional verdict cannot be restored'
          USING ERRCODE = '55000';
      END IF;
      v_next_status := 'verdict_ready';
    END IF;
    v_next_mode := 'solo';
  ELSE
    v_next_mode := 'couple';
    v_next_status := 'awaiting_partner';
  END IF;

  UPDATE public.court_participants
  SET participation_status = 'left',
      left_at = pg_catalog.clock_timestamp()
  WHERE id = v_partner.id;

  UPDATE public.court_cases
  SET couple_id = origin_couple_id,
      mode = v_next_mode,
      workflow_status = v_next_status,
      solo_provisional_verdict_id = NULL,
      lock_version = lock_version + 1
  WHERE id = p_case_id;

  UPDATE public.court_invites
  SET revoked_at = COALESCE(revoked_at, pg_catalog.clock_timestamp())
  WHERE case_id = p_case_id
    AND consumed_at IS NULL
    AND revoked_at IS NULL
    AND rejected_at IS NULL;

  INSERT INTO public.court_case_events (
    case_id, actor_participant_id, event_type, metadata
  ) VALUES (
    p_case_id,
    v_partner.id,
    'participant_left',
    pg_catalog.jsonb_build_object(
      'role', 'partner',
      'mode', v_next_mode,
      'from_status', v_case.workflow_status,
      'to_status', v_next_status,
      'status', 'left'
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'case_id', p_case_id,
    'mode', v_next_mode,
    'status', v_next_status,
    'left', true,
    'reused', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_court_case_safety(
  p_case_id uuid,
  p_user_id uuid,
  p_level text,
  p_categories text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_case public.court_cases%ROWTYPE;
  v_participant_id uuid;
  v_current_rank integer;
  v_next_rank integer;
  v_effective_level text;
  v_categories text[];
  v_previous_status text;
  v_next_status text;
  v_terminated_verdict_count integer := 0;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_case_id IS NULL OR p_user_id IS NULL OR p_level IS NULL
    OR p_level NOT IN ('normal', 'sensitive', 'high_risk')
    OR NOT public.court_safety_categories_are_valid(COALESCE(p_categories, ARRAY[]::text[]))
  THEN
    RAISE EXCEPTION 'invalid court safety arguments' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.profiles AS profile
  WHERE profile.id = p_user_id AND profile.account_deleting_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active court user is required' USING ERRCODE = '42501';
  END IF;

  SELECT court_case.* INTO v_case
  FROM public.court_cases AS court_case
  WHERE court_case.id = p_case_id
  FOR UPDATE;
  IF NOT FOUND OR v_case.workflow_status = 'archived' THEN
    RAISE EXCEPTION 'court case is unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT participant.id INTO v_participant_id
  FROM public.court_participants AS participant
  WHERE participant.case_id = p_case_id
    AND participant.user_id = p_user_id
    AND participant.participation_status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court participant is required' USING ERRCODE = '42501';
  END IF;

  v_current_rank := CASE v_case.safety_level
    WHEN 'normal' THEN 0 WHEN 'sensitive' THEN 1 ELSE 2 END;
  v_next_rank := CASE p_level
    WHEN 'normal' THEN 0 WHEN 'sensitive' THEN 1 ELSE 2 END;
  v_effective_level := CASE GREATEST(v_current_rank, v_next_rank)
    WHEN 0 THEN 'normal'
    WHEN 1 THEN 'sensitive'
    ELSE 'high_risk'
  END;

  v_previous_status := v_case.workflow_status;
  v_next_status := CASE
    WHEN (
        v_effective_level = 'high_risk'
        OR (
          v_case.safety_level = 'normal'
          AND v_effective_level = 'sensitive'
        )
      )
      AND v_case.workflow_status IN (
        'judging', 'verdict_ready', 'mission_active', 'resolved'
      )
      THEN 'statements_complete'
    ELSE v_case.workflow_status
  END;

  SELECT COALESCE(pg_catalog.array_agg(DISTINCT category ORDER BY category), ARRAY[]::text[])
  INTO v_categories
  FROM pg_catalog.unnest(
    COALESCE(v_case.safety_categories, ARRAY[]::text[])
      || COALESCE(p_categories, ARRAY[]::text[])
  ) AS safety_category(category);

  UPDATE public.court_cases
  SET safety_level = v_effective_level,
      safety_review_status = CASE
        WHEN v_effective_level = 'high_risk' AND v_case.safety_level <> 'high_risk'
          THEN 'pending'
        WHEN v_effective_level = 'high_risk' THEN v_case.safety_review_status
        ELSE 'none'
      END,
      safety_categories = v_categories,
      workflow_status = v_next_status,
      lock_version = lock_version + 1
  WHERE id = p_case_id;

  -- Any upward transition out of normal invalidates work generated under the
  -- playful/normal contract. Fence an active lease and its provider ledger.
  -- Sensitive cases retain prior generations as service-only history but no
  -- ready generation; high-risk cases erase generated content entirely.
  IF v_effective_level = 'high_risk'
    OR (v_case.safety_level = 'normal' AND v_effective_level = 'sensitive')
  THEN
    PERFORM public.settle_court_provider_failure(
      verdict.id,
      CASE WHEN v_effective_level = 'high_risk'
        THEN 'safety_high_risk' ELSE 'safety_level_changed' END
    )
    FROM public.court_verdicts AS verdict
    WHERE verdict.case_id = p_case_id
      AND verdict.generation_status = 'in_progress';

    UPDATE public.court_verdicts AS verdict
    SET generation_status = 'failed',
        terminal_lease_token = verdict.lease_token,
        lease_token = NULL,
        lease_expires_at = NULL,
        result_json = NULL,
        completed_at = NULL,
        failed_at = pg_catalog.clock_timestamp(),
        error_code = CASE WHEN v_effective_level = 'high_risk'
          THEN 'safety_high_risk' ELSE 'safety_level_changed' END
    WHERE verdict.case_id = p_case_id
      AND verdict.generation_status = 'in_progress';
    GET DIAGNOSTICS v_terminated_verdict_count = ROW_COUNT;

    DELETE FROM public.amora_actions AS action
    USING public.court_missions AS mission,
          public.court_verdicts AS verdict
    WHERE verdict.case_id = p_case_id
      AND verdict.generation_status IN ('ready', 'superseded')
      AND mission.verdict_id = verdict.id
      AND mission.amora_action_id = action.id
      AND action.source = 'court';

    IF v_effective_level = 'high_risk' THEN
      DELETE FROM public.court_verdicts AS verdict
      WHERE verdict.case_id = p_case_id
        AND verdict.generation_status IN ('ready', 'superseded');
    ELSE
      DELETE FROM public.court_missions AS mission
      USING public.court_verdicts AS verdict
      WHERE verdict.case_id = p_case_id
        AND verdict.generation_status IN ('ready', 'superseded')
        AND mission.verdict_id = verdict.id;

      UPDATE public.court_verdicts AS verdict
      SET generation_status = 'superseded',
          result_json = public.court_redacted_verdict_result('sensitive'),
          superseded_at = COALESCE(
            verdict.superseded_at,
            pg_catalog.clock_timestamp()
          )
      WHERE verdict.case_id = p_case_id
        AND verdict.generation_status IN ('ready', 'superseded');
    END IF;

    UPDATE public.court_cases
    SET solo_provisional_verdict_id = NULL
    WHERE id = p_case_id
      AND solo_provisional_verdict_id IS NOT NULL;
  END IF;

  IF v_effective_level = 'high_risk' THEN
    UPDATE public.court_invites
    SET revoked_at = COALESCE(revoked_at, pg_catalog.clock_timestamp())
    WHERE case_id = p_case_id
      AND consumed_at IS NULL
      AND revoked_at IS NULL
      AND rejected_at IS NULL;
  END IF;

  -- Public snapshots are permitted only while the private case remains
  -- normal. Delete the snapshot graph on escalation so sanitized but still
  -- case-derived content is not retained beyond the documented purpose.
  IF v_effective_level <> 'normal' THEN
    DELETE FROM public.court_public_posts
    WHERE case_id = p_case_id;
  END IF;

  INSERT INTO public.court_case_events (
    case_id, actor_participant_id, event_type, metadata
  ) VALUES (
    p_case_id, v_participant_id, 'safety_changed',
    pg_catalog.jsonb_build_object(
      'safety_level', v_effective_level,
      'safety_categories', pg_catalog.to_jsonb(v_categories),
      'from_status', v_previous_status,
      'to_status', v_next_status,
      'status', CASE WHEN v_effective_level = 'high_risk' THEN 'judgment_blocked' ELSE 'recorded' END
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'case_id', p_case_id,
    'safety_level', v_effective_level,
    'safety_categories', pg_catalog.to_jsonb(v_categories),
    'status', v_next_status,
    'terminated_verdict_count', v_terminated_verdict_count
  );
END;
$$;

-- AI preflight is a dominant safety transition. It serializes on the case,
-- raises the orthogonal safety axis, fences every active generation lease,
-- and withdraws all publication consent in the same transaction.
CREATE OR REPLACE FUNCTION public.escalate_court_case_safety_from_ai_preflight(
  p_case_id uuid,
  p_user_id uuid,
  p_categories text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_case public.court_cases%ROWTYPE;
  v_participant_id uuid;
  v_categories text[];
  v_next_status text;
  v_terminated_verdict_count integer := 0;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_case_id IS NULL OR p_user_id IS NULL
    OR NOT public.court_safety_categories_are_valid(
      COALESCE(p_categories, ARRAY[]::text[])
    )
  THEN
    RAISE EXCEPTION 'invalid court AI safety escalation arguments'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.profiles AS profile
  WHERE profile.id = p_user_id
    AND profile.account_deleting_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active court user is required' USING ERRCODE = '42501';
  END IF;

  SELECT court_case.* INTO v_case
  FROM public.court_cases AS court_case
  WHERE court_case.id = p_case_id
  FOR UPDATE;
  IF NOT FOUND OR v_case.workflow_status = 'archived' THEN
    RAISE EXCEPTION 'court case is unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT participant.id INTO v_participant_id
  FROM public.court_participants AS participant
  WHERE participant.case_id = p_case_id
    AND participant.user_id = p_user_id
    AND participant.participation_status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court participant is required' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(
    pg_catalog.array_agg(DISTINCT category ORDER BY category),
    ARRAY[]::text[]
  )
  INTO v_categories
  FROM pg_catalog.unnest(
    COALESCE(v_case.safety_categories, ARRAY[]::text[])
      || COALESCE(p_categories, ARRAY[]::text[])
  ) AS safety_category(category);

  v_next_status := CASE WHEN v_case.workflow_status IN (
      'judging', 'verdict_ready', 'mission_active', 'resolved'
    )
    THEN 'statements_complete' ELSE v_case.workflow_status END;

  PERFORM public.settle_court_provider_failure(
    verdict.id,
    'safety_high_risk'
  )
  FROM public.court_verdicts AS verdict
  WHERE verdict.case_id = p_case_id
    AND verdict.generation_status = 'in_progress';

  UPDATE public.court_verdicts AS verdict
  SET generation_status = 'failed',
      terminal_lease_token = verdict.lease_token,
      lease_token = NULL,
      lease_expires_at = NULL,
      result_json = NULL,
      completed_at = NULL,
      failed_at = pg_catalog.clock_timestamp(),
      error_code = 'safety_high_risk'
  WHERE verdict.case_id = p_case_id
    AND verdict.generation_status = 'in_progress';
  GET DIAGNOSTICS v_terminated_verdict_count = ROW_COUNT;

  DELETE FROM public.court_verdicts AS verdict
  WHERE verdict.case_id = p_case_id
    AND verdict.generation_status IN ('ready', 'superseded');

  UPDATE public.court_cases
  SET safety_level = 'high_risk',
      safety_review_status = 'pending',
      safety_categories = v_categories,
      workflow_status = v_next_status,
      lock_version = lock_version + 1
  WHERE id = p_case_id;

  UPDATE public.court_invites
  SET revoked_at = COALESCE(revoked_at, pg_catalog.clock_timestamp())
  WHERE case_id = p_case_id
    AND consumed_at IS NULL
    AND revoked_at IS NULL
    AND rejected_at IS NULL;

  DELETE FROM public.court_public_posts
  WHERE case_id = p_case_id;

  INSERT INTO public.court_case_events (
    case_id, actor_participant_id, event_type, metadata
  ) VALUES (
    p_case_id,
    v_participant_id,
    'safety_changed',
    pg_catalog.jsonb_build_object(
      'safety_level', 'high_risk',
      'safety_categories', pg_catalog.to_jsonb(v_categories),
      'from_status', v_case.workflow_status,
      'to_status', v_next_status,
      'reason_code', 'ai_preflight',
      'status', 'judgment_blocked'
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'case_id', p_case_id,
    'safety_level', 'high_risk',
    'safety_categories', pg_catalog.to_jsonb(v_categories),
    'status', v_next_status,
    'terminated_verdict_count', v_terminated_verdict_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_court_case(
  p_case_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_case public.court_cases%ROWTYPE;
  v_participant_id uuid;
  v_terminated_verdict_count integer := 0;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_case_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid court archive arguments' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.profiles AS profile
  WHERE profile.id = p_user_id AND profile.account_deleting_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active court user is required' USING ERRCODE = '42501';
  END IF;

  SELECT court_case.* INTO v_case
  FROM public.court_cases AS court_case
  WHERE court_case.id = p_case_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court case is unavailable' USING ERRCODE = '42501';
  END IF;

  IF v_case.creator_user_id IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'only the court applicant can archive a case' USING ERRCODE = '42501';
  END IF;

  SELECT participant.id INTO v_participant_id
  FROM public.court_participants AS participant
  WHERE participant.case_id = p_case_id
    AND participant.user_id = p_user_id
    AND participant.role = 'applicant'
    AND participant.participation_status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active court applicant is required' USING ERRCODE = '42501';
  END IF;

  -- Archive is terminal for an active generation. Settle before changing the
  -- workflow so a started/staged paid call stays counted but cannot strand a
  -- private payload, while a reservation that never crossed the provider
  -- boundary is refunded by the same settlement helper.
  PERFORM public.settle_court_provider_failure(verdict.id, 'court_archived')
  FROM public.court_verdicts AS verdict
  WHERE verdict.case_id = p_case_id
    AND verdict.generation_status = 'in_progress';

  UPDATE public.court_verdicts AS verdict
  SET generation_status = 'failed',
      result_json = NULL,
      terminal_lease_token = verdict.lease_token,
      lease_token = NULL,
      lease_expires_at = NULL,
      completed_at = NULL,
      failed_at = pg_catalog.clock_timestamp(),
      superseded_at = NULL,
      error_code = 'court_archived'
  WHERE verdict.case_id = p_case_id
    AND verdict.generation_status = 'in_progress';
  GET DIAGNOSTICS v_terminated_verdict_count = ROW_COUNT;

  IF v_case.workflow_status <> 'archived' THEN
    UPDATE public.court_cases
    SET workflow_status = 'archived',
        archived_at = pg_catalog.clock_timestamp(),
        lock_version = lock_version + 1
    WHERE id = p_case_id;

    UPDATE public.court_invites
    SET revoked_at = COALESCE(revoked_at, pg_catalog.clock_timestamp())
    WHERE case_id = p_case_id
      AND consumed_at IS NULL
      AND revoked_at IS NULL
      AND rejected_at IS NULL;

    UPDATE public.court_public_posts
    SET status = 'hidden', hidden_at = COALESCE(hidden_at, pg_catalog.clock_timestamp())
    WHERE case_id = p_case_id
      AND status IN ('awaiting_consents', 'pending_review', 'published');

    UPDATE public.court_public_consents AS consent
    SET revoked_at = COALESCE(consent.revoked_at, pg_catalog.clock_timestamp())
    FROM public.court_public_posts AS post
    WHERE post.case_id = p_case_id
      AND consent.public_post_id = post.id
      AND consent.revoked_at IS NULL;

    INSERT INTO public.court_case_events (
      case_id, actor_participant_id, event_type, metadata
    ) VALUES (
      p_case_id, v_participant_id, 'case_archived',
      pg_catalog.jsonb_build_object(
        'from_status', v_case.workflow_status,
        'to_status', 'archived'
      )
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'case_id', p_case_id,
    'status', 'archived',
    'terminated_verdict_count', v_terminated_verdict_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_court_case(
  p_case_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_case public.court_cases%ROWTYPE;
  v_participant_id uuid;
  v_deleted_case_id uuid;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_case_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid court deletion arguments' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.profiles AS profile
  WHERE profile.id = p_user_id
    AND profile.account_deleting_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active court user is required' USING ERRCODE = '42501';
  END IF;

  SELECT court_case.* INTO v_case
  FROM public.court_cases AS court_case
  WHERE court_case.id = p_case_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court case is unavailable' USING ERRCODE = '42501';
  END IF;
  IF v_case.creator_user_id IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'only the court applicant can permanently delete a case'
      USING ERRCODE = '42501';
  END IF;
  IF v_case.workflow_status = 'judging' THEN
    RAISE EXCEPTION 'court_delete_requires_archive'
      USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.court_provider_reservations AS reservation
    WHERE reservation.case_id = p_case_id
      AND reservation.provider_audit_state = 'pending'
  ) THEN
    RAISE EXCEPTION 'court_provider_audit_pending'
      USING ERRCODE = '55000';
  END IF;

  SELECT participant.id INTO v_participant_id
  FROM public.court_participants AS participant
  WHERE participant.case_id = p_case_id
    AND participant.user_id = p_user_id
    AND participant.role = 'applicant'
    AND participant.participation_status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active court applicant is required' USING ERRCODE = '42501';
  END IF;

  IF v_case.mode = 'couple' AND EXISTS (
    SELECT 1
    FROM public.court_participants AS partner
    JOIN public.court_statements AS statement
      ON statement.case_id = partner.case_id
     AND statement.participant_id = partner.id
    WHERE partner.case_id = p_case_id
      AND partner.role = 'partner'
  ) THEN
    RAISE EXCEPTION 'court_delete_requires_joint_policy'
      USING ERRCODE = '42501';
  END IF;

  -- amora_actions points in the opposite FK direction. Delete every linked
  -- court-source action explicitly before cascading the complete private and
  -- public case graph. The table trigger remains defense in depth for direct
  -- administrative deletes and account-deletion cascades.
  DELETE FROM public.amora_actions AS action
  USING public.court_missions AS mission
  WHERE mission.case_id = p_case_id
    AND mission.amora_action_id = action.id
    AND action.source = 'court';

  DELETE FROM public.court_cases AS court_case
  WHERE court_case.id = p_case_id
  RETURNING court_case.id INTO v_deleted_case_id;
  IF v_deleted_case_id IS NULL THEN
    RAISE EXCEPTION 'court case deletion changed concurrently'
      USING ERRCODE = '40001';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'case_id', v_deleted_case_id,
    'deleted', true,
    'status', 'deleted'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_court_verdict(
  p_case_id uuid,
  p_user_id uuid,
  p_input_hash text,
  p_prompt_version text,
  p_schema_version text,
  p_model text,
  p_lease_seconds integer DEFAULT 120,
  p_allow_new_claim boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_case public.court_cases%ROWTYPE;
  v_participant_id uuid;
  v_verdict public.court_verdicts%ROWTYPE;
  v_statement_roles integer;
  v_lease_expires_at timestamptz;
  v_lease_token uuid;
  v_generation_version integer;
  v_attempt_count integer := 1;
  v_previous_model_mismatch boolean := false;
  v_provider_reservation public.court_provider_reservations%ROWTYPE;
  v_provider_settlement_state text;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_case_id IS NULL OR p_user_id IS NULL
    OR p_input_hash IS NULL OR p_input_hash !~ '^[a-f0-9]{64}$'
    OR p_prompt_version IS NULL OR p_prompt_version !~ '^[A-Za-z0-9._-]{1,64}$'
    OR p_schema_version IS NULL OR p_schema_version !~ '^[A-Za-z0-9._-]{1,64}$'
    OR p_model IS NULL
    OR p_model NOT IN ('gpt-5.6-terra', 'couple-court-development-mock-v1')
    OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 300
    OR p_allow_new_claim IS NULL
  THEN
    RAISE EXCEPTION 'invalid court verdict claim arguments' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.profiles AS profile
  WHERE profile.id = p_user_id AND profile.account_deleting_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active court user is required' USING ERRCODE = '42501';
  END IF;

  SELECT court_case.* INTO v_case
  FROM public.court_cases AS court_case
  WHERE court_case.id = p_case_id
  FOR UPDATE;
  IF NOT FOUND OR v_case.workflow_status = 'archived' OR v_case.safety_level = 'high_risk' THEN
    RAISE EXCEPTION 'court verdict is unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT participant.id INTO v_participant_id
  FROM public.court_participants AS participant
  WHERE participant.case_id = p_case_id
    AND participant.user_id = p_user_id
    AND participant.participation_status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court participant is required' USING ERRCODE = '42501';
  END IF;

  SELECT pg_catalog.count(DISTINCT statement.role)::integer
  INTO v_statement_roles
  FROM public.court_statements AS statement
  WHERE statement.case_id = p_case_id;
  IF (v_case.mode = 'solo' AND v_statement_roles <> 1)
    OR (v_case.mode = 'couple' AND v_statement_roles <> 2)
  THEN
    RAISE EXCEPTION 'all required court statements must be submitted'
      USING ERRCODE = '22023';
  END IF;

  -- A paid provider response is durable across deployments. Reclaim the
  -- case's active staged result before consulting the running release's
  -- prompt/schema/input/model identity; all of those values can legitimately
  -- change between the provider call and its audit/finalization retry.
  SELECT verdict.* INTO v_verdict
  FROM public.court_verdicts AS verdict
  JOIN public.court_provider_reservations AS reservation
    ON reservation.verdict_id = verdict.id
   AND reservation.case_id = verdict.case_id
  WHERE verdict.case_id = p_case_id
    AND verdict.generation_status = 'in_progress'
    AND reservation.provider_state = 'result_staged'
  ORDER BY verdict.generation_version DESC
  LIMIT 1
  FOR UPDATE OF verdict, reservation;

  IF FOUND THEN
    SELECT reservation.* INTO v_provider_reservation
    FROM public.court_provider_reservations AS reservation
    WHERE reservation.verdict_id = v_verdict.id
      AND reservation.case_id = v_verdict.case_id
    FOR UPDATE;

    IF NOT FOUND
      OR v_case.workflow_status <> 'judging'
      OR v_provider_reservation.provider_state <> 'result_staged'
      OR v_provider_reservation.case_id IS DISTINCT FROM p_case_id
      OR v_provider_reservation.input_hash IS DISTINCT FROM v_verdict.input_hash
      OR v_provider_reservation.staged_model IS DISTINCT FROM v_verdict.model
      OR v_provider_reservation.staged_at IS NULL
      OR v_provider_reservation.audit_model IS NULL
      OR v_provider_reservation.provider_audit_state NOT IN ('pending', 'audited')
      OR v_provider_reservation.staged_result_json IS NULL
      OR v_provider_reservation.staged_missions_json IS NULL
      OR NOT public.court_verdict_result_is_valid(
        v_provider_reservation.staged_result_json
      )
      OR NOT public.court_missions_json_is_valid(
        v_provider_reservation.staged_missions_json
      )
      OR v_provider_reservation.staged_result_json -> 'missions'
        IS DISTINCT FROM v_provider_reservation.staged_missions_json
    THEN
      RAISE EXCEPTION 'court_provider_staged_result_mismatch'
        USING ERRCODE = '42501';
    END IF;

    v_lease_expires_at := pg_catalog.clock_timestamp()
      + pg_catalog.make_interval(secs => p_lease_seconds);
    v_lease_token := pg_catalog.gen_random_uuid();
    UPDATE public.court_verdicts
    SET claimed_by_participant_id = v_participant_id,
        lease_expires_at = v_lease_expires_at,
        lease_token = v_lease_token
    WHERE id = v_verdict.id
      AND generation_status = 'in_progress';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'court staged verdict claim changed concurrently'
        USING ERRCODE = '40001';
    END IF;

    INSERT INTO public.court_case_events (
      case_id, actor_participant_id, event_type, metadata
    ) VALUES (
      p_case_id,
      v_participant_id,
      'verdict_claimed',
      pg_catalog.jsonb_build_object(
        'from_status', v_case.workflow_status,
        'to_status', 'judging',
        'status', 'staged'
      )
    );

    RETURN pg_catalog.jsonb_build_object(
      'verdict_id', v_verdict.id,
      'generation_version', v_verdict.generation_version,
      'claim_status', 'staged',
      'lease_token', v_lease_token,
      'lease_expires_at', v_lease_expires_at,
      'input_hash', v_verdict.input_hash,
      'prompt_version', v_verdict.prompt_version,
      'schema_version', v_verdict.schema_version,
      'staged_at', v_provider_reservation.staged_at,
      'request_key', v_provider_reservation.request_key,
      'audit_user_id', v_provider_reservation.audit_user_id,
      'audit_couple_id', v_provider_reservation.audit_couple_id,
      'audit_preflight_safety_level',
        v_provider_reservation.audit_preflight_safety_level,
      'audit_model', v_provider_reservation.audit_model,
      'provider_audit_state', v_provider_reservation.provider_audit_state,
      'result_json', v_provider_reservation.staged_result_json,
      'missions_json', v_provider_reservation.staged_missions_json,
      'model', v_provider_reservation.staged_model,
      'usage', pg_catalog.jsonb_build_object(
        'input_tokens', v_provider_reservation.provider_input_tokens,
        'output_tokens', v_provider_reservation.provider_output_tokens,
        'cached_input_tokens', v_provider_reservation.provider_cached_input_tokens,
        'cache_write_input_tokens',
          v_provider_reservation.provider_cache_write_input_tokens
      )
    );
  END IF;

  SELECT verdict.* INTO v_verdict
  FROM public.court_verdicts AS verdict
  WHERE verdict.case_id = p_case_id
    AND verdict.input_hash = p_input_hash
    AND verdict.prompt_version = p_prompt_version
    AND verdict.schema_version = p_schema_version
    AND verdict.generation_status IN ('in_progress', 'ready')
  ORDER BY verdict.generation_version DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF v_verdict.model IS DISTINCT FROM p_model THEN
      RAISE EXCEPTION 'court verdict model mismatch' USING ERRCODE = '22023';
    END IF;
    IF v_verdict.generation_status = 'ready' THEN
      RETURN pg_catalog.jsonb_build_object(
        'verdict_id', v_verdict.id,
        'generation_version', v_verdict.generation_version,
        'claim_status', 'replay',
        'result_json', v_verdict.result_json
      );
    END IF;
    SELECT reservation.* INTO v_provider_reservation
    FROM public.court_provider_reservations AS reservation
    WHERE reservation.verdict_id = v_verdict.id
    FOR UPDATE;
    IF v_verdict.generation_status = 'in_progress'
      AND v_verdict.lease_expires_at > pg_catalog.clock_timestamp()
    THEN
      RETURN pg_catalog.jsonb_build_object(
        'verdict_id', v_verdict.id,
        'generation_version', v_verdict.generation_version,
        'claim_status', 'in_progress',
        'result_json', NULL
      );
    END IF;
    IF v_provider_reservation.provider_state IN ('started', 'failed_unknown') THEN
      RAISE EXCEPTION 'court_provider_manual_reconciliation_required'
        USING ERRCODE = '55000';
    END IF;
    IF v_provider_reservation.provider_state IS NOT NULL
      AND v_provider_reservation.provider_state <> 'reserved'
    THEN
      RAISE EXCEPTION 'court_provider_attempt_terminal'
        USING ERRCODE = '55000';
    END IF;
    IF v_case.workflow_status NOT IN ('statements_complete', 'judging') THEN
      RAISE EXCEPTION 'court verdict cannot restart in this state'
        USING ERRCODE = '22023';
    END IF;
    IF v_verdict.attempt_count >= 10 THEN
      RAISE EXCEPTION 'court verdict retry limit reached' USING ERRCODE = '54000';
    END IF;
  ELSE
    -- A deployment can replace the prompt/schema identity after the previous
    -- process claimed a lease but before it crossed the provider boundary. A
    -- live lease still belongs to that process. Once it expires, only a claim
    -- with no reservation or an unstarted reservation is safe to retire. Paid
    -- or ambiguous calls remain blocked, and lookup-only callers never mutate
    -- the old attempt.
    IF v_case.workflow_status = 'judging' THEN
      SELECT verdict.* INTO v_verdict
      FROM public.court_verdicts AS verdict
      WHERE verdict.case_id = p_case_id
        AND verdict.generation_status = 'in_progress'
      ORDER BY verdict.generation_version DESC
      LIMIT 1
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'court verdict judging state has no active claim'
          USING ERRCODE = '55000';
      END IF;

      IF v_verdict.lease_expires_at > pg_catalog.clock_timestamp() THEN
        RETURN pg_catalog.jsonb_build_object(
          'verdict_id', v_verdict.id,
          'generation_version', v_verdict.generation_version,
          'claim_status', 'in_progress',
          'result_json', NULL
        );
      END IF;

      SELECT reservation.* INTO v_provider_reservation
      FROM public.court_provider_reservations AS reservation
      WHERE reservation.verdict_id = v_verdict.id
      FOR UPDATE;
      IF FOUND AND (
        v_provider_reservation.case_id IS DISTINCT FROM p_case_id
        OR v_provider_reservation.input_hash IS DISTINCT FROM v_verdict.input_hash
      ) THEN
        RAISE EXCEPTION 'court_provider_reservation_mismatch'
          USING ERRCODE = '42501';
      END IF;
      IF v_provider_reservation.provider_state IN ('started', 'failed_unknown') THEN
        RAISE EXCEPTION 'court_provider_manual_reconciliation_required'
          USING ERRCODE = '55000';
      END IF;
      IF v_provider_reservation.provider_state IS NOT NULL
        AND v_provider_reservation.provider_state <> 'reserved'
      THEN
        RAISE EXCEPTION 'court_provider_attempt_terminal'
          USING ERRCODE = '55000';
      END IF;

      IF NOT p_allow_new_claim THEN
        RETURN pg_catalog.jsonb_build_object(
          'verdict_id', v_verdict.id,
          'generation_version', v_verdict.generation_version,
          'claim_status', 'unavailable',
          'result_json', NULL
        );
      END IF;

      IF v_provider_reservation.provider_state = 'reserved' THEN
        v_provider_settlement_state := public.settle_court_provider_failure(
          v_verdict.id,
          'release_identity_changed_before_provider_start'
        );
        IF v_provider_settlement_state IS DISTINCT FROM 'failed_unstarted' THEN
          RAISE EXCEPTION 'court_provider_unstarted_settlement_failed'
            USING ERRCODE = '55000';
        END IF;
      END IF;

      UPDATE public.court_verdicts
      SET generation_status = 'failed',
          result_json = NULL,
          terminal_lease_token = lease_token,
          lease_token = NULL,
          lease_expires_at = NULL,
          completed_at = NULL,
          failed_at = pg_catalog.clock_timestamp(),
          superseded_at = NULL,
          error_code = 'release_identity_changed_before_provider_start'
      WHERE id = v_verdict.id
        AND generation_status = 'in_progress'
        AND lease_expires_at <= pg_catalog.clock_timestamp();
      IF NOT FOUND THEN
        RAISE EXCEPTION 'court cross-release verdict claim changed concurrently'
          USING ERRCODE = '40001';
      END IF;

      INSERT INTO public.court_case_events (
        case_id, actor_participant_id, event_type, metadata
      ) VALUES (
        p_case_id,
        v_participant_id,
        'verdict_failed',
        pg_catalog.jsonb_build_object(
          'from_status', 'judging',
          'to_status', 'judging',
          'reason_code', 'release_identity_changed_before_provider_start',
          'status', 'failed'
        )
      );

      -- Force the normal insert branch below; every other field is replaced by
      -- INSERT ... RETURNING before it can be observed again.
      v_verdict.id := NULL;
    ELSIF v_case.workflow_status <> 'statements_complete' THEN
      RAISE EXCEPTION 'court verdict cannot start in this state' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.court_verdicts AS failed_verdict
      JOIN public.court_provider_reservations AS reservation
        ON reservation.verdict_id = failed_verdict.id
       AND reservation.case_id = failed_verdict.case_id
      WHERE failed_verdict.case_id = p_case_id
        AND failed_verdict.input_hash = p_input_hash
        AND failed_verdict.prompt_version = p_prompt_version
        AND failed_verdict.schema_version = p_schema_version
        AND failed_verdict.generation_status = 'failed'
        AND reservation.provider_state = 'failed_unknown'
    ) THEN
      RAISE EXCEPTION 'court_provider_manual_reconciliation_required'
        USING ERRCODE = '55000';
    END IF;
    SELECT
      COALESCE(pg_catalog.max(verdict.attempt_count), 0) + 1,
      COALESCE(pg_catalog.bool_or(verdict.model IS DISTINCT FROM p_model), false)
    INTO v_attempt_count, v_previous_model_mismatch
    FROM public.court_verdicts AS verdict
    WHERE verdict.case_id = p_case_id
      AND verdict.input_hash = p_input_hash
      AND verdict.prompt_version = p_prompt_version
      AND verdict.schema_version = p_schema_version
      AND verdict.generation_status = 'failed';
    IF v_previous_model_mismatch THEN
      RAISE EXCEPTION 'court verdict model mismatch' USING ERRCODE = '22023';
    END IF;
    IF v_attempt_count > 10 THEN
      RAISE EXCEPTION 'court verdict retry limit reached' USING ERRCODE = '54000';
    END IF;
  END IF;

  IF NOT p_allow_new_claim THEN
    RETURN pg_catalog.jsonb_build_object(
      'verdict_id', v_verdict.id,
      'generation_version', v_verdict.generation_version,
      'claim_status', 'unavailable',
      'result_json', NULL
    );
  END IF;

  v_lease_expires_at := pg_catalog.clock_timestamp()
    + pg_catalog.make_interval(secs => p_lease_seconds);
  v_lease_token := pg_catalog.gen_random_uuid();

  IF v_verdict.id IS NULL THEN
    SELECT COALESCE(pg_catalog.max(verdict.generation_version), 0) + 1
    INTO v_generation_version
    FROM public.court_verdicts AS verdict
    WHERE verdict.case_id = p_case_id;
    IF v_generation_version > 1000 THEN
      RAISE EXCEPTION 'court verdict generation version limit reached'
        USING ERRCODE = '54000';
    END IF;

    INSERT INTO public.court_verdicts (
      case_id, input_hash, prompt_version, schema_version, model, generation_version,
      generation_status, claimed_by_participant_id, lease_expires_at,
      lease_token, terminal_lease_token, attempt_count
    ) VALUES (
      p_case_id, p_input_hash, p_prompt_version, p_schema_version, p_model,
      v_generation_version,
      'in_progress', v_participant_id, v_lease_expires_at,
      v_lease_token, NULL, v_attempt_count
    )
    RETURNING * INTO v_verdict;
  ELSE
    UPDATE public.court_verdicts
    SET generation_status = 'in_progress',
        claimed_by_participant_id = v_participant_id,
        lease_expires_at = v_lease_expires_at,
        lease_token = v_lease_token,
        terminal_lease_token = NULL,
        attempt_count = attempt_count + 1,
        result_json = NULL,
        error_code = NULL,
        started_at = pg_catalog.clock_timestamp(),
        completed_at = NULL,
        failed_at = NULL,
        superseded_at = NULL
    WHERE id = v_verdict.id
    RETURNING * INTO v_verdict;
  END IF;

  UPDATE public.court_cases
  SET workflow_status = 'judging', lock_version = lock_version + 1
  WHERE id = p_case_id;

  INSERT INTO public.court_case_events (
    case_id, actor_participant_id, event_type, metadata
  ) VALUES (
    p_case_id, v_participant_id, 'verdict_claimed',
    pg_catalog.jsonb_build_object(
      'from_status', v_case.workflow_status,
      'to_status', 'judging',
      'status', 'in_progress'
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'verdict_id', v_verdict.id,
    'generation_version', v_verdict.generation_version,
    'claim_status', 'execute',
    'lease_token', v_lease_token,
    'result_json', NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_court_verdict_provider_call(
  p_verdict_id uuid,
  p_user_id uuid,
  p_lease_token uuid,
  p_input_hash text,
  p_request_key text,
  p_request_hash text,
  p_audit_preflight_safety_level text,
  p_couple_daily_cap integer DEFAULT 30,
  p_global_daily_cap integer DEFAULT 60
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_case_id uuid;
  v_case public.court_cases%ROWTYPE;
  v_verdict public.court_verdicts%ROWTYPE;
  v_participant_id uuid;
  v_profile_couple_id uuid;
  v_scope_id uuid;
  v_scope_kind text;
  v_existing public.court_provider_reservations%ROWTYPE;
  v_allowed boolean;
  v_reason text;
  v_remaining integer;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_verdict_id IS NULL OR p_user_id IS NULL OR p_lease_token IS NULL
    OR p_input_hash IS NULL OR p_input_hash !~ '^[a-f0-9]{64}$'
    OR p_request_key IS NULL OR p_request_key !~ '^[a-f0-9]{64}$'
    OR p_request_hash IS NULL OR p_request_hash !~ '^[a-f0-9]{64}$'
    OR p_audit_preflight_safety_level IS NULL
    OR p_audit_preflight_safety_level NOT IN ('normal', 'sensitive')
    OR p_couple_daily_cap IS NULL OR p_couple_daily_cap NOT BETWEEN 1 AND 30
    OR p_global_daily_cap IS NULL OR p_global_daily_cap NOT BETWEEN 1 AND 60
  THEN
    RAISE EXCEPTION 'invalid court provider reservation arguments'
      USING ERRCODE = '22023';
  END IF;

  SELECT profile.couple_id INTO v_profile_couple_id
  FROM public.profiles AS profile
  WHERE profile.id = p_user_id
    AND profile.account_deleting_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active court user is required' USING ERRCODE = '42501';
  END IF;

  SELECT verdict.case_id INTO v_case_id
  FROM public.court_verdicts AS verdict
  WHERE verdict.id = p_verdict_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court verdict is unavailable' USING ERRCODE = '22023';
  END IF;

  SELECT court_case.* INTO v_case
  FROM public.court_cases AS court_case
  WHERE court_case.id = v_case_id
  FOR UPDATE;
  IF NOT FOUND OR v_case.workflow_status <> 'judging'
    OR v_case.safety_level = 'high_risk'
    OR (
      v_case.safety_level = 'sensitive'
      AND p_audit_preflight_safety_level = 'normal'
    )
  THEN
    RAISE EXCEPTION 'court provider reservation is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT participant.id INTO v_participant_id
  FROM public.court_participants AS participant
  WHERE participant.case_id = v_case_id
    AND participant.user_id = p_user_id
    AND participant.participation_status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court participant is required' USING ERRCODE = '42501';
  END IF;

  SELECT verdict.* INTO v_verdict
  FROM public.court_verdicts AS verdict
  WHERE verdict.id = p_verdict_id
    AND verdict.case_id = v_case_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_verdict.generation_status <> 'in_progress'
    OR v_verdict.claimed_by_participant_id IS DISTINCT FROM v_participant_id
    OR v_verdict.lease_token IS DISTINCT FROM p_lease_token
    OR v_verdict.lease_expires_at <= pg_catalog.clock_timestamp()
    OR v_verdict.input_hash IS DISTINCT FROM p_input_hash
  THEN
    RAISE EXCEPTION 'court verdict claim is no longer valid' USING ERRCODE = '22023';
  END IF;

  IF v_case.couple_id IS NOT NULL THEN
    IF v_profile_couple_id IS DISTINCT FROM v_case.couple_id THEN
      RAISE EXCEPTION 'court provider scope changed' USING ERRCODE = '42501';
    END IF;
    IF v_case.mode = 'couple' AND (
      SELECT pg_catalog.count(*)
      FROM public.court_participants AS participant
      JOIN public.profiles AS profile ON profile.id = participant.user_id
      WHERE participant.case_id = v_case_id
        AND participant.participation_status = 'active'
        AND profile.account_deleting_at IS NULL
        AND profile.couple_id = v_case.couple_id
    ) <> 2 THEN
      RAISE EXCEPTION 'court provider couple scope is inconsistent'
        USING ERRCODE = '42501';
    END IF;
    v_scope_id := v_case.couple_id;
    v_scope_kind := 'couple';
  ELSE
    -- Unbound participant-private cases use the immutable applicant identity
    -- as a stable quota namespace. Never impersonate a different couple.
    v_scope_id := v_case.creator_user_id;
    v_scope_kind := 'user';
  END IF;

  SELECT reservation.* INTO v_existing
  FROM public.court_provider_reservations AS reservation
  WHERE reservation.verdict_id = p_verdict_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.case_id IS DISTINCT FROM v_case_id
      OR v_existing.input_hash IS DISTINCT FROM p_input_hash
      OR v_existing.request_key IS DISTINCT FROM p_request_key
      OR v_existing.request_hash IS DISTINCT FROM p_request_hash
      OR v_existing.quota_scope_id IS DISTINCT FROM v_scope_id
      OR v_existing.quota_scope_kind IS DISTINCT FROM v_scope_kind
      OR v_existing.audit_user_id IS DISTINCT FROM p_user_id
      OR v_existing.audit_couple_id IS DISTINCT FROM v_case.couple_id
      OR v_existing.audit_preflight_safety_level
        IS DISTINCT FROM p_audit_preflight_safety_level
    THEN
      RAISE EXCEPTION 'court_provider_reservation_mismatch'
        USING ERRCODE = '42501';
    END IF;
    IF v_existing.provider_state = 'started' THEN
      RETURN pg_catalog.jsonb_build_object(
        'allowed', false,
        'reason', 'provider_result_unknown',
        'remaining', NULL,
        'reused', true,
        'provider_state', 'started',
        'retry_disposition', 'manual_reconciliation_required',
        'request_key', v_existing.request_key,
        'request_hash', v_existing.request_hash,
        'idempotency_key', v_existing.request_key,
        'quota_scope_kind', v_existing.quota_scope_kind,
        'audit_user_id', v_existing.audit_user_id,
        'audit_couple_id', v_existing.audit_couple_id,
        'audit_preflight_safety_level', v_existing.audit_preflight_safety_level
      );
    END IF;
    IF v_existing.provider_state <> 'reserved' THEN
      RAISE EXCEPTION 'court_provider_attempt_terminal'
        USING ERRCODE = '55000';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'allowed', true,
      'reason', NULL,
      'remaining', NULL,
      'reused', true,
      'provider_state', 'reserved',
      'retry_disposition', 'safe_to_start',
      'request_key', v_existing.request_key,
      'request_hash', v_existing.request_hash,
      'idempotency_key', v_existing.request_key,
      'quota_scope_kind', v_existing.quota_scope_kind,
      'audit_user_id', v_existing.audit_user_id,
      'audit_couple_id', v_existing.audit_couple_id,
      'audit_preflight_safety_level', v_existing.audit_preflight_safety_level
    );
  END IF;

  INSERT INTO public.court_provider_reservations (
    verdict_id, case_id, input_hash, request_key, request_hash,
    quota_scope_id, quota_scope_kind,
    audit_user_id, audit_couple_id, audit_preflight_safety_level
  ) VALUES (
    p_verdict_id, v_case_id, p_input_hash, p_request_key, p_request_hash,
    v_scope_id, v_scope_kind,
    p_user_id, v_case.couple_id, p_audit_preflight_safety_level
  );

  SELECT reservation.allowed, reservation.reason, reservation.remaining
  INTO v_allowed, v_reason, v_remaining
  FROM public.reserve_amora_usage(
    v_scope_id,
    p_couple_daily_cap,
    p_global_daily_cap,
    false
  ) AS reservation;

  IF NOT COALESCE(v_allowed, false) THEN
    DELETE FROM public.court_provider_reservations
    WHERE verdict_id = p_verdict_id;
    RETURN pg_catalog.jsonb_build_object(
      'allowed', false,
      'reason', COALESCE(v_reason, 'guard_unavailable'),
      'remaining', v_remaining,
      'reused', false
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'allowed', true,
    'reason', NULL,
    'remaining', v_remaining,
    'reused', false,
    'provider_state', 'reserved',
    'retry_disposition', 'safe_to_start',
    'request_key', p_request_key,
    'request_hash', p_request_hash,
    'idempotency_key', p_request_key,
    'quota_scope_kind', v_scope_kind,
    'audit_user_id', p_user_id,
    'audit_couple_id', v_case.couple_id,
    'audit_preflight_safety_level', p_audit_preflight_safety_level
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_court_verdict_provider_started(
  p_verdict_id uuid,
  p_user_id uuid,
  p_lease_token uuid,
  p_input_hash text,
  p_request_key text,
  p_request_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_case_id uuid;
  v_participant_id uuid;
  v_verdict public.court_verdicts%ROWTYPE;
  v_reservation public.court_provider_reservations%ROWTYPE;
  v_reused boolean;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_verdict_id IS NULL OR p_user_id IS NULL OR p_lease_token IS NULL
    OR p_input_hash IS NULL OR p_input_hash !~ '^[a-f0-9]{64}$'
    OR p_request_key IS NULL OR p_request_key !~ '^[a-f0-9]{64}$'
    OR p_request_hash IS NULL OR p_request_hash !~ '^[a-f0-9]{64}$'
  THEN
    RAISE EXCEPTION 'invalid court provider start arguments' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.profiles AS profile
  WHERE profile.id = p_user_id
    AND profile.account_deleting_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active court user is required' USING ERRCODE = '42501';
  END IF;

  SELECT verdict.case_id INTO v_case_id
  FROM public.court_verdicts AS verdict
  WHERE verdict.id = p_verdict_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court verdict is unavailable' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.court_cases AS court_case
  WHERE court_case.id = v_case_id
    AND court_case.workflow_status = 'judging'
    AND court_case.safety_level <> 'high_risk'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court provider start is unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT participant.id INTO v_participant_id
  FROM public.court_participants AS participant
  WHERE participant.case_id = v_case_id
    AND participant.user_id = p_user_id
    AND participant.participation_status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court participant is required' USING ERRCODE = '42501';
  END IF;

  SELECT verdict.* INTO v_verdict
  FROM public.court_verdicts AS verdict
  WHERE verdict.id = p_verdict_id
    AND verdict.case_id = v_case_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_verdict.generation_status <> 'in_progress'
    OR v_verdict.claimed_by_participant_id IS DISTINCT FROM v_participant_id
    OR v_verdict.lease_token IS DISTINCT FROM p_lease_token
    OR v_verdict.lease_expires_at <= pg_catalog.clock_timestamp()
    OR v_verdict.input_hash IS DISTINCT FROM p_input_hash
  THEN
    RAISE EXCEPTION 'court verdict claim is no longer valid' USING ERRCODE = '22023';
  END IF;

  SELECT reservation.* INTO v_reservation
  FROM public.court_provider_reservations AS reservation
  WHERE reservation.verdict_id = p_verdict_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_reservation.case_id IS DISTINCT FROM v_case_id
    OR v_reservation.input_hash IS DISTINCT FROM p_input_hash
    OR v_reservation.request_key IS DISTINCT FROM p_request_key
    OR v_reservation.request_hash IS DISTINCT FROM p_request_hash
  THEN
    RAISE EXCEPTION 'court_provider_reservation_mismatch'
      USING ERRCODE = '42501';
  END IF;
  IF v_reservation.provider_state = 'started' THEN
    RAISE EXCEPTION 'court_provider_manual_reconciliation_required'
      USING ERRCODE = '55000';
  END IF;
  IF v_reservation.provider_state <> 'reserved' THEN
    RAISE EXCEPTION 'court_provider_attempt_terminal'
      USING ERRCODE = '55000';
  END IF;

  v_reused := false;
  UPDATE public.court_provider_reservations
  SET provider_state = 'started',
      started_at = pg_catalog.clock_timestamp()
  WHERE verdict_id = p_verdict_id
    AND provider_state = 'reserved';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court provider start changed concurrently'
      USING ERRCODE = '40001';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'provider_state', 'started',
    'reused', v_reused,
    'retry_disposition', 'started',
    'request_key', p_request_key,
    'request_hash', p_request_hash,
    'idempotency_key', p_request_key
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.stage_court_verdict_provider_result(
  p_verdict_id uuid,
  p_user_id uuid,
  p_lease_token uuid,
  p_input_hash text,
  p_result_json jsonb,
  p_missions_json jsonb,
  p_model text,
  p_audit_model text,
  p_input_tokens integer DEFAULT NULL,
  p_output_tokens integer DEFAULT NULL,
  p_cached_input_tokens integer DEFAULT NULL,
  p_cache_write_input_tokens integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_case_id uuid;
  v_case public.court_cases%ROWTYPE;
  v_participant_id uuid;
  v_verdict public.court_verdicts%ROWTYPE;
  v_reservation public.court_provider_reservations%ROWTYPE;
  v_result_safety_level text;
  v_result_safety_categories text[];
  v_result_safety_category_count integer;
  v_staged_at timestamptz;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  v_result_safety_level := p_result_json #>> '{safety,level}';
  IF pg_catalog.jsonb_typeof(p_result_json #> '{safety,riskTypes}') = 'array' THEN
    v_result_safety_category_count := pg_catalog.jsonb_array_length(
      p_result_json #> '{safety,riskTypes}'
    );
    SELECT COALESCE(
      pg_catalog.array_agg(DISTINCT risk_type ORDER BY risk_type),
      ARRAY[]::text[]
    )
    INTO v_result_safety_categories
    FROM (
      SELECT item.value #>> '{}' AS risk_type
      FROM pg_catalog.jsonb_array_elements(
        p_result_json #> '{safety,riskTypes}'
      ) AS item(value)
    ) AS result_risk_type;
  ELSE
    v_result_safety_categories := NULL;
    v_result_safety_category_count := NULL;
  END IF;
  IF p_verdict_id IS NULL OR p_user_id IS NULL OR p_lease_token IS NULL
    OR p_input_hash IS NULL OR p_input_hash !~ '^[a-f0-9]{64}$'
    OR p_model IS DISTINCT FROM 'gpt-5.6-terra'
    OR p_audit_model IS NULL
    OR p_audit_model !~ '^[A-Za-z0-9._:/-]{1,128}$'
    OR NOT public.court_verdict_result_is_valid(p_result_json)
    OR NOT public.court_missions_json_is_valid(p_missions_json)
    OR p_result_json -> 'missions' IS DISTINCT FROM p_missions_json
    OR v_result_safety_level IS NULL
    OR v_result_safety_level NOT IN ('normal', 'sensitive', 'high_risk')
    OR v_result_safety_category_count IS NULL
    OR v_result_safety_category_count > 12
    OR NOT public.court_safety_categories_are_valid(v_result_safety_categories)
    OR (v_result_safety_level = 'normal'
      AND pg_catalog.cardinality(v_result_safety_categories) <> 0)
    OR (v_result_safety_level = 'high_risk'
      AND pg_catalog.cardinality(v_result_safety_categories) = 0)
    OR (p_input_tokens IS NULL) <> (p_output_tokens IS NULL)
    OR (p_input_tokens IS NOT NULL
      AND p_input_tokens NOT BETWEEN 0 AND 10000000)
    OR (p_output_tokens IS NOT NULL
      AND p_output_tokens NOT BETWEEN 0 AND 10000000)
    OR (p_cached_input_tokens IS NOT NULL AND (
      p_cached_input_tokens NOT BETWEEN 0 AND 10000000
      OR p_input_tokens IS NULL
      OR p_cached_input_tokens > p_input_tokens
    ))
    OR (p_cache_write_input_tokens IS NOT NULL AND (
      p_cache_write_input_tokens NOT BETWEEN 0 AND 10000000
      OR p_input_tokens IS NULL
      OR p_cache_write_input_tokens > p_input_tokens
    ))
  THEN
    RAISE EXCEPTION 'invalid court provider staged result arguments'
      USING ERRCODE = '22023';
  END IF;
  IF v_result_safety_level = 'high_risk' THEN
    RAISE EXCEPTION 'court_provider_result_high_risk' USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.profiles AS profile
  WHERE profile.id = p_user_id
    AND profile.account_deleting_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active court user is required' USING ERRCODE = '42501';
  END IF;

  SELECT verdict.case_id INTO v_case_id
  FROM public.court_verdicts AS verdict
  WHERE verdict.id = p_verdict_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court verdict is unavailable' USING ERRCODE = '22023';
  END IF;

  SELECT court_case.* INTO v_case
  FROM public.court_cases AS court_case
  WHERE court_case.id = v_case_id
  FOR UPDATE;
  IF NOT FOUND OR v_case.workflow_status <> 'judging'
    OR v_case.safety_level = 'high_risk'
  THEN
    RAISE EXCEPTION 'court provider result staging is unavailable'
      USING ERRCODE = '42501';
  END IF;
  IF v_case.safety_level = 'sensitive' AND v_result_safety_level = 'normal' THEN
    RAISE EXCEPTION 'court verdict cannot lower the case safety level'
      USING ERRCODE = '42501';
  END IF;

  SELECT participant.id INTO v_participant_id
  FROM public.court_participants AS participant
  WHERE participant.case_id = v_case_id
    AND participant.user_id = p_user_id
    AND participant.participation_status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court participant is required' USING ERRCODE = '42501';
  END IF;

  SELECT verdict.* INTO v_verdict
  FROM public.court_verdicts AS verdict
  WHERE verdict.id = p_verdict_id
    AND verdict.case_id = v_case_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_verdict.generation_status <> 'in_progress'
    OR v_verdict.claimed_by_participant_id IS DISTINCT FROM v_participant_id
    OR v_verdict.lease_token IS DISTINCT FROM p_lease_token
    OR v_verdict.input_hash IS DISTINCT FROM p_input_hash
    OR v_verdict.model IS DISTINCT FROM p_model
  THEN
    RAISE EXCEPTION 'court verdict claim is no longer valid' USING ERRCODE = '22023';
  END IF;

  SELECT reservation.* INTO v_reservation
  FROM public.court_provider_reservations AS reservation
  WHERE reservation.verdict_id = p_verdict_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_reservation.case_id IS DISTINCT FROM v_case_id
    OR v_reservation.input_hash IS DISTINCT FROM p_input_hash
  THEN
    RAISE EXCEPTION 'court_provider_reservation_mismatch'
      USING ERRCODE = '42501';
  END IF;
  IF v_reservation.audit_preflight_safety_level = 'sensitive'
    AND v_result_safety_level = 'normal'
  THEN
    RAISE EXCEPTION 'court verdict cannot lower provider preflight safety'
      USING ERRCODE = '42501';
  END IF;

  IF v_reservation.provider_state = 'result_staged' THEN
    IF v_reservation.staged_result_json IS DISTINCT FROM p_result_json
      OR v_reservation.staged_missions_json IS DISTINCT FROM p_missions_json
      OR v_reservation.staged_model IS DISTINCT FROM p_model
      OR v_reservation.audit_model IS DISTINCT FROM p_audit_model
      OR v_reservation.provider_input_tokens IS DISTINCT FROM p_input_tokens
      OR v_reservation.provider_output_tokens IS DISTINCT FROM p_output_tokens
      OR v_reservation.provider_cached_input_tokens
        IS DISTINCT FROM p_cached_input_tokens
      OR v_reservation.provider_cache_write_input_tokens
        IS DISTINCT FROM p_cache_write_input_tokens
    THEN
      RAISE EXCEPTION 'court_provider_staged_result_mismatch'
        USING ERRCODE = '42501';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'verdict_id', p_verdict_id,
      'provider_state', 'result_staged',
      'provider_audit_state', v_reservation.provider_audit_state,
      'staged_at', v_reservation.staged_at,
      'audit_model', v_reservation.audit_model,
      'usage', pg_catalog.jsonb_build_object(
        'input_tokens', v_reservation.provider_input_tokens,
        'output_tokens', v_reservation.provider_output_tokens,
        'cached_input_tokens', v_reservation.provider_cached_input_tokens,
        'cache_write_input_tokens', v_reservation.provider_cache_write_input_tokens
      ),
      'reused', true
    );
  END IF;
  IF v_reservation.provider_state <> 'started' THEN
    RAISE EXCEPTION 'court_provider_start_required' USING ERRCODE = '42501';
  END IF;

  v_staged_at := pg_catalog.clock_timestamp();
  UPDATE public.court_provider_reservations
  SET provider_state = 'result_staged',
      staged_at = v_staged_at,
      staged_result_json = p_result_json,
      staged_missions_json = p_missions_json,
      staged_model = p_model,
      audit_model = p_audit_model,
      provider_audit_state = 'pending',
      provider_audit_pending_at = v_staged_at,
      provider_audited_at = NULL,
      provider_audit_recovery_lease_token = NULL,
      provider_audit_recovery_lease_expires_at = NULL,
      provider_high_risk_categories = NULL,
      provider_input_tokens = p_input_tokens,
      provider_output_tokens = p_output_tokens,
      provider_cached_input_tokens = p_cached_input_tokens,
      provider_cache_write_input_tokens = p_cache_write_input_tokens
  WHERE verdict_id = p_verdict_id
    AND provider_state = 'started';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court provider staging changed concurrently'
      USING ERRCODE = '40001';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'verdict_id', p_verdict_id,
    'provider_state', 'result_staged',
    'provider_audit_state', 'pending',
    'staged_at', v_staged_at,
    'audit_model', p_audit_model,
    'usage', pg_catalog.jsonb_build_object(
      'input_tokens', p_input_tokens,
      'output_tokens', p_output_tokens,
      'cached_input_tokens', p_cached_input_tokens,
      'cache_write_input_tokens', p_cache_write_input_tokens
    ),
    'reused', false
  );
END;
$$;

-- Persist only the safe paid-call envelope for a provider-discovered
-- high-risk result. Verdict prose, explanations, share text and missions are
-- deliberately absent from this RPC and can never enter the recovery queue.
CREATE OR REPLACE FUNCTION public.settle_court_high_risk_provider_result(
  p_verdict_id uuid,
  p_user_id uuid,
  p_lease_token uuid,
  p_input_hash text,
  p_request_key text,
  p_categories text[],
  p_audit_model text,
  p_input_tokens integer DEFAULT NULL,
  p_output_tokens integer DEFAULT NULL,
  p_cached_input_tokens integer DEFAULT NULL,
  p_cache_write_input_tokens integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_case_id uuid;
  v_case public.court_cases%ROWTYPE;
  v_verdict public.court_verdicts%ROWTYPE;
  v_reservation public.court_provider_reservations%ROWTYPE;
  v_participant_id uuid;
  v_categories text[];
  v_effective_categories text[];
  v_previous_status text;
  v_next_status text;
  v_pending_at timestamptz;
  v_terminated_verdict_count integer := 0;
  v_other_terminated_count integer := 0;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_verdict_id IS NULL OR p_user_id IS NULL OR p_lease_token IS NULL
    OR p_input_hash IS NULL OR p_input_hash !~ '^[a-f0-9]{64}$'
    OR p_request_key IS NULL OR p_request_key !~ '^[a-f0-9]{64}$'
    OR p_categories IS NULL
    OR pg_catalog.cardinality(p_categories) NOT BETWEEN 1 AND 12
    OR NOT public.court_safety_categories_are_valid(p_categories)
    OR p_audit_model IS NULL
    OR p_audit_model !~ '^[A-Za-z0-9._:/-]{1,128}$'
    OR (p_input_tokens IS NULL) <> (p_output_tokens IS NULL)
    OR (p_input_tokens IS NOT NULL
      AND p_input_tokens NOT BETWEEN 0 AND 10000000)
    OR (p_output_tokens IS NOT NULL
      AND p_output_tokens NOT BETWEEN 0 AND 10000000)
    OR (p_cached_input_tokens IS NOT NULL AND (
      p_cached_input_tokens NOT BETWEEN 0 AND 10000000
      OR p_input_tokens IS NULL
      OR p_cached_input_tokens > p_input_tokens
    ))
    OR (p_cache_write_input_tokens IS NOT NULL AND (
      p_cache_write_input_tokens NOT BETWEEN 0 AND 10000000
      OR p_input_tokens IS NULL
      OR p_cache_write_input_tokens > p_input_tokens
    ))
  THEN
    RAISE EXCEPTION 'invalid court high-risk provider settlement arguments'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(
    pg_catalog.array_agg(DISTINCT category ORDER BY category),
    ARRAY[]::text[]
  ) INTO v_categories
  FROM pg_catalog.unnest(p_categories) AS safety_category(category);

  -- Do not let account-deletion timing erase a paid safety outcome. The
  -- reservation/lease identity below remains the authorization fence.
  PERFORM 1 FROM public.profiles AS profile
  WHERE profile.id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court provider audit user is unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT verdict.case_id INTO v_case_id
  FROM public.court_verdicts AS verdict
  WHERE verdict.id = p_verdict_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court verdict is unavailable' USING ERRCODE = '22023';
  END IF;

  SELECT court_case.* INTO v_case
  FROM public.court_cases AS court_case
  WHERE court_case.id = v_case_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court case is unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT participant.id INTO v_participant_id
  FROM public.court_participants AS participant
  WHERE participant.case_id = v_case_id
    AND participant.user_id = p_user_id
    AND participant.participation_status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court participant is required' USING ERRCODE = '42501';
  END IF;

  SELECT verdict.* INTO v_verdict
  FROM public.court_verdicts AS verdict
  WHERE verdict.id = p_verdict_id
    AND verdict.case_id = v_case_id
  FOR UPDATE;
  IF NOT FOUND OR v_verdict.input_hash IS DISTINCT FROM p_input_hash THEN
    RAISE EXCEPTION 'court verdict claim is no longer valid' USING ERRCODE = '22023';
  END IF;

  SELECT reservation.* INTO v_reservation
  FROM public.court_provider_reservations AS reservation
  WHERE reservation.verdict_id = p_verdict_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_reservation.case_id IS DISTINCT FROM v_case_id
    OR v_reservation.input_hash IS DISTINCT FROM p_input_hash
    OR v_reservation.request_key IS DISTINCT FROM p_request_key
    OR v_reservation.audit_user_id IS DISTINCT FROM p_user_id
  THEN
    RAISE EXCEPTION 'court_provider_reservation_mismatch'
      USING ERRCODE = '42501';
  END IF;

  IF v_reservation.provider_state = 'failed_invalid'
    AND v_reservation.provider_error_code = 'safety_high_risk'
    AND v_reservation.provider_audit_state IN ('pending', 'audited')
  THEN
    IF v_reservation.audit_model IS DISTINCT FROM p_audit_model
      OR v_reservation.provider_high_risk_categories IS DISTINCT FROM v_categories
      OR v_reservation.provider_input_tokens IS DISTINCT FROM p_input_tokens
      OR v_reservation.provider_output_tokens IS DISTINCT FROM p_output_tokens
      OR v_reservation.provider_cached_input_tokens
        IS DISTINCT FROM p_cached_input_tokens
      OR v_reservation.provider_cache_write_input_tokens
        IS DISTINCT FROM p_cache_write_input_tokens
      OR v_verdict.generation_status <> 'failed'
      OR v_verdict.terminal_lease_token IS DISTINCT FROM p_lease_token
    THEN
      RAISE EXCEPTION 'court_high_risk_provider_settlement_mismatch'
        USING ERRCODE = '42501';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'case_id', v_case_id,
      'verdict_id', p_verdict_id,
      'provider_state', 'failed_invalid',
      'provider_audit_state', v_reservation.provider_audit_state,
      'request_key', v_reservation.request_key,
      'safety_level', 'high_risk',
      'safety_categories', pg_catalog.to_jsonb(v_categories),
      'reused', true
    );
  END IF;

  IF v_reservation.provider_state = 'started' THEN
    IF v_verdict.generation_status <> 'in_progress'
      OR v_verdict.claimed_by_participant_id IS DISTINCT FROM v_participant_id
      OR v_verdict.lease_token IS DISTINCT FROM p_lease_token
    THEN
      RAISE EXCEPTION 'court verdict claim is no longer valid' USING ERRCODE = '22023';
    END IF;
  ELSIF NOT (
    v_reservation.provider_state = 'failed_invalid'
    AND v_reservation.provider_audit_state = 'not_required'
    AND v_reservation.provider_error_code IN (
      'safety_high_risk', 'safety_level_changed', 'court_archived'
    )
    AND v_verdict.generation_status = 'failed'
    AND v_verdict.terminal_lease_token IS NOT DISTINCT FROM p_lease_token
  ) THEN
    RAISE EXCEPTION 'court_provider_high_risk_settlement_unavailable'
      USING ERRCODE = '55000';
  END IF;

  SELECT COALESCE(
    pg_catalog.array_agg(DISTINCT category ORDER BY category),
    ARRAY[]::text[]
  ) INTO v_effective_categories
  FROM pg_catalog.unnest(
    COALESCE(v_case.safety_categories, ARRAY[]::text[]) || v_categories
  ) AS safety_category(category);

  v_pending_at := pg_catalog.clock_timestamp();
  UPDATE public.court_provider_reservations
  SET provider_state = 'failed_invalid',
      staged_at = NULL,
      staged_result_json = NULL,
      staged_missions_json = NULL,
      staged_model = NULL,
      audit_model = p_audit_model,
      provider_audit_state = 'pending',
      provider_audit_pending_at = v_pending_at,
      provider_audited_at = NULL,
      provider_audit_recovery_lease_token = NULL,
      provider_audit_recovery_lease_expires_at = NULL,
      provider_audit_recovery_attempt_count = 0,
      provider_audit_recovery_last_error_code = NULL,
      provider_audit_recovery_last_error_at = NULL,
      provider_high_risk_categories = v_categories,
      provider_input_tokens = p_input_tokens,
      provider_output_tokens = p_output_tokens,
      provider_cached_input_tokens = p_cached_input_tokens,
      provider_cache_write_input_tokens = p_cache_write_input_tokens,
      completed_at = NULL,
      failed_at = v_pending_at,
      provider_error_code = 'safety_high_risk'
  WHERE verdict_id = p_verdict_id
    AND (
      provider_state = 'started'
      OR (provider_state = 'failed_invalid' AND provider_audit_state = 'not_required')
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court high-risk provider settlement changed concurrently'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.court_verdicts
  SET generation_status = 'failed',
      result_json = NULL,
      terminal_lease_token = COALESCE(terminal_lease_token, lease_token, p_lease_token),
      lease_token = NULL,
      lease_expires_at = NULL,
      completed_at = NULL,
      failed_at = v_pending_at,
      superseded_at = NULL,
      error_code = 'safety_high_risk'
  WHERE id = p_verdict_id;
  v_terminated_verdict_count := 1;

  PERFORM public.settle_court_provider_failure(verdict.id, 'safety_high_risk')
  FROM public.court_verdicts AS verdict
  WHERE verdict.case_id = v_case_id
    AND verdict.id <> p_verdict_id
    AND verdict.generation_status = 'in_progress';

  UPDATE public.court_verdicts AS verdict
  SET generation_status = 'failed',
      result_json = NULL,
      terminal_lease_token = verdict.lease_token,
      lease_token = NULL,
      lease_expires_at = NULL,
      completed_at = NULL,
      failed_at = v_pending_at,
      superseded_at = NULL,
      error_code = 'safety_high_risk'
  WHERE verdict.case_id = v_case_id
    AND verdict.id <> p_verdict_id
    AND verdict.generation_status = 'in_progress';
  GET DIAGNOSTICS v_other_terminated_count = ROW_COUNT;
  v_terminated_verdict_count := v_terminated_verdict_count + v_other_terminated_count;

  DELETE FROM public.amora_actions AS action
  USING public.court_missions AS mission, public.court_verdicts AS verdict
  WHERE verdict.case_id = v_case_id
    AND verdict.generation_status IN ('ready', 'superseded')
    AND mission.verdict_id = verdict.id
    AND mission.amora_action_id = action.id
    AND action.source = 'court';
  DELETE FROM public.court_missions AS mission
  USING public.court_verdicts AS verdict
  WHERE verdict.case_id = v_case_id
    AND verdict.generation_status IN ('ready', 'superseded')
    AND mission.verdict_id = verdict.id;
  DELETE FROM public.court_verdicts AS verdict
  WHERE verdict.case_id = v_case_id
    AND verdict.generation_status IN ('ready', 'superseded');

  v_previous_status := v_case.workflow_status;
  v_next_status := CASE
    WHEN v_case.workflow_status = 'archived' THEN 'archived'
    WHEN v_case.workflow_status IN (
      'judging', 'verdict_ready', 'mission_active', 'resolved'
    ) THEN 'statements_complete'
    ELSE v_case.workflow_status
  END;
  UPDATE public.court_cases
  SET safety_level = 'high_risk',
      safety_review_status = 'pending',
      safety_categories = v_effective_categories,
      workflow_status = v_next_status,
      lock_version = lock_version + 1
  WHERE id = v_case_id;

  UPDATE public.court_invites
  SET revoked_at = COALESCE(revoked_at, v_pending_at)
  WHERE case_id = v_case_id
    AND consumed_at IS NULL AND revoked_at IS NULL AND rejected_at IS NULL;
  DELETE FROM public.court_public_posts WHERE case_id = v_case_id;

  INSERT INTO public.court_case_events (
    case_id, actor_participant_id, event_type, metadata
  ) VALUES (
    v_case_id,
    v_participant_id,
    'safety_changed',
    pg_catalog.jsonb_build_object(
      'safety_level', 'high_risk',
      'safety_categories', pg_catalog.to_jsonb(v_effective_categories),
      'from_status', v_previous_status,
      'to_status', v_next_status,
      'reason_code', 'provider_generated_high_risk',
      'status', 'judgment_blocked'
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'case_id', v_case_id,
    'verdict_id', p_verdict_id,
    'provider_state', 'failed_invalid',
    'provider_audit_state', 'pending',
    'request_key', p_request_key,
    'safety_level', 'high_risk',
    'safety_categories', pg_catalog.to_jsonb(v_effective_categories),
    'terminated_verdict_count', v_terminated_verdict_count,
    'reused', false
  );
END;
$$;

-- Finalization is evidence-based, not caller-asserted. The successful audit
-- row must match the complete canonical, payload-free provider identity.
CREATE OR REPLACE FUNCTION public.finalize_court_provider_audit(
  p_verdict_id uuid,
  p_request_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_reservation public.court_provider_reservations%ROWTYPE;
  v_verdict public.court_verdicts%ROWTYPE;
  v_case public.court_cases%ROWTYPE;
  v_audit public.ai_interactions_log%ROWTYPE;
  v_expected_metadata jsonb;
  v_schema_name text;
  v_audited_at timestamptz;
  v_reused boolean;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_verdict_id IS NULL OR p_request_key IS NULL
    OR p_request_key !~ '^[a-f0-9]{64}$'
  THEN
    RAISE EXCEPTION 'invalid court provider audit finalization arguments'
      USING ERRCODE = '22023';
  END IF;

  SELECT reservation.* INTO v_reservation
  FROM public.court_provider_reservations AS reservation
  WHERE reservation.verdict_id = p_verdict_id
  FOR UPDATE;
  IF NOT FOUND OR v_reservation.request_key IS DISTINCT FROM p_request_key THEN
    RAISE EXCEPTION 'court_provider_reservation_mismatch'
      USING ERRCODE = '42501';
  END IF;
  IF v_reservation.provider_audit_state NOT IN ('pending', 'audited')
    OR v_reservation.audit_model IS NULL
  THEN
    RAISE EXCEPTION 'court_provider_audit_not_pending' USING ERRCODE = '55000';
  END IF;

  SELECT verdict.* INTO v_verdict
  FROM public.court_verdicts AS verdict
  WHERE verdict.id = p_verdict_id
    AND verdict.case_id = v_reservation.case_id;
  SELECT court_case.* INTO v_case
  FROM public.court_cases AS court_case
  WHERE court_case.id = v_reservation.case_id;
  IF v_verdict.id IS NULL OR v_case.id IS NULL THEN
    RAISE EXCEPTION 'court provider audit context is unavailable'
      USING ERRCODE = '55000';
  END IF;

  -- Audit recovery may run after a deployment, so derive the structured
  -- output identity from the immutable stored schema version. Never rewrite
  -- an old paid response with the running release's schema name.
  v_schema_name := CASE v_verdict.schema_version
    WHEN '1.0' THEN 'couple_court_verdict_v1'
    ELSE NULL
  END;
  IF v_schema_name IS NULL THEN
    RAISE EXCEPTION 'court_provider_audit_schema_unsupported'
      USING ERRCODE = '55000';
  END IF;

  v_expected_metadata := pg_catalog.jsonb_build_object(
    'source', 'couple_court_judge',
    'mode', v_case.mode,
    'category', v_case.category,
    'tone', v_case.tone,
    'prompt_version', v_verdict.prompt_version,
    'schema_version', v_verdict.schema_version,
    'safety_level', v_reservation.audit_preflight_safety_level,
    'input_hash', v_reservation.input_hash,
    'ai_provider', 'openai',
    'quota_class', 'provider_call',
    'model_role', 'primary',
    'reasoning_effort', 'none',
    'audit_wrapper', 'createOpenAIStructuredResponseWithAudit',
    'structured_output', true,
    'schema_name', v_schema_name
  ) || CASE
    WHEN COALESCE(v_reservation.provider_cache_write_input_tokens, 0) <> 0
      OR COALESCE(v_reservation.provider_cached_input_tokens, 0) <> 0
    THEN pg_catalog.jsonb_build_object(
      'cache_write_input_tokens',
        COALESCE(v_reservation.provider_cache_write_input_tokens, 0),
      'cache_read_input_tokens',
        COALESCE(v_reservation.provider_cached_input_tokens, 0)
    )
    ELSE '{}'::jsonb
  END;

  SELECT interaction.* INTO v_audit
  FROM public.ai_interactions_log AS interaction
  WHERE interaction.idempotency_key = p_request_key;
  IF NOT FOUND
    OR v_audit.user_id IS DISTINCT FROM v_reservation.audit_user_id
    OR v_audit.couple_id IS DISTINCT FROM v_reservation.audit_couple_id
    OR v_audit.session_id IS NOT NULL
    OR v_audit.message_id IS NOT NULL
    OR v_audit.interaction_type IS DISTINCT FROM 'couple_court_verdict'
    OR v_audit.specialist_type IS NOT NULL
    OR v_audit.user_input IS NOT NULL
    OR v_audit.ai_output IS NOT NULL
    OR v_audit.tool_name IS NOT NULL
    OR v_audit.tool_input IS NOT NULL
    OR v_audit.tool_output IS NOT NULL
    OR v_audit.success IS DISTINCT FROM true
    OR v_audit.error_message IS NOT NULL
    OR v_audit.model IS DISTINCT FROM v_reservation.audit_model
    OR v_audit.tokens_input IS DISTINCT FROM v_reservation.provider_input_tokens
    OR v_audit.tokens_output IS DISTINCT FROM v_reservation.provider_output_tokens
    OR v_audit.metadata IS DISTINCT FROM v_expected_metadata
  THEN
    RAISE EXCEPTION 'court_provider_audit_evidence_mismatch'
      USING ERRCODE = '55000';
  END IF;

  v_reused := v_reservation.provider_audit_state = 'audited';
  IF NOT v_reused THEN
    v_audited_at := pg_catalog.clock_timestamp();
    UPDATE public.court_provider_reservations
    SET provider_audit_state = 'audited',
        provider_audit_pending_at = NULL,
        provider_audited_at = v_audited_at,
        provider_audit_recovery_lease_token = NULL,
        provider_audit_recovery_lease_expires_at = NULL,
        provider_audit_recovery_last_error_code = NULL,
        provider_audit_recovery_last_error_at = NULL
    WHERE verdict_id = p_verdict_id
      AND provider_audit_state = 'pending';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'court provider audit finalization changed concurrently'
        USING ERRCODE = '40001';
    END IF;
  ELSE
    v_audited_at := v_reservation.provider_audited_at;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'verdict_id', p_verdict_id,
    'case_id', v_reservation.case_id,
    'provider_state', v_reservation.provider_state,
    'provider_audit_state', 'audited',
    'audited_at', v_audited_at,
    'reused', v_reused
  );
END;
$$;

-- Active administrators can lease one safe envelope at a time. The result
-- intentionally excludes staged verdict/missions and provider request hashes.
CREATE OR REPLACE FUNCTION public.claim_court_provider_audit_recovery(
  p_admin_user_id uuid,
  p_lease_seconds integer DEFAULT 120
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_reservation public.court_provider_reservations%ROWTYPE;
  v_verdict public.court_verdicts%ROWTYPE;
  v_case public.court_cases%ROWTYPE;
  v_lease_token uuid;
  v_lease_expires_at timestamptz;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_admin_user_id IS NULL OR p_lease_seconds IS NULL
    OR p_lease_seconds NOT BETWEEN 30 AND 300
  THEN
    RAISE EXCEPTION 'invalid court provider audit recovery claim arguments'
      USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.profiles AS profile
  WHERE profile.id = p_admin_user_id
    AND profile.account_deleting_at IS NULL
    AND profile.is_admin = true
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court provider audit recovery requires an active admin'
      USING ERRCODE = '42501';
  END IF;

  SELECT reservation.* INTO v_reservation
  FROM public.court_provider_reservations AS reservation
  WHERE reservation.provider_audit_state = 'pending'
    AND reservation.provider_audit_recovery_attempt_count < 10000
    AND (
      reservation.provider_audit_recovery_lease_expires_at IS NULL
      OR reservation.provider_audit_recovery_lease_expires_at
        <= pg_catalog.clock_timestamp()
    )
  ORDER BY reservation.provider_audit_pending_at, reservation.verdict_id
  LIMIT 1
  FOR UPDATE OF reservation SKIP LOCKED;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('claim_status', 'empty');
  END IF;

  SELECT verdict.* INTO v_verdict
  FROM public.court_verdicts AS verdict
  WHERE verdict.id = v_reservation.verdict_id
    AND verdict.case_id = v_reservation.case_id;
  SELECT court_case.* INTO v_case
  FROM public.court_cases AS court_case
  WHERE court_case.id = v_reservation.case_id;
  IF v_verdict.id IS NULL OR v_case.id IS NULL THEN
    RAISE EXCEPTION 'court provider audit recovery context is unavailable'
      USING ERRCODE = '55000';
  END IF;

  v_lease_token := pg_catalog.gen_random_uuid();
  v_lease_expires_at := pg_catalog.clock_timestamp()
    + pg_catalog.make_interval(secs => p_lease_seconds);
  UPDATE public.court_provider_reservations
  SET provider_audit_recovery_lease_token = v_lease_token,
      provider_audit_recovery_lease_expires_at = v_lease_expires_at,
      provider_audit_recovery_attempt_count =
        provider_audit_recovery_attempt_count + 1
  WHERE verdict_id = v_reservation.verdict_id
    AND provider_audit_state = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court provider audit recovery claim changed concurrently'
      USING ERRCODE = '40001';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'claim_status', 'execute',
    'verdict_id', v_reservation.verdict_id,
    'case_id', v_reservation.case_id,
    'provider_state', v_reservation.provider_state,
    'provider_audit_state', 'pending',
    'provider_error_code', v_reservation.provider_error_code,
    'provider_audit_pending_at', v_reservation.provider_audit_pending_at,
    'recovery_attempt_count', v_reservation.provider_audit_recovery_attempt_count + 1,
    'recovery_lease_token', v_lease_token,
    'recovery_lease_expires_at', v_lease_expires_at,
    'request_key', v_reservation.request_key,
    'audit_user_id', v_reservation.audit_user_id,
    'audit_couple_id', v_reservation.audit_couple_id,
    'audit_preflight_safety_level',
      v_reservation.audit_preflight_safety_level,
    'audit_model', v_reservation.audit_model,
    'input_hash', v_reservation.input_hash,
    'mode', v_case.mode,
    'category', v_case.category,
    'tone', v_case.tone,
    'prompt_version', v_verdict.prompt_version,
    'schema_version', v_verdict.schema_version,
    'high_risk_categories',
      pg_catalog.to_jsonb(v_reservation.provider_high_risk_categories),
    'usage', pg_catalog.jsonb_build_object(
      'input_tokens', v_reservation.provider_input_tokens,
      'output_tokens', v_reservation.provider_output_tokens,
      'cached_input_tokens', v_reservation.provider_cached_input_tokens,
      'cache_write_input_tokens',
        v_reservation.provider_cache_write_input_tokens
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_court_provider_audit_recovery_failure(
  p_verdict_id uuid,
  p_admin_user_id uuid,
  p_recovery_lease_token uuid,
  p_error_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_reservation public.court_provider_reservations%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_verdict_id IS NULL OR p_admin_user_id IS NULL
    OR p_recovery_lease_token IS NULL OR p_error_code IS NULL
    OR p_error_code !~ '^[a-z0-9_.-]{1,64}$'
  THEN
    RAISE EXCEPTION 'invalid court provider audit recovery failure arguments'
      USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.profiles AS profile
  WHERE profile.id = p_admin_user_id
    AND profile.account_deleting_at IS NULL
    AND profile.is_admin = true
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court provider audit recovery requires an active admin'
      USING ERRCODE = '42501';
  END IF;

  SELECT reservation.* INTO v_reservation
  FROM public.court_provider_reservations AS reservation
  WHERE reservation.verdict_id = p_verdict_id
  FOR UPDATE;
  IF NOT FOUND OR v_reservation.provider_audit_state <> 'pending'
    OR v_reservation.provider_audit_recovery_lease_token
      IS DISTINCT FROM p_recovery_lease_token
    OR v_reservation.provider_audit_recovery_lease_expires_at
      <= pg_catalog.clock_timestamp()
  THEN
    RAISE EXCEPTION 'court provider audit recovery lease is no longer valid'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.court_provider_reservations
  SET provider_audit_recovery_last_error_code = p_error_code,
      provider_audit_recovery_last_error_at = pg_catalog.clock_timestamp()
  WHERE verdict_id = p_verdict_id
    AND provider_audit_state = 'pending';
  RETURN pg_catalog.jsonb_build_object(
    'verdict_id', p_verdict_id,
    'provider_audit_state', 'pending',
    'error_code', p_error_code,
    'retry_after', v_reservation.provider_audit_recovery_lease_expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_court_verdict(
  p_verdict_id uuid,
  p_user_id uuid,
  p_lease_token uuid,
  p_input_hash text,
  p_result_json jsonb,
  p_missions_json jsonb,
  p_model text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_case_id uuid;
  v_case public.court_cases%ROWTYPE;
  v_verdict public.court_verdicts%ROWTYPE;
  v_participant_id uuid;
  v_item jsonb;
  v_mission_id uuid;
  v_mission_ids jsonb := '[]'::jsonb;
  v_result_safety_level text;
  v_result_safety_categories text[];
  v_result_safety_category_count integer;
  v_effective_safety_categories text[];
  v_provider_reservation public.court_provider_reservations%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  v_result_safety_level := p_result_json #>> '{safety,level}';
  IF pg_catalog.jsonb_typeof(p_result_json #> '{safety,riskTypes}') = 'array' THEN
    v_result_safety_category_count := pg_catalog.jsonb_array_length(
      p_result_json #> '{safety,riskTypes}'
    );
    SELECT COALESCE(
      pg_catalog.array_agg(DISTINCT risk_type ORDER BY risk_type),
      ARRAY[]::text[]
    )
    INTO v_result_safety_categories
    FROM (
      SELECT item.value #>> '{}' AS risk_type
      FROM pg_catalog.jsonb_array_elements(
        p_result_json #> '{safety,riskTypes}'
      ) AS item(value)
    ) AS result_risk_type;
  ELSE
    v_result_safety_categories := NULL;
    v_result_safety_category_count := NULL;
  END IF;
  IF p_verdict_id IS NULL OR p_user_id IS NULL OR p_lease_token IS NULL
    OR p_input_hash IS NULL OR p_input_hash !~ '^[a-f0-9]{64}$'
    OR p_model IS NULL
    OR p_model NOT IN ('gpt-5.6-terra', 'couple-court-development-mock-v1')
    OR NOT public.court_verdict_result_is_valid(p_result_json)
    OR NOT public.court_missions_json_is_valid(p_missions_json)
    OR p_result_json -> 'missions' IS DISTINCT FROM p_missions_json
    OR v_result_safety_level IS NULL
    OR v_result_safety_level NOT IN ('normal', 'sensitive', 'high_risk')
    OR v_result_safety_category_count IS NULL
    OR v_result_safety_category_count > 12
    OR NOT public.court_safety_categories_are_valid(v_result_safety_categories)
    OR (v_result_safety_level = 'normal'
      AND pg_catalog.cardinality(v_result_safety_categories) <> 0)
    OR (v_result_safety_level = 'high_risk'
      AND pg_catalog.cardinality(v_result_safety_categories) = 0)
  THEN
    RAISE EXCEPTION 'invalid court verdict completion arguments' USING ERRCODE = '22023';
  END IF;

  IF v_result_safety_level = 'high_risk' THEN
    RAISE EXCEPTION 'high-risk result must use the safety flow' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.profiles AS profile
  WHERE profile.id = p_user_id AND profile.account_deleting_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active court user is required' USING ERRCODE = '42501';
  END IF;

  SELECT verdict.case_id INTO v_case_id
  FROM public.court_verdicts AS verdict
  WHERE verdict.id = p_verdict_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court verdict is unavailable' USING ERRCODE = '22023';
  END IF;

  SELECT court_case.* INTO v_case
  FROM public.court_cases AS court_case
  WHERE court_case.id = v_case_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court verdict cannot complete in this state' USING ERRCODE = '42501';
  END IF;

  SELECT participant.id INTO v_participant_id
  FROM public.court_participants AS participant
  WHERE participant.case_id = v_case_id
    AND participant.user_id = p_user_id
    AND participant.participation_status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court participant is required' USING ERRCODE = '42501';
  END IF;

  SELECT verdict.* INTO v_verdict
  FROM public.court_verdicts AS verdict
  WHERE verdict.id = p_verdict_id
    AND verdict.case_id = v_case_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court verdict claim is no longer valid' USING ERRCODE = '22023';
  END IF;

  IF v_case.safety_level = 'high_risk' THEN
    RAISE EXCEPTION 'high-risk court verdicts are not available'
      USING ERRCODE = '42501';
  END IF;

  IF v_case.safety_level = 'sensitive' AND v_result_safety_level = 'normal' THEN
    RAISE EXCEPTION 'court verdict cannot lower the case safety level'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(
    pg_catalog.array_agg(DISTINCT category ORDER BY category),
    ARRAY[]::text[]
  )
  INTO v_effective_safety_categories
  FROM pg_catalog.unnest(
    v_case.safety_categories || v_result_safety_categories
  ) AS safety_category(category);

  IF v_verdict.generation_status = 'ready' THEN
    IF v_verdict.terminal_lease_token IS DISTINCT FROM p_lease_token
      OR v_verdict.input_hash IS DISTINCT FROM p_input_hash
      OR v_verdict.model IS DISTINCT FROM p_model
      OR v_verdict.result_json IS DISTINCT FROM p_result_json
    THEN
      RAISE EXCEPTION 'court verdict completion fence mismatch'
        USING ERRCODE = '42501';
    END IF;
    SELECT COALESCE(
      pg_catalog.jsonb_agg(mission.id ORDER BY mission.created_at),
      '[]'::jsonb
    )
    INTO v_mission_ids
    FROM public.court_missions AS mission
    WHERE mission.verdict_id = p_verdict_id;
    RETURN pg_catalog.jsonb_build_object(
      'case_id', v_case_id,
      'verdict_id', p_verdict_id,
      'generation_version', v_verdict.generation_version,
      'status', 'verdict_ready',
      'mission_ids', v_mission_ids,
      'reused', true
    );
  END IF;

  IF v_case.workflow_status <> 'judging'
    OR v_case.safety_level = 'high_risk'
    OR v_verdict.generation_status <> 'in_progress'
    OR v_verdict.input_hash IS DISTINCT FROM p_input_hash
    OR v_verdict.model IS DISTINCT FROM p_model
    OR v_verdict.claimed_by_participant_id IS DISTINCT FROM v_participant_id
    OR v_verdict.lease_token IS DISTINCT FROM p_lease_token
    OR v_verdict.lease_expires_at <= pg_catalog.clock_timestamp()
  THEN
    RAISE EXCEPTION 'court verdict claim is no longer valid' USING ERRCODE = '22023';
  END IF;

  IF v_case.mode = 'solo' AND EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(p_missions_json) AS mission(value)
    WHERE mission.value ->> 'owner' <> 'applicant'
  ) THEN
    RAISE EXCEPTION 'solo verdict missions must belong to the applicant'
      USING ERRCODE = '22023';
  END IF;

  IF p_model <> 'couple-court-development-mock-v1' THEN
    SELECT reservation.* INTO v_provider_reservation
    FROM public.court_provider_reservations AS reservation
    WHERE reservation.verdict_id = p_verdict_id
    FOR UPDATE;
    IF NOT FOUND
      OR v_provider_reservation.case_id IS DISTINCT FROM v_case_id
      OR v_provider_reservation.input_hash IS DISTINCT FROM p_input_hash
      OR v_provider_reservation.provider_state <> 'result_staged'
      OR v_provider_reservation.provider_audit_state <> 'audited'
      OR v_provider_reservation.provider_audited_at IS NULL
      OR v_provider_reservation.staged_result_json IS DISTINCT FROM p_result_json
      OR v_provider_reservation.staged_missions_json IS DISTINCT FROM p_missions_json
      OR v_provider_reservation.staged_model IS DISTINCT FROM p_model
    THEN
      RAISE EXCEPTION 'court_provider_stage_required'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- A provider can conservatively discover sensitive content after a normal
  -- preflight. Promote the case without cancelling this exact fenced lease,
  -- withdraw publication, and persist the already-safe sensitive result in
  -- this same transaction. Independent safety changes still use mark(), which
  -- deliberately fences work generated under an older safety contract.
  IF v_case.safety_level = 'normal' AND v_result_safety_level = 'sensitive' THEN
    DELETE FROM public.amora_actions AS action
    USING public.court_missions AS mission,
          public.court_verdicts AS verdict
    WHERE verdict.case_id = v_case_id
      AND verdict.generation_status = 'superseded'
      AND mission.verdict_id = verdict.id
      AND mission.amora_action_id = action.id
      AND action.source = 'court';

    DELETE FROM public.court_missions AS mission
    USING public.court_verdicts AS verdict
    WHERE verdict.case_id = v_case_id
      AND verdict.generation_status = 'superseded'
      AND mission.verdict_id = verdict.id;

    UPDATE public.court_verdicts AS verdict
    SET result_json = public.court_redacted_verdict_result('sensitive')
    WHERE verdict.case_id = v_case_id
      AND verdict.generation_status = 'superseded';

    UPDATE public.court_cases
    SET safety_level = 'sensitive',
        safety_review_status = 'none',
        safety_categories = v_effective_safety_categories,
        lock_version = lock_version + 1
    WHERE id = v_case_id;

    DELETE FROM public.court_public_posts
    WHERE case_id = v_case_id;

    INSERT INTO public.court_case_events (
      case_id, actor_participant_id, event_type, metadata
    ) VALUES (
      v_case_id,
      v_participant_id,
      'safety_changed',
      pg_catalog.jsonb_build_object(
        'safety_level', 'sensitive',
        'safety_categories', pg_catalog.to_jsonb(v_effective_safety_categories),
        'from_status', 'judging',
        'to_status', 'judging',
        'reason_code', 'generated_sensitive',
        'status', 'generated_sensitive'
      )
    );
  END IF;

  FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_missions_json)
  LOOP
    INSERT INTO public.court_missions (
      case_id, verdict_id, owner_role, title, description, completion_check,
      due_in_minutes, fun_tag, related_feature
    ) VALUES (
      v_case_id,
      p_verdict_id,
      v_item ->> 'owner',
      pg_catalog.btrim(v_item ->> 'title'),
      pg_catalog.btrim(v_item ->> 'description'),
      pg_catalog.btrim(v_item ->> 'completionCheck'),
      (v_item ->> 'dueInMinutes')::integer,
      CASE WHEN pg_catalog.jsonb_typeof(v_item -> 'funTag') = 'null'
        THEN NULL ELSE v_item ->> 'funTag' END,
      v_item ->> 'relatedFeature'
    )
    RETURNING id INTO v_mission_id;
    v_mission_ids := v_mission_ids || pg_catalog.jsonb_build_array(v_mission_id);
  END LOOP;

  UPDATE public.court_verdicts
  SET generation_status = 'ready',
      result_json = p_result_json,
      terminal_lease_token = lease_token,
      lease_token = NULL,
      lease_expires_at = NULL,
      completed_at = pg_catalog.clock_timestamp(),
      failed_at = NULL,
      superseded_at = NULL,
      error_code = NULL
  WHERE id = p_verdict_id;

  IF p_model <> 'couple-court-development-mock-v1' THEN
    UPDATE public.court_provider_reservations
    SET provider_state = 'completed',
        staged_result_json = NULL,
        staged_missions_json = NULL,
        completed_at = pg_catalog.clock_timestamp(),
        failed_at = NULL,
        provider_error_code = NULL
    WHERE verdict_id = p_verdict_id
      AND provider_state = 'result_staged';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'court provider completion changed concurrently'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  UPDATE public.court_cases
  SET workflow_status = 'verdict_ready', lock_version = lock_version + 1
  WHERE id = v_case_id;

  INSERT INTO public.court_case_events (
    case_id, actor_participant_id, event_type, metadata
  ) VALUES (
    v_case_id, v_participant_id, 'verdict_ready',
    pg_catalog.jsonb_build_object(
      'from_status', 'judging',
      'to_status', 'verdict_ready',
      'mission_count', pg_catalog.jsonb_array_length(p_missions_json),
      'status', 'ready'
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'case_id', v_case_id,
    'verdict_id', p_verdict_id,
    'generation_version', v_verdict.generation_version,
    'status', 'verdict_ready',
    'mission_ids', v_mission_ids,
    'reused', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_court_verdict(
  p_verdict_id uuid,
  p_user_id uuid,
  p_lease_token uuid,
  p_error_code text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_case_id uuid;
  v_case_status text;
  v_verdict public.court_verdicts%ROWTYPE;
  v_participant_id uuid;
  v_provider_state text;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_verdict_id IS NULL OR p_user_id IS NULL OR p_lease_token IS NULL
    OR p_error_code IS NULL OR p_error_code !~ '^[a-z0-9_.-]{1,64}$'
  THEN
    RAISE EXCEPTION 'invalid court verdict failure arguments' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.profiles AS profile
  WHERE profile.id = p_user_id AND profile.account_deleting_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active court user is required' USING ERRCODE = '42501';
  END IF;

  SELECT verdict.case_id INTO v_case_id
  FROM public.court_verdicts AS verdict
  WHERE verdict.id = p_verdict_id;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT court_case.workflow_status INTO v_case_status
  FROM public.court_cases AS court_case
  WHERE court_case.id = v_case_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT participant.id INTO v_participant_id
  FROM public.court_participants AS participant
  WHERE participant.case_id = v_case_id
    AND participant.user_id = p_user_id
    AND participant.participation_status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court participant is required' USING ERRCODE = '42501';
  END IF;

  SELECT verdict.* INTO v_verdict
  FROM public.court_verdicts AS verdict
  WHERE verdict.id = p_verdict_id AND verdict.case_id = v_case_id
  FOR UPDATE;
  IF v_verdict.generation_status = 'failed' THEN
    IF v_verdict.terminal_lease_token IS DISTINCT FROM p_lease_token
      OR v_verdict.error_code IS DISTINCT FROM p_error_code
    THEN
      RAISE EXCEPTION 'court verdict failure fence mismatch'
        USING ERRCODE = '42501';
    END IF;
    RETURN true;
  END IF;
  IF v_verdict.generation_status <> 'in_progress'
    OR v_verdict.claimed_by_participant_id IS DISTINCT FROM v_participant_id
    OR v_verdict.lease_token IS DISTINCT FROM p_lease_token
  THEN
    RAISE EXCEPTION 'court verdict cannot be failed by this request'
      USING ERRCODE = '42501';
  END IF;

  SELECT reservation.provider_state INTO v_provider_state
  FROM public.court_provider_reservations AS reservation
  WHERE reservation.verdict_id = p_verdict_id
  FOR UPDATE;
  IF FOUND AND v_provider_state = 'result_staged' THEN
    -- The paid result is already durable. Preserve it for claim_status=staged
    -- recovery instead of converting a post-stage HTTP failure into data loss.
    RETURN false;
  END IF;

  PERFORM public.settle_court_provider_failure(p_verdict_id, p_error_code);

  UPDATE public.court_verdicts
  SET generation_status = 'failed',
      result_json = NULL,
      terminal_lease_token = lease_token,
      lease_token = NULL,
      lease_expires_at = NULL,
      completed_at = NULL,
      failed_at = pg_catalog.clock_timestamp(),
      superseded_at = NULL,
      error_code = p_error_code
  WHERE id = p_verdict_id;

  IF v_case_status = 'judging' THEN
    UPDATE public.court_cases
    SET workflow_status = 'statements_complete', lock_version = lock_version + 1
    WHERE id = v_case_id;
  END IF;

  INSERT INTO public.court_case_events (
    case_id, actor_participant_id, event_type, metadata
  ) VALUES (
    v_case_id, v_participant_id, 'verdict_failed',
    pg_catalog.jsonb_build_object(
      'from_status', v_case_status,
      'to_status', CASE WHEN v_case_status = 'judging'
        THEN 'statements_complete' ELSE v_case_status END,
      'reason_code', p_error_code,
      'status', 'failed'
    )
  );
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_court_provider_failure(
  p_verdict_id uuid,
  p_admin_user_id uuid,
  p_action text,
  p_reason_code text,
  p_confirmation text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_reservation public.court_provider_reservations%ROWTYPE;
  v_reconciled_at timestamptz;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_verdict_id IS NULL OR p_admin_user_id IS NULL
    OR p_action IS DISTINCT FROM 'allow_retry'
    OR p_reason_code IS NULL OR p_reason_code !~ '^[a-z0-9_]{1,64}$'
    OR p_confirmation IS DISTINCT FROM 'ALLOW_RETRY_AFTER_PROVIDER_REVIEW'
  THEN
    RAISE EXCEPTION 'invalid court provider reconciliation arguments'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.profiles AS profile
  WHERE profile.id = p_admin_user_id
    AND profile.account_deleting_at IS NULL
    AND profile.is_admin = true
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court provider reconciliation requires an active admin'
      USING ERRCODE = '42501';
  END IF;

  SELECT reservation.* INTO v_reservation
  FROM public.court_provider_reservations AS reservation
  WHERE reservation.verdict_id = p_verdict_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court provider reservation is unavailable'
      USING ERRCODE = '22023';
  END IF;

  IF v_reservation.provider_state = 'retry_allowed' THEN
    IF v_reservation.reconciliation_action = p_action
      AND v_reservation.reconciliation_reason_code = p_reason_code
      AND v_reservation.reconciliation_confirmation = p_confirmation
    THEN
      RETURN pg_catalog.jsonb_build_object(
        'verdict_id', p_verdict_id,
        'case_id', v_reservation.case_id,
        'provider_state', 'retry_allowed',
        'action', 'allow_retry',
        'reason_code', v_reservation.reconciliation_reason_code,
        'confirmation', v_reservation.reconciliation_confirmation,
        'reconciled_at', v_reservation.reconciled_at,
        'reused', true
      );
    END IF;
    RAISE EXCEPTION 'court_provider_reconciliation_already_recorded'
      USING ERRCODE = '55000';
  END IF;
  IF v_reservation.provider_state <> 'failed_unknown' THEN
    RAISE EXCEPTION 'court_provider_reconciliation_not_required'
      USING ERRCODE = '55000';
  END IF;
  IF v_reservation.provider_error_code = 'safety_escalation_failed' THEN
    RAISE EXCEPTION 'court_provider_safety_remediation_required'
      USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.court_verdicts AS verdict
    WHERE verdict.id = p_verdict_id
      AND verdict.case_id = v_reservation.case_id
      AND verdict.generation_status = 'failed'
  ) THEN
    RAISE EXCEPTION 'court provider failed verdict is unavailable'
      USING ERRCODE = '55000';
  END IF;

  v_reconciled_at := pg_catalog.clock_timestamp();
  UPDATE public.court_provider_reservations
  SET provider_state = 'retry_allowed',
      reconciled_at = v_reconciled_at,
      reconciled_by_user_id = p_admin_user_id,
      reconciliation_action = 'allow_retry',
      reconciliation_reason_code = p_reason_code,
      reconciliation_confirmation = p_confirmation
  WHERE verdict_id = p_verdict_id
    AND provider_state = 'failed_unknown';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court provider reconciliation changed concurrently'
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.court_case_events (
    case_id, actor_participant_id, event_type, metadata
  ) VALUES (
    v_reservation.case_id,
    NULL,
    'provider_reconciled',
    pg_catalog.jsonb_build_object(
      'from_status', 'failed_unknown',
      'to_status', 'retry_allowed',
      'reason_code', p_reason_code,
      'status', 'allow_retry'
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'verdict_id', p_verdict_id,
    'case_id', v_reservation.case_id,
    'provider_state', 'retry_allowed',
    'action', 'allow_retry',
    'reason_code', p_reason_code,
    'confirmation', p_confirmation,
    'reconciled_at', v_reconciled_at,
    'reused', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_court_mission_status(
  p_mission_id uuid,
  p_user_id uuid,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_case_id uuid;
  v_case_status text;
  v_mission public.court_missions%ROWTYPE;
  v_participant public.court_participants%ROWTYPE;
  v_existing_status text;
  v_required_count integer;
  v_accepted_count integer;
  v_completed_count integer;
  v_dismissed_count integer;
  v_global_status text;
  v_next_case_status text;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_mission_id IS NULL OR p_user_id IS NULL OR p_status IS NULL
    OR p_status NOT IN ('accepted', 'completed', 'dismissed')
  THEN
    RAISE EXCEPTION 'invalid court mission status arguments' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.profiles AS profile
  WHERE profile.id = p_user_id AND profile.account_deleting_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active court user is required' USING ERRCODE = '42501';
  END IF;

  SELECT mission.case_id INTO v_case_id
  FROM public.court_missions AS mission
  JOIN public.court_verdicts AS verdict
    ON verdict.id = mission.verdict_id
   AND verdict.case_id = mission.case_id
   AND verdict.generation_status = 'ready'
  WHERE mission.id = p_mission_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court mission is unavailable' USING ERRCODE = '22023';
  END IF;

  SELECT court_case.workflow_status INTO v_case_status
  FROM public.court_cases AS court_case
  WHERE court_case.id = v_case_id
  FOR UPDATE;
  IF NOT FOUND OR v_case_status NOT IN ('verdict_ready', 'mission_active', 'resolved') THEN
    RAISE EXCEPTION 'court mission is unavailable in this state' USING ERRCODE = '42501';
  END IF;

  SELECT participant.* INTO v_participant
  FROM public.court_participants AS participant
  WHERE participant.case_id = v_case_id
    AND participant.user_id = p_user_id
    AND participant.participation_status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court participant is required' USING ERRCODE = '42501';
  END IF;

  SELECT mission.* INTO v_mission
  FROM public.court_missions AS mission
  JOIN public.court_verdicts AS verdict
    ON verdict.id = mission.verdict_id
   AND verdict.case_id = mission.case_id
   AND verdict.generation_status = 'ready'
  WHERE mission.id = p_mission_id AND mission.case_id = v_case_id
  FOR UPDATE;
  IF v_mission.owner_role <> 'both' AND v_mission.owner_role <> v_participant.role THEN
    RAISE EXCEPTION 'court mission belongs to another role' USING ERRCODE = '42501';
  END IF;

  SELECT completion.completion_status INTO v_existing_status
  FROM public.court_mission_completions AS completion
  WHERE completion.mission_id = p_mission_id
    AND completion.participant_id = v_participant.id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_status = p_status THEN
      RETURN pg_catalog.jsonb_build_object(
        'mission_id', p_mission_id,
        'participant_status', p_status,
        'mission_status', v_mission.mission_status,
        'case_status', v_case_status
      );
    END IF;
    IF v_existing_status IN ('completed', 'dismissed')
      OR (v_existing_status = 'accepted' AND p_status = 'accepted')
    THEN
      RAISE EXCEPTION 'court mission participant status is terminal'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.court_mission_completions (
    case_id, mission_id, participant_id, completion_status,
    accepted_at, completed_at, dismissed_at
  ) VALUES (
    v_case_id,
    p_mission_id,
    v_participant.id,
    p_status,
    CASE WHEN p_status IN ('accepted', 'completed')
      THEN pg_catalog.clock_timestamp() ELSE NULL END,
    CASE WHEN p_status = 'completed' THEN pg_catalog.clock_timestamp() ELSE NULL END,
    CASE WHEN p_status = 'dismissed' THEN pg_catalog.clock_timestamp() ELSE NULL END
  )
  ON CONFLICT (mission_id, participant_id) DO UPDATE
  SET completion_status = EXCLUDED.completion_status,
      accepted_at = CASE
        WHEN EXCLUDED.completion_status IN ('accepted', 'completed')
          THEN COALESCE(public.court_mission_completions.accepted_at, EXCLUDED.accepted_at)
        ELSE public.court_mission_completions.accepted_at
      END,
      completed_at = EXCLUDED.completed_at,
      dismissed_at = EXCLUDED.dismissed_at;

  SELECT CASE WHEN v_mission.owner_role = 'both' THEN pg_catalog.count(*) ELSE 1 END::integer
  INTO v_required_count
  FROM public.court_participants AS participant
  WHERE participant.case_id = v_case_id
    AND participant.participation_status = 'active'
    AND (v_mission.owner_role = 'both' OR participant.role = v_mission.owner_role);

  SELECT
    pg_catalog.count(*) FILTER (
      WHERE completion.completion_status IN ('accepted', 'completed')
    )::integer,
    pg_catalog.count(*) FILTER (
      WHERE completion.completion_status = 'completed'
    )::integer,
    pg_catalog.count(*) FILTER (
      WHERE completion.completion_status = 'dismissed'
    )::integer
  INTO v_accepted_count, v_completed_count, v_dismissed_count
  FROM public.court_mission_completions AS completion
  JOIN public.court_participants AS participant
    ON participant.id = completion.participant_id
   AND participant.case_id = v_case_id
   AND participant.participation_status = 'active'
  WHERE completion.mission_id = p_mission_id
    AND (v_mission.owner_role = 'both' OR participant.role = v_mission.owner_role);

  v_global_status := CASE
    WHEN v_completed_count = v_required_count THEN 'completed'
    WHEN v_dismissed_count > 0 THEN 'dismissed'
    WHEN v_accepted_count > 0 THEN 'accepted'
    ELSE 'proposed'
  END;

  UPDATE public.court_missions
  SET mission_status = v_global_status,
      accepted_at = CASE WHEN v_global_status IN ('accepted', 'completed')
        THEN COALESCE(accepted_at, pg_catalog.clock_timestamp()) ELSE NULL END,
      completed_at = CASE WHEN v_global_status = 'completed'
        THEN COALESCE(completed_at, pg_catalog.clock_timestamp()) ELSE NULL END,
      dismissed_at = CASE WHEN v_global_status = 'dismissed'
        THEN COALESCE(dismissed_at, pg_catalog.clock_timestamp()) ELSE NULL END
  WHERE id = p_mission_id;

  v_next_case_status := v_case_status;
  IF v_case_status = 'verdict_ready' AND v_global_status IN ('accepted', 'completed') THEN
    v_next_case_status := 'mission_active';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.court_missions AS mission
    JOIN public.court_verdicts AS verdict
      ON verdict.id = mission.verdict_id
     AND verdict.case_id = mission.case_id
     AND verdict.generation_status = 'ready'
    WHERE mission.case_id = v_case_id
      AND mission.mission_status IN ('proposed', 'accepted')
  ) THEN
    v_next_case_status := 'resolved';
  END IF;
  IF v_next_case_status IS DISTINCT FROM v_case_status THEN
    UPDATE public.court_cases
    SET workflow_status = v_next_case_status, lock_version = lock_version + 1
    WHERE id = v_case_id;
  END IF;

  INSERT INTO public.court_case_events (
    case_id, actor_participant_id, event_type, metadata
  ) VALUES (
    v_case_id, v_participant.id, 'mission_status_changed',
    pg_catalog.jsonb_build_object(
      'role', v_participant.role,
      'status', p_status,
      'from_status', v_case_status,
      'to_status', v_next_case_status
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'mission_id', p_mission_id,
    'participant_status', p_status,
    'mission_status', v_global_status,
    'case_status', v_next_case_status
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.link_court_mission_action(
  p_mission_id uuid,
  p_user_id uuid,
  p_action_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_case_id uuid;
  v_case_couple_id uuid;
  v_mission public.court_missions%ROWTYPE;
  v_participant public.court_participants%ROWTYPE;
  v_action_couple_id uuid;
  v_action_source text;
  v_action_created_by uuid;
  v_profile_couple_id uuid;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_mission_id IS NULL OR p_user_id IS NULL
    OR p_action_id IS NULL OR p_action_id !~ '^[A-Za-z0-9_-]{4,120}$'
  THEN
    RAISE EXCEPTION 'invalid court mission action arguments' USING ERRCODE = '22023';
  END IF;

  SELECT profile.couple_id INTO v_profile_couple_id
  FROM public.profiles AS profile
  WHERE profile.id = p_user_id AND profile.account_deleting_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active court user is required' USING ERRCODE = '42501';
  END IF;

  SELECT mission.case_id INTO v_case_id
  FROM public.court_missions AS mission
  JOIN public.court_verdicts AS verdict
    ON verdict.id = mission.verdict_id
   AND verdict.case_id = mission.case_id
   AND verdict.generation_status = 'ready'
  WHERE mission.id = p_mission_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court mission is unavailable' USING ERRCODE = '22023';
  END IF;

  SELECT court_case.couple_id INTO v_case_couple_id
  FROM public.court_cases AS court_case
  WHERE court_case.id = v_case_id
    AND court_case.workflow_status IN ('verdict_ready', 'mission_active', 'resolved')
  FOR UPDATE;
  IF NOT FOUND OR v_case_couple_id IS NULL
    OR v_profile_couple_id IS DISTINCT FROM v_case_couple_id
  THEN
    RAISE EXCEPTION 'court mission has no action scope' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.court_cases AS court_case
    WHERE court_case.id = v_case_id
      AND court_case.mode = 'couple'
      AND (
        SELECT pg_catalog.count(*)
        FROM public.court_participants AS scoped_participant
        JOIN public.profiles AS scoped_profile
          ON scoped_profile.id = scoped_participant.user_id
        WHERE scoped_participant.case_id = court_case.id
          AND scoped_participant.participation_status = 'active'
          AND scoped_profile.account_deleting_at IS NULL
          AND scoped_profile.couple_id = court_case.couple_id
      ) <> 2
  ) THEN
    RAISE EXCEPTION 'court mission couple scope is inconsistent'
      USING ERRCODE = '42501';
  END IF;

  SELECT participant.* INTO v_participant
  FROM public.court_participants AS participant
  WHERE participant.case_id = v_case_id
    AND participant.user_id = p_user_id
    AND participant.participation_status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court participant is required' USING ERRCODE = '42501';
  END IF;

  SELECT mission.* INTO v_mission
  FROM public.court_missions AS mission
  JOIN public.court_verdicts AS verdict
    ON verdict.id = mission.verdict_id
   AND verdict.case_id = mission.case_id
   AND verdict.generation_status = 'ready'
  WHERE mission.id = p_mission_id AND mission.case_id = v_case_id
  FOR UPDATE;
  IF v_mission.related_feature IS DISTINCT FROM 'task'
    OR (v_mission.owner_role <> 'both' AND v_mission.owner_role <> v_participant.role)
  THEN
    RAISE EXCEPTION 'court mission cannot be linked by this participant'
      USING ERRCODE = '42501';
  END IF;
  IF v_mission.amora_action_id IS NOT NULL THEN
    IF v_mission.amora_action_id = p_action_id THEN
      RETURN pg_catalog.jsonb_build_object(
        'mission_id', p_mission_id,
        'action_id', p_action_id,
        'reused', true
      );
    END IF;
    RAISE EXCEPTION 'court mission already has an action' USING ERRCODE = '23505';
  END IF;

  SELECT action.couple_id, action.source, action.created_by
  INTO v_action_couple_id, v_action_source, v_action_created_by
  FROM public.amora_actions AS action
  WHERE action.id = p_action_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_action_couple_id IS DISTINCT FROM v_case_couple_id
    OR v_action_source IS DISTINCT FROM 'court'
    OR v_action_created_by IS DISTINCT FROM p_user_id
  THEN
    RAISE EXCEPTION 'court action is outside the participant boundary'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.court_missions
  SET amora_action_id = p_action_id
  WHERE id = p_mission_id;

  INSERT INTO public.court_case_events (
    case_id, actor_participant_id, event_type, metadata
  ) VALUES (
    v_case_id, v_participant.id, 'mission_action_linked',
    pg_catalog.jsonb_build_object('role', v_participant.role, 'status', 'linked')
  );

  RETURN pg_catalog.jsonb_build_object(
    'mission_id', p_mission_id,
    'action_id', p_action_id,
    'reused', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_or_link_court_mission_action(
  p_mission_id uuid,
  p_user_id uuid,
  p_confirm_shared boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_case_id uuid;
  v_case public.court_cases%ROWTYPE;
  v_mission public.court_missions%ROWTYPE;
  v_participant public.court_participants%ROWTYPE;
  v_profile_couple_id uuid;
  v_action_id text;
  v_action public.amora_actions%ROWTYPE;
  v_reused boolean := false;
  v_creator_authorized boolean := false;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_mission_id IS NULL OR p_user_id IS NULL OR p_confirm_shared IS NULL THEN
    RAISE EXCEPTION 'invalid court mission action arguments' USING ERRCODE = '22023';
  END IF;

  SELECT profile.couple_id INTO v_profile_couple_id
  FROM public.profiles AS profile
  WHERE profile.id = p_user_id
    AND profile.account_deleting_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active court user is required' USING ERRCODE = '42501';
  END IF;

  SELECT mission.case_id INTO v_case_id
  FROM public.court_missions AS mission
  JOIN public.court_verdicts AS verdict
    ON verdict.id = mission.verdict_id
   AND verdict.case_id = mission.case_id
   AND verdict.generation_status = 'ready'
  WHERE mission.id = p_mission_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court mission is unavailable' USING ERRCODE = '22023';
  END IF;

  SELECT court_case.* INTO v_case
  FROM public.court_cases AS court_case
  WHERE court_case.id = v_case_id
    AND court_case.workflow_status IN ('verdict_ready', 'mission_active', 'resolved')
    AND court_case.safety_level <> 'high_risk'
  FOR UPDATE;
  IF NOT FOUND OR v_case.couple_id IS NULL
    OR v_profile_couple_id IS DISTINCT FROM v_case.couple_id
  THEN
    RAISE EXCEPTION 'court mission has no current action scope' USING ERRCODE = '42501';
  END IF;
  IF v_case.mode = 'couple' AND (
    SELECT pg_catalog.count(*)
    FROM public.court_participants AS scoped_participant
    JOIN public.profiles AS scoped_profile
      ON scoped_profile.id = scoped_participant.user_id
    WHERE scoped_participant.case_id = v_case_id
      AND scoped_participant.participation_status = 'active'
      AND scoped_profile.account_deleting_at IS NULL
      AND scoped_profile.couple_id = v_case.couple_id
  ) <> 2 THEN
    RAISE EXCEPTION 'court mission couple scope is inconsistent'
      USING ERRCODE = '42501';
  END IF;
  IF v_case.mode = 'solo' AND NOT p_confirm_shared THEN
    RAISE EXCEPTION 'shared court action confirmation is required' USING ERRCODE = '22023';
  END IF;

  SELECT participant.* INTO v_participant
  FROM public.court_participants AS participant
  WHERE participant.case_id = v_case_id
    AND participant.user_id = p_user_id
    AND participant.participation_status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court participant is required' USING ERRCODE = '42501';
  END IF;

  SELECT mission.* INTO v_mission
  FROM public.court_missions AS mission
  JOIN public.court_verdicts AS verdict
    ON verdict.id = mission.verdict_id
   AND verdict.case_id = mission.case_id
   AND verdict.generation_status = 'ready'
  WHERE mission.id = p_mission_id
    AND mission.case_id = v_case_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_mission.related_feature IS DISTINCT FROM 'task'
    OR (
      v_mission.owner_role <> 'both'
      AND v_mission.owner_role <> v_participant.role
    )
  THEN
    RAISE EXCEPTION 'court mission cannot become an action for this participant'
      USING ERRCODE = '42501';
  END IF;

  IF v_mission.amora_action_id IS NOT NULL THEN
    SELECT action.* INTO v_action
    FROM public.amora_actions AS action
    WHERE action.id = v_mission.amora_action_id
    FOR UPDATE;
    IF NOT FOUND
      OR v_action.couple_id IS DISTINCT FROM v_case.couple_id
      OR v_action.source IS DISTINCT FROM 'court'
    THEN
      RAISE EXCEPTION 'linked court action is outside its case boundary'
        USING ERRCODE = '42501';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'mission_id', p_mission_id,
      'action', pg_catalog.jsonb_build_object(
        'id', v_action.id,
        'title', v_action.title,
        'due_date', v_action.due_date,
        'status', v_action.status
      ),
      'reused', true
    );
  END IF;

  v_action_id := 'court_' || p_mission_id::text;
  INSERT INTO public.amora_actions (
    id, couple_id, title, description, due_date, category_key,
    priority, status, source, href, metadata, created_by
  ) VALUES (
    v_action_id,
    v_case.couple_id,
    v_mission.title,
    v_mission.description,
    pg_catalog.to_char(
      pg_catalog.timezone('Asia/Seoul', pg_catalog.clock_timestamp())
        + pg_catalog.make_interval(mins => v_mission.due_in_minutes),
      'YYYY-MM-DD'
    ),
    'couple_court',
    'medium',
    'open',
    'court',
    '/wedding/couple-court/cases/' || v_case_id::text || '/mission',
    pg_catalog.jsonb_build_object('court_mission_id', p_mission_id),
    p_user_id
  )
  ON CONFLICT (id) DO NOTHING
  RETURNING * INTO v_action;
  v_reused := NOT FOUND;

  IF v_reused THEN
    SELECT action.* INTO v_action
    FROM public.amora_actions AS action
    WHERE action.id = v_action_id
    FOR UPDATE;
    IF NOT FOUND
      OR v_action.couple_id IS DISTINCT FROM v_case.couple_id
      OR v_action.source IS DISTINCT FROM 'court'
      OR v_action.metadata ->> 'court_mission_id' IS DISTINCT FROM p_mission_id::text
    THEN
      RAISE EXCEPTION 'court action identity collision' USING ERRCODE = '23505';
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.court_participants AS participant
      WHERE participant.case_id = v_case_id
        AND participant.user_id = v_action.created_by
        AND participant.participation_status = 'active'
        AND (
          v_mission.owner_role = 'both'
          OR participant.role = v_mission.owner_role
        )
    ) INTO v_creator_authorized;
    IF NOT v_creator_authorized THEN
      RAISE EXCEPTION 'existing court action has no authorized creator'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  UPDATE public.court_missions
  SET amora_action_id = v_action_id
  WHERE id = p_mission_id
    AND amora_action_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court mission action link changed concurrently'
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.court_case_events (
    case_id, actor_participant_id, event_type, metadata
  ) VALUES (
    v_case_id,
    v_participant.id,
    'mission_action_linked',
    pg_catalog.jsonb_build_object(
      'role', v_participant.role,
      'status', CASE WHEN v_reused THEN 'recovered' ELSE 'created' END
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'mission_id', p_mission_id,
    'action', pg_catalog.jsonb_build_object(
      'id', v_action.id,
      'title', v_action.title,
      'due_date', v_action.due_date,
      'status', v_action.status
    ),
    'reused', v_reused
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_court_followup(
  p_case_id uuid,
  p_user_id uuid,
  p_satisfaction integer,
  p_remaining_issue text,
  p_note text,
  p_safety_level text,
  p_safety_categories text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_case public.court_cases%ROWTYPE;
  v_participant_id uuid;
  v_verdict public.court_verdicts%ROWTYPE;
  v_verdict_id uuid;
  v_followup_id uuid;
  v_followup_available_at timestamptz;
  v_safety_path boolean;
  v_safety_result jsonb;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_case_id IS NULL OR p_user_id IS NULL OR p_satisfaction IS NULL
    OR p_satisfaction NOT BETWEEN 1 AND 5
    OR pg_catalog.char_length(COALESCE(p_remaining_issue, '')) > 2000
    OR pg_catalog.char_length(COALESCE(p_note, '')) > 2000
    OR p_safety_level IS NULL
    OR p_safety_level NOT IN ('normal', 'sensitive', 'high_risk')
    OR NOT public.court_safety_categories_are_valid(
      COALESCE(p_safety_categories, ARRAY[]::text[])
    )
  THEN
    RAISE EXCEPTION 'invalid court followup arguments' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.profiles AS profile
  WHERE profile.id = p_user_id AND profile.account_deleting_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active court user is required' USING ERRCODE = '42501';
  END IF;

  SELECT court_case.* INTO v_case
  FROM public.court_cases AS court_case
  WHERE court_case.id = p_case_id
  FOR UPDATE;
  IF NOT FOUND OR v_case.workflow_status = 'archived' THEN
    RAISE EXCEPTION 'court followup is unavailable in this state'
      USING ERRCODE = '42501';
  END IF;

  SELECT participant.id INTO v_participant_id
  FROM public.court_participants AS participant
  WHERE participant.case_id = p_case_id
    AND participant.user_id = p_user_id
    AND participant.participation_status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court participant is required' USING ERRCODE = '42501';
  END IF;

  SELECT verdict.* INTO v_verdict
  FROM public.court_verdicts AS verdict
  WHERE verdict.case_id = p_case_id AND verdict.generation_status = 'ready'
  ORDER BY verdict.generation_version DESC
  LIMIT 1
  FOR UPDATE;
  v_verdict_id := v_verdict.id;

  -- Only a newly detected safety signal may bypass the ordinary check-in
  -- window. A case that was already promoted to sensitive still uses the
  -- 72-hour/one-per-verdict contract when this submission itself is normal.
  v_safety_path := p_safety_level <> 'normal';

  IF NOT v_safety_path THEN
    IF v_case.workflow_status NOT IN ('verdict_ready', 'mission_active', 'resolved')
      OR v_verdict_id IS NULL
    THEN
      RAISE EXCEPTION 'court followup is unavailable in this state'
        USING ERRCODE = '42501';
    END IF;

    v_followup_available_at := v_verdict.completed_at + interval '72 hours';
    IF pg_catalog.clock_timestamp() < v_followup_available_at THEN
      RAISE EXCEPTION 'court_followup_too_early' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.court_followups AS followup
      WHERE followup.participant_id = v_participant_id
        AND followup.verdict_id = v_verdict_id
    ) THEN
      RAISE EXCEPTION 'court_followup_already_recorded' USING ERRCODE = '23505';
    END IF;
  ELSE
    -- Safety reports must not be rejected by ordinary verdict state, the
    -- 72-hour product check-in window, or a prior ordinary followup. Keep the
    -- safety record case-scoped because escalation may supersede/delete the
    -- current verdict in this same transaction.
    v_verdict_id := NULL;
  END IF;

  INSERT INTO public.court_followups (
    case_id, participant_id, verdict_id, satisfaction, remaining_issue, note
  ) VALUES (
    p_case_id,
    v_participant_id,
    v_verdict_id,
    p_satisfaction,
    NULLIF(pg_catalog.btrim(COALESCE(p_remaining_issue, '')), ''),
    NULLIF(pg_catalog.btrim(COALESCE(p_note, '')), '')
  )
  RETURNING id INTO v_followup_id;

  INSERT INTO public.court_case_events (
    case_id, actor_participant_id, event_type, metadata
  ) VALUES (
    p_case_id, v_participant_id, 'followup_recorded',
    pg_catalog.jsonb_build_object('status', 'recorded')
  );

  v_safety_result := public.mark_court_case_safety(
    p_case_id,
    p_user_id,
    p_safety_level,
    COALESCE(p_safety_categories, ARRAY[]::text[])
  );

  RETURN pg_catalog.jsonb_build_object(
    'followup_id', v_followup_id,
    'case_id', p_case_id,
    'status', 'recorded',
    'case_status', v_safety_result ->> 'status',
    'safety_level', v_safety_result ->> 'safety_level',
    'safety_categories', v_safety_result -> 'safety_categories',
    'followup_available_at', v_followup_available_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.prepare_court_public_snapshot(
  p_case_id uuid,
  p_user_id uuid,
  p_snapshot_json jsonb,
  p_snapshot_hash text,
  p_snapshot_version integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_case public.court_cases%ROWTYPE;
  v_participant_id uuid;
  v_expected_version integer;
  v_public_post_id uuid;
  v_latest_post public.court_public_posts%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_case_id IS NULL OR p_user_id IS NULL
    OR p_snapshot_hash IS NULL OR p_snapshot_hash !~ '^[a-f0-9]{64}$'
    OR p_snapshot_version IS NULL
    OR NOT public.court_public_snapshot_is_valid(p_snapshot_json)
  THEN
    RAISE EXCEPTION 'invalid court public snapshot arguments' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.profiles AS profile
  WHERE profile.id = p_user_id AND profile.account_deleting_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active court user is required' USING ERRCODE = '42501';
  END IF;

  SELECT court_case.* INTO v_case
  FROM public.court_cases AS court_case
  WHERE court_case.id = p_case_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_case.workflow_status NOT IN ('verdict_ready', 'mission_active', 'resolved')
    OR v_case.safety_level <> 'normal'
  THEN
    RAISE EXCEPTION 'court case is not eligible for publication' USING ERRCODE = '42501';
  END IF;

  SELECT participant.id INTO v_participant_id
  FROM public.court_participants AS participant
  WHERE participant.case_id = p_case_id
    AND participant.user_id = p_user_id
    AND participant.participation_status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court participant is required' USING ERRCODE = '42501';
  END IF;

  IF p_snapshot_json ->> 'category' IS DISTINCT FROM v_case.category
    OR p_snapshot_json ->> 'tone' IS DISTINCT FROM v_case.tone
    OR p_snapshot_json ->> 'mode' IS DISTINCT FROM v_case.mode
    OR (p_snapshot_json ->> 'provisional')::boolean IS DISTINCT FROM (v_case.mode = 'solo')
  THEN
    RAISE EXCEPTION 'public snapshot does not match the private case contract'
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.court_verdicts AS verdict
    WHERE verdict.case_id = p_case_id AND verdict.generation_status = 'ready'
  ) THEN
    RAISE EXCEPTION 'ready verdict is required for a public snapshot'
      USING ERRCODE = '22023';
  END IF;

  SELECT post.* INTO v_latest_post
  FROM public.court_public_posts AS post
  WHERE post.case_id = p_case_id
  ORDER BY post.snapshot_version DESC
  LIMIT 1;

  IF v_latest_post.id IS NOT NULL
    AND v_latest_post.snapshot_hash = p_snapshot_hash
  THEN
    IF v_latest_post.sanitized_snapshot_json IS DISTINCT FROM p_snapshot_json THEN
      RAISE EXCEPTION 'court_public_snapshot_hash_mismatch'
        USING ERRCODE = '42501';
    END IF;
    IF v_latest_post.status IN (
      'awaiting_consents', 'pending_review', 'published'
    ) THEN
      RETURN pg_catalog.jsonb_build_object(
        'id', v_latest_post.id,
        'public_post_id', v_latest_post.id,
        'snapshot_hash', v_latest_post.snapshot_hash,
        'snapshot_version', v_latest_post.snapshot_version,
        'status', v_latest_post.status,
        'reused', true
      );
    END IF;
  END IF;

  -- p_snapshot_version remains in the signature for rolling app compatibility,
  -- but the locked database row owns sequencing so concurrent callers cannot
  -- race on a stale client-side max(version)+1 calculation.
  v_expected_version := COALESCE(v_latest_post.snapshot_version, 0) + 1;
  IF v_expected_version > 100 THEN
    RAISE EXCEPTION 'court_public_snapshot_version_exhausted'
      USING ERRCODE = '54000';
  END IF;

  UPDATE public.court_public_posts
  SET status = 'hidden', hidden_at = COALESCE(hidden_at, pg_catalog.clock_timestamp())
  WHERE case_id = p_case_id
    AND status IN ('awaiting_consents', 'pending_review', 'published');
  UPDATE public.court_public_consents AS consent
  SET revoked_at = COALESCE(consent.revoked_at, pg_catalog.clock_timestamp())
  FROM public.court_public_posts AS post
  WHERE post.case_id = p_case_id
    AND consent.public_post_id = post.id
    AND consent.revoked_at IS NULL;

  INSERT INTO public.court_public_posts (
    case_id, sanitized_snapshot_json, snapshot_hash, snapshot_version,
    status, safety_level, moderation_status
  ) VALUES (
    p_case_id, p_snapshot_json, p_snapshot_hash, v_expected_version,
    'awaiting_consents', 'normal', 'pending'
  )
  RETURNING id INTO v_public_post_id;

  INSERT INTO public.court_case_events (
    case_id, actor_participant_id, event_type, metadata
  ) VALUES (
    p_case_id, v_participant_id, 'public_snapshot_prepared',
    pg_catalog.jsonb_build_object(
      'snapshot_version', v_expected_version,
      'status', 'awaiting_consents'
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'id', v_public_post_id,
    'public_post_id', v_public_post_id,
    'snapshot_hash', p_snapshot_hash,
    'snapshot_version', v_expected_version,
    'status', 'awaiting_consents',
    'reused', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_court_public_consent(
  p_public_post_id uuid,
  p_user_id uuid,
  p_snapshot_hash text,
  p_consented boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_case_id uuid;
  v_case public.court_cases%ROWTYPE;
  v_post public.court_public_posts%ROWTYPE;
  v_participant_id uuid;
  v_participant_count integer;
  v_required_participant_count integer;
  v_consent_count integer;
  v_next_status text;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_public_post_id IS NULL OR p_user_id IS NULL OR p_consented IS NULL
    OR p_snapshot_hash IS NULL OR p_snapshot_hash !~ '^[a-f0-9]{64}$'
  THEN
    RAISE EXCEPTION 'invalid court public consent arguments' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.profiles AS profile
  WHERE profile.id = p_user_id AND profile.account_deleting_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active court user is required' USING ERRCODE = '42501';
  END IF;

  SELECT post.case_id INTO v_case_id
  FROM public.court_public_posts AS post
  WHERE post.id = p_public_post_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court public post is unavailable' USING ERRCODE = '22023';
  END IF;

  SELECT court_case.* INTO v_case
  FROM public.court_cases AS court_case
  WHERE court_case.id = v_case_id
  FOR UPDATE;
  IF NOT FOUND OR v_case.workflow_status = 'archived' OR v_case.safety_level <> 'normal' THEN
    RAISE EXCEPTION 'court case is not eligible for publication' USING ERRCODE = '42501';
  END IF;

  SELECT post.* INTO v_post
  FROM public.court_public_posts AS post
  WHERE post.id = p_public_post_id AND post.case_id = v_case_id
  FOR UPDATE;
  IF NOT FOUND OR v_post.snapshot_hash IS DISTINCT FROM p_snapshot_hash
    OR v_post.status IN ('hidden', 'rejected')
  THEN
    RAISE EXCEPTION 'court public snapshot is no longer current' USING ERRCODE = '22023';
  END IF;

  SELECT participant.id INTO v_participant_id
  FROM public.court_participants AS participant
  WHERE participant.case_id = v_case_id
    AND participant.user_id = p_user_id
    AND participant.participation_status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court participant is required' USING ERRCODE = '42501';
  END IF;

  SELECT pg_catalog.count(*)::integer INTO v_participant_count
  FROM public.court_participants AS participant
  WHERE participant.case_id = v_case_id AND participant.participation_status = 'active';
  v_required_participant_count := CASE v_case.mode
    WHEN 'solo' THEN 1 ELSE 2 END;
  IF v_participant_count <> v_required_participant_count THEN
    RAISE EXCEPTION 'all required court participants are required for publication'
      USING ERRCODE = '22023';
  END IF;

  IF p_consented THEN
    INSERT INTO public.court_public_consents (
      public_post_id, participant_id, snapshot_hash, consented_at, revoked_at
    ) VALUES (
      p_public_post_id, v_participant_id, p_snapshot_hash,
      pg_catalog.clock_timestamp(), NULL
    )
    ON CONFLICT (public_post_id, participant_id, snapshot_hash) DO UPDATE
    SET consented_at = EXCLUDED.consented_at, revoked_at = NULL;
  ELSE
    UPDATE public.court_public_consents
    SET revoked_at = COALESCE(revoked_at, pg_catalog.clock_timestamp())
    WHERE public_post_id = p_public_post_id
      AND participant_id = v_participant_id
      AND snapshot_hash = p_snapshot_hash;
  END IF;

  SELECT pg_catalog.count(DISTINCT consent.participant_id)::integer
  INTO v_consent_count
  FROM public.court_public_consents AS consent
  JOIN public.court_participants AS participant
    ON participant.id = consent.participant_id
   AND participant.case_id = v_case_id
   AND participant.participation_status = 'active'
  WHERE consent.public_post_id = p_public_post_id
    AND consent.snapshot_hash = p_snapshot_hash
    AND consent.revoked_at IS NULL;

  IF NOT p_consented AND v_post.status = 'published' THEN
    v_next_status := 'hidden';
    UPDATE public.court_public_posts
    SET status = 'hidden', hidden_at = pg_catalog.clock_timestamp()
    WHERE id = p_public_post_id;
  ELSIF v_post.status = 'published' THEN
    v_next_status := 'published';
  ELSE
    v_next_status := CASE WHEN v_consent_count = v_required_participant_count
      THEN 'pending_review' ELSE 'awaiting_consents' END;
    UPDATE public.court_public_posts
    SET status = v_next_status
    WHERE id = p_public_post_id AND status <> 'published';
  END IF;

  INSERT INTO public.court_case_events (
    case_id, actor_participant_id, event_type, metadata
  ) VALUES (
    v_case_id, v_participant_id, 'public_consent_changed',
    pg_catalog.jsonb_build_object(
      'snapshot_version', v_post.snapshot_version,
      'consent', p_consented,
      'status', v_next_status
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'public_post_id', p_public_post_id,
    'snapshot_hash', p_snapshot_hash,
    'consented', p_consented,
    'consent_count', v_consent_count,
    'status', v_next_status
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.review_court_public_post(
  p_public_post_id uuid,
  p_reviewer_user_id uuid,
  p_decision text,
  p_reason_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_case_id uuid;
  v_post public.court_public_posts%ROWTYPE;
  v_next_status text;
  v_moderation_status text;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_public_post_id IS NULL OR p_reviewer_user_id IS NULL
    OR p_decision IS NULL OR p_decision NOT IN ('approve', 'reject', 'hidden')
    OR (p_reason_code IS NOT NULL AND p_reason_code !~ '^[a-z0-9_]{1,64}$')
    OR (p_decision IN ('reject', 'hidden') AND p_reason_code IS NULL)
  THEN
    RAISE EXCEPTION 'invalid court moderation arguments' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.profiles AS profile
  WHERE profile.id = p_reviewer_user_id
    AND profile.account_deleting_at IS NULL
    AND profile.is_admin = true
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active court moderator is required' USING ERRCODE = '42501';
  END IF;

  SELECT post.case_id INTO v_case_id
  FROM public.court_public_posts AS post
  WHERE post.id = p_public_post_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court public post is unavailable' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.court_cases AS court_case
  WHERE court_case.id = v_case_id
  FOR UPDATE;

  SELECT post.* INTO v_post
  FROM public.court_public_posts AS post
  WHERE post.id = p_public_post_id AND post.case_id = v_case_id
  FOR UPDATE;

  IF p_decision = 'approve' THEN
    IF v_post.status <> 'pending_review' OR v_post.safety_level <> 'normal' THEN
      RAISE EXCEPTION 'only a safe pending-review snapshot can be approved'
        USING ERRCODE = '22023';
    END IF;
    v_next_status := 'pending_review';
    v_moderation_status := 'approved';
  ELSIF p_decision = 'reject' THEN
    IF v_post.status NOT IN ('awaiting_consents', 'pending_review') THEN
      RAISE EXCEPTION 'court snapshot cannot be rejected in this state'
        USING ERRCODE = '22023';
    END IF;
    v_next_status := 'rejected';
    v_moderation_status := 'rejected';
  ELSE
    v_next_status := 'hidden';
    v_moderation_status := v_post.moderation_status;
  END IF;

  UPDATE public.court_public_posts
  SET status = v_next_status,
      moderation_status = v_moderation_status,
      moderation_reason_code = p_reason_code,
      reviewed_by_user_id = p_reviewer_user_id,
      reviewed_at = pg_catalog.clock_timestamp(),
      hidden_at = CASE WHEN v_next_status = 'hidden'
        THEN COALESCE(hidden_at, pg_catalog.clock_timestamp()) ELSE hidden_at END
  WHERE id = p_public_post_id;

  IF v_next_status IN ('hidden', 'rejected') THEN
    UPDATE public.court_public_consents
    SET revoked_at = COALESCE(revoked_at, pg_catalog.clock_timestamp())
    WHERE public_post_id = p_public_post_id AND revoked_at IS NULL;
  END IF;

  INSERT INTO public.court_case_events (
    case_id, actor_participant_id, event_type, metadata
  ) VALUES (
    v_case_id, NULL, 'public_reviewed',
    pg_catalog.jsonb_build_object(
      'status', v_next_status,
      'reason_code', p_reason_code
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'public_post_id', p_public_post_id,
    'status', v_next_status,
    'moderation_status', v_moderation_status
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_court_public_post(
  p_public_post_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_case_id uuid;
  v_case public.court_cases%ROWTYPE;
  v_post public.court_public_posts%ROWTYPE;
  v_participant_id uuid;
  v_participant_count integer;
  v_required_participant_count integer;
  v_consent_count integer;
  v_published_at timestamptz;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_public_post_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid court publication arguments' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.profiles AS profile
  WHERE profile.id = p_user_id AND profile.account_deleting_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active court user is required' USING ERRCODE = '42501';
  END IF;

  SELECT post.case_id INTO v_case_id
  FROM public.court_public_posts AS post
  WHERE post.id = p_public_post_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court public post is unavailable' USING ERRCODE = '22023';
  END IF;

  SELECT court_case.* INTO v_case
  FROM public.court_cases AS court_case
  WHERE court_case.id = v_case_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_case.workflow_status NOT IN ('verdict_ready', 'mission_active', 'resolved')
    OR v_case.safety_level <> 'normal'
  THEN
    RAISE EXCEPTION 'court case is not eligible for publication' USING ERRCODE = '42501';
  END IF;

  SELECT post.* INTO v_post
  FROM public.court_public_posts AS post
  WHERE post.id = p_public_post_id AND post.case_id = v_case_id
  FOR UPDATE;

  SELECT participant.id INTO v_participant_id
  FROM public.court_participants AS participant
  WHERE participant.case_id = v_case_id
    AND participant.user_id = p_user_id
    AND participant.participation_status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court participant is required' USING ERRCODE = '42501';
  END IF;

  IF v_post.status = 'published' THEN
    RETURN pg_catalog.jsonb_build_object(
      'public_post_id', p_public_post_id,
      'status', 'published',
      'published_at', v_post.published_at
    );
  END IF;
  IF v_post.status <> 'pending_review'
    OR v_post.moderation_status <> 'approved'
    OR v_post.safety_level <> 'normal'
  THEN
    RAISE EXCEPTION 'court public post has not passed moderation'
      USING ERRCODE = '42501';
  END IF;

  SELECT pg_catalog.count(*)::integer INTO v_participant_count
  FROM public.court_participants AS participant
  WHERE participant.case_id = v_case_id AND participant.participation_status = 'active';
  v_required_participant_count := CASE v_case.mode
    WHEN 'solo' THEN 1 ELSE 2 END;
  SELECT pg_catalog.count(DISTINCT consent.participant_id)::integer
  INTO v_consent_count
  FROM public.court_public_consents AS consent
  JOIN public.court_participants AS participant
    ON participant.id = consent.participant_id
   AND participant.case_id = v_case_id
   AND participant.participation_status = 'active'
  WHERE consent.public_post_id = p_public_post_id
    AND consent.snapshot_hash = v_post.snapshot_hash
    AND consent.revoked_at IS NULL;
  IF v_participant_count <> v_required_participant_count
    OR v_consent_count <> v_required_participant_count
  THEN
    RAISE EXCEPTION 'all current snapshot consents are required'
      USING ERRCODE = '42501';
  END IF;

  v_published_at := pg_catalog.clock_timestamp();
  UPDATE public.court_public_posts
  SET status = 'published',
      published_at = v_published_at,
      hidden_at = NULL
  WHERE id = p_public_post_id;

  INSERT INTO public.court_case_events (
    case_id, actor_participant_id, event_type, metadata
  ) VALUES (
    v_case_id, v_participant_id, 'public_published',
    pg_catalog.jsonb_build_object(
      'snapshot_version', v_post.snapshot_version,
      'status', 'published'
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'public_post_id', p_public_post_id,
    'status', 'published',
    'published_at', v_published_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.withdraw_court_public_post(
  p_public_post_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_case_id uuid;
  v_participant_id uuid;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_public_post_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid court public withdrawal arguments'
      USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.profiles AS profile
  WHERE profile.id = p_user_id AND profile.account_deleting_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active court user is required' USING ERRCODE = '42501';
  END IF;

  SELECT post.case_id INTO v_case_id
  FROM public.court_public_posts AS post
  WHERE post.id = p_public_post_id;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM public.court_cases AS court_case
  WHERE court_case.id = v_case_id
  FOR UPDATE;

  SELECT participant.id INTO v_participant_id
  FROM public.court_participants AS participant
  WHERE participant.case_id = v_case_id
    AND participant.user_id = p_user_id
    AND participant.participation_status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court participant is required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.court_public_posts
  SET status = 'hidden', hidden_at = COALESCE(hidden_at, pg_catalog.clock_timestamp())
  WHERE id = p_public_post_id AND status <> 'hidden';
  UPDATE public.court_public_consents
  SET revoked_at = COALESCE(revoked_at, pg_catalog.clock_timestamp())
  WHERE public_post_id = p_public_post_id AND revoked_at IS NULL;

  INSERT INTO public.court_case_events (
    case_id, actor_participant_id, event_type, metadata
  ) VALUES (
    v_case_id, v_participant_id, 'public_hidden',
    pg_catalog.jsonb_build_object('status', 'hidden')
  );
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.cast_court_public_vote(
  p_public_post_id uuid,
  p_user_id uuid,
  p_option text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_case_id uuid;
  v_vote_id uuid;
  v_reused boolean;
  v_vote_counts jsonb;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_public_post_id IS NULL OR p_user_id IS NULL OR p_option IS NULL OR p_option NOT IN (
    'applicant_more_at_fault', 'partner_more_at_fault',
    'both_need_change', 'need_more_info'
  ) THEN
    RAISE EXCEPTION 'invalid court vote option' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.profiles AS profile
  WHERE profile.id = p_user_id AND profile.account_deleting_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active court user is required' USING ERRCODE = '42501';
  END IF;

  SELECT post.case_id INTO v_case_id
  FROM public.court_public_posts AS post
  WHERE post.id = p_public_post_id
    AND post.status = 'published'
    AND post.safety_level = 'normal'
    AND post.moderation_status = 'approved'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'published court post is required' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.court_votes AS vote
    WHERE vote.public_post_id = p_public_post_id AND vote.user_id = p_user_id
  ) INTO v_reused;

  INSERT INTO public.court_votes (public_post_id, user_id, choice)
  VALUES (p_public_post_id, p_user_id, p_option)
  ON CONFLICT (public_post_id, user_id) DO UPDATE SET choice = EXCLUDED.choice
  RETURNING id INTO v_vote_id;

  SELECT pg_catalog.jsonb_build_object(
    'applicant_more_at_fault', pg_catalog.count(*) FILTER (
      WHERE vote.choice = 'applicant_more_at_fault'
    ),
    'partner_more_at_fault', pg_catalog.count(*) FILTER (
      WHERE vote.choice = 'partner_more_at_fault'
    ),
    'both_need_change', pg_catalog.count(*) FILTER (
      WHERE vote.choice = 'both_need_change'
    ),
    'need_more_info', pg_catalog.count(*) FILTER (
      WHERE vote.choice = 'need_more_info'
    )
  ) INTO v_vote_counts
  FROM public.court_votes AS vote
  WHERE vote.public_post_id = p_public_post_id;

  INSERT INTO public.court_case_events (
    case_id, actor_participant_id, event_type, metadata
  ) VALUES (
    v_case_id, NULL, 'public_vote_cast',
    pg_catalog.jsonb_build_object('choice', p_option, 'status', 'recorded')
  );

  RETURN pg_catalog.jsonb_build_object(
    'vote_id', v_vote_id,
    'choice', p_option,
    'reused', v_reused,
    'vote_counts', v_vote_counts
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_court_public_comment(
  p_public_post_id uuid,
  p_user_id uuid,
  p_comment_type text,
  p_body text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_case_id uuid;
  v_comment_id uuid;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_public_post_id IS NULL OR p_user_id IS NULL
    OR p_comment_type IS NULL
    OR p_comment_type NOT IN ('empathy', 'experience', 'practical_advice', 'question')
    OR pg_catalog.char_length(pg_catalog.btrim(COALESCE(p_body, ''))) NOT BETWEEN 1 AND 1000
  THEN
    RAISE EXCEPTION 'invalid court comment arguments' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.profiles AS profile
  WHERE profile.id = p_user_id AND profile.account_deleting_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active court user is required' USING ERRCODE = '42501';
  END IF;

  SELECT post.case_id INTO v_case_id
  FROM public.court_public_posts AS post
  WHERE post.id = p_public_post_id
    AND post.status = 'published'
    AND post.safety_level = 'normal'
    AND post.moderation_status = 'approved'
    AND post.comments_enabled
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court comments are unavailable' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.court_comments (
    public_post_id, user_id, comment_type, body, moderation_status
  ) VALUES (
    p_public_post_id, p_user_id, p_comment_type,
    pg_catalog.btrim(p_body), 'pending'
  )
  RETURNING id INTO v_comment_id;

  INSERT INTO public.court_case_events (
    case_id, actor_participant_id, event_type, metadata
  ) VALUES (
    v_case_id, NULL, 'public_comment_created',
    pg_catalog.jsonb_build_object('status', 'pending')
  );

  RETURN pg_catalog.jsonb_build_object(
    'comment_id', v_comment_id,
    'moderation_status', 'pending'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.review_court_public_comment(
  p_comment_id uuid,
  p_reviewer_user_id uuid,
  p_decision text,
  p_reason_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_public_post_id uuid;
  v_comment_user_id uuid;
  v_case_id uuid;
  v_post public.court_public_posts%ROWTYPE;
  v_comment public.court_comments%ROWTYPE;
  v_next_status text;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_comment_id IS NULL OR p_reviewer_user_id IS NULL
    OR p_decision IS NULL OR p_decision NOT IN ('approve', 'hide', 'reject')
    OR (p_reason_code IS NOT NULL AND p_reason_code !~ '^[a-z0-9_]{1,64}$')
    OR (p_decision IN ('hide', 'reject') AND p_reason_code IS NULL)
  THEN
    RAISE EXCEPTION 'invalid court comment moderation arguments'
      USING ERRCODE = '22023';
  END IF;

  SELECT comment.public_post_id, comment.user_id
  INTO v_public_post_id, v_comment_user_id
  FROM public.court_comments AS comment
  WHERE comment.id = p_comment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court comment is unavailable' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.profiles AS profile
  WHERE profile.id = ANY(ARRAY[p_reviewer_user_id, v_comment_user_id]::uuid[])
  ORDER BY profile.id
  FOR UPDATE;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles AS profile
    WHERE profile.id = p_reviewer_user_id
      AND profile.account_deleting_at IS NULL
      AND profile.is_admin = true
  ) THEN
    RAISE EXCEPTION 'active court moderator is required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles AS profile
    WHERE profile.id = v_comment_user_id
      AND profile.account_deleting_at IS NULL
  ) THEN
    RAISE EXCEPTION 'court comment owner is unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT post.* INTO v_post
  FROM public.court_public_posts AS post
  WHERE post.id = v_public_post_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court public post is unavailable' USING ERRCODE = '22023';
  END IF;
  v_case_id := v_post.case_id;

  SELECT comment.* INTO v_comment
  FROM public.court_comments AS comment
  WHERE comment.id = p_comment_id
    AND comment.public_post_id = v_public_post_id
  FOR UPDATE;
  IF NOT FOUND OR v_comment.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'court comment is unavailable' USING ERRCODE = '22023';
  END IF;

  IF p_decision = 'approve' THEN
    IF v_comment.moderation_status <> 'pending'
      OR v_post.status <> 'published'
      OR v_post.safety_level <> 'normal'
      OR v_post.moderation_status <> 'approved'
      OR NOT v_post.comments_enabled
    THEN
      RAISE EXCEPTION 'court comment cannot be approved in this state'
        USING ERRCODE = '22023';
    END IF;
    v_next_status := 'visible';
  ELSIF p_decision = 'hide' THEN
    IF v_comment.moderation_status NOT IN ('pending', 'visible', 'hidden') THEN
      RAISE EXCEPTION 'court comment cannot be hidden in this state'
        USING ERRCODE = '22023';
    END IF;
    v_next_status := 'hidden';
  ELSE
    IF v_comment.moderation_status <> 'pending' THEN
      RAISE EXCEPTION 'court comment cannot be rejected in this state'
        USING ERRCODE = '22023';
    END IF;
    v_next_status := 'rejected';
  END IF;

  UPDATE public.court_comments
  SET moderation_status = v_next_status,
      moderation_reason_code = p_reason_code,
      reviewed_by_user_id = p_reviewer_user_id,
      reviewed_at = pg_catalog.clock_timestamp()
  WHERE id = p_comment_id;

  INSERT INTO public.court_case_events (
    case_id, actor_participant_id, event_type, metadata
  ) VALUES (
    v_case_id,
    NULL,
    'public_comment_reviewed',
    pg_catalog.jsonb_build_object(
      'status', v_next_status,
      'reason_code', p_reason_code
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'comment_id', p_comment_id,
    'moderation_status', v_next_status
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_court_public_comments_enabled(
  p_public_post_id uuid,
  p_reviewer_user_id uuid,
  p_enabled boolean,
  p_reason_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_post public.court_public_posts%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_public_post_id IS NULL OR p_reviewer_user_id IS NULL OR p_enabled IS NULL
    OR (p_reason_code IS NOT NULL AND p_reason_code !~ '^[a-z0-9_]{1,64}$')
    OR (NOT p_enabled AND p_reason_code IS NULL)
  THEN
    RAISE EXCEPTION 'invalid court comment toggle arguments' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.profiles AS profile
  WHERE profile.id = p_reviewer_user_id
    AND profile.account_deleting_at IS NULL
    AND profile.is_admin = true
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active court moderator is required' USING ERRCODE = '42501';
  END IF;

  SELECT post.* INTO v_post
  FROM public.court_public_posts AS post
  WHERE post.id = p_public_post_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court public post is unavailable' USING ERRCODE = '22023';
  END IF;
  IF p_enabled AND (
    v_post.status <> 'published'
    OR v_post.safety_level <> 'normal'
    OR v_post.moderation_status <> 'approved'
  ) THEN
    RAISE EXCEPTION 'court comments cannot be enabled in this state'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.court_public_posts
  SET comments_enabled = p_enabled
  WHERE id = p_public_post_id;

  INSERT INTO public.court_case_events (
    case_id, actor_participant_id, event_type, metadata
  ) VALUES (
    v_post.case_id,
    NULL,
    'public_comments_toggled',
    pg_catalog.jsonb_build_object(
      'status', CASE WHEN p_enabled THEN 'enabled' ELSE 'disabled' END,
      'reason_code', p_reason_code
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'public_post_id', p_public_post_id,
    'comments_enabled', p_enabled
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.review_court_public_report(
  p_report_id uuid,
  p_reviewer_user_id uuid,
  p_decision text,
  p_reason_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_public_post_id uuid;
  v_reporter_user_id uuid;
  v_comment_id uuid;
  v_comment_user_id uuid;
  v_post public.court_public_posts%ROWTYPE;
  v_report public.court_reports%ROWTYPE;
  v_next_status text;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_report_id IS NULL OR p_reviewer_user_id IS NULL
    OR p_decision IS NULL OR p_decision NOT IN ('start_review', 'dismiss', 'hide_content')
    OR (p_reason_code IS NOT NULL AND p_reason_code !~ '^[a-z0-9_]{1,64}$')
    OR (p_decision IN ('dismiss', 'hide_content') AND p_reason_code IS NULL)
  THEN
    RAISE EXCEPTION 'invalid court report moderation arguments'
      USING ERRCODE = '22023';
  END IF;

  SELECT report.public_post_id, report.reporter_user_id, report.comment_id
  INTO v_public_post_id, v_reporter_user_id, v_comment_id
  FROM public.court_reports AS report
  WHERE report.id = p_report_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court report is unavailable' USING ERRCODE = '22023';
  END IF;

  IF v_comment_id IS NOT NULL THEN
    SELECT comment.user_id INTO v_comment_user_id
    FROM public.court_comments AS comment
    WHERE comment.id = v_comment_id
      AND comment.public_post_id = v_public_post_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'reported court comment is unavailable' USING ERRCODE = '22023';
    END IF;
  END IF;

  PERFORM 1
  FROM public.profiles AS profile
  WHERE profile.id = ANY(ARRAY[
    p_reviewer_user_id, v_reporter_user_id, v_comment_user_id
  ]::uuid[])
  ORDER BY profile.id
  FOR UPDATE;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles AS profile
    WHERE profile.id = p_reviewer_user_id
      AND profile.account_deleting_at IS NULL
      AND profile.is_admin = true
  ) THEN
    RAISE EXCEPTION 'active court moderator is required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles AS profile
    WHERE profile.id = v_reporter_user_id
      AND profile.account_deleting_at IS NULL
  ) THEN
    RAISE EXCEPTION 'court reporter is unavailable' USING ERRCODE = '42501';
  END IF;
  IF v_comment_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles AS profile
    WHERE profile.id = v_comment_user_id
      AND profile.account_deleting_at IS NULL
  ) THEN
    RAISE EXCEPTION 'reported court comment owner is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT post.* INTO v_post
  FROM public.court_public_posts AS post
  WHERE post.id = v_public_post_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'court public post is unavailable' USING ERRCODE = '22023';
  END IF;

  SELECT report.* INTO v_report
  FROM public.court_reports AS report
  WHERE report.id = p_report_id
    AND report.public_post_id = v_public_post_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_report.reporter_user_id IS DISTINCT FROM v_reporter_user_id
    OR v_report.comment_id IS DISTINCT FROM v_comment_id
    OR v_report.status IN ('resolved', 'dismissed')
  THEN
    RAISE EXCEPTION 'court report is already terminal' USING ERRCODE = '22023';
  END IF;

  v_next_status := CASE p_decision
    WHEN 'start_review' THEN 'reviewing'
    WHEN 'dismiss' THEN 'dismissed'
    ELSE 'resolved'
  END;

  IF p_decision = 'hide_content' THEN
    IF v_report.target_type = 'post' THEN
      UPDATE public.court_public_posts
      SET status = 'hidden',
          hidden_at = COALESCE(hidden_at, pg_catalog.clock_timestamp()),
          moderation_reason_code = p_reason_code,
          reviewed_by_user_id = p_reviewer_user_id,
          reviewed_at = pg_catalog.clock_timestamp()
      WHERE id = v_public_post_id;
      UPDATE public.court_public_consents
      SET revoked_at = COALESCE(revoked_at, pg_catalog.clock_timestamp())
      WHERE public_post_id = v_public_post_id
        AND revoked_at IS NULL;
    ELSE
      UPDATE public.court_comments
      SET moderation_status = 'hidden',
          moderation_reason_code = p_reason_code,
          reviewed_by_user_id = p_reviewer_user_id,
          reviewed_at = pg_catalog.clock_timestamp()
      WHERE id = v_report.comment_id
        AND public_post_id = v_public_post_id;
    END IF;
  END IF;

  UPDATE public.court_reports
  SET status = v_next_status,
      reviewed_by_user_id = p_reviewer_user_id,
      reviewed_at = pg_catalog.clock_timestamp(),
      resolution_reason_code = p_reason_code
  WHERE id = p_report_id;

  INSERT INTO public.court_case_events (
    case_id, actor_participant_id, event_type, metadata
  ) VALUES (
    v_post.case_id,
    NULL,
    'public_report_reviewed',
    pg_catalog.jsonb_build_object(
      'status', v_next_status,
      'reason_code', p_reason_code
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'report_id', p_report_id,
    'status', v_next_status,
    'content_hidden', p_decision = 'hide_content'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.report_court_public_content(
  p_public_post_id uuid,
  p_comment_id uuid,
  p_user_id uuid,
  p_reason_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_case_id uuid;
  v_report_id uuid;
  v_target_type text;
  v_inserted boolean;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_public_post_id IS NULL OR p_user_id IS NULL OR p_reason_code IS NULL
    OR p_reason_code NOT IN (
    'harassment', 'pii', 'threat', 'hate', 'spam', 'minor_safety', 'other'
  ) THEN
    RAISE EXCEPTION 'invalid court report reason' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.profiles AS profile
  WHERE profile.id = p_user_id AND profile.account_deleting_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active court user is required' USING ERRCODE = '42501';
  END IF;

  SELECT post.case_id INTO v_case_id
  FROM public.court_public_posts AS post
  WHERE post.id = p_public_post_id
    AND post.status = 'published'
    AND post.safety_level = 'normal'
    AND post.moderation_status = 'approved'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'published court post is required' USING ERRCODE = '42501';
  END IF;

  v_target_type := CASE WHEN p_comment_id IS NULL THEN 'post' ELSE 'comment' END;
  IF p_comment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.court_comments AS comment
    WHERE comment.id = p_comment_id
      AND comment.public_post_id = p_public_post_id
      AND comment.moderation_status = 'visible'
      AND comment.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'visible court comment is required' USING ERRCODE = '22023';
  END IF;

  IF v_target_type = 'post' THEN
    INSERT INTO public.court_reports (
      public_post_id, comment_id, reporter_user_id, target_type, reason_code
    ) VALUES (
      p_public_post_id, NULL, p_user_id, 'post', p_reason_code
    )
    ON CONFLICT (public_post_id, reporter_user_id)
      WHERE target_type = 'post' DO NOTHING
    RETURNING id INTO v_report_id;
    v_inserted := FOUND;
    IF NOT v_inserted THEN
      SELECT report.id INTO v_report_id
      FROM public.court_reports AS report
      WHERE report.public_post_id = p_public_post_id
        AND report.reporter_user_id = p_user_id
        AND report.target_type = 'post';
    END IF;
  ELSE
    INSERT INTO public.court_reports (
      public_post_id, comment_id, reporter_user_id, target_type, reason_code
    ) VALUES (
      p_public_post_id, p_comment_id, p_user_id, 'comment', p_reason_code
    )
    ON CONFLICT (comment_id, reporter_user_id)
      WHERE target_type = 'comment' DO NOTHING
    RETURNING id INTO v_report_id;
    v_inserted := FOUND;
    IF NOT v_inserted THEN
      SELECT report.id INTO v_report_id
      FROM public.court_reports AS report
      WHERE report.comment_id = p_comment_id
        AND report.reporter_user_id = p_user_id
        AND report.target_type = 'comment';
    END IF;
  END IF;

  IF v_inserted THEN
    INSERT INTO public.court_case_events (
      case_id, actor_participant_id, event_type, metadata
    ) VALUES (
      v_case_id, NULL, 'public_report_created',
      pg_catalog.jsonb_build_object(
        'reason_code', p_reason_code,
        'status', 'open'
      )
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'report_id', v_report_id,
    'status', 'open',
    'reused', NOT v_inserted
  );
END;
$$;

ALTER FUNCTION public.create_court_case_with_applicant(uuid, uuid, text, text, text, text)
  OWNER TO postgres;
ALTER FUNCTION public.submit_court_statement(
  uuid, uuid, uuid, text, text, text, text, text, text, text[]
)
  OWNER TO postgres;
ALTER FUNCTION public.issue_court_invite(uuid, uuid, text, timestamptz)
  OWNER TO postgres;
ALTER FUNCTION public.cancel_court_invite(uuid, uuid)
  OWNER TO postgres;
ALTER FUNCTION public.reject_court_invite(text, uuid)
  OWNER TO postgres;
ALTER FUNCTION public.accept_court_invite(text, uuid)
  OWNER TO postgres;
ALTER FUNCTION public.leave_court_case(uuid, uuid)
  OWNER TO postgres;
ALTER FUNCTION public.mark_court_case_safety(uuid, uuid, text, text[])
  OWNER TO postgres;
ALTER FUNCTION public.escalate_court_case_safety_from_ai_preflight(uuid, uuid, text[])
  OWNER TO postgres;
ALTER FUNCTION public.archive_court_case(uuid, uuid)
  OWNER TO postgres;
ALTER FUNCTION public.delete_court_case(uuid, uuid)
  OWNER TO postgres;
ALTER FUNCTION public.claim_court_verdict(
  uuid, uuid, text, text, text, text, integer, boolean
)
  OWNER TO postgres;
ALTER FUNCTION public.reserve_court_verdict_provider_call(
  uuid, uuid, uuid, text, text, text, text, integer, integer
)
  OWNER TO postgres;
ALTER FUNCTION public.mark_court_verdict_provider_started(
  uuid, uuid, uuid, text, text, text
)
  OWNER TO postgres;
ALTER FUNCTION public.stage_court_verdict_provider_result(
  uuid, uuid, uuid, text, jsonb, jsonb, text, text,
  integer, integer, integer, integer
)
  OWNER TO postgres;
ALTER FUNCTION public.settle_court_high_risk_provider_result(
  uuid, uuid, uuid, text, text, text[], text,
  integer, integer, integer, integer
)
  OWNER TO postgres;
ALTER FUNCTION public.finalize_court_provider_audit(uuid, text)
  OWNER TO postgres;
ALTER FUNCTION public.claim_court_provider_audit_recovery(uuid, integer)
  OWNER TO postgres;
ALTER FUNCTION public.record_court_provider_audit_recovery_failure(
  uuid, uuid, uuid, text
)
  OWNER TO postgres;
ALTER FUNCTION public.complete_court_verdict(uuid, uuid, uuid, text, jsonb, jsonb, text)
  OWNER TO postgres;
ALTER FUNCTION public.fail_court_verdict(uuid, uuid, uuid, text)
  OWNER TO postgres;
ALTER FUNCTION public.reconcile_court_provider_failure(uuid, uuid, text, text, text)
  OWNER TO postgres;
ALTER FUNCTION public.set_court_mission_status(uuid, uuid, text)
  OWNER TO postgres;
ALTER FUNCTION public.link_court_mission_action(uuid, uuid, text)
  OWNER TO postgres;
ALTER FUNCTION public.create_or_link_court_mission_action(uuid, uuid, boolean)
  OWNER TO postgres;
ALTER FUNCTION public.create_court_followup(
  uuid, uuid, integer, text, text, text, text[]
)
  OWNER TO postgres;
ALTER FUNCTION public.prepare_court_public_snapshot(uuid, uuid, jsonb, text, integer)
  OWNER TO postgres;
ALTER FUNCTION public.set_court_public_consent(uuid, uuid, text, boolean)
  OWNER TO postgres;
ALTER FUNCTION public.review_court_public_post(uuid, uuid, text, text)
  OWNER TO postgres;
ALTER FUNCTION public.publish_court_public_post(uuid, uuid)
  OWNER TO postgres;
ALTER FUNCTION public.withdraw_court_public_post(uuid, uuid)
  OWNER TO postgres;
ALTER FUNCTION public.cast_court_public_vote(uuid, uuid, text)
  OWNER TO postgres;
ALTER FUNCTION public.create_court_public_comment(uuid, uuid, text, text)
  OWNER TO postgres;
ALTER FUNCTION public.review_court_public_comment(uuid, uuid, text, text)
  OWNER TO postgres;
ALTER FUNCTION public.set_court_public_comments_enabled(uuid, uuid, boolean, text)
  OWNER TO postgres;
ALTER FUNCTION public.review_court_public_report(uuid, uuid, text, text)
  OWNER TO postgres;
ALTER FUNCTION public.report_court_public_content(uuid, uuid, uuid, text)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.create_court_case_with_applicant(uuid, uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_court_statement(
  uuid, uuid, uuid, text, text, text, text, text, text, text[]
)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_court_invite(uuid, uuid, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_court_invite(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_court_invite(text, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accept_court_invite(text, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.leave_court_case(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_court_case_safety(uuid, uuid, text, text[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.escalate_court_case_safety_from_ai_preflight(uuid, uuid, text[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.archive_court_case(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_court_case(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_court_verdict(
  uuid, uuid, text, text, text, text, integer, boolean
)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_court_verdict_provider_call(
  uuid, uuid, uuid, text, text, text, text, integer, integer
)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_court_verdict_provider_started(
  uuid, uuid, uuid, text, text, text
)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stage_court_verdict_provider_result(
  uuid, uuid, uuid, text, jsonb, jsonb, text, text,
  integer, integer, integer, integer
)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_court_high_risk_provider_result(
  uuid, uuid, uuid, text, text, text[], text,
  integer, integer, integer, integer
)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_court_provider_audit(uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_court_provider_audit_recovery(uuid, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_court_provider_audit_recovery_failure(
  uuid, uuid, uuid, text
)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_court_verdict(uuid, uuid, uuid, text, jsonb, jsonb, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_court_verdict(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_court_provider_failure(uuid, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_court_mission_status(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.link_court_mission_action(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_or_link_court_mission_action(uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_court_followup(
  uuid, uuid, integer, text, text, text, text[]
)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prepare_court_public_snapshot(uuid, uuid, jsonb, text, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_court_public_consent(uuid, uuid, text, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.review_court_public_post(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.publish_court_public_post(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.withdraw_court_public_post(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cast_court_public_vote(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_court_public_comment(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.review_court_public_comment(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_court_public_comments_enabled(uuid, uuid, boolean, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.review_court_public_report(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.report_court_public_content(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.court_safety_categories_are_valid(text[])
  TO service_role;
GRANT EXECUTE ON FUNCTION public.court_event_metadata_is_safe(jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.court_verdict_result_is_valid(jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.court_public_snapshot_is_valid(jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.court_redacted_verdict_result(text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.court_missions_json_is_valid(jsonb)
  TO service_role;

GRANT EXECUTE ON FUNCTION public.create_court_case_with_applicant(uuid, uuid, text, text, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.submit_court_statement(
  uuid, uuid, uuid, text, text, text, text, text, text, text[]
)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_court_invite(uuid, uuid, text, timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_court_invite(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.reject_court_invite(text, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.accept_court_invite(text, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.leave_court_case(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_court_case_safety(uuid, uuid, text, text[])
  TO service_role;
GRANT EXECUTE ON FUNCTION public.escalate_court_case_safety_from_ai_preflight(uuid, uuid, text[])
  TO service_role;
GRANT EXECUTE ON FUNCTION public.archive_court_case(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_court_case(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_court_verdict(
  uuid, uuid, text, text, text, text, integer, boolean
)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_court_verdict_provider_call(
  uuid, uuid, uuid, text, text, text, text, integer, integer
)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_court_verdict_provider_started(
  uuid, uuid, uuid, text, text, text
)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.stage_court_verdict_provider_result(
  uuid, uuid, uuid, text, jsonb, jsonb, text, text,
  integer, integer, integer, integer
)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_court_high_risk_provider_result(
  uuid, uuid, uuid, text, text, text[], text,
  integer, integer, integer, integer
)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_court_provider_audit(uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_court_provider_audit_recovery(uuid, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.record_court_provider_audit_recovery_failure(
  uuid, uuid, uuid, text
)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_court_verdict(uuid, uuid, uuid, text, jsonb, jsonb, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_court_verdict(uuid, uuid, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_court_provider_failure(uuid, uuid, text, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.set_court_mission_status(uuid, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.link_court_mission_action(uuid, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.create_or_link_court_mission_action(uuid, uuid, boolean)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.create_court_followup(
  uuid, uuid, integer, text, text, text, text[]
)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.prepare_court_public_snapshot(uuid, uuid, jsonb, text, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.set_court_public_consent(uuid, uuid, text, boolean)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.review_court_public_post(uuid, uuid, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.publish_court_public_post(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.withdraw_court_public_post(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.cast_court_public_vote(uuid, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.create_court_public_comment(uuid, uuid, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.review_court_public_comment(uuid, uuid, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.set_court_public_comments_enabled(uuid, uuid, boolean, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.review_court_public_report(uuid, uuid, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.report_court_public_content(uuid, uuid, uuid, text)
  TO service_role;

REVOKE ALL ON SEQUENCE public.court_case_events_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.court_case_events_id_seq TO service_role;

COMMENT ON TABLE public.court_cases IS
  'Private Couple Court cases. Authorization is participant-based; couple_id is never an access grant.';
COMMENT ON TABLE public.court_statements IS
  'Private immutable submitted statement revisions. Only the author and service boundary can read raw text.';
COMMENT ON TABLE public.court_invites IS
  'Single-use, expiring Couple Court invitations. Only SHA-256 token hashes are retained.';
COMMENT ON TABLE public.court_case_events IS
  'Bounded event metadata only; raw statement, verdict, title, token, account, and case identifiers are forbidden in metadata.';
COMMENT ON TABLE public.court_public_posts IS
  'Immutable, allowlisted public snapshots separated from private court payloads and bound to per-version consent.';
COMMENT ON VIEW public.court_public_feed IS
  'Published normal-safety projection without case_id, user_id, moderation identity, or private joins.';
COMMENT ON VIEW public.court_public_comment_feed IS
  'Visible comments for published normal-safety court snapshots without account identifiers.';
COMMENT ON FUNCTION public.review_court_public_post(uuid, uuid, text, text) IS
  'Service-only moderation gate. Approval requires an active admin and does not itself publish; every mode-required current-snapshot consent remains mandatory.';

COMMIT;
