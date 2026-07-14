# Amora DB backup evidence — 2026-07-14 (HBAM1 superseded)

## Status: not a Stage B pass

This record describes an earlier HBAM1 targeted capture. Security review found
that HBAM1 did not authenticate a shared backup-set identity across its two
artifacts, and its PGlite check parsed logical rows in V8 before staging them.
That could lose precision for integers outside JavaScript's safe range.

The hardened scripts now require HBAM2, exact artifact/path/ACL checks, an exact
11-table allowlist, and raw `$1::jsonb` staging without V8 row parsing. No fresh
production backup was run as part of that code-only hardening. Therefore:

- the capture below is historical evidence only;
- it must not be verified by weakening the HBAM2 verifier;
- Stage B backup/recovery is **not complete**;
- actual isolated-schema restore, RLS validation, and RPC validation are also
  **not complete**.

## Current HBAM2 code-only verification

The replacement implementation now also requires server-side read-only
transactions and timeouts, one stable RLS-bypass role, standalone
non-inherited ordinary tables, exact required function signatures, an enabled
AFTER ROW INSERT Auth signup trigger, clean committed implementation
provenance, and a pinned repo-local Supabase CLI/native-binary hash.
It also holds one exclusive capture lock through cleanup and pins the absolute
Node runtime plus the complete physical PGlite package tree used to inspect
authenticated plaintext in memory.
Preflight, inventory-before, the actual data statement, and inventory-after
also carry one exact relation OID/kind/inheritance contract, while all row
reads use `FROM ONLY` to exclude transient inheritance descendants.

The Windows synthetic harness passed **31/31** cases on 2026-07-14. It used a
fake Supabase CLI, did not query production, wrote no plaintext into a backup
directory, and removed its temporary artifacts. This is regression evidence
for the creator/verifier only; it is not a production capture or restore.

## Historical capture metadata

- Source branch base: `7258e253dde3cf21971d3f815139e74da112694d`
- Backup capture: `2026-07-14T11:08:10.548783+00:00`
- Private timestamp directory: `20260714-200802`
- Historical format: `HBAM1-AES-256-CBC-HMAC-SHA256-DPAPI-CurrentUser`
- Historical consistency claim: one PostgreSQL statement snapshot
- Supabase plan shown in dashboard: Pro
- Latest scheduled physical backup seen at that time:
  `2026-07-13 20:13:33 UTC`, with a Restore action
- Dashboard warning observed: Storage objects are not included in database
  backups

No row content, API key, database password, service-role credential, or DPAPI
key is recorded in this document or Git.

## Historical counts

| Table | Rows |
|---|---:|
| `ai_interactions_log` | 1,466 |
| `amora_actions` | 13 |
| `amora_couple_profiles` | 0 |
| `amora_turn_counters` | 5 |
| `chat_feedback` | 2 |
| `chat_messages` | 578 |
| `chat_summaries` | 16 |
| `couples` | 55 |
| `decision_nodes` | 659 |
| `profiles` | 49 |
| `wedding_journeys` | 50 |
| **Total** | **2,893** |

## Historical receipts (not sufficient for the current gate)

- Logical plaintext SHA-256:
  `F46011A5745A38103DF513CC8D97E2F83BCA549CE048101A5FD650E1FBCE3468`
- Logical encrypted SHA-256:
  `9C67688459F8398D99D7AFEC565E10CF56F902861B110009B19EB7A5EA716A15`
- Inventory plaintext SHA-256:
  `FFC72A4097F0E5A8E57CCF99B2D317F46B74CB4917B54B47FB005CC72B88E5B4`
- Manifest SHA-256:
  `D70E1DF6393F781EBC2DA46A83C9F0AAB65FF40494DD45AC9F7190C69314D1D3`

The earlier verifier authenticated and decrypted the HBAM1 artifacts, matched
the recorded counts, ran metadata-derived key checks, and rejected a one-byte
ciphertext mutation. Its PGlite operation was a generic JSONB staging check,
not a restore into production schema. Because of the shared-identity and V8
precision findings, those results do not satisfy the hardened backup gate.

## Required replacement evidence

A new evidence record may be marked successful only after all of the following:

1. a fresh production HBAM2 capture with one authenticated `backup_set_id`;
2. ordinary HBAM2 verification of exact files, containment, ACLs, hashes,
   allowlist, and counts;
3. the raw authenticated PGlite JSONB canonical round-trip;
4. a separate isolated real-schema restore and RLS/RPC contract test;
5. independently recorded physical-backup freshness and migration dry-run
   results.
