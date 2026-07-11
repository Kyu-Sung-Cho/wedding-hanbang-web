# WeddingCode candidate.5 middle-school clarity rewrite

Date: 2026-07-09
Version: `v0.5-candidate.5`
Previous: `v0.5-candidate.4`

## Trigger

The user raised the correct standard:

- Questions and options must not require wedding knowledge.
- A person should not need to infer what a term means.
- A middle-school-level reader should understand the situation immediately.
- If a wedding term is necessary, the sentence must explain the practical meaning.

This pass treats comprehension as a product requirement, not a style preference.

## Main changes

### Versioning

- Bumped live form version to `v0.5-candidate.5`.
- Added `v0.5-candidate.4` to compatible versions so existing draft responses remain comparable.

### Replaced wedding jargon

| Before | After |
|---|---|
| 스드메 | 스튜디오 사진, 드레스, 메이크업 |
| 견적서 | 비용표 |
| 본식 | 결혼식 |
| 예식장 | 결혼식장 |
| 식대 | 밥값 / 식사 비용 |
| 하객 | 오는 사람 / 초대 손님 |
| 보증인원 | 최소 예약 인원 |
| 동선 | 이동 / 오는 길 |
| 무드 | 사진 느낌 / 장소 느낌 |
| 추가금 | 추가 비용 |
| 총액 | 총금액 |
| 계약 전 | 예약을 확정하기 전 |

### Item changes

- A1 now asks about a "스튜디오 사진, 드레스, 메이크업 비용표" instead of an SDM quote.
- A2 now says "결혼식 영상이나 앨범" instead of "본식 영상이나 앨범 옵션."
- A3 now says "결혼식장" and "밥값까지 모두 더한 최종 금액."
- A4 now says "사진 촬영 업체" and "이용한 사람들의 후기."
- B items use "줄이다", "아쉬운 점", and "느낌" instead of more abstract comparison language.
- C1-C4 now explain family/guest/venue concepts without assuming wedding vocabulary.
- D4 now says "오늘 예약을 확정하면 혜택이 있다" so `계약` is not the only clue.

## Result copy alignment

Result and couple-card copy was updated so the test does not ask in plain language and then return to jargon in the report.

Examples:

- `드레스·스튜디오 선택` -> `사진·드레스 선택`
- `예식장·하객·가족 조율` -> `결혼식장·초대 손님·가족 조율`
- `보증인원` -> `최소 예약 인원`
- `총액·추가금` -> `총금액·추가 비용`
- `무드` -> `느낌`

## Remaining risk

This is still not human-validated. Candidate.5 is clearer by product review, but the next gate remains:

- n=5 cognitive interview for comprehension
- n=20 mini test for answer distribution and "correct answer" bias
- real couple review for whether the report creates a useful conversation

## Cognitive interview focus

Ask participants:

1. Did any word stop you for even one second?
2. Did any option feel like the obvious correct answer?
3. Could you explain the situation in your own words after reading it once?
4. Would you feel okay sending your answer to your partner?
5. Did the result use any word that felt harder than the question?
