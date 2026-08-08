# Amora safety two-wave release handoff

Date: 2026-08-04
Decision: **STAGED ONLY — NO HOSTED APPLY AUTHORIZED**

> 이 문서의 아래 “Verification snapshot”과 “no commit or push” 문장은 당시 chat-safety
> 작업 시점의 기록이다. 2026-08-04 전체 Amora·커뮤니티 source 상태, active migration,
> 최종 재검증, 다른 컴퓨터 재개 절차는
> `docs/operations/AMORA_COMMUNITY_IMPLEMENTATION_HANDOFF_2026-08-04.md`가 우선한다.
> Wave A/B가 release-candidate 밖으로 승격되지 않았다는 계약은 계속 유효하다.

## Current repository state

The two safety boundaries are deliberately parked outside
`supabase/migrations`. They are release candidates, not active migrations and
not production deployment evidence.

| Wave | Candidate | Canonical SHA-256 | Current purpose |
| --- | --- | --- | --- |
| A | `supabase/release-candidates/amora-safety-20260804/wave-a-memory-source-scope/20260803090000_amora_memory_source_scope_boundary.sql` | `2f8669c30b14aa3b0cad2cc78c310b1a5aa7a391d8e8c06c4a6c7b5af187ba0a` | Prevent future automatic memory writes from citing an unlinked or non-W0/W1 source |
| B | `supabase/release-candidates/amora-safety-20260804/wave-b-fleet-gated-shared-ingest-rls/20260803100000_amora_shared_ai_ingest_boundary.sql` | `3c1c673395a1b9a5c728efada0b81f8ac2e394c16156d7852678a17e838153d0` | Remove every authenticated/anonymous direct `chat_messages` INSERT path after the client fleet is ready |

Neither filename may exist under `supabase/migrations` while it remains a
candidate. The two migration contract tests enforce both the candidate path
and the absence of the corresponding active path.

The active successor manifest currently ends at
`20260802240000_amora_memory_job_recovery.sql`, remains
`deployment_blocked`, and records all five hosted evidence classes as
`missing`. This handoff did not contact hosted Supabase, run a remote pending
query, apply a migration, generate a backup/restore receipt, or authorize a
release.

## Non-negotiable release model

Wave A and Wave B are separate immutable releases. They must have separate
clean commits, manifests, controller contracts, hashes, backups, hosted
staging/restore evidence, storage evidence, finalizer evidence, apply receipts,
and canary decisions.

After a wave is applied, do not append another migration to its manifest or
rewrite its SQL. The next wave must hash-pin the completed prior release as its
predecessor. Do not reuse Wave A receipts for Wave B because the release ID,
commit, required remote head, migration count, migration head, and migration
digest are different.

Never bypass the release controller with direct `supabase db push`, migration
history repair, reset, or a hand-written success receipt.

## Gate 0 — verify the real remote ledger

Before activating either candidate, perform an approved read-only linked
project check from the exact clean release commit and record the complete
remote migration ledger. Explicitly check for all three possible local-history
identities:

- `20260803090000_amora_memory_source_scope_boundary.sql`
- the superseded draft identity
  `20260803110000_amora_memory_source_scope_boundary.sql`
- `20260803100000_amora_shared_ai_ingest_boundary.sql`

If any candidate identity is already present remotely, do not rename, replay,
or repair history. Stop and design a new forward-only migration. If the remote
head differs from the manifest baseline, stop and reconcile the discrepancy
read-only before changing a release contract.

The repository contract currently expects predecessor head `20260716117000`
and has 66 successor migrations through `20260802240000`. Therefore, if the
real remote head is still `20260716117000`, activating Wave A means reviewing
and applying the complete successor set plus Wave A, not applying one isolated
SQL file. If the real head is already `20260802240000`, first establish a
genuine immutable completion record for that release and make it the new
predecessor; do not falsify the current manifest baseline.

## Controller-chain blocker

The current controller supports one hard-coded active successor whose direct
predecessor is the Amora engine v2 release. It does not yet safely support a
successor whose predecessor is itself a controller-ready successor. Merely
removing the fixed predecessor check is insufficient because the next release
also needs the predecessor's effective controller body, backup contract,
post-expand contract, and postchecks.

Before Wave B can become active, repository-owned controller work must:

1. verify a hash-pinned predecessor chain back to the existing trust anchor;
2. hydrate and validate a controller-ready predecessor's pinned controller
   contract as the effective predecessor manifest;
3. make the static fence validate adjacent release ranges instead of using a
   fixed Amora-engine base;
4. fail closed when the selected active manifest is absent, rather than falling
   back to an older release; and
5. prove successor-of-successor selection, pending-set isolation, ledger head,
   finalizer selection, and hash-drift failures in tests.

Do not activate Wave B or place its SQL under `supabase/migrations` until this
blocker is closed and reviewed.

## Wave A — memory source scope

Keep `AMORA_AUXILIARY_MEMORY_ENABLED=false` in every production runtime before,
during, and immediately after the database change. Runtime compatibility,
contiguous source/reply processing, legacy automatic-memory audit, and any
required quarantine must be independently reviewed before memory is enabled.

Wave A activation requires all of the following:

1. Gate 0 remote-ledger evidence is complete.
2. Only the Wave A SQL is promoted from its candidate directory into
   `supabase/migrations`; Wave B remains outside the active directory.
3. The exact Wave A SQL hash is pinned in the selected immutable manifest.
4. The manifest's predecessor head and complete pending set match the live
   ledger exactly.
5. A fresh controller contract and all five private hosted evidence classes are
   generated for the exact clean Wave A commit.
6. Controller check-only, one forward apply, exact post-ledger verification,
   read-only postchecks, canary, and exact-owner finalization all succeed.

After finalization, archive the real receipts and freeze the Wave A manifest.
The expected Wave A head is `20260803090000` only if the controller proves that
exact ordered result.

## Wave B — fleet-gated server ingest RLS

Wave B revokes direct authenticated and anonymous message inserts. An old
mobile binary that still writes directly will fail after this boundary, so app
store publication alone is not a sufficient gate.

Before promotion, prove:

- every supported web and mobile version sends both AI-directed and
  partner-directed messages through authenticated server ingest;
- the minimum supported mobile version is enforced and direct-write versions
  are cut off or no longer supported;
- normal send, partner send, private send, retry, duplicate request ID,
  offline recovery, token expiry, and reconnect paths work through the server;
- monitoring can distinguish rejected legacy direct writes from server/API
  failures; and
- customer support has a recovery path for a blocked old client.

Only after those gates pass may Wave B be promoted in a later clean commit. It
must use a new immutable manifest that pins completed Wave A, requires remote
head `20260803090000`, uses migration floor `20260803100000`, and contains only
the Wave B migration. Generate a new Amora chat-ingest hosted-staging probe and
a completely fresh five-class evidence set. Complete apply, postchecks, canary,
and finalization before relaxing any related operational fence.

## Local verification for this staging change

These checks are repository-only and are not hosted evidence:

```powershell
corepack pnpm exec vitest run `
  src/lib/ai/__tests__/amoraMemorySourceScopeMigration.test.ts `
  src/lib/ai/__tests__/amoraSharedAiIngestBoundaryMigration.test.ts
corepack pnpm supabase:release:fence
git diff --check
```

## Runtime contract staged in the working tree

The database candidates above are only one part of this handoff. The runtime
work is designed to make message delivery and interrupted-turn recovery
server-authoritative before Wave B removes the remaining database write path.

### Canonical message ingest

- Web and mobile send both AI-directed and partner-directed user messages to
  authenticated `POST /api/chat/messages` ingest.
- Partner-directed messages stop after canonical ingest and never enter the AI
  provider path.
- New clients declare `providerAttachmentCount`. Canonical v1 rows bind the
  exact user row and request UUID to `ai_response_requested`,
  `provider_attachment_state`, and `provider_attachment_count` metadata.
- `/api/chat` rejects incomplete attachment contracts, mismatched attachment
  bytes, missing canonical rows, and request-ID drift before claiming work or
  contacting the provider.
- A completed persisted assistant response may be replayed without asking the
  user to upload the same attachment again. A new provider call may not.
- Legacy rows without the v1 marker remain readable during rollout, but they
  are deliberately ineligible for automatic interrupted-turn recovery.

### Safety and interrupted-turn recovery

- Deterministic W5 crisis handling runs locally, avoids provider dependency,
  and reports whether the original disclosure was shared, stored privately,
  not stored, or could not be confirmed. UI copy must not overstate delivery.
- W2 private-content routing records the safe canonical outcome and prevents
  discarded attachment bytes from crossing the provider boundary.
- Cold start never contacts the provider by itself. It can only present an
  explicit user action for an exact unanswered v1 turn.
- An unanswered text-only or safety-discarded turn can reuse its immutable
  durable row and request UUID. A turn whose original attachment bytes are no
  longer available requires reattachment and has no automatic retry button.
- Confirmed actions take priority over ordinary interrupted turns. A later
  canonical response, a cleared lane, a changed account/couple, or a failed
  exact-row recheck must invalidate the stale recovery action.

### Memory boundary

- Automatic memory remains disabled with
  `AMORA_AUXILIARY_MEMORY_ENABLED=false`.
- Runtime memory compilation accepts only a source row that remains linked to
  the canonical assistant reply and is visible in the intended W0/W1 lane.
- The cron path defers an unresolved source instead of compiling from an
  ambiguous roster, role, target, or visibility context.

## Required deployment order

Do not release these changes as one undifferentiated switch. Use this order and
stop on any failed gate:

1. Keep auxiliary memory disabled and capture a clean, reviewed runtime commit.
2. Deploy the backward-compatible server ingest and provider-boundary API.
3. Deploy the web client and observe canonical ingest, duplicate claims,
   attachment mismatch, W2, W5, and interrupted-turn telemetry.
4. Publish the mobile client, enforce the minimum supported version, and prove
   that no supported binary performs direct `chat_messages` inserts.
5. Audit the real remote migration ledger and generate hosted evidence for the
   exact clean Wave A commit.
6. Promote and release Wave A alone. Keep memory disabled during canary and
   audit legacy memory sources before considering enablement.
7. Close the successor-of-successor controller blocker and generate a new,
   independent Wave B release contract and evidence set.
8. Promote Wave B only after the supported web/mobile fleet and support
   recovery path are proven. Observe rejected legacy writes separately from
   server ingest failures.
9. Consider enabling auxiliary memory only in a later decision after source
   audits, canary evidence, rollback rehearsal, and explicit approval.

Rollback must preserve one coherent writer contract. Do not restore a client
direct-insert path casually after Wave B; roll the API, client compatibility,
minimum-version gate, and RLS boundary together under a reviewed plan.

## Verification and evidence boundaries

Repository tests can prove deterministic code contracts. They cannot prove
hosted Supabase history, app-store fleet adoption, push delivery, device
behavior, production credentials, or provider availability. Record those as
separate external evidence; never infer them from a green local test.

At this handoff, a web development server owns the safe-build lock. Do not kill
that process or delete the lock merely to make `build:web` run. Stop it through
the owning terminal, confirm the PID is gone, and then run the safe build from
a clean worktree. Browser/device QA must likewise run from a clean reviewed
state with the intended authenticated test accounts.

## Resume on another computer

The following reproduces the branch only after the reviewed working-tree
changes have been committed and pushed. Local `.env*`, credentials, release
receipts, and private evidence must come from the approved secret/evidence
store and must never be copied into Git.

```powershell
git clone https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git
cd wedding-hanbang-web
git switch --track origin/agent/release-handoff-20260731
corepack enable
corepack pnpm install --frozen-lockfile
git status --short --branch
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm --dir apps/web test
corepack pnpm --dir apps/mobile test
corepack pnpm supabase:release:fence
git diff --check
```

If `git switch --track` says the local branch already exists, use
`git switch agent/release-handoff-20260731` and then verify its upstream with
`git branch -vv`. Do not apply either release candidate as part of environment
setup.

## Verification snapshot — 2026-08-04

The following evidence was produced from the local working tree on branch
`agent/release-handoff-20260731`. It is code/test evidence only.

| Check | Result |
| --- | --- |
| Web Vitest, split into eight deterministic shards | 534 files, 5,283 tests passed |
| Focused chat ingest, provider boundary, memory cron, and migration contracts | 6 files, 237 tests passed |
| Web chat-store recovery suite | 109 tests passed |
| Mobile Node test suite | 330 tests passed |
| Monorepo TypeScript and ESLint | passed |
| Repository ingest, release, environment, and security-contract tests | `corepack pnpm test:repo` exited 0 |
| Mobile release-readiness contract | 104 passed, 0 warnings, 0 failures |
| Expo export for web, Android, and iOS | passed; local Sentry org/project configuration warning remains |
| Supabase static release fence | passed; successor remains `deployment_blocked` |
| Runtime source audit for direct `chat_messages` insert/upsert in web/mobile | no match |
| `git diff --check` | passed |
| Local HTTP smoke against the already-running dev server | `/landing` 200 and unauthenticated chat redirected to login |

The first unsharded web test attempt exceeded a five-minute orchestration
timeout and its reporter received `EPIPE` when the parent was terminated. This
was not counted as a pass or a product failure. The complete eight-shard rerun
above covered all 534 test files and every shard exited 0.

The web production build is still **UNVERIFIED**. During this snapshot, PID
`24952` owned the repository's safe web-development lock and its Next child was
listening on port 3000. That process was intentionally not killed and the lock
was not bypassed. The Expo export is not a substitute for the web production
build.

Browser interaction QA, authenticated multi-account/couple switching against
real Realtime, physical-device QA, hosted cron/provider execution, app-store
fleet adoption, remote-ledger reads, database backup/restore, and hosted
migration apply were not performed. The browser QA procedure also requires a
clean worktree; this working tree contains mixed pre-existing and current
uncommitted changes, so it was not safe to stash, commit, or rewrite them as an
implicit QA step.

## Known residual release gaps

1. Mobile currently has no chat attachment picker. Attachment-bearing web
   requests opened on mobile fail closed and ask for reattachment, but the user
   cannot complete that reattachment inside the native chat yet.
2. Server ingest and the updated web/mobile clients must ship before the Wave B
   RLS boundary. App-store publication without a minimum-version cutoff is not
   enough.
3. Production Sentry org/project/auth configuration and an actual gated EAS
   build remain external release evidence. A local Expo export cannot prove
   either one.
4. The full web suite passes but still prints known test-only stderr noise,
   including React `act(...)` and styled-JSX DOM-attribute warnings in unrelated
   tests. They did not fail the suite but should be cleaned separately so new
   warnings remain visible.
5. No commit or push was created in this handoff. Another computer will not see
   this working-tree state until a maintainer separates unrelated changes,
   reviews a clean commit set, and pushes it.
