-- Require member reports to target an active member in the same cohort room.
-- The API already checks this, but the database policy should enforce it too.

DROP POLICY IF EXISTS cohort_member_reports_insert_own
  ON public.cohort_member_reports;

CREATE POLICY cohort_member_reports_insert_own
  ON public.cohort_member_reports
  FOR INSERT TO authenticated
  WITH CHECK (
    reporter_id = auth.uid()
    AND reported_user_id <> auth.uid()
    AND public.is_cohort_member(room_id)
    AND EXISTS (
      SELECT 1
      FROM public.cohort_members target
      WHERE target.room_id = cohort_member_reports.room_id
        AND target.user_id = cohort_member_reports.reported_user_id
        AND target.is_active = TRUE
    )
  );
