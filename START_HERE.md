# 웨딩한방·아모라 개발 인수인계 — 새 LLM은 여기서 시작

> 상태: **CURRENT NAVIGATION ENTRYPOINT / IMPLEMENTATION INCOMPLETE / PRODUCTION NO-GO**
>
> 저장소: `Kyu-Sung-Cho/wedding-hanbang-web`
>
> 감사·인수인계 기준 integration branch: `agent/release-handoff-20260731`
>
> PR: [#79](https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/pull/79)
>
> 이 문서가 확인한 publication receipt 기준점: `7735a2ec21ee62bf8535b762d768a25369288f08`

이 문서는 Claude, GPT, Gemini, Copilot 등 특정 모델에 종속되지 않는 냉시작 진입점이다.
현재 사실과 상세 근거를 모두 복제하지 않고, 새 작업자가 무엇을 먼저 확인하고 어떤 문서를
정본으로 읽으며 어디까지 안전하게 시작할 수 있는지를 고정한다.

문서에 적힌 SHA를 현재 branch tip으로 가정하지 않는다. 작업을 시작할 때 Git과 GitHub를
직접 확인한다.

---

## 1. 60초 결론

### 제품

웨딩한방은 아모라에게 결혼 준비를 말하면 예산·체크리스트·일정이 함께 정리되는
서비스다. 모바일 앱이 소비자의 주 제품이고, 웹은 유입·설명·정책·고객지원·관리자 운영과
데스크톱 연속성을 담당한다. 아모라가 중심이며 커뮤니티는 실제 경험을 찾고 질문하는 보조
축이다.

### 현재 상태

- 많은 웹·모바일·커뮤니티·아모라 기능과 테스트가 branch에 구현돼 있다.
- 개인정보와 커플 경계를 위한 2,083줄 목표 아키텍처가 문서화돼 있다.
- 목표 아키텍처 전체가 product code, DB, Storage, 모바일 운영 환경에 구현된 것은 아니다.
- 정적 코드 감사에서 P0 실패 가능 경로 5개가 열려 있다. 실제 사고가 확인됐다는 뜻은
  아니지만, 자동 RED 테스트와 수정·hosted 증거가 없으므로 출시 차단 사항이다.
- Supabase release manifest는 `deployment_blocked`다.
- 현재 GitHub의 Production Readiness job은 hosted 증거를 동적으로 판별하지 않고 항상
  fail-closed한다. hosted 증거 5종 수집 후 workflow/controller 갱신과 exact-SHA
  재실행까지 필요하다.

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

| 목적 | SHA | 의미 |
|---|---|---|
| 구현·운영 보안 감사 기준 | `a4f3626e5f98772b340b358b00a562b4692254fd` | P0/P1 코드 경로와 운영 증거를 확인한 source 기준점 |
| 두 핵심 인수인계 문서 최초 게시 | `aaddd8ee23e5c83ac99784eb57b9a57c4c56af73` | 상세 handoff와 목표 아키텍처를 원격에서 처음 복원할 수 있는 commit |
| publication receipt 게시 | `7735a2ec21ee62bf8535b762d768a25369288f08` | 문서 최초 게시와 당시 CI/Preview 상태를 기록한 docs commit |

이 문서를 추가한 commit은 위 기준점보다 새로울 수 있다. 현재 source는 아래 명령 결과가
정본이다.

```powershell
git rev-parse HEAD
git rev-parse '@{u}'
git ls-remote origin refs/heads/agent/release-handoff-20260731
gh pr view 79 --json headRefOid,state,isDraft,mergeStateStatus,reviewDecision,url
```

HEAD가 바뀌면 과거 테스트·Preview·배포 판정을 자동 상속하지 않는다.

---

## 3. 새 컴퓨터에서 가져오기

### 처음 clone할 때

```powershell
git clone https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git
cd wedding-hanbang-web
git fetch --prune origin
git switch --track origin/agent/release-handoff-20260731
git status --short --branch
git rev-parse HEAD
git rev-parse '@{u}'
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
git switch agent/release-handoff-20260731
git status --short --branch
git rev-parse HEAD
git rev-parse '@{u}'
git branch -vv
```

working tree가 clean이고 단순히 upstream보다 뒤처진 경우에만 다음을 실행한다.

```powershell
git pull --ff-only
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
| 4 | `docs/MVP_PRODUCT_DIRECTION_2026-07-30.md` | 현재 제품·채널·MVP 우선순위는 무엇인가 |
| 5 | `docs/operations/AMORA_PRIVACY_SECURITY_WORK_PROGRESS_AND_RELEASE_HANDOFF_2026-08-04.md` | 무엇이 구현됐고 왜 Production NO-GO이며 다음 작업은 무엇인가 |
| 6 | `docs/AMORA_ZERO_LEAK_PRIVACY_SECURITY_ARCHITECTURE_2026-08-04.md` | 개인정보·커플 경계의 목표 구조와 절대 출시 게이트는 무엇인가 |
| 7 | 변경할 영역의 실제 코드·테스트·최신 migration | 문서 이후에도 유효한 실제 동작은 무엇인가 |

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
| GitHub source와 문서 | 게시됨 | branch·상세 handoff·목표 아키텍처가 원격에 존재 |
| Vercel Preview artifact | 빌드 가능 | Preview 성공은 Production 안전 증거가 아님 |
| 실제 사용자 데이터가 들어가는 Preview | NO-GO | 접근 보호·non-production destination·기능 OFF 영수증이 없음 |
| Production Web | NO-GO | P0/P1, review, hosted 증거가 닫히지 않음 |
| Amora private/shared/direct | NO-GO | actor·scope·provider egress 경계 P0가 열려 있음 |
| Supabase migration apply | BLOCKED | manifest `deployment_blocked`, hosted 증거 5종 missing |
| Mobile Production build/submit | BLOCKED | release wrapper가 provider 호출 전에 의도적으로 차단 |
| unit/PGlite/synthetic test | 가능 | Production·실사용자 데이터와 분리된 범위 |

`mobile:release-check` PASS는 설정과 fail-closed 차단을 확인한다. 앱스토어 배포 승인이
아니다. `supabase:release:fence` PASS는 manifest와 정적 계약을 확인한다. 운영 DB 적용
증거가 아니다.

---

## 7. 가장 안전한 첫 작업: P0-5 RED test-only

새 기능부터 만들지 않는다. 첫 독립 작업은 AI provider로 원문이 나가기 전에 모든
application privacy gate가 성공해야 한다는 실패 테스트다.

### 작업 브랜치 경계

`agent/release-handoff-20260731`는 감사·인수인계 기준 integration branch다. 이 branch에서
product code를 직접 고치지 않는다. HEAD와 working tree가 안전한지 확인한 뒤 작은 하위
branch를 만들고, 첫 변경은 test-only로 제한한다.

```powershell
git status --short --branch
git switch -c codex/amora-p0-provider-egress-red
```

같은 branch 이름이 이미 있으면 현재 작업을 설명하는 고유한 `codex/` 이름을 사용한다.

### 현재 문제

`apps/web/src/lib/ai/openai.ts`는 현재 전체 `systemPrompt`와 `input`을
`client.responses.inputTokens.count()`에 보낸 뒤 `beforeGeneration()`을 실행한다. 생성
요청을 막아도 token-count 요청에서 원문이 먼저 provider로 나갈 수 있다.

### 먼저 읽을 파일

- `apps/web/src/lib/ai/openai.ts`
- `apps/web/src/lib/ai/auditedOpenAI.ts`
- `apps/web/src/lib/ai/__tests__/openai.test.ts`
- `apps/web/src/lib/ai/__tests__/auditedOpenAI.test.ts`
- 상세 handoff §8의 P0-5
- 목표 아키텍처의 provider all-egress gate 부분

### 첫 RED 계약

다음 조건을 검증하는 test-only 변경을 먼저 만든다.

1. provider egress gate가 실패하면 `responses.inputTokens.count` 호출은 0회다.
2. 같은 경우 `responses.create` 호출도 0회다.
3. abort, token-limit, count-unavailable, quota reservation의 기존 의미를 조용히 바꾸지
   않는다.
4. 실제 이름·대화 대신 synthetic marker만 쓴다.

현재 `openai.test.ts`에는 `count → beforeGeneration → create` 순서를 정상 계약으로 고정한
테스트가 있다. 이 테스트를 무심코 삭제하지 말고, privacy gate와 quota/generation gate의
역할을 어떻게 분리할지 상세 설계와 함께 명시한다.

표적 명령:

```powershell
corepack pnpm --filter @hanbang/web exec vitest run `
  src/lib/ai/__tests__/openai.test.ts `
  src/lib/ai/__tests__/auditedOpenAI.test.ts
```

첫 산출물은 현재 코드에서 정확히 실패하는 RED 증거와 최소 변경 설계다. Product code 수정은
RED가 의도한 실패인지 확인한 뒤 별도 논리 단위로 진행한다.

---

## 8. 이어서 닫을 P0

상세 공격 순서·코드 줄·필수 테스트·종료 영수증은 상세 handoff §8을 그대로 따른다.

1. P0-5: 최종 privacy gate 전 OpenAI token-count 원문 반출
2. P0-4: A의 늦은 Memory 응답이 계정 전환 뒤 B 화면에 적용될 가능성
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
   git rev-parse '@{u}', gh pr view 79를 실행해 현재 source를 확인하세요.
3. PRINCIPLES.md, AGENTS.md, docs/README.md,
   docs/operations/AMORA_PRIVACY_SECURITY_WORK_PROGRESS_AND_RELEASE_HANDOFF_2026-08-04.md,
   docs/AMORA_ZERO_LEAK_PRIVACY_SECURITY_ARCHITECTURE_2026-08-04.md를 읽으세요.
4. 현재 판정은 Production NO-GO입니다. Production DB write/migration, Vercel Production,
   EAS Production, 실제 사용자 데이터 QA, Memory/push/media/provider 활성화를 하지 마세요.
5. 먼저 P0-5의 provider all-egress RED 테스트만 synthetic marker로 작성하세요.
   provider gate 실패 시 inputTokens.count와 responses.create가 모두 0회여야 합니다.
6. product code를 바꾸기 전에 현재 HEAD, dirty 파일, 확인한 근거, 변경할 파일, 표적 테스트,
   중단 조건을 보고하세요.
7. 완료 보고에는 직접 확인한 사실, 코드 기반 추론, 미확인 외부 증거를 분리하고 실제로
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
