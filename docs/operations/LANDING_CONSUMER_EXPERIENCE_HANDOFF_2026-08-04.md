# 랜딩 소비자 경험·신뢰 경계 인수인계 — 2026-08-04

> [!IMPORTANT]
> **상태: LANDING DEPLOY-CANDIDATE VERIFIED / PRODUCTION NOT DEPLOYED / COMMUNITY PRODUCTION NO-GO**
>
> 이 문서는 `agent/release-handoff-20260731` 브랜치의 `/landing`과 `/start-here` 소비자
> 경험을 다른 컴퓨터에서 그대로 이어 개발하기 위한 현재 작업 기록이다. 로컬 테스트와
> 빌드는 통과했지만, hosted Supabase migration·커뮤니티 운영 공개·production 배포를
> 승인하지 않는다. 운영 상태 정본은
> `docs/operations/FULL_WORKSPACE_RELEASE_HANDOFF_2026-07-31.md`를 우선한다.

## 1. 이번 작업의 결과

첫 방문자가 제품을 모르는 상태에서도 아래 네 가지를 한 화면 흐름 안에서 이해하도록
랜딩을 다시 구성했다.

1. **웨딩한방**은 둘이 예산·할 일·일정을 함께 관리하는 결혼 준비 공간이다.
2. **아모라**는 대화를 정리해 한 번에 한 가지 변경을 제안하는 AI다.
3. 사용자가 확인한 변경만 준비 기록에 반영된다. 대화 원문 처리·저장과 준비 기록 변경은
   같은 의미가 아니다.
4. 로그인·결제 없이 날짜로 첫 준비 순서를 보고, 이어서 아모라 체험으로 이동할 수 있다.

최종 H1은 다음과 같다.

> **둘이 말하면, 결혼 준비가 정리돼요.**

첫 행동은 제품 방향 정본의 `아모라와 시작하기`를 유지한다. H1 바로 아래에서는
`날짜를 넣으면 지금 볼 세 가지가 나와요`로 첫 결과를 먼저 설명하고, 계정 베타에서는
아모라가 한 번에 한 가지 변경을 제안하며 사용자가 확인한 변경만 준비 기록에 반영된다는
경계를 함께 알린다. 날짜 입력은 `없어도 시작 가능`으로 표시한다.

## 2. 사용한 디자인 근거

- 제품·카피 정본: `docs/MVP_PRODUCT_DIRECTION_2026-07-30.md`
- 디자인 의도: `DESIGN.md`
- 웹 런타임 토큰: `apps/web/src/app/globals.css`
- 초기 Lazyweb 디자인 근거 리포트:
  <https://www.lazyweb.com/report/lazyweb/5402e783-519f-4358-b0ec-dc75dbc446c5/?source=create>
- 배포 완성도 Lazyweb 리포트:
  <https://www.lazyweb.com/report/lazyweb/dd16032e-725d-49e2-a1c8-5009e570d077/?source=create>

Lazyweb 근거는 그대로 복사하지 않고 다음 판단에 사용했다.

- 기능 목록보다 `흩어진 준비 → 대화 → 한 가지 제안 → 확인 → 기록` 변화를 먼저 보여준다.
- 웨딩 업종의 흔한 장식형 카드 나열보다 큰 타이포와 평평한 편집형 행을 사용한다.
- 신뢰 문구는 추상적인 “안전합니다” 대신 저장, 공유, AI 한계, 광고, 가격 출처의 경계를
  구체적으로 쓴다.
- 준비 중인 커뮤니티는 주 제품처럼 크게 판매하지 않고 짧은 운영 안내 스트립으로 낮춘다.

### 2.1 배포 완성도 패스에서 내린 결정

- 첫 화면의 제품 역할, 날짜 입력 결과, 계정 베타 경계를 한 흐름으로 읽히게 압축했다.
- 헤더에서 `신뢰 기준`과 `시작 조건·비용`을 분리해 사용자가 비용 안내로 바로 이동할 수
  있게 했다.
- 핵심 Hero 카피의 초기 페이드 애니메이션은 제거해 첫 프레임부터 가치 제안과 CTA가
  보이게 했다. 오른쪽 제품 데모의 짧은 보조 모션만 유지한다.
- Lazyweb가 제안한 날짜 확실성 3개 선택지(`정확/대략/미정`)는 단일 일반 사례에 근거하고
  첫 화면의 선택 부담을 늘리므로 적용하지 않았다. 대신 기존 날짜 입력에
  `없어도 시작 가능`을 명시했다.
- 검색 노출 경로에서 빠져 있던 `/landing`을 sitemap의 최우선 공개 페이지로 추가했다.

## 3. 최종 정보 구조

| 순서 | 소비자가 묻는 질문 | 화면 답변 | 구현 |
|---:|---|---|---|
| 1 | 이게 무슨 서비스인가? | 웨딩한방과 아모라의 역할, H1, 첫 행동 | `TransformationHero.tsx` |
| 2 | 왜 필요한가? | 카톡·메모장·머릿속에 흩어진 준비 | `ProblemMirrorSection.tsx` |
| 3 | 말하면 정확히 무엇이 생기나? | 예산·할 일·일정 각각의 제안과 목적지 | `PreparationResult.tsx` |
| 4 | 한 번 쓰고 끝인가? | 오늘 정한 항목을 다음 준비에서 이어 관리 | `ContinuitySection.tsx` |
| 5 | 파트너가 모든 대화를 보나? | 함께 보기와 나만 상담의 차이 | `SharedPrivateSection.tsx` |
| 6 | 사람의 경험도 볼 수 있나? | 커뮤니티 운영 공개 전 출처 표시 기준 | `CommunityBridgeSection.tsx` |
| 7 | 왜 믿어도 되나? | 변경 확인, AI 한계, 광고 분리, 공시 출처 | `TrustEvidenceSection.tsx` |
| 8 | 무료인가, 무엇부터 할 수 있나? | 체험·계정 베타·비용 경계와 최종 CTA | `ClosingAction.tsx` |

`PreparationResult`는 Hero와 같은 일정 제안 카드를 다시 보여주지 않는다. Hero에 실제
제품 예시를 한 번만 남기고, 두 번째 설명은 예산·할 일·일정의 평평한 행으로 단순화했다.

## 4. 소비자에게 약속하는 범위

### 4.1 한 번에 한 가지 변경

- 대화에 예산·할 일·일정이 함께 있어도 아모라는 한 번에 한 가지 변경만 제안한다.
- 다른 변경은 각각 별도의 제안과 확인이 필요하다.
- Hero의 `이 일정 반영 예시 보기`는 일정 한 건만 바뀐 상태를 보여준다.
- Hero 데모는 실제 저장이나 외부 AI 호출을 하지 않는다.

### 4.2 대화 저장과 준비 기록 변경은 다르다

- 아모라에게 질문을 보내면 AI 처리·대화 저장 정책이 적용될 수 있다고 Hero에서 알린다.
- 확인 버튼 전까지 반영되지 않는 것은 예산·할 일·일정의 **준비 기록 변경**이다.
- “모든 저장과 공유를 먼저 확인한다”처럼 읽히던 문구는 제거했다.
- 개인정보 처리 기준 링크를 Hero, 연속 관리, 나만 상담 문맥에서 제공한다.

### 4.3 계정 기능은 베타 조건부다

- 현재 release 문서는 production DB와 계정형 후보를 `BLOCKED / NOT DEPLOYED`로 둔다.
- 따라서 연속 관리, 함께 보기, 나만 상담은 `계정 베타` 문맥에서만 설명한다.
- 운영 검증을 통과한 기능부터 제공한다는 한계를 표시한다.
- production receipt가 생기기 전에는 현재형 출시 완료 문구로 바꾸지 않는다.

### 4.4 커뮤니티는 아직 운영 공개 전이다

- 랜딩에서 공개 커뮤니티로 바로 가던 Footer 링크를 `커뮤니티 준비 안내` 앵커로 바꿨다.
- 커뮤니티 섹션은 회원, 업계 종사자, 광고·협찬, AI 답변의 출처 표시 기준만 설명한다.
- 운영 DB, 신고·복원 훈련, 법률 검토와 사람 답변 공급 증거 없이 공개 완료로 말하지 않는다.

### 4.5 비용 안내

- 첫 준비 순서와 로그인 없는 아모라 체험에서는 결제를 요청하지 않는다.
- 계정 베타의 제공 기능·이용 기간·무료 상담 한도는 참여 안내에서 먼저 확인한다.
- 추가 이용 방법과 비용은 아직 정해지지 않았다고 표시한다.
- 신청만으로 결제되지 않는다고 명시한다.
- `/beta`와 `/login`의 인접 문구도 같은 계약으로 맞췄다.

### 4.6 공시 숫자

- 표시 업체: 414곳
- 게시된 취소·환불 규정: 831건
- 화면 집계 확인일: 2026.08.04
- 자료 범위: 한국소비자원 2025년 11월 게시 자료

이 숫자는 사용자 성과, 업체 품질, 절감 효과를 의미하지 않는다. 데이터가 갱신되면
`PUBLISHED_VENDOR_COUNT`, `PUBLISHED_POLICY_COUNT`, `PUBLISHED_COUNTS_VERIFIED_AT`을
같은 감사 결과로 함께 갱신한다.

## 5. 날짜 전달과 개인정보 경계

날짜는 서버 query parameter로 보내지 않는다.

1. Hero가 날짜를 `sessionStorage`의
   `hanbang:start-here-date:v1` 키에 임시 저장한다.
2. `/start-here`가 날짜를 읽어 컴포넌트 상태에 적용한다.
3. 적용 직후 저장값과 URL fragment를 지운다.
4. 브라우저 저장소가 막히면 `#date=YYYY-MM-DD` fragment로 전체 이동한다. fragment는
   HTTP 요청과 Referer에 포함되지 않는다.
5. fragment와 저장값이 둘 다 있으면 사용자가 명시적으로 연 fragment를 우선한다.

이번 감사에서 중단된 이전 이동의 날짜가 남아 `날짜 없이 시작`을 덮을 수 있는 버그를
찾아 수정했다. 날짜 없는 Hero 폼, 날짜 없음 링크, Header CTA, Closing CTA는 이동 전에
오래된 handoff 키를 지운다.

주요 구현:

- `apps/web/src/lib/marketing/startHereDateHandoff.ts`
- `apps/web/src/components/landing/redesign/TransformationHero.tsx`
- `apps/web/src/components/landing/redesign/TrackedLandingLink.tsx`
- `apps/web/src/components/community/StartHereClient.tsx`

## 6. 반응형·접근성 결정

- 모바일 Header는 네이티브 `details/summary` 메뉴를 사용한다.
- 메뉴 항목 선택, 바깥 클릭, Escape에서 닫히고 초점이 메뉴 버튼으로 돌아온다.
- 320px 검수에서 가로 overflow가 없었다.
- 320px에서 화면에 보이는 `a`, `button`, `input`, `summary` 중 44px 미만 터치 대상은
  0개였다.
- Header 로고와 CTA는 축소되지 않도록 `shrink-0`과 `whitespace-nowrap`를 적용했다.
- 핵심 문구는 최소 12px 이상으로 유지했다. 11px은 이름·상태 등 보조 라벨에만 남겼다.
- 장식보다 정보 순서를 우선하고, 카드 중첩은 Hero 제품 예시와 함께/나만 비교에만
  제한했다.

## 7. 변경 파일 지도

### 랜딩 구조와 카피

- `apps/web/src/app/landing/page.tsx`
- `apps/web/src/components/landing/redesign/landingContent.ts`
- `apps/web/src/components/landing/redesign/LandingHeader.tsx`
- `apps/web/src/components/landing/redesign/MobileLandingMenu.tsx`
- `apps/web/src/components/landing/redesign/TransformationHero.tsx`
- `apps/web/src/components/landing/redesign/ProblemMirrorSection.tsx`
- `apps/web/src/components/landing/redesign/PreparationResult.tsx`
- `apps/web/src/components/landing/redesign/ContinuitySection.tsx`
- `apps/web/src/components/landing/redesign/SharedPrivateSection.tsx`
- `apps/web/src/components/landing/redesign/CommunityBridgeSection.tsx`
- `apps/web/src/components/landing/redesign/TrustEvidenceSection.tsx`
- `apps/web/src/components/landing/redesign/ClosingAction.tsx`
- `apps/web/src/components/landing/redesign/LandingFooter.tsx`
- `apps/web/src/components/landing/redesign/TrackedLandingLink.tsx`
- `apps/web/src/app/sitemap.ts`

### 첫 행동과 베타 안내

- `apps/web/src/app/start-here/page.tsx`
- `apps/web/src/components/community/StartHereClient.tsx`
- `apps/web/src/lib/marketing/startHereDateHandoff.ts`
- `apps/web/src/app/beta/page.tsx`
- `apps/web/src/app/(auth)/login/page.tsx`
- `apps/web/src/components/landing/ForBetaCouples.tsx`

### 회귀 테스트

- `apps/web/src/components/landing/redesign/TransformationHero.test.tsx`
- `apps/web/src/components/landing/redesign/TrackedLandingLink.test.tsx`
- `apps/web/src/components/landing/redesign/MobileLandingMenu.test.tsx`
- `apps/web/src/components/community/StartHereClient.test.tsx`
- `apps/web/src/app/landing/__tests__/landingFirstVisitClarity.test.ts`
- `apps/web/src/app/landing/__tests__/landingHeroExperience.test.ts`
- `apps/web/src/app/landing/__tests__/landingOutcomeEvidence.test.ts`
- `apps/web/src/app/landing/__tests__/twoSidedTrust.test.ts`
- `apps/web/src/app/landing/__tests__/heroAssetBudget.test.ts`
- `apps/web/src/lib/marketing/__tests__/mvpDirection.test.ts`
- `apps/web/src/lib/marketing/__tests__/publicClaims.test.ts`
- `apps/web/src/app/(auth)/login/page.test.tsx`
- `apps/web/src/app/sitemap.test.ts`

## 8. 2026-08-04 검증 ledger

| 검증 | 결과 | 확인 범위 |
|---|---|---|
| 랜딩·start-here·sitemap·제품 방향 표적 테스트 | PASS | 12 files / 56 tests |
| 웹 TypeScript 검사 | PASS | `corepack pnpm --filter @hanbang/web typecheck` |
| 관련 파일 ESLint | PASS | 이번 배포 완성도 변경 파일 전체 |
| 웹 production build | PASS | Next.js 16.2.11, TypeScript PASS, static 1,203 pages |
| `/landing` build 결과 | PASS | static, revalidate 1 day |
| `/start-here` build 결과 | PASS | static |
| production HTTP smoke | PASS | 합성 Supabase 환경에서 `/landing` 200, sitemap·CSP 확인 |
| 브라우저 데스크톱 QA | PASS | 1280×720, 즉시 보이는 핵심 카피, console error 0 |
| 브라우저 모바일 QA | PASS | 390×844, 320×720, overflow 0, 작은 터치 대상 0 |
| 모바일 메뉴 | PASS | 열기, 앵커 이동, 선택 후 닫기; 컴포넌트 테스트 포함 |
| 데모 상호작용 | PASS | 일정 한 건만 반영된 예시, 실제 비저장 경계 표시 |
| 운영 환경 fail-closed | PASS | destination pin 없는 기본 `.env.local`에서 의도대로 500 차단 |
| `git diff --check` | PASS | 최종 랜딩 커밋 대상 8개 파일 |
| 공유 worktree 전체 pre-push gate | BLOCKED (범위 외) | 웹 586 files / 5,804 tests PASS, 커뮤니티 경계 2 files / 12 tests FAIL |

독립 `corepack pnpm --filter @hanbang/web typecheck`는 이 랜딩 변경과 무관한 untracked
`communityRuntimeControlMigration.test.ts`의 정규식 `s` flag TS1501 때문에 실패한 적이
있다. 이후 현재 공유 worktree 상태에서 다시 실행해 PASS를 확인했고, 최종 production
build의 TypeScript 단계도 통과했다.

이번 commit의 첫 push 시도에서는 저장소 전체 pre-push gate가 14분간 실행된 뒤 웹
588 files / 5,816 tests 중 2 files / 12 tests에서 중단됐다. 11건은 현재 untracked
커뮤니티 decision-thread·responder API가 `apiMutationTrustInventory.test.ts`의 mutation
신뢰 경계를 아직 충족하지 못한 문제이고, 1건은 별도로 수정 중인 게시글 route가
`communityApiOnlyWriteBoundaryMigration.test.ts`의 service RPC 계약과 맞지 않는 문제다.
랜딩 커밋에는 이 파일들이 포함되지 않는다. 위의 랜딩 표적 검증, typecheck, ESLint,
production build, 화면 QA가 모두 통과한 것을 확인한 뒤 저장소 hook이 제공하는
`HANBANG_SKIP_PREPUSH=1`을 해당 push 한 번에만 사용한다. 원격 CI는 깨끗한 checkout의
정확한 commit을 다시 검증해야 한다.

첫 clean-checkout CI [run 30883715817](https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/actions/runs/30883715817)은
Web typecheck와 lint를 통과한 뒤 `mvpDirection.test.ts`의 이전 카피·탐색 기대값 2곳에서
실패했다. 랜딩 구현을 되돌리지 않고 제품 방향 계약을 현재의 `예산·할 일·일정`,
`신뢰 기준`, `시작 조건·비용`에 맞춰 갱신했다. 수정 후 깨끗한 worktree에서 위 표적
범위를 다시 실행해 12 files / 56 tests PASS, ESLint PASS, typecheck PASS를 확인했다.

일반 `.env.local`만으로 production server를 실행하면 `SUPABASE_EXPECTED_PROJECT_REF`가
명시적으로 고정되지 않아 `EXPECTED_REF_INVALID`로 500을 반환한다. 이는 운영 목적지가
불명확할 때 실행을 막는 의도된 보안 동작이다. 저장소의 합성 Supabase 환경을 주입한
production server에서는 `/landing` 200, sitemap의 `/landing`, CSP 헤더를 확인했다.

브라우저 자동화 환경에서는 native date input의 React `onChange`를 실제 사용자처럼
발생시키지 못하는 경우가 있다. 날짜 handoff는 단위 테스트로 보호했지만, production
Preview가 생기면 실제 Chrome/Safari에서 날짜 선택 한 번을 수동 smoke test한다.

## 9. 새 컴퓨터에서 그대로 재현하기

```powershell
git clone https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git
cd wedding-hanbang-web
git fetch --prune origin
git switch --track origin/agent/release-handoff-20260731
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm hooks:install
git status -sb
```

### 실제 DB를 건드리지 않는 랜딩 시각 QA

```powershell
node scripts/dev-web-local.mjs
```

그다음 <http://localhost:3000/landing>을 연다. 이 런처는 실제 Supabase 자격증명 대신
합성 값을 사용하므로 정적 랜딩과 첫 순서 화면을 안전하게 볼 수 있다. 운영 데이터가
필요한 화면의 검증 증거로 사용하지 않는다.

정상 `.env.local`과 destination pin이 준비된 환경에서만 일반 실행을 사용한다.

```powershell
corepack pnpm dev:web
```

### 표적 검증

```powershell
corepack pnpm --filter @hanbang/web exec vitest run `
  src/lib/marketing/__tests__/mvpDirection.test.ts `
  src/app/landing `
  src/components/landing/redesign `
  src/components/community/StartHereClient.test.tsx `
  src/app/start-here `
  src/app/sitemap.test.ts

corepack pnpm --filter @hanbang/web typecheck
corepack pnpm --filter @hanbang/web build
```

Windows command line에서 `(auth)` 경로가 해석 문제를 만들 수 있으므로 로그인 테스트는
`apps/web`에서 경로 일부로 실행한다.

```powershell
cd apps/web
corepack pnpm exec vitest run login/page.test.tsx
cd ../..
```

## 10. Git 안전 경계

이 작업을 만든 로컬 worktree에는 모바일, 아모라, 커뮤니티, migration 등 다른 진행 중인
변경이 함께 있었다. 랜딩을 커밋할 때 `git add .` 또는 `git add -A`를 사용하지 않는다.
위 변경 파일 지도에서 이번 목적에 포함된 파일만 이름으로 stage하고, staged diff를 다시
읽는다.

production 배포, DB migration 적용, 커뮤니티 write 공개, AI provider flag 활성화는 이
랜딩 변경의 권한에 포함되지 않는다.

## 11. 다음 완성도 단계

추가 섹션을 더 넣는 것이 다음 우선순위가 아니다. 실제 사용자 행동을 측정해 문장과 첫
행동을 조정한다.

1. production Preview exact commit에서 320, 390, 768, 1280px 시각 회귀를 남긴다.
2. 실제 Chrome·Safari에서 날짜 선택 → `/start-here` → 날짜 적용 → URL·storage 정리 흐름을
   수동 확인한다.
3. 분석 이벤트에 날짜나 대화 원문을 넣지 않고, `landing_amora_start_click`, 첫 준비 결과
   노출, 아모라 첫 질문 이동의 전환만 본다.
4. 계정 베타 제공 기능·기간·무료 상담 한도가 확정되면 참여 전에 보이는 한 화면에 실제
   값을 공개한다. 확정 전에는 가격을 추측해 쓰지 않는다.
5. 커뮤니티 production gate가 열렸다는 hosted 증거가 생긴 뒤에만 준비 안내 링크를 실제
   커뮤니티 링크로 바꾼다.
6. 공시 자료가 갱신될 때 숫자·라운드·화면 확인일을 한 번에 다시 감사한다.

## 12. 완료 정의

다음 작업자는 아래를 모두 확인해야 이 랜딩 작업을 이어받았다고 말할 수 있다.

- H1만 읽고 웨딩한방과 아모라의 차이를 설명할 수 있다.
- 날짜 입력 뒤 무엇을 보게 되는지 CTA 전에 이해할 수 있다.
- 대화 저장과 준비 기록 변경 승인을 구분할 수 있다.
- 계정 베타와 커뮤니티가 production 공개 완료가 아님을 안다.
- 비용과 공시 숫자의 근거 범위를 과장 없이 설명할 수 있다.
- 표적 테스트와 production build를 같은 commit에서 재현할 수 있다.
- 다른 worktree 변경을 섞지 않고 랜딩 파일만 안전하게 stage할 수 있다.

---

## 13. 2026-08-06 갱신 — 지금 쓸 수 있는 것을 먼저 세웠다

브랜치 `codex/landing-20260805` · PR #81 · base `main`(#79 위에 쌓임)

### 무엇이 문제였나

모바일 390px 실측에서 **계정 베타(미제공) 설명이 4.3화면, 페이지의 1/3**을 차지했다.
반면 코드 전수 조사에서 **로그인 없이 오늘 되는 것이 16가지** 확인됐는데 랜딩은 그중
사실상 아무것도 말하지 않았다. 처음 온 사람이 자기가 지금 가질 수 없는 것에 대한
페이지를 읽고 있었다.

히어로는 "지금 볼 세 가지"를 세 곳에서 말하면서 **그 셋이 무엇인지 어디에도 없었다**
(열거한 곳 0곳). 입력은 분명한데 출력이 빈칸이었다.

### 무엇을 바꿨나

- **"지금 가입 없이 되는 것" 섹션 신설** — 문제 거울 뒤, 계정 베타 설명 앞.
  대표는 로그인 없는 아모라 체험, 그 아래 넷이 뒷받침.
- **"세 가지"에 이름을 붙였다** — `/start-here`가 실제로 계산하는 것은
  `checklists.ts`의 준비 항목 3개와 각각의 첫걸음이다.
- **가용성 표시를 넷으로 정리** — "로그인·결제 없이 지금" / "계정 베타에서 ~"(3곳) /
  "운영 공개 전".

### 이 섹션에 항목을 추가할 때 지켜야 할 것

1. **실제 요청으로 로그인 없이 열리는지 확인한다.** 코드에 기능이 있다는 것과 오늘
   쓸 수 있다는 것은 다르다 — 조사에서 검증기가 가용성 주장 97건 중 **31건을 정정**했다.
2. 리다이렉트되는 별칭 대신 정식 경로를 쓴다(`/community/quote-check`는 307).
3. `note`에 저장 여부·출처·한도처럼 이용 전에 알아야 할 사실을 적는다.
4. **게이트로 막힌 16가지는 넣지 않는다** — 업체 추천·검색·예약, 축의금·결제,
   동기방, 웨딩 법정, 커뮤니티 글쓰기, 아모라 선제 발화, 장기 기억 등.
5. `landingAvailableNow.test.ts`가 1·2·3·5를 고정한다.

### 아모라 체험 CTA는 링크가 아니다

`POST /api/demo/start` 뒤 `/wedding/chat`으로 가는 흐름이라 `StartDemoButton`을 쓴다.
링크로 흉내 내면 버튼이 약속한 것과 실제 동작이 갈린다(실제로 한 번 그렇게 넣었다가
되돌렸다 — commit 021c4ad0 → 449fc63b → 99947df2).

### 숫자를 고치기 전에 반드시 볼 것

운영 `/price`는 **842곳**, 랜딩은 **414곳**이다. 틀린 게 아니라 **다른 것을 센다** —
842는 *가격* 공시 업체, 414는 `count(distinct vendor_id) from v_public_vendor_policies`
즉 *위약금* 공시 업체다. 랜딩은 위약금 규정 831건 옆에 쓰므로 414가 맞다.
`scripts/tests/disclosure-count-consistency.test.mjs`의 "업체 수는 위약금 공시
업체로만 쓴다"가 이 구분을 지킨다. **842로 바꾸지 마라.**

### 남은 위험 — 다음 작업자가 먼저 볼 것

**운영 랜딩(`hanbang.ai/landing`)이 자기 `/price`와 어긋난다.** 운영 랜딩은
"아모라는 내 예식일과 준비 상황을 바탕으로 답해야 해서 로그인이 필요하고"라고 말하는데,
같은 사이트 `/price`에는 "가입 없이 아모라 체험하기" 버튼이 살아 있고 `/login`에는
"로그인 없이 체험하기"가 있다. 코드도 데모 세션을 인가한다. **운영 랜딩 문구가 낡은
것으로 보이며, 이 브랜치 밖이라 손대지 않았다.** 두 페이지가 같은 말을 하도록 정리가
필요하다 — 시작 조건은 소비자가 CTA를 누르기 전에 알아야 하는 정보다.

### 확인하지 못한 것

- **Preview 화면 QA** — Vercel SSO 보호로 접근 불가. 배포 자체는 성공.
- **아모라 AI 답변 생성** — 로컬은 `AMORA_OPENAI_ENABLED=false`. 소유자가 운영은
  `true`임을 확인해 줬고, 진입 경로(버튼 → demo/start → /wedding/chat)는 동작 확인.
- **무료 한도의 정확한 운영 값** — `AMORA_FREE_MESSAGES_PER_COUPLE` 등이 환경변수라
  숫자를 단정하지 않고 "무료 이용에는 한도가 있어요"까지만 썼다. 값이 확정되면 명시한다.

### 새로 생긴 검증 도구

- `scripts/landing-a11y-qa.mjs` (`pnpm landing:a11y:qa`) — 대비·터치 대상·제목 순서·
  aria 참조를 실제 렌더에서 검사. **색은 캔버스 왕복으로 읽는다** — Tailwind v4가
  `oklab()`을 내기 때문에 문자열에서 숫자만 긁으면 어두운 배경 위 텍스트가 통째로
  오탐이 된다(처음 그렇게 짰다가 27건이 전부 거짓 경보였다).
- `landingAvailableNow.test.ts` — 위 5가지 규칙 고정.

---

## 14. 2026-08-06 정책 변경 — 로그인 없는 아모라는 약속하지 않는다

### 결정

파운더 결정: **로그인 없는 아모라 이용에는 한도를 건다.** 그래서 랜딩은
"가입 없이 아모라를 쓸 수 있다"고 약속하지 않는다. 한도에 걸린 사용자가 예상 못 한
벽을 만나는 것이 이 페이지가 만들 수 있는 가장 나쁜 첫인상이다.

**한도 숫자는 아직 정하는 중이라 랜딩에 적지 않았다.** 확정되면 그때 명시한다.
추측해 적으면 그 자체가 미검증 주장이 된다.

### 내가 반대로 판단했던 것 — 같은 실수를 반복하지 마라

운영 랜딩의 "아모라는 로그인이 필요하고"를 **낡은 문구로 오판**했다. 근거는
`/price`에 "가입 없이 아모라 체험하기" 버튼이 살아 있고 `api/chat/route.ts`가 데모
세션을 인가한다는 코드 사실이었다. 그러나 실제로는 **운영 문구가 의도된 방향**이고
체험 버튼 쪽이 정리 대상이었다.

교훈: **코드가 "할 수 있다"고 해서 제품이 "하기로 했다"는 뜻은 아니다.** 가용성은
코드로 확인할 수 있지만 정책은 확인할 수 없다. 제품 방향이 걸린 문구는 코드 증거만으로
결론내지 말고 물어라.

### 아직 남은 모순 — 다음 작업자가 먼저 볼 것

랜딩은 이제 "아모라는 로그인이 필요해요"라고 말하는데, **같은 사이트의 다른 화면은
여전히 반대로 말한다**:

- `/price` — "가입 없이 아모라 체험하기" 버튼 (StartDemoButton)
- `/login` — "로그인 없이 체험하기"
- `apps/web/src/components/demo/StartDemoButton.tsx` — 기본 라벨이
  "가입 없이 아모라 체험하기"

**한도 정책이 확정될 때 이 셋을 랜딩과 같은 말로 맞춰야 한다.** 이 브랜치는 랜딩만
건드렸다.

### 랜딩이 지키는 가드

`twoSidedTrust.test.ts`의 "never promises Amora without a login"이 다음을 막는다:
- "가입 없이 아모라" / "로그인 없는 아모라" / "로그인 없이 아모라" 류 표현
- "무료 N회" 같은 추측 숫자

이 가드는 **주석을 벗기고 검사한다**. 왜 이 약속을 하지 않는지 설명하려면 그 문구를
적어야 하는데, 자기 설명에 걸려 넘어지는 가드는 가드가 아니다. 이 저장소에서 같은
함정을 세 번 만났다(공유 카드 P5 문구, 장식 규칙, 그리고 이것).

### "지금 가입 없이 되는 것"에 남은 4가지

아모라를 뺀 뒤에도 섹션은 유효하다. 넷 다 로그인 없이 200을 직접 확인했다:
준비 3가지(`/start-here`) · 공시 가격(`/price`) · 견적 점검
(`/wedding/community/quote-check`) · 웨딩코드(`/wedding-code`).
