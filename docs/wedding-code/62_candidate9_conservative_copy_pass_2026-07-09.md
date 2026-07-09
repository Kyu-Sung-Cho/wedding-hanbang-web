# WeddingCode candidate.9 conservative copy pass

Date: 2026-07-09
Version: `v0.5-candidate.9`
Scope: live v0.5 questions, legacy form fixture copy, individual/couple report copy, copy regression test.

## Goal

Make the WeddingCode questions and result copy easier for first-time users to understand without changing the scoring structure.

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

Commands run:

```bash
pnpm --filter @hanbang/web test -- src/lib/weddingCode/__tests__/report.test.ts src/lib/weddingCode/__tests__/coupleReport.test.ts src/lib/weddingCode/__tests__/score.test.ts
pnpm --filter @hanbang/web typecheck
pnpm --filter @hanbang/web lint
pnpm --filter @hanbang/web build
```

Results:

- WeddingCode tests: 44 files passed, 365 tests passed.
- Typecheck passed.
- Lint passed.
- Production build passed.

## Remaining Gate

This is still a candidate, not a validated final.

Before calling the question set final:

- Run n=5 cognitive interviews.
- Confirm no participant asks "what does this option mean?"
- Confirm B3/B4 and C2/C3 are understandable without explanation.
- Run the n=20 mini test after the 5-person interview pass.
