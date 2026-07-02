# Session Handoff - 2026-07-02

This handoff is for continuing Wedding Hanbang work from another computer without re-discovering the latest state.

## Current Git State

- Repository: `Kyu-Sung-Cho/wedding-hanbang-web`
- Continue from branch: `main`.
- Latest shipped product/code baseline before PR #36: `1e26dc85` (`chore: enforce mobile release check in local qa (#35)`).
- Handoff documentation PRs: #27, #28, and #32.
- Latest shipped product/code PRs: #29, #30, #31, #33, #34, and #35.
- Open product/code PRs at handoff time before PR #36: none.
- Latest confirmed main GitHub Actions run: success, run `28558404116`.
- Latest confirmed Vercel production deployment: success for commit `1e26dc85`, target `https://vercel.com/hanbang/wedding-hanbang-web/J2JTqrVpqjfjpJ8YduVForyzpbzD`.
- Latest confirmed production smoke report: `.gstack/qa-reports/live-smoke/2026-07-02T01-15-59-082Z/report.md`.

## Resume Commands

Run these on the next computer:

```powershell
git fetch origin
git checkout main
git pull --ff-only origin main
corepack pnpm install
corepack pnpm mobile:release-check
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

### Mobile Settings Polish And Real-Device QA Checklist

- Moved Settings cards onto shared `Surface` while preserving existing save, notification, partner, password, logout, and account deletion behavior.
- Converted Settings account/app-info rows to shared `ActionRow`.
- Converted Settings save and password-change CTAs to shared `PrimaryButton`.
- Expanded `docs/MOBILE_AUTHENTICATED_SMOKE_QA.md` with real-device coverage for settings identity, community nickname freshness, secondary screen UI consistency, and screenshot capture.
- Key files:
  - `apps/mobile/app/settings/index.tsx`
  - `docs/MOBILE_AUTHENTICATED_SMOKE_QA.md`
  - `docs/MOBILE_APP_MASTERPLAN_2026-06-30.md`

### PR #31 - Mobile/Web Design Parity Pass

- Aligned shared `@hanbang/design-tokens` with the live web app's Eucalyptus Ink, Dusty Mauve, Pearl Ivory, Sage, and Champagne Taupe palette.
- Kept legacy token keys such as `noir` and `rose` for code compatibility, but changed their values to the current web brand palette.
- Exposed `sage`, `stone`, and `surfaceLow` to mobile NativeWind for future app screens.
- Updated `AppUI` surfaces with web-like eucalyptus shadows and ivory borders.
- Updated mobile splash/adaptive icon/notification colors so system-level surfaces no longer use the legacy black/ivory palette.
- Recolored community character avatars and cohort member colors to stay inside the new brand palette while preserving bride/groom/neutral variations.
- Updated `DESIGN.md`, `docs/DEVELOPMENT_PLAN.md`, `docs/MOBILE_APP_MASTERPLAN_2026-06-30.md`, and `docs/MOBILE_AUTHENTICATED_SMOKE_QA.md` so future mobile work follows the web-aligned palette.
- Key files:
  - `packages/design-tokens/src/colors.ts`
  - `apps/mobile/src/components/ui/AppUI.tsx`
  - `apps/mobile/tailwind.config.js`
  - `apps/mobile/src/components/community/CommunityAvatar.tsx`
  - `apps/mobile/app/community/cohort/[id].tsx`
  - `apps/mobile/app.json`
  - `DESIGN.md`

### PR #33 - Mobile Callback Branding

- Aligned the mobile OAuth callback page with the web/mobile eucalyptus brand palette.
- Kept the `hanbang://auth/callback` bridge intact while removing legacy black/rose/ivory colors from the callback UI.
- Verified with local quality gates, Vercel deployment, and live smoke.

### PR #34 - Mobile Release Readiness Check

- Added `scripts/mobile-release-readiness.mjs` to validate mobile app-store configuration before EAS/TestFlight work.
- The check covers Expo app identity, bundle/package IDs, URL scheme, universal links, EAS profiles, Expo plugins, OAuth callback bridge, mobile env docs, and legacy brand-color drift.
- The check also blocks non-zero mobile `letterSpacing`, so Paperlogy typography stays consistent across app screens.
- Added `pnpm mobile:release-check` at the repo root and `pnpm release:check` inside `@hanbang/mobile`.
- Updated `docs/MOBILE_APP_STORE_RELEASE_CHECKLIST_2026-06-30.md` so release candidates run this check before EAS builds.
- The only expected warning is `extra.eas.projectId` until `eas:init` is run while logged into the hanbang Expo account.

### PR #35 - Mobile Release Check Quality-Gate Continuation

- `scripts/verify-local.mjs` now runs `pnpm mobile:release-check` as part of `pnpm qa:local`.
- Because GitHub Actions already runs `pnpm qa:local`, the CI Quality Gate now blocks mobile release configuration regressions without a separate workflow change.
- `docs/MOBILE_APP_MASTERPLAN_2026-06-30.md` and the mobile store checklist now document the release check as part of milestone validation.

### PR #36 - EAS Project Link And Android Preview Build

- Linked the mobile app to EAS project `@hanbang/wedding-hanbang`.
- Populated `apps/mobile/app.json` with EAS project ID `3a978bf3-21b8-4731-abc2-956dc8a27859`.
- Bound EAS build profiles to matching EAS environments:
  - `development` -> `development`
  - `preview` -> `preview`
  - `production` -> `production`
- Added release-check assertions for those EAS environment bindings.
- Created EAS preview environment variables for mobile runtime:
  - `EXPO_PUBLIC_SUPABASE_URL`
  - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
  - `EXPO_PUBLIC_SITE_URL`
- Created Android preview build:
  - Build page: `https://expo.dev/accounts/hanbang/projects/wedding-hanbang/builds/fc5acd3e-d68f-4c83-8e47-9cc14163cb2e`
  - APK artifact: `https://expo.dev/artifacts/eas/JRh16B31w4fEsYrshizsprvUK3fIbQCzOpWj7FikHQI.apk`
  - Build status: `FINISHED`
  - Build profile: `preview`
  - Expiration: `2026-07-16`

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
- For the settings polish and real-device QA checklist continuation, these local checks passed:
  - `git diff --check`
  - `corepack pnpm --filter @hanbang/mobile typecheck`
  - `corepack pnpm --filter @hanbang/mobile lint`
  - `corepack pnpm qa:local`
  - `corepack pnpm dlx expo-doctor`
  - `corepack pnpm audit --prod`
- For the mobile/web design-parity pass, these local checks passed:
  - legacy palette scan for mobile/docs/design-token files returned no matches
  - `git diff --check`
  - `corepack pnpm --filter @hanbang/design-tokens typecheck`
  - `corepack pnpm --filter @hanbang/mobile typecheck`
  - `corepack pnpm --filter @hanbang/mobile lint`
  - `corepack pnpm lint`
  - `corepack pnpm typecheck`
  - `corepack pnpm qa:local`
  - `corepack pnpm dlx expo-doctor` from `apps/mobile` passed 18/18
  - `corepack pnpm audit --prod`
- After PR #31 merged:
  - main GitHub Actions run `28556216594` passed
  - Vercel production deployment completed successfully
  - `corepack pnpm qa:live` passed 5/5, report `.gstack/qa-reports/live-smoke/2026-07-02T00-13-55-974Z/report.md`
- After PR #34 merged:
  - main GitHub Actions run `28557844008` passed
  - Vercel production deployment completed successfully
  - `corepack pnpm mobile:release-check` passed with 50 checks, 1 expected EAS project warning, and 0 failures
  - `corepack pnpm qa:live` passed 5/5, report `.gstack/qa-reports/live-smoke/2026-07-02T00-59-29-241Z/report.md`
- For the mobile release check quality-gate continuation:
  - `corepack pnpm mobile:release-check` passed with 50 checks, 1 expected EAS project warning, and 0 failures
  - `corepack pnpm qa:local` passed and confirmed the release check runs inside the local quality gate
- For the EAS preview build continuation:
  - `corepack pnpm mobile:release-check` passed with 54 checks, 0 warnings, and 0 failures
  - `corepack pnpm qa:local` passed and confirmed the release check runs inside the local quality gate
  - `corepack pnpm dlx expo-doctor` from `apps/mobile` passed 18/18
  - EAS Android preview build finished successfully
  - `corepack pnpm qa:live` passed 5/5, report `.gstack/qa-reports/live-smoke/2026-07-02T02-03-10-277Z/report.md`

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
- Mobile and web must share the same brand palette through `DESIGN.md`, web `globals.css`, and `@hanbang/design-tokens`.
- Keep `noir` and `rose` token names until a separate compatibility migration is planned; their values now represent Eucalyptus Ink and Dusty Mauve.
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

3. Run visual real-device QA and attach screenshots using `docs/MOBILE_AUTHENTICATED_SMOKE_QA.md`:
   - settings identity save
   - community nickname freshness
   - community compose/review forms
   - cohort discovery/chat
   - guestbook found/not-found states

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
