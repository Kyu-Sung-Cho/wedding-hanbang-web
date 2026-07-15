# Vendor public RLS hotfix

## Purpose

Production contained three manually created SELECT policies that were absent
from repository migrations:

- `public.vendors.vendors_read` with `USING (true)`;
- `public.vendor_products.products_read` with `USING (true)`;
- `public.vendor_images.images_read` with `USING (true)`.

PostgreSQL combines permissive RLS policies with OR. These policies therefore
bypassed the existing approval-scoped policies and exposed pending or rejected
vendor rows and their products to the anonymous PostgREST role.

`20260715210000_harden_vendor_public_read_policies.sql` removes only those three
policies. It does not read or mutate vendor rows, statuses, products, or images.

## Pre-apply gate

1. Confirm the working tree is based on the current `origin/main`.
2. Confirm `supabase migration list --linked` has no remote-only migration.
3. Confirm the latest provider physical backup is `COMPLETED` and Restore is
   available.
4. Export the current `pg_policies` rows for `vendors`, `vendor_products`, and
   `vendor_images` without exporting table data.
5. Run the focused migration test, web typecheck, and the full web test suite.
6. Review the exact dry-run pending list. It must contain only this migration.

## Apply

Apply through the guarded Supabase migration path. Do not paste a partial policy
change into SQL Editor. The migration takes all three table locks in a fixed
order and contains an explicit `BEGIN`/`COMMIT` transaction boundary. A lock
timeout, missing table, disabled RLS, missing approval policy, or surviving
unconditional public policy aborts the whole transaction.

## Safe rollback

The pre-migration `USING (true)` policies are the vulnerability and must not be
recreated as an availability rollback.

- Before commit: PostgreSQL automatically rolls back every policy drop if any
  statement or verification fails.
- After commit: if approved vendor reads regress, roll forward by repairing the
  existing approval-scoped policy named by the failed verification. Do not
  recreate `vendors_read`, `products_read`, or `images_read`.
- Disaster recovery: use the completed provider physical backup only for a
  broader database failure. A physical restore for this metadata-only change
  would also rewind unrelated production writes and is not the normal rollback.

## Post-apply canary

1. Run `pnpm supabase:vendor-security:probe` with the production URL and anon
   key supplied only through the current process environment.
2. Confirm no non-approved vendor is visible.
3. Confirm every anonymously visible product and image belongs to an
   anonymously visible approved vendor.
4. Query `pg_policies` through the Management API and confirm the three drift
   policy names are absent.
5. Confirm `/api/vendors` and the vendor page still return successfully.

## Remaining boundary

RLS restricts rows, not columns. Before any vendor is approved or a public
catalog is imported, split public vendor facts from owner, compliance, bank,
review, and internal moderation fields. Approval of a row in the current mixed
table can otherwise make private columns selectable through direct PostgREST.
