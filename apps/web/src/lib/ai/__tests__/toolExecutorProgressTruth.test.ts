import { describe, expect, it, vi } from "vitest";
import { executeTool } from "../toolExecutor";
import type { ToolExecutionContext } from "../tools/toolTypes";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

describe("get_wedding_info progress truth", () => {
  it("counts only checklist categories the couple actually started", async () => {
    const progress = {
      venue: {
        status: "in_progress",
        checklist: [
          { id: "visit", label: "방문", done: true },
          { id: "contract", label: "계약", done: false },
        ],
      },
      pyebaek: {
        status: "not_started",
        checklist: [{ id: "decide", label: "진행 여부 결정", done: false }],
      },
    } as unknown as ToolExecutionContext["weddingContext"]["progress"];
    const context: ToolExecutionContext = {
      coupleId: "00000000-0000-0000-0000-000000000000",
      weddingContext: {
        weddingDate: "2027-01-15",
        budget: 50_000_000,
        venue: null,
        progress,
      },
    };

    const result = await executeTool("get_wedding_info", {}, context);

    expect(result.success).toBe(true);
    expect(result.toolOutput).toMatchObject({
      progress_percent: 50,
      completed_count: 1,
      total_categories: 1,
      total_checklist_items: 2,
    });
    expect(result.displayMessage).toContain("시작한 항목 완료율: 50%");
  });

  it.each([
    ["2026-07-15", "D-1"],
    ["2026-07-14", "D-Day"],
    ["2026-07-13", "D+1"],
    ["2026-02-30", "날짜 형식 확인 필요"],
  ])("renders a truthful wedding-date label for %s", async (weddingDate, label) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T00:00:00.000Z"));

    try {
      const result = await executeTool("get_wedding_info", {}, {
        coupleId: "00000000-0000-0000-0000-000000000000",
        weddingContext: {
          weddingDate,
          budget: 0,
          venue: null,
          progress: {},
        },
      });

      expect(result.displayMessage).toContain(`(${label})`);
    } finally {
      vi.useRealTimers();
    }
  });
});
