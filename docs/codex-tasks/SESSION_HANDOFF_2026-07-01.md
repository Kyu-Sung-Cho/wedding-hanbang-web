# Session Handoff - 2026-07-01

This handoff is for continuing Wedding Hanbang web/mobile work from another computer.

## Current Git State

- Repository: `wedding-hanbang-web`
- Branch to continue from: `main`
- Latest shipped commit before this handoff document: `65e7de2f fix: refresh mobile bookings on booking updates`
- Latest production deployment verified: `https://wedding-hanbang-p7gmq2qpa-hanbang.vercel.app`
- Latest main CI verified: success on run `28478500212`
- Working tree status before writing this document: clean

To continue on another computer:

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
corepack pnpm install
```

Recommended verification after pulling:

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
```

Expected current test count:

- 31 test files
- 265 tests

## Product Context

The recent work focused on closing the loop between booking outcomes, budget memory, Amora context, and mobile screen freshness.

The intended user experience is:

1. A user records or cancels a vendor booking.
2. The booking state updates the shared planning memory.
3. The budget reflects real actual spend, not just estimated cost.
4. Amora can use actual booking cost context in future advice.
5. Mobile Home, Budget, and Bookings screens do not keep stale server data after the user navigates back or the partner changes data.

This follows the project principles:

- P1 trust: actual costs and cancellation effects must be visible and not misleading.
- P3 memory: booking outcomes become durable planning memory.
- P2 depth: improve the booking/budget loop instead of adding shallow new screens.
- P5 numbers: actual amounts, contracted amounts, and budget deltas are tracked explicitly.

## What Was Completed

### PR #15 - Mobile booking outcome nudges

- PR: `https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/pull/15`
- Merge commit: `9066711f feat: surface booking outcome nudges on mobile home`
- Branch: `codex/mobile-booking-outcome-nudges`
- Files touched:
  - `apps/mobile/app/(tabs)/dashboard.tsx`
  - `apps/mobile/app/bookings/index.tsx`

Completed behavior:

- Mobile Home now surfaces booking outcome tasks for past/completed bookings that still need actual cost feedback.
- The booking list can deep-link/open a requested booking so the user can record the result.
- This makes the mobile app actively ask for real booking outcomes instead of silently letting estimates remain stale.

### PR #16 - Amora booking actual cost context

- PR: `https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/pull/16`
- Merge commit: `3b4aeabe feat: include actual booking costs in amora context`
- Branch: `codex/amora-booking-actual-cost-context`
- Files touched:
  - `apps/web/src/app/api/chat/route.ts`
  - `apps/web/src/lib/ai/prompts.ts`
  - `apps/web/src/lib/ai/__tests__/prompts.test.ts`

Completed behavior:

- Chat context now includes actual and contracted booking costs when available.
- Amora's system prompt can reason from real paid/contracted amounts, not just rough budget estimates.
- Prompt tests were updated so the budget/booking context regression is covered.

### PR #17 - Booking outcome budget sync

- PR: `https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/pull/17`
- Merge commit: `487f7909 feat: sync booking outcomes into budget progress`
- Branch: `codex/booking-outcome-budget-sync`
- Files touched:
  - `apps/web/src/app/api/bookings/[id]/outcome/route.ts`
  - `apps/web/src/app/api/bookings/[id]/outcome/__tests__/route.test.ts`
  - `apps/web/src/lib/bookings/progressSync.ts`
  - `apps/web/src/lib/bookings/__tests__/progressSync.test.ts`

Completed behavior:

- Saving a booking outcome now updates `wedding_journeys.progress`.
- Actual cost deltas are reflected into the relevant category `spent` value.
- The sync stores booking contribution metadata under `progress.__booking_costs` so future updates can subtract/adjust previous contributions instead of double-counting.
- Route and helper tests cover the budget sync path.

### PR #18 - Booking cancellation progress sync

- PR: `https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/pull/18`
- Merge commit: `d5b05d33 fix: sync cancelled bookings from planning progress`
- Branch: `codex/booking-cancel-progress-sync`
- Files touched:
  - `apps/web/src/lib/ai/tools/bookingTools.ts`
  - `apps/web/src/lib/ai/tools/__tests__/bookingTools.test.ts`
  - `apps/web/src/lib/bookings/progressSync.ts`
  - `apps/web/src/lib/bookings/__tests__/progressSync.test.ts`

Completed behavior:

- Creating/cancelling bookings now uses the shared booking progress sync helper.
- Cancelling a booking removes both full UUID and old short booking event keys from progress event memory.
- Cancelling subtracts the stored actual booking contribution from category spend.
- Tests cover legacy short-id cleanup and spend subtraction.

### PR #19 - Mobile budget realtime/focus refresh

- PR: `https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/pull/19`
- Merge commit: `2c9ff0c3 fix: refresh mobile budget on planning updates`
- Branch: `codex/mobile-budget-realtime-refresh`
- Files touched:
  - `apps/mobile/app/budget/index.tsx`

Completed behavior:

- Mobile Budget refreshes whenever the screen regains focus.
- Mobile Budget subscribes to `wedding_journeys` updates for the active couple.
- Booking outcome and cancellation changes now appear in the mobile budget view without requiring manual pull-to-refresh.

### PR #20 - Mobile bookings realtime/focus refresh

- PR: `https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/pull/20`
- Merge commit: `65e7de2f fix: refresh mobile bookings on booking updates`
- Branch: `codex/mobile-bookings-realtime-refresh`
- Files touched:
  - `apps/mobile/app/bookings/index.tsx`

Completed behavior:

- Mobile Bookings refreshes whenever the screen regains focus.
- Mobile Bookings subscribes to `vendor_bookings` changes for the active couple.
- If the booking detail sheet is open, it is refreshed from the latest server row; if the booking disappears, the sheet closes.
- New bookings, cancellations, and outcome updates now flow back into the list and summary without stale local state.

## Verification Completed

The latest two PRs were verified locally before opening PRs with:

```bash
corepack pnpm --filter @hanbang/mobile typecheck
corepack pnpm --filter @hanbang/mobile lint
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
```

Results:

- `corepack pnpm typecheck`: passed
- `corepack pnpm lint`: passed
- `corepack pnpm test`: passed, 31 files / 265 tests
- `corepack pnpm build`: passed
- PR #19 checks: passed
- PR #20 checks: passed
- main CI after PR #19: passed
- main CI after PR #20: passed
- Production deployment after PR #20: success

Notes:

- Mobile `build` currently prints `Use EAS Build: eas build --platform all`; native store builds still need EAS/App Store work.
- I did not run a real authenticated mobile device session in this handoff step. The server/client paths were verified through code review, type/lint/tests/build, GitHub CI, and Vercel deployment.

## Important Implementation Notes

### Shared progress sync helper

`apps/web/src/lib/bookings/progressSync.ts` is now the central place for booking-to-progress side effects.

Keep future booking create/update/cancel paths using this helper so:

- `wedding_journeys.progress.__events` stays consistent.
- `wedding_journeys.progress.__booking_costs` stays consistent.
- category `spent` values do not double-count actual costs.
- legacy short booking ids are cleaned up when needed.

### Mobile refresh pattern

The current pattern for server-backed mobile screens is:

- load on focus with `useFocusEffect`
- subscribe to Supabase Realtime when the screen depends on partner-visible shared state
- remove the channel on cleanup
- keep any open detail modal/sheet synchronized with freshly loaded rows

Recent examples:

- `apps/mobile/app/budget/index.tsx`
- `apps/mobile/app/bookings/index.tsx`
- existing dashboard/schedule realtime patterns

### Amora context

`apps/web/src/app/api/chat/route.ts` and `apps/web/src/lib/ai/prompts.ts` now carry actual booking costs into Amora context.

Do not remove actual/contracted amount context unless a replacement memory model is added. This context is part of the trust and budget loop.

## What To Do Next

### 1. Real mobile smoke test

Use a real Expo/mobile session with a test account:

1. Create or find a booking.
2. Mark it completed or use a past booking.
3. Save actual amount and rating from `/bookings`.
4. Confirm `/budget` category spend updates without manual refresh.
5. Cancel a booking.
6. Confirm `/bookings`, `/budget`, `/schedule`, and Home all reflect the cancellation.
7. Ask Amora a budget/vendor question and confirm it references actual booking costs when relevant.

### 2. Check Supabase Realtime configuration

Confirm Realtime publication includes:

- `wedding_journeys`
- `vendor_bookings`

If Realtime is not enabled for these tables, focus refresh still works, but partner/live updates will not arrive instantly.

### 3. Continue mobile launch readiness

Follow:

- `docs/MOBILE_APP_MASTERPLAN_2026-06-30.md`
- `docs/MOBILE_APP_STORE_RELEASE_CHECKLIST_2026-06-30.md`

Recommended next app work:

- finish authenticated mobile smoke testing
- check app store metadata/privacy requirements
- verify onboarding to Home to Amora to booking loop
- prepare EAS build profiles and TestFlight/internal test path if not already complete

### 4. Keep the booking/budget loop narrow

Avoid mixing the following into the next booking/budget fix:

- new community UI
- new vendor monetization behavior
- new payment flow
- new WeddingCode scoring
- broad design restyling

The current loop is already valuable because it turns real paid vendor outcomes into reusable couple memory.

## Quick Resume Commands

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
corepack pnpm install
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
```

If starting a new feature branch:

```bash
git switch -c codex/<short-task-name>
```

Use `codex/` as the default branch prefix.
