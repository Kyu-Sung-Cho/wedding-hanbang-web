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

  it("atomically deletes a confirmed schedule event and records the deleted value", async () => {
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
      success: true,
      toolOutput: { deleted_event: event },
    });
    const atomicCall = mocks.rpc.mock.calls.find(([name]) =>
      name === "apply_amora_atomic_tool_execution");
    expect(atomicCall?.[1]).toMatchObject({
      p_domain_mutation: {
        kind: "journey_progress_key_cas",
        expected: [event],
        value: [],
      },
    });
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
