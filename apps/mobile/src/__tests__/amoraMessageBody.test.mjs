import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import ts from "typescript";
import * as bodyParser from "../lib/amoraMessageBody.mjs";
import { parseAmoraInline, parseAmoraMessageBody } from "../lib/amoraMessageBody.mjs";

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
  const source = readFileSync(new URL("../components/chat/AmoraMessageBody.tsx", import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  const jsx = (type, props) => ({ type, props });
  const require = (name) => {
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name === "react-native") return { View: "View", Text: "Text", StyleSheet: { create: (value) => value } };
    if (name === "@/components/ui/AppText") return { Text: "Text" };
    if (name === "@hanbang/design-tokens") return { colors: { border: "test-border" } };
    if (name === "../../lib/amoraMessageBody.mjs") return bodyParser;
    throw new Error(`Unexpected module: ${name}`);
  };
  new Function("module", "exports", "require", js)(module, module.exports, require);
  const tree = module.exports.AmoraMessageBody({ content: "| 분야 | 금액 |\n| --- | --- |\n| 사진 | 5,000원 |\n| 예비비 | 1원 |\n\n> **부모님**께 *확인*\n\n[근거](https://example.com)\n\n<script>alert(1)</script>" });
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
  const visible = text.join("");
  assert.ok(visible.includes("분야: 사진금액: 5,000원"));
  assert.ok(visible.includes("분야: 예비비금액: 1원"));
  assert.ok(visible.includes("부모님께 확인"));
  assert.ok(visible.includes("근거 (https://example.com)"));
  assert.ok(!visible.includes("| ---") && !visible.includes("**부모님**"));
  assert.ok(nodes.some((node) => node.props.style?.fontWeight === "700"));
  assert.ok(nodes.some((node) => node.props.style?.fontStyle === "italic"));
  assert.ok(nodes.every((node) => node.type === "View" || node.type === "Text"));
  assert.ok(nodes.every((node) => !node.props.source && !node.props.dangerouslySetInnerHTML && !node.props.onPress));
});
