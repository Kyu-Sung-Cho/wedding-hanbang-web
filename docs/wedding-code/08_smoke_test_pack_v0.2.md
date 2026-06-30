# WeddingCode Smoke Test Pack v0.2

## Changelog

- v0.2 uses the revised smoke-test shortlist wording.
- v0.2 does not introduce scoring, public codes, characters, final types, UI, DB storage, or Amora behavior.
## 0. Scope

This document is an operations pack for a 100-person no-code/manual WeddingCode smoke test.

This document does not create UI, routes, database migrations, scoring logic, final public 4-letter codes, final 16 types, characters, couple combination names, Amora prompt changes, or public launch copy.

The test should be run as a prototype research flow in a no-code tool such as Typeform, Tally, Google Forms, or an internal manual survey. It should not be presented as a validated assessment.

## 1. Source Inputs

- `docs/wedding-code/07_smoke_test_shortlist_v0.2.md`
- `docs/wedding-code/06_question_bank_review.md`
- `docs/wedding-code/06_question_bank_v0.1.md`
- `docs/wedding-code/05_question_domain_map.md`
- `docs/wedding-code/04_validation_plan.md`

## 2. Test Objective

Primary objective:

- Validate whether the 16 shortlisted WeddingCode questions feel relevant, understandable, non-stigmatizing, and worth sharing.
- Validate whether users show interest in partner invite, couple report, Amora guidance, and `/check` quote diagnosis after answering.
- Identify confusing, generic, duplicated, or stigma-prone questions before building product UI.

Non-claim:

- This smoke test does not establish psychological validation.
- This smoke test does not diagnose relationship health.
- This smoke test does not predict marriage success, divorce, or legal/financial outcomes.

## 3. Test Scope

Included:

- 16 shortlist questions from WC-004.
- Participant context questions.
- Lightweight temporary feedback screen.
- Feedback survey.
- CTA interest checks for partner invite, couple report, Amora, and `/check`.
- Manual analysis templates.

Excluded:

- Final scoring.
- Final public code labels.
- Characters.
- Final type names.
- Public result naming.
- Database storage.
- Product UI.

Temporary result language:

- If any interim result language is shown, describe it only as internal construct tendencies or support needs.
- Use phrases such as "비용과 계약 조건 확인이 도움이 되는 경향", "상대와 함께 확인하는 흐름이 도움이 되는 경향", or "정보를 압축해 보는 지원이 도움이 되는 경향."
- Do not show public letters, type names, characters, or ranking labels.

## 4. Participant Target

Target sample:

- 100 participants total.
- Include engaged couples.
- Include recently married users.
- Include marriage-interested users who are dating or discussing marriage.
- If possible, include at least 30 couples or partner-pair responses.

Track participant stage:

- `dating_or_meeting`
- `marriage_discussion`
- `preparing_without_date`
- `venue_search`
- `sdm_search`
- `contract_pending`
- `contracted`
- `wedding_week`
- `post_wedding`

Suggested sample mix:

| Segment | Target count | Notes |
|---|---:|---|
| Engaged or actively preparing | 50-60 | Highest signal for current wedding decisions. |
| Recently married | 20-30 | Useful for recall of real friction and clarity. |
| Marriage-interested or early discussion | 10-20 | Useful for onboarding and early guidance language. |
| Partner-pair responses | 30 pairs if possible | Useful for partner invite and couple-report interest. |

## 5. Recruiting Message

Short Korean recruiting message:

```text
결혼 준비 방식에 대한 3분짜리 프로토타입 테스트를 진행하고 있어요.

예식장, 견적, 가족 조율, 상대와의 준비 방식처럼 실제 결혼 준비에서 마주치는 상황형 질문 16개에 답해주시면 됩니다.

이 테스트는 아직 검증된 심리검사나 진단이 아니라, 질문이 실제 준비 상황처럼 느껴지는지 확인하기 위한 초기 연구입니다. 답변은 문항 품질과 제품 설계를 개선하는 데만 사용됩니다.
```

Do not use:

- "검증된 검사"
- "심리 진단"
- "결혼 유형 확정"
- "4글자 코드 결과"
- "캐릭터 결과"
- "배우자와의 궁합 예측"

## 6. Opening Consent / Disclaimer Copy

Korean copy:

```text
이 테스트는 WeddingCode 문항을 검토하기 위한 프로토타입 연구 테스트입니다.

질문은 결혼 준비 과정에서 비용, 의미, 상대와의 준비 방식, 가족 조율, 계약 확인, 정보 과부하 같은 의사결정 경향을 이해하기 위해 만들어졌습니다.

이 테스트는 심리 진단, 관계 상담, 법률 자문, 결혼 성공 예측, 이혼 예측이 아닙니다.

답변은 문항 품질을 개선하고 제품 설계를 더 안전하고 유용하게 만들기 위한 연구 목적으로 사용됩니다.

불편하거나 낙인처럼 느껴지는 표현이 있다면 마지막에 꼭 알려주세요.
```

Consent question:

| Question | Response options |
|---|---|
| 위 내용을 읽고 프로토타입 연구 테스트에 참여하시겠어요? | 예, 참여합니다 / 아니요 |

If the participant selects "아니요", end the form.

## 7. Test Flow

Recommended no-code flow:

1. Intro
2. Opening consent / disclaimer
3. Participant context questions
4. 16 shortlist questions
5. Temporary feedback screen
6. Feedback survey
7. Optional partner invite interest
8. Optional Amora interest
9. Optional `/check` interest
10. Thank-you screen

Timing target:

- Intro and consent: 20-30 seconds
- Context questions: 30-45 seconds
- 16 shortlist questions: 2-3 minutes
- Feedback survey: 1-2 minutes

The "3-minute" claim should refer to the core question-answering experience, not the full research survey including feedback.

## 8. Participant Context Questions

Use these before the 16 questions.

| ID | Question | Response format | Options / notes |
|---|---|---|---|
| C-001 | 지금 결혼 준비 단계는 어디에 가장 가깝나요? | single choice | `dating_or_meeting`, `marriage_discussion`, `preparing_without_date`, `venue_search`, `sdm_search`, `contract_pending`, `contracted`, `wedding_week`, `post_wedding` |
| C-002 | 이번 테스트를 상대와 함께 참여하고 있나요? | single choice | 혼자 참여 / 상대도 따로 참여 예정 / 지금 같이 보고 있음 / 해당 없음 |
| C-003 | 예식 예정일 또는 대략적인 준비 시점이 있나요? | short text | 예: 2027년 봄, 아직 없음, 내년 하반기 |
| C-004 | 지금 가장 큰 결혼 준비 고민은 무엇인가요? | multiple choice + free text | 예산/견적, 예식장, 스드메, 가족 조율, 상대와 역할 분담, 일정 관리, 정보가 너무 많음, 아직 잘 모름, 기타 |
| C-005 | 업체 견적을 받아본 적이 있나요? | single choice | 아직 없음 / 상담만 해봄 / 견적을 받음 / 계약함 |
| C-006 | 부모님 또는 가족이 결혼 준비 결정에 어느 정도 관여하고 있나요? | single choice | 낮음 / 보통 / 높음 / 아직 모르겠음 |
| C-007 | 최근 2주 안에 가장 많이 한 준비 행동은 무엇인가요? | multiple choice | 검색, 커뮤니티 후기 읽기, 상담 예약, 견적 비교, 가족과 대화, 상대와 기준 정하기, 계약 검토, 아직 없음 |

## 9. 16 Shortlist Questions

Use the exact question text and response options from `06_question_bank_v0.1.md`. The table below is the operating index for the form.

| Order | Question ID | Target construct | Required / optional | Journey stage | Question text |
|---:|---|---|---|---|---|
| 1 | `WC-Q-costRisk-005` | `costRisk` | Required | `sdm_search`, `contract_pending` | 스튜디오 패키지가 좋아 보이지만 원본, 보정, 헬퍼, 얼리스타트 비용이 분명하지 않습니다. 가장 먼저 할 일은 무엇인가요? |
| 2 | `WC-Q-experienceMeaning-001` | `experienceMeaning` | Required | `sdm_search` | 본식 의상이나 촬영 스타일 중 하나가 오래 기억에 남을 것 같지만 추가 비용이 있습니다. 무엇을 먼저 생각하나요? |
| 3 | `WC-Q-coPreparation-003` | `coPreparation` | Required | `contract_pending` | 상담 후 마음에 드는 업체가 생겼지만 상대는 아직 자세히 보지 못했습니다. 무엇이 먼저 필요하다고 느끼나요? |
| 4 | `WC-Q-roleOwnership-006` | `roleOwnership` | Required | `contract_pending`, `contracted` | 한 사람이 업체 후보를 먼저 알아봤고, 계약 전에는 둘 다 최종 확인하려고 합니다. 어떤 방식으로 확인하는 게 가장 필요할까요? |
| 5 | `WC-Q-evidenceDecision-006` | `evidenceDecision` | Required | `contract_pending` | 상담 중 서비스 추가를 약속받았지만 계약서에는 아직 없습니다. 다음 행동으로 가장 가까운 것은 무엇인가요? |
| 6 | `WC-Q-aestheticMood-002` | `aestheticMood` | Required | `venue_search` | 투어 중 한 홀에 들어갔을 때 분위기가 우리와 잘 맞는다고 느꼈습니다. 무엇을 먼저 확인하고 싶나요? |
| 7 | `WC-Q-familyIntegration-002` | `familyIntegration` | Required | `venue_search` | 우리는 분위기가 좋은 예식장이 끌리지만 부모님은 음식과 교통을 더 중요하게 봅니다. 무엇을 먼저 해보고 싶나요? |
| 8 | `WC-Q-coupleAutonomy-004` | `coupleAutonomy` | Required | `marriage_discussion`, `preparing_without_date` | 부모님께 우리 결혼식의 예산·하객수·진행 방식 기준을 설명해야 합니다. 가장 먼저 준비할 것은 무엇인가요? |
| 9 | `WC-Q-emotionalSupport-002` | `emotionalSupport` | Required | `contract_pending` | 상담 후 걱정된다고 말했더니 상대가 바로 해결책을 제안했습니다. 그 순간 가장 가까운 느낌은 무엇인가요? |
| 10 | `WC-Q-executionSupport-006` | `executionSupport` | Required | `wedding_week` | 본식이 가까워져 업체 연락, 가족 안내, 준비물 확인이 한꺼번에 남았다고 가정하면, 가장 먼저 하고 싶은 것은 무엇인가요? |
| 11 | `WC-Q-decisionPaceRisk-004` | `decisionPaceRisk` | Required | `venue_search`, `contract_pending` | 상담을 다녀온 직후 매우 마음에 들어 바로 정하고 싶은 기분이 듭니다. 무엇이 가장 도움이 될까요? |
| 12 | `WC-Q-guidanceNeed-005` | `guidanceNeed` | Required | `contract_pending` | 견적서를 받았다고 가정하면, 항목명이 낯설고 여러 장으로 나뉘어 있을 때 가장 도움이 되는 것은 무엇인가요? |
| 13 | `WC-Q-costRisk-001` | `costRisk` | Optional boundary | `venue_search`, `contract_pending` | 마음에 드는 예식장이 예상보다 300만 원 비쌉니다. 상담 직후 가장 먼저 확인하고 싶은 것은 무엇인가요? |
| 14 | `WC-Q-roleOwnership-003` | `roleOwnership` | Optional boundary | `sdm_search` | 한 사람은 스타일 비교를 잘하고, 다른 한 사람은 조건 비교를 잘합니다. 준비 방식으로 가장 가까운 것은 무엇인가요? |
| 15 | `WC-Q-evidenceDecision-001` | `evidenceDecision` | Optional boundary | `sdm_search` | 포트폴리오는 마음에 들지만 실제 이용 후기가 많지 않은 스튜디오가 있습니다. 무엇을 먼저 확인하나요? |
| 16 | `WC-Q-coupleAutonomy-002` | `coupleAutonomy` | Optional boundary | `marriage_discussion`, `contracted` | 일부 전통 절차를 간소화하고 싶지만 가족이 어떻게 받아들일지 걱정됩니다. 무엇을 먼저 해보고 싶나요? |

Operating notes:

- Use all 16 if the no-code form completion time remains acceptable.
- If early testers say 16 feels long, run a 12-question required version and rotate optional boundary items across cohorts.
- Randomization is optional. For the first smoke test, fixed order is acceptable so drop-off can be interpreted by position.

## 10. Temporary Feedback Screen

Use a lightweight, non-final screen after the 16 questions.

Korean copy:

```text
답변 감사합니다.

이 화면은 최종 결과가 아니라 문항 연구용 임시 안내입니다.

WeddingCode는 결혼 준비에서 어떤 지원이 더 도움이 되는지 살펴보려는 초기 설계입니다. 예를 들면 비용·계약 확인, 의미와 무드 정리, 상대와 함께 보는 흐름, 가족과의 조율, 정보 압축, 실행 체크리스트 같은 지원이 있습니다.

아직 4글자 코드, 캐릭터, 최종 유형, 점수는 만들지 않았습니다.

아래 피드백 문항에서 질문이 실제 결혼 준비처럼 느껴졌는지, 불편한 표현은 없었는지 알려주세요.
```

Optional internal-only tendency notes:

- 비용·계약 조건 확인 지원
- 의미·무드 정리 지원
- 함께 준비/역할 분담 지원
- 가족 조율/커플 기준 설명 지원
- 공감/실행 순서 조정 지원
- 정보 압축/견적 이해 지원

Do not convert these notes into public result names.

## 11. Feedback Questions

Use a 1-5 scale plus free text where noted.

Scale:

- 1 = 전혀 아니다
- 2 = 아니다
- 3 = 보통이다
- 4 = 그렇다
- 5 = 매우 그렇다

| ID | Question | Response format |
|---|---|---|
| F-001 | 결과가 내 얘기처럼 느껴졌나요? | 1-5 scale |
| F-002 | 질문이 실제 결혼 준비 상황처럼 느껴졌나요? | 1-5 scale |
| F-003 | 이 테스트를 상대에게 보내보고 싶나요? | 1-5 scale |
| F-004 | 커플 리포트를 보고 싶나요? | 1-5 scale |
| F-005 | 아모라에게 이 결과 기반으로 상담받고 싶나요? | 1-5 scale |
| F-006 | 내 견적도 이 결과 기준으로 확인해보고 싶나요? | 1-5 scale |
| F-007 | 불편하거나 낙인처럼 느껴진 표현이 있었나요? | yes/no + free text |
| F-008 | 이해하기 어려운 질문이 있었나요? | yes/no + free text |
| F-009 | 가장 공감된 질문은 무엇인가요? | free text or question picker |
| F-010 | 가장 어색한 질문은 무엇인가요? | free text or question picker |
| F-011 | 질문이 너무 일반적이거나 결혼 준비와 덜 관련 있어 보인 문항이 있었나요? | yes/no + free text |
| F-012 | 성별 역할처럼 느껴진 표현이 있었나요? | yes/no + free text |

## 12. Optional CTA Interest Questions

Ask after feedback, not before.

| CTA | Korean question | Response format | Success metric |
|---|---|---|---|
| Partner invite | 이 테스트를 상대에게 보내 같이 비교해보고 싶나요? | yes/no/maybe or 1-5 | Partner invite intent |
| Couple report | 둘의 결혼 준비 방식이 어떻게 비슷하고 다른지 커플 리포트로 보고 싶나요? | yes/no/maybe or 1-5 | Couple report interest |
| Amora | 이 답변을 바탕으로 아모라에게 다음 행동이나 대화 문장을 추천받고 싶나요? | yes/no/maybe or 1-5 | Amora interest |
| `/check` | 받은 견적이나 계약 조건을 이 답변 기준으로 확인해보고 싶나요? | yes/no/maybe or 1-5 | `/check` interest |

Do not automatically route users to product flows during this smoke test unless the team is explicitly running a separate CTA experiment.

## 13. Success Metrics

| Metric | Provisional threshold | Notes |
|---|---:|---|
| Completion rate | >= 60-65% | Track 12 required completion and full 16 completion separately. |
| Feels-like-me average | >= 4.0 / 5 | From F-001. |
| Scenario realism average | >= 4.0 / 5 | From F-002. |
| Partner invite intent | >= 20% | Use yes/maybe or 4-5/5 depending on form format. |
| Couple report interest | >= 10% | Use yes/maybe or 4-5/5. |
| Amora interest | >= 10-15% | Use yes/maybe or 4-5/5. |
| `/check` interest | >= 5% | Especially analyze participants with quotes or contract-pending stage. |
| Confusing question feedback | < 10% | Per question and overall. |
| Negative/stigma feedback | < 5% | Any repeated stigma signal is a rewrite priority even below threshold. |

## 14. Failure Triggers

Treat the smoke test as failed or needing major revision if any of these occur:

- Completion rate below 50%.
- Feels-like-me average below 3.5 / 5.
- Stigma feedback above 5%.
- Partner invite intent below 10%.
- Many users say the questions feel generic or not wedding-specific.
- Users interpret constructs as gender stereotypes.
- Users think the test is claiming psychological diagnosis or relationship prediction.
- Users repeatedly ask for a final type, character, or score because the framing made it feel like a public personality test.

## 15. Analysis Template

### 15.1 Response Count By Participant Stage

| Stage | Responses | Partner-pair responses | Completion rate | Notes |
|---|---:|---:|---:|---|
| `dating_or_meeting` |  |  |  |  |
| `marriage_discussion` |  |  |  |  |
| `preparing_without_date` |  |  |  |  |
| `venue_search` |  |  |  |  |
| `sdm_search` |  |  |  |  |
| `contract_pending` |  |  |  |  |
| `contracted` |  |  |  |  |
| `wedding_week` |  |  |  |  |
| `post_wedding` |  |  |  |  |

### 15.2 Question-Level Confusion

| Question ID | Confusion count | Confusion rate | Common confusion | Action |
|---|---:|---:|---|---|
| `WC-Q-costRisk-005` |  |  |  | keep / rewrite / remove |
| `WC-Q-experienceMeaning-001` |  |  |  | keep / rewrite / remove |
| `WC-Q-coPreparation-003` |  |  |  | keep / rewrite / remove |
| `WC-Q-roleOwnership-006` |  |  |  | keep / rewrite / remove |
| `WC-Q-evidenceDecision-006` |  |  |  | keep / rewrite / remove |
| `WC-Q-aestheticMood-002` |  |  |  | keep / rewrite / remove |
| `WC-Q-familyIntegration-002` |  |  |  | keep / rewrite / remove |
| `WC-Q-coupleAutonomy-004` |  |  |  | keep / rewrite / remove |
| `WC-Q-emotionalSupport-002` |  |  |  | keep / rewrite / remove |
| `WC-Q-executionSupport-006` |  |  |  | keep / rewrite / remove |
| `WC-Q-decisionPaceRisk-004` |  |  |  | keep / rewrite / remove |
| `WC-Q-guidanceNeed-005` |  |  |  | keep / rewrite / remove |
| `WC-Q-costRisk-001` |  |  |  | keep / rewrite / remove |
| `WC-Q-roleOwnership-003` |  |  |  | keep / rewrite / remove |
| `WC-Q-evidenceDecision-001` |  |  |  | keep / rewrite / remove |
| `WC-Q-coupleAutonomy-002` |  |  |  | keep / rewrite / remove |

### 15.3 Question-Level Stigma Risk

| Question ID | Stigma count | Stigma rate | Reported phrase or issue | Rewrite note |
|---|---:|---:|---|---|
|  |  |  |  |  |

### 15.4 Construct-Level Resonance

This table should be based on participant comments and item-level resonance, not final scoring.

| Construct | Related question IDs | Resonance notes | Product implication | Risk |
|---|---|---|---|---|
| `costRisk` | `WC-Q-costRisk-005`, `WC-Q-costRisk-001` |  | `/check`, quote questions | Avoid "cheap" framing. |
| `experienceMeaning` | `WC-Q-experienceMeaning-001` |  | report, Amora, checklist | Avoid "wasteful" framing. |
| `coPreparation` | `WC-Q-coPreparation-003` |  | partner invite, couple report | Avoid dependence framing. |
| `roleOwnership` | `WC-Q-roleOwnership-006`, `WC-Q-roleOwnership-003` |  | role split, checklist | Avoid disinterest framing. |
| `evidenceDecision` | `WC-Q-evidenceDecision-006`, `WC-Q-evidenceDecision-001` |  | `/check`, community evidence | Avoid superiority framing. |
| `aestheticMood` | `WC-Q-aestheticMood-002` |  | lounge, mood guidance | Avoid superficiality framing. |
| `familyIntegration` | `WC-Q-familyIntegration-002` |  | etiquette, family scripts | Avoid obedience framing. |
| `coupleAutonomy` | `WC-Q-coupleAutonomy-004`, `WC-Q-coupleAutonomy-002` |  | couple criteria, etiquette | Avoid anti-family framing. |
| `emotionalSupport` | `WC-Q-emotionalSupport-002` |  | Amora response order | Internal UX/risk only. |
| `executionSupport` | `WC-Q-executionSupport-006` |  | action cards, checklist | Internal UX/risk only. |
| `decisionPaceRisk` | `WC-Q-decisionPaceRisk-004` |  | pause rule, `/check` | Internal risk prevention only. |
| `guidanceNeed` | `WC-Q-guidanceNeed-005` |  | Amora summary, onboarding | Internal guidance support only. |

### 15.5 CTA Interest

| CTA | Eligible base | Interested count | Interest rate | Segment notes |
|---|---:|---:|---:|---|
| Partner invite | all participants |  |  |  |
| Couple report | all participants |  |  |  |
| Amora guidance | all participants |  |  |  |
| `/check` quote diagnosis | participants with quote or contract concern |  |  |  |

### 15.6 Recommended Keep / Rewrite / Remove Decision

| Question ID | Decision | Reason | Required follow-up |
|---|---|---|---|
|  | keep / rewrite / remove |  |  |

Decision guidance:

- Keep if the item is clear, wedding-specific, low-stigma, and useful for at least one product action.
- Rewrite if confusion is high, construct mapping is blurry, or users mention awkward language.
- Remove if the item feels generic, duplicative, stigmatizing, or not useful for product routing.

## 16. Next-Step Decision Rules

Pass:

- Move to WC-006 expert review package or prototype UI.
- Keep UI lightweight and avoid final public labels unless a later scope explicitly permits them.

Pass with edits:

- Revise the shortlist.
- Rerun a smaller test with 15-30 participants.
- Prioritize items with high confusion, stigma, or construct-overlap risk.

Fail:

- Return to the question bank and domain map.
- Rewrite scenarios before testing again.
- Do not build scoring, public labels, or UI from failed smoke-test material.

## 17. Explicit Non-Goals

- No scoring engine.
- No final 4-letter code.
- No characters.
- No public launch.
- No Amora prompt change.
- No DB storage.
- No final 16 types.
- No couple combination names.
- No psychological diagnosis.
- No relationship counseling.
- No legal advice.
- No marriage success prediction.
- No divorce prediction.

## 18. Manual Operations Checklist

Before launch:

- Confirm the form uses the exact 16 shortlist questions.
- Confirm all answer options come from `06_question_bank_v0.1.md`.
- Confirm the opening disclaimer appears before any question.
- Confirm the form does not show scores, public codes, characters, or type names.
- Confirm feedback questions include stigma and confusion checks.
- Confirm participant stage is required.
- Confirm partner-pair tracking can be done without collecting unnecessary personal data.

During test:

- Watch completion rate after the first 10-20 responses.
- Flag any question that gets repeated free-text confusion.
- Stop or revise if stigma feedback appears repeatedly.
- Track whether quote-having users respond differently to `/check` interest.

After test:

- Fill the analysis templates.
- Classify each question as keep, rewrite, or remove.
- Decide pass, pass with edits, or fail.
- Do not start scoring or final identity design until the decision is recorded.
