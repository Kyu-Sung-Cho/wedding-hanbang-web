BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

LOCK TABLE auth.users IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.account_deletion_jobs IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE;

-- GoTrue is a public boundary of its own: a client can call updateUser with a
-- valid JWT without passing through the Next.js API. Once deletion begins,
-- prevent every auth.users UPDATE (email/password/phone/token/metadata) until
-- the worker deletes the row. DELETE remains available to the admin worker.
CREATE OR REPLACE FUNCTION public.block_auth_user_update_during_account_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.id = OLD.id
      AND profile.account_deleting_at IS NOT NULL
  ) OR EXISTS (
    SELECT 1
    FROM public.account_deletion_jobs AS job
    WHERE job.user_id = OLD.id
      AND job.status <> 'completed'
  ) THEN
    RAISE EXCEPTION 'auth subject is locked for account deletion'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.block_auth_user_update_during_account_deletion()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.block_auth_user_update_during_account_deletion()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_block_auth_user_update_during_account_deletion
  ON auth.users;
CREATE TRIGGER trg_block_auth_user_update_during_account_deletion
  BEFORE UPDATE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.block_auth_user_update_during_account_deletion();

DO $$
DECLARE
  v_trigger pg_catalog.pg_trigger%ROWTYPE;
BEGIN
  SELECT trigger_row.* INTO v_trigger
  FROM pg_catalog.pg_trigger AS trigger_row
  JOIN pg_catalog.pg_class AS table_row ON table_row.oid = trigger_row.tgrelid
  JOIN pg_catalog.pg_namespace AS namespace_row
    ON namespace_row.oid = table_row.relnamespace
  WHERE namespace_row.nspname = 'auth'
    AND table_row.relname = 'users'
    AND trigger_row.tgname =
      'trg_block_auth_user_update_during_account_deletion'
    AND NOT trigger_row.tgisinternal;

  IF NOT FOUND
    OR v_trigger.tgfoid IS DISTINCT FROM
      'public.block_auth_user_update_during_account_deletion()'::regprocedure
    OR v_trigger.tgenabled <> 'O'
  THEN
    RAISE EXCEPTION 'AUTH_DELETION_UPDATE_FENCE_CONTRACT_MISMATCH'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.block_auth_user_update_during_account_deletion() IS
  'Trigger-only fence that prevents GoTrue identity mutation after account deletion begins.';

COMMIT;
