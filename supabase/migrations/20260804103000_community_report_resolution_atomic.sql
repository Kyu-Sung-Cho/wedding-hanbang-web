-- A report may be marked resolved only in the same transaction that contains
-- its target and appends durable moderation evidence. A later dismissal may
-- restore only the exact state hidden by that report, and only when no newer
-- moderation action or independently resolved report still requires containment.

-- The previous RPC could change only the report status and audit ledger. Close
-- that entry point so an older caller cannot claim resolution without applying
-- the target-content postcondition introduced below.

-- `created_at` historically used transaction-start `now()`. A transaction can
-- start first, wait for the target row lock, and insert after a newer-looking
-- event. Backfill one immutable sequence, then allocate every future value at
-- the actual INSERT boundary so causal content order does not depend on clocks
-- or UUID ordering.
CREATE SEQUENCE public.community_moderation_event_causal_sequence_seq
  AS bigint;

ALTER TABLE public.community_moderation_events
  ADD COLUMN causal_sequence bigint;

ALTER TABLE public.community_moderation_events
  DISABLE TRIGGER trg_community_moderation_events_append_only;

WITH ordered_events AS (
  SELECT
    event.id,
    row_number() OVER (
      ORDER BY event.created_at ASC, event.id ASC
    )::bigint AS causal_sequence
  FROM public.community_moderation_events AS event
)
UPDATE public.community_moderation_events AS event
SET causal_sequence = ordered.causal_sequence
FROM ordered_events AS ordered
WHERE ordered.id = event.id;

ALTER TABLE public.community_moderation_events
  ENABLE TRIGGER trg_community_moderation_events_append_only;

SELECT setval(
  'public.community_moderation_event_causal_sequence_seq'::regclass,
  COALESCE(
    (SELECT max(event.causal_sequence)
     FROM public.community_moderation_events AS event),
    1
  ),
  EXISTS (SELECT 1 FROM public.community_moderation_events)
);

ALTER TABLE public.community_moderation_events
  ALTER COLUMN causal_sequence SET DEFAULT
    nextval('public.community_moderation_event_causal_sequence_seq'::regclass),
  ALTER COLUMN causal_sequence SET NOT NULL;

ALTER SEQUENCE public.community_moderation_event_causal_sequence_seq
  OWNED BY public.community_moderation_events.causal_sequence;

CREATE UNIQUE INDEX community_moderation_events_causal_sequence_unique
  ON public.community_moderation_events(causal_sequence);
CREATE INDEX community_moderation_events_target_causal_sequence
  ON public.community_moderation_events(
    target_type,
    target_id,
    causal_sequence DESC
  );

REVOKE ALL ON SEQUENCE
  public.community_moderation_event_causal_sequence_seq
  FROM PUBLIC, anon, authenticated, service_role;

-- The general moderation RPC shares the same append-only ledger. Its replay
-- receipt must follow causal insertion order too; otherwise a later insert
-- carrying an older transaction timestamp can return an unrelated notice and
-- appeal anchor even though the target state itself is current.
CREATE OR REPLACE FUNCTION public.community_moderate_content(
  p_target_type text,
  p_target_id uuid,
  p_action text,
  p_reason text,
  p_admin_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_target_author_id uuid;
  v_before_state jsonb;
  v_contained_state jsonb;
  v_after_state jsonb;
  v_event_id uuid := gen_random_uuid();
  v_notice_id uuid := gen_random_uuid();
  v_latest_event_id uuid;
  v_latest_notice_id uuid;
  v_latest_action text;
  v_latest_before_state jsonb;
  v_latest_after_state jsonb;
  v_latest_metadata jsonb;
  v_source_event_id uuid;
  v_other_resolved_exists boolean := false;
  v_appeal_available boolean;
BEGIN
  IF NOT public.community_request_is_service() THEN
    RAISE EXCEPTION 'service role required'
      USING ERRCODE = '42501';
  END IF;

  IF p_target_type NOT IN ('post', 'comment')
    OR p_action NOT IN ('hide', 'restore', 'soft_delete') THEN
    RAISE EXCEPTION 'invalid moderation target or action'
      USING ERRCODE = '22023';
  END IF;

  IF p_admin_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.id = p_admin_id
      AND profile.is_admin = true
  ) THEN
    RAISE EXCEPTION 'verified administrator required'
      USING ERRCODE = '42501';
  END IF;

  IF p_reason IS NULL
    OR char_length(btrim(p_reason)) NOT BETWEEN 3 AND 2000 THEN
    RAISE EXCEPTION 'moderation reason must contain 3 to 2000 characters'
      USING ERRCODE = '22023';
  END IF;

  IF p_target_type = 'post' THEN
    SELECT
      post.author_id,
      jsonb_build_object(
        'visibility', post.visibility,
        'under_review', COALESCE(post.under_review, false)
      )
    INTO v_target_author_id, v_before_state
    FROM public.community_posts AS post
    WHERE post.id = p_target_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'moderation target not found'
        USING ERRCODE = 'P0002';
    END IF;

    v_contained_state := jsonb_build_object(
      'visibility', 'draft',
      'under_review', true
    );
  ELSE
    SELECT
      comment.author_id,
      jsonb_build_object('is_deleted', COALESCE(comment.is_deleted, false))
    INTO v_target_author_id, v_before_state
    FROM public.community_comments AS comment
    WHERE comment.id = p_target_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'moderation target not found'
        USING ERRCODE = 'P0002';
    END IF;

    v_contained_state := jsonb_build_object('is_deleted', true);
  END IF;

  -- Read the causally latest content-changing event while the target row is
  -- locked. Timestamps are transaction-start timestamps and cannot safely
  -- order two transactions that waited on the same target lock.
  SELECT
    event.id,
    notice.id,
    event.action,
    event.before_state,
    event.after_state,
    event.metadata
  INTO
    v_latest_event_id,
    v_latest_notice_id,
    v_latest_action,
    v_latest_before_state,
    v_latest_after_state,
    v_latest_metadata
  FROM public.community_moderation_events AS event
  LEFT JOIN public.community_moderation_notices AS notice
    ON notice.event_id = event.id
  WHERE event.target_type = p_target_type
    AND event.target_id = p_target_id
    AND event.action IN ('hide', 'restore', 'soft_delete')
  ORDER BY event.causal_sequence DESC
  LIMIT 1;

  IF p_action IN ('hide', 'soft_delete') THEN
    v_after_state := v_contained_state;

    -- A retry must never leap over a newer restore/containment event. Reuse
    -- only the causally latest receipt that still describes the locked row.
    IF v_before_state = v_contained_state
      AND v_latest_action IN ('hide', 'soft_delete')
      AND v_latest_after_state = v_before_state THEN
      RETURN jsonb_build_object(
        'ok', true,
        'idempotent_replay', true,
        'event_id', v_latest_event_id,
        'notice_id', v_latest_notice_id,
        'target_type', p_target_type,
        'target_id', p_target_id,
        'requested_action', p_action,
        'action', v_latest_action,
        'before_state', v_before_state,
        'after_state', v_before_state
      );
    END IF;
  ELSE
    -- A completed direct restore can be replayed, but a restore created by a
    -- report decision is owned by that report workflow and is not a receipt
    -- for this endpoint.
    IF v_latest_action = 'restore'
      AND v_latest_metadata ->> 'direct_moderation_version' = '2'
      AND v_latest_after_state = v_before_state THEN
      RETURN jsonb_build_object(
        'ok', true,
        'idempotent_replay', true,
        'event_id', v_latest_event_id,
        'notice_id', v_latest_notice_id,
        'target_type', p_target_type,
        'target_id', p_target_id,
        'action', 'restore',
        'before_state', v_before_state,
        'after_state', v_before_state
      );
    END IF;

    IF p_target_type = 'post' THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.community_reports AS report
        WHERE report.post_id = p_target_id
          AND report.status = 'resolved'
      ) INTO v_other_resolved_exists;
    ELSE
      SELECT EXISTS (
        SELECT 1
        FROM public.community_reports AS report
        WHERE report.comment_id = p_target_id
          AND report.status = 'resolved'
      ) INTO v_other_resolved_exists;
    END IF;

    IF v_other_resolved_exists THEN
      RAISE EXCEPTION 'confirmed reports still require containment'
        USING ERRCODE = '55000';
    END IF;

    IF v_latest_action NOT IN ('hide', 'soft_delete')
      OR v_latest_before_state IS NOT DISTINCT FROM v_latest_after_state
      OR v_before_state IS DISTINCT FROM v_latest_after_state THEN
      RAISE EXCEPTION 'no reversible direct moderation event matches the current state'
        USING ERRCODE = '55000';
    END IF;

    -- Atomic report containment must be dismissed through the exact report
    -- decision boundary. A general restore may not bypass another reporter's
    -- still-auditable decision, even when the row happens to look identical.
    IF v_latest_metadata ->> 'atomic_report_resolution_version' = '1'
      OR NULLIF(v_latest_metadata ->> 'report_id', '') IS NOT NULL THEN
      RAISE EXCEPTION 'report-owned containment requires the report review workflow'
        USING ERRCODE = '55000';
    END IF;

    v_source_event_id := v_latest_event_id;
    v_after_state := v_latest_before_state;
  END IF;

  v_appeal_available := p_action <> 'restore';

  -- Runtime controls freeze ordinary writes, but a verified service/admin
  -- safety action must still work. The transaction-local bypass is scoped to
  -- this function's audited writes and explicitly closed before returning.
  PERFORM set_config('app.community_safety_bypass', 'on', true);
  PERFORM set_config('hanbang.community_moderation_event_write', 'on', true);

  INSERT INTO public.community_moderation_events (
    id,
    target_type,
    target_id,
    target_author_id,
    action,
    actor_id,
    reason,
    before_state,
    after_state,
    metadata
  )
  VALUES (
    v_event_id,
    p_target_type,
    p_target_id,
    v_target_author_id,
    p_action,
    p_admin_id,
    btrim(p_reason),
    v_before_state,
    v_after_state,
    jsonb_strip_nulls(jsonb_build_object(
      'direct_moderation_version', 2,
      'content_action', p_action,
      'source_event_id', v_source_event_id
    ))
  );

  IF p_target_type = 'post' THEN
    UPDATE public.community_posts
    SET visibility = v_after_state ->> 'visibility',
        under_review = (v_after_state ->> 'under_review')::boolean,
        updated_at = now()
    WHERE id = p_target_id;

  ELSE
    UPDATE public.community_comments
    SET is_deleted = (v_after_state ->> 'is_deleted')::boolean,
        updated_at = now()
    WHERE id = p_target_id;

  END IF;

  INSERT INTO public.community_moderation_notices (
    id,
    event_id,
    recipient_id,
    target_type,
    target_id,
    action,
    reason,
    appeal_available
  )
  VALUES (
    v_notice_id,
    v_event_id,
    v_target_author_id,
    p_target_type,
    p_target_id,
    p_action,
    btrim(p_reason),
    v_appeal_available
  );

  IF p_action = 'restore' AND v_source_event_id IS NOT NULL THEN
    UPDATE public.community_moderation_appeals
    SET status = 'overturned',
        resolution_reason = btrim(p_reason),
        resolved_at = now()
    WHERE event_id = v_source_event_id
      AND status IN ('pending', 'reviewed', 'upheld');
  END IF;

  PERFORM set_config('hanbang.community_moderation_event_write', 'off', true);
  PERFORM set_config('app.community_safety_bypass', 'off', true);

  RETURN jsonb_build_object(
    'ok', true,
    'event_id', v_event_id,
    'notice_id', v_notice_id,
    'target_type', p_target_type,
    'target_id', p_target_id,
    'action', p_action,
    'before_state', v_before_state,
    'after_state', v_after_state
  );
END;
$$;

REVOKE ALL ON FUNCTION public.community_moderate_content(
  text, uuid, text, text, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_moderate_content(
  text, uuid, text, text, uuid
) TO service_role;

REVOKE ALL ON FUNCTION public.community_review_report(
  uuid, text, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.community_review_report_atomic(
  p_report_id uuid,
  p_status text,
  p_reason text,
  p_admin_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_report record;
  v_target_type text;
  v_target_id uuid;
  v_target_author_id uuid;
  v_current_content_state jsonb;
  v_contained_content_state jsonb;
  v_event_before_state jsonb;
  v_event_after_state jsonb;
  v_event_id uuid := gen_random_uuid();
  v_notice_id uuid;
  v_existing_event_id uuid;
  v_existing_notice_id uuid;
  v_existing_content_action text;
  v_content_action text := 'none';
  v_event_action text := 'review_report';
  v_source_event_id uuid;
  v_source_report_id uuid;
  v_source_before_state jsonb;
  v_source_after_state jsonb;
  v_latest_content_event_id uuid;
  v_other_resolved_exists boolean := false;
BEGIN
  IF NOT public.community_request_is_service() THEN
    RAISE EXCEPTION 'service role required'
      USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('reviewed', 'resolved', 'dismissed') THEN
    RAISE EXCEPTION 'invalid report review status'
      USING ERRCODE = '22023';
  END IF;

  IF p_admin_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.id = p_admin_id
      AND profile.is_admin = true
  ) THEN
    RAISE EXCEPTION 'verified administrator required'
      USING ERRCODE = '42501';
  END IF;

  IF p_reason IS NULL
    OR char_length(btrim(p_reason)) NOT BETWEEN 3 AND 2000 THEN
    RAISE EXCEPTION 'report review reason must contain 3 to 2000 characters'
      USING ERRCODE = '22023';
  END IF;

  SELECT report.*
  INTO v_report
  FROM public.community_reports AS report
  WHERE report.id = p_report_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'report not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_status = 'reviewed'
    AND v_report.status NOT IN ('pending', 'reviewed') THEN
    RAISE EXCEPTION 'a decided report cannot return to reviewed'
      USING ERRCODE = '22023';
  END IF;

  IF v_report.post_id IS NOT NULL THEN
    v_target_type := 'post';
    v_target_id := v_report.post_id;

    SELECT
      post.author_id,
      jsonb_build_object(
        'visibility', post.visibility,
        'under_review', COALESCE(post.under_review, false)
      )
    INTO v_target_author_id, v_current_content_state
    FROM public.community_posts AS post
    WHERE post.id = v_target_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'report target not found'
        USING ERRCODE = 'P0002';
    END IF;

    v_contained_content_state := jsonb_build_object(
      'visibility', 'draft',
      'under_review', true
    );
  ELSE
    v_target_type := 'comment';
    v_target_id := v_report.comment_id;

    SELECT
      comment.author_id,
      jsonb_build_object(
        'is_deleted', COALESCE(comment.is_deleted, false)
      )
    INTO v_target_author_id, v_current_content_state
    FROM public.community_comments AS comment
    WHERE comment.id = v_target_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'report target not found'
        USING ERRCODE = 'P0002';
    END IF;

    v_contained_content_state := jsonb_build_object('is_deleted', true);
  END IF;

  -- A completed call is replayed only from evidence written by this boundary.
  -- For a resolved report, the content postcondition is rechecked so tampering
  -- or a later restoration cannot yield a false successful replay.
  IF v_report.status = p_status THEN
    SELECT
      event.id,
      notice.id,
      COALESCE(event.metadata ->> 'content_action', 'none')
    INTO
      v_existing_event_id,
      v_existing_notice_id,
      v_existing_content_action
    FROM public.community_moderation_events AS event
    LEFT JOIN public.community_moderation_notices AS notice
      ON notice.event_id = event.id
    WHERE event.metadata ->> 'report_id' = p_report_id::text
      AND event.metadata ->> 'report_status' = p_status
      AND event.metadata ->> 'atomic_report_resolution_version' = '1'
    ORDER BY event.causal_sequence DESC
    LIMIT 1;

    IF FOUND
      AND (
        p_status <> 'resolved'
        OR v_current_content_state = v_contained_content_state
      ) THEN
      RETURN jsonb_build_object(
        'ok', true,
        'idempotent_replay', true,
        'event_id', v_existing_event_id,
        'notice_id', v_existing_notice_id,
        'report_id', p_report_id,
        'status', p_status,
        'target_type', v_target_type,
        'target_id', v_target_id,
        'content_action', v_existing_content_action,
        'target_contained',
          v_current_content_state = v_contained_content_state
      );
    END IF;
  END IF;

  IF p_status = 'resolved' THEN
    IF v_current_content_state = v_contained_content_state THEN
      -- Containment may already exist because another report or moderation
      -- action won the target-row lock first. Record this report decision
      -- without issuing a duplicate author notice.
      v_content_action := 'already_contained';
      v_event_action := 'review_report';
      v_event_before_state := jsonb_build_object(
        'report_id', p_report_id,
        'status', v_report.status,
        'content_state', v_current_content_state
      );
      v_event_after_state := jsonb_build_object(
        'report_id', p_report_id,
        'status', p_status,
        'content_state', v_current_content_state
      );
    ELSE
      v_content_action := 'hide';
      v_event_action := 'hide';
      v_event_before_state := v_current_content_state;
      v_event_after_state := v_contained_content_state;
      v_notice_id := gen_random_uuid();
    END IF;
  ELSIF p_status = 'dismissed' THEN
    -- Restore only a containment event created for this exact report. The
    -- prior state is taken from immutable evidence rather than guessed as
    -- `public`, which protects member-only posts and author-owned drafts.
    IF v_report.status = 'resolved' THEN
      SELECT
        event.id,
        NULLIF(event.metadata ->> 'report_id', '')::uuid,
        event.before_state,
        event.after_state
      INTO
        v_source_event_id,
        v_source_report_id,
        v_source_before_state,
        v_source_after_state
      FROM public.community_moderation_events AS event
      WHERE event.target_type = v_target_type
        AND event.target_id = v_target_id
        AND event.action = 'hide'
        AND event.metadata ->> 'atomic_report_resolution_version' = '1'
        AND event.before_state IS DISTINCT FROM event.after_state
      ORDER BY event.causal_sequence DESC
      LIMIT 1;

      IF FOUND THEN
        IF v_target_type = 'post' THEN
          SELECT EXISTS (
            SELECT 1
            FROM public.community_reports AS report
            WHERE report.post_id = v_target_id
              AND report.id <> p_report_id
              AND report.status = 'resolved'
          ) INTO v_other_resolved_exists;
        ELSE
          SELECT EXISTS (
            SELECT 1
            FROM public.community_reports AS report
            WHERE report.comment_id = v_target_id
              AND report.id <> p_report_id
              AND report.status = 'resolved'
          ) INTO v_other_resolved_exists;
        END IF;

        SELECT event.id
        INTO v_latest_content_event_id
        FROM public.community_moderation_events AS event
        WHERE event.target_type = v_target_type
          AND event.target_id = v_target_id
          AND event.action IN ('hide', 'restore', 'soft_delete')
        ORDER BY event.causal_sequence DESC
        LIMIT 1;

        IF NOT v_other_resolved_exists
          AND v_latest_content_event_id = v_source_event_id
          AND v_current_content_state = v_source_after_state THEN
          v_content_action := 'restore';
          v_event_action := 'restore';
          v_event_before_state := v_current_content_state;
          v_event_after_state := v_source_before_state;
          v_notice_id := gen_random_uuid();
        END IF;
      END IF;
    END IF;

    IF v_event_action = 'review_report' THEN
      v_content_action := CASE
        WHEN v_current_content_state = v_contained_content_state
          THEN 'retained_containment'
        ELSE 'none'
      END;
      v_event_before_state := jsonb_build_object(
        'report_id', p_report_id,
        'status', v_report.status,
        'content_state', v_current_content_state
      );
      v_event_after_state := jsonb_build_object(
        'report_id', p_report_id,
        'status', p_status,
        'content_state', v_current_content_state
      );
    END IF;
  ELSE
    v_event_before_state := jsonb_build_object(
      'report_id', p_report_id,
      'status', v_report.status,
      'content_state', v_current_content_state
    );
    v_event_after_state := jsonb_build_object(
      'report_id', p_report_id,
      'status', p_status,
      'content_state', v_current_content_state
    );
  END IF;

  -- Runtime write controls may stop ordinary community writes during an
  -- incident. A verified service/admin moderation transaction must still be
  -- able to contain unsafe content. Keep the bypass on only around this RPC's
  -- writes, then close it before returning to the caller's transaction.
  PERFORM set_config('app.community_safety_bypass', 'on', true);
  PERFORM set_config('hanbang.community_moderation_event_write', 'on', true);

  INSERT INTO public.community_moderation_events (
    id,
    target_type,
    target_id,
    target_author_id,
    action,
    actor_id,
    reason,
    before_state,
    after_state,
    metadata
  )
  VALUES (
    v_event_id,
    v_target_type,
    v_target_id,
    v_target_author_id,
    v_event_action,
    p_admin_id,
    btrim(p_reason),
    v_event_before_state,
    v_event_after_state,
    jsonb_build_object(
      'atomic_report_resolution_version', 1,
      'report_id', p_report_id,
      'reporter_id', v_report.reporter_id,
      'previous_report_status', v_report.status,
      'report_status', p_status,
      'content_action', v_content_action,
      'source_event_id',
        CASE
          WHEN v_content_action = 'restore' THEN v_source_event_id
          ELSE NULL
        END
    )
  );

  IF v_content_action IN ('hide', 'restore') THEN
    IF v_target_type = 'post' THEN
      UPDATE public.community_posts
      SET visibility = v_event_after_state ->> 'visibility',
          under_review =
            (v_event_after_state ->> 'under_review')::boolean,
          updated_at = now()
      WHERE id = v_target_id;
    ELSE
      UPDATE public.community_comments
      SET is_deleted =
            (v_event_after_state ->> 'is_deleted')::boolean,
          updated_at = now()
      WHERE id = v_target_id;
    END IF;
  END IF;

  UPDATE public.community_reports
  SET status = p_status
  WHERE id = p_report_id;

  IF v_notice_id IS NOT NULL THEN
    INSERT INTO public.community_moderation_notices (
      id,
      event_id,
      recipient_id,
      target_type,
      target_id,
      action,
      reason,
      appeal_available
    )
    VALUES (
      v_notice_id,
      v_event_id,
      v_target_author_id,
      v_target_type,
      v_target_id,
      v_event_action,
      btrim(p_reason),
      v_event_action = 'hide'
    );
  END IF;

  -- The first real hide event is the appealable aggregate containment action.
  -- If another confirmed report still requires containment, the appeal is
  -- upheld. When the last confirmed report is dismissed and the exact prior
  -- state is restored, that same appeal is overturned.
  IF p_status = 'dismissed' AND v_source_event_id IS NOT NULL THEN
    IF v_content_action = 'restore' THEN
      UPDATE public.community_moderation_appeals
      SET status = 'overturned',
          resolution_reason = btrim(p_reason),
          resolved_at = now()
      WHERE event_id = v_source_event_id
        AND status IN ('pending', 'reviewed', 'upheld');
    ELSIF v_source_report_id = p_report_id THEN
      UPDATE public.community_moderation_appeals
      SET status = 'upheld',
          resolution_reason = btrim(p_reason),
          resolved_at = now()
      WHERE event_id = v_source_event_id
        AND status IN ('pending', 'reviewed');
    END IF;
  END IF;

  PERFORM set_config('hanbang.community_moderation_event_write', 'off', true);
  PERFORM set_config('app.community_safety_bypass', 'off', true);

  RETURN jsonb_build_object(
    'ok', true,
    'event_id', v_event_id,
    'notice_id', v_notice_id,
    'report_id', p_report_id,
    'status', p_status,
    'target_type', v_target_type,
    'target_id', v_target_id,
    'content_action', v_content_action,
    'target_contained',
      CASE
        WHEN v_content_action = 'restore' THEN false
        ELSE v_current_content_state = v_contained_content_state
          OR v_content_action = 'hide'
      END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.community_review_report_atomic(
  uuid, text, text, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_review_report_atomic(
  uuid, text, text, uuid
) TO service_role;

-- ---------------------------------------------------------------------------
-- Version 3: command identity, author intent, and independent safety holds
-- ---------------------------------------------------------------------------

ALTER TABLE public.community_posts
  ADD COLUMN author_visibility text;
UPDATE public.community_posts
SET author_visibility = visibility
WHERE author_visibility IS NULL;
ALTER TABLE public.community_posts
  ALTER COLUMN author_visibility SET DEFAULT 'public',
  ALTER COLUMN author_visibility SET NOT NULL;

ALTER TABLE public.community_comments
  ADD COLUMN author_deleted_at timestamptz;
-- Historical deleted comments have no trustworthy way to distinguish an
-- author deletion from an old moderation projection. Preserve deletion rather
-- than risk resurrecting user-owned content; legacy moderation requires a
-- manual decision instead of an inferred restore.
UPDATE public.community_comments
SET author_deleted_at = COALESCE(updated_at, now())
WHERE is_deleted IS TRUE
  AND author_deleted_at IS NULL;

ALTER TABLE public.community_moderation_notices
  ADD COLUMN content_action text,
  ADD COLUMN target_contained boolean,
  ADD COLUMN source_event_id uuid;

CREATE TABLE public.community_moderation_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type text NOT NULL CHECK (target_type IN ('post', 'comment')),
  target_id uuid NOT NULL,
  target_author_id uuid NOT NULL,
  baseline_author_state jsonb NOT NULL,
  containment_event_id uuid
    REFERENCES public.community_moderation_events(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'released')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  released_at timestamptz,
  CONSTRAINT community_moderation_cases_release_shape CHECK (
    (status = 'active' AND released_at IS NULL)
    OR (status = 'released' AND released_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX community_moderation_cases_active_target_unique
  ON public.community_moderation_cases(target_type, target_id)
  WHERE status = 'active';

CREATE TABLE public.community_moderation_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL
    REFERENCES public.community_moderation_cases(id) ON DELETE RESTRICT,
  target_type text NOT NULL CHECK (target_type IN ('post', 'comment')),
  target_id uuid NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('direct', 'report')),
  source_id uuid NOT NULL,
  source_event_id uuid NOT NULL UNIQUE
    REFERENCES public.community_moderation_events(id) ON DELETE RESTRICT,
  requested_action text NOT NULL
    CHECK (requested_action IN ('hide', 'soft_delete', 'resolved')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  released_at timestamptz,
  released_by_event_id uuid UNIQUE
    REFERENCES public.community_moderation_events(id) ON DELETE RESTRICT,
  CONSTRAINT community_moderation_holds_release_shape CHECK (
    (released_at IS NULL AND released_by_event_id IS NULL)
    OR (released_at IS NOT NULL AND released_by_event_id IS NOT NULL)
  )
);

CREATE INDEX community_moderation_holds_active_target
  ON public.community_moderation_holds(target_type, target_id, created_at DESC)
  WHERE released_at IS NULL;
CREATE UNIQUE INDEX community_moderation_holds_active_report_unique
  ON public.community_moderation_holds(source_type, source_id)
  WHERE source_type = 'report' AND released_at IS NULL;

CREATE TABLE public.community_moderation_appeal_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appeal_id uuid NOT NULL
    REFERENCES public.community_moderation_appeals(id) ON DELETE RESTRICT,
  decision_event_id uuid NOT NULL
    REFERENCES public.community_moderation_events(id) ON DELETE RESTRICT,
  previous_status text NOT NULL
    CHECK (previous_status IN ('pending', 'reviewed', 'upheld', 'overturned')),
  status text NOT NULL
    CHECK (status IN ('upheld', 'overturned')),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 2000),
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (appeal_id, decision_event_id)
);

ALTER TABLE public.community_moderation_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_moderation_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_moderation_appeal_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE
  public.community_moderation_cases,
  public.community_moderation_holds,
  public.community_moderation_appeal_decisions
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE
  public.community_moderation_cases,
  public.community_moderation_holds,
  public.community_moderation_appeal_decisions
  TO service_role;

-- Appeal state changes must be coupled to an immutable decision row by the
-- UUID-keyed moderation RPCs. Remove the legacy direct-update capability.
REVOKE UPDATE (status, resolution_reason, resolved_at)
  ON TABLE public.community_moderation_appeals
  FROM service_role;

CREATE POLICY community_moderation_cases_service_select
  ON public.community_moderation_cases
  FOR SELECT TO service_role USING (true);
CREATE POLICY community_moderation_holds_service_select
  ON public.community_moderation_holds
  FOR SELECT TO service_role USING (true);
CREATE POLICY community_moderation_appeal_decisions_service_select
  ON public.community_moderation_appeal_decisions
  FOR SELECT TO service_role USING (true);

CREATE OR REPLACE FUNCTION public.community_guard_appeal_decision_append()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP <> 'INSERT'
    OR NOT public.community_request_is_service()
    OR COALESCE(
      current_setting('hanbang.community_appeal_decision_write', true),
      ''
    ) <> 'on' THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'COMMUNITY_APPEAL_DECISIONS_ARE_APPEND_ONLY';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.community_guard_appeal_decision_append()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_community_moderation_appeal_decisions_append_only
BEFORE INSERT OR UPDATE OR DELETE ON public.community_moderation_appeal_decisions
FOR EACH ROW EXECUTE FUNCTION public.community_guard_appeal_decision_append();

CREATE OR REPLACE FUNCTION public.community_guard_author_moderation_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_service boolean := public.community_request_is_service();
  v_overlay_write boolean :=
    v_service
    AND COALESCE(
      current_setting('hanbang.community_moderation_overlay_write', true),
      ''
    ) = 'on';
BEGIN
  IF TG_TABLE_NAME = 'community_posts' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.author_visibility := NEW.visibility;
      RETURN NEW;
    END IF;

    IF NEW.under_review IS DISTINCT FROM OLD.under_review
      AND NOT v_overlay_write THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'COMMUNITY_MODERATION_OVERLAY_WRITE_REQUIRED';
    END IF;

    IF NEW.visibility IS DISTINCT FROM OLD.visibility THEN
      IF v_overlay_write THEN
        IF NEW.visibility IS DISTINCT FROM NEW.author_visibility THEN
          RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'COMMUNITY_AUTHOR_VISIBILITY_MUST_BE_PRESERVED';
        END IF;
      ELSIF v_service THEN
        NEW.author_visibility := NEW.visibility;
      ELSE
        RAISE EXCEPTION USING
          ERRCODE = '42501',
          MESSAGE = 'COMMUNITY_AUTHOR_VISIBILITY_REQUIRES_SERVICE_BOUNDARY';
      END IF;
    ELSIF NEW.author_visibility IS DISTINCT FROM OLD.author_visibility THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'COMMUNITY_AUTHOR_VISIBILITY_REQUIRES_VISIBILITY_WRITE';
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.is_deleted IS TRUE AND NEW.author_deleted_at IS NULL THEN
      NEW.author_deleted_at := clock_timestamp();
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.author_deleted_at IS NOT NULL AND NEW.author_deleted_at IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'COMMUNITY_AUTHOR_DELETE_IS_IRREVERSIBLE_HERE';
  END IF;

  IF NEW.author_deleted_at IS DISTINCT FROM OLD.author_deleted_at
    AND NOT v_service THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'COMMUNITY_AUTHOR_DELETE_REQUIRES_SERVICE_BOUNDARY';
  END IF;

  IF NEW.is_deleted IS DISTINCT FROM OLD.is_deleted THEN
    IF v_overlay_write THEN
      IF NEW.is_deleted IS FALSE AND NEW.author_deleted_at IS NOT NULL THEN
        RAISE EXCEPTION USING
          ERRCODE = '42501',
          MESSAGE = 'COMMUNITY_AUTHOR_DELETED_COMMENT_CANNOT_BE_REPUBLISHED';
      END IF;
    ELSIF NEW.is_deleted IS TRUE THEN
      NEW.author_deleted_at := COALESCE(
        NEW.author_deleted_at,
        clock_timestamp()
      );
    ELSE
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'COMMUNITY_COMMENT_RESTORE_REQUIRES_MODERATION_OVERLAY';
    END IF;
  END IF;

  IF NEW.author_deleted_at IS DISTINCT FROM OLD.author_deleted_at
    AND NEW.author_deleted_at IS NOT NULL THEN
    NEW.is_deleted := true;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.community_guard_author_moderation_state()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_community_posts_author_moderation_state
  ON public.community_posts;
CREATE TRIGGER trg_community_posts_author_moderation_state
BEFORE INSERT OR UPDATE ON public.community_posts
FOR EACH ROW EXECUTE FUNCTION public.community_guard_author_moderation_state();

DROP TRIGGER IF EXISTS trg_community_comments_author_moderation_state
  ON public.community_comments;
CREATE TRIGGER trg_community_comments_author_moderation_state
BEFORE INSERT OR UPDATE ON public.community_comments
FOR EACH ROW EXECUTE FUNCTION public.community_guard_author_moderation_state();

CREATE OR REPLACE FUNCTION public.community_moderation_receipt(
  p_event_id uuid,
  p_idempotent_replay boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event public.community_moderation_events%ROWTYPE;
  v_notice_id uuid;
  v_current_contained boolean;
  v_causal_head_event_id uuid;
  v_original_content_action text;
  v_original_contained boolean;
  v_report_status text;
  v_current_report_status text;
  v_superseded boolean;
  v_current_author_state jsonb;
BEGIN
  SELECT event.*
  INTO v_event
  FROM public.community_moderation_events AS event
  WHERE event.id = p_event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'COMMUNITY_MODERATION_EVENT_NOT_FOUND';
  END IF;

  SELECT notice.id
  INTO v_notice_id
  FROM public.community_moderation_notices AS notice
  WHERE notice.event_id = p_event_id;

  SELECT EXISTS (
    SELECT 1
    FROM public.community_moderation_cases AS moderation_case
    WHERE moderation_case.target_type = v_event.target_type
      AND moderation_case.target_id = v_event.target_id
      AND moderation_case.status = 'active'
  ) INTO v_current_contained;

  SELECT event.id
  INTO v_causal_head_event_id
  FROM public.community_moderation_events AS event
  WHERE event.target_type = v_event.target_type
    AND event.target_id = v_event.target_id
    AND event.metadata ->> 'moderation_command_version' = '3'
  ORDER BY event.causal_sequence DESC
  LIMIT 1;

  IF v_event.target_type = 'post' THEN
    SELECT jsonb_build_object(
      'author_visibility', post.author_visibility,
      'visibility', post.visibility,
      'under_review', post.under_review
    )
    INTO v_current_author_state
    FROM public.community_posts AS post
    WHERE post.id = v_event.target_id;
  ELSE
    SELECT jsonb_build_object(
      'author_deleted_at', comment.author_deleted_at,
      'is_deleted', comment.is_deleted
    )
    INTO v_current_author_state
    FROM public.community_comments AS comment
    WHERE comment.id = v_event.target_id;
  END IF;

  v_original_content_action := COALESCE(
    v_event.metadata ->> 'content_action',
    'none'
  );
  v_original_contained := COALESCE(
    (v_event.metadata ->> 'target_contained_after')::boolean,
    false
  );
  v_report_status := v_event.metadata ->> 'report_status';

  IF NULLIF(v_event.metadata ->> 'report_id', '') IS NOT NULL THEN
    SELECT report.status
    INTO v_current_report_status
    FROM public.community_reports AS report
    WHERE report.id = (v_event.metadata ->> 'report_id')::uuid;
  END IF;

  v_superseded :=
    v_original_contained IS DISTINCT FROM v_current_contained
    OR (
      v_report_status IS NOT NULL
      AND v_current_report_status IS DISTINCT FROM v_report_status
    );

  RETURN jsonb_build_object(
    'ok', true,
    'receipt_version', 3,
    'idempotent_replay', p_idempotent_replay,
    'event_id', v_event.id,
    'notice_id', v_notice_id,
    'operation_key', v_event.operation_key,
    'target_type', v_event.target_type,
    'target_id', v_event.target_id,
    'report_id', NULLIF(v_event.metadata ->> 'report_id', '')::uuid,
    'status', v_report_status,
    'requested_action', v_event.metadata ->> 'requested_action',
    'action', v_event.action,
    'content_action', CASE
      WHEN v_superseded THEN 'superseded'
      ELSE v_original_content_action
    END,
    'target_contained', v_current_contained,
    'source_event_id',
      NULLIF(v_event.metadata ->> 'source_event_id', '')::uuid,
    'original_outcome', jsonb_build_object(
      'content_action', v_original_content_action,
      'target_contained', v_original_contained,
      'report_status', v_report_status
    ),
    'current_postcondition', jsonb_build_object(
      'target_contained', v_current_contained,
      'superseded', v_superseded,
      'causal_head_event_id', v_causal_head_event_id,
      'author_state', v_current_author_state
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.community_moderation_receipt(uuid, boolean)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.community_moderate_content(
  p_target_type text,
  p_target_id uuid,
  p_action text,
  p_reason text,
  p_admin_id uuid,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_target_author_id uuid;
  v_before_state jsonb;
  v_after_state jsonb;
  v_command jsonb;
  v_existing_event_id uuid;
  v_existing_command jsonb;
  v_event_id uuid := gen_random_uuid();
  v_notice_id uuid := gen_random_uuid();
  v_case public.community_moderation_cases%ROWTYPE;
  v_case_created boolean := false;
  v_source_hold public.community_moderation_holds%ROWTYPE;
  v_remaining_holds integer := 0;
  v_content_action text;
  v_target_contained_after boolean;
BEGIN
  IF NOT public.community_request_is_service() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'service role required';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'COMMUNITY_MODERATION_IDEMPOTENCY_REQUIRED';
  END IF;

  IF p_target_type NOT IN ('post', 'comment')
    OR p_action NOT IN ('hide', 'restore', 'soft_delete') THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'invalid moderation target or action';
  END IF;

  IF p_admin_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles AS profile
    WHERE profile.id = p_admin_id AND profile.is_admin IS TRUE
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'verified administrator required';
  END IF;

  p_reason := btrim(COALESCE(p_reason, ''));
  IF char_length(p_reason) NOT BETWEEN 3 AND 2000 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'moderation reason must contain 3 to 2000 characters';
  END IF;

  IF p_target_type = 'post' THEN
    SELECT
      post.author_id,
      jsonb_build_object(
        'author_visibility', post.author_visibility,
        'visibility', post.visibility,
        'under_review', post.under_review
      )
    INTO v_target_author_id, v_before_state
    FROM public.community_posts AS post
    WHERE post.id = p_target_id
    FOR UPDATE;
  ELSE
    SELECT
      comment.author_id,
      jsonb_build_object(
        'author_deleted_at', comment.author_deleted_at,
        'is_deleted', comment.is_deleted
      )
    INTO v_target_author_id, v_before_state
    FROM public.community_comments AS comment
    WHERE comment.id = p_target_id
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'moderation target not found';
  END IF;

  v_command := jsonb_build_object(
    'kind', 'direct_moderation',
    'version', 3,
    'target_type', p_target_type,
    'target_id', p_target_id,
    'requested_action', p_action,
    'reason', p_reason,
    'admin_id', p_admin_id
  );

  SELECT event.id, event.metadata -> 'command'
  INTO v_existing_event_id, v_existing_command
  FROM public.community_moderation_events AS event
  WHERE event.operation_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing_command IS DISTINCT FROM v_command THEN
      RAISE EXCEPTION USING
        ERRCODE = '23505',
        MESSAGE = 'COMMUNITY_MODERATION_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN public.community_moderation_receipt(v_existing_event_id, true);
  END IF;

  SELECT moderation_case.*
  INTO v_case
  FROM public.community_moderation_cases AS moderation_case
  WHERE moderation_case.target_type = p_target_type
    AND moderation_case.target_id = p_target_id
    AND moderation_case.status = 'active'
  FOR UPDATE;

  IF p_action IN ('hide', 'soft_delete') THEN
    IF NOT FOUND THEN
      IF p_target_type = 'post'
        AND COALESCE((v_before_state ->> 'under_review')::boolean, false) THEN
        RAISE EXCEPTION USING
          ERRCODE = '55000',
          MESSAGE = 'COMMUNITY_MODERATION_LEGACY_STATE_REQUIRES_REVIEW';
      END IF;
      IF p_target_type = 'comment'
        AND COALESCE((v_before_state ->> 'is_deleted')::boolean, false)
        AND NULLIF(v_before_state ->> 'author_deleted_at', '') IS NULL THEN
        RAISE EXCEPTION USING
          ERRCODE = '55000',
          MESSAGE = 'COMMUNITY_MODERATION_LEGACY_STATE_REQUIRES_REVIEW';
      END IF;

      INSERT INTO public.community_moderation_cases (
        target_type,
        target_id,
        target_author_id,
        baseline_author_state
      ) VALUES (
        p_target_type,
        p_target_id,
        v_target_author_id,
        v_before_state
      )
      RETURNING * INTO v_case;
      v_case_created := true;
      v_content_action := p_action;
    ELSE
      v_content_action := 'already_contained';
    END IF;
    v_target_contained_after := true;

    IF p_target_type = 'post' THEN
      v_after_state := jsonb_set(v_before_state, '{under_review}', 'true');
    ELSE
      v_after_state := jsonb_set(v_before_state, '{is_deleted}', 'true');
    END IF;
  ELSE
    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'COMMUNITY_MODERATION_DIRECT_HOLD_NOT_FOUND';
    END IF;

    SELECT hold.*
    INTO v_source_hold
    FROM public.community_moderation_holds AS hold
    JOIN public.community_moderation_events AS source_event
      ON source_event.id = hold.source_event_id
    WHERE hold.case_id = v_case.id
      AND hold.source_type = 'direct'
      AND hold.released_at IS NULL
    ORDER BY source_event.causal_sequence DESC
    LIMIT 1
    FOR UPDATE OF hold;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'COMMUNITY_MODERATION_DIRECT_HOLD_NOT_FOUND';
    END IF;

    SELECT count(*)::int
    INTO v_remaining_holds
    FROM public.community_moderation_holds AS hold
    WHERE hold.case_id = v_case.id
      AND hold.released_at IS NULL
      AND hold.id <> v_source_hold.id;

    v_target_contained_after := v_remaining_holds > 0;
    v_content_action := CASE
      WHEN v_target_contained_after THEN 'retained_containment'
      ELSE 'restore'
    END;

    IF p_target_type = 'post' THEN
      v_after_state := jsonb_set(
        v_before_state,
        '{under_review}',
        to_jsonb(v_target_contained_after)
      );
    ELSE
      v_after_state := jsonb_set(
        v_before_state,
        '{is_deleted}',
        to_jsonb(
          v_target_contained_after
          OR NULLIF(v_before_state ->> 'author_deleted_at', '') IS NOT NULL
        )
      );
    END IF;
  END IF;

  PERFORM set_config('hanbang.community_moderation_event_write', 'on', true);
  INSERT INTO public.community_moderation_events (
    id,
    operation_key,
    target_type,
    target_id,
    target_author_id,
    action,
    actor_id,
    reason,
    before_state,
    after_state,
    metadata
  ) VALUES (
    v_event_id,
    p_idempotency_key,
    p_target_type,
    p_target_id,
    v_target_author_id,
    p_action,
    p_admin_id,
    p_reason,
    v_before_state,
    v_after_state,
    jsonb_strip_nulls(jsonb_build_object(
      'moderation_command_version', 3,
      'command', v_command,
      'case_id', v_case.id,
      'source_type', 'direct',
      'source_id', CASE
        WHEN p_action IN ('hide', 'soft_delete') THEN p_idempotency_key
        ELSE v_source_hold.source_id
      END,
      'requested_action', p_action,
      'content_action', v_content_action,
      'target_contained_after', v_target_contained_after,
      'source_event_id', v_source_hold.source_event_id
    ))
  );
  PERFORM set_config('hanbang.community_moderation_event_write', 'off', true);

  IF p_action IN ('hide', 'soft_delete') THEN
    INSERT INTO public.community_moderation_holds (
      case_id,
      target_type,
      target_id,
      source_type,
      source_id,
      source_event_id,
      requested_action
    ) VALUES (
      v_case.id,
      p_target_type,
      p_target_id,
      'direct',
      p_idempotency_key,
      v_event_id,
      p_action
    );

    IF v_case_created THEN
      UPDATE public.community_moderation_cases
      SET containment_event_id = v_event_id
      WHERE id = v_case.id;
    END IF;
  ELSE
    UPDATE public.community_moderation_holds
    SET released_at = clock_timestamp(),
        released_by_event_id = v_event_id
    WHERE id = v_source_hold.id;

    IF NOT v_target_contained_after THEN
      UPDATE public.community_moderation_cases
      SET status = 'released', released_at = clock_timestamp()
      WHERE id = v_case.id;
    END IF;
  END IF;

  IF v_case_created OR (p_action = 'restore' AND NOT v_target_contained_after) THEN
    PERFORM set_config('app.community_safety_bypass', 'on', true);
    PERFORM set_config('hanbang.community_moderation_overlay_write', 'on', true);
    IF p_target_type = 'post' THEN
      UPDATE public.community_posts
      SET under_review = v_target_contained_after,
          visibility = author_visibility,
          updated_at = now()
      WHERE id = p_target_id;
    ELSE
      UPDATE public.community_comments
      SET is_deleted = (
            v_target_contained_after OR author_deleted_at IS NOT NULL
          ),
          updated_at = now()
      WHERE id = p_target_id;
    END IF;
    PERFORM set_config('hanbang.community_moderation_overlay_write', 'off', true);
    PERFORM set_config('app.community_safety_bypass', 'off', true);
  END IF;

  INSERT INTO public.community_moderation_notices (
    id,
    event_id,
    recipient_id,
    target_type,
    target_id,
    action,
    reason,
    appeal_available,
    content_action,
    target_contained,
    source_event_id
  ) VALUES (
    v_notice_id,
    v_event_id,
    v_target_author_id,
    p_target_type,
    p_target_id,
    p_action,
    p_reason,
    p_action IN ('hide', 'soft_delete'),
    v_content_action,
    v_target_contained_after,
    v_source_hold.source_event_id
  );

  IF p_action = 'restore' AND v_source_hold.source_event_id IS NOT NULL THEN
    PERFORM set_config('hanbang.community_appeal_decision_write', 'on', true);
    INSERT INTO public.community_moderation_appeal_decisions (
      appeal_id,
      decision_event_id,
      previous_status,
      status,
      reason,
      actor_id
    )
    SELECT
      appeal.id,
      v_event_id,
      appeal.status,
      'overturned',
      p_reason,
      p_admin_id
    FROM public.community_moderation_appeals AS appeal
    WHERE appeal.event_id = v_source_hold.source_event_id
      AND appeal.status IN ('pending', 'reviewed', 'upheld');
    PERFORM set_config('hanbang.community_appeal_decision_write', 'off', true);

    UPDATE public.community_moderation_appeals
    SET status = 'overturned',
        resolution_reason = p_reason,
        resolved_at = clock_timestamp()
    WHERE event_id = v_source_hold.source_event_id
      AND status IN ('pending', 'reviewed', 'upheld');
  END IF;

  RETURN public.community_moderation_receipt(v_event_id, false);
END;
$$;

REVOKE ALL ON FUNCTION public.community_moderate_content(
  text, uuid, text, text, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_moderate_content(
  text, uuid, text, text, uuid, uuid
) TO service_role;

CREATE OR REPLACE FUNCTION public.community_review_report_atomic(
  p_report_id uuid,
  p_status text,
  p_reason text,
  p_admin_id uuid,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_report public.community_reports%ROWTYPE;
  v_target_type text;
  v_target_id uuid;
  v_target_author_id uuid;
  v_before_state jsonb;
  v_after_state jsonb;
  v_command jsonb;
  v_existing_event_id uuid;
  v_existing_command jsonb;
  v_event_id uuid := gen_random_uuid();
  v_notice_id uuid;
  v_case public.community_moderation_cases%ROWTYPE;
  v_case_created boolean := false;
  v_report_hold public.community_moderation_holds%ROWTYPE;
  v_remaining_holds integer := 0;
  v_content_action text := 'none';
  v_target_contained_after boolean := false;
  v_event_action text := 'review_report';
BEGIN
  IF NOT public.community_request_is_service() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'service role required';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'COMMUNITY_REPORT_IDEMPOTENCY_REQUIRED';
  END IF;

  IF p_status NOT IN ('reviewed', 'resolved', 'dismissed') THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'invalid report review status';
  END IF;

  IF p_admin_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles AS profile
    WHERE profile.id = p_admin_id AND profile.is_admin IS TRUE
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'verified administrator required';
  END IF;

  p_reason := btrim(COALESCE(p_reason, ''));
  IF char_length(p_reason) NOT BETWEEN 3 AND 2000 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'report review reason must contain 3 to 2000 characters';
  END IF;

  SELECT report.*
  INTO v_report
  FROM public.community_reports AS report
  WHERE report.id = p_report_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'report not found';
  END IF;

  IF v_report.post_id IS NOT NULL THEN
    v_target_type := 'post';
    v_target_id := v_report.post_id;
    SELECT
      post.author_id,
      jsonb_build_object(
        'author_visibility', post.author_visibility,
        'visibility', post.visibility,
        'under_review', post.under_review
      )
    INTO v_target_author_id, v_before_state
    FROM public.community_posts AS post
    WHERE post.id = v_target_id
    FOR UPDATE;
  ELSE
    v_target_type := 'comment';
    v_target_id := v_report.comment_id;
    SELECT
      comment.author_id,
      jsonb_build_object(
        'author_deleted_at', comment.author_deleted_at,
        'is_deleted', comment.is_deleted
      )
    INTO v_target_author_id, v_before_state
    FROM public.community_comments AS comment
    WHERE comment.id = v_target_id
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'report target not found';
  END IF;

  v_command := jsonb_build_object(
    'kind', 'report_review',
    'version', 3,
    'report_id', p_report_id,
    'status', p_status,
    'reason', p_reason,
    'admin_id', p_admin_id
  );

  SELECT event.id, event.metadata -> 'command'
  INTO v_existing_event_id, v_existing_command
  FROM public.community_moderation_events AS event
  WHERE event.operation_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing_command IS DISTINCT FROM v_command THEN
      RAISE EXCEPTION USING
        ERRCODE = '23505',
        MESSAGE = 'COMMUNITY_MODERATION_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN public.community_moderation_receipt(v_existing_event_id, true);
  END IF;

  SELECT hold.*
  INTO v_report_hold
  FROM public.community_moderation_holds AS hold
  WHERE hold.source_type = 'report'
    AND hold.source_id = p_report_id
    AND hold.released_at IS NULL
  FOR UPDATE;

  IF p_status = 'reviewed' THEN
    IF v_report.status <> 'pending' THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'COMMUNITY_REPORT_TRANSITION_CONFLICT';
    END IF;
    IF FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'COMMUNITY_REPORT_HOLD_STATUS_CONFLICT';
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.community_moderation_cases AS moderation_case
      WHERE moderation_case.target_type = v_target_type
        AND moderation_case.target_id = v_target_id
        AND moderation_case.status = 'active'
    ) INTO v_target_contained_after;
    v_after_state := v_before_state;
  ELSIF p_status = 'resolved' THEN
    IF FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'COMMUNITY_REPORT_ALREADY_HAS_ACTIVE_HOLD';
    END IF;
    IF v_report.status = 'resolved' THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'COMMUNITY_REPORT_LEGACY_RESOLUTION_REQUIRES_REVIEW';
    END IF;
    IF v_report.status NOT IN ('pending', 'reviewed') THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'COMMUNITY_REPORT_TRANSITION_CONFLICT';
    END IF;

    SELECT moderation_case.*
    INTO v_case
    FROM public.community_moderation_cases AS moderation_case
    WHERE moderation_case.target_type = v_target_type
      AND moderation_case.target_id = v_target_id
      AND moderation_case.status = 'active'
    FOR UPDATE;

    IF NOT FOUND THEN
      IF v_target_type = 'post'
        AND COALESCE((v_before_state ->> 'under_review')::boolean, false) THEN
        RAISE EXCEPTION USING
          ERRCODE = '55000',
          MESSAGE = 'COMMUNITY_MODERATION_LEGACY_STATE_REQUIRES_REVIEW';
      END IF;
      IF v_target_type = 'comment'
        AND COALESCE((v_before_state ->> 'is_deleted')::boolean, false)
        AND NULLIF(v_before_state ->> 'author_deleted_at', '') IS NULL THEN
        RAISE EXCEPTION USING
          ERRCODE = '55000',
          MESSAGE = 'COMMUNITY_MODERATION_LEGACY_STATE_REQUIRES_REVIEW';
      END IF;

      INSERT INTO public.community_moderation_cases (
        target_type,
        target_id,
        target_author_id,
        baseline_author_state
      ) VALUES (
        v_target_type,
        v_target_id,
        v_target_author_id,
        v_before_state
      )
      RETURNING * INTO v_case;
      v_case_created := true;
      v_content_action := 'hide';
    ELSE
      v_content_action := 'already_contained';
    END IF;

    v_target_contained_after := true;
    v_event_action := 'hide';
    v_notice_id := gen_random_uuid();
    IF v_target_type = 'post' THEN
      v_after_state := jsonb_set(v_before_state, '{under_review}', 'true');
    ELSE
      v_after_state := jsonb_set(v_before_state, '{is_deleted}', 'true');
    END IF;
  ELSE
    IF v_report.status = 'resolved' THEN
      IF NOT FOUND THEN
        RAISE EXCEPTION USING
          ERRCODE = '55000',
          MESSAGE = 'COMMUNITY_REPORT_LEGACY_RESOLUTION_REQUIRES_REVIEW';
      END IF;

      SELECT moderation_case.*
      INTO v_case
      FROM public.community_moderation_cases AS moderation_case
      WHERE moderation_case.id = v_report_hold.case_id
        AND moderation_case.status = 'active'
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION USING
          ERRCODE = '55000',
          MESSAGE = 'COMMUNITY_REPORT_HOLD_CASE_CONFLICT';
      END IF;

      SELECT count(*)::int
      INTO v_remaining_holds
      FROM public.community_moderation_holds AS hold
      WHERE hold.case_id = v_case.id
        AND hold.released_at IS NULL
        AND hold.id <> v_report_hold.id;

      v_target_contained_after := v_remaining_holds > 0;
      v_content_action := CASE
        WHEN v_target_contained_after THEN 'retained_containment'
        ELSE 'restore'
      END;
      v_event_action := 'restore';
      v_notice_id := gen_random_uuid();
      IF v_target_type = 'post' THEN
        v_after_state := jsonb_set(
          v_before_state,
          '{under_review}',
          to_jsonb(v_target_contained_after)
        );
      ELSE
        v_after_state := jsonb_set(
          v_before_state,
          '{is_deleted}',
          to_jsonb(
            v_target_contained_after
            OR NULLIF(v_before_state ->> 'author_deleted_at', '') IS NOT NULL
          )
        );
      END IF;
    ELSIF v_report.status IN ('pending', 'reviewed') THEN
      IF FOUND THEN
        RAISE EXCEPTION USING
          ERRCODE = '55000',
          MESSAGE = 'COMMUNITY_REPORT_HOLD_STATUS_CONFLICT';
      END IF;
      SELECT EXISTS (
        SELECT 1
        FROM public.community_moderation_cases AS moderation_case
        WHERE moderation_case.target_type = v_target_type
          AND moderation_case.target_id = v_target_id
          AND moderation_case.status = 'active'
      ) INTO v_target_contained_after;
      v_after_state := v_before_state;
    ELSE
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'COMMUNITY_REPORT_TRANSITION_CONFLICT';
    END IF;
  END IF;

  PERFORM set_config('hanbang.community_moderation_event_write', 'on', true);
  INSERT INTO public.community_moderation_events (
    id,
    operation_key,
    target_type,
    target_id,
    target_author_id,
    action,
    actor_id,
    reason,
    before_state,
    after_state,
    metadata
  ) VALUES (
    v_event_id,
    p_idempotency_key,
    v_target_type,
    v_target_id,
    v_target_author_id,
    v_event_action,
    p_admin_id,
    p_reason,
    v_before_state,
    v_after_state,
    jsonb_strip_nulls(jsonb_build_object(
      'moderation_command_version', 3,
      'command', v_command,
      'case_id', v_case.id,
      'source_type', 'report',
      'source_id', p_report_id,
      'requested_action', p_status,
      'report_id', p_report_id,
      'reporter_id', v_report.reporter_id,
      'previous_report_status', v_report.status,
      'report_status', p_status,
      'content_action', v_content_action,
      'target_contained_after', v_target_contained_after,
      'source_event_id', v_report_hold.source_event_id
    ))
  );
  PERFORM set_config('hanbang.community_moderation_event_write', 'off', true);

  IF p_status = 'resolved' THEN
    INSERT INTO public.community_moderation_holds (
      case_id,
      target_type,
      target_id,
      source_type,
      source_id,
      source_event_id,
      requested_action
    ) VALUES (
      v_case.id,
      v_target_type,
      v_target_id,
      'report',
      p_report_id,
      v_event_id,
      'resolved'
    );

    IF v_case_created THEN
      UPDATE public.community_moderation_cases
      SET containment_event_id = v_event_id
      WHERE id = v_case.id;
    END IF;
  ELSIF p_status = 'dismissed' AND v_report.status = 'resolved' THEN
    UPDATE public.community_moderation_holds
    SET released_at = clock_timestamp(),
        released_by_event_id = v_event_id
    WHERE id = v_report_hold.id;

    IF NOT v_target_contained_after THEN
      UPDATE public.community_moderation_cases
      SET status = 'released', released_at = clock_timestamp()
      WHERE id = v_case.id;
    END IF;
  END IF;

  IF v_case_created
    OR (
      p_status = 'dismissed'
      AND v_report.status = 'resolved'
      AND NOT v_target_contained_after
    ) THEN
    PERFORM set_config('app.community_safety_bypass', 'on', true);
    PERFORM set_config('hanbang.community_moderation_overlay_write', 'on', true);
    IF v_target_type = 'post' THEN
      UPDATE public.community_posts
      SET under_review = v_target_contained_after,
          visibility = author_visibility,
          updated_at = now()
      WHERE id = v_target_id;
    ELSE
      UPDATE public.community_comments
      SET is_deleted = (
            v_target_contained_after OR author_deleted_at IS NOT NULL
          ),
          updated_at = now()
      WHERE id = v_target_id;
    END IF;
    PERFORM set_config('hanbang.community_moderation_overlay_write', 'off', true);
    PERFORM set_config('app.community_safety_bypass', 'off', true);
  END IF;

  UPDATE public.community_reports
  SET status = p_status
  WHERE id = p_report_id;

  IF v_notice_id IS NOT NULL THEN
    INSERT INTO public.community_moderation_notices (
      id,
      event_id,
      recipient_id,
      target_type,
      target_id,
      action,
      reason,
      appeal_available,
      content_action,
      target_contained,
      source_event_id
    ) VALUES (
      v_notice_id,
      v_event_id,
      v_target_author_id,
      v_target_type,
      v_target_id,
      v_event_action,
      p_reason,
      p_status = 'resolved',
      v_content_action,
      v_target_contained_after,
      v_report_hold.source_event_id
    );
  END IF;

  IF p_status = 'dismissed'
    AND v_report.status = 'resolved'
    AND v_report_hold.source_event_id IS NOT NULL THEN
    PERFORM set_config('hanbang.community_appeal_decision_write', 'on', true);
    INSERT INTO public.community_moderation_appeal_decisions (
      appeal_id,
      decision_event_id,
      previous_status,
      status,
      reason,
      actor_id
    )
    SELECT
      appeal.id,
      v_event_id,
      appeal.status,
      'overturned',
      p_reason,
      p_admin_id
    FROM public.community_moderation_appeals AS appeal
    WHERE appeal.event_id = v_report_hold.source_event_id
      AND appeal.status IN ('pending', 'reviewed', 'upheld');
    PERFORM set_config('hanbang.community_appeal_decision_write', 'off', true);

    UPDATE public.community_moderation_appeals
    SET status = 'overturned',
        resolution_reason = p_reason,
        resolved_at = clock_timestamp()
    WHERE event_id = v_report_hold.source_event_id
      AND status IN ('pending', 'reviewed', 'upheld');
  END IF;

  RETURN public.community_moderation_receipt(v_event_id, false);
END;
$$;

REVOKE ALL ON FUNCTION public.community_review_report_atomic(
  uuid, text, text, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_review_report_atomic(
  uuid, text, text, uuid, uuid
) TO service_role;

-- Legacy overloads cannot prove command identity. Keep them available to the
-- migration owner for historical inspection, but remove every runtime grant so
-- service traffic must use the UUID-keyed contracts above.
REVOKE ALL ON FUNCTION public.community_moderate_content(
  text, uuid, text, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.community_review_report_atomic(
  uuid, text, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;

-- Freeze the first verified HTTP-facing moderation result. The v3 workflow
-- above deliberately computes rich postconditions, but replay must never
-- recompute them from a later moderation/report state.
CREATE TABLE public.community_moderation_command_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL,
  operation text NOT NULL,
  idempotency_key uuid NOT NULL UNIQUE,
  request_payload jsonb NOT NULL,
  request_digest text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  response_payload jsonb,
  response_digest text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  CONSTRAINT community_moderation_command_receipts_operation_valid
    CHECK (operation IN ('moderate_content', 'review_report')),
  CONSTRAINT community_moderation_command_receipts_request_object
    CHECK (jsonb_typeof(request_payload) = 'object'),
  CONSTRAINT community_moderation_command_receipts_status_valid
    CHECK (status IN ('pending', 'completed')),
  CONSTRAINT community_moderation_command_receipts_completion_valid
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
  CONSTRAINT community_moderation_command_receipts_request_digest_valid
    CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT community_moderation_command_receipts_response_digest_valid
    CHECK (response_digest IS NULL OR response_digest ~ '^[0-9a-f]{64}$')
);

ALTER TABLE public.community_moderation_command_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.community_moderation_command_receipts
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.community_moderation_payload_digest(
  p_payload jsonb
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT encode(sha256(convert_to(p_payload::text, 'UTF8')), 'hex')
$$;

CREATE OR REPLACE FUNCTION public.community_claim_moderation_command(
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
  v_digest text;
  v_receipt public.community_moderation_command_receipts%ROWTYPE;
  v_id uuid;
BEGIN
  IF p_operation NOT IN ('moderate_content', 'review_report')
    OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'invalid moderation command payload';
  END IF;
  v_digest := public.community_moderation_payload_digest(p_payload);

  INSERT INTO public.community_moderation_command_receipts (
    actor_id,
    operation,
    idempotency_key,
    request_payload,
    request_digest
  ) VALUES (
    p_actor_id,
    p_operation,
    p_idempotency_key,
    p_payload,
    v_digest
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('claimed', true, 'command_id', v_id);
  END IF;

  SELECT receipt.*
  INTO v_receipt
  FROM public.community_moderation_command_receipts AS receipt
  WHERE receipt.idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'COMMUNITY_MODERATION_RECEIPT_UNAVAILABLE';
  END IF;
  IF v_receipt.actor_id IS DISTINCT FROM p_actor_id
    OR v_receipt.operation IS DISTINCT FROM p_operation
    OR v_receipt.request_payload IS DISTINCT FROM p_payload
    OR v_receipt.request_digest IS DISTINCT FROM v_digest THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'COMMUNITY_MODERATION_IDEMPOTENCY_CONFLICT';
  END IF;
  IF v_receipt.status <> 'completed'
    OR v_receipt.response_payload IS NULL
    OR v_receipt.response_digest IS NULL
    OR jsonb_typeof(v_receipt.response_payload) IS DISTINCT FROM 'object'
    OR v_receipt.response_payload ? 'idempotent_replay'
    OR v_receipt.response_payload ? 'replayed' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'COMMUNITY_MODERATION_RECEIPT_UNAVAILABLE';
  END IF;
  IF v_receipt.response_digest
    <> public.community_moderation_payload_digest(v_receipt.response_payload) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'COMMUNITY_MODERATION_RECEIPT_DIGEST_MISMATCH';
  END IF;

  RETURN jsonb_build_object(
    'claimed', false,
    'response_payload', v_receipt.response_payload
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.community_complete_moderation_command(
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
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'COMMUNITY_MODERATION_RECEIPT_INVALID';
  END IF;
  v_response := p_response_payload - 'idempotent_replay' - 'replayed';

  UPDATE public.community_moderation_command_receipts
  SET status = 'completed',
      response_payload = v_response,
      response_digest = public.community_moderation_payload_digest(v_response),
      completed_at = clock_timestamp()
  WHERE id = p_command_id
    AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'COMMUNITY_MODERATION_RECEIPT_UNAVAILABLE';
  END IF;
  RETURN v_response;
END;
$$;

ALTER FUNCTION public.community_moderate_content(
  text, uuid, text, text, uuid, uuid
) RENAME TO community_moderate_content_receipt_impl;
ALTER FUNCTION public.community_review_report_atomic(
  uuid, text, text, uuid, uuid
) RENAME TO community_review_report_atomic_receipt_impl;

CREATE OR REPLACE FUNCTION public.community_moderate_content(
  p_target_type text,
  p_target_id uuid,
  p_action text,
  p_reason text,
  p_admin_id uuid,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_claim jsonb;
  v_payload jsonb;
  v_result jsonb;
BEGIN
  IF NOT public.community_request_is_service() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'service role required';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'COMMUNITY_MODERATION_IDEMPOTENCY_REQUIRED';
  END IF;
  IF p_admin_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles AS profile
    WHERE profile.id = p_admin_id AND profile.is_admin IS TRUE
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'verified administrator required';
  END IF;
  p_reason := btrim(COALESCE(p_reason, ''));
  v_payload := jsonb_build_object(
    'target_type', p_target_type,
    'target_id', p_target_id,
    'action', p_action,
    'reason', p_reason
  );
  v_claim := public.community_claim_moderation_command(
    p_admin_id, 'moderate_content', p_idempotency_key, v_payload
  );
  IF NOT (v_claim ->> 'claimed')::boolean THEN
    RETURN v_claim -> 'response_payload';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.community_moderation_events
    WHERE operation_key = p_idempotency_key
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'COMMUNITY_MODERATION_RECEIPT_UNAVAILABLE';
  END IF;
  v_result := public.community_moderate_content_receipt_impl(
    p_target_type, p_target_id, p_action, p_reason, p_admin_id,
    p_idempotency_key
  );
  RETURN public.community_complete_moderation_command(
    (v_claim ->> 'command_id')::uuid,
    v_result
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.community_review_report_atomic(
  p_report_id uuid,
  p_status text,
  p_reason text,
  p_admin_id uuid,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_claim jsonb;
  v_payload jsonb;
  v_result jsonb;
BEGIN
  IF NOT public.community_request_is_service() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'service role required';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'COMMUNITY_REPORT_IDEMPOTENCY_REQUIRED';
  END IF;
  IF p_admin_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles AS profile
    WHERE profile.id = p_admin_id AND profile.is_admin IS TRUE
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'verified administrator required';
  END IF;
  p_reason := btrim(COALESCE(p_reason, ''));
  v_payload := jsonb_build_object(
    'report_id', p_report_id,
    'status', p_status,
    'reason', p_reason
  );
  v_claim := public.community_claim_moderation_command(
    p_admin_id, 'review_report', p_idempotency_key, v_payload
  );
  IF NOT (v_claim ->> 'claimed')::boolean THEN
    RETURN v_claim -> 'response_payload';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.community_moderation_events
    WHERE operation_key = p_idempotency_key
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'COMMUNITY_MODERATION_RECEIPT_UNAVAILABLE';
  END IF;
  v_result := public.community_review_report_atomic_receipt_impl(
    p_report_id, p_status, p_reason, p_admin_id, p_idempotency_key
  );
  RETURN public.community_complete_moderation_command(
    (v_claim ->> 'command_id')::uuid,
    v_result
  );
END;
$$;

REVOKE ALL ON FUNCTION public.community_moderation_payload_digest(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_claim_moderation_command(
  uuid, text, uuid, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_complete_moderation_command(uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_moderate_content_receipt_impl(
  text, uuid, text, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_review_report_atomic_receipt_impl(
  uuid, text, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.community_moderate_content(
  text, uuid, text, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_moderate_content(
  text, uuid, text, text, uuid, uuid
) TO service_role;
REVOKE ALL ON FUNCTION public.community_review_report_atomic(
  uuid, text, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_review_report_atomic(
  uuid, text, text, uuid, uuid
) TO service_role;
