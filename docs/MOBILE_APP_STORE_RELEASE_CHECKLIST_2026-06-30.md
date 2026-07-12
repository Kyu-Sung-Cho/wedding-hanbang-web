# Mobile App Store Release Checklist

> Date: 2026-07-12
> Scope: `apps/mobile`, Expo SDK 54, EAS Build, App Store/TestFlight readiness  
> Status: **NO-GO for store submission** — static foundation passes, signed credentials/device OAuth/isolated backend validation remain

## 1. Current Repo Status

- Mobile app exists under `apps/mobile`.
- Expo app config exists at `apps/mobile/app.json`.
- iOS bundle identifier: `ai.hanbang.wedding`.
- Android package: `ai.hanbang.wedding`.
- App name: `웨딩한방`.
- Assets exist: icon, adaptive icon, splash, favicon.
- Apple Sign In plugin is enabled.
- Universal link domain is declared: `applinks:hanbang.ai`.
- AASA and Digital Asset Links routes exist and fail closed until signed-app identifiers are configured.
- Approved `/app/community/post/:id` and `/app/vendors/:id` share links are rewritten to matching Expo Router routes; unsupported `/app/*` paths are not claimed.
- EAS build profiles now exist at `apps/mobile/eas.json`.
- EAS project is linked: `@hanbang/wedding-hanbang`.
- EAS build profiles explicitly select their matching environments: `development`, `preview`, and `production`.
- EAS preview environment has the required public mobile runtime variables: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, and `EXPO_PUBLIC_SITE_URL`.
- Store-build helper scripts now exist in `apps/mobile/package.json`.

## 2. Validation Already Passing Locally

Run on the exact candidate SHA:

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm --filter @hanbang/web build
```

Current result:

- Typecheck: pass.
- Lint: pass.
- Web production build: pass.
- Mobile consumer contract: 12/12 pass.
- Expo export for web/iOS/Android: pass on 2026-07-12. This proves all three JavaScript bundles can be produced, not that native signing or physical-device behavior passed.
- Unused Paperlogy 100/200/800/900 weights were removed from the runtime bundle. Export size fell from 35,479,501 bytes to 30,044,582 bytes (about 15.3%) while the five referenced weights and all mobile tests remained green.

Before every mobile release candidate, also run:

```bash
corepack pnpm qa:local
corepack pnpm mobile:release-check
corepack pnpm mobile:store-release-check
corepack pnpm --filter @hanbang/mobile lint
corepack pnpm --filter @hanbang/mobile typecheck
corepack pnpm typecheck
corepack pnpm lint
```

`corepack pnpm qa:local` includes the static mobile foundation check, web tests/build, mobile lint/typecheck, shared packages, and design tokens. `mobile:release-check` currently passes with an explicit warning that social OAuth is hard-disabled. `mobile:store-release-check` intentionally fails until provider setup and physical-device login flows are implemented and verified; a green static check is not store readiness.

## 3. EAS Build Profiles

The mobile app now has three EAS profiles:

| Profile | Purpose | iOS | Android |
|---|---|---|---|
| `development` | Local/dev-client testing | Simulator build | APK |
| `preview` | Internal team testing before store submission | Device build | APK |
| `production` | App Store / Play Store release candidate | Device build with auto-increment | AAB |

Commands:

```bash
cd apps/mobile
corepack pnpm eas:build:ios
corepack pnpm eas:build:android
corepack pnpm eas:build:all
corepack pnpm eas:submit:ios
corepack pnpm eas:submit:android
```

Do not use the generic `corepack pnpm build` script for store release. It intentionally stays non-destructive so monorepo builds do not trigger cloud app-store builds by accident.

Before starting an EAS build, run:

```bash
corepack pnpm mobile:release-check
corepack pnpm mobile:store-release-check
```

The first check validates static configuration. The second is the actual store gate and remains red while social login is hard-disabled. The EAS project ID already exists; do not repeat `eas:init` unless project ownership or the link intentionally changes.

The same static check also runs inside `corepack pnpm qa:local`, so GitHub Actions blocks configuration regressions through the existing Quality Gate. CI does not replace the red device/store gate.

## 4. Account-Dependent Setup

These cannot be completed by code alone:

1. Expo account access for owner `hanbang`.
2. `eas whoami` currently confirms the `hanbang` account. Re-authenticate only if the release session expires.
3. Confirm the existing EAS link remains `@hanbang/wedding-hanbang`; do not reinitialize it during release.
4. Confirm `extra.eas.projectId` remains populated in `apps/mobile/app.json`. Completed for `@hanbang/wedding-hanbang`.
5. Apple Developer Program membership.
6. App Store Connect app record for bundle ID `ai.hanbang.wedding`.
7. App Store Connect API key or interactive Apple credentials for EAS Submit.
8. Google Play Console app record for package `ai.hanbang.wedding`.
9. Production signing credentials managed by EAS or uploaded manually.
10. Confirm the signed iOS `application-identifier` prefix and set `APPLE_TEAM_ID`; the documented `6RSK726532` remains a candidate until Apple account evidence confirms it.
11. Copy the **Google Play App Signing** SHA-256 certificate fingerprint, not the EAS upload certificate, into `PLAY_APP_SIGNING_SHA256`. During a key upgrade, keep only the approved current/replacement fingerprints.

## 5. App Store Connect Required Metadata

Prepare before submitting the first iOS build:

| Area | Required material |
|---|---|
| App information | Korean app name, subtitle, category, age rating |
| Privacy | Privacy policy URL, app privacy questionnaire, third-party SDK data practices |
| Support | Support URL, marketing URL if available |
| Review info | Contact name, phone, email, demo account if login is required |
| Screenshots | iPhone screenshots for required device sizes |
| Export compliance | Confirm encryption usage. Current config sets `ITSAppUsesNonExemptEncryption` to false. |
| Sign in | If third-party login exists, Apple Sign In must work correctly on iOS. |
| Data deletion | Account deletion flow must be accessible and user-readable. |

## 6. Trust And Compliance Checks

Before TestFlight:

- No push token, invite code, couple ID, user ID, or access token logs.
- AI-generated answers are visibly AI-generated where shown.
- AI calls route through audited server flow where applicable.
- Vendor recommendations do not imply paid ranking.
- Privacy policy describes Supabase, analytics, AI, push notifications, and user-generated content if used.
- App Store privacy answers match actual data collection across app and web.

### OpenAI Production Canary Gate

Do not invite external testers until all items pass with the actual production OpenAI project key:

- The project is entitled to the exact `gpt-5.6-luna` and `gpt-5.6-terra` model IDs.
- A normal consultation stays on Luna, while only the documented contract/dispute, safety, or recent repeated-correction cases escalate to Terra.
- SSE text streaming and the post-tool follow-up response complete without dropped text or duplicate user-turn charging.
- Image/PDF input, refusal handling, client abort, provider timeout, and user retry behavior are verified on device.
- Input/output token ceilings, per-couple turn quota, global provider-call cap, and project budget alerts fail closed at their configured limits.
- `store:false`, reasoning `none`, standard service tier, and zero SDK retries are confirmed in request telemetry without storing user content in logs.
- External-processing region, DPA, retention, cross-border transfer notice, and privacy-policy language are approved before real user content is sent.

## 7. Deep Link And OAuth Checks

Before TestFlight:

- `hanbang://` scheme opens the app.
- `https://hanbang.ai/app`, `/app/community/post/:id`, and `/app/vendors/:id` open the intended Expo route after install; unsupported `/app/*`, `/application`, and `/appetite` are not claimed.
- Without the app installed, the two approved share routes fall back to their corresponding `/wedding` web route. Unsupported `/app/*` falls back to `/wedding` instead of a 404.
- `/apple-app-site-association`, `/.well-known/apple-app-site-association`, and `/.well-known/assetlinks.json` return direct 200 JSON responses without redirects, including during maintenance.
- The AASA app ID matches the signed iOS entitlement, and Asset Links contains the Play App Signing fingerprint rather than the EAS upload key.
- Physical iOS and Android devices pass cold-start and already-running deep-link tests.
- Supabase OAuth redirect URLs include the app callback URL.
- Kakao, Google, and Apple login flows are tested on a physical iPhone.

Current result: the social entry points and OAuth implementation are intentionally hard-disabled. Therefore this section and `mobile:store-release-check` are red. Do not create or submit a store candidate until the selected providers, redirect allowlists, Apple Sign In entitlement, error recovery, and account-linking behavior pass on physical devices.

EAS evidence as of 2026-07-12: Android production AAB build 4 succeeded from old SHA `52faf4b4`; no iOS build is present. The Android artifact predates the current working tree and is not a release candidate.

## 8. Push Notification Checks

Before TestFlight:

- `extra.eas.projectId` exists after `eas:init`.
- Physical-device push token registration succeeds in an EAS build.
- Push token is saved without client-side logging.
- Notification permission denial is handled quietly.
- Android notification channel is present.

## 9. TestFlight Gate

Do not invite external testers until:

- EAS iOS production build succeeds.
- Login works on physical iPhone.
- Onboarding writes profile and journey data.
- Dashboard loads real user state.
- Budget and schedule screens load without fatal errors.
- Community post/detail routes open.
- Account deletion and logout work.
- Privacy policy URL is live.
- App Store privacy answers are drafted.

## 10. First Release Gate

Do not submit to App Review until:

- 20-person mobile smoke test is complete.
- No high-risk trust issue remains.
- Store screenshots match the current UI.
- Review demo account is prepared if login is required.
- Database migrations are applied to the target Supabase environment.
- The complete migration chain passes on both a fresh database and a production-shaped snapshot in staging before the target environment is changed.
- The target Supabase migration ledger and schema are remotely verified after deployment; local SQL files alone are not release evidence.
- Quote checks save privately by default, explicit publish exposes only the redacted projection, and owner revoke immediately makes the public URL return 404.
- WeddingCode `/response`, `/pair`, and `/couple-report` return HTTP 410 in the target environment, and the DB pairing/response fences are remotely verified.
- The OpenAI production canary and DPA/region/privacy gates above are complete.
- Sentry release/environment tags are verified.
- Support and privacy URLs are live.

## 11. Web Track

The web app is already buildable locally:

```bash
corepack pnpm --filter @hanbang/web build
```

Before web production deployment:

- Run `corepack pnpm typecheck`.
- Run `corepack pnpm lint`.
- Run `corepack pnpm --filter @hanbang/web build`.
- Run live QA against deployed URL.
- Confirm Supabase migrations are applied.
- Confirm `/wedding`, `/community`, login, quote-check, and vendor pages work.

## 12. Next Practical Sequence

1. Revoke the exposed Supabase CLI credential/PAT and complete the backend fence plus isolated restore drill.
2. Confirm signed Apple Team ID and Play App Signing SHA-256; deploy association endpoints and verify direct 200 responses.
3. Implement the approved social login set and make `corepack pnpm mobile:store-release-check` green on physical iPhone and Android devices.
4. Commit the exact candidate SHA and run the full local/CI gates.
5. Build new iOS and Android candidates from that exact SHA. The older Android AAB from `52faf4b4` is not evidence for the current tree.
6. Install through TestFlight/internal distribution and QA login, onboarding, dashboard, Amora, community, budget, schedule, vendors, links, notifications, deletion, and logout.
7. Prepare and approve store metadata, screenshots, privacy answers, review account, and rollout plan.
8. Submit to TestFlight/internal testing first, then public review only after the full gate passes.

## 13. Non-Negotiables

- Do not weaken privacy, RLS, or auth rules to pass review.
- Do not describe AI as a human planner.
- Do not imply vendor ranking is paid.
- Do not claim WeddingCode is validated until real validation exists.
- Do not ship App Store release before account deletion, privacy copy, and trust copy are verified.

## 14. Official References

- Apple App Store Connect: app privacy and privacy policy requirements.
- Apple App Store Connect: submitting an app version for review.
- Expo EAS Build: production builds for app stores.
- Expo EAS Submit: submitting iOS builds to App Store Connect.
