import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

import {
  isSkippedBudgetCategoryWithoutMoney,
  readBudgetCategoryStatus,
} from "../lib/budgetCategoryStatus.mjs";

/**
 * 모바일 예산 화면의 항목 상태 칩.
 *
 * 예전에는 `completed`·`in_progress`가 아닌 것을 전부 "예정"으로 불렀다. 온보딩·체크리스트에서
 * "안 해요"로 고른 항목도 예산에서만 "예정"으로 보였고, 칩 색은 한국어 문자열을 비교해 정했다.
 * 웹은 공유 사전(아직·준비 중·완료·안 해요)으로 옮기고, 금액 없는 "안 해요" 항목을 행에서 뺐다.
 */
function load(relative, deps = {}) {
  const path = fileURLToPath(new URL(relative, import.meta.url));
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  new Function("exports", "module", "require", compiled.outputText)(module.exports, module, (specifier) => {
    if (Object.hasOwn(deps, specifier)) return deps[specifier];
    throw new Error(`unexpected dependency: ${specifier}`);
  });
  return module.exports;
}

const { PREPARATION_PROGRESS_STATUS_LABELS } = load(
  "../../../../packages/shared/src/constants/preparationProgress.ts",
  { "./weddingPlanning": { PLANNING_CATEGORY_LABELS: {} } },
);
const web = load("../../../web/src/components/app/budget/isUnusedBudgetCategory.ts");

test("저장된 상태를 네 키로 읽고, 모르는 값은 아직으로 본다", () => {
  for (const status of ["not_started", "in_progress", "completed", "not_applicable"]) {
    assert.equal(readBudgetCategoryStatus({ status }), status);
  }
  for (const item of [undefined, null, [], {}, { status: "planned" }, { status: 1 }, { status: "COMPLETED" }]) {
    assert.equal(readBudgetCategoryStatus(item), "not_started");
  }
});

test("칩 이름은 공유 사전에서 오고, 안 해요 항목이 예정으로 보이지 않는다", () => {
  const shown = (item) => PREPARATION_PROGRESS_STATUS_LABELS[readBudgetCategoryStatus(item)];
  assert.equal(shown({ status: "not_applicable" }), "안 해요");
  assert.equal(shown({ status: "not_started" }), "아직");
  assert.equal(shown({ status: "in_progress" }), "준비 중");
  assert.equal(shown({ status: "completed" }), "완료");
  assert.ok(!Object.values(PREPARATION_PROGRESS_STATUS_LABELS).includes("예정"));
});

const MONEY_CASES = [
  [{ status: "not_applicable" }, true],
  [{ status: "not_applicable", budget: 0, spent: 0 }, true],
  [{ status: "not_applicable", payer: "couple", memo: "x" }, true],
  [{ status: "not_applicable", budget: 1_000_000 }, false],
  [{ status: "not_applicable", spent: 300_000 }, false],
  [{ status: "not_applicable", cost: 50_000 }, false],
  [{ status: "not_applicable", budget: 1.5 }, true],
  [{ status: "not_applicable", budget: "1000000" }, true],
  [{ status: "completed" }, false],
  [{ status: "not_started" }, false],
  [{}, false],
  [undefined, false],
  [null, false],
  [["not_applicable"], false],
];

test("금액 없는 안 해요 항목만 행에서 빼고, 금액이 있으면 합계와 함께 남긴다", () => {
  for (const [item, expected] of MONEY_CASES) {
    assert.equal(isSkippedBudgetCategoryWithoutMoney(item), expected, JSON.stringify(item));
  }
});

test("웹 예산 화면과 같은 판정이다", () => {
  for (const [item] of MONEY_CASES) {
    assert.equal(
      isSkippedBudgetCategoryWithoutMoney(item),
      web.isSkippedBudgetCategoryWithoutMoney(item),
      JSON.stringify(item),
    );
  }
});

test("예산 화면이 키로 칩을 칠하고, 금액 없는 안 해요 행을 그리지 않는다", () => {
  const source = readFileSync(new URL("../../app/budget/index.tsx", import.meta.url), "utf8");
  const screen = ts.transpileModule(source, {
    fileName: "budget.tsx",
    compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2022, removeComments: true },
  }).outputText;

  assert.match(screen, /\{PREPARATION_PROGRESS_STATUS_LABELS\[st\]\}/);
  assert.doesNotMatch(screen, /"예정"/);
  assert.doesNotMatch(screen, /st === "완료"|st === "진행중"/);
  assert.match(screen, /return readBudgetCategoryStatus\(progress\[key\]\);/);
  assert.match(screen, /isSkippedBudgetCategoryWithoutMoney\(progress\[category\.key\]\)/);
  assert.match(screen, /\{budgetRows\.map\(\(cat\) =>/);
  assert.doesNotMatch(screen, /\{budgetCategories\.map\(\(cat\) =>/);
});
