BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- A returned-outcome inbox target must open the same reviewed projection that
-- made the inbox count factual. Canonical outcomes remain private. The read is
-- recomputed from current source visibility so deleted evidence, suspension,
-- blocking, source withdrawal, or an emergency kill switch fail closed.
CREATE OR REPLACE FUNCTION public.community_get_decision_public_outcome(
  p_thread_id uuid,
  p_viewer_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, community_private
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $$
DECLARE
  v_outcome jsonb;
BEGIN
  PERFORM public.community_assert_decision_service();
  IF p_thread_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_viewer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM auth.users AS app_user WHERE app_user.id = p_viewer_id
  ) THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'id', publication.outcome_id,
    'revision', publication.revision,
    'actionTaken', publication.action_taken,
    'resultSummary', publication.result_summary,
    'applicableConditions', publication.applicable_conditions,
    'commercialRelationship', publication.commercial_relationship,
    'sponsorshipDetail', publication.sponsorship_detail,
    'createdAt', publication.created_at
  )
  INTO v_outcome
  FROM public.community_decision_outcome_publications AS publication
  JOIN public.community_decision_threads AS thread
    ON thread.id = publication.thread_id
  JOIN public.community_posts AS post
    ON post.id = thread.post_id
  JOIN public.community_profiles AS author_profile
    ON author_profile.user_id = thread.author_id
   AND COALESCE(author_profile.is_suspended, false) = false
  WHERE publication.thread_id = p_thread_id
    AND publication.publication_state = 'published'
    AND publication.published_at IS NOT NULL
    AND public.community_decision_public_text_is_safe(
      publication.action_taken
    )
    AND public.community_decision_public_text_is_safe(
      publication.result_summary
    )
    AND public.community_decision_public_text_is_safe(
      publication.applicable_conditions
    )
    AND public.community_decision_public_text_is_safe(
      publication.sponsorship_detail
    )
    AND thread.state = 'completed'
    AND thread.source_unavailable_at IS NULL
    AND post.publication_state = 'published'
    AND post.visibility = 'public'
    AND post.author_visibility = 'public'
    AND post.audience_scope = 'public'
    AND COALESCE(post.under_review, false) = false
    AND public.community_runtime_mode() <> 'disabled'
    AND NOT EXISTS (
      SELECT 1
      FROM public.community_decision_outcomes AS newer
      WHERE newer.thread_id = publication.thread_id
        AND newer.revision > publication.revision
    )
    AND (
      p_viewer_id IS NULL
      OR thread.author_id = p_viewer_id
      OR NOT community_private.users_are_blocked(
        p_viewer_id,
        thread.author_id
      )
    )
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
            AND (
              p_viewer_id IS NULL
              OR answer.author_id = p_viewer_id
              OR NOT community_private.users_are_blocked(
                p_viewer_id,
                answer.author_id
              )
            )
        )
    )
  ORDER BY publication.revision DESC
  LIMIT 1;

  RETURN v_outcome;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_get_decision_outcome_publication_state(
  p_actor_id uuid,
  p_thread_id uuid,
  p_outcome_id uuid
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
  v_state jsonb;
BEGIN
  PERFORM public.community_assert_decision_service();
  IF p_actor_id IS NULL OR p_thread_id IS NULL OR p_outcome_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'outcomeId', publication.outcome_id,
    'threadId', publication.thread_id,
    'revision', publication.revision,
    'publicationState', publication.publication_state,
    'canWithdraw', publication.publication_state IN (
      'pending_review', 'published'
    ),
    'updatedAt', publication.updated_at
  )
  INTO v_state
  FROM public.community_decision_outcome_publications AS publication
  JOIN public.community_decision_outcomes AS outcome
    ON outcome.id = publication.outcome_id
   AND outcome.thread_id = publication.thread_id
  JOIN public.community_decision_threads AS thread
    ON thread.id = outcome.thread_id
  WHERE publication.outcome_id = p_outcome_id
    AND publication.thread_id = p_thread_id
    AND outcome.author_id = p_actor_id
    AND thread.author_id = p_actor_id;

  RETURN v_state;
END;
$$;

ALTER FUNCTION public.community_get_decision_public_outcome(uuid, uuid)
  OWNER TO postgres;
ALTER FUNCTION public.community_get_decision_outcome_publication_state(
  uuid, uuid, uuid
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.community_get_decision_public_outcome(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_get_decision_outcome_publication_state(
  uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_get_decision_public_outcome(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.community_get_decision_outcome_publication_state(
  uuid, uuid, uuid
) TO service_role;

COMMENT ON FUNCTION public.community_get_decision_public_outcome(uuid, uuid) IS
  'Current reviewed public outcome projection for a visible DecisionThread; canonical outcomes are never returned.';
COMMENT ON FUNCTION public.community_get_decision_outcome_publication_state(
  uuid, uuid, uuid
) IS
  'Owner-only state for presenting a truthful outcome publication consent withdrawal control.';

COMMIT;
