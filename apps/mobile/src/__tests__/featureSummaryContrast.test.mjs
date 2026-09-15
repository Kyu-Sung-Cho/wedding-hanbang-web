import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

/**
 * 기능 첫 화면 요약(라운지·예산·체크리스트·예약 기록)이 웹과 같은 샴페인 요약 면을 쓰고,
 * 그 위의 글자가 전부 읽기 기준(4.5:1)을 넘는가.
 *
 * 2026-09-15 전까지 앱 네 화면은 어두운 유칼립투스 카드였고, 예산 초과 빨강 `#EF4444` 가
 * 2.23:1, 회색 라벨 `taupe[400]` 이 3.69:1 이었다. 웹은 이틀 전에 요약 토큰으로 옮겼다.
 */
function load(relative, deps = {}) {
  const path = fileURLToPath(new URL(relative, import.meta.url));
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  new Function("exports", "module", "require", compiled.outputText)(module.exports, module, (specifier) => {
    if (Object.hasOwn(deps, specifier)) return deps[specifier];
    throw new Error(`unexpected dependency: ${specifier}`);
  });
  return module.exports;
}

const { summaryPalette } = load("../../../../packages/design-tokens/src/summary.ts");
const { summaryColors, summaryPillColors } = load("../lib/featureSummaryPalette.ts", {
  "@hanbang/design-tokens": { summaryPalette },
});

function luminance(hex) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  assert.ok(match, `불투명 6자리 색이어야 대비를 잴 수 있다: ${hex}`);
  const channels = [0, 2, 4].map((offset) => parseInt(match[1].slice(offset, offset + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test("요약 면·선·글자는 웹과 같은 summaryPalette 에서 온다", () => {
  for (const key of ["surface", "line", "accent", "track", "ink", "label"]) {
    assert.equal(summaryColors[key], summaryPalette[key], key);
  }
  // 웹 요약 클래스의 대체값도 같은 팔레트다 — 한쪽만 바뀌면 두 앱의 요약이 다른 색이 된다.
  const web = readFileSync(new URL("../../../web/src/components/ui/featureSummaryStyles.ts", import.meta.url), "utf8");
  for (const key of ["surface", "line", "accent", "ink", "label", "track"]) {
    assert.ok(web.includes(`--hb-summary-${key},${summaryPalette[key]}`), `웹 ${key} 대체값`);
  }
});

test("요약 면 위의 모든 글자색이 4.5:1 이상이다", () => {
  for (const key of ["ink", "label", "danger"]) {
    const ratio = contrast(summaryColors[key], summaryColors.surface);
    assert.ok(ratio >= 4.5, `${key} ${summaryColors[key]} = ${ratio.toFixed(2)}:1`);
  }
  // 라운지 포커스 머리말은 장미 700 을 쓴다.
  assert.ok(contrast("#7D5753", summaryColors.surface) >= 4.5);
});

test("요약 안 상태 알약의 글자가 자기 바탕에서 4.5:1 이상이다", () => {
  for (const [tone, { background, text }] of Object.entries(summaryPillColors)) {
    const ratio = contrast(text, background);
    assert.ok(ratio >= 4.5, `${tone} ${text} on ${background} = ${ratio.toFixed(2)}:1`);
  }
  assert.deepEqual(Object.keys(summaryPillColors).sort(), ["danger", "neutral", "rose", "success", "warning"]);
});

test("예전 두 실패 색은 요약 팔레트에 없다", () => {
  assert.ok(contrast("#EF4444", "#36534E") < 4.5 && contrast("#B7AA9A", "#36534E") < 4.5, "기록한 실패 수치의 전제");
  const values = [...Object.values(summaryColors), ...Object.values(summaryPillColors).flatMap((pill) => [pill.text])];
  assert.ok(!values.includes("#EF4444"));
  assert.ok(!values.includes("#B7AA9A"));
});

/** 주석을 뺀 코드. 설명 주석에 적은 예전 색 이름이 검사를 흐리지 않게 한다. */
function code(relative) {
  const source = readFileSync(new URL(relative, import.meta.url), "utf8");
  return ts.transpileModule(source, {
    fileName: "screen.tsx",
    compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2022, removeComments: true },
  }).outputText;
}

/** 스타일 시트에서 `key: { … }` 한 덩어리의 `color:` 값들. */
function colorsOfStyle(screen, key) {
  const match = new RegExp(`\\b${key}: \\{([^}]*)\\}`).exec(screen);
  assert.ok(match, `스타일 ${key} 를 찾지 못했다`);
  return [...match[1].matchAll(/\bcolor: ([^,\n]+)/g)].map((m) => m[1].trim());
}

const SUMMARY_TEXT_COLOR = /^summaryColors\.(ink|label|danger)$|^colors\.rose\[700\]$/;

test("네 화면의 요약이 어두운 카드 대신 요약 면을 쓰고, 요약 글자색이 요약 팔레트에서 온다", () => {
  const schedule = code("../../app/schedule/index.tsx");
  assert.match(schedule, /<FeatureSummarySurface style=\{styles\.opsCard\}>/);
  assert.doesNotMatch(schedule, /tone="noir"/);
  for (const key of ["opsLabel", "opsDday", "opsCopy", "summaryLabel", "summaryPercent"]) {
    for (const value of colorsOfStyle(schedule, key)) assert.match(value, SUMMARY_TEXT_COLOR, `schedule ${key}`);
  }

  const bookings = code("../../app/bookings/index.tsx");
  assert.match(bookings, /<FeatureSummarySurface style=\{s\.summaryCard\}>/);
  assert.doesNotMatch(bookings, /<Surface tone="noir"/);
  for (const key of ["summaryEyebrow", "summaryTitle", "summaryBody", "summaryMetaText", "statNumber", "statLabel"]) {
    for (const value of colorsOfStyle(bookings, key)) assert.match(value, SUMMARY_TEXT_COLOR, `bookings ${key}`);
  }

  const budget = code("../../app/budget/index.tsx");
  assert.doesNotMatch(budget, /#EF4444/);
  const open = budget.indexOf("<FeatureSummarySurface style={s.totalCard}>");
  const close = budget.indexOf("</FeatureSummarySurface>", open);
  assert.ok(open >= 0 && close > open, "예산 요약 면");
  // 두 번째 지표 줄(배정·기록 지출·잔여)도 요약 면 안에 있다.
  assert.ok(budget.indexOf("style={s.sumRow}") > open && budget.indexOf("style={s.sumRow}") < close, "지표 줄이 요약 밖에 있다");
  assert.match(budget.slice(open, close), /<SummaryPill /);
  for (const key of ["totalLabel", "totalValue", "totalUnit", "progLabel", "sumLabel", "sumVal", "budgetEvidenceNote", "summaryDanger"]) {
    for (const value of colorsOfStyle(budget, key)) assert.match(value, SUMMARY_TEXT_COLOR, `budget ${key}`);
  }

  const home = code("../components/dashboard/WeddingHomeExperience.tsx");
  assert.match(colorsOfStyleBlock(home, "hero"), /backgroundColor: summaryColors\.surface/);
  assert.match(home, /<SummaryPill label=\{focusPill\.label\}/);
  for (const key of ["heroEyebrow", "dday", "weddingDate", "momentCopy", "heroMuted", "progressValue", "focusEyebrow", "focusTitle", "focusDescription", "focusActionText"]) {
    const values = colorsOfStyle(home, key);
    assert.ok(values.length > 0, `home ${key} 에 글자색이 없다`);
    for (const value of values) assert.match(value, SUMMARY_TEXT_COLOR, `home ${key}`);
  }
});

function colorsOfStyleBlock(screen, key) {
  const match = new RegExp(`\\b${key}: \\{([^}]*)\\}`).exec(screen);
  assert.ok(match, `스타일 ${key} 를 찾지 못했다`);
  return match[1];
}
