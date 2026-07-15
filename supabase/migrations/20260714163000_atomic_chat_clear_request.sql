-- Resolve shared-chat clear requests without partial state or last-write-wins races.
--
-- The request message is the serialization point. A responder must be the other
-- member of the couple, and accepting updates both profile cursors in the same
-- transaction as the message metadata.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF to_regclass('public.chat_messages') IS NULL
     OR to_regclass('public.couples') IS NULL
     OR to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'CHAT_CLEAR_REQUIRED_TABLE_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'chat_messages'
      AND column_name = 'metadata'
      AND data_type = 'jsonb'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'shared_chat_cleared_at'
      AND data_type = 'timestamp with time zone'
  ) THEN
    RAISE EXCEPTION 'CHAT_CLEAR_REQUIRED_COLUMN_MISSING';
  END IF;

  IF (
       SELECT count(*)
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'chat_messages'
         AND column_name IN (
           'id',
           'couple_id',
           'sender_id',
           'sender_type',
           'role',
           'metadata',
           'created_at',
           'visibility'
         )
     ) <> 8
     OR (
       SELECT count(*)
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'profiles'
         AND column_name IN ('id', 'couple_id', 'role', 'shared_chat_cleared_at')
     ) <> 4
     OR (
       SELECT count(*)
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'couples'
         AND column_name IN ('id', 'bride_id', 'groom_id')
     ) <> 3 THEN
    RAISE EXCEPTION 'CHAT_CLEAR_REQUIRED_COLUMN_MISSING';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_shared_chat_clear_request(
  p_message_id uuid,
  p_action text
)
RETURNS TABLE (
  resolution_status text,
  cleared_at timestamptz,
  idempotent boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_message public.chat_messages%ROWTYPE;
  v_bride_id uuid;
  v_groom_id uuid;
  v_requester_role text;
  v_expected_responder_role text;
  v_current_status text;
  v_target_status text;
  v_profile_count integer;
  v_profiles_valid boolean;
  v_latest_profile_cursor timestamptz;
  v_effective_cleared_at timestamptz;
  v_next_metadata jsonb;
  v_updated integer;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'HC401',
      MESSAGE = 'CHAT_CLEAR_UNAUTHENTICATED';
  END IF;

  IF p_message_id IS NULL
     OR p_action IS NULL
     OR p_action NOT IN ('accept', 'decline') THEN
    RAISE EXCEPTION USING
      ERRCODE = 'HC400',
      MESSAGE = 'CHAT_CLEAR_INVALID_ARGUMENT';
  END IF;

  v_target_status := CASE p_action
    WHEN 'accept' THEN 'accepted'
    ELSE 'declined'
  END;

  -- This row lock serializes accept/decline and makes a conflicting second
  -- response observe the first response rather than overwrite it.
  SELECT message.*
  INTO v_message
  FROM public.chat_messages AS message
  WHERE message.id = p_message_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'HC404',
      MESSAGE = 'CHAT_CLEAR_REQUEST_NOT_FOUND';
  END IF;

  IF v_message.couple_id IS NULL
     OR v_message.sender_id IS NULL
     OR v_message.created_at IS NULL
     OR v_message.visibility IS DISTINCT FROM 'shared'
     OR v_message.role IS DISTINCT FROM 'user'
     OR jsonb_typeof(v_message.metadata) IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_message.metadata->'clearRequest') IS DISTINCT FROM 'object'
     OR v_message.metadata #>> '{clearRequest,type}' IS DISTINCT FROM 'shared'
     OR v_message.metadata #>> '{clearRequest,requestedBy}'
          IS DISTINCT FROM v_message.sender_id::text THEN
    RAISE EXCEPTION USING
      ERRCODE = 'HC400',
      MESSAGE = 'CHAT_CLEAR_INVALID_REQUEST_MESSAGE';
  END IF;

  v_requester_role := v_message.metadata #>> '{clearRequest,requestedByRole}';
  IF v_requester_role IS NULL OR v_requester_role NOT IN ('bride', 'groom') THEN
    RAISE EXCEPTION USING
      ERRCODE = 'HC422',
      MESSAGE = 'CHAT_CLEAR_REQUESTER_ROLE_REQUIRED';
  END IF;

  IF v_message.sender_type IS DISTINCT FROM v_requester_role THEN
    RAISE EXCEPTION USING
      ERRCODE = 'HC400',
      MESSAGE = 'CHAT_CLEAR_REQUESTER_ROLE_MISMATCH';
  END IF;

  SELECT couple.bride_id, couple.groom_id
  INTO v_bride_id, v_groom_id
  FROM public.couples AS couple
  WHERE couple.id = v_message.couple_id
  FOR SHARE;

  IF NOT FOUND OR v_bride_id IS NULL OR v_groom_id IS NULL
     OR v_bride_id = v_groom_id THEN
    RAISE EXCEPTION USING
      ERRCODE = 'HC422',
      MESSAGE = 'CHAT_CLEAR_COUPLE_STATE_INVALID';
  END IF;

  IF v_requester_role = 'bride' THEN
    IF v_message.sender_id IS DISTINCT FROM v_bride_id
       OR v_actor_id IS DISTINCT FROM v_groom_id THEN
      RAISE EXCEPTION USING
        ERRCODE = 'HC403',
        MESSAGE = 'CHAT_CLEAR_PARTNER_ONLY';
    END IF;
    v_expected_responder_role := 'groom';
  ELSE
    IF v_message.sender_id IS DISTINCT FROM v_groom_id
       OR v_actor_id IS DISTINCT FROM v_bride_id THEN
      RAISE EXCEPTION USING
        ERRCODE = 'HC403',
        MESSAGE = 'CHAT_CLEAR_PARTNER_ONLY';
    END IF;
    v_expected_responder_role := 'bride';
  END IF;

  -- Lock in deterministic UUID order. Besides supporting the atomic accept,
  -- this rejects missing/ambiguous roles instead of guessing a bride role.
  SELECT
    count(*)::integer,
    COALESCE(bool_and(
      profile.couple_id = v_message.couple_id
      AND (
        (profile.id = v_bride_id AND profile.role = 'bride')
        OR (profile.id = v_groom_id AND profile.role = 'groom')
      )
    ), false),
    max(profile.shared_chat_cleared_at)
  INTO v_profile_count, v_profiles_valid, v_latest_profile_cursor
  FROM (
    SELECT
      candidate.id,
      candidate.couple_id,
      candidate.role,
      candidate.shared_chat_cleared_at
    FROM public.profiles AS candidate
    WHERE candidate.id IN (v_bride_id, v_groom_id)
    ORDER BY candidate.id
    FOR UPDATE
  ) AS profile;

  IF v_profile_count <> 2 OR NOT v_profiles_valid THEN
    RAISE EXCEPTION USING
      ERRCODE = 'HC422',
      MESSAGE = 'CHAT_CLEAR_PROFILE_STATE_INVALID';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS responder
    WHERE responder.id = v_actor_id
      AND responder.couple_id = v_message.couple_id
      AND responder.role = v_expected_responder_role
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'HC422',
      MESSAGE = 'CHAT_CLEAR_RESPONDER_ROLE_REQUIRED';
  END IF;

  v_current_status := v_message.metadata #>> '{clearRequest,status}';
  IF v_current_status IS NULL
     OR v_current_status NOT IN ('pending', 'accepted', 'declined') THEN
    RAISE EXCEPTION USING
      ERRCODE = 'HC400',
      MESSAGE = 'CHAT_CLEAR_INVALID_REQUEST_STATUS';
  END IF;

  -- Only an exact retry of a response produced by this RPC is idempotent.
  IF v_current_status = v_target_status
     AND v_message.metadata #>> '{clearRequest,respondedBy}' = v_actor_id::text
     AND v_message.metadata #>> '{clearRequest,resolutionVersion}' = '1' THEN
    v_effective_cleared_at := CASE
      WHEN p_action = 'accept' THEN GREATEST(v_message.created_at, v_latest_profile_cursor)
      ELSE NULL
    END;

    RETURN QUERY SELECT v_target_status, v_effective_cleared_at, true;
    RETURN;
  END IF;

  IF v_current_status <> 'pending' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'HC409',
      MESSAGE = 'CHAT_CLEAR_RESPONSE_CONFLICT';
  END IF;

  IF p_action = 'accept' THEN
    v_effective_cleared_at := GREATEST(v_message.created_at, v_latest_profile_cursor);

    UPDATE public.profiles AS profile
    SET shared_chat_cleared_at = v_effective_cleared_at
    WHERE profile.id IN (v_bride_id, v_groom_id);

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated <> 2 THEN
      RAISE EXCEPTION USING
        ERRCODE = 'HC422',
        MESSAGE = 'CHAT_CLEAR_PROFILE_UPDATE_INCOMPLETE';
    END IF;
  ELSE
    v_effective_cleared_at := NULL;
  END IF;

  v_next_metadata := jsonb_set(
    v_message.metadata,
    '{clearRequest}',
    (v_message.metadata->'clearRequest') || jsonb_build_object(
      'status', v_target_status,
      'respondedBy', v_actor_id::text,
      'respondedAt', clock_timestamp(),
      'resolutionVersion', 1
    ) || CASE
      WHEN p_action = 'accept'
        THEN jsonb_build_object('clearedAt', v_effective_cleared_at)
      ELSE '{}'::jsonb
    END,
    false
  );

  UPDATE public.chat_messages AS message
  SET metadata = v_next_metadata
  WHERE message.id = p_message_id
    AND message.metadata #>> '{clearRequest,status}' = 'pending';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'HC409',
      MESSAGE = 'CHAT_CLEAR_RESPONSE_CONFLICT';
  END IF;

  RETURN QUERY SELECT v_target_status, v_effective_cleared_at, false;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_shared_chat_clear_request(uuid, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_shared_chat_clear_request(uuid, text)
  TO authenticated;

COMMENT ON FUNCTION public.resolve_shared_chat_clear_request(uuid, text) IS
  'Atomically accepts or declines a pending shared-chat clear request. Requires the authenticated partner; exact retries are idempotent.';

DO $$
BEGIN
  IF has_function_privilege(
       'anon',
       'public.resolve_shared_chat_clear_request(uuid,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.resolve_shared_chat_clear_request(uuid,text)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       'public.resolve_shared_chat_clear_request(uuid,text)',
       'EXECUTE'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_proc AS procedure
       WHERE procedure.oid =
         'public.resolve_shared_chat_clear_request(uuid,text)'::regprocedure
         AND procedure.prosecdef
         AND EXISTS (
           SELECT 1
           FROM unnest(procedure.proconfig) AS setting(value)
           WHERE setting.value = 'search_path=pg_catalog, public'
         )
     ) THEN
    RAISE EXCEPTION 'CHAT_CLEAR_RPC_ACL_INVALID';
  END IF;
END;
$$;
