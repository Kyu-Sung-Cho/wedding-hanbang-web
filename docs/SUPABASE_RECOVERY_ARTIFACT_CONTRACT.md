# Supabase recovery artifact contract

Recovery archive format v2 requires the encrypted
`operations/approved-cron-contract.json` artifact. A database dump and the
Supabase migration ledger do not preserve operational rows from `cron.job`, so
an archive without this artifact is incomplete and must be rejected.

The checked-in exporter is currently a non-executable Phase-A design:
`export` fails with `RECOVERY_EXPORT_NOT_ENABLED` before credentials or Git are
inspected. An exact-target producer, filter-free worktree attestation, signed
backup lifecycle, and disposable rehearsal must be implemented and independently
reviewed before this contract may create a real archive.

The artifact contains exactly five approved jobs. Each job contains only
`jobName`, `schedule`, `command`, and the desired final `active` state. It does
not copy a source `jobid`, database name, host, or port into the target.

Portability does not mean ignoring execution identity. The top-level
`executionEnvironment` records a fail-closed semantic contract instead of
source-specific values:

- `cron.launch_active_jobs=off` and zero running jobs during capture and restore
  pre-activation;
- `cron.timezone=GMT` so the schedules retain their intended wall-clock meaning;
- every source and target job uses the approved `postgres` scheduler role;
- every job database equals `current_database()` on that environment.

The database name is deliberately rebound to the isolated target. Username and
timezone are validated because changing either can change permissions or run
time. Host and port remain managed target transport details and are neither
copied nor treated as authorization evidence.

Export queries the source twice and fails if either snapshot is absent,
duplicated, changed, active outside the global fence, still running, or
different from the checked-in contract. An additional source or restore-target
cron job is unapproved and also fails the contract; the recovery tool never
deletes an unexplained job to force a pass.

A future isolated restore must execute these steps in order:

1. Set `cron.launch_active_jobs=off` and prove running cron jobs are zero.
2. Restore the database and migration ledger.
3. Restore Storage metadata and object bytes.
4. Unschedule only approved names and recreate all five jobs with
   `schedule_in_database(..., current_database(), 'postgres', false)`.
5. While the launcher and every job remain inactive, run the exact post-deploy
   contract and prove definitions, database binding, role, timezone, and drain
   state.
6. Verify database/Storage parity and measured RTO.
7. In a separate activation step, change the five exact jobs to active, verify
   their rows while the launcher is still off, then enable the launcher.
8. Run the exact post-activation contract.

No cleanup or reconciliation cron can run in steps 1-6. The generated replay
SQL contains no launcher-enable or `active=true` operation. The activation SQL
has a separate checked-in SHA-256 contract and is not called by the current
restore runner.

Missing replay evidence, a pre-replay post-deploy check, or a cron-contract hash
mismatch forbids `restored` status. Passing those checks still does not make an
artifact release-eligible or produce `restored` status while the restore runner
and completion attestation remain intentionally disabled.

## Evidence identity and chain

Every modeled restore evidence item is bound to one canonical identity containing
the restore-attempt UUID, artifact UUID, encrypted archive SHA-256, source and
target project refs, target database, source Git SHA, source/restore timestamps,
database snapshot SHA-256, and Storage metadata/count/byte totals. The identity
has a canonical SHA-256. Database restore, Storage restore, inactive cron replay,
post-deploy recheck, parity, and RTO evidence form an ordered SHA-256 chain.

An otherwise valid item from another artifact, target, or attempt is rejected.
Timestamps must be monotonic, parity must repeat the archive-bound database and
Storage digests, and RTO must equal the measured start/completion interval. This
hash chain provides structural integrity, not producer authenticity; the final
`RESTORE_COMPLETION_ATTESTATION_NOT_ENABLED` hard stop remains in place.

## Authenticity gate

age recipient encryption provides confidentiality and archive integrity after
decryption, but by itself does not prove who produced an archive. The checked-in
`backupPolicy.archiveAuthenticity` therefore remains explicitly blocked until
the business approves both sender-signing-key custody and an external immutable
anchor provider/reference. No signing key or external anchor is generated or
uploaded by the recovery tool.

`verify-archive` requires an explicit trusted `--expected-project-ref`. The
public manifest can never select production/non-production tool policy, and
both public and encrypted private manifests must match the trusted ref. The ref
must also be a checked-in protected production or approved non-production
source. This prevents an attacker-controlled manifest from downgrading a
production archive to unpinned local `age`/`tar` tooling.

The encrypted archive pathname is never hashed and then reopened by `age`.
Verification accepts one bounded regular file with no links, copies and hashes
that fixed file identity into the private secure workspace, streams the same
open staged handle to `age` over stdin, and rehashes the handle afterward. A
rename or replacement of the caller-controlled pathname therefore cannot bind
one public digest to different decrypted bytes.

Archive integrity verification reports only
`verificationScope=encrypted-archive-self-consistency-v1` and
`archiveSelfConsistencyVerified=true`. Until sender authenticity and the
external immutable anchor are implemented it returns `ok=false`,
`producerAuthenticityVerified=false`, `restoreEligible=false`, and
`releaseEligible=false`; the CLI also exits nonzero. Consumers must never interpret
`archiveIntegrityVerified` alone as restore approval.

The checked-in policy separates `backupPolicy.rehearsalStatus` from the
production `backupPolicy.status`. An isolated target may be allowlisted only
after rehearsal status is explicitly `approved-v1`; this does not claim
production recovery readiness. A strict policy validator rejects malformed,
coercible, duplicate, or overlapping production/source/restore refs. Until a
trusted rehearsal producer binds the exact source, target, artifact, provider
recovery point, RPO/RTO measurement, signer, and immutable anchor, it also
rejects every `rehearsalStatus=verified-v1`, production `status=verified-v1`,
or archive-authenticity `status=verified-v1` declaration.

Even mocked authenticity evidence reaches a separate
`RESTORE_EXECUTION_NOT_ENABLED` hard stop because actual DB/Storage restore
execution is intentionally not implemented yet. The modeled evidence chain
also still ends before bound cron activation, post-activation verification,
restored-service canary, and provider-backed RPO proof. The final completion
hard stop must remain until those trusted producers and a disposable restore
rehearsal exist.
