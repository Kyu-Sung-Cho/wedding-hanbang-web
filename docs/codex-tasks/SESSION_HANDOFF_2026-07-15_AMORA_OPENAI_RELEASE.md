# Amora OpenAI release handoff — 2026-07-15 KST

> **SUPERSEDED HISTORICAL HANDOFF — DO NOT CONTINUE FROM THIS FILE.** The clone
> `syhmfxauqyhgdcokrheg` no longer exists and must never be reused. Continue from
> `docs/operations/CURRENT_WORKSPACE_HANDOFF_2026-07-17.md` and the current
> remote HEAD of PR #61.

## Where to continue

- repository: `Kyu-Sung-Cho/wedding-hanbang-web`;
- verified runtime baseline: `bd879a74668d24695b101307224f4d44b08abc7a`;
- current production recovery baseline: `202ca8ec7e7058a79a7167008bda32464dd47605`;
- Amora release merge: PR #43 / `56b7fee1ad3688cc44370dd9c45244c6da461c42`;
- native-build repair merge: PR #47 / `77288c6ab739a6e88975dee490ee9842b727a209`;
- PR #48 (`/sai`) followed immediately and is included in the verified main
  commit above;
- archived PR #38 is evidence only, not a merge target;
- draft PR #46 is a large conflicted checkpoint from another computer. Its own
  body says not to merge or deploy it; reconcile small domains selectively from
  a fresh main branch instead of cherry-picking it wholesale;
- production Supabase ref: `slrtobkksjmxgzatjyqb`;
- isolated verification clone: `syhmfxauqyhgdcokrheg`;
- exact release procedure:
  `docs/operations/AMORA_PRODUCTION_RELEASE.md`.

On another computer, fetch `main`, install with the committed lockfile and start
by reading this handoff, the release runbook, the web/Android release receipt,
and
`docs/AMORA_OPENAI_MIGRATION_PLAN_2026-07-14.md`. Do not copy `.env` files,
backup artifacts or keys through Git.

## Later production addendum: per-couple quota unlocked

On 2026-07-15 KST, normal users could still receive the exact message that all
beta free consultations had been used. This was not an account-specific
allowlist problem:

- the only code-level exemption was `profiles.is_admin = true`;
- Vercel Production had `AMORA_FREE_MESSAGES_PER_COUPLE=30`;
- `amora_turn_counters` had been seeded from historical chat turns, and the
  largest aggregate couple counter was 705, so existing users were already over
  the new cap;
- the KST global count at diagnosis time was 3, below the retained daily cap of
  300.

The immediate non-destructive production mitigation raised the per-couple cap
to `1000000` and redeployed source commit `6dd55ee1` as Vercel deployment
`6pZCEBoWaBri7g3AFqJMGaTtsnRt`. No counter rows were reset or deleted.

The durable fix in the commit containing this addendum adds a separate
`AMORA_COUPLE_QUOTA_ENABLED` switch. Production now has this variable set to
`false`; the next deployment of this code therefore disables the per-couple
branch for every ordinary account while still using the atomic reservation RPC
and retaining `AMORA_COST_GUARD_ENABLED=true` plus the global daily cap. It also
clears stale client-side `quotaRemaining=0` state at the start of all three AI
request paths, so an old exhausted banner cannot remain after the server limit
is lifted.

Rollback is configuration-only: set `AMORA_COUPLE_QUOTA_ENABLED=true` (or
remove it), choose a reviewed positive `AMORA_FREE_MESSAGES_PER_COUPLE`, and
redeploy. Do not disable the whole cost guard unless responding to a separately
approved incident, because that would also remove the global cost ceiling.

## Production OpenAI activation and chat recovery

On 2026-07-15 KST, a real account received the generic message that AI response
generation had failed. Vercel Runtime Logs identified the server-side cause at
17:16:15 KST: `POST /api/chat` returned an SSE response while the route logged
`[ai-config] OpenAI is not enabled`. The Production environment already had an
OpenAI API key, but `AMORA_OPENAI_ENABLED` was absent.

The non-secret Production switch was added as sensitive configuration with the
value `true`, then production was redeployed. While verifying the fix, the
signed no-login demo exposed a second consumer-facing regression: `/api/chat`
required a Supabase user before parsing the signed demo session and also
rejected the canonical `demo-couple` identifier as a non-UUID. PR #53 fixes the
authorization order and demo identifier mapping while preserving all cost
controls. Signed demo requests use an isolated actor and a synthetic UUID only
for read-only context/cost-guard calls; demo requests cannot select a real
couple and perform no durable chat, profile, summary, audit or feedback writes.
Unsigned requests still return 401, and authenticated-user authorization is
unchanged.

Release receipt:

- PR #53: `fix(web): restore signed Amora demo chat`;
- merge commit: `202ca8ec7e7058a79a7167008bda32464dd47605`;
- GitHub PR quality gate: run `29401924691`, success;
- post-merge GitHub quality gate: run `29402656001`, success;
- Vercel Production deployment: `CBwxpo8dUwBsgggZR5NN6QBoFgyA`, Ready,
  Current, source `202ca8ec`, domain `hanbang.ai`;
- live provider canary at 18:00 KST: signed demo question received a real Amora
  answer; matching Vercel log was `POST 200 hanbang.ai /api/chat` at
  18:00:34 KST with no error message;
- post-deploy live smoke: 5/5 routes passed, including demo login/lounge and
  the mobile Amora panel;
- homepage canary: HTTP 200, no browser console errors, real content present,
  total load 2,878 ms.

Provider rollback is configuration-only: set `AMORA_OPENAI_ENABLED=false` (or
remove it) and redeploy. This intentionally returns Amora to fail-closed mode.
If the signed-demo authorization change itself must be rolled back, revert PR
#53 through a new reviewed PR; do not reset or force-push `main`.

## What is implemented

- Amora main/auxiliary runtime uses the OpenAI Responses API only;
- allowlisted models are GPT-5.6 Luna and Terra, with conservative routing,
  output/tool-round/cost caps, `store:false`, stable pseudonymous safety IDs and
  a fail-closed kill switch;
- Anthropic wrappers and dependency are removed—there is no fallback;
- canonical server history, partner-private exclusion, durable request binding,
  exact mutation idempotency/uncertain ledgers and atomic cost reservations;
- attachment signed-URL authorization and uploader-bound object layout;
- atomic couple reset, account deletion cascade/anonymization, canonical booking
  pricing and duplicate active-slot protection;
- mobile auth/notification hardening, touch/accessibility fixes and least-
  privilege photo selection (no camera/microphone/storage permission request);
- WeddingCode is intentionally contained: noindex UI notice, 410 APIs and a DB
  write fence. Candidate questions remain unvalidated and must not be enabled.

## Evidence already passed

- web after PR #53: 87 test files / 587 tests;
- mobile tests, all package type checks and lint;
- Next production build (100 routes);
- Expo iOS/Android/Web export;
- production dependency audit: no known vulnerability at the configured level;
- mobile release readiness: 70 passed, 0 warnings, 0 failures; Expo Doctor:
  18/18;
- local live smoke: wedding home, market prices, auth redirect, demo lounge and
  390 px Amora panel; browser console had no errors;
- fresh HBAM2 production capture/verify: 11 tables / 2,893 rows, external private
  receipt retained locally, no plaintext application artifact;
- latest provider backup visible with Restore and provider clone completed;
- all expand/contract migrations plus hosted Auth/RLS/RPC/concurrency tests pass
  on the clone;
- production migration fence: zero pending after the audited nine-version
  reconciliation and seven expand migrations;
- hash-pinned historical-effect audit passed in read-only transactions on both
  the isolated clone and production; the nine ledger versions are not yet
  marked applied.
- isolated-clone hosted Storage final contract passed: strict immutable upload,
  signed read and all partner/traversal/direct-read/overwrite denials; synthetic
  accounts and object were cleaned up.
- the later 70-second duplicate pending/unpaid booking was conditionally changed
  to `cancelled`; a fresh postcondition found zero active duplicate groups;
- production anonymous access exposed no rows across all 10 sensitive tables;
- the production hosted integration discovered an old Auth trigger failure caused
  by an unqualified `profiles` reference under the Auth search path. Postgres
  logs proved the root cause. Migration `20260714164800` was applied to the
  clone first, then production; hosted signup, deletion/anonymization, couple
  reset/retention and request/tool/cost concurrency all passed, and zero
  synthetic users remained;
- production `chat-image` was already private and now has the strict immutable
  uploader INSERT policy. Five legacy policies remain for the mixed-client
  window until post-deploy contract;
- PR #43 and the EAS follow-up PRs #44, #45 and #47 were merged. Runtime-baseline
  GitHub CI run `29387007474` passed, including the local quality gate and
  Supabase release-manifest fence;
- historical Vercel deployment `5V5iydv5vij5ceK9YwJetbhX5B2d` served the
  earlier main while OpenAI was still fail-closed. Two mobile-width canary
  passes across six routes produced zero console errors; all three WeddingCode
  APIs remained 410. The later activation receipt is recorded above;
- Android EAS production build
  `e6cc6b8f-a377-4aba-8e83-5a9c509cd229` finished from the exact runtime baseline with
  `versionCode 2`. The 65,249,946-byte AAB passed ZIP structure checks and has
  SHA-256 `FF3D924578C2FB94BA090042CAA30C4F60E1C504522F3082CB0018687DF84687`.

The detailed immutable receipts and the earlier failed-build root causes are in
`docs/evidence/AMORA_WEB_ANDROID_RELEASE_2026-07-15.md`.

The DPAPI backup is intentionally tied to the Windows user profile that created
it and is not portable through Git. A new operator/computer must take its own
fresh clean-tree backup before production writes.

## Still deliberately not done

- no EAS iOS cloud build yet. Apple signing credentials still require the
  account holder's interactive Apple login and two-factor authentication;
- no independent replay of the HBAM2 logical artifact into a blank isolated
  target; provider physical restore and hosted clone validation are separate
  evidence;
- no DB contract-phase ACL/policy removal and no removal of the five production
  legacy Storage policies before compatible web/minimum-mobile canary;
- no database password reset;
- no WeddingCode collection re-enable or claim of psychometric validity.

## Hard gates and decisions

1. Production OpenAI activation and a signed-demo real-provider canary are
   complete. Never copy the Production key into Git, logs, screenshots or a
   handoff; future operators should verify only presence and runtime behavior.
2. Web server Sentry and mobile Sentry/PostHog destinations are not configured.
3. OpenAI DPA/region/retention/ZDR/support-channel decisions are human legal and
   operational gates.
4. WeddingCode needs at least five cognitive interviews, a 20-person mini test,
   expert review and later statistical validation plus consent/retention policy.
5. The two DB contract files and removal of five legacy Storage policies must
   wait for compatible web and minimum-mobile canary; the expand state is safe
   for mixed clients and must not be mistaken for the final contract.
6. iOS production signing requires the Apple account holder to finish the
   interactive EAS credential flow before the build can be submitted.

## Immediate continuation checklist

```powershell
git fetch --all --prune
git status --short --branch
git log --oneline --decorate -8
pnpm install --frozen-lockfile
pnpm supabase:release:fence
node scripts/supabase-release-fence.mjs --remote --expect=clean
```

Continue from current `main`, not PR #38 or PR #46. Confirm that PR #53 and its
documentation follow-up are present, then finish Apple credential setup and the
traceable iOS production build. Production OpenAI is enabled and its signed-demo
provider canary passed; use a separate controlled non-production key for future
destructive, load or failure-injection tests. Observability and legal decisions
remain open. Never treat the successful provider canary as approval for
DB/Storage contract removal.
