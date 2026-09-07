import { describe, expect, it } from "vitest";

import {
  extractAmoraPendingAction,
  isAmoraFailedProposalNotice,
} from "@/lib/ai/amoraPendingAction";
import type { AiToolDefinition } from "@/lib/ai/toolDefinition";
import { createAmoraActionQueue, resolveAmoraActionQueue } from "@/lib/ai/amoraActionQueue";

/**
 * "예산 6천으로 올리고 드레스 투어도 다음 주 토요일로 잡아줘" 는 흔한 요청이다.
 *
 * 계약은 표식을 **정확히 하나**로 못 박는다. 예전에는 둘이면 서버가 둘 다 버렸다 —
 * "하나만 골라 적용하면 나머지가 조용히 사라져 사용자는 둘 다 된 줄 안다" 는 이유였다.
 *
 * 2026-09-04 그 균형을 바꿨다. 조용히 사라지는 것은 **서버가 직접 말해서** 없앨 수
 * 있지만, 카드가 0개가 되는 손해는 없앨 수 없다(라이브에서 사용자가 일정 세 건을
 * 부탁하고 아무것도 못 받았다). 이제 통과한 첫 표식은 카드가 되고, 나머지가 몇 건
 * 남았는지는 서버 소유 문장이 알린다. 확인 없이는 무엇도 실행되지 않는다.
 *
 * 통과한 표식이 하나도 없을 때 남기는 말은 그대로다. 그때 "같은 요청을 다시
 * 보내주세요" 라고 하면 표식이 또 둘 나오는 **무한 고리**가 된다(2026-08-24 감사).
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

/** 어떤 도구에도 없는 필드 이름이라 검증을 통과하지 못한다. */
const BROKEN_MARKER =
  '[pending_action]{"tool":"update_budget","input":{"budget_total":60000000}}[/pending_action]';
const BROKEN_SCHEDULE_MARKER =
  '[pending_action]{"tool":"add_schedule_event","input":{"event_date":"2026-09-05"}}[/pending_action]';

describe("한 번에 두 가지를 부탁하면 첫 건을 내고 나머지를 말해준다", () => {
  it("첫 카드 뒤의 유효한 요청도 입력 그대로 보존한다", () => {
    const result = extract(`${BUDGET_MARKER}\n${SCHEDULE_MARKER}`);
    expect(result.remainingActions).toEqual([
      { tool: "add_schedule_event", input: { date: "2026-09-05", title: "드레스 투어" } },
    ]);
  });

  it("입력이 같은 중복 요청은 한 번만 보존하고 잘못된 표식은 큐에 넣지 않는다", () => {
    const duplicate = '[pending_action]{"input":{"title":"드레스 투어","date":"2026-09-05"},"tool":"add_schedule_event"}[/pending_action]';
    const result = extract(`${BROKEN_MARKER}\n${BUDGET_MARKER}\n${SCHEDULE_MARKER}\n${duplicate}`);
    expect(result.remainingActions).toEqual([
      { tool: "add_schedule_event", input: { date: "2026-09-05", title: "드레스 투어" } },
    ]);
  });

  it("표식이 둘이면 첫 건이 카드가 된다", () => {
    const result = extract(`알겠어요.\n${BUDGET_MARKER}\n${SCHEDULE_MARKER}`);
    expect(result.pendingAction?.tool).toBe("update_budget");
    expect(result.pendingAction?.input).toEqual({ total_budget: 60_000_000 });
  });

  it("나머지를 조용히 버리지 않는다 — 몇 건이 남았는지 말한다", () => {
    // 나머지가 말없이 사라지면 사용자는 둘 다 된 줄 안다.
    const result = extract(`${BUDGET_MARKER}\n${SCHEDULE_MARKER}`);
    expect(result.cleanText).toContain("6,000");
    expect(result.cleanText).toContain("나머지 1건은 이 확인이 끝나면 이어서 제안할게요.");
    // 두 번째 건은 카드가 아니다 — 확인 대상은 언제나 하나다.
    expect(result.cleanText).not.toContain("드레스 투어");
  });

  it("통과한 표식이 없을 때도 같은 요청을 다시 보내라고 하지 않는다 — 그건 무한 고리다", () => {
    const result = extract(`${BROKEN_MARKER}\n${BROKEN_SCHEDULE_MARKER}`);
    expect(result.pendingAction).toBeNull();
    expect(result.cleanText).not.toContain("같은 요청을 한 번만 다시");
    // 2026-09-03: 문구가 "하나씩" 에서 "먼저 … 한 가지만" 으로 바뀌었다.
    // 계약은 낱말이 아니라 **한 번에 한 건씩 말하라고 안내하는가** 이다.
    expect(result.cleanText).toContain("한 가지만");
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
    // 통과한 표식이 하나도 없는 턴만 이 안내가 된다(2026-09-04 이후).
    const result = extract(`${BROKEN_MARKER}
${BROKEN_SCHEDULE_MARKER}`);
    expect(isAmoraFailedProposalNotice(result.cleanText)).toBe(true);
  });

  it("첫 건 카드가 나간 턴은 걸러지지 않는다", () => {
    // 카드가 붙은 턴을 이력에서 빼면 모델은 자기가 성공한 모양을 못 배운다.
    const result = extract(`${BUDGET_MARKER}
${SCHEDULE_MARKER}`);
    expect(isAmoraFailedProposalNotice(result.cleanText)).toBe(false);
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

describe("남은 요청은 서버 검증을 통과해야 이어진다", () => {
  it("대화 기록을 다시 읽어도 동일한 요청 순서를 복원한다", () => {
    const result = extract(`${BUDGET_MARKER}\n${SCHEDULE_MARKER}`);
    const queue = createAmoraActionQueue(result.pendingAction!, result.remainingActions);
    expect(resolveAmoraActionQueue(JSON.parse(JSON.stringify(queue)), result.pendingAction!, TOOLS, NOW)).toEqual(queue);
  });

  it.each([
    { currentActionId: "22222222-2222-4222-8222-222222222222" },
    { totalCount: 11 },
    { completedCount: -1 },
    { remainingActions: [] },
    { remainingActions: [{ tool: "unsupported_write", input: {} }] },
    { remainingActions: [{ tool: "add_schedule_event", input: {} }] },
    { remainingActions: [{ tool: "update_budget", input: { total_budget: 60000000 } }] },
  ])("카드 바꿔치기·잘못된 개수·입력·중복을 거부한다: %j", (changes) => {
    const result = extract(`${BUDGET_MARKER}\n${SCHEDULE_MARKER}`);
    const queue = createAmoraActionQueue(result.pendingAction!, result.remainingActions);
    expect(resolveAmoraActionQueue({ ...queue, ...changes }, result.pendingAction!, TOOLS, NOW)).toBeNull();
  });

  it("열 건을 넘으면 일부만 저장할 수 있는 카드로 잘라내지 않는다", () => {
    const result = extract(Array.from({ length: 11 }, (_, index) => `[pending_action]${JSON.stringify({ tool: "add_schedule_event", input: { title: `예식장 ${index} 상담`, date: "2026-10-10" } })}[/pending_action]`).join("\n"));
    expect(result.pendingAction).toBeNull();
    expect(result.remainingActions).toBeUndefined();
    expect(result.cleanText).toContain("10건까지");
  });
});
