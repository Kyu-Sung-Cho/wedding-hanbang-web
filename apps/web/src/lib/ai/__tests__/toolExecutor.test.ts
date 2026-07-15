import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { executeTool } from "../toolExecutor";
import {
  RETIRED_VENDOR_BOOKING_TOOL_NAMES,
  WEDDING_TOOLS,
} from "../tools";
import type { ToolExecutionContext } from "../tools/toolTypes";

function makeCtx(progress: Record<string, unknown> = {}): ToolExecutionContext {
  return {
    coupleId: "00000000-0000-0000-0000-000000000000",
    weddingContext: {
      weddingDate: null,
      budget: 50_000_000,
      venue: null,
      progress:
        progress as ToolExecutionContext["weddingContext"]["progress"],
    },
  };
}

describe("read-only Amora tool execution", () => {
  it("separates user-recorded budget facts without inventing legacy spending", async () => {
    const result = await executeTool(
      "get_budget_summary",
      {},
      makeCtx({
        venue: {
          category: "venue",
          status: "in_progress",
          budget: 20_000_000,
          contractedTotal: 15_000_000,
          paidToDate: 5_000_000,
        },
        studio: { category: "studio", status: "completed", spent: 4_000_000 },
      }),
    );

    expect(result.success).toBe(true);
    expect(result.toolOutput).toMatchObject({
      total_planned_by_category: 20_000_000,
      total_contracted: 15_000_000,
      total_paid_to_date: 5_000_000,
      legacy_unclassified_count: 1,
    });
  });

  it("does not invent category estimates when no financial facts exist", async () => {
    const result = await executeTool("get_budget_summary", {}, makeCtx());

    expect(result.success).toBe(true);
    expect(result.toolOutput).toMatchObject({ categories: [] });
    expect(result.displayMessage).toContain("임의 추정 없음");
  });

  it("rejects unknown fields for an active read schema", async () => {
    const result = await executeTool(
      "get_wedding_info",
      { injected: true },
      makeCtx(),
    );

    expect(result).toMatchObject({
      success: false,
      toolOutput: {
        error: "invalid_tool_input",
        reason: "unexpected_field",
        path: "$.injected",
      },
    });
  });

  it("propagates cancellation before running an active read tool", async () => {
    const controller = new AbortController();
    controller.abort();
    const context = makeCtx();
    context.signal = controller.signal;

    await expect(
      executeTool("get_budget_summary", {}, context),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("contains no model-visible mutation or external-place schema", () => {
    const names = new Set(WEDDING_TOOLS.map((tool) => tool.name));
    for (const retiredName of [
      "update_wedding_date",
      "update_task_status",
      "update_venue",
      "add_schedule_event",
      "update_schedule_event",
      "delete_schedule_event",
      "toggle_checklist_item",
      "log_wedding_event",
      "search_nearby_places",
    ]) {
      expect(names.has(retiredName), retiredName).toBe(false);
    }
  });
});

describe("other retired Amora tools", () => {
  it("keeps retired quote analysis fail-closed", async () => {
    const result = await executeTool("analyze_quote", {}, makeCtx());
    expect(result).toMatchObject({
      toolInput: {},
      toolOutput: { error: "retired_product_tool" },
      success: false,
    });
  });

  it("keeps vendor and booking schemas and implementation modules removed", () => {
    const names = new Set(WEDDING_TOOLS.map((tool) => tool.name));
    for (const toolName of RETIRED_VENDOR_BOOKING_TOOL_NAMES) {
      expect(names.has(toolName), toolName).toBe(false);
    }
    for (const relativePath of [
      "src/lib/ai/tools/vendorTools.ts",
      "src/lib/ai/tools/bookingTools.ts",
      "src/lib/ai/tools/bookingTime.ts",
    ]) {
      expect(existsSync(resolve(process.cwd(), relativePath)), relativePath).toBe(
        false,
      );
    }
  });

  it.each([...RETIRED_VENDOR_BOOKING_TOOL_NAMES])(
    "rejects stale %s without exposing the stored input",
    async (toolName) => {
      const result = await executeTool(toolName, { stale: "payload" }, makeCtx());
      expect(result).toMatchObject({
        toolName,
        toolInput: {},
        toolOutput: { error: "retired_vendor_booking_tool" },
        success: false,
      });
    },
  );
});
