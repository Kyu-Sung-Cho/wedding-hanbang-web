# Hosted Storage policy operations

These chat-attachment changes are intentionally outside `supabase/migrations`.
Hosted Supabase owns `storage.objects` as `supabase_storage_admin`; the project
`postgres` role used by the SQL editor and normal database migrations cannot
create or drop its RLS policies. Keeping these files in the automatic migration
directory would make a production push fail with `must be owner of relation
objects`.

The SQL files in this directory are executable source-of-truth for local PGlite
tests. On a hosted project, reproduce each named policy in **Dashboard > Storage
> Policies > chat-image**. Never change the owner of Supabase-managed storage
tables.

## Expand (before the compatible app deploy)

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
