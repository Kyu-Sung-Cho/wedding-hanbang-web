import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("budget financial semantics", () => {
  it("separates plan, signed contract total, paid amount, and next payment", () => {
    const source = read("src/components/app/budget/BudgetContent.tsx");

    expect(source).toContain("contractedTotal");
    expect(source).toContain("paidToDate");
    expect(source).toContain("nextPaymentAmount");
    expect(source).toContain("nextPaymentDate");
    expect(source).toContain("서명한 계약 총액");
    expect(source).toContain("실제 누적 납부액");
    expect(source).toContain("사용자가 직접 입력");
  });

  it("does not reuse checklist status or a default payer as financial truth", () => {
    const source = read("src/components/app/budget/BudgetContent.tsx");

    expect(source).not.toContain("PayerSelector");
    expect(source).not.toContain("getStatusLabel");
    expect(source).not.toContain("PayerType");
    expect(source).not.toContain('?? "couple"');
    expect(source).not.toContain("분담 현황");
  });

  it("excludes legacy unclassified amounts until the user reclassifies or removes them", () => {
    const source = read("src/components/app/budget/BudgetContent.tsx");

    expect(source).toContain("legacyUnclassifiedAmount");
    expect(source).toContain("합계에서 제외");
    expect(source).toContain('remove: ["spent", "cost", "payer"]');
    expect(source).not.toContain("calculateRecordedBudgetPosition");
  });

  it("shows only user-started financial records and keeps templates in an opt-in library", () => {
    const source = read("src/components/app/budget/BudgetContent.tsx");

    expect(source).toContain("hasFinancialRecord");
    expect(source).toContain("필요한 항목 추가");
    expect(source).toContain("선택 전에는 예산 기록으로 계산하지 않습니다");
  });

  it("gives Amora only separated user-entered financial facts", () => {
    const prompts = read("src/lib/ai/prompts.ts");
    const block = prompts.match(/function formatProgress[\s\S]*?function formatSchedules/)?.[0] ?? "";

    expect(block).toContain("contractedTotal");
    expect(block).toContain("paidToDate");
    expect(block).toContain("이전 미분류 금액·분담");
    expect(block).not.toContain("value.spent ?? value.cost");
    expect(block).not.toContain("미배정");
  });
});
