# Live Smoke QA

Use this after deployment to verify either the full product surface or the pre-launch `coming_soon` safety gate. A PASS applies only to the selected mode and exact deployment; it is not a database migration, backup, or store-release certificate.

## Command

```powershell
pnpm qa:live
```

In the default `full` mode, the script opens a real Chrome or Edge browser and checks:

- `https://hanbang.ai/wedding`
- `https://hanbang.ai/wedding/market-prices`
- unauthenticated `/wedding/lounge` redirect to `/login`
- demo login flow into `/wedding/lounge`
- first-party 4xx/5xx responses
- browser console errors
- uncaught page errors

In `coming_soon` mode it instead verifies the public allowlist, signed-app association JSON, full 40-character deployment SHA, account-deletion cron state, sanitized login/app redirects, general API 503 response, and the server-side research intake switch. When intake is closed it also verifies the PII form is absent and the API returns `RESEARCH_INTAKE_CLOSED`; open mode does not submit a real application. This mode rejects malformed and obvious low-entropy placeholder identifiers, then verifies that the deployed association JSON matches the supplied Apple Team ID and **Play App Signing** SHA-256. It cannot prove where those values came from, so signed Apple/Play account evidence remains a separate human gate.

It writes a report under:

```text
.gstack/qa-reports/live-smoke/
```

## Local Dev

If a local web server is running:

```powershell
pnpm qa:live:local
```

Or pass a custom target:

```powershell
pnpm qa:live -- --base-url=https://your-preview-url.vercel.app
```

## Browser Detection

The script uses installed Chrome or Edge. If it cannot find a browser, set:

```powershell
$env:LIVE_SMOKE_BROWSER_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"
pnpm qa:live
```

## Options

```powershell
pnpm qa:live -- --headed
pnpm qa:live -- --skip-demo
pnpm qa:live -- --json
pnpm qa:live -- --timeout-ms=60000
pnpm qa:live -- --launch-mode=coming_soon --expected-sha=<40-char-sha> --apple-team-id=<10-char-team-id> --play-signing-sha256=<play-app-signing-sha256> --research-intake=closed --account-deletion-cron=closed
```

Run `pnpm qa:live -- --help` for the canonical option list. `--launch-mode=coming_soon` requires `--expected-sha`, `--apple-team-id`, and `--play-signing-sha256`; intake and deletion cron default to `closed` but should still be written explicitly in release evidence.

## How To Read Results

- `PASS` means every check for the selected launch mode matched the requested deployment and safety state, with no unexpected first-party failure, console error, or uncaught page error.
- `FAIL` means the script found a visible routing, browser, or server problem.
- The demo login flow uses the public demo mode and does not create real user data.

## Release Checklist

For the pre-launch production anchor, use the exact deployed commit and approved signed-app identifiers:

```powershell
corepack pnpm qa:live -- --base-url=https://hanbang.ai --launch-mode=coming_soon --expected-sha=<40-char-sha> --apple-team-id=<10-char-team-id> --play-signing-sha256=<play-app-signing-sha256> --research-intake=closed --account-deletion-cron=closed
```

Do not run Supabase remote probes merely because the web smoke passed. Credential rotation, approved target allowlists, write fence, backup, and isolated restore gates in `PRODUCTION_RELEASE_ROLLBACK_RUNBOOK.md` remain separate and must pass before any remote DB action. After those gates and a full launch deployment, run the default full-mode smoke plus the explicitly authorized database/media checks.
