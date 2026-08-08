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

## 관련 기록

- 신원 판정 3차: `VENDOR_IDENTITY_REVIEW_2026-08-05.md`
- 업체 병합 판정: `VENDOR_MERGE_REVIEW_2026-07-27.md`
- 공시 수용·배포 게이트: `VENDOR_DISCLOSURE_ACCEPTANCE_MATRIX_2026-07-18.md`
- 호스티드 스테이징 프로브: `VENDOR_DISCLOSURE_HOSTED_STAGING_RLS_PROBE.md`
