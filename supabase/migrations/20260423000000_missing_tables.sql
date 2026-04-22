-- =============================================
-- 누락 테이블 추가 (2026-04-23)
-- chat_feedback, chat_summaries, vendor_photo_likes, account_deletions, customer_survey_responses
-- =============================================
-- 근거: FEATURE_AUDIT.md Phase 5 공통 패턴 #3
-- 이 테이블들은 코드가 참조하지만 migrations에 정의 없음
-- IF NOT EXISTS 로 이미 존재해도 안전하게 스킵
-- RLS 정책은 DROP → CREATE 패턴 (이름 충돌 방지)
-- =============================================


-- ---------------------------------------------
-- 1. chat_feedback — AI 응답 피드백 학습
-- ---------------------------------------------
-- 참조:
--   apps/web/src/app/api/chat/feedback/route.ts   (POST 저장 / GET 학습 조회)
--   apps/web/src/app/api/chat/route.ts            (자동 불만족 감지 저장)
--   apps/web/src/lib/ai/feedbackLessons.ts        (lesson 추출)
-- INSERT 컬럼: user_id, couple_id, message_id, rating, correction, category, message_content
-- 모든 read/write는 API 서버가 service role key로 수행

CREATE TABLE IF NOT EXISTS chat_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  couple_id UUID REFERENCES couples(id) ON DELETE SET NULL,
  message_id TEXT,  -- chat_messages.id 참조, auto-detect 시 null 허용
  rating TEXT NOT NULL CHECK (rating IN ('good', 'bad')),
  correction TEXT,
  category TEXT,  -- 'correction', 'retry', 'frustration', 'negative', 'confusion', 'disengagement' 등
  message_content TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_feedback_user ON chat_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_feedback_couple ON chat_feedback(couple_id);
CREATE INDEX IF NOT EXISTS idx_chat_feedback_rating ON chat_feedback(rating);
CREATE INDEX IF NOT EXISTS idx_chat_feedback_created ON chat_feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_feedback_rate_limit
  ON chat_feedback(user_id, created_at DESC);

ALTER TABLE chat_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_feedback_service_all" ON chat_feedback;
CREATE POLICY "chat_feedback_service_all"
  ON chat_feedback FOR ALL
  USING (true)
  WITH CHECK (true);


-- ---------------------------------------------
-- 2. chat_summaries — 이전 대화 요약
-- ---------------------------------------------
-- 참조:
--   apps/web/src/app/api/chat/route.ts         (SELECT, 시스템 프롬프트 주입)
--   apps/web/src/app/api/auth/delete/route.ts  (DELETE user_id)
-- 현재 코드가 INSERT는 하지 않음 (향후 요약 자동화 대비). SELECT 빈 결과여도 OK.

CREATE TABLE IF NOT EXISTS chat_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID REFERENCES couples(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  message_count INT DEFAULT 0,
  from_message_id TEXT,
  to_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_summaries_couple
  ON chat_summaries(couple_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_summaries_user
  ON chat_summaries(user_id);

ALTER TABLE chat_summaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_summaries_couple_read" ON chat_summaries;
CREATE POLICY "chat_summaries_couple_read"
  ON chat_summaries FOR SELECT
  USING (
    couple_id IN (
      SELECT couple_id FROM profiles WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "chat_summaries_service_all" ON chat_summaries;
CREATE POLICY "chat_summaries_service_all"
  ON chat_summaries FOR ALL
  USING (true)
  WITH CHECK (true);


-- ---------------------------------------------
-- 3. vendor_photo_likes — 업체 사진 좋아요
-- ---------------------------------------------
-- 참조:
--   apps/web/src/app/api/vendors/[id]/photos/route.ts (POST 토글, GET 목록)
-- INSERT 컬럼: user_id, vendor_id, photo_url

CREATE TABLE IF NOT EXISTS vendor_photo_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  photo_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, vendor_id, photo_url)
);

CREATE INDEX IF NOT EXISTS idx_vendor_photo_likes_user
  ON vendor_photo_likes(user_id);
CREATE INDEX IF NOT EXISTS idx_vendor_photo_likes_vendor_photo
  ON vendor_photo_likes(vendor_id, photo_url);

ALTER TABLE vendor_photo_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vendor_photo_likes_owner_all" ON vendor_photo_likes;
CREATE POLICY "vendor_photo_likes_owner_all"
  ON vendor_photo_likes FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ---------------------------------------------
-- 4. account_deletions — 탈퇴 사유 기록
-- ---------------------------------------------
-- 참조: apps/web/src/app/api/auth/delete/route.ts:36
-- INSERT 컬럼: user_id, email, reason, deleted_at
-- 탈퇴 후에도 기록 유지 (서비스 개선용) → user_id FK 없음 (auth.users 삭제 후에도 보존)

CREATE TABLE IF NOT EXISTS account_deletions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,  -- 탈퇴한 유저 ID (FK 없음: auth.users 삭제 후에도 기록 유지)
  email TEXT,
  reason TEXT NOT NULL DEFAULT 'unknown',
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_deletions_deleted_at
  ON account_deletions(deleted_at DESC);
CREATE INDEX IF NOT EXISTS idx_account_deletions_reason
  ON account_deletions(reason);

ALTER TABLE account_deletions ENABLE ROW LEVEL SECURITY;

-- 오직 service role만 접근 가능 (일반 유저 접근 금지 — 분석/관리자 전용)
DROP POLICY IF EXISTS "account_deletions_service_only" ON account_deletions;
CREATE POLICY "account_deletions_service_only"
  ON account_deletions FOR ALL
  USING (true)
  WITH CHECK (true);


-- ---------------------------------------------
-- 5. customer_survey_responses — 고객 사전 설문
-- ---------------------------------------------
-- 참조: apps/web/src/app/api/survey/route.ts
-- 모든 Q1~Q23 응답 컬럼 포함 (설문지 구조 참고)

CREATE TABLE IF NOT EXISTS customer_survey_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Screening
  q1_status TEXT,
  q2_region TEXT,

  -- Section 2: 정보 비교
  q3_info_compare TEXT,
  q4_cost_transparent TEXT,
  q5_reservation_easy TEXT,
  q6_price_gap TEXT,
  q7_pain_points TEXT[],
  q7_other TEXT,

  -- Section 3: 플래너
  q8_planner_usage TEXT,
  q8_1_planner_satisfaction TEXT,
  q8_2_no_planner_reasons TEXT[],
  q8_2_other TEXT,
  q9_commission_awareness TEXT,
  q10_transparency_impact TEXT,

  -- Section 4: 정보 채널
  q11_main_channel TEXT,
  q11_other TEXT,
  q11_1_channel_satisfaction TEXT,
  q12_dissatisfaction TEXT[],
  q12_other TEXT,

  -- Section 5: 기능 선호
  q13_feature_rank_1 TEXT,
  q13_feature_rank_2 TEXT,
  q13_feature_rank_3 TEXT,
  q14_ai_expectations TEXT[],

  -- Section 6: 가격
  q15_a_fair_price TEXT,
  q15_b_max_price TEXT,
  q16_payment_preference TEXT,

  -- Section 7: 관심 서비스
  q17_interested_services TEXT[],
  q17_other TEXT,
  q18_lacking_info TEXT,
  q18_other TEXT,

  -- Section 8: 사용 의향
  q19_usage_intent TEXT,
  q20_nps TEXT,
  q21_feedback TEXT,

  -- Section 9: 인구통계
  q22_gender TEXT,
  q22_age TEXT,
  q22_budget TEXT,
  q23_contact TEXT,

  -- 메타
  completion_time_seconds INT,
  user_agent TEXT,
  screen_out BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_survey_created
  ON customer_survey_responses(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_survey_screen_out
  ON customer_survey_responses(screen_out);

ALTER TABLE customer_survey_responses ENABLE ROW LEVEL SECURITY;

-- Service role만 (설문 데이터는 관리자/분석용)
DROP POLICY IF EXISTS "customer_survey_service_only" ON customer_survey_responses;
CREATE POLICY "customer_survey_service_only"
  ON customer_survey_responses FOR ALL
  USING (true)
  WITH CHECK (true);


-- =============================================
-- END
-- 프로덕션 DB에 실행 시:
--   1. chat_feedback 테이블 없으면 → 생성됨 (AI 피드백 시스템 활성화)
--   2. chat_feedback 이미 존재하면 → CREATE TABLE은 스킵, RLS 정책만 재적용
--   3. 동일하게 나머지 4개 테이블도 안전하게 처리
-- =============================================
