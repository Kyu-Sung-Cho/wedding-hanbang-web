-- Phase 2/3: validate the replacement interaction-type constraint in its own
-- transaction. Ordinary inserts can continue while PostgreSQL scans the table.

SET lock_timeout = '5s';
SET statement_timeout = '15min';

ALTER TABLE public.ai_interactions_log
  VALIDATE CONSTRAINT ai_interactions_log_interaction_type_check_court_next;
