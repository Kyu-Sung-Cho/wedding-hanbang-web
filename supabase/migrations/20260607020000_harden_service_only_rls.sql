-- Harden policies that were intended to be service-only but were created
-- without `TO service_role`. In Postgres RLS, an unrestricted policy applies
-- to public roles too, so keep user-facing SELECT policies explicit.

-- Preregistrations are written/read through server APIs only.
DROP POLICY IF EXISTS "Service role can manage" ON preregistrations;
CREATE POLICY "Service role can manage"
  ON preregistrations FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Analytics stats: vendors may read their own stats; only service role mutates.
DROP POLICY IF EXISTS "Service role can manage stats" ON vendor_daily_stats;
CREATE POLICY "Service role can manage stats"
  ON vendor_daily_stats FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Chat feedback contains AI feedback and copied message context.
DROP POLICY IF EXISTS "chat_feedback_service_all" ON chat_feedback;
CREATE POLICY "chat_feedback_service_all"
  ON chat_feedback FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Chat summaries are read by authenticated couple members in /api/chat.
DROP POLICY IF EXISTS "chat_summaries_service_all" ON chat_summaries;
CREATE POLICY "chat_summaries_service_all"
  ON chat_summaries FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "chat_summaries_select_couple" ON chat_summaries;
CREATE POLICY "chat_summaries_select_couple"
  ON chat_summaries FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM profiles p
      WHERE p.id = auth.uid()
        AND p.couple_id = chat_summaries.couple_id
        AND (
          chat_summaries.visibility = 'shared'
          OR (chat_summaries.visibility = 'bride_private' AND p.role = 'bride')
          OR (chat_summaries.visibility = 'groom_private' AND p.role = 'groom')
        )
    )
  );

-- Account deletion reasons are written through the authenticated delete API.
DROP POLICY IF EXISTS "account_deletions_service_only" ON account_deletions;
CREATE POLICY "account_deletions_service_only"
  ON account_deletions FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Survey responses are collected by a public server API using service role.
DROP POLICY IF EXISTS "customer_survey_service_only" ON customer_survey_responses;
CREATE POLICY "customer_survey_service_only"
  ON customer_survey_responses FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
