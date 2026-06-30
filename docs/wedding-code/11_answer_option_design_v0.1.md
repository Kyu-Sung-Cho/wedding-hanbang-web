# WeddingCode Answer Option Design v0.1

## 1. Scope

This document designs neutral Korean answer options for the 16 WeddingCode smoke-test questions in `07_smoke_test_shortlist_v0.2.md`.

It does not define final scoring, numeric weights, public labels, final public 4-letter codes, final 16 types, characters, couple combination names, UI, database schema, routes, or Amora behavior.

The option-to-construct and product-routing notes are draft hypotheses for future validation only. They must not be implemented as scoring logic.

## 2. Answer Option Design Rules

- Answer choices should represent different valid wedding-preparation approaches.
- No choice should look like the correct, smarter, more loving, or morally superior answer.
- Each choice may indicate one or more construct tendencies.
- Product routing may be noted, but it must not be implemented in this task.
- Future scoring notes must be marked as `hypothesis only`.
- Avoid gender assumptions about bride, groom, partner, family communication, money, style, or task ownership.
- Avoid shame labels around money, emotion, family, autonomy, execution, guidance, or decision speed.
- Keep `emotionalSupport`, `executionSupport`, `decisionPaceRisk`, and `guidanceNeed` as internal UX/risk constructs.
- Keep `familyIntegration` and `coupleAutonomy` separate unless future user data supports combining them.

## 3. Answer Option Designs For 16 Questions

### 3.1 `WC-Q-costRisk-005`

- Question ID: `WC-Q-costRisk-005`
- Target construct: `costRisk`
- Secondary constructs: `evidenceDecision`
- Journey stage: `sdm_search`, `contract_pending`
- Question text: 스튜디오 패키지가 좋아 보이지만 원본, 보정, 헬퍼, 얼리스타트 비용이 분명하지 않습니다. 가장 먼저 할 일은 무엇인가요?

| Option | Korean option text | Construct tendencies it may indicate | Product action it may route to | Bias/stigma risk note |
|---|---|---|---|---|
| A | 포함·불포함 항목과 추가 비용을 항목별로 먼저 확인한다. | `costRisk`, `evidenceDecision` | `/check` 견적 항목 확인, Amora 질문 리스트 | 비용 확인을 의심 많음이나 인색함으로 표현하지 않는다. |
| B | 포트폴리오와 촬영 결과가 우리가 원하는 분위기와 맞는지 더 본다. | `aestheticMood`, `experienceMeaning` | 웨딩 라운지 무드 비교, 스튜디오 후보 비교 | 무드 중시를 비합리적 선택으로 보이게 하지 않는다. |
| C | 상대와 촬영에서 꼭 필요한 항목과 조정 가능한 항목을 나눈다. | `coPreparation`, `coupleAutonomy` | 커플 기준 정리, 체크리스트 | 상대 확인을 허락받기처럼 보이게 하지 않는다. |
| D | 비슷한 구성을 이용한 실제 후기나 사례를 더 확인한다. | `evidenceDecision`, `guidanceNeed` | 후기 요약, 실제 사례 요청 문장 | 후기 확인을 더 우월한 판단 방식으로 표현하지 않는다. |

Answer options to avoid:

- "괜히 의심하지 말고 계약한다."
- "현실적으로 싼 곳을 고른다."
- "사진이 예쁘면 비용은 신경 쓰지 않는다."

Future scoring note: hypothesis only; do not implement scoring yet.

### 3.2 `WC-Q-experienceMeaning-001`

- Question ID: `WC-Q-experienceMeaning-001`
- Target construct: `experienceMeaning`
- Secondary constructs: `costRisk`
- Journey stage: `sdm_search`
- Question text: 본식 의상이나 촬영 스타일 중 하나가 오래 기억에 남을 것 같지만 추가 비용이 있습니다. 무엇을 먼저 생각하나요?

| Option | Korean option text | Construct tendencies it may indicate | Product action it may route to | Bias/stigma risk note |
|---|---|---|---|---|
| A | 이 선택이 시간이 지나도 우리에게 의미 있게 남을지 먼저 생각한다. | `experienceMeaning` | 의미 있는 항목 정리, Amora 대화 질문 | 의미 중시를 과소비나 허영으로 표현하지 않는다. |
| B | 추가 비용이 전체 예산 안에서 감당 가능한지 먼저 계산한다. | `costRisk`, `evidenceDecision` | 예산 재조정, `/check` 추가금 확인 | 예산 확인을 만족감 포기로 보이게 하지 않는다. |
| C | 비슷한 느낌을 주는 다른 의상이나 촬영 스타일도 함께 찾아본다. | `aestheticMood`, `guidanceNeed` | 무드 후보 추천, 대안 탐색 | 대안 탐색을 우유부단함으로 표현하지 않는다. |
| D | 상대와 어떤 장면을 오래 남기고 싶은지 먼저 이야기한다. | `coPreparation`, `experienceMeaning` | 커플 대화 카드, couple report | 함께 논의를 의존적 태도로 보이게 하지 않는다. |

Answer options to avoid:

- "감정에 끌려 비싼 선택을 한다."
- "사진은 별로 중요하지 않으니 돈을 아낀다."
- "상대가 관심 없으면 혼자 정한다."

Future scoring note: hypothesis only; do not implement scoring yet.

### 3.3 `WC-Q-coPreparation-003`

- Question ID: `WC-Q-coPreparation-003`
- Target construct: `coPreparation`
- Secondary constructs: `evidenceDecision`
- Journey stage: `contract_pending`
- Question text: 상담 후 마음에 드는 업체가 생겼지만 상대는 아직 자세히 보지 못했습니다. 무엇이 먼저 필요하다고 느끼나요?

| Option | Korean option text | Construct tendencies it may indicate | Product action it may route to | Bias/stigma risk note |
|---|---|---|---|---|
| A | 상담 내용과 마음에 든 이유를 상대에게 공유하고 같이 확인한다. | `coPreparation`, `experienceMeaning` | partner invite, 상담 요약 공유 | 같이 확인하기를 허락이나 승인 요청으로 보이게 하지 않는다. |
| B | 내가 먼저 핵심 기준을 정리한 뒤 상대와 최종 확인한다. | `roleOwnership`, `coPreparation` | 담당자 요약, 최종 승인 체크 | 한 사람이 주도하는 방식을 무관심으로 해석하지 않는다. |
| C | 계약 전에 둘 다 봐야 할 견적·조건·후기 자료를 모은다. | `evidenceDecision`, `costRisk` | `/check`, 계약 전 검토 리스트 | 자료 확인을 불신이나 까다로움으로 표현하지 않는다. |
| D | 오늘 결정하지 않고 상대가 볼 시간을 먼저 확보한다. | `decisionPaceRisk`, `emotionalSupport` | pause rule, 일정 리마인드 | 보류를 소극성이나 우유부단함으로 표현하지 않는다. |

Answer options to avoid:

- "상대가 관심이 없으니 내가 다 정한다."
- "괜찮아 보이면 바로 계약한다."
- "상대에게 허락받아야 하니 기다린다."

Future scoring note: hypothesis only; do not implement scoring yet.

### 3.4 `WC-Q-roleOwnership-006`

- Question ID: `WC-Q-roleOwnership-006`
- Target construct: `roleOwnership`
- Secondary constructs: `evidenceDecision`
- Journey stage: `contract_pending`, `contracted`
- Question text: 한 사람이 업체 후보를 먼저 알아봤고, 계약 전에는 둘 다 최종 확인하려고 합니다. 어떤 방식으로 확인하는 게 가장 필요할까요?

| Option | Korean option text | Construct tendencies it may indicate | Product action it may route to | Bias/stigma risk note |
|---|---|---|---|---|
| A | 알아본 사람이 후보별 장단점과 확인할 점을 짧게 정리한다. | `roleOwnership`, `evidenceDecision` | 담당자 요약 카드, 최종 승인 체크 | 역할 주도를 무관심이나 독단으로 보이게 하지 않는다. |
| B | 둘이 같은 계약서와 견적 항목을 보며 최종 확인한다. | `coPreparation`, `evidenceDecision` | 공동 확인 체크리스트, `/check` | 공동 확인을 비효율이나 불신으로 표현하지 않는다. |
| C | 한 사람은 조건을, 한 사람은 분위기와 만족도를 나눠 확인한다. | `roleOwnership`, `aestheticMood`, `costRisk` | 역할 분담표, 후보 비교표 | 조건·분위기 역할을 성별화하지 않는다. |
| D | 빠뜨린 위험이 없는지 계약 전 체크리스트로 마지막 점검한다. | `executionSupport`, `decisionPaceRisk` | 계약 전 체크리스트, pause rule | 체크리스트 선호를 불안함으로 표현하지 않는다. |

Answer options to avoid:

- "잘 아는 사람이 그냥 결정한다."
- "둘이 다 봐야 하니 시간이 오래 걸려도 상관없다."
- "스타일은 한쪽, 돈은 다른 쪽이 맡는다."

Future scoring note: hypothesis only; do not implement scoring yet.

### 3.5 `WC-Q-evidenceDecision-006`

- Question ID: `WC-Q-evidenceDecision-006`
- Target construct: `evidenceDecision`
- Secondary constructs: `decisionPaceRisk`
- Journey stage: `contract_pending`
- Question text: 상담 중 서비스 추가를 약속받았지만 계약서에는 아직 없습니다. 다음 행동으로 가장 가까운 것은 무엇인가요?

| Option | Korean option text | Construct tendencies it may indicate | Product action it may route to | Bias/stigma risk note |
|---|---|---|---|---|
| A | 약속받은 내용을 계약서나 메시지로 남겨달라고 요청한다. | `evidenceDecision`, `decisionPaceRisk` | 서면 확인 요청 문장, `/check` | 기록 요청을 업체 불신으로 보이게 하지 않는다. |
| B | 추가 서비스가 실제로 우리에게 필요한 혜택인지 따져본다. | `costRisk`, `coupleAutonomy` | 혜택 가치 비교, 우선순위 정리 | 실속 판단을 계산적 태도로 표현하지 않는다. |
| C | 그 약속이 없어도 이 업체가 우리 기준에 맞는지 다시 본다. | `experienceMeaning`, `aestheticMood` | 후보 적합도 점검, Amora 비교 질문 | 전체 fit 판단을 감으로만 정하는 것처럼 쓰지 않는다. |
| D | 문서로 확인되기 전에는 계약 속도를 조금 늦춘다. | `decisionPaceRisk`, `evidenceDecision` | pause rule, 계약 보류 체크 | 속도 조절을 겁이 많음이나 충동 억제로 표현하지 않는다. |

Answer options to avoid:

- "상담자가 말했으니 믿고 넘어간다."
- "문서로 안 남기면 무조건 나쁜 업체다."
- "혜택이 크면 바로 계약한다."

Future scoring note: hypothesis only; do not implement scoring yet.

### 3.6 `WC-Q-aestheticMood-002`

- Question ID: `WC-Q-aestheticMood-002`
- Target construct: `aestheticMood`
- Secondary constructs: `familyIntegration`
- Journey stage: `venue_search`
- Question text: 투어 중 한 홀에 들어갔을 때 분위기가 우리와 잘 맞는다고 느꼈습니다. 무엇을 먼저 확인하고 싶나요?

| Option | Korean option text | Construct tendencies it may indicate | Product action it may route to | Bias/stigma risk note |
|---|---|---|---|---|
| A | 우리가 원하던 분위기와 얼마나 잘 맞는지 먼저 정리한다. | `aestheticMood`, `experienceMeaning` | 무드 키워드 정리, 웨딩 라운지 | 분위기 중시를 피상적 취향으로 보이게 하지 않는다. |
| B | 식대, 보증 인원, 교통처럼 실제 조건도 함께 확인한다. | `costRisk`, `familyIntegration` | `/check`, 예식장 조건 체크 | 조건 확인을 무드와 반대되는 현실주의로 몰지 않는다. |
| C | 사진이나 조명에서 그 분위기가 잘 남을지 확인한다. | `aestheticMood`, `experienceMeaning` | 사진 무드 비교, 업체 질문 리스트 | 사진 중시를 과시나 외형 평가로 표현하지 않는다. |
| D | 상대와 가족이 중요하게 보는 기준도 같이 맞춰본다. | `coPreparation`, `familyIntegration` | 커플·가족 기준표 | 가족 기준을 커플 기준의 반대편으로 단정하지 않는다. |

Answer options to avoid:

- "예쁘면 다른 조건은 덜 중요하다."
- "분위기는 감정적이니 조건부터 본다."
- "부모님이 좋아할 곳으로 맞춘다."

Future scoring note: hypothesis only; do not implement scoring yet.

### 3.7 `WC-Q-familyIntegration-002`

- Question ID: `WC-Q-familyIntegration-002`
- Target construct: `familyIntegration`
- Secondary constructs: `aestheticMood`
- Journey stage: `venue_search`
- Question text: 우리는 분위기가 좋은 예식장이 끌리지만 부모님은 음식과 교통을 더 중요하게 봅니다. 무엇을 먼저 해보고 싶나요?

| Option | Korean option text | Construct tendencies it may indicate | Product action it may route to | Bias/stigma risk note |
|---|---|---|---|---|
| A | 부모님이 걱정하는 음식과 교통 기준을 먼저 구체적으로 들어본다. | `familyIntegration`, `emotionalSupport` | 가족 대화 질문, etiquette guide | 가족 고려를 무조건 맞춤이나 순응으로 표현하지 않는다. |
| B | 분위기와 하객 편의를 함께 비교할 수 있는 표를 만든다. | `familyIntegration`, `aestheticMood`, `evidenceDecision` | 예식장 비교표, Amora 정리 | 표 기반 조율을 딱딱함으로 보이게 하지 않는다. |
| C | 예산과 보증 인원까지 포함해 현실적인 차이를 확인한다. | `costRisk`, `evidenceDecision` | `/check`, 예산·보증 인원 체크 | 비용 확인을 가족 의견보다 우선한다는 평가로 쓰지 않는다. |
| D | 우리 기준을 정리한 뒤 부모님께 설명할 절충안을 준비한다. | `coupleAutonomy`, `familyIntegration` | 가족 설명 문장, 체크리스트 | 커플 기준을 가족 배려 부족으로 보이게 하지 않는다. |

Answer options to avoid:

- "부모님 의견에 맞춘다."
- "부모님 의견은 참고만 하고 우리 마음대로 한다."
- "분위기보다 하객이 중요하니 포기한다."

Future scoring note: hypothesis only; do not implement scoring yet.

### 3.8 `WC-Q-coupleAutonomy-004`

- Question ID: `WC-Q-coupleAutonomy-004`
- Target construct: `coupleAutonomy`
- Secondary constructs: `emotionalSupport`
- Journey stage: `marriage_discussion`, `preparing_without_date`
- Question text: 부모님께 우리 결혼식의 예산·하객수·진행 방식 기준을 설명해야 합니다. 가장 먼저 준비할 것은 무엇인가요?

| Option | Korean option text | Construct tendencies it may indicate | Product action it may route to | Bias/stigma risk note |
|---|---|---|---|---|
| A | 둘이 먼저 예산, 하객수, 진행 방식의 기준을 맞춘다. | `coupleAutonomy`, `coPreparation` | 커플 기준 합의서, couple report | 커플 기준을 이기적 선택으로 보이게 하지 않는다. |
| B | 부모님께 보여드릴 숫자와 이유를 간단히 정리한다. | `evidenceDecision`, `costRisk` | 설명 자료, 예산·하객수 표 | 숫자 준비를 방어적 태도로 표현하지 않는다. |
| C | 부모님이 걱정할 부분을 예상하고 대화 순서를 정한다. | `familyIntegration`, `emotionalSupport` | 가족 대화 스크립트, etiquette guide | 부모님을 갈등 원인으로만 보이게 하지 않는다. |
| D | 우리 기준을 부드럽게 전달할 문장을 먼저 만들어본다. | `guidanceNeed`, `coupleAutonomy` | Amora 설명 문장, 체크리스트 | 가이드 필요를 말 못함이나 미숙함으로 표현하지 않는다. |

Answer options to avoid:

- "부모님을 설득해서 우리 뜻대로 한다."
- "가족이 불편해도 우리 기준이 우선이다."
- "부모님이 원하는 대로 맞춘다."

Future scoring note: hypothesis only; do not implement scoring yet.

### 3.9 `WC-Q-emotionalSupport-002`

- Question ID: `WC-Q-emotionalSupport-002`
- Target construct: `emotionalSupport`
- Secondary constructs: `executionSupport`
- Journey stage: `contract_pending`
- Question text: 상담 후 걱정된다고 말했더니 상대가 바로 해결책을 제안했습니다. 그 순간 가장 가까운 느낌은 무엇인가요?

| Option | Korean option text | Construct tendencies it may indicate | Product action it may route to | Bias/stigma risk note |
|---|---|---|---|---|
| A | 해결책 전에 왜 걱정되는지 먼저 들어주면 좋겠다고 느낀다. | `emotionalSupport` | Amora 공감 우선 응답, 커플 대화 팁 | 공감 필요를 예민함이나 약함으로 표현하지 않는다. |
| B | 짧게 공감한 뒤 선택지를 같이 정리하면 도움이 될 것 같다. | `emotionalSupport`, `executionSupport` | 공감 후 액션 카드 | 공감과 실행을 서로 반대되는 성향으로 단정하지 않는다. |
| C | 바로 다음 행동을 정리해주는 것도 괜찮다고 느낀다. | `executionSupport` | 체크리스트, 다음 행동 카드 | 실행 우선을 차갑거나 공감 부족으로 표현하지 않는다. |
| D | 이런 상황에서 어떤 반응이 나에게 맞는지 상대와 이야기하고 싶다. | `coPreparation`, `emotionalSupport` | 커플 support preference 대화 | 대화 필요를 갈등 성향으로 보이게 하지 않는다. |

Answer options to avoid:

- "상대가 내 마음을 몰라준다."
- "감정적인 말보다 해결책이 낫다."
- "걱정하는 내가 예민한 것 같다."

Future scoring note: hypothesis only; do not implement scoring yet.

### 3.10 `WC-Q-executionSupport-006`

- Question ID: `WC-Q-executionSupport-006`
- Target construct: `executionSupport`
- Secondary constructs: `roleOwnership`
- Journey stage: `wedding_week`
- Question text: 본식이 가까워져 업체 연락, 가족 안내, 준비물 확인이 한꺼번에 남았다고 가정하면, 가장 먼저 하고 싶은 것은 무엇인가요?

| Option | Korean option text | Construct tendencies it may indicate | Product action it may route to | Bias/stigma risk note |
|---|---|---|---|---|
| A | 해야 할 일을 담당자와 마감 시간별로 나눈다. | `executionSupport`, `roleOwnership` | wedding week 역할 분담표 | 실행 우선을 관계보다 일만 보는 태도로 표현하지 않는다. |
| B | 빠뜨린 준비물이 없는지 전체 체크리스트를 먼저 만든다. | `executionSupport`, `guidanceNeed` | 체크리스트, 준비물 점검 | 체크리스트 필요를 불안함으로 표현하지 않는다. |
| C | 가족과 업체에 보낼 안내 문장을 먼저 정리한다. | `familyIntegration`, `roleOwnership` | 가족 안내 문장, 업체 연락 템플릿 | 안내 업무를 특정 성별이나 가족 역할로 배정하지 않는다. |
| D | 서로 부담되는 부분을 이야기한 뒤 일을 나눈다. | `emotionalSupport`, `coPreparation`, `executionSupport` | 커플 대화 카드, 역할 분담 | 감정 공유를 실행 지연으로 보이게 하지 않는다. |

Answer options to avoid:

- "일 잘하는 사람이 다 맡는다."
- "감정 얘기보다 일을 끝내는 게 먼저다."
- "가족 안내는 당연히 한쪽이 맡는다."

Future scoring note: hypothesis only; do not implement scoring yet.

### 3.11 `WC-Q-decisionPaceRisk-004`

- Question ID: `WC-Q-decisionPaceRisk-004`
- Target construct: `decisionPaceRisk`
- Secondary constructs: `emotionalSupport`
- Journey stage: `venue_search`, `contract_pending`
- Question text: 상담을 다녀온 직후 매우 마음에 들어 바로 정하고 싶은 기분이 듭니다. 무엇이 가장 도움이 될까요?

| Option | Korean option text | Construct tendencies it may indicate | Product action it may route to | Bias/stigma risk note |
|---|---|---|---|---|
| A | 하루 정도 시간을 두고도 같은 마음인지 다시 확인한다. | `decisionPaceRisk` | 24시간 pause rule, 리마인드 | 빠른 결정을 충동성으로 낙인찍지 않는다. |
| B | 마음에 든 이유와 걱정되는 점을 상대와 같이 적어본다. | `coPreparation`, `emotionalSupport` | 상담 후 디브리프, 커플 대화 | 들뜬 마음을 부정적 감정으로 표현하지 않는다. |
| C | 계약서, 총액, 취소 조건을 확인한 뒤 결정한다. | `costRisk`, `evidenceDecision` | `/check`, 계약 전 체크리스트 | 조건 확인을 분위기를 깨는 행동으로 보이게 하지 않는다. |
| D | 다른 후보와 분위기와 조건을 한 번 더 비교한다. | `aestheticMood`, `guidanceNeed` | 후보 비교표, Amora 정리 | 비교를 우유부단함으로 표현하지 않는다. |

Answer options to avoid:

- "들뜬 마음에 바로 계약한다."
- "충동을 막기 위해 무조건 기다린다."
- "좋은 기분은 믿으면 안 된다."

Future scoring note: hypothesis only; do not implement scoring yet.

### 3.12 `WC-Q-guidanceNeed-005`

- Question ID: `WC-Q-guidanceNeed-005`
- Target construct: `guidanceNeed`
- Secondary constructs: `costRisk`
- Journey stage: `contract_pending`
- Question text: 견적서를 받았다고 가정하면, 항목명이 낯설고 여러 장으로 나뉘어 있을 때 가장 도움이 되는 것은 무엇인가요?

| Option | Korean option text | Construct tendencies it may indicate | Product action it may route to | Bias/stigma risk note |
|---|---|---|---|---|
| A | 꼭 확인해야 할 항목과 질문을 짧게 요약해주면 좋겠다. | `guidanceNeed`, `evidenceDecision` | Amora 견적 요약, 질문 우선순위 | 정보 압축 필요를 이해 부족으로 표현하지 않는다. |
| B | 추가금 가능성이 큰 항목부터 표시해주면 좋겠다. | `costRisk`, `evidenceDecision` | `/check` 위험 항목 표시 | 비용 위험 확인을 과도한 걱정으로 표현하지 않는다. |
| C | 업체에 다시 물어볼 문장을 쉽게 만들어주면 좋겠다. | `guidanceNeed`, `executionSupport` | 문의 메시지 생성, 체크리스트 | 문장 도움이 필요함을 미숙함으로 보이게 하지 않는다. |
| D | 상대에게 공유할 수 있는 쉬운 요약본이 있으면 좋겠다. | `coPreparation`, `guidanceNeed` | 공유 요약, partner invite | 공유 필요를 혼자 결정 못함으로 표현하지 않는다. |

Answer options to avoid:

- "어려우니 대신 판단해준다."
- "견적을 이해 못하니 요약이 필요하다."
- "비싼 항목만 골라낸다."

Future scoring note: hypothesis only; do not implement scoring yet.

### 3.13 `WC-Q-costRisk-001`

- Question ID: `WC-Q-costRisk-001`
- Target construct: `costRisk`
- Secondary constructs: `experienceMeaning`
- Journey stage: `venue_search`, `contract_pending`
- Question text: 마음에 드는 예식장이 예상보다 300만 원 비쌉니다. 상담 직후 가장 먼저 확인하고 싶은 것은 무엇인가요?

| Option | Korean option text | Construct tendencies it may indicate | Product action it may route to | Bias/stigma risk note |
|---|---|---|---|---|
| A | 총액, 추가금, 환불 조건을 먼저 확인한다. | `costRisk`, `evidenceDecision` | `/check`, 예식장 비용 체크 | 비용 확인을 덜 로맨틱한 태도로 보이게 하지 않는다. |
| B | 이 장소가 우리에게 오래 남을 경험인지 먼저 생각한다. | `experienceMeaning`, `aestheticMood` | 의미·무드 정리, 웨딩 라운지 | 경험 중시를 비현실적 선택으로 표현하지 않는다. |
| C | 부모님과 하객의 이동, 식사, 동선을 함께 고려한다. | `familyIntegration` | 가족 조율 체크리스트, etiquette guide | 가족 고려를 커플 기준의 반대편으로 두지 않는다. |
| D | 상대와 예산과 만족감 기준을 다시 맞춘다. | `coPreparation`, `coupleAutonomy` | 커플 기준표, couple report | 상대와 논의를 결정을 미루는 태도로 보이게 하지 않는다. |

Answer options to avoid:

- "현실적으로 돈을 아낀다."
- "마음에 들면 예산은 넘겨도 된다."
- "부모님 의견 때문에 선택한다."

Future scoring note: hypothesis only; do not implement scoring yet.

### 3.14 `WC-Q-roleOwnership-003`

- Question ID: `WC-Q-roleOwnership-003`
- Target construct: `roleOwnership`
- Secondary constructs: `coPreparation`
- Journey stage: `sdm_search`
- Question text: 한 사람은 스타일 비교를 잘하고, 다른 한 사람은 조건 비교를 잘합니다. 준비 방식으로 가장 가까운 것은 무엇인가요?

| Option | Korean option text | Construct tendencies it may indicate | Product action it may route to | Bias/stigma risk note |
|---|---|---|---|---|
| A | 각자 잘 보는 기준을 맡고 결과를 서로 공유한다. | `roleOwnership`, `coPreparation` | 역할 분담표, 후보 요약 | 강점 분담을 성별 역할로 보이게 하지 않는다. |
| B | 중요한 후보는 둘이 모두 보고 같이 정한다. | `coPreparation` | 공동 검토 루틴, partner invite | 같이 보는 방식을 비효율로 표현하지 않는다. |
| C | 한 사람이 후보를 압축하고 마지막 결정은 함께 한다. | `roleOwnership`, `guidanceNeed` | shortlist 생성, 최종 승인 체크 | 한 사람의 압축을 독단이나 무관심으로 보이게 하지 않는다. |
| D | 스타일과 조건을 함께 볼 수 있는 체크리스트를 만든다. | `executionSupport`, `evidenceDecision`, `aestheticMood` | 비교 체크리스트 | 체크리스트를 정답처럼 보이게 하지 않는다. |

Answer options to avoid:

- "스타일은 한쪽이, 돈은 다른 쪽이 맡는다."
- "잘하는 사람이 알아서 한다."
- "둘이 다 보면 시간이 낭비된다."

Future scoring note: hypothesis only; do not implement scoring yet.

### 3.15 `WC-Q-evidenceDecision-001`

- Question ID: `WC-Q-evidenceDecision-001`
- Target construct: `evidenceDecision`
- Secondary constructs: `aestheticMood`
- Journey stage: `sdm_search`
- Question text: 포트폴리오는 마음에 들지만 실제 이용 후기가 많지 않은 스튜디오가 있습니다. 무엇을 먼저 확인하나요?

| Option | Korean option text | Construct tendencies it may indicate | Product action it may route to | Bias/stigma risk note |
|---|---|---|---|---|
| A | 실제 이용 사례, 후기, 포함 조건을 더 확인한다. | `evidenceDecision`, `costRisk` | 후기 요약, `/check` | 근거 확인을 더 똑똑한 선택처럼 표현하지 않는다. |
| B | 포트폴리오가 원하는 무드와 얼마나 맞는지 다시 본다. | `aestheticMood`, `experienceMeaning` | 무드 비교, 웨딩 라운지 | 무드 중심 판단을 가벼운 선택으로 보이게 하지 않는다. |
| C | 비슷한 무드이면서 후기가 더 많은 후보도 찾아본다. | `guidanceNeed`, `aestheticMood`, `evidenceDecision` | 후보 추천, 비교표 | 후보 탐색을 우유부단함으로 표현하지 않는다. |
| D | 상대와 어느 정도의 정보 부족까지 괜찮은지 이야기한다. | `coPreparation`, `decisionPaceRisk` | 커플 기준 대화, pause rule | 정보 부족 논의를 불안함으로 보이게 하지 않는다. |

Answer options to avoid:

- "후기가 없으면 위험하니 제외한다."
- "사진이 예쁘면 충분하다."
- "감으로 고르는 사람은 위험하다."

Future scoring note: hypothesis only; do not implement scoring yet.

### 3.16 `WC-Q-coupleAutonomy-002`

- Question ID: `WC-Q-coupleAutonomy-002`
- Target construct: `coupleAutonomy`
- Secondary constructs: `familyIntegration`
- Journey stage: `marriage_discussion`, `contracted`
- Question text: 일부 전통 절차를 간소화하고 싶지만 가족이 어떻게 받아들일지 걱정됩니다. 무엇을 먼저 해보고 싶나요?

| Option | Korean option text | Construct tendencies it may indicate | Product action it may route to | Bias/stigma risk note |
|---|---|---|---|---|
| A | 왜 간소화하고 싶은지 둘의 기준과 의미를 먼저 정리한다. | `coupleAutonomy`, `experienceMeaning` | 커플 기준 정리, couple report | 간소화를 가족 배려 부족으로 표현하지 않는다. |
| B | 가족이 걱정할 지점을 예상하고 설명 방식을 준비한다. | `familyIntegration`, `emotionalSupport` | 가족 설명 문장, etiquette guide | 가족 걱정을 방해 요소로만 보이게 하지 않는다. |
| C | 예절을 지키면서 줄일 수 있는 절차를 구분한다. | `familyIntegration`, `executionSupport` | 예절 체크리스트, 절차 정리 | 예절을 무조건 오래된 형식으로 표현하지 않는다. |
| D | 예산, 시간, 진행 흐름에 어떤 도움이 되는지 자료로 정리한다. | `costRisk`, `evidenceDecision`, `coupleAutonomy` | 설명 자료, 준비 체크리스트 | 실용 기준을 차갑거나 계산적인 태도로 보이게 하지 않는다. |

Answer options to avoid:

- "전통 절차는 불필요하니 생략한다."
- "가족이 싫어해도 우리 방식대로 한다."
- "부모님이 원하면 그대로 따른다."

Future scoring note: hypothesis only; do not implement scoring yet.

## 4. Cross-Question Balance Check

- Cost/risk options are present across quote, contract, venue, and evidence scenarios, but they are not always the first or only reasonable response.
- Mood and meaning options are represented as valid memory, atmosphere, and experience inputs rather than irrational or superficial choices.
- Family and autonomy are both represented neutrally. Family integration is framed as coordination; couple autonomy is framed as criteria-setting and respectful explanation.
- Empathy and execution are both represented as valid support needs. Neither is presented as more mature, more caring, or more correct.
- Guidance and decision-pace questions are framed as support/risk prevention, not identity labels.
- No option intentionally points to a final public label, type, character, or code.
- Options A-D should be reviewed during expert review to ensure one answer does not look too obviously desirable in each question.

## 5. High-Risk Option Warnings

No option is intentionally designed as a bad or shame-inducing answer. The following areas still need careful review before smoke testing:

| Area | Related questions | Warning | Recommended check |
|---|---|---|---|
| Money-shaming risk | `WC-Q-costRisk-005`, `WC-Q-costRisk-001`, `WC-Q-guidanceNeed-005` | Cost-checking options could be read as overly cautious if surrounding copy is careless. | Keep wording focused on contract safety and decision readiness. |
| Emotion-shaming risk | `WC-Q-emotionalSupport-002`, `WC-Q-decisionPaceRisk-004` | Empathy or pause-rule options could be read as emotional weakness or impulsiveness prevention. | Keep language around support sequence and cooling-off support. |
| Gender-role risk | `WC-Q-roleOwnership-006`, `WC-Q-roleOwnership-003`, `WC-Q-executionSupport-006` | Role ownership could accidentally sound like style versus money gender division. | Avoid any bride/groom or gendered task assumptions in form copy. |
| Family-blaming risk | `WC-Q-familyIntegration-002`, `WC-Q-coupleAutonomy-004`, `WC-Q-coupleAutonomy-002` | Parent/family options could sound like pressure or opposition. | Keep family as a coordination context, not the problem. |
| Too-desirable option risk | All questions | Checklist, written confirmation, or summary options can look more responsible than others. | Ask expert reviewers whether one option feels like the obvious correct answer. |

## 6. Recommendations For WC-009

WC-009 Synthetic Persona Response Matrix can start after this document is reviewed.

WC-009 should test:

- Whether different plausible wedding-preparation personas choose different options without any option feeling wrong.
- Whether each construct tendency appears through multiple valid answer patterns rather than a single obvious answer.
- Whether `emotionalSupport`, `executionSupport`, `decisionPaceRisk`, and `guidanceNeed` remain internal UX/risk support constructs.
- Whether `familyIntegration` and `coupleAutonomy` can both appear in the same persona without being treated as opposites.
- Whether any answer option creates a hidden good-person versus bad-person frame.

WC-009 should not test:

- Numeric scoring.
- Final public codes.
- Final 16 types.
- Characters.
- Couple combination names.
- Product UI behavior.
- Amora prompt behavior.

Future scoring note: hypothesis only; do not implement scoring yet.
