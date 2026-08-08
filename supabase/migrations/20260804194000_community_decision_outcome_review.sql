BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Publication consent is an intent, not an automatic release. These commands
-- provide the two missing exits around the reviewed projection:
--   1. a human administrator may publish or reject a pending candidate;
--   2. the author may immediately withdraw an active candidate in every
--      runtime mode, including read-only and disabled emergency modes.
-- The command table is both an immutable idempotency fence and an audit trail.
CREATE TABLE public.community_decision_publication_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_erased_at timestamptz,
  operation text NOT NULL,
  operation_key uuid NOT NULL,
  outcome_id uuid NOT NULL
    REFERENCES public.community_decision_outcomes(id) ON DELETE RESTRICT,
  payload_hash text NOT NULL,
  result_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  CONSTRAINT community_decision_publication_command_identity
    UNIQUE (actor_id, operation, operation_key),
  CONSTRAINT community_decision_publication_command_actor CHECK (
    (actor_id IS NOT NULL AND actor_erased_at IS NULL)
    OR (actor_id IS NULL AND actor_erased_at IS NOT NULL)
  ),
  CONSTRAINT community_decision_publication_command_operation CHECK (
    operation IN ('review_publish', 'review_reject', 'author_withdraw')
  ),
  CONSTRAINT community_decision_publication_command_hash CHECK (
    payload_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT community_decision_publication_command_completion CHECK (
    (result_payload IS NULL AND completed_at IS NULL)
    OR (jsonb_typeof(result_payload) = 'object' AND completed_at IS NOT NULL)
  )
);

ALTER TABLE public.community_decision_publication_commands
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_decision_publication_commands
  FORCE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE
  public.community_decision_publication_commands
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.community_decision_publication_commands
  TO service_role;
CREATE POLICY community_decision_publication_commands_service_select
  ON public.community_decision_publication_commands
  FOR SELECT TO service_role USING (true);

CREATE OR REPLACE FUNCTION community_private.tombstone_decision_publication_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Preserve the command as an explicit erased-actor tombstone instead of
  -- blocking account deletion or silently deleting the human review audit.
  IF pg_trigger_depth() > 1
    AND OLD.actor_id IS NOT NULL
    AND NEW.actor_id IS NULL
    AND NEW.actor_erased_at IS NULL THEN
    NEW.actor_erased_at := clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER community_decision_publication_actor_tombstone
BEFORE UPDATE OF actor_id
ON public.community_decision_publication_commands
FOR EACH ROW
EXECUTE FUNCTION community_private.tombstone_decision_publication_actor();

CREATE OR REPLACE FUNCTION community_private.withdraw_decision_publication_for_author_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- The thread author withdrawal command deliberately marks the post while
  -- the recalculate trigger is bypassed. Close the public consent artifact in
  -- the same transaction so the owner never sees a stale "published" state.
  IF COALESCE(
    current_setting('hanbang.community_decision_source_write', true), ''
  ) <> 'on' OR (
    NEW.publication_state = 'published'
    AND NEW.visibility = 'public'
    AND NEW.author_visibility = 'public'
    AND NEW.audience_scope = 'public'
    AND COALESCE(NEW.under_review, false) = false
  ) THEN
    RETURN NEW;
  END IF;

  UPDATE public.community_decision_outcome_publications AS publication
  SET publication_state = 'withdrawn',
      published_at = NULL,
      withdrawn_at = clock_timestamp(),
      withdrawn_reason = 'author_withdrawn',
      updated_at = clock_timestamp()
  FROM public.community_decision_threads AS thread
  WHERE thread.post_id = NEW.id
    AND publication.thread_id = thread.id
    AND publication.publication_state IN ('pending_review', 'published');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION community_private.withdraw_decision_publication_for_unavailable_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.source_unavailable_at IS NOT NULL
    OR NEW.source_unavailable_at IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.community_decision_outcome_publications AS publication
  SET publication_state = 'withdrawn',
      published_at = NULL,
      withdrawn_at = clock_timestamp(),
      withdrawn_reason = 'source_unavailable',
      updated_at = clock_timestamp()
  WHERE publication.thread_id = NEW.id
    AND publication.publication_state IN ('pending_review', 'published');
  RETURN NEW;
END;
$$;

CREATE TRIGGER community_decision_outcome_author_source_withdrawal
AFTER UPDATE OF
  publication_state, visibility, author_visibility, audience_scope,
  under_review
ON public.community_posts
FOR EACH ROW
EXECUTE FUNCTION community_private.withdraw_decision_publication_for_author_source();

CREATE TRIGGER community_decision_outcome_source_unavailable
AFTER UPDATE OF source_unavailable_at
ON public.community_decision_threads
FOR EACH ROW
EXECUTE FUNCTION community_private.withdraw_decision_publication_for_unavailable_source();

ALTER FUNCTION community_private.withdraw_decision_publication_for_author_source()
  OWNER TO postgres;
ALTER FUNCTION community_private.withdraw_decision_publication_for_unavailable_source()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION
  community_private.withdraw_decision_publication_for_author_source()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  community_private.withdraw_decision_publication_for_unavailable_source()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION community_private.open_decision_publication_command(
  p_actor_id uuid,
  p_operation text,
  p_operation_key uuid,
  p_outcome_id uuid,
  p_payload jsonb
)
RETURNS public.community_decision_publication_commands
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_command public.community_decision_publication_commands%ROWTYPE;
  v_payload_hash text;
BEGIN
  PERFORM public.community_assert_decision_service();
  IF p_actor_id IS NULL OR p_operation_key IS NULL OR p_outcome_id IS NULL
    OR p_operation NOT IN ('review_publish', 'review_reject', 'author_withdraw')
    OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_PUBLICATION_COMMAND_INVALID'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM auth.users AS app_user
  WHERE app_user.id = p_actor_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_ACTOR_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  v_payload_hash := public.community_decision_payload_digest(p_payload);
  SELECT command.* INTO v_command
  FROM public.community_decision_publication_commands AS command
  WHERE command.actor_id = p_actor_id
    AND command.operation = p_operation
    AND command.operation_key = p_operation_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_command.outcome_id IS DISTINCT FROM p_outcome_id
      OR v_command.payload_hash IS DISTINCT FROM v_payload_hash THEN
      RAISE EXCEPTION 'COMMUNITY_DECISION_IDEMPOTENCY_CONFLICT'
        USING ERRCODE = '23505';
    END IF;
    IF v_command.result_payload IS NULL THEN
      RAISE EXCEPTION 'COMMUNITY_DECISION_PUBLICATION_COMMAND_IN_PROGRESS'
        USING ERRCODE = '55000';
    END IF;
    RETURN v_command;
  END IF;

  INSERT INTO public.community_decision_publication_commands (
    actor_id,
    operation,
    operation_key,
    outcome_id,
    payload_hash
  ) VALUES (
    p_actor_id,
    p_operation,
    p_operation_key,
    p_outcome_id,
    v_payload_hash
  ) RETURNING * INTO v_command;
  RETURN v_command;
END;
$$;

CREATE OR REPLACE FUNCTION community_private.complete_decision_publication_command(
  p_command_id uuid,
  p_result jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF p_command_id IS NULL OR jsonb_typeof(p_result) <> 'object' THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_PUBLICATION_COMMAND_INVALID'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.community_decision_publication_commands AS command
  SET result_payload = p_result,
      completed_at = clock_timestamp()
  WHERE command.id = p_command_id
    AND command.result_payload IS NULL
  RETURNING command.result_payload INTO v_result;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_PUBLICATION_COMMAND_NOT_OPEN'
      USING ERRCODE = '55000';
  END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_has_completed_decision_publication_command(
  p_actor_id uuid,
  p_operation text,
  p_operation_key uuid,
  p_outcome_id uuid,
  p_payload jsonb
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '5s'
AS $$
DECLARE
  v_payload_hash text;
BEGIN
  PERFORM public.community_assert_decision_service();
  IF p_actor_id IS NULL OR p_operation_key IS NULL OR p_outcome_id IS NULL
    OR p_operation NOT IN ('review_publish', 'review_reject', 'author_withdraw')
    OR jsonb_typeof(p_payload) <> 'object' THEN
    RETURN false;
  END IF;

  v_payload_hash := public.community_decision_payload_digest(p_payload);
  RETURN EXISTS (
    SELECT 1
    FROM public.community_decision_publication_commands AS command
    WHERE command.actor_id = p_actor_id
      AND command.operation = p_operation
      AND command.operation_key = p_operation_key
      AND command.outcome_id = p_outcome_id
      AND command.payload_hash = v_payload_hash
      AND command.completed_at IS NOT NULL
      AND jsonb_typeof(command.result_payload) = 'object'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.community_review_decision_outcome(
  p_admin_id uuid,
  p_outcome_id uuid,
  p_decision text,
  p_reason text,
  p_policy_version text,
  p_operation_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, community_private
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $$
DECLARE
  v_operation text;
  v_payload jsonb;
  v_command public.community_decision_publication_commands%ROWTYPE;
  v_publication public.community_decision_outcome_publications%ROWTYPE;
  v_source_eligible boolean := false;
  v_result jsonb;
BEGIN
  PERFORM public.community_assert_decision_service();
  IF p_admin_id IS NULL OR p_outcome_id IS NULL OR p_operation_key IS NULL
    OR p_decision NOT IN ('publish', 'reject')
    OR p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 3 AND 500
    OR p_policy_version IS NULL
    OR char_length(btrim(p_policy_version)) NOT BETWEEN 1 AND 64 THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_PUBLICATION_REVIEW_INVALID'
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles AS profile
    WHERE profile.id = p_admin_id AND profile.is_admin IS TRUE
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_PUBLICATION_ADMIN_REQUIRED'
      USING ERRCODE = '42501';
  END IF;
  v_operation := CASE p_decision
    WHEN 'publish' THEN 'review_publish'
    ELSE 'review_reject'
  END;
  v_payload := jsonb_build_object(
    'outcomeId', p_outcome_id,
    'decision', p_decision,
    'reason', btrim(p_reason),
    'policyVersion', btrim(p_policy_version)
  );
  v_command := community_private.open_decision_publication_command(
    p_admin_id,
    v_operation,
    p_operation_key,
    p_outcome_id,
    v_payload
  );
  IF v_command.result_payload IS NOT NULL THEN
    RETURN v_command.result_payload;
  END IF;
  IF p_decision = 'publish'
    AND public.community_runtime_mode() <> 'normal' THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_RUNTIME_BLOCKED'
      USING ERRCODE = '55000';
  END IF;

  SELECT publication.* INTO v_publication
  FROM public.community_decision_outcome_publications AS publication
  WHERE publication.outcome_id = p_outcome_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_PUBLICATION_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_publication.publication_state <> 'pending_review' THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_PUBLICATION_NOT_PENDING'
      USING ERRCODE = '55000';
  END IF;

  IF p_decision = 'publish' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.community_decision_outcomes AS outcome
      JOIN public.community_decision_threads AS thread
        ON thread.id = outcome.thread_id
      JOIN public.community_posts AS post ON post.id = thread.post_id
      JOIN public.community_profiles AS author_profile
        ON author_profile.user_id = thread.author_id
       AND COALESCE(author_profile.is_suspended, false) = false
      WHERE outcome.id = p_outcome_id
        AND outcome.public_consent IS TRUE
        AND thread.state = 'completed'
        AND thread.source_unavailable_at IS NULL
        AND post.publication_state = 'published'
        AND post.visibility = 'public'
        AND post.author_visibility = 'public'
        AND post.audience_scope = 'public'
        AND COALESCE(post.under_review, false) = false
        AND EXISTS (
          SELECT 1
          FROM public.community_thread_evidence_selections AS selection
          WHERE selection.thread_id = thread.id
            AND selection.included_in_resolution_at IS NOT NULL
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.community_thread_evidence_selections AS selection
          WHERE selection.thread_id = thread.id
            AND selection.included_in_resolution_at IS NOT NULL
            AND NOT EXISTS (
              SELECT 1
              FROM public.community_decision_answers AS answer
              JOIN public.community_comments AS comment
                ON comment.id = answer.comment_id
               AND comment.is_deleted = false
              JOIN public.community_profiles AS answer_profile
                ON answer_profile.user_id = answer.author_id
               AND COALESCE(answer_profile.is_suspended, false) = false
              WHERE answer.id = selection.answer_id
                AND answer.thread_id = thread.id
                AND answer.is_qualified
                AND NOT community_private.users_are_blocked(
                  thread.author_id,
                  answer.author_id
                )
            )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.community_decision_outcomes AS newer
          WHERE newer.thread_id = outcome.thread_id
            AND newer.revision > outcome.revision
        )
    ) INTO v_source_eligible;
    IF NOT v_source_eligible THEN
      RAISE EXCEPTION 'COMMUNITY_DECISION_PUBLICATION_SOURCE_UNAVAILABLE'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  UPDATE public.community_decision_outcome_publications AS publication
  SET publication_state = CASE p_decision
        WHEN 'publish' THEN 'published'
        ELSE 'rejected'
      END,
      reviewed_by = p_admin_id,
      reviewed_at = clock_timestamp(),
      review_reason = btrim(p_reason),
      review_policy_version = btrim(p_policy_version),
      published_at = CASE p_decision
        WHEN 'publish' THEN clock_timestamp()
        ELSE NULL
      END,
      updated_at = clock_timestamp()
  WHERE publication.outcome_id = p_outcome_id;

  SELECT jsonb_build_object(
    'receiptVersion', 1,
    'operationKey', p_operation_key,
    'outcomeId', p_outcome_id,
    'threadId', v_publication.thread_id,
    'revision', v_publication.revision,
    'publicationState', CASE p_decision
      WHEN 'publish' THEN 'published'
      ELSE 'rejected'
    END,
    'reviewedAt', publication.reviewed_at,
    'replayed', false
  ) INTO v_result
  FROM public.community_decision_outcome_publications AS publication
  WHERE publication.outcome_id = p_outcome_id;

  RETURN community_private.complete_decision_publication_command(
    v_command.id,
    v_result
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.community_withdraw_decision_outcome_publication(
  p_actor_id uuid,
  p_thread_id uuid,
  p_outcome_id uuid,
  p_operation_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, community_private
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $$
DECLARE
  v_payload jsonb;
  v_command public.community_decision_publication_commands%ROWTYPE;
  v_publication public.community_decision_outcome_publications%ROWTYPE;
  v_result jsonb;
BEGIN
  PERFORM public.community_assert_decision_service();
  IF p_actor_id IS NULL OR p_thread_id IS NULL OR p_outcome_id IS NULL
    OR p_operation_key IS NULL THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_PUBLICATION_WITHDRAW_INVALID'
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.community_decision_outcomes AS outcome
    JOIN public.community_decision_threads AS thread
      ON thread.id = outcome.thread_id
    WHERE outcome.id = p_outcome_id
      AND outcome.thread_id = p_thread_id
      AND thread.author_id = p_actor_id
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_PUBLICATION_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  v_payload := jsonb_build_object(
    'threadId', p_thread_id,
    'outcomeId', p_outcome_id,
    'reason', 'consent_withdrawn'
  );
  v_command := community_private.open_decision_publication_command(
    p_actor_id,
    'author_withdraw',
    p_operation_key,
    p_outcome_id,
    v_payload
  );
  IF v_command.result_payload IS NOT NULL THEN
    RETURN v_command.result_payload;
  END IF;

  SELECT publication.* INTO v_publication
  FROM public.community_decision_outcome_publications AS publication
  WHERE publication.outcome_id = p_outcome_id
    AND publication.thread_id = p_thread_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_PUBLICATION_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_publication.publication_state NOT IN ('pending_review', 'published') THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_PUBLICATION_NOT_ACTIVE'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.community_decision_outcome_publications AS publication
  SET publication_state = 'withdrawn',
      withdrawn_at = clock_timestamp(),
      withdrawn_reason = 'consent_withdrawn',
      updated_at = clock_timestamp()
  WHERE publication.outcome_id = p_outcome_id;

  SELECT jsonb_build_object(
    'receiptVersion', 1,
    'operationKey', p_operation_key,
    'outcomeId', p_outcome_id,
    'threadId', p_thread_id,
    'revision', v_publication.revision,
    'publicationState', 'withdrawn',
    'withdrawnAt', publication.withdrawn_at,
    'replayed', false
  ) INTO v_result
  FROM public.community_decision_outcome_publications AS publication
  WHERE publication.outcome_id = p_outcome_id;

  RETURN community_private.complete_decision_publication_command(
    v_command.id,
    v_result
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.community_list_decision_outcome_reviews(
  p_state text DEFAULT 'pending_review',
  p_cursor_at timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $$
DECLARE
  v_items jsonb := '[]'::jsonb;
  v_has_more boolean := false;
  v_next_at timestamptz;
  v_next_id uuid;
BEGIN
  PERFORM public.community_assert_decision_service();
  IF p_state NOT IN ('pending_review', 'published', 'rejected', 'withdrawn')
    OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50
    OR ((p_cursor_at IS NULL) <> (p_cursor_id IS NULL)) THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_PUBLICATION_QUEUE_INVALID'
      USING ERRCODE = '22023';
  END IF;

  WITH candidates AS (
    SELECT
      publication.outcome_id,
      publication.thread_id,
      publication.revision,
      publication.publication_state,
      publication.action_taken,
      publication.result_summary,
      publication.applicable_conditions,
      publication.commercial_relationship,
      publication.sponsorship_detail,
      publication.created_at,
      publication.reviewed_at,
      publication.review_reason,
      publication.review_policy_version,
      publication.published_at,
      publication.withdrawn_at,
      publication.withdrawn_reason,
      post.title,
      post.content AS source_content,
      thread.desired_answer,
      profile.nickname AS author_nickname,
      (
        outcome.public_consent IS TRUE
        AND thread.state = 'completed'
        AND thread.source_unavailable_at IS NULL
        AND post.publication_state = 'published'
        AND post.visibility = 'public'
        AND post.author_visibility = 'public'
        AND post.audience_scope = 'public'
        AND COALESCE(post.under_review, false) = false
        AND COALESCE(profile.is_suspended, false) = false
        AND EXISTS (
          SELECT 1
          FROM public.community_thread_evidence_selections AS visible_selection
          WHERE visible_selection.thread_id = thread.id
            AND visible_selection.included_in_resolution_at IS NOT NULL
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.community_thread_evidence_selections AS visible_selection
          WHERE visible_selection.thread_id = thread.id
            AND visible_selection.included_in_resolution_at IS NOT NULL
            AND NOT EXISTS (
              SELECT 1
              FROM public.community_decision_answers AS visible_answer
              JOIN public.community_comments AS visible_comment
                ON visible_comment.id = visible_answer.comment_id
               AND visible_comment.is_deleted = false
              JOIN public.community_profiles AS visible_answer_profile
                ON visible_answer_profile.user_id = visible_answer.author_id
               AND COALESCE(visible_answer_profile.is_suspended, false) = false
              WHERE visible_answer.id = visible_selection.answer_id
                AND visible_answer.thread_id = thread.id
                AND visible_answer.is_qualified
                AND NOT community_private.users_are_blocked(
                  thread.author_id,
                  visible_answer.author_id
                )
            )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.community_decision_outcomes AS newer
          WHERE newer.thread_id = outcome.thread_id
            AND newer.revision > outcome.revision
        )
      ) AS source_available,
      COALESCE(evidence.items, '[]'::jsonb) AS selected_evidence
    FROM public.community_decision_outcome_publications AS publication
    JOIN public.community_decision_outcomes AS outcome
      ON outcome.id = publication.outcome_id
    JOIN public.community_decision_threads AS thread
      ON thread.id = publication.thread_id
    JOIN public.community_posts AS post ON post.id = thread.post_id
    JOIN public.community_profiles AS profile
      ON profile.user_id = thread.author_id
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object(
          'content', comment.content,
          'contentOrigin', answer.content_origin,
          'applicability', selection.applicability,
          'commercialRelationship', answer.commercial_relationship,
          'sponsorshipDetail', answer.sponsorship_detail
        ) ORDER BY selection.selected_at ASC, selection.id ASC
      ) AS items
      FROM public.community_thread_evidence_selections AS selection
      JOIN public.community_decision_answers AS answer
        ON answer.id = selection.answer_id
       AND answer.is_qualified
      JOIN public.community_comments AS comment
        ON comment.id = answer.comment_id
       AND comment.is_deleted = false
      JOIN public.community_profiles AS answer_profile
        ON answer_profile.user_id = answer.author_id
       AND COALESCE(answer_profile.is_suspended, false) = false
      WHERE selection.thread_id = publication.thread_id
        AND selection.included_in_resolution_at IS NOT NULL
    ) AS evidence ON true
    WHERE publication.publication_state = p_state
      AND (
        p_cursor_at IS NULL
        OR (publication.created_at, publication.outcome_id)
          < (p_cursor_at, p_cursor_id)
      )
  ), paged AS (
    SELECT candidates.*
    FROM candidates
    ORDER BY candidates.created_at DESC, candidates.outcome_id DESC
    LIMIT p_limit + 1
  ), visible AS (
    SELECT paged.*
    FROM paged
    ORDER BY paged.created_at DESC, paged.outcome_id DESC
    LIMIT p_limit
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'outcomeId', visible.outcome_id,
        'threadId', visible.thread_id,
        'revision', visible.revision,
        'publicationState', visible.publication_state,
        'sourceAvailable', visible.source_available,
        'authorNickname', visible.author_nickname,
        'title', visible.title,
        'sourceContent', visible.source_content,
        'desiredAnswer', visible.desired_answer,
        'actionTaken', visible.action_taken,
        'resultSummary', visible.result_summary,
        'applicableConditions', visible.applicable_conditions,
        'commercialRelationship', visible.commercial_relationship,
        'sponsorshipDetail', visible.sponsorship_detail,
        'selectedEvidence', visible.selected_evidence,
        'createdAt', visible.created_at,
        'reviewedAt', visible.reviewed_at,
        'reviewReason', visible.review_reason,
        'reviewPolicyVersion', visible.review_policy_version,
        'publishedAt', visible.published_at,
        'withdrawnAt', visible.withdrawn_at,
        'withdrawnReason', visible.withdrawn_reason
      ) ORDER BY visible.created_at DESC, visible.outcome_id DESC
    ), '[]'::jsonb),
    (SELECT count(*) > p_limit FROM paged),
    (SELECT last_item.created_at FROM visible AS last_item
      ORDER BY last_item.created_at ASC, last_item.outcome_id ASC LIMIT 1),
    (SELECT last_item.outcome_id FROM visible AS last_item
      ORDER BY last_item.created_at ASC, last_item.outcome_id ASC LIMIT 1)
  INTO v_items, v_has_more, v_next_at, v_next_id
  FROM visible;

  RETURN jsonb_build_object(
    'items', v_items,
    'nextCursor', CASE
      WHEN v_has_more AND v_next_at IS NOT NULL AND v_next_id IS NOT NULL
      THEN jsonb_build_object('at', v_next_at, 'id', v_next_id)
      ELSE NULL
    END,
    'hasMore', v_has_more,
    'state', p_state
  );
END;
$$;

ALTER FUNCTION community_private.open_decision_publication_command(
  uuid, text, uuid, uuid, jsonb
) OWNER TO postgres;
ALTER FUNCTION community_private.tombstone_decision_publication_actor()
  OWNER TO postgres;
ALTER FUNCTION community_private.complete_decision_publication_command(
  uuid, jsonb
) OWNER TO postgres;
ALTER FUNCTION public.community_has_completed_decision_publication_command(
  uuid, text, uuid, uuid, jsonb
) OWNER TO postgres;
ALTER FUNCTION public.community_review_decision_outcome(
  uuid, uuid, text, text, text, uuid
) OWNER TO postgres;
ALTER FUNCTION public.community_withdraw_decision_outcome_publication(
  uuid, uuid, uuid, uuid
) OWNER TO postgres;
ALTER FUNCTION public.community_list_decision_outcome_reviews(
  text, timestamptz, uuid, integer
) OWNER TO postgres;

REVOKE ALL ON FUNCTION community_private.open_decision_publication_command(
  uuid, text, uuid, uuid, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION community_private.tombstone_decision_publication_actor()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION community_private.complete_decision_publication_command(
  uuid, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_has_completed_decision_publication_command(
  uuid, text, uuid, uuid, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_review_decision_outcome(
  uuid, uuid, text, text, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_withdraw_decision_outcome_publication(
  uuid, uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_list_decision_outcome_reviews(
  text, timestamptz, uuid, integer
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.community_review_decision_outcome(
  uuid, uuid, text, text, text, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION public.community_has_completed_decision_publication_command(
  uuid, text, uuid, uuid, jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.community_withdraw_decision_outcome_publication(
  uuid, uuid, uuid, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION public.community_list_decision_outcome_reviews(
  text, timestamptz, uuid, integer
) TO service_role;

COMMENT ON TABLE public.community_decision_publication_commands IS
  'Immutable idempotency and audit records for reviewed outcome publication and author consent withdrawal.';
COMMENT ON FUNCTION public.community_review_decision_outcome(
  uuid, uuid, text, text, text, uuid
) IS
  'Human-only publish/reject gate for a pending DecisionThread outcome projection.';
COMMENT ON FUNCTION public.community_has_completed_decision_publication_command(
  uuid, text, uuid, uuid, jsonb
) IS
  'Content-free exact-payload replay oracle used only to bypass mutable API gates for completed publication commands.';
COMMENT ON FUNCTION public.community_withdraw_decision_outcome_publication(
  uuid, uuid, uuid, uuid
) IS
  'Author-owned emergency consent withdrawal, allowed independently of community runtime mode.';

COMMIT;
