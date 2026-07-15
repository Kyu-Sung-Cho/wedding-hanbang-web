import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createAdminClient } from "@/lib/supabase/admin";
import { executeTool } from "../toolExecutor";
import { WEDDING_TOOLS } from "../tools";
import type { ToolExecutionContext } from "../tools/toolTypes";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

const context: ToolExecutionContext = {
  coupleId: "00000000-0000-0000-0000-000000000000",
  currentUserId: "11111111-1111-4111-8111-111111111111",
  weddingContext: {
    weddingDate: null,
    budget: 0,
    venue: null,
    progress: {},
  },
};

describe("retired untrusted decision tools", () => {
  it("removes retired scoring and simulation implementations from future switches", () => {
    const tools = readFileSync(resolve(process.cwd(), "src/lib/ai/tools.ts"), "utf8");
    const executor = readFileSync(resolve(process.cwd(), "src/lib/ai/toolExecutor.ts"), "utf8");
    const selection = readFileSync(resolve(process.cwd(), "src/lib/ai/toolSelection.ts"), "utf8");

    for (const toolName of ["analyze_contract_readiness", "simulate_guest_guarantee"]) {
      expect(tools).not.toContain(`name: "${toolName}"`);
      expect(executor).not.toContain(`case "${toolName}"`);
      expect(selection).not.toContain(`"${toolName}"`);
    }
    expect(existsSync(resolve(process.cwd(), "src/lib/ai/tools/riskSupportTools.ts"))).toBe(false);
    expect(existsSync(resolve(process.cwd(), "src/components/app/chat/ProtectionToolCard.tsx"))).toBe(false);
    expect(existsSync(resolve(process.cwd(), "src/lib/amora/contractShield.ts"))).toBe(false);
    expect(existsSync(resolve(process.cwd(), "src/lib/amora/guestGuarantee.ts"))).toBe(false);
  });

  it.each([
    ["analyze_contract_readiness", { category: "venue" }],
    [
      "simulate_guest_guarantee",
      { estimated_guests: 180, guaranteed_guests: 200, meal_price: 7.5 },
    ],
  ])("does not expose or execute %s", async (toolName, input) => {
    expect(WEDDING_TOOLS.map((tool) => tool.name)).not.toContain(toolName);

    await expect(executeTool(toolName, input, context)).resolves.toMatchObject({
      success: false,
      toolOutput: { error: "retired_untrusted_tool" },
    });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("does not render stored legacy estimates as a current analysis", () => {
    expect(
      existsSync(resolve(process.cwd(), "src/components/app/chat/VendorToolCard.tsx")),
    ).toBe(false);
    expect(
      existsSync(resolve(process.cwd(), "src/components/app/chat/ProtectionToolCard.tsx")),
    ).toBe(false);
  });

  it("keeps the budget specialist factual and source-bound", () => {
    const router = readFileSync(resolve(process.cwd(), "src/lib/ai/stage-router.ts"), "utf8");
    const budgetAddon = router.match(
      /budget_optimizer: `[\s\S]*?`,\s*\n\s*ceremony_coordinator:/,
    )?.[0] ?? "";

    expect(budgetAddon).toContain("사용자가 직접 입력한 금액");
    expect(budgetAddon).toContain("출처");
    expect(budgetAddon).not.toContain("카테고리별 평균가, 시세, 패키지 비교에 강합니다");
    expect(budgetAddon).not.toContain("비용 대비 효과가 작은 항목");
  });
});
