# WeddingCode Question Bank v0.1 Review

## 0. Scope

This review evaluates `docs/wedding-code/06_question_bank_v0.1.md` against the WC-003R quality criteria.

Reviewed sources:

- `docs/wedding-code/06_question_bank_v0.1.md`
- `docs/wedding-code/05_question_domain_map.md`
- `docs/wedding-code/03_question_bank_template.md`
- `apps/web/src/lib/wedding-code/constructs.ts`
- `apps/web/src/lib/wedding-code/types.ts`

This review does not add UI, routes, database migrations, final public codes, final 16 types, characters, couple combination names, Amora prompt changes, or scoring logic.

## 1. Overall Verdict

Verdict: pass with edits

The question bank is structurally ready for expert review: it contains exactly 72 draft Korean situational questions, each construct has exactly 6 items, required fields are present, and no final public type layer is introduced.

The main issues are not blockers. They are quality risks before user testing: several items are near-duplicates across paired constructs, some secondary constructs are doing too much work, and a few items should be sharpened so the primary measurement target is clearer.

WC-004 can start if it treats the edits below as guardrails before any user-facing smoke test or scoring work.

## 2. Question Count Summary

| Metric | Result |
|---|---:|
| Total draft questions | 72 |
| Required draft questions | 72 |
| Required fields missing | 0 |
| Invalid target constructs | 0 |
| Invalid secondary constructs | 0 |
| Invalid journey stage tags | 0 |

## 3. Count Per Construct

| Construct | Count |
|---|---:|
| costRisk | 6 |
| experienceMeaning | 6 |
| coPreparation | 6 |
| roleOwnership | 6 |
| evidenceDecision | 6 |
| aestheticMood | 6 |
| familyIntegration | 6 |
| coupleAutonomy | 6 |
| emotionalSupport | 6 |
| executionSupport | 6 |
| decisionPaceRisk | 6 |
| guidanceNeed | 6 |
| Total | 72 |

## 4. Criteria Review

| Criterion | Verdict | Notes |
|---|---|---|
| Exactly 72 questions | Pass | 72 question IDs found. |
| 6 questions per construct | Pass | All 12 constructs have 6 items. |
| Korean question text | Pass | Question text and response options are Korean. Technical stage tags remain internal metadata. |
| Situational, not abstract | Pass | Questions are anchored in venues, contracts, SDM, family conversations, quotes, consultations, or wedding week tasks. |
| Clear target construct | Pass | Every item has a valid primary target construct. |
| Secondary constructs reasonable | Pass with edits | Most are useful, but `costRisk`, `evidenceDecision`, `guidanceNeed`, and `familyIntegration` appear often as secondary signals. Tighten where the secondary construct is only a product surface or generic context. |
| Journey stage tags present | Pass | Every item has at least one valid tag. Coverage leans toward `venue_search`, `contract_pending`, `sdm_search`, and `contracted`; no `post_wedding` items are present, which is acceptable for this bank but should be intentional. |
| No good-person/bad-person framing | Pass | Response options mostly describe actions, support preferences, or next checks. |
| No gender assumptions | Pass | Wording uses user, partner, couple, family, parents, and vendor language. No bride/groom task ownership assumptions found. |
| No shame/stigma labels | Pass | No problematic labels were found in the drafted items. Some labels exist in source definitions as "does not mean" safety text, not as question language. |
| High/low score meanings | Pass | Meanings describe decision patterns and support needs rather than worth or relationship quality. |
| Report mapping useful | Pass | Every item has actionable report mapping. |
| Amora mapping useful | Pass | Every item maps to Amora guidance, summarization, scripts, or action cards. |
| /check mapping relevant | Pass with edits | Strong for `costRisk`, `evidenceDecision`, and `decisionPaceRisk`. Some non-contract constructs have broad "can connect" mappings; keep only where it creates a real check action. |
| Etiquette/checklist mapping relevant | Pass | Strong for `familyIntegration`, `coupleAutonomy`, `roleOwnership`, and `guidanceNeed`. |
| Internal UX/risk constructs stay internal | Pass | `emotionalSupport`, `executionSupport`, `decisionPaceRisk`, and `guidanceNeed` are treated as support/routing signals, not public identities. |
| No premature public letters/characters/16 types | Pass | The file explicitly avoids final public labels and does not create characters or final type names. |

## 5. Top 10 Strongest Questions

1. `WC-Q-costRisk-003`: Strong today-only discount scenario; cleanly tests cost/contract checking under sales pressure.
2. `WC-Q-costRisk-005`: Concrete SDM hidden-fee scenario with clear /check mapping.
3. `WC-Q-evidenceDecision-006`: Excellent verbal-promise-to-written-record test; high product relevance.
4. `WC-Q-familyIntegration-002`: Balanced family food/transport versus couple mood tension without judging either side.
5. `WC-Q-coupleAutonomy-004`: Strong respectful parent-explanation scenario; autonomy is framed as criteria-setting, not family rejection.
6. `WC-Q-emotionalSupport-002`: Clear support-sequencing item; distinguishes empathy-first from action-first without stigma.
7. `WC-Q-executionSupport-006`: Very practical wedding-week execution item; maps naturally to checklist and Amora action cards.
8. `WC-Q-decisionPaceRisk-004`: Good risk-prevention item around post-consultation excitement and cooling-off behavior.
9. `WC-Q-guidanceNeed-005`: Strong messy-quote compression item with direct Amora and /check implications.
10. `WC-Q-roleOwnership-006`: Good delegated-research/final-approval boundary item; measures role ownership without implying disengagement.

## 6. Top 10 Questions Needing Revision

1. `WC-Q-familyIntegration-003`: Too close to `WC-Q-coupleAutonomy-001`; make this one about family ritual/form expectations rather than size.
2. `WC-Q-coupleAutonomy-001`: Too close to `WC-Q-familyIntegration-003`; make this one about the couple's guest-count criteria and future-life tradeoff.
3. `WC-Q-experienceMeaning-004`: Overlaps with `WC-Q-aestheticMood-004`; make this one about emotional memory or ceremony meaning, not just flower mood.
4. `WC-Q-aestheticMood-004`: Overlaps with `WC-Q-experienceMeaning-004`; keep this one focused on color, light, and visual coherence.
5. `WC-Q-guidanceNeed-001`: Similar to `WC-Q-guidanceNeed-003` and `WC-Q-roleOwnership-001`; make it stage-specific or vendor-type specific.
6. `WC-Q-guidanceNeed-003`: Similar to `WC-Q-guidanceNeed-001`; make it about why the top three were chosen, not merely list compression.
7. `WC-Q-roleOwnership-001`: Overlaps with guidanceNeed candidate compression; sharpen the owner/delegation decision.
8. `WC-Q-evidenceDecision-005`: Strong idea, but secondary construct should likely be `costRisk` or none rather than generic guidance; focus on actual paid examples and review reliability.
9. `WC-Q-emotionalSupport-006`: Useful Amora routing item, but currently close to `guidanceNeed` and `executionSupport`; anchor it in a more concrete wedding-week stressor.
10. `WC-Q-executionSupport-003`: Strong product idea, but "today's top tasks" is close to `guidanceNeed`; add a concrete trigger such as vendor payment, final guest count, or pickup schedule.

## 7. Duplicate Or Overlapping Items

- `WC-Q-familyIntegration-003` and `WC-Q-coupleAutonomy-001`: Both use small wedding versus family expectation. Keep both only if one measures family-system integration and the other measures couple-defined criteria.
- `WC-Q-experienceMeaning-004` and `WC-Q-aestheticMood-004`: Both use flower changes and atmosphere. Split memory/meaning versus visual mood more sharply.
- `WC-Q-costRisk-003` and `WC-Q-decisionPaceRisk-001`: Both use today-only discounts. This is acceptable if `costRisk` focuses on total cost/contract terms and `decisionPaceRisk` focuses on pause rules.
- `WC-Q-evidenceDecision-006` and `WC-Q-decisionPaceRisk-005`: Both use verbal promises not written down. Differentiate evidence capture versus speed control.
- `WC-Q-guidanceNeed-001`, `WC-Q-guidanceNeed-003`, and `WC-Q-roleOwnership-001`: All involve many candidates and narrowing. Separate guidance compression from delegated ownership.
- `WC-Q-emotionalSupport-001` and `WC-Q-executionSupport-001`: Intentional pair, but expert review should ensure they do not become mirror-image wording only.

## 8. Bias And Stigma Risks

No direct shame labels were found in the question bank. The wording avoids terms equivalent to cheap, emotional, selfish, uninterested, dependent, weak, cold, irrational, wasteful, impulsive, or incompetent.

Residual risks:

- `decisionPaceRisk` items must remain framed as risk prevention under sales pressure, not as a user defect.
- `guidanceNeed` items should keep framing around information compression, not inability.
- `emotionalSupport` and `executionSupport` should describe preferred support sequence, not maturity or empathy level.
- `experienceMeaning` and `aestheticMood` should keep treating meaning and taste as legitimate decision inputs.

## 9. Gender-Stereotype Risks

No bride/groom task assignment or gendered ownership assumptions were found.

Residual risks:

- Dress, flowers, budget, and contract scenarios should continue to avoid implying that one partner naturally owns style and the other owns money.
- Family conversation items should avoid assigning parent communication to one side of the couple.

## 10. Construct-Mapping Risks

- `costRisk` and `evidenceDecision` are both heavily connected. This is expected, but several items could blur "cost safety" with "evidence preference." Expert review should tag the primary reason for choosing option A.
- `experienceMeaning` and `aestheticMood` overlap around photos, flowers, venues, and atmosphere. Use memory/meaning for `experienceMeaning`; use color, visual coherence, and first impression for `aestheticMood`.
- `familyIntegration` and `coupleAutonomy` are intentionally related but should not be treated as a binary. The bank mostly respects this, except the small-wedding pair noted above.
- `coPreparation`, `roleOwnership`, and `guidanceNeed` overlap around candidate narrowing. Distinguish shared involvement, delegated ownership, and information compression.
- `emotionalSupport` and `executionSupport` are paired support-sequence constructs. Keep their scenarios concrete so they do not collapse into one axis.

## 11. Recommended Edits Before Expert Review

1. Rewrite or split the top duplicate pair: `familyIntegration-003` and `coupleAutonomy-001`.
2. Rewrite one of the flower mood items: `experienceMeaning-004` or `aestheticMood-004`.
3. Tighten `guidanceNeed-001` and `guidanceNeed-003` so they do not both measure "show me fewer candidates."
4. Rework `roleOwnership-001` to emphasize who owns the shortlist, handoff quality, and final approval.
5. Reconsider `evidenceDecision-005` secondary construct; actual paid examples may fit `costRisk` or no secondary better.
6. Add more stage variety in the smoke-test shortlist. The full bank leans toward `venue_search` and `contract_pending`.
7. For non-contract constructs, mark /check mapping as "not primary" where the action is better served by checklist, report, or Amora.
8. Consider adding an "Ambiguity risk" line in a later version. The template contains it, but WC-003 did not require it.
9. During expert review, score each item for "primary construct purity" before changing wording.
10. Keep all public letters, character names, and final type language out of the next revision.

## 12. 3-Minute Smoke Test Shortlist Strategy

Recommended first smoke-test length: 12 to 16 items.

Strategy:

- Start with one high-quality item per construct for a 12-item core.
- Add 4 rotating items for high-risk or high-product-value areas: `costRisk`, `evidenceDecision`, `decisionPaceRisk`, and `guidanceNeed`.
- Avoid using both items from each duplicate pair in the same 3-minute version.
- Balance journey stages: include early planning, venue/SDM search, contract pending, contracted, and wedding-week items.
- Use forced-choice options only; do not calculate final labels or public types.
- Primary success metrics should be completion, "feels like me," partner invite interest, report interest, and CTA intent.

Suggested 12-item core shortlist:

- `WC-Q-costRisk-003`
- `WC-Q-experienceMeaning-001`
- `WC-Q-coPreparation-003`
- `WC-Q-roleOwnership-006`
- `WC-Q-evidenceDecision-006`
- `WC-Q-aestheticMood-002`
- `WC-Q-familyIntegration-002`
- `WC-Q-coupleAutonomy-004`
- `WC-Q-emotionalSupport-002`
- `WC-Q-executionSupport-006`
- `WC-Q-decisionPaceRisk-004`
- `WC-Q-guidanceNeed-005`

## 13. Can WC-004 Start?

Yes, with edits.

WC-004 can start if it is expert-review preparation, shortlist selection, or item-revision work. It should not start scoring logic, public 4-letter code generation, final 16 types, characters, couple combination names, or user-facing UI until the duplicate and construct-purity risks above are addressed.
