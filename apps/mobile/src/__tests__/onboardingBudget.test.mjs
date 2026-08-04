import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

import { evaluateOnboardingBudgetManwon } from "../lib/onboardingBudget.mjs";

const onboardingSource = readFileSync(
  fileURLToPath(new URL("../../app/onboarding/index.tsx", import.meta.url)),
  "utf8",
);

test("a 3000만원 onboarding input becomes the canonical 30,000,000원 request value", () => {
  assert.deepEqual(evaluateOnboardingBudgetManwon("3000"), {
    status: "valid",
    requestBudget: { amount: 3000, unit: "manwon" },
    totalBudgetWon: 30_000_000,
    message: "3,000만원으로 저장돼요.",
  });
});

test("a blank optional budget stays explicitly unset", () => {
  assert.deepEqual(evaluateOnboardingBudgetManwon("   "), {
    status: "empty",
    requestBudget: null,
    totalBudgetWon: 0,
    message: "아직 정하지 않았다면 비워두셔도 돼요.",
  });
});

test("an explicit zero asks the member to leave an undecided budget blank", () => {
  assert.deepEqual(evaluateOnboardingBudgetManwon("0"), {
    status: "invalid",
    requestBudget: null,
    totalBudgetWon: null,
    message: "아직 정하지 않았다면 0 대신 비워주세요.",
  });
});

test("malformed or over-limit inputs become an inline validation state instead of throwing", () => {
  for (const input of ["12abc", "1.5", "-1", "1e3", "100001"]) {
    assert.deepEqual(evaluateOnboardingBudgetManwon(input), {
      status: "invalid",
      requestBudget: null,
      totalBudgetWon: null,
      message: "총 예산은 1~100,000 사이의 숫자(만원 단위)로 입력해주세요.",
    });
  }
});

test("leading zeroes and the 10억원 boundary keep exact integer semantics", () => {
  assert.deepEqual(evaluateOnboardingBudgetManwon("0001"), {
    status: "valid",
    requestBudget: { amount: 1, unit: "manwon" },
    totalBudgetWon: 10_000,
    message: "1만원으로 저장돼요.",
  });
  assert.deepEqual(evaluateOnboardingBudgetManwon("100000"), {
    status: "valid",
    requestBudget: { amount: 100_000, unit: "manwon" },
    totalBudgetWon: 1_000_000_000,
    message: "100,000만원으로 저장돼요.",
  });
});

test("mobile onboarding sends only the evaluator's tagged budget and never parseInt output", () => {
  assert.match(onboardingSource, /evaluateOnboardingBudgetManwon\(budget\)/);
  assert.match(onboardingSource, /totalBudget:\s*budgetEvaluation\.requestBudget/);
  assert.doesNotMatch(onboardingSource, /parseInt\(budget\)/);
});
