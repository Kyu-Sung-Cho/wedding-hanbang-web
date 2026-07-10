import { describe, expect, it } from "vitest";
import { executeTool } from "../toolExecutor";
import {
  BETA_SAFE_TOOLS,
  MODEL_DISABLED_DESTRUCTIVE_TOOL_NAMES,
  MODEL_DISABLED_EXTERNAL_TOOL_NAMES,
  MODEL_MUTATING_TOOL_NAMES,
  READ_ONLY_SAFE_TOOLS,
} from "../tools";
import type { ToolExecutionContext } from "../tools/toolTypes";

// AI 도구층 회귀 잠금 (2026-07-06 전수 감사) — DB 접근 없는 순수 경로만 검증.
// 핵심: 아모라가 사용자에게 말하는 숫자는 전부 실데이터여야 한다(지어낸 지출 금지).

function makeCtx(progress: Record<string, unknown> = {}): ToolExecutionContext {
  return {
    coupleId: "00000000-0000-0000-0000-000000000000",
    currentUserText: "",
    weddingContext: {
      weddingDate: null,
      budget: 50_000_000,
      venue: null,
      progress: progress as ToolExecutionContext["weddingContext"]["progress"],
    },
  };
}

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
    const ctx = makeCtx();
    ctx.allowMutations = true;
    ctx.currentUserText = "내일 일정을 추가해줘";
    const result = await executeTool(
      "add_schedule_event",
      { date: "내일", title: "드레스 투어" },
      ctx
    );
    expect(result.success).toBe(false);
    expect((result.toolOutput as { error?: string }).error).toBe("invalid_date");
  });

  it("add_schedule_event: 달력에 없는 날짜(2026-13-40) 거부", async () => {
    const ctx = makeCtx();
    ctx.allowMutations = true;
    ctx.currentUserText = "드레스 투어 일정을 추가해줘";
    const result = await executeTool(
      "add_schedule_event",
      { date: "2026-13-40", title: "드레스 투어" },
      ctx
    );
    expect(result.success).toBe(false);
  });

  it("create_booking: 신뢰 가능한 서버 확인 절차 전에는 항상 차단", async () => {
    const result = await executeTool(
      "create_booking",
      { vendor_id: "v", date: "13일", time: "3시" },
      makeCtx()
    );
    expect(result.success).toBe(false);
    expect((result.toolOutput as { error?: string }).error).toBe("trusted_confirmation_required");
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

  it.each([
    ["delete_category", { category: "venue", confirmed: true }],
    ["reset_category", { category: "venue", confirmed: true }],
    ["delete_schedule_event", { event_id: "event-1", confirmed: true }],
    ["cancel_booking", { booking_id: "booking-1", confirmed: true }],
  ])("%s: 모델이 confirmed=true를 보내도 실행하지 않는다", async (toolName, input) => {
    const result = await executeTool(toolName, input, makeCtx());
    expect(result.success).toBe(false);
    expect(result.toolOutput).toMatchObject({
      error: "trusted_confirmation_required",
      requires_confirmation: true,
      accepted_confirmation_source: "server_only",
    });
  });

  it("파괴적 도구를 모델에 노출하지 않는다", () => {
    const exposedNames = new Set(BETA_SAFE_TOOLS.map((tool) => tool.name));
    for (const toolName of MODEL_DISABLED_DESTRUCTIVE_TOOL_NAMES) {
      expect(exposedNames.has(toolName)).toBe(false);
    }
  });

  it("private/첨부 턴 목록은 mutation과 외부 Naver 검색을 노출하지 않는다", () => {
    const exposedNames = new Set(READ_ONLY_SAFE_TOOLS.map((tool) => tool.name));
    for (const toolName of MODEL_MUTATING_TOOL_NAMES) {
      expect(exposedNames.has(toolName)).toBe(false);
    }
    expect(exposedNames.has("search_nearby_places")).toBe(false);
    expect(exposedNames.has("get_budget_summary")).toBe(true);
  });

  it("공유 턴에도 모델 자유문자열 외부 검색을 노출하거나 직접 실행하지 않는다", async () => {
    const exposedNames = new Set(BETA_SAFE_TOOLS.map((tool) => tool.name));
    for (const toolName of MODEL_DISABLED_EXTERNAL_TOOL_NAMES) {
      expect(exposedNames.has(toolName)).toBe(false);
    }
    const result = await executeTool("search_nearby_places", { query: "이름과 예산" }, makeCtx());
    expect(result).toMatchObject({
      success: false,
      toolOutput: { error: "external_model_query_disabled" },
    });
  });
});

describe("도구 인자 서버 검증", () => {
  it("현재 사용자 발화에 명시적 변경 의도가 없으면 mutation을 차단한다", async () => {
    const ctx = makeCtx();
    ctx.allowMutations = true;
    const result = await executeTool(
      "update_budget",
      { total_budget: 50_000_000 },
      ctx
    );
    expect(result).toMatchObject({
      success: false,
      toolOutput: {
        error: "explicit_user_mutation_intent_required",
        accepted_intent_source: "current_user_message_only",
      },
    });
  });

  it("호출자가 명시적으로 허용하지 않은 mutation은 사용자 문구와 무관하게 차단한다", async () => {
    const ctx = makeCtx();
    ctx.currentUserText = "총 예산을 5천만원으로 변경해줘";
    const result = await executeTool("update_budget", { total_budget: 50_000_000 }, ctx);

    expect(result).toMatchObject({
      success: false,
      toolOutput: { error: "mutations_not_allowed_in_this_context" },
    });
  });

  it("예약된 __* 키를 중첩 위치에서도 차단한다", async () => {
    const result = await executeTool(
      "apply_budget_plan",
      {
        total_budget: 10_000_000,
        intake_summary: "예식장 우선",
        allocations: [
          { category: "venue", budget: 10_000_000, __events: [] },
        ],
      },
      makeCtx()
    );

    expect(result.success).toBe(false);
    expect(result.toolOutput).toMatchObject({
      error: "invalid_tool_input",
      reason: "reserved_key",
      path: "$.allocations[0].__events",
    });
  });

  it.each([
    [Number.NaN, "number_not_finite"],
    [Number.POSITIVE_INFINITY, "number_not_finite"],
    [-1, "money_negative"],
    [1.5, "money_not_integer"],
    [10_000_000_001, "money_too_large"],
  ])("원 단위 금액 %s를 DB 실행 전에 거부한다", async (amount, reason) => {
    const result = await executeTool("update_budget", { total_budget: amount }, makeCtx());
    expect(result.success).toBe(false);
    expect(result.toolOutput).toMatchObject({ error: "invalid_tool_input", reason });
  });

  it("만원 단위 식대는 소수 한 자리까지만 허용한다", async () => {
    const result = await executeTool(
      "simulate_guest_guarantee",
      { meal_price: 7.55 },
      makeCtx()
    );
    expect(result.success).toBe(false);
    expect(result.toolOutput).toMatchObject({
      error: "invalid_tool_input",
      reason: "money_precision_invalid",
    });
  });

  it("카테고리 및 상태 allowlist 밖의 값은 차단한다", async () => {
    const invalidCategory = await executeTool(
      "update_task_status",
      { category: "__events", status: "completed" },
      makeCtx()
    );
    const invalidStatus = await executeTool(
      "get_my_bookings",
      { status: "anything' OR true --" },
      makeCtx()
    );
    const invalidVendorCategory = await executeTool(
      "search_vendors",
      { category: "anything' OR true --" },
      makeCtx()
    );

    for (const result of [invalidCategory, invalidStatus, invalidVendorCategory]) {
      expect(result.success).toBe(false);
      expect(result.toolOutput).toMatchObject({
        error: "invalid_tool_input",
        reason: "value_not_allowed",
      });
    }
  });

  it("문자열과 배열 크기 상한을 적용한다", async () => {
    const longString = await executeTool(
      "search_nearby_places",
      { query: "가".repeat(2_001) },
      makeCtx()
    );
    const longArray = await executeTool(
      "analyze_quote",
      {
        quote_price: 300,
        category: "studio",
        included_items: Array.from({ length: 51 }, (_, index) => `item-${index}`),
      },
      makeCtx()
    );

    expect(longString.toolOutput).toMatchObject({
      error: "invalid_tool_input",
      reason: "string_too_long",
    });
    expect(longArray.toolOutput).toMatchObject({
      error: "invalid_tool_input",
      reason: "array_too_long",
    });
  });

  it("스키마에 없는 임의 필드를 거부한다", async () => {
    const result = await executeTool(
      "get_wedding_info",
      { injected: true },
      makeCtx()
    );
    expect(result.success).toBe(false);
    expect(result.toolOutput).toMatchObject({
      error: "invalid_tool_input",
      reason: "unexpected_field",
      path: "$.injected",
    });
  });
});

describe("요청 취소 전파", () => {
  it("이미 취소된 요청은 도구를 실행하지 않는다", async () => {
    const controller = new AbortController();
    controller.abort();
    const ctx = makeCtx();
    ctx.signal = controller.signal;

    await expect(executeTool("get_budget_summary", {}, ctx)).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});
