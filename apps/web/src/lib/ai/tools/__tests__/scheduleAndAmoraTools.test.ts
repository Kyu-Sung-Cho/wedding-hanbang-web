import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ToolExecutionContext } from "../toolTypes";
import {
  executeAddScheduleEvent,
  executeDeleteScheduleEvent,
  executeGetScheduleEvents,
  executeGetScheduleSummary,
  executeLogWeddingEvent,
  executeToggleChecklistItem,
  executeUpdateScheduleEvent,
  isPastScheduleDate,
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
  count?: number;
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
  in() { return this; }
  order() { return this; }
  limit() { return this; }
  range() { return this; }

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
    const response = result ?? { data: [], error: null };
    return Promise.resolve({ count: Array.isArray(response.data) ? response.data.length : 0, ...response }).then(onfulfilled, onrejected);
  }
}

function mockAdminClient(tableHandlers: Record<string, TableHandler[]>) {
  const admin = {
    from: vi.fn((table: string) => {
      const handler = tableHandlers[table]?.shift() ?? {};
      return new FakeQuery(handler);
    }),
    rpc: vi.fn((name: string, args: Record<string, unknown>) => {
      if (name === "apply_journey_progress_patch") {
        return Promise.resolve({ data: args.p_patch, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    }),
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

function scheduleEvent(index: number) {
  return {
    id: `event-${index}`,
    date: "2027-04-30",
    title: `Event ${index}`,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
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
      total: CATEGORY_CHECKLISTS.length,
      progress_percent: Math.round(100 / CATEGORY_CHECKLISTS.length),
    });
    expect(result.toolOutput.completed).toEqual(
      expect.arrayContaining(["결혼식장"]),
    );
    expect(result.toolOutput.in_progress).toEqual(
      expect.arrayContaining(["웨딩 사진 촬영"]),
    );
  });

  it("adds schedule events through the shared progress patch path", async () => {
    mockAdminClient({});

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
    expect(ctx.weddingContext.progress).toMatchObject({
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

  it("persists a canonical local time and appends a same-category event", async () => {
    mockAdminClient({});
    const existing = {
      ...scheduleEvent(1),
      categoryKey: "dress",
      sourceKey: "category:dress",
    };
    const ctx = createContext({ __events: [existing] });

    const result = await executeAddScheduleEvent(
      {
        date: "2027-02-17",
        time: "14:30",
        title: "드레스 최종 피팅",
        category_key: "dress",
      },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(ctx.weddingContext.progress.__events).toEqual([
      existing,
      expect.objectContaining({
        date: "2027-02-17",
        time: "14:30",
        title: "드레스 최종 피팅",
        categoryKey: "dress",
      }),
    ]);
    expect(result.toolOutput).not.toHaveProperty("upserted");
  });

  it.each(["24:00", "9:30", "14:60"])(
    "rejects the invalid schedule time %s before persistence",
    async (time) => {
      const result = await executeAddScheduleEvent(
        { date: "2027-02-17", time, title: "드레스 피팅" },
        createContext({}),
      );

      expect(result).toMatchObject({
        success: false,
        toolOutput: { error: "invalid_schedule_event", field: "time" },
      });
      expect(createAdminClient).not.toHaveBeenCalled();
    },
  );

  it.each(["2027-02-29", "2027-02-31", "2027-04-31"])(
    "rejects the nonexistent add_schedule_event date %s before persistence",
    async (date) => {
      const result = await executeAddScheduleEvent(
        { date, title: "Invalid calendar day" },
        createContext({}),
      );

      expect(result).toMatchObject({
        success: false,
        toolOutput: { error: "invalid_date", received: date },
      });
      expect(createAdminClient).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{ date: "2027-05-01", title: "   " }, "title"],
    [{ date: "2027-05-01", title: "Valid", memo: "m".repeat(2_001) }, "memo"],
  ] as const)("rejects an invalid add_schedule_event field: %s", async (input, field) => {
    const result = await executeAddScheduleEvent(input, createContext({}));

    expect(result).toMatchObject({
      success: false,
      toolOutput: { error: "invalid_schedule_event", field },
    });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects a nonexistent update_schedule_event date before persistence", async () => {
    const existing = {
      id: "event-1",
      date: "2027-04-30",
      title: "Valid event",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    };
    const result = await executeUpdateScheduleEvent(
      { event_id: existing.id, date: "2027-04-31" },
      createContext({ __events: [existing] }),
    );

    expect(result).toMatchObject({
      success: false,
      toolOutput: { error: "invalid_date", received: "2027-04-31" },
    });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("records update before/after and refuses a no-op update", async () => {
    mockAdminClient({});
    const existing = { ...scheduleEvent(1), time: "13:00" };
    const ctx = createContext({ __events: [existing] });

    const changed = await executeUpdateScheduleEvent(
      { event_id: existing.id, time: "14:30" },
      ctx,
    );

    expect(changed).toMatchObject({
      success: true,
      toolOutput: {
        previous_event: existing,
        event: { id: existing.id, time: "14:30" },
        updates: { time: "14:30" },
      },
    });

    vi.clearAllMocks();
    const noChange = await executeUpdateScheduleEvent(
      { event_id: existing.id, time: "14:30" },
      ctx,
    );
    expect(noChange).toMatchObject({
      success: false,
      toolOutput: { error: "no_change" },
    });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("returns actionable not-found copy without internal schedule or checklist IDs", async () => {
    const internalId = "018f4dc8-3ac1-7f31-9c45-1b8b46bf6e89";
    const results = await Promise.all([
      executeUpdateScheduleEvent(
        { event_id: internalId, title: "수정" },
        createContext({}),
      ),
      executeDeleteScheduleEvent(
        { event_id: internalId, confirmed: true },
        createContext({}),
      ),
      executeToggleChecklistItem(
        { category: "venue", item_id: internalId, done: true },
        createContext({}),
      ),
    ]);

    expect(results.map((result) => result.displayMessage)).toEqual([
      "수정할 일정을 찾지 못했어요. 일정 목록을 새로 불러온 뒤 다시 선택해 주세요.",
      "일정은 기록 보호를 위해 삭제하지 않아요. 취소 상태로 남겨 주세요.",
      "변경할 체크리스트 항목을 찾지 못했어요. 진행 현황을 새로 불러온 뒤 다시 선택해 주세요.",
    ]);
    for (const result of results) {
      expect(result.success).toBe(false);
      expect(result.displayMessage).not.toContain(internalId);
      expect(result.displayMessage).not.toContain("ID:");
    }
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it.each([
    [{ title: "   " }, "title"],
    [{ memo: "m".repeat(2_001) }, "memo"],
  ] as const)("rejects an invalid update_schedule_event field: %s", async (updates, field) => {
    const existing = scheduleEvent(1);
    const result = await executeUpdateScheduleEvent(
      { event_id: existing.id, ...updates },
      createContext({ __events: [existing] }),
    );

    expect(result).toMatchObject({
      success: false,
      toolOutput: { error: "invalid_schedule_event", field },
    });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects a nonexistent log_wedding_event date before persistence", async () => {
    const result = await executeLogWeddingEvent(
      { moment_type: "dress_tour", date: "2027-02-29" },
      createContext({}),
    );

    expect(result).toMatchObject({
      success: false,
      toolOutput: { error: "invalid_date", received: "2027-02-29" },
    });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("reports only the persisted event without promising unavailable outbound care", async () => {
    mockAdminClient({});

    const result = await executeLogWeddingEvent(
      { moment_type: "dress_tour", date: "2027-05-01", title: "드레스 투어" },
      createContext({}),
    );

    expect(result.success).toBe(true);
    expect(result.displayMessage).toBe('2027-05-01 "드레스 투어" 일정을 저장했어요.');
    expect(result.displayMessage).not.toContain("먼저 챙길게요");
    expect(result.displayMessage).not.toContain("3일 전");
  });

  it("returns an explicit capacity error instead of persisting event 501", async () => {
    const events = Array.from({ length: 500 }, (_, index) => scheduleEvent(index));
    const result = await executeAddScheduleEvent(
      { date: "2027-05-01", title: "Event 501" },
      createContext({ __events: events }),
    );

    expect(result).toMatchObject({
      success: false,
      toolOutput: { error: "schedule_capacity_exceeded", limit: 500 },
    });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("returns the same capacity error when log_wedding_event would create event 501", async () => {
    const events = Array.from({ length: 500 }, (_, index) => scheduleEvent(index));
    const result = await executeLogWeddingEvent(
      { moment_type: "dress_tour", date: "2027-05-01" },
      createContext({ __events: events }),
    );

    expect(result).toMatchObject({
      success: false,
      toolOutput: { error: "schedule_capacity_exceeded", limit: 500 },
    });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects nonexistent get_schedule_events range dates without throwing", () => {
    const result = executeGetScheduleEvents(
      { from_date: "2027-02-29", to_date: "2027-04-31" },
      createContext({}),
    );

    expect(result).toMatchObject({
      success: false,
      toolOutput: { error: "invalid_date_range" },
    });
  });
});

describe("amoraActionTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not report an empty successful list when the action store read fails", async () => {
    mockAdminClient({
      amora_actions: [{ awaitResult: { data: null, error: { code: "57014", message: "query timed out" } } }],
    });
    const result = await executeGetAmoraActions({ status: "open" }, createContext({}));
    expect(result.success).toBe(false);
    expect(result.toolOutput).not.toHaveProperty("count");
    expect(result.displayMessage).not.toContain("없습니다");
  });

  it("retires direct unversioned updates even when the older open card exists behind 81 completed cards", async () => {
    const target = {
      id: "act_old", couple_id: "couple-1", title: "Old unfinished card", status: "open",
      priority: "medium", source: "chat", created_at: "2026-01-01", updated_at: "2026-01-01",
    };
    mockAdminClient({
      amora_actions: [
        {
          awaitResult: { data: Array.from({ length: 81 }, (_, index) => ({ ...target, id: `act_new_${index}`, status: "done" })), error: null },
          maybeSingleResult: { data: target, error: null },
        },
        { updateResult: { data: { ...target, status: "done" }, error: null } },
      ],
    });
    const result = await executeUpdateAmoraAction({ action_id: "act_old", status: "done" }, createContext({}));
    expect(result).toMatchObject({ success: false, toolOutput: { error_code: "AMORA_ACTION_NON_ATOMIC_MUTATION_RETIRED" } });
    expect(result.toolOutput).not.toHaveProperty("action");
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("does not fall back to a stale legacy card when the canonical lookup fails", async () => {
    mockAdminClient({
      amora_actions: [{ maybeSingleResult: { data: null, error: { code: "42501" } } }],
    });
    const ctx = createContext({ __amora_actions: [{ id: "act_1", title: "Old copy", status: "open" }] });
    const result = await executeUpdateAmoraAction({ action_id: "act_1", status: "done" }, ctx);
    expect(result).toMatchObject({ success: false, toolOutput: { error_code: "AMORA_ACTION_NON_ATOMIC_MUTATION_RETIRED" } });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(ctx.weddingContext.progress).toMatchObject({ __amora_actions: [{ status: "open" }] });
  });

  it("does not resurrect a canonical card deleted between lookup and update", async () => {
    const target = { id: "act_1", title: "Existing card", status: "open", priority: "medium", source: "chat" };
    mockAdminClient({
      amora_actions: [
        { maybeSingleResult: { data: target, error: null } },
        { updateResult: { data: null, error: null } },
      ],
    });
    const ctx = createContext({ __amora_actions: [target] });
    const result = await executeUpdateAmoraAction({ action_id: "act_1", status: "done" }, ctx);
    expect(result.success).toBe(false);
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(ctx.weddingContext.progress).toMatchObject({ __amora_actions: [{ status: "open" }] });
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
          description: "식사 포함 범위와 추가 비용 확인",
          dueDate: "양가 일정 정한 뒤",
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
      source: "table",
      actions: [expect.objectContaining({ id: "act_1", title: "Check quote", description: "식사 포함 범위와 추가 비용 확인", dueDate: "양가 일정 정한 뒤" })],
    });
  });

  it("exposes canonical planning fields to Amora rather than the stale legacy values", async () => {
    mockAdminClient({ amora_actions: [{ awaitResult: { data: [{
      id: "act_plan", title: "식사 견적 확인", description: "직접 적은 준비 설명", due_date: "2026-10-15",
      priority: "medium", status: "open", source: "manual", created_at: "2026-09-09T00:00:00Z", updated_at: "2026-09-09T00:00:00Z",
    }], error: null } }] });
    const result = await executeGetAmoraActions({ status: "all" }, createContext({ __amora_actions: [{
      id: "act_plan", title: "옛 제목", description: "옛 설명", dueDate: "옛 날짜", status: "open",
    }] }));
    expect(result).toMatchObject({ success: true, toolOutput: { actions: [{
      id: "act_plan", title: "식사 견적 확인", description: "직접 적은 준비 설명", dueDate: "2026-10-15", source: "manual",
    }] } });
  });

  it("marks a legacy fallback separately from a successful canonical table read", async () => {
    mockAdminClient({
      amora_actions: [{ awaitResult: { data: null, error: { code: "42P01", message: "relation missing" } } }],
    });
    const result = await executeGetAmoraActions({ status: "all" }, createContext({
      __amora_actions: [{
        id: "legacy-one", title: "예전 기록", status: "open",
        createdAt: "2026-09-09T00:00:00Z", updatedAt: "2026-09-09T00:00:00Z",
      }],
    }));
    expect(result).toMatchObject({
      success: true,
      toolOutput: { source: "legacy", count: 1, truncated: false, actions: [{ id: "legacy-one" }] },
    });
  });

  it("does not update legacy actions or invent success when the old storage path is unavailable", async () => {
    mockAdminClient({
      amora_actions: [
        { maybeSingleResult: { data: null, error: { code: "42P01", message: "relation missing" } } },
        { updateResult: { error: { code: "42P01", message: "relation missing" } } },
      ],
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

    expect(result.success).toBe(false);
    expect(result.toolOutput).toEqual({ error_code: "AMORA_ACTION_NON_ATOMIC_MUTATION_RETIRED" });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(ctx.weddingContext.progress).toMatchObject({
      __amora_actions: [expect.objectContaining({ id: "act_1", status: "open" })],
    });
  });
});

/**
 * 지난 날짜 일정 (2026-09-03).
 *
 * 연도 없는 날짜가 지난 해로 해석돼 저장되거나, 사용자가 "2026년 8월 26일" 처럼 지난
 * 날짜를 그대로 말해도 어디서도 알려주지 않았다. **막지 않고 표시한다** — 지난 일을
 * 기록하려는 요청도 정당해서, 거부하면 그 사람까지 막힌다.
 */
describe("지난 날짜 일정 표시", () => {
  // 2026-09-03 14:00 KST (UTC 로도 같은 날).
  const KST_AFTERNOON = Date.parse("2026-09-03T05:00:00.000Z");
  // 2026-09-04 00:00 KST — UTC 로는 아직 2026-09-03 이다.
  const JUST_AFTER_KST_MIDNIGHT = Date.parse("2026-09-03T15:00:00.000Z");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["2026-09-02", KST_AFTERNOON, true],
    ["2026-09-03", KST_AFTERNOON, false],
    ["2026-09-04", KST_AFTERNOON, false],
    // 한국 자정을 넘겼으니 9-03 은 어제다. UTC 로 잘랐다면 오늘이라 놓쳤을 자리.
    ["2026-09-03", JUST_AFTER_KST_MIDNIGHT, true],
    // 그리고 자정 직후의 오늘은 지난 날짜가 아니다.
    ["2026-09-04", JUST_AFTER_KST_MIDNIGHT, false],
  ] as const)("%s @ %d → %s", (date, nowMs, expected) => {
    expect(isPastScheduleDate(date, nowMs)).toBe(expected);
  });

  it.each([undefined, null, 20260826, "26-08-26", "2026-8-26", ""])(
    "날짜 모양이 아니면 판정하지 않는다: %s",
    (date) => {
      expect(isPastScheduleDate(date, KST_AFTERNOON)).toBe(false);
    },
  );

  it("같은 payload 라도 오늘 이전이면 실행 결과에 표식이 붙고, 이후면 안 붙는다", async () => {
    const input = { date: "2026-08-26", title: "상견례" };

    vi.useFakeTimers();
    vi.setSystemTime(KST_AFTERNOON);
    mockAdminClient({});
    const past = await executeAddScheduleEvent(input, createContext({}));

    // 저장은 그대로 성공한다 — 표시만 한다.
    expect(past.success).toBe(true);
    expect(past.toolOutput).toMatchObject({ past_date: true });

    // 같은 날짜인데 시계가 그 전이면 지난 날짜가 아니다.
    vi.setSystemTime(Date.parse("2026-08-01T05:00:00.000Z"));
    mockAdminClient({});
    const future = await executeAddScheduleEvent(input, createContext({}));

    expect(future.success).toBe(true);
    expect(future.toolOutput).not.toHaveProperty("past_date");
  });

  it("일정 날짜를 지난 날짜로 바꿀 때도 실행 결과가 그렇게 말한다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(KST_AFTERNOON);
    const existing = { ...scheduleEvent(1), date: "2027-04-30" };

    mockAdminClient({});
    const past = await executeUpdateScheduleEvent(
      { event_id: existing.id, date: "2026-08-26" },
      createContext({ __events: [existing] }),
    );

    expect(past.success).toBe(true);
    expect(past.toolOutput).toMatchObject({ past_date: true });

    mockAdminClient({});
    const ahead = await executeUpdateScheduleEvent(
      { event_id: existing.id, date: "2026-09-26" },
      createContext({ __events: [existing] }),
    );

    expect(ahead.success).toBe(true);
    expect(ahead.toolOutput).not.toHaveProperty("past_date");
  });
});
