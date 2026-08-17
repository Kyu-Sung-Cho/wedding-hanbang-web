# Successor Supabase release controller contract

Date: 2026-07-31  
Contract sync: 2026-08-18
Release: `vendor-disclosure-v2-20260718`  
Current decision: **NO-GO**

## Current state

`supabase/release-manifests/vendor-disclosure-v2-20260718.json` remains
`deployment_blocked`. Its five deployment-evidence classes remain `missing`.
The ordered successor manifest now contains 104 migrations and ends at
`20260818100000_restore_signup_profile_trigger.sql`.
The normalized-LF current manifest SHA-256 is
`0138c050d1b9d573433304747a954026d3e21245b46519b74d167be22892c15c`;
the terminal migration SHA-256 is
`16fa1a4af7832c69e937faeaff7f88115699e377e1445f9c4cdc524b86f4a53a`.

On 2026-08-15, a linked, read-only Production ledger audit observed:

- the manifest required head `20260716117000` exists remotely;
- 32 successor versions are already present as one exact ordered prefix,
  ending at `20260727090000`;
- no remote-only migration version exists.

Against the current 104-migration repository manifest, that observed prefix
leaves 72 local successor migrations pending, from `20260730100000` through
`20260818100000`. This suffix count is derived from the updated local manifest;
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
`4d17746a7a3c3d60516332bb9c927d261fa21c6251621f56e3b9b403c7221958`).
The successor manifest hash-pins that file. Static validation requires its 32
applied migrations to be the exact file/hash prefix of the 104-migration
manifest and its 72 pending migrations to be the exact suffix. Re-hashing a
semantically altered count, boundary, file, or migration hash is rejected.

This baseline contract still does not authorize the current release controller
to apply the suffix. The next controller tranche must consume the pinned
historical prefix, use `20260727090000` as the effective pre-apply head, create
a fresh current-remote backup contract that includes the schema effects of the
32 applied migrations, and keep the remaining 72 migrations as the only
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

The atomic-action parity migration updates only the existing atomic dispatcher. Its
semantic postcheck must separately prove that the private dispatcher is
Postgres-owned, security-definer and executable by no client or service role;
that the public wrapper remains Postgres-owned, security-definer and executable
only by `service_role`; and that the live private definition contains the exact
`/wedding/chat` MC/gift fallback plus the canonical title/description
whitespace rules, with every retired fragment absent. Omitting any finalizer
ACL, dispatcher ACL or href/whitespace postcondition evidence keeps the release
blocked.

The terminal neutral-preparation-space migration also creates no table. It adds
the constrained `couples.member_model_version` compatibility marker, a guarded
one-way upgrade trigger, an authenticated create RPC, and a service-role-only
join RPC. Hosted postchecks must prove both exact RPC ACLs and the live
column/constraint/trigger contract. The role-bearing compatibility slots remain
internal storage details and neither neutral RPC may return a public `role`.

The preparation catch-up migration creates exactly two service-only tables and
one service-role-only atomic finalizer. It stores at most three explicitly
confirmed user reports without changing checklist completion or asserting
vendor, contract, payment, or booking truth. Hosted postchecks must prove the
finalizer ACL and the private decision policy's exact `actor_profile_id =
auth.uid()` binding so a later occupant of the same compatibility role cannot
inherit the earlier user's private report.

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
contract, one href/whitespace parity contract, two neutral preparation-space RPC
ACL contracts, one neutral member-model column/constraint/trigger contract, one
preparation catch-up finalizer ACL contract, and one private actor-binding contract.
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
- `AMORA_NEUTRAL_PREPARATION_SPACE_ENABLED=false`
- `EXPO_PUBLIC_AMORA_NEUTRAL_PREPARATION_SPACE_ENABLED=false`
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

<!-- AMORA:PENDING-SCOPE-CLASSIFICATION:BEGIN -->

## Pending successor scope classification — 2026-08-18

이 표는 72개 ordered suffix를 선택 적용하기 위한 목록이 아니다. 모든 행은 같은 순서로 격리 staging에 적용해야 하며, `disposition`은 **제품 완료 주장과 probe 책임**만 구분한다. `active_dependency`는 현재 아모라 vertical이 직접 사용하고, `integrity_hardening`은 현재/parked 표면의 무결성 경계이며, `unrelated_feature_off`는 migration은 적용하되 명시 flag를 계속 끄고, `parked_product_surface`는 schema·ACL만 검증하고 소비자 기능 완료로 세지 않는다.

| migration | SHA-256 | primary owner | disposition | runtime flag boundary | required hosted probe |
|---|---|---|---|---|---|
| `20260730100000_retire_undisclosed_community_agents.sql` | `51e3cd08f2b2e69d45c02861b97dc99a155e69bbe858426ab09c044d43c95868` | `AMR-C10` | `integrity_hardening` | `always_on` | `hosted:integrity-postcheck` |
| `20260730101000_quote_check_explicit_consent.sql` | `f9ab7b5f04a16a4a13c11c709ef29b41851afe16897bedd1aaf9e97bf0a3b5f5` | `AMR-D11` | `integrity_hardening` | `always_on` | `hosted:integrity-postcheck` |
| `20260730102000_amora_shared_action_approval_and_notifications.sql` | `f4e242bb3c3bfaeda284830a548c8d798f4c0f26aaa029014688d800d677d857` | `AMR-D14` | `active_dependency` | `always_on` | `hosted:mutation-replay` |
| `20260731123000_couple_plan_change_write_boundary.sql` | `78558fed4cc693ca9ac204be7a401ff4ee4451b42534bc70b8b55d4129a6e7db` | `AMR-D03` | `active_dependency` | `always_on` | `hosted:mutation-replay` |
| `20260731170000_amora_personalization_preferences.sql` | `3abe9a147276e30f6a3811d6dd98dd80bee54c10a49781ea900b1b7096ee3bb7` | `AMR-P01` | `active_dependency` | `always_on` | `hosted:personalization-rls` |
| `20260731173000_private_chat_hard_delete_boundary.sql` | `bf2333a9d5b29d7d1d04a6dff52747a20b8920e1e9b4df1bae655e34872d09c7` | `AMR-M03` | `integrity_hardening` | `always_on` | `hosted:privacy-rls` |
| `20260731174000_amora_privacy_context_snapshot.sql` | `7969c9885c428091601fbda6aa085ece3ba6c3a41a1371ab370013369564f86c` | `AMR-P02` | `active_dependency` | `always_on` | `hosted:privacy-rls` |
| `20260731180000_community_release_trust_boundary.sql` | `31f5e100c7a0bbdda39e1e2aaee7e8ddc3f62be504ebb9eb3e2f70f7482276c5` | `AMR-C10` | `integrity_hardening` | `always_on` | `hosted:integrity-postcheck` |
| `20260731181000_community_reply_notifications.sql` | `186d53d6647f5230bee2a7df806172503a1ff32c32e4806cf512df7960c3eb3c` | `AMR-L15` | `parked_product_surface` | `COMMUNITY_REPLY_PUSH_DELIVERY_ENABLED=false` | `hosted:parked-acl` |
| `20260731182000_cohort_moderation_audit_boundary.sql` | `b1b6520332d53a791dbb132a67de2ea86e8ac2e636256ac8c752462264639e18` | `AMR-C10` | `parked_product_surface` | `always_on` | `hosted:parked-acl` |
| `20260731183000_community_operational_health.sql` | `aac22518fbe9d9b974d3f0f276f872621f2ed9e7222497da61a3155f785385e9` | `AMR-C10` | `integrity_hardening` | `always_on` | `hosted:integrity-postcheck` |
| `20260731184000_amora_tone_style.sql` | `97970d2259b7b8167998a061dba0b40ff93e0d979e407c9d2a7df8228dda7634` | `AMR-P01` | `active_dependency` | `always_on` | `hosted:personalization-rls` |
| `20260731185000_community_api_only_write_boundary.sql` | `17a3e0f43fc0ec3a5143f86e8844a83a5ad1e366c51083e7a8a10ec6c8e54956` | `AMR-C10` | `integrity_hardening` | `always_on` | `hosted:integrity-postcheck` |
| `20260731190000_wedding_court_safe_mvp.sql` | `f1a56e18861310d6b824d3e1882a6d0972351508622dd545b04ef01f2b870a12` | `AMR-C10` | `unrelated_feature_off` | `WEDDING_COURT_ENABLED=false` | `hosted:feature-off` |
| `20260731191000_wedding_payment_ledger.sql` | `99f2c63dbaaf604ddc58d96462453e96c7c866a431e2371db50455ab1a6db52c` | `AMR-D11` | `unrelated_feature_off` | `WEDDING_PAYMENT_LEDGER_ENABLED=false` | `hosted:feature-off` |
| `20260731192000_chat_feedback_account_delete_cascade.sql` | `006650056787fbaa49fc4fa35fe53e6d4c94cd841e3e4edaa3c732fc9c02e75f` | `AMR-D15` | `integrity_hardening` | `always_on` | `hosted:integrity-postcheck` |
| `20260801090000_amora_chat_delivery_safety.sql` | `d65db3bb8f89c8806683244aea5aabe9239d289de8a0dbb71df2d71cb3905a36` | `AMR-D14` | `active_dependency` | `always_on` | `hosted:mutation-replay` |
| `20260801100000_amora_conversation_segments.sql` | `03f2b4ac8100af621912831f286f92a4ca5984b5a219500a09b85bfe3d722075` | `AMR-M04` | `unrelated_feature_off` | `AMORA_CONVERSATION_SEGMENT_READ_ENABLED=false` | `hosted:feature-off` |
| `20260802090000_amora_moment_care_source_revision.sql` | `92aab48ceee3cdef5eb577b8afde40adb34f439834c5db66ed5c7ff118ee719d` | `AMR-L15` | `unrelated_feature_off` | `AMORA_CARE_OUTBOUND_ENABLED=false` | `hosted:feature-off` |
| `20260802100000_amora_shared_schedule_decision_receipts.sql` | `df1d499c14474ac54a6021f983498d29ef554fafe5f56a2c0bbc81e4804a7d1e` | `AMR-D01` | `active_dependency` | `always_on` | `hosted:mutation-replay` |
| `20260802110000_amora_shared_schedule_approval_policy.sql` | `a6a79c7c4bed55be85c02595ac4764492ce8d57665b3a1e5744d18bd0561dca6` | `AMR-D14` | `active_dependency` | `always_on` | `hosted:mutation-replay` |
| `20260802120000_amora_conversation_segment_dual_write.sql` | `12cd3386ca80087fc8ff9dfa73e92f1cc9da2e80d05b49eb5cbb47ad1255b6bc` | `AMR-M04` | `unrelated_feature_off` | `AMORA_CONVERSATION_SEGMENT_READ_ENABLED=false` | `hosted:feature-off` |
| `20260802130000_amora_in_app_today_one.sql` | `56cf25d5b8441c1d282e0ca8721e60c8ca3c05ca0a41d641720e33038b50be2a` | `AMR-L11` | `unrelated_feature_off` | `AMORA_TODAY_ONE_ENABLED=false` | `hosted:feature-off` |
| `20260802140000_amora_manual_schedule_fairness.sql` | `2e003f2772551d3d22b7d8b24344f815062152cd105a42c8f0606f2d9b226198` | `AMR-D14` | `active_dependency` | `always_on` | `hosted:mutation-replay` |
| `20260802150000_amora_today_one_budget_guardrails.sql` | `30b50a0ab2994758fbc5e025f213ee7b7757b620f43f43b3636f0d2da2b5ab91` | `AMR-L11` | `unrelated_feature_off` | `AMORA_TODAY_ONE_ENABLED=false` | `hosted:feature-off` |
| `20260802160000_booking_quote_spend_soft_cancel.sql` | `e2c3b5b95d5993ba217feb5ec743357dbdd0ddd8580bddfeae8fc98b200a5afb` | `AMR-R02` | `integrity_hardening` | `always_on` | `hosted:booking-integrity` |
| `20260802170000_amora_shared_action_roster_binding.sql` | `b1e212984f4ecb99095042b38ca877b0b593d0c490986e03edb24280d0804a80` | `AMR-D15` | `active_dependency` | `always_on` | `hosted:mutation-replay` |
| `20260802180000_community_cohort_assignment_atomic.sql` | `ba6bd8223d857ea0baa4b8647c95953b892071bfacbbb501c0e131784ef01689` | `AMR-C10` | `parked_product_surface` | `always_on` | `hosted:parked-acl` |
| `20260802190000_community_idempotent_writes.sql` | `741d967d43a369d770f83b121eb501ffe623e0a9b861c7228e8be684ca5dc9b3` | `AMR-C10` | `integrity_hardening` | `always_on` | `hosted:integrity-postcheck` |
| `20260802200000_journey_budget_progress_integrity.sql` | `62e5655627fbc9dc4f7e41347404311a3c9091f7741f2007fb38862fd7fef665` | `AMR-D03` | `active_dependency` | `always_on` | `hosted:mutation-replay` |
| `20260802210000_amora_conversation_segment_roster_repair.sql` | `433248852f800553c94dec00ed9616b3854acd5cbc5e8cebd3bec465a82e4cf2` | `AMR-M04` | `unrelated_feature_off` | `AMORA_CONVERSATION_SEGMENT_READ_ENABLED=false` | `hosted:feature-off` |
| `20260802220000_amora_memory_enqueue_repair.sql` | `4dff9c7545446dc6b459089c2a52b28c2c57f2834fb658af1ec541012b0e7db7` | `AMR-M04` | `unrelated_feature_off` | `AMORA_AUXILIARY_MEMORY_ENABLED=false` | `hosted:feature-off` |
| `20260802230000_amora_atomic_privacy_epoch.sql` | `79e824442deb0f20582d1659e05a05c23ec564c249a3bdab0b3f1e8a9a1fb490` | `AMR-D14` | `active_dependency` | `always_on` | `hosted:privacy-rls` |
| `20260802240000_amora_memory_job_recovery.sql` | `f673b63550bbce8561ccd23fc7e5ec161627b5dc0ddbed8fed49a049adc7f0d4` | `AMR-M04` | `unrelated_feature_off` | `AMORA_AUXILIARY_MEMORY_ENABLED=false` | `hosted:feature-off` |
| `20260804103000_community_report_resolution_atomic.sql` | `23b938edae10e03784cc13b80c61b10461f61b931bbd6d3921ed1889b0e31c1c` | `AMR-C10` | `integrity_hardening` | `always_on` | `hosted:integrity-postcheck` |
| `20260804120000_community_profile_guestbook_p0_hardening.sql` | `b837cc2ef7d3ce2c10892de61b0882666e919a2d452d7c1e4039400477703658` | `AMR-C10` | `integrity_hardening` | `always_on` | `hosted:privacy-rls` |
| `20260804130000_community_runtime_control.sql` | `0a7ccd82712051d5b1c1cab13090b071be107ecb8eee25d9f1d090b491337eb8` | `AMR-C10` | `integrity_hardening` | `always_on` | `hosted:integrity-postcheck` |
| `20260804140000_community_responder_supply_foundation.sql` | `82ae239c80cd19ab246280d5fd2005eb5815631e833c4816b855f1a5abc136d1` | `AMR-C10` | `parked_product_surface` | `always_on` | `hosted:parked-acl` |
| `20260804150000_community_comment_service_write_boundary.sql` | `e06b8ee5c9e74c2f5c9ad2881cd0939fcab66f4fd02cbaaefdfa6effd50aa5a1` | `AMR-C10` | `integrity_hardening` | `always_on` | `hosted:integrity-postcheck` |
| `20260804160000_community_poll_set_intent.sql` | `9cc8af04fa086ef34d8650bd50f1c6612338de094594b5b0f3628bef32771a07` | `AMR-C10` | `parked_product_surface` | `always_on` | `hosted:parked-acl` |
| `20260804170000_notification_session_ownership.sql` | `3d4d6b78e4dbbac83244b05ea4930cf3d98e91d425b6450e615c30d97f77751c` | `AMR-L15` | `integrity_hardening` | `always_on` | `hosted:integrity-postcheck` |
| `20260804180000_community_viewer_controls.sql` | `bbf8c4208ce48280d35b55087696072d1435678eee728f48a0e70c16ebb89b97` | `AMR-C10` | `integrity_hardening` | `always_on` | `hosted:privacy-rls` |
| `20260804185000_notification_delivery_outbox.sql` | `d58f91f3ccc4fc9965e60d8de876187a95ad797aaf5773374b8a175d37abe1a2` | `AMR-L15` | `unrelated_feature_off` | `COMMUNITY_REPLY_PUSH_DELIVERY_ENABLED=false` | `hosted:feature-off` |
| `20260804190000_community_decision_thread_vertical.sql` | `7f7e9288a6333b7358af6b02f189c9f1d6df885e34962764f3b6a2b387351a55` | `AMR-C10` | `parked_product_surface` | `always_on` | `hosted:parked-acl` |
| `20260804193000_community_decision_feed_read.sql` | `5965c8118b0e5030339d9ad10dbb36d34e5b87f98f4bb833d5a23c6dd37e5400` | `AMR-C10` | `parked_product_surface` | `always_on` | `hosted:parked-acl` |
| `20260804194000_community_decision_outcome_review.sql` | `60867720f77ed6d763fa5015bd414b2778a3e5be416f0927a3d115fab07def83` | `AMR-C10` | `parked_product_surface` | `always_on` | `hosted:parked-acl` |
| `20260804195000_community_decision_public_outcome_read.sql` | `8367f384e95da3ba758759cd3f5ee5443c633dcdfcf33c1180e931a0e2f2c007` | `AMR-C10` | `parked_product_surface` | `always_on` | `hosted:parked-acl` |
| `20260804200000_community_post_service_write_boundary.sql` | `3671f4d1878889b05eaad419354b35f311d2ac27757ed557a5b0580e31d57afc` | `AMR-C10` | `integrity_hardening` | `always_on` | `hosted:integrity-postcheck` |
| `20260805120000_amora_log_wedding_event_couple_approval.sql` | `74f7e8109eafb3a1983f652436407b4d801b06ab21a3903d8e2ebdf5f3553f51` | `AMR-D14` | `active_dependency` | `always_on` | `hosted:mutation-replay` |
| `20260806090000_amora_preparation_status.sql` | `1947a237019126e7e262e75b03b9129b70e559e6733e948616923f3c6496339f` | `AMR-T01` | `active_dependency` | `always_on` | `hosted:first-value` |
| `20260807090000_amora_mediation_send_gate.sql` | `27b4292cff613b727727bacc16e2600e8bb7df588cc367d87ecac77725506a82` | `AMR-P03` | `integrity_hardening` | `always_on` | `hosted:privacy-rls` |
| `20260811230000_amora_provider_egress_grant.sql` | `e030763d1da01e4f514b2cd1581eb63b439ad3a3aaecc89e89d64bf10147c674` | `AMR-D14` | `active_dependency` | `always_on` | `hosted:provider-egress` |
| `20260812030000_couple_invite_replay_hardening.sql` | `f80357e7d9ab2edfd0492c3505071d6361680a17d4bfcc6f3d20c3a1d9c0a11a` | `AMR-F15` | `active_dependency` | `always_on` | `hosted:first-value` |
| `20260812090000_amora_server_only_chat_ingest.sql` | `98abb0e90f9a38546f4bb0d61b42bd196deb4805f9fc7a024cae24733bab7ade` | `AMR-D14` | `active_dependency` | `always_on` | `hosted:mutation-replay` |
| `20260812100000_amora_today_one_decision_follow_up.sql` | `65affa3d0fb9d9d2c29e5681b93deadfb079acd0f6b6e37aa3f33a3f99b5ab4e` | `AMR-L13` | `unrelated_feature_off` | `AMORA_TODAY_ONE_ENABLED=false` | `hosted:feature-off` |
| `20260812120000_vendor_inquiry_handoff.sql` | `4d1e290e828ef958e92dd038dc3ef2d33dd37e20241dc83768f391c50329cd89` | `AMR-D11` | `parked_product_surface` | `always_on` | `hosted:parked-acl` |
| `20260812130000_amora_action_follow_up_v2.sql` | `1048132e7328e6d397baee848ce0f79ac00585a168f5381d4ce9202defc61657` | `AMR-D16` | `active_dependency` | `always_on` | `hosted:first-value` |
| `20260812140000_amora_mediation_outcome_follow_up.sql` | `150d7e221469b971fc97302aae5b854d8a62b526199428b4be312a5ecedadd79` | `AMR-L13` | `unrelated_feature_off` | `AMORA_MEDIATION_OUTCOME_FOLLOW_UP_ENABLED=false` | `hosted:feature-off` |
| `20260814120000_amora_explicit_action_execution.sql` | `c3f63b696f489f2a58d4537aa2a293624d31b7ba6a99afaa22e41b47ff9f3a38` | `AMR-D14` | `active_dependency` | `always_on` | `hosted:mutation-replay` |
| `20260814130000_amora_core_criterion.sql` | `fe3c37e8c70e22e09f06151f6d866cc2e2c8a5702e7a8e5a2340d7a3fc241fa1` | `AMR-P02` | `active_dependency` | `always_on` | `hosted:personalization-rls` |
| `20260814140000_amora_couple_core_criterion.sql` | `f247c77641223f216df9f265ec79a36b79991e2debcce464ad55f57601f29160` | `AMR-P03` | `active_dependency` | `always_on` | `hosted:personalization-rls` |
| `20260815120000_amora_action_outcome_feedback.sql` | `d6dbde267bc04222d969ee98b1cd733add5f09644b66ab4548aeb8304e611f01` | `AMR-D16` | `active_dependency` | `always_on` | `hosted:first-value` |
| `20260815130000_amora_first_use_action_promotions.sql` | `c4808671308c2ed0bb2be0a7c82b894b69c3d20c63f4547abb3bd61d64511090` | `AMR-F17` | `active_dependency` | `always_on` | `hosted:first-value` |
| `20260816120000_amora_preparation_topic_message_refs.sql` | `7da41bdbee2476a28bc93c8dd3921816e0971af3f8d2ef2f94421dfd5756a217` | `AMR-M02` | `active_dependency` | `always_on` | `hosted:message-ref-rls` |
| `20260816130000_amora_first_use_deterministic_proposal.sql` | `dfc943280ac6ecc1ce21503609933322f8b9f0a12c671319bef4b674b835f786` | `AMR-F17` | `active_dependency` | `always_on` | `hosted:first-value` |
| `20260816140000_amora_first_use_deterministic_application.sql` | `a5a184155366fbdcb0b2ad2ded922dc6ce0b3cac480f9e45ae52e5bd0a0084a6` | `AMR-D14` | `active_dependency` | `always_on` | `hosted:first-value` |
| `20260816150000_amora_provider_backed_add_action_application.sql` | `1e7870be4051c4fd9017d6909b453739e8eda9fdd4100339d47d9a79d7777483` | `AMR-D17` | `active_dependency` | `always_on` | `hosted:mutation-replay` |
| `20260816160000_amora_atomic_action_href_parity.sql` | `afe0eabc7cc774d219715224906bfd328e0df011bb76f9caea69615a93a4af7c` | `AMR-D14` | `integrity_hardening` | `always_on` | `hosted:integrity-postcheck` |
| `20260816170000_amora_booking_outcome_provenance.sql` | `9b673303585070facadb062d042c1cd23342cafe368612037571597ff72f5457` | `AMR-R02` | `integrity_hardening` | `always_on` | `hosted:booking-integrity` |
| `20260816180000_amora_neutral_preparation_space.sql` | `ce00fb20715ce45d1b7edccb8ea28c1af35e2dee9c3692552696f892639c2867` | `AMR-F10` | `active_dependency` | `AMORA_NEUTRAL_PREPARATION_SPACE_ENABLED=false` | `hosted:first-value` |
| `20260816190000_amora_preparation_catch_up.sql` | `637d56cfba243e25f6488d1aaf08f1873b9d4aad30bb54f7cedc3870b1eb9cce` | `AMR-F20` | `active_dependency` | `AMORA_NEUTRAL_PREPARATION_SPACE_ENABLED=false` | `hosted:first-value` |
| `20260818100000_restore_signup_profile_trigger.sql` | `16fa1a4af7832c69e937faeaff7f88115699e377e1445f9c4cdc524b86f4a53a` | `AMR-F10` | `integrity_hardening` | `always_on` | `hosted:first-value` |

<!-- AMORA:PENDING-SCOPE-CLASSIFICATION:END -->

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
