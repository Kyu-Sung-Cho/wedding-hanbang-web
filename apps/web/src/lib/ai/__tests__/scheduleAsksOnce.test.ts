/**
 * 일정을 넣을 때 날짜와 이름을 **한 번에** 묻는다.
 *
 * 팀 테스트에서 일정 세 개를 넣는 데 세 턴이 걸렸다 — 날짜를 묻고, 답을 받은 뒤
 * 유형을 또 묻고, 그러고도 반영에 실패했다. `add_schedule_event` 의 필수 필드는
 * `date` 와 `title` 뿐이고 `schedule_scope` 는 선택이다.
 *
 * ## 원본이 아니라 합성된 프롬프트에 묻는다
 *
 * `removeLegacyOperationalInstructions` 가 `prompts.ts` 의 일부 구간을 통째로
 * 지운다. 거기 쓴 규칙은 원본에는 있고 **모델이 받는 것에는 없다.**
 *
 * ## 운영이 실제로 넘기는 도구 집합을 쓴다
 *
 * 쓰기 도구는 `!isMutatingTool` 로 걸러져 `enabledToolNames` 에 오지 않는다.
 * 손으로 `add_schedule_event` 를 넣으면 운영에서 한 번도 안 나가는 규칙이
 * 초록불을 받는다.
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

const RULE = "모르는 것이 여러 개면 한 번에 모아서 물어보세요";

describe("일정은 한 번에 묻는다", () => {
  it("운영 도구 집합이면 규칙이 모델에게 간다", () => {
    expect(compose(PRODUCTION_ENABLED_TOOL_NAMES)).toContain(RULE);
  });

  it("날짜만 묻고 이름을 또 묻지 말라고 분명히 쓴다", () => {
    // 문구가 남아 있어도 뒷문장이 사라지면 규칙이 반쪽이 된다.
    expect(compose(PRODUCTION_ENABLED_TOOL_NAMES)).toContain("유형을 또 묻고, 다시 확인하는 식으로 나누지 마세요");
  });

  it("일정 도구가 없으면 싣지 않는다", () => {
    // 대조군. 이게 없으면 위 두 검사는 "문자열이 어딘가 있다"는 말밖에 안 된다.
    const withoutSchedule = PRODUCTION_ENABLED_TOOL_NAMES
      .filter((name) => name !== "get_schedule_events" && name !== "get_schedule_summary");
    expect(compose(withoutSchedule)).not.toContain(RULE);
  });

  it("도구가 하나도 없으면 싣지 않는다", () => {
    expect(compose([])).not.toContain(RULE);
  });
});
