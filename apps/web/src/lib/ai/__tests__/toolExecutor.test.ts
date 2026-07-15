import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeTool } from "../toolExecutor";
import type { ToolExecutionContext } from "../tools/toolTypes";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ rpc: mocks.rpc })),
}));

// AI 도구층 회귀 잠금 (2026-07-06 전수 감사) — DB 접근 없는 순수 경로만 검증.
// 핵심: 아모라가 사용자에게 말하는 숫자는 전부 실데이터여야 한다(지어낸 지출 금지).

function makeCtx(progress: Record<string, unknown> = {}): ToolExecutionContext {
  return {
    coupleId: "00000000-0000-0000-0000-000000000000",
    requestKey: "chat:00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000002",
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
  mocks.rpc.mockReset();
  mocks.rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
    if (name === "claim_amora_tool_execution") {
      return Promise.resolve({ data: { action: "acquired" }, error: null });
    }
    if (name === "complete_amora_tool_execution") {
      return Promise.resolve({ data: true, error: null });
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
