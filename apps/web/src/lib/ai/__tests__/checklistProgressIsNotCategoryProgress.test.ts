import { describe, expect, it, vi } from "vitest";

import { CATEGORY_CHECKLISTS } from "@hanbang/shared/constants";
import { summarizePlanningChecklist } from "@hanbang/shared/utils";
import { executeTool } from "@/lib/ai/toolExecutor";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ rpc: vi.fn(), from: vi.fn() })),
}));

/**
 * 방금 완료 처리한 체크리스트 항목을 아모라가 "없다"고 답했다.
 *
 *     사용자: 결혼식장 체크리스트에서 '원하는 결혼식장 형태 정하기' 완료로 표시해줘
 *     아모라: (카드) → 확인 → "완료로 변경했어요"   ← DB 에 정확히 반영됨
 *     사용자: 결혼식장 체크리스트 완료한 항목 알려줘
 *     아모라: 현재 결혼식장 체크리스트에서 **완료한 항목은 없어요.**
 *
 * 프롬프트에는 `할일: 1/9완료 … ✅venue_01` 이 정확히 실려 있었다(2026-08-24
 * 운영 실측). 모델이 고른 것은 `get_wedding_info` 였고, 그 도구는 **카테고리
 * 단위** 숫자만 준다 — `completed_count: 0` 은 "완료한 카테고리 0개"라는 뜻인데
 * 이름이 모호해서 "완료한 항목 0개"로 읽혔다.
 *
 * 예산 합계 때와 같은 부류다 — 자료는 맞는데 모델이 도구 쪽 숫자를 고른다.
 * 그러니 도구가 **세부 항목 수를 직접** 줘야 한다.
 */

const DONE_ITEM = "venue_01";

function makeCtx(progress: Record<string, unknown>): ToolExecutionContext {
  return {
    coupleId: "00000000-0000-0000-0000-000000000000",
    requestKey: "chat:00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000002",
    requestAttemptCount: 1,
    currentUserText: "",
    weddingContext: {
      weddingDate: "2027-05-15",
      budget: 62_000_000,
      venue: null,
      progress: progress as never,
    },
  };
}

const ONE_DONE: Record<string, unknown> = {
  venue: {
    category: "venue",
    status: "in_progress",
    checklist: [
      { id: DONE_ITEM, done: true, label: "원하는 결혼식장 형태 정하기" },
      { id: "venue_02", done: false, label: "비교할 장소 후보 정리" },
    ],
  },
};

describe("체크리스트 진행과 카테고리 진행을 구별한다", () => {
  it("완료한 세부 항목 수를 직접 준다", async () => {
    const result = await executeTool("get_wedding_info", {}, makeCtx(ONE_DONE));
    const out = result.toolOutput as {
      checklist_items_done: number;
      checklist_items_total: number;
      completed_categories: number;
    };
    expect(out.checklist_items_done).toBe(1);
    expect(out.checklist_items_total).toBeGreaterThan(1);
    // 카테고리는 여전히 0개 완료 — 둘은 다른 숫자다.
    expect(out.completed_categories).toBe(0);
  });

  it("표시 문구가 둘을 구별해 말한다", async () => {
    const result = await executeTool("get_wedding_info", {}, makeCtx(ONE_DONE));
    expect(result.displayMessage).toContain("카테고리 진행률");
    expect(result.displayMessage).toContain("체크리스트 항목 1/");
    // 맨 "진행률: 0%" 로 끝나면 모델이 세부 항목까지 0 으로 읽는다.
    expect(result.displayMessage).not.toMatch(/[^리]진행률: 0%$/);
  });

  it("하나도 안 했으면 0 으로 말한다", async () => {
    const result = await executeTool("get_wedding_info", {}, makeCtx({}));
    const out = result.toolOutput as { checklist_items_done: number; checklist_items_total: number };
    expect(out.checklist_items_done).toBe(0);
    expect(out.checklist_items_total).toBeGreaterThan(0);
  });

  it("저장값에 없는 항목도 템플릿 기준으로 센다", async () => {
    // 라벨과 마찬가지로 템플릿이 정본이다 — 저장값이 낡아도 총 개수는 안 흔들린다.
    const empty = await executeTool("get_wedding_info", {}, makeCtx({}));
    const partial = await executeTool("get_wedding_info", {}, makeCtx(ONE_DONE));
    const a = empty.toolOutput as { checklist_items_total: number };
    const b = partial.toolOutput as { checklist_items_total: number };
    expect(b.checklist_items_total).toBe(a.checklist_items_total);
  });

  /**
   * 2026-09-15: "안 해요"로 끈 분야가 진행률 분모와 항목 수에 들어가, 함·폐백·예단을 끈
   * 커플에게 아모라가 화면(`summarizePlanningChecklist`)보다 낮은 숫자를 말했다.
   * `get_schedule_summary` 는 이미 뺀다 — 같은 대화에서 두 도구가 다른 숫자를 말하면 안 된다.
   */
  it("안 해요로 끈 분야는 분야 진행률 분모와 항목 수에서 빼고, 화면과 같은 숫자를 준다", async () => {
    const skipped = ["ham", "pyebaek", "yedan"];
    const progress: Record<string, unknown> = {
      ...ONE_DONE,
      studio: { category: "studio", status: "completed" },
    };
    for (const key of skipped) progress[key] = { category: key, status: "not_applicable" };

    const result = await executeTool("get_wedding_info", {}, makeCtx(progress));
    const out = result.toolOutput as Record<string, number>;
    const screen = summarizePlanningChecklist(
      CATEGORY_CHECKLISTS,
      progress as Parameters<typeof summarizePlanningChecklist>[1],
    );
    const applicable = CATEGORY_CHECKLISTS.length - skipped.length;

    // 기존 키는 그대로 있고, 전체 분야 수는 여전히 전체다(일정 요약 도구의 total 과 같은 값).
    expect(out.total_categories).toBe(CATEGORY_CHECKLISTS.length);
    expect(out.applicable_categories).toBe(applicable);
    expect(out.not_applicable_categories).toBe(skipped.length);
    expect(out.completed_count).toBe(1);
    expect(out.progress_percent).toBe(Math.round((1 / applicable) * 100));
    expect(out.progress_percent).not.toBe(Math.round((1 / CATEGORY_CHECKLISTS.length) * 100));

    expect(out.checklist_items_done).toBe(screen.done);
    expect(out.checklist_items_total).toBe(screen.total);
    expect(out.checklist_percent).toBe(screen.percent);
    // 끈 분야의 항목까지 세던 옛 합계와 달라야 이 검사가 의미가 있다.
    const allItems = CATEGORY_CHECKLISTS.reduce((sum, category) => sum + category.items.length, 0);
    expect(out.checklist_items_total).toBeLessThan(allItems);

    const summary = await executeTool("get_schedule_summary", {}, makeCtx(progress));
    const summaryOut = summary.toolOutput as Record<string, number>;
    expect(out.progress_percent).toBe(summaryOut.progress_percent);
    expect(out.checklist_items_done).toBe(summaryOut.checklist_items_done);
    expect(out.checklist_items_total).toBe(summaryOut.checklist_items_total);

    expect(result.displayMessage).toContain(`(1/${applicable}, 안 해요 ${skipped.length}개 분야 제외)`);
    expect(result.displayMessage).toContain(`체크리스트 항목 ${screen.done}/${screen.total} 완료`);
  });
});
