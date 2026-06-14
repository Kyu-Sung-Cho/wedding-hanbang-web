-- AI interaction raw-log retention helper.
-- Keeps the audit row and cost/token metadata, but removes raw conversational
-- payloads after the retention window. Call from a scheduled service-role job.

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
    user_input = CASE WHEN user_input IS NULL THEN NULL ELSE '[redacted_after_retention]' END,
    ai_output = CASE WHEN ai_output IS NULL THEN NULL ELSE '[redacted_after_retention]' END,
    tool_input = NULL,
    tool_output = NULL,
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'retention_redacted_at', now(),
      'retention_policy', 'raw_payload_90d'
    )
  WHERE created_at < now() - p_retention
    AND COALESCE(metadata->>'retention_policy', '') <> 'raw_payload_90d';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION redact_old_ai_interactions(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION redact_old_ai_interactions(interval) TO service_role;

COMMENT ON FUNCTION redact_old_ai_interactions(interval) IS
  'Redacts raw AI interaction payloads after the retention window while preserving audit/cost rows.';
