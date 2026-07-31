# CTO 신뢰·웨딩코드 인계 — 2026-07-30

> [!CAUTION]
> **SUPERSEDED FOR CURRENT RELEASE STATUS**
>
> 이 문서는 2026-07-30 당시 신뢰 패치의 인계 기록이다. 현재 작업 트리,
> GitHub/Web/DB/Community/Mobile 상태와 남은 게이트는
> `docs/operations/FULL_WORKSPACE_RELEASE_HANDOFF_2026-07-31.md`를 따른다.
> 제품 방향 정본은 계속 `docs/MVP_PRODUCT_DIRECTION_2026-07-30.md`다.

> [!IMPORTANT]
> **상태: LOCAL PATCH / NOT COMMITTED / NOT PUSHED / NOT DEPLOYED**
>
> Production DB 마이그레이션도 적용하지 않았다. 이 문서는 로컬 작업 트리의 구현과
> 검증 상태를 설명하는 인계 문서이지, 운영 반영 증거가 아니다.

## 1. 기준점과 작업 트리

- 저장소: `hanbang-web`
- 브랜치: `main`
- 작업 시작 기준 HEAD: `0f84665e9b8828f30e5a83ca5854ef618c3f4518`
- 당시 `origin/main`: 위 HEAD와 동일
- 현재 작업 트리: **mixed dirty worktree**

이번 감사 전에 존재한다고 확인한 변경:

- `package.json`
- `scripts/dev-web-local.mjs`
- `scripts/verify-local.mjs`
- `docs/WEDDINGHANBANG_MASTER_BRIEF_2026-07-29.md`
- `scripts/lib/qa-merged-summary.mjs`
- `scripts/qa-merged.mjs`
- `scripts/tests/qa-merged-preflight.test.mjs`

이 파일들은 이번 신뢰 패치와 함께 무심코 stage하면 안 된다. 커밋할 때는
`git add -A`를 사용하지 말고, 변경 목적별로 파일을 직접 지정해 검토한다.

최종 전체 테스트를 준비하는 동안 별도 작업 프로세스가 가격 카탈로그의 병합 업체 지역
필터를 수정했다. 이번 감사에서는 그 변경을 되돌리거나 소유하지 않았다.

- `apps/web/src/components/price/PriceExplorer.tsx`
- `apps/web/src/components/price/PricePresentation.test.tsx`
- `apps/web/src/components/price/PriceVendorCard.tsx`
- `apps/web/src/components/price/PriceVendorCard.test.tsx`
- `apps/web/src/lib/price/catalog.ts`
- `apps/web/src/lib/price/catalog.test.ts`
- `apps/web/src/lib/price/publicListData.ts`
- `apps/web/src/lib/price/publicListData.test.ts`
- `apps/web/src/lib/price/vendorIdentity.ts`
- `apps/web/src/lib/price/__tests__/sameBusinessDifferentName.test.ts`
- `docs/operations/VENDOR_MERGE_REVIEW_2026-07-27.md`
- `docs/operations/evidence/vendor-merge-evidence-2026-07-28.json`

첫 전체 테스트는 이 파일들이 실행 도중 바뀌어 새 테스트와 이전 로직이 섞인 상태로 한 건
실패했다. 별도 작업 종료 후 단독 테스트와 안정된 전체 스위트가 모두 통과했다. 이 가격
변경은 별도 commit 범위로 검토한다.

## 2. CTO 판정

기존 화면은 보기에는 완성돼 보였지만 소비자 신뢰 기준으로 출시 가능한 상태가 아니었다.
특히 아래 결함은 기능 개선이 아니라 출시 차단 사유였다.

1. 공개 커뮤니티에서 AI 페르소나가 사람처럼 활동할 수 있는 DB 구조와 초안이 남아 있었다.
2. 견적 체크가 명시적 동의 없이 결과를 저장하고 업체 리드까지 만들 수 있었다.
3. 견적 결과 URL이 식별자만 알면 공개 조회되는 구조였다.
4. 웨딩코드 답이 query string에 실리고, 민감 경로에서도 분석·세션 수집 여지가 있었다.
5. 견적 체크가 `미포함`을 `이용하지 않음`과 `모름`으로 구분하지 않아 잘못된 경고를 만들었다.
6. 웨딩코드 일부 문항은 결혼 준비 사전 지식을 요구하거나 표현이 모호했다.
7. 점수·유형·궁합이 없어도 “좋은 심리검사”처럼 받아들여질 수 있는 설명 위험이 있었다.

따라서 이번 작업의 목표는 기능 수를 늘리는 것이 아니라 **기만·무동의 저장·과장된 판단을
제거하고, 사용자가 실제로 선택한 내용만 정직하게 돌려주는 것**으로 정했다.

## 3. 웨딩코드 v0.7

### 제품 경계

- 새 기본 버전: `v0.7-plain`
- 문항 수: 16개
- 출력: 사용자가 고른 문장, 두 사람의 차이, 장면별 대화·행동 절차
- 출력하지 않는 것: 성격 유형, 4글자 코드, 동물 유형, 점수, 궁합, 등급, 관계 예측
- 상태: `PUBLIC CONVERSATION TOOL / UNVALIDATED UTILITY`

이 도구는 심리검사가 아니다. 선택한 답을 근거로 두 사람이 무엇부터 확인하면 좋은지
정리하는 대화 도구다. 사람 데이터 없이 “정확한 성향”, “검증된 궁합”, “갈등 예방”을
주장하면 안 된다.

### 문항 기준

- 한 문항은 하나의 구체적인 결혼 준비 장면만 다룬다.
- 금액, 물건, 행동 주체와 시점을 문장 안에 직접 쓴다.
- `스드메`, `폐백`, `셀렉`, `원본`, `보정본`처럼 설명 없는 업계 용어를 쓰지 않는다.
- “전체 비용”, “원하는 느낌”, “무엇이 들어 있는지”처럼 대상을 유추해야 하는 표현을 피한다.
- 겪지 않은 장면은 “지금이라면 고를 답”을 선택하게 한다.
- 모든 선택지는 옳고 그름이 아니라 서로 다른 확인 순서를 나타낸다.

주요 코드:

- `apps/web/src/constants/weddingCodeV07.ts`
- `apps/web/src/constants/__tests__/weddingCodeV07.test.ts`
- `apps/web/src/lib/weddingCode/scene/config.ts`
- `apps/web/src/lib/weddingCode/scene/link.ts`
- `apps/web/src/app/wedding-code/WeddingCodeV06Client.tsx`

컴포넌트 파일명은 호환 범위를 줄이기 위해 유지했지만, 실행 내용은 버전별 config를 받는다.

### 버전과 공유 링크

- 새 링크: `/wedding-code#v=v0.7-plain&a=...&b=...`
- fragment의 답 코드는 일반 HTTP 요청·referrer에 포함되지 않는다.
- 새 진입에서 버전이 없으면 `v0.7-plain`을 사용한다.
- 과거 답 링크에 버전이 없으면 호환을 위해 `v0.6-scene`으로만 해석한다.
- 알 수 없는 버전을 최신 버전으로 추정하지 않고 거부한다.
- 과거 `?a=`·`?b=` 링크는 읽은 뒤 fragment 링크로 바꾼다.
- 경로 metadata는 `noindex`, `nofollow`, `no-referrer`다.

답은 DB나 브라우저 저장소에 저장하지 않는다. 다만 링크 자체를 받은 사람은 답을 볼 수
있으므로 화면에서 함께 볼 사람에게만 보내라고 알린다.

### 결과 개선

- 선택 즉시 자동으로 다음 문항으로 넘기지 않고 `다음 문항`을 눌러 확정한다.
- 개인 결과는 실제 선택 문장을 인용한다.
- 두 사람 결과는 일치율이나 궁합 점수 대신, 다른 답을 고른 장면별로 주의점과 실행 절차를
  제공한다.
- 대표 차이 세 개를 먼저 보여주고 전체 차이를 펼쳐 볼 수 있다.
- 남녀·신랑·신부 역할을 추정하지 않고 먼저 답한 사람과 나중에 답한 사람으로 표시한다.

## 4. 견적 체크 신뢰 재설계

### 데이터 경계

`POST /api/amora/quote-check`는 현재 다음 원칙으로 바뀌었다.

- 인증 여부와 관계없이 결과를 DB에 저장하지 않는다.
- 업체 리드·조회 수·통계 row를 만들거나 증가시키지 않는다.
- 공개 결과 링크를 만들지 않는다.
- 응답에 `storageStatus: "not_stored"`를 반환한다.
- 과거 저장 플래그가 요청에 들어와도 무시한다.
- `/api/amora/quote-check/[id]/public`은 항상 `410 Gone`이다.
- `/quote/[id]`는 과거 공개 결과 종료 안내와 `noindex`만 제공한다.

### 소비자 입력 모델

각 항목은 두 상태가 아니라 세 상태다.

- `포함`: 견적서에 포함이라고 명확히 적혀 있음
- `이용 안 함`: 사용자가 해당 상품·서비스를 이용하지 않음
- `확인 필요`: 포함 여부가 없거나 문구가 불명확함

아무것도 선택하지 않은 항목은 `확인 필요`다. `이용 안 함`을 누락이나 위험으로 세지 않는다.
결과는 가격이 싸다·비싸다를 판정하지 않고, 계약 전에 업체에 서면으로 확인할 질문을 만든다.

주요 코드:

- `apps/web/src/app/(community)/community/quote-check/page.tsx`
- `apps/web/src/app/api/amora/quote-check/route.ts`
- `apps/web/src/lib/amora/quoteCheck.ts`
- `apps/web/src/constants/hiddenCosts.ts`
- `apps/web/src/components/app/chat/QuoteAnalysisCard.tsx`
- `apps/web/src/lib/ai/tools/quoteMarketTools.ts`

독립 화면과 아모라 도구가 같은 세 상태 계약을 사용하도록 맞췄다. 화면에서는 가격을 받지
않는다. 기존 엔진에서 그 금액을 실질적으로 판단하지 않았기 때문이다.

### 운영 데이터 정리 마이그레이션

`supabase/migrations/20260730101000_quote_check_explicit_consent.sql`은 다음을 수행한다.

- 향후 저장 기능을 위한 명시적 동의 필드를 추가한다.
- 기존 견적 row를 통계 대상에서 격리한다.
- 조사용 row는 동의 없이는 허용하지 않는다.
- 과거 자동 생성된 `amora-quote:` 업체 리드를 거부·정리한다.

기존 리드가 다른 출처의 기존 row에 합쳐진 경우는 자동으로 안전하게 되돌릴 수 없다.
운영 DB에서 read-only 감사 후 사람이 판정해야 한다.

## 5. 공개 AI 페르소나 차단

`supabase/migrations/20260730100000_retire_undisclosed_community_agents.sql`은 다음을 수행한다.

- 등록 AI 페르소나를 retired 상태로 바꾼다.
- 자동 발행을 끄고 초안을 보관 처리한다.
- AI 작성 게시물을 draft·unpinned로 바꾼다.
- AI 댓글·투표·동기방 메시지를 제거한다.
- 관련 카운터를 다시 계산한다.
- 프로필 이름에 `AI 콘텐츠(중단)`을 표시한다.
- retired agent가 다시 공개 활동을 시도하면 DB trigger가 거부한다.
- 실행 권한은 service role로 제한한다.

앱 코드와 cron 경로를 전수 검색한 결과, 현재 저장소에는 이 페르소나를 실제로 실행하는
공개 runner가 발견되지 않았다. 그래도 운영 DB 상태는 마이그레이션 적용 전까지 바뀌지 않는다.

## 6. 개인정보와 공개 주장

- `/wedding-code`와 내부 웨딩코드 연구 경로는 제품 분석 수집에서 제외한다.
- PostHog 자동 수집과 세션 녹화를 끈다.
- 지연 전송 이벤트도 URL이나 referrer가 민감 경로면 버린다.
- 견적 체크 이벤트에는 분야, 항목, 금액 속성을 넣지 않는다.
- 개인정보처리방침은 미출시 결제·예약 기능을 현재 수집 기능처럼 말하지 않도록 고쳤다.
- 랜딩의 `숨은 비용`, `예상 추가금`처럼 실제 계약을 보지 않고 확정할 수 없는 표현을
  `별도 금액`과 `계약 전 확인`으로 바꿨다.
- 공개 문구 회귀 테스트가 과장 표현의 재도입을 막는다.

## 7. 화면 실측

로컬 `http://localhost:3000`에서 다음을 확인했다.

- 웨딩코드 시작, 첫 문항, 개인 결과, 파트너 링크 진입
- 새 공유 URL에 query가 없고 fragment만 있는지
- 과거 query 링크가 fragment로 바뀌는지
- 견적 체크 12개 항목과 세 상태 입력
- 데스크톱 화면 정렬
- 375×844 모바일 웨딩코드 시작·첫 문항
- 375×844 모바일 견적 체크

모바일 실측 중 발견하고 고친 결함:

- 고정 아모라 상담 버튼이 견적 체크의 `확인 필요`를 가리던 문제
- `정리 0/12` 진행 표시가 세로로 찢어지던 문제

견적 결과 API의 실제 브라우저 호출은 로컬 환경의 지속형 rate limiter가
`요청 제한 확인에 실패했습니다`를 반환해 끝까지 확인하지 못했다. 계산 엔진과 API 계약은
자동 테스트로 검증했지만, hosted clone에서는 실제 요청을 다시 확인해야 한다.

## 8. 검증 증거

확인 완료:

- 웨딩코드·분석 개인정보·견적 엔진/API·AI 도구·공개 문구·두 DB 마이그레이션 대상 테스트:
  15 files, 112 tests 통과
- 모바일 가림 회귀와 견적 계산 추가 확인: 2 files, 17 tests 통과
- 저장소 인계 문서 테스트: 2 tests 통과
- `corepack pnpm supabase:release:test`: 183 tests 통과
- `corepack pnpm --filter @hanbang/web typecheck`: 통과
- `corepack pnpm --filter @hanbang/web lint`: 오류 0, 기존 관련 없는 경고 6
- `corepack pnpm --filter @hanbang/web exec vitest run --reporter=dot`:
  **356 files, 3,072 tests 전부 통과**
- 마지막 전체 테스트 전후 `git diff --binary` 해시가
  `89df5fb27d33ea693f33aafee9e16c3ecb4439b9`로 같아 실행 중 tracked 변경이 없었음을 확인했다.

두 새 migration은
`supabase/release-manifests/vendor-disclosure-v2-20260718.json`에 정규화된 SHA-256과 순서가
고정됐다. manifest의 `status`는 여전히 `deployment_blocked`이고 운영 증거 5종도 모두
`missing`이다.

아직 하지 않은 것:

- production build
- release manifest 운영 증거 5종 수집과 승인 상태 전환
- hosted clone 마이그레이션
- production DB backup·apply·사후 probe
- Vercel production 배포
- 운영 URL smoke test

## 9. 안전한 릴리스 순서

1. `git diff`를 파일별로 검토하고 이번 패치와 기존 변경을 분리한다.
2. 두 migration의 manifest 해시·순서를 다시 검증하고 의도한 commit에만 묶는다.
3. 운영 DB와 필요한 Storage 원본을 백업하고 복구 가능성을 확인한다.
4. hosted clone 또는 staging에 manifest를 적용한다.
5. retired agent, 과거 quote row, 자동 vendor lead의 postcondition을 read-only로 확인한다.
6. DB 마이그레이션을 먼저 운영에 적용한다.
7. 그 뒤 웹 앱을 배포한다.
8. `/wedding-code`, 견적 체크, 410 공개 route, analytics 차단을 운영 URL에서 확인한다.
9. 이상이 있으면 새 release로 복구하며, 과거 정책을 추정해 자동 복원하지 않는다.

`supabase db push`를 직접 실행하면 안 된다. 저장소의 manifest/controller 경로만 사용한다.

## 10. 아직 “완벽”이라고 말할 수 없는 이유

자동 테스트는 코드 계약을 검증할 뿐, 사람이 문항을 똑같이 이해하는지나 실제 대화에 도움이
되는지를 증명하지 않는다. 다음은 여전히 `UNVALIDATED`다.

- 중학생 수준의 사용자가 16문항을 추가 설명 없이 이해하는지
- 각 선택지에 자신의 생각이 없어서 억지로 고르는 사람이 얼마나 되는지
- 커플 결과가 비난·성 역할 고정·상대 도구화 없이 실제 대화를 돕는지
- 견적 항목의 우선순위와 질문 문구가 업체 유형별 계약 현실에 맞는지
- 개인정보·소비자보호 문구가 법률 검토를 통과하는지

현재 상태는 “사람 데이터 없이 할 수 있는 최대한의 정적 안전화”다. 검증된 심리검사나
검증된 소비자 효용으로 부르면 안 된다.

## 11. 다음 CTO 우선순위

1. 이 신뢰 패치를 위 릴리스 게이트로 운영 반영한다.
2. 결혼 준비 경험이 적은 5~8명을 대상으로 16문항 인지면접을 한다.
3. 실제 커플 최소 3쌍으로 결과 대화의 이해도·비난 가능성·실행 가능성을 관찰한다.
4. 견적 체크 항목은 계약서·업체 공시 원문과 대조해 분야별 우선순위를 다시 검증한다.
5. 저장 기능이 필요해질 때만 명시적 동의, 비공개 내역, 삭제 기능을 한 묶음으로 설계한다.
6. 웨딩코드는 심리 “정확도”가 아니라 문항 이해율과 대화 행동 완료율로 평가한다.

## 12. 같은 날 확정된 웹 MVP 방향

이 문서의 11절까지는 소비자 신뢰 패치 관점의 우선순위다. 이후 제품 피드백을 반영해
웹 MVP의 제품 범위와 화면 위계를 다음처럼 더 좁혔다. 이 결정이 기능 확장 판단에서는
11절보다 우선한다.

**웨딩한방은 아모라에게 결혼 준비를 말하면, 예산·체크리스트·일정이 함께 정리되는
서비스입니다.**

- 아모라가 제품이다.
- 예산·체크리스트·일정은 아모라의 대화 결과가 남는 실행 화면이다.
- 커뮤니티는 AI가 직접 겪을 수 없는 실제 경험을 찾고 질문하는 보조 축이다.
- 주요 내비게이션은 `아모라 | 할 일·일정 | 예산 | 커뮤니티`로 고정한다.
- 로그인 후 `오늘 할 일`은 요약 홈으로 유지한다.
- 업체·예약·축의금·공시가격 독립 제품화·WeddingCode·견적 체크 독립 제품화·모바일
  출시는 삭제하지 않지만 MVP 전면에서 내린다.

정본은 `docs/MVP_PRODUCT_DIRECTION_2026-07-30.md`다.

이번 로컬 변경에서 `/landing`, `/wedding`, 공개/로그인 내비게이션, 메타데이터와
회귀 테스트를 위 계약에 맞췄다. 아직 commit, push, production build, DB 적용,
배포는 하지 않았다.

다음 CTO 제품 우선순위는 새 기능 추가가 아니다.

1. 아모라가 한 대화에서 예산·체크리스트·일정 중 하나를 실제로 끝까지 반영하는 흐름을
   실패·승인·재시도까지 전수 검사한다.
2. 첫 사용자 5~8명에게 한 줄 설명만 보여주고 무엇을 하는 서비스인지 그대로 말해보게 한다.
3. 가입 후 첫 세션에 `예식일 입력 → 제안 확인 → 하나 승인 → 도구 반영`이 끝나는지 측정한다.
4. 이 핵심 흐름이 안정적으로 반복되기 전에는 새 독립 메뉴와 새 제품 축을 추가하지 않는다.

### MVP 방향 변경 검증

- `/landing`과 `/wedding`을 각각 1440×900, 375×844에서 확인했다.
- 두 화면 모두 첫 제목과 설명이 아모라 중심 한 줄 정의를 그대로 전달한다.
- 모바일·데스크톱 모두 가로 넘침이 없었다.
- `/landing` 모바일 메뉴에서 `아모라 | 할 일·일정 | 예산 | 커뮤니티`가 실제로 열린다.
- 히어로 아래에 다음 아모라 실행 영역의 시작이 첫 viewport 안에 보인다.
- `/wedding`의 아모라 설명 아래에서 체크리스트·예산·일정이 연속된 실행 행으로 보이고,
  그다음에 커뮤니티 탐색이 나온다.
- 제품 방향·공개 주장·랜딩 신뢰·미리보기·업체 경계 표적 테스트:
  **7 files, 32 tests 통과**
- 전체 웹 테스트는 단일 실행이 10분 제한을 넘어 요약 없이 종료되어 완료로 세지 않았다.
  동일한 전체 `src` 범위를 중복 없이 나눠 실행한 결과:
  - `src/lib`: 230 files, 2,077 tests 통과
  - `src/app`: 79 files, 577 tests 통과
  - `src/components`, `src/utils`, `src/constants`, `src/stores`, `src/hooks`,
    `src/proxy.test.ts`: 57 files, 453 tests 통과
  - 합계: **366 files, 3,107 tests 통과**
- 분할 실행 중 첫 방문 안내에 로그인 필요·무료 고지가 빠진 회귀 1건을 발견해 고쳤고,
  해당 57 files, 453 tests 묶음을 다시 전부 통과시켰다.
- `corepack pnpm --filter @hanbang/web typecheck`: 통과
- `corepack pnpm --filter @hanbang/web lint`: 오류 0, 기존 관련 없는 경고 5
- 마지막 랜딩·히어로·메타데이터 정렬 뒤 표적 테스트, typecheck, 변경 파일 scoped lint를
  다시 통과시켰다.
- 로컬 시각 검증은 실제 운영 DB에 연결하지 않는 preview stub 모드로 했다.

이 MVP 방향 변경도 아직 commit, push, production build, DB 적용, 배포하지 않았다.

## 13. 같은 날 이어진 저장소 전체 감사

정본 감사 기록은
`docs/operations/FULL_REPOSITORY_AUDIT_2026-07-30.md`다. 이번 추가 감사에서는
파일 목록과 변경 상태를 전수 수집하고, 활성 웹·모바일·문서의 제품 주장과 신뢰 경계를
검색한 뒤 위험도가 높은 실행 코드를 직접 검토했다. 모든 줄을 같은 깊이로 사람이 읽은
것처럼 과장하지 않는다.

추가로 고친 핵심 문제:

- `/api/auth/me`의 `select("*")`를 명시적 최소 컬럼으로 바꿔 전화번호·push token·
  초대 코드와 미래 컬럼의 우발 노출을 막았다.
- 설정 UI의 하객 수·준비 우선순위·`원하는 결과 우선`이 아모라 프롬프트에서 다른
  의미로 바뀌거나 내부 키로 새던 문제를 고쳤다.
- 현재 MVP 밖의 업체·예약·주변 장소 도구를 모델 provider 도구 목록에서 차단했다.
- 구현되지 않은 고객지원 URL, 미래 제공 약속, 추천 개선 약속, 전역 quota 재개 약속을
  실제 동작과 맞는 문구로 바꿨다.
- 모바일 cohort의 죽은 탭과 실패/빈 상태 혼동을 없앴다.
- 출시되지 않은 돌봄 알림은 신규 opt-in을 제거하고 과거 동의 철회만 남겼다.
- 채팅 평가 localStorage에 schema·크기·키 안전성 검증을 추가했다.
- 문서 권한 인덱스를 만들고 오래된 감사·데모·백로그·세션 기록에 현재 지시가 아니라는
  경고를 붙였다.

이 추가 변경 역시 아직 commit, push, DB 적용, production 배포하지 않았다. 최신
검증 결과와 남은 차단 조건은 전체 감사 문서에서만 갱신한다.
