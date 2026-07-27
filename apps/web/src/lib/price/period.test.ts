import { describe, expect, it } from "vitest";

import {
  DISCLOSURE_ROUND,
  disclosureRoundLabel,
  formatDisclosurePeriod,
  priceDisclosureLines,
} from "./period";

describe("formatDisclosurePeriod", () => {
  it("turns snapshot labels into calm Korean date labels", () => {
    expect(formatDisclosurePeriod("2026Q3")).toBe("2026년 3분기");
    expect(formatDisclosurePeriod("2026-07")).toBe("2026년 7월");
    expect(formatDisclosurePeriod(" 2026Q4 ")).toBe("2026년 4분기");
    expect(formatDisclosurePeriod("기간 미정")).toBe("기간 미정");
  });
});

/**
 * 소비자에게 보이는 기준 시점은 **내부 스냅샷 이름과 분리**한다.
 *
 * 2026-07-27 운영 실측: `price_snapshots.period_label`은 `2026Q3`인데 원본 공시는
 * 한국소비자원 참가격 "결혼서비스 중요정보 공개" **2025-11-12~13 라운드**다.
 * 스냅샷 이름을 그대로 렌더해 화면이 "2026년 3분기 공시 기준"이라고 주장했다.
 * 유통 글 본문은 "2025년 11월부터 의무화"라고 쓰는데 도착 화면이 어긋난 상태였다.
 */
describe("disclosureRoundLabel", () => {
  it("확인된 공시 라운드를 쓴다 — 스냅샷 이름이 아니다", () => {
    expect(DISCLOSURE_ROUND).toBe("2025-11");
    expect(disclosureRoundLabel()).toBe("2025년 11월");
  });

  it("내부 스냅샷 이름이 기준 시점으로 새지 않는다", () => {
    // `2026Q3`은 우리 스냅샷 이름이다. 소비자 문구에 나오면 안 된다.
    expect(disclosureRoundLabel()).not.toContain("분기");
    expect(priceDisclosureLines()[0]).not.toContain("2026");
  });
});

describe("priceDisclosureLines", () => {
  it("returns the exact two disclosure sentences required on price screens", () => {
    // 스냅샷 이름을 인수로 받지 않는다 — 받게 두면 또 새어 나간다.
    expect(priceDisclosureLines()).toEqual([
      "가격 출처: 한국소비자원 참가격 · 2025년 11월 공시 기준",
      "본 정보는 공시 기준이며 실제 계약 조건·시점에 따라 달라질 수 있습니다. 계약 전 업체에 직접 확인하세요.",
    ]);
  });
});
