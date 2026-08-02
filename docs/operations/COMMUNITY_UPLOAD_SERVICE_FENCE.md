# Community media signed-upload and sanitation fence

## Release status

Application code alone does not make this change live. Production promotion is
blocked until the exact Storage inventory, temporary global Storage write
freeze, backup verification, a different-project hosted restore receipt, all
27 migrations, final Dashboard policy
operation, web and real-device mobile builds, hosted-clone probes, and
post-deploy canary have all passed. A failed assertion is a release stop.

**Current gate: NO-GO.** The SQL contract is locally executable, but no
disposable hosted Supabase project receipt yet proves that an authenticated
Storage `upload()` succeeds with the provisional INSERT-only chat policy.
Supabase documents that a normal upload can execute `INSERT ... RETURNING *`
and fail with 403 when no matching SELECT policy exists. Production must stay
write-frozen until that exact hosted positive probe passes. If it fails, choose
and review either a same-path strict SELECT companion or a server-signed chat
upload flow; never add a broad SELECT merely to make the probe green.

New video uploads are deliberately disabled. Historical public videos remain
readable, but no client or API path may create a new one until a bounded video
decode/transcode pipeline and hostile-fixture test suite are release-gated.
Post updates may retain an exact legacy image, video, or thumbnail already on
that same post; they cannot introduce another legacy URL. Every newly attached
image must use the sanitized UUID session path.

## Shipped flow

1. An authenticated client sends only `{ mimeType, size }` to the API. The
   accepted formats are JPEG, PNG, GIF, and WebP. JPEG/PNG/WebP are at most
   5 MiB; GIF is at most 6 MiB.
2. Persistent fail-closed limits allow 20 attempts / 10 minutes and 50 attempts
   / 24 hours per account. The service creates a durable owner session and a
   two-hour signed token for one exact UUID path in private
   `community-media-staging`.
3. Web and mobile upload bytes directly to that signed path. Mobile accepts no
   file above 6 MiB and retries finalize at most three times, only for conflict,
   server, or network failures, with bounded delay.
4. Finalize is protected by persistent fail-closed limits of 30 attempts / 10
   minutes and 150 attempts / 24 hours per account, plus 8 attempts / 10
   minutes for one upload ID. It then claims the session. A strict 64-byte
   preflight must return `206` with an exact `Content-Range` total and matching
   signature; a `200`, missing header, or inconsistent total fails closed.
   Finalize then fully downloads the staged object, verifies exact byte length,
   decodes it with
   Sharp, enforces an 8192-pixel dimension limit, 24-million-pixel still-image
   limit, and bounded GIF frame/total-pixel limits, then re-encodes it. EXIF,
   ICC, IPTC, XMP, and appended polyglot bytes are not copied to the output.
5. The service uploads the sanitized bytes to `community-images`, fully
   downloads the final object, re-decodes it, verifies its SHA-256 digest and
   exact size, deletes and confirms absence of staging, and only then records
   completion and returns a public URL. Storage metadata alone is never proof
   of completion.
6. If a process crashes after publishing but before the completion checkpoint,
   a stale claimant fully downloads, decodes, re-encodes, republishes, and
   revalidates the final bytes. A final object that cannot pass that process is
   never converted into a metadata-only success.
7. The 15-minute cron deletes an exact staging path after token expiry plus a
   five-minute grace, confirms absence, and calls the exact-path DB checkpoint.
   This includes completed sessions because a signed token can be replayed
   after finalize. Completed status is preserved and `token_cleanup_at` is set.
8. Migration 1110 binds a finalized session to a post, poll option's parent
   post, or cohort message inside the consumer write transaction. A completed
   object left unattached for 24 hours (including a fresh 24-hour window after
   detachment from an old consumer) is leased, deleted, absence-checked, and
   durably finalized. A token-cleaned `rejected` or `expired` session with an
   exact final path is eligible immediately, which closes the crash window in
   which publishing succeeded but the completion checkpoint did not. Attachment
   and cleanup cannot win the same row lock. Final objects use `max-age=0`
   while this flow returns a public URL, so orphan deletion is not undermined by
   a year-long CDN cache entry.

The Vercel 4.5 MiB inbound request-body limit is avoided because browser/mobile
bytes go directly to Storage. Finalize's server-side Storage download is still
bounded to 6 MiB and must be monitored for memory and latency.

## Fixed bucket and policy contract

| Bucket | Visibility | Platform limit | New client mutation | Purpose |
|---|---:|---:|---|---|
| `chat-image` | private | 3 MiB, exact image MIME allowlist | current-couple/uploader/UUID path INSERT only | private chat image history; PDF/DOCX remain provider-only and are not persisted |
| `community-media-staging` | private | 6 MiB, exact image MIME allowlist | signed exact-path upload only | untrusted input |
| `community-images` | public | 10 MiB, exact image MIME allowlist | none | sanitized output; app caps output at 6 MiB |
| `community-videos` | public | 50 MiB, exact historical video allowlist | none | historical reads only |
| `cohort-images` | private after migration `20260802143000` | unchanged | none | empty retired bucket; cohort messages use sanitized `community-images` |
| `guestbook-images` | private after migration `20260802134000` | unchanged | none | dormant legacy surface |
| `guestbook-uploads` | private after migration `20260802134000` | 5 MiB, exact historical image MIME allowlist | none | dormant legacy surface |
| `invitation-photos` | private after migration `20260802143000` | 10 MiB, exact historical image MIME allowlist | none | empty retired bucket |
| `user_photos` | private after migration `20260802143000` | unchanged | none | empty retired bucket |

The `chat-image` bucket settings are a coarse ingress fence, not content
validation or a per-user storage quota. Supabase Storage's pinned uploader
implementation compares the declared request `Content-Type` string with the
bucket allowlist; it does not inspect image magic bytes or fully decode the
file ([pinned MIME implementation](https://github.com/supabase/storage/blob/c4e745e4bf196774d6ef373c20e348ad1f97ccb0/src/storage/uploader.ts#L305-L332),
[raw request source](https://github.com/supabase/storage/blob/c4e745e4bf196774d6ef373c20e348ad1f97ccb0/src/storage/uploader.ts#L512-L520)).
The same pinned source rejects an oversized raw upload early only when it knows
the request length and explicitly notes that an unknown-size raw body has no
later truncation signal
([pinned size path](https://github.com/supabase/storage/blob/c4e745e4bf196774d6ef373c20e348ad1f97ccb0/src/storage/uploader.ts#L529-L543)).
Whether the hosted edge always supplies a trustworthy length is **UNVERIFIED**.
Before enabling the provisional direct INSERT, the hosted-clone probe must
cover oversized uploads both with and without `Content-Length`, declared-image
payloads with invalid bytes, repeated uploads, and abandoned objects. A
no-length oversize success is a hard stop. The recommended final architecture
is a bounded server-owned upload/finalize path that fully decodes and re-encodes
images, atomically enforces an approved per-user byte/object quota, removes
orphaned objects, and then removes the authenticated direct INSERT policy.

The release verifiers pin the complete global bucket inventory, not just the
three community buckets. Before the final operation there are exactly ten
existing buckets; afterward `community-media-staging` makes exactly eleven.
This includes `chat-image`, `cohort-images`, both guestbook buckets,
`invitation-photos`, `user_photos`, and both vendor buckets. Every name,
visibility flag, limit, ordered MIME array, and MIME cardinality is exact.
The inventory, freeze verifier, freeze controller receipt, and pre-check pin
the captured `chat-image` bucket limit/MIME values as `NULL`. After those
receipts, migration `20260802157000_harden_chat_image_bucket_upload_limits.sql`
accepts only that captured prestate or an exact idempotent retry and sets a
3 MiB limit with the ordered JPEG/PNG/GIF/WebP MIME allowlist. The final
Dashboard policy operation requires that hardened state and does not mutate
bucket metadata. Final/rollback verifiers and post-checks require the hardened
values; no rollback removes them. The same
pre-final receipts also pin `cohort-images`, both guestbook buckets,
`invitation-photos`, and `user_photos`
as `public=true`, because they describe the state before migrations
`20260802134000` and `20260802143000`. After those migrations, the final apply
precondition, final verifier, both phase-2 rollback verifiers, final controller
receipt, and post-check pin all five as `public=false`. Migration
`20260802143000` locks its three target bucket rows and aborts unless they all
exist and contain zero objects; it never hides a live legacy object. Staging
must be absent during the backup freeze and must exist empty before the final
policy operation.

The complete final `storage.objects` policy manifest is exactly one permissive
`INSERT` policy for `authenticated`:

- the Dashboard display name may be `chat-image own uploader folder write`
  plus any generated suffix; the suffix is receipt metadata, not part of the
  authorization contract;
- its exact semantic fingerprint accepts only canonical
  `{couple_uuid}/{auth.uid()}/{uuid}.{jpeg|jpg|png|gif|webp}`;
- `public.is_current_couple_path_member(text)` verifies both the caller's
  profile link and their current bride/groom slot in the same couple;
- `public.account_deletion_storage_writes_allowed()` takes the same per-user
  advisory lock as deletion intake, so either an upload commits before the
  deletion inventory or intake commits first and the upload is denied; and
- `(SELECT public.production_storage_writes_allowed())` keeps the installed
  policy inert while any temporary production database-fence trigger, event
  trigger, guard function, or attach function remains.

“One policy” is provisional, not release approval. PGlite proves PostgreSQL RLS
semantics but does not reproduce the hosted Storage API's `RETURNING *` path.
The production policy count may change to two only after the required hosted
compatibility probe, a reviewed manifest update, and all exact verifiers/tests.

The legacy one-folder layout is deliberately not retained: it cannot prove the
uploader and current clients no longer generate it. The earlier broad policy
also OR-bypassed the uploader-bound policy. All other pre-operation policies
are removed, including public Storage reads, all community mutations, chat
update/delete and broad writes, and vendor mutations. Existing bytes are not
deleted. Historical chat objects remain available through the authorized
service-role signed-URL route, not a public `storage.objects` SELECT policy.

Published `community-images` final objects are intentionally public. This fence
removes client write capability; it does not make those existing final objects
private. The dormant guestbook buckets are a deliberate exception: migration
`20260802134000` makes both private. The three empty retired buckets are also
deliberate exceptions: migration `20260802143000` makes them private only after
the locked zero-object preflight. No phase-2 rollback reopens any of the five.

## Hosted ownership and helper-function policy fence

Hosted Supabase owns `storage.objects` as `supabase_storage_admin`. Never change
its owner. Normal migrations and SQL Editor sessions must not create or drop its
policies. The files under `supabase/platform-operations/storage/20260716108000_*`
are the source of truth:

- `inventory.sql` is read-only and lists every global bucket, object count, and
  every Storage policy with its full
  `qual`/`with_check`, not only policies containing literal community names.
  This is required because a helper function can hide a bucket target. Its
  five dormant-bucket visibility flags are intentionally the pre-migration
  `public=true` state.
- `storage_global_write_freeze_apply.sql` is the pre-backup Dashboard reference.
  It accepts only the exact 19-policy inventory and removes exactly 15 mutation
  policies without depending on any new helper.
- `storage_global_write_freeze_verify.sql` is read-only and requires exactly the
  four recorded SELECT policies, no mutation policy, the exact ten-bucket
  pre-migration inventory (including all five public dormant buckets), and the
  recorded 6 chat plus 43 community-image objects.
- `storage_global_write_freeze_rollback.sql` is the safe convergence/recovery
  operation. It restores only those four reads and never restores a mutation
  policy.
- `apply.sql` is the post-migration Dashboard reference. It accepts only the
  frozen four-policy state or the fail-closed zero-policy phase-2 retry state,
  plus the exact membership, account-deletion, and production-fence helpers.
  It also requires all five dormant buckets to already be private and
  `chat-image` to have the exact 3 MiB/image-only contract established by
  migration `20260802157000`, removes the four SELECT policies when present,
  and creates the provisional strict INSERT policy.
- `verify.sql` is the final read-only hosted verifier. It records the policy
  name, but compares permissive mode, roles, command, and canonical expression
  SHA-256 as an exact one-row semantic multiset; the generated suffix is ignored but
  emitted in the receipt. It also pins relation owner/kind/RLS/FORCE state,
  all eleven bucket contracts including the five private dormant buckets,
  empty staging, helper ACL/body contracts, and a still-closed production
  fence. Save every result set.
- `community_upload_service_fence_rollback.sql` and `_rollback_verify.sql` are
  the default safe phase-2 rollback. They remove any semantically exact final
  policy regardless of its generated suffix and converge to zero policies.
  Mutation and broad public reads both remain removed, and the five private
  dormant-bucket metadata rows are unchanged.
- `community_upload_service_fence_emergency_rollback.sql` and
  `_emergency_rollback_verify.sql` are manual incident-only artifacts that
  restore/prove the known-insecure 19-policy prestate. They must never be bound
  to the release controller. They restore policies only: all five dormant
  buckets remain private and the emergency verifier requires that state.
- `amora-engine-v2-storage-freeze-pre.sql` and
  `amora-engine-v2-storage-final-post-push.sql` are the controller-compatible,
  read-only receipts for the two phases.

The canonical expression digest is SHA-256 of
`lower(regexp_replace(coalesce(qual,'') || E'\n' ||
coalesce(with_check,''), '\s+', '', 'g'))`; permissive mode, roles, and command
are compared separately. Policy display name is logged but not authorization
input. The former legacy digest is not a final
contract. The provisional strict digest is
`7b9e967897a69bdc226f09e02a240db1ca64f0caeb58244912445ff0f5032482`,
produced by the PGlite execution fixture. The release manifest is **not frozen**
until the read-only hosted verifier proves the same PostgreSQL serialization.
If it differs, stop and review the full hosted expression—never weaken the
verifier or add a wildcard. A Dashboard-generated suffix change alone is
accepted only when the exact one-row semantic multiset is unchanged; duplicate
semantically identical policies still fail because they change the multiset.

## Release order

1. **Exact inventory.** Run the read-only inventory against the pinned project.
   Save the exact relation owner/RLS state, ten bucket contracts, object counts,
   and all 19 policy expressions and canonical hashes. Any drift stops release.
2. **Freeze all Storage writes.** Through Dashboard, reproduce only the 15 named
   mutation-policy removals in `storage_global_write_freeze_apply.sql`. Do not
   change bucket configuration or the four recorded SELECT policies. Record the
   controller timestamp at which the last mutation policy disappeared.
3. **Verify the frozen four-policy manifest.** Run the read-only freeze verifier.
   It must prove exactly four SELECT policies, zero mutations, ten exact buckets,
   no staging bucket, and unchanged object counts.
4. **Drain signed upload tokens and prove stable counts.** RLS removal does not
   revoke tokens already issued by `createSignedUploadUrl`: Supabase says those
   tokens remain valid for two hours, and `uploadToSignedUrl` needs no
   `storage.objects` RLS permission. Starting from the phase-1 removal
   timestamp, wait at least **2 hours 10 minutes** (two-hour TTL plus the
   manifest-pinned 10-minute grace). Then run
   `amora-engine-v2-storage-freeze-pre.sql` twice at least five minutes apart.
   Both receipts must report the exact same per-bucket and total object counts,
   four policies, and zero mutation policies. Any count change restarts the
   stabilization decision; it is not a reason to edit the expected receipt.
5. **Backup verification and separate hosted restore.** Only after both stable
   freeze receipts, take and verify the pinned logical backup. Its local PGlite
   logical row replay verifies authenticated payload integrity but is not a
   restore rehearsal: the same backup set must also be restored into a
   different disposable hosted Supabase project, where typed schema, defaults,
   checks, triggers, Auth and Storage metadata, RLS, RPC/ACL, row counts, and
   canonical digests are verified. Neither a local-only receipt nor a
   same-project reset opens the production gate.
6. **Apply all 27 migrations.** Keep the global database write fence installed.
   Run the pre-check, apply exactly the hash-pinned
   versions `20260716090000` through `20260716117000`, and do not admit traffic.
   Migration 1130 must create and verify both the deletion-aware Storage
   predicate and the permanent bridge to the temporary global release fence.
   Migration 1170 must preserve the exact reviewed Auth-FK inventory, anonymize
   retained couple/chat identifiers with validated `ON DELETE SET NULL`, and
   keep vendor ownership as the validated deletion blocker.
7. **Create staging and finalize Storage.** First apply the complete ordered
   `vendor-disclosure-v2-20260718.json` successor manifest
   through migration `20260802157000`; do not cherry-pick only the Storage
   migrations. In that train, the Storage-affecting migrations are
   `20260802134000_close_dormant_guestbook_public_surface.sql`,
   `20260802143000_close_empty_dormant_storage_buckets.sql`, and
   `20260802157000_harden_chat_image_bucket_upload_limits.sql`. Migration 1430 must
   prove `cohort-images`, `invitation-photos`, and `user_photos` all exist and
   contain zero objects before it makes them private. All five dormant buckets
   must now be `public=false`; migration 1570 must prove `chat-image` remains
   private and starts from the captured null/null metadata contract, the exact
   10 MiB/image-only fresh-bootstrap state, or an exact retry before it sets the
   3 MiB/image-only limits. Never start the successor
   train before the inventory, freeze receipts, and release pre-check, which
   intentionally pin the old prestate. Create private
   `community-media-staging` at 6 MiB with the exact JPEG/PNG/GIF/WebP allowlist
   and no policies. Then reproduce `apply.sql` in Dashboard: remove the frozen
   four SELECT policies and create exactly the one strict guarded chat INSERT.
   Run
   `verify.sql`, `amora-engine-v2-storage-final-post-push.sql`, then the release
   post-check. All must prove
   `public.production_storage_writes_allowed() = false`; any mismatch is a hard
   stop.
8. **Hosted-clone canary.** Before production writes can open, apply the exact
   candidate manifest to a disposable hosted Supabase project. With its
   temporary fence intentionally lifted, an authenticated direct upload to the
   exact own-couple path must succeed, while another-user folder, non-UUID
   filename, non-current membership, retired bucket, update, and delete probes
   must fail without residue. The probe must also prove that known-length and
   chunked/no-`Content-Length` bodies over 3 MiB cannot persist, record that a
   declared image MIME is not byte-content validation, and exercise repeated
   and abandoned uploads. This is mandatory because local SQL insertion does
   not model the hosted Storage API's `INSERT ... RETURNING *` or edge body-size
   behavior. Do not present the direct policy as a complete upload-security or
   cost-control boundary.

   Supabase documents SQL bucket creation but separately advises treating the
   Storage schema as read-only. Therefore migration success alone is not an
   operational receipt for this metadata transition: the disposable hosted
   clone must confirm the exact values through the official bucket API and
   prove the allow/deny cases through actual Storage uploads. If the hosted
   service does not honor the SQL metadata update, stop and perform an explicitly
   reviewed Dashboard or official `updateBucket` transition instead; do not open
   either production write fence.
9. **Deploy clients and cron with both fences closed.** Deploy the compatible
   web/API, confirm
   `CRON_SECRET`, `SUPABASE_EXPECTED_URL`, `SUPABASE_EXPECTED_PROJECT_REF`,
   `SUPABASE_PRODUCTION_PROJECT_REF`, and the project-scoped
   `SUPABASE_PRODUCTION_WRITE_CONFIRM=RUNTIME_WRITE:<ref>` fence; then confirm
   exactly one cleanup schedule at `*/15 * * * *`.
   Produce a signed real-device iOS/Android build pointed at the same production
   URL and Supabase project; simulator-only evidence is insufficient. Run the
   production canary in read-only mode and re-run the final Storage receipt.
10. **Keep the Storage write fence closed pending quota/sanitation work.** The
    current direct INSERT policy has no atomic per-user/couple object-count or
    cumulative-byte quota, and bucket MIME matching validates only the declared
    request type. Hosted compatibility probes may temporarily lift a disposable
    clone, but production must remain fail-closed until a separately reviewed
    server-owned upload/finalize flow validates bytes, decodes and re-encodes
    images, atomically reserves quota, binds each final object to a message, and
    reaps abandoned/orphaned objects. A positive path-only canary is not enough
    to authorize production lift. Never use the 19-policy emergency restore as
    an automatic rollback.

## Authenticated Storage negative probes

Use a disposable hosted clone, a disposable authenticated user, and random UUID
paths. Keep the user access token and service key in local environment
variables; never print them. Never run adversarial probes against production.

First prove the provisional chat contract through the real hosted Storage API:

- authenticated `upload()` to
  `chat-image/{current_couple_uuid}/{auth.uid()}/{uuid}.png` succeeds exactly
  once and returns metadata;
- the same upload with another user's second folder, a stale/non-bilateral
  couple, a non-canonical couple folder, or a non-UUID filename fails and leaves
  no row/object; and
- authenticated read/update/delete and anonymous upload/read remain denied.

If the positive upload returns 403 because the Storage API cannot return the
inserted metadata, the one-policy manifest is rejected. Review a strict
same-path SELECT companion or server-signed flow, update the exact semantic
manifest/hash/count, and rerun every probe. Do not add a public or bucket-wide
SELECT.

With the user client, all of these must also return an RLS denial and leave no
object:

- unsigned `upload`, `update`, and `remove` in `community-images`;
- unsigned `upload`, `update`, and `remove` in `community-videos`;
- unsigned `upload`, `update`, and `remove` in
  `community-media-staging`, including a path belonging to that user;
- the same mutations with an anonymous client.

With the service client on the clone, create one exact signed staging URL,
upload through that token, and delete the fixture. That positive control must
succeed. Then query object counts and names for the random fixture prefix only
and prove the failed user operations created nothing. Redact token, key, user
ID, and exact object path from stored logs.

## Hosted-clone canary

- Finalize a JPEG containing EXIF/XMP test secrets. The public output must
  decode, contain no metadata blocks, and not contain the secret bytes.
- Confirm the source preflight returns strict `206` and an exact
  `Content-Range`. Force a `200` or missing/inconsistent header on the clone;
  finalize must stop before decoding or publishing.
- Finalize a valid PNG with an appended script/polyglot tail. The output must
  decode and the tail must be absent.
- Submit a magic-prefix-only fake PNG, a truncated image, a MIME mismatch, and
  a highly compressed image exceeding 24 million decoded pixels. Each must fail
  closed with no public URL or final object.
- Upload a GIF above 4.5 MiB but at or below 6 MiB directly to Storage and
  finalize it. A byte above 6 MiB must be rejected before upload.
- Interrupt after final publish but before DB completion. Recovery must read and
  validate all final bytes; corrupting the final object must produce a retryable
  failure, never completion.
- Start two finalizes concurrently. At most one claim publishes; the other gets
  the completed result or a bounded 409 retry response.
- After completing, replay the still-valid signed token into staging. After
  expiry plus five minutes and one cron run, staging must be absent,
  `token_cleanup_at` set, and session status still `completed`.
- Finalize but do not create a post. After the 24-hour threshold and cleanup,
  the final object must be absent and the exact leased session checkpointed.
  A session attached to a post, poll option, or cohort message must not be
  claimed or deleted.
- Create/update a consumer with a missing, foreign-owner, already-attached, or
  cleanup-leased URL. The whole consumer transaction must fail.
- Verify the cron response and logs contain counts only—not object path, signed
  token, user ID, content digest, or service key.

## Failure and rollback

Prefer a forward fix. If finalize is unhealthy but staging cleanup is healthy,
disable new upload entry points while keeping staging private for diagnosis.
Never make staging public or restore direct client writes as a shortcut.

The default rollback is
`community_upload_service_fence_rollback.sql` followed by its read-only
`_rollback_verify.sql`. It disables the final write, safely handles a regenerated
policy-name suffix, and converges to zero policies. In this phase-2 rollback,
both mutations and broad public reads remain removed. The separate
`storage_global_write_freeze_rollback.sql` is phase-1 recovery only: before the
privacy contraction it preserves the exact four historical reads while keeping
all mutations disabled. Keep the global database fence installed. There is no
automatic phase-2 compatibility restore for the four public reads. Neither the
safe rollback nor its verifier weakens bucket metadata, so the `chat-image`
size/MIME fence remains in force and all five dormant buckets remain private.

Only for an explicitly approved, time-bounded incident may an operator use
`community_upload_service_fence_emergency_rollback.sql`, followed immediately
by `_emergency_rollback_verify.sql`. That pair restores/proves all 19 insecure
historical policies and reopens public reads and unsigned mutations. It is never
an automatic/controller rollback. The emergency operation is policy-only and
does not set any dormant bucket back to public; its verifier requires all five
to remain private.
Keeping a non-empty staging bucket private is safer than deleting it.

## Account deletion interaction

Account deletion must not remove Auth before durable upload sessions and their
signed-token replay window are drained. The exact job/manifest/worker contract,
manual-review path, backup inventory, and remaining legal gates are in
[`ACCOUNT_DELETION_STORAGE_SAGA.md`](./ACCOUNT_DELETION_STORAGE_SAGA.md).
Never install the final chat INSERT policy before migration 1130 and its helper
ACL/body postcondition have passed, or before migration 1140 has proven the
bilateral current-couple path helper. The pre-backup freeze is helper-independent;
the final policy is deliberately DB-first, denies uploads after deletion intake
has committed, and remains inert until the separate production database fence
is intentionally lifted.

## Monitoring and residual risk

- Monitor attempt-limit denials, sanitation rejection reason, finalize latency
  and memory, 409/503 rate, token-cleanup backlog/oldest age, unattached-cleanup
  backlog, Storage growth, and public egress.
- Public final reads still permit scraping and egress abuse. The write fence
  does not solve that product/business risk.
- The account ceiling is 50 attempts × 6 MiB = 300 MiB per rolling 24 hours
  before protocol overhead. Multi-account abuse still needs account/device and
  anomaly controls.
- Image decoding materially reduces metadata/polyglot/decompression risk, but
  it is not a general malware scanner. Video remains disabled until it receives
  equivalent treatment.

Primary platform references:

- [Vercel request-body limit and direct-upload guidance](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions)
- [Supabase signed upload URL](https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl)
- [Supabase upload to signed URL](https://supabase.com/docs/reference/javascript/storage-from-uploadtosignedurl)
- [Supabase signed-upload RLS requirements (Python reference)](https://supabase.com/docs/reference/python/storage-from-uploadtosignedurl)
- [Supabase upload 403 and `INSERT ... RETURNING *` SELECT requirement](https://supabase.com/docs/guides/troubleshooting/storage-error-403-forbidden-new-row-violates-row-level-security-policy-on-upload-a94384)
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
