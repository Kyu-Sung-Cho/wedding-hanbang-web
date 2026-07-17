# Mobile App Store Release Checklist

> Date: 2026-06-30, status updated 2026-07-17
> Scope: `apps/mobile`, Expo SDK 54, EAS Build, App Store/TestFlight readiness  
> Status: the current Engine V2 candidate has no signed Android/iOS build and no
> physical-device receipt. Older Android AAB evidence below is historical only.

## 1. Current Repo Status

- Mobile app exists under `apps/mobile`.
- Expo app config exists at `apps/mobile/app.json`.
- iOS bundle identifier: `ai.hanbang.wedding`.
- Android package: `ai.hanbang.wedding`.
- App name: `웨딩한방`.
- Assets exist: icon, adaptive icon, splash, favicon.
- Apple Sign In plugin is enabled.
- Universal link domain is declared: `applinks:hanbang.ai`.
- EAS build profiles now exist at `apps/mobile/eas.json`.
- EAS project is linked: `@hanbang/wedding-hanbang`.
- EAS build profiles explicitly select their matching environments: `development`, `preview`, and `production`.
- Every EAS profile pins Node `22.13.0`, installs pnpm `11.7.0` exactly once,
  and uses the same-named EAS Update channel.
- EAS CLI and every store-build helper script are pinned to exact version `21.0.2`.
- EAS requires a clean Git commit, and production build helpers run
  non-interactively with signing credentials frozen. Configure credentials in a
  separate reviewed step; a build must not create or rotate them implicitly.
- EAS uses remote build versions with production auto-increment. The 2026-07-17
  remote baseline is Android `4` and iOS `1`; the next builds are expected to be
  `5` and `2`. Stale local `versionCode` and `buildNumber` fields are forbidden.
  The in-app profile reads `expo-application` native versions instead of stale
  Expo config fields.
- EAS Production has `EXPO_PUBLIC_SUPABASE_URL`,
  `EXPO_PUBLIC_SUPABASE_ANON_KEY`, and `EXPO_PUBLIC_SITE_URL`.
- `EXPO_PUBLIC_SENTRY_DSN` is still absent in EAS Production. Add a reviewed
  mobile Sentry DSN before the signed production build; never store its value in Git.
- Store-build helper scripts exist in `apps/mobile/package.json`.

## 2. Validation Already Passing Locally

Run on this machine after pulling the 2026-06-30 update:

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hanbang/web build
```

Historical 2026-07-15 baseline result (not the current candidate):

- Typecheck: pass.
- Lint: pass.
- Web production build: pass.
- Mobile release readiness: 70/70 pass, no warnings or failures.
- Expo Doctor: 18/18 pass.
- Android production EAS build from the verified runtime baseline: pass. Build
  `e6cc6b8f-a377-4aba-8e83-5a9c509cd229`, `versionCode 2`.

Current Engine V2 candidate local result on 2026-07-17:

- Mobile tests: 69/69 pass.
- Mobile typecheck and lint: pass.
- Mobile release readiness: 86/86 pass.
- Expo Web/iOS/Android export: pass.
- Signed Android build, signed iOS build and physical-device verification:
  `NOT RUN`. A local export is not a native-build receipt.

Before every mobile release candidate, also run:

```bash
pnpm qa:local
pnpm mobile:release-check
pnpm --filter @hanbang/mobile lint
pnpm --filter @hanbang/mobile typecheck
pnpm typecheck
pnpm lint
```

`pnpm qa:local` includes the mobile release readiness check, web tests, web production build, mobile lint/typecheck, shared package typechecks, and design-token typechecks. Keep the standalone `pnpm mobile:release-check` command available when you want a fast app-store configuration check without the full local gate.

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
pnpm eas:init
pnpm eas:build:ios
pnpm eas:build:android
pnpm eas:build:all
pnpm eas:submit:ios
pnpm eas:submit:android
```

Do not use the generic `pnpm build` script for store release. It intentionally stays non-destructive so monorepo builds do not trigger cloud app-store builds by accident.

Before starting an EAS build, run:

```bash
pnpm mobile:release-check
```

This check validates the static mobile release configuration: app identifiers, URL schemes, EAS profiles, Expo plugins, OAuth callback bridge, mobile env example, and legacy brand-color drift. Account-dependent setup such as `extra.eas.projectId` is reported as a warning until `eas:init` is completed.

The same check also runs inside `pnpm qa:local`, so GitHub Actions blocks release configuration regressions through the existing Quality Gate.

## 4. Account-Dependent Setup

These cannot be completed by code alone:

1. Expo account access for owner `hanbang`. Completed.
2. `eas login`. Completed.
3. `pnpm --filter @hanbang/mobile eas:init`. Completed.
4. Confirm `extra.eas.projectId` is populated in `apps/mobile/app.json` after EAS init. Completed for `@hanbang/wedding-hanbang`.
5. Apple Developer Program membership.
6. App Store Connect app record for bundle ID `ai.hanbang.wedding`.
7. App Store Connect API key or interactive Apple credentials for EAS Submit.
8. Google Play Console app record for package `ai.hanbang.wedding`.
9. Android production signing credentials managed by EAS. Completed. iOS
   distribution credentials remain pending interactive Apple setup.

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

## 7. Deep Link And OAuth Checks

Before TestFlight:

- `hanbang://` scheme opens the app.
- Universal links for `https://hanbang.ai/app/*` open the app after install.
- `apple-app-site-association` is configured on `hanbang.ai` if universal links are used.
- Supabase OAuth redirect URLs include the app callback URL.
- Mobile OAuth uses PKCE and the callback transports only a one-time `code`; access and refresh tokens never appear in an HTTPS URL, custom-scheme URL, fragment, log, or screenshot.
- A negative test app that registers the same custom scheme cannot redeem an intercepted code without the initiating device's verifier.
- Kakao, Google, and Apple login flows are tested on a physical iPhone.

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
- Sentry release/environment tags are verified.
- Support and privacy URLs are live.

## 11. Web Track

The web app is already buildable locally:

```bash
pnpm --filter @hanbang/web build
```

Before web production deployment:

- Run `pnpm typecheck`.
- Run `pnpm lint`.
- Run `pnpm --filter @hanbang/web build`.
- Run live QA against deployed URL.
- Confirm Supabase migrations are applied.
- Confirm `/wedding`, `/community`, login, quote-check, and vendor pages work.

## 12. Next Practical Sequence

1. Finish interactive Apple distribution credential setup.
2. Build the iOS production candidate from clean, up-to-date `main`.
3. Install it on a physical iPhone through TestFlight or internal distribution.
4. QA login, onboarding, dashboard, Amora, community, budget, schedule, vendors, notifications.
5. Prepare App Store Connect metadata and privacy answers.
6. Create/verify the Google Play Console app record before Android submission.
7. Submit to internal testing/TestFlight first, not public store review.

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
