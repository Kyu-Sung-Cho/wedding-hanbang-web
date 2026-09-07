import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

const sourcePath = fileURLToPath(new URL("../lib/chatPrivacyScope.ts", import.meta.url));
const compiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
});
const module = { exports: {} };
const timestamp = { exports: {} };
const timestampCode = ts.transpileModule(readFileSync(new URL("../../../../packages/shared/src/utils/chatTimestamp.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
new Function("exports", "module", timestampCode)(timestamp.exports, timestamp);
new Function("exports", "module", "require", compiled.outputText)(module.exports, module, () => timestamp.exports);
const {
  chatVisibilityForScope,
  isMessageInChatScope,
  isMessageInAiContext,
  selectChatScope,
  updateChatScopeDraft,
} = module.exports;

function loadSessionHarness({ sharedCursor = null, privateCursor = null, history = [], profileError = null, historyError = null, onQuery } = {}) {
  const screen = readFileSync(new URL("../../app/(tabs)/chat.tsx", import.meta.url), "utf8");
  const tree = ts.createSourceFile("chat.tsx", screen, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let load;
  const visit = node => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "loadChatSession") load = node.getText(tree);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.ok(load, "execute the screen's actual session loader");
  const state = { messages: [], failures: {}, recoveries: {}, reloads: 0, initialLoaded: false, error: null };
  const subscriptions = [];
  const queries = [];
  const profile = { id: "viewer", name: "합성 사용자", role: "bride", couple_id: "couple", shared_chat_cleared_at: sharedCursor, private_chat_cleared_at: privateCursor };
  let generation = 0;
  const query = table => {
    const filters = [];
    const record = { table, columns: "", filters, limit: Infinity, one: false };
    queries.push(record);
    const builder = {
      select(columns) { record.columns = columns; return builder; },
      eq(field, value) { filters.push(["eq", field, value]); return builder; },
      neq(field, value) { filters.push(["neq", field, value]); return builder; },
      gt(field, value) { filters.push(["gt", field, value]); return builder; },
      or(value) { filters.push(["or", value]); return builder; },
      order() { return builder; },
      limit(value) { record.limit = value; return builder; },
      single() { record.one = true; return builder; },
      maybeSingle() { record.one = true; return builder; },
      then(resolve, reject) {
        let rows = table === "profiles" ? [Object.fromEntries(record.columns.split(",").map(key => key.trim()).map(key => [key, profile[key]]))]
          : table === "couples" ? [{ bride_id: "viewer", groom_id: "partner" }]
          : table === "couple_profile_directory" ? [{ id: "partner", name: "상대" }]
          : history.filter(row => filters.every(([kind, field, value]) => {
            if (kind === "eq") return row[field] === value;
            if (kind === "neq") return row[field] !== value;
            if (kind === "gt") return timestamp.exports.compareChatTimestamps(row[field], value) === 1;
            if (!field.includes("visibility.eq.")) return true;
            const lane = new RegExp(`and\\(visibility\\.eq\\.${row.visibility},created_at\\.gt\\.([^)]*)\\)`).exec(field);
            if (lane) return timestamp.exports.compareChatTimestamps(row.created_at, lane[1]) === 1;
            return field.replace(/and\([^)]*\)/g, "").split(",").includes(`visibility.eq.${row.visibility}`);
          }));
        if (table === "chat_messages") rows = rows.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, record.limit);
        const result = { data: record.one ? rows[0] ?? null : rows, error: table === "profiles" ? profileError : table === "chat_messages" ? historyError : null };
        return Promise.resolve(onQuery?.({ table, profile, record })).then(() => result).then(resolve, reject);
      },
    };
    return builder;
  };
  const channel = { on(_kind, filter, handler) { subscriptions.push({ filter, handler }); return channel; }, subscribe() { return channel; } };
  const apply = (key, value) => { state[key] = typeof value === "function" ? value(state[key]) : value; };
  const bindings = {
    ...module.exports,
    supabase: { auth: { getUser: async () => ({ data: { user: { id: "viewer" } } }) }, from: query, channel: () => channel, removeChannel: () => {} },
    chatSessionGenerationRef: { current: { begin: () => ++generation, invalidate: () => ++generation } },
    chatViewCursorsRef: { current: { shared: null, private: null } },
    refreshChatSessionRef: { current: null }, activeControllerRef: { current: null },
    pendingChatDraftRestoreRef: { current: null }, inputByLaneRef: { current: {} },
    createEmptyAmoraChatLaneRecord: create => ({ shared_ai: create(), private_ai: create(), shared_partner: create() }),
    resetChatSessionState() { state.messages = []; state.drafts = {}; },
    isCurrentChatSession: value => value === generation,
    sessionUserIdRef: { current: null },
    observedAuthUserId: null,
    scheduleChatSessionReload() { generation++; state.messages = []; state.reloads++; },
    hasLinkedPartnerRef: { current: false }, linkedPartnerIdRef: { current: null }, channelRef: { current: null },
    persistedAiRequestKeysRef: { current: new Set() },
    setMessages: value => apply("messages", value), setInitialLoaded: value => apply("initialLoaded", value), setChatLoadError: value => apply("error", value),
    setInputByLane: value => apply("drafts", value),
    setLaneFailure: (lane, failure) => { state.failures[lane] = failure; },
    setColdStartAiRecoveryByLane: value => apply("recoveries", value), setSendFailuresByLane: value => apply("failures", value),
    chatMessageFromRealtimeRow: row => row,
    canViewerSeeChatMessage: row => row.visibility !== "groom_private",
    mergeColdStartRecoveryHistory: (rows, supplemental) => [...new Map([...rows, ...supplemental].filter(Boolean).map(row => [row.id, row])).values()],
    reconcileMobileAmoraCrisisRecovery: rows => rows,
    findColdStartAiRecovery: () => null,
    aiLaneForVisibility: value => value === "shared" ? "shared_ai" : "private_ai",
    mergeRealtimeMessage: (rows, incoming) => [...rows, incoming],
    updateAmoraChatLaneRecord: (record, lane, value) => ({ ...record, [lane]: value }),
  };
  for (const name of ["setUserId", "setCoupleId", "setUserName", "setUserRole", "setHasLinkedPartner", "setPartnerName", "setStreaming"]) bindings[name] = () => {};
  const compiledLoad = ts.transpileModule(load, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const run = new Function("bindings", `with (bindings) { ${compiledLoad}; return loadChatSession; }`)(bindings);
  return { run, state, subscriptions, queries, profile, history, bindings,
    refresh: () => bindings.refreshChatSessionRef.current?.(),
    failHistoryRead: () => { historyError = new Error("synthetic network outage"); },
    recoverHistoryRead: () => { historyError = null; },
    generation: () => generation,
  };
}

function historyRow(id, visibility, createdAt, metadata = null) {
  return { id, couple_id: "couple", sender_id: "viewer", sender_type: "bride", role: "user", content: "합성 대화", visibility, created_at: createdAt, metadata };
}

test("the actual mobile loader never restores a conversation or confirmed retry hidden by the viewer's web reset", async () => {
  const cursor = "2026-09-06T01:00:00.000Z";
  const harness = loadSessionHarness({ sharedCursor: cursor, privateCursor: cursor, history: [
    historyRow("hidden-confirmation", "shared", cursor, { confirmed_amora_action_id: "old-action", client_request_id: "old-request" }),
    historyRow("hidden-private", "bride_private", "2026-09-05T23:00:00.000Z"),
  ] });
  await harness.run();
  assert.deepEqual(harness.state.messages, []);
  assert.deepEqual(harness.state.failures, {});
});

test("clearing the shared view preserves this viewer's private lane and strictly newer shared rows", async () => {
  const cursor = "2026-09-06T01:00:00.000Z";
  const harness = loadSessionHarness({ sharedCursor: cursor, history: [
    historyRow("hidden-shared", "shared", cursor),
    historyRow("own-private", "bride_private", "2026-09-05T23:00:00.000Z"),
    historyRow("new-shared", "shared", "2026-09-06T01:00:00.001Z"),
    historyRow("other-private", "groom_private", "2026-09-06T01:00:00.002Z"),
  ] });
  await harness.run();
  assert.deepEqual(harness.state.messages.map(row => row.id), ["own-private", "new-shared"]);
});

test("a profile cursor update invalidates loaded mobile history even when user and couple stay the same", async () => {
  const harness = loadSessionHarness({ history: [historyRow("old", "shared", "2026-09-05T23:00:00.000Z")] });
  await harness.run();
  const listener = harness.subscriptions.find(entry => entry.filter.table === "profiles");
  assert.ok(listener);
  listener.handler({ new: { ...harness.profile, shared_chat_cleared_at: "2026-09-06T01:00:00.000Z" } });
  assert.equal(harness.state.reloads, 1);
  assert.deepEqual(harness.state.messages, []);
});

test("a failed profile or history read is recoverable failure rather than a successful empty conversation", async () => {
  for (const options of [{ profileError: new Error("synthetic read failure") }, { historyError: new Error("synthetic read failure") }]) {
    const harness = loadSessionHarness(options);
    await harness.run();
    assert.ok(harness.state.error);
    assert.equal(harness.state.initialLoaded, true);
    assert.deepEqual(harness.state.messages, []);
  }
});

test("a reset committed while the history request is in flight cannot publish the old response", async () => {
  const harness = loadSessionHarness({ history: [historyRow("old", "shared", "2026-09-05T23:00:00.000Z")],
    onQuery({ table, profile }) { if (table === "chat_messages") profile.shared_chat_cleared_at = "2026-09-06T01:00:00.000Z"; },
  });
  await harness.run();
  assert.equal(harness.state.reloads, 1);
  assert.deepEqual(harness.state.messages, []);
});

test("after a cursor event the old subscription and in-flight session can no longer publish messages", async () => {
  const harness = loadSessionHarness();
  await harness.run();
  const generation = harness.generation();
  harness.subscriptions.find(entry => entry.filter.table === "profiles").handler({ new: { ...harness.profile, private_chat_cleared_at: "2026-09-06T01:00:00.000Z" } });
  assert.equal(harness.bindings.isCurrentChatSession(generation), false);
  harness.subscriptions.find(entry => entry.filter.table === "chat_messages" && entry.filter.event === "INSERT").handler({ new: historyRow("late", "shared", "2026-09-06T01:00:01.000Z") });
  assert.deepEqual(harness.state.messages, []);
});

test("a delayed profile event cannot move the cursor backward, including within one millisecond", async () => {
  const harness = loadSessionHarness({ sharedCursor: "2026-09-06T01:00:00.123500Z" });
  await harness.run();
  const listener = harness.subscriptions.find(entry => entry.filter.table === "profiles");
  listener.handler({ new: { ...harness.profile, shared_chat_cleared_at: "2026-09-06T01:00:00.123100Z" } });
  assert.equal(harness.state.reloads, 0);
  listener.handler({ new: { ...harness.profile, shared_chat_cleared_at: "2026-09-06T01:00:00.123900Z" } });
  assert.equal(harness.state.reloads, 1);
});

test("the database filters hidden or other-private rows before the 200-row limit", async () => {
  const harness = loadSessionHarness({ sharedCursor: "2026-09-06T01:00:00.000Z", history: [
    ...Array.from({ length: 210 }, (_, index) => historyRow(`other-${index}`, "groom_private", "2026-09-06T02:00:00.000Z")),
    historyRow("visible-private", "bride_private", "2026-09-06T01:00:00.000Z"),
    historyRow("visible-shared", "shared", "2026-09-06T01:00:00.000001Z"),
  ] });
  await harness.run();
  assert.deepEqual(harness.state.messages.map(row => row.id), ["visible-private", "visible-shared"]);
  const supplemental = harness.queries.filter(query => query.table === "chat_messages" && query.limit === 1 && query.filters.some(([kind, field, value]) => kind === "eq" && field === "visibility" && value === "shared"));
  assert.equal(supplemental.length, 2);
  assert.ok(supplemental.every(query => query.filters.some(([kind, field]) => kind === "gt" && field === "created_at")));
});

test("returning to the chat catches up missed persisted rows without clearing an unsent draft", async () => {
  const harness = loadSessionHarness();
  await harness.run();
  harness.bindings.inputByLaneRef.current = { shared_ai: "작성 중", private_ai: "나만 초안", shared_partner: "" };
  harness.history.push(historyRow("missed", "shared", "2026-09-06T01:00:00.000Z"));
  await harness.refresh();
  assert.deepEqual(harness.state.messages.map(row => row.id), ["missed"]);
  assert.equal(harness.bindings.inputByLaneRef.current.private_ai, "나만 초안");
  harness.profile.shared_chat_cleared_at = "2026-09-06T01:00:00.000Z";
  await harness.refresh();
  assert.equal(harness.state.reloads, 1);
  assert.deepEqual(harness.state.messages, []);
});

test("a foreground read failure invalidates the active response and keeps a same-owner draft for retry", async () => {
  const harness = loadSessionHarness();
  await harness.run();
  const generation = harness.generation();
  let aborted = false;
  harness.bindings.activeControllerRef.current = { abort() { aborted = true; } };
  harness.bindings.inputByLaneRef.current = { shared_ai: "아직 안 보낸 질문", private_ai: "개인 초안", shared_partner: "" };
  harness.failHistoryRead();
  await harness.refresh();
  assert.equal(aborted, true);
  assert.equal(harness.bindings.isCurrentChatSession(generation), false);
  assert.ok(harness.state.error);
  assert.equal(harness.bindings.pendingChatDraftRestoreRef.current.userId, "viewer");
  assert.equal(harness.bindings.pendingChatDraftRestoreRef.current.drafts.private_ai, "개인 초안");
});

test("malformed or missing clear cursors fail closed instead of assuming no reset", async () => {
  for (const value of [undefined, "invalid", "2026-09-06T01:00:00Z),visibility.eq.groom_private"]) {
    const harness = loadSessionHarness();
    harness.profile.shared_chat_cleared_at = value;
    await harness.run();
    assert.ok(harness.state.error);
    assert.deepEqual(harness.state.messages, []);
  }
});

test("a persisted answer missed while backgrounded clears the retry and cold-start notices on return", async () => {
  const harness = loadSessionHarness();
  await harness.run();
  harness.state.failures.shared_ai = { kind: "ai_response", request: { serverRequestKey: "request-key", body: { coupleId: "couple", userMessageId: "question" } } };
  harness.state.recoveries = { shared_ai: { userMessageId: "question" }, private_ai: null, shared_partner: null };
  harness.history.push({ ...historyRow("answer", "shared", "2026-09-06T01:00:00.000Z"), sender_type: "ai", sender_id: null, role: "assistant", metadata: { client_visible_request_id: "request-key", in_reply_to_user_message_id: "question" } });
  await harness.refresh();
  assert.equal(harness.state.failures.shared_ai, null);
  assert.equal(harness.state.recoveries.shared_ai, null);
  assert.equal(harness.bindings.persistedAiRequestKeysRef.current.has("request-key"), true);
});

test("retrying a foreground read error restores the draft only to the same owner and couple", async () => {
  for (const changeCouple of [false, true]) {
    const harness = loadSessionHarness();
    await harness.run();
    const drafts = { shared_ai: "미전송", private_ai: "개인 초안", shared_partner: "" };
    harness.bindings.inputByLaneRef.current = drafts;
    harness.failHistoryRead();
    await harness.refresh();
    harness.recoverHistoryRead();
    if (changeCouple) harness.profile.couple_id = "new-couple";
    await harness.run();
    assert.deepEqual(harness.state.drafts, changeCouple ? {} : drafts);
    assert.equal(harness.bindings.pendingChatDraftRestoreRef.current, null);
  }
});

test("private scope selection locks the target to Amora and fails closed without a verified role", () => {
  assert.deepEqual(
    selectChatScope({ scope: "shared", target: "partner" }, "private", "bride"),
    { scope: "private", target: "ai" },
  );
  assert.deepEqual(
    selectChatScope({ scope: "shared", target: "partner" }, "private", null),
    { scope: "shared", target: "partner" },
  );
});

test("scope visibility separates rendering while private AI context can retain shared history", () => {
  assert.equal(chatVisibilityForScope("shared", "bride"), "shared");
  assert.equal(chatVisibilityForScope("private", "bride"), "bride_private");
  assert.equal(chatVisibilityForScope("private", "groom"), "groom_private");
  assert.equal(chatVisibilityForScope("private", null), null);

  assert.equal(isMessageInChatScope("shared", "shared", "bride"), true);
  assert.equal(isMessageInChatScope("bride_private", "shared", "bride"), false);
  assert.equal(isMessageInChatScope("bride_private", "private", "bride"), true);
  assert.equal(isMessageInChatScope("groom_private", "private", "bride"), false);

  assert.equal(isMessageInAiContext("shared", "bride_private"), true);
  assert.equal(isMessageInAiContext("bride_private", "bride_private"), true);
  assert.equal(isMessageInAiContext("groom_private", "bride_private"), false);
  assert.equal(isMessageInAiContext("bride_private", "shared"), false);
});

test("unsent private and shared drafts remain isolated across scope changes", () => {
  let drafts = { shared: "", private: "" };
  drafts = updateChatScopeDraft(drafts, "private", "개인 상담 초안");
  assert.equal(drafts.shared, "");
  assert.equal(drafts.private, "개인 상담 초안");

  drafts = updateChatScopeDraft(drafts, "shared", "함께 대화 초안");
  assert.equal(drafts.shared, "함께 대화 초안");
  assert.equal(drafts.private, "개인 상담 초안");
});
