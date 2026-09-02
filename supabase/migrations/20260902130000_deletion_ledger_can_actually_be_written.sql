-- 삭제 원장이 실제로 써지게 한다
--
-- ## 무엇이 문제였나
--
-- `finalize_account_deletion_job`(20260716113000)은 삭제를 마치며 원장에 한 줄을
-- 남긴다:
--
--     INSERT INTO public.account_deletions(reason, deleted_at) ...
--
-- 그런데 운영·스테이징 모두 `account_deletions.user_id` 가 **NOT NULL 이고
-- 기본값이 없다.** 채워 줄 트리거도 0개다. 그래서 이 INSERT 는 **항상**
-- `23502 null value in column "user_id"` 로 실패한다. 스테이징에서 워커 순서
-- 그대로 재현했다(2026-09-02).
--
-- 이 실패가 나쁜 이유는 **일어나는 시점** 때문이다. Storage 삭제와 `auth.users`
-- 삭제가 **끝난 뒤**에 실패한다. 즉:
--
--   * 계정은 진짜로 사라진다
--   * 작업 행은 `auth_deleting` 에 영원히 남아 **탈퇴자 UUID 와 사유를 계속 들고 있다**
--   * 크론은 5분마다 영원히 재시도하고 503 을 낸다
--   * 화면이 약속한 "탈퇴 사유와 시각은 누구인지 알 수 없는 형태로만 남아요"가
--     **첫 탈퇴부터 거짓**이 된다
--
-- ## 왜 nullable 로 푸는가 (반대 방향이 아니라)
--
-- 고르는 길이 둘이었다. (a) 컬럼을 nullable 로 풀거나, (b) 함수가 `user_id` 를
-- 넣게 하거나.
--
-- **(a)가 저장소의 계약과 맞다.** `packages/shared/src/constants/accountDeletionPolicy.ts`
-- 가 사용자에게 "누구인지 알 수 없는 형태로만 남는다"고 말하고, 함수도 처음부터
-- 그렇게 쓰도록 작성돼 있다. (b)로 가면 식별자가 원장에 남으므로 화면 문구와
-- 처리방침을 함께 고쳐야 하고, 그건 사용자에게 한 약속을 뒤집는 일이다.
--
-- 외래키는 없다(`pg_constraint` 확인: PK 하나뿐). 그래서 nullable 로 푸는 것만으로
-- 충분하고, `auth.users` 가 이미 지워진 뒤에도 INSERT 가 성립한다.
--
-- ## 남아 있는 옛 행 하나
--
-- 운영에 2026-05-13 자 행 하나가 `user_id` 와 `email` 을 **가진 채** 있다. 지금은
-- 없는 옛 경로가 남긴 것이다. 그 행을 어떻게 할지는 데이터 처분이라 이 마이그레이션이
-- 정하지 않는다 — 파운더에게 알리고 결정을 받는다.

ALTER TABLE public.account_deletions
  ALTER COLUMN user_id DROP NOT NULL;

COMMENT ON COLUMN public.account_deletions.user_id IS
  '옛 경로가 쓰던 자리. 현재 삭제 경로는 채우지 않는다 — 이 원장은 "누구인지 알 수 없는 형태"로만 남는다고 사용자에게 약속했다(accountDeletionPolicy.ts). NOT NULL 로 되돌리면 finalize 가 100% 실패하고, 계정이 지워진 뒤에 실패하므로 작업이 영원히 "처리 중"에 갇힌다.';

COMMENT ON COLUMN public.account_deletions.email IS
  '옛 경로가 쓰던 자리. 현재 삭제 경로는 채우지 않는다 — 식별 정보를 남기지 않는다.';
