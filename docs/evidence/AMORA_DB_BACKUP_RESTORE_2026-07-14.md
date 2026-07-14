# Amora DB backup evidence — 2026-07-14

## Status: HBAM2 logical capture passed; Stage B remains open

## Fresh production HBAM2 capture and immediate verification

A clean committed implementation at
`b4acc4e0d8edf4369e65842286589dcafdd2d72a` performed a fresh read-only
production capture and immediate verification on 2026-07-14:

- preflight: `2026-07-14T13:47:06.275044Z`;
- data snapshot: `2026-07-14T13:47:14.800150Z`;
- publication: `2026-07-14T13:47:22.184722Z`;
- exact table allowlist: 11 tables;
- total rows: 2,893;
- authenticated creator/verifier anchors matched;
- schema and relation-identity contracts matched;
- source canonical digests and PGlite JSONB round trip passed;
- 13 primary/unique constraints and 8 included foreign keys were checked;
- application-created plaintext payload files: none.

The full backup directory, backup-set ID, manifest SHA-256, DPAPI key blobs,
and complete production receipt are deliberately not committed. They remain in
the operator's external task record and fixed private local backup root.

This passes the fresh logical capture gate only. Provider physical-backup
freshness, isolated real-schema restore, RLS/RPC contracts, and migration
write-fence rehearsal remain incomplete, so Stage B is **not complete**.

## Current HBAM2 implementation verification

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

## Remaining Stage B evidence

Current state:

1. **Passed** — fresh production HBAM2 capture with an authenticated set ID.
2. **Passed** — exact files, containment, ACLs, hashes, allowlist, and counts.
3. **Passed** — raw authenticated PGlite canonical JSONB round trip.
4. **Open** — isolated real-schema restore and RLS/RPC contract test.
5. **Open** — independently recorded provider physical-backup freshness.
6. **Open** — exact migration dry-run, write fence, and rollback evidence.
