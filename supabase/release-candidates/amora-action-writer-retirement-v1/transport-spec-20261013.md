# B2 transport companion — local verified candidate, not deployed

The initial section below is the historical two-raise/5-native-test snapshot. It is not the current final companion. See the final eight-raise section at the end for the current exact bytes and evidence.

The fifth companion replaces only the two explicit `AMORA_ACTION_CONFLICT` / `40001` raises in `patch_own_amora_action_view_v2(uuid,text,text,jsonb)` with `PT409`. Its same function OID, signature, result, security-definer flag, config, owner and ACL are preserved by `CREATE OR REPLACE`. The native test compares the complete stored body against exactly those two substitutions.

No blanket exception translation is added. Genuine nested serialization `40001`, denied `42501`, invalid `22023`, lock timeout and unavailable `55000` retain their distinct contracts. Logical conflicts still roll back without changing the canonical row or legacy progress. Successful future raw tokens advance exactly one microsecond, preserve their raw precision and are not converted through JavaScript Date.

Released B1 e313/d8 and the four earlier companions remain unchanged. The new combined B2 bundle must include all five companions and have a new SHA. Recovery is original **seven** functions (the prior six plus the v2 patch function), not the historical original-six proof or the four-companion 12e05 bundle. The token trigger is not replaced by this companion.

Actual owned PostgreSQL 17 loopback: 5 PASS / 0 FAIL / 0 CANCEL / 0 SKIP, exit 0, 20550.6163 ms. It covers exact function identity/attributes/ACL/body delta, both stale storage types, actor/role/couple denials, invalid/absent records, approved fields/raw microseconds, canonical and legacy trigger drift rollback, genuine serialization preservation and all-five companion checked edits alongside current eight journey triggers. The metadata fixture required the original pure `couple_plan_change_is_high_impact` dependency to exercise that path; no approval-ledger or full-schema claim is made.

Web mapper: new file 12 PASS; existing repository file 2 PASS, 2 files / 14 total, exit 0. Scoped lint exit 0. The concurrent web typecheck reported four errors in readiness-owned route/hook/deadline fixtures; they were reported to its owner and not edited here.

SQL SHA256: `9a5e5abe2996f2f6492315b31f463bb48a4b8a3d78fc54dcdaa99928ae099566`.

Native test SHA256: `6dcdd32852e26177b65d931a94c30243214bd5241b431183b1e02d3d10168d01`.

No PostgREST server, HTTP response timing, production call, database mutation, Git mutation or deployment was performed by this slice. PT409 delivery in the actual hosted transport and original-seven recovery/private runtime evidence remain distinct release requirements.

## Final reviewed local transport scope — 2026-10-13

Current fifth companion SHA256 `fecd2ad16a1f2e8613cb61010a6eb066e28be34c6112059e239caaca33f6eb0b`, 23,464 bytes. The exact combined five-companion formal source is `38960c66ebd228844346951d001801e3b9af26f750e8a279e07c0d5910ac438c`, 46,366 bytes. Only an extra EOF newline was removed from the fifth companion; the unchanged renderer keeps the formal byte count and changes only its embedded companion-hash comment. Function bodies, permissions and the four earlier companions are unchanged. Formal registration is source-only, not operating approval or database application.

The final delta is exactly eight explicit logical SQLSTATE changes: v2 stale conflicts 2, new INSERT guard `AMORA_ACTION_IDENTITY_BUSY` / `AMORA_ACTION_LEGACY_IDENTITY_CONFLICT` 2, and already-targeted private `apply_couple_plan_change_locked` `COUPLE_PLAN_CHANGE_CONFLICT` 4. Original four companions, B1 e313/d8 and function/trigger identities remain unchanged. Original recovery scope remains seven existing functions plus the intended canonical UPDATE ACL and new guard2 cleanup; the INSERT guard is one of those new guards, not an eighth original function.

Actual owned PG17 final-source run before the cosmetic EOF normalization: three native files, 14 PASS / 0 FAIL / 0 CANCEL / 0 SKIP, exit 0, 69206.343 ms. This is not a fresh execution of the new raw-file hashes above. It is separate from the historical five and intermediate guard-only eleven; the counts are not added. The run covers all four actual INSERT/v2 lock orderings, private guard body-only changes and full attribute/ACL/trigger-OID preservation, normal and no-journey create, duplicate requestId 23505, actor denial, actual nested serialization 40001, canonical/legacy checked edits, and plan missing/state/roster/expiry/digest/CAS/final-status rollback. Current original service submit preserves routine total-budget, checklist and schedule-category metadata plus exact completed replay/notifications. Schedule-category metadata is not an event booking/cancellation proof, and this fixture is not a full Auth/Storage or actual AI approval clone.

The private apply branches are invoked as the actual local owner with a service claim, matching the private SECURITY DEFINER execution context; public service submit is tested separately. No new public EXECUTE grant is invented. Web `journey` and `couple-plan-changes/[requestId]` already map the exact conflict message to HTTP409, independently of the SQLSTATE; no web mapper expansion was needed for these plan branches. Generic wrappers' other 40001 paths are outside this exact eight-change scope.

Final native support adds only the public-source request ROWTYPE prerequisites absent from the minimal draft fixture. The held four/B1 fixtures remain unedited. Genuine nested 40001 and unavailable55000 are not translated. Source-only CI skips native only on non-Windows where native PG is actually unavailable; Windows missing its owned native PG fails. Hosted PostgREST behavior, production rollout, fresh original7 private/native provenance and final default lifecycle verification remain separate, uncompleted operational gates in this report.
