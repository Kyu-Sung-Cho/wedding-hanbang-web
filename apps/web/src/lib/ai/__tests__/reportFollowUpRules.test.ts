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

import {
  AMORA_SYSTEM_PROMPT_MAX_CHARS,
  buildAmoraSystemPrompt,
} from "@/lib/ai/amoraPromptComposer";
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

/**
 * 방향전환 규칙 **한 줄**을 꺼낸다.
 *
 * 프롬프트 전체에 `toContain` 을 걸면 **다른 자리에 남은 같은 낱말이 대신 대답한다** —
 * "둘 다", "이미 말했으면" 같은 조각은 이 파일 밖에도 있다. 이 규칙이 지켜야 할 것은
 * "한 줄 안에서 두 갈래를 모두 시키는가" 이므로 그 줄만 놓고 묻는다.
 */
function pivotRuleLine(prompt: string): string {
  const line = prompt
    .split("\n")
    .find((candidate) => candidate.includes("절반 이하로 바뀌면"));
  return line ?? "";
}

describe("큰 방향전환은 이유를 한 번 확인한다", () => {
  // Turn 17: 180명 일반예식 -> 40명 가족식을 이유 확인 없이 즉시 수용했다.
  it("크기 조건과 함께 실린다", () => {
    expect(delivered).toContain("절반 이하로 바뀌면");
    expect(pivotRuleLine(delivered)).toContain("이유는 한 번만");
  });

  it("작은 변경까지 되묻게 하지는 않는다", () => {
    // 이 단서가 빠지면 날짜 한 달 옮기는 것도 되묻는다.
    expect(pivotRuleLine(delivered)).toContain("날짜 한 달 이동쯤은 그냥 반영");
  });

  it("결혼 조회 도구가 없으면 싣지 않는다", () => {
    expect(without("get_wedding_info", "get_budget_summary")).not.toContain("절반 이하로 바뀌면");
  });

  /**
   * 2026-08-31 운영 실측: 사용자가 "부모님이 비용을 부담스러워하셔서"라고 **먼저
   * 말했는데도** 아모라가 이유를 또 물었다. 같은 프롬프트의 탐색 역할은 "이미 답한
   * 것을 되묻지 말고"라고 하는데, 이 줄이 조건 없이 확인을 시켜 서로 부딪혔다.
   */
  it("이유를 이미 들었으면 다시 묻지 말라는 예외가 같은 줄에 있다", () => {
    const line = pivotRuleLine(delivered);
    expect(line, "이유 확인이 조건 없이 걸려 있다 — 이미 답한 사용자에게 또 묻는다")
      .toContain("이미 말했으면");
    expect(line, "되묻지 말라고만 하고 그때 무엇을 하라는지 없다")
      .toContain("건너뛰고");
  });
});

describe("방향이 바뀌면 기존 계획 상태를 알려준다", () => {
  /**
   * 2026-08-31 운영 실측: **한 답변에 절반씩만 나왔다.** 1회차는 "예산·장소·초대
   * 범위까지 다시 정할지"만, 2회차는 "사진·드레스·반지·여행 등이 그대로면"만 말했다.
   *
   * 옛 문장(`무엇이 남고 무엇을 다시 정할지`)은 **간접 의문문**이라 모델이 그중 한쪽만
   * 골라 사용자에게 되물어도 지킨 셈이 됐다. 그래서 서술형 목적어로 바꾸고 한 답변에
   * 둘 다 나오라고 못 박았다. `toContain("다시 정할")` 만으로는 그 회귀를 못 잡는다 —
   * 옛 문장에도 그 조각이 그대로 있다.
   */
  it("남는 쪽과 다시 정할 쪽을 한 답변에 둘 다 말하게 한다", () => {
    const line = pivotRuleLine(delivered);
    expect(line, "그대로 가는 쪽을 말하라는 지시가 없다 — 사용자는 계획 상태를 잃는다")
      .toContain("그대로 갈 것과 다시 정할 것을");
    expect(line, "한쪽만 말해도 지킨 것이 된다 — 실제로 두 번 다 절반만 나왔다")
      .toContain("한 답변에 둘 다");
  });

  it("한쪽을 고를 수 있는 간접 의문문으로 돌아가지 않는다", () => {
    expect(pivotRuleLine(delivered)).not.toContain("무엇이 남고 무엇을 다시 정할지");
  });

  it("결혼 조회 도구가 없으면 싣지 않는다", () => {
    expect(without("get_wedding_info", "get_budget_summary"))
      .not.toContain("그대로 갈 것과 다시 정할 것을");
  });
});

describe("이 규칙에는 늘릴 자리가 없다", () => {
  /**
   * 프롬프트 상한은 48,000자이고 이 턴의 여유는 1,400자대다(2026-08-31 실측
   * 46,583자 / 여유 1,417자). 이 줄을 고칠 때 길어지면 문맥이 많은 커플에서
   * 저장 문맥 꼬리가 그만큼 잘린다 — 그래서 길이를 함께 못 박는다.
   * 이번 수정은 108자 -> 107자였다.
   */
  it("규칙 한 줄이 110자를 넘지 않는다", () => {
    expect(pivotRuleLine(delivered).length).toBeLessThanOrEqual(110);
  });

  it("운영과 같은 도구 집합에서 프롬프트가 상한 안에 있다", () => {
    expect(delivered.length).toBeLessThanOrEqual(AMORA_SYSTEM_PROMPT_MAX_CHARS);
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
