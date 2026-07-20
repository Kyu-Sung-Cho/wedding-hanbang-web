# Vendor disclosure hosted-staging RLS receipt

This probe is an external release prerequisite. It is not a normal CI check,
production authorization, or a substitute for backup, restore, finalizer, and
post-deploy canary evidence.

## Current blocker: no approved dedicated staging project

The repository-owned contract is:

`supabase/release-contracts/vendor-disclosure-hosted-staging-v2-20260718.json`

It is intentionally committed as `approved: false`, `projectRef: null`,
`publicViewDefinitionSha256: null`, and
`status: blocked_pending_dedicated_staging`. Therefore **no environment value
can currently produce a hosted receipt**. This is the safe state until a
dedicated, disposable/non-production Supabase project has been provisioned,
reviewed, and pinned in that file by a separate commit with:

- `approved: true`;
- `status: approved_for_hosted_rls_probe`;
- the exact 20-character staging project ref, different from production; and
- a durable, non-secret change-control identifier in `approvalEvidence`; and
- an exact SHA-256 for each live `pg_get_viewdef(..., true)` result in
  `publicViewDefinitionSha256`, after an authorized reviewer has compared those
  definitions with the pinned migrations. Hashing an unreviewed definition is
  not approval.

The script hashes that contract and its approval evidence into the receipt. A
free-form `SUPABASE_STAGING_PROJECT_REF` cannot override the repository pin.

## What a successful receipt proves

From one clean, exact Git commit, `scripts/vendor-public-rls-probe.mjs` checks:

1. All inherited `GIT_*` variables are removed from every Git subprocess. The
   exact real worktree, Git directory, common Git directory, regular non-symlink
   `HEAD`, ref, commit, and empty porcelain are bound into one hash. Git is
   re-read before the first hosted request, after the management read, before
   policy writes, and immediately before receipt construction.
2. The target URL, environment ref, and repository-approved staging ref are the
   same exact HTTPS Supabase origin and differ from the successor manifest's
   production ref.
3. The shared successor-release validator accepts the exact manifest shape,
   predecessor manifest/hash chain, migration hashes and order, deployment
   status, and complete migration set. The probe does not maintain a weaker
   duplicate release parser.
4. The Supabase Management API `database/query/read-only` endpoint can read the
   hosted staging migration ledger. The ledger contains the manifest's required
   predecessor head exactly once, contains exactly the ordered successor
   versions from `migrationFloor`, and its remote head equals the manifest's
   final successor migration. Missing, malformed, extra, or unverifiable ledger
   data fails closed before fixture authentication.
5. The same read-only query inventories every live column of every listed base
   and owned table. Every base column is queried independently through
   PostgREST as both `anon` and `authenticated`; only `401` or `403` passes.
   Every owned column is independently queried as `anon` with the same rule. A
   wildcard denial cannot conceal a mistakenly granted sensitive column.
6. The management query inventories each public view's ordered columns,
   `security_barrier`/`security_invoker` reloptions, and live
   `pg_get_viewdef`. Ordered columns and security options must equal the local
   allow-list, while the exact definition hash must equal the separately
   reviewed repository pin.
7. Exact approved fixtures are readable from `v_public_vendors`,
   `v_public_prices`, `v_public_price_options`, and
   `v_public_agency_packages` as both `anon` and `authenticated`. The management
   query independently proves their approved/evidence-backed state and, for
   price snapshots, `is_current=true`. Empty public views do not pass vacuously.
8. A full-view invariant query counts every public row whose base relation is
   missing or whose approval, evidence, category, vendor/agency, slug, merge,
   or publication rules are invalid. Every count must be exactly zero; the
   positive fixture alone cannot conceal another leaked row.
9. A separate exact base row for each public view is confirmed by the read-only
   management query to exist in a pending, rejected, draft, needs-review, or
   unpublished state. Its exact id must return zero rows from the corresponding
   public view as both `anon` and `authenticated`.
10. `anon` receives only `401` or `403` for INSERT, UPDATE, and DELETE on
   `vendor_favorites`, `wishlists`, `combos`, and `price_alerts`; per-column GET
   denial is covered separately.
11. Two fixed fixture users can read their own exact rows and cannot read the
   other user's exact rows on all four owned relations. Intentional policy
   probes verify owner and cross-user INSERT/UPDATE/DELETE behavior with
   deterministic temporary rows. Owner INSERT/DELETE passes for
   `vendor_favorites`, `wishlists`, and `price_alerts`; owner UPDATE is allowed
   only for the mutable alert field. Direct owner INSERT and UPDATE on `combos`
   are denied because creation is restricted to the destination-fenced
   server-only save RPC. Cross-user INSERT is denied and cross-user
   UPDATE/DELETE cannot affect rows. The combo DELETE probe targets user A's
   existing fixture as user B, then re-reads that exact row as user A and
   requires it to remain present.
12. Owner and cross-user temporary rows enter independent cleanup paths via
   `Promise.allSettled`. Each path attempts DELETE and then performs its own
   exact zero-row read even if DELETE itself failed. Any failed deletion,
   unverifiable read, or retained row blocks the receipt. For `combos`, the
   owner-delete portion starts with an absent deterministic row because direct
   owner INSERT is intentionally denied. Its zero-row owner DELETE therefore
   proves transport only, not deletion of a real server-created combo; the
   separate cross-user DELETE above does use an existing fixture.

## Separate positive combo gate (not yet evidenced)

The current probe proves direct combo writes are denied, existing owner rows are
isolated, and cross-user mutations cannot affect them. It does **not** call
`save_price_combo_service_v1` through the destination-fenced application
service boundary, create a real combo, delete that exact row as its owner, and
re-read zero rows. A hosted staging receipt covering that sequence is a separate
release prerequisite. Until it exists, service save + owner delete must remain
`BLOCKED_EXTERNAL`; this RLS receipt alone cannot mark that path complete.

The receipt records `productionReadiness: false` and
`deploymentAuthorization: false`. It also binds the staging-contract hash,
successor manifest and migration-pin hashes, remote ledger head and version-set
hash, management-query hash, base/owned-column inventory hashes, exact public
view contract hash, clean repository-binding hash, and secret-free aggregate
fixture-subject hash.

## Fixture preparation (manual, dedicated staging only)

Do not give this probe a service-role key. An authorized operator must prepare:

- two dedicated staging Auth users A and B with distinct ids and passwords;
- distinct approved, active vendor ids A and B;
- one existing `vendor_favorites`, `wishlists`, `combos`, and `price_alerts`
  row owned by each user (the two favorite relations must agree);
- one approved, evidence-backed positive fixture visible in each of the four
  public views;
- one existing negative vendor with `pending`, `rejected`, or `draft` status;
- one existing negative official price with `pending`/`rejected` review status,
  `needs_review=true`, or an unpublished snapshot;
- one existing negative option whose parent price is pending, rejected,
  needs-review, or unpublished; and
- one existing negative agency package that is pending, rejected, needs-review,
  or unpublished.

The cross pairs `user A + vendor B` and `user B + vendor A` must initially be
absent from `vendor_favorites`, `wishlists`, and `price_alerts`; they are
reserved for temporary policy probes. The script derives two deterministic
combo UUIDs from the fixture user ids, verifies that all temporary rows are
absent before writing, and cleans them with the correct owner tokens in all
success and failure paths.

Only the Management API request is read-only. Application-data writes are
strictly limited to these intentional policy probes. Password-grant sign-ins
and the temporary policy writes must never be aimed at production.

## Required inputs

Supply inputs through the process environment or an explicitly selected
`SUPABASE_ENV_FILE`. The script does not auto-load `apps/web/.env.local`.

| Input | Exact requirement |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | exact `https://<approved-staging-ref>.supabase.co` origin; no path, query, credentials, or port |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | staging anon/publishable key; never written to the receipt |
| `SUPABASE_ACCESS_TOKEN` | operator Management API token used only with the staging `database/query/read-only` endpoint; never written to the receipt |
| `SUPABASE_STAGING_PROJECT_REF` | must equal the approved repository pin exactly |
| `SUPABASE_PRODUCTION_PROJECT_REF` | exact production ref; must differ from staging and match both release contracts |
| `RLS_PROBE_EXPECTED_COMMIT` | full 40-character lowercase SHA of the clean checkout |
| `RLS_PROBE_EXPECTED_SUCCESSOR_MIGRATION_SET_SHA256` | SHA-256 of ordered `<file>:<pinned-sha256>\n` records from `expandMigrations` |
| `RLS_PROBE_RECEIPT_OUT` | new absolute path outside Git; parent exists and is not a symlink |
| `RLS_PROBE_PUBLIC_VENDOR_ID`, `RLS_PROBE_PUBLIC_PRICE_ID`, `RLS_PROBE_PUBLIC_OPTION_ID`, `RLS_PROBE_PUBLIC_AGENCY_PACKAGE_ID` | exact approved positive fixture ids for the four public views |
| `RLS_PROBE_NONPUBLIC_VENDOR_ID`, `RLS_PROBE_NONPUBLIC_PRICE_ID`, `RLS_PROBE_NONPUBLIC_OPTION_ID`, `RLS_PROBE_NONPUBLIC_AGENCY_PACKAGE_ID` | exact existing pending/rejected/unpublished negative fixture ids |
| `RLS_PROBE_USER_A_EMAIL`, `RLS_PROBE_USER_A_PASSWORD`, `RLS_PROBE_USER_A_ID`, `RLS_PROBE_USER_A_VENDOR_ID`, `RLS_PROBE_USER_A_COMBO_ID` | dedicated user A and exact owned fixtures |
| `RLS_PROBE_USER_B_EMAIL`, `RLS_PROBE_USER_B_PASSWORD`, `RLS_PROBE_USER_B_ID`, `RLS_PROBE_USER_B_VENDOR_ID`, `RLS_PROBE_USER_B_COMBO_ID` | distinct dedicated user B and exact owned fixtures |

Derive the local migration-set hash without credentials:

```powershell
@'
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const manifest = JSON.parse(readFileSync("supabase/release-manifests/vendor-disclosure-v2-20260718.json", "utf8"));
const contract = `${manifest.expandMigrations.map(({ file, sha256 }) => `${file}:${sha256}`).join("\n")}\n`;
console.log(createHash("sha256").update(contract.replace(/\r\n?/g, "\n")).digest("hex"));
'@ | node --input-type=module
```

Before approving the staging contract, an authorized reviewer can collect the
four canonical live definitions with a read-only SQL session:

```sql
SELECT
  relation.relname AS view_name,
  pg_catalog.pg_get_viewdef(relation.oid, true) AS definition
FROM pg_catalog.pg_class AS relation
JOIN pg_catalog.pg_namespace AS namespace
  ON namespace.oid = relation.relnamespace
WHERE namespace.nspname = 'public'
  AND relation.relkind = 'v'
  AND relation.relname IN (
    'v_public_vendors',
    'v_public_prices',
    'v_public_price_options',
    'v_public_agency_packages'
  )
ORDER BY relation.relname;
```

After reviewing each definition against the pinned migration, save the returned
JSON array outside Git and derive the exact contract map. The extra newline is
part of the probe's canonical hash contract:

```powershell
@'
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const rows = JSON.parse(readFileSync(process.argv[2], "utf8"));
const sha256 = (text) => createHash("sha256")
  .update(text.replace(/\r\n?/g, "\n"), "utf8")
  .digest("hex");
console.log(JSON.stringify(Object.fromEntries(
  rows.map(({ view_name, definition }) => [view_name, sha256(`${definition}\n`)]),
), null, 2));
'@ | node --input-type=module -- C:\secure\staging-view-definitions.json
```

Keep the environment file outside Git and restrict it to the operator account.
Do not paste its contents into logs, issues, PRs, or the receipt directory.

## Run and interpret

After the dedicated staging contract is approved and fixtures are prepared:

```powershell
corepack pnpm supabase:vendor-security:probe
```

On success, stdout contains only non-secret binding fields, the new receipt
path, and its SHA-256. The receipt contains no email, password, anon key,
Management API token, access token, or raw private/non-public fixture id. The
output is created exclusively and never overwritten.

Any pin mismatch, dirty checkout, ledger drift, incomplete column inventory,
unexpected HTTP status, missing positive fixture, exposed negative fixture,
authentication mismatch, cross-user access, mutation-policy failure, or cleanup
failure exits non-zero and keeps production readiness blocked.

The local contract test is:

```powershell
node --test scripts/tests/vendor-public-rls-probe.test.mjs
```

Normal CI runs only this local contract test. The CI job named
`Production Readiness: BLOCKED (Hosted Evidence Required)` is an intentionally
failing release sentinel, not an informational success and not evidence that
the hosted probe ran. The final Quality Gate must remain red while this sentinel
is active.
