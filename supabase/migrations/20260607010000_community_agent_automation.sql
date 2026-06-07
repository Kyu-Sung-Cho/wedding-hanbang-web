-- Community agent automation layer.
-- This extends the admin-reviewed agent system with daily plans, cron runs,
-- and auto-generated draft metadata.

ALTER TABLE community_agent_content_drafts
  ADD COLUMN IF NOT EXISTS auto_generated BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auto_publish BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS automation_run_id UUID,
  ADD COLUMN IF NOT EXISTS decision JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS community_agent_daily_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES community_agent_personas(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  planned_posts INT NOT NULL DEFAULT 0 CHECK (planned_posts BETWEEN 0 AND 8),
  planned_comments INT NOT NULL DEFAULT 0 CHECK (planned_comments BETWEEN 0 AND 20),
  planned_reactions INT NOT NULL DEFAULT 0 CHECK (planned_reactions BETWEEN 0 AND 30),
  planned_cohort_messages INT NOT NULL DEFAULT 0 CHECK (planned_cohort_messages BETWEEN 0 AND 12),
  done_posts INT NOT NULL DEFAULT 0 CHECK (done_posts >= 0),
  done_comments INT NOT NULL DEFAULT 0 CHECK (done_comments >= 0),
  done_reactions INT NOT NULL DEFAULT 0 CHECK (done_reactions >= 0),
  done_cohort_messages INT NOT NULL DEFAULT 0 CHECK (done_cohort_messages >= 0),
  mood TEXT NOT NULL DEFAULT 'normal',
  seed INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agent_id, day)
);

CREATE INDEX IF NOT EXISTS idx_agent_daily_state_day
  ON community_agent_daily_state(day, agent_id);

ALTER TABLE community_agent_daily_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "community_agent_daily_state_admin_select" ON community_agent_daily_state;
CREATE POLICY "community_agent_daily_state_admin_select"
  ON community_agent_daily_state FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

DROP POLICY IF EXISTS "community_agent_daily_state_admin_write" ON community_agent_daily_state;
CREATE POLICY "community_agent_daily_state_admin_write"
  ON community_agent_daily_state FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

CREATE TABLE IF NOT EXISTS community_agent_automation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_source TEXT NOT NULL DEFAULT 'cron' CHECK (trigger_source IN ('cron', 'admin', 'manual')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  dry_run BOOLEAN NOT NULL DEFAULT FALSE,
  model TEXT,
  planned_count INT NOT NULL DEFAULT 0,
  published_count INT NOT NULL DEFAULT 0,
  drafted_count INT NOT NULL DEFAULT 0,
  skipped_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  tokens_input INT NOT NULL DEFAULT 0,
  tokens_output INT NOT NULL DEFAULT 0,
  estimated_cost_usd NUMERIC(10,6),
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_automation_runs_started
  ON community_agent_automation_runs(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_automation_runs_status
  ON community_agent_automation_runs(status, started_at DESC);

ALTER TABLE community_agent_automation_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "community_agent_automation_runs_admin_select" ON community_agent_automation_runs;
CREATE POLICY "community_agent_automation_runs_admin_select"
  ON community_agent_automation_runs FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

DROP POLICY IF EXISTS "community_agent_automation_runs_admin_write" ON community_agent_automation_runs;
CREATE POLICY "community_agent_automation_runs_admin_write"
  ON community_agent_automation_runs FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

ALTER TABLE community_agent_content_drafts
  DROP CONSTRAINT IF EXISTS community_agent_content_drafts_automation_run_id_fkey;

ALTER TABLE community_agent_content_drafts
  ADD CONSTRAINT community_agent_content_drafts_automation_run_id_fkey
  FOREIGN KEY (automation_run_id)
  REFERENCES community_agent_automation_runs(id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agent_drafts_automation_run
  ON community_agent_content_drafts(automation_run_id)
  WHERE automation_run_id IS NOT NULL;

CREATE OR REPLACE VIEW community_agent_daily_overview AS
SELECT
  s.day,
  a.id AS agent_id,
  a.slug,
  a.public_nickname,
  a.internal_label,
  a.status,
  s.planned_posts,
  s.done_posts,
  s.planned_comments,
  s.done_comments,
  s.planned_reactions,
  s.done_reactions,
  s.planned_cohort_messages,
  s.done_cohort_messages
FROM community_agent_daily_state s
JOIN community_agent_personas a ON a.id = s.agent_id;

DROP TRIGGER IF EXISTS trg_community_agent_daily_state_updated_at ON community_agent_daily_state;
CREATE TRIGGER trg_community_agent_daily_state_updated_at
BEFORE UPDATE ON community_agent_daily_state
FOR EACH ROW EXECUTE FUNCTION community_agent_touch_updated_at();

-- Existing ai_interactions_log CHECK did not yet include community agent automation.
ALTER TABLE ai_interactions_log
  DROP CONSTRAINT IF EXISTS ai_interactions_log_interaction_type_check;

ALTER TABLE ai_interactions_log
  ADD CONSTRAINT ai_interactions_log_interaction_type_check
  CHECK (interaction_type IN (
    'chat_turn',
    'tool_call',
    'tool_result',
    'amora_director',
    'vendor_recommendation',
    'feedback',
    'community_amora_comment',
    'community_agent_auto'
  ));
