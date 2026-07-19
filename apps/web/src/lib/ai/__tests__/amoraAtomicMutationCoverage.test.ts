import { describe, expect, it, vi } from "vitest";
import {
  AMORA_ATOMIC_TOOL_NAMES,
  applyAmoraAtomicToolResultToContext,
  buildAmoraAtomicToolOperation,
} from "@/lib/ai/amoraAtomicToolOperation";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";
import { isMutatingTool } from "@/lib/ai/mutationTools";

const REQUEST_KEY =
  "chat:20000000-0000-4000-8000-000000000001:30000000-0000-4000-8000-000000000001";

function context(): ToolExecutionContext {
  return {
    coupleId: "10000000-0000-4000-8000-000000000001",
    requestKey: REQUEST_KEY,
    requestAttemptCount: 1,
    providerCallIndex: 1,
    weddingContext: {
      weddingDate: "2027-05-01",
      budget: 50_000_000,
      venue: "기존 예식장",
      progress: {
        venue: {
          category: "venue",
          status: "not_started",
          budget: 10_000_000,
        },
      } as unknown as ToolExecutionContext["weddingContext"]["progress"],
    },
  };
}

function expectAtomicSuccess(operation: ReturnType<typeof buildAmoraAtomicToolOperation>) {
  expect(operation.result.success).toBe(true);
  expect(operation.result.toolOutput).not.toMatchObject({
    error: "TOOL_ATOMICITY_UNAVAILABLE",
  });
  expect(operation.domainMutation.kind).not.toBe("none");
}

describe("Amora atomic mutation coverage", () => {
  it("keeps every beta-exposed mutating tool inside the atomic dispatcher", () => {
    const exposedMutations = BETA_SAFE_TOOLS
      .map((tool) => tool.name)
      .filter(isMutatingTool);
    expect(exposedMutations.filter((name) => !AMORA_ATOMIC_TOOL_NAMES.has(name)))
      .toEqual([]);
  });

  it("builds CAS operations for wedding date, venue, task status, and category budget", () => {
    vi.setSystemTime(new Date("2026-07-17T00:00:00.000Z"));
    const ctx = context();

    const date = buildAmoraAtomicToolOperation(
      "update_wedding_date",
      { wedding_date: "2027-06-01" },
      ctx,
    );
    const venue = buildAmoraAtomicToolOperation(
      "update_venue",
      { venue: "  새   예식장  " },
      ctx,
    );
    const status = buildAmoraAtomicToolOperation(
      "update_task_status",
      { category: "venue", status: "in_progress" },
      ctx,
    );
    const budget = buildAmoraAtomicToolOperation(
      "update_category_budget",
      { category: "venue", budget: 12_000_000 },
      ctx,
    );

    for (const operation of [date, venue, status, budget]) expectAtomicSuccess(operation);
    expect(date.domainMutation).toEqual({
      kind: "journey_wedding_date_cas",
      expected: "2027-05-01",
      value: "2027-06-01",
    });
    expect(venue.domainMutation).toEqual({
      kind: "journey_venue_cas",
      expected: "기존 예식장",
      value: "새 예식장",
    });
    expect(status.domainMutation).toMatchObject({
      kind: "journey_progress_entry_cas",
      key: "venue",
      expectedPresent: true,
      value: { category: "venue", status: "in_progress", budget: 10_000_000 },
    });
    expect(budget.domainMutation).toMatchObject({
      kind: "journey_progress_entry_cas",
      key: "venue",
      value: { category: "venue", status: "not_started", budget: 12_000_000 },
    });
    vi.useRealTimers();
  });

  it("fails closed on a corrupt legacy total budget until the cleanup migration runs", () => {
    const ctx = context();
    ctx.weddingContext.budget = -1;

    const operation = buildAmoraAtomicToolOperation(
      "update_budget",
      { total_budget: 30_000_000 },
      ctx,
    );

    expect(operation.domainMutation).toEqual({ kind: "none" });
    expect(operation.result).toMatchObject({
      success: false,
      toolOutput: { error: "invalid_existing_budget" },
    });
    expect(operation.result.displayMessage).not.toContain("-1");
  });

  it("applies a budget plan without retaining the private intake summary", () => {
    const operation = buildAmoraAtomicToolOperation(
      "apply_budget_plan",
      {
        total_budget: 50_000_000,
        allocations: [
          { category: "venue", budget: 20_000_000, rationale: "priority" },
          { category: "studio", budget: 10_000_000 },
        ],
        intake_summary: "private family finances must not be retained",
      },
      context(),
    );

    expectAtomicSuccess(operation);
    expect(operation.domainMutation).toMatchObject({
      kind: "journey_budget_plan_cas",
      expectedBudget: 50_000_000,
      valueBudget: 50_000_000,
      entries: expect.arrayContaining([
        expect.objectContaining({ key: "venue", value: expect.objectContaining({ budget: 20_000_000 }) }),
        expect.objectContaining({ key: "studio", value: expect.objectContaining({ budget: 10_000_000 }) }),
        expect.objectContaining({ key: "reserve", value: expect.objectContaining({ budget: 20_000_000 }) }),
      ]),
    });
    expect(JSON.stringify(operation.domainMutation)).not.toContain("private family");
    expect(JSON.stringify(operation.result.toolOutput)).not.toContain("private family");
  });

  it("creates deterministic custom categories and updates checklist entries with entry CAS", () => {
    const ctx = context();
    const category = buildAmoraAtomicToolOperation(
      "add_custom_category",
      { label: " 포토 부스 ", budget: 500_000 },
      ctx,
    );
    const checklist = buildAmoraAtomicToolOperation(
      "toggle_checklist_item",
      { category: "venue", item_id: "venue_03", done: true },
      ctx,
    );

    expectAtomicSuccess(category);
    expectAtomicSuccess(checklist);
    expect(category.domainMutation).toMatchObject({
      kind: "journey_progress_entry_cas",
      key: expect.stringMatching(/^custom_[0-9a-f]{24}$/),
      value: expect.objectContaining({ label: "포토 부스", budget: 500_000 }),
    });
    expect(checklist.domainMutation).toMatchObject({
      kind: "journey_progress_entry_cas",
      key: "venue",
      value: expect.objectContaining({
        checklist: expect.arrayContaining([
          expect.objectContaining({ id: "venue_03", done: true }),
        ]),
      }),
    });
  });

  it("logs a supported wedding event through the schedule CAS", () => {
    const ctx = context();
    const operation = buildAmoraAtomicToolOperation(
      "log_wedding_event",
      { moment_type: "venue_tour", date: "2027-03-12", title: "예식장 투어" },
      ctx,
    );

    expectAtomicSuccess(operation);
    expect(operation.domainMutation).toMatchObject({
      kind: "journey_progress_key_cas",
      key: "__events",
      value: [expect.objectContaining({
        date: "2027-03-12",
        title: "예식장 투어",
        momentType: "venue_tour",
      })],
    });
    applyAmoraAtomicToolResultToContext(operation.result, ctx);
    expect(ctx.weddingContext.progress.__events).toEqual([
      expect.objectContaining({ momentType: "venue_tour", date: "2027-03-12" }),
    ]);
  });

  it("uses amora_actions as the canonical durable store with an operation-derived ID", () => {
    const ctx = context();
    const operationKey = "a".repeat(64);
    const add = buildAmoraAtomicToolOperation(
      "add_amora_action",
      { title: "계약서 확인", category_key: "venue", priority: "high" },
      ctx,
      operationKey,
    );
    const update = buildAmoraAtomicToolOperation(
      "update_amora_action",
      { action_id: `act_${"3".repeat(32)}_${"a".repeat(24)}`, status: "done" },
      ctx,
      operationKey,
    );

    expectAtomicSuccess(add);
    expectAtomicSuccess(update);
    expect(add.domainMutation).toEqual({
      kind: "amora_action_insert",
      action: expect.objectContaining({
        id: `act_${"30000000000040008000000000000001"}_${"a".repeat(24)}`,
        title: "계약서 확인",
        status: "open",
      }),
    });
    expect(JSON.stringify(add.domainMutation)).not.toContain("createdAt");
    expect(update.domainMutation).toMatchObject({
      kind: "amora_action_update",
      updates: { status: "done" },
    });
  });

  it("does not report success for known no-op assignments", () => {
    const ctx = context();
    const cases = [
      buildAmoraAtomicToolOperation("update_wedding_date", { wedding_date: "2027-05-01" }, ctx),
      buildAmoraAtomicToolOperation("update_venue", { venue: "기존 예식장" }, ctx),
      buildAmoraAtomicToolOperation("update_task_status", { category: "venue", status: "not_started" }, ctx),
      buildAmoraAtomicToolOperation("update_category_budget", { category: "venue", budget: 10_000_000 }, ctx),
      buildAmoraAtomicToolOperation("update_amora_action", { action_id: `act_${"3".repeat(32)}_${"a".repeat(24)}` }, ctx),
    ];

    for (const operation of cases) {
      expect(operation.result.success).toBe(false);
      expect(operation.domainMutation).toEqual({ kind: "none" });
      expect(operation.result.toolOutput.error).toMatch(/no_change|no_changes_requested/);
    }
  });

  it("projects committed results into the in-process context for later tool rounds", () => {
    const ctx = context();
    const operation = buildAmoraAtomicToolOperation(
      "update_task_status",
      { category: "venue", status: "in_progress" },
      ctx,
    );
    applyAmoraAtomicToolResultToContext(operation.result, ctx);
    expect(ctx.weddingContext.progress.venue).toMatchObject({
      category: "venue",
      status: "in_progress",
      budget: 10_000_000,
    });
  });
});
