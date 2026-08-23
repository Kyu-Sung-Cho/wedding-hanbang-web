import { describe, expect, it } from "vitest";

import { getActiveCategories } from "./progressSummary";
import { getWeeklyImminentCategories } from "@/utils/imminentChecklist";
import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import type { ProgressItem } from "@/types/database.types";

/**
 * 라운지가 같은 분야를 한 화면에 두 번 그리지 않는지 본다.
 *
 * 주차 카드의 「곧 확인할 분야」와 그 아래 「놓치기 쉬운 항목」은 서로 다른 함수로
 * 골랐지만 **둘 다 기본 확인 시점이 가까운 분야를 앞에 놓는다.** 그래서 같은 분야가
 * 위아래로 두 번, 문구까지 같게 나왔다 — 양쪽 다 `기본 확인 시점까지 N일`이다
 * (`WeeklyCard.tsx`의 배지, `lounge/page.tsx`의 `CategoryRow`).
 *
 * 고치는 방법은 아래쪽 목록에서 위쪽이 이미 그린 것을 빼는 것이고, 그 판정은
 * `getWeeklyImminentCategories` 한 곳에서 나온다. 두 곳이 각자 계산하면 정렬 기준이
 * 조금만 달라져도 겹침이 조용히 돌아온다.
 *
 * 그래서 이 검사는 **화면 문구가 아니라 두 선택 함수의 교집합**을 본다.
 */
describe("라운지는 같은 분야를 두 번 그리지 않는다", () => {
  /** 결혼일을 오늘로부터 N일 뒤로. 임박 창(기본 확인 시점까지 60일)을 열기 위한 값. */
  function weddingInDays(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function ddayFrom(weddingDate: string): number {
    const wedding = new Date(weddingDate);
    wedding.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((wedding.getTime() - today.getTime()) / 86_400_000);
  }

  /** 분야 몇 개를 진행 중으로 만든다 — 「놓치기 쉬운 항목」의 정렬이 바뀌는 조건이다. */
  function progressWithInProgress(count: number): Record<string, ProgressItem> {
    const progress: Record<string, ProgressItem> = {};
    for (const category of CATEGORY_CHECKLISTS.slice(0, count)) {
      progress[category.key] = {
        status: "in_progress",
        checklist: category.items.map((item, index) => ({
          ...item,
          done: index === 0,
        })),
      } as ProgressItem;
    }
    return progress;
  }

  it("판별식이 실제로 무언가를 고른다", () => {
    // 임박 목록이 비어 있으면 아래 검사들은 아무것도 안 보고 통과한다.
    const weddingDate = weddingInDays(350);
    const weekly = getWeeklyImminentCategories({}, weddingDate);
    expect(weekly.length, "임박 표본이 비었다 — 아래 검사가 무의미해진다").toBeGreaterThan(0);
    expect(getActiveCategories({}, ddayFrom(weddingDate)).length).toBeGreaterThan(0);
  });

  it("주차 카드가 그린 분야는 아래 목록에 다시 안 나온다", () => {
    // 진행 중 분야 수를 바꿔 가며 본다. 정렬 기준이 서로 달라지는 지점이 여기다.
    for (const inProgressCount of [0, 1, 3, 5, 8]) {
      for (const daysToWedding of [40, 120, 200, 350]) {
        const weddingDate = weddingInDays(daysToWedding);
        const progress = progressWithInProgress(inProgressCount);
        const weekly = getWeeklyImminentCategories(progress, weddingDate);
        const weeklyKeys = new Set(weekly.map((item) => item.key));
        const active = getActiveCategories(progress, ddayFrom(weddingDate), weeklyKeys);

        const overlap = active
          .map((item) => item.category.key)
          .filter((key) => weeklyKeys.has(key));

        expect(
          overlap,
          `진행중 ${inProgressCount}개 · D-${daysToWedding}: 같은 분야가 한 화면에 두 번 나온다`,
        ).toEqual([]);
      }
    }
  });

  it("빼기가 목록을 짧게 만들지 않는다", () => {
    // 빼는 자리가 `slice(0, 6)` 뒤였다면 목록이 3개로 줄어든다. 앞이어야 한다.
    const weddingDate = weddingInDays(350);
    const dday = ddayFrom(weddingDate);
    const weeklyKeys = new Set(
      getWeeklyImminentCategories({}, weddingDate).map((item) => item.key),
    );
    const before = getActiveCategories({}, dday);
    const after = getActiveCategories({}, dday, weeklyKeys);

    expect(weeklyKeys.size).toBeGreaterThan(0);
    expect(
      after.length,
      "빼기가 slice 뒤에서 일어나 목록이 짧아졌다",
    ).toBe(before.length);
  });

  it("결혼일이 없으면 아무것도 빼지 않는다", () => {
    // 임박 판정은 결혼일이 없으면 빈 배열이다. 그때 아래 목록이 줄어들면 안 된다.
    for (const weddingDate of [null, undefined, "", "말도 안 되는 날짜"]) {
      const weekly = getWeeklyImminentCategories({}, weddingDate);
      expect(weekly).toEqual([]);
    }
    expect(getActiveCategories({}, null, new Set()).length).toBeGreaterThan(0);
  });
});
