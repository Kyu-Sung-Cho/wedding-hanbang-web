import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { dirname, resolve } from "node:path";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

function compile(file, require) {
  const source = readFileSync(file, "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", "require", output)(module, module.exports, require);
  return module.exports;
}
const fontFile = fileURLToPath(new URL("../lib/appFonts.ts", import.meta.url));
const fonts = compile(fontFile, name => {
  const asset = resolve(dirname(fontFile), name);
  assert.equal(readFileSync(asset).readUInt32BE(0), 0x00010000, `Missing or invalid TrueType asset: ${name}`);
  return asset;
});
const flatten = style => Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : style || {};

function renderer(platform) {
  const calls = [];
  const native = type => React.forwardRef((props, ref) => {
    calls.push({ type, ...props, ref, effectiveStyle: flatten(props.style) });
    return jsxRuntime.jsx("span", { children: props.children });
  });
  const module = compile(new URL("../components/ui/AppText.tsx", import.meta.url), name => {
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return jsxRuntime;
    if (name === "react-native") return { Platform: { OS: platform }, StyleSheet: { flatten }, Text: native("Text"), TextInput: native("TextInput") };
    if (name === "../../lib/appFonts") return fonts;
    throw new Error(`Unexpected import: ${name}`);
  });
  return { ...module, calls, render: (loaded, children) => renderToStaticMarkup(jsxRuntime.jsx(module.AppFontProvider, { loaded, children })) };
}

test("every native product font alias resolves to a registered face, with one asset per weight", () => {
  assert.equal(Object.keys(fonts.appFonts).length, 9);
  assert.equal(new Set(Object.values(fonts.appFonts)).size, 9);
  const appRoot = fileURLToPath(new URL("../../", import.meta.url));
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = resolve(directory, entry.name);
      if (entry.isDirectory()) { if (entry.name !== "__tests__") visit(file); continue; }
      if (!/\.tsx?$/.test(file)) continue;
      const source = readFileSync(file, "utf8");
      const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      function walk(node) {
        if (ts.isPropertyAssignment(node) && node.name.getText(ast) === "fontFamily" && ts.isStringLiteral(node.initializer)) {
          const family = node.initializer.text;
          if (/^(Noto|Cormorant|Pretendard)/.test(family)) {
            const result = fonts.resolveAppFont({ fontFamily: family }, true, "System");
            assert.ok(result.style.fontFamily in fonts.appFonts, `${file}: unregistered ${family}`);
          }
        }
        if (ts.isImportDeclaration(node) && node.moduleSpecifier.text === "react-native" && !file.endsWith("AppText.tsx")) {
          const entries = node.importClause?.namedBindings?.elements ?? [];
          assert.ok(entries.every(e => e.isTypeOnly || !["Text", "TextInput"].includes((e.propertyName ?? e.name).text)), `${file}: bypasses app font and failure fallback`);
        }
        ts.forEachChild(node, walk);
      }
      walk(ast);
    }
  }
  visit(resolve(appRoot, "app")); visit(resolve(appRoot, "src"));
});

test("React 19 wrappers preserve styles, refs, text scaling, accessibility and editable input props", () => {
  const ui = renderer("ios");
  const inputRef = { current: null };
  const change = () => {};
  const style = [{ fontSize: 17, color: "red" }, { fontWeight: "600", fontStyle: "italic" }];
  ui.render(true, [
    jsxRuntime.jsx(ui.Text, { style, allowFontScaling: true, maxFontSizeMultiplier: 2, accessibilityLabel: "상담 제목", selectable: true, children: "아모라" }, "text"),
    jsxRuntime.jsx(ui.TextInput, { ref: inputRef, value: "직접 쓴 질문", onChangeText: change, keyboardType: "default", multiline: true, style: { fontSize: 15 } }, "input"),
  ]);
  const [text, input] = ui.calls;
  assert.equal(text.effectiveStyle.fontFamily, "Pretendard_600SemiBold");
  assert.equal(text.effectiveStyle.fontWeight, "normal");
  assert.equal(text.effectiveStyle.fontStyle, "italic");
  assert.equal(text.effectiveStyle.color, "red");
  assert.equal(text.maxFontSizeMultiplier, 2);
  assert.equal(text.accessibilityLabel, "상담 제목");
  assert.equal(text.selectable, true);
  assert.equal(input.effectiveStyle.fontFamily, "Pretendard_400Regular");
  assert.equal(input.ref, inputRef);
  assert.equal(input.value, "직접 쓴 질문");
  assert.equal(input.onChangeText, change);
  assert.equal(input.multiline, true);
  assert.deepEqual(style, [{ fontSize: 17, color: "red" }, { fontWeight: "600", fontStyle: "italic" }]);
});

test("nested text inherits its parent's face while explicit emphasis selects the bold face", () => {
  const ui = renderer("android");
  ui.render(true, jsxRuntime.jsx(ui.Text, { style: { fontFamily: "NotoSerifKR_500Medium" }, children: [
    jsxRuntime.jsx(ui.Text, { children: "기본" }, "inherit"),
    jsxRuntime.jsx(ui.Text, { style: { fontWeight: "700" }, children: "강조" }, "bold"),
  ] }));
  assert.deepEqual(ui.calls.map(call => call.effectiveStyle.fontFamily), ["Pretendard_500Medium", "Pretendard_500Medium", "Pretendard_700Bold"]);
});

test("failed font loading uses platform fonts and preserves emphasis without exposing unloaded aliases", () => {
  for (const [platform, fallback] of [["ios", "System"], ["android", "sans-serif"], ["web", "system-ui"]]) {
    const ui = renderer(platform);
    ui.render(false, jsxRuntime.jsx(ui.Text, { style: { fontFamily: "NotoSansKR_600SemiBold" }, children: "안내" }));
    assert.equal(ui.calls[0].effectiveStyle.fontFamily, fallback);
    assert.equal(ui.calls[0].effectiveStyle.fontWeight, 600);
  }
  assert.deepEqual(fonts.resolveAppFont({ fontFamily: "monospace", fontWeight: "700" }, false, "System").style, { fontFamily: "monospace" });
  assert.deepEqual(fonts.resolveAppFont({ fontFamily: "FontAwesome" }, true, "System").style, { fontFamily: "FontAwesome" });
});
