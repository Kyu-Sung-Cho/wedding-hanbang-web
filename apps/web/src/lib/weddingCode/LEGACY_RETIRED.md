# Candidate 4 legacy/retired implementation

The files in this directory other than `research/` preserve Candidate 4 behavior for audit history and existing
containment regression tests. They are unreachable because the public page is notice-only, the result page
redirects, WeddingCode APIs return `410 Gone`, and the DB write fence is closed.

Do not:

- reconnect `WeddingCodeClient.tsx` or `ResultClient.tsx`
- reuse Candidate 4 weights, score bands, reports, numeric overlap, raw-answer sharing, or localStorage
- import any of these modules into `research/candidate5.ts`
- treat old passing unit tests as item validity or release evidence

Candidate 5 uses a separate research-only schema and remains unvalidated. See
`docs/wedding-code/README.md`, `55_conservative_readiness_audit_2026-07-15.md`,
`56_candidate5_research_spec_2026-07-17.md`, and `57_candidate5_item_evidence_matrix_2026-07-17.md`.
