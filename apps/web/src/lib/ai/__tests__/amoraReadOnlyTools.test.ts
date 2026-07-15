import { afterEach, describe, expect, it, vi } from "vitest";
import { executeTool } from "../toolExecutor";
import { WEDDING_TOOLS } from "../tools";
import type { ToolExecutionContext } from "../tools/toolTypes";

describe("Amora read-only tool surface", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exposes only the five trusted read tools to the model", () => {
    expect(WEDDING_TOOLS.map((tool) => tool.name)).toEqual([
      "get_budget_summary",
      "get_schedule_summary",
      "get_wedding_info",
      "get_schedule_events",
      "get_market_price",
    ]);
  });

  it.each([
    "update_wedding_date",
    "update_task_status",
    "update_venue",
    "add_schedule_event",
    "update_schedule_event",
    "delete_schedule_event",
    "toggle_checklist_item",
    "log_wedding_event",
  ])("rejects stale %s before reading wedding state", async (toolName) => {
    let weddingContextReads = 0;
    const context = {
      coupleId: "couple-1",
      get weddingContext() {
        weddingContextReads += 1;
        throw new Error("wedding context must not be read");
      },
    } as unknown as ToolExecutionContext;

    const result = await executeTool(
      toolName,
      { stale: "payload" },
      context,
    );

    expect(result).toMatchObject({
      toolName,
      toolInput: {},
      toolOutput: { error: "retired_amora_mutation_tool" },
      success: false,
    });
    expect(weddingContextReads).toBe(0);
  });

  it("rejects stale place search before reading context or using the network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    let weddingContextReads = 0;
    const context = {
      coupleId: "couple-1",
      get weddingContext() {
        weddingContextReads += 1;
        throw new Error("wedding context must not be read");
      },
    } as unknown as ToolExecutionContext;

    const result = await executeTool(
      "search_nearby_places",
      { query: "강남 상견례 장소" },
      context,
    );

    expect(result).toMatchObject({
      toolName: "search_nearby_places",
      toolInput: {},
      toolOutput: { error: "retired_external_place_tool" },
      success: false,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(weddingContextReads).toBe(0);
  });
});
