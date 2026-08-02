BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preconditions$
BEGIN
  IF to_regclass('public.amora_memory_jobs') IS NULL
     OR to_regclass('public.amora_memory_enqueue_repair_candidates') IS NULL
     OR to_regclass('public.amora_chat_request_claims') IS NULL
     OR to_regclass('public.chat_messages') IS NULL
     OR to_regclass('public.amora_memory_settings') IS NULL
     OR to_regprocedure(
       'public.has_current_amora_memory_consent(uuid,text)'
     ) IS NULL
     OR to_regprocedure(
       'public.enqueue_amora_memory_job(uuid,uuid,text,uuid)'
     ) IS NULL
     OR to_regprocedure(
       'public.repair_missing_amora_memory_jobs(integer)'
     ) IS NULL THEN
    RAISE EXCEPTION 'AMORA_MEMORY_JOB_RECOVERY_PREREQUISITE_MISSING';
  END IF;
END
$preconditions$;

-- Terminal repair outcomes must not poison the bounded outbox forever. Keep a
-- content-free audit row that is deleted with its exact claim/message privacy
-- source, then remove the live candidate.
CREATE TABLE public.amora_memory_enqueue_repair_dead_letters (
  couple_id uuid NOT NULL,
  request_key text NOT NULL CHECK (char_length(request_key) BETWEEN 1 AND 160),
  user_id uuid NOT NULL,
  visibility text NOT NULL CHECK (
    visibility IN ('shared', 'bride_private', 'groom_private')
  ),
  to_message_id uuid NOT NULL,
  claim_completed_at timestamptz NOT NULL,
  candidate_created_at timestamptz NOT NULL,
  repair_attempt_count integer NOT NULL CHECK (
    repair_attempt_count BETWEEN 0 AND 1000000
  ),
  terminal_reason_code text NOT NULL CHECK (
    terminal_reason_code IN (
      'ENQUEUE_INTENT_UNCONFIRMED',
      'SCOPE_REVALIDATION_FAILED',
      'SOURCE_REVALIDATION_FAILED',
      'JOB_TERMINAL_DEAD_LETTER',
      'DUPLICATE_NOT_ACTIVE',
      'ENQUEUE_CONTRACT_INVALID',
      'ENQUEUE_PERMANENT_ERROR'
    )
  ),
  dead_lettered_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (couple_id, request_key),
  UNIQUE (couple_id, visibility, to_message_id),
  FOREIGN KEY (couple_id, request_key)
    REFERENCES public.amora_chat_request_claims(couple_id, request_key)
    ON DELETE CASCADE,
  FOREIGN KEY (to_message_id)
    REFERENCES public.chat_messages(id)
    ON DELETE CASCADE
);

ALTER TABLE public.amora_memory_enqueue_repair_dead_letters
  OWNER TO postgres;
ALTER TABLE public.amora_memory_enqueue_repair_dead_letters
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amora_memory_enqueue_repair_dead_letters
  FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.amora_memory_enqueue_repair_dead_letters
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.amora_memory_enqueue_repair_dead_letters IS
  'ID-only terminal audit for unrecoverable Amora enqueue repair candidates; contains no chat content.';

-- The 22000 trigger could not see the runtime kill switch. Persist the exact
-- route decision instead: only W0/W1 turns with current consent and runtime
-- enqueue enabled write `memory_enqueue_requested: true` and enter the outbox.
CREATE OR REPLACE FUNCTION public.capture_amora_memory_enqueue_repair_candidate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
BEGIN
  IF NEW.status IS DISTINCT FROM 'completed'
     OR NEW.message_id IS NULL
     OR NEW.completed_at IS NULL
     OR NEW.visibility NOT IN (
       'shared', 'bride_private', 'groom_private'
     ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.amora_memory_enqueue_repair_candidates (
    couple_id,
    request_key,
    user_id,
    visibility,
    to_message_id,
    claim_completed_at
  )
  SELECT
    NEW.couple_id,
    NEW.request_key,
    NEW.user_id,
    NEW.visibility,
    message.id,
    NEW.completed_at
  FROM public.chat_messages AS message
  WHERE message.id = NEW.message_id
    AND message.couple_id = NEW.couple_id
    AND message.visibility = NEW.visibility
    AND message.sender_id IS NULL
    AND message.sender_type = 'ai'
    AND message.role = 'assistant'
    AND jsonb_typeof(message.metadata) = 'object'
    AND jsonb_typeof(message.metadata->'client_request_id') = 'string'
    AND message.metadata->>'client_request_id' = NEW.request_key
    AND jsonb_typeof(message.metadata->'memory_eligible') = 'boolean'
    AND message.metadata->'memory_eligible' = 'true'::jsonb
    AND jsonb_typeof(
      message.metadata->'memory_enqueue_requested'
    ) = 'boolean'
    AND message.metadata->'memory_enqueue_requested' = 'true'::jsonb
    AND message.metadata->>'question_scope' IN (
      'W0_wedding_core', 'W1_wedding_adjacent'
    )
    AND message.metadata->>'target' IS DISTINCT FROM 'partner'
    AND NOT EXISTS (
      SELECT 1
      FROM public.amora_memory_jobs AS job
      WHERE job.couple_id = message.couple_id
        AND job.visibility = message.visibility
        AND job.to_message_id = message.id
    )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END
$function$;

ALTER FUNCTION public.capture_amora_memory_enqueue_repair_candidate()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.capture_amora_memory_enqueue_repair_candidate()
  FROM PUBLIC, anon, authenticated, service_role;

-- Existing rows without durable intent may have accumulated while the runtime
-- flag was off. A pre-existing job itself is durable legacy enqueue intent;
-- otherwise audit and remove the candidate so enabling the flag later cannot
-- backfill old provider turns.
INSERT INTO public.amora_memory_enqueue_repair_dead_letters (
  couple_id,
  request_key,
  user_id,
  visibility,
  to_message_id,
  claim_completed_at,
  candidate_created_at,
  repair_attempt_count,
  terminal_reason_code
)
SELECT
  repair.couple_id,
  repair.request_key,
  repair.user_id,
  repair.visibility,
  repair.to_message_id,
  repair.claim_completed_at,
  repair.created_at,
  repair.attempt_count,
  'ENQUEUE_INTENT_UNCONFIRMED'
FROM public.amora_memory_enqueue_repair_candidates AS repair
JOIN public.chat_messages AS message
  ON message.id = repair.to_message_id
 AND message.couple_id = repair.couple_id
 AND message.visibility = repair.visibility
WHERE (
    jsonb_typeof(message.metadata->'memory_enqueue_requested')
      IS DISTINCT FROM 'boolean'
    OR message.metadata->'memory_enqueue_requested' <> 'true'::jsonb
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.amora_memory_jobs AS job
    WHERE job.couple_id = repair.couple_id
      AND job.visibility = repair.visibility
      AND job.to_message_id = repair.to_message_id
  )
ON CONFLICT (couple_id, request_key) DO UPDATE
SET repair_attempt_count = GREATEST(
      public.amora_memory_enqueue_repair_dead_letters.repair_attempt_count,
      excluded.repair_attempt_count
    ),
    terminal_reason_code = excluded.terminal_reason_code,
    dead_lettered_at = now(),
    updated_at = now();

DELETE FROM public.amora_memory_enqueue_repair_candidates AS repair
USING public.chat_messages AS message
WHERE message.id = repair.to_message_id
  AND message.couple_id = repair.couple_id
  AND message.visibility = repair.visibility
  AND (
    jsonb_typeof(message.metadata->'memory_enqueue_requested')
      IS DISTINCT FROM 'boolean'
    OR message.metadata->'memory_enqueue_requested' <> 'true'::jsonb
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.amora_memory_jobs AS job
    WHERE job.couple_id = repair.couple_id
      AND job.visibility = repair.visibility
      AND job.to_message_id = repair.to_message_id
  );

-- `duplicate` is not itself proof of a usable job. Older unique rows can be
-- terminal failed/cancelled records. This service-only predicate proves the
-- exact current actor/source/privacy binding and a structurally usable
-- pending, processing, or completed job without reading message content.
CREATE OR REPLACE FUNCTION public.has_active_amora_memory_job(
  p_couple_id uuid,
  p_user_id uuid,
  p_visibility text,
  p_to_message_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '5s'
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_MEMORY_JOB_PROOF_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;
  IF p_couple_id IS NULL
     OR p_user_id IS NULL
     OR p_to_message_id IS NULL
     OR p_visibility NOT IN (
       'shared', 'bride_private', 'groom_private'
     ) THEN
    RETURN false;
  END IF;

  RETURN public.has_current_amora_memory_consent(
      p_couple_id,
      p_visibility
    )
    AND EXISTS (
      SELECT 1
      FROM public.couples AS couple
      JOIN public.amora_memory_jobs AS job
        ON job.couple_id = couple.id
       AND job.visibility = p_visibility
       AND job.to_message_id = p_to_message_id
      JOIN public.amora_chat_request_claims AS claim
        ON claim.couple_id = job.couple_id
       AND claim.user_id = job.user_id
       AND claim.visibility = job.visibility
       AND claim.message_id = job.to_message_id
      JOIN public.chat_messages AS message
        ON message.id = claim.message_id
       AND message.couple_id = claim.couple_id
       AND message.visibility = claim.visibility
      JOIN public.amora_memory_settings AS setting
        ON setting.couple_id = message.couple_id
       AND setting.visibility = message.visibility
      WHERE couple.id = p_couple_id
        AND p_user_id IN (couple.bride_id, couple.groom_id)
        AND (
          p_visibility = 'shared'
          OR (
            p_visibility = 'bride_private'
            AND couple.bride_id = p_user_id
          )
          OR (
            p_visibility = 'groom_private'
            AND couple.groom_id = p_user_id
          )
        )
        AND job.user_id = p_user_id
        AND (
          (
            job.status = 'pending'
            AND job.claimed_at IS NULL
            AND job.completed_at IS NULL
            AND job.attempt_count < 5
          )
          OR (
            job.status = 'processing'
            AND job.claimed_at IS NOT NULL
            AND job.completed_at IS NULL
            AND job.attempt_count BETWEEN 1 AND 5
          )
          OR (
            job.status = 'completed'
            AND job.claimed_at IS NULL
            AND job.completed_at IS NOT NULL
          )
        )
        AND claim.status = 'completed'
        AND claim.completed_at IS NOT NULL
        AND message.sender_id IS NULL
        AND message.sender_type = 'ai'
        AND message.role = 'assistant'
        AND jsonb_typeof(message.metadata) = 'object'
        AND jsonb_typeof(message.metadata->'client_request_id') = 'string'
        AND message.metadata->>'client_request_id' = claim.request_key
        AND jsonb_typeof(message.metadata->'memory_eligible') = 'boolean'
        AND message.metadata->'memory_eligible' = 'true'::jsonb
        AND message.metadata->>'question_scope' IN (
          'W0_wedding_core', 'W1_wedding_adjacent'
        )
        AND message.metadata->>'target' IS DISTINCT FROM 'partner'
        AND setting.enabled = true
        AND setting.memory_reset_at IS NOT NULL
        AND message.created_at > setting.memory_reset_at
    );
END
$function$;

ALTER FUNCTION public.has_active_amora_memory_job(
  uuid, uuid, text, uuid
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.has_active_amora_memory_job(
  uuid, uuid, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_active_amora_memory_job(
  uuid, uuid, text, uuid
) TO service_role;

COMMENT ON FUNCTION public.has_active_amora_memory_job(
  uuid, uuid, text, uuid
) IS
  'Service-only exact proof of a current-consent, post-reset eligible AI source and structurally active/completed memory job; reads no message content.';

-- Preserve the public RPC name used by existing runtimes, but make conflict
-- handling status-aware. A failed unique row is a dead letter until this exact
-- current request safely requeues it. Consent/reset/source invalidation never
-- revives it. The consent advisory lock and job row lock make two retries
-- serialize: one returns requeued and later retries return duplicate.
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
  v_source_created_at timestamptz;
  v_enqueue_requested boolean;
  v_reset_at timestamptz;
  v_job_id uuid;
  v_job_user_id uuid;
  v_job_status text;
BEGIN
  IF p_couple_id IS NULL
     OR p_user_id IS NULL
     OR p_to_message_id IS NULL
     OR p_visibility NOT IN (
       'shared', 'bride_private', 'groom_private'
     ) THEN
    RAISE EXCEPTION 'AMORA_MEMORY_ENQUEUE_SCOPE_INVALID'
      USING ERRCODE = '42501';
  END IF;

  SELECT couple.bride_id, couple.groom_id
  INTO v_bride_id, v_groom_id
  FROM public.couples AS couple
  WHERE couple.id = p_couple_id
  FOR SHARE;

  IF NOT FOUND
     OR (
       p_user_id IS DISTINCT FROM v_bride_id
       AND p_user_id IS DISTINCT FROM v_groom_id
     )
     OR (
       p_visibility = 'bride_private'
       AND p_user_id IS DISTINCT FROM v_bride_id
     )
     OR (
       p_visibility = 'groom_private'
       AND p_user_id IS DISTINCT FROM v_groom_id
     ) THEN
    RAISE EXCEPTION 'AMORA_MEMORY_ENQUEUE_SCOPE_INVALID'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'hanbang:amora-memory-consent:'
        || p_couple_id::text || ':' || p_visibility,
      0
    )
  );

  IF NOT public.has_current_amora_memory_consent(
    p_couple_id,
    p_visibility
  ) THEN
    RETURN 'disabled';
  END IF;

  -- A pre-existing job is durable legacy enqueue intent even when the older
  -- message predates `memory_enqueue_requested`. Lock it before source
  -- validation so failed recovery and concurrent retries classify one state.
  SELECT job.id, job.user_id, job.status
  INTO v_job_id, v_job_user_id, v_job_status
  FROM public.amora_memory_jobs AS job
  WHERE job.couple_id = p_couple_id
    AND job.visibility = p_visibility
    AND job.to_message_id = p_to_message_id
  FOR UPDATE;

  -- Lock the exact completed claim and assistant row so privileged maintenance
  -- cannot change the source binding between validation and a terminal reset.
  SELECT
    message.created_at,
    jsonb_typeof(message.metadata->'memory_enqueue_requested') = 'boolean'
      AND message.metadata->'memory_enqueue_requested' = 'true'::jsonb
  INTO v_source_created_at, v_enqueue_requested
  FROM public.amora_chat_request_claims AS claim
  JOIN public.chat_messages AS message
    ON message.id = claim.message_id
   AND message.couple_id = claim.couple_id
   AND message.visibility = claim.visibility
  WHERE claim.couple_id = p_couple_id
    AND claim.user_id = p_user_id
    AND claim.visibility = p_visibility
    AND claim.message_id = p_to_message_id
    AND claim.status = 'completed'
    AND claim.completed_at IS NOT NULL
    AND message.sender_id IS NULL
    AND message.sender_type = 'ai'
    AND message.role = 'assistant'
    AND jsonb_typeof(message.metadata) = 'object'
    AND jsonb_typeof(message.metadata->'client_request_id') = 'string'
    AND message.metadata->>'client_request_id' = claim.request_key
    AND jsonb_typeof(message.metadata->'memory_eligible') = 'boolean'
    AND message.metadata->'memory_eligible' = 'true'::jsonb
    AND message.metadata->>'question_scope' IN (
      'W0_wedding_core', 'W1_wedding_adjacent'
    )
    AND message.metadata->>'target' IS DISTINCT FROM 'partner'
  FOR KEY SHARE OF claim, message;

  IF NOT FOUND THEN
    IF v_job_id IS NOT NULL THEN
      IF v_job_status <> 'completed' THEN
        UPDATE public.amora_memory_jobs
        SET status = CASE
              WHEN v_job_status = 'cancelled' THEN 'cancelled'
              ELSE 'failed'
            END,
            claimed_at = NULL,
            completed_at = COALESCE(completed_at, now()),
            last_error_code = 'SOURCE_REVALIDATION_FAILED',
            updated_at = now()
        WHERE id = v_job_id;
      END IF;
      RETURN 'dead_letter';
    END IF;

    RAISE EXCEPTION 'AMORA_MEMORY_ENQUEUE_SOURCE_INVALID'
      USING ERRCODE = '42501';
  END IF;

  IF v_enqueue_requested IS DISTINCT FROM true
     AND v_job_id IS NULL THEN
    RETURN 'not_requested';
  END IF;

  SELECT setting.memory_reset_at
  INTO v_reset_at
  FROM public.amora_memory_settings AS setting
  WHERE setting.couple_id = p_couple_id
    AND setting.visibility = p_visibility
    AND setting.enabled = true;

  IF NOT FOUND
     OR v_reset_at IS NULL
     OR v_source_created_at <= v_reset_at THEN
    RETURN 'before_boundary';
  END IF;

  IF v_job_id IS NULL THEN
    INSERT INTO public.amora_memory_jobs(
      couple_id,
      user_id,
      visibility,
      to_message_id
    ) VALUES (
      p_couple_id,
      p_user_id,
      p_visibility,
      p_to_message_id
    )
    ON CONFLICT (couple_id, visibility, to_message_id) DO NOTHING
    RETURNING id, user_id, status
    INTO v_job_id, v_job_user_id, v_job_status;

    IF FOUND THEN
      RETURN 'queued';
    END IF;

    -- A privileged direct insert may ignore the advisory-lock protocol. Lock
    -- and classify the winning row instead of guessing that its state is safe.
    SELECT job.id, job.user_id, job.status
    INTO v_job_id, v_job_user_id, v_job_status
    FROM public.amora_memory_jobs AS job
    WHERE job.couple_id = p_couple_id
      AND job.visibility = p_visibility
      AND job.to_message_id = p_to_message_id
    FOR UPDATE;
  END IF;

  IF v_job_status = 'failed' THEN
    UPDATE public.amora_memory_jobs
    SET user_id = p_user_id,
        status = 'pending',
        attempt_count = 0,
        continuation_count = 0,
        available_at = now(),
        claimed_at = NULL,
        completed_at = NULL,
        last_error_code = NULL,
        updated_at = now()
    WHERE id = v_job_id
      AND status = 'failed';
    RETURN 'requeued';
  END IF;

  IF v_job_status = 'cancelled' THEN
    UPDATE public.amora_memory_jobs
    SET claimed_at = NULL,
        completed_at = COALESCE(completed_at, now()),
        last_error_code = COALESCE(
          last_error_code,
          'CANCELLED_TERMINAL'
        ),
        updated_at = now()
    WHERE id = v_job_id
      AND status = 'cancelled';
    RETURN 'dead_letter';
  END IF;

  IF v_job_user_id IS DISTINCT FROM p_user_id THEN
    IF v_job_status <> 'completed' THEN
      UPDATE public.amora_memory_jobs
      SET status = 'failed',
          claimed_at = NULL,
          completed_at = now(),
          last_error_code = 'ACTOR_BINDING_MISMATCH',
          updated_at = now()
      WHERE id = v_job_id;
    END IF;
    RETURN 'dead_letter';
  END IF;

  IF v_job_status IN ('pending', 'processing', 'completed') THEN
    RETURN 'duplicate';
  END IF;

  RETURN 'dead_letter';
END
$function$;

ALTER FUNCTION public.enqueue_amora_memory_job(uuid, uuid, text, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enqueue_amora_memory_job(
  uuid, uuid, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_amora_memory_job(
  uuid, uuid, text, uuid
) TO service_role;

COMMENT ON FUNCTION public.enqueue_amora_memory_job(
  uuid, uuid, text, uuid
) IS
  'Service-only exact enqueue/requeue contract: current roster, visibility, consent, reset and eligible source are locked/revalidated; failed worker state is reset atomically, cancelled or invalid sources remain dead letters.';

-- Replace the 22000 drain without changing that pinned migration. A duplicate
-- only exits the outbox after the exact active/completed proof succeeds.
CREATE OR REPLACE FUNCTION public.repair_missing_amora_memory_jobs(
  p_limit integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  candidate record;
  enqueue_result text;
  terminal_reason_code text;
  retry_error_code text;
  scanned_count integer := 0;
  queued_count integer := 0;
  duplicate_count integer := 0;
  skipped_count integer := 0;
  failed_count integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_MEMORY_REPAIR_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'AMORA_MEMORY_REPAIR_LIMIT_INVALID'
      USING ERRCODE = '22023';
  END IF;

  FOR candidate IN
    SELECT repair.*
    FROM public.amora_memory_enqueue_repair_candidates AS repair
    WHERE repair.available_at <= now()
    ORDER BY repair.created_at, repair.couple_id, repair.request_key
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    scanned_count := scanned_count + 1;
    terminal_reason_code := NULL;
    retry_error_code := NULL;
    enqueue_result := NULL;
    BEGIN
      enqueue_result := public.enqueue_amora_memory_job(
        candidate.couple_id,
        candidate.user_id,
        candidate.visibility,
        candidate.to_message_id
      );

      CASE enqueue_result
        WHEN 'queued', 'requeued' THEN
          queued_count := queued_count + 1;
          DELETE FROM public.amora_memory_enqueue_repair_candidates AS repair
          WHERE repair.couple_id = candidate.couple_id
            AND repair.request_key = candidate.request_key;
        WHEN 'duplicate' THEN
          IF public.has_active_amora_memory_job(
            candidate.couple_id,
            candidate.user_id,
            candidate.visibility,
            candidate.to_message_id
          ) THEN
            duplicate_count := duplicate_count + 1;
            DELETE FROM public.amora_memory_enqueue_repair_candidates AS repair
            WHERE repair.couple_id = candidate.couple_id
              AND repair.request_key = candidate.request_key;
          ELSE
            failed_count := failed_count + 1;
            terminal_reason_code := 'DUPLICATE_NOT_ACTIVE';
          END IF;
        WHEN 'disabled', 'before_boundary' THEN
          skipped_count := skipped_count + 1;
          DELETE FROM public.amora_memory_enqueue_repair_candidates AS repair
          WHERE repair.couple_id = candidate.couple_id
            AND repair.request_key = candidate.request_key;
        WHEN 'not_requested' THEN
          skipped_count := skipped_count + 1;
          terminal_reason_code := 'ENQUEUE_INTENT_UNCONFIRMED';
        WHEN 'dead_letter' THEN
          failed_count := failed_count + 1;
          terminal_reason_code := CASE
            WHEN EXISTS (
              SELECT 1
              FROM public.amora_memory_jobs AS job
              WHERE job.couple_id = candidate.couple_id
                AND job.visibility = candidate.visibility
                AND job.to_message_id = candidate.to_message_id
                AND job.last_error_code = 'SOURCE_REVALIDATION_FAILED'
            ) THEN 'SOURCE_REVALIDATION_FAILED'
            ELSE 'JOB_TERMINAL_DEAD_LETTER'
          END;
        ELSE
          failed_count := failed_count + 1;
          terminal_reason_code := 'ENQUEUE_CONTRACT_INVALID';
      END CASE;
    EXCEPTION WHEN OTHERS THEN
      failed_count := failed_count + 1;
      IF SQLSTATE = '42501'
         AND SQLERRM = 'AMORA_MEMORY_ENQUEUE_SCOPE_INVALID' THEN
        terminal_reason_code := 'SCOPE_REVALIDATION_FAILED';
      ELSIF SQLSTATE = '42501'
         AND SQLERRM = 'AMORA_MEMORY_ENQUEUE_SOURCE_INVALID' THEN
        terminal_reason_code := 'SOURCE_REVALIDATION_FAILED';
      ELSIF SQLSTATE = '40001' THEN
        retry_error_code := 'ENQUEUE_SERIALIZATION_RETRY';
      ELSIF SQLSTATE = '40P01' THEN
        retry_error_code := 'ENQUEUE_DEADLOCK_RETRY';
      ELSIF SQLSTATE = '55P03' THEN
        retry_error_code := 'ENQUEUE_LOCK_RETRY';
      ELSIF SQLSTATE = '57014' THEN
        retry_error_code := 'ENQUEUE_TIMEOUT_RETRY';
      ELSIF SQLSTATE IN (
        '53300', '53400', '57P03', '58030'
      ) OR substring(SQLSTATE FROM 1 FOR 2) = '08' THEN
        retry_error_code := 'ENQUEUE_TRANSPORT_RETRY';
      ELSE
        terminal_reason_code := 'ENQUEUE_PERMANENT_ERROR';
      END IF;
    END;

    IF terminal_reason_code IS NOT NULL THEN
      INSERT INTO public.amora_memory_enqueue_repair_dead_letters (
        couple_id,
        request_key,
        user_id,
        visibility,
        to_message_id,
        claim_completed_at,
        candidate_created_at,
        repair_attempt_count,
        terminal_reason_code
      ) VALUES (
        candidate.couple_id,
        candidate.request_key,
        candidate.user_id,
        candidate.visibility,
        candidate.to_message_id,
        candidate.claim_completed_at,
        candidate.created_at,
        candidate.attempt_count,
        terminal_reason_code
      )
      ON CONFLICT (couple_id, request_key) DO UPDATE
      SET repair_attempt_count = GREATEST(
            public.amora_memory_enqueue_repair_dead_letters
              .repair_attempt_count,
            excluded.repair_attempt_count
          ),
          terminal_reason_code = excluded.terminal_reason_code,
          dead_lettered_at = now(),
          updated_at = now();

      DELETE FROM public.amora_memory_enqueue_repair_candidates AS repair
      WHERE repair.couple_id = candidate.couple_id
        AND repair.request_key = candidate.request_key;
    ELSIF retry_error_code IS NOT NULL THEN
      UPDATE public.amora_memory_enqueue_repair_candidates AS repair
      SET attempt_count = LEAST(repair.attempt_count + 1, 1000000),
          last_attempt_at = now(),
          available_at = now() + LEAST(
            interval '1 hour',
            interval '30 seconds' * (repair.attempt_count + 1)
          ),
          last_error_code = retry_error_code
      WHERE repair.couple_id = candidate.couple_id
        AND repair.request_key = candidate.request_key;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'scanned', scanned_count,
    'queued', queued_count,
    'duplicate', duplicate_count,
    'skipped', skipped_count,
    'failed', failed_count
  );
END
$function$;

ALTER FUNCTION public.repair_missing_amora_memory_jobs(integer)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.repair_missing_amora_memory_jobs(integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.repair_missing_amora_memory_jobs(integer)
  TO service_role;

COMMENT ON FUNCTION public.repair_missing_amora_memory_jobs(integer) IS
  'Bounded service-only memory repair drain; requeues exact failed rows, retries only transient SQL states, and ID-only dead-letters permanent or unproved outcomes.';

DO $postcheck$
BEGIN
  IF NOT has_function_privilege(
       'service_role',
       'public.has_active_amora_memory_job(uuid,uuid,text,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.has_active_amora_memory_job(uuid,uuid,text,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.has_active_amora_memory_job(uuid,uuid,text,uuid)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.enqueue_amora_memory_job(uuid,uuid,text,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.enqueue_amora_memory_job(uuid,uuid,text,uuid)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.repair_missing_amora_memory_jobs(integer)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.repair_missing_amora_memory_jobs(integer)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.capture_amora_memory_enqueue_repair_candidate()',
       'EXECUTE'
     )
     OR has_table_privilege(
       'service_role',
       'public.amora_memory_enqueue_repair_dead_letters',
       'SELECT'
     )
     OR has_table_privilege(
       'authenticated',
       'public.amora_memory_enqueue_repair_dead_letters',
       'SELECT'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_class AS relation
       WHERE relation.oid =
         'public.amora_memory_enqueue_repair_dead_letters'::regclass
         AND relation.relrowsecurity
         AND relation.relforcerowsecurity
     ) THEN
    RAISE EXCEPTION 'AMORA_MEMORY_JOB_RECOVERY_POSTCHECK_FAILED';
  END IF;
END
$postcheck$;

COMMIT;
