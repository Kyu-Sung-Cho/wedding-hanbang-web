# Amora pending migration lock audit (2026-07-17)

## Decision

The production migration ledger is read-only verified through
`20260715210000`. The repository currently contains exactly **27** ordered
pending files from `20260716090000` through `20260716117000` (there is no 1010
file, so numeric continuity must never be inferred). No production write or
deployment was performed during this audit.

Final immutable release SHA and final manifest hashes: `NOT FROZEN`. The count
and names below describe the current candidate only; they are not authorization
to apply it.

The current production data volume is small enough for the bounded migration
statements below, but estimated row counts are not a substitute for the
duplicate checks, verified backup, different-project hosted restore rehearsal,
and destination fence. The release must remain blocked until every gate in this
document passes on a fresh capture.

## Read-only production snapshot

Captured with `supabase migration list --linked` and
`supabase inspect db table-stats --linked` on 2026-07-17. Values are PostgreSQL
planner estimates and can drift.

| Existing table | Estimated rows | Total size | Relevant pending migration |
| --- | ---: | ---: | --- |
| `ai_interactions_log` | 1,483 | 2,056 kB | 0970, 1160 |
| `decision_nodes` | 659 | 648 kB | 0900, 1090 |
| `chat_messages` | 614 | 1,048 kB | 0940 |
| `wedding_journeys` | 50 | 384 kB | 0930, 0990 |
| `couples` | 55 | 80 kB | 0940 |
| `profiles` | 49 | 88 kB | 0910, 0930, 0950 |
| `chat_summaries` | 16 | 176 kB | 0900 |
| `vendor_bookings` | 18 | 160 kB | 1020 |
| `amora_chat_request_claims` | 21 | 48 kB | 0960, 1100 |
| `amora_turn_counters` | 12 | 64 kB | 0970 |
| `amora_tool_executions` | 4 | 48 kB | 0960, 1100 |
| `vendor_reviews` | 0 | 32 kB | 1090 |

`amora_care_*`, `amora_memory_*`, `booking_projection_jobs`,
`amora_conflict_check_claims`, `community_upload_sessions`,
`account_deletion_jobs`, and `account_deletion_media_manifest` are introduced
by the pending release and were not present in the production table-stat
snapshot.

## Migration-by-migration result

| Version | Existing-table work | Conservative result |
| --- | --- | --- |
| 0900 | Nullable columns, three validated constraints, decision/chat-summary indexes | Replacements are built before obsolete draft indexes are removed. Lock and statement timeouts are bounded. Duplicate summary cursor check remains fail-closed. |
| 0910 | Profile column/default and consent reset | Reset now updates only legacy `true + NULL consent timestamp` rows, not every profile. |
| 0920 | Mediation table compatibility cleanup | New in production. Preview compatibility checks are added `NOT VALID`, validated under a write-compatible lock, then columns become `NOT NULL`. |
| 0930 | Journey scan index, profile mismatch repair/check | Profile update touches only inconsistent rows. The check is validated separately. The journey index is non-concurrent and therefore requires the low-traffic gate. |
| 0940 | Couple roster seal backfill | Historical shared-chat evidence is aggregated once with a materialized CTE instead of rescanning chat per couple. Care-table repair affects newly introduced tables in production. |
| 0950 | Care policy convergence | Explicit `LOCK TABLE ... ACCESS EXCLUSIVE` statements were removed. Ordinary `ALTER TABLE` still takes brief PostgreSQL-managed locks and remains timeout-gated. |
| 0960 | Claim/execution columns and partial unique index | The message FK is added `NOT VALID` and validated separately. The partial index scans a currently small table. |
| 0970 | Cost columns/checks and provider receipt index | Added missing top-level 5-second lock and 60-second statement limits. Both existing-table checks use `NOT VALID` then `VALIDATE`. |
| 0980 | Function replacement only | No table rewrite or index build. |
| 0990 | Journey non-null and uniqueness | Null check is validated before the brief `SET NOT NULL`. The unique index is built with `SHARE` lock before metadata-only constraint attachment, avoiding an index build under `ACCESS EXCLUSIVE`. |
| 1000 | Function replacement only | No release-time table rewrite or index build. |
| 1020 | New outbox, booking trigger, booking backfill | Added top-level lock/statement limits. Current estimate is 18 bookings; exact count and different-project hosted migration rehearsal are still required. |
| 1030 | New conflict-claim table | New-table DDL only. |
| 1040–1070 | Function replacements | No release-time table rewrite or index build. |
| 1080 | New upload-session table | New-table DDL only. Storage platform operation remains a separate prerequisite. |
| 1090 | Duplicate retirement and two unique indexes | `vendor_reviews` is currently estimated at zero rows. `decision_nodes` duplicate count must be checked exactly; the migration intentionally preserves but retires older duplicates. |
| 1100 | Claim/execution columns and checks | Both checks use `NOT VALID` then `VALIDATE`; no full validation under the initial column-add lock. |
| 1110 | Upload lifecycle columns, checks, indexes | Incompatible partial-rollout completed rows fail closed. All checks use `NOT VALID` then `VALIDATE`. Non-concurrent indexes require the empty/new-table preflight. |
| 1120 | Atomic tool-dispatch function replacement | No table rewrite or index build. The wrapper preserves the audited legacy implementation for its original mutation kinds and owns the remaining domain writes plus ledger completion. |
| 1130 | New account-deletion job and media-manifest tables | New-table DDL, RLS, indexes, and service-only RPCs. Hosted Storage/CDN behavior and the worker cron remain separate release gates. |
| 1140 | Current-couple stale-slot repair, authorization functions, and unique indexes | Existing rows are preserved. Only slots whose profile backlink no longer matches are cleared; a bounded row-count contract and postconditions fail closed on unexpected deltas. The exact different-project hosted restore and migration rehearsal remains mandatory. |
| 1150 | Expired rate-limit cleanup, reset index, and limiter replacement | Deletes only already-expired buckets and refuses more than 1,000 candidates. The current read-only audit found seven expired rows, but the fresh pre-write count remains authoritative. |
| 1160 | AI-log retention function replacement | No function execution and no row mutation occur in the migration. It pins an empty `search_path`, fully qualified update, exact 90-day input, `postgres` owner, and service-only execution with structural and ACL postconditions. |
| 1170 | Auth-deletion FK convergence and exact 48-FK inventory | The three retained couple/chat identifiers become nullable, validated `ON DELETE SET NULL` references so Auth deletion anonymizes history; vendor ownership remains a validated `ON DELETE RESTRICT` blocker. The migration validates replacements before dropping predecessors, keeps 5-second/60-second limits, and fails closed unless every reviewed public Auth FK has its exact name, column, action, nullability, and validation state. |

## Mandatory pre-write gates

1. Confirm the linked destination is exactly the production project ref through
   the service-role destination fence. A URL/key mismatch is a hard stop.
2. The current candidate is the exact 27-file set represented by rows
   0900–1170 in the table above. A release owner must explicitly freeze the
   complete SQL/document/controller set and immutable commit before generating
   the final signed manifest. Until then record `NOT FROZEN`, not a branch HEAD
   or provisional hash. After freeze, verify every SHA-256 and basename/order
   against the manifest; if any migration or required document changes, discard
   the old manifest hashes and freeze the complete set again.
3. Capture a fresh logical backup and verify its inventory/checksums. Run the
   authenticated local PGlite logical row replay as a payload-integrity check,
   but do not label it a restore rehearsal. Separately restore the same backup
   set into a different disposable hosted Supabase project and verify typed
   schema, defaults, checks, triggers, Auth and Storage metadata, RLS, RPC/ACL,
   row counts, and canonical digests. A local-only replay or same-project reset
   cannot open the write gate.
4. Run exact, read-only duplicate/orphan checks immediately before the write:

   ```sql
   select couple_id, visibility, to_message_id, count(*)
   from public.chat_summaries
   where to_message_id is not null
   group by couple_id, visibility, to_message_id
   having count(*) > 1;

   select couple_id, count(*)
   from public.wedding_journeys
   group by couple_id
   having couple_id is null or count(*) > 1;

   select booking_id, customer_id, count(*)
   from public.vendor_reviews
   where booking_id is not null and customer_id is not null
   group by booking_id, customer_id
   having count(*) > 1;

   select couple_id, source_ref_id, source, decision_type, count(*)
   from public.decision_nodes
   where source = 'vendor_booking'
     and decision_type = 'completed'
     and source_ref_id is not null
   group by couple_id, source_ref_id, source, decision_type
   having count(*) > 1;
   ```

5. Keep `AMORA_CARE_OUTBOUND_ENABLED=false`, auxiliary memory generation off,
   and community AI comment generation off until their post-migration canaries
   have passed independently.
6. Rehearse the exact pending migration chain against the different-project
   hosted restore target. Record per-migration duration, resulting
   constraints/indexes, and row deltas. Any timeout or unexpected row delta is
   a hard stop.
7. Schedule the production write for a low-traffic window. Confirm no blocking
   or long-running transactions immediately before execution. Do not raise the
   5-second lock timeout merely to force the release through.
8. After migration, run schema/RLS/RPC verification and application smoke tests
   before enabling traffic-dependent features. Keep the rollback and restore
   commands ready through the canary window.

## Automated regression guard

`apps/web/src/lib/ai/__tests__/amoraMigrationLockSafety.test.ts` prevents:

- explicit `ACCESS EXCLUSIVE` table-lock statements in the pending chain;
- missing top-level lock/statement limits on migrations that alter or backfill
  tables and on the AI-log retention contract migration;
- validation of named existing-table constraints under their initial add lock;
- regression to a full-profile consent rewrite; and
- building the journey uniqueness contract directly under `ALTER TABLE`.

This static guard checks SQL shape. It does not replace the local logical row
replay, the different-project hosted restore rehearsal, or the final read-only
production preflight.
