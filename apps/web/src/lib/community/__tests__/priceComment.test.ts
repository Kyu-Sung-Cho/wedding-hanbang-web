import { describe, expect, it } from "vitest";
import { buildSourceBackedPriceComment } from "../priceComment";

describe("community price comment after static market retirement", () => {
  it("does not invent an aggregate comparison when no published benchmark is connected", () => {
    const comment = buildSourceBackedPriceComment({
      vendor_category: "studio",
      vendor_name: "샘플스튜디오A",
      base_price: 320,
      extra_price: 20,
      region: "서울",
    });

    expect(comment.comparison).toBe("unknown");
    expect(comment.reference).toBe("공식 비교 기준 부족 · 평균 단정 안 함");
    expect(comment.text).toContain("평균 단정은 하지 않을게요");
    expect(comment.text).not.toMatch(/\d[\d,.]*만원/u);
    expect(comment.text).not.toContain("최신 참가격 기준");
  });
});
