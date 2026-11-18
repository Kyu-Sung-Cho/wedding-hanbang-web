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
  // 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해): 청첩장 화면 글꼴 아홉 면을 더했다
  // (고운바탕 400·700, Cormorant Garamond 400·500·기울임 400·500, Noto Sans KR 400·500·700).
  // 기존 화면의 `NotoSansKR_*`·`CormorantGaramond_*` 이름은 그대로 Pretendard 로 바뀌고, 새 면은
  // 겹치지 않게 `Inv` 이름으로 새 청첩장 화면에서만 쓴다. 9 + 9 = 18.
  assert.equal(Object.keys(fonts.appFonts).length, 18);
  assert.equal(new Set(Object.values(fonts.appFonts)).size, 18);
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
          if (/^(Noto|Cormorant|Pretendard|Inv)/.test(family)) {
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

// ── 청첩장 디자인 글꼴(2026-11-17 파운더 디자인 아티팩트, 원문: 이 디자인 완전 같아야해) ──────────
// 면마다 따로 등록한 정적 글꼴이다. 안드로이드는 굵기·기울임을 다시 주면 등록한 면(NORMAL) 대신 시스템
// 글꼴을 고른다(ReactFontManager.createAssetTypeface). 그래서 불러왔을 때는 굵기·기울임을 normal 로 두고
// 면 이름이 굵기와 기울임을 대신 고른다.

test("invitation faces resolve to their own static face, never to Pretendard", () => {
  const names = Object.values(fonts.invitationFonts);
  assert.equal(names.length, 9);
  for (const name of names) {
    assert.ok(Object.hasOwn(fonts.appFonts, name), `${name} is not registered`);
    assert.deepEqual(fonts.resolveAppFont({ fontFamily: name }, true, "System").style, {
      fontFamily: name, fontWeight: "normal", fontStyle: "normal",
    });
  }
  // 기존 화면의 옛 이름은 바뀌지 않는다.
  assert.equal(fonts.resolveAppFont({ fontFamily: "NotoSansKR_700Bold" }, true, "System").style.fontFamily, "Pretendard_700Bold");
  assert.equal(fonts.resolveAppFont({ fontFamily: "CormorantGaramond_400Regular" }, true, "System").style.fontFamily, "Pretendard_400Regular");
});

test("an invitation family plus a weight or slant picks the nearest face of that family", () => {
  const face = (style) => fonts.resolveAppFont(style, true, "System").style.fontFamily;
  const inv = fonts.invitationFonts;
  assert.equal(face({ fontFamily: inv.sans, fontWeight: "700" }), "InvNotoSansKR_700Bold");
  assert.equal(face({ fontFamily: inv.sans, fontWeight: "500" }), "InvNotoSansKR_500Medium");
  assert.equal(face({ fontFamily: inv.sans, fontWeight: "bold" }), "InvNotoSansKR_700Bold");
  assert.equal(face({ fontFamily: inv.serif, fontWeight: "700" }), "InvGowunBatang_700Bold");
  assert.equal(face({ fontFamily: inv.serif, fontWeight: "500" }), "InvGowunBatang_400Regular");
  assert.equal(face({ fontFamily: inv.numeral, fontWeight: "500" }), "InvCormorantGaramond_500Medium");
  assert.equal(face({ fontFamily: inv.numeral, fontWeight: "500", fontStyle: "italic" }), "InvCormorantGaramond_500Medium_Italic");
  assert.equal(face({ fontFamily: inv.numeralItalic, fontStyle: "normal" }), "InvCormorantGaramond_400Regular");
  // 기울임 면이 없는 본문 글꼴은 바로 선 면을 쓰고, 기울임을 합성하지 않는다.
  assert.deepEqual(fonts.resolveAppFont({ fontFamily: inv.sans, fontStyle: "italic" }, true, "System").style, {
    fontFamily: "InvNotoSansKR_400Regular", fontWeight: "normal", fontStyle: "normal",
  });
});

test("nested invitation text inherits the parent face and explicit emphasis selects the bold face", () => {
  const ui = renderer("android");
  ui.render(true, jsxRuntime.jsx(ui.Text, { style: { fontFamily: fonts.invitationFonts.sans }, children: [
    jsxRuntime.jsx(ui.Text, { children: "기본" }, "inherit"),
    jsxRuntime.jsx(ui.Text, { style: { fontWeight: "700" }, children: "강조" }, "bold"),
  ] }));
  assert.deepEqual(ui.calls.map(call => call.effectiveStyle.fontFamily), ["InvNotoSansKR_400Regular", "InvNotoSansKR_400Regular", "InvNotoSansKR_700Bold"]);
  assert.ok(ui.calls.every(call => call.effectiveStyle.fontWeight === "normal" && call.effectiveStyle.fontStyle === "normal"));
});

test("failed loading draws invitation text in the platform font with the face's weight and slant", () => {
  for (const [platform, fallback] of [["ios", "System"], ["android", "sans-serif"], ["web", "system-ui"]]) {
    const ui = renderer(platform);
    ui.render(false, jsxRuntime.jsx(ui.Text, { style: { fontFamily: fonts.invitationFonts.numeralMediumItalic }, children: "2027" }));
    assert.equal(ui.calls[0].effectiveStyle.fontFamily, fallback);
    assert.equal(ui.calls[0].effectiveStyle.fontWeight, 500);
    assert.equal(ui.calls[0].effectiveStyle.fontStyle, "italic");
  }
  assert.deepEqual(fonts.resolveAppFont({ fontFamily: fonts.invitationFonts.serifBold }, false, "System").style, {
    fontFamily: "System", fontWeight: 700, fontStyle: "normal",
  });
});
