import { describe, expect, it } from "vitest";
import { getAmoraActionApprovalPolicy } from "@/lib/ai/amoraActionApprovalPolicy";
import { MUTATING_TOOL_NAMES } from "@/lib/ai/mutationTools";
import { BETA_DISABLED_TOOL_NAMES } from "@/lib/ai/tools";

type MutatingToolName = (typeof MUTATING_TOOL_NAMES)[number];

const EXPECTED_POLICY_BY_MUTATING_TOOL = {
  update_budget: "couple",
  update_wedding_date: "couple",
  update_task_status: "single",
  update_venue: "couple",
  update_category_budget: "couple",
  apply_budget_plan: "couple",
  delete_category: "blocked",
  reset_category: "blocked",
  update_schedule_event: "couple",
  cancel_schedule_event: "couple",
  restore_schedule_event: "couple",
  delete_schedule_event: "blocked",
  toggle_checklist_item: "single",
  update_amora_action: "blocked",
  cancel_booking: "blocked",
  add_custom_category: "couple",
  add_schedule_event: "couple",
  add_amora_action: "single",
  log_wedding_event: "single",
  create_booking: "blocked",
} as const satisfies Record<MutatingToolName, "single" | "couple" | "blocked">;

describe("Amora action approval policy", () => {
  it.each([
    "update_budget",
    "update_wedding_date",
    "update_venue",
    "apply_budget_plan",
  ])("requires the couple to approve %s", (toolName) => {
    expect(getAmoraActionApprovalPolicy(toolName, {})).toBe("couple");
  });

  it("requires couple approval when a category budget value is present", () => {
    expect(
      getAmoraActionApprovalPolicy("update_category_budget", {
        category: "venue",
        budget: 0,
        spent: 1_000_000,
      }),
    ).toBe("couple");
  });

  it("allows one member to record category spending without changing its budget", () => {
    expect(
      getAmoraActionApprovalPolicy("update_category_budget", {
        category: "venue",
        spent: 1_000_000,
      }),
    ).toBe("single");
  });

  it("requires couple approval when a new custom category includes a budget", () => {
    expect(
      getAmoraActionApprovalPolicy("add_custom_category", {
        label: "차량 이동",
        budget: 500_000,
        spent: 100_000,
      }),
    ).toBe("couple");
  });

  it("allows one member to add a custom expense without assigning a budget", () => {
    expect(
      getAmoraActionApprovalPolicy("add_custom_category", {
        label: "차량 이동",
        spent: 100_000,
      }),
    ).toBe("single");
  });

  it.each([
    "update_task_status",
    "add_custom_category",
    "toggle_checklist_item",
    "add_amora_action",
    "log_wedding_event",
  ])("allows one member to approve reversible action %s", (toolName) => {
    expect(getAmoraActionApprovalPolicy(toolName, {})).toBe("single");
  });

  it("allows one member to record a confirmed schedule fact but protects commitments and edits", () => {
    expect(getAmoraActionApprovalPolicy("add_schedule_event", {
      schedule_scope: "confirmed_fact",
    })).toBe("single");

    for (const scheduleScope of [
      undefined,
      "shared_commitment",
      "external_commitment",
      "unknown_future_scope",
    ]) {
      expect(getAmoraActionApprovalPolicy("add_schedule_event", {
        ...(scheduleScope ? { schedule_scope: scheduleScope } : {}),
      })).toBe("couple");
    }

    expect(getAmoraActionApprovalPolicy("update_schedule_event", {
      schedule_scope: "confirmed_fact",
    })).toBe("couple");
  });

  it("blocks beta-disabled writes and unknown tools", () => {
    for (const toolName of BETA_DISABLED_TOOL_NAMES) {
      expect(getAmoraActionApprovalPolicy(toolName, {})).toBe("blocked");
    }

    expect(getAmoraActionApprovalPolicy("unknown_future_mutation", {})).toBe("blocked");
    expect(getAmoraActionApprovalPolicy("search_vendors", {})).toBe("blocked");
    expect(getAmoraActionApprovalPolicy("update_amora_action", {})).toBe("blocked");
  });

  it("classifies every mutating tool without policy drift", () => {
    expect(new Set(Object.keys(EXPECTED_POLICY_BY_MUTATING_TOOL))).toEqual(
      new Set(MUTATING_TOOL_NAMES),
    );

    for (const toolName of MUTATING_TOOL_NAMES) {
      const input = (
        toolName === "update_category_budget"
        || toolName === "add_custom_category"
      )
        ? { budget: 1 }
        : {};
      expect(getAmoraActionApprovalPolicy(toolName, input)).toBe(
        EXPECTED_POLICY_BY_MUTATING_TOOL[toolName],
      );
    }
  });
});
