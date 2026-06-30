# WeddingCode Expert Review Pack v0.1

## 0. Scope

This document is a practical expert/internal review pack for the 16-question WeddingCode smoke test shortlist.

This review pack does not create UI, routes, database migrations, scoring logic, final public 4-letter codes, final 16 types, characters, couple combination names, Amora prompt changes, or public launch materials.

Do not modify the question bank, shortlist, or smoke test pack during this review task. Record reviewer feedback here or in a copied spreadsheet, then revise source files in a later scoped task.

## 1. Source Inputs

- `docs/wedding-code/08_smoke_test_pack_v0.1.md`
- `docs/wedding-code/07_smoke_test_shortlist_v0.1.md`
- `docs/wedding-code/06_question_bank_review.md`
- `docs/wedding-code/06_question_bank_v0.1.md`
- `docs/wedding-code/05_question_domain_map.md`

## 2. Review Purpose

This is not final validation.

The purpose is to run a short pre-smoke-test review before the 100-person manual/no-code smoke test. The review should catch questions that are unclear, biased, stigmatizing, gendered, unrealistic, too generic, or poorly mapped to their intended WeddingCode construct.

Reviewers should focus on whether each question feels like a real wedding-preparation situation and whether the wording is safe enough to show to users in a prototype research test.

## 3. Reviewer Target

Recommended reviewer group: 8-10 reviewers.

| Reviewer type | Target count | Why included |
|---|---:|---|
| Wedding planner | 1-2 | Checks wedding realism, vendor/contract scenario realism, and practical language. |
| Recently married users | 2 | Checks whether scenarios match lived preparation memories. |
| Engaged couples | 2 couples | Checks couple conversation usefulness and partner-pair interpretation. |
| Counselor, UX researcher, or product researcher | 1 | Checks bias, stigma, framing, and research safety. |
| Internal team reviewers | 1-2 | Checks product mapping to Amora, `/check`, etiquette guide, checklist, and couple report. |

## 4. Reviewer Briefing In Korean

Use this copy when sending the review pack.

```text
WeddingCode는 결혼 준비 과정에서 사람들이 어떤 의사결정 지원을 필요로 하는지 알아보기 위한 프로토타입 문항입니다.

이것은 MBTI가 아니며, MBTI 이름·질문·유형 설명·이론 구조를 사용하지 않습니다.

이것은 심리 진단, 관계 상담, 법률 자문, 결혼 성공 예측, 이혼 예측이 아닙니다.

이번 리뷰의 목적은 100명 대상 3분 smoke test 전에 문항이 실제 결혼 준비 상황처럼 느껴지는지, 문장이 명확한지, 특정 성별·가족·감정·비용 태도를 낙인찍지 않는지 확인하는 것입니다.

각 문항을 보면서 "이 질문이 실제 웨딩 상황 같은가?", "문장이 쉽게 이해되는가?", "답변 선택지가 좋은 사람/나쁜 사람처럼 느껴지지 않는가?", "커플 대화나 제품 도움으로 이어질 수 있는가?"를 봐주세요.

최종 유형, 점수, 캐릭터, 4글자 코드는 아직 만들지 않습니다. 리뷰는 문항 품질과 안전성을 보기 위한 단계입니다.
```

## 5. What Reviewers Should Check

Reviewers should check every shortlist question for:

- Real wedding situation.
- Clear wording.
- No gender stereotype.
- No shame or stigma.
- No good-person versus bad-person framing.
- Clear target construct.
- Useful for couple conversation.
- Useful for at least one product surface: Amora, `/check`, etiquette guide, checklist, couple report, or onboarding.
- Suitable for a 3-minute smoke test.

Construct-specific guardrails:

- `emotionalSupport`, `executionSupport`, `decisionPaceRisk`, and `guidanceNeed` are internal UX/risk support constructs, not public identity labels.
- `familyIntegration` and `coupleAutonomy` should remain separate unless later data supports a different relationship.
- `costRisk` and `evidenceDecision` may overlap, but cost safety and evidence preference should stay distinguishable.
- `experienceMeaning` and `aestheticMood` may overlap, but lasting meaning and visual/mood fit should stay distinguishable.

## 6. Review Scale

Use a 1-5 scale.

| Dimension | 1 | 3 | 5 |
|---|---|---|---|
| 현실성 | 실제 웨딩 상황 같지 않음 | 어느 정도 가능하지만 평범하거나 애매함 | 실제 결혼 준비에서 충분히 있을 법함 |
| 명확성 | 문장이 헷갈림 | 이해는 되지만 한 번 더 읽게 됨 | 바로 이해됨 |
| 중립성 | 특정 선택을 나쁘게 느끼게 함 | 약간 한쪽으로 기움 | 어떤 선택도 평가하지 않음 |
| 불쾌/낙인 위험 낮음 | 낙인·비난·수치심 위험이 큼 | 일부 단어가 조심스러움 | 불편하거나 낙인처럼 느껴질 위험이 낮음 |
| 커플 대화 도움 가능성 | 대화에 도움 되지 않음 | 일부 도움 가능 | 상대와 이야기하기 좋은 소재가 됨 |
| 3분 테스트 적합성 | 너무 길거나 복잡함 | 사용 가능하지만 다듬으면 좋음 | 짧고 선명해서 3분 테스트에 적합함 |

Important:

- For "Stigma risk?" in the per-question table, 1 means high risk and 5 means low risk.
- If a reviewer gives a stigma score of 1 or 2, require a note.

## 7. Per-Question Review Table

Copy this table into a spreadsheet and ask each reviewer to fill the scoring columns.

| Question ID | Target construct | Question text | Realistic? 1-5 | Clear? 1-5 | Neutral? 1-5 | Stigma risk? 1-5 where 1 is high risk and 5 is low risk | Couple usefulness? 1-5 | Keep / rewrite / remove | Reviewer notes |
|---|---|---|---:|---:|---:|---:|---:|---|---|
| `WC-Q-costRisk-005` | `costRisk` | 스튜디오 패키지가 좋아 보이지만 원본, 보정, 헬퍼, 얼리스타트 비용이 분명하지 않습니다. 가장 먼저 할 일은 무엇인가요? |  |  |  |  |  |  |  |
| `WC-Q-experienceMeaning-001` | `experienceMeaning` | 입어본 드레스 중 하나가 사진에 오래 남을 것 같지만 추가 비용이 있습니다. 무엇을 먼저 생각하나요? |  |  |  |  |  |  |  |
| `WC-Q-coPreparation-003` | `coPreparation` | 상담 후 마음에 드는 업체가 생겼지만 상대는 아직 자세히 보지 못했습니다. 무엇이 먼저 필요하다고 느끼나요? |  |  |  |  |  |  |  |
| `WC-Q-roleOwnership-006` | `roleOwnership` | 한 사람이 업체를 알아봤지만 계약 전에는 둘 다 확인해야 할 것 같습니다. 어떤 기준이 가장 필요합니까? |  |  |  |  |  |  |  |
| `WC-Q-evidenceDecision-006` | `evidenceDecision` | 상담 중 서비스 추가를 약속받았지만 계약서에는 아직 없습니다. 다음 행동으로 가장 가까운 것은 무엇인가요? |  |  |  |  |  |  |  |
| `WC-Q-aestheticMood-002` | `aestheticMood` | 투어 중 한 홀에 들어갔을 때 분위기가 우리와 잘 맞는다고 느꼈습니다. 무엇을 먼저 확인하고 싶나요? |  |  |  |  |  |  |  |
| `WC-Q-familyIntegration-002` | `familyIntegration` | 우리는 분위기가 좋은 예식장이 끌리지만 부모님은 음식과 교통을 더 중요하게 봅니다. 무엇을 먼저 해보고 싶나요? |  |  |  |  |  |  |  |
| `WC-Q-coupleAutonomy-004` | `coupleAutonomy` | 부모님께 우리의 결혼식 기준을 설명해야 합니다. 어떤 준비가 가장 먼저 필요하다고 느끼나요? |  |  |  |  |  |  |  |
| `WC-Q-emotionalSupport-002` | `emotionalSupport` | 상담 후 걱정된다고 말했는데 상대가 바로 "그럼 다른 데 알아보자"라고 답했습니다. 가장 가까운 느낌은 무엇인가요? |  |  |  |  |  |  |  |
| `WC-Q-executionSupport-006` | `executionSupport` | 예식 주간에 업체 연락, 가족 안내, 준비물 확인이 한꺼번에 남았습니다. 가장 먼저 하고 싶은 것은 무엇인가요? |  |  |  |  |  |  |  |
| `WC-Q-decisionPaceRisk-004` | `decisionPaceRisk` | 상담을 다녀온 직후 매우 마음에 들어 바로 정하고 싶은 기분이 듭니다. 무엇이 가장 도움이 될까요? |  |  |  |  |  |  |  |
| `WC-Q-guidanceNeed-005` | `guidanceNeed` | 견적서가 여러 장이고 항목명이 낯섭니다. 가장 도움이 되는 것은 무엇인가요? |  |  |  |  |  |  |  |
| `WC-Q-costRisk-001` | `costRisk` | 마음에 드는 예식장이 예상보다 300만 원 비쌉니다. 상담 직후 가장 먼저 확인하고 싶은 것은 무엇인가요? |  |  |  |  |  |  |  |
| `WC-Q-roleOwnership-003` | `roleOwnership` | 한 사람은 스타일 비교를 잘하고, 다른 한 사람은 조건 비교를 잘합니다. 준비 방식으로 가장 가까운 것은 무엇인가요? |  |  |  |  |  |  |  |
| `WC-Q-evidenceDecision-001` | `evidenceDecision` | 포트폴리오는 마음에 들지만 실제 이용 후기가 많지 않은 스튜디오가 있습니다. 무엇을 먼저 확인하나요? |  |  |  |  |  |  |  |
| `WC-Q-coupleAutonomy-002` | `coupleAutonomy` | 일부 전통 절차를 간소화하고 싶지만 가족이 어떻게 받아들일지 걱정됩니다. 무엇을 먼저 해보고 싶나요? |  |  |  |  |  |  |  |

## 8. Construct-Level Review Table

Reviewers do not need to evaluate psychometrics here. They should judge whether each selected question appears to represent its intended construct and whether it overlaps too much with another construct.

| Construct key | Related shortlist question IDs | Does this question represent the construct? | Does it overlap too much with another construct? | Recommended change |
|---|---|---|---|---|
| `costRisk` | `WC-Q-costRisk-005`, `WC-Q-costRisk-001` |  |  |  |
| `experienceMeaning` | `WC-Q-experienceMeaning-001` |  |  |  |
| `coPreparation` | `WC-Q-coPreparation-003` |  |  |  |
| `roleOwnership` | `WC-Q-roleOwnership-006`, `WC-Q-roleOwnership-003` |  |  |  |
| `evidenceDecision` | `WC-Q-evidenceDecision-006`, `WC-Q-evidenceDecision-001` |  |  |  |
| `aestheticMood` | `WC-Q-aestheticMood-002` |  |  |  |
| `familyIntegration` | `WC-Q-familyIntegration-002` |  |  |  |
| `coupleAutonomy` | `WC-Q-coupleAutonomy-004`, `WC-Q-coupleAutonomy-002` |  |  |  |
| `emotionalSupport` | `WC-Q-emotionalSupport-002` |  |  |  |
| `executionSupport` | `WC-Q-executionSupport-006` |  |  |  |
| `decisionPaceRisk` | `WC-Q-decisionPaceRisk-004` |  |  |  |
| `guidanceNeed` | `WC-Q-guidanceNeed-005` |  |  |  |

## 9. Bias And Safety Checklist

Use this checklist at the end of each reviewer session.

| Risk area | Reviewer check | Found? | Notes / question IDs |
|---|---|---|---|
| Gender stereotype | Does the wording imply one gender owns money, style, family communication, contracts, emotions, or planning work? | yes / no |  |
| Partner-blaming | Does the wording make one partner sound uninterested, careless, cold, needy, controlling, or wrong? | yes / no |  |
| Parent-blaming | Does the wording make parents or families sound like the problem rather than a real coordination factor? | yes / no |  |
| Money-shaming | Does the wording shame cost checking, budget limits, or concern about hidden fees? | yes / no |  |
| Emotion-shaming | Does the wording shame emotional meaning, stress, worry, or need for empathy? | yes / no |  |
| Autonomy-shaming | Does the wording make couple-defined standards sound selfish, immature, or disrespectful? | yes / no |  |
| Family-shaming | Does the wording make family integration sound blind, old-fashioned, or lacking independence? | yes / no |  |
| Pressure-to-contract risk language | Does the wording blame the user instead of naming sales pressure, unclear terms, or need for a pause rule? | yes / no |  |
| Psychological diagnosis risk | Does the wording sound like it is diagnosing personality, relationship health, marriage success, or divorce risk? | yes / no |  |

Safety red flags:

- Any gender-stereotype finding should trigger rewrite before the 100-person smoke test.
- Any stigma score of 1 or 2 should trigger rewrite or removal.
- Any psychological-diagnosis interpretation should trigger changes to wording or framing.

## 10. Decision Rules

Use these rules after all reviewer scores are collected.

| Decision | Rule |
|---|---|
| Keep | Average score >= 4.0 and no major safety concern. |
| Rewrite | Average score 3.0-3.9, wording confusion appears, construct mapping is blurry, or one safety concern can be fixed by wording. |
| Remove | Average score < 3.0, strong stigma risk, gender stereotype risk, or unclear construct mapping that cannot be fixed quickly. |

Average score guidance:

- For each question, average the six review dimensions: realism, clarity, neutrality, low stigma risk, couple usefulness, and 3-minute suitability.
- Treat safety concerns as overrides. A high average score does not save a question with clear stigma, gender stereotype, or diagnosis risk.
- Keep notes about construct overlap separate from user-facing wording risk.

## 11. Review Output Template

Copy this section into a spreadsheet or review summary document.

### 11.1 Reviewer Metadata

| Field | Value |
|---|---|
| Reviewer ID |  |
| Reviewer type | wedding planner / recently married / engaged user / partner pair / counselor / UX researcher / product researcher / internal |
| Review date |  |
| Reviewed version | `09_expert_review_pack_v0.1` |
| Notes |  |

### 11.2 Per-Question Summary

| Question ID | Realism avg | Clarity avg | Neutrality avg | Low-stigma avg | Couple usefulness avg | 3-min suitability avg | Overall avg | Safety flag count | Decision | Main rewrite note |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| `WC-Q-costRisk-005` |  |  |  |  |  |  |  |  | keep / rewrite / remove |  |
| `WC-Q-experienceMeaning-001` |  |  |  |  |  |  |  |  | keep / rewrite / remove |  |
| `WC-Q-coPreparation-003` |  |  |  |  |  |  |  |  | keep / rewrite / remove |  |
| `WC-Q-roleOwnership-006` |  |  |  |  |  |  |  |  | keep / rewrite / remove |  |
| `WC-Q-evidenceDecision-006` |  |  |  |  |  |  |  |  | keep / rewrite / remove |  |
| `WC-Q-aestheticMood-002` |  |  |  |  |  |  |  |  | keep / rewrite / remove |  |
| `WC-Q-familyIntegration-002` |  |  |  |  |  |  |  |  | keep / rewrite / remove |  |
| `WC-Q-coupleAutonomy-004` |  |  |  |  |  |  |  |  | keep / rewrite / remove |  |
| `WC-Q-emotionalSupport-002` |  |  |  |  |  |  |  |  | keep / rewrite / remove |  |
| `WC-Q-executionSupport-006` |  |  |  |  |  |  |  |  | keep / rewrite / remove |  |
| `WC-Q-decisionPaceRisk-004` |  |  |  |  |  |  |  |  | keep / rewrite / remove |  |
| `WC-Q-guidanceNeed-005` |  |  |  |  |  |  |  |  | keep / rewrite / remove |  |
| `WC-Q-costRisk-001` |  |  |  |  |  |  |  |  | keep / rewrite / remove |  |
| `WC-Q-roleOwnership-003` |  |  |  |  |  |  |  |  | keep / rewrite / remove |  |
| `WC-Q-evidenceDecision-001` |  |  |  |  |  |  |  |  | keep / rewrite / remove |  |
| `WC-Q-coupleAutonomy-002` |  |  |  |  |  |  |  |  | keep / rewrite / remove |  |

### 11.3 Construct Summary

| Construct key | Representative quality | Overlap risk | Safety risk | Recommended action |
|---|---|---|---|---|
| `costRisk` |  |  |  |  |
| `experienceMeaning` |  |  |  |  |
| `coPreparation` |  |  |  |  |
| `roleOwnership` |  |  |  |  |
| `evidenceDecision` |  |  |  |  |
| `aestheticMood` |  |  |  |  |
| `familyIntegration` |  |  |  |  |
| `coupleAutonomy` |  |  |  |  |
| `emotionalSupport` |  |  |  |  |
| `executionSupport` |  |  |  |  |
| `decisionPaceRisk` |  |  |  |  |
| `guidanceNeed` |  |  |  |  |

### 11.4 Final Review Summary

| Summary item | Notes |
|---|---|
| Questions to keep |  |
| Questions to rewrite |  |
| Questions to remove |  |
| Highest-risk safety issue |  |
| Most realistic question |  |
| Least realistic question |  |
| Most useful for couple conversation |  |
| Most useful for Amora |  |
| Most useful for `/check` |  |
| Most useful for etiquette/checklist |  |
| Go / revise / no-go before smoke test |  |

## 12. Next Step After Review

After the 8-10 reviewer pass:

1. Revise the shortlist based on keep / rewrite / remove decisions.
2. Create WC-007 smoke test form build guide.
3. Then run the 100-person smoke test.

Do not proceed to scoring, public labels, characters, or final type design from expert review alone.

## 13. Explicit Non-Goals

- No UI.
- No routes.
- No database migrations.
- No scoring engine.
- No final public 4-letter code.
- No final 16 types.
- No characters.
- No couple combination names.
- No Amora prompt changes.
- No psychological diagnosis.
- No relationship counseling.
- No legal advice.
- No marriage success prediction.
- No divorce prediction.

## 14. Internal Construct Reminder

The following constructs must remain internal UX/risk constructs during expert review and smoke testing:

- `emotionalSupport`
- `executionSupport`
- `decisionPaceRisk`
- `guidanceNeed`

Reviewer language should describe these as support needs, risk-prevention signals, or product-routing signals. They should not be treated as public identities, final user types, or labels shown to users.
