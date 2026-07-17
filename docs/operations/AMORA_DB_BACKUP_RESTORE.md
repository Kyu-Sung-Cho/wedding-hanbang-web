# Amora database backup and recovery runbook

This runbook is the safety gate for the Amora OpenAI migration. The release
version of HBAM2 protects 27 Amora-related tables after the complete Engine V2
expand set, but it is not by itself a database restore or authorization to
change production.

The two backup contracts must not be mixed:

- **Before the production expand:** create and verify the write-fence backup
  from the clean pre-expand commit recorded in the receipt. The current
  production baseline contract has an exact 14-table durable allowlist plus two
  explicit ephemeral exclusions. Engine V2
  tables do not exist at required remote head `20260715210000`.
- **After all reviewed expand migrations:** use this release checkout's
  27-table allowlist and immediately verify a new post-expand backup.

A 27-table capture cannot be used as the pre-write gate against the pre-expand
schema, and a 14-table capture is not a complete post-expand backup. Historical
11-table receipts remain evidence for their dated release only and cannot open
the current Engine V2 write gate.

## Current gate

Stage B remains **open**, with the following evidence as of 2026-07-17 KST:

1. **Still open:** create the final production pre-expand HBAM2 artifact from
   the exact 14-table contract in a clean immutable checkout and immediately
   verify it. The completed production-shaped `self_test` proves the
   implementation and remote shape but is explicitly not the final write-fence
   artifact;
2. **Dated evidence only:** a provider physical backup reported `COMPLETED`,
   and an isolated with-data provider clone was healthy. Re-check freshness and
   Restore availability immediately before the production write;
3. **Passed locally without a production query:** the post-expand SQL executes
   with all 27 tables, exact numeric preservation, the exact release ledger
   through `20260716117000`, current function identities, and the booking
   projection trigger; the Windows HBAM2 harness passes all 52
   creator/verifier and rejection cases;
4. **Still open:** apply the exact final migration set to the isolated clone,
   run the hosted schema/RLS/RPC/concurrency gates, then create and verify a
   27-table post-expand backup on that isolated schema;
5. **Still open:** independent HBAM2 logical replay into a blank target. The
   provider physical clone and PGlite JSONB verification do not substitute for
   that separate recovery exercise.

Production writes remain blocked while any open item is unresolved.

PGlite proves authenticated JSONB integrity and precision. It does not install
the production schema, policies, triggers, or functions. The provider clone
adds real hosted-schema evidence but still does not prove the independently
restorable HBAM2 logical path.

## Covered data and schema

`scripts/sql/amora-db-logical-backup.sql` reads exactly these tables in one
PostgreSQL statement, so the included rows share one statement snapshot:

- `account_deletion_jobs`
- `account_deletion_media_manifest`
- `ai_interactions_log`
- `amora_actions`
- `amora_chat_request_claims`
- `amora_care_deliveries`
- `amora_care_jobs`
- `amora_care_scan_states`
- `amora_conflict_check_claims`
- `amora_couple_profiles`
- `amora_mediation_acceptances`
- `amora_memory_consents`
- `amora_memory_jobs`
- `amora_memory_settings`
- `amora_tool_executions`
- `amora_turn_counters`
- `amora_turn_requests`
- `booking_projection_jobs`
- `chat_feedback`
- `chat_messages`
- `chat_summaries`
- `community_upload_sessions`
- `couples`
- `decision_nodes`
- `profiles`
- `vendor_reviews`
- `wedding_journeys`

The inventory records migration history, relation OID/kind/inheritance shape,
RLS state, columns including typmods,
domain and collation metadata, constraints, indexes, policies, trigger event
bits/timing/row level/enabled state, function owner/ACL/configuration, exact RPC
signatures, and external triggers that call included public functions. The
`auth.users` AFTER ROW INSERT trigger calling `create_profile_on_signup()` and
the `public.vendor_bookings` AFTER ROW INSERT/UPDATE
`vendor_bookings_projection_outbox` trigger calling
`enqueue_booking_projection_job()` are explicit required dependencies.

The post-expand function identity fence additionally requires these exact
`pg_proc` identities (argument names/defaults do not change an identity):

- `20260716096000`: the rolling-deploy compatibility signatures
  `claim_amora_tool_execution(uuid,text,text,text,text)`,
  `claim_amora_tool_execution(uuid,text,text,text,text,integer)`, and the
  server-issued approval capability signature
  `claim_amora_tool_execution(uuid,text,text,text,text,integer,uuid)`;
- `20260716097000`: `reserve_amora_turn(uuid,integer,integer)`,
  `reserve_amora_turn(uuid,integer,integer,bigint,bigint)`,
  `prepare_amora_provider_call_receipt(uuid,uuid,text,text,text,text,integer,text,text,jsonb)`,
  `reserve_amora_provider_call(uuid,uuid,text,uuid,integer,integer,bigint,bigint)`,
  and
  `finalize_amora_provider_call_receipt(uuid,uuid,boolean,text,bigint,boolean,text,text,integer,integer,integer,jsonb)`;
- `20260716100000`:
  `apply_journey_progress_item_patch(uuid,text,jsonb)`;
- `20260716102000`: `enqueue_booking_projection_job()`,
  `claim_booking_projection_job(uuid,integer)`,
  `finish_booking_projection_job(uuid,bigint,uuid,boolean,text,integer)`,
  `get_booking_projection_queue_stats()`,
  `retry_booking_projection_job(uuid)`, and
  `apply_booking_progress_projection(uuid,uuid,text,jsonb,text,numeric,bigint,uuid)`;
- `20260716103000`: `claim_amora_conflict_check(uuid,text,uuid)`,
  `checkpoint_amora_conflict_check(uuid,text,uuid,jsonb)`,
  `complete_amora_conflict_check(uuid,text,uuid,jsonb)`, and
  `fail_amora_conflict_check(uuid,text,uuid,text)`;
- `20260716104000`:
  `patch_profile_atomic(uuid,text,text,boolean,boolean,boolean,text,boolean,boolean)`;
- `20260716105000`:
  `finalize_amora_conflict_verify_receipt(uuid,uuid,uuid,text,uuid,jsonb,boolean,text,bigint,boolean,text,text,integer,integer,integer,jsonb)`;
- `20260716106000`:
  `finalize_amora_chat_response(uuid,uuid,uuid,uuid,text,text,integer,text,jsonb,text,text,boolean,text,bigint,boolean,text,text,integer,integer,integer,jsonb)`
  and `reconcile_amora_chat_response(uuid,text,uuid,text,uuid)`;
- `20260716107000`: `get_wedding_settings_snapshot(uuid)` and
  `patch_wedding_settings_atomic(uuid,uuid,boolean,text,boolean,text,text,boolean,text,date,boolean,date,text,boolean,text,bigint,boolean,bigint)`;
- `20260716108000`:
  `claim_community_upload_session(uuid,uuid,uuid,timestamp with time zone)`.
- `20260716113000`: `begin_account_deletion_job(uuid,text)`,
  `claim_account_deletion_job(uuid,uuid,timestamp with time zone)`,
  `replace_account_deletion_media_manifest(uuid,uuid,jsonb)`,
  `release_account_deletion_job(uuid,uuid,text)`,
  `mark_account_deletion_manual_review(uuid,uuid,text)`,
  `resume_account_deletion_after_manual_review(uuid)`,
  `checkpoint_account_deletion_media(uuid,uuid,text,text)`,
  `prepare_account_deletion_auth_delete(uuid,uuid)`, and
  `finalize_account_deletion_job(uuid,uuid)`.

Creator and verifier both fail closed if any identity is absent. The inventory
also stores owner, ACL, `SECURITY DEFINER`, configuration and full definition,
so the before/after schema digest detects changes to those attributes.
For both 1130 tables it also requires RLS enabled plus `FORCE ROW LEVEL
SECURITY`; every 1130 function must be owned by `postgres`, be
`SECURITY DEFINER`, use the reviewed empty search path, grant execute to
`service_role`, and grant no execute privilege to `PUBLIC`, `anon`, or
`authenticated`.

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
  capped at 32 MiB. All 27 targets must be present as standalone ordinary
  tables; missing tables, partition parents, and inheritance parents or
  children are rejected rather than relying on partial size estimates.
- Query processes have a 150-second default wall-clock timeout.
- Schema inventory is captured before and after the data statement. Publication
  fails if their canonical contract SHA-256 values differ.
- Preflight, inventory-before, the data statement, and inventory-after must
  report the same 27 relation OIDs and standalone ordinary-table shape. Every
  row CTE reads `FROM ONLY public.<table>`, so a transient inheritance child is
  never included. This closes rename/recreate and attach/detach DDL ABA races.
- Those same four stages bind the exact care-delivery policy contract from
  migration `20260716095000`: the `amora_care_deliveries.send_day` `date`
  column, validated `profiles_care_consent_state_valid` CHECK constraint,
  indexes `amora_care_deliveries_user_send_day_uidx`,
  `amora_care_jobs_active_age_idx`, and `amora_care_jobs_scan_status_idx`, and
  all ten public/internal policy RPC signatures. Any missing marker rejects the
  payload server-side and is independently rejected again by the creator or
  verifier from authenticated metadata.
- Those stages also require the exact 27-version release ledger after baseline
  head `20260715210000`, with no missing or additional version and exact final
  head `20260716117000`. A database below `1170` or with an unreviewed later
  migration cannot produce a valid post-expand backup.
- Migration `20260716098000` and
  `defer_amora_memory_job(uuid,integer,integer,text)` are also mandatory. The
  function must be owned by `postgres`, be `SECURITY DEFINER`, retain the exact
  search-path/lock/statement-timeout configuration, grant execute to
  `service_role`, and grant no execute privilege to `PUBLIC`, `anon`, or
  `authenticated`. Preflight, both inventories, logical data, raw function ACL,
  and authenticated verification all fail closed on a mismatch.
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

### Hand the verified pre-write backup to the release controller

The pre-expand backup tool and the release controller intentionally live in
different immutable checkouts when the pending release adds backup-covered
tables. Keep the clean pre-expand checkout at the receipt's exact `GitCommit`
after immediate verification. Save the verifier's one-line JSON output to a
private absolute path outside Git; do not edit or merge creator and verifier
receipts by hand.

The production controller requires both that JSON file and the clean
pre-expand checkout. It first compares the checkout HEAD to `GitCommit`, then
runs that checkout's `amora-db-verify-backup.ps1` again with the manifest
project ref, backup-set ID, manifest SHA-256 and a 30-minute maximum age. It
also requires the current native Supabase CLI version and binary SHA-256 to
match the freshly authenticated verifier receipt. A copied JSON object alone
therefore cannot open the production write gate.

Do not switch the pre-expand checkout to the release commit, regenerate the
receipt with the post-expand 27-table allowlist before the schema exists, or
put database passwords/tokens in controller arguments. The outcome receipt is
separate metadata, is created outside Git before the push, and contains no
row data or credentials.

## Synthetic regression gate

Run the Windows-only creator/verifier test without contacting production:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\tests\amora-db-backup-e2e.ps1
```

It uses a fake Supabase CLI and currently covers 52 cases: actual preflight,
inventory, and logical SQL; the exact `--workdir` call order;
DPAPI/AES/HMAC authentication; external
anchors, ciphertext and HMAC tampering, captured-at mismatch, authenticated
live-schema/logical-data digest tampering, extra files, ACL
widening, cross-set mixing, stale replay anchors, schema drift, relink attempts,
disabled or wrong-event Auth triggers, missing Amora safety triggers, the
legacy unversioned mediation-acceptance RPC,
partition/missing-table preflight,
transaction-control escape attempts, production CLI/Node overrides, inherited
Node preload options, all 0950 migration/column/constraint/index/function and
logical-contract omission gates, the 0980 migration/function omissions and
non-service ACL
gates, the 1130 migration omission, a missing `1170` head, an unreviewed
post-`1170` migration, missing account-deletion `FORCE RLS`,
missing account-deletion function identity, account-deletion non-service
execute privilege, omission of a post-expand atomic function identity, omission of the
booking projection outbox trigger, and concurrent-capture winner preservation
without publishing a partial set. Its positive production-runtime case also imports the
locked physical PGlite entry, opens a database, executes a query, and closes it.
The final three cases reject a preflight-to-inventory OID replacement, an
inventory-to-data OID replacement, and a transient inherited data relation.

The harness is intentionally host-bound: it requires the committed absolute
Node path, byte size and SHA-256, a user-owned private NTFS ACL, and CurrentUser
DPAPI. GitHub-hosted Windows runners do not satisfy those production-host
invariants, so this gate is not run as hosted CI. The normal
`pnpm amora:db:test-backup` command must pass all 52 cases on the actual
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
7. exercise every exact identity in the post-expand function identity fence
   above, plus all retained baseline signatures. Both
   `reserve_amora_turn(uuid,integer,integer)` and
   `reserve_amora_turn(uuid,integer,integer,bigint,bigint)`
   must remain callable during the rolling-deploy compatibility window; also
   exercise all three rolling-deploy approval signatures:
   `claim_amora_tool_execution(uuid,text,text,text,text)`,
   `claim_amora_tool_execution(uuid,text,text,text,text,integer)`, and
   `claim_amora_tool_execution(uuid,text,text,text,text,integer,uuid)`, plus
   `claim_community_upload_session(uuid,uuid,uuid,timestamp with time zone)`,
   `apply_journey_progress_patch(uuid,jsonb,text[])`,
   `join_couple(text,text)`, `generate_invite_code()`,
   `redact_old_ai_interactions(interval)`,
   `reset_amora_memory_after_membership_change()`,
   `has_current_amora_memory_consent(uuid,text)`,
   `enqueue_amora_memory_job(uuid,uuid,text,uuid)`,
   `claim_amora_memory_job(integer,uuid)`,
   `finish_amora_memory_job(uuid,boolean,text,integer)`,
   `upsert_amora_memory_node(uuid,text,text,text,text,text,text,numeric,text,uuid,jsonb)`,
   `update_amora_memory_node(uuid,text,uuid,uuid,text,text)`,
   `delete_amora_memory_node(uuid,text,uuid,uuid)`,
   `insert_amora_memory_summary(uuid,uuid,text,text,integer,uuid,uuid)`,
   `commit_amora_memory_job(uuid,integer,jsonb,text,integer,uuid,uuid)`,
   `defer_amora_memory_job(uuid,integer,integer,text)` with service-only execute
   privilege,
   `set_amora_memory_consent(uuid,text,uuid,boolean)`,
   `clear_amora_memory_scope(uuid,text,uuid)`,
   `bind_amora_mediation_proposal()`,
   `accept_amora_mediation(uuid,uuid,uuid,text,text,uuid,text)` (and verify the
   legacy five-argument overload is absent),
   `revoke_amora_mediation_acceptance(uuid,uuid,uuid)`,
   `reset_amora_mediation_after_membership_change()`,
   `insert_amora_care_message(uuid,text,jsonb)`,
   `enqueue_amora_care_job(uuid,date,text,text,jsonb,text,text)`,
   `prepare_amora_care_job(uuid,uuid,boolean)`,
   `claim_amora_care_email_delivery(uuid,uuid)`,
   `amora_care_delivery_clock()`,
   `amora_care_is_delivery_window(timestamp with time zone)`,
   `amora_care_next_delivery_window(timestamp with time zone)`,
   `get_amora_care_queue_stats(date)`, plus all three
   `_pre_delivery_policy` internal signatures, and the signup contract;
8. verify the enabled row-level safety triggers
   `trg_reset_amora_memory_after_membership_change`,
   `trg_reset_amora_mediation_after_membership_change`, and
   `trg_bind_amora_mediation_proposal`, plus external trigger
   `vendor_bookings_projection_outbox`, including their events, timing, and
   exact function targets;
9. destroy the isolated plaintext target after recording non-sensitive results.

The current scripts intentionally have no production restore mode. Such a mode
needs explicit source/destination refs, digest/count preconditions, a write
transaction, a rollback transaction, and operator confirmation.

## Migration-history warning

As of the 2026-07-17 read-only audit, production has not applied this release's
pending Engine V2 migration set. Re-read the remote ledger immediately before
release; do not infer migration state from this dated document. Therefore:

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
