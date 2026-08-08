BEGIN;

-- A private-chat hard delete must erase both the conversation rows and every
-- automatic memory projection that could be sent to a later model call.  This
-- boundary is deliberately owned by the database: the caller supplies only a
-- couple id; auth.uid(), the current roster and the private visibility are
-- resolved again while the membership rows are locked.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.amora_private_chat_delete_boundaries (
  couple_id uuid NOT NULL
    REFERENCES public.couples(id) ON DELETE CASCADE,
  visibility text NOT NULL
    CHECK (visibility IN ('bride_private', 'groom_private')),
  deleted_at timestamptz NOT NULL,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (couple_id, visibility)
);

ALTER TABLE public.amora_private_chat_delete_boundaries
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amora_private_chat_delete_boundaries
  FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.amora_private_chat_delete_boundaries
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.amora_private_chat_delete_boundaries
  TO service_role;

COMMENT ON TABLE public.amora_private_chat_delete_boundaries IS
  'Server-authored epoch fence for an atomic current-user private-chat hard delete. Contains no conversation text or user identifier.';

-- Every private message insert takes the same scope lock as hard deletion.
-- If an old transaction was already running when deletion crossed the
-- boundary, it cannot recreate an assistant or user row after the delete
-- commits. A genuinely new transaction may start a new private conversation.
CREATE OR REPLACE FUNCTION public.guard_private_chat_write_after_hard_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_visibility text;
  v_couple_id uuid;
  v_deleted_at timestamptz;
BEGIN
  v_visibility := NEW.visibility;
  v_couple_id := NEW.couple_id;

  IF v_visibility NOT IN ('bride_private', 'groom_private')
     OR v_couple_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'hanbang:amora-memory-consent:'
        || v_couple_id::text || ':' || v_visibility,
      0
    )
  );

  SELECT boundary.deleted_at
    INTO v_deleted_at
  FROM public.amora_private_chat_delete_boundaries AS boundary
  WHERE boundary.couple_id = v_couple_id
    AND boundary.visibility = v_visibility;

  IF v_deleted_at IS NOT NULL
     AND transaction_timestamp() <= v_deleted_at THEN
    RAISE EXCEPTION 'PRIVATE_CHAT_DELETE_BOUNDARY_STALE_WRITE'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.guard_private_chat_write_after_hard_delete()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_private_chat_write_after_hard_delete()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_guard_private_chat_write_after_hard_delete
  ON public.chat_messages;
CREATE TRIGGER trg_guard_private_chat_write_after_hard_delete
  BEFORE INSERT ON public.chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_private_chat_write_after_hard_delete();

-- Automatic summaries, semantic memories and legacy couple profiles must not
-- reappear from an old worker after a hard delete.  New compilation remains
-- possible only after the user explicitly enables the private memory scope
-- again, which advances memory_reset_at beyond the delete boundary.
CREATE OR REPLACE FUNCTION public.guard_private_derived_write_after_hard_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_row jsonb := to_jsonb(NEW);
  v_visibility text := v_row ->> 'visibility';
  v_couple_id uuid;
  v_deleted_at timestamptz;
  v_is_automatic boolean;
  v_memory_enabled boolean := false;
  v_memory_reset_at timestamptz;
BEGIN
  BEGIN
    v_couple_id := (v_row ->> 'couple_id')::uuid;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'PRIVATE_CHAT_DERIVED_SCOPE_INVALID'
      USING ERRCODE = '22023';
  END;

  IF v_visibility NOT IN ('bride_private', 'groom_private')
     OR v_couple_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_is_automatic :=
    TG_TABLE_NAME <> 'decision_nodes'
    OR COALESCE(v_row ->> 'source', '') = 'chat'
    OR NULLIF(v_row ->> 'memory_key', '') IS NOT NULL
    OR (
      jsonb_typeof(COALESCE(v_row -> 'metadata', '{}'::jsonb)) = 'object'
      AND COALESCE(v_row -> 'metadata', '{}'::jsonb) ? 'extracted_by'
    );

  IF NOT v_is_automatic THEN
    RETURN NEW;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'hanbang:amora-memory-consent:'
        || v_couple_id::text || ':' || v_visibility,
      0
    )
  );

  SELECT boundary.deleted_at
    INTO v_deleted_at
  FROM public.amora_private_chat_delete_boundaries AS boundary
  WHERE boundary.couple_id = v_couple_id
    AND boundary.visibility = v_visibility;

  IF v_deleted_at IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT setting.enabled, setting.memory_reset_at
    INTO v_memory_enabled, v_memory_reset_at
  FROM public.amora_memory_settings AS setting
  WHERE setting.couple_id = v_couple_id
    AND setting.visibility = v_visibility;

  IF transaction_timestamp() <= v_deleted_at
     OR COALESCE(v_memory_enabled, false) IS DISTINCT FROM true
     OR v_memory_reset_at IS NULL
     OR v_memory_reset_at <= v_deleted_at THEN
    RAISE EXCEPTION 'PRIVATE_CHAT_DELETE_BOUNDARY_DERIVED_WRITE_BLOCKED'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.guard_private_derived_write_after_hard_delete()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_private_derived_write_after_hard_delete()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_guard_private_summary_after_hard_delete
  ON public.chat_summaries;
CREATE TRIGGER trg_guard_private_summary_after_hard_delete
  BEFORE INSERT OR UPDATE ON public.chat_summaries
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_private_derived_write_after_hard_delete();

DROP TRIGGER IF EXISTS trg_guard_private_decision_after_hard_delete
  ON public.decision_nodes;
CREATE TRIGGER trg_guard_private_decision_after_hard_delete
  BEFORE INSERT OR UPDATE ON public.decision_nodes
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_private_derived_write_after_hard_delete();

DROP TRIGGER IF EXISTS trg_guard_private_profile_after_hard_delete
  ON public.amora_couple_profiles;
CREATE TRIGGER trg_guard_private_profile_after_hard_delete
  BEFORE INSERT OR UPDATE ON public.amora_couple_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_private_derived_write_after_hard_delete();

CREATE OR REPLACE FUNCTION public.hard_delete_current_user_private_chat(
  p_couple_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_profile_couple_id uuid;
  v_profile_role text;
  v_bride_id uuid;
  v_groom_id uuid;
  v_visibility text;
  v_deleted_at timestamptz;
  v_request_keys text[] := ARRAY[]::text[];
  v_deleted_messages integer := 0;
  v_deleted_summaries integer := 0;
  v_deleted_nodes integer := 0;
  v_deleted_profiles integer := 0;
  v_deleted_jobs integer := 0;
  v_deleted_claims integer := 0;
  v_deleted_tool_executions integer := 0;
  v_deleted_saved_notes integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'PRIVATE_CHAT_HARD_DELETE_AUTH_REQUIRED'
      USING ERRCODE = '42501';
  END IF;
  IF p_couple_id IS NULL THEN
    RAISE EXCEPTION 'PRIVATE_CHAT_HARD_DELETE_INVALID_INPUT'
      USING ERRCODE = '22023';
  END IF;

  -- Serialize against create/join/account-removal membership transitions.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'hanbang:couple-membership:' || v_uid::text,
      0
    )
  );

  SELECT profile.couple_id, profile.role
    INTO v_profile_couple_id, v_profile_role
  FROM public.profiles AS profile
  WHERE profile.id = v_uid
  FOR UPDATE;

  SELECT couple.bride_id, couple.groom_id
    INTO v_bride_id, v_groom_id
  FROM public.couples AS couple
  WHERE couple.id = p_couple_id
  FOR SHARE;

  IF v_profile_couple_id IS DISTINCT FROM p_couple_id
     OR v_profile_role NOT IN ('bride', 'groom')
     OR (
       (CASE WHEN v_bride_id = v_uid THEN 1 ELSE 0 END)
       + (CASE WHEN v_groom_id = v_uid THEN 1 ELSE 0 END)
     ) <> 1
     OR (v_profile_role = 'bride' AND v_bride_id IS DISTINCT FROM v_uid)
     OR (v_profile_role = 'groom' AND v_groom_id IS DISTINCT FROM v_uid) THEN
    RAISE EXCEPTION 'PRIVATE_CHAT_HARD_DELETE_SCOPE_DENIED'
      USING ERRCODE = '42501';
  END IF;

  v_visibility := CASE
    WHEN v_profile_role = 'bride' THEN 'bride_private'
    ELSE 'groom_private'
  END;

  -- Terminal response finalization locks a request claim before inserting its
  -- assistant row. Keep that same order here, then take the memory-scope lock.
  -- An in-flight finalizer therefore commits first (and is deleted below) or
  -- observes its claim removed and cannot recreate the response afterward.
  PERFORM claim.request_key
  FROM public.amora_chat_request_claims AS claim
  WHERE claim.couple_id = p_couple_id
    AND claim.visibility = v_visibility
  ORDER BY claim.request_key
  FOR UPDATE;

  SELECT COALESCE(
      array_agg(claim.request_key ORDER BY claim.request_key),
      ARRAY[]::text[]
    )
    INTO v_request_keys
  FROM public.amora_chat_request_claims AS claim
  WHERE claim.couple_id = p_couple_id
    AND claim.visibility = v_visibility;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'hanbang:amora-memory-consent:'
        || p_couple_id::text || ':' || v_visibility,
      0
    )
  );

  -- clock_timestamp records the moment after this transaction owns the scope
  -- lock. The insert trigger compares it with the writer transaction's start.
  v_deleted_at := clock_timestamp();

  INSERT INTO public.amora_private_chat_delete_boundaries (
    couple_id, visibility, deleted_at, revision
  ) VALUES (
    p_couple_id, v_visibility, v_deleted_at, 1
  )
  ON CONFLICT (couple_id, visibility) DO UPDATE SET
    deleted_at = excluded.deleted_at,
    revision = public.amora_private_chat_delete_boundaries.revision + 1,
    updated_at = excluded.deleted_at;

  -- Remove saved copies while their source ids still retain privacy
  -- provenance. ON DELETE SET NULL must never turn a private copied note into
  -- an untraceable surviving row.
  DELETE FROM public.amora_saved_notes AS note
  USING public.chat_messages AS message
  WHERE note.message_id = message.id
    AND message.couple_id = p_couple_id
    AND message.visibility = v_visibility;
  GET DIAGNOSTICS v_deleted_saved_notes = ROW_COUNT;

  DELETE FROM public.amora_memory_jobs
  WHERE couple_id = p_couple_id
    AND visibility = v_visibility;
  GET DIAGNOSTICS v_deleted_jobs = ROW_COUNT;

  DELETE FROM public.chat_summaries
  WHERE couple_id = p_couple_id
    AND visibility = v_visibility;
  GET DIAGNOSTICS v_deleted_summaries = ROW_COUNT;

  DELETE FROM public.decision_nodes
  WHERE couple_id = p_couple_id
    AND visibility = v_visibility
    AND (
      source = 'chat'
      OR source_message_id IS NOT NULL
      OR memory_key IS NOT NULL
      OR (
        jsonb_typeof(COALESCE(metadata, '{}'::jsonb)) = 'object'
        AND COALESCE(metadata, '{}'::jsonb) ? 'extracted_by'
      )
    );
  GET DIAGNOSTICS v_deleted_nodes = ROW_COUNT;

  DELETE FROM public.amora_couple_profiles
  WHERE couple_id = p_couple_id
    AND visibility = v_visibility;
  GET DIAGNOSTICS v_deleted_profiles = ROW_COUNT;

  DELETE FROM public.amora_memory_consents
  WHERE couple_id = p_couple_id
    AND visibility = v_visibility;

  INSERT INTO public.amora_memory_settings (
    couple_id, visibility, enabled, enabled_by, enabled_at, memory_reset_at,
    legacy_purged_at
  ) VALUES (
    p_couple_id, v_visibility, false, NULL, NULL, v_deleted_at, v_deleted_at
  )
  ON CONFLICT (couple_id, visibility) DO UPDATE SET
    enabled = false,
    enabled_by = NULL,
    enabled_at = NULL,
    memory_reset_at = v_deleted_at,
    legacy_purged_at = v_deleted_at,
    updated_at = v_deleted_at;

  IF cardinality(v_request_keys) > 0 THEN
    DELETE FROM public.amora_tool_executions
    WHERE couple_id = p_couple_id
      AND request_key = ANY(v_request_keys);
    GET DIAGNOSTICS v_deleted_tool_executions = ROW_COUNT;
  END IF;

  DELETE FROM public.amora_chat_request_claims
  WHERE couple_id = p_couple_id
    AND visibility = v_visibility;
  GET DIAGNOSTICS v_deleted_claims = ROW_COUNT;

  DELETE FROM public.chat_messages
  WHERE couple_id = p_couple_id
    AND visibility = v_visibility;
  GET DIAGNOSTICS v_deleted_messages = ROW_COUNT;

  UPDATE public.profiles
  SET private_chat_cleared_at = v_deleted_at,
      updated_at = v_deleted_at
  WHERE id = v_uid
    AND couple_id = p_couple_id
    AND role = v_profile_role;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRIVATE_CHAT_HARD_DELETE_PROFILE_POSTCONDITION_FAILED';
  END IF;

  -- Provider-eligible private automatic context and every retry/cursor source
  -- must be absent before this transaction may commit.
  IF EXISTS (
       SELECT 1 FROM public.chat_messages
       WHERE couple_id = p_couple_id AND visibility = v_visibility
     )
     OR EXISTS (
       SELECT 1 FROM public.chat_summaries
       WHERE couple_id = p_couple_id AND visibility = v_visibility
     )
     OR EXISTS (
       SELECT 1 FROM public.amora_memory_jobs
       WHERE couple_id = p_couple_id AND visibility = v_visibility
     )
     OR EXISTS (
       SELECT 1 FROM public.amora_chat_request_claims
       WHERE couple_id = p_couple_id AND visibility = v_visibility
     )
     OR EXISTS (
       SELECT 1 FROM public.amora_couple_profiles
       WHERE couple_id = p_couple_id AND visibility = v_visibility
     )
     OR EXISTS (
       SELECT 1 FROM public.decision_nodes
       WHERE couple_id = p_couple_id
         AND visibility = v_visibility
         AND (
           source = 'chat'
           OR source_message_id IS NOT NULL
           OR memory_key IS NOT NULL
           OR (
             jsonb_typeof(COALESCE(metadata, '{}'::jsonb)) = 'object'
             AND COALESCE(metadata, '{}'::jsonb) ? 'extracted_by'
           )
         )
     )
     OR EXISTS (
       SELECT 1 FROM public.amora_memory_consents
       WHERE couple_id = p_couple_id AND visibility = v_visibility
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.amora_memory_settings AS setting
       WHERE setting.couple_id = p_couple_id
         AND setting.visibility = v_visibility
         AND setting.enabled = false
         AND setting.memory_reset_at = v_deleted_at
     )
     OR EXISTS (
       SELECT 1
       FROM public.amora_tool_executions AS execution
       WHERE execution.couple_id = p_couple_id
         AND execution.request_key = ANY(v_request_keys)
     ) THEN
    RAISE EXCEPTION 'PRIVATE_CHAT_HARD_DELETE_POSTCONDITION_FAILED';
  END IF;

  IF NOT EXISTS (
       SELECT 1
       FROM public.couples AS couple
       WHERE couple.id = p_couple_id
         AND couple.bride_id IS NOT DISTINCT FROM v_bride_id
         AND couple.groom_id IS NOT DISTINCT FROM v_groom_id
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.profiles AS profile
       WHERE profile.id = v_uid
         AND profile.couple_id = p_couple_id
         AND profile.role = v_profile_role
     ) THEN
    RAISE EXCEPTION 'PRIVATE_CHAT_HARD_DELETE_MEMBERSHIP_CHANGED';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'visibility', v_visibility,
    'cleared_at', v_deleted_at,
    'deleted_messages', v_deleted_messages,
    'deleted_summaries', v_deleted_summaries,
    'deleted_decisions', v_deleted_nodes,
    'deleted_profiles', v_deleted_profiles,
    'deleted_memory_jobs', v_deleted_jobs,
    'deleted_request_claims', v_deleted_claims,
    'deleted_tool_executions', v_deleted_tool_executions,
    'deleted_saved_notes', v_deleted_saved_notes
  );
END;
$function$;

ALTER FUNCTION public.hard_delete_current_user_private_chat(uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.hard_delete_current_user_private_chat(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hard_delete_current_user_private_chat(uuid)
  TO authenticated;

COMMENT ON FUNCTION public.hard_delete_current_user_private_chat(uuid) IS
  'Atomically hard-deletes auth.uid() current role-private chat plus provider-eligible derived memory; shared and partner-private scopes are immutable.';

COMMIT;
