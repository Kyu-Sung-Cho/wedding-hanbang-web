import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const budget = readFileSync(path.join(appRoot, "app/budget/index.tsx"), "utf8");

test("budget shows only financial records the user explicitly started", () => {
  assert.match(budget, /function hasManualMoneyRecord/);
  assert.match(budget, /const activeRecords/);
  assert.match(budget, /activeRecords\.map/);
  assert.match(budget, /필요한 항목만 골라 기록하세요/);
  assert.match(budget, /모두 추가할 필요 없어요/);
  assert.match(budget, /항목 추가/);
  assert.doesNotMatch(budget, /BUDGET_CATEGORIES\.map\([\s\S]{0,500}getCatStatus/);
});

test("budget keeps plan, signed contract, paid amount, and next payment distinct", () => {
  assert.match(budget, /budgetInput/);
  assert.match(budget, /contractedTotalInput/);
  assert.match(budget, /paidToDateInput/);
  assert.match(budget, /nextPaymentAmountInput/);
  assert.match(budget, /nextPaymentDateInput/);
  assert.match(budget, /서명한 계약 총액/);
  assert.match(budget, /실제 누적 납부액/);
  assert.match(budget, /다음 납부 예정/);
  assert.match(budget, /사용자가 직접 입력한 미검증 기록/);
  assert.match(budget, /서명한 계약서·영수증·계좌내역 원본/);

  assert.doesNotMatch(budget, /spentInput|payerInput|PAYER_OPTIONS|getCatSpent|getCatPayer|getCatStatus/);
  assert.doesNotMatch(budget, /categoryOverruns|budgetRisks|progressAnim|storedMoneyToWon/);
  assert.doesNotMatch(budget, /예산 초과|남은 예산|잔여 예산/);
});

test("legacy spent, cost, and payer values are excluded and deletion-only", () => {
  assert.match(budget, /const LEGACY_FIELDS/);
  assert.match(budget, /const legacyRecords/);
  assert.match(budget, /합계에 포함하지 않으며 삭제만 할 수 있어요/);
  assert.match(budget, /remove:\s*legacyFields/);
  assert.doesNotMatch(budget, /set:\s*\{[^}]*\b(?:spent|cost|payer)\b/s);
});

test("manual record editor rejects misleading payment states before saving", () => {
  assert.match(budget, /납부액을 기록하려면 서명한 계약 총액도 입력해 주세요/);
  assert.match(budget, /누적 납부액은 서명한 계약 총액보다 클 수 없어요/);
  assert.match(budget, /다음 납부 일정을 기록하려면 서명한 계약 총액도 입력해 주세요/);
  assert.match(budget, /금액이나 다음 납부 일정 중 하나 이상을 입력해 주세요/);
  assert.match(budget, /mutateBudgetCategory/);
  assert.doesNotMatch(budget, /progress_patch|\.select\("progress"\)/);
});
