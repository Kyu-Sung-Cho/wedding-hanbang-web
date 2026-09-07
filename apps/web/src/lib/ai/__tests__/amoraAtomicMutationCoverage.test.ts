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
  it("preserves all eight original grouped names and amounts in one budget operation", () => {
    const ctx = context();
    ctx.weddingContext.budget = 0;
    ctx.weddingContext.progress = { venue: { category: "venue", status: "completed", budget: 0, spent: 250_000, payer: "bride", checklist: [{ id: "venue_01", done: true }] }, __events: [{ id: "kept" }] } as unknown as ToolExecutionContext["weddingContext"]["progress"];
    const before = structuredClone(ctx.weddingContext.progress);
    const named = [
      ["결혼식장·식사", 9_000_000], ["사진", 5_000_000],
      ["드레스·정장", 3_000_000], ["헤어·메이크업", 2_000_000],
      ["반지·선물", 2_500_000], ["초대장·꽃·하객선물", 1_500_000],
    ] as const;
    const input = { total_budget: 35_000_000, allocations: [
      ...named.map(([label, budget]) => ({ category: "custom", label, budget })),
      { category: "honeymoon", budget: 10_000_000 }, { category: "reserve", budget: 2_000_000 },
    ] };
    const operation = buildAmoraAtomicToolOperation("apply_budget_plan", input, ctx);
    expectAtomicSuccess(operation);
    expect(operation.result.toolOutput.applied_count).toBe(8);
    expect(operation.result.toolOutput.remainder_to_reserve).toBe(0);
    applyAmoraAtomicToolResultToContext(operation.result, ctx);
    expect(ctx.weddingContext.budget).toBe(35_000_000);
    expect(ctx.weddingContext.progress.venue).toEqual(before.venue);
    expect(ctx.weddingContext.progress.__events).toEqual(before.__events);
    const rows = Object.entries(ctx.weddingContext.progress as Record<string, Record<string, unknown>>).filter(([key]) => key.startsWith("custom_"));
    expect(rows).toHaveLength(6);
    for (const [label, budget] of named) {
      expect(rows.filter(([, value]) => value.label === label).map(([, value]) => value.budget)).toEqual([budget]);
    }
    expect(buildAmoraAtomicToolOperation("apply_budget_plan", input, ctx).result.toolOutput.error).toBe("no_change");
  });

  it("reuses a same-label custom key and preserves its spend, payer, checklist, and omitted rows", () => {
    const ctx = context();
    const prior = { category: "custom_manual", label: "Wedding  Car", budget: 100_000, spent: 70_000, payer: "groom", status: "completed", checklist: [{ id: "car_1", done: true }], notes: "그대로" };
    Object.assign(ctx.weddingContext.progress, { custom_manual: prior, custom_other: { category: "custom_other", label: "다른 항목", status: "not_started", budget: 2_000_000 } });
    const operation = buildAmoraAtomicToolOperation("apply_budget_plan", { total_budget: 50_000_000, allocations: [{ category: "custom", label: " wedding car ", budget: 800_000 }] }, ctx);
    expectAtomicSuccess(operation);
    applyAmoraAtomicToolResultToContext(operation.result, ctx);
    expect(ctx.weddingContext.progress.custom_manual).toEqual({ ...prior, label: "wedding car", budget: 800_000 });
    const progress = ctx.weddingContext.progress as Record<string, Record<string, unknown>>;
    expect(progress.custom_other.budget).toBe(2_000_000);
    expect(progress.reserve.budget).toBe(37_200_000);
    expect(Object.keys(ctx.weddingContext.progress).filter(key => key.startsWith("custom_"))).toHaveLength(2);
  });

  it.each([
    [{ category: "custom", label: "사진", budget: 1 }, { category: "custom", label: " 사진 ", budget: 2 }],
    [{ category: "custom", label: "", budget: 1 }],
    [{ category: "custom", label: "😀".repeat(31), budget: 1 }],
    [{ category: "custom", budget: 1 }],
    [{ category: "venue", label: "식장과 사진", budget: 1 }],
  ])("rejects ambiguous or malformed named allocations without changing any state (%j)", (...allocations) => {
    const ctx = context();
    const before = structuredClone(ctx.weddingContext);
    const operation = buildAmoraAtomicToolOperation("apply_budget_plan", { total_budget: 50_000_000, allocations }, ctx);
    expect(operation.result.success).toBe(false);
    expect(operation.domainMutation).toEqual({ kind: "none" });
    expect(ctx.weddingContext).toEqual(before);
  });

  it("rejects duplicate stored names rather than selecting an arbitrary custom budget", () => {
    const ctx = context();
    Object.assign(ctx.weddingContext.progress, { custom_a: { label: "사진", budget: 1 }, custom_b: { label: " 사진 ", budget: 2 } });
    const operation = buildAmoraAtomicToolOperation("apply_budget_plan", { total_budget: 50_000_000, allocations: [{ category: "custom", label: "사진", budget: 3 }] }, ctx);
    expect(operation.result).toMatchObject({ success: false, toolOutput: { error: "custom_category_collision" } });
  });

  it("keeps every beta-exposed mutating tool inside the atomic dispatcher", () => {
    const exposedMutations = BETA_SAFE_TOOLS
      .map((tool) => tool.name)
      .filter(isMutatingTool);
    expect(exposedMutations.filter((name) => !AMORA_ATOMIC_TOOL_NAMES.has(name)))
      .toEqual([]);
  });

  it("exposes canonical HH:mm time fields for schedule add and update tools", () => {
    for (const name of ["add_schedule_event", "update_schedule_event"]) {
      const tool = BETA_SAFE_TOOLS.find((candidate) => candidate.name === name);
      expect(tool?.input_schema.properties).toMatchObject({
        time: {
          type: "string",
          description: expect.stringContaining("HH:mm"),
        },
      });
    }
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

  it("keeps untouched fixed and custom budgets and recalculates only the actual remainder", () => {
    const ctx = context();
    ctx.weddingContext.progress = {
      ...ctx.weddingContext.progress,
      ring: { category: "ring", status: "completed", budget: 5_000_000, spent: 4_000_000 },
      custom_ride: { category: "custom_ride", label: "차량 이동", status: "in_progress", budget: 1_000_000 },
    } as ToolExecutionContext["weddingContext"]["progress"];
    const untouched = structuredClone(ctx.weddingContext.progress);
    const operation = buildAmoraAtomicToolOperation("apply_budget_plan", {
      total_budget: 50_000_000, allocations: [{ category: "venue", budget: 20_000_000 }],
    }, ctx);
    expectAtomicSuccess(operation);
    applyAmoraAtomicToolResultToContext(operation.result, ctx);
    expect(ctx.weddingContext.progress.ring).toEqual(untouched.ring);
    expect(ctx.weddingContext.progress.custom_ride).toEqual(untouched.custom_ride);
    expect(ctx.weddingContext.progress.reserve).toMatchObject({ budget: 24_000_000 });
    expect(operation.result.toolOutput.remainder_to_reserve).toBe(24_000_000);
  });

  it("explicitly zeroes a former remainder when the new plan uses the whole total", () => {
    const ctx = context();
    Object.assign(ctx.weddingContext.progress, { reserve: { category: "reserve", status: "in_progress", budget: 30_000_000, spent: 1_000_000 } });
    const operation = buildAmoraAtomicToolOperation("apply_budget_plan", {
      total_budget: 50_000_000, allocations: [{ category: "venue", budget: 50_000_000 }],
    }, ctx);
    expectAtomicSuccess(operation);
    applyAmoraAtomicToolResultToContext(operation.result, ctx);
    expect(ctx.weddingContext.progress.reserve).toMatchObject({ budget: 0, spent: 1_000_000, status: "in_progress" });
  });

  it.each([
    { allocations: [{ category: "venue", budget: 48_000_000 }] },
    { allocations: [{ category: "venue", budget: 40_000_000 }, { category: "reserve", budget: 8_000_000 }] },
  ])("does not lower an explicit reserve or discard retained budgets to fit the total (%j)", ({ allocations }) => {
    const ctx = context();
    Object.assign(ctx.weddingContext.progress, { ring: { category: "ring", status: "not_started", budget: 5_000_000 } });
    const before = structuredClone(ctx.weddingContext);
    const operation = buildAmoraAtomicToolOperation("apply_budget_plan", { total_budget: 50_000_000, allocations }, ctx);
    expect(operation.result.success).toBe(false);
    expect(operation.domainMutation).toEqual({ kind: "none" });
    expect(ctx.weddingContext).toEqual(before);
  });

  it("can apply a reserve-only or changed-total plan without replacing existing allocations", () => {
    const ctx = context();
    const operation = buildAmoraAtomicToolOperation("apply_budget_plan", {
      total_budget: 30_000_000, allocations: [{ category: "reserve", budget: 5_000_000 }],
    }, ctx);
    expectAtomicSuccess(operation);
    applyAmoraAtomicToolResultToContext(operation.result, ctx);
    expect(ctx.weddingContext.budget).toBe(30_000_000);
    expect(ctx.weddingContext.progress.venue).toMatchObject({ budget: 10_000_000 });
    expect(ctx.weddingContext.progress.reserve).toMatchObject({ budget: 20_000_000 });
    expect(operation.result.toolOutput.remainder_to_reserve).toBe(15_000_000);
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

  it("keeps add_schedule_event truthful by adding instead of silently replacing a category event", () => {
    const ctx = context();
    const existing = {
      id: "evt_existing_dress",
      date: "2027-02-10",
      title: "드레스·예식 정장",
      categoryKey: "dress",
      sourceKey: "category:dress",
      status: "planned" as const,
      createdAt: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:00:00.000Z",
    };
    ctx.weddingContext.progress = {
      __events: [existing],
    } as unknown as ToolExecutionContext["weddingContext"]["progress"];

    const operation = buildAmoraAtomicToolOperation(
      "add_schedule_event",
      {
        date: "2027-02-17",
        time: "14:30",
        title: "드레스 최종 피팅",
        category_key: "dress",
      },
      ctx,
    );

    expectAtomicSuccess(operation);
    expect(operation.domainMutation).toMatchObject({
      kind: "journey_progress_key_cas",
      key: "__events",
      value: [
        existing,
        expect.objectContaining({
          date: "2027-02-17",
          time: "14:30",
          title: "드레스 최종 피팅",
          categoryKey: "dress",
        }),
      ],
    });
    expect(operation.result.toolOutput).not.toHaveProperty("upserted");
    expect(operation.result.displayMessage).toContain("추가했어요");
  });

  it("records the exact previous schedule event and rejects timestamp-only updates", () => {
    const ctx = context();
    const existing = {
      id: "evt_existing",
      date: "2027-02-10",
      title: "상견례",
      memo: "장소 확인 전",
      createdAt: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:00:00.000Z",
    };
    ctx.weddingContext.progress = {
      __events: [existing],
    } as unknown as ToolExecutionContext["weddingContext"]["progress"];

    const changed = buildAmoraAtomicToolOperation(
      "update_schedule_event",
      { event_id: existing.id, date: "2027-02-11", time: "15:00" },
      ctx,
    );
    expectAtomicSuccess(changed);
    expect(changed.result.toolOutput).toMatchObject({
      previous_event: existing,
      event: { id: existing.id, date: "2027-02-11", time: "15:00" },
      updates: { date: "2027-02-11", time: "15:00" },
    });

    const noChange = buildAmoraAtomicToolOperation(
      "update_schedule_event",
      { event_id: existing.id, title: existing.title },
      ctx,
    );
    expect(noChange.domainMutation).toEqual({ kind: "none" });
    expect(noChange.result).toMatchObject({
      success: false,
      toolOutput: { error: "no_change" },
    });
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
