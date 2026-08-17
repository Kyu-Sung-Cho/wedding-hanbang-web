import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

const sourcePath = fileURLToPath(new URL("../../app/(tabs)/chat.tsx", import.meta.url));
const sourceText = readFileSync(sourcePath, "utf8");
const sourceFile = ts.createSourceFile(
  sourcePath,
  sourceText,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

function sourceBetween(startMarker, endMarker) {
  const start = sourceText.indexOf(startMarker);
  const end = sourceText.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return sourceText.slice(start, end);
}

function loadAcknowledgementContract() {
  const functionNames = new Set([
    "normalizeAmoraSharedSendIdentity",
    "amoraSharedSendAcknowledgementKey",
    "createAmoraSharedSendAcknowledgement",
    "parseAmoraSharedSendAcknowledgement",
  ]);
  const declarations = sourceFile.statements
    .filter((statement) =>
      ts.isFunctionDeclaration(statement)
      && statement.name
      && functionNames.has(statement.name.text)
    )
    .map((statement) => statement.getFullText(sourceFile));
  if (declarations.length !== functionNames.size) return null;
  const transpiled = ts.transpileModule(declarations.join("\n"), {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  });
  return new Function(
    `${transpiled.outputText}\nreturn { amoraSharedSendAcknowledgementKey, createAmoraSharedSendAcknowledgement, parseAmoraSharedSendAcknowledgement };`,
  )();
}

function loadAcknowledgementStorage(secureStore) {
  const functionNames = new Set([
    "normalizeAmoraSharedSendIdentity",
    "amoraSharedSendAcknowledgementKey",
    "createAmoraSharedSendAcknowledgement",
    "parseAmoraSharedSendAcknowledgement",
    "loadAmoraSharedSendAcknowledgement",
    "saveAmoraSharedSendAcknowledgement",
  ]);
  const declarations = sourceFile.statements
    .filter((statement) =>
      ts.isFunctionDeclaration(statement)
      && statement.name
      && functionNames.has(statement.name.text)
    )
    .map((statement) => statement.getFullText(sourceFile));
  if (declarations.length !== functionNames.size) return null;
  const transpiled = ts.transpileModule(declarations.join("\n"), {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  });
  return new Function(
    "SecureStore",
    `${transpiled.outputText}\nreturn { loadAmoraSharedSendAcknowledgement, saveAmoraSharedSendAcknowledgement };`,
  )(secureStore);
}

test("first shared-send acknowledgement is bound to one user and one couple", () => {
  const contract = loadAcknowledgementContract();
  assert.ok(contract);
  const userId = "11111111-1111-4111-8111-111111111111";
  const otherUserId = "22222222-2222-4222-8222-222222222222";
  const coupleId = "33333333-3333-4333-8333-333333333333";
  const otherCoupleId = "44444444-4444-4444-8444-444444444444";
  const key = contract.amoraSharedSendAcknowledgementKey(userId, coupleId);
  const raw = JSON.stringify(
    contract.createAmoraSharedSendAcknowledgement(userId, coupleId),
  );

  assert.match(key, /^amora_shared_send_ack_v1_[0-9a-f]{32}_[0-9a-f]{32}$/u);
  assert.equal(contract.parseAmoraSharedSendAcknowledgement(raw, userId, coupleId), true);
  assert.equal(contract.parseAmoraSharedSendAcknowledgement(raw, otherUserId, coupleId), false);
  assert.equal(contract.parseAmoraSharedSendAcknowledgement(raw, userId, otherCoupleId), false);
  assert.equal(contract.parseAmoraSharedSendAcknowledgement("{}", userId, coupleId), false);
  assert.equal(contract.parseAmoraSharedSendAcknowledgement("not-json", userId, coupleId), false);
  assert.throws(
    () => contract.amoraSharedSendAcknowledgementKey("not-a-user", coupleId),
    /AMORA_SHARED_SEND_IDENTITY_INVALID/u,
  );
});

test("shared-send acknowledgement is durable only after device-only SecureStore succeeds", async () => {
  const calls = [];
  const userId = "11111111-1111-4111-8111-111111111111";
  const coupleId = "33333333-3333-4333-8333-333333333333";
  const payload = JSON.stringify({
    version: 1,
    userId,
    coupleId,
    confirmed: true,
  });
  const secureStore = {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only",
    getItemAsync: async (key) => {
      calls.push(["get", key]);
      return payload;
    },
    setItemAsync: async (key, raw, options) => {
      calls.push(["set", key, raw, options]);
    },
  };
  const storage = loadAcknowledgementStorage(secureStore);
  assert.ok(storage);

  assert.equal(
    await storage.loadAmoraSharedSendAcknowledgement(userId, coupleId),
    true,
  );
  await storage.saveAmoraSharedSendAcknowledgement(userId, coupleId);
  assert.equal(calls[0][0], "get");
  assert.deepEqual(calls[1][3], { keychainAccessible: "device-only" });
  assert.equal(JSON.parse(calls[1][2]).confirmed, true);

  const failedStorage = loadAcknowledgementStorage({
    ...secureStore,
    setItemAsync: async () => {
      throw new Error("secure-store-unavailable");
    },
  });
  await assert.rejects(
    failedStorage.saveAmoraSharedSendAcknowledgement(userId, coupleId),
    /secure-store-unavailable/u,
  );
});

test("the first shared send pauses for one accurate accessible confirmation", () => {
  const resetSession = sourceBetween(
    "const resetChatSessionState",
    "useEffect(() => {",
  );
  const loadSession = sourceBetween(
    "async function loadChatSession",
    "void loadChatSession();",
  );
  const ownerBoundSessionLoads = sourceBetween(
    "const [\n        sharedSendAcknowledged,",
    "if (!isCurrentGeneration()) return;",
  );
  const sendHandler = sourceBetween(
    "async function handleSend",
    "function handleStop",
  );
  const confirmHandler = sourceBetween(
    "async function handleConfirmSharedSend",
    "function handleMoveSharedSendToPrivate",
  );
  const privateHandler = sourceBetween(
    "function handleMoveSharedSendToPrivate",
    "function handleStop",
  );

  assert.match(sourceText, /useRef<AmoraSharedSendAcknowledgementSession \| null>\(null\)/u);
  assert.match(
    ownerBoundSessionLoads,
    /loadAmoraSharedSendAcknowledgement\(\s*user\.id,\s*profile\.couple_id,?\s*\)\.catch\(\(\) => false\)/u,
  );
  assert.match(
    ownerBoundSessionLoads,
    /loadAmoraMediationOfferDismissals\(user\.id, profile\.couple_id\)\.catch\(\(\) => \[\]\)/u,
  );
  assert.match(
    ownerBoundSessionLoads,
    /hasPrivateMediationSafetyHold\(\{\s*ownerUserId: user\.id,\s*coupleId: profile\.couple_id,\s*\}\)/u,
  );
  assert.match(
    loadSession,
    /sharedSendAcknowledgementRef\.current = \{[\s\S]*userId: user\.id,[\s\S]*coupleId: profile\.couple_id,[\s\S]*confirmed:/u,
  );
  assert.match(resetSession, /sharedSendAcknowledgementRef\.current = null/u);
  assert.match(resetSession, /setPendingSharedSendConfirmation\(null\)/u);

  const safetyHold = sendHandler.indexOf('crisisPreflight.disposition === "local_safety_hold"');
  const confirmationGate = sendHandler.indexOf('effectiveVisibility === "shared"');
  const requestId = sendHandler.indexOf("Crypto.randomUUID()");
  assert.ok(safetyHold >= 0 && confirmationGate > safetyHold);
  assert.ok(requestId > confirmationGate);
  assert.match(sendHandler, /setPendingSharedSendConfirmation\(\{/u);
  assert.match(sendHandler, /userId,[\s\S]*coupleId,[\s\S]*sourceLane: activeLane,[\s\S]*text/u);

  assert.match(confirmHandler, /await saveAmoraSharedSendAcknowledgement/u);
  assert.ok(
    confirmHandler.indexOf("await saveAmoraSharedSendAcknowledgement")
      < confirmHandler.indexOf("confirmed: true"),
  );
  assert.ok(confirmHandler.indexOf("confirmed: true") < confirmHandler.indexOf("await handleSend()"));
  assert.match(confirmHandler, /sessionUserIdRef\.current !== confirmation\.userId/u);
  assert.match(confirmHandler, /안전하게 기록하지 못했어요/u);

  assert.match(privateHandler, /"private_ai"/u);
  assert.match(privateHandler, /updateAmoraChatLaneRecord/u);
  assert.match(privateHandler, /setActiveScope\("private"\)/u);
  assert.match(privateHandler, /setTarget\("ai"\)/u);

  assert.match(sourceText, /accessibilityViewIsModal/u);
  assert.match(sourceText, /accessibilityLabel="첫 함께 대화 전송 확인"/u);
  assert.match(sourceText, /지금 함께 대화에 저장되며, 파트너가 연결되면 이 내용을 볼 수 있어요/u);
  assert.match(sourceText, /지금 함께 대화에 저장되며, 연결된 파트너가 이 내용을 볼 수 있어요/u);
  assert.match(sourceText, />함께 대화로 보내기<\/Text>/u);
  assert.match(sourceText, />나만 상담으로 바꾸기<\/Text>/u);
  assert.match(sourceText, />취소<\/Text>/u);
});

test("shared-lane chrome states present and future partner visibility without ambiguity", () => {
  assert.match(
    sourceText,
    /현재 범위 · 함께 대화 — 지금 저장되며, 연결된 파트너에게 보여요/u,
  );
  assert.match(
    sourceText,
    /현재 범위 · 함께 대화 — 지금 저장되며, 파트너가 연결되면 볼 수 있어요/u,
  );
  assert.match(
    sourceText,
    /hasLinkedPartner[\s\S]*"함께 대화, 저장되며 연결된 파트너에게 보임"[\s\S]*"함께 대화, 저장되며 파트너 연결 시 보임"/u,
  );
  assert.doesNotMatch(
    sourceText,
    /현재 범위 · 함께 대화 — 파트너 연결 후 함께 볼 수 있어요/u,
  );
});

test("account switching fences acknowledgement completion without unlocking a newer confirmation", () => {
  const resetSession = sourceBetween(
    "const resetChatSessionState",
    "useEffect(() => {",
  );
  const confirmHandler = sourceBetween(
    "async function handleConfirmSharedSend",
    "function handleMoveSharedSendToPrivate",
  );
  const actorChecks = confirmHandler.match(
    /sessionUserIdRef\.current !== confirmation\.userId/g,
  ) ?? [];

  assert.ok(actorChecks.length >= 2, "actor must be checked before and after durable storage");
  assert.match(
    sourceText,
    /useRef<PendingSharedSendConfirmation \| null>\(null\)/u,
  );
  assert.match(confirmHandler, /sharedSendConfirmationBusyRef\.current = confirmation/u);
  assert.match(
    confirmHandler,
    /finally \{[\s\S]*sharedSendConfirmationBusyRef\.current === confirmation[\s\S]*sharedSendConfirmationBusyRef\.current = null/u,
  );
  assert.match(resetSession, /sharedSendConfirmationBusyRef\.current = null/u);
});
