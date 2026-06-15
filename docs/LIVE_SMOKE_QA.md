# Live Smoke QA

Use this after deployment to make sure the public wedding routes still work.

## Command

```powershell
pnpm qa:live
```

The script opens a real Chrome or Edge browser and checks:

- `https://hanbang.ai/wedding`
- `https://hanbang.ai/wedding/market-prices`
- unauthenticated `/wedding/lounge` redirect to `/login`
- demo login flow into `/wedding/lounge`
- first-party 4xx/5xx responses
- browser console errors
- uncaught page errors

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
```

## How To Read Results

- `PASS` means the route loaded and no first-party 4xx/5xx, console errors, or uncaught page errors were detected.
- `FAIL` means the script found a visible routing, browser, or server problem.
- The demo login flow uses the public demo mode and does not create real user data.

## Release Checklist

After production deploy:

```powershell
pnpm qa:live
pnpm supabase:security:probe
pnpm community:media:audit
```

If all three pass, the public release surface is healthy enough for manual product QA.
