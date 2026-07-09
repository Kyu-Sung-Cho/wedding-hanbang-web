# WeddingCode v0.5 Candidate 8 Full Item Plain-Language Audit

Date: 2026-07-09

## Scope

This pass checked every live WeddingCode v0.5 question and option, plus the legacy `WC_QUESTIONS` fixture and result/share-card copy that can still surface in WeddingCode-related screens or tests.

The standard was stricter than "technically correct":

- A first-time user should understand the situation without wedding-industry knowledge.
- Every option should describe a concrete thought or action.
- Options should not require guessing hidden context.
- Old shorthand and industry words should not appear in the WeddingCode user-facing surface.

## Live 16-Item Audit

| Item | Decision |
|---|---|
| A1 | Rewrote option wording around "money available", examples shown in 상담, first quoted price, and user reviews. Removed abstract "완성된 모습" style phrasing. |
| A2 | Rewrote 영상·앨범 as a concrete add-on decision: later regret, extra money, cheaper ways to keep key scenes, and whether both want the scene. |
| A3 | Replaced loose "생각한 돈" and "밥값" with first budget and meal cost. Kept 300만 원 because it is the scenario anchor. |
| A4 | Made the premise "예시 사진은 마음에 드는데 후기가 적다" explicit. Removed vague "사진 느낌" wording. |
| B1 | Made sharing behavior concrete: set time, send good/bad points, choose check items, hear partner's thoughts. |
| B2 | Made the one-sided workload situation explicit as "둘 중 한 사람". Rewrote all options as direct actions. |
| B3 | Replaced abstract "잘 보는 부분" with price/location/photo examples and "마지막으로 고를 곳". |
| B4 | Clarified that the problem is too many candidates to research. Rewrote pause option as "더 찾지 않고 쉰다". |
| C1 | Replaced "교통" with "오는 길" in user-facing question text and clarified food, travel time, parking, time/menu changes. |
| C2 | Kept the item because it already passed the plain-language gate after prior changes. |
| C3 | Rewrote the premise as "결혼식 전후에 하는 전통 행사나 가족끼리 주고받는 선물". Replaced "간단히 할 것" with "줄일 것". |
| C4 | Replaced title language with "식장 예약 인원" and options with "식장에 예약해야 하는 최소 인원" so the concept explains itself. |
| D1 | Expanded the future-response option so it names the two possible responses: listen first or organize immediately. |
| D2 | Replaced "어디서 지쳤는지" with "무엇 때문에 지쳤는지". |
| D3 | Rewrote task split option as "바로 할 수 있는 일을 하나씩 맡는다". |
| D4 | Replaced vague "혜택" with concrete "할인이나 서비스" and aligned the decision wording to "예약". |

## Additional Surfaces Checked

- `apps/web/src/constants/weddingCodeForm.ts`: legacy q01-q16 fixture, context labels, concern labels.
- `apps/web/src/constants/weddingCodeResult.ts`: share-card facts, quote text, scenario labels, talk-card text.
- `apps/web/src/lib/weddingCode/report.ts`: individual/couple result copy.
- `apps/web/src/app/wedding-code/WeddingCodeClient.tsx`: context screen label.
- `apps/web/src/app/wedding-code/result/ResultClient.tsx`: result CTA label.
- `apps/web/src/lib/weddingCode/validate.ts`: validation error copy.

## Search Gate

The WeddingCode surface checked in this pass was searched for these old or unclear terms:

`정한 돈`, `완성된 모습`, `가격에 무엇이 들어`, `식대`, `예식장`, `하객`, `스드메`, `본식`, `예물`, `폐백`, `양가`, `전통 절차`, `간단히 할 절차`, `우리 느낌`, `모험`, `비슷한 느낌`, `사진 느낌`, `장소 느낌`, `교통`, `견적`, `무드`, `동선`, `추가금`.

Result: 0 hits in the checked WeddingCode app/result/constants/lib paths.

## Verification

- `pnpm --filter @hanbang/web exec vitest run src/lib/weddingCode src/app/api/wedding-code --reporter=dot`
- `pnpm --filter @hanbang/web typecheck`
- `pnpm --filter @hanbang/web lint`
- `pnpm --filter @hanbang/web build`
- Playwright/Chrome mobile viewport flow through all 16 live questions at `http://localhost:3000/wedding-code`

All checks passed in this session.

## Truth Boundary

This is a copy, clarity, and internal-product validation pass. It is not human-response validation. The correct public framing remains: WeddingCode is a conversation aid for wedding-preparation decisions, not a validated psychological test or relationship prediction tool.
