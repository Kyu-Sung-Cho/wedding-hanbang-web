# WeddingCode AI Red-Team Review v0.1

> [!CAUTION]
> **HISTORICAL / NOT CURRENT SPEC.** 초기 설계·검토 계보이며 현재 문항·점수·유형·근거·수집·운영
> 승인으로 사용하지 않는다. 현행 상태는 [`README.md`](./README.md)와
> [`62`](./62_wedding_code_master_design_and_current_state_2026-07-18.md)를 따른다.

## 0. Scope

This document is an AI/internal red-team review of `13_smoke_test_item_set_v0.3.md` before no-code form build or human testing.

This is pre-human risk reduction only. It is not human validation, psychometric validation, product validation, scoring, or evidence that the questions work with real users.

This document does not create UI, routes, database migrations, scoring logic, numeric weights, final public 4-letter codes, final 16 types, characters, couple combination names, or Amora prompt behavior.

## 1. Source Inputs

- `docs/wedding-code/13_smoke_test_item_set_v0.3.md`
- `docs/wedding-code/11_answer_option_design_v0.2.md`
- `docs/wedding-code/12_synthetic_persona_response_matrix_v0.1.md`
- `docs/wedding-code/05_question_domain_map.md`
- `docs/wedding-code/10_no_code_form_build_guide_v0.1.md`

## 2. Overall Verdict

Verdict: pass with edits.

The v0.3 item set is suitable to move toward no-code form build after small copy safeguards and stage-gating decisions. No item needs removal before testing. The main remaining risks are not severe stigma issues; they are good-answer bias, stage-fit mismatch for early users, and a few places where product-support language must stay non-diagnostic.

## 3. Risk Count Summary

| Risk level | Count |
|---|---:|
| Low | 10 |
| Medium | 6 |
| High | 0 |

## 4. Per-Question Red-Team Review

| Order | Question ID | Target construct | Overall risk level | Main risk category | Risk explanation | Answer option(s) that caused concern | Suggested rewrite if needed | Recommendation |
|---:|---|---|---|---|---|---|---|---|
| 1 | `WC-Q-costRisk-005` | `costRisk` | Low | Money-shaming, good-answer bias | Hidden-fee checking is concrete and valid. Option A can still read as the safest answer, but the other options are plausible enough. | A | No rewrite required. In form intro, frame cost checking as decision readiness, not suspicion. | Keep |
| 2 | `WC-Q-experienceMeaning-001` | `experienceMeaning` | Low | Money-shaming, meaning-shaming | The item separates memory value from cost without implying either is better. No gendered dress-only framing remains. | A, B | No rewrite required. Keep "본식 의상이나 촬영 스타일" wording. | Keep |
| 3 | `WC-Q-coPreparation-003` | `coPreparation` | Low | Partner-blaming, good-answer bias | v0.3 improved the earlier A/B ambiguity. A could still feel caring, but B/C/D now represent valid alternative workflows. | A | No rewrite required. Avoid any surrounding copy that says the partner "should" review everything. | Keep |
| 4 | `WC-Q-roleOwnership-006` | `roleOwnership` | Medium | Gender/role stereotype, good-answer bias, stage-fit | Option D splits condition/schedule and mood/satisfaction. It is not gendered, but in a live form this could accidentally echo style-vs-money stereotypes if examples are added. Contract-stage context may be early for some users. | D, B | If adding helper text, use "각자 더 잘 확인할 기준" rather than any bride/groom or style-money role examples. | Keep with caution |
| 5 | `WC-Q-evidenceDecision-006` | `evidenceDecision` | Medium | Good-answer bias, stage-fit | Written confirmation is highly relevant, but A may sound obviously most responsible. The item assumes contract-pending context. | A, D | No item rewrite needed. Stage-gate or mark "계약 전 상황이라고 가정하면" in the form if early users are included. | Keep with caution |
| 6 | `WC-Q-aestheticMood-002` | `aestheticMood` | Low | Mood-shaming, construct clarity | v0.3 cleanly separates in-person mood, practical/family conditions, photo/video output, and alignment. No option treats mood as superficial. | None | No rewrite required. | Keep |
| 7 | `WC-Q-familyIntegration-002` | `familyIntegration` | Low | Family-blaming | The item frames parents as holding practical concerns, not as opposition. Options include listening, comparison, cost, and compromise. | A, D | No rewrite required. Keep parent wording neutral in form copy. | Keep |
| 8 | `WC-Q-coupleAutonomy-004` | `coupleAutonomy` | Medium | Autonomy-shaming, family-blaming | The item is useful, but parent-facing explanation can be interpreted as conflict management. A and D should remain criteria-setting and wording support, not "persuasion." | A, D | If form copy adds context, use "설명" or "공유" rather than "설득." | Keep with caution |
| 9 | `WC-Q-emotionalSupport-002` | `emotionalSupport` | Low | Emotion-shaming, execution/coldness framing | The options keep empathy and action both valid. B is balanced but no longer too ideal after v0.2 patch. | A, C | No rewrite required. Do not expose `emotionalSupport` as a public label. | Keep |
| 10 | `WC-Q-executionSupport-006` | `executionSupport` | Medium | Stage-fit, execution/coldness framing | The wedding-week hypothetical is clear, but early-stage users may answer abstractly. Option A/B are now distinct, but task-first preferences must not read as coldness. | A, B | Add "본식이 가까워졌다고 가정하면" exactly as written. Consider rotating or stage-gating for early cohorts. | Rotate or stage-gate |
| 11 | `WC-Q-decisionPaceRisk-004` | `decisionPaceRisk` | Low | Emotion-shaming, good-answer bias | Pause, shared debrief, contract check, and comparison all sound valid. The item avoids labeling excitement as impulsive. | A, C | No rewrite required. Keep this as risk-prevention support, not public identity. | Keep |
| 12 | `WC-Q-guidanceNeed-005` | `guidanceNeed` | Medium | Guidance/dependence framing, good-answer bias, stage-fit | Quote-sheet context may be hard for users without quotes. A/C can look practically useful, but B and D preserve self-led and partner-discussion alternatives. | A, C | Keep "가정하면." Consider showing this only after `quote_status` is consulted/received/contracted, or keep as hypothetical in dry run. | Keep with stage monitoring |
| 13 | `WC-Q-costRisk-001` | `costRisk` | Low | Money-shaming, good-answer bias | The optional boundary item cleanly contrasts total cost, experience, family logistics, and partner criteria. A can feel safe but not overwhelmingly correct. | A | No rewrite required. Keep optional boundary status. | Keep optional |
| 14 | `WC-Q-roleOwnership-003` | `roleOwnership` | Low | Gender/role stereotype | The "style/condition" scenario is inherently stereotype-sensitive, but the wording says "한 사람" and "다른 한 사람" without gender. v0.3 C is clearer than v0.1. | A, C, D | No rewrite required. Do not add examples that map style, money, family, or admin work to gender. | Keep optional |
| 15 | `WC-Q-evidenceDecision-001` | `evidenceDecision` | Low | Good-answer bias, construct clarity | v0.3 separates current-vendor verification from finding alternatives. Evidence and mood both remain valid. | A, C | No rewrite required. Keep optional boundary status. | Keep optional |
| 16 | `WC-Q-coupleAutonomy-002` | `coupleAutonomy` | Medium | Autonomy-shaming, family-blaming, stage-fit | The item handles tradition simplification respectfully, but it can feel abstract before family expectations appear. It should remain optional or stage-aware. | A, B | No rewrite required. Consider showing after family involvement is at least medium, or keep as optional boundary. | Rotate or stage-gate |

## 5. Questions Safe To Test As-Is

- `WC-Q-costRisk-005`
- `WC-Q-experienceMeaning-001`
- `WC-Q-coPreparation-003`
- `WC-Q-aestheticMood-002`
- `WC-Q-familyIntegration-002`
- `WC-Q-emotionalSupport-002`
- `WC-Q-decisionPaceRisk-004`
- `WC-Q-costRisk-001`
- `WC-Q-roleOwnership-003`
- `WC-Q-evidenceDecision-001`

These should still be monitored for confusion and stigma feedback, but they do not require rewrite before dry run.

## 6. Questions To Rewrite Before No-Code Form

No question requires a source rewrite before no-code form build.

Suggested form-copy safeguards:

- For `WC-Q-roleOwnership-006`, do not add any gendered example around condition, schedule, mood, or satisfaction.
- For `WC-Q-evidenceDecision-006`, add or preserve the contract-pending assumption if early users are included.
- For `WC-Q-coupleAutonomy-004`, avoid "설득" language and use "설명" or "공유."
- For `WC-Q-guidanceNeed-005`, preserve "견적서를 받았다고 가정하면" and analyze confusion by quote status.

## 7. Questions To Rotate Or Make Optional

| Question ID | Reason | Recommendation |
|---|---|---|
| `WC-Q-executionSupport-006` | Wedding-week scenario may feel distant to early-stage users. | Keep in full 16-item version, but rotate or stage-gate if early users struggle. |
| `WC-Q-guidanceNeed-005` | Quote-sheet scenario may be hard without quote exposure. | Keep, but monitor by `quote_status`; optionally show only after quote-related context. |
| `WC-Q-coupleAutonomy-002` | Tradition simplification may be abstract before family expectations appear. | Keep as optional boundary; consider stage-gating by family involvement. |
| `WC-Q-costRisk-001` | Venue over-budget scenario is strongest for venue search and contract pending. | Keep optional and analyze by stage. |

## 8. Questions To Remove Before Testing

None.

No item shows high enough stigma, gender stereotype, construct-confusion, or product-mapping risk to remove before a small dry run.

## 9. Cross-Question Risks

### Stigma And Shame

- Money-shaming is controlled in the item wording, but cost and quote items can still look like "responsible" options unless the form intro says all choices are valid.
- Emotion-shaming is mostly controlled. The form must not label empathy-first users as sensitive or action-first users as cold.
- Family-related items should keep parents as a coordination context, not a source of conflict.
- Guidance options must not imply the user is dependent, uninformed, or incapable.

### Gender And Role Stereotypes

- No question or option directly implies bride/groom roles.
- Remaining risk lives in role-ownership and style/condition language. The form builder must not add examples that map style, budget, family communication, or task ownership to gender.
- "한 사람 / 다른 한 사람" should remain the pattern.

### Good-Answer Bias

- Written confirmation, `/check`, checklist, and shared-review options can feel safer or more mature.
- The v0.3 patches improved this, but dry-run reviewers should still flag any option that feels like the obvious correct answer.
- The intro should say there is no right answer and the goal is to test question clarity.

### Construct Clarity

- Target constructs remain clear across all 16 items.
- Secondary constructs are reasonable, but a few options carry three or four tendencies. This is acceptable for smoke testing, but not for future scoring.
- `emotionalSupport`, `executionSupport`, `decisionPaceRisk`, and `guidanceNeed` remain internal UX/risk constructs and must not become public identity labels.

### Stage Fit

- Early-stage users may struggle most with `contract_pending`, `quote_status`, and `wedding_week` scenarios.
- The form should collect participant stage before items and analyze confusion by stage.
- Stage-gating is recommended for later prototype builds, but not required for a first no-code dry run if the questions use clear hypothetical wording.

### Product Mapping Safety

- `/check` mapping is used where quote, contract, cost, written condition, or risk checking is relevant.
- Amora mapping is framed as support, explanation, summary, or conversation help, not diagnosis.
- Etiquette/checklist mappings are non-judgmental and should remain practical rather than moral.

## 10. Remaining Human-Review Risks

- Human reviewers may detect subtle Korean tone issues that AI review misses, especially around parents, family pressure, and partner participation.
- Recently married users may find wedding-week or contract items realistic, while early-stage users may find them too hypothetical.
- Some respondents may still read "shared review" as the socially desirable answer.
- Some respondents may expect a final result because the phrase "성향 테스트" can imply a type; the consent and thank-you screens must repeat that no final type or score is assigned.
- Mobile form layout may make longer options look heavier or more official than shorter options.

## 11. Recommendation For WC-011

WC-011 can start.

Recommended WC-011 scope:

- Create the no-code form build checklist or form copy package using `13_smoke_test_item_set_v0.3.md`.
- Keep all result framing as prototype feedback, not assessment output.
- Preserve no-scoring/no-type/no-character/no-public-code language in intro, consent, and thank-you screens.
- Add stage and quote-status fields before the 16 items so stage-fit risk can be analyzed.
- Include a dry-run feedback field asking whether any option felt like the "correct" answer.

WC-011 should still avoid scoring, numeric weights, final public codes, final 16 types, characters, couple combination names, UI, routes, database work, and Amora prompt changes.
