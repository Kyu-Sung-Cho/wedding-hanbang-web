# Session Handoff - 2026-07-08 WeddingCode v0.5

This handoff is for continuing Wedding Hanbang / WeddingCode work from another computer without re-discovering the latest state.

## Current Git State

- Repository: `Kyu-Sung-Cho/wedding-hanbang-web`
- Work branch at handoff creation: `audit/conservative-eval-2026-07`
- Production deployment branch expected by the project: `main`
- Main user goal: make WeddingCode a trustworthy, shareable wedding-preparation tool that helps couples understand each other's preparation style and prevent avoidable conflict.
- Current product stance: evidence-informed conversation tool, not a psychological diagnosis, compatibility guarantee, or marriage-success predictor.

After this handoff is committed and pushed, continue from the pushed commit reported in the final Codex response for this session.

## Resume Commands

Use these on a new computer after the commit is pushed:

```powershell
git fetch origin
git checkout main
git pull --ff-only origin main
corepack pnpm install
corepack pnpm --filter @hanbang/web test
corepack pnpm --filter @hanbang/web typecheck
corepack pnpm --filter @hanbang/web lint
corepack pnpm --filter @hanbang/web build
```

For local web QA:

```powershell
corepack pnpm --filter @hanbang/web dev
```

Then check:

- `http://localhost:3000/wedding-code`
- `http://localhost:3000/wedding-code/result`

## What Was Completed In This Session

### 1. WeddingCode Fable-Adapted Operating Protocol

- Added a repository-level WeddingCode protocol in `AGENTS.md`.
- The protocol points future agents to `docs/wedding-code/31_fable_mode_adaptation_protocol_v0.1.md`.
- It requires source verification before numeric/date/latest claims.
- It requires a draft -> adversarial review -> claim audit -> revision loop for WeddingCode items, scoring, result copy, couple comparison, rarity, and trust claims.
- It blocks overclaims such as "scientifically proven type", "marriage compatibility", or "guaranteed wedding success".

### 2. WeddingCode Evidence And Item Foundation

Added the v0.5 evidence and design documentation set:

- `docs/wedding-code/22_evidence_backbone_and_taxonomy_v0.1.md`
- `docs/wedding-code/23_v0.5_item_blueprint.md`
- `docs/wedding-code/24_v0.5_item_source_map.md`
- `docs/wedding-code/25_v0.5_scoring_model_draft.md`
- `docs/wedding-code/26_cognitive_interview_protocol_v0.1.md`
- `docs/wedding-code/27_item_review_A1_quote_addons_v0.1.md` through `43_item_review_D4_same_day_benefit_decision_v0.1.md`
- `docs/wedding-code/44_v0.5_item_set_integrity_audit.md`
- `docs/wedding-code/45_v0.5_result_copy_and_couple_overlap_spec.md`
- `docs/wedding-code/46_v0.5_forced_choice_comparability_audit.md`

Updated prior source review docs:

- `docs/wedding-code/02a_close_reading_wedding_service_survey_2024.md`
- `docs/wedding-code/02b_close_reading_chamgagyeok_price_data.md`
- `docs/wedding-code/18_item_evidence_crosscheck_v1.md`

Important conclusion: 2024 data is still usable as bounded source context, but not as a "latest market truth" unless refreshed or explicitly labeled. For product claims, use stable patterns and verified current data only.

### 3. WeddingCode v0.5 Question Set

Added `apps/web/src/constants/weddingCodeV05.ts`.

Current shape:

- 16 fixed forced-choice questions.
- Four domains:
  - A: money, evidence, vendor risk
  - B: couple coordination and role ownership
  - C: family, guest, and boundary coordination
  - D: support needs, pace, and guidance
- Each question has same-situation answer options.
- Each option maps to internal axes through weighted tendencies.
- The public copy avoids "correct answer" framing.

Key item-quality rule: options may represent different categories only when they answer the same prompt at the same abstraction level. They must not mix one concrete action with one broad personality label or one morally superior answer.

### 4. WeddingCode Scoring And Report Logic

Added:

- `apps/web/src/lib/weddingCode/score.ts`
- `apps/web/src/lib/weddingCode/report.ts`
- `apps/web/src/lib/weddingCode/__tests__/score.test.ts`
- `apps/web/src/lib/weddingCode/__tests__/report.test.ts`

Current behavior:

- Scores are calculated from 16 required answers.
- Axis outputs are spectrum-style percentages, not fixed "you are 100% this type" claims.
- Result copy is framed as preparation style and conversation guide.
- Confidence and exposure are bounded by actual answered items.
- Report sections include axis summaries, action cards, and talk starters.

### 5. WeddingCode Web Flow Integration

Updated:

- `apps/web/src/app/wedding-code/WeddingCodeClient.tsx`
- `apps/web/src/app/wedding-code/page.tsx`
- `apps/web/src/app/wedding-code/result/ResultClient.tsx`
- `apps/web/src/app/wedding-code/result/page.tsx`
- `apps/web/src/app/api/wedding-code/response/route.ts`
- `apps/web/src/lib/weddingCode/validate.ts`
- `apps/web/src/lib/weddingCode/__tests__/validate.test.ts`
- `apps/web/src/constants/weddingCodeForm.ts`

Current behavior:

- `/wedding-code` now uses the v0.5 16-question set.
- The UI no longer runs the older v0.4 gating/skip model as the actual product flow.
- Results are stored locally under `wc_result_v05`.
- Submitted API payloads use the current v0.5 form version.
- Result page uses v0.5 score/report output rather than the old mirror-profile result.
- Result screen includes axis reports, action cards, talk starters, share card, and invite URL entry point.

### 6. Amora Chat Date/Time And Image Paste Fixes

Updated:

- `apps/web/src/components/app/chat/ChatBubble.tsx`
- `apps/web/src/components/app/chat/ChatContent.tsx`
- `apps/web/src/components/app/chat/ChatSidePanel.tsx`
- `apps/web/src/stores/chatStore.ts`
- `apps/web/src/lib/chat/attachments.ts`
- `apps/web/src/lib/chat/__tests__/attachments.test.ts`
- `apps/web/src/lib/ai/tools/bookingTools.ts`
- `apps/web/src/lib/ai/tools/vendorTools.ts`
- `apps/web/src/lib/ai/tools/__tests__/bookingTools.test.ts`
- `apps/web/src/lib/ai/tools/__tests__/vendorTools.test.ts`

Current behavior:

- Amora chat bubbles display date and time, not time only.
- Booking and availability tool copy includes date and time where a user needs to disambiguate slots.
- Pasted or selected duplicate images are deduplicated by file fingerprint and by already-attached content.
- Global paste handling ignores editable targets to prevent one paste from being processed twice.
- Preview object URLs are cleaned up when attachment drafts change.

## Verification Already Run Before This Handoff

The following gates passed during this work:

```powershell
pnpm --filter @hanbang/web test
pnpm --filter @hanbang/web typecheck
pnpm --filter @hanbang/web lint
pnpm --filter @hanbang/web build
```

Known lint warning that already existed at handoff time:

- `apps/web/src/lib/quoteCheck/reportCard.ts`: unused `approxMeasure` warning.

Browser checks were also performed locally:

- `/wedding-code` rendered v0.5, `1/16`, and the first question.
- `/wedding-code/result` rendered the v0.5 result UI.
- No browser console errors were observed during the checked flows.

Re-run all gates after pulling this commit on a new machine.

## Important Product Constraints Going Forward

- Do not claim WeddingCode is a clinical or scientifically proven personality diagnosis.
- Do not claim couple fit predicts marriage success.
- Use "preparation style", "conversation point", "decision tendency", and "areas to align before choosing" instead.
- Rarity must be based on real collected response data. Until enough production data exists, label it as "current response pool" or hide it.
- Compatibility percentages should be spectrum-style and bounded. They should explain "where discussion may be easier or harder", not "how good the couple is".
- Animal/adjective type labels can be fun, but they must be a wrapping layer over the validated scoring model, not the source of truth.
- Every item option must answer the same situation and have comparable specificity.

## Next Work

### P0 - Production Sanity After Deploy

- Confirm the production deployment URL from Vercel.
- Smoke test these routes on production:
  - `/wedding-code`
  - `/wedding-code/result`
  - invite-link flow from result page
- Submit one test response if safe for the active Supabase environment.
- Confirm API payload stores `form_version` for v0.5.

### P0 - Human Validation Before Strong Public Claims

- Run at least 5 cognitive interviews using `docs/wedding-code/26_cognitive_interview_protocol_v0.1.md`.
- Use `docs/wedding-code/46_v0.5_forced_choice_comparability_audit.md` as the item-by-item checklist.
- For each item, ask whether users understand the situation, see all options as plausible, and can pick one "first response" without feeling judged.
- Revise any option that users interpret as a different question, different category, or obviously better answer.

### P1 - Real Couple Comparison

- Implement actual partner-result comparison instead of only an invite URL and local result display.
- Add or confirm persistence for:
  - response owner
  - couple or share token
  - form version
  - answer set
  - computed score summary
- Show partner overlap/gap only when both sides have v0.5-compatible results.

### P1 - Shareable Type Layer

- Add adjective + animal labels only after item copy passes human validation.
- Keep labels warm and memorable, for example "신중한 사슴" or "정리형 고래", but avoid status hierarchy.
- Do not let animal labels imply gender, intelligence, maturity, wealth, or wedding success.
- Add Kakao share metadata and image card once final labels are locked.

### P1 - Rarity And Percentile Rules

- Do not show global rarity until the response pool is large enough.
- Suggested temporary rule:
  - fewer than 30 responses: hide rarity
  - 30-99 responses: "현재 응답자 중 비슷한 스타일"
  - 100+ responses: show bounded percentile with sample size
- Document the sample-size rule before enabling public rarity copy.

### P2 - Data And Compliance Logging

- Confirm whether anonymous WeddingCode responses should write to `ai_interactions_log` or only user-linked AI calls should.
- When WeddingCode is tied to logged-in couples, record couple-facing decisions in `decision_nodes`.
- Keep all future AI-generated result copy changes auditable.

### P2 - Cleanup And Polish

- Resolve the existing `approxMeasure` lint warning if it becomes noisy in CI.
- Add production visual QA screenshots for mobile widths.
- Add analytics events for start, item answer, completion, share click, invite copy, and partner result open.

## Key Files To Read First Next Time

Read these in order before making more WeddingCode changes:

1. `PRINCIPLES.md`
2. `AGENTS.md`
3. `DESIGN.md`
4. `docs/wedding-code/31_fable_mode_adaptation_protocol_v0.1.md`
5. `docs/wedding-code/44_v0.5_item_set_integrity_audit.md`
6. `docs/wedding-code/45_v0.5_result_copy_and_couple_overlap_spec.md`
7. `docs/wedding-code/46_v0.5_forced_choice_comparability_audit.md`
8. `apps/web/src/constants/weddingCodeV05.ts`
9. `apps/web/src/lib/weddingCode/score.ts`
10. `apps/web/src/lib/weddingCode/report.ts`

## Recommended Next Prompt

Use this prompt to continue cleanly from another computer:

```text
docs/codex-tasks/SESSION_HANDOFF_2026-07-08_WEDDING_CODE_V05.md를 먼저 읽고,
WeddingCode v0.5를 이어서 개발해줘.
우선 production smoke 결과와 v0.5 남은 P0/P1 항목을 확인하고,
다음 단계는 인지면접 결과 반영 전까지 과장표현 없이 안전하게 진행해줘.
```
