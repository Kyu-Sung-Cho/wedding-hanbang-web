# Hosted Storage policy operations

> **CURRENT ENGINE V2 PATH:** start with “Community media signed-upload fence
> (20260716108000)” below and follow
> `docs/operations/PRODUCTION_WRITE_FENCE_2026-07-17.md`. The earlier 20260714
> chat-image Expand/Contract sections are superseded historical instructions and
> must not be executed for the current release.

These chat-attachment changes are intentionally outside `supabase/migrations`.
Hosted Supabase owns `storage.objects` as `supabase_storage_admin`; the project
`postgres` role used by the SQL editor and normal database migrations cannot
create or drop its RLS policies. Keeping these files in the automatic migration
directory would make a production push fail with `must be owner of relation
objects`.

The following Dashboard `chat-image` guidance applies only to the historical
20260714 files. For current 20260716108000 operations, do not translate every
file into a `chat-image` policy: follow the exact table/role matrix in the
current section below and the authoritative write-fence runbook. Never change
the owner of Supabase-managed Storage tables.

## Expand (before the compatible app deploy)

> **SUPERSEDED 20260714 PROCEDURE — DO NOT EXECUTE FOR ENGINE V2.** Preserved
> only to explain the existing historical chat-image policy state.

Use `20260714162000_chat_attachment_expand.sql` as the exact source of truth.
Create only this policy for the `authenticated` role:

1. `chat-image own uploader folder write` (`INSERT`, policy expression goes in
   `WITH CHECK`)

The hosted Dashboard appends a generated `[hashString]_[number]` suffix to the
displayed policy name. Record that exact generated name in the release receipt;
the base name and policy expression must match this repository. Do not select
`UPDATE` or `DELETE`: Dashboard automatically adds a `SELECT` policy for those
operations, which would widen reads beyond the signed-URL API. Chat attachments
are immutable after upload, so no client mutation policy is required.

Do not remove legacy policies during expand. Verify a new upload is stored as
`{couple_id}/{auth.uid()}/{opaque_file_name}` and can be read only through the
authorized signed-URL API.

## Contract (only after web/mobile canary)

Use `20260714167000_chat_attachment_contract.sql` as the checklist:

1. Confirm the strict upload policy above exists and no uploader-bound `SELECT`,
   `UPDATE`, or `DELETE` policy exists.
2. In **Storage > Files > chat-image > configuration**, make the bucket private.
3. Remove every legacy policy named in the contract file, including
   `Anyone can view chat image` and `Authenticated users can upload chat image`.
4. Keep only the generated `chat-image own uploader folder write ...` policy.
5. Re-run signed-read, own-upload, partner-overwrite, anonymous-read, traversal,
   and legacy-read tests. Direct authenticated read, every client update/delete,
   partner overwrite, anonymous read, and traversal must fail; legacy objects
   must remain readable only via the authorized signing API.

The expand and contract actions edit cloud access permissions. Take a policy
inventory first and preserve a rollback copy before changing production.

## Community media signed-upload fence (20260716108000)

This release supersedes the historical expand/contract state above. Follow
`docs/operations/COMMUNITY_UPLOAD_SERVICE_FENCE.md` and the ten exact
`20260716108000_*` operation files in this directory.

Run them only in their assigned role:

| File suffix | Role | Hosted-project handling |
| --- | --- | --- |
| `community_upload_service_fence_inventory.sql` | Exact 19-policy/10-bucket prestate | Read-only; run in SQL Editor and save every result set. |
| `storage_global_write_freeze_apply.sql` | Phase 1: remove exactly 15 mutation policies | Dashboard reference/local test only; leaves exactly four SELECT policies. |
| `storage_global_write_freeze_verify.sql` | Phase 1 receipt | Read-only; proves four SELECTs, ten buckets, no staging, and exact 6/43 object counts. |
| `storage_global_write_freeze_rollback.sql` | Safe phase-1 recovery | Restores/converges to four SELECTs and zero mutation policies. |
| `community_upload_service_fence_apply.sql` | Phase 2: remove four SELECTs when present and create one strict guarded INSERT | Dashboard reference/local test only, after all 27 migrations and staging creation; accepts the exact four-read freeze or zero-policy retry state. |
| `community_upload_service_fence_verify.sql` | Final receipt | Read-only; proves exact helper ACL/body contracts, closed production fence, eleven buckets, empty staging, and the exact one-row semantic policy multiset. |
| `community_upload_service_fence_rollback.sql` | Safe phase-2 rollback | Removes the semantic final policy regardless of generated suffix and converges to zero policies; broad public reads stay removed. |
| `community_upload_service_fence_rollback_verify.sql` | Safe phase-2 rollback receipt | Read-only; proves zero policies, hence zero reads and zero mutations. |
| `community_upload_service_fence_emergency_rollback.sql` | Security-regressing incident restore | Manual/time-bounded only; restores the exact insecure 19-policy prestate. Never bind to the controller. |
| `community_upload_service_fence_emergency_rollback_verify.sql` | Incident restore receipt | Read-only; green proves the regression was reproduced, not that it is safe. |

The order is fixed: inventory → global mutation-policy freeze → read-only freeze
verification → wait at least two-hour signed-token TTL plus 10-minute grace →
two stable controller receipts at least five minutes apart → verified logical
backup and local PGlite logical row replay → separate different-project hosted
restore rehearsal → all 27 migrations with the global database fence still active →
create private empty staging → final policy operation → final controller receipt
with the Storage helper still false → disposable hosted compatibility probe →
deploy/read-only canary with both fences closed → authorized database-fence
lift → positive production canary. Phase 1 is deliberately independent of
migration 1130's helpers.

The provisional final global `storage.objects` manifest is exactly one
authenticated `INSERT`. Its Dashboard-generated suffix is logged but ignored by
verification; the exact command, role, permissive mode, predicate digest, and
one-row count are authoritative. It accepts only canonical
`{couple_uuid}/{auth.uid()}/{uuid}.{jpeg|jpg|png|gif|webp}` and calls the current
couple-membership, account-deletion, and production-fence helpers. There is no
one-folder compatibility policy and no public Storage SELECT policy.

This one-policy manifest is **NO-GO until an actual disposable hosted Storage
`upload()` succeeds**. Supabase documents an `INSERT ... RETURNING *` path that
may require a matching SELECT policy. If the positive probe fails, review a
strict same-path SELECT companion or server-signed flow and update the exact
manifest; never add a broad read. Historical chat bytes use the authorized
service-role signed-URL API.

Migration 1080 creates only the app-owned durable session table/function. It has
no hosted Storage prerequisite and never reads or changes `storage.objects`,
`storage.buckets`, or `pg_policies`. Platform apply/rollback remain Dashboard
operations because `supabase_storage_admin` owns the hosted relation.

The local PGlite logical row replay proves authenticated payload integrity, not
a production-grade restore. The hosted restore receipt must use the same backup
set on a different disposable Supabase project and verify typed schema,
defaults, checks, triggers, Auth and Storage metadata, RLS, RPC/ACL, row counts,
and canonical digests. A local-only replay or same-project reset cannot open the
Storage operation gate.

## Retired guestbook buckets (20260804120000)

Migration `20260804120000_community_profile_guestbook_p0_hardening.sql` retires
the app-owned guestbook tables, but deliberately does not alter
`storage.objects`, its policies, or `storage.buckets`. Supabase owns those
entities as `supabase_storage_admin`; treat their schema records as read-only and
change bucket configuration only through the supported Storage API.

The two retained buckets are `guestbook-images` and `guestbook-uploads`. The
operation makes them private without deleting or listing object names. It does
not delete retained bytes.

Run the hosted operation in this fixed order:

1. Apply the database migration and the already-reviewed global Storage policy
   operation. Do not run this bucket operation against an earlier policy state.
2. Run
   `20260804120000_retired_guestbook_storage_inventory.sql` in the hosted SQL
   Editor. Save every result set. Stop on a missing bucket, owner drift, policy
   drift, or any status other than `READY_TO_PRIVATIZE`/`ALREADY_PRIVATE`.
3. Pin all destination variables: `NEXT_PUBLIC_SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_EXPECTED_URL`,
   `SUPABASE_EXPECTED_PROJECT_REF`, and `SUPABASE_PRODUCTION_PROJECT_REF`.
   Never place their values in a release receipt.
4. For a production destination, separately set
   `SUPABASE_PRODUCTION_WRITE_CONFIRM=OPERATOR_WRITE:<project-ref>`.
5. Run the supported, destination-fenced change:

   ```powershell
   corepack pnpm exec node ./scripts/retire-guestbook-storage-buckets.mjs --apply --confirm=RETIRED_GUESTBOOK_BUCKETS_PRIVATE:<project-ref>
   ```

   The command validates the exact bucket identity and configuration before
   changing visibility, is safe to retry, compensates an in-process partial
   apply, and prints no secret, object name, or object byte.
6. Re-run the command without `--apply` for a read-only API verification, then
   run `20260804120000_retired_guestbook_storage_verify.sql` and save both
   receipts:

   ```powershell
   corepack pnpm exec node ./scripts/retire-guestbook-storage-buckets.mjs --verify
   ```

The final SQL receipt fails unless both buckets are private and the entire
global `storage.objects` policy multiset is the exact reviewed one-policy,
no-read manifest. A green bucket receipt is necessary but does not authorize a
production deploy, lift either write fence, or enable community media/push
feature flags. Those decisions still require the full release runbook evidence.

Migration 1110 adds full-byte sanitation checkpoints, exact signed-token
cleanup, atomic post/cohort attachment binding, and leased cleanup for finalized
assets left unattached for 24 hours. Migration 1130 creates the deletion-intake
predicate and the permanent bridge that returns false while the temporary
production database fence exists. Migration 1140 creates the bilateral
current-couple path helper. Migration 1170 pins the reviewed Auth-FK deletion
contract, including anonymized retained couple/chat identifiers and the vendor
ownership deletion blocker. The final platform operation is not release-ready
until every migration through 1170 and both controller-specific read-only
Storage receipts have passed.
