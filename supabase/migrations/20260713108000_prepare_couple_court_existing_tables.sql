-- Phase 1/3: add the replacement Amora action source constraint without
-- scanning existing rows. Supabase CLI wraps each migration file in a
-- transaction, so validation and the final name swap intentionally live in
-- later files; otherwise this phase's strong DDL lock could survive for the
-- entire validation scan.

SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE public.amora_actions
  DROP CONSTRAINT IF EXISTS amora_actions_source_check_court_next;
ALTER TABLE public.amora_actions
  ADD CONSTRAINT amora_actions_source_check_court_next
  CHECK (
    source IN ('chat', 'quote', 'schedule', 'budget', 'guardrail', 'manual', 'court')
  ) NOT VALID;

-- The existing couple_id foreign key already uses ON DELETE SET NULL (added
-- in 20260710050000_amora_request_claims.sql), so it is intentionally not
-- dropped and rebuilt here.
