# Amora database backup and recovery runbook

This runbook is the safety gate for the Amora OpenAI migration. The HBAM2
backup protects the 11 Amora-related tables, but it is not by itself a database
restore or authorization to change production.

## Current gate

Stage B remains **open**, with the following evidence as of 2026-07-15 KST:

1. **Passed:** fresh production HBAM2 capture and immediate verification;
2. **Passed:** provider backup `2026-07-14 20:13:53 UTC` is `COMPLETED`
   and exposes a Restore action;
3. **Partially passed:** Supabase restored production into isolated clone
   `syhmfxauqyhgdcokrheg`, including real schema, Auth and data. This proves the
   provider physical-restore path, but it is not a replay of the HBAM2 logical
   artifacts into a blank target;
4. **Passed on the provider clone:** hosted RLS/RPC/Auth contract and concurrency
   tests after all release expand migrations;
5. **Partially passed:** the production remote dry-run matches exactly 15
   hash-pinned manifest files. Production write-fence execution, ledger
   reconciliation and migration apply remain open.

PGlite proves authenticated JSONB integrity and precision. It does not install
the production schema, policies, triggers, or functions. The provider clone
adds real hosted-schema evidence but still does not prove the independently
restorable HBAM2 logical path.

## Covered data and schema

`scripts/sql/amora-db-logical-backup.sql` reads exactly these tables in one
PostgreSQL statement, so the included rows share one statement snapshot:

- `ai_interactions_log`
- `amora_actions`
- `amora_couple_profiles`
- `amora_turn_counters`
- `chat_feedback`
- `chat_messages`
- `chat_summaries`
- `couples`
- `decision_nodes`
- `profiles`
- `wedding_journeys`

The inventory records migration history, relation OID/kind/inheritance shape,
RLS state, columns including typmods,
domain and collation metadata, constraints, indexes, policies, trigger event
bits/timing/row level/enabled state, function owner/ACL/configuration, exact RPC
signatures, and external triggers that call included public functions. The
`auth.users` AFTER ROW INSERT trigger calling `create_profile_on_signup()` is
an explicit required dependency.

This targeted backup does not include every public table, Auth user rows,
Storage objects, extension state, or provider-managed settings. Supabase's
physical backup remains the disaster-recovery layer.

## Safety contract

- The source is fenced three ways: an explicit 20-character project ref, the
  worktree's linked ref held open for the whole capture, and
  `supabase db query --workdir <exact-repo-root>`.
- Every remote payload starts one server-side `BEGIN TRANSACTION READ ONLY`,
  sets a 120-second statement timeout, a 5-second lock timeout, and
  `row_security=off`, then commits. Capture is rejected unless preflight,
  both inventories, and data all report one stable current/session role with
  `rolsuper` or `rolbypassrls`.
- A read-only preflight runs before data capture. The local gate allows at most
  16 MiB estimated table size and 250,000 estimated rows; every SQL payload is
  capped at 32 MiB. All 11 targets must be standalone ordinary tables; missing
  tables, partition parents, and inheritance parents or children are rejected
  rather than relying on partial size estimates.
- Query processes have a 150-second default wall-clock timeout.
- Schema inventory is captured before and after the data statement. Publication
  fails if their canonical contract SHA-256 values differ.
- Preflight, inventory-before, the data statement, and inventory-after must
  report the same 11 relation OIDs and standalone ordinary-table shape. Every
  row CTE reads `FROM ONLY public.<table>`, so a transient inheritance child is
  never included. This closes rename/recreate and attach/detach DDL ABA races.
- Each table carries a SHA-256 computed by source PostgreSQL from canonical
  `jsonb::text`. PGlite must independently reproduce it before and after
  generic staging, including values outside JavaScript's safe integer range.
- Format is `HBAM2-AES-256-CBC-HMAC-SHA256-DPAPI-CurrentUser`, version 2.
  Encryption and MAC use separate random 256-bit keys; HMAC is checked before
  decryption.
- The authenticated envelope contains the shared backup-set ID, while each
  artifact uses a different random key and IV. The project ref, set ID, and
  exact artifact name are also bound into DPAPI entropy.
- The production root is fixed at
  `%LOCALAPPDATA%\WeddingHanbang\PrivateBackups\amora-openai`. Arbitrary roots
  are rejected. A versioned marker, owner, exact ACL, containment, and every
  existing path component's reparse status are verified.
- Only the creating Windows user, `SYSTEM`, and local Administrators may have
  Full Control. Existing unmarked directories are never re-ACLed.
- These scripts intentionally create no plaintext payload files; decrypted
  rows are handled in process memory and cleared from mutable byte arrays.
  Windows paging, hibernation, crash dumps, and external instrumentation are
  separate host controls and are not disabled or proven by this script.
- Production capture requires a clean committed Git worktree. The creator
  holds the implementation, SQL, `package.json`, and `pnpm-lock.yaml` files
  open, records their SHA-256 values and the corresponding Git blob hashes,
  and rejects a source or commit change during capture.
- Supabase CLI is exactly pinned by the committed package and lock files. A
  custom production CLI and `SUPABASE_CLI_BINARY_OVERRIDE` are rejected. The
  repo-local launcher, JavaScript resolver, platform package, and native binary
  are held open and hashed; queries execute the pinned native binary directly.
- Capture holds one exclusive root lock from timestamp/path creation through
  failure cleanup and memory clearing. A concurrent loser cannot publish or
  delete the winner's completed directory; an OS-released stale handle is
  reusable after a crashed process while the fixed lock marker remains.
- Verification accepts only the committed absolute Node runtime, version, size,
  and SHA-256. It removes Node preload/cache/coverage environment hooks and
  imports the pinned physical PGlite entry rather than a package junction. All
  301 files in the approved PGlite 0.5.4 tree are size-bounded, tree-hashed,
  and held open through the verification subprocess.
- Verification requires the creator's externally recorded backup-set ID and
  manifest SHA-256. The default maximum age is 30 minutes, preventing an old
  complete set from being silently replayed as a new backup.

DPAPI CurrentUser is deliberately non-portable. It normally requires the same
Windows user profile on the creating computer. Portable escrow or off-site
retention requires a separate security, legal, and business decision.

## Create and immediately verify

From the repository root, with the worktree linked to the intended project,
install exactly the committed dependency graph and confirm the worktree is
clean. Do not edit or switch commits between capture and immediate verify:

```powershell
corepack pnpm install --frozen-lockfile
if (git status --porcelain) { throw 'Backup requires a clean worktree.' }

$receipt = corepack pnpm --silent amora:db:backup `
  -ExpectedProjectRef <20-character-project-ref> |
  ConvertFrom-Json

$receipt | Select-Object `
  BackupDirectory, BackupSetId, ManifestSha256, InventoryContractSha256, `
  GitCommit, SupabaseCliVersion, SupabaseCliBinarySha256, SourceCapturedAt, `
  SourceRelationContractSha256, TableCount, TotalRows

corepack pnpm --silent amora:db:verify-backup `
  -BackupDirectory $receipt.BackupDirectory `
  -ExpectedProjectRef <20-character-project-ref> `
  -ExpectedBackupSetId $receipt.BackupSetId `
  -ExpectedManifestSha256 $receipt.ManifestSha256 `
  -MaximumAgeMinutes 30
```

The verification receipt must report:

- `Verified=true`;
- the same `BackupSetId` and `ManifestSha256` as the creator receipt;
- the same `GitCommit`, `SupabaseCliVersion`, and pinned binary SHA-256;
- `SourceCanonicalDigestsVerified=true`;
- `PGliteJsonbRoundTripVerified=true`;
- the committed `NodeVersion`/`NodeSha256` and `PGliteVersion`/`PGliteTreeSha256`;
- exact table and total-row counts;
- non-zero applicable primary/unique and included foreign-key checks;
- `PlaintextWrittenToDisk=false`.

`-Help` is side-effect free:

```powershell
corepack pnpm amora:db:backup -Help
corepack pnpm amora:db:verify-backup -Help
```

Never commit or upload the timestamp directory, encrypted payloads, DPAPI key
files, manifest, or production receipt. The manifest contains no row content,
but it is still part of the external authentication workflow.

## Synthetic regression gate

Run the Windows-only creator/verifier test without contacting production:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\tests\amora-db-backup-e2e.ps1
```

It uses a fake Supabase CLI and currently covers 31 cases: actual logical SQL,
the exact `--workdir` call order, DPAPI/AES/HMAC authentication, external
anchors, ciphertext and HMAC tampering, captured-at mismatch, extra files, ACL
widening, cross-set mixing, stale replay anchors, schema drift, relink attempts,
disabled or wrong-event Auth triggers, partition/missing-table preflight,
transaction-control escape attempts, production CLI/Node overrides, inherited
Node preload options, and concurrent-capture winner preservation without
publishing a partial set. Its positive production-runtime case also imports the
locked physical PGlite entry, opens a database, executes a query, and closes it.
The final three cases reject a preflight-to-inventory OID replacement, an
inventory-to-data OID replacement, and a transient inherited data relation.

GitHub's Windows runner cannot satisfy the production host's committed absolute
Node path, byte size and SHA-256 by design. CI therefore runs
`pnpm amora:db:test-backup:ci`, which executes the 30 portable cases and
explicitly reports `HostBoundRuntimeSmokeSkipped=true`. The normal
`pnpm amora:db:test-backup` command must still pass all 31 cases on the actual
production backup host before any production write.

## What PGlite does not prove

PowerShell authenticates and inspects the JSON envelope, timestamps, table
allowlist, and row counts in memory. For the precision-sensitive database
round trip, Node passes the authenticated logical bytes directly as
`$1::jsonb`; V8 does not parse user rows. PGlite validates table shape, source
canonical hashes, row counts, primary/unique keys, included foreign keys, and a
generic JSONB round trip.

It does not recreate typed columns, defaults, CHECK constraints, triggers,
policies, Auth dependencies, or RPC execution. Do not call this a restore
rehearsal and do not replay the payload into production.

## Isolated restore gate

Before enabling the OpenAI runtime:

1. record a current physical-backup timestamp and Restore availability;
2. create a disposable isolated PostgreSQL/Supabase target;
3. apply the reviewed real schema and required Auth trigger dependency;
4. restore the authenticated HBAM2 rows through a separately reviewed,
   destination-fenced transaction;
5. compare row counts and source canonical digests;
6. run anonymous, user A, partner, non-member, and service-role RLS cases;
7. exercise exact signatures `reserve_amora_turn(uuid,integer,integer)`,
   `apply_journey_progress_patch(uuid,jsonb,text[])`,
   `join_couple(text,text)`, `generate_invite_code()`,
   `redact_old_ai_interactions(interval)`, and the signup contract;
8. destroy the isolated plaintext target after recording non-sensitive results.

The current scripts intentionally have no production restore mode. Such a mode
needs explicit source/destination refs, digest/count preconditions, a write
transaction, a rollback transaction, and operator confirmation.

## Migration-history warning

Production contains objects that are not fully explained by the remote
migration ledger while this repository also has pending migrations. Therefore:

- never run unscoped `supabase db push` or `--include-all`;
- never repair migration history merely to make lists look equal;
- apply only one exact reviewed expand-only artifact after backup, dry-run,
  lock/statement timeouts, and a write fence;
- reconcile the migration ledger in a separate reviewed operation.

## Retention and deletion

The backup contains personal data. Keep it in the fixed non-cloud-sync local
root and retain it only as long as the approved recovery window requires.
Automated deletion, portable escrow, off-site replication, and deletion-request
handling remain legal/business decisions and are not enabled by these scripts.
