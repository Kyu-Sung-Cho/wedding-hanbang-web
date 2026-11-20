# 결혼준비대행 원본 적재·기존 업체 대조 조사 (2026-08-18)

> [!IMPORTANT]
> **상태: INVESTIGATION REPORT / NO VENDOR ROWS CREATED / RAW SOURCES ABSENT FROM REPO /
> PUBLIC PRICE SURFACE IS LIVE IN PRODUCTION**
>
> 원본 파일은 이 체크아웃에 없어 새 적재는 실행하지 않았다. 업체 행을 하나도 만들지
> 않았고 지어내지도 않았다.
>
> **핵심 정정:** 이 문서의 초판(같은 날 앞선 커밋)은 "공시 스키마가 프로덕션에
> 적용되지 않아 업체 목록이 비어 보인다"고 적었다. **사실이 아니다.** 릴리스는
> 2026-07-23에 이미 끝났고, `hanbang.ai/price`는 지금 **업체 829곳·대행사 40곳**을
> 서비스하고 있다. 정정 근거는 §3에 있다.

## 1. 60초 요약

1. **예전에 올린 업체는 사라지지 않았다. 지금 프로덕션에서 서비스 중이다.**
   `hanbang.ai/price` 기준 업체 829곳(스튜디오 296 · 드레스 200 · 메이크업 144 ·
   웨딩홀 189), 대행사 40곳, 2025년 11월 공시 기준.
2. **요청한 기능은 이미 라이브다.** 업체 1곳 아래 대행사별 가격과 대행사별 위약금
   원문이 실제로 붙어 나온다(§4에 실제 화면 인용).
3. **원본 파일(raw)만 저장소에 없다.** `.gitignore:98`이 의도적으로 막는다. 다만
   **파생 증거는 커밋돼 있다** — `scripts/ingest/evidence/vendor-disclosure-v2/`에
   249 units / 253 files 전체 인벤토리가 들어 있다(초판이 놓친 것, §2).
4. **대조 결과(실측):** 원본 대행사 54개 단위 중 **40개가 라이브 대행사와 정확히
   일치**하고 **14개는 사이트에 없다.** 사이트에만 있고 원본에 없는 대행사는 **0곳**
   이다(§5).
5. **`wedding-vendor-disclosure-v2`는 GitHub 저장소가 아니다.** 그 PC의 로컬 폴더
   이름이며, 이 저장소 안에는 같은 이름의 **증거 디렉터리**가 따로 있다(§6).
6. **고친 결함:** scan이 CSV·JPG를 조용히 버려 대행사가 통째로 사라질 수 있었다.
   전부 기록되게 고쳤고, 변환 가능한 파일이 0개일 때의 에러 메시지도 무엇이
   보였는지 말하게 했다(§7).

## 2. 커밋된 증거 — 초판이 놓친 것

**초판은 "인벤토리는 원본 없이 낼 수 없다"고 적었다. 틀렸다.** 아래 11개 파일이
`main`에 커밋돼 있고 작업 트리에도 있다.

```text
scripts/ingest/evidence/vendor-disclosure-v2/
├── bundle-manifest.json
├── verify-restore.ts / verify-restore.test.ts
└── artifacts/
    ├── source-object-manifest.json            ← 249 units / 253 files 전체 인벤토리
    ├── manual-pilot-source-money-ground-truth.json  ← 금액 2,342건 + 셀 좌표
    ├── fixed-eight-ground-truth-overlay-v2.json
    ├── fixed-eight-ground-truth-overlay-v3-canonical-visual.json
    ├── fixed-eight-ground-truth-adjudication-v3.json  ← 사람 판정 68건
    ├── fixed-eight-ground-truth-build-report.json
    ├── eileen-visual-transcription-sidecar.json      ← 사람 확인 전사 29블록
    └── may-visual-transcription-sidecar.json
```

`bundle-manifest.json`이 고정하는 값: `unit_count: 249`, `source_object_count: 253`,
`ground_truth_occurrence_count: 2342`, `artifact_total_bytes: 1081239`.

### 2-1. 커밋된 원본 인벤토리 (요청 1번의 답)

`source-object-manifest.json`의 각 unit은 `path`, `ext`, `sha256`, `bytes`를 갖는다.
경로에 지역과 대행사 이름이 그대로 들어 있어 **원본 파일 없이도 인벤토리를 낼 수
있다.** 아래는 그 파일에서 계산한 값이다(지어낸 값이 아니다).

| 구분 | units | 형식 |
|---|---:|---|
| 결혼준비대행서비스 | **54** | xlsx 46 · pdf 4 · hwp 3 · docx 2 · png 1 |
| 예식장 | 195 | xlsx 173 · pdf 18 · hwp 5 · docx 1 |
| **합계** | **249** | xlsx 219 · pdf 22 · hwp 8 · docx 3 · png 1 = **253 files** |

복수 파일 unit은 3개다.

**대행사 12개 지역:** 강남 12 · 충청도 9 · 전라도 6 · 강원도 5 · 서울(강남 외) 5 ·
부산 4 · 경상도 3 · 광주 3 · 경기도 2 · 대전 2 · 울산 2 · 제주도 1.

**예식장 14개 지역:** 강남 27 · 경기도 24 · 서울(강남 외) 24 · 충청도 23 · 전라도 21 ·
부산 20 · 대전 13 · 경상도 9 · 제주도 9 · 대구 7 · 광주 6 · 강원도 4 · 울산 4 · 인천 4.

> **CSV가 이 표에 없는 이유를 오해하면 안 된다.** 이 인벤토리는 scan이 만든 것이고,
> 당시 scan은 미지원 확장자를 **세지 않고 버렸다**(§7). 따라서 "CSV 0건"은
> "CSV가 없었다"가 아니라 **"CSV가 있었어도 여기 나타나지 않는다"**는 뜻이다.
> 지금 그 PC의 폴더에 CSV가 있는지는 고친 scan을 돌려야 알 수 있다.

### 2-2. 커밋된 금액 근거

`manual-pilot-source-money-ground-truth.json`은 8개 unit의 금액 발생 위치
**2,342건**을 담는다. 한 건의 형태는 `{"raw":"139","krw":1390000,
"line_context":"스튜디오!B6: 139","source_locator":"스튜디오!B6"}`이다.
**업체명은 들어 있지 않다** — 금액과 셀 좌표뿐이라 업체 카탈로그가 아니다.

sidecar 2건은 사람이 확인한 전사 블록(예: `AILEEN COUTURE`)과
`partner_vendors[N].options[M]` 형태의 레코드 근거를 담는다. 2개 unit 한정이다.

## 3. 정정 — 릴리스는 이미 끝났다

초판은 릴리스 manifest의 `status: "deployment_blocked"`를 보고 "프로덕션에 스키마가
없다"고 결론지었다. **manifest status를 배포 여부로 읽은 것이 오독이었다.**

커밋 `dbf798ce`(브랜치 `origin/docs/retire-vendor-disclosure-manifest-20260808`)가
이유를 명시한다.

> 이 매니페스트가 계획한 릴리스는 **2026-07-23에 이미 끝났다.** 운영 원장을 읽기
> 전용으로 조회해 확인했다 — expand 32건이 전부 적용돼 있고 head가 매니페스트의
> 마지막 마이그레이션(20260727090000)이다. requiredRemoteHead는 그보다 앞선
> 20260716117000이라, 증거 5종을 다 모아도 원장 불일치로 컨트롤러는 열리지 않는다.

즉 `deployment_blocked`는 **"이 컨트롤러가 이 매니페스트를 대상으로 돌면 안 된다"**는
뜻이지 "배포되지 않았다"가 아니다. 같은 커밋이 파일 삭제와 status 변경을 둘 다
금지한다 — 파일을 지우면 `controller:82`의 `if (!existsSync(path)) return;` 때문에
운영 릴리스 차단이 조용히 풀린다.

### 3-1. 라이브 확인 (2026-08-18)

`hanbang.ai`를 직접 조회해 확인했다.

| 확인 | 값 |
|---|---|
| `/price` | 업체 **829곳**, 공시 **831건**, 2025년 11월 공시 기준 |
| 카테고리 | 스튜디오 296 · 드레스 200 · 메이크업 144 · 웨딩홀 189 (= 829) |
| 대행사 필터 | **40곳** (4개 카테고리 페이지 union 동일) |
| `-ingest-` 슬러그 | `/price/studio` 한 페이지에만 640개 (studio 296 + dress 200 + makeup 144) |
| 상세 페이지 | `/price/vendor/studio-ingest-004a1a6d7a5b8b93` → HTTP 200 |

슬러그 형식은 migration이 만드는 `{category}-ingest-{16hex}` 그대로다
(`20260721120000_vendor_disclosure_atomic_batch_staging.sql:2378`).

## 4. 요청한 화면은 이미 라이브다

요청서 5번("업체 1곳 + 대행사별 가격 + 위약금 원문 + 체인 지역")을 실제 라이브
페이지로 확인했다. `/price/vendor/studio-ingest-004a1a6d7a5b8b93`(비마이스튜디오)는
**대행사 5곳의 가격을 한 업체 아래**에 보여준다.

| 대행사 | 항목 | 가격 |
|---|---|---|
| 아이웨딩 | 리허설 (20P) | 119~152만원 |
| 베리굿웨딩 | 앨범 20페이지 | 132~143만원 |
| 요즘웨딩 | 단품가 | 140만원 |
| 다이렉트결혼준비 | 앨범20p·액자20R 기준 | 154만원 |
| 리얼웨딩 | — | 가격 확인 필요 |

그리고 **위약금 원문이 대행사별로 따로** 나온다.

> 이 업체는 대행사 2곳이 서로 다른 문구로 공시했어요. 계약할 대행사의 조건을 직접
> 비교해 보세요.
>
> **위약금 · 베리굿웨딩 공시** — 촬영일 기준 60~31일 전 상품가의 20% / 30~15일 전 40% /
> 14일 전~당일 100%
>
> **위약금 · 요즘웨딩 공시** — 60~31일 전 취소 30% / 30~15일 전 50% / 14일 전~당일 100%
> (일정 변경시 별도 기준)

화면 문구도 계약을 지킨다: "업체가 공시한 원문 그대로예요. 웨딩한방이 요약하거나
해석하지 않았고". 점수·등급·추천 목록은 없다.

목록 화면도 같다 — `/price/studio`에 "대행사 6곳 공시", "대행사 3곳 · 경로에 따라
다름" 카드가 실재하고, "이름이 같거나 같은 업체로 확인된 표기는 한 카드로 모았어요.
지점·동명 업체로 확인된 표기는 따로 보여드려요."라는 병합·지점 문구도 라이브다.

표기 병합도 실제로 동작한다. 같은 카드 안에 `비마이스튜디오`(아이웨딩·베리굿웨딩·
다이렉트결혼준비·리얼웨딩)와 `비마이 스튜디오`(요즘웨딩, 띄어쓰기 다름)가 함께 묶여
있다.

## 5. 원본 ↔ 사이트 대조 (요청 4번의 답)

커밋된 `source-object-manifest.json`의 대행사 54개 단위를, 라이브 대행사 40곳과
대조했다. 이름 정규화는 파이프라인 자신의 `parseUnitName` / `normalizeVendorName`을
그대로 호출해서 했다(별도 규칙을 새로 만들지 않았다).

| 항목 | 값 |
|---|---:|
| 원본 대행사 단위 | 54 |
| 라이브 대행사 | 40 |
| **일치** | **40** |
| **원본에 있으나 사이트에 없음** | **14** |
| **사이트에 있으나 원본에 없음** | **0** |

**사이트에만 있는 대행사가 0곳이라는 점이 중요하다** — 라이브 대행사 40곳이 전부
실제 원본 파일로 추적된다. 사이트에 지어낸 대행사는 없다.

### 5-1. 사이트에 없는 원본 대행사 14곳

| 지역 | 원본 파일 | 형식 |
|---|---|---|
| 강남 | `[서울(강남)]_에일린꾸뛰르.pdf` | pdf |
| 강원도 | `(강원)_산과바다 베키니아호텔 주문진리조트_결혼준비대행.hwp` | hwp |
| 강원도 | `(강원도)_메이브라이드.png` | png |
| 대전 | `(대전)_라메종블랑쉬((주)해라).xlsx` | xlsx |
| 대전 | `(대전)_바비블랑브라이드.xlsx` | xlsx |
| 전라도 | `(전라도)_모니카블랑.hwp` | hwp |
| 전라도 | `(전라도)_웨스턴라이프호텔&컨벤션(㈜디에스에이치글로벌 익산지점)_결혼준비대행.xlsx` | xlsx |
| 제주도 | `(제주도)_비비드블랑.xlsx` | xlsx |
| 충청도 | `(충청도)_BBB웨딩((주)더메이트).xlsx` | xlsx |
| 충청도 | `(충청도)_국현우리옷 청주점, 메리다점.xlsx` | xlsx |
| 충청도 | `(충청도)_비마이스튜디오 청주점((주)양군네사진관).xlsx` | xlsx |
| 충청도 | `(충청도)_아이브 브라이드.pdf` | pdf |
| 충청도 | `(충청도)_오드 스튜디오.hwp` | hwp |
| 충청도 | `(충청도)_플로렌스 웨딩.xlsx` | xlsx |

**형식별로 보면 원인이 갈린다.**

- **비-XLSX 6건**(hwp 3 · pdf 2 · png 1) — 파이프라인이 사람 손을 요구했던 경로와
  정확히 겹친다. HWP는 2026-08-08에야 자동 변환이 켜졌고, PNG(메이브라이드)와
  텍스트가 빈 PDF는 시각 판독 보류 대상이었다. `manual-pilot-source-money-ground-truth.json`
  에서도 `에일린꾸뛰르.pdf`와 `메이브라이드.png`는 금액 발생이 **0건**으로 기록돼 있다.
- **XLSX 8건** — 형식 문제가 아니다. validation error나 적재 가능한 가격 행 0건으로
  막혔을 가능성이 높다. 정확한 사유는 그 PC의 `.state/validated/`를 봐야 한다.

주의: `비마이스튜디오 청주점`과 `플로렌스 웨딩`은 **대행사로서는 사이트에 없지만**,
같은 이름의 **제휴 업체**는 다른 대행사 파일을 통해 사이트에 있다
(`비마이스튜디오`는 §4의 그 업체다). 대행사 축과 업체 축을 섞어 읽으면 안 된다.

### 5-2. 대조의 한계

이 대조는 **대행사 축**이다. 업체 829곳 각각이 어느 원본 파일에서 왔는지는 커밋된
증거만으로는 알 수 없다 — `source-object-manifest.json`은 파일 목록이고 업체 목록이
아니다. 업체 단위 추적은 그 PC의 `.state/validated/*.json`이 필요하다.

## 6. `wedding-vendor-disclosure-v2`의 정체

세 가지가 같은 이름을 쓰고 있어 혼동하기 쉽다.

| 무엇 | 어디 | 상태 |
|---|---|---|
| **GitHub 저장소** | `Kyu-Sung-Cho/wedding-vendor-disclosure-v2` | **존재하지 않음.** `gh repo list`(16개 전부)에 없고 직접 조회도 `Could not resolve to a Repository` |
| **그 PC의 폴더** | `C:\...\hanbang\wedding-vendor-disclosure-v2` | git 저장소 **옆**의 작업 폴더. `scripts/manners/parts.json`에 `work/manners-20260808/etq.ts` 등으로 7회 언급 |
| **이 저장소의 디렉터리** | `scripts/ingest/evidence/vendor-disclosure-v2/` | 커밋됨. §2의 증거 번들 |

`Kyu-Sung-Cho` 계정의 저장소는 16개이고 웨딩 관련은
`wedding-hanbang-web`(이 저장소, private)과 `wedding-hanbang-pretotype`(public)뿐이다.

문서 2건(`VENDOR_DISCLOSURE_FIXED8_EXECUTION_HANDOFF_2026-07-20.md:5`,
`CURRENT_WORKSPACE_HANDOFF_2026-07-19.md:17`)이 "저장소: `wedding-vendor-disclosure-v2`"
라고 적었는데, 이는 **로컬 폴더를 저장소라고 부른 표기**다. 원격은 없다.

## 7. 고친 결함 — 미지원 원본이 조용히 사라졌다

### 7-1. 재현

`SUPPORTED_SOURCE_EXTENSIONS`는 `xlsx, docx, hwp, pdf, png` 다섯뿐이고, scan은 그
밖의 확장자를 기록 없이 `continue`로 넘겼다. 합성 원본으로 실제 `scanSources`를 돌린
결과는 `units: 1`, `notices: []`였다.

| 입력 (대행사 4곳 / 파일 5개) | 고치기 전 | 고친 뒤 |
|---|---|---|
| `가나웨딩/` (xlsx + 위약금.csv) | csv 흔적 없이 사라짐 | unit에 notice + `unit_id` 붙은 기록 |
| `다라웨딩/` (csv만) | **대행사 통째로 사라짐** | `unit_id: null`로 기록 |
| `마바웨딩.csv` (지역 직하) | **대행사 통째로 사라짐** | `unit_id: null`로 기록 |
| `사아웨딩/` (jpg만) | **대행사 통째로 사라짐** | `unit_id: null`로 기록 |

§2-1에서 지적한 대로, 이 침묵 때문에 **커밋된 인벤토리의 "253 files"도 지원 형식만
센 값**이다.

### 7-2. 무엇을 바꿨나

- `manifest.skipped_sources`에 `path` · `ext` · `unit_id`를 남긴다.
  `unit_id: null`은 "이 업체는 파이프라인에 존재하지 않는다"는 뜻이다.
- 같은 stem의 변환 가능한 파일이 있으면(`업체.xlsx` 옆 `업체.csv`) 그 unit에
  `unsupported_source_file:` notice로 붙인다. 재scan해도 지워지지 않는다.
- `status`는 개수와 확장자만 노출한다(업체명·경로 비노출 계약 유지).
- **변환 가능한 파일이 하나도 없으면 manifest 자체가 안 쓰인다.** 그 경로에서는
  에러 메시지가 직접 증거를 들고 간다:
  `No supported source files were found, but 3 unsupported file(s) were seen (csv=2, jpg=1). 지원 형식은 xlsx, docx, hwp, pdf, png입니다.`
- 확장자는 **실제 파일명에서** 캡처하고 portable 경로에서 다시 파싱하지 않는다.
  Windows와 POSIX의 구분자 차이에 기록이 의존하지 않게 하기 위해서다.
- `.DS_Store`, `Thumbs.db`, `desktop.ini`, `._*`는 업체 자료가 아니므로 세지 않는다.

### 7-3. 호환성

- 기존 manifest는 `skipped_sources` 기본값(`[]`)으로 계속 읽힌다 → 그 PC의
  `.state`가 초기화되지 않는다.
- `SCANNER_PARSER_VERSION`을 **올리지 않았다.** unit 신원·source 선택·fingerprint가
  전혀 바뀌지 않았고, 올리면 241개 unit이 근거 없이 전부 재변환된다.

### 7-4. Windows에서 그대로 도는가

이 파이프라인은 **이미 Windows에서 돌아간 증거가 있다** — 커밋된
`source-object-manifest.json`의 경로가 전부 forward slash이고, 그 파일은 그 PC에서
생성됐다. `toPortableRelativePath`가 `path.sep`으로 split해 `/`로 join하기 때문이다
(`io.ts:151`).

이번 변경도 같은 계약을 지킨다. 확장자를 파일명에서만 캡처하므로 구분자 의미에
의존하는 코드가 새로 생기지 않았다. 다만 아래 둘은 코드로 못 고친다.

- **Desktop이 OneDrive 동기화 폴더면** 파일이 "클라우드 전용" 자리표시자일 수 있다.
  `sha256File`이 실제 바이트를 읽으므로 첫 scan이 느리거나 다운로드를 유발한다.
  미리 "이 디바이스에 항상 유지"로 받아 두는 편이 안전하다.
- **`.converted/{unit_id}/{fingerprint}/`는 경로가 깊다.** PDF 래스터화는 이미 짧은
  임시 경로에서 렌더링 후 게시하도록 보강돼 있고, 필요하면
  `INGEST_PDFTOPPM_PATH`로 실행 파일을 절대경로 지정한다.

### 7-5. 검증

| 명령 | 결과 |
|---|---|
| `corepack pnpm ingest:typecheck` | 통과 |
| `corepack pnpm test:ingest` | **867 pass / 0 fail** / 2 skip |
| `corepack pnpm supabase:release:test` | 188 pass / 0 fail / 1 skip |
| `corepack pnpm supabase:release:fence` | 통과 |
| `vitest run src/lib/price` (apps/web) | 150 pass / 0 fail |

새 테스트는 먼저 RED를 확인한 뒤 통과시켰다.

## 8. Git에 있는 것 vs 그 PC에만 있는 것

| 무엇 | Git | 그 PC |
|---|---|---|
| 원본 파일(xlsx/hwp/pdf/png/docx) | ✗ (`.gitignore:98`) | `wedding\data\raw\결혼준비대행서비스` |
| 원본 인벤토리(경로·해시·바이트) | **✓** `source-object-manifest.json` | 동일 |
| 금액 발생 ground truth 2,342건 | **✓** `manual-pilot-*.json` | 동일 |
| 사람 확인 전사 sidecar 2건 | **✓** `artifacts/*-sidecar.json` | 동일 |
| scan manifest / `.converted` / `.cache` / `validated` | ✗ | `wedding\scripts\ingest\.state` |
| 업체별 추출 결과·검증 사유 | ✗ | `.state\validated\*.json` |
| 로고 헌팅 원본 코퍼스 | ✗ (`work/` gitignore) | `work\logo-hunt\results-*.json` |
| 매너 파트 작업 원본 | ✗ | `wedding-vendor-disclosure-v2\work\manners-20260808\` |
| 업체 병합 판정 근거 24건 | **✓** `docs/operations/evidence/vendor-merge-evidence-2026-07-28.json` | — |
| 업체 신원·지점 규칙 | **✓** `apps/web/src/lib/price/vendorIdentity.ts` | — |
| 공시 스키마·공개 뷰 | **✓** `supabase/migrations/` (프로덕션 적용 완료) | — |
| 업체 829곳 실데이터 | ✗ (DB) | ✗ (프로덕션 Supabase) |

### 8-1. 프로덕션 DB의 업체는 두 종류다

섞으면 안 된다.

1. **레거시 포털 `vendors`** — 시드/데모 업체. `20260705090000_hide_seed_vendors.sql`이
   기록한 적용 결과: `52행 pending 전환 → 분포 pending 176 / rejected 1 / approved 0`,
   `/api/vendors total=0`. 즉 **의도적으로 전부 숨김**이다.
2. **공시 적재 업체** — `-ingest-` 슬러그를 가진 829곳. `/price`가 공개 뷰로 읽는다.

"업체가 안 보인다"가 1번을 말하는 것이면 정상 동작이고, 2번을 말하는 것이면 §5의
14곳 문제다.

## 9. 다음에 그 PC에서 할 일

```powershell
# 1) 고친 scan으로 무엇이 그동안 안 보였는지 먼저 본다
corepack pnpm ingest scan data/raw
corepack pnpm ingest status
#    → "Unsupported source files" 와 "with no unit" 을 확인한다.
#      0이 아니면 그 수만큼 대행사가 파이프라인에 아예 없다는 뜻이다.

# 2) 사이트에 없는 14곳의 실제 사유를 본다 (§5-1)
#    .state/validated/*.json 의 issues / coverage_gaps 를 unit_id 로 조회
```

`unit_id`는 raw root 기준 상대경로의 sha256이므로, §5-1의 파일 경로로 바로 계산해
`.state`에서 찾을 수 있다.

### 9-1. CSV·JPG를 정식 지원할 것인가

지금은 하지 않았다. 샘플이 없는 상태에서 추측으로 만들면 조용히 틀린다.

- **인코딩** — 한국어 Excel의 CSV 내보내기는 CP949인 경우가 많다. UTF-8로 가정하면
  업체명이 전부 깨지는데, 깨진 이름도 문자열이라 파이프라인은 성공으로 지나간다.
  조용한 오염이 조용한 누락보다 나쁘다.
- **근거 좌표** — validator는 모든 금액에 `source_quote`를 요구하고 XLSX는 `시트!셀`로
  근거를 건다. CSV용 locator 규칙 없이는 적재가 차단된다.

가장 빠르고 안전한 길은 대상 파일을 XLSX/PDF로 저장해 다시 scan하는 것이다.

## 10. 이번 작업에서 하지 않은 것

- 업체·가격·위약금 행을 만들지 않았다. 원본이 없으므로 만들 수 없다.
- DB에 쓰지 않았고 migration을 추가하지 않았다. 배포·발행도 하지 않았다.
- 릴리스 manifest 파일과 `status`를 건드리지 않았다(§3의 함정 때문이다).
- 새 카탈로그·새 적재 경로를 만들지 않았다.
- 아모라 / chat / `lib/ai` / `api/chat`은 열지 않았다.

## 11. 근거 등급

- **E (이번에 직접 확인):** 원본 부재 6종 확인, 커밋된 증거 번들 11파일과 그
  집계값, `hanbang.ai` 라이브 조회 5건, 대행사 40곳 추출, 54↔40 대조,
  scan 침묵 재현과 수정 후 `test:ingest` 867 pass, `gh repo list` 16건.
- **S (1차 자료):** 커밋 `dbf798ce` 메시지, migration SQL, `scripts/ingest/README.md`,
  release manifest.
- **I (추론):** §5-1의 XLSX 8건이 "validation error 또는 가격 행 0건"이라는 것.
  형식이 문제가 아니라는 것까지만 근거가 있고, 실제 사유는 `.state`를 봐야 한다.
- **M (기억):** 없음.

### UNVERIFIED

- 업체 829곳 각각의 원본 추적은 하지 못했다(§5-2).
- `v_public_vendors` 1,053행(2026-07-30 감사 기록)과 오늘 라이브 829곳의 차이는
  신원 병합으로 카드가 줄어든 결과로 보이나, DB를 직접 조회해 확인하지 않았다.
- 그 PC의 현재 `data/raw` 내용이 커밋된 2026-07 스냅샷과 같은지 확인할 수 없다.
  CSV 유무는 고친 scan을 돌려야 알 수 있다.
- 프로덕션 DB에 직접 질의하지 않았다. 배포 완료 판단은 커밋 `dbf798ce`의 원장 조회
  기록과 라이브 사이트 응답에 근거한다.
