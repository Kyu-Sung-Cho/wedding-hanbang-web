-- Historical WeddingCode candidate schema. Collection was retired before this
-- migration reached production, so the table is born fail-closed. It remains
-- in the chain only to keep later historical migrations replayable; no
-- application role may read or write it.

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
REVOKE ALL ON public.wedding_code_responses
  FROM PUBLIC, anon, authenticated, service_role;

DROP POLICY IF EXISTS wc_responses_service_only ON public.wedding_code_responses;

-- NOT VALID avoids a historical scan if this file is replayed against a
-- manually restored table, while PostgreSQL still rejects every new INSERT or
-- UPDATE. This fence is installed in the same migration transaction as CREATE
-- TABLE, so there is no service_role write window between migration files.
ALTER TABLE public.wedding_code_responses
  DROP CONSTRAINT IF EXISTS wedding_code_collection_retired,
  ADD CONSTRAINT wedding_code_collection_retired
  CHECK (false) NOT VALID;

COMMENT ON CONSTRAINT wedding_code_collection_retired
  ON public.wedding_code_responses IS
  'Initial fail-closed fence. The later retirement migration re-verifies application ACLs, policies, RPCs, and this constraint.';

COMMENT ON TABLE public.wedding_code_responses IS
  'Retired WeddingCode candidate schema. Application collection is disabled.';
