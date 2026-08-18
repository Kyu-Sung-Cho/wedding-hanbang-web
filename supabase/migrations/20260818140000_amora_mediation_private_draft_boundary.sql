-- Shared mediation is no longer an AI-write side effect. A proposal may enter
-- the couple-visible lane only by referencing the exact requester-owned
-- private draft that the requester reviewed and explicitly sent.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.enforce_amora_mediation_private_draft_boundary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_source public.chat_messages%ROWTYPE;
  v_source_id_text text;
  v_source_id uuid;
  v_bride_id uuid;
  v_groom_id uuid;
  v_expected_lane text;
  v_current_fingerprint text;
  v_source_state text;
  v_source_shared_id text;
  v_shared_mediation jsonb;
  v_source_mediation jsonb;
BEGIN
  -- Ordinary chat rows are outside this boundary. Any shared assistant row
  -- that claims to contain mediation, including a malformed value, must pass
  -- the complete private-draft proof below.
  IF NEW.sender_type IS DISTINCT FROM 'ai'
     OR NEW.role IS DISTINCT FROM 'assistant'
     OR NEW.visibility IS DISTINCT FROM 'shared'
     OR NOT COALESCE(NEW.metadata, '{}'::jsonb) ? 'mediation' THEN
    RETURN NEW;
  END IF;

  IF NEW.sender_id IS NOT NULL
     OR jsonb_typeof(COALESCE(NEW.metadata, '{}'::jsonb)) IS DISTINCT FROM 'object'
     OR jsonb_typeof(NEW.metadata -> 'mediation') IS DISTINCT FROM 'object'
     OR NEW.metadata ->> 'mediation_share_origin' IS DISTINCT FROM 'requester_sent'
     OR NEW.metadata ->> 'question_scope' IS DISTINCT FROM 'W1_wedding_adjacent'
     OR NEW.metadata -> 'memory_eligible' IS DISTINCT FROM 'false'::jsonb
     OR NEW.content IS DISTINCT FROM '요청하신 분이 초안을 읽고 이 카드를 보냈어요.'
     OR EXISTS (
       SELECT 1
       FROM jsonb_object_keys(NEW.metadata) AS item(key)
       WHERE item.key NOT IN (
         'mediation',
         'mediation_source_draft_id',
         'mediation_share_origin',
         'question_scope',
         'memory_eligible'
       )
     ) THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_PRIVATE_DRAFT_REQUIRED'
      USING ERRCODE = '23514';
  END IF;

  v_source_id_text := NEW.metadata ->> 'mediation_source_draft_id';
  IF v_source_id_text IS NULL
     OR v_source_id_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_PRIVATE_DRAFT_REQUIRED'
      USING ERRCODE = '23514';
  END IF;
  v_source_id := v_source_id_text::uuid;

  SELECT * INTO v_source
  FROM public.chat_messages
  WHERE id = v_source_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_PRIVATE_DRAFT_REQUIRED'
      USING ERRCODE = '23514';
  END IF;

  SELECT couple.bride_id, couple.groom_id
    INTO v_bride_id, v_groom_id
  FROM public.couples AS couple
  WHERE couple.id = NEW.couple_id
  FOR SHARE;
  IF NOT FOUND
     OR (v_bride_id IS NOT NULL AND v_bride_id = v_groom_id) THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_PRIVATE_DRAFT_REQUIRED'
      USING ERRCODE = '23514';
  END IF;

  v_expected_lane := CASE
    WHEN v_source.visibility = 'bride_private' AND v_bride_id IS NOT NULL
      THEN 'bride_private'
    WHEN v_source.visibility = 'groom_private' AND v_groom_id IS NOT NULL
      THEN 'groom_private'
  END;
  v_current_fingerprint := pg_catalog.md5(
    COALESCE(v_bride_id::text, '-') || ':' || COALESCE(v_groom_id::text, '-')
  );
  v_source_state := v_source.metadata ->> 'mediation_draft_state';
  v_source_shared_id := NULLIF(v_source.metadata ->> 'mediation_shared_message_id', '');
  v_source_mediation := v_source.metadata -> 'mediation';
  v_shared_mediation := NEW.metadata -> 'mediation';

  IF v_source.couple_id IS DISTINCT FROM NEW.couple_id
     OR v_source.sender_id IS NOT NULL
     OR v_source.sender_type IS DISTINCT FROM 'ai'
     OR v_source.role IS DISTINCT FROM 'assistant'
     OR v_expected_lane IS NULL
     OR v_source.visibility IS DISTINCT FROM v_expected_lane
     OR v_source.metadata ->> 'question_scope' IS DISTINCT FROM 'W1_wedding_adjacent'
     OR v_source.metadata -> 'memory_eligible' IS DISTINCT FROM 'false'::jsonb
     OR v_source.metadata -> 'mediation_draft_sendable' IS DISTINCT FROM 'true'::jsonb
     OR v_source.metadata ->> 'mediation_draft_roster_fingerprint'
          IS DISTINCT FROM v_current_fingerprint
     OR jsonb_typeof(v_source_mediation) IS DISTINCT FROM 'object'
     OR v_source_mediation ->> 'origin' IS DISTINCT FROM 'user_requested'
     OR v_source_mediation ->> 'evidenceScope' IS DISTINCT FROM 'requester_summary_only'
     OR v_source_mediation -> 'schemaVersion' IS DISTINCT FROM '2'::jsonb
     OR jsonb_typeof(v_source_mediation -> 'empathy') IS DISTINCT FROM 'string'
     OR char_length(pg_catalog.btrim(v_source_mediation ->> 'empathy')) NOT BETWEEN 1 AND 2000
     OR jsonb_typeof(v_source_mediation -> 'translation') IS DISTINCT FROM 'string'
     OR char_length(pg_catalog.btrim(v_source_mediation ->> 'translation')) NOT BETWEEN 1 AND 2000
     OR jsonb_typeof(v_source_mediation -> 'data') IS DISTINCT FROM 'string'
     OR char_length(pg_catalog.btrim(v_source_mediation ->> 'data')) NOT BETWEEN 1 AND 2000
     OR jsonb_typeof(v_source_mediation -> 'resolution') IS DISTINCT FROM 'string'
     OR char_length(pg_catalog.btrim(v_source_mediation ->> 'resolution')) NOT BETWEEN 1 AND 500
     OR EXISTS (
       SELECT 1
       FROM jsonb_object_keys(v_source_mediation) AS item(key)
       WHERE item.key NOT IN (
         'empathy', 'translation', 'data', 'resolution',
         'origin', 'evidenceScope', 'schemaVersion'
       )
     )
     OR EXISTS (
       SELECT 1
       FROM jsonb_object_keys(v_shared_mediation) AS item(key)
       WHERE item.key NOT IN (
         'empathy', 'translation', 'data', 'resolution',
         'origin', 'evidenceScope', 'schemaVersion',
         'proposalVersion', 'rosterFingerprint'
       )
     )
     OR (
       v_shared_mediation - 'proposalVersion' - 'rosterFingerprint'
     ) IS DISTINCT FROM v_source_mediation
     OR v_shared_mediation ->> 'rosterFingerprint'
          IS DISTINCT FROM v_current_fingerprint
     OR COALESCE(v_shared_mediation ->> 'proposalVersion', '')
          !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR (
       TG_OP = 'INSERT'
       AND (v_source_state IS DISTINCT FROM 'draft' OR v_source_shared_id IS NOT NULL)
     )
     OR (
       TG_OP = 'UPDATE'
       AND (
         v_source_state IS DISTINCT FROM 'sent'
         OR v_source_shared_id IS DISTINCT FROM NEW.id::text
       )
     ) THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_PRIVATE_DRAFT_REQUIRED'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.enforce_amora_mediation_private_draft_boundary()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_enforce_amora_mediation_private_draft_boundary
  ON public.chat_messages;
CREATE TRIGGER trg_enforce_amora_mediation_private_draft_boundary
  AFTER INSERT OR UPDATE OF couple_id, sender_id, sender_type, role, visibility, content, metadata
  ON public.chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_amora_mediation_private_draft_boundary();

COMMIT;
