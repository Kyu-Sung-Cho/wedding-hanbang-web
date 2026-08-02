# Hosted Storage policy operations

> **CURRENT ENGINE V2 PATH:** start with “Community media signed-upload fence
> (20260716108000)” below and follow
> `docs/operations/PRODUCTION_WRITE_FENCE_2026-07-17.md`. The earlier 20260714
> chat-image Expand/Contract sections are superseded historical instructions and
> must not be executed for the current release. The authenticated chat INSERT
> policy produced by the 20260716108000 finalizer is now a transitional prestate:
> the current release must finish with the 20260802159000 server-owned upload
> fence and zero `storage.objects` policies.

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
| `community_upload_service_fence_apply.sql` | Phase 2: require the hardened `chat-image` contract, remove four SELECTs when present, and create one strict guarded INSERT | Dashboard reference/local test only, after all 27 migrations, the five-bucket privacy transitions in migrations `20260802134000`/`20260802143000`, the 3 MiB/image-only transition in migration `20260802157000`, and staging creation; accepts the exact four-read freeze or zero-policy retry state and never mutates bucket metadata. |
| `community_upload_service_fence_verify.sql` | Final receipt | Read-only; proves the 3 MiB/image-only `chat-image` bucket, exact helper ACL/body contracts, closed production fence, eleven buckets including five private dormant buckets, empty staging, and the exact one-row semantic policy multiset. |
| `community_upload_service_fence_rollback.sql` | Safe phase-2 rollback | Removes the semantic final policy regardless of generated suffix and converges to zero policies; broad public reads stay removed. |
| `community_upload_service_fence_rollback_verify.sql` | Safe phase-2 rollback receipt | Read-only; proves zero policies, hence zero reads and zero mutations, while all five dormant buckets remain private. |
| `community_upload_service_fence_emergency_rollback.sql` | Security-regressing incident restore | Manual/time-bounded policy-only restore; restores the exact insecure 19-policy prestate without reopening any dormant bucket. Never bind to the controller. |
| `community_upload_service_fence_emergency_rollback_verify.sql` | Incident restore receipt | Read-only; green proves the policy regression was reproduced while all five dormant buckets stayed private, not that the state is safe. |
| `20260802159000_chat_image_server_upload_fence_inventory.sql` | Server-owned chat prestate | Read-only; records policy/bucket counts and hashed object-path inventory without exposing raw paths. |
| `20260802159000_chat_image_server_upload_fence_apply.sql` | Final chat-image privilege contraction | Dashboard reference only; accepts the exact four-read freeze, reviewed authenticated INSERT policy, or an idempotent zero-policy retry, then removes every reviewed policy without touching objects. |
| `20260802159000_chat_image_server_upload_fence_verify.sql` | Final server-owned receipt | Read-only; proves zero Storage policies, the private 3 MiB/image-only bucket, and service-role BYPASSRLS/table authority. |
| `20260802159000_chat_image_server_upload_fence_rollback.sql` | Fail-closed recovery | Never restores client upload; validates zero policies and preserves all existing objects. |
| `20260802159000_chat_image_server_upload_fence_rollback_verify.sql` | Fail-closed recovery receipt | Read-only; proves rollback did not recreate a policy or weaken the bucket. |

The order is fixed: inventory → global mutation-policy freeze → read-only freeze
verification → wait at least two-hour signed-token TTL plus 10-minute grace →
two stable controller receipts at least five minutes apart → verified logical
backup and local PGlite logical row replay → separate different-project hosted
restore rehearsal → all 27 predecessor migrations with the global database
fence still active → apply the complete ordered
`vendor-disclosure-v2-20260718.json` successor manifest through migration 1570,
including migrations `20260802134000` and `20260802143000`'s five-bucket
`public=false` transition (only after the pre-migration receipts, and only after
1430 proves its three buckets are empty) and migration `20260802157000`'s exact
`chat-image` 3 MiB/image-only transition → create
private empty staging → final
transitional policy operation → 20260802159000 server-owned upload contraction
→ final zero-policy controller receipt
with the Storage helper still false → disposable hosted compatibility probe →
deploy/read-only canary with both fences closed → authorized database-fence
lift → positive production canary. Phase 1 is deliberately independent of
migration 1130's helpers. Inventory, freeze verification, the freeze controller
receipt, and the release pre-check intentionally require the old
`public=true` state for all five dormant buckets; every final and phase-2
rollback receipt requires `public=false`. Safe and emergency phase-2 rollback
operations do not weaken the hardened `chat-image` bucket settings or the five
private dormant bucket flags.

The 20260716108000 one-policy state is now only the reviewed input to the final
contraction. The release-ready state is a private `chat-image` bucket with a
3 MiB limit, the ordered JPEG/PNG/GIF/WebP MIME allowlist, and zero
`storage.objects` policies. Authenticated clients therefore have no direct read
or mutation path. The chat API uses `service_role` (BYPASSRLS) only after it has
decoded, bounded, and re-encoded the image. Existing objects are preserved for
the separately reviewed inventory/quarantine/re-encode gate in
`docs/operations/CHAT_IMAGE_SERVER_UPLOAD_FENCE_2026-08-03.md`.

Because Supabase both documents SQL bucket creation and advises treating its
Storage schema as read-only, a successful SQL migration is not by itself proof
that the hosted service enforces the new metadata. The disposable hosted clone
must read the bucket through the official bucket API and exercise real upload
allow/deny probes. If the service does not honor the SQL metadata transition,
stop and use an explicitly reviewed Dashboard or official `updateBucket`
operation; never open either production write fence on SQL evidence alone.

The old one-policy manifest remains **NO-GO for production writes**. The current
server-owned flow supplies byte-level MIME validation, decode/re-encode,
metadata removal, exact message binding, bounded payloads, and best-effort
orphan cleanup before provider use. A disposable hosted probe must prove an
authenticated direct upload fails and a service-owned sanitized upload works;
never add a client SELECT companion or broad read. Historical chat bytes use
the authorized service-role signed-URL API and remain subject to the documented
legacy re-encode gate.

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
