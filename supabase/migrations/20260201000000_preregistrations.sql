-- 사전등록 테이블
CREATE TABLE IF NOT EXISTS preregistrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  wedding_date TEXT,
  source TEXT DEFAULT 'web',
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE preregistrations ENABLE ROW LEVEL SECURITY;

-- Service role만 관리 가능
CREATE POLICY "Service role can manage" ON preregistrations FOR ALL USING (true);
