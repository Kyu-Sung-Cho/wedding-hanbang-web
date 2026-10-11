import assert from "node:assert/strict";
import test from "node:test";
import process from "node:process";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import ts from "typescript";
import * as bodyParser from "../lib/amoraMessageBody.mjs";
import { parseAmoraInline, parseAmoraMessageBody } from "../lib/amoraMessageBody.mjs";
import * as siteUrl from "../lib/siteUrl.mjs";

function renderBody(content, { openURL = async () => undefined, alert = () => undefined } = {}) {
  const source = readFileSync(new URL("../components/chat/AmoraMessageBody.tsx", import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  const jsx = (type, props) => ({ type, props });
  const require = (name) => {
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name === "react-native") return { View: "View", Text: "Text", Linking: { openURL }, Alert: { alert }, StyleSheet: { create: (value) => value } };
    if (name === "@/components/ui/AppText") return { Text: "Text" };
    if (name === "@hanbang/design-tokens") return { colors: { border: "test-border", paper: { penDeep: "test-link" } } };
    if (name === "../../lib/amoraMessageBody.mjs") return bodyParser;
    if (name === "../../lib/siteUrl.mjs") return siteUrl;
    throw new Error(`Unexpected module: ${name}`);
  };
  new Function("module", "exports", "require", "__DEV__", js)(module, module.exports, require, true);
  const tree = module.exports.AmoraMessageBody({ content });
  const nodes = [];
  const text = [];
  function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node === "string") { text.push(node); return; }
    if (!node || typeof node !== "object") return;
    nodes.push(node);
    walk(node.props.children);
  }
  walk(tree);
  return { nodes, visible: text.join("") };
}

test("native recommendation references open their exact HTTPS destination only after a link press", async () => {
  const opened = [];
  const { nodes, visible } = renderBody("[가격 확인](https://example.com/price?q=1.25)", { openURL: async (href) => { opened.push(href); } });
  const link = nodes.find((node) => node.props.accessibilityRole === "link");
  assert.ok(link, "a source reference is exposed as an accessible link");
  assert.equal(visible, "가격 확인");
  assert.deepEqual(opened, [], "rendering never opens or requests a source");
  await link.props.onPress();
  assert.deepEqual(opened, ["https://example.com/price?q=1.25"]);
});

test("native preparation references resolve safe internal pages against the configured service site", async () => {
  const previousSite = process.env.EXPO_PUBLIC_SITE_URL;
  process.env.EXPO_PUBLIC_SITE_URL = "https://hanbang.ai";
  try {
    const opened = [];
    const { nodes } = renderBody("[공개 가격 보기](/price?region=seoul#source)", { openURL: async (href) => { opened.push(href); } });
    const link = nodes.find((node) => node.props.accessibilityRole === "link");
    assert.ok(link, "an internal reference is also clickable");
    await link.props.onPress();
    assert.deepEqual(opened, ["https://hanbang.ai/price?region=seoul#source"]);
  } finally {
    if (previousSite === undefined) delete process.env.EXPO_PUBLIC_SITE_URL;
    else process.env.EXPO_PUBLIC_SITE_URL = previousSite;
  }
});

test("native references remain clickable when Amora emphasizes the recommendation sentence", async () => {
  const opened = [];
  const { nodes, visible } = renderBody("**공식 자료 [원문 보기](https://example.com/source)**", { openURL: async (href) => { opened.push(href); } });
  const link = nodes.find((node) => node.props.accessibilityRole === "link");
  assert.ok(link, "bold formatting does not make the reference inert");
  assert.equal(visible, "공식 자료 원문 보기");
  await link.props.onPress();
  assert.deepEqual(opened, ["https://example.com/source"]);
});

test("native emphasized link labels display readable text with one clickable destination", async () => {
  const opened = [];
  const { nodes, visible } = renderBody("[**공식 자료**](https://example.com/source)", { openURL: async (href) => { opened.push(href); } });
  assert.equal(visible, "공식 자료");
  const links = nodes.filter((node) => node.props.accessibilityRole === "link");
  assert.equal(links.length, 1);
  await links[0].props.onPress();
  assert.deepEqual(opened, ["https://example.com/source"]);
});

test("native references also activate a plain HTTPS address without swallowing Korean prose or punctuation", async () => {
  const opened = [];
  const { nodes, visible } = renderBody("자료는 https://example.com/source?q=1 여기에서 볼 수 있어요.", { openURL: async (href) => { opened.push(href); } });
  const link = nodes.find((node) => node.props.accessibilityRole === "link");
  assert.ok(link, "a plain source address is clickable");
  assert.equal(visible, "자료는 https://example.com/source?q=1 여기에서 볼 수 있어요.");
  await link.props.onPress();
  assert.deepEqual(opened, ["https://example.com/source?q=1"]);
});

test("native references display a recovery notice when the operating system cannot open a destination", async () => {
  const alerts = [];
  const { nodes } = renderBody("[원문 보기](https://example.com)", {
    openURL: async () => { throw new Error("PRIVATE_OS_DIAGNOSTIC"); },
    alert: (...args) => { alerts.push(args); },
  });
  await nodes.find((node) => node.props.accessibilityRole === "link").props.onPress();
  assert.equal(alerts[0][0], "링크를 열지 못했어요");
  assert.ok(alerts[0][1].includes("다시 눌러"));
  assert.ok(!JSON.stringify(alerts).includes("PRIVATE_OS_DIAGNOSTIC"));
});

test("native unsafe addresses, remote images and code examples never become pressable references", async () => {
  for (const source of [
    "[실행](javascript:alert(1))",
    "[실행](data:text/html,hello)",
    "[실행](http://example.com)",
    "[실행](https://owner:secret@example.com)",
    "[실행](//example.com)",
    "[실행](/api/chat)",
    "[실행](/auth/callback)",
    "[실행](/admin)",
    "![사진](https://example.com/track.png)",
    "`https://example.com/source`",
    "```\nhttps://example.com/source\n```",
  ]) {
    const { nodes } = renderBody(source);
    assert.ok(nodes.every((node) => !node.props.onPress), `inert: ${source}`);
  }
});

test("native malformed, unfinished or multiline references remain entirely visible and inert", () => {
  for (const source of [
    "[자료](https://example.com/source",
    "![사진](https://example.com/track.png",
    "[자료](\nhttps://example.com/source\n)",
    "![자료 [사진]](https://example.com/image)",
    "[[자료]](https://example.com/source)",
  ]) {
    const { nodes, visible } = renderBody(source);
    assert.equal(visible, source, "a partial destination never replaces the original text");
    assert.ok(nodes.every((node) => !node.props.onPress), `no partial press target: ${source}`);
  }
});

test("native encoded internal execution paths remain inert even on app-host aliases", () => {
  for (const href of [
    "/%61pi/chat",
    "/%2561pi/chat",
    "/%61uth/callback",
    "/%61dmin",
    "https://hanbang.ai./%61pi/chat",
    "https://www.hanbang.ai./%61uth/callback",
    "https://hanbang.ai/%2561dmin",
  ]) {
    const source = `[자료](${href})`;
    const { nodes, visible } = renderBody(source);
    assert.equal(visible, source);
    assert.ok(nodes.every((node) => !node.props.onPress), `execution path is not a reference: ${href}`);
  }
});

test("native malformed references stay inert across list block boundaries without hiding a later valid reference", async () => {
  for (const introduction of ["", "첫 안내\n", "> 첫 안내\n> "]) {
    const opened = [];
    const malformed = "[자료](\n- https://example.com/partial\n)";
    const { nodes, visible } = renderBody(`${introduction}${malformed}\n\n[다음 자료](https://example.com/next)`, {
      openURL: async (href) => { opened.push(href); },
    });
    const links = nodes.filter((node) => node.props.accessibilityRole === "link");
    assert.equal(links.length, 1);
    assert.ok(visible.includes(malformed), "unsupported syntax keeps all original characters");
    await links[0].props.onPress();
    assert.deepEqual(opened, ["https://example.com/next"]);
  }
});

test("native malformed table references remain inert when their destination continues in a list", async () => {
  const malformed = "| [자료]( | 메모 |\n- https://example.com/partial\n)";
  const opened = [];
  const { nodes, visible } = renderBody(`| 자료 | 내용 |\n|---|---|\n${malformed}\n\n[다음 자료](https://example.com/next)`, {
    openURL: async (href) => { opened.push(href); },
  });
  const links = nodes.filter((node) => node.props.accessibilityRole === "link");
  assert.equal(links.length, 1);
  assert.ok(visible.includes(malformed));
  await links[0].props.onPress();
  assert.deepEqual(opened, ["https://example.com/next"]);
});

test("native blank lines inside malformed references never revive a partial destination", async () => {
  for (const malformed of [
    "[자료](\n\nhttps://example.com/partial\n)",
    "> [자료](\n\n> https://example.com/partial\n> )",
  ]) {
    const opened = [];
    const { nodes, visible } = renderBody(`${malformed}\n\n[정상](https://example.com/next)`, {
      openURL: async (href) => { opened.push(href); },
    });
    const links = nodes.filter((node) => node.props.accessibilityRole === "link");
    assert.equal(links.length, 1);
    assert.ok(visible.includes(malformed));
    await links[0].props.onPress();
    assert.deepEqual(opened, ["https://example.com/next"]);
  }
});

test("native chained malformed references remain inert across plain and quoted list boundaries", async () => {
  for (const malformed of [
    "[첫](\n) [다음](\n- https://example.com/second\n)",
    "> [첫](\n> ) [다음](\n> - https://example.com/second\n> )",
  ]) {
    const opened = [];
    const { nodes, visible } = renderBody(`${malformed}\n\n[정상](https://example.com/next)`, {
      openURL: async (href) => { opened.push(href); },
    });
    const links = nodes.filter((node) => node.props.accessibilityRole === "link");
    assert.equal(links.length, 1);
    assert.ok(visible.includes(malformed));
    await links[0].props.onPress();
    assert.deepEqual(opened, ["https://example.com/next"]);
  }
});

test("native oversized reference and image labels stay visible without hiding adjacent valid references", async () => {
  for (const prefix of ["", "!"]) {
    const source = `${prefix}[${"a".repeat(2100)}](https://example.com/image.png)`;
    const opened = [];
    const { nodes, visible } = renderBody(`[앞](https://example.com/before) ${source} [뒤](https://example.com/next)`, {
      openURL: async (href) => { opened.push(href); },
    });
    const links = nodes.filter((node) => node.props.accessibilityRole === "link");
    assert.equal(links.length, 2);
    assert.ok(visible.includes(source));
    for (const link of links) await link.props.onPress();
    assert.deepEqual(opened, ["https://example.com/before", "https://example.com/next"]);
  }
});

test("native table references keep URL pipes inside one cell and open the exact destination", async () => {
  const source = "[원문](https://example.com/info?q=a|b)";
  const content = `| 자료 | 내용 |\n|---|---|\n| ${source} | 메모 |`;
  const blocks = parseAmoraMessageBody(content);
  assert.deepEqual(blocks[0].rows, [[source, "메모"]]);
  const opened = [];
  const { nodes } = renderBody(content, { openURL: async (href) => { opened.push(href); } });
  const links = nodes.filter((node) => node.props.accessibilityRole === "link");
  assert.equal(links.length, 1);
  await links[0].props.onPress();
  assert.deepEqual(opened, ["https://example.com/info?q=a|b"]);
});

test("native table image labels containing pipes stay whole and inert", () => {
  for (const source of [
    "![사진|설명](https://example.com/image.png)",
    "![자료 [사진]|설명](https://example.com/image.png)",
  ]) {
    const content = `| 자료 | 내용 |\n|---|---|\n| ${source} | 메모 |`;
    assert.deepEqual(parseAmoraMessageBody(content)[0].rows, [[source, "메모"]]);
    const { nodes, visible } = renderBody(content);
    assert.ok(visible.includes(source));
    assert.ok(nodes.every((node) => !node.props.onPress));
  }
});

test("native blank reference names fall back to one visible clickable source address", async () => {
  for (const label of ["", "   "]) {
    const opened = [];
    const { nodes, visible } = renderBody(`[${label}](https://example.com/source)`, { openURL: async (href) => { opened.push(href); } });
    assert.equal(visible, "https://example.com/source");
    const links = nodes.filter((node) => node.props.accessibilityRole === "link");
    assert.equal(links.length, 1, "a fallback label has one accessible destination");
    await links[0].props.onPress();
    assert.deepEqual(opened, ["https://example.com/source"]);
  }
});

test("native budget table preserves every original cell and distinguishes headings, quotes and emphasis", () => {
  const blocks = parseAmoraMessageBody("## 준비 예산\n\n| 항목 | 예산 |\n| --- | ---: |\n| 장소·음식 | 900만 원 |\n| 예비비 | 5,000원 |\n| 합계 | 3,500만 원 |\n\n> 부모님께 **확인**할 내용\n\n1. 총액은 1.25억 원, 지출은 0원입니다.");
  assert.equal(blocks[0].type, "heading");
  assert.deepEqual(blocks[1], { type: "table", headers: ["항목", "예산"], rows: [["장소·음식", "900만 원"], ["예비비", "5,000원"], ["합계", "3,500만 원"]] });
  assert.equal(blocks[2].type, "quote");
  assert.equal(blocks[2].text, "부모님께 **확인**할 내용");
  assert.equal(blocks[3].text, "총액은 1.25억 원, 지출은 0원입니다.");
  assert.equal(blocks[3].marker, "1.");
  assert.deepEqual(parseAmoraInline("부모님께 **확인**하고 *생각*해요"), [
    { type: "text", text: "부모님께 " }, { type: "strong", text: "확인" },
    { type: "text", text: "하고 " }, { type: "emphasis", text: "생각" }, { type: "text", text: "해요" },
  ]);
});

test("tables keep escaped pipes and inline code; malformed rows and unmatched markers lose no content", () => {
  const blocks = parseAmoraMessageBody("| 항목 | 메모 |\n| --- | --- |\n| A\\|B | `x|y` |\n| 잘못된 행 | 1 | 추가 금액 3원 |\n\n**닫히지 않은 2.5만원");
  assert.deepEqual(blocks[0].rows, [["A\\|B", "`x|y`"]]);
  assert.ok(blocks.some((block) => block.text?.includes("추가 금액 3원")));
  assert.equal(blocks.at(-1).text, "**닫히지 않은 2.5만원");
  assert.deepEqual(parseAmoraInline("A\\|B `x|y`"), [
    { type: "text", text: "A|B " }, { type: "code", text: "x|y" },
  ]);
});

test("code and HTML stay inert text; only credential-free HTTPS markdown links get link metadata", () => {
  assert.deepEqual(parseAmoraMessageBody("```html\n<script>alert(1)</script> **그대로**\n```"), [
    { type: "code", text: "<script>alert(1)</script> **그대로**" },
  ]);
  assert.deepEqual(parseAmoraInline("[근거](https://example.com/price?q=1.25)"), [
    { type: "link", text: "근거", href: "https://example.com/price?q=1.25" },
  ]);
  for (const source of ["[클릭](javascript:alert(1))", "[클릭](https://owner:secret@example.com)", "![사진](https://example.com/track.png)"])
    assert.equal(parseAmoraInline(source).map((part) => part.text).join(""), source);
  assert.equal(parseAmoraInline("budget_entry_01: 1,200원 / 150 × 8 = 1,200").map((part) => part.text).join(""), "budget_entry_01: 1,200원 / 150 × 8 = 1,200");
  assert.equal(parseAmoraInline("150 * 8 * 2 = 2,400 / 150*8*2 / ** 금액 **").map((part) => part.text).join(""), "150 * 8 * 2 = 2,400 / 150*8*2 / ** 금액 **");
  const longUnclosed = "[".repeat(12001) + "마지막 5,000원";
  assert.deepEqual(parseAmoraInline(longUnclosed), [{ type: "text", text: longUnclosed }]);
});

test("actual native component renders labelled money rows and styled text without an executable image or HTML surface", () => {
  const { nodes, visible } = renderBody("| 분야 | 금액 |\n| --- | --- |\n| 사진 | 5,000원 |\n| 예비비 | 1원 |\n\n> **부모님**께 *확인*\n\n[근거](https://example.com)\n\n<script>alert(1)</script>");
  assert.ok(visible.includes("분야: 사진금액: 5,000원"));
  assert.ok(visible.includes("분야: 예비비금액: 1원"));
  assert.ok(visible.includes("부모님께 확인"));
  assert.ok(visible.includes("근거"));
  assert.ok(!visible.includes("| ---") && !visible.includes("**부모님**"));
  assert.ok(nodes.some((node) => node.props.style?.fontWeight === "700"));
  assert.ok(nodes.some((node) => node.props.style?.fontStyle === "italic"));
  assert.ok(nodes.every((node) => node.type === "View" || node.type === "Text"));
  assert.ok(nodes.every((node) => !node.props.source && !node.props.dangerouslySetInnerHTML));
  assert.ok(nodes.filter((node) => node.props.onPress).every((node) => node.props.accessibilityRole === "link"));
});
