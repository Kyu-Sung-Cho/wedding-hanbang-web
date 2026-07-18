# WeddingCode v0.5 Production Couple Flow QA

> [!WARNING]
> **SUPERSEDED / 과거 기술 QA 증적입니다.** 아래 PASS는 2026-07-08 당시 두 개의 합성 QA 응답으로
> 저장·페어링·조회 흐름이 동작했다는 뜻일 뿐, 문항 타당도·커플 해석의 유용성·현재 운영 준비도를
> 증명하지 않습니다. 현재 public/API/DB 수집 차단과 출시 판단은
> [`55_conservative_readiness_audit_2026-07-15.md`](./55_conservative_readiness_audit_2026-07-15.md)가 우선합니다.
> 아래 Production URL, 토큰, 응답 ID를 재사용하거나 이 절차를 다시 실행하지 마세요.
> 2026-07-18 현재 파일에서는 해당 값을 redaction했다. 과거 Git 이력에는 값이 남을 수 있으며,
> API `410 Gone`과 별개로 token 회수·폐기와 과거 QA 행 처리 여부를 별도 확인해야 한다.

Date: 2026-07-08 KST
Environment: production, `https://hanbang.ai`
Build scope: WeddingCode individual result + couple comparison report

## Result

Status: PASS

The production two-person flow was verified with two real submitted responses. The first participant reached the waiting state, the second participant submitted through the invite token, and the couple report API returned a ready comparison payload with two responses.

## Evidence

- QA marker: `prod-2026-07-08T01-51-02-932Z`
- Couple token: `[REDACTED — historical production token; do not restore or reuse]`
- Invite URL: `[REDACTED — historical production invite URL; do not restore or reuse]`
- Response A: `[REDACTED — historical production response ID]`
- Response B: `[REDACTED — historical production response ID]`
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
