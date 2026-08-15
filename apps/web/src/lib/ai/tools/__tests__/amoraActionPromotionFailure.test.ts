import { beforeEach, describe, expect, it, vi } from "vitest";

import { insertAmoraActionRecord } from "@/lib/amora/actionRepository";
import { saveProgress } from "@/lib/ai/tools/progressTools";
import { executeAddAmoraAction } from "../amoraActionTools";
import type { ToolExecutionContext } from "../toolTypes";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("@/lib/amora/actionRepository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/amora/actionRepository")>();
  return {
    ...actual,
    insertAmoraActionRecord: vi.fn(),
    listAmoraActionRecords: vi.fn(async () => []),
  };
});
vi.mock("@/lib/ai/tools/progressTools", () => ({
  saveProgress: vi.fn(async () => undefined),
}));

function context(): ToolExecutionContext {
  return {
    coupleId: "22222222-2222-4222-8222-222222222222",
    weddingContext: {
      weddingDate: null,
      budget: 0,
      venue: null,
      progress: {},
    },
  };
}

describe("provenance-bound add_amora_action persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns failure and never writes the legacy mirror when the canonical insert is rejected", async () => {
    vi.mocked(insertAmoraActionRecord).mockRejectedValueOnce(Object.assign(
      new Error("AMORA_FIRST_USE_PROMOTION_PROPOSAL_MISMATCH"),
      { code: "23514" },
    ));

    const result = await executeAddAmoraAction({
      title: "예식 시기 후보 두 개 적기",
      description: "이유와 완료 기준",
      category_key: "general",
      priority: "medium",
      source: "chat",
    }, context());

    expect(result).toMatchObject({
      toolName: "add_amora_action",
      success: false,
      toolOutput: { error: "action table insert failed" },
    });
    expect(saveProgress).not.toHaveBeenCalled();
  });
});
