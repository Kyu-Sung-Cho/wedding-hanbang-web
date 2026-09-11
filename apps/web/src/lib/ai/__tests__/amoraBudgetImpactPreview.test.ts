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
  it.each(["custom", "fixed"])("keeps unallocated money and reserve when swapping only two %s budgets (B02)", (kind) => {
    const progress = {
      custom_photo: { category: "custom_photo", label: "웨딩 사진 촬영", status: "completed", budget: 3_000_000, spent: 123_000, payer: "groom", notes: "합성 보존 메모" },
      custom_outfit: { category: "custom_outfit", label: "드레스·예식 정장", status: "in_progress", budget: 3_000_000 },
      venue: { category: "venue", status: "not_started", budget: 12_000_000 },
      honeymoon: { category: "honeymoon", status: "not_started", budget: 10_000_000 },
      custom_other: { category: "custom_other", label: "그 밖의 준비", status: "not_started", budget: 4_000_000 },
      reserve: { category: "reserve", status: "not_started", budget: 2_000_000 },
      __shares: { bride: 40, groom: 60 },
      __events: [{ id: "synthetic-keep", date: "2027-09-18", title: "보존 일정" }],
    };
    const isFixed = kind === "fixed";
    const mappedProgress: Record<string, unknown> = isFixed ? {
      ...progress, studio: { ...progress.custom_photo, category: "studio" },
      dress: { ...progress.custom_outfit, category: "dress" },
    } : { ...progress };
    if (isFixed) { delete mappedProgress.custom_photo; delete mappedProgress.custom_outfit; }
    const ctx = context({ budget: 35_000_000, progress: mappedProgress as ToolExecutionContext["weddingContext"]["progress"] });
    const before = structuredClone(ctx);
    const preview = buildAmoraBudgetImpactPreview({
      action: action("apply_budget_plan", { total_budget: 35_000_000, allocation_mode: "explicit", allocations: [
      { category: isFixed ? "studio" : "custom", ...(isFixed ? {} : {label: "웨딩 사진 촬영"}), budget: 2_999_000 },
      { category: isFixed ? "dress" : "custom", ...(isFixed ? {} : {label: "드레스·예식 정장"}), budget: 3_001_000 },
    ] }),
      sourceRevision: 20, context: ctx,
    });
    expect(preview?.current).toEqual({ totalBudget: 35_000_000, allocatedBudget: 34_000_000, recordedSpend: 123_000, unallocatedBudget: 1_000_000 });
    expect(preview?.proposed).toEqual(preview?.current);
    expect(preview?.categories.map(item => item.key).sort()).toEqual(isFixed ? ["dress", "studio"] : ["custom_outfit", "custom_photo"]);
    expect(ctx).toEqual(before);
  });

  it("previews named groups with the exact persisted labels while preserving recorded spend", () => {
    const prior = {category:"custom_photo",label:"사진",budget:1_000_000,spent:300_000,status:"completed",payer:"bride"};
    const ctx = context({budget:35_000_000,progress:{custom_photo:prior,venue:{category:"venue",status:"completed",budget:9_000_000,spent:1_000_000}} as unknown as ToolExecutionContext["weddingContext"]["progress"]});
    const before=structuredClone(ctx);
    const preview=buildAmoraBudgetImpactPreview({action:action("apply_budget_plan",{total_budget:35_000_000,allocations:[{category:"custom",label:"사진",budget:5_000_000},{category:"custom",label:"초대장·꽃·하객선물",budget:1_500_000}]}),sourceRevision:2,context:ctx});
    expect(preview).not.toBeNull();
    expect(preview?.categories).toEqual(expect.arrayContaining([
      expect.objectContaining({key:"custom_photo",label:"사진",proposedBudget:5_000_000,currentRecordedSpend:300_000,proposedRecordedSpend:300_000}),
      expect.objectContaining({label:"초대장·꽃·하객선물",proposedBudget:1_500_000}),
      expect.objectContaining({key:"reserve",proposedBudget:19_500_000}),
    ]));
    expect(ctx).toEqual(before);
  });
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
