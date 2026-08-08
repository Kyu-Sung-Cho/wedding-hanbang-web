-- 준비 상태 — 이 사람에게 지금 결혼 준비가 진행 중인가.
--
-- 왜:
--   예식이 연기되거나 취소된 사람에게 앱이 계속 "D-42"를 띄우고 축하하고 다음 할 일을
--   독촉한다. 지금 코드에는 그 상태 자체가 없어서 끌 방법이 없다. 어떤 버그보다 아픈
--   자리다.
--
-- 왜 커플 공유가 아니라 개인 컬럼인가:
--   예식 취소는 분명히 두 사람의 일이다. 그런데도 이 상태만은 혼자 정할 수 있어야 한다.
--   카운트다운을 끄는 데 상대의 승인이 필요하면, 관계를 떠나는 사람이 바로 그것을 끄지
--   못한다. 상대에게 자동으로 알려서도 안 된다 — 알림 자체가 위험이 되는 상황이 있다.
--   그래서 profiles(개인)에 두고, couples/wedding_journeys(공유)는 건드리지 않는다.
--   상대의 화면은 바뀌지 않는다. 바뀌는 것은 이 사람에게 아모라가 말하는 방식뿐이다.
--
--   두 사람이 함께 정리하기로 했다면 예식일과 일정은 평소의 공동 승인 경로로 바꾼다.
--
-- 모델이 정하지 않는다:
--   사용자가 "결혼 취소했어"라고 말했다고 아모라가 이 값을 바꾸지 않는다. 사람의 가장
--   아픈 사실을 모델의 해석으로 확정할 수는 없다. 그래서 이 컬럼을 쓰는 도구를 만들지
--   않고, 설정 화면에서 본인만 바꾼다. RLS도 본인 행만 허용한다.
--
-- 적용 순서:
--   이 마이그레이션 없이 앱만 배포해도 안전하다. 값이 없으면 코드가 'preparing'으로
--   보므로(packages/shared/src/contracts/preparationStatus.ts) 기존 동작 그대로다.
--   반대로 이 마이그레이션만 적용해도 컬럼이 기본값으로 채워질 뿐 아무것도 바뀌지 않는다.

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preparation_status text NOT NULL DEFAULT 'preparing',
  ADD COLUMN IF NOT EXISTS preparation_status_changed_at timestamptz;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_preparation_status_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_preparation_status_check
      CHECK (preparation_status IN ('preparing', 'paused', 'called_off'));
  END IF;
END;
$constraints$;

COMMENT ON COLUMN public.profiles.preparation_status IS
  '이 사용자에게 결혼 준비가 진행 중인지. preparing=진행 중, paused=잠시 멈춤, '
  'called_off=이어가지 않음. 본인만 바꾸며 상대에게 알리지 않는다. 공유 여정의 '
  '예식일과는 별개이고, 아모라의 말투(카운트다운·축하·재촉)만 바꾼다.';
COMMENT ON COLUMN public.profiles.preparation_status_changed_at IS
  '마지막으로 준비 상태를 바꾼 시각. 되돌린 시점을 사용자에게 보여주기 위한 값이며 '
  '판단 근거로 쓰지 않는다.';

DO $postchecks$
BEGIN
  -- 기본값이 preparing이어야 한다. 컬럼이 생겼다는 이유로 기존 사용자의 준비가
  -- 멈춘 것처럼 보이면 안 된다.
  IF (
    SELECT column_default FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles'
      AND column_name = 'preparation_status'
  ) IS DISTINCT FROM '''preparing''::text' THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_STATUS_DEFAULT_POSTCHECK_FAILED';
  END IF;

  -- 열거값 밖의 값은 거부돼야 한다.
  BEGIN
    UPDATE public.profiles SET preparation_status = 'wat'
    WHERE false;
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_preparation_status_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_STATUS_CHECK_POSTCHECK_FAILED';
  END IF;
END;
$postchecks$;

COMMIT;
