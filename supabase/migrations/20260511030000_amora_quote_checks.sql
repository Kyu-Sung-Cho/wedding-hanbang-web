-- Amora Quote Check evidence loop
-- Stores user-initiated quote checks so Wedding Hanbang can build an anonymized
-- fairness dataset over time without exposing private quotes publicly.

CREATE TABLE IF NOT EXISTS amora_quote_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  couple_id UUID REFERENCES couples(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK (category IN ('sdm_package', 'studio', 'dress', 'makeup')),
  region TEXT NOT NULL CHECK (region IN ('seoul', 'gyeonggi', 'busan', 'daegu', 'other')),
  vendor_name TEXT,
  quote_price_manwon NUMERIC(10,2) NOT NULL CHECK (quote_price_manwon > 0),
  included_item_ids TEXT[] NOT NULL DEFAULT '{}',
  memo TEXT,
  analysis JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL DEFAULT 'community_quote_check',
  community_post_id UUID REFERENCES community_posts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_amora_quote_checks_user_time
  ON amora_quote_checks(user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_amora_quote_checks_couple_time
  ON amora_quote_checks(couple_id, created_at DESC)
  WHERE couple_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_amora_quote_checks_category_region
  ON amora_quote_checks(category, region, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_amora_quote_checks_vendor
  ON amora_quote_checks(vendor_name)
  WHERE vendor_name IS NOT NULL;

ALTER TABLE amora_quote_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "amora_quote_checks_owner_select" ON amora_quote_checks;
CREATE POLICY "amora_quote_checks_owner_select"
  ON amora_quote_checks FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "amora_quote_checks_admin_select" ON amora_quote_checks;
CREATE POLICY "amora_quote_checks_admin_select"
  ON amora_quote_checks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.is_admin = true
    )
  );

DROP POLICY IF EXISTS "amora_quote_checks_service_all" ON amora_quote_checks;
CREATE POLICY "amora_quote_checks_service_all"
  ON amora_quote_checks FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP TRIGGER IF EXISTS set_amora_quote_checks_updated_at ON amora_quote_checks;
CREATE TRIGGER set_amora_quote_checks_updated_at
  BEFORE UPDATE ON amora_quote_checks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE amora_quote_checks IS
'Private quote-check submissions used to build Amora fairness intelligence. Public analytics must be aggregated and anonymized.';

COMMENT ON COLUMN amora_quote_checks.analysis IS
'Deterministic Amora quote-check output: verdict, hidden-fee estimate, missing items, contract questions, and source notes.';
