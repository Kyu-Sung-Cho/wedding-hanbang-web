# 아모라 개인정보 경계·소비자 안전 전체 설계

- 기준일: 2026-08-04 (Asia/Seoul)
- 기준 브랜치: `agent/release-handoff-20260731`
- 기준 커밋: `a4f3626e5f98772b340b358b00a562b4692254fd`
- 문서 상태: **목표 아키텍처 및 출시 통제 정본 초안**
- 현재 판정: **개인정보 안전 출시 NO-GO**

## 0. 이 문서의 결론

아모라의 소비자 경험은 하나의 편안한 진입점으로 유지한다. 그러나 내부 데이터와 실행 문맥은 절대로 하나의 긴 채팅으로 합치지 않는다.

사용자에게 보이는 공간은 두 개다.

1. `나만 상담`
2. `함께 대화`

내부 실행 lane은 세 개다.

1. `private_ai`: 나와 아모라
2. `shared_ai`: 현재 커플과 아모라
3. `shared_partner`: 현재 파트너에게 직접

메시지, 초안, 첨부, AI 문맥, 메모리, 결정, 알림, 재시도, 검색 결과와 오류 복구 상태는 lane
사이에서 자동 이동하지 않는다. 내용을 더 넓은 범위로 옮기는 유일한 방법은 canonical source의
공개권을 가진 사람이 정확한 새 문구와 대상을 확인한 뒤 만드는 별도 `공유본`이다. 상대
작성분이나 공동 문맥은 양쪽의 서로 독립된 승인이 없으면 옮길 수 없다.

기술적으로 모든 사고 가능성을 0%라고 약속할 수는 없다. 이미 상대가 본 화면, 잠금화면에 표시된 알림, 스크린샷, 침해된 기기까지 되돌릴 수 없기 때문이다. 아모라가 약속해야 할 것은 검증 가능한 다음 계약이다.

> 알 수 없거나 서로 맞지 않는 사용자·커플·관계·범위·수신자 상태에서는 저장, 전송, AI 처리와 파생 작업을 시작하지 않는다. 사용자의 초안은 원래 문맥에만 남기고, 무엇이 멈췄는지 정직하게 알린다.

이 문서는 `PRINCIPLES.md`의 우선순위에 따라 개인정보와 신뢰를 편의성보다 먼저 둔다. 편의성은 이 안전 경계를 통과한 선택지 안에서 최대로 만든다.

---

## 1. 사실성 표기와 문서 권한

### 1.1 표기

- `E`: 이번 검토에서 코드, 로컬 문서, 명령 또는 화면으로 직접 확인한 사실
- `S`: 공식 원문으로 확인한 외부 계약
- `I`: E/S 사실에서 도출한 설계 판단
- `UNVERIFIED`: 운영 계정, 실제 배포 또는 제3자 계약 증거가 아직 없는 상태

### 1.2 충돌 시 우선순위

1. `PRINCIPLES.md`
2. 실제 운영 증거와 실행 코드
3. 이 문서
4. 기존 제품·운영 계획 문서

이 문서는 구현 완료 보고가 아니다. 코드, DB, Storage, 모바일 빌드와 운영 설정이 이 계약을 증명한 뒤에만 해당 항목을 완료로 바꾼다.

### 1.3 외부 기준

- 전체 애플리케이션: OWASP ASVS 5.0의 Level 2를 최소 목표로 삼고, 인증·권한·관리자·키·삭제·아모라 개인정보 경계는 Level 3 관점까지 검증한다.
- AI 경계: OWASP LLM Verification Standard를 추가로 적용한다. 이는 일반 보안 검증을 대체하지 않는다.
- 개인정보 위험: NIST Privacy Framework처럼 수집부터 삭제·백업 복원까지 전체 생명주기로 본다.

공식 출처:

- <https://owasp.org/www-project-application-security-verification-standard/>
- <https://owasp.org/www-project-llm-verification-standard/LLMSVS-v2.0-en.html>
- <https://www.nist.gov/privacy-framework/getting-started-0>

### 1.4 관련 문서와 역할

- `docs/AMORA_CONVERSATION_FOUNDATION_2026-08-01.md`: 현재 lane·segment 제품 기반
- `docs/AMORA_INTEGRATED_CARE_PRODUCT_SPEC_2026-07-30.md`: W0~W5 케어·말투·실행 계약
- `docs/operations/AMORA_SAFETY_RELEASE_HANDOFF_2026-08-04.md`: Wave A/B의 실제 로컬·운영 상태
- `docs/operations/AMORA_CHAT_ATTACHMENT_ORPHAN_LIFECYCLE_RELEASE_CANDIDATE_2026-08-04.md`:
  첨부 Wave C 후보와 미구현 범위
- `docs/operations/CURRENT_COUPLE_MEMBERSHIP_PRIVACY_FENCE_2026-07-17.md`:
  현재 membership 증명과 운영 차단 근거
- `docs/AMORA_NEUTRAL_COUPLE_MEMBER_MIGRATION_PROPOSAL_2026-08-02.md`:
  stable member/roster 전환 제안, 현재 미구현

이 문서는 위 문서를 삭제하거나 완료로 재분류하지 않는다. 개인정보 목표 상태와 서로
흩어진 출시 게이트를 하나의 검증 가능한 계약으로 묶는다.

---

## 2. 현재 상태와 출시 판정

### 2.1 현재 잘된 기반

다음 기반은 유지하고 더 강하게 만든다.

- `E` AI 문맥은 클라이언트가 보낸 전체 history가 아니라 서버의 canonical 메시지에서 재구성한다.
- `E` 개인 AI 문맥은 상대방의 직접 메시지를 포함하지 않는다.
- `E` 현재 RLS는 개인 메시지를 본인에게만 보이도록 분리한다.
- `E` 파트너 수신자를 현재 커플 구성에 맞추는 DB 경계가 있다.
- `E` AI 처리 중 privacy epoch가 바뀌면 결과 최종 저장을 막는 경계가 있다.
- `E` 개인 대화 영구 삭제 RPC는 여러 파생 데이터를 함께 정리한다.
- `E` AI 감사 helper는 질문·답변·도구 원문을 `ai_interactions_log`에 기록하지 않는다.
- `E` 모바일 Sentry와 커뮤니티 알림에는 내용 최소화 기반이 있다.
- `E` 인증 클라이언트의 직접 채팅 INSERT를 닫는 Wave B 후보가 준비되어 있다.

### 2.2 출시를 막는 P0

| ID | 확인된 문제 | 실패 결과 | 필수 조치 |
|---|---|---|---|
| P0-1 | 모바일에서 A가 만든 초안과 전송 시점의 현재 bearer B가 분리될 수 있다 | 같은 커플 A의 문구가 B 소유 개인/공유 메시지로 먼저 저장될 수 있다 | 작성자에 결박된 command lease와 저장 전 actor 일치 검증 |
| P0-2 | 공동 액션 승인도 클릭 당시 사용자 대신 전송 시점 bearer로 기록될 수 있다 | B가 누르지 않은 동의를 B 동의로 만들 수 있다 | 승인 명령도 동일한 actor-bound envelope/RPC 사용 |
| P0-3 | 저장 노트 API가 임의 본문과 선택적 `messageId`를 커플 공유 노트로 저장한다 | 개인 대화가 provenance 없이 커플 공유 파생물로 남을 수 있다 | canonical source와 scope 상속, 별도 공유 승인 |
| P0-4 | 모바일 기억 화면이 요청 시작 사용자를 고정하지 않는다 | A의 지연 응답이 계정 전환 뒤 B 화면에 보일 수 있다 | expected-user API, generation 검증, 동기식 화면 봉인 |
| P0-5 | OpenAI token-count가 full prompt를 `beforeGeneration`/최종 capability 확인 전에 외부로 보낸다 | unlink·삭제·kill-switch 경합 뒤에도 원문 provider egress가 생길 수 있다 | 모든 content-bearing egress 전에 audit/capability/current-state claim |

직접 확인한 경로:

- `apps/mobile/app/(tabs)/chat.tsx`
- `apps/mobile/app/settings/amora-memory.tsx`
- `apps/web/src/app/api/chat/messages/route.ts`
- `apps/web/src/app/api/amora/shared-actions/[actionId]/route.ts`
- `apps/web/src/app/api/amora/notes/route.ts`
- `apps/web/src/lib/ai/auditedOpenAI.ts`
- `apps/web/src/lib/ai/openai.ts`

### 2.3 출시를 막는 P1

- `E` 웹 채팅의 계정·커플·파트너 변경 정리가 렌더 뒤 `useEffect`에 의존한다. 이전 초안·첨부·조율 상태가 새 문맥과 한 프레임 공존할 수 있다.
- `E` URL/session prefill이 대상 확인 없이 `shared_ai` 입력창으로 들어간다.
- `E` 개인 상담을 커뮤니티 글로 바꾸는 경계가 정규식과 사용자 미리보기에 크게 의존한다. 의미상 민감정보는 정규식으로 제거할 수 없다.
- `E` 연결 전 `shared` 기록은 나중에 연결된 파트너가 읽을 수 있는 현재 membership 기반이다.
- `E` 인증 사용자의 직접 `chat_messages` INSERT 정책이 아직 active 경로에 남아 있다. Wave B는 운영 적용 완료 상태가 아니다.
- `E` 현재 첨부 업로드는 메시지와 원자 결합되지 않아 orphan이 생길 수 있다. Wave C는 런타임 미구현 상태다.
- `E` 발급된 signed URL은 권한 변화와 동시에 자동 취소되지 않는다.
- `E` 웹 Sentry는 모바일과 같은 중앙 원문 scrubber가 없고, 공용 logger가 임의 payload를 `extra`로 보낼 수 있다.
- `E` 함께 대화의 `새로 시작`은 원문 삭제가 아니라 읽기 cursor 이동이다.
- `E` 운영 current-membership privacy fence와 로컬 후보의 동일성·적용 완료가 아직 증명되지 않았다.
- `E` 현재 AI 비용/turn 제한의 일부가 couple 단위다. private 사용량까지 같은 잔여량에
  반영되면 파트너가 거부·remaining 변화로 상대의 private AI 사용 존재/빈도를 추론할 수 있다.
- `E` 현재 커플 초대는 `couples.invite_code`를 평문으로 조회·저장한다. 최신 generator는
  UUID의 앞 12 hex를 사용하지만, 만료·일회성 소비·수신자 결박·HMAC 전용 ledger가 아니다.
- `E` 모바일은 현재 `chat_messages` 원문을 직접 select하고 Realtime 구독한다. 암호화/BFF로
  전환할 때 mutation만 구형 앱에서 막으면 옛 binary의 read/subscription 경로가 남는다.
- `E` 모바일은 `expo-updates`, production update URL/runtimeVersion/channel을 사용한다. OTA
  JavaScript는 민감 데이터 접근 코드를 앱스토어 재심사 없이 바꿀 수 있는 별도 code plane이다.
- `UNVERIFIED` production OTA의 pinned 서명, key custody, EAS 조직 MFA/권한, preview 채널 격리와
  manifest→Git SHA release receipt를 실제 계정·실기기에서 증명한 자료가 없다.
- `E` 공개 데모에서 개인 초안이 함께 입력창에 남는 UI 회귀가 2026-08-04에 2/2 재현됐다. 서버 오발송까지 시험한 것은 아니지만 출시 차단 UI 경계다.
- `UNVERIFIED` OpenAI의 실제 운영 조직/프로젝트에 ZDR 또는 MAM, 처리 지역, DPA, 삭제 계약이 적용됐다는 증거가 없다.
- `UNVERIFIED` 정확한 웹 SHA, 모바일 build, hosted migration head, Storage policy digest가 하나의 출시 영수증으로 묶여 있지 않다.

새로 확인한 P1 근거 경로:

- `apps/web/src/app/api/couple/code/route.ts`
- `supabase/migrations/20260714160000_harden_amora_privacy_boundaries.sql`
- `apps/mobile/app/(tabs)/chat.tsx`
- `apps/mobile/package.json`, `apps/mobile/app.json`, `apps/mobile/eas.json`

### 2.4 판정

지금은 “나만의 채팅과 커플 채팅이 확실히 분리됐다”고 소비자에게 보증할 수 없다. P0를
닫고 해당 기능의 P1 절대 게이트와 운영 증거를 확보할 때까지 위험 mutation은 `read_only`,
안전성을 증명하지 못한 read/provider egress는 `disabled`여야 한다.

---

## 3. 소비자에게 보이는 대화 구조

### 3.1 한 진입점, 세 개의 독립 문맥

```text
아모라
├─ 나만 상담
│  └─ private_ai: 나 ↔ 아모라
└─ 함께 대화
   ├─ shared_ai: 현재 두 사람 ↔ 아모라
   └─ shared_partner: 나 → 현재 파트너
```

한 화면처럼 자연스럽게 이동할 수는 있지만 다음 상태는 모두 별도 key로 저장한다.

privacy namespace는 scope별 discriminated key다.

```text
private_ai:
  accountId + personalWorkspaceId + personalPrivacyEpoch
  + segmentId + lane + authSessionGeneration

shared_ai / shared_partner:
  accountId + coupleId + memberId + membershipSecurityEpoch
  + sharedContextEpoch + segmentId + lane + deliveryTarget
  + recipientId + authSessionGeneration
```

개인 공간은 커플 구성원 slot에 귀속하지 않는다. unlink·새 커플 연결 뒤에도 같은 사용자의
`personalWorkspaceId`에 남고, 이전 커플 사실은 명시적 source import 없이는 새 private
AI 문맥에도 자동 재사용하지 않는다.

하나라도 바뀌면 이전 subtree를 즉시 unmount하고, 새 문맥 검증이 끝날 때까지
`계정을 확인하고 있어요`라는 중립 shell만 렌더한다. 실제 불일치가 확인됐을 때만
`계정이 전환되어 보내지 않았어요`라고 설명한다. `useEffect`에서 나중에 지우는 방식은
허용하지 않는다.

### 3.2 입력창 계약

입력창 바로 위와 전송 버튼에 실제 대상을 텍스트로 표시한다.

- `나만 상담 · 파트너에게 보이지 않아요`
- `두 사람이 함께 보는 상담 · 아모라에게 보내기`
- `김지은님에게 직접 보내기`
- `아모라는 이 직접 메시지를 답변 근거로 사용하지 않아요`

파트너 identity를 정확히 확인하지 못하면 `상대방에게 보내기` 같은 모호한 fallback을 쓰지 않는다. 직접 전송 버튼을 잠그고 재확인한다.

색상만으로 범위를 구분하지 않는다. 텍스트, 잠금/사람/아모라 아이콘, 접근성 이름을 함께 사용한다.

`파트너에게 보이지 않아요`는 `아무 시스템도 처리하지 않는다`는 뜻이 아니다. 최초
private AI 사용 전에 짧은 trust sheet로 답변을 위해 웨딩한방 서버와 현재 고지된 AI
처리자가 내용을 처리한다는 점, 저장·보유·삭제 범위와 파트너 미공유를 구분해 알린다.

### 3.3 전송 마찰은 위험도에 비례

| 행동 | UX | 서버 계약 |
|---|---|---|
| 현재 lane의 일반 AI 질문 | 한 번 탭 | scope-bound command lease 검증 |
| 파트너 직접 전송 | 짧은 전달 보류와 Undo | 보류 중에는 DB 전달·push·AI 파생 0 |
| 개인 → 함께/파트너 | 공유본 미리보기와 명시 승인 | 일회성 declassification grant |
| 개인/함께 → 공개 | 독립 공개 초안과 source 권리자 승인 | 공개 destination에 결박된 grant; 공동 source는 양쪽 독립 승인 |
| 연결 전 기록 → 새 파트너 | 항목별 선택 | 새 membership security epoch로 복사본 생성 |

모든 메시지에 확인창을 띄우지 않는다. 반복 경고는 사용자가 무시하게 된다. 경계가 바뀌는 행동만 정확히 멈춘다.

---

## 4. 데이터 분류와 허용 행위

### 4.1 분류

| 등급 | 예시 | 기본 범위 |
|---|---|---|
| C0 공개 | 사용자가 확정 게시한 커뮤니티 본문 | `public` |
| C1 운영 메타데이터 | 모델명, 토큰 수, 성공/실패, content-free request ID | `system_restricted` |
| C2 계정 개인정보 | 이메일, 소셜 식별자, push token, 프로필 | `user_private` 또는 인증 전용 |
| C3 커플 준비 정보 | 공유 예산, 일정, 할 일, 확정 결정 | `couple_shared` |
| C4 개인 상담 | 개인 질문, 갈등, 선호, 개인 기억, 개인 초안 | `user_private` |
| C5 고위험 내용 | 계약서·신분/계좌·건강·폭력·성 관련 정보, 원본 첨부 | 명시 목적의 최소 범위, 기본 AI/공개 금지 |
| S 비밀 | 비밀번호, API key, service role, KMS key | 애플리케이션 콘텐츠로 저장·전송 금지 |

법적 민감정보 분류를 이 표만으로 확정하지 않는다. 실제 수집 항목과 처리 지역을 기준으로 개인정보 전문가와 법률 검토가 별도로 필요하다.

의미상 고위험 텍스트를 자동 탐지기로 완벽히 분류할 수는 없다. 탐지는 경고와 차단의
보조 수단일 뿐이다. private text 전체가 민감할 수 있다는 전제로 provider 계약과 로그
경계를 설계하고, 고위험 첨부는 파일 유형·사용자 선택·검증된 기능 범위로 별도 차단한다.

### 4.2 처리 행렬

| 등급 | DB/Storage | AI provider | 분석·오류 도구 | push | 공개 전환 |
|---|---|---|---|---|---|
| C0 | 허용 | 공개 목적에 필요한 경우만 | 본문 없이 이벤트만 | 일반 알림 | 이미 공개 |
| C1 | content-free, 제한 보관 | 보내지 않음 | allowlist만 | 보내지 않음 | 금지 |
| C2 | 필수 필드만 | 안정 식별자 외 금지 | 원 ID·이메일 금지 | opaque installation만 | 금지 |
| C3 | current audience/epoch 결박 | 사용자가 요청한 shared AI 목적에 최소 문맥만 | 원문 금지 | 내용 없는 알림 | 별도 공개 grant |
| C4 | owner/epoch 결박 | 승인된 provider 계약과 해당 기능 목적에 최소 문맥만 | 원문 금지 | 항상 일반 문구 | shared/public grant 필수 |
| C5 | 기능별 명시 opt-in, 짧은 lifecycle | 계약·처리 경계 증명 전 기본 금지 | 전부 금지 | 전부 금지 | 자동 전환 금지 |
| S | 전용 secret/KMS 경계 | 금지 | 금지 | 금지 | 금지 |

### 4.3 최소 수집

- 일정 알림에는 일정 제목 전체가 아니라 일정 ID, due bucket, scope만 사용한다.
- 예산 경고에는 원문 메모·업체명 없이 threshold 상태만 사용한다.
- AI 감사에는 원문 대신 operation ID, 모델, usage, status, latency, 정책 결과만 사용한다.
- 추천과 통계에는 개인 대화 원문을 재사용하지 않는다.
- 새로운 목적이 생기면 기존 동의를 포괄적으로 해석하지 않고 별도 product/legal gate를 연다.

---

## 5. 정확한 audience 모델

단순히 `private < shared < public`인 일렬 분류로 보면 안 된다. A 개인과 B 개인, 특정 파트너 direct는 서로 비교할 수 없는 별도 ACL이다.

### 5.1 scope 종류

```text
system_restricted
user_private(owner_user_id, personal_workspace_id, personal_privacy_epoch)
couple_shared(couple_id, membership_security_epoch, audience_snapshot)
partner_direct(sender_member_id, recipient_member_id, membership_security_epoch)
sealed_shared_archive(original_audience_snapshot, sealed_membership_security_epoch)
public(publication_id)
```

### 5.2 핵심 규칙

1. 같은 scope 안의 변환만 기본 허용한다.
2. 파생물 audience는 모든 부모 audience의 교집합보다 넓을 수 없다.
3. 범위를 넓히는 모든 행위는 `declassification`이다.
4. 현재 `couple_id`가 같다는 이유로 과거 audience를 새 구성원에게 상속하지 않는다.
5. 알 수 없는 visibility, recipient, epoch, provenance는 shared로 추정하지 않고 quarantine한다.
6. active shared mutation은 current membership을 요구한다. unlink 뒤 과거 기록 읽기는
   별도 `sealed_shared_archive` 정책으로만 허용하며 original audience, re-auth,
   read-only를 모두 만족해야 한다.

### 5.3 연결 전 기록

파트너가 없을 때 `함께`처럼 보이는 기록은 실제 shared가 아니다.

```text
prelink_private(owner, prelink_segment)
```

첫 연결은 새 `membership_security_epoch`와 새 shared segment를 만든다. 기본 선택은
`오늘부터 새로 공유`다. 과거 기록은 사용자가 정확한 항목을 골라 공유본으로 만들 때만
새 공간에 들어간다.
과거 기록 공유본의 최종 승인은 recent re-auth와 새 relationship의 exact audience를 요구한다.

### 5.4 Epoch를 한 숫자로 합치지 않기

| epoch | 바뀌는 사건 | 무효화 대상 |
|---|---|---|
| `auth_session_generation` | login/logout/token family 변경 | 해당 session의 요청·화면·push tap |
| `personal_privacy_epoch` | 개인 공간 삭제·키 회전·보안 revoke | private lease, key, memory, pending work |
| `membership_security_epoch` | link/unlink/member 교체·관계 revoke | shared/partner lease, audience, delivery |
| `shared_context_epoch` | shared segment clear/seal/new context | AI context와 cursor, 과거 소유권은 유지 |
| `preference_version` | 답변 길이·말투·도움 방식 변경 | 다음 답변 설정만, 전송 권한은 유지 |

현재의 포괄적 `privacy_epoch`가 단순 설정 변경에도 증가한다면 그대로 composer security
lease에 쓰지 않는다. 보안 revoke와 일반 personalization 변경을 분리해 정상 입력을
불필요하게 끊지 않으면서 권한 변화는 반드시 차단한다.

### 5.5 내용뿐 아니라 활동 metadata도 audience를 상속

private 상담을 했다는 사실과 빈도도 private다.

- private quota/cost ledger는 personal workspace에, shared quota는 shared scope에 둔다.
- B에게 보이는 shared remaining/error는 A의 private turn 전후로 달라지지 않는다.
- private와 shared가 서로의 customer-visible capacity를 소진하지 않게 별도 reserve를 둔다.
  provider 전체 장애·system-wide overload는 범위별 remaining을 노출하지 않는 공통 가용성
  상태로 처리하며 특정 사용자의 private 활동과 결박하지 않는다.
- private typing, online presence, read receipt, unread count, last activity, sequence, retry/error와
  provider latency를 partner/shared event로 내보내지 않는다.
- global safety/cost cap은 서버 내부 집계로만 사용하고 어느 사용자의 private 활동 때문에
  제한됐는지 사용자 응답으로 설명하지 않는다.
- notification, analytics, support dashboard의 count/bucket도 원 artifact scope를 상속한다.
- globally increasing ID/sequence로 private row 수를 추정하지 못하게 opaque ID와 scope-local
  cursor를 사용한다.

---

## 6. 절대 불변식

아래 불변식은 UI 문구나 클라이언트 코드가 아니라 서버와 DB가 강제한다.

1. **Actor binding**: bearer 사용자와 명령의 `expectedActorUserId`가 다르면 어떤 쓰기도 시작하지 않는다.
2. **Current principal**: private 명령은 authenticated user와 personal workspace/privacy
   epoch를 확인한다. shared/partner 명령은 추가로 profile couple link, stable member,
   current membership security epoch를 모두 확인한다.
3. **Exact destination**: lane, target, recipient, scope가 정확히 일치해야 한다.
4. **No cross-epoch replay**: auth session, personal privacy 또는 membership security
   epoch가 바뀐 명령은 재시도하지 않는다.
5. **Canonical derivatives**: 파생 API는 임의 원문이 아니라 canonical source ID에서 서버가 읽는다.
6. **Audience inheritance**: 기본 파생물은 원본보다 넓게 보이지 않는다. 범위를 넓히는
   예외는 아래 exact declassification predicate 하나뿐이다.
7. **Source-authorized declassification**: private/shared→더 넓은 대상은 canonical source의
   공개권을 가진 작성자와 필요한 공동 권리자의 독립 승인, source version, exact preview,
   destination에 결박된 일회성 grant를 같은 DB transaction에서 소비해야만 가능하다.
8. **Partner exclusion**: partner-direct 원문은 AI 문맥, 요약, 기억, 중재에 들어가지 않는다.
9. **Content-free telemetry**: 로그, 분석, 오류, push, URL에 대화·첨부 원문을 넣지 않는다.
10. **Metadata audience**: typing, unread, quota, count, timing, presence와 활동 존재도 원
    artifact보다 넓게 공개하지 않는다.
11. **Provenance deletion**: 삭제·회수는 메시지와 모든 파생물의 계보를 따라간다.
12. **Old-client denial**: 안전 계약을 모르는 앱은 민감 mutation, raw read 또는 Realtime
    subscription을 실행하지 못한다.
13. **Evidence-bound release**: 실행 중인 코드 SHA, 모바일 build/OTA, DB·Storage·provider
    정책을 입증하지 못하면 위험 기능을 켜지 않는다.
14. **Fail closed without cross-account exposure**: 검증 실패 시 전송을 막는다. 같은
    사용자의 scope 전환은 원래 lane에서만 초안을 복구하고, 로그아웃·계정 전환에서는
    새 계정에 한 글자도 보이지 않게 원계정 봉인 저장 또는 명시 폐기 정책을 적용한다.
15. **No silent fallback**: provider, DB, permission, delete, share 상태를 모르면 성공이나 shared로 간주하지 않는다.

---

## 7. 신뢰 경계와 위협 모델

```text
[Web / Mobile]
  untrusted UI, stale state, old client, compromised device
        |
        | authenticated request + context lease + command
        v
[Privacy Gateway / BFF]
  actor · membership · epoch · scope · recipient · version 검증
        |
        +----> [Command/Receipt RPC] ----> [Encrypted Postgres + RLS]
        |             |                         |
        |             +----> [AI Outbox]        +----> [Opaque Realtime event]
        |                         |
        |                         v
        |                    [AI Gateway] ----> [OpenAI]
        |
        +----> [Content Decryption Gateway] ----> [KMS/HSM]
        |
        +----> [Upload Session] ----> [Private Storage]
        |
        +----> [Notification Outbox] ----> [Expo Push Service] ----> [APNs/FCM]
        |
        +----> [Content-free Observability]
```

모바일 앞에는 App Store/Play 서명 binary와 pinned production OTA manifest 검증이라는 별도
code-supply 경계가 있다. OTA control plane을 일반 콘텐츠 API나 개발 preview 계정과 같은
권한 plane에 두지 않는다.

### 7.1 주요 위협 주체

- 다른 커플의 정상 사용자
- 같은 커플의 상대방과 전 파트너
- 한 기기에서 빠르게 계정을 바꾸는 사용자
- 오래된 앱, 변조된 클라이언트, 재전송 공격자
- 탈취된 세션 또는 signed URL 보유자
- 잘못 작성된 서버 route와 service-role 오용
- 운영자와 내부자
- AI, 호스팅, 분석, 오류, push 처리업체
- OTA/EAS 조직 계정, production channel 또는 signing key 탈취자
- 백업 복원 또는 migration drift
- 브라우저 URL, referrer, clipboard, 잠금화면, 앱 스위처

### 7.2 STRIDE 관점

| 범주 | 아모라 실패 예 | 방어 |
|---|---|---|
| Spoofing | A 클릭/초안을 B bearer가 실행 | actor-bound lease와 session binding |
| Tampering | 승인 뒤 proposal/수신자 변경 또는 악성 OTA bundle | exact digest, immutable recipient, one-time receipt, pinned OTA signature |
| Repudiation | 누가 무엇을 공유 승인했는지 모름 | content-free immutable consent receipt |
| Information disclosure | private→note/public/log/push | audience inheritance, declassification, sink scrubber |
| Denial of service | privacy check 장애로 전체 초안 유실 | read-only와 원래 scope의 안전 복구 |
| Elevation of privilege | service role 또는 직접 INSERT가 RLS 우회 | 최소권한 RPC, grant revoke, break-glass |

---

## 8. Identity-bound command protocol

### 8.1 Composer lease

각 composer가 열릴 때 서버가 짧게 유효한 lease를 발급한다.

```text
amora_composer_leases
- id
- principal_type = user
- actor_user_id
- personal_workspace_id / personal_privacy_epoch (private일 때 필수)
- actor_member_id / couple_id / membership_security_epoch (shared일 때 필수)
- shared_context_epoch
- segment_id
- lane
- delivery_target
- recipient_member_id
- auth_session_binding_hmac
- contract_version
- status
- expires_at
- revoked_at
```

계정, 커플, 역할, 파트너 또는 보안 epoch가 바뀌면 lease를 폐기한다. session binding은
raw bearer/refresh token이 아니라 서버가 검증한 session identifier의 purpose-separated
HMAC이다. 이전 lease를 새 bearer로 제출하면 DB 쓰기 전에 `409` 또는 `412`로 종료한다.

### 8.2 Command envelope

모든 메시지, 승인, 메모, 공개 전환, 첨부 finalize 명령은 다음을 포함한다.

```text
contractVersion
clientRequestId
composerLeaseId
expectedActorUserId
personalWorkspaceId / personalPrivacyEpoch (private scope)
expectedMemberId / expectedCoupleId / membershipSecurityEpoch (shared scope)
sharedContextEpoch
segmentId
lane
deliveryTarget
expectedRecipientMemberId
sourceArtifactId
payload (TLS 안의 원문, 로그 금지)
clientPlatform
clientBuild
```

`expectedActorUserId`를 클라이언트가 보낸다는 사실 자체는 신뢰 근거가 아니다. 서버가 bearer와 lease, 현재 DB roster를 모두 비교해 일치 여부만 사용한다.

클라이언트는 authoritative HMAC을 만들지 않는다. 서버가 payload를 UTF-8, Unicode,
newline, JSON key order와 attachment byte 규칙에 따라 canonical bytes로 만든 뒤
`purpose + tenant/workspace + scope + security epoch + key version`이 분리된 비밀 키로
`server_content_binding_hmac`을 계산한다. declassification preview도 서버가 같은 방식으로
결박한다. client-side hash는 업로드 UX 보조일 뿐 권한·무결성 증거가 아니다.

`clientBuild`와 platform header도 위조 가능하므로 authorization 근거가 아니다. old-client
차단은 서버가 이해하는 contract endpoint/schema, server-issued lease capability와 DB grant
회수로 강제한다. build 값은 호환 안내와 관측에만 쓴다.

### 8.3 예약과 commit

```text
client
  -> Privacy Gateway 검증
  -> authenticated reserve/execute RPC
       현재 actor/roster/epoch/lease row lock
       unique idempotency 및 binding 확인
       content-free reservation receipt
  -> delivery/commit RPC
       receipt lock
       현재 actor/roster/epoch/lease/mode/recipient 전부 다시 확인
       message + audience + outbox + result 원자 저장
  -> response
```

일반 AI 메시지는 가능한 한 `lease 검증 + idempotency + receipt + user message + audience +
AI outbox`를 하나의 DB transaction에서 끝낸다. delivery hold, 양쪽 승인, 외부 worker처럼
두 단계가 필요한 경우에는 commit이 reserve 결과를 신뢰하지 않고 다음을 다시 row lock으로
확인한다.

- bearer에 결박된 actor와 receipt actor
- current principal과 personal privacy 또는 membership security epoch
- lease status/expiry/session binding
- lane, recipient와 audience
- runtime mode와 minimum client contract
- receipt가 아직 미사용이고 content binding이 같은지

reserve와 commit 사이에 logout, unlink, epoch 회전, recipient 변경, kill switch가 있으면
receipt를 `cancelled_stale_context`로 끝내고 write/outbox를 0건으로 유지한다. DB transaction을
provider 호출 동안 열어 두지 않는다. provider worker와 결과 finalizer는 claim/commit마다
동일 current-state 검증을 반복한다.

동일 `(actor_user_id, client_request_id)` 재시도는 같은 결과를 반환한다. 같은 ID로 내용, lane, recipient 또는 epoch가 바뀌면 성공 replay가 아니라 conflict다.

idempotency namespace는 `(request_kind, actor_user_id, client_request_id)`다. terminal receipt의
content-free tombstone은 지원하는 network retry, worker 지연, hold, clock skew보다 길게
보존하고 exact window를 client/server/release config에 고정한다. 그 이후 옛 요청도 expired
lease/capability 때문에 새 명령으로 처리되지 않는다. offline queue가 이 창을 넘으면 자동
재전송하지 않고 새 문맥에서 사용자가 다시 확인한다.

receipt/tombstone TTL과 GC 조건은 문서 상수가 아니라 machine-readable retention registry에
request kind별로 둔다. GC는 연결된 outbox/provider/finalizer가 terminal이고 최소 재시도 창을
지났음을 DB가 증명한 row만 삭제하며, `client_request_id`의 짧은 keyed replay marker는 정책
기간 동안 남겨 response-loss 뒤 같은 명령이 새 작업으로 부활하지 않게 한다. 이 marker에도
원문, source ID, 사용자·커플 원 ID를 넣지 않는다.

### 8.4 DB가 독립적으로 증명

일반 route가 admin client로 `chat_messages`를 직접 INSERT하지 않는다. 모든 사용자 mutation은 receipt를 요구하는 owner-explicit RPC로 들어간다.

- 사용자 command receipt는 request JWT의 `auth.uid()`에서 actor를 파생하는 authenticated
  RPC만 발급한다. `p_user_id`를 caller가 넘겨 actor로 쓰지 않는다.
- receipt 발급 RPC와 privileged commit/finalizer RPC는 서로 다른 DB role과 execute grant를
  사용한다. worker role은 receipt를 발급하거나 임의 actor를 고를 수 없다.
- app runtime에는 범용 service-role 대신 각 domain RPC만 실행 가능한 최소권한 role을
  사용한다. DDL/table-owner와 break-glass credential은 별도 plane에 격리한다.
- authenticated 직접 INSERT 권한 제거
- 일반 runtime service role 직접 INSERT 제거
- receipt 없는 privileged INSERT를 trigger/RPC contract로 거부
- Wave B는 v2 사용률, 구형 client gate, rollback 증거가 확보된 별도 release로 적용

현재 준비된 Wave B는 authenticated direct INSERT를 닫는 기반이지만 `service_role`의
table 권한까지 자동으로 회수하지 않는다. Wave B만 적용하고 service direct write 0이라고
판정하지 않는다. 별도 runtime-writer contract migration에서 table DML을 revoke하고
postgres-owned SECURITY DEFINER writer RPC만 허용해야 한다. caller가 바꿀 수 있는 GUC,
header 또는 `p_user_id`를 receipt 증거로 사용하지 않는다.

### 8.5 User, system, operator principal

모든 mutation을 bearer user 하나로 표현하지 않는다.

```text
principal_type = user | system | operator
```

- `user`: request JWT의 `auth.uid()`와 composer lease에서만 actor를 파생한다.
- `system`: user command와 같은 transaction에서 만들어진 purpose-bound capability 또는
  검증된 scheduler source만 사용한다.
- `operator`: break-glass grant와 내부 2인 승인/적법 근거의 exact scope만 사용한다.

```text
amora_system_capabilities
- id, purpose, source_command_id, source_artifact_ids
- allowed_operation, destination_audience
- personal/membership security epoch
- worker_role, claim_token_hmac, expires_at, used_at, revoked_at
```

AI finalizer, proactive care, push, delete worker와 system message는 임의 actor/content/destination을
고를 수 없다. worker는 이미 발급된 capability를 claim·소비할 수만 있고 발급·widen은 못한다.
claim과 commit 때 current epoch, runtime mode, source tombstone을 다시 확인한다. 모든 실제 AI
호출은 계속 `ai_interactions_log`에, 모든 확정 커플 결정은 `decision_nodes`에 기록한다.

### 8.6 Read authorization도 DB가 증명

읽기는 쓰기보다 약한 경계가 아니다.

- user read/list/search는 request JWT와 RLS가 `user_private` personal workspace 또는 exact
  active/sealed audience를 직접 확인한다. client가 보낸 user/couple ID로 범위를 정하지 않는다.
- 일반 사용자 응답 경로에서 service role로 전체 row를 읽은 뒤 애플리케이션에서 filter하지
  않는다. BFF가 복호화해야 하면 먼저 server-side end-user JWT/RLS client로 artifact
  ID/ciphertext 접근을 증명하고, 그 exact artifact에만 decrypt capability를 받는다. ciphertext
  자체를 일반 클라이언트에 내려 보내 복호화 우회 API로 쓰지 않는다.
- system read는 source-bound capability의 artifact만, operator read는 break-glass scope만 허용한다.
- list, pagination, search, recent, unread, Realtime bootstrap도 같은 audience predicate를 쓴다.
- 접근 불가와 존재하지 않음은 enumeration을 막는 안정적인 404/empty 계약으로 처리하고
  내부 denial reason은 content-free 보안 지표에만 남긴다.
- 민감 read 응답은 `private, no-store`이며 viewer가 확정되기 전 SSR/hydration에 넣지 않는다.
- service/admin read inventory와 A/B/former-member/other-couple IDOR matrix가 0이 되기 전에는
  사용자 데이터를 읽는 기능을 켜지 않는다.

---

## 9. 파생물과 공유 승인

### 9.1 모든 파생물의 provenance

다음 객체는 원본 artifact를 반드시 가리킨다.

- AI 답변과 요약
- 개인/공유 기억
- 저장 노트
- 제안과 `decision_nodes`
- shared action과 양측 승인
- 첨부, OCR, 추출 텍스트
- 일정·예산·할 일 반영
- 알림 outbox
- 커뮤니티 초안과 게시물
- 검색·embedding/vector artifact

```text
privacy_scopes
- id, kind
- personal_workspace_id / personal_privacy_epoch
- couple_id / membership_security_epoch / shared_context_epoch / segment_id
- state, created_at, sealed_at

privacy_scope_principals
- scope_id, principal_type, principal_id
- granted_at, revoked_at

amora_artifacts
- id, kind, scope_id, lineage_generation, lineage_depth
- canonical_content_ref, server_content_binding_hmac, key_version
- retention_class, retention_policy_version, expires_at, legal_hold_id
- state, created_at, tombstoned_at, purge_after

amora_artifact_edges
- parent_artifact_id
- child_artifact_id
- transformation_kind
- command_id
```

audience를 JSON이나 polymorphic `owner/audience` 문자열로 저장하지 않는다. scope별 필수
column 조합은 CHECK와 composite FK로 검증하고, 실제 사람 집합은
`privacy_scope_principals`의 정규 행이 정본이다. 대부분의 대화는 segment-level scope를
공유하고, recall/declassification처럼 audience가 달라지는 artifact만 별도 scope를 만든다.

PostgreSQL CHECK 하나로 cross-table subset을 검증할 수 없으므로 모든 edge/artifact 생성은
writer RPC와 deferred constraint trigger를 거친다. child를 `FOR UPDATE`로 잠그고 부모
generation이 child보다 작으며 depth 상한 안인지 확인한다. edge는 불변이고, 모든 부모가
같은 transaction에서 확정된 뒤 child를 publish한다. 이렇게 DAG를 강제해 deletion worker가
cycle로 무한 반복하지 않게 한다.

DB writer의 허용 predicate는 하나다.

```text
ALLOW =
  child_audience ⊆ intersection(parent_audiences)
  OR (
    exact_grant.source_ids_and_versions == canonical_parent_ids_and_versions
    AND exact_grant.preview_binding == child_content_binding
    AND exact_grant.destination == child_audience
    AND exact_grant.actor_and_epochs == current_actor_and_epochs
    AND exact_grant is unexpired, unrevoked, unused
    AND exact_grant is consumed by this child command in the same transaction
  )
```

부모가 여러 개면 child audience가 넓어지는 모든 부모를 grant가 정확히 포함해야 한다.
grant는 원본 artifact의 audience를 바꾸지 않고 destination용 새 artifact 하나만 만든다.
조건을 판정할 수 없으면 거부한다.

### 9.2 Declassification grant

```text
amora_declassification_grants
- id
- grant_group_id
- actor_user_id
- grantor_member_id
- authority_basis = owner | author | joint_consent
- source_artifact_id
- source_version
- source_rights_snapshot_version
- destination_kind
- destination_audience
- personal_privacy_epoch 또는 membership_security_epoch
- shared_context_epoch
- preview_binding_hmac
- expires_at
- used_by_command_id
- revoked_at
```

흐름:

1. 사용자가 `공유본 만들기`를 선택한다.
2. 서버가 canonical 원본, 작성자와 source별 공개권을 다시 확인한다.
3. 공개될 새 문장만 별도 preview로 만든다.
4. 화면에 정확한 사람 또는 `커뮤니티 공개`를 표시한다.
5. 사용자가 편집하고 최종 문구를 확인한다.
6. 서버가 정확한 preview HMAC, destination, epoch와 grantor identity에 결박된 일회성 grant를 발급한다.
7. 본문 또는 대상이 한 글자라도 바뀌면 grant는 무효다.

`읽을 수 있음`은 `밖으로 공개할 수 있음`이 아니다. 서버는 source 종류와 작성권을 별도로
판정하며, 단순 audience membership을 declassification 권한으로 바꾸지 않는다.

| canonical source | 단독 grant 권한 | 더 넓은 destination으로 보낼 조건 |
|---|---|---|
| actor 자신의 `owner_private` 원문 | 소유자 | exact preview + destination-bound grant |
| actor가 직접 쓴 `shared_partner` 원문 | 작성자 | 자기 원문만 exact preview; 상대 문구·문맥 포함 금지 |
| 상대가 쓴 `shared_partner` 수신 원문 | 없음 | source bridge 금지; 상대가 별도 공개 초안을 만들거나 source 없는 빈 초안 사용 |
| actor가 직접 쓴 독립 `shared_ai` 입력 | 작성자 | 자기 원문만 exact preview; 다른 부모 provenance가 없어야 함 |
| 상대 작성분·공동 대화·공동 결정·joint-context AI 출력 | 한 명에게 없음 | 양쪽의 서로 독립된 grant가 같은 preview/destination/version에 결박돼야 함 |
| C5 또는 권리 확인 불가한 제3자 정보 | 없음 | 자동 bridge 금지; destination 정책에 따라 빈 초안에서도 차단 가능 |

여러 source를 합친 artifact는 각 source의 권리를 합집합으로 검사하고 가장 엄격한 조건을
적용한다. 양쪽 승인은 서로 다른 현재 세션·member가 독립적으로 발급해야 하며 한 사람이
상대 세션을 대리하거나 첫 승인 뒤 본문을 바꿀 수 없다. 사용자는 언제든 source 없는 빈
공개 초안에서 새 글을 쓸 수 있지만, 그 경우에도 제3자 권리·민감정보 destination 정책은
그대로 적용한다.

공개 command는 `grant_group_id`에 필요한 모든 source·권리자 grant가 현재 version/epoch로
모였을 때만 같은 DB transaction에서 전부 소비한다. 한 명의 철회·관계 변경·본문 변경이
먼저 발생하면 부분 grant를 남겨 공개하지 않고 전체 group을 취소한다.

AI가 민감정보를 지웠다고 판단하는 것은 승인 대체물이 아니다. 정규식 탐지도 보조 경고일 뿐 권한 경계가 아니다.

private source를 public으로 보내는 최종 승인에는 server-verified recent re-auth를 요구한다.
목표 max age는 10분이며 release config에 고정한다. C5 첨부·원문과 제3자의 건강·연락처·
계정·가족 갈등 정보는 자동 공개본 대상에서 제외한다. 사용자가 제3자 정보를 게시할
권한이 있는지 확인할 수 없으면 public bridge를 거부하고 빈 작성 화면으로 돌린다.

### 9.3 저장 노트

- 직접 작성 노트는 시작부터 `개인 메모` 또는 `함께 메모` 범위를 고른다.
- 메시지 기반 노트는 임의 `content` 대신 canonical `sourceArtifactId`를 받는다.
- private source는 기본적으로 private note다.
- shared source만 shared note가 될 수 있다.
- private→shared note는 declassification grant가 필요하다.

### 9.4 결정의 공평성

- 모든 확정 커플 결정은 계속 `decision_nodes`에 기록한다.
- 커플 양쪽에 영향을 주는 실행은 양쪽의 독립 승인 전에는 실행하지 않는다.
- 한쪽의 private 불만, 압박, 건강·가족 정보는 상대를 설득하는 shared 답변에 사용하지 않는다.
- 공평함은 무조건 반반이 아니라, 각자의 제약과 동의가 보이고 취소·수정 가능한 절차다.
- 아모라는 누가 맞는지 판정하지 않고 `확정 사실 / 모르는 것 / 제안 / 양쪽 확인 필요`를 분리한다.

---

## 10. AI 문맥, 기억과 제공자 경계

### 10.1 문맥 조립

하나의 무한 원문 history를 모델에 보내지 않는다.

- lane별 segment 분리
- private AI는 owner private + 명시 허용된 공통 사실만
- shared AI는 current shared segment + shared decisions만
- partner direct는 항상 제외
- private 상담은 shared 중재·공동 알림·상대 설득에 사용 금지
- 기억과 요약도 같은 audience와 source provenance 유지
- segment가 바뀌면 새 문맥 시작, 과거 원문 자동 합치기 금지

### 10.2 AI 감사

모든 실제 AI 호출은 `ai_interactions_log`에 남긴다. 다만 질문·답변·첨부·도구 입력/출력 원문은 남기지 않는다.

권장 필드:

- pseudonymous operation ID
- actor/couple의 직접 ID가 아닌 purpose-separated HMAC
- lane/scope class
- model, provider endpoint, usage, latency
- policy result, success/refusal/error class
- input/output character bucket
- provider request receipt ID의 HMAC
- command/artifact correlation의 opaque ID

기존 raw column은 계속 null이어야 한다. 최종적으로 raw column을 제거하거나 DB constraint로 null을 강제해 미래 caller의 실수를 막는다. 감사 예약이 실패하면 provider 호출도 시작하지 않는다.

여기서 provider 호출은 generation만 뜻하지 않는다. input-token count, moderation, Files,
image/file input, embedding, web/file search, tool/MCP, prompt cache와 retry를 모두 포함한다.
모든 SDK 접근을 하나의 audited egress gateway 뒤로 모으고, privacy/cost/audit receipt와
current capability를 먼저 확정한 뒤에만 네트워크를 연다. token count가 필요하면 우선
검증된 local estimator를 쓰고, provider count를 쓸 때도 동일 egress receipt가 선행해야 한다.
테스트는 gateway 밖의 OpenAI host 요청이 0인지 network sink에서 확인한다.

### 10.3 OpenAI 계약

`store: false`는 필요한 설정이지만 Zero Data Retention 보증이 아니다. OpenAI 공식 API data controls에 따르면 API 입력·출력은 기본적으로 모델 학습에 쓰이지 않지만, 기본 abuse monitoring은 일부 고객 콘텐츠를 최대 30일 보관할 수 있다. ZDR/MAM은 별도 승인과 endpoint별 제한이 있다.

공식 문서는 extended prompt caching이 application state를 최대 24시간 유지할 수 있고 ZDR
적합성에 제한이 있다고 설명한다. 현재 코드의 explicit cache mode가 실제 어느 TTL과 저장
경로를 쓰는지는 운영 request/config 증거로 확인해야 하며, 모르면 cache를 끈다.

공식 출처:

- <https://developers.openai.com/api/docs/guides/your-data#default-usage-policies-by-endpoint>
- <https://openai.com/business-data/>

운영 활성화 전 증거:

- 실제 법인/조직/project의 DPA와 처리자 목록
- 데이터 처리·저장 지역
- ZDR 또는 MAM 승인 상태와 대상 endpoint/model/tool
- Responses 요청의 `store:false`
- 실제 전송 request의 `prompt_cache_options`, TTL과 persisted reasoning 설정. 현재 코드의
  `mode: "explicit"`를 포함해 prompt cache가 쓰는 application state와 ZDR 적합성을 확인
- background mode, Conversations, Files, vector store 등 별도 저장 표면의 비사용 또는 정확한 retention/delete 계약
- 삭제 요청과 사고 문의 채널
- provider 설정 screenshot/API receipt와 검증 날짜

이 증거가 없으면 C5 입력과 민감 첨부의 provider 전송은 금지한다. 사용자 목표가 무누설 최우선이라면 private AI도 승인된 처리 계약 전에는 fail-closed하는 것이 가장 안전하다.

### 10.4 암호화의 정직한 한계

AI가 답하려면 AI gateway 또는 제공자가 평문을 처리하는 순간이 있다. 따라서 AI lane을 “아무도 읽을 수 없는 종단간 암호화”라고 표현하면 안 된다.

목표 구조:

- 전송: TLS
- 저장: AEAD 기반 필드 단위 envelope encryption. 검토된 라이브러리의 AES-256-GCM 또는
  동등 알고리즘을 한 구현으로 고정하고 자체 암호를 만들지 않는다.
- private content: personal workspace/personal privacy epoch별 DEK
- shared/direct content: couple membership security epoch/scope별 DEK
- KEK: DB와 분리된 KMS/HSM
- 일반 운영자와 일반 service role에는 decrypt 권한 없음
- 격리된 Content Decryption Gateway만 `user_read | ai_inference | purge_verify` 목적의
  short-lived exact-artifact decrypt capability 사용
- user read는 먼저 end-user JWT/RLS로 artifact 접근을 증명한 뒤 `user_read` capability를
  받고, AI는 source-bound system capability 뒤 `ai_inference` capability를 받는다.
- ciphertext마다 random nonce, auth tag, algorithm/key version과 AAD schema version 기록.
  AAD에는 artifact ID, kind, scope ID, owner/couple, security epoch, segment와 content type을
  포함해 ciphertext를 다른 row/scope로 옮기면 복호화가 실패하게 한다.
- 같은 DEK에서 nonce 재사용을 DB/crypto helper가 구조적으로 금지한다.
- key version과 HMAC version, rotation 상태를 기록
- unlink, 침해, 권한 변경 시 key rotation

Realtime에는 chat 원문 row를 보내지 않는다. `artifact_id + state/version` 이벤트만 보내고,
웹·모바일은 BFF의 현재 RLS와 decrypt capability를 거쳐 내용을 받는다. sensitive response는
`private, no-store`이고 plaintext를 CDN, shared cache, disk temp, log에 남기지 않는다.
검색·embedding·thumbnail 등 복호화 파생물도 동일 scope의 별도 artifact이며 그 경계를
구현하지 못하면 해당 기능을 끈다.

KMS key backup, rotation, disabled/deleted 상태와 restore 절차를 별도 검증한다. crypto-shred는
필요한 DEK와 모든 wrapping copy가 폐기됐다는 증거가 있을 때만 완료로 말한다.

이 field-encryption + ID-only Realtime 경계는 private/shared 원문 저장 기능의 출시 gate다.
구현되지 않았다면 해당 대화는 원문을 장기 저장하지 않는 제한 모드 또는 기능 OFF로 둔다.

파트너 직접 lane은 장기적으로 E2EE를 검토할 수 있다. 그러나 다중 기기 key 복구, 신고, 백업, 검색과 알림 trade-off를 설계하고 독립 감사하기 전에는 E2EE라고 광고하지 않는다.

---

## 11. 첨부파일 전체 생명주기

현재 direct upload 방식 대신 Wave C의 session-ledger 구조를 완성한다.

```text
create upload session
 -> actor/scope/epoch/target에 결박된 signed upload
 -> exact bytes finalize
 -> MIME/signature/malware/metadata 검사
 -> content HMAC과 object ownership 확인
 -> DB에서 attachment/message를 hidden pending으로 결박
 -> current scope 재검증 뒤 함께 consumer-visible publish
 -> 미연결 object cleanup lease
 -> absence receipt
```

Storage와 PostgreSQL은 하나의 ACID transaction으로 묶을 수 없다. 여기서 원자성은
`사용자에게 메시지가 보일 때 검증된 attachment도 함께 보이거나 둘 다 안 보임`이라는
consumer-visible invariant다. object는 처음부터 immutable quarantine path에 두고 DB의
`attached + visible` ledger가 없으면 어떤 read도 허용하지 않는다. DB publish 실패는 hidden
pending으로 남겨 재시도하거나 보상 삭제한다.

quarantine의 검사 전 bytes는 private bucket에서 exact scanner role만 짧게 읽고 일반 service,
operator, signed read URL에는 열지 않는다. 검사 통과 후 per-artifact DEK와 scope/epoch/content
type AAD로 streaming envelope encryption한 final object를 만들고 plaintext quarantine object와
scanner temp를 정책 SLA 안에 purge한다. final object, thumbnail, OCR와 추출물은 각각 암호화된
artifact이며 authorization proxy/Content Decryption Gateway만 exact read capability로 복호화한다.
외부 malware/OCR processor를 쓰면 그 전송도 audited egress, 처리 지역·보유·삭제 계약과
deletion locator에 들어가며 계약이 없으면 해당 검사를 외부에 보내지 않고 첨부 기능을 끈다.

필수 규칙:

- object path, upload token, signed read URL은 owner, couple, epoch, lane, recipient에 결박한다.
- raw SHA를 Realtime metadata에 싣지 않고 keyed HMAC을 사용한다.
- 다운로드는 authorization proxy가 매 요청 현재 권한을 재검증한 뒤 스트리밍한다.
  정말 one-use가 필요하면 자체 token ledger를 원자 소비한다. Supabase signed URL 자체는
  고정 시간 bearer URL이며 진정한 one-use/revoke를 보장하지 않으므로, 불가피한 fallback은
  아주 짧은 TTL로만 발급하고 장기 bearer URL로 사용하지 않는다.
- unlink/delete 때 신규 URL 발급을 즉시 막고, 이미 발급된 URL의 최대 잔여 시간을 release evidence로 관리한다.
- 파일 EXIF·문서 metadata·썸네일·OCR·추출 텍스트도 별도 artifact로 추적한다.
- 파일 읽기·압축·업로드 중 계정 또는 scope가 바뀌면 결과를 새 composer에 붙이지 않는다.
- DB attach/publish에 실패하면 orphan sweeper가 object를 제거하고 content-free deletion
  result를 남긴다. object 삭제 실패를 메시지 publish 성공으로 바꾸지 않는다.
- malware 검사, 문서 sanitization과 privacy provenance는 서로 다른 gate로 검증한다.
- Wave C runtime과 hosted Storage proof가 없으면 아모라 첨부 기능을 끈다.

---

## 12. 초안, prefill, 캐시와 URL

### 12.1 초안

- lane별 초안과 첨부를 절대 자동 이동하지 않는다.
- 같은 계정에서 lane만 바꾸면 초안은 원래 lane에만 남고, 돌아왔을 때만 보인다.
- 로그아웃·A→B 계정 전환 때 active memory와 DOM에서는 즉시 제거한다. 복구를 지원하면
  원계정·기기 key로 암호화하고 짧은 TTL을 둔 sealed draft로만 보관하며, 같은 A가
  재인증하기 전에는 존재 여부도 B에게 보이지 않는다. 복구 계약을 구현하지 않았다면
  명시 안내 뒤 안전 폐기한다.
- unlink 때 `private_ai` 초안은 원 소유자의 private lane에 남길 수 있다.
  `shared_ai`와 `shared_partner` 초안·보류 전송·첨부는 옛 audience/recipient에 묶여
  있으므로 기본 취소·폐기하며 새 파트너에게 자동 복구하지 않는다.
- 복구 초안은 같은 사용자·기기·lease namespace에서만 연다.
- 웹 `localStorage/sessionStorage`에 민감 원문을 평문으로 두지 않는다.
- 모바일은 SecureStore로 보호한 key와 암호화 local store를 사용한다.
- shared device 위험을 고려해 기본은 memory-only, 장기 초안 저장은 명시적 opt-in을 검토한다.
- offline queue는 account/epoch가 바뀐 뒤 자동 재전송하지 않는다.

### 12.2 Prefill과 deep link

민감 원문을 URL query에 넣지 않는다. URL, browser history, analytics, proxy, referrer에 남을 수 있다.

서버 발급 일회성 opaque handoff ID를 사용하고, 어느 lane에도 자동 삽입하지 않는다.

```text
받은 초안입니다. 어디에서 이어갈까요?

[나만 상담에서 열기]
[함께 아모라와 상담]
[초안 삭제]
```

로그인 후 actor, couple, epoch를 다시 확인한다. 범위가 불명확하면 `shared`를 기본값으로 선택하지 않는다.

### 12.3 웹·모바일 캐시

- query cache, Zustand store, React tree, Realtime channel을 동일 privacy key에 결박한다.
- 새 identity가 준비되기 전에 이전 initial data를 hydrate하지 않는다.
- account switch는 화면뿐 아니라 pending promise와 late response도 generation token으로 폐기한다.
- private 화면을 browser back/forward cache에서 복원할 때 다시 인증한다.

---

## 13. 알림과 능동 케어

일정·예산·할 일 알림은 소비자 만족을 높일 수 있지만, 알림 자체가 개인정보 누설 경로가 되면 안 된다.

### 13.1 Scope별 care engine

- private 일정/예산 신호는 owner에게만 알린다.
- shared 일정/예산은 현재 커플 audience에만 알린다.
- private 신호를 근거로 상대방에게 압박·설득·공동 경고를 보내지 않는다.
- care job에도 actor/audience, 해당 personal/membership security epoch, source artifact가 필요하다.
- 일정이 지나거나 예산이 넘었다는 사실을 로그 label로 남기지 않는다.

### 13.2 잠금화면 기본값

- `아모라에 새 소식이 있어요`
- `함께 대화에 새 소식이 있어요`

기본적으로 넣지 않는다.

- 본문, 파트너 이름, 날짜, 예산, 업체, 갈등 주제
- user/couple/message ID
- 딥링크 안의 실제 destination 정보

내용 미리보기는 사용자별 명시 opt-in만 허용한다. `나만 상담`은 opt-in이어도 항상 일반
문구만 사용한다. 잠금화면 inline reply는 제공하지 않는다.

케어 알림은 종류별 `일정 | 예산 | 할 일 | 함께 대화` on/off, 조용한 시간, 하루 빈도
상한, 묶음 알림, `오늘은 쉬기`와 개별 snooze를 제공한다. 위험/기한 알림이라도 긴급함을
과장하거나 반복 압박하지 않는다. 정확한 빈도 상한과 묶음 window는 사용자 연구 후
server config와 release receipt에 고정한다.

### 13.3 Token과 tap 재인가

- push token을 installation, user, auth session과 해당 personal/membership security epoch에 결박한다.
- 발송 직전과 탭 시점에 현재 membership을 다시 확인한다.
- payload의 route/message/couple ID 대신 짧게 만료되는 opaque one-time notification handle만
  넣는다. 탭 뒤 server가 현재 user/session/epoch를 확인해 destination을 해석하고 handle을
  원자 소비한다.
- 로그아웃, 계정 전환, unlink 때 token binding, badge, 마지막 notification response와 앱 내 캐시를 정리한다.
- 잘못된 계정에서 알림을 탭하면 내용 없는 홈으로 이동하고 해당 메시지는 열지 않는다.

현재 delivery 경로에는 Expo push service가 APNs/FCM 앞의 별도 processor로 들어간다.
Expo ticket/receipt, push token, payload metadata의 보관·지역·하위 처리자·삭제 계약과 실제
전송 body를 release evidence에 포함한다. Expo를 거치든 APNs/FCM에 직접 보내든 일반화된
payload 원칙은 바뀌지 않으며, 처리자 계약이 불명확하면 OS push를 끄고 앱 안 inbox만 쓴다.

### 13.4 앱 전환 보호

- background/inactive 진입 즉시 앱 스위처용 중립 화면 표시
- Android 민감 화면은 `FLAG_SECURE` 검토
- iOS는 앱 스위처 snapshot 보호와 화면 녹화 감지 시 가림
- private 화면 복귀 시 선택적 biometric/시간 기반 재잠금
- browser title, recent screen, OS search index에 대화 내용 금지

OS, 외부 카메라와 이미 본 화면 때문에 스크린샷을 완전히 막는다고 약속하지 않는다.

---

## 14. 연결, 해제, 새 파트너와 계정 전환

### 14.1 연결

- 초대 secret은 CSPRNG로 최소 128-bit entropy를 만들고 raw 값은 발급 응답에 한 번만 보인다.
  DB에는 목적 분리된 server secret으로 계산한 HMAC만 저장하며 평문을 보존하지 않는다.
- `amora_couple_invites` ledger는 `issuer_user_id`, `couple_id`, `membership_security_epoch`,
  선택적 `intended_recipient_user_id`, `token_hmac`, `status=issued|candidate_pending|activated|
  rejected|expired|revoked`, `candidate_user_id`, issuer/recipient confirmation receipt와
  `expires_at`, `used_at`, `revoked_at`를 가진다. 검증은 timing 차이를 최소화하고 실패 이유로
  token 존재를 열거하지 않는다.
- raw token과 HMAC key는 URL query, referrer, 로그, analytics, support 도구에 남기지 않는다.
  발급·검증·accept에는 IP/계정/커플별 bounded rate limit과 anomaly revoke를 적용한다.
- 사용자 UX는 짧은 만료의 QR과 one-tap app handoff를 우선하고, grouped copy token은 보조로
  둔다. raw secret은 검증된 app-link fragment 또는 POST handoff처럼 referrer/server access
  log에 남지 않는 경로를 사용하며 iOS/Android에서 실제 동작을 검증한다. 새 초대를 만들면
  옛 초대는 즉시 revoke되고, 사용자가 고른 외부 메신저는 token을 볼 수 있음을 숨기지 않는다.
- 기존 `couples.invite_code` 평문·장기 코드는 새 ledger로 안전하게 교체한 뒤 모두 revoke하고,
  column/read policy/RPC 의존성을 contract migration으로 제거한다. 기존 code를 새 token으로
  그대로 backfill하거나 수명을 연장하지 않는다.
- token 보유만으로 active membership이나 shared scope principal을 만들지 않는다. exact account로
  수신자를 미리 결박하려면 issuer가 그 identity를 보고 recent re-auth로 확인해야 한다.
- 수신자 미지정 초대의 최초 유효 redemption은 `candidate_pending`만 만든다. candidate는 issuer의
  최소 identity와 새로 보일 범위를 확인하고 자기 recent re-auth receipt를 남기며, 이 상태에서
  shared message/history/key/Realtime/push는 0건이다.
- issuer는 별도 세션에서 candidate의 최소 identity를 확인하고 recent re-auth로 승인하거나
  거절한다. 수신자가 미리 결박된 경우에도 recipient의 독립 확인 receipt가 추가로 필요하다.
- relationship 활성화 RPC는 issuer와 exact candidate의 서로 다른 current receipt, invite/roster
  epoch, 만료·revoke 상태를 row lock으로 다시 확인한 뒤에만 stable members, 새
  `membership_security_epoch`, shared segment와 audience snapshot을 한 transaction으로 만든다.
- 동시 redemption은 많아도 pending candidate 하나만 만들고 active relationship은 0이다. 먼저
  token을 훔친 candidate를 issuer가 거절하면 새 token을 발급한다. 사용·거절·만료·옛 epoch
  token replay는 항상 거부한다.
- 연결 전 기록은 자동 공유하지 않는다.
- 옛 성별 role slot이 아닌 정규 `couple_members`와 stable member ID로 전환한다.

권장 카피:

> 연결 전 기록은 자동으로 공유하지 않아요. 오늘부터 두 사람의 함께 대화를 새로 시작합니다.

### 14.2 해제

한 transaction 또는 검증된 saga에서 다음을 수행한다.

- old couple membership security epoch revoke와 shared context seal
- Realtime 구독과 context lease 폐기
- 미전송 partner/public outbox 취소
- 미완료 shared action 승인 무효화
- partner 대상 초안·첨부 폐기
- 신규 signed URL과 push 발송 차단
- shared encryption key rotation
- 이전 shared segment는 원래 두 구성원에게만 읽기 전용 보관한다. 새 AI 문맥·기억·케어·
  push에는 사용하지 않고 새 파트너에게는 0건 상속한다. 어느 한쪽의 안전 신고가 있으면
  온라인 접근을 먼저 동결하고 승인된 사고 절차로 재개 여부를 판단한다.
- 새 파트너에게 과거 segment를 상속하지 않는 새 couple/segment

old couple은 no-refill로 seal한다. 재연결이나 새 파트너는 같은 couple slot을 재사용하지
않고 새로운 `couple_id`와 `membership_security_epoch=1`에서 시작한다.

unlink 확인 화면은 `과거 함께 대화는 원래 두 사람의 읽기 전용 기록으로 남고 새
파트너에게는 보이지 않음`을 사전에 보여준다. 각 사용자는 자신의 화면에서 숨길 수 있고,
자기 메시지 회수와 계정 삭제는 별도 정책을 따른다. 이미 전 파트너가 본 내용이나 저장한
복사본을 되돌릴 수는 없음을 정직하게 설명한다.

### 14.3 계정 전환

계정이 바뀌는 즉시:

1. 전체 privacy subtree를 unmount
2. pending fetch/upload/provider/Realtime abort
3. 메모리의 초안·object URL·preview 제거
4. push/deep link destination 폐기
5. 새 사용자의 server contract를 확인
6. 빈 상태에서 새 lease 발급

늦게 도착한 A 응답은 B state에 `setData`할 수 없다.

---

## 15. Undo, Recall, 삭제와 백업

### 15.1 상태 모델

```text
draft
 -> reserved
 -> delivery_hold
 -> committed
 -> delivered / ai_queued
 -> processing
 -> completed

reserved/delivery_hold -> cancelled
committed -> recall_requested -> tombstoned -> purge_pending -> purged
```

### 15.2 Undo

파트너 direct, private→shared, public 전환은 서버에서 **7초** `delivery_hold`를 둔다.
시간은 release config에 고정하고 클라이언트 표시와 서버 값이 다르면 전송을 막는다.

- 서버가 hold receipt를 반환한 뒤부터 countdown을 시작한다. offline 상태에서 보낸 명령을
  나중에 자동 queue하지 않는다.
- app background/종료만으로는 이미 확인한 hold를 취소하지 않는다. 다른 로그인 기기에서도
  같은 command를 7초 안에 취소할 수 있다.
- logout, account switch, unlink, recipient 또는 관련 security epoch 변경은 hold를 자동 취소한다.
- 중복 탭은 같은 idempotency result 하나만 만든다.
- 7초 동안 취소 버튼을 계속 보이고 keyboard focus와 screen reader 이름을 제공한다.
  countdown 숫자를 매초 강제로 읽지 않고 시작과 취소 가능 상태를 한 번 알린다.
- hold 중 취소하면 수신자 메시지, push, AI/provider, 공개 게시, 파생 artifact가 0건이어야 한다.

7초가 실제 사용자에게 지나치게 길거나 짧은지는 접근성·오발송 연구로 변경할 수 있지만,
변경은 서버/클라이언트/테스트/release receipt를 같은 버전으로 갱신해야 한다.

### 15.3 Recall

전달 후에는 미래 접근과 서버 파생 사용을 중단한다.

상태별 카피를 구분한다.

- `cancelled`: `전달 전에 취소했어요.`
- `recall_requested` / `purge_pending`: `회수 요청을 처리하고 있어요.`
- `tombstoned`: `대화에서 숨겼어요. 상대가 이미 봤을 수 있어요.`
- `purged`: `확인 가능한 서버 원문과 파생물 삭제를 마쳤어요.`
- provider/backup이 남은 경우: `외부 처리 또는 백업 만료를 기다리는 항목이 있어요.`

어떤 단계에서도 이미 본 내용, 캡처, 수신 기기 알림까지 되돌렸다고 말하지 않는다.

회수는 원본, AI 답변, 요약, 기억, 노트, 결정 초안, 첨부, OCR, 검색 인덱스, 미발송 push를 provenance graph로 추적한다. 공유 결정은 몰래 사라지지 않고 `withdrawn` tombstone과 변경 이력을 남긴다.

purge worker는 lineage depth와 안정적인 순서로 bounded batch를 claim한다. job마다 lease,
fencing token, 최대 시도 수, 다음 재시도와 terminal 상태를 가지며 외부 삭제 효과는
idempotent해야 한다. artifact/edge를 먼저 지워 계보 증거를 잃지 않고, content를 제거한 뒤
content-free deletion ledger로 축약한다. depth 초과·cycle 의심은 성공 처리하지 않고 해당
기능을 중단해 조사한다.

### 15.4 `비우기`와 `삭제`

- cursor 이동: `내 화면에서 이전 대화 숨기기`
- 원문/파생물 purge: `개인 대화 영구 삭제 요청`
- partner에게 전달된 shared 메시지: `회수 요청`
- 계정 전체: `계정 삭제`

서로 다른 동작을 모두 `삭제`라고 부르지 않는다.

### 15.5 계정 삭제

1. 서버가 삭제 접수와 actor를 원자 확인하고 receipt 발급
2. 신규 전송·업로드·AI 호출 동결
3. 세션, refresh token, push binding, signed URL 발급 권한 폐기
4. DB, Storage, provider, vector, email, analytics, support artifact inventory
5. provenance tombstone과 외부 purge outbox 실행
6. 각 처리자의 content-free 삭제 결과를 `deleted | expiry_pending | legally_held |
   unverifiable`로 수집한다. 제공자가 독립적인 absence receipt를 주지 않으면 완료로
   꾸미지 않고 계약상 만료 시점과 재확인 상태를 남긴다.
7. 사용자에게 완료/남은 법적 보관·백업 만료 범위를 구분해 알림

삭제 worker가 다시 외부 삭제를 실행하려면 provider resource ID와 object path가 필요하다.
일반 로그에는 HMAC만 남기되, 별도 restricted deletion locator ledger에는 exact external ID를
envelope-encrypted로 두고 purge role만 복호화한다. 삭제/계약 만료가 확인되면 locator도
정해진 policy로 제거한다.

terminal 상태는 `deleted | not_created | contract_expired | legally_held`다. `legally_held`는
삭제 완료가 아니라 근거·scope·만료·owner가 있는 예외로 사용자에게 분리해 알린다.
`expiry_pending | retrying | unverifiable`은 완료가 아니며, `unverifiable`은 해당 processor
기능의 신규 민감 데이터 사용을 막고 사고로 승격한다. 목표는 pending 0이 아니라
**SLA를 넘기거나 owner/근거가 없는 삭제 작업 0**이다.

### 15.6 한 명이 탈퇴할 때 scope별 처분

아래는 개인정보 우선 기본안이며 실제 법률·약관 검토로 확정한다.

| 데이터 | A 탈퇴 시 기본 처분 | 남은 B에게 보이는 것 |
|---|---|---|
| A private/profile/draft/memory | 원문·키·파생물 purge | 0 |
| A가 보낸 shared/direct 원문·첨부 | 즉시 tombstone 후 purge | `탈퇴한 구성원의 메시지가 삭제됨` tombstone만 |
| B가 작성해 A에게 보낸 원문 | A audience/cache 제거 | B의 sealed personal archive에 자기 작성본만 유지 가능 |
| A/B 기반 shared AI 답변·요약 | A provenance가 있으면 원문 purge | 필요한 shared decision만 아래 규칙으로 유지 |
| 공동 `decision_nodes`, 일정·예산·할 일 | A identity/free-text 제거; data-minimized 공동 결과만 B에게 이전 | `former member와 확정한 과거 결정` 상태와 변경 이력 |
| 분리 불가능한 공동 artifact | 전체 withdraw/tombstone | 내용 없는 상태만 |
| public/community A 작성물 | 공개 정책에 따라 delete 또는 irreversible anonymize | 정책상 남는 익명 결과만 |
| 보안·AI 감사 | 원문 없이 목적상 최소 pseudonymous receipt | 사용자 UI에는 처리 상태만 |
| processor/backup | purge 또는 고지된 expiry/legal hold | 정확한 pending/terminal 상태 |

공동 결과를 남길 때 A의 private source, 이름, 연락처, 자유 서술을 B의 memory/AI context로
옮기지 않는다. 탈퇴는 old couple을 seal하고 active membership security epoch를 revoke한다.
B의 personal workspace는 유지되지만 새 파트너 연결은 새 `couple_id`와 새 epoch를 만든다.
삭제 확인 전에 A와 B에게 각각 어떤 항목이 삭제·tombstone·보존되는지 보여준다.

### 15.7 백업 복원에서 삭제가 부활하지 않게 하기

DB 안의 tombstone만 믿으면 그 tombstone보다 오래된 backup을 복원할 때 함께 사라진다.
운영 DB/Storage backup 범위 밖의 append-only/WORM deletion journal에 raw ID나 원문 대신
purpose-separated subject/artifact HMAC, deletion generation, key tombstone, policy version과
시간을 기록한다. restore 환경은 외부 journal을 인증해 replay하고 DB·Storage·search·key의
삭제 사후조건을 확인하기 전에는 network/write fence를 열지 않는다.

백업에는 즉시 물리 삭제가 어려울 수 있다. 이 restore-before-open 계약 없이 `완전히 즉시
삭제`라고 말하지 않는다.

### 15.8 Privacy center와 안전한 내보내기

사용자는 한곳에서 현재 계정·기기·연결 파트너, private/shared 범위, 활성 invite/grant,
AI/push/분석 처리자, 보유·삭제 상태와 로그인 세션을 확인하고 철회할 수 있어야 한다.
privacy center 자체도 상대의 private 활동량이나 숨은 artifact 존재를 보여주지 않는다.

데이터 export는 단순 다운로드가 아니라 고위험 read 경계다.

- recent re-auth, 현재 auth session/personal/membership epoch와 export용 one-time capability를
  요구하고 계정 전환·unlink·삭제·권한 변경 시 즉시 취소한다.
- 서버가 현재 사용자가 읽을 권리가 있는 exact audience snapshot만 내보낸다. 내부 key,
  운영 metadata, 상대 private 자료, 삭제 locator와 다른 사용자의 숨은 객체는 포함하지 않는다.
- shared/direct 자료와 제3자 정보의 법적 열람·이동 범위는 약관 추정이 아니라 실제 법률 검토로
  확정하며, export 때문에 원래 앱 audience가 public으로 바뀌지는 않는다.
- archive는 별도 임시 DEK로 암호화하고 일반 Storage signed URL 대신 re-authenticated streaming
  endpoint에서 짧게 만료되는 one-time handle로 전달한다. 이메일·push에는 파일이나 원문을
  붙이지 않고 `내보내기가 준비됐어요`만 알린다.
- 생성·조회·실패·만료를 content-free audit로 남기고, 최대 download 횟수 뒤 또는 짧은 정책
  만료에 archive와 DEK를 purge한다. support 운영자는 export archive를 대신 내려받을 수 없다.
- A 요청 archive가 같은 기기의 B 로그인 뒤 보이거나 열리지 않도록 request owner와 session
  generation을 응답·화면·tap까지 다시 검증한다.

---

## 16. DB 목표 모델과 권한

### 16.1 핵심 테이블

- `personal_workspaces`: stable user principal, personal privacy/key epoch
- `couple_members`: stable member, active/inactive, membership epoch
- 기존 `conversation_segments` 확장: lane, `privacy_scope_id`, opened/sealed epoch
- `privacy_scopes` / `privacy_scope_principals`
- `amora_composer_leases`
- 기존 `amora_chat_request_claims` 확장 또는 대체하는 command receipts
- `amora_system_capabilities`
- `amora_artifacts`
- `amora_artifact_edges`
- `amora_declassification_grants`
- `amora_couple_invites`
- `amora_ai_turn_outbox`
- `amora_outbound_deliveries`
- privacy center의 one-time export jobs/capabilities와 encrypted archive lifecycle
- 기존 `account_deletion_jobs`, private delete boundary를 확장하는 deletion jobs/receipts
- 운영 DB backup 밖의 append-only deletion journal
- purge worker만 읽는 암호화된 external resource locator ledger
- `amora_break_glass_grants`
- 기존 `chat_messages`, `decision_nodes`, `ai_interactions_log`

이 이름은 논리 구성요소다. 기존 `conversation_segments`, `account_deletion_jobs`,
private-delete boundary, request-claim과 기능이 겹치는 새 table을 병렬 정본으로 만들지 않는다.
DDL 전에 `extend | replace`를 선택하고 dual-write/backfill/read-cutover/contract owner를
manifest에 고정한다.

### 16.2 메시지 정규 컬럼

JSON metadata에만 두지 않는다.

```text
command_id
principal_type
actor_user_id
actor_member_id (shared only)
personal_workspace_id / personal_privacy_epoch (private only)
membership_security_epoch / shared_context_epoch (shared only)
privacy_scope_id
segment_id
lane
delivery_target
recipient_member_id
source_artifact_id
delivery_state
recalled_at
```

DB CHECK/trigger:

- `private_ai`: owner private, AI target, recipient null
- `shared_ai`: current shared audience, AI target, recipient null
- `shared_partner`: current shared roster, partner target, recipient 필수
- sender와 recipient는 서로 달라야 한다.
- actor, source, audience, recipient, epoch는 insert 후 불변이다.
- 상태 전환과 tombstone은 전용 RPC만 사용한다.

### 16.3 권한

- RLS default deny
- browser/mobile에는 anon key만
- service role은 브라우저·앱 번들·일반 로그에 절대 노출 금지
- request별 최소권한 owner-explicit RPC
- 사용자 receipt 발급은 authenticated JWT의 `auth.uid()`에서만 actor를 결정한다.
- commit/worker role은 이미 발급된 exact receipt를 소비할 수만 있고 receipt 발급·임의
  actor 지정·일반 table write 권한은 없다.
- 범용 `service_role`과 table owner/DDL credential은 일반 web/mobile request runtime에서
  제거한다. 불가피한 과도기 경로는 inventory, owner, kill switch와 제거 기한을 release
  blocker로 둔다.
- SECURITY DEFINER는 고정 `search_path`, explicit revoke/grant, 입력 검증
- production data를 개발·preview로 복사하지 않는다.
- preview stub에는 production DB, Storage, AI, analytics secret을 넣지 않는다.

### 16.4 인덱스

- command: unique `(request_kind, actor_user_id, client_request_id)`
- lease/command: partial `(status, expires_at)`
- message: unique `(command_id)`
- private timeline: `(personal_workspace_id, segment_id, created_at DESC, id)`
- shared timeline: `(couple_id, membership_security_epoch, segment_id, created_at DESC, id)`
- partner direct: partial `(recipient_member_id, created_at)`
- scope principal: PK `(scope_id, principal_type, principal_id)`
- viewer timeline이 artifact-level 예외를 쓰면
  `(principal_id, created_at DESC, artifact_id)` materialized access index 검토
- provenance: `(parent_artifact_id)`, `(child_artifact_id)`, unique edge
- grant: partial `(actor_user_id, status, expires_at)`
- outbox/purge: partial `(status, next_attempt_at)`

RLS hot path에서 JSON parsing과 unindexed helper를 피한다. 실제 cardinality와 current hosted schema에서 `EXPLAIN (ANALYZE, BUFFERS)`로 검증한다.

대부분의 메시지는 segment-level scope grant로 조회하고 예외만 artifact-level scope를 사용한다.
매 메시지 fan-out `EXISTS`가 pagination 병목이 되지 않도록 실제 대화량에서 heap fetch,
plan stability와 RLS latency를 gate로 측정한다.

---

## 17. 운영자, 로그, 분석과 비밀

### 17.1 운영자 원문 접근

기본 support 화면은 content-free 상태와 사용자 제공 incident ID만 보여준다. raw private chat을 보는 일반 admin UI를 만들지 않는다.

불가피한 break-glass:

- 정확한 support/security case
- private 원문 support 접근은 소유자 본인만 승인한다. 파트너에게 요청 존재를 알리거나
  승인권을 주지 않는다.
- shared 원문 support 접근은 원래 audience의 동의 정책을 적용한다. 일반 지원 목적의
  원문 열람은 현재 두 구성원 모두의 승인을 기본값으로 한다.
- 보안 사고 조사·적법한 법적 요구는 사용자 동의 흐름으로 위장하지 않는다. 적법 근거와
  서로 다른 내부 승인자 2명의 승인을 요구하고 예외 사유를 감사한다.
- 최소 row/scope
- 짧은 만료
- reason code와 immutable audit
- 다운로드·복사 기본 금지
- 사용자 통지 여부를 policy/legal 담당자가 판단
- 사용 후 자동 revoke와 정기 검토

service role과 content decrypt 권한을 한 일반 worker에 같이 두지 않는다.

### 17.2 Sentry/PostHog/로그

- 웹과 모바일이 같은 중앙 privacy scrubber를 사용한다.
- request/response body, URL query, headers, cookie, bearer, email, UUID, object path, message excerpt 제거
- 공용 logger의 임의 `extra.payload` 금지, allowlist schema만 허용
- chat/private 화면은 analytics 자체를 끄는 것이 기본
- autocapture, session replay, screenshot, view hierarchy, network body 수집 off
- 사용자/커플/message ID를 metric label로 쓰지 않는다.
- 오류 응답에 DB/SDK/provider 원문을 노출하지 않는다.
- synthetic secret canary를 Sentry/PostHog/server log/push에 흘려 egress 0을 증명한다.

### 17.3 비밀 관리

- 비밀은 전용 secret manager에 두고 Git, 문서, console, support ticket에 남기지 않는다.
- CI/CD는 가능한 short-lived OIDC를 사용한다.
- prod/staging/dev credential과 데이터 plane을 분리한다.
- 노출, 직원 변경, 권한 변경, 공급자 사고 때 즉시 rotate한다.
- key rotation과 이전 key 폐기 rehearsal을 release evidence로 남긴다.

---

## 18. 일반 애플리케이션·인프라 보안

아모라의 audience 경계만 강하고 계정, 브라우저, 배포 또는 공급망이 약하면 무누설
목표를 달성할 수 없다. 아래 항목은 ASVS 기반의 공통 출시 계약이다.

### 18.1 인증과 세션

- OAuth는 정확한 redirect allowlist, `state`, nonce/PKCE와 callback 검증을 사용한다.
- 웹 세션 cookie는 `HttpOnly`, `Secure`, 적절한 `SameSite`, 최소 path/domain을 사용한다.
- cookie 기반 mutation에는 CSRF 방어를 적용하고, 모바일 bearer와 혼용할 때도 요청 출처를
  명시적으로 구분한다.
- 로그인, 계정 복구, 초대, 이메일 확인 응답은 계정 존재 여부를 불필요하게 노출하지 않는다.
- 비밀번호 변경, 연결·해제, 데이터 export/delete, 관리자 작업은 recent re-auth를 요구한다.
- 로그아웃·비밀번호 변경·의심 활동·계정 삭제 시 관련 세션과 refresh token을 폐기한다.
- 관리자와 break-glass 계정은 phishing-resistant MFA와 별도 운영 identity를 사용한다.
- root/jailbreak 탐지는 보조 신호일 뿐 권한 판단이나 개인정보 보호의 유일한 근거로 쓰지 않는다.

### 18.2 브라우저와 API

- CSP nonce/hash, `frame-ancestors`, HSTS, `Referrer-Policy`, `Permissions-Policy`,
  MIME sniffing 차단을 배포 환경에서 검증한다.
- 사용자/AI 문자열을 HTML로 신뢰하지 않고 escape/sanitize한다. `dangerouslySetInnerHTML`,
  markdown HTML, 링크 protocol과 첨부 preview를 별도 공격 표면으로 본다.
- CORS는 실제 허용 origin, method, header만 열고 credential 응답에 wildcard를 쓰지 않는다.
- 모든 request/AI tool output에 runtime schema, 길이·개수·파일 크기 제한을 적용한다.
- SQL/RPC는 parameterized input을 사용하고, 사용자 또는 모델 출력으로 동적 SQL을 만들지 않는다.
- URL fetch, webhook, image proxy, 문서 fetch는 SSRF 방어, scheme/host allowlist,
  private-network 차단, redirect·DNS 재검증과 egress 제한을 갖춘다.
- mutation에는 rate limit, 비용 limit, timeout, abort, idempotency와 bounded retry를 둔다.
- 내부 오류, stack, query, provider body, secret을 사용자 응답으로 반환하지 않는다.

### 18.3 Cache, SSR과 Realtime

- 인증·차단 관계·audience에 따라 달라지는 응답은 `private, no-store`로 처리하고 공유 CDN에
  저장하지 않는다.
- 인증 cookie/bearer에 따라 달라지는 응답은 필요한 `Vary`를 명시하되, 가장 안전한 기본은
  sensitive route의 shared caching 자체를 끄는 것이다.
- 익명 SSR 결과를 로그인 사용자 화면에 먼저 hydrate하지 않는다. 서버 viewer scope와
  클라이언트 viewer scope가 일치하기 전에는 내용 없는 shell을 사용한다.
- URL query, page title, Open Graph, sitemap, search index와 browser prefetch에 private ID나
  내용을 넣지 않는다.
- Realtime channel은 actor, audience, epoch에 결박하고 account/unlink 시 즉시 unsubscribe한다.
  수신 이벤트도 현재 generation과 epoch가 맞아야 state에 들어간다.
- 원문 또는 암호문 row를 클라이언트 Realtime publication에 직접 싣지 않는다. 별도 opaque
  event에는 무작위 event ID와 재조회 신호만 두고, 현재 actor/audience/epoch를 다시 증명한
  BFF/Content Decryption Gateway가 exact artifact를 반환한다. count, object ID, ciphertext 크기,
  sender 활동처럼 private 존재를 추론하게 하는 metadata도 event payload에서 제외한다.

### 18.4 AI 출력과 도구 실행

- 모델 출력은 신뢰하지 않는 입력이다. 구조화 schema와 domain validator를 모두 통과시킨다.
- 모델은 DB, 결제, 일정, 예산, 메시지, 공개 게시를 직접 실행하지 않는다.
- tool allowlist, 정확한 argument schema, 최소권한 service identity, 한 번에 제한된 호출 수를 쓴다.
- 프롬프트나 첨부 안의 명령은 사용자의 권한 승인으로 간주하지 않는다.
- 외부 콘텐츠의 간접 prompt injection이 system rule, secret, 다른 사용자 자료 또는 tool
  authorization을 바꾸지 못하게 source와 instruction을 분리한다.
- 커플 양쪽에 영향을 주는 tool은 `decision_nodes`의 필요한 승인과 command receipt를 확인한다.
- 모델 refusal, timeout, partial result를 성공으로 재분류하거나 임의 fallback 모델에 원문을
  재전송하지 않는다.

### 18.5 모바일과 기기 저장

- 앱 binary에 service/API secret을 넣지 않는다. 공개 Supabase anon key도 권한 경계는 RLS다.
- token과 local encryption key는 iOS Keychain/Android Keystore 기반 저장소를 사용한다.
- 민감 초안·attachment cache·webview cache·clipboard를 lifecycle에 맞춰 지운다.
- deep link/universal link는 domain과 path를 검증하고 tap 때 서버 재인가한다.
- backup 대상에서 token, private cache, key material을 제외하거나 복원 후 재인증한다.
- 인증서 pinning은 key rotation과 장애 복구까지 검증할 수 있을 때만 도입하며, pinning이 없다고
  TLS 검증을 끄지 않는다.
- debug menu, test endpoint, verbose log와 screenshot fixture가 production build에 들어가지 않게
  build-time test를 둔다.
- OTA update는 native binary와 같은 신뢰 code plane으로 취급한다. production binary는 pinned
  production signing key로 서명되고 exact project/runtime/channel policy에 맞는 manifest만
  적용하며 unsigned, wrong-key, preview-channel, wrong-runtime update를 거부한다.
- OTA signing private key와 EAS production 권한은 일반 개발 계정에서 분리하고, phishing-resistant
  MFA, 최소 역할, 2인 승인, 짧은 배포 세션과 immutable audit를 적용한다. preview/development
  channel이 production binary로 매핑되지 않도록 조직 정책과 CI에서 모두 검사한다.
- OTA rollback도 임의 과거 bundle이 아니라 서명된 known-good update만 허용한다. update group,
  manifest·asset digest, signing key fingerprint, runtimeVersion, channel mapping, Git SHA를 release
  receipt에 결박하고 실제 기기 canary·revoke rehearsal 뒤 단계 배포한다.

### 18.6 공급망과 CI/CD

- lockfile과 runtime version을 고정하고 `--frozen-lockfile`로 설치한다.
- dependency/SCA, secret scan, SAST, IaC/SQL policy scan과 license inventory를 CI에 둔다.
- release마다 SBOM, artifact digest, build provenance와 서명을 남긴다.
- 보호 브랜치, 최소 2인 review, CODEOWNERS와 migration/security-owner 승인을 적용한다.
- fork/preview CI에는 production secret을 주지 않고, 외부 contribution의 lifecycle script를
  신뢰된 환경에서 바로 실행하지 않는다.
- 배포 identity는 환경별 최소권한·short-lived credential을 사용한다.
- critical 취약점 또는 악성 dependency 의심 시 관련 release를 멈추고 key/session을 회전한다.

### 18.7 데이터 plane과 복구

- prod, staging, dev를 별도 project/credential로 분리하고 비운영 환경에는 synthetic data만 쓴다.
- DB와 Storage 백업을 별도로 암호화하고 접근·복원 감사 로그를 남긴다.
- backup restore는 격리 환경에서 RLS, tombstone, key, Storage ownership을 다시 검증한다.
- DB connection, service role, KMS, provider, push 자격증명을 도메인별로 분리해 한 credential의
  침해가 전체 평문과 외부 전송 권한을 동시에 주지 않게 한다.
- WAF/DDoS/rate limit은 가용성을 돕지만 authorization의 대체물이 아니다.

### 18.8 보유기간과 처리자 관리

- 데이터 종류마다 목적, owner, processor, region, retention trigger, 삭제 방식과 legal hold를
  machine-readable registry로 관리한다.
- 새 SDK/processor를 추가하면 실제 payload, 기본 수집, 보관, 하위 처리자와 삭제 API를 먼저
  검토한다.
- privacy policy와 app-store privacy label은 실행 중인 설정과 일치해야 한다.
- 정확한 기간을 법적 근거와 운영 자동화 없이 임의로 적지 않는다.
- 처리자가 삭제/보존 증거를 주지 못하면 그 기능의 민감 데이터 사용을 제한하거나 끈다.

---

## 19. Kill switch와 장애 모드

서버·DB가 강제하는 독립 runtime mode를 둔다.

```text
normal | read_only | disabled
```

운영 계약:

- `disabled/read_only` 전환은 MFA를 통과한 당번 1명이 즉시 실행할 수 있고 immutable
  incident audit를 남긴다.
- control plane을 읽지 못하거나 값이 모호하면 기본은 `read_only`다. 단, `read_only`도
  current audience/epoch와 decrypt capability를 정상 증명한 기존 읽기만 허용한다. 그 증명이나
  KMS 상태까지 모호하면 해당 read 경계는 `disabled`다.
- 서버 API, DB RPC, AI/upload/push worker는 각 claim과 commit 직전에 DB-authoritative
  mode를 확인한다. 클라이언트 flag는 보조 UX일 뿐이다.
- read kill은 신규 HTTP만 막지 않는다. decrypt/read capability와 BFF cache를 revoke하고,
  Realtime channel generation을 회전해 기존 socket을 끊으며 list/search/bootstrap도 같은 mode를
  확인한다. CDN·service worker·device cache에는 민감 원문이 없어야 한다.
- 비활성화 명령부터 모든 신규 위험 작업 거부까지의 최대 전파 목표는 5초다. web/API/
  worker별 측정 영수증이 목표를 통과해야 한다.
- 재활성화는 원인 수정, 공격 회귀, privacy canary 뒤 Privacy Owner와 Release Owner
  두 사람의 승인을 요구한다.

독립 제어 대상:

- 전체 채팅 쓰기
- private read/list/search/decrypt
- shared/direct read/list/search/decrypt
- Realtime/bootstrap delivery
- private AI
- shared AI
- partner direct delivery
- shared action/결정 실행
- private→shared declassification
- community public bridge
- memory
- attachment upload/read
- provider 호출
- proactive care
- push
- pre-link import
- 최소 앱 버전 미만 mutation/read/subscription

잘못된 수신자 저장·읽기·AI 문맥 포함·push가 한 건이라도 확인되면 해당 경계를 즉시
`disabled`로 만든다. 범위를 확정할 수 없으면 전체 chat mutation/provider egress를 중단하고
private/shared/direct read·decrypt·Realtime을 `disabled`로 전환한다. `read_only`는 read 경계가
정상임이 별도로 증명된 가용성 장애에만 사용한다.

privacy fence를 제거하는 rollback은 금지한다. 이전의 약한 RLS로 돌아가지 않고 forward-only fix를 적용한다.

---

## 20. 필수 공격 테스트

mock UI 성공만 보지 않는다. 실제 DB row, provider call, outbox, Realtime과 로그까지 함께 확인한다.

### 20.1 계정·scope 경계

| ID | 시나리오 | 통과 조건 |
|---|---|---|
| A01 | A private 초안 → bearer 직전 정지 → 같은 커플 B 로그인 | 409/412, 모든 visibility 메시지 0, provider 0 |
| A02 | A partner 전송 → 같은 전환 | 메시지·recipient·Realtime·push 0 |
| A03 | A shared-action 승인 → B 전환 | B acceptance 0, 실행 claim 0 |
| A04 | A 기억 GET 정지 → B 전환 | A 데이터 DOM/state 0, B 검증 전 잠금 화면 |
| A05 | 웹 identity render 뒤 effect 전 전송 시도 | 이전 draft/attachment DOM 및 write 0 |
| A06 | 다른 커플로 hot switch | 이전 내용 한 프레임도 노출되지 않음 |
| A07 | 두 기기에서 서로 다른 lane 사용 | Realtime/cache/AI context 교차 0 |
| A08 | offline queue 후 unlink/relink | 자동 재전송 0 |
| A09 | A용 push 수신 뒤 같은 기기에서 B 로그인 후 tap | A 내용·route·ID 노출 0 |
| A10 | 같은 사용자의 기기 1에서 unlink/logout 뒤 기기 2 stale send | write·push·Realtime 0 |
| A11 | private lane 검색/최근 목록/bfcache 뒤 shared 전환 | private result 한 프레임 노출 0 |
| A12 | private 화면 background/app switch/screen-capture signal | 앱이 제어하는 switch snapshot/recent screen 원문 0, capture 감지 뒤 shield 표시와 OS 한계 고지 |
| A13 | invite 만료/재사용/self-link/wrong actor/already-linked | 모두 거부, membership 변화 0 |
| A14 | 같은 unbound invite를 두 계정이 동시에 redeem | pending candidate 최대 1, active membership/shared principal 0 |
| A15 | link와 unlink 동시 실행 뒤 old invite replay | old couple sealed, pending work 0, replay 거부 |
| A16 | unlink 뒤 새 partner 연결 | 새 couple/epoch, old archive·key·AI context 상속 0 |
| A17 | A의 private AI 사용 전후 B가 quota·remaining·typing·presence·count·오류를 관찰 | B 관측값으로 A private 활동 유무를 구분할 수 없음 |
| A18 | 유효/무효 invite 대량 추측·재사용·DB/log/analytics 검사 | 동일한 외부 실패, bounded rate, pending redemption 최대 1회, raw token 저장·관측 0 |
| A19 | token 탈취자가 intended recipient보다 먼저 redeem | pending만 생성, shared read/write/key/push 0; issuer 거절·재발급 가능 |

### 20.2 파생·공개 경계

| ID | 시나리오 | 통과 조건 |
|---|---|---|
| D01 | private source + `messageId=null` shared note | 거부, note 0 |
| D02 | private source ID + 변조 content | 거부, note 0 |
| D03 | private 의미상 민감 문장 → community | grant 없으면 거부 |
| D04 | grant 본문/대상 변경·재사용·만료 | 전부 거부 |
| D05 | partner direct 후 AI 질문 | direct 원문 provider context 0 |
| D06 | pre-link 기록 후 partner 연결 | 새 partner 조회/AI context 0 |
| D07 | private+shared 부모를 함께 쓴 파생물 | private audience 유지 |
| D08 | stolen/old session으로 private→public grant | recent re-auth 없으면 거부 |
| D09 | C5 또는 제3자 민감정보 public grant | valid preview여도 destination policy가 거부 |
| D10 | A가 B 작성 `shared_partner` 수신 원문을 public bridge | audience membership만으로 grant 불가, 공개 artifact 0 |
| D11 | A가 상대 기여·joint-context AI 출력의 공개를 단독 승인 | 양쪽 독립 grant 없으면 거부; 두 grant는 같은 preview/destination/version에 결박 |

### 20.3 파일·삭제·복원

| ID | 시나리오 | 통과 조건 |
|---|---|---|
| F01 | 업로드 중 account/scope 변경 | 새 scope attach 0, orphan cleanup receipt |
| F02 | signed URL 발급 직후 unlink/delete | 신규 access 거부, 잔여 TTL 증거 |
| F03 | recall과 AI/Storage worker 경합 | stale worker 저장 0 또는 즉시 purge |
| F04 | private delete 후 전체 계보 조회 | 각 processor의 terminal/pending 상태와 SLA·owner, overdue 0 |
| F05 | 삭제 뒤 backup restore | tombstone replay 뒤 다시 0 |
| F06 | Undo/Recall과 provider·push worker 동시 claim | cancelled 경계 이후 외부 전달·파생 0 |
| F07 | A 계정 삭제, B 잔존 | disposition matrix와 일치, A private 0, B 자기 작성본/허용 공동결정만 유지 |
| F08 | A export 생성 뒤 account switch/unlink, B가 handle 재사용 | B 응답·화면·archive에 A 자료 0, handle 취소, 임시 archive/DEK purge receipt |

### 20.4 권한·배포·관측

| ID | 시나리오 | 통과 조건 |
|---|---|---|
| O01 | anon/auth/service receipt 없는 INSERT | 모두 거부 |
| O02 | 구형 앱 direct write | stable upgrade error, write 0 |
| O03 | 코드 SHA와 DB/Storage digest 불일치 | 위험 기능 자동 off |
| O04 | synthetic private canary | logs/Sentry/PostHog/push에 원문 0 |
| O05 | provider retention/config 불명 | private/high-risk provider 호출 0 |
| O06 | write/provider kill switch rehearsal | 지정 경계의 신규 mutation/provider call 0 |
| O07 | 공개 demo exact deployment 재검증 | private/shared draft 격리, SHA 일치 |
| O08 | screen reader/keyboard로 partner Undo | 실제 수신자 안내, 7초 안에 독립 취소 가능 |
| O09 | user/admin/service read IDOR matrix | A/B/former/new partner/other couple의 exact audience만 조회 |
| O10 | audit/capability 뒤 barrier에서 unlink/kill 후 token-count/create | provider network request 모두 0 |
| O11 | 구형 실제 binary의 raw table select/Realtime subscribe | 원문·암호문·private metadata 0, 안정적인 업데이트 안내만 표시 |
| O12 | unsigned/wrong-key/wrong-channel/wrong-runtime OTA를 production 실기기에 제공 | update 적용 0, 현재 known-good binary 유지, content-free 보안 event |
| O13 | commit 성공 뒤 response loss, terminal receipt GC 경계 전·후 같은 request ID 재시도 | message·outbox·provider 호출 중복 0; 만료 명령은 새 명령으로 부활하지 않음 |
| O14 | legacy plaintext synthetic marker를 DB/replica/search/vector/Storage/temp/cache에 심고 encryption cutover | live plaintext marker 0, ciphertext coverage 100%, backup 잔존은 owner/expiry/restore fence 증거 |
| O15 | active BFF decrypt capability·Realtime socket·list cache가 있는 동안 read kill | 5초 안에 capability revoke/socket 종료/cache miss, 이후 private/shared 원문 read 0 |
| O16 | anonymous SSR payload 뒤 로그인/계정/차단 scope가 hydration 전에 바뀜 | viewer scope 일치 전 content-free shell, 이전 body DOM/cache 노출 한 프레임 0 |

### 20.5 동시성 barrier

다음 지점에 테스트 barrier를 둔다.

- draft context capture 직후
- token read 직전/직후
- server auth 뒤 DB reserve 직전
- reserve와 commit 사이
- DB commit 뒤 response 전
- provider claim 직전/직후
- provider 결과 뒤 finalizer 전
- Realtime 수신 뒤 UI 반영 전
- upload create/upload/finalize/attach/cleanup 사이
- push outbox claim 뒤 발송 전
- link/unlink transaction 중간

지연, token refresh, 401, offline/reconnect, 강제 종료, response loss, 중복 요청, 역순 Realtime, serialization retry와 provider timeout을 주입한다.

---

## 21. 검증 파이프라인과 출시 영수증

### 21.1 CI/QA 계층

1. unit/property tests: scope, audience, state transition, parser
2. local Postgres/Supabase contract: RLS, RPC, trigger, idempotency
3. adversarial concurrency: barrier 기반 A/B 계정·두 기기
4. web browser QA: 두 탭, back/forward, refresh, accessibility
5. iOS/Android 실기기: account switch, background, push, offline
6. hosted clone: migration, Storage, RLS, backup/restore
7. production read-only canary: exact SHA와 synthetic marker
8. 독립 보안 감사·침투 테스트

### 21.2 하나의 release receipt

다음을 한 immutable artifact로 묶는다.

- Git commit SHA와 lockfile digest
- Vercel deployment ID/build ID
- iOS/Android build ID, 서명, 최소 허용 버전
- OTA update group ID, manifest·asset digest, signing key fingerprint, runtimeVersion, production
  channel mapping과 update가 가리키는 Git SHA
- Supabase project ref, migration head와 migration digest
- RLS/RPC/trigger/Storage policy digest
- feature/runtime mode snapshot
- provider organization/project와 retention mode evidence
- backup DB/Storage receipt와 restore rehearsal
- test matrix 결과와 synthetic canary ID
- 승인자, 시간, rollback/kill-switch artifact

증거가 없거나 서로 다른 commit을 가리키면 통과가 아니다.

### 21.3 Privacy canary

실사용자가 아닌 전용 두 커플·두 계정으로 무작위 marker를 넣는다.

- A private marker는 A만 읽음
- shared marker는 해당 epoch의 두 명만 읽음
- partner marker는 두 명에게만 보이고 AI context에는 없음
- 다른 커플 marker는 전부 거부
- pre-link marker는 연결 뒤에도 partner에게 안 보임
- A private 사용 전후 B의 quota·count·presence·error 관측값에는 식별 가능한 차이가 없음
- stale epoch command는 거부
- push/log에는 marker 없음

`privacy_canary_contamination_total`은 항상 0이어야 한다. 1이면 자동 rollout 중단과 kill switch다.

---

## 22. 사고 대응

1. 잘못된 내용이 UI, DB, Realtime, provider, Storage, push, public 중 어디까지 갔는지 분류한다.
2. 해당 boundary kill switch를 먼저 켠다. 범위를 모르면 전체 chat mutation/provider egress를
   멈추고 private/shared/direct read·decrypt·Realtime을 `disabled`로 만든다.
3. session, lease, push token, signed URL 발급과 관련 security epoch를 폐기한다.
4. 원문을 incident log에 복사하지 않고 incident ID와 keyed content binding만 보존한다.
5. provenance graph로 답변·요약·기억·노트·결정·첨부·알림·게시 파생물을 추적한다.
6. 가능한 객체를 tombstone/purge하고 미발송 outbox를 취소한다.
7. 개인정보/법률 담당자가 적용 법령과 실제 범위를 기준으로 신고·통지 의무를 판단한다.
8. 사용자에게 발생 범위, 이미 본 사람이 있는지, 취한 조치와 남은 한계를 정확히 알린다.
9. synthetic canary와 공격 회귀를 통과한 forward fix만 다시 연다.
10. 원인, 탐지 지연, 영향, 통제 실패, 재발 방지와 evidence를 postmortem에 남긴다.

임의의 법정 통지 기간이나 보유 기간을 코드 문서에서 추정해 확정하지 않는다.

---

## 23. 개인정보를 지키는 말투와 접근성

아모라는 사용자를 겁주거나 탓하지 않는다. 짧고 구체적으로 `누가 보는지`, `무엇을 멈췄는지`, `어떻게 복구하는지`를 말한다.

좋은 카피:

- `계정이 바뀌어 이전 초안을 보내지 않았어요.`
- `이 내용은 나만 상담에 남아 있어요.` — 같은 계정에서 lane만 바꾼 경우에만
- `이전 계정의 초안은 이 계정에 표시하지 않았어요.` — 실제 계정 전환
- `김지은님과 공유할 새 문장만 확인해 주세요.`
- `연결 전 기록은 자동으로 공유하지 않아요.`
- `이전 대화를 내 화면에서 숨겼어요. 원문을 삭제한 것은 아니에요.`

피할 카피:

- `100% 안전합니다`
- `완전히 회수했습니다` — 이미 전달됐을 가능성이 있을 때
- `AI가 개인정보를 모두 제거했습니다`
- `커플이니까 이전 공유 기록도 자동으로 보여드려요`
- 내부 오류 원문 또는 불필요한 위험 설명

접근성:

- scope 변경을 screen reader live region으로 알림
- `함께 대화 탭, 김지은님에게 보임`처럼 audience 포함
- 전송 버튼 이름에 실제 destination 포함
- 확인창 focus trap, Escape/Back, focus return 검증
- 최소 44px touch target, Dynamic Type/zoom/reduced motion 지원
- 색 외에 텍스트와 아이콘 사용

---

## 24. 구현 순서

달력 날짜보다 dependency와 증거를 우선한다. 어느 단계든 실패하면 다음 단계로 가지 않는다.
아래 Phase는 dark migration과 구현 작업 순서이지 기능 ON 권한이 아니다. C3~C5를 저장·읽기·
전송하는 모든 기능은 뒤의 `COMMON_PRIVACY_BASELINE` 영수증과 자기 기능 영수증이 모두
통과할 때까지 server/DB에서 OFF다. 따라서 Wave A나 Wave C 코드를 먼저 적용해도 사용자
runtime은 열리지 않는다.

### Phase 0 — 즉시 봉인

- 새 아모라 경계 기능 동결
- private→public, pre-link import, shared note from private, attachment 등 증명되지 않은 기능 server-off
- 위험 mutation의 `normal/read_only/disabled` control plane
- production SHA/migration/storage drift 확인
- 일반 사용자 응답을 만드는 service/admin read/write 경로 전수 inventory

### Phase 1 — P0 임시 containment

- 모바일 메시지·shared action에 captured actor와 expected-user 요청 적용
- 기억 화면 late response 차단
- 웹 chat subtree를 privacy composite key로 synchronous remount
- raw prefill을 neutral handoff로 전환
- user/list/search/Realtime read를 authenticated JWT/RLS + generation 경계로 전환
- 회귀 RED 테스트부터 추가

이 단계는 화면 노출과 일반 경합을 줄이는 containment일 뿐 P0-1/P0-2를 닫지 않는다.
P0는 Phase 2 server lease/RPC, Phase 4 direct INSERT 폐쇄와 hosted DB A/B 공격시험까지
모두 통과한 뒤에만 `closed`로 바꾼다.

### Phase 2 — Command v2와 DB 원자화

- stable `couple_members`와 monotonic membership security epoch
- 128-bit+ HMAC-only invite ledger, token-only pending/양쪽 handshake와 기존 평문 code revoke/contract migration
- composer lease, command receipt, audience snapshot, AI outbox
- reserve/commit RPC
- idempotency drift conflict
- 최소 앱 버전 gate

### Phase 3 — 파생물 경계

- notes canonical source화
- provenance graph와 audience inheritance
- declassification grant
- pre-link history 봉인
- decision/shared action 동일 command protocol

### Phase 3A — Memory Wave A 독립 승격

- `AMORA_AUXILIARY_MEMORY_ENABLED=false`를 server/worker/DB에서 기본 강제
- staged Wave A의 canonical source scope와 actor/personal/shared epoch를 hosted clone에서 검증
- private/shared 기억 생성·철회·삭제·계정전환 공격 시험
- backup/restore와 exact apply receipt 뒤 Wave A만 별도 immutable release
- `COMMON_PRIVACY_BASELINE`, Phase 4 직접 경로 폐쇄, 사람의 명시 opt-in과 제한 canary가
  모두 끝나기 전에는 memory runtime을 켜지 않음

### Phase 4 — 직접 쓰기 폐쇄

- v2 traffic/adoption 증거
- old client 차단
- Wave B를 별도 immutable release로 적용
- runtime-writer contract migration으로 authenticated/service direct INSERT 0 증명
- 일반 사용자 응답 경로의 service/admin broad read 0과 hosted O09 증명

### Phase 5 — 첨부 Wave C

- upload session ledger, exact-byte finalize, consumer-visible atomic publish saga
- cleanup lease와 absence receipt
- signed URL revocation/TTL proof
- malware/metadata/OCR gate
- `COMMON_PRIVACY_BASELINE`과 Phase 4 직접 경로 폐쇄 전에는 upload/read runtime OFF

### Phase 6 — 공통 개인정보 baseline·운영 권리·공급망

- provider DPA/region/ZDR 또는 MAM 증거
- web/mobile 중앙 scrubber와 canary
- private/shared envelope encryption과 KMS 분리
- operator break-glass
- privacy center와 re-authenticated one-time export/archive purge
- signed OTA update, production/preview channel 격리, EAS 조직 MFA·최소권한·2인 승인과 실기기
  wrong-key/wrong-channel 거부 시험

### Phase 7 — 적대적 검증과 제한 베타

- 두 계정·두 기기·두 탭 전체 matrix
- hosted clone backup/restore
- 실기기 push/background/offline
- 독립 pentest에서 해당 release scope의 P0/P1 발견 0 또는 수정·재시험으로 closure
- 개인정보 법률 검토와 실제 처리자/국외이전/보유 고지 일치
- synthetic/internal canary 뒤 단계 rollout

구현이 일정에 맞지 않으면 기능 범위를 줄인다. 경계를 생략해 날짜를 맞추지 않는다.

### Expand/contract migration 순서

1. current hosted schema, RLS/grant, cardinality와 기존
   `conversation_segments | amora_chat_request_claims | account_deletion_jobs |
   private delete boundary`를 inventory하고 extend/replace 결정을 manifest에 고정한다.
2. personal workspace, stable member, scope, command, artifact와 함께 `ciphertext`, nonce/tag,
   algorithm/key/AAD version과 encryption-coverage column/table을 nullable additive로 추가한다.
   기존 read/write 동작은 아직 바꾸지 않는다.
3. 새 서버만 legacy plaintext와 authenticated ciphertext를 dark dual-write한다. canonical
   plaintext의 keyed digest를 양쪽 복호화 결과와 비교하고 어느 한쪽 실패도 성공으로 숨기지
   않는다. 신규 plaintext는 이 migration worker 외 다른 sink로 복제하지 않는다.
4. legacy row/object를 bounded batch로 읽어 exact scope/epoch DEK와 AAD로 암호화 backfill한다.
   actor/audience/pre-link/role이 모호하면 shared로 추정하거나 암호화 완료로 표시하지 않고
   quarantine한다.
5. FK/CHECK는 `NOT VALID`, 큰 index는 `CONCURRENTLY` 가능한 경로로 만들고 실제 부하에서
   lock/plan을 확인한 뒤 validate한다.
6. shadow read로 legacy plaintext와 ciphertext 복호화 결과, audience와 provenance를 비교하고
   mismatch 0과 `encrypted_live_coverage=100%`를 증명한다.
7. BFF/Content Decryption Gateway와 opaque Realtime event를 먼저 배포하고 새 web/mobile이 direct
   table read/subscription 없이 동작하는지 shadow·canary로 증명한다.
8. 서명된 compatibility update로 지원 중인 구형 mobile에도 안정적인 강제 업데이트 화면을
   배포하고, minimum version과 v2 endpoint adoption을 확인한다. version 값은 호환 gate일 뿐
   authorization 근거로 사용하지 않는다.
9. old-client mutation을 막는 것과 함께 raw `chat_messages` SELECT grant와 원문/암호문 table의
   Realtime publication을 폐쇄한다. 실제 구형 binary가 원문·암호문·private metadata를 읽지
   못하는지 확인한 뒤 read를 새 정본으로 cutover한다.
10. 신규 plaintext write를 DB constraint로 거부하고 `chat_messages.content` 같은 legacy 원문을
    원자 batch로 null/tombstone한다. 검색/vector/thumbnail, Storage plaintext quarantine, temp
    file, export archive, app/web cache와 read replica에 같은 generation의 purge를 실행한다.
11. primary/replica/search/vector/Storage/temp/cache/observability별 scan과 keyed synthetic marker로
    **live plaintext 잔존 0** coverage receipt를 만든다. 과거 backup은 0으로 가장하지 않고
    격리 key, 만료일, restore-before-open 재암호화/purge와 owner를 release receipt에 기록한다.
12. Wave A, Wave B, runtime-writer 권한 회수, Wave C를 서로 독립된 release/receipt로 적용한다.
13. 관찰 기간과 restore rehearsal 뒤 legacy direct grant, plaintext column/index, old reader와
    writer를 contract migration으로 제거한다.

privacy migration 실패 시 약한 정책으로 rollback하지 않는다. 해당 기능을 `read_only`로 두고
backup과 journal을 보존한 채 forward fix한다. 각 wave는 현재 release controller, backup,
restore와 read-only postcondition을 통과해야 한다.

### 기능별 ON/OFF 계약

`chat.* | artifact.notes | bridge.community | attachment.chat | memory | push |
care.proactive | privacy.export` row의 실제 ON predicate는 다음 논리곱이다.

```text
ON(content_feature) = COMMON_PRIVACY_BASELINE
                      AND FEATURE_SPECIFIC_RECEIPT(content_feature)
                      AND AUDIT_FINDINGS_CLOSED(content_feature)
                      AND CURRENT_RELEASE_RECEIPT_MATCHES
```

`COMMON_PRIVACY_BASELINE`은 다음을 모두 뜻한다.

- command v2, actor/audience/epoch DB 검증과 authenticated/service direct write 폐쇄
- DB-authoritative BFF read, field/object envelope encryption, KMS 분리, raw table SELECT와
  원문/암호문 Realtime publication 폐쇄
- content-free log/Sentry/PostHog/push와 audited provider egress; provider를 쓰는 기능은
  추가로 해당 organization/project/endpoint의 승인된 retention 계약
- provenance, retention/delete/backup-restore, identity 전환, old-client, two-device 공격 시험
- read/write/decrypt/Realtime/provider별 kill switch와 current immutable release receipt
- 독립 보안 감사·침투 테스트에서 해당 범위 P0/P1 0

표의 `ON 최소조건`은 이 공통 조건에 더하는 기능별 조건만 적는다. 공통 기준을 구현하지
않거나 증거가 만료되면 한 row의 조건이 좋아 보여도 해당 콘텐츠 기능은 자동 OFF다.
`couple.invite`와 `mobile.ota`는 기반 control이라 자기 row의 조건으로 독립 활성화할 수 있지만,
그 성공이 chat/memory 등 콘텐츠 기능의 공통 기준을 대신하거나 자동 활성화하지 않는다.

| 기능 / 경계 key | ON 최소조건 | 미충족 시 | OFF 사용자 경험 |
|---|---|---|---|
| `chat.private_ai` | command v2, owner RLS, field encryption/ID-only Realtime, provider 계약, content-free 관측, private delete | OFF | `나만 상담의 안전 확인을 마치는 중이에요. 초안은 이 기기에만 남겼어요.` |
| `chat.shared_ai` | private 조건 + current membership/epoch, shared key, pre-link 봉인, shared decision 계약 | OFF | `함께 상담을 안전하게 연결하는 중이에요. 나만 상담은 계속 이용할 수 있어요.` |
| `chat.partner` | exact recipient, command v2, encrypted scope, 7초 hold, generic push, two-device 시험 | OFF | `직접 메시지는 잠시 쉬고 있어요. 함께 아모라와 정리할 수 있어요.` |
| `artifact.notes` | canonical source, audience 상속, private declassification | OFF | 저장 버튼을 숨기지 말고 `안전한 저장 방식을 준비 중이에요.` 표시 |
| `bridge.community` | source 공개권/필요 인원, exact-preview grant, 민감정보 policy, 공개 provenance/recall | 기본 OFF | 빈 커뮤니티 작성 화면만 열고 상담 원문 자동 전달 0 |
| `attachment.chat` | Wave C session ledger, consumer-visible atomic publish saga, cleanup/URL/검사 증거 | OFF | text 상담은 유지하고 첨부 선택 전에 이유를 안내 |
| `memory` | 명시 동의, source scope, 계정전환, 철회·삭제·파생 purge | 기본 OFF | 현재 답변만 제공하고 `기억하지 않아요` 명시 |
| `push` | generic payload, token/epoch binding, Expo 처리 계약, opaque tap handle 재인가, A→B 시험 | OFF | 앱 안 inbox만 사용, OS 알림이 없음을 설정에 표시 |
| `care.proactive` | scope별 source, 빈도/quiet/snooze, consent, push/inbox 경계 | 기본 OFF | 사용자가 연 일정·예산 화면에서만 수동 확인 |
| `couple.invite` | HMAC-only 128-bit+ ledger, token-only pending, exact recipient 또는 양쪽 독립 re-auth 확인, old code 폐기 | OFF | 연결 기능을 잠그고 새 초대가 저장되지 않았음을 안내 |
| `privacy.export` | exact audience, recent re-auth, one-time stream, encrypted archive/DEK purge, A→B 시험 | OFF | privacy center에서 준비 중 상태와 다른 권리 요청 채널 안내 |
| `mobile.ota` | pinned signature, prod channel/runtime 격리, EAS MFA·2인 승인, 실기기 negative test | OFF | OTA를 적용하지 않고 검증된 store binary만 유지 |

각 row는 독립 server/DB runtime mode를 가진다. 클라이언트가 ON으로 보여도 server gate가
OFF면 실행되지 않는다.

### 단계 rollout 계약

```text
synthetic only -> 내부 사용자 -> 1% -> 5% -> 25% -> 50% -> 100%
```

- production 비율 단계는 각각 최소 24시간 유지한다. 해당 기능 사용량이 공격 matrix와
  canary를 대표하기에 부족하면 시간을 늘리고 자동 승급하지 않는다.
- 매 단계 시작 전 exact release receipt, kill-switch health와 전체 synthetic 공격 suite를
  확인한다.
- contamination, 잘못된 audience/actor/recipient, raw telemetry, evidence drift는 한 건이면
  즉시 승급 중단·해당 경계 OFF다.
- 각 단계에는 Incident Commander, Privacy Owner, Release Owner와 당번 시간을 기록한다.
- 재개는 원인 수정, 회귀, canary와 Privacy/Release Owner의 2인 승인이 필요하다.
- 100% 뒤에도 최소 72시간 강화 모니터링한다.

따라서 2주 목표의 정직한 완료는 모든 기능 100% 공개가 아니라, 게이트를 통과한 작은
기능 집합의 제한 베타일 수 있다. 관찰 시간을 줄여 일정에 맞추지 않는다.

---

## 25. 출시 절대 게이트

다음 중 하나라도 미충족이면 해당 기능은 꺼야 한다.

- [ ] P0-1~P0-5 수정과 실계정 A/B/provider barrier 공격 테스트 통과
- [ ] 모든 mutation의 actor/couple/member/epoch/lane/recipient 서버 검증
- [ ] receipt 없는 direct INSERT 폐쇄
- [ ] private 파생물 audience 상속과 declassification grant
- [ ] read audience와 공개 권한 분리, 상대 작성본 단독 bridge 0, joint source 양쪽 독립 승인
- [ ] Memory Wave A의 독립 hosted receipt와 auxiliary memory 기본 OFF/명시 활성화 증거
- [ ] 연결 전 기록 자동 공개 제거
- [ ] HMAC-only 128-bit+ invite, token-only pending, exact recipient/양쪽 독립 re-auth handshake와 기존 평문 invite 완전 revoke
- [ ] private quota·typing·presence·count·오류를 파트너가 비교해 활동을 추론하는 경로 0
- [ ] 웹·모바일 identity 전환 시 이전 화면/초안 한 프레임 노출 0
- [ ] partner/public delivery hold와 Undo
- [ ] Undo/Recall과 provider·push·Realtime worker 경합 시험
- [ ] 첨부 session ledger, consumer-visible atomic publish saga, orphan/signed URL 증거 또는 기능 off
- [ ] content-free Sentry/PostHog/log/push canary
- [ ] OpenAI 실제 조직/project의 retention/region/DPA evidence 또는 provider feature off
- [ ] 현재 membership fence의 hosted 적용과 RLS 공격 matrix
- [ ] user/list/search/Realtime의 DB-authoritative read와 service/admin read IDOR matrix
- [ ] private/shared field encryption, KMS 분리, ID-only Realtime, key rotation/restore 증거
- [ ] legacy `chat_messages.content`와 DB/replica/search/vector/Storage/temp/cache의 live plaintext
  잔존 0·ciphertext coverage 100% 영수증; backup 잔존은 격리/만료/restore-before-open 증거
- [ ] DB·Storage backup 및 restore 뒤 tombstone 재적용 증거
- [ ] A 탈퇴/B 잔존 disposition matrix, 외부 deletion locator와 WORM journal restore 시험
- [ ] privacy center/export의 exact audience, one-time re-auth stream, A→B account-switch 격리와 archive purge
- [ ] retention class/expiry/legal hold policy와 overdue·owner 없는 purge 0
- [ ] iOS/Android/web 두 계정·두 기기·offline·Realtime matrix
- [ ] 같은 사용자의 두 기기 중 한쪽 logout/unlink 뒤 다른 기기의 stale write 0
- [ ] A용 push 도착 뒤 B 로그인·tap 시 A 내용·route 노출 0
- [ ] 앱이 제어하는 app-switch snapshot/recent screen 원문 0, 지원 OS capture 보호와 한계 검증
- [ ] lane별 검색·최근 목록·browser bfcache의 cross-scope 결과 0
- [ ] anonymous SSR→로그인/계정/차단 전환 hydration에서 viewer scope 확인 전 원문 DOM/cache 0
- [ ] 공개 demo의 exact deployment SHA에서 private/shared draft 회귀 0
- [ ] screen reader가 실제 수신자·scope를 읽고 Undo를 keyboard/screen reader로 취소 가능
- [ ] old-client mutation gate와 raw table read/Realtime subscription 폐쇄, 실제 구형 binary 업데이트 안내
- [ ] production OTA pinned signature/channel/runtime, EAS MFA·권한, wrong-key/wrong-channel 실기기 시험
- [ ] response-loss와 receipt GC 경계 재시도에서 message·outbox·provider 중복 0
- [ ] write/provider 및 read/decrypt/Realtime kill-switch 5초 전파, active socket/capability revoke,
  정상 read만 가능한 control-plane 장애 read-only, 재활성화 2인 승인 rehearsal
- [ ] exact code SHA/mobile build/OTA manifest/DB/Storage/provider를 묶은 release receipt
- [ ] 기능별 ON/OFF 표와 단계 rollout의 dwell·중단·당번·재개 영수증
- [ ] 운영자 MFA, 최소권한, break-glass, incident tabletop
- [ ] 독립 전문 보안 감사·침투 테스트 완료뿐 아니라 해당 release scope의 모든 P0/P1
  수정·재시험 closure; 미해결 항목이 닿는 기능은 scope와 binary/server에서 제거
- [ ] 실제 처리 항목·국외 이전·보유/삭제에 대한 개인정보 법률 검토

### 출시 지표

다음은 품질 목표이자 gate다.

- 잘못된 actor/scope/recipient 저장: 0
- private/shared/다른 커플 오노출: 0
- partner direct의 AI context 포함: 0
- 로그·분석·오류·push 원문: 0
- stale epoch 성공: 0
- privacy canary contamination: 0
- encryption cutover 뒤 live plaintext 잔존: 0, ciphertext coverage: 100%
- 활성 release scope의 미해결 보안 감사 P0/P1: 0
- SLA 초과 또는 owner/근거 없는 purge·legal hold: 0
- 배포 evidence drift: 0

공유율, 메시지 수, 공동 동의율을 개인정보 안전보다 우선하는 KPI로 쓰지 않는다.

---

## 26. 제거할 수 없다고 정직하게 말해야 하는 위험

아래 위험은 통제로 줄일 수 있지만 제품이 절대 0이라고 보장할 수 없다.

- malware, keylogger, 악성 browser extension, 탈옥/root 또는 잠금 해제된 사용자 기기
- 사용자가 직접 복사·공유한 내용, 수신자가 이미 본 화면·알림·스크린샷·외부 카메라
- AI 답변을 위한 승인된 gateway/provider의 순간적 평문 처리
- 계약상 abuse monitoring, 법적 보관과 적법한 기관 요구
- 아직 알려지지 않은 zero-day, cloud/KMS/공급망 침해와 악의적 내부자
- 내용 암호화 뒤에도 남을 수 있는 접속 시간, IP, 트래픽 크기 같은 최소 운영 metadata
- 고지된 기간이 끝나기 전 backup과 `legally_held` artifact
- fail-closed 때문에 발생할 수 있는 일시적 read-only/기능 중단

아모라는 이 한계를 약관 속에 숨기지 않는다. 처리자, 공유 대상, 회수 가능 범위와 pending
삭제를 사용자가 실제 행동 전에 이해하게 하고, 사고 시 범위와 조치를 구체적으로 알린다.

---

## 27. Definition of Done

아모라 개인정보 설계는 다음을 모두 만족할 때만 완료다.

1. 제품 화면은 한 개의 편안한 진입점을 제공하면서도 세 lane의 상태를 자동 공유하지 않는다.
2. 모든 mutation은 identity-bound command와 DB receipt를 사용한다.
3. 모든 artifact는 audience와 provenance를 가진다.
4. private/shared 범위를 넓히는 유일한 경로는 source 공개권과 필요 인원 승인을 검증한
   exact-preview declassification이다.
5. 연결·해제·계정 전환·구형 앱·offline·동시성에서 stale read/write가 0이다.
6. 첨부, AI, 알림, 분석, 오류, 운영자, 백업도 동일한 privacy lifecycle에 들어간다.
7. 사용자는 보이는 사람, 삭제 의미, 회수 한계, 제공자 처리를 이해할 수 있다.
8. 코드·DB·Storage·모바일 binary/OTA·provider의 실제 운영 상태가 한 release receipt로 증명된다.
9. 독립 보안 감사와 개인정보 법률 검토의 P0/P1이 닫힌다.
10. 사고 시 write/provider뿐 아니라 read/decrypt/Realtime도 즉시 끄고 범위·파생물·사용자
    조치를 추적할 수 있다.
11. encryption cutover 뒤 live plaintext 잔존은 0이고, 과거 backup 잔존은 격리·만료·
    restore-before-open 영수증으로만 예외 처리된다.

이 상태에서도 `절대 유출 불가능`을 광고하지 않는다. 대신 검증한 범위, 적용한 통제, 남은 한계와 사고 대응을 정직하게 말한다. 그것이 소비자에게 가장 강한 신뢰 계약이다.

---

## 28. 현재 구현자가 바로 시작할 첫 작업 묶음

1. P0 공격 테스트 5개를 RED로 고정한다.
2. mobile 공용 API를 `expectedUser + generation + abort` 계약으로 통일한다.
3. web/mobile composer에 동일 privacy composite key와 server lease를 도입한다.
4. message/shared-action의 v2 reserve/commit RPC schema를 먼저 확정한다.
5. notes를 임시로 private-source 거부 상태로 만들고 canonical-source API를 구현한다.
6. pre-link shared와 private→community bridge를 server flag로 닫는다.
7. 웹 Sentry logger를 allowlist-only 중앙 scrubber로 교체한다.
8. 정확한 hosted schema와 현재 production SHA를 읽기 전용으로 대조한다.
9. 일반 사용자 응답을 만드는 service/admin read/write 경로를 inventory하고 owner-explicit
   RLS/RPC 전환 계획을 고정한다.
10. 모든 provider SDK 호출을 audited egress gateway로 모으고 token-count 선행 전송을
    P0 RED 테스트로 고정한다.
11. 새 couple invite 발급을 임시 OFF하고 HMAC-only ledger, token-only pending/양쪽 re-auth
    handshake와 기존 code revoke migration을 구현한다.
12. mobile OTA signing key/channel/runtime/EAS 권한을 inventory하고 wrong-key·wrong-channel
    실기기 RED 테스트와 release receipt schema를 고정한다.
13. 모든 콘텐츠 feature controller가 `COMMON_PRIVACY_BASELINE AND feature receipt`를 DB에서
    강제하도록 공통 predicate와 negative test를 만든다.
14. legacy plaintext의 암호화 backfill·read cutover·live 잔존 0 scanner와 backup 예외
    receipt를 구현한다.
15. private/shared/direct read·decrypt·Realtime kill switch와 active socket/capability revoke
    rehearsal을 RED부터 고정한다.

이 작업 묶음이 닫히기 전에는 새로운 추천, 재미, 자동 케어 기능을 추가하지 않는다.

---

이 문서는 코드 기반의 AI 보조 보안 설계다. 전문 보안 감사, 침투 테스트, 개인정보 영향평가 또는 법률 자문을 대체하지 않는다. 민감한 개인·커플 데이터를 실제 사용자에게 받기 전 독립 전문가의 검증이 필요하다.
