# Supabase recovery artifact contract

Recovery archive format v2 requires the encrypted
`operations/approved-cron-contract.json` artifact. A database dump and the
Supabase migration ledger do not preserve operational rows from `cron.job`, so
an archive without this artifact is incomplete and must be rejected.

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

Archive integrity verification may report the exact files and digests, but an
isolated restore must stop with `ARCHIVE_AUTHENTICITY_UNVERIFIED` until both
independent proofs are implemented and verified. Even mocked authenticity
evidence reaches a separate `RESTORE_EXECUTION_NOT_ENABLED` hard stop because
actual DB/Storage restore execution is intentionally not implemented yet.
