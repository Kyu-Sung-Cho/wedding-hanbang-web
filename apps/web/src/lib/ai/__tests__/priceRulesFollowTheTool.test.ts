// @vitest-environment node

/**
 * 시세 조회 약속이 **그 도구를 가진 턴에만** 남는가.
 *
 * ## 무엇이 있었나
 *
 * 공시가 규칙에 이런 줄이 있었다.
 *
 *     - 가격이 필요하면 업체 공시가 검색·추천 도구를 사용하고, …
 *
 * 도구를 약속하는데 **도구 이름이 없다.** `applyEnabledToolContract` 는 줄 안에 도구
 * *이름*이 있을 때만 그 줄을 지우므로, 이 줄은 조회 도구가 없는 턴에도 그대로 남아
 * 모델에 들어갔다. 모델은 못 하는 조회를 약속한다.
 *
 * ## 왜 문장을 지우지 않고 이름을 넣었나
 *
 * PR #99 는 이 줄을 "아모라가 시세를 조회해 준다고 말하지 않습니다"로 바꾸려 했다.
 * 그때는 맞았을지 몰라도 지금은 **`get_market_price` 가 실제로 동작한다**
 * (`v_public_official_prices` 를 조회하고 `toolExecutor` 에 배선돼 있다). 있는 기능을
 * 부정하게 만드는 셈이라 그 처방은 쓰지 않았다.
 *
 * 대신 줄에 도구 이름을 넣어 **기존 장치가 알아서 걸러내게** 했고, 도구가 없는 턴을 위한
 * 안내를 한 줄 따로 뒀다.
 */

import { describe, expect, it } from "vitest";
import { getWeddingPlannerSystemPrompt } from "@/lib/ai/prompts";
import { buildAmoraSystemPrompt } from "@/lib/ai/amoraPromptComposer";

const baseContext = {
  weddingDate: null,
  budget: 0,
  venue: null,
  progress: {},
  bookings: [],
  brideName: null,
  groomName: null,
  senderName: "민이",
  scheduleEvents: [],
  chatSummaries: [],
};

const PRICE_PROMISE = "get_market_price 로 조회하고";
const FALLBACK_GUIDANCE = "공시가 페이지(/price)에서 직접 확인하도록";

function promptWithTools(enabledToolNames: string[]): string {
  return buildAmoraSystemPrompt(baseContext as never, {
    enabledToolNames,
    requestKind: "chat",
    persistenceMode: "durable",
  } as never);
}

describe("시세 조회 약속은 도구를 따라간다", () => {
  it("조회 도구가 있는 턴에는 남는다", () => {
    const prompt = promptWithTools(["get_market_price"]);
    expect(prompt).toContain(PRICE_PROMISE);
  });

  it("조회 도구가 없는 턴에는 사라진다", () => {
    // 이 검사가 없으면 모델이 못 하는 조회를 약속한다.
    const prompt = promptWithTools(["get_budget_summary"]);
    expect(prompt).not.toContain(PRICE_PROMISE);
  });

  it("도구가 사라져도 안내는 남는다", () => {
    // 약속만 지우고 끝내면 사용자는 어디서 확인할지 모른 채 남는다.
    const prompt = promptWithTools(["get_budget_summary"]);
    expect(prompt).toContain(FALLBACK_GUIDANCE);
  });

  it("도구가 있을 때도 안내는 함께 있다", () => {
    const prompt = promptWithTools(["get_market_price"]);
    expect(prompt).toContain(FALLBACK_GUIDANCE);
  });
});

describe("있는 기능을 부정하지 않는다", () => {
  it("시세를 조회해 주지 않는다고 말하지 않는다", () => {
    // get_market_price 는 실제로 동작한다. 못 한다고 적으면 제품이 자기 기능을 숨긴다.
    const prompt = getWeddingPlannerSystemPrompt(baseContext);
    expect(prompt).not.toContain("시세를 조회해 준다고 말하지 않습니다");
  });
});
