import { describe, expect, it } from "vitest";
import { executeTool } from "../toolExecutor";
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
