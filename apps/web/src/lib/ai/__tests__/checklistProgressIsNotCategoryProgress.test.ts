import { describe, expect, it, vi } from "vitest";

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
});
