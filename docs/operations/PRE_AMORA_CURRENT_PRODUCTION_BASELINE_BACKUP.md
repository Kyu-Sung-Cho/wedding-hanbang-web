# Pre-Amora current production baseline backup

## Status

This is a dedicated, fail-closed backup contract for the production database state **before** the pending Amora migrations. It is intentionally separate from the post-migration Amora release backup contract.

- Production project ref: `slrtobkksjmxgzatjyqb`
- Required remote migration head: `20260715210000`
- Audited schema contract SHA-256: `CE2A4D55024571C9491274F796C509384681D8026336573334C4BCA199EC6CE3`
- Target durable table count: 14
- Explicitly excluded ephemeral relation count: 2
- Production writes performed by this workflow: none
- Final production artifact: **not valid until the clean-commit capture and verification commands below both succeed**

Do not run this baseline contract after any pending migration is applied. The preflight rejects a changed migration head, any known post-baseline relation, a changed schema digest, a non-RLS-bypass role, a writable transaction, an unexpected table shape, or an oversized source.

## Fixed table scope

1. `ai_interactions_log`
2. `amora_actions`
3. `amora_chat_request_claims`
4. `amora_couple_profiles`
5. `amora_tool_executions`
6. `amora_turn_counters`
7. `chat_feedback`
8. `chat_messages`
9. `chat_summaries`
10. `couples`
11. `decision_nodes`
12. `profiles`
13. `vendor_reviews`
14. `wedding_journeys`

This is not a whole-project backup. In particular, it does not contain `auth.users`, Storage objects, or unrelated public tables.

The current schema also contains two deliberately excluded ephemeral relations:

- `production_release_lease_20260717`: must be empty during capture and is removed only by the paired, exact-owner write-fence finalizer;
- `rate_limit_buckets`: contains disposable throttle state and is recreated empty by `public.check_rate_limit(text,integer,integer)`.

The receipt must report `ExcludedEphemeralTableCount = 2` and the exact rebuild contract. Neither relation may be silently treated as durable user data.

## Capture contract

The capture process holds the linked-project ref file open and uses the pinned repo-local Supabase CLI with an explicit `--linked --workdir <repo-root>` invocation. It runs four separate server-side guarded queries in this order:

1. current-schema and size preflight;
2. schema inventory before the data snapshot;
3. all 14 durable tables in one PostgreSQL statement snapshot;
4. schema inventory after the data snapshot.

Every SQL file starts with:

```sql
begin transaction read only;
set local statement_timeout = '120s';
set local lock_timeout = '5s';
set local row_security = off;
```

The server payload must also prove `transaction_read_only = on`, `row_security = off`, and that the executing role has `BYPASSRLS` or superuser capability. The schema-before and schema-after contracts, table OIDs, inheritance shapes, database, execution role, and migration history must remain identical.

Bounds are deliberately small for the current database:

- estimated source table bytes: at most 8 MiB;
- estimated and actual rows: at most 100,000;
- each logical payload: at most 16 MiB;
- HBAM2 global authenticated envelope bound: 32 MiB.

## Encryption and artifact set

Rows and schema inventories exist only in process memory before encryption. The capture does not create a plaintext payload file. It uses the existing `HBAM2-AES-256-CBC-HMAC-SHA256-DPAPI-CurrentUser` primitives.

The final directory is a direct timestamp child of:

```text
%LOCALAPPDATA%\WeddingHanbang\PrivateBackups\amora-openai\YYYYMMDD-HHMMSS
```

It must contain exactly these five files:

```text
logical-data.json.hbam2
logical-data.json.key.dpapi
manifest.json
schema-inventory.json.hbam2
schema-inventory.json.key.dpapi
```

`schema-inventory.json.hbam2` contains both the schema-before and schema-after inventories. `manifest.json` contains hashes, timestamps, row counts, runtime provenance, and source fences but no row contents. The directory and files use a protected Windows ACL limited to the creating user, Local System, and local Administrators.

The backup-set UUID and manifest SHA-256 printed after capture are external authentication anchors. Store both outside the backup directory in a secure operator record. A manifest copied together with altered artifacts is not an independent anchor.

## Required clean-commit production procedure

Run from the repository root on the Windows account that will retain the DPAPI key scope.

1. Freeze all production migrations and writes for the capture window.
2. Commit the complete reviewed release implementation.
3. Confirm the worktree is completely clean:

```powershell
git status --porcelain=v1 --untracked-files=all
git diff --exit-code
git diff --cached --exit-code
```

The first command must print nothing and both diff commands must exit `0`.

4. Confirm the linked destination and static safety contract:

```powershell
Get-Content -Raw supabase\.temp\project-ref
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\tests\amora-db-current-baseline-contract.ps1
```

The ref must be exactly `slrtobkksjmxgzatjyqb` and the contract test must report `ContractVerified: true`.

5. Capture through read-only linked queries:

```powershell
$captureJson = powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File scripts\amora-db-current-baseline.ps1 `
  -ExpectedProjectRef slrtobkksjmxgzatjyqb `
  -QueryTimeoutSeconds 180

$capture = $captureJson | ConvertFrom-Json
$capture | ConvertTo-Json -Depth 10
```

Do not continue if the command exits non-zero, prints `PlaintextWrittenToDisk: true`, reports a different table count, or reports a different schema contract hash.

6. Verify immediately with independently supplied anchors from the capture receipt:

```powershell
$verifyJson = powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File scripts\amora-db-current-baseline-verify.ps1 `
  -BackupDirectory $capture.BackupDirectory `
  -ExpectedProjectRef slrtobkksjmxgzatjyqb `
  -ExpectedBackupSetId $capture.BackupSetId `
  -ExpectedManifestSha256 $capture.ManifestSha256 `
  -MaximumAgeMinutes 30

$verify = $verifyJson | ConvertFrom-Json
$verify | ConvertTo-Json -Depth 10
```

The database-push gate may open only when `Verified`, `LogicalRowReplayVerified`, `PlaintextWrittenToDisk = false`, `ExcludedEphemeralTableCount = 2`, and the exact ephemeral rebuild contract are all confirmed and the row total matches the capture receipt. This local replay is necessary but does not satisfy the separate hosted restore gate.

## Executable isolated logical row replay

The verifier performs an isolated logical row replay. After authenticating and decrypting both HBAM2 artifacts in memory, it:

1. creates a disposable in-memory PGlite database;
2. verifies the source-computed schema contract SHA against PGlite's canonical JSONB representation;
3. proves the schema-before and schema-after contracts are equal;
4. creates 14 isolated tables with one JSONB column per source column;
5. restores every row in source order without parsing logical row values through JavaScript numbers;
6. replays all included primary-key and unique constraints;
7. replays foreign keys whose source and destination are both inside the 14-table scope;
8. re-computes every source and restored canonical row digest;
9. destroys the in-memory target when the process exits.

This verifies that the encrypted logical data can be authenticated, decrypted, staged, related, and round-tripped without a plaintext file or production connection. It is not a typed PostgreSQL or Supabase restore.

## Separate hosted restore gate

Before any production push, a fresh receipt must prove that the same authenticated backup set was restored into a different disposable Supabase project. The receipt is release-commit, source-project, target-project, backup-set, manifest-hash, schema-digest, data-digest, restore-job, and timestamp bound. It must prove the target differs from production and that Auth data, Storage metadata, typed schema, defaults, CHECK constraints, triggers, RLS policies, RPC definitions/ACLs, and logical data digests all passed. A PGlite row replay, a same-project reset, or an unsigned narrative does not satisfy this gate.

## Disaster-recovery recipe and hard limits

This artifact is a logical safety snapshot, not `pg_dump` and not a one-command production rollback.

If recovery is required:

1. stop application writes and preserve the damaged environment unchanged;
2. take an additional safety copy before attempting repair;
3. use the same Windows user and computer that created the DPAPI key, or a separately approved DPAPI recovery mechanism;
4. run the verifier above with the original external UUID and manifest SHA anchor;
5. create a new isolated PostgreSQL/Supabase recovery target; never point a first restore attempt at production;
6. reconstruct the typed schema at migration head `20260715210000` from the audited repository and migration history;
7. have a second engineer review a purpose-built typed importer that consumes the authenticated logical payload in memory;
8. load parent tables before child tables, validate exact row counts and canonical digests, then validate application-level invariants;
9. cut over only after independent acceptance; retain the old environment for rollback.

The current automated logical replay intentionally does **not** claim the following:

- exact PostgreSQL types, defaults, generated expressions, RLS policies, triggers, or CHECK constraints are replayed in PGlite;
- external foreign keys such as references to `auth.users` are restored;
- Storage objects or unrelated tables are present;
- the artifact is portable to another Windows user or computer without DPAPI recovery preparation;
- the snapshot can safely be imported directly into production.

The receipt reports `TypedSchemaReplayed: false` and `CheckConstraintsReplayed: 0` explicitly. These are honest boundaries, not passing claims. A real typed recovery importer is a separately reviewed emergency operation.

## Verification evidence

The 2026-07-17 guarded read-only production inventory was repeated and found the exact 14-table durable scope, including `vendor_reviews`, at migration head `20260715210000`. Its audited schema contract SHA-256 is `CE2A4D55024571C9491274F796C509384681D8026336573334C4BCA199EC6CE3`. The former 13-table contract and `414524...` digest are retired and cannot open the release gate.

The synthetic 14-table encrypted logical row replay test passes and verifies that `vendor_reviews` is captured and replayed without plaintext output. This proves implementation behavior, not a final production backup or hosted typed restore.

The final clean-commit production baseline artifact and the different-project hosted restore receipt are both **NOT RUN**. No previous self-test backup-set ID, local temporary path, or 13-table receipt may be reused. Production remains **NO-GO** until both fresh artifacts pass their independent gates.
