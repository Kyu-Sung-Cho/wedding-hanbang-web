import { describe, expect, it } from "vitest";

import { krwRangeLabel, krwToManwonLabel } from "./krw";

describe("krwToManwonLabel", () => {
  it("formats consumer prices in manwon without hiding half-manwon boundaries", () => {
    expect(krwToManwonLabel(0)).toBe("0만원");
    expect(krwToManwonLabel(5_000)).toBe("0.5만원");
    expect(krwToManwonLabel(1_000_000)).toBe("100만원");
    expect(krwToManwonLabel(12_345_000)).toBe("1,234.5만원");
    expect(krwToManwonLabel(null)).toBe("가격 확인 필요");
  });
});

describe("krwRangeLabel", () => {
  it("uses one label for equal values and a compact range otherwise", () => {
    expect(krwRangeLabel(1_020_000, 1_290_000)).toBe("102~129만원");
    expect(krwRangeLabel(1_000_000, 1_000_000)).toBe("100만원");
    expect(krwRangeLabel(null, null)).toBe("가격 확인 필요");
  });
});
