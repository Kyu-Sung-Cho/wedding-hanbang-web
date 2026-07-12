# 운영 출시·롤백 runbook

이 문서는 `hanbang.ai`, 운영 Supabase, EAS 모바일 빌드를 함께 출시할 때의 실행 기준이다. GitHub CI나 Vercel 빌드가 초록색이라는 이유만으로 운영 준비가 끝났다고 판단하지 않는다.

## 불변 규칙

- 운영 Supabase ref는 `scripts/release-targets.json`의 보호 목록과 실행 인수가 모두 같아야 한다.
- `productionDatabaseWriteFence`는 실제 웹·모바일의 DB/Storage 직접 쓰기 차단을 자동 probe로 입증하기 전에는 `not_configured`를 유지한다. 형식적으로 `verified-v1`로 바꾸지 않는다.
- 운영에서는 원시 `supabase db push`, `migration repair`, `db reset --linked`, `--include-all`, SQL Editor 수동 이어붙이기를 사용하지 않는다.
- backup/restore와 Storage 객체 복구를 각각 검증한다. Supabase DB backup은 Storage 실제 객체를 포함하지 않는다.
- DB 변경 전부터 최종 canary가 끝날 때까지 정확한 Git SHA, Vercel deployment, migration 목록, backup/recovery point가 바뀌지 않아야 한다.
- 사용자 데이터의 삭제·가명화·소유권 변경은 수량만 맞는다고 자동 승인하지 않는다. 제품·개인정보 책임자의 명시적 결정을 release evidence에 남긴다.
- 현재 운영 `ship`과 baseline reconcile은 fence snapshot·자동 black-box evidence가 한 lifecycle로 연결되기 전까지 코드에서 의도적으로 중단된다. fuse 문자열만 바꿔 우회할 수 없다.

## GO 조건

아래 항목 중 하나라도 실패하거나 확인할 수 없으면 병합·운영 DB 변경을 하지 않는다.

1. PR HEAD와 원격 branch가 같고 worktree가 clean이다.
2. exact SHA의 CI, 타입, 테스트, lint, build, production dependency audit가 통과했다.
3. PR은 Draft가 아니고 최신 변경을 본 독립 리뷰가 있다.
4. Vercel production 환경 변수의 **이름·적용 대상·최종 수정 시각**을 확인했다. 값은 로그나 문서에 출력하지 않는다.
5. exact SHA의 maintenance deployment가 `MAINTENANCE_MODE=true`로 응답하고 health endpoint가 같은 Supabase ref와 SHA 앞 12자리를 반환한다.
6. 웹 maintenance를 우회하는 기존 모바일·오래 열린 브라우저의 Data API/Auth/Storage 쓰기가 실제 black-box probe에서 거부된다.
7. production preflight의 hard blocker가 모두 0이고 rewrite/delete inventory가 승인된 수량과 같다.
8. migration history가 local의 연속 prefix다. core baseline history만 누락됐고 catalog가 exact일 때만 전용 reconcile 절차를 먼저 사용한다.
9. maintenance/write drain 뒤의 복구 지점이 존재하고, 같은 종류의 restore를 별도 프로젝트에서 연습해 RPO·RTO·검증 결과를 기록했다.
10. 마지막 배포 모바일과 새 모바일의 expand 호환 여정을 staging에서 모두 통과했다.
11. signed iOS Team ID와 Play App Signing fingerprint가 확정됐고, association JSON·웹 fallback·실기기 deep link가 같은 exact SHA에서 통과했다.
12. 현재 과거 production deployment는 `coming_soon` 서버 gate를 포함하지 않으므로 rollback target으로 승인하지 않는다. DB 변경 전에 공개 allowlist만 여는 launch-gate 호환 deployment를 별도 생산·canary하고 deployment ID를 고정했다.
13. 사용자 연구 접수를 공개하려면 사업 책임자가 선정 기준, 최대 인원, 검토 책임자, 선정·미선정 통지 기한, 문의·삭제 요청 SLA와 통지 문안을 승인하고 release evidence에 남겼다. 이메일 확인은 선정이 아니며, 이 운영 결정 없이 자동 선정 상태나 결과 메일을 임의로 만들지 않는다.
14. Resend의 확인 메일 발송 도메인에서 **click tracking이 비활성화**되어 있고 링크가 tracking redirect로 재작성되지 않는다는 설정 화면·확인 시각을 증거로 남겼다. Fragment capability가 provider tracking URL에 복사될 수 있으므로 이 증거가 없으면 사용자 연구 메일을 운영 발송하지 않는다. Resend도 이메일 확인 같은 민감한 transactional email에는 추적 비활성화를 권장한다: [Open and Click Tracking](https://resend.com/docs/dashboard/domains/tracking).

## 정상 출시 순서

### 0. 안전 rollback anchor 확보

현재 `main`의 과거 Vercel deployment는 `NEXT_PUBLIC_LAUNCH_MODE=coming_soon`을 해석하지 않아 Instant Rollback 시 로그인·앱·일반 API가 다시 열릴 수 있다. 본 출시와 DB 변경 전에 launch gate를 포함한 exact SHA를 `RESEARCH_COHORT_APPLICATIONS_ENABLED=false`, `ACCOUNT_DELETION_CRON_ENABLED=false`로 production에 먼저 배포해 공개 allowlist·일반 API 503·토큰 없는 redirect·연구 접수 API 503·계정 삭제 job 미claim을 canary하고, 그 immutable deployment ID와 환경 변수 적용 시각을 rollback anchor로 기록한다. 이 anchor가 없으면 아래 maintenance/DB 단계로 진행하지 않는다. 과거 deployment는 호환 증거가 생길 때까지 rollback 대상에서 제외한다.

### 1. 증거 고정

```powershell
git status --short --branch
git rev-parse HEAD
gh pr view 38 --json headRefOid,baseRefName,isDraft,mergeable,mergeStateStatus
gh pr checks 38
```

검토 SHA와 migration/release script fingerprint를 release ticket에 기록한다. 이 뒤 파일이나 HEAD가 바뀌면 처음부터 다시 검증한다.

### 2. maintenance deployment

Vercel production에 아래 값을 설정한 새 deployment를 만든다.

- `MAINTENANCE_MODE=true`
- `MAINTENANCE_STARTED_AT_UTC=<현재 UTC ISO-8601>`
- 검토된 production Supabase URL
- 32자 이상이면서 공백·예시값·저엔트로피·다른 신뢰 경계 비밀 재사용이 없는 전용 `RATE_LIMIT_KEY_SECRET`
- 다른 비밀과 재사용하지 않은 32자 이상 `RESEARCH_EMAIL_VERIFICATION_SECRET`
- 실제 발송 도메인이 확인된 `RESEND_API_KEY`
- 확인 메일 링크를 재작성하지 않도록 비활성화한 Resend click tracking 설정
- DB·메일·삭제 canary 전에는 `RESEARCH_COHORT_APPLICATIONS_ENABLED=false`; 검증 중 maintenance에서만 일시적으로 `true`, 정상 공개는 전체 사용자 연구 운영 승인 뒤에만 `true`
- fresh/upgrade migration, encrypted backup, isolated restore drill, queue health가 모두 검증되기 전에는 `ACCOUNT_DELETION_CRON_ENABLED=false`; 삭제 canary 직전에만 `true`를 적용한 exact-SHA deployment를 만들고 실패 시 즉시 false anchor로 rollback

다음을 확인한다.

```text
GET https://hanbang.ai/api/health/maintenance
maintenance = true
supabaseProjectRef = protected production ref
deployment = reviewed SHA first 12 chars
rateLimitKeySecretConfigured = true
```

페이지와 일반 API는 503이어야 한다. app association 세 경로와 health endpoint만 직접 응답한다. health endpoint가 404이거나 SHA가 다르면 중단한다.

### 3. 직접 쓰기 fence와 drain

웹 503만으로는 fence가 아니다. 배포된 모바일은 Supabase에 직접 쓸 수 있다. Data API, Auth가 만드는 DB 쓰기, Storage upload/update/delete를 모두 차단하고 다음을 자동 probe한다.

- 배포된 legacy anon key 요청 거부
- 배포된 publishable key 요청 거부
- 새 로그인·토큰 갱신·DB INSERT/RPC·Storage upload 거부
- release 전용 DB 연결만 허용
- 활성 사용자 transaction 0

저장소의 `supabase:fence`는 `database-readonly-realtime-cron-v1` 계약의 스냅샷·활성화·검증·복구 경계를 구현한다. 단, 이것은 로컬 계약 구현일 뿐 운영 검증 완료가 아니다.

```powershell
corepack pnpm supabase:fence -- -Action Plan -ExpectedProjectRef <20-char-non-production-ref>
```

`scripts/release-targets.json`의 `productionDatabaseWriteFence`는 현재 `not_configured`이고 `approvedNonProductionSupabaseProjectRefs`도 비어 있다. 사용자가 명시적으로 승인한 폐기 가능한 Supabase 프로젝트 ref를 allowlist에 넣기 전에는 원격 fence·migration·recovery export가 모두 중단된다. 그 프로젝트에서 Management API network status, 역할별 read-only, 기존 pooled session 종료 경계, `ALTER SYSTEM`, cron drain, release writer와 Data API/Auth/Storage black-box 거부, 실패 복구를 모두 연습하고 증거를 독립 검토하기 전에는 운영 fuse를 바꾸지 않는다.

현재 구현은 production에서 operator가 작성한 `post-migration-release-evidence-v1`을 거부하고, `supabase:ship:safe`와 `supabase:baseline:core`도 활성 snapshot·자동 probe producer가 연결될 때까지 무조건 중단한다. 따라서 아래 lifecycle은 **아직 실행 명령이 아니라 disposable 검증에서 완성해야 할 계약**이다.

```text
Capture → Activate → Verify → MarkMigrationStarted
→ guarded baseline/ship → automated black-box evidence
→ MarkMigrationVerified → Deactivate → exact restore-state verification
```

### 4. backup·restore 증거

```powershell
corepack pnpm exec supabase backups list `
  --project-ref <production-ref> --output-format json
```

backup은 `COMPLETED`, 올바른 project, 승인된 recovery window여야 한다. PITR이면 latest recovery point가 drain 뒤인지 확인한다. daily physical backup만 있으면 임의 시각의 최신 복구 지점을 보장할 수 없으므로 maintenance 창과 맞지 않는 오래된 backup을 승인하지 않는다.

현재 `supabase:ship:safe` 구현은 **maintenance 시작 뒤 완료되고 30분 이내인 최신 physical backup ID만** 허용한다. PITR recovery timestamp를 입력받거나 검증하지 않는다. PITR을 켰다는 사실만으로 이 gate를 통과 처리하지 말고, recovery-window 검증을 스크립트에 구현해 별도 환경에서 restore까지 연습한 뒤에만 PITR 경로를 사용한다.

복구 훈련은 운영 원본을 덮어쓰지 않고 별도 프로젝트에서 수행한다.

- DB schema/data/Auth user가 기대한 시점과 일치
- extension, RLS, function ACL, cron 재구성 확인
- Storage bucket/object는 별도 inventory/export와 복구 확인
- 측정 RPO·RTO 기록

Phase-A 안전 도구는 아래처럼 로컬 보안 경계를 검증한다.

```powershell
corepack pnpm supabase:recovery:test
```

`supabase:recovery:safe`는 pinned CLI와 native tool hash 정책, 최소 child 환경, 위험 플래그 차단, age 암호화, DB dump와 Storage byte manifest, exact archive 검증, plaintext cleanup 검증, 격리 대상 allowlist를 제공한다. 현재 `restore-verify`는 archive와 대상 준비 상태만 확인하며 DB/Storage restore를 실행하지 않고 항상 `releaseEligible=false`다. 운영 export도 live fence snapshot·자동 black-box evidence와 cryptographically binding되기 전까지 fuse 문자열과 무관하게 hard-stop한다. 현재 머신에는 `age`가 없고 운영 tool path/hash·recipient·restore allowlist도 비어 있다. 따라서 `backupPolicy.status`는 `not_configured`로 유지한다. 승인된 key custody, 유료 격리 프로젝트, 실제 restore·Storage 재업로드·parity·RPO/RTO 증거가 모두 생긴 뒤에만 정책을 변경한다.

공식 기준: [Supabase Database Backups](https://supabase.com/docs/guides/platform/backups), [CLI backup/restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)

### 5. migration — 현재 production 실행 금지

core baseline history 누락이면서 exact catalog gate가 통과한 경우에만 먼저 전용 reconcile을 수행한다.

```powershell
corepack pnpm supabase:baseline:core -- -ExpectedProjectRef <production-ref>
```

그 뒤 dry-run이 검토한 pending suffix와 정확히 같을 때만 guarded ship을 실행한다.

```powershell
corepack pnpm supabase:ship:safe -- `
  -ExpectedProjectRef <production-ref> `
  -BackupRef <verified-backup-id> `
  -MaintenanceModeActive `
  -TrafficDrained `
  -MaintenanceAuthorizedUntilUtc <UTC-within-30m>
```

현재 두 production 명령은 lifecycle 통합 전용 hard stop에서 실패해야 정상이다. 이 hard stop을 삭제하거나 fuse만 바꾸지 않는다. 향후 통합된 스크립트가 요구하는 `ACK_REWRITES`, drain, apply 확인은 실제 inventory와 책임자 승인 기록이 있을 때만 입력한다. 실패 후 수동 SQL로 이어서 적용하지 않는다.

### 6. 앱 배포와 fence 해제

자동 evidence producer가 post-deploy DB contract, migration dry-run 0개, Data API/Auth/Storage write denial, release writer, anon denial을 같은 fence ID와 SHA에 묶어야 한다. `MarkMigrationVerified`와 exact restore 확인 뒤에만 Storage retirement를 별도 공식 API 단계로 실행한다. 그 뒤 같은 SHA의 일반 production deployment를 만들고 `MAINTENANCE_MODE=false`로 전환한다. 공개 key를 재활성화했다면 legacy와 publishable key 각각 정상·거부 경계를 다시 probe한다.

### 7. canary

출시 전 `coming_soon` 배포는 exact SHA를 지정한 전용 canary를 먼저 통과해야 한다. 이 검사는 공개 allowlist, 로그인·앱 리다이렉트, UTM 정리, 일반 API 503, signed-app association 200, health deployment SHA를 함께 확인한다.

```powershell
node ./scripts/live-smoke-test.mjs --base-url=https://hanbang.ai --launch-mode=coming_soon --research-intake=closed --account-deletion-cron=closed --expected-sha=<40-char-sha> --apple-team-id=<signed-team-id> --play-signing-sha256=<play-app-signing-sha256>
```

Apple/Play 서명 식별자가 없어 association 경로가 503이면 실패가 정상이며 운영 공개를 진행하지 않는다.
이 자동 canary는 개인정보 행을 만들지 않는다. 실제 `/api/preregister`·Turnstile·Resend 전달·2시간 서명 fragment 링크·주소창 fragment 즉시 제거·사람의 명시적 버튼 클릭 전 GET 무변경·same-origin POST·token-free 결과 URL·`email_verified_at` 전이·재발송·테스트 행 삭제는 운영자가 소유한 전용 이메일, 테스트 행 보유·삭제 승인, DB 확인·정리 증거를 같은 SHA에 별도로 남겨야 한다. Vercel/CDN 요청 로그에 capability가 없고 Resend가 링크를 tracking URL로 재작성하지 않았다는 증거도 함께 남긴다. 그 증거가 없으면 사용자 연구 접수도 GO로 판정하지 않는다.

최소 10분 동안 다음을 반복 확인한다.

- `/wedding`, 로그인, WeddingCode, 커플 재연결
- Amora Luna 일반 응답과 Terra 승격, replay/idempotency, 비용 원장
- 예약·예산·일정 저장, 권한 없는 DB/Storage 접근 거부
- 계정 삭제 queue/cron, 5xx, console error, latency, OpenAI 비용
- 최신 모바일과 마지막 배포 모바일의 핵심 여정

데이터 손실·권한 우회·비밀 노출·결제/삭제 오작동·사이트 전체 장애 같은 critical은 한 번만 관측돼도 즉시 maintenance와 write fence를 다시 켜고 아래 rollback matrix를 따른다. 네트워크 순간 오류나 latency처럼 변동성이 큰 high 신호만 사전에 정한 횟수·시간창 기준으로 재확인한다.

## rollback matrix

| 시점 | 조치 | 금지 |
|---|---|---|
| DB push 전 | fence를 원상복구하고 사전에 canary한 launch-gate rollback anchor로 되돌린 뒤 공개 경계를 재확인 | 과거 gate 없는 deployment로 Instant Rollback, migration history 변경 |
| baseline history만 reconcile 후 | catalog는 바뀌지 않았으므로 원인을 조사하고 release 중단. history를 임의 삭제하지 않음 | `migration repair`로 숨기기 |
| DB push 중/직후, 앱 미검증 | maintenance와 fence 유지, 현재 DB·Storage 증거 보존, 승인된 recovery point로 restore 또는 새 프로젝트 복구 | Vercel 롤백만 하고 서비스 재개 |
| 새 웹 공개 후 | 새 DB의 중앙 account-deletion completion과 expand schema에 호환되고 launch gate를 포함한다고 canary한 anchor에만 rollback. 그 외에는 maintenance 호환 hotfix를 새로 배포 | 과거 gate 없는 deployment로 Instant Rollback, 환경변수도 자동 복구됐다고 가정 |
| 모바일 rollout 후 | Store rollout 중지/단계 배포 중단. 서버에서 최소 지원 버전을 올리는 결정은 별도 승인 | 이미 설치된 binary를 원격 삭제할 수 있다고 가정 |

Vercel Instant Rollback은 코드 deployment를 바꾸지만 DB나 이후 변경된 환경 변수를 되돌리지 않는다. 현재 gate 없는 과거 production deployment는 명시적으로 **rollback 금지**다. 공식 기준: [Vercel Instant Rollback](https://vercel.com/docs/instant-rollback), [Vercel CLI rollback](https://vercel.com/docs/cli/rollback)

EAS production binary는 `production` update channel에 고정한다. 다만 실제 OTA publish·rollback rehearsal 전에는 이를 검증된 복구 경로로 간주하지 않는다. signed build와 store submit을 분리하고, build artifact·signing certificate·store rollout 상태를 release evidence에 남긴다.

## 복구 실행 전 최종 승인

in-place physical/PITR restore는 운영 DB를 선택한 과거 시점으로 되돌리고 downtime과 데이터 손실을 만들 수 있는 파괴적 작업이다. 다음을 한 화면에 모아 책임자가 승인한 뒤에만 실행한다.

- 장애 시작·마지막 정상 쓰기·migration 시작 UTC
- 선택한 recovery target과 예상 RPO
- DB/Storage에서 잃게 될 쓰기 범위
- 현재 DB와 Storage forensic export 위치
- 예상 RTO와 사용자 공지
- restore 뒤 사용할 Vercel deployment와 환경 변수 snapshot

restore 완료는 서비스 완료가 아니다. exact DB contract, Storage inventory, 인증, 사용자 여정, canary를 다시 통과해야 한다.

## release evidence 템플릿

```text
PR / reviewed SHA:
Vercel maintenance deployment / normal deployment:
Launch-gate rollback anchor deployment / canary:
Supabase ref / Postgres version:
Write-fence method and black-box probe results:
Drain completed UTC:
Backup or PITR recovery target:
Restore rehearsal project / RPO / RTO:
Storage inventory/export:
Baseline reconcile result:
Pending migrations and rewrite/delete inventory approval:
Post-deploy contract:
Web canary:
Latest and previous mobile binary canary:
Research selection owner / criteria / decision deadline / notification SLA:
Rollback owner and decision deadline:
```
