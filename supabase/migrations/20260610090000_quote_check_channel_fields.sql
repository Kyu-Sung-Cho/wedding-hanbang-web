-- Quote-check condition fields for accurate price-distribution data.
-- 조건(채널·단계·시점) 태깅 없이 수집된 견적은 소급 보정이 불가능하므로,
-- 데이터 수집 확대(그로스)보다 이 스키마가 먼저 적용되어야 한다.

ALTER TABLE amora_quote_checks
  ADD COLUMN IF NOT EXISTS booking_channel TEXT NOT NULL DEFAULT 'unknown'
    CHECK (booking_channel IN ('walk_in', 'planner', 'agency_package', 'platform', 'unknown')),
  ADD COLUMN IF NOT EXISTS quote_stage TEXT NOT NULL DEFAULT 'quote_only'
    CHECK (quote_stage IN ('quote_only', 'contracted')),
  ADD COLUMN IF NOT EXISTS contract_ym TEXT
    CHECK (contract_ym IS NULL OR contract_ym ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  ADD COLUMN IF NOT EXISTS wedding_ym TEXT
    CHECK (wedding_ym IS NULL OR wedding_ym ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  ADD COLUMN IF NOT EXISTS planner_fee_manwon NUMERIC(10,2)
    CHECK (planner_fee_manwon IS NULL OR planner_fee_manwon >= 0),
  ADD COLUMN IF NOT EXISTS verification_level TEXT NOT NULL DEFAULT 'self_reported'
    CHECK (verification_level IN ('self_reported', 'doc_uploaded', 'contract_verified')),
  ADD COLUMN IF NOT EXISTS excluded_from_stats BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_amora_quote_checks_channel_cell
  ON amora_quote_checks(category, region, booking_channel, quote_stage, created_at DESC)
  WHERE excluded_from_stats = false;

COMMENT ON COLUMN amora_quote_checks.booking_channel IS
'견적을 받은 경로: walk_in(직접 방문)/planner(플래너 동행·소개)/agency_package(대행사 패키지)/platform(웨딩한방 경유)/unknown. 분포 통계의 1차 조건축.';

COMMENT ON COLUMN amora_quote_checks.quote_stage IS
'quote_only(견적만 받음) vs contracted(계약 완료). 계약가와 호가를 절대 혼합 집계하지 않기 위한 축.';

COMMENT ON COLUMN amora_quote_checks.verification_level IS
'self_reported(자가신고)/doc_uploaded(견적서 인증)/contract_verified(계약 인증). 통계 표기 시 합산하되 등급별 분리 표기.';

COMMENT ON COLUMN amora_quote_checks.excluded_from_stats IS
'IQR 이상치·의심 데이터 플래그. 삭제 대신 제외 처리해 감사 가능성을 유지한다.';
