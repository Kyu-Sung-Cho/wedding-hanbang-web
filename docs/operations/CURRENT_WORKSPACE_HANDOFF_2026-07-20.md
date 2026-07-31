# 현재 작업 인계 — 2026-07-21

> 상태: `SUPERSEDED HISTORICAL HANDOFF`
>
> 이 문서는 2026-07-21 업체 공시 기능 브랜치의 작업 기록이다. 현재 브랜치·제품
> 범위·미완료 운영 게이트를 판단할 때 사용하지 않는다. 현재 기준은 `AGENTS.md`,
> `docs/MVP_PRODUCT_DIRECTION_2026-07-30.md`,
> `docs/operations/FULL_WORKSPACE_RELEASE_HANDOFF_2026-07-31.md`다. 2026-07-30
> 신뢰 패치의 계보는
> `docs/operations/CTO_TRUST_AND_WEDDINGCODE_HANDOFF_2026-07-30.md`에 남아 있다.

## 기준

- repository: `Kyu-Sung-Cho/wedding-hanbang-web`
- branch: `feat/vendor-disclosure-pipeline-v2-20260718`
- Draft PR: [#64](https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/pull/64)
- 이번 변경 전 기준 commit: `75ce63568d5f47778757785e2a19067feeeecd5b`
- 다른 컴퓨터에서는 이 문서의 과거 SHA가 아니라 위 branch의 최신 원격 HEAD를 사용한다.
- raw 원본, canonical `.state`, 변환물, 후보/영수증, 비용 ledger와 비밀값은 Git에 넣지
  않는다. 코드·테스트·운영 계약만 Git으로 공유한다.

## 2026-07-21에 구현한 것

1. 업체 공시 기본 추출 명령을 `local-deterministic-v1` 전용으로 바꿨다. 입력·출력 token,
   시도 횟수와 비용은 항상 0이며 결과는 `pending`, `needs_review=true`,
   `bulk_approval_eligible=false`다.
2. production `extractManifest`는 `paid_openai_extraction_hard_disabled`로 무조건 중단한다.
   `--plan`, `--paid-openai`, `--approved-plan-sha256`의 분리형과 `=`형도 CLI에서 차단한다.
3. ordinary `ingest extract` 정적 import graph에서 `extract.ts`, 후보 모듈과 `openai` 패키지를
   제거했다. OpenAI response format 생성은 provider 전용 모듈로 격리했다.
4. 로컬 parser v8은 반복 금액의 occurrence 단위 coverage, 업체별 정책 표 연결, 약관 문맥
   상속, 계약금 분류와 정확한 source quote 결속을 보강했다. 첫 업체 행을 다른 업체의
   카테고리 근거로 재사용하던 교차 업체 증거 오염도 제거했다.
5. 과거 `production_paid` cache를 덮어쓰지 않고 비교하는
   `extract local-candidates` 명령을 추가했다. 원본·변환물·request/checkpoint/ledger·
   finalization을 전부 replay한 뒤 별도 content-addressed 후보/영수증만 만든다.
6. 후보 영수증은 로컬 validation 오류, coverage gaps, JSON pointer별 유료/로컬 값 hash와
   제한된 preview, 형식·이미지 hard hold를 기록한다. 후보 채택·병합·DB 적재 경로는
   의도적으로 없다.
7. `/wedding/vendors?preview=1`과 상세에 관리자 전용 pending 미리보기를 추가했다. 관리자
   확인 전 service client를 만들지 않고, preview 요청만 `noStore()` 처리한다. private
   source quote·Storage key·로컬 경로는 클라이언트 DTO에 포함하지 않는다.
8. 같은 대행사의 복수 가격을 한 건으로 덮어쓰던 카드 `Map`을 복수 offer 배열로 바꿨다.
9. 관리자 가격 검수 화면에 count-first `자동 검증 통과분 일괄 승인` UI/API 계약을
   추가했다. 현재 DB에는 불변 validation provenance가 없으므로 대상 0건, POST 409로
   fail-closed한다. 직접 UPDATE나 RPC 실행은 0건이다.
10. Git 추적 파일에 실제 `.env`, `data/raw`, ingest `.state`·cache·validated·manifest가
    들어오면 `test:ingest`가 실패하는 저장소 안전 게이트를 추가했다.
11. active local 결과와 v8/schema-v2 candidate를 고정 8건 ground truth에 직접 대조하는
    `score --candidate-source local`을 추가했다. 원본·변환물·유료 cache·engine·validator
    provenance가 하나라도 다르면 차단하고, 결과는 paid score와 분리된 review-only 경로에
    쓴다.
12. 관리자 preview에서는 찜·조합·저장·아모라 CTA뿐 아니라 내부 `/api/events`, PostHog
    pageview/autocapture와 UTM 저장도 차단했다. 검수 전·정확성 미보장 문구를 목록과 상세에
    명시했고 기본 카드는 실제 제안이 있는 대행사 열만 렌더한다.

## canonical 실데이터 확인

- 원본: `253 files / 249 units`
- 변환 가능: `241 units`; 사람 변환 대기 HWP: `8 units`
- 과거 `production_paid` cache: `225/225` upstream·ledger·finalization replay 통과
- 현재 strict validator 결과: 과거 유료 225개 전부 record-scope 근거 오류로 `error`
- 현재 로컬 active 결과: `15 validated / 1 error`, hard error `6`, coverage gap `43`
  occurrences. 실패 단위는 `마리아쥬제이`이며 명시적 카테고리 근거가 없는 행을 보수적으로
  차단한 결과다.
- 로컬 active dry-run: `15 units`, raw object `17`, official prices `1,101`, agency packages
  `5`, dedupe candidates `888`
- 위 dry-run의 가격 1,101건과 package 5건은 전부 `pending + needs_review`; DB write는 0건

과거 유료 225개에는 로컬 sidecar 후보와 영수증을 전부 생성했다.

- 첫 실행: `225 processed / 0 failed / 1 cache hit`
- 동일 재실행: `225 processed / 225 cache hits / 0 failed`
- 신규 token·비용: `0 / $0`
- hard error 보유: `36 units / 469 errors`
- coverage gap 보유: `53 units / 705 occurrences`
- image evidence hold: `76 units`
- non-XLSX hold: `24 units` (`PDF 20 / DOCX 3 / PNG 1`)
- 유료/로컬 exact representation match: `0/225`
- trust metadata 제외 semantic representation match: `0/225`
- exact field differences `34,477`; 이 중 trust metadata `9,469`, semantic differences
  `25,008` (`identity/linkage 808 / pricing 18,535 / other 5,665`)
- all-local 241 doc kinds: `agency 13 / partner list 37 / hall 190 / mixed 1`
- dedupe 전 로컬 업체 미리보기: `1,066`개
  (`studio 386 / dress 254 / makeup 173 / hall 253`)

최종 canonical seal:

- manifest SHA-256:
  `ccb067794fd6fe1236e4bfd5109442bc26b3c1f3ee99e0219b6ab4ab811058e1`
- append-only AI ledger SHA-256:
  `f491378cf288364e4651db8e714a5e92442ab84beb53a7256aa03ee9625996e2`
- paid cache aggregate(동일 알고리즘 전후 비교):
  `701ed0909018154bb16930a082d5d889a34123d0d86aa0cc4cd66fb90ef89f04`
- current validation artifact aggregate SHA-256:
  `71537441998feb1481c418ae0767d1c039a2af714f0d3127c8c1dd8525be18ac`
- v8 candidate/receipt aggregate SHA-256:
  `ab73c985ba547a31d7cad346815e9135d82d4f787edcf7f62925946a2a26db96`

v8/schema-v2 candidate 생성 전후 paid cache aggregate, AI ledger SHA·1,837,587 bytes·
1,560 rows·mtime가 모두 동일했다. manifest 변경은 active 16개를 v8로 재추출·검증한
결과이며 candidate 명령과 local score 명령은 manifest를 바꾸지 않았다.

고정 8건 local ground-truth 채점은 `8/8 fail`, 25건 배치 가능 `false`다. 합계는 지어낸
발생 `14`, 판독 가능 누락 `67`, unsupported structured amount `6`, 연결 오류 `1`,
validator 차단 이슈 `3`, actual coverage gap `29`다. 메이브라이드는 non-blocking으로
분리했지만 나머지 7건도 모두 기준 미달이므로 staging 배치를 시작하지 않았다.

과거 ledger에는 입력 10,426,591 token, 출력 3,737,302 token, 보수적 누적 추정 비용
`$43.867371`이 남아 있다. 이것은 이번 무과금 실행 비용이 아니며 감사 이력이므로 삭제하거나
0으로 다시 쓰지 않는다.

## 이번 검증

- ingest: `542 total / 541 pass / 0 fail / 1 Windows file-symlink EPERM skip`
- ingest TypeScript: PASS
- web: `311 files / 2,620 tests PASS`
- web TypeScript: PASS
- web ESLint: PASS
- 전체 workspace TypeScript와 lint: PASS
- `git diff --check`: PASS
- 기본 CLI 정적 import graph의 OpenAI edge: `0`
- 현재 Git index의 raw/state/실제 env 추적: `0`
- 이번 작업의 OpenAI·Supabase·외부 fetch: `0`

## 아직 완료되지 않은 것

1. HWP 8개는 사람이 같은 stem의 PDF로 변환해야 한다.
2. 로컬 후보 hard error 36개, coverage gap 53개, 이미지 hold 76개와 유료/로컬 차이
   225개를 사람이 원본과 대조해 human-reviewed compilation으로 확정해야 한다.
3. `load --apply`는 상태 인식형 25건 batch runner가 없어
   `load_apply_blocked_pending_state_aware_batch_runner`로 계속 닫혀 있다.
4. 현재 컴퓨터에는 staging Supabase URL/service-role 설정이 없다. 연결된 Supabase ref는
   운영 ref이므로 staging 대신 사용할 수 없다.
5. DB에 extraction provider·validator fingerprint·지어냄 수·coverage gap 수·bulk
   eligibility를 불변으로 보존하는 schema가 없다. 따라서 일괄 승인 실제 대상은 안전하게
   0건이다.
6. pending 데이터의 실제 Storage/DB 적재와 로그인한 관리자 브라우저 integration,
   카테고리×지역 실데이터 카운트 확인은 아직 하지 않았다.
7. 승인·공개, PR 병합, 운영 배포는 하지 않았다.
8. preview DTO에는 아직 정책 전문과 hall 전용 slot이 없어 위약금 badge·홀별 식대/보증
   인원 렌더를 실데이터로 검증하지 못했다. 상세 조회도 현재 전체 catalog를 다시 읽으므로
   staging 규모에서 직접 조회·pagination으로 바꿔야 한다.

완료되지 않은 항목을 우회해 DB나 공개 상태를 바꾸지 않는다.

## 다른 컴퓨터에서 이어가기

```powershell
git fetch --prune origin
git switch feat/vendor-disclosure-pipeline-v2-20260718
git pull --ff-only
corepack pnpm install --frozen-lockfile
corepack pnpm ingest:typecheck
corepack pnpm test:ingest
corepack pnpm --filter @hanbang/web typecheck
corepack pnpm --filter @hanbang/web test
gh pr view 64 --web
```

Git clone만으로 실제 공시 처리를 이어갈 수는 없다. raw와 `.state`는 의도적으로 Git 밖에
있다. 다른 컴퓨터에서 실데이터 작업을 이어가려면 해당 두 폴더를 승인된 private 경로로
복사한 뒤 hash seal을 다시 확인하거나 같은 원본으로 `scan → convert → extract → validate`를
재생성한다. API key나 유료 실행 authority는 옮길 필요가 없다.

## 안전한 다음 순서

1. sidecar 비교 검수 화면/도구에서 225개를 원본과 대조하고 명시적으로 승인된 compilation만
   만든다. 이미지와 HWP는 사람이 판독한다.
2. compilation provenance를 보존하는 DB schema와 migration을 PGlite·disposable hosted
   staging에서 검증한다.
3. 상태 인식형 25건 batch writer를 구현해 실패·재시도·needs_review 급증·Storage rollback을
   증명한다.
4. production과 다른 staging ref, 백업·복구 증거와 service-role을 준비한 뒤 pending만
   적재한다.
5. 관리자 preview에서 카테고리 4개×지역 카운트와 대표 6개 카드를 실데이터로 확인한다.
6. 사람이 개별 또는 검증 가능한 일괄 승인을 한 뒤에도 snapshot 공개는 별도 승인으로
   유지한다.
