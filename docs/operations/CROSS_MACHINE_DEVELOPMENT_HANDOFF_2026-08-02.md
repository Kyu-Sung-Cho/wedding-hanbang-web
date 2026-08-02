# 다른 컴퓨터 개발 인수인계 — 2026-08-02

> [!IMPORTANT]
> **상태: SOURCE SNAPSHOT / RELEASE CANDIDATE / PRODUCTION DB NO-GO**
>
> 이 문서는 `agent/release-handoff-20260731` 브랜치에 모인 웹·모바일·공유 패키지·DB
> 후보를 다른 컴퓨터에서 그대로 이어 개발하기 위한 시작점이다. GitHub에 코드가
> 존재한다는 사실은 Vercel 운영 배포, hosted Supabase migration 적용, 앱스토어 출시를
> 뜻하지 않는다. 운영 변경은 각 release fence와 승인 증거를 별도로 통과해야 한다.

## 1. 가장 먼저 할 일

새 컴퓨터에서 PowerShell을 열고 다음 순서로 실행한다.

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

이미 같은 저장소가 있다면 새 clone보다 아래 절차를 우선한다.

```powershell
git fetch origin --prune
git switch agent/release-handoff-20260731
git pull --ff-only
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm hooks:install
git status -sb
```

정상 상태는 브랜치가 `origin/agent/release-handoff-20260731`을 추적하고, 설치 직후
의도하지 않은 파일 변경이 없는 상태다. `git pull`에 merge commit을 자동 생성하지
않도록 `--ff-only`를 유지한다.

## 2. 런타임 정본

2026-08-02 로컬 매니페스트에서 직접 확인한 값이다.

| 항목 | 현재 정본 |
|---|---|
| 패키지 관리자 | `pnpm@11.7.0` |
| Node.js | `>=22.13.0` |
| 웹 | Next.js `16.2.11`, React `19.2.3`, Tailwind CSS 4 |
| 모바일 | Expo `~54.0.36`, React Native `0.81.5`, React `19.1.0` |
| 저장소 구조 | pnpm/Turbo 모노레포 |
| 웹 경로 | `apps/web` |
| 모바일 경로 | `apps/mobile` |
| 공유 코드 | `packages/shared`, `packages/design-tokens` |
| 데이터·인증 | 웹과 모바일이 같은 Supabase 프로젝트 사용 |
| AI provider | OpenAI Responses API. 실제 활성화는 환경 게이트에 따름 |

정확한 버전은 항상 루트와 각 workspace의 `package.json`, `pnpm-lock.yaml`을 최종
기준으로 삼는다. 문서 숫자가 다르면 실행 매니페스트가 우선이다.

## 3. 제품의 현재 한 문장

**웨딩한방은 아모라에게 결혼 준비를 말하면, 예산·체크리스트·일정이 함께 정리되는
서비스입니다.**

커플의 확정 결정과 웹·모바일 연결은 이 제품 계약을 안전하게 실행하기 위한 내부
기반이며, 현재 MVP 한 문장을 바꾸거나 별도 전면 제품을 뜻하지 않는다.

이번 후보가 지키는 핵심 원칙은 다음과 같다.

- 아모라는 사용자에게 하나의 입구로 보이되, 실제 전송은 `shared_ai`,
  `shared_partner`, `private_ai` 세 레인으로 분리한다.
- 메시지는 결정 정본이 아니다. 실행이 확정된 커플 결정은 `decision_nodes`, 모든 AI
  호출은 `ai_interactions_log`에 기록한다.
- 모델의 “저장했어요” 문장은 성공 증거가 아니다. DB 결과와 실행 영수증이 있어야
  완료로 표시한다.
- 개인 상담 원문, 파트너 직접 메시지, 공유 대화의 공개 범위를 섞지 않는다.
- 앱과 웹은 같은 Supabase 상태를 사용하며, 네이티브 UI 코드와 웹 UI 코드는 별도
  배포 단위라는 사실을 숨기지 않는다.

## 4. 이번 source snapshot에 포함된 변경 묶음

### 4.1 아모라 대화 기반

- 한 화면 안에서 공유 아모라, 파트너 직접 대화, 개인 아모라 초안을 독립적으로
  유지한다.
- 사용자·세션이 바뀐 뒤 늦게 도착한 비동기 결과와 Realtime 이벤트가 새 계정 상태를
  덮지 못하도록 generation/session fence를 추가했다.
- 저장 실패, provider 실패, 재시도, 첨부 업로드를 서로 다른 실패 상태로 처리한다.
- 사용자 메시지는 durable write 후에만 provider 호출로 넘어간다.
- `client_request_id`, exact revision, proposal digest를 이용해 재시도와 공동 승인에서
  중복 실행을 막는다.
- 대화 segment schema, dual-write, 현재 segment read 경로, memory repair/replay 후보를
  추가했다. 단, hosted 적용과 read flag 활성화 전이므로 운영 기능으로 주장하지 않는다.
- 중재안은 두 사용자의 정확한 revision 확인과 현재 roster 결속을 통과해야 확정된다.
- 위기 표현은 규칙 기반 분류·안전 응답·회복 경로와 테스트를 가진다. 의료·법률 판단을
  대신한다는 의미는 아니다.

세부 설계 정본:

- `docs/AMORA_CONVERSATION_FOUNDATION_2026-08-01.md`
- `docs/AMORA_INTEGRATED_CARE_PRODUCT_SPEC_2026-07-30.md`

### 4.2 Today One 케어

- 오늘 사용자에게 가장 도움이 되는 한 가지 준비 행동을 고르는 웹·모바일 표면을
  추가했다.
- 사용자 opt-in, budget guardrail, source revision, couple-bound receipt, 수동 일정의
  공정성 규칙을 계약과 migration으로 분리했다.
- 외부 이메일 케어와 인앱 케어는 별도 스위치다.
- `AMORA_TODAY_ONE_ENABLED`가 정확히 `true`가 아니면 기능은 닫힌다.

### 4.3 예산·일정·예약 무결성

- 예산 category registry와 revision을 웹·모바일에서 일치시키고, 오래된 화면의 write가
  새로운 값을 지우지 않도록 서버 canonical merge 경계를 강화했다.
- 일정 생성·수정·취소는 승인 inbox, session fence, exact revision을 사용한다.
- 예약 견적·지출의 soft cancellation과 projection outbox를 추가해 예약 취소 뒤에도
  진행률·예산이 거짓 상태로 남지 않게 했다.
- 자정 경계, 취소된 일정, 수동 일정 담당자 표기, 기존 legacy cost를 회귀 테스트한다.

### 4.4 커뮤니티와 공개 신뢰

- cohort 배정을 DB 원자 연산으로 이동하는 migration과 계약을 추가했다.
- 게시글·댓글·북마크·투표·신고·AI 댓글의 mutation 권한과 idempotency를 강화했다.
- 모바일 community upload는 signed upload/finalize 경계와 session ownership을 지킨다.
- 공개 landing/start-here/community 진입부를 “무엇을 얻는지”가 먼저 보이도록 재구성했다.
- 기존 `/community/start-here` 표면은 루트 `/start-here`로 이동했다.

### 4.5 랜딩과 첫 방문 경험

- 첫 화면은 기능 목록보다 결혼 준비 전후의 변화를 먼저 설명한다.
- `TransformationHero`, 문제 공감, 공유/개인 대화, 준비 결과, 근거, 마지막 행동 순서로
  랜딩을 분리했다.
- 로그인하지 않은 사용자가 데모와 시작 안내를 이해하고, 실제 가입 경계로 이동하도록
  카피와 CTA를 정리했다.
- QA 캡처는 로컬 `artifacts/`에서만 확인하며 Git source에는 포함하지 않는다.

### 4.6 웹·모바일 연결

- 웹과 모바일은 같은 Supabase Auth와 커플 데이터를 사용한다.
- `wedding_journeys`, `vendor_bookings`, `chat_messages` Realtime 흐름을 양쪽 표면에
  연결했다.
- 웹 authenticated layout에 journey 구독을 추가해 앱에서 바꾼 예산·일정·준비 상태가
  열린 웹 화면에도 반영되게 했다.
- 모바일 프로필은 탭 focus 때 다시 읽어 웹에서 바뀐 이름·결혼 정보를 갱신한다.
- 모바일은 세션을 사용하기 전에 웹의 `/api/mobile/runtime-contract`를 읽고, 웹과 앱이
  정확히 같은 Supabase project ref와 필수 capability를 선언하는지 확인한다.
- 목적지가 다르거나 계약이 손상되면 서로 다른 계정 데이터를 섞지 않고 재시도 가능한
  연결 오류로 닫힌다.

중요한 한계:

- DB 데이터와 서버 계약은 즉시 공유할 수 있다.
- Next.js 컴포넌트·CSS 변경이 React Native 화면 코드로 자동 복사되지는 않는다.
- 웹을 재사용하는 가격/업체 표면은 웹 배포로 갱신할 수 있지만, 네이티브 UI 변경은
  Expo Update 또는 새 앱 빌드가 필요하다.
- 따라서 호환 계약을 바꿀 때는 `웹 배포 → 계약 확인 → 모바일 업데이트` 순서를 지킨다.

### 4.7 중립 커플 member 모델

현재 스키마는 bride/groom legacy slot에 강하게 결합돼 있다. 이번 후보에는 이를 이미
지원한다고 꾸미지 않고 실제 베타 제약을 인접 화면에 알리는 truthful copy를 넣었다.
성별 역할을 요구하지 않는 neutral member 모델은 아래 문서의 proposed rollout이며
아직 구현·배포 완료가 아니다.

- `docs/AMORA_NEUTRAL_COUPLE_MEMBER_MIGRATION_PROPOSAL_2026-08-02.md`

neutral onboarding, normalized member RLS, payer v2, old-client gate가 모두 준비되기 전에
가짜 중립 선택지를 노출하지 않는다.

### 4.8 DB와 운영 안전장치

이번 후보는 `20260801090000`부터 `20260802240000`까지 아모라 대화, Today One,
일정 승인, 예약 취소, community idempotency, budget integrity, privacy epoch, memory
repair/recovery 관련 additive migration을 포함한다.

하지만 migration 파일이 Git에 있다는 사실은 hosted DB 적용 완료가 아니다.

- 운영 write는 production destination fence와 소유자 확인 없이는 실행하지 않는다.
- manifest, migration digest, backup, restore rehearsal, storage drain, 외부 gate evidence가
  맞지 않으면 release controller가 실패해야 한다.
- 직접 `supabase db push`를 실행하지 않는다.
- 현재 정본과 정확한 절차는 다음 문서에서 읽는다.
  - `docs/operations/FULL_WORKSPACE_RELEASE_HANDOFF_2026-07-31.md`
  - `docs/operations/SESSION_HANDOFF_2026-08-02_COMMUNITY_AND_WORKSPACE.md`
  - `docs/operations/SUCCESSOR_SUPABASE_RELEASE_CONTROLLER_2026-07-31.md`

## 5. 환경변수 이전

비밀값은 GitHub에 올리지 않는다. 새 컴퓨터에서는 안전한 비밀 관리 경로를 통해
전달받아 아래 파일을 로컬에서만 만든다.

- 웹: `apps/web/.env.local`
- 모바일: `apps/mobile/.env.local`

템플릿:

- 웹: `apps/web/.env.example`
- 모바일: `apps/mobile/.env.example`

최소 공통 연결 조건:

```text
apps/web/.env.local
  NEXT_PUBLIC_SUPABASE_URL=<shared project URL>
  NEXT_PUBLIC_SUPABASE_ANON_KEY=<shared anon key>
  NEXT_PUBLIC_SITE_URL=<approved web origin>

apps/mobile/.env.local
  EXPO_PUBLIC_SUPABASE_URL=<same shared project URL>
  EXPO_PUBLIC_SUPABASE_ANON_KEY=<same shared anon key>
  EXPO_PUBLIC_SITE_URL=<same approved web origin>
```

서비스 역할 키, provider 키, Resend, Turnstile, Sentry, 운영 승인 해시는 서버/CI 비밀로만
보관한다. 모바일 `EXPO_PUBLIC_*`와 웹 `NEXT_PUBLIC_*`는 공개 번들에 포함될 수 있으므로
service role이나 private provider key를 넣지 않는다.

기존 컴퓨터의 `.env.local`을 메신저, 이메일, Git commit으로 옮기지 않는다. Vercel,
EAS, Supabase, 팀 password manager에서 목적지별로 다시 주입한다.

## 6. 로컬 실행

### 웹

저장소 루트에서 실행한다.

```powershell
corepack pnpm dev:web
```

기본 주소는 `http://localhost:3000`이다. 이 저장소는 WeddingCode research/build lock으로
동시 웹 dev와 production build를 막는다. 빌드 전에 자신이 실행한 웹 개발 서버를
정상 종료하고 lock owner가 없는지 확인한다. 다른 사람이나 다른 작업의 프로세스를
강제로 종료하지 않는다.

### 모바일

```powershell
corepack pnpm dev:mobile
```

같은 Wi-Fi의 실제 기기, Android emulator 또는 iOS simulator에서 실행한다. 로컬
웹 origin을 모바일에서 열어야 한다면 `localhost`는 기기 자신을 뜻하므로, 명시적으로
허용된 LAN/tunnel origin과 해당 환경 profile을 사용한다. 운영 build는
`EXPO_PUBLIC_SITE_URL=https://hanbang.ai`가 없거나 안전하지 않으면 실패해야 한다.

### Machine-local 디자인 조사 도구

Lazyweb MCP와 skills는 Git repository가 아니라 각 컴퓨터의 Codex 사용자 환경에
설치된다. 따라서 clone만으로 복원되지 않는다. UI 디자인 조사에 사용할 컴퓨터에서는
아래 런북을 따라 private token을 다시 주입하고 MCP·skills·Codex autorouter를 별도로
설치·검증한다.

- `docs/operations/LAZYWEB_MCP_DESIGN_WORKFLOW_2026-08-02.md`

토큰 값, 사용자별 setup URL, global Codex config/skills/AGENTS, signed image/report URL,
raw MCP 응답과 캡처는 Git으로 옮기지 않는다. `/artifacts/`와 `/.lazyweb/` 캡처는 현재
컴퓨터의 로컬 QA 산출물이며 GitHub 인계 대상이 아니다. 새 컴퓨터에서 공개 테스트
화면을 다시 실행해 재생성한다.

## 7. 개발 중 검증

빠른 변경 확인:

```powershell
corepack pnpm --filter @hanbang/shared typecheck
corepack pnpm --filter @hanbang/web typecheck
corepack pnpm --filter @hanbang/mobile typecheck
corepack pnpm --filter @hanbang/mobile test
corepack pnpm mobile:release-check
```

전체 후보 검증:

```powershell
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build:web
```

주의:

- `corepack pnpm test`는 repository safety contract와 각 workspace 테스트를 함께 실행한다.
- hosted DB, production write, 외부 provider를 요구하는 검사는 환경과 승인 증거가 없으면
  실패하거나 의도적으로 skip/fail-closed할 수 있다. 실패를 성공으로 바꾸려고 안전
  게이트를 끄지 않는다.
- DB migration은 PGlite/계약 테스트 통과와 hosted 적용을 구분해 기록한다.
- UI 변경은 브라우저와 실제 모바일 기기에서 별도로 확인한다.

## 8. 2026-08-02 검증 ledger

이 문서는 결과를 실제 명령이 끝난 경우에만 갱신한다.

| 검증 | 결과 | 범위 |
|---|---|---|
| 웹·모바일 runtime 계약 테스트 | PASS | 웹 신규 8개 테스트 |
| 모바일 workspace 테스트 | PASS | 최종 후보 288개 테스트 |
| 전체 typecheck | PASS | ingest + 4 workspace |
| 전체 lint | PASS | web/mobile workspace, 53.2초 |
| 모바일 release readiness | PASS | 104 checks |
| 모바일→웹 링크 계약 | PASS | 1 test |
| 로컬 runtime contract HTTP | PASS | `200`, project ref/capability 확인 |
| repository test | PASS | `pnpm test:repo`, exit 0, 125.7초 |
| shared workspace test | PASS | exit 0 |
| web workspace test | PASS | 529 files / 5,070 tests |
| 현재 전체 후보 `pnpm test` | PASS | root 종료 코드 0, Turbo 2/2; 전체 실행 18분 0.6초 |
| 현재 전체 후보 `pnpm typecheck` | PASS | 4 workspace + ingest |
| Supabase release contract | PASS / BLOCKED | tests 189/189, 66개 manifest 정적 fence PASS, 적용은 `deployment_blocked` |
| 커뮤니티 release contract | LOCAL READY / PRODUCTION NO-GO | local 13개 계약과 test 2/2 통과, hosted·운영 증거 없음 |
| 현재 전체 후보 `pnpm build:web` | PENDING | 실행 중인 웹 dev lock을 강제 종료하지 않고 격리 worktree 확인 예정 |
| hosted migration | NOT RUN | production DB NO-GO |
| Vercel/EAS production deploy | NOT RUN | 별도 승인·receipt 필요 |

## 9. 알려진 미완료와 출시 게이트

1. hosted Supabase migration은 적용하지 않았다. source migration과 운영 DB를 동일하다고
   가정하지 않는다.
2. conversation segment read와 Today One은 기본 OFF다. migration, restore, canary 증거
   전에는 켜지 않는다.
3. neutral couple member 모델은 제안 단계다. 현재 베타 지원 범위를 UI에 사실대로 알린다.
4. 실제 두 계정으로 웹↔모바일 realtime, logout/login, reconnect, 승인 revision을 E2E
   확인해야 한다.
5. iOS Universal Link와 Android App Link는 Apple Team ID와 Android signing SHA-256이
   들어간 `.well-known` 파일을 실제 도메인에서 제공해야 한다. 임의 값을 만들지 않는다.
6. 랜딩·커뮤니티 캡처는 로컬 QA 증거이지 production 배포 receipt가 아니다.
7. 운영 AI를 켜기 전 provider 비용, quota, privacy log, crisis recovery, 자동 side effect
   gate를 다시 확인한다.

## 10. 안전한 릴리스 순서

1. 이 브랜치를 fresh clone하고 `pnpm install --frozen-lockfile`을 통과시킨다.
2. preview용 Supabase/Vercel/EAS 환경만 주입한다.
3. typecheck, 전체 test, web production build를 같은 commit에서 실행한다.
4. protected Vercel Preview에서 로그인·온보딩·아모라·예산·일정·커뮤니티를 확인한다.
5. clone/staging DB에 migration을 적용하고 backup/restore와 RLS adversarial test를 한다.
6. production release controller의 manifest와 외부 증거를 소유자가 승인한다.
7. write fence와 backup 순서를 지켜 DB를 적용하고 receipt를 보존한다.
8. 웹을 먼저 배포하고 `/api/mobile/runtime-contract`를 확인한다.
9. 모바일 preview/내부 build에서 동일 project ref, OAuth, WebView, Realtime을 확인한다.
10. 그 뒤에만 production EAS Update 또는 앱스토어 build를 진행한다.

## 11. 다음 작업자가 시작할 우선순위

1. 새 컴퓨터에서 이 브랜치와 환경을 복원하고 전체 검증 ledger를 새 commit 기준으로
   다시 만든다.
2. active web dev process가 없을 때 `corepack pnpm build:web`을 완료한다.
3. 두 실제 계정·두 기기 조합으로 웹↔모바일 실시간 동기화를 검증한다.
4. `.well-known` association 파일에 필요한 실제 Apple/Android 서명 정보를 확보한다.
5. preview clone에서 신규 migration 순서, rollback, restore를 검증한다.
6. neutral member Phase 0의 truthful-launch 카피와 proposed backend를 혼동하지 않는다.
7. production 승인이 생기기 전에는 DB 적용, 기능 flag 활성화, 외부 AI side effect를 하지
   않는다.

## 12. Git 작업 규칙

- 이 브랜치의 목적은 큰 release handoff 후보를 보존하는 것이다.
- 다른 컴퓨터에서 시작할 때 먼저 `git status -sb`와 `git log -1 --show-signature`를
  확인한다.
- 수정 전 작은 목적 브랜치를 `codex/` 또는 팀 규칙에 맞게 새로 만들어도 된다.
- migration, 인증, AI, 결제, 개인정보 변경은 코드만 보고 production-ready로 판단하지
  않는다.
- 커밋·푸시·배포·DB 적용은 각각 별도 사실이다. 성공한 단계만 완료로 기록한다.

## 13. 핵심 문서 읽기 순서

1. `PRINCIPLES.md`
2. `AGENTS.md`
3. `DESIGN.md`
4. `docs/MVP_PRODUCT_DIRECTION_2026-07-30.md`
5. `docs/operations/CROSS_MACHINE_DEVELOPMENT_HANDOFF_2026-08-02.md`
6. `docs/operations/FULL_WORKSPACE_RELEASE_HANDOFF_2026-07-31.md`
7. `docs/operations/SESSION_HANDOFF_2026-08-02_COMMUNITY_AND_WORKSPACE.md`
8. 모바일 작업이면 `docs/MOBILE_APP_MASTERPLAN_2026-06-30.md`
9. 아모라 작업이면 `docs/AMORA_INTEGRATED_CARE_PRODUCT_SPEC_2026-07-30.md`와
   `docs/AMORA_CONVERSATION_FOUNDATION_2026-08-01.md`
10. DB 작업이면 `docs/operations/SUCCESSOR_SUPABASE_RELEASE_CONTROLLER_2026-07-31.md`

## 14. 완료 정의

다른 컴퓨터에서 개발 인계가 완료됐다고 말하려면 다음이 모두 참이어야 한다.

- 원격 브랜치를 fresh clone할 수 있다.
- frozen lockfile 설치가 된다.
- 비밀값 없이 repository가 안전하게 내려온다.
- 필요한 환경변수 이름과 주입 위치를 문서만 보고 알 수 있다.
- 웹·모바일·공유 패키지의 현재 관계와 배포 순서를 설명할 수 있다.
- 로컬 구현, preview, hosted DB, production 배포 상태를 구분할 수 있다.
- 전체 테스트·빌드를 같은 commit에서 재현할 명령이 있다.
- 남은 외부 승인과 실제 기기 검증을 완료로 오해하지 않는다.
