# Amora Engine V2 production release — 2026-07-16

이 문서는 아모라 장기기억·명시적 케어 동의·양측 중재 확인을 운영에 적용하는
릴리스 게이트다. 이전 OpenAI 전환 릴리스와 별개이며, 완료 증거 없이 완료로
표시하지 않는다.

운영 write 순서와 명령의 최종 기준은
`docs/operations/PRODUCTION_WRITE_FENCE_2026-07-17.md`다. 두 문서가 다르면 write-fence
문서를 따르고 이 문서의 축약 설명으로 순서를 재해석하거나 생략하지 않는다.

## 범위

- 기준 브랜치: `feat/amora-engine-v2-20260716`
- 최종 불변 release commit SHA: `NOT FROZEN`
- 최종 release manifest와 migration/document SHA-256: `NOT FROZEN`
- 운영 Supabase: `slrtobkksjmxgzatjyqb`
- 검증용 disposable 복구 프로젝트: `NOT CREATED`. 과거에 기록된
  `syhmfxauqyhgdcokrheg`는 현재 계정에 존재하지 않으며 재사용하지 않는다.
  SuccessHB·production·Sai와 운영 프로젝트도 복구 대상으로 사용하지 않는다.
- 운영에 요구되는 현재 remote migration head: `20260715210000`
- 현재 저장소의 정확한 pending migration 수: **27개**. 최종 manifest가 아직
  동결되지 않았으므로 아래 파일의 해시나 현재 branch HEAD를 release identity로
  사용하면 안 된다.
- 마이그레이션 순서:
  1. `20260716090000_amora_memory_engine_v2.sql`
  2. `20260716091000_care_explicit_consent.sql`
  3. `20260716092000_amora_mediation_confirmation.sql`
  4. `20260716093000_amora_care_queue.sql`
  5. `20260716094000_couple_roster_epoch.sql`
  6. `20260716095000_amora_care_delivery_policy.sql`
  7. `20260716096000_amora_tool_retry_fence.sql`
  8. `20260716097000_amora_atomic_cost_budget.sql`
  9. `20260716098000_amora_memory_budget_deferral.sql`
  10. `20260716099000_wedding_journey_singleton.sql`
  11. `20260716100000_journey_progress_atomic_item_patch.sql`
  12. `20260716102000_booking_projection_outbox.sql`
  13. `20260716103000_amora_conflict_check_claim.sql`
  14. `20260716104000_profile_patch_atomic.sql`
  15. `20260716105000_amora_conflict_receipt_checkpoint.sql`
  16. `20260716106000_amora_atomic_chat_response.sql`
  17. `20260716107000_wedding_settings_atomic.sql`
  18. `20260716108000_community_upload_service_fence.sql`
  19. `20260716109000_booking_outcome_atomic.sql`
  20. `20260716110000_amora_crash_recovery_atomicity.sql`
  21. `20260716111000_community_upload_attachment_lifecycle.sql`
  22. `20260716112000_amora_atomic_mutation_coverage.sql`
  23. `20260716113000_account_deletion_storage_saga.sql`
  24. `20260716114000_current_couple_membership_privacy_fence.sql`
  25. `20260716115000_rate_limit_pseudonym_retention.sql`
  26. `20260716116000_ai_log_retention_contract.sql`
  27. `20260716117000_account_deletion_auth_fk_contract.sql`
- expand 배포는 다음 다섯 기존 플래그와 새 intake 플래그를 모두 정확한 소문자
  `false`로 시작한다.
  - `AMORA_AUXILIARY_MEMORY_ENABLED=false`
  - `AMORA_CARE_OUTBOUND_ENABLED=false`
  - `AMORA_COMMUNITY_AI_COMMENT_ENABLED=false`
  - `AI_LOG_RETENTION_CRON_ENABLED=false`
  - `ACCOUNT_DELETION_CRON_ENABLED=false`
  - `ACCOUNT_DELETION_INTAKE_ENABLED=false`
- `ACCOUNT_DELETION_INTAKE_ENABLED`는 worker 진행과 분리된 전체 intake kill switch다.
  정확한 `true`가 아니면 삭제 job, upload fence, admin client를 만들기 전에 503으로
  종료한다. Production checker도 expand 배포에서 정확한 `false`만 허용한다.
- 현재 후보의 signed Android/iOS EAS build: `NOT RUN`. 현재 후보를 대상으로 한
  실제 기기·VoiceOver·TalkBack 검증: `NOT RUN`.
- 확인 당시 최신 Android EAS build는 과거 commit `692700db...`, versionCode 3의
  산출물이며 현재 후보 증거로 재사용할 수 없다. iOS EAS build는 0건이다.

## 변경 전 안전 게이트

1. 원격 `main`과 현재 브랜치를 다시 fetch하고 예상하지 않은 커밋·파일이 없는지
   확인한다.
2. 원격 migration head가 정확히 `20260715210000`이고, 위 27개 파일의 basename,
   순서와 최종 SHA-256가 동결된 릴리스 manifest와 정확히 일치해야 한다. 현재
   manifest 상태는 `NOT FROZEN`이므로 이 gate는 아직 통과하지 않았다.
3. 운영 write 전에 새 disposable Supabase 프로젝트에서 authenticated upload 계약과
   27개 마이그레이션 전체의 hosted schema/Auth/RLS/RPC 계약을 검증한다. 운영,
   SuccessHB, Sai, 과거의 존재하지 않는 clone은 대상이 될 수 없다.
4. 27개 마이그레이션 전체를 복구 클론에 순서대로 적용하고 DB 통합/RLS/RPC 테스트를
   통과시킨다. `pnpm amora:db:test-engine-v2`는 운영 ref를 기본 거부하며 합성
   사용자만 만들고 종료 시 Auth cascade로 정리한다.
5. 적용 직전 ACL hotfix를 날짜가 지난 문구로 추정하지 말고 다음 read-only SQL로
   다시 검증한다. 결과는 `ai_log_retention_acl_verified = 1`이어야 하며 함수 자체는
   실행하지 않는다.

  ```powershell
  corepack pnpm exec supabase db query --linked --output json `
    --file supabase/platform-operations/security/20260717141000_ai_log_retention_exact_acl_verify.sql
  ```

6. 웹 전체 test/typecheck/lint/build, 모바일 test/typecheck/export, 백업 E2E,
   `pnpm supabase:release:test`, 릴리스 정적 fence가 모두 통과해야 한다. release
   controller 테스트는 일반 root `pnpm test`에도 포함된다.
7. Vercel에 `CRON_SECRET`이 존재하고 Preview/Production 모두에서 값이 노출되지
   않는지 확인한다. `OPENAI_API_KEY`는 읽거나 출력하지 않고 존재 여부만 본다.
   `scripts/check-amora-build-env.mjs`는 실제 Vercel Production builder에서 web build의
   첫 명령으로 실행되어야 한다. 위 여섯 플래그의 exact `false`와 필수 변수 존재 여부가
   틀리면 `next build` 전에 실패한다. 성공한 exact-commit Production deployment와
   값이 없는 boolean-only builder log를 함께 증거로 보관한다.

   `vercel env run -e production`은 이 작업 공간에서 암호화된 Production 값을 주입하지
   않으므로 운영 환경 증거로 인정하지 않는다. 비밀값을 로컬 파일이나 로그로 내리지
   않는다. 최종 Production builder 검증은 현재 `NOT RUN`이다.
8. 최종 불변 commit으로 signed Android/iOS EAS build를 만들고, 같은 production
    URL과 Supabase ref를 사용한 실제 기기에서 중재·업로드·320px·긴 한국어·screen
    reader·VoiceOver·TalkBack을 검증한다. 현재 상태는 둘 다 `NOT RUN`이다.
9. 위 비운영 gate와 GitHub checks가 통과한 뒤에만 병합한다. 그 다음 운영 단계는
   반드시 다음 순서를 지킨다.
   1. exact commit을 `PRODUCTION_WRITE_FENCE_ENABLED=true`로 배포하고 Auth signup,
      public DB, Storage global writes를 닫는다.
   2. signed-upload drain을 DB clock 기준 130분 기다리고 5분 추가 안정성을 증명한다.
   3. 그 뒤에만 fresh 14-table HBAM2 backup과 다른-project hosted restore를 만든다.
   4. controller check-only 후 정확한 27개 migration을 한 번 적용한다.
   5. DB fence가 닫힌 상태에서 final Storage contract를 설치하고 controller를 resume한다.
   6. fresh 27-table post-expand backup과 별도 hosted restore를 검증한다.
   7. exact deployment를 5분 이상 canary하고 exact-owner finalizer를 실행한다.
   8. finalizer 성공 뒤 Storage 음양성 canary, web fence 해제 exact redeploy, Auth signup
      재개 순으로 연다.

## Storage freeze와 1080 final contract

상태: 최종 후보 기준 production 작업 `NOT RUN`.

`20260716108000_community_upload_service_fence.sql`은 앱 소유 session/RPC를 추가할 뿐
Supabase 소유 `storage.objects` policy나 bucket을 변경하지 않고, Dashboard 작업의
완료 여부도 migration 안에서 검사하지 않는다. Storage 작업은 두 단계다.

1. migration 전에는 write-fence 런북 Phase 1의 global freeze만 적용한다. 신규 web
   write와 signup을 닫고 모든 Storage mutation policy를 제거한 뒤 130분+5분 drain을
   증명한다. 이 drain 뒤에만 14-table backup을 캡처한다.
2. migration과 별도인 final Storage contract는 27개 migration 적용 뒤 Phase 4에서
   설치한다. final INSERT policy는 DB helper를 호출하며 temporary DB fence가 있는 동안
   false여야 한다. post-push evidence와 controller resume가 통과하기 전에는 다음
   단계로 가지 않는다.

실패 시 staging을 public으로 바꾸거나 broad direct-write policy를 복원하지 않는다.
safe freeze-convergence artifact로 닫힌 상태를 유지하고 forward fix한다. DB backup은
Storage object body를 포함하지 않으므로 provider backup과 Storage inventory를 별도로
보존한다.

## 운영 DB 적용

- 일반 `supabase db push`, `--include-all`, migration history 추측 보정은 금지한다.
- `scripts/supabase-production-release.mjs`만 운영 적용 진입점으로 사용한다. 이
  controller가 생겼다는 사실은 운영 적용 승인이 아니다. 최종 manifest 해시,
  복구 클론, 전체 CI, 백업/복구, 배포·롤백 게이트가 모두 통과하기 전에는 실행하지
  않는다. SQL 파일의 `SET LOCAL`은 자체 `BEGIN/COMMIT`을 만들지 않으므로 SQL
  Editor에서 직접 실행해서도 안 된다.
- controller는 다음을 모두 fail-closed로 확인한다.
  - manifest의 프로젝트 ref, migration basename/순서/정규화 SHA-256, release-era
    파일 집합
  - 깨끗한 release HEAD와 `git ls-remote`로 읽은 정확한 원격 브랜치 SHA
  - 실행 전후 같은 `supabase/.temp/project-ref`; 로컬 배타 lock은 같은 저장소의
    중복 실행을 막고, ref 파일의 inode/size/mtime/content 변경도 차단한다
  - pre-expand 백업 receipt와 그 receipt의 `GitCommit`에 있는 별도 clean checkout의
    verifier 재실행(최대 30분)
  - package에 고정된 Supabase CLI version과 fresh backup receipt의 native binary
    SHA-256가 현재 native binary와 정확히 같음; wrapper override 없이 그 binary를
    직접 실행
  - `db push --linked --dry-run`의 정확한 pending 순서, 고정 인자로 단 한 번 실행한
    공식 repo-local Supabase CLI push, 적용 후 pending 0과 migration ledger
  - manifest에 해시 고정된 비어 있지 않은 `preApplyChecks`와 `postApplyChecks`.
    둘 다 `BEGIN TRANSACTION READ ONLY` envelope를 사용하며, precheck에는 위 ACL
    hotfix 검증과 release-time 데이터 후조건이 포함되어야 한다
  - 여러 컴퓨터의 동시 실행을 막는 운영 DB singleton lease. controller가 claim한
    정확한 owner UUID는 배포·카나리 동안 유지되며 다른 owner는 push 전에 차단된다
  - 같은 backup-set·manifest·release commit에 묶인 다른 Supabase 프로젝트 hosted
    restore receipt와 Auth·Storage metadata·typed schema·RLS·RPC/ACL 검증
- manifest의 `requiredDocuments`는 운영 실행·복구에 직접 필요한 12개 문서만 해시
  고정한다. superseded snapshot인 `AMORA_ENGINE_V2_SAFETY_HANDOFF_2026-07-16.md`와
  기능별 참고 문서는 이 12개 pin 대상이 아니며, 이 제외가 코드·테스트·운영 증빙
  게이트를 면제하지는 않는다.
- 변경 전 백업은 release checkout에서 억지로 만들지 않는다. 새 Engine V2 테이블이
  아직 없는 운영은 문서 앞부분대로 14-table 도구가 있는 깨끗한 pre-expand
  checkout에서 생성·즉시 검증한다. 그 checkout을 그대로 보존하고 verifier JSON
  receipt를 Git 밖의 private 경로에 저장한다.
- 현재 최종 불변 커밋과 manifest는 `NOT FROZEN`이므로 controller를 실행할 수 없다.
  `PRODUCTION_WRITE_FENCE_2026-07-17.md` Phase 3의 `--check-only`, `--apply`와 Phase 4의
  `--resume-post-push` 명령을 그대로 사용한다. 축약된 `--apply` 예시를 복사하거나
  angle bracket을 실제 인자처럼 입력하지 않는다. private receipt 디렉터리는 저장소
  밖에 둔다.

- controller 인자, 환경 변수, receipt에 DB password, access token, API key를 넣지
  않는다. child process 출력은 성공/실패 판단에만 쓰고 터미널이나 receipt에 복사하지
  않는다. controller는 `--include-all`, repair, reset, 사용자 지정 SQL/CLI 인자를
  받지 않으며 `SUPABASE_CLI_BINARY_OVERRIDE`도 거부한다.
- 성공 여부가 불명확하면 재실행하지 말고 migration ledger와 후조건을 먼저 읽는다.
- push 시작 전 outcome receipt가 `started`로 fsync된다. push 오류·signal 또는 이후
  검증 실패는 `ambiguous_*` receipt와 local lock을 남긴다. 이때 **절대 재실행하지
  말고**, 별도의 read-only 조사에서 운영 ledger와 스키마 후조건을 판정한 뒤 두 명이
  receipt와 lock 해제를 검토한다. migration repair/reset으로 상태를 맞추지 않는다.
- 적용 후 pending set은 0이어야 한다.
- DB 검증 성공 뒤에는 `database_expand_verified_lease_held` 상태로 정확한 원격
  lease와 로컬 lock을 유지한다. exact-owner finalizer는 구현되어 로컬 controller,
  PGlite, adversarial 회귀 검증이 통과했지만 실제 운영 실행 증빙은 아직 없다. 이
  finalizer는 post-expand 27-table 백업·다른 프로젝트 hosted restore·정확한 배포와
  카나리 receipt를 다시 검증한 뒤에만 lease 삭제와 DB fence 제거를 한 트랜잭션에서
  수행한다. 수동 lease 삭제나 rollback SQL 직접 실행으로 우회하지 않는다.
- 익명 RLS probe와 다음 후조건을 확인한다.
  - 기억 설정·동의·작업 테이블은 익명/일반 사용자 쓰기 불가
  - 공유 기억은 두 사용자 동의 전 `enabled=false`
  - 기억 upsert 재시도는 같은 노드, 값 변경은 이전 노드 폐기
  - 중재는 두 사용자 동의 전 공동 결정 0건
  - 회원 권한 기억 쓰기는 커플 구성 row lock 뒤에 범위 lock을 획득
  - 중재 확인은 화면에 표시된 서버 생성 proposal version과 현재 커플 구성
    fingerprint를 DB가 원자적으로 대조하며, 카드 일부 수정·되돌림이나 파트너
    교체 후 이전 확인을 재사용하지 않음
  - 기억·중재 구성 초기화와 중재 proposal binding 안전 트리거가 정확한 이벤트로 활성화됨
  - 과거 케어 기본값은 동의 시각 없이 발송 가능하지 않음
- 서비스 전용 RPC probe는 큐 등록·기억 저장·수정·삭제·요약 저장·케어 메시지
  저장이 모두 DB에서 회원 범위와 최신 동의를 다시 확인하는지 검증한다.
- 전체 초기화도 요청 사용자 UUID를 받아 DB에서 현재 커플과 개인 범위를 다시
  확인해야 한다. API 인증만으로 충분하다고 보지 않는다.
- 동의를 처음 켠 뒤 과거 메시지가 소급 컴파일되지 않고, 사용자가 고친 기억이
  자동 저장으로 덮어써지지 않으며, 개별 삭제한 의미 키가 다시 생기지 않아야 한다.
- 큐·기억 노드·요약 RPC는 `memory_reset_at` 이전 메시지를 DB에서 최종 거부해야
  한다. 애플리케이션 쿼리만으로 이 경계를 보장한 것으로 간주하지 않는다.
- 최초 활성화는 명시적 동의 도입 전의 자동 요약·프로필·미확인 추론 기억을 같은
  트랜잭션에서 제거해야 한다. 사용자가 직접 고친 기억은 보존한다.
- 만료 후 재획득된 작업은 이전 `attempt_count`의 완료 호출을 거부하고, 5번째
  시도에서 워커가 사라진 작업은 `LEASE_EXHAUSTED`로 종결돼야 한다.
- 병렬 `claim_amora_memory_job` 호출에서도 같은 커플·범위의 작업은 하나만 선점돼야
  한다. 복구 클론의 실제 병렬 RPC로 검증한다.
- 적용 직후 `vendor_reviews`를 포함한 새 27-table HBAM2 백업을 생성·즉시
  검증한다. 이 백업은 기준 head 이후 정확한 27개 버전과 최종 head
  `20260716117000`을 요구하며 누락 또는 추가 버전을 거부한다.

## 복구 클론 검증 기록

- 아래 2026-07-16 기록은 0900~0920 세 파일만 검증한 **superseded historical
  snapshot**이다. 현재 27개 migration 후보의 clone 검증으로 재사용할 수 없다.
- 현재 27개 전체를 새로 만든 격리 disposable with-data 프로젝트에 적용한 hosted
  검증: `NOT RUN / NOT CREATED`. 과거 `syhmfxauqyhgdcokrheg`는 존재하지 않으며
  증거 대상으로 재사용하지 않는다.
- `pnpm amora:db:test-engine-v2`: 통과. 익명/일반 사용자 권한, 2인 기억 동의,
  동의 이전 메시지 차단, 병렬 큐 선점 직렬화, 수정 보호, 삭제 tombstone, 전체 초기화, 케어 양측 동의,
  중재 양측 확인을 실제 호스팅 PostgreSQL에서 검증.
- `pnpm amora:db:test-preview`: 통과. Auth 삭제 cascade, 원자적 커플 초기화,
  남은 파트너 유지, 병렬 채팅·도구·비용 fence를 회귀 검증.
- 위 결과는 후속 안전성 검토에서 `0900`·`0920` 마이그레이션을 수정하기 전
  스냅샷의 증거다. 현재 후보의 manifest hash를 고정한 뒤 같은 복구 클론 검증을
  다시 통과하기 전에는 현재 후보의 운영 증거로 사용하지 않는다.
- 위 기록은 클론 검증 증거일 뿐 운영 DB 적용·GitHub 병합·Vercel 배포 완료를
  의미하지 않는다.

## 호환 배포와 활성화

1. 비운영 clone·signed mobile·GitHub 필수 체크가 모두 성공한 불변 커밋만 병합한다.
2. 첫 Vercel Production 배포는 `PRODUCTION_WRITE_FENCE_ENABLED=true`와
   `AMORA_AUXILIARY_MEMORY_ENABLED=false`,
   `AMORA_CARE_OUTBOUND_ENABLED=false`,
   `AMORA_COMMUNITY_AI_COMMENT_ENABLED=false`,
   `AI_LOG_RETENTION_CRON_ENABLED=false`,
   `ACCOUNT_DELETION_CRON_ENABLED=false`,
   `ACCOUNT_DELETION_INTAKE_ENABLED=false`로 배포한다. production env checker receipt가
   없으면 이 단계로 진행하지 않는다.
3. DB·final Storage·27-table backup/restore가 통과한 뒤에도 모든 write fence를 유지한
   채 exact deployment를 5분 이상 카나리한다. 로그아웃/로그인, 공유·개인 채팅,
   일정·예산 read path, 기억 설정, 중재 카드, 케어 설정을 확인한다.
4. exact-owner finalizer가 `verified_success`인 뒤에만 Storage 음양성 canary를 수행하고
   `PRODUCTION_WRITE_FENCE_ENABLED=false`로 같은 commit을 정확히 재배포한 다음 Auth
   signup을 마지막에 연다.
5. 기능 플래그는 fence 해제와 함께 켜지 않는다. 각 기능의 별도 gate에서 오류율·첫
   토큰 시간·중복 도구 실행·모바일 회귀가 없을 때 하나씩 활성화한다.
6. 플래그 활성화 후에도 사용자 동의 기본값은 꺼짐이다. 합성 계정으로 개인 기억과
   공유 양측 동의 흐름을 검증하고 합성 데이터를 삭제한다.
7. 30분 이상 크론 성공/실패/재시도, 상담 오류율, 비용을 관찰한다.
8. retention, account-deletion worker/intake, community AI, care outbound는 서로 다른
   외부·파괴 효과다. 하나의 카나리 성공으로 다른 플래그를 함께 켜지 않는다.

## 롤백

1. 가장 먼저 `AMORA_AUXILIARY_MEMORY_ENABLED=false`로 설정하고 재배포해 새 큐
   생성과 처리를 멈춘다.
2. 문제가 케어 발송이면 `AMORA_CARE_OUTBOUND_ENABLED=false`로 설정하고
   재배포한다. 명시적 동의 시각이 없는 외부 발송은 계속 fail-closed여야 한다.
3. `AMORA_COMMUNITY_AI_COMMENT_ENABLED=false`,
   `AI_LOG_RETENTION_CRON_ENABLED=false`,
   `ACCOUNT_DELETION_CRON_ENABLED=false`,
   `ACCOUNT_DELETION_INTAKE_ENABLED=false`를 유지한다. 삭제 요청 route가 admin client나
   DB write 전에 503으로 닫히는지 확인한다.
4. 이전의 검증된 Vercel 배포로 되돌린다.
5. DB 마이그레이션은 expand-only로 남긴다. 장애 중 테이블/열/함수를 삭제하는
   down migration은 실행하지 않는다.
6. 데이터 손상이 확인된 경우에만 새 쓰기를 차단하고 공급자 복구 또는 별도 승인된
   HBAM2 복원 절차를 사용한다. 운영 DB에 논리 백업을 직접 재생하지 않는다.
7. 케어 동의를 과거 `true` 값으로 자동 복원하지 않는다. 사용자가 다시 동의해야
   한다.

## 완료 정의

- final manifest freeze·global Storage freeze/drain 뒤 14-table pre-backup과 다른
  프로젝트 hosted restore·27개 clone 검증·ACL precheck·운영 DB 적용·final Storage
  receipt·27-table post-backup과
  별도 프로젝트 restore·GitHub 병합·Vercel ready·write-fenced 카나리·exact-owner
  finalizer·post-lift 음양성 canary·플래그 전후 카나리와 30분 관찰이 모두 증거로
  남았을 때만 완료다.
- 복구 클론, 실제 EAS 모바일 빌드 또는 운영 환경 인증이 막히면 해당 항목을 미완료로
  기록한다. 로컬 export를 실제 스토어 빌드라고 부르지 않는다.
- exact-owner fence finalizer 구현과 로컬 회귀 검증은 완료됐다. 현재 final SHA/hash는
  `NOT FROZEN`이고, signed EAS/real-device, 최종 Production env checker, 실제 pre/post
  hosted restore, 배포·카나리·finalizer 운영 receipt는 모두 `NOT RUN`이다. 따라서 이
  문서 작성 시점의 완료 상태는 **NO-GO / NOT DEPLOYED**다.
