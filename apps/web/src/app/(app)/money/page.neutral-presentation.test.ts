import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const moneyPageSource = readFileSync(
  resolve(process.cwd(), "src/app/(app)/money/page.tsx"),
  "utf8",
);

describe("money side presentation", () => {
  it("uses the same identity-bound neutral family labels as budget", () => {
    expect(moneyPageSource).toContain("resolveBudgetPayerOptions");
    expect(moneyPageSource).toContain("member_model_version");
    expect(moneyPageSource).toContain("sideOptions");
    expect(moneyPageSource).not.toContain("신랑 / 신부");
    expect(moneyPageSource).not.toContain("예비 신랑 가족");
    expect(moneyPageSource).not.toContain("예비 신부 가족");
    expect(moneyPageSource).not.toContain("이름,금액,신랑/신부");
  });
});
