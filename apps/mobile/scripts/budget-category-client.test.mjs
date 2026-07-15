import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  mutateBudgetCategory,
  parseOptionalManwonToWon,
} from "../src/lib/budgetCategories.ts";

const Response = globalThis.Response;
const budgetScreen = readFileSync(resolve(import.meta.dirname, "../app/budget/index.tsx"), "utf8");

test("mobile budget save uses the authenticated narrow API and accepts authoritative progress", async () => {
  const calls = [];
  const authoritativeProgress = {
    venue: {
      category: "venue",
      status: "completed",
      checklist: [{ id: "venue_01", label: "계약서 확인", done: true }],
      budget: 30_000_000,
      contractedTotal: 25_000_000,
      paidToDate: 5_000_000,
      nextPaymentAmount: 3_000_000,
      nextPaymentDate: "2026-09-15",
      spent: 4_000_000,
      payer: "both_parents",
    },
    __events: [{ id: "evt_partner" }],
  };
  const apiFetch = async (path, options) => {
    calls.push({ path, options });
    return new Response(JSON.stringify({
      progress: authoritativeProgress,
      categoryKey: "venue",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const result = await mutateBudgetCategory({
    categoryKey: "venue",
    set: {
      budget: 30_000_000,
      contractedTotal: 25_000_000,
      paidToDate: 5_000_000,
      nextPaymentAmount: 3_000_000,
      nextPaymentDate: "2026-09-15",
    },
  }, apiFetch);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/api/journey/budget-categories");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    categoryKey: "venue",
    set: {
      budget: 30_000_000,
      contractedTotal: 25_000_000,
      paidToDate: 5_000_000,
      nextPaymentAmount: 3_000_000,
      nextPaymentDate: "2026-09-15",
    },
  });
  assert.equal(JSON.parse(calls[0].options.body).progress, undefined);
  assert.deepEqual(result.progress, authoritativeProgress);
});

test("mobile manwon parsing preserves decimals without parseInt truncation", () => {
  assert.equal(parseOptionalManwonToWon("12.5"), 125_000);
  assert.equal(parseOptionalManwonToWon(""), 0);
  assert.equal(parseOptionalManwonToWon("12abc"), null);
  assert.equal(parseOptionalManwonToWon("0.00001"), null);
  assert.equal(parseOptionalManwonToWon("1000001"), null);
});

test("mobile budget save fails closed when success does not confirm the requested category fields", async () => {
  const apiFetch = async () => new Response(JSON.stringify({
    progress: { venue: { category: "venue", budget: 20_000_000 } },
    categoryKey: "venue",
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

  await assert.rejects(
    mutateBudgetCategory({
      categoryKey: "venue",
      set: { budget: 30_000_000 },
    }, apiFetch),
    /저장된 예산 상태를 확인하지 못했습니다/,
  );
});

test("mobile rejects retired spent, cost, and payer writes before the API", async () => {
  for (const [field, value] of [
    ["spent", 1_000_000],
    ["cost", 1_000_000],
    ["payer", "couple"],
  ]) {
    let calls = 0;
    await assert.rejects(
      mutateBudgetCategory({
        categoryKey: "venue",
        set: { [field]: value },
      }, async () => {
        calls += 1;
        throw new Error("network should not be called");
      }),
      /더 이상 새로 저장할 수 없습니다/,
    );
    assert.equal(calls, 0);
  }
});

test("mobile validates safe amounts, calendar dates, and paid-to-contract order before the API", async () => {
  for (const set of [
    { contractedTotal: 1.5 },
    { nextPaymentAmount: 10_000_000_001 },
    { nextPaymentDate: "2026-04-31" },
    { contractedTotal: 10, paidToDate: 11 },
  ]) {
    let calls = 0;
    await assert.rejects(
      mutateBudgetCategory({ categoryKey: "venue", set }, async () => {
        calls += 1;
        throw new Error("network should not be called");
      }),
    );
    assert.equal(calls, 0);
  }
});

test("mobile allows explicit removal of legacy money fields", async () => {
  const calls = [];
  await mutateBudgetCategory({
    categoryKey: "venue",
    remove: ["spent", "cost", "payer"],
  }, async (path, options) => {
    calls.push({ path, options });
    return new Response(JSON.stringify({
      progress: { venue: { category: "venue", budget: 20_000_000 } },
      categoryKey: "venue",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  assert.deepEqual(JSON.parse(calls[0].options.body), {
    categoryKey: "venue",
    remove: ["spent", "cost", "payer"],
  });
});

test("mobile rejects a merged result where paid exceeds contracted", async () => {
  await assert.rejects(
    mutateBudgetCategory({
      categoryKey: "venue",
      set: { budget: 20_000_000 },
    }, async () => new Response(JSON.stringify({
      progress: {
        venue: {
          category: "venue",
          budget: 20_000_000,
          contractedTotal: 10_000_000,
          paidToDate: 11_000_000,
        },
      },
      categoryKey: "venue",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })),
    /저장된 예산 상태를 확인하지 못했습니다/,
  );
});

test("mobile rejects a merged result with an unsafe planned budget", async () => {
  await assert.rejects(
    mutateBudgetCategory({
      categoryKey: "venue",
      set: { contractedTotal: 10_000_000 },
    }, async () => new Response(JSON.stringify({
      progress: {
        venue: {
          category: "venue",
          budget: 1.5,
          contractedTotal: 10_000_000,
        },
      },
      categoryKey: "venue",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })),
    /저장된 예산 상태를 확인하지 못했습니다/,
  );
});

test("mobile budget screen has no stale whole-category or parallel save path", () => {
  assert.match(budgetScreen, /mutateBudgetCategory\(/);
  assert.match(budgetScreen, /setProgress\(result\.progress/);
  assert.match(budgetScreen, /saveInFlightRef\.current/);
  assert.doesNotMatch(budgetScreen, /\.select\("progress"\)/);
  assert.doesNotMatch(budgetScreen, /progress_patch/);
  assert.doesNotMatch(budgetScreen, /parseInt\(/);
  assert.doesNotMatch(budgetScreen, /Promise\.all\(/);
});
