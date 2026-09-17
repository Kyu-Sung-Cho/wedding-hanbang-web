import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

/**
 * 앱의 채운 버튼과 선택 글자가 읽히는가.
 *
 * 2026-09-16 OTA 뒤 파운더가 "버튼 글자 잘 안 보여"라고 했다. 재 보니 앱의 주 버튼
 * (`PrimaryButton tone="rose"` 13곳, 일정 저장, 초대 공유, 오류 화면)이 `rose[500]` 위 흰
 * 글자로 3.67:1 이었고, 하단 탭의 선택 안 된 글자는 `taupe[400]` 2.28:1 이었다.
 * 웹 공용 버튼은 이미 DESIGN.md 대로 `rose[600]` 을 쓰고 있었다 — 앱만 따르지 않았다.
 *
 * 규칙(DESIGN.md "누를 수 있는 면은 더스티 모브" · "Warm interactions"):
 * - 채움은 rose[600], 눌림은 rose[700]. 흰 글자 4.95 · 6.25.
 * - 모브를 글자로 쓸 때는 rose[700]. 선택 면은 rose.pale.
 * - 눌림을 투명도로 나타내지 않는다 — 안드로이드는 투명도를 바탕과 글자에 따로 적용한다.
 */
function load(relative) {
  const path = fileURLToPath(new URL(relative, import.meta.url));
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  new Function("exports", "module", "require", compiled.outputText)(module.exports, module, () => {
    throw new Error("colors.ts 는 의존성이 없어야 한다");
  });
  return module.exports;
}

/** 주석을 걷어낸 소스 — 왜 바꿨는지 적은 주석이 검사에 걸리지 않게. */
function source(relative) {
  const path = fileURLToPath(new URL(`../../${relative}`, import.meta.url));
  return ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: "screen.tsx",
    compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2022, removeComments: true },
  }).outputText;
}

/** `name: { ... }` 스타일 한 덩어리. 한 줄이든 여러 줄이든 짝이 맞는 중괄호까지. */
function styleBlock(code, name) {
  const start = code.search(new RegExp(`\\b${name}:\\s*\\{`));
  assert.ok(start >= 0, `${name} 스타일이 없다`);
  let depth = 0;
  for (let i = code.indexOf("{", start); i < code.length; i += 1) {
    if (code[i] === "{") depth += 1;
    if (code[i] === "}") depth -= 1;
    if (depth === 0) return code.slice(start, i + 1);
  }
  throw new Error(`${name} 스타일이 닫히지 않았다`);
}

/** `const name = StyleSheet.create({ ... })` 의 본문. 같은 파일에 같은 이름의 스타일이 여럿일 때 쓴다. */
function sheet(code, name) {
  const start = code.indexOf(`${name} = StyleSheet.create(`);
  assert.ok(start >= 0, `${name} 스타일시트가 없다`);
  return styleBlock(`${name}: ${code.slice(code.indexOf("{", start))}`, name);
}

const { colors } = load("../../../../packages/design-tokens/src/colors.ts");

function luminance(hex) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  assert.ok(match, `불투명 6자리 색이어야 한다: ${hex}`);
  const [r, g, b] = [0, 2, 4]
    .map((offset) => parseInt(match[1].slice(offset, offset + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test("채움 규칙의 전제: rose[600]·rose[700] 위 흰 글자는 통과하고 rose[500] 은 못 넘는다", () => {
  assert.ok(contrast("#FFFFFF", colors.rose[600]) >= 4.5);
  assert.ok(contrast("#FFFFFF", colors.rose[700]) >= 4.5);
  assert.ok(contrast("#FFFFFF", colors.rose[500]) < 4.5, "rose[500] 이 통과한다면 이 검사의 전제가 틀렸다");
});

test("공용 주 버튼은 rose[600] 으로 채우고, 눌림은 불투명 rose[700] 이다", () => {
  const ui = source("src/components/ui/AppUI.tsx");
  // 이 파일에는 면·배지·버튼에 각각 `rose` 스타일이 있다 — 버튼 것만 본다.
  const buttons = sheet(ui, "buttonStyles");
  assert.match(styleBlock(buttons, "rose"), /backgroundColor: colors\.rose\[600\]/);
  const pressed = styleBlock(buttons, "rosePressed");
  assert.match(pressed, /backgroundColor: colors\.rose\[700\]/);
  assert.match(pressed, /opacity: 1/, "눌림을 투명도로 두면 안드로이드에서 흰 글자가 3.8:1 로 흐려진다");
  assert.match(ui, /pressed && tone === "rose" && buttonStyles\.rosePressed/);
});

test("다른 채운 버튼도 rose[500] 위에 흰 글자를 두지 않는다", () => {
  for (const [file, name] of [
    ["app/schedule/index.tsx", "saveBtn"],
    ["src/components/invite/InviteCodeCard.tsx", "shareButton"],
    ["src/components/ErrorBoundary.tsx", "button"],
  ]) {
    assert.match(styleBlock(source(file), name), /backgroundColor: colors\.rose\[600\]/, `${file} ${name}`);
  }
  assert.match(styleBlock(source("app/schedule/index.tsx"), "saveBtnPressed"), /colors\.rose\[700\]/);
  assert.match(source("app/schedule/index.tsx"), /pressed && styles\.saveBtnPressed/);
  const invite = source("src/components/invite/InviteCodeCard.tsx");
  assert.match(styleBlock(invite, "shareButtonPressed"), /opacity: 1/);
  assert.match(invite, /pressed && styles\.shareButtonPressed/);
});

test("하단 탭: 선택은 연한 면 위 rose[700], 선택 안 된 탭은 잉크 단계", () => {
  const tabs = source("app/(tabs)/_layout.tsx");
  assert.match(tabs, /tabBarActiveTintColor: colors\.rose\[700\]/);
  assert.match(tabs, /tabBarActiveBackgroundColor: colors\.rose\.pale/, "색만으로 선택을 구분하지 않는다");
  assert.match(tabs, /tabBarInactiveTintColor: colors\.paper\.inkFaint/);
  assert.ok(contrast(colors.rose[700], colors.rose.pale) >= 4.5);
  assert.ok(contrast(colors.paper.inkFaint, colors.surface) >= 4.5);
});

test("선택된 글자는 rose[500] 이 아니라 rose[700] 이다", () => {
  for (const [file, name] of [
    ["app/(tabs)/chat.tsx", "scopeTextActive"],
    ["app/(tabs)/chat.tsx", "targetTextPartner"],
    ["app/community/post/write.tsx", "tabTextActive"],
    ["app/community/quick-review.tsx", "adChipTextActive"],
    ["app/onboarding/index.tsx", "roleLabelActive"],
    ["app/onboarding/index.tsx", "optionTitleActive"],
    ["app/onboarding/index.tsx", "prefLabelActive"],
    ["app/onboarding/index.tsx", "stageLabelActive"],
    ["src/components/onboarding/PreparationProgressList.tsx", "statusChipLabelActive"],
    ["app/community/decision/write.tsx", "choiceTextSelected"],
    ["app/community/decision/[id].tsx", "choiceTextSelected"],
  ]) {
    assert.match(styleBlock(source(file), name), /color: colors\.rose\[700\]/, `${file} ${name}`);
  }
  // 가장 옅은 선택 면(rose.glow 를 종이 위에 섞은 색)에서도 통과한다.
  assert.ok(contrast(colors.rose[700], "#EEE4DE") >= 4.5);
});
