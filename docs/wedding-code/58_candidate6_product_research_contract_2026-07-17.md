# WeddingCode Candidate 6.3 제품·연구 계약

상태: **AUTHORITATIVE M0 RESEARCH CONTRACT / NOT A VALIDATED TEST**
최초 작성: 2026-07-17 / 최종 개정: 2026-07-18
exact-version: `wedding-code-candidate6-research.3`

## 1. 한 줄 판정

Candidate 6.3은 문항 후보와 검증 프로토콜을 더 엄격하게 정리한 로컬 연구물이다. 문헌·시장자료는
연구 가설과 장면의 존재를 뒷받침할 뿐, 현재 문항·테마·개인 결과의 타당성을 보증하지 않는다.
전 문항은 `M0`, `COGNITIVE_INTERVIEW_REQUIRED`, `scoreEligible:false`다.

따라서 현재 사용할 수 있는 표현은 다음뿐이다.

> “웨딩 성향을 정확히 판정하는 테스트”가 아니라, 결혼 준비 대화를 어디서 시작하면 편할지 살펴보는
> 검증 전 장면 후보입니다.

## 2. 운영 containment

운영 WeddingCode는 계속 다음 상태를 유지한다.

- public 안내-only
- `/wedding-code/result`는 안내 화면으로 redirect
- 기존 결과·커플·공유 API `410 Gone` 유지
- 운영 DB write fence 유지
- Candidate 4 runtime retired
- Candidate 5는 superseded 연구 계보이며 runtime 재연결 금지

Candidate 6.3은 운영 재개 권한이 아니다.

## 3. 소비자 가치 가설

제품의 핵심 보상은 “당신은 무슨 유형”이 아니라 다음 질문이다.

> **오늘 둘이 어떤 말을 먼저 꺼내면 결혼 준비가 조금 편해질까?**

장기 제품 방향은 다음과 같다. 아직 구현·승인된 운영 기능이 아니다.

1. 실제 사람 검증 뒤 정보량 높은 짧은 장면만 남긴다.
2. 답 직후 사용자가 직접 고르는 대화 카드로 즉시 가치를 준다.
3. 공유 기본값은 답·점수 없는 예쁜 테스트 초대 카드다.
4. 커플 공유는 두 사람 각각 동의하고, 공개 범위·만료·철회를 직접 고른다.
5. 아모라·일정·예산 적용은 사용자가 제안 diff를 확인한 뒤에만 실행하며 되돌리기를 제공한다.

가짜 참여 수, 가짜 정확도, 희귀도, 궁합 점수, 결혼 성공 예측, 제출 강요, 답 공개를 이용한 압박은
금지한다. 재미는 과장이 아니라 장면의 현실감, 진행 리듬, 직접 고른 보상, 안전한 공유에서 만든다.

## 4. 연구 가설 묶음

아래 코드는 편의를 위한 research theme다. latent dimension, scale, type이 아니다.

| 코드 | 검토할 가설 | 응답 | 현재 개인 결과 |
|---|---|---|---|
| `DS` | 최종 비교에서 확인 가능한 조건·과정 또는 원하는 모습·의미 중 어디서 대화를 시작하는가 | 대칭 양끝+유효 중앙 5범주 | 금지 |
| `JI` | 한 가지 준비 행동을 둘이 함께 하는 것이 미치는 영향 | 균형 영향 5범주 | 금지 |
| `OA` | 합의된 담당자가 방법·방식·순서를 자율적으로 정하는 것이 미치는 영향 | 균형 영향 5범주 | 금지 |
| `CP` | 합의된 시점·상황에 진행 상태를 함께 확인하는 것이 미치는 영향 | 균형 영향 5범주 | 금지 |
| `ES` | 한 가지 정서 지원 행동이 미치는 영향 | 균형 영향 5범주 | 금지 |
| `AS` | 한 가지 실행 지원 행동이 미치는 영향 | 균형 영향 5범주 | 금지 |
| `SI` | 같은 한 사람/집단의 의견을 듣기로 한 장면의 대화 시작 도구 | contextual tool, 비점수 | 영구 제외 후보 |

`JI`와 `OA`, `ES`와 `AS`는 반대축이 아니다. `CP`가 안정적 선호가 아니라 매번 달라지는 조율
도구라면 scale 후보에서 폐기한다. `SI`는 factor, reliability, 총점, 유형에서 제외한다.

## 5. 응답 계약

### 양극 시작점

- 첫 번째 이야기부터 시작하고 싶어요
- 첫 번째 이야기를 조금 먼저 꺼내고 싶어요
- 두 이야기를 나란히 시작하고 싶어요
- 두 번째 이야기를 조금 먼저 꺼내고 싶어요
- 두 번째 이야기부터 시작하고 싶어요

### 균형 영향

- 오히려 많이 방해돼요
- 조금 방해돼요
- 도움도 방해도 거의 없어요
- 조금 도움이 돼요
- 많이 도움이 돼요

기존의 `지금 꼭 필요해요`는 도움 정도에 긴급성을 섞으므로 삭제했다.

### 비서열 응답

- `depends`: 상황마다 많이 달라짐
- `not_applicable`: 현재 준비에 구조적으로 비해당
- `no_experience`: 해당될 수 있으나 판단 경험 부족
- `skip`: 답하지 않기로 선택

네 값은 중앙, 0점, 하나의 결측으로 합치거나 대치하지 않는다.

## 6. 문항 설계 변경

- `DS` 네 문항은 criteria-first와 vision-first의 같은 문법을 쓴다. 같은 단일 facet인지는 미검증이며,
  특히 `DS3`의 과정/결과 차이는 별도 정렬 검토 대상이다.
- `OC`를 담당 자율성 `OA`와 확인 시점 `CP`로 분리했다.
- `JI/OA/CP/ES/AS` 행동은 한 문장에 한 행동만 둔다.
- `ES/AS`는 세 쌍의 premise와 scenario를 byte-for-byte 동일하게 두어 장면 효과를 분리한다.
- `15분`, `20분`, `세 줄`, `두 개까지만` 같은 임의 형식은 제거했다.
- 각 문항에 `applicability`, 근거 ID, 대안 해석, `M0` 처분을 둔다.
- `SI3` 시간대 문항은 가용시간·거리 제약이 반응을 지배해 폐기했다.

Form A/B는 다른 요인을 고정했을 때 item identity와 order가 완전히 같고, 양극 의미의
첫 번째/두 번째 위치만 보완한다. `supportPairOrder=ES_FIRST|AS_FIRST`는 Form과 독립 배정해
세 ES/AS 쌍의 고정 순서·carryover를 분리한다. `SI`는 core를 모두 마친 뒤 별도 contextual block으로
제시해 뒤쪽 core 응답을 priming하지 않는다.

로컬 19/21문항 전체 여정은 모바일 UI stress preview일 뿐 인지면접 투여안이 아니다. 실제 인지면접은
`P1/P2/P3` 균형 패널로 참여자당 8개 core, applicable일 때 1~2개 SI만 추가한다.

R1 배정 전에는 코드의 적격성 screener로 `recording`, `vendor-assisted`, `partner-collaboration`을 각각
`eligible/not_applicable/unsure`로 코딩한다. `not_applicable`과 `unsure`는 합치지 않는다. 고정 패널의
비적격 core는 **같은 theme이며, 적격이고, 이미 배정되지 않은 문항**으로만 대체한다. 대체할 문항이
없으면 plan은 `incompatible`이고 투여 문항을 0개로 반환한다. theme를 넘겨 임의 대체하거나 비적격
문항을 조용히 투여하지 않는다. 최종 배정은 item별 `assigned/administered/eligible/not_applicable/unsure`와
원문항→대체문항을 따로 추적한다. 한 participant-item row에서 배정 시점의
`eligibilityAtAssignment`와 투여 후 `responseDisposition`을 독립 보존해, 사전 적격자가 사후
`not_applicable`을 골라도 eligible denominator와 비해당 응답을 모두 센다. 이는 연구 운영 규칙일 뿐
문항 타당성이나 출시 승인이 아니다.

## 7. 근거 계약

정확한 source ledger는 `59`에 둔다. 모든 출처는 다음을 함께 기록한다.

- exact ID, URL/로컬 URI, section 또는 locator
- `supportedClaim`
- `notSupportedClaim`
- 적용 population/context

현재 `S0/S1`은 장면·개념 소재 근거일 뿐 측정 근거가 아니다. 문항별 원문 추적과 사람 검증 없이
`S2`를 부여하지 않는다. 저작권 있는 제3자 검사 문항·점수·유형을 복제하지 않는다.

## 8. 로컬 연구 프로토타입 안전 계약

허용 경로: `/internal/wedding-code-research?form=A|B&supportOrder=ES_FIRST|AS_FIRST`

허용 실행 명령: `corepack pnpm --filter @hanbang/web dev:wedding-code-research`
이 명령만 연구 플래그를 켜고 dev server를 `127.0.0.1`에 고정하며 연구 QA 때 dev indicator를 끈다.
추적되지 않는 route를 실행 중에만 생성하고 종료 때 삭제하며, 운영 빌드와 같은 원자적 lock을 쓴다.

모두 만족해야 열린다.

1. `NODE_ENV=development`
2. server-only `WEDDING_CODE_RESEARCH_PREVIEW=true`
3. request host가 `localhost`, `127.0.0.1`, `[::1]` 중 하나

추가 경계:

- PostHog·UTM 경로 suppression, `autocapture:false`, session recording off
- 연구 실행기에서 PostHog·Sentry DSN·Sentry auth token을 명시적으로 비우고 Next telemetry를 끔
- `ph-no-capture`
- 외부 `connect-src`를 허용하지 않는 경로 전용 CSP
- 차단 응답은 `private, no-store`; 허용된 Next dev HTML은 framework 강제
  `no-cache, must-revalidate`이며 답변 state를 포함하지 않음
- `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet`
- React memory state만 사용; 새로고침 시 소멸
- fetch/API/Supabase/analytics/localStorage/sessionStorage/IndexedDB/cookie 쓰기 금지
- 계정·이메일·전화번호·이름·연락처 입력 금지
- clipboard/native share/OG answer metadata 금지

Preview/Production에는 연구 app route 파일 자체가 없다. 모든 공식 web build는 하나의 안전 wrapper를
통과하며, 시작 전 생성 route 부재를 확인하고 종료 후 app manifest 및 static/server artifact에서
route와 후보 문자열이 0건인지 재검사한다. 로컬 연구 server와 운영 build는 같은 exclusive lock을
사용해 동시에 열릴 수 없다. 가짜 PostHog/Sentry 수신기를 둔 E2E에서도 외부 요청·storage가 0이어야 한다.

## 9. 결과·공유·제품 적용 게이트

사람 검증 전에는 개인 결과, 커플 결과, 답 공유, 일정·예산·업체·아모라 적용을 모두 닫는다.

향후 근거가 충분한 theme만 다음처럼 관찰 범위와 상황 의존성을 함께 보여줄 수 있다.

> “이번에 답한 네 장면 중 세 장면에서는 조건 이야기를 먼저 꺼내는 쪽을 골랐어요. 준비 단계와
> 장면에 따라 달라질 수 있어요.”

총점, 4글자 코드, cutoff, 백분위, 희귀도는 대표 규준·분류 일관성 근거가 생기기 전 금지한다.

공유 원칙:

- 공개/친구: 원응답 없는 초대 카드가 기본
- 연인: 발신·수신 독립 동의, 공개 범위 선택, 철회·만료·삭제
- OG·로그·알림: 원응답, 예산, 가족, 업체, 관계 평가 금지
- “상대가 답해야 내 결과 공개” 같은 강제 호혜 금지

## 10. 사람 검증 게이트

자동 테스트는 copy drift와 격리만 막는다. 다음을 통과하기 전 정식 테스트가 아니다.

1. concept elicitation으로 빠진 실제 준비 장면 확인
2. 소비자·관계/설문·개인정보·접근성 전문가 내용 검토
3. exact-version 반복 인지면접과 severe-harm/오해 중단 규칙
4. 모바일·키보드·스크린리더·저시력 사용성 검증
5. 사전등록한 결측·form·구조·외적 관계·consequence 분석
6. simulation으로 정한 독립 EFA/CFA 표본; 부족하면 `untested`
7. 충분한 subgroup만 DIF/invariance 평가; 나머지는 `not assessed`
8. 실제 커플의 독립 동의 아래 대화 효용·불편·비난·압박 관찰
9. consent/TTL/delete/tombstone/backup re-delete 구현과 리허설
10. 별도 Production 재개 PR, 법적·개인정보·운영 승인

현재 1~10은 모두 미통과다.

## 11. 코드 권한 경계

- item/schema/source ledger mirror: `apps/web/src/lib/weddingCode/research/candidate6.ts`
- local UI: `apps/web/src/lib/weddingCode/research/Candidate6Prototype.tsx`
- local-only page module: `apps/web/src/lib/weddingCode/research/localPreviewPage.tsx`
- generated guarded route: `apps/web/src/app/internal/wedding-code-research/page.tsx` (실행 중에만 존재, 커밋 금지)
- safe build/lock: `scripts/build-web-safely.mjs`, `scripts/wedding-code-research-lock.mjs`
- evidence: `59_candidate6_item_evidence_matrix_2026-07-17.md`
- execution: `60_candidate6_validation_execution_kit_2026-07-17.md`

코드가 exact item text의 source of truth다. 문서가 다른 점수·유형·운영 권한을 만들어내지 않는다.
