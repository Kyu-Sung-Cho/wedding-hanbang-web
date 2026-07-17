# AI log retention ACL emergency hotfix

> **CURRENT EXACT-ACL STATUS: NOT RUN / UNVERIFIED.** The earlier 10:40
> emergency ACL receipt is dated evidence only. The exact 14:10 inventory,
> apply and verify set may run only inside Phase 1 of
> `PRODUCTION_WRITE_FENCE_2026-07-17.md`, with every production fence active.
> Do not execute an independent `--linked` apply from this document.

## Production application record

The ACL-only hotfix was applied to the pinned production project on
**2026-07-17 10:40 KST**. The read-only verification returned
`ai_log_retention_acl_verified = 1`.

The operation did not execute `public.redact_old_ai_interactions(interval)`.
It did not insert, update, or delete application data; it changed only the
function ACL. `PUBLIC`, `anon`, and `authenticated` execution is removed, and
`service_role` execution remains available.

This 10:40 record refers only to the immutable `20260717103000_*` SQL set.
That first operation did not inventory or remove grants to project-specific
roles. It therefore does **not** prove that the complete EXECUTE grantee set is
exactly `postgres` plus `service_role`.

## Exact-ACL forward verification

The separate `20260717141000_ai_log_retention_exact_acl_*` operation is the
forward-only closure for that remaining gap. Its current production state is
`NOT RUN / UNVERIFIED`. The safe state is exactly:

- `execute_grantees = {postgres,service_role}`;
- `service_role_grantable = false`;
- owner `postgres`; and
- `SECURITY DEFINER = true`.

Inside the authoritative write-fence Phase 1 only, run the manifest-pinned
inventory → apply → verify sequence once. The apply revokes every explicit
non-owner grant (including unknown custom roles and dependent grants) and then
grants non-grantable EXECUTE to `service_role`. It never invokes the redaction
function and never mutates application rows. Record the three SQL SHA-256
values, destination, execution time, and result digest in a new receipt; do not
reinterpret the 10:40 receipt as evidence for this stronger contract. A failed
or ambiguous apply is a release stop and must not be retried independently.

## Why this is a release blocker

The production function `public.redact_old_ai_interactions(interval)` is a
`SECURITY DEFINER` mutation. Before the hotfix, its ACL granted `EXECUTE` to
`PUBLIC`, `anon`, and `authenticated`, while its body accepted an arbitrary
interval. An untrusted caller could therefore request a negative or very short
interval and redact raw AI input/output across tenants.

This is an existing production integrity vulnerability. It is independent of
the Amora Engine v2 release and must be closed before normal release work.

## Scope of the emergency change

The hotfix changes function privileges only:

- revoke all function privileges from `PUBLIC`, `anon`, and `authenticated`;
- preserve/grant `EXECUTE` for `service_role`;
- do not execute the function;
- do not update, delete, or insert any row;
- do not change the function body in the emergency operation.

The pending migration
`20260716116000_ai_log_retention_contract.sql` now replaces the body with the
exact 90-day argument check, empty `search_path`, fully qualified update, and
the same service-only ACL. It must be hash-pinned only when the release SQL set
is frozen; this emergency operation did not modify the release manifest.

## Destination and preconditions

- linked project ref must equal `slrtobkksjmxgzatjyqb`;
- remote migration head must remain `20260715210000`;
- the Supabase physical backup dashboard must show a completed backup;
- the read-only current-production baseline self-test must be verified;
- the inventory query must show the function exists, is owned by `postgres`, is
  `SECURITY DEFINER`, and remains executable by `service_role`.

Inventory and verification output contains booleans and a definition digest,
not AI content or user identifiers.

## Apply and verify

Do not run this operation from a copied standalone command block. Use only the
exact Phase 1 sequence and private receipt requirements in
`docs/operations/PRODUCTION_WRITE_FENCE_2026-07-17.md`. The current release
manifest pins all three SQL files and the release controller rejects drift.

## Recovery rule

Do not restore `PUBLIC`, `anon`, or `authenticated` execution as a rollback;
that would recreate the vulnerability. The application uses `service_role`,
which the hotfix preserves. If verification unexpectedly reports that the
service role lost access, the only permitted recovery is:

```sql
GRANT EXECUTE ON FUNCTION public.redact_old_ai_interactions(interval)
TO service_role;
```

Any additional internal role must be reviewed and granted explicitly. A
forward fix is required for all other issues.

## Still not approved by this hotfix

- running the redaction function;
- choosing or publishing the AI-log retention period;
- enabling `AI_LOG_RETENTION_CRON_ENABLED` in production (the registered daily
  route remains a no-op while the flag is false or missing);
- scrubbing the historical `account_deletions` row;
- applying the Amora Engine v2 migrations or deploying the application.
