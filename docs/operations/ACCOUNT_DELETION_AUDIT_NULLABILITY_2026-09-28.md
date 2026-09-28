# 탈퇴 익명 감사 기록의 legacy NOT NULL 수정

## 문제와 변경

운영 지원 탈퇴 시험에서 Auth 계정·프로필·사진을 삭제했지만 작업은
`auth_deleting / finalize_checkpoint_failed`에 남았다. 운영 catalog를 읽어 확인한
`public.account_deletions.user_id`는 UUID `NOT NULL`이었다. 현재 finalizer는 탈퇴한
사용자의 ID를 감사 기록에 남기지 않도록 `reason, deleted_at`만 INSERT한다.
초기 `CREATE TABLE IF NOT EXISTS`와 `ADD COLUMN IF NOT EXISTS`는 기존 컬럼의
NOT NULL을 교정하지 않으므로, 오래된 DB에서 마지막 트랜잭션이 SQLSTATE 23502로 실패한다.

`20260928073546_account_deletion_anonymous_audit.sql`은 Supabase CLI
`migration new account_deletion_anonymous_audit`로 생성했다. 변경은 이 UUID 컬럼의
`DROP NOT NULL` 한 건이다. 고객 행, 기존 감사 기록, Auth, Storage, 작업 상태,
finalizer 함수와 권한은 변경하지 않는다. 다른 컬럼·ACL·RLS·정책·제약·index·trigger의
catalog가 달라지면 전체 트랜잭션을 취소한다. 잠금 5초, SQL 30초 제한을 적용한다.

가짜 user_id를 넣거나 감사 INSERT를 생략하거나 작업을 수동 완료시키는 대안은 채택하지
않았다. 기존 식별자 없는 기록 계약을 지키면서 기존 데이터와 완료 절차를 보존하기 위해서다.
기존 식별자 있는 감사 행을 이번 수정으로 익명화했다는 의미는 아니다.

## 전용 릴리스 경계

기존 239개 SQL·계약·구현 핀을 그대로 보존하고 정확히 한 건만 추가한 240 successor를
등록했다. 전신 공개 loader는 새 migration을 계속 거부한다. 정적 검증은
`corepack pnpm supabase:release:fence --account-deletion-audit-nullability`이며,
CI·로컬 QA·운영 빌드 선택기는 이 계약을 명시 선택한다. 정적 PASS는 운영 적용이나
실제 탈퇴 완료의 증거가 아니다.

운영 진입점은 `corepack pnpm supabase:release:apply --account-deletion-audit-nullability`다.
`--inspect`, `--rehearse`, `--apply` 중 하나와 다음 인자를 함께 요구한다.

- `--expected-commit=<정확한 40자리 SHA>`: 관측·적용 직전 clean HEAD와 일치.
- `--project-ref=slrtobkksjmxgzatjyqb`.
- `--confirm-production=account-deletion-audit-nullability-20260928:slrtobkksjmxgzatjyqb:<모드>:<SHA>`.
- `--receipt-out=<저장소 밖의 존재하지 않는 절대 경로>`: 배타 생성·단계별 fsync.

운영 프로젝트·DB system identifier·PostgreSQL 17·원문 SQL·runtime·이전 catalog와
ledger를 고정한다. `--apply`는 같은 bundle을 먼저 ROLLBACK하고 별도로 재관측한 뒤,
2분 기한과 배타 잠금 안에서 다시 대조하여 COMMIT한다. 원문 migration ledger 한 건은
DDL과 같은 트랜잭션에 등록한다. 별도 읽기 전용 사후 관측이 일치해야 성공이다.
응답 손실, 기한 만료, 원문·catalog·ledger 변경은 자동 재시도 없이 중단한다.

사용자가 승인한 수정·검증·배포 범위에서 이번 행·Storage 무변경 nullable 확대에는
기존 [chat-feedback scoped 경계](CHAT_FEEDBACK_NULLABILITY_2026-09-13.md)를 모델로 한
새 대상 전용 계약을 적용한다. 기존 광범위 릴리스의 백업·fence·원본 복구 요구는
변경하지 않았다. 이 트랜잭션 rehearsal은 W13 전체 DB/Auth/Storage 원본 복구가 아니다.

## 롤백과 실제 시험

COMMIT 전 실패는 전체 ROLLBACK이다. 정상 NULL 감사 행이 생긴 뒤 `SET NOT NULL`로
되돌리려고 행을 삭제하거나 ID를 만들어 넣지 않는다. 앱 롤백 때도 nullable을 유지할 수 있다.
응답이 끊기면 새 영수증을 사용하는 읽기 전용 inspect로 현재 상태부터 확인한다.

실제 W12는 기존 같은 합성 작업을 재개한다. 독립 inspect에서 완료를 확인한 다음,
원래 삭제 전 baseline과 남은 배우자의 개인·공유 자료를 대조해야 다음 배우자 정리로
진행한다. 이번 migration 또는 단위 시험 PASS만으로 W12를 완료 처리하지 않는다.

## 검증 출처

- native PostgreSQL 17 합성 DB에서 실제 finalizer의 23502, 트랜잭션 롤백, 수정 후 완료,
  잘못된 job·claim·Auth-present 거절, 기존 감사 행·catalog·함수 보존을 시험한다.
- PGlite의 기존 Storage saga migration 시험에 legacy NOT NULL 회귀를 포함한다.
- 생성된 운영 bundle, stale/drift/response-loss/receipt 오류, 정적 계약·빌드 선택기를
  별도로 시험하며 원격 결과와 구분한다.
- Supabase changelog와 [migration 관리 문서](https://supabase.com/docs/guides/deployment/database-migrations),
  [PostgreSQL 17 ALTER TABLE](https://www.postgresql.org/docs/17/sql-altertable.html)을 확인했다.
  2026-09-25 minor-release의 ltree·pgcrypto legacy cipher·btree_gist·custom operator 변경은
  이 UUID nullability 수정과 직접 관련되지 않는다. 프로젝트 전체 upgrade 감사를 의미하지 않는다.

실제 실행·CI·운영 적용 결과는 해당 커밋의 PR과 외부 W12 실행 영수증에 기록한다.
미실행 검증을 완료로 기입하지 않는다.
