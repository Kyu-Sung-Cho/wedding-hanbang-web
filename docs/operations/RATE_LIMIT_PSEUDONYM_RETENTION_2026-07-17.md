# Rate-limit pseudonym and retention contract

Status: implemented locally; not yet applied to production.

## Why this exists

`rate_limit_buckets.key` is an internal service-only identifier, but historical
application versions composed it from a route label plus a user ID, IP address,
or normalized email. RLS prevented public access, yet storing those subjects in
plain text was unnecessary.

The current application now derives every subject key as:

- `label:hmac-sha256:<64 lowercase hex>` when `RATE_LIMIT_KEY_SECRET` exists;
- `label:sha256:<64 lowercase hex>` only in local/test environments without the
  secret.

The label is domain-separated into the digest, so the same subject used for
signup and password recovery does not share a digest. Email-specific call sites
use the same helper instead of building a raw string.

Production release is blocked unless `RATE_LIMIT_KEY_SECRET` is a distinct,
non-placeholder value of at least 32 characters. Secret rotation intentionally
starts new rate-limit buckets, so rotate only during an approved incident or
maintenance window.

## Production read-only evidence

On 2026-07-17 KST, a read-only linked-project query reported:

- 7 total rows and all 7 already expired;
- 0 HMAC/SHA-formatted rows because production still runs the previous code;
- 0 email-shaped rows;
- 3 UUID-shaped rows;
- no key values were selected or printed.

This is evidence for the bounded cleanup, not authorization to write production.

## Database migration

`20260716115000_rate_limit_pseudonym_retention.sql`:

1. applies 5-second lock and 30-second statement timeouts;
2. refuses the release-time cleanup if more than 1,000 expired rows exist;
3. deletes only buckets whose window has already expired;
4. adds a `reset_at` cleanup index;
5. changes opportunistic random cleanup to deterministic batches of at most 128
   expired rows per call;
6. rejects empty, oversized, null, or out-of-range RPC arguments;
7. retains `service_role`-only execution.

An active raw key from an old application instance is deliberately preserved
until its window expires. This keeps a DB-first rolling deployment compatible;
the next call removes it after expiry. A later contract migration may reject
non-pseudonymous formats only after the old application revision is fully gone.

## Availability and rollback

Persistent rate limiting now defaults to fail-closed. A shared-store failure
returns 503 instead of granting an instance-local allowance that can be bypassed
by moving between serverless instances. An endpoint must explicitly pass
`failClosed: false` to accept that risk.

The migration deletes only expired operational buckets; restoring them would
incorrectly resurrect elapsed limits. Roll back application behavior by
redeploying the prior revision. Restore the database only as part of a wider
verified point-in-time recovery, not to recover expired bucket rows.

## Verification

- rate-limit unit tests prove HMAC/SHA pseudonymization, domain separation,
  spoof-resistant trusted-hop selection, and fail-closed defaults;
- PGlite executes the migration, preserves an active legacy window, removes
  expired legacy rows, exercises the service RPC, and verifies bounded cleanup;
- the production environment gate prints booleans only and never secret values.
