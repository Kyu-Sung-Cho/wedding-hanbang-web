# Vendor public RLS hotfix evidence — 2026-07-15

## Scope

This receipt covers only the production vendor read-policy drift fence. It does
not approve vendors, import catalog data, change application records, or claim
that public and private vendor columns have been separated.

- Production project: `slrtobkksjmxgzatjyqb`
- Migration: `20260715210000_harden_vendor_public_read_policies.sql`
- Applied: 2026-07-15 21:09 KST
- Final migration SHA-256:
  `097748BB0E09EB520A1DDC1305A574DFCD83E45056053A7012C8323BCCEEE8A7`

## Recovery gate

- Supabase listed the latest physical backup from
  `2026-07-14T20:13:53.138Z` as `COMPLETED` before the change.
- The migration changes policy metadata only and contains no vendor-table DML.
- It uses an explicit transaction, fixed lock order, a 5-second lock timeout,
  and post-change contract checks. A failed statement rolls back all policy
  drops.
- The safe post-commit response is a forward repair of the approval-scoped
  policy. Recreating an unconditional `USING (true)` policy is prohibited.

## Apply record

The first apply attempt stopped on the first `LOCK TABLE` because the migration
did not yet contain an explicit transaction block. No `DROP POLICY` statement
was reached. The remote migration ledger remained unchanged and all three drift
policies were still present. The migration and test harness were corrected,
then the complete local gate and a second remote dry-run were executed before
re-applying.

The final dry-run listed exactly one pending migration. The final apply
succeeded, and `supabase migration list --linked` showed
`20260715210000` on both the local and remote sides.

## Data-preservation check

Counts and content-only row digests were captured immediately before and after
the policy change. They matched exactly.

| Surface | Before rows | After rows | Before/after digest |
| --- | ---: | ---: | --- |
| Vendors | 177 | 177 | `4bd8b09003013d80153f6c7937bd4e13` |
| Vendor products | 474 | 474 | `9a520ced388ecc3c29d983f57deafac3` |
| Vendor images | 0 | 0 | `d41d8cd98f00b204e9800998ecf8427e` |

Vendor status counts also remained unchanged: approved 0, pending 176, and
rejected 1.

## Post-apply policy contract

- Known unconditional drift policies present: 0 of 3.
- Required approval-scoped SELECT policies present: 3 of 3.
- Vendor tables with RLS enabled: 3 of 3.
- Other unconditional PUBLIC/anon/authenticated SELECT or ALL policies on these
  tables: 0.

## Anonymous and live canary

The production anonymous key was held only in the current process environment;
the key value and database rows were not printed or written to disk.

- Non-approved vendors visible through anonymous PostgREST: 0.
- Approved vendors visible: 0, matching the current approved-row count.
- Products and images visible outside an approved vendor: 0.
- `https://hanbang.ai/api/vendors?limit=1`: HTTP 200, 0 visible vendors.
- `https://hanbang.ai/vendors`: unauthenticated redirect to `/login`, final
  HTTP 200.

## Local verification

- Focused PGlite migration suite: 3/3 tests passed.
- Full web test run before apply: 88 files and 592 tests passed.
- Monorepo typecheck: 4/4 packages passed.
- Monorepo lint: passed with one pre-existing unused-variable warning and no
  errors.
- Migration dry-run: exactly one expected migration.
- Release manifest static fence: passed with the migration hash pinned as an
  applied hotfix.
- Release manifest remote fence: `clean`, with 0 pending migrations.

## Remaining release boundary

Do not approve the current rows or import a public catalog into the mixed
`vendors` table yet. RLS protects rows, not columns. Public catalog facts must
first be separated from owner contact, compliance, settlement, moderation, and
other private fields, with explicit grants and anonymous regression tests.
