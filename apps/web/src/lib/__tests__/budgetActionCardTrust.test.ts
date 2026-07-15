import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Amora budget action card", () => {
  it("shows only separated user-entered financial facts and never invents allocations", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/app/chat/ActionCard.tsx"),
      "utf8"
    );

    expect(source).not.toContain("CATEGORY_RATIOS");
    expect(source).not.toMatch(/totalBudget\s*\*/);
    expect(source).toContain("contractedTotal");
    expect(source).toContain("paidToDate");
    expect(source).toContain("계약 총액");
    expect(source).toContain("누적 납부");
    expect(source).not.toContain("totalSpent");
    expect(source).not.toContain("totalPct");
  });

  it("renders official market data as a sourced reference instead of a completed action", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/app/chat/ActionCard.tsx"),
      "utf8"
    );

    expect(source).toContain('result.toolName === "get_market_price"');
    expect(source).toContain("공식 시장 조사 참고");
    expect(source).toContain("sourceUrl");
    expect(source).toContain('target="_blank"');
    expect(source).toContain("개인 견적의 적정성이나 계약 안전성을 판정하지 않습니다");
  });
});
