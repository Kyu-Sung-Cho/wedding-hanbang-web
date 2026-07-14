# Mobile Authenticated Smoke QA

> Purpose: verify the trust loop that cannot be proven by static tests alone: booking state, budget memory, Amora context, community identity, and mobile freshness for a real signed-in user.

## Scope

Run this before App Store/TestFlight work and after any change touching:

- mobile Home, Bookings, Budget, Schedule, or Amora
- mobile Settings, Community, cohort rooms, guestbook, or community write/review flows
- `vendor_bookings`
- `wedding_journeys.progress`
- `profiles.name`
- `community_profiles.nickname`
- booking outcome routes; general booking cancellation remains a blocked release gate
- Supabase Realtime publication or RLS around shared couple data

## Preflight

From the repo root:

```bash
git fetch origin
git status -sb
corepack pnpm qa:local
corepack pnpm qa:live -- \
  --base-url=https://hanbang.ai \
  --launch-mode=full \
  --research-intake=<closed-or-open> \
  --account-deletion-cron=<closed-or-open> \
  --couple-court-private=<closed-or-open> \
  --couple-court-ai=<closed-or-open> \
  --couple-court-public=<closed-or-open> \
  --expected-sha=<40-character-release-sha> \
  --expected-supabase-project-ref=<20-character-production-ref> \
  --apple-team-id=<signed-10-character-team-id> \
  --play-signing-sha256=<play-app-signing-sha256>
```

원격 smoke는 위 identity와 기능 상태를 모두 고정하지 않으면 의도적으로 실패한다. 이 검사는 공개
배포 경계의 자동 preflight이며, 아래의 로그인 사용자·커플·물리 기기 시나리오를 대신하지 않는다.

Confirm Supabase Realtime publication includes both shared planning tables only through the exact-target, read-only production preflight approved by [the remote operations policy](./SUPABASE_REMOTE_OPERATIONS.md). Do **not** run an ad-hoc `db query --linked`: the current write-fence query and migration/recovery connection are not yet bound to one immutable project/database/role, and the previously exposed CLI login role/PAT must be rotated first. Until those gates pass, record this check as `blocked / not run` rather than querying production manually. The approved preflight must return only the allowlisted table names or booleans and must not print query text, credentials, provider bodies, or unrelated catalog data.

Expected rows:

- `public.vendor_bookings`
- `public.wedding_journeys`

## Test Accounts

Use two internal QA accounts in the same couple:

| Role | Account | Notes |
| --- | --- | --- |
| User A |  | creates/updates booking |
| User B |  | observes partner freshness |

Do not use fake public community content to simulate real users. These accounts are for private QA only.

## Device Matrix

Minimum:

| Platform | Device | Build | Result |
| --- | --- | --- | --- |
| iOS | physical device or simulator | Expo dev/client |  |
| Android | physical device or emulator | Expo dev/client |  |

For App Store readiness, repeat on TestFlight/internal build after EAS is configured.

For visual QA, capture screenshots for:

- Settings default state
- Settings save success state
- Community post write
- Quick review
- Cohort discovery
- Cohort chat empty/loading state
- Guestbook found and not-found states

Compare those screenshots against the live web app's service/community pages and confirm:

- Eucalyptus ink is the dominant high-trust color, not legacy black/navy.
- Dusty mauve appears only as an attention or selected-state accent.
- Pearl ivory backgrounds, ivory borders, and quiet eucalyptus shadows match the web app's production tone.
- Paperlogy typography stays neutral and readable; no screen reintroduces non-zero tracking/letter spacing.

## Scenario 1: Login And Home Context

1. Sign in as User A.
2. Complete onboarding if needed.
3. Open Home.
4. Confirm D-day/progress card renders.
5. Confirm booking outcome nudges appear only when relevant.
6. Sign in as User B on another device/session.
7. Confirm User B sees the same couple context.

Pass:

- no auth loop
- no blank Home
- no stale or contradictory couple context

## Scenario 2: Booking Outcome Updates Budget

1. As User A, open Bookings.
2. Create or locate a past/completed booking with a vendor category.
3. Open the booking outcome sheet.
4. Save actual amount and rating.
5. Open Budget.
6. Confirm the matching category `spent` includes the actual amount.
7. Return to Home.
8. Confirm completed booking no longer asks for missing actual cost.
9. Ask Amora a budget/vendor question.
10. Confirm Amora can reference actual/contracted booking cost context when relevant.

Pass:

- booking status becomes `completed`
- actual amount persists after refresh
- budget category spent changes once, not double-counted
- Amora context is consistent with the saved amount

## Release Gate 3: Booking Cancellation Reverts Planning Memory — Blocked

> [!WARNING]
> **Not executable in the current product.** There is no general user-facing booking cancellation UI/API, and Amora's `cancel_booking` tool is disabled. Keep the steps below as future acceptance criteria; do not mark this gate passed or simulate it with direct database edits.

Acceptance criteria after a trusted cancellation route is implemented:

1. As User A, cancel a booking that has contributed to schedule/budget progress.
2. Open Budget.
3. Confirm the stored actual contribution is subtracted.
4. Open Schedule/Home if applicable.
5. Confirm cancelled booking does not remain as an active task.
6. Refresh the app and repeat the check.

Pass:

- cancelled booking does not remain in active upcoming tasks
- category spend is not negative
- legacy short booking event keys do not leave duplicate schedule memory

## Scenario 4: Partner Freshness

1. Keep User B on Budget.
2. As User A, save a booking outcome.
3. Confirm User B Budget updates through Realtime or focus refresh.
4. Keep User B on Bookings with a detail sheet open.
5. As User A, update the booking.
6. Confirm User B list and open detail sheet refresh safely.
7. After the blocked cancellation gate is implemented, repeat with cancellation and confirm the row closes or refreshes safely.

Pass:

- no manual pull-to-refresh required after returning to the screen
- open detail sheet does not display stale amounts/status
- no crash when a partner updates the open booking
- future cancellation path: no stale detail or crash after a partner cancels

## Scenario 5: Community And Lounge Sanity

1. Open Community feed.
2. Open a listed public post.
3. Confirm detail page does not show not-found.
4. Filter by a visible category.
5. Confirm count/list/category are consistent.
6. Open Lounge.
7. Confirm unauthenticated users are redirected and authenticated users can enter their cohort/lounge state.

Pass:

- public feed links open readable detail pages
- category filters do not contradict all-feed visibility
- Lounge auth behavior is deterministic

## Scenario 6: Settings Name And Community Identity

1. Sign in as User A.
2. Open Settings.
3. Change only the profile name.
4. Save and confirm the success state appears without dimming or layout shift.
5. Open Community feed and a post/comment written by User A.
6. Confirm the displayed community name updates after focus refresh.
7. Return to Settings.
8. Change only the community nickname.
9. Save and confirm the nickname is rejected if it duplicates or violates nickname policy.
10. Post or comment with an allowed nickname.
11. Confirm old and new posts/comments display the current nickname consistently.

Pass:

- settings save does not silently drop either profile name or community nickname
- old community content refreshes to the latest display nickname
- duplicate or inappropriate nickname attempts show a user-readable error
- no stale author name remains after navigating feed -> detail -> comments

## Scenario 7: Secondary Screen UI Consistency

1. Open Community post write.
2. Confirm the header title stays centered and the publish action fits on iOS and Android widths.
3. Toggle write/preview and confirm no vertical jump or clipped text.
4. Open Quick Review and confirm the submit button, chips, and star row fit without overlap.
5. Open Cohort Discovery and switch monthly/region/budget tabs.
6. Confirm loading/empty/coming-soon states use the same spacing, icon scale, and typography.
7. Open Cohort Chat.
8. Confirm the member-count badge fits in the header and empty chat state is readable.
9. Open Guestbook with a valid slug and an invalid slug.
10. Confirm found, loading, empty, and not-found states are polished and not visually divergent.

Pass:

- secondary screens use the shared `AppHeader`, `LoadingState`, `EmptyState`, and primary CTA rhythm
- shared UI surfaces use the web-aligned Eucalyptus Ink / Dusty Mauve / Pearl Ivory palette from `@hanbang/design-tokens`
- no header button text clips on 360px wide Android
- no nested-card visual clutter appears in Settings
- no controls overlap with keyboard-visible forms

## Failure Triggers

Stop and fix before App Store/TestFlight work if any occur:

- booking actual amount is double-counted
- cancellation leaves stale active schedule/budget memory
- partner screen stays stale after focus refresh
- Realtime publication is missing `vendor_bookings` or `wedding_journeys`
- public community feed opens to not-found detail
- Amora references an amount that no longer matches booking/budget state
- account deletion, auth callback, or logout loops
- settings name save leaves community content on the old nickname
- duplicate or inappropriate community nickname is accepted
- secondary screens have clipped header actions, blank loading states, or unreadable empty states
- mobile screenshots drift back to the legacy black/rose palette instead of matching the web eucalyptus palette

## Report Template

```md
## Mobile Authenticated Smoke QA

- Date:
- Branch/commit:
- Web URL:
- Mobile build:
- Tester:
- Accounts:

### Automated preflight
- qa:local:
- qa:live:
- Realtime publication:

### Scenarios
- Login/Home:
- Booking outcome -> Budget:
- Booking cancellation: Blocked / not implemented / not run
- Partner freshness:
- Community/Lounge:
- Settings identity:
- Secondary UI consistency:

### Bugs found
1.

### Verdict
Pass / Pass with fixes / Fail
```
