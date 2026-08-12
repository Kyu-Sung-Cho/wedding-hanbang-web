import { describe, expect, it } from "vitest";

import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import { buildPhases } from "./TimelineView";

describe("일정 단계 구간", () => {
  it("각 단계의 날짜 범위와 월 표기가 같은 기준을 사용한다", () => {
    const phases = buildPhases();

    expect(phases.map((phase) => phase.dday)).toEqual([
      "D-540 ~ D-300",
      "D-270 ~ D-240",
      "D-180 ~ D-120",
      "D-90 ~ D-60",
      "D-day ~ D+30",
    ]);
    expect(phases.map((phase) => phase.period)).toEqual([
      "약 18~10개월 전",
      "약 9~8개월 전",
      "약 6~4개월 전",
      "약 3~2개월 전",
      "결혼식 뒤 30일",
    ]);
  });

  it("기본 카테고리를 빠뜨리거나 두 단계에 중복 배치하지 않는다", () => {
    const phaseKeys = buildPhases().flatMap((phase) =>
      phase.categories.map((category) => category.key),
    );
    const templateKeys = CATEGORY_CHECKLISTS.map((category) => category.key);

    expect(new Set(phaseKeys).size).toBe(phaseKeys.length);
    expect([...phaseKeys].sort()).toEqual([...templateKeys].sort());
  });
});
