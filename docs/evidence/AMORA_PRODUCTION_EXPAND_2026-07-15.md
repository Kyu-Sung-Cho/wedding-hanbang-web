# Amora production expand evidence — 2026-07-15 KST

> **SUPERSEDED HISTORICAL RECEIPT — not current Engine V2 evidence.** This
> receipt remains the immutable record for the earlier OpenAI expand only. It
> does not validate the pending 27-file Engine V2 set, the current Storage 1080
> operation, or any current deployment/mobile canary.

## Scope and recovery

- production project: `slrtobkksjmxgzatjyqb`;
- source branch before the final evidence commit:
  `feat/amora-openai-runtime-20260714`;
- a fresh clean-tree HBAM2 capture was immediately verified before writes: 11
  tables, 2,893 rows, authenticated canonical digests and PGlite JSONB round
  trip all passed;
- the provider backup page exposed a completed physical backup and Restore;
- provider restore-to-new-project had already passed on isolated clone
  `syhmfxauqyhgdcokrheg`;
- no database password was read, requested or reset.

Private backup IDs, hashes, keys, customer identifiers and row content are not
stored in Git.

## Data invariant and migration state

The only active duplicate booking group contained two pending/unpaid rows with
equal business fields created 70 seconds apart. The later row was updated with
an exact `pending` precondition to `cancelled`; no row was deleted. The
postcondition returned zero active duplicate groups.

The read-only historical-effect contract passed before exactly nine already-
represented versions were repaired as applied. The remote fence then matched
the expected expand-only set. The six planned expand migrations applied in
order and the remote fence became clean.

The first production hosted synthetic user then exposed a pre-existing signup
defect: Auth inserted the user, but the legacy trigger swallowed
`relation "profiles" does not exist` because its function used an unqualified
table name under the Auth caller search path. The synthetic user was deleted by
the test cleanup. Migration
`20260714164800_expand_signup_profile_integrity.sql` was added with:

- an exact enabled-trigger precondition;
- `public.profiles` qualification;
- fixed `search_path = pg_catalog, public`;
- fail-closed behavior, so an Auth user cannot outlive a failed profile insert;
- owner/ACL and postcondition assertions.

The repair was applied to the isolated clone first. Its complete hosted
integration passed. Production dry-run then showed exactly that one migration;
it was applied once and the remote pending set returned to zero.

## Hosted production postconditions

- anonymous access probe: no visible rows across 10 sensitive tables;
- Auth signup/profile creation: passed under the hosted Auth path;
- Auth deletion cascade/anonymization: passed;
- atomic couple reset and idempotent retry: passed;
- one-partner retention and final ownerless-couple cleanup: passed;
- 12 concurrent chat claims: one acquired, 11 in progress;
- 12 concurrent mutating-tool claims: one acquired, 11 in progress;
- 10 concurrent cost reservations with cap three: three allowed, seven denied;
- remaining `amora-release-%@example.invalid` Auth users: zero.

## Storage expand

Production `chat-image` was already private. The five legacy compatibility
policies were inventoried and retained. Dashboard added exactly one policy:

`chat-image own uploader folder write pf46ue_0`

It is `INSERT` for `authenticated` with the hash-pinned uploader/couple folder
and file-name checks. No new `SELECT`, `UPDATE` or `DELETE` policy was created.
The five legacy policies must remain until compatible web and minimum-mobile
clients pass canary; their later removal and the final hosted attachment matrix
are contract-phase gates, not part of this expand receipt.

## Current boundary

Database and Storage expand are complete. PR merge, Vercel production deploy,
EAS native builds, real-provider OpenAI smoke/enablement, DB/Storage contract
and post-enable canary are separate gates. This evidence does not claim those
later phases are complete.
