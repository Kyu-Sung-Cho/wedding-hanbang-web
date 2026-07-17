-- Bind sanitized community uploads to their durable consumer in the same DB
-- transaction that creates/updates that consumer. Signed-token replay cleanup
-- and completed-unattached deletion each have separate, exact checkpoints.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.community_upload_sessions
  ADD COLUMN IF NOT EXISTS content_sha256 text,
  ADD COLUMN IF NOT EXISTS sanitized_at timestamptz,
  ADD COLUMN IF NOT EXISTS token_cleanup_at timestamptz,
  ADD COLUMN IF NOT EXISTS attached_table text,
  ADD COLUMN IF NOT EXISTS attached_id uuid,
  ADD COLUMN IF NOT EXISTS attached_at timestamptz,
  ADD COLUMN IF NOT EXISTS final_deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS attachment_cleanup_token uuid,
  ADD COLUMN IF NOT EXISTS attachment_cleanup_started_at timestamptz;

-- Never invent a digest or sanitized timestamp for rows produced by a partial
-- 1080-only rollout. Stop before replacing the old constraint so an operator
-- can reconcile those exact objects from a verified backup/source of truth.
DO $completed_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.community_upload_sessions
     WHERE status = 'completed'
       AND (
         completed_at IS NULL
         OR sanitized_at IS NULL
         OR actual_size IS NULL
         OR actual_size <= 0
         OR actual_size > 6 * 1024 * 1024
         OR actual_mime_type IS DISTINCT FROM declared_mime_type
         OR content_sha256 IS NULL
         OR content_sha256 !~ '^[0-9a-f]{64}$'
         OR staging_deleted_at IS NULL
         OR final_deleted_at IS NOT NULL
       )
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_UPLOAD_COMPLETED_BACKFILL_REQUIRED'
      USING ERRCODE = '23514',
            HINT = 'Stop deployment; verify final bytes and backfill their digest/sanitized timestamp before retrying 1110.';
  END IF;
END;
$completed_preflight$;

-- 1110 is intentionally paired with 1080 before the compatible application is
-- exposed. Any row means a partial rollout received traffic; stop instead of
-- taking non-concurrent index locks or guessing how to migrate an active lease.
DO $quiescent_preflight$
BEGIN
  IF EXISTS (SELECT 1 FROM public.community_upload_sessions) THEN
    RAISE EXCEPTION 'COMMUNITY_UPLOAD_SESSIONS_NOT_QUIESCENT'
      USING ERRCODE = '55000',
            HINT = 'Stop deployment; preserve the rows and reconcile the partial 1080 rollout before retrying 1110.';
  END IF;
END;
$quiescent_preflight$;

ALTER TABLE public.community_upload_sessions
  DROP CONSTRAINT IF EXISTS community_upload_sessions_completion_state;

ALTER TABLE public.community_upload_sessions
  ADD CONSTRAINT community_upload_sessions_completion_state
    CHECK (
      status <> 'completed'
      OR (
        completed_at IS NOT NULL
        AND sanitized_at IS NOT NULL
        AND actual_size IS NOT NULL
        AND actual_size > 0
        AND actual_size <= 6 * 1024 * 1024
        AND actual_mime_type = declared_mime_type
        AND content_sha256 ~ '^[0-9a-f]{64}$'
        AND staging_deleted_at IS NOT NULL
        AND final_deleted_at IS NULL
      )
    ) NOT VALID,
  ADD CONSTRAINT community_upload_sessions_attachment_state
    CHECK (
      (
        attached_table IS NULL
        AND attached_id IS NULL
        AND attached_at IS NULL
      )
      OR (
        attached_table IN ('community_posts', 'cohort_messages')
        AND attached_id IS NOT NULL
        AND attached_at IS NOT NULL
        AND status = 'completed'
        AND final_deleted_at IS NULL
      )
    ) NOT VALID,
  ADD CONSTRAINT community_upload_sessions_cleanup_claim_state
    CHECK (
      (
        attachment_cleanup_token IS NULL
        AND attachment_cleanup_started_at IS NULL
      )
      OR (
        attachment_cleanup_token IS NOT NULL
        AND attachment_cleanup_started_at IS NOT NULL
        AND status IN ('completed', 'rejected', 'expired')
        AND attached_at IS NULL
        AND final_deleted_at IS NULL
      )
    ) NOT VALID;

ALTER TABLE public.community_upload_sessions
  VALIDATE CONSTRAINT community_upload_sessions_completion_state;
ALTER TABLE public.community_upload_sessions
  VALIDATE CONSTRAINT community_upload_sessions_attachment_state;
ALTER TABLE public.community_upload_sessions
  VALIDATE CONSTRAINT community_upload_sessions_cleanup_claim_state;

CREATE INDEX IF NOT EXISTS community_upload_sessions_token_cleanup_idx
  ON public.community_upload_sessions (expires_at)
  WHERE token_cleanup_at IS NULL;

CREATE INDEX IF NOT EXISTS community_upload_sessions_unattached_cleanup_idx
  ON public.community_upload_sessions (status, completed_at, updated_at)
  WHERE status IN ('completed', 'rejected', 'expired')
    AND attached_at IS NULL
    AND final_deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS community_upload_sessions_attachment_idx
  ON public.community_upload_sessions (attached_table, attached_id)
  WHERE attached_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.reconcile_community_upload_target(
  p_target_table text,
  p_target_id uuid,
  p_owner_id uuid,
  p_payload text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $reconcile_target$
DECLARE
  v_upload_id uuid;
  v_session public.community_upload_sessions%ROWTYPE;
  v_managed_pattern text;
  v_pattern text;
BEGIN
  IF p_target_table NOT IN ('community_posts', 'cohort_messages') THEN
    RAISE EXCEPTION 'UPLOAD_ATTACHMENT_TARGET_INVALID' USING ERRCODE = '22023';
  END IF;

  UPDATE public.community_upload_sessions
     SET attached_table = NULL,
         attached_id = NULL,
         attached_at = NULL,
         updated_at = clock_timestamp()
   WHERE attached_table = p_target_table
     AND attached_id = p_target_id;

  IF p_payload IS NULL OR p_payload = '' THEN
    RETURN;
  END IF;

  v_managed_pattern := 'community-images/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/'
    || '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|gif|webp)';
  IF EXISTS (
    SELECT 1
      FROM regexp_matches(p_payload, v_managed_pattern, 'gi') AS captures
     WHERE captures[1]::uuid <> p_owner_id
  ) THEN
    RAISE EXCEPTION 'UPLOAD_OWNER_MISMATCH' USING ERRCODE = '42501';
  END IF;

  v_pattern := 'community-images/' || p_owner_id::text
    || '/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(jpg|png|gif|webp)';

  FOR v_upload_id IN
    SELECT DISTINCT captures[1]::uuid
      FROM regexp_matches(p_payload, v_pattern, 'gi') AS captures
  LOOP
    SELECT *
      INTO v_session
      FROM public.community_upload_sessions
     WHERE id = v_upload_id
     FOR UPDATE;

    IF NOT FOUND
       OR v_session.user_id <> p_owner_id
       OR v_session.status <> 'completed'
       OR v_session.final_bucket <> 'community-images'
       OR v_session.final_deleted_at IS NOT NULL
       OR v_session.content_sha256 IS NULL THEN
      RAISE EXCEPTION 'UPLOAD_SESSION_NOT_ATTACHABLE' USING ERRCODE = '23514';
    END IF;

    IF v_session.attachment_cleanup_token IS NOT NULL THEN
      RAISE EXCEPTION 'UPLOAD_CLEANUP_IN_PROGRESS' USING ERRCODE = '55000';
    END IF;

    IF v_session.attached_at IS NOT NULL
       AND (
         v_session.attached_table <> p_target_table
         OR v_session.attached_id <> p_target_id
       ) THEN
      RAISE EXCEPTION 'UPLOAD_ALREADY_ATTACHED' USING ERRCODE = '23505';
    END IF;

    UPDATE public.community_upload_sessions
       SET attached_table = p_target_table,
           attached_id = p_target_id,
           attached_at = coalesce(attached_at, clock_timestamp()),
           updated_at = clock_timestamp()
     WHERE id = v_upload_id;
  END LOOP;
END;
$reconcile_target$;

CREATE OR REPLACE FUNCTION public.reconcile_community_post_uploads(
  p_post_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $reconcile_post$
DECLARE
  v_owner_id uuid;
  v_payload text;
  v_option_payload text;
BEGIN
  SELECT p.author_id, to_jsonb(p)::text
    INTO v_owner_id, v_payload
    FROM public.community_posts AS p
   WHERE p.id = p_post_id;

  IF NOT FOUND THEN
    UPDATE public.community_upload_sessions
       SET attached_table = NULL,
           attached_id = NULL,
           attached_at = NULL,
           updated_at = clock_timestamp()
     WHERE attached_table = 'community_posts'
       AND attached_id = p_post_id;
    RETURN;
  END IF;

  SELECT coalesce(string_agg(to_jsonb(o)::text, ' '), '')
    INTO v_option_payload
    FROM public.community_poll_options AS o
    JOIN public.community_polls AS poll ON poll.id = o.poll_id
   WHERE poll.post_id = p_post_id;

  PERFORM public.reconcile_community_upload_target(
    'community_posts',
    p_post_id,
    v_owner_id,
    concat_ws(' ', v_payload, v_option_payload)
  );
END;
$reconcile_post$;

CREATE OR REPLACE FUNCTION public.community_upload_post_attachment_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $post_trigger$
BEGIN
  PERFORM public.reconcile_community_post_uploads(
    CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END
  );
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$post_trigger$;

DROP TRIGGER IF EXISTS community_upload_post_attachment
  ON public.community_posts;
CREATE TRIGGER community_upload_post_attachment
AFTER INSERT OR UPDATE OF author_id, content, images, slides OR DELETE
ON public.community_posts
FOR EACH ROW EXECUTE FUNCTION public.community_upload_post_attachment_trigger();

CREATE OR REPLACE FUNCTION public.community_upload_poll_option_attachment_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $poll_option_trigger$
DECLARE
  v_post_id uuid;
BEGIN
  SELECT poll.post_id
    INTO v_post_id
    FROM public.community_polls AS poll
   WHERE poll.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.poll_id ELSE NEW.poll_id END;
  IF FOUND THEN
    PERFORM public.reconcile_community_post_uploads(v_post_id);
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$poll_option_trigger$;

DROP TRIGGER IF EXISTS community_upload_poll_option_attachment
  ON public.community_poll_options;
CREATE TRIGGER community_upload_poll_option_attachment
AFTER INSERT OR UPDATE OF image_url OR DELETE
ON public.community_poll_options
FOR EACH ROW EXECUTE FUNCTION public.community_upload_poll_option_attachment_trigger();

-- A cascading option DELETE cannot look its parent poll up after the parent row
-- is gone. Reconcile once more from OLD.post_id after poll DELETE/move so no
-- option-only asset remains attached forever.
CREATE OR REPLACE FUNCTION public.community_upload_poll_attachment_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $poll_trigger$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.reconcile_community_post_uploads(OLD.post_id);
    RETURN OLD;
  END IF;
  IF OLD.post_id IS DISTINCT FROM NEW.post_id THEN
    PERFORM public.reconcile_community_post_uploads(OLD.post_id);
    PERFORM public.reconcile_community_post_uploads(NEW.post_id);
  END IF;
  RETURN NEW;
END;
$poll_trigger$;

DROP TRIGGER IF EXISTS community_upload_poll_attachment
  ON public.community_polls;
CREATE TRIGGER community_upload_poll_attachment
AFTER UPDATE OF post_id OR DELETE
ON public.community_polls
FOR EACH ROW EXECUTE FUNCTION public.community_upload_poll_attachment_trigger();

CREATE OR REPLACE FUNCTION public.community_upload_cohort_attachment_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $cohort_trigger$
BEGIN
  IF TG_OP = 'DELETE' OR NEW.is_deleted THEN
    PERFORM public.reconcile_community_upload_target(
      'cohort_messages',
      CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END,
      CASE WHEN TG_OP = 'DELETE' THEN OLD.author_id ELSE NEW.author_id END,
      NULL
    );
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  PERFORM public.reconcile_community_upload_target(
    'cohort_messages', NEW.id, NEW.author_id, to_jsonb(NEW)::text
  );
  RETURN NEW;
END;
$cohort_trigger$;

DROP TRIGGER IF EXISTS community_upload_cohort_attachment
  ON public.cohort_messages;
CREATE TRIGGER community_upload_cohort_attachment
AFTER INSERT OR UPDATE OF author_id, content, images, is_deleted OR DELETE
ON public.cohort_messages
FOR EACH ROW EXECUTE FUNCTION public.community_upload_cohort_attachment_trigger();

CREATE OR REPLACE FUNCTION public.checkpoint_community_upload_token_cleanup(
  p_upload_id uuid,
  p_staging_path text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $token_checkpoint$
DECLARE
  v_session public.community_upload_sessions%ROWTYPE;
BEGIN
  SELECT *
    INTO v_session
    FROM public.community_upload_sessions
   WHERE id = p_upload_id
     AND staging_path = p_staging_path
   FOR UPDATE;
  IF NOT FOUND
     OR v_session.expires_at + interval '5 minutes' > clock_timestamp() THEN
    RETURN false;
  END IF;
  IF v_session.token_cleanup_at IS NOT NULL THEN
    RETURN true;
  END IF;

  UPDATE public.community_upload_sessions
     SET status = CASE WHEN status = 'completed' THEN status ELSE 'expired' END,
         claim_token = NULL,
         rejection_code = CASE
           WHEN status = 'completed' THEN rejection_code
           ELSE 'expired_cleanup'
         END,
         rejected_at = CASE
           WHEN status = 'completed' THEN rejected_at
           ELSE coalesce(rejected_at, clock_timestamp())
         END,
         staging_deleted_at = clock_timestamp(),
         token_cleanup_at = clock_timestamp(),
         updated_at = clock_timestamp()
   WHERE id = p_upload_id;
  RETURN true;
END;
$token_checkpoint$;

CREATE OR REPLACE FUNCTION public.claim_unattached_community_upload_sessions(
  p_claim_token uuid,
  p_completed_before timestamptz,
  p_stale_before timestamptz,
  p_limit integer DEFAULT 50
)
RETURNS SETOF public.community_upload_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $claim_unattached$
BEGIN
  IF p_claim_token IS NULL
     OR p_completed_before IS NULL
     OR p_stale_before IS NULL
     OR p_limit IS NULL
     OR p_limit < 1
     OR p_limit > 100 THEN
    RAISE EXCEPTION 'UPLOAD_CLEANUP_LIMIT_INVALID' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT s.id
      FROM public.community_upload_sessions AS s
     WHERE s.status IN ('completed', 'rejected', 'expired')
       AND s.attached_at IS NULL
       AND s.final_deleted_at IS NULL
       AND s.token_cleanup_at IS NOT NULL
       AND (
         s.status IN ('rejected', 'expired')
         OR (
           s.status = 'completed'
           AND (
             -- A newly detached historical object receives a fresh grace
             -- period. A stale existing lease already passed that gate and
             -- may be reclaimed after the separate 15-minute lease timeout.
             s.attachment_cleanup_token IS NOT NULL
             OR s.updated_at <= p_completed_before
           )
         )
       )
       AND (
         s.attachment_cleanup_token IS NULL
         OR s.attachment_cleanup_started_at <= LEAST(
           p_stale_before,
           clock_timestamp() - interval '15 minutes'
         )
       )
     ORDER BY coalesce(s.completed_at, s.updated_at), s.id
     FOR UPDATE SKIP LOCKED
     LIMIT p_limit
  )
  UPDATE public.community_upload_sessions AS s
     SET attachment_cleanup_token = p_claim_token,
         attachment_cleanup_started_at = clock_timestamp(),
         updated_at = clock_timestamp()
    FROM candidates
   WHERE s.id = candidates.id
  RETURNING s.*;
END;
$claim_unattached$;

CREATE OR REPLACE FUNCTION public.finalize_unattached_community_upload_cleanup(
  p_upload_id uuid,
  p_claim_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $finalize_unattached$
DECLARE
  v_updated_id uuid;
BEGIN
  UPDATE public.community_upload_sessions
     SET status = 'expired',
         rejection_code = 'unattached_cleanup',
         rejected_at = clock_timestamp(),
         final_deleted_at = clock_timestamp(),
         attachment_cleanup_token = NULL,
         attachment_cleanup_started_at = NULL,
         updated_at = clock_timestamp()
   WHERE id = p_upload_id
     AND status IN ('completed', 'rejected', 'expired')
     AND attached_at IS NULL
     AND final_deleted_at IS NULL
     AND attachment_cleanup_token = p_claim_token
  RETURNING id INTO v_updated_id;
  RETURN v_updated_id IS NOT NULL;
END;
$finalize_unattached$;

REVOKE ALL ON FUNCTION public.reconcile_community_upload_target(text, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_community_post_uploads(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.community_upload_post_attachment_trigger()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.community_upload_poll_option_attachment_trigger()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.community_upload_poll_attachment_trigger()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.community_upload_cohort_attachment_trigger()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.checkpoint_community_upload_token_cleanup(uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_unattached_community_upload_sessions(
  uuid, timestamptz, timestamptz, integer
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_unattached_community_upload_cleanup(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.checkpoint_community_upload_token_cleanup(uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_unattached_community_upload_sessions(
  uuid, timestamptz, timestamptz, integer
) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_unattached_community_upload_cleanup(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.checkpoint_community_upload_token_cleanup(uuid, text) IS
  'Checkpoints exact-path staging absence only after signed-token expiry plus grace.';
COMMENT ON FUNCTION public.claim_unattached_community_upload_sessions(
  uuid, timestamptz, timestamptz, integer
) IS 'Leases old completed-unattached or token-cleaned terminal public paths for race-free service cleanup.';
