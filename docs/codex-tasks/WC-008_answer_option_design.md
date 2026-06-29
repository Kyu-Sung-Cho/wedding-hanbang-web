# WC-008 — WeddingCode Answer Option Design v0.1

## Goal
Create neutral Korean answer options for the 16 WeddingCode smoke-test questions before building a no-code form.

This task is **not** product UI work and **not** scoring work. It is a pre-human-validation design step.

## Source files
Use these files as the source of truth:

- `docs/wedding-code/07_smoke_test_shortlist_v0.2.md`
- `docs/wedding-code/05_question_domain_map.md`
- `docs/wedding-code/10_no_code_form_build_guide_v0.1.md`
- `apps/web/src/lib/wedding-code/constructs.ts`
- `apps/web/src/lib/wedding-code/types.ts`

The shared case-study/design document may be used only as a **non-binding design hypothesis**, especially the idea that answer choices can reveal multiple construct tendencies. Do **not** implement numeric weights or scoring.

## Create only

- `docs/wedding-code/11_answer_option_design_v0.1.md`

## Do not do these

Do not add or modify:

- UI
- routes
- DB migrations
- scoring logic
- numeric weights
- final public 4-letter codes
- final 16 types
- characters
- couple combination names
- Amora prompts
- existing source docs
- existing question bank or shortlist files

## Important principles

- Every answer option must sound valid and reasonable.
- Do not create good-person vs bad-person framing.
- Avoid gender assumptions about bride, groom, or task ownership.
- Avoid shame labels around money, emotion, family, autonomy, execution, guidance, or decision speed.
- Do not use final public 4-letter codes.
- Do not create final types or characters.
- Do not assign numeric weights.
- Do not imply a scoring engine.
- Treat option-to-construct mapping as a draft hypothesis for future validation.
- Keep `emotionalSupport`, `executionSupport`, `decisionPaceRisk`, and `guidanceNeed` as internal UX/risk constructs.
- Keep `familyIntegration` and `coupleAutonomy` separate unless future user data supports combining them.

## Output document structure

The new document should include the following sections.

### 1. Scope
Explain that this document designs answer options for the 16 smoke-test questions. It does not define final scoring, public labels, final types, characters, UI, DB schema, or Amora behavior.

### 2. Answer option design rules
Include concise rules:

- Answer choices should represent different valid wedding-preparation approaches.
- No choice should look like the “correct” or morally superior answer.
- Each choice may indicate one or more construct tendencies.
- Product routing may be noted, but it must not be implemented.
- Future scoring notes must be marked as “hypothesis only.”

### 3. Answer option designs for 16 questions
For each of the 16 questions from `07_smoke_test_shortlist_v0.2.md`, include:

- Question ID
- Target construct
- Secondary constructs
- Journey stage
- Question text
- 4 Korean answer options
- For each answer option:
  - Option label: A/B/C/D
  - Korean option text
  - Construct tendencies it may indicate
  - Product action it may route to
  - Bias/stigma risk note
- Answer options to avoid
- Future scoring note: explicitly write “hypothesis only; do not implement scoring yet”

### 4. Cross-question balance check
Include:

- Are cost/risk options overrepresented?
- Are mood/meaning options represented respectfully?
- Are family and autonomy both represented neutrally?
- Are empathy and execution both represented as valid support needs?
- Are guidance and decision-pace questions framed as support/risk prevention, not identity labels?
- Are any options too obviously desirable?

### 5. High-risk option warnings
List any answer options that may need rewriting before smoke testing.

### 6. Recommendations for WC-009
Explain whether WC-009 Synthetic Persona Response Matrix can start, and what it should test.

## Required constructs
The 16 questions should cover tendencies related to:

- `costRisk`
- `experienceMeaning`
- `coPreparation`
- `roleOwnership`
- `evidenceDecision`
- `aestheticMood`
- `familyIntegration`
- `coupleAutonomy`
- `emotionalSupport`
- `executionSupport`
- `decisionPaceRisk`
- `guidanceNeed`

## Suggested option style
Good answer options should look like this kind of neutral structure:

- “추가 비용과 총액이 감당 가능한지 먼저 본다.”
- “이 선택이 우리에게 왜 중요한지 먼저 생각한다.”
- “부모님과 하객 편의까지 함께 고려해본다.”
- “상대와 예산과 만족감 기준을 다시 맞춘다.”

Avoid options like:

- “현실적으로 돈을 아낀다.”
- “감정에 휘둘려 비싼 걸 고른다.”
- “상대가 관심이 없어서 내가 다 한다.”
- “부모님 때문에 어쩔 수 없이 맞춘다.”

## Verification commands
Run:

```bash
pnpm typecheck
pnpm --filter @hanbang/web lint
pnpm build:web
```

## Final report format
Report:

1. Files changed
2. Questions covered
3. Total answer option count
4. Any high-risk option warnings
5. Commands run and results
6. Whether WC-009 synthetic persona response matrix can start
