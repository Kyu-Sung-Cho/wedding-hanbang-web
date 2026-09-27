import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

/* global setImmediate */

/**
 * 앱 아모라를 처음 열 때 '함께 대화'와 '나만 (상담)' 중 하나를 고르게 한다(2026-09-26 파운더 결정).
 *
 * 그전에는 `chat.tsx` 가 `useState("shared")` 로 시작해 누구에게나 함께 대화로 열렸다. 지금은:
 * - 역할이 있는 사람이 이 기기에 이 계정의 기억이 없으면 선택 카드를 띄우고, 고르기 전에는 보내지 않는다.
 * - 기억된 칸이 있으면 그 칸으로 연다. 역할이 없으면 지금처럼 함께 대화다.
 * - 칸을 명시해서 여는 경로(준비 안내·개인 할 일 이어가기·확인한 변경·화면 정리 되돌리기)는 기억을 이긴다.
 * - 사람이 직접 고른 칸(선택 카드, 위쪽 탭)만 기억한다. 저장소를 읽지 못하면 카드를 다시 띄운다.
 * - 아모라의 첫마디는 '나만 (상담)'을 고른 사람에게도 보인다.
 *
 * 어느 칸으로 열지의 규칙 자체는 `packages/shared/src/contracts/__tests__/amoraLaneChoice.test.mjs` 가 잰다.
 * 이 파일은 그 규칙이 **앱 화면에 실제로 배선됐는지**를 잰다. 카드 컴포넌트를 그려 보고, 저장소 도우미를
 * 가짜 저장소로 돌리고, `chat.tsx` 의 실제 효과·핸들러·계산을 꺼내 돌린다.
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

const laneChoice = compile("../../../../packages/shared/src/contracts/amoraLaneChoice.ts");
const chatLane = compile("../../../../packages/shared/src/utils/chatLane.ts");
const timestamp = compile("../../../../packages/shared/src/utils/chatTimestamp.ts");
const privacy = compile("../lib/chatPrivacyScope.ts", { "@hanbang/shared": timestamp });
const memory = compile("../lib/amoraLaneMemory.ts", { "@hanbang/shared/amora-lane-choice": laneChoice });
const preparationSource = compile("../lib/amoraPreparationSource.ts");
const chatEntry = compile("../lib/amoraChatEntry.ts");
const firstHello = compile("../../../../packages/shared/src/contracts/amoraFirstHello.ts", {
  "../constants/preparationStage": compile("../../../../packages/shared/src/constants/preparationStage.ts"),
});
const { colors } = compile("../../../../packages/design-tokens/src/colors.ts");
const COPY = laneChoice.AMORA_LANE_CHOICE_COPY;

const chat = read("../../app/(tabs)/chat.tsx");
const cardSource = read("../components/chat/AmoraLaneChoiceCard.tsx");
const memorySource = read("../lib/amoraLaneMemory.ts");
/** 주석을 걷어낸 코드. 왜 바꿨는지 적은 주석이 개수 검사에 걸리지 않게 한다. */
const chatCode = ts.transpileModule(chat, {
  fileName: "chat.tsx",
  compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2022, removeComments: true },
}).outputText;

const viewer = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const flush = async () => { for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setImmediate(resolve)); };

/** AsyncStorage 대역. 값은 메모리에만 있다. */
function fakeStorage(initial = {}, { failRead = false, failWrite = false, pendingRead = false } = {}) {
  const values = new Map(Object.entries(initial));
  const reads = [];
  const writes = [];
  let release = null;
  return {
    values, reads, writes,
    releaseRead: (value) => release?.(value),
    async getItem(key) {
      reads.push(key);
      if (failRead) throw new Error("storage unavailable");
      if (pendingRead) return new Promise((resolve) => { release = resolve; });
      return values.has(key) ? values.get(key) : null;
    },
    async setItem(key, value) {
      writes.push([key, value]);
      if (failWrite) throw new Error("storage full");
      values.set(key, value);
    },
  };
}
const keyOf = (userId) => `${laneChoice.AMORA_LANE_STORAGE_KEY_PREFIX}${userId}`;

// ── 저장소 도우미 ────────────────────────────────────────────────────
test("기억은 계정마다 따로 읽고 쓴다 — 같은 기기의 다른 사람은 앞사람의 칸으로 열리지 않는다", async () => {
  const storage = fakeStorage();
  assert.equal(await memory.rememberAmoraLane(storage, viewer, "private"), true);
  assert.deepEqual(storage.writes, [[keyOf(viewer), "private"]]);
  assert.equal(await memory.readRememberedAmoraLane(storage, viewer), "private");
  assert.equal(await memory.readRememberedAmoraLane(storage, other), null, "다른 계정은 기억이 없다");
  assert.deepEqual(storage.reads, [keyOf(viewer), keyOf(other)]);
  assert.equal(await memory.rememberAmoraLane(storage, viewer, "shared"), true);
  assert.equal(await memory.readRememberedAmoraLane(storage, viewer), "shared", "마지막으로 고른 칸을 기억한다");
});

test("읽지 못하면 null 이다 — 저장소 오류, 모르는 값, 시간 초과, 빈 사용자", async () => {
  assert.equal(await memory.readRememberedAmoraLane(fakeStorage({}, { failRead: true }), viewer), null);
  const throwsNow = { getItem() { throw new Error("sync failure"); }, async setItem() {} };
  assert.equal(await memory.readRememberedAmoraLane(throwsNow, viewer), null, "동기로 던져도 삼킨다");
  for (const stored of ["PRIVATE", " private", "shared ", "both", "", "null"]) {
    assert.equal(await memory.readRememberedAmoraLane(fakeStorage({ [keyOf(viewer)]: stored }), viewer), null, JSON.stringify(stored));
  }
  const hanging = fakeStorage({}, { pendingRead: true });
  assert.equal(await memory.readRememberedAmoraLane(hanging, viewer, 5), null, "대답하지 않는 저장소는 읽지 못한 것으로 본다");
  const untouched = fakeStorage();
  for (const userId of [null, undefined, "", "   "]) {
    assert.equal(await memory.readRememberedAmoraLane(untouched, userId), null);
    assert.equal(await memory.rememberAmoraLane(untouched, userId, "private"), false);
  }
  assert.deepEqual(untouched.reads, [], "빈 사용자로는 저장소를 건드리지 않는다");
  assert.deepEqual(untouched.writes, []);
});

test("쓰지 못하면 false 이고 던지지 않는다 — 모르는 칸 이름은 쓰지 않는다", async () => {
  const failing = fakeStorage({}, { failWrite: true });
  assert.equal(await memory.rememberAmoraLane(failing, viewer, "private"), false);
  const storage = fakeStorage();
  assert.equal(await memory.rememberAmoraLane(storage, viewer, "partner"), false);
  assert.deepEqual(storage.writes, []);
});

// ── 선택 카드 ─────────────────────────────────────────────────────────
function renderCard(props = {}) {
  const jsx = (type, p) => ({ type, props: p ?? {} });
  const calls = [];
  const component = compile("../components/chat/AmoraLaneChoiceCard.tsx", {
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": { Pressable: "Pressable", View: "View", StyleSheet: { create: (value) => value } },
    "lucide-react-native": { Lock: "Lock" },
    "@hanbang/design-tokens": { amoraIdentity: { ink: "#36534E" }, colors },
    "@/components/ui/AppText": { Text: "Text" },
    "@/components/ui/AmoraMark": { __esModule: true, default: "AmoraMark" },
    "@hanbang/shared/amora-lane-choice": laneChoice,
  }, { jsx: true });
  const tree = component.AmoraLaneChoiceCard({
    hasLinkedPartner: true, disabled: false, onChoose: (lane) => calls.push(lane), ...props,
  });
  const texts = [];
  const pressables = [];
  (function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node === "string") return void texts.push(node);
    if (!node || typeof node !== "object") return;
    if (node.type === "Pressable") pressables.push(node);
    walk(node.props.children);
  })(tree);
  const byLabel = (label) => pressables.find((node) => node.props.accessibilityLabel === label);
  return { tree, calls, texts, text: texts.join("\n"), pressables, byLabel };
}

test("카드는 정본 문구를 그대로 그리고, 두 버튼 이름은 위쪽 탭 이름과 같다", () => {
  const card = renderCard();
  for (const text of [COPY.title, COPY.shared.label, COPY.shared.description, COPY.private.label, COPY.private.description, COPY.footnote]) {
    assert.ok(card.texts.includes(text), `카드에 없다: ${text}`);
  }
  assert.equal(card.pressables.length, 2, "버튼은 두 개다");
  // 탭 글자와 바이트까지 같아야 카드와 탭이 같은 칸을 가리킨다.
  assert.ok(chat.includes(`>${COPY.shared.label}</Text>`), "함께 대화 탭 이름이 카드와 다르다");
  assert.ok(chat.includes(`>${COPY.private.label}</Text>`), "나만 (상담) 탭 이름이 카드와 다르다");
  assert.equal(COPY.shared.label, "함께 대화");
  assert.equal(COPY.private.label, "나만 (상담)");
});

test("누른 버튼의 칸을 그대로 넘긴다", () => {
  const card = renderCard();
  card.byLabel(COPY.shared.label).props.onPress();
  card.byLabel(COPY.private.label).props.onPress();
  assert.deepEqual(card.calls, ["shared", "private"]);
  assert.equal(card.byLabel(COPY.shared.label).props.accessibilityRole, "button");
  assert.equal(card.byLabel(COPY.private.label).props.accessibilityHint, COPY.private.description);
});

test("파트너가 아직 없을 때만 '연결하면' 덧붙임을 붙인다 — 화면에도, 읽어 주는 힌트에도", () => {
  const linked = renderCard({ hasLinkedPartner: true });
  assert.ok(!linked.texts.includes(COPY.shared.unlinkedPartnerNote), "연결된 사람에게는 틀린 말이다");
  assert.equal(linked.byLabel(COPY.shared.label).props.accessibilityHint, COPY.shared.description);
  const solo = renderCard({ hasLinkedPartner: false });
  assert.ok(solo.texts.includes(COPY.shared.unlinkedPartnerNote));
  assert.equal(solo.byLabel(COPY.shared.label).props.accessibilityHint, `${COPY.shared.description} ${COPY.shared.unlinkedPartnerNote}`);
});

test("막혀 있으면 두 버튼 모두 누를 수 없다고 알린다", () => {
  const card = renderCard({ disabled: true });
  for (const button of card.pressables) {
    assert.equal(button.props.disabled, true);
    assert.equal(button.props.accessibilityState.disabled, true);
  }
});

test("새 파일은 분석 이벤트를 보내지 않는다 — 가져오는 것이 정해진 목록 안에 있다", () => {
  const imports = (source) => [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(imports(memorySource), ["@hanbang/shared/amora-lane-choice"]);
  assert.deepEqual(imports(cardSource).sort(), [
    "@/components/ui/AmoraMark", "@/components/ui/AppText", "@hanbang/design-tokens",
    "@hanbang/shared/amora-lane-choice", "lucide-react-native", "react-native",
  ]);
});

// ── chat.tsx 의 실제 코드 ─────────────────────────────────────────────
const chatTree = ts.createSourceFile("chat.tsx", chat, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const found = { functions: new Map(), variables: new Map(), laneEffects: [] };
(function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name) {
    const list = found.functions.get(node.name.text) ?? [];
    found.functions.set(node.name.text, [...list, node.getText(chatTree)]);
  }
  if (ts.isVariableStatement(node)) {
    for (const declaration of node.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      const list = found.variables.get(declaration.name.text) ?? [];
      found.variables.set(declaration.name.text, [...list, node.getText(chatTree)]);
    }
  }
  if (ts.isCallExpression(node) && node.expression.getText(chatTree) === "useEffect"
    && node.arguments[0]?.getText(chatTree).includes("resolveInitialAmoraLane(")) {
    found.laneEffects.push(node.arguments[0].getText(chatTree));
  }
  ts.forEachChild(node, visit);
})(chatTree);
function one(kind, name) {
  const list = found[kind].get(name) ?? [];
  assert.equal(list.length, 1, `chat.tsx 에 ${name} 가 ${list.length}개다`);
  return list[0];
}
function evaluate(pieces, names, bindings) {
  const output = ts.transpileModule(pieces.join("\n"), {
    fileName: "piece.tsx",
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  return new Function("bindings", `with(bindings){${output};return {${names.join(",")}};}`)(bindings);
}

/** 대화 칸을 여는 화면 한 벌: 실제 setLaneOpening·setActiveScope 와 실제 여는 효과. */
function laneScreen({ laneOpening = "waiting", initialLoaded = true, chatLoadError = null, userRole = "bride", userId = viewer, storage = fakeStorage(), laneEntryScope = null } = {}) {
  assert.equal(found.laneEffects.length, 1, "chat.tsx 에 처음 여는 칸을 정하는 효과가 하나 있어야 한다");
  const state = { opening: laneOpening, scope: "shared", scopeWrites: [], openingWrites: [] };
  let generation = 1;
  const bindings = {
    useCallback: (fn) => fn,
    laneOpening, initialLoaded, chatLoadError, userRole, userId, laneEntryScope,
    laneOpeningRef: { current: laneOpening },
    setLaneOpeningState: (value) => { state.opening = value; state.openingWrites.push(value); },
    setActiveScopeState: (value) => { state.scope = value; state.scopeWrites.push(value); },
    resolveInitialAmoraLane: laneChoice.resolveInitialAmoraLane,
    readRememberedAmoraLane: memory.readRememberedAmoraLane,
    AsyncStorage: storage,
    chatSessionGenerationRef: { current: { current: () => generation } },
    isCurrentChatSession: (value) => value === generation,
  };
  const api = evaluate(
    [one("variables", "setLaneOpening"), one("variables", "setActiveScope"), `const run = ${found.laneEffects[0]};`],
    ["setLaneOpening", "setActiveScope", "run"],
    bindings,
  );
  return { state, bindings, storage, ...api, nextGeneration: () => { generation += 1; } };
}

test("처음 여는 사람(역할 있음, 기억 없음)에게는 카드를 띄우고 칸을 정하지 않는다", async () => {
  const screen = laneScreen();
  screen.run();
  await flush();
  assert.equal(screen.state.opening, "choosing");
  assert.equal(screen.bindings.laneOpeningRef.current, "choosing");
  assert.deepEqual(screen.state.scopeWrites, [], "옛 기본값처럼 함께 대화로 열지 않는다");
  assert.deepEqual(screen.storage.reads, [keyOf(viewer)], "이 계정의 기억을 읽는다");
});

test("기억된 칸이 있으면 그 칸으로 바로 연다 — 카드 없이", async () => {
  for (const lane of ["private", "shared"]) {
    const screen = laneScreen({ storage: fakeStorage({ [keyOf(viewer)]: lane }) });
    screen.run();
    await flush();
    assert.equal(screen.state.opening, "decided", lane);
    assert.equal(screen.state.scope, lane);
    assert.ok(!screen.state.openingWrites.includes("choosing"), `${lane}: 카드를 띄웠다`);
  }
});

test("기억을 읽지 못했거나 모르는 값이면 카드를 다시 띄운다 — 안전한 쪽", async () => {
  for (const storage of [fakeStorage({}, { failRead: true }), fakeStorage({ [keyOf(viewer)]: "PRIVATE" }), fakeStorage({ [keyOf(other)]: "private" })]) {
    const screen = laneScreen({ storage });
    screen.run();
    await flush();
    assert.equal(screen.state.opening, "choosing");
    assert.deepEqual(screen.state.scopeWrites, []);
  }
});

test("역할이 없으면 지금처럼 함께 대화로 열고, 기억을 읽지 않는다", async () => {
  const screen = laneScreen({ userRole: null, userId: null });
  screen.run();
  await flush();
  assert.equal(screen.state.opening, "decided");
  assert.deepEqual(screen.state.scopeWrites, ["shared"]);
  assert.deepEqual(screen.storage.reads, []);
  // 로그인은 했지만 커플·역할이 아직 없는 사람도 같다.
  const noRole = laneScreen({ userRole: null, storage: fakeStorage({ [keyOf(viewer)]: "private" }) });
  noRole.run();
  await flush();
  assert.deepEqual(noRole.state.scopeWrites, ["shared"], "쓸 수 없는 나만 (상담)으로 열지 않는다");
});

test("다 불러오기 전·불러오지 못했을 때·이미 정했을 때는 아무것도 하지 않는다", async () => {
  for (const over of [{ initialLoaded: false }, { chatLoadError: "대화를 불러오지 못했어요." }, { laneOpening: "decided" }, { laneOpening: "choosing" }]) {
    const screen = laneScreen(over);
    screen.run();
    await flush();
    assert.deepEqual(screen.state.scopeWrites, [], JSON.stringify(over));
    assert.deepEqual(screen.state.openingWrites, [], JSON.stringify(over));
    assert.deepEqual(screen.storage.reads, [], JSON.stringify(over));
  }
});

test("기억을 읽는 사이 칸을 명시한 경로가 먼저 정하면 그것이 이긴다", async () => {
  const storage = fakeStorage({}, { pendingRead: true });
  const screen = laneScreen({ storage });
  screen.run();
  await flush();
  // 준비 안내 질문·확인한 변경·화면 정리 되돌리기가 모두 setActiveScope 를 부른다.
  screen.setActiveScope("shared");
  assert.equal(screen.state.opening, "decided");
  storage.releaseRead("private");
  await flush();
  assert.equal(screen.state.scope, "shared", "늦게 온 기억이 명시한 칸을 덮었다");
  assert.deepEqual(screen.state.scopeWrites, ["shared"]);
  // 카드가 떠 있을 때 명시 경로가 오면 카드를 닫고 그 칸으로 간다(예: 개인 할 일 이어가기 → 나만).
  const choosing = laneScreen();
  choosing.run();
  await flush();
  assert.equal(choosing.state.opening, "choosing");
  choosing.setActiveScope("private");
  assert.equal(choosing.state.opening, "decided");
  assert.equal(choosing.state.scope, "private");
});

/**
 * 칸을 정해서 들어온 길(2026-09-27 검토). 웹과 같은 규칙 한 벌(`resolveAmoraLaneEntryScope`)을 쓴다.
 * 준비 안내 질문과 파트너 합류 직후 계획 점검만 '함께'로 정하고, 라운지 버튼 같은 진입구는 정하지 않는다.
 * 실제 `laneEntryScope` 계산을 chat.tsx 에서 꺼내 돌린다.
 */
function laneEntryScopeFor({ entryParam = undefined, preparationParam = undefined } = {}) {
  return evaluate([one("variables", "laneEntryScope")], ["laneEntryScope"], {
    entryParam, preparationParam,
    resolveAmoraLaneEntryScope: laneChoice.resolveAmoraLaneEntryScope,
    readPreparationSource: preparationSource.readPreparationSource,
    resolveAmoraChatEntry: chatEntry.resolveAmoraChatEntry,
  }).laneEntryScope;
}

test("진입구가 칸을 정하는지는 웹과 같은 규칙이다 — 합류 직후 계획 점검과 준비 안내만 '함께'", () => {
  assert.equal(laneEntryScopeFor(), null, "그냥 탭으로 들어왔다");
  for (const entryParam of ["lounge_fab", "lounge_first_arrival", "lounge_focus_calm", "모르는 키"]) {
    assert.equal(laneEntryScopeFor({ entryParam }), null, `${entryParam} 가 칸을 정했다`);
  }
  assert.equal(laneEntryScopeFor({ entryParam: "joined_plan_review" }), "shared");
  assert.equal(laneEntryScopeFor({ preparationParam: "c.venue" }), "shared");
  // 진입구 키와 섞인 준비 안내는 준비 안내 효과도 읽지 않는다. 칸도 정하지 않는다.
  assert.equal(laneEntryScopeFor({ preparationParam: "c.venue", entryParam: "lounge_fab" }), null);
  assert.equal(laneEntryScopeFor({ preparationParam: "not a source" }), null);
});

test("칸을 정한 진입은 기억보다 이기고, 정하지 않은 진입은 기억이나 카드를 따른다", async () => {
  const joined = laneScreen({ storage: fakeStorage({ [keyOf(viewer)]: "private" }), laneEntryScope: laneEntryScopeFor({ entryParam: "joined_plan_review" }) });
  joined.run();
  await flush();
  assert.equal(joined.state.opening, "decided");
  assert.deepEqual(joined.state.scopeWrites, ["shared"]);
  const fab = laneScreen({ storage: fakeStorage({ [keyOf(viewer)]: "private" }), laneEntryScope: laneEntryScopeFor({ entryParam: "lounge_fab" }) });
  fab.run();
  await flush();
  assert.deepEqual(fab.state.scopeWrites, ["private"], "라운지 버튼이 '나만' 기억을 덮었다");
  const firstFab = laneScreen({ laneEntryScope: laneEntryScopeFor({ entryParam: "lounge_fab" }) });
  firstFab.run();
  await flush();
  assert.equal(firstFab.state.opening, "choosing", "처음 온 사람이 라운지 버튼으로 들어와 카드를 못 봤다");
});

test("세션이 바뀌었거나 효과가 정리됐으면 늦게 온 기억을 버린다", async () => {
  const stale = laneScreen({ storage: fakeStorage({ [keyOf(viewer)]: "private" }, { pendingRead: true }) });
  stale.run();
  await flush();
  stale.nextGeneration();
  stale.storage.releaseRead("private");
  await flush();
  assert.deepEqual(stale.state.scopeWrites, []);
  assert.deepEqual(stale.state.openingWrites, []);
  const cleaned = laneScreen({ storage: fakeStorage({}, { pendingRead: true }) });
  const cleanup = cleaned.run();
  await flush();
  cleanup();
  cleaned.storage.releaseRead(null);
  await flush();
  assert.deepEqual(cleaned.state.openingWrites, []);
});

/** 실제 handleScopeChange(위쪽 탭과 선택 카드가 함께 쓰는 처리). */
function scopeChanger({ userRole = "bride", userId = viewer, streaming = false, storage = fakeStorage() } = {}) {
  const state = { opening: "choosing", scope: "shared", target: "ai" };
  const bindings = {
    useCallback: (fn) => fn,
    streaming, userRole, userId,
    sendingRef: { current: false },
    activeScope: "shared", target: "ai",
    laneOpeningRef: { current: "choosing" },
    setLaneOpeningState: (value) => { state.opening = value; },
    setActiveScopeState: (value) => { state.scope = value; },
    setTarget: (value) => { state.target = value; },
    selectChatScope: privacy.selectChatScope,
    rememberAmoraLane: memory.rememberAmoraLane,
    AsyncStorage: storage,
  };
  const api = evaluate(
    [one("variables", "setActiveScope"), one("functions", "handleScopeChange")],
    ["handleScopeChange"],
    bindings,
  );
  return { state, storage, ...api };
}

test("카드나 탭으로 고르면 그 칸으로 열고 이 계정의 기억을 바꾼다", async () => {
  for (const lane of ["private", "shared"]) {
    const screen = scopeChanger();
    screen.handleScopeChange(lane);
    await flush();
    assert.equal(screen.state.opening, "decided");
    assert.equal(screen.state.scope, lane);
    assert.deepEqual(screen.storage.writes, [[keyOf(viewer), lane]]);
  }
  // 고른 칸은 다음에 열 때 그대로 열린다. 같은 기기의 다른 계정은 다시 고른다.
  const storage = fakeStorage();
  const first = scopeChanger({ storage });
  first.handleScopeChange("private");
  await flush();
  const reopened = laneScreen({ storage });
  reopened.run();
  await flush();
  assert.equal(reopened.state.scope, "private");
  assert.equal(reopened.state.opening, "decided");
  const someoneElse = laneScreen({ storage, userId: other });
  someoneElse.run();
  await flush();
  assert.equal(someoneElse.state.opening, "choosing");
});

test("쓸 수 없어 무시된 선택과 답을 받는 중의 누름은 기억하지 않는다 — 저장 실패도 던지지 않는다", async () => {
  const noRole = scopeChanger({ userRole: null });
  noRole.handleScopeChange("private");
  await flush();
  assert.deepEqual(noRole.storage.writes, []);
  assert.equal(noRole.state.scope, "shared");
  const busy = scopeChanger({ streaming: true });
  busy.handleScopeChange("private");
  await flush();
  assert.deepEqual(busy.storage.writes, []);
  assert.equal(busy.state.opening, "choosing");
  const failing = scopeChanger({ storage: fakeStorage({}, { failWrite: true }) });
  failing.handleScopeChange("private");
  await flush();
  assert.equal(failing.state.scope, "private", "저장에 실패해도 고른 칸은 연다");
});

test("칸을 정하기 전에는 보내지 않는다 — 입력칸이 열려 있어도", async () => {
  const run = async (opening) => {
    let proceeded = false;
    const bindings = {
      input: "보낼 말", streaming: false, sendingRef: { current: false }, initialLoaded: true, chatLoadError: null,
      coupleId: "44444444-4444-4444-8444-444444444444", userId: viewer, userRole: "bride",
      activeScope: "shared", activeLane: "shared_ai",
      chatVisibilityForScope: privacy.chatVisibilityForScope,
      viewClearInFlightRef: { current: null },
      laneOpeningRef: { current: opening },
      setFollowUpSuggestions: () => { proceeded = true; throw new Error("PROCEEDED"); },
    };
    const { handleSend } = evaluate([one("functions", "handleSend")], ["handleSend"], bindings);
    await handleSend().catch((error) => assert.equal(error.message, "PROCEEDED"));
    return proceeded;
  };
  assert.equal(await run("waiting"), false, "기억을 읽는 중에 보냈다");
  assert.equal(await run("choosing"), false, "선택 카드가 떠 있는데 보냈다");
  assert.equal(await run("decided"), true);
});

test("칸을 정하기 전에는 입력칸도 대화 목록도 열지 않는다", () => {
  const messages = [
    { id: "s", visibility: "shared", created_at: "2026-09-26T00:00:00.000Z" },
    { id: "p", visibility: "bride_private", created_at: "2026-09-26T00:00:01.000Z" },
  ];
  const at = (laneOpening, activeScope) => evaluate(
    [one("variables", "activeLane"), one("variables", "scopedMessages")],
    ["activeLane", "scopedMessages"],
    {
      laneOpening, activeScope, target: "ai", hasLinkedPartner: true, userRole: "bride", messages,
      resolveAmoraChatLane: chatLane.resolveAmoraChatLane,
      isMessageInChatScope: privacy.isMessageInChatScope,
      useMemo: (fn) => fn(),
    },
  );
  for (const opening of ["waiting", "choosing"]) {
    assert.equal(at(opening, "shared").activeLane, null, opening);
    assert.deepEqual(at(opening, "shared").scopedMessages, [], `${opening}: 자리값 함께 대화가 먼저 보였다`);
  }
  assert.equal(at("decided", "shared").activeLane, "shared_ai");
  assert.deepEqual(at("decided", "shared").scopedMessages.map((item) => item.id), ["s"]);
  assert.equal(at("decided", "private").activeLane, "private_ai");
  assert.deepEqual(at("decided", "private").scopedMessages.map((item) => item.id), ["p"]);
});

test("세션을 처음부터 다시 그리면 칸을 다시 정한다 — 기본 칸으로 되돌리지 않는다", () => {
  const state = { opening: "decided", scope: "private", wrapper: [] };
  const stub = new Proxy(function stubbed() {}, {
    get: (_target, key) => (key === Symbol.toPrimitive ? () => "" : stub),
    apply: () => stub,
    construct: () => stub,
    set: () => true,
  });
  const known = {
    useCallback: (fn) => fn,
    laneOpeningRef: { current: "decided" },
    setLaneOpeningState: (value) => { state.opening = value; },
    setActiveScopeState: (value) => { state.scope = value; },
  };
  const scope = new Proxy(known, {
    has: () => true,
    get: (target, key) => (key === Symbol.unscopables ? undefined : Object.hasOwn(target, key) ? target[key] : stub),
  });
  const { setLaneOpening, setActiveScope } = evaluate(
    [one("variables", "setLaneOpening"), one("variables", "setActiveScope")], ["setLaneOpening", "setActiveScope"], known,
  );
  known.setLaneOpening = setLaneOpening;
  known.setActiveScope = (value) => { state.wrapper.push(value); setActiveScope(value); };
  const { resetChatSessionState } = evaluate([one("variables", "resetChatSessionState")], ["resetChatSessionState"], scope);
  resetChatSessionState();
  assert.equal(state.opening, "waiting");
  assert.equal(known.laneOpeningRef.current, "waiting");
  assert.equal(state.scope, "shared", "자리값만 되돌린다");
  assert.deepEqual(state.wrapper, [], "리셋이 칸을 '정한' 것으로 만들면 다시 불러온 뒤 카드가 뜨지 않는다");
});

test("기본 칸으로 여는 길은 리셋 하나뿐이고, 기억에 쓰는 곳은 사람이 고르는 처리 하나뿐이다", () => {
  const count = (needle) => chatCode.split(needle).length - 1;
  // 자리값을 직접 바꾸는 곳: setActiveScope 본문과 리셋. 다른 곳이 이걸 쓰면 칸이 '정해지지' 않은 채 바뀐다.
  assert.equal(count("setActiveScopeState("), 2);
  assert.match(one("variables", "setActiveScope"), /setActiveScopeState\(next\)/);
  assert.match(one("variables", "resetChatSessionState"), /setActiveScopeState\("shared"\);\s*setLaneOpening\("waiting"\);/);
  // 타입은 걷힌 코드에 남지 않으므로 이 한 줄은 원문에서 센다.
  assert.equal(chat.split("useState<ChatScope>(").length - 1, 1);
  assert.match(chat, /const \[activeScope, setActiveScopeState\] = useState<ChatScope>\("shared"\)/);
  // 명시 진입(준비 안내 질문·개인 할 일 이어가기·확인한 변경·건너뛰기·화면 정리 되돌리기)은 모두 setActiveScope 를 탄다.
  assert.ok(count("setActiveScope(") >= 10, `setActiveScope 호출이 ${count("setActiveScope(")}개뿐이다`);
  // 기억에 쓰는 곳은 handleScopeChange 하나(선택 카드와 위쪽 탭). 읽는 곳은 여는 효과 하나.
  assert.equal(count("rememberAmoraLane("), 1);
  assert.match(one("functions", "handleScopeChange"), /rememberAmoraLane\(AsyncStorage, userId, nextScope\)/);
  assert.equal(count("readRememberedAmoraLane("), 1);
  assert.ok(found.laneEffects[0].includes("readRememberedAmoraLane(AsyncStorage, userId)"));
});

test("화면 배선 — 카드 자리, 준비 중 화면, 입력창 잠금과 안내, 탭·범위 줄", () => {
  // 선택 카드는 대화 영역 첫 자리에 놓이고, 그 가지에는 대화 목록과 시작 칩이 없다.
  const choosingStart = chat.indexOf(') : laneOpening === "choosing" ? (');
  const choosingEnd = chat.indexOf(") : displayedMessages.length === 0 ? (", choosingStart);
  assert.ok(choosingStart > 0 && choosingEnd > choosingStart, "선택 카드 가지를 찾지 못했다");
  const choosing = chat.slice(choosingStart, choosingEnd);
  assert.match(choosing, /<AmoraLaneChoiceCard hasLinkedPartner=\{hasLinkedPartner\} disabled=\{streaming\} onChoose=\{handleScopeChange\} \/>/);
  assert.match(choosing, /firstHelloMessage && <View style=\{st\.laneChoiceHello\}>\{renderMessage\(\{ item: firstHelloMessage \}\)\}<\/View>/);
  assert.ok(!choosing.includes("FlatList") && !choosing.includes("AMORA_STARTER_PROMPTS"));
  // 기억을 읽는 동안에는 준비 중 화면이다(자리값 칸을 먼저 그리지 않는다).
  assert.match(chat, /\{!initialLoaded \|\| \(!chatLoadError && laneOpening === "waiting"\) \? \(\s*<View style=\{st\.loading\}>/);
  // 입력창: 고르기 전에는 잠그고, 카드가 떠 있을 때 정본 안내를 보인다.
  assert.match(chat, /placeholder=\{laneOpening === "choosing" \? AMORA_LANE_CHOICE_COPY\.composerBlockedPlaceholder : isP \?/);
  assert.match(chat, /editable=\{[^}]*!composerLockedByLaneChoice\}/);
  // 정하기 전에는 대상(아모라/파트너) 줄·범위 줄·기억 줄·대화 정리·시작 칩이 없다.
  assert.match(chat, /\{laneDecided && activeScope === "shared" && \(\s*<View style=\{st\.targetRow\}>/);
  assert.match(chat, /\{laneDecided && <Text\s+style=\{\[st\.scopeStatus/);
  assert.match(chat, /\{laneDecided && !hasActiveW5SafetyCard && memoryLine && \(/);
  assert.match(chat, /\{initialLoaded && !chatLoadError && laneDecided && !!userRole && !isP && <AmoraConversationRecap/);
  assert.match(chat, /\{initialLoaded && laneDecided && scopedMessages\.length === 0 && firstHelloMessage && !isP && \(/);
  const derived = (laneOpening) => evaluate(
    [one("variables", "laneDecided"), one("variables", "composerLockedByLaneChoice"), one("variables", "shownScope")],
    ["laneDecided", "composerLockedByLaneChoice", "shownScope"],
    { laneOpening, activeScope: "private" },
  );
  for (const opening of ["waiting", "choosing"]) {
    assert.deepEqual({ ...derived(opening) }, { laneDecided: false, composerLockedByLaneChoice: true, shownScope: null }, opening);
  }
  assert.deepEqual({ ...derived("decided") }, { laneDecided: true, composerLockedByLaneChoice: false, shownScope: "private" });
});

test("아모라의 첫마디는 '나만 (상담)'을 고른 사람에게도 보이고, 상대에게 쓰는 칸에는 없다", () => {
  const hello = (over) => evaluate(
    [one("variables", "AMORA_FIRST_HELLO_MESSAGE_ID"), one("variables", "firstHelloMessage")],
    ["firstHelloMessage"],
    {
      useMemo: (fn) => fn(), firstHelloBody: "안녕하세요, 아모라예요.", coupleId: "couple", userRole: "bride",
      activeScope: "shared", target: "ai", laneOpening: "decided",
      chatVisibilityForScope: privacy.chatVisibilityForScope,
      amoraFirstHelloBodyForLane: firstHello.amoraFirstHelloBodyForLane, ...over,
    },
  ).firstHelloMessage;
  assert.equal(hello({ activeScope: "private" })?.visibility, "bride_private");
  assert.equal(hello({ activeScope: "private" })?.content, "안녕하세요, 아모라예요.");
  assert.equal(hello({ activeScope: "shared" })?.visibility, "shared");
  assert.equal(hello({ target: "partner" }), null);
  assert.equal(hello({ firstHelloBody: null }), null);
  // 첫마디는 여전히 저장하지 않는 로컬 인사다 — 서버로 보내는 대화에 섞지 않는다.
  assert.doesNotMatch(chat, /setMessages\(\[firstHello/);
});

test("라운지 첫마디의 초대 문단은 '함께 대화'로 정해진 뒤에만 보인다 — 나만 (상담)과 선택 카드 위에는 없다", () => {
  // 운영이 실제로 만드는 본문으로 잰다(2026-09-27 검토). 파트너가 아직 없는 새 사용자는 라운지에서
  // partnerLinked: false 로 첫마디를 받고(lounge.tsx loadPartnerLinked), 끝에 초대 문단이 붙는다.
  const now = Date.UTC(2026, 8, 27, 3);
  const unlinked = firstHello.buildAmoraFirstHello({ partnerLinked: false, now }).body;
  const withoutInvite = firstHello.buildAmoraFirstHello({ partnerLinked: true, now }).body;
  const inviteLine = "설정에서 초대 코드를 보내면 두 사람이 같은 화면을 봐요.";
  assert.ok(unlinked.endsWith(`\n\n${inviteLine}`), "입력이 운영과 다른 모양이면 이 검사는 아무것도 재지 않는다");
  const content = (over) => evaluate(
    [one("variables", "AMORA_FIRST_HELLO_MESSAGE_ID"), one("variables", "firstHelloMessage")],
    ["firstHelloMessage"],
    {
      useMemo: (fn) => fn(), firstHelloBody: unlinked, coupleId: "couple", userRole: "bride",
      activeScope: "shared", target: "ai", laneOpening: "decided",
      chatVisibilityForScope: privacy.chatVisibilityForScope,
      amoraFirstHelloBodyForLane: firstHello.amoraFirstHelloBodyForLane, ...over,
    },
  ).firstHelloMessage?.content;
  assert.equal(content({ activeScope: "private" }), withoutInvite, "나만 (상담) 맨 위에 '두 사람이 같은 화면'이 남았다");
  // 선택 카드 위(chat.tsx 의 choosing 가지)와 기억을 읽는 중. 카드의 '함께' 덧붙임과 같은 말을 두 번 하지 않는다.
  for (const laneOpening of ["choosing", "waiting"]) {
    assert.equal(content({ laneOpening }), withoutInvite, laneOpening);
    assert.equal(content({ laneOpening, activeScope: "private" }), withoutInvite, laneOpening);
  }
  assert.equal(content({ activeScope: "shared" }), unlinked, "함께 대화에서는 초대 문단이 참이다");
});
