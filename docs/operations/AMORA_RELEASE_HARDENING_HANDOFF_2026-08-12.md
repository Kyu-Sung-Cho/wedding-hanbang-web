# 아모라 릴리스 하드닝 구현·검증·배포 인수인계 — 2026-08-12

> 상태: **REMOTE RELEASE CANDIDATE / EXACT-SHA SOURCE GATES PASSED / PROTECTED STUB PREVIEW / HOSTED PRODUCTION EVIDENCE MISSING / PRODUCTION NO-GO**
>
> 통합한 원격 기준: `origin/main` `b58a329d0d03b81cf2f022ef51d197b084741c9d`
>
> 검증된 구현·Preview source SHA: `f8851f749890a172057f2e3a5360d11f3ea1163a`
>
> 원격 branch: `codex/amora-release-hardening-20260811`
>
> Draft PR: [#105](https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/pull/105)
>
> 보호된 stub Preview: deployment `dpl_AJEzS36JsP35THq85GL2d4WaXB6a` ·
> `https://wedding-hanbang-me24b9s4q-hanbang.vercel.app`

이 문서는 2026-08-11~12에 수행한 아모라 코드·보안·제품 감사를 실제 수정으로 연결한
인수인계다. 구현은 exact SHA `f8851f74`에서 고정한 뒤 5절의 전체 source gate를 실행하고
remote branch·Draft PR·접근 보호된 Vercel stub Preview로 게시했다. 이후 파일이나 SHA가
바뀌면 이 검증과 Preview 판정을 자동 상속하지 않는다.

가장 중요한 결론은 두 가지다.

1. 아래에 열거한 source 결함은 fail-closed 계약과 회귀 테스트로 보강했다.
2. 운영 Supabase, Storage, 모바일 fleet, provider runtime의 hosted 증거는 아직 없다.
   따라서 source가 좋아졌다는 사실을 production 배포 허가로 해석하지 않는다.

---

## 1. 이번 작업의 제품 목표

아모라는 예비 신부·신랑이 결혼 준비를 덜 불안하고 더 공평하게 해내도록 돕는 AI
파트너다. 이번 릴리스 후보는 기능 수를 늘리는 것보다 아래 신뢰 계약을 우선했다.

- `나만 상담` 원문은 파트너에게 보이지 않는다.
- `함께 대화`는 저장·미래 가시성을 사용자가 전송 전에 이해한다.
- 계정이나 커플이 바뀐 뒤 이전 비동기 요청이 새 사용자로 저장되지 않는다.
- provider로 원문이 나가기 직전에 현재 멤버십·privacy epoch·kill switch를 다시 확인한다.
- 실제로 저장·적용·예약된 것만 영수증으로 보여 준다.
- 사용자는 오래 걸리는 응답을 중단할 수 있고, 중단 경합이 중복 전송이나 가짜 성공을
  만들지 않는다.
- 중요한 일정은 사용자가 명시적으로 지정했을 때만 아모라 케어로 이어진다.
- 안전을 위한 확인은 필요한 순간에 한 번만 보여 주고, 반복 마찰이나 공포 카피를 만들지
  않는다.

모바일 채팅 화면을 검토하는 데 사용한 Lazyweb 보조 보고서:

- https://www.lazyweb.com/report/lazyweb/fb40106c-e778-4b27-8836-ade788c2a0a9/?source=create
- 채택 방향: 한 번에 한 과업, interruption recovery 단순화, 현재 화면 밀도 유지
- 미채택 방향: 큰 scope watermark와 과한 컬러 레일
- 이 보고서는 제품 판단 보조 근거이며 production artifact, 개인정보·보안 또는 전환율 검증
  영수증은 아니다.

---

## 2. 구현한 보안·무결성 수직

### 2.1 모바일 durable ingest actor fence

기존 위험은 A 계정으로 작성한 초안이 전송 직전 B 계정 bearer를 얻으면 B가 작성한
메시지로 저장될 수 있다는 TOCTOU였다.

현재 계약:

- 모바일 draft가 `userId`와 session generation을 고정한다.
- 전송 직전 현재 session user와 draft actor를 비교한다.
- `/api/chat/messages`에는 body가 아니라 versioned ingest actor header와 공용 mutation actor
  header를 보낸다. body·log에 actor binding을 중복 노출하지 않는다.
- 서버는 DB 변경 전에 verified bearer와 두 actor contract가 정확히 같은지 확인한다.
- 늦은 응답과 old finally는 현재 operation/session identity가 아니면 UI를 바꾸지 않는다.
- transport/408/5xx 뒤 저장 여부가 불명확하면 같은 client request id로 status를 조회해
  canonical message·delivery receipt를 reconcile한다. 새 request id로 무조건 재전송하지
  않는다.

주요 파일:

- `apps/mobile/app/(tabs)/chat.tsx`
- `apps/mobile/src/__tests__/amoraChatSendActorFence.test.mjs`
- `apps/web/src/app/api/chat/messages/route.ts`
- `apps/web/src/app/api/chat/messages/route.test.ts`

### 2.2 provider egress single-use grant

기존 privacy epoch 재검사와 OpenAI SDK 호출 사이에는 revoke/unlink가 끼어들 수 있었다.
최종 응답 저장을 막아도 이미 provider로 나간 원문을 회수할 수 없으므로 egress 자체를
DB capability로 묶었다.

현재 계약:

- token count와 generation은 서로 다른 content-bearing operation이다.
- 각 operation은 exact JSON body의 SHA-256에 결속된 5초 grant를 별도로 발급받는다.
- grant는 durable provider receipt, actor, couple, visibility, privacy epoch에 묶인다.
- issue와 consume에서 현재 roster, profile backlink, privacy epoch, runtime control을
  재검사한다.
- consume은 1회만 성공하고 같은 receipt/operation은 재발급되지 않는다.
- egress grant와 provider receipt metadata에는 prompt·response 원문을 넣지 않는다. 최종
  assistant 응답을 기존 `chat_messages`에 저장하는 제품 계약과는 별개다.
- grant consume commit 직후가 egress 승인 선형화 지점이다. 그보다 먼저 revoke가 이기면
  provider 호출은 fail-closed한다. 이미 선형화된 HTTP를 이후 revoke가 소급 취소할 수
  있다고 주장하지 않는다.
- migration의 runtime control은 의도적으로 `enabled=false`로 시작한다.
- runtime disable은 control row lock을 얻은 시각을 선형화 기준으로 삼고, 그 시각에도
  consume 가능한 미소비·미취소·미만료 grant만 영구 취소한다. 이미 만료되어 consume이
  불가능한 역사 grant는 다시 쓰지 않는다.
- terminal-open grant의 `expires_at` 부분 인덱스로 disable 시 갱신 대상을 최대 5초의
  live window로 제한한다. 만료 역사 행 정리는 incident kill-switch 트랜잭션에 섞지
  않는다.

주요 파일:

- `apps/web/src/lib/ai/providerEgressBoundary.ts`
- `apps/web/src/lib/ai/amoraProviderCallLedger.ts`
- `apps/web/src/lib/ai/openai.ts`
- `apps/web/src/lib/ai/auditedOpenAI.ts`
- `apps/web/src/app/api/chat/route.ts`
- `apps/web/src/app/api/chat/check-couple-conflict/route.ts`
- `supabase/migrations/20260811230000_amora_provider_egress_grant.sql`

### 2.3 authenticated direct chat INSERT 제거

기존 authenticated INSERT policy는 API의 safety 분류, rate limit, actor binding,
attachment binding, canonical delivery receipt를 우회할 수 있었다.

현재 migration 계약:

- `anon`과 `authenticated`의 table·column INSERT 권한을 모두 회수한다.
- permissive INSERT policy를 제거한다.
- RLS와 authenticated SELECT는 유지한다.
- `service_role`은 INSERT 권한을 유지하고, postcondition은 `anon`·`authenticated`에 table·
  column INSERT 권한이나 permissive INSERT policy가 남지 않았는지 검사한다.
- 현재 저장소의 지원 web/mobile 전송은 `/api/chat/messages`를 사용한다.

파일:

- `supabase/migrations/20260812090000_amora_server_only_chat_ingest.sql`

주의: 실제 설치된 구형 모바일 binary가 direct INSERT를 사용하지 않는다는 fleet 증거가
없다. 그 증거 전에는 hosted migration apply를 허용하지 않는다.

### 2.4 attachment cleanup service boundary

브라우저가 Storage object를 직접 삭제하던 경로를 제거했다.

현재 계약:

- cleanup은 cookie 요청의 same-origin metadata 또는 명시적 Bearer credential과, 그 뒤의
  authenticated actor 검증을 요구한다.
- `expectedActorUserId`, profile backlink, couple roster slot을 확인한다.
- 경로는 소문자 `{couple UUID}/{user UUID}/{file UUID}.{jpg|png|gif|webp}`만 허용한다.
- 중복, traversal, escape, query/hash, 제어문자, 다른 actor 경로를 거부한다.
- `chat_messages.metadata.imagePaths` 결속을 Storage 조회 전과 삭제 직전에 두 번 확인한다.
- canonical actor-owned 경로에 있고 Storage `info.createdAt`으로 15분 이내임이 확인된 새
  orphan만 삭제한다.
- 이미 없는 object는 idempotent success이며, 확인 실패는 fail-closed한다.
- client는 동일 payload로 transport/408/5xx만 한 번 재시도한다.

주요 파일:

- `apps/web/src/app/api/chat/image-cleanup/route.ts`
- `apps/web/src/app/api/chat/image-cleanup/route.test.ts`
- `apps/web/src/stores/chatStore.ts`
- `apps/web/src/stores/__tests__/chatStore.test.ts`

남은 P2: DB message binding과 Storage delete는 서로 다른 시스템이라 완전한 원자
transaction이 아니다. 현재 두 번째 binding check로 창을 줄였지만, 완전 원자화에는 ingest와
cleanup이 공유하는 attachment claim/advisory-lock RPC가 필요하다. 15분을 넘긴 orphan을 위한
검증형 janitor도 별도 과제다.

### 2.5 invite replay·추측 강화

현재 Phase A migration은 기존 API가 멈추지 않도록 legacy RPC를 hardened core에 연결한
expand다.

- active invite는 정확히 `WH-` + 12자만 허용한다.
- 과거 6자리·비정상 active code는 migration에서 원자 회전한다.
- 초대 유효기간은 발급·회전 시점부터 7일이다.
- 성공하면 code 제거, SHA-256 redemption receipt, roster seal을 같은 transaction에서
  수행한다.
- actor별 DB 원자 제한은 10회/10분이다.
- 정확한 성공 actor의 same-code 재시도만 limiter 전에 idempotent receipt를 읽는다.
- 다른 actor replay, same-role, sealed, corrupt-owner 상태는 일반 invalid 응답으로 닫는다.
- 이미 연결된 actor는 active-code lookup 전에 `ALREADY_LINKED`로 닫아 code oracle을 만들지
  않는다.
- 실패한 초대 시도는 singleton rollout telemetry row를 갱신하지 않아 서로 무관한 사용자의
  검증을 전역 직렬화하지 않는다. 성공 telemetry만 반환 직전에 기록하며 Phase B 판단은 계속
  외부 로그가 기준이다.
- active join은 incumbent profile → joining profile → reset과 같은 couple advisory → couple
  row 순으로 잠근 뒤 code·expiry·roster를 다시 검증한다. owner reset과 엇갈려도 서로의 profile과
  couple row를 역순으로 기다리지 않는다.
- server RPC는 service role만 호출하며 API가 verified bearer actor를 전달한다.

주요 파일:

- `supabase/migrations/20260812030000_couple_invite_replay_hardening.sql`
- `apps/web/src/lib/couples/membershipRpc.ts`
- `apps/web/src/app/api/couple/link/route.ts`
- `apps/web/src/app/api/couple/code/route.ts`
- `apps/web/src/app/api/onboarding/route.ts`

Phase B는 active migration이 아니다.

- `supabase/release-candidates/amora-couple-invite-20260812/phase-b-legacy-rpc-revoke/20260812031000_revoke_legacy_join_couple.sql`
- Phase A 이후 외부 PostgREST/API 로그 24시간 0건, supported-client fleet drain, fresh durable
  attestation이 모두 있어야 승격할 수 있다.
- transaction이 실패하면 DB 내부 telemetry도 rollback될 수 있으므로 DB timestamp만으로
  legacy 호출이 없었다고 판단하지 않는다.

남은 위험: 현재 제품에는 검증된 recipient identity 입력과 fresh re-auth 계약이 없어
recipient binding과 재인증을 억지로 만들지 않았다. 이 기능 전까지 leaked code를 여러 계정으로
공격하는 이론적 잔여 위험은 남는다.

### 2.6 private usage side-channel 제거

기존에는 shared와 private가 같은 couple quota를 사용해 파트너가 잔여 횟수 변화로 상대의
private 상담 사용을 추론할 수 있었다.

현재 계약:

- shared lane은 opaque couple quota subject를 사용한다.
- private lane은 opaque actor-only quota subject를 사용한다.
- client role 문자열이 아니라 canonical actor가 private subject를 결정한다.
- 화면의 잔여 횟수는 현재 선택한 상담 공간의 값이다.
- global daily message/cost ceiling은 그대로 유지한다.

주요 파일:

- `apps/web/src/lib/ai/amoraQuotaSubject.ts`
- `apps/web/src/lib/ai/__tests__/amoraQuotaSubject.test.ts`
- `apps/web/src/app/api/chat/route.ts`
- `apps/web/src/lib/ai/costGuard.ts`

비용 영향: 새 opaque subject는 과거 couple counter를 이어받지 않으므로 이번 beta에서 shared와
각 private 공간의 잔여량이 새로 계산될 수 있다. 개인정보 분리와 공평성을 위한 의도된
변경이지만 global cap 모니터링이 필요하다.

### 2.7 account mutation actor fence와 화면 owner binding

profile·journey·settings·onboarding·couple code/link/reset·chat·password·account delete처럼
계정 소유 화면에서 시작하는 mutation에 공용 v2 actor contract를 추가했다.

현재 source 계약:

- updated mobile request helper는 `X-Hanbang-Mutation-Contract-Version: 2`와
  `X-Hanbang-Expected-Actor-User-Id`를 expected user transport에서 강제로 결속한다. caller가
  다른 actor나 낮은 version으로 덮어쓸 수 없다.
- server는 partial, malformed, unknown-version, authenticated actor mismatch를 DB mutation
  전에 거부한다.
- settings draft·password modal·커플 해제·계정 삭제와 onboarding form/continuation은 화면을
  연 actor를 고정하고 auth owner가 바뀌면 응답 적용·알림 callback·sign-out을 중단한다.
- 계정 삭제 성공으로 server auth가 먼저 사라지는 경우에는 삭제된 expected owner의 local
  cleanup만 허용하고, 그 사이 로그인한 새 owner를 purge하거나 sign-out하지 않는다.
- dashboard의 invite secret과 chat request/result는 owner/couple 변경 시 폐기하며, 늦은
  응답을 새 owner 화면에 적용하지 않는다.
- 특히 위험한 `/api/couple/reset`, `/api/auth/password`, `/api/auth/delete`는 headerless
  request도 즉시 fail-closed한다.

혼합 버전 경계:

- 나머지 일반 mutation은 updated server가 headerless legacy client를 잠시 받는 Phase A다.
  지원 fleet의 old traffic 0건과 fresh attestation 없이 Phase B 강제로 바꾸지 않는다.
- 이미 설치된 구형 모바일 binary가 Supabase Auth SDK로 비밀번호를 직접 바꾸는 경로는
  현재 API route 수정으로 차단할 수 없다. minimum supported mobile version·강제 업데이트 또는
  fleet drain, 그리고 가능한 Supabase Auth 정책 수준의 차단 능력을 확인해야 한다.
- 이 source 보강을 모든 계정 전환 경쟁이 hosted 환경에서 증명됐다는 뜻으로 쓰지 않는다.

---

## 3. 제품·UX 보강

### 3.1 모바일 영수증과 접근성

- 모바일도 persisted tool result를 success/failure 영수증으로 보여 준다.
- assistant text가 비어도 canonical receipt가 사라지지 않는다.
- booking이나 action이 실제 완료되지 않았는데 완료로 말하지 않는다.
- target control은 role, label, selected state를 노출한다.
- 헤더는 제품 정본인 `AI 파트너` 표현을 사용한다.

### 3.2 모바일 Stop과 첫 shared 전송 확인

현재 source에 아래 계약을 구현했다. exact SHA `f8851f74`의 full mobile 511/511과 관련
회귀가 통과했다. 실제 기기 네트워크 경합·중단 latency 검증은 아직 대기 중이다.

- 하나의 operation controller가 durable ingest부터 AI stream까지 소유한다.
- Stop은 현재 operation만 중단하고 composer와 scope control을 즉시 복구한다.
- old finally가 이후 새 operation을 종료하지 않는다.
- durable 저장이 이미 일어났는지 불확실한 중단은 같은 client request id로 reconcile하기
  전 새 request id 재전송을 유도하지 않는다.
- stream 단계에서 이미 저장된 user message는 유지하고 미완성 AI placeholder만 제거한다.
- first shared send에만 작은 확인 UI를 보여 준다.
- 문구는 `지금 함께 대화에 저장되며, 파트너가 연결되면 이 내용을 볼 수 있다`는 미래
  가시성을 정확히 설명한다.
- 확인 UI에서 `나만 상담으로 바꾸기`를 제공한다.
- 위기 안전 분기가 공유 확인보다 먼저 실행돼 민감한 내용을 modal이나 shared persistence에
  남기지 않는다.
- 확인 receipt는 user+couple에 결속하고 저장 실패 시 fail-closed한다.
- transport가 끊겨 durable 저장 여부가 불명확하면 같은 request id로 status를 확인한 뒤
  저장됐으면 canonical message를 채택하고, 저장되지 않았을 때만 안전하게 복구한다.

### 3.3 proactive schedule moment 입력

moment loop는 `momentType` 없는 일반 일정을 의도적으로 무시하지만, 기존 web/mobile 일정
폼은 이 값을 만들 수 없었다.

현재 계약:

- 웹·모바일 수동 일정 폼이 사용하는 8개 선택 option은 `packages/shared`에서 공유한다.
  실제 케어 콘텐츠와 trigger는 web의 `MOMENTS`에 별도로 있으며, 카탈로그 일치 테스트가
  값·label·`event` trigger drift를 막는다.
- 웹·모바일 수동 일정 폼에서는 제목 키워드를 추측하지 않고, 사용자가 option을 명시적으로
  선택한 경우에만 `momentType`을 추가한다. 온보딩과 승인된 AI 일정 도구의 기존 구조화 쓰기
  경로는 별도다.
- `일반 일정`은 `momentType` 없이 저장한다.
- 알 수 없는 legacy type은 내부 값을 사용자에게 노출하지 않고 보존하되 자동 발화하지
  않는다.
- 웹 native select와 모바일의 `radiogroup`/`radio` 접근성 속성이 같은 shared option을
  사용한다. TalkBack·VoiceOver와 큰 글자 실제 기기 검증은 아직 없다.
- source·unit 테스트에서 선택 값이 `progress.__events[].momentType`에 포함되고, 알려진
  event type이 moment loop의 D-3/D-1/D+1 후보로 계산됨을 각각 확인했다. 모바일 폼에서
  `/api/journey`, 커플 승인 RPC, hosted Supabase 저장과 실제 전달까지 잇는 E2E 증거는 없다.
- 실제 proactive 전달은 feature flag와 사용자 동의 상태에 의존한다.
- 저장소의 기존 manual-schedule JSONB validator가 이미 `momentType`을 허용하므로 이번 코드
  변경을 위한 새 migration은 없다. 그 계약의 hosted 설치 상태는 별도 증거가 필요하다.

공용 타입:

- 한쪽 가족에게 첫인사
- 양쪽 부모님이 함께 만나는 자리
- 결혼식장 방문
- 드레스 매장 방문
- 스튜디오 촬영
- 드레스 수선·최종 확인
- 초대장 전달 모임
- 결혼 후 첫 명절

### 3.4 위기 안전 분류기

`packages/shared/src/safety/amoraCrisisClassifier.ts`를 적대적으로 보강했다.

- 본인·파트너·부모 등 known other의 현재 자해·폭력·감금·치명 위험을 문장 경계와 대상
  귀속까지 확인한다.
- 신고자와 가해 대상, 과거·부정·가정·뉴스·영화·연기·분석 맥락을 분리해 현재 현실 위험을
  놓치지 않으면서 정상 대화의 과잉 위기 전환을 줄인다.
- 케이크·배달·공예·스포츠·음악 같은 benign 표현을 token masking으로 처리해 문장 뒤의
  실제 위험 단서를 통째로 지우지 않는다.
- third-party self-harm recipient와 `못 살겠어` 같은 한국어 경계를 별도 회귀 사례로 고정했다.

구현 중 dirty snapshot은 `402/402 PASS`, exact SHA `f8851f74`의 최종 focused suite는
`410/410 PASS`였다. 이는 분류기 회귀 범위의 증거이지, 의료 진단·상담 품질·실제 신고
체계·hosted 모델 또는 실제 기기 UX가 검증됐다는 뜻이 아니다.

### 3.5 prompt·voice·카피 drift

- 사용할 수 없는 업체 검색·예산 시뮬레이션 도구를 약속하는 prompt를 제거했다.
- scope vocabulary와 clarification tone을 현재 classifier에 맞췄다.
- 최신 `AI 파트너` voice를 과거 PR 전체 merge로 되돌리지 않고 필요한 hunk만 반영했다.
- mediation이 requester 요약만 가진 경우 두 사람의 원문을 모두 들었다고 과대 귀속하지
  않는 후속 검토가 계속 필요하다.

---

## 4. 의존성·빌드·날짜 보강

- `dompurify`, `js-yaml`, `nanoid` 보안 floor를 올렸다.
- 2026-08-11 작업 시점에 저장소가 고정한 `image-size@1.2.1`의 ICNS/ISO BMFF 무한-loop
  경로를 pnpm patch로 차단하고 실제 parser subprocess timeout 회귀 테스트를 추가했다.
- 두 `image-size` advisory ignore는 patch와 PoC test가 함께 있을 때만 유지한다.
- Next image quality `50`을 명시해 hero asset runtime 계약과 맞췄다.
- 랜딩 wedding minimum date를 UTC 날짜가 아니라 KST 날짜로 계산한다.
- production build fence가 `deployment_blocked` manifest를 우회하던 설정을 제거했다.

---

## 5. 검증·게시 영수증

### 5.1 고정 구현 SHA의 전체 source gate

아래 결과는 clean worktree의 exact SHA
`f8851f749890a172057f2e3a5360d11f3ea1163a`에서 직접 관측했다. Web 전체 Vitest는 단일
실행이 10분 동안 summary 없이 계속 worker를 교체해, 같은 고정 SHA에서 4개 결정적 shard를
순차 실행했다. 네 shard가 모든 test file을 한 번씩 포함했고 종료 후 잔류 worker가 없었다.

| 범위 | 결과 |
|---|---:|
| Web Vitest shard 1/4 | 162 files · 1,495 tests PASS |
| Web Vitest shard 2/4 | 162 files · 1,398 tests PASS |
| Web Vitest shard 3/4 | 161 files · 1,403 tests PASS |
| Web Vitest shard 4/4 | 161 files · 2,223 tests PASS |
| **Web Vitest 합계** | **646 files · 6,519 tests PASS · 0 fail** |
| Mobile 전체 tests | 511/511 PASS · 0 fail/skip/cancel |
| Mobile typecheck / lint | PASS / PASS |
| `mobile:release-check` | 105/105 PASS · 0 warnings/failures; EAS provider 전 fail-closed도 계약대로 PASS |
| safety classifier focused suite | 410/410 PASS — 실제 위기 대응 E2E 증거는 아님 |
| root typecheck | web·mobile·shared·design-tokens·ingest PASS |
| root lint | PASS — 기존 `browserStorageFallback.test.ts` unused eslint-disable warning 1건 |
| root repository contracts | 280/280 PASS |
| `supabase:release:test` | 189/189 PASS |
| `supabase:release:fence` | PASS — manifest `deployment_blocked`, active migration 86개 정합성 확인 |
| Web optimized source build | PASS — static pages 1,218/1,218, artifact 2,644 files scan; Production deployment 아님 |
| post-`origin/main` 의미 병합 제품 회귀 | Web 142/142 + 51/51, Mobile 67/67, web/mobile typecheck PASS |
| 독립 post-merge 적대 검수 | 새로 재현 가능한 P0/P1 없음 |

일반 `git push`의 pre-push hook은 같은 unsharded Web Vitest가 summary 없이 장시간 실행돼
완료 영수증을 만들지 못했다. 위 exact-SHA 4-shard 전체 통과와 나머지 전체 gate를 먼저
확정한 뒤 `HANBANG_SKIP_PREPUSH=1`로 원격 게시했으며, 이 예외는 PR 본문에도 공개했다.
테스트를 생략했다는 뜻이 아니라 장기 unsharded runner 대신 완결된 exact-SHA shard 영수증을
사용했다는 뜻이다.

### 5.2 작업 중 관측한 focused 증거

아래는 구현 과정의 RED→GREEN과 좁은 계약을 증명한 보조 영수증이다. 5.1의 최종 고정
snapshot을 대신하지 않으며 hosted·fleet·기기 증거도 아니다.

| 범위 | 결과 |
|---|---:|
| provider ledger/wrapper/chat/conflict 7 suites | 317/317 PASS |
| 신규 provider/invite/ingest PGlite 3 suites | 42/42 PASS |
| provider kill-switch scale PGlite 전체 | 23/23 PASS — 만료 역사 grant 512건 비갱신 포함 |
| provider wrapper/SDK/chat 경계 9 suites | 350/350 PASS |
| safety classifier 중간 focused suite | 402/402 PASS — 최종 고정 snapshot은 410/410, 실제 위기 대응 E2E 아님 |
| invite replay/expiry PGlite latest focused | 12/12 PASS — hosted migration 적용 증거 아님 |
| schedule web/momentLoop source·unit suites | 86/86 PASS — route/RPC/hosted E2E 아님 |
| schedule mobile pure/source contracts | 22/22 PASS — native UI E2E 아님 |
| successor release contract + production build fence focused | 24/24 PASS — 14 Node + 10 Vitest |
| dependency floor + `image-size` patch Node tests | 3/3 PASS |
| `supabase:release:fence` | PASS, manifest는 계속 `deployment_blocked` |
| provider 관련 web TypeScript/ESLint | PASS |
| schedule shared TypeScript + web/mobile TypeScript·ESLint | PASS |
| `git diff --check` | PASS |

### 5.3 원격 게시와 격리 Preview

- remote branch에 게시한 검증 product-code snapshot과 최초 Preview source가 exact SHA
  `f8851f74`와 일치하는 것을 확인했다. 이후 docs-only publication commit은 branch tip을
  바꿀 수 있으므로 현재 tip은 GitHub에서 별도로 조회한다.
- Draft PR [#105](https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/pull/105)을 열었다.
- Vercel deployment `dpl_AJEzS36JsP35THq85GL2d4WaXB6a`
  (`https://wedding-hanbang-me24b9s4q-hanbang.vercel.app`)는 target `preview`, state `READY`다.
- Preview는 Vercel deployment protection/SSO 뒤에 있으며 unauthenticated 요청은 인증으로
  redirect된다.
- 인증된 Vercel CLI read-only probe에서 `/api/journey`는 HTTP 503,
  `Cache-Control: no-store`, body `{"error":"preview_stub_api_disabled"}`를 반환했다.
- 같은 exact deployment의 read-only route smoke에서 `/`는 `/landing`으로 307,
  `/start-here`는 200(PRERENDER), `/manners`는 `/wedding/manners/`로 307,
  `/checklist`는 `/wedding/checklist/`로 307을 반환했다. 도착 페이지 `/landing`과
  `/wedding/manners`는 200(PRERENDER), `/wedding/checklist`는 200(no-store)을 반환했다.
  응답 body·cookie는 수집하지 않았다.
- 이 결과는 `NEXT_PUBLIC_PREVIEW_STUB_MODE=true`의 API fail-closed를 증명한다. 운영
  Supabase·실사용자 데이터·provider·Memory·push·media 기능을 검증하거나 허용하지 않는다.

아직 완료 증거가 아닌 것:

- hosted Supabase migration/backup/restore/storage/finalizer
- 실제 두 계정·두 기기·접근성 E2E
- provider runtime enable canary
- Production Web alias, 운영 DB apply, EAS build/submit
- 실제 사용자 데이터가 포함된 Preview 또는 Production smoke

---

## 6. successor manifest와 해시

이번 후보에서 추가한 active migration은 아래 순서다.

1. `20260811230000_amora_provider_egress_grant.sql`
2. `20260812030000_couple_invite_replay_hardening.sql`
3. `20260812090000_amora_server_only_chat_ingest.sql`

LF 정규화 SHA-256:

| migration | SHA-256 |
|---|---|
| provider egress | `e030763d1da01e4f514b2cd1581eb63b439ad3a3aaecc89e89d64bf10147c674` |
| invite replay | `0037ba639289fecc12f935c7eeee57a3f3bfc173516b67d67b951d82cf411a19` |
| server-only ingest | `98abb0e90f9a38546f4bb0d61b42bd196deb4805f9fc7a024cae24733bab7ade` |

`supabase/release-manifests/vendor-disclosure-v2-20260718.json`에는 세 migration과 exact
hash가 들어갔다. 신규 생성 테이블은 successor controller를 만들 때 post-expand backup
inventory에 포함돼야 하며, 그 요구는
`scripts/tests/successor-release-evidence-contract.test.mjs`가 정적으로 검사한다. 현재
controller manifest나 hosted backup receipt가 생성됐다는 뜻은 아니다.

hosted evidence 5종은 모두 `missing`이다. 다음 상태는 의도적으로 그대로다.

- `status = deployment_blocked`
- hosted staging evidence = missing
- backup evidence = missing
- restore evidence = missing
- Storage evidence = missing
- finalizer evidence = missing

정적 fence PASS는 이 차단 상태와 exact migration set이 맞다는 뜻이다. 운영 DB 적용
허가가 아니다.

---

## 7. 반드시 지킬 배포 순서

### 7.1 사전 조건

다음이 없으면 production을 시작하지 않는다.

- exact release SHA와 immutable artifact
- 현재 운영 DB의 tested backup과 별도 restore 증거
- migration lock/timeout 사전 점검
- current supported web/mobile fleet inventory
- old mobile direct INSERT caller 0건 증거
- generic mutation headerless Phase-A caller 0건과 Phase-B fresh attestation
- 구형 모바일의 직접 Supabase Auth password update caller 0건, minimum supported version 또는
  강제 업데이트, 가능한 server-side auth policy 확인
- 구형 10자 invite 입력 UI와 새 `WH-` + 12자(총 15자) code 회전의 영향 건수·fleet drain·
  사용자 재공유 안내
- provider app/env kill switch와 drain 절차
- rollback owner와 관측 dashboard

### 7.2 provider·DB·코드 전환

provider grant-aware code는 RPC가 없으면 fail-closed하고, migration은 runtime disabled로
시작한다. 따라서 무중단을 가장해 순서를 섞지 않는다.

1. 기존 앱의 provider egress app/env switch를 OFF한다.
2. 기존 provider-capable instance와 in-flight request를 drain한다.
3. tested backup과 restore receipt를 확인한다.
4. fleet·invite 영향 gate가 모두 통과한 maintenance window에서 active migrations를 exact
   manifest 순서로 적용한다.
5. grant-aware server artifact를 배포하고 exact SHA를 확인한다.
6. provider OFF 상태에서 auth, actor, chat ingest, invite, negative canary를 실행한다.
7. service-only CAS RPC로 DB provider runtime control을 enable한다.
8. 새 request로 count/create grant issue·consume canary를 확인한다.
9. 마지막에 app/env provider switch를 ON한다.
10. revoke/unlink/kill-switch 경쟁 canary와 provider receipt를 확인한다.

DB를 먼저 enable하고 old code를 그대로 두면 old code가 DB control을 무시하는 공백이 생긴다.
금지한다. 반대로 code를 migration 없이 실제 traffic에 먼저 놓으면 RPC 부재로 chat이
fail-closed한다. staging slot과 maintenance window로 전환한다.

### 7.3 Storage contract

immutable Storage contract는 다음 뒤에만 적용한다.

1. cleanup API 포함 server 배포
2. direct remove 제거 web artifact 배포
3. exact SHA 확인
4. 자기 fresh orphan 삭제 성공 canary
5. 같은 요청 재실행 `alreadyAbsent` 확인
6. bound path 409와 object 보존 확인
7. 다른 actor path 403과 object 보존 확인
8. supported web fleet와 browser asset/cache drain 증거
9. 그 뒤에만 `supabase/platform-operations/storage/20260714167000_chat_attachment_contract.sql`

### 7.4 invite Phase B

Phase A 적용과 server-only canary 뒤 최소 24시간 동안 외부 legacy 호출이 0건이어야 한다.
fleet drain과 fresh attestation까지 확보한 뒤에만 release-candidate SQL을 active migration으로
승격한다.

---

## 8. 아직 닫히지 않은 출시 조건

- successor manifest의 hosted staging·backup·restore·Storage·finalizer 증거 5종은 모두
  `missing`이고 status는 `deployment_blocked`다.
- provider DB runtime은 의도적으로 disabled이며 hosted issue/consume·revoke·kill-switch
  canary가 없다.
- generic mutation actor contract는 Phase A다. headerless legacy 허용 경로의 fleet drain과
  Phase B 강제 gate를 닫지 않았다. reset/password/delete의 strict source 계약만으로 일반
  mutation까지 strict하다고 주장하지 않는다.
- 이미 설치된 구형 모바일의 직접 Supabase Auth password SDK 경로를 server source로 회수할
  수 없다. minimum supported version·강제 업데이트 또는 old-fleet 0건 증거가 없다.
- 구형 binary는 invite를 10자까지만 입력할 수 있지만 새 active invite는 총 15자다.
  migration의 code rotation 전에 구형 fleet 0건과 사용자 재공유 절차가 필요하다.
- 구형 chat direct-writer 0건 증거가 없어 server-only ingest migration을 hosted에 적용할 수
  없다.
- conversation segment migration과 read path는 source에 있으나 hosted 적용과
  `AMORA_CONVERSATION_SEGMENT_READ_ENABLED=true` 증거가 없다.
- 현재 `대화 화면 정리`는 화면 필터이며 모델 문맥 초기화라고 주장하지 않는다.
- 과거 대화 보기와 실제 `새 대화 시작` UI는 아직 열지 않았다.
- attachment DB/Storage cross-system atomic claim과 장기 orphan janitor가 없다.
- invite recipient binding과 fresh re-auth UX가 없다.
- 실제 두 계정·두 기기의 shared/private/unlink/account-switch E2E가 없다.
- TalkBack/VoiceOver, 작은 화면, 저속 네트워크, background/foreground 기기 QA가 없다.
- hosted provider 로그에 raw prompt가 남지 않는다는 계약 검증이 없다.
- 개인정보 법률 검토와 독립 보안 검토가 없다.
- production controller hosted 증거 5종이 없다.
- tested DB backup/restore와 별도 Storage backup/restore, Storage contract/finalizer,
  두 계정·두 기기·실제 모바일 기기 QA receipt가 없다.

이 항목이 남아 있는 동안 다음 표현을 사용하지 않는다.

- `절대 유출되지 않는다`
- `모든 정보가 완전히 분리됐다`
- `새 대화라서 과거 문맥을 전혀 읽지 않는다`
- `모든 테스트가 끝났고 배포 준비가 완료됐다`
- `Preview가 성공했으므로 Production도 안전하다`

---

## 9. 다음 LLM의 재개 순서

```powershell
git status --short --branch
git rev-parse HEAD
git fetch --prune origin
git rev-parse origin/main
git diff --check
```

dirty worktree이면 reset·clean·checkout으로 없애지 않는다. 이 문서와 `git diff`를 먼저 읽고
현재 실행 중인 test process를 확인한다.

현재 Preview는 `NEXT_PUBLIC_PREVIEW_STUB_MODE=true`와 Vercel deployment protection을 확인한
격리 artifact다. 운영 Supabase·실제 사용자 데이터를 쓰지 않는 synthetic UI smoke만 허용한다.
이 격리 또는 feature-off를 더 이상 증명할 수 없으면 즉시 사용을 중단한다. Preview는
Production 승격 후보가 아니며 Production alias·DB migration·실제 사용자 테스트는 계속
금지한다.

그 다음 순서:

1. remote branch와 Draft PR #105의 실제 head를 조회하고, 검증된 구현 SHA `f8851f74` 이후
   변경을 먼저 diff한다. 과거 검증을 새 product-code SHA에 자동 상속하지 않는다.
2. 모바일 Stop·first shared confirmation·ambiguous ingest reconciliation과 actor fence의
   최신 source/test 계약을 대조하고, 같은 기능을 다시 구현하지 않는다.
3. product code가 바뀌었으면 가장 가까운 회귀부터 시작해 full mobile·4-shard Web Vitest,
   root typecheck/lint/contracts/build를 다시 실행하고 exact SHA와 수치를 기록한다.
4. 두 synthetic 계정으로 known/general/unknown moment의 추가·수정·해제, 파트너 승인·거절,
   실제 `progress.__events` 저장을 확인한다.
5. D-3/D-1/D+1 후보의 중복 방지와 consent/feature-off 미전달을 격리된 hosted 환경에서
   확인하고, TalkBack·VoiceOver·큰 글자 실제 기기 일정 폼 QA를 수행한다.
6. review checklist로 SQL lock, mixed-version rollout, LLM prompt, privacy leak를 재검토한다.
7. generic headerless Phase A, 구형 direct password SDK, invite
   10→15자, direct-writer fleet의 배포 blocker를 release checklist에 별도 항목으로 남긴다.
8. Preview는 현재 protection·stub receipt가 유지될 때만 synthetic 입력 QA에 사용한다.
9. hosted evidence 5종, provider canary, fleet/min-version, backup/restore, Storage/finalizer,
   두 기기·실기기 QA를 각각 별도 운영 영수증으로 닫는다.
10. Production은 위 hosted evidence와 fleet gate를 모두 닫은 뒤 별도 승인 절차로 진행한다.
