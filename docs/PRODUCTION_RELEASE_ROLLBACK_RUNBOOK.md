# 운영 출시·롤백 runbook

이 문서는 `hanbang.ai`, 운영 Supabase, EAS 모바일 빌드를 함께 출시할 때의 실행 기준이다. GitHub CI나 Vercel 빌드가 초록색이라는 이유만으로 운영 준비가 끝났다고 판단하지 않는다.

## 불변 규칙

- 운영 Supabase ref는 `scripts/release-targets.json`의 보호 목록과 실행 인수가 모두 같아야 한다.
- `productionDatabaseWriteFence`는 실제 웹·모바일의 DB/Storage 직접 쓰기 차단을 자동 probe로 입증하기 전에는 `not_configured`를 유지한다. 형식적으로 `verified-v1`로 바꾸지 않는다.
- 운영에서는 원시 `supabase db push`, `migration repair`, `db reset --linked`, `--include-all`, SQL Editor 수동 이어붙이기를 사용하지 않는다.
- backup/restore와 Storage 객체 복구를 각각 검증한다. Supabase DB backup은 Storage 실제 객체를 포함하지 않는다.
- DB 변경 전부터 최종 canary가 끝날 때까지 정확한 Git SHA, Vercel deployment, migration 목록, backup/recovery point가 바뀌지 않아야 한다.
- 사용자 데이터의 삭제·가명화·소유권 변경은 수량만 맞는다고 자동 승인하지 않는다. 제품·개인정보 책임자의 명시적 결정을 release evidence에 남긴다.

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

## 정상 출시 순서

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
- 32자 이상 `RATE_LIMIT_KEY_SECRET`

다음을 확인한다.

```text
GET https://hanbang.ai/api/health/maintenance
maintenance = true
supabaseProjectRef = protected production ref
deployment = reviewed SHA first 12 chars
rateLimitKeySecretConfigured = true
```

페이지와 일반 API는 503이어야 한다. health endpoint가 404이거나 SHA가 다르면 중단한다.

### 3. 직접 쓰기 fence와 drain

웹 503만으로는 fence가 아니다. 배포된 모바일은 Supabase에 직접 쓸 수 있다. Data API, Auth가 만드는 DB 쓰기, Storage upload/update/delete를 모두 차단하고 다음을 자동 probe한다.

- 배포된 legacy anon key 요청 거부
- 배포된 publishable key 요청 거부
- 새 로그인·토큰 갱신·DB INSERT/RPC·Storage upload 거부
- release 전용 DB 연결만 허용
- 활성 사용자 transaction 0

현재 저장소가 이 자동 gate를 구현하지 않았다면 여기서 중단한다. API key 비활성화만 사용할 경우 release tooling의 Storage 접근과 장애 시 key 재활성화를 먼저 별도 환경에서 연습해야 한다.

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

공식 기준: [Supabase Database Backups](https://supabase.com/docs/guides/platform/backups), [CLI backup/restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)

### 5. migration

core baseline history 누락이면서 exact catalog gate가 통과한 경우에만 먼저 전용 reconcile을 수행한다.

```powershell
pnpm run supabase:baseline:core -ExpectedProjectRef <production-ref>
```

그 뒤 dry-run이 검토한 pending suffix와 정확히 같을 때만 guarded ship을 실행한다.

```powershell
pnpm run supabase:ship:safe `
  -ExpectedProjectRef <production-ref> `
  -BackupRef <verified-backup-id> `
  -MaintenanceModeActive `
  -TrafficDrained `
  -MaintenanceAuthorizedUntilUtc <UTC-within-30m>
```

스크립트가 요구하는 `ACK_REWRITES`, drain, apply 확인은 실제 inventory와 책임자 승인 기록이 있을 때만 입력한다. 실패 후 수동 SQL로 이어서 적용하지 않는다.

### 6. 앱 배포와 fence 해제

post-deploy DB contract, migration dry-run 0개, Storage retirement, anon denial probe를 먼저 통과한다. 그 뒤 같은 SHA의 일반 production deployment를 만들고 `MAINTENANCE_MODE=false`로 전환한다. 공개 key를 재활성화했다면 legacy와 publishable key 각각 정상·거부 경계를 다시 probe한다.

### 7. canary

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
| DB push 전 | fence를 원상복구하고 이전 정상 Vercel deployment로 되돌린 뒤 maintenance 해제 | migration history 변경 |
| baseline history만 reconcile 후 | catalog는 바뀌지 않았으므로 원인을 조사하고 release 중단. history를 임의 삭제하지 않음 | `migration repair`로 숨기기 |
| DB push 중/직후, 앱 미검증 | maintenance와 fence 유지, 현재 DB·Storage 증거 보존, 승인된 recovery point로 restore 또는 새 프로젝트 복구 | Vercel 롤백만 하고 서비스 재개 |
| 새 웹 공개 후 | 이전 웹이 새 expand schema와 호환된다는 증거가 있을 때만 Vercel Instant Rollback. 아니면 maintenance 후 DB 복구 | 환경변수도 자동 복구됐다고 가정 |
| 모바일 rollout 후 | Store rollout 중지/단계 배포 중단. 서버에서 최소 지원 버전을 올리는 결정은 별도 승인 | 이미 설치된 binary를 원격 삭제할 수 있다고 가정 |

Vercel Instant Rollback은 코드 deployment를 바꾸지만 DB나 이후 변경된 환경 변수를 되돌리지 않는다. 공식 기준: [Vercel Instant Rollback](https://vercel.com/docs/instant-rollback), [Vercel CLI rollback](https://vercel.com/docs/cli/rollback)

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
Rollback owner and decision deadline:
```
