# WeddingCode No-Code Form v0.3 Build Pack

> [!CAUTION]
> **HISTORICAL / NOT CURRENT SPEC.** 초기 설계·검토 계보이며 현재 문항·점수·유형·근거·수집·운영
> 승인으로 사용하지 않는다. 현행 상태는 [`README.md`](./README.md)와
> [`62`](./62_wedding_code_master_design_and_current_state_2026-07-18.md)를 따른다.

## 0. Purpose

This is a no-code smoke test build pack for Tally, Typeform, or Google Forms.

It packages the v0.3 WeddingCode smoke-test questions, answer options, intro copy, consent copy, participant context fields, stage-gating safeguards, feedback questions, CTA interest questions, and export schema.

This is not a final assessment, scoring system, public code, character result, final type, product UI, diagnosis, counseling tool, legal advice, marriage success prediction, or divorce prediction.

## 1. Recommended Tool

Recommended: Tally.

Use Tally if the team wants speed, clean mobile UX, easy no-code editing, and acceptable branching. Use Google Forms only if speed and export simplicity are the only priorities. Use Typeform if the team wants a more polished one-question-at-a-time UX, better branching, and stronger drop-off tracking.

## 2. Korean Form Title

```text
웨딩코드 3분 테스트 — 프로토타입
```

## 3. Korean Intro Copy

```text
이 테스트는 웨딩코드 질문을 다듬기 위한 프로토타입입니다.

결혼 준비를 하다 보면 예산, 견적, 분위기, 가족 조율, 상대와의 역할 분담처럼 여러 기준을 함께 보게 됩니다. 이 테스트는 실제 결혼 준비 상황형 질문을 통해 어떤 질문이 이해하기 쉽고 공감되는지, 그리고 어떤 제품 방향이 도움이 될지 확인하기 위한 3분짜리 테스트입니다.

이 테스트는 심리 진단, 관계 상담, 법률 자문, 결혼 성공 예측, 이혼 예측이 아닙니다.

이번 테스트에서는 최종 유형, 점수, 캐릭터, 4글자 코드가 부여되지 않습니다. 답변은 문항 품질과 제품 방향을 개선하는 데 사용됩니다.
```

Builder note:

- Do not use `검증된 검사`, `심리검사`, `궁합`, `MBTI`, `최종 유형`, `캐릭터 결과`, or `4글자 코드`.
- Add a short line before the first item: `정답은 없습니다. 가장 가까운 반응을 골라주세요.`

## 4. Consent Checkbox Copy

Use one required checkbox before participant context questions.

```text
위 내용을 확인했고, 테스트 목적의 응답 수집에 동의합니다.
```

If the tool requires a question label:

```text
테스트 참여 동의
```

## 5. Participant Context Questions

| Field ID | Korean question | Format | Options / notes |
|---|---|---|---|
| `participant_stage` | 지금 결혼 준비 단계는 어디에 가장 가깝나요? | single choice | `dating_or_meeting`, `marriage_discussion`, `preparing_without_date`, `venue_search`, `sdm_search`, `contract_pending`, `contracted`, `wedding_week`, `post_wedding` |
| `answering_mode` | 답변은 혼자 하고 있나요, 상대와 함께 하고 있나요? | single choice | 혼자 / 상대와 함께 / 상황에 따라 같이 이야기함 / 해당 없음 |
| `quote_status` | 업체 견적을 받아본 적이 있나요? | single choice | 아직 없음 / 상담만 해봄 / 견적을 받음 / 계약함 |
| `parent_involvement` | 부모님 또는 가족이 결혼 준비 결정에 어느 정도 관여하고 있나요? | single choice | 낮음 / 보통 / 높음 / 아직 모르겠음 |
| `biggest_concern` | 지금 가장 큰 결혼 준비 고민은 무엇인가요? | multiple choice + optional text | 예산·견적 / 예식장 / 스드메 / 가족 조율 / 상대와 역할 분담 / 일정 관리 / 정보가 너무 많음 / 아직 잘 모름 / 기타 |

## 6. Stage-Gating Strategy

### Option A: No-Branching Simple Form

Use this when building quickly in Google Forms or a simple Tally form.

- Show all 16 questions.
- Add this short note before stage-specific items:

```text
아직 해당 상황을 겪지 않았다면, 그런 상황이라고 가정하고 가장 가까운 반응을 골라주세요.
```

- Mark these stage-specific items in export columns:
  - `WC-Q-executionSupport-006` -> `q_execution_stage_flag`
  - `WC-Q-guidanceNeed-005` -> `q_guidance_stage_flag`
  - `WC-Q-coupleAutonomy-002` -> `q_autonomy_boundary_flag`
  - `WC-Q-costRisk-001` -> `q_cost_boundary_flag`
- Analyze those items separately by `participant_stage`, `quote_status`, and `parent_involvement`.

### Option B: Branching Form

Use this when building in Tally or Typeform with branching.

- Show 12 required items to everyone.
- Show 4 optional boundary/stage-gated items only when relevant:
  - Show `WC-Q-executionSupport-006` when `participant_stage` is `contracted`, `wedding_week`, or `post_wedding`; otherwise put it in an optional "가정 질문" section.
  - Show `WC-Q-guidanceNeed-005` when `quote_status` is 상담만 해봄 / 견적을 받음 / 계약함; otherwise put it in an optional "가정 질문" section.
  - Show `WC-Q-coupleAutonomy-002` when `parent_involvement` is 보통 / 높음 or `participant_stage` is `marriage_discussion`, `preparing_without_date`, or `contracted`; otherwise put it in an optional "가정 질문" section.
  - Show `WC-Q-costRisk-001` when `participant_stage` is `venue_search`, `contract_pending`, or `contracted`; otherwise put it in an optional "가정 질문" section.
- If a user is early stage, still allow an optional section titled:

```text
아직 겪지 않았을 수 있는 결혼 준비 상황
```

## 7. 16-Question Form Table

### 7.1 Order 1

| Field | Value |
|---|---|
| Required or optional boundary | Required |
| Question ID | `WC-Q-costRisk-005` |
| Target construct | `costRisk` |
| Secondary constructs | `evidenceDecision` |
| Journey stage | `sdm_search`, `contract_pending` |
| Export column name | `q01` |
| Stage-gate note | No gate; useful once users can imagine SDM package comparison. |
| Copy safeguard note | Frame cost checking as decision readiness, not suspicion. |

Question:

```text
스튜디오 패키지가 좋아 보이지만 원본, 보정, 헬퍼, 얼리스타트 비용이 분명하지 않습니다. 가장 먼저 할 일은 무엇인가요?
```

Options:

| Option | Korean answer option |
|---|---|
| A | 포함·불포함 항목과 추가 비용을 항목별로 먼저 확인한다. |
| B | 포트폴리오와 촬영 결과가 우리가 원하는 분위기와 맞는지 더 본다. |
| C | 상대와 촬영에서 꼭 필요한 항목과 조정 가능한 항목을 나눈다. |
| D | 비슷한 구성을 이용한 실제 후기나 사례를 더 확인한다. |

### 7.2 Order 2

| Field | Value |
|---|---|
| Required or optional boundary | Required |
| Question ID | `WC-Q-experienceMeaning-001` |
| Target construct | `experienceMeaning` |
| Secondary constructs | `costRisk` |
| Journey stage | `sdm_search` |
| Export column name | `q02` |
| Stage-gate note | No gate; ask as a hypothetical if the user has not started SDM search. |
| Copy safeguard note | Do not imply that meaning-focused choices are wasteful or vain. |

Question:

```text
본식 의상이나 촬영 스타일 중 하나가 오래 기억에 남을 것 같지만 추가 비용이 있습니다. 무엇을 먼저 생각하나요?
```

Options:

| Option | Korean answer option |
|---|---|
| A | 이 선택이 시간이 지나도 우리에게 의미 있게 남을지 먼저 생각한다. |
| B | 추가 비용이 전체 예산 안에서 감당 가능한지 먼저 계산한다. |
| C | 비슷한 느낌을 주는 다른 의상이나 촬영 스타일도 함께 찾아본다. |
| D | 상대와 어떤 장면을 오래 남기고 싶은지 먼저 이야기한다. |

### 7.3 Order 3

| Field | Value |
|---|---|
| Required or optional boundary | Required |
| Question ID | `WC-Q-coPreparation-003` |
| Target construct | `coPreparation` |
| Secondary constructs | `evidenceDecision` |
| Journey stage | `contract_pending` |
| Export column name | `q03` |
| Stage-gate note | No gate; preserve contract-pending assumption if needed. |
| Copy safeguard note | Do not imply one partner is wrong for not yet reviewing details. |

Question:

```text
상담 후 마음에 드는 업체가 생겼지만 상대는 아직 자세히 보지 못했습니다. 무엇이 먼저 필요하다고 느끼나요?
```

Options:

| Option | Korean answer option |
|---|---|
| A | 상대가 직접 볼 수 있도록 상담 내용과 후보 자료를 함께 펼쳐 확인한다. |
| B | 내가 상담 핵심과 판단 기준을 한 장으로 요약한 뒤 최종 확인만 같이 한다. |
| C | 계약 전에 둘 다 확인할 견적·조건·후기 체크 항목부터 만든다. |
| D | 왜 마음에 들었는지 분위기와 기억 포인트를 먼저 설명하고 반응을 들어본다. |

### 7.4 Order 4

| Field | Value |
|---|---|
| Required or optional boundary | Required |
| Question ID | `WC-Q-roleOwnership-006` |
| Target construct | `roleOwnership` |
| Secondary constructs | `evidenceDecision` |
| Journey stage | `contract_pending`, `contracted` |
| Export column name | `q04` |
| Stage-gate note | If early stage, keep as a hypothetical final-confirmation scenario. |
| Copy safeguard note | Do not add bride/groom examples or style-money gender assumptions. |

Question:

```text
한 사람이 업체 후보를 먼저 알아봤고, 계약 전에는 둘 다 최종 확인하려고 합니다. 어떤 방식으로 확인하는 게 가장 필요할까요?
```

Options:

| Option | Korean answer option |
|---|---|
| A | 알아본 사람이 후보별 선택 이유와 남은 확인점을 요약하고 둘이 승인한다. |
| B | 둘이 계약서, 견적, 후기, 포트폴리오를 처음부터 끝까지 같이 본다. |
| C | 최종 확인은 계약서와 견적 조건처럼 되돌리기 어려운 항목에 집중한다. |
| D | 한 사람은 조건·일정, 한 사람은 무드·만족도 체크리스트를 맡아 확인한다. |

### 7.5 Order 5

| Field | Value |
|---|---|
| Required or optional boundary | Required |
| Question ID | `WC-Q-evidenceDecision-006` |
| Target construct | `evidenceDecision` |
| Secondary constructs | `decisionPaceRisk` |
| Journey stage | `contract_pending` |
| Export column name | `q05` |
| Stage-gate note | If early stage, introduce as a contract-before-signing hypothetical. |
| Copy safeguard note | Written confirmation is a process preference, not distrust. |

Question:

```text
상담 중 서비스 추가를 약속받았지만 계약서에는 아직 없습니다. 다음 행동으로 가장 가까운 것은 무엇인가요?
```

Options:

| Option | Korean answer option |
|---|---|
| A | 약속받은 서비스 이름과 조건을 계약서나 메시지로 남겨달라고 요청한다. |
| B | 추가 서비스가 실제로 우리에게 필요한 혜택인지 따져본다. |
| C | 그 약속이 없어도 이 업체가 우리 기준에 맞는지 다시 본다. |
| D | 문서 확인 후 다시 결정할 시간을 잡고 계약 일정은 잠시 늦춘다. |

### 7.6 Order 6

| Field | Value |
|---|---|
| Required or optional boundary | Required |
| Question ID | `WC-Q-aestheticMood-002` |
| Target construct | `aestheticMood` |
| Secondary constructs | `familyIntegration` |
| Journey stage | `venue_search` |
| Export column name | `q06` |
| Stage-gate note | No gate; easy to answer as a venue-tour hypothetical. |
| Copy safeguard note | Do not frame mood as superficial or impractical. |

Question:

```text
투어 중 한 홀에 들어갔을 때 분위기가 우리와 잘 맞는다고 느꼈습니다. 무엇을 먼저 확인하고 싶나요?
```

Options:

| Option | Korean answer option |
|---|---|
| A | 현장에서 느낀 색감, 공간감, 전체 톤이 우리가 원한 분위기와 맞는지 정리한다. |
| B | 식대, 보증 인원, 교통처럼 가족과 하객에게 영향을 주는 조건을 확인한다. |
| C | 사진과 영상에 남을 조명, 동선, 촬영 각도를 확인한다. |
| D | 상대가 중요하게 보는 기준과 가족이 볼 기준을 따로 적어 맞춰본다. |

### 7.7 Order 7

| Field | Value |
|---|---|
| Required or optional boundary | Required |
| Question ID | `WC-Q-familyIntegration-002` |
| Target construct | `familyIntegration` |
| Secondary constructs | `aestheticMood` |
| Journey stage | `venue_search` |
| Export column name | `q07` |
| Stage-gate note | No gate; ask as a family/guest coordination scenario. |
| Copy safeguard note | Parents are a coordination context, not the problem. |

Question:

```text
우리는 분위기가 좋은 예식장이 끌리지만 부모님은 음식과 교통을 더 중요하게 봅니다. 무엇을 먼저 해보고 싶나요?
```

Options:

| Option | Korean answer option |
|---|---|
| A | 부모님이 걱정하는 음식과 교통 기준을 먼저 구체적으로 들어본다. |
| B | 분위기와 하객 편의를 함께 비교할 수 있는 표를 만든다. |
| C | 예산과 보증 인원까지 포함해 현실적인 차이를 확인한다. |
| D | 우리 기준을 정리한 뒤 부모님께 설명할 절충안을 준비한다. |

### 7.8 Order 8

| Field | Value |
|---|---|
| Required or optional boundary | Required |
| Question ID | `WC-Q-coupleAutonomy-004` |
| Target construct | `coupleAutonomy` |
| Secondary constructs | `emotionalSupport` |
| Journey stage | `marriage_discussion`, `preparing_without_date` |
| Export column name | `q08` |
| Stage-gate note | No gate; useful for early planning and family conversation readiness. |
| Copy safeguard note | Use explanation/share language, not persuasion language. |

Question:

```text
부모님께 우리 결혼식의 예산·하객수·진행 방식 기준을 설명해야 합니다. 가장 먼저 준비할 것은 무엇인가요?
```

Options:

| Option | Korean answer option |
|---|---|
| A | 둘이 먼저 예산, 하객수, 진행 방식의 기준을 맞춘다. |
| B | 부모님께 보여드릴 예산 범위, 하객수 기준, 진행 이유를 숫자로 정리한다. |
| C | 부모님이 걱정할 지점을 예상하고 어떤 순서로 들을지 정한다. |
| D | 우리 기준을 처음 꺼낼 때 쓸 부드러운 첫 문장을 만들어본다. |

### 7.9 Order 9

| Field | Value |
|---|---|
| Required or optional boundary | Required |
| Question ID | `WC-Q-emotionalSupport-002` |
| Target construct | `emotionalSupport` |
| Secondary constructs | `executionSupport` |
| Journey stage | `contract_pending` |
| Export column name | `q09` |
| Stage-gate note | No gate; support-sequence scenario is broadly understandable. |
| Copy safeguard note | Do not expose `emotionalSupport` as a public label. |

Question:

```text
상담 후 걱정된다고 말했더니 상대가 바로 해결책을 제안했습니다. 그 순간 가장 가까운 느낌은 무엇인가요?
```

Options:

| Option | Korean answer option |
|---|---|
| A | 해결책 전에 왜 걱정되는지 먼저 들어주면 좋겠다고 느낀다. |
| B | 걱정된다는 말을 짧게 확인받은 뒤 선택지를 같이 정리하면 도움이 될 것 같다. |
| C | 바로 다음 행동을 정리해주는 것도 괜찮다고 느낀다. |
| D | 이런 상황에서 어떤 반응이 나에게 맞는지 상대와 이야기하고 싶다. |

### 7.10 Order 10

| Field | Value |
|---|---|
| Required or optional boundary | Required, stage-gated candidate |
| Question ID | `WC-Q-executionSupport-006` |
| Target construct | `executionSupport` |
| Secondary constructs | `roleOwnership` |
| Journey stage | `wedding_week` |
| Export column name | `q10` |
| Stage-gate note | Flag as `q_execution_stage_flag`; show to all only with the hypothetical note, or branch to late-stage users. |
| Copy safeguard note | Task-first choices are support preferences, not coldness. |

Question:

```text
본식이 가까워져 업체 연락, 가족 안내, 준비물 확인이 한꺼번에 남았다고 가정하면, 가장 먼저 하고 싶은 것은 무엇인가요?
```

Options:

| Option | Korean answer option |
|---|---|
| A | 남은 일을 누가 맡을지 먼저 나눈다. |
| B | 오늘, 내일, 본식 당일 순서로 마감이 가까운 일부터 정렬한다. |
| C | 가족과 업체에 보낼 안내 문장을 먼저 정리한다. |
| D | 서로 부담되는 부분을 이야기한 뒤 일을 나눈다. |

### 7.11 Order 11

| Field | Value |
|---|---|
| Required or optional boundary | Required |
| Question ID | `WC-Q-decisionPaceRisk-004` |
| Target construct | `decisionPaceRisk` |
| Secondary constructs | `emotionalSupport` |
| Journey stage | `venue_search`, `contract_pending` |
| Export column name | `q11` |
| Stage-gate note | No gate; consultation excitement scenario is broadly imaginable. |
| Copy safeguard note | Do not label quick excitement as impulsive. |

Question:

```text
상담을 다녀온 직후 매우 마음에 들어 바로 정하고 싶은 기분이 듭니다. 무엇이 가장 도움이 될까요?
```

Options:

| Option | Korean answer option |
|---|---|
| A | 하루 정도 시간을 두고도 같은 마음인지 다시 확인한다. |
| B | 마음에 든 이유와 걱정되는 점을 상대와 같이 적어본다. |
| C | 계약서, 총액, 취소 조건을 확인한 뒤 결정한다. |
| D | 다른 후보와 분위기와 조건을 한 번 더 비교한다. |

### 7.12 Order 12

| Field | Value |
|---|---|
| Required or optional boundary | Required, stage-gated candidate |
| Question ID | `WC-Q-guidanceNeed-005` |
| Target construct | `guidanceNeed` |
| Secondary constructs | `costRisk` |
| Journey stage | `contract_pending` |
| Export column name | `q12` |
| Stage-gate note | Flag as `q_guidance_stage_flag`; branch by `quote_status` if possible. |
| Copy safeguard note | Guidance need is information support, not dependence or inability. |

Question:

```text
견적서를 받았다고 가정하면, 항목명이 낯설고 여러 장으로 나뉘어 있을 때 가장 도움이 되는 것은 무엇인가요?
```

Options:

| Option | Korean answer option |
|---|---|
| A | 가장 먼저 확인할 3가지와 질문 순서만 추려주면 좋겠다. |
| B | 내가 직접 비교할 수 있게 항목별 표로 정리해주면 좋겠다. |
| C | 추가금 가능성이 큰 항목을 눈에 띄게 표시해주면 좋겠다. |
| D | 상대와 이야기할 질문 목록으로 바꿔주면 좋겠다. |

### 7.13 Order 13

| Field | Value |
|---|---|
| Required or optional boundary | Optional boundary, stage-gated candidate |
| Question ID | `WC-Q-costRisk-001` |
| Target construct | `costRisk` |
| Secondary constructs | `experienceMeaning` |
| Journey stage | `venue_search`, `contract_pending` |
| Export column name | `q13` |
| Stage-gate note | Flag as `q_cost_boundary_flag`; strongest for `venue_search`, `contract_pending`, `contracted`. |
| Copy safeguard note | Cost-first is not less romantic; experience-first is not careless. |

Question:

```text
마음에 드는 예식장이 예상보다 300만 원 비쌉니다. 상담 직후 가장 먼저 확인하고 싶은 것은 무엇인가요?
```

Options:

| Option | Korean answer option |
|---|---|
| A | 총액, 추가금, 환불 조건을 먼저 확인한다. |
| B | 이 장소가 우리에게 오래 남을 경험인지 먼저 생각한다. |
| C | 부모님과 하객의 이동, 식사, 동선을 함께 고려한다. |
| D | 상대와 예산과 만족감 기준을 다시 맞춘다. |

### 7.14 Order 14

| Field | Value |
|---|---|
| Required or optional boundary | Optional boundary |
| Question ID | `WC-Q-roleOwnership-003` |
| Target construct | `roleOwnership` |
| Secondary constructs | `coPreparation` |
| Journey stage | `sdm_search` |
| Export column name | `q14` |
| Stage-gate note | No gate; optional boundary item. |
| Copy safeguard note | Do not map style, condition, money, or admin ownership to gender. |

Question:

```text
한 사람은 스타일 비교를 잘하고, 다른 한 사람은 조건 비교를 잘합니다. 준비 방식으로 가장 가까운 것은 무엇인가요?
```

Options:

| Option | Korean answer option |
|---|---|
| A | 각자 잘 보는 기준을 맡고 결과를 서로 공유한다. |
| B | 중요한 후보는 스타일과 조건 모두 둘이 같이 확인한다. |
| C | 한 사람이 후보를 2~3개로 줄이고, 줄인 이유를 공유한 뒤 마지막은 함께 정한다. |
| D | 각자 본 기준을 점수 없이 한 비교표에 합쳐 같이 본다. |

### 7.15 Order 15

| Field | Value |
|---|---|
| Required or optional boundary | Optional boundary |
| Question ID | `WC-Q-evidenceDecision-001` |
| Target construct | `evidenceDecision` |
| Secondary constructs | `aestheticMood` |
| Journey stage | `sdm_search` |
| Export column name | `q15` |
| Stage-gate note | No gate; optional SDM evidence/mood boundary item. |
| Copy safeguard note | Evidence-first is not smarter; mood-first is not careless. |

Question:

```text
포트폴리오는 마음에 들지만 실제 이용 후기가 많지 않은 스튜디오가 있습니다. 무엇을 먼저 확인하나요?
```

Options:

| Option | Korean answer option |
|---|---|
| A | 이 스튜디오의 실제 이용 사례, 후기, 포함 조건을 더 확인한다. |
| B | 포트폴리오가 원하는 무드와 얼마나 맞는지 다시 본다. |
| C | 비슷한 무드이면서 후기가 더 많은 다른 후보를 1~2곳 더 찾아본다. |
| D | 상대와 어느 정도의 정보 부족까지 괜찮은지 이야기한다. |

### 7.16 Order 16

| Field | Value |
|---|---|
| Required or optional boundary | Optional boundary, stage-gated candidate |
| Question ID | `WC-Q-coupleAutonomy-002` |
| Target construct | `coupleAutonomy` |
| Secondary constructs | `familyIntegration` |
| Journey stage | `marriage_discussion`, `contracted` |
| Export column name | `q16` |
| Stage-gate note | Flag as `q_autonomy_boundary_flag`; show if family involvement exists, otherwise place in optional hypothetical section. |
| Copy safeguard note | Autonomy means criteria-setting, not family rejection. |

Question:

```text
일부 전통 절차를 간소화하고 싶지만 가족이 어떻게 받아들일지 걱정됩니다. 무엇을 먼저 해보고 싶나요?
```

Options:

| Option | Korean answer option |
|---|---|
| A | 왜 간소화하고 싶은지 둘의 기준과 의미를 먼저 정리한다. |
| B | 가족이 걱정할 지점을 예상하고 설명 방식을 준비한다. |
| C | 예절을 지키면서 줄일 수 있는 절차를 구분한다. |
| D | 예산, 시간, 진행 흐름에 어떤 도움이 되는지 자료로 정리한다. |

## 8. Special Handling For WC-010 Stage-Gated Items

| Question ID | Why flagged | Present safely | Analyze separately |
|---|---|---|---|
| `WC-Q-executionSupport-006` | Wedding-week logistics may feel distant to early-stage users. | Add the hypothetical note, or branch to `contracted`, `wedding_week`, and `post_wedding` users. | Compare confusion and realism by `participant_stage`; use `q_execution_stage_flag`. |
| `WC-Q-guidanceNeed-005` | Quote-sheet language may be hard for users without quote exposure. | Preserve "견적서를 받았다고 가정하면"; branch by `quote_status` if possible. | Compare answers by `quote_status`; use `q_guidance_stage_flag`. |
| `WC-Q-coupleAutonomy-002` | Tradition simplification may be abstract before family expectations appear. | Keep as optional boundary or show after parent/family involvement is not low. | Compare by `parent_involvement` and `participant_stage`; use `q_autonomy_boundary_flag`. |
| `WC-Q-costRisk-001` | Venue over-budget scenario is strongest for venue search or contract-pending users. | Keep optional, or place in optional boundary section for early-stage users. | Compare by `participant_stage`; use `q_cost_boundary_flag`. |

## 9. Feedback Questions

Use a 1-5 scale:

- 1 = 전혀 아니다
- 2 = 아니다
- 3 = 보통이다
- 4 = 그렇다
- 5 = 매우 그렇다

| Field ID | Korean question | Export column |
|---|---|---|
| `feels_like_me` | 내 얘기처럼 느껴졌다 | `feels_like_me` |
| `scenario_realism` | 실제 결혼 준비 상황처럼 느껴졌다 | `scenario_realism` |
| `clarity` | 질문이 이해하기 쉬웠다 | `clarity` |
| `partner_invite_interest` | 상대에게 보내보고 싶다 | `partner_invite_interest` |
| `couple_report_interest` | 커플 리포트를 보고 싶다 | `couple_report_interest` |
| `amora_interest` | 아모라에게 이 결과 기반으로 상담받고 싶다 | `amora_interest` |
| `quote_check_interest` | 내 견적도 이 결과 기준으로 확인해보고 싶다 | `quote_check_interest` |
| `stigma_feedback_score` | 불편하거나 평가받는 느낌이 있었다 | `stigma_feedback_score` |
| `confusing_question_score` | 헷갈리는 질문이 있었다 | `confusing_question_score` |

Add a short optional follow-up if `stigma_feedback_score` or `confusing_question_score` is 4 or 5.

## 10. Free-Text Questions

| Field ID | Korean question | Export column |
|---|---|---|
| `most_relatable_question` | 가장 공감된 질문은 무엇인가요? | `most_relatable_question` |
| `most_awkward_question` | 가장 어색하거나 불편했던 질문은 무엇인가요? | `most_awkward_question` |
| `desired_report` | 어떤 결과 리포트를 받고 싶나요? | `desired_report` |
| `free_text_feedback` | 추가로 하고 싶은 말이 있다면 적어주세요. | `free_text_feedback` |

## 11. CTA Interest Section

| Field ID | Korean question | Recommended format |
|---|---|---|
| `partner_invite_interest` | 이 테스트를 상대에게 보내 같이 비교해보고 싶나요? | 1-5 or yes/no/maybe |
| `couple_report_interest` | 둘의 결혼 준비 방식이 어떻게 비슷하고 다른지 커플 리포트로 보고 싶나요? | 1-5 or yes/no/maybe |
| `amora_interest` | 이 답변을 바탕으로 아모라에게 다음 행동이나 대화 문장을 추천받고 싶나요? | 1-5 or yes/no/maybe |
| `quote_check_interest` | 받은 견적이나 계약 조건을 이 답변 기준으로 확인해보고 싶나요? | 1-5 or yes/no/maybe |
| `etiquette_checklist_interest` | 가족 조율, 예절, 준비 체크리스트를 이 답변 기준으로 받아보고 싶나요? | 1-5 or yes/no/maybe |

Do not route users into production features from this prototype.

## 12. Export Column Schema

Export these exact columns:

```text
response_id
submitted_at
participant_stage
answering_mode
quote_status
parent_involvement
biggest_concern
q01
q02
q03
q04
q05
q06
q07
q08
q09
q10
q11
q12
q13
q14
q15
q16
q_execution_stage_flag
q_guidance_stage_flag
q_autonomy_boundary_flag
q_cost_boundary_flag
feels_like_me
scenario_realism
clarity
partner_invite_interest
couple_report_interest
amora_interest
quote_check_interest
stigma_feedback_score
confusing_question_score
most_relatable_question
most_awkward_question
desired_report
free_text_feedback
```

Column notes:

- Store raw selected option labels for `q01` through `q16`.
- Do not calculate scores in the form.
- Use the four flag columns to mark whether a respondent received each stage-specific item as a direct-stage item, hypothetical item, optional item, or not shown.

## 13. Success And Failure Thresholds

| Metric | Threshold |
|---|---:|
| Completion | >= 60-65% |
| Feels-like-me | >= 4.0 / 5 |
| Scenario realism | >= 4.0 / 5 |
| Partner invite | >= 20% |
| Couple report | >= 10% |
| Amora | >= 10-15% |
| `/check` | >= 5% |
| Negative/stigma feedback | < 5% |
| Confusing question feedback | < 10% |

Failure signals:

- Completion below 50%.
- Users say the form feels like a psychological diagnosis.
- Users mention gender stereotypes.
- Users say the questions feel generic or not wedding-specific.
- Users ask for a final type, score, public code, or character because the form framing implied a final result.

## 14. Operating Checklist

1. Build no-code form.
2. Add intro copy and consent checkbox before all questions.
3. Add participant context fields.
4. Add 12 required questions.
5. Add optional or stage-gated boundary questions.
6. Add the hypothetical note before stage-specific items when using no branching.
7. Confirm no construct labels, scores, public codes, characters, final types, or compatibility claims are visible to participants.
8. Test internally 3 times.
9. Test once on mobile.
10. Check export columns.
11. Run a 5-response internal dry run.
12. Review confusion and stigma feedback.
13. Run a 20-person mini test.
14. Only then consider a 100-person smoke test.

## 15. Explicit Non-Goals

- No scoring.
- No numeric weights.
- No final public code.
- No characters.
- No final 16 types.
- No product UI.
- No routes.
- No DB migrations.
- No DB storage.
- No Amora prompt changes.
- No validation claim.
- No psychological diagnosis.
- No relationship counseling.
- No legal advice.
- No marriage success prediction.
- No divorce prediction.

## 16. Thank-You Screen Copy

```text
참여해주셔서 감사합니다.

이번 테스트는 최종 결과를 제공하는 검사가 아니라, 웨딩코드 문항이 실제 결혼 준비 상황처럼 느껴지는지 확인하기 위한 프로토타입입니다.

남겨주신 답변은 문항을 더 명확하고 안전하게 다듬고, 앞으로 어떤 제품 지원이 도움이 될지 판단하는 데 사용됩니다.
```
