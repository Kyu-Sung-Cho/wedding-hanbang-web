# Amora OpenAI production release runbook

This is the only authorized path for the `amora-openai-20260714` release. It
does not authorize a production change by itself. A step is complete only when
its receipt is recorded and every following precondition still holds.

## Release identity and non-negotiable rules

- production Supabase project: `slrtobkksjmxgzatjyqb`;
- isolated production-data verification clone: `syhmfxauqyhgdcokrheg`;
- Git branch: `feat/amora-openai-runtime-20260714`;
- release manifest: `supabase/release-manifests/amora-openai-20260714.json`;
- runtime starts fail-closed: `AMORA_OPENAI_ENABLED` must remain absent or
  `false` until the post-deploy synthetic smoke gate;
- do not reset the production database password. The verified dashboard,
  Management API and linked CLI paths do not require a reset. If a later tool
  unexpectedly asks for a password, stop that path and reassess instead of
  changing production credentials;
- never run unscoped `supabase db push`, `--include-all`, the disabled history
  scripts, or a destructive down migration;
- never print or commit API keys, service-role keys, backup payloads, DPAPI key
  blobs, full receipts, customer identifiers, or row content.

## Gate status — 2026-07-15 KST

Passed evidence:

- HBAM2 read-only production capture and immediate verification: 11 tables,
  2,893 rows, authenticated digests, no application plaintext file;
- latest provider physical backup shown as `2026-07-14 20:13:53 UTC`, status
  `COMPLETED`, with a Restore action;
- provider restore-to-new-project clone completed at
  `2026-07-14 23:04:45 UTC`;
- all six expand migrations and both contract checks executed on the isolated
  clone;
- real hosted Auth deletion/anonymization, signup trigger, atomic couple reset,
  partner retention, RLS/RPC ACLs and concurrent request/tool/cost fences passed
  on that clone;
- local web tests (577), mobile tests, type checks, lint, production web build,
  iOS/Android/Web Expo export, production dependency audit and local live smoke
  passed;
- the production remote dry-run exactly matches the 15 hash-pinned manifest
  migrations in `before-reconcile` state.
- the hash-pinned historical-effect audit returned
  `HISTORICAL_RELEASE_EFFECTS_VERIFIED` on both the isolated clone and
  production in a read-only transaction.

Still open; therefore production deployment is **not yet authorized**:

1. reconcile exactly nine already-represented ledger versions now that the
   production read-only historical-effect audit has passed;
2. decide the later of two duplicate pending/unpaid production bookings for the
   same couple/vendor/slot; migration `20260714164000` cannot create its unique
   index until the duplicate is resolved;
3. create the three strict hosted Storage policies in preview, test them, and
   repeat the approved expand operation in production;
4. obtain a traceable EAS iOS and Android production cloud build;
5. supply a controlled OpenAI key to a non-production smoke environment without
   exposing it, then pass the real provider smoke and cost fence;
6. configure missing server/mobile observability destinations or explicitly
   accept the reduced telemetry before launch;
7. obtain the contract/legal decisions for OpenAI DPA, processing region,
   abuse-monitoring retention, ZDR/MAM eligibility and a monitored support
   channel.

WeddingCode remains contained, `noindex`, and write-fenced. Its candidate
questions are not psychometrically validated. This release must not re-enable
the test or its collection APIs.

## Exact release order

### 0. Freeze the candidate

1. Fetch remote refs and confirm no newer work from another computer is absent.
2. Review the complete diff and stage only this release's known files.
3. Run the static fence:

   ```powershell
   pnpm supabase:release:fence
   ```

4. Commit and push the candidate, open a new PR, and require all GitHub checks.
   Record the immutable commit SHA. Do not use archived PR #38 as a merge unit.

### 1. Re-establish recovery evidence immediately before writes

1. Confirm the provider backup page still offers a current completed Restore.
2. Create and immediately verify a fresh HBAM2 set from a clean committed tree
   following `docs/operations/AMORA_DB_BACKUP_RESTORE.md`.
3. Keep the receipt outside Git. Record only non-sensitive pass/fail, timestamp,
   table count and total rows in the release evidence.
4. Verify the exact rollback candidate exists in Vercel and that the previous
   mobile release remains available in the stores/internal distribution.

### 2. Prove and reconcile historical migration state

1. Confirm the linked project and the exact pending set:

   ```powershell
   node scripts/supabase-release-fence.mjs --remote --expect=before-reconcile
   ```

2. Run
   `supabase/contract-migrations/20260714165500_audit_historical_release_effects.sql`
   in the production SQL editor. It opens a read-only transaction and must
   return `HISTORICAL_RELEASE_EFFECTS_VERIFIED`.
3. Mark only the nine `historicalReconciliation` versions in the manifest as
   applied using the authenticated Supabase migration repair mechanism. Do not
   mark any expand version applied and do not edit application tables.
4. Immediately verify:

   ```powershell
   node scripts/supabase-release-fence.mjs --remote --expect=expand-only
   ```

5. If the pending set is not exactly six files, stop. Do not make the ledger
   look clean by guessing.

### 3. Resolve the booking invariant before the expand transaction

The read-only inventory found two pending/unpaid rows for the same
couple/vendor/date/time. Preserve the earlier row. The later row may be changed
to `cancelled` only after the business owner confirms that it is a duplicate,
not a separate customer commitment. Record only the affected booking ID hash
and before/after status in the private release receipt. Re-run the duplicate
query and require zero active duplicate groups.

### 4. Apply database expand artifacts

Apply exactly these hash-pinned files in order, with the manifest's project-ref
fence, transaction defaults, short lock/statement timeouts and no concurrent
schema work:

1. `20260714160000_harden_amora_privacy_boundaries.sql`
2. `20260714163000_atomic_chat_clear_request.sql`
3. `20260714164000_harden_amora_tool_idempotency.sql`
4. `20260714164500_expand_atomic_couple_reset.sql`
5. `20260714164600_expand_push_token_persistence.sql`
6. `20260714164700_expand_account_deletion_integrity.sql`

After each apply, record success and do not retry an uncertain transaction
blindly. Inspect postconditions first. Then require:

```powershell
node scripts/supabase-release-fence.mjs --remote --expect=clean
pnpm supabase:security:probe
```

Run both contract files under `supabase/contract-migrations` and the hosted API
integration against production using synthetic release accounts only. Delete
those accounts after the receipts are captured.

### 5. Hosted Storage expand

Inventory and save the current `chat-image` bucket/policy names. Through the
Supabase Storage policy UI, create only the three policies defined by
`supabase/platform-operations/storage/20260714162000_chat_attachment_expand.sql`.
Do not remove legacy policies or make the bucket private in this phase. This is
a cloud access-permission change and requires action-time operator confirmation.

Pass own upload/signed read, partner overwrite denial, traversal denial and
anonymous direct-read characterization before proceeding.

### 6. Deploy compatible code with OpenAI disabled

1. Merge only after PR checks, review and all preceding receipts are green.
2. Deploy the immutable merge commit to Vercel with
   `AMORA_OPENAI_ENABLED=false` (or absent).
3. Verify `/`, `/wedding`, authentication, onboarding, lounge, booking, chat
   persistence, attachment signing, account deletion and the WeddingCode 410
   containment routes. Provider call count must remain zero.
4. Start the traceable EAS production iOS and Android builds from the same
   commit. A local Expo export is necessary but not a native-build substitute.

### 7. OpenAI canary

1. Pass a non-production real-provider synthetic smoke first. Verify Luna/Terra
   allowlisting, `store:false`, refusal/timeout/429/5xx behavior, no raw prompt
   logging, usage accounting and the kill switch.
2. Confirm the production key exists without printing it. Set conservative
   couple/global/cost caps, then enable the flag for a limited canary window.
3. Monitor error/refusal rate, p50/p95 latency, unknown/interrupted usage,
   provider HTTP count, model ratio and cost. Disable the flag immediately on
   a privacy, authorization, duplication, cost or sustained-latency anomaly.

### 8. Storage contract and post-deploy canary

Only after compatible web/mobile clients pass canary, execute the separately
confirmed contract checklist in
`supabase/platform-operations/storage/20260714167000_chat_attachment_contract.sql`:
make the bucket private and remove all named legacy policies. Re-run the full
attachment matrix. Watch production for at least the agreed canary interval and
record the final deployment IDs, commit, database state and metrics.

## Rollback

1. **Runtime first:** set `AMORA_OPENAI_ENABLED=false`; verify provider calls
   stop. AI fails closed—there is intentionally no Anthropic fallback.
2. **Web:** promote the previously verified Vercel deployment or revert the
   release commit, then repeat the zero-provider and core-route smoke.
3. **Storage expand:** while legacy policies still exist, remove only the three
   new strict policies if they caused breakage. After contract, restore the
   saved policy/bucket inventory only as a separately confirmed access change.
4. **Database:** prefer a forward repair. Do not drop new columns/tables or run
   destructive down SQL during the incident. If data integrity is compromised,
   stop writes, use the provider restore path and the authenticated HBAM2
   evidence under the incident-recovery decision.
5. **Mobile:** stop rollout or submit/promote the previous store build; a web
   rollback does not replace native rollback.

Never describe this release as complete until the clean remote fence, immutable
deploy receipts, native builds and post-enable canary have all passed.
