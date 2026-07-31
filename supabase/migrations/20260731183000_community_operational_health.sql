-- Read-only operational health metrics for the community release boundary.
--
-- This function intentionally exposes aggregate counts only and is executable
-- only by service_role. It must be invoked behind the application admin gate;
-- it is not a member-facing analytics endpoint.

CREATE OR REPLACE FUNCTION public.community_operational_health(
  p_window_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
  v_window_start timestamptz;
  v_public_post_count bigint;
  v_window_question_count bigint;
  v_mature_question_count bigint;
  v_unanswered_over_24h_count bigint;
  v_replied_within_24h_count bigint;
  v_resolved_question_count bigint;
  v_first_human_reply_median_hours numeric;
  v_pending_report_count bigint;
  v_oldest_pending_report_hours numeric;
  v_unresolved_appeal_count bigint;
  v_unread_reply_notification_count bigint;
  v_post_origin_counts jsonb;
  v_comment_origin_counts jsonb;
BEGIN
  IF p_window_days IS NULL OR p_window_days < 7 OR p_window_days > 90 THEN
    RAISE EXCEPTION 'community health window must be between 7 and 90 days'
      USING ERRCODE = '22023';
  END IF;

  v_window_start := v_now - make_interval(days => p_window_days);

  SELECT count(*)
  INTO v_public_post_count
  FROM public.community_posts AS post
  WHERE post.visibility = 'public'
    AND COALESCE(post.under_review, false) = false;

  WITH window_questions AS (
    SELECT
      post.id,
      post.created_at,
      COALESCE(post.is_resolved, false) AS is_resolved
    FROM public.community_posts AS post
    WHERE post.visibility = 'public'
      AND COALESCE(post.under_review, false) = false
      AND post.category IN ('is_normal', 'ama')
      AND post.created_at >= v_window_start
      AND post.created_at <= v_now
  ),
  question_first_human_reply AS (
    SELECT
      question.id,
      question.created_at,
      question.is_resolved,
      min(comment.created_at) FILTER (
        WHERE comment.content_origin IN ('member', 'industry_professional')
          AND COALESCE(comment.is_deleted, false) = false
          AND comment.created_at >= question.created_at
      ) AS first_human_reply_at
    FROM window_questions AS question
    LEFT JOIN public.community_comments AS comment
      ON comment.post_id = question.id
    GROUP BY question.id, question.created_at, question.is_resolved
  )
  SELECT
    count(*),
    count(*) FILTER (
      WHERE created_at <= v_now - interval '24 hours'
    ),
    count(*) FILTER (
      WHERE created_at <= v_now - interval '24 hours'
        AND first_human_reply_at IS NULL
    ),
    count(*) FILTER (
      WHERE created_at <= v_now - interval '24 hours'
        AND first_human_reply_at <= created_at + interval '24 hours'
    ),
    count(*) FILTER (WHERE is_resolved),
    round(
      (
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY extract(
            epoch FROM (first_human_reply_at - created_at)
          ) / 3600.0
        ) FILTER (WHERE first_human_reply_at IS NOT NULL)
      )::numeric,
      3
    )
  INTO
    v_window_question_count,
    v_mature_question_count,
    v_unanswered_over_24h_count,
    v_replied_within_24h_count,
    v_resolved_question_count,
    v_first_human_reply_median_hours
  FROM question_first_human_reply;

  SELECT jsonb_build_object(
    'member',
    count(*) FILTER (WHERE post.content_origin = 'member'),
    'operator',
    count(*) FILTER (WHERE post.content_origin = 'operator'),
    'ai',
    count(*) FILTER (WHERE post.content_origin = 'ai'),
    'industry_professional',
    count(*) FILTER (
      WHERE post.content_origin = 'industry_professional'
    ),
    'legacy_unverified',
    count(*) FILTER (
      WHERE post.content_origin = 'legacy_unverified'
    )
  )
  INTO v_post_origin_counts
  FROM public.community_posts AS post
  WHERE post.visibility = 'public'
    AND COALESCE(post.under_review, false) = false;

  SELECT jsonb_build_object(
    'member',
    count(*) FILTER (WHERE comment.content_origin = 'member'),
    'operator',
    count(*) FILTER (WHERE comment.content_origin = 'operator'),
    'ai',
    count(*) FILTER (WHERE comment.content_origin = 'ai'),
    'industry_professional',
    count(*) FILTER (
      WHERE comment.content_origin = 'industry_professional'
    ),
    'legacy_unverified',
    count(*) FILTER (
      WHERE comment.content_origin = 'legacy_unverified'
    )
  )
  INTO v_comment_origin_counts
  FROM public.community_comments AS comment
  JOIN public.community_posts AS post ON post.id = comment.post_id
  WHERE post.visibility = 'public'
    AND COALESCE(post.under_review, false) = false
    AND COALESCE(comment.is_deleted, false) = false;

  SELECT
    count(*),
    CASE
      WHEN count(*) = 0 THEN NULL
      ELSE round(
        (
          extract(epoch FROM (v_now - min(report.created_at))) / 3600.0
        )::numeric,
        3
      )
    END
  INTO v_pending_report_count, v_oldest_pending_report_hours
  FROM public.community_reports AS report
  WHERE report.status = 'pending';

  SELECT count(*)
  INTO v_unresolved_appeal_count
  FROM public.community_moderation_appeals AS appeal
  WHERE appeal.status IN ('pending', 'reviewed');

  SELECT count(*)
  INTO v_unread_reply_notification_count
  FROM public.community_reply_notifications AS notification
  WHERE notification.read_at IS NULL;

  RETURN jsonb_build_object(
    'window_days', p_window_days,
    'window_start', v_window_start,
    'measured_at', v_now,
    'public_non_review_post_count', v_public_post_count,
    'window_question_count', v_window_question_count,
    'over_24h_without_human_reply_count', v_unanswered_over_24h_count,
    'first_human_reply_median_hours', v_first_human_reply_median_hours,
    'human_reply_within_24h_rate',
      CASE
        WHEN v_mature_question_count = 0 THEN NULL
        ELSE round(
          v_replied_within_24h_count::numeric
            / v_mature_question_count::numeric,
          6
        )
      END,
    'resolved_question_rate',
      CASE
        WHEN v_window_question_count = 0 THEN NULL
        ELSE round(
          v_resolved_question_count::numeric
            / v_window_question_count::numeric,
          6
        )
      END,
    'post_content_origin_counts', v_post_origin_counts,
    'comment_content_origin_counts', v_comment_origin_counts,
    'pending_report_count', v_pending_report_count,
    'oldest_pending_report_hours', v_oldest_pending_report_hours,
    'unresolved_appeal_count', v_unresolved_appeal_count,
    'unread_reply_notification_count', v_unread_reply_notification_count
  );
END;
$$;

COMMENT ON FUNCTION public.community_operational_health(integer) IS
  'Service-only, read-only community release health aggregates. Human replies are member or industry_professional content; 24h response rate excludes questions younger than 24h.';

REVOKE ALL
  ON FUNCTION public.community_operational_health(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION public.community_operational_health(integer)
  TO service_role;
