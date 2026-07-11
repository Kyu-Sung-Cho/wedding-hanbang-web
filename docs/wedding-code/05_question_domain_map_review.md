# WeddingCode Question Domain Map Review v0.1

> **HISTORICAL / SUPERSEDED (2026-07-11):** 삭제된 12-구인 런타임 파일 참조를 포함한 초기 검토 기록이다. 현재 기준은 [`63_candidate10_evidence_based_rebuild_2026-07-11.md`](./63_candidate10_evidence_based_rebuild_2026-07-11.md)와 candidate.10 코드다.

## 0. Scope

This review evaluates `docs/wedding-code/05_question_domain_map.md` before WC-003 question-bank generation.

It does not add UI, routes, database migrations, final assessment questions, final public codes, final 16 types, characters, couple combination names, or Amora prompt changes.

Sources inspected:
- `docs/wedding-code/05_question_domain_map.md`
- `docs/wedding-code/01_construct_genesis.md`
- `apps/web/src/lib/wedding-code/constructs.ts`
- `apps/web/src/lib/wedding-code/types.ts`

## 1. Overall Verdict

Verdict: pass with edits

The map covers exactly the 12 Genesis constructs, each with 10 scenario domains. The domains are mostly concrete wedding-preparation situations, use neutral language, avoid obvious gender stereotypes, and align with valid WeddingCode product surfaces and evidence tags from the TypeScript source of truth.

The main reason this is not a clean pass is not correctness; it is question-bank readiness. Several constructs contain near-duplicate scenario domains or broad domains that should be sharpened before they become final question drafts. WC-003 can start if these review notes are treated as guardrails, but the first WC-003 pass should merge or differentiate the noted overlaps.

## 2. Construct-by-Construct Review

| Construct | Domain count | Concrete real wedding situations | Duplicate / near-duplicate risk | Gender stereotype risk | Shame / labeling risk | Question-ready | Product-surface connection | Review verdict |
|---|---:|---|---|---|---|---|---|---|
| `costRisk` | 10 | Pass. Venue, dress, fair, guarantee count, meal cost, package, contract, quote, and family budget pressure are concrete. | Low. Cost/contract risks are distinct enough. | Low. Neutral user/partner/parent language. | Low if future wording avoids cheap/stingy framing. | High. Each domain can become a situational question. | Strong: `quote_check`, `amora`, `checklist`. | Pass |
| `experienceMeaning` | 10 | Pass. Dress, studio, video, flowers, venue mood, package fit, memory, and aesthetic tradeoffs are concrete. | Medium. Domains 2, 5, 7, and 10 all express meaning-versus-cost or meaning-versus-practicality; WC-003 should differentiate object categories. | Low. | Medium if future questions imply vanity or overspending. | High with wording care. | Strong: `amora`, `checklist`, `wedding_lounge`. | Pass with edits |
| `coPreparation` | 10 | Pass. Partner delegation, solo research, discussion, regular meetings, and shared decision rules are concrete. | Medium-high. Domains 1, 4, 8, and 10 all describe low partner involvement. | Low. Uses partner-neutral wording. | Medium if future copy frames the user as needy or the partner as uninterested. | Medium-high. Some domains should be merged or assigned different stages. | Strong: `couple_report`, `onboarding`, `amora`, `checklist`. | Pass with edits |
| `roleOwnership` | 10 | Pass. Shortlisting, budget owner, task owners, deadlines, and final approval are concrete. | Medium-high. Domains 4 and 10 overlap; domains 5 and 8 overlap around owners/deadlines. | Low. Domain 3 is role-neutral and does not assign style/numbers by gender. | Low-medium if future wording implies emotional distance. | Medium-high after dedupe. | Strong: `couple_report`, `checklist`, `amora`. | Pass with edits |
| `evidenceDecision` | 10 | Pass. Reviews, quotes, contracts, market prices, paid examples, written promises, and line-item comparisons are concrete. | Low. Some quote/contract domains are related but target distinct evidence artifacts. | Low. | Low if future wording avoids rational/superior framing. | High. | Strong: `quote_check`, `community`, `amora`. | Pass |
| `aestheticMood` | 10 | Pass. Portfolio, venue atmosphere, dress silhouette, flowers, studio tone, references, first impression, reviews, mood keywords, and package fit are concrete. | Medium. Domains 1, 2, 7, 9, and 10 all express mood fit; WC-003 should vary category and decision tension. | Low. | Medium if future wording implies superficiality. | High with category differentiation. | Strong: `wedding_lounge`, `amora`, `checklist`. | Pass with edits |
| `familyIntegration` | 10 | Pass. Guest count, venue food/transportation, small wedding conflict, family disagreement, older relatives, honju logistics, etiquette, inclusion, guest experience, and cost/gift etiquette are concrete. | Medium. Domains 1 and 9 can overlap through guest impact; domains 3 and 7 overlap around couple preference versus family etiquette. | Low. Family roles are not gendered. | Medium if future questions imply obedience or anti-family judgment. | High with balanced wording. | Strong: `etiquette_guide`, `couple_report`, `amora`, `checklist`. | Pass with edits |
| `coupleAutonomy` | 10 | Pass. Small wedding, simplified etiquette, practicality, guest count, parent explanation, formal procedure reduction, budget allocation, non-standard venue, and future-life priority are concrete. | Medium-high. Domains 1 and 9 both cover non-standard format; domains 2 and 6 both cover simplifying tradition; domain 8 is more abstract than the others. | Low. | Medium-high if future copy implies selfishness or disrespect. | Medium-high after sharpening. | Strong: `etiquette_guide`, `couple_report`, `checklist`. | Pass with edits |
| `emotionalSupport` | 10 | Pass. Research exhaustion, solution-first partner response, participation before tasks, stressful consultation, feeling alone, recognition, reassurance, Amora response order, escalation, and compromise are concrete enough. | Medium. Domains 2, 8, 9, and 10 all focus on sequencing emotion before solution. | Low. | Medium if future wording implies fragility or drama. | Medium-high. Some domains need more wedding-specific anchors. | Strong: `amora`, `couple_report`. | Pass with edits |
| `executionSupport` | 10 | Pass. Task lists, owners, conflict next steps, top tasks, consultation checklist, budget spreadsheet, deadlines, Amora action summary, open-ended discussion, and decision framework are concrete enough. | Medium. Domains 1, 4, 7, 8, and 10 all express action clarity; WC-003 should vary trigger contexts. | Low. | Medium if future wording implies coldness or lack of empathy. | Medium-high. Some domains need more wedding-specific anchors. | Strong: `amora`, `checklist`, `couple_report`. | Pass with edits |
| `decisionPaceRisk` | 10 | Pass. Fair discount, disappearing date, deposit pressure, emotional consultation, stress reduction, partner pause, verbal promises, scarcity, bundle exclusions, and cancellation comparison are concrete. | Low-medium. Domains 1 and 3 both cover sales pressure; domains 2 and 8 both cover scarcity. Distinct enough if question drafts vary wording. | Low. | Medium if future wording implies impulsiveness. | High. | Strong: `quote_check`, `amora`, `checklist`. | Pass |
| `guidanceNeed` | 10 | Pass. Too many vendors, unknown first step, top options, urgent task priority, community overload, messy quote, consultation questions, stage plan, pre-comparison guidance, and criteria conflict are concrete enough. | Medium-high. Domains 1 and 3 overlap; domains 2, 4, 8, and 9 overlap around next-step guidance. | Low. | Medium if future wording implies dependency or incompetence. | Medium after sharpening. | Strong: `amora`, `onboarding`, `wedding_lounge`, `checklist`. | Pass with edits |

## 3. Missing Domain Suggestions

These are suggestions for WC-003 question drafting or a later domain-map revision. They are not final questions.

| Construct | Missing or underrepresented situation to consider |
|---|---|
| `costRisk` | Payment schedule and cash-flow timing; contract change fees after date/vendor changes; scope creep after initial package selection. |
| `experienceMeaning` | Ceremony flow, vows, music, guest emotional experience, and wedding-day sensory details beyond visual assets. |
| `coPreparation` | Partner availability constraints, deciding which family conversations should be handled together, and post-consultation debrief habits. |
| `roleOwnership` | Handoff quality after one person researches; shared document/tool ownership; when to escalate a delegated decision back to both people. |
| `evidenceDecision` | Review reliability, sponsored/incentivized reviews, actual staff versus portfolio sample differences, and region/date recency of examples. |
| `aestheticMood` | Hair/makeup compatibility, venue lighting by season/time, dress-hall-studio coherence, and mismatch between online portfolio and in-person feel. |
| `familyIntegration` | Inter-family communication channel, honju attire, invitation protocol, ceremony order expectations, and region-specific family customs. |
| `coupleAutonomy` | Future housing/savings tradeoff, legal/practical simplification, boundaries for parent-funded items, and respectful refusal scripts. |
| `emotionalSupport` | Emotional impact of parent conflict, disappointment after vendor rejection/unavailable date, and reassurance after budget cuts. |
| `executionSupport` | Week-of task triage, vendor follow-up ownership, post-consultation action routing, and what to do when deadlines slip. |
| `decisionPaceRisk` | Deposit deadline extension request, cooling-off checklist after emotional consultation, and comparison before bundle upgrade. |
| `guidanceNeed` | Stage-specific guidance for venue search versus SDM search versus contracted phase; deciding when to stop researching. |

## 4. Domains to Merge or Remove

No domain must be removed before WC-003. The following overlaps should be merged, split, or made more distinct during question drafting:

- `coPreparation`: Domains 1, 4, 8, and 10 all measure partner delegation or low active review. Keep at most two in a short-form bank, and use different stages if keeping more.
- `roleOwnership`: Domains 4 and 10 both describe delegated research plus final approval. Domains 5 and 8 both describe owners/deadlines. Merge or differentiate decision rights versus task operations.
- `coupleAutonomy`: Domains 2 and 6 both describe simplifying tradition. Domains 1 and 9 both describe non-standard format pressure. Domain 8 should be grounded in a specific decision.
- `guidanceNeed`: Domains 2, 4, 8, and 9 all point to next-step compression. Differentiate by wedding stage, information source, or decision complexity.
- `experienceMeaning`: Domains 2, 5, 7, and 10 are all tradeoff domains. Keep the tradeoff, but vary the object: dress, video, venue, flowers, ceremony flow, or photo/video memory.
- `aestheticMood`: Domains 1, 2, 7, 9, and 10 all express mood fit. WC-003 should avoid asking the same "does it feel right" question repeatedly.
- `emotionalSupport` and `executionSupport`: These are intentionally paired, but future questions should not become mirror-image wording only. Anchor each item in a distinct wedding trigger.

## 5. Bias and Stigma Risks

- No obvious gender stereotypes were found. The map consistently uses user, partner, couple, parents, and families rather than assigning work by bride/groom.
- `familyIntegration` and `coupleAutonomy` must stay symmetric. Avoid implying that family-oriented users are obedient or that autonomy-oriented users are selfish.
- `emotionalSupport` and `executionSupport` must describe preferred support sequence, not emotional maturity, empathy, or relationship quality.
- `decisionPaceRisk` should be framed as risk prevention under sales pressure, not impulsiveness.
- `guidanceNeed` should be framed as information-compression preference, not inability or dependence.
- `experienceMeaning` and `aestheticMood` should treat meaning and taste as valid decision inputs, not vanity or irrational spending.
- `evidenceDecision` should not imply high-score users are smarter or low-score users are careless.

## 6. Recommended Improvements Before WC-003

1. Create a dedupe pass before drafting items: decide which overlapping domains become short-form questions and which stay reserved for deep assessment.
2. Add a wedding-stage tag to each future item draft, such as venue search, SDM search, contract pending, contracted, wedding week, or family coordination.
3. Require every WC-003 draft item to name a concrete artifact or event when possible: quote, contract, consultation, guest count, parent conversation, portfolio, checklist, or vendor message.
4. Pair every high-risk construct with a product action: `quote_check` for contract/price risk, `etiquette_guide` for family/autonomy tension, `couple_report` for collaboration/support needs, `checklist` for execution, and `amora` for compression or emotional/action sequencing.
5. Keep final public labels, final type names, characters, and couple combination names out of WC-003 until validation has stronger evidence.
6. Use the source-of-truth labels and product surfaces from `constructs.ts`; `01_construct_genesis.md` is still skeletal and should not override the TypeScript construct definitions.

## 7. Final Go / No-Go

Go for WC-003: yes, with guardrails.

WC-003 can start because construct coverage, domain counts, product-surface alignment, and safety boundaries are sufficient. The first WC-003 drafting pass should treat the overlap notes above as constraints so the question bank does not become repetitive or too abstract.
