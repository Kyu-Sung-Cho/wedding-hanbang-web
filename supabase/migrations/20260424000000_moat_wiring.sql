-- =============================================
-- Moat Wiring (2026-04-24) — Bucket C
-- 목적: AI 의사결정 그래프 + 상호작용 로깅 + 계약 조항 참조 +
--       vendor_bookings 실거래 추적 컬럼
-- =============================================
-- 대상:
--   1. decision_nodes        (신규) — 커플 의사결정 노드
--   2. decision_edges        (신규) — 노드 간 관계
--   3. ai_interactions_log   (신규) — 모든 AI 호출 로그
--   4. standard_contract_clauses (신규) — 표준 계약 조항 라이브러리
--   5. chat_messages ALTER   — stage_tag, specialist_type
--   6. vendor_bookings ALTER — contracted_amount, actual_amount,
--                              user_uploaded_receipt_url,
--                              contract_signed_at,
--                              receipt_verified_at,
--                              receipt_verified_by
-- 패턴 (Bucket A/B에서 검증):
--   - CREATE TABLE IF NOT EXISTS (id + created_at만으로 시작)
--   - ALTER TABLE ADD COLUMN IF NOT EXISTS (컬럼 보강)
--   - DROP POLICY IF EXISTS → CREATE POLICY (정책 재실행 안전)
--   - DO 블록으로 UNIQUE/트리거 조건부 생성
-- =============================================


-- ---------------------------------------------
-- 0. 공용 트리거 함수 (기존 재사용, 없으면 생성)
-- ---------------------------------------------

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ---------------------------------------------
-- 1. decision_nodes — 커플 의사결정 노드
-- ---------------------------------------------

CREATE TABLE IF NOT EXISTS decision_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE decision_nodes ADD COLUMN IF NOT EXISTS couple_id UUID
  REFERENCES couples(id) ON DELETE CASCADE;
ALTER TABLE decision_nodes ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE decision_nodes ADD COLUMN IF NOT EXISTS decision_type TEXT DEFAULT 'exploring'
  CHECK (decision_type IN ('exploring','considering','decided','scheduled','booked','completed'));
ALTER TABLE decision_nodes ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE decision_nodes ADD COLUMN IF NOT EXISTS chosen_value JSONB;
ALTER TABLE decision_nodes ADD COLUMN IF NOT EXISTS options_considered JSONB DEFAULT '[]'::jsonb;
ALTER TABLE decision_nodes ADD COLUMN IF NOT EXISTS reasoning TEXT;
ALTER TABLE decision_nodes ADD COLUMN IF NOT EXISTS confidence NUMERIC(3,2) DEFAULT 0.50;
ALTER TABLE decision_nodes ADD COLUMN IF NOT EXISTS stage_tag TEXT
  CHECK (stage_tag IS NULL OR stage_tag IN ('planning_0','preparation_1','execution_2','ceremony_3','settlement_4'));
ALTER TABLE decision_nodes ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;
ALTER TABLE decision_nodes ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'chat'
  CHECK (source IN ('chat','manual','import','vendor_booking','schedule','budget','onboarding','community'));
ALTER TABLE decision_nodes ADD COLUMN IF NOT EXISTS source_ref_id UUID;
ALTER TABLE decision_nodes ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE decision_nodes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_decision_nodes_couple
  ON decision_nodes(couple_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decision_nodes_couple_cat
  ON decision_nodes(couple_id, category);
CREATE INDEX IF NOT EXISTS idx_decision_nodes_active
  ON decision_nodes(couple_id, decision_type)
  WHERE decision_type IN ('decided','booked');
CREATE INDEX IF NOT EXISTS idx_decision_nodes_source_ref
  ON decision_nodes(source_ref_id)
  WHERE source_ref_id IS NOT NULL;

ALTER TABLE decision_nodes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "decision_nodes_owner_all" ON decision_nodes;
CREATE POLICY "decision_nodes_owner_all"
  ON decision_nodes FOR ALL
  USING (
    couple_id IN (
      SELECT id FROM couples
      WHERE bride_id = auth.uid() OR groom_id = auth.uid()
    )
  )
  WITH CHECK (
    couple_id IN (
      SELECT id FROM couples
      WHERE bride_id = auth.uid() OR groom_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "decision_nodes_service_all" ON decision_nodes;
CREATE POLICY "decision_nodes_service_all"
  ON decision_nodes FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP TRIGGER IF EXISTS set_decision_nodes_updated_at ON decision_nodes;
CREATE TRIGGER set_decision_nodes_updated_at
  BEFORE UPDATE ON decision_nodes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ---------------------------------------------
-- 2. decision_edges — 노드 간 관계
-- ---------------------------------------------

CREATE TABLE IF NOT EXISTS decision_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE decision_edges ADD COLUMN IF NOT EXISTS couple_id UUID
  REFERENCES couples(id) ON DELETE CASCADE;
ALTER TABLE decision_edges ADD COLUMN IF NOT EXISTS from_node_id UUID
  REFERENCES decision_nodes(id) ON DELETE CASCADE;
ALTER TABLE decision_edges ADD COLUMN IF NOT EXISTS to_node_id UUID
  REFERENCES decision_nodes(id) ON DELETE CASCADE;
ALTER TABLE decision_edges ADD COLUMN IF NOT EXISTS relationship TEXT
  CHECK (relationship IN ('depends_on','alternative_to','replaces','budget_shared','after','because_of'));
ALTER TABLE decision_edges ADD COLUMN IF NOT EXISTS weight NUMERIC(3,2) DEFAULT 1.00;

-- UNIQUE(from_node_id, to_node_id, relationship) — 중복 엣지 방지
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'decision_edges_from_to_rel_unique'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'decision_edges' AND column_name = 'from_node_id'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'decision_edges' AND column_name = 'to_node_id'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'decision_edges' AND column_name = 'relationship'
    ) THEN
      ALTER TABLE decision_edges
        ADD CONSTRAINT decision_edges_from_to_rel_unique
        UNIQUE (from_node_id, to_node_id, relationship);
    END IF;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_decision_edges_couple ON decision_edges(couple_id);
CREATE INDEX IF NOT EXISTS idx_decision_edges_from ON decision_edges(from_node_id);
CREATE INDEX IF NOT EXISTS idx_decision_edges_to ON decision_edges(to_node_id);

ALTER TABLE decision_edges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "decision_edges_owner_all" ON decision_edges;
CREATE POLICY "decision_edges_owner_all"
  ON decision_edges FOR ALL
  USING (
    couple_id IN (
      SELECT id FROM couples
      WHERE bride_id = auth.uid() OR groom_id = auth.uid()
    )
  )
  WITH CHECK (
    couple_id IN (
      SELECT id FROM couples
      WHERE bride_id = auth.uid() OR groom_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "decision_edges_service_all" ON decision_edges;
CREATE POLICY "decision_edges_service_all"
  ON decision_edges FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);


-- ---------------------------------------------
-- 3. ai_interactions_log — AI 호출 로그
-- ---------------------------------------------

CREATE TABLE IF NOT EXISTS ai_interactions_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ai_interactions_log ADD COLUMN IF NOT EXISTS user_id UUID
  REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ai_interactions_log ADD COLUMN IF NOT EXISTS couple_id UUID
  REFERENCES couples(id) ON DELETE CASCADE;
ALTER TABLE ai_interactions_log ADD COLUMN IF NOT EXISTS session_id TEXT;
-- message_id: chat_messages.id soft link (hard FK 없음 — 비동기 로깅 허용)
ALTER TABLE ai_interactions_log ADD COLUMN IF NOT EXISTS message_id UUID;
ALTER TABLE ai_interactions_log ADD COLUMN IF NOT EXISTS interaction_type TEXT
  CHECK (interaction_type IN (
    'chat_turn','tool_call','tool_result','amora_director',
    'vendor_recommendation','feedback','community_amora_comment'
  ));
ALTER TABLE ai_interactions_log ADD COLUMN IF NOT EXISTS specialist_type TEXT
  CHECK (specialist_type IS NULL OR specialist_type IN (
    'sangkyeonrye_advisor','contract_reviewer','budget_optimizer',
    'ceremony_coordinator','settlement_companion','general'
  ));
ALTER TABLE ai_interactions_log ADD COLUMN IF NOT EXISTS user_input TEXT;
ALTER TABLE ai_interactions_log ADD COLUMN IF NOT EXISTS ai_output TEXT;
ALTER TABLE ai_interactions_log ADD COLUMN IF NOT EXISTS tool_name TEXT;
ALTER TABLE ai_interactions_log ADD COLUMN IF NOT EXISTS tool_input JSONB;
ALTER TABLE ai_interactions_log ADD COLUMN IF NOT EXISTS tool_output JSONB;
ALTER TABLE ai_interactions_log ADD COLUMN IF NOT EXISTS latency_ms INT;
ALTER TABLE ai_interactions_log ADD COLUMN IF NOT EXISTS success BOOLEAN DEFAULT TRUE;
ALTER TABLE ai_interactions_log ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE ai_interactions_log ADD COLUMN IF NOT EXISTS model TEXT;
ALTER TABLE ai_interactions_log ADD COLUMN IF NOT EXISTS tokens_input INT;
ALTER TABLE ai_interactions_log ADD COLUMN IF NOT EXISTS tokens_output INT;
ALTER TABLE ai_interactions_log ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(10,6);
ALTER TABLE ai_interactions_log ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_ai_log_couple_time
  ON ai_interactions_log(couple_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_log_user_time
  ON ai_interactions_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_log_session
  ON ai_interactions_log(session_id)
  WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_log_specialist
  ON ai_interactions_log(specialist_type, created_at DESC)
  WHERE specialist_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_log_errors
  ON ai_interactions_log(created_at DESC)
  WHERE success = FALSE;

ALTER TABLE ai_interactions_log ENABLE ROW LEVEL SECURITY;

-- SELECT: 본인 로그만
DROP POLICY IF EXISTS "ai_log_owner_select" ON ai_interactions_log;
CREATE POLICY "ai_log_owner_select"
  ON ai_interactions_log FOR SELECT
  USING (user_id = auth.uid());

-- INSERT/UPDATE/DELETE: service role only (서버 사이드 로깅)
DROP POLICY IF EXISTS "ai_log_service_all" ON ai_interactions_log;
CREATE POLICY "ai_log_service_all"
  ON ai_interactions_log FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 민감정보 주석 (개인정보보호법 + AI 기본법 compliance)
COMMENT ON COLUMN ai_interactions_log.user_input IS
'사용자 발화. 민감정보 포함 가능 (이름/주소/연락처 등). 개인정보보호법 + AI 기본법 compliance 대상. 향후 export/삭제 요청 시 포함.';

COMMENT ON COLUMN ai_interactions_log.ai_output IS
'AI 생성 응답. 사용자 민감정보 재사용 가능. 5년 보관 (AI 기본법). 익명화 정책 Sprint 2 결정.';

-- TODO: retention policy
-- AI 기본법 (2026.1.22 시행) 5년 보관 의무
-- 90일 이후 raw log → aggregated summary 압축 고려
-- cleanup cron은 Sprint 2에서 결정


-- ---------------------------------------------
-- 4. standard_contract_clauses — 표준 계약 조항 라이브러리
-- ---------------------------------------------

CREATE TABLE IF NOT EXISTS standard_contract_clauses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE standard_contract_clauses ADD COLUMN IF NOT EXISTS clause_code TEXT;
ALTER TABLE standard_contract_clauses ADD COLUMN IF NOT EXISTS category TEXT
  CHECK (category IS NULL OR category IN ('cancel','refund','delivery','service_change','damage','tip','misc'));
ALTER TABLE standard_contract_clauses ADD COLUMN IF NOT EXISTS vendor_category TEXT;
ALTER TABLE standard_contract_clauses ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE standard_contract_clauses ADD COLUMN IF NOT EXISTS body_md TEXT;
ALTER TABLE standard_contract_clauses ADD COLUMN IF NOT EXISTS plain_summary TEXT;
ALTER TABLE standard_contract_clauses ADD COLUMN IF NOT EXISTS severity TEXT DEFAULT 'recommended'
  CHECK (severity IN ('required','recommended','optional'));
ALTER TABLE standard_contract_clauses ADD COLUMN IF NOT EXISTS source_url TEXT;
ALTER TABLE standard_contract_clauses ADD COLUMN IF NOT EXISTS applies_before_days INT;
ALTER TABLE standard_contract_clauses ADD COLUMN IF NOT EXISTS refund_pct NUMERIC(5,2);
ALTER TABLE standard_contract_clauses ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE standard_contract_clauses ADD COLUMN IF NOT EXISTS version INT DEFAULT 1;
ALTER TABLE standard_contract_clauses ADD COLUMN IF NOT EXISTS effective_from DATE DEFAULT CURRENT_DATE;
ALTER TABLE standard_contract_clauses ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE standard_contract_clauses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- UNIQUE(clause_code)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'standard_contract_clauses_clause_code_unique'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'standard_contract_clauses' AND column_name = 'clause_code'
    ) THEN
      ALTER TABLE standard_contract_clauses
        ADD CONSTRAINT standard_contract_clauses_clause_code_unique
        UNIQUE (clause_code);
    END IF;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contract_clauses_category
  ON standard_contract_clauses(category)
  WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_contract_clauses_vendor_cat
  ON standard_contract_clauses(vendor_category, category)
  WHERE is_active = TRUE;

ALTER TABLE standard_contract_clauses ENABLE ROW LEVEL SECURITY;

-- SELECT: 모든 인증 유저 (공개 참조 데이터)
DROP POLICY IF EXISTS "contract_clauses_public_select" ON standard_contract_clauses;
CREATE POLICY "contract_clauses_public_select"
  ON standard_contract_clauses FOR SELECT
  USING (is_active = TRUE);

-- INSERT/UPDATE/DELETE: service role only (관리자 큐레이션)
DROP POLICY IF EXISTS "contract_clauses_service_all" ON standard_contract_clauses;
CREATE POLICY "contract_clauses_service_all"
  ON standard_contract_clauses FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP TRIGGER IF EXISTS set_contract_clauses_updated_at ON standard_contract_clauses;
CREATE TRIGGER set_contract_clauses_updated_at
  BEFORE UPDATE ON standard_contract_clauses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ---------------------------------------------
-- 5. chat_messages ALTER — stage_tag + specialist_type
-- ---------------------------------------------

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS stage_tag TEXT
  CHECK (stage_tag IS NULL OR stage_tag IN ('planning_0','preparation_1','execution_2','ceremony_3','settlement_4'));

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS specialist_type TEXT
  CHECK (specialist_type IS NULL OR specialist_type IN (
    'sangkyeonrye_advisor','contract_reviewer','budget_optimizer',
    'ceremony_coordinator','settlement_companion','general'
  ));

CREATE INDEX IF NOT EXISTS idx_chat_messages_couple_stage
  ON chat_messages(couple_id, stage_tag)
  WHERE stage_tag IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_messages_specialist
  ON chat_messages(specialist_type)
  WHERE specialist_type IS NOT NULL;


-- ---------------------------------------------
-- 6. vendor_bookings ALTER — 실거래 추적 컬럼
-- ---------------------------------------------

ALTER TABLE vendor_bookings ADD COLUMN IF NOT EXISTS contracted_amount NUMERIC(12,0);
ALTER TABLE vendor_bookings ADD COLUMN IF NOT EXISTS actual_amount NUMERIC(12,0);
ALTER TABLE vendor_bookings ADD COLUMN IF NOT EXISTS user_uploaded_receipt_url TEXT;
ALTER TABLE vendor_bookings ADD COLUMN IF NOT EXISTS contract_signed_at TIMESTAMPTZ;
ALTER TABLE vendor_bookings ADD COLUMN IF NOT EXISTS receipt_verified_at TIMESTAMPTZ;
ALTER TABLE vendor_bookings ADD COLUMN IF NOT EXISTS receipt_verified_by UUID
  REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_vendor_bookings_verified
  ON vendor_bookings(receipt_verified_at DESC)
  WHERE receipt_verified_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vendor_bookings_actual
  ON vendor_bookings(vendor_id, actual_amount)
  WHERE actual_amount IS NOT NULL;

-- 금액 컬럼 관계 주석 (단계별 추적)
COMMENT ON COLUMN vendor_bookings.amount IS
'초기 예약 견적 (기존 컬럼). 유저가 예약 생성 시 업체가 제시한 금액.';

COMMENT ON COLUMN vendor_bookings.contracted_amount IS
'계약서 확정 금액 (신규). 견적 → 계약서 합의 후 확정된 금액. amount와 다를 수 있음 (협상/할인 반영).';

COMMENT ON COLUMN vendor_bookings.actual_amount IS
'실결제 금액 (신규). 실제 지급된 금액. contracted_amount와 다를 수 있음 (추가 옵션/위약금 반영). Give-to-Get 실거래 데이터.';

COMMENT ON COLUMN vendor_bookings.user_uploaded_receipt_url IS
'유저 수동 업로드 영수증 URL. Give-to-Get 프로그램용. payments.receipt_url (Toss 자동 영수증)과 역할 분리.';

COMMENT ON COLUMN vendor_bookings.contract_signed_at IS
'계약 체결 시점 (신규). contract_status(TEXT, 상태 머신)와 역할 분리 — 이 컬럼은 **시점** 추적.';


-- =============================================
-- 완료
-- =============================================
-- 재실행 안전 (idempotent):
--   - 테이블 이미 있으면 CREATE 스킵
--   - 컬럼 이미 있으면 ADD COLUMN 스킵
--   - 정책/트리거/UNIQUE 이미 있으면 DROP 후 재생성 or 조건부 스킵
-- =============================================
