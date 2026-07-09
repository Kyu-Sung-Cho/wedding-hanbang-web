import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ToolExecutionContext } from "../toolTypes";
import {
  executeAddScheduleEvent,
  executeGetScheduleEvents,
  executeGetScheduleSummary,
} from "../scheduleTools";
import {
  executeGetAmoraActions,
  executeUpdateAmoraAction,
} from "../amoraActionTools";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

type QueryResult = {
  data?: unknown;
  error?: unknown;
};

type TableHandler = {
  awaitResult?: QueryResult;
  maybeSingleResult?: QueryResult;
  updateResult?: QueryResult;
  onUpdate?: (payload: unknown) => void;
};

class FakeQuery {
  private operation: "read" | "update" = "read";

  constructor(private readonly handler: TableHandler) {}

  select() { return this; }
  eq() { return this; }
  order() { return this; }
  limit() { return this; }

  update(payload: unknown) {
    this.operation = "update";
    this.handler.onUpdate?.(payload);
    return this;
  }

  maybeSingle(): Promise<QueryResult> {
    return Promise.resolve(
      this.handler.maybeSingleResult ??
      (this.operation === "update" ? this.handler.updateResult : this.handler.awaitResult) ??
      { data: null, error: null }
    );
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    const result = this.operation === "update"
      ? this.handler.updateResult
      : this.handler.awaitResult;
    return Promise.resolve(result ?? { data: [], error: null }).then(onfulfilled, onrejected);
  }
}

function mockAdminClient(tableHandlers: Record<string, TableHandler[]>) {
  const admin = {
    from: vi.fn((table: string) => {
      const handler = tableHandlers[table]?.shift() ?? {};
      return new FakeQuery(handler);
    }),
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
  };
  vi.mocked(createAdminClient).mockReturnValue(
    admin as unknown as ReturnType<typeof createAdminClient>
  );
}

function createContext(progress: Record<string, unknown>): ToolExecutionContext {
  return {
    coupleId: "couple-1",
    weddingContext: {
      weddingDate: "2026-10-10",
      budget: 50_000_000,
      venue: null,
      progress: progress as unknown as ToolExecutionContext["weddingContext"]["progress"],
    },
  };
}

describe("scheduleTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps schedule summary counts derived from category progress", () => {
    const result = executeGetScheduleSummary(
      createContext({
        venue: { category: "venue", status: "completed" },
        studio: { category: "studio", status: "in_progress" },
      })
    );

    expect(result.success).toBe(true);
    expect(result.toolOutput).toMatchObject({
      total: 19,
      progress_percent: 5,
    });
    expect(result.toolOutput.completed).toEqual(expect.arrayContaining(["예식장"]));
    expect(result.toolOutput.in_progress).toEqual(expect.arrayContaining(["스튜디오"]));
  });

  it("adds schedule events through the shared progress patch path", async () => {
    let updatedProgress: Record<string, unknown> | null = null;
    mockAdminClient({
      wedding_journeys: [{
        onUpdate: (payload) => {
          updatedProgress = (payload as { progress?: Record<string, unknown> }).progress ?? null;
        },
        updateResult: { error: null },
      }],
    });

    const ctx = createContext({});
    const result = await executeAddScheduleEvent(
      {
        date: "2026-07-06",
        title: "Studio consult",
        category_key: "studio",
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(updatedProgress).toMatchObject({
      __events: [expect.objectContaining({
        date: "2026-07-06",
        title: "Studio consult",
        categoryKey: "studio",
        sourceKey: "category:studio",
      })],
    });
    expect(executeGetScheduleEvents({ from_date: "2026-07-01", to_date: "2026-07-31" }, ctx).toolOutput)
      .toMatchObject({ count: 1 });
  });
});

describe("amoraActionTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads legacy mirrored actions when action storage has no rows", async () => {
    mockAdminClient({
      amora_actions: [{ awaitResult: { data: [], error: null } }],
    });

    const result = await executeGetAmoraActions(
      { status: "open" },
      createContext({
        __amora_actions: [{
          id: "act_1",
          title: "Check quote",
          priority: "high",
          status: "open",
          source: "quote",
          href: "/wedding/community/quote-check",
          createdAt: "2026-06-30T00:00:00.000Z",
          updatedAt: "2026-06-30T00:00:00.000Z",
        }],
      })
    );

    expect(result.success).toBe(true);
    expect(result.toolOutput).toMatchObject({
      count: 1,
      open_count: 1,
      actions: [expect.objectContaining({ id: "act_1", title: "Check quote" })],
    });
  });

  it("updates legacy actions when storage is unavailable", async () => {
    let updatedProgress: Record<string, unknown> | null = null;
    mockAdminClient({
      amora_actions: [
        { awaitResult: { data: [], error: null } },
        { updateResult: { error: { code: "42P01", message: "relation missing" } } },
      ],
      wedding_journeys: [{
        onUpdate: (payload) => {
          updatedProgress = (payload as { progress?: Record<string, unknown> }).progress ?? null;
        },
        updateResult: { error: null },
      }],
    });

    const ctx = createContext({
      __amora_actions: [{
        id: "act_1",
        title: "Check quote",
        priority: "high",
        status: "open",
        source: "quote",
        href: "/wedding/community/quote-check",
        createdAt: "2026-06-30T00:00:00.000Z",
        updatedAt: "2026-06-30T00:00:00.000Z",
      }],
    });

    const result = await executeUpdateAmoraAction(
      { action_id: "act_1", status: "done" },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.toolOutput.action).toMatchObject({
      id: "act_1",
      status: "done",
    });
    expect(updatedProgress).toMatchObject({
      __amora_actions: [expect.objectContaining({ id: "act_1", status: "done" })],
    });
  });
});
