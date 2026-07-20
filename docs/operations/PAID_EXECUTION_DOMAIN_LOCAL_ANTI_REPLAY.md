# Paid extraction local execution domain

> Current status (2026-07-20): the local anti-replay code paths pass their local
> tests, but this work has made **0 new paid OpenAI calls**. It does not authorize
> PR merge, production deploy, or the fixed-eight pass result.

## Purpose and boundary

Production extraction uses one authoritative execution domain stored at
`~/.wedding-hanbang-paid-execution-v1`, outside the repository and ingest state.
It prevents an ordinary repository/state copy or local backup rollback from
silently repeating an OpenAI request on the same machine and user profile.

This is a **local authority**, not a central or cross-machine lock. A person with
another machine can explicitly initialize another domain and create a new plan.
Preventing that requires a shared transactional service; this implementation
must never be described as a global multi-PC guarantee.

Paid extraction must therefore run on exactly one designated machine and user
profile. Other computers may pull the code and develop or run non-paid tests,
but must not initialize another paid execution domain or run paid extraction.
Deleting the authority root and its adjacent anchor is not enough to reinitialize:
the state-side binding also blocks that attempt. The remaining local bypass
requires intentional compound destruction by an operator who deletes root,
anchor, and state binding together, or rolls the entire state back to before
initialization. Deleting, copying, restoring, or reinitializing control records
to clear a blocker is prohibited; this is not a central defense against an
authorized operator intentionally destroying every independent local marker.

## One-time initialization

Initialization is explicit and is never performed by `extract --plan`:

```powershell
corepack pnpm ingest paid-execution-domain-init --state-dir <state-dir>
corepack pnpm ingest paid-execution-domain-status --state-dir <state-dir>
```

The first command imports the exact current ledger hash, byte count, row count,
and cumulative cost as the immutable genesis. It also binds the random
`domain_id` to the state directory's canonical real path. If the domain,
sidecar anchor, manifest, claim store, or temporary publication store already
exists partially, is missing after initialization, is corrupt, is truncated, or
uses a symlink/junction, the command fails closed. Planning never regenerates it.
Initialization preflights the existing checkpoint namespace before publishing
the authority, so a bad checkpoint cannot leave a new root and anchor stranded.
Unrelated schema-v1, test-only, and pre-genesis checkpoints remain historical
state but cannot prove a post-genesis claim. Claim-related production-v3
checkpoints still receive full content, identity, result, path, and ledger checks.
Successful initialization also publishes, without overwrite, the matching
`.cache/paid-execution-domain-binding.json` inside the authoritative state. The
authority manifest, adjacent anchor, and state binding must all agree; a missing
or changed member stops planning and provider access for manual reconciliation.
If initialization has already succeeded, do not run the init command again; use
the status command. Status reports the bound domain and state, the exact ledger
snapshot, claim counts, unresolved claim reservation, conservative committed
cost, and `local_authority_only: true`.

The paid plan records the exact domain binding and ledger genesis. Its schema v3
requires both estimated and maximum cost to remain within the authorized ceiling.
The maximum includes as many as four attempts and the pre-authorized static repair
payload. Raising an environment limit after approval cannot raise the effective
runtime fence above `prior durable ledger + approved ceiling`.

The binding permanently records `authoritative_state_dir_realpath`. From domain
initialization until the fixed-eight run and every approved follow-up batch are
finished, do not move, rename, or delete this worktree or state directory. A path
change intentionally fails closed; the implementation does not silently rebind
to the new path, and paid execution must stop for manual reconciliation.

## Provider-call gate

Every paid plan includes the exact domain binding and genesis. Immediately
before each provider attempt, the runtime atomically publishes a no-replace,
fsynced claim keyed by the plan SHA, request hash, unit, extraction fingerprint,
batch, and attempt. Claims are permanent and contain no API key or source text.

A claim is complete only when the authoritative state contains both:

1. exactly one matching production ledger row; and
2. an integrity-checked batch checkpoint that proves the attempt belongs to the
   completed batch (including the success ledger row for the successful attempt).

Ledger-only recovery is deliberately insufficient. A missing or changed
checkpoint, unmatched claim, unclaimed ledger row, changed state real path, or
changed domain binding blocks planning/provider access for manual reconciliation.
The claim gate also rejects the same deterministic request/attempt under a new
plan SHA, preventing a restored pre-call manifest from laundering a replay
through a newly generated plan.

Retryable failed attempts may proceed only within the same live run when their
exact durable failure row and local pending intent are both present. They remain
blocked after a restart until the batch has an exact successful checkpoint.

The production `extractManifest` API rejects provider injection and authority
path overrides. An arbitrary test provider cannot enter production-paid mode.
The fixed-eight paid-chain test helper accepts only schema-validated static
responses, constructs its provider internally, requires isolated OS-temporary
state/authority paths, and rejects an API key or paid-enable env. This keeps
passing tests from silently substituting executable provider code for the
production paid path.

## Cost accounting adjacent to the claim gate

For GPT-5.6, planning, maximums, and per-attempt reservations price all input at
the cache-write upper bound, 1.25 times the normal input rate. Actual usage may
settle at normal input `1x`, cache write `1.25x`, and cache read `0.1x` only when
the provider reports a complete, internally consistent breakdown. Missing,
malformed, or conflicting details make all input settle at `1.25x`; incomplete
total usage settles at the reservation upper bound. Historical v2 ledger bytes
remain unchanged, while their cumulative cost is carried forward at no less
than the same conservative input bound.

## Backup and recovery rule

Back up the ingest state separately, preserving its
`.cache/paid-execution-domain-binding.json` unchanged. The state-backup manifest
must record that file's hash plus references to the live authority: `domain_id`,
domain-manifest/content hash, and the ledger snapshot hash, row count, and byte
count. Do **not** copy the authority directory or
`.wedding-hanbang-paid-execution-v1.initialized.json` anchor into a state backup,
and never roll either one back to an older snapshot.

Restoring state alone is expected to fail closed when its ledger or exact batch
checkpoints no longer satisfy the live permanent claims. Never delete or
reinitialize the authority to make that restored state run. Inspect
`paid-execution-domain-status`, provider request records, ledger rows, claims,
intents, and exact batch checkpoints, then use a separately reviewed manual
reconciliation procedure.

There is no safe automatic disaster recovery for loss of the local authority or
anchor in this design. The surviving state binding intentionally prevents silent
reinitialization. Do not delete that binding or restore a copied old authority.
Keep paid execution stopped until a central transactional or append-only
authority exists, or a separately reviewed human reconciliation establishes a
new safe baseline.

## Verified tests

- Full ingest suite: `356 tests / 355 pass / 0 fail / 1 Windows symlink EPERM skip`.
- Extraction provider isolation, approval ceiling, cache usage, and paid resume:
  `73/73 PASS`.
- Local execution domain, paid plan, and durable ledger targeted tests:
  `28/28 PASS`.
- `corepack pnpm ingest:typecheck`: PASS.
- `corepack pnpm exec turbo run typecheck`: `4/4 PASS`.

These are code-path tests only. The fixed-eight OpenAI extraction and ground-truth
score have not run, and production merge/deploy remains **NO-GO** until the hosted
evidence, backup/restore, real mobile binary, and post-deploy canary gates pass.
