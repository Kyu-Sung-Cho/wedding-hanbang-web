# Amora web and Android release evidence — 2026-07-15 KST

> **SUPERSEDED HISTORICAL RECEIPT — not a current mobile release gate.** The
> Android AAB below belongs only to commit `bd879a74668d24695b101307224f4d44b08abc7a`.
> Signed Android/iOS EAS builds and real-device accessibility/Storage QA from
> the final Engine V2 commit are `NOT RUN` and must not reuse this receipt.

This receipt records only non-sensitive deployment and build evidence. It does
not contain environment values, signing material, backup payloads, customer
identifiers or provider prompts.

## Immutable release identity

- Amora release merge: PR #43, merge `56b7fee1`.
- EAS toolchain repair: PR #47, head `2825ed55`, merge `77288c6a`.
- A separate, already-reviewed `/sai` route PR #48 followed immediately.
- Exact verified runtime baseline and pre-receipt Vercel production source:
  `bd879a74668d24695b101307224f4d44b08abc7a`.
- Runtime-baseline GitHub CI run `29387007474`: success. The local quality gate and
  Supabase release-manifest fence both passed.

## Vercel production and canary

- Deployment: `5V5iydv5vij5ceK9YwJetbhX5B2d`, status ready.
- `AMORA_OPENAI_ENABLED` remained absent/false. No real-provider canary was
  authorized or implied by this deploy.
- Two 390×844 browser passes covered `/`, market prices, lounge-to-login,
  `/login`, `/sai` and `/wedding-code`.
- All pages returned the expected result with zero browser-console errors.
- `/sai` returned the route-specific CSP and rendered the proxied landing.
- `/wedding-code` rendered the contained validation-preparation screen and its
  HTML included `noindex, nofollow`.
- The response, pair and couple-report WeddingCode APIs each returned 410.
- No page failure or persistent >2× regression was observed. The first home
  pass was 2,579 ms and the second 1,947 ms; every other second-pass load was
  109 ms or lower.

Screenshots and the machine-readable report are kept in the local ignored
`.gstack/canary-reports/` directory.

## Android production build

Final runtime-baseline build:

- EAS build ID: `e6cc6b8f-a377-4aba-8e83-5a9c509cd229`;
- platform/profile/channel: Android / production / production;
- Git commit: `bd879a74668d24695b101307224f4d44b08abc7a`;
- app version/build: `1.0.0` / `versionCode 2`;
- result: finished;
- downloaded AAB size: 65,249,946 bytes;
- SHA-256:
  `FF3D924578C2FB94BA090042CAA30C4F60E1C504522F3082CB0018687DF84687`;
- archive validation: 1,401 entries with `BundleConfig.pb`, base manifest,
  base DEX and signing metadata all present.

The prior PR-head candidate build
`f755517c-3e8e-4348-b15e-8ce520678dc1` also finished and proved the same mobile
tree before merge. Its downloaded AAB was 65,249,945 bytes with SHA-256
`905B376AEC1C04795459AA3460FFB89CFE336E8393769CC5FD41891B9B4FD37A`.

## Failed-attempt ledger and fixes

These attempts were not reported as successful builds:

1. `fae65ac0-cc18-4143-b0f9-45f400612875`: Node 20 could not run root pnpm
   11.7. Fixed by pinning EAS Node 22.13.0.
2. `cf963e5f-3942-4d0c-b427-3053c83c3c30`: Corepack and explicit pnpm both
   installed a global binary, producing `EEXIST`.
3. `abb146c5-9e5c-4f7e-b7eb-94c06b14c4be`: Corepack still collided with the
   EAS default pnpm installer.
4. `dec90944-57c3-4a72-9866-96d0054cd629`: the single-installer fix reached
   prebuild and exposed missing `react-native-worklets` plus missing update
   channels; it was cancelled after discovery.
5. `bf06a256-ac0d-4fa3-99a4-e233cf22910c`: prebuild and eager Metro succeeded,
   but Gradle found an undeclared direct `metro-cache` import. The override was
   removed in favor of Expo's declared default cache.

The release readiness script now asserts the Node/pnpm/channel/worklets setup
and rejects a direct `metro-cache` import. Local mobile typecheck, lint, release
readiness 70/70 and Expo Doctor 18/18 passed before the successful builds.

## Gates still open

- iOS production signing/build: interactive Apple account login and two-factor
  authentication are still required from the account holder.
- Real OpenAI provider smoke and production enablement: still fail-closed until
  controlled non-production smoke, observability and legal/retention decisions
  pass.
- Independent HBAM2 logical replay into a blank isolated target: not replaced by
  provider physical-restore evidence.
- DB/Storage contract phase: must wait for a compatible minimum-mobile rollout
  and the required final attachment/canary evidence.
- WeddingCode validation and collection: remain disabled and write-fenced.
