-- Long-term memory may cite only a canonical server-authored Amora reply that
-- explicitly binds a W0/W1-eligible user message. The application also runs
-- the current classifier over raw user text; this database fence independently
-- prevents malformed, unlinked, and server-declared W2-W5 rows from persisting.
-- This migration intentionally sorts before the fleet-gated chat INSERT RLS
-- boundary so the memory fence can ship while legacy mobile clients still run.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Refuse to overwrite a drifted or newer incompatible memory engine. A normal
-- rerun passes because both the original v2 function and this replacement keep
-- these consent, reset, deletion, and correction contracts.
DO $amora_memory_source_scope_precondition$
DECLARE
  v_function regprocedure := to_regprocedure(
    'public.upsert_amora_memory_node(uuid,text,text,text,text,text,text,numeric,text,uuid,jsonb)'
  );
  v_definition text;
BEGIN
  IF to_regclass('public.chat_messages') IS NULL
     OR to_regclass('public.couples') IS NULL
     OR to_regclass('public.amora_memory_settings') IS NULL
     OR to_regclass('public.decision_nodes') IS NULL
     OR v_function IS NULL THEN
    RAISE EXCEPTION 'AMORA_MEMORY_SOURCE_SCOPE_PRECONDITION_INVALID';
  END IF;

  IF NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public.chat_messages'::regclass
         AND attname = 'metadata'
         AND atttypid = 'jsonb'::regtype
         AND attnum > 0
         AND NOT attisdropped
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public.chat_messages'::regclass
         AND attname = 'created_at'
         AND atttypid = 'timestamp with time zone'::regtype
         AND attnum > 0
         AND NOT attisdropped
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public.decision_nodes'::regclass
         AND attname = 'metadata'
         AND atttypid = 'jsonb'::regtype
         AND attnum > 0
         AND NOT attisdropped
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public.decision_nodes'::regclass
         AND attname = 'source_message_id'
         AND atttypid = 'uuid'::regtype
         AND attnum > 0
         AND NOT attisdropped
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public.amora_memory_settings'::regclass
         AND attname = 'memory_reset_at'
         AND atttypid = 'timestamp with time zone'::regtype
         AND attnum > 0
         AND NOT attisdropped
     ) THEN
    RAISE EXCEPTION 'AMORA_MEMORY_SOURCE_SCOPE_PRECONDITION_INVALID';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_function) INTO v_definition;
  IF position('has_current_amora_memory_consent' IN v_definition) = 0
     OR position('memory_reset_at' IN v_definition) = 0
     OR position('user_deleted' IN v_definition) = 0
     OR position('user_corrected' IN v_definition) = 0
     OR position('AMORA_MEMORY_SOURCE_INVALID' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'AMORA_MEMORY_SOURCE_SCOPE_PRECONDITION_INVALID';
  END IF;
END
$amora_memory_source_scope_precondition$;

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

  -- The source must be a real couple member's user row in the same privacy
  -- scope, after the latest reset, and must be linked by a later canonical
  -- server AI assistant row that declares exact W0/W1 memory eligibility.
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
      AND EXISTS (
        SELECT 1
        FROM public.chat_messages AS assistant
        WHERE assistant.couple_id = message.couple_id
          AND assistant.visibility = message.visibility
          AND assistant.sender_type = 'ai'
          AND assistant.role = 'assistant'
          AND assistant.sender_id IS NULL
          AND assistant.metadata ->> 'in_reply_to_user_message_id' = message.id::text
          AND assistant.metadata ->> 'question_scope' IN (
            'W0_wedding_core',
            'W1_wedding_adjacent'
          )
          AND jsonb_typeof(assistant.metadata -> 'memory_eligible') = 'boolean'
          AND assistant.metadata -> 'memory_eligible' = 'true'::jsonb
          AND (
            assistant.created_at > message.created_at
            OR (
              assistant.created_at = message.created_at
              AND assistant.id > message.id
            )
          )
      )
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

COMMENT ON FUNCTION public.upsert_amora_memory_node(
  uuid, text, text, text, text, text, text, numeric, text, uuid, jsonb
) IS 'Upserts consented Amora memory only from a linked canonical W0/W1 server-AI source.';

REVOKE ALL ON FUNCTION public.upsert_amora_memory_node(
  uuid, text, text, text, text, text, text, numeric, text, uuid, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_amora_memory_node(
  uuid, text, text, text, text, text, text, numeric, text, uuid, jsonb
) TO service_role;

COMMIT;
