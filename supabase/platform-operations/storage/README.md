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
Create all three policies for the `authenticated` role:

1. `chat-image own uploader folder write` (`INSERT`, policy expression goes in
   `WITH CHECK`)
2. `chat-image own uploader folder update` (`UPDATE`, expressions go in `USING`
   and `WITH CHECK`)
3. `chat-image own uploader folder delete` (`DELETE`, policy expression goes in
   `USING`)

Do not remove legacy policies during expand. Verify a new upload is stored as
`{couple_id}/{auth.uid()}/{opaque_file_name}` and can be read only through the
authorized signed-URL API.

## Contract (only after web/mobile canary)

Use `20260714167000_chat_attachment_contract.sql` as the checklist:

1. Confirm all three strict policies above exist.
2. In **Storage > Files > chat-image > configuration**, make the bucket private.
3. Remove every legacy policy named in the contract file, including
   `Anyone can view chat image` and `Authenticated users can upload chat image`.
4. Keep the three `chat-image own uploader folder ...` policies.
5. Re-run signed-read, own-upload, partner-overwrite, anonymous-read, traversal,
   and legacy-read tests. Partner overwrite, anonymous read, and traversal must
   fail; legacy objects must remain readable only via the authorized signing API.

The expand and contract actions edit cloud access permissions. Take a policy
inventory first and preserve a rollback copy before changing production.
