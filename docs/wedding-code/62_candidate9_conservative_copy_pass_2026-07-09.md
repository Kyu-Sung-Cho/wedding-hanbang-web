# WeddingCode candidate.9 conservative copy pass

Date: 2026-07-09
Truth refresh: 2026-07-10
Version: `v0.5-candidate.9`
Scope: local candidate.9 questions, legacy form fixture copy, individual/couple report copy, copy regression test.

> 이 문서는 candidate.9 카피 패스 당시 기록이다. 이후 보안·데이터 무결성·UI 수정과 production build/browser 재검증은 [`../AUDIT_2026-07-10_CONSERVATIVE_FULL_REVIEW.md`](../AUDIT_2026-07-10_CONSERVATIVE_FULL_REVIEW.md)가 최신 경계를 제공한다. 아래 “빌드·브라우저를 재실행하지 않았다”는 문장은 이 시점의 역사적 사실로 유지한다.

## Version Boundary

Candidate.9 was not live merely because it existed locally. Verified snapshot on 2026-07-10:

| Surface | Commit/source | WeddingCode version |
|---|---|---|
| Local branch | `d6ff8e88` | `v0.5-candidate.9` |
| Draft PR #37 remote head | `91cbad68` | `v0.5-candidate.8` |
| `origin/main` | `8d8933e1` | `v0.5-candidate.4` |
| `https://hanbang.ai/wedding-code` production chunk | checked directly on 2026-07-10 | `v0.5-candidate.4` |

Push, merge, and deploy are separate events. Re-check all four surfaces before making a current-version claim.

## Goal

Make the candidate WeddingCode questions and result copy easier for first-time users to understand without changing the scoring structure.

This pass intentionally avoided broad rewrites. The goal was to remove phrases that could feel vague, one-sided, or like internal planning language.

## Changed

- Bumped `WEDDING_CODE_V05_VERSION` and `WEDDING_CODE_FORM_VERSION` from `v0.5-candidate.8` to `v0.5-candidate.9`.
- Kept `v0.5-candidate.8` in compatible versions because this pass does not change question keys, option order, or scoring weights.
- Replaced confusing or stiff wording in live questions:
  - `후보` -> `곳`
  - `줄여온다` -> `추려서 공유한다`
  - `꼭 지키고 싶은` -> `먼저 정해두고 싶은`
  - `그대로 할 것과 줄일 것` -> `어떤 건 그대로 하고, 어떤 건 간단히 바꿀지`
  - `점수 차이` -> `답변 차이`
- Matched the same wording in result report and couple report copy.
- Added a regression test so the public WeddingCode question/report copy does not reintroduce the flagged phrases:
  - `후보`
  - `줄여온다`
  - `줄일 것`
  - `그대로 할 것`
  - `점수 차이`
  - `꼭`

## Conservative Review

No scoring weights were changed.

No construct definitions were changed.

No new psychological, scientific, compatibility, or prediction claim was added.

The update is a readability and product-language pass only.

## Hostile Review Notes

Potential user objection: "I still do not know what to choose."

Mitigation:
- Questions remain concrete wedding-preparation situations.
- Options are now more clearly action-oriented.
- B3/B4 no longer ask users to interpret internal words like `후보`.
- C2/C3 no longer force a hard-sounding `꼭` or `줄일 것` frame.

Potential product risk: "The wording got too soft and lost scoring precision."

Mitigation:
- Option order and weights were preserved.
- Each edited option still maps to the same construct intent as candidate.8.

## Claim Audit

No external data, price, statistic, paper, DOI, URL, or scientific claim was added in this pass.

All changed claims are product-language claims about clarity and conversation framing, not factual market claims.

## Verification

Commands independently rerun from the repository root against local candidate.9 commit `d6ff8e88`:

```bash
corepack pnpm --filter @hanbang/web test -- --reporter=dot
corepack pnpm --filter @hanbang/web exec vitest run src/lib/weddingCode src/app/api/wedding-code --reporter=dot
corepack pnpm --filter @hanbang/web typecheck
corepack pnpm --filter @hanbang/web lint
```

Results:

- Full `@hanbang/web` suite: 44 files passed, 365 tests passed.
- Focused WeddingCode/API suite: 8 files passed, 49 tests passed.
- Typecheck passed.
- Lint passed.

The 2026-07-10 audit did not independently rerun the production build or browser flow. Any earlier pass record is historical evidence and must not be reported as a fresh final-HEAD or production verification.

## Remaining Gate

This is still a candidate, not a validated final. Source status remains `candidate_pending_human_validation`. No n=5 interview or n=20 mini-test completion evidence was found in this handoff.

Before calling the question set final:

- Run n=5 cognitive interviews.
- Confirm every option is understood without facilitator explanation.
- Confirm B3/B4 and C2/C3 are understandable without explanation and record repeated hesitation.
- Run the n=20 mini test after the 5-person interview pass.
- Keep the product claim limited to a wedding-preparation conversation aid. Do not call it a validated psychological test, compatibility score, or relationship predictor.
