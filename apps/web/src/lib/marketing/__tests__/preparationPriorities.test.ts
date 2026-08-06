// @vitest-environment node

import { describe, expect, it } from "vitest";

import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import { computePreparationPriorities } from "../preparationPriorities";

/**
 * 랜딩과 `/start-here`가 같은 3가지를 보여준다는 계약.
 *
 * 랜딩이 "날짜를 넣으면 준비 3가지가 나와요"라고 약속하고 그 자리에서 결과를
 * 보여주므로, 이 계산이 틀리면 첫 화면에서 바로 틀린 안내가 된다.
 */

describe("computePreparationPriorities", () => {
  it("returns nothing without a usable date", () => {
    expect(computePreparationPriorities(null).visiblePriorities).toEqual([]);
    // 이미 지난 날짜에 "지금 알아볼 것"을 말하면 틀린 안내가 된다.
    expect(computePreparationPriorities(-1).visiblePriorities).toEqual([]);
  });

  it("always shows three once a future date is given", () => {
    for (const dday of [0, 30, 120, 300, 400, 900]) {
      const { visiblePriorities } = computePreparationPriorities(dday);
      expect(visiblePriorities, `D-${dday}`).toHaveLength(3);
      // 같은 항목을 두 번 보여주지 않는다.
      expect(new Set(visiblePriorities.map((p) => p.key)).size, `D-${dday}`).toBe(3);
    }
  });

  it("puts already-started items first, soonest deadline leading", () => {
    const { activeNow, visiblePriorities } = computePreparationPriorities(200);
    expect(activeNow.length).toBeGreaterThan(0);

    for (const item of activeNow) expect(item.started).toBe(true);
    // 시작한 항목은 마감이 가까운 순.
    const deadlines = activeNow.map((p) => p.daysUntilDeadline);
    expect([...deadlines].sort((a, b) => a - b)).toEqual(deadlines);
    // 시작한 항목이 화면 앞자리를 차지한다.
    expect(visiblePriorities.slice(0, activeNow.length).map((p) => p.key))
      .toEqual(activeNow.map((p) => p.key));
  });

  it("falls back to upcoming items when nothing has started yet", () => {
    // 아주 먼 날짜에는 시작점을 지난 항목이 없을 수 있다. 그래도 빈손으로
    // 돌려보내지 않고 다가오는 순서를 보여준다.
    const far = Math.max(...CATEGORY_CHECKLISTS.map((c) => c.ddayStart)) + 100;
    const { activeNow, visiblePriorities } = computePreparationPriorities(far);
    expect(activeNow).toEqual([]);
    expect(visiblePriorities).toHaveLength(3);
    for (const item of visiblePriorities) expect(item.started).toBe(false);
  });

  it("carries first steps a first-timer can act on", () => {
    for (const item of computePreparationPriorities(150).visiblePriorities) {
      expect(item.firstSteps.length).toBeGreaterThan(0);
      expect(item.firstSteps.length).toBeLessThanOrEqual(3);
      for (const step of item.firstSteps) expect(step.trim().length).toBeGreaterThan(0);
      expect(item.label.trim().length).toBeGreaterThan(0);
    }
  });

  it("honours the skip set so the two screens can diverge only by user choice", () => {
    const base = computePreparationPriorities(200).visiblePriorities;
    const dropped = base[0].key;
    const after = computePreparationPriorities(200, { skipped: new Set([dropped]) });
    expect(after.visiblePriorities.map((p) => p.key)).not.toContain(dropped);
    expect(after.visiblePriorities).toHaveLength(3);
  });
});
