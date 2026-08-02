# Chat-image server-owned upload fence

Status: code-complete, production operation not executed.

## Security outcome

New chat images are accepted only by the authenticated chat API. The API
validates the claimed MIME against decoded bytes, bounds dimensions and decoded
pixels, re-encodes without EXIF/GPS/ICC/IPTC/XMP metadata, then uses the same
sanitized bytes for private Storage and the AI provider. PDF is fail-closed
until a reviewed sanitizer exists.

The browser no longer uploads to `chat-image`. The final hosted Storage state is
zero `storage.objects` policies. `service_role` retains `BYPASSRLS` and the
required `SELECT`/`INSERT`/`UPDATE` table privileges, so only the server-owned
path can store or idempotently replace a sanitized object.

## Why this is a platform operation

Hosted Supabase owns `storage.objects` as `supabase_storage_admin`. Normal
`supabase db push` migrations and SQL-editor `postgres` sessions cannot safely
create or drop its RLS policies. The forward artifact therefore lives under
`supabase/platform-operations/storage/` and is pinned as the release's
post-push platform operation. Do not copy it into `supabase/migrations` and do
not change the owner of a Supabase-managed relation.

## Required order

1. Keep the global production write fence closed.
2. Deploy the candidate to a disposable hosted clone or isolated staging target
   and canary the server sanitizer/storage path while production remains behind
   the global fence.
3. Run `20260802159000_chat_image_server_upload_fence_inventory.sql` read-only
   and retain the receipt outside git.
4. Through Dashboard > Storage > Policies, reproduce the exact reviewed removal
   in `20260802159000_chat_image_server_upload_fence_apply.sql`. It accepts the
   exact four-read global-freeze state, the reviewed transitional one-policy
   state, or an idempotent zero-policy retry; any other policy state aborts.
5. Run `20260802159000_chat_image_server_upload_fence_verify.sql` and
   `amora-engine-v2-chat-image-server-upload-post-push.sql` read-only. Both must
   show zero Storage policies and zero authenticated mutation policies.
6. Exercise a real hosted probe: an authenticated direct upload must fail; the
   chat API must store a decoded/re-encoded image and return a signed-read path.
7. Only then continue deployment canary/finalizer gates.

## Existing object gate — no automatic deletion

This operation never deletes or rewrites an existing object. Historical
`chat-image` objects may still contain EXIF/GPS or PDF metadata because they
predate the server sanitizer. The repository's captured production baseline
records six chat objects, but that number must be re-verified live before the
operation; it is not treated as current fact without a fresh receipt.

Before claiming legacy metadata removal is complete, run a separate reviewed
job that:

- inventories every legacy and three-segment object without writing raw paths,
  bytes, EXIF values, or signed URLs to logs;
- quarantines undecodable, MIME-spoofed, PDF, and unsupported objects;
- downloads each supported image through service credentials in bounded
  memory, reuses the same decoder/re-encoder and pixel limits, and validates the
  output again;
- writes to a new deterministic private path, atomically updates the owning
  message metadata, verifies authorized signed-read behavior, and only then
  schedules the old object for delayed deletion;
- records counts and hashes rather than personal metadata in the operation
  receipt, with an encrypted pre-change inventory and restore rehearsal.

Until that inventory/quarantine/re-encode gate is executed and verified,
legacy objects remain an explicit residual privacy risk.

## Rollback

`20260802159000_chat_image_server_upload_fence_rollback.sql` is deliberately
fail-closed. It does not restore the authenticated upload policy. If the server
path must be rolled back, attachment uploads remain disabled until a forward
fix ships. Run the companion rollback verification and confirm existing object
counts are unchanged. Reopening client upload is a security regression and is
not an authorized rollback.
