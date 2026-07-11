# WeddingCode v0.5 Candidate 6 Plain-Language Reaudit

Date: 2026-07-09

## Scope

- Rechecked the 16 live WeddingCode v0.5 items after the A1 premise repair.
- Rechecked result/report copy for the same plain-language standard.
- Focused on wording that assumes wedding-industry knowledge or forces the user to infer hidden context.

## Confirmed Fixes

- Replaced unexplained terms such as `스드메`, `본식`, `예식장`, `하객`, `식대`, `동선`, `무드`, and `추가금` in the WeddingCode surface checked in this pass.
- A1 now starts from a clear situation: looking for a place that prepares photo shoot, dress, and makeup together.
- B1, B3, and B4 now say `결혼 준비 업체나 장소` instead of the more abstract `업체나 장소` where context is needed.
- C1 now uses concrete parent-facing conditions: food cost, travel time, and parking.
- C3 now says `전통 행사나 가족 선물` instead of assuming the user understands `폐백` or `예물`.
- C4 now says `두 집안` instead of `양가`.
- Result report copy now follows the same wording standard as the questions.

## Verification

- `pnpm --filter @hanbang/web exec vitest run src/lib/weddingCode src/app/api/wedding-code --reporter=dot`
- `pnpm --filter @hanbang/web typecheck`
- `pnpm --filter @hanbang/web lint`
- `pnpm --filter @hanbang/web build`

All checks passed in this session.

## Remaining Truth Boundary

This is the strongest wording and internal-logic pass possible without real user-response data. It should not be described as a validated psychological test. Public copy should keep the current framing: a conversation aid for wedding-preparation decisions.
