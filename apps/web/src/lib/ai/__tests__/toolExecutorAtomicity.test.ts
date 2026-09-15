import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    rpc: mocks.rpc,
    from: mocks.from,
  })),
}));

import { executeTool } from "@/lib/ai/toolExecutor";

function context(): ToolExecutionContext {
  return {
    coupleId: "10000000-0000-4000-8000-000000000001",
    actorProfileId: "20000000-0000-4000-8000-000000000001",
    requestKey:
      "chat:20000000-0000-4000-8000-000000000001:30000000-0000-4000-8000-000000000001",
    requestAttemptCount: 1,
    providerCallIndex: 1,
    currentUserText: "총예산을 3천만원으로 바꿔줘",
    weddingContext: {
      weddingDate: null,
      budget: 50_000_000,
      venue: null,
      progress: {},
    },
  };
}

describe("Amora atomic mutating-tool execution", () => {
  it("never sends explicit allocations through the legacy auto-reserve RPC", async () => {
    const ctx = context();
    delete ctx.providerCallIndex;
    const reserve = { category: "reserve", budget: 2_000_000, status: "completed", spent: 123_000 };
    ctx.weddingContext.progress = {reserve} as ToolExecutionContext["weddingContext"]["progress"];
    const input = {total_budget:50_000_000,allocation_mode:"explicit",allocations:[{category:"studio",budget:3_000_000}]};
    const result = await executeTool("apply_budget_plan", input, ctx);
    expect(result).toMatchObject({success:true,toolOutput:{allocations:input.allocations,remainder_to_reserve:0,applied_count:1}});
    expect(ctx.weddingContext.progress.reserve).toEqual(reserve);
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["claim_amora_tool_execution","apply_amora_atomic_tool_execution"]);
    expect(mocks.rpc).toHaveBeenCalledWith("apply_amora_atomic_tool_execution",expect.objectContaining({
      p_tool_input:input,p_domain_mutation:expect.objectContaining({expectedReserveBudget:2_000_000}),
    }));
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.from.mockReturnValue({ update: mocks.update });
    mocks.rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
      if (name === "claim_amora_tool_execution") {
        return Promise.resolve({ data: { action: "acquired" }, error: null });
      }
      if (name === "apply_amora_atomic_tool_execution") {
        return Promise.resolve({ data: args.p_result, error: null });
      }
      return Promise.resolve({
        data: null,
        error: { message: `unexpected rpc: ${name}` },
      });
    });
  });

  it("commits a budget mutation and its durable ledger result in one RPC", async () => {
    const ctx = context();

    const result = await executeTool(
      "update_budget",
      { total_budget: 30_000_000 },
      ctx,
    );

    expect(result).toMatchObject({
      success: true,
      toolOutput: {
        total_budget: 30_000_000,
        previous_budget: 50_000_000,
      },
    });
    expect(ctx.weddingContext.budget).toBe(30_000_000);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "claim_amora_tool_execution",
      expect.objectContaining({
        p_pending_action_id: null,
        p_provider_call_index: 1,
      }),
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      "apply_amora_atomic_tool_execution",
      expect.objectContaining({
        p_tool_input: { total_budget: 30_000_000 },
        p_domain_mutation: {
          kind: "journey_total_budget_cas",
          expected: 50_000_000,
          value: 30_000_000,
        },
      }),
    );
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls.map(([name]) => name)).not.toContain(
      "complete_amora_tool_execution",
    );
  });

  it("selects the atomic claim overload for a server-confirmed action", async () => {
    const ctx = context();
    delete ctx.providerCallIndex;
    ctx.pendingActionId = "11111111-1111-4111-8111-111111111111";

    await expect(executeTool(
      "update_budget",
      { total_budget: 30_000_000 },
      ctx,
    )).resolves.toMatchObject({ success: true });

    expect(mocks.rpc).toHaveBeenCalledWith(
      "claim_amora_tool_execution",
      expect.objectContaining({
        p_pending_action_id: ctx.pendingActionId,
        p_provider_call_index: null,
      }),
    );
  });

  it("restores in-memory wedding context when a completed atomic result is replayed", async () => {
    const ctx = context();
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "claim_amora_tool_execution") {
        return Promise.resolve({
          data: {
            action: "completed",
            result: {
              toolName: "update_budget",
              toolOutput: {
                total_budget: 30_000_000,
                previous_budget: 50_000_000,
              },
              success: true,
              displayMessage: "총예산을 변경했어요.",
            },
          },
          error: null,
        });
      }
      return Promise.resolve({
        data: null,
        error: { message: `unexpected rpc: ${name}` },
      });
    });

    const result = await executeTool(
      "update_budget",
      { total_budget: 30_000_000 },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(ctx.weddingContext.budget).toBe(30_000_000);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("fails the turn instead of claiming failure when atomic commit outcome is unknown", async () => {
    const ctx = context();
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "claim_amora_tool_execution") {
        return Promise.resolve({ data: { action: "acquired" }, error: null });
      }
      if (name === "apply_amora_atomic_tool_execution") {
        return Promise.resolve({
          data: null,
          error: { message: "simulated response loss" },
        });
      }
      return Promise.resolve({
        data: null,
        error: { message: `unexpected rpc: ${name}` },
      });
    });

    await expect(executeTool(
      "update_budget",
      { total_budget: 30_000_000 },
      ctx,
    )).rejects.toThrow(/atomic commit outcome unavailable/);
    expect(mocks.rpc.mock.calls.filter(([name]) =>
      name === "apply_amora_atomic_tool_execution")).toHaveLength(3);
    expect(ctx.weddingContext.budget).toBe(50_000_000);
  });

  // 리뷰 [7]: 웹이 DB 마이그레이션(20260915101500)보다 먼저 나가면 '안 해요' 분야가 든 예산 쓰기를
  // 옛 DB 함수가 22023 AMORA_ATOMIC_BUDGET_PLAN_ENTRY_INVALID 로 거절한다. 그 거절은 트랜잭션이
  // 롤백된 결정적 미적용이라 재시도해도 같고, "결과 불명" 으로 턴을 깨뜨릴 이유가 없다.
  describe("deterministic atomic invalid-input rejection", () => {
    const notApplicablePlan = {
      total_budget: 35_000_000,
      allocation_mode: "explicit",
      allocations: [
        { category: "hanbok", budget: 1_500_000 },
        { category: "yedan", budget: 2_000_000 },
      ],
    };
    function notApplicableContext() {
      const ctx = context();
      delete ctx.providerCallIndex;
      ctx.pendingActionId = "11111111-1111-4111-8111-111111111111";
      ctx.weddingContext.budget = 35_000_000;
      ctx.weddingContext.progress = {
        hanbok: { category: "hanbok", status: "not_applicable" },
        yedan: { category: "yedan", status: "not_applicable" },
      } as unknown as ToolExecutionContext["weddingContext"]["progress"];
      return ctx;
    }
    function rejectDomainMutation(error: { code?: string; message: string }, noOpResponse?: { data: unknown; error: unknown }) {
      mocks.rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
        if (name === "claim_amora_tool_execution") {
          return Promise.resolve({ data: { action: "acquired" }, error: null });
        }
        if (name === "apply_amora_atomic_tool_execution") {
          const mutation = args.p_domain_mutation as { kind?: string };
          if (mutation.kind === "none") {
            return Promise.resolve(noOpResponse ?? { data: args.p_result, error: null });
          }
          return Promise.resolve({ data: null, error });
        }
        return Promise.resolve({ data: null, error: { message: `unexpected rpc: ${name}` } });
      });
    }
    const applyCalls = () => mocks.rpc.mock.calls.filter(([name]) => name === "apply_amora_atomic_tool_execution");

    it("ends a pre-migration not_applicable budget rejection as a recorded no-op instead of a crash", async () => {
      const ctx = notApplicableContext();
      const before = structuredClone(ctx.weddingContext);
      rejectDomainMutation({ code: "22023", message: "AMORA_ATOMIC_BUDGET_PLAN_ENTRY_INVALID" });

      const result = await executeTool("apply_budget_plan", notApplicablePlan, ctx);

      expect(result).toMatchObject({
        success: false,
        toolOutput: { error: "ATOMIC_MUTATION_REJECTED", retryable: false },
      });
      expect(result.displayMessage).toContain("적용하지 않았어요");
      expect(result.displayMessage).toContain("아무것도 바뀌지 않았어요");
      expect(result.displayMessage).not.toMatch(/AMORA_|22023|죄송|파트너|반영했|적용했/u);
      // 거절된 변경은 한 번만 보내고, 같은 원장 항목을 '적용하지 않음' 결과로 닫는다.
      expect(applyCalls()).toHaveLength(2);
      expect(applyCalls()[0][1]).toMatchObject({ p_domain_mutation: expect.objectContaining({ kind: expect.not.stringMatching(/^none$/) }) });
      expect(applyCalls()[1][1]).toMatchObject({
        p_tool_input: notApplicablePlan,
        p_domain_mutation: { kind: "none" },
        p_result: { toolName: "apply_budget_plan", success: false, toolOutput: { error: "ATOMIC_MUTATION_REJECTED", retryable: false } },
      });
      expect(ctx.weddingContext).toEqual(before);
    });

    it.each([
      ["AMORA_ATOMIC_CHECKLIST_STATUS_INVALID", "toggle_checklist_item"],
      ["AMORA_ATOMIC_WEDDING_DATE_INVALID", "update_wedding_date"],
    ])("treats any %s rejection the same way", async (message, tool) => {
      const ctx = context();
      const input = tool === "update_wedding_date"
        ? { wedding_date: "2027-05-01" }
        : { category: "hanbok", item_id: "hanbok_03", done: true };
      rejectDomainMutation({ code: "22023", message });
      const result = await executeTool(tool, input, ctx);
      expect(result).toMatchObject({ success: false, toolOutput: { error: "ATOMIC_MUTATION_REJECTED" } });
      expect(applyCalls()).toHaveLength(2);
    });

    it.each([
      ["no SQLSTATE (response loss)", { message: "AMORA_ATOMIC_BUDGET_PLAN_ENTRY_INVALID" }],
      ["claim stale (40001)", { code: "40001", message: "AMORA_ATOMIC_TOOL_CLAIM_STALE" }],
      ["22023 envelope error", { code: "22023", message: "AMORA_ATOMIC_TOOL_INVALID_INPUT" }],
      ["22023 from another boundary", { code: "22023", message: "AMORA_SHARED_ACTION_CONFIRMATION_INVALID" }],
      ["22023 with an unrelated prefix", { code: "22023", message: "NOT_AMORA_ATOMIC_BUDGET_PLAN_ENTRY_INVALID" }],
    ])("keeps retrying and fails the turn when the outcome is not a deterministic invalid rejection: %s", async (_label, error) => {
      const ctx = notApplicableContext();
      rejectDomainMutation(error);
      await expect(executeTool("apply_budget_plan", notApplicablePlan, ctx))
        .rejects.toThrow(/atomic commit outcome unavailable/);
      expect(applyCalls()).toHaveLength(3);
      expect(applyCalls().every(([, args]) => (args.p_domain_mutation as { kind: string }).kind !== "none")).toBe(true);
    });

    it("fails the turn as before when the no-op result itself cannot be recorded", async () => {
      const ctx = notApplicableContext();
      rejectDomainMutation(
        { code: "22023", message: "AMORA_ATOMIC_BUDGET_PLAN_ENTRY_INVALID" },
        { data: null, error: { code: "40001", message: "AMORA_ATOMIC_TOOL_CLAIM_STALE" } },
      );
      await expect(executeTool("apply_budget_plan", notApplicablePlan, ctx))
        .rejects.toThrow(/atomic commit outcome unavailable/);
      expect(applyCalls()).toHaveLength(2);
    });

    it("replays an already-committed result when the no-op commit finds the operation completed", async () => {
      const ctx = notApplicableContext();
      const committed = { toolName: "apply_budget_plan", toolOutput: { error: "ATOMIC_MUTATION_REJECTED", retryable: false }, success: false, displayMessage: "기록된 결과" };
      rejectDomainMutation(
        { code: "22023", message: "AMORA_ATOMIC_BUDGET_PLAN_ENTRY_INVALID" },
        { data: committed, error: null },
      );
      await expect(executeTool("apply_budget_plan", notApplicablePlan, ctx)).resolves.toMatchObject({
        success: false, displayMessage: "기록된 결과",
      });
    });
  });

  it("commits a schedule event and its durable result through the same atomic dispatcher", async () => {
    const ctx = context();

    const result = await executeTool(
      "add_schedule_event",
      { date: "2027-03-12", title: "드레스 투어" },
      ctx,
    );

    expect(result).toMatchObject({
      success: true,
      toolOutput: {
        event: {
          date: "2027-03-12",
          title: "드레스 투어",
        },
      },
    });
    const atomicCall = mocks.rpc.mock.calls.find(([name]) =>
      name === "apply_amora_atomic_tool_execution");
    expect(atomicCall?.[1]).toMatchObject({
      p_domain_mutation: {
        kind: "journey_progress_key_cas",
        key: "__events",
        expectedPresent: false,
        value: [expect.objectContaining({
          date: "2027-03-12",
          title: "드레스 투어",
        })],
      },
    });
    expect(ctx.weddingContext.progress.__events).toEqual(
      expect.arrayContaining([expect.objectContaining({ title: "드레스 투어" })]),
    );
    expect(mocks.rpc.mock.calls.map(([name]) => name)).not.toContain(
      "apply_journey_progress_patch",
    );
    expect(mocks.rpc.mock.calls.map(([name]) => name)).not.toContain(
      "complete_amora_tool_execution",
    );
  });

  it("atomically updates an existing schedule event without replacing concurrent state blindly", async () => {
    const ctx = context();
    const event = {
      id: "evt_existing",
      date: "2027-03-12",
      title: "드레스 투어",
      createdAt: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:00:00.000Z",
    };
    const laterEvent = {
      ...event,
      id: "evt_later",
      title: "Venue visit",
    };
    ctx.weddingContext.progress = {
      __events: [event, laterEvent],
    } as unknown as ToolExecutionContext["weddingContext"]["progress"];

    const result = await executeTool(
      "update_schedule_event",
      { event_id: event.id, date: "2027-03-13" },
      ctx,
    );

    expect(result).toMatchObject({
      success: true,
      toolOutput: {
        event: { id: event.id, date: "2027-03-13" },
      },
    });
    const atomicCall = mocks.rpc.mock.calls.find(([name]) =>
      name === "apply_amora_atomic_tool_execution");
    expect(atomicCall?.[1]).toMatchObject({
      p_domain_mutation: {
        kind: "journey_progress_key_cas",
        expectedPresent: true,
        expected: [event, laterEvent],
        value: [expect.objectContaining({
          id: event.id,
          date: "2027-03-13",
        }), laterEvent],
      },
    });
    expect((ctx.weddingContext.progress.__events as unknown as Array<{ id: string }>)
      .map((candidate) => candidate.id)).toEqual([event.id, laterEvent.id]);
  });

  it("blocks every legacy schedule delete before any durable write", async () => {
    const ctx = context();
    const event = {
      id: "evt_delete",
      date: "2027-03-12",
      title: "드레스 투어",
      createdAt: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:00:00.000Z",
    };
    ctx.weddingContext.progress = {
      __events: [event],
    } as unknown as ToolExecutionContext["weddingContext"]["progress"];

    const result = await executeTool(
      "delete_schedule_event",
      { event_id: event.id, confirmed: true },
      ctx,
    );

    expect(result).toMatchObject({
      success: false,
      toolOutput: { error: "legacy_schedule_delete_blocked" },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(ctx.weddingContext.progress.__events).toEqual([event]);
  });

  it("atomically soft-cancels the exact human-readable schedule target", async () => {
    const ctx = context();
    const event = {
      id: "evt_cancel",
      date: "2027-03-12",
      title: "드레스 투어",
      status: "planned",
      createdAt: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:00:00.000Z",
    };
    ctx.weddingContext.progress = {
      __events: [event],
    } as unknown as ToolExecutionContext["weddingContext"]["progress"];
    const input = {
      event_id: event.id,
      expected_title: event.title,
      expected_date: event.date,
      reason: "  업체 일정 변경  ",
    };

    const result = await executeTool("cancel_schedule_event", input, ctx);

    expect(result).toMatchObject({
      success: true,
      toolOutput: {
        event: {
          id: event.id,
          status: "cancelled",
          cancellation: {
            cancelledByProfileId: ctx.actorProfileId,
            reason: "업체 일정 변경",
          },
        },
        previous_event: event,
      },
    });
    const changed = result.toolOutput.event as {
      updatedAt: string;
      cancellation: { cancelledAt: string };
    };
    expect(changed.updatedAt).toBe(changed.cancellation.cancelledAt);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "apply_amora_atomic_tool_execution",
      expect.objectContaining({
        p_tool_input: input,
        p_domain_mutation: expect.objectContaining({
          kind: "journey_progress_key_cas",
          key: "__events",
          expected: [event],
          value: [expect.objectContaining({
            id: event.id,
            status: "cancelled",
          })],
        }),
      }),
    );
    expect(ctx.weddingContext.progress.__events).toEqual([
      expect.objectContaining({ id: event.id, status: "cancelled" }),
    ]);
  });

  it("commits wedding-date changes through the atomic dispatcher instead of a split write", async () => {
    const ctx = context();

    const result = await executeTool(
      "update_wedding_date",
      { wedding_date: "2027-05-01" },
      ctx,
    );

    expect(result).toMatchObject({
      success: true,
      toolOutput: { wedding_date: "2027-05-01", previous_date: null },
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "apply_amora_atomic_tool_execution",
      expect.objectContaining({
        p_domain_mutation: {
          kind: "journey_wedding_date_cas",
          expected: null,
          value: "2027-05-01",
        },
      }),
    );
    expect(mocks.rpc.mock.calls.map(([name]) => name)).not.toContain(
      "complete_amora_tool_execution",
    );
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
