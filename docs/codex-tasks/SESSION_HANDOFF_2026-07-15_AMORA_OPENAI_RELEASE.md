# Amora OpenAI release handoff — 2026-07-15 KST

## Where to continue

- repository: `Kyu-Sung-Cho/wedding-hanbang`;
- branch: `feat/amora-openai-runtime-20260714`;
- upstream before this release commit: `1bb5a216`;
- archived PR #38 is evidence only, not a merge target;
- production Supabase ref: `slrtobkksjmxgzatjyqb`;
- isolated verification clone: `syhmfxauqyhgdcokrheg`;
- exact release procedure:
  `docs/operations/AMORA_PRODUCTION_RELEASE.md`.

On another computer, fetch the branch, install with the committed lockfile and
start by reading the release runbook plus
`docs/AMORA_OPENAI_MIGRATION_PLAN_2026-07-14.md`. Do not copy `.env` files,
backup artifacts or keys through Git.

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

- web: 85 test files / 577 tests;
- mobile tests, all package type checks and lint;
- Next production build (100 routes);
- Expo iOS/Android/Web export;
- production dependency audit: no known vulnerability at the configured level;
- mobile release readiness: 55 passed, 0 warnings, 0 failures;
- local live smoke: wedding home, market prices, auth redirect, demo lounge and
  390 px Amora panel; browser console had no errors;
- fresh HBAM2 production capture/verify: 11 tables / 2,893 rows, external private
  receipt retained locally, no plaintext application artifact;
- latest provider backup visible with Restore and provider clone completed;
- all expand/contract migrations plus hosted Auth/RLS/RPC/concurrency tests pass
  on the clone;
- production remote fence: exactly 15 pending files in `before-reconcile` mode.
- hash-pinned historical-effect audit passed in read-only transactions on both
  the isolated clone and production; the nine ledger versions are not yet
  marked applied.

The DPAPI backup is intentionally tied to the Windows user profile that created
it and is not portable through Git. A new operator/computer must take its own
fresh clean-tree backup before production writes.

## Deliberately not done

- no production database migration or ledger write;
- no production/preview Storage policy mutation;
- no production OpenAI activation or real-key smoke;
- no Vercel production deployment;
- no EAS native cloud build;
- no PR merge;
- no database password reset;
- no WeddingCode collection re-enable or claim of psychometric validity.

## Hard gates and decisions

1. Production has two pending/unpaid bookings for the same couple/vendor/slot.
   The later candidate was cancelled only in the isolated clone. A business
   owner must approve cancelling the later production row before the unique
   index migration can apply.
2. Creating/removing hosted Storage policies changes cloud access permissions.
   Obtain action-time confirmation for preview expand, and a separate action-
   time confirmation for production expand/contract.
3. Real OpenAI smoke needs a controlled non-production key. Production has a
   key configured, but pulled values are redacted and the enable flag is absent.
4. Web server Sentry and mobile Sentry/PostHog destinations are not configured.
5. OpenAI DPA/region/retention/ZDR/support-channel decisions are human legal and
   operational gates.
6. WeddingCode needs at least five cognitive interviews, a 20-person mini test,
   expert review and later statistical validation plus consent/retention policy.

## Immediate continuation checklist

```powershell
git fetch --all --prune
git status --short --branch
git log --oneline --decorate -8
pnpm install --frozen-lockfile
pnpm supabase:release:fence
node scripts/supabase-release-fence.mjs --remote --expect=before-reconcile
```

Then review/stage the exact release diff, push the immutable candidate and open
a new PR. After green CI, follow the production runbook in strict order. Never
skip from a green local build directly to OpenAI enablement.
