-- Phase 3/3: perform only the quick old/new constraint name swap. A short
-- lock timeout makes normal write traffic win instead of causing an outage.

SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE public.ai_interactions_log
  DROP CONSTRAINT IF EXISTS ai_interactions_log_interaction_type_check;
ALTER TABLE public.ai_interactions_log
  RENAME CONSTRAINT ai_interactions_log_interaction_type_check_court_next
  TO ai_interactions_log_interaction_type_check;
