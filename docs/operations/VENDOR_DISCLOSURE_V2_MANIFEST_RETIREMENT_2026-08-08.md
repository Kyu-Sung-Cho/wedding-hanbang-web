# vendor-disclosure-v2 릴리스 매니페스트 은퇴 (2026-08-08)

`supabase/release-manifests/vendor-disclosure-v2-20260718.json`이 계획한 릴리스는
**이미 끝났다.** 2026-07-23에 컨트롤러를 거치지 않는 경로로 적용됐고, 매니페스트만
그 사실을 모른 채 "배포 대기"로 남아 있었다.

이 문서는 그 상태를 기록으로 닫는다. **파일은 지우지 않는다** — 지우면 안 되는
이유가 아래에 있다.

## 실측 (2026-08-08, 운영 읽기 전용 조회)

```
매니페스트 requiredRemoteHead : 20260716117000   ← 릴리스 "전"이어야 할 상태
운영 원장 head                : 20260727090000   ← 매니페스트의 마지막 마이그레이션
expand 32건 중 운영 적용분     : 32 / 32
아직 안 들어간 것              : 없음
```

재현:

```bash
node -e "const m=require('./supabase/release-manifests/vendor-disclosure-v2-20260718.json');console.log(m.requiredRemoteHead, m.expandMigrations.length)"
# 운영 원장(읽기 전용): POST https://api.supabase.com/v1/projects/slrtobkksjmxgzatjyqb/database/query
#   { "query": "select max(version) from supabase_migrations.schema_migrations", "read_only": true }
```

적용 흔적: `work/prod-migration-log.txt` (2026-07-23T02:41–02:43Z, 마이그레이션 59개),
`work/prod-copy-log.txt` (같은 날 02:45–03:04Z, 데이터 복사). 실행 주체는
`work/scripts/apply-prod-migrations.mjs`·`copy-to-prod.mjs`로, 둘 다 git 미추적
임시 스크립트이며 Management API로 컨트롤러를 우회했다.

## ⚠️ 매니페스트 파일을 지우지 마라

`assertSuccessorReleaseNotBlocked`는 **파일이 없으면 그냥 통과한다.**

```js
// scripts/lib/supabase-production-release-controller.mjs:80-82
function assertSuccessorReleaseNotBlocked(repoRoot) {
  const path = join(repoRoot, SUCCESSOR_RELEASE_MANIFEST_RELATIVE_PATH);
  if (!existsSync(path)) return;   // ← 여기
```

즉 "안 쓰는 파일이니 정리하자"고 지우는 순간 **운영 릴리스 차단이 조용히 풀린다.**
매니페스트는 지금 상태 그대로 남아 있어야 그 차단이 유지된다.

## status도 바꾸지 마라

계약이 허용하는 값은 둘뿐이다.

```js
// scripts/lib/supabase-successor-release-contract.mjs:47-48
const BLOCKED_STATUS = "deployment_blocked";
const PINNED_STATUS  = "evidence_pinned";
```

`"retired"` 같은 값을 넣으면 `SUCCESSOR_STATUS_INVALID`로 계약이 깨지고,
그러면 컨트롤러는 `SUCCESSOR_RELEASE_CONTRACT_INVALID`로 막는다(막히는 건 맞지만
이유가 거짓이 된다 — 계약이 깨진 게 아니라 릴리스가 끝난 것이다).

`evidence_pinned`로 올리는 것도 틀렸다. 증거 5종을 다 모아도 `requiredRemoteHead`
(20260716117000)와 실제 운영 head(20260727090000)가 어긋나 원장 검사에서 거부된다.
**이미 지나간 릴리스를 위한 증거를 모으는 셈이다.**

## 그래서 은퇴는 이 문서로만 한다

| 항목 | 조치 |
|---|---|
| 매니페스트 파일 | **그대로 둔다** (`deployment_blocked` 유지) |
| 컨트롤러 | **그대로 둔다** — 실제로 돌면 안 되므로 차단이 정확하다 |
| CI `Production Readiness` | 그대로 빨간불 (설계상 영구 실패, main도 동일) |
| 이 릴리스의 상태 | 이 문서로 "적용 완료(우회 경로)"로 기록 |

`deployment_blocked`는 지금 **정확한 상태**다. 이 컨트롤러가 이 매니페스트를 대상으로
돌면 안 되기 때문이다. 바뀐 것은 "아직 배포 안 됨"이 아니라 "다른 경로로 이미 배포됨"
이라는 사실뿐이고, 그건 코드가 아니라 기록의 문제다.

## HWP 등 데이터 적재는 이 매니페스트와 무관하다

`work/scripts/copy-to-prod.mjs`에는 릴리스 매니페스트 참조가 **0건**이다(grep 확인).
스테이징 → 운영 데이터 복사는 이 마이그레이션 릴리스 경로를 타지 않는다.

따라서 **매니페스트를 은퇴시켜도 HWP 7건 적재가 열리지 않는다.** 둘은 별개 문제다.
데이터 적재의 정식 경로는 아직 정해지지 않았고, 2026-07-23에 쓴 방법은 현재
`CLAUDE.md`가 금지하는 Management API 직접 write다.

## 다음 라운드에 정식 경로를 쓰려면

증거 5종(`backup`·`finalizer`·`hostedRestore`·`hostedStaging`·`storage`) 자동화
가능 범위를 조사한 결과(2026-08-08):

| 증거 | 판정 | 막히는 지점 |
|---|---|---|
| hostedStaging | 설정하면 자동 | 스테이징 픽스처 수동 심기 + `RLS_PROBE_*` 21개 키(현재 0개) |
| storage | 설정하면 자동 | 쓰기 없음. 3단계 × 총 135분 대기 |
| backup | 설정하면 자동 | 후속용 백업 계약이 저장소에 없음 — 신규 작성 |
| hostedRestore | **사람 필수** | 일회용 Supabase 프로젝트 생성(과금) + 콘솔 물리 복원 |
| finalizer | **정의 없음** | 순환 — 릴리스 종결 산출물인데 그 릴리스가 이 증거를 먼저 요구 |

공통 함정 셋:

1. **영수증 생산자 전원이 저장소 밖에만 쓴다**(`RECEIPT_DESTINATION_UNSAFE`).
   계약은 증거가 `docs/operations/evidence/` 안에 있어야 한다고 요구한다.
   잇는 코드가 저장소에 0건 — 사람이 읽고 옮기게 만든 의도된 설계로 읽힌다.
2. **sha256이 파일 바이트 해시가 아니다.** 계약이 CRLF를 LF로 바꾼 뒤 해시한다
   (`contract:70-74`). `Get-FileHash`/`sha256sum` 값을 그대로 쓰면 `PIN_HASH_MISMATCH`.
   ```bash
   node -e "const{createHash}=require('crypto'),fs=require('fs');console.log(createHash('sha256').update(fs.readFileSync(process.argv[1],'utf8').replace(/\r\n?/g,'\n'),'utf8').digest('hex'))" <file>
   ```
3. **부분 고정 불가.** 5종이 같은 `releaseCommit`에 묶여야 해서
   (`DEPLOYMENT_EVIDENCE_COMMIT_DRIFT`) 증거 수집 기간 내내 커밋·마이그레이션 동결이
   필요하다.

그리고 증거를 다 채워도 컨트롤러가 `SUCCESSOR_RELEASE_CONTROLLER_NOT_IMPLEMENTED`로
막는다. 본체 배선 규모는 신규 컨트롤러 900~1,500줄 + 테스트 800~1,500줄로 추정된다
(선임 amora 본체가 2,863줄 + 테스트 2,843줄이었다).

## 판단 — 이 경로를 지금 열지 않는다

비용 문제이기 전에 **제품 방향 문제**다.
`docs/MVP_PRODUCT_DIRECTION_2026-07-30.md`(`AUTHORITATIVE MVP DIRECTION`) §6이
전면에서 내릴 범위에 `업체 탐색`과 `공시가격을 독립 제품처럼 소개하는 구성`을 넣고,
이어서 못 박는다:

> 공시가격과 견적 체크는 아모라 또는 커뮤니티에서 근거가 필요한 순간에 사용하는
> 보조 기능으로 유지할 수 있다. **별도 성장 축으로 확장하지 않는다.**

이 기준에서 둘을 갈라야 한다.

- **공시 데이터의 결함 수리는 계속 한다.** 보조 기능이라도 틀린 값을 보여주면
  안 된다. 이 제품의 신뢰 주장 자체가 "판정하지 않고 사실만"이라 더 그렇다.
  (2026-08-07~08에 고친 것: 예식장 패키지가 스드메 최저가를 ×0.20으로 만들던 것,
  `베로나지디_예식장` 같은 파일명 잔재 21곳, 사본 중복 1건, 첫 화면 412→406.)
- **공급 확대는 하지 않는다.** HWP 7건(예식장 189→193, 약 2%)은 그 자체로는
  "별도 성장 축 확장"에 해당한다. 그걸 위해 봉인된 운영 쓰기 경로와 컨트롤러
  본체를 새로 만드는 것은 방향에도, 비용에도 맞지 않는다.

새 릴리스가 **다른 이유로 실제 필요해질 때** 위 증거 표를 출발점으로 삼는다.
그때까지 HWP 산출물은 파이프라인에서 재생성 가능하다
(`corepack pnpm ingest scan|convert|extract|validate --state-dir <name>`,
자동 변환 7건 · 시각 판독 1건 · 비용 $0).

## 마이그레이션 세트 드리프트 (2026-08-11 실측)

> **2026-08-11 정정.** 이 절의 초판은 세 군데가 틀렸다. 실제로 막고 있던 것은
> 후속 매니페스트에서 **3건**이 빠진 것이었고(83건이 아니다), **CI는 그것을 보고
> 있었으며**(안 본다고 썼다), 그래서 "그대로 둔다"는 판단도 뒤집혔다. 아래는 고친
> 내용이고, 틀렸던 서술은 무엇이 왜 틀렸는지와 함께 남긴다.

### `MIGRATION_SET_DRIFT`는 두 곳에서 난다 — 초판이 둘을 섞었다

| 검사 | 코드 | 무엇을 대조하나 | 누가 실행하나 |
|---|---|---|---|
| **후속 계약** | `scripts/lib/supabase-successor-release-contract.mjs:1157` | `vendor-disclosure-v2-20260718.json`의 `expandMigrations` ↔ floor(20260718120000) 이상 실제 파일 | `pnpm supabase:release:fence` → **CI의 `Static Release Contracts` 잡**, 프로덕션 빌드 펜스 |
| 주 컨트롤러 | `scripts/lib/supabase-production-release-controller.mjs:848` | `amora-engine-v2-20260716.json`의 27건 ↔ floor(20260716090000) 이상 실제 파일 | `scripts/supabase-production-release.mjs`(**봉인된 apply 경로**)와 그 테스트뿐 |

초판이 적은 "83건"은 아래쪽, 즉 **봉인돼서 실행되지 않는 경로**의 숫자다. fence는
주 매니페스트의 파일 집합을 대조하지 않는다(실행 로그: `Static release manifest
verified (27 migrations; ...)`). 그러니 그 83건은 CI 빨간불과 무관했다.

### 실제로 막고 있던 것 — 후속 매니페스트에서 3건 누락

```
매니페스트 migrationFloor    : 20260718120000
매니페스트 expandMigrations   : 80건 (마지막 20260804200000)
floor 이상 실제 파일          : 83건
빠진 것                      : 3건
```

| 마이그레이션 | 도입 커밋 | 날짜 |
|---|---|---|
| `20260805120000_amora_log_wedding_event_couple_approval.sql` | `da71d5cc` | 2026-08-05 |
| `20260806090000_amora_preparation_status.sql` | `a49216bd` | 2026-08-06 |
| `20260807090000_amora_mediation_send_gate.sql` | `28e33a43` | 2026-08-07 |

이 저장소는 **마이그레이션을 추가하면 후속 매니페스트에도 같이 넣는 것이 관행**이다.
이 파일의 변경 이력 12건이 전부 그렇게 하고 있다. 2026-08-10 통합 병합이 48건은
넣고 마지막 3건을 빠뜨렸다. 초판이 이것을 "3주 동안 쌓인 구조적 상태"로 읽은 것은
주 매니페스트 쪽 숫자를 본 탓이다.

### 위험을 여는 게 아니라, 테스트 5건을 죽였다

fence는 fail-closed다. 드리프트는 운영 쓰기 경로를 여는 게 아니라 더 세게 닫는다.
실제 손해는 다른 곳에 있다.

`scripts/tests/successor-release-evidence-contract.test.mjs` (2026-08-11 실측):

```
tests 14 / pass 9 / fail 5
```

5건 모두 원인이 같다. 컨트롤러가 각 테스트가 확인하려던 지점에 **도달하기 전에**
`MIGRATION_SET_DRIFT`로 먼저 끝난다.

```
actual:   'MIGRATION_SET_DRIFT'
expected: 'SUCCESSOR_CONTROLLER_CONTRACT_INVALID'
```

죽어 있는 5건:

1. 차단 상태 매니페스트는 지금까지처럼 그대로 통과하고 차단으로 판정된다
2. controller_ready는 현재 remote baseline, exact migration set, postcheck와
   feature-off rollback을 함께 고정한다
3. successor 또는 account-deletion table을 self-consistent backup list에서 빼도 차단한다
4. 이전 14-table backup 또는 27-table post-expand/finalizer 계약 재사용은 차단한다
5. postcheck 또는 feature-off rollback 계약을 약화하면 controller_ready가 되지 않는다

이 문서 위쪽의 "⚠️ 매니페스트 파일을 지우지 마라", "status도 바꾸지 마라"를 지켜주던
회귀 테스트가 그 5건이다. 이 상태에서는 누가 후속 계약을 약화시켜도 이 테스트들이
여전히 같은 이유로 실패할 뿐, 약화 자체를 잡지 못했다.
(**아래 "고쳤다"에서 14/14로 복구됐다.**)

같은 날 나머지 릴리스 테스트는 정상이었다.

```
supabase-release-fence              pass 16 / fail 0
supabase-production-release         pass 55 / fail 0
ci-signal-integrity                 pass  5 / fail 0
disclosure-round-pin                pass  3 / fail 0
```

### CI는 보고 있었다

초판은 "어떤 게이트도 이걸 보지 않는다"고 적었다. **사실이 아니다.** CI의
`Static Release Contracts (Non-Deploy)` 잡이 `pnpm supabase:release:fence`를 돌리고,
그게 정확히 이 드리프트로 실패하고 있었다.

```
2026-08-11T00:31:10Z  $ node ./scripts/supabase-release-fence.mjs
  SUPABASE_RELEASE_FENCE_BLOCKED: MIGRATION_SET_DRIFT: successor migration set
  or order drifted; expected=…20260804200000_community_post_service_write_boundary.sql;
  received=…20260805120000…,20260806090000…,20260807090000…
  [ELIFECYCLE] Command failed with exit code 1.
```

**왜 안 보였나.** 2026-08-10 통합 병합 이후의 CI run은 전부 결제 문제로 잡이 2~3초
만에 죽어 로그가 없었다. 초록불이 아니라 "원인 없는 빨간불"이었고, 그걸 결제 문제로만
읽었다.

```
08-08 02:32  Static Release Contracts  success  82초   ← 정상
08-08 14:49  Static Release Contracts  failure   2초   ← 결제로 즉사(로그 없음)
   …            (전부 2초 즉사)
08-11 00:31  Static Release Contracts  failure  55초   ← Pro 전환 뒤 첫 실측, 원인 노출
```

다만 초판의 다음 부분은 여전히 사실이다 — `successor-release-evidence-contract.test.mjs`
자체는 `test:repo`에만 있고 CI·`qa:local`·pre-push 어디서도 돌지 않는다. 이번에는
fence가 대신 잡아 줬을 뿐이다.

| 게이트 | 실제로 도는 것 | fence를 보나 | 그 테스트 5건을 보나 |
|---|---|---|---|
| GitHub Actions CI | `test:ingest` + **`supabase:release:fence`**(Static Release Contracts) | ✓ | ✗ |
| `corepack pnpm qa:local` | `scripts/verify-local.mjs` — web·mobile·shared·design-tokens | ✗ | ✗ |
| pre-push 훅 | `turbo run typecheck lint test` (`.githooks/pre-push`) | ✗ | ✗ |
| `pnpm test:repo` · `pnpm test` · `pnpm supabase:release:test` | 위 파일 포함 | — | ✓ |

### 고쳤다 (2026-08-11, `85c4d7db`)

초판의 "그대로 둔다"는 판단은 "CI가 이걸 안 본다"는 잘못된 전제 위에 있었다. 전제가
무너졌으니 판단도 뒤집는다. 빠진 3건을 후속 매니페스트에 넣었다. **`status`는
`deployment_blocked` 그대로이고 항목 추가뿐이다** — 위 "status도 바꾸지 마라"는
그대로 유효하다.

수정 후 실측:

```
pnpm supabase:release:fence          EXIT 0
  Successor release manifest verified (vendor-disclosure-v2-20260718;
  deployment_blocked; 83 migrations; predecessor head 20260716117000)
successor-release-evidence-contract  14 / 14 통과
pnpm test:repo                       실패 0건
```

죽어 있던 5건이 전부 살아났다 — **드리프트에 가려져 있던 진짜 결함은 없었다.**

### ⚠️ 이 파일을 고치면 배포 서명도 다시 핀해야 한다

`VENDOR_DISCLOSURE_PRODUCTION_AUTHORIZATION`은 **이 매니페스트 파일의 sha256**이다
(`apps/web/vendorDisclosureProductionBuildFence.ts:23-31`, CRLF→LF 정규화 후 해시).
값이 어긋나면 프로덕션 빌드가 `..._AUTHORIZATION_INVALID`로 막힌다.

```
ad31d482 (마지막 성공 배포, 08-08 12:04)  3f5ead951bf404f6ebdd4c003f363d5bc89e8b177eefd9c651717f0704064de4
7f437003 (첫 실패, 08-08 14:39)           bb3428d44432dc524af9d37fd00589153a6c6013c899575e83cbb099e9521c1c
85c4d7db (이번 수정)                       9889c6d1955e87b6b15b6fc11cf212f85bdd8b93d5ba83494d24f9eb4be34f91
```

핀은 이번 수정이 아니라 **`7f437003`에서 이미 어긋나 있었다.** 운영 배포를 다시 열 때
Vercel Production 환경변수를 맨 아래 값으로 갱신해야 한다.

### 주 매니페스트 쪽 27 vs 110은 그대로 둔다

봉인된 apply 경로에서만 평가되고 fence·CI 어디서도 실행되지 않는다. 정식 경로를 열
때 증거 5종보다 먼저 처리하면 된다. 그때 `amora-engine-v2-20260716.json`의
`expandMigrations`를 그 시점의 release-era 전체로 다시 만들고, sha256은 위
"공통 함정 2"와 같은 CRLF→LF 정규화 해시로 계산한다.

그리고 CI가 `test:repo`를 돌게 하거나, 최소한 `supabase:release:test`를 릴리스 전
필수 단계로 못 박는다. 지금은 fence가 우연히 겹쳐서 잡아 줬을 뿐이다.

## 관련 기록

- 신원 판정 3차: `VENDOR_IDENTITY_REVIEW_2026-08-05.md`
- 업체 병합 판정: `VENDOR_MERGE_REVIEW_2026-07-27.md`
- 공시 수용·배포 게이트: `VENDOR_DISCLOSURE_ACCEPTANCE_MATRIX_2026-07-18.md`
- 호스티드 스테이징 프로브: `VENDOR_DISCLOSURE_HOSTED_STAGING_RLS_PROBE.md`
