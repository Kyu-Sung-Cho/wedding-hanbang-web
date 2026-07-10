-- Delete one member's private Amora data atomically. The previous API performed
-- several independent deletes; a mid-flight failure could remove messages while
-- leaving derived memories or audit payloads behind, with no IDs left to retry.

CREATE OR REPLACE FUNCTION public.delete_private_amora_data(
  p_user_id uuid,
  p_couple_id uuid,
  p_visibility text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_expected_visibility text;
  v_message_ids uuid[] := ARRAY[]::uuid[];
  v_deleted integer := 0;
BEGIN
  SELECT role::text
  INTO v_role
  FROM public.profiles
  WHERE id = p_user_id
    AND couple_id = p_couple_id;

  v_expected_visibility := CASE
    WHEN v_role = 'bride' THEN 'bride_private'
    WHEN v_role = 'groom' THEN 'groom_private'
    ELSE NULL
  END;

  IF v_expected_visibility IS NULL OR p_visibility <> v_expected_visibility THEN
    RAISE EXCEPTION 'private chat ownership verification failed'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[])
  INTO v_message_ids
  FROM public.chat_messages
  WHERE couple_id = p_couple_id
    AND visibility::text = p_visibility;

  -- Redact every audit payload that can be linked to the private turn before
  -- deleting the messages. Historical helper rows did not carry visibility, so
  -- user+couple+endpoint is deliberately used as a privacy-first fallback.
  UPDATE public.ai_interactions_log
  SET
    user_input = CASE WHEN user_input IS NULL THEN NULL ELSE '[redacted_by_private_chat_delete]' END,
    ai_output = CASE WHEN ai_output IS NULL THEN NULL ELSE '[redacted_by_private_chat_delete]' END,
    tool_input = NULL,
    tool_output = NULL,
    error_message = CASE WHEN error_message IS NULL THEN NULL ELSE '[redacted_by_private_chat_delete]' END,
    message_id = NULL,
    metadata = jsonb_strip_nulls(jsonb_build_object(
      'visibility', metadata->>'visibility',
      'endpoint', metadata->>'endpoint',
      'request_usage', metadata->'request_usage',
      'private_payload_redacted_at', now()
    ))
  WHERE couple_id = p_couple_id
    AND (
      message_id = ANY(v_message_ids)
      OR metadata->>'visibility' = p_visibility
      OR (
        user_id = p_user_id
        AND metadata->>'endpoint' IN (
          'chat/summarize',
          'chat/extract-decision',
          'chat/classify-excavation',
          'chat/amora-profile'
        )
      )
    );

  DELETE FROM public.chat_feedback
  -- chat_feedback.message_id is the legacy TEXT soft-link while
  -- chat_messages.id and ai_interactions_log.message_id are UUID.
  WHERE message_id = ANY(v_message_ids::text[]);

  DELETE FROM public.chat_summaries
  WHERE couple_id = p_couple_id
    AND visibility::text = p_visibility;

  DELETE FROM public.decision_nodes
  WHERE couple_id = p_couple_id
    AND visibility::text = p_visibility;

  DELETE FROM public.amora_couple_profiles
  WHERE couple_id = p_couple_id
    AND visibility::text = p_visibility;

  DELETE FROM public.chat_messages
  WHERE couple_id = p_couple_id
    AND visibility::text = p_visibility;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  UPDATE public.profiles
  SET private_chat_cleared_at = now()
  WHERE id = p_user_id;

  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_private_amora_data(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_private_amora_data(uuid, uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_private_amora_data(uuid, uuid, text) TO service_role;

COMMENT ON FUNCTION public.delete_private_amora_data(uuid, uuid, text) IS
  'Atomically deletes one verified member private Amora messages and derived memory, and redacts linked audit payloads.';
