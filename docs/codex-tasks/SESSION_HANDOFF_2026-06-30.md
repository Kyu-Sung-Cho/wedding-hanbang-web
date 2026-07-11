# Session Handoff - 2026-06-30

> [!WARNING]
> **Historical handoff snapshot.** Branch, commit, deployment, and resume instructions below are not current. Re-check Git and use `docs/CONSUMER_JOURNEY_AND_AMORA_REVIEW_2026-07-11.md` before acting.

This handoff is for continuing the Wedding Hanbang web/mobile work from another computer.

## Current Git State

- Repository: `wedding-hanbang-web`
- Branch: `codex/community-weddingcode-foundation`
- Latest pushed commit before this handoff document: `f17c327b refactor(web): extract ai vendor tools`
- Working tree status before writing this document: clean

To continue on another computer:

```bash
git fetch origin
git checkout codex/community-weddingcode-foundation
git pull --ff-only origin codex/community-weddingcode-foundation
corepack pnpm install
```

Recommended verification after pulling:

```bash
corepack pnpm --filter @hanbang/web exec tsc --noEmit
corepack pnpm --filter @hanbang/web exec eslint .
corepack pnpm --filter @hanbang/web exec vitest run
corepack pnpm --filter @hanbang/web exec next build
```

## What Was Completed

### Community trust fix

- Fixed public wedding community feed/detail consistency.
- Public list, category filtering/counts, canonical href generation, and detail route now share the same public visibility rule.
- Goal was not to hide not-found pages, but to make public feed only link to detail pages the viewer can actually open.

Key commit:

- `536f8097 fix(web): centralize community public read rules`

### WeddingCode foundation

- Built the WeddingCode construct-first foundation as documentation and TypeScript types.
- Created internal construct definitions before any public 4-letter labels, final 16 types, characters, couple names, UI, scoring, or Amora prompt changes.
- Created question bank, review notes, smoke-test shortlist, smoke-test operations pack, expert review pack, no-code form guide, answer options, synthetic persona review, patched v0.3 item set, AI red-team review, and no-code form v0.3 build pack.
- Current WeddingCode state remains pre-product and pre-scoring. It is ready for no-code/human review workflow, not public launch.

Important docs are under:

- `docs/wedding-code/`

Most important current docs:

- `docs/wedding-code/13_smoke_test_item_set_v0.3.md`
- `docs/wedding-code/14_ai_red_team_review_v0.1.md`
- `docs/wedding-code/15_no_code_form_v0.3_build_pack.md`

### Mobile app foundation

- Added App Store-oriented mobile workflow preparation.
- This was foundation work only. Actual App Store launch still needs separate native build, signing, TestFlight/App Store Connect checks, screenshots, privacy details, and release review.

Key commit:

- `3c03524c chore(mobile): prepare app store build workflow`

### AI tool architecture refactor

The main web AI tool executor was getting too large. We started extracting deep Adapter Modules while keeping the existing `executeTool(toolName, input, context)` Interface stable.

Completed extractions:

- `apps/web/src/lib/ai/tools/riskSupportTools.ts`
- `apps/web/src/lib/ai/tools/quoteMarketTools.ts`
- `apps/web/src/lib/ai/tools/placeSearchTools.ts`
- `apps/web/src/lib/ai/tools/vendorTools.ts`

Tests added:

- `apps/web/src/lib/ai/tools/__tests__/riskSupportTools.test.ts`
- `apps/web/src/lib/ai/tools/__tests__/quoteMarketTools.test.ts`
- `apps/web/src/lib/ai/tools/__tests__/placeSearchTools.test.ts`
- `apps/web/src/lib/ai/tools/__tests__/vendorTools.test.ts`

Key commits:

- `65a6b0ba refactor(web): deepen ai chat support modules`
- `e1021c57 refactor(web): extract ai risk support tools`
- `23a5b481 refactor(web): extract ai quote market tools`
- `527adcc0 refactor(web): extract ai place search tools`
- `f17c327b refactor(web): extract ai vendor tools`

## Last Full Verification

After extracting `vendorTools`, the following passed locally:

```bash
corepack pnpm --filter @hanbang/web exec tsc --noEmit
corepack pnpm --filter @hanbang/web exec eslint .
corepack pnpm --filter @hanbang/web exec vitest run
corepack pnpm --filter @hanbang/web exec next build
```

Observed test result:

- 24 test files passed
- 227 tests passed

## What To Do Next

### 1. Extract booking tools next

Recommended next Module:

- `apps/web/src/lib/ai/tools/bookingTools.ts`

Move these functions out of `apps/web/src/lib/ai/toolExecutor.ts`:

- `executeGetAvailableSlots`
- `executeCreateBooking`
- `executeGetMyBookings`
- `executeCancelBooking`

Keep this Interface stable:

- `executeTool(toolName, toolInput, context)`

Suggested tests:

- Vendor not found response remains unchanged.
- Invalid product/vendor pairing remains blocked.
- Invalid staff/vendor pairing remains blocked.
- Product/staff schedule precedence still works.
- KST date range behavior stays stable.
- `cancel_booking` still mirrors schedule/budget sync behavior correctly.

### 2. Then extract schedule and Amora action Modules

After booking tools, the likely next deepening opportunities are:

- `scheduleTools.ts` for schedule/checklist/wedding event tools.
- `amoraActionTools.ts` for add/get/update Amora action tools.

Do these only after booking extraction passes full verification.

### 3. Keep scope narrow

Do not mix these into the refactor commits:

- New UI
- New routes
- Supabase migrations
- WeddingCode scoring
- Public WeddingCode letters/types/characters
- Amora prompt behavior changes
- Payment/vendor marketplace feature expansion

## Current Architecture Rule

`toolExecutor.ts` should stay as the orchestration seam.

Good target shape:

- `toolExecutor.ts` owns tool dispatch and cross-tool context.
- Each tool Adapter Module owns its own data access, mapping, user-facing display messages, and focused tests.
- Tests should cross the same Interface the executor calls, not private helper internals.

## If Continuing With GitHub

If this branch should become the shared working branch:

```bash
git push origin codex/community-weddingcode-foundation
```

If this work should be merged to the main branch, create or update a PR from:

- `codex/community-weddingcode-foundation`

Do not force push unless the team explicitly agrees.
