import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import ts from "typescript";

/**
 * 네이티브 체크리스트 시트의 아모라 질문 입구.
 *
 * 웹 체크리스트 모달에는 분야 전체(「아모라 질문」)와 항목마다 아모라 버튼이 있어 채팅 입력창에
 * 질문을 채운다. 앱 시트에는 없었다. 앱은 이미 웹뷰 예절 편의 `amoraSource` 링크를 네이티브 채팅
 * 초안으로 옮기고 있으므로(`webview.tsx`), 시트도 **같은 경로**를 쓴다.
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

const source = compile("../lib/amoraPreparationSource.ts");
const { CATEGORY_CHECKLISTS, CHECKLIST_MAP } = compile("../../../../packages/shared/src/constants/weddingPlanning.ts");
const web = compile("../../../web/src/lib/amora/preparationHandoff.ts");

test("분야·항목 경로가 웹 체크리스트 모달의 주소와 글자까지 같다", () => {
  let checked = 0;
  for (const category of CATEGORY_CHECKLISTS) {
    for (const item of [null, ...category.items]) {
      const native = source.checklistPreparationRoute(category.key, item?.id);
      const href = web.buildAmoraPreparationHref({ kind: "checklist", categoryKey: category.key, ...(item ? { itemId: item.id } : {}) });
      assert.ok(native, `${category.key}${item ? `.${item.id}` : ""} 경로가 없다 — 버튼이 조용히 실패한다`);
      assert.equal(native, href);
      checked += 1;
    }
  }
  assert.ok(checked > 150, `항목을 ${checked}개만 확인했다`);
});

test("시트 경로는 웹뷰 링크와 같은 채팅 경로로 옮겨진다", () => {
  const route = source.checklistPreparationRoute("dress", "dress_08");
  assert.equal(route, "/chat?amoraSource=c.dress.dress_08");
  assert.deepEqual(source.preparationNavigation(`https://hanbang.ai/wedding${route}`), { route });
  assert.equal(source.readPreparationSource(new URL(route, "https://hanbang.ai").searchParams.get("amoraSource")), "c.dress.dress_08");
});

test("정본 모양이 아닌 키는 경로를 만들지 않는다", () => {
  for (const [key, item] of [["Dress", undefined], ["dress", "dress-08"], ["../x", undefined], ["dress", ""], ["", undefined], ["dress", "a.b"]]) {
    assert.equal(source.checklistPreparationRoute(key, item), null, `${key} ${item}`);
  }
});

function renderSheet({ categoryKey, items, skipped = false }) {
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const token = new Proxy({}, { get: (_target, key) => (key === "radius" ? 12 : typeof key === "string" ? new Proxy({}, { get: () => "#000000" }) : undefined) });
  const calls = [];
  const sheet = compile("../components/checklist/CategoryChecklistSheet.tsx", {
    react: { useMemo: (factory) => factory() },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": { Modal: "Modal", View: "View", ScrollView: "ScrollView", Pressable: "Pressable", StyleSheet: { create: (value) => value } },
    "@/components/ui/AppText": { Text: "Text" },
    "lucide-react-native": { Check: "Check", Ban: "Ban", Sparkle: "Sparkle", BookOpen: "BookOpen" },
    "@hanbang/design-tokens": { amoraIdentity: token, colors: token },
    "@hanbang/shared/constants": {
      CHECKLIST_MAP,
      checklistItemTag: () => undefined,
      checklistNoteSourceChip: () => undefined,
      groupChecklistItems: (_key, list) => [{ title: "", items: list }],
      labelWithoutConditionSuffix: (label) => label,
      mannersGuideForCategory: () => ({ slug: "dress-guide", title: "드레스 안내" }),
    },
    "@/components/ui/AmoraMark": { default: "AmoraMark" },
    "./ChecklistProgressRing": { default: "ChecklistProgressRing" },
    "./ChecklistItemTag": { default: "ChecklistItemTag" },
  }, { jsx: true });
  const tree = sheet.default({
    visible: true,
    categoryKey,
    label: CHECKLIST_MAP[categoryKey].label,
    items,
    tip: "tip",
    stats: { done: 0, total: items.length, percent: 0, skipped },
    onClose: () => {},
    onToggleItem: (id) => calls.push(["toggle", id]),
    onToggleApplicability: () => {},
    onOpenGuide: () => {},
    onOpenSource: () => {},
    onAskAmora: (...args) => calls.push(["amora", ...args]),
  });
  const pressables = [];
  const texts = [];
  (function walk(node, insidePressable) {
    if (Array.isArray(node)) return node.forEach((child) => walk(child, insidePressable));
    if (typeof node === "string") return void texts.push(node);
    if (!node || typeof node !== "object") return;
    if (node.type === "Pressable") pressables.push({ node, insidePressable });
    walk(node.props.children, insidePressable || node.type === "Pressable");
  })(tree, false);
  return { pressables, texts, calls };
}

test("시트에 분야 질문과 정본 항목 질문 버튼이 있고, 누르면 체크 대신 질문만 요청한다", () => {
  const template = CHECKLIST_MAP.dress;
  const items = [
    ...template.items.slice(0, 2).map((item) => ({ ...item, done: false })),
    { id: "custom_legacy", label: "예전에 직접 넣은 항목", done: false },
  ];
  const { pressables, texts, calls } = renderSheet({ categoryKey: "dress", items });
  const amora = pressables.filter(({ node }) => /아모라에 질문하기$/.test(node.props.accessibilityLabel ?? ""));

  assert.deepEqual(
    amora.map(({ node }) => node.props.accessibilityLabel),
    [...items.slice(0, 2).map((item) => `${item.label} 아모라에 질문하기`), `${template.label} 아모라에 질문하기`],
    "정본 항목 둘과 분야 하나 — 직접 넣은 항목에는 달지 않는다",
  );
  for (const { node, insidePressable } of amora) {
    assert.equal(insidePressable, false, "체크 버튼 안에 넣으면 스크린리더가 누르지 못한다");
    assert.equal(node.props.accessibilityRole, "button");
    node.props.onPress();
  }
  assert.deepEqual(calls, [["amora", items[0].id], ["amora", items[1].id], ["amora"]]);
  assert.ok(texts.includes("아모라 질문"));
  // 눈에 보이는 안내 줄은 따로 두지 않는다 — 채팅 입력창에 질문만 채워진다.
  assert.ok(!texts.some((text) => /질문 초안|체크 상태/.test(text)), texts.join(" / "));
});

test("아모라 버튼 힌트는 질문을 보낸 뒤에도 사실인 문장이다", () => {
  // 2026-09-15 리뷰: 「직접 보내기 전에는 체크 상태가 바뀌지 않아요」는 보내면 바뀔 수 있다고 읽힌다.
  // 아모라는 질문을 받아도 체크를 바꾸지 않는다 — 사용자가 카드를 직접 확인해야만 바뀐다.
  const template = CHECKLIST_MAP.dress;
  const items = template.items.slice(0, 1).map((item) => ({ ...item, done: false }));
  const { pressables } = renderSheet({ categoryKey: "dress", items });
  const amora = pressables.filter(({ node }) => /아모라에 질문하기$/.test(node.props.accessibilityLabel ?? ""));
  assert.equal(amora.length, 2, "항목 하나와 분야 하나");
  const webModal = readFileSync(new URL("../../../web/src/components/app/schedule/CategoryChecklistModal.tsx", import.meta.url), "utf8");
  const webPromise = /질문 초안을 확인한 뒤 직접 보내요\. (체크 상태는 바뀌지 않아요\.)/u.exec(webModal)?.[1];
  assert.ok(webPromise, "웹 체크리스트 모달의 안내 문장이 있어야 앱 문구와 맞춰 볼 수 있다");
  for (const { node } of amora) {
    const hint = node.props.accessibilityHint;
    assert.equal(hint, "아모라 채팅 입력창에 질문만 채워요. 질문을 보내도 체크 상태는 바뀌지 않아요.");
    assert.doesNotMatch(hint, /보내기 전에는/u, "보내면 바뀐다는 뜻으로 읽히는 조건을 달지 않는다");
    assert.ok(hint.endsWith(webPromise), "웹과 같은 약속 문장으로 끝난다");
  }
  const sheetSource = readFileSync(new URL("../components/checklist/CategoryChecklistSheet.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(sheetSource, /보내기 전에는/u, "주석도 같은 뜻으로 고친다");
});

test("체크리스트 화면이 시트를 닫고 같은 경로로 채팅을 연다", () => {
  const screenSource = readFileSync(new URL("../../app/schedule/index.tsx", import.meta.url), "utf8");
  const tree = ts.createSourceFile("schedule.tsx", screenSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let fn;
  (function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "askAmoraFromChecklist") fn = node.getText(tree);
    ts.forEachChild(node, visit);
  })(tree);
  assert.ok(fn, "askAmoraFromChecklist 가 없다");
  assert.match(screenSource, /onAskAmora=\{\(itemId\) => askAmoraFromChecklist\(sheetCategory\.key, itemId\)\}/);

  const run = (categoryKey, itemId) => {
    const events = [];
    const code = ts.transpileModule(fn, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const bindings = {
      checklistPreparationRoute: source.checklistPreparationRoute,
      setExpandedKey: (value) => events.push(["close", value]),
      router: {
        push: (route) => events.push(["push", route]),
        navigate: (route) => events.push(["navigate", route]),
        replace: (route) => events.push(["replace", route]),
        dismissTo: (route) => events.push(["dismissTo", route]),
      },
      Alert: { alert: (title) => events.push(["alert", title]) },
    };
    new Function("bindings", `with (bindings) { ${code}; return askAmoraFromChecklist; }`)(bindings)(categoryKey, itemId);
    return events;
  };

  // 체크리스트(/schedule)는 루트 Stack 화면이다. push 는 루트 스택에 (tabs)를 한 벌 더 쌓아
  // 채팅 화면이 둘 마운트된다. dismissTo 는 아래에 있는 기존 (tabs)로 돌아가 채팅 탭을 연다.
  assert.deepEqual(run("dress", "dress_08"), [["close", null], ["dismissTo", "/chat?amoraSource=c.dress.dress_08"]]);
  assert.deepEqual(run("dress"), [["close", null], ["dismissTo", "/chat?amoraSource=c.dress"]]);
  const invalid = run("Dress");
  assert.equal(invalid.length, 1);
  assert.equal(invalid[0][0], "alert", "경로를 못 만들면 조용히 일반 채팅으로 가지 않는다");
});

test("루트 스택에서 dismissTo 는 (tabs)를 새로 만들지 않고, push 는 한 벌 더 만든다", async () => {
  // 실제 React Navigation StackRouter 로 확인한다. expo-router 는 `/chat?...` 을 루트 스택 대상
  // `{ name: "(tabs)", params: { screen: "chat", params } }` 동작으로 바꿔 보낸다(routing.js getNavigateAction).
  const appRequire = createRequire(new URL("../../package.json", import.meta.url));
  const expoRequire = createRequire(appRequire.resolve("expo-router/package.json"));
  const navigationRequire = createRequire(expoRequire.resolve("@react-navigation/native/package.json"));
  const { StackRouter } = await import(pathToFileURL(navigationRequire.resolve("@react-navigation/routers")).href);
  const router = StackRouter({});
  const options = { routeNames: ["index", "(tabs)", "schedule", "webview"], routeParamList: {}, routeGetIdList: {} };
  let state = router.getInitialState(options);
  state = router.getStateForAction(state, { type: "PUSH", payload: { name: "(tabs)", params: { screen: "lounge" } } }, options);
  state = router.getStateForAction(state, { type: "PUSH", payload: { name: "schedule" } }, options);
  assert.deepEqual(state.routes.map((route) => route.name), ["index", "(tabs)", "schedule"]);
  const chatPayload = { name: "(tabs)", params: { screen: "chat", params: { amoraSource: "c.dress.dress_08" } } };

  const pushed = router.getStateForAction(state, { type: "PUSH", target: state.key, payload: chatPayload }, options);
  assert.equal(pushed.routes.filter((route) => route.name === "(tabs)").length, 2, "push 가 중복을 만든다는 전제가 깨졌다");

  const dismissed = router.getStateForAction(state, { type: "POP_TO", target: state.key, payload: chatPayload }, options);
  assert.deepEqual(dismissed.routes.map((route) => route.name), ["index", "(tabs)"]);
  const tabs = dismissed.routes[1];
  assert.equal(tabs.key, state.routes[1].key, "기존 (tabs) route 를 그대로 다시 쓴다 — 채팅 화면이 새로 마운트되지 않는다");
  assert.deepEqual(tabs.params, chatPayload.params, "채팅 탭과 질문 출처가 그대로 전달된다");

  // (tabs)가 스택에 없을 때(알림으로 체크리스트를 바로 연 경우)는 체크리스트 자리를 (tabs)로 바꿔 한 벌만 둔다.
  const deepLinked = router.getStateForAction(router.getInitialState({ ...options, routeNames: ["schedule", "index", "(tabs)", "webview"] }), { type: "POP_TO", payload: chatPayload }, { ...options, routeNames: ["schedule", "index", "(tabs)", "webview"] });
  assert.deepEqual(deepLinked.routes.map((route) => route.name), ["(tabs)"]);
});
