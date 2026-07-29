# WeddingCode Candidate 6.3 사람 검증 실행 키트

상태: **EXECUTION PLAN / 모집·녹음·수집·제품 출시 승인 아님**
최초 작성: 2026-07-17 / 최종 개정: 2026-07-18
exact-version: `wedding-code-candidate6-research.3`

## 1. 먼저 답할 연구 질문

1. 실제 예비부부의 중요한 준비·협업·지원 장면을 빠뜨리지 않았는가?
2. 장면·전제·한 행동·응답을 의도대로 이해하는가?
3. `DS`의 criteria/vision endpoint가 대칭이고 모범답안을 만들지 않는가?
4. `JI`, `OA`, `CP`와 `ES`, `AS`를 실제 경험에서 구분하는가?
5. 균형 영향 범주와 `depends/not_applicable/no_experience/skip`을 구분하는가?
6. `CP`는 반복되는 선호인가, 매번 달라지는 조율 도구인가?
7. `SI`를 개인 성향·효도·가족 우선순위 판정으로 오해하지 않는가?
8. 모바일 흐름과 직접 선택 대화 카드가 편안하고 실제 대화에 도움이 되는가?
9. 답·초대·커플 공유가 비난·압박·통제·민감정보 노출을 만들지 않는가?

## 2. R0 concept elicitation

문항을 먼저 보여주지 않고 최근 실제 경험을 듣는다.

- 시작 12명 후 필요하면 6명 단위로 top-up한다. 고정 n은 PASS 기준이 아니다.
- 준비 stage, 정식/소규모/무예식·미정, solo-led/joint/planner, stakeholder low/high/none,
  접근성/신경다양성을 각각 최소 3명 이상 포함한다. 한 사람이 여러 cell을 충족할 수 있다.
- 성별·연령·지역·예산·한국어 문해·모바일 숙련·이성/동성 커플 차이를 기록하되 작은 cell을
  대표한다고 말하지 않는다.
- coverage 충족 뒤 연속 2회 인터뷰에서 새 P0/P1 domain이 없을 때만 “이번 라운드 잠정 포화”로
  기록한다. 미포함 subgroup은 `not assessed`다.

핵심 질문:

- 최근 대화를 어디서 시작해야 할지 막혔던 선택
- 같이 할 때/맡길 때 편하거나 불편했던 순간
- 진행 상황을 확인받고 싶거나 싫었던 순간
- 지쳤을 때 실제로 원했던 마음/행동 도움
- 같은 한 사람 또는 집단의 의견을 들었던 과정
- 현재 theme에 없는 반복 장면

## 3. R1+ 반복 인지면접

- 한 참여자에게 최대 8~10개 item만 보여준다.
- final exact wording의 각 core item을 관련 대상자 최소 10명이 본다.
- bipolar item은 endpoint orientation별 최소 5명이 본다.
- conditional item은 eligible 참여자만 denominator에 둔다.
- 최소 2개 iterative round를 시행한다.
- wording을 바꾸면 exact-version을 올리고 이전 관찰 수를 새 wording 근거에 합치지 않는다.
- form/orientation은 사전 permuted block으로 균형 배정한다.

한 참여자에게 전체 19/21문항 로컬 UI stress preview를 그대로 투여하지 않는다. 코드의 패널은 다음과
같고, stakeholder applicable일 때 SI를 core 뒤에만 추가한다.

| 패널 | 8개 core | applicable contextual block |
|---|---|---|
| `P1` | `DS1, JI1, OA1, CP1, ES1, AS1, DS4, OA3` | `SI1` |
| `P2` | `DS2, JI2, OA2, CP2, ES2, AS2, DS3, JI3` | `SI2` |
| `P3` | `DS3, JI3, OA3, CP3, ES3, AS3, DS4, JI1` | `SI1, SI2` |

`P1/P2/P3`는 문항 노출을 분산하는 인지면접 운영 패널이지 psychometric parallel form이 아니다.
각 exact item의 목표 노출 수는 패널 배정표에서 별도로 추적한다.

### 「오늘 한 마디」 UI가 얹은 자극에 대한 필수 probe (2026-07-29 추가)

`docs/wedding-code/63_today_one_line_design_plan_2026-07-28.md`의 로컬 프로토타입은 문항
자체는 한 글자도 바꾸지 않았지만 **측정 앞뒤와 사이에 새 자극 셋**을 얹었다. 그 자극이
응답을 옮겼는지는 문항 wording probe로는 안 잡히므로 별도로 묻는다. 기획서 §11 위험 2·3이
지목한 것이 정확히 이 셋이고, §9는 **이 probe들이 프로토콜에 들어가기 전에는 인지면접에서도
사용을 금지**한다. 아래 3문항이 그 게이트다.

| # | 자극 | 언제 묻나 | probe |
|---|---|---|---|
| Q-UI1 | **막간 문장**(문항 사이 최대 3회) | 막간 직후 다음 문항에 답한 뒤 | 「방금 중간에 나온 문장 기억나세요? 그 문장 때문에 다음 답이 달라졌나요? 달라졌다면 어떻게요?」 |
| Q-UI2 | **문 앞의 한 문장**(「결혼 준비 얘기를 꺼내는 사람이, 늘 같은 사람이다.」) | 세션 종료 후 | 「시작 화면에 한 문장이 있었어요. 그 문장이 이후 선택에 영향을 줬나요?」 |
| Q-UI3 | **장면 라벨**(「우리 얘기」/「우리 얘긴 아니에요」) | 회수 화면 관찰 직후 | 「라벨을 붙인/안 붙인 이유가 뭐예요? 붙이면 뭐가 달라진다고 생각하셨어요?」 |

운영 규칙:

- Q-UI1은 **막간을 실제로 본 참여자에게만** 묻는다. 패널이 8~10문항이라 막간이 0회일 수
  있다(`interludeIndexes`는 총 문항 수의 함수다). 안 봤으면 `not_applicable`로 기록하고
  본 사람 수를 분모로 별도 집계한다.
- Q-UI2는 **세션 끝에** 묻는다. 중간에 물으면 그 자체가 문장을 다시 프라이밍한다.
- Q-UI3의 목적은 라벨의 유용성이 아니라 **라벨을 보상으로 오해했는지**다. 「붙이면 뭐가
  달라지나」에 기능적 기대(결과가 바뀐다·추천이 달라진다)가 나오면 §3 금지의 실패 신호다.
- 세 probe 중 하나라도 「자극이 답을 옮겼다」가 나오면 해당 자극을 **제거하고 exact-version을
  올린다**. 막간은 이를 위해 독립 컴포넌트로 분리돼 있어 배열을 비우는 것만으로 되돌릴 수 있다.

**미측정으로 남는 것**: 황혼 전환·리듬 라벨·press 방향은 위 probe로 안 잡힌다. 이들은
R1-UX 관찰(§5 사용성·접근성)에서 행동으로만 본다.

### R1 적격성 screener와 패널 배정

패널을 고르기 전에 다음 세 축을 서로 독립적으로 묻고 `eligible/not_applicable/unsure`로 코딩한다.
준비 단계나 `solo-led/joint/planner` cell만 보고 값을 추정하지 않는다.

| key | `eligible` | `not_applicable` | `unsure` |
|---|---|---|---|
| `recording` | 실제 또는 확정된 계획에서 사진·영상 기록 옵션 선택 장면을 떠올릴 수 있음 | 기록물 또는 관련 옵션을 결정할 계획이 없음 | 기록 계획이 아직 정해지지 않음 |
| `vendor-assisted` | 업체·플래너 비교·계약·이용 장면을 떠올릴 수 있음 | 업체·플래너를 비교하거나 이용할 계획이 없음 | 업체 이용 계획이 아직 정해지지 않음 |
| `partner-collaboration` | 파트너와 준비 결정·역할·지원 대화 장면을 떠올릴 수 있음 | 파트너와 해당 조율을 하지 않는 준비 구조 | 함께 준비할 방식이 아직 정해지지 않음 |

코드의 `planCandidate6InterviewAssignment`만 R1 투여안을 만든다.

1. 패널 원문항이 적격이면 유지한다.
2. 비적격/미결이면 `SAME_THEME_ELIGIBLE_NOT_ALREADY_ASSIGNED` 규칙으로 같은 theme의 적격·미배정
   문항 하나만 결정적으로 대체하고 원문항→대체문항을 기록한다.
3. 같은 theme에 대체문항이 없으면 `NO_ELIGIBLE_SAME_THEME_SUBSTITUTE`로 `incompatible` 처리하고
   `items=[]`로 반환한다. 부분 패널, cross-theme 대체, 임의 축소 투여는 금지한다.
4. `partner-collaboration`이 적격이 아니면 JI/OA/CP/ES/AS 대체문항도 없으므로 R1을 투여하지 않는다.
   이 참여자는 R0 concept elicitation에는 참여할 수 있지만 R1 노출 수에는 넣지 않는다.
5. SI는 기존 stakeholder screener가 `applicable`일 때만 적격 core 뒤에 붙인다.

P2는 원형상 `recording` DS2와 `vendor-assisted` DS3를 함께 포함한다. 둘 중 하나라도 비적격이면 위
규칙으로 DS theme 안에서만 대체하며, 대체 뒤에도 중복 없는 core 8개를 유지해야 한다.

각 participant-item row는 다음 수를 exact-version별로 남긴다. 현재 로컬 prototype은 저장하지 않으므로
실제 연구 수집 구현·동의 승인 전에는 이 ledger를 생성하지 않는다.

- `eligibilityAtAssignment`: 배정 당시 screener 상태인 `eligible/not_applicable/unsure`.
- `responseDisposition`: `not_administered`, substantive 답을 고른 `answered`, 또는 escape인
  `depends/not_applicable/no_experience/skip`. 사전 적격성과 덮어쓰거나 합치지 않는다.
- `requested`와 `requestedEligible/requestedNotApplicable/requestedUnsure`: 원래 panel이 요청한
  `requestedItemId` 기준 수와 `originalEligibility`별 수. 대체되거나 최종 미배정이어도 원문항에 남긴다.
- `assigned`: 대체가 끝난 최종 투여안에 포함됨. 원래 panel target만으로 세지 않는다.
- `administered`: `assigned`된 문항을 실제로 화면에 제시함. assigned 없이 administered일 수 없다.
- `eligible`: 대체 후 `eligibilityAtAssignment=eligible`인 assigned row 수. planner는 unsure/non-applicable
  문항을 최종 배정하지 않으므로 별도 assigned-`unsure` 수는 두지 않는다.
- `not_applicable`: `responseDisposition=not_applicable`인 administered row 수. neutral/0으로 바꾸지 않는다.

따라서 배정 때 eligible이었지만 문항을 본 뒤 구조적 비해당을 고른 동일 row는 `eligible=1`과
`not_applicable=1`에 모두 기여한다. `administered=false`이면 `responseDisposition=not_administered`여야 하고,
투여했다면 `answered` 또는 네 escape 중 하나여야 한다.

item별 합계는 `summarizeCandidate6InterviewTracking`으로 계산하고, substitution ledger와 함께 보고한다.

> [!CAUTION]
> **2026-07-18 구현 상태와 남은 공백:** planner와 tracking row는 opaque RFC 4122 assignment UUID,
> exact-version, Form/orientation, support order, rotation, panel, 전체 eligibility screener snapshot,
> stakeholder applicability, 요청 원문항, 최종 배정문항, 대체문항, 원문항 적격성을 각각 보존한다.
> summarizer는 row 버전, enum, 응답 상태, panel membership, screener에서 파생한 적격성, same-theme
> substitution lineage, assignment별 metadata 일관성, 요청 문항과 최종 문항의 중복을
> fail-closed로 검증한다. 그러나 현재 template은 어디에도 저장하지 않고, 동의·TTL·삭제·철회·실제
> 연구 수집 흐름도 없다. deterministic same-theme rotation은 단일 배정의 편향을 줄일 뿐 전체 표본의
> item별 동일 노출을 보장하지 않는다. 따라서 사람 연구의 완성 원장으로 사용하기 전에 저장·동의
> 설계와 패널 배정 비율 또는 의도적 과표집 이유를 사전등록하고 검증해야 한다.

probe:

- 이해: “이 질문이 무엇을 묻는다고 느꼈나요?”
- 전제: “답할 때 실제로 남아 있던 약속은 무엇인가요?”
- 판단: “어떤 경험을 떠올렸나요?”
- 한 행동: “이 문장에 행동이 몇 개 있다고 느꼈나요?”
- 응답: “왜 이 답을 골랐고, 맞는 답이 없었다면 무엇이 필요했나요?”
- 중앙: “두 이야기를 나란히 시작한다는 건 어떤 행동인가요?”
- 비서열: “비해당, 경험 없음, 상황 차이, 넘김은 어떻게 다른가요?”
- 정답감: “더 좋은 파트너처럼 보이는 답이 있었나요?”
- 오남용: “상대가 이 답을 보면 나를 어떻게 판단할 것 같나요?”

인터뷰어는 정답을 설명하거나 좋은 파트너·합리적 선택을 암시하지 않는다.

## 4. Form과 순서

현재 Form A/B는 다른 요인을 고정했을 때 item identity와 order가 정확히 같고, bipolar semantic
endpoint 위치만 complement한다. 관찰 차이는 endpoint 위치로 해석하되 작은 인지면접 표본에서
통계적 위치 효과를 확정하지 않는다.

향후 순서 효과를 시험할 때는 다음 2×2 요인을 독립 배정한다.

- `orientationVariant`: A/B
- `supportPairOrder`: `ES_FIRST`/`AS_FIRST`

두 요인을 2×2로 독립 배정하고 하나의 form 이름에 섞지 않는다. 세 ES/AS pair는 같은 participant에서
동일한 support order를 쓰고, order/carryover를 기록한다. SI는 모든 core 뒤 별도 contextual block으로
제시하며 core factor·총점에서 제외한다. SI block order를 바꿀 연구가 필요하면 세 번째 독립 요인으로
사전등록하지, stakeholder 집단에만 core 중간 삽입하지 않는다.

## 5. 사용성·접근성 관찰

- 320px/390px 실제 모바일 또는 동등 viewport
- 첫 행동까지 거리, 문항당 스크롤, sticky 이전/다음, safe-area
- 48px 이상 touch target과 오탭
- 첫 번째/두 번째 endpoint와 선택지 연결 이해
- 제목 단계 전환 초점, progressbar, 하나의 radio group 낭독
- 프로그램 초점의 시각 표시, 키보드, screen reader, 200% zoom
- `prefers-reduced-motion`, 고대비, 저시력, 한국어 문해 차이
- 마지막 카드가 추론 결과가 아니라 직접 선택임을 이해하는지
- 새로고침 소멸·무저장·무전송 안내 이해
- 첫 선택지가 보이기 전 필요한 스크롤과 아래 선택지 발견 여부
- core 다섯 응답을 모두 비교했다고 느끼는지, escape 응답을 놓치지 않는지

개발 툴바가 화면을 덮는 스크린샷은 승인 증거로 쓰지 않는다. production-like local build 또는 dev
indicator를 끈 환경에서 다시 캡처한다.

## 6. review trigger와 중단 조건

- 한 번의 severe harm, 낙인, 비난, 답 강요, 통제, 결혼 성공·이혼·궁합 예측 해석: 즉시 STOP
- 같은 exact item에서 2명 이상 construct 오해·모범답안·맞는 답 없음: REWRITE/SPLIT/DROP review
- eligible 표본에서 비서열 응답이 15% 이상: wording/eligibility/category review
- substantive category 하나가 5% 미만: 자동 병합하지 않고 sparse-category review
- 외부 의견·예산·업체 답을 상대 또는 제3자에게 전송한다고 오해: flow와 copy 중단·개정
- 수집·철회·삭제 약속을 구현으로 지킬 수 없음: 연구 시작 금지

숫자는 자동 PASS가 아니다. 문제의 심각도·패턴·subgroup을 함께 검토한다.

## 7. 비서열·결측 사전 계약

- `responseDisposition=not_applicable`: structural missing으로 보고 substantive-response 분석 분모에서는
  제외한다. 다만 `eligibilityAtAssignment=eligible`이면 eligible count에는 유지하고 비해당 응답률을
  별도로 보고한다.
- `no_experience`: eligible일 수 있으나 판단 근거 부족
- `depends`: context instability
- `skip`: 응답하지 않기로 선택

stakeholder screener의 `unsure`와 `not_applicable`도 합치지 않는다. 둘 다 SI를 투여하지 않지만,
전자는 applicability 미결정이고 후자는 구조적 비해당이므로 별도 flow count로 남긴다.

각 값을 item·subgroup별로 따로 보고한다. 서로 합치거나 impute/0/neutral로 변환하지 않는다.
factor/IRT 후보 분석에는 substantive ordinal responses만 사용하고 selection/missing mechanism sensitivity와
eligibility flow diagram을 함께 보고한다.

## 8. 데이터·동의 게이트

**현재 로컬 프로토타입에서는 아무것도 수집하지 않는다.** 실제 연구 전 별도 승인 문서와 구현이
필요하다.

- 목적, 최소 항목, 근거, 보유기간, 삭제방법, 담당 연락처
- 연구 동의와 서비스 이용·마케팅 동의 분리
- 이름·연락처를 받지 않는 participant ID, 자유 텍스트 민감정보 차단
- 녹음·화면 캡처 각각 별도 선택 동의
- raw token 미저장, 삭제 receipt, tombstone, backup restore 후 re-delete
- 연구 종료·중단·동의 철회 삭제 리허설
- 키·토큰·원응답·녹취·private receipt의 Git/PR/analytics 유출 차단

운영 수집 전 법적·개인정보 책임자의 별도 승인이 필요하다.

## 9. 구조·정밀도 사전등록 후보

R0/R1에서 content/response-process 근거가 남은 item만 파일럿에 넣는다.

정량 파일럿 전 선결 review:

- `CP3`: scheduled checkpoint가 아니라 exception/support escalation이면 rewrite/drop/contextual 전환
- `ES1`: 정서지원보다 stress communication/정보수집으로 읽히면 rewrite 또는 별도 가설
- `DS3`: 다른 DS와 과정/결과 facet가 맞지 않으면 DS 투입 금지
- `DS4`: 알림과 축하 장면이 갈라지면 split/rewrite

- DS 1-factor 후보
- JI/OA/CP correlated 3-factor 대 OA+CP collapse 대안
- ES/AS correlated 2-factor + scenario-pair method effect
- SI 제외
- ordinal estimator, threshold, local dependence, category functioning
- EFA/CFA 독립 표본
- Monte Carlo로 표본을 정하고 부족하면 `untested`
- 구조가 지지된 theme만 ordinal omega/conditional SE 검토
- total WeddingCode score 없음

한 표본의 EFA+CFA, alpha 하나, 평균, AI 리뷰, founder intuition으로 성공을 선언하지 않는다.

## 10. 외적 관계·공정성 가설

데이터를 보기 전에 방향을 사전등록한다.

- JI ↔ 표준 planning task에서 공동 단계를 직접 선택한 행동
- OA ↔ 담당 방식의 자율 선택
- CP ↔ check-in 시점 선택
- ES/AS ↔ 같은 scenario에서 사용자가 직접 고른 지원 메시지
- JI와 OA, ES와 AS는 반드시 음의 상관일 필요 없음

적법하게 사용할 수 있는 검증된 한국어 척도는 전문가가 선정한다. 적합한 척도가 없으면 자체
single item을 convergent validity라고 부르지 않고 exploratory behavioral relation으로만 보고한다.
관계 만족, 궁합, 결혼 성공은 criterion으로 쓰지 않는다.

stage, ceremony, gender/age, involvement, stakeholder, budget/region, accessibility/neurodiversity,
solo/couple, orientation의 DIF/invariance는 충분한 cell만 분석한다. 부족한 subgroup은 qualitative
evidence와 `not assessed`로 남기며 공정성 통과를 선언하지 않는다.

## 11. 제품 효용·공유 consequence

- 7일 내 직접 고른 대화 카드 사용 여부
- 사용 후 도움, 불편, 비난, 압박, 회피
- 초대 카드의 공유 의향과 원응답 공개 오해
- 연인 공유의 독립 동의·공개 범위·만료·철회 이해
- “상대가 답해야 공개” 없는 흐름의 완료율
- 결과 문장이 자기규정·관계평가로 굳어지는 사례

share rate만 최적화하지 않는다. 공유 증가와 함께 regret, deletion, coercion, support escalation을 본다.

## 12. 라운드별 산출물

- exact-version item disposition: KEEP / REWRITE / SPLIT / DROP
- item별 requested/requested eligibility/assigned/administered/eligible/not_applicable, substitution, orientation exposure,
  이해·대안 해석·비서열 응답
- source ledger 변경과 supported/not-supported claim
- 추가·삭제된 장면과 이유
- Form/UI/접근성 변경
- 남은 P0/P1과 미평가 subgroup
- 개인 결과·공유·수집을 계속 닫을지 여부

“통과한 것”, “관찰했지만 모르는 것”, “아직 하지 않은 것”을 분리해 기록한다.
