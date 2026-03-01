-- ============================================================
-- 005: 신규 유저 가입 트리거 수정 (Google OAuth 가입 실패 수정)
-- 에러: "Database error saving new user"
-- 원인: create_profile_on_signup() 트리거가 실패하면 auth.users INSERT도 롤백됨
-- 해결: EXCEPTION 블록으로 트리거 실패 시에도 유저 생성 보장
-- Supabase SQL Editor에서 실행
-- ============================================================

-- 1. profiles 테이블에 필요한 컬럼 기본값 확인/추가
-- (created_at, updated_at에 DEFAULT가 없으면 트리거 INSERT가 실패할 수 있음)
DO $$
BEGIN
  -- created_at 컬럼에 DEFAULT 추가
  BEGIN
    ALTER TABLE profiles ALTER COLUMN created_at SET DEFAULT NOW();
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- updated_at 컬럼에 DEFAULT 추가
  BEGIN
    ALTER TABLE profiles ALTER COLUMN updated_at SET DEFAULT NOW();
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- name, email을 nullable로 확인 (NOT NULL이면 풀기)
  BEGIN
    ALTER TABLE profiles ALTER COLUMN name DROP NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  BEGIN
    ALTER TABLE profiles ALTER COLUMN email DROP NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END $$;

-- 2. 트리거 함수 교체 (EXCEPTION 블록 추가)
CREATE OR REPLACE FUNCTION create_profile_on_signup()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, name, email, onboarding_completed, onboarding_step, created_at, updated_at)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'name',
      NEW.raw_user_meta_data->>'full_name',
      split_part(COALESCE(NEW.email, ''), '@', 1),
      'User'
    ),
    NEW.email,
    false,
    0,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = COALESCE(EXCLUDED.email, profiles.email),
    name = COALESCE(EXCLUDED.name, profiles.name),
    updated_at = NOW();

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- 트리거 실패해도 auth.users INSERT는 성공하도록
  -- 프로필은 온보딩 API에서 다시 생성됨
  RAISE WARNING 'create_profile_on_signup failed for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. 트리거 재생성 (이미 있으면 교체)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION create_profile_on_signup();

-- 4. email UNIQUE 제약조건 확인/제거 (중복 email로 가입 실패 방지)
-- email 유니크 인덱스가 있으면 제거 (auth.users에서 이미 email 유일성 보장)
DO $$
DECLARE
  idx RECORD;
BEGIN
  FOR idx IN
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'profiles'
      AND indexdef ILIKE '%email%'
      AND indexdef ILIKE '%unique%'
  LOOP
    EXECUTE 'DROP INDEX IF EXISTS ' || idx.indexname;
    RAISE NOTICE 'Dropped unique email index: %', idx.indexname;
  END LOOP;
END $$;

-- email에 UNIQUE 제약조건이 있으면 제거
DO $$
DECLARE
  con RECORD;
BEGIN
  FOR con IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'profiles'::regclass
      AND contype = 'u'
      AND EXISTS (
        SELECT 1 FROM information_schema.constraint_column_usage
        WHERE constraint_name = conname AND column_name = 'email'
      )
  LOOP
    EXECUTE 'ALTER TABLE profiles DROP CONSTRAINT ' || con.conname;
    RAISE NOTICE 'Dropped unique email constraint: %', con.conname;
  END LOOP;
END $$;
