BEGIN;

-- Amora memory engine v2: durable jobs, explicit user controls and semantic
-- supersession for chat-derived memories. This is an expand-only migration.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.decision_nodes
  ADD COLUMN IF NOT EXISTS memory_key text,
  ADD COLUMN IF NOT EXISTS source_message_id uuid,
  ADD COLUMN IF NOT EXISTS source_actor_role text,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_by uuid,
  ADD COLUMN IF NOT EXISTS user_confirmed_at timestamptz;

DO $block$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'decision_nodes_source_message_id_fkey'
      AND conrelid = 'public.decision_nodes'::regclass
  ) THEN
    ALTER TABLE public.decision_nodes
      ADD CONSTRAINT decision_nodes_source_message_id_fkey
      FOREIGN KEY (source_message_id)
      REFERENCES public.chat_messages(id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'decision_nodes_superseded_by_fkey'
      AND conrelid = 'public.decision_nodes'::regclass
  ) THEN
    ALTER TABLE public.decision_nodes
      ADD CONSTRAINT decision_nodes_superseded_by_fkey
      FOREIGN KEY (superseded_by)
      REFERENCES public.decision_nodes(id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;
END
$block$;

DO $block$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'decision_nodes_source_actor_role_check'
      AND conrelid = 'public.decision_nodes'::regclass
  ) THEN
    ALTER TABLE public.decision_nodes
      ADD CONSTRAINT decision_nodes_source_actor_role_check
      CHECK (source_actor_role IS NULL OR source_actor_role IN ('bride', 'groom'))
      NOT VALID;
  END IF;
END
$block$;

ALTER TABLE public.decision_nodes
  VALIDATE CONSTRAINT decision_nodes_source_message_id_fkey;
ALTER TABLE public.decision_nodes
  VALIDATE CONSTRAINT decision_nodes_superseded_by_fkey;
ALTER TABLE public.decision_nodes
  VALIDATE CONSTRAINT decision_nodes_source_actor_role_check;

-- Build replacements before removing any pre-production draft index. A failed
-- build therefore cannot leave a manually rehearsed database without its old
-- uniqueness/read-path protection (the whole migration still rolls back).
CREATE UNIQUE INDEX IF NOT EXISTS decision_nodes_active_memory_actor_key_unique
  ON public.decision_nodes(
    couple_id,
    visibility,
    COALESCE(source_actor_role, 'legacy'),
    memory_key
  )
  WHERE memory_key IS NOT NULL AND superseded_at IS NULL;
DROP INDEX IF EXISTS public.decision_nodes_active_memory_key_unique;

CREATE INDEX IF NOT EXISTS decision_nodes_active_memory_actor_lookup_idx
  ON public.decision_nodes(couple_id, visibility, source_actor_role, updated_at DESC)
  WHERE memory_key IS NOT NULL AND superseded_at IS NULL;
DROP INDEX IF EXISTS public.decision_nodes_active_memory_lookup_idx;

DO $block$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.chat_summaries
    WHERE to_message_id IS NOT NULL
    GROUP BY couple_id, visibility, to_message_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'AMORA_MEMORY_SUMMARY_CURSOR_DUPLICATES'
      USING ERRCODE = '23505',
            HINT = 'Resolve duplicate chat_summaries rows on an isolated clone before applying this migration.';
  END IF;
END
$block$;

CREATE UNIQUE INDEX IF NOT EXISTS chat_summaries_cursor_unique
  ON public.chat_summaries(couple_id, visibility, to_message_id)
  WHERE to_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.amora_memory_settings (
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  visibility text NOT NULL
    CHECK (visibility IN ('shared', 'bride_private', 'groom_private')),
  enabled boolean NOT NULL DEFAULT false,
  enabled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  enabled_at timestamptz,
  memory_reset_at timestamptz,
  legacy_purged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (couple_id, visibility),
  CHECK (
    (enabled = false AND enabled_at IS NULL)
    OR (enabled = true AND enabled_at IS NOT NULL)
  )
);

-- An earlier pre-production draft created this table before the one-time
-- legacy cleanup marker existed. Keep clone rehearsals and retries compatible;
-- the production release is still gated and has not applied this migration.
ALTER TABLE public.amora_memory_settings
  ADD COLUMN IF NOT EXISTS legacy_purged_at timestamptz;

ALTER TABLE public.amora_memory_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS amora_memory_settings_select_with_privacy
  ON public.amora_memory_settings;
CREATE POLICY amora_memory_settings_select_with_privacy
  ON public.amora_memory_settings
  FOR SELECT TO authenticated
  USING (public.can_access_couple_visibility(couple_id, visibility));

DROP POLICY IF EXISTS amora_memory_settings_service_all
  ON public.amora_memory_settings;
CREATE POLICY amora_memory_settings_service_all
  ON public.amora_memory_settings
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.amora_memory_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.amora_memory_settings TO authenticated;
GRANT ALL ON TABLE public.amora_memory_settings TO service_role;

DROP TRIGGER IF EXISTS set_amora_memory_settings_updated_at
  ON public.amora_memory_settings;
CREATE TRIGGER set_amora_memory_settings_updated_at
  BEFORE UPDATE ON public.amora_memory_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.amora_memory_consents (
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  visibility text NOT NULL
    CHECK (visibility IN ('shared', 'bride_private', 'groom_private')),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  consented_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (couple_id, visibility, user_id)
);

ALTER TABLE public.amora_memory_consents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS amora_memory_consents_select_with_privacy
  ON public.amora_memory_consents;
CREATE POLICY amora_memory_consents_select_with_privacy
  ON public.amora_memory_consents
  FOR SELECT TO authenticated
  USING (public.can_access_couple_visibility(couple_id, visibility));

DROP POLICY IF EXISTS amora_memory_consents_service_all
  ON public.amora_memory_consents;
CREATE POLICY amora_memory_consents_service_all
  ON public.amora_memory_consents
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.amora_memory_consents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.amora_memory_consents TO authenticated;
GRANT ALL ON TABLE public.amora_memory_consents TO service_role;

CREATE TABLE IF NOT EXISTS public.amora_memory_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  visibility text NOT NULL
    CHECK (visibility IN ('shared', 'bride_private', 'groom_private')),
  to_message_id uuid NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
  continuation_count integer NOT NULL DEFAULT 0 CHECK (continuation_count BETWEEN 0 AND 4),
  available_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (couple_id, visibility, to_message_id),
  CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z0-9_]{1,64}$')
);

ALTER TABLE public.amora_memory_jobs
  ADD COLUMN IF NOT EXISTS continuation_count integer NOT NULL DEFAULT 0
    CHECK (continuation_count BETWEEN 0 AND 4);

CREATE INDEX IF NOT EXISTS amora_memory_jobs_claim_idx
  ON public.amora_memory_jobs(status, available_at, created_at)
  WHERE status IN ('pending', 'processing');

ALTER TABLE public.amora_memory_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS amora_memory_jobs_service_all ON public.amora_memory_jobs;
CREATE POLICY amora_memory_jobs_service_all
  ON public.amora_memory_jobs
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.amora_memory_jobs FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.amora_memory_jobs TO service_role;

DROP TRIGGER IF EXISTS set_amora_memory_jobs_updated_at ON public.amora_memory_jobs;
CREATE TRIGGER set_amora_memory_jobs_updated_at
  BEFORE UPDATE ON public.amora_memory_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.reset_amora_memory_after_membership_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_reset_at timestamptz := now();
  v_visibilities text[] := ARRAY['shared']::text[];
  v_visibility text;
BEGIN
  IF OLD.bride_id IS DISTINCT FROM NEW.bride_id THEN
    v_visibilities := pg_catalog.array_append(v_visibilities, 'bride_private');
  END IF;
  IF OLD.groom_id IS DISTINCT FROM NEW.groom_id THEN
    v_visibilities := pg_catalog.array_append(v_visibilities, 'groom_private');
  END IF;

  FOREACH v_visibility IN ARRAY v_visibilities LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'hanbang:amora-memory-consent:' || NEW.id::text || ':' || v_visibility,
        0
      )
    );
  END LOOP;

  -- A couple roster defines the privacy audience. When that audience changes,
  -- derived memory from the previous roster must be gone before the new member
  -- can gain visibility through the existing couple row.
  DELETE FROM public.decision_nodes
  WHERE couple_id = NEW.id
    AND visibility = ANY(v_visibilities)
    AND (
      memory_key IS NOT NULL
      OR (
        jsonb_typeof(COALESCE(metadata, '{}'::jsonb)) = 'object'
        AND COALESCE(metadata, '{}'::jsonb) ? 'extracted_by'
      )
    );
  DELETE FROM public.chat_summaries
  WHERE couple_id = NEW.id AND visibility = ANY(v_visibilities);
  DELETE FROM public.amora_couple_profiles
  WHERE couple_id = NEW.id AND visibility = ANY(v_visibilities);
  DELETE FROM public.amora_memory_consents
  WHERE couple_id = NEW.id AND visibility = ANY(v_visibilities);
  UPDATE public.amora_memory_jobs
  SET status = 'cancelled', claimed_at = NULL, completed_at = v_reset_at, updated_at = v_reset_at
  WHERE couple_id = NEW.id
    AND visibility = ANY(v_visibilities)
    AND status IN ('pending', 'processing');

  -- The empty-couple cleanup trigger may already have deleted the parent in
  -- the same AFTER UPDATE trigger queue. Do not recreate child settings for a
  -- parent that no longer exists; ON DELETE CASCADE already completed cleanup.
  IF EXISTS (SELECT 1 FROM public.couples WHERE id = NEW.id) THEN
    INSERT INTO public.amora_memory_settings(
      couple_id, visibility, enabled, enabled_by, enabled_at, memory_reset_at,
      legacy_purged_at
    )
    SELECT NEW.id, visibility, false, NULL, NULL, v_reset_at, v_reset_at
    FROM pg_catalog.unnest(v_visibilities) AS visibility
    ON CONFLICT (couple_id, visibility) DO UPDATE SET
      enabled = false,
      enabled_by = NULL,
      enabled_at = NULL,
      memory_reset_at = v_reset_at,
      legacy_purged_at = v_reset_at,
      updated_at = v_reset_at;
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.reset_amora_memory_after_membership_change()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_reset_amora_memory_after_membership_change
  ON public.couples;
CREATE TRIGGER trg_reset_amora_memory_after_membership_change
  AFTER UPDATE OF bride_id, groom_id ON public.couples
  FOR EACH ROW
  WHEN (
    OLD.bride_id IS DISTINCT FROM NEW.bride_id
    OR OLD.groom_id IS DISTINCT FROM NEW.groom_id
  )
  EXECUTE FUNCTION public.reset_amora_memory_after_membership_change();

CREATE OR REPLACE FUNCTION public.has_current_amora_memory_consent(
  p_couple_id uuid,
  p_visibility text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '5s'
AS $function$
  WITH current_members AS (
    SELECT member.user_id
    FROM public.couples AS couple
    CROSS JOIN LATERAL (
      VALUES
        (couple.bride_id, 'bride_private'::text),
        (couple.groom_id, 'groom_private'::text)
    ) AS member(user_id, private_visibility)
    WHERE couple.id = p_couple_id
      AND member.user_id IS NOT NULL
      AND (p_visibility = 'shared' OR p_visibility = member.private_visibility)
  )
  SELECT p_visibility IN ('shared', 'bride_private', 'groom_private')
    AND EXISTS (SELECT 1 FROM current_members)
    AND (
      p_visibility <> 'shared'
      OR (SELECT count(*) FROM current_members) = 2
    )
    AND EXISTS (
      SELECT 1
      FROM public.amora_memory_settings AS setting
      WHERE setting.couple_id = p_couple_id
        AND setting.visibility = p_visibility
        AND setting.enabled = true
    )
    AND NOT EXISTS (
      SELECT 1
      FROM current_members AS member
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.amora_memory_consents AS consent
        WHERE consent.couple_id = p_couple_id
          AND consent.visibility = p_visibility
          AND consent.user_id = member.user_id
      )
    )
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_amora_memory_job(
  p_couple_id uuid,
  p_user_id uuid,
  p_visibility text,
  p_to_message_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_bride_id uuid;
  v_groom_id uuid;
  v_rows integer;
BEGIN
  SELECT bride_id, groom_id INTO v_bride_id, v_groom_id
  FROM public.couples
  WHERE id = p_couple_id
  FOR SHARE;
  IF p_visibility NOT IN ('shared', 'bride_private', 'groom_private')
     OR (p_user_id IS DISTINCT FROM v_bride_id AND p_user_id IS DISTINCT FROM v_groom_id)
     OR (p_visibility = 'bride_private' AND p_user_id IS DISTINCT FROM v_bride_id)
     OR (p_visibility = 'groom_private' AND p_user_id IS DISTINCT FROM v_groom_id)
     OR NOT EXISTS (
       SELECT 1 FROM public.chat_messages
       WHERE id = p_to_message_id
         AND couple_id = p_couple_id
         AND visibility = p_visibility
         AND sender_type = 'ai'
         AND role = 'assistant'
     ) THEN
    RAISE EXCEPTION 'AMORA_MEMORY_ENQUEUE_SCOPE_INVALID' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'hanbang:amora-memory-consent:' || p_couple_id::text || ':' || p_visibility,
      0
    )
  );

  IF NOT public.has_current_amora_memory_consent(p_couple_id, p_visibility) THEN
    RETURN 'disabled';
  END IF;

  -- Consent is prospective. Even a trusted worker cannot enqueue an assistant
  -- turn from before the latest activation/reset boundary.
  IF NOT EXISTS (
    SELECT 1
    FROM public.chat_messages AS message
    JOIN public.amora_memory_settings AS setting
      ON setting.couple_id = message.couple_id
     AND setting.visibility = message.visibility
    JOIN public.couples AS couple
      ON couple.id = message.couple_id
    WHERE message.id = p_to_message_id
      AND setting.couple_id = p_couple_id
      AND setting.visibility = p_visibility
      AND setting.enabled = true
      AND setting.memory_reset_at IS NOT NULL
      AND message.created_at > setting.memory_reset_at
  ) THEN
    RETURN 'before_boundary';
  END IF;

  INSERT INTO public.amora_memory_jobs(
    couple_id, user_id, visibility, to_message_id
  ) VALUES (
    p_couple_id, p_user_id, p_visibility, p_to_message_id
  )
  ON CONFLICT (couple_id, visibility, to_message_id) DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN CASE WHEN v_rows = 1 THEN 'queued' ELSE 'duplicate' END;
END
$function$;

DROP FUNCTION IF EXISTS public.claim_amora_memory_job(integer);

CREATE OR REPLACE FUNCTION public.claim_amora_memory_job(
  p_lease_seconds integer DEFAULT 300,
  p_job_id uuid DEFAULT NULL
)
RETURNS SETOF public.amora_memory_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
BEGIN
  IF p_lease_seconds < 60 OR p_lease_seconds > 1800 THEN
    RAISE EXCEPTION 'AMORA_MEMORY_JOB_CLAIM_INVALID' USING ERRCODE = '22023';
  END IF;

  -- Vercel may overlap cron invocations. Serialize the very short claim
  -- transaction so two workers cannot each observe an empty scope and claim
  -- different jobs for the same couple/visibility at the same instant.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hanbang:amora-memory-claim', 0)
  );

  -- A worker can die after claiming its final allowed attempt. Mark that
  -- expired lease terminal instead of leaving an unclaimable processing row.
  UPDATE public.amora_memory_jobs
  SET status = 'failed',
      claimed_at = NULL,
      completed_at = now(),
      last_error_code = 'LEASE_EXHAUSTED',
      updated_at = now()
  WHERE status = 'processing'
    AND (p_job_id IS NULL OR id = p_job_id)
    AND claimed_at < now() - make_interval(secs => p_lease_seconds)
    AND attempt_count >= 5;

  RETURN QUERY
  WITH candidate AS (
    SELECT job.id
    FROM public.amora_memory_jobs AS job
    WHERE job.available_at <= now()
      AND (p_job_id IS NULL OR job.id = p_job_id)
      AND (
        job.status = 'pending'
        OR (
          job.status = 'processing'
          AND job.claimed_at < now() - make_interval(secs => p_lease_seconds)
        )
      )
      AND job.attempt_count < 5
      AND NOT EXISTS (
        SELECT 1
        FROM public.amora_memory_jobs AS active
        WHERE active.couple_id = job.couple_id
          AND active.visibility = job.visibility
          AND active.status = 'processing'
          AND active.claimed_at >= now() - make_interval(secs => p_lease_seconds)
          AND active.id <> job.id
      )
    ORDER BY job.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE public.amora_memory_jobs AS job
  SET status = 'processing',
      claimed_at = now(),
      attempt_count = job.attempt_count + 1,
      last_error_code = NULL,
      updated_at = now()
  FROM candidate
  WHERE job.id = candidate.id
  RETURNING job.*;
END
$function$;

DROP FUNCTION IF EXISTS public.finish_amora_memory_job(uuid, boolean, text);

CREATE OR REPLACE FUNCTION public.finish_amora_memory_job(
  p_job_id uuid,
  p_success boolean,
  p_error_code text,
  p_attempt_count integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_rows integer;
BEGIN
  IF p_attempt_count NOT BETWEEN 1 AND 5
     OR (p_error_code IS NOT NULL AND p_error_code !~ '^[A-Z0-9_]{1,64}$') THEN
    RAISE EXCEPTION 'AMORA_MEMORY_JOB_ERROR_CODE_INVALID' USING ERRCODE = '22023';
  END IF;

  UPDATE public.amora_memory_jobs
  SET status = CASE
        WHEN p_success THEN 'completed'
        WHEN attempt_count >= 5 THEN 'failed'
        ELSE 'pending'
      END,
      available_at = CASE
        WHEN p_success OR attempt_count >= 5 THEN available_at
        ELSE now() + make_interval(secs => LEAST(900, 30 * attempt_count * attempt_count))
      END,
      claimed_at = NULL,
      completed_at = CASE WHEN p_success OR attempt_count >= 5 THEN now() ELSE NULL END,
      last_error_code = CASE WHEN p_success THEN NULL ELSE COALESCE(p_error_code, 'UNKNOWN') END,
      updated_at = now()
  WHERE id = p_job_id
    AND status = 'processing'
    AND attempt_count = p_attempt_count;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END
$function$;

CREATE OR REPLACE FUNCTION public.defer_amora_memory_job(
  p_job_id uuid,
  p_attempt_count integer,
  p_defer_seconds integer,
  p_reason_code text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_rows integer;
BEGIN
  IF p_attempt_count NOT BETWEEN 1 AND 5
     OR p_defer_seconds NOT BETWEEN 60 AND 86400
     OR p_reason_code IS NULL
     OR p_reason_code !~ '^[A-Z0-9_]{1,64}$' THEN
    RAISE EXCEPTION 'AMORA_MEMORY_JOB_DEFER_INVALID' USING ERRCODE = '22023';
  END IF;

  -- Budget/config deferral happens before a paid generation. Return the claim
  -- attempt so repeated budget pressure cannot exhaust a valid memory job.
  -- The attempt predicate also fences a stale worker after lease reclaim.
  UPDATE public.amora_memory_jobs
  SET status = 'pending',
      attempt_count = attempt_count - 1,
      available_at = now() + make_interval(secs => p_defer_seconds),
      claimed_at = NULL,
      completed_at = NULL,
      last_error_code = p_reason_code,
      updated_at = now()
  WHERE id = p_job_id
    AND status = 'processing'
    AND attempt_count = p_attempt_count;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END
$function$;

CREATE OR REPLACE FUNCTION public.upsert_amora_memory_node(
  p_couple_id uuid,
  p_visibility text,
  p_memory_key text,
  p_category text,
  p_title text,
  p_value text,
  p_reasoning text,
  p_confidence numeric,
  p_decision_type text,
  p_source_message_id uuid,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_existing public.decision_nodes%ROWTYPE;
  v_new_id uuid;
  v_source_actor_role text;
  v_tombstone_id uuid;
BEGIN
  IF p_visibility IS NULL
     OR p_memory_key IS NULL
     OR p_category IS NULL
     OR p_title IS NULL
     OR p_value IS NULL
     OR p_confidence IS NULL
     OR p_decision_type IS NULL
     OR p_source_message_id IS NULL
     OR p_visibility NOT IN ('shared', 'bride_private', 'groom_private')
     OR p_memory_key !~ '^[a-z][a-z0-9_]{1,31}:[a-z0-9_]{2,48}$'
     OR p_category !~ '^[a-z][a-z0-9_]{1,31}$'
     OR p_decision_type NOT IN ('considering', 'decided')
     OR char_length(p_title) NOT BETWEEN 1 AND 60
     OR char_length(p_value) NOT BETWEEN 1 AND 160
     OR char_length(COALESCE(p_reasoning, '')) > 240
     OR p_confidence < 0.80 OR p_confidence > 1.00
     OR jsonb_typeof(COALESCE(p_metadata, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'AMORA_MEMORY_UPSERT_INVALID' USING ERRCODE = '22023';
  END IF;

  -- Serialize every automatic write with consent withdrawal and scope clearing.
  -- Either this write commits first and a later clear removes it, or the clear
  -- commits first and this function fails closed before recreating memory.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'hanbang:amora-memory-consent:' || p_couple_id::text || ':' || p_visibility,
      0
    )
  );

  IF NOT public.has_current_amora_memory_consent(p_couple_id, p_visibility) THEN
    RAISE EXCEPTION 'AMORA_MEMORY_DISABLED' USING ERRCODE = '55000';
  END IF;

  -- The model may only cite a real user message in the same couple and privacy
  -- scope, created after the latest activation/reset. The application validates
  -- this too; the database is the final gate against accidental backfill.
  SELECT CASE
      WHEN message.sender_id = couple.bride_id AND message.sender_type = 'bride' THEN 'bride'
      WHEN message.sender_id = couple.groom_id AND message.sender_type = 'groom' THEN 'groom'
      ELSE NULL
    END INTO v_source_actor_role
    FROM public.chat_messages AS message
    JOIN public.amora_memory_settings AS setting
      ON setting.couple_id = message.couple_id
     AND setting.visibility = message.visibility
    JOIN public.couples AS couple
      ON couple.id = message.couple_id
    WHERE message.id = p_source_message_id
      AND message.couple_id = p_couple_id
      AND message.visibility = p_visibility
      AND message.role = 'user'
      AND (
        (message.sender_id = couple.bride_id AND message.sender_type = 'bride')
        OR (message.sender_id = couple.groom_id AND message.sender_type = 'groom')
      )
      AND (
        p_visibility = 'shared'
        OR (p_visibility = 'bride_private' AND message.sender_id = couple.bride_id)
        OR (p_visibility = 'groom_private' AND message.sender_id = couple.groom_id)
      )
      AND setting.enabled = true
      AND setting.memory_reset_at IS NOT NULL
      AND message.created_at > setting.memory_reset_at
    LIMIT 1;
  IF v_source_actor_role IS NULL THEN
    RAISE EXCEPTION 'AMORA_MEMORY_SOURCE_INVALID' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'hanbang:amora-memory:' || p_couple_id::text || ':' || p_visibility || ':' || v_source_actor_role || ':' || p_memory_key,
      0
    )
  );

  -- An individual user deletion is a durable tombstone. It prevents a queued
  -- compiler job from silently recreating the same semantic key. Clearing the
  -- whole scope removes tombstones as well and advances memory_reset_at.
  SELECT id INTO v_tombstone_id
  FROM public.decision_nodes
  WHERE couple_id = p_couple_id
    AND visibility = p_visibility
    AND source_actor_role = v_source_actor_role
    AND memory_key = p_memory_key
    AND COALESCE(metadata, '{}'::jsonb) ->> 'user_deleted' = 'true'
  ORDER BY updated_at DESC
  LIMIT 1;

  IF v_tombstone_id IS NOT NULL THEN
    RETURN v_tombstone_id;
  END IF;

  SELECT * INTO v_existing
  FROM public.decision_nodes
  WHERE couple_id = p_couple_id
    AND visibility = p_visibility
    AND source_actor_role = v_source_actor_role
    AND memory_key = p_memory_key
    AND superseded_at IS NULL
  LIMIT 1
  FOR UPDATE;

  -- A correction made in Settings is authoritative for the memory text.
  -- Shared corrections are deliberately not treated as mutual confirmation,
  -- so the metadata marker must protect them even without user_confirmed_at.
  IF FOUND AND (
    v_existing.user_confirmed_at IS NOT NULL
    OR COALESCE(v_existing.metadata, '{}'::jsonb) ->> 'user_corrected' = 'true'
  ) THEN
    RETURN v_existing.id;
  END IF;

  IF FOUND AND v_existing.chosen_value = jsonb_build_object('value', p_value) THEN
    UPDATE public.decision_nodes
    SET title = p_title,
        reasoning = p_reasoning,
        confidence = GREATEST(COALESCE(confidence, 0), p_confidence),
        source_message_id = p_source_message_id,
        source_ref_id = p_source_message_id,
        source_actor_role = v_source_actor_role,
        metadata = COALESCE(metadata, '{}'::jsonb) || p_metadata,
        updated_at = now()
    WHERE id = v_existing.id;
    RETURN v_existing.id;
  END IF;

  IF FOUND THEN
    UPDATE public.decision_nodes
    SET superseded_at = now(), updated_at = now()
    WHERE id = v_existing.id;
  END IF;

  INSERT INTO public.decision_nodes (
    couple_id, category, decision_type, title, chosen_value, reasoning,
    confidence, source, source_ref_id, source_message_id, memory_key,
    source_actor_role, metadata, visibility, decided_at
  ) VALUES (
    p_couple_id, p_category, p_decision_type, p_title,
    jsonb_build_object('value', p_value), p_reasoning, p_confidence,
    'chat', p_source_message_id, p_source_message_id, p_memory_key,
    v_source_actor_role, p_metadata, p_visibility,
    CASE WHEN p_decision_type = 'decided' THEN now() ELSE NULL END
  )
  RETURNING id INTO v_new_id;

  IF v_existing.id IS NOT NULL THEN
    UPDATE public.decision_nodes
    SET superseded_by = v_new_id
    WHERE id = v_existing.id;
  END IF;

  RETURN v_new_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.update_amora_memory_node(
  p_couple_id uuid,
  p_visibility text,
  p_memory_id uuid,
  p_user_id uuid,
  p_title text,
  p_value text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_bride_id uuid;
  v_editor_actor_role text;
  v_groom_id uuid;
  v_memory_key text;
  v_source_actor_role text;
  v_updated_id uuid;
BEGIN
  IF p_visibility NOT IN ('shared', 'bride_private', 'groom_private')
     OR char_length(p_title) NOT BETWEEN 1 AND 60
     OR char_length(p_value) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'AMORA_MEMORY_UPDATE_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT bride_id, groom_id INTO v_bride_id, v_groom_id
  FROM public.couples
  WHERE id = p_couple_id
  FOR SHARE;
  IF (p_user_id IS DISTINCT FROM v_bride_id AND p_user_id IS DISTINCT FROM v_groom_id)
     OR (p_visibility = 'bride_private' AND p_user_id IS DISTINCT FROM v_bride_id)
     OR (p_visibility = 'groom_private' AND p_user_id IS DISTINCT FROM v_groom_id) THEN
    RAISE EXCEPTION 'AMORA_MEMORY_UPDATE_SCOPE_INVALID' USING ERRCODE = '42501';
  END IF;
  v_editor_actor_role := CASE
    WHEN p_user_id = v_bride_id THEN 'bride'
    WHEN p_user_id = v_groom_id THEN 'groom'
    ELSE NULL
  END;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'hanbang:amora-memory-consent:' || p_couple_id::text || ':' || p_visibility,
      0
    )
  );

  SELECT COALESCE(memory_key, 'legacy:' || replace(id::text, '-', '')),
         source_actor_role
    INTO v_memory_key, v_source_actor_role
  FROM public.decision_nodes
  WHERE id = p_memory_id
    AND couple_id = p_couple_id
    AND visibility = p_visibility
    AND superseded_at IS NULL
    AND COALESCE(metadata, '{}'::jsonb) ->> 'user_deleted' IS DISTINCT FROM 'true';

  IF v_memory_key IS NULL THEN
    RAISE EXCEPTION 'AMORA_MEMORY_UPDATE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_source_actor_role IS NOT NULL
     AND v_source_actor_role IS DISTINCT FROM v_editor_actor_role THEN
    RAISE EXCEPTION 'AMORA_MEMORY_UPDATE_ACTOR_INVALID' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'hanbang:amora-memory:' || p_couple_id::text || ':' || p_visibility || ':' || COALESCE(v_source_actor_role, 'legacy') || ':' || v_memory_key,
      0
    )
  );

  UPDATE public.decision_nodes
  SET memory_key = COALESCE(memory_key, v_memory_key),
      title = p_title,
      chosen_value = jsonb_build_object('value', p_value),
      decision_type = CASE WHEN p_visibility = 'shared' THEN 'considering' ELSE decision_type END,
      decided_at = CASE WHEN p_visibility = 'shared' THEN NULL ELSE decided_at END,
      confidence = CASE WHEN p_visibility = 'shared' THEN 0.80 ELSE 1.00 END,
      user_confirmed_at = CASE WHEN p_visibility = 'shared' THEN NULL ELSE now() END,
      metadata = (COALESCE(metadata, '{}'::jsonb) - 'user_corrected_by') || jsonb_build_object(
        'user_corrected', true,
        'user_corrected_at', now(),
        'corrected_actor_role', v_editor_actor_role,
        'correction_confirmation', CASE
          WHEN p_visibility = 'shared' THEN 'single_member'
          ELSE 'self'
        END
      ),
      updated_at = now()
  WHERE couple_id = p_couple_id
    AND visibility = p_visibility
    AND (memory_key = v_memory_key OR (id = p_memory_id AND memory_key IS NULL))
    AND source_actor_role IS NOT DISTINCT FROM v_source_actor_role
    AND superseded_at IS NULL
    AND COALESCE(metadata, '{}'::jsonb) ->> 'user_deleted' IS DISTINCT FROM 'true'
  RETURNING id INTO v_updated_id;

  IF v_updated_id IS NULL THEN
    RAISE EXCEPTION 'AMORA_MEMORY_UPDATE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_updated_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.delete_amora_memory_node(
  p_couple_id uuid,
  p_visibility text,
  p_memory_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_bride_id uuid;
  v_groom_id uuid;
  v_memory_key text;
  v_rows integer;
  v_source_actor_role text;
BEGIN
  SELECT bride_id, groom_id INTO v_bride_id, v_groom_id
  FROM public.couples
  WHERE id = p_couple_id
  FOR SHARE;
  IF p_visibility NOT IN ('shared', 'bride_private', 'groom_private')
     OR (p_user_id IS DISTINCT FROM v_bride_id AND p_user_id IS DISTINCT FROM v_groom_id)
     OR (p_visibility = 'bride_private' AND p_user_id IS DISTINCT FROM v_bride_id)
     OR (p_visibility = 'groom_private' AND p_user_id IS DISTINCT FROM v_groom_id) THEN
    RAISE EXCEPTION 'AMORA_MEMORY_DELETE_SCOPE_INVALID' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'hanbang:amora-memory-consent:' || p_couple_id::text || ':' || p_visibility,
      0
    )
  );

  SELECT COALESCE(memory_key, 'legacy:' || replace(id::text, '-', '')),
         source_actor_role
    INTO v_memory_key, v_source_actor_role
  FROM public.decision_nodes
  WHERE id = p_memory_id
    AND couple_id = p_couple_id
    AND visibility = p_visibility
    AND superseded_at IS NULL;

  IF v_memory_key IS NULL THEN
    RAISE EXCEPTION 'AMORA_MEMORY_DELETE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'hanbang:amora-memory:' || p_couple_id::text || ':' || p_visibility || ':' || COALESCE(v_source_actor_role, 'legacy') || ':' || v_memory_key,
      0
    )
  );

  UPDATE public.decision_nodes
  SET memory_key = COALESCE(memory_key, v_memory_key),
      category = 'deleted_memory',
      decision_type = 'considering',
      title = '삭제된 기억',
      chosen_value = '{}'::jsonb,
      options_considered = '[]'::jsonb,
      reasoning = NULL,
      confidence = NULL,
      stage_tag = NULL,
      decided_at = NULL,
      source = 'chat',
      source_ref_id = NULL,
      source_message_id = NULL,
      superseded_at = now(),
      superseded_by = NULL,
      user_confirmed_at = NULL,
      metadata = jsonb_build_object(
        'user_deleted', true,
        'deleted_at', now()
      ),
      updated_at = now()
  WHERE couple_id = p_couple_id
    AND visibility = p_visibility
    AND (memory_key = v_memory_key OR (id = p_memory_id AND memory_key IS NULL))
    AND source_actor_role IS NOT DISTINCT FROM v_source_actor_role
    AND superseded_at IS NULL;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END
$function$;

CREATE OR REPLACE FUNCTION public.insert_amora_memory_summary(
  p_couple_id uuid,
  p_user_id uuid,
  p_visibility text,
  p_summary text,
  p_message_count integer,
  p_from_message_id uuid,
  p_to_message_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_rows integer;
BEGIN
  IF p_visibility NOT IN ('shared', 'bride_private', 'groom_private')
     OR p_summary IS NULL
     OR char_length(p_summary) NOT BETWEEN 1 AND 600
     OR p_message_count NOT BETWEEN 1 AND 40
     OR p_to_message_id IS NULL THEN
    RAISE EXCEPTION 'AMORA_MEMORY_SUMMARY_INVALID' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'hanbang:amora-memory-consent:' || p_couple_id::text || ':' || p_visibility,
      0
    )
  );

  IF NOT public.has_current_amora_memory_consent(p_couple_id, p_visibility) THEN
    RAISE EXCEPTION 'AMORA_MEMORY_DISABLED' USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.chat_messages AS message
    JOIN public.amora_memory_settings AS setting
      ON setting.couple_id = message.couple_id
     AND setting.visibility = message.visibility
    WHERE message.id = p_to_message_id
      AND message.couple_id = p_couple_id
      AND message.visibility = p_visibility
      AND setting.enabled = true
      AND setting.memory_reset_at IS NOT NULL
      AND message.created_at > setting.memory_reset_at
  ) OR (
    p_from_message_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM public.chat_messages AS message
      JOIN public.amora_memory_settings AS setting
        ON setting.couple_id = message.couple_id
       AND setting.visibility = message.visibility
      WHERE message.id = p_from_message_id
        AND message.couple_id = p_couple_id
        AND message.visibility = p_visibility
        AND setting.enabled = true
        AND setting.memory_reset_at IS NOT NULL
        AND message.created_at > setting.memory_reset_at
    )
  ) THEN
    RAISE EXCEPTION 'AMORA_MEMORY_SUMMARY_SCOPE_INVALID' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.chat_summaries(
    couple_id, user_id, summary_type, title, content, summary, message_count,
    from_message_id, to_message_id, importance, visibility
  ) VALUES (
    p_couple_id, p_user_id, 'info',
    CASE WHEN p_summary = '[AMORA_MEMORY_CURSOR_ONLY]' THEN '아모라 기억 커서' ELSE '아모라 대화 기억' END,
    p_summary, p_summary,
    p_message_count, p_from_message_id::text, p_to_message_id::text, 1, p_visibility
  )
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END
$function$;

CREATE OR REPLACE FUNCTION public.set_amora_memory_consent(
  p_couple_id uuid,
  p_visibility text,
  p_user_id uuid,
  p_consented boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_bride_id uuid;
  v_groom_id uuid;
  v_required integer;
  v_consented integer;
  v_enabled boolean;
  v_was_enabled boolean := false;
  v_memory_reset_at timestamptz;
  v_legacy_purged_at timestamptz;
BEGIN
  SELECT bride_id, groom_id INTO v_bride_id, v_groom_id
  FROM public.couples
  WHERE id = p_couple_id
  FOR SHARE;

  IF p_visibility NOT IN ('shared', 'bride_private', 'groom_private')
     OR (
       p_user_id IS DISTINCT FROM v_bride_id
       AND p_user_id IS DISTINCT FROM v_groom_id
     )
     OR (p_visibility = 'bride_private' AND p_user_id IS DISTINCT FROM v_bride_id)
     OR (p_visibility = 'groom_private' AND p_user_id IS DISTINCT FROM v_groom_id) THEN
    RAISE EXCEPTION 'AMORA_MEMORY_CONSENT_SCOPE_INVALID' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'hanbang:amora-memory-consent:' || p_couple_id::text || ':' || p_visibility,
      0
    )
  );

  SELECT enabled, memory_reset_at, legacy_purged_at
    INTO v_was_enabled, v_memory_reset_at, v_legacy_purged_at
  FROM public.amora_memory_settings
  WHERE couple_id = p_couple_id AND visibility = p_visibility;
  v_was_enabled := COALESCE(v_was_enabled, false);

  IF p_consented THEN
    INSERT INTO public.amora_memory_consents(couple_id, visibility, user_id)
    VALUES (p_couple_id, p_visibility, p_user_id)
    ON CONFLICT (couple_id, visibility, user_id)
    DO UPDATE SET consented_at = excluded.consented_at;
  ELSE
    DELETE FROM public.amora_memory_consents
    WHERE couple_id = p_couple_id
      AND visibility = p_visibility
      AND user_id = p_user_id;
  END IF;

  IF p_visibility = 'shared' THEN
    -- Shared memory is a two-person product. A solo account can use its
    -- role-private scope; shared processing starts only after a partner is
    -- linked and both people consent to the current roster.
    v_required := 2;
  ELSE
    v_required := 1;
  END IF;

  SELECT count(*)::integer INTO v_consented
  FROM public.amora_memory_consents
  WHERE couple_id = p_couple_id
    AND visibility = p_visibility
    AND (
      (p_visibility = 'shared' AND user_id IN (v_bride_id, v_groom_id))
      OR (p_visibility = 'bride_private' AND user_id = v_bride_id)
      OR (p_visibility = 'groom_private' AND user_id = v_groom_id)
    );

  v_enabled := v_required > 0 AND v_consented >= v_required;
  IF v_enabled AND v_legacy_purged_at IS NULL THEN
    -- First activation starts clean. Historical automatic summaries/profiles
    -- were created before explicit consent existed, so they cannot become
    -- newly usable merely because the user opts in today. A memory the user
    -- explicitly corrected is retained as an affirmative confirmation.
    DELETE FROM public.decision_nodes
    WHERE couple_id = p_couple_id
      AND visibility = p_visibility
      AND user_confirmed_at IS NULL
      AND COALESCE(metadata, '{}'::jsonb) ->> 'user_corrected' IS DISTINCT FROM 'true'
      AND (
        memory_key IS NOT NULL
        OR (
          jsonb_typeof(COALESCE(metadata, '{}'::jsonb)) = 'object'
          AND COALESCE(metadata, '{}'::jsonb) ? 'extracted_by'
        )
      );
    DELETE FROM public.chat_summaries
    WHERE couple_id = p_couple_id AND visibility = p_visibility;
    DELETE FROM public.amora_couple_profiles
    WHERE couple_id = p_couple_id AND visibility = p_visibility;
    v_legacy_purged_at := now();
  END IF;
  IF (v_enabled AND NOT v_was_enabled) OR NOT p_consented THEN
    -- Consent is prospective. Never compile conversations from before first
    -- activation or from a period in which this scope was switched off.
    v_memory_reset_at := now();
  END IF;
  INSERT INTO public.amora_memory_settings(
    couple_id, visibility, enabled, enabled_by, enabled_at, memory_reset_at,
    legacy_purged_at
  ) VALUES (
    p_couple_id, p_visibility, v_enabled,
    CASE WHEN v_enabled THEN p_user_id ELSE NULL END,
    CASE WHEN v_enabled THEN now() ELSE NULL END,
    v_memory_reset_at,
    v_legacy_purged_at
  )
  ON CONFLICT (couple_id, visibility) DO UPDATE SET
    enabled = excluded.enabled,
    enabled_by = excluded.enabled_by,
    enabled_at = excluded.enabled_at,
    memory_reset_at = excluded.memory_reset_at,
    legacy_purged_at = excluded.legacy_purged_at,
    updated_at = now();

  IF NOT v_enabled THEN
    UPDATE public.amora_memory_jobs
    SET status = 'cancelled', claimed_at = NULL, completed_at = now(), updated_at = now()
    WHERE couple_id = p_couple_id
      AND visibility = p_visibility
      AND status IN ('pending', 'processing');
  END IF;

  RETURN jsonb_build_object(
    'consented', p_consented,
    'consented_count', v_consented,
    'required_count', v_required,
    'enabled', v_enabled
  );
END
$function$;

DROP FUNCTION IF EXISTS public.clear_amora_memory_scope(uuid, text);

CREATE OR REPLACE FUNCTION public.clear_amora_memory_scope(
  p_couple_id uuid,
  p_visibility text,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_reset_at timestamptz := now();
  v_deleted_nodes integer;
  v_bride_id uuid;
  v_groom_id uuid;
BEGIN
  SELECT bride_id, groom_id INTO v_bride_id, v_groom_id
  FROM public.couples
  WHERE id = p_couple_id
  FOR SHARE;
  IF p_visibility NOT IN ('shared', 'bride_private', 'groom_private') THEN
    RAISE EXCEPTION 'AMORA_MEMORY_CLEAR_SCOPE_INVALID' USING ERRCODE = '22023';
  END IF;
  IF (p_user_id IS DISTINCT FROM v_bride_id AND p_user_id IS DISTINCT FROM v_groom_id)
     OR (p_visibility = 'bride_private' AND p_user_id IS DISTINCT FROM v_bride_id)
     OR (p_visibility = 'groom_private' AND p_user_id IS DISTINCT FROM v_groom_id) THEN
    RAISE EXCEPTION 'AMORA_MEMORY_CLEAR_SCOPE_INVALID' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'hanbang:amora-memory-consent:' || p_couple_id::text || ':' || p_visibility,
      0
    )
  );

  DELETE FROM public.decision_nodes
  WHERE couple_id = p_couple_id
    AND visibility = p_visibility
    AND (
      memory_key IS NOT NULL
      OR (
        jsonb_typeof(COALESCE(metadata, '{}'::jsonb)) = 'object'
        AND COALESCE(metadata, '{}'::jsonb) ? 'extracted_by'
      )
    );
  GET DIAGNOSTICS v_deleted_nodes = ROW_COUNT;

  DELETE FROM public.chat_summaries
  WHERE couple_id = p_couple_id AND visibility = p_visibility;
  DELETE FROM public.amora_couple_profiles
  WHERE couple_id = p_couple_id AND visibility = p_visibility;
  DELETE FROM public.amora_memory_consents
  WHERE couple_id = p_couple_id AND visibility = p_visibility;
  UPDATE public.amora_memory_jobs
  SET status = 'cancelled', claimed_at = NULL, completed_at = v_reset_at, updated_at = v_reset_at
  WHERE couple_id = p_couple_id
    AND visibility = p_visibility
    AND status IN ('pending', 'processing');

  INSERT INTO public.amora_memory_settings(
    couple_id, visibility, enabled, enabled_by, enabled_at, memory_reset_at,
    legacy_purged_at
  ) VALUES (
    p_couple_id, p_visibility, false, NULL, NULL, v_reset_at, v_reset_at
  )
  ON CONFLICT (couple_id, visibility) DO UPDATE SET
    enabled = false,
    enabled_by = NULL,
    enabled_at = NULL,
    memory_reset_at = v_reset_at,
    legacy_purged_at = v_reset_at,
    updated_at = v_reset_at;

  RETURN jsonb_build_object(
    'cleared', true,
    'deleted_memory_count', v_deleted_nodes,
    'memory_reset_at', v_reset_at
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.commit_amora_memory_job(
  p_job_id uuid,
  p_attempt_count integer,
  p_memories jsonb,
  p_summary text,
  p_message_count integer,
  p_from_message_id uuid,
  p_to_message_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_job public.amora_memory_jobs%ROWTYPE;
  v_couple_id uuid;
  v_visibility text;
  v_memory jsonb;
  v_finished boolean;
  v_target_created_at timestamptz;
  v_prefix_created_at timestamptz;
  v_persisted_summary text;
  v_from_created_at timestamptz;
  v_current_cursor_id uuid;
  v_expected_message_count integer;
  v_rows integer;
BEGIN
  IF p_job_id IS NULL
     OR p_attempt_count NOT BETWEEN 1 AND 5
     OR p_summary IS NULL
     OR p_to_message_id IS NULL
     OR jsonb_typeof(p_memories) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'AMORA_MEMORY_COMMIT_INVALID' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_memories) > 8 THEN
    RAISE EXCEPTION 'AMORA_MEMORY_COMMIT_INVALID' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_memories) = 0 THEN
    v_persisted_summary := '[AMORA_MEMORY_CURSOR_ONLY]';
  ELSE
    IF p_summary = '[AMORA_MEMORY_CURSOR_ONLY]' THEN
      RAISE EXCEPTION 'AMORA_MEMORY_COMMIT_INVALID' USING ERRCODE = '22023';
    END IF;
    v_persisted_summary := p_summary;
  END IF;

  SELECT couple_id, visibility
    INTO v_couple_id, v_visibility
  FROM public.amora_memory_jobs
  WHERE id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_MEMORY_JOB_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  -- Keep the same lock order as consent withdrawal: scope first, job row next.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'hanbang:amora-memory-consent:' || v_couple_id::text || ':' || v_visibility,
      0
    )
  );

  SELECT * INTO v_job
  FROM public.amora_memory_jobs
  WHERE id = p_job_id
    AND couple_id = v_couple_id
    AND visibility = v_visibility
    AND status = 'processing'
    AND attempt_count = p_attempt_count
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_MEMORY_JOB_LEASE_INVALID' USING ERRCODE = '55000';
  END IF;
  IF NOT public.has_current_amora_memory_consent(v_couple_id, v_visibility) THEN
    RAISE EXCEPTION 'AMORA_MEMORY_DISABLED' USING ERRCODE = '55000';
  END IF;

  SELECT message.created_at INTO v_target_created_at
  FROM public.chat_messages AS message
  WHERE message.id = v_job.to_message_id
    AND message.couple_id = v_couple_id
    AND message.visibility = v_visibility;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_MEMORY_TARGET_INVALID' USING ERRCODE = '42501';
  END IF;

  SELECT message.created_at INTO v_prefix_created_at
  FROM public.chat_messages AS message
  JOIN public.amora_memory_settings AS setting
    ON setting.couple_id = message.couple_id
   AND setting.visibility = message.visibility
  WHERE message.id = p_to_message_id
    AND message.couple_id = v_couple_id
    AND message.visibility = v_visibility
    AND setting.enabled = true
    AND setting.memory_reset_at IS NOT NULL
    AND message.created_at > setting.memory_reset_at
    AND COALESCE(message.metadata ->> 'target', '') <> 'partner'
    AND message.content !~ '^[[:space:]]*$';
  IF NOT FOUND
     OR (v_prefix_created_at, p_to_message_id) > (v_target_created_at, v_job.to_message_id) THEN
    RAISE EXCEPTION 'AMORA_MEMORY_PREFIX_INVALID' USING ERRCODE = '42501';
  END IF;

  SELECT message.id INTO v_current_cursor_id
  FROM public.chat_summaries AS summary
  JOIN public.chat_messages AS message
    ON message.id::text = summary.to_message_id
   AND message.couple_id = summary.couple_id
   AND message.visibility = summary.visibility
  JOIN public.amora_memory_settings AS setting
    ON setting.couple_id = message.couple_id
   AND setting.visibility = message.visibility
  WHERE summary.couple_id = v_couple_id
    AND summary.visibility = v_visibility
    AND setting.enabled = true
    AND setting.memory_reset_at IS NOT NULL
    AND message.created_at > setting.memory_reset_at
  ORDER BY summary.created_at DESC, summary.id DESC
  LIMIT 1;
  IF v_current_cursor_id IS DISTINCT FROM p_from_message_id THEN
    RAISE EXCEPTION 'AMORA_MEMORY_CURSOR_INVALID' USING ERRCODE = '55000';
  END IF;

  IF p_from_message_id IS NOT NULL THEN
    SELECT message.created_at INTO v_from_created_at
    FROM public.chat_messages AS message
    JOIN public.amora_memory_settings AS setting
      ON setting.couple_id = message.couple_id
     AND setting.visibility = message.visibility
    WHERE message.id = p_from_message_id
      AND message.couple_id = v_couple_id
      AND message.visibility = v_visibility
      AND setting.enabled = true
      AND setting.memory_reset_at IS NOT NULL
      AND message.created_at > setting.memory_reset_at;
    IF NOT FOUND
       OR (v_prefix_created_at, p_to_message_id) <= (v_from_created_at, p_from_message_id) THEN
      RAISE EXCEPTION 'AMORA_MEMORY_CURSOR_INVALID' USING ERRCODE = '55000';
    END IF;
  END IF;

  SELECT count(*)::integer INTO v_expected_message_count
  FROM public.chat_messages AS message
  JOIN public.amora_memory_settings AS setting
    ON setting.couple_id = message.couple_id
   AND setting.visibility = message.visibility
  WHERE message.couple_id = v_couple_id
    AND message.visibility = v_visibility
    AND setting.enabled = true
    AND setting.memory_reset_at IS NOT NULL
    AND message.created_at > setting.memory_reset_at
    AND COALESCE(message.metadata ->> 'target', '') <> 'partner'
    AND message.content !~ '^[[:space:]]*$'
    AND (message.created_at, message.id) <= (v_prefix_created_at, p_to_message_id)
    AND (
      p_from_message_id IS NULL
      OR (message.created_at, message.id) > (v_from_created_at, p_from_message_id)
    );
  IF v_expected_message_count IS DISTINCT FROM p_message_count THEN
    RAISE EXCEPTION 'AMORA_MEMORY_BATCH_COUNT_INVALID' USING ERRCODE = '22023';
  END IF;
  IF p_to_message_id <> v_job.to_message_id AND v_job.continuation_count >= 4 THEN
    RAISE EXCEPTION 'AMORA_MEMORY_CONTINUATION_LIMIT' USING ERRCODE = '54000';
  END IF;

  FOR v_memory IN
    SELECT element FROM jsonb_array_elements(p_memories) AS memories(element)
  LOOP
    PERFORM public.upsert_amora_memory_node(
      v_couple_id,
      v_visibility,
      v_memory ->> 'memory_key',
      v_memory ->> 'category',
      v_memory ->> 'title',
      v_memory ->> 'value',
      NULLIF(v_memory ->> 'reasoning', ''),
      (v_memory ->> 'confidence')::numeric,
      v_memory ->> 'decision_type',
      (v_memory ->> 'source_message_id')::uuid,
      COALESCE(v_memory -> 'metadata', '{}'::jsonb)
    );
  END LOOP;

  v_finished := public.insert_amora_memory_summary(
    v_couple_id,
    v_job.user_id,
    v_visibility,
    v_persisted_summary,
    p_message_count,
    p_from_message_id,
    p_to_message_id
  );
  IF NOT v_finished THEN
    RAISE EXCEPTION 'AMORA_MEMORY_SUMMARY_COMMIT_INVALID' USING ERRCODE = '55000';
  END IF;

  IF p_to_message_id = v_job.to_message_id THEN
    v_finished := public.finish_amora_memory_job(
      p_job_id,
      true,
      NULL,
      p_attempt_count
    );
    IF NOT v_finished THEN
      RAISE EXCEPTION 'AMORA_MEMORY_JOB_FINISH_INVALID' USING ERRCODE = '55000';
    END IF;
  ELSE
    -- The summary cursor and the same job's next lease become visible in one
    -- transaction. Reset only the per-chunk retry budget; keep the final target.
    UPDATE public.amora_memory_jobs
    SET status = 'pending',
        attempt_count = 0,
        continuation_count = continuation_count + 1,
        available_at = now(),
        claimed_at = NULL,
        completed_at = NULL,
        last_error_code = NULL,
        updated_at = now()
    WHERE id = p_job_id
      AND status = 'processing'
      AND attempt_count = p_attempt_count;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'AMORA_MEMORY_JOB_CONTINUATION_INVALID' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN true;
END
$function$;

REVOKE ALL ON FUNCTION public.claim_amora_memory_job(integer, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.has_current_amora_memory_consent(uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_amora_memory_job(uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_amora_memory_job(uuid, boolean, text, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.defer_amora_memory_job(uuid, integer, integer, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.upsert_amora_memory_node(
  uuid, text, text, text, text, text, text, numeric, text, uuid, jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_amora_memory_node(
  uuid, text, uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_amora_memory_node(uuid, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.insert_amora_memory_summary(
  uuid, uuid, text, text, integer, uuid, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_amora_memory_consent(uuid, text, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clear_amora_memory_scope(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commit_amora_memory_job(
  uuid, integer, jsonb, text, integer, uuid, uuid
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_amora_memory_job(integer, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.has_current_amora_memory_consent(uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_amora_memory_job(uuid, uuid, text, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_amora_memory_job(uuid, boolean, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.defer_amora_memory_job(uuid, integer, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_amora_memory_node(
  uuid, text, text, text, text, text, text, numeric, text, uuid, jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_amora_memory_node(
  uuid, text, uuid, uuid, text, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_amora_memory_node(uuid, text, uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.insert_amora_memory_summary(
  uuid, uuid, text, text, integer, uuid, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_amora_memory_consent(uuid, text, uuid, boolean)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.clear_amora_memory_scope(uuid, text, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_amora_memory_job(
  uuid, integer, jsonb, text, integer, uuid, uuid
) TO service_role;

COMMENT ON TABLE public.amora_memory_settings IS
  'Explicit per-couple/per-visibility consent and kill switch for chat-derived Amora memory.';
COMMENT ON TABLE public.amora_memory_jobs IS
  'Durable server-side queue for bounded Amora memory compilation. No raw chat text is copied into this table.';
COMMENT ON TABLE public.amora_memory_consents IS
  'Per-user explicit consent. Shared memory becomes active only after every linked partner consents.';
COMMENT ON COLUMN public.decision_nodes.memory_key IS
  'Stable semantic key for chat-derived Amora memory; NULL for explicit product decisions.';

COMMIT;
