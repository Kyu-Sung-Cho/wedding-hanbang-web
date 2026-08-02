import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const testDir = dirname(fileURLToPath(import.meta.url));
const mobileRoot = resolve(testDir, "../..");
async function sourceFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__") files.push(...await sourceFiles(path));
      continue;
    }
    if (!/\.tsx?$/u.test(entry.name) || /\.test\.tsx?$/u.test(entry.name)) continue;
    files.push(relative(mobileRoot, path).replaceAll("\\", "/"));
  }
  return files;
}

function isRawErrorIdentifier(name) {
  if ([
    "body",
    "bodyText",
    "cause",
    "content",
    "data",
    "errText",
    "errorText",
    "payload",
    "request",
    "response",
    "responseText",
  ].includes(name)) return true;
  if (/^(?:(?:access|refresh)?token|email|phone|url|href|ip|inviteCode)$/u.test(name)) {
    return true;
  }
  if (/^(?:actor|author|booking|comment|couple|customer|job|member|message|post|profile|request|session|user|vendor)Ids?$/u.test(name)) {
    return true;
  }
  return name === "err" || name === "error" || (
    /(?:Error|Err)$/u.test(name) && !/(?:ErrorCode|ErrorName|ErrorStatus)$/u.test(name)
  );
}

function containsRawError(node) {
  if (
    ts.isCallExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === "safeErrorDiagnostic"
  ) return false;
  if (ts.isPropertyAssignment(node)) return containsRawError(node.initializer);
  if (ts.isShorthandPropertyAssignment(node)) return isRawErrorIdentifier(node.name.text);
  if (ts.isPropertyAccessExpression(node)) {
    if (["message", "details", "hint", "stack", "body", "request", "response"].includes(node.name.text)) {
      return true;
    }
    if (["code", "name", "status", "statusCode"].includes(node.name.text)) return false;
  }
  if (ts.isIdentifier(node) && isRawErrorIdentifier(node.text)) return true;

  let found = false;
  node.forEachChild((child) => {
    if (!found && containsRawError(child)) found = true;
  });
  return found;
}

test("mobile application logs never serialize raw errors or identifiers", async () => {
  const failures = [];
  const guardedFiles = [
    ...await sourceFiles(resolve(mobileRoot, "app")),
    ...await sourceFiles(resolve(mobileRoot, "src")),
  ];
  for (const relativePath of guardedFiles) {
    const path = resolve(mobileRoot, relativePath);
    const sourceText = await readFile(path, "utf8");
    const source = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true);
    const visit = (node) => {
      if (
        ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression)
        && node.expression.expression.text === "console"
        && ["debug", "error", "info", "log", "warn"].includes(node.expression.name.text)
      ) {
        const firstArgument = node.arguments[0];
        const hasStaticLabel = firstArgument !== undefined && (
          ts.isStringLiteral(firstArgument)
          || ts.isNoSubstitutionTemplateLiteral(firstArgument)
        );
        const payloadArguments = hasStaticLabel ? node.arguments.slice(1) : node.arguments;
        if (payloadArguments.some(containsRawError)) {
          const position = source.getLineAndCharacterOfPosition(node.getStart(source));
          failures.push(`${relativePath}:${position.line + 1}`);
        }
      }
      node.forEachChild(visit);
    };
    visit(source);
  }

  assert.deepEqual(failures, []);
});
