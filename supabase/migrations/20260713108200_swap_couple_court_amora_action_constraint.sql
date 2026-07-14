-- Phase 3/3: replace the old constraint name only after online validation has
-- committed. Keep this ACCESS EXCLUSIVE operation in a small, retryable file.

SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE public.amora_actions
  DROP CONSTRAINT IF EXISTS amora_actions_source_check;
ALTER TABLE public.amora_actions
  RENAME CONSTRAINT amora_actions_source_check_court_next
  TO amora_actions_source_check;
