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
  -- 클래식 (T01-T08)
  ('T01', '로즈 클래식', 'classic', false,
    '["#C4967E","#FDFCFA","#1A1A1F"]',
    '{"heading":"Noto Serif KR","body":"Noto Sans KR"}',
    '{"heroStyle":"full","photoGrid":"2x2"}',
    'fadeIn'),
  ('T02', '골드 엘레강스', 'classic', false,
    '["#C9A96E","#FFFEF5","#2C2C2C"]',
    '{"heading":"Cormorant Garamond","body":"Noto Sans KR"}',
    '{"heroStyle":"split","photoGrid":"1x3"}',
    'slideUp'),
  ('T03', '아이보리 로맨스', 'classic', false,
    '["#D4AFA0","#FAF8F5","#3A3A3A"]',
    '{"heading":"Noto Serif KR","body":"Noto Sans KR"}',
    '{"heroStyle":"full","photoGrid":"masonry"}',
    'zoomIn'),
  ('T04', '진주 화이트', 'classic', false,
    '["#E8E4E0","#FFFFFF","#1A1A1F"]',
    '{"heading":"Cormorant Garamond","body":"Noto Sans KR"}',
    '{"heroStyle":"center","photoGrid":"2x2"}',
    'fadeIn'),
  ('T05', '버건디 나이트', 'classic', true,
    '["#722F37","#FFF8F0","#2C1810"]',
    '{"heading":"Noto Serif KR","body":"Noto Sans KR"}',
    '{"heroStyle":"full","photoGrid":"1x3"}',
    'curtainOpen'),
  ('T06', '네이비 포멀', 'classic', true,
    '["#1B2A4A","#F5F0E8","#C9A96E"]',
    '{"heading":"Cormorant Garamond","body":"Noto Sans KR"}',
    '{"heroStyle":"split","photoGrid":"2x2"}',
    'slideUp'),
  ('T07', '샴페인 글로우', 'classic', false,
    '["#D4C5A9","#FFFDF7","#4A4035"]',
    '{"heading":"Noto Serif KR","body":"Noto Sans KR"}',
    '{"heroStyle":"center","photoGrid":"masonry"}',
    'sparkle'),
  ('T08', '블러쉬 핑크', 'classic', false,
    '["#E8B4B8","#FFF5F5","#3A2C2C"]',
    '{"heading":"Cormorant Garamond","body":"Noto Sans KR"}',
    '{"heroStyle":"full","photoGrid":"2x2"}',
    'heartBeat'),

  -- 모던 (T09-T16)
  ('T09', '미니멀 블랙', 'modern', false,
    '["#1A1A1F","#FFFFFF","#C4967E"]',
    '{"heading":"Pretendard","body":"Pretendard"}',
    '{"heroStyle":"minimal","photoGrid":"1x1"}',
    'typewriter'),
  ('T10', '모노톤 시크', 'modern', false,
    '["#333333","#F5F5F5","#999999"]',
    '{"heading":"Pretendard","body":"Pretendard"}',
    '{"heroStyle":"asymmetric","photoGrid":"2x2"}',
    'slideUp'),
  ('T11', '네온 팝', 'modern', true,
    '["#FF6B9D","#0D0D0F","#00D2FF"]',
    '{"heading":"Pretendard","body":"Pretendard"}',
    '{"heroStyle":"bold","photoGrid":"collage"}',
    'glitch'),
  ('T12', '그래디언트 드림', 'modern', true,
    '["#667EEA","#764BA2","#FFFFFF"]',
    '{"heading":"Pretendard","body":"Pretendard"}',
    '{"heroStyle":"gradient","photoGrid":"1x3"}',
    'morphing'),
  ('T13', '클린 라인', 'modern', false,
    '["#2D3436","#FAFAFA","#E17055"]',
    '{"heading":"Pretendard","body":"Pretendard"}',
    '{"heroStyle":"line","photoGrid":"2x2"}',
    'fadeIn'),
  ('T14', '소프트 그레이', 'modern', false,
    '["#636E72","#F0F0F0","#DFE6E9"]',
    '{"heading":"Pretendard","body":"Pretendard"}',
    '{"heroStyle":"center","photoGrid":"masonry"}',
    'slideUp'),
  ('T15', '볼드 타이포', 'modern', true,
    '["#1A1A1F","#FDFCFA","#C4967E"]',
    '{"heading":"Pretendard","body":"Pretendard"}',
    '{"heroStyle":"typography","photoGrid":"1x1"}',
    'typewriter'),
  ('T16', '듀오톤', 'modern', false,
    '["#2C3E50","#E74C3C","#ECF0F1"]',
    '{"heading":"Pretendard","body":"Pretendard"}',
    '{"heroStyle":"duotone","photoGrid":"2x2"}',
    'fadeIn'),

  -- 내추럴 (T17-T21)
  ('T17', '보태니컬 가든', 'natural', false,
    '["#2D5016","#F5F0E8","#8B7355"]',
    '{"heading":"Noto Serif KR","body":"Noto Sans KR"}',
    '{"heroStyle":"botanical","photoGrid":"masonry"}',
    'leafFall'),
  ('T18', '러스틱 우드', 'natural', false,
    '["#8B6914","#FFF8EE","#5C4033"]',
    '{"heading":"Noto Serif KR","body":"Noto Sans KR"}',
    '{"heroStyle":"rustic","photoGrid":"2x2"}',
    'fadeIn'),
  ('T19', '라벤더 필드', 'natural', true,
    '["#9B59B6","#F8F0FF","#6C3483"]',
    '{"heading":"Noto Serif KR","body":"Noto Sans KR"}',
    '{"heroStyle":"field","photoGrid":"1x3"}',
    'floatUp'),
  ('T20', '선셋 가든', 'natural', false,
    '["#E67E22","#FFF5EB","#D35400"]',
    '{"heading":"Noto Serif KR","body":"Noto Sans KR"}',
    '{"heroStyle":"sunset","photoGrid":"masonry"}',
    'slideUp'),
  ('T21', '포레스트 그린', 'natural', true,
    '["#1E8449","#F0FFF0","#0B5345"]',
    '{"heading":"Noto Serif KR","body":"Noto Sans KR"}',
    '{"heroStyle":"forest","photoGrid":"2x2"}',
    'leafFall'),

  -- 시즌 (T22-T26) — Pretendard 폰트 사용
  ('T22', '봄 벚꽃', 'season', false,
    '["#FFB7C5","#FFF5F7","#8B4557"]',
    '{"heading":"Noto Serif KR","body":"Pretendard"}',
    '{"heroStyle":"sakura","photoGrid":"2x2","season":"spring"}',
    'petalFall'),
  ('T23', '여름 바다', 'season', false,
    '["#0077B6","#F0F8FF","#023E8A"]',
    '{"heading":"Noto Serif KR","body":"Pretendard"}',
    '{"heroStyle":"ocean","photoGrid":"1x3","season":"summer"}',
    'waveSlide'),
  ('T24', '가을 단풍', 'season', false,
    '["#D4A574","#FFF8F0","#8B4513"]',
    '{"heading":"Noto Serif KR","body":"Pretendard"}',
    '{"heroStyle":"autumn","photoGrid":"masonry","season":"autumn"}',
    'leafFall'),
  ('T25', '겨울 눈꽃', 'season', false,
    '["#AED6F1","#F8FBFF","#2471A3"]',
    '{"heading":"Noto Serif KR","body":"Pretendard"}',
    '{"heroStyle":"snow","photoGrid":"2x2","season":"winter"}',
    'snowFall'),
  ('T26', '크리스마스', 'season', true,
    '["#C0392B","#FFF5F5","#196F3D"]',
    '{"heading":"Noto Serif KR","body":"Pretendard"}',
    '{"heroStyle":"christmas","photoGrid":"collage","season":"winter"}',
    'sparkle'),

  -- 유니크 (T27-T30)
  ('T27', '빈티지 필름', 'unique', true,
    '["#8B7355","#F5ECD7","#5C4033"]',
    '{"heading":"Cormorant Garamond","body":"Noto Sans KR"}',
    '{"heroStyle":"film","photoGrid":"polaroid"}',
    'filmRoll'),
  ('T28', '동화 속 하루', 'unique', true,
    '["#FFD700","#FFFEF5","#8B6914"]',
    '{"heading":"Noto Serif KR","body":"Noto Sans KR"}',
    '{"heroStyle":"fairytale","photoGrid":"storybook"}',
    'pageFlip'),
  ('T29', '수채화 드림', 'unique', true,
    '["#AEC6CF","#FFF8F5","#E8B4B8"]',
    '{"heading":"Noto Serif KR","body":"Noto Sans KR"}',
    '{"heroStyle":"watercolor","photoGrid":"masonry"}',
    'waterDrop'),
  ('T30', '레트로 팝', 'unique', true,
    '["#FF6B6B","#FFF3CD","#4ECDC4"]',
    '{"heading":"Pretendard","body":"Pretendard"}',
    '{"heroStyle":"retro","photoGrid":"collage"}',
    'glitch')
ON CONFLICT (id) DO NOTHING;
