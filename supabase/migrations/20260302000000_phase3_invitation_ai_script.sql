-- Phase 3: 모바일 청첩장 + AI 대본 생성 시스템
-- 9개 테이블: invitation_templates, invitations, invitation_photos,
--   invitation_accounts, invitation_rsvp, invitation_guestbook,
--   invitation_visits, congratulatory_money, ai_scripts

-- ============================================================
-- 1. invitation_templates (청첩장 디자인 템플릿 30종)
-- ============================================================
CREATE TABLE IF NOT EXISTS invitation_templates (
  id TEXT PRIMARY KEY,                          -- T01 ~ T30
  name TEXT NOT NULL,                           -- 템플릿 이름
  category TEXT NOT NULL CHECK (category IN ('classic','modern','natural','season','unique')),
  thumbnail_url TEXT,                           -- 미리보기 이미지
  is_premium BOOLEAN DEFAULT FALSE,
  color_palette JSONB NOT NULL DEFAULT '[]',    -- ["#hex", ...]
  font_pair JSONB NOT NULL DEFAULT '{}',        -- {"heading":"...", "body":"..."}
  layout_config JSONB NOT NULL DEFAULT '{}',    -- 레이아웃 설정
  opening_animation TEXT DEFAULT 'fadeIn',       -- 기본 오프닝 애니메이션
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 2. invitations (유저가 만든 청첩장 인스턴스)
-- ============================================================
CREATE TABLE IF NOT EXISTS invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL REFERENCES invitation_templates(id),
  slug TEXT UNIQUE NOT NULL,                    -- 공유 URL 슬러그
  title TEXT DEFAULT '우리 결혼합니다',

  -- 신랑/신부 정보
  groom_name TEXT,
  groom_father TEXT,
  groom_mother TEXT,
  bride_name TEXT,
  bride_father TEXT,
  bride_mother TEXT,

  -- 예식 정보
  wedding_date TIMESTAMPTZ,
  wedding_venue TEXT,
  wedding_address TEXT,
  wedding_hall TEXT,                             -- 층/홀 이름
  wedding_map_url TEXT,                         -- 카카오맵/네이버맵 URL

  -- 인사말
  greeting_title TEXT DEFAULT '소중한 분들을 초대합니다',
  greeting_message TEXT,

  -- 설정
  opening_animation TEXT DEFAULT 'fadeIn',
  background_music_url TEXT,
  rsvp_enabled BOOLEAN DEFAULT TRUE,
  guestbook_enabled BOOLEAN DEFAULT TRUE,
  account_enabled BOOLEAN DEFAULT TRUE,

  -- 디자인 커스터마이징
  custom_colors JSONB,                          -- 템플릿 색상 오버라이드
  custom_fonts JSONB,                           -- 템플릿 폰트 오버라이드

  -- 메타
  is_published BOOLEAN DEFAULT FALSE,
  view_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_invitations_couple ON invitations(couple_id);
CREATE INDEX idx_invitations_slug ON invitations(slug);

-- ============================================================
-- 3. invitation_photos (청첩장 갤러리 사진)
-- ============================================================
CREATE TABLE IF NOT EXISTS invitation_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id UUID NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  caption TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_invitation_photos_inv ON invitation_photos(invitation_id);

-- ============================================================
-- 4. invitation_accounts (축의금 계좌 정보)
-- ============================================================
CREATE TABLE IF NOT EXISTS invitation_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id UUID NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  side TEXT NOT NULL CHECK (side IN ('groom','bride')),
  label TEXT NOT NULL,                          -- "신랑", "신랑 아버지" 등
  bank TEXT NOT NULL,                           -- "카카오뱅크", "국민은행"
  account_number TEXT NOT NULL,
  holder TEXT NOT NULL,                         -- 예금주
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_invitation_accounts_inv ON invitation_accounts(invitation_id);

-- ============================================================
-- 5. invitation_rsvp (참석 여부 응답)
-- ============================================================
CREATE TABLE IF NOT EXISTS invitation_rsvp (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id UUID NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  guest_name TEXT NOT NULL,
  phone TEXT,
  attending BOOLEAN NOT NULL,
  guest_count INTEGER DEFAULT 1,
  meal_option TEXT,                              -- '한식','양식','뷔페' 등
  side TEXT CHECK (side IN ('groom','bride','both')),
  message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_invitation_rsvp_inv ON invitation_rsvp(invitation_id);

-- ============================================================
-- 6. invitation_guestbook (축하 메시지)
-- ============================================================
CREATE TABLE IF NOT EXISTS invitation_guestbook (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id UUID NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  guest_name TEXT NOT NULL,
  message TEXT NOT NULL,
  password TEXT,                                 -- 삭제용 비밀번호 (해시)
  is_hidden BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_invitation_guestbook_inv ON invitation_guestbook(invitation_id);

-- ============================================================
-- 7. invitation_visits (방문 분석)
-- ============================================================
CREATE TABLE IF NOT EXISTS invitation_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id UUID NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  visitor_ip TEXT,
  user_agent TEXT,
  referrer TEXT,
  visited_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_invitation_visits_inv ON invitation_visits(invitation_id);
CREATE INDEX idx_invitation_visits_date ON invitation_visits(visited_at);

-- ============================================================
-- 8. congratulatory_money (축의금 내역 관리)
-- ============================================================
CREATE TABLE IF NOT EXISTS congratulatory_money (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  guest_name TEXT NOT NULL,
  amount INTEGER NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('groom','bride','both')),
  relation TEXT,                                -- '친구','직장동료','가족','친척' 등
  method TEXT DEFAULT 'cash' CHECK (method IN ('cash','transfer','etc')),
  memo TEXT,
  received_at DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_congratulatory_money_couple ON congratulatory_money(couple_id);

-- ============================================================
-- 9. ai_scripts (AI 웨딩 대본)
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_scripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  script_type TEXT NOT NULL CHECK (script_type IN (
    'mc_script','vow','parents_letter','friend_speech','invitation_text','thank_you'
  )),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  params JSONB DEFAULT '{}',                    -- 생성 시 사용된 파라미터
  is_favorite BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ai_scripts_couple ON ai_scripts(couple_id);
CREATE INDEX idx_ai_scripts_type ON ai_scripts(script_type);

-- ============================================================
-- RLS 정책
-- ============================================================

ALTER TABLE invitation_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitation_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitation_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitation_rsvp ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitation_guestbook ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitation_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE congratulatory_money ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_scripts ENABLE ROW LEVEL SECURITY;

-- 템플릿: 누구나 조회 가능
CREATE POLICY "templates_select" ON invitation_templates FOR SELECT USING (true);

-- 청첩장: 커플만 CRUD
CREATE POLICY "invitations_owner" ON invitations FOR ALL
  USING (couple_id IN (SELECT id FROM couples WHERE bride_id = auth.uid() OR groom_id = auth.uid()));

-- 사진: 청첩장 소유자만
CREATE POLICY "photos_owner" ON invitation_photos FOR ALL
  USING (invitation_id IN (
    SELECT i.id FROM invitations i
    JOIN couples c ON i.couple_id = c.id
    WHERE c.bride_id = auth.uid() OR c.groom_id = auth.uid()
  ));

-- 계좌: 청첩장 소유자만
CREATE POLICY "accounts_owner" ON invitation_accounts FOR ALL
  USING (invitation_id IN (
    SELECT i.id FROM invitations i
    JOIN couples c ON i.couple_id = c.id
    WHERE c.bride_id = auth.uid() OR c.groom_id = auth.uid()
  ));

-- RSVP: 누구나 INSERT, 소유자만 조회
CREATE POLICY "rsvp_insert" ON invitation_rsvp FOR INSERT WITH CHECK (true);
CREATE POLICY "rsvp_owner_select" ON invitation_rsvp FOR SELECT
  USING (invitation_id IN (
    SELECT i.id FROM invitations i
    JOIN couples c ON i.couple_id = c.id
    WHERE c.bride_id = auth.uid() OR c.groom_id = auth.uid()
  ));

-- 방명록: 누구나 INSERT/SELECT, 소유자만 UPDATE/DELETE
CREATE POLICY "guestbook_insert" ON invitation_guestbook FOR INSERT WITH CHECK (true);
CREATE POLICY "guestbook_select" ON invitation_guestbook FOR SELECT USING (true);
CREATE POLICY "guestbook_owner_manage" ON invitation_guestbook FOR UPDATE
  USING (invitation_id IN (
    SELECT i.id FROM invitations i
    JOIN couples c ON i.couple_id = c.id
    WHERE c.bride_id = auth.uid() OR c.groom_id = auth.uid()
  ));
CREATE POLICY "guestbook_owner_delete" ON invitation_guestbook FOR DELETE
  USING (invitation_id IN (
    SELECT i.id FROM invitations i
    JOIN couples c ON i.couple_id = c.id
    WHERE c.bride_id = auth.uid() OR c.groom_id = auth.uid()
  ));

-- 방문 기록: 누구나 INSERT, 소유자만 조회
CREATE POLICY "visits_insert" ON invitation_visits FOR INSERT WITH CHECK (true);
CREATE POLICY "visits_owner_select" ON invitation_visits FOR SELECT
  USING (invitation_id IN (
    SELECT i.id FROM invitations i
    JOIN couples c ON i.couple_id = c.id
    WHERE c.bride_id = auth.uid() OR c.groom_id = auth.uid()
  ));

-- 축의금: 커플만 CRUD
CREATE POLICY "money_owner" ON congratulatory_money FOR ALL
  USING (couple_id IN (SELECT id FROM couples WHERE bride_id = auth.uid() OR groom_id = auth.uid()));

-- AI 대본: 커플만 CRUD
CREATE POLICY "scripts_owner" ON ai_scripts FOR ALL
  USING (couple_id IN (SELECT id FROM couples WHERE bride_id = auth.uid() OR groom_id = auth.uid()));

-- ============================================================
-- updated_at 자동 갱신 트리거
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_invitations_updated_at
  BEFORE UPDATE ON invitations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_congratulatory_money_updated_at
  BEFORE UPDATE ON congratulatory_money
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_ai_scripts_updated_at
  BEFORE UPDATE ON ai_scripts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 30개 템플릿 시드 데이터
-- ============================================================

INSERT INTO invitation_templates (id, name, category, is_premium, color_palette, font_pair, layout_config, opening_animation)
VALUES
  -- ═══════════ 클래식 (T01-T06) ═══════════
  ('T01', '클래식 로즈', 'classic', false,
    '["#C4967E","#FDFAF7","#2C2420"]',
    '{"heading":"Cormorant Garamond","body":"Noto Sans KR"}',
    '{"heroStyle":"full","photoGrid":"2x2"}',
    'fadeIn'),
  ('T02', '골드 엘레강스', 'classic', false,
    '["#B89B6A","#FFFCF5","#2A2520"]',
    '{"heading":"Cormorant Garamond","body":"Noto Sans KR"}',
    '{"heroStyle":"center","photoGrid":"1x3"}',
    'slideUp'),
  ('T03', '네이비 포멀', 'classic', true,
    '["#2B3A55","#F5F0E8","#B89B6A"]',
    '{"heading":"Cormorant Garamond","body":"Noto Sans KR"}',
    '{"heroStyle":"split","photoGrid":"2x2"}',
    'curtainOpen'),
  ('T04', '피오니 블러쉬', 'classic', false,
    '["#D4A0A0","#FFF7F5","#3A2E2E"]',
    '{"heading":"Noto Serif KR","body":"Noto Sans KR"}',
    '{"heroStyle":"full","photoGrid":"2x2"}',
    'heartBeat'),
  ('T05', '아이보리 레이스', 'classic', false,
    '["#C8B9A6","#FFFDF8","#35302A"]',
    '{"heading":"Noto Serif KR","body":"Noto Sans KR"}',
    '{"heroStyle":"center","photoGrid":"masonry"}',
    'fadeIn'),
  ('T06', '버건디 와인', 'classic', true,
    '["#7A3B4E","#FDF5F0","#2C1E22"]',
    '{"heading":"Cormorant Garamond","body":"Noto Serif KR"}',
    '{"heroStyle":"full","photoGrid":"1x3"}',
    'curtainOpen'),

  -- ═══════════ 모던 (T07-T12) ═══════════
  ('T07', '미니멀 화이트', 'modern', false,
    '["#1A1A1F","#FFFFFF","#888888"]',
    '{"heading":"Pretendard","body":"Pretendard"}',
    '{"heroStyle":"minimal","photoGrid":"1x3"}',
    'typewriter'),
  ('T08', '모카 브라운', 'modern', false,
    '["#6B5344","#FAF7F4","#2C2420"]',
    '{"heading":"Pretendard","body":"Noto Sans KR"}',
    '{"heroStyle":"center","photoGrid":"2x2"}',
    'slideUp'),
  ('T09', '테라코타', 'modern', false,
    '["#C07252","#FEF6F0","#3A2A22"]',
    '{"heading":"Pretendard","body":"Noto Sans KR"}',
    '{"heroStyle":"full","photoGrid":"masonry"}',
    'fadeIn'),
  ('T10', '세이지 모던', 'modern', false,
    '["#7A8E7A","#F5F7F4","#2C322C"]',
    '{"heading":"Pretendard","body":"Noto Sans KR"}',
    '{"heroStyle":"minimal","photoGrid":"2x2"}',
    'slideUp'),
  ('T11', '더스티 블루', 'modern', false,
    '["#7B9BB5","#F4F7FA","#2A3440"]',
    '{"heading":"Noto Sans KR","body":"Noto Sans KR"}',
    '{"heroStyle":"center","photoGrid":"1x3"}',
    'fadeIn'),
  ('T12', '그레이 시크', 'modern', true,
    '["#5A5A5A","#F8F8F8","#1A1A1A"]',
    '{"heading":"Pretendard","body":"Pretendard"}',
    '{"heroStyle":"minimal","photoGrid":"2x2"}',
    'typewriter'),

  -- ═══════════ 내추럴 (T13-T18) ═══════════
  ('T13', '보태니컬 가든', 'natural', false,
    '["#4A7C59","#F2F5EB","#2A3A2E"]',
    '{"heading":"Noto Serif KR","body":"Noto Sans KR"}',
    '{"heroStyle":"full","photoGrid":"masonry"}',
    'leafFall'),
  ('T14', '올리브 그린', 'natural', false,
    '["#6B7F3C","#F8F6EE","#3A3820"]',
    '{"heading":"Noto Serif KR","body":"Noto Sans KR"}',
    '{"heroStyle":"center","photoGrid":"2x2"}',
    'fadeIn'),
  ('T15', '라벤더 필드', 'natural', true,
    '["#8E7BAE","#F8F4FC","#3A2E44"]',
    '{"heading":"Cormorant Garamond","body":"Noto Sans KR"}',
    '{"heroStyle":"full","photoGrid":"1x3"}',
    'floatUp'),
  ('T16', '유칼립투스', 'natural', false,
    '["#6B9E8A","#F0F6F2","#2A3E34"]',
    '{"heading":"Noto Serif KR","body":"Noto Sans KR"}',
    '{"heroStyle":"center","photoGrid":"2x2"}',
    'slideUp'),
  ('T17', '피치 블룸', 'natural', false,
    '["#D49B7A","#FFF5EE","#3A2E24"]',
    '{"heading":"Noto Serif KR","body":"Noto Sans KR"}',
    '{"heroStyle":"full","photoGrid":"masonry"}',
    'fadeIn'),
  ('T18', '와일드플라워', 'natural', true,
    '["#B87D9E","#FBF3F7","#3A2430"]',
    '{"heading":"Cormorant Garamond","body":"Noto Sans KR"}',
    '{"heroStyle":"full","photoGrid":"1x3"}',
    'petalFall'),

  -- ═══════════ 시즌 (T19-T24) ═══════════
  ('T19', '봄 벚꽃', 'season', false,
    '["#E8A0B4","#FFF5F7","#5A3040"]',
    '{"heading":"Noto Serif KR","body":"Noto Sans KR"}',
    '{"heroStyle":"full","photoGrid":"2x2","season":"spring"}',
    'petalFall'),
  ('T20', '여름 바다', 'season', false,
    '["#3A8CB8","#F0F8FF","#1A3A50"]',
    '{"heading":"Pretendard","body":"Noto Sans KR"}',
    '{"heroStyle":"center","photoGrid":"1x3","season":"summer"}',
    'waveSlide'),
  ('T21', '가을 단풍', 'season', false,
    '["#C07840","#FDF5EC","#3A2818"]',
    '{"heading":"Noto Serif KR","body":"Noto Sans KR"}',
    '{"heroStyle":"full","photoGrid":"masonry","season":"autumn"}',
    'leafFall'),
  ('T22', '겨울 눈꽃', 'season', false,
    '["#8AADCC","#F5F9FD","#2A3A4A"]',
    '{"heading":"Noto Serif KR","body":"Noto Sans KR"}',
    '{"heroStyle":"center","photoGrid":"2x2","season":"winter"}',
    'snowFall'),
  ('T23', '봄 가든', 'season', true,
    '["#7DB87D","#F0F8F0","#2A4A2A"]',
    '{"heading":"Noto Serif KR","body":"Pretendard"}',
    '{"heroStyle":"full","photoGrid":"2x2","season":"spring"}',
    'floatUp'),
  ('T24', '가을 저녁', 'season', true,
    '["#B8734A","#F8F0E8","#3A2A1A"]',
    '{"heading":"Noto Serif KR","body":"Noto Sans KR"}',
    '{"heroStyle":"full","photoGrid":"masonry","season":"autumn"}',
    'fadeIn'),

  -- ═══════════ 유니크 (T25-T30) ═══════════
  ('T25', '빈티지 필름', 'unique', true,
    '["#8B7355","#F5ECD7","#4A3C28"]',
    '{"heading":"Cormorant Garamond","body":"Noto Sans KR"}',
    '{"heroStyle":"full","photoGrid":"2x2"}',
    'filmRoll'),
  ('T26', '수채화 드림', 'unique', true,
    '["#7AAEC0","#FBF8F5","#B88DA0"]',
    '{"heading":"Noto Serif KR","body":"Noto Sans KR"}',
    '{"heroStyle":"center","photoGrid":"masonry"}',
    'waterDrop'),
  ('T27', '한지 전통', 'unique', true,
    '["#8B5E3C","#F8F2E8","#2A2018"]',
    '{"heading":"Noto Serif KR","body":"Noto Sans KR"}',
    '{"heroStyle":"full","photoGrid":"2x2"}',
    'letterOpen'),
  ('T28', '아르데코', 'unique', true,
    '["#C9A96E","#1A1A2E","#F0E8D8"]',
    '{"heading":"Cormorant Garamond","body":"Pretendard"}',
    '{"heroStyle":"center","photoGrid":"1x3"}',
    'sparkle'),
  ('T29', '파스텔 드림', 'unique', false,
    '["#B0C4DE","#FFF8FC","#9E8E9E"]',
    '{"heading":"Noto Serif KR","body":"Noto Sans KR"}',
    '{"heroStyle":"center","photoGrid":"2x2"}',
    'fadeIn'),
  ('T30', '선셋 골드', 'unique', false,
    '["#D4956A","#FFF8F0","#5A3A2A"]',
    '{"heading":"Cormorant Garamond","body":"Noto Sans KR"}',
    '{"heroStyle":"full","photoGrid":"masonry"}',
    'fadeIn')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  is_premium = EXCLUDED.is_premium,
  color_palette = EXCLUDED.color_palette,
  font_pair = EXCLUDED.font_pair,
  layout_config = EXCLUDED.layout_config,
  opening_animation = EXCLUDED.opening_animation;
