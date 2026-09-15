import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { listBudgetCategories } from "../lib/budgetCategoryRegistry.mjs";

const fixedCategories = [
  { key: "venue", label: "웨딩홀" },
  { key: "studio", label: "스튜디오" },
];

test("custom budget categories participate in every mobile budget total and editor list", () => {
  const categories = listBudgetCategories({
    fixedCategories,
    progress: {
      venue: { budget: 10_000_000, spent: 2_000_000 },
      custom_1234: {
        label: "포토 부스",
        budget: 500_000,
        spent: 300_000,
      },
    },
  });

  assert.deepEqual(categories, [
    { key: "venue", label: "웨딩홀" },
    { key: "studio", label: "스튜디오" },
    { key: "custom_1234", label: "포토 부스" },
  ]);
  assert.equal(
    categories.reduce((sum, category) => {
      const item = {
        venue: { spent: 2_000_000 },
        custom_1234: { spent: 300_000 },
      }[category.key];
      return sum + (item?.spent ?? 0);
    }, 0),
    2_300_000,
  );
});

test("non-budget metadata and unsafe custom labels cannot become budget rows", () => {
  const categories = listBudgetCategories({
    fixedCategories,
    progress: {
      __meta: { spent: 9_000_000 },
      random_state: { spent: 8_000_000 },
      custom_safe: { label: "  부케 보존  " },
      custom_unsafe: { label: "숨김\u0000문자" },
    },
  });

  assert.deepEqual(categories.slice(2), [
    { key: "custom_safe", label: "부케 보존" },
    { key: "custom_unsafe", label: "사용자 항목" },
  ]);
});

test("hidden fixed rows do not reappear in mobile allocation or spend totals and custom rows remain", () => {
  const progress = {
    venue: { budget: 10_000_000, spent: 2_000_000 },
    studio: { budget: 3_000_000, spent: 1_000_000 },
    custom_transport: { label: "교통", budget: 500_000, spent: 100_000 },
    __hidden: ["studio", "custom_transport"],
    __metadata: { budget: 50_000_000, spent: 40_000_000 },
  };
  const before = JSON.stringify(progress);
  const categories = listBudgetCategories({ fixedCategories, progress });
  assert.deepEqual(categories.map(category => category.key), ["venue", "custom_transport"]);
  assert.equal(categories.reduce((sum, category) => sum + progress[category.key].budget, 0), 10_500_000);
  assert.equal(categories.reduce((sum, category) => sum + progress[category.key].spent, 0), 2_100_000);
  assert.equal(JSON.stringify(progress), before, "hiding a row must not delete its stored money or metadata");
});

test("malformed visibility metadata cannot hide every budget row or throw", () => {
  for (const hidden of [null, "venue", { venue: true }, [null, 42, {}]]) {
    assert.deepEqual(listBudgetCategories({ fixedCategories, progress: { __hidden: hidden } }), fixedCategories);
  }
});

test("the mobile budget screen uses the unified registry for totals, payer splits, and rows", () => {
  const source = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../app/budget/index.tsx"),
    "utf8",
  );

  assert.match(source, /const budgetCategories = listBudgetCategories/);
  assert.match(source, /const totalSpent = budgetCategories\.reduce/);
  assert.match(source, /const allocatedBudget = budgetCategories\.reduce/);
  assert.match(source, /const payerSummary = budgetCategories\.reduce/);
  // 행은 같은 목록에서 금액 없는 "안 해요" 기본 항목만 뺀 것이다(2026-09-15, 웹과 같은 규칙).
  // 합계·분담은 위처럼 전체 목록으로 세므로, 행에서 빠져도 합계는 달라지지 않는다.
  assert.match(source, /const budgetRows = budgetCategories\.filter\(/);
  assert.match(source, /\{budgetRows\.map\(\(cat\) =>/);
});
