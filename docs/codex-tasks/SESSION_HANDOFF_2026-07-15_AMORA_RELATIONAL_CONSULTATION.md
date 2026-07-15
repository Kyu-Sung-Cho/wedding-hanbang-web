# Amora relational consultation handoff — 2026-07-15 KST

## Outcome and root cause

The earlier warm-voice release still produced mechanical answers because the
effective system prompt contained later, higher-impact instructions that forced
the same empathy → conclusion → next-action pattern, exposed planning jargon,
made unsupported psychological/gender inferences and treated every turn like a
report. Prompt order also differed between normal chat and automatic mediation.

This change makes Amora choose one primary job per turn: stay with the user,
clarify, decide or execute. Explicit listening requests no longer receive a
checklist. Practical questions receive the answer first. Confirmed date, budget,
schedule and booking changes still keep durable tools available even when the
message contains emotion.

## Implementation map

- `apps/web/src/lib/ai/amoraVoice.ts`: relational conversation contract and
  final direct-chat/mediation guards.
- `apps/web/src/lib/ai/prompts.ts`: removes fixed report templates, gendered
  assumptions and unsupported motive inference; treats stored profile/memory
  values as bounded data rather than instructions.
- `apps/web/src/lib/ai/amoraPromptComposer.ts`: server-only prompt assembly for
  both chat routes; reserves the final safety suffix before truncating context.
- `apps/web/src/app/api/chat/route.ts`: uses the shared composer, applies the
  mediation mode to direct mediation requests and supports authenticated release
  evaluation without weakening the global cost guard.
- `apps/web/src/app/api/chat/check-couple-conflict/route.ts`: uses the same
  bounded composer so the automatic mediation route cannot cut off safety rules.
- `scripts/amora-conversation-eval.mjs`: release evaluation for listening,
  budget overwhelm, practical fees/contracts, robotic-feedback recovery,
  honest non-persistence, structured neutral mediation and urgent contract risk.

## Release-evaluation safety

`AMORA_EVAL_SECRET` is required on both the target deployment and the operator's
shell. Never commit or print its value. Each evaluation request uses a short-lived
HMAC bound to its `clientRequestId`. The server rejects an invalid evaluation
header, uses a separate evaluation ledger UUID and persistent request bucket, and
still calls `reserve_amora_turn` with the global daily cap. It does not consume the
public demo couple quota.

Production evaluation requires all of the following and makes exactly six model
requests with no retry:

```powershell
$env:AMORA_EVAL_SECRET = "<same secret configured in Vercel Production>"
corepack pnpm amora:eval:live --json
```

Non-production evaluation requires an explicit target and defaults to three
samples per scenario:

```powershell
$env:AMORA_EVAL_SECRET = "<target environment secret>"
corepack pnpm amora:eval -- --base-url=https://<staging-host> --json
```

For an explicitly verified Vercel Preview target, add the preview attestation:

```powershell
corepack pnpm amora:eval -- --base-url=https://<preview-host>.vercel.app --allow-vercel-preview --json
```

A `*.vercel.app` URL is treated as production unless the operator explicitly
adds `--allow-vercel-preview`. That flag is an environment attestation, not a
way to weaken production gates. The server independently uses `VERCEL_ENV` and
shares one 12-request bucket across every production alias.

Do not evaluate an ordinary safe Preview where
`NEXT_PUBLIC_PREVIEW_STUB_MODE=true`; its proxy correctly returns 503 for API
routes. A targeted hosted evaluation requires a dedicated non-production
Preview/Stage deployment with the stub disabled, non-production Supabase and
OpenAI credentials, and its own evaluation secret. Otherwise use a local
production build wired only to non-production services. Never disable the
Preview fence while pointing at the production database.

## Verification before publication

- root test: 9 evaluator tests, 614 web tests and 7 mobile tests passed;
- TypeScript: passed;
- ESLint: 0 errors; one pre-existing unused test-variable warning outside this
  change;
- Next.js production build: passed, 100 routes;
- client static bundle search: no Amora prompt or evaluation-secret contract
  text leaked into browser chunks;
- independent testing, maintainability and adversarial review findings were
  fixed and re-reviewed.

## First production evaluation and follow-up

PR #59 was squash-merged as `ac7fc9a056892a404bd172b56da6aa597a705cf9`
and deployed successfully. The first signed production evaluation made exactly
six model calls with no retries. Infrastructure passed 6/6 and quality passed
5/6. The failed scenario was
`mixed_emotion_change_is_honest_without_tools`: Amora responded naturally to a
new wedding date, but did not explicitly disclose that the public demo had not
saved the date.

The follow-up keeps ordinary authenticated chat unchanged and adds a demo-only
final prompt guard. When a user first provides or changes a confirmed date,
budget, schedule or booking in the public demo, the same response must state
that it was not saved to the real product. It must not make a false save,
remember or future-save claim. Greetings, mediation quotes and unrelated chat
are excluded so this disclosure does not become another mechanical refrain.

The evaluator now accepts `--scenario=<id>` so this single failed scenario can
be verified against a preview deployment before spending the remaining six-call
production allowance. This option is rejected for every production hostname,
including an un-attested `*.vercel.app` deployment. Do not run the full
production evaluation again until the targeted non-production evaluation, CI
and production deployment have all passed.

## Continuation on another computer

```powershell
git fetch --all --prune
git switch main
git pull --ff-only origin main
corepack pnpm install --frozen-lockfile
corepack pnpm test
```

Read this file together with
`docs/codex-tasks/SESSION_HANDOFF_2026-07-15_AMORA_OPENAI_RELEASE.md` and
`docs/operations/AMORA_PRODUCTION_RELEASE.md`. Do not copy `.env` files or
secrets through Git.

## Rollback and remaining evidence boundary

The code rollback is a normal revert PR for this release. Remove
`AMORA_EVAL_SECRET` only after the rollback is live; leaving the server without
the variable makes evaluation authentication fail closed and does not affect
ordinary chat.

The signed release evaluator intentionally has no durable user tools. Unit and
route contract tests prove that a real authenticated mixed emotion + date-change
chat retains mutation tools and that demo/evaluation chats cannot persist. A
post-deploy write/tool-choice canary must use a dedicated authenticated QA couple;
do not mutate an unknown real customer's data for verification.
