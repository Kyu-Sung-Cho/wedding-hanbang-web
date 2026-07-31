# Vendor disclosure production build fence

## Current decision: NO-GO

The vendor-disclosure successor release is not authorized for production.
`supabase/release-manifests/vendor-disclosure-v2-20260718.json` remains
`deployment_blocked`, all five deployment-evidence classes remain `missing`,
and the repository-owned hosted-staging contract remains unapproved. A Vercel
production build must therefore fail with
`VENDOR_DISCLOSURE_PRODUCTION_BUILD_BLOCKED`.

`apps/web/vendorDisclosureProductionBuildFence.ts` is intentionally an interim
NO-GO fence. For a production build it first calls the repository's shared
`validateSuccessorReleaseContract({ repoRoot })`. This makes predecessor pins,
the required remote head, every migration hash and the exact successor
migration directory set one common static contract. If the shared validator
rejects any part of that contract, the build fails with
`VENDOR_DISCLOSURE_STATIC_RELEASE_CONTRACT_INVALID`.

Passing the shared static contract does not by itself open a production build.
The current `deployment_blocked` manifest fails with
`VENDOR_DISCLOSURE_RELEASE_CONTROLLER_NOT_READY`. A future, fully validated
`controller_ready` manifest must additionally be acknowledged by setting
`VENDOR_DISCLOSURE_PRODUCTION_AUTHORIZATION` to the normalized release-manifest
SHA-256. A missing value fails with
`VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_NOT_IMPLEMENTED`; a different value
fails with `VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_INVALID`. Only an exact
value lets this interim build-side fence return successfully. Preview and local
builds remain unaffected.

That environment value is a manual operator acknowledgement of the exact
manifest, not a cryptographic signature, hosted evidence, or permission to
report the release as production-ready. Repository policy remains NO-GO until
the external signed controller integration and real provider receipts described
below are complete.

The eventual production build must also bind the complete public catalog, not
an operator-selected lower bound. The sole source is `v_public_prices` filtered
to `is_current = true`; broader vendor tables or operator-provided lists are not
equivalent evidence. `PRICE_CATALOG_EXPECTED_PUBLISHED_VENDOR_COUNT` is the
exact count of distinct, safe, non-empty `vendor_slug` values from that view and
`PRICE_CATALOG_EXPECTED_PUBLISHED_VENDOR_SLUGS_SHA256` is the lowercase SHA-256
of the UTF-8 bytes of `JSON.stringify()` applied after de-duplication and the
default JavaScript ordinal `.sort()`. Production SSG and sitemap generation fail unless both variables are
well-formed and the live list matches both values exactly. Preview and local
builds do not require this production-only catalog contract. Do not configure
real values until reviewed external evidence has fixed the intended catalog;
these variables do not replace the external signed authorization below.

Hash-pinned JSON and fields such as `verified_success` or boolean `checks` prove
only that a file has not changed after it was hashed. They do not prove who ran
a hosted check, which provider or database produced the result, or that the
evidence belongs to an approved deployment. Such files are forgeable by anyone
who can write the repository and are not production authorization.

## Required integration before authorization

The shared successor validator accepts the current blocked shape and one
strict future `controller_ready` shape. The latter hash-pins a separate
Supabase controller contract and private runtime receipt schemas; by itself it
does not authorize a Vercel production release. The exact-manifest environment
acknowledgement above can satisfy the interim build fence only after that
strict state validates, and it does not replace external signed authorization.
Changing the manifest to `deployment_authorized`, replacing `missing` with
path/hash-only receipts, or adding synthetic success JSON still fails before
any claimed evidence is considered. This is intentional fail-closed behavior,
not a completed release-authorization path.

Before a production release can be reported as authorized, one reviewed external
signed-authorization contract must be implemented and consumed by all of:

1. the successor release validator;
2. the production release controller after its private five-receipt Supabase
   evidence gate; and
3. `apps/web/next.config.ts`.

The signed authorization must bind the exact catalog source, filter, count and
canonical slug digest above. A positive minimum, a caller-selected count, or a
digest derived from `v_public_vendors` is not acceptable evidence of catalog
completeness.

The integration must resolve commit provenance without self-reference. If a
receipt contains the current Vercel commit while that same commit's manifest
pins the receipt hash, the receipt changes the Git commit that it is trying to
name. The successor controller must instead validate real external provider and
database receipts, then issue a short-lived signed authorization outside the
Git tree that binds the exact deployment commit and normalized static release
contract. Do not restore the removed synthetic receipt validator or weaken the
commit binding to work around this cycle.

That integration must retain the existing blocked-manifest return shape and
the hosted-staging RLS validator contract. It needs end-to-end tests using the
real receipt producers, signature and issuer verification, expiry and replay
rejection, exact commit/project/migration binding, raw evidence tamper checks,
and post-deploy finalizer sequencing. Until those shared-controller tests and
real hosted receipts exist, do not create `supabase/release-evidence/`, do not
edit the five `missing` values, and do not report the release as deployable.
