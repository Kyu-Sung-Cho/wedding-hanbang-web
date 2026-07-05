-- 웨딩코드 v0.3 스모크 응답 테이블 — 인앱 프로토타입 수집 채널.
-- 결정 기록: docs/wedding-code/16_inapp_prototype_decision_v1.md
--   (15번 Non-Goals의 "no routes/DB"를 수집 수단에 한해 해제 — 채점·유형·캐릭터 금지는 유지)
-- PII 없음(이메일·이름·전화 수집 안 함). 쓰기는 서버 API(service_role)만,
-- 클라이언트 직접 읽기/쓰기 전면 차단.

CREATE TABLE IF NOT EXISTS public.wedding_code_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  form_version TEXT NOT NULL DEFAULT 'v0.3',
  consent_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  participant_stage TEXT NOT NULL,
  answering_mode TEXT NOT NULL,
  quote_status TEXT NOT NULL,
  parent_involvement TEXT NOT NULL,
  biggest_concern TEXT[] NOT NULL DEFAULT '{}',
  biggest_concern_other TEXT,

  answers JSONB NOT NULL,        -- {q01:"A", ...} 원시 선택지만 — 점수/가중치 컬럼 없음(의도적)
  stage_flags JSONB NOT NULL DEFAULT '{}',  -- 게이팅 문항 노출 상태 {q10:"direct|hypothetical|skipped"}
  feedback JSONB NOT NULL DEFAULT '{}',     -- 1~5 척도
  cta_interest JSONB NOT NULL DEFAULT '{}', -- 1~5 척도
  free_text JSONB NOT NULL DEFAULT '{}',

  duration_ms INTEGER,
  utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_content TEXT
);

CREATE INDEX IF NOT EXISTS idx_wc_responses_created ON public.wedding_code_responses (created_at);
CREATE INDEX IF NOT EXISTS idx_wc_responses_stage ON public.wedding_code_responses (participant_stage);

ALTER TABLE public.wedding_code_responses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wedding_code_responses FROM anon, authenticated;
GRANT ALL ON public.wedding_code_responses TO service_role;

DROP POLICY IF EXISTS wc_responses_service_only ON public.wedding_code_responses;
CREATE POLICY wc_responses_service_only ON public.wedding_code_responses
  FOR ALL TO service_role USING (true) WITH CHECK (true);
