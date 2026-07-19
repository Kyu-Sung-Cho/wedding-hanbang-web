# Price combo direct-write fence

Date: 2026-07-19
Release: `vendor-disclosure-v2-20260718`
Successor migration: `20260718209000_price_combo_direct_write_fence.sql`
Status: local contract verified; hosted staging and production evidence missing

## Threat closed by this change

An authenticated Supabase client previously had direct `INSERT` and `UPDATE`
privileges on `public.combos`. A caller could therefore bypass the Next API's
body-size limit, exact JSON parser, public-catalog repricing, per-user rate
limit, and idempotency handling by writing to PostgREST directly.

The successor migration removes direct `INSERT` and `UPDATE` from both
`authenticated` and `service_role`. Authenticated users retain only owned
`SELECT` and `DELETE` through two explicit RLS policies. New saves go through
`public.save_price_combo_service_v1`, whose `EXECUTE` privilege is granted only
to `service_role` and whose body rejects a non-service JWT role.

The RPC independently enforces:

- exactly the `studio`, `dress`, and `makeup` selection slots;
- exact per-selection and per-option keys, bounded integer won values, UUIDs,
  option counts, trimmed names, and no duplicate option name;
- a current public price for each exact vendor/category/agency/base-price tuple,
  where `agency_id: null` means a direct price and is never a wildcard;
- a current public option with the exact stored name and price on that one
  deterministically selected `official_price_id` (never another agency's row);
- an exact recomputed `total_krw`;
- one `(user_id, idempotency_key)` result and a request-hash conflict on key
  reuse.

The Next route still authenticates the end user, rate-limits the request,
validates the request body, reprices from public views, and then invokes the RPC
with the destination-fenced server client. Admin-client construction failure,
RPC error, or an error-free null RPC result returns a fail-closed `503`.

## Local evidence

The PGlite contract test proves that:

- authenticated direct `INSERT` and `UPDATE` fail;
- service-role direct `INSERT` also fails;
- authenticated RPC execution fails;
- the service-only RPC saves once and replays once;
- key reuse with a different hash, unknown JSON keys, an unpublished option,
  and a wrong total all fail;
- an owner can read and delete their row while another user's row remains
  hidden and undeletable.

The hosted RLS probe now treats a successful authenticated combo `POST` or
`PATCH` as a security failure. Its deterministic no-row `DELETE` confirms the
PostgREST delete transport remains available without deleting long-lived
fixtures; the PGlite test supplies the exact positive owner-delete proof.

## Deployment order and rollback policy

This migration and the compatible web artifact form one fenced release unit.
Applying only one side creates a temporary combo-save outage: the old route
needs table `INSERT`, while the new route needs the RPC. Therefore:

1. Keep the production database write fence closed.
2. Verify the exact migration and web artifact in dedicated hosted staging.
3. Capture and independently verify the required backup and restore evidence.
4. Apply the hash-pinned migration while the write fence remains closed.
5. Deploy the compatible web artifact and run negative/positive canaries.
6. Open writes only after every gate and canary passes.

Rollback is forward-fix only. Do not restore authenticated or service-role
direct `INSERT`/`UPDATE` privileges. If the RPC or route fails, keep writes
closed, deploy a reviewed successor function/application fix, and rerun the
same staging and canary contract. Owned `SELECT`/`DELETE` may remain available
only when the wider production write-fence procedure permits them.

## Hosted evidence still required

Production remains **NO-GO** until a dedicated non-production Supabase project
applies the exact manifest and records all of the following against one clean
commit:

- migration ledger head `20260718210000` and exact successor-set SHA-256;
- authenticated direct `/rest/v1/combos` `POST` and `PATCH` denied;
- authenticated own `GET` and positive own `DELETE` succeed, with cross-user
  reads/deletes affecting zero rows;
- authenticated RPC execution denied and service-only RPC save/replay works;
- malformed shape, unpublished price/option, wrong total, and idempotency-key
  reuse fail closed, including a direct-price attempt to mix a same-name option
  from another agency's `official_price_id`;
- regenerated database types from the applied hosted schema;
- verified backup, different-project restore, deployment, and canary receipts.

No hosted staging project, backup/restore receipt, or production authorization
is created by this local change.
