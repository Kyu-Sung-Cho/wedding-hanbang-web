import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";
import ts from "typescript";

import {
  assertSharedActionActor,
  SHARED_ACTION_ACTOR_MISMATCH,
} from "../lib/amoraSharedActionActorFence.mjs";

// P0-2: 공동 승인은 "누가 눌렀는가"가 곧 동의의 주체다. 그런데 모바일 승인 요청은
// 버튼을 누른 사용자를 고정하지 않고 요청을 보내는 시점의 세션 토큰을 그대로 쓴다.
// 그 사이 같은 기기에서 계정이 A→B로 바뀌면 서버는 현재 bearer(B)를 승인자로 기록한다.
// B가 누르지 않은 동의가 B의 동의로 남고, 그 결과가 예산·일정 변경과 decision_nodes에
// 정본으로 들어간다.
//
// 화면에는 이미 `isCurrentChatSession(sessionGeneration)`이 있지만 **응답을 받은 뒤**에만
// 검사한다. 그때는 서버가 이미 승인을 기록한 뒤라 되돌릴 수 없다. 필요한 것은 요청을
// 보내기 **전에** 막는 것이다.
//
// 근거: docs/operations/AMORA_PRIVACY_SECURITY_WORK_PROGRESS_AND_RELEASE_HANDOFF_2026-08-04.md
// §8 P0-2 — `apps/mobile/app/(tabs)/chat.tsx:1467-1531`,
// `apps/web/src/app/api/amora/shared-actions/[actionId]/route.ts:136-168`.
//
// 이 파일은 실제 사용자 ID 대신 합성 UUID만 쓴다.

const ACTOR_A = "20000000-0000-4000-8000-0000000000a1";
const ACTOR_B = "20000000-0000-4000-8000-0000000000b2";

const CHAT_SCREEN_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../app/(tabs)/chat.tsx",
);

test("the same actor passes, regardless of letter case", () => {
  assert.doesNotThrow(() => assertSharedActionActor(ACTOR_A, ACTOR_A));
  assert.doesNotThrow(() =>
    assertSharedActionActor(ACTOR_A.toUpperCase(), ACTOR_A.toLowerCase()));
});

test("an approval started by A is refused once the session became B", () => {
  assert.throws(
    () => assertSharedActionActor(ACTOR_A, ACTOR_B),
    (error) => error instanceof Error && error.message === SHARED_ACTION_ACTOR_MISMATCH,
  );
});

test("a missing actor on either side fails closed rather than defaulting", () => {
  for (const [expected, session] of [
    [ACTOR_A, null],
    [ACTOR_A, undefined],
    [ACTOR_A, ""],
    [null, ACTOR_A],
    [undefined, ACTOR_A],
    ["", ACTOR_A],
    [null, null],
  ]) {
    assert.throws(
      () => assertSharedActionActor(expected, session),
      (error) => error instanceof Error && error.message === SHARED_ACTION_ACTOR_MISMATCH,
      `expected=${String(expected)} session=${String(session)} 는 거부돼야 한다`,
    );
  }
});

test("a value that is not a user id is refused instead of being compared loosely", () => {
  for (const malformed of ["not-a-uuid", "20000000-0000-4000-8000", 42, {}, []]) {
    assert.throws(
      () => assertSharedActionActor(malformed, malformed),
      (error) => error instanceof Error && error.message === SHARED_ACTION_ACTOR_MISMATCH,
      `${String(malformed)} 는 같은 값이어도 신원으로 인정하면 안 된다`,
    );
  }
});

test("the chat screen binds every shared-action request to the actor who pressed", () => {
  const source = readFileSync(CHAT_SCREEN_PATH, "utf8");

  const requirements = [
    ["actor fence 사용", /assertSharedActionActor/u],
    ["승인 요청이 expectedUserId를 받음", /requestAmoraSharedAction[\s\S]{0,400}?expectedUserId/u],
    // 401 갱신 뒤에도 같은 사람인지 다시 본다. 갱신은 다른 계정으로 바뀔 수 있는 지점이다.
    ["세션 갱신 후 재확인", /refreshSession\(\)[\s\S]{0,600}?assertSharedActionActor/u],
  ];

  for (const [label, pattern] of requirements) {
    assert.ok(
      pattern.test(source),
      `아모라 채팅 화면에 없음: ${label} (${pattern})`,
    );
  }
});

function compileModule(relativePath, dependencies = {}) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("exports", "module", "require", compiled)(module.exports, module, name => {
    assert.ok(name in dependencies, `unexpected dependency: ${name}`);
    return dependencies[name];
  });
  return module.exports;
}

const shared = Object.assign({}, ...[
  "contracts/amoraActionApproval.ts", "contracts/budgetImpactPreview.ts", "utils/kstDay.ts",
].map(path => compileModule(`../../../../packages/shared/src/${path}`)));
const pending = compileModule("../lib/pendingAmoraAction.ts", { "@hanbang/shared": shared });
const { createChatSessionGenerationGuard } = compileModule("../lib/chatSessionGeneration.ts");
const screenSource = readFileSync(CHAT_SCREEN_PATH, "utf8");
const screenTree = ts.createSourceFile("chat.tsx", screenSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const ACTION_ID = "30000000-0000-4000-8000-000000000001";
const MESSAGE_ID = "30000000-0000-4000-8000-000000000002";
const approved = { approvalMode: "couple", accepted: true, acceptedCount: 2, requiredCount: 2, partnerLinked: true, ready: true };

// The real screen closures, token transport, parsers, policy and generation guard execute together.
// Only the native/auth/network boundaries and the subsequent AI send are synthetic.
function screenHarness(options = {}) {
  const guard = createChatSessionGenerationGuard();
  guard.begin();
  const sessionUserIdRef = { current: ACTOR_A };
  const state = { authReads: 0, refreshes: 0, requests: [], sent: [], ingested: [], streamed: [], updates: [], token: "synthetic-A", mounted: true };
  const action = {
    version: 2, actionId: ACTION_ID, tool: "update_budget", input: { total_budget: 30000000 },
    inputDigest: "a".repeat(64), operationKey: "b".repeat(64), confirmation: "예산을 확인해 주세요.",
    issuedAt: Date.now(), expiresAt: Date.now() + shared.getAmoraPendingActionTtlMs("update_budget", {}),
  };
  action.expiresAt = action.issuedAt + shared.getAmoraPendingActionTtlMs(action.tool, action.input);
  const bindings = {
    ...pending, assertSharedActionActor, API_BASE: "https://example.invalid",
    chatSessionGenerationRef: { current: guard }, sessionUserIdRef,
    useCallback: callback => callback,
    isCurrentChatSession: generation => state.mounted && guard.isCurrent(generation),
    streaming: false, sendingRef: { current: false }, applyingPendingActionRef: { current: null },
    userId: ACTOR_A, coupleId: "synthetic-couple", userRole: "bride", userName: "합성 사용자",
    latestSharedMessage: { id: MESSAGE_ID, sender_type: "ai", visibility: "shared", metadata: { pending_amora_action: action } },
    reviewingPendingActionKey: `${MESSAGE_ID}:${ACTION_ID}:${action.inputDigest}`,
    pendingActionApproval: { actionId: ACTION_ID, messageId: MESSAGE_ID, status: approved, mutation: null, error: null },
    Crypto: { randomUUID: () => "30000000-0000-4000-8000-000000000003" },
    getAiFailureMessage: error => error.message,
    sendAiDraft: async draft => { state.sent.push(draft); },
    messages: [],
    findDurableUserMessage: async () => null,
    requestAiMessageIngest: async draft => {
      state.ingested.push(draft);
      return { outcome: "persisted", safetyPrivacyRedirected: false, message: {
        id: "synthetic-persisted-question", couple_id: draft.coupleId, sender_id: draft.userId,
        role: "user", visibility: "shared", content: draft.text,
        metadata: { client_request_id: draft.clientRequestId, confirmed_amora_action_id: draft.confirmedActionId },
      } };
    },
    streamAiRequest: async request => { state.streamed.push(request); },
    supabase: { auth: {
      getSession: async () => {
        state.authReads++;
        if (options.getSession) await options.getSession();
        return { data: { session: { user: { id: sessionUserIdRef.current }, access_token: state.token } } };
      },
      refreshSession: async () => {
        state.refreshes++;
        if (options.refreshSession) await options.refreshSession();
        state.token = `synthetic-refreshed-${sessionUserIdRef.current}`;
        return { error: null, data: { session: { user: { id: sessionUserIdRef.current }, access_token: state.token } } };
      },
    } },
    fetch: async (url, init) => {
      state.requests.push({ url, ...init });
      const status = options.firstUnauthorized && state.requests.length === 1 ? 401 : 200;
      if (options.fetch) await options.fetch(state.requests.length);
      return { ok: status === 200, status, json: async () => {
        if (options.json) await options.json();
        return status === 401 ? { error: "로그인 확인 필요" } : init.method === "PUT" ? { applicationGranted: true, retryAfterMs: 0 } : approved;
      } };
    },
  };
  for (const name of ["setActiveScope", "setTarget", "setApplyingPendingActionId", "setPendingActionNotice", "setPendingActionApproval", "setReviewingPendingActionKey", "setStreaming", "setLaneFailure", "setMessages", "setInputByLane"]) {
    bindings[name] = value => state.updates.push({ name, value });
  }
  const names = ["ChatTransportError", "AmoraSharedActionRequestError", "isRecord", "requestAmoraSharedActionWithToken", "requestAmoraSharedAction",
    "requestAmoraSharedActionStatus", "requestAmoraSharedActionApproval", "requestAmoraApplicationClaim", "getAmoraSharedActionFailureMessage",
    "handleApplyPendingAction", "handleWithdrawPendingAction"];
  if (options.realDraftSender) names.push("sendAiDraft", "aiLaneForVisibility", "handleRetry");
  const declarations = [];
  const snapshots = [];
  const visit = node => {
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name && names.includes(node.name.text)) declarations.push(node.getText(screenTree));
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && ["renderedSessionGeneration", "isCurrentPendingActionSession"].includes(node.name.text)) snapshots.push(`const ${node.getText(screenTree)};`);
    ts.forEachChild(node, visit);
  };
  visit(screenTree);
  assert.equal(declarations.length, names.length);
  const compiled = ts.transpileModule([...snapshots, ...declarations].join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const api = new Function("bindings", `with (bindings) { ${compiled}; return {${names.join(",")}}; }`)(bindings);
  return { ...api, state, guard, bindings, sessionUserIdRef, changeOwner(owner) { sessionUserIdRef.current = owner; guard.invalidate(); } };
}

for (const owners of [[ACTOR_B], [ACTOR_B, ACTOR_A]]) {
  test(`retained review confirmation cannot adopt ${owners.length === 1 ? "B" : "a new A session"}`, async () => {
    const h = screenHarness();
    for (const owner of owners) h.changeOwner(owner);
    await h.handleApplyPendingAction(ACTION_ID);
    assert.equal(h.state.authReads, 0, "stale review must be rejected before even reading a replacement session");
    assert.deepEqual(h.state.requests, []);
    assert.deepEqual(h.state.sent, []);
    assert.deepEqual(h.state.updates, []);
  });
}

test("same-owner reviewed confirmation claims exactly once with explicit originating actor then sends the approved draft", async () => {
  const h = screenHarness();
  await h.handleApplyPendingAction(ACTION_ID);
  assert.equal(h.state.requests.length, 1);
  assert.equal(h.state.requests[0].method, "PUT");
  assert.deepEqual(JSON.parse(h.state.requests[0].body), { messageId: MESSAGE_ID, expectedActorId: ACTOR_A });
  assert.equal(h.state.sent.length, 1);
  assert.equal(h.state.sent[0].userId, ACTOR_A);
  assert.equal(h.state.sent[0].sessionGeneration, 1);
});

test("the immediate auth-ref change rejects a retained review even before a generation reset or rerender", async () => {
  const h = screenHarness();
  h.sessionUserIdRef.current = ACTOR_B;
  await h.handleApplyPendingAction(ACTION_ID);
  assert.equal(h.state.authReads, 0);
  assert.deepEqual(h.state.requests, []);
  assert.deepEqual(h.state.sent, []);
  assert.deepEqual(h.state.updates, []);
});

test("an unmounted review cannot start an approval", async () => {
  const h = screenHarness();
  h.state.mounted = false;
  await h.handleApplyPendingAction(ACTION_ID);
  assert.equal(h.state.authReads, 0);
  assert.deepEqual(h.state.requests, []);
});

for (const method of ["GET", "POST", "PUT", "DELETE"]) {
  test(`${method} transports the same explicit actor across a same-owner token refresh`, async () => {
    const h = screenHarness({ firstUnauthorized: true });
    await h.requestAmoraSharedAction(ACTION_ID, MESSAGE_ID, method, ACTOR_A, () => h.guard.isCurrent(1));
    assert.equal(h.state.refreshes, 1);
    assert.equal(h.state.requests.length, 2);
    for (const request of h.state.requests) {
      if (method === "GET") {
        assert.equal(new URL(request.url).searchParams.get("expectedActorId"), ACTOR_A);
      } else assert.deepEqual(JSON.parse(request.body), { messageId: MESSAGE_ID, expectedActorId: ACTOR_A });
    }
  });
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

for (const phase of ["getSession", "refreshSession", "fetch", "json"]) {
  test(`A→B→A while awaiting ${phase} cannot send or retry a stale approval`, async () => {
    const entered = deferred();
    const release = deferred();
    const h = screenHarness({ firstUnauthorized: phase !== "getSession", [phase]: async () => { entered.resolve(); await release.promise; } });
    const operation = h.handleApplyPendingAction(ACTION_ID);
    await entered.promise;
    h.changeOwner(ACTOR_B);
    h.changeOwner(ACTOR_A);
    const writesBefore = h.state.updates.length;
    release.resolve();
    await operation;
    assert.equal(h.state.requests.length, phase === "getSession" ? 0 : 1);
    assert.equal(h.state.refreshes, phase === "refreshSession" ? 1 : 0);
    assert.deepEqual(h.state.sent, []);
    assert.equal(h.state.updates.length, writesBefore, "late completion cannot alter replacement session UI");
  });
}

for (const owner of [ACTOR_B, ACTOR_A]) {
  for (const phase of ["getSession", "json"]) {
    test(`late successful claim at ${phase} cannot release replacement ${owner === ACTOR_A ? "A" : "B"} operation locks or UI`, async () => {
      const entered = deferred();
      const release = deferred();
      const h = screenHarness({ [phase]: async () => { entered.resolve(); await release.promise; } });
      const operation = h.handleApplyPendingAction(ACTION_ID);
      await entered.promise;
      h.changeOwner(ACTOR_B);
      if (owner === ACTOR_A) h.changeOwner(ACTOR_A);
      h.bindings.sendingRef.current = true;
      h.bindings.applyingPendingActionRef.current = "replacement-operation";
      const writesBefore = h.state.updates.length;
      release.resolve();
      await operation;
      assert.equal(h.bindings.sendingRef.current, true);
      assert.equal(h.bindings.applyingPendingActionRef.current, "replacement-operation");
      assert.equal(h.state.updates.length, writesBefore);
      assert.deepEqual(h.state.sent, []);
      assert.equal(h.state.requests.length, phase === "getSession" ? 0 : 1);
    });
  }
}

test("retained withdrawal rejects a replaced owner before inspecting the old proposal or reading auth", async () => {
  const h = screenHarness();
  let proposalReads = 0;
  Object.defineProperty(h.bindings.latestSharedMessage, "metadata", { get() { proposalReads++; return null; } });
  h.changeOwner(ACTOR_B);
  await h.handleWithdrawPendingAction(ACTION_ID);
  assert.equal(proposalReads, 0);
  assert.equal(h.state.authReads, 0);
  assert.deepEqual(h.state.requests, []);
  assert.deepEqual(h.state.updates, []);
});

function approvedDraft() {
  return { userId: ACTOR_A, coupleId: "synthetic-couple", clientRequestId: "synthetic-retry", sourceLane: "shared_ai",
    text: "확인한 변경 반영", visibility: "shared", requestedVisibility: "shared", sessionGeneration: 1,
    providerAttachmentCount: 0, confirmedActionId: ACTION_ID, amoraSourceMessageId: MESSAGE_ID };
}

test("a same-owner approved draft retry preserves its actor and generation through claim and AI send", async () => {
  const h = screenHarness({ realDraftSender: true, firstUnauthorized: true });
  const draft = approvedDraft();
  await h.sendAiDraft(draft, true);
  assert.equal(h.state.requests.length, 2);
  for (const request of h.state.requests) assert.deepEqual(JSON.parse(request.body), { messageId: MESSAGE_ID, expectedActorId: ACTOR_A });
  assert.deepEqual(h.state.ingested, [draft]);
  assert.equal(h.state.streamed.length, 1);
  assert.equal(h.state.streamed[0].sessionGeneration, 1);
  assert.equal(h.state.streamed[0].body.confirmedActionId, ACTION_ID);
});

test("an approved draft retry waiting for auth cannot adopt A→B→A", async () => {
  const entered = deferred();
  const release = deferred();
  const h = screenHarness({ realDraftSender: true, getSession: async () => { entered.resolve(); await release.promise; } });
  const operation = h.sendAiDraft(approvedDraft(), true);
  await entered.promise;
  h.changeOwner(ACTOR_B);
  h.changeOwner(ACTOR_A);
  const writesBefore = h.state.updates.length;
  release.resolve();
  await operation;
  assert.deepEqual(h.state.requests, []);
  assert.deepEqual(h.state.ingested, []);
  assert.deepEqual(h.state.streamed, []);
  assert.equal(h.state.updates.length, writesBefore);
});

test("a retained retry callback does not rebind an older approved draft to a new A session", async () => {
  const h = screenHarness({ realDraftSender: true });
  h.bindings.activeSendFailure = { kind: "ai_insert", canRetry: true, draft: approvedDraft() };
  h.bindings.activeLane = "shared_ai";
  h.changeOwner(ACTOR_B);
  h.changeOwner(ACTOR_A);
  await h.handleRetry();
  assert.equal(h.state.authReads, 0);
  assert.deepEqual(h.state.requests, []);
  assert.deepEqual(h.state.updates, []);
});
