BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

LOCK TABLE public.congratulatory_money IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE public.congratulatory_money ENABLE ROW LEVEL SECURITY;

-- The retired ledger must not stay readable through an older policy name.
DO $$
DECLARE
  existing_policy record;
BEGIN
  FOR existing_policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'congratulatory_money'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.congratulatory_money',
      existing_policy.policyname
    );
  END LOOP;
END;
$$;

REVOKE ALL ON TABLE public.congratulatory_money FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.congratulatory_money FROM service_role;
GRANT SELECT (id, owner_user_id, couple_id), DELETE
  ON TABLE public.congratulatory_money TO service_role;

CREATE OR REPLACE FUNCTION public.reject_congratulatory_money_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'congratulatory_money_retired'
    USING ERRCODE = '42501';
END;
$$;

ALTER FUNCTION public.reject_congratulatory_money_write() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reject_congratulatory_money_write()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_congratulatory_money_write()
  TO service_role;

DROP TRIGGER IF EXISTS trg_reject_congratulatory_money_write
  ON public.congratulatory_money;
CREATE TRIGGER trg_reject_congratulatory_money_write
  BEFORE INSERT OR UPDATE ON public.congratulatory_money
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_congratulatory_money_write();

COMMENT ON TABLE public.congratulatory_money IS
  'Retired public-beta ledger. No new reads, inserts, or updates; service boundary retains scoped deletion only.';

COMMIT;
