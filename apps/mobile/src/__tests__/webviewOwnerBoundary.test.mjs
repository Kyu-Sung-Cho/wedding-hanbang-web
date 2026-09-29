/* global Response */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as bridge from "../lib/mobileWebApiBridge.mjs";
import * as siteUrl from "../lib/siteUrl.mjs";
import * as unsaved from "../lib/webviewUnsavedWork.mjs";
import * as sharing from "../lib/webviewShare.mjs";

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";

test("native owner support is injected for the exact top-document nonce without exposing credentials", () => {
  const screen = createScreen();
  const view = screen.render();
  const document = {};
  document.top = document;
  document.self = document;
  const script = view.props.injectedJavaScript;
  runInNewContext(script, { window: document });
  const nonce = document[bridge.MOBILE_WEB_API_NONCE_PROPERTY];
  assert.equal(typeof nonce, "string");
  assert.equal(document.__HANBANG_MOBILE_API_OWNER_SCOPE_V1__, nonce);
  assert.equal(Object.getOwnPropertyDescriptor(document, "__HANBANG_MOBILE_API_OWNER_SCOPE_V1__").writable, false);
  assert.equal(Object.getOwnPropertyDescriptor(document, "__HANBANG_MOBILE_API_OWNER_SCOPE_V1__").configurable, false);
  assert.equal(view.props.injectedJavaScriptBeforeContentLoaded, script);
  runInNewContext(script, { window: document });
  assert.equal(document.__HANBANG_MOBILE_API_OWNER_SCOPE_V1__, nonce);
  const subframe = { top: {}, self: {} };
  runInNewContext(script, { window: subframe });
  assert.equal(subframe.__HANBANG_MOBILE_API_OWNER_SCOPE_V1__, undefined);
  assert.doesNotMatch(script, /access_token|authorization/i);
});
const compiled = ts.transpileModule(readFileSync(new URL("../../app/webview.tsx", import.meta.url), "utf8"), {
  fileName: "webview.tsx",
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const apiCompiled = ts.transpileModule(readFileSync(new URL("../lib/api.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

// 실제 화면과 이벤트 핸들러를 실행한다. 훅 저장소와 key별 인스턴스만 네이티브 대신 제공한다.
function createScreen({ realApi = false } = {}) {
  const components = new Map();
  const nativeViews = new Map();
  const listeners = new Set();
  const calls = [];
  const replies = [];
  const injections = [];
  const redirects = [];
  const network = [];
  const sessionReads = [];
  let liveOwner = OWNER_A;
  let current;
  let visited;
  let serial = 0;
  let uuid = 0;
  const useSlot = (create) => {
    const index = current.index++;
    if (!(index in current.slots)) current.slots[index] = create();
    return current.slots[index];
  };
  const sameDeps = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const tokens = new Proxy({}, { get: () => tokens });
  const deps = {
    react: {
      useState: (initial) => {
        const slot = useSlot(() => ({ value: typeof initial === "function" ? initial() : initial }));
        return [slot.value, (value) => { slot.value = typeof value === "function" ? value(slot.value) : value; }];
      },
      useRef: (initial) => useSlot(() => ({ current: initial })),
      useMemo: (create, dependencies) => {
        const slot = useSlot(() => ({}));
        if (!sameDeps(slot.dependencies, dependencies)) {
          slot.value = create();
          slot.dependencies = dependencies;
        }
        return slot.value;
      },
      useCallback: (callback, dependencies) => deps.react.useMemo(() => callback, dependencies),
      useEffect: (effect, dependencies) => {
        const slot = useSlot(() => ({}));
        if (!sameDeps(slot.dependencies, dependencies)) {
          slot.next = effect;
          slot.dependencies = dependencies;
        }
      },
    },
    "react/jsx-runtime": { jsx: (type, props, key) => ({ type, props: props ?? {}, key }), jsxs: (type, props, key) => ({ type, props: props ?? {}, key }) },
    "react-native": { View: "View", Pressable: "Pressable", ActivityIndicator: "ActivityIndicator", StyleSheet: { create: (value) => value }, Share: { share: async () => {} }, Linking: { openURL: async () => {} }, Alert: { alert() {} } },
    "@/components/ui/AppText": { Text: "Text" },
    "expo-crypto": { randomUUID: () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++uuid).padStart(12, "0")}` },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "expo-router": { useLocalSearchParams: () => ({ url: "https://hanbang.ai/price" }), router: { back() {}, dismissTo() {}, replace: (path) => redirects.push(path) } },
    "lucide-react-native": { ArrowLeft: "ArrowLeft", Share2: "Share2" },
    "react-native-webview": { WebView: "WebView" },
    "@hanbang/design-tokens": { colors: tokens },
    "@/lib/api": { apiFetchForWebBridge: (...args) => { calls.push(args); return replies.shift() ?? Promise.resolve(new Response("{}", { headers: { "content-type": "application/json" } })); } },
    "@/lib/supabase": { supabase: { auth: {
      getSession: () => sessionReads.shift() ?? Promise.resolve({ data: { session: liveOwner ? { user: { id: liveOwner }, access_token: `token-${liveOwner}` } : null } }),
      onAuthStateChange: (listener) => {
      listeners.add(listener);
      return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } };
    } } } },
    "@/lib/amoraPreparationSource": { preparationNavigation: () => null },
    "@/lib/mobileWebApiBridge.mjs": bridge,
    "@/lib/siteUrl.mjs": siteUrl,
    "@/lib/webviewUnsavedWork.mjs": unsaved,
    "@/lib/webviewShare.mjs": sharing,
    "@/lib/checklistCategoryParam": { checklistCategoryFromSearch: () => null, checklistRoute: () => "/checklist" },
  };
  if (realApi) {
    const apiModule = { exports: {} };
    const apiDeps = {
      "react-native": deps["react-native"],
      "expo-router": deps["expo-router"],
      "expo/fetch": { fetch: () => { throw new Error("unexpected optional read"); } },
      "./supabase": deps["@/lib/supabase"],
      "./auth": { signOut: () => { throw new Error("unexpected signout"); } },
      "./mobileWebApiBridge.mjs": bridge,
    };
    new Function("exports", "require", "fetch", "process", apiCompiled)(apiModule.exports, (name) => {
      assert.ok(Object.hasOwn(apiDeps, name), name);
      return apiDeps[name];
    }, (...args) => {
      network.push(args);
      return Promise.resolve(new Response("{}", { headers: { "content-type": "application/json" } }));
    }, { env: { EXPO_PUBLIC_SITE_URL: "https://hanbang.ai" } });
    deps["@/lib/api"] = { apiFetchForWebBridge: (...args) => {
      calls.push(args);
      return apiModule.exports.apiFetchForWebBridge(...args);
    } };
  }
  const module = { exports: {} };
  new Function("exports", "module", "require", "__DEV__", "process", compiled)(module.exports, module, (name) => {
    assert.ok(Object.hasOwn(deps, name), `unexpected dependency: ${name}`);
    return deps[name];
  }, false, { env: { EXPO_PUBLIC_SITE_URL: "https://hanbang.ai" } });

  function walk(node, path) {
    if (Array.isArray(node)) return node.map((child, index) => walk(child, `${path}/${index}`));
    if (!node || typeof node !== "object") return node;
    const identity = `${path}:${node.key ?? ""}`;
    if (typeof node.type === "function") {
      let instance = components.get(identity);
      if (!instance) {
        instance = { slots: [], id: ++serial, index: 0 };
        components.set(identity, instance);
      }
      visited.add(identity);
      current = instance;
      instance.index = 0;
      return walk(node.type(node.props), `${identity}/render`);
    }
    if (node.type === "WebView") {
      let instance = nativeViews.get(identity);
      if (!instance) {
        instance = { id: ++serial, injectJavaScript: (script) => injections.push(script), goBack() {}, reload() {}, stopLoading() {} };
        nativeViews.set(identity, instance);
      }
      node.props.ref.current = instance;
      return { ...node, native: instance };
    }
    return { ...node, props: { ...node.props, children: walk(node.props.children, `${identity}/children`) } };
  }
  function render() {
    visited = new Set();
    const tree = walk({ type: module.exports.default, props: {} }, "root");
    for (const [identity, instance] of components) {
      if (!visited.has(identity)) {
        for (const slot of instance.slots) slot.cleanup?.();
        components.delete(identity);
      } else {
        for (const slot of instance.slots) {
          if (slot.next) {
            slot.cleanup?.();
            slot.cleanup = slot.next();
            delete slot.next;
          }
        }
      }
    }
    function find(node) {
      if (Array.isArray(node)) return node.map(find).find(Boolean);
      if (!node || typeof node !== "object") return null;
      return node.type === "WebView" ? node : find(node.props.children);
    }
    return find(tree);
  }
  function emit(event, owner) {
    liveOwner = owner;
    for (const listener of listeners) {
      assert.equal(listener(event, owner ? { user: { id: owner }, access_token: "must-never-enter-document" } : null), undefined);
    }
  }
  function message(view, id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", request = {}) {
    const nonce = /const nonce="([^"]+)"/.exec(view.props.injectedJavaScript)[1];
    return view.props.onMessage({ nativeEvent: {
      url: "https://hanbang.ai/price",
      data: JSON.stringify({ protocol: bridge.MOBILE_WEB_API_PROTOCOL, nonce, id, documentUrl: "https://hanbang.ai/price", path: "/api/favorites", method: "GET", ...request }),
    } });
  }
  render();
  emit("INITIAL_SESSION", OWNER_A);
  return {
    render, emit, message, calls, replies, injections, redirects, network,
    delaySession: () => {
      let resolve;
      sessionReads.push(new Promise((done) => { resolve = done; }));
      return (token = "new-token", owner = liveOwner) => resolve({ data: { session: owner ? { user: { id: owner }, access_token: token } : null } });
    },
    unmount: () => { for (const instance of components.values()) for (const slot of instance.slots) slot.cleanup?.(); },
  };
}

for (const [label, owners, status] of [
  ["A→B", [OWNER_B], 200], ["A→null", [null], 200], ["A→B→A", [OWNER_B, OWNER_A], 200],
  ["A→B", [OWNER_B], 401], ["A→null", [null], 401], ["A→B→A", [OWNER_B, OWNER_A], 401],
]) {
  test(`${label} rejects old messages and ${status} responses, then replaces the private document`, async () => {
    const screen = createScreen();
    const before = screen.render();
    before.native.privateRows = ["account-A-only"];
    let resolve;
    screen.replies.push(new Promise((done) => { resolve = done; }));
    const pending = screen.message(before);
    await Promise.resolve();
    assert.equal(screen.calls.length, 1);
    for (const owner of owners) screen.emit(owner ? "SIGNED_IN" : "SIGNED_OUT", owner);
    await screen.message(before, "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    assert.equal(screen.calls.length, 1, "stale document must not send a request after the auth event");
    resolve(new Response('{"private":"A"}', { status, headers: { "content-type": "application/json" } }));
    await pending;
    assert.equal(screen.injections.length, 0);
    assert.equal(screen.redirects.length, 0, "an old 401 cannot redirect the new account");
    const after = screen.render();
    assert.notEqual(after.native.id, before.native.id);
    assert.equal(after.native.privateRows, undefined);
    assert.notEqual(after.props.injectedJavaScript, before.props.injectedJavaScript);
    assert.doesNotMatch(after.props.injectedJavaScript, /must-never-enter-document/);
    if (owners.at(-1)) {
      await screen.message(after);
      assert.equal(screen.calls.length, 2, "the new document can request its own private data");
      assert.equal(screen.injections.length, 1);
    }
    screen.unmount();
  });
}

test("same-owner token refresh preserves the document and its pending response", async () => {
  const screen = createScreen();
  const before = screen.render();
  let resolve;
  screen.replies.push(new Promise((done) => { resolve = done; }));
  const pending = screen.message(before);
  await Promise.resolve();
  screen.emit("TOKEN_REFRESHED", OWNER_A);
  screen.emit("SIGNED_IN", OWNER_A);
  const after = screen.render();
  assert.equal(after.native.id, before.native.id);
  assert.equal(after.props.injectedJavaScript, before.props.injectedJavaScript);
  resolve(new Response("{}", { headers: { "content-type": "application/json" } }));
  await pending;
  assert.equal(screen.injections.length, 1);
  screen.unmount();
});

test("full navigation and unmount both discard pending private responses", async () => {
  for (const exit of ["navigate", "unmount"]) {
    const screen = createScreen();
    const view = screen.render();
    let resolve;
    screen.replies.push(new Promise((done) => { resolve = done; }));
    const pending = screen.message(view);
    await Promise.resolve();
    if (exit === "navigate") view.props.onLoadStart();
    else screen.unmount();
    resolve(new Response("{}", { headers: { "content-type": "application/json" } }));
    await pending;
    assert.equal(screen.injections.length, 0, exit);
    screen.unmount();
  }
});

for (const [label, owners] of [["A→B", [OWNER_B]], ["A→null", [null]], ["A→B→A", [OWNER_B, OWNER_A]]]) {
  test(`${label} during the real API getSession never sends a legacy mutation using the later session`, async () => {
    const screen = createScreen({ realApi: true });
    const view = screen.render();
    const release = screen.delaySession();
    const pending = screen.message(view, undefined, { path: "/api/price/alerts", method: "POST", body: '{"vendorId":"legacy"}' });
    await Promise.resolve();
    assert.equal(screen.calls.length, 1);
    for (const owner of owners) screen.emit(owner ? "SIGNED_IN" : "SIGNED_OUT", owner);
    release();
    await pending;
    assert.equal(screen.network.length, 0);
    assert.equal(screen.injections.length, 0);
    screen.unmount();
  });
}

test("same-owner refresh during getSession can send the request with the refreshed token", async () => {
  const screen = createScreen({ realApi: true });
  const view = screen.render();
  const release = screen.delaySession();
  const pending = screen.message(view);
  await Promise.resolve();
  screen.emit("TOKEN_REFRESHED", OWNER_A);
  release("refreshed-A");
  await pending;
  assert.equal(screen.network.length, 1);
  assert.equal(screen.network[0][1].headers.Authorization, "Bearer refreshed-A");
  assert.equal(screen.injections.length, 1);
  screen.unmount();
});

test("the API also checks the expected owner when getSession changes before the auth notification arrives", async () => {
  const screen = createScreen({ realApi: true });
  const view = screen.render();
  const release = screen.delaySession();
  const pending = screen.message(view, undefined, { path: "/api/price/alerts", method: "POST", body: "{}" });
  await Promise.resolve();
  release("token-B", OWNER_B);
  await pending;
  assert.equal(screen.network.length, 0);
  assert.equal(screen.injections.length, 1);
  assert.match(screen.injections[0], /"status":503/);
  screen.unmount();
});

test("a guest document returns the native login response without borrowing a session", async () => {
  const screen = createScreen({ realApi: true });
  screen.emit("SIGNED_OUT", null);
  const view = screen.render();
  await screen.message(view);
  assert.equal(screen.network.length, 0);
  assert.equal(screen.injections.length, 1);
  assert.match(screen.injections[0], /"status":401/);
  assert.equal(screen.redirects.length, 1);
  screen.unmount();
});
