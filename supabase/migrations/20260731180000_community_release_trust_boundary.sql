-- Community release trust boundary.
--
-- This is a forward-only, data-classifying migration. Do not "roll back" by
-- dropping content_origin or moderation rows: doing so destroys provenance and
-- audit evidence. Restore the pre-migration database backup for an emergency
-- rollback, or ship a reviewed compensating migration that preserves those rows.

-- ---------------------------------------------------------------------------
-- 1. Immutable content provenance
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type AS type
    JOIN pg_namespace AS namespace ON namespace.oid = type.typnamespace
    WHERE namespace.nspname = 'public'
      AND type.typname = 'community_content_origin'
  ) THEN
    CREATE TYPE public.community_content_origin AS ENUM (
      'member',
      'operator',
      'ai',
      'industry_professional',
      'legacy_unverified'
    );
  END IF;
END
$$;

ALTER TABLE public.community_posts
  ADD COLUMN IF NOT EXISTS content_origin public.community_content_origin;

ALTER TABLE public.community_comments
  ADD COLUMN IF NOT EXISTS content_origin public.community_content_origin;

-- Every row that predates this migration stays explicitly unverified. New rows
-- default to member, but the trigger below rejects client-supplied alternatives.
UPDATE public.community_posts
SET content_origin = 'legacy_unverified'
WHERE content_origin IS NULL;

UPDATE public.community_comments
SET content_origin = 'legacy_unverified'
WHERE content_origin IS NULL;

ALTER TABLE public.community_posts
  ALTER COLUMN content_origin SET DEFAULT 'member',
  ALTER COLUMN content_origin SET NOT NULL;

ALTER TABLE public.community_comments
  ALTER COLUMN content_origin SET DEFAULT 'member',
  ALTER COLUMN content_origin SET NOT NULL;

COMMENT ON COLUMN public.community_posts.content_origin IS
  'Immutable provenance: member/operator/ai/industry_professional/legacy_unverified.';
COMMENT ON COLUMN public.community_comments.content_origin IS
  'Immutable provenance: member/operator/ai/industry_professional/legacy_unverified.';

CREATE OR REPLACE FUNCTION public.community_request_is_service()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN COALESCE(current_setting('request.jwt.claim.role', true), '') <> ''
      THEN current_setting('request.jwt.claim.role', true) = 'service_role'
    ELSE current_user IN ('postgres', 'supabase_admin', 'service_role')
  END;
$$;

CREATE OR REPLACE FUNCTION public.community_guard_content_origin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := COALESCE(current_setting('request.jwt.claim.role', true), '');
  v_actor_id uuid := NULLIF(to_jsonb(NEW) ->> 'author_id', '')::uuid;
  v_marked_ai boolean := COALESCE((to_jsonb(NEW) ->> 'is_ai')::boolean, false);
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_role IN ('anon', 'authenticated') THEN
      IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM v_actor_id THEN
        RAISE EXCEPTION 'community author must match the authenticated user'
          USING ERRCODE = '42501';
      END IF;

      IF NEW.content_origin IS DISTINCT FROM 'member'::public.community_content_origin
        OR v_marked_ai THEN
        RAISE EXCEPTION 'clients cannot assign community content provenance'
          USING ERRCODE = '42501';
      END IF;
    ELSIF v_marked_ai THEN
      -- Compatibility for a server path that already carries an is_ai marker.
      NEW.content_origin := 'ai'::public.community_content_origin;
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.content_origin IS DISTINCT FROM OLD.content_origin
    AND (
      NOT public.community_request_is_service()
      OR COALESCE(
        current_setting('hanbang.community_origin_reclassification', true),
        ''
      ) <> 'on'
    ) THEN
    RAISE EXCEPTION 'community content provenance is immutable; use the audited reclassification RPC'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.community_request_is_service() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.community_guard_content_origin() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_community_posts_content_origin ON public.community_posts;
CREATE TRIGGER trg_community_posts_content_origin
BEFORE INSERT OR UPDATE OF content_origin ON public.community_posts
FOR EACH ROW
EXECUTE FUNCTION public.community_guard_content_origin();

DROP TRIGGER IF EXISTS trg_community_comments_content_origin ON public.community_comments;
CREATE TRIGGER trg_community_comments_content_origin
BEFORE INSERT OR UPDATE OF content_origin ON public.community_comments
FOR EACH ROW
EXECUTE FUNCTION public.community_guard_content_origin();

-- ---------------------------------------------------------------------------
-- 2. Append-only moderation ledger, notices, and appeals
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.community_moderation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_key uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  target_type text NOT NULL CHECK (target_type IN ('post', 'comment')),
  target_id uuid NOT NULL,
  target_author_id uuid NOT NULL,
  action text NOT NULL CHECK (
    action IN (
      'hide',
      'restore',
      'soft_delete',
      'reclassify_origin',
      'review_report'
    )
  ),
  actor_id uuid NOT NULL,
  actor_role text NOT NULL DEFAULT 'service_role',
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 2000),
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_community_moderation_events_target
  ON public.community_moderation_events(target_type, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_moderation_events_actor
  ON public.community_moderation_events(actor_id, created_at DESC);

ALTER TABLE public.community_moderation_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.community_moderation_events FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.community_moderation_events FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.community_moderation_events FROM service_role;
GRANT SELECT ON TABLE public.community_moderation_events TO service_role;

DROP POLICY IF EXISTS community_moderation_events_service_select
  ON public.community_moderation_events;
CREATE POLICY community_moderation_events_service_select
  ON public.community_moderation_events
  FOR SELECT TO service_role
  USING (true);

CREATE OR REPLACE FUNCTION public.community_guard_moderation_event_append()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'community moderation events are append-only'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.community_request_is_service()
    OR COALESCE(
      current_setting('hanbang.community_moderation_event_write', true),
      ''
    ) <> 'on' THEN
    RAISE EXCEPTION 'moderation events must be written by an atomic service RPC'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.community_guard_moderation_event_append() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_community_moderation_events_append_only
  ON public.community_moderation_events;
CREATE TRIGGER trg_community_moderation_events_append_only
BEFORE INSERT OR UPDATE OR DELETE ON public.community_moderation_events
FOR EACH ROW
EXECUTE FUNCTION public.community_guard_moderation_event_append();

CREATE TABLE IF NOT EXISTS public.community_moderation_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL UNIQUE
    REFERENCES public.community_moderation_events(id) ON DELETE RESTRICT,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('post', 'comment')),
  target_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('hide', 'restore', 'soft_delete')),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 2000),
  appeal_available boolean NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_community_moderation_notices_recipient
  ON public.community_moderation_notices(recipient_id, created_at DESC);

ALTER TABLE public.community_moderation_notices ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.community_moderation_notices FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.community_moderation_notices FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.community_moderation_notices FROM service_role;
GRANT SELECT, UPDATE(read_at)
  ON TABLE public.community_moderation_notices TO authenticated;
GRANT SELECT ON TABLE public.community_moderation_notices TO service_role;

DROP POLICY IF EXISTS community_moderation_notices_select_own
  ON public.community_moderation_notices;
CREATE POLICY community_moderation_notices_select_own
  ON public.community_moderation_notices
  FOR SELECT TO authenticated
  USING (recipient_id = auth.uid());

DROP POLICY IF EXISTS community_moderation_notices_mark_read
  ON public.community_moderation_notices;
CREATE POLICY community_moderation_notices_mark_read
  ON public.community_moderation_notices
  FOR UPDATE TO authenticated
  USING (recipient_id = auth.uid())
  WITH CHECK (recipient_id = auth.uid());

DROP POLICY IF EXISTS community_moderation_notices_service_select
  ON public.community_moderation_notices;
CREATE POLICY community_moderation_notices_service_select
  ON public.community_moderation_notices
  FOR SELECT TO service_role
  USING (true);

CREATE OR REPLACE FUNCTION public.community_guard_moderation_notice_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (to_jsonb(NEW) - 'read_at') IS DISTINCT FROM (to_jsonb(OLD) - 'read_at')
    OR (
      OLD.read_at IS NOT NULL
      AND NEW.read_at IS DISTINCT FROM OLD.read_at
    ) THEN
    RAISE EXCEPTION 'only the unread-to-read transition is allowed on moderation notices'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.community_guard_moderation_notice_update() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_community_moderation_notices_read_only
  ON public.community_moderation_notices;
CREATE TRIGGER trg_community_moderation_notices_read_only
BEFORE UPDATE ON public.community_moderation_notices
FOR EACH ROW
EXECUTE FUNCTION public.community_guard_moderation_notice_update();

CREATE TABLE IF NOT EXISTS public.community_moderation_appeals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL UNIQUE
    REFERENCES public.community_moderation_events(id) ON DELETE RESTRICT,
  appellant_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'reviewed', 'upheld', 'overturned')),
  resolution_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_community_moderation_appeals_appellant
  ON public.community_moderation_appeals(appellant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_moderation_appeals_status
  ON public.community_moderation_appeals(status, created_at);

ALTER TABLE public.community_moderation_appeals ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.community_moderation_appeals FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.community_moderation_appeals FROM authenticated;
GRANT SELECT, INSERT ON TABLE public.community_moderation_appeals TO authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.community_moderation_appeals FROM service_role;
GRANT SELECT, UPDATE(status, resolution_reason, resolved_at)
  ON TABLE public.community_moderation_appeals TO service_role;

DROP POLICY IF EXISTS community_moderation_appeals_select_own
  ON public.community_moderation_appeals;
CREATE POLICY community_moderation_appeals_select_own
  ON public.community_moderation_appeals
  FOR SELECT TO authenticated
  USING (appellant_id = auth.uid());

DROP POLICY IF EXISTS community_moderation_appeals_insert_own
  ON public.community_moderation_appeals;
CREATE POLICY community_moderation_appeals_insert_own
  ON public.community_moderation_appeals
  FOR INSERT TO authenticated
  WITH CHECK (
    appellant_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.community_moderation_notices AS notice
      WHERE notice.event_id = community_moderation_appeals.event_id
        AND notice.recipient_id = auth.uid()
        AND notice.appeal_available = true
    )
  );

DROP POLICY IF EXISTS community_moderation_appeals_service_all
  ON public.community_moderation_appeals;
CREATE POLICY community_moderation_appeals_service_all
  ON public.community_moderation_appeals
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.community_validate_moderation_appeal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.community_moderation_notices AS notice
      WHERE notice.event_id = NEW.event_id
        AND notice.recipient_id = NEW.appellant_id
        AND notice.appeal_available = true
    ) THEN
      RAISE EXCEPTION 'this moderation event is not appealable by this user'
        USING ERRCODE = '42501';
    END IF;

    IF NOT public.community_request_is_service()
      AND auth.uid() IS DISTINCT FROM NEW.appellant_id THEN
      RAISE EXCEPTION 'appeal appellant must match the authenticated user'
        USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
  END IF;

  IF NOT public.community_request_is_service() THEN
    RAISE EXCEPTION 'appeal decisions are service-managed'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.event_id IS DISTINCT FROM OLD.event_id
    OR NEW.appellant_id IS DISTINCT FROM OLD.appellant_id
    OR NEW.reason IS DISTINCT FROM OLD.reason
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'appeal identity and original reason are immutable'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.community_validate_moderation_appeal() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_community_moderation_appeals_validate
  ON public.community_moderation_appeals;
CREATE TRIGGER trg_community_moderation_appeals_validate
BEFORE INSERT OR UPDATE ON public.community_moderation_appeals
FOR EACH ROW
EXECUTE FUNCTION public.community_validate_moderation_appeal();

-- ---------------------------------------------------------------------------
-- 3. Suspended-account and agent-persona public activity fence
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.community_guard_public_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new_row jsonb := to_jsonb(NEW);
  v_old_row jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  v_actor_id uuid := NULLIF(v_new_row ->> TG_ARGV[0], '')::uuid;
  v_role text := COALESCE(current_setting('request.jwt.claim.role', true), '');
  v_is_service boolean := public.community_request_is_service();
  v_is_suspended boolean;
  v_has_profile boolean := false;
  v_is_agent boolean := false;
  v_new_public boolean := true;
  v_old_public boolean := true;
  v_is_containment_only boolean := false;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'community write actor is required'
      USING ERRCODE = '42501';
  END IF;

  IF TG_TABLE_NAME = 'community_posts' THEN
    v_new_public := COALESCE(v_new_row ->> 'visibility', 'public') <> 'draft';
    v_old_public := COALESCE(v_old_row ->> 'visibility', 'public') <> 'draft';
    v_is_containment_only :=
      TG_OP = 'UPDATE'
      AND NOT v_new_public
      AND v_old_public
      AND (v_new_row - ARRAY['visibility', 'updated_at', 'search_vector'])
        = (v_old_row - ARRAY['visibility', 'updated_at', 'search_vector']);
  ELSIF TG_TABLE_NAME IN ('community_comments', 'cohort_messages') THEN
    v_new_public := NOT COALESCE((v_new_row ->> 'is_deleted')::boolean, false);
    v_old_public := NOT COALESCE((v_old_row ->> 'is_deleted')::boolean, false);
    v_is_containment_only :=
      TG_OP = 'UPDATE'
      AND NOT v_new_public
      AND v_old_public
      AND (v_new_row - ARRAY['is_deleted', 'updated_at'])
        = (v_old_row - ARRAY['is_deleted', 'updated_at']);
  END IF;

  SELECT profile.is_suspended
  INTO v_is_suspended
  FROM public.community_profiles AS profile
  WHERE profile.user_id = v_actor_id;
  v_has_profile := FOUND;

  SELECT EXISTS (
    SELECT 1
    FROM public.community_agent_personas AS persona
    WHERE persona.backing_user_id = v_actor_id
  )
  INTO v_is_agent;

  IF TG_OP = 'INSERT' THEN
    IF v_role IN ('anon', 'authenticated')
      AND auth.uid() IS DISTINCT FROM v_actor_id THEN
      RAISE EXCEPTION 'community write actor must match the authenticated user'
        USING ERRCODE = '42501';
    END IF;

    -- A profile is lazily bootstrapped by the post/comment paths. Missing is
    -- therefore not equivalent to suspended for first actions such as a vote
    -- or bookmark; an explicit suspended row is always denied.
    IF v_has_profile AND COALESCE(v_is_suspended, true) THEN
      RAISE EXCEPTION 'community account is suspended'
        USING ERRCODE = '42501';
    END IF;

    IF v_is_agent AND v_new_public THEN
      RAISE EXCEPTION 'community agent backing accounts cannot create public activity'
        USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
  END IF;

  -- Administrative/service updates to authored content must remain possible so
  -- moderators can contain abuse and counters can be repaired. A service call
  -- still cannot republish a contained agent-persona row.
  IF v_is_service
    AND TG_TABLE_NAME IN ('community_posts', 'community_comments', 'cohort_messages') THEN
    IF v_is_agent AND NOT v_old_public AND v_new_public THEN
      RAISE EXCEPTION 'community agent backing accounts cannot be republished'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- Suspension never removes the user's right to delete or contain their own
  -- content. Physical DELETE is deliberately not covered by this trigger.
  IF v_is_containment_only THEN
    IF v_role IN ('anon', 'authenticated')
      AND auth.uid() IS DISTINCT FROM v_actor_id THEN
      RAISE EXCEPTION 'community write actor must match the authenticated user'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF v_role IN ('anon', 'authenticated')
    AND auth.uid() IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'community write actor must match the authenticated user'
      USING ERRCODE = '42501';
  END IF;

  IF v_has_profile AND COALESCE(v_is_suspended, true) THEN
    RAISE EXCEPTION 'community account is suspended'
      USING ERRCODE = '42501';
  END IF;

  IF v_is_agent AND v_new_public THEN
    RAISE EXCEPTION 'community agent backing accounts cannot create public activity'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.community_guard_public_activity() FROM PUBLIC;

-- Install the same fail-closed actor fence only on tables that actually exist.
-- Poll definitions/options are service-owned; poll votes carry the user actor.
DO $$
DECLARE
  v_spec text[];
  v_table regclass;
  v_trigger_name text;
BEGIN
  FOREACH v_spec SLICE 1 IN ARRAY ARRAY[
    ARRAY['community_posts', 'author_id'],
    ARRAY['community_comments', 'author_id'],
    ARRAY['community_votes', 'user_id'],
    ARRAY['community_poll_votes', 'user_id'],
    ARRAY['community_bookmarks', 'user_id'],
    ARRAY['cohort_messages', 'author_id'],
    ARRAY['cohort_contracts', 'user_id'],
    ARRAY['cohort_timeline_events', 'user_id']
  ]
  LOOP
    v_table := to_regclass(format('public.%I', v_spec[1]));
    IF v_table IS NULL THEN
      CONTINUE;
    END IF;

    v_trigger_name := format('trg_release_actor_guard_%s', v_spec[1]);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %s', v_trigger_name, v_table);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %s '
      || 'FOR EACH ROW EXECUTE FUNCTION public.community_guard_public_activity(%L)',
      v_trigger_name,
      v_table,
      v_spec[2]
    );
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Unified post/comment reports without brigading auto-hide
-- ---------------------------------------------------------------------------

-- A raw count of three report rows must never mutate visibility. Moderation is
-- now an explicit, audited RPC decision.
DROP TRIGGER IF EXISTS trg_report_auto_review ON public.community_reports;
DROP FUNCTION IF EXISTS public.community_report_auto_review();

-- Preserve the earliest report when historical duplicates exist so the unique
-- indexes can be installed deterministically.
WITH ranked_post_reports AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY reporter_id, post_id
      ORDER BY created_at, id
    ) AS duplicate_rank
  FROM public.community_reports
  WHERE post_id IS NOT NULL
)
DELETE FROM public.community_reports AS report
USING ranked_post_reports AS ranked
WHERE report.id = ranked.id
  AND ranked.duplicate_rank > 1;

WITH ranked_comment_reports AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY reporter_id, comment_id
      ORDER BY created_at, id
    ) AS duplicate_rank
  FROM public.community_reports
  WHERE comment_id IS NOT NULL
)
DELETE FROM public.community_reports AS report
USING ranked_comment_reports AS ranked
WHERE report.id = ranked.id
  AND ranked.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS community_reports_reporter_post_unique
  ON public.community_reports(reporter_id, post_id)
  WHERE post_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS community_reports_reporter_comment_unique
  ON public.community_reports(reporter_id, comment_id)
  WHERE comment_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.community_reports'::regclass
      AND conname = 'community_reports_exactly_one_target'
  ) THEN
    ALTER TABLE public.community_reports
      ADD CONSTRAINT community_reports_exactly_one_target
      CHECK (
        (post_id IS NOT NULL AND comment_id IS NULL)
        OR (post_id IS NULL AND comment_id IS NOT NULL)
      ) NOT VALID;
    ALTER TABLE public.community_reports
      VALIDATE CONSTRAINT community_reports_exactly_one_target;
  END IF;
END
$$;

-- Existing self-reports are retained as evidence but can no longer count as
-- actionable reports.
UPDATE public.community_reports AS report
SET status = 'dismissed',
    description = CASE
      WHEN report.description IS NULL OR btrim(report.description) = ''
        THEN '[release migration: self-report dismissed]'
      ELSE report.description || E'\n[release migration: self-report dismissed]'
    END
WHERE (
    report.post_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.community_posts AS post
      WHERE post.id = report.post_id
        AND post.author_id = report.reporter_id
    )
  )
  OR (
    report.comment_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.community_comments AS comment
      WHERE comment.id = report.comment_id
        AND comment.author_id = report.reporter_id
    )
  );

CREATE OR REPLACE FUNCTION public.community_validate_report()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_target_author_id uuid;
  v_role text := COALESCE(current_setting('request.jwt.claim.role', true), '');
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.reporter_id IS DISTINCT FROM OLD.reporter_id
      OR NEW.post_id IS DISTINCT FROM OLD.post_id
      OR NEW.comment_id IS DISTINCT FROM OLD.comment_id
      OR NEW.reason IS DISTINCT FROM OLD.reason
      OR NEW.description IS DISTINCT FROM OLD.description
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'report identity and submitted evidence are immutable'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF (NEW.post_id IS NULL) = (NEW.comment_id IS NULL) THEN
    RAISE EXCEPTION 'a report must target exactly one post or comment'
      USING ERRCODE = '22023';
  END IF;

  IF v_role IN ('anon', 'authenticated')
    AND auth.uid() IS DISTINCT FROM NEW.reporter_id THEN
    RAISE EXCEPTION 'reporter must match the authenticated user'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.community_agent_personas AS persona
    WHERE persona.backing_user_id = NEW.reporter_id
  ) THEN
    RAISE EXCEPTION 'community agent backing accounts cannot submit reports'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.post_id IS NOT NULL THEN
    SELECT post.author_id
    INTO v_target_author_id
    FROM public.community_posts AS post
    WHERE post.id = NEW.post_id;
  ELSE
    SELECT comment.author_id
    INTO v_target_author_id
    FROM public.community_comments AS comment
    WHERE comment.id = NEW.comment_id;
  END IF;

  IF v_target_author_id IS NULL THEN
    RAISE EXCEPTION 'report target does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF v_target_author_id = NEW.reporter_id THEN
    RAISE EXCEPTION 'users cannot report their own content'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.community_validate_report() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_community_reports_validate
  ON public.community_reports;
CREATE TRIGGER trg_community_reports_validate
BEFORE INSERT OR UPDATE ON public.community_reports
FOR EACH ROW
EXECUTE FUNCTION public.community_validate_report();

-- Authenticated clients submit through the RPC below. Existing server routes
-- that use service_role direct INSERT remain compatible and still hit the
-- integrity trigger.
REVOKE ALL PRIVILEGES ON TABLE public.community_reports FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.community_reports FROM authenticated;
GRANT SELECT ON TABLE public.community_reports TO authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.community_reports FROM service_role;
GRANT SELECT, INSERT ON TABLE public.community_reports TO service_role;

DROP POLICY IF EXISTS "cr_insert" ON public.community_reports;
DROP POLICY IF EXISTS community_reports_insert_own ON public.community_reports;

DROP POLICY IF EXISTS community_reports_select_own ON public.community_reports;
CREATE POLICY community_reports_select_own
  ON public.community_reports
  FOR SELECT TO authenticated
  USING (reporter_id = auth.uid());

CREATE OR REPLACE FUNCTION public.community_submit_report(
  p_target_type text,
  p_target_id uuid,
  p_reason text,
  p_description text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reporter_id uuid := auth.uid();
  v_report_id uuid;
BEGIN
  IF v_reporter_id IS NULL THEN
    RAISE EXCEPTION 'authentication required'
      USING ERRCODE = '42501';
  END IF;

  IF p_target_type NOT IN ('post', 'comment') THEN
    RAISE EXCEPTION 'invalid report target type'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.community_reports (
    reporter_id,
    post_id,
    comment_id,
    reason,
    description
  )
  VALUES (
    v_reporter_id,
    CASE WHEN p_target_type = 'post' THEN p_target_id ELSE NULL END,
    CASE WHEN p_target_type = 'comment' THEN p_target_id ELSE NULL END,
    p_reason,
    NULLIF(btrim(p_description), '')
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_report_id;

  IF v_report_id IS NULL THEN
    SELECT report.id
    INTO v_report_id
    FROM public.community_reports AS report
    WHERE report.reporter_id = v_reporter_id
      AND (
        (p_target_type = 'post' AND report.post_id = p_target_id)
        OR (p_target_type = 'comment' AND report.comment_id = p_target_id)
      );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'report_id', v_report_id,
    'target_type', p_target_type,
    'target_id', p_target_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.community_submit_report(text, uuid, text, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.community_submit_report(text, uuid, text, text)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Atomic, audited moderation and provenance reclassification
-- ---------------------------------------------------------------------------

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
  v_after_state jsonb;
  v_event_id uuid := gen_random_uuid();
  v_notice_id uuid := gen_random_uuid();
  v_existing_event_id uuid;
  v_existing_notice_id uuid;
  v_report_status text;
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

  IF p_reason IS NULL OR char_length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'moderation reason is required'
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

    IF p_action = 'restore' THEN
      v_after_state := jsonb_build_object(
        'visibility', 'public',
        'under_review', false
      );
    ELSE
      v_after_state := jsonb_build_object(
        'visibility', 'draft',
        'under_review', true
      );
    END IF;
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

    v_after_state := jsonb_build_object(
      'is_deleted',
      p_action <> 'restore'
    );
  END IF;

  -- The target row lock serializes concurrent retries. If this exact action has
  -- already produced the desired state, return its original receipt/notice.
  IF v_before_state = v_after_state THEN
    SELECT event.id, notice.id
    INTO v_existing_event_id, v_existing_notice_id
    FROM public.community_moderation_events AS event
    LEFT JOIN public.community_moderation_notices AS notice
      ON notice.event_id = event.id
    WHERE event.target_type = p_target_type
      AND event.target_id = p_target_id
      AND event.action = p_action
      AND event.after_state = v_after_state
    ORDER BY event.created_at DESC, event.id DESC
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'ok', true,
        'idempotent_replay', true,
        'event_id', v_existing_event_id,
        'notice_id', v_existing_notice_id,
        'target_type', p_target_type,
        'target_id', p_target_id,
        'action', p_action,
        'before_state', v_before_state,
        'after_state', v_after_state
      );
    END IF;
  END IF;

  v_report_status := CASE
    WHEN p_action = 'restore' THEN 'dismissed'
    ELSE 'resolved'
  END;
  v_appeal_available := p_action <> 'restore';

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
    jsonb_build_object('report_status', v_report_status)
  );

  IF p_target_type = 'post' THEN
    UPDATE public.community_posts
    SET visibility = v_after_state ->> 'visibility',
        under_review = (v_after_state ->> 'under_review')::boolean,
        updated_at = now()
    WHERE id = p_target_id;

    UPDATE public.community_reports
    SET status = v_report_status
    WHERE post_id = p_target_id
      AND (
        status IN ('pending', 'reviewed')
        OR (p_action = 'restore' AND status = 'resolved')
      );
  ELSE
    UPDATE public.community_comments
    SET is_deleted = (v_after_state ->> 'is_deleted')::boolean,
        updated_at = now()
    WHERE id = p_target_id;

    UPDATE public.community_reports
    SET status = v_report_status
    WHERE comment_id = p_target_id
      AND (
        status IN ('pending', 'reviewed')
        OR (p_action = 'restore' AND status = 'resolved')
      );
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

CREATE OR REPLACE FUNCTION public.community_review_report(
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
  v_event_id uuid := gen_random_uuid();
  v_existing_event_id uuid;
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

  IF p_reason IS NULL OR char_length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'report review reason is required'
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

  IF v_report.post_id IS NOT NULL THEN
    v_target_type := 'post';
    v_target_id := v_report.post_id;

    SELECT post.author_id
    INTO v_target_author_id
    FROM public.community_posts AS post
    WHERE post.id = v_target_id;
  ELSE
    v_target_type := 'comment';
    v_target_id := v_report.comment_id;

    SELECT comment.author_id
    INTO v_target_author_id
    FROM public.community_comments AS comment
    WHERE comment.id = v_target_id;
  END IF;

  IF v_target_author_id IS NULL THEN
    RAISE EXCEPTION 'report target not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_report.status = p_status THEN
    SELECT event.id
    INTO v_existing_event_id
    FROM public.community_moderation_events AS event
    WHERE event.action = 'review_report'
      AND event.metadata ->> 'report_id' = p_report_id::text
      AND event.after_state ->> 'status' = p_status
    ORDER BY event.created_at DESC, event.id DESC
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'ok', true,
        'idempotent_replay', true,
        'event_id', v_existing_event_id,
        'report_id', p_report_id,
        'status', p_status,
        'target_type', v_target_type,
        'target_id', v_target_id
      );
    END IF;
  END IF;

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
    'review_report',
    p_admin_id,
    btrim(p_reason),
    jsonb_build_object('report_id', p_report_id, 'status', v_report.status),
    jsonb_build_object('report_id', p_report_id, 'status', p_status),
    jsonb_build_object(
      'report_id', p_report_id,
      'reporter_id', v_report.reporter_id
    )
  );

  UPDATE public.community_reports
  SET status = p_status
  WHERE id = p_report_id;

  RETURN jsonb_build_object(
    'ok', true,
    'event_id', v_event_id,
    'report_id', p_report_id,
    'status', p_status,
    'target_type', v_target_type,
    'target_id', v_target_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.community_review_report(
  uuid, text, text, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_review_report(
  uuid, text, text, uuid
) TO service_role;

CREATE OR REPLACE FUNCTION public.community_reclassify_content_origin(
  p_target_type text,
  p_target_id uuid,
  p_new_origin text,
  p_reason text,
  p_admin_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new_origin public.community_content_origin;
  v_old_origin public.community_content_origin;
  v_target_author_id uuid;
  v_event_id uuid := gen_random_uuid();
BEGIN
  IF NOT public.community_request_is_service() THEN
    RAISE EXCEPTION 'service role required'
      USING ERRCODE = '42501';
  END IF;

  IF p_target_type NOT IN ('post', 'comment') THEN
    RAISE EXCEPTION 'invalid provenance target type'
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_new_origin := p_new_origin::public.community_content_origin;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'invalid community content origin'
        USING ERRCODE = '22023';
  END;

  IF p_admin_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.id = p_admin_id
      AND profile.is_admin = true
  ) THEN
    RAISE EXCEPTION 'verified administrator required'
      USING ERRCODE = '42501';
  END IF;

  IF p_reason IS NULL OR char_length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'reclassification reason is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_target_type = 'post' THEN
    SELECT post.content_origin, post.author_id
    INTO v_old_origin, v_target_author_id
    FROM public.community_posts AS post
    WHERE post.id = p_target_id
    FOR UPDATE;
  ELSE
    SELECT comment.content_origin, comment.author_id
    INTO v_old_origin, v_target_author_id
    FROM public.community_comments AS comment
    WHERE comment.id = p_target_id
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'provenance target not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_old_origin = v_new_origin THEN
    RETURN jsonb_build_object(
      'ok', true,
      'changed', false,
      'target_type', p_target_type,
      'target_id', p_target_id,
      'content_origin', v_old_origin
    );
  END IF;

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
    after_state
  )
  VALUES (
    v_event_id,
    p_target_type,
    p_target_id,
    v_target_author_id,
    'reclassify_origin',
    p_admin_id,
    btrim(p_reason),
    jsonb_build_object('content_origin', v_old_origin),
    jsonb_build_object('content_origin', v_new_origin)
  );

  PERFORM set_config('hanbang.community_origin_reclassification', 'on', true);

  IF p_target_type = 'post' THEN
    UPDATE public.community_posts
    SET content_origin = v_new_origin,
        updated_at = now()
    WHERE id = p_target_id;
  ELSE
    UPDATE public.community_comments
    SET content_origin = v_new_origin,
        updated_at = now()
    WHERE id = p_target_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'changed', true,
    'event_id', v_event_id,
    'target_type', p_target_type,
    'target_id', p_target_id,
    'content_origin', v_new_origin
  );
END;
$$;

REVOKE ALL ON FUNCTION public.community_reclassify_content_origin(
  text, uuid, text, text, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_reclassify_content_origin(
  text, uuid, text, text, uuid
) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Direct-read safety for content under explicit review
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS community_posts_release_review_visibility
  ON public.community_posts;
CREATE POLICY community_posts_release_review_visibility
  ON public.community_posts
  AS RESTRICTIVE
  FOR SELECT TO anon, authenticated
  USING (
    COALESCE(under_review, false) = false
    OR author_id = auth.uid()
  );

DROP POLICY IF EXISTS community_comments_release_review_visibility
  ON public.community_comments;
CREATE POLICY community_comments_release_review_visibility
  ON public.community_comments
  AS RESTRICTIVE
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.community_posts AS post
      WHERE post.id = community_comments.post_id
        AND (
          COALESCE(post.under_review, false) = false
          OR post.author_id = auth.uid()
        )
    )
  );

-- ---------------------------------------------------------------------------
-- Postconditions (run read-only on a hosted clone before release)
-- ---------------------------------------------------------------------------
--
-- 1) No null or unknown provenance:
-- SELECT count(*) FROM public.community_posts WHERE content_origin IS NULL;
-- SELECT count(*) FROM public.community_comments WHERE content_origin IS NULL;
--
-- 2) No undisclosed persona activity remains public:
-- SELECT count(*)
-- FROM public.community_posts p
-- JOIN public.community_agent_personas a ON a.backing_user_id = p.author_id
-- WHERE p.visibility <> 'draft';
--
-- 3) Report uniqueness and self-report integrity:
-- SELECT reporter_id, post_id, count(*) FROM public.community_reports
-- WHERE post_id IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1;
-- SELECT reporter_id, comment_id, count(*) FROM public.community_reports
-- WHERE comment_id IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1;
--
-- 4) The legacy brigading trigger is gone:
-- SELECT count(*) FROM pg_trigger
-- WHERE tgname = 'trg_report_auto_review' AND NOT tgisinternal;
--
-- 5) Append-only evidence exists for every notice:
-- SELECT count(*) FROM public.community_moderation_notices n
-- LEFT JOIN public.community_moderation_events e ON e.id = n.event_id
-- WHERE e.id IS NULL;
--
-- Emergency rollback:
--   * stop community writes;
--   * restore the verified pre-migration DB backup; or
--   * ship a compensating migration after exporting
--     community_moderation_events/notices/appeals and both content_origin
--     columns. Never drop the audit ledger in place.
