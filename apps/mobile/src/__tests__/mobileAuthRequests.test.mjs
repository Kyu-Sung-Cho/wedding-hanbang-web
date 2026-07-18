import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

const sourcePath = fileURLToPath(new URL("../lib/mobileAuthRequests.ts", import.meta.url));

function loadRequests(publicApiFetch, isValidTurnstileToken) {
  const sourceText = readFileSync(sourcePath, "utf8");
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const declarations = sourceFile.statements
    .filter((statement) =>
      ts.isFunctionDeclaration(statement) || ts.isVariableStatement(statement)
    )
    .map((statement) => statement.getFullText(sourceFile).replace(/\bexport\s+/g, ""))
    .join("\n");
  const compiled = ts.transpileModule(declarations, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  });
  return new Function(
    "publicApiFetch",
    "isValidTurnstileToken",
    `${compiled.outputText}\nreturn {
      requestMobileSignup,
      requestMobilePasswordReset: typeof requestMobilePasswordReset === "function"
        ? requestMobilePasswordReset
        : undefined,
    };`,
  )(publicApiFetch, isValidTurnstileToken);
}

test("signup cannot reach the public API without a verified Turnstile token", async () => {
  const calls = [];
  const requests = loadRequests(
    async (...args) => {
      calls.push(args);
      return { ok: true };
    },
    (token) => typeof token === "string" && token.startsWith("valid."),
  );

  await assert.rejects(
    () => requests.requestMobileSignup({
      email: "sample@example.test",
      password: "Strong1!",
      name: "샘플 사용자",
      marketingAgreed: false,
    }, ""),
    /사람인지 확인을 먼저 완료해주세요/,
  );
  assert.deepEqual(calls, []);
});

test("signup sends the verified token with the existing hardened API payload", async () => {
  const calls = [];
  const requests = loadRequests(
    async (...args) => {
      calls.push(args);
      return { ok: true };
    },
    (token) => typeof token === "string" && token.startsWith("valid."),
  );
  const token = `valid.${"a".repeat(32)}`;

  await requests.requestMobileSignup({
    email: "sample@example.test",
    password: "Strong1!",
    name: "샘플 사용자",
    marketingAgreed: true,
  }, token);

  assert.deepEqual(calls, [[
    "/api/auth/signup",
    {
      method: "POST",
      body: JSON.stringify({
        email: "sample@example.test",
        password: "Strong1!",
        name: "샘플 사용자",
        marketingAgreed: true,
        turnstileToken: token,
      }),
    },
  ]]);
});

test("password reset is gated by and forwards a verified Turnstile token", async () => {
  const calls = [];
  const requests = loadRequests(
    async (...args) => {
      calls.push(args);
      return { ok: true };
    },
    (token) => typeof token === "string" && token.startsWith("valid."),
  );
  const token = `valid.${"b".repeat(32)}`;

  assert.equal(typeof requests.requestMobilePasswordReset, "function");
  await assert.rejects(
    () => requests.requestMobilePasswordReset("sample@example.test", null),
    /사람인지 확인을 먼저 완료해주세요/,
  );
  assert.deepEqual(calls, []);

  await requests.requestMobilePasswordReset("sample@example.test", token);
  assert.deepEqual(calls, [[
    "/api/auth/forgot-password",
    {
      method: "POST",
      body: JSON.stringify({
        email: "sample@example.test",
        turnstileToken: token,
      }),
    },
  ]]);
});
