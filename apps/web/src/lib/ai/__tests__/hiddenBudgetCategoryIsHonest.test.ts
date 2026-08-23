import { describe, expect, it } from "vitest";

import { buildAmoraAtomicToolOperation } from "@/lib/ai/amoraAtomicToolOperation";
import { getWeddingPlannerSystemPrompt } from "@/lib/ai/prompts";

/**
 * 사용자가 예산 화면에서 지운 항목에 아모라가 쓰면 안 된다.
 *
 * 삭제는 `progress.__hidden` 에 키를 넣는 방식이라 값 자체는 남는다. 화면은
 * 그 목록으로 걸러 그리고 합계에서도 뺀다(BudgetContent). 그런데 아모라는
 * `__hidden` 을 어디서도 보지 않았다.
 *
 * 결과(2026-08-24 감사): 한복을 지운 사용자가 "한복 예산 300만원으로 해줘"
 * 라고 하면 아모라가 카드를 내고 "반영했어요" 라고 말하는데 **예산 화면에는
 * 아무 변화가 없다.** 값은 DB 에 들어가지만 화면에도 합계에도 안 나온다.
 * 사용자에게는 아모라가 거짓말한 것으로 보인다.
 *
 * 두 겹으로 막는다 — 아모라가 그 항목을 **보지 못하게** 하고, 그래도 쓰려 하면
 * **정직하게 거절**한다.
 */

const HIDDEN = "hanbok";

function contextWith(hidden: string[]) {
  return {
    coupleId: "11111111-1111-4111-8111-111111111111",
    weddingContext: {
      progress: {
        venue: { category: "venue", budget: 20_000_000, spent: 0 },
        [HIDDEN]: { category: HIDDEN, budget: 3_000_000, spent: 0 },
        __hidden: hidden,
      },
    },
  } as never;
}

function promptWith(hidden: string[]) {
  return getWeddingPlannerSystemPrompt({
    weddingDate: "2027-05-15",
    budget: 50_000_000,
    venue: null,
    progress: contextWith(hidden).weddingContext.progress as never,
    preparationStatus: null,
    brideName: "신부",
    groomName: "신랑",
    bookings: [],
    scheduleEvents: [],
    chatSummaries: [],
    pastConflicts: [],
    pastDecisions: [],
  } as never);
}

describe("지운 예산 항목에는 쓰지 않는다", () => {
  it("쓰려고 하면 반영하지 않고 화면을 가리킨다", () => {
    const op = buildAmoraAtomicToolOperation(
      "update_category_budget",
      { category: HIDDEN, budget: 3_000_000 },
      contextWith([HIDDEN]),
      "a".repeat(64),
    );
    expect(op.domainMutation).toEqual({ kind: "none" });
    expect(op.result.success).toBe(false);
    expect(op.result.displayMessage).toContain("예산 화면");
  });

  it("지우지 않은 항목은 그대로 쓴다", () => {
    const op = buildAmoraAtomicToolOperation(
      "update_category_budget",
      { category: "venue", budget: 21_000_000 },
      contextWith([HIDDEN]),
      "b".repeat(64),
    );
    expect(op.result.success).toBe(true);
    expect(op.domainMutation).not.toEqual({ kind: "none" });
  });
});

describe("지운 항목은 아모라에게 보이지도 않는다", () => {
  it("프롬프트의 카테고리 현황에서 빠진다", () => {
    const withHidden = promptWith([HIDDEN]);
    const withoutHidden = promptWith([]);
    // 대조군: 지우지 않으면 실린다.
    expect(withoutHidden).toContain(`(${HIDDEN})`);
    // 지우면 빠진다.
    expect(withHidden).not.toContain(`(${HIDDEN})`);
    // 다른 항목은 그대로다.
    expect(withHidden).toContain("(venue)");
  });
});
