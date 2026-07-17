# AI log retention cron boundary (2026-07-17)

## Current status

The application boundary is implemented but **not enabled**. This work did not
change a production environment variable, execute the database function,
deploy the application, or modify a release manifest.

`AI_LOG_RETENTION_CRON_ENABLED=false` is the documented release default. A
missing value is also a runtime no-op. Only the exact, case-sensitive value
`true` permits the destructive service-role RPC.

For auditable production configuration, the production build gate requires an
explicit lowercase `true` or `false`; missing and malformed values fail the
build even though an already-running deployment remains safely disabled when
the variable is missing.

## HTTP and scheduler contract

- `GET /api/cron/ai-log-retention`
- requires `Authorization: Bearer <CRON_SECRET>` even while disabled;
- returns `401` before constructing a service client when authentication fails;
- returns `{ ok: true, enabled: false, status: "disabled" }` without any DB
  call when the flag is missing or is not exactly `true`;
- creates the destination-fenced admin client only after authentication and
  enablement checks;
- calls `redact_old_ai_interactions` once with
  `{ p_retention: "90 days" }`;
- accepts only a non-negative safe-integer redaction count;
- returns a generic `500` without a database error, credential, query, or row
  detail when client creation, RPC execution, or result validation fails; and
- sets `Cache-Control: no-store` on every response.

Vercel invokes the endpoint once daily at `30 18 * * *`, which is 18:30 UTC
and 03:30 KST on the following calendar day. The registered schedule does not
override the disabled kill switch.

## Duplicate and concurrency review

No additional claim table or migration is required for this daily boundary:

1. each HTTP request issues exactly one RPC;
2. the function changes only rows whose metadata does not already contain
   `retention_policy = raw_payload_90d`;
3. the same atomic `UPDATE` writes that marker with the redaction; and
4. if two PostgreSQL `READ COMMITTED` updates overlap, the later updater waits
   for the row lock and re-evaluates the predicate against the updated row, so
   a row already marked by the first execution is skipped.

Consequently duplicate scheduler delivery can change an eligible row at most
once and a later run can safely report zero. A durable claim must be designed
before introducing parallel batches, external side effects, or a function
that no longer uses the atomic marker predicate. This retention boundary
remains migration `20260716116000`, and the cron change itself adds no migration
number. The complete release candidate now contains exactly 27 pending
migrations through `20260716117000`; the release-wide range must not be inferred
from this cron boundary alone.

## Gates before enablement

Keep `AI_LOG_RETENTION_CRON_ENABLED=false` until all of these are recorded:

1. legal and business approval of the exact 90-day raw-payload policy;
2. a frozen, hash-verified 27-migration release through `1170` that contains
   retention migration `1160`;
3. fresh production backup verification and a separate restore of the same
   authenticated backup set into a different disposable hosted Supabase
   project, including typed schema, Auth/Storage metadata, RLS, and RPC/ACL
   checks; a local PGlite logical row replay alone is not a restore rehearsal;
4. post-migration proof that the function has an empty `search_path`, is owned
   by `postgres`, and is executable only by `service_role`;
5. a read-only eligible-row count and reviewed low-traffic execution window;
6. a rollback owner and monitored first-run canary.

Enablement is an explicit production operation. Set the environment flag to
the exact value `true` only after those gates pass and deploy that environment
change. To stop future runs, return the flag to `false` and deploy; do not
restore `PUBLIC`, `anon`, or `authenticated` function execution.

## Automated evidence

`apps/web/src/app/api/cron/ai-log-retention/route.test.ts` covers disabled
no-op behavior, authentication, exact flag parsing, exact one-call RPC input,
generic error containment, result validation, and the single daily schedule.
The runtime and production environment contract tests keep the new flag in
Turborepo's build inputs and in the fail-closed environment example.
