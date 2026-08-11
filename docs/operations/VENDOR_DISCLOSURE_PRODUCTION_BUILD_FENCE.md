# Vendor disclosure production build fence

> **2026-08-11 변경.** 이 펜스는 더 이상 웹 프로덕션 빌드를 DB 릴리스 준비 상태에
> 묶지 않는다. 아래 "웹 빌드와 DB 릴리스를 분리한다"를 먼저 읽는다. **DB 릴리스는
> 여전히 NO-GO다** — 그 판정은 릴리스 컨트롤러와
> `VENDOR_DISCLOSURE_V2_MANIFEST_RETIREMENT_2026-08-08.md`가 계속 맡는다.

## 웹 빌드와 DB 릴리스를 분리한다 (2026-08-11)

2026-08-08 `7f437003`이 이 펜스에 `controllerReady === true` 요구를 추가했다. 그
조건은 매니페스트 status가 `deployment_blocked`인 한 절대 참이 되지 않고, 그 status는
**운영 DB 쓰기 봉인 그 자체**다. 결과적으로 "웹을 배포하려면 먼저 운영 DB 쓰기를
열어라"가 됐고, 2026-08-08 12:04 이후 **웹 프로덕션 빌드가 한 번도 성공하지 못했다**
(운영은 `ad31d482` 빌드에 3주간 정지). 파운더 결정으로 그 조건을 제거했다.

지금 프로덕션 빌드를 막는 것은 둘뿐이다.

1. 공유 정적 계약 — `validateSuccessorReleaseContract({ repoRoot })`
2. 소유자 서명 — `VENDOR_DISCLOSURE_PRODUCTION_AUTHORIZATION`

### ⚠️ 서명이 뜻하는 것

제거된 조건이 **우연히** 막아 주던 진짜 위험이 하나 있다. 코드가 요구하는
마이그레이션이 운영 DB에 적용되지 않은 채 배포되는 것이다. 실제로 2026-08-05~07
마이그레이션은 `profiles`에 컬럼을 추가하고 RPC 2개를 만드는데, 현재 코드가 그것을
호출하고 배포된 `ad31d482` 빌드에는 그 참조가 없다.

빌드 시점에는 운영 DB를 조회하지 않는다(그래서도 안 된다). 그래서 이 판단은 사람이
한다. **`VENDOR_DISCLOSURE_PRODUCTION_AUTHORIZATION`을 핀한다는 것은 그 매니페스트의
`expandMigrations`가 운영 DB에 적용된 것을 확인했다는 뜻이다.** 매니페스트가 바뀌면
해시가 바뀌어 서명이 무효가 되므로, 마이그레이션이 늘 때마다 이 확인을 다시 하게 된다.

핀하기 전 확인(읽기 전용):

```
POST https://api.supabase.com/v1/projects/slrtobkksjmxgzatjyqb/database/query
{ "query": "select version from supabase_migrations.schema_migrations order by version desc limit 5",
  "read_only": true }
```

맨 위 값이 매니페스트의 마지막 `expandMigrations` 버전 이상이어야 한다.

## DB 릴리스 판정: NO-GO (변경 없음)

`supabase/release-manifests/vendor-disclosure-v2-20260718.json`은 여전히
`deployment_blocked`이고, 다섯 개 배포 증거 클래스는 모두 `missing`이며,
호스티드 스테이징 계약은 승인되지 않았다. 운영 DB 쓰기는 계속 봉인 상태다.

`apps/web/vendorDisclosureProductionBuildFence.ts` is intentionally an interim
NO-GO fence. For a production build it first calls the repository's shared
`validateSuccessorReleaseContract({ repoRoot })`. This makes predecessor pins,
the required remote head, every migration hash and the exact successor
migration directory set one common static contract. If the shared validator
rejects any part of that contract, the build fails with
`VENDOR_DISCLOSURE_STATIC_RELEASE_CONTRACT_INVALID`.

Passing the shared static contract does not by itself open a production build.
The owner must additionally acknowledge the exact manifest by setting
`VENDOR_DISCLOSURE_PRODUCTION_AUTHORIZATION` to the normalized release-manifest
SHA-256. A missing value fails with
`VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_NOT_IMPLEMENTED`; a different value
fails with `VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_INVALID`. Only an exact
value lets this interim build-side fence return successfully. Preview and local
builds remain unaffected.

That environment value is a manual operator acknowledgement of the exact
manifest, not a cryptographic signature, hosted evidence, or permission to
report the release as production-ready. **웹 빌드가 열리는 것과 DB 릴리스가
승인되는 것은 다르다** — 아래에 적힌 외부 서명 컨트롤러 통합과 실제 provider 영수증이
끝날 때까지 **DB 릴리스는 계속 NO-GO다.**

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
