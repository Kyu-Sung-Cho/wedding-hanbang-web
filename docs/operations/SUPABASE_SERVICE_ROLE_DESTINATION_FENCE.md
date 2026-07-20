# Supabase service-role destination fence

> **Status: candidate code locally tested; exact production builder and current
> deployment receipt NOT RUN.** Existing production configuration or an older
> deployment does not prove this candidate fence is active. See
> `CURRENT_WORKSPACE_HANDOFF_2026-07-20.md`.

This fence prevents a contaminated environment from pairing a privileged key
with the wrong hosted Supabase project. It is a startup/client-construction
gate; it does not replace route authentication, ownership checks, RLS, backup
receipts, or the production migration controller.

## Required runtime variables

Set all values explicitly in every environment that has a service-role key:

```text
NEXT_PUBLIC_SUPABASE_URL=https://<20-character-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<secret; never print or commit>
SUPABASE_EXPECTED_URL=https://<20-character-ref>.supabase.co
SUPABASE_EXPECTED_PROJECT_REF=<20-character-ref>
SUPABASE_PRODUCTION_PROJECT_REF=<20-character-production-ref>
```

`SUPABASE_EXPECTED_URL` and `SUPABASE_EXPECTED_PROJECT_REF` form a singleton
destination allowlist. The configured URL must be one exact HTTPS origin with
no credentials, port, path, query, or fragment, and its hostname ref must match
the expected ref.

When the expected ref is the production ref, normal API runtime writes also
require this non-secret exact confirmation:

```text
SUPABASE_PRODUCTION_WRITE_CONFIRM=RUNTIME_WRITE:<production-ref>
```

Local destructive integration scripts use a different
`OPERATOR_WRITE:<production-ref>` intent. They retain their existing stronger
synthetic-fixture confirmation or refuse production unconditionally. Read-only
cost/media audits do not need a write confirmation, but still require the exact
URL/ref allowlist and credential validation.

## Credential checks

- Legacy JWT keys must declare `role=service_role` and the exact project `ref`.
  The accepted issuer is `supabase` or the pinned project's Auth URL. An
  optional audience must contain `authenticated` or `service_role`; an expired
  token is rejected.
- New opaque keys are accepted only in the `sb_secret_...` form. Their project
  cannot be decoded locally, so URL/ref pinning and the production confirmation
  remain mandatory; Supabase performs the actual credential authentication.
- JWT payload inspection is a destination preflight, not a local signature
  verification. The remote project still verifies the signature. No key or JWT
  payload is included in errors, receipts, or logs.

The Next.js instrumentation hook validates the destination before a server
instance handles requests, and `createAdminClient()` repeats validation for
every privileged client. A source-scan regression test prevents routes from
constructing raw service-role clients again.

## Deployment and rollback behavior

Before a production deployment, add the four non-secret pin/confirmation
variables to the same Vercel Production scope as the service-role key.
`scripts/check-amora-build-env.mjs` must run as the first `apps/web` build step
inside the actual exact-commit Vercel Production builder; it invokes
`check-amora-production-env.mjs` and the boolean-only builder log must be kept as
the receipt. Local `vercel env run -e production` is not production-environment
evidence in this workspace. Do not copy Production values into Preview;
Preview must pin its own isolated project while still declaring the Production
ref for comparison.

If any pin or confirmation is absent or mismatched, privileged operations fail
closed. Removing the confirmation is therefore an immediate write kill switch.
For a planned project migration, rotate URL, expected URL, expected ref, key,
and confirmation together in one reviewed deployment; never loosen the parser
or add a second implicit destination.

Database backup/restore and schema deployment do not use this service-role
client. They keep their separate explicit linked-ref, manifest, backup receipt,
CLI hash, and production confirmation gates.
