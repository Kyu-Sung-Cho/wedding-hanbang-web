-- Vendor supply pipeline.
-- Raw vendor leads are not public vendor listings. They are internal candidates
-- collected from public APIs, user mentions, referrals, wedding fairs, and
-- direct outreach until the vendor is verified or self-registers.

CREATE TABLE IF NOT EXISTS vendor_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  region TEXT,
  address TEXT,
  phone TEXT,
  email TEXT,
  website_url TEXT,
  instagram_url TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  source_url TEXT,
  source_place_id TEXT,
  status TEXT NOT NULL DEFAULT 'raw',
  priority_score INTEGER NOT NULL DEFAULT 0,
  estimated_price_min INTEGER,
  estimated_price_max INTEGER,
  proof_count INTEGER NOT NULL DEFAULT 0,
  mention_count INTEGER NOT NULL DEFAULT 0,
  outreach_channel TEXT,
  contacted_at TIMESTAMPTZ,
  next_follow_up_at TIMESTAMPTZ,
  converted_vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL,
  owner_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT vendor_leads_status_check CHECK (
    status IN ('raw', 'shortlisted', 'contacted', 'responded', 'onboarding', 'verified', 'rejected', 'duplicate')
  ),
  CONSTRAINT vendor_leads_source_check CHECK (
    source IN ('manual', 'naver_local', 'kakao_local', 'google_places', 'user_mention', 'referral', 'wedding_fair', 'self_register')
  )
);

CREATE INDEX IF NOT EXISTS idx_vendor_leads_status_priority
  ON vendor_leads(status, priority_score DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_vendor_leads_category_region
  ON vendor_leads(category, region);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_leads_source_place_unique
  ON vendor_leads(source, source_place_id)
  WHERE source_place_id IS NOT NULL;

DROP TRIGGER IF EXISTS set_vendor_leads_updated_at ON vendor_leads;
CREATE TRIGGER set_vendor_leads_updated_at
  BEFORE UPDATE ON vendor_leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE vendor_leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vendor_leads_admin_all" ON vendor_leads;
CREATE POLICY "vendor_leads_admin_all" ON vendor_leads FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
    OR auth.role() = 'service_role'
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
    OR auth.role() = 'service_role'
  );
