# WeddingCode candidate.4 item re-audit

Date: 2026-07-09
Version reviewed: `v0.5-candidate.4`
Scope: current live v0.5 question copy, forced-choice framing, scoring continuity, and result-card copy alignment.

---

## 1. Summary

The 16-item set is still structurally usable as a candidate set:

- 16 questions are present.
- Each question has 4 options.
- All options keep the same scoring weights after this pass.
- `WEDDING_CODE_V05_EXPOSURE_MAX` still matches the computed exposure from the item data.
- Public result copy still avoids compatibility, diagnosis, success prediction, rarity, and banned relationship-judgment language.

This pass does not make the test validated. The status remains `candidate_pending_human_validation`.

---

## 2. Current evidence status

| Claim | Grade | Evidence | Status |
|---|---|---|---|
| The current app uses `WEDDING_CODE_V05_QUESTIONS`, not legacy `WC_QUESTIONS`. | E | `WeddingCodeClient.tsx`, `ResultClient.tsx`, API validation imports | CONFIRMED |
| The legacy `WC_QUESTIONS` block can confuse maintainers if it looks like the live form. | E/I | `weddingCodeForm.ts` still exports old q01-q16, only share-card tests use it | CONFIRMED |
| `300만 원` remains a plausible scenario gap, not a universal benchmark. | S/I | KCA/price.go.kr 2026-05 wedding-service data shows regional and item-level price differences; exact user case varies | CONFIRMED AS SCENARIO ONLY |
| candidate.4 is human-validated. | E | item status is `candidate_pending_human_validation` | MISMATCH |

Source note for market context:

- Korea Consumer Agency `price.go.kr` wedding statistics show nationwide wedding-service total contract price around 2,142만원 and item-level venue/SDM information for 2026-05.
- `price.go.kr` also documents SDM as studio, dress, and makeup, and exposes venue items such as meal cost and minimum guarantee count.

---

## 3. Item-by-item re-audit

| Item | Judgment | Action |
|---|---|---|
| A1 견적서 추가금 | Good. Clear first quote-review situation. `스드메` is expanded. | Keep. |
| A2 오래 남을 옵션 | Good. Meaning, cost, alternatives, and shared desire are comparable first thoughts. | Keep. |
| A3 예산보다 300만 원 더 드는 예식장 | Good as a scenario. The number should not be presented as a universal average. | Keep. |
| A4 포트폴리오는 좋은데 후기가 적음 | Good. Balances taste and confirmation material. | Keep. |
| B1 나만 먼저 마음에 든 곳 | Good. Sharing modes are comparable. | Keep. |
| B2 준비가 한쪽에게 쏠릴 때 | The old sentence could sound like blame. | Changed to "요즘 한쪽이 결혼 준비를 더 많이 맡고 있는 것 같아요." |
| B3 중요하게 보는 점이 다를 때 | Good. Delegation, joint review, narrowing, and table comparison are comparable. | Keep. |
| B4 업체나 장소가 너무 많을 때 | Good. The stop-more-searching option is valid as overload management. | Keep. |
| C1 부모님은 음식과 교통을 볼 때 | One option sounded clipped: "보증인원 숫자". | Changed to "식대, 이동 시간, 보증인원 같은 실제 조건." |
| C2 부모님께 처음 말할 때 | Good. Still needs human check for whether "양보하기 어려운" feels too strong. | Keep. |
| C3 전통 절차를 줄이고 싶을 때 | `예물` is not strictly an "예식 절차", so the question category was too narrow. | Changed title/question/options to "가족과도 이야기할 항목" and "그대로 할 것/간단히 할 것." |
| C4 하객 수와 보증인원 | Good. Minimum guarantee is explained inline. | Keep. |
| D1 걱정을 말했는데 방법부터 나올 때 | The old wording could make the partner look careless. | Added "도와주려는 마음으로" to lower blame. |
| D2 준비 얘기만 하면 피곤할 때 | Good. Rest, emotional check, one-topic focus, and task split are comparable. | Keep. |
| D3 준비 속도가 다르게 느껴질 때 | One option and result prompt could imply one side is simply late. | Changed to "각자 어디서 막히는지" and "속도가 달라진 이유." |
| D4 당일 혜택이 있는 상담 후 결정 | The fast-decision option sounded too much like certainty seeking. | Changed to "오늘 결정해도 괜찮은 이유가 분명한지." |

---

## 4. Copy changes made

### Forced-choice instruction

Changed:

- `지금 나에게 가장 가까운 답 하나를 골라주세요.`

To:

- `그중 지금 가장 먼저 떠오르는 반응 하나를 골라주세요.`

Reason: v0.5 asks for first response priority, not identity.

### Legacy fixture clarification

`weddingCodeForm.ts` still contains old q01-q16 copy for share-card layout tests. The comment now marks it as a legacy fixture, not the live question source.

---

## 5. Remaining risks

- Human validation is still required. This pass is a product/copy audit, not evidence of reliability.
- Early-stage users may still answer some vendor/venue questions hypothetically. The UI now has better first-response framing, but stage-aware wording or a visible hypothetical note may be worth testing.
- C2's "양보하기 어려운" should be checked in cognitive interviews for stiffness or defensiveness.
- Legacy share-card constants are not user-facing now, but should eventually be retired or moved to a fixture file.

---

## 6. Next validation questions

Ask cognitive interview participants:

1. "문항마다 하나만 고르는 이유가 '가장 먼저 떠오르는 반응'이라는 점이 이해됐나요?"
2. "B2가 한쪽을 탓하는 말처럼 들리지는 않았나요?"
3. "C3에서 폐백, 주례, 예물 예시가 같은 묶음으로 자연스럽게 이해됐나요?"
4. "D1에서 상대가 나쁘게 묘사된다고 느꼈나요?"
5. "D4의 빠른 결정 선택지가 무책임하게 보이거나, 반대로 정답처럼 보였나요?"
