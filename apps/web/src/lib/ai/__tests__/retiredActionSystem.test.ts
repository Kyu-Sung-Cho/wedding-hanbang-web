import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { executeTool } from "../toolExecutor";
import { selectAmoraToolsForTurn } from "../toolSelection";
import { WEDDING_TOOLS } from "../tools";
import type { AiToolDefinition } from "../toolDefinition";
import type { ToolExecutionContext } from "../tools/toolTypes";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

const retiredNames = [
  "add_amora_action",
  "get_amora_actions",
  "update_amora_action",
] as const;

function makeContext(): ToolExecutionContext {
  return {
    coupleId: "00000000-0000-0000-0000-000000000000",
    weddingContext: {
      weddingDate: null,
      budget: 0,
      venue: null,
      progress: {},
    },
  };
}

describe("retired Amora action system", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not expose duplicate action schemas to the model", () => {
    const exposed = new Set(WEDDING_TOOLS.map((tool) => tool.name));

    for (const name of retiredNames) expect(exposed.has(name), name).toBe(false);
  });

  it.each(retiredNames)("rejects a stale %s call before database access", async (toolName) => {
    const result = await executeTool(toolName, {}, makeContext());

    expect(result).toMatchObject({
      success: false,
      toolOutput: { error: "retired_amora_actions" },
    });
    expect(result.displayMessage).toContain("체크리스트");
    expect(result.displayMessage).toContain("일정");
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("does not select a stale action schema supplied by an old caller", () => {
    const staleTools: AiToolDefinition[] = [
      ...retiredNames.map((name) => ({ name, input_schema: { type: "object" as const } })),
      { name: "get_wedding_info", input_schema: { type: "object" as const } },
      { name: "get_schedule_summary", input_schema: { type: "object" as const } },
      { name: "get_schedule_events", input_schema: { type: "object" as const } },
      { name: "get_budget_summary", input_schema: { type: "object" as const } },
    ];

    const selected = selectAmoraToolsForTurn(staleTools, {
      userText: "내가 해야 할 준비가 뭐야?",
    }).map((tool) => tool.name);

    for (const name of retiredNames) expect(selected).not.toContain(name);
  });
});
