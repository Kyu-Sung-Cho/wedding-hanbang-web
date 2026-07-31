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
  version: 2,
  actionId: "33333333-3333-4333-8333-333333333333",
  tool: "add_schedule_event",
  input: { date: "2026-08-01", title: "드레스 피팅" },
  inputDigest: "a".repeat(64),
  operationKey: "b".repeat(64),
  confirmation: "드레스 피팅 일정을 추가할까요?",
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
  assert.equal(getPendingAmoraAction(message({
    metadata: { pending_amora_action: { ...action, inputDigest: "wrong" } },
  })), null);
  assert.equal(getPendingAmoraAction(message({
    metadata: { pending_amora_action: { ...action, operationKey: "wrong" } },
  })), null);
  assert.equal(getPendingAmoraAction(message({
    metadata: {
      pending_amora_action: { ...action, tool: "update_amora_action" },
    },
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

test("mobile obtains the single application lease before sending a confirmation", () => {
  const handlerStart = chatSource.indexOf(
    "async function handleApplyPendingAction(actionId: string)",
  );
  const handlerEnd = chatSource.indexOf(
    "function handleScopeChange",
    handlerStart,
  );
  const handler = chatSource.slice(handlerStart, handlerEnd);

  assert.match(chatSource, /method: "PUT"/);
  assert.match(chatSource, /Authorization: `Bearer \$\{accessToken\}`/);
  assert.match(
    handler,
    /await requestAmoraApplicationClaim\(\s*actionId,\s*latestSharedMessage\.id,\s*\)/,
  );
  assert.ok(
    handler.indexOf("await requestAmoraApplicationClaim(")
      < handler.indexOf("await sendAiDraft("),
  );
  assert.match(handler, /if \(!claim\.applicationGranted\)/);
  assert.match(
    chatSource,
    /metadata: draft\.confirmedActionId\s*\?\s*\{ confirmed_amora_action_id: draft\.confirmedActionId \}/,
  );
});

test("mobile retry reconciles a durable confirmation before reacquiring its lease", () => {
  const senderStart = chatSource.indexOf(
    "async function sendAiDraft(draft: AiDraft, reconcileFirst: boolean)",
  );
  const senderEnd = chatSource.indexOf(
    "async function handleRetry()",
    senderStart,
  );
  const sender = chatSource.slice(senderStart, senderEnd);

  assert.match(chatSource, /amoraSourceMessageId\?: string/);
  assert.match(
    sender,
    /let durableMessage = reconcileFirst\s*\?\s*await findDurableUserMessage\(draft, "ai"\)/,
  );
  assert.match(
    sender,
    /await requestAmoraApplicationClaim\(\s*draft\.confirmedActionId,\s*draft\.amoraSourceMessageId,\s*\)/,
  );
  assert.ok(
    sender.indexOf('findDurableUserMessage(draft, "ai")')
      < sender.indexOf("requestAmoraApplicationClaim("),
  );
  assert.match(
    chatSource,
    /amoraSourceMessageId: latestSharedMessage\.id/,
  );
  assert.match(
    chatSource,
    /if \(!draft\.confirmedActionId\) \{\s*query = query\.gte\("created_at", draft\.startedAt\)/,
  );
});

test("mobile restores an owned durable confirmation and ignores direct partner chat for freshness", () => {
  assert.match(
    chatSource,
    /\.order\("created_at", \{ ascending: false \}\)\s*\.order\("id", \{ ascending: false \}\)\s*\.limit\(200\)/,
  );
  assert.match(
    chatSource,
    /\.or\("metadata->>target\.is\.null,metadata->>target\.neq\.partner"\)\s*\.order\("created_at", \{ ascending: false \}\)\s*\.order\("id", \{ ascending: false \}\)\s*\.limit\(1\)\s*\.maybeSingle\(\)/,
  );
  assert.match(chatSource, /const historyMessages = boundedHistory\s*\.sort\(/);
  assert.match(
    chatSource,
    /const durableConfirmation = canonicalShared\[canonicalShared\.length - 1\]/,
  );
  assert.match(
    chatSource,
    /message\.visibility === "shared"\s*&& message\.metadata\?\.target !== "partner"/,
  );
  assert.match(
    chatSource,
    /message: "확인은 안전하게 저장됐어요\. 반영을 이어서 완료해 주세요\."/,
  );
  assert.match(chatSource, /"반영 계속하기"/);
});

test("mobile exposes explicit 44-point apply and dismiss controls", () => {
  assert.match(chatSource, /accessibilityLabel="확인한 내용을 이대로 적용"/);
  assert.match(chatSource, /accessibilityLabel="지금은 적용하지 않기"/);
  assert.match(chatSource, /pendingActionButton: \{[^}]*minHeight: 44/);
  assert.match(chatSource, /pendingActionDismiss: \{[^}]*minHeight: 44/);
});
