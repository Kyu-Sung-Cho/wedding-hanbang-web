/**
 * 팀 아모라 테스트 리포트(2026-08-29)에서 나온 규칙들이 **모델이 받는 프롬프트에**
 * 실린다.
 *
 * 원본(`prompts.ts`)을 보면 안 된다 — `removeLegacyOperationalInstructions` 가
 * 일부 구간을 통째로 지우므로 원본에는 있고 모델이 받는 것에는 없을 수 있다.
 * 운영이 실제로 넘기는 도구 집합을 쓴다 — 쓰기 도구는 `!isMutatingTool` 로
 * 걸러져 `enabledToolNames` 에 오지 않으므로, 손으로 넣으면 운영에서 한 번도
 * 안 나가는 규칙이 초록불을 받는다.
 */
import { describe, expect, it } from "vitest";

import { buildAmoraSystemPrompt } from "@/lib/ai/amoraPromptComposer";
import { isMutatingTool } from "@/lib/ai/mutationTools";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";

const PRODUCTION_ENABLED_TOOL_NAMES = BETA_SAFE_TOOLS
  .filter((tool) => !isMutatingTool(tool.name))
  .map((tool) => tool.name);

function promptContext() {
  return {
    weddingDate: "2027-05-15",
    budget: 50_000_000,
    venue: null,
    progress: {},
    preparationStatus: null,
    brideName: "신부",
    groomName: "신랑",
    bookings: [],
    scheduleEvents: [],
    chatSummaries: [],
    pastConflicts: [],
    pastDecisions: [],
  } as never;
}

const compose = (enabledToolNames: string[]) =>
  buildAmoraSystemPrompt(promptContext(), {
    enabledToolNames,
    requestKind: "chat",
    persistenceMode: "durable",
  });

const delivered = compose(PRODUCTION_ENABLED_TOOL_NAMES);
const without = (...drop: string[]) =>
  compose(PRODUCTION_ENABLED_TOOL_NAMES.filter((name) => !drop.includes(name)));

describe("큰 방향전환은 이유를 한 번 확인한다", () => {
  // Turn 17: 180명 일반예식 -> 40명 가족식을 이유 확인 없이 즉시 수용했다.
  it("크기 조건과 함께 실린다", () => {
    expect(delivered).toContain("절반 이하로 바뀌면");
    expect(delivered).toContain("이유를 한 번만 확인하고");
  });

  it("작은 변경까지 되묻게 하지는 않는다", () => {
    // 이 단서가 빠지면 날짜 한 달 옮기는 것도 되묻는다.
    expect(delivered).toContain("날짜 한 달 이동 정도는 그냥 반영");
  });

  it("결혼 조회 도구가 없으면 싣지 않는다", () => {
    expect(without("get_wedding_info", "get_budget_summary")).not.toContain("절반 이하로 바뀌면");
  });
});

describe("방향이 바뀌면 기존 계획 상태를 알려준다", () => {
  it("무엇이 그대로이고 무엇을 다시 정할지 말하게 한다", () => {
    expect(delivered).toContain("무엇이 남고 무엇을 다시 정할지");
  });

  it("결혼 조회 도구가 없으면 싣지 않는다", () => {
    expect(without("get_wedding_info", "get_budget_summary"))
      .not.toContain("무엇이 남고 무엇을 다시 정할지");
  });
});

describe("무엇부터 할지 모른다고 하면 되묻기로 끝내지 않는다", () => {
  it("판단·이유·다음 한 가지를 함께 주게 한다", () => {
    expect(delivered).toContain("되묻기로 끝내지 말고");
    expect(delivered).toContain("판단·이유·다음 한 가지를 함께");
  });

  it("결혼 조회 도구가 없으면 싣지 않는다", () => {
    expect(without("get_wedding_info", "get_budget_summary"))
      .not.toContain("되묻기로 끝내지 말고");
  });
});

describe("금액 감이 없다고 하면 시세 도구를 쓴다", () => {
  // 이 도구는 켜져 있는데 프롬프트 어디에도 쓸 이유가 적혀 있지 않았다.
  it("도구 이름과 출처 요구가 함께 실린다", () => {
    expect(delivered).toContain("`get_market_price`");
    expect(delivered).toContain("기준 시점·출처와 함께 말하고");
  });

  it("지어내지 말라는 단서가 붙어 있다", () => {
    expect(delivered).toContain("도구 없이 평균가를 지어내지 마세요");
  });

  it("그 도구가 없으면 싣지 않는다", () => {
    expect(without("get_market_price")).not.toContain("도구 없이 평균가를 지어내지 마세요");
  });
});
