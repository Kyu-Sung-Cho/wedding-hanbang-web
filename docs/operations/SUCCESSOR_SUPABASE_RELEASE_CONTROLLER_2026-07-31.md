# Successor Supabase release controller contract

Date: 2026-07-31  
Contract sync: 2026-08-13
Release: `vendor-disclosure-v2-20260718`  
Current decision: **NO-GO**

## Current state

`supabase/release-manifests/vendor-disclosure-v2-20260718.json` remains
`deployment_blocked`. Its five deployment-evidence classes remain `missing`.
The ordered successor manifest now contains 87 migrations and ends at
`20260813103000_checklist_situation_profile_v2_gathering.sql`. The three
2026-08-12 checklist migrations and the 2026-08-13 situation-profile migration
are pinned repository contracts only; this sync did not query or apply them on
hosted Supabase. No current hosted pending-set query or apply receipt was
created by this sync. The normalized manifest SHA-256 is
`b5ed6b810493b7f3687121e9930b27900c8c2fd01b35bd518e3f919905b6a8dd` and the
ordered migration-version digest is
`a853199e0f00b33fbeca3a95a18ff5fba775b44e143d61c853f513aa685dff27`.
The work described here adds a fail-closed successor path to the Supabase
release controller, static/remote fence and exact-owner finalizer. It does not
change the manifest to `controller_ready`, create hosted evidence, run a remote
probe, write production data or authorize a web deployment.

The manifest is the only source of the successor migration set. The controller
and `supabase-release-fence.mjs --remote` must derive all of these values at
runtime:

- the exact ordered `expandMigrations` filenames and normalized SHA-256 values;
- `requiredRemoteHead`, which must equal the pinned predecessor migration head;
- the successor migration count, last migration version and version-set
  SHA-256.

No controller, fence, backup contract or finalizer may retain the predecessor's
27-migration list as the expected successor pending set. Adding or removing a
release-era migration without updating the manifest must fail static
verification. While the status is `deployment_blocked`, remote verification
and the production controller must stop before invoking Git, Supabase or a
backup verifier.

## The only future ready state

The successor validator accepts only two states:

1. `deployment_blocked`: exactly five evidence values are the string
   `missing`, and no controller contract is present.
2. `controller_ready`: the manifest hash-pins one separate controller contract
   under `supabase/release-contracts/`. Git contains evidence schemas and exact
   filenames, not a receipt claiming to verify itself.

The controller contract must bind the same release and project, exact current
remote backup, exact successor post-expand backup, read-only pre/post checks,
manual operations and rollbacks, exact-owner finalizer v2, required documents
and a forward-fix-only feature-off rollback. A partial third state and the old
`evidence_pinned` state are invalid.

Changing the manifest status is necessary but not sufficient. On every
successor controller invocation, all five structured receipts and their raw
provenance files must exist as one private sibling set outside Git:

| Evidence class | Required meaning | Maximum age |
| --- | --- | ---: |
| backup | verified encrypted database backup, exact baseline tables, provider physical backup and restore candidate | 30 minutes |
| storage | database/storage write fences, drained signed uploads, stable object inventory and original-byte backup | 30 minutes |
| hosted staging | exact migration set, pre/postconditions, read-only postchecks, rollback rehearsal and feature flags off | 24 hours |
| hosted restore | destructive restore to a different project, exact tables/data digests, Auth/Storage and read-only postchecks | 24 hours |
| finalizer | exact-owner lease, successor contract rendering, canary fence, feature-off rollback and finalizer rehearsal | 24 hours |

Every structured receipt has an exact schema. It binds the release, project,
expected commit, predecessor head, successor head/count/version digest,
post-apply check IDs/digest and canonical feature-off rollback digest. Every
required semantic check must be `true`. Class-specific observations must also
match the selected backup/table contract, isolated restore project, exact
staging migration digest, storage drain windows, or finalizer v2 and its exact
feature-off controls. Extra fields, `{ "verified": true }`, Git-relative
evidence, stale timestamps, commit drift, a missing raw file or a raw SHA-256
mismatch fail closed.

## Backup and restore boundaries

The predecessor's 14-table pre-Amora backup is not a valid successor baseline.
The successor pre-apply backup contract is version 2
(`hbam2-encrypted-current-user`) and must name the exact current remote table
set inherited from the predecessor's verified post-expand state. Its private
directory contains only the encrypted logical data, encrypted schema inventory,
their protected keys and `manifest.json`. The verification receipt and private
manifest must agree on:

- release commit and source project;
- pinned Supabase CLI version and binary SHA-256;
- backup set ID and manifest SHA-256;
- capture times and freshness;
- exact ordered table set/count;
- inventory, live-schema and logical-data contract digests;
- JSONB round-trip and canonical source-digest verification;
- `PlaintextWrittenToDisk=false`.

The pinned verifier is rerun from a clean checkout at the same exact commit and
origin. Its fresh result must match every immutable receipt field. A stale
14-table receipt, an extra artifact, a symlink, an unpinned verifier or an
altered private manifest is a hard NO-GO.

The post-expand backup is a separate version-2 contract. It binds the current
successor manifest's complete ordered migration version set, final migration
head, exact resulting table set, new capture/verifier artifacts and a
different-project hosted restore. Reusing the predecessor
`post-amora-engine-v2-27-table-backup` contract as the successor post-expand
contract is forbidden.

Every schema-qualified `CREATE TABLE public.*` declaration in the exact pinned
successor migration set is extracted during static validation. Each extracted
table must be present in the ordered post-expand backup/table contract; a
self-consistent count and digest that omits a newly created table still fails
closed. This includes `couple_plan_change_requests` and
`couple_plan_change_acceptances` from the final plan-change write-boundary
migration, plus `conversation_segments` from the additive segment foundation.
It also includes the ID-only
`amora_memory_enqueue_repair_candidates` transactional outbox, its ID-only
`amora_memory_enqueue_repair_dead_letters` terminal audit, and the
`amora_privacy_context_epochs` commit-fence table; omitting any of these tables
from post-expand backup/restore evidence is a hard failure.
The 2026-08-12 checklist set additionally creates
`couple_reset_checklist_scrub_claims` and
`couple_plan_change_disclosure_receipts`. Both tables must be present in the
derived post-expand backup, hosted-restore and finalizer table contracts. The
atomic checklist-v3 migration creates no table, but its version and SQL hash
remain part of the exact ordered migration contract and cannot be omitted. The
2026-08-13 situation-profile v2 migration also creates no table; its version
and SQL hash are nevertheless part of that same exact ordered contract.
Existing account-deletion tables remain inherited from the predecessor
post-expand baseline. `chat_messages` and `chat_summaries` remain existing
baseline tables, so their new nullable `segment_id` columns and scope foreign
keys are verified by the successor postcheck rather than counted as new backup
tables.

## Postchecks, rollback and finalization

At least one post-apply check must be successor-specific; inheriting only the
predecessor's checks is invalid. Checks are hash-pinned read-only SQL and must
return the exact bounded count evidence declared by the controller contract.
The successor semantic postcheck must prove the exact extracted-table count,
the inherited account-deletion Auth foreign-key contract, all four new
plan-change-to-Auth cascade foreign keys, the three new terminal event kinds,
and the exact successor migration head. It must also return
`wedding_court_auth_delete_fk_count=1` for the exact
`wedding_court_votes_user_id_fkey` Auth `ON DELETE CASCADE`,
`chat_feedback_auth_delete_fk_count=1` for the exact
`chat_feedback_user_id_fkey` Auth `ON DELETE CASCADE`, and
`payment_ledger_fk_contract_count=3` for the exact payment-ledger couple
`CASCADE` plus `created_by`/`updated_by` profile `SET NULL` constraints.
It must additionally prove exactly one partner-recipient insert policy, select
policy and enforcement trigger; two conversation-segment scope foreign keys;
three one-active-scope indexes; one segment SELECT RLS policy; and one exact
authenticated start-RPC ACL contract. These checks protect altered existing
tables and privileges that a new-table-only backup count cannot see.
Omitting any of these evidence fields prevents `controller_ready`.

Database migration rollback is prohibited after an ambiguous or completed
forward push. The rollback strategy is `forward-fix-feature-off` and must prove
all of the following controls in a fresh private receipt:

- `AMORA_AUXILIARY_MEMORY_ENABLED=false`
- `AMORA_CARE_OUTBOUND_ENABLED=false`
- `AMORA_COMMUNITY_AI_COMMENT_ENABLED=false`
- `AMORA_CONVERSATION_SEGMENT_READ_ENABLED=false`
- `AMORA_OPENAI_ENABLED=false`
- `AMORA_PROACTIVE_CHAT_ENABLED=false`
- `AMORA_COST_GUARD_ENABLED=true`
- `WEDDING_COURT_ENABLED=false`
- `WEDDING_PAYMENT_LEDGER_ENABLED=false`
- database and storage write fences still held
- Auth signup still disabled
- web write fence still enabled
- partner-recipient trigger/RLS boundary still held
- conversation-segment scope/RLS/RPC boundary still held

The segment flag controls only the future provider read switch. Forward-fix
rollback preserves already-written nullable `segment_id` audit data and never
removes the partner-recipient security boundary. The flag is also required by
the production environment gate, `.env.example`, local QA environment and
Turbo build inputs; exact `false` is mandatory for this additive expand
release.

The exact-owner finalizer selects the same successor controller contract. It
must not use the predecessor's fixed table or migration digests. SQL rendering,
backup/restore validation, external provenance and final database evidence all
use the selected successor post-expand contract's dynamic table and migration
digests. A blocked successor manifest prevents finalization.

The successful sequence is:

1. exact commit/origin/clean-worktree and linked-project fences;
2. fresh five-receipt private evidence set;
3. exact current-remote backup and fresh verifier replay;
4. isolated hosted restore and live write-fence evidence;
5. exact pending/ledger and read-only preconditions;
6. one forward push, followed by exact clean ledger and successor postchecks;
7. exact post-expand backup and different-project restore;
8. deployment/canary evidence while the lease and write fences remain held;
9. dynamic exact-owner finalization.

Any ambiguity after a write retains the lease/receipt and prohibits an
automatic rerun.

## Local verification

These commands verify repository-owned contracts only and do not constitute
hosted evidence:

```powershell
corepack pnpm supabase:release:test
corepack pnpm supabase:release:fence
```

Do not run direct `supabase db push`, do not create synthetic success receipts,
and do not change `deployment_blocked` until the separate controller contract,
all private raw evidence and every structured receipt have been reviewed for
the exact clean release commit.
