# 아모라 개인화 구현·감사 작업 기록 — 2026-08-15

> 상태: **RELEASE CANDIDATE PUBLISHED / VERCEL PREVIEW READY / LOCAL CODE GATES PASS / HOSTED·DEVICE EVIDENCE MISSING / PRODUCTION NO-GO**
>
> 작업 branch: `codex/amora-release-hardening-20260811`
>
> 릴리스 후보 HEAD: `b4d4051bd198c24fc441a9e171fed259b9b253bd`
>
> 이 문서는 릴리스 후보로 게시한 source와 로컬 검증 결과를 기록한다. 실제 사용자 만족도, 실기기 동작, hosted DB 적용 또는 Production 배포를 증명하지 않는다.

## 1. 이번 작업에서 고정한 제품 본질

아모라는 범용 챗봇보다 더 많은 말을 하는 서비스가 아니다. 사용자가 이미 확인한 결혼 준비 기록과 직접 고른 기준을 바탕으로 다음 한 가지를 정하고, 실행 결과를 다시 다음 준비에 연결하는 개인화된 웨딩 동반자다.

개인화는 성격을 추측하는 방식으로 만들지 않는다.

- 일정·예산·체크리스트·준비 상태처럼 사용자가 저장한 사실
- 말투·설명 깊이·결정 시작 방식처럼 사용자가 직접 선택한 설정
- 본인이 검토해 저장한 `내 기준`
- 두 사람이 같은 문장을 각각 확인한 `우리 기준`
- 완료·막힘·변경·불확실처럼 사용자가 직접 기록한 행동 결과

위 다섯 종류만 다음 설명, 질문 순서, 행동 순서에 반영한다. 모델이 대화만 보고 성격, 관계, 가족 의도 또는 우선순위를 임의로 진단하지 않는다.

## 2. 소비자가 경험하게 되는 기본 흐름

### 2.1 처음 들어온 사람

1. 역할과 혼자/함께 준비 여부만 먼저 정한다.
2. 날짜·예산·취향을 다 입력하지 않아도 빠른 시작을 선택할 수 있다.
3. 빈 채팅 입력창 대신 아모라가 현재 준비 상태 확인부터 시작한다.
4. 저장된 기록이 있으면 `확인된 내용`, 없으면 `아직 모르는 내용`으로 구분한다.
5. 지금 할 한 가지, 그 이유, 완료 기준을 검토 가능한 카드로 보여준다.
6. 사용자가 확인하기 전에는 공동 기록에 쓰거나 파트너에게 보내지 않는다.

주요 source:

- `apps/mobile/src/lib/onboardingFirstValue.mjs`
- `apps/mobile/app/onboarding/index.tsx`
- `packages/shared/src/contracts/amoraFirstUseGrounding.mjs`
- `apps/mobile/src/lib/amoraEntryPlan.mjs`
- `apps/mobile/src/components/chat/AmoraFirstUseActionCard.tsx`

### 2.2 이미 준비를 시작한 사람

1. 아모라는 현재 커플의 일정·예산·체크리스트·열린 행동만 읽는다.
2. 실제로 저장한 날짜와 중요도를 기반으로 홈의 `오늘 한 가지`를 고른다.
3. 왜 이 일이 먼저인지 확인된 근거만으로 설명한다.
4. 일정·예산·체크리스트·아모라 대화 중 원래 실행 화면으로 바로 이어준다.
5. 결과를 `끝냈어요`, `막혔어요`, `내용이 바뀌었어요`, `아직 모르겠어요`로 닫는다.
6. 결과 영수증을 서버에서 다시 읽어 일치할 때만 완료로 표시한다.

### 2.3 커플이 함께 준비하는 경우

- 개인 상담과 개인 기준은 owner-private로 유지한다.
- 공동 준비 기록은 현재 커플 roster와 revision에 결박한다.
- `우리 기준`은 두 사람이 같은 문장을 각각 확인해야 공유 결정이 된다.
- 개인 상담 원문이나 갈등 메모는 공동 입력창으로 자동 복사하지 않는다.
- 공유 전환은 항상 편집 가능한 초안과 명시적 확인을 거친다.

## 3. 구현된 개인화 층

### 3.1 명시적 개인화 설정 6종

현재 사용자가 직접 고를 수 있는 축은 다음과 같다.

1. 아모라 말투
2. 결정을 시작하는 방식
3. 설명 깊이
4. 막혔을 때 도움 순서
5. 둘이 준비하는 방식
6. 가족 의견을 확인하는 순서

관련 source:

- `apps/mobile/src/lib/amoraPersonalizationSettings.mjs`
- `apps/mobile/src/lib/amoraPersonalization.mjs`
- `apps/mobile/src/components/chat/AmoraPersonalizationSheet.tsx`
- `apps/mobile/app/settings/amora-style.tsx`

행동 결과 뒤에도 사용자가 명시적으로 고른 한 필드만 변경한다. `막혔어요`를 눌렀다는 이유만으로 사용자를 특정 성격이나 준비 유형으로 분류하지 않는다.

### 3.2 내 기준

- 한 사람이 직접 검토한 한 문장을 private criterion으로 저장한다.
- 저장, 변경, 삭제는 정본 receipt와 revision을 확인한다.
- 대화에서는 의사결정 렌즈로만 사용하고 커플 합의로 표현하지 않는다.

관련 source:

- `supabase/migrations/20260814130000_amora_core_criterion.sql`
- `apps/web/src/lib/ai/amoraCoreCriterion.ts`
- `apps/mobile/src/lib/amoraCoreCriterion.mjs`

### 3.3 우리 기준

- 현재 두 roster 구성원이 같은 문장을 확인해야 확정된다.
- 제안 중, 상대 확인 대기, 공동 확정 상태를 구분한다.
- 확정 시 `decision_nodes`에 공동 결정으로 남긴다.
- 커플이 바뀌거나 revision이 달라지면 기존 응답을 적용하지 않는다.

관련 source:

- `supabase/migrations/20260814140000_amora_couple_core_criterion.sql`
- `apps/mobile/src/lib/amoraCoupleCriterion.mjs`
- `apps/mobile/app/settings/amora-style.tsx`

### 3.4 실행 결과 기반 후속

- 열린 행동은 exact action ID, source revision, couple, recipient에 결박한다.
- 완료와 변경은 추가 확인을 거친다.
- 막힘 사유는 자유 원문 대신 제한된 선택지를 사용한다.
- 결과 기록 후 canonical receipt와 retired card를 다시 확인한다.
- 필요한 경우에만 owner-private 도움 초안을 연다.

관련 source:

- `supabase/migrations/20260814120000_amora_explicit_action_execution.sql`
- `apps/mobile/src/components/dashboard/AmoraActionFollowUpV2.tsx`
- `apps/mobile/src/components/dashboard/AmoraActionFollowUpCard.tsx`
- `apps/mobile/src/lib/amoraActionFollowUp.mjs`

## 4. 오늘 마감한 핵심 개선

### 4.1 불가능한 날짜 차단

`YYYY-MM-DD` 모양만 맞는 날짜를 허용하지 않는다. 윤년을 포함한 실제 달력 날짜를 검증하고 불가능한 날짜는 API 쓰기 전에 거부한다.

- `apps/web/src/lib/amora/actions.ts`
- `apps/web/src/app/api/amora/actions/route.ts`
- `apps/web/src/app/api/amora/actions/[id]/route.ts`

### 4.2 가장 최근 항목이 아니라 가장 필요한 행동 선택

홈은 최대 80개의 현재 커플 열린 행동을 bounded query로 읽고 다음 순서로 비교한다.

1. 저장한 마감일이 지났거나 오늘인 행동
2. 오늘 저장된 일정
3. 결과 기록이 필요한 방문·문의
4. 7일 안에 마감이 있거나 `높음`으로 저장한 행동
5. 기본 준비 시점으로 계산한 체크리스트 경고
6. 그 밖의 열린 행동
7. 일반 다음 단계 또는 차분한 상태 확인

실제 저장한 날짜와 사용자가 정한 중요도는 아모라의 휴리스틱보다 우선한다. 반대로 마감 없는 낮은 중요도 행동은 임박한 체크리스트를 가리지 않는다.

- `apps/mobile/src/lib/dashboardExperience.mjs`
- `apps/mobile/app/(tabs)/dashboard.tsx`

### 4.3 `왜 지금인지`를 카드까지 유지

이전에는 홈에서 구체적인 이유를 계산해도 실제 행동 후속 카드가 일반 문구로 바뀌었다. 현재는 다음 네 값이 모두 일치할 때만 홈의 구체적인 이유를 카드 표시층에 사용한다.

- 요청한 action ID
- 현재 action 제목
- current `follow_up_revision`
- 홈이 계산한 제한된 selection reason

하나라도 다르면 서버 카드의 일반 문구를 유지한다. canonical 서버 응답 자체는 변조하지 않는다.

### 4.4 claim 부작용을 고려한 홈 순서

TodayOne, action follow-up, mediation follow-up GET은 모두 카드 claim 또는 일일 한도에 영향을 줄 수 있다. 따라서 `Promise.all`로 동시에 호출하지 않는다.

- 확정 마감이 7일 이내인 행동: `exact action → mediation follow-up → TodayOne → deterministic home`
- 일반 행동: `mediation follow-up → TodayOne → exact action → deterministic home`
- 홈 focus가 행동이 아니면 action follow-up을 마운트하지 않는다.

이 순서는 사용자가 직접 저장한 임박한 마감은 지키면서, 평범한 열린 행동이 상견례 D-1 같은 정확한 일정 케어를 가리는 문제를 막는다.

### 4.5 상견례 완료 뒤 D+1 회수 복구

이전에는 상견례 일정을 정상적으로 `완료` 처리하면 다음 날 D+1 질문이 사라졌다. 현재 정책은 다음과 같다.

- `cancelled`: 모든 전후 케어에서 제외
- `planned`: D-3, D-1, D+1 포함
- `completed`: 사전 알림에서는 제외하고 D+1 결과 회수에는 한 번 포함

모멘트 생성기와 TodayOne compiler의 이중 필터를 모두 수정했다.

- `apps/web/src/lib/amora/momentLoop.ts`
- `apps/web/src/lib/care/todayOne.ts`
- `apps/web/src/lib/amora/__tests__/momentLoop.test.ts`
- `apps/web/src/lib/care/__tests__/todayOne.test.ts`

### 4.6 결과 영수증을 사용자가 읽을 때까지 유지

이전에는 행동 결과의 canonical 영수증을 표시한 직후 홈 데이터를 다시 읽어, 완료된 행동이 query에서 빠지거나 revision이 바뀌면 영수증과 후속 CTA가 곧바로 사라질 수 있었다.

현재는 결과 전송 전에 같은 owner·couple·부모 세션에 묶인 단조 증가 lease token을 발급하고, 확인된 영수증을 로컬 화면과 홈 coordinator에 함께 고정한다. lease는 `provisional`과 `confirmed`를 구분한다. 결과 POST와 canonical receipt 재조회가 끝나지 않은 `provisional` 상태에서는 당겨 새로고침도 결과 검증을 취소하지 않고 최신 홈 재조회를 보류한다. `confirmed` 영수증만 사용자가 `확인했어요 · 다음 준비 보기`를 누르거나 명시적으로 새로고침할 때 같은 token으로 해제한다. 화면 재포커스, 같은 커플의 일정·예약 Realtime 변경, 영수증 확정 전에 시작된 늦은 홈 조회는 결과 카드를 덮지 않고 최신 재조회를 한 번만 보류한다. 첫 홈 로드의 개인화 보강 요청이 아직 끝나지 않아 Realtime 구독 identity가 준비되지 않은 순간에도, 활성 lease의 owner·couple를 canonical profile과 다시 대조한 뒤 같은 identity일 때만 영수증을 유지한다. 계정·커플·세션이 바뀌면 고정과 보류된 재조회를 모두 폐기하며, 이전 세션의 늦은 confirm·abort·ack 콜백은 새 lease를 확인하거나 해제할 수 없다.

- `apps/mobile/app/(tabs)/dashboard.tsx`
- `apps/mobile/src/components/dashboard/AmoraActionFollowUpV2.tsx`
- `apps/mobile/src/components/dashboard/AmoraActionFollowUpCard.tsx`
- `apps/mobile/src/__tests__/dashboardExperience.test.mjs`
- `apps/mobile/src/__tests__/amoraActionFollowUp.test.mjs`

### 4.7 행동 결과를 다음 추천에 연결

이전에는 `완료`만 공동 행동을 닫았고, `막힘·변경·아직 모름`은 24시간 뒤 같은 행동과 같은 도움 문구로 다시 나타날 수 있었다. 현재는 수신자 본인의 최신 결과를 24시간 동안만 읽는 service-only feedback 수직을 추가했다.

- 현재 owner·couple·roster·privacy epoch와 action revision/status가 모두 일치할 때만 결과를 반환한다.
- `완료`는 끝난 행동을 되살리지 않고 다음 정본 focus에 완료 continuity만 붙인다.
- `막힘`은 선택한 막힘 사유에 맞는 가장 작은 회복 단계, `변경`은 바뀐 사실 하나, `아직 모름`은 확인할 사실 하나로 도움 방식을 바꾼다.
- 결과는 기존 우선순위를 임의로 재정렬하거나 장기 성격·취향으로 저장하지 않는다.
- 다른 action/revision, 만료, 계정·커플 불일치, malformed 응답은 모두 무시한다.

주요 source:

- `supabase/migrations/20260815120000_amora_action_outcome_feedback.sql`
- `packages/shared/src/contracts/amoraActionOutcomeFeedback.mjs`
- `apps/web/src/app/api/amora/action-feedback/route.ts`
- `apps/mobile/src/lib/amoraActionFeedback.mjs`
- `apps/mobile/src/lib/dashboardExperience.mjs`
- `apps/mobile/app/(tabs)/dashboard.tsx`

### 4.8 추천 이유와 개인정보 범위를 직접 확인

홈의 `왜 이 제안인가요?` 화면은 우선순위 근거와 개인화 문맥을 분리해 보여준다.

- 우선순위: 저장한 일정·마감·체크리스트·공동 행동 중 실제 선택 근거
- `내 답변 방식`, `내 기준`: `나만 보기`
- 두 사람이 같은 문장을 확인한 `우리 기준`: `커플 공유`
- `막힘·변경·아직 모름` 결과: 도움 방식에만 반영하며 `나만 보기`
- `완료`: 상세 결과 영수증은 `나만 보기`, 공동 행동의 완료 상태는 `커플 공유`

설정에서는 `저장한 답변 방식만 기본값으로 초기화`할 수 있다. exact revision과 현재 auth session을 다시 확인하고 성공 receipt가 일치할 때만 화면을 바꾼다. 이 동작은 `내 기준`, `우리 기준`, 아모라 대화 기억을 삭제하지 않으며 전체 개인화 초기화라고 부르지 않는다.

- `apps/mobile/src/components/dashboard/AmoraRecommendationWhySheet.tsx`
- `apps/mobile/src/components/dashboard/WeddingHomeExperience.tsx`
- `apps/mobile/app/settings/amora-style.tsx`
- `apps/mobile/src/lib/amoraPersonalization.mjs`

### 4.9 드레스 피팅 수직 확장과 만료 경계

`momentType: dress_fitting`은 현재 D-3와 D-1 안내, `dress` 체크리스트 진입까지 연결된다. 상견례와 달리 D+1 질문과 `meeting` 예산 CTA는 붙이지 않는다. shared contract도 dress care에서 `relatedBudget`과 family evidence가 들어오면 거부한다.

모바일은 TodayOne 응답의 `expiresAt`을 렌더 직전에 실제 시각과 비교하고, 만료된 카드는 deterministic fallback으로 되돌린다. 같은 owner·couple로 앱이 다시 활성화되면 TodayOne만 새 generation으로 다시 읽고, 진행 중인 action receipt lease는 건드리지 않는다.

- `packages/shared/src/contracts/todayOneCare.ts`
- `apps/web/src/constants/moments.ts`
- `apps/web/src/lib/amora/momentLoop.ts`
- `apps/web/src/lib/care/todayOne.ts`
- `apps/mobile/src/components/dashboard/TodayOneCareCard.tsx`
- `apps/mobile/src/lib/todayOneCare.mjs`

### 4.10 첫 행동 저장 뒤 개인화 홈으로 이어가기

첫 이용자는 비공개 상태 검토, 검토 가능한 행동 카드, 공유 초안, 명시적 저장까지 마쳐도 성공 영수증에서 흐름이 끝나 홈의 개인화된 다음 행동을 스스로 찾아야 했다.

현재는 성공했고 정본 응답에 유효한 열린 행동 ID가 있는 `add_amora_action` 영수증에만 `홈에서 다음 한 가지 보기`를 노출한다. 버튼을 누르면 행동 ID를 owner+couple에 묶은 10분짜리 one-shot handoff로 넘기고, 홈은 현재 커플의 현재 열린 행동 목록에서 같은 ID를 다시 검증한 뒤 그 행동을 한 번 보여준다. 잘못된 계정·커플, 만료, 이미 소비된 handoff, 닫혔거나 사라진 행동은 모두 실패 닫힘으로 일반 홈 우선순위에 돌아간다.

이 명시적 이동에서만 방금 저장한 행동이 홈 care 카드보다 먼저 보이고, 이후 새로고침부터는 오늘 일정·확정 마감·긴급 항목 등 기존 정본 우선순위를 그대로 따른다. 실패 영수증, 예산 변경, 예약 요청 기록에는 CTA를 붙이지 않는다. 자동 이동·자동 저장·자동 공유는 없으며 사용자가 버튼을 누를 때만 홈으로 이동한다. 영수증 요약과 버튼을 각각 접근 가능한 요소로 분리하고 터치 영역은 48px로 유지한다.

- `apps/mobile/app/(tabs)/chat.tsx`
- `apps/mobile/app/(tabs)/dashboard.tsx`
- `apps/mobile/src/components/dashboard/WeddingHomeExperience.tsx`
- `apps/mobile/src/lib/actionReceiptHomeHandoff.mjs`
- `apps/mobile/src/lib/actionReceiptHomeHandoff.d.mts`
- `apps/mobile/src/lib/dashboardExperience.mjs`
- `apps/mobile/src/lib/dashboardExperience.d.mts`
- `apps/mobile/src/__tests__/actionReceiptHomeHandoff.test.mjs`
- `apps/mobile/src/__tests__/amoraChatReceipts.test.mjs`
- `apps/mobile/src/__tests__/dashboardExperience.test.mjs`

### 4.11 상견례 다음 날 답변을 검증된 다음 행동으로 연결

이번 단계는 범위를 넓히지 않고 정확한 `momentType: sanggyeonrye` D+1 카드만 끝까지 연결했다. 사용자가 TodayOne의 다음 날 질문을 누르면 앱은 owner, couple, 현재 roster와 privacy epoch, journey revision, card revision, source revision, 일정·signal 상태와 만료 시각을 서버에서 8초 안에 다시 확인한다. 통과한 경우에만 짧은 비공개 질문을 채팅 입력창에 놓으며 자동 전송·저장·공유하지 않는다.

사용자가 직접 답을 보내면 서버는 정본 질문 뒤의 답변 부분만 AI에 전달한다. 이 경로에서는 memory와 tool을 사용하지 않고, 답변과 다음 행동 초안은 owner-private로 남는다. AI가 행동 marker를 빼먹거나 손상·중복시키거나 근거 없는 금액·계약·합의 완료를 주장해도 그대로 표시하지 않고, 실제 상태를 확인하는 안전한 행동 문구로 바꾼다.

`둘이 볼 초안 만들기`를 누르는 순간에도 같은 source를 다시 검증한다. 응답 뒤에는 현재 owner, couple, auth session, 최신 비공개 AI 메시지, opaque binding과 action draft가 모두 같은지 한 번 더 확인한다. 그 뒤에만 일반 shared composer에 편집 가능한 초안을 놓는다. 초안에는 비공개 답변 원문, private message ID, card/source ID가 들어가지 않으며 자동 전송되지 않는다. 사용자가 shared 초안을 직접 전송하고 기존 `add_amora_action` 확인 카드에서 다시 승인해야만 공동 행동으로 저장된다.

비공개 AI 답변은 사용자가 답을 보낸 시점의 검증된 snapshot/history로 보존한다. 그 뒤 source가 바뀌어도 과거 비공개 대화를 지우거나 재작성하지 않는다. 대신 shared 경계를 넘는 명시적 탭에서 최신 source를 다시 확인해 오래된 제안이 평범하게 공동 초안으로 넘어가는 일을 막는다. timeout, stale, identity 변경, composer 점유는 모두 보이는 복구 상태를 제공하며 늦은 응답은 무시한다.

주요 source:

- `packages/shared/src/contracts/amoraScheduleCareFollowUp.mjs`
- `apps/web/src/lib/care/scheduleCareFollowUp.ts`
- `apps/web/src/app/api/amora/schedule-care-follow-up/route.ts`
- `apps/web/src/app/api/chat/messages/route.ts`
- `apps/web/src/lib/ai/amoraScheduleCareFollowUp.ts`
- `apps/web/src/app/api/chat/route.ts`
- `apps/mobile/src/lib/scheduleCarePrivateFollowUp.mjs`
- `apps/mobile/src/components/dashboard/TodayOneCareCard.tsx`
- `apps/mobile/app/(tabs)/chat.tsx`

## 5. 상견례·드레스 피팅 수직의 현재 실제 범위

현재 source에서 연결된 범위:

1. `momentType: sanggyeonrye` 일정 저장
2. D-3 안내
3. D-1 준비 목록과 대화 문안
4. `meeting` 체크리스트 진입
5. 모바일 `meeting` 예산 편집기 진입
6. D+1 현재 상태를 서버에서 다시 확인한 owner-private 질문
7. 비공개 답변과 검증된 다음 행동 초안
8. 명시적 source 재확인 뒤 편집 가능한 shared 초안, 기존 행동 확인·저장·홈 루프

드레스 피팅에서 연결된 범위:

1. `momentType: dress_fitting` 일정
2. D-3 준비 확인
3. D-1 준비 목록과 안내
4. `dress` 체크리스트 진입
5. 만료 시 카드 제거와 앱 복귀 시 재조회

아직 구현됐다고 말하면 안 되는 범위:

- D-1 카드의 문자열 항목을 개별 완료 상태로 저장하는 기능
- 상견례 일정 한 건과 예산 항목을 직접 연결하는 기능
- D+1에서 합의된 내용을 별도 owner-private 결과·decision receipt로 저장하는 기능
- `추가 기록 만들지 않기` 선택의 canonical receipt 또는 dismissal
- 웹의 D+1 대화 진입
- 검수된 상견례 전용 `/manners` 콘텐츠
- 실제 푸시·이메일 전달과 놓친 날 catch-up
- `familyOrder` 설정에 따라 현재 정적 카드의 첫 질문 순서를 즉시 바꾸는 기능
- 드레스 피팅 결과를 D+1 구조화 결과·다음 행동으로 저장하는 기능
- 드레스 일정과 예산 항목을 자동 연결하는 기능

## 6. 안전·프라이버시 불변식

- AI는 준비 상태를 추정해 저장하지 않는다.
- 개인 상담 원문은 자동 공유하지 않는다.
- 파트너·가족·업체에게 자동 발송, 예약, 취소, 결제를 하지 않는다.
- shared mutation은 현재 owner, couple, roster, revision을 다시 확인한다.
- 개인 기준과 공동 기준을 같은 것으로 표현하지 않는다.
- 중재는 동의 없는 판정이 아니라 선택 가능한 조율 제안이다.
- 안전 hold가 있으면 중재 후속은 fail-closed한다.
- 계약·추가금·해지·법률 판단은 이번 개인화 범위에 포함하지 않는다.
- 상견례 D+1 AI 응답은 검증된 입력 시점의 owner-private snapshot/history이며 memory·tool·자동 mutation을 만들지 않는다.
- D+1 결과가 shared 경계를 넘을 때는 명시적 탭에서 source와 owner·couple·session·최신 private AI 메시지를 다시 확인하고, 이후에도 직접 전송과 행동 확인을 각각 요구한다.

## 7. 로컬 검증 영수증

아래 결과는 이 문서 작성 직전 현재 dirty source에서 직접 실행했다.

| 검증 | 결과 |
|---|---|
| 상견례 D+1 모바일 focused | 122/122 PASS |
| 상견례 D+1 contract·preview·ingest·AI 웹 focused | 385/385 PASS |
| Mobile 전체 | 811/811 PASS |
| Mobile typecheck | PASS |
| Mobile lint | PASS |
| Web Vitest 4 shards | 7,236/7,236 PASS |
| Shared/Web/Mobile typecheck | PASS / PASS / PASS |
| Repository `test:repo` | PASS |
| Supabase release tests | 198/198 PASS |
| Supabase release fence | PASS · `deployment_blocked` · 95 migrations |
| `git diff --check` | PASS · 기존 LF→CRLF warning 6개만 관측 |

이 영수증은 단위·계약·정적 source 검증이다. 실기기, 두 계정·두 기기, 네트워크 장애, 실제 알림, hosted migration, Production traffic의 통과를 뜻하지 않는다.

## 8. 적대적 재검수에서 고친 것

- 가장 최근 행동만 뽑아 실제 마감을 놓치던 문제
- 휴리스틱 체크리스트가 저장한 오늘 일정이나 확정 마감을 가리던 문제
- 홈의 구체적 추천 이유가 일반 후속 카드에서 사라지던 문제
- action follow-up이 focus와 무관한 행동을 claim하던 문제
- 일반 행동이 정확한 D-1 TodayOne 카드를 가리던 문제
- completed 상견례가 D+1 회수에서 빠지던 이중 필터 문제
- canonical 결과 영수증과 개인화 후속 CTA가 즉시 조회, Realtime 갱신, 늦은 응답 때문에 사라지던 문제
- action response 도착 중 action ID가 바뀌어도 이전 요청을 계속 표시할 수 있던 dependency 문제
- 불가능한 날짜 문자열을 실제 마감처럼 취급하던 문제
- `막힘·변경·아직 모름` 결과가 다음 홈 도움 방식에 반영되지 않던 문제
- 비공개 행동 결과를 공동 기록처럼 오해할 수 있던 추천 이유 설명
- 완료 상세 영수증과 커플 공유 완료 상태를 같은 공개 범위로 말하던 문제
- 당겨 새로고침이 진행 중인 outcome 검증을 끊어 저장만 되고 영수증은 사라질 수 있던 경합
- 만료된 전날 TodayOne 카드가 앱 복귀 뒤에도 남을 수 있던 문제
- 답변 방식 초기화가 다른 개인 기준·공동 기준·기억까지 지우는 것처럼 보일 수 있던 문제
- 첫 행동을 저장한 성공 영수증에서 개인화 홈의 다음 한 가지로 이어지는 길이 없던 문제
- 첫 행동 확인 중 `지금은 아니에요`·`조금 바꿀래요`를 눌러도 늦은 preview가 공동 초안을 만들던 경합
- 공동 초안을 수정한 뒤 provenance가 끊겼을 때 일반 409 문구만 보여 복구할 수 없던 문제
- 홈 이동 직후 행동 조회가 일시 실패하면 one-shot handoff가 먼저 소진되던 문제
- preview route의 PostgREST named argument와 실제 SQL 함수 인자명이 달라 hosted 호출이 503이 되던 문제
- AI terminal 저장의 `privacy epoch → couple` 역순 잠금 때문에 roster·pending action과 교착할 수 있던 문제
- D+1 카드가 긴 내부 지시문을 그대로 입력창에 보여주고 실제 답변을 정본 content로 인정하지 못하던 문제
- 이미 저장된 D+1 답변의 exact retry도 바뀐 source를 다시 검사해 복구를 막던 문제
- 비공개 composer가 차 있으면 D+1 진입이 아무 설명 없이 끝나던 문제
- D+1 AI action marker가 없거나 손상·중복되면 근거 없는 금액·계약·합의 완료 문장이 그대로 남던 문제
- 오래된 비공개 D+1 결과가 shared 초안으로 넘어가는 순간 최신 source를 다시 확인하지 않던 문제
- source·identity가 바뀐 뒤 늦게 도착한 preview가 이전 초안을 열 수 있던 경합

## 9. 아직 남은 일과 우선순위

### 완료 — 첫 이용 행동의 근거·최신성·중복 방지

첫 이용 행동의 신뢰 수직은 로컬 source 기준으로 닫았다.

1. private AI 응답에 서버가 owner, couple, source message digest, journey revision, privacy epoch, roster, 현재 공동 기준 decision을 봉인한다.
2. 근거 없는 계약·결제·금액·마감·두 사람 동의 주장은 그대로 행동이 되지 않고, 실제 상태를 확인하는 작은 행동으로 결정론적으로 바뀐다.
3. 공동 초안은 `/api/amora/first-use-action-promotions/{sourceMessageId}`의 현재 정본 검증을 통과한 경우에만 만들어지며 자동 전송·저장·공유하지 않는다.
4. `amora_first_use_action_promotions`와 proposal binding은 FORCE RLS/service-only이고, shared row에는 private source ID나 원문 대신 opaque promotion ID만 남긴다.
5. 같은 source의 재시작·다른 기기 재시도는 동일 shared row를 재사용하며, proposal·accept·claim·apply 직전에도 revision, criterion, roster, privacy epoch를 다시 검증한다.
6. 사용자가 초안을 고치면 binding은 즉시 폐기된다. server stale·criterion 변경·identity 변경·timeout은 각각 보이는 복구 상태와 `나만 상담에서 다시 만들기`를 제공한다.
7. 확인 중 건너뛰기·수정·세션 변경은 진행 중 preview를 취소하고 늦은 응답을 무시한다.
8. 저장 영수증의 홈 handoff는 exact current-couple open action 조회가 성공한 뒤에만 소진한다. 일시 장애는 토큰을 보존하고 재시도한다.
9. terminal DB 잠금은 기존 RPC 이름에서 `receipt → claim → couple → privacy epoch`로 통일해 구·신 웹 인스턴스가 같은 순서를 사용한다.

관련 migration은 `20260815130000_amora_first_use_action_promotions.sql`이고 canonical LF SHA-256은 `c4808671308c2ed0bb2be0a7c82b894b69c3d20c63f4547abb3bd61d64511090`이다.

### P1 — 출시 전에 반드시 필요한 운영 증거

1. hosted staging migration apply
2. production backup과 별도 restore 영수증
3. Storage contract 검증
4. successor finalizer 영수증
5. minimum supported mobile version 또는 legacy traffic 0건 증거
6. 두 계정·두 기기에서 unlink, account switch, privacy epoch, 503, 재시작 시나리오
7. 실제 VoiceOver/TalkBack와 작은 화면 검증

위 증거가 없으므로 Production 배포는 계속 NO-GO다.

### P2 — 다음 제품 수직은 사용자 합의 전 보류

이번 작업에서 별도의 합의 요약, 파트너 공유, 결과 원장, 추가 memory 기능을 다음 개발 범위로 확정하지 않는다. 다음 제품 수직은 사용자와 목적·화면·저장 범위를 먼저 합의한 뒤 진행한다. 현재 확정된 핵심은 `현재 상태 파악 → 지금 할 한 가지 → 실행 → 결과에 맞춘 다음 도움`뿐이다.

### P2 — 사용자 우선순위 조절의 의미 결정

현재 `amora_actions.priority`는 개인 홈 정렬이 아니라 커플 공동 기록이다. 따라서 지금 `내 우선순위` UI를 붙이면 파트너 기록을 조용히 바꿀 수 있다. 다음 중 하나를 제품 의미로 먼저 선택해야 한다.

- 공동 중요도: 파트너 영향 고지 + revision CAS + 충돌 409
- 내 홈에서만 먼저 보기: owner-private pin 저장소
- 이 기기에서만 먼저 보기: 로컬 제한을 명확히 고지

이번 작업에서는 안전하지 않은 임시 UI를 만들지 않았다.

### P3 — 성능·콘텐츠 후속

- 세 care endpoint의 직렬 waterfall을 단일 서버 coordinator로 통합
- TodayOne 후보별 직렬 privacy/compile RPC를 원자 coordinator RPC로 축소
- mediation 후보별 claim RPC를 단일 claim으로 축소
- 가족·지역 편차와 근거를 표시한 검수된 상견례 `/manners` 콘텐츠 작성

## 10. 다음 작업자가 지킬 순서

1. 이 문서와 `AMORA_RELEASE_HARDENING_HANDOFF_2026-08-12.md`를 먼저 읽는다.
2. 현재 branch, HEAD, dirty count, staged 0을 다시 확인한다.
3. 기존 미커밋 파일을 reset, checkout, clean하지 않는다.
4. first-use provenance 수직을 다시 만들지 말고 현재 contract/RPC/receipt/opaque ID 경계를 보존한다.
5. sanggyeonrye D+1의 private snapshot, tap-time source 재검증, ordinary shared composer, 별도 행동 확인 경계를 하나로 합치거나 제거하지 않는다.
6. hosted staging에서 PostgREST schema cache와 실제 PostgreSQL 두 세션 잠금 순서를 검증한다.
7. current 모바일/OTA 최소 버전과 legacy first-use traffic 0건을 확인한 뒤 strict 서버 경로를 활성화한다.
8. 두 계정·두 기기에서 restart, source reuse, stale criterion, identity switch, 503, 행동 저장 후 홈 재시도와 D+1 stale·composer 점유·shared 전환을 검증한다.
9. hosted 증거 없이 배포 완료를 주장하지 않는다.

## 11. 제품 디자인 판단

홈은 한 화면에서 여러 추천을 경쟁시키지 않고, 한 가지 행동과 정확한 이유를 먼저 보여주는 방향으로 유지한다.

이번 first-use 수직은 외부 디자인 도구를 사용하지 않았다. 사용자와 합의한 제품 본질, `PRINCIPLES.md`, `DESIGN.md`, 모바일 마스터플랜, 실행 가능한 사용자 흐름 테스트를 기준으로 판단했다.

- 한 번에 한 가지 행동과 그 이유를 보여준다.
- 개인 상담은 private로 남고 사용자가 명시적으로 검토한 초안만 shared로 이동한다.
- AI의 문장보다 현재 저장 기록과 사용자의 직접 확인을 우선한다.
- 오류를 숨기거나 자동으로 다시 보내지 않고, 무엇이 저장·공유되지 않았는지와 다음 복구 행동을 같이 보여준다.
- 실제 사용자 만족도, VoiceOver/TalkBack, 작은 화면, 두 기기 동작은 hosted/device 증거가 생기기 전까지 완료로 간주하지 않는다.

## 12. 배포 상태

- 릴리스 후보 commit: `b4d4051bd198c24fc441a9e171fed259b9b253bd`
- Draft PR: `https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/pull/105`
- Vercel Preview: `4Pvi7gL4q1h8sp9rPjdsLkP17sZv` · READY · SSO 보호
- source 구현: 있음
- 로컬 code gate: 위 표와 게시 전 최종 재검증 기준 PASS
- GitHub Actions run `31886730103`: 코드 실행 전 Billing/Actions 지출 한도에서 차단됨
- hosted migration: 하지 않음
- Vercel Production alias / EAS Production 배포: 하지 않음
- successor manifest: `deployment_blocked` · migration 95개
- hosted evidence 5종: 모두 `missing`
- 결론: **PREVIEW 배포 완료 / Production NO-GO**

## 13. 결혼 질문의 깊이 조절과 저작권 안전 경계

외부 결혼 준비 가이드북은 제품 문구·목차·표·체크리스트를 옮기는 자료로 사용하지 않았다. 자료에서 확인한 일반적인 정보 설계의 장점인 `작은 질문으로 분해`, `실행 조건`, `예외 상황`, `결정 뒤 후속 행동`만 독립적인 제품 원칙으로 추상화했다. 원문·표·고유한 배열·가격 예시는 저장소에 포함하지 않았다.

아모라의 답변 엔진에는 다음의 얇은 서버 결정층을 추가했다.

1. 사용자가 전체 준비를 물으면 일정·비용·계약·사람·실행·예외를 내부적으로 검토하되, 현재 상황에 관련 있는 항목만 우선순위대로 보여준다.
2. 한 가지만 물으면 먼저 직접 답하고, 결과를 실제로 바꿀 사각지대만 1~2개 덧붙인다. 전체 체크리스트를 쏟지 않는다.
3. 이미 끝냈거나 확인된 기록은 반복하지 않고, 현재 발화가 저장 기록과 다르면 현재 발화를 우선하되 충돌을 숨기지 않는다.
4. 개인 기준과 두 사람의 기준은 이번 선택을 실제로 가를 때만 사용한다. 저장된 개인화가 없으면 아는 척하지 않는다.
5. 가족 형태·성별 역할·지역 관습은 정답으로 전제하지 않고, 확인되지 않은 가격·시기·비율·관행을 만들지 않는다.
6. 감정 표현, 듣기 요청, 직접 저장·수정 명령, 고위험 질문에는 이 결정층을 적용하지 않는다.

상견례는 첫 검증 주제로 삼아 참석자·이동·식사 제약, 가족별 기대와 민감한 대화, 비용·선물·결제, 변경·불참·취소, 만남 뒤 결정과 다음 행동을 점검한다. 이 목록을 항상 출력하는 것이 아니라 질문의 폭과 현재 기록에 맞춰 선택한다. 같은 원칙은 웨딩홀, 스드메, 예물, 청첩장, 신혼집 등 다른 결혼 결정에도 적용된다.

검증 영수증:

| 게이트 | 결과 |
|---|---|
| 결정 깊이 + prompt + 실제 chat route focused Vitest | 333/333 PASS |
| conversation evaluation contract | 34/34 PASS |
| web typecheck | PASS |
| 변경 web 파일 ESLint | PASS |
| 변경 파일 `git diff --check` | PASS |

새 production conversation scenario는 넓은 상견례 질문에서 실무 제약·가족 기대·비용 조율·예외 또는 후속 행동을 빠뜨리거나, 성별에 따른 가족 관습을 정답처럼 말하는 답변을 실패 처리한다. 이 시나리오는 배포 뒤 실제 모델 품질을 재검증하기 위한 계약이며, 이번 로컬 작업에서 live model 만족도나 Production 동작을 확인했다는 뜻은 아니다.

## 14. 홈의 `내 결혼 준비` 읽기 전용 지도 — 2026-08-15

기존 홈의 별도 `다가오는 준비` 목록을 두 번째 준비 시스템으로 키우지 않고, 현재 저장 기록을 한눈에 보는 `내 결혼 준비` 섹션으로 통합했다.

### 구현 범위

1. 공통 런타임 계약 `@hanbang/shared/amora-preparation-map`을 추가했다.
2. 현재 canonical 체크리스트 19개 카테고리·132개 항목을 입력으로 받아, 새 테이블이나 별도 쓰기 없이 `wedding_journeys.progress`를 읽기 전용으로 투영한다.
3. 주제별 상태를 `아직 확인 전`, `시작 전`, `진행 중`, `완료`, `하지 않기로 함`, `기록 확인 필요`로 구분한다.
4. 저장 기록이 없으면 완료나 적용 여부를 추정하지 않는다. 잘못된 형식이나 저장 status와 실제 항목 완료가 충돌하면 `기록 확인 필요`로 올린다.
5. canonical checklist 배열, 이전 버전 boolean 기록, 사용자가 추가해 저장한 항목을 잃지 않는다. `not_applicable`은 기존 진행률 계약과 동일하게 분모에서 제외한다.
6. 홈은 `진행 중 → 확인 필요 → 결혼식 날짜 기준 기본 확인 시점 → 시작 전 → 확인 전`의 근거를 구분해 최대 세 항목만 보여 준다. 기본 확인 시점을 실제 계약 마감으로 말하지 않는다.
7. 각 행은 기존 `/checklist?category=<topicKey>`로 이동하고, 전체 보기는 기존 `/checklist`를 연다. 새 탭, 새 체크리스트, 자동 저장, 자동 공유, 파트너 초안은 추가하지 않았다.
8. 모든 현재 항목이 완료 또는 `하지 않기로 함`이면 빈 목록을 그리지 않고 정리된 상태와 전체 보기만 표시한다.

### 개인화 의미

이 섹션의 개인화는 AI가 성격이나 상황을 추정하는 방식이 아니다. 현재 인증 사용자와 커플을 재검증한 뒤 불러온 실제 체크리스트 상태와 결혼식 날짜의 기본 확인 시점만 반영한다. 불러오기 실패는 기존 홈 오류 화면으로 남고, 다른 계정·커플의 늦은 응답은 기존 dashboard generation fence가 폐기한다.

### 검증 영수증

| 게이트 | 결과 |
|---|---|
| 준비 지도·홈 표시 모델 공개행동 테스트 | 9/9 PASS |
| dashboard 인접 집중 테스트 포함 | PASS |
| 모바일 전체 테스트 | 823/823 PASS |
| mobile/shared/web typecheck | PASS |
| 모바일 전체 ESLint | PASS |
| 변경 범위 `git diff --check` | PASS |

### 아직 완료라고 말할 수 없는 범위

현재 지도 표면에 실제 연결된 것은 기존 19개 체크리스트 범위다. 하객 명단·참석 확인·좌석·교통·숙박·접근성, 업체 계약·변경·취소·지급·환불, 예식 당일 연락망·시간표·물품·돌발 상황, 예식 뒤 결과물·정산·반납·감사 연락·행정 정리는 전체 여정 감사 대상이지만 아직 독립 주제와 정본 adapter가 확정되지 않았다.

따라서 이번 단계는 `결혼 준비 전체가 완성됐다`는 뜻이 아니다. 다음 제품 단계는 위 공백을 기존 카테고리에 억지로 넣거나 가이드 문장으로 덮지 않고, 독립 상태·결정·완료 증거가 필요한 주제만 확정한 뒤 같은 공통 계약에 read-only adapter로 연결하는 것이다. 실기기 작은 화면·글자 확대·VoiceOver/TalkBack 검증도 아직 남아 있다.

## 15. 결혼 준비 전체 커버리지 감사 계약 — 2026-08-15

현재 체크리스트 수를 늘려 완성된 것처럼 보이게 하지 않고, 실제 연결 범위와 제품 공백을 같은 런타임 감사 결과로 고정했다.

### 구현 범위

1. 공통 런타임 계약 `@hanbang/shared/amora-preparation-coverage`를 추가했다.
2. 실제 `CATEGORY_CHECKLISTS` 19개를 전체 10개 여정 축과 대조한다.
3. 현재 카테고리는 입력 순서대로 정확히 한 번만 연결하며, 예산 보조 분류 `reserve`는 체크리스트 주제로 연결하지 않는다.
4. 중복 키, 기존 19개 중 누락, 새로 추가됐지만 여정 축에 매핑되지 않은 키, 잘못된 adapter는 조용히 버리지 않고 각각 감사 issue로 반환한다.
5. 연결 adapter가 하나도 없는 여정 축은 명시적으로 `gap`이다. 연결 주제와 독립 공백이 함께 있으면 `partial`, 연결만 있으면 `connected`다.
6. 기존 `AmoraPreparationOverview`에는 고객 표시용 주제가 아니라 내부 coverage 요약만 결합했다. 따라서 홈은 여전히 실제 저장 가능한 19개 주제만 보여 주며, 아래 공백을 `확인 전` 할 일이나 AI 추정 항목으로 만들지 않는다.

### 현재 10개 여정 축 판정

| 여정 축 | 현재 판정 | 이유 |
|---|---|---|
| 시작 설계 | gap | 예식일·전체 예산·예식 방식·우선순위·역할·완료 상태를 하나의 정본 주제로 연결하지 않음 |
| 두 사람과 가족 | connected | 부모님 첫 만남·한복·가족 선물·전통 항목이 연결됨 |
| 장소와 하객 | partial | 예식장·초대장·답례는 연결됐지만 하객 운영 정본은 없음 |
| 촬영과 스타일 | connected | 스튜디오·드레스·메이크업·반지·한복·신발·사진·영상이 연결됨 |
| 본식 구성 | partial | 초대장·진행·꽃·답례 등은 연결됐지만 당일 운영 정본은 없음 |
| 업체와 돈 | partial | 업체 관련 주제는 연결됐지만 계약·지급 생애주기 정본은 없음 |
| 생활 준비 | connected | 신혼집과 가전·가구·생활용품이 연결됨 |
| 여행과 행정 | partial | 신혼여행은 연결됐지만 결혼 관련 행정 확인 정본은 없음 |
| 직전 운영 | partial | 여러 기존 준비가 연결됐지만 연락망·시간표·돌발 상황 정본은 없음 |
| 결혼 뒤 정리 | partial | 신혼여행은 연결됐지만 결과물·정산·반납·감사·남은 행정 마감 정본은 없음 |

### 독립 제품 공백 6개

1. `planning_foundation`: 시작 설계 정본
2. `guest_operations`: 하객 명단·참석·좌석·식사·교통·숙박·접근성
3. `contract_payment_lifecycle`: 포함·불포함·변경·취소·지급·환불 근거
4. `marriage_admin`: 현재 커플에게 필요한 행정 항목과 공식 근거
5. `wedding_day_operations`: 연락망·시간표·물품·이동·돌발 상황·미지급·미수령
6. `post_wedding_closeout`: 결과물·정산·대여품 반납·감사 연락·남은 행정과 기록 보관

### 고객 신뢰 경계

- 이 여섯 공백은 현재 고객 체크리스트에 표시하지 않는다.
- 새 탭, 새 쓰기 저장소, 자동 저장, 자동 공유, 파트너 초안을 추가하지 않았다.
- 외부 가이드북의 문구·표·체크리스트를 복제하지 않았다.
- `결혼 준비 전체가 완성됐다`고 주장하지 않는다.
- 다음 수직은 첫 고객 경험과 개인화에 가장 직접적인 `planning_foundation`의 기존 정본을 먼저 감사한 뒤 연결한다. 없는 사실·선호·역할은 질문 없이 채우지 않는다.

### 검증 영수증

| 게이트 | 결과 |
|---|---|
| 전체 여정 coverage 공개행동 Vitest | 6/6 PASS |
| 준비 지도·홈 표시 모델 공개행동 테스트 | 10/10 PASS |
| 모바일 전체 테스트 | 824/824 PASS |
| mobile/shared/web typecheck | PASS |
| 모바일 전체 ESLint + 신규 web test ESLint | PASS |
| 변경 범위 `git diff --check` | PASS (기존 mobile `.d.mts` 6개 LF→CRLF 경고만 있음) |
