-- 동기방 멤버 신고 큐
-- 콘텐츠 신고(community_reports)와 분리해 사람 단위 신고를 관리자 검토 대상으로 모은다.

CREATE TABLE IF NOT EXISTS cohort_member_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES cohort_rooms(id) ON DELETE CASCADE,
  reporter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reported_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (reason IN ('spam', 'abuse', 'ad', 'inappropriate', 'other')),
  description TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'resolved', 'dismissed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (reporter_id <> reported_user_id),
  UNIQUE (room_id, reporter_id, reported_user_id)
);

CREATE INDEX IF NOT EXISTS idx_cohort_member_reports_target
  ON cohort_member_reports(room_id, reported_user_id, status);

CREATE INDEX IF NOT EXISTS idx_cohort_member_reports_status
  ON cohort_member_reports(status, created_at DESC);

ALTER TABLE cohort_member_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cmr_insert_own" ON cohort_member_reports;
CREATE POLICY "cmr_insert_own" ON cohort_member_reports
FOR INSERT WITH CHECK (
  auth.uid() = reporter_id
  AND EXISTS (
    SELECT 1
    FROM cohort_members m
    WHERE m.room_id = cohort_member_reports.room_id
      AND m.user_id = auth.uid()
      AND m.is_active = TRUE
  )
  AND EXISTS (
    SELECT 1
    FROM cohort_members target
    WHERE target.room_id = cohort_member_reports.room_id
      AND target.user_id = cohort_member_reports.reported_user_id
      AND target.is_active = TRUE
  )
);

DROP POLICY IF EXISTS "cmr_select_own" ON cohort_member_reports;
CREATE POLICY "cmr_select_own" ON cohort_member_reports
FOR SELECT USING (auth.uid() = reporter_id);
