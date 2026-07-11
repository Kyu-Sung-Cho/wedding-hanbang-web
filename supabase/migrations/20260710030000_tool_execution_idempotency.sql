-- A retried chat request must not apply the same budget, schedule, booking, or
-- other tool side effect twice. The API inserts a tool_call claim before the
-- execution and only the winner of this unique key may proceed.

CREATE UNIQUE INDEX IF NOT EXISTS ai_log_tool_idempotency_unique
  ON public.ai_interactions_log (
    couple_id,
    (metadata->>'tool_idempotency_key')
  )
  WHERE interaction_type = 'tool_call'
    AND couple_id IS NOT NULL
    AND NULLIF(metadata->>'tool_idempotency_key', '') IS NOT NULL;

COMMENT ON INDEX public.ai_log_tool_idempotency_unique IS
  'Fail-closed idempotency ledger for Amora tool executions retried with the same client request ID.';
