# WeddingCode Synthetic Persona Response Matrix v0.1

> [!CAUTION]
> **HISTORICAL / NOT CURRENT SPEC.** 초기 설계·검토 계보이며 현재 문항·점수·유형·근거·수집·운영
> 승인으로 사용하지 않는다. 현행 상태는 [`README.md`](./README.md)와
> [`62`](./62_wedding_code_master_design_and_current_state_2026-07-18.md)를 따른다.

## 0. Scope

This document is a pre-human sanity check for the WeddingCode smoke-test shortlist and answer options.

It simulates how 10 synthetic personas might answer the 16 smoke-test questions from `07_smoke_test_shortlist_v0.2.md` using the neutral answer options in `11_answer_option_design_v0.1.md`.

This is not user validation, psychometric validation, product validation, scoring, or evidence of market demand. It should only be used to inspect option balance, construct discrimination, ambiguity, stage fit, and stigma risk before human expert review or smoke testing.

This document does not create UI, routes, database migrations, scoring logic, numeric weights, final public 4-letter codes, final 16 types, characters, couple combination names, or Amora prompt behavior.

## 1. Source Inputs

- `docs/wedding-code/07_smoke_test_shortlist_v0.2.md`
- `docs/wedding-code/11_answer_option_design_v0.1.md`
- `docs/wedding-code/05_question_domain_map.md`
- `docs/wedding-code/10_no_code_form_build_guide_v0.1.md`

## 2. Question Index

| Order | Question ID | Target construct | Stage |
|---:|---|---|---|
| 1 | `WC-Q-costRisk-005` | `costRisk` | `sdm_search`, `contract_pending` |
| 2 | `WC-Q-experienceMeaning-001` | `experienceMeaning` | `sdm_search` |
| 3 | `WC-Q-coPreparation-003` | `coPreparation` | `contract_pending` |
| 4 | `WC-Q-roleOwnership-006` | `roleOwnership` | `contract_pending`, `contracted` |
| 5 | `WC-Q-evidenceDecision-006` | `evidenceDecision` | `contract_pending` |
| 6 | `WC-Q-aestheticMood-002` | `aestheticMood` | `venue_search` |
| 7 | `WC-Q-familyIntegration-002` | `familyIntegration` | `venue_search` |
| 8 | `WC-Q-coupleAutonomy-004` | `coupleAutonomy` | `marriage_discussion`, `preparing_without_date` |
| 9 | `WC-Q-emotionalSupport-002` | `emotionalSupport` | `contract_pending` |
| 10 | `WC-Q-executionSupport-006` | `executionSupport` | `wedding_week` |
| 11 | `WC-Q-decisionPaceRisk-004` | `decisionPaceRisk` | `venue_search`, `contract_pending` |
| 12 | `WC-Q-guidanceNeed-005` | `guidanceNeed` | `contract_pending` |
| 13 | `WC-Q-costRisk-001` | `costRisk` | `venue_search`, `contract_pending` |
| 14 | `WC-Q-roleOwnership-003` | `roleOwnership` | `sdm_search` |
| 15 | `WC-Q-evidenceDecision-001` | `evidenceDecision` | `sdm_search` |
| 16 | `WC-Q-coupleAutonomy-002` | `coupleAutonomy` | `marriage_discussion`, `contracted` |

## 3. Synthetic Personas

### 3.1 Cost-Risk Focused User

| Field | Description |
|---|---|
| Persona name | 비용 리스크 확인형 |
| Assumed tendency | 숨은 비용, 총액, 환불 조건, 계약 리스크를 먼저 확인해야 안심한다. |
| Likely wedding stage | `contract_pending` |
| Likely concerns | 추가금, 구두 약속, 견적 누락, 계약 전 확인 누락 |
| Expected product needs | `/check` 견적 진단, 계약 전 체크리스트, Amora 질문 리스트 |

| Q | Selected option | Reason for selection | Construct tendencies expressed | Obvious or forced | Another plausible option | Stage-fit concern |
|---:|---|---|---|---|---|---|
| 1 | A | 불명확한 포함 항목과 추가 비용부터 확인하려 한다. | `costRisk`, `evidenceDecision` | Obvious | D | None |
| 2 | B | 추가 비용이 전체 예산 안에 들어오는지 먼저 본다. | `costRisk`, `evidenceDecision` | Obvious | A | None |
| 3 | C | 계약 전 자료 확인이 먼저 필요하다고 본다. | `evidenceDecision`, `costRisk` | Obvious | A | None |
| 4 | D | 최종 계약 전 빠뜨린 위험을 줄이고 싶어 한다. | `executionSupport`, `decisionPaceRisk` | Somewhat obvious | B | None |
| 5 | A | 구두 약속은 문서나 메시지로 남겨야 안심한다. | `evidenceDecision`, `decisionPaceRisk` | Obvious | D | None |
| 6 | B | 분위기보다 식대, 보증 인원, 교통 조건을 같이 본다. | `costRisk`, `familyIntegration` | Obvious | D | None |
| 7 | C | 가족 의견보다 먼저 실제 비용과 보증 인원 차이를 확인한다. | `costRisk`, `evidenceDecision` | Natural | B | None |
| 8 | B | 부모님 설명 전 숫자와 이유를 준비하려 한다. | `evidenceDecision`, `costRisk` | Natural | A | None |
| 9 | B | 걱정도 인정받고 선택지도 정리되는 균형을 원한다. | `emotionalSupport`, `executionSupport` | Slightly forced | C | None |
| 10 | B | 빠뜨린 항목을 줄이는 전체 체크리스트가 먼저 필요하다. | `executionSupport`, `guidanceNeed` | Natural | A | Wedding-week scenario is hypothetical if not near wedding. |
| 11 | C | 들뜬 기분보다 계약서, 총액, 취소 조건 확인을 우선한다. | `costRisk`, `evidenceDecision` | Obvious | A | None |
| 12 | B | 낯선 견적에서는 추가금 가능성이 큰 항목 표시가 중요하다. | `costRisk`, `evidenceDecision` | Obvious | A | Harder if user has never seen a quote. |
| 13 | A | 예산 초과 상황에서는 총액과 환불 조건을 먼저 확인한다. | `costRisk`, `evidenceDecision` | Obvious | D | None |
| 14 | D | 스타일과 조건을 한 표에서 확인하면 리스크가 줄어든다. | `executionSupport`, `evidenceDecision`, `aestheticMood` | Natural | A | None |
| 15 | A | 후기가 적으면 실제 사례와 포함 조건을 더 확인한다. | `evidenceDecision`, `costRisk` | Obvious | C | None |
| 16 | D | 전통 간소화도 예산, 시간, 진행 흐름 근거가 있어야 설명 가능하다고 본다. | `costRisk`, `evidenceDecision`, `coupleAutonomy` | Natural | B | May be abstract before family discussion starts. |

### 3.2 Experience-Meaning Focused User

| Field | Description |
|---|---|
| Persona name | 경험 의미 중시형 |
| Assumed tendency | 오래 남는 기억, 사진, 분위기, ceremony meaning을 중요한 판단 기준으로 본다. |
| Likely wedding stage | `sdm_search`, `venue_search` |
| Likely concerns | 예산 안에서 의미 있는 선택을 지키는 법, 후회 없는 무드 선택 |
| Expected product needs | 웨딩 라운지 무드 정리, Amora 의미 대화 질문, couple report |

| Q | Selected option | Reason for selection | Construct tendencies expressed | Obvious or forced | Another plausible option | Stage-fit concern |
|---:|---|---|---|---|---|---|
| 1 | B | 스튜디오 결과물이 원하는 분위기와 맞는지 먼저 본다. | `aestheticMood`, `experienceMeaning` | Natural | D | None |
| 2 | A | 오래 남을 의미가 있는지가 핵심 판단 기준이다. | `experienceMeaning` | Obvious | D | None |
| 3 | A | 마음에 든 이유와 의미를 상대와 공유하고 싶어 한다. | `coPreparation`, `experienceMeaning` | Natural | B | None |
| 4 | C | 조건과 분위기를 나누어 확인하는 방식이 균형 있어 보인다. | `roleOwnership`, `aestheticMood`, `costRisk` | Natural | B | None |
| 5 | C | 약속이 없어도 업체가 원하는 분위기와 기준에 맞는지 다시 본다. | `experienceMeaning`, `aestheticMood` | Natural | A | None |
| 6 | A | 홀에 들어섰을 때 느낀 분위기 적합성이 먼저다. | `aestheticMood`, `experienceMeaning` | Obvious | C | None |
| 7 | B | 분위기와 하객 편의를 함께 비교하면 의미와 현실을 같이 볼 수 있다. | `familyIntegration`, `aestheticMood`, `evidenceDecision` | Natural | D | None |
| 8 | A | 둘의 기준을 먼저 맞춰야 의미 있는 결혼식 기준을 설명할 수 있다. | `coupleAutonomy`, `coPreparation` | Natural | D | None |
| 9 | B | 공감과 선택지 정리를 함께 받으면 감정과 실행이 연결된다. | `emotionalSupport`, `executionSupport` | Natural | A | None |
| 10 | D | 바쁜 주간에도 서로 부담되는 부분을 이야기하고 나누는 게 맞다. | `emotionalSupport`, `coPreparation`, `executionSupport` | Natural | B | Wedding-week scenario is distant for early SDM users. |
| 11 | D | 마음에 든 이유가 다른 후보 대비 어떤지 한 번 더 비교한다. | `aestheticMood`, `guidanceNeed` | Natural | B | None |
| 12 | A | 복잡한 견적도 핵심 질문으로 정리되면 의미 있는 선택을 지킬 수 있다. | `guidanceNeed`, `evidenceDecision` | Slightly forced | D | Quote scenario may be less relevant before consultation. |
| 13 | B | 비싼 venue라도 오래 남을 경험인지 먼저 생각한다. | `experienceMeaning`, `aestheticMood` | Obvious | D | None |
| 14 | A | 각자 잘 보는 기준을 맡고 결과를 공유하는 방식이 자연스럽다. | `roleOwnership`, `coPreparation` | Natural | D | None |
| 15 | B | 후기가 적어도 포트폴리오가 원하는 무드와 맞는지 다시 본다. | `aestheticMood`, `experienceMeaning` | Obvious | C | None |
| 16 | A | 전통 간소화의 이유와 둘에게 남는 의미를 먼저 정리한다. | `coupleAutonomy`, `experienceMeaning` | Natural | B | May be early if family etiquette has not appeared. |

### 3.3 Co-Preparation Focused Partner

| Field | Description |
|---|---|
| Persona name | 함께 준비 중시형 |
| Assumed tendency | 결혼 준비가 둘의 공동 과정처럼 느껴져야 안정감을 느낀다. |
| Likely wedding stage | `contract_pending` |
| Likely concerns | 한쪽만 알아보는 부담, 상대가 자세히 못 본 상태에서의 결정 |
| Expected product needs | partner invite, couple report, 상담 요약 공유, 공동 체크리스트 |

| Q | Selected option | Reason for selection | Construct tendencies expressed | Obvious or forced | Another plausible option | Stage-fit concern |
|---:|---|---|---|---|---|---|
| 1 | C | 필요한 항목과 조정 가능한 항목을 상대와 나누고 싶다. | `coPreparation`, `coupleAutonomy` | Natural | A | None |
| 2 | D | 오래 남기고 싶은 장면을 상대와 먼저 이야기한다. | `coPreparation`, `experienceMeaning` | Obvious | A | None |
| 3 | A | 상담 내용과 마음에 든 이유를 공유하고 같이 확인한다. | `coPreparation`, `experienceMeaning` | Obvious | D | None |
| 4 | B | 계약서와 견적 항목을 둘이 같은 자료로 확인하고 싶다. | `coPreparation`, `evidenceDecision` | Obvious | A | None |
| 5 | D | 문서 확인 전 계약 속도를 늦춰 둘이 같이 판단하려 한다. | `decisionPaceRisk`, `evidenceDecision` | Natural | A | None |
| 6 | D | 상대와 가족이 중요하게 보는 기준까지 같이 맞춰보고 싶다. | `coPreparation`, `familyIntegration` | Natural | A | None |
| 7 | D | 둘의 기준을 정리하고 부모님께 설명할 절충안을 준비한다. | `coupleAutonomy`, `familyIntegration` | Natural | B | None |
| 8 | A | 부모님께 설명하기 전 둘의 기준을 맞추는 것이 먼저다. | `coupleAutonomy`, `coPreparation` | Obvious | C | None |
| 9 | D | 이런 상황에서 어떤 반응이 맞는지 상대와 이야기하고 싶다. | `coPreparation`, `emotionalSupport` | Obvious | B | None |
| 10 | D | 서로 부담되는 부분을 이야기한 뒤 일을 나눈다. | `emotionalSupport`, `coPreparation`, `executionSupport` | Obvious | A | Wedding-week scenario is late-stage only. |
| 11 | B | 마음에 든 이유와 걱정되는 점을 상대와 같이 적는다. | `coPreparation`, `emotionalSupport` | Obvious | A | None |
| 12 | D | 견적을 상대에게 공유할 수 있는 쉬운 요약본이 필요하다. | `coPreparation`, `guidanceNeed` | Obvious | A | Harder if no quote yet. |
| 13 | D | 예산과 만족감 기준을 상대와 다시 맞춘다. | `coPreparation`, `coupleAutonomy` | Obvious | A | None |
| 14 | B | 중요한 후보는 둘이 모두 보고 같이 정한다. | `coPreparation` | Obvious | A | None |
| 15 | D | 정보 부족을 어디까지 괜찮게 볼지 상대와 이야기한다. | `coPreparation`, `decisionPaceRisk` | Obvious | A | None |
| 16 | B | 가족이 걱정할 지점을 예상하고 설명 방식을 같이 준비한다. | `familyIntegration`, `emotionalSupport` | Natural | A | May be abstract before family expectations appear. |

### 3.4 Role-Ownership Focused Partner

| Field | Description |
|---|---|
| Persona name | 역할 주도 선호형 |
| Assumed tendency | 각자 맡은 일을 책임지고 압축한 뒤 중요한 지점만 함께 확인하는 방식을 선호한다. |
| Likely wedding stage | `sdm_search`, `contract_pending` |
| Likely concerns | 열린 논의가 너무 길어지는 것, 담당자와 마감이 불명확한 것 |
| Expected product needs | 역할 분담표, 후보 요약, 최종 승인 체크리스트 |

| Q | Selected option | Reason for selection | Construct tendencies expressed | Obvious or forced | Another plausible option | Stage-fit concern |
|---:|---|---|---|---|---|---|
| 1 | D | 실제 후기와 사례를 확인해 후보를 압축하고 싶다. | `evidenceDecision`, `guidanceNeed` | Natural | A | None |
| 2 | C | 비슷한 스타일 대안을 찾아 선택지를 효율적으로 좁힌다. | `aestheticMood`, `guidanceNeed` | Natural | B | None |
| 3 | B | 한 사람이 먼저 핵심 기준을 정리한 뒤 최종 확인하는 구조가 맞다. | `roleOwnership`, `coPreparation` | Obvious | C | None |
| 4 | A | 알아본 사람이 장단점과 확인할 점을 짧게 정리한다. | `roleOwnership`, `evidenceDecision` | Obvious | D | None |
| 5 | A | 계약 전 확인해야 할 약속은 담당자가 문서로 남기게 한다. | `evidenceDecision`, `decisionPaceRisk` | Natural | D | None |
| 6 | B | venue 후보도 실제 조건을 함께 확인해야 비교가 가능하다. | `costRisk`, `familyIntegration` | Natural | D | None |
| 7 | B | 분위기와 하객 편의를 표로 정리해 비교하는 방식이 맞다. | `familyIntegration`, `aestheticMood`, `evidenceDecision` | Natural | C | None |
| 8 | B | 부모님께 보여드릴 숫자와 이유를 정리하는 담당 작업이 필요하다. | `evidenceDecision`, `costRisk` | Natural | D | None |
| 9 | C | 해결책과 다음 행동이 바로 정리되는 것이 괜찮다. | `executionSupport` | Obvious | B | None |
| 10 | A | 담당자와 마감 시간별로 나눠야 일이 진행된다. | `executionSupport`, `roleOwnership` | Obvious | B | Stage only fits near wedding week. |
| 11 | C | 계약서와 총액 조건을 확인한 뒤 빠르게 결정하고 싶다. | `costRisk`, `evidenceDecision` | Natural | A | None |
| 12 | C | 업체에 다시 물어볼 문장이 있으면 다음 행동이 분명해진다. | `guidanceNeed`, `executionSupport` | Natural | A | Quote-stage only. |
| 13 | A | 예산 초과 venue는 총액과 조건을 먼저 확인한다. | `costRisk`, `evidenceDecision` | Natural | D | None |
| 14 | C | 한 사람이 후보를 압축하고 마지막 결정은 함께 하는 방식이 맞다. | `roleOwnership`, `guidanceNeed` | Obvious | A | None |
| 15 | C | 비슷한 무드이면서 후기가 더 많은 후보를 찾아 비교한다. | `guidanceNeed`, `aestheticMood`, `evidenceDecision` | Natural | A | None |
| 16 | C | 예절을 지키면서 줄일 수 있는 절차를 구분하고 실행한다. | `familyIntegration`, `executionSupport` | Natural | D | May depend on family custom complexity. |

### 3.5 Evidence-Decision Focused User

| Field | Description |
|---|---|
| Persona name | 근거 확인형 |
| Assumed tendency | 리뷰, 실제 사례, 서면 조건, 비교 자료가 있어야 결정이 편해진다. |
| Likely wedding stage | `sdm_search`, `contract_pending` |
| Likely concerns | 근거 부족, 구두 약속, 후기 부족, 비교 불가능한 견적 |
| Expected product needs | 후기 요약, `/check`, 계약 전 조건 비교, Amora 확인 질문 |

| Q | Selected option | Reason for selection | Construct tendencies expressed | Obvious or forced | Another plausible option | Stage-fit concern |
|---:|---|---|---|---|---|---|
| 1 | D | 비슷한 구성을 이용한 실제 후기와 사례를 더 확인한다. | `evidenceDecision`, `guidanceNeed` | Obvious | A | None |
| 2 | B | 추가 비용을 전체 예산 안에서 먼저 계산한다. | `costRisk`, `evidenceDecision` | Natural | C | None |
| 3 | C | 계약 전에 둘 다 봐야 할 자료를 모은다. | `evidenceDecision`, `costRisk` | Obvious | A | None |
| 4 | B | 둘이 같은 계약서와 견적 항목을 보며 확인한다. | `coPreparation`, `evidenceDecision` | Natural | D | None |
| 5 | A | 약속을 계약서나 메시지로 남겨달라고 요청한다. | `evidenceDecision`, `decisionPaceRisk` | Obvious | D | None |
| 6 | B | 분위기와 별개로 식대, 보증 인원, 교통 조건도 확인한다. | `costRisk`, `familyIntegration` | Natural | C | None |
| 7 | B | 분위기와 하객 편의를 비교표로 확인한다. | `familyIntegration`, `aestheticMood`, `evidenceDecision` | Natural | C | None |
| 8 | B | 숫자와 이유가 있으면 가족 설명이 더 명확해진다. | `evidenceDecision`, `costRisk` | Natural | A | None |
| 9 | C | 바로 다음 행동을 정리해주는 것도 괜찮다. | `executionSupport` | Slightly forced | B | None |
| 10 | B | 전체 체크리스트가 있으면 누락을 줄일 수 있다. | `executionSupport`, `guidanceNeed` | Natural | A | Wedding-week scenario may be hypothetical. |
| 11 | C | 계약서, 총액, 취소 조건 확인 후 결정한다. | `costRisk`, `evidenceDecision` | Obvious | A | None |
| 12 | A | 꼭 확인해야 할 항목과 질문 요약이 가장 유용하다. | `guidanceNeed`, `evidenceDecision` | Natural | B | Harder before quote exposure. |
| 13 | A | 총액, 추가금, 환불 조건이 첫 확인 대상이다. | `costRisk`, `evidenceDecision` | Obvious | D | None |
| 14 | D | 스타일과 조건을 함께 볼 수 있는 체크리스트가 근거를 만든다. | `executionSupport`, `evidenceDecision`, `aestheticMood` | Natural | A | None |
| 15 | A | 실제 이용 사례, 후기, 포함 조건을 더 확인한다. | `evidenceDecision`, `costRisk` | Obvious | C | None |
| 16 | D | 간소화의 효과를 예산, 시간, 진행 흐름 자료로 설명한다. | `costRisk`, `evidenceDecision`, `coupleAutonomy` | Natural | B | Early-stage users may not know tradition details. |

### 3.6 Aesthetic-Mood Focused User

| Field | Description |
|---|---|
| Persona name | 무드 취향 중시형 |
| Assumed tendency | visual fit, tone, light, portfolio, first impression이 선택의 출발점이다. |
| Likely wedding stage | `venue_search`, `sdm_search` |
| Likely concerns | 마음에 드는 분위기를 예산과 가족 기준 사이에서 잃지 않는 것 |
| Expected product needs | 웨딩 라운지, 무드 키워드 정리, 포트폴리오 비교, Amora 후보 정리 |

| Q | Selected option | Reason for selection | Construct tendencies expressed | Obvious or forced | Another plausible option | Stage-fit concern |
|---:|---|---|---|---|---|---|
| 1 | B | 촬영 결과와 분위기 적합성을 먼저 본다. | `aestheticMood`, `experienceMeaning` | Obvious | D | None |
| 2 | C | 비슷한 느낌의 다른 의상이나 촬영 스타일도 찾는다. | `aestheticMood`, `guidanceNeed` | Natural | A | None |
| 3 | A | 마음에 든 이유를 공유하며 무드 선호를 확인한다. | `coPreparation`, `experienceMeaning` | Natural | B | None |
| 4 | C | 한 사람은 조건을, 한 사람은 분위기와 만족도를 확인하는 분담이 맞다. | `roleOwnership`, `aestheticMood`, `costRisk` | Natural | B | None |
| 5 | C | 서비스 약속보다 전체 업체 fit과 분위기 적합성을 다시 본다. | `experienceMeaning`, `aestheticMood` | Natural | A | None |
| 6 | C | 사진과 조명에서 그 분위기가 잘 남을지 확인한다. | `aestheticMood`, `experienceMeaning` | Obvious | A | None |
| 7 | B | 분위기와 하객 편의를 한 표에서 같이 비교한다. | `familyIntegration`, `aestheticMood`, `evidenceDecision` | Natural | D | None |
| 8 | D | 커플 기준을 부드럽게 전달할 문장이 있으면 분위기를 지킬 수 있다. | `guidanceNeed`, `coupleAutonomy` | Slightly forced | A | Early stage fits better than contracted stage. |
| 9 | B | 공감과 선택지 정리를 함께 받으면 무드 선택의 불안을 줄일 수 있다. | `emotionalSupport`, `executionSupport` | Natural | A | None |
| 10 | C | 가족과 업체에 보낼 안내 문장이 분위기와 진행을 정돈한다. | `familyIntegration`, `roleOwnership` | Somewhat forced | D | Wedding-week only. |
| 11 | D | 다른 후보와 분위기와 조건을 한 번 더 비교한다. | `aestheticMood`, `guidanceNeed` | Obvious | B | None |
| 12 | D | 상대에게 공유할 쉬운 요약본이 있으면 무드 기준도 설명할 수 있다. | `coPreparation`, `guidanceNeed` | Natural | A | Quote-stage only. |
| 13 | B | 예산보다 이 장소가 오래 남을 경험인지 먼저 생각한다. | `experienceMeaning`, `aestheticMood` | Obvious | D | None |
| 14 | D | 스타일과 조건을 함께 볼 수 있는 체크리스트가 visual 기준을 보존한다. | `executionSupport`, `evidenceDecision`, `aestheticMood` | Natural | A | None |
| 15 | B | 포트폴리오가 원하는 무드와 얼마나 맞는지 다시 본다. | `aestheticMood`, `experienceMeaning` | Obvious | C | None |
| 16 | A | 간소화가 둘에게 어떤 의미로 남을지 먼저 정리한다. | `coupleAutonomy`, `experienceMeaning` | Natural | B | May be less relevant before family discussion. |

### 3.7 Family-Integration Focused User

| Field | Description |
|---|---|
| Persona name | 가족 조율 중시형 |
| Assumed tendency | 부모님, 하객, 음식, 교통, 예절, 양가 조율을 결정 기준에 적극 포함한다. |
| Likely wedding stage | `venue_search`, `marriage_discussion` |
| Likely concerns | 부모님 의견과 커플 취향 사이의 설명, 하객 만족, 예절 갈등 |
| Expected product needs | etiquette guide, 가족 설명 문장, 하객 편의 체크리스트, Amora 조율 대화 |

| Q | Selected option | Reason for selection | Construct tendencies expressed | Obvious or forced | Another plausible option | Stage-fit concern |
|---:|---|---|---|---|---|---|
| 1 | C | 상대와 꼭 필요한 항목을 나눠 family-facing 선택도 정리한다. | `coPreparation`, `coupleAutonomy` | Slightly forced | D | None |
| 2 | D | 오래 남길 장면을 상대와 먼저 이야기해 가족 설명 기준도 만든다. | `coPreparation`, `experienceMeaning` | Natural | B | None |
| 3 | A | 업체 선택 이유를 상대와 공유해 공동 설명이 가능하게 한다. | `coPreparation`, `experienceMeaning` | Natural | C | None |
| 4 | B | 둘이 같은 계약서와 견적을 보며 가족에게도 설명 가능한 상태를 만든다. | `coPreparation`, `evidenceDecision` | Natural | A | None |
| 5 | B | 추가 서비스가 실제로 필요한 혜택인지 따져본다. | `costRisk`, `coupleAutonomy` | Natural | A | None |
| 6 | D | 상대와 가족이 중요하게 보는 기준도 같이 맞춰본다. | `coPreparation`, `familyIntegration` | Obvious | B | None |
| 7 | A | 부모님이 걱정하는 음식과 교통 기준을 먼저 구체적으로 듣는다. | `familyIntegration`, `emotionalSupport` | Obvious | B | None |
| 8 | C | 부모님이 걱정할 부분을 예상하고 대화 순서를 정한다. | `familyIntegration`, `emotionalSupport` | Obvious | B | None |
| 9 | B | 걱정에는 공감이 필요하지만 선택지 정리도 도움이 된다. | `emotionalSupport`, `executionSupport` | Natural | D | None |
| 10 | C | 가족과 업체에 보낼 안내 문장을 먼저 정리한다. | `familyIntegration`, `roleOwnership` | Obvious | A | Wedding-week only. |
| 11 | B | 마음에 든 이유와 걱정되는 점을 상대와 같이 적어 조율한다. | `coPreparation`, `emotionalSupport` | Natural | C | None |
| 12 | D | 상대에게 공유할 쉬운 요약본이 가족 설명에도 도움이 된다. | `coPreparation`, `guidanceNeed` | Natural | A | Quote-stage only. |
| 13 | C | 부모님과 하객의 이동, 식사, 동선을 함께 고려한다. | `familyIntegration` | Obvious | A | None |
| 14 | B | 중요한 후보는 둘이 모두 보고 가족 기준까지 같이 정한다. | `coPreparation` | Natural | A | None |
| 15 | D | 정보 부족을 어디까지 괜찮게 볼지 상대와 이야기한다. | `coPreparation`, `decisionPaceRisk` | Natural | A | None |
| 16 | B | 가족이 걱정할 지점을 예상하고 설명 방식을 준비한다. | `familyIntegration`, `emotionalSupport` | Obvious | C | None |

### 3.8 Couple-Autonomy Focused User

| Field | Description |
|---|---|
| Persona name | 커플 기준 중시형 |
| Assumed tendency | 외부 기대보다 둘의 예산, 하객수, 진행 방식, 생활 기준을 먼저 맞춘다. |
| Likely wedding stage | `marriage_discussion`, `preparing_without_date` |
| Likely concerns | 부모님 기대와 둘의 기준 충돌, 작은 결혼식, 절차 간소화 |
| Expected product needs | couple report, 커플 기준 합의서, 가족 설명 문장, etiquette checklist |

| Q | Selected option | Reason for selection | Construct tendencies expressed | Obvious or forced | Another plausible option | Stage-fit concern |
|---:|---|---|---|---|---|---|
| 1 | C | 꼭 필요한 항목과 조정 가능한 항목을 둘의 기준으로 나눈다. | `coPreparation`, `coupleAutonomy` | Natural | A | SDM scenario may be later than persona stage. |
| 2 | D | 어떤 장면을 오래 남기고 싶은지 상대와 먼저 이야기한다. | `coPreparation`, `experienceMeaning` | Natural | A | None |
| 3 | A | 상담 내용과 이유를 공유해 둘의 기준을 맞춘다. | `coPreparation`, `experienceMeaning` | Natural | B | Contract-pending scenario may be later. |
| 4 | B | 계약 전 둘이 같은 계약서와 견적을 함께 확인한다. | `coPreparation`, `evidenceDecision` | Natural | A | Contract stage may be later. |
| 5 | B | 추가 서비스가 우리 기준에 실제로 필요한지 따져본다. | `costRisk`, `coupleAutonomy` | Natural | A | Contract stage may be later. |
| 6 | A | 우리가 원하는 분위기와 얼마나 맞는지 먼저 정리한다. | `aestheticMood`, `experienceMeaning` | Natural | D | Venue stage may be later. |
| 7 | D | 우리 기준을 정리한 뒤 부모님께 설명할 절충안을 준비한다. | `coupleAutonomy`, `familyIntegration` | Obvious | B | None |
| 8 | A | 부모님께 말하기 전 둘이 예산, 하객수, 진행 기준을 맞춘다. | `coupleAutonomy`, `coPreparation` | Obvious | D | None |
| 9 | D | support preference도 상대와 직접 이야기하고 싶다. | `coPreparation`, `emotionalSupport` | Natural | B | None |
| 10 | D | 서로 부담되는 부분을 이야기한 뒤 일을 나눈다. | `emotionalSupport`, `coPreparation`, `executionSupport` | Natural | A | Wedding-week scenario likely too late. |
| 11 | B | 들뜬 마음과 걱정되는 점을 둘이 같이 적는다. | `coPreparation`, `emotionalSupport` | Natural | A | Venue stage may be later. |
| 12 | D | 견적을 둘이 공유할 수 있는 쉬운 요약본이 필요하다. | `coPreparation`, `guidanceNeed` | Natural | A | Quote-stage may be later. |
| 13 | D | 예산과 만족감 기준을 상대와 다시 맞춘다. | `coPreparation`, `coupleAutonomy` | Obvious | A | Venue stage may be later. |
| 14 | A | 각자 잘 보는 기준을 맡고 결과를 서로 공유한다. | `roleOwnership`, `coPreparation` | Natural | B | None |
| 15 | D | 정보 부족을 어디까지 괜찮게 볼지 둘이 이야기한다. | `coPreparation`, `decisionPaceRisk` | Natural | C | SDM stage may be later. |
| 16 | A | 간소화하고 싶은 이유와 둘의 기준을 먼저 정리한다. | `coupleAutonomy`, `experienceMeaning` | Obvious | B | None |

### 3.9 Emotional-Support Focused User

| Field | Description |
|---|---|
| Persona name | 공감 먼저 필요형 |
| Assumed tendency | 해결책 전에 걱정과 의미를 먼저 이해받아야 다음 행동으로 넘어가기 쉽다. |
| Likely wedding stage | `contract_pending`, `venue_search` |
| Likely concerns | 빠른 해결책 제안이 정서적으로 건너뛰는 느낌, 상대와의 대화 순서 |
| Expected product needs | Amora 공감 우선 응답, couple conversation tip, support preference 대화 |

| Q | Selected option | Reason for selection | Construct tendencies expressed | Obvious or forced | Another plausible option | Stage-fit concern |
|---:|---|---|---|---|---|---|
| 1 | C | 비용 조정도 상대와 필요한 항목을 나누며 이야기하고 싶다. | `coPreparation`, `coupleAutonomy` | Natural | D | None |
| 2 | D | 오래 남길 장면을 상대와 이야기하며 감정적 의미를 확인한다. | `coPreparation`, `experienceMeaning` | Natural | A | None |
| 3 | D | 바로 결정하지 않고 상대가 볼 시간을 확보하는 것이 안정적이다. | `decisionPaceRisk`, `emotionalSupport` | Natural | A | None |
| 4 | B | 둘이 같은 계약서와 견적을 보며 함께 불안을 줄인다. | `coPreparation`, `evidenceDecision` | Natural | D | None |
| 5 | D | 문서 확인 전 계약 속도를 늦추면 불안이 줄어든다. | `decisionPaceRisk`, `evidenceDecision` | Natural | A | None |
| 6 | D | 상대와 가족 기준을 같이 맞춰야 마음이 편하다. | `coPreparation`, `familyIntegration` | Natural | A | None |
| 7 | A | 부모님 걱정을 먼저 들어야 대화가 안전해진다. | `familyIntegration`, `emotionalSupport` | Obvious | D | None |
| 8 | C | 부모님 걱정과 대화 순서를 예상하는 것이 중요하다. | `familyIntegration`, `emotionalSupport` | Natural | D | None |
| 9 | A | 해결책 전에 왜 걱정되는지 먼저 들어주면 좋겠다. | `emotionalSupport` | Obvious | B | None |
| 10 | D | 서로 부담되는 부분을 이야기한 뒤 일을 나누고 싶다. | `emotionalSupport`, `coPreparation`, `executionSupport` | Obvious | B | Wedding-week only. |
| 11 | B | 마음에 든 이유와 걱정되는 점을 같이 적으며 정서적 속도를 맞춘다. | `coPreparation`, `emotionalSupport` | Obvious | A | None |
| 12 | D | 쉬운 요약본을 상대와 공유하며 같이 이해하고 싶다. | `coPreparation`, `guidanceNeed` | Natural | A | Quote-stage only. |
| 13 | D | 예산과 만족감 기준을 상대와 다시 맞추는 과정이 필요하다. | `coPreparation`, `coupleAutonomy` | Natural | B | None |
| 14 | B | 중요한 후보는 둘이 모두 보고 같이 정해야 마음이 편하다. | `coPreparation` | Natural | A | None |
| 15 | D | 정보 부족을 어느 정도까지 괜찮게 볼지 상대와 이야기한다. | `coPreparation`, `decisionPaceRisk` | Natural | A | None |
| 16 | B | 가족 걱정을 예상하고 설명 방식을 준비해야 정서적 부담이 줄어든다. | `familyIntegration`, `emotionalSupport` | Natural | A | May be abstract if family is not involved yet. |

### 3.10 Execution-Support Focused User

| Field | Description |
|---|---|
| Persona name | 실행 지원 선호형 |
| Assumed tendency | 다음 행동, 담당자, 마감, 체크리스트가 명확해질 때 안정된다. |
| Likely wedding stage | `contracted`, `wedding_week` |
| Likely concerns | 할 일이 쌓이는 것, 말만 길어지고 결정이 안 나는 것, 누락 |
| Expected product needs | checklist, action card, owner and deadline assignment, Amora next-step summary |

| Q | Selected option | Reason for selection | Construct tendencies expressed | Obvious or forced | Another plausible option | Stage-fit concern |
|---:|---|---|---|---|---|---|
| 1 | A | 포함, 불포함, 추가 비용을 항목별로 확인해야 다음 행동이 생긴다. | `costRisk`, `evidenceDecision` | Natural | D | None |
| 2 | B | 추가 비용 계산이 끝나야 다음 선택으로 넘어갈 수 있다. | `costRisk`, `evidenceDecision` | Natural | C | None |
| 3 | B | 핵심 기준을 먼저 정리한 뒤 상대와 최종 확인한다. | `roleOwnership`, `coPreparation` | Natural | C | None |
| 4 | D | 계약 전 체크리스트로 마지막 점검을 해야 한다. | `executionSupport`, `decisionPaceRisk` | Obvious | A | None |
| 5 | A | 문서로 남겨달라고 요청하는 것이 가장 실행 가능한 다음 행동이다. | `evidenceDecision`, `decisionPaceRisk` | Natural | D | None |
| 6 | B | 식대, 보증 인원, 교통 같은 실제 조건을 확인한다. | `costRisk`, `familyIntegration` | Natural | D | None |
| 7 | C | 예산과 보증 인원을 포함해 현실적 차이를 확인한다. | `costRisk`, `evidenceDecision` | Natural | B | None |
| 8 | D | 부모님께 전달할 문장을 먼저 만들면 바로 실행할 수 있다. | `guidanceNeed`, `coupleAutonomy` | Natural | B | None |
| 9 | C | 바로 다음 행동을 정리해주는 것도 괜찮다. | `executionSupport` | Obvious | B | None |
| 10 | A | 해야 할 일을 담당자와 마감 시간별로 나누는 게 먼저다. | `executionSupport`, `roleOwnership` | Obvious | B | None |
| 11 | A | 하루 정도 시간을 두고 다시 확인하는 규칙이 실행 가능하다. | `decisionPaceRisk` | Natural | C | None |
| 12 | C | 업체에 다시 물어볼 문장이 있으면 바로 행동할 수 있다. | `guidanceNeed`, `executionSupport` | Obvious | A | Quote-stage only. |
| 13 | A | 총액, 추가금, 환불 조건을 확인하면 다음 판단이 가능하다. | `costRisk`, `evidenceDecision` | Natural | D | None |
| 14 | D | 스타일과 조건을 함께 보는 체크리스트가 실행을 돕는다. | `executionSupport`, `evidenceDecision`, `aestheticMood` | Obvious | A | None |
| 15 | C | 비슷한 무드이면서 후기가 많은 후보를 찾으면 비교 행동이 생긴다. | `guidanceNeed`, `aestheticMood`, `evidenceDecision` | Natural | A | None |
| 16 | C | 예절을 지키면서 줄일 수 있는 절차를 구분하면 실행이 가능하다. | `familyIntegration`, `executionSupport` | Natural | D | None |

## 4. Question Discrimination Table

These counts are synthetic persona selections only. They are not user data and must not be treated as validation or scoring.

| Q | Question ID | Synthetic option spread | Do personas choose different options? | One option selected too often? | Likely useful for smoke test? | Recommendation |
|---:|---|---|---|---|---|---|
| 1 | `WC-Q-costRisk-005` | A2, B2, C4, D2 | Yes | C slightly high | Yes | Keep as-is |
| 2 | `WC-Q-experienceMeaning-001` | A1, B3, C2, D4 | Yes | D slightly high | Yes | Keep, monitor D |
| 3 | `WC-Q-coPreparation-003` | A5, B2, C2, D1 | Moderate | A high | Yes, but A may look safest | Rewrite option A or B |
| 4 | `WC-Q-roleOwnership-006` | A1, B5, C2, D2 | Moderate | B high | Yes, but B may look safest | Rewrite option A or B |
| 5 | `WC-Q-evidenceDecision-006` | A4, B2, C2, D2 | Yes | A somewhat high | Yes | Keep as-is |
| 6 | `WC-Q-aestheticMood-002` | A2, B4, C1, D3 | Yes | B somewhat high | Yes | Keep, monitor C underuse |
| 7 | `WC-Q-familyIntegration-002` | A2, B4, C2, D2 | Yes | B somewhat high | Yes | Keep as-is |
| 8 | `WC-Q-coupleAutonomy-004` | A3, B3, C2, D2 | Yes | No | Yes | Keep as-is |
| 9 | `WC-Q-emotionalSupport-002` | A1, B4, C3, D2 | Yes | B somewhat high | Yes | Rewrite option B if it feels too ideal |
| 10 | `WC-Q-executionSupport-006` | A2, B2, C2, D4 | Yes | D somewhat high | Yes for later-stage users | Keep, rotate for early-stage users |
| 11 | `WC-Q-decisionPaceRisk-004` | A1, B4, C3, D2 | Yes | B somewhat high | Yes | Keep, monitor B |
| 12 | `WC-Q-guidanceNeed-005` | A2, B1, C2, D5 | Moderate | D high | Yes, but partner-share may dominate | Rewrite option D or rotate |
| 13 | `WC-Q-costRisk-001` | A4, B2, C1, D3 | Yes | A somewhat high | Yes | Keep as optional boundary |
| 14 | `WC-Q-roleOwnership-003` | A2, B3, C1, D4 | Yes | D somewhat high, C low | Yes | Rewrite option C or D |
| 15 | `WC-Q-evidenceDecision-001` | A2, B2, C2, D4 | Yes | D somewhat high | Yes | Keep, monitor D |
| 16 | `WC-Q-coupleAutonomy-002` | A3, B3, C2, D2 | Yes | No | Yes | Keep as optional boundary |

## 5. Low-Discrimination Questions

These questions may still be useful, but they should be checked during expert review because the synthetic personas clustered around one option.

| Question ID | Pattern | Concern | Suggested action |
|---|---|---|---|
| `WC-Q-coPreparation-003` | Option A selected by 5 of 10 synthetic personas. | Sharing consultation details may look like the most caring or correct option. | Sharpen option B as an equally valid role-owner flow or make A less universally safe. |
| `WC-Q-roleOwnership-006` | Option B selected by 5 of 10 synthetic personas. | Jointly viewing contract and quote may look like the responsible default. | Make A and D feel equally valid by clarifying delegated summary and checklist benefits. |
| `WC-Q-guidanceNeed-005` | Option D selected by 5 of 10 synthetic personas. | Partner-share summary is broadly appealing across personas. | Clarify D as specifically partner-sharing, not general clarity; keep A for summary priority. |
| `WC-Q-roleOwnership-003` | Option C selected by only 1 of 10 synthetic personas. | One-person shortlisting may feel less appealing than role sharing or checklist. | Rewrite C to emphasize transparent shortlist criteria and final joint decision. |

## 6. Ambiguous Option Pairs

| Question ID | Ambiguous pair | Why it may blur | Recommendation |
|---|---|---|---|
| `WC-Q-coPreparation-003` | A and B | Both involve one person explaining information before joint confirmation. | Make A about emotional/shared readiness and B about efficient owner-led summary. |
| `WC-Q-roleOwnership-006` | A and B | Both are pre-contract confirmation formats. | Make A owner-led, B truly joint-review, and D risk checklist more distinct. |
| `WC-Q-evidenceDecision-006` | A and D | Written confirmation and slowing contract speed can feel like the same evidence-safety response. | Keep A as action request, D as timing control. |
| `WC-Q-aestheticMood-002` | A and C | Both are mood-preservation choices. | Keep A as overall fit, C as photo/light output quality. |
| `WC-Q-coupleAutonomy-004` | B and D | Both prepare parent-facing explanation. | Keep B as numbers/reasons, D as wording/tone support. |
| `WC-Q-executionSupport-006` | A and B | Owners/deadlines and checklist are both execution support. | Keep A as responsibility map, B as completeness map. |
| `WC-Q-guidanceNeed-005` | A and C | Summary questions and vendor-message wording both express guidance need. | Keep A as what to check, C as how to ask. |
| `WC-Q-roleOwnership-003` | A and C | Both include one-person ownership plus sharing. | Make C about shortlist compression under time pressure. |
| `WC-Q-evidenceDecision-001` | A and C | Checking evidence and finding more-reviewed alternatives both reduce evidence risk. | Keep A as verify current vendor, C as broaden candidate set. |

## 7. Stage-Fit Risks

| Question ID | Stage-fit risk | Recommended handling |
|---|---|---|
| `WC-Q-executionSupport-006` | Wedding-week logistics may feel distant for `dating_or_meeting`, `marriage_discussion`, or early `venue_search` users. | Keep as required only if the test uses "가정하면" clearly; otherwise rotate for later-stage cohorts. |
| `WC-Q-guidanceNeed-005` | Quote-sheet language may be hard for users who have not received any quote. | Keep "견적서를 받았다고 가정하면" and offer a short description of quote complexity if needed. |
| `WC-Q-evidenceDecision-006` | Contract wording may be premature for early-stage users. | Keep because it is product-relevant, but analyze confusion by participant stage. |
| `WC-Q-roleOwnership-006` | Final confirmation before contract may be harder before real vendor shortlisting. | Keep in smoke test, but check early-stage confusion. |
| `WC-Q-coupleAutonomy-002` | Tradition simplification may feel abstract before family expectations emerge. | Keep as optional boundary or ask only after context indicates family involvement. |
| `WC-Q-costRisk-001` | Venue over-budget scenario fits venue search and contract pending, but less so for dating or post-wedding users. | Keep as optional boundary and analyze by stage. |

## 8. Bias And Stigma Risk Check

| Risk area | Synthetic finding | Related questions | Recommended check |
|---|---|---|---|
| Money-shaming | Cost-first options remained valid, but could seem "responsible default" in cost and contract scenarios. | `WC-Q-costRisk-005`, `WC-Q-costRisk-001`, `WC-Q-guidanceNeed-005` | Keep copy focused on contract safety and readiness, not frugality. |
| Emotion-shaming | Emotion-first persona did not select "bad" options, but option B in emotional-support item may look too balanced. | `WC-Q-emotionalSupport-002`, `WC-Q-decisionPaceRisk-004` | Ensure empathy need is not framed as weakness and execution need is not framed as coldness. |
| Family-blaming | Family-integration options stayed neutral, but parent-focused scenarios can still imply family pressure. | `WC-Q-familyIntegration-002`, `WC-Q-coupleAutonomy-004`, `WC-Q-coupleAutonomy-002` | Keep family as coordination context, not obstacle. |
| Partner-blaming | Co-preparation items could imply the partner has not participated enough. | `WC-Q-coPreparation-003`, `WC-Q-emotionalSupport-002`, `WC-Q-guidanceNeed-005` | Avoid wording that blames one partner for not caring. |
| Autonomy-shaming | Couple-autonomy options did not read as anti-family, but family scenarios need care. | `WC-Q-coupleAutonomy-004`, `WC-Q-coupleAutonomy-002` | Frame autonomy as criteria-setting plus respectful explanation. |
| Gender/role stereotype | Role division stayed non-gendered, but style-versus-condition split is sensitive. | `WC-Q-roleOwnership-006`, `WC-Q-roleOwnership-003`, `WC-Q-executionSupport-006` | Do not add bride/groom assumptions in form copy or examples. |
| Too-desirable option bias | Shared review, written confirmation, checklist, and partner-share summary often feel broadly attractive. | All, especially `WC-Q-roleOwnership-006`, `WC-Q-guidanceNeed-005` | Expert reviewers should flag any option that feels like the "right answer." |

## 9. Construct Coverage Check

All 12 constructs are meaningfully represented in the synthetic matrix.

| Construct | Representation check |
|---|---|
| `costRisk` | Appears strongly in cost-focused, evidence-focused, and execution-focused patterns without making cost-first the only valid path. |
| `experienceMeaning` | Appears in memory, mood, and couple conversation choices across experience and aesthetic personas. |
| `coPreparation` | Appears broadly; it may be over-attractive because shared review often feels safe. |
| `roleOwnership` | Appears in owner-summary, shortlist, and task-deadline choices, but option C in `WC-Q-roleOwnership-003` needs strengthening. |
| `evidenceDecision` | Appears in written confirmation, reviews, contract terms, and comparison tables. |
| `aestheticMood` | Appears in venue mood, portfolio fit, photo/light, and meaningful experience choices. |
| `familyIntegration` | Appears in parent concerns, guest convenience, food, transport, etiquette, and family explanation. |
| `coupleAutonomy` | Appears in couple criteria, simplification, budget and satisfaction alignment, and respectful explanation. |
| `emotionalSupport` | Appears as internal support sequencing, not a public identity label. |
| `executionSupport` | Appears as internal need for owners, deadlines, checklists, and next actions. |
| `decisionPaceRisk` | Appears as pause rule and contract-speed support, not an impulsiveness label. |
| `guidanceNeed` | Appears as summary, question wording, partner-share, and candidate compression support. |

## 10. Recommendation For v0.3

| Recommendation | Items |
|---|---|
| Keep as-is | `WC-Q-costRisk-005`, `WC-Q-evidenceDecision-006`, `WC-Q-aestheticMood-002`, `WC-Q-familyIntegration-002`, `WC-Q-coupleAutonomy-004`, `WC-Q-executionSupport-006`, `WC-Q-costRisk-001`, `WC-Q-evidenceDecision-001`, `WC-Q-coupleAutonomy-002` |
| Rewrite option | `WC-Q-coPreparation-003` A or B, `WC-Q-roleOwnership-006` A or B, `WC-Q-emotionalSupport-002` B, `WC-Q-guidanceNeed-005` D, `WC-Q-roleOwnership-003` C |
| Rewrite question | None required before expert review based on this synthetic pass. |
| Rotate as optional | `WC-Q-executionSupport-006`, `WC-Q-guidanceNeed-005`, `WC-Q-coupleAutonomy-002` for early-stage cohorts if stage confusion appears. |
| Remove before smoke test | None recommended from synthetic review alone. |

## 11. WC-010 AI Red-Team Readiness

WC-010 AI red-team can start after this document is reviewed.

WC-010 should focus on:

- Whether any option can be misread as a moral judgment.
- Whether synthetic personas reveal hidden "right answer" framing.
- Whether early-stage users might feel excluded by quote, contract, or wedding-week scenarios.
- Whether family-related items can be misread as parent-blaming or autonomy-shaming.
- Whether internal UX/risk constructs remain internal and do not become public identity labels.

WC-010 should still avoid scoring, numeric weights, final public codes, final 16 types, characters, couple combination names, UI, routes, database work, and Amora prompt changes.
