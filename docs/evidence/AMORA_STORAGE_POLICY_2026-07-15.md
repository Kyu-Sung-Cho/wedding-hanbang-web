# Amora hosted Storage policy evidence — 2026-07-15 KST

## Scope

- verification project: isolated production restore clone
  `syhmfxauqyhgdcokrheg`;
- bucket: `chat-image`;
- production Storage was not changed while collecting this receipt;
- no database password was read, reset or required.

## Dashboard operation

The clone initially exposed five legacy policies: public read, broad
authenticated upload, and couple-folder insert/update/delete. The Dashboard
created the strict immutable-upload policy with its generated display name:

`chat-image own uploader folder write pf46ue_0`

The base name, `authenticated` role, `INSERT` command and `WITH CHECK`
expression match
`supabase/platform-operations/storage/20260714162000_chat_attachment_expand.sql`.
Supabase Dashboard appends the final identifier automatically. No uploader
`SELECT`, `UPDATE` or `DELETE` policy was created because those operations
would widen access beyond the signed-URL-only read boundary.

For final-contract verification on the isolated clone, the five legacy
policies were removed and the bucket's public toggle was confirmed off. The
only remaining `chat-image` policy was the strict immutable-upload policy.

## Hosted synthetic contract result

Synthetic accounts and an object were created through the hosted Auth, REST
and Storage APIs, then deleted in cleanup. The result was
`PREVIEW_STORAGE_CONTRACT_VERIFIED` with every assertion true:

- caller upload to `{couple_id}/{auth.uid()}/{opaque_file_name}` succeeded;
- partner-folder upload was denied;
- legacy two-segment layout was denied;
- encoded traversal was denied;
- partner overwrite and owner overwrite were both denied;
- direct authenticated and anonymous reads were denied;
- service-authorized signed URL creation and signed read succeeded.

This proves the hosted final policy boundary on the isolated clone. Production
still requires a fresh inventory and rollback receipt immediately before its
separately gated expand/contract operation.
