import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createAdminClient } from "@/lib/supabase/admin";
import { executeTool } from "../toolExecutor";
import { WEDDING_TOOLS } from "../tools";
import type { ToolExecutionContext } from "../tools/toolTypes";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

describe("retired automatic budget allocation", () => {
  it("removes the retired schema and implementation instead of leaving an unsafe future switch", () => {
    const tools = readFileSync(resolve(process.cwd(), "src/lib/ai/tools.ts"), "utf8");
    const executor = readFileSync(resolve(process.cwd(), "src/lib/ai/toolExecutor.ts"), "utf8");
    const chatStore = readFileSync(resolve(process.cwd(), "src/stores/chatStore.ts"), "utf8");

    expect(tools).not.toContain('name: "apply_budget_plan"');
    expect(tools).not.toMatch(/평균 \+[0-9]|평균 -[0-9]/);
    expect(executor).not.toContain("async function executeApplyBudgetPlan");
    expect(executor).not.toContain('case "apply_budget_plan"');
    expect(chatStore).not.toContain('"apply_budget_plan"');

    for (const toolName of [
      "update_budget",
      "update_category_budget",
      "add_custom_category",
      "delete_category",
      "reset_category",
    ]) {
      expect(tools).not.toContain(`name: "${toolName}"`);
      expect(executor).not.toContain(`case "${toolName}"`);
      expect(chatStore).not.toContain(`"${toolName}"`);
    }
    expect(executor).not.toMatch(/function execute(?:UpdateBudget|UpdateCategoryBudget|AddCustomCategory|DeleteCategory|ResetCategory)/);
  });

  it("is absent from every executable schema and cannot be invoked manually", async () => {
    expect(WEDDING_TOOLS.map((tool) => tool.name)).not.toContain("apply_budget_plan");

    const context: ToolExecutionContext = {
      coupleId: "00000000-0000-0000-0000-000000000000",
      currentUserId: "11111111-1111-4111-8111-111111111111",
      weddingContext: {
        weddingDate: null,
        budget: 30_000_000,
        venue: null,
        progress: {},
      },
    };

    const result = await executeTool(
      "apply_budget_plan",
      {
        total_budget: 30_000_000,
        allocations: [{ category: "venue", budget: 15_000_000 }],
        intake_summary: "자동 배분",
      },
      context
    );

    expect(result).toMatchObject({
      success: false,
      toolOutput: { error: "retired_untrusted_tool" },
    });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it.each([
    ["update_budget", { total_budget: 30_000_000 }],
    ["update_category_budget", { category: "venue", budget: 15_000_000 }],
    ["add_custom_category", { label: "직접 항목", budget: 500_000 }],
    ["delete_category", { category: "venue", confirmed: true }],
    ["reset_category", { category: "venue", confirmed: true }],
  ])("keeps financial records manual-only by retiring %s", async (toolName, input) => {
    expect(WEDDING_TOOLS.map((tool) => tool.name)).not.toContain(toolName);

    const context: ToolExecutionContext = {
      coupleId: "00000000-0000-0000-0000-000000000000",
      currentUserId: "11111111-1111-4111-8111-111111111111",
      weddingContext: {
        weddingDate: null,
        budget: 30_000_000,
        venue: null,
        progress: {},
      },
    };

    await expect(executeTool(toolName, input, context)).resolves.toMatchObject({
      success: false,
      toolOutput: { error: "retired_untrusted_tool" },
    });
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
