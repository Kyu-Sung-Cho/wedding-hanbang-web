BEGIN;

-- Dual-write remains storage-only in this migration. Provider reads and the
-- runtime feature flag are intentionally unchanged.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

LOCK TABLE public.couples, public.conversation_segments,
  public.chat_messages, public.chat_summaries
  IN SHARE ROW EXCLUSIVE MODE;

-- Foundation reads are still disabled at this rollout stage. Seeing more than
-- one pre-existing segment beside an unbound legacy row therefore means the
-- row's historical boundary cannot be reconstructed without guessing.
DO $backfill_ambiguity_guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT message.couple_id, message.visibility
      FROM public.chat_messages AS message
      WHERE message.segment_id IS NULL
      UNION
      SELECT summary.couple_id, summary.visibility
      FROM public.chat_summaries AS summary
      WHERE summary.segment_id IS NULL
    ) AS legacy_scope
    JOIN public.conversation_segments AS segment
      ON segment.couple_id = legacy_scope.couple_id
     AND segment.visibility = legacy_scope.visibility
    GROUP BY legacy_scope.couple_id, legacy_scope.visibility
    HAVING count(*) > 1
       OR count(*) FILTER (WHERE segment.status = 'active') <> 1
  ) THEN
    RAISE EXCEPTION 'AMORA_SEGMENT_BACKFILL_AMBIGUOUS'
      USING ERRCODE = '55000',
            HINT = 'Resolve the affected lane on an isolated clone before applying dual-write.';
  END IF;
END;
$backfill_ambiguity_guard$;

-- Every currently addressable couple receives one server-owned active segment
-- per available lane. The role-bound insert validator from the foundation
-- migration remains the authority for starter and private-owner correctness.
INSERT INTO public.conversation_segments (
  couple_id,
  visibility,
  owner_user_id,
  status,
  started_by,
  start_reason,
  started_at,
  closed_at,
  previous_segment_id,
  operation_key,
  created_at
)
SELECT
  couple.id,
  'shared',
  NULL,
  'active',
  COALESCE(couple.bride_id, couple.groom_id),
  'migration',
  transaction_timestamp(),
  NULL,
  NULL,
  md5(
    'amora-conversation-segment-dual-write:v1:'
      || couple.id::text || ':shared'
  )::uuid,
  transaction_timestamp()
FROM public.couples AS couple
WHERE COALESCE(couple.bride_id, couple.groom_id) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.conversation_segments AS segment
    WHERE segment.couple_id = couple.id
      AND segment.visibility = 'shared'
      AND segment.status = 'active'
  );

INSERT INTO public.conversation_segments (
  couple_id,
  visibility,
  owner_user_id,
  status,
  started_by,
  start_reason,
  started_at,
  closed_at,
  previous_segment_id,
  operation_key,
  created_at
)
SELECT
  couple.id,
  'bride_private',
  couple.bride_id,
  'active',
  couple.bride_id,
  'migration',
  transaction_timestamp(),
  NULL,
  NULL,
  md5(
    'amora-conversation-segment-dual-write:v1:'
      || couple.id::text || ':bride_private'
  )::uuid,
  transaction_timestamp()
FROM public.couples AS couple
WHERE couple.bride_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.conversation_segments AS segment
    WHERE segment.couple_id = couple.id
      AND segment.visibility = 'bride_private'
      AND segment.status = 'active'
  );

INSERT INTO public.conversation_segments (
  couple_id,
  visibility,
  owner_user_id,
  status,
  started_by,
  start_reason,
  started_at,
  closed_at,
  previous_segment_id,
  operation_key,
  created_at
)
SELECT
  couple.id,
  'groom_private',
  couple.groom_id,
  'active',
  couple.groom_id,
  'migration',
  transaction_timestamp(),
  NULL,
  NULL,
  md5(
    'amora-conversation-segment-dual-write:v1:'
      || couple.id::text || ':groom_private'
  )::uuid,
  transaction_timestamp()
FROM public.couples AS couple
WHERE couple.groom_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.conversation_segments AS segment
    WHERE segment.couple_id = couple.id
      AND segment.visibility = 'groom_private'
      AND segment.status = 'active'
  );

UPDATE public.chat_messages AS message
SET segment_id = segment.id
FROM public.conversation_segments AS segment
WHERE message.segment_id IS NULL
  AND segment.couple_id = message.couple_id
  AND segment.visibility = message.visibility
  AND segment.status = 'active';

-- Prefer the exact terminal message when a legacy summary has a cursor. A
-- cursor-less legacy summary belongs to the single migration segment for its
-- lane because no user-visible segment transition existed before this rollout.
UPDATE public.chat_summaries AS summary
SET segment_id = message.segment_id
FROM public.chat_messages AS message
WHERE summary.segment_id IS NULL
  AND summary.to_message_id IS NOT NULL
  AND message.id::text = summary.to_message_id
  AND message.couple_id = summary.couple_id
  AND message.visibility = summary.visibility;

UPDATE public.chat_summaries AS summary
SET segment_id = segment.id
FROM public.conversation_segments AS segment
WHERE summary.segment_id IS NULL
  AND segment.couple_id = summary.couple_id
  AND segment.visibility = summary.visibility
  AND segment.status = 'active';

DO $summary_backfill_guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.chat_summaries AS summary
    LEFT JOIN public.chat_messages AS terminal_message
      ON terminal_message.id::text = summary.to_message_id
     AND terminal_message.couple_id = summary.couple_id
     AND terminal_message.visibility = summary.visibility
    LEFT JOIN public.chat_messages AS first_message
      ON first_message.id::text = summary.from_message_id
     AND first_message.couple_id = summary.couple_id
     AND first_message.visibility = summary.visibility
    WHERE (
      summary.to_message_id IS NOT NULL
      AND (
        terminal_message.id IS NULL
        OR terminal_message.segment_id IS NULL
        OR summary.segment_id IS DISTINCT FROM terminal_message.segment_id
      )
    )
    OR (
      summary.from_message_id IS NOT NULL
      AND (
        summary.to_message_id IS NULL
        OR first_message.id IS NULL
        OR first_message.segment_id IS NULL
        OR summary.segment_id IS DISTINCT FROM first_message.segment_id
      )
    )
  ) THEN
    RAISE EXCEPTION 'AMORA_SEGMENT_SUMMARY_BACKFILL_INVALID'
      USING ERRCODE = '55000',
            HINT = 'Regenerate the affected summary inside one exact segment before retrying.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.chat_messages WHERE segment_id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.chat_summaries WHERE segment_id IS NULL
  ) THEN
    RAISE EXCEPTION 'AMORA_SEGMENT_BACKFILL_INCOMPLETE'
      USING ERRCODE = '55000';
  END IF;
END;
$summary_backfill_guard$;

CREATE OR REPLACE FUNCTION public.ensure_amora_initial_conversation_segments()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.bride_id IS NOT DISTINCT FROM OLD.bride_id
     AND NEW.groom_id IS NOT DISTINCT FROM OLD.groom_id THEN
    RETURN NEW;
  END IF;

  IF NEW.bride_id IS NOT NULL
     AND NEW.bride_id IS NOT DISTINCT FROM NEW.groom_id THEN
    RAISE EXCEPTION 'AMORA_SEGMENT_COUPLE_ROSTER_INVALID'
      USING ERRCODE = '22023';
  END IF;

  IF COALESCE(NEW.bride_id, NEW.groom_id) IS NOT NULL THEN
    INSERT INTO public.conversation_segments (
      couple_id, visibility, owner_user_id, status, started_by,
      start_reason, started_at, operation_key, created_at
    )
    SELECT
      NEW.id, 'shared', NULL, 'active',
      COALESCE(NEW.bride_id, NEW.groom_id), 'initial', v_now,
      md5(
        'amora-conversation-segment-initial:v1:'
          || NEW.id::text || ':shared'
      )::uuid,
      v_now
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.conversation_segments AS segment
      WHERE segment.couple_id = NEW.id
        AND segment.visibility = 'shared'
        AND segment.status = 'active'
    )
    ON CONFLICT DO NOTHING;
  END IF;

  IF NEW.bride_id IS NOT NULL THEN
    INSERT INTO public.conversation_segments (
      couple_id, visibility, owner_user_id, status, started_by,
      start_reason, started_at, operation_key, created_at
    )
    SELECT
      NEW.id, 'bride_private', NEW.bride_id, 'active', NEW.bride_id,
      'initial', v_now,
      md5(
        'amora-conversation-segment-initial:v1:'
          || NEW.id::text || ':bride_private'
      )::uuid,
      v_now
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.conversation_segments AS segment
      WHERE segment.couple_id = NEW.id
        AND segment.visibility = 'bride_private'
        AND segment.status = 'active'
    )
    ON CONFLICT DO NOTHING;
  END IF;

  IF NEW.groom_id IS NOT NULL THEN
    INSERT INTO public.conversation_segments (
      couple_id, visibility, owner_user_id, status, started_by,
      start_reason, started_at, operation_key, created_at
    )
    SELECT
      NEW.id, 'groom_private', NEW.groom_id, 'active', NEW.groom_id,
      'initial', v_now,
      md5(
        'amora-conversation-segment-initial:v1:'
          || NEW.id::text || ':groom_private'
      )::uuid,
      v_now
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.conversation_segments AS segment
      WHERE segment.couple_id = NEW.id
        AND segment.visibility = 'groom_private'
        AND segment.status = 'active'
    )
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.ensure_amora_initial_conversation_segments()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.ensure_amora_initial_conversation_segments()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_zz_ensure_amora_initial_conversation_segments
  ON public.couples;
CREATE TRIGGER trg_zz_ensure_amora_initial_conversation_segments
  AFTER INSERT OR UPDATE OF bride_id, groom_id ON public.couples
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_amora_initial_conversation_segments();

CREATE OR REPLACE FUNCTION public.assign_amora_conversation_message_segment()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_bride_id uuid;
  v_groom_id uuid;
  v_expected_owner_id uuid;
  v_reply_source_id uuid;
  v_source public.chat_messages%ROWTYPE;
  v_segment public.conversation_segments%ROWTYPE;
BEGIN
  IF NEW.couple_id IS NULL
     OR NEW.visibility IS NULL
     OR NEW.visibility NOT IN (
       'shared', 'bride_private', 'groom_private'
     ) THEN
    RAISE EXCEPTION 'AMORA_SEGMENT_MESSAGE_SCOPE_INVALID'
      USING ERRCODE = '22023';
  END IF;

  -- Couple -> source-message is the repository-wide membership/delete lock
  -- order. FOR SHARE still conflicts with the segment-start RPC's FOR UPDATE,
  -- while allowing unrelated message inserts to proceed concurrently.
  SELECT couple.bride_id, couple.groom_id
    INTO v_bride_id, v_groom_id
    FROM public.couples AS couple
   WHERE couple.id = NEW.couple_id
   FOR SHARE;

  IF NOT FOUND
     OR (v_bride_id IS NULL AND v_groom_id IS NULL)
     OR (
       v_bride_id IS NOT NULL
       AND v_bride_id IS NOT DISTINCT FROM v_groom_id
     ) THEN
    RAISE EXCEPTION 'AMORA_SEGMENT_MESSAGE_COUPLE_INVALID'
      USING ERRCODE = '42501';
  END IF;

  IF (
       NEW.sender_type = 'bride'
       AND (
         NEW.sender_id IS DISTINCT FROM v_bride_id
         OR NEW.role IS DISTINCT FROM 'user'
         OR NEW.visibility = 'groom_private'
       )
     )
     OR (
       NEW.sender_type = 'groom'
       AND (
         NEW.sender_id IS DISTINCT FROM v_groom_id
         OR NEW.role IS DISTINCT FROM 'user'
         OR NEW.visibility = 'bride_private'
       )
     )
     OR (
       NEW.sender_type = 'ai'
       AND (
         NEW.sender_id IS NOT NULL
         OR NEW.role IS DISTINCT FROM 'assistant'
       )
     )
     OR NEW.sender_type IS NULL
     OR NEW.sender_type NOT IN ('bride', 'groom', 'ai') THEN
    RAISE EXCEPTION 'AMORA_SEGMENT_MESSAGE_ACTOR_INVALID'
      USING ERRCODE = '42501';
  END IF;

  -- A provider completion is causally owned by the exact user row it answers,
  -- even when a new active segment commits while the provider is in flight.
  -- The roster lock is retained, but the assignment never reads or substitutes
  -- the new active segment for the immutable source segment.
  IF NEW.sender_type = 'ai'
     AND COALESCE(NEW.metadata, '{}'::jsonb)
       ? 'in_reply_to_user_message_id' THEN
    IF jsonb_typeof(
         NEW.metadata -> 'in_reply_to_user_message_id'
       ) IS DISTINCT FROM 'string'
       OR NEW.metadata ->> 'in_reply_to_user_message_id' !~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    THEN
      RAISE EXCEPTION 'AMORA_SEGMENT_REPLY_SOURCE_INVALID'
        USING ERRCODE = '22023';
    END IF;

    v_reply_source_id := (
      NEW.metadata ->> 'in_reply_to_user_message_id'
    )::uuid;

    SELECT message.*
      INTO v_source
      FROM public.chat_messages AS message
     WHERE message.id = v_reply_source_id
     FOR SHARE;

    IF NOT FOUND
       OR v_source.couple_id IS DISTINCT FROM NEW.couple_id
       OR v_source.visibility IS DISTINCT FROM NEW.visibility
       OR v_source.sender_type IS NULL
       OR v_source.sender_type NOT IN ('bride', 'groom')
       OR v_source.role IS DISTINCT FROM 'user'
       OR COALESCE(v_source.metadata ->> 'target', '') = 'partner'
       OR v_source.segment_id IS NULL THEN
      RAISE EXCEPTION 'AMORA_SEGMENT_REPLY_SCOPE_INVALID'
        USING ERRCODE = '42501';
    END IF;

    IF (
         (
           v_source.sender_type = 'bride'
           AND v_source.sender_id IS NOT DISTINCT FROM v_bride_id
         )
         OR (
           v_source.sender_type = 'groom'
           AND v_source.sender_id IS NOT DISTINCT FROM v_groom_id
         )
       ) IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'AMORA_SEGMENT_REPLY_OWNER_INVALID'
        USING ERRCODE = '42501';
    END IF;

    SELECT segment.*
      INTO v_segment
      FROM public.conversation_segments AS segment
     WHERE segment.id = v_source.segment_id
       AND segment.couple_id = NEW.couple_id
       AND segment.visibility = NEW.visibility;

    IF NOT FOUND
       OR v_segment.owner_user_id IS DISTINCT FROM (
         CASE
           WHEN NEW.visibility = 'bride_private' THEN v_bride_id
           WHEN NEW.visibility = 'groom_private' THEN v_groom_id
           ELSE NULL
         END
       ) THEN
      RAISE EXCEPTION 'AMORA_SEGMENT_REPLY_SEGMENT_INVALID'
        USING ERRCODE = '42501';
    END IF;

    NEW.segment_id := v_source.segment_id;
    RETURN NEW;
  END IF;

  IF NEW.visibility = 'bride_private' THEN
    IF v_bride_id IS NULL THEN
      RAISE EXCEPTION 'AMORA_SEGMENT_MESSAGE_PRIVATE_OWNER_MISSING'
        USING ERRCODE = '42501';
    END IF;
    v_expected_owner_id := v_bride_id;
  ELSIF NEW.visibility = 'groom_private' THEN
    IF v_groom_id IS NULL THEN
      RAISE EXCEPTION 'AMORA_SEGMENT_MESSAGE_PRIVATE_OWNER_MISSING'
        USING ERRCODE = '42501';
    END IF;
    v_expected_owner_id := v_groom_id;
  ELSE
    v_expected_owner_id := NULL;
  END IF;

  SELECT segment.*
    INTO v_segment
    FROM public.conversation_segments AS segment
   WHERE segment.couple_id = NEW.couple_id
     AND segment.visibility = NEW.visibility
     AND segment.status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_SEGMENT_MESSAGE_ACTIVE_MISSING'
      USING ERRCODE = '55000';
  END IF;

  IF v_segment.owner_user_id IS DISTINCT FROM v_expected_owner_id THEN
    RAISE EXCEPTION 'AMORA_SEGMENT_MESSAGE_OWNER_MISMATCH'
      USING ERRCODE = '42501';
  END IF;

  -- Ignore every caller-provided value. The database, not a web/mobile client
  -- or service writer, owns the durable message-to-segment assignment.
  NEW.segment_id := v_segment.id;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.assign_amora_conversation_message_segment()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.assign_amora_conversation_message_segment()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_assign_amora_conversation_message_segment
  ON public.chat_messages;
DROP TRIGGER IF EXISTS trg_zz_assign_amora_conversation_message_segment
  ON public.chat_messages;
CREATE TRIGGER trg_zz_assign_amora_conversation_message_segment
  BEFORE INSERT ON public.chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_amora_conversation_message_segment();

CREATE OR REPLACE FUNCTION public.assign_amora_conversation_summary_segment()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_from_message_id uuid;
  v_to_message_id uuid;
  v_from_segment_id uuid;
  v_to_segment_id uuid;
BEGIN
  IF NEW.couple_id IS NULL
     OR NEW.visibility IS NULL
     OR NEW.visibility NOT IN (
       'shared', 'bride_private', 'groom_private'
     )
     OR NEW.to_message_id IS NULL
     OR NEW.to_message_id !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR (
       NEW.from_message_id IS NOT NULL
       AND NEW.from_message_id !~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     ) THEN
    RAISE EXCEPTION 'AMORA_SEGMENT_SUMMARY_CURSOR_INVALID'
      USING ERRCODE = '22023';
  END IF;

  v_to_message_id := NEW.to_message_id::uuid;
  SELECT message.segment_id
    INTO v_to_segment_id
    FROM public.chat_messages AS message
   WHERE message.id = v_to_message_id
     AND message.couple_id = NEW.couple_id
     AND message.visibility = NEW.visibility
   FOR SHARE;

  IF NOT FOUND OR v_to_segment_id IS NULL THEN
    RAISE EXCEPTION 'AMORA_SEGMENT_SUMMARY_SCOPE_INVALID'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.from_message_id IS NOT NULL THEN
    v_from_message_id := NEW.from_message_id::uuid;
    SELECT message.segment_id
      INTO v_from_segment_id
      FROM public.chat_messages AS message
     WHERE message.id = v_from_message_id
       AND message.couple_id = NEW.couple_id
       AND message.visibility = NEW.visibility
     FOR SHARE;

    IF NOT FOUND OR v_from_segment_id IS NULL THEN
      RAISE EXCEPTION 'AMORA_SEGMENT_SUMMARY_SCOPE_INVALID'
        USING ERRCODE = '42501';
    END IF;

    IF v_from_segment_id IS DISTINCT FROM v_to_segment_id THEN
      RAISE EXCEPTION 'AMORA_SEGMENT_SUMMARY_BOUNDARY_INVALID'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- As with messages, a caller-provided segment is never authoritative.
  NEW.segment_id := v_to_segment_id;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.assign_amora_conversation_summary_segment()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.assign_amora_conversation_summary_segment()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_assign_amora_conversation_summary_segment
  ON public.chat_summaries;
DROP TRIGGER IF EXISTS trg_zz_assign_amora_conversation_summary_segment
  ON public.chat_summaries;
CREATE TRIGGER trg_zz_assign_amora_conversation_summary_segment
  BEFORE INSERT ON public.chat_summaries
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_amora_conversation_summary_segment();

CREATE OR REPLACE FUNCTION public.prevent_amora_conversation_scope_rewrite()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '5s'
AS $function$
BEGIN
  IF NEW.couple_id IS DISTINCT FROM OLD.couple_id
     OR NEW.visibility IS DISTINCT FROM OLD.visibility
     OR NEW.segment_id IS DISTINCT FROM OLD.segment_id THEN
    IF TG_TABLE_NAME = 'chat_messages' THEN
      RAISE EXCEPTION 'AMORA_SEGMENT_MESSAGE_SCOPE_IMMUTABLE'
        USING ERRCODE = '22023';
    END IF;
    RAISE EXCEPTION 'AMORA_SEGMENT_SUMMARY_SCOPE_IMMUTABLE'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.prevent_amora_conversation_scope_rewrite()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.prevent_amora_conversation_scope_rewrite()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_zz_guard_amora_message_segment_scope
  ON public.chat_messages;
CREATE TRIGGER trg_zz_guard_amora_message_segment_scope
  BEFORE UPDATE OF couple_id, visibility, segment_id
  ON public.chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_amora_conversation_scope_rewrite();

DROP TRIGGER IF EXISTS trg_zz_guard_amora_summary_segment_scope
  ON public.chat_summaries;
CREATE TRIGGER trg_zz_guard_amora_summary_segment_scope
  BEFORE UPDATE OF couple_id, visibility, segment_id
  ON public.chat_summaries
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_amora_conversation_scope_rewrite();

ALTER TABLE public.chat_messages
  ALTER COLUMN segment_id SET NOT NULL;
ALTER TABLE public.chat_summaries
  ALTER COLUMN segment_id SET NOT NULL;

-- Storage dual-write ships before segment-scoped provider reads. Do not let a
-- client create invisible boundaries until the guarded runtime cutover grants
-- this Interface again through its server-owned path.
REVOKE EXECUTE ON FUNCTION public.start_amora_conversation_segment(
  uuid, text, uuid, uuid, text
) FROM authenticated;

COMMENT ON COLUMN public.chat_messages.segment_id IS
  'Required server-owned Amora segment link. Provider reads remain legacy until the separate runtime cutover.';
COMMENT ON COLUMN public.chat_summaries.segment_id IS
  'Required server-owned Amora segment link derived from one exact message range.';

COMMIT;
