import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";
import ts from "typescript";

function compileFile(path, deps = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("exports", "module", "require", code)(module.exports, module, name => {
    assert.ok(Object.hasOwn(deps, name), name);
    return deps[name];
  });
  return module.exports;
}
const timestamp = compileFile("../../../../packages/shared/src/utils/chatTimestamp.ts");
const privacy = compileFile("../lib/chatPrivacyScope.ts", { "@hanbang/shared": timestamp });
const paging = compileFile("../lib/chatHistoryPager.ts", { "@hanbang/shared": timestamp });
const clearRequest = compileFile("../lib/chatClearRequest.ts");
const clearView = compileFile("../lib/chatViewClear.ts", { "@hanbang/shared": timestamp, "@/lib/chatClearRequest": clearRequest });
const compareRows = (a, b) => timestamp.compareChatTimestamps(a.created_at, b.created_at) || a.id.localeCompare(b.id);
const row = (n, visibility = "shared", at = `2026-09-20T00:00:00.${String(n).padStart(6, "0")}Z`) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, couple_id: "couple", sender_id: "viewer",
  sender_type: "bride", role: "user", content: `합성 대화 ${n}`, visibility, created_at: at, metadata: null,
});
function expressionMatches(expression, value) {
  const split = text => { let depth = 0; let part = ""; const all = [];
    for (const char of text) { if (char === "(") depth++; if (char === ")") depth--; if (char === "," && depth === 0) { all.push(part); part = ""; } else part += char; }
    all.push(part); return all; };
  if (expression.startsWith("and(")) return split(expression.slice(4, -1)).every(item => expressionMatches(item, value));
  if (expression.startsWith("or(")) return split(expression.slice(3, -1)).some(item => expressionMatches(item, value));
  const [, field, operator, expected] = /^([^.]*)\.([^.]*)\.(.*)$/u.exec(expression) ?? [];
  const actual = field?.startsWith("metadata->>") ? value.metadata?.[field.slice(11)] ?? null : value[field];
  const comparison = field === "created_at" ? timestamp.compareChatTimestamps(actual, expected) : String(actual).localeCompare(expected);
  return operator === "is" ? actual === null : operator === "eq" ? actual === expected
    : operator === "neq" ? actual !== expected : operator === "gt" ? comparison === 1 : operator === "lt" ? comparison === -1 : false;
}
function harness(history, onQuery = () => {}) {
  const source = readFileSync(new URL("../../app/(tabs)/chat.tsx", import.meta.url), "utf8");
  const tree = ts.createSourceFile("chat.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let loader;
  const visit = node => { if (ts.isFunctionDeclaration(node) && node.name?.text === "loadChatSession") loader = node.getText(tree); ts.forEachChild(node, visit); };
  visit(tree);
  assert.ok(loader);
  let generation = 0;
  const state = { messages: [], pages: {}, error: null, queries: [] };
  const profile = { name: "합성 사용자", role: "bride", couple_id: "couple", shared_chat_cleared_at: null, private_chat_cleared_at: null };
  const query = table => {
    const record = { table, filters: [], limit: Infinity, one: false };
    state.queries.push(record);
    const q = {
      select() { return q; }, eq(field, expected) { record.filters.push(value => value[field] === expected); return q; },
      neq(field, expected) { record.filters.push(value => value[field] !== expected); return q; },
      gt(field, expected) { record.filters.push(value => timestamp.compareChatTimestamps(value[field], expected) === 1); return q; },
      or(expression) { record.filters.push(value => expressionMatches(`or(${expression})`, value)); record.expression = expression; return q; },
      order() { return q; }, limit(count) { record.limit = count; return q; },
      single() { record.one = true; return q; }, maybeSingle() { record.one = true; return q; }, abortSignal(signal) { record.signal = signal; return q; },
      async then(resolve, reject) {
        try {
          const rows = table === "profiles" ? [profile] : table === "couples" ? [{ bride_id: "viewer", groom_id: "partner" }]
            : table === "couple_profile_directory" ? [{ id: "partner", name: "상대" }]
              : history.filter(value => record.filters.every(filter => filter(value))).sort((a, b) => -compareRows(a, b)).slice(0, record.limit);
          await onQuery({ table, record, profile });
          return resolve({ data: record.one ? rows[0] ?? null : rows, error: null });
        } catch (error) { return reject(error); }
      },
    };
    return q;
  };
  const channel = { on() { return channel; }, subscribe() { return channel; } };
  const apply = (key, value) => { state[key] = typeof value === "function" ? value(state[key]) : value; };
  const bindings = {
    ...paging,
    ...privacy, supabase: { auth: { getUser: async () => ({ data: { user: { id: "viewer" } } }) }, from: query, channel: () => channel },
    chatSessionGenerationRef: { current: { begin: () => ++generation, invalidate: () => ++generation, instanceId: () => 1 } },
    isCurrentChatSession: value => value === generation, resetChatSessionState() {}, scheduleChatSessionReload: () => { generation++; state.messages = []; },
    chatViewCursorsRef: { current: { shared: null, private: null } }, refreshChatSessionRef: { current: null }, historyPagerRef: { current: null },
    setHistoryPages: value => apply("pages", value), sessionUserIdRef: { current: null }, observedAuthUserId: null,
    hasLinkedPartnerRef: { current: false }, linkedPartnerIdRef: { current: null }, channelRef: { current: null }, persistedAiRequestKeysRef: { current: new Set() },
    pendingChatDraftRestoreRef: { current: null }, chatViewClearCarryRef: { current: null }, takeChatViewClearCarry: clearView.takeChatViewClearCarry,
    chatMessageFromRealtimeRow: value => value, canViewerSeeChatMessage: value => value.visibility !== "groom_private",
    mergeColdStartRecoveryHistory: (previous, incoming) => [...new Map([...previous, ...incoming].map(value => [value.id, value])).values()].sort(compareRows),
    reconcileMobileAmoraCrisisRecovery: values => values, findColdStartAiRecovery: () => null,
    setMessages: value => apply("messages", value), setChatLoadError: value => apply("error", value),
    createEmptyAmoraChatLaneRecord: create => ({ shared_ai: create(), private_ai: create(), shared_partner: create() }),
  };
  for (const name of ["setUserId", "setCoupleId", "setUserName", "setUserRole", "setHasLinkedPartner", "setPartnerName", "setInitialLoaded", "setActiveScope", "setTarget", "setInputByLane", "setLaneFailure", "setColdStartAiRecoveryByLane", "setSendFailuresByLane"]) bindings[name] = () => {};
  const code = ts.transpileModule(loader, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const load = new Function("bindings", `with (bindings) { ${code}; return loadChatSession; }`)(bindings);
  return { load, state, bindings, profile, history };
}

test("a reader can retrieve messages older than the initial 200 without duplicates", async () => {
  const history = Array.from({ length: 251 }, (_, index) => row(index + 1));
  const h = harness(history);
  await h.load();
  assert.equal(h.state.error, null);
  assert.equal(h.state.messages.length, 200);
  await h.bindings.historyPagerRef.current?.load("shared");
  await h.bindings.historyPagerRef.current?.load("shared");
  assert.equal(h.state.messages.length, 251);
  assert.equal(new Set(h.state.messages.map(value => value.id)).size, 251);
  assert.deepEqual(h.state.messages.map(value => value.id), history.map(value => value.id));
});

test("history failures offer retry without erasing the loaded conversation, and cannot remain loading forever", async () => {
  let fail = true;
  const delivered = [];
  const pager = paging.createMobileChatHistoryPager({ initialRows: [row(100)], hasMore: true,
    visibility: { shared: "shared", private: "bride_private" }, isCurrent: () => true,
    verifyBoundary: async () => true, timeoutMs: 10,
    readPage: () => fail ? new Promise(() => {}) : Promise.resolve([row(99)]),
    onPage: rows => delivered.push(...rows), onState() {},
  });
  const sentinel = Symbol("still loading");
  const result = await Promise.race([pager.load("shared"), new Promise(resolve => globalThis.setTimeout(() => resolve(sentinel), 80))]);
  assert.notEqual(result, sentinel);
  assert.equal(pager.getState().shared.loading, false);
  assert.match(pager.getState().shared.error, /다시/);
  assert.equal(pager.getState().shared.hasMore, true);
  assert.deepEqual(delivered, []);
  fail = false;
  assert.equal(await pager.load("shared"), true);
  assert.deepEqual(delivered, [row(99)]);
});

test("equal timestamps use the message id keyset, and microsecond order is preserved", async () => {
  const history = Array.from({ length: 301 }, (_, index) => row(index + 1, "shared", "2026-09-20T00:00:00.000123Z"));
  history.push(row(302, "shared", "2026-09-20T00:00:00.000124Z"));
  const h = harness(history);
  await h.load();
  for (let index = 0; index < 3; index++) await h.bindings.historyPagerRef.current.load("shared");
  assert.deepEqual(h.state.messages.map(value => value.id), history.map(value => value.id));
  assert.equal(h.state.pages.shared.hasMore, false);
});

test("a scope absent from the recent 200 starts its own first page, not before its cold-start supplement", async () => {
  const privateRows = Array.from({ length: 70 }, (_, index) => row(index + 1, "bride_private"));
  const sharedRows = Array.from({ length: 230 }, (_, index) => row(index + 100));
  const h = harness([...privateRows, ...sharedRows, row(500, "groom_private")]);
  await h.load();
  const pager = h.bindings.historyPagerRef.current;
  assert.equal(h.state.messages.filter(value => value.visibility === "bride_private").length, 1);
  await pager.load("private");
  await pager.load("private");
  assert.deepEqual(h.state.messages.filter(value => value.visibility === "bride_private").map(value => value.id), privateRows.map(value => value.id));
  assert.ok(!h.state.messages.some(value => value.visibility === "groom_private"));
  assert.equal(h.state.messages.filter(value => value.visibility === "shared").length, 200);
});

test("paging never resurrects messages at or before either viewer clear cursor", async () => {
  const h = harness([...Array.from({ length: 270 }, (_, index) => row(index + 1)),
    ...Array.from({ length: 40 }, (_, index) => row(index + 1001, "bride_private", row(index + 1).created_at))]);
  h.profile.shared_chat_cleared_at = row(30).created_at;
  h.profile.private_chat_cleared_at = row(20).created_at;
  await h.load();
  for (const scope of ["private", "shared", "shared"]) await h.bindings.historyPagerRef.current.load(scope);
  assert.equal(h.state.messages.filter(value => value.visibility === "shared").length, 240);
  assert.equal(h.state.messages.filter(value => value.visibility === "bride_private").length, 20);
  assert.ok(h.state.messages.every(value => timestamp.compareChatTimestamps(value.created_at, value.visibility === "shared" ? h.profile.shared_chat_cleared_at : h.profile.private_chat_cleared_at) === 1));
});

test("a clear boundary moving during a page causes reload instead of publishing the stale rows", async () => {
  let changeBoundary = false;
  const h = harness(Array.from({ length: 251 }, (_, index) => row(index + 1)), ({ table, record, profile }) => {
    if (changeBoundary && table === "chat_messages" && record.limit === 50) profile.shared_chat_cleared_at = row(200).created_at;
  });
  await h.load();
  changeBoundary = true;
  const delivered = await h.bindings.historyPagerRef.current.load("shared");
  assert.equal(delivered, false);
  assert.deepEqual(h.state.messages, []);
});

test("a page is single flight and its late account-owned result is discarded", async () => {
  let finish;
  let current = true;
  let reads = 0;
  const delivered = [];
  const pager = paging.createMobileChatHistoryPager({ initialRows: [row(100)], hasMore: true,
    visibility: { shared: "shared", private: "bride_private" }, isCurrent: () => current,
    verifyBoundary: async () => true,
    readPage: () => { reads++; return new Promise(resolve => { finish = resolve; }); },
    onPage: rows => delivered.push(...rows), onState() {},
  });
  const first = pager.load("shared");
  await Promise.resolve();
  assert.equal(await pager.load("shared"), false);
  await Promise.resolve();
  assert.equal(reads, 1);
  current = false;
  finish([row(99)]);
  assert.equal(await first, false);
  assert.deepEqual(delivered, []);
});

test("late timed-out results cannot overwrite a successful retry, and disposal aborts pending pages", async () => {
  let finish;
  let signal;
  let retry = false;
  const delivered = [];
  const pager = paging.createMobileChatHistoryPager({ initialRows: [row(100)], hasMore: true,
    visibility: { shared: "shared", private: "bride_private" }, isCurrent: () => true,
    verifyBoundary: async () => true, timeoutMs: 10,
    readPage: request => { signal = request.signal; return retry ? Promise.resolve([row(98)]) : new Promise(resolve => { finish = resolve; }); },
    onPage: rows => delivered.push(...rows), onState() {},
  });
  await pager.load("shared");
  assert.equal(signal.aborted, true);
  retry = true;
  await pager.load("shared");
  finish([row(99)]);
  await Promise.resolve();
  assert.deepEqual(delivered, [row(98)]);
  const hanging = paging.createMobileChatHistoryPager({ initialRows: [], hasMore: true,
    visibility: { shared: "shared", private: null }, isCurrent: () => true,
    verifyBoundary: () => new Promise(() => {}), readPage: async () => [], onPage() { assert.fail("disposed"); }, onState() {},
  });
  const pending = hanging.load("shared");
  hanging.dispose();
  assert.equal(await pending, false);
});

test("older duplicates cannot replace a newer realtime version", () => {
  const current = { ...row(1), content: "실시간으로 확정된 내용" };
  assert.deepEqual(paging.mergeOlderChatHistory([current, row(2)], [row(1)]), [current, row(2)]);
});

test("the rendered history action targets the visible scope, exposes retry and disables loading", () => {
  const source = readFileSync(new URL("../../app/(tabs)/chat.tsx", import.meta.url), "utf8");
  const tree = ts.createSourceFile("chat.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  const visit = node => { if (ts.isFunctionDeclaration(node) && node.name?.text === "renderHistoryFooter") declaration = node.getText(tree); ts.forEachChild(node, visit); };
  visit(tree);
  const calls = [];
  const bindings = { historyPages: paging.createEmptyChatHistoryPages(), activeScope: "private", historyPagerRef: { current: { load: value => calls.push(value) } },
    View: "View", Text: "Text", Pressable: "Pressable", st: {}, React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) } };
  const code = ts.transpileModule(declaration, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  const render = new Function("bindings", `with(bindings){${code};return renderHistoryFooter;}`)(bindings);
  assert.equal(render(), null);
  bindings.historyPages.private.hasMore = true;
  let button = render().props.children.find(value => value?.type === "Pressable");
  button.props.onPress();
  assert.deepEqual(calls, ["private"]);
  bindings.historyPages.private.error = "다시 눌러 주세요";
  button = render().props.children.find(value => value?.type === "Pressable");
  assert.match(button.props.accessibilityLabel, /다시/);
  bindings.historyPages.private.loading = true;
  button = render().props.children.find(value => value?.type === "Pressable");
  assert.equal(button.props.disabled, true);
  assert.equal(button.props.accessibilityState.busy, true);
});
