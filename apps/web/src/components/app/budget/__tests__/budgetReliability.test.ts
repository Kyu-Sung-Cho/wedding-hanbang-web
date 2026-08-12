// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const webBudgetSource = readFileSync(
  resolve(process.cwd(), "src/components/app/budget/BudgetContent.tsx"),
  "utf8",
);
const chatBudgetTabSource = readFileSync(
  resolve(process.cwd(), "src/components/app/chat/panel/BudgetTab.tsx"),
  "utf8",
);
const mobileBudgetSource = readFileSync(
  resolve(process.cwd(), "../mobile/app/budget/index.tsx"),
  "utf8",
);
const dashboardSource = readFileSync(
  resolve(process.cwd(), "src/app/(app)/dashboard/page.tsx"),
  "utf8",
);
const loungeSource = readFileSync(
  resolve(process.cwd(), "src/app/(app)/lounge/page.tsx"),
  "utf8",
);
const toolExecutorSource = readFileSync(
  resolve(process.cwd(), "src/lib/ai/toolExecutor.ts"),
  "utf8",
);
const atomicToolSource = readFileSync(
  resolve(process.cwd(), "src/lib/ai/amoraAtomicToolOperation.ts"),
  "utf8",
);
const actionCardSource = readFileSync(
  resolve(process.cwd(), "src/components/app/chat/ActionCard.tsx"),
  "utf8",
);
const planningConstantsSource = readFileSync(
  resolve(process.cwd(), "src/lib/ai/tools/planningConstants.ts"),
  "utf8",
);

describe("예산 계산의 소비자 신뢰 경계", () => {
  it.each([
    ["웹", webBudgetSource],
    ["모바일", mobileBudgetSource],
    ["아모라 조회 도구", toolExecutorSource],
    ["아모라 변경 도구", atomicToolSource],
    ["아모라 결과 카드", actionCardSource],
    ["공통 예산 카테고리", planningConstantsSource],
  ])("%s은 입력하지 않은 항목별 예산을 임의 비율로 만들지 않는다", (_name, source) => {
    expect(source).not.toMatch(/\bratio:\s*0\.\d+/);
    expect(source).not.toMatch(/totalBudget\s*\*\s*\w+\.ratio/);
    expect(source).not.toContain("CATEGORY_RATIOS");
  });

  it("웹과 모바일 모두 직접 입력한 항목별 예산만 합산한다고 알린다", () => {
    expect(webBudgetSource).toContain("직접 입력하거나 계약 금액으로 확인된 예산만 합산합니다");
    expect(mobileBudgetSource).toContain("직접 입력하거나 계약 금액으로 확인된 예산만 합산해요");
    expect(webBudgetSource).toContain("예산 입력 전");
    expect(mobileBudgetSource).toContain("예산 입력 전");
  });

  it("웹은 총 예산 미입력을 0원이나 예산 초과로 오인하지 않는다", () => {
    expect(webBudgetSource).toContain("const hasTotalBudget = totalBudget > 0");
    expect(webBudgetSource).toContain(
      "const isOverBudget = remaining !== null && remaining < 0",
    );
    expect(webBudgetSource).toContain("총 예산을 입력하면 남은 금액을 계산해요");
  });

  it("웹과 모바일 모두 legacy cost를 예산이나 기록 지출 합계로 승격하지 않는다", () => {
    expect(webBudgetSource).not.toMatch(/getCategoryBudget[\s\S]{0,500}normalizeCost\(item\?\.cost\)/);
    expect(webBudgetSource).not.toMatch(/getCategorySpent[\s\S]{0,500}normalizeCost\(item\?\.cost\)/);
    expect(mobileBudgetSource).not.toMatch(/getCatBudget[\s\S]{0,500}normalizeCost\(item\?\.cost\)/);
    expect(mobileBudgetSource).not.toMatch(/getCatSpent[\s\S]{0,500}normalizeCost\(item\?\.cost\)/);
    expect(webBudgetSource).toContain("용도 미확인 이전 금액");
    expect(mobileBudgetSource).toContain("용도 미확인 이전 금액");
    expect(dashboardSource).not.toMatch(/spent\s*\?\?\s*item\.cost/);
    expect(loungeSource).not.toMatch(/spent\s*\?\?\s*item\.cost/);
    expect(dashboardSource).toContain("명시적으로 기록한 지출만 합산");
    expect(loungeSource).toContain("명시적으로 기록한 지출만 합산");
  });

  it("웹과 모바일 예산 상태 라벨도 항목별 체크 근거를 정본으로 쓴다", () => {
    expect(webBudgetSource).toContain("getEffectivePlanningChecklistStatus");
    expect(chatBudgetTabSource).toContain("getEffectivePlanningChecklistStatus");
    expect(mobileBudgetSource).toContain("getEffectivePlanningChecklistStatus");
    expect(webBudgetSource).not.toMatch(/const status = item\?\.status \?\? "not_started"/);
    expect(mobileBudgetSource).not.toMatch(/const s = progress\[key\]\?\.status \?\? "not_started"/);
  });

  it("모바일 분담 이름은 축약어 대신 처음 보는 사람도 이해할 수 있게 쓴다", () => {
    expect(mobileBudgetSource).toContain('label: "예비 신부 가족"');
    expect(mobileBudgetSource).toContain('label: "예비 신랑 가족"');
    expect(mobileBudgetSource).not.toContain('label: "신부측"');
    expect(mobileBudgetSource).not.toContain('label: "신랑측"');
  });

  it("핵심 예산 화면에 은퇴한 예약 관리나 설명 없는 업계 용어를 남기지 않는다", () => {
    expect(webBudgetSource).not.toContain("BookingsSection");

    const unclearTerms =
      /원본 파일|보정본|혼주|리허설|부토니에|폐백실|글러브|슈즈/;
    expect(webBudgetSource).not.toMatch(unclearTerms);
    expect(mobileBudgetSource).not.toMatch(unclearTerms);
  });
});
