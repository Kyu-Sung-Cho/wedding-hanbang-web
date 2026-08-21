-- 첫 실행 튜토리얼 — 이 사람이 라운지 안내를 이미 봤는가.
--
-- 왜:
--   안내는 이미 두 벌 만들어져 있었다. 앱에는 6슬라이드 AppGuide가, 웹에는 스포트라이트
--   투어가. 둘 다 동작하는데 아무 데서도 실행되지 않았다 — 앱 쪽은 import하는 파일이
--   0개였고, 웹 쪽은 리다이렉트로 도달 불가능해진 라우트에만 붙어 있었다. 그래서 처음
--   온 사람은 빈 대시보드를 혼자 마주한다.
--
--   다시 켜려면 "이미 봤는가"를 어딘가 적어야 한다. 그 자리가 여기다.
--
-- 왜 기기가 아니라 계정인가:
--   예전 두 구현은 localStorage와 AsyncStorage에 적었다. 그러면 폰에서 본 사람이
--   노트북으로 처음 들어올 때 또 보고, 브라우저 데이터를 지우면 또 본다. 커플 앱은
--   두 기기를 오가는 게 기본이라 이건 예외가 아니라 일상이다.
--
-- 왜 커플이 아니라 개인 컬럼인가:
--   안내를 보는 것은 각자의 일이다. 한 사람이 봤다고 나중에 합류한 파트너가 아무
--   설명 없이 라운지에 떨어지면 안 된다.
--
-- 왜 새 RPC를 만들지 않았나:
--   profiles에는 이미 본인 행만 허용하는 UPDATE 정책이 있다(profiles_update_own,
--   20260716114000). 이 값은 사용자가 자기 화면에서 안내를 끝냈다는 자기 신고이고,
--   남의 행이나 공유 자원을 건드리지 않는다. 그래서 service_role 경로를 새로 열지
--   않고 그 정책을 그대로 쓴다.
--
--   patch_profile_atomic에 인자를 더하는 길도 있었지만, 그건 9인자 시그니처에 묶인
--   ALTER/REVOKE/GRANT를 전부 재발급하고 옛 오버로드를 DROP해야 한다. 안내 플래그
--   하나 때문에 프로필 저장 경로 전체를 흔들 이유가 없다.
--
-- 적용 순서:
--   이 마이그레이션 없이 앱만 배포해도 안전하다. 컬럼이 없으면 코드가 "아직 안 봤다"로
--   읽으므로(packages/shared/src/contracts/firstRunTutorial.ts의 parseFirstRunTutorialState)
--   최악이 "안내를 한 번 더 본다"이고, 반대 방향인 "처음 온 사람이 아무 안내도 못 받는다"
--   보다 낫다. 반대로 이 마이그레이션만 적용해도 컬럼이 NULL로 추가될 뿐 아무것도 바뀌지
--   않는다.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS first_run_tutorial_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_run_tutorial_version integer;

COMMENT ON COLUMN public.profiles.first_run_tutorial_completed_at IS
  '이 사용자가 라운지 첫 실행 안내를 끝낸 시각. NULL이면 아직 못 봤다는 뜻이고, '
  '건너뛰기도 완료로 기록한다 — 건너뛴 사람에게 매번 다시 띄우는 것은 안내가 아니라 '
  '방해다. 준비 진척도나 활동 근거로 쓰지 않는다.';

COMMENT ON COLUMN public.profiles.first_run_tutorial_version IS
  '완료 당시의 안내 판(packages/shared FIRST_RUN_TUTORIAL_VERSION). 기능이 크게 바뀌어 '
  '다시 보여줘야 할 때 완료 기록을 지우는 대신 이 값을 비교한다 — 지운 기록은 되돌릴 수 '
  '없지만, 판은 언제 왜 다시 띄웠는지가 남는다.';

DO $postchecks$
BEGIN
  -- 두 컬럼 모두 NULL 허용이어야 한다. NOT NULL이면 기존 사용자 백필이 필요해지고,
  -- 그 백필은 "이미 봤다"를 지어내는 일이 된다.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name IN (
        'first_run_tutorial_completed_at',
        'first_run_tutorial_version'
      )
      AND is_nullable <> 'YES'
  ) THEN
    RAISE EXCEPTION 'FIRST_RUN_TUTORIAL_NULLABLE_POSTCHECK_FAILED';
  END IF;

  IF (
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name IN (
        'first_run_tutorial_completed_at',
        'first_run_tutorial_version'
      )
  ) <> 2 THEN
    RAISE EXCEPTION 'FIRST_RUN_TUTORIAL_COLUMNS_POSTCHECK_FAILED';
  END IF;

  -- 본인 행만 고칠 수 있어야 한다. 이 정책이 사라졌다면 새 컬럼을 쓰기 전에 알아야 한다.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'profiles_update_own'
  ) THEN
    RAISE EXCEPTION 'FIRST_RUN_TUTORIAL_SELF_UPDATE_POLICY_MISSING';
  END IF;
END;
$postchecks$;

COMMIT;
