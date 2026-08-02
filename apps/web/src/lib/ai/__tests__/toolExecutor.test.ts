import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeTool } from "../toolExecutor";
import type { ToolExecutionContext } from "../tools/toolTypes";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ rpc: mocks.rpc, from: mocks.from })),
}));

// AI 도구층 회귀 잠금 (2026-07-06 전수 감사) — DB 접근 없는 순수 경로만 검증.
// 핵심: 아모라가 사용자에게 말하는 숫자는 전부 실데이터여야 한다(지어낸 지출 금지).

function makeCtx(progress: Record<string, unknown> = {}): ToolExecutionContext {
  return {
    coupleId: "00000000-0000-0000-0000-000000000000",
    requestKey: "chat:00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000002",
    requestAttemptCount: 1,
    currentUserText: "",
    weddingContext: {
      weddingDate: null,
      budget: 50_000_000,
      venue: null,
      progress: progress as ToolExecutionContext["weddingContext"]["progress"],
    },
  };
}

beforeEach(() => {
  mocks.from.mockReset();
  mocks.update.mockReset();
  mocks.eq.mockReset();
  mocks.from.mockReturnValue({ update: mocks.update });
  mocks.update.mockReturnValue({ eq: mocks.eq });
  mocks.eq.mockResolvedValue({ error: null });
  mocks.rpc.mockReset();
  mocks.rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
    if (name === "claim_amora_tool_execution") {
      return Promise.resolve({ data: { action: "acquired" }, error: null });
    }
    if (name === "complete_amora_tool_execution") {
      return Promise.resolve({ data: true, error: null });
    }
    if (name === "apply_amora_atomic_tool_execution") {
      return Promise.resolve({
        data: {
          toolName: "update_budget",
          toolOutput: {
            total_budget: 30_000_000,
            previous_budget: 50_000_000,
          },
          success: true,
          displayMessage: "총예산을 5,000만원에서 3,000만원으로 변경했어요.",
        },
        error: null,
      });
    }
    if (name === "mark_amora_tool_execution_uncertain") {
      return Promise.resolve({ data: true, error: null });
    }
    if (name === "apply_journey_progress_patch") {
      return Promise.resolve({ data: args.p_patch, error: null });
    }
    if (name === "apply_budget_plan_atomic") {
      return Promise.resolve({ data: args.p_progress_patch, error: null });
    }
    return Promise.resolve({ data: null, error: { message: "unexpected rpc" } });
  });
});

describe("get_budget_summary — 실데이터 원칙 (상태 기반 추정 금지)", () => {
  it("기록된 spent만 지출로 보고한다 — 진행중/완료 상태로 지출을 지어내지 않는다", async () => {
    const ctx = makeCtx({
      venue: { category: "venue", status: "in_progress", budget: 20_000_000, spent: 5_000_000 },
      studio: { category: "studio", status: "completed" }, // 완료지만 지출 기록 없음 → 0이어야 함
    });
    const result = await executeTool("get_budget_summary", {}, ctx);
    expect(result.success).toBe(true);

    const out = result.toolOutput as {
      total_spent: number;
      categories: Array<{ key: string; allocated: number; allocated_is_estimate: boolean; spent: number }>;
    };
    expect(out.total_spent).toBe(5_000_000); // 실기록만 — 예전 휴리스틱이면 studio 배정액이 섞여 커짐
    const venue = out.categories.find((c) => c.key === "venue")!;
    expect(venue.allocated).toBe(20_000_000); // 사용자가 설정한 배정액 존중 (비율 무시 금지)
    expect(venue.allocated_is_estimate).toBe(false);
    expect(venue.spent).toBe(5_000_000);
    const studio = out.categories.find((c) => c.key === "studio")!;
    expect(studio.spent).toBe(0);
    expect(studio.allocated_is_estimate).toBe(true); // 미설정 → 참고치임을 명시
  });

  it("참고치 사용 시 메시지에 명시한다", async () => {
    const result = await executeTool("get_budget_summary", {}, makeCtx());
    expect(result.displayMessage).toContain("참고치");
  });

  it("예산을 초과해도 실패하지 않고 초과액을 정확히 안내한다", async () => {
    const result = await executeTool("get_budget_summary", {}, makeCtx({
      venue: { budget: 20_000_000, spent: 60_000_000 },
    }));

    expect(result.success).toBe(true);
    expect(result.toolOutput).toMatchObject({
      total_budget: 50_000_000,
      total_spent: 60_000_000,
      remaining: -10_000_000,
    });
    expect(result.displayMessage).toContain("예산 1,000만원 초과");
  });

  it("손상된 음수·소수 지출값은 금액으로 보고하지 않는다", async () => {
    const result = await executeTool("get_budget_summary", {}, makeCtx({
      venue: { spent: -1 },
      studio: { spent: 1.5 },
    }));

    expect(result.success).toBe(true);
    expect(result.toolOutput.total_spent).toBe(0);
    expect(result.displayMessage).toContain("기록된 지출 0원");
  });
});

describe("get_wedding_info — 손상된 기존 예산 방어", () => {
  it("음수 기존 예산을 사용자나 모델에게 금액으로 노출하지 않는다", async () => {
    const ctx = makeCtx();
    ctx.weddingContext.budget = -1;

    const result = await executeTool("get_wedding_info", {}, ctx);

    expect(result.success).toBe(true);
    expect(result.toolOutput.total_budget).toBe(0);
    expect(result.displayMessage).toContain("예산: 0원");
    expect(result.displayMessage).not.toContain("-1");
  });
});

describe("read tool error boundary", () => {
  it("does not return raw database or stack details to the model/client", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.from.mockImplementation(() => {
      throw new Error("SECRET_DATABASE_CONNECTION_DETAIL");
    });

    const result = await executeTool("get_my_bookings", {}, makeCtx());

    expect(result).toMatchObject({
      success: false,
      toolOutput: { error_code: "TOOL_EXECUTION_FAILED" },
    });
    expect(JSON.stringify(result)).not.toContain("SECRET_DATABASE_CONNECTION_DETAIL");
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("SECRET_DATABASE_CONNECTION_DETAIL");
    errorSpy.mockRestore();
  });
});

describe("일정·예약 날짜 입력 검증 (AI 인자 방어)", () => {
  it("add_schedule_event: 비정형 날짜는 DB에 닿기 전에 거부", async () => {
    const result = await executeTool(
      "add_schedule_event",
      { date: "내일", title: "드레스 투어" },
      makeCtx()
    );
    expect(result.success).toBe(false);
    expect((result.toolOutput as { error?: string }).error).toBe("invalid_date");
  });

  it("add_schedule_event: 달력에 없는 날짜(2026-13-40) 거부", async () => {
    const result = await executeTool(
      "add_schedule_event",
      { date: "2026-13-40", title: "드레스 투어" },
      makeCtx()
    );
    expect(result.success).toBe(false);
  });

  it.each(["2027-02-29", "2027-02-31", "2027-04-31"])(
    "update_wedding_date: 달력에 없는 날짜 %s 거부",
    async (weddingDate) => {
      const result = await executeTool(
        "update_wedding_date",
        { wedding_date: weddingDate },
        makeCtx(),
      );

      expect(result).toMatchObject({
        success: false,
        toolOutput: { error: "invalid_date" },
      });
      expect(mocks.rpc.mock.calls.map(([name]) => name)).not.toContain(
        "mark_amora_tool_execution_uncertain",
      );
    },
  );

  it("update_wedding_date uses the Korea calendar day at the UTC boundary", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-16T15:30:00.000Z")); // 2026-07-17 00:30 KST
      const result = await executeTool(
        "update_wedding_date",
        { wedding_date: "2026-07-17" },
        makeCtx(),
      );

      expect(result).toMatchObject({
        success: true,
        toolOutput: { wedding_date: "2026-07-17", d_day: 0 },
      });
      expect(mocks.update).toHaveBeenCalledWith({ wedding_date: "2026-07-17" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("update_wedding_date rejects yesterday in Korea even while UTC is on the prior day", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-16T15:30:00.000Z")); // 2026-07-17 00:30 KST
      const result = await executeTool(
        "update_wedding_date",
        { wedding_date: "2026-07-16" },
        makeCtx(),
      );

      expect(result).toMatchObject({
        success: false,
        toolOutput: {
          error: "past_date_rejected",
          attempted: "2026-07-16",
          today: "2026-07-17",
        },
      });
      expect(mocks.update).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("create_booking: 형식 불량 입력은 사전 차단", async () => {
    const result = await executeTool(
      "create_booking",
      { vendor_id: "v", date: "13일", time: "3시" },
      makeCtx()
    );
    expect(result.success).toBe(false);
    expect((result.toolOutput as { error?: string }).error).toBe("invalid_booking_input");
  });
});

describe("파괴적 도구 확인 게이트", () => {
  it("delete_category: confirmed 없이 실행되지 않는다", async () => {
    const result = await executeTool("delete_category", { category: "venue" }, makeCtx());
    expect(result.success).toBe(false);
    expect((result.toolOutput as { requires_confirmation?: boolean }).requires_confirmation).toBe(true);
  });

  it("cancel_booking: confirmed 없이 실행되지 않는다", async () => {
    const result = await executeTool("cancel_booking", { booking_id: "x" }, makeCtx());
    expect(result.success).toBe(false);
    expect((result.toolOutput as { requires_confirmation?: boolean }).requires_confirmation).toBe(true);
  });
});

describe("예산 변경 write fence", () => {
  it.each([
    -1,
    1.5,
    1_000_000_001,
    "3000만원",
  ])("총예산의 비정상 금액 %s를 DB 전에 거부한다", async (totalBudget) => {
    const result = await executeTool(
      "update_budget",
      { total_budget: totalBudget },
      makeCtx(),
    );

    expect(result).toMatchObject({
      success: false,
      toolOutput: { error: "invalid_budget_amount" },
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])(
    "직렬화 불가능한 금액 %s도 변경 전에 거부한다",
    async (totalBudget) => {
      const result = await executeTool(
        "update_budget",
        { total_budget: totalBudget },
        makeCtx(),
      );
      expect(result.success).toBe(false);
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );

  it.each([
    { category: "__proto__", budget: 100_000 },
    { category: "dress", budget: -1 },
    { category: "dress", spent: 1.5 },
    { category: "dress", budget: 1_000_000_001 },
    { category: "dress" },
  ])("카테고리 예산의 비정상 입력을 거부한다: %j", async (input) => {
    const result = await executeTool("update_category_budget", input, makeCtx());

    expect(result).toMatchObject({
      success: false,
      toolOutput: { error: "invalid_category_budget" },
    });
    expect(mocks.rpc.mock.calls.map(([name]) => name)).not.toContain(
      "apply_journey_progress_patch",
    );
  });

  it("커스텀 카테고리에도 동일한 상한과 정수 규칙을 적용한다", async () => {
    const result = await executeTool(
      "add_custom_category",
      { label: "포토부스", budget: 1_000_000_001 },
      makeCtx(),
    );

    expect(result).toMatchObject({
      success: false,
      toolOutput: { error: "invalid_category_amount", field: "budget" },
    });
  });
});

describe("진행 상태 원자적 갱신", () => {
  it("상태만 바꿀 때 같은 카테고리의 예산·지출·체크리스트·메모를 보존한다", async () => {
    const previousCategory = {
      category: "venue",
      status: "not_started",
      budget: 20_000_000,
      spent: 3_000_000,
      checklist: [{ id: "contract", completed: false }],
      memo: "채광 좋은 홀 우선",
    };
    const ctx = makeCtx({ venue: previousCategory });
    mocks.rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
      if (name === "claim_amora_tool_execution") {
        return Promise.resolve({ data: { action: "acquired" }, error: null });
      }
      if (name === "apply_journey_progress_item_patch") {
        return Promise.resolve({
          data: { ...previousCategory, ...(args.p_item_patch as object) },
          error: null,
        });
      }
      if (name === "complete_amora_tool_execution") {
        return Promise.resolve({ data: true, error: null });
      }
      return Promise.resolve({ data: null, error: { message: "unexpected rpc" } });
    });

    const result = await executeTool(
      "update_task_status",
      { category: "venue", status: "in_progress" },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(ctx.weddingContext.progress.venue).toEqual({
      ...previousCategory,
      status: "in_progress",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("apply_journey_progress_item_patch", {
      p_couple_id: ctx.coupleId,
      p_item_key: "venue",
      p_item_patch: { category: "venue", status: "in_progress" },
    });
  });

  it.each([
    { category: "__events", status: "completed" },
    { category: "venue", status: "deleted" },
  ])("허용되지 않은 카테고리나 상태는 progress에 쓰지 않는다: %j", async (input) => {
    const result = await executeTool("update_task_status", input, makeCtx());

    expect(result).toMatchObject({
      success: false,
      toolOutput: { error: "invalid_task_status" },
    });
    expect(mocks.rpc.mock.calls.map(([name]) => name)).not.toContain(
      "apply_journey_progress_item_patch",
    );
  });
});

describe("변경 도구 내구성 원장", () => {
  it("같은 요청의 동일 변경을 여러 라운드에서 한 번만 실행한다", async () => {
    const ctx = makeCtx();
    const input = { date: "내일", title: "드레스 투어" };

    const first = await executeTool("add_schedule_event", input, ctx);
    const retry = await executeTool("add_schedule_event", { title: "드레스 투어", date: "내일" }, ctx);

    expect(retry).toEqual(first);
    expect(mocks.rpc.mock.calls.filter(([name]) => name === "claim_amora_tool_execution")).toHaveLength(1);
    expect(mocks.rpc.mock.calls.filter(([name]) => name === "complete_amora_tool_execution")).toHaveLength(1);
  });

  it("요청 식별자가 없으면 변경 전에 닫힌다", async () => {
    const ctx = makeCtx();
    delete ctx.requestKey;

    const result = await executeTool("update_budget", { total_budget: 30_000_000 }, ctx);

    expect(result).toMatchObject({
      success: false,
      toolOutput: { error: "IDEMPOTENCY_CONTEXT_MISSING" },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("DB 요청 시도 번호가 없으면 변경 전에 닫힌다", async () => {
    const ctx = makeCtx();
    delete ctx.requestAttemptCount;

    const result = await executeTool("update_budget", { total_budget: 30_000_000 }, ctx);

    expect(result).toMatchObject({
      success: false,
      toolOutput: { error: "IDEMPOTENCY_CONTEXT_MISSING" },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("쓰기 원장을 현재 채팅 요청 시도 번호에 결합한다", async () => {
    await executeTool(
      "update_budget",
      { total_budget: 30_000_000 },
      makeCtx(),
    );

    expect(mocks.rpc).toHaveBeenCalledWith(
      "claim_amora_tool_execution",
      expect.objectContaining({ p_request_attempt_count: 1 }),
    );
  });

  it("승인된 pending action은 전용 action ID를 원자적 claim에 결합한다", async () => {
    const pendingActionId = "00000000-0000-4000-8000-000000000004";

    await executeTool(
      "update_budget",
      { total_budget: 30_000_000 },
      { ...makeCtx(), pendingActionId },
    );

    expect(mocks.rpc).toHaveBeenCalledWith(
      "claim_amora_tool_execution",
      expect.objectContaining({ p_pending_action_id: pendingActionId }),
    );
  });

  it("pending action ID가 UUID가 아니면 어떤 DB 변경도 시작하지 않는다", async () => {
    const result = await executeTool(
      "update_budget",
      { total_budget: 30_000_000 },
      { ...makeCtx(), pendingActionId: "not-a-uuid" },
    );

    expect(result).toMatchObject({
      success: false,
      toolOutput: { error: "INVALID_PENDING_ACTION_ID" },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("재시도에서 새 작업이 만들어지면 실제 변경 없이 차단한다", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: { action: "retry_new_operation_blocked" },
      error: null,
    });

    const result = await executeTool(
      "update_budget",
      { total_budget: 30_000_000 },
      { ...makeCtx(), requestAttemptCount: 2 },
    );

    expect(result).toMatchObject({
      success: false,
      toolOutput: { error: "TOOL_RETRY_NEW_OPERATION_BLOCKED" },
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("더 최신 대화가 생기면 실제 변경 없이 오래된 도구 실행을 차단한다", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: { action: "stale_context" },
      error: null,
    });

    const result = await executeTool(
      "update_budget",
      { total_budget: 30_000_000 },
      makeCtx(),
    );

    expect(result).toMatchObject({
      success: false,
      toolOutput: { error: "TOOL_CONTEXT_STALE" },
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("불확실 상태는 재실행하지 않고 사용자 확인으로 전환한다", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { action: "uncertain" }, error: null });

    const result = await executeTool(
      "update_budget",
      { total_budget: 30_000_000 },
      makeCtx()
    );

    expect(result).toMatchObject({
      success: false,
      toolOutput: {
        error: "TOOL_EXECUTION_UNCERTAIN",
        requires_state_review: true,
      },
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("같은 이름의 커스텀 카테고리는 새 요청에서도 동일 키로 업데이트한다", async () => {
    const firstContext = makeCtx();
    const first = await executeTool(
      "add_custom_category",
      { label: "신혼 여행", budget: 5_000_000 },
      firstContext
    );
    expect(first.success).toBe(true);
    const key = String(first.toolOutput.key);

    const secondContext = makeCtx(firstContext.weddingContext.progress as Record<string, unknown>);
    secondContext.requestKey = "chat:00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000003";
    const retry = await executeTool(
      "add_custom_category",
      { label: "신혼   여행", budget: 6_000_000 },
      secondContext
    );

    expect(retry).toMatchObject({
      success: true,
      toolOutput: { key, created: false, budget: 6_000_000 },
    });
    expect(Object.keys(secondContext.weddingContext.progress).filter((item) => item.startsWith("custom_"))).toEqual([key]);
  });

  it("예산 플랜은 총액과 카테고리 배분을 한 RPC로 적용한다", async () => {
    const ctx = makeCtx({
      venue: { category: "venue", status: "in_progress", spent: 1_000_000 },
    });
    const result = await executeTool(
      "apply_budget_plan",
      {
        total_budget: 30_000_000,
        allocations: [{ category: "venue", budget: 20_000_000 }],
        intake_summary: "채광을 우선",
      },
      ctx
    );

    expect(result.success).toBe(true);
    const calls = mocks.rpc.mock.calls.filter(([name]) => name === "apply_budget_plan_atomic");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]).toMatchObject({
      p_total_budget: 30_000_000,
      p_progress_patch: {
        venue: { budget: 20_000_000, spent: 1_000_000 },
        reserve: { budget: 10_000_000 },
      },
    });
    expect(ctx.weddingContext.budget).toBe(30_000_000);
  });
});
