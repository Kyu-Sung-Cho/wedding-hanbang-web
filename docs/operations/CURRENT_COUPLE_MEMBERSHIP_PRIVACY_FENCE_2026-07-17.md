# Current couple membership privacy fence — 2026-07-17

Status: implemented and locally validated; **not applied to production**.

## Why this is a release blocker

The production read-only audit found that historical `couples.groom_id` slots were still being treated as membership even after the same profile had moved to its current couple. Because legacy RLS predicates trusted only `couples.bride_id/groom_id`, a stale slot could expose old shared or role-private couple data.

The production audit emitted counts only:

| Gate | Before 1140 |
|---|---:|
| profiles | 49 |
| couples | 55 |
| stale bride slots | 0 |
| stale groom slots | 34 |
| profiles pointing to a couple without a matching slot | 0 |
| canonical bride role mismatches | 0 |
| groom role mismatch with a canonical backlink | 0 |
| users referenced by more than one couple | 3 |
| maximum couple references for one user | 29 |
| couples that become ownerless shells after stale-slot cleanup | 33 |
| couples that retain one valid bride after stale-slot cleanup | 1 |
| projected ownerless shells not sealed by 0940's normal backfill | 33 |
| projected unsealed shells with a reusable non-null invite code | 33 |

The one observed groom-role mismatch had both `profiles.role` and `profiles.couple_id` set to `NULL`, so it is part of the same stale-slot set. No profile backlink or role is guessed or rewritten.

## Migration behavior

Migration `20260716114000_current_couple_membership_privacy_fence.sql` performs one bounded repair:

1. Install a narrow `BEFORE UPDATE OF bride_id, groom_id` fence that stamps `membership_sealed_at` only on a non-empty-to-empty roster transition.
2. Snapshot row counts only for the membership and historical-data tables.
3. Temporarily disable the three known destructive roster side-effect triggers.
4. Set a bride or groom slot to `NULL` only when that slot's profile is missing or its `profile.couple_id` points elsewhere.
5. Re-enable the triggers in the same transaction.
6. Abort on any residual backlink, role, reverse-link, duplicate-member, same-user-both-roles, or unsealed-ownerless-shell ambiguity.
7. Install bilateral authorization helpers, RLS policies, unique partial indexes, and deferred integrity triggers.
8. Abort if any snapshotted row count changed.

The roster epoch trigger remains enabled throughout. The narrow sealing trigger runs after 0940's roster trigger in PostgreSQL's name order, stamps the final stale-slot clear in the same row transition, and leaves invite codes immutable under the now-sealed epoch. A postcondition rejects any ownerless row that remains unsealed.

The counts-only production projection found all 33 future ownerless shells outside 0940's normal sealing backfill: none is currently paired, none has two distinct authenticated chat senders, and all 33 retain a non-null invite code. The audit exposes this as `projected_ownerless_shells_requiring_seal`: expected `33` immediately before 1140 and `0` after 1140. `ownerless_unsealed_couples` must be `0` both before and after; a pre-existing unsealed ownerless row is outside the bounded repair and aborts the migration.

Expected production data effect after a successful transaction:

- stale bride slots: `0 -> 0`
- stale groom slots: `34 -> 0`
- couples deleted: `0`
- profiles changed: `0`
- 33 historical couples remain as ownerless sealed shells
- those same 33 rows receive `membership_sealed_at = transaction_timestamp()` in the exact final-slot clear
- 1 historical couple retains its valid bride and clears only the stale groom
- chat messages, summaries, decision nodes, journeys, AI logs, Amora memory rows, and mediation acceptances keep identical row counts

## Authorization contract after 1140

A user is a current member only when all three values agree:

1. `profiles.id = user_id`
2. `profiles.couple_id = couples.id`
3. `profiles.role` matches the exact `couples.bride_id` or `couples.groom_id` slot

The migration defines or replaces:

- `is_current_couple_member(uuid, uuid)` — service-role-only user-specific proof
- `is_couple_member(uuid)` — authenticated RLS wrapper for `auth.uid()`
- `can_access_couple_visibility(uuid, text)` — shared/role-private proof
- `can_read_profile(uuid)` — self or canonical partner directory proof
- `is_current_couple_path_member(text)` — safe storage-folder proof without casting untrusted path text
- `enforce_current_couple_membership_integrity()` — deferred bilateral invariant
- `seal_ownerless_couple_membership_epoch()` — narrow final-slot epoch fence

The two constraint triggers are `DEFERRABLE INITIALLY DEFERRED`, so atomic create, join, leave, reset, and account-deletion transactions may update `couples` and `profiles` in either order. A half-link cannot commit.

Same-role uniqueness is backed by:

- `couples_bride_id_current_unique_idx`
- `couples_groom_id_current_unique_idx`

Cross-role uniqueness remains protected by `trg_guard_new_couple_membership` and its per-user advisory lock. `trg_enforce_couple_roster_epoch` remains the no-replacement/no-reuse fence.

RLS is converged onto the bilateral helpers for:

- couples and safe partner profiles
- chat messages, chat summaries, and decision nodes
- Amora memory settings, consents, and compiled profiles
- decision edges
- invitations, photos, accounts, RSVP owner reads, guestbook owner management, visits, congratulatory money, and AI scripts
- customer-side vendor bookings and contracts
- private `chat-image` storage writes, updates, and deletes

Exact policy objects replaced or created by 1140:

- `couples_select_own`, `profiles_select_safe_related`
- `chat_select_with_privacy`, `chat_messages_insert_own_user`, `chat_summaries_select_with_privacy`
- `decision_nodes_select_with_privacy`, `decision_edges_owner_all`
- `amora_memory_settings_select_with_privacy`, `amora_memory_consents_select_with_privacy`, `amora_couple_profiles_select_with_privacy`
- `invitations_owner`, `photos_owner`, `accounts_owner`, `rsvp_owner_select`, `guestbook_owner_manage`, `guestbook_owner_delete`, `visits_owner_select`
- `money_owner`, `scripts_owner`
- `vendor_bookings_select`, `vendor_bookings_insert`, `vendor_bookings_update`
- `고객: 본인 계약 조회`
- `chat-image couple folder write`, `chat-image couple folder update`, `chat-image couple folder delete`

`couples_insert_own`, `couples_update_own`, and the legacy broad `couples_select_by_code` are removed without direct-table replacements. Couple creation, joining, reset, and invite-code lookup stay behind their security-definer RPCs and server authorization guards.

The server routes that use the service client derive a couple from the authenticated user's profile. After 1140 that profile link is no longer an independent authorization fact: the deferred database invariant guarantees that every committed non-null profile link has the matching role and couple slot. Request-scoped reads continue to use RLS for row and private-visibility enforcement.

The service-role authorization review covered the user-facing chat, proactive chat, Amora actions, memory, mediation acceptance, journey, bookings, onboarding, couple-code, feedback, and signed chat-image flows. None authorizes a caller from an untrusted body/query `couple_id` alone:

- chat, actions, journey, bookings, proactive care, feedback, and onboarding authenticate the request first and derive or compare the couple against that user's profile;
- memory and couple-code flows also verify the exact bride/groom slot;
- mediation and signed-image flows first authorize the source message through the request-scoped RLS client;
- cron workers are separately secret-gated server jobs, not user impersonation paths.

The deferred bilateral trigger turns every profile-derived service authorization into a database-backed fact, including across reset/account-deletion transactions. This central fence avoids adding another network round trip to every user request while the service-only `is_current_couple_member(uuid, uuid)` remains available for future service operations that start from an explicit user/couple pair.

## Safe operating sequence

Do not apply 1140 without a verified pre-migration backup and a separate
different-project hosted restore rehearsal. A local PGlite logical row replay
checks authenticated payload integrity but does not recreate the typed schema,
triggers, Auth dependencies, RLS, or RPC/ACL and cannot satisfy this gate alone.

1. Run the read-only audit at [`scripts/sql/current-couple-membership-privacy-audit.sql`](../../scripts/sql/current-couple-membership-privacy-audit.sql).
2. Confirm the counts match the approved evidence above, including projected shells requiring seal=`33`, and capture the historical row counts.
3. Create and verify the production backup under the release runbook. Run its
   required local PGlite logical row replay, then restore the same authenticated
   backup set into a different disposable hosted Supabase project and complete
   the typed-schema, Auth/Storage metadata, RLS, and RPC/ACL checks.
4. Apply 1140 with the 5-second lock timeout intact. Do not bypass a lock timeout.
5. Run the same audit again.
6. Require all stale/reverse/role/duplicate/same-role/direct-policy/unexpected-core-policy/ownerless-unsealed/projected-requiring-seal counts to be zero, and require every boolean gate including `ownerless_shell_reuse_fence_ready` to be true.
7. Require profiles=`49`, couples=`55`, and every historical row count to be unchanged.
8. Test one canonical bride and groom session: current shared data visible, own private visible, partner private hidden, historical stale-couple rows hidden.

If any precondition or postcondition fails, the migration transaction rolls back. Do not manually reattach a historical slot. Restore from the verified backup only if a successful migration must be reverted, then keep the application unavailable until the privacy fence is corrected.

## Backup and rollback manifest

The pre-migration backup must include schema definitions and ACLs for:

- the seven functions listed above
- `trg_current_couple_profile_integrity`, `trg_current_couple_row_integrity`, and `trg_seal_ownerless_couple_membership_epoch` (new)
- `trg_guard_new_couple_membership`, `trg_enforce_couple_roster_epoch`, `trg_delete_empty_couple_after_membership_change`, `trg_reset_amora_memory_after_membership_change`, and `trg_reset_amora_mediation_after_membership_change` (required existing triggers)
- `couples_bride_id_current_unique_idx` and `couples_groom_id_current_unique_idx` (new), plus the existing slot lookup indexes
- every policy named in the exact policy list above and all grants on its table

The membership-specific assertions in the different-project hosted restore
rehearsal must cover `profiles`, `couples`, `chat_messages`, `chat_summaries`,
`decision_nodes`, `wedding_journeys`, `ai_interactions_log`,
`amora_couple_profiles`, `amora_memory_settings`, `amora_memory_consents`,
`amora_memory_jobs`, and `amora_mediation_acceptances`. The migration does not
add a table or column and does not delete a row. Its intended production data
mutations are exactly `34` stale `couples.groom_id` values becoming `NULL` and
the `33` resulting ownerless rows receiving a server timestamp in
`membership_sealed_at`.

Rollback after a successful production commit is a database restore operation,
not a reverse migration: restoring stale slots without simultaneously restoring
the old authorization surface would create an unsupported mixed state. Keep the
application in maintenance mode, use the separately rehearsed hosted recovery
procedure to restore the verified pre-1140 snapshot and schema together, run
the counts-only audit, then redeploy the matching pre-1140 application revision.
