import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../../app/(tabs)/chat.tsx", import.meta.url), "utf8");
const tree = ts.createSourceFile("chat.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function harness() {
  const moves = [];
  const away = [];
  const timers = new Map();
  let id = 0;
  const setTimer = callback => { const key = ++id; timers.set(key, callback); return key; };
  const clearTimer = key => timers.delete(key);
  const code = ts.transpileModule(readFileSync(new URL("../lib/chatScrollPosition.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("exports", "module", "setTimeout", "clearTimeout", code)(module.exports, module, setTimer, clearTimer);
  const controller = module.exports.createChatScrollPosition({ scrollToOffset: value => moves.push(value), onAwayChange: value => away.push(value) });
  return { controller, moves, away, setTimer, timers,
    flush() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(callback => callback()); },
  };
}
function screenCallback(name, bindings) {
  let declaration;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) declaration = node.getText(tree);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.ok(declaration);
  const compiled = ts.transpileModule(`const ${declaration}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function("bindings", `with(bindings){${compiled};return ${name};}`)({ useCallback: fn => fn, ...bindings });
}

test("a completed response cannot pull a reader away from an older message", () => {
  const h = harness();
  h.controller.onScroll("shared", 1600);
  const scroll = screenCallback("scrollToLatest", {
    flatListRef: { current: { scrollToOffset: value => h.moves.push(value) } },
    scrollPositionRef: { current: h.controller },
    setTimeout: h.setTimer,
  });
  scroll(true);
  h.flush();
  assert.deepEqual(h.moves, [], "the response completion must not unconditionally jump to offset zero");
});

test("new messages follow at the latest edge, but a person's drag cancels a pending jump", () => {
  const h = harness();
  h.controller.onScroll("shared", 40);
  h.controller.followLatest();
  h.flush();
  assert.deepEqual(h.moves, [{ offset: 0, animated: true }]);
  h.moves.length = 0;
  h.controller.followLatest();
  h.controller.beginDrag("shared");
  h.flush();
  assert.deepEqual(h.moves, []);
});

test("an accessibility scroll away also prevents an already scheduled automatic jump", () => {
  const h = harness();
  h.controller.followLatest();
  h.controller.onScroll("shared", 900);
  h.flush();
  assert.deepEqual(h.moves, []);
  assert.equal(h.away.at(-1), true);
});

test("shared and private positions restore independently across A to B to A without animating", () => {
  const h = harness();
  h.controller.onScroll("shared", 1600);
  h.controller.activate("private");
  h.controller.onScroll("private", 0); // The new native list's initial event must not replace the saved position.
  h.controller.restore("private");
  h.flush();
  h.controller.onScroll("private", 700);
  h.controller.activate("shared");
  h.controller.onScroll("shared", 0);
  h.controller.restore("shared");
  h.flush();
  assert.deepEqual(h.moves, [{ offset: 0, animated: false }, { offset: 1600, animated: false }]);
  h.controller.activate("private");
  h.controller.restore("private");
  h.flush();
  assert.deepEqual(h.moves.at(-1), { offset: 700, animated: false });
});

test("late previous-scope events and scheduled restores cannot move the current scope", () => {
  const h = harness();
  h.controller.activate("private");
  h.controller.restore("private");
  h.controller.activate("shared");
  h.controller.onScroll("private", 2000);
  h.controller.beginDrag("private");
  h.controller.restore("private");
  h.flush();
  assert.deepEqual(h.moves, []);
  h.controller.restore("shared");
  h.flush();
  assert.deepEqual(h.moves, [{ offset: 0, animated: false }]);
});

test("explicit latest navigation resumes following, while account reset erases all positions and timers", () => {
  const h = harness();
  h.controller.onScroll("shared", 2000);
  h.controller.jumpToLatest();
  h.flush();
  assert.deepEqual(h.moves, [{ offset: 0, animated: true }]);
  assert.equal(h.away.at(-1), false);
  h.controller.onScroll("shared", 1800);
  h.controller.activate("private");
  h.controller.restore("private");
  h.controller.reset();
  h.flush();
  assert.equal(h.moves.length, 1);
  h.controller.activate("private");
  h.controller.restore("private");
  h.flush();
  assert.deepEqual(h.moves.at(-1), { offset: 0, animated: false });
  h.controller.activate("shared");
  h.controller.restore("shared");
  h.flush();
  assert.deepEqual(h.moves.at(-1), { offset: 0, animated: false });
});

test("unmount cancels timers and invalid offsets do not hide the latest action", () => {
  const h = harness();
  h.controller.onScroll("shared", 200);
  h.controller.onScroll("shared", Number.NaN);
  assert.equal(h.away.at(-1), true);
  h.controller.jumpToLatest();
  h.controller.dispose();
  h.flush();
  assert.deepEqual(h.moves, []);
});

function renderFlatList(bindings) {
  let element;
  const visit = node => { if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === "FlatList") element = node.getText(tree); ts.forEachChild(node, visit); };
  visit(tree);
  const code = ts.transpileModule(`const list = (${element});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  return new Function("bindings", `with(bindings){${code};return list;}`)({
    FlatList: "FlatList", React: { createElement: (type, props) => ({ type, props }) },
    flatListRef: { current: null }, visibleMessages: [], renderChatRow() {}, renderHistoryFooter() { return "older-control"; },
    st: {}, Platform: { OS: "ios" }, ...bindings,
  });
}

test("the actual inverted list connects reader movement and keeps an anchor when older rows append", () => {
  const h = harness();
  const list = renderFlatList({ activeScope: "shared", scrollPositionRef: { current: h.controller } });
  assert.equal(list.props.inverted, true);
  assert.equal(list.props.ListFooterComponent, "older-control");
  assert.deepEqual(list.props.maintainVisibleContentPosition, { minIndexForVisible: 0, autoscrollToTopThreshold: 80 });
  h.controller.followLatest();
  list.props.onScrollBeginDrag();
  list.props.onScroll({ nativeEvent: { contentOffset: { y: 1200 } } });
  list.props.onContentSizeChange(300, 15000);
  h.flush();
  assert.deepEqual(h.moves, []);
  assert.equal(h.away.at(-1), true);
});

test("streaming text growth follows only a reader already at the latest edge", () => {
  const h = harness();
  const list = renderFlatList({ activeScope: "shared", scrollPositionRef: { current: h.controller } });
  list.props.onContentSizeChange(300, 15000);
  h.flush();
  assert.deepEqual(h.moves, [{ offset: 0, animated: false }]);
  list.props.onScrollBeginDrag();
  list.props.onScroll({ nativeEvent: { contentOffset: { y: 800 } } });
  list.props.onContentSizeChange(300, 15100);
  h.flush();
  assert.equal(h.moves.length, 1);
});
