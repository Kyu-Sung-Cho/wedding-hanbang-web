BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.congratulatory_money ENABLE ROW LEVEL SECURITY;

-- The original couple-wide policy predates owner_user_id and exposes one
-- partner's guest ledger to the other. Remove every historical policy so a
-- forgotten write policy cannot bypass the API's validation and audit path.
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

REVOKE ALL ON TABLE public.congratulatory_money FROM PUBLIC;
REVOKE ALL ON TABLE public.congratulatory_money FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON TABLE public.congratulatory_money
  FROM anon, authenticated;
GRANT SELECT ON TABLE public.congratulatory_money TO authenticated;

CREATE POLICY money_select_own
  ON public.congratulatory_money
  FOR SELECT TO authenticated
  USING (
    owner_user_id = auth.uid()
    AND public.is_couple_member(couple_id)
  );

COMMIT;
