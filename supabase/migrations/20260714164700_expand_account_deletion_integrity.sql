-- EXPAND PHASE: make account deletion database-driven and failure-safe.
--
-- Auth deletion is the irreversible boundary. Every public reference to the
-- auth user must therefore either cascade or anonymize in the same PostgreSQL
-- transaction. The two tracking constraints drifted from their original
-- ON DELETE SET NULL definitions in production; replace them without deleting
-- customer history. Chat summaries contain derived personal data and must be
-- removed with the Auth user.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Add/validate the replacement before dropping the old constraint so a failed
-- validation leaves the existing protection intact.
ALTER TABLE public.customer_events
  DROP CONSTRAINT IF EXISTS customer_events_user_id_delete_set_null_fkey;
ALTER TABLE public.customer_events
  ADD CONSTRAINT customer_events_user_id_delete_set_null_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id)
  ON DELETE SET NULL
  NOT VALID;
ALTER TABLE public.customer_events
  VALIDATE CONSTRAINT customer_events_user_id_delete_set_null_fkey;
ALTER TABLE public.customer_events
  DROP CONSTRAINT IF EXISTS customer_events_user_id_fkey;
ALTER TABLE public.customer_events
  RENAME CONSTRAINT customer_events_user_id_delete_set_null_fkey
  TO customer_events_user_id_fkey;

ALTER TABLE public.search_logs
  DROP CONSTRAINT IF EXISTS search_logs_user_id_delete_set_null_fkey;
ALTER TABLE public.search_logs
  ADD CONSTRAINT search_logs_user_id_delete_set_null_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id)
  ON DELETE SET NULL
  NOT VALID;
ALTER TABLE public.search_logs
  VALIDATE CONSTRAINT search_logs_user_id_delete_set_null_fkey;
ALTER TABLE public.search_logs
  DROP CONSTRAINT IF EXISTS search_logs_user_id_fkey;
ALTER TABLE public.search_logs
  RENAME CONSTRAINT search_logs_user_id_delete_set_null_fkey
  TO search_logs_user_id_fkey;

-- Tracking and insight history outlives an account, but must not keep an
-- ownerless couple aggregate alive. Both columns are nullable in production,
-- so anonymize the aggregate reference before the couple is removed.
ALTER TABLE public.customer_events
  DROP CONSTRAINT IF EXISTS customer_events_couple_id_delete_set_null_fkey;
ALTER TABLE public.customer_events
  ADD CONSTRAINT customer_events_couple_id_delete_set_null_fkey
  FOREIGN KEY (couple_id) REFERENCES public.couples(id)
  ON DELETE SET NULL
  NOT VALID;
ALTER TABLE public.customer_events
  VALIDATE CONSTRAINT customer_events_couple_id_delete_set_null_fkey;
ALTER TABLE public.customer_events
  DROP CONSTRAINT IF EXISTS customer_events_couple_id_fkey;
ALTER TABLE public.customer_events
  RENAME CONSTRAINT customer_events_couple_id_delete_set_null_fkey
  TO customer_events_couple_id_fkey;

ALTER TABLE public.customer_insights
  DROP CONSTRAINT IF EXISTS customer_insights_couple_id_delete_set_null_fkey;
ALTER TABLE public.customer_insights
  ADD CONSTRAINT customer_insights_couple_id_delete_set_null_fkey
  FOREIGN KEY (couple_id) REFERENCES public.couples(id)
  ON DELETE SET NULL
  NOT VALID;
ALTER TABLE public.customer_insights
  VALIDATE CONSTRAINT customer_insights_couple_id_delete_set_null_fkey;
ALTER TABLE public.customer_insights
  DROP CONSTRAINT IF EXISTS customer_insights_couple_id_fkey;
ALTER TABLE public.customer_insights
  RENAME CONSTRAINT customer_insights_couple_id_delete_set_null_fkey
  TO customer_insights_couple_id_fkey;

ALTER TABLE public.chat_summaries
  DROP CONSTRAINT IF EXISTS chat_summaries_user_id_delete_cascade_fkey;
ALTER TABLE public.chat_summaries
  ADD CONSTRAINT chat_summaries_user_id_delete_cascade_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id)
  ON DELETE CASCADE
  NOT VALID;
ALTER TABLE public.chat_summaries
  VALIDATE CONSTRAINT chat_summaries_user_id_delete_cascade_fkey;

-- A couple with no members has no owner and can retain private wedding data
-- forever. Delete that aggregate immediately after its final slot is cleared;
-- existing ON DELETE CASCADE constraints clean up couple-owned data atomically.
DO $precondition$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.couples
    WHERE bride_id IS NULL AND groom_id IS NULL
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETE_EMPTY_COUPLES_REQUIRE_REVIEW';
  END IF;
END;
$precondition$;

CREATE OR REPLACE FUNCTION public.delete_empty_couple_after_membership_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
BEGIN
  IF NEW.bride_id IS NULL AND NEW.groom_id IS NULL THEN
    DELETE FROM public.couples AS couple
    WHERE couple.id = NEW.id
      AND couple.bride_id IS NULL
      AND couple.groom_id IS NULL;
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.delete_empty_couple_after_membership_change() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.delete_empty_couple_after_membership_change()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_delete_empty_couple_after_membership_change
  ON public.couples;
CREATE TRIGGER trg_delete_empty_couple_after_membership_change
  AFTER UPDATE OF bride_id, groom_id ON public.couples
  FOR EACH ROW
  WHEN (NEW.bride_id IS NULL AND NEW.groom_id IS NULL)
  EXECUTE FUNCTION public.delete_empty_couple_after_membership_change();

DO $assertions$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_record
    WHERE constraint_record.contype = 'f'
      AND constraint_record.confrelid = 'auth.users'::regclass
      AND constraint_record.conrelid IN (
        'public.customer_events'::regclass,
        'public.search_logs'::regclass
      )
      AND constraint_record.confdeltype IS DISTINCT FROM 'n'
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETE_TRACKING_FK_ACTION_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_record
    WHERE constraint_record.contype = 'f'
      AND constraint_record.confrelid = 'public.couples'::regclass
      AND constraint_record.conrelid IN (
        'public.customer_events'::regclass,
        'public.customer_insights'::regclass
      )
      AND constraint_record.confdeltype IS DISTINCT FROM 'n'
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETE_COUPLE_TRACKING_FK_ACTION_INVALID';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_record
    WHERE constraint_record.conname = 'chat_summaries_user_id_delete_cascade_fkey'
      AND constraint_record.conrelid = 'public.chat_summaries'::regclass
      AND constraint_record.confrelid = 'auth.users'::regclass
      AND constraint_record.confdeltype = 'c'
      AND constraint_record.convalidated
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETE_SUMMARY_CASCADE_MISSING';
  END IF;
END;
$assertions$;

COMMENT ON FUNCTION public.delete_empty_couple_after_membership_change() IS
  'Deletes an ownerless couple in the same transaction that clears its final member slot.';
