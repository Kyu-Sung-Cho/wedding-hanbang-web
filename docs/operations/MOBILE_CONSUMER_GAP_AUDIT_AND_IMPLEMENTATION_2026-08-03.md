# 모바일 소비자 다각도 완성도 감사 및 구현 인계 — 2026-08-03

> 상태: `NOT RELEASE READY`
>
> 결론: 웹·모바일이 같은 저장소와 Supabase/API 계약을 사용하는 기반은 갖췄지만,
> 소비자가 설치해서 첫 진입하고 아모라를 사용하고 파트너와 동기화하는 실제 출시 후보는
> 아직 완성되지 않았다. 운영 runtime API, 마이그레이션, 실기기·두 계정 증거가 닫히기
> 전에는 “완성” 또는 “웹 변경이 앱에 전부 즉시 반영”이라고 말하지 않는다.

## 1. 감사 기준과 작업 경계

- 제품 정본: `PRINCIPLES.md`, `docs/MVP_PRODUCT_DIRECTION_2026-07-30.md`,
  `docs/MOBILE_APP_MASTERPLAN_2026-06-30.md`,
  `docs/MOBILE_PRODUCT_COMPLETION_STANDARD_2026-08-03.md`
- 감사 기준 commit: `e10226b2af94874a1e6ddb80332aa2ac8eed4e0d`
- 구현 branch: `codex/mobile-consumer-qa-20260803`
- 운영 확인 시각: 2026-08-03 23:49~23:55 KST
- 별도 진행 중인 `agent/release-handoff-20260731`의 랜딩·온보딩·아모라·DB 변경은
  reset, stash, stage, commit하지 않았다. 그 작업 트리는 계속 편집 중이므로 아래 구현은
  깨끗한 worktree와 별도 branch에서 만들었다.
- 시각 디자인 판단은 Lazyweb MCP가 이 세션에 없어 수행하지 않았다. 실제 화면 캡처,
  작은 화면, 큰 글자, VoiceOver/TalkBack 검증은 `UNVERIFIED`다.

근거 표기:

- `E`: 이번 감사에서 코드·명령·운영 URL로 직접 확인
- `I`: 확인한 코드와 결과에 따른 영향 추론
- `UNVERIFIED`: 실제 기기·외부 계정·운영 자격증명이 필요해 확인하지 못함

## 2. 소비자 관점 판정

| 관점 | 판정 | 직접 확인한 핵심 |
| --- | --- | --- |
| 신규 사용자 첫 실행 | `CRITICAL FAIL` | 운영 `/api/mobile/runtime-contract`가 404이고 앱이 세션보다 먼저 요구한다. |
| 로그인 후 아모라 전송 | `CRITICAL DEPLOY ORDER` | 진행 중인 모바일은 `/api/chat/messages` POST를 전제로 하지만 운영 POST는 405다. |
| 파트너 초대·합류 | `FIXED IN THIS BRANCH` | DB가 총 15자 코드를 발급하지만 앱은 10자에서 잘랐다. 15자로 수정했다. |
| 웹·앱 실시간 연결 | `PARTIAL` | journey, booking, 일부 chat은 연결됐지만 profiles, couples, comments와 전체 community는 보장되지 않는다. |
| 딥링크 진입 | `HIGH FAIL` | runtime 검증은 index에만 있어 직접 route 진입이 검증을 우회할 수 있다. |
| 아모라 오류·복구 | `HIGH` | 일부 로드 오류가 빈 대화처럼 보이고, 신원 누락 시 전송이 설명 없이 끝날 수 있다. |
| 커뮤니티 비회원 | `HIGH` | 글쓰기·내 글·북마크가 먼저 노출되고 뒤늦게 실패하거나 거짓 빈 상태를 보인다. |
| 긴 기록 탐색 | `HIGH` | 커뮤니티 12개, 채팅 200개 이후 cursor pagination이 없다. |
| 공개·개인정보 이해 | `HIGH` | 게시물은 public 고정이지만 비회원 포함 공개와 개인정보 경고가 부족하다. |
| 오프라인·재연결 | `HIGH / UNVERIFIED` | 공통 API timeout과 Realtime reconnect refetch 계약이 충분하지 않고 실기기 증거가 없다. |
| 접근성 | `HIGH / UNVERIFIED` | 일부 label은 있으나 핵심 Pressable·동적 오류·live region·reduced motion과 실기기 증거가 부족하다. |
| 계정 삭제·동의 | `CRITICAL OPERATIONS` | 삭제 intake/worker는 기본 비활성이고 필수 약관 버전 동의 ledger가 없다. |
| 푸시 | `KEEP OFF` | 단일 profile token, 로그아웃 revoke 부재로 계정 전환·여러 기기 안전성이 없다. |
| 네이티브 변경 즉시 반영 | `NOT IMPLEMENTED` | Expo Update 설정은 있으나 publish, canary, rollback, kill switch controller가 없다. |

## 3. 운영에서 직접 재현한 출시 차단

### 3.1 모바일 runtime contract

`GET https://hanbang.ai/api/mobile/runtime-contract` → `404`.

- 앱 강제 검증: `apps/mobile/app/index.tsx`
- 검증 구현: `apps/mobile/src/lib/mobileWebRuntime.ts`
- 로컬 웹 route는 존재: `apps/web/src/app/api/mobile/runtime-contract/route.ts`

I: 현재 운영 origin을 사용하는 정상 cold start는 로그인 전에 오류 화면으로 멈춘다.
오류 카피도 배포/runtime 문제를 “로그인 상태 확인 실패”로 표시해 원인을 잘못 전달한다.

### 3.2 신규 채팅 ingest API

`POST https://hanbang.ai/api/chat/messages` with `{}` → `405 Method Not Allowed`.

진행 중인 모바일·웹 코드는 이 POST route를 전제로 한다. 따라서 순서는 반드시 다음과 같다.

1. 웹 runtime contract와 chat messages POST를 먼저 배포한다.
2. runtime `200`, unauthenticated ingest `401`, 인증된 테스트 계정의 성공 envelope를 확인한다.
3. 그 뒤에만 모바일 preview를 배포한다.
4. 마지막으로 direct AI insert 제한 migration을 적용한다.

### 3.3 Universal Link / App Link

- `GET /.well-known/apple-app-site-association` → `404`
- `GET /.well-known/assetlinks.json` → `404`

앱 선언은 있지만 Apple Team ID와 Android production signing SHA-256을 가진 실제 파일이 없다.
값을 추정해서 만들지 말고 signing owner가 제공한 값으로 생성·검증해야 한다.

### 3.4 진행 중 DB migration drift

진행 중인 주 작업 트리에서 `corepack pnpm supabase:release:fence`는 exit 1이었다.
manifest는 66개를 기대하지만 감사 시점에는 다음 두 migration이 추가돼 있었다.

- `20260803100000_amora_shared_ai_ingest_boundary.sql`
- `20260803110000_amora_memory_source_scope_boundary.sql`

migration 순서·normalized SHA·controller·postcheck·backup/restore·rollback 문서가 함께 고정될
때까지 DB 배포는 차단한다.

### 3.5 진행 중 모바일 test instability

동시 편집 중인 `apps/mobile/app/(tabs)/chat.tsx`와 source-contract tests는 감사 중 실패 수가
3~5개 사이로 변했다. 최신 직접 실행에서도 0 fail이 아니었다. `reconcileFirst` 구현과
오래된 정규식 assertion의 충돌이 섞여 있으나, 안전·visibility·durable message 계약에
관한 테스트이므로 단순 삭제하면 안 된다.

최종 작업이 멈춘 뒤 다음 두 명령이 같은 commit에서 모두 exit 0이어야 한다.

```powershell
corepack pnpm --filter @hanbang/mobile test
corepack pnpm --filter @hanbang/mobile typecheck
```

## 4. 이번 branch에서 실제 구현한 수정

### 4.1 분석 이벤트 UUID 계약 수정

Commit: `6479ffb1 fix: 이벤트 세션 UUID 계약 일치`

- `useEventTracker`가 timestamp/random 문자열 대신 UUID v4를 보낸다.
- 기존 탭의 잘못된 sessionStorage 값도 검증 후 교체한다.
- 클라이언트 payload와 `/api/events` UUID 계약을 고정하는 회귀 테스트를 추가했다.

검증:

- 관련 Vitest 12/12 PASS
- web typecheck PASS
- 대상 ESLint PASS

### 4.2 모바일 커플 초대 코드 truncation 수정

Commit: `8065f43b fix: 모바일 커플 초대 코드 길이 일치`

- 모바일 입력 한도를 DB의 `WH-` + 12자, 총 15자 규칙에 맞췄다.
- 예시 placeholder도 실제 신규 코드 형식으로 바꿨다.
- DB generator와 모바일 입력 계약을 함께 읽는 회귀 테스트를 추가했다.

검증:

- mobile test 289/289 PASS on clean branch
- mobile typecheck PASS
- mobile lint PASS
- `mobile:release-check` 104/104 PASS

### 4.3 실서비스 모바일 연결 gate 추가

Commit: `4c32075b test: 모바일 실서비스 연결 게이트 추가`

기존 `qa:live`에 다음 검사를 추가했다.

- runtime contract version, project ref shape, 필수 capability
- Apple association의 iOS bundle id와 `/app` route
- Android package, signing fingerprint, handle-all-URLs relation
- 옛 시장가격 URL이 현재 canonical `/price`로 이동하는 계약

2026-08-03 운영 실행 결과는 7개 중 4개 PASS, 위 세 모바일 계약은 모두 404 FAIL이었다.
이제 랜딩이 정상이어도 모바일 연결 파일이 없으면 live gate가 실패한다.

### 4.4 운영 감사 실패 종료 코드 수정

Commit: `d938f981 fix: 운영 감사 실패를 릴리스 실패로 전달`

- `audit:production`에서 하나라도 실패하면 `process.exitCode = 1`이 된다.
- 회귀 테스트를 root test suite에 포함했다.

## 5. 남은 구조적 빈틈

### P0 — 다음 배포 전에 반드시 닫기

1. 진행 중 작업을 하나의 안정된 commit으로 고정하고 mobile test와 release fence를 0 fail로 만든다.
2. 웹 runtime contract와 chat ingest POST를 먼저 Preview에 배포한다.
3. 앱의 runtime 검증을 root-level provider로 이동해 모든 딥링크를 포함한다.
4. `api.ts`, chat, OAuth가 raw env URL을 조합하지 않고 검증된 origin builder만 쓰게 한다.
5. 신규 migration을 manifest/controller에 고정하고 staging backup·restore·RLS 검증을 수행한다.
6. 두 실제 계정·두 실제 기기로 신규/기존 커플 E2E를 수행한다.

### P1 — 소비자 신뢰와 반복 사용

1. 온보딩을 예식일 + 현재 준비 상태의 최소 입력 뒤 첫 Amora 가치로 재구성한다.
2. Amora에 `loading / ready / setup-required / error`를 분리하고 재시도·설정 CTA를 제공한다.
3. community write/my/bookmark에 공용 auth gate, returnTo, draft 복구를 적용한다.
4. community와 chat에 cursor pagination을 추가한다.
5. 공개 대상과 개인정보·계약번호·연락처·얼굴 경고를 발행 전에 표시한다.
6. profiles, couples, community_comments publication과 reconnect/focus refetch를 고정한다.
7. 계정 삭제 receipt/status/SLA와 필수 약관 버전 consent ledger를 운영한다.

### P2 — 스토어·운영 완결

1. signed AASA/assetlinks 파일을 배포하고 실제 링크로 iOS/Android를 검증한다.
2. `push_devices`와 atomic register/reassign/revoke를 만든 뒤에만 push flag를 켠다.
3. EAS Update publish, 점진 배포, rollback, kill switch와 담당자를 코드·문서로 고정한다.
4. Sentry production release/source map receipt, 지원 수신, PITR/restore 증거를 남긴다.
5. Lazyweb 실제 화면 감사와 iOS/Android 접근성·큰 글자·오프라인·복귀 검증을 완료한다.

## 6. 웹과 앱이 “바로 연결”되는 정확한 범위

- 같은 Supabase/API의 데이터 변경은 해당 화면이 Realtime을 구독하거나 재조회할 때 공유된다.
- Next.js 웹 UI 코드는 React Native 화면으로 복사되지 않는다.
- hosted WebView 화면은 웹 배포로 바뀔 수 있다.
- 네이티브 JS/UI는 runtime-compatible EAS Update 또는 새 store build가 필요하다.
- native module, permission, app.json, runtimeVersion 변경은 store binary가 필요하다.

따라서 목표는 “웹 코드를 앱에 자동 복사”가 아니라 다음 세 계약이다.

1. 공유 데이터/API schema와 mutation 규칙
2. 모든 화면의 reconnect·revision·idempotency·Realtime/refresh 계약
3. 네이티브 OTA/store release controller와 rollback

## 7. 다른 컴퓨터에서 이어서 검증·통합

```powershell
git clone https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git
cd wedding-hanbang-web
git fetch --prune origin
git switch --track origin/codex/mobile-consumer-qa-20260803
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm hooks:install
corepack pnpm --filter @hanbang/mobile test
corepack pnpm --filter @hanbang/mobile typecheck
corepack pnpm --filter @hanbang/web typecheck
corepack pnpm mobile:release-check
```

진행 중 주 branch에 통합할 때는 먼저 그 branch의 60여 개 변경을 소유자가 commit하고,
clean 상태에서 아래 범위를 cherry-pick한다. onboarding과 package.json이 동시에 바뀌었다면
의미 단위로 충돌을 해결하고 전체 테스트를 다시 실행한다.

```powershell
git switch agent/release-handoff-20260731
git pull --ff-only
git cherry-pick e10226b2..origin/codex/mobile-consumer-qa-20260803
```

dirty worktree를 `reset --hard`, `checkout --`, `clean`으로 지우지 않는다.

## 8. 최종 출시 승인 조건

아래가 같은 source SHA로 모두 증명돼야 `READY`로 바꾼다.

- source test/typecheck/lint/build와 static release gate 0 fail
- 운영 runtime contract 200, chat ingest 배포 순서 검증
- migration/RLS/Storage/backup/restore/finalizer 승인
- signed iOS/Android preview와 두 계정·두 기기 E2E
- offline/reconnect/token expiry/account switch/account deletion
- VoiceOver/TalkBack, 작은 화면, 큰 글자, safe area, keyboard
- Universal/App Link, push revoke, OTA rollback
- Sentry release/source commit, 고객지원과 법무·개인정보 운영 증거

현재 판정은 `NOT RELEASE READY`다. 강점은 승인·revision·idempotency·privacy 경계가 상당히
깊게 구현되어 있다는 점이고, 남은 일은 화면 수 추가가 아니라 실제 배포 순서와 소비자
복구·동기화·운영 증거를 닫는 것이다.
