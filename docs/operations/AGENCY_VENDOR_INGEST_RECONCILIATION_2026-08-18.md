# 결혼준비대행 원본 적재·기존 업체 대조 조사 (2026-08-18)

> [!IMPORTANT]
> **상태: INVESTIGATION REPORT / SOURCE DATA ABSENT / NO VENDOR ROWS CREATED /
> DATABASE NOT APPLIED / PRODUCTION NO-GO**
>
> 이 문서는 "결혼준비대행 원본을 적재해 사이트에 통합 업체로 보여 달라"는 요청을
> 조사한 결과다. **원본 폴더가 이 체크아웃에 없어 적재는 실행하지 않았다.**
> 업체 행을 하나도 만들지 않았고, 지어내지도 않았다.
>
> 조사 중 **실제 결함 1건**을 찾아 고쳤다: scan이 CSV·JPG 같은 미지원 원본을
> 아무 기록 없이 버려서, 대행사 하나가 통째로 사라져도 알 수 없었다.

## 1. 60초 요약

1. **원본은 이 저장소에 없다.** `data/raw/`는 `.gitignore:98`이 의도적으로 막고
   있고, 전체 브랜치 히스토리·LFS·이 VM 파일시스템 어디에도 없다.
2. **요청한 기능은 이미 거의 다 구현돼 있다.** 업체 신원 모델(업체 + 대행사 오퍼 +
   지점), 대행사별 가격, 위약금 원문, 체인 지점 분리, 그리고 그것을 보여주는
   `/price` UI가 모두 코드에 있다. 없는 것은 **데이터와 배포**지 코드가 아니다.
3. **예전에 올린 업체는 프로덕션에 없다.** 로컬 `.state/`와 staging DB까지만 갔고,
   프로덕션 릴리스 manifest는 `deployment_blocked`다. 자세한 경로는 §3.
4. **찾은 결함:** scan이 미지원 확장자를 조용히 버렸다. 재현·수정·테스트했다(§5).
5. **남은 일:** 원본을 안전한 경로로 전달받아야 §6의 인벤토리·매칭·건수를 낼 수
   있다. 그 전까지 "업체 N곳 추출" 같은 숫자는 이 문서에 쓰지 않는다.

## 2. 원본 부재 — 확인한 그대로

요청서의 중단 조건("폴더가 없으면 `data/`와 `.gitignore`에 있는 것을 정확히
보고하고 멈춘다")이 걸렸다. 확인한 명령과 결과는 다음과 같다.

| 확인 | 명령 | 결과 |
|---|---|---|
| 작업 트리 | `find . -maxdepth 4 -type d -name data` | `./apps/web/src/data` 하나뿐 |
| 추적 파일 | `git ls-files \| grep -E "(^\|/)data/"` | `apps/web/src/data/vendorFields.ts` 1건 |
| 전체 히스토리 | `git rev-list --all --objects \| grep -E "대행\|data/raw"` | 0건 |
| 브랜치별 경로 | `git log --all --name-only -- 'data/*'` | 0건 |
| Git LFS | `git lfs ls-files` | 비어 있음. `.gitattributes`에 LFS filter 없음 |
| 파일시스템 | `find / -xdev -iname "*결혼준비대행*"` | 0건 |

### `data/`에 있는 것

저장소 루트에 `data/` 디렉터리가 **없다.** 이름이 겹치는 유일한 경로는
`apps/web/src/data/`이고, 그 안의 `vendorFields.ts`는 업체 데이터가 아니라
카테고리별 상품 **입력 필드 정의**다(구 `mockVendors.ts`에서 mock 배열을 삭제한
잔여 파일).

### `.gitignore`에 있는 것

```98:104:/workspace/.gitignore
data/raw/
scripts/ingest/.state/
# 아래 항목은 이전 기본 state 위치를 사용한 로컬 작업물도 계속 차단한다.
scripts/ingest/.converted/
scripts/ingest/.cache/
scripts/ingest/validated/
scripts/ingest/manifest.json
```

**이것은 사고가 아니라 설계다.** `scripts/ingest/README.md:202`가 같은 규칙을
명시한다 — 원본과 생성물은 개인·업체 원문이므로 Git에 올리지 않는다. 따라서
"원본이 왜 없나"의 답은 "없어진 게 아니라 애초에 커밋 대상이 아니다"이다.

## 3. 예전에 올린 업체는 지금 어디에 있나

이번 조사의 핵심 질문이다. 결론부터: **프로덕션에는 없다.** 파이프라인의
어느 단계까지 갔는지 단계별로 적는다.

### 3-1. 데이터가 지나가는 경로

```text
data/raw/결혼준비대행서비스/{지역}/{업체}   ← 로컬에만 있음 (gitignore)
  → scan     → scripts/ingest/.state/{state}/manifest.json      ← 로컬에만 있음
  → convert  → .state/{state}/.converted/{unit}/{fingerprint}/  ← 로컬에만 있음
  → extract  → .state/{state}/.cache/extract-local/*.json       ← 로컬에만 있음
  → validate → .state/{state}/validated/*.json                  ← 로컬에만 있음
  → load     → Supabase **staging** (프로덕션 ref는 코드가 거부)
  → 공개 발행 → ✗ 실행된 적 없음
```

state 디렉터리는 `scripts/ingest/.state/` 아래로 강제된다:

```6:7:/workspace/scripts/ingest/io.ts
const INGEST_STATE_ROOT = path.join("scripts", "ingest", ".state");
```

**즉 예전 업로드의 산출물은 그 작업을 실행한 컴퓨터의 `scripts/ingest/.state/`
안에만 있다.** 다른 컴퓨터에서 clone해도 따라오지 않는다.

### 3-2. DB는 staging까지만 — 코드가 프로덕션을 거부한다

```15:18:/workspace/scripts/ingest/destination.ts
export function assertDisclosureStagingProjectRef(projectRef: string): void {
  if ((REPOSITORY_PRODUCTION_PROJECT_REFS as readonly string[]).includes(projectRef)) {
    throw new Error("production project ref is forbidden for disclosure ingest staging writes");
  }
}
```

적재 자체도 기본이 dry-run이고, `--apply`에는 `INGEST_LOAD_ENABLED=true`와
3단계 해시 체인(`--prepare-apply` → `--apply` → `finalize-staging-run`)이 필요하다.

### 3-3. 프로덕션 릴리스는 차단 상태

```json
// supabase/release-manifests/vendor-disclosure-v2-20260718.json
"status": "deployment_blocked",
"migrationFloor": "20260718120000",
"deploymentEvidence": {
  "hostedStaging": "missing", "backup": "missing", "hostedRestore": "missing",
  "storage": "missing", "finalizer": "missing"
}
```

이 manifest가 묶는 migration 묶음에 **공시 스키마 전체**가 들어 있다 —
`agencies`, `official_prices`, `official_price_options`,
`official_agency_packages`, `disclosure_semantic_staging`,
`vendor_disclosure_ingest_*`, 그리고 공개 뷰 `v_public_vendors`,
`v_public_official_prices`, `v_public_official_price_options`,
`v_public_vendor_policies`.

`/price` 화면은 전부 이 공개 뷰를 읽는다. 그래서 **뷰가 프로덕션에 없으면
업체 목록은 비어 보인다.** 업로드한 데이터가 사라진 게 아니라, 그 데이터를
담을 스키마가 프로덕션에 적용되지 않았다.

### 3-4. 파이프라인 자체 기록과 일치한다

```5:11:/workspace/scripts/ingest/README.md
> **2026-07-21 canonical 상태:** 원본 253개 파일·249개 단위 중 241개 단위의 변환이
> 완료됐고 HWP 8개는 사람 변환 대기다. ...
> ... DB/Storage apply와 공개
> 발행은 0건이다. 현재 상태와 과거 감사 문서가 다르면 이 절과 실제 `status` 출력을 따른다.
```

2026-07-18~19 파일럿 기록(README:206)에 따르면 원본 249 units / 253 files 중
**대행사 54 units, 예식장 195 units**를 스캔했다. 이것이 "예전에 올린 업체"의
규모에 대한 저장소 안의 유일한 1차 기록이다. 다만 이 숫자는 그 컴퓨터의
과거 실행 기록이며, 지금 이 체크아웃에서 재현해 확인한 값이 아니다.

> 확인 방법: 원본과 `.state`가 있는 컴퓨터에서
> `corepack pnpm ingest status --state-dir <state>`를 실행하면 현재 stage별
> 실제 개수가 나온다. 문서가 아니라 이 출력이 정본이다.

## 4. 요청한 기능은 이미 구현돼 있다

요청서 5번("사이트 동작을 실제로 출시하라")의 항목을 실제 코드와 대조했다.
**새로 만들 것이 아니라 데이터를 넣고 배포하면 되는 상태다.**

| 요청 | 구현 위치 | 상태 |
|---|---|---|
| 업체 하나로 보이기 | `apps/web/src/lib/price/vendorIdentity.ts` | 구현됨 |
| 대행사별 가격 나열 | `official_prices.agency_id` → `PriceOffer.agency` | 구현됨 |
| 위약금 원문 보존·표시 | `disclosure_semantic_staging.content_verbatim` → `v_public_vendor_policies` | 구현됨 |
| 체인 지점 분리 | `VENDOR_BRANCHES` (브랜드·지점·소재지) | 구현됨 |
| 지역 표시 | 지점 소재지가 대행사 지역을 이김 | 구현됨 |
| 가짜 추천·가격 금지 | `marketPrices.ts`는 빈 배열만 남은 legacy stub | 구현됨 |
| 점수·등급 금지 | 공개 뷰가 `confidence`를 내보내지 않음 | 구현됨 |

### 4-1. 업체 신원 모델

세 축이 이미 분리돼 있다.

- **업체(vendor):** `vendors.slug` = `{category}-ingest-{16hex}`. 정규화 업체명 +
  카테고리 + 지역의 sha256이며 적재 RPC가 만든다
  (`20260721120000_vendor_disclosure_atomic_batch_staging.sql:2378`).
- **대행사 오퍼(offer):** `official_prices` 한 행이 "이 대행사가 이 업체를 이 가격에
  취급한다"를 뜻한다. `agency_id`가 null이면 대행사를 거치지 않은 공시다.
- **지점(location):** 웹의 `VENDOR_BRANCHES`가 `{brand, branch, regionCode}`로
  들고 있고, 신원 키를 `브랜드#지점`으로 만들어 **지점을 합치지 않는다.**

지점을 합치면 안 된다는 판단에는 실측 근거가 붙어 있다:

```132:134:/workspace/apps/web/src/lib/price/vendorIdentity.ts
 * 지점을 합치면 안 된다는 건 데이터로 확인됐다 — 같은 대행사가 같은 base_spec으로
 * 올린 `바시움`(154만)과 `바시움 삼성점`(132만)이 22만원 다르다. 지점은 다른 샵이다.
```

반대로 **지역은 신원 키에서 뺐다.** 지역은 대행사의 것이지 샵의 것이 아니어서,
넣어 두면 같은 샵이 대행사 수만큼 갈린다(2026-07-26 실측 157그룹).

### 4-2. 요청한 테스트는 이미 있고 통과한다

요청서 6번이 요구한 두 시나리오가 이미 테스트로 고정돼 있다.
`apps/web`에서 33개 통과를 직접 확인했다.

- **같은 업체 / 두 대행사** — `publicListData.test.ts:156`
  "uses the canonical row name and keeps every verified sibling spelling searchable".
  `가을`(서울 대행사)과 `가을스튜디오`(강원 대행사)를 넣으면 카드 1장에
  offer 2개가 각자의 대행사·지역을 달고 나온다.
- **체인 vs 같은 샵** — `__tests__/vendorBranchIdentity.test.ts`
  - "[수원] 헤움 과 헤움_수원점 은 한 카드다" (표기 위치만 다른 같은 지점)
  - "그래도 맨이름 헤움과는 갈린다 — 다른 지점이다"
  - "지점은 병합되지 않는다 — 바시움 실측 22만원 차이"
  - "형제 지점이 실재하는 '본점'은 반대로 갈린다"
- **동명이업 분리** — `sameBusinessDifferentName.test.ts`
  "지역이 다른 지점은 합치지 않는다", "확인된 37쌍이 실제로 한 그룹으로 묶인다"

그래서 이 요청 항목에 대해서는 **테스트를 새로 만들지 않았다.** 같은 것을
중복으로 쌓으면 규칙이 두 곳에 생겨 오히려 갈린다.

## 5. 찾아서 고친 결함 — 미지원 원본이 조용히 사라졌다

요청서의 "HWP가 있으면 파싱하고, **조용히 건너뛰지 말 것**"을 확인하다가 발견했다.
HWP는 문제가 없었다(2026-08-08부터 자동 변환된다 — `convert.ts:2801`). 문제는
요청서가 원본에 있다고 밝힌 **CSV**였다.

### 5-1. 재현

`SUPPORTED_SOURCE_EXTENSIONS`는 `xlsx, docx, hwp, pdf, png` 다섯 개뿐이고
(`types.ts:1`), scan은 그 밖의 확장자를 `continue`로 넘겼다. 합성 원본 트리로
실제 `scanSources`를 돌린 결과:

| 입력 (대행사 4곳 / 파일 5개) | 결과 |
|---|---|
| `가나웨딩/` (xlsx + **위약금.csv**) | unit 1개 — **csv는 흔적 없이 사라짐** |
| `다라웨딩/` (csv만) | **unit 없음 — 대행사 통째로 사라짐** |
| `마바웨딩.csv` (지역 폴더 직하) | **unit 없음 — 대행사 통째로 사라짐** |
| `사아웨딩/` (jpg만) | **unit 없음 — 대행사 통째로 사라짐** |

출력은 `units: 1`, `notices: []`였다. manifest에도 `status`에도 경고가 0건이라,
**업로드한 사람이 무엇을 잃었는지 알 방법이 전혀 없었다.** 요청서가 말한
"업체를 올렸는데 어디로 갔는지 모르겠다"가 실제로 일어날 수 있는 경로다.

### 5-2. 수정

원본 형식을 새로 파싱하지 **않았다**(왜인지는 §6-2). 대신 잃어버린 사실이
반드시 드러나게 했다.

- `manifest.skipped_sources`에 경로·확장자·소속 unit을 남긴다.
- 변환 가능한 파일이 하나도 없는 업체는 `unit_id: null`로 적는다 —
  **"이 업체는 파이프라인에 존재하지 않는다"는 뜻이다.**
- 같은 stem의 변환 가능한 파일이 있으면(`업체.xlsx` 옆 `업체.csv`) 그 unit에
  `unsupported_source_file:` notice로 붙인다. 재scan해도 notice가 지워지지 않는다.
- `status`는 개수와 확장자만 보여준다. 업체명·경로는 계속 내보내지 않는다
  (이 표는 인계 문서에 붙여 넣는 용도라 content-safe 계약을 지켜야 한다).
- `.DS_Store`, `Thumbs.db`, `desktop.ini`, `._*`는 업체 자료가 아니므로 세지 않는다.

```text
Unsupported source files: 3 (csv=2, jpg=1)
Unsupported source files with no unit: 2
```

기존 manifest는 `skipped_sources` 기본값으로 계속 읽히므로, 이미 변환해 둔
로컬 state가 초기화되지 않는다. 같은 이유로 `SCANNER_PARSER_VERSION`도 올리지
않았다 — unit 신원·source 선택·fingerprint가 전혀 바뀌지 않았고, 버전을 올리면
241개 unit이 근거 없이 전부 재변환된다.

### 5-3. 검증

| 명령 | 결과 |
|---|---|
| `corepack pnpm ingest:typecheck` | 통과 |
| `corepack pnpm test:ingest` | 866 pass / 0 fail / 2 skip |
| `npx vitest run` (업체 신원 3개 파일) | 33 pass |

새 테스트는 먼저 RED를 확인한 뒤 통과시켰다. 추가한 것: 형제 파일 누락 보고,
변환 불가 업체의 가시성, 같은 stem 귀속, OS 메타데이터 제외, 재scan 시 notice 보존,
status content-safety.

## 6. 원본을 받으면 해야 할 일

### 6-1. 실행 순서

원본을 이 저장소의 `data/raw/`(gitignore 대상)로 두고 아래를 실행한다. 경로 구조는
`결혼준비대행서비스/{지역}/{업체 파일 또는 업체 폴더}`여야 한다.

```powershell
corepack pnpm ingest scan data/raw
corepack pnpm ingest status      # ← 먼저 skipped_sources 를 본다
corepack pnpm ingest convert
corepack pnpm ingest extract     # 로컬 전용·0원
corepack pnpm ingest validate
corepack pnpm ingest load --snapshot <라벨>   # dry-run
```

`status`의 `Unsupported source files with no unit`이 0이 아니면 **거기서 멈춘다.**
그 숫자만큼의 대행사가 파이프라인에 아예 없다는 뜻이므로, 먼저 §6-2를 결정한다.

### 6-2. CSV·JPG를 왜 지금 파싱하지 않았나

추측으로 만들면 조용히 틀리기 때문이다. 샘플이 한 건도 없는 상태에서 최소한
이만큼이 미정이다.

- **인코딩.** 한국어 Excel의 CSV 내보내기는 CP949(EUC-KR)인 경우가 많다. UTF-8로
  가정해 읽으면 업체명이 전부 깨지는데, 깨진 이름도 문자열이라 파이프라인은
  성공으로 지나간다. 조용한 오염이 조용한 누락보다 나쁘다.
- **구분자와 레이아웃.** 쉼표/탭/세미콜론, 병합 헤더, 한 파일 안의 복수 표.
- **근거 좌표.** validator는 모든 금액에 원문 `source_quote`를 요구하고
  XLSX는 `시트!셀`, PDF는 페이지 좌표로 근거를 건다. CSV에 대응하는 locator 규칙을
  먼저 정하지 않으면 적재 자체가 차단된다.

**권장:** 대상 CSV·JPG를 XLSX/PDF로 저장해 다시 scan하는 것이 가장 빠르고 안전하다.
그래도 CSV를 정식 지원해야 한다면 실제 샘플 3~5건을 받은 뒤 인코딩 판별과
locator 규칙을 근거와 함께 설계한다.

### 6-3. 원본 없이는 낼 수 없는 숫자

요청서 6번이 요구한 보고 항목 중 아래는 **비워 둔다.** 지어내지 않는다.

- 지역 → 대행사 → 파일 인벤토리와 형식별 필드 목록
- 추출된 업체 수
- 기존 사이트 레코드와 매칭된 수 / 미매칭 / 중복 의심
- 체인으로 보이는 업체 수

이 숫자들은 `validated/*.json`과 `validated/dedupe_candidates.json`이 생긴 뒤에야
근거를 갖는다. 참고로 dedupe는 **자동 병합하지 않는다** — 같은 지역의 정규화 이름
trigram 0.7 이상만 사람 검토 후보로 제안한다(`validate.ts:5104`, `auto_merge: false`).

### 6-4. 데이터와 별개로 남아 있는 배포 게이트

원본을 다 적재해도 사이트에 나오려면 아래가 따로 필요하다. 이번 작업은 어느
것도 건드리지 않았다.

1. `vendor-disclosure-v2-20260718` manifest의 `deployment_blocked` 해제 —
   hostedStaging / backup / hostedRestore / storage / finalizer 증거 5종
2. 프로덕션 migration 적용(승인된 release controller 경로로만)
3. pending 행의 사람 검수 — 적재는 전부 `pending + needs_review=true`로 들어오고,
   공개 뷰는 `review_status = 'approved'`만 내보낸다
4. snapshot 발행(`published = true`)

## 7. 이번 작업에서 하지 않은 것

- 업체·가격·위약금 행을 만들지 않았다. 원본이 없으므로 만들 수 없다.
- 새 카탈로그·새 적재 경로를 만들지 않았다. 기존 `scripts/ingest`와 `/price`가
  요청한 모델을 이미 담고 있어 병렬 구조를 만들 이유가 없었다.
- DB에 쓰지 않았고 migration을 추가하지 않았다. 배포·발행도 하지 않았다.
- 아모라 / chat / `lib/ai` / `api/chat`은 열지 않았다.
- `SCANNER_PARSER_VERSION`을 올리지 않았다(§5-2).

## 8. 근거 등급

- **E (이번에 직접 확인):** 원본 부재 6종 확인, scan 침묵 재현, 수정 후
  `ingest:typecheck` / `test:ingest` 866 pass / vitest 33 pass, manifest
  `deployment_blocked`, 인용한 모든 코드·SQL 라인.
- **S (1차 자료):** `scripts/ingest/README.md`, migration SQL, release manifest.
- **I (추론):** "예전에 올린 업체는 그 컴퓨터의 `.state/`에만 있다" — state 경로
  강제(`io.ts:6`)와 gitignore, staging 전용 denylist에서 따라온다.
- **M (기억):** 없음.

### UNVERIFIED

- 원본 249 units / 253 files(대행사 54)는 README에 적힌 **과거 실행 기록**이며,
  이번에 재현해 확인한 값이 아니다.
- staging DB의 현재 실제 행 수를 확인하지 못했다(이 환경에 staging 자격증명 없음).
  `disclosure_semantic_staging` 895행은 migration 주석의 2026-07-26 기록이다.
- 프로덕션 DB에 공시 스키마가 실제로 없는지는 파일 증거(manifest 차단 + 적용
  receipt 부재)로 판단했고, 프로덕션에 직접 질의해 확인하지 않았다.
