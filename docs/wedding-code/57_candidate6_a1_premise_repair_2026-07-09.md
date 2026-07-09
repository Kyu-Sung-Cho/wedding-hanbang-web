# WeddingCode candidate.6 A1 premise repair

Date: 2026-07-09
Version: `v0.5-candidate.6`
Previous: `v0.5-candidate.5`

## Trigger

Candidate.5 made A1 easier in vocabulary, but the premise was still wrong.

Problem:

- The question said the user received a `스튜디오 사진, 드레스, 메이크업 비용표`.
- One option asked about `사진 파일`.
- Another option asked whether the `사진 느낌` matched taste.
- This forced the user to infer what kind of thing they had received and why only photos were being judged when the question also named dress and makeup.

This failed the current standard:

> No hidden wedding knowledge. No guessing. A user should understand the situation and all options from the sentence itself.

## Change

Changed A1 from a strange "cost table" premise to a concrete consultation premise:

```text
사진 촬영, 드레스, 메이크업을 한 번에 준비해주는 곳을 찾았어요.
처음 상담에서 제일 먼저 확인할 것은?
```

Options now stay inside that one scene:

- `전체 비용이 우리가 정한 돈 안에 들어오는지`
- `완성된 모습이 우리가 원하는 느낌인지`
- `가격에 무엇이 들어 있고, 무엇은 따로 돈을 내야 하는지`
- `이 업체를 이용한 사람들의 후기가 좋은지`

## Why this is better

- The user no longer needs to know what `스드메` or a package quote is.
- `사진`, `드레스`, and `메이크업` are treated as one prepared result, not as a photo-only question.
- The included-items option no longer mentions `사진 파일`, which required prior wedding-package knowledge.
- The four choices are comparable first checks during a first consultation.

## Result copy alignment

Updated A1 result copy from:

- `비용표·추가 비용`
- `가격에 들어 있는 것과 원하는 사진 느낌`

To:

- `사진·드레스·메이크업`
- `전체 비용, 포함 내용, 원하는 모습`

This keeps the result from reintroducing the ambiguity removed from the question.

## Remaining risk

Still needs human validation. In cognitive interviews, ask:

1. "이 상황에서 무엇을 받았거나 무엇을 하고 있는지 바로 알겠나요?"
2. "`완성된 모습`이 사진, 드레스, 메이크업 전체를 뜻한다고 느껴지나요?"
3. "`가격에 무엇이 들어 있고, 무엇은 따로 돈을 내야 하는지`가 바로 이해되나요?"
