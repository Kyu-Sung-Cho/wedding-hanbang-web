import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { setImmediate } from "node:timers";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import ts from "typescript";

/**
 * 루트 Stack 화면에서 채팅 탭(과 다른 네이티브 화면)으로 갈 때 화면이 한 벌 더 쌓이지 않는가.
 *
 * 2026-09-15 재확인: 라운지(탭 안)에서 예절 웹뷰를 열면 루트 스택이 [(tabs)#1, webview]가 된다.
 * 웹뷰 안의 아모라 질문 링크가 `router.replace('/chat?amoraSource=…')`를 부르면 expo-router 는
 * 루트 스택 대상 REPLACE 를 보내고, StackRouter 는 webview 자리를 **새 key 의 (tabs)#2**로 바꾼다.
 * 결과는 [(tabs)#1, (tabs)#2] — ChatScreen 이 둘 마운트돼 대화를 따로 불러오고 구독한다.
 * 뒤로 가기를 누르면 또 다른 채팅 화면이 나온다.
 * 루트 스택 화면(준비 기록, 나만 보는 할 일)의 `router.push('/(tabs)/chat')`도 같은 중복을 만든다.
 *
 * 체크리스트 시트(`schedule/index.tsx` askAmoraFromChecklist)와 같은 방식으로 `dismissTo`를 쓴다.
 * 아래에 있는 기존 (tabs)로 돌아가 채팅 탭을 열고, 없으면 지금 자리를 (tabs)로 바꾼다.
 */

const require = createRequire(import.meta.url);
const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const settle = () => new Promise((resolve) => setImmediate(resolve));

function recordingRouter(events, { canGoBack = true } = {}) {
  return {
    push: (route) => events.push(["push", route]),
    navigate: (route) => events.push(["navigate", route]),
    replace: (route) => events.push(["replace", route]),
    dismissTo: (route) => events.push(["dismissTo", route]),
    back: () => events.push(["back"]),
    canGoBack: () => canGoBack,
  };
}

function compileModule(relative, modules) {
  const code = ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  new Function("exports", "module", "require", code)(module.exports, module, (name) => {
    assert.ok(Object.hasOwn(modules, name), `unmocked dependency: ${name}`);
    return modules[name];
  });
  return module.exports;
}

const jsx = (type, props) => ({ type, props: props ?? {} });
const token = new Proxy({}, { get: () => token });
const nodesOf = (value) => (!value ? [] : Array.isArray(value) ? value.flatMap(nodesOf) : typeof value === "object" ? [value, ...nodesOf(value.props?.children)] : []);
const textOf = (value) => (value == null || typeof value === "boolean" ? "" : Array.isArray(value) ? value.map(textOf).join("") : typeof value === "object" ? textOf(value.props?.children) : String(value));

// ── 웹뷰 ────────────────────────────────────────────────────────────────

const preparationSource = compileModule("../lib/amoraPreparationSource.ts", {});
const webviewSource = read("../../app/webview.tsx");
const webviewTree = ts.createSourceFile("webview.tsx", webviewSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function webviewNavigation() {
  let callback;
  (function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(webviewTree) === "handleNavigation") callback = node.initializer.arguments[0].getText(webviewTree);
    ts.forEachChild(node, visit);
  })(webviewTree);
  assert.ok(callback, "webview.tsx 의 handleNavigation 이 없다");
  const declarations = webviewTree.statements
    .filter((node) => (ts.isVariableStatement(node) && node.declarationList.declarations.some((d) => d.name.getText(webviewTree) === "WEB_TO_NATIVE"))
      || (ts.isFunctionDeclaration(node) && ["nativeRouteForWebPath", "canOpenExternally"].includes(node.name?.text)))
    .map((node) => node.getText(webviewTree)).join("\n").replace(/export function/g, "function");
  const code = ts.transpileModule(`${declarations}\nconst navigate = ${callback};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return (url) => {
    const events = [];
    const bindings = {
      ...preparationSource,
      SITE_ORIGIN: "https://hanbang.ai",
      normalizeMobileSiteUrl: (value, origin) => { try { return new URL(value).origin === origin ? value : null; } catch { return null; } },
      router: recordingRouter(events),
      Alert: { alert: (title) => events.push(["alert", title]) },
      setCurrentTitle: () => {},
      titleFromUrl: () => "",
      Linking: { openURL: (value) => { events.push(["external", value]); return Promise.resolve(); } },
    };
    const navigate = new Function("bindings", `with (bindings) { ${code}; return navigate; }`)(bindings);
    return { allowed: navigate({ url }), events };
  };
}

test("웹뷰의 아모라 질문 링크는 replace 가 아니라 dismissTo 로 기존 채팅 탭에 간다", () => {
  const navigate = webviewNavigation();
  for (const [url, route] of [
    ["https://hanbang.ai/wedding/chat?amoraSource=g.gift-money.section-2", "/chat?amoraSource=g.gift-money.section-2"],
    ["https://hanbang.ai/chat?amoraSource=c.dress.dress_08", "/chat?amoraSource=c.dress.dress_08"],
  ]) {
    const result = navigate(url);
    assert.equal(result.allowed, false, "웹뷰가 그 주소를 직접 열면 안 된다");
    assert.deepEqual(result.events, [["dismissTo", route]], url);
  }
});

test("웹뷰가 네이티브 화면으로 넘기는 경로도 dismissTo 로 간다(채팅 탭·이미 아래에 있는 화면을 두 벌 만들지 않는다)", () => {
  const navigate = webviewNavigation();
  for (const [url, route] of [
    ["https://hanbang.ai/wedding/chat", "/chat"],
    ["https://hanbang.ai/wedding/checklist", "/checklist"],
    ["https://hanbang.ai/budget", "/budget"],
    ["https://hanbang.ai/wedding/settings/profile", "/settings"],
  ]) {
    const result = navigate(url);
    assert.equal(result.allowed, false);
    assert.deepEqual(result.events, [["dismissTo", route]], url);
  }
});

test("웹뷰의 공개 페이지·잘못된 질문 링크·외부 링크는 화면 이동을 하지 않는다", () => {
  const navigate = webviewNavigation();
  const publicPage = navigate("https://hanbang.ai/wedding/manners/gift-money");
  assert.equal(publicPage.allowed, true);
  assert.deepEqual(publicPage.events, []);
  const invalid = navigate("https://hanbang.ai/wedding/chat?amoraSource=g.gift-money&amoraSource=g.other");
  assert.equal(invalid.allowed, false);
  assert.deepEqual(invalid.events.map(([kind]) => kind), ["alert"], "경로를 못 만들면 일반 채팅으로 조용히 가지 않는다");
  const external = navigate("https://example.invalid/page");
  assert.equal(external.allowed, false);
  assert.deepEqual(external.events, [["external", "https://example.invalid/page"]]);
});

test("웹뷰 세션 만료 시 로그인 화면 이동은 그대로 replace 다", () => {
  // 로그인 화면은 (tabs)가 아니고, 웹뷰를 로그인 화면으로 바꾸는 것이 의도다.
  assert.ok(webviewSource.includes('router.replace("/(auth)/login")'));
  const replaces = [...webviewSource.matchAll(/router\.replace\(("[^"]*"|[^)"]*)/g)].map((match) => match[1]);
  assert.deepEqual(replaces, ['"/(auth)/login"'], "웹뷰의 다른 이동은 replace 를 쓰지 않는다");
});

// ── 준비 기록 ───────────────────────────────────────────────────────────

function renderPreparationScreen() {
  const events = [];
  const screen = compileModule("../../app/amora-preparation.tsx", {
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": { ScrollView: "ScrollView", StyleSheet: { create: (value) => value }, View: "View" },
    "expo-router": { router: recordingRouter(events) },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "@hanbang/design-tokens": { colors: token, spacing: token },
    "@/components/lounge/AmoraActionsCard": { default: "AmoraActionsCard" },
    "@/components/ui/AppUI": { ActionRow: "ActionRow", AppHeader: "AppHeader", AppText: "AppText", Surface: "Surface" },
  });
  const tree = screen.default();
  const row = (title) => {
    const found = nodesOf(tree).find((node) => node.type === "ActionRow" && node.props.title === title);
    assert.ok(found, `행이 없다: ${title}`);
    return found;
  };
  return { events, row };
}

test("준비 기록의 「아모라와 이야기하기」는 dismissTo 로 기존 채팅 탭에 간다", () => {
  const h = renderPreparationScreen();
  h.row("아모라와 이야기하기").props.onPress();
  assert.deepEqual(h.events, [["dismissTo", "/(tabs)/chat"]]);
});

test("준비 기록의 루트 스택 화면 링크는 push 를 유지한다(탭이 아니라 중복이 생기지 않는다)", () => {
  const h = renderPreparationScreen();
  for (const title of ["예산 확인하기", "일정 확인하기", "체크리스트 확인하기", "나만 보는 할 일"]) h.row(title).props.onPress();
  assert.deepEqual(h.events, [["push", "/budget"], ["push", "/schedule"], ["push", "/checklist"], ["push", "/amora-personal"]]);
});

// ── 나만 보는 할 일 ─────────────────────────────────────────────────────

function renderPersonalScreen({ canGoBack = true } = {}) {
  const events = [];
  const data = {
    ownerId: "owner", loading: false, error: null, writeError: null, actions: [], count: 0, nextCursor: null, busyIds: [],
    session: { load: async () => true, getState: () => ({ ownerId: "owner" }), update: async () => {}, remove: async () => {} },
  };
  const screen = compileModule("../../app/amora-personal.tsx", {
    react: { useCallback: (fn) => fn },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": { Alert: { alert: () => {} }, Pressable: "Pressable", RefreshControl: "RefreshControl", ScrollView: "ScrollView", StyleSheet: { create: (value) => value }, View: "View" },
    "@/components/ui/AppText": { Text: "Text" },
    "expo-router": { router: recordingRouter(events, { canGoBack }), useFocusEffect: () => {} },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "@hanbang/design-tokens": { colors: token, spacing: token, radius: token },
    "@/components/ui/AppUI": { AppHeader: "AppHeader" },
    "@/lib/usePersonalActions": { usePersonalActions: () => data },
    "@/components/chat/PersonalActionContinue": { PersonalActionContinue: "PersonalActionContinue" },
  });
  const tree = screen.default();
  return { events, nodes: () => nodesOf(tree) };
}

test("나만 보는 할 일의 「아모라 대화로 돌아가기」는 dismissTo 로 기존 채팅 탭에 돌아간다", () => {
  const h = renderPersonalScreen();
  const back = h.nodes().find((node) => node.type === "Pressable" && textOf(node) === "아모라 대화로 돌아가기");
  assert.ok(back, "돌아가기 버튼이 없다");
  back.props.onPress();
  assert.deepEqual(h.events, [["dismissTo", "/(tabs)/chat"]]);
});

test("나만 보는 할 일의 머리 뒤로 가기는 기존 동작을 지킨다", () => {
  const withHistory = renderPersonalScreen({ canGoBack: true });
  withHistory.nodes().find((node) => node.type === "AppHeader").props.onBack();
  assert.deepEqual(withHistory.events, [["back"]]);
  // 뒤로 갈 곳이 없으면(알림으로 바로 연 경우) 스택에 이 화면뿐이라 replace 로 (tabs) 한 벌만 둔다.
  const alone = renderPersonalScreen({ canGoBack: false });
  alone.nodes().find((node) => node.type === "AppHeader").props.onBack();
  assert.deepEqual(alone.events, [["replace", "/(tabs)/chat"]]);
});

// ── 개인 할 일 이어서 상담 ──────────────────────────────────────────────

function renderContinue({ review, stage }) {
  const events = [];
  const slots = []; let index = 0; let tree;
  const action = { id: "44444444-4444-4444-8444-444444444444", ownerUserId: "owner", title: "혼자 생각할 기준", description: null, dueDate: null };
  const component = compileModule("../components/chat/PersonalActionContinue.tsx", {
    react: {
      useState(initial) { const key = index++; slots[key] ??= { value: initial }; return [slots[key].value, (value) => { slots[key].value = value; }]; },
      useRef(initial) { const key = index++; slots[key] ??= { current: initial }; return slots[key]; },
      useEffect(callback) { const key = index++; if (!slots[key]) { slots[key] = {}; callback(); } },
    },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": { Modal: "Modal", Pressable: "Pressable", ScrollView: "ScrollView", StyleSheet: { create: (value) => value }, View: "View" },
    "@/components/ui/AppText": { Text: "Text" },
    "expo-router": { router: recordingRouter(events) },
    "@hanbang/design-tokens": { colors: token, spacing: token, radius: token },
    "@/lib/personalActionContinuation": { personalActionContinuation: { review: async () => review(action), stage: async (value) => stage(value) } },
    "@/lib/supabase": { supabase: { auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } } },
  });
  const render = () => { index = 0; tree = component.PersonalActionContinue({ action }); };
  render();
  const button = (label) => nodesOf(tree).find((node) => node.type === "Pressable" && textOf(node) === label);
  return { events, render, button, text: () => textOf(tree) };
}

test("개인 할 일을 입력창에 넣으면 dismissTo 로 기존 채팅 탭에 간다", async () => {
  const staged = [];
  const h = renderContinue({ review: (action) => ({ action }), stage: (value) => { staged.push(value); } });
  h.button("이 할 일 이어서 상담").props.onPress(); await settle(); h.render();
  assert.deepEqual(h.events, [], "검토 창을 열기만 해서는 이동하지 않는다");
  h.button("나만 상담 입력창에 넣기").props.onPress(); await settle(); h.render();
  assert.equal(staged.length, 1);
  assert.deepEqual(h.events, [["dismissTo", "/(tabs)/chat"]]);
});

test("입력창에 넣기가 실패하면 채팅으로 이동하지 않는다", async () => {
  const h = renderContinue({ review: (action) => ({ action }), stage: () => { throw new Error("source rejected"); } });
  h.button("이 할 일 이어서 상담").props.onPress(); await settle(); h.render();
  h.button("나만 상담 입력창에 넣기").props.onPress(); await settle(); h.render();
  assert.deepEqual(h.events, []);
  assert.match(h.text(), /확인하지 못했어요/u);
});

// ── 실제 StackRouter 로 전제와 결과를 확인한다 ─────────────────────────

async function loadStackRouter() {
  const appRequire = createRequire(new URL("../../package.json", import.meta.url));
  const expoRequire = createRequire(appRequire.resolve("expo-router/package.json"));
  const navigationRequire = createRequire(expoRequire.resolve("@react-navigation/native/package.json"));
  const { StackRouter } = await import(pathToFileURL(navigationRequire.resolve("@react-navigation/routers")).href);
  return StackRouter({});
}

const ROOT_ROUTES = ["index", "(tabs)", "schedule", "checklist", "budget", "amora-preparation", "amora-personal", "webview"];
const options = { routeNames: ROOT_ROUTES, routeParamList: {}, routeGetIdList: {} };
const chatPayload = (params = {}) => ({ name: "(tabs)", params: { screen: "chat", params } });

function stackOf(router, names) {
  let state = router.getInitialState(options);
  for (const name of names) {
    state = router.getStateForAction(state, { type: "PUSH", payload: name === "(tabs)" ? { name, params: { screen: "lounge" } } : { name } }, options);
  }
  assert.deepEqual(state.routes.map((route) => route.name), ["index", ...names]);
  return state;
}

test("실제 StackRouter: 웹뷰에서 replace 는 (tabs)를 두 벌 만들고 dismissTo 는 기존 (tabs)를 다시 쓴다", async () => {
  const router = await loadStackRouter();
  const state = stackOf(router, ["(tabs)", "webview"]);
  const payload = chatPayload({ amoraSource: "g.gift-money.section-2" });

  const replaced = router.getStateForAction(state, { type: "REPLACE", target: state.key, payload }, options);
  assert.equal(replaced.routes.filter((route) => route.name === "(tabs)").length, 2, "replace 가 중복을 만든다는 전제가 깨졌다");

  const dismissed = router.getStateForAction(state, { type: "POP_TO", target: state.key, payload }, options);
  assert.deepEqual(dismissed.routes.map((route) => route.name), ["index", "(tabs)"]);
  assert.equal(dismissed.routes[1].key, state.routes[1].key, "기존 (tabs)를 그대로 쓴다 — 채팅 화면이 새로 마운트되지 않는다");
  assert.deepEqual(dismissed.routes[1].params, payload.params, "채팅 탭과 질문 출처가 전달된다");
});

test("실제 StackRouter: 웹뷰가 아래에 있는 화면으로 넘길 때 dismissTo 는 그 화면으로 돌아가고, 없으면 웹뷰 자리를 바꾼다", async () => {
  const router = await loadStackRouter();
  const fromChecklist = stackOf(router, ["(tabs)", "checklist", "webview"]);
  const replaced = router.getStateForAction(fromChecklist, { type: "REPLACE", target: fromChecklist.key, payload: { name: "checklist" } }, options);
  assert.equal(replaced.routes.filter((route) => route.name === "checklist").length, 2, "replace 가 체크리스트를 두 벌 만든다는 전제가 깨졌다");
  const back = router.getStateForAction(fromChecklist, { type: "POP_TO", target: fromChecklist.key, payload: { name: "checklist" } }, options);
  assert.deepEqual(back.routes.map((route) => route.name), ["index", "(tabs)", "checklist"]);
  assert.equal(back.routes[2].key, fromChecklist.routes[2].key);

  const fromLounge = stackOf(router, ["(tabs)", "webview"]);
  const swapped = router.getStateForAction(fromLounge, { type: "POP_TO", target: fromLounge.key, payload: { name: "budget" } }, options);
  assert.deepEqual(swapped.routes.map((route) => route.name), ["index", "(tabs)", "budget"], "아래에 없으면 예전 replace 와 같다");
});

test("실제 StackRouter: 준비 기록 → 나만 보는 할 일에서 push 는 (tabs)를 두 벌 만들고 dismissTo 는 기존 채팅으로 돌아간다", async () => {
  const router = await loadStackRouter();
  for (const names of [["(tabs)", "amora-preparation"], ["(tabs)", "amora-preparation", "amora-personal"], ["(tabs)", "amora-personal"]]) {
    const state = stackOf(router, names);
    const pushed = router.getStateForAction(state, { type: "PUSH", target: state.key, payload: chatPayload() }, options);
    assert.equal(pushed.routes.filter((route) => route.name === "(tabs)").length, 2, `push 전제가 깨졌다: ${names.join(" > ")}`);
    const dismissed = router.getStateForAction(state, { type: "POP_TO", target: state.key, payload: chatPayload() }, options);
    assert.deepEqual(dismissed.routes.map((route) => route.name), ["index", "(tabs)"], names.join(" > "));
    assert.equal(dismissed.routes[1].key, state.routes[1].key);
    assert.equal(dismissed.routes[1].params.screen, "chat");
  }
});

test("나만 보는 할 일은 루트 스택 화면이다(탭 안 화면이 아니다)", () => {
  // 탭 안 화면이면 dismissTo 가 아니라 탭 이동이 맞다. 파일 위치로 확인한다.
  const tabs = read("../../app/(tabs)/_layout.tsx");
  assert.doesNotMatch(tabs, /amora-personal|amora-preparation|webview/u);
  assert.ok(require.resolve(fileURLToPath(new URL("../../app/amora-personal.tsx", import.meta.url))));
  assert.ok(require.resolve(fileURLToPath(new URL("../../app/amora-preparation.tsx", import.meta.url))));
  assert.ok(require.resolve(fileURLToPath(new URL("../../app/webview.tsx", import.meta.url))));
  assert.match(read("../../app/_layout.tsx"), /<Stack\.Screen name="webview"/u);
});
