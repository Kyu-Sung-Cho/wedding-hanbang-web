BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Canonical outcomes are private even when the author expresses publication
-- intent. A separately reviewed projection is the only table a public feed
-- may read. P0 records consented revisions as pending_review; no automatic
-- path can promote them to published.
CREATE TABLE public.community_decision_outcome_publications (
  outcome_id uuid PRIMARY KEY
    REFERENCES public.community_decision_outcomes(id) ON DELETE RESTRICT,
  thread_id uuid NOT NULL
    REFERENCES public.community_decision_threads(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  consent_version smallint NOT NULL,
  publication_state text NOT NULL DEFAULT 'pending_review',
  action_taken text NOT NULL,
  result_summary text NOT NULL,
  applicable_conditions text NOT NULL,
  commercial_relationship text NOT NULL,
  sponsorship_detail text,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_reason text,
  review_policy_version text,
  published_at timestamptz,
  withdrawn_at timestamptz,
  withdrawn_reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT community_decision_outcome_publication_revision
    UNIQUE (thread_id, revision),
  CONSTRAINT community_decision_outcome_publication_state CHECK (
    publication_state IN (
      'pending_review', 'published', 'rejected', 'withdrawn'
    )
  ),
  CONSTRAINT community_decision_outcome_publication_consent
    CHECK (consent_version = 1),
  CONSTRAINT community_decision_outcome_publication_content CHECK (
    char_length(btrim(action_taken)) BETWEEN 3 AND 2000
    AND char_length(btrim(result_summary)) BETWEEN 3 AND 3000
    AND char_length(btrim(applicable_conditions)) BETWEEN 3 AND 2000
  ),
  CONSTRAINT community_decision_outcome_publication_relationship CHECK (
    commercial_relationship IN (
      'none', 'gift', 'discount', 'refund', 'affiliate', 'paid',
      'employee', 'owner_or_family', 'platform_research_compensation'
    )
  ),
  CONSTRAINT community_decision_outcome_publication_disclosure CHECK (
    (commercial_relationship = 'none' AND sponsorship_detail IS NULL)
    OR (
      commercial_relationship <> 'none'
      AND char_length(btrim(sponsorship_detail)) BETWEEN 3 AND 500
    )
  ),
  CONSTRAINT community_decision_outcome_publication_review_shape CHECK (
    (
      publication_state = 'pending_review'
      AND reviewed_at IS NULL
      AND review_reason IS NULL
      AND review_policy_version IS NULL
      AND published_at IS NULL
      AND withdrawn_at IS NULL
      AND withdrawn_reason IS NULL
    ) OR (
      publication_state = 'published'
      AND reviewed_at IS NOT NULL
      AND char_length(btrim(review_reason)) BETWEEN 3 AND 500
      AND char_length(btrim(review_policy_version)) BETWEEN 1 AND 64
      AND published_at IS NOT NULL
      AND withdrawn_at IS NULL
      AND withdrawn_reason IS NULL
    ) OR (
      publication_state = 'rejected'
      AND reviewed_at IS NOT NULL
      AND char_length(btrim(review_reason)) BETWEEN 3 AND 500
      AND char_length(btrim(review_policy_version)) BETWEEN 1 AND 64
      AND published_at IS NULL
      AND withdrawn_at IS NULL
      AND withdrawn_reason IS NULL
    ) OR (
      publication_state = 'withdrawn'
      AND withdrawn_at IS NOT NULL
      AND withdrawn_reason IN (
        'superseded', 'consent_withdrawn', 'source_unavailable',
        'moderation_hold', 'author_withdrawn'
      )
    )
  )
);

CREATE INDEX community_decision_outcome_publications_feed
  ON public.community_decision_outcome_publications(
    publication_state, published_at DESC, thread_id
  ) WHERE publication_state = 'published';

ALTER TABLE public.community_decision_outcome_publications
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_decision_outcome_publications
  FORCE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE
  public.community_decision_outcome_publications
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION community_private.queue_decision_outcome_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- A new canonical revision supersedes both a published projection and an
  -- earlier pending request. A private revision therefore acts as immediate
  -- consent withdrawal without deleting the private outcome history.
  UPDATE public.community_decision_outcome_publications AS publication
  SET publication_state = 'withdrawn',
      withdrawn_at = clock_timestamp(),
      withdrawn_reason = CASE
        WHEN NEW.public_consent THEN 'superseded'
        ELSE 'consent_withdrawn'
      END,
      updated_at = clock_timestamp()
  WHERE publication.thread_id = NEW.thread_id
    AND publication.outcome_id <> NEW.id
    AND publication.publication_state IN ('pending_review', 'published');

  IF NEW.public_consent THEN
    INSERT INTO public.community_decision_outcome_publications (
      outcome_id,
      thread_id,
      revision,
      consent_version,
      action_taken,
      result_summary,
      applicable_conditions,
      commercial_relationship,
      sponsorship_detail
    ) VALUES (
      NEW.id,
      NEW.thread_id,
      NEW.revision,
      NEW.consent_version,
      NEW.action_taken,
      NEW.result_summary,
      NEW.applicable_conditions,
      NEW.commercial_relationship,
      NEW.sponsorship_detail
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER community_decision_outcome_review_queue
AFTER INSERT ON public.community_decision_outcomes
FOR EACH ROW EXECUTE FUNCTION community_private.queue_decision_outcome_review();

-- Existing consented canonical rows are review candidates, never implicitly
-- public. Only the latest revision per thread remains active in the queue.
INSERT INTO public.community_decision_outcome_publications (
  outcome_id,
  thread_id,
  revision,
  consent_version,
  action_taken,
  result_summary,
  applicable_conditions,
  commercial_relationship,
  sponsorship_detail
)
SELECT
  outcome.id,
  outcome.thread_id,
  outcome.revision,
  outcome.consent_version,
  outcome.action_taken,
  outcome.result_summary,
  outcome.applicable_conditions,
  outcome.commercial_relationship,
  outcome.sponsorship_detail
FROM public.community_decision_outcomes AS outcome
WHERE outcome.public_consent = true
  AND NOT EXISTS (
    SELECT 1
    FROM public.community_decision_outcomes AS newer
    WHERE newer.thread_id = outcome.thread_id
      AND newer.revision > outcome.revision
  );

-- DecisionThread discovery is a viewer-aware projection. Raw thread, answer,
-- selection, and outcome tables remain service-private; clients receive only
-- fields that survived publication, moderation, consent, and block checks.
CREATE OR REPLACE FUNCTION public.community_list_decision_threads(
  p_viewer_id uuid,
  p_mode text DEFAULT 'for_you',
  p_cursor_at timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 10
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
  v_items jsonb := '[]'::jsonb;
  v_has_more boolean := false;
  v_next_at timestamptz;
  v_next_id uuid;
BEGIN
  PERFORM public.community_assert_decision_service();

  IF p_mode NOT IN ('for_you', 'needs_help', 'outcomes')
    OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20
    OR ((p_cursor_at IS NULL) <> (p_cursor_id IS NULL)) THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_FEED_INVALID'
      USING ERRCODE = '22023';
  END IF;
  IF p_viewer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM auth.users AS app_user WHERE app_user.id = p_viewer_id
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_VIEWER_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  -- "내 경험이 필요한 질문" is never a generic unanswered feed. It is an
  -- authenticated queue containing only a live accepted responder request.
  IF p_mode = 'needs_help' AND p_viewer_id IS NULL THEN
    RETURN jsonb_build_object(
      'items', '[]'::jsonb,
      'nextCursor', NULL,
      'hasMore', false,
      'mode', p_mode
    );
  END IF;

  WITH eligible AS (
    SELECT
      thread.id AS thread_id,
      thread.post_id,
      thread.state,
      thread.version,
      thread.kind,
      thread.topic_category,
      thread.experience_scope,
      thread.coarse_region,
      thread.preparation_stage,
      thread.contract_phase,
      thread.desired_answer,
      thread.created_at,
      post.title,
      post.content,
      post.content_origin,
      post.commercial_relationship,
      post.sponsorship_detail,
      profile.nickname AS author_nickname,
      profile.badge AS author_badge,
      visible_counts.peer_count,
      visible_counts.professional_count,
      responder.can_answer,
      latest_outcome.outcome_id,
      latest_outcome.revision AS outcome_revision,
      latest_outcome.action_taken AS outcome_action_taken,
      latest_outcome.result_summary AS outcome_result_summary,
      latest_outcome.applicable_conditions AS outcome_applicable_conditions,
      latest_outcome.commercial_relationship AS outcome_relationship,
      latest_outcome.sponsorship_detail AS outcome_sponsorship_detail,
      latest_outcome.created_at AS outcome_created_at,
      CASE
        WHEN p_mode = 'outcomes' THEN latest_outcome.created_at
        ELSE thread.created_at
      END AS sort_at,
      thread.author_id IS NOT DISTINCT FROM p_viewer_id AS is_author
    FROM public.community_decision_threads AS thread
    JOIN public.community_posts AS post ON post.id = thread.post_id
    JOIN public.community_profiles AS profile
      ON profile.user_id = thread.author_id
     AND COALESCE(profile.is_suspended, false) = false
    LEFT JOIN LATERAL (
      SELECT publication.*
      FROM public.community_decision_outcome_publications AS publication
      WHERE publication.thread_id = thread.id
        AND publication.publication_state = 'published'
        AND EXISTS (
          SELECT 1
          FROM public.community_thread_evidence_selections AS selection
          WHERE selection.thread_id = publication.thread_id
            AND selection.included_in_resolution_at IS NOT NULL
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.community_thread_evidence_selections AS selection
          WHERE selection.thread_id = publication.thread_id
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
                AND answer.thread_id = publication.thread_id
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
      LIMIT 1
    ) AS latest_outcome ON true
    LEFT JOIN LATERAL (
      SELECT
        count(*) FILTER (
          WHERE answer.content_origin = 'member'
        )::integer AS peer_count,
        count(*) FILTER (
          WHERE answer.content_origin = 'industry_professional'
        )::integer AS professional_count
      FROM public.community_decision_answers AS answer
      JOIN public.community_comments AS comment
        ON comment.id = answer.comment_id
       AND comment.is_deleted = false
      JOIN public.community_profiles AS answer_profile
        ON answer_profile.user_id = answer.author_id
      WHERE answer.thread_id = thread.id
        AND answer.is_qualified
        AND COALESCE(answer_profile.is_suspended, false) = false
        AND (
          p_viewer_id IS NULL
          OR answer.author_id = p_viewer_id
          OR NOT community_private.users_are_blocked(
            p_viewer_id,
            answer.author_id
          )
        )
    ) AS visible_counts ON true
    LEFT JOIN LATERAL (
      SELECT EXISTS (
        SELECT 1
        FROM public.community_responder_requests AS request
        WHERE request.question_id = thread.id
          AND request.responder_id = p_viewer_id
          AND request.status = 'accepted'
          AND request.expires_at > clock_timestamp()
          AND request.response_has_conflict IS FALSE
          AND EXISTS (
            SELECT 1
            FROM public.community_profiles AS responder_profile
            WHERE responder_profile.user_id = p_viewer_id
              AND COALESCE(responder_profile.is_suspended, false) = false
          )
          AND NOT EXISTS (
            SELECT 1
            FROM public.community_decision_answers AS own_answer
            WHERE own_answer.thread_id = thread.id
              AND own_answer.author_id = p_viewer_id
          )
      ) AS can_answer
    ) AS responder ON p_viewer_id IS NOT NULL
    WHERE public.community_runtime_mode() <> 'disabled'
      AND thread.source_unavailable_at IS NULL
      AND thread.post_id IS NOT NULL
      AND post.publication_state = 'published'
      AND post.audience_scope = 'public'
      AND post.visibility = 'public'
      AND post.author_visibility = 'public'
      AND COALESCE(post.under_review, false) = false
      AND (
        p_viewer_id IS NULL
        OR thread.author_id = p_viewer_id
        OR NOT community_private.users_are_blocked(
          p_viewer_id,
          thread.author_id
        )
      )
      AND CASE p_mode
        WHEN 'needs_help' THEN
          public.community_runtime_mode() = 'normal'
          AND thread.state IN ('open', 'answered')
          AND thread.new_applications_allowed
          AND responder.can_answer
        WHEN 'outcomes' THEN
          thread.state = 'completed'
          AND latest_outcome.outcome_id IS NOT NULL
          AND post.commercial_relationship = 'none'
          AND latest_outcome.commercial_relationship = 'none'
        ELSE
          -- Commercially related records remain reachable by a direct,
          -- disclosed link but do not enter the organic P0 discovery feed.
          post.commercial_relationship = 'none'
      END
  ), paged AS (
    SELECT eligible.*
    FROM eligible
    WHERE p_cursor_at IS NULL
      OR (eligible.sort_at, eligible.thread_id) < (p_cursor_at, p_cursor_id)
    ORDER BY eligible.sort_at DESC, eligible.thread_id DESC
    LIMIT p_limit + 1
  ), visible AS (
    SELECT paged.*
    FROM paged
    ORDER BY paged.sort_at DESC, paged.thread_id DESC
    LIMIT p_limit
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'threadId', visible.thread_id,
        'postId', visible.post_id,
        'state', visible.state,
        'version', visible.version,
        'kind', visible.kind,
        'topicCategory', visible.topic_category,
        'experienceScope', visible.experience_scope,
        'coarseRegion', visible.coarse_region,
        'preparationStage', visible.preparation_stage,
        'contractPhase', visible.contract_phase,
        'desiredAnswer', visible.desired_answer,
        'title', visible.title,
        'content', visible.content,
        'contentOrigin', visible.content_origin,
        'commercialRelationship', visible.commercial_relationship,
        'sponsorshipDetail', visible.sponsorship_detail,
        'author', jsonb_build_object(
          'nickname', visible.author_nickname,
          'badge', visible.author_badge
        ),
        'qualifiedPeerAnswerCount', COALESCE(visible.peer_count, 0),
        'qualifiedProfessionalAnswerCount',
          COALESCE(visible.professional_count, 0),
        'viewer', jsonb_build_object(
          'isAuthor', visible.is_author,
          'canAnswer', COALESCE(visible.can_answer, false)
        ),
        'outcome', CASE
          WHEN visible.outcome_id IS NULL THEN NULL
          ELSE jsonb_build_object(
            'id', visible.outcome_id,
            'revision', visible.outcome_revision,
            'actionTaken', visible.outcome_action_taken,
            'resultSummary', visible.outcome_result_summary,
            'applicableConditions', visible.outcome_applicable_conditions,
            'commercialRelationship', visible.outcome_relationship,
            'sponsorshipDetail', visible.outcome_sponsorship_detail,
            'createdAt', visible.outcome_created_at
          )
        END,
        'createdAt', visible.created_at,
        'sortAt', visible.sort_at
      ) ORDER BY visible.sort_at DESC, visible.thread_id DESC
    ), '[]'::jsonb),
    (SELECT count(*) > p_limit FROM paged),
    (SELECT last_item.sort_at FROM visible AS last_item
      ORDER BY last_item.sort_at ASC, last_item.thread_id ASC LIMIT 1),
    (SELECT last_item.thread_id FROM visible AS last_item
      ORDER BY last_item.sort_at ASC, last_item.thread_id ASC LIMIT 1)
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
    'mode', p_mode
  );
END;
$$;

-- The inbox is intentionally factual: every number is derived from durable
-- owner, responder, or consented-outcome records. It never invents activity
-- to make an empty beta look busy.
CREATE OR REPLACE FUNCTION public.community_get_decision_inbox(
  p_viewer_id uuid
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
  v_waiting_count integer := 0;
  v_waiting_id uuid;
  v_waiting_status text;
  v_needed_count integer := 0;
  v_needed_id uuid;
  v_outcome_count integer := 0;
  v_outcome_id uuid;
BEGIN
  PERFORM public.community_assert_decision_service();
  IF p_viewer_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.users AS app_user WHERE app_user.id = p_viewer_id
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_DECISION_VIEWER_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  WITH waiting AS (
    SELECT intake.question_id, 'private_waitlist'::text AS status,
           intake.created_at AS sort_at
    FROM public.community_decision_thread_intakes AS intake
    WHERE intake.author_id = p_viewer_id
      AND intake.status = 'private_waitlist'
    UNION ALL
    SELECT thread.id, 'open'::text, thread.created_at
    FROM public.community_decision_threads AS thread
    JOIN public.community_posts AS post ON post.id = thread.post_id
    WHERE thread.author_id = p_viewer_id
      AND thread.state = 'open'
      AND thread.source_unavailable_at IS NULL
      AND post.publication_state = 'published'
      AND post.visibility = 'public'
      AND post.author_visibility = 'public'
      AND post.audience_scope = 'public'
      AND COALESCE(post.under_review, false) = false
  ), summarized AS (
    SELECT waiting.*, count(*) OVER ()::integer AS total
    FROM waiting
    ORDER BY waiting.sort_at DESC, waiting.question_id DESC
    LIMIT 1
  )
  SELECT COALESCE(summarized.total, 0), summarized.question_id,
         summarized.status
  INTO v_waiting_count, v_waiting_id, v_waiting_status
  FROM summarized;

  IF public.community_runtime_mode() = 'normal' THEN
    WITH needed AS (
      SELECT DISTINCT thread.id, thread.created_at
      FROM public.community_responder_requests AS request
      JOIN public.community_decision_threads AS thread
        ON thread.id = request.question_id
      JOIN public.community_posts AS post ON post.id = thread.post_id
      JOIN public.community_profiles AS author_profile
        ON author_profile.user_id = thread.author_id
       AND COALESCE(author_profile.is_suspended, false) = false
      WHERE request.responder_id = p_viewer_id
        AND request.status = 'accepted'
        AND request.expires_at > clock_timestamp()
        AND request.response_has_conflict IS FALSE
        AND EXISTS (
          SELECT 1
          FROM public.community_profiles AS responder_profile
          WHERE responder_profile.user_id = p_viewer_id
            AND COALESCE(responder_profile.is_suspended, false) = false
        )
        AND thread.state IN ('open', 'answered')
        AND thread.source_unavailable_at IS NULL
        AND thread.new_applications_allowed
        AND post.publication_state = 'published'
        AND post.visibility = 'public'
        AND post.author_visibility = 'public'
        AND post.audience_scope = 'public'
        AND COALESCE(post.under_review, false) = false
        AND NOT community_private.users_are_blocked(
          p_viewer_id,
          thread.author_id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.community_decision_answers AS answer
          WHERE answer.thread_id = thread.id
            AND answer.author_id = p_viewer_id
        )
    ), summarized AS (
      SELECT needed.*, count(*) OVER ()::integer AS total
      FROM needed
      ORDER BY needed.created_at DESC, needed.id DESC
      LIMIT 1
    )
    SELECT COALESCE(summarized.total, 0), summarized.id
    INTO v_needed_count, v_needed_id
    FROM summarized;
  END IF;

  IF public.community_runtime_mode() <> 'disabled' THEN
    WITH latest_outcome AS (
      SELECT DISTINCT ON (publication.thread_id)
        publication.thread_id,
        publication.commercial_relationship,
        publication.published_at AS created_at
      FROM public.community_decision_outcome_publications AS publication
      JOIN public.community_decision_threads AS outcome_thread
        ON outcome_thread.id = publication.thread_id
      WHERE publication.publication_state = 'published'
        AND EXISTS (
          SELECT 1
          FROM public.community_thread_evidence_selections AS selection
          WHERE selection.thread_id = publication.thread_id
            AND selection.included_in_resolution_at IS NOT NULL
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.community_thread_evidence_selections AS selection
          WHERE selection.thread_id = publication.thread_id
            AND selection.included_in_resolution_at IS NOT NULL
            AND NOT EXISTS (
              SELECT 1
              FROM public.community_decision_answers AS selected_answer
              JOIN public.community_comments AS selected_comment
                ON selected_comment.id = selected_answer.comment_id
               AND selected_comment.is_deleted = false
              JOIN public.community_profiles AS selected_answer_profile
                ON selected_answer_profile.user_id = selected_answer.author_id
               AND COALESCE(
                 selected_answer_profile.is_suspended,
                 false
               ) = false
              WHERE selected_answer.id = selection.answer_id
                AND selected_answer.thread_id = publication.thread_id
                AND selected_answer.is_qualified
                AND NOT community_private.users_are_blocked(
                  outcome_thread.author_id,
                  selected_answer.author_id
                )
                AND (
                  selected_answer.author_id = p_viewer_id
                  OR NOT community_private.users_are_blocked(
                    p_viewer_id,
                    selected_answer.author_id
                  )
                )
            )
        )
      ORDER BY publication.thread_id, publication.revision DESC
    ), returned AS (
      SELECT DISTINCT thread.id, latest_outcome.created_at
      FROM public.community_decision_answers AS answer
      JOIN public.community_comments AS comment
        ON comment.id = answer.comment_id
       AND comment.is_deleted = false
      JOIN public.community_decision_threads AS thread
        ON thread.id = answer.thread_id
      JOIN public.community_posts AS post ON post.id = thread.post_id
      JOIN public.community_profiles AS author_profile
        ON author_profile.user_id = thread.author_id
       AND COALESCE(author_profile.is_suspended, false) = false
      JOIN latest_outcome ON latest_outcome.thread_id = thread.id
      WHERE answer.author_id = p_viewer_id
        AND answer.is_qualified
        AND thread.state = 'completed'
        AND thread.source_unavailable_at IS NULL
        AND latest_outcome.commercial_relationship = 'none'
        AND post.commercial_relationship = 'none'
        AND post.publication_state = 'published'
        AND post.visibility = 'public'
        AND post.author_visibility = 'public'
        AND post.audience_scope = 'public'
        AND COALESCE(post.under_review, false) = false
        AND NOT community_private.users_are_blocked(
          p_viewer_id,
          thread.author_id
        )
    ), summarized AS (
      SELECT returned.*, count(*) OVER ()::integer AS total
      FROM returned
      ORDER BY returned.created_at DESC, returned.id DESC
      LIMIT 1
    )
    SELECT COALESCE(summarized.total, 0), summarized.id
    INTO v_outcome_count, v_outcome_id
    FROM summarized;
  END IF;

  RETURN jsonb_build_object(
    'waitingReplies', jsonb_build_object(
      'count', COALESCE(v_waiting_count, 0),
      'targetQuestionId', v_waiting_id,
      'targetStatus', v_waiting_status
    ),
    'experienceNeeded', jsonb_build_object(
      'count', COALESCE(v_needed_count, 0),
      'targetThreadId', v_needed_id
    ),
    'returnedOutcomes', jsonb_build_object(
      'count', COALESCE(v_outcome_count, 0),
      'targetThreadId', v_outcome_id
    )
  );
END;
$$;

ALTER FUNCTION public.community_list_decision_threads(
  uuid, text, timestamptz, uuid, integer
) OWNER TO postgres;
ALTER FUNCTION public.community_get_decision_inbox(uuid) OWNER TO postgres;
ALTER FUNCTION community_private.queue_decision_outcome_review()
  OWNER TO postgres;

REVOKE ALL ON FUNCTION community_private.queue_decision_outcome_review()
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.community_list_decision_threads(
  uuid, text, timestamptz, uuid, integer
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_get_decision_inbox(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.community_list_decision_threads(
  uuid, text, timestamptz, uuid, integer
) TO service_role;
GRANT EXECUTE ON FUNCTION public.community_get_decision_inbox(uuid)
  TO service_role;

COMMENT ON FUNCTION public.community_list_decision_threads(
  uuid, text, timestamptz, uuid, integer
) IS
  'Viewer-aware cursor feed for organic decision records, accepted responder work, and consented latest outcomes.';
COMMENT ON FUNCTION public.community_get_decision_inbox(uuid) IS
  'Factual owner/responder/outcome inbox counts with one safe target id per lane.';
COMMENT ON TABLE public.community_decision_outcome_publications IS
  'Reviewed public projection; canonical outcome consent creates only a private pending-review candidate.';

COMMIT;
