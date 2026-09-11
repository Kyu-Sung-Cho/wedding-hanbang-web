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

// 2026-09-04: "모르는 것이 여러 개면" 을 "빠진 값이 여러 개면" 으로 바꿨다.
// 모델이 앞 문구를 **건수가 여러 개면** 으로 읽어, 날짜·제목이 다 적힌 세 건
// 요청에 표식을 하나도 내지 않았다(스테이징 실측).
const RULE = "빠진 일정 값은 한 번에 묻고";

describe("일정은 한 번에 묻는다", () => {
  it("운영 도구 집합이면 규칙이 모델에게 간다", () => {
    expect(compose(PRODUCTION_ENABLED_TOOL_NAMES)).toContain(RULE);
  });

  it("날짜만 묻고 이름을 또 묻지 말라고 분명히 쓴다", () => {
    // 문구가 남아 있어도 뒷문장이 사라지면 규칙이 반쪽이 된다.
    expect(compose(PRODUCTION_ENABLED_TOOL_NAMES)).toContain("날짜→유형→재확인으로 나누지 마세요");
  });

  it("값이 다 있으면 되묻지 말고 첫 건 표식을 내라고 쓴다", () => {
    // 되묻기 규칙만 있으면 모델은 건수가 여러 개일 때도 되묻는다. 실제로 그랬다.
    expect(compose(PRODUCTION_ENABLED_TOOL_NAMES))
      .toContain("날짜·제목이 있으면 건수와 무관하게 첫 건 표식을 이번 답변에 내세요");
  });

  it("연도 없는 날짜를 다시 모호하다고 부르지 않는다", () => {
    // 앞 문장이 "연도가 없으면 가장 가까운 미래" 라고 정해 주는데, 뒤에 붙어 있던
    // "날짜가 모호하면 저장 전에 한 번 확인하세요" 가 그것을 되묻기로 되돌렸다.
    const prompt = compose(PRODUCTION_ENABLED_TOOL_NAMES);
    expect(prompt).toContain("연도 없는 일반 일정·예약만 가장 가까운 미래 날짜(오늘 이후)");
    expect(prompt).not.toContain("날짜가 모호하면 저장 전에 한 번 확인하세요");
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
