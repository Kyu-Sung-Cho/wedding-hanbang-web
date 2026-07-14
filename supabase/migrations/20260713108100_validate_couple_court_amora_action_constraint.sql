-- Phase 2/3: validate the already-installed NOT VALID constraint. This scan
-- runs in its own transaction so the short ACCESS EXCLUSIVE lock used to add
-- the constraint in 20260713108000 is no longer held.

SET lock_timeout = '5s';
SET statement_timeout = '15min';

ALTER TABLE public.amora_actions
  VALIDATE CONSTRAINT amora_actions_source_check_court_next;
