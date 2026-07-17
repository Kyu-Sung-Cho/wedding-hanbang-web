# Production performance baseline (2026-07-17 KST)

Status: **PRE-DEPLOY BASELINE — must be repeated on Preview and Production**

## Public landing page

Measured from a fresh gstack Chromium daemon against
`https://hanbang.ai/landing`:

| Metric | Result | Gate |
| --- | ---: | --- |
| First Contentful Paint | 556 ms | Pass (< 1.8 s) |
| Full load | 862 ms | Pass |
| Requests | 37 | Pass (< 50) |
| JavaScript transfer | 373,985 bytes | Pass (< 500 KiB) |
| Total transfer | 3,614,836 bytes | **Fail** (< 2 MiB) |

The largest resource was
`public/images/amora-hero-bouquet-custom.png` at 2,205,218 bytes, about 61% of
the total transfer. The release branch replaces it with a visually inspected,
same-dimension WebP at 161,106 bytes and enforces a 350 KiB test budget. The
old PNG is removed.

## Server/API region affinity

The Vercel project was configured to run functions in `iad1` while the linked
production Supabase database runs in AWS `ap-south-1` (Mumbai). Five sequential
public `/api/vendors?limit=1` requests had time-to-first-byte values of 1.165,
0.523, 0.899, 0.913, and 0.510 seconds (median 0.899 seconds).

Vercel documents `bom1` as its Mumbai `ap-south-1` compute region and recommends
placing functions in the same region as the database for lowest latency:
https://vercel.com/docs/regions

The release therefore pins `apps/web/vercel.json` to `regions: ["bom1"]`.
Static files remain on Vercel's global CDN. This is an application-compute
placement change, not a Supabase data migration.

## Acceptance after deployment

1. Run the same cold-browser landing measurement; total transfer must be below
   2 MiB and the old PNG must not be requested.
2. Run at least 20 sequential and 5 concurrent public API probes from Korea.
3. Compare p50/p95 TTFB with this baseline and inspect Vercel traces for the
   executed region.
4. Exercise Amora streaming so DB affinity does not hide an OpenAI latency
   regression.
5. Roll back the deployment if p95 API TTFB or first-token latency regresses by
   more than 20% without an explained cold start.
