// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") return [];
      return sourceFiles(path);
    }
    if (!/\.tsx?$/u.test(entry.name) || /\.test\.tsx?$/u.test(entry.name)) return [];
    return [relative(process.cwd(), path).replaceAll("\\", "/")];
  });
}

const GUARDED_FILES = sourceFiles(resolve(process.cwd(), "src"));

const SAFE_WRAPPERS = new Set(["safeErrorDiagnostic", "errorCode"]);
const SAFE_ERROR_PROPERTIES = new Set(["code", "name", "status", "statusCode"]);
const RAW_ERROR_PROPERTY_NAMES = new Set([
  "body",
  "cause",
  "data",
  "details",
  "hint",
  "message",
  "request",
  "response",
  "stack",
]);

function isRawErrorIdentifier(name: string): boolean {
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
  if (name === "err" || name === "error") return true;
  if (/(?:Error|Err)$/u.test(name) && !/(?:ErrorCode|ErrorName|ErrorStatus)$/u.test(name)) {
    return true;
  }
  return false;
}

function containsRawError(node: ts.Node): boolean {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
    if (SAFE_WRAPPERS.has(node.expression.text)) return false;
  }
  if (ts.isPropertyAssignment(node)) return containsRawError(node.initializer);
  if (ts.isShorthandPropertyAssignment(node)) return isRawErrorIdentifier(node.name.text);
  if (ts.isPropertyAccessExpression(node)) {
    if (RAW_ERROR_PROPERTY_NAMES.has(node.name.text)) return true;
    if (SAFE_ERROR_PROPERTIES.has(node.name.text)) return false;
  }
  if (ts.isIdentifier(node) && isRawErrorIdentifier(node.text)) return true;

  let found = false;
  node.forEachChild((child) => {
    if (!found && containsRawError(child)) found = true;
  });
  return found;
}

function unsafeConsoleArguments(relativePath: string): string[] {
  const path = resolve(process.cwd(), relativePath);
  const sourceText = readFileSync(path, "utf8");
  const source = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true);
  const failures: string[] = [];

  const visit = (node: ts.Node) => {
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
  return failures;
}

function containsRawResponseError(node: ts.Node): boolean {
  if (ts.isPropertyAssignment(node)) return containsRawResponseError(node.initializer);
  if (ts.isShorthandPropertyAssignment(node)) {
    return /^(?:err|error|.*Error|.*Err|errMsg|errorMessage)$/u.test(node.name.text);
  }
  if (ts.isPropertyAccessExpression(node)) {
    if (["code", "publicMessage", "status"].includes(node.name.text)) return false;
    if (["cause", "details", "hint", "message", "stack"].includes(node.name.text)) {
      let root: ts.Expression = node.expression;
      while (ts.isPropertyAccessExpression(root) || ts.isElementAccessExpression(root)) {
        root = root.expression;
      }
      return ts.isIdentifier(root)
        && /^(?:err|error|.*Error|.*Err)$/u.test(root.text)
        && !/^(?:publicError|publicErrorCode|publicErrorMessage)$/u.test(root.text);
    }
    return containsRawResponseError(node.expression);
  }
  if (ts.isIdentifier(node)) {
    return /^(?:err|error|.*Error|.*Err|errMsg|errorMessage)$/u.test(node.text)
      && !/^(?:errorCode|publicError|publicErrorCode|publicErrorMessage)$/u.test(node.text);
  }

  let found = false;
  node.forEachChild((child) => {
    if (!found && containsRawResponseError(child)) found = true;
  });
  return found;
}

function unsafeJsonResponses(relativePath: string): string[] {
  if (!relativePath.startsWith("src/app/api/") || !relativePath.endsWith("route.ts")) return [];
  const path = resolve(process.cwd(), relativePath);
  const sourceText = readFileSync(path, "utf8");
  const source = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true);
  const failures: string[] = [];

  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === "json"
      && ts.isIdentifier(node.expression.expression)
      && ["NextResponse", "Response"].includes(node.expression.expression.text)
      && node.arguments[0]
      && containsRawResponseError(node.arguments[0])
    ) {
      const position = source.getLineAndCharacterOfPosition(node.getStart(source));
      failures.push(`${relativePath}:${position.line + 1}`);
    }
    node.forEachChild(visit);
  };
  visit(source);
  return failures;
}

describe("sensitive logging source boundary", () => {
  it("never passes raw provider/request errors to application logs", () => {
    const failures = GUARDED_FILES.flatMap(unsafeConsoleArguments);
    expect(failures).toEqual([]);
  });

  it("never reflects raw provider or database errors from API routes", () => {
    const failures = GUARDED_FILES.flatMap(unsafeJsonResponses);
    expect(failures).toEqual([]);
  });
});
