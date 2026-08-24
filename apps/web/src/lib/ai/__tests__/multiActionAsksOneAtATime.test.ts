import { describe, expect, it } from "vitest";

import {
  extractAmoraPendingAction,
  isAmoraFailedProposalNotice,
} from "@/lib/ai/amoraPendingAction";
import type { AiToolDefinition } from "@/lib/ai/toolDefinition";

/**
 * "예산 6천으로 올리고 드레스 투어도 다음 주 토요일로 잡아줘" 는 흔한 요청이다.
 *
 * 계약은 표식을 **정확히 하나**로 못 박고, 둘이면 서버가 둘 다 버린다. 그 자체는
 * 옳다 — 하나만 골라 적용하면 나머지가 조용히 사라져 사용자는 둘 다 된 줄 안다.
 *
 * 문제는 그때 남기던 말이었다.
 *
 *     "방금 제안을 확인 카드로 만들지 못했어요. 같은 요청을 한 번만 다시
 *      보내주시겠어요?"
 *
 * 같은 요청을 다시 보내면 표식이 또 둘이 나온다. **무한 고리다**
 * (2026-08-24 감사). 이제 빠져나갈 방법을 알려준다.
 */

const TOOLS: AiToolDefinition[] = [
  {
    name: "update_budget",
    description: "test",
    input_schema: {
      type: "object",
      properties: { total_budget: { type: "number" } },
      required: ["total_budget"],
    },
  },
  {
    name: "add_schedule_event",
    description: "test",
    input_schema: {
      type: "object",
      properties: { date: { type: "string" }, title: { type: "string" } },
      required: ["date", "title"],
    },
  },
];

const NOW = 1_787_000_000_000;

function extract(text: string) {
  return extractAmoraPendingAction({
    text,
    allowedTools: TOOLS,
    now: NOW,
    createActionId: () => "11111111-1111-4111-8111-111111111111",
  });
}

const BUDGET_MARKER =
  '[pending_action]{"tool":"update_budget","input":{"total_budget":60000000}}[/pending_action]';
const SCHEDULE_MARKER =
  '[pending_action]{"tool":"add_schedule_event","input":{"date":"2026-09-05","title":"드레스 투어"}}[/pending_action]';

describe("한 번에 두 가지를 부탁하면 빠져나갈 방법을 알려준다", () => {
  it("표식이 둘이면 카드를 내지 않는다", () => {
    const result = extract(`알겠어요.\n${BUDGET_MARKER}\n${SCHEDULE_MARKER}`);
    expect(result.pendingAction).toBeNull();
  });

  it("하나만 몰래 적용하지 않는다", () => {
    // 나머지가 조용히 사라지면 사용자는 둘 다 된 줄 안다.
    const result = extract(`${BUDGET_MARKER}\n${SCHEDULE_MARKER}`);
    expect(result.pendingAction).toBeNull();
    expect(result.cleanText).not.toContain("6,000");
  });

  it("같은 요청을 다시 보내라고 하지 않는다 — 그건 무한 고리다", () => {
    const result = extract(`${BUDGET_MARKER}\n${SCHEDULE_MARKER}`);
    expect(result.cleanText).not.toContain("같은 요청을 한 번만 다시");
    expect(result.cleanText).toContain("하나씩");
  });

  it("표식이 하나면 그대로 카드가 나온다", () => {
    const result = extract(`알겠어요.\n${BUDGET_MARKER}`);
    expect(result.pendingAction).not.toBeNull();
    expect(result.pendingAction?.tool).toBe("update_budget");
  });

  it("표식이 없으면 원래 경로 그대로다", () => {
    const result = extract("지금은 결혼식장부터 보면 돼요.");
    expect(result.pendingAction).toBeNull();
    expect(result.hadPendingActionTag).toBe(false);
    expect(result.cleanText).toContain("결혼식장");
  });
});

describe("이 안내는 프로바이더 이력에 남기지 않는다", () => {
  // 카드를 못 낸 턴이 이력에 남으면 모델이 그 모양을 배운다. 사용자가 안내대로
  // 하나씩 나눠 말해도 카드가 점점 안 나오고 "확인해 주시면 적용할게요" 같은
  // 누를 것 없는 말만 하게 된다(2026-08-24 감사).
  it("두 가지 안내 턴은 걸러진다", () => {
    const result = extract(`${BUDGET_MARKER}
${SCHEDULE_MARKER}`);
    expect(isAmoraFailedProposalNotice(result.cleanText)).toBe(true);
  });

  it("평범한 답변은 걸러지지 않는다", () => {
    expect(isAmoraFailedProposalNotice("지금은 결혼식장부터 보면 돼요.")).toBe(false);
  });

  it("카드가 나온 턴도 걸러지지 않는다", () => {
    const result = extract(`알겠어요.
${BUDGET_MARKER}`);
    expect(isAmoraFailedProposalNotice(result.cleanText)).toBe(false);
  });
});
