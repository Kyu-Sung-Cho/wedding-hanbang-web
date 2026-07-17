# Production write fence and two-phase Amora release

Status: **implemented and locally tested; production execution NOT RUN**.

This runbook is the fail-closed release path for `amora-engine-v2-20260716`.
It does not authorize a production change by itself. The final release commit,
manifest hashes, CI, hosted upload probe, mobile build, and operator receipts
must all be green before the first production mutation.

## Why the order is strict

Supabase signed upload URLs remain usable without an RLS check at upload time
for up to two hours after issue. Removing `storage.objects` mutation policies
therefore does not immediately stop every already-issued upload. The safe order
is:

1. close web writes and signup;
2. install the public-database write fence and remove all Storage mutation
   policies;
3. wait 120 minutes plus a 10-minute safety margin;
4. prove the complete Storage object inventory is unchanged across another
   five-minute window;
5. only then capture and logically replay the pre-expand backup and complete a different-project hosted restore;
6. push the exact migrations;
7. install the final Storage contract while the database fence still keeps its
   write predicate false;
8. capture and immediately verify the exact 27-table post-expand backup, then
   prove its restore on a different Supabase project;
9. deploy and canary under the fences;
10. run the hash-pinned exact-owner finalizer, then reopen web and
   signup last.

Skipping or reordering any step is a release stop, not an operator warning.

## Evidence that must exist before production

- A clean, immutable release commit on the exact remote release branch.
- A manifest that pins every migration, check, platform operation, safe
  rollback, and required document by SHA-256.
- A successful authenticated upload contract probe on a disposable hosted
  project. It must prove the intended user's positive upload and another user's
  negative upload. A local emulator result is insufficient. The final SELECT
  companion-policy choice must be based on this receipt.
- A completed provider physical backup no older than 26 hours. The composite
  evidence collector reads `GET /v1/projects/{ref}/database/backups` and binds
  the latest `COMPLETED` physical restore candidate. This is the disaster-
  recovery coverage for Auth, Storage metadata, and relations outside the
  14-table HBAM2 allowlist.
- A fresh 14-table HBAM2 logical backup captured after signed-upload drain,
  with its PGlite logical row replay green. The receipt must also bind the two
  excluded ephemeral relations and their exact rebuild/drop contract.
- A fresh hosted restore receipt for the same backup set on a different
  disposable Supabase project. It must bind source and target refs, the release
  commit, backup-set and manifest hashes, schema and data digests, restore job,
  ordered timestamps, and all required Auth, Storage, typed-schema, constraint,
  trigger, RLS, and RPC/ACL checks. A local PGlite replay is insufficient.
- The provider physical backup, HBAM2 receipt, and hosted restore receipt are
  complementary; none replaces another.
- No active `cron.job` execution. The public-database fence apply and rollback
  scripts both refuse to proceed while a cron job is active.
- The reviewed forward-only AI-log ACL operation is the exact 14:10
  inventory/apply/verify set. The superseded 10:30 files are forbidden. This
  operation has no privilege-restoring rollback; any correction is another
  reviewed forward fix.
- After the expand ledger reaches exactly `20260716090000` through
  `20260716117000`, a separate encrypted HBAM2 backup must contain the exact 27
  manifest-pinned tables. Its verifier receipt and different-project hosted
  restore receipt are finalizer inputs; the pre-expand 14-table backup cannot
  substitute for them.

If migration 1090 still performs a top-level `vendor_reviews` update, the
provider physical backup gate is mandatory. Prefer converting 1090 to a pure
expand migration before freezing the manifest.

## Phase 0: prepare private paths

Receipts contain no secrets but are operationally sensitive. Keep them outside
Git on a local private path. Never paste an access token into a command, log,
document, or receipt.

```powershell
$commit = '<exact-lowercase-40-character-release-sha>'
$branch = 'origin/<exact-release-branch>'
$site = 'https://<production-host>'
$receipts = '<absolute-private-receipt-directory>'
$backupReceipt = Join-Path $receipts 'backup-verification-receipt.json'
$outcomeReceipt = Join-Path $receipts 'production-release-outcome.json'
$postExpandBackupReceipt = Join-Path $receipts 'amora-engine-v2-20260716-post-expand-backup-verification.json'
$postExpandHostedRestoreReceipt = Join-Path $receipts 'amora-engine-v2-20260716-post-expand-hosted-restore-evidence.json'
$deploymentReceipt = Join-Path $receipts 'production-deployment.json'
$canaryReceipt = Join-Path $receipts 'production-write-fenced-canary.json'
$finalizerReceipt = Join-Path $receipts 'production-write-fence-finalization.json'
$deploymentRaw = Join-Path $receipts 'production-deployment.vercel.raw.json'
$hostedProjectRaw = Join-Path $receipts 'post-expand-hosted-project.supabase.raw.json'
$hostedDatabaseRaw = Join-Path $receipts 'post-expand-hosted-database.safe-digests.raw.json'
$canaryRaw = Join-Path $receipts 'production-write-fenced-canary.raw.json'
$vercelServerErrorsRaw = Join-Path $receipts 'production-write-fenced-canary.vercel-errors.raw.json'
$backupSourceRepo = '<absolute-clean-pre-expand-checkout>'
```

Set `SUPABASE_ACCESS_TOKEN` only in the current process environment. The token
needs read access to Auth config, database backups, and the read-only database
query endpoint.

The five `*Raw` files are mandatory first-party provenance, not optional debug
logs. The collector writes them as private, exclusive sibling files outside
Git and binds their raw bytes to the receipts by SHA-256. Do not copy a raw file
from an older attempt, edit it, move it into Git, or substitute a caller-entered
boolean. The finalizer reopens and verifies all five raw files before it runs
any command or database query.

## Phase 1: acquire every write fence

1. Set Production `PRODUCTION_WRITE_FENCE_ENABLED=true` in Vercel and deploy the
   exact release commit. Confirm the deployed no-op probe returns HTTP 503,
   `Cache-Control: no-store`, and the exact commit header.
2. Disable new signup in Supabase Auth. Do not disable existing-user login.
3. Apply and verify:
   - `supabase/platform-operations/security/20260717120000_production_write_fence_apply.sql`
   - `supabase/platform-operations/security/20260717120000_production_write_fence_verify.sql`
4. In the hosted Storage policy owner context, apply and verify:
   - `supabase/platform-operations/storage/20260716108000_storage_global_write_freeze_apply.sql`
   - `supabase/platform-operations/storage/20260716108000_storage_global_write_freeze_verify.sql`
5. Run only the manifest-pinned forward-only ACL set in order:
   - `supabase/platform-operations/security/20260717141000_ai_log_retention_exact_acl_inventory.sql`
   - `supabase/platform-operations/security/20260717141000_ai_log_retention_exact_acl_apply.sql`
   - `supabase/platform-operations/security/20260717141000_ai_log_retention_exact_acl_verify.sql`

The inventory and verify steps are read-only. The apply step is one explicit
transaction and converges to the exact ACL. Never select any 10:30 ACL file and
never attempt to restore the former broader privileges as a rollback.

The Storage freeze must leave zero INSERT, UPDATE, DELETE, or ALL policies. A
partial operation converges with
`20260716108000_storage_global_write_freeze_rollback.sql`, which deliberately
keeps writes frozen and never restores the legacy broad policies.

Immediately after the exact Storage freeze verification, create the immutable
database-clock start receipt:

```powershell
node scripts/capture-storage-signed-upload-drain-evidence.mjs `
  --stage=start `
  --expected-commit=$commit `
  --receipt-directory=$receipts `
  --site-url=$site
```

Do not create the first snapshot until the database clock is at least 130
minutes past the start receipt:

```powershell
node scripts/capture-storage-signed-upload-drain-evidence.mjs `
  --stage=first `
  --expected-commit=$commit `
  --receipt-directory=$receipts
```

Wait at least five additional minutes, then capture the final snapshot:

```powershell
node scripts/capture-storage-signed-upload-drain-evidence.mjs `
  --stage=final `
  --expected-commit=$commit `
  --receipt-directory=$receipts
```

The final stage fails if the full `storage.objects` row inventory hash or count
changed, if a mutation policy exists, or if either wait was short. Never edit a
receipt timestamp or inventory value to make this pass; restart the drain from
`start` with a new reviewed release receipt set.

## Phase 2: backup after the drain

Capture the current 14-table HBAM2 backup from the clean pre-expand checkout,
then run its verifier and PGlite logical row replay. Follow
`PRE_AMORA_CURRENT_PRODUCTION_BASELINE_BACKUP.md`. Its `SourceCapturedAt` must
be later than the second stable Storage snapshot and `CreatedAtUtc` must be
later than `SourceCapturedAt`; the controller enforces both comparisons.

Complete the separate hosted restore and place its immutable receipt beside the
other private release receipts. The controller rejects a missing, stale,
same-project, backup-mismatched, or semantically incomplete hosted receipt
before any migration push.

Create the composite pre-push receipt only after the backup is green:

```powershell
node scripts/capture-production-write-fence-evidence.mjs `
  --expected-commit=$commit `
  --backup-receipt=$backupReceipt `
  --receipt-out=(Join-Path $receipts 'amora-engine-v2-20260716-production-write-fence.json') `
  --site-url=$site
```

This read-only capture binds all of the following to the release commit and
backup set: Vercel fence, deployed commit, Auth signup closure, provider
physical backup candidate, every pre-backup platform operation, and the raw
SHA-256 of the three-stage Storage drain proof.

## Phase 3: exact database push

First run check-only. Then use `--apply`; never call a raw production
`supabase db push`, `--include-all`, migration repair, or reset.

```powershell
node scripts/supabase-production-release.mjs `
  --check-only `
  --expected-commit=$commit `
  --remote-ref=$branch `
  --backup-receipt=$backupReceipt `
  --backup-source-repo=$backupSourceRepo `
  --confirm-production="CHECK:slrtobkksjmxgzatjyqb:amora-engine-v2-20260716:$commit"

node scripts/supabase-production-release.mjs `
  --apply `
  --expected-commit=$commit `
  --remote-ref=$branch `
  --backup-receipt=$backupReceipt `
  --backup-source-repo=$backupSourceRepo `
  --receipt-out=$outcomeReceipt `
  --confirm-production="APPLY:slrtobkksjmxgzatjyqb:amora-engine-v2-20260716:$commit"
```

Before dry-run or push, the controller claims the singleton row in
`public.production_release_lease_20260717` with a random exact owner UUID. A
foreign owner blocks the attempt across computers. An ambiguous claim retains
the local owner record for read-only adjudication and is never auto-released.

The expected successful first-phase status is
`awaiting_manual_post_push_operations`. It is not a completed release. The
local and remote locks must remain present and a second `--apply` is forbidden.

## Phase 4: final Storage contract and resume

In the hosted Storage policy owner context, apply the manifest-pinned final
Storage operation and its read-only verification. The final INSERT policy must
call `public.production_storage_writes_allowed()`. While the temporary database
fence artifacts exist, that helper must return false, so the new policy is
installed but cannot yet accept writes.

Capture fresh post-push platform evidence. This rechecks the Vercel and Auth
fences, binds the awaiting outcome, and records the exact final Storage
operation:

```powershell
node scripts/capture-post-push-platform-evidence.mjs `
  --expected-commit=$commit `
  --backup-receipt=$backupReceipt `
  --awaiting-outcome=$outcomeReceipt `
  --receipt-out=(Join-Path $receipts 'amora-engine-v2-20260716-post-push-platform.json') `
  --confirm-operations=community-upload-storage-finalize-20260716108000 `
  --site-url=$site

node scripts/supabase-production-release.mjs `
  --resume-post-push `
  --expected-commit=$commit `
  --remote-ref=$branch `
  --backup-receipt=$backupReceipt `
  --backup-source-repo=$backupSourceRepo `
  --receipt-out=$outcomeReceipt `
  --confirm-production="RESUME:slrtobkksjmxgzatjyqb:amora-engine-v2-20260716:$commit"
```

Resume never pushes migrations again. It re-verifies the immutable pre-push
backup and receipt chain, the exact remote ledger, fresh web/Auth fences, and
live post-push/post-apply DB and Storage counts. The backup may be older than
30 minutes during resume because the global fences remain continuously active;
the new post-push evidence must still be no older than 30 minutes.

The successful resume status is `database_expand_verified_lease_held` in phase
`deployment-canary`. It deliberately retains the exact remote lease and local
lock through deployment and canary. It is not a completed production release.

The local `.resume` lease records the exact remote owner UUID, outcome-path
hash, release commit, and process ID. A live competing resume blocks. If a
process crashes and leaves this file, never auto-delete it: confirm the process
is gone, compare every field with the retained lock/outcome, verify the remote
lease read-only, and record a two-person adjudication before removing only that
stale local `.resume` file.

If a process dies after atomically moving the remote lease to
`deployment-canary` but before replacing the local awaiting receipt, resume may
recover only when that remote row still matches the exact owner, release,
commit, and outcome-path hash. It reruns every read-only ledger, fence,
post-push, and post-apply check before writing the final local receipt. A
different owner or phase remains a hard stop.

## Phase 5: exact post-expand backup and different-project restore

Do not deploy or canary merely because resume reports
`database_expand_verified_lease_held`. Keep web, Auth, database, and Storage
writes closed. From the exact release checkout, capture the post-expand HBAM2
set and immediately run the pinned verifier with a 30-minute capture-time age
limit:

```powershell
$capture = corepack pnpm --silent amora:db:backup `
  -ExpectedProjectRef slrtobkksjmxgzatjyqb | ConvertFrom-Json

$verifyJson = corepack pnpm --silent amora:db:verify-backup `
  -BackupDirectory $capture.BackupDirectory `
  -ExpectedProjectRef slrtobkksjmxgzatjyqb `
  -ExpectedBackupSetId $capture.BackupSetId `
  -ExpectedManifestSha256 $capture.ManifestSha256 `
  -MaximumAgeMinutes 30

[IO.File]::WriteAllText(
  $postExpandBackupReceipt,
  $verifyJson,
  [Text.UTF8Encoding]::new($false)
)
```

The receipt must have the exact verifier key set, `Verified=true`, table count
27, release commit and pinned CLI/runtime provenance, source-digest and PGlite
JSONB verification true, and `PlaintextWrittenToDisk=false`. Its referenced
backup directory must contain only the five HBAM2 encrypted-set artifacts. The
unencrypted manifest must bind the source project, commit, exact table names,
backup set, and manifest hash.

Restore that exact set to a different 20-character Supabase project ref. The
hosted evidence receipt must bind the same backup set, manifest, schema digest,
and data digest; exact ordered target table and migration arrays; the pinned
table and ledger contract digests; provider restore job; ordered timestamps;
and all 14 required checks. In addition to the standard Auth, Storage, typed
schema, constraint, trigger, RLS, and RPC/ACL checks, both
`exactReleaseMigrationLedgerVerified` and `exactTableAllowlistVerified` must be
true. A same-project receipt or a local-only PGlite replay is rejected.

No disposable target currently exists for this release. Create a new project
only for this drill, with a name matching
`wedding-hanbang-restore-drill-YYYYMMDD[-nonce]`, and restore the exact backup
set into it before collecting evidence. Never use production
`slrtobkksjmxgzatjyqb`, SuccessHB, production, Sai, or the stale/nonexistent
`syhmfxauqyhgdcokrheg` project as the target. Record the real 20-character
target ref, provider restore job ID, and canonical provider completion time;
do not invent any of them.

Keep both credentials out of command history. The target URL must be the direct
TLS endpoint `db.<target-ref>.supabase.co:5432/postgres`, never a pooler. Then
run the collector from the exact release checkout:

```powershell
$targetProjectRef = '<new-20-character-disposable-project-ref>'
$targetProjectName = 'wedding-hanbang-restore-drill-20260717-<lowercase-nonce>'
$providerRestoreJobId = '<real-provider-restore-job-id>'
$restoreCompletedAt = '<provider-completion-time-as-YYYY-MM-DDTHH:mm:ss.fffZ>'
$psql = (Get-Command psql.exe -ErrorAction Stop).Source

$env:SUPABASE_ACCESS_TOKEN = [Net.NetworkCredential]::new(
  '', (Read-Host 'Supabase access token' -AsSecureString)
).Password
$env:HANBANG_HOSTED_RESTORE_DATABASE_URL = [Net.NetworkCredential]::new(
  '', (Read-Host 'Disposable direct PostgreSQL URL' -AsSecureString)
).Password

node scripts/collect-production-external-gate-evidence.mjs `
  --mode=hosted-restore `
  --expected-commit=$commit `
  --backup-receipt=$postExpandBackupReceipt `
  --target-project-ref=$targetProjectRef `
  --target-project-name=$targetProjectName `
  --provider-restore-job-id=$providerRestoreJobId `
  --restore-completed-at=$restoreCompletedAt `
  --psql=$psql `
  --project-raw-out=$hostedProjectRaw `
  --database-raw-out=$hostedDatabaseRaw `
  --receipt-out=$postExpandHostedRestoreReceipt

Remove-Item Env:SUPABASE_ACCESS_TOKEN,Env:HANBANG_HOSTED_RESTORE_DATABASE_URL
```

The database probe is a pinned read-only transaction. It records the target's
`pg_control_system().system_identifier` plus schema, ledger, table and
logical-data digests; it never stores row values, passwords, access tokens, or
Auth identities. The later production canary raw file independently records the
source production identifier through another read-only transaction. The
finalizer verifies both raw hashes and requires the two identifiers to differ;
project ref/host comparison alone is not physical-isolation proof. The project
raw file is the exact Management API response. A forged receipt, wrong project
name/ref, same database system identifier, missing Auth health response,
changed raw file, or digest mismatch is a hard stop. This hosted restore and its
evidence are currently **NOT RUN / NOT CREATED**.

The finalizer permits up to 1440 minutes for this fenced restore/deploy/canary
workflow, but it reruns the exact pinned backup verifier on the Windows creator
host. Every immutable field must still match the submitted receipt, the fresh
age must be consistent, and the database transaction independently rechecks
the live 27 tables and exact `0900..1170` ledger. The longer finalization window
does not permit a write-fence gap.

## Phase 6: deployment and canary while writes are still closed

Create an immutable deployment receipt for the exact production deployment.
It must bind release, project, commit, Vercel deployment ID, canonical HTTPS
origin and its SHA-256, created/ready/verified timestamps, `target=production`,
`readyState=READY`, and `source=vercel-api`.

The production build itself must have run
`scripts/check-amora-build-env.mjs` inside the real Vercel production builder.
A successful exact-commit deployment plus its boolean-only build log is the
environment proof: the checker is the first command in the web build and fails
before `next build` when any required production variable is absent or any
release flag is not exact lowercase `false`. Archive that log without secret
values. Do **not** use `vercel env run -e production`: in this workspace it does
not inject encrypted Production values and is not production-environment proof.

After the Vercel deployment is `READY` and `hanbang.ai` aliases that exact
deployment, collect the API response and deployment receipt:

```powershell
$deploymentId = '<exact-Vercel-production-deployment-id>'
$env:VERCEL_TOKEN = [Net.NetworkCredential]::new(
  '', (Read-Host 'Vercel access token' -AsSecureString)
).Password

node scripts/collect-production-external-gate-evidence.mjs `
  --mode=vercel `
  --expected-commit=$commit `
  --deployment-id=$deploymentId `
  --raw-out=$deploymentRaw `
  --receipt-out=$deploymentReceipt

Remove-Item Env:VERCEL_TOKEN
```

Canary the exact deployed commit while writes remain closed:

- public and authenticated reads;
- login and logout, but no new signup;
- dashboard, schedule, budget, vendor, Wedding Code, and Amora read paths;
- no unexpected 5xx, browser console error, server error spike, or latency
  regression;
- DB fence verification still green;
- final Storage verification still reports the production helper closed.

The immutable canary receipt must bind the raw SHA-256 of the release outcome,
deployment receipt, post-expand backup receipt, and hosted restore receipt. It
must include the manifest-pinned 13 boolean checks, an observation window of
300 to 3600 seconds, exact start/verified timestamps, and expiry exactly 15
minutes after verification. Any failed or expired canary leaves every fence in
place.

Use a dedicated disposable canary account that already exists; the collector
must confirm login, authenticated read, logout, and failed refresh after
logout, but it never creates a user. It also runs real Chromium, repeats the
four public/fenced HTTP probes at the start and end of a five-minute window,
queries the production database in a read-only transaction, and captures the
Vercel server-error API response. Supply credentials only through the current
process environment:

```powershell
$browser = '<absolute-path-to-reviewed-Chromium-or-Chrome-executable>'
$psql = (Get-Command psql.exe -ErrorAction Stop).Source

$env:VERCEL_TOKEN = [Net.NetworkCredential]::new(
  '', (Read-Host 'Vercel access token' -AsSecureString)
).Password
$env:HANBANG_CANARY_SUPABASE_ANON_KEY = [Net.NetworkCredential]::new(
  '', (Read-Host 'Production Supabase anon key' -AsSecureString)
).Password
$env:HANBANG_CANARY_TEST_EMAIL = Read-Host 'Disposable canary account email'
$env:HANBANG_CANARY_TEST_PASSWORD = [Net.NetworkCredential]::new(
  '', (Read-Host 'Disposable canary account password' -AsSecureString)
).Password
$env:HANBANG_PRODUCTION_DATABASE_URL = [Net.NetworkCredential]::new(
  '', (Read-Host 'Production direct read-only PostgreSQL URL' -AsSecureString)
).Password

node scripts/collect-production-external-gate-evidence.mjs `
  --mode=canary `
  --expected-commit=$commit `
  --deployment-receipt=$deploymentReceipt `
  --release-outcome=$outcomeReceipt `
  --backup-receipt=$postExpandBackupReceipt `
  --hosted-restore-receipt=$postExpandHostedRestoreReceipt `
  --browser-executable=$browser `
  --psql=$psql `
  --raw-out=$canaryRaw `
  --vercel-server-errors-raw-out=$vercelServerErrorsRaw `
  --receipt-out=$canaryReceipt

Remove-Item Env:VERCEL_TOKEN,Env:HANBANG_CANARY_SUPABASE_ANON_KEY,`
  Env:HANBANG_CANARY_TEST_EMAIL,Env:HANBANG_CANARY_TEST_PASSWORD,`
  Env:HANBANG_PRODUCTION_DATABASE_URL
```

These Vercel, hosted-restore, and canary external receipts are currently
**NOT RUN / NOT CREATED**. Existing historical deployment, restore, Android,
or EAS evidence must not be relabeled as this release candidate's evidence.

## Phase 7: exact-owner atomic lift

The reviewed finalizer now exists and is hash-pinned:

- controller: `scripts/finalize-production-write-fence.mjs`;
- implementation: `scripts/lib/production-write-fence-finalizer.mjs`;
- atomic SQL template:
  `supabase/platform-operations/security/20260717121000_production_write_fence_finalize.sql`.

Compute the lowercase raw SHA-256 of the canary file and use it verbatim in the
confirmation string:

```powershell
$canarySha = (Get-FileHash -LiteralPath $canaryReceipt -Algorithm SHA256).Hash.ToLowerInvariant()

node scripts/finalize-production-write-fence.mjs `
  --expected-commit=$commit `
  --remote-ref=$branch `
  --release-outcome=$outcomeReceipt `
  --deployment-receipt=$deploymentReceipt `
  --post-expand-backup-receipt=$postExpandBackupReceipt `
  --post-expand-hosted-restore-receipt=$postExpandHostedRestoreReceipt `
  --canary-receipt=$canaryReceipt `
  --receipt-out=$finalizerReceipt `
  --confirm-production="FINALIZE:slrtobkksjmxgzatjyqb:amora-engine-v2-20260716:$commit:<vercel-deployment-id>:$canarySha"
```

Before its only database query, the controller verifies a clean exact remote
commit, linked project, CLI provenance, retained local owner lock, deployment,
all receipt hashes, hosted isolation, and fresh pinned backup reverification.
The SQL then locks current public tables, verifies the exact remote lease owner
in phase `deployment-canary`, exact trigger/event-trigger/function/ACL
inventory, no active cron, live 27-table/ledger contract, and unexpired canary
evidence. In the same transaction it deletes exactly that owner's lease and
removes every write-fence artifact. Any mismatch, stale evidence, extra
artifact, replay, or failed postcondition rolls the entire transaction back.

If the database command times out, returns malformed/extra output, or otherwise
becomes ambiguous, both local locks and the `finalization_started...` receipt
remain. Do not rerun and do not delete them. Adjudicate the remote lease and
fence state read-only with two-person review.

Only after a `verified_success` finalizer receipt:

1. Run the rollback post-verification and final Storage verification again.
2. Perform production authenticated upload canaries: intended-user positive,
   other-user negative, anonymous negative, traversal negative, update/delete
   negative, and authorized signed-read positive.
3. Set Vercel `PRODUCTION_WRITE_FENCE_ENABLED=false`, redeploy the same commit,
   and verify the probe returns the route's intentional 409 rather than proxy
   503.
4. Re-enable Auth signup last.
5. Keep all feature, cron, deletion-intake, care-outbound, community-AI, and
   retention flags at their manifest-pinned false defaults until their separate
   rollout gates pass.

## Failure and rollback policy

- Before DB push: keep web/Auth/DB/Storage closed, correct the evidence, and
  start a new reviewed release attempt.
- During or after an ambiguous push: do not rerun apply, do not repair migration
  history, and do not delete the local lock. Investigate the remote ledger and
  schema read-only.
- During final Storage operation: run only the safe freeze-convergence artifact.
  Never restore the legacy 19-policy broad-write state.
- During canary: leave every fence active and forward-fix or restore the full
  provider physical backup in an approved recovery workflow.
- After fence lift: reacquire web/Auth/DB/Storage fences before rollback or
  repair. Do not treat the 14-table logical backup as full-database coverage.

The public database fence does not itself freeze `auth.users`. Signup is
disabled, but an administrative Auth mutation or account deletion must remain
separately disabled. A provider physical restore rolls the whole hosted
database, including Auth, back to the selected snapshot and therefore loses
all later accepted changes within that recovery point objective. Prefer an
expand-compatible forward fix for schema or application defects. A full
provider restore requires an approved incident decision; the HBAM2 logical
artifact never justifies a claim of complete Auth/Storage rollback.

Production is complete only after the final receipt is `verified_success`, the
write-fenced canary is green, the paired lift succeeds, post-lift positive and
negative upload canaries are green, and monitoring remains healthy for the
approved observation window.

At the current repository state, the exact-owner atomic finalizer is
implemented and its controller/PGlite adversarial suites are locally green.
No production command has been run. The real post-expand backup, fresh pinned
reverification, different-project hosted restore, deployment, canary, and
database finalization receipts do not exist in this local verification record.
Production status therefore remains **NO-GO / NOT DEPLOYED** until every real
receipt and runtime gate above passes.
