# Amora provider cost and latency policy (2026-07-16)

## Enforced design target

- One user turn reserves the atomic quota once. Up to two tool rounds plus one no-tool finalization can still make **three provider generation calls**.
- Every generation helper requires an explicit `maxInputTokens` value and must use the OpenAI exact input-token count endpoint with a **64,000-token hard limit per call**. Both the TypeScript contract and runtime validation fail closed when the ceiling is missing or invalid. Local character estimates are only an early-rejection optimization; they are not an authoritative safety gate for tool schemas, images, or PDFs.
- Each call allows at most 800 output tokens. The 64K cap remains well below the documented 272K long-context surcharge threshold for GPT-5.6 Luna and Terra.
- The count request is pre-generation. A count 5xx/timeout is tagged `requestStage=input_count`, logged with `provider_attempted=false`, and must not be treated as an unknown paid generation attempt.

The exact count adds one serialized network round trip per generation. Its billing and latency characteristics are not asserted because the public endpoint contract does not document either. Latency is reduced by smaller prompts/context and deterministic tool subsets, not by skipping the safety count.

## Worst-case per reserved turn

The conservative bound assumes all 64K input tokens are cache writes (1.25× uncached input price), 800 output tokens, and all three generation slots are used:

| Model | One call | Three calls |
|---|---:|---:|
| GPT-5.6 Luna | $0.0848 | $0.2544 |
| GPT-5.6 Terra | $0.2120 | $0.6360 |

This is a provider-call bound, not a claim that one quota reservation equals one billable request. Main chat reserves the three-call envelope once even when it ultimately uses fewer calls. Reservations are deliberately not refunded or settled down yet, because retrying an unknown paid attempt without provider exactly-once semantics could otherwise undercount spend.

## Active provider surfaces

| Surface | Default/runtime state | Atomic reservation before paid generation |
|---|---|---:|
| Main Amora chat | enabled only behind `AMORA_OPENAI_ENABLED` | one Luna `$0.2544` or Terra `$0.6360` three-call envelope per logical turn |
| Automatic conflict verification + mediation | authenticated route; no current app caller | Luna+Terra `$0.2968` for borderline flow, or Terra `$0.2120` for a hard trigger |
| Memory compiler cron | consent-gated background job | one Luna `$0.0848`; denied jobs are deferred for one hour without consuming an execution attempt |
| Community Amora comment | **default off**; requires `AMORA_COMMUNITY_AI_COMMENT_ENABLED=true` | one Luna `$0.0848` |
| Legacy summarize/extract/classify/profile writers | no active callers and paid generation hard-blocked | none; exact count is followed by `LEGACY_AUXILIARY_PROVIDER_DISABLED` |

The application defaults are 100 free standard chat turns per couple, 300 global turn reservations per KST day, and a conservative `$20` global daily provider-cost ceiling. These are independent controls; there is no “monthly 30 turns” rule. Setting `AMORA_COST_GUARD_ENABLED=false` disables the atomic budget gate, so production must explicitly verify that it is not false before release.

Known-cost reconciliation includes every `amora_director` row and every other log row whose metadata identifies `ai_provider=openai`. This keeps background and community provider cost inside the same lower-bound reconciliation instead of counting only main chat.

## Tool exposure policy

`selectAmoraTools` preserves a five-tool read-only baseline, adds domain reads from user intent/specialist routing, and exposes matching mutation tools only when explicit write/approval language is present in the **current user message**. A short approval such as “응, 그렇게 해줘” may inherit exactly one domain only from the immediate preceding assistant action proposal; the helper re-bounds context to two messages and 600 characters each. Descriptive, ambiguous, or non-immediate history cannot unlock a mutation. Destructive beta-disabled tools are never introduced. Stable canonical tool order is preserved for prompt consistency.

The helper is intentionally separate from the main route so rollout can be gated by regression tests. Before enabling it in production, run representative conversations for budget updates, schedule changes, venue changes, contract/quote review, vendor search, and action-memory capture. A false negative removes a capability for that turn, so route integration requires those evals.

## Audit durability limits

Main chat runs each generation through `runAmoraProviderCallWithLedger`. It inserts and confirms a content-free `prepared` `amora_director` receipt before the provider call; if preparation fails, generation is blocked. Completion or provider failure finalizes that same row with bounded retries. If finalization cannot be confirmed, the prepared row remains visible for release reconciliation instead of disappearing.

This is stronger than post-call best effort, but it is still not provider exactly-once execution: there is no database uniqueness constraint that makes a retried provider attempt globally idempotent, and OpenAI generation itself is not transactionally coupled to Supabase. Auxiliary audited calls currently write their audit row after the call and rely on the atomic conservative reservation for wallet protection. Therefore:

- unresolved prepared/unknown-paid rows remain a deployment blocker;
- reservations are never silently released;
- automatic retries must reuse the same logical client request identity where supported;
- background/community routes remain separately gated, and the community writer stays default off until its own durable claim is approved.
