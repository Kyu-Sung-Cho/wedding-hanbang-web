# Private profile avatar delivery — 2026-09-13

This candidate implements the previously approved personal initial / 20 emoji / photo editor on the isolated `codex/avatar-delivery-20260913` branch, based on `17fd807a7bf76db2641c4b8213c23d3a5c02fc66`. It is not an assertion of production deployment. The first role/security/support release is maintained independently; its `public.profile_wedding_roles` remains the sole role source. This candidate has no `confirmed_role` field or role-writing RPC.

## Implemented boundaries

- Settings, private sidebar, current-partner message avatars and typing indicator read the authenticated avatar presentation. Public community profiles keep their independent existing identity. Stored photo URLs are only `/api/profile/avatar/image?userId=…&version=…`; original filenames, Storage URLs and paths are not exposed by the presentation APIs.
- JPEG/PNG/WebP input is limited to 4 MiB by actual streamed request bytes and decoded by the existing image sanitizer. Actual synthetic EXIF-bearing input is reduced to a metadata-free 256 × 256 WebP. The private bucket limits saved bytes to 1 MiB and MIME to WebP.
- The editor sends its initially read UUID revision. The helper rejects stale revisions before photo registration/upload and the SQL transaction compares the same revision under the existing per-user deletion advisory lock. Concurrent and ABA changes cannot be treated as a successful save. Authentication errors/anonymous users, cross-origin requests, extra fields, repeated multipart fields and invalid revisions are rejected. Rate limiting fails closed and responses are private/no-store.
- `read_profile_avatar_snapshot(uuid)` is service-only and reads the owner plus an actually mutual current partner in one SQL snapshot. Image delivery repeats the snapshot/revision check after downloading bytes and before returning the response. An unlink or replacement observed there prevents delivery. Bytes already delivered to an authorized viewer cannot be recalled.
- Every prospective upload is registered in `profile_avatar_assets` before Storage upload. Known failed uncommitted uploads and replaced photos are removed best effort. Ambiguous uploads/commits retain their ledger proof, rather than risking deletion of a late successful save. There is no newly added periodic orphan-cleanup job; retained proof is included in account deletion.
- The account-deletion inventory includes exact registered avatar paths, respects the upload expiry, and quarantines unregistered paths. Existing claim/job/source checks remain. Both selected rows and asset rows cascade with Auth deletion after the existing Storage deletion sequence. Applying only the app's deletion code before the schema is unsupported: the inventory intentionally fails closed when its ledger is unavailable.
- UI selection/cancel does not persist. Photo preview uses a revoked-on-replacement/unmount local blob URL. Demo photo selection is preview only; demo emoji changes remain local. Account/couple binding and in-flight guards prevent an old request from changing another user's profile. Optional read failures are distinguished from an explicit reset and do not abort authentication.

## Database delivery inputs

Generated through the installed Supabase CLI `migration new private_profile_avatars_delivery`:

- `supabase/migrations/20260913082314_private_profile_avatars_delivery.sql`
- SHA-256 (LF source): `e04f2e5a1127693490d33731ef5efbbb038db19ec373c43cd4788a2b3fdf4075`
- Policy installer: `supabase/platform-operations/storage/profile-avatar-service-only.sql`
- New service-only RPCs: `register_profile_avatar_asset(uuid,uuid)`, `save_profile_avatar(uuid,text,text,uuid,uuid)`, `read_profile_avatar_snapshot(uuid)`.
- Existing `replace_account_deletion_media_manifest(uuid,uuid,jsonb)` is extended only to prove avatar assets and their expiry; existing function ACL remains.

The migration requires the restrictive `storage.objects` policy to be installed first so unrelated broad Storage policies cannot make this bucket readable or writable by anonymous/authenticated clients. Hosted policy management is supported through the observed `supautils.policy_grants`; lack of table ownership alone is not a reason to claim it cannot be installed. No policy installation or remote SQL was executed for this candidate.

Root must merge this candidate after the first role release, preserve both role and avatar projections/state guards in overlapping auth/settings files, and register the exact avatar successor in the production release adapter. This branch has no imported obsolete avatar release controller/contract or production-approval evidence. Policy/schema application, exact merged-source gates and a scoped hosted synthetic photo/visibility/deletion canary are still release steps; no real customer bytes were read or changed here.

## Verification evidence

- 9 targeted files, **187 tests passed**: actual PGlite schema/Storage RLS/CAS/ABA/deletion proofs, native Sharp sanitation, route boundaries, component interactions, auth/profile projections and Zustand races. Local mocks/PGlite do not establish hosted RLS or Storage HTTP behavior.
- Web TypeScript check passed.
- ESLint on all 21 changed/new TypeScript files: **0 errors**, four pre-existing `window.location.href` navigation warnings in settings/logout remain; those statements were not changed.
- Real isolated Chrome with actual editor/common-avatar components and production PostCSS output at **320/390/768 px**: **22 screenshots, 9 flow groups passed**, no page errors, no horizontal overflow. All network responses were intercepted; revision request agreement was asserted. This checks rendered component behavior, not an authenticated production settings page or real uploads. Chrome was closed.
- Independent read-only review of the new SQL snapshot/service-role/private-policy boundaries by `/root/handoff_ui_review`: no concrete finding within that scope.

Artifacts: `C:/Users/kcho1/.codex/visualizations/avatar-delivery-20260913/` (`targeted-tests.log`, `typecheck.log`, `lint.log`, `browser-qa.json`, screenshots). Initial tests and audit evidence are retained separately in `launch-final-20260913/avatar-*`.