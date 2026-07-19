# Current workspace handoff — 2026-07-19

## 결론

현재 통합 브랜치는 로컬 코드·정적 보안·빌드·모바일 export 검증을 통과했다.
그러나 hosted staging, 실제 OpenAI 파일럿, clean DB 타입 재생성, 백업·복구,
외부 서명 배포 승인, 실제 EAS 기기 빌드가 없으므로 **운영은 NO-GO**다. 병합,
운영 DB 쓰기, Vercel production 승격, EAS production build를 완료로 보고하지 않는다.

## Git 기준

- 저장소: `wedding-vendor-disclosure-v2`
- 브랜치: `feat/vendor-disclosure-pipeline-v2-20260718`
- 통합 작업 시작 HEAD: `4d2d60804caea8e9a8c493779a248eaa2575d041`
- 후속 CI 복구 코드 HEAD: `681663a6` (`fix(ci): stabilize Linux mobile and sitemap checks`)
- 현재 공시 변환 코드 HEAD: `f5b35390` (`fix(ingest): recover sparse PDFs on Windows`)
- 통합 Draft PR: [#64](https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/pull/64), base `main`
- 원격 기준: 이 문서를 포함한 최신 브랜치 HEAD를 `origin`에서 fetch한 뒤 사용한다.
- 통합 브랜치는 시작 시점에 `origin/main`보다 23 commits 앞서 있었다.
- 기존 소스 PR: Amora `#61`, WeddingCode `#63`; 통합 브랜치 PR이 최종 검토 단위다.

## 이번 통합에서 닫은 항목

### 아모라

- 기본 모델을 OpenAI Responses API의 `gpt-5.6-luna`(일반·저비용)와
  `gpt-5.6-terra`(계약·반복 수정·고위험)로 고정했다. reasoning은 비용 평가 전까지
  `none`, 출력 상한은 800 tokens다.
- 자해·타해·폭력·성적 강요·응급 표현을 모델보다 먼저 분류한다. 이 경계는 일반
  limiter, 첨부 파싱, durable claim, 비용 예약, provider, tool, memory보다 먼저 실행하고
  109·112·119·1366 고정 안내를 비저장 ephemeral 응답으로 반환한다.
- 자동 갈등 감지·중재 경로도 위기 문장을 provider에 보내지 않는다.
- 웨딩 총예산 계약을 정수 원 단위 `0..1,000,000,000`으로 API·도구·컨텍스트·UI·DB에
  통일했다. 손상된 기존 값은 임의 복구하지 않고 mutation을 fail closed한다.
- 일정 메모에서 폐기된 `booking:<uuid>` 내부 식별자를 웹·모바일·projection 전 경로에서
  공통 sanitizer로 제거했다.
- ActionCard는 잘못된 예산을 그럴듯한 금액으로 표시하지 않으며 정확한 원화 formatter를
  사용한다.

### WeddingCode Candidate 6.3

- 현재 상태는 소비자 점수·유형 검사가 아니라 **M0 인지면접 연구 후보**다. 4글자 코드,
  형용사+동물, 희귀도, 궁합, 자동 일정·예산 적용은 아직 승인되지 않았다.
- 배정은 exact version, form, panel, support order, eligibility snapshot, substitution lineage를
  보존한다. 요약기는 별도 expected assignment manifest와 모든 requested-item row가 없으면
  불완전 원장을 거부한다.
- 로컬 연구 서버는 부모 shell의 API·DB·telemetry·배포 secret을 상속하지 않는다.
  OS 실행에 필요한 키만 allowlist하며 모든 API·앱 라우트·외부 요청·브라우저 저장을 막는다.
- `/api/...png`와 Next image optimizer도 middleware matcher를 우회하지 못한다.
- 생성 연구 route는 nonce 소유권이 일치할 때만 정리하며 stale/malformed lock은 자동 삭제하지
  않고 fail closed한다.

### 업체 공시·가격 조합

- 인증 사용자의 `combos` 직접 `INSERT`/`UPDATE`와 service-role 직접 insert를 제거했다.
  저장은 destination-fenced service client와 `save_price_combo_service_v1` RPC만 사용한다.
- RPC가 정확한 studio/dress/makeup 슬롯, agency null 의미, 단일
  `official_price_id` 옵션 귀속, 서버 재계산 합계, idempotency hash를 재검증한다.
- 소유자 `SELECT`/`DELETE`만 RLS로 남기고 타 사용자 접근은 0 rows다.
- 내부 가격 lookup 수요 이벤트는 best-effort다. 분석 저장 실패가 이미 검증된 공개 가격
  응답을 500으로 바꾸지 않으며 DB weighted limiter가 오염 상한을 별도로 강제한다.

### 공시 원본 재처리

- 읽기 전용 raw 253 files를 새 격리 state에서 다시 scan했다. 249 units의 현재 변환 상태는
  `converted=241`, `needs_manual_conversion=8`, `error=0`이다.
- 초기 수동 큐의 저텍스트 PDF 6 units는 Windows/Poppler 장경로 때문에 성공 exit 뒤 페이지가
  생성되지 않는 문제였다. 짧은 same-volume scratch에서 렌더링·검사한 뒤 content-addressed
  최종 경로로 원자 게시하도록 수정했다.
- 새로 생성된 PDF 8페이지를 직접 확인해 빈 페이지·잘림·회전·식별 불가가 없음을 확인했다.
  raw 253/253 hash가 manifest와 일치하고 conversion artifact 291/291개가 존재한다.
- 남은 8개는 전부 동일 stem PDF 대체본이 없는 전통 OLE HWP다. 이 PC에는 한컴 연결
  프로그램이 없으며 비공식 파서나 온라인 업로드로 성공 처리하지 않았다.
- 수동 변환 대상은 아래 8개 상대경로다. PDF는 각각 HWP와 같은 디렉터리·같은 stem으로
  저장해야 하며 HWP 원본은 삭제하거나 덮어쓰지 않는다.
  - `결혼준비대행서비스/강원도/(강원)_산과바다 베키니아호텔 주문진리조트_결혼준비대행.hwp`
  - `예식장/강원도/(강원)_산과바다 베키니아호텔 주문진리조트_예식장.hwp`
  - `예식장/광주/(광주)_웨딩그룹위더스 광주.hwp`
  - `예식장/대구/(대구)_MH컨벤션.hwp`
  - `예식장/부산/(부산)_목장원((주)푸드웨이).hwp`
  - `결혼준비대행서비스/전라도/(전라도)_모니카블랑.hwp`
  - `결혼준비대행서비스/충청도/(충청도)_오드 스튜디오.hwp`
  - `예식장/서울(강남 외)/[서울(강남 외)]_국방컨벤션센터.hwp`
- 실제 OpenAI·Supabase 호출은 아직 0이다. 로컬 OpenAI key와 별도 non-production staging
  자격증명이 없으며 production 자격증명으로 우회하지 않는다.
- OpenAI key는 채팅·문서·Git에 기록하지 않고 추출을 실행하는 단일 process 환경에만
  주입한다. 첫 유료 실행은 반드시 Luna의 `extract --limit 5`이며 ledger와 원본 대조 후에만
  전체 범위로 확대한다.

### 릴리스 안전장치

- successor manifest는 predecessor와 `20260718120000`~`20260718210000` 19개 migration을
  정규화 SHA-256과 순서로 고정한다.
- CI의 `Production Readiness: BLOCKED (Hosted Evidence Required)`는 의도적으로 실패하는
  sentinel이며 Final Quality Gate도 빨간 상태가 정상이다.
- Vercel production build와 EAS production build/submit은 외부 서명 승인 verifier가 없어서
  각각 fail closed한다. repo JSON·환경변수만으로 우회할 수 없다.

## GitHub·Vercel 후속 검증

- GitHub Actions run `29670451798`에서 Web Quality와 Mobile Quality가 의도하지 않게 실패했다.
- Web Quality는 제품 코드 2,532개 테스트가 통과한 뒤 `sitemap.test.ts` 3개만 실패했다. 원인은
  GitHub의 자동 `CI=true`가 테스트에 누출되어 exact placeholder 분기를 타고 DB mock 조회를
  건너뛴 것이었다. 각 테스트가 `CI`와 Supabase 공개 환경을 명시적으로 소유·복구하도록 고쳤고,
  exact placeholder 전용 회귀 테스트도 추가했다.
- Mobile Quality는 101개 중 `corepack pnpm --version` 검사 하나만 Ubuntu에서 실패했다. Linux는
  `pnpm/action-setup` 또는 EAS profile이 설치한 정확한 pnpm 11.7.0을 직접 사용하고, Windows만
  `.cmd` 실행 제약 때문에 Corepack을 사용하도록 분리했다. provider 실행 직전에도 정확히
  11.7.0인지 다시 확인하며 production EAS 명령의 fail-closed 차단은 그대로다.
- Vercel preview deployment `dpl_H5UsrzunoqSt3Cim2mhTpGSVnamG`의 실제 로그는
  `/price/vendor/[slug]` page-data 수집 중 `Supabase public environment variables are not configured`
  로 실패했다. 이는 승인된 hosted staging과 최소 발행 업체 증거가 없는 preview를 실패시키는
  현재 계약과 일치한다. 운영 Supabase 연결, CI placeholder 주입, 정적 fallback으로 우회하지 않았다.
- GitHub Actions run `29671209112`는 Web Quality, Mobile Quality, Vendor Disclosure Quality,
  Static Release Contracts를 모두 통과해 `681663a6`의 Linux 복구를 원격 검증했다.
- `f5b35390`의 run `29682195263`에서는 Mobile Quality, Vendor Disclosure Quality,
  Static Release Contracts가 통과했다. Web Quality는 296개 파일 중
  `attachmentStorageMigrationIntegration.test.ts`의 첫 PGlite `beforeEach` 하나만 기본 10초
  hook 제한을 넘겨 실패했고, 나머지 2,535개 테스트는 통과했다. 직전 run에서 같은 웹 전체
  스위트가 통과했고 ingest·문서만 바뀐 commit이므로 제품 회귀가 아니라 전체 병렬 부하에서의
  테스트 준비 시간 변동으로 판단했다.
- 해당 보안 검증의 assertion이나 실패 조건은 바꾸지 않고, 저장소의 다른 PGlite migration
  테스트와 동일하게 DB 생성 hook에만 30초 제한을 명시했다. 수정 후 파일 단독 실행을 새
  프로세스로 3회 반복해 매회 3/3 통과했다. push 뒤 새 GitHub 전체 run에서 최종 확인한다.
- Production Readiness sentinel과 final Quality Gate의 red는 계속 의도된 차단이다.

## 최종 로컬 검증

| 검증 | 결과 |
|---|---|
| 웹 전체 Vitest | GitHub와 동일한 `CI=true`에서 `296 files / 2,536 tests PASS` |
| 모바일 Node tests | `96/96 PASS` |
| ingest | `114/114 PASS`, typecheck PASS |
| 실제 공시 변환 재검증 | 249 units, 241 converted, 8 HWP manual, error 0; raw hash 253/253, artifact 291/291 |
| repo release/fail-closed Node tests | PASS |
| Supabase release tests | `165/165 PASS` |
| Supabase static fence | predecessor 27 + successor 19 PASS |
| 전체 workspace typecheck | 4 packages PASS |
| 전체 workspace lint | 0 errors, 0 warnings |
| Next production-shape local build | PASS, 109 static pages |
| Expo web/iOS/Android export | PASS |
| mobile release readiness | `103/103 PASS` |
| Candidate 6 visual QA | 320px·390px, 48px targets, overflow/console/network/persistence failures 0 |
| Candidate 6 security QA | external request 0, inherited telemetry 0, persistence 0, route/lock cleanup PASS |
| production dependency audit | known vulnerability 0 |
| `git diff --check` | PASS |

이 검증은 실제 signed IPA/AAB, 실제 기기 smoke, hosted DB, production provider access 또는
배포 영수증을 대신하지 않는다. 이 PC의 전역 `pnpm`은 9.15.0이므로 저장소 명령은 반드시
`corepack pnpm`으로 실행한다.

## 수용 판정

최종 24개 수용 기준은 보수적으로 `PASS 12 / BLOCKED_EXTERNAL 5 /
NOT_VERIFIED 5 / FAIL 2`다. 상세 근거는
`docs/operations/VENDOR_DISCLOSURE_ACCEPTANCE_MATRIX_2026-07-18.md`를 따른다.

- A1 FAIL: clean hosted DB 전체 migration과 `database.types.ts` 재생성이 없다.
- B10 FAIL: immutable legacy migration의 실제 업체처럼 보이는 역사 데이터에 대해 최종
  스펙 예외 승인이 없다. 과거 migration을 재작성하지 않는다.

## 의도적으로 승인한 스펙 차이

1. 최종 첨부 지시서의 Claude/Anthropic 추출 문구보다 이후 제품 전역 지시인 OpenAI 전환을
   우선했다. ingest와 아모라는 Luna/Terra만 허용한다.
2. 사용자의 combo 직접 쓰기보다 service-only RPC를 사용한다. 이는 더 엄격한 보안 경계다.
3. lookup analytics는 추천 가용성을 위해 best-effort로 둔다. 수요 오염은 별도 원자 limiter가
   제한한다.
4. 통합 전 개별 commit 계보는 보존했지만 과거 작업이 지시서의 20단계 순서로 실행됐다고
   소급 주장하지 않는다.
5. 외부 크롤링과 실제 업체 fixture 추가는 하지 않았다.

## 남은 외부 게이트

1. 전용 non-production Supabase에 clean migration 적용, remote ledger 대조, DB 타입 재생성
2. hosted 두 사용자 RLS·own delete·service RPC·Storage signed download·admin E2E 영수증
3. HWP 8개를 로컬 한컴에서 동일 stem PDF로 저장하고 새 state에서 scan부터 재실행
4. 실제 운영 계정에서 OpenAI Luna/Terra access 확인과 공시 5-unit 파일럿 원본 대조·비용 ledger
5. 대표 승인 데이터로 가격 목록·조합·아모라 추천 브라우저 E2E와 모바일 Lighthouse 90+
6. `pg_cron` 집계 job의 안전한 활성화와 비활성화 rollback 증거
7. 운영 DB backup, 다른 project restore rehearsal, Storage 원본 복구 증거
8. 외부 issuer·signature·expiry·replay·commit/project/migration binding을 검증하는 단기 배포 승인
9. EAS preview/internal iOS·Android 실제 binary와 320/390 실기기 smoke
10. 법적 검토가 필요한 legacy 업체 데이터 예외와 운영 공개 결정

위 항목이 실제 receipt로 채워지고 모든 안전 게이트가 통과하기 전에는 Draft PR을 병합하거나
운영 배포·카나리를 시작하지 않는다.

## 다른 컴퓨터에서 이어가기

```powershell
git fetch --prune origin
git switch feat/vendor-disclosure-pipeline-v2-20260718
git pull --ff-only
corepack pnpm install --frozen-lockfile
corepack pnpm supabase:release:fence
corepack pnpm --filter @hanbang/web typecheck
```

그 다음 GitHub의 통합 Draft PR 설명과 checks를 읽는다. 의도된 production-readiness red
sentinel을 삭제하거나 녹색으로 위장하지 말고, 별도의 실제 기능/보안 CI 실패만 수정한다.
raw 공시 파일과 `scripts/ingest/.state/`는 의도적으로 Git에 올라가지 않으므로 다른 PC에서
파일럿을 계속하려면 승인된 raw 사본을 별도로 전달하고 새 state에서 scan부터 시작한다.
