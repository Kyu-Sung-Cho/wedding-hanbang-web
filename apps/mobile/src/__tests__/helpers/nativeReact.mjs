import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, URL } from "node:url";
import path from "node:path";
import ts from "typescript";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { createRoot } from "react-dom/client";
const webRequire = createRequire(new URL("../../../../web/package.json", import.meta.url));
const { JSDOM } = webRequire("jsdom");
const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const src = fileURLToPath(new URL("../../", import.meta.url));
const host = tag => ({ children, accessibilityRole, accessibilityLabel, onPress, disabled, refreshControl }) =>
  React.createElement(tag, { role: accessibilityRole === "summary" ? "status" : accessibilityRole,
    "aria-label": accessibilityLabel, onClick: onPress, disabled }, refreshControl, children);
const native = {
  View: host("div"), Text: host("span"), TextInput: host("input"), Pressable: host("button"), ScrollView: host("div"),
  ActivityIndicator: () => React.createElement("span", { role: "progressbar" }),
  Switch: ({ value, onValueChange, accessibilityLabel, disabled }) => React.createElement("button", {
    role: "switch", "aria-checked": value, "aria-label": accessibilityLabel, disabled, onClick: () => onValueChange(!value),
  }),
  RefreshControl: ({ onRefresh }) => React.createElement("button", { onClick: onRefresh }, "당겨 새로고침"),
  StyleSheet: { create: value => value, flatten: value => Array.isArray(value) ? Object.assign({}, ...value) : value },
  Platform: { OS: "web" }, Alert: { alert() {} }, Linking: { openURL: async () => {} },
};
export function createLoader(overrides = {}) {
  const cache = new Map();
  const dependencies = {
    react: React, "react/jsx-runtime": jsx, "react-native": native,
    "react-native-safe-area-context": { SafeAreaView: native.View },
    "lucide-react-native": new Proxy({}, { get: (_, name) => () => React.createElement("i", { "data-icon": name }) }),
    ...overrides,
  };
  const load = file => {
    file = path.resolve(file);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    new Function("module", "exports", "require", "__DEV__", code)(module, module.exports, key => {
      if (/\.(ttf|woff2?)$/.test(key)) return key;
      if (key in dependencies) return dependencies[key];
      let resolved = key.startsWith("@/") ? path.join(src, key.slice(2))
        : key.startsWith(".") ? path.resolve(path.dirname(file), key)
          : key === "@hanbang/design-tokens" ? path.resolve(src, "../../../packages/design-tokens/src/index.ts")
            : key === "@hanbang/shared" ? path.resolve(src, "../../../packages/shared/src/contracts/amoraDecisionReceipt.ts") : null;
      assert.ok(resolved, `Unexpected dependency ${key}`);
      if (!existsSync(resolved)) resolved = [".ts", ".tsx", ".mjs"].map(ext => resolved + ext).find(existsSync);
      assert.ok(resolved, `Missing module ${key}`);
      return load(resolved);
    }, true);
    return module.exports;
  };
  return relative => load(path.resolve(src, relative));
}
export const act = React.act;
export async function mount(Component, props = {}) {
  const container = globalThis.document.createElement("div"); globalThis.document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(Component, props)));
  return { container, async close() { await act(async () => root.unmount()); container.remove(); } };
}
export async function press(container, label) {
  const button = [...container.querySelectorAll("button")].find(node => node.textContent === label || node.getAttribute("aria-label") === label);
  assert.ok(button, `Missing control: ${label}`);
  await act(async () => button.click());
}
export function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
