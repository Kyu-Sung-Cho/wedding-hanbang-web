# Vendor disclosure production build fence

## 상태: 2026-09-27 은퇴(파운더 승인)

이 펜스는 더 이상 운영 빌드에서 돌지 않는다. `apps/web/next.config.ts` 가
`assertVendorDisclosureProductionBuild` 를 부르지 않고, 서명 환경변수
`VENDOR_DISCLOSURE_PRODUCTION_AUTHORIZATION` 은 `turbo.json` 과
`apps/web/.env.example` 에서 빠졌다. 이 파일 아래 본문은 은퇴 전 설계를 남긴
역사 기록이며 현재 규칙이 아니다.

은퇴 이유:

- 지키던 출시(벤더 공시 v2)는 2026-07-23 에 이미 끝났다.
- 펜스는 운영 DB 를 보지 않는다. 그래서 실제로 난 사고(앱이 DB 보다 먼저 나가
  커뮤니티 피드가 07-31~08-20 동안 죽은 일)를 막지 못했다.
- 대신 운영 배포를 적어도 여덟 번 멈췄다: 08-08~10 세 번, 08-20 세 번,
  08-21 한 번(약 2시간), 09-03 랜딩 문구만 고친 #304.

남긴 것: `apps/web/vendorDisclosureProductionBuildFence.ts` 는
`scripts/tests/release-manifest-signature-pin.test.mjs` 가 해시 함수를 불러 쓰므로
남겼다. `supabase/release-manifests/vendor-disclosure-v2-20260718.json` 은 없으면
출시 도구가 옛 목록으로 넘어가므로 남겼다.

순서: 이 변경이 main 에 병합돼 운영 배포가 확인된 뒤에 Vercel 운영 환경변수에서
서명 값을 지운다. 거꾸로 하면 아직 펜스가 붙어 있는 빌드가 서명 없이 돌아 운영
빌드가 죽는다.

값을 지운 뒤의 되돌리기: 펜스가 들어간 뒤부터 2026-09-27 전까지의 커밋은 아직
펜스를 부른다. 그래서 서명 값을 지운 뒤에는 그런 커밋을 **다시 빌드하는**
되돌리기(옛 배포 Redeploy, 이 변경의 revert)가 서명 없음으로 빌드 단계에서 죽고,
운영은 직전 빌드에 머물러 멀쩡해 보인다. 되돌릴 때는 이미 빌드된 배포를 다시 가리키는 방식(Vercel Instant Rollback)을
쓴다. 옛 커밋을 꼭 다시 빌드해야 하면 **그 커밋의**
`scripts/tests/release-manifest-signature-pin.test.mjs` 의 `EXPECTED_SIGNATURE`
(그 커밋 매니페스트의 sha256)를 서명 env 로 되살린다. 커밋마다 값이 다를 수 있다.
2026-09-27 에 이 변경 직전 main(9e46b1bb0)의 `next.config.ts` 를 운영 조건
(`VERCEL_ENV=production`)으로 불러 쟀다: 값이 없으면 `..._NOT_IMPLEMENTED`, 틀린 값이면
`..._INVALID` 로 던졌고, 그 커밋의 `EXPECTED_SIGNATURE` 를 넣으면 통과했다.
Instant Rollback 이 빌드를 다시 하지 않는다는 것은 Vercel 문서 기준이며, 이 저장소에서
실측하지는 않았다.

## Historical decision (before 2026-09-27): NO-GO

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
