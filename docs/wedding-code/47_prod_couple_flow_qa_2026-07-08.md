# WeddingCode v0.5 Production Couple Flow QA

Date: 2026-07-08 KST
Environment at test time: production, `https://hanbang.ai`
Build scope: WeddingCode individual result + couple comparison report

> Historical QA snapshot. This document records the production build that was
> live on 2026-07-08; it is not evidence that the current local or PR candidate
> is deployed. Capability tokens and response identifiers have been removed.

## Result

Status at test time: PASS

The production two-person flow was verified with two intentionally submitted QA
responses. The first participant reached the waiting state, the second
participant submitted through the invite flow, and the couple report API
returned a ready comparison payload with two responses.

## Sanitized Evidence

- QA marker: `prod-2026-07-08T01-51-02-932Z`
- Couple token: `[REDACTED]`
- Invite URL: `[REDACTED]`
- Response A: `[REDACTED]`
- Response B: `[REDACTED]`
- Waiting report status after A pairing: `waiting`
- Ready report status after B submission: `ready`
- Response count: `2`
- Overlap score returned by the historical build: `80.1`
- Easy point count: `2`
- Talk point count: `0`
- Browser console/page errors: none observed for A or B

Local screenshot evidence at test time:

- `.gstack/qa-reports/wedding-code-prod-e2e/A-result.png`
- `.gstack/qa-reports/wedding-code-prod-e2e/A-waiting-after-pair.png`
- `.gstack/qa-reports/wedding-code-prod-e2e/B-result.png`
- `.gstack/qa-reports/wedding-code-prod-e2e/B-ready-result.png`

## What Was Verified

- Production `/wedding-code` accepted a full 16-answer submission.
- Production `/api/wedding-code/response` stored two QA responses.
- Production `/api/wedding-code/pair` attached the first response to a couple
  token.
- The invite URL carried the token into the second submission.
- The second response stored the paired state in the result backup.
- Production `/api/wedding-code/couple-report` returned `waiting`, then `ready`,
  with `responseCount: 2` and a numeric overlap value.
- The couple report response did not expose the raw answer key `"A1"`.
- The second result page rendered the ready couple-comparison UI.

## Boundary And Security Notes

- The invite token was created through the production pair endpoint from the
  browser automation context, not by physically clicking the invite button.
- This QA verified the technical flow and copy posture only. It did not validate
  whether the interpretation is useful to real couples.
- The original revision exposed a live capability token and two response UUIDs.
  Removing them from the current file does not remove them from Git history.
  A read-only check on 2026-07-10 confirmed that the historical capability still
  returned HTTP 200 with `status: ready` and `responseCount: 2`. Treat it as
  actively compromised, not merely unverified, and revoke the token or delete
  the corresponding QA rows before relying on token secrecy.
- Do not place bearer tokens, capability URLs, response UUIDs, or raw user data
  in future QA documents. Record only a non-sensitive run marker and aggregate
  outcome.

## Next Gate

Run the five-person cognitive interview pass before making stronger product
claims or adding distribution-oriented features.
