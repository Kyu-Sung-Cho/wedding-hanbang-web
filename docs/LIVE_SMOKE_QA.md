# Live Smoke QA

Use this after deployment to verify a bounded browser/health subset for the selected `full` launch mode or the pre-launch `coming_soon` safety gate. It does not exercise the complete WeddingCode, quote, authenticated write, OpenAI, database, or mobile-store journeys. The Couple Court probe deliberately fetches only raw HTML pages and release health; it does not execute page JavaScript or call Couple Court APIs. A PASS applies only to the listed checks, requested feature-switch state, and target URL. Exact Vercel deployment-ID identity requires the separate provider evidence below; this smoke is not a full-product, migration, backup, OpenAI-behavior, or store-release certificate.

## Remote identity binding

Every remote run, in both `full` and `coming_soon` mode, must provide these four identity bindings:

- `--expected-sha=<40-char-sha>`: the exact, non-placeholder commit deployed at the target URL.
- `--expected-supabase-project-ref=<20-char-ref>`: the exact Supabase project exposed by the deployment health endpoint.
- `--apple-team-id=<10-char-team-id>`: the signed iOS Team ID expected in AASA.
- `--play-signing-sha256=<fingerprint>`: the Play App Signing SHA-256 expected in Asset Links.

The smoke fails before opening a browser if any required identity binding is missing or malformed. It then fails if `/api/health/maintenance` reports a different SHA, project ref, or requested feature-switch state, or if the association JSON does not match the signed mobile identities. A preview PASS therefore does not transfer to production, another preview, or a later deployment.

The only identity-binding exception is `--allow-unbound-local`, and the script rejects that option unless the hostname is `localhost`, `127.0.0.1`, or `::1`.

## Couple Court release contract

The three Couple Court states default to `closed` when their CLI/environment inputs are omitted, so omission is not a parse error. Operationally, every release command and evidence record must still state them explicitly to bind the expected environment snapshot. The equivalent inputs are:

| CLI option | Environment variable | Health field |
|---|---|---|
| `--couple-court-private` | `LIVE_SMOKE_COUPLE_COURT_PRIVATE` | `coupleCourtEnabled` |
| `--couple-court-ai` | `LIVE_SMOKE_COUPLE_COURT_AI` | `coupleCourtAiEnabled` |
| `--couple-court-public` | `LIVE_SMOKE_COUPLE_COURT_PUBLIC` | `coupleCourtPublicEnabled` |

Only `closed` and `open` are valid. AI or public access cannot be `open` while private access is `closed`. Public access may be `open` while AI remains `closed`. `coming_soon` rejects the command unless all three states are `closed`; the global launch gate masks the feature routes, so that mode does not run the raw Couple Court page probe.

Every remote run also requires `coupleCourtMockEnabled=false`. When AI is requested `open`, health must report `coupleCourtProviderConfigured=true`. This is configuration-only evidence: the live smoke does not send an OpenAI request, validate Terra output, or prove provider cost/latency behavior. Those remain separate exact-SHA canary evidence.

In the default `full` mode, the script opens a real Chrome or Edge browser and checks:

- `https://hanbang.ai/wedding`
- `https://hanbang.ai/wedding/market-prices`
- unauthenticated `/wedding/lounge` redirect to `/login`
- demo login flow into `/wedding/lounge`
- all three signed-app association endpoints and their iOS/Android identities
- raw HTML `GET /wedding/couple-court/invite`: `200` when private is `open`, otherwise `404`
- raw HTML `GET /wedding/couple-court/public`: `200` when public is `open`, otherwise `404`
- first-party 4xx/5xx responses
- browser console errors
- uncaught page errors

The two Couple Court page probes use the request context to fetch raw HTML without executing page JavaScript. They never call a Couple Court API because even a read-shaped API request can persist a rate-limit row. The script reads release health immediately before and after the two page probes, validates both observations, and requires the observed SHA, Supabase ref, maintenance/security configuration, research/cron switches, and all Couple Court fields to remain identical. The JSON/Markdown report records both health observations and every expected/observed page status. This demonstrates the bounded page boundary without a known DB, rate-limit, or OpenAI write; it does not prove the interactive product journey.

In `coming_soon` mode it instead verifies the public allowlist, signed-app association JSON, full 40-character deployment SHA, account-deletion cron state, sanitized login/app redirects, general API 503 response, and the server-side research intake switch. All three Couple Court states must be `closed`, and the raw page probe is intentionally omitted because the global launch gate masks those routes. When intake is closed it also verifies the PII form is absent and the API returns `RESEARCH_INTAKE_CLOSED`; open mode does not submit a real application. This mode rejects malformed and obvious low-entropy placeholder identifiers, then verifies that the deployed association JSON matches the supplied Apple Team ID and **Play App Signing** SHA-256. It cannot prove where those values came from, so signed Apple/Play account evidence remains a separate human gate.

Both modes first check the common release-health contract: exact SHA, exact Supabase project ref, strong rate-limit secret, a complete Turnstile site/secret pair with a canonical HTTPS hostname, maintenance state, research-intake state, account-deletion cron state, the three requested Couple Court switches, remote mock disabled, and AI provider configuration when AI is open.

The health boolean does not redeem a real challenge. Production evidence must separately complete the `signup`, `forgot_password`, `preregister`, and `survey` widgets on `hanbang.ai` and show that Siteverify accepts only the matching hostname/action. A staged `*.vercel.app` health PASS is not evidence that the production widget hostname is configured correctly.

## Immutable deployment and production alias evidence

Run the bound smoke against the immutable staged URL first. The trusted release controller must record that URL's Vercel deployment ID and environment snapshot. Health exposes the Git SHA and safe configuration fields, but it does **not** expose a Vercel deployment ID; the same Git SHA can exist in multiple deployments with different environment snapshots.

After promotion, separately prove through the provider alias/deployment API that `hanbang.ai` points to the same staged deployment ID, then rerun the same bound command against `hanbang.ai`. Matching SHA and health fields alone are not proof of deployment-ID identity. Do not treat a newly rebuilt deployment with the same SHA as the canaried artifact.

It writes a report under:

```text
.gstack/qa-reports/live-smoke/
```

## Local Dev

If a local web server is running:

```powershell
corepack pnpm qa:live -- --base-url=http://localhost:3000 --allow-unbound-local --couple-court-private=closed --couple-court-ai=closed --couple-court-public=closed
```

Do not use `--allow-unbound-local` for a Vercel preview, production, a LAN address, or any other remote host.

For a remote preview, bind the exact preview deployment and its intended database:

```powershell
corepack pnpm qa:live -- --base-url=https://your-immutable-preview-url.vercel.app --launch-mode=full --expected-sha=<40-char-sha> --expected-supabase-project-ref=<20-char-ref> --apple-team-id=<10-char-team-id> --play-signing-sha256=<play-app-signing-sha256> --research-intake=closed --account-deletion-cron=closed --couple-court-private=closed --couple-court-ai=closed --couple-court-public=closed
```

## Browser Detection

The script uses installed Chrome or Edge. If it cannot find a browser, set:

```powershell
$env:LIVE_SMOKE_BROWSER_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"
corepack pnpm qa:live -- --base-url=https://your-immutable-preview-url.vercel.app --launch-mode=full --expected-sha=<40-char-sha> --expected-supabase-project-ref=<20-char-ref> --apple-team-id=<10-char-team-id> --play-signing-sha256=<play-app-signing-sha256> --research-intake=closed --account-deletion-cron=closed --couple-court-private=closed --couple-court-ai=closed --couple-court-public=closed
```

## Options

Append optional flags such as `--headed`, `--skip-demo`, `--json`, or `--timeout-ms=60000` to a complete bound command. These flags never replace the remote identity requirements. The state options can instead come from `LIVE_SMOKE_COUPLE_COURT_PRIVATE`, `LIVE_SMOKE_COUPLE_COURT_AI`, and `LIVE_SMOKE_COUPLE_COURT_PUBLIC`, but CLI arguments are preferred in release evidence because the expected snapshot is visible without revealing a secret.

Complete `full` and `coming_soon` examples:

```powershell
corepack pnpm qa:live -- --base-url=https://your-immutable-preview-url.vercel.app --launch-mode=full --expected-sha=<40-char-sha> --expected-supabase-project-ref=<20-char-ref> --apple-team-id=<10-char-team-id> --play-signing-sha256=<play-app-signing-sha256> --research-intake=closed --account-deletion-cron=closed --couple-court-private=<closed-or-open> --couple-court-ai=<closed-or-open> --couple-court-public=<closed-or-open>
corepack pnpm qa:live -- --base-url=https://your-immutable-preview-url.vercel.app --launch-mode=coming_soon --expected-sha=<40-char-sha> --expected-supabase-project-ref=<20-char-ref> --apple-team-id=<10-char-team-id> --play-signing-sha256=<play-app-signing-sha256> --research-intake=closed --account-deletion-cron=closed --couple-court-private=closed --couple-court-ai=closed --couple-court-public=closed
```

Run `corepack pnpm qa:live -- --help` for the canonical option list. Every remote mode requires `--expected-sha`, `--expected-supabase-project-ref`, `--apple-team-id`, and `--play-signing-sha256`; signed-app association identity is checked in both `coming_soon` and `full`. Intake, deletion cron, and all three Couple Court states default to `closed`, but release evidence must state the expected deployed values explicitly instead of relying on defaults. Replace every `closed-or-open` placeholder with an approved state before execution; placeholder text is not a valid state.

## How To Read Results

- `PASS` means every check for the selected launch mode matched the requested SHA, Supabase ref, feature-switch state, and bounded browser/server expectations, with no unexpected first-party failure, console error, or uncaught page error.
- `FAIL` means the script found a visible routing, browser, or server problem.
- The demo login flow uses the public demo mode and does not create real user data.
- For `full`, inspect the report's `coupleCourt.before`, `coupleCourt.probes`, and `coupleCourt.after` observations. Both health observations must be identical, and both page statuses must equal their requested `200`/`404` boundary.
- A PASS does not prove OpenAI responses, database write fences, backups/restores, authenticated Couple Court actions, or production alias deployment-ID identity.

## Release Checklist

For the pre-launch production anchor, use the exact deployed commit and approved signed-app identifiers:

```powershell
corepack pnpm qa:live -- --base-url=https://hanbang.ai --launch-mode=coming_soon --expected-sha=<40-char-sha> --expected-supabase-project-ref=<20-char-production-ref> --apple-team-id=<10-char-team-id> --play-signing-sha256=<play-app-signing-sha256> --research-intake=closed --account-deletion-cron=closed --couple-court-private=closed --couple-court-ai=closed --couple-court-public=closed
```

After all launch gates and a `full`-mode deployment, bind this limited full-mode canary just as strictly:

```powershell
corepack pnpm qa:live -- --base-url=https://hanbang.ai --launch-mode=full --expected-sha=<40-char-sha> --expected-supabase-project-ref=<20-char-production-ref> --apple-team-id=<10-char-team-id> --play-signing-sha256=<play-app-signing-sha256> --research-intake=<closed-or-open> --account-deletion-cron=<closed-or-open> --couple-court-private=<closed-or-open> --couple-court-ai=<closed-or-open> --couple-court-public=<closed-or-open>
```

Before either apex command, run the same command against the immutable staged URL and record its deployment ID. After promotion, prove the apex alias resolves to that same deployment ID and rerun against `hanbang.ai`. Replace the state placeholders with the approved values actually deployed. Do not run Supabase remote probes merely because the web smoke passed. Credential rotation, approved target allowlists, write fence, backup, isolated restore, actual Luna/Terra behavior, and post-deploy monitoring gates in `PRODUCTION_RELEASE_ROLLBACK_RUNBOOK.md` remain separate and must pass before any remote DB action or release completion. Existing blockers remain NO-GO; this bounded smoke does not override them.
