-- ============================================================
-- 003: 온보딩 + 커플 연동 + 채팅 시스템
-- Supabase SQL Editor에서 실행
-- ============================================================

-- 1. couples 테이블 (없으면 생성)
CREATE TABLE IF NOT EXISTS couples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_code TEXT UNIQUE,
  bride_id UUID REFERENCES auth.users(id),
  groom_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. profiles 테이블 컬럼 추가
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role TEXT CHECK (role IN ('bride', 'groom'));
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS couple_id UUID REFERENCES couples(id) ON DELETE SET NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarding_step INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_profiles_couple_id ON profiles(couple_id);

-- 3. wedding_journeys 테이블 (없으면 생성)
CREATE TABLE IF NOT EXISTS wedding_journeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID REFERENCES couples(id) ON DELETE CASCADE,
  wedding_date DATE,
  venue TEXT,
  total_budget BIGINT DEFAULT 0,
  progress JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wedding_journeys_couple_id ON wedding_journeys(couple_id);

-- 4. chat_messages 테이블 (없으면 생성)
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID REFERENCES couples(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES auth.users(id),
  sender_role TEXT CHECK (sender_role IN ('bride', 'groom', 'ai')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_couple_id ON chat_messages(couple_id, created_at);

-- 5. 초대 코드 생성 함수
CREATE OR REPLACE FUNCTION generate_invite_code()
RETURNS TEXT AS $$
DECLARE
  code TEXT;
  code_exists BOOLEAN;
BEGIN
  LOOP
    code := 'WH-' || upper(substr(md5(random()::text), 1, 6));
    SELECT EXISTS(SELECT 1 FROM couples WHERE invite_code = code) INTO code_exists;
    EXIT WHEN NOT code_exists;
  END LOOP;
  RETURN code;
END;
$$ LANGUAGE plpgsql;

-- 6. 신규 유저 프로필 자동 생성 트리거
CREATE OR REPLACE FUNCTION create_profile_on_signup()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, name, email, onboarding_completed, onboarding_step)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.email,
    false,
    0
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION create_profile_on_signup();

-- 7. RLS 정책 - profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own" ON profiles;
CREATE POLICY "profiles_select_own" ON profiles FOR SELECT
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
CREATE POLICY "profiles_insert_own" ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_select_couple" ON profiles;
CREATE POLICY "profiles_select_couple" ON profiles FOR SELECT
  USING (couple_id IN (SELECT couple_id FROM profiles WHERE id = auth.uid()));

-- 8. RLS 정책 - couples
ALTER TABLE couples ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "couples_select_own" ON couples;
CREATE POLICY "couples_select_own" ON couples FOR SELECT
  USING (bride_id = auth.uid() OR groom_id = auth.uid());

DROP POLICY IF EXISTS "couples_insert_own" ON couples;
CREATE POLICY "couples_insert_own" ON couples FOR INSERT
  WITH CHECK (auth.uid() = bride_id OR auth.uid() = groom_id);

DROP POLICY IF EXISTS "couples_update_own" ON couples;
CREATE POLICY "couples_update_own" ON couples FOR UPDATE
  USING (bride_id = auth.uid() OR groom_id = auth.uid());

-- 초대 코드로 커플 조회 허용 (조인 시 필요)
DROP POLICY IF EXISTS "couples_select_by_code" ON couples;
CREATE POLICY "couples_select_by_code" ON couples FOR SELECT
  USING (invite_code IS NOT NULL);

-- 9. RLS 정책 - wedding_journeys
ALTER TABLE wedding_journeys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "journeys_select_couple" ON wedding_journeys;
CREATE POLICY "journeys_select_couple" ON wedding_journeys FOR SELECT
  USING (couple_id IN (SELECT couple_id FROM profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "journeys_insert_couple" ON wedding_journeys;
CREATE POLICY "journeys_insert_couple" ON wedding_journeys FOR INSERT
  WITH CHECK (couple_id IN (SELECT couple_id FROM profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "journeys_update_couple" ON wedding_journeys;
CREATE POLICY "journeys_update_couple" ON wedding_journeys FOR UPDATE
  USING (couple_id IN (SELECT couple_id FROM profiles WHERE id = auth.uid()));

-- 10. RLS 정책 - chat_messages
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_select_couple" ON chat_messages;
CREATE POLICY "chat_select_couple" ON chat_messages FOR SELECT
  USING (couple_id IN (SELECT couple_id FROM profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "chat_insert_couple" ON chat_messages;
CREATE POLICY "chat_insert_couple" ON chat_messages FOR INSERT
  WITH CHECK (couple_id IN (SELECT couple_id FROM profiles WHERE id = auth.uid()));

-- 11. Realtime 활성화 (이미 등록되어 있으면 스킵)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'chat_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
  END IF;
END $$;
