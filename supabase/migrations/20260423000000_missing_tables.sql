-- =============================================
-- 누락 테이블 추가 (2026-04-23) — 방어적 버전
-- chat_feedback, chat_summaries, vendor_photo_likes, account_deletions, customer_survey_responses
-- =============================================
-- 특징:
--   1. CREATE TABLE IF NOT EXISTS — 기존 테이블 파괴 안 함
--   2. ALTER TABLE ADD COLUMN IF NOT EXISTS — 기존 테이블에 컬럼 누락 시 보강
--   3. DROP POLICY → CREATE POLICY — 정책 이름 충돌 방지
--   4. 모든 작업 재실행 안전 (idempotent)
-- =============================================


-- ---------------------------------------------
-- 1. chat_feedback — AI 피드백 학습
-- ---------------------------------------------

CREATE TABLE IF NOT EXISTS chat_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 기존 테이블이 이미 있어도 컬럼 보강
ALTER TABLE chat_feedback ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE chat_feedback ADD COLUMN IF NOT EXISTS couple_id UUID;
ALTER TABLE chat_feedback ADD COLUMN IF NOT EXISTS message_id TEXT;
ALTER TABLE chat_feedback ADD COLUMN IF NOT EXISTS rating TEXT;
ALTER TABLE chat_feedback ADD COLUMN IF NOT EXISTS correction TEXT;
ALTER TABLE chat_feedback ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE chat_feedback ADD COLUMN IF NOT EXISTS message_content TEXT;

CREATE INDEX IF NOT EXISTS idx_chat_feedback_user ON chat_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_feedback_couple ON chat_feedback(couple_id);
CREATE INDEX IF NOT EXISTS idx_chat_feedback_rating ON chat_feedback(rating);
CREATE INDEX IF NOT EXISTS idx_chat_feedback_created ON chat_feedback(created_at DESC);

ALTER TABLE chat_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_feedback_service_all" ON chat_feedback;
CREATE POLICY "chat_feedback_service_all"
  ON chat_feedback FOR ALL
  USING (true)
  WITH CHECK (true);


-- ---------------------------------------------
-- 2. chat_summaries — 대화 요약
-- ---------------------------------------------

CREATE TABLE IF NOT EXISTS chat_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE chat_summaries ADD COLUMN IF NOT EXISTS couple_id UUID;
ALTER TABLE chat_summaries ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE chat_summaries ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE chat_summaries ADD COLUMN IF NOT EXISTS message_count INT DEFAULT 0;
ALTER TABLE chat_summaries ADD COLUMN IF NOT EXISTS from_message_id TEXT;
ALTER TABLE chat_summaries ADD COLUMN IF NOT EXISTS to_message_id TEXT;

CREATE INDEX IF NOT EXISTS idx_chat_summaries_couple ON chat_summaries(couple_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_summaries_user ON chat_summaries(user_id);

ALTER TABLE chat_summaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_summaries_service_all" ON chat_summaries;
CREATE POLICY "chat_summaries_service_all"
  ON chat_summaries FOR ALL
  USING (true)
  WITH CHECK (true);


-- ---------------------------------------------
-- 3. vendor_photo_likes — 사진 좋아요
-- ---------------------------------------------

CREATE TABLE IF NOT EXISTS vendor_photo_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE vendor_photo_likes ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE vendor_photo_likes ADD COLUMN IF NOT EXISTS vendor_id UUID;
ALTER TABLE vendor_photo_likes ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- user_id, vendor_id, photo_url 3개 조합 UNIQUE (중복 좋아요 방지)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vendor_photo_likes_user_vendor_photo_unique'
  ) THEN
    -- 실제 컬럼이 모두 있을 때만 UNIQUE 추가
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'vendor_photo_likes' AND column_name = 'user_id'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'vendor_photo_likes' AND column_name = 'vendor_id'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'vendor_photo_likes' AND column_name = 'photo_url'
    ) THEN
      ALTER TABLE vendor_photo_likes
        ADD CONSTRAINT vendor_photo_likes_user_vendor_photo_unique
        UNIQUE (user_id, vendor_id, photo_url);
    END IF;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_vendor_photo_likes_user ON vendor_photo_likes(user_id);
CREATE INDEX IF NOT EXISTS idx_vendor_photo_likes_vendor_photo
  ON vendor_photo_likes(vendor_id, photo_url);

ALTER TABLE vendor_photo_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vendor_photo_likes_owner_all" ON vendor_photo_likes;
CREATE POLICY "vendor_photo_likes_owner_all"
  ON vendor_photo_likes FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ---------------------------------------------
-- 4. account_deletions — 탈퇴 사유
-- ---------------------------------------------

CREATE TABLE IF NOT EXISTS account_deletions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE account_deletions ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE account_deletions ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE account_deletions ADD COLUMN IF NOT EXISTS reason TEXT DEFAULT 'unknown';
ALTER TABLE account_deletions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_account_deletions_deleted_at
  ON account_deletions(deleted_at DESC);
CREATE INDEX IF NOT EXISTS idx_account_deletions_reason
  ON account_deletions(reason);

ALTER TABLE account_deletions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "account_deletions_service_only" ON account_deletions;
CREATE POLICY "account_deletions_service_only"
  ON account_deletions FOR ALL
  USING (true)
  WITH CHECK (true);


-- ---------------------------------------------
-- 5. customer_survey_responses — 사전 설문
-- ---------------------------------------------

CREATE TABLE IF NOT EXISTS customer_survey_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Screening
ALTER TABLE customer_survey_responses ADD COLUMN IF NOT EXISTS q1_status TEXT;
ALTER TABLE customer_survey_responses ADD COLUMN IF NOT EXISTS q2_region TEXT;

-- Section 2
ALTER TABLE customer_survey_responses ADD COLUMN IF NOT EXISTS q3_info_compare TEXT;
ALTER TABLE customer_survey_responses ADD COLUMN IF NOT EXISTS q4_cost_transparent TEXT;
ALTER TABLE customer_survey_responses ADD COLUMN IF NOT EXISTS q5_reservation_easy TEXT;
ALTER TABLE customer_survey_responses ADD COLUMN IF NOT EXISTS q6_price_gap TEXT;
ALTER TABLE customer_survey_responses ADD COLUMN IF NOT EXISTS q7_pain_points TEXT[];
ALTER TABLE customer_survey_responses ADD COLUMN IF NOT EXISTS q7_other TEXT;

-- Section 3
ALTER TABLE customer_survey_responses ADD COLUMN IF NOT EXISTS q8_planner_usage TEXT;
ALTER TABLE customer_survey_responses ADD COLUMN IF NOT EXISTS q8_1_planner_satisfaction TEXT;
ALTER TABLE customer_survey_responses ADD COLUMN IF NOT EXISTS q8_2_no_planner_reasons TEXT[];
ALTER TABLE customer_survey_responses ADD COLUMN IF NOT EXISTS q8_2_other TEXT;
ALTER TABLE customer_survey_responses ADD COLUMN IF NOT EXISTS q9_commission_awareness TEXT;
ALTER TABLE customer_survey_responses ADD COLUMN IF NOT EXISTS q10_transparency_impact TEXT;

-- Section 4
ALTER TABLE customer_survey_responses ADD COLUMN IF NOT EXISTS q11_main_channel TEXT;
ALTER TABLE customer_survey_responses ADD COLUMN IF NOT EXISTS q11_other TEXT;
ALTER TABLE customer_survey_responses ADD COLUMN IF NOT EXISTS q11_1_channel_satisfaction TEXT;
ALTER TABLE customer_survey_responses ADD COLUMN IF NOT EXISTS q12_dissatisfaction TEXT[];
ALTER TABLE customer_survey_responses ADD COLUMN IF NOT EXISTS q12_other TEXT;

-- Section 5
ALTER TABLE customer_survey_responses ADD COLUMN IF NOT EXISTS q13_feature_rank_1 TEXT;
ALTER TABLE customer_survey_responses ADD COLUMN IF NOT EXISTS q13_feature_rank_2 TEXT;
ALTER TABLE customer_survey_responses ADD COLUMN IF NOT EXISTS q13_feature_rank_3 TEXT;
ALTER TABLE customer_survey_responses ADD COLUMN IF NOT EXISTS q14_ai_expectations TEXT[];

-- Section 6
ALTER TABLE customer_survey_responses ADD COLUMN IF NOT EXISTS q15_a_fair_price TEXT;
ALTER TABLE customer_survey_responses ADD COLUMN IF NOT EXISTS q15_b_max_price TEXT;
ALTER TABLE customer_survey_responses ADD COLUMN IF NOT EXISTS q16_payment_preference TEXT;

-- Section 7
ALTER TABLE customer_survey_responses ADD COLUMN IF NOT EXISTS q17_interested_services TEXT[];
ALTER TABLE customer_survey_responses ADD COLUMN IF NOT EXISTS q17_other TEXT;
ALTER TABLE customer_survey_responses ADD COLUMN IF NOT EXISTS q18_lacking_info TEXT;
ALTER TABLE customer_survey_responses ADD COLUMN IF NOT EXISTS q18_other TEXT;

-- Section 8
ALTER TABLE customer_survey_responses ADD COLUMN IF NOT EXISTS q19_usage_intent TEXT;
ALTER TABLE customer_survey_responses ADD COLUMN IF NOT EXISTS q20_nps TEXT;
ALTER TABLE customer_survey_responses ADD COLUMN IF NOT EXISTS q21_feedback TEXT;

-- Section 9
ALTER TABLE customer_survey_responses ADD COLUMN IF NOT EXISTS q22_gender TEXT;
ALTER TABLE customer_survey_responses ADD COLUMN IF NOT EXISTS q22_age TEXT;
ALTER TABLE customer_survey_responses ADD COLUMN IF NOT EXISTS q22_budget TEXT;
ALTER TABLE customer_survey_responses ADD COLUMN IF NOT EXISTS q23_contact TEXT;

-- Meta
ALTER TABLE customer_survey_responses ADD COLUMN IF NOT EXISTS completion_time_seconds INT;
ALTER TABLE customer_survey_responses ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE customer_survey_responses ADD COLUMN IF NOT EXISTS screen_out BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_customer_survey_created
  ON customer_survey_responses(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_survey_screen_out
  ON customer_survey_responses(screen_out);

ALTER TABLE customer_survey_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "customer_survey_service_only" ON customer_survey_responses;
CREATE POLICY "customer_survey_service_only"
  ON customer_survey_responses FOR ALL
  USING (true)
  WITH CHECK (true);


-- =============================================
-- 완료
-- =============================================
-- 재실행 안전 (idempotent):
--   - 테이블 이미 있으면 CREATE 스킵
--   - 컬럼 이미 있으면 ADD COLUMN 스킵
--   - 정책 이미 있으면 DROP 후 재생성
-- =============================================
