import { describe, expect, it } from "vitest";

import { buildAmoraSystemPrompt } from "@/lib/ai/amoraPromptComposer";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";
import { isMutatingTool } from "@/lib/ai/mutationTools";

/**
 * 사용자가 방금 말한 업체 이름을 아모라가 못 쓰고 있었다.
 *
 * 업체 도구는 베타에서 전부 꺼져 있다(`BETA_DISABLED_TOOL_NAMES`). 그런데
 * 규칙은 "업체 이름을 적을 수 있는 **유일한** 근거는 이번 대화의 도구 결과"
 * 라고 적혀 있었다. 도구가 없으니 문자 그대로 읽으면 **어떤 업체 이름도 못
 * 쓴다** — 사용자가 방금 타이핑한 이름까지.
 *
 * 2026-08-25 운영 실측. 스튜디오 세 곳(라비드퀸·세컨플로우·모먼트온) 견적을
 * 말한 다음 턴에서 "셋 중에 어디를 더 알아봐야 할까"라고 묻자:
 *
 *   "지금 대화에 세 후보 정보가 보이지 않아 특정 곳을 고르지는 않을게요."
 *
 * 바로 앞 턴에서 세 곳을 금액과 함께 표로 보여주고서 한 말이다. 이름을
 * 되물으면 셋 다 정확히 답한다 — 갖고 있으면서 없다고 한 것이다.
 *
 * 커플이 업체를 나란히 놓고 비교하는 순간은 결혼 준비의 한가운데다. 거기서
 * "당신이 준 정보가 없다"고 말하면, 사용자는 자기 입력이 사라졌다고 읽는다.
 *
 * 고르지 않는 것 자체는 제품 확정 규칙이라 그대로 둔다. 고치는 것은 **고르지
 * 않는 이유를 사실과 다르게 대는 것**이다.
 */

const READ_ONLY_BETA_TOOLS = BETA_SAFE_TOOLS
  .map((t) => t.name)
  .filter((name) => !isMutatingTool(name));

const baseContext = {
  weddingDate: "2027-05-15", budget: 62_000_000, venue: null, progress: {},
  preparationStatus: null, brideName: "신부", groomName: "신랑",
  bookings: [], scheduleEvents: [], chatSummaries: [],
  pastConflicts: [], pastDecisions: [],
} as never;

function prompt(): string {
  return buildAmoraSystemPrompt(baseContext, {
    requestKind: "chat",
    persistenceMode: "durable",
    // 운영이 실제로 주는 목록이다. 쓰기 도구는 `availableTools` 에서 걸러지므로
    // 여기 이름을 넣으면 운영에 없는 입력으로 재는 셈이 된다.
    enabledToolNames: READ_ONLY_BETA_TOOLS,
  });
}

describe("사용자가 말한 업체 이름", () => {
  it("업체 도구는 베타에서 전부 꺼져 있다", () => {
    // 이 전제가 무너지면(도구를 다시 열면) 아래 규칙의 의미가 달라진다.
    const vendorTools = BETA_SAFE_TOOLS
      .map((t) => t.name)
      .filter((n) => /vendor|booking|available_slots/.test(n));
    expect(vendorTools).toEqual([]);
  });

  it("사용자가 알려준 이름도 근거로 인정한다", () => {
    const p = prompt();
    expect(p).toContain("업체 이름의 근거는 둘뿐입니다");
    expect(p).toContain("사용자가 직접 알려준 이름");
    expect(p).toContain("그 이름 그대로 부르세요");
  });

  it("고르지 않는 이유를 '정보가 없어서'로 대지 못하게 한다", () => {
    expect(prompt()).toContain('"정보가 없어서"');
  });

  it("지어낸 업체 금지는 그대로다", () => {
    const p = prompt();
    expect(p).toContain("추측·placeholder·지어낸 id도 금지");
    expect(p).toContain("일반 지식으로 아는 이름");
  });

  it("판정 금지도 그대로다", () => {
    const p = prompt();
    expect(p).toContain("어느 곳이 더 나은지는 고르지 않습니다");
    expect(p).toContain("견적·가격의 좋고 나쁨을 판정하지 마세요");
  });

  it("나중에 알아봐 주겠다는 약속을 예시로 쥐여주지 않는다", () => {
    const p = prompt();
    expect(p).not.toContain("확인 후 안내드릴게요");
    expect(p).toContain("나중에 알아봐서 알려주겠다고 하지 마세요");
  });
});
