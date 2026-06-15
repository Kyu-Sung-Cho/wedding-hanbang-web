-- Harden cohort room membership writes.
--
-- Membership is a server-owned assignment: users should be able to read their
-- own cohort context, but they must not directly join, leave, move, or reactivate
-- cohort rooms through PostgREST. The API/RPC service-role path remains the only
-- writer.

REVOKE ALL PRIVILEGES ON TABLE public.cohort_members FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.cohort_members FROM authenticated;
GRANT SELECT ON TABLE public.cohort_members TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.cohort_members TO service_role;

DROP POLICY IF EXISTS "cohort_members_insert" ON public.cohort_members;
DROP POLICY IF EXISTS "cohort_members_update" ON public.cohort_members;
DROP POLICY IF EXISTS "cohort_members_delete" ON public.cohort_members;
DROP POLICY IF EXISTS cohort_members_insert_self ON public.cohort_members;
DROP POLICY IF EXISTS cohort_members_update_self ON public.cohort_members;
DROP POLICY IF EXISTS cohort_members_delete_self ON public.cohort_members;

DROP POLICY IF EXISTS "cohort_members_select" ON public.cohort_members;
DROP POLICY IF EXISTS cohort_members_select_room ON public.cohort_members;
CREATE POLICY cohort_members_select_room ON public.cohort_members
  FOR SELECT TO authenticated
  USING (public.is_cohort_member(room_id) OR user_id = auth.uid());

DROP POLICY IF EXISTS cohort_members_service_role_all ON public.cohort_members;
CREATE POLICY cohort_members_service_role_all ON public.cohort_members
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.prevent_cohort_membership_client_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text := COALESCE(current_setting('request.jwt.claim.role', true), '');
BEGIN
  IF v_role IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'cohort membership is server-managed' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_cohort_membership_client_write() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_prevent_cohort_membership_client_write ON public.cohort_members;
CREATE TRIGGER trg_prevent_cohort_membership_client_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.cohort_members
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_cohort_membership_client_write();
