import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import { communityContentText } from "@hanbang/shared/community-content-text";

const mobileRoot = resolve(import.meta.dirname, "../..");

function readTree(relative) {
  const source = readFileSync(resolve(mobileRoot, relative), "utf8");
  return ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function nodesMatching(tree, predicate) {
  const found = [];
  function visit(node) {
    if (predicate(node)) found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return found;
}

function evaluateExpression(expression, content) {
  return new Function("item", "post", "detail", "communityContentText", `return (${expression});`)(
    { content }, { content }, { post: { content } }, communityContentText,
  );
}

const encodedBody = "<p>예산 &lt; 300 &amp; 일정</p>\n&lt;img src=x onerror=alert(1)&gt;";
const visibleBody = "예산 < 300 & 일정\n<img src=x onerror=alert(1)>";

test("모바일 목록은 엔티티를 해독한 뒤 표시문을 자른다", () => {
  const tree = readTree("app/(tabs)/community.tsx");
  const declaration = nodesMatching(tree, (node) =>
    ts.isVariableDeclaration(node) && node.name.getText(tree) === "preview",
  );
  assert.equal(declaration.length, 1);
  assert.ok(declaration[0].initializer);
  const expression = declaration[0].initializer.getText(tree);
  assert.equal(evaluateExpression(expression, encodedBody), visibleBody);
  assert.equal(evaluateExpression(expression, "&amp;".repeat(110)), "&".repeat(100));
});

test("모바일 글 본문 Text에 태그와 엔티티 문자열이 그대로 드러나지 않는다", () => {
  const tree = readTree("app/community/post/[id].tsx");
  const bodies = nodesMatching(tree, (node) =>
    ts.isJsxElement(node)
    && node.openingElement.tagName.getText(tree) === "Text"
    && node.openingElement.attributes.properties.some((attribute) =>
      ts.isJsxAttribute(attribute)
      && attribute.name.getText(tree) === "style"
      && attribute.initializer?.getText(tree) === "{styles.body}",
    ),
  );
  assert.equal(bodies.length, 1);
  const expression = bodies[0].children.find((node) => ts.isJsxExpression(node) && node.expression)?.expression;
  assert.ok(expression);
  assert.equal(evaluateExpression(expression.getText(tree), encodedBody), visibleBody);
});

test("모바일 결정 글 원문도 Text에 표시할 때만 해독한다", () => {
  const tree = readTree("app/community/decision/[id].tsx");
  const expressions = nodesMatching(tree, (node) =>
    ts.isJsxExpression(node)
    && node.expression
    && (ts.isCallExpression(node.expression) || ts.isPropertyAccessExpression(node.expression))
    && node.expression.getText(tree).includes("detail.post.content"),
  );
  assert.equal(expressions.length, 1);
  assert.equal(evaluateExpression(expressions[0].expression.getText(tree), encodedBody), visibleBody);
});
