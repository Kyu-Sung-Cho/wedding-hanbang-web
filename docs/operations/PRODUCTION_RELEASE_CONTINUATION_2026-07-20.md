# Production release continuation — 2026-07-20

> **Historical checkpoint, superseded.** This file records the earlier SHA-specific
> release attempt below. The current cross-computer authority is
> `CURRENT_WORKSPACE_HANDOFF_2026-07-20.md` plus
> `VENDOR_DISCLOSURE_FULL_SOURCE_AUDIT_2026-07-20.md`; use the remote HEAD of PR
> #64, not the SHAs in this snapshot.

This historical checkpoint records external evidence as well as code state. It is
not an approval to merge, deploy to the public domain, write production data, or
publish vendor records. A later 2026-07-20 read-only recheck found the production DB
still at migration head `20260715210000` with 47 local migrations pending. Vercel
`env pull` returns `[SENSITIVE]` markers, so it cannot revalidate secret values;
the server-side OpenAI PASS below applies only to the named unpromoted deployment.

## GitHub state

- Vendor-disclosure PR: `#64`, Draft. The last functional code commit covered by
  this note is `172b88d49c14a55fa31e86ae026c9f7e4724a085`.
- Amora-only PR: `#61`, Draft. The last functional code commit covered by this
  note is `52ff692bfca77975aeca95a94781d7aaee304d40`.
- Both functional commits were pushed to their normal remote branches. Historical
  local-only snapshots were also preserved under the `archive/local-*-20260720`
  remote refs.
- Keep both PRs Draft until their independent hosted, restore, mobile and release
  evidence is complete. A successful Preview deployment is not production evidence.

## Vercel Production environment and build evidence

Project: `hanbang/wedding-hanbang-web`
(`prj_LyKeU6DJGaIa4iJLqgn6rS3Qehes`).

The following non-secret contract values were explicitly rewritten through the
authenticated Vercel CLI so spelling and casing do not depend on the dashboard:

- Amora enabled, primary `gpt-5.6-terra`, fast `gpt-5.6-luna`, reasoning `none`.
- Couple quota disabled; cost guard enabled; free-message fallback `100`; global
  daily message cap `300`; global daily cost cap `$20`.
- Auxiliary memory fan-out, proactive outbound care, community AI comments,
  destructive AI-log retention, account-deletion intake and worker remain off for
  the expand deployment.
- Profile memory is `conservative`.
- The Supabase runtime destination is pinned to production project
  `slrtobkksjmxgzatjyqb`, including its canonical URL and project-scoped runtime
  write confirmation.
- `PRODUCTION_WRITE_FENCE_ENABLED=true`.

No secret value was printed or committed. Vercel does not decrypt `Sensitive`
values through `env pull`; therefore the authoritative check is the server-side
Production builder.

A Production-target deployment with domain promotion explicitly skipped was run
from clean Amora-only commit `f6254069`. Deployment
`dpl_Z2wTGzmkQaBVbyECXaCKjrCGCvnT` did not receive `hanbang.ai` traffic and failed
closed before Next.js compilation. The server-side environment checker passed
every OpenAI, model, cost, quota, feature-off, write-fence, Supabase destination,
cron and rate-limit condition except one:

- `adminBootstrapSecretConfigured=false`: the existing `ADMIN_PASSWORD` is not a
  plausible unique secret of at least 32 characters. The owner must rotate it to
  a password-manager-generated value that is not sent through chat.

The current public Production deployment remains the older deployment
`dpl_A7DFYqGQtobLcmqFJNF1PZdd1FzM`, created before these environment updates.
Do not claim that the new OpenAI configuration or write fence is live until an
exact new deployment is built and promoted.

## EAS mobile evidence

- Authenticated Expo account: `hanbang`.
- Before this work, iOS had zero EAS build records. A frozen-credential,
  non-interactive iOS Production attempt stopped before upload because Apple
  distribution credentials are not set up. It created no build artifact. Remote
  build number advanced from `1` to `2`.
- Android Production build `040d5696-530a-4f1b-a252-86a5d380471a` ran from exact
  commit `a34f1c014628f8390792fd5ba02ae104043b3514`, advanced version code to `5`,
  and failed before producing an AAB. The failing Gradle task could not start
  `@sentry/cli/bin/sentry-cli`.
- Root cause: pnpm kept the Sentry CLI only as a transitive package, while the
  Sentry Gradle integration resolves it as a direct mobile package. Commits
  `172b88d4` (PR #64) and `52ff692b` (PR #61) add exact direct dependency
  `@sentry/cli@2.55.0` and a release-readiness regression assertion. The package
  now resolves from the generated Android directory; mobile tests and typecheck
  pass.
- Do not spend another EAS build until a dedicated mobile Sentry project exists
  and EAS Production contains `EXPO_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`,
  `SENTRY_PROJECT`, and sensitive `SENTRY_AUTH_TOKEN`. At this checkpoint EAS
  Production contains only the site URL and the two public Supabase variables.
- Do not disable Sentry uploads or set an allow-failure bypass merely to obtain a
  green artifact. iOS additionally requires the owner-assisted Apple credential
  setup.

## Database, catalog and paid extraction state

- No production database write, migration, Storage policy change, signup change,
  backup, restore, merge, public-domain deployment or canary occurred in this
  continuation.
- Production still lacks the vendor disclosure tables/view. PR #64's hosted
  evidence and production-readiness jobs therefore remain intentionally blocked.
- The accessible Supabase projects are `SuccessHB` (`bdfbhvjhgwleplanhodi`),
  production `wedding_hanbang` (`slrtobkksjmxgzatjyqb`) and `Sai`
  (`nezijcdwjwaopszboaak`). None is documented or authorized as disposable.
- A new disposable different-project Supabase target, or explicit owner
  confirmation that one existing non-production project may be destroyed, is
  required before hosted migration and backup/restore rehearsal.
- Actual OpenAI vendor extraction calls remain `0`; the fixed-eight extraction and
  25-unit batches remain unrun. Raw source data and intermediate state stay ignored
  and must not be committed.

## Resume order

1. Rotate `ADMIN_PASSWORD` to a unique 32+ character value in Vercel Production.
2. Create/configure the dedicated mobile Sentry project and the four EAS Production
   variables; complete Apple credential setup interactively.
3. Re-run the exact current-SHA server-side Production build with domain promotion
   skipped and both EAS signed builds. Preserve receipts without signed URLs.
4. Obtain an explicitly disposable Supabase target and complete hosted preflight,
   the write-fence sequence, encrypted 14-table backup/restore, 27 migrations, and
   post-expand backup/restore in the documented order.
5. Only after every commit-bound gate passes: merge, promote the write-fenced web
   deployment, run canaries/finalizer, lift fences through an exact redeploy, and
   observe the post-lift canary window.

Current verdict: **NO-GO / NOT DEPLOYED**. The failures above are useful safety
evidence, not completed release evidence.
