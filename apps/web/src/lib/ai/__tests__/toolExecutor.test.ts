import { beforeEach, describe, expect, it, vi } from "vitest";
import { MUTATING_TOOL_NAMES } from "../mutationTools";
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

// 운영에서 변경 도구는 사용자가 누른 확인 카드의 action ID 와 함께만 실행기에 온다
// (route.ts 의 executeApprovedPendingAction). 변경 도구를 실제로 실행해 보는 테스트는 이 문맥을 쓴다.
const CONFIRMED_ACTION_ID = "00000000-0000-4000-8000-000000000004";

function makeConfirmedCtx(progress: Record<string, unknown> = {}): ToolExecutionContext {
  return { ...makeCtx(progress), pendingActionId: CONFIRMED_ACTION_ID };
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
      // 운영 DB 함수처럼 넘겨받은 결과를 그대로 확정해 돌려준다.
      return Promise.resolve({ data: args.p_result, error: null });
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
      categories: Array<{ key: string; allocated: number | null; allocated_is_set: boolean; spent: number }>;
    };
    expect(out.total_spent).toBe(5_000_000); // 실기록만 — 예전 휴리스틱이면 studio 배정액이 섞여 커짐
    const venue = out.categories.find((c) => c.key === "venue")!;
    expect(venue.allocated).toBe(20_000_000); // 사용자가 설정한 배정액 존중 (비율 무시 금지)
    expect(venue.allocated_is_set).toBe(true);
    expect(venue.spent).toBe(5_000_000);
    const studio = out.categories.find((c) => c.key === "studio")!;
    expect(studio.spent).toBe(0);
    expect(studio.allocated).toBeNull();
    expect(studio.allocated_is_set).toBe(false);
  });

  it("legacy cost는 결제·지출 증거로 승격하지 않고 용도 미확인으로 표시한다", async () => {
    const result = await executeTool("get_budget_summary", {}, makeCtx({
      venue: { budget: 20_000_000, cost: 15_000_000 },
    }));
    const out = result.toolOutput as {
      total_spent: number;
      categories: Array<{
        key: string;
        spent: number;
        legacy_amount_unclassified: boolean;
      }>;
    };

    expect(out.total_spent).toBe(0);
    expect(out.categories.find((category) => category.key === "venue"))
      .toMatchObject({ spent: 0, legacy_amount_unclassified: true });
    expect(result.displayMessage).toContain("용도 미확인 이전 금액");
    expect(result.displayMessage).not.toContain("기록된 지출 1,500만원");
  });

  it("입력하지 않은 항목의 예산을 추정하지 않는다고 명시한다", async () => {
    const result = await executeTool("get_budget_summary", {}, makeCtx());
    expect(result.displayMessage).toContain("입력된 금액만 표시");
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
    // 이 검사의 본뜻 — 손상된 값이 금액으로 새지 않는가.
    expect(result.displayMessage).not.toContain("-1");
    // 예전에는 "예산: 0원" 이었다. 신규 커플의 총예산도 0이라, 그 문장은
    // **정하지 않은 것**과 **0원으로 정한 것**을 구분하지 못했다(2026-08-25).
    // 손상된 값도 도구가 보기엔 정하지 않은 것과 같으므로 같은 문장을 쓴다 —
    // 없는 금액을 단언하는 것보다 낫다.
    expect(result.displayMessage).toContain("예산: 아직 정하지 않음");
    expect(result.displayMessage).not.toContain("예산: 0원");
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
    errorSpy.mockRestore();
  });
});

describe("일정 날짜 입력 검증 (AI 인자 방어)", () => {
  it("add_schedule_event: 비정형 날짜는 일정을 바꾸지 않고 거절한다", async () => {
    const result = await executeTool(
      "add_schedule_event",
      { date: "내일", title: "드레스 투어" },
      makeConfirmedCtx()
    );
    expect(result.success).toBe(false);
    expect((result.toolOutput as { error?: string }).error).toBe("invalid_schedule_event");
    expect(mocks.rpc).toHaveBeenCalledWith(
      "apply_amora_atomic_tool_execution",
      expect.objectContaining({ p_domain_mutation: { kind: "none" } }),
    );
  });

  it("add_schedule_event: 달력에 없는 날짜(2026-13-40) 거부", async () => {
    const result = await executeTool(
      "add_schedule_event",
      { date: "2026-13-40", title: "드레스 투어" },
      makeConfirmedCtx()
    );
    expect(result.success).toBe(false);
    expect((result.toolOutput as { error?: string }).error).toBe("invalid_schedule_event");
  });

  it.each(["2027-02-29", "2027-02-31", "2027-04-31"])(
    "update_wedding_date: 달력에 없는 날짜 %s 거부",
    async (weddingDate) => {
      const result = await executeTool(
        "update_wedding_date",
        { wedding_date: weddingDate },
        makeConfirmedCtx(),
      );

      expect(result).toMatchObject({
        success: false,
        toolOutput: { error: "invalid_wedding_date" },
      });
      expect(mocks.rpc).toHaveBeenCalledWith(
        "apply_amora_atomic_tool_execution",
        expect.objectContaining({ p_domain_mutation: { kind: "none" } }),
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
        makeConfirmedCtx(),
      );

      expect(result).toMatchObject({
        success: true,
        toolOutput: { wedding_date: "2026-07-17", d_day: 0 },
      });
      expect(mocks.rpc).toHaveBeenCalledWith(
        "apply_amora_atomic_tool_execution",
        expect.objectContaining({
          p_domain_mutation: {
            kind: "journey_wedding_date_cas",
            expected: null,
            value: "2026-07-17",
          },
        }),
      );
      expect(mocks.update).not.toHaveBeenCalled();
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
        makeConfirmedCtx(),
      );

      expect(result).toMatchObject({
        success: false,
        toolOutput: { error: "past_date_rejected" },
      });
      expect(mocks.rpc).toHaveBeenCalledWith(
        "apply_amora_atomic_tool_execution",
        expect.objectContaining({ p_domain_mutation: { kind: "none" } }),
      );
      expect(mocks.update).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("확인 카드 없는 변경 도구는 실행기가 거절한다", () => {
  // delete_schedule_event 는 카드가 있어도 실행하지 않는 은퇴 도구라 더 앞에서 닫힌다.
  const CARD_GATED_TOOLS = MUTATING_TOOL_NAMES.filter((name) => name !== "delete_schedule_event");

  it("변경 도구 목록을 실제로 읽었다", () => {
    expect(CARD_GATED_TOOLS.length).toBeGreaterThanOrEqual(19);
    expect(CARD_GATED_TOOLS).toContain("update_budget");
  });

  it.each(CARD_GATED_TOOLS)("%s: 확인 카드 없이 오면 DB 를 부르지 않고 거절한다", async (toolName) => {
    const result = await executeTool(toolName, {}, makeCtx());

    expect(result).toMatchObject({
      success: false,
      toolOutput: { error: "CONFIRMED_ACTION_REQUIRED", retryable: false, requires_state_review: false },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("모델 호출 번호만 있어도 확인 카드를 대신하지 못한다", async () => {
    const result = await executeTool(
      "update_budget",
      { total_budget: 30_000_000 },
      { ...makeCtx(), providerCallIndex: 1 },
    );

    expect(result).toMatchObject({ success: false, toolOutput: { error: "CONFIRMED_ACTION_REQUIRED" } });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("금액을 직접 정한 예산안도 확인 카드 없이는 적용하지 않는다", async () => {
    const result = await executeTool(
      "apply_budget_plan",
      {
        total_budget: 50_000_000,
        allocation_mode: "explicit",
        allocations: [{ category: "studio", budget: 3_000_000 }],
      },
      makeCtx(),
    );

    expect(result).toMatchObject({ success: false, toolOutput: { error: "CONFIRMED_ACTION_REQUIRED" } });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("거절 문구는 반영하지 않았다는 사실을 말하고 반영된 것처럼 읽히지 않는다", async () => {
    const result = await executeTool("update_budget", { total_budget: 30_000_000 }, makeCtx());

    expect(result.displayMessage).toContain("반영하지 않았어요");
    expect(result.displayMessage).not.toMatch(/죄송|파트너|반영했|적용했/u);
  });
});

describe("파괴적 도구 확인 게이트", () => {
  const destructiveCalls: Array<[string, Record<string, unknown>]> = [
    ["delete_category", { category: "venue", confirmed: true }],
    ["reset_category", { category: "venue", confirmed: true }],
    ["cancel_booking", { booking_id: "x", confirmed: true }],
  ];

  it.each(destructiveCalls)("%s: 모델이 confirmed 를 넣어도 확인 카드 없이는 실행되지 않는다", async (toolName, input) => {
    const result = await executeTool(toolName, input, makeCtx());

    expect(result).toMatchObject({
      success: false,
      toolOutput: { error: "CONFIRMED_ACTION_REQUIRED" },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  // 확인 카드가 있으면 위의 거절을 지나간다. 그때 실행기 안에서 이 도구들을 막는 것은 원자 연산이
  // 지원하지 않는 도구에 돌려주는 '적용하지 않음' 결과 하나뿐이다. 모델이 넣은 confirmed 를
  // 보던 옛 검사에는 실행기를 거쳐서는 더 이상 닿지 않는다.
  const destructiveWithCard: Array<[string, Record<string, unknown>]> = [
    ...destructiveCalls,
    ["create_booking", { vendor_id: "v", date: "2027-03-12", time: "15:00" }],
  ];

  it.each(destructiveWithCard)("%s: 확인 카드가 있어도 아무것도 바꾸지 않는다", async (toolName, input) => {
    const result = await executeTool(
      toolName,
      input,
      makeConfirmedCtx({ venue: { category: "venue", status: "in_progress", budget: 1 } }),
    );

    expect(result).toMatchObject({
      success: false,
      toolOutput: { error: "TOOL_ATOMICITY_UNAVAILABLE" },
    });
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "claim_amora_tool_execution",
      "apply_amora_atomic_tool_execution",
    ]);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "apply_amora_atomic_tool_execution",
      expect.objectContaining({ p_domain_mutation: { kind: "none" } }),
    );
    expect(mocks.from).not.toHaveBeenCalled();
  });
});

describe("예산 변경 write fence", () => {
  it.each([
    -1,
    1.5,
    1_000_000_001,
    "3000만원",
  ])("총예산의 비정상 금액 %s는 값을 바꾸지 않고 거부한다", async (totalBudget) => {
    const result = await executeTool(
      "update_budget",
      { total_budget: totalBudget },
      makeConfirmedCtx(),
    );

    expect(result).toMatchObject({
      success: false,
      toolOutput: { error: "invalid_budget_amount" },
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "apply_amora_atomic_tool_execution",
      expect.objectContaining({ p_domain_mutation: { kind: "none" } }),
    );
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])(
    "직렬화 불가능한 금액 %s도 변경 전에 거부한다",
    async (totalBudget) => {
      const result = await executeTool(
        "update_budget",
        { total_budget: totalBudget },
        makeConfirmedCtx(),
      );
      expect(result).toMatchObject({
        success: false,
        toolOutput: { error: "INVALID_TOOL_INPUT" },
      });
      expect(mocks.rpc).not.toHaveBeenCalled();
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
    const result = await executeTool("update_category_budget", input, makeConfirmedCtx());

    expect(result).toMatchObject({
      success: false,
      toolOutput: { error: "invalid_category_budget" },
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "apply_amora_atomic_tool_execution",
      expect.objectContaining({ p_domain_mutation: { kind: "none" } }),
    );
  });

  it("커스텀 카테고리에도 동일한 상한과 정수 규칙을 적용한다", async () => {
    const result = await executeTool(
      "add_custom_category",
      { label: "포토부스", budget: 1_000_000_001 },
      makeConfirmedCtx(),
    );

    expect(result).toMatchObject({
      success: false,
      toolOutput: { error: "invalid_category_amount" },
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "apply_amora_atomic_tool_execution",
      expect.objectContaining({ p_domain_mutation: { kind: "none" } }),
    );
  });
});

describe("진행 상태 원자적 갱신", () => {
  // 체크리스트 배열이 있는 분야는 화면 상태가 항목에서 나오므로, 항목과 맞지 않는 상태 변경은
  // status_follows_checklist 로 거절된다. 그래서 여기서는 체크리스트 배열 없이 나머지 값이 그대로 남는지를 본다.
  it("상태만 바꿀 때 같은 카테고리의 예산·지출·메모를 보존한다", async () => {
    const previousCategory = {
      category: "venue",
      status: "not_started",
      budget: 20_000_000,
      spent: 3_000_000,
      memo: "채광 좋은 홀 우선",
    };
    const ctx = makeConfirmedCtx({ venue: previousCategory });

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
    expect(mocks.rpc).toHaveBeenCalledWith("apply_amora_atomic_tool_execution", expect.objectContaining({
      p_domain_mutation: {
        kind: "journey_progress_entry_cas",
        key: "venue",
        expectedPresent: true,
        expected: previousCategory,
        value: { ...previousCategory, status: "in_progress" },
      },
    }));
  });

  it.each([
    { category: "__events", status: "completed" },
    { category: "venue", status: "deleted" },
  ])("허용되지 않은 카테고리나 상태는 progress에 쓰지 않는다: %j", async (input) => {
    const result = await executeTool("update_task_status", input, makeConfirmedCtx());

    expect(result).toMatchObject({
      success: false,
      toolOutput: { error: "invalid_task_status" },
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "apply_amora_atomic_tool_execution",
      expect.objectContaining({ p_domain_mutation: { kind: "none" } }),
    );
  });
});

describe("변경 도구 내구성 원장", () => {
  it("같은 요청의 동일 변경을 여러 라운드에서 한 번만 실행한다", async () => {
    const ctx = makeConfirmedCtx();
    const input = { date: "내일", title: "드레스 투어" };

    const first = await executeTool("add_schedule_event", input, ctx);
    const retry = await executeTool("add_schedule_event", { title: "드레스 투어", date: "내일" }, ctx);

    expect(retry).toEqual(first);
    expect(mocks.rpc.mock.calls.filter(([name]) => name === "claim_amora_tool_execution")).toHaveLength(1);
    expect(mocks.rpc.mock.calls.filter(([name]) => name === "apply_amora_atomic_tool_execution")).toHaveLength(1);
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
      makeConfirmedCtx(),
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

  // 확인 카드 검사는 pendingActionId 가 아예 없을 때만 걸린다(=== undefined). 있지만 비어 있는
  // 값은 그다음 형식 검사가 막는다. 둘 중 하나만 고쳐도 열릴 수 있는 자리라 묶어 둔다.
  it.each([null, "", 0])("pendingActionId %j never starts a write", async (value) => {
    const result = await executeTool(
      "update_budget",
      { total_budget: 30_000_000 },
      { ...makeCtx(), pendingActionId: value as unknown as string },
    );

    expect(result).toMatchObject({
      success: false,
      toolOutput: { error: "INVALID_PENDING_ACTION_ID" },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("재시도에서 새 작업이 만들어지면 실제 변경 없이 차단한다", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: { action: "retry_new_operation_blocked" },
      error: null,
    });

    const result = await executeTool(
      "update_budget",
      { total_budget: 30_000_000 },
      { ...makeConfirmedCtx(), requestAttemptCount: 2 },
    );

    expect(result).toMatchObject({
      success: false,
      toolOutput: { error: "TOOL_RETRY_NEW_OPERATION_BLOCKED" },
    });
    // claim 한 번으로 끝났다. 카드가 있는 변경은 그다음 RPC(apply_amora_atomic_tool_execution)에서만 쓴다.
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
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
      makeConfirmedCtx(),
    );

    expect(result).toMatchObject({
      success: false,
      toolOutput: { error: "TOOL_CONTEXT_STALE" },
    });
    // claim 한 번으로 끝났다. 카드가 있는 변경은 그다음 RPC(apply_amora_atomic_tool_execution)에서만 쓴다.
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("불확실 상태는 재실행하지 않고 사용자 확인으로 전환한다", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { action: "uncertain" }, error: null });

    const result = await executeTool(
      "update_budget",
      { total_budget: 30_000_000 },
      makeConfirmedCtx()
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
    const firstContext = makeConfirmedCtx();
    const first = await executeTool(
      "add_custom_category",
      { label: "신혼 여행", budget: 5_000_000 },
      firstContext
    );
    expect(first.success).toBe(true);
    const key = String(first.toolOutput.key);

    const secondContext = makeConfirmedCtx(firstContext.weddingContext.progress as Record<string, unknown>);
    secondContext.requestKey = "chat:00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000003";
    const retry = await executeTool(
      "add_custom_category",
      { label: "신혼   여행", budget: 6_000_000 },
      secondContext
    );

    expect(retry).toMatchObject({
      success: true,
      toolOutput: { key, created: false, progress_value: { budget: 6_000_000 } },
    });
    expect(Object.keys(secondContext.weddingContext.progress).filter((item) => item.startsWith("custom_"))).toEqual([key]);
  });
});
