import { describe, expect, it, vi } from "vitest";
import { executeTool } from "../toolExecutor";
import { executeGetAmoraActions } from "../tools/amoraActionTools";
import { readAmoraActionSnapshot } from "@/lib/amora/actionRepository";
import { buildAmoraSystemPrompt } from "../amoraPromptComposer";
import { BETA_SAFE_TOOLS } from "../tools";
import { isMutatingTool } from "../mutationTools";
import type { ToolExecutionContext } from "../tools/toolTypes";
import type { WeddingPlannerPromptContext } from "../prompts";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("@/lib/amora/actionRepository", async (original) => ({
  ...await original<typeof import("@/lib/amora/actionRepository")>(),
  readAmoraActionSnapshot: vi.fn(),
}));

const context: ToolExecutionContext = {
  coupleId: "00000000-0000-4000-8000-000000000001",
  requestKey: "chat:00000000-0000-4000-8000-000000000002:00000000-0000-4000-8000-000000000003",
  requestAttemptCount: 1,
  currentUserText: "완료한 공유 할 일과 아직 할 일이 있는지도 확인해줘.",
  weddingContext: { weddingDate: null, budget: 0, venue: null, progress: {} },
};

describe("공유 할 일은 기본 준비 항목 개수로 대신 답하지 않는다", () => {
  it("새 커플의 기본 카테고리는 공유 할 일을 조회한 결과가 아니다", async () => {
    const result = await executeTool("get_wedding_info", {}, context);
    expect(result.toolOutput).toMatchObject({
      progress_basis: "planning_category_templates",
      shared_actions_queried: false,
    });
    expect(result.toolOutput.total_categories).toBeGreaterThan(0);
    const summary = await executeTool("get_schedule_summary", {}, context);
    expect(summary.toolOutput).toMatchObject({
      progress_basis: "planning_category_templates", shared_actions_queried: false,
      schedule_events_queried: false, total: result.toolOutput.total_categories,
    });
    expect(summary.displayMessage).toContain("기본 준비 카테고리");
  });

  it("기본 체크리스트가 있어도 실제 공유 할 일은 0개일 수 있다", async () => {
    vi.mocked(readAmoraActionSnapshot).mockResolvedValueOnce({
      actions: [], count: 0, openCount: 0, source: "table",
    });
    const result = await executeGetAmoraActions({ status: "all" }, context);
    expect(result.toolOutput).toMatchObject({
      list_kind: "shared_actions", requested_status: "all",
      count: 0, status_counts: { open: 0, done: 0, dismissed: 0 },
    });
    expect(result.displayMessage).toContain("공유 할 일");
    expect(result.displayMessage).not.toContain("기억");
  });

  it("일부 조회나 과거 보조 자료를 전체 완료 상태로 단정하지 않는다", async () => {
    for (const source of ["table", "legacy"] as const) {
      vi.mocked(readAmoraActionSnapshot).mockResolvedValueOnce({
        actions: [], count: source === "table" ? 2 : 0, openCount: 0, source,
      });
      const result = await executeGetAmoraActions({ status: "all" }, context);
      expect(result.toolOutput.status_counts).toBeNull();
    }
    vi.mocked(readAmoraActionSnapshot).mockResolvedValueOnce({
      actions: [], count: 0, openCount: 0, source: "table",
    });
    expect((await executeGetAmoraActions({ status: "open" }, context)).toolOutput.status_counts).toBeNull();
  });

  it("완료·미완료·제외 상태를 서로 섞지 않는다", async () => {
    const actions = (["open", "done", "dismissed"] as const).map((status, index) => ({
      id: `owned-${index}`, title: `확인할 일 ${index}`, status,
      priority: "medium" as const, source: "chat" as const,
      createdAt: "2026-09-11T08:00:00Z", updatedAt: "2026-09-11T08:00:00Z",
    }));
    vi.mocked(readAmoraActionSnapshot).mockResolvedValueOnce({
      actions, count: 3, openCount: 1, source: "table",
    });
    const result = await executeGetAmoraActions({ status: "all" }, context);
    expect(result.toolOutput.status_counts).toEqual({ open: 1, done: 1, dismissed: 1 });
    expect(readAmoraActionSnapshot).toHaveBeenLastCalledWith(expect.anything(), context.coupleId, [], "all");
  });

  it("조회 실패를 빈 목록 성공으로 바꾸지 않는다", async () => {
    vi.mocked(readAmoraActionSnapshot).mockRejectedValueOnce(new Error("unavailable"));
    const result = await executeGetAmoraActions({ status: "all" }, context);
    expect(result.success).toBe(false);
    expect(result.toolOutput).not.toHaveProperty("status_counts");
  });

  it("실제 운영 조회 도구 집합으로 합성한 프롬프트가 목록 종류와 현재 조회를 구분한다", () => {
    const promptContext: WeddingPlannerPromptContext = {
      weddingDate: null, budget: 0, venue: null, progress: {}, preparationStatus: null,
      brideName: null, groomName: null, senderName: "시험 사용자", bookings: [], scheduleEvents: [],
      chatSummaries: [], pastConflicts: [], pastDecisions: [],
    };
    const prompt = buildAmoraSystemPrompt(promptContext, {
      requestKind: "chat", persistenceMode: "durable",
      enabledToolNames: BETA_SAFE_TOOLS.filter(tool => !isMutatingTool(tool.name)).map(tool => tool.name),
    });
    expect(prompt).toContain('get_amora_actions의 status="all"');
    expect(prompt).toContain("카테고리·체크리스트 개수로 대신");
    expect(prompt).toContain("미설정·기본값을 사용자가 입력한 사실로");
  });
});
