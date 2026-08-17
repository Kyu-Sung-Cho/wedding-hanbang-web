# 웨딩한방·아모라 개발 인수인계 — 새 LLM은 여기서 시작

> 아모라 제품 개발의 현재 단일 실행 정본은 `docs/AMORA_MASTER_DEVELOPMENT_PLAN.md`다. 아모라 작업은 그 문서의 `NOW`와 `AMR-*` 작업 ID를 먼저 확인하고, 코드·검증·배포·사용자 검증 상태를 갱신한다. 아래 2026-08-12 release handoff와 과거 SHA는 역사·운영 근거이며 현재 제품 우선순위를 대신하지 않는다.

> 상태: **CURRENT NAVIGATION ENTRYPOINT / IMPLEMENTATION INCOMPLETE / PRODUCTION NO-GO**
>
> 저장소: `Kyu-Sung-Cho/wedding-hanbang-web`
>
> 현재 원격 개발 기준: `origin/main` — 실제 tip은 작업 시작 때 직접 조회
>
> 2026-07-31 인수인계 snapshot: PR [#79](https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/pull/79)
> (`agent/release-handoff-20260731`, **현재 개발 기준 아님**)
>
> 2026-08-12 당시 검증된 구현·Preview source SHA: `f8851f749890a172057f2e3a5360d11f3ea1163a` (**현재 기준 아님**)
>
> 원격 후보: `codex/amora-release-hardening-20260811` · Draft PR
> [#105](https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/pull/105)
>
> 2026-08-12 remote release candidate 역사 영수증:
> `docs/operations/AMORA_RELEASE_HARDENING_HANDOFF_2026-08-12.md`
> — **REMOTE RELEASE CANDIDATE / PROTECTED STUB PREVIEW / HOSTED PRODUCTION EVIDENCE MISSING / PRODUCTION NO-GO**

이 문서는 Claude, GPT, Gemini, Copilot 등 특정 모델에 종속되지 않는 냉시작 진입점이다.
현재 사실과 상세 근거를 모두 복제하지 않고, 새 작업자가 무엇을 먼저 확인하고 어떤 문서를
정본으로 읽으며 어디까지 안전하게 시작할 수 있는지를 고정한다.

문서에 적힌 과거 SHA나 snapshot branch를 현재 tip으로 가정하지 않는다. 작업을 시작할 때
`origin/main`과 이어서 작업하라고 명시된 원격 branch를 Git과 GitHub에서 직접 확인한다.

현재 상태는 `docs/AMORA_MASTER_DEVELOPMENT_PLAN.md`, 실제 Git, 테스트, migration manifest가 갱신한다. 2026-08-12 handoff와 아래
2026-08-04~05 진행 절과 P0 목록은 역사 기록이며 현재 작업 목록으로 실행하지 않는다.
후보는 원격 branch·Draft PR·접근 보호된 stub Preview까지 게시됐지만, 실제 코드·테스트와
Git 상태보다 높은 Production 배포 권한은 갖지 않는다.

---

## 1. 60초 결론

### 제품

웨딩한방은 결혼 준비의 고민을 아모라와 처음부터 끝까지 이야기하고, 비슷한 시기에
준비하는 사람들의 기록을 함께 보며, 두 사람이 확인한 것만 예산·체크리스트·일정에
남기는 서비스다. 모바일 앱이 소비자의 주 제품이고, 웹은 유입·설명·정책·고객지원·관리자
운영과 데스크톱 연속성을 담당한다. 아모라가 중심이며 커뮤니티는 실제 경험을 찾고
질문하는 보조 축이다. 아모라의 정본 호칭은 **결혼 준비 동반자**이고, 관계·지식·선제
케어·조건 공유는 별도 축이 아니라 그 안의 층이다.

### 현재 상태

- 많은 웹·모바일·커뮤니티·아모라 baseline 기능과 테스트가 현재 `main`에 구현돼 있다.
- 그 위의 2026-08-12 하드닝 변경은 remote branch와 Draft PR #105로 게시됐다. 검증된 구현
  source SHA는 `f8851f749890a172057f2e3a5360d11f3ea1163a`다.
- 개인정보와 커플 경계를 위한 2,083줄 목표 아키텍처가 문서화돼 있다.
- 목표 아키텍처 전체가 product code, DB, Storage, 모바일 운영 환경에 구현된 것은 아니다.
- 2026-08-12 handoff에 열거된 actor fence, provider grant, server-only ingest, attachment
  cleanup, invite replay, quota 분리, 모바일 Stop·첫 shared 확인·동일 요청 reconciliation,
  위기 안전 분류기, schedule moment source 수정은 remote 후보에 있다. source test와
  hosted·fleet·E2E 검증을 구분하며, 이 문장을 모든 P0/P1 종료로 확대하지 않는다.
- 고정 SHA에서 Web Vitest 646 files·6,519 tests, Mobile 511 tests, safety classifier 410 tests,
  root typecheck/lint/repository contracts, Supabase release contracts와 Web build가 통과했다.
  정확한 명령·범위는 상세 handoff §5를 따른다.
- Vercel Preview는 deployment protection 뒤에서만 접근되고
  `NEXT_PUBLIC_PREVIEW_STUB_MODE=true`가 활성화됐다. `/api/journey`는 503
  `preview_stub_api_disabled`와 `Cache-Control: no-store`로 fail-closed했다. 이는 synthetic
  UI smoke artifact이며 실제 사용자·운영 DB 검증이 아니다.
- Supabase release manifest는 `deployment_blocked`다.
- 현재 GitHub의 Production Readiness job은 hosted 증거를 동적으로 판별하지 않고 항상
  fail-closed한다. hosted 증거 5종 수집 후 workflow/controller 갱신과 exact-SHA
  재실행까지 필요하다.
- `apps/web/vendorDisclosureProductionBuildFence.ts`도 같은 NO-GO를 강제한다. 운영자
  서명이 있어도 manifest가 `deployment_blocked`이면 프로덕션 빌드는
  `VENDOR_DISCLOSURE_RELEASE_CONTROLLER_NOT_READY`로 실패한다.
- hosted 증거를 이번 코드 변경에서 만들거나 완료로 표시하지 않는다.
- 일반 account mutation의 versioned actor header는 mixed-version Phase A라 headerless legacy
  호출을 일부 허용한다. Phase B 강제는 supported fleet drain과 fresh 로그 증거 뒤에만 한다.
- 설치된 구형 모바일의 직접 Supabase 비밀번호 변경 경로와 10자 초대코드 입력 UI는 현재
  server source만으로 없앨 수 없다. minimum supported version·강제 업데이트 또는 fleet 0건
  증거 없이는 관련 migration과 Production을 진행하지 않는다.

### 지금 가능한 일

- 코드 읽기와 정적 감사
- unit test와 PGlite test
- 실제 사용자 정보를 쓰지 않는 synthetic RED test 작성
- 명시적으로 격리된 non-production destination이 별도로 제공된 뒤의 synthetic QA

### 지금 금지된 일

- 현재 branch 전체를 실제 소비자 Production에 배포
- Production Supabase write 또는 migration apply
- Vercel Production alias 승격
- EAS Production build/submit gate 우회
- 실제 사용자 대화·커플 데이터·첨부·기억을 Preview나 fixture에 사용
- Memory, push, media, AI provider 기능을 운영에서 먼저 활성화

---

## 2. SHA를 혼동하지 않는다

| 목적 | SHA 또는 ref | 의미 |
|---|---|---|
| 현재 원격 개발 기준 | `origin/main` | 매 작업 시작 시 fetch 뒤 실제 SHA를 조회하는 유일한 기본 통합 기준 |
| 2026-08-12 검증 구현·Preview source | `f8851f749890a172057f2e3a5360d11f3ea1163a` | 당시 source gate와 최초 보호 stub Preview가 연결된 역사 SHA. 현재 기준 아님 |
| 현재 원격 후보 | `origin/codex/amora-release-hardening-20260811` | Draft PR #105의 head. 문서-only 갱신 뒤에는 실제 tip을 다시 조회 |
| 구현·운영 보안 감사 기준 | `a4f3626e5f98772b340b358b00a562b4692254fd` | P0/P1 코드 경로와 운영 증거를 확인한 source 기준점 |
| 두 핵심 인수인계 문서 최초 게시 | `aaddd8ee23e5c83ac99784eb57b9a57c4c56af73` | 상세 handoff와 목표 아키텍처를 원격에서 처음 복원할 수 있는 commit |
| publication receipt 게시 | `7735a2ec21ee62bf8535b762d768a25369288f08` | 문서 최초 게시와 당시 CI/Preview 상태를 기록한 docs commit |

이 문서를 추가한 commit은 위 기준점보다 새로울 수 있다. 현재 source는 아래 명령 결과가
정본이다.

```powershell
git rev-parse HEAD
git fetch --prune origin
git rev-parse origin/main
git ls-remote origin refs/heads/main
gh api repos/Kyu-Sung-Cho/wedding-hanbang-web --jq .default_branch
```

HEAD가 바뀌면 과거 테스트·Preview·배포 판정을 자동 상속하지 않는다.

---

## 3. 새 컴퓨터에서 가져오기

### 처음 clone할 때

```powershell
git clone https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git
cd wedding-hanbang-web
git fetch --prune origin
git switch main
git pull --ff-only origin main
git status --short --branch
git rev-parse HEAD
git rev-parse origin/main
git branch -vv
corepack enable
node --version
corepack pnpm --version
corepack pnpm install --frozen-lockfile
corepack pnpm hooks:install
```

### branch가 이미 있을 때

```powershell
git status --short --branch
git fetch --prune origin
```

상태 출력에 현재 branch header 외 `M`, `A`, `D`, `R`, `U`, `??` 등 변경이 하나라도 있으면
switch하지 않는다. 변경의 소유자와 의도를 확인해 보존 방법을 정한 뒤 진행한다. working
tree가 clean일 때만 다음을 실행한다.

```powershell
git switch main
git pull --ff-only origin main
git status --short --branch
git rev-parse HEAD
git rev-parse origin/main
git branch -vv
```

dirty 또는 diverged이면 `reset`, `checkout`, `clean`, 강제 push로 상태를 없애지 않는다.
파일 소유자와 의도를 먼저 확인한다.

루트 `package.json`의 현재 일반 작업 기준은 Node `>=22.13.0`, pnpm `11.7.0`이다. Expo
local dev의 실행 정본은 `apps/mobile/scripts/start-expo-dev.mjs`이며 Node `20.19.x`가
필요하다. 설정 설명은 `docs/MOBILE_SETUP.md`도 참고한다.

---

## 4. 반드시 읽을 순서

| 순서 | 문서 | 답하는 질문 |
|---:|---|---|
| 1 | `PRINCIPLES.md` | 어떤 판단도 바꿀 수 없는 신뢰·보안·출시 원칙은 무엇인가 |
| 2 | `AGENTS.md` | 저장소 구조·코딩·검증·운영 작업 규칙은 무엇인가 |
| 3 | `docs/README.md` | 현재 문서와 역사 문서를 어떻게 구분하는가 |
| 4 | `docs/PRODUCT_CONTRACT_PARTNER_2026-08-08.md` | 현재 제품·채널·MVP 우선순위는 무엇인가 (`docs/MVP_PRODUCT_DIRECTION_2026-07-30.md`를 승계) |
| 5 | `docs/AMORA_MASTER_DEVELOPMENT_PLAN.md` | 아이디얼 아모라, 현재 후보, NOW와 단일 active vertical은 무엇인가 |
| 6 | `docs/operations/AMORA_RELEASE_HARDENING_HANDOFF_2026-08-12.md` | 당시 remote 후보에서 무엇을 고쳤고 무엇이 hosted 미검증이었나 |
| 7 | `docs/operations/AMORA_PRIVACY_SECURITY_WORK_PROGRESS_AND_RELEASE_HANDOFF_2026-08-04.md` | 이전 source-status와 목표·공격 모델은 무엇이었나 |
| 8 | `docs/AMORA_ZERO_LEAK_PRIVACY_SECURITY_ARCHITECTURE_2026-08-04.md` | 개인정보·커플 경계의 목표 구조와 절대 출시 게이트는 무엇인가 |
| 9 | 변경할 영역의 실제 코드·테스트·최신 migration | 문서 이후에도 유효한 실제 동작은 무엇인가 |

모바일 내비게이션·화면 계층·아모라·업체 흐름을 바꾸면
`docs/MOBILE_APP_MASTERPLAN_2026-06-30.md`도 먼저 읽는다. 시각·UI를 바꾸면
`DESIGN.md`를 먼저 읽는다.

---

## 5. 환경변수와 데이터 경계

Git에서 복사 기준으로 사용할 파일은 다음 두 개뿐이다.

- `apps/web/.env.example`
- `apps/mobile/.env.example`

실제 secret은 Git, 문서, issue, 채팅, 터미널 출력에 남기지 않는다. Production env를 새
컴퓨터로 복사하지 않는다.

이 인수인계에는 승인된 non-production Supabase project ref나 secret 전달 경로가 기록돼
있지 않다. 따라서 별도 환경이 제공되기 전에는 다음만 실행한다.

- 외부 DB를 사용하지 않는 unit test
- PGlite test
- 정적 계약 검사
- synthetic fixture 기반 테스트

웹·모바일 runtime이나 integration mutation을 시작하려면 먼저 다음을 확인해야 한다.

1. destination이 Production과 다른 명시적 non-production project인지
2. 데이터가 synthetic이고 실제 사용자 원문을 포함하지 않는지
3. Memory, push, media, provider, community write가 server와 DB에서 OFF인지
4. 목적이 끝난 뒤 지울 수 있는 격리 환경인지

현재 컴퓨터에 있던 `apps/web/.env.local`은 Production 감사 대상과 일치한 이력이 있다.
그 파일로 `dev:web`, seed, cleanup, integration mutation을 실행하지 않는다.

---

## 6. 현재 배포 판정

| 표면 | 현재 판정 | 이유 |
|---|---|---|
| GitHub source와 문서 | dirty local candidate · Draft 역사 존재 | 현재 HEAD·diff는 직접 조회하며 `f8851f74`는 2026-08-12 역사 SHA |
| Vercel Preview artifact | READY·접근 보호 | deployment `dpl_AJEzS36JsP35THq85GL2d4WaXB6a`; Production alias 아님 |
| 격리 stub Preview | synthetic QA만 가능 | `NEXT_PUBLIC_PREVIEW_STUB_MODE=true`, Vercel SSO 보호, `/api/journey` 503·no-store 확인 |
| 실제 사용자 데이터가 들어가는 Preview | NO-GO | 현재 artifact는 stub 전용이며 실제 사용자 QA용 destination·동의·기능별 운영 영수증이 없음 |
| Production Web | NO-GO | source gate 통과와 별개로 hosted 증거·fleet·운영 승인 없음 |
| Amora private/shared/direct | NO-GO | source 보강을 hosted DB·fleet·두 기기 E2E로 검증하지 않음 |
| Supabase migration apply | BLOCKED | manifest `deployment_blocked`, hosted 증거 5종 missing |
| Mobile Production build/submit | BLOCKED | release wrapper가 provider 호출 전에 의도적으로 차단 |
| unit/PGlite/synthetic test | 가능 | Production·실사용자 데이터와 분리된 범위 |

`mobile:release-check` PASS는 설정과 fail-closed 차단을 확인한다. 앱스토어 배포 승인이
아니다. `supabase:release:fence` PASS는 manifest와 정적 계약을 확인한다. 운영 DB 적용
증거가 아니다.

현재 Production 차단에는 hosted 증거 5종뿐 아니라 다음 mixed-version·운영 조건도 포함된다.

- provider DB runtime은 disabled이고 hosted grant/canary가 없다.
- generic mutation actor contract는 Phase A다. headerless legacy 허용 경로를 Phase B로 닫을
  fleet drain·fresh traffic attestation이 없다.
- 구형 설치 모바일은 비밀번호를 `/api/auth/password`가 아니라 Supabase Auth SDK로 직접
  변경할 수 있다. current source 수정은 이미 배포된 binary를 회수하지 못한다.
- 새 active invite는 `WH-` + 12자, 총 15자다. 구형 binary의 10자 입력 제한과 migration의
  code rotation이 함께 있으면 구형 앱 사용자가 새 code를 입력할 수 없다.
- 구형 chat direct-writer 0건, backup/restore, Storage contract/finalizer, 두 계정·두 기기,
  TalkBack/VoiceOver 및 실제 기기 QA 증거가 없다.

---

## 7. 역사 기록 — 2026-08-04~05 P0-5 provider egress gate

> **이 절 전체는 2026-08-04~05 역사 기록이다. `P0-5 OPEN`, 당시 branch, SHA, 테스트 수를
> 현재 상태로 사용하지 않는다. 현재 상태는 `docs/AMORA_MASTER_DEVELOPMENT_PLAN.md`와 실제 Git·테스트·migration manifest가 갱신한다.**
> RED 테스트도 SDK gate도 호출부 배선도 이미 존재하므로 같은 작업을 다시 만들지 않는다.

새 기능부터 만들지 않는다. 첫 독립 작업은 AI provider로 원문이 나가기 전에 모든
application privacy gate가 성공해야 한다는 실패 테스트였다.

### 작업 브랜치 경계

2026-08-04 당시에는 `agent/release-handoff-20260731` snapshot에서 이 작업을 시작했다.
그 branch는 현재 통합 기준이 아니며, 새 작업은 fetch한 `origin/main` 또는 사용자가 명시한
최신 원격 branch를 기준으로 한다. HEAD와 working tree가 안전한지 확인한 뒤 작은 하위
branch를 만들고, 첫 변경은 test-only로 제한한다.

```powershell
git status --short --branch
git fetch --prune origin
git switch -c codex/<task-name> origin/main
```

같은 branch 이름이 이미 있으면 현재 작업을 설명하는 고유한 `codex/` 이름을 사용한다.

### 당시 문제 (해소됨 — 아래 진행 상태 참조)

`apps/web/src/lib/ai/openai.ts`는 전체 `systemPrompt`와 `input`을
`client.responses.inputTokens.count()`에 보낸 뒤 `beforeGeneration()`을 실행했다. 생성
요청을 막아도 token-count 요청에서 원문이 먼저 provider로 나갈 수 있었다.

`beforeGeneration()`은 유료 생성 직전의 원자적 quota 예약 게이트다. 개인정보·감사
게이트가 아니며, count보다 뒤에 있으므로 count 자체를 보호할 수 없다. 두 게이트는
역할이 다르므로 하나로 합치지 않는다. **이 분리는 지금도 유효한 설계 규칙이다** —
현재 코드는 `beforeProviderEgress`(개인정보·kill-switch, 모든 provider 요청보다 앞)와
`beforeGeneration`(유료 생성 직전 quota 예약, count 뒤)을 별도로 유지한다.

### 먼저 읽을 파일

- `apps/web/src/lib/ai/openai.ts`
- `apps/web/src/lib/ai/auditedOpenAI.ts`
- `apps/web/src/lib/ai/__tests__/providerEgressGate.test.ts` — SDK 경계 gate 계약
- `apps/web/src/lib/ai/__tests__/providerEgressCallerContract.test.ts` — 호출부 계약
- `apps/web/src/lib/ai/__tests__/openai.test.ts`
- `apps/web/src/lib/ai/__tests__/auditedOpenAI.test.ts`
- 상세 handoff §8의 P0-5
- 목표 아키텍처의 provider all-egress gate 부분

### 첫 RED 계약 (충족됨)

다음 조건을 검증하는 test-only 변경을 먼저 만들라는 지시였고, 네 조건 모두
`providerEgressGate.test.ts`가 고정하고 있다.

1. provider egress gate가 실패하면 `responses.inputTokens.count` 호출은 0회다.
2. 같은 경우 `responses.create` 호출도 0회다.
3. abort, token-limit, count-unavailable, quota reservation의 기존 의미를 조용히 바꾸지
   않는다.
4. 실제 이름·대화 대신 synthetic marker만 쓴다.

`openai.test.ts`의 `count → beforeGeneration → create` 순서 테스트는 삭제하지 않았다.
gate가 통과한 뒤의 순서 계약으로 그대로 유지되고, 그 앞에 egress gate가 추가됐다.
`providerEgressGate.test.ts`에 있던 "gate를 넘기지 않으면 기존 순서가 유지된다" 두
테스트는 gate 필수화에 맞춰 "gate를 넘기지 않으면 provider 요청 0회로 fail-closed"로
바뀌었다. 이유는 그 optional 계약 자체가 P0-5의 구멍이었기 때문이다.

표적 명령:

```powershell
corepack pnpm --filter @hanbang/web exec vitest run `
  src/lib/ai/__tests__/providerEgressGate.test.ts `
  src/lib/ai/__tests__/providerEgressCallerContract.test.ts `
  src/lib/ai/__tests__/openai.test.ts `
  src/lib/ai/__tests__/auditedOpenAI.test.ts
```

2026-08-05 실측: 위 4개 파일 `18 + 15 + 26 + 11 = 70 PASS`.

### 2026-08-05 당시 진행 상태 — P0-5 OPEN 판정 기록

branch `codex/amora-p0-provider-egress-red`에서 여기까지 했다. 아래 1차 기록은 base
`5b33c95b` 기준이고, 2차 기록은 그 위 commit `b31194b9`(= 현재 원격
`origin/codex/amora-p0-provider-egress-red`) 위의 **uncommitted 작업 트리** 기준이다.
숫자는 모두 실제 실행 결과이며, 커밋되지 않은 변경은 그렇게 표시한다.

#### 1차 (commit `b31194b9`까지) — SDK 경계 계약

| 항목 | 상태 |
|---|---|
| RED 테스트 작성 | 완료 — `apps/web/src/lib/ai/__tests__/providerEgressGate.test.ts` |
| 현재 코드에서 RED 재현 | 완료 — 당시 16개 중 13개가 exact invariant mismatch로 실패(당시 기록) |
| SDK 경계의 egress gate 계약 | 구현 — `beforeProviderEgress`가 `inputTokens.count`보다 먼저 실행 |
| 호출부 배선 | 미완 — gate가 optional이라 production 호출부 0곳이 gate를 넘김 |

1차 기록의 `표적 GREEN | 신규 16 + 기존 44 = 60 PASS`는 기존 개수가 틀렸다. 같은 3개
파일을 다시 실행한 실측은 `providerEgressGate 16 + openai.test 26 +
auditedOpenAI.test 11 = 53 PASS`였다. 44/60은 인용하지 않는다.

#### 2차 (commit `df463119`) — 호출부 배선과 gate 필수화

| 항목 | 상태 |
|---|---|
| **egress gate 필수화** | **완료 — optional → required. 타입과 런타임 모두에서 gate 없는 호출은 provider 요청 0회로 fail-closed** |
| **production 호출부 배선** | **완료 — 9개 파일 10곳 전부 gate 통과(아래 목록)** |
| 호출부 계약 회귀 테스트 | 신규 — `apps/web/src/lib/ai/__tests__/providerEgressCallerContract.test.ts`. `src` 전체를 정적 스캔해 gate를 넘기지 않는 호출부가 하나라도 생기면 실패한다 |
| 배선 전 RED 재현 | 완료 — 신규 파일 15개 중 13개 실패(호출부 10 + SDK fail-closed 3) |
| DB claim·capability·kill-switch·TTL·content binding | 미구현 |
| 응답 commit 시 scope/epoch 재검증 | 미구현 |
| moderation·Files·embedding·tool/search 등 나머지 SDK endpoint | 미구현 |
| hosted network sink 증거 | 없음 |
| hosted 두 계정·두 기기 증거 | 없음 |

배선한 wrapper 호출부 10곳(9개 파일)과 각각의 gate. `lib/ai`의 두 라이브러리 모듈은
gate를 인자로 받아 운영 라우트가 주입한다.

| wrapper 호출부 | gate |
|---|---|
| `app/api/chat/route.ts` (tool round) | `assertPrivacyContextStillCurrent` |
| `app/api/chat/route.ts` (final no-tool) | `assertPrivacyContextStillCurrent` |
| `app/api/chat/check-couple-conflict/route.ts` | `assertPrivacyEpochStillCurrent` |
| `app/api/community/ai-comment/route.ts` | `AMORA_COMMUNITY_AI_COMMENT_ENABLED` 재확인 |
| `lib/ai/conflict-detector.ts` | 주입 — 운영 경로는 `check-couple-conflict/route.ts`의 `assertPrivacyEpochStillCurrent` |
| `lib/ai/amoraMemoryCompiler.ts` | 주입 — 운영 경로는 `app/api/cron/amora-memory/route.ts`의 `assertAmoraMemoryProviderBudget` |
| `lib/ai/summarize.ts` | `blockLegacyAuxiliaryProviderGeneration` |
| `lib/ai/extract-decision.ts` | `blockLegacyAuxiliaryProviderGeneration` |
| `lib/ai/classify-excavation.ts` | `blockLegacyAuxiliaryProviderGeneration` |
| `lib/ai/amora-profile.ts` | `blockLegacyAuxiliaryProviderGeneration` |

배선 전 실제로 열려 있던 것: `check-couple-conflict`는 커플 갈등 대화 원문을,
legacy auxiliary 4개 모듈은 **꺼짐 스위치가 토큰 계산 뒤에 던지는 구조**라 "기능이
꺼져 있다"는데도 대화 원문이 `inputTokens.count`로 먼저 나갔다. `chat/route.ts` 2곳만
호출 직전 수동 assert로 보호돼 있었고, 그것은 계약이 아니라 호출 순서 관례였다.

`beforeProviderEgress`는 더 이상 optional이 아니다. 넘기지 않은 호출부는 타입 검사에서
막히고, 런타임에서도 provider 요청 0회로 거부한다. 따라서 **현재 코드의 알려진 호출부
원문 반출 경로는 닫혔다.**

그래도 당시 판정은 **P0-5 OPEN, `AI provider` MUST BE OFF**였다. 이 gate는 아직
in-memory 검사일 뿐이고, 상세 handoff §8 P0-5의 영구 수정이 요구하는 DB current
principal·scope·privacy epoch·retention/provider policy·audit reservation·kill-switch
claim, short TTL, exact content binding, 응답 commit 시 재검증, 나머지 SDK endpoint
통합, hosted 증거가 모두 없다. 이 진행을 P0-5 종료로 인용하지 않는다.

다음 최소 단위는 배선된 gate가 **DB에서** current principal·scope·privacy
epoch·kill-switch를 claim하고 short TTL과 exact content binding을 갖게 만드는 것이다.
상세 handoff §16 카드 E를 따른다.

#### 2차 작업에서 실제로 실행한 검증

| 명령 | 결과 |
|---|---|
| `vitest run` (apps/web 전체) | 591 files / 5,853 tests PASS |
| `tsc --noEmit` (apps/web) | PASS |
| `eslint` (변경 영역) | PASS |
| `node --test scripts/tests/repository-handoff-docs.test.mjs` | 8/8 PASS |
| `supabase:release:test` | 189/189 PASS |
| `supabase:release:fence` | PASS — `deployment_blocked` manifest를 정확히 검증한 성공이며 배포 승인이 아니다 |

hosted Supabase, production DB, Vercel production, EAS는 이 작업에서 건드리지 않았고
증거도 없다. §6 배포 판정은 그대로다.

#### 3차 — gateway 우회 경로 차단

2차까지는 `wrapper를 부르는 호출부가 gate를 넘기는가`를 닫았다. 반대편은 아직 아무도
막지 않았다. wrapper를 **아예 거치지 않고** SDK에 직접 닿는 경로다. `getOpenAIClient()`는
export돼 있고, `new OpenAI(...)`나 `fetch("https://api.openai.com/...")`도 어디서든 쓸 수
있었다. 그렇게 만든 클라이언트 하나면 gate·감사·kill switch를 전부 우회한 채 원문이
나간다.

| 항목 | 상태 |
|---|---|
| 현재 우회 코드 | **0건** — SDK를 실제로 만지는 non-test 파일은 `lib/ai/openai.ts`, `lib/ai/auditedOpenAI.ts` 둘뿐이었다 |
| 우회 차단 회귀 테스트 | 신규 — `apps/web/src/lib/ai/__tests__/providerSdkAccessFence.test.ts` |
| gateway 밖 차단 규칙 | `openai` 패키지 **값** import · `getOpenAIClient` 참조 · `new OpenAI(` · `api.openai.com` 직접 요청 |
| gateway 안 차단 규칙 | Responses 외 SDK 표면(embeddings·moderations·files·chat.completions·beta 등) 사용 금지 — gateway 통합 전까지 fail-closed |
| 스캐너 자기검증 | 합성 위반 10종이 실제로 검출되는지 함께 고정. 타입 전용 import와 브라우저 File API를 오탐하지 않음도 고정 |
| RED 실증 | 실제 우회 파일을 임시로 심어 테스트가 **경로와 규칙 2건을 정확히 지목하며 실패**함을 확인한 뒤 제거 |

이 작업은 런타임 동작을 바꾸지 않는다. 현재 우회 코드가 0건이므로 정적 계약만 추가했다.
막은 것은 `지금 열려 있는 문`이 아니라 `다음에 누군가 열 수 있는 문`이다. 목표
아키텍처가 요구하는 `모든 SDK 접근을 하나의 audited egress gateway 뒤로`는 이제 두 축
모두에서 회귀 테스트가 지킨다.

주의: 나머지 SDK endpoint를 **gateway에 통합한 것이 아니라 사용을 막은 것**이다.
moderation·Files·embedding·tool/search가 실제로 필요해지면 그때 gate 뒤로 통합하고 이
차단 목록에서 빼야 하며, 목록에서 빼는 변경 자체가 리뷰 대상이다.

당시에는 **P0-5 OPEN, `AI provider` MUST BE OFF** 판정을 유지했다. 다음 최소 단위는
배선된 gate가 **DB에서** current principal·scope·privacy epoch·kill-switch를 claim하고
short TTL과 exact content binding을 갖게 만드는 것이다(상세 handoff §16 카드 E).

---

## 8. 역사 기록 — 2026-08-05 당시 이어서 닫을 P0

> 아래 OPEN 표시는 2026-08-05 당시 판정이다. 현재 실행 큐가 아니며, 2026-08-12 handoff와
> 현재 source·tests로 다시 분류하지 않고 그대로 인용하지 않는다.

당시 상세 공격 순서·코드 줄·필수 테스트·종료 영수증은 상세 handoff §8을 따랐다.

1. P0-5: 최종 privacy gate 전 OpenAI token-count 원문 반출 — **OPEN**. SDK 경계 gate가
   필수화됐고 production 호출부 10곳이 모두 배선돼 알려진 원문 반출 경로는 닫혔지만,
   DB claim·TTL·content binding·응답 commit 재검증·나머지 SDK endpoint·hosted 증거가
   없다(§7 진행 상태).
2. P0-4: A의 늦은 Memory 응답이 계정 전환 뒤 B 화면에 적용될 가능성 — **OPEN**.
   client containment는 `codex/amora-p04-memory-actor-20260805`에서 구현했다(기억 화면에
   owner/couple session fence 배선, RED 5개). 실기기 2대 E2E와 background/resume·
   offline retry·screen reader 확인이 없으므로 닫지 않는다. 상세 handoff §8 P0-4의
   2026-08-05 갱신을 본다.
3. P0-3: provenance 없는 임의/private-derived 내용을 shared note로 저장할 가능성
4. P0-1: A의 모바일 개인 초안이 계정 전환 뒤 B bearer로 저장될 가능성
5. P0-2: A가 시작한 공동 승인 명령이 B 승인으로 기록될 가능성

P0-1과 P0-2는 같은 actor-bound command 기반을 공유하므로 test harness를 각각 만든 뒤
command lease와 DB 원자화 설계를 함께 검토한다.

client 화면에서 늦은 응답을 숨기는 것만으로 P0를 닫지 않는다. 각 P0는 필요한 범위에서
다음을 모두 가져야 한다.

- client expected principal/session/scope 검증
- server의 현재 bearer와 command binding 검증
- DB transaction·RLS·epoch 검증
- old-client·retry·offline·account-switch 공격 테스트
- hosted 두 계정·두 기기 evidence
- 원문을 포함하지 않는 release receipt

---

## 9. 검증 명령

변경한 영역의 가장 가까운 테스트부터 시작한다. 전체 명령은 작은 GREEN 뒤에 확장한다.

```powershell
git status --short --branch
git diff --check
node --test scripts/tests/repository-handoff-docs.test.mjs
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test:repo
corepack pnpm mobile:release-check
corepack pnpm supabase:release:test
corepack pnpm supabase:release:fence
```

`supabase:release:fence`가 `deployment_blocked` manifest를 정확히 검증하며 성공할 수 있다.
그 성공을 DB 배포 가능으로 해석하지 않는다. Production audit 스크립트는 exit code만 보지
말고 내부 semantic 결과도 확인해야 하며, 승인된 read-only 범위 밖에서는 실행하지 않는다.

---

## 10. 즉시 중단 조건

다음 중 하나가 발생하면 기능을 더 진행하지 않고 상태와 영향 범위를 먼저 보고한다.

- 예상하지 않은 dirty/untracked 파일 또는 branch divergence
- Production destination 또는 실제 사용자 데이터 가능성
- private marker가 shared/public/provider/log/push에 1건이라도 나타남
- wrong actor, scope, recipient, stale epoch 성공
- DB·migration·Storage digest drift
- feature OFF 또는 kill switch를 증명할 수 없음
- test/build/deploy receipt의 source SHA 불일치
- 기존 사용자 변경을 덮어써야만 진행할 수 있는 상황

---

## 11. 새 LLM에 그대로 전달할 첫 요청

```text
이 저장소의 아모라 개인정보·커플 경계 작업을 이어서 진행해 주세요.

1. START_HERE.md를 처음부터 끝까지 읽으세요.
2. git status --short --branch, git fetch --prune origin, git rev-parse HEAD,
   git rev-parse origin/main을 실행하고 현재 branch upstream·remote branch·PR 존재 여부를
   별도로 확인하세요. dirty worktree를 reset·clean하지 마세요.
3. PRINCIPLES.md, AGENTS.md, docs/README.md,
   docs/operations/AMORA_RELEASE_HARDENING_HANDOFF_2026-08-12.md,
   docs/operations/AMORA_PRIVACY_SECURITY_WORK_PROGRESS_AND_RELEASE_HANDOFF_2026-08-04.md,
   docs/AMORA_ZERO_LEAK_PRIVACY_SECURITY_ARCHITECTURE_2026-08-04.md를 읽으세요.
4. 현재 판정은 Production NO-GO입니다. Production DB write/migration, Vercel Production,
   EAS Production, 실제 사용자 데이터 QA, Memory/push/media/provider 활성화를 하지 마세요.
5. 2026-08-12 remote candidate handoff가 갱신한 actor fence, provider single-use grant, server-only ingest,
   attachment cleanup, invite replay, quota 분리, schedule moment 수직을 먼저 현재 diff와
   대조하세요. §7~8의 2026-08-04~05 OPEN 목록을 현재 작업으로 다시 시작하지 마세요.
6. 모바일 Stop·first shared confirmation·ambiguous ingest reconciliation은 source에
   구현돼 있으므로 같은 기능을 다시 만들지 마세요. 먼저 최신 diff와 회귀 테스트를 대조한
   뒤 고정 snapshot의 full web/mobile, root typecheck/lint/test/build를 실행하세요. source
   test를 hosted·fleet·실기기 증거로 과장하지 마세요.
7. Production 전에 generic headerless Phase-A fleet, 구형 direct Supabase password binary,
   10자 invite UI와 새 15자 code, direct chat writer, provider runtime/canary, hosted 증거 5종을
   각각 별도 gate로 확인하세요. 하나라도 미확인이면 Production NO-GO를 유지하세요.
8. product code를 바꾸기 전에 현재 HEAD, dirty 파일, 확인한 근거, 변경할 파일, 표적 테스트,
   중단 조건을 보고하세요.
9. 완료 보고에는 직접 확인한 사실, 코드 기반 추론, 미확인 외부 증거를 분리하고 실제로
   성공한 테스트만 PASS라고 적으세요.
```

---

## 12. 다음 인수인계 보고 형식

```text
STATUS: DONE | DONE_WITH_CONCERNS | BLOCKED
BRANCH / LOCAL HEAD / UPSTREAM HEAD / REMOTE HEAD:
WORKTREE:
SCOPE:
FILES CHANGED:
DIRECTLY VERIFIED:
CODE-BASED INFERENCES:
TESTS RUN AND EXACT RESULTS:
PRODUCTION OR EXTERNAL STATE NOT VERIFIED:
REMAINING P0/P1:
DEPLOYMENT VERDICT:
NEXT SMALLEST SAFE TASK:
```

테스트 통과, 문서 작성, Preview artifact 생성은 각각 다른 증거다. 실제 소비자가 사용하는
Production 배포는 모든 출시 게이트와 운영 evidence가 닫힌 뒤에만 별도로 판정한다.
