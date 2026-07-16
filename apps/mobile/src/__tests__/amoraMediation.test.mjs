import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

const chatPath = fileURLToPath(new URL("../../app/(tabs)/chat.tsx", import.meta.url));
const cardPath = fileURLToPath(new URL("../components/chat/AmoraMediationCard.tsx", import.meta.url));
const clientPath = fileURLToPath(new URL("../lib/amoraMediation.ts", import.meta.url));
const chatSource = readFileSync(chatPath, "utf8");
const cardSource = existsSync(cardPath) ? readFileSync(cardPath, "utf8") : "";

test("a persisted AI mediation message exposes its structured proposal in the native chat", () => {
  assert.equal(existsSync(cardPath), true, "native mediation card is missing");
  assert.match(chatSource, /mediation\?: unknown/);
  assert.match(chatSource, /normalizeMediationBlock\(item\.metadata\?\.mediation\)/);
  assert.match(chatSource, /<AmoraMediationCard[\s\S]*block=\{mediationBlock\}[\s\S]*messageId=\{item\.id\}/);
  assert.match(cardSource, /from "react-native"/);
  assert.doesNotMatch(cardSource, /WebView|Linking\.openURL/);
});

function loadAcceptanceClient(apiJson) {
  const clientSource = readFileSync(clientPath, "utf8");
  const sourceFile = ts.createSourceFile(
    clientPath,
    clientSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const declarations = sourceFile.statements
    .filter((statement) =>
      ts.isFunctionDeclaration(statement) || ts.isVariableStatement(statement)
    )
    .map((statement) => statement.getFullText(sourceFile).replace(/\bexport\s+/g, ""))
    .join("\n");
  const compiled = ts.transpileModule(declarations, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  });
  return new Function(
    "apiJson",
    `${compiled.outputText}\nreturn {
      getMediationAcceptance,
      acceptMediationResolution: typeof acceptMediationResolution === "function"
        ? acceptMediationResolution
        : undefined,
      withdrawMediationAcceptance: typeof withdrawMediationAcceptance === "function"
        ? withdrawMediationAcceptance
        : undefined,
      canWithdrawMediationAcceptance: typeof canWithdrawMediationAcceptance === "function"
        ? canWithdrawMediationAcceptance
        : undefined,
      normalizeMediationBlock,
    };`,
  )(apiJson);
}

test("opening a confirmable proposal loads the authenticated acceptance state", async () => {
  assert.equal(existsSync(clientPath), true, "mediation acceptance client is missing");
  const calls = [];
  const apiJson = async (path, options) => {
    calls.push({ path, options });
    return { accepted: false, acceptedCount: 0, requiredCount: 2, completed: false };
  };
  const { getMediationAcceptance } = loadAcceptanceClient(apiJson);
  const messageId = "1474c6f2-29c6-4c77-8d91-d3347eef4c3f";

  const state = await getMediationAcceptance(messageId);

  assert.deepEqual(state, {
    accepted: false,
    acceptedCount: 0,
    requiredCount: 2,
    completed: false,
  });
  assert.deepEqual(calls, [{
    path: `/api/amora/mediation/accept?messageId=${messageId}`,
    options: { cache: "no-store" },
  }]);
});

test("untrusted mediation metadata is normalized before it can reach native text", () => {
  const { normalizeMediationBlock } = loadAcceptanceClient(async () => ({}));

  assert.deepEqual(normalizeMediationBlock({
    empathy: "  속상했겠어요  ",
    translation: { unsafe: true },
    data: "확인할 자료가 아직 부족해요",
    ignored: "화면에 나오면 안 돼요",
  }), {
    empathy: "속상했겠어요",
    translation: undefined,
    data: "확인할 자료가 아직 부족해요",
    resolution: undefined,
  });
  assert.equal(normalizeMediationBlock(null), null);
  assert.equal(normalizeMediationBlock([]), null);
  assert.equal(normalizeMediationBlock({ resolution: "가".repeat(501) }), null);
});

test("accepting a proposal posts only its persisted message id", async () => {
  const calls = [];
  const apiJson = async (path, options) => {
    calls.push({ path, options });
    return { accepted: true, acceptedCount: 1, requiredCount: 2, completed: false };
  };
  const { acceptMediationResolution } = loadAcceptanceClient(apiJson);
  assert.equal(typeof acceptMediationResolution, "function");
  const messageId = "1474c6f2-29c6-4c77-8d91-d3347eef4c3f";

  const state = await acceptMediationResolution(messageId);

  assert.deepEqual(state, {
    accepted: true,
    acceptedCount: 1,
    requiredCount: 2,
    completed: false,
  });
  assert.deepEqual(calls, [{
    path: "/api/amora/mediation/accept",
    options: {
      method: "POST",
      body: JSON.stringify({ messageId }),
    },
  }]);
});

test("withdrawing my incomplete acceptance deletes only the persisted message id", async () => {
  const calls = [];
  const apiJson = async (path, options) => {
    calls.push({ path, options });
    return { accepted: false, acceptedCount: 0, requiredCount: 2, completed: false };
  };
  const { withdrawMediationAcceptance } = loadAcceptanceClient(apiJson);
  assert.equal(typeof withdrawMediationAcceptance, "function");
  const messageId = "1474c6f2-29c6-4c77-8d91-d3347eef4c3f";

  const state = await withdrawMediationAcceptance(messageId);

  assert.deepEqual(state, {
    accepted: false,
    acceptedCount: 0,
    requiredCount: 2,
    completed: false,
  });
  assert.deepEqual(calls, [{
    path: "/api/amora/mediation/accept",
    options: {
      method: "DELETE",
      body: JSON.stringify({ messageId }),
    },
  }]);
});

test("withdrawal is available only for my acceptance before joint completion", () => {
  const { canWithdrawMediationAcceptance } = loadAcceptanceClient(async () => ({}));
  assert.equal(typeof canWithdrawMediationAcceptance, "function");
  assert.equal(canWithdrawMediationAcceptance({
    accepted: true,
    acceptedCount: 1,
    requiredCount: 2,
    completed: false,
  }), true);
  assert.equal(canWithdrawMediationAcceptance({
    accepted: true,
    acceptedCount: 2,
    requiredCount: 2,
    completed: true,
  }), false);
  assert.equal(canWithdrawMediationAcceptance({
    accepted: false,
    acceptedCount: 1,
    requiredCount: 2,
    completed: false,
  }), false);
  assert.equal(canWithdrawMediationAcceptance(null), false);
});

test("a withdrawal response that still marks me accepted fails closed", async () => {
  const { withdrawMediationAcceptance } = loadAcceptanceClient(async () => ({
    accepted: true,
    acceptedCount: 1,
    requiredCount: 2,
    completed: false,
  }));

  await assert.rejects(
    () => withdrawMediationAcceptance("1474c6f2-29c6-4c77-8d91-d3347eef4c3f"),
    /확인 취소 응답이 올바르지 않습니다/,
  );
});

test("an inconsistent server response fails closed instead of showing a false joint agreement", async () => {
  const { getMediationAcceptance } = loadAcceptanceClient(async () => ({
    accepted: false,
    acceptedCount: 2,
    requiredCount: 2,
    completed: true,
  }));

  await assert.rejects(
    () => getMediationAcceptance("1474c6f2-29c6-4c77-8d91-d3347eef4c3f"),
    /동의 상태 응답이 올바르지 않습니다/,
  );
});

test("the native confirmation surface distinguishes loading, failure, waiting, and joint completion", () => {
  assert.match(cardSource, /getMediationAcceptance\(messageId\)/);
  assert.match(cardSource, /acceptMediationResolution\(messageId\)/);
  assert.match(cardSource, /동의 상태를 확인하는 중이에요/);
  assert.match(cardSource, /동의 상태를 확인하지 못했어요/);
  assert.match(cardSource, /내 동의는 저장됐어요/);
  assert.match(cardSource, /상대방의 확인을 기다리고 있어요/);
  assert.match(cardSource, /두 분 모두 동의해 공동 기억에 저장했어요/);
  assert.match(cardSource, /이 제안에 나는 동의해요/);
  assert.match(cardSource, /accessibilityRole="button"/);
  assert.match(cardSource, /confirmButton:\s*\{[^}]*minHeight:\s*(?:4[4-9]|[5-9]\d)/s);
  assert.match(cardSource, /retryButton:\s*\{[^}]*minHeight:\s*(?:4[4-9]|[5-9]\d)/s);
});

test("a person waiting on their partner can refresh the joint acceptance state", () => {
  assert.match(cardSource, /상대방 동의 상태 새로고침/);
  assert.match(cardSource, /setLoadAttempt\(\(attempt\) => attempt \+ 1\)/);
});

test("the native card offers a 48px withdrawal action only through the incomplete-acceptance guard", () => {
  assert.match(cardSource, /canWithdrawMediationAcceptance\(acceptance\)/);
  assert.match(cardSource, /withdrawMediationAcceptance\(messageId\)/);
  assert.match(cardSource, /내 확인 취소/);
  assert.match(cardSource, /accessibilityLabel="내 확인 취소"/);
  assert.match(cardSource, /withdrawButton:\s*\{[^}]*minHeight:\s*(?:4[8-9]|[5-9]\d)/s);
});

test("a failed withdrawal keeps the accepted state and exposes an explicit 48px retry", () => {
  assert.match(cardSource, /kind: "withdraw"/);
  assert.match(cardSource, /기존 확인 상태는 그대로 유지했어요/);
  assert.match(cardSource, /내 확인 취소 다시 시도/);
  assert.match(cardSource, /accessibilityLabel=\{[^}]*내 확인 취소 다시 시도/s);
  assert.match(cardSource, /actionError\.kind === "withdraw"[\s\S]*withdrawAcceptance\(\)/);
  assert.match(cardSource, /retryButton:\s*\{[^}]*minHeight:\s*(?:4[8-9]|[5-9]\d)/s);
});
