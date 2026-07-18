# WeddingCode No-Code Form Build Guide v0.1

> [!CAUTION]
> **HISTORICAL / NOT CURRENT SPEC.** 초기 설계·검토 계보이며 현재 문항·점수·유형·근거·수집·운영
> 승인으로 사용하지 않는다. 현행 상태는 [`README.md`](./README.md)와
> [`62`](./62_wedding_code_master_design_and_current_state_2026-07-18.md)를 따른다.

## 0. Scope

This guide explains how to build the 3-minute WeddingCode smoke test in a no-code form tool such as Typeform, Tally, or Google Forms.

This guide does not add UI, routes, database migrations, scoring logic, final public 4-letter codes, final 16 types, characters, couple combination names, or Amora prompt changes.

## 1. Source Inputs

- `docs/wedding-code/07_smoke_test_shortlist_v0.2.md`
- `docs/wedding-code/08_smoke_test_pack_v0.2.md`
- `docs/wedding-code/09_expert_review_pack_v0.2.md`
- `docs/wedding-code/05_question_domain_map.md`

## 2. Form Purpose

This is a prototype smoke test.

The form checks:

- Whether the WeddingCode questions are clear.
- Whether the questions feel relevant to real wedding preparation.
- Whether the wording feels neutral and non-stigmatizing.
- Whether users show interest in partner invite, couple report, Amora guidance, and `/check` quote diagnosis.

This form does not validate a psychological test. It should not be described as a validated assessment, diagnosis, compatibility test, or final WeddingCode result.

## 3. Recommended Tool Setup

| Tool | Use when | Notes |
|---|---|---|
| Tally | You want fast setup with decent UX and simple conditional logic. | Recommended for speed plus cleaner mobile experience than a basic spreadsheet-like form. |
| Typeform | You want polished UX, branching, drop-off tracking, and better one-question-at-a-time flow. | Recommended if the team wants a smoother 3-minute experience. |
| Google Forms | Speed and easy sharing matter more than UX. | Recommended if the team needs the fastest internal or early external dry run. |

Recommended choice:

- Use Tally or Typeform if branching, mobile readability, and user experience are important.
- Use Google Forms if speed is most important.

## 4. Form Title And Intro Copy In Korean

Recommended title:

```text
웨딩 준비 성향 테스트 프로토타입
```

Recommended intro copy:

```text
결혼 준비를 하다 보면 예산, 견적, 분위기, 가족 조율, 상대와의 역할 분담처럼 여러 기준을 함께 보게 됩니다.

이 테스트는 실제 결혼 준비 상황형 질문을 통해 어떤 질문이 이해하기 쉽고 공감되는지 확인하기 위한 3분짜리 프로토타입입니다.

아직 최종 유형이나 점수를 만들지 않습니다. 답변은 문항 품질과 제품 설계를 개선하는 데 사용됩니다.
```

Do not use these phrases in the title or intro:

- `검증된 검사`
- `심리검사`
- `궁합`
- `MBTI`
- `최종 유형`
- `4글자 코드`
- `캐릭터 결과`

## 5. Consent And Disclaimer Block In Korean

Place this before participant context questions.

```text
이 테스트는 WeddingCode 문항을 확인하기 위한 프로토타입입니다.

질문은 결혼 준비 과정에서 비용, 의미, 상대와의 준비 방식, 가족 조율, 계약 확인, 정보 과부하 같은 의사결정 경향을 이해하기 위해 만들어졌습니다.

이 테스트는 심리 진단, 관계 상담, 법률 자문, 결혼 성공 예측, 이혼 예측이 아닙니다.

답변은 문항 품질을 개선하고 제품 설계를 더 안전하고 유용하게 만들기 위한 목적으로 사용됩니다.

이번 테스트에서는 최종 유형, 점수, 4글자 코드, 캐릭터를 부여하지 않습니다.
```

Consent field:

| Field ID | Question | Format | Options |
|---|---|---|---|
| `consent` | 위 내용을 읽고 프로토타입 테스트에 참여하시겠어요? | single choice | 예, 참여합니다 / 아니요 |

End the form if the user selects `아니요`.

## 6. Section Structure

Build the form in this order:

1. Intro
2. Consent / disclaimer
3. Participant context
4. 12 required questions
5. 4 optional boundary questions
6. Feedback questions
7. CTA interest questions
8. Free-text feedback
9. Thank-you screen

Recommended timing:

| Section | Target time |
|---|---:|
| Intro and consent | 20-30 seconds |
| Participant context | 30-45 seconds |
| 12 required questions | 2 minutes |
| 4 optional boundary questions | 45-60 seconds |
| Feedback and CTA interest | 1-2 minutes |

## 7. Participant Context Questions

| Field ID | Question | Format | Options |
|---|---|---|---|
| `participant_stage` | 지금 결혼 준비 단계는 어디에 가장 가깝나요? | single choice | `dating_or_meeting`, `marriage_discussion`, `preparing_without_date`, `venue_search`, `sdm_search`, `contract_pending`, `contracted`, `wedding_week`, `post_wedding` |
| `partner_participation` | 이번 테스트는 어떻게 참여하고 있나요? | single choice | 혼자 답변 / 상대와 같이 보며 답변 / 상대도 따로 답변 예정 / 해당 없음 |
| `quote_status` | 업체 견적을 받아본 적이 있나요? | single choice | 아직 없음 / 상담만 해봄 / 견적을 받음 / 계약함 |
| `parent_involvement` | 부모님 또는 가족이 결혼 준비 결정에 어느 정도 관여하고 있나요? | single choice | 낮음 / 보통 / 높음 / 아직 모르겠음 |
| `biggest_concern` | 지금 가장 큰 결혼 준비 고민은 무엇인가요? | multiple choice + optional text | 예산·견적 / 예식장 / 스드메 / 가족 조율 / 상대와 역할 분담 / 일정 관리 / 정보가 너무 많음 / 아직 잘 모름 / 기타 |
| `answering_mode` | 답변은 혼자 하고 있나요, 상대와 함께 하고 있나요? | single choice | 혼자 / 상대와 함께 / 상황에 따라 같이 이야기함 / 해당 없음 |

Builder note:

- If `participant_stage` is `contract_pending`, `contracted`, or the user has received a quote, keep `/check` CTA visible.
- If the tool supports branching, partner invite and couple report CTA can be emphasized when `partner_participation` is not `상대와 같이 보며 답변`.

## 8. 16 Question Import Table

Use these 16 questions from `07_smoke_test_shortlist_v0.2.md`.

Recommended response format:

- Use single choice / forced choice.
- Import the A-D response options from `06_question_bank_v0.1.md`.
- Do not show construct names to participants.
- Do not attach scores or result labels to response options.

| Order | Required / optional | Question ID | Target construct | Secondary constructs | Journey stage | Question text | Recommended response format | Response options placeholder if not finalized | Notes for form builder |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | Required | `WC-Q-costRisk-005` | `costRisk` | `evidenceDecision` | `sdm_search`, `contract_pending` | 스튜디오 패키지가 좋아 보이지만 원본, 보정, 헬퍼, 얼리스타트 비용이 분명하지 않습니다. 가장 먼저 할 일은 무엇인가요? | single choice / forced choice | 원문 A-D 옵션 import | Keep early because quote clarity is concrete and product-relevant. |
| 2 | Required | `WC-Q-experienceMeaning-001` | `experienceMeaning` | `costRisk` | `sdm_search` | 본식 의상이나 촬영 스타일 중 하나가 오래 기억에 남을 것 같지만 추가 비용이 있습니다. 무엇을 먼저 생각하나요? | single choice / forced choice | 원문 A-D 옵션 import | Avoid dress-only framing; keep the v0.2 wording. |
| 3 | Required | `WC-Q-coPreparation-003` | `coPreparation` | `evidenceDecision` | `contract_pending` | 상담 후 마음에 드는 업체가 생겼지만 상대는 아직 자세히 보지 못했습니다. 무엇이 먼저 필요하다고 느끼나요? | single choice / forced choice | 원문 A-D 옵션 import | Useful for partner invite and couple report interest. |
| 4 | Required | `WC-Q-roleOwnership-006` | `roleOwnership` | `evidenceDecision` | `contract_pending`, `contracted` | 한 사람이 업체 후보를 먼저 알아봤고, 계약 전에는 둘 다 최종 확인하려고 합니다. 어떤 방식으로 확인하는 게 가장 필요할까요? | single choice / forced choice | 원문 A-D 옵션 import | Keep as shared final-confirmation wording, not one-sided ownership. |
| 5 | Required | `WC-Q-evidenceDecision-006` | `evidenceDecision` | `decisionPaceRisk` | `contract_pending` | 상담 중 서비스 추가를 약속받았지만 계약서에는 아직 없습니다. 다음 행동으로 가장 가까운 것은 무엇인가요? | single choice / forced choice | 원문 A-D 옵션 import | Strong `/check` and contract evidence signal. |
| 6 | Required | `WC-Q-aestheticMood-002` | `aestheticMood` | `familyIntegration` | `venue_search` | 투어 중 한 홀에 들어갔을 때 분위기가 우리와 잘 맞는다고 느꼈습니다. 무엇을 먼저 확인하고 싶나요? | single choice / forced choice | 원문 A-D 옵션 import | Do not present mood as irrational or superficial. |
| 7 | Required | `WC-Q-familyIntegration-002` | `familyIntegration` | `aestheticMood` | `venue_search` | 우리는 분위기가 좋은 예식장이 끌리지만 부모님은 음식과 교통을 더 중요하게 봅니다. 무엇을 먼저 해보고 싶나요? | single choice / forced choice | 원문 A-D 옵션 import | Keep neutral toward parents and couple preference. |
| 8 | Required | `WC-Q-coupleAutonomy-004` | `coupleAutonomy` | `emotionalSupport` | `marriage_discussion`, `preparing_without_date` | 부모님께 우리 결혼식의 예산·하객수·진행 방식 기준을 설명해야 합니다. 가장 먼저 준비할 것은 무엇인가요? | single choice / forced choice | 원문 A-D 옵션 import | Keep autonomy as respectful criteria-setting. |
| 9 | Required | `WC-Q-emotionalSupport-002` | `emotionalSupport` | `executionSupport` | `contract_pending` | 상담 후 걱정된다고 말했더니 상대가 바로 해결책을 제안했습니다. 그 순간 가장 가까운 느낌은 무엇인가요? | single choice / forced choice | 원문 A-D 옵션 import | Internal UX/risk construct only; do not label user publicly. |
| 10 | Required | `WC-Q-executionSupport-006` | `executionSupport` | `roleOwnership` | `wedding_week` | 본식이 가까워져 업체 연락, 가족 안내, 준비물 확인이 한꺼번에 남았다고 가정하면, 가장 먼저 하고 싶은 것은 무엇인가요? | single choice / forced choice | 원문 A-D 옵션 import | Internal UX/risk construct only; good action-card signal. |
| 11 | Required | `WC-Q-decisionPaceRisk-004` | `decisionPaceRisk` | `emotionalSupport` | `venue_search`, `contract_pending` | 상담을 다녀온 직후 매우 마음에 들어 바로 정하고 싶은 기분이 듭니다. 무엇이 가장 도움이 될까요? | single choice / forced choice | 원문 A-D 옵션 import | Frame as pause-rule support, not impulsiveness. |
| 12 | Required | `WC-Q-guidanceNeed-005` | `guidanceNeed` | `costRisk` | `contract_pending` | 견적서를 받았다고 가정하면, 항목명이 낯설고 여러 장으로 나뉘어 있을 때 가장 도움이 되는 것은 무엇인가요? | single choice / forced choice | 원문 A-D 옵션 import | Internal guidance support; connects to Amora and `/check`. |
| 13 | Optional boundary | `WC-Q-costRisk-001` | `costRisk` | `experienceMeaning` | `venue_search`, `contract_pending` | 마음에 드는 예식장이 예상보다 300만 원 비쌉니다. 상담 직후 가장 먼저 확인하고 싶은 것은 무엇인가요? | single choice / forced choice | 원문 A-D 옵션 import | Boundary: cost safety vs experience meaning. |
| 14 | Optional boundary | `WC-Q-roleOwnership-003` | `roleOwnership` | `coPreparation` | `sdm_search` | 한 사람은 스타일 비교를 잘하고, 다른 한 사람은 조건 비교를 잘합니다. 준비 방식으로 가장 가까운 것은 무엇인가요? | single choice / forced choice | 원문 A-D 옵션 import | Boundary: shared preparation vs strength-based ownership. |
| 15 | Optional boundary | `WC-Q-evidenceDecision-001` | `evidenceDecision` | `aestheticMood` | `sdm_search` | 포트폴리오는 마음에 들지만 실제 이용 후기가 많지 않은 스튜디오가 있습니다. 무엇을 먼저 확인하나요? | single choice / forced choice | 원문 A-D 옵션 import | Boundary: visual fit vs verifiable evidence. |
| 16 | Optional boundary | `WC-Q-coupleAutonomy-002` | `coupleAutonomy` | `familyIntegration` | `marriage_discussion`, `contracted` | 일부 전통 절차를 간소화하고 싶지만 가족이 어떻게 받아들일지 걱정됩니다. 무엇을 먼저 해보고 싶나요? | single choice / forced choice | 원문 A-D 옵션 import | Boundary: couple simplification vs family integration. |

## 9. Feedback Questions

Use 1-5 ratings unless noted.

Scale:

- 1 = 전혀 아니다
- 2 = 아니다
- 3 = 보통이다
- 4 = 그렇다
- 5 = 매우 그렇다

| Field ID | Korean question | Format | Export column |
|---|---|---|---|
| `feels_like_me` | 내 얘기처럼 느껴졌다 | 1-5 rating | `feels_like_me` |
| `scenario_realism` | 실제 결혼 준비 상황처럼 느껴졌다 | 1-5 rating | `scenario_realism` |
| `clarity` | 질문이 이해하기 쉬웠다 | 1-5 rating | `clarity` |
| `partner_invite_interest` | 상대에게 보내보고 싶다 | 1-5 rating | `partner_invite_interest` |
| `couple_report_interest` | 커플 리포트를 보고 싶다 | 1-5 rating | `couple_report_interest` |
| `amora_interest` | 아모라에게 이 결과 기반으로 상담받고 싶다 | 1-5 rating | `amora_interest` |
| `quote_check_interest` | 내 견적도 이 결과 기준으로 확인해보고 싶다 | 1-5 rating | `quote_check_interest` |
| `stigma_feedback_rating` | 불편하거나 평가받는 느낌이 있었다 | 1-5 rating, reverse risk metric | `stigma_feedback` |
| `confusing_question_rating` | 헷갈리는 질문이 있었다 | 1-5 rating, reverse risk metric | `confusing_question_feedback` |

Builder note:

- For `stigma_feedback_rating`, higher values mean more risk.
- For `confusing_question_rating`, higher values mean more confusion.
- Add free-text follow-ups when either risk rating is 4 or 5 if the tool supports branching.

## 10. CTA Interest Section

Ask these after the feedback ratings.

| Field ID | Korean question | Format | Export column |
|---|---|---|---|
| `partner_invite_cta` | 이 테스트를 상대에게 보내 같이 비교해보고 싶나요? | yes / no / maybe or 1-5 | `partner_invite_interest` |
| `couple_report_cta` | 둘의 결혼 준비 방식이 어떻게 비슷하고 다른지 커플 리포트로 보고 싶나요? | yes / no / maybe or 1-5 | `couple_report_interest` |
| `amora_cta` | 이 답변을 바탕으로 아모라에게 다음 행동이나 대화 문장을 추천받고 싶나요? | yes / no / maybe or 1-5 | `amora_interest` |
| `quote_check_cta` | 받은 견적이나 계약 조건을 이 답변 기준으로 확인해보고 싶나요? | yes / no / maybe or 1-5 | `quote_check_interest` |
| `etiquette_checklist_cta` | 가족 조율, 예절, 준비 체크리스트를 이 답변 기준으로 받아보고 싶나요? | yes / no / maybe or 1-5 | `etiquette_checklist_interest` |

Do not route users into a production feature from this prototype unless a separate experiment explicitly permits it.

## 11. Free-Text Feedback

| Field ID | Korean question | Format | Export column |
|---|---|---|---|
| `most_relatable_question` | 가장 공감된 질문은 무엇인가요? | free text or question picker | `most_relatable_question` |
| `most_awkward_question` | 가장 어색한 질문은 무엇인가요? | free text or question picker | `most_awkward_question` |
| `stigma_feedback_text` | 불편하거나 평가받는 느낌이 든 표현이 있었다면 적어주세요. | free text | `stigma_feedback` |
| `confusing_question_text` | 이해하기 어렵거나 헷갈린 질문이 있었다면 적어주세요. | free text | `confusing_question_feedback` |
| `free_text_feedback` | 마지막으로 남기고 싶은 의견이 있다면 적어주세요. | free text | `free_text_feedback` |

## 12. Data Export Columns

Export these exact columns for analysis:

```text
response_id
submitted_at
participant_stage
partner_participation
quote_status
parent_involvement
biggest_concern
q_01
q_02
q_03
q_04
q_05
q_06
q_07
q_08
q_09
q_10
q_11
q_12
q_13
q_14
q_15
q_16
feels_like_me
scenario_realism
clarity
partner_invite_interest
couple_report_interest
amora_interest
quote_check_interest
stigma_feedback
confusing_question_feedback
free_text_feedback
```

Optional extra columns:

```text
answering_mode
etiquette_checklist_interest
most_relatable_question
most_awkward_question
completion_time_seconds
device_type
```

Column naming notes:

- Map `q_01` through `q_16` to the 16 import-table orders.
- Store raw selected option labels. Do not calculate scores in the form.
- If the tool exports text labels instead of IDs, keep a separate mapping sheet.

## 13. Success And Failure Thresholds

Use the existing smoke test thresholds.

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

Before launch:

- Build the form.
- Add the consent/disclaimer before all questions.
- Import the 12 required questions.
- Import the 4 optional boundary questions.
- Import A-D answer options from the source question bank.
- Confirm no construct labels, scores, public codes, characters, or final types are shown to participants.
- Test internally 3 times.
- Check mobile readability.
- Check that question text does not wrap awkwardly on mobile.
- Check export columns.
- Confirm `q_01` through `q_16` map to the right question IDs.

Dry run:

- Run with a small internal dry run first.
- Ask dry-run participants to report unclear wording immediately.
- Confirm completion time.
- Confirm export file is analyzable.

Launch:

- Recruit 100 people.
- Track completion after the first 10-20 responses.
- Pause if stigma or diagnosis-risk feedback appears repeatedly.
- Keep the test labeled as a prototype smoke test until review and analysis are complete.

## 15. Explicit Non-Goals

- No scoring.
- No final 4-letter code.
- No characters.
- No final 16 types.
- No product UI.
- No Amora prompt changes.
- No DB storage.
- No couple combination names.
- No public launch.
- No psychological diagnosis.
- No relationship counseling.
- No legal advice.
- No marriage success prediction.
- No divorce prediction.

## 16. Thank-You Screen Copy In Korean

```text
참여해주셔서 감사합니다.

이번 테스트는 최종 결과를 제공하는 검사가 아니라, WeddingCode 문항이 실제 결혼 준비 상황처럼 느껴지는지 확인하기 위한 프로토타입입니다.

남겨주신 답변은 문항을 더 명확하고 안전하게 다듬는 데 사용됩니다.
```

Do not show scores, type names, public codes, or characters on the thank-you screen.
