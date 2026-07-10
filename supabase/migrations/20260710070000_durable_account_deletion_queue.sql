-- Durable, service-only account deletion queue.
--
-- The authenticated request and the lifecycle marker are committed in the
-- same transaction. A cron worker then drains provider leases, removes only
-- storage prefixes with proven ownership, performs the existing atomic Amora
-- leave/redaction flow, and finally deletes the auth user.

-- Historical versions wrote user identifiers, email addresses, and sometimes
-- free-form reasons before Auth deletion. Preserve only the bounded aggregate
-- reason and timestamp before enabling the new queue.
UPDATE public.account_deletions
SET user_id = NULL,
    email = NULL,
    reason = CASE
      WHEN reason IN (
        'unsatisfied', 'alternative', 'wedding_done', 'privacy',
        'low_usage', 'other', 'unknown'
      ) THEN reason
      ELSE 'unknown'
    END
WHERE user_id IS NOT NULL
   OR email IS NOT NULL
   OR reason IS NULL
   OR reason NOT IN (
     'unsatisfied', 'alternative', 'wedding_done', 'privacy',
     'low_usage', 'other', 'unknown'
   );

-- Runtime resource ceilings are fail-closed. Abort deployment up front if
-- existing production data would deterministically exceed them, so operators
-- can export and reconcile it instead of discovering it during a user request.
-- Count every actual member's couple scopes as a future sole-member deletion,
-- even while a partner is currently present.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.guestbooks
    GROUP BY owner_id HAVING count(*) > 498
  ) OR EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    LEFT JOIN public.couples AS couple ON couple.id = profile.couple_id
    WHERE (
      2
      + (SELECT count(*) FROM public.guestbooks AS guestbook
          WHERE guestbook.owner_id = profile.id)
      + CASE WHEN (
          (profile.role::text = 'bride'
            AND couple.bride_id = profile.id)
          OR (profile.role::text = 'groom'
            AND couple.groom_id = profile.id)
        ) THEN 1 + (SELECT count(*) FROM public.invitations AS invitation
          WHERE invitation.couple_id = profile.couple_id)
        ELSE 0
        END
    ) > 500
  ) OR EXISTS (
    SELECT 1
    FROM storage.objects
    WHERE bucket_id IN (
      'community-images', 'community-videos', 'guestbook-uploads',
      'invitation-photos', 'chat-image'
    )
    GROUP BY bucket_id, (storage.foldername(name))[1]
    HAVING count(*) > 20000
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_INVENTORY_REPAIR_REQUIRED'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM storage.objects
    WHERE bucket_id IN (
      'guestbook-images', 'cohort-images', 'vendor-images', 'vendor-licenses'
    )
  ) THEN
    RAISE EXCEPTION 'LEGACY_STORAGE_PROVENANCE_REPAIR_REQUIRED'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.account_deletion_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE,
  reason text NOT NULL DEFAULT 'unknown'
    CHECK (reason IN (
      'unsatisfied', 'alternative', 'wedding_done', 'privacy',
      'low_usage', 'other', 'unknown'
    )),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'retry', 'dead_letter', 'completed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 8),
  next_attempt_at timestamptz,
  lock_token uuid,
  locked_until timestamptz,
  storage_inventory jsonb,
  last_error_code text CHECK (
    last_error_code IS NULL OR last_error_code ~ '^[A-Z0-9_]{1,64}$'
  ),
  last_attempt_at timestamptz,
  dead_lettered_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL)),
  CHECK (status <> 'completed' OR user_id IS NULL),
  CHECK (status <> 'processing' OR (lock_token IS NOT NULL AND locked_until IS NOT NULL)),
  CHECK (status = 'processing' OR (lock_token IS NULL AND locked_until IS NULL)),
  CHECK (storage_inventory IS NULL OR jsonb_typeof(storage_inventory) = 'array')
);

CREATE INDEX IF NOT EXISTS account_deletion_jobs_due_idx
  ON public.account_deletion_jobs(next_attempt_at, created_at)
  WHERE status IN ('pending', 'retry');
CREATE INDEX IF NOT EXISTS account_deletion_jobs_stale_lock_idx
  ON public.account_deletion_jobs(locked_until)
  WHERE status = 'processing';
CREATE INDEX IF NOT EXISTS account_deletion_jobs_dead_letter_idx
  ON public.account_deletion_jobs(dead_lettered_at DESC)
  WHERE status = 'dead_letter';

ALTER TABLE public.account_deletion_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.account_deletion_jobs FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.account_deletion_jobs TO service_role;

DROP POLICY IF EXISTS account_deletion_jobs_service_only
  ON public.account_deletion_jobs;
CREATE POLICY account_deletion_jobs_service_only
  ON public.account_deletion_jobs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.account_deletion_jobs IS
  'Service-only durable deletion queue. It never stores email, free-form reasons, secrets, or raw provider/database errors.';
COMMENT ON COLUMN public.account_deletion_jobs.storage_inventory IS
  'Temporary allow-listed bucket/UUID-prefix snapshot, scrubbed together with user_id on completion.';
COMMENT ON COLUMN public.account_deletion_jobs.last_error_code IS
  'Bounded machine code only; raw error messages are intentionally not retained.';

-- Any user-linked payload table that can survive Auth deletion through a
-- nullable/no FK must share the profile-row lifecycle lock. If a write wins,
-- deletion waits and subsequently removes/redacts it. If deletion wins, the
-- write observes account_deleting_at and fails before payload persistence.
CREATE OR REPLACE FUNCTION public.guard_account_deletion_user_reference()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_user_text text;
  v_deleting_at timestamptz;
BEGIN
  IF TG_NARGS <> 1 THEN
    RAISE EXCEPTION 'account deletion guard column is required' USING ERRCODE = '22023';
  END IF;
  v_user_text := to_jsonb(NEW)->>TG_ARGV[0];
  IF v_user_text IS NULL OR btrim(v_user_text) = '' THEN
    RETURN NEW;
  END IF;
  BEGIN
    v_user_id := v_user_text::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'invalid guarded user reference' USING ERRCODE = '22023';
  END;

  SELECT account_deleting_at INTO v_deleting_at
  FROM public.profiles
  WHERE id = v_user_id
  FOR UPDATE;
  IF NOT FOUND OR v_deleting_at IS NOT NULL THEN
    RAISE EXCEPTION 'referenced account is not active' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_account_deletion_user_reference()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_delete_chat_summaries ON public.chat_summaries;
CREATE TRIGGER guard_delete_chat_summaries
  BEFORE INSERT OR UPDATE ON public.chat_summaries
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_deletion_user_reference('user_id');
DROP TRIGGER IF EXISTS guard_delete_chat_feedback ON public.chat_feedback;
CREATE TRIGGER guard_delete_chat_feedback
  BEFORE INSERT OR UPDATE ON public.chat_feedback
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_deletion_user_reference('user_id');
DROP TRIGGER IF EXISTS guard_delete_search_logs ON public.search_logs;
CREATE TRIGGER guard_delete_search_logs
  BEFORE INSERT OR UPDATE ON public.search_logs
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_deletion_user_reference('user_id');
DROP TRIGGER IF EXISTS guard_delete_vendor_photo_likes ON public.vendor_photo_likes;
CREATE TRIGGER guard_delete_vendor_photo_likes
  BEFORE INSERT OR UPDATE ON public.vendor_photo_likes
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_deletion_user_reference('user_id');
DROP TRIGGER IF EXISTS guard_delete_customer_events ON public.customer_events;
CREATE TRIGGER guard_delete_customer_events
  BEFORE INSERT OR UPDATE ON public.customer_events
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_deletion_user_reference('user_id');
DROP TRIGGER IF EXISTS guard_delete_quote_checks ON public.amora_quote_checks;
CREATE TRIGGER guard_delete_quote_checks
  BEFORE INSERT OR UPDATE ON public.amora_quote_checks
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_deletion_user_reference('user_id');
DROP TRIGGER IF EXISTS guard_delete_vendor_reviews ON public.vendor_reviews;
CREATE TRIGGER guard_delete_vendor_reviews
  BEFORE INSERT OR UPDATE ON public.vendor_reviews
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_deletion_user_reference('customer_id');
DROP TRIGGER IF EXISTS guard_delete_vendor_views ON public.vendor_views;
CREATE TRIGGER guard_delete_vendor_views
  BEFORE INSERT OR UPDATE ON public.vendor_views
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_deletion_user_reference('viewer_id');
DROP TRIGGER IF EXISTS guard_delete_ai_logs ON public.ai_interactions_log;
CREATE TRIGGER guard_delete_ai_logs
  BEFORE INSERT OR UPDATE ON public.ai_interactions_log
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_deletion_user_reference('user_id');
DROP TRIGGER IF EXISTS guard_delete_money ON public.congratulatory_money;
CREATE TRIGGER guard_delete_money
  BEFORE INSERT OR UPDATE ON public.congratulatory_money
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_deletion_user_reference('owner_user_id');
DROP TRIGGER IF EXISTS guard_delete_agent_personas ON public.community_agent_personas;
CREATE TRIGGER guard_delete_agent_personas
  BEFORE INSERT OR UPDATE ON public.community_agent_personas
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_deletion_user_reference('backing_user_id');
DROP TRIGGER IF EXISTS guard_delete_amora_actions ON public.amora_actions;
CREATE TRIGGER guard_delete_amora_actions
  BEFORE INSERT OR UPDATE ON public.amora_actions
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_deletion_user_reference('created_by');

-- Persistent limiter keys contain a user UUID suffix instead of a separate FK.
CREATE OR REPLACE FUNCTION public.guard_account_deletion_rate_limit_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_text text;
  v_user_id uuid;
  v_deleting_at timestamptz;
BEGIN
  v_user_text := right(NEW.key, 36);
  IF NEW.key !~ ':[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NEW;
  END IF;
  v_user_id := v_user_text::uuid;
  SELECT account_deleting_at INTO v_deleting_at
  FROM public.profiles
  WHERE id = v_user_id
  FOR UPDATE;
  IF NOT FOUND OR v_deleting_at IS NOT NULL THEN
    RAISE EXCEPTION 'referenced account is not active' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_account_deletion_rate_limit_write()
  FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_delete_rate_limit_buckets ON public.rate_limit_buckets;
CREATE TRIGGER guard_delete_rate_limit_buckets
  BEFORE INSERT OR UPDATE ON public.rate_limit_buckets
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_deletion_rate_limit_write();

-- Extend the existing Storage trigger to serialize guestbook/invitation writes
-- with their proven owner lifecycle. Unknown legacy buckets remain untouched
-- until provenance is repaired; guessing those paths could delete shared data.
CREATE OR REPLACE FUNCTION public.guard_user_media_storage_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
  v_scope_text text;
  v_scope_id uuid;
  v_couple_id uuid;
  v_deleting_at timestamptz;
BEGIN
  IF NEW.bucket_id NOT IN (
    'community-images', 'community-videos',
    'guestbook-uploads', 'invitation-photos'
  ) THEN
    RETURN NEW;
  END IF;

  v_scope_text := (storage.foldername(NEW.name))[1];
  BEGIN
    v_scope_id := v_scope_text::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'invalid guarded storage owner path' USING ERRCODE = '22023';
  END;

  IF NEW.bucket_id IN ('community-images', 'community-videos') THEN
    SELECT account_deleting_at INTO v_deleting_at
    FROM public.profiles
    WHERE id = v_scope_id
    FOR UPDATE;
    IF NOT FOUND OR v_deleting_at IS NOT NULL THEN
      RAISE EXCEPTION 'community media owner is not active' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.bucket_id = 'guestbook-uploads' THEN
    SELECT profile.account_deleting_at INTO v_deleting_at
    FROM public.guestbooks AS guestbook
    JOIN public.profiles AS profile ON profile.id = guestbook.owner_id
    WHERE guestbook.id = v_scope_id
    FOR UPDATE OF profile;
    IF NOT FOUND OR v_deleting_at IS NOT NULL THEN
      RAISE EXCEPTION 'guestbook media owner is not active' USING ERRCODE = '42501';
    END IF;
  ELSE
    SELECT invitation.couple_id INTO v_couple_id
    FROM public.invitations AS invitation
    WHERE invitation.id = v_scope_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invitation media owner is not active' USING ERRCODE = '42501';
    END IF;
    SELECT couple.amora_shared_resetting_at INTO v_deleting_at
    FROM public.couples AS couple
    WHERE couple.id = v_couple_id
    FOR UPDATE;
    IF NOT FOUND OR v_deleting_at IS NOT NULL THEN
      RAISE EXCEPTION 'invitation media owner is not active' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_user_media_storage_write()
  FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_guard_user_media_storage_write ON storage.objects;
CREATE TRIGGER trg_guard_user_media_storage_write
  BEFORE INSERT OR UPDATE ON storage.objects
  FOR EACH ROW EXECUTE FUNCTION public.guard_user_media_storage_write();

-- Atomically create the durable job and start the existing lifecycle/CAS
-- barrier. Repeated requests return the same job and never increment the
-- membership generation again while the marker is present.
CREATE OR REPLACE FUNCTION public.request_account_deletion(
  p_user_id uuid,
  p_reason text DEFAULT 'unknown'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job public.account_deletion_jobs%ROWTYPE;
  v_inserted boolean := false;
  v_lifecycle jsonb := jsonb_build_object('profile_found', false);
  v_account_deleting_at timestamptz;
  v_reason text;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user id is required' USING ERRCODE = '22023';
  END IF;

  v_reason := CASE
    WHEN p_reason IN (
      'unsatisfied', 'alternative', 'wedding_done', 'privacy',
      'low_usage', 'other', 'unknown'
    ) THEN p_reason
    ELSE 'unknown'
  END;

  INSERT INTO public.account_deletion_jobs (
    user_id, reason, status, attempts, next_attempt_at
  ) VALUES (
    p_user_id, v_reason, 'pending', 0, now()
  )
  ON CONFLICT (user_id) DO NOTHING
  RETURNING * INTO v_job;
  v_inserted := FOUND;

  IF NOT v_inserted THEN
    SELECT * INTO v_job
    FROM public.account_deletion_jobs
    WHERE user_id = p_user_id
    FOR UPDATE;
  END IF;

  SELECT account_deleting_at INTO v_account_deleting_at
  FROM public.profiles
  WHERE id = p_user_id;

  IF v_inserted OR v_account_deleting_at IS NULL THEN
    v_lifecycle := public.begin_account_deletion(p_user_id);
  ELSE
    v_lifecycle := jsonb_build_object(
      'profile_found', true,
      'account_deleting_at', v_account_deleting_at
    );
  END IF;

  RETURN jsonb_build_object(
    'job_id', v_job.id,
    'status', v_job.status,
    'attempts', v_job.attempts,
    'created', v_inserted,
    'profile_found', COALESCE((v_lifecycle->>'profile_found')::boolean, false)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.request_account_deletion(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_account_deletion(uuid, text) TO service_role;

-- Claims are idempotent and concurrency-safe. An expired worker lease is
-- reclaimed with a new attempt; an eighth expired attempt is dead-lettered.
CREATE OR REPLACE FUNCTION public.claim_account_deletion_jobs(
  p_worker_token uuid,
  p_limit integer DEFAULT 2,
  p_lease_seconds integer DEFAULT 180
)
RETURNS TABLE (
  job_id uuid,
  user_id uuid,
  reason text,
  attempts integer,
  storage_inventory jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_worker_token IS NULL
    OR p_limit IS NULL OR p_limit < 1 OR p_limit > 10
    OR p_lease_seconds IS NULL OR p_lease_seconds < 60 OR p_lease_seconds > 600
  THEN
    RAISE EXCEPTION 'invalid account deletion claim arguments' USING ERRCODE = '22023';
  END IF;

  UPDATE public.account_deletion_jobs AS job
  SET status = 'dead_letter',
      lock_token = NULL,
      locked_until = NULL,
      next_attempt_at = NULL,
      last_error_code = 'WORKER_LEASE_EXPIRED',
      dead_lettered_at = COALESCE(job.dead_lettered_at, now()),
      updated_at = now()
  WHERE job.status = 'processing'
    AND job.locked_until <= now()
    AND job.attempts >= 8;

  RETURN QUERY
  WITH candidates AS (
    SELECT candidate.id
    FROM public.account_deletion_jobs AS candidate
    WHERE candidate.user_id IS NOT NULL
      AND candidate.attempts < 8
      AND (
        (candidate.status IN ('pending', 'retry')
          AND COALESCE(candidate.next_attempt_at, '-infinity'::timestamptz) <= now())
        OR (candidate.status = 'processing' AND candidate.locked_until <= now())
      )
    ORDER BY candidate.created_at, candidate.id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.account_deletion_jobs AS job
  SET status = 'processing',
      attempts = job.attempts + 1,
      lock_token = p_worker_token,
      locked_until = now() + make_interval(secs => p_lease_seconds),
      last_error_code = CASE
        WHEN job.status = 'processing' THEN 'WORKER_LEASE_EXPIRED'
        ELSE job.last_error_code
      END,
      last_attempt_at = now(),
      next_attempt_at = NULL,
      updated_at = now()
  FROM candidates
  WHERE job.id = candidates.id
  RETURNING job.id, job.user_id, job.reason, job.attempts, job.storage_inventory;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_account_deletion_jobs(uuid, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_account_deletion_jobs(uuid, integer, integer)
  TO service_role;

-- Persist a minimal, validated storage snapshot before destructive DB/auth
-- work. This closes the crash window where auth cascade could otherwise erase
-- the ownership rows needed to find guestbook/invitation objects on retry.
CREATE OR REPLACE FUNCTION public.save_account_deletion_storage_inventory(
  p_job_id uuid,
  p_worker_token uuid,
  p_inventory jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF p_inventory IS NULL OR jsonb_typeof(p_inventory) <> 'array' THEN
    RAISE EXCEPTION 'invalid storage inventory' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_inventory) > 500 THEN
    RAISE EXCEPTION 'invalid storage inventory' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_inventory) AS item(value)
    WHERE jsonb_typeof(item.value) <> 'object'
  ) THEN
    RAISE EXCEPTION 'invalid storage inventory' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_inventory) AS item(value)
      WHERE COALESCE(item.value->>'bucket', '') NOT IN (
          'community-images', 'community-videos', 'guestbook-uploads',
          'invitation-photos', 'chat-image'
        )
        OR COALESCE(item.value->>'prefix', '') !~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        OR (SELECT count(*) FROM jsonb_object_keys(item.value)) <> 2
    ) THEN
    RAISE EXCEPTION 'invalid storage inventory' USING ERRCODE = '22023';
  END IF;

  UPDATE public.account_deletion_jobs
  SET storage_inventory = p_inventory,
      updated_at = now()
  WHERE id = p_job_id
    AND status = 'processing'
    AND lock_token = p_worker_token
    AND locked_until > now()
    AND storage_inventory IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 1 THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.account_deletion_jobs
    WHERE id = p_job_id
      AND status = 'processing'
      AND lock_token = p_worker_token
      AND locked_until > now()
      AND storage_inventory = p_inventory
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_account_deletion_storage_inventory(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_account_deletion_storage_inventory(uuid, uuid, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.fail_account_deletion_job(
  p_job_id uuid,
  p_worker_token uuid,
  p_error_code text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_attempts integer;
  v_status text;
  v_delay_seconds integer;
BEGIN
  IF p_error_code IS NULL OR p_error_code !~ '^[A-Z0-9_]{1,64}$' THEN
    RAISE EXCEPTION 'invalid account deletion error code' USING ERRCODE = '22023';
  END IF;

  SELECT attempts INTO v_attempts
  FROM public.account_deletion_jobs
  WHERE id = p_job_id
    AND status = 'processing'
    AND lock_token = p_worker_token
    AND locked_until > now()
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'claim_lost';
  END IF;

  IF v_attempts >= 8 THEN
    v_status := 'dead_letter';
    UPDATE public.account_deletion_jobs
    SET status = v_status,
        lock_token = NULL,
        locked_until = NULL,
        next_attempt_at = NULL,
        last_error_code = p_error_code,
        dead_lettered_at = now(),
        updated_at = now()
    WHERE id = p_job_id;
  ELSE
    v_status := 'retry';
    v_delay_seconds := LEAST(900, (5 * power(2, GREATEST(v_attempts - 1, 0)))::integer);
    UPDATE public.account_deletion_jobs
    SET status = v_status,
        lock_token = NULL,
        locked_until = NULL,
        next_attempt_at = now() + make_interval(secs => v_delay_seconds),
        last_error_code = p_error_code,
        updated_at = now()
    WHERE id = p_job_id;
  END IF;

  RETURN v_status;
END;
$$;

REVOKE ALL ON FUNCTION public.fail_account_deletion_job(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_account_deletion_job(uuid, uuid, text)
  TO service_role;

-- Completion and the anonymous reason statistic commit together. All
-- temporary subject identifiers and storage prefixes are scrubbed.
CREATE OR REPLACE FUNCTION public.complete_account_deletion_job(
  p_job_id uuid,
  p_worker_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reason text;
BEGIN
  SELECT reason INTO v_reason
  FROM public.account_deletion_jobs
  WHERE id = p_job_id
    AND status = 'processing'
    AND lock_token = p_worker_token
    AND locked_until > now()
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO public.account_deletions (user_id, email, reason, deleted_at)
  VALUES (NULL, NULL, v_reason, now());

  UPDATE public.account_deletion_jobs
  SET user_id = NULL,
      status = 'completed',
      lock_token = NULL,
      locked_until = NULL,
      storage_inventory = NULL,
      next_attempt_at = NULL,
      last_error_code = NULL,
      completed_at = now(),
      dead_lettered_at = NULL,
      updated_at = now()
  WHERE id = p_job_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_account_deletion_job(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_account_deletion_job(uuid, uuid)
  TO service_role;

-- Deliberate operator-only replay. Automatic retries remain bounded at eight;
-- a human must explicitly start a new bounded cycle for a dead letter.
CREATE OR REPLACE FUNCTION public.requeue_dead_account_deletion_job(p_job_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_updated integer;
BEGIN
  UPDATE public.account_deletion_jobs
  SET status = 'retry',
      attempts = 0,
      next_attempt_at = now(),
      lock_token = NULL,
      locked_until = NULL,
      last_error_code = 'MANUAL_REQUEUE',
      dead_lettered_at = NULL,
      updated_at = now()
  WHERE id = p_job_id
    AND status = 'dead_letter'
    AND user_id IS NOT NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.requeue_dead_account_deletion_job(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.requeue_dead_account_deletion_job(uuid)
  TO service_role;

-- A single non-identifying health probe lets cron monitoring fail loudly when
-- operator action is required, without exposing job ids or user ids.
CREATE OR REPLACE FUNCTION public.account_deletion_queue_health()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'dead_letter', count(*) FILTER (WHERE status = 'dead_letter'),
    'overdue', count(*) FILTER (
      WHERE status IN ('pending', 'retry')
        AND next_attempt_at < now() - interval '15 minutes'
    ),
    'stale_processing', count(*) FILTER (
      WHERE status = 'processing' AND locked_until < now()
    )
  )
  FROM public.account_deletion_jobs;
$$;
REVOKE ALL ON FUNCTION public.account_deletion_queue_health()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_deletion_queue_health() TO service_role;
