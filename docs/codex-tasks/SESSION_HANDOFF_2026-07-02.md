# Session Handoff - 2026-07-02

This handoff is for continuing Wedding Hanbang work from another computer without re-discovering the latest state.

## Current Git State

- Repository: `Kyu-Sung-Cho/wedding-hanbang-web`
- Continue from branch: `main` after PR #28 is merged.
- Latest product/code commit: `b9e09222` (`refactor: use shared mobile community library UI (#26)`)
- Handoff documentation PRs: #27 and #28.
- Open product/code PRs at handoff time: none.
- Latest confirmed main GitHub Actions run before the final metadata patch: success, run `28532477954`.
- Latest confirmed production smoke report before the final metadata patch: `.gstack/qa-reports/live-smoke/2026-07-01T16-34-16-796Z/report.md`.

## Resume Commands

Run these on the next computer:

```powershell
git fetch origin
git checkout main
git pull --ff-only origin main
corepack pnpm install
corepack pnpm qa:local
```

For mobile device QA:

```powershell
corepack pnpm --filter @hanbang/mobile dev
```

## What Shipped Since The Previous Mobile Handoff

### PR #21 - Stabilize Mobile Expo QA Flows

- Stabilized the mobile Expo QA path around community, schedule, chat, and app navigation.
- Improved mobile community list/detail behavior and local development reliability.
- Verified with local QA, CI, Vercel deployment, and live smoke checks.

### PR #22 - Align Expo SDK 54 Dependencies

- Aligned Expo SDK 54 package versions and Metro configuration.
- `expo-doctor` passed 18/18 checks after the dependency alignment.

### PR #23 - Patch Production Dependency Advisories

- Added root `pnpm.overrides` for production dependency advisories including `ws`, `undici`, `tar`, `dompurify`, `js-yaml`, and `@babel/core`.
- Refreshed the lockfile.
- `corepack pnpm audit --prod` reported no known vulnerabilities after the patch.

### PR #24 - Refresh Mobile Community Nicknames

- Fixed the mobile case where Settings name/community nickname changes could leave old names visible in community posts and comments.
- Settings save now clears relevant community caches after successful profile updates.
- Community feed and post detail reload on focus, so existing posts/comments display the latest author nickname after refresh.
- Key files:
  - `apps/mobile/src/lib/communityPostCache.ts`
  - `apps/mobile/app/settings/index.tsx`
  - `apps/mobile/app/(tabs)/community.tsx`
  - `apps/mobile/app/community/post/[id].tsx`

### PR #25 - Use Shared Mobile Community Detail UI

- Refactored community post detail to use shared mobile UI primitives.
- Replaced local loading/empty/header patterns with `AppHeader`, `LoadingState`, and `EmptyState`.
- Added clearer bookmark accessibility labeling.
- Key file: `apps/mobile/app/community/post/[id].tsx`

### PR #26 - Use Shared Mobile Community Library UI

- Refactored community "My Posts" and "Bookmarks" screens to use shared mobile UI primitives.
- Removed duplicate local header, loading, and empty-state styling.
- Key files:
  - `apps/mobile/app/community/my-posts.tsx`
  - `apps/mobile/app/community/my-bookmarks.tsx`

### PR #27 - Update Cross-Computer Handoff Documentation

- Added this July 2 handoff so another computer can resume from `main` with the current shipped work, validation status, blockers, and next priorities.
- Updated the mobile masterplan current implementation notes to match the latest shipped mobile state.
- Key files:
  - `docs/codex-tasks/SESSION_HANDOFF_2026-07-02.md`
  - `docs/MOBILE_APP_MASTERPLAN_2026-06-30.md`

### PR #28 - Finalize Handoff Status Metadata

- Clarified that `b9e09222` is the latest product/code commit and the handoff docs are finalized through PR #28.
- Avoided treating each docs-only merge commit as the product baseline.
- Kept the latest known main CI and live smoke references in this document.

### Mobile UI Kit Continuation - Remaining Community And Settings Screens

- Extended shared mobile UI adoption to the remaining high-value community/settings routes.
- Added `sideWidth` support to `AppHeader` so secondary screens can keep centered titles while using wider right-side actions.
- Replaced local header/loading/empty-state patterns with shared `AppHeader`, `LoadingState`, and `EmptyState`.
- Replaced primary local CTAs with `PrimaryButton` where it was safe to do so.
- Key files:
  - `apps/mobile/src/components/ui/AppUI.tsx`
  - `apps/mobile/app/community/post/write.tsx`
  - `apps/mobile/app/community/quick-review.tsx`
  - `apps/mobile/app/community/cohort-discovery.tsx`
  - `apps/mobile/app/community/cohort/[id].tsx`
  - `apps/mobile/app/community/guestbook/[slug].tsx`
  - `apps/mobile/app/settings/index.tsx`

## Verified Gates

- `corepack pnpm qa:local` passed after the latest mobile work:
  - web tests
  - web build
  - mobile lint
  - mobile typecheck
  - shared package typechecks
  - design token validation
- `corepack pnpm dlx expo-doctor` passed 18/18 after Expo dependency alignment.
- `corepack pnpm audit --prod` passed with no known production vulnerabilities after overrides.
- Main GitHub Actions passed through the latest product work and the first handoff documentation merge.
- PR #28 Quality Gate and Vercel Preview also passed before the final handoff merge.
- Vercel production deployment and live smoke were verified after the latest shipped mobile UI changes.
- For the mobile UI kit continuation, these local checks passed:
  - `corepack pnpm --filter @hanbang/mobile typecheck`
  - `corepack pnpm --filter @hanbang/mobile lint`
  - `corepack pnpm qa:local`

## Product And Code Decisions To Preserve

- Community nickname display should be driven by the current community profile, not copied permanently onto each post/comment.
- After changing the Settings name or community nickname, community feed/detail/comment views must refresh or invalidate cache so old content reflects the new nickname.
- Mobile shared UI adoption is the default for secondary screens:
  - `AppHeader`
  - `LoadingState`
  - `EmptyState`
  - `Surface`
  - `ActionRow`
  - `StatusPill`
  - `PrimaryButton`
- Server data stays in Supabase. Mobile cache is only for perceived speed, not source of truth.
- Vendor and AI features must keep the trust principles from `PRINCIPLES.md`: no hidden paid recommendation behavior, and all AI interactions/decision nodes must remain auditable.

## Remaining Work / Next Priority

1. Apply pending Supabase database changes with real credentials in the active shell:

```powershell
$env:SUPABASE_ACCESS_TOKEN = "<token>"
$env:SUPABASE_DB_PASSWORD = "<db-password>"
corepack pnpm supabase:ship:safe
corepack pnpm supabase:security:probe
```

2. Run real device Expo QA:
   - login
   - settings name/nickname save
   - community feed/detail/comment refresh
   - My Posts and Bookmarks
   - schedule checklist
   - chat scroll
   - booking and budget refresh paths

3. Continue deeper mobile UI kit adoption where it improves real workflows:
   - Convert settings account rows to `ActionRow` where labels and descriptions remain clear.
   - Review community compose/review forms for `Surface` and field rhythm consistency.
   - Add visual device QA screenshots for the newly standardized secondary screens.

4. Continue launch readiness:
   - EAS build audit
   - OAuth deep link QA
   - push notification QA
   - Sentry release tagging
   - TestFlight checklist
   - App Store / Play Store screenshots and privacy copy

## Known Blockers

- The current development shell does not have `SUPABASE_ACCESS_TOKEN` or `SUPABASE_DB_PASSWORD`, so `corepack pnpm supabase:ship:safe` cannot be completed from this session.
- The latest work was verified through automated local QA, GitHub Actions, Vercel deployment, and live web smoke. A real authenticated phone pass is still the next highest-value manual QA step.

## Quick Links

- Main branch: `main`
- Mobile masterplan: `docs/MOBILE_APP_MASTERPLAN_2026-06-30.md`
- Design source of truth: `DESIGN.md`
- Previous mobile QA handoff: `docs/codex-tasks/SESSION_HANDOFF_2026-07-01_MOBILE_EXPO_QA.md`
