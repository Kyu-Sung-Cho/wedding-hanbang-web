-- Phase 1/3: add the replacement interaction-type constraint without scanning
-- the append-heavy AI audit table. Validation and the final name swap are in
-- later migration files so this transaction's strong DDL lock stays brief.
-- Supabase CLI 2.106.0 also executes migration batches transactionally, so
-- CREATE INDEX CONCURRENTLY is not valid here. Couple Court idempotency uses a
-- new small ledger in the schema migration instead of indexing this table.

SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE public.ai_interactions_log
  DROP CONSTRAINT IF EXISTS ai_interactions_log_interaction_type_check_court_next;
ALTER TABLE public.ai_interactions_log
  ADD CONSTRAINT ai_interactions_log_interaction_type_check_court_next
  CHECK (interaction_type IN (
    'chat_turn', 'tool_call', 'tool_result', 'amora_director',
    'vendor_recommendation', 'feedback', 'community_amora_comment',
    'community_agent_auto', 'couple_court_verdict'
  )) NOT VALID;
