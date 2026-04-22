-- =============================================
-- 진단 쿼리: 기존 테이블의 실제 컬럼 확인
-- =============================================
-- Supabase SQL Editor에서 실행해서 결과를 확인하세요
-- 이걸로 어떤 테이블이 이미 존재하며 어떤 컬럼을 가지고 있는지 파악

-- 1. 우리가 만들려는 테이블 중 이미 존재하는 것 확인
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'chat_feedback',
    'chat_summaries',
    'vendor_photo_likes',
    'account_deletions',
    'customer_survey_responses'
  )
ORDER BY table_name;


-- 2. 각 기존 테이블의 컬럼 리스트
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'chat_feedback',
    'chat_summaries',
    'vendor_photo_likes',
    'account_deletions',
    'customer_survey_responses'
  )
ORDER BY table_name, ordinal_position;


-- 3. profiles 테이블 컬럼 확인 (RLS 정책이 참조)
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'profiles'
ORDER BY ordinal_position;


-- 4. couples 테이블 컬럼 확인 (FK 참조)
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'couples'
ORDER BY ordinal_position;
