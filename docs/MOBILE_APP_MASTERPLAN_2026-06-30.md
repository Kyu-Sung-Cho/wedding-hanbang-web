# Wedding Hanbang Mobile App Masterplan

> Date: 2026-06-30  
> Scope: Expo mobile app, shared Supabase backend, shared design system  
> North star: the app should tell a couple what to do next, help them decide together, and protect trust around money and vendors.

## 1. Product Thesis

Wedding Hanbang mobile is not a smaller web app. It is the couple's daily wedding operating room.

The app wins when a user opens it and immediately feels:

1. "I know what matters today."
2. "Amora remembers our situation."
3. "Our budget, schedule, vendor choices, and partner decisions are connected."
4. "Recommendations are not secretly bought."

This means mobile should prioritize action, memory, and trust over marketing density.

## 2. User Journey

### First 10 minutes

1. Sign in.
2. Complete onboarding.
3. Set role, couple mode, wedding date, rough budget, and preference signals.
4. Land on dashboard with D-day, current progress, and first recommended actions.
5. Ask Amora one practical question.

### Daily use

1. Open dashboard.
2. Check urgent tasks and partner activity.
3. Execute one task: update budget, add schedule, compare vendor, or ask Amora.
4. Important decisions are recorded as memory.

### High-trust moments

1. Budget overrun.
2. Vendor recommendation.
3. Contract or reservation.
4. Couple disagreement.
5. Price quote analysis.

These moments need explicit source, rationale, and separation between AI suggestion and verified fact.

## 3. Information Architecture

### Bottom tabs

1. **Home**: D-day, urgent tasks, progress, partner activity, shortcuts.
2. **Amora**: AI planner plus partner messaging.
3. **Community**: peer proof, cohort rooms, reviews, quote checks.
4. **My**: profile, wedding prep links, community stats, settings.

### Secondary routes

- `/onboarding`: role, couple link, wedding details, preferences.
- `/budget`: total budget, spending, payer split, hidden costs.
- `/schedule`: checklist, D-day timeline, events.
- `/vendors`: vendor discovery, qualification signals, favorites.
- `/vendors/[id]`: vendor detail, products, reservation.
- `/bookings`: reservation state and next action.
- `/market-prices`: sourced price intelligence.
- `/etiquette`: wedding etiquette and scripts.
- `/settings`: account, partner, notifications, deletion.

## 4. Screen Standards

### Home

The home screen is a command center, not a landing page.

Required order:

1. Greeting and operating context.
2. D-day and total progress in one premium command card.
3. Urgent tasks.
4. Partner activity.
5. Today's tasks.
6. Shortcuts.

Success metric: a user can decide the next action in under 5 seconds.

### Amora

Amora should feel capable, not cute.

Required:

1. Clear mode switch between AI and partner.
2. AI-generated state must be visually distinct.
3. Vendor recommendations must disclose whether facts are verified.
4. Any decision extracted from conversation writes to `decision_nodes`.
5. Any AI call writes to `ai_interactions_log`.

Success metric: the chat creates or updates real planning state, not just text.

### Budget

Budget must reduce surprise.

Required:

1. Total, spent, remaining.
2. Category budgets and actual spend.
3. Hidden cost warnings for categories known to create extra charges.
4. Payer split.
5. Link to market price source where relevant.

Success metric: a couple sees budget risk before signing or paying.

### Schedule

Schedule must turn a vague wedding timeline into weekly action.

Required:

1. Overall checklist progress.
2. Upcoming events.
3. D-day based category checklist.
4. Event CRUD.
5. Realtime sync with web and partner.

Success metric: users stop asking "what are we forgetting?"

### Vendors

Vendor discovery must protect trust.

Required:

1. Qualification signals before persuasion.
2. Category and search filters.
3. Favorites.
4. Price visibility when known.
5. AI recommendation separated from ad/sponsored status.

Success metric: recommendations remain defensible even if a vendor pays for ads.

### Community

Community is proof and context, not just a feed.

Required:

1. Cohort rooms by wedding timing.
2. Quote checks and cost sharing.
3. Rank/reputation system.
4. Ad disclosure.
5. AI summaries that cite the post context.

Success metric: community content improves a real couple decision.

## 5. Design System Application

Source of truth: `DESIGN.md`.

Mobile must use:

- Warm ivory background.
- White or noir surfaces.
- Rose only for attention and selected state.
- Noto Sans KR for app UI.
- Noto Serif KR only for emotional or editorial moments.
- Cormorant Garamond only for large numbers.

Implementation source:

- `apps/mobile/src/components/ui/AppUI.tsx`

Required component adoption:

1. `AppHeader` for secondary screens.
2. `LoadingState` for loading.
3. `EmptyState` for empty results.
4. `Surface` for app cards.
5. `ActionRow` for settings and menu rows.
6. `StatusPill` for state labels.
7. `PrimaryButton` for primary actions.

No new screen should hand-roll a header, empty state, or primary button.

## 6. Technical Architecture

### App stack

- Expo SDK 54.
- Expo Router.
- TypeScript strict.
- Supabase Auth, DB, Realtime, Storage.
- Shared design tokens from `@hanbang/design-tokens`.

### Data principles

1. Server data remains in Supabase.
2. Couple planning state lives in `wedding_journeys.progress` unless it has its own normalized table.
3. AI calls are audited through server routes.
4. Couple decisions are logged in `decision_nodes`.
5. Client writes use API routes when business rules or audit obligations exist.
6. Realtime is used for couple-visible planning changes.

### Mobile state principles

Use local component state for screen forms and UI state. Use persistent storage only for device-only preferences such as "guide seen". Do not duplicate Supabase truth in mobile storage except for auth session storage.

### Security and trust

1. Never log push tokens, invite codes, couple IDs, access tokens, or user IDs in client logs.
2. Vendor facts and paid placement must remain separate.
3. AI answers must not be the sole source of vendor qualification.
4. Account deletion and auth flows must be fail-safe and user-readable.

## 7. Build Roadmap

### Sprint 1: Foundation and first impression

Status: in progress.

- Create `DESIGN.md`.
- Create mobile UI Kit.
- Upgrade dashboard command card.
- Standardize tab bar, loading, error, and profile rows.
- Standardize secondary screen headers.

### Sprint 2: Core planning excellence

- Redesign onboarding around one decision per block.
- Redesign budget with budget risk and payer split first.
- Redesign schedule with weekly action and D-day urgency.
- Add skeleton states to dashboard, budget, schedule, vendors.
- Add screen-level QA checklist.

### Sprint 3: Trust-grade vendor flow

- Redesign vendor cards around qualification, price, and availability.
- Add vendor detail trust sections.
- Separate AI recommendation, verified facts, sponsored status.
- Add reservation next-action states.

### Sprint 4: Amora as operating layer

- Add structured assistant cards for decisions, budget updates, schedules, and vendor recommendations.
- Add conversation-to-memory confirmation UI.
- Add conflict/partner decision handoff.
- Make AI logs and decision logs test-covered.

### Sprint 5: Launch readiness

- EAS build setup audit.
- OAuth deep link QA.
- Push notification QA.
- Sentry release tagging.
- TestFlight checklist.
- Store screenshots and privacy copy.

## 8. Quality Gates

Before each app milestone:

- `pnpm --filter @hanbang/mobile lint`
- `pnpm --filter @hanbang/mobile typecheck`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`

Before TestFlight:

- EAS iOS build succeeds.
- EAS Android build succeeds.
- Login works for email, Kakao/Google/Apple where configured.
- Onboarding writes profile, couple, journey, preferences.
- Dashboard syncs after web changes.
- Budget and schedule updates appear on partner device.
- Vendor recommendation copy does not imply paid ranking.

## 9. Non-Negotiables

1. Trust beats revenue.
2. Memory beats one-off answers.
3. Depth beats feature count.
4. Vendor qualification beats vendor volume.
5. Claims need numbers and sources.
6. AI compliance is built in, not added later.

## 10. Current Implementation Notes

As of this plan:

- `DESIGN.md` exists.
- `AppUI.tsx` exists.
- Dashboard uses a command-card first impression.
- Chat empty state uses shared UI.
- Profile rows use shared UI.
- Budget, schedule, and vendors use shared app headers/loading.
- Mobile lint and typecheck pass.
