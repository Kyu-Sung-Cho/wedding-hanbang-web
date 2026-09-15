import { beforeEach, describe, expect, it, vi } from "vitest";

import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import { summarizePlanningChecklist } from "@hanbang/shared/utils";
import { CATEGORY_LABELS, SCREEN_CATEGORY_LABELS } from "@/lib/ai/tools/planningConstants";
import { patchJourneyProgress } from "@/lib/ai/tools/progressTools";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";
import { executeGetScheduleSummary, executeToggleChecklistItem } from "@/lib/ai/tools/scheduleTools";

vi.mock("@/lib/ai/tools/progressTools", () => ({
  patchJourneyProgress: vi.fn(async () => undefined),
  saveProgress: vi.fn(async () => undefined),
}));

function contextWith(progress: Record<string, unknown>): ToolExecutionContext {
  return {
    coupleId: "couple-1",
    weddingContext: {
      weddingDate: "2027-04-10",
      budget: 50_000_000,
      venue: null,
      progress: progress as ToolExecutionContext["weddingContext"]["progress"],
    },
  };
}

/**
 * 아모라의 `get_schedule_summary`가 화면과 같은 진행률을 말하는가.
 *
 * 2026-09-15까지 "안 해요"로 끈 분야는 완료·진행 중·시작 전 어느 목록에도 없으면서
 * 진행률 분모에는 들어갔다. 체크리스트·일정 화면(`summarizePlanningChecklist`)은 끈 분야를
 * 분모에서 빼므로, 함·폐백·예단을 끈 커플에게 아모라만 더 낮은 숫자를 말했다.
 */
describe("get_schedule_summary 는 끈 분야를 따로 싣고 분모에서 뺀다", () => {
  const SKIPPED = ["ham", "pyebaek", "yedan"];

  function progressWithSkipped() {
    const progress: Record<string, unknown> = {
      venue: { category: "venue", status: "completed" },
      studio: {
        category: "studio",
        status: "in_progress",
        checklist: CATEGORY_CHECKLISTS.find((c) => c.key === "studio")!.items.map((item, index) => ({
          id: item.id, label: item.label, done: index < 3,
        })),
      },
    };
    for (const key of SKIPPED) progress[key] = { category: key, status: "not_applicable" };
    return progress;
  }

  it("끈 분야 목록이 있고, 네 목록을 합치면 전체가 된다", () => {
    const { toolOutput } = executeGetScheduleSummary(contextWith(progressWithSkipped()));

    // 순서는 템플릿 순서다.
    expect(toolOutput.not_applicable).toEqual(
      CATEGORY_CHECKLISTS.filter(({ key }) => SKIPPED.includes(key)).map(({ key }) => CATEGORY_LABELS[key]),
    );
    const listed = (["completed", "in_progress", "not_started", "not_applicable"] as const)
      .reduce((sum, bucket) => sum + (toolOutput[bucket] as unknown[]).length, 0);
    expect(listed).toBe(CATEGORY_CHECKLISTS.length);
    expect(toolOutput.total).toBe(CATEGORY_CHECKLISTS.length);
    expect(toolOutput.applicable_total).toBe(CATEGORY_CHECKLISTS.length - SKIPPED.length);
  });

  it("분야 진행률의 분모에서 끈 분야를 뺀다", () => {
    const { toolOutput } = executeGetScheduleSummary(contextWith(progressWithSkipped()));
    const applicable = CATEGORY_CHECKLISTS.length - SKIPPED.length;

    expect(toolOutput.progress_percent).toBe(Math.round((1 / applicable) * 100));
    // 끈 분야를 분모에 넣던 옛 계산과는 달라야 이 검사가 의미가 있다.
    expect(toolOutput.progress_percent).not.toBe(Math.round((1 / CATEGORY_CHECKLISTS.length) * 100));
  });

  it("화면의 항목 기준 진행률과 같은 숫자를 싣고 카드 문구에도 쓴다", () => {
    const progress = progressWithSkipped();
    const result = executeGetScheduleSummary(contextWith(progress));
    const screen = summarizePlanningChecklist(
      CATEGORY_CHECKLISTS,
      progress as Parameters<typeof summarizePlanningChecklist>[1],
    );

    expect(result.toolOutput).toMatchObject({
      checklist_items_done: screen.done,
      checklist_items_total: screen.total,
      checklist_percent: screen.percent,
    });
    expect(screen.done).toBeGreaterThan(0);
    expect(result.displayMessage).toContain(`안 해요 ${SKIPPED.length}개`);
    expect(result.displayMessage).toContain(`${screen.total}개 중 ${screen.done}개 완료(${screen.percent}%)`);
    expect(result.displayMessage).toContain("안 해요 분야는 빼고 셌어요");
    expect(result.displayMessage).toContain("기본 준비 카테고리");
    expect(result.displayMessage).not.toMatch(/습니다|됩니다/u);
  });

  it("끈 분야가 없으면 안 해요를 말하지 않는다", () => {
    const result = executeGetScheduleSummary(contextWith({ venue: { category: "venue", status: "completed" } }));

    expect(result.toolOutput.not_applicable).toEqual([]);
    expect(result.toolOutput.applicable_total).toBe(CATEGORY_CHECKLISTS.length);
    expect(result.displayMessage).not.toContain("안 해요");
  });

  it("전부 끈 커플도 숫자가 깨지지 않는다", () => {
    const progress = Object.fromEntries(
      CATEGORY_CHECKLISTS.map(({ key }) => [key, { category: key, status: "not_applicable" }]),
    );
    const result = executeGetScheduleSummary(contextWith(progress));

    expect(result.toolOutput.applicable_total).toBe(0);
    expect(result.toolOutput.progress_percent).toBe(0);
    expect(result.toolOutput.checklist_percent).toBe(0);
    expect(result.displayMessage).not.toContain("NaN");
  });
});

/**
 * 옛 `toggle_checklist_item` 경로의 영수증도 화면 이름을 쓰는가.
 *
 * 원자 실행 경로는 2026-09-15에 `SCREEN_CATEGORY_LABELS`로 바꿨다. 이 경로만 모델 문맥용
 * 원명칭("예단")을 써서, 체크리스트 화면에는 다른 이름으로 보이는 분야의 영수증이 나갔다.
 */
describe("toggle_checklist_item 영수증은 화면의 분야 이름을 쓴다", () => {
  beforeEach(() => {
    vi.mocked(patchJourneyProgress).mockClear();
  });

  it("예단 분야는 화면 이름으로 쓴다", async () => {
    // 전제: 두 이름이 달라야 이 검사가 무언가를 본다.
    expect(SCREEN_CATEGORY_LABELS.yedan).not.toBe(CATEGORY_LABELS.yedan);
    const item = CATEGORY_CHECKLISTS.find((c) => c.key === "yedan")!.items[0];

    const result = await executeToggleChecklistItem(
      { category: "yedan", item_id: item.id, done: true },
      contextWith({}),
    );

    expect(result.success).toBe(true);
    expect(patchJourneyProgress).toHaveBeenCalledTimes(1);
    expect(result.displayMessage).toBe(
      `${SCREEN_CATEGORY_LABELS.yedan}의 "${item.label}" 항목을 완료로 변경했어요.`,
    );
    expect(result.displayMessage.startsWith(`${CATEGORY_LABELS.yedan}의`)).toBe(false);
  });

  it("미완료로 되돌리는 영수증도 같은 모양이다", async () => {
    const item = CATEGORY_CHECKLISTS.find((c) => c.key === "pyebaek")!.items[0];

    const result = await executeToggleChecklistItem(
      { category: "pyebaek", item_id: item.id, done: false },
      contextWith({}),
    );

    expect(result.displayMessage).toBe(
      `${SCREEN_CATEGORY_LABELS.pyebaek}의 "${item.label}" 항목을 미완료로 변경했어요.`,
    );
  });
});
