SET lock_timeout = '5s';
SET statement_timeout = '30s';

-- An account-deletion request invalidates application privileges immediately,
-- even while its Auth JWT remains cryptographically valid. Keep service-role
-- automation unchanged, but require every human administrator to have an
-- active profile at the database boundary as well as in server routes.
DROP POLICY IF EXISTS "관리자: 전체 정산 관리" ON public.settlements;
CREATE POLICY "관리자: 전체 정산 관리"
  ON public.settlements FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles AS profile
      WHERE profile.id = (SELECT auth.uid())
        AND profile.is_admin = true
        AND profile.account_deleting_at IS NULL
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles AS profile
      WHERE profile.id = (SELECT auth.uid())
        AND profile.is_admin = true
        AND profile.account_deleting_at IS NULL
    )
  );
DROP POLICY IF EXISTS "vendor_leads_admin_all" ON public.vendor_leads;
CREATE POLICY "vendor_leads_admin_all"
  ON public.vendor_leads FOR ALL
  USING (
    (SELECT auth.role()) = 'service_role'
    OR EXISTS (
      SELECT 1
      FROM public.profiles AS profile
      WHERE profile.id = (SELECT auth.uid())
        AND profile.is_admin = true
        AND profile.account_deleting_at IS NULL
    )
  )
  WITH CHECK (
    (SELECT auth.role()) = 'service_role'
    OR EXISTS (
      SELECT 1
      FROM public.profiles AS profile
      WHERE profile.id = (SELECT auth.uid())
        AND profile.is_admin = true
        AND profile.account_deleting_at IS NULL
    )
  );

DROP POLICY IF EXISTS "amora_quote_checks_admin_select" ON public.amora_quote_checks;
CREATE POLICY "amora_quote_checks_admin_select"
  ON public.amora_quote_checks FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles AS profile
      WHERE profile.id = (SELECT auth.uid())
        AND profile.is_admin = true
        AND profile.account_deleting_at IS NULL
    )
  );

DROP POLICY IF EXISTS "community_agent_personas_admin_select"
  ON public.community_agent_personas;
CREATE POLICY "community_agent_personas_admin_select"
  ON public.community_agent_personas FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles AS profile
      WHERE profile.id = (SELECT auth.uid())
        AND profile.is_admin = true
        AND profile.account_deleting_at IS NULL
    )
  );

DROP POLICY IF EXISTS "community_agent_personas_admin_write"
  ON public.community_agent_personas;
CREATE POLICY "community_agent_personas_admin_write"
  ON public.community_agent_personas FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles AS profile
      WHERE profile.id = (SELECT auth.uid())
        AND profile.is_admin = true
        AND profile.account_deleting_at IS NULL
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles AS profile
      WHERE profile.id = (SELECT auth.uid())
        AND profile.is_admin = true
        AND profile.account_deleting_at IS NULL
    )
  );

DROP POLICY IF EXISTS "community_agent_drafts_admin_select"
  ON public.community_agent_content_drafts;
CREATE POLICY "community_agent_drafts_admin_select"
  ON public.community_agent_content_drafts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles AS profile
      WHERE profile.id = (SELECT auth.uid())
        AND profile.is_admin = true
        AND profile.account_deleting_at IS NULL
    )
  );

DROP POLICY IF EXISTS "community_agent_drafts_admin_write"
  ON public.community_agent_content_drafts;
CREATE POLICY "community_agent_drafts_admin_write"
  ON public.community_agent_content_drafts FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles AS profile
      WHERE profile.id = (SELECT auth.uid())
        AND profile.is_admin = true
        AND profile.account_deleting_at IS NULL
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles AS profile
      WHERE profile.id = (SELECT auth.uid())
        AND profile.is_admin = true
        AND profile.account_deleting_at IS NULL
    )
  );

DROP POLICY IF EXISTS "community_agent_activity_admin_select"
  ON public.community_agent_activity_log;
CREATE POLICY "community_agent_activity_admin_select"
  ON public.community_agent_activity_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles AS profile
      WHERE profile.id = (SELECT auth.uid())
        AND profile.is_admin = true
        AND profile.account_deleting_at IS NULL
    )
  );

DROP POLICY IF EXISTS "community_agent_activity_admin_write"
  ON public.community_agent_activity_log;
CREATE POLICY "community_agent_activity_admin_write"
  ON public.community_agent_activity_log FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles AS profile
      WHERE profile.id = (SELECT auth.uid())
        AND profile.is_admin = true
        AND profile.account_deleting_at IS NULL
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles AS profile
      WHERE profile.id = (SELECT auth.uid())
        AND profile.is_admin = true
        AND profile.account_deleting_at IS NULL
    )
  );

DROP POLICY IF EXISTS "community_agent_daily_state_admin_select"
  ON public.community_agent_daily_state;
CREATE POLICY "community_agent_daily_state_admin_select"
  ON public.community_agent_daily_state FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles AS profile
      WHERE profile.id = (SELECT auth.uid())
        AND profile.is_admin = true
        AND profile.account_deleting_at IS NULL
    )
  );

DROP POLICY IF EXISTS "community_agent_daily_state_admin_write"
  ON public.community_agent_daily_state;
CREATE POLICY "community_agent_daily_state_admin_write"
  ON public.community_agent_daily_state FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles AS profile
      WHERE profile.id = (SELECT auth.uid())
        AND profile.is_admin = true
        AND profile.account_deleting_at IS NULL
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles AS profile
      WHERE profile.id = (SELECT auth.uid())
        AND profile.is_admin = true
        AND profile.account_deleting_at IS NULL
    )
  );

DROP POLICY IF EXISTS "community_agent_automation_runs_admin_select"
  ON public.community_agent_automation_runs;
CREATE POLICY "community_agent_automation_runs_admin_select"
  ON public.community_agent_automation_runs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles AS profile
      WHERE profile.id = (SELECT auth.uid())
        AND profile.is_admin = true
        AND profile.account_deleting_at IS NULL
    )
  );

DROP POLICY IF EXISTS "community_agent_automation_runs_admin_write"
  ON public.community_agent_automation_runs;
CREATE POLICY "community_agent_automation_runs_admin_write"
  ON public.community_agent_automation_runs FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles AS profile
      WHERE profile.id = (SELECT auth.uid())
        AND profile.is_admin = true
        AND profile.account_deleting_at IS NULL
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles AS profile
      WHERE profile.id = (SELECT auth.uid())
        AND profile.is_admin = true
        AND profile.account_deleting_at IS NULL
    )
  );
