import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { buildAmoraSystemPrompt } from "@/lib/ai/amoraPromptComposer";
import { isMutatingTool } from "@/lib/ai/mutationTools";
import { BETA_DISABLED_TOOL_NAMES, BETA_SAFE_TOOLS } from "@/lib/ai/tools";

/**
 * 일정·예산 운용 규칙이 모델에게 **한 줄도 가지 않았다.**
 *
 * 조건을 쓰기 도구 이름으로 걸었는데, 쓰기 도구는 route.ts 에서
 * `availableTools = runnableTools.filter((t) => !isMutatingTool(t.name))` 로
 * 걸러져 `enabledToolNames` 에 들어오지 않는다. 모델은 그 도구를 별도
 * 계약(buildAmoraPendingActionPrompt)으로 안다.
 *
 * 2026-08-25 운영 실측 — 그래서 실제로 기능이 깨져 있었다:
 *
 *   "결혼 총예산 6200만원을 …로 한번에 배분 적용해줘"
 *     → 아모라가 배분안을 **말로만** 하고 확인 카드를 내지 않음
 *   "11월 15일에 본식 리허설 잡아줘"
 *     → 카드 없음, "11월 15일은 연도에 따라 달라…"
 *
 * 같은 함정을 이 세션에서 두 번 밟았다(커스텀 예산 안내가 먼저였다). 그래서
 * 테스트는 **운영이 실제로 넘기는 집합**을 쓴다 — 손으로 도구 이름을 나열하면
 * 죽은 조건도 초록으로 보인다.
 */

const PRODUCTION_ENABLED_TOOL_NAMES = BETA_SAFE_TOOLS
  .filter((tool) => !isMutatingTool(tool.name))
  .map((tool) => tool.name);

const CONTEXT = {
  weddingDate: "2027-05-15",
  budget: 62_000_000,
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

const delivered = buildAmoraSystemPrompt(CONTEXT, {
  enabledToolNames: PRODUCTION_ENABLED_TOOL_NAMES,
  requestKind: "chat",
  persistenceMode: "durable",
});

describe("일정 규칙이 모델에게 닿는다", () => {
  it("연도가 없으면 가장 가까운 미래로 해석하라고 알려준다", () => {
    expect(delivered).toContain("가장 가까운 미래 날짜");
  });

  it("취소를 삭제로 바꾸지 말라고 알려준다", () => {
    expect(delivered).toContain("일정 취소 요청은 삭제로 바꾸지 마세요");
  });

  it("취소 기록 복원 절차를 알려준다", () => {
    expect(delivered).toContain("restore_schedule_event");
  });
});

describe("예산 규칙이 모델에게 닿는다", () => {
  it("일괄 배분은 한 번으로 적용하라고 알려준다", () => {
    expect(delivered).toContain("apply_budget_plan");
    expect(delivered).toContain("합계는 총예산과 정확히 일치");
  });
});

describe("조회 도구가 없으면 그 규칙도 빠진다", () => {
  it("일정 조회가 없으면 일정 규칙이 없다", () => {
    const withoutSchedule = buildAmoraSystemPrompt(CONTEXT, {
      enabledToolNames: ["get_budget_summary"],
      requestKind: "chat",
      persistenceMode: "durable",
    });
    expect(withoutSchedule).not.toContain("일정 취소 요청은 삭제로 바꾸지 마세요");
  });

  it("예산 조회가 없으면 배분 규칙이 없다", () => {
    const withoutBudget = buildAmoraSystemPrompt(CONTEXT, {
      enabledToolNames: ["get_schedule_events"],
      requestKind: "chat",
      persistenceMode: "durable",
    });
    expect(withoutBudget).not.toContain("합계는 총예산과 정확히 일치");
  });
});

describe("쓰기 도구 이름으로 지시문을 걸지 않는다", () => {
  // 이 부류를 통째로 막는다.
  //
  // 조건을 쓰기 도구 이름으로만 걸면 **절대 참이 되지 않는다** — 운영은
  // `availableTools = runnableTools.filter((t) => !isMutatingTool(t.name))` 로
  // 걸러 넘기기 때문이다. 그런데 테스트가 손으로 쓰기 도구 이름을 넘기면
  // 그 죽은 조건도 초록으로 보인다. 2026-08-25 하루에 이 함정을 세 번 밟았다:
  // 커스텀 예산 안내, 일정 규칙 3블록, 예산 배분 규칙.
  //
  // 그래서 소스에서 조건을 뽑아, **읽기 도구가 최소 하나는 들어 있는지** 본다.
  const source = readFileSync(
    join(process.cwd(), "src", "lib", "ai", "amoraPromptComposer.ts"),
    "utf8",
  );
  const READ_TOOL_NAMES = new Set(
    BETA_SAFE_TOOLS.filter((tool) => !isMutatingTool(tool.name)).map((t) => t.name),
  );

  // buildEnabledToolInstructions 안의 조건만 본다.
  const fnStart = source.indexOf("function buildEnabledToolInstructions");
  const fnEnd = source.indexOf("\nfunction ", fnStart + 1);
  const body = source.slice(fnStart, fnEnd > 0 ? fnEnd : undefined);
  const conditions = [
    ...body.matchAll(new RegExp('(?:enabled\\.has|has)\\(([^)]*)\\)', 'g')),
  ]
    .map((m) => [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]))
    .filter((names) => names.length > 0);

  it("조건을 실제로 찾아낸다", () => {
    expect(conditions.length).toBeGreaterThan(8);
  });

  it("모든 조건에 읽기 도구가 최소 하나 들어 있다", () => {
    // 베타에서 꺼진 도구만 가리키는 조건은 제외한다 — 그 지시문은 어차피
    // 쓰이지 않고, 도구가 켜지면 함께 살아난다.
    const dead = conditions.filter((names) => {
      if (names.some((name) => READ_TOOL_NAMES.has(name))) return false;
      return names.some((name) => !BETA_DISABLED_TOOL_NAMES.has(name));
    });
    expect(dead).toEqual([]);
  });

  it("핵심 변경 규칙은 도구 구성과 무관하게 늘 실린다", () => {
    // 이 줄이 제품 계약 자체다. 예전에는 쓰기 도구 20개로 걸어 놔서 한 번도
    // 가지 않았다.
    for (const names of [PRODUCTION_ENABLED_TOOL_NAMES, ["get_wedding_info"]]) {
      const prompt = buildAmoraSystemPrompt(CONTEXT, {
        enabledToolNames: names,
        requestKind: "chat",
        persistenceMode: "durable",
      });
      expect(prompt).toContain("명시적으로 적용을 확인한 뒤");
      expect(prompt).toContain("무엇이 실제로 반영됐는지");
    }
  });
});
