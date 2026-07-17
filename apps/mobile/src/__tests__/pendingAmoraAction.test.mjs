import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

const helperPath = fileURLToPath(new URL("../lib/pendingAmoraAction.ts", import.meta.url));
const helperSource = readFileSync(helperPath, "utf8");
const compiled = ts.transpileModule(helperSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
});
const helperModule = { exports: {} };
new Function("exports", "module", compiled.outputText)(helperModule.exports, helperModule);
const {
  getPendingAmoraAction,
  getPendingActionDisabledReason,
} = helperModule.exports;

const chatPath = fileURLToPath(new URL("../../app/(tabs)/chat.tsx", import.meta.url));
const chatSource = readFileSync(chatPath, "utf8");

const action = {
  version: 1,
  actionId: "33333333-3333-4333-8333-333333333333",
  tool: "update_budget",
  input: { totalBudget: 30_000_000 },
  confirmation: "총예산을 3,000만 원으로 변경할까요?",
  issuedAt: Date.parse("2026-07-17T00:00:00.000Z"),
  expiresAt: Date.parse("2026-07-17T00:10:00.000Z"),
};

function message(overrides = {}) {
  return {
    sender_type: "ai",
    visibility: "shared",
    metadata: { pending_amora_action: action },
    ...overrides,
  };
}

test("mobile accepts pending actions only from structurally valid shared AI metadata", () => {
  assert.deepEqual(getPendingAmoraAction(message()), action);
  assert.equal(getPendingAmoraAction(message({ visibility: "bride_private" })), null);
  assert.equal(getPendingAmoraAction(message({ sender_type: "bride" })), null);
  assert.equal(getPendingAmoraAction(message({
    metadata: { pending_amora_action: { ...action, actionId: "not-a-uuid" } },
  })), null);
  assert.equal(getPendingAmoraAction(message({
    metadata: { pending_amora_action: { ...action, input: [] } },
  })), null);
  assert.equal(getPendingAmoraAction(message({
    metadata: { pending_amora_action: { ...action, issuedAt: "2026-07-17T00:00:00.000Z" } },
  })), null);
  assert.equal(getPendingAmoraAction(message({
    metadata: { pending_amora_action: { ...action, expiresAt: action.expiresAt + 1 } },
  })), null);
});

test("mobile disables expired, superseded, and in-flight actions", () => {
  const beforeExpiry = action.expiresAt - 1;
  assert.equal(getPendingActionDisabledReason(action, beforeExpiry, true, false), null);
  assert.equal(getPendingActionDisabledReason(action, action.expiresAt, true, false), "expired");
  assert.equal(getPendingActionDisabledReason(action, beforeExpiry, false, false), "not_latest");
  assert.equal(getPendingActionDisabledReason(action, beforeExpiry, true, true), "busy");
});

test("mobile confirmation button sends and retries the exact server action id", () => {
  assert.match(chatSource, /confirmedActionId\?: string/);
  assert.match(chatSource, /confirmedActionId: draft\.confirmedActionId/);
  assert.match(chatSource, /async function handleApplyPendingAction\(actionId: string\)/);
  assert.match(chatSource, /const content = "좋아요\. 제안한 변경을 적용해 주세요\."/);
  assert.match(chatSource, /text: content/);
  assert.match(chatSource, /confirmedActionId: actionId/);
  assert.match(chatSource, /await streamAiRequest\(failure\.request\)/);
});

test("mobile exposes explicit 44-point apply and dismiss controls", () => {
  assert.match(chatSource, /accessibilityLabel="확인한 내용을 이대로 적용"/);
  assert.match(chatSource, /accessibilityLabel="지금은 적용하지 않기"/);
  assert.match(chatSource, /pendingActionButton: \{[^}]*minHeight: 44/);
  assert.match(chatSource, /pendingActionDismiss: \{[^}]*minHeight: 44/);
});
