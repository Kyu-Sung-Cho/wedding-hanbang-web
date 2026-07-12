# Live Smoke QA

Use this after deployment to verify a bounded browser/health subset for the selected `full` launch mode or the pre-launch `coming_soon` safety gate. It does not exercise the complete WeddingCode, quote, authenticated write, OpenAI, database, or mobile-store journeys. A PASS applies only to the listed checks and exact deployment; it is not a full-product, migration, backup, or store-release certificate.

## Remote identity binding

Every remote run, in both `full` and `coming_soon` mode, must provide:

- `--expected-sha=<40-char-sha>`: the exact, non-placeholder commit deployed at the target URL.
- `--expected-supabase-project-ref=<20-char-ref>`: the exact Supabase project exposed by the deployment health endpoint.
- `--apple-team-id=<10-char-team-id>`: the signed iOS Team ID expected in AASA.
- `--play-signing-sha256=<fingerprint>`: the Play App Signing SHA-256 expected in Asset Links.

The smoke fails before opening a browser if any required binding is missing or malformed. It then fails if `/api/health/maintenance` reports a different SHA or project ref, or if the association JSON does not match the signed mobile identities. A preview PASS therefore does not transfer to production, another preview, or a later deployment.

The only identity-binding exception is `--allow-unbound-local`, and the script rejects that option unless the hostname is `localhost`, `127.0.0.1`, or `::1`.

In the default `full` mode, the script opens a real Chrome or Edge browser and checks:

- `https://hanbang.ai/wedding`
- `https://hanbang.ai/wedding/market-prices`
- unauthenticated `/wedding/lounge` redirect to `/login`
- demo login flow into `/wedding/lounge`
- all three signed-app association endpoints and their iOS/Android identities
- first-party 4xx/5xx responses
- browser console errors
- uncaught page errors

In `coming_soon` mode it instead verifies the public allowlist, signed-app association JSON, full 40-character deployment SHA, account-deletion cron state, sanitized login/app redirects, general API 503 response, and the server-side research intake switch. When intake is closed it also verifies the PII form is absent and the API returns `RESEARCH_INTAKE_CLOSED`; open mode does not submit a real application. This mode rejects malformed and obvious low-entropy placeholder identifiers, then verifies that the deployed association JSON matches the supplied Apple Team ID and **Play App Signing** SHA-256. It cannot prove where those values came from, so signed Apple/Play account evidence remains a separate human gate.

Both modes first check the common release-health contract: exact SHA, exact Supabase project ref, strong rate-limit secret, a complete Turnstile site/secret pair with a canonical HTTPS hostname, maintenance state, research-intake state, and account-deletion cron state.

The health boolean does not redeem a real challenge. Production evidence must separately complete the `signup`, `forgot_password`, `preregister`, and `survey` widgets on `hanbang.ai` and show that Siteverify accepts only the matching hostname/action. A staged `*.vercel.app` health PASS is not evidence that the production widget hostname is configured correctly.

It writes a report under:

```text
.gstack/qa-reports/live-smoke/
```

## Local Dev

If a local web server is running:

```powershell
corepack pnpm qa:live -- --base-url=http://localhost:3000 --allow-unbound-local
```

Do not use `--allow-unbound-local` for a Vercel preview, production, a LAN address, or any other remote host.

For a remote preview, bind the exact preview deployment and its intended database:

```powershell
corepack pnpm qa:live -- --base-url=https://your-preview-url.vercel.app --launch-mode=full --expected-sha=<40-char-sha> --expected-supabase-project-ref=<20-char-ref> --apple-team-id=<10-char-team-id> --play-signing-sha256=<play-app-signing-sha256> --research-intake=closed --account-deletion-cron=closed
```

## Browser Detection

The script uses installed Chrome or Edge. If it cannot find a browser, set:

```powershell
$env:LIVE_SMOKE_BROWSER_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"
corepack pnpm qa:live -- --base-url=https://your-preview-url.vercel.app --launch-mode=full --expected-sha=<40-char-sha> --expected-supabase-project-ref=<20-char-ref> --apple-team-id=<10-char-team-id> --play-signing-sha256=<play-app-signing-sha256> --research-intake=closed --account-deletion-cron=closed
```

## Options

Append optional flags such as `--headed`, `--skip-demo`, `--json`, or `--timeout-ms=60000` to a complete bound command. These flags never replace the remote identity requirements.

Complete `full` and `coming_soon` examples:

```powershell
corepack pnpm qa:live -- --base-url=https://your-preview-url.vercel.app --launch-mode=full --expected-sha=<40-char-sha> --expected-supabase-project-ref=<20-char-ref> --apple-team-id=<10-char-team-id> --play-signing-sha256=<play-app-signing-sha256> --research-intake=closed --account-deletion-cron=closed
corepack pnpm qa:live -- --base-url=https://your-preview-url.vercel.app --launch-mode=coming_soon --expected-sha=<40-char-sha> --expected-supabase-project-ref=<20-char-ref> --apple-team-id=<10-char-team-id> --play-signing-sha256=<play-app-signing-sha256> --research-intake=closed --account-deletion-cron=closed
```

Run `corepack pnpm qa:live -- --help` for the canonical option list. Every remote mode requires `--expected-sha`, `--expected-supabase-project-ref`, `--apple-team-id`, and `--play-signing-sha256`; signed-app association identity is checked in both `coming_soon` and `full`. Intake and deletion cron default to `closed`, but release evidence must state the expected deployed values explicitly instead of relying on defaults.

## How To Read Results

- `PASS` means every check for the selected launch mode matched the requested deployment and safety state, with no unexpected first-party failure, console error, or uncaught page error.
- `FAIL` means the script found a visible routing, browser, or server problem.
- The demo login flow uses the public demo mode and does not create real user data.

## Release Checklist

For the pre-launch production anchor, use the exact deployed commit and approved signed-app identifiers:

```powershell
corepack pnpm qa:live -- --base-url=https://hanbang.ai --launch-mode=coming_soon --expected-sha=<40-char-sha> --expected-supabase-project-ref=<20-char-production-ref> --apple-team-id=<10-char-team-id> --play-signing-sha256=<play-app-signing-sha256> --research-intake=closed --account-deletion-cron=closed
```

After all launch gates and a `full`-mode deployment, bind this limited full-mode canary just as strictly:

```powershell
corepack pnpm qa:live -- --base-url=https://hanbang.ai --launch-mode=full --expected-sha=<40-char-sha> --expected-supabase-project-ref=<20-char-production-ref> --apple-team-id=<10-char-team-id> --play-signing-sha256=<play-app-signing-sha256> --research-intake=<closed-or-open> --account-deletion-cron=<closed-or-open>
```

Replace the state placeholders with the approved values actually deployed. Do not run Supabase remote probes merely because the web smoke passed. Credential rotation, approved target allowlists, write fence, backup, and isolated restore gates in `PRODUCTION_RELEASE_ROLLBACK_RUNBOOK.md` remain separate and must pass before any remote DB action. After those gates, run the explicitly authorized database/media checks as separate evidence.
