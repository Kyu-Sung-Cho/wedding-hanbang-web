# WeddingCode research-only code

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

## Candidate 6.3 successor prototype

`candidate6.ts` and `Candidate6Prototype.tsx` are the current next-research proposal. They add explicit
premises, a valid middle response, a balanced hinder-to-help impact scale, distinct
`depends`/`not_applicable`/`no_experience`/`skip` states, separate joint involvement/ownership autonomy/
checkpoint and emotional/action support hypotheses, and a user-selected neutral conversation card. Every
item remains `M0`; research themes are not validated dimensions and no scoring function exists. Item-level
source locators support scenario/concept elicitation only. Form A/B endpoint orientation and ES/AS pair order
are independent factors, SI follows the core as a contextual block, and facilitated interviews use 8-10 item
P1/P2/P3 panels instead of the full 19/21-item UI stress preview. R1 assignment requires an explicit eligibility
screener for recording, vendor-assisted, and partner-collaboration contexts. Ineligible items may be replaced only
by an eligible, unassigned item in the same theme; otherwise the plan is incompatible and exposes no items. The
planner also emits item-level assigned/administered/eligible/non-applicable tracking rows without storing them.
Each row keeps `eligibilityAtAssignment` separate from `responseDisposition`, so an eligible assignment can later
record a `not_applicable` escape without losing the eligible denominator.

Every assignment uses an opaque RFC 4122 UUID and preserves exact version, Form, support-pair order, rotation,
panel, the complete eligibility screener snapshot, stakeholder applicability, requested item, assigned item,
replacement item, and original eligibility. Runtime validation rejects invalid enums, mixed assignment metadata,
duplicate `(exactVersion, assignmentId, itemId)` rows, impossible response flags, panel mismatches, screener drift,
and invalid or cross-theme replacement lineage. This is still an in-memory template, not an approved persistence,
consent, or research collection system; deterministic rotation does not by itself guarantee sample-wide exposure
balance.

`localPreviewPage.tsx` is imported only by an ignored route generated during the dedicated local dev command.
It requires `NODE_ENV=development`, server-only `WEDDING_CODE_RESEARCH_PREVIEW=true`, and a loopback host,
returns `notFound()` otherwise, and stays `noindex`; blocked responses are `no-store` while allowed Next dev
HTML is framework-normalized to `no-cache` and never contains response state. The component may use React
memory state only. The path must suppress global analytics/UTM, carry `ph-no-capture`, and reject external
connections through its CSP. The research runner clears PostHog/Sentry variables, shares an exclusive lock
with the safe production build, and removes the generated route on exit. Preview/Production exposure, browser
persistence, answer sharing, inferred results, and product application remain forbidden.

The dedicated research proxy also permits only loopback development `GET`/`HEAD` traffic for the exact research
page and required `/_next/` assets. Same-origin API/ingest paths, state-changing methods, external requests, and
telemetry remain blocked. The exclusive lock never auto-reclaims a stale-looking lock: a human must verify and
remove stale state so two runners cannot acquire ownership concurrently.
