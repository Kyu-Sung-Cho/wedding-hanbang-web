import { describe, expect, it } from "vitest";

import { CATEGORY_CHECKLISTS } from "@hanbang/shared/constants";
import { CHECKLIST_AGREED_DATE, summarizePlanningChecklist } from "@hanbang/shared/utils";
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

/**
 * 「놓치기 쉬운 항목」의 순서가 일정 화면의 임박 알림과 같은 기준인가.
 *
 * 임박 알림(`getImminentCategories`)과 아모라 가드레일은 **아직 안 끝낸 항목 중 가장 이른
 * 기본 확인 시점**으로 센다. 여기만 분야 `ddayDeadline`으로 세면, 이른 일을 다 끝내고 촬영 뒤
 * 사진 고르기(90일 전)만 남은 사진 촬영 분야가 D-120에 "30일 지난 분야"로 목록 맨 앞에 온다.
 */
describe("라운지 할 일 순서는 남은 항목의 기본 확인 시점으로 센다", () => {
  const DDAY = 120;

  function progressWith(entries: Record<string, (item: { id: string; due?: unknown }, index: number) => boolean>) {
    const progress: Record<string, ProgressItem> = {};
    for (const category of CATEGORY_CHECKLISTS) {
      const isDone = entries[category.key];
      progress[category.key] = isDone
        ? ({
            category: category.key,
            status: "in_progress",
            checklist: category.items.map((item, index) => ({ id: item.id, label: item.label, done: isDone(item, index) })),
          } as ProgressItem)
        : ({ category: category.key, status: "completed" } as ProgressItem);
    }
    return progress;
  }

  it("이른 일을 끝낸 분야가 방금 시작한 분야보다 앞서지 않는다", () => {
    const studio = CATEGORY_CHECKLISTS.find((category) => category.key === "studio")!;
    const dress = CATEGORY_CHECKLISTS.find((category) => category.key === "dress")!;
    // 전제: 사진 촬영은 분야 시점(150일 전)보다 늦은 항목(90일 전)이 있고, 드레스는 120일 전이다.
    expect(studio.ddayDeadline).toBe(150);
    expect(dress.ddayDeadline).toBe(120);

    const active = getActiveCategories(
      progressWith({
        studio: (item) => item.due === undefined,
        dress: (_item, index) => index === 0,
      }),
      DDAY,
    );

    expect(active.map((item) => item.category.key)).toEqual(["dress", "studio"]);
    expect(active.find((item) => item.category.key === "studio")?.daysUntilDeadline).toBe(30);
    expect(active.find((item) => item.category.key === "dress")?.daysUntilDeadline).toBe(0);
  });

  it("남은 일이 약속한 날에 하는 일뿐이면 날짜를 모르므로 맨 뒤로 간다", () => {
    const active = getActiveCategories(
      progressWith({
        studio: (item) => item.due !== CHECKLIST_AGREED_DATE,
        dress: (_item, index) => index === 0,
      }),
      DDAY,
    );

    expect(active.map((item) => item.category.key)).toEqual(["dress", "studio"]);
    expect(active.find((item) => item.category.key === "studio")?.daysUntilDeadline).toBeNull();
  });

  it("아무것도 체크하지 않은 커플은 예전과 같은 일수다", () => {
    // 불변식: 항목 기록이 없으면 "지금 기준" 시점은 분야 `ddayDeadline`과 같다.
    for (const item of getActiveCategories({}, 200)) {
      expect(item.daysUntilDeadline, item.category.key).toBe(200 - item.category.ddayDeadline);
    }
  });
});
