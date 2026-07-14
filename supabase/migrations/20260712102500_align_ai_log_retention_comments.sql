
SET lock_timeout = '5s';
SET statement_timeout = '30s';

-- Align catalog documentation with the retention function that is already the
-- executable policy. Do not claim a fixed statutory period here: legal review
-- may change the approved basis, while the database must describe what it
-- actually enforces today.
COMMENT ON TABLE public.ai_interactions_log IS
  'Service-only AI interaction audit ledger. Direct identifiers and raw payload fields are redacted after 90 days; aggregate rows are deleted after 1 year, or earlier when an approved subject-deletion workflow applies.';

COMMENT ON COLUMN public.ai_interactions_log.user_input IS
  'Optional raw user payload. May contain personal data; redacted after 90 days and subject to earlier approved deletion.';

COMMENT ON COLUMN public.ai_interactions_log.ai_output IS
  'Optional raw AI payload. May reproduce personal data; redacted after 90 days and subject to earlier approved deletion.';

COMMENT ON COLUMN public.ai_interactions_log.error_message IS
  'Bounded diagnostic code only; redacted with other payload fields after 90 days.';

COMMENT ON COLUMN public.ai_interactions_log.metadata IS
  'Bounded operational metadata. Identifying fields are removed after 90 days; aggregate rows are deleted after 1 year.';
