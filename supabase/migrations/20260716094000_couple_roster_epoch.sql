BEGIN;

-- Seal the first two-person couple roster as a permanent privacy epoch.
-- Also converge preview databases whose edited 0900/0930 migrations were
-- already recorded before the targeted-claim and care-roster hardening landed.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.couples
  ADD COLUMN IF NOT EXISTS membership_sealed_at timestamptz;

-- A paired row has unquestionably established its first roster. For a current
-- one-member row, updated_at is not membership evidence because invite-code
-- creation/rotation changes it too. Seal a historical one-member row only when
-- durable couple chat proves that two distinct authenticated people shared it.
WITH shared_chat_couples AS MATERIALIZED (
  SELECT message.couple_id
  FROM public.chat_messages AS message
  WHERE message.couple_id IS NOT NULL
    AND message.sender_id IS NOT NULL
  GROUP BY message.couple_id
  HAVING count(DISTINCT message.sender_id) >= 2
)
UPDATE public.couples AS couple
SET membership_sealed_at = COALESCE(couple.updated_at, couple.created_at, now())
WHERE membership_sealed_at IS NULL
  AND (
    (bride_id IS NOT NULL AND groom_id IS NOT NULL)
    OR EXISTS (
      SELECT 1
      FROM shared_chat_couples AS shared_chat
      WHERE shared_chat.couple_id = couple.id
    )
  );

CREATE OR REPLACE FUNCTION public.enforce_couple_roster_epoch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- The seal is derived from the roster, never accepted from a caller.
    NEW.membership_sealed_at := CASE
      WHEN NEW.bride_id IS NOT NULL AND NEW.groom_id IS NOT NULL
        THEN transaction_timestamp()
      ELSE NULL
    END;
    RETURN NEW;
  END IF;

  IF OLD.membership_sealed_at IS NOT NULL THEN
    IF NEW.membership_sealed_at IS DISTINCT FROM OLD.membership_sealed_at THEN
      RAISE EXCEPTION 'COUPLE_ROSTER_EPOCH_IMMUTABLE'
        USING ERRCODE = '23514', CONSTRAINT = 'couples_roster_epoch_guard';
    END IF;

    IF NEW.invite_code IS DISTINCT FROM OLD.invite_code THEN
      RAISE EXCEPTION 'COUPLE_INVITE_CODE_SEALED'
        USING ERRCODE = '23514', CONSTRAINT = 'couples_roster_epoch_guard';
    END IF;

    -- A sealed member may leave, but no empty slot may ever be filled again.
    IF (OLD.bride_id IS NULL AND NEW.bride_id IS NOT NULL)
       OR (OLD.groom_id IS NULL AND NEW.groom_id IS NOT NULL)
       OR (OLD.bride_id IS NOT NULL
        AND NEW.bride_id IS NOT NULL
        AND NEW.bride_id IS DISTINCT FROM OLD.bride_id)
       OR (OLD.groom_id IS NOT NULL
        AND NEW.groom_id IS NOT NULL
        AND NEW.groom_id IS DISTINCT FROM OLD.groom_id) THEN
      RAISE EXCEPTION 'COUPLE_ROSTER_EPOCH_CLOSED'
        USING ERRCODE = '23514', CONSTRAINT = 'couples_roster_epoch_guard';
    END IF;
  ELSE
    -- Even a fresh one-member couple cannot replace its original member.
    IF (
      (OLD.bride_id IS NOT NULL
        AND OLD.bride_id IS DISTINCT FROM NEW.bride_id
        AND OLD.bride_id IS DISTINCT FROM NEW.groom_id)
      OR (OLD.groom_id IS NOT NULL
        AND OLD.groom_id IS DISTINCT FROM NEW.bride_id
        AND OLD.groom_id IS DISTINCT FROM NEW.groom_id)
    ) AND (
      (NEW.bride_id IS NOT NULL
        AND NEW.bride_id IS DISTINCT FROM OLD.bride_id
        AND NEW.bride_id IS DISTINCT FROM OLD.groom_id)
      OR (NEW.groom_id IS NOT NULL
        AND NEW.groom_id IS DISTINCT FROM OLD.bride_id
        AND NEW.groom_id IS DISTINCT FROM OLD.groom_id)
    ) THEN
      RAISE EXCEPTION 'COUPLE_MEMBER_REPLACEMENT_FORBIDDEN'
        USING ERRCODE = '23514', CONSTRAINT = 'couples_roster_epoch_guard';
    END IF;

    IF (OLD.bride_id IS NOT NULL
        AND NEW.bride_id IS NOT NULL
        AND NEW.bride_id IS DISTINCT FROM OLD.bride_id)
       OR (OLD.groom_id IS NOT NULL
        AND NEW.groom_id IS NOT NULL
        AND NEW.groom_id IS DISTINCT FROM OLD.groom_id) THEN
      RAISE EXCEPTION 'COUPLE_MEMBER_REPLACEMENT_FORBIDDEN'
        USING ERRCODE = '23514', CONSTRAINT = 'couples_roster_epoch_guard';
    END IF;

    IF NEW.bride_id IS NOT NULL AND NEW.groom_id IS NOT NULL THEN
      -- Override any caller-provided timestamp and atomically establish the
      -- first roster epoch in the same write that fills the second slot.
      NEW.membership_sealed_at := transaction_timestamp();
    ELSIF NEW.membership_sealed_at IS NOT NULL THEN
      RAISE EXCEPTION 'COUPLE_ROSTER_EPOCH_SERVER_MANAGED'
        USING ERRCODE = '23514', CONSTRAINT = 'couples_roster_epoch_guard';
    ELSE
      NEW.membership_sealed_at := NULL;
    END IF;
  END IF;

  RETURN NEW;
END
$function$;

ALTER FUNCTION public.enforce_couple_roster_epoch() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enforce_couple_roster_epoch()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_enforce_couple_roster_epoch ON public.couples;
CREATE TRIGGER trg_enforce_couple_roster_epoch
  BEFORE INSERT OR UPDATE ON public.couples
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_couple_roster_epoch();

COMMENT ON COLUMN public.couples.membership_sealed_at IS
  'Permanent timestamp of the first two-member roster; after sealing, member slots may only be cleared and the invite code is immutable.';

-- 0900 upgrade path: an edited, already-recorded migration does not replace
-- the historical integer-only overload. Recreate the targeted claim and make
-- the old overload's absence an explicit postcondition.
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

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hanbang:amora-memory-claim', 0)
  );

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

ALTER FUNCTION public.claim_amora_memory_job(integer, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_amora_memory_job(integer, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_amora_memory_job(integer, uuid)
  TO service_role;

-- 0930 upgrade path. Adding the column is intentionally nullable first so an
-- already-live queue can be quarantined without inventing a historical roster.
ALTER TABLE public.amora_care_jobs
  ADD COLUMN IF NOT EXISTS roster_member_ids uuid[];

-- Rows without a valid roster predate the epoch fence. They must never resume
-- delivery. Scrub all copied recipient data first, then terminalize active jobs.
UPDATE public.amora_care_deliveries AS delivery
SET status = CASE
      WHEN delivery.status IN ('pending', 'processing') THEN 'cancelled'
      ELSE delivery.status
    END,
    completed_at = CASE
      WHEN delivery.status IN ('pending', 'processing') THEN now()
      ELSE delivery.completed_at
    END,
    recipient_email = NULL,
    recipient_name = NULL,
    last_error = CASE
      WHEN delivery.status IN ('pending', 'processing')
        THEN 'roster_epoch_upgrade_quarantine'
      ELSE delivery.last_error
    END,
    updated_at = now()
FROM public.amora_care_jobs AS job
WHERE delivery.job_id = job.id
  AND (
    job.roster_member_ids IS NULL
    OR cardinality(job.roster_member_ids) NOT BETWEEN 1 AND 2
    OR array_position(job.roster_member_ids, NULL) IS NOT NULL
  );

UPDATE public.amora_care_jobs
SET status = CASE
      WHEN status IN ('pending', 'processing') THEN 'cancelled'
      ELSE status
    END,
    completed_at = CASE
      WHEN status IN ('pending', 'processing') THEN now()
      ELSE completed_at
    END,
    lease_token = CASE
      WHEN status IN ('pending', 'processing') THEN NULL
      ELSE lease_token
    END,
    lease_expires_at = CASE
      WHEN status IN ('pending', 'processing') THEN NULL
      ELSE lease_expires_at
    END,
    last_error = CASE
      WHEN status IN ('pending', 'processing')
        THEN 'roster_epoch_upgrade_quarantine'
      ELSE last_error
    END,
    content = '[redacted]',
    email_subject = NULL,
    email_html = NULL,
    metadata = '{}'::jsonb,
    updated_at = now()
WHERE roster_member_ids IS NULL
   OR cardinality(roster_member_ids) NOT BETWEEN 1 AND 2
   OR array_position(roster_member_ids, NULL) IS NOT NULL;

WITH derived_rosters AS (
  SELECT
    job.id,
    COALESCE(array_agg(member.member_id ORDER BY member.member_id)
      FILTER (WHERE member.member_id IS NOT NULL), ARRAY[]::uuid[]) AS member_ids
  FROM public.amora_care_jobs AS job
  JOIN public.couples AS couple ON couple.id = job.couple_id
  LEFT JOIN LATERAL (
    SELECT DISTINCT candidate AS member_id
    FROM unnest(ARRAY[couple.bride_id, couple.groom_id]::uuid[]) AS roster(candidate)
    WHERE candidate IS NOT NULL
  ) AS member ON true
  WHERE job.roster_member_ids IS NULL
     OR cardinality(job.roster_member_ids) NOT BETWEEN 1 AND 2
     OR array_position(job.roster_member_ids, NULL) IS NOT NULL
  GROUP BY job.id
)
UPDATE public.amora_care_jobs AS job
SET roster_member_ids = derived.member_ids
FROM derived_rosters AS derived
WHERE job.id = derived.id
  AND cardinality(derived.member_ids) BETWEEN 1 AND 2;

DO $care_roster_backfill$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.amora_care_jobs
    WHERE roster_member_ids IS NULL
       OR cardinality(roster_member_ids) NOT BETWEEN 1 AND 2
       OR array_position(roster_member_ids, NULL) IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'AMORA_CARE_ROSTER_BACKFILL_UNRESOLVED'
      USING ERRCODE = '23514';
  END IF;
END
$care_roster_backfill$;

ALTER TABLE public.amora_care_jobs
  DROP CONSTRAINT IF EXISTS amora_care_jobs_roster_member_ids_valid;
ALTER TABLE public.amora_care_jobs
  ADD CONSTRAINT amora_care_jobs_roster_member_ids_valid
  CHECK (
    cardinality(roster_member_ids) BETWEEN 1 AND 2
    AND array_position(roster_member_ids, NULL) IS NULL
  ) NOT VALID;
ALTER TABLE public.amora_care_jobs
  VALIDATE CONSTRAINT amora_care_jobs_roster_member_ids_valid;
ALTER TABLE public.amora_care_jobs
  ALTER COLUMN roster_member_ids SET NOT NULL;

-- Fail the migration if any safety fence did not converge exactly.
DO $postconditions$
DECLARE
  v_claim_defaults integer;
BEGIN
  IF to_regprocedure('public.claim_amora_memory_job(integer,uuid)') IS NULL
     OR to_regprocedure('public.claim_amora_memory_job(integer)') IS NOT NULL
     OR NOT has_function_privilege(
       'service_role',
       'public.claim_amora_memory_job(integer,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.claim_amora_memory_job(integer,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.claim_amora_memory_job(integer,uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'AMORA_MEMORY_TARGETED_CLAIM_POSTCONDITION_FAILED';
  END IF;

  SELECT pronargdefaults
    INTO v_claim_defaults
  FROM pg_proc
  WHERE oid = to_regprocedure('public.claim_amora_memory_job(integer,uuid)');
  IF v_claim_defaults <> 2 THEN
    RAISE EXCEPTION 'AMORA_MEMORY_TARGETED_CLAIM_DEFAULTS_INVALID';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'amora_care_jobs'
      AND column_name = 'roster_member_ids'
      AND is_nullable = 'NO'
      AND udt_name = '_uuid'
  )
  OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.amora_care_jobs'::regclass
      AND conname = 'amora_care_jobs_roster_member_ids_valid'
      AND contype = 'c'
      AND convalidated
  )
  OR EXISTS (
    SELECT 1
    FROM public.amora_care_jobs
    WHERE roster_member_ids IS NULL
       OR cardinality(roster_member_ids) NOT BETWEEN 1 AND 2
       OR array_position(roster_member_ids, NULL) IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'AMORA_CARE_ROSTER_POSTCONDITION_FAILED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.couples'::regclass
      AND tgname = 'trg_enforce_couple_roster_epoch'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'COUPLE_ROSTER_EPOCH_TRIGGER_MISSING';
  END IF;
END
$postconditions$;

COMMIT;
