-- Enforce the retention policy documented for AI interaction logs.
-- Raw conversational payloads and direct identifiers are removed after 90 days;
-- the remaining aggregate cost/security row is deleted after one year.

CREATE OR REPLACE FUNCTION redact_old_ai_interactions(
  p_retention interval DEFAULT interval '90 days'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE ai_interactions_log
  SET
    user_id = NULL,
    couple_id = NULL,
    session_id = NULL,
    message_id = NULL,
    user_input = CASE WHEN user_input IS NULL THEN NULL ELSE '[redacted_after_retention]' END,
    ai_output = CASE WHEN ai_output IS NULL THEN NULL ELSE '[redacted_after_retention]' END,
    tool_input = NULL,
    tool_output = NULL,
    error_message = CASE WHEN error_message IS NULL THEN NULL ELSE '[redacted_after_retention]' END,
    metadata = jsonb_strip_nulls(jsonb_build_object(
      'visibility', metadata->>'visibility',
      'endpoint', metadata->>'endpoint',
      'source', metadata->>'source',
      'quota_class', metadata->>'quota_class',
      'request_usage', metadata->'request_usage',
      'retention_redacted_at', now(),
      'retention_policy', 'raw_payload_and_identifiers_90d'
    ))
  WHERE created_at < now() - p_retention
    AND COALESCE(metadata->>'retention_policy', '') <> 'raw_payload_and_identifiers_90d';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_ai_interaction_retention()
RETURNS TABLE(redacted integer, deleted integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_redacted integer;
  v_deleted integer;
BEGIN
  SELECT redact_old_ai_interactions(interval '90 days') INTO v_redacted;

  -- Feedback corrections can contain a verbatim user message even though they
  -- are outside ai_interactions_log. Remove payload and identifiers on the same horizon.
  UPDATE chat_feedback
  SET user_id = NULL,
      couple_id = NULL,
      message_id = NULL,
      correction = NULL,
      message_content = NULL
  WHERE created_at < now() - interval '90 days'
    AND (user_id IS NOT NULL OR couple_id IS NOT NULL OR message_id IS NOT NULL
      OR correction IS NOT NULL OR message_content IS NOT NULL);

  DELETE FROM ai_interactions_log WHERE created_at < now() - interval '1 year';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  DELETE FROM chat_feedback WHERE created_at < now() - interval '1 year';
  RETURN QUERY SELECT v_redacted, v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION redact_old_ai_interactions(interval) FROM PUBLIC;
REVOKE ALL ON FUNCTION enforce_ai_interaction_retention() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION redact_old_ai_interactions(interval) TO service_role;
GRANT EXECUTE ON FUNCTION enforce_ai_interaction_retention() TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id
  FROM cron.job
  WHERE jobname = 'enforce-ai-interaction-retention'
  LIMIT 1;

  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;

  PERFORM cron.schedule(
    'enforce-ai-interaction-retention',
    '17 18 * * *',
    'SELECT public.enforce_ai_interaction_retention();'
  );
END;
$$;

COMMENT ON FUNCTION enforce_ai_interaction_retention() IS
  'Daily AI log retention: redact raw payloads and identifiers after 90 days, delete aggregate rows after one year.';
