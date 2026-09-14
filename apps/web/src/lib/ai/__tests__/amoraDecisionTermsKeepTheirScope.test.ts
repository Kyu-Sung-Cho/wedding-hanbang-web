import { describe, expect, it, vi } from "vitest";

import { buildAmoraSystemPrompt } from "@/lib/ai/amoraPromptComposer";
import { isMutatingTool } from "@/lib/ai/mutationTools";
import { getWeddingPlannerSystemPrompt } from "@/lib/ai/prompts";
import { executeTool } from "@/lib/ai/toolExecutor";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";

const database = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => database),
}));

const PROGRESS = {
  yedan: { category: "yedan", status: "not_started", budget: 700_000 },
  pyebaek: { category: "pyebaek", status: "not_started", budget: 200_000 },
  custom_1773727842937: {
    category: "custom_1773727842937",
    label: "부모님 생신 선물",
    status: "not_started",
    budget: 300_000,
  },
  custom_1773727842938: {
    category: "custom_1773727842938",
    label: "식후 감사 인사",
    status: "not_started",
    budget: 50_000,
  },
};

const BASE: Parameters<typeof getWeddingPlannerSystemPrompt>[0] = {
  weddingDate: null,
  budget: 2_000_000,
  venue: null,
  progress: PROGRESS,
  brideName: null,
  groomName: null,
  senderName: "합성 QA",
  bookings: [],
  scheduleEvents: [],
  chatSummaries: [],
};

const READ_TOOLS = BETA_SAFE_TOOLS
  .filter((tool) => !isMutatingTool(tool.name))
  .map((tool) => tool.name);

const variants = [
  { name: "기본 문맥", prompt: getWeddingPlannerSystemPrompt(BASE) },
  {
    name: "운영 조회 도구",
    prompt: buildAmoraSystemPrompt(BASE, {
      requestKind: "chat", persistenceMode: "durable", enabledToolNames: READ_TOOLS,
    }),
  },
  {
    name: "도구 없는 대화",
    prompt: buildAmoraSystemPrompt(BASE, {
      requestKind: "chat", persistenceMode: "durable", enabledToolNames: [],
    }),
  },
  {
    name: "체험 대화",
    prompt: buildAmoraSystemPrompt(BASE, {
      requestKind: "chat", persistenceMode: "demo", enabledToolNames: READ_TOOLS,
    }),
  },
  {
    name: "무거운 대화 문맥",
    prompt: buildAmoraSystemPrompt({
      ...BASE,
      chatSummaries: Array.from({ length: 30 }, (_, index) =>
        ("합성 요약 " + index + ". 예단·폐백과 생신 선물·감사 인사는 별도로 이야기했다. ").repeat(30)),
    }, {
      requestKind: "chat", persistenceMode: "durable", enabledToolNames: READ_TOOLS,
      maxChars: 48_000,
    }),
  },
];

// 실제 후보 응답은 예단·폐백 생략을 모든 가족 선물·전통 인사의 생략으로 바꿨다.
// 금지 문구의 존재만 보지 않고 모델에 전달되는 현황과 매핑 이름을 함께 검사한다.
describe("예단·폐백 결정의 원명칭과 범위를 보존한다", () => {
  it.each(variants)("$name의 현황과 출력 이름이 더 넓은 항목을 뜻하지 않는다", ({ prompt }) => {
    const lines = prompt.split("\n");
    expect(lines.find((line) => line.includes("(yedan):"))).toContain("예단(yedan):");
    expect(lines.find((line) => line.includes("(pyebaek):"))).toContain("폐백(pyebaek):");
    expect(prompt).not.toContain("| yedan | 두 가족에게 드릴 선물 |");
    expect(prompt).not.toContain("| pyebaek | 결혼식 뒤 전통 인사 |");
    expect(prompt).toContain("생략·확정한 항목은 원명칭과 범위를 유지하세요");
  });

  // 긴 문맥에서는 선택 참조표가 잘려도 필수 현황과 범위 보존 원칙은 남아야 한다.
  // 참조표 자체의 이름은 실제로 표가 실리는 네 가지 문맥에서 따로 확인한다.
  it.each(variants.slice(0, 4))("$name의 내부 키 참조표가 정본명을 쓴다", ({ prompt }) => {
    expect(prompt).toContain("| yedan | 예단 |");
    expect(prompt).toContain("| pyebaek | 폐백 |");
  });

  it("내부 키 표시는 한글로 바꾸되 사용자가 정한 범위는 다시 이름 붙이지 않는다", () => {
    for (const { name, prompt } of variants.slice(0, 4)) {
      const rule = prompt.split("\n").find((line) => line.includes("내부 영어 키를 표시할 때만")) ?? "";
      expect(rule, name).toContain("사용자가 말한 항목명과 결정 범위는 이 표로 바꾸지 마세요");
      expect(prompt, name).not.toContain("**사용자에게 보이는 모든 텍스트**");
    }
    // 실행 안내 줄은 도구 이름 없이 적혀 있어 조회 도구만 켠 운영 합성에도 실린다(2026-09-14).
    // 도구가 하나도 없는 대화에서는 '도구'가 든 줄을 걷어내므로 그 변형에는 묻지 않는다.
    for (const { name, prompt } of [variants[1], variants[3]]) {
      expect(prompt, name).toContain("도구 호출 파라미터는 영어 키 유지");
      expect(prompt, name).toContain("표식의 'category' 파라미터는 반드시 영어 키");
    }
  });

  it("직접 추가한 선물·감사 인사의 이름과 별도 금액 및 체크리스트 ID를 그대로 전달한다", () => {
    const before = structuredClone(PROGRESS);
    const prompt = getWeddingPlannerSystemPrompt(BASE);
    expect(prompt).toContain("예단(yedan): ⬜예정, 예산: 70만원");
    expect(prompt).toContain("폐백(pyebaek): ⬜예정, 예산: 20만원");
    expect(prompt).toContain('"부모님 생신 선물"(custom_1773727842937): ⬜예정, 예산: 30만원');
    expect(prompt).toContain('"식후 감사 인사"(custom_1773727842938): ⬜예정, 예산: 5만원');
    expect(prompt).toContain("yedan_01=");
    expect(prompt).toContain("pyebaek_01=");
    expect(PROGRESS).toEqual(before);
  });

  it("예산 조회도 정확한 항목명으로 답하며 키·금액·사용자 항목을 합치지 않는다", async () => {
    const context: ToolExecutionContext = {
      coupleId: "00000000-0000-4000-8000-000000000001",
      requestKey: "chat:00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000002",
      requestAttemptCount: 1,
      currentUserText: "예단과 폐백, 생신 선물, 감사 인사 예산을 각각 알려줘",
      weddingContext: { weddingDate: null, budget: 2_000_000, venue: null, progress: PROGRESS },
    };
    const before = structuredClone(PROGRESS);
    const result = await executeTool("get_budget_summary", {}, context);
    expect(result.success).toBe(true);
    expect(result.toolOutput).toMatchObject({
      total_allocated: 1_250_000,
      unallocated: 750_000,
      categories: expect.arrayContaining([
        expect.objectContaining({ key: "yedan", label: "예단", allocated: 700_000 }),
        expect.objectContaining({ key: "pyebaek", label: "폐백", allocated: 200_000 }),
        expect.objectContaining({ key: "custom_1773727842937", label: "부모님 생신 선물", allocated: 300_000 }),
        expect.objectContaining({ key: "custom_1773727842938", label: "식후 감사 인사", allocated: 50_000 }),
      ]),
    });
    expect(PROGRESS).toEqual(before);
    expect(database.from).not.toHaveBeenCalled();
    expect(database.rpc).not.toHaveBeenCalled();
  });
});
