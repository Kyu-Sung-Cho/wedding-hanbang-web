import { describe, expect, it } from "vitest";
import {
  parseBudgetImpactPreview,
  type BudgetImpactPreviewBinding,
} from "@hanbang/shared";
import {
  buildAmoraBudgetImpactPreview,
} from "@/lib/ai/amoraBudgetImpactPreview";
import { getAmoraToolOperationIdentity } from "@/lib/ai/amoraToolIdentity";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";

const COUPLE_ID = "10000000-0000-4000-8000-000000000001";

function context(
  overrides: Partial<ToolExecutionContext["weddingContext"]> = {},
): ToolExecutionContext {
  return {
    coupleId: COUPLE_ID,
    requestKey:
      "chat:20000000-0000-4000-8000-000000000001:30000000-0000-4000-8000-000000000001",
    weddingContext: {
      weddingDate: "2027-05-01",
      budget: 50_000_000,
      venue: null,
      progress: {
        venue: {
          category: "venue",
          status: "in_progress",
          budget: 20_000_000,
          spent: 5_000_000,
        },
        studio: {
          category: "studio",
          status: "not_started",
          budget: 10_000_000,
          cost: 9_000_000,
        },
      } as unknown as ToolExecutionContext["weddingContext"]["progress"],
      ...overrides,
    },
  };
}

function action(tool: string, input: Record<string, unknown>) {
  const identity = getAmoraToolOperationIdentity(tool, input);
  return {
    tool,
    input,
    inputDigest: identity.inputDigest,
  };
}

describe("Amora budget impact preview", () => {
  it("previews the exact total-budget mutation and never treats legacy cost as recorded spend", () => {
    const pending = action("update_budget", { total_budget: 25_000_000 });
    const preview = buildAmoraBudgetImpactPreview({
      action: pending,
      sourceRevision: 7,
      context: context(),
    });

    expect(preview).toMatchObject({
      version: 1,
      kind: "budget_change",
      tool: "update_budget",
      inputDigest: pending.inputDigest,
      sourceRevision: 7,
      recordedSpendBasis: "explicit_spent_only",
      current: {
        totalBudget: 50_000_000,
        allocatedBudget: 30_000_000,
        recordedSpend: 5_000_000,
        unallocatedBudget: 20_000_000,
      },
      proposed: {
        totalBudget: 25_000_000,
        allocatedBudget: 30_000_000,
        recordedSpend: 5_000_000,
        unallocatedBudget: -5_000_000,
      },
      delta: {
        totalBudget: -25_000_000,
        allocatedBudget: 0,
        recordedSpend: 0,
        unallocatedBudget: -25_000_000,
      },
      categories: [],
      warnings: ["allocated_over_total"],
    });
  });

  it("shows a category's before/after allocation and explicitly recorded spend", () => {
    const pending = action("update_category_budget", {
      category: "venue",
      budget: 18_000_000,
      spent: 19_000_000,
    });
    const preview = buildAmoraBudgetImpactPreview({
      action: pending,
      sourceRevision: 8,
      context: context(),
    });

    expect(preview?.categories).toEqual([
      {
        key: "venue",
        label: "결혼식장",
        currentBudget: 20_000_000,
        proposedBudget: 18_000_000,
        currentRecordedSpend: 5_000_000,
        proposedRecordedSpend: 19_000_000,
      },
    ]);
    expect(preview?.proposed).toMatchObject({
      allocatedBudget: 28_000_000,
      recordedSpend: 19_000_000,
    });
    expect(preview?.warnings).toContain("category_recorded_spend_over_budget");
  });

  it("does not call recorded spend an allocation overrun when no category budget exists", () => {
    const pending = action("update_category_budget", {
      category: "reserve",
      spent: 300_000,
    });
    const preview = buildAmoraBudgetImpactPreview({
      action: pending,
      sourceRevision: 8,
      context: context(),
    });

    expect(preview?.categories).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: "reserve",
        proposedBudget: 0,
        proposedRecordedSpend: 300_000,
      }),
    ]));
    expect(preview?.warnings).not.toContain("category_recorded_spend_over_budget");
  });

  it("keeps a spent-only custom category unallocated without an overrun warning", () => {
    const pending = action("add_custom_category", {
      label: "차량 이동",
      spent: 300_000,
    });
    const preview = buildAmoraBudgetImpactPreview({
      action: pending,
      sourceRevision: 8,
      context: context(),
    });

    expect(preview?.categories).toEqual([
      expect.objectContaining({
        label: "차량 이동",
        proposedBudget: 0,
        proposedRecordedSpend: 300_000,
      }),
    ]);
    expect(preview?.warnings).not.toContain("category_recorded_spend_over_budget");
  });

  it("treats an explicit zero category budget as unallocated rather than overrun", () => {
    const pending = action("update_category_budget", {
      category: "venue",
      budget: 0,
    });
    const preview = buildAmoraBudgetImpactPreview({
      action: pending,
      sourceRevision: 8,
      context: context(),
    });

    expect(preview?.categories).toEqual([
      expect.objectContaining({
        key: "venue",
        proposedBudget: 0,
        proposedRecordedSpend: 5_000_000,
      }),
    ]);
    expect(preview?.warnings).not.toContain("category_recorded_spend_over_budget");
  });

  it("still warns when a spent-only update exceeds an existing positive budget", () => {
    const pending = action("update_category_budget", {
      category: "venue",
      spent: 21_000_000,
    });
    const preview = buildAmoraBudgetImpactPreview({
      action: pending,
      sourceRevision: 8,
      context: context(),
    });

    expect(preview?.categories).toEqual([
      expect.objectContaining({
        key: "venue",
        proposedBudget: 20_000_000,
        proposedRecordedSpend: 21_000_000,
      }),
    ]);
    expect(preview?.warnings).toContain("category_recorded_spend_over_budget");
  });

  it("uses the same atomic budget-plan behavior, including automatic reserve allocation", () => {
    const pending = action("apply_budget_plan", {
      total_budget: 40_000_000,
      allocations: [
        { category: "venue", budget: 20_000_000 },
        { category: "studio", budget: 10_000_000 },
      ],
    });
    const preview = buildAmoraBudgetImpactPreview({
      action: pending,
      sourceRevision: 9,
      context: context(),
    });

    expect(preview?.proposed).toEqual({
      totalBudget: 40_000_000,
      allocatedBudget: 40_000_000,
      recordedSpend: 5_000_000,
      unallocatedBudget: 0,
    });
    expect(preview?.categories).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: "reserve",
        currentBudget: 0,
        proposedBudget: 10_000_000,
      }),
    ]));
  });

  it("fails closed for unsupported, invalid, or digest-mismatched proposals", () => {
    expect(buildAmoraBudgetImpactPreview({
      action: action("update_venue", { venue: "새 예식장" }),
      sourceRevision: 1,
      context: context(),
    })).toBeNull();

    const pending = action("update_budget", { total_budget: 30_000_000 });
    expect(buildAmoraBudgetImpactPreview({
      action: { ...pending, inputDigest: "a".repeat(64) },
      sourceRevision: 1,
      context: context(),
    })).toBeNull();
    expect(buildAmoraBudgetImpactPreview({
      action: pending,
      sourceRevision: 1,
      context: context({ budget: -1 }),
    })).toBeNull();
  });

  it("previews the retained budgets and zeroed old reserve exactly as the budget page will show", () => {
    const ctx = context();
    Object.assign(ctx.weddingContext.progress, { reserve: { category: "reserve", status: "not_started", budget: 20_000_000 } });
    const preview = buildAmoraBudgetImpactPreview({
      action: action("apply_budget_plan", { total_budget: 30_000_000, allocations: [{ category: "venue", budget: 20_000_000 }] }),
      sourceRevision: 12, context: ctx,
    });
    expect(preview?.proposed).toMatchObject({ totalBudget: 30_000_000, allocatedBudget: 30_000_000, unallocatedBudget: 0, recordedSpend: 5_000_000 });
    expect(preview?.categories).toContainEqual(expect.objectContaining({ key: "reserve", currentBudget: 20_000_000, proposedBudget: 0 }));
    expect(preview?.warnings).not.toContain("allocated_over_total");
  });

  it("excludes hidden fixed amounts from both current and proposed totals without deleting them", () => {
    const ctx = context();
    Object.assign(ctx.weddingContext.progress, { __hidden: ["studio"] });
    const before = structuredClone(ctx.weddingContext.progress);
    const preview = buildAmoraBudgetImpactPreview({
      action: action("apply_budget_plan", { total_budget: 30_000_000, allocations: [{ category: "venue", budget: 20_000_000 }] }),
      sourceRevision: 13, context: ctx,
    });
    expect(preview?.current.allocatedBudget).toBe(20_000_000);
    expect(preview?.proposed).toMatchObject({ allocatedBudget: 30_000_000, unallocatedBudget: 0 });
    expect(ctx.weddingContext.progress).toEqual(before);
  });

  it("binds persisted preview data to the exact action digest and journey revision", () => {
    const pending = action("update_budget", { total_budget: 30_000_000 });
    const preview = buildAmoraBudgetImpactPreview({
      action: pending,
      sourceRevision: 11,
      context: context(),
    });
    expect(preview).not.toBeNull();
    const binding: BudgetImpactPreviewBinding = {
      tool: pending.tool,
      inputDigest: pending.inputDigest,
      sourceRevision: 11,
    };

    expect(parseBudgetImpactPreview(preview, binding)).toEqual(preview);
    expect(parseBudgetImpactPreview(preview, {
      ...binding,
      inputDigest: "b".repeat(64),
    })).toBeNull();
    expect(parseBudgetImpactPreview(preview, {
      ...binding,
      sourceRevision: 12,
    })).toBeNull();
    expect(parseBudgetImpactPreview({
      ...preview,
      delta: { ...preview!.delta, totalBudget: 1 },
    }, binding)).toBeNull();
  });
});
