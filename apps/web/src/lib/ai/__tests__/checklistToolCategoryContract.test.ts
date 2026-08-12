import { describe, expect, it } from "vitest";

import { CHECKLIST_CATEGORY_LABELS, PLANNING_CATEGORY_LABELS } from "@hanbang/shared/constants";
import { WEDDING_TOOLS } from "@/lib/ai/tools";

function categoryEnum(toolName: string, property: string): string[] {
  const tool = WEDDING_TOOLS.find((candidate) => candidate.name === toolName);
  const properties = tool?.input_schema.properties as Record<string, { enum?: string[] }> | undefined;
  return properties?.[property]?.enum ?? [];
}

function allocationCategoryEnum(): string[] {
  const tool = WEDDING_TOOLS.find((candidate) => candidate.name === "apply_budget_plan");
  const allocations = (tool?.input_schema.properties as Record<string, unknown>)?.allocations as {
    items?: { properties?: { category?: { enum?: string[] } } };
  } | undefined;
  return allocations?.items?.properties?.category?.enum ?? [];
}

describe("AI checklist and budget category contracts", () => {
  it("exposes all 27 checklist categories to checklist, schedule, and action tools", () => {
    const checklistKeys = Object.keys(CHECKLIST_CATEGORY_LABELS).sort();
    expect(categoryEnum("update_task_status", "category").sort()).toEqual(checklistKeys);
    expect(categoryEnum("toggle_checklist_item", "category").sort()).toEqual(checklistKeys);
    for (const values of [
      categoryEnum("add_schedule_event", "category_key"),
      categoryEnum("add_amora_action", "category_key"),
    ]) {
      expect(values.filter((key) => key === "general")).toHaveLength(1);
      expect(values.filter((key) => key !== "general").sort()).toEqual(checklistKeys);
    }
  });

  it("keeps checklist-only categories out of budget mutations", () => {
    const budgetKeys = Object.keys(PLANNING_CATEGORY_LABELS).sort();
    expect(categoryEnum("update_category_budget", "category").sort()).toEqual(budgetKeys);
    expect(allocationCategoryEnum().sort()).toEqual(budgetKeys);
    expect(categoryEnum("update_category_budget", "category")).not.toContain("aftercare");
  });
});
