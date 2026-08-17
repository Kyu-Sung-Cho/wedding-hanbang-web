# Successor Supabase release controller contract

Date: 2026-07-31  
Contract sync: 2026-08-17
Release: `vendor-disclosure-v2-20260718`  
Current decision: **NO-GO**

## Current state

`supabase/release-manifests/vendor-disclosure-v2-20260718.json` remains
`deployment_blocked`. Its five deployment-evidence classes remain `missing`.
The ordered successor manifest now contains 101 migrations and ends at
`20260816170000_amora_booking_outcome_provenance.sql`.
The normalized-LF current manifest SHA-256 is
`8ed341c23f92ff96f6bb0059a2447c1bb39b4645b8b392c748018b1657b142dd`;
the terminal migration SHA-256 is
`9b673303585070facadb062d042c1cd23342cafe368612037571597ff72f5457`.

On 2026-08-15, a linked, read-only Production ledger audit observed:

- the manifest required head `20260716117000` exists remotely;
- 32 successor versions are already present as one exact ordered prefix,
  ending at `20260727090000`;
- no remote-only migration version exists.

Against the current 101-migration repository manifest, that observed prefix
leaves 69 local successor migrations pending, from `20260730100000` through
`20260816170000`. This suffix count is derived from the updated local manifest;
it is not a new 2026-08-16 Production ledger observation.

This proves migration-version continuity only. The old remote ledger rows have
no stored SQL statements, so it does not prove byte-for-byte equality of the
already-applied SQL. It is not hosted staging, backup, restore, storage, or
finalizer evidence. No migration repair, database push, or Production write was
performed. The existing manifest still names `20260716117000` as the required
remote head and therefore cannot be used as-is by the current release
controller against this observed Production baseline.

The repository now pins the observation boundary in
`supabase/release-contracts/vendor-disclosure-production-baseline-v1-20260815.json`
(normalized-LF SHA-256
`aec85a53a01e33a22ffab43424a6cfeff0b052775ae26c772f9c281c1f25b111`).
The successor manifest hash-pins that file. Static validation requires its 32
applied migrations to be the exact file/hash prefix of the 101-migration
manifest and its 69 pending migrations to be the exact suffix. Re-hashing a
semantically altered count, boundary, file, or migration hash is rejected.

This baseline contract still does not authorize the current release controller
to apply the suffix. The next controller tranche must consume the pinned
historical prefix, use `20260727090000` as the effective pre-apply head, create
a fresh current-remote backup contract that includes the schema effects of the
32 applied migrations, and keep the remaining 69 migrations as the only
ordered pending set. It must not rewrite Supabase migration history.

The read-only check is reproducible with:

```powershell
corepack pnpm supabase:release:baseline
```

It validates the linked project, rejects remote-only versions and successor
gaps, and emits only bounded counts and boundary versions. It performs only
`supabase migration list --linked`.

The work described here adds a fail-closed successor path to the Supabase
release controller, static/remote fence and exact-owner finalizer. It does not
change the manifest to `controller_ready`, create hosted evidence, run a remote
mutation, write production data or authorize a web deployment.

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
Existing account-deletion tables remain inherited from the predecessor
post-expand baseline. `chat_messages` and `chat_summaries` remain existing
baseline tables, so their new nullable `segment_id` columns and scope foreign
keys are verified by the successor postcheck rather than counted as new backup
tables.

The deterministic first-use proposal and terminal application migrations, the
provider-backed exact add-action application migration, and the atomic-action
href/whitespace parity migration create no table, so they do not enlarge the
post-expand backup table set. The first three add
`finalize_amora_first_use_action_proposal_v1(uuid,uuid,uuid,text,integer,bigint)`,
`finalize_amora_first_use_action_application_v1(uuid,uuid,uuid,uuid,text,integer,bigint)`,
and
`finalize_amora_provider_backed_add_action_application_v1(uuid,uuid,uuid,uuid,text,integer,bigint)`.
For each finalizer, the successor semantic postcheck must prove exactly one
security-definer, Postgres-owned function with execute denied to `anon` and
`authenticated` and granted only to `service_role`.

The terminal parity migration updates only the existing atomic dispatcher. Its
semantic postcheck must separately prove that the private dispatcher is
Postgres-owned, security-definer and executable by no client or service role;
that the public wrapper remains Postgres-owned, security-definer and executable
only by `service_role`; and that the live private definition contains the exact
`/wedding/chat` MC/gift fallback plus the canonical title/description
whitespace rules, with every retired fragment absent. Omitting any finalizer
ACL, dispatcher ACL or href/whitespace postcondition evidence keeps the release
blocked.

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
tables and privileges that a new-table-only backup count cannot see. The same
postcheck must return exactly one provider-backed add-action finalizer ACL
contract, one private dispatcher ACL contract, one public dispatcher ACL
contract, and one href/whitespace parity contract.
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
corepack pnpm supabase:release:baseline
```

The baseline command is the only command above that contacts Production, and it
is read-only. It is not a deploy receipt. Do not run direct `supabase db push`,
do not run `supabase migration repair`, do not create synthetic success
receipts, and do not change `deployment_blocked` until the separate controller
contract, all private raw evidence and every structured receipt have been
reviewed for the exact clean release commit.
