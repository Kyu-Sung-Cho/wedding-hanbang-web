# WeddingCode v0.5 Production Couple Flow QA

Date: 2026-07-08 KST
Environment: production, `https://hanbang.ai`
Build scope: WeddingCode individual result + couple comparison report

## Result

Status: PASS

The production two-person flow was verified with two real submitted responses. The first participant reached the waiting state, the second participant submitted through the invite token, and the couple report API returned a ready comparison payload with two responses.

## Evidence

- QA marker: `prod-2026-07-08T01-51-02-932Z`
- Couple token: `35abc9ca-9c06-4217-bf85-5bddb31dc305`
- Invite URL: `https://hanbang.ai/wedding-code?ct=35abc9ca-9c06-4217-bf85-5bddb31dc305`
- Response A: `24ab1ab1-5e1d-4ad5-8a1c-aa564e07178f`
- Response B: `5dcda455-6468-4d8d-9cef-39987ca575fa`
- Waiting report status after A pairing: `waiting`
- Ready report status after B submission: `ready`
- Response count: `2`
- Overlap score: `80.1`
- Easy point count: `2`
- Talk point count: `0`
- Browser console/page errors: none observed for A or B

Local screenshot evidence:

- `.gstack/qa-reports/wedding-code-prod-e2e/A-result.png`
- `.gstack/qa-reports/wedding-code-prod-e2e/A-waiting-after-pair.png`
- `.gstack/qa-reports/wedding-code-prod-e2e/B-result.png`
- `.gstack/qa-reports/wedding-code-prod-e2e/B-ready-result.png`

## What Was Verified

- Production `/wedding-code` form accepts a full 16-answer submission.
- Production `/api/wedding-code/response` stores response A and response B.
- Production `/api/wedding-code/pair` can attach response A to a couple token.
- Production invite URL with `?ct=` carries the token into response B submission.
- Response B stores `paired: true` and the same `coupleToken` in the result backup.
- Production `/api/wedding-code/couple-report?ct=...` returns:
  - `status: "waiting"` after only A is paired.
  - `status: "ready"` after B submits.
  - `responseCount: 2`.
  - numeric `report.overlapScore`.
- The couple report response did not expose raw answer key `"A1"` in the returned JSON.
- The B result page rendered the ready couple comparison UI and included the overlap label.

## Boundary Notes

- A's invite token was created by calling the same production pair endpoint from the browser automation context, not by physically clicking the invite button. The resulting waiting UI and invite state were visually verified after reload. The click handler itself had already been covered in local browser QA.
- The two production rows intentionally include `Codex QA ...` free-text markers so they can be identified later if cleanup is needed.
- This QA verifies technical flow and copy posture. It does not validate whether the couple-comparison interpretation is useful to real couples; that requires the next cognitive interview step.

## Next Gate

Proceed to the five-person cognitive interview pass before making stronger product claims or adding distribution-oriented features.
