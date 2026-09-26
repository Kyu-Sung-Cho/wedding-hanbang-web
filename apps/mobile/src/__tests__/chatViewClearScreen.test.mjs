import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

/* global Response, setImmediate */

/**
 * 아모라 탭의 「대화 화면 정리」 창과 비공개 대화 삭제 (2026-09-18).
 *
 * `chatViewClear.test.mjs` 가 문구·모드·응답 판정을 잰다면, 이 파일은 **화면이 실제로 그렇게 움직이는지**를
 * 잰다. 창 컴포넌트를 그려 보고, `chat.tsx` 의 실제 핸들러와 세션 불러오기(`loadChatSession`)를 꺼내 돌린다.
 *
 * 지키는 것:
 * - 머리 버튼은 대화를 다 불러왔고 이 범위에 보이는 메시지가 있을 때만 보이고, 답을 받는 중·보내는 중·반영 중·
 *   정리 중에는 누를 수 없다.
 * - 혼자인 사람에게는 「둘 다」가 없고, 대기 중인 요청 카드가 있으면 「둘 다」가 막힌다.
 * - 비공개 삭제는 네이티브 확인 창의 「삭제」를 눌러야만 나간다.
 * - 정리는 한 번만 나가고, 그동안 그 범위의 입력창은 보내지 않는다. 동의 요청도 한 번만 나간다.
 * - 서버가 확인한 뒤에만 화면이 바뀌고, 계정·세션이 바뀐 뒤의 응답은 화면을 바꾸지 않는다.
 * - 비공개 삭제 결과를 모르면 다시 불러오고 "확인하지 못했어요"라고만 말한다.
 * - 정리 뒤 세션이 다시 불러와져도(실시간 UPDATE 가 응답보다 먼저 와도) 같은 범위와 초안이 남는다.
 */
function compile(relative, deps = {}, { jsx = false } = {}) {
  const path = fileURLToPath(new URL(relative, import.meta.url));
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: jsx ? "module.tsx" : "module.ts",
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      ...(jsx ? { jsx: ts.JsxEmit.ReactJSX } : {}),
    },
  });
  const module = { exports: {} };
  new Function("exports", "module", "require", compiled.outputText)(module.exports, module, (specifier) => {
    if (Object.hasOwn(deps, specifier)) return deps[specifier];
    throw new Error(`unmocked dependency: ${specifier}`);
  });
  return module.exports;
}
const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const timestamp = compile("../../../../packages/shared/src/utils/chatTimestamp.ts");
const clearRequest = compile("../lib/chatClearRequest.ts");
const privacy = compile("../lib/chatPrivacyScope.ts", { "@hanbang/shared": timestamp });
const lib = compile("../lib/chatViewClear.ts", { "@hanbang/shared": timestamp, "@/lib/chatClearRequest": clearRequest });
const { colors } = compile("../../../../packages/design-tokens/src/colors.ts");
const COPY = lib.CHAT_VIEW_CLEAR_COPY;
const chat = read("../../app/(tabs)/chat.tsx");
const sheetSource = read("../components/chat/ChatViewClearSheet.tsx");

// ── 창 그리기 ────────────────────────────────────────────────────────
function renderSheet(props = {}) {
  const jsx = (type, p) => ({ type, props: p ?? {} });
  const alerts = [];
  const calls = [];
  const component = compile("../components/chat/ChatViewClearSheet.tsx", {
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": {
      ActivityIndicator: "ActivityIndicator", Modal: "Modal", Pressable: "Pressable", ScrollView: "ScrollView", View: "View",
      Alert: { alert: (...args) => alerts.push(args) },
      StyleSheet: { create: (value) => value, absoluteFill: { position: "absolute" } },
    },
    "@/components/ui/AppText": { Text: "Text" },
    "@hanbang/design-tokens": { colors },
    "@/lib/chatViewClear": lib,
  }, { jsx: true });
  const tree = component.ChatViewClearSheet({
    step: "shared_choose",
    hasLinkedPartner: true,
    pendingRequestExists: false,
    clearingMode: null,
    requestSending: false,
    error: null,
    onChoose: (mode) => calls.push(["choose", mode]),
    onChooseBoth: () => calls.push(["both"]),
    onBack: () => calls.push(["back"]),
    onSubmitRequest: () => calls.push(["submit"]),
    onConfirmDeletePrivate: () => calls.push(["delete_private"]),
    onClose: () => calls.push(["close"]),
    ...props,
  });
  const pressables = [];
  const texts = [];
  const nodes = [];
  (function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node === "string") return void texts.push(node);
    if (!node || typeof node !== "object") return;
    if (typeof node.type === "function") return walk(node.type(node.props));
    nodes.push(node);
    if (node.type === "Pressable") pressables.push(node);
    walk(node.props.children);
  })(tree);
  const byLabel = (label) => pressables.find((node) => node.props.accessibilityLabel === label);
  const style = (node, pressed = false) => Object.assign({}, ...[typeof node.props.style === "function" ? node.props.style({ pressed }) : node.props.style].flat(3).filter(Boolean));
  return { tree, calls, alerts, text: texts.join(" "), texts, byLabel, pressables, nodes, style };
}

test("창이 닫혀 있으면 그리지 않고, 함께 대화 창은 웹과 같은 제목·소개·두 선택지를 보인다", () => {
  assert.equal(renderSheet({ step: "closed" }).tree.props.visible, false);
  const sheet = renderSheet();
  assert.equal(sheet.tree.type, "Modal");
  assert.equal(sheet.tree.props.visible, true);
  for (const text of [COPY.shared.title, COPY.shared.intro, COPY.shared.introNote, COPY.shared.ownTitle, COPY.shared.ownDescription, COPY.shared.bothTitle]) {
    assert.ok(sheet.text.includes(text), `창에 없다: ${text}`);
  }
  // 「둘 다」 설명의 가운데 한 마디는 웹처럼 굵게 그린다.
  const strong = sheet.nodes.find((node) => node.type === "Text" && node.props.children === COPY.shared.bothDescription.strong);
  assert.ok(strong, "굵게 쓰는 한 마디가 없다");
  assert.equal(Object.assign({}, ...[strong.props.style].flat()).fontWeight, "700");
  sheet.byLabel(COPY.shared.ownTitle).props.onPress();
  sheet.byLabel(COPY.shared.bothTitle).props.onPress();
  assert.deepEqual(sheet.calls, [["choose", "view_reset_shared"], ["both"]]);
});

test("혼자인 사람에게는 「둘의 화면 함께 정리」가 없다", () => {
  const solo = renderSheet({ hasLinkedPartner: false });
  assert.equal(solo.byLabel(COPY.shared.bothTitle), undefined);
  assert.ok(!solo.text.includes(COPY.shared.bothTitle));
  assert.ok(solo.byLabel(COPY.shared.ownTitle), "내 화면만 정리는 그대로 있다");
});

test("대기 중인 요청 카드가 있으면 「둘 다」를 이유와 함께 막는다", () => {
  const sheet = renderSheet({ pendingRequestExists: true });
  const both = sheet.byLabel(COPY.shared.bothTitle);
  assert.equal(both.props.disabled, true);
  assert.equal(both.props.accessibilityState.disabled, true);
  assert.ok(sheet.text.includes(COPY.shared.bothPendingReason));
  assert.equal(sheet.byLabel(COPY.shared.ownTitle).props.disabled, false, "내 화면만 정리는 막지 않는다");
  // 확인 단계에 있는데 대기 카드가 생겨도 보내기를 막는다.
  const confirm = renderSheet({ step: "shared_confirm_both", pendingRequestExists: true });
  assert.equal(confirm.byLabel(COPY.sharedBoth.submit).props.disabled, true);
  assert.ok(confirm.text.includes(COPY.shared.bothPendingReason));
});

test("동의 요청 단계 — 보내는 중에는 「동의 요청 보내는 중…」이고 다시 누를 수 없다", () => {
  const ready = renderSheet({ step: "shared_confirm_both" });
  for (const text of [COPY.sharedBoth.title, COPY.sharedBoth.body, COPY.sharedBoth.note, COPY.sharedBoth.submit, COPY.sharedBoth.back]) {
    assert.ok(ready.text.includes(text), text);
  }
  ready.byLabel(COPY.sharedBoth.submit).props.onPress();
  ready.byLabel(COPY.sharedBoth.back).props.onPress();
  assert.deepEqual(ready.calls, [["submit"], ["back"]]);
  const sending = renderSheet({ step: "shared_confirm_both", requestSending: true, error: null });
  const submit = sending.byLabel(COPY.sharedBoth.submitting);
  assert.ok(submit, "보내는 중 표시가 없다");
  assert.equal(submit.props.disabled, true);
  assert.ok(sending.text.includes(COPY.sharedBoth.submitting));
  assert.ok(!sending.texts.includes(COPY.sharedBoth.submit), "보내기 글자가 남아 있다");
  const failed = renderSheet({ step: "shared_confirm_both", error: lib.SHARED_CHAT_CLEAR_REQUEST_FAILURE.server });
  assert.ok(failed.text.includes(lib.SHARED_CHAT_CLEAR_REQUEST_FAILURE.server));
});

test("비공개 창 — 삭제는 네이티브 확인 창의 「삭제」를 눌러야만 나가고, 취소·창 밖은 아무것도 보내지 않는다", () => {
  const sheet = renderSheet({ step: "private_confirm" });
  for (const text of [COPY.private.title, COPY.private.intro, COPY.private.introNote, COPY.private.ownTitle, COPY.private.ownDescription, COPY.private.deleteTitle, COPY.private.deleteDescription]) {
    assert.ok(sheet.text.includes(text), text);
  }
  sheet.byLabel(COPY.private.ownTitle).props.onPress();
  assert.deepEqual(sheet.calls, [["choose", "view_reset_private"]]);
  sheet.byLabel(COPY.private.deleteTitle).props.onPress();
  assert.deepEqual(sheet.calls, [["choose", "view_reset_private"]], "확인 창만 열고 아직 보내지 않는다");
  assert.equal(sheet.alerts.length, 1);
  const [title, message, buttons, options] = sheet.alerts[0];
  assert.equal(title, COPY.deleteConfirm.title);
  assert.equal(message, COPY.deleteConfirm.message);
  assert.deepEqual(options, { cancelable: true });
  assert.deepEqual(buttons.map(({ text, style }) => [text, style]), [["취소", "cancel"], ["삭제", "destructive"]]);
  assert.equal(buttons[0].onPress, undefined, "취소는 아무것도 하지 않는다");
  buttons[1].onPress();
  assert.deepEqual(sheet.calls.at(-1), ["delete_private"]);
  assert.equal(sheet.calls.filter(([name]) => name === "delete_private").length, 1);
});

test("정리 중에는 선택지·취소·뒤로 가기·창 밖 누르기가 모두 멈추고 확인 창도 다시 열리지 않는다", () => {
  const sheet = renderSheet({ step: "private_confirm", clearingMode: "delete_private" });
  assert.equal(sheet.byLabel(COPY.private.ownTitle).props.disabled, true);
  assert.equal(sheet.byLabel(COPY.private.deleteTitle).props.disabled, true);
  assert.equal(sheet.byLabel(COPY.private.deleteTitle).props.accessibilityState.busy, true);
  assert.equal(sheet.byLabel(COPY.cancel).props.disabled, true);
  sheet.tree.props.onRequestClose();
  sheet.pressables.find((node) => node.props.accessibilityLabel === undefined).props.onPress();
  sheet.byLabel(COPY.private.deleteTitle).props.onPress();
  assert.deepEqual(sheet.calls, []);
  assert.equal(sheet.alerts.length, 0);
  const idle = renderSheet({ step: "private_confirm" });
  idle.tree.props.onRequestClose();
  assert.deepEqual(idle.calls, [["close"]], "쉴 때 안드로이드 뒤로 가기는 닫기다");
});

test("창의 누르는 자리는 모두 44pt 이상이고 새 hex 색을 박지 않는다", () => {
  for (const props of [{}, { step: "shared_confirm_both" }, { step: "private_confirm" }]) {
    const sheet = renderSheet(props);
    for (const node of sheet.pressables.filter((item) => item.props.accessibilityLabel)) {
      assert.ok(sheet.style(node).minHeight >= 44, `${node.props.accessibilityLabel} 높이`);
      assert.equal(node.props.accessibilityRole, "button");
    }
  }
  assert.doesNotMatch(sheetSource, /#[0-9a-f]{3,8}\b/i);
});

// ── chat.tsx 의 실제 핸들러 ──────────────────────────────────────────
const chatTree = ts.createSourceFile("chat.tsx", chat, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = { functions: new Map(), variables: new Map() };
(function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name && !declarations.functions.has(node.name.text)) declarations.functions.set(node.name.text, node.getText(chatTree));
  if (ts.isVariableStatement(node)) {
    for (const declaration of node.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && !declarations.variables.has(declaration.name.text)) declarations.variables.set(declaration.name.text, node.getText(chatTree));
    }
  }
  ts.forEachChild(node, visit);
})(chatTree);
function loadChat(names, bindings, { variables = [] } = {}) {
  const pieces = [...variables.map((name) => {
    assert.ok(declarations.variables.has(name), `chat.tsx 에 ${name} 가 없다`);
    return declarations.variables.get(name);
  }), ...names.map((name) => {
    assert.ok(declarations.functions.has(name), `chat.tsx 에 ${name} 가 없다`);
    return declarations.functions.get(name);
  })];
  const output = ts.transpileModule(pieces.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function("bindings", `with(bindings){${output};return {${[...variables, ...names].join(",")}};}`)(bindings);
}

const viewer = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const couple = "44444444-4444-4444-8444-444444444444";
const clearedAt = "2026-09-18T01:00:00.123456+00:00";
const drafts = () => ({ shared_ai: "함께 쓰던 질문", private_ai: "나만 쓰던 상담", shared_partner: "상대에게 쓰던 말" });
const row = (id, visibility, createdAt, extra = {}) => ({
  id, couple_id: couple, sender_id: viewer, sender_type: "bride", role: "user", content: "합성 대화", visibility, created_at: createdAt, metadata: null, ...extra,
});

function screenHarness({ scope = "private", step = scope === "private" ? "private_confirm" : "shared_confirm_both", respond, messages = [], shared = {} } = {}) {
  const state = {
    messages: [...messages], step, error: null, notice: null, pending: null, owners: new Set(), calls: [], requests: [],
  };
  let generation = shared.generation ?? 1;
  const generationRef = shared.chatSessionGenerationRef ?? { current: { current: () => generation, isCurrent: (value) => value === generation } };
  const apply = (key, value) => { state[key] = typeof value === "function" ? value(state[key]) : value; };
  const bindings = {
    ...lib,
    ...privacy,
    userId: viewer, coupleId: couple, userRole: "bride", activeScope: scope, target: "ai", hasLinkedPartner: true,
    streaming: false, initialLoaded: true, chatLoadError: null, scopedMessages: state.messages,
    messages: state.messages,
    sendingRef: { current: false }, applyingPendingActionRef: { current: null },
    chatSessionGenerationRef: generationRef,
    isCurrentChatSession: shared.isCurrentChatSession ?? ((value) => value === generation),
    sessionUserIdRef: shared.sessionUserIdRef ?? { current: viewer },
    viewClearStepRef: { current: step }, viewClearDialogVersionRef: { current: 0 },
    viewClearInFlightRef: { current: null }, viewClearRequestSeqRef: { current: 0 },
    chatViewClearCarryRef: shared.chatViewClearCarryRef ?? { current: null },
    clearRequestInFlightRef: { current: new Set() },
    inputByLaneRef: shared.inputByLaneRef ?? { current: drafts() },
    chatViewCursorsRef: { current: { shared: null, private: null } },
    memoryStatusLoadRef: { current: () => state.calls.push("memory") },
    refreshChatSessionRef: shared.refreshChatSessionRef ?? { current: async () => { state.calls.push("refresh"); } },
    reloadChatSessionRef: { current: () => state.calls.push("reload") },
    apiFetchForExpectedUser: async (expected, path, init) => {
      state.requests.push({ expected, path, method: init.method, body: JSON.parse(init.body) });
      return respond(path, init, state);
    },
    setMessages: (value) => apply("messages", value),
    setViewClearStep: (value) => {
      bindings.viewClearDialogVersionRef.current += 1;
      bindings.viewClearStepRef.current = value;
      state.error = null;
      state.step = value;
    },
    setViewClearError: (value) => apply("error", value),
    setViewClearNotice: (value) => apply("notice", value),
    setViewClearPending: (value) => apply("pending", value),
    setPendingClearRequestOwners: (value) => apply("owners", value),
    chatMessageFromRealtimeRow: (value) => value,
    canViewerSeeChatMessage: () => true,
    reconcileMobileAmoraCrisisRecovery: (rows) => rows,
    mergeRealtimeMessage: (rows, incoming) => rows.some((item) => item.id === incoming.id) ? rows : [...rows, incoming],
  };
  const handlers = loadChat(["openViewClearSheet", "closeViewClearSheet", "performViewClear", "submitSharedClearRequest"], bindings);
  return {
    state, bindings, ...handlers,
    switchAccount: () => { generation += 1; bindings.sessionUserIdRef.current = other; },
  };
}
const ok = (body) => new Response(JSON.stringify(body), { status: 200 });
const fail = (status) => new Response(JSON.stringify({ error: "INTERNAL_DETAIL 서버 원문" }), { status });

test("머리 버튼 — 다 불러왔고 이 범위에 메시지가 있을 때만 보이고, 바쁠 때는 누를 수 없다", () => {
  const variables = ["viewClearOwner", "viewClearLockedScope", "composerLockedByViewClear", "canOfferViewClear", "viewClearEntryDisabled"];
  const evaluate = (over = {}) => loadChat([], {
    userId: viewer, coupleId: couple, initialLoaded: true, chatLoadError: null, scopedMessages: [row("a", "shared", clearedAt)],
    streaming: false, applyingPendingActionId: null, viewClearPending: null, activeScope: "shared", ...over,
  }, { variables });
  assert.equal(evaluate().canOfferViewClear, true);
  assert.equal(evaluate().viewClearEntryDisabled, false);
  for (const hidden of [{ initialLoaded: false }, { chatLoadError: "대화를 불러오지 못했어요." }, { coupleId: null }, { userId: null }, { scopedMessages: [] }]) {
    assert.equal(evaluate(hidden).canOfferViewClear, false, JSON.stringify(hidden));
  }
  const owner = `${viewer}:${couple}`;
  for (const busy of [{ streaming: true }, { applyingPendingActionId: "action-1" }, { viewClearPending: { owner, scope: "private", mode: "delete_private" } }]) {
    assert.equal(evaluate(busy).viewClearEntryDisabled, true, JSON.stringify(busy));
  }
  // 정리 중인 범위의 입력창만 잠근다. 다른 계정의 정리는 이 화면을 잠그지 않는다.
  assert.equal(evaluate({ activeScope: "private", viewClearPending: { owner, scope: "private", mode: "delete_private" } }).composerLockedByViewClear, true);
  assert.equal(evaluate({ activeScope: "shared", viewClearPending: { owner, scope: "private", mode: "delete_private" } }).composerLockedByViewClear, false);
  assert.equal(evaluate({ activeScope: "private", viewClearPending: { owner: `${other}:${couple}`, scope: "private", mode: "delete_private" } }).composerLockedByViewClear, false);
  // 버튼 자체: 44pt, 읽어 주는 이름은 웹 버튼과 같다.
  const header = chat.slice(chat.indexOf("<View style={st.headerActions}>"), chat.indexOf("<ChatViewClearSheet"));
  assert.match(header, /\{canOfferViewClear && \(/);
  assert.match(header, /disabled=\{viewClearEntryDisabled\}/);
  assert.match(header, /accessibilityLabel=\{CHAT_VIEW_CLEAR_COPY\.entryLabel\}/);
  assert.match(header, /onPress=\{openViewClearSheet\}/);
  assert.match(chat, /headerIconBtn: \{ width: 44, height: 44,/);
  // 입력창과 보내기 버튼이 그 잠금을 따른다. 2026-09-26 부터 입력창에는 첫 칸 고르기 잠금이 하나 더
  // 붙는다(amoraLaneChoice.test.mjs 가 잰다). 이 검사는 정리 잠금이 그대로 붙어 있는지를 본다.
  assert.match(chat, /editable=\{!streaming && initialLoaded && !chatLoadError && !composerLockedByViewClear && !composerLockedByLaneChoice\}/);
  assert.match(chat, /disabled=\{!input\.trim\(\) \|\| streaming \|\| !initialLoaded \|\| Boolean\(chatLoadError\) \|\| composerLockedByViewClear\}/);
});

test("머리 버튼은 범위에 맞는 첫 단계를 열고, 바쁘면 열지 않는다", () => {
  const shared = screenHarness({ scope: "shared", step: "closed", messages: [row("s", "shared", clearedAt)] });
  shared.bindings.scopedMessages = [row("s", "shared", clearedAt)];
  shared.openViewClearSheet();
  assert.equal(shared.state.step, "shared_choose");
  const privateScreen = screenHarness({ scope: "private", step: "closed" });
  privateScreen.bindings.scopedMessages = [row("p", "bride_private", clearedAt)];
  privateScreen.openViewClearSheet();
  assert.equal(privateScreen.state.step, "private_confirm");
  for (const busy of [{ streaming: true }, { sendingRef: { current: true } }, { applyingPendingActionRef: { current: "a" } }, { viewClearInFlightRef: { current: { owner: "x", scope: "shared" } } }, { scopedMessages: [] }]) {
    const screen = screenHarness({ scope: "shared", step: "closed" });
    Object.assign(screen.bindings, { scopedMessages: [row("s", "shared", clearedAt)] }, busy);
    screen.openViewClearSheet();
    assert.equal(screen.state.step, "closed", JSON.stringify(Object.keys(busy)));
  }
});

test("내 화면만 정리 — 누른 사람에 결박된 요청 한 번, 서버가 확인한 뒤에만 그 범위를 비우고 창을 닫는다", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const screen = screenHarness({
    scope: "private",
    messages: [row("old-private", "bride_private", "2026-09-18T00:00:00.000Z"), row("shared", "shared", "2026-09-18T00:00:00.000Z")],
    respond: async () => { await gate; return ok({ success: true, mode: "view_reset_private", clearedAt }); },
  });
  const first = screen.performViewClear("view_reset_private");
  // 두 번 눌러도, 닫기를 눌러도 요청은 하나다. 가는 동안에는 창이 닫히지 않는다.
  const second = screen.performViewClear("view_reset_private");
  screen.closeViewClearSheet();
  assert.equal(screen.state.step, "private_confirm");
  assert.deepEqual(screen.state.pending, { owner: `${viewer}:${couple}`, scope: "private", mode: "view_reset_private" });
  assert.equal(screen.state.messages.length, 2, "서버가 확인하기 전에는 지우지 않는다");
  release();
  await Promise.all([first, second]);
  assert.equal(screen.state.requests.length, 1);
  assert.deepEqual(screen.state.requests[0], { expected: viewer, path: "/api/chat/messages", method: "DELETE", body: { coupleId: couple, mode: "view_reset_private" } });
  assert.deepEqual(screen.state.messages.map((item) => item.id), ["shared"], "그 범위만 비운다");
  assert.equal(screen.state.step, "closed");
  assert.deepEqual(screen.state.calls, ["memory", "refresh"], "기억 줄을 새로 읽고 범위 재확인으로 다시 불러온다");
  assert.equal(screen.state.pending, null);
  assert.equal(screen.bindings.viewClearInFlightRef.current, null);
  assert.equal(screen.bindings.chatViewClearCarryRef.current.outcome, "confirmed");
  assert.equal(screen.bindings.chatViewClearCarryRef.current.scope, "private");
});

test("정리하는 동안 그 범위의 입력창은 보내지 않는다 — 다른 범위는 보낸다", async () => {
  const run = (scope, clearing) => {
    let proceeded = false;
    const bindings = {
      input: "보낼 말", streaming: false, sendingRef: { current: false }, initialLoaded: true, chatLoadError: null,
      coupleId: couple, userId: viewer, userRole: "bride", activeScope: scope, activeLane: scope === "private" ? "private_ai" : "shared_ai",
      chatVisibilityForScope: privacy.chatVisibilityForScope,
      viewClearInFlightRef: { current: clearing },
      // 대화 칸은 정해져 있다(2026-09-26 첫 칸 고르기의 잠금은 amoraLaneChoice.test.mjs 가 잰다).
      laneOpeningRef: { current: "decided" },
      setFollowUpSuggestions: () => { proceeded = true; throw new Error("PROCEEDED"); },
    };
    const { handleSend } = loadChat(["handleSend"], bindings);
    return handleSend().then(() => proceeded, (error) => { assert.equal(error.message, "PROCEEDED"); return proceeded; });
  };
  const owner = `${viewer}:${couple}`;
  assert.equal(await run("private", { owner, scope: "private" }), false, "정리 중인 범위에서는 보내지 않는다");
  assert.equal(await run("shared", { owner, scope: "private" }), true, "다른 범위는 막지 않는다");
  assert.equal(await run("private", { owner: `${other}:${couple}`, scope: "private" }), true, "다른 계정의 정리는 이 사람을 막지 않는다");
  assert.equal(await run("private", null), true);
});

test("정리 실패는 창을 연 채 앱 문구로 알리고 서버 원문을 그리지 않는다", async () => {
  for (const [status, copy] of [[403, lib.CHAT_VIEW_CLEAR_FAILURE.forbidden], [429, lib.CHAT_VIEW_CLEAR_FAILURE.rateLimited], [503, lib.CHAT_VIEW_CLEAR_FAILURE.server]]) {
    const screen = screenHarness({ scope: "shared", step: "shared_choose", messages: [row("s", "shared", "2026-09-18T00:00:00.000Z")], respond: async () => fail(status) });
    await screen.performViewClear("view_reset_shared");
    assert.equal(screen.state.error, copy, String(status));
    assert.equal(screen.state.step, "shared_choose", "창을 열어 둔다");
    assert.equal(screen.state.messages.length, 1);
    assert.deepEqual(screen.state.calls, []);
    assert.equal(screen.bindings.chatViewClearCarryRef.current?.outcome ?? null, status >= 500 ? "unknown" : null);
  }
  const mismatch = screenHarness({ scope: "shared", step: "shared_choose", respond: async () => ok({ success: true, mode: "view_reset_private", clearedAt }) });
  await mismatch.performViewClear("view_reset_shared");
  assert.equal(mismatch.state.error, lib.CHAT_VIEW_CLEAR_FAILURE.unconfirmed);
  assert.equal(mismatch.state.step, "shared_choose");
});

test("비공개 삭제 결과를 모르면 세션을 다시 불러오고 확인하지 못했다고만 말한다", async () => {
  for (const respond of [async () => { throw new Error("Network request failed"); }, async () => fail(503), async () => ok({ success: true })]) {
    const screen = screenHarness({ scope: "private", messages: [row("p", "bride_private", "2026-09-18T00:00:00.000Z")], respond });
    await screen.performViewClear("delete_private");
    assert.deepEqual(screen.state.notice, { owner: `${viewer}:${couple}`, text: lib.CHAT_VIEW_CLEAR_FAILURE.deleteUnknown });
    assert.doesNotMatch(screen.state.notice.text, /삭제되지 않았/);
    assert.deepEqual(screen.state.calls, ["reload"]);
    assert.equal(screen.state.messages.length, 1, "지워졌다고도 단정하지 않는다 — 다시 불러온 결과가 말한다");
    assert.equal(screen.bindings.chatViewClearCarryRef.current.outcome, "unknown", "다시 불러와도 나만 상담에 머문다");
  }
  // 거절(4xx)은 모르는 것이 아니다 — 다시 불러오지 않고 창에 이유를 둔다.
  const denied = screenHarness({ scope: "private", respond: async () => fail(403) });
  await denied.performViewClear("delete_private");
  assert.equal(denied.state.notice, null);
  assert.equal(denied.state.error, lib.CHAT_VIEW_CLEAR_FAILURE.forbidden);
  assert.deepEqual(denied.state.calls, []);
});

test("계정이 바뀐 뒤 도착한 응답은 화면을 바꾸지 않는다", async () => {
  for (const respond of [
    async () => ok({ success: true, mode: "delete_private", deleted: 3, clearedAt }),
    async () => fail(500),
    async () => fail(403),
  ]) {
    let screen;
    screen = screenHarness({ scope: "private", messages: [row("p", "bride_private", "2026-09-18T00:00:00.000Z")], respond: async (...args) => { screen.switchAccount(); return respond(...args); } });
    await screen.performViewClear("delete_private");
    assert.equal(screen.state.messages.length, 1);
    assert.equal(screen.state.step, "private_confirm");
    assert.equal(screen.state.error, null);
    assert.equal(screen.state.notice, null);
    assert.deepEqual(screen.state.calls, []);
    assert.equal(screen.bindings.viewClearInFlightRef.current, null, "잠금은 풀린다");
  }
});

test("닫힌 창에 늦게 누른 「삭제」나 다른 범위의 선택은 요청을 보내지 않는다", async () => {
  const closed = screenHarness({ scope: "private", step: "closed", respond: async () => ok({ success: true, mode: "delete_private", clearedAt }) });
  await closed.performViewClear("delete_private");
  const wrongScope = screenHarness({ scope: "shared", step: "private_confirm", respond: async () => ok({ success: true, mode: "delete_private", clearedAt }) });
  await wrongScope.performViewClear("delete_private");
  const busy = screenHarness({ scope: "private", respond: async () => ok({ success: true, mode: "delete_private", clearedAt }) });
  busy.bindings.streaming = true;
  await busy.performViewClear("delete_private");
  for (const screen of [closed, wrongScope, busy]) assert.equal(screen.state.requests.length, 0);
});

test("동의 요청 — 두 번 눌러도, 창을 닫았다 열어도 정확히 한 번 나가고, 대기 카드를 곧바로 붙인다", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const card = row("request-card", "shared", "2026-09-18T02:00:00.000Z", {
    metadata: { clearRequest: { type: "shared", requestedBy: viewer, requestedByRole: "bride", requestedAt: "2026-09-18T02:00:00.000Z", status: "pending" } },
  });
  const screen = screenHarness({ scope: "shared", respond: async () => { await gate; return ok({ success: true, message: card }); } });
  const first = screen.submitSharedClearRequest();
  const second = screen.submitSharedClearRequest();
  assert.ok(screen.state.owners.has(`${viewer}:${couple}`), "보내는 중 표시");
  // 닫았다가 다시 연다 — 잠금은 사람·커플에 묶여 남는다.
  screen.bindings.setViewClearStep("closed");
  screen.bindings.setViewClearStep("shared_confirm_both");
  const third = screen.submitSharedClearRequest();
  release();
  await Promise.all([first, second, third]);
  assert.equal(screen.state.requests.length, 1);
  assert.deepEqual(screen.state.requests[0], { expected: viewer, path: "/api/chat/clear-request", method: "POST", body: { action: "request", coupleId: couple } });
  assert.ok(screen.state.messages.some((item) => item.id === "request-card"), "새로고침 없이 대기 카드가 보인다");
  assert.equal(screen.state.owners.size, 0);
  // 다시 연 창은 사람이 연 것이다 — 성공했다고 그 창을 대신 닫지 않는다(웹과 같다).
  assert.equal(screen.state.step, "shared_confirm_both");

  const direct = screenHarness({ scope: "shared", respond: async () => ok({ success: true, message: card }) });
  await direct.submitSharedClearRequest();
  assert.equal(direct.state.step, "closed", "보낸 창은 성공한 뒤에만 닫힌다");
});

test("동의 요청은 대기 카드가 있거나 혼자이거나 실패면 창을 닫지 않는다", async () => {
  const pendingCard = row("pending", "shared", "2026-09-18T00:00:00.000Z", {
    sender_id: other, sender_type: "groom",
    metadata: { clearRequest: { type: "shared", requestedBy: other, requestedByRole: "groom", requestedAt: "2026-09-18T00:00:00.000Z", status: "pending" } },
  });
  const blocked = screenHarness({ scope: "shared", messages: [pendingCard], respond: async () => ok({}) });
  await blocked.submitSharedClearRequest();
  assert.equal(blocked.state.requests.length, 0);
  assert.equal(blocked.state.error, COPY.shared.bothPendingReason);

  const solo = screenHarness({ scope: "shared", respond: async () => ok({}) });
  solo.bindings.hasLinkedPartner = false;
  await solo.submitSharedClearRequest();
  assert.equal(solo.state.requests.length, 0);

  const failed = screenHarness({ scope: "shared", respond: async () => fail(500) });
  await failed.submitSharedClearRequest();
  assert.equal(failed.state.error, lib.SHARED_CHAT_CLEAR_REQUEST_FAILURE.server);
  assert.equal(failed.state.step, "shared_confirm_both");
  assert.equal(failed.state.owners.size, 0);
});

test("화면 연결 — 리셋은 창만 닫고 이어받기·요청 잠금·결과 모름 안내는 남긴다", () => {
  // 주석(이유를 적은 기록)은 빼고 코드만 본다.
  const reset = chat.slice(chat.indexOf("const resetChatSessionState = useCallback"), chat.indexOf("useEffect(() => {\n    const timer = setInterval"))
    .split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
  assert.match(reset, /setViewClearStep\("closed"\)/);
  for (const kept of ["chatViewClearCarryRef", "clearRequestInFlightRef", "setViewClearNotice", "setPendingClearRequestOwners"]) {
    assert.ok(!reset.includes(kept), `리셋이 ${kept} 를 비운다`);
  }
  const scheduler = declarations.functions.get("scheduleChatSessionReload");
  assert.ok(scheduler && !scheduler.includes("chatViewClearCarryRef"), "scheduleChatSessionReload 가 이어받기를 비운다");
  const sheet = chat.slice(chat.indexOf("<ChatViewClearSheet"), chat.indexOf("/>", chat.indexOf("<ChatViewClearSheet")));
  assert.match(sheet, /onChoose=\{\(mode\) => \{ void performViewClear\(mode\); \}\}/);
  assert.match(sheet, /onConfirmDeletePrivate=\{\(\) => \{ void performViewClear\("delete_private"\); \}\}/);
  assert.match(sheet, /onSubmitRequest=\{\(\) => \{ void submitSharedClearRequest\(\); \}\}/);
  assert.match(sheet, /pendingRequestExists=\{pendingSharedClearRequest\}/);
  assert.match(sheet, /hasLinkedPartner=\{hasLinkedPartner\}/);
  assert.match(sheet, /onClose=\{closeViewClearSheet\}/);
});

// ── 실제 세션 불러오기와 함께: 리셋이 응답보다 먼저 와도 범위·초안이 남는다 ──────────────────
function loaderHarness({ history }) {
  const tree = chatTree;
  let load;
  (function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "loadChatSession") load = node.getText(tree);
    ts.forEachChild(node, visit);
  })(tree);
  assert.ok(load, "화면의 실제 세션 불러오기");
  const empty = () => ({ shared_ai: "", private_ai: "", shared_partner: "" });
  const state = { messages: [], drafts: empty(), scope: "shared", target: "ai", reloads: 0, error: null, initialLoaded: false };
  const profile = { id: viewer, name: "합성", role: "bride", couple_id: couple, shared_chat_cleared_at: null, private_chat_cleared_at: null };
  const rows = [...history];
  const subscriptions = [];
  let generation = 0;
  let reloading = Promise.resolve();
  const query = (table) => {
    const filters = [];
    const record = { columns: "", limit: Infinity, one: false };
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
        let data = table === "profiles" ? [Object.fromEntries(record.columns.split(",").map((key) => key.trim()).map((key) => [key, profile[key]]))]
          : table === "couples" ? [{ bride_id: viewer, groom_id: other }]
          : table === "couple_profile_directory" ? [{ id: other, name: "상대" }]
          : rows.filter((item) => filters.every(([kind, field, value]) => {
            if (kind === "eq") return item[field] === value;
            if (kind === "neq") return item[field] !== value;
            if (kind === "gt") return timestamp.compareChatTimestamps(item[field], value) === 1;
            if (!field.includes("visibility.eq.")) return true;
            const lane = new RegExp(`and\\(visibility\\.eq\\.${item.visibility},created_at\\.gt\\.([^)]*)\\)`).exec(field);
            if (lane) return timestamp.compareChatTimestamps(item.created_at, lane[1]) === 1;
            return field.replace(/and\([^)]*\)/g, "").split(",").includes(`visibility.eq.${item.visibility}`);
          }));
        if (table === "chat_messages") data = data.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, record.limit);
        return Promise.resolve({ data: record.one ? data[0] ?? null : data, error: null }).then(resolve, reject);
      },
    };
    return builder;
  };
  const channel = { on(_kind, filter, handler) { subscriptions.push({ filter, handler, generation }); return channel; }, subscribe() { return channel; } };
  const apply = (key, value) => { state[key] = typeof value === "function" ? value(state[key]) : value; };
  const reset = () => { state.messages = []; state.drafts = empty(); state.scope = "shared"; state.target = "ai"; state.initialLoaded = false; };
  const shared = {
    chatViewClearCarryRef: { current: null },
    refreshChatSessionRef: { current: null },
    sessionUserIdRef: { current: viewer },
    inputByLaneRef: { get current() { return state.drafts; } },
    chatSessionGenerationRef: { current: { begin: () => ++generation, invalidate: () => ++generation, instanceId: () => 1, current: () => generation, isCurrent: (value) => value === generation } },
    isCurrentChatSession: (value) => value === generation,
  };
  const bindings = {
    ...privacy,
    ...shared,
    supabase: { auth: { getUser: async () => ({ data: { user: { id: viewer } } }) }, from: query, channel: () => channel, removeChannel: () => {} },
    chatViewCursorsRef: { current: { shared: null, private: null } },
    activeControllerRef: { current: null }, pendingChatDraftRestoreRef: { current: null },
    createEmptyAmoraChatLaneRecord: (create) => ({ shared_ai: create(), private_ai: create(), shared_partner: create() }),
    resetChatSessionState: reset,
    observedAuthUserId: null,
    scheduleChatSessionReload() { generation += 1; reset(); state.reloads += 1; reloading = run(); },
    hasLinkedPartnerRef: { current: false }, linkedPartnerIdRef: { current: null }, channelRef: { current: null },
    persistedAiRequestKeysRef: { current: new Set() },
    setMessages: (value) => apply("messages", value), setInitialLoaded: (value) => apply("initialLoaded", value), setChatLoadError: (value) => apply("error", value),
    setInputByLane: (value) => apply("drafts", value), setActiveScope: (value) => apply("scope", value), setTarget: (value) => apply("target", value),
    setLaneFailure: () => {}, setColdStartAiRecoveryByLane: () => {}, setSendFailuresByLane: () => {},
    chatMessageFromRealtimeRow: (value) => value,
    canViewerSeeChatMessage: (value) => value.visibility !== "groom_private",
    mergeColdStartRecoveryHistory: (left, right) => [...new Map([...left, ...right].filter(Boolean).map((item) => [item.id, item])).values()],
    reconcileMobileAmoraCrisisRecovery: (value) => value,
    findColdStartAiRecovery: () => null,
    aiLaneForVisibility: (value) => value === "shared" ? "shared_ai" : "private_ai",
    mergeRealtimeMessage: (left, incoming) => [...left, incoming],
    updateAmoraChatLaneRecord: (record, lane, value) => ({ ...record, [lane]: value }),
    takeChatViewClearCarry: lib.takeChatViewClearCarry,
  };
  for (const name of ["setUserId", "setCoupleId", "setUserName", "setUserRole", "setHasLinkedPartner", "setPartnerName", "setStreaming"]) bindings[name] = () => {};
  const compiled = ts.transpileModule(load, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const loadChatSession = new Function("bindings", `with (bindings) { ${compiled}; return loadChatSession; }`)(bindings);
  const run = () => loadChatSession();
  return {
    state, shared, run, profile, rows,
    // 범위 재확인은 몇 번의 비동기 단계 뒤에 다시 불러오기를 건다 — 걸린 것까지 끝날 때를 기다린다.
    settle: async () => { for (let index = 0; index < 10; index += 1) { await new Promise((resolve) => setImmediate(resolve)); await reloading; } },
    /** 서버가 비공개 대화를 지우고 경계를 옮긴다(hard_delete_current_user_private_chat 와 같은 결과). */
    commitPrivateDelete(at) {
      for (let index = rows.length - 1; index >= 0; index -= 1) if (rows[index].visibility === "bride_private") rows.splice(index, 1);
      profile.private_chat_cleared_at = at;
    },
    /** 지금 세대가 구독한 실시간 프로필 UPDATE. */
    fireProfileUpdate() {
      const listener = subscriptions.filter((entry) => entry.filter.table === "profiles").at(-1);
      listener.handler({ new: { ...profile } });
    },
  };
}

function wireScreen(loader, respond) {
  return screenHarness({ scope: "private", step: "private_confirm", respond, shared: loader.shared });
}

test("실시간 UPDATE 와 범위 재확인이 응답보다 먼저 세션을 리셋해도, 비공개 삭제 뒤 나만 상담과 모든 초안이 남는다", async () => {
  const loader = loaderHarness({ history: [row("private-1", "bride_private", "2026-09-18T00:00:00.000Z"), row("shared-1", "shared", "2026-09-18T00:00:01.000Z")] });
  await loader.run();
  loader.state.scope = "private";
  loader.state.drafts = drafts();
  const staleRefresh = loader.shared.refreshChatSessionRef.current;
  const screen = wireScreen(loader, async () => {
    loader.commitPrivateDelete(clearedAt);
    loader.fireProfileUpdate();       // 실시간 UPDATE 가 먼저 와서 세션을 리셋한다
    await staleRefresh();              // 옛 세션의 범위 재확인도 같이 돈다 — 이미 옛 세대라 아무것도 하지 않는다
    await loader.settle();
    return ok({ success: true, mode: "delete_private", deleted: 1, clearedAt });
  });
  await screen.performViewClear("delete_private");
  await loader.settle();
  assert.equal(loader.state.reloads, 1, "다시 불러오기는 한 번이다");
  assert.equal(loader.state.scope, "private", "나만 (상담)에 머문다");
  assert.deepEqual(loader.state.drafts, drafts(), "다른 레인과 이 레인의 초안이 남는다");
  assert.deepEqual(loader.state.messages.map((item) => item.id), ["shared-1"], "지운 비공개 대화는 다시 보이지 않는다");
  assert.equal(loader.shared.chatViewClearCarryRef.current, null, "다 쓴 이어받기는 비운다");
});

test("성공 응답이 먼저 와도 범위 재확인이 다시 불러오고, 늦게 온 실시간 UPDATE 는 두 번째 리셋을 만들지 않는다", async () => {
  const loader = loaderHarness({ history: [row("private-1", "bride_private", "2026-09-18T00:00:00.000Z"), row("shared-1", "shared", "2026-09-18T00:00:01.000Z")] });
  await loader.run();
  loader.state.scope = "private";
  loader.state.drafts = drafts();
  const screen = wireScreen(loader, async () => {
    loader.commitPrivateDelete(clearedAt);
    return ok({ success: true, mode: "delete_private", deleted: 1, clearedAt });
  });
  await screen.performViewClear("delete_private");
  await loader.settle();
  loader.fireProfileUpdate();
  await loader.settle();
  assert.equal(loader.state.reloads, 1);
  assert.equal(loader.state.scope, "private");
  assert.deepEqual(loader.state.drafts, drafts());
  assert.deepEqual(loader.state.messages.map((item) => item.id), ["shared-1"]);
  assert.equal(loader.shared.chatViewClearCarryRef.current, null);
});

test("함께 대화에서 상대에게 쓰던 중 화면을 정리해도 그 대상과 초안으로 돌아온다", async () => {
  const loader = loaderHarness({ history: [row("shared-old", "shared", "2026-09-18T00:00:00.000Z")] });
  await loader.run();
  loader.state.scope = "shared";
  loader.state.target = "partner";
  loader.state.drafts = drafts();
  const screen = screenHarness({
    scope: "shared", step: "shared_choose", shared: loader.shared,
    respond: async () => { loader.profile.shared_chat_cleared_at = clearedAt; return ok({ success: true, mode: "view_reset_shared", clearedAt }); },
  });
  screen.bindings.target = "partner";
  await screen.performViewClear("view_reset_shared");
  await loader.settle();
  assert.equal(loader.state.reloads, 1);
  assert.equal(loader.state.scope, "shared");
  assert.equal(loader.state.target, "partner");
  assert.deepEqual(loader.state.drafts, drafts());
  assert.deepEqual(loader.state.messages, [], "경계 이전의 함께 대화는 다시 보이지 않는다");
});
