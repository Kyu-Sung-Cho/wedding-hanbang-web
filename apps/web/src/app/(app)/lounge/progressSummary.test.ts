import { describe, expect, it } from "vitest";

import { CATEGORY_CHECKLISTS } from "@hanbang/shared/constants";
import { summarizePlanningChecklist } from "@hanbang/shared/utils";
import type { ProgressItem } from "@/types/database.types";
import { getActiveCategories, getProgressSummary, getStatus } from "@/app/(app)/lounge/progressSummary";

/**
 * 라운지와 체크리스트 화면이 **같은 진행률**을 내는가.
 *
 * 2026-08-20까지 아니었다. `getStatus`의 화이트리스트에 `not_applicable`이 빠져 있어서
 * 끈 분야가 `not_started`로 뭉개졌고, 그래서 바로 아래 not_applicable 분기와 그 위에
 * 달린 주석("함·폐백·예단을 생략한 커플이 영원히 미완료로 남지 않게")이 **도달할 수 없는
 * 죽은 코드**였다. 체크리스트 화면은 `summarizePlanningChecklist`로 끈 분야를 분모에서
 * 빼는데 라운지는 넣어, 같은 계정에서 진행률이 서로 다르게 보였다.
 */
const SKIPPED = ["ham", "pyebaek", "yedan"];

function progressWith(skipped: string[]): Record<string, ProgressItem> {
  const progress: Record<string, ProgressItem> = {};
  for (const category of CATEGORY_CHECKLISTS) {
    progress[category.key] = {
      category: category.key,
      status: skipped.includes(category.key) ? "not_applicable" : "not_started",
      checklist: category.items.map((item) => ({ ...item, done: false })),
    } as ProgressItem;
  }
  return progress;
}

describe("라운지 진행률", () => {
  it("해당 없음으로 끈 상태를 그대로 읽는다", () => {
    const progress = progressWith(SKIPPED);
    for (const key of SKIPPED) {
      expect(getStatus(progress, key), `${key}`).toBe("not_applicable");
    }
  });

  it("끈 분야를 분모에서 뺀다 — 체크리스트 화면과 같은 숫자", () => {
    const progress = progressWith(SKIPPED);

    const lounge = getProgressSummary(progress);
    const checklistScreen = summarizePlanningChecklist(CATEGORY_CHECKLISTS, progress);

    expect(lounge.total, "분모").toBe(checklistScreen.total);
    expect(lounge.done, "분자").toBe(checklistScreen.done);
    expect(lounge.not_applicable).toBe(SKIPPED.length);
  });

  it("아무것도 끄지 않은 커플은 전체가 분모다", () => {
    const progress = progressWith([]);
    const lounge = getProgressSummary(progress);
    const everyItem = CATEGORY_CHECKLISTS.reduce((sum, c) => sum + c.items.length, 0);

    expect(lounge.total).toBe(everyItem);
    expect(lounge.not_applicable).toBe(0);
  });

  it("끈 분야는 할 일 목록에도 안 뜬다", () => {
    // 남겨 두면 함·폐백을 생략한 커플에게 영원히 지워지지 않는 할 일이 보인다.
    const active = getActiveCategories(progressWith(SKIPPED), 100);
    const leaked = active.filter((item) => SKIPPED.includes(item.category.key));
    expect(leaked.map((i) => i.category.key), "끈 분야가 할 일에 남음").toEqual([]);
  });
});
