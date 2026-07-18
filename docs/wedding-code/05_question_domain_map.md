# WeddingCode Question Domain Map v0.1

> [!CAUTION]
> **HISTORICAL / NOT CURRENT SPEC.** 초기 설계·검토 계보이며 현재 문항·점수·유형·근거·수집·운영
> 승인으로 사용하지 않는다. 현행 상태는 [`README.md`](./README.md)와
> [`62`](./62_wedding_code_master_design_and_current_state_2026-07-18.md)를 따른다.

## 0. Scope

This file defines scenario domains for future WeddingCode question writing. It is a bridge between the construct definitions in Genesis v0.1 and a future question bank.

This file does not define final assessment questions, answer options, public presentation labels, final types, characters, couple combination names, UI, routes, database schema, or Amora prompt behavior.

The domains below describe concrete wedding-preparation situations that future non-judgmental questions can measure. Each future question should remain useful for at least one product action, such as Amora guidance, quote checking, checklist generation, etiquette guidance, onboarding, couple reports, community context, or wedding lounge exploration.

## 1. Global question-domain rules

- Use concrete wedding scenarios instead of abstract preference prompts.
- Avoid "good person vs bad person" framing.
- Avoid gender assumptions about bride, groom, partner, or task ownership.
- Avoid labels such as cheap, emotional, selfish, uninterested, dependent, weak, cold, irrational, or wasteful.
- Every future question should map to at least one construct and one product action.
- Scenario domains are not final questions and should not contain final answer options.
- Public presentation labels remain provisional and outside the scoring source of truth.
- High and low scores should describe support needs, decision patterns, or product routing, not personal worth or relationship quality.
- Future questions should be useful for reports, Amora, quote checking, etiquette guidance, checklist actions, couple reports, or onboarding.

## 1.1 Future WC-003 tagging requirements

- Each future question must have a primary construct.
- Each future question may have secondary constructs.
- Each future question should include journey stage tags such as `dating_or_meeting`, `marriage_discussion`, `preparing_without_date`, `venue_search`, `sdm_search`, `family_meeting`, `contract_pending`, `contracted`, `wedding_week`, or `post_wedding`.
- `emotionalSupport`, `executionSupport`, `decisionPaceRisk`, and `guidanceNeed` are internal UX/risk support constructs and should not become public identity labels by default.
- `familyIntegration` and `coupleAutonomy` should not be forced into a simple binary until data confirms their relationship.
- `costRisk`/`evidenceDecision` and `experienceMeaning`/`aestheticMood` may overlap; question writing must separate primary decision motivation from secondary context.
- Future user-facing questions should be written in Korean and remain situational, neutral, and non-stigmatizing.

## 2. Construct Domain Maps

### costRisk - 비용·리스크 민감도 / Cost & Risk Orientation

Construct key: `costRisk`

Measurement purpose:
Measure how strongly the user wants to check total cost, hidden fees, refund/cancellation terms, guarantee count, meal cost, and contract risk before deciding.

Scenario domains:
1. A venue the user likes is above the planned budget.
2. A dress upgrade or additional fitting fee appears during selection.
3. A fair booth or consultation offers a "today only" discount.
4. The required guest guarantee count is higher than expected.
5. Meal cost changes significantly as the guest count changes.
6. A studio package does not clearly state original file, retouching, helper, or early-start fees.
7. Contract deposit, refund, or cancellation conditions are unclear.
8. Basic package inclusions and exclusions are ambiguous.
9. A vendor quote looks attractive but excludes required options.
10. A parent or partner suggests increasing the budget after an emotional consultation.

High score may imply:
The user feels safer when cost, hidden fees, and contract risk are clarified before deciding.

Low score may imply:
The user may prioritize experience, mood, convenience, or family considerations before cost risk.

Bias/stigma risks to avoid:
Do not describe the user as cheap, stingy, money-obsessed, satisfaction-denying, or less romantic.

Connected product surfaces:
`quote_check`, `amora`, `checklist`

Candidate evidence tags:
`KOREAN_WEDDING_RISK`, `COUPLE_ASSESSMENT`, `HANBANG_ASSET`

Notes for future question writing:
Questions should ask what the user checks first in cost-risk situations, not whether money is important. Keep the wording focused on contract safety and decision readiness.

### experienceMeaning - 경험·의미 중시도 / Experience & Meaning Orientation

Construct key: `experienceMeaning`

Measurement purpose:
Measure how strongly the user values lasting emotional meaning, mood, photography, video, dress, flowers, venue atmosphere, and ceremony experience.

Scenario domains:
1. A favorite dress exceeds the base package.
2. A preferred studio mood costs more than expected.
3. Wedding video is optional but feels emotionally meaningful.
4. A flower upgrade changes the ceremony mood noticeably.
5. A venue atmosphere feels ideal but is not the cheapest option.
6. A package is practical but does not match the couple's imagined wedding.
7. The user must choose between saving money and keeping a meaningful detail.
8. A partner wants to reduce a visual or memory-related item.
9. The user imagines how the wedding will feel years later through photos or videos.
10. Aesthetic satisfaction conflicts with quote simplicity.
11. Ceremony content such as vows, parent gratitude, or the ceremony message feels emotionally meaningful.

High score may imply:
The user sees wedding choices as lasting memories and wants meaningful satisfaction.

Low score may imply:
The user may prioritize cost stability, convenience, family needs, or execution over emotional and aesthetic meaning.

Bias/stigma risks to avoid:
Do not describe the user as irrational, wasteful, vain, image-obsessed, or unable to control spending.

Connected product surfaces:
`amora`, `checklist`, `wedding_lounge`

Candidate evidence tags:
`WEDDING_PLATFORM_SEGMENTATION`, `PRODUCT_DATA`, `UI_IDENTITY`

Notes for future question writing:
Questions should distinguish meaningful satisfaction from uncontrolled spending. The scenario should make it clear what memory, atmosphere, or experience value is at stake.

### coPreparation - 함께준비 기대도 / Co-Preparation Need

Construct key: `coPreparation`

Measurement purpose:
Measure how strongly the user wants wedding preparation to feel like a shared couple process.

Scenario domains:
1. A partner says the user knows better and can decide.
2. The user researches vendors alone for several days.
3. An important decision is made without partner discussion.
4. A partner trusts the user but does not actively review options.
5. The user wants a regular wedding-preparation meeting.
6. The couple needs to decide which items must be reviewed together.
7. The user wants emotional participation, not only approval.
8. A partner only responds when asked to choose final options.
9. The user wants shared memory-making during preparation.
10. The user feels responsible for explaining every choice to the partner.

High score may imply:
The user values shared involvement and may feel alone if decisions are delegated without participation.

Low score may imply:
The user may be comfortable with division of labor or delegated decision-making.

Bias/stigma risks to avoid:
Do not describe the user as needy, clingy, demanding, controlling, or unable to decide alone.

Connected product surfaces:
`couple_report`, `onboarding`, `amora`, `checklist`

Candidate evidence tags:
`COUPLE_ASSESSMENT`, `DYADIC_COPING`, `PRODUCT_DATA`

Notes for future question writing:
Do not frame partner participation as interest versus no interest. Frame it as an expectation about preparation style and what decisions should feel shared.

### roleOwnership - 역할주도 선호도 / Role Ownership Preference

Construct key: `roleOwnership`

Measurement purpose:
Measure how much the user prefers dividing wedding work by owner and letting the responsible person lead.

Scenario domains:
1. Many vendor candidates need to be narrowed down.
2. The couple must decide who owns budget tracking.
3. One partner is stronger at style review while another is stronger at numbers.
4. The user prefers one person to shortlist and both people to decide the final option.
5. Multiple tasks need deadlines and owners.
6. A partner wants to review every detail together.
7. The user feels efficiency improves when work is divided.
8. The user wants clear "who does what" agreements.
9. The user wants to avoid repeated open-ended discussions.
10. The user prefers final approval after delegated research.

High score may imply:
The user prefers efficient role ownership and action clarity.

Low score may imply:
The user may prefer shared exploration or joint decision-making.

Bias/stigma risks to avoid:
Do not describe the user as uninterested, cold, dismissive, avoidant, or unwilling to take responsibility.

Connected product surfaces:
`couple_report`, `checklist`, `amora`

Candidate evidence tags:
`COUPLE_ASSESSMENT`, `PRODUCT_DATA`

Notes for future question writing:
Questions should separate efficient ownership from lack of care. Include situations where delegated ownership still includes respect, transparency, and final alignment.

### evidenceDecision - 근거기반 결정성향 / Evidence-Based Decision Orientation

Construct key: `evidenceDecision`

Measurement purpose:
Measure how strongly the user prefers reviews, real prices, contracts, price tables, quote comparisons, and refund conditions before deciding.

Scenario domains:
1. A studio has beautiful photos but few reviews.
2. A vendor quote lacks detailed inclusions.
3. Contract terms are hard to understand.
4. The user compares market prices before consultation.
5. The user asks for actual paid examples from similar couples.
6. The user wants written confirmation of verbal promises.
7. The user checks cancellation and refund terms before deposit.
8. The user compares quote line items across vendors.
9. The user hesitates when a package is not transparent.
10. The user trusts structured reviews more than influencer posts.

High score may imply:
The user needs evidence and clear conditions before feeling ready to decide.

Low score may imply:
The user may rely more on mood, trust, expert guidance, or overall fit.

Bias/stigma risks to avoid:
Do not describe high-score users as superior, more rational, or more correct. Do not describe low-score users as careless, naive, or unintelligent.

Connected product surfaces:
`quote_check`, `community`, `amora`

Candidate evidence tags:
`DECISION_STYLE`, `KOREAN_WEDDING_RISK`, `HANBANG_ASSET`

Notes for future question writing:
Questions should measure decision approach, not intelligence. Evidence should include concrete artifacts such as quotes, reviews, written terms, and comparable paid examples.

### aestheticMood - 무드·취향 결정성향 / Aesthetic/Mood Decision Orientation

Construct key: `aestheticMood`

Measurement purpose:
Measure how strongly the user responds to visual mood, color, portfolio, first impression, and aesthetic fit.

Scenario domains:
1. A portfolio matches the couple's desired mood closely.
2. A venue atmosphere feels right immediately.
3. A dress silhouette strongly matches the user's imagined style.
4. A flower color palette changes the emotional impression of the ceremony.
5. Studio color tone matters more than package convenience.
6. The user compares visual references before price details.
7. The user reacts strongly to first impression during consultation.
8. Visual fit conflicts with limited reviews.
9. The user wants mood keywords before vendor search.
10. Generic packages do not feel like they reflect the couple.

High score may imply:
The user quickly reads atmosphere and wants aesthetic fit to guide choices.

Low score may imply:
The user may prioritize evidence, cost, convenience, family, or expert guidance before mood.

Bias/stigma risks to avoid:
Do not describe the user as irrational, superficial, overly emotional, image-obsessed, or impractical.

Connected product surfaces:
`wedding_lounge`, `amora`, `checklist`

Candidate evidence tags:
`DECISION_STYLE`, `WEDDING_PLATFORM_SEGMENTATION`, `UI_IDENTITY`

Notes for future question writing:
Questions should respect mood-based judgment as a valid decision input. Avoid turning aesthetic sensitivity into a character judgment.

### familyIntegration - 가족·양가 조율도 / Family System Integration

Construct key: `familyIntegration`

Measurement purpose:
Measure how much the user considers parents, honju, guests, meal satisfaction, transportation, reputation, etiquette, and both-family harmony.

Scenario domains:
1. Parents ask to increase the guest count.
2. Parents prefer a venue with better food or transportation over mood.
3. The couple wants a small wedding but family expects a traditional format.
4. Both families disagree on region or venue type.
5. Meal quality matters for older relatives.
6. Honju movement, parking, and waiting space are important.
7. Family etiquette conflicts with the couple's preference.
8. The user wants to avoid either family feeling excluded.
9. Guest experience affects venue choice.
10. Cost split, gifts, or ceremony etiquette needs family discussion.
11. Both families have different expectations about guest count or cost-sharing.

High score may imply:
The user actively integrates family and guest considerations into wedding choices.

Low score may imply:
The user may prefer couple-defined standards and simplified formats.

Bias/stigma risks to avoid:
Do not describe high-score users as blindly obedient or lacking independence. Do not describe low-score users as selfish, disrespectful, or anti-family.

Connected product surfaces:
`etiquette_guide`, `couple_report`, `amora`, `checklist`

Candidate evidence tags:
`COUPLE_ASSESSMENT`, `HANBANG_ASSET`, `PRODUCT_DATA`

Notes for future question writing:
Use neutral language around parents, honju, etiquette, and family expectations. Include respectful coordination, not only compliance or rejection.

### coupleAutonomy - 커플자율 지향도 / Couple Autonomy Orientation

Construct key: `coupleAutonomy`

Measurement purpose:
Measure how strongly the user wants the couple's own standards, lifestyle, practicality, taste, and budget to guide wedding choices.

Scenario domains:
1. The couple wants a small wedding while parents expect a larger wedding.
2. The couple wants to skip or simplify some traditional etiquette.
3. The couple chooses practicality over family-facing formality.
4. The couple wants guest count based on relationship closeness.
5. The user wants to explain choices to parents without conflict.
6. The user wants to reduce formal procedures while keeping meaning.
7. The couple wants budget allocation to reflect their lifestyle.
8. The user values "our wedding" more than external expectations.
9. The couple wants a non-standard venue or format.
10. The couple wants to prioritize future life over ceremony scale.

High score may imply:
The user wants the couple's own criteria to strongly guide wedding decisions.

Low score may imply:
The user may more readily integrate family expectations, tradition, or guest-facing standards.

Bias/stigma risks to avoid:
Do not describe the user as selfish, immature, disrespectful, anti-family, or unwilling to compromise.

Connected product surfaces:
`etiquette_guide`, `couple_report`, `checklist`

Candidate evidence tags:
`COUPLE_ASSESSMENT`, `PRODUCT_DATA`

Notes for future question writing:
Questions should include how to explain choices respectfully, not only what the couple wants. Autonomy should be framed as criteria-setting, not family rejection.

### emotionalSupport - 공감먼저 필요도 / Emotional Support Need

Construct key: `emotionalSupport`

Measurement purpose:
Measure how strongly the user needs emotional acknowledgment before problem-solving in wedding stress.

Scenario domains:
1. The user feels exhausted from wedding research.
2. A partner responds with solutions when the user wanted acknowledgment.
3. The user wants emotional participation before dividing tasks.
4. Conflict arises after a stressful consultation.
5. The user feels alone even when tasks are progressing.
6. The user wants a partner to recognize why a detail matters.
7. The user needs reassurance before revising budget or scope.
8. The user wants Amora to reflect feelings before giving tasks.
9. Couple discussion escalates because one side moves too fast to solutions.
10. The user needs "I understand why this matters" before compromise.

High score may imply:
The user works better when emotion is acknowledged before action planning.

Low score may imply:
The user may prefer direct action, structure, or next steps sooner.

Bias/stigma risks to avoid:
Do not describe the user as weak, fragile, dramatic, overly emotional, or difficult.

Connected product surfaces:
`amora`, `couple_report`

Candidate evidence tags:
`DYADIC_COPING`, `DEMAND_WITHDRAW`, `PRODUCT_DATA`

Notes for future question writing:
This should primarily tune Amora and couple scripts, not public identity labels. Questions should measure sequencing of support, not emotional worth.

### executionSupport - 실행먼저 필요도 / Execution Support Need

Construct key: `executionSupport`

Measurement purpose:
Measure how strongly the user prefers concrete actions, roles, deadlines, and decisions before emotional processing.

Scenario domains:
1. Wedding stress feels easier after tasks are listed.
2. The user wants to assign owners quickly after conflict.
3. A partner wants to talk longer before deciding next steps.
4. The user prefers a short list of today's top tasks.
5. Consultation confusion needs an action checklist.
6. Budget disagreement needs a concrete spreadsheet or rule.
7. The user calms down after deadlines and responsibilities are clear.
8. The user wants Amora to summarize actions first.
9. The user dislikes open-ended discussions with no conclusion.
10. The user wants a concrete decision framework after emotional disagreement.

High score may imply:
The user feels more stable when next actions, owners, and deadlines are clear.

Low score may imply:
The user may need emotional alignment or shared understanding before action.

Bias/stigma risks to avoid:
Do not describe the user as cold, insensitive, empathy-lacking, impatient, or overly task-driven.

Connected product surfaces:
`amora`, `checklist`, `couple_report`

Candidate evidence tags:
`DYADIC_COPING`, `PRODUCT_DATA`

Notes for future question writing:
This should tune Amora and action cards, not be used to shame communication style. Keep the focus on what helps the user recover clarity.

### decisionPaceRisk - 빠른계약 위험도 / Decision Pace & Commitment Control

Construct key: `decisionPaceRisk`

Measurement purpose:
Measure risk of committing too quickly under time pressure, "today only" discounts, fair booths, or consultation urgency.

Scenario domains:
1. A fair booth offers a discount only if signing today.
2. A venue says the preferred date may disappear soon.
3. A consultant pressures deposit before full quote review.
4. The user feels emotionally excited after consultation.
5. The user wants to decide quickly to reduce stress.
6. A partner wants to sleep on it but the user wants to lock it in.
7. A vendor provides verbal promises but not written details.
8. The user feels scarcity pressure around popular dates.
9. The user receives a bundle discount with unclear exclusions.
10. The user signs before comparing cancellation conditions.
11. A small deposit feels easy to pay before the user has reviewed the conditions.

High score may imply:
The user may benefit from a pause rule and contract-before-signing checklist.

Low score may imply:
The user may naturally delay, compare, or ask for more detail before committing.

Bias/stigma risks to avoid:
Do not describe the user as impulsive, foolish, easily manipulated, careless, or poor at judgment.

Connected product surfaces:
`quote_check`, `amora`, `checklist`

Candidate evidence tags:
`DECISION_STYLE`, `KOREAN_WEDDING_RISK`, `HANBANG_ASSET`

Notes for future question writing:
This should be treated as risk prevention, not public identity. Questions should surface when a delay, written confirmation, or contract checklist would help.

### guidanceNeed - 정보압축 필요도 / Guidance & Information Load Need

Construct key: `guidanceNeed`

Measurement purpose:
Measure how much the user needs Amora or the product to reduce information overload and compress choices into clear next actions.

Scenario domains:
1. The user has too many vendor options.
2. The user does not know what to do first.
3. The user wants top options instead of a long list.
4. The user wants Amora to prioritize tasks by urgency.
5. The user is overwhelmed by community opinions.
6. The user wants a simple checklist from a messy quote.
7. The user wants to know which questions to ask in consultation.
8. The user wants a short plan for the current wedding stage.
9. The user wants guidance before doing detailed comparisons.
10. The user feels stuck between budget, family, and mood criteria.
11. The user does not know what to prepare before sanggyeonrye or a venue tour.

High score may imply:
The user benefits from compressed guidance, next-step cards, and Amora-led prioritization.

Low score may imply:
The user may prefer direct access to data, lists, and self-led exploration.

Bias/stigma risks to avoid:
Do not describe the user as dependent, incapable, uninformed, passive, or unable to prepare.

Connected product surfaces:
`amora`, `onboarding`, `wedding_lounge`, `checklist`

Candidate evidence tags:
`DECISION_STYLE`, `HANBANG_ASSET`, `PRODUCT_DATA`

Notes for future question writing:
This should tune the amount of guidance and compression in the experience. Future questions should distinguish helpful compression from lack of interest in detail.
