# WeddingCode Candidate 5 research-only code

`candidate5.ts` is a pure, zero-I/O schema for document and static-prototype checks. It is **not** a runtime
feature and does not authorize collection.

Allowed:

- typed item/evidence metadata
- deterministic Form A/B option ordering
- display-position to canonical-direction normalization
- neutral-topic and deletion policy constants
- unit/static tests

Forbidden:

- imports from Candidate 4 constants, score, report, answers, share card, clients, or browser storage
- imports from public routes/components
- fetch, Supabase, API, DB, analytics, localStorage, sessionStorage, or service workers
- score/type/overlap/confidence/rarity output

The public notice-only page, result redirect, `410 Gone` APIs, and DB write fence must remain unchanged.
