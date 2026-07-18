# WeddingCode Smoke Test Item Set v0.3

> [!CAUTION]
> **HISTORICAL / NOT CURRENT SPEC.** 초기 설계·검토 계보이며 현재 문항·점수·유형·근거·수집·운영
> 승인으로 사용하지 않는다. 현행 상태는 [`README.md`](./README.md)와
> [`62`](./62_wedding_code_master_design_and_current_state_2026-07-18.md)를 따른다.

## 0. Scope

- Form version: v0.3
- Source option design: `11_answer_option_design_v0.2.md`
- This is a form-builder-ready item set for a prototype smoke test.
- It is not a final assessment.
- It does not define scoring, numeric weights, public 4-letter codes, final 16 types, characters, couple combination names, UI, database storage, routes, or Amora behavior.
- Internal constructs should not be shown to external participants unless the session is researcher-led.

## 1. Form Builder Rules

- Use single-choice A-D options.
- Store raw option labels and question IDs.
- Do not calculate scores in the form.
- Do not show final types, public codes, characters, or compatibility language.
- Keep `emotionalSupport`, `executionSupport`, `decisionPaceRisk`, and `guidanceNeed` as internal UX/risk constructs.
- Keep `familyIntegration` and `coupleAutonomy` separate unless future human data supports combining them.

## 2. Items In Order

### 2.1 Order 1

| Field | Value |
|---|---|
| Required or optional boundary | Required |
| Question ID | `WC-Q-costRisk-005` |
| Target construct | `costRisk` |
| Secondary constructs | `evidenceDecision` |
| Journey stage | `sdm_search`, `contract_pending` |
| Korean question text | 스튜디오 패키지가 좋아 보이지만 원본, 보정, 헬퍼, 얼리스타트 비용이 분명하지 않습니다. 가장 먼저 할 일은 무엇인가요? |
| Form-builder note | Keep early in the form because it is concrete and quote-related. |

| Option | Korean answer option | Non-numeric construct tendency | Product action mapping | Bias/stigma risk note |
|---|---|---|---|---|
| A | 포함·불포함 항목과 추가 비용을 항목별로 먼저 확인한다. | `costRisk`, `evidenceDecision` | `/check` 견적 항목 확인, Amora 질문 리스트 | 비용 확인을 의심 많음이나 인색함으로 표현하지 않는다. |
| B | 포트폴리오와 촬영 결과가 우리가 원하는 분위기와 맞는지 더 본다. | `aestheticMood`, `experienceMeaning` | 웨딩 라운지 무드 비교, 스튜디오 후보 비교 | 무드 중시를 비합리적 선택으로 보이게 하지 않는다. |
| C | 상대와 촬영에서 꼭 필요한 항목과 조정 가능한 항목을 나눈다. | `coPreparation`, `coupleAutonomy` | 커플 기준 정리, 체크리스트 | 상대 확인을 허락받기처럼 보이게 하지 않는다. |
| D | 비슷한 구성을 이용한 실제 후기나 사례를 더 확인한다. | `evidenceDecision`, `guidanceNeed` | 후기 요약, 실제 사례 요청 문장 | 후기 확인을 더 우월한 판단 방식으로 표현하지 않는다. |

### 2.2 Order 2

| Field | Value |
|---|---|
| Required or optional boundary | Required |
| Question ID | `WC-Q-experienceMeaning-001` |
| Target construct | `experienceMeaning` |
| Secondary constructs | `costRisk` |
| Journey stage | `sdm_search` |
| Korean question text | 본식 의상이나 촬영 스타일 중 하나가 오래 기억에 남을 것 같지만 추가 비용이 있습니다. 무엇을 먼저 생각하나요? |
| Form-builder note | Keep the broadened v0.2 wording; do not make this dress-only. |

| Option | Korean answer option | Non-numeric construct tendency | Product action mapping | Bias/stigma risk note |
|---|---|---|---|---|
| A | 이 선택이 시간이 지나도 우리에게 의미 있게 남을지 먼저 생각한다. | `experienceMeaning` | 의미 있는 항목 정리, Amora 대화 질문 | 의미 중시를 과소비나 허영으로 표현하지 않는다. |
| B | 추가 비용이 전체 예산 안에서 감당 가능한지 먼저 계산한다. | `costRisk`, `evidenceDecision` | 예산 재조정, `/check` 추가금 확인 | 예산 확인을 만족감 포기로 보이게 하지 않는다. |
| C | 비슷한 느낌을 주는 다른 의상이나 촬영 스타일도 함께 찾아본다. | `aestheticMood`, `guidanceNeed` | 무드 후보 추천, 대안 탐색 | 대안 탐색을 우유부단함으로 표현하지 않는다. |
| D | 상대와 어떤 장면을 오래 남기고 싶은지 먼저 이야기한다. | `coPreparation`, `experienceMeaning` | 커플 대화 카드, couple report | 함께 논의를 의존적 태도로 보이게 하지 않는다. |

### 2.3 Order 3

| Field | Value |
|---|---|
| Required or optional boundary | Required |
| Question ID | `WC-Q-coPreparation-003` |
| Target construct | `coPreparation` |
| Secondary constructs | `evidenceDecision` |
| Journey stage | `contract_pending` |
| Korean question text | 상담 후 마음에 드는 업체가 생겼지만 상대는 아직 자세히 보지 못했습니다. 무엇이 먼저 필요하다고 느끼나요? |
| Form-builder note | Patched in v0.3 to separate shared review, owner summary, evidence check, and meaning/mood explanation. |

| Option | Korean answer option | Non-numeric construct tendency | Product action mapping | Bias/stigma risk note |
|---|---|---|---|---|
| A | 상대가 직접 볼 수 있도록 상담 내용과 후보 자료를 함께 펼쳐 확인한다. | `coPreparation`, `evidenceDecision` | partner invite, 상담 요약 공유 | 함께 보는 방식을 허락받기나 더 좋은 태도로 보이게 하지 않는다. |
| B | 내가 상담 핵심과 판단 기준을 한 장으로 요약한 뒤 최종 확인만 같이 한다. | `roleOwnership`, `coPreparation` | 담당자 요약, 최종 승인 체크 | owner-led 방식을 독단이나 무관심으로 해석하지 않는다. |
| C | 계약 전에 둘 다 확인할 견적·조건·후기 체크 항목부터 만든다. | `evidenceDecision`, `costRisk` | `/check`, 계약 전 검토 리스트 | 자료 확인을 의심이나 까다로움으로 표현하지 않는다. |
| D | 왜 마음에 들었는지 분위기와 기억 포인트를 먼저 설명하고 반응을 들어본다. | `experienceMeaning`, `aestheticMood`, `coPreparation` | Amora 대화 질문, 상담 요약 공유 | 의미 설명을 설득이나 감정 압박으로 보이게 하지 않는다. |

### 2.4 Order 4

| Field | Value |
|---|---|
| Required or optional boundary | Required |
| Question ID | `WC-Q-roleOwnership-006` |
| Target construct | `roleOwnership` |
| Secondary constructs | `evidenceDecision` |
| Journey stage | `contract_pending`, `contracted` |
| Korean question text | 한 사람이 업체 후보를 먼저 알아봤고, 계약 전에는 둘 다 최종 확인하려고 합니다. 어떤 방식으로 확인하는 게 가장 필요할까요? |
| Form-builder note | Patched in v0.3 to separate owner summary, full co-review, condition-only review, and split checklist. |

| Option | Korean answer option | Non-numeric construct tendency | Product action mapping | Bias/stigma risk note |
|---|---|---|---|---|
| A | 알아본 사람이 후보별 선택 이유와 남은 확인점을 요약하고 둘이 승인한다. | `roleOwnership`, `evidenceDecision` | 담당자 요약 카드, 최종 승인 체크 | 역할 주도를 독단이나 무관심으로 보이게 하지 않는다. |
| B | 둘이 계약서, 견적, 후기, 포트폴리오를 처음부터 끝까지 같이 본다. | `coPreparation`, `evidenceDecision` | 공동 확인 체크리스트, `/check` | 공동 확인을 비효율이나 불신으로 표현하지 않는다. |
| C | 최종 확인은 계약서와 견적 조건처럼 되돌리기 어려운 항목에 집중한다. | `evidenceDecision`, `costRisk`, `decisionPaceRisk` | `/check`, 계약 전 조건 체크 | 조건 중심 확인을 덜 감성적이거나 더 우월한 방식으로 보이게 하지 않는다. |
| D | 한 사람은 조건·일정, 한 사람은 무드·만족도 체크리스트를 맡아 확인한다. | `roleOwnership`, `aestheticMood`, `costRisk`, `executionSupport` | 역할 분담표, 후보 비교표 | 조건·무드 역할을 성별화하지 않는다. |

### 2.5 Order 5

| Field | Value |
|---|---|
| Required or optional boundary | Required |
| Question ID | `WC-Q-evidenceDecision-006` |
| Target construct | `evidenceDecision` |
| Secondary constructs | `decisionPaceRisk` |
| Journey stage | `contract_pending` |
| Korean question text | 상담 중 서비스 추가를 약속받았지만 계약서에는 아직 없습니다. 다음 행동으로 가장 가까운 것은 무엇인가요? |
| Form-builder note | Patched to separate written confirmation from timing control. |

| Option | Korean answer option | Non-numeric construct tendency | Product action mapping | Bias/stigma risk note |
|---|---|---|---|---|
| A | 약속받은 서비스 이름과 조건을 계약서나 메시지로 남겨달라고 요청한다. | `evidenceDecision`, `decisionPaceRisk` | 서면 확인 요청 문장, `/check` | 기록 요청을 업체 불신으로 보이게 하지 않는다. |
| B | 추가 서비스가 실제로 우리에게 필요한 혜택인지 따져본다. | `costRisk`, `coupleAutonomy` | 혜택 가치 비교, 우선순위 정리 | 실속 판단을 계산적 태도로 표현하지 않는다. |
| C | 그 약속이 없어도 이 업체가 우리 기준에 맞는지 다시 본다. | `experienceMeaning`, `aestheticMood` | 후보 적합도 점검, Amora 비교 질문 | 전체 fit 판단을 감으로만 정하는 것처럼 쓰지 않는다. |
| D | 문서 확인 후 다시 결정할 시간을 잡고 계약 일정은 잠시 늦춘다. | `decisionPaceRisk`, `evidenceDecision` | pause rule, 계약 보류 체크 | 속도 조절을 겁이 많음이나 충동 억제로 표현하지 않는다. |

### 2.6 Order 6

| Field | Value |
|---|---|
| Required or optional boundary | Required |
| Question ID | `WC-Q-aestheticMood-002` |
| Target construct | `aestheticMood` |
| Secondary constructs | `familyIntegration` |
| Journey stage | `venue_search` |
| Korean question text | 투어 중 한 홀에 들어갔을 때 분위기가 우리와 잘 맞는다고 느꼈습니다. 무엇을 먼저 확인하고 싶나요? |
| Form-builder note | Patched to distinguish mood fit, family/practical conditions, photo/video output, and partner/family alignment. |

| Option | Korean answer option | Non-numeric construct tendency | Product action mapping | Bias/stigma risk note |
|---|---|---|---|---|
| A | 현장에서 느낀 색감, 공간감, 전체 톤이 우리가 원한 분위기와 맞는지 정리한다. | `aestheticMood`, `experienceMeaning` | 무드 키워드 정리, 웨딩 라운지 | 분위기 중시를 피상적 취향으로 보이게 하지 않는다. |
| B | 식대, 보증 인원, 교통처럼 가족과 하객에게 영향을 주는 조건을 확인한다. | `costRisk`, `familyIntegration` | `/check`, 예식장 조건 체크 | 조건 확인을 무드와 반대되는 현실주의로 몰지 않는다. |
| C | 사진과 영상에 남을 조명, 동선, 촬영 각도를 확인한다. | `aestheticMood`, `experienceMeaning` | 사진 무드 비교, 업체 질문 리스트 | 사진 중시를 과시나 외형 평가로 표현하지 않는다. |
| D | 상대가 중요하게 보는 기준과 가족이 볼 기준을 따로 적어 맞춰본다. | `coPreparation`, `familyIntegration` | 커플·가족 기준표 | 가족 기준을 커플 기준의 반대편으로 단정하지 않는다. |

### 2.7 Order 7

| Field | Value |
|---|---|
| Required or optional boundary | Required |
| Question ID | `WC-Q-familyIntegration-002` |
| Target construct | `familyIntegration` |
| Secondary constructs | `aestheticMood` |
| Journey stage | `venue_search` |
| Korean question text | 우리는 분위기가 좋은 예식장이 끌리지만 부모님은 음식과 교통을 더 중요하게 봅니다. 무엇을 먼저 해보고 싶나요? |
| Form-builder note | Keep parents as coordination context, not opposition. |

| Option | Korean answer option | Non-numeric construct tendency | Product action mapping | Bias/stigma risk note |
|---|---|---|---|---|
| A | 부모님이 걱정하는 음식과 교통 기준을 먼저 구체적으로 들어본다. | `familyIntegration`, `emotionalSupport` | 가족 대화 질문, etiquette guide | 가족 고려를 무조건 맞춤이나 순응으로 표현하지 않는다. |
| B | 분위기와 하객 편의를 함께 비교할 수 있는 표를 만든다. | `familyIntegration`, `aestheticMood`, `evidenceDecision` | 예식장 비교표, Amora 정리 | 표 기반 조율을 딱딱함으로 보이게 하지 않는다. |
| C | 예산과 보증 인원까지 포함해 현실적인 차이를 확인한다. | `costRisk`, `evidenceDecision` | `/check`, 예산·보증 인원 체크 | 비용 확인을 가족 의견보다 우선한다는 평가로 쓰지 않는다. |
| D | 우리 기준을 정리한 뒤 부모님께 설명할 절충안을 준비한다. | `coupleAutonomy`, `familyIntegration` | 가족 설명 문장, 체크리스트 | 커플 기준을 가족 배려 부족으로 보이게 하지 않는다. |

### 2.8 Order 8

| Field | Value |
|---|---|
| Required or optional boundary | Required |
| Question ID | `WC-Q-coupleAutonomy-004` |
| Target construct | `coupleAutonomy` |
| Secondary constructs | `emotionalSupport` |
| Journey stage | `marriage_discussion`, `preparing_without_date` |
| Korean question text | 부모님께 우리 결혼식의 예산·하객수·진행 방식 기준을 설명해야 합니다. 가장 먼저 준비할 것은 무엇인가요? |
| Form-builder note | Patched to separate numbers/reasons, parent concern anticipation, and respectful first wording. |

| Option | Korean answer option | Non-numeric construct tendency | Product action mapping | Bias/stigma risk note |
|---|---|---|---|---|
| A | 둘이 먼저 예산, 하객수, 진행 방식의 기준을 맞춘다. | `coupleAutonomy`, `coPreparation` | 커플 기준 합의서, couple report | 커플 기준을 이기적 선택으로 보이게 하지 않는다. |
| B | 부모님께 보여드릴 예산 범위, 하객수 기준, 진행 이유를 숫자로 정리한다. | `evidenceDecision`, `costRisk` | 설명 자료, 예산·하객수 표 | 숫자 준비를 방어적 태도로 표현하지 않는다. |
| C | 부모님이 걱정할 지점을 예상하고 어떤 순서로 들을지 정한다. | `familyIntegration`, `emotionalSupport` | 가족 대화 스크립트, etiquette guide | 부모님을 갈등 원인으로만 보이게 하지 않는다. |
| D | 우리 기준을 처음 꺼낼 때 쓸 부드러운 첫 문장을 만들어본다. | `guidanceNeed`, `coupleAutonomy` | Amora 설명 문장, 체크리스트 | 가이드 필요를 말 못함이나 미숙함으로 표현하지 않는다. |

### 2.9 Order 9

| Field | Value |
|---|---|
| Required or optional boundary | Required |
| Question ID | `WC-Q-emotionalSupport-002` |
| Target construct | `emotionalSupport` |
| Secondary constructs | `executionSupport` |
| Journey stage | `contract_pending` |
| Korean question text | 상담 후 걱정된다고 말했더니 상대가 바로 해결책을 제안했습니다. 그 순간 가장 가까운 느낌은 무엇인가요? |
| Form-builder note | Internal UX/risk construct only; do not turn into public identity language. |

| Option | Korean answer option | Non-numeric construct tendency | Product action mapping | Bias/stigma risk note |
|---|---|---|---|---|
| A | 해결책 전에 왜 걱정되는지 먼저 들어주면 좋겠다고 느낀다. | `emotionalSupport` | Amora 공감 우선 응답, 커플 대화 팁 | 공감 필요를 예민함이나 약함으로 표현하지 않는다. |
| B | 걱정된다는 말을 짧게 확인받은 뒤 선택지를 같이 정리하면 도움이 될 것 같다. | `emotionalSupport`, `executionSupport` | 공감 후 액션 카드 | 공감과 실행을 서로 반대되는 성향으로 단정하지 않는다. |
| C | 바로 다음 행동을 정리해주는 것도 괜찮다고 느낀다. | `executionSupport` | 체크리스트, 다음 행동 카드 | 실행 우선을 차갑거나 공감 부족으로 표현하지 않는다. |
| D | 이런 상황에서 어떤 반응이 나에게 맞는지 상대와 이야기하고 싶다. | `coPreparation`, `emotionalSupport` | 커플 support preference 대화 | 대화 필요를 갈등 성향으로 보이게 하지 않는다. |

### 2.10 Order 10

| Field | Value |
|---|---|
| Required or optional boundary | Required |
| Question ID | `WC-Q-executionSupport-006` |
| Target construct | `executionSupport` |
| Secondary constructs | `roleOwnership` |
| Journey stage | `wedding_week` |
| Korean question text | 본식이 가까워져 업체 연락, 가족 안내, 준비물 확인이 한꺼번에 남았다고 가정하면, 가장 먼저 하고 싶은 것은 무엇인가요? |
| Form-builder note | Patched to separate task split from deadline prioritization; monitor early-stage fit. |

| Option | Korean answer option | Non-numeric construct tendency | Product action mapping | Bias/stigma risk note |
|---|---|---|---|---|
| A | 남은 일을 누가 맡을지 먼저 나눈다. | `executionSupport`, `roleOwnership` | wedding week 역할 분담표 | 실행 우선을 관계보다 일만 보는 태도로 표현하지 않는다. |
| B | 오늘, 내일, 본식 당일 순서로 마감이 가까운 일부터 정렬한다. | `executionSupport`, `guidanceNeed` | 체크리스트, 준비물 점검 | 우선순위 정리를 불안함이나 통제 욕구로 표현하지 않는다. |
| C | 가족과 업체에 보낼 안내 문장을 먼저 정리한다. | `familyIntegration`, `roleOwnership` | 가족 안내 문장, 업체 연락 템플릿 | 안내 업무를 특정 성별이나 가족 역할로 배정하지 않는다. |
| D | 서로 부담되는 부분을 이야기한 뒤 일을 나눈다. | `emotionalSupport`, `coPreparation`, `executionSupport` | 커플 대화 카드, 역할 분담 | 감정 공유를 실행 지연으로 보이게 하지 않는다. |

### 2.11 Order 11

| Field | Value |
|---|---|
| Required or optional boundary | Required |
| Question ID | `WC-Q-decisionPaceRisk-004` |
| Target construct | `decisionPaceRisk` |
| Secondary constructs | `emotionalSupport` |
| Journey stage | `venue_search`, `contract_pending` |
| Korean question text | 상담을 다녀온 직후 매우 마음에 들어 바로 정하고 싶은 기분이 듭니다. 무엇이 가장 도움이 될까요? |
| Form-builder note | Keep as risk-prevention support, not an impulsiveness label. |

| Option | Korean answer option | Non-numeric construct tendency | Product action mapping | Bias/stigma risk note |
|---|---|---|---|---|
| A | 하루 정도 시간을 두고도 같은 마음인지 다시 확인한다. | `decisionPaceRisk` | 24시간 pause rule, 리마인드 | 빠른 결정을 충동성으로 낙인찍지 않는다. |
| B | 마음에 든 이유와 걱정되는 점을 상대와 같이 적어본다. | `coPreparation`, `emotionalSupport` | 상담 후 디브리프, 커플 대화 | 들뜬 마음을 부정적 감정으로 표현하지 않는다. |
| C | 계약서, 총액, 취소 조건을 확인한 뒤 결정한다. | `costRisk`, `evidenceDecision` | `/check`, 계약 전 체크리스트 | 조건 확인을 분위기를 깨는 행동으로 보이게 하지 않는다. |
| D | 다른 후보와 분위기와 조건을 한 번 더 비교한다. | `aestheticMood`, `guidanceNeed` | 후보 비교표, Amora 정리 | 비교를 우유부단함으로 표현하지 않는다. |

### 2.12 Order 12

| Field | Value |
|---|---|
| Required or optional boundary | Required |
| Question ID | `WC-Q-guidanceNeed-005` |
| Target construct | `guidanceNeed` |
| Secondary constructs | `costRisk` |
| Journey stage | `contract_pending` |
| Korean question text | 견적서를 받았다고 가정하면, 항목명이 낯설고 여러 장으로 나뉘어 있을 때 가장 도움이 되는 것은 무엇인가요? |
| Form-builder note | Patched to separate top-3 compression, self-led comparison, hidden-cost risk, and partner discussion. |

| Option | Korean answer option | Non-numeric construct tendency | Product action mapping | Bias/stigma risk note |
|---|---|---|---|---|
| A | 가장 먼저 확인할 3가지와 질문 순서만 추려주면 좋겠다. | `guidanceNeed`, `evidenceDecision` | Amora 견적 요약, 질문 우선순위 | 정보 압축 필요를 이해 부족으로 표현하지 않는다. |
| B | 내가 직접 비교할 수 있게 항목별 표로 정리해주면 좋겠다. | `evidenceDecision`, `guidanceNeed` | 견적 비교표, 체크리스트 | self-led 비교를 도움 거절이나 혼자 해결해야 함으로 보이게 하지 않는다. |
| C | 추가금 가능성이 큰 항목을 눈에 띄게 표시해주면 좋겠다. | `costRisk`, `evidenceDecision` | `/check` 위험 항목 표시 | 비용 위험 확인을 과도한 걱정으로 표현하지 않는다. |
| D | 상대와 이야기할 질문 목록으로 바꿔주면 좋겠다. | `coPreparation`, `guidanceNeed` | 공유 요약, partner invite | 공유 필요를 혼자 결정 못함으로 표현하지 않는다. |

### 2.13 Order 13

| Field | Value |
|---|---|
| Required or optional boundary | Optional boundary |
| Question ID | `WC-Q-costRisk-001` |
| Target construct | `costRisk` |
| Secondary constructs | `experienceMeaning` |
| Journey stage | `venue_search`, `contract_pending` |
| Korean question text | 마음에 드는 예식장이 예상보다 300만 원 비쌉니다. 상담 직후 가장 먼저 확인하고 싶은 것은 무엇인가요? |
| Form-builder note | Optional boundary item for cost safety versus experience meaning. |

| Option | Korean answer option | Non-numeric construct tendency | Product action mapping | Bias/stigma risk note |
|---|---|---|---|---|
| A | 총액, 추가금, 환불 조건을 먼저 확인한다. | `costRisk`, `evidenceDecision` | `/check`, 예식장 비용 체크 | 비용 확인을 덜 로맨틱한 태도로 보이게 하지 않는다. |
| B | 이 장소가 우리에게 오래 남을 경험인지 먼저 생각한다. | `experienceMeaning`, `aestheticMood` | 의미·무드 정리, 웨딩 라운지 | 경험 중시를 비현실적 선택으로 표현하지 않는다. |
| C | 부모님과 하객의 이동, 식사, 동선을 함께 고려한다. | `familyIntegration` | 가족 조율 체크리스트, etiquette guide | 가족 고려를 커플 기준의 반대편으로 두지 않는다. |
| D | 상대와 예산과 만족감 기준을 다시 맞춘다. | `coPreparation`, `coupleAutonomy` | 커플 기준표, couple report | 상대와 논의를 결정을 미루는 태도로 보이게 하지 않는다. |

### 2.14 Order 14

| Field | Value |
|---|---|
| Required or optional boundary | Optional boundary |
| Question ID | `WC-Q-roleOwnership-003` |
| Target construct | `roleOwnership` |
| Secondary constructs | `coPreparation` |
| Journey stage | `sdm_search` |
| Korean question text | 한 사람은 스타일 비교를 잘하고, 다른 한 사람은 조건 비교를 잘합니다. 준비 방식으로 가장 가까운 것은 무엇인가요? |
| Form-builder note | Patched to distinguish strengths division, full co-review, shortlist ownership, and non-scored merged comparison. |

| Option | Korean answer option | Non-numeric construct tendency | Product action mapping | Bias/stigma risk note |
|---|---|---|---|---|
| A | 각자 잘 보는 기준을 맡고 결과를 서로 공유한다. | `roleOwnership`, `coPreparation` | 역할 분담표, 후보 요약 | 강점 분담을 성별 역할로 보이게 하지 않는다. |
| B | 중요한 후보는 스타일과 조건 모두 둘이 같이 확인한다. | `coPreparation` | 공동 검토 루틴, partner invite | 같이 보는 방식을 비효율로 표현하지 않는다. |
| C | 한 사람이 후보를 2~3개로 줄이고, 줄인 이유를 공유한 뒤 마지막은 함께 정한다. | `roleOwnership`, `guidanceNeed` | shortlist 생성, 최종 승인 체크 | 한 사람의 압축을 독단이나 무관심으로 보이게 하지 않는다. |
| D | 각자 본 기준을 점수 없이 한 비교표에 합쳐 같이 본다. | `executionSupport`, `evidenceDecision`, `aestheticMood` | 비교 체크리스트 | 비교표를 정답이나 숫자 평가처럼 보이게 하지 않는다. |

### 2.15 Order 15

| Field | Value |
|---|---|
| Required or optional boundary | Optional boundary |
| Question ID | `WC-Q-evidenceDecision-001` |
| Target construct | `evidenceDecision` |
| Secondary constructs | `aestheticMood` |
| Journey stage | `sdm_search` |
| Korean question text | 포트폴리오는 마음에 들지만 실제 이용 후기가 많지 않은 스튜디오가 있습니다. 무엇을 먼저 확인하나요? |
| Form-builder note | Patched to distinguish verifying current vendor from broadening candidate set. |

| Option | Korean answer option | Non-numeric construct tendency | Product action mapping | Bias/stigma risk note |
|---|---|---|---|---|
| A | 이 스튜디오의 실제 이용 사례, 후기, 포함 조건을 더 확인한다. | `evidenceDecision`, `costRisk` | 후기 요약, `/check` | 근거 확인을 더 똑똑한 선택처럼 표현하지 않는다. |
| B | 포트폴리오가 원하는 무드와 얼마나 맞는지 다시 본다. | `aestheticMood`, `experienceMeaning` | 무드 비교, 웨딩 라운지 | 무드 중심 판단을 가벼운 선택으로 보이게 하지 않는다. |
| C | 비슷한 무드이면서 후기가 더 많은 다른 후보를 1~2곳 더 찾아본다. | `guidanceNeed`, `aestheticMood`, `evidenceDecision` | 후보 추천, 비교표 | 후보 탐색을 우유부단함으로 표현하지 않는다. |
| D | 상대와 어느 정도의 정보 부족까지 괜찮은지 이야기한다. | `coPreparation`, `decisionPaceRisk` | 커플 기준 대화, pause rule | 정보 부족 논의를 불안함으로 보이게 하지 않는다. |

### 2.16 Order 16

| Field | Value |
|---|---|
| Required or optional boundary | Optional boundary |
| Question ID | `WC-Q-coupleAutonomy-002` |
| Target construct | `coupleAutonomy` |
| Secondary constructs | `familyIntegration` |
| Journey stage | `marriage_discussion`, `contracted` |
| Korean question text | 일부 전통 절차를 간소화하고 싶지만 가족이 어떻게 받아들일지 걱정됩니다. 무엇을 먼저 해보고 싶나요? |
| Form-builder note | Optional boundary item; keep autonomy and family integration separate. |

| Option | Korean answer option | Non-numeric construct tendency | Product action mapping | Bias/stigma risk note |
|---|---|---|---|---|
| A | 왜 간소화하고 싶은지 둘의 기준과 의미를 먼저 정리한다. | `coupleAutonomy`, `experienceMeaning` | 커플 기준 정리, couple report | 간소화를 가족 배려 부족으로 표현하지 않는다. |
| B | 가족이 걱정할 지점을 예상하고 설명 방식을 준비한다. | `familyIntegration`, `emotionalSupport` | 가족 설명 문장, etiquette guide | 가족 걱정을 방해 요소로만 보이게 하지 않는다. |
| C | 예절을 지키면서 줄일 수 있는 절차를 구분한다. | `familyIntegration`, `executionSupport` | 예절 체크리스트, 절차 정리 | 예절을 무조건 오래된 형식으로 표현하지 않는다. |
| D | 예산, 시간, 진행 흐름에 어떤 도움이 되는지 자료로 정리한다. | `costRisk`, `evidenceDecision`, `coupleAutonomy` | 설명 자료, 준비 체크리스트 | 실용 기준을 차갑거나 계산적인 태도로 보이게 하지 않는다. |

## 3. Remaining Risks Before Human Testing

- Shared review and partner discussion options may still feel broadly attractive to many respondents.
- Checklist, written confirmation, and risk-highlight options can still look like the safest or most responsible answer.
- Quote and contract items may confuse early-stage users who have not received vendor documents.
- Wedding-week execution item may be too distant for early-stage users even with "가정하면" wording.
- Family-related questions need careful copy around parents so they do not read as family pressure or family blame.
- The form must not show construct names as identity labels.

## 4. Questions To Monitor In Dry Run

| Question ID | Monitor for |
|---|---|
| `WC-Q-coPreparation-003` | Whether A still feels like the obviously caring answer. |
| `WC-Q-roleOwnership-006` | Whether B still feels like the safest or most responsible answer. |
| `WC-Q-guidanceNeed-005` | Whether D still attracts most users because partner sharing feels universally useful. |
| `WC-Q-roleOwnership-003` | Whether C is now more plausible after the shortlist wording patch. |
| `WC-Q-executionSupport-006` | Whether early-stage users can answer a wedding-week hypothetical. |
| `WC-Q-evidenceDecision-006` | Whether A and D are now clearly different. |
| `WC-Q-aestheticMood-002` | Whether A and C are now clearly different. |
| `WC-Q-evidenceDecision-001` | Whether A and C are now clearly different. |

## 5. Questions With Improved Discrimination

- `WC-Q-coPreparation-003`: A/B/C/D now separate shared review, owner-led summary, evidence checklist, and meaning/mood explanation.
- `WC-Q-roleOwnership-006`: A/B/C/D now separate owner summary, full co-review, contract/quote condition focus, and split checklist by strengths.
- `WC-Q-guidanceNeed-005`: A/B/C/D now separate top-3 compression, self-led comparison table, hidden-cost highlighting, and partner discussion question list.
- `WC-Q-roleOwnership-003`: A/B/C/D now separate strength-based division, full co-review, shortlist ownership, and non-scored merged comparison.
- `WC-Q-evidenceDecision-006`: A and D now distinguish written confirmation request from contract timing control.
- `WC-Q-evidenceDecision-001`: A and C now distinguish current-vendor verification from searching alternative candidates.
- `WC-Q-aestheticMood-002`: A and C now distinguish in-person mood fit from photo/video output.
- `WC-Q-executionSupport-006`: A and B now distinguish task ownership from deadline prioritization.

## 6. Explicit Non-Goals

- No scoring.
- No numeric weights.
- No final public 4-letter code.
- No final 16 types.
- No characters.
- No couple combination names.
- No product UI.
- No routes.
- No database migrations.
- No DB storage.
- No Amora prompt changes.
- No psychological diagnosis.
- No relationship counseling.
- No legal advice.
- No marriage success prediction.
- No divorce prediction.
