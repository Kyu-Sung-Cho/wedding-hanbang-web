import { describe, expect, it } from "vitest";

import { formatDisclosurePeriod, priceDisclosureLines } from "./period";

describe("formatDisclosurePeriod", () => {
  it("turns snapshot labels into calm Korean date labels", () => {
    expect(formatDisclosurePeriod("2026Q3")).toBe("2026년 3분기");
    expect(formatDisclosurePeriod("2026-07")).toBe("2026년 7월");
    expect(formatDisclosurePeriod(" 2026Q4 ")).toBe("2026년 4분기");
    expect(formatDisclosurePeriod("기간 미정")).toBe("기간 미정");
  });
});

describe("priceDisclosureLines", () => {
  it("returns the exact two disclosure sentences required on price screens", () => {
    expect(priceDisclosureLines("2026Q3")).toEqual([
      "가격 출처: 한국소비자원 참가격 · 2026년 3분기 공시 기준",
      "본 정보는 공시 기준이며 실제 계약 조건·시점에 따라 달라질 수 있습니다. 계약 전 업체에 직접 확인하세요.",
    ]);
  });
});
