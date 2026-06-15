# 2026-06-15 Team Handoff: Amora, Booking, Supabase Security

## Current Status

Branch: `codex/harden-booking-amora-sync`

This branch is the next release candidate for:

- Amora action persistence and action status APIs.
- Booking creation syncing into wedding journey progress.
- Private chat image access through signed URLs.
- Community media URL validation and storage hardening.
- Supabase migration safety around RLS, storage, and couple linking.

The code now builds and passes the current automated checks. Do not merge or deploy this branch until the pending Supabase migrations are applied to production.

## What Was Cleaned Up Today

- Added `weddingLinkProps()` in `apps/web/src/lib/weddingPaths.ts` so visible `/wedding/...` URLs can use the correct internal Next.js route during prefetch/navigation.
- Updated key app links in the lounge, sidebar, weekly card, Amora director, budget CTA, chat etiquette cards, and schedule etiquette cards to use the safer link helper.
- Added Sentry ingest hosts to the production Content Security Policy so client-side Sentry events are no longer blocked by CSP.
- Updated the legacy mobile `ImagePickerButton` upload path from `uploads/...` to `{userId}/...`, matching the new `community-images` Storage RLS policy.
- Added `/wedding` cache revalidation after community post create/update/delete.
- Changed booking-created schedule event IDs to use the full booking UUID instead of the first 8 characters, reducing future collision risk while preserving existing events through `sourceKey`.

## Verification Completed

Commands run on 2026-06-15:

```powershell
pnpm typecheck
pnpm test
pnpm lint
pnpm build
pnpm audit --prod
pnpm supabase:security:probe
pnpm community:media:audit
```

Results:

- Typecheck: passed.
- Tests: passed, 13 files / 196 tests.
- Lint: passed with 69 warnings and 0 errors. Warnings are existing cleanup work, not release blockers.
- Build: passed.
- Production dependency audit: no known vulnerabilities.
- Anonymous Supabase security probe: passed, no sensitive rows visible.
- Community media audit: passed, 28 posts checked, 32 media fields checked, 0 issues.

## Required Before Merge Or Deploy

Run the safe Supabase migration flow:

```powershell
cd C:\Users\kcho1\Desktop\workspace\hanbang\wedding
pnpm supabase:ship:safe
```

Expected pending migrations for this branch:

- `20260615090000_harden_cohort_membership_writes.sql`
- `20260615091000_make_chat_images_private.sql`
- `20260615092000_harden_join_couple_atomic.sql`
- `20260615093000_harden_community_media_storage.sql`
- `20260615100000_create_amora_actions.sql`
- `20260615101000_fix_amora_action_status_timestamps.sql`

If the safe command shows additional migrations, stop and review the list before typing `APPLY`.

## Deployment Smoke Test

After migrations and deployment, check:

- `https://hanbang.ai/wedding` opens and the community feed renders.
- `https://hanbang.ai/wedding/lounge` redirects unauthenticated users to login.
- Demo login lands on `/wedding/lounge`.
- Lounge shows progress, upcoming schedule, saved posts, cohort panel, and Amora actions.
- Amora action done/dismiss works without API errors.
- Creating a booking updates journey progress/schedule once, without double-counting budget.
- Chat image uploads show through signed URLs.
- Community image post upload succeeds on web and mobile.
- Browser console no longer shows Sentry CSP errors.

## Known Follow-Up Work

- Finish a broader `/wedding` Link sweep in community and landing files if RSC prefetch 404 noise remains after deployment. The critical app shell and lounge links were cleaned up first.
- Clean existing lint warnings in a separate chore PR. They are noisy but not blocking this release.
- Consider retiring unused mobile components after confirming with the mobile owner. `ImagePickerButton` is currently not referenced, but was made safe instead of removed.

## Recommended Share Message

Team, this branch is ready for DB migration review and final release QA. The main blockers are operational, not code compilation: run `pnpm supabase:ship:safe`, confirm only the expected 2026-06-15 migrations are pending, apply them, then deploy and smoke-test `/wedding` plus `/wedding/lounge`.
