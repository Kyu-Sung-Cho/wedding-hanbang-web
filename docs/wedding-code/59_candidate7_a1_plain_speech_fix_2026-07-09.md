# WeddingCode v0.5 Candidate 7 A1 Plain-Speech Fix

Date: 2026-07-09

## Trigger

The A1 options still sounded abstract on the live screen:

- `전체 비용이 우리가 정한 돈 안에 들어오는지`
- `완성된 모습이 우리가 원하는 느낌인지`
- `가격에 무엇이 들어 있고, 무엇은 따로 돈을 내야 하는지`

The issue was not technical correctness. The issue was that a first-time user could still ask, "what exactly does this mean?"

## Change

A1 now uses direct 상담-language:

- `우리가 쓸 수 있는 돈 안에서 가능한지`
- `사진, 드레스, 메이크업 느낌이 마음에 드는지`
- `기본 가격에 들어 있는 것과 따로 돈을 내야 하는 것`
- `이곳을 이용한 사람들의 후기가 괜찮은지`

Related result copy was updated to avoid `완성된 모습`, `정한 돈`, and vague `원하는 모습` language.

## Verification

- `pnpm --filter @hanbang/web exec vitest run src/lib/weddingCode src/app/api/wedding-code --reporter=dot`
- `pnpm --filter @hanbang/web typecheck`
- `pnpm --filter @hanbang/web lint`
- `pnpm --filter @hanbang/web build`
- In-app browser at `http://localhost:3000/wedding-code`

The browser showed the new A1 text and did not show the old A1 option text.
