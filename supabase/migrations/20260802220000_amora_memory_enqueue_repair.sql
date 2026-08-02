BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- An assistant response and its durable chat claim are committed atomically,
-- but the runtime-gated memory enqueue happens immediately afterward. If that
-- RPC response is lost and the client reloads before retrying, the response is
-- still trustworthy while its queue row can be missing. Capture an ID-only
-- repair outbox row in that same database transaction, so recovery never needs
-- an unbounded scan or an index build on the live chat table.
CREATE TABLE public.amora_memory_enqueue_repair_candidates (
  couple_id uuid NOT NULL,
  request_key text NOT NULL CHECK (char_length(request_key) BETWEEN 1 AND 160),
  user_id uuid NOT NULL,
  visibility text NOT NULL CHECK (
    visibility IN ('shared', 'bride_private', 'groom_private')
  ),
  to_message_id uuid NOT NULL,
  claim_completed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (
    attempt_count BETWEEN 0 AND 1000000
  ),
  last_attempt_at timestamptz,
  last_error_code text CHECK (
    last_error_code IS NULL OR last_error_code ~ '^[A-Z0-9_]{1,64}$'
  ),
  PRIMARY KEY (couple_id, request_key),
  UNIQUE (couple_id, visibility, to_message_id),
  FOREIGN KEY (couple_id, request_key)
    REFERENCES public.amora_chat_request_claims(couple_id, request_key)
    ON DELETE CASCADE,
  FOREIGN KEY (to_message_id)
    REFERENCES public.chat_messages(id)
    ON DELETE CASCADE
);

CREATE INDEX amora_memory_enqueue_repair_available_idx
  ON public.amora_memory_enqueue_repair_candidates (
    available_at, created_at, couple_id, request_key
  );

ALTER TABLE public.amora_memory_enqueue_repair_candidates
  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.amora_memory_enqueue_repair_candidates
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.amora_memory_enqueue_repair_candidates IS
  'ID-only transactional outbox for exact eligible Amora assistant responses whose runtime enqueue may need repair; contains no message content.';

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
     OR NEW.visibility NOT IN ('shared', 'bride_private', 'groom_private') THEN
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

CREATE TRIGGER trg_capture_amora_memory_enqueue_repair_insert
  AFTER INSERT ON public.amora_chat_request_claims
  FOR EACH ROW
  EXECUTE FUNCTION public.capture_amora_memory_enqueue_repair_candidate();

CREATE TRIGGER trg_capture_amora_memory_enqueue_repair_complete
  AFTER UPDATE OF status, message_id, completed_at
  ON public.amora_chat_request_claims
  FOR EACH ROW
  EXECUTE FUNCTION public.capture_amora_memory_enqueue_repair_candidate();

-- The normal route enqueues immediately after the chat transaction commits.
-- A successful job insert acknowledges its outbox row in that job transaction,
-- keeping the repair backlog near zero. Never wait behind a cron worker that
-- already locked the candidate: that worker will observe the job as duplicate
-- and remove the row. NOWAIT avoids the candidate -> consent-lock -> job unique
-- versus consent-lock -> job insert -> candidate lock inversion.
CREATE OR REPLACE FUNCTION public.acknowledge_amora_memory_enqueue_repair_candidate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  candidate_request_key text;
BEGIN
  BEGIN
    SELECT repair.request_key INTO candidate_request_key
    FROM public.amora_memory_enqueue_repair_candidates AS repair
    WHERE repair.couple_id = NEW.couple_id
      AND repair.visibility = NEW.visibility
      AND repair.to_message_id = NEW.to_message_id
    FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RETURN NEW;
  END;

  IF candidate_request_key IS NOT NULL THEN
    DELETE FROM public.amora_memory_enqueue_repair_candidates AS repair
    WHERE repair.couple_id = NEW.couple_id
      AND repair.request_key = candidate_request_key;
  END IF;
  RETURN NEW;
END
$function$;

ALTER FUNCTION public.acknowledge_amora_memory_enqueue_repair_candidate()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.acknowledge_amora_memory_enqueue_repair_candidate()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_acknowledge_amora_memory_enqueue_repair_candidate
  AFTER INSERT ON public.amora_memory_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.acknowledge_amora_memory_enqueue_repair_candidate();

-- A failed immediate enqueue is safe to hide from the user only when this
-- exact durable outbox binding exists. Keep the proof service-only and bounded
-- by candidate/message keys; never read or return conversation content.
CREATE OR REPLACE FUNCTION public.has_amora_memory_enqueue_repair_candidate(
  p_couple_id uuid,
  p_user_id uuid,
  p_visibility text,
  p_to_message_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '5s'
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_MEMORY_REPAIR_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;
  IF p_couple_id IS NULL
     OR p_user_id IS NULL
     OR p_to_message_id IS NULL
     OR p_visibility NOT IN ('shared', 'bride_private', 'groom_private') THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
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
      AND (
        EXISTS (
          SELECT 1
          FROM public.amora_memory_enqueue_repair_candidates AS repair
          WHERE repair.couple_id = claim.couple_id
            AND repair.request_key = claim.request_key
            AND repair.user_id = claim.user_id
            AND repair.visibility = claim.visibility
            AND repair.to_message_id = claim.message_id
        )
        OR EXISTS (
          SELECT 1
          FROM public.amora_memory_jobs AS job
          WHERE job.couple_id = claim.couple_id
            AND job.user_id = claim.user_id
            AND job.visibility = claim.visibility
            AND job.to_message_id = claim.message_id
            AND job.status IN ('pending', 'processing', 'completed')
        )
      )
  );
END
$function$;

ALTER FUNCTION public.has_amora_memory_enqueue_repair_candidate(
  uuid, uuid, text, uuid
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.has_amora_memory_enqueue_repair_candidate(
  uuid, uuid, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_amora_memory_enqueue_repair_candidate(
  uuid, uuid, text, uuid
) TO service_role;

COMMENT ON FUNCTION public.has_amora_memory_enqueue_repair_candidate(
  uuid, uuid, text, uuid
) IS
  'Service-only exact proof that a completed eligible AI response has an ID-only repair candidate or an already durable active/completed memory job; reads no message content.';

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

  -- The outbox primary key is the durable cursor. Lock at most p_limit rows;
  -- concurrent cron invocations take disjoint pages. Terminal results remove
  -- the row, while exceptions and unknown future results remain with bounded
  -- backoff so one poison row cannot block the rest of the queue.
  FOR candidate IN
    SELECT repair.*
    FROM public.amora_memory_enqueue_repair_candidates AS repair
    WHERE repair.available_at <= now()
    ORDER BY repair.created_at, repair.couple_id, repair.request_key
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    scanned_count := scanned_count + 1;
    BEGIN
      enqueue_result := NULL;

      -- Revalidate the exact immutable-looking source binding in case a
      -- privileged maintenance action changed either row after capture. The
      -- enqueue RPC remains authoritative for the current roster, visibility,
      -- consent, reset boundary and canonical AI-assistant source row.
      IF NOT EXISTS (
        SELECT 1
        FROM public.amora_chat_request_claims AS claim
        JOIN public.chat_messages AS message
          ON message.id = claim.message_id
         AND message.couple_id = claim.couple_id
         AND message.visibility = claim.visibility
        WHERE claim.couple_id = candidate.couple_id
          AND claim.request_key = candidate.request_key
          AND claim.user_id = candidate.user_id
          AND claim.visibility = candidate.visibility
          AND claim.status = 'completed'
          AND claim.message_id = candidate.to_message_id
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
      ) THEN
        enqueue_result := 'source_invalid';
      ELSE
        enqueue_result := public.enqueue_amora_memory_job(
          candidate.couple_id,
          candidate.user_id,
          candidate.visibility,
          candidate.to_message_id
        );
      END IF;

      CASE enqueue_result
        WHEN 'queued' THEN
          queued_count := queued_count + 1;
          DELETE FROM public.amora_memory_enqueue_repair_candidates AS repair
          WHERE repair.couple_id = candidate.couple_id
            AND repair.request_key = candidate.request_key;
        WHEN 'duplicate' THEN
          duplicate_count := duplicate_count + 1;
          DELETE FROM public.amora_memory_enqueue_repair_candidates AS repair
          WHERE repair.couple_id = candidate.couple_id
            AND repair.request_key = candidate.request_key;
        WHEN 'disabled', 'before_boundary' THEN
          skipped_count := skipped_count + 1;
          DELETE FROM public.amora_memory_enqueue_repair_candidates AS repair
          WHERE repair.couple_id = candidate.couple_id
            AND repair.request_key = candidate.request_key;
        ELSE
          failed_count := failed_count + 1;
          UPDATE public.amora_memory_enqueue_repair_candidates AS repair
          SET attempt_count = LEAST(repair.attempt_count + 1, 1000000),
              last_attempt_at = now(),
              available_at = now() + LEAST(
                interval '1 hour',
                interval '30 seconds' * (repair.attempt_count + 1)
              ),
              last_error_code = CASE
                WHEN enqueue_result = 'source_invalid'
                  THEN 'SOURCE_REVALIDATION_FAILED'
                ELSE 'ENQUEUE_UNKNOWN_RESULT'
              END
          WHERE repair.couple_id = candidate.couple_id
            AND repair.request_key = candidate.request_key;
      END CASE;
    EXCEPTION WHEN OTHERS THEN
      failed_count := failed_count + 1;
      UPDATE public.amora_memory_enqueue_repair_candidates AS repair
      SET attempt_count = LEAST(repair.attempt_count + 1, 1000000),
          last_attempt_at = now(),
          available_at = now() + LEAST(
            interval '1 hour',
            interval '30 seconds' * (repair.attempt_count + 1)
          ),
          last_error_code = 'ENQUEUE_EXCEPTION'
      WHERE repair.couple_id = candidate.couple_id
        AND repair.request_key = candidate.request_key;
    END;
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
  'Bounded service-only drain of the ID-only W0/W1 enqueue repair outbox; reuses current roster, visibility, consent, reset, and source validation in enqueue_amora_memory_job.';

DO $postcheck$
BEGIN
  IF NOT has_function_privilege(
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
       'anon',
       'public.repair_missing_amora_memory_jobs(integer)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.has_amora_memory_enqueue_repair_candidate(uuid,uuid,text,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.has_amora_memory_enqueue_repair_candidate(uuid,uuid,text,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.has_amora_memory_enqueue_repair_candidate(uuid,uuid,text,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.capture_amora_memory_enqueue_repair_candidate()',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.acknowledge_amora_memory_enqueue_repair_candidate()',
       'EXECUTE'
     )
     OR has_table_privilege(
       'service_role',
       'public.amora_memory_enqueue_repair_candidates',
       'SELECT'
     )
     OR has_table_privilege(
       'authenticated',
       'public.amora_memory_enqueue_repair_candidates',
       'SELECT'
     )
     OR (
       SELECT count(*)
       FROM pg_catalog.pg_trigger AS trigger_record
       JOIN pg_catalog.pg_proc AS procedure_record
         ON procedure_record.oid = trigger_record.tgfoid
       WHERE trigger_record.tgrelid =
         'public.amora_chat_request_claims'::regclass
         AND trigger_record.tgname IN (
           'trg_capture_amora_memory_enqueue_repair_insert',
           'trg_capture_amora_memory_enqueue_repair_complete'
         )
         AND NOT trigger_record.tgisinternal
         AND trigger_record.tgenabled = 'O'
         AND procedure_record.prosecdef
      ) <> 2
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_trigger AS trigger_record
       JOIN pg_catalog.pg_proc AS procedure_record
         ON procedure_record.oid = trigger_record.tgfoid
       WHERE trigger_record.tgrelid = 'public.amora_memory_jobs'::regclass
         AND trigger_record.tgname =
           'trg_acknowledge_amora_memory_enqueue_repair_candidate'
         AND NOT trigger_record.tgisinternal
         AND trigger_record.tgenabled = 'O'
         AND procedure_record.prosecdef
     )
  THEN
    RAISE EXCEPTION 'AMORA_MEMORY_REPAIR_POSTCHECK_FAILED';
  END IF;
END
$postcheck$;

COMMIT;
