-- Community agent operating layer.
-- Agent identities are admin-managed and excluded from human-only analytics by backing_user_id.

CREATE TABLE IF NOT EXISTS community_agent_personas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  public_nickname TEXT NOT NULL,
  internal_label TEXT NOT NULL,
  role TEXT NOT NULL,
  public_mode TEXT NOT NULL DEFAULT 'persona' CHECK (public_mode IN ('persona', 'official')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'retired')),
  avatar_url TEXT,
  backing_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  behavior JSONB NOT NULL DEFAULT '{}'::jsonb,
  safety JSONB NOT NULL DEFAULT '{}'::jsonb,
  sample_lines TEXT[] NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_community_agents_status
  ON community_agent_personas(status, public_mode);

CREATE INDEX IF NOT EXISTS idx_community_agents_backing_user
  ON community_agent_personas(backing_user_id)
  WHERE backing_user_id IS NOT NULL;

ALTER TABLE community_agent_personas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "community_agent_personas_admin_select" ON community_agent_personas;
CREATE POLICY "community_agent_personas_admin_select"
  ON community_agent_personas FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

DROP POLICY IF EXISTS "community_agent_personas_admin_write" ON community_agent_personas;
CREATE POLICY "community_agent_personas_admin_write"
  ON community_agent_personas FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

CREATE TABLE IF NOT EXISTS community_agent_content_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES community_agent_personas(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('post', 'comment', 'reaction', 'cohort_message')),
  content_origin TEXT NOT NULL CHECK (content_origin IN ('question', 'comment', 'summary', 'news', 'checklist', 'reaction')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'needs_review', 'approved', 'posted', 'rejected', 'archived')),
  category TEXT,
  title TEXT,
  content TEXT NOT NULL,
  source_urls TEXT[] NOT NULL DEFAULT '{}',
  safety_flags TEXT[] NOT NULL DEFAULT '{}',
  verification_status TEXT NOT NULL DEFAULT 'source_not_required'
    CHECK (verification_status IN ('question_only', 'source_not_required', 'source_required', 'source_verified', 'blocked')),
  scheduled_for TIMESTAMPTZ,
  target_post_id UUID REFERENCES community_posts(id) ON DELETE SET NULL,
  target_comment_id UUID REFERENCES community_comments(id) ON DELETE SET NULL,
  target_cohort_room_id UUID REFERENCES cohort_rooms(id) ON DELETE SET NULL,
  posted_post_id UUID REFERENCES community_posts(id) ON DELETE SET NULL,
  posted_comment_id UUID REFERENCES community_comments(id) ON DELETE SET NULL,
  posted_cohort_message_id UUID REFERENCES cohort_messages(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  posted_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_community_agent_drafts_agent
  ON community_agent_content_drafts(agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_community_agent_drafts_status
  ON community_agent_content_drafts(status, scheduled_for);

ALTER TABLE community_agent_content_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "community_agent_drafts_admin_select" ON community_agent_content_drafts;
CREATE POLICY "community_agent_drafts_admin_select"
  ON community_agent_content_drafts FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

DROP POLICY IF EXISTS "community_agent_drafts_admin_write" ON community_agent_content_drafts;
CREATE POLICY "community_agent_drafts_admin_write"
  ON community_agent_content_drafts FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

CREATE TABLE IF NOT EXISTS community_agent_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES community_agent_personas(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL CHECK (action_type IN ('post', 'comment', 'reaction', 'cohort_message', 'draft', 'status_change', 'seed')),
  post_id UUID REFERENCES community_posts(id) ON DELETE SET NULL,
  comment_id UUID REFERENCES community_comments(id) ON DELETE SET NULL,
  cohort_message_id UUID REFERENCES cohort_messages(id) ON DELETE SET NULL,
  draft_id UUID REFERENCES community_agent_content_drafts(id) ON DELETE SET NULL,
  human_metrics_excluded BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_community_agent_activity_agent
  ON community_agent_activity_log(agent_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_community_agent_activity_type
  ON community_agent_activity_log(action_type, occurred_at DESC);

ALTER TABLE community_agent_activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "community_agent_activity_admin_select" ON community_agent_activity_log;
CREATE POLICY "community_agent_activity_admin_select"
  ON community_agent_activity_log FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

DROP POLICY IF EXISTS "community_agent_activity_admin_write" ON community_agent_activity_log;
CREATE POLICY "community_agent_activity_admin_write"
  ON community_agent_activity_log FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

CREATE OR REPLACE VIEW community_human_posts AS
SELECT p.*
FROM community_posts p
WHERE NOT EXISTS (
  SELECT 1
  FROM community_agent_personas a
  WHERE a.backing_user_id = p.author_id
);

CREATE OR REPLACE VIEW community_human_comments AS
SELECT c.*
FROM community_comments c
WHERE NOT EXISTS (
  SELECT 1
  FROM community_agent_personas a
  WHERE a.backing_user_id = c.author_id
);

CREATE OR REPLACE VIEW community_human_votes AS
SELECT v.*
FROM community_votes v
WHERE NOT EXISTS (
  SELECT 1
  FROM community_agent_personas a
  WHERE a.backing_user_id = v.user_id
);

CREATE OR REPLACE VIEW community_agent_daily_metrics AS
SELECT
  date_trunc('day', occurred_at)::date AS day,
  agent_id,
  action_type,
  COUNT(*)::INT AS action_count
FROM community_agent_activity_log
GROUP BY 1, 2, 3;

CREATE OR REPLACE FUNCTION community_agent_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_community_agents_updated_at ON community_agent_personas;
CREATE TRIGGER trg_community_agents_updated_at
BEFORE UPDATE ON community_agent_personas
FOR EACH ROW EXECUTE FUNCTION community_agent_touch_updated_at();

DROP TRIGGER IF EXISTS trg_community_agent_drafts_updated_at ON community_agent_content_drafts;
CREATE TRIGGER trg_community_agent_drafts_updated_at
BEFORE UPDATE ON community_agent_content_drafts
FOR EACH ROW EXECUTE FUNCTION community_agent_touch_updated_at();
