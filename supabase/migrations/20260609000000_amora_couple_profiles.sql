-- =============================================
-- Amora Couple Profiles
-- =============================================
-- Long-lived personalization memory for Amora.
-- It is separate from chat_summaries / decision_nodes:
--   - chat_summaries: what happened recently
--   - decision_nodes: explicit decisions/preferences
--   - amora_couple_profiles: how Amora should adapt to this couple
--
-- visibility follows the private chat model:
--   shared         = usable in shared Amora conversations
--   bride_private  = only usable in bride private conversations
--   groom_private  = only usable in groom private conversations
-- =============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS amora_couple_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  visibility TEXT NOT NULL DEFAULT 'shared'
    CHECK (visibility IN ('shared', 'bride_private', 'groom_private')),

  persona_summary TEXT,
  budget_posture TEXT,
  decision_style TEXT,
  taste_profile TEXT,
  communication_style TEXT,
  conflict_pattern TEXT,

  sensitive_topics TEXT[] NOT NULL DEFAULT '{}',
  recommendation_rules TEXT[] NOT NULL DEFAULT '{}',
  open_questions TEXT[] NOT NULL DEFAULT '{}',

  confidence_score NUMERIC(3,2) NOT NULL DEFAULT 0.50
    CHECK (confidence_score >= 0 AND confidence_score <= 1),
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  version INTEGER NOT NULL DEFAULT 1,
  last_compiled_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_amora_couple_profiles_unique
  ON amora_couple_profiles(couple_id, visibility);

CREATE INDEX IF NOT EXISTS idx_amora_couple_profiles_couple_visibility
  ON amora_couple_profiles(couple_id, visibility);

ALTER TABLE amora_couple_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "amora_couple_profiles_select_with_privacy" ON amora_couple_profiles;
CREATE POLICY "amora_couple_profiles_select_with_privacy" ON amora_couple_profiles FOR SELECT
USING (
  couple_id IN (
    SELECT id FROM couples
    WHERE bride_id = auth.uid() OR groom_id = auth.uid()
  )
  AND (
    visibility = 'shared'
    OR (
      visibility = 'bride_private'
      AND EXISTS (
        SELECT 1 FROM couples
        WHERE id = amora_couple_profiles.couple_id AND bride_id = auth.uid()
      )
    )
    OR (
      visibility = 'groom_private'
      AND EXISTS (
        SELECT 1 FROM couples
        WHERE id = amora_couple_profiles.couple_id AND groom_id = auth.uid()
      )
    )
  )
);

DROP POLICY IF EXISTS "amora_couple_profiles_service_all" ON amora_couple_profiles;
CREATE POLICY "amora_couple_profiles_service_all"
  ON amora_couple_profiles FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP TRIGGER IF EXISTS set_amora_couple_profiles_updated_at ON amora_couple_profiles;
CREATE TRIGGER set_amora_couple_profiles_updated_at
  BEFORE UPDATE ON amora_couple_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE amora_couple_profiles IS
  'Amora long-lived personalization profile per couple and visibility. Generated silently from chat turns; not global model training.';
COMMENT ON COLUMN amora_couple_profiles.visibility IS
  'shared = both partners can benefit, bride_private/groom_private = private Amora counseling only.';
COMMENT ON COLUMN amora_couple_profiles.recommendation_rules IS
  'Practical rules Amora should apply before asking another question, to reduce paid/free turn waste.';
