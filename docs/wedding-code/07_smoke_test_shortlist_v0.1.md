# WeddingCode 3-Minute Smoke Test Shortlist v0.1

## 0. Scope

This file defines a draft 3-minute smoke test shortlist selected from `06_question_bank_v0.1.md`.

This file does not define final assessment questions, scoring logic, public 4-letter codes, final 16 types, characters, couple combination names, UI, routes, database schema, or Amora prompt behavior.

The selected items are candidates for testing question clarity, perceived relevance, product routing interest, and stigma risk. They are not final WeddingCode assessment items.

## 1. Source Inputs

- `docs/wedding-code/06_question_bank_v0.1.md`
- `docs/wedding-code/06_question_bank_review.md`
- `docs/wedding-code/05_question_domain_map.md`
- `apps/web/src/lib/wedding-code/constructs.ts`
- `apps/web/src/lib/wedding-code/types.ts`

## 2. Selection Principles

- Prefer 16 items because the review verdict was `pass with edits`, not `fail`.
- Cover all 12 constructs at least once.
- Include all 8 core constructs:
  `costRisk`, `experienceMeaning`, `coPreparation`, `roleOwnership`, `evidenceDecision`, `aestheticMood`, `familyIntegration`, `coupleAutonomy`.
- Include all 4 internal UX/risk constructs:
  `emotionalSupport`, `executionSupport`, `decisionPaceRisk`, `guidanceNeed`.
- Add 4 optional boundary items to test overlapping construct separation.
- Do not use the shortlist to create public labels, characters, final types, or scoring rules.
- Keep `emotionalSupport`, `executionSupport`, `decisionPaceRisk`, and `guidanceNeed` as internal UX/risk support constructs.
- Keep `familyIntegration` and `coupleAutonomy` separate unless later data supports a combined or binary axis.

## 3. Shortlist Summary

| Metric | Count |
|---|---:|
| Total selected items | 16 |
| Required core/UX coverage items | 12 |
| Optional boundary items | 4 |
| Constructs covered | 12 / 12 |

## 4. Construct Coverage

| Construct | Required item | Optional boundary item |
|---|---|---|
| `costRisk` | `WC-Q-costRisk-005` | `WC-Q-costRisk-001` |
| `experienceMeaning` | `WC-Q-experienceMeaning-001` | - |
| `coPreparation` | `WC-Q-coPreparation-003` | - |
| `roleOwnership` | `WC-Q-roleOwnership-006` | `WC-Q-roleOwnership-003` |
| `evidenceDecision` | `WC-Q-evidenceDecision-006` | `WC-Q-evidenceDecision-001` |
| `aestheticMood` | `WC-Q-aestheticMood-002` | - |
| `familyIntegration` | `WC-Q-familyIntegration-002` | - |
| `coupleAutonomy` | `WC-Q-coupleAutonomy-004` | `WC-Q-coupleAutonomy-002` |
| `emotionalSupport` | `WC-Q-emotionalSupport-002` | - |
| `executionSupport` | `WC-Q-executionSupport-006` | - |
| `decisionPaceRisk` | `WC-Q-decisionPaceRisk-004` | - |
| `guidanceNeed` | `WC-Q-guidanceNeed-005` | - |

## 5. Boundary Coverage

| Boundary | Selected item | Purpose |
|---|---|---|
| `costRisk` vs `experienceMeaning` | `WC-Q-costRisk-001` | Tests whether users first seek cost safety or experience meaning when a loved venue exceeds budget. |
| `coPreparation` vs `roleOwnership` | `WC-Q-roleOwnership-003` | Tests whether shared preparation can coexist with strength-based role ownership. |
| `evidenceDecision` vs `aestheticMood` | `WC-Q-evidenceDecision-001` | Tests whether visual fit or verifiable evidence drives the next step. |
| `familyIntegration` vs `coupleAutonomy` | `WC-Q-coupleAutonomy-002` | Tests respectful simplification of tradition without collapsing autonomy into anti-family framing. |

## 6. Selected Items

### 6.1 `WC-Q-costRisk-005`

- Question ID from question bank: `WC-Q-costRisk-005`
- Target construct: `costRisk`
- Secondary constructs: `evidenceDecision`
- Journey stage: `sdm_search`, `contract_pending`
- Question text: 스튜디오 패키지가 좋아 보이지만 원본, 보정, 헬퍼, 얼리스타트 비용이 분명하지 않습니다. 가장 먼저 할 일은 무엇인가요?
- Why selected: Strong hidden-fee scenario with direct wedding relevance and strong `/check` routing.
- What it measures: Whether unclear package inclusions trigger cost-risk clarification before taste or preference decisions.
- Risk to watch: Do not frame detailed cost checking as suspicion, distrust, or being overly cautious.
- Expected product mapping: Report note for unclear SDM quote items, Amora quote-question generation, `/check` for original files, retouching, helper fees, and extra shooting costs, plus SDM contract checklist.
- Required or optional: Required.

### 6.2 `WC-Q-experienceMeaning-001`

- Question ID from question bank: `WC-Q-experienceMeaning-001`
- Target construct: `experienceMeaning`
- Secondary constructs: `costRisk`
- Journey stage: `sdm_search`
- Question text: 입어본 드레스 중 하나가 사진에 오래 남을 것 같지만 추가 비용이 있습니다. 무엇을 먼저 생각하나요?
- Why selected: Compactly tests lasting-memory value while keeping budget tradeoff visible.
- What it measures: Whether the user treats enduring memory and emotional meaning as a legitimate decision input.
- Risk to watch: Do not imply that valuing dress/photos is wasteful, vain, or less practical.
- Expected product mapping: Report separation of memory-worthy items from adjustable items, Amora support for meaning-versus-budget conversation, optional extra-cost check, SDM priority checklist.
- Required or optional: Required.

### 6.3 `WC-Q-coPreparation-003`

- Question ID from question bank: `WC-Q-coPreparation-003`
- Target construct: `coPreparation`
- Secondary constructs: `evidenceDecision`
- Journey stage: `contract_pending`
- Question text: 상담 후 마음에 드는 업체가 생겼지만 상대는 아직 자세히 보지 못했습니다. 무엇이 먼저 필요하다고 느끼나요?
- Why selected: Clear pre-contract shared-decision scenario with low stigma risk.
- What it measures: Whether the user needs partner review and shared readiness before moving toward commitment.
- Risk to watch: Do not frame partner review as permission-seeking or inability to decide alone.
- Expected product mapping: Report guidance on what must be reviewed together, Amora partner-share consultation summary, optional contract-condition review, joint decision checklist.
- Required or optional: Required.

### 6.4 `WC-Q-roleOwnership-006`

- Question ID from question bank: `WC-Q-roleOwnership-006`
- Target construct: `roleOwnership`
- Secondary constructs: `evidenceDecision`
- Journey stage: `contract_pending`, `contracted`
- Question text: 한 사람이 업체를 알아봤지만 계약 전에는 둘 다 확인해야 할 것 같습니다. 어떤 기준이 가장 필요합니까?
- Why selected: Strongly separates delegated research from final joint approval.
- What it measures: Whether the user prefers an owner-led process with transparent final confirmation.
- Risk to watch: Do not imply delegated ownership means disinterest from the other person.
- Expected product mapping: Report for delegated-research approval protocol, Amora owner summary and joint approval checklist, `/check` for contract and quote conditions, final approval checklist.
- Required or optional: Required.

### 6.5 `WC-Q-evidenceDecision-006`

- Question ID from question bank: `WC-Q-evidenceDecision-006`
- Target construct: `evidenceDecision`
- Secondary constructs: `decisionPaceRisk`
- Journey stage: `contract_pending`
- Question text: 상담 중 서비스 추가를 약속받았지만 계약서에는 아직 없습니다. 다음 행동으로 가장 가까운 것은 무엇인가요?
- Why selected: High product relevance and strong evidence-vs-trust signal.
- What it measures: Whether written confirmation is needed before the user feels ready to proceed.
- Risk to watch: Do not frame written confirmation as distrust of the vendor or consultant.
- Expected product mapping: Report flag for verbal promises, Amora written-confirmation message, `/check` for pre-contract promise capture, contract checklist.
- Required or optional: Required.

### 6.6 `WC-Q-aestheticMood-002`

- Question ID from question bank: `WC-Q-aestheticMood-002`
- Target construct: `aestheticMood`
- Secondary constructs: `familyIntegration`
- Journey stage: `venue_search`
- Question text: 투어 중 한 홀에 들어갔을 때 분위기가 우리와 잘 맞는다고 느꼈습니다. 무엇을 먼저 확인하고 싶나요?
- Why selected: Tests first-impression mood response without relying on final identity labels.
- What it measures: Whether venue atmosphere and visual fit guide the user's next decision step.
- Risk to watch: Do not treat immediate mood response as irrational or superficial.
- Expected product mapping: Report comparison of mood satisfaction and practical conditions, Amora hall mood/condition comparison table, `/check` for meal cost and guarantee count, venue-tour checklist.
- Required or optional: Required.

### 6.7 `WC-Q-familyIntegration-002`

- Question ID from question bank: `WC-Q-familyIntegration-002`
- Target construct: `familyIntegration`
- Secondary constructs: `aestheticMood`
- Journey stage: `venue_search`
- Question text: 우리는 분위기가 좋은 예식장이 끌리지만 부모님은 음식과 교통을 더 중요하게 봅니다. 무엇을 먼저 해보고 싶나요?
- Why selected: Strong family-system scenario that respects both couple mood and parent/guest priorities.
- What it measures: Whether parent, guest, food, and transport concerns are integrated into decision-making.
- Risk to watch: Do not frame family consideration as obedience or lack of autonomy.
- Expected product mapping: Report on coordinating guest experience with couple mood, Amora family explanation comparison table, optional cost comparison, family venue coordination checklist.
- Required or optional: Required.

### 6.8 `WC-Q-coupleAutonomy-004`

- Question ID from question bank: `WC-Q-coupleAutonomy-004`
- Target construct: `coupleAutonomy`
- Secondary constructs: `emotionalSupport`
- Journey stage: `marriage_discussion`, `preparing_without_date`
- Question text: 부모님께 우리의 결혼식 기준을 설명해야 합니다. 어떤 준비가 가장 먼저 필요하다고 느끼나요?
- Why selected: Frames autonomy as respectful criteria-setting and explanation, not family rejection.
- What it measures: Whether the couple wants to define and communicate their own standards before outside expectations take over.
- Risk to watch: Do not let high autonomy read as selfishness or anti-family attitude.
- Expected product mapping: Report sequence for couple criteria agreement and family explanation, Amora parent-facing explanation draft, optional cost-data preparation, family conversation checklist.
- Required or optional: Required.

### 6.9 `WC-Q-emotionalSupport-002`

- Question ID from question bank: `WC-Q-emotionalSupport-002`
- Target construct: `emotionalSupport`
- Secondary constructs: `executionSupport`
- Journey stage: `contract_pending`
- Question text: 상담 후 걱정된다고 말했는데 상대가 바로 "그럼 다른 데 알아보자"라고 답했습니다. 가장 가까운 느낌은 무엇인가요?
- Why selected: Cleanly tests support sequencing in a real wedding stress moment.
- What it measures: Whether emotional acknowledgment is needed before solution options.
- Risk to watch: Keep this as Amora/couple-script tuning, not a public identity label or relationship judgment.
- Expected product mapping: Report couple communication tip, Amora empathy-before-options response order, no primary `/check` mapping, optional couple conversation checklist.
- Required or optional: Required.

### 6.10 `WC-Q-executionSupport-006`

- Question ID from question bank: `WC-Q-executionSupport-006`
- Target construct: `executionSupport`
- Secondary constructs: `roleOwnership`
- Journey stage: `wedding_week`
- Question text: 예식 주간에 업체 연락, 가족 안내, 준비물 확인이 한꺼번에 남았습니다. 가장 먼저 하고 싶은 것은 무엇인가요?
- Why selected: Practical wedding-week item with strong action-card and checklist value.
- What it measures: Whether roles, deadlines, and concrete next actions stabilize the user under pressure.
- Risk to watch: Do not frame execution-first preference as coldness or low empathy.
- Expected product mapping: Report week-of role split, Amora owner-based action cards, no primary `/check` mapping, wedding-week execution checklist.
- Required or optional: Required.

### 6.11 `WC-Q-decisionPaceRisk-004`

- Question ID from question bank: `WC-Q-decisionPaceRisk-004`
- Target construct: `decisionPaceRisk`
- Secondary constructs: `emotionalSupport`
- Journey stage: `venue_search`, `contract_pending`
- Question text: 상담을 다녀온 직후 매우 마음에 들어 바로 정하고 싶은 기분이 듭니다. 무엇이 가장 도움이 될까요?
- Why selected: Measures commitment-control need without blaming excitement.
- What it measures: Whether a pause rule or cooling-off step is useful after a positive consultation.
- Risk to watch: Keep this as risk prevention under excitement, not an impulsiveness label.
- Expected product mapping: Report cooling-off and confirmation criteria, Amora 24-hour recheck prompts, `/check` for pre-contract reconfirmation, post-consultation comparison checklist.
- Required or optional: Required.

### 6.12 `WC-Q-guidanceNeed-005`

- Question ID from question bank: `WC-Q-guidanceNeed-005`
- Target construct: `guidanceNeed`
- Secondary constructs: `costRisk`
- Journey stage: `contract_pending`
- Question text: 견적서가 여러 장이고 항목명이 낯섭니다. 가장 도움이 되는 것은 무엇인가요?
- Why selected: Strong information-compression item with direct Amora and `/check` implications.
- What it measures: Whether complex quote information should be compressed into priority questions.
- Risk to watch: Do not frame guidance need as lack of understanding or dependence.
- Expected product mapping: Report quote-summary and question priority, Amora quote summary, `/check` for quote item validation, contract checklist.
- Required or optional: Required.

### 6.13 `WC-Q-costRisk-001`

- Question ID from question bank: `WC-Q-costRisk-001`
- Target construct: `costRisk`
- Secondary constructs: `experienceMeaning`
- Journey stage: `venue_search`, `contract_pending`
- Question text: 마음에 드는 예식장이 예상보다 300만 원 비쌉니다. 상담 직후 가장 먼저 확인하고 싶은 것은 무엇인가요?
- Why selected: Boundary item for cost-risk checking versus meaningful venue experience.
- What it measures: Whether budget overrun first activates total-cost review, experience reflection, family logistics, or partner meaning discussion.
- Risk to watch: Avoid turning cost priority into a "less romantic" interpretation.
- Expected product mapping: Report cost items and discussion order, Amora additional-fee questions and consultation summary, `/check` for inclusions, extra charges, and refund terms, budget adjustment checklist.
- Required or optional: Optional boundary item.

### 6.14 `WC-Q-roleOwnership-003`

- Question ID from question bank: `WC-Q-roleOwnership-003`
- Target construct: `roleOwnership`
- Secondary constructs: `coPreparation`
- Journey stage: `sdm_search`
- Question text: 한 사람은 스타일 비교를 잘하고, 다른 한 사람은 조건 비교를 잘합니다. 준비 방식으로 가장 가까운 것은 무엇인가요?
- Why selected: Boundary item for shared preparation versus strength-based ownership.
- What it measures: Whether the user sees role division as a collaborative structure rather than disengagement.
- Risk to watch: Do not imply either partner's strength maps to gender, money, or style stereotypes.
- Expected product mapping: Report strength-based role split and sharing rules, Amora task division proposal, optional condition-comparison support, role split checklist.
- Required or optional: Optional boundary item.

### 6.15 `WC-Q-evidenceDecision-001`

- Question ID from question bank: `WC-Q-evidenceDecision-001`
- Target construct: `evidenceDecision`
- Secondary constructs: `aestheticMood`
- Journey stage: `sdm_search`
- Question text: 포트폴리오는 마음에 들지만 실제 이용 후기가 많지 않은 스튜디오가 있습니다. 무엇을 먼저 확인하나요?
- Why selected: Boundary item for visual attraction versus verifiable proof.
- What it measures: Whether beautiful portfolio fit is enough, or whether reviews, real examples, and conditions are needed before comfort.
- Risk to watch: Do not frame evidence-first users as smarter or mood-first users as careless.
- Expected product mapping: Report verification materials for low-review candidates, Amora real-example request message, `/check` for composition, original file, and retouching conditions, studio verification checklist.
- Required or optional: Optional boundary item.

### 6.16 `WC-Q-coupleAutonomy-002`

- Question ID from question bank: `WC-Q-coupleAutonomy-002`
- Target construct: `coupleAutonomy`
- Secondary constructs: `familyIntegration`
- Journey stage: `marriage_discussion`, `contracted`
- Question text: 일부 전통 절차를 간소화하고 싶지만 가족이 어떻게 받아들일지 걱정됩니다. 무엇을 먼저 해보고 싶나요?
- Why selected: Boundary item for couple-defined simplification versus respectful family integration.
- What it measures: Whether the couple wants to simplify tradition while maintaining explanation, care, and relationship safety.
- Risk to watch: Do not collapse this into a binary of "family-oriented" versus "independent." These must remain separate constructs.
- Expected product mapping: Report simplified-procedure and explanation plan, Amora soft family explanation draft, no primary `/check` mapping, etiquette guide and procedure checklist.
- Required or optional: Optional boundary item.

## 7. Excluded But Promising Items

- `WC-Q-costRisk-003`: Very strong today-only discount item, but this shortlist already includes `decisionPaceRisk-004` for pace risk and `costRisk-001` for cost/meaning boundary. Keep for a rotated contract-pressure variant.
- `WC-Q-costRisk-006`: Strong refund/cancellation item, but overlaps with `evidenceDecision-006` and `guidanceNeed-005` around written conditions and contract clarity.
- `WC-Q-experienceMeaning-003`: Useful video-memory item, especially for report language, but lower priority for the first 3-minute product-routing test.
- `WC-Q-evidenceDecision-003`: Useful contract-comprehension item, but close to quote-compression and written-confirmation items already selected.
- `WC-Q-aestheticMood-006`: Good mood-keyword onboarding item, but `aestheticMood-002` and `evidenceDecision-001` give stronger venue/SDM decision pressure.
- `WC-Q-familyIntegration-003`: Promising family/tradition boundary, but needs rewrite because it overlaps with `WC-Q-coupleAutonomy-001`.
- `WC-Q-roleOwnership-005`: Good shared-review versus shortlist item, but `WC-Q-roleOwnership-003` tests the boundary with less overlap risk.
- `WC-Q-guidanceNeed-006`: Strong stage-specific guidance item for sanggyeonrye or venue tour, useful for later onboarding smoke tests.

## 8. Items That Need Rewrite Before Expert Review

These items should not be used as-is in the first smoke test unless rewritten.

- `WC-Q-familyIntegration-003`: Too close to `WC-Q-coupleAutonomy-001`; make it about family ritual/form expectations rather than wedding size alone.
- `WC-Q-coupleAutonomy-001`: Too close to `WC-Q-familyIntegration-003`; make it about couple-defined guest-count criteria and future-life tradeoff.
- `WC-Q-experienceMeaning-004`: Too close to `WC-Q-aestheticMood-004`; make it about ceremony memory or emotional meaning, not flower mood.
- `WC-Q-aestheticMood-004`: Too close to `WC-Q-experienceMeaning-004`; keep it focused on color, light, and visual coherence.
- `WC-Q-guidanceNeed-001`: Similar to `WC-Q-guidanceNeed-003` and `WC-Q-roleOwnership-001`; make it more stage-specific or vendor-type specific.
- `WC-Q-guidanceNeed-003`: Similar to `WC-Q-guidanceNeed-001`; make it about why top options were chosen, not merely list compression.
- `WC-Q-roleOwnership-001`: Overlaps with guidance compression; sharpen the owner/delegation decision.
- `WC-Q-evidenceDecision-005`: Reconsider secondary construct and focus more clearly on actual paid examples and review reliability.
- `WC-Q-emotionalSupport-006`: Anchor it in a more concrete wedding-week stressor so it does not blur into guidance or execution support.
- `WC-Q-executionSupport-003`: Add a concrete trigger such as vendor payment, final guest count, or pickup schedule.

## 9. Smoke Test Measurement Plan

The smoke test should measure whether the shortlist feels relevant and safe, not whether a final type can be assigned.

| Metric | How to measure | Provisional read |
|---|---|---|
| Completion rate | Percentage of users who start and finish the 12 required items, and separately the full 16-item version. | Healthy if the 16-item version stays near or above 60-65%. If completion drops sharply after item 12, keep optional boundary items rotated. |
| Feels-like-me score | 1-5 rating after the set: "이 질문들이 내 결혼 준비 상황을 잘 담았나요?" | Healthy if average is near or above 4.0 / 5. |
| Partner-invite intent | Click or rating for "상대와 함께 해보고 싶다." | Healthy if intent is near or above 20%. Strong signal for `coPreparation` and couple report. |
| Couple-report interest | Click or rating for "둘의 준비 방식 리포트를 보고 싶다." | Healthy if interest is near or above 10%. |
| Amora CTA interest | Click or rating for "이 답변을 바탕으로 아모라에게 도움받고 싶다." | Healthy if interest is near or above 10-15%. |
| `/check` CTA interest | Click or rating for quote/contract checking after cost, evidence, pace, or guidance items. | Healthy if interest is near or above 5%; analyze especially `costRisk`, `evidenceDecision`, `decisionPaceRisk`, and `guidanceNeed`. |
| Negative/stigma feedback | Free-text plus quick flag: "기분 나쁘거나 평가받는 느낌이 있었나요?" | Must stay below 5%. Rewrite any item with repeated stigma signals. |
| Confusing-question feedback | Per-item "헷갈림" flag plus optional free text. | Prioritize rewrite when an item is confusing for more than 15-20% of respondents or confuses the intended construct. |

## 10. Smoke Test Operating Notes

- Use the 12 required items as the minimum version.
- Use the 4 optional boundary items when the user has enough time, or rotate them across cohorts.
- Do not generate a public result label from this test.
- Do not show internal construct names to respondents unless this is an internal researcher-only session.
- Use neutral, product-oriented output language such as "도움이 될 수 있는 지원" rather than identity labels.
- Track item-level drop-off, confusing feedback, and stigma feedback before any scoring or UI work.
- If `familyIntegration` and `coupleAutonomy` both score high in qualitative reads, treat that as "respectful coordination plus couple criteria," not a contradiction.
- If both `emotionalSupport` and `executionSupport` seem high, treat that as a support-sequence design question, not a personality conflict.

## 11. WC-005 Readiness

WC-005 can start after this shortlist is reviewed.

Recommended WC-005 scope:

- Rewrite the flagged duplicate or vague items before expert review.
- Prepare researcher-facing smoke test instructions.
- Define how item-level clarity and stigma feedback will be logged.

WC-005 should still avoid scoring logic, final public labels, characters, UI, routes, and database work unless a later task explicitly changes scope.
