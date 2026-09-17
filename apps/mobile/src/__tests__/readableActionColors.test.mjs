import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
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

/*
 * ── 읽는 글자·아이콘 (2026-09-17 두 번째) ───────────────────────────────
 *
 * #417 은 버튼·선택 글자만 고쳤다. 같은 날 다시 재 보니 앱에 378곳이 더 남아 있었다.
 * 대부분 **토큰 하나가 글자로 쓰일 수 없는 색**인데 글자로 쓰인 경우였다:
 * - `textTertiary` 는 흰 카드에서 4.74 지만 앱 기본 바탕(`colors.bg`)에서 4.48, ivory[100] 에서 4.23.
 * - `taupe[400]` 2.28 · `rose[500]` 3.67 · `danger` 3.65 · `success`(sage 500) 4.23 · `gold` 2.69.
 * - `rose[600]` 은 흰 카드에서는 되지만 ivory[100]·warm·blush 에서 무너진다(DESIGN.md: 모브 글자는 rose[700]).
 * 글자는 잉크 단계(inkFaint)·rose[700]·dangerDeep·paper.tapeInk(골드·경고)로 옮겼다. 토큰 값은 그대로다.
 */

/** 앱이 실제로 쓰는 밝은 지면. */
const LIGHT_SURFACES = {
  surface: colors.surface,
  bg: colors.bg,
  sheet: colors.paper.sheet,
  "ivory[100]": colors.ivory[100],
  "ivory[200]": colors.ivory[200],
  warm: colors.ivory.warm,
  blush: colors.ivory.blush,
  "rose.pale": colors.rose.pale,
};

/** 테스트를 뺀 앱 화면·컴포넌트 전부 — 주석은 걷어낸다. */
function allSources() {
  const out = [];
  const walk = (relDir) => {
    for (const name of readdirSync(fileURLToPath(new URL(`../../${relDir}/`, import.meta.url)))) {
      if (name === "__tests__" || name === "node_modules") continue;
      const rel = `${relDir}/${name}`;
      if (statSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url))).isDirectory()) walk(rel);
      else if (/\.tsx$/.test(name)) out.push([rel, source(rel)]);
    }
  };
  walk("app");
  walk("src");
  assert.ok(out.length > 80, `앱 소스를 못 읽었다(${out.length}개) — 경로가 틀어지면 이 검사는 빈 목록으로 통과한다`);
  return out;
}

function findAll(pattern) {
  const hits = [];
  for (const [file, code] of allSources()) {
    for (const match of code.matchAll(pattern)) hits.push(`${file}: ${match[0]}`);
  }
  return hits;
}

/** `colors.a.b` · `colors.a[500]` 을 값으로. */
function tokenValue(expression) {
  const path = expression.replace(/^colors/, "").match(/\.\w+|\[\d+\]/g) ?? [];
  const value = path.reduce((node, part) => node?.[part.replace(/^\.|^\[|\]$/g, "")], colors);
  assert.equal(typeof value, "string", `토큰이 아니다: ${expression}`);
  return value;
}

/** 스타일 한 덩어리의 `color:` 값. */
function styleColor(block) {
  const match = /\bcolor: (colors(?:\.\w+|\[\d+\])+)/.exec(block);
  assert.ok(match, `글자색이 없다: ${block}`);
  return tokenValue(match[1]);
}

function channels(hex) {
  return [0, 2, 4].map((offset) => parseInt(hex.slice(1 + offset, 3 + offset), 16));
}
/** 불투명 바탕 위에 알파를 섞은 색. */
function over(rgba, bg) {
  const match = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(rgba.replace(/\s+/g, " "));
  assert.ok(match, `rgba 가 아니다: ${rgba}`);
  const alpha = Number(match[4]);
  const base = channels(bg);
  return `#${[1, 2, 3]
    .map((i, k) => Math.round(Number(match[i]) * alpha + base[k] * (1 - alpha)).toString(16).padStart(2, "0"))
    .join("")}`;
}

test("읽는 글자에 흐린 토큰을 쓰지 않는다", () => {
  const dim = {
    textTertiary: colors.textTertiary,
    "taupe[400]": colors.taupe[400],
    "rose[500]": colors.rose[500],
    "rose[600]": colors.rose[600],
    danger: colors.danger,
    success: colors.success,
    "sage[500]": colors.sage[500],
    "gold.DEFAULT": colors.gold.DEFAULT,
    warning: colors.warning,
  };
  for (const [name, hex] of Object.entries(dim)) {
    const failing = Object.entries(LIGHT_SURFACES).filter(([, bg]) => contrast(hex, bg) < 4.5);
    assert.ok(failing.length > 0, `${name} 이 모든 지면에서 4.5:1 을 넘는다면 이 금지는 틀렸다`);
  }
  // 옮겨 간 글자색은 모든 밝은 지면에서 통과한다.
  for (const [name, hex] of Object.entries({
    "paper.inkFaint": colors.paper.inkFaint,
    "rose[700]": colors.rose[700],
    dangerDeep: colors.dangerDeep,
    "paper.tapeInk": colors.paper.tapeInk,
  })) {
    for (const [surface, bg] of Object.entries(LIGHT_SURFACES)) {
      assert.ok(contrast(hex, bg) >= 4.5, `${name} on ${surface} = ${contrast(hex, bg).toFixed(2)}`);
    }
  }
  // 소문자 `color:` 만 — backgroundColor·borderColor·tabBar…TintColor 는 글자가 아니다.
  // 끝은 `\b` 로 두지 않는다: `]` 뒤에는 단어 경계가 없어 `rose[500],` 을 놓친다.
  const hits = findAll(
    /\bcolor: ?colors\.(?:textTertiary|taupe\[400\]|rose\[500\]|rose\[600\]|danger|success|sage\[500\]|gold\.DEFAULT|warning)(?![\w.[])/g,
  );
  assert.deepEqual(hits, []);
});

test("입력창 자리표시 글자도 읽는 글자다", () => {
  assert.ok(contrast(colors.taupe[400], colors.surface) < 4.5);
  assert.ok(contrast(colors.textTertiary, colors.bg) < 4.5);
  assert.deepEqual(findAll(/placeholderTextColor=\{colors\.(?:taupe\[400\]|textTertiary)\}/g), []);
});

test("의미를 가진 아이콘은 3:1 을 넘는다 — taupe[400] 대신 textTertiary", () => {
  assert.ok(contrast(colors.taupe[400], colors.surface) < 3, "taupe[400] 이 3:1 을 넘는다면 이 금지는 틀렸다");
  for (const [surface, bg] of Object.entries(LIGHT_SURFACES)) {
    assert.ok(contrast(colors.textTertiary, bg) >= 3, `textTertiary on ${surface}`);
  }
  // `thumbColor=` 같은 컨트롤 부품은 대문자 C 라 걸리지 않는다.
  assert.deepEqual(findAll(/\bcolor=\{[^}]*colors\.taupe\[400\]/g), []);
  // 커뮤니티 글의 투표 아이콘(선택 안 됨)
  assert.match(source("app/community/post/[id].tsx"), /color=\{userVote === 1 \? colors\.rose\[700\] : colors\.textTertiary\}/);
});

test("설정의 회원 탈퇴는 짙은 위험색이고, 눌림을 투명도로 나타내지 않는다", () => {
  const settings = source("app/settings/index.tsx");
  assert.equal(styleColor(styleBlock(settings, "dangerBtnText")), colors.dangerDeep);
  assert.match(settings, /<Trash2 size=\{16\} color=\{colors\.dangerDeep\}\s*\/>/);
  assert.match(settings, /pressed && styles\.dangerBtnPressed/);
  assert.doesNotMatch(settings, /styles\.dangerBtn, pressed && \{ opacity/);
  const tint = over("rgba(239, 68, 68, 0.12)", colors.bg);
  assert.ok(contrast(colors.dangerDeep, tint) >= 4.5);
  assert.ok(contrast(colors.danger, colors.bg) < 4.5, "danger 가 통과한다면 이 검사의 전제가 틀렸다");
});

test("어두운 면 위의 글자는 밝은 단계를 쓴다 — 흐린 토큰을 일괄로 옮기며 어두워지지 않았다", () => {
  const profile = source("app/(tabs)/profile.tsx");
  const dark = tokenValue(/backgroundColor: (colors(?:\.\w+|\[\d+\])+)/.exec(styleBlock(profile, "heroSection"))[1]);
  assert.equal(dark, colors.noir[800], "내 정보 머리 면이 바뀌면 아래 대비를 다시 재야 한다");
  const card = over("rgba(255, 255, 255, 0.08)", dark);
  assert.match(styleBlock(profile, "ddayContainer"), /backgroundColor: "rgba\(255, 255, 255, 0\.08\)"/);
  const badge = over("rgba(167, 123, 116, 0.16)", dark);
  assert.equal(colors.rose.glow.replace(/\s+/g, " "), "rgba(167, 123, 116, 0.16)");
  for (const [name, bg, min] of [
    ["email", dark, 4.5],
    ["partnerText", dark, 4.5],
    ["roleBadgeText", badge, 4.5],
    ["ddaySubtext", card, 4.5],
    ["ddayNumber", card, 3], // 28px 숫자
  ]) {
    const ratio = contrast(styleColor(styleBlock(profile, name)), bg);
    assert.ok(ratio >= min, `profile ${name} = ${ratio.toFixed(2)}`);
  }
  assert.match(profile, /<Heart size=\{12\} color=\{colors\.rose\.light\}\s*\/>/);
  assert.ok(contrast(colors.rose.light, dark) >= 3);

  const guide = source("src/components/AppGuide.tsx");
  assert.match(styleBlock(guide, "homeDdayCard"), /backgroundColor: colors\.noir\[800\]/);
  for (const name of ["homeDdayLabel", "homeDdayDate", "homeProgressText"]) {
    const ratio = contrast(styleColor(styleBlock(guide, name)), colors.noir[800]);
    assert.ok(ratio >= 4.5, `AppGuide ${name} = ${ratio.toFixed(2)}`);
  }
});

test("동기방 아바타 색은 흰 이니셜과 닉네임 글자 양쪽에서 읽힌다", () => {
  const cohort = source("app/community/cohort/[id].tsx");
  const list = /const AVATAR_COLORS = \[([^\]]*(?:\[[^\]]*\][^\]]*)*)\];/.exec(cohort);
  assert.ok(list, "AVATAR_COLORS 를 못 찾았다");
  const entries = list[1].split(",").map((part) => part.trim()).filter(Boolean);
  assert.ok(entries.length >= 6, `아바타 색이 너무 적다: ${entries.length}`);
  for (const expression of entries) {
    const hex = tokenValue(expression);
    assert.ok(contrast("#FFFFFF", hex) >= 4.5, `흰 이니셜 on ${expression}`);
    assert.ok(contrast(hex, colors.bg) >= 4.5, `닉네임 ${expression} on bg`);
  }
  assert.match(cohort, /\{ color: isAi \? colors\.paper\.tapeInk : avatarBg \}/);
  assert.ok(contrast(styleColor(styleBlock(cohort, "avatarTextAi")), colors.noir[800]) >= 4.5);
});

test("상태 알약 글자는 자기 알약 바탕 위에서 읽힌다", () => {
  const ui = source("src/components/ui/AppUI.tsx");
  const pills = sheet(ui, "pillStyles");
  const texts = sheet(ui, "pillTextStyles");
  for (const tone of ["neutral", "rose", "success", "warning", "danger"]) {
    // rgba 안에도 쉼표가 있으니 줄 끝까지 읽는다.
    const bgExpression = /backgroundColor: (.+?),?[ \t]*$/m.exec(styleBlock(pills, tone))[1].trim();
    const raw = bgExpression.startsWith("colors") ? tokenValue(bgExpression) : JSON.parse(bgExpression);
    const textBlock = styleBlock(texts, tone);
    const textHex = /color: "(#[0-9A-Fa-f]{6})"/.exec(textBlock)?.[1] ?? styleColor(textBlock);
    for (const [surface, base] of [["surface", colors.surface], ["bg", colors.bg]]) {
      const bg = raw.startsWith("rgba") ? over(raw, base) : raw;
      const ratio = contrast(textHex, bg);
      assert.ok(ratio >= 4.5, `${tone} pill on ${surface} = ${ratio.toFixed(2)}`);
    }
  }
});
