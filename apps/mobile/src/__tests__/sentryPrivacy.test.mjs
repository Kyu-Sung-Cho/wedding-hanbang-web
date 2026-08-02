import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const testDir = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(testDir, "../lib/sentryPrivacy.ts");
const source = await readFile(sourcePath, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
});
const privacy = await import(`data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString("base64")}`);

test("Sentry error scrubber removes direct PII containers and sensitive free text", () => {
  const event = {
    user: { id: "person-1", email: "bride@example.com" },
    request: { url: "https://hanbang.ai/private?token=secret" },
    extra: { chat: "private wedding plan" },
    message: "call 010-1234-5678 or bride@example.com at https://hanbang.ai/private",
    exception: {
      values: [
        { value: "Bearer abcdefghijklmnopqrstuvwx.abcdefghijkl.secretpayload" },
        { value: ["sk", "proj", "test_fixture_not_a_secret_1234567890"].join("-") },
      ],
    },
    breadcrumbs: [{ message: "resident 900101-1234567", data: { input: "private" } }],
  };

  const result = privacy.sanitizeSentryEvent(event);

  assert.equal(result.user, undefined);
  assert.equal(result.request, undefined);
  assert.equal(result.extra, undefined);
  assert.equal(result.message, "[redacted-error]");
  assert.equal(result.exception.values[0].value, "[redacted-error]");
  assert.equal(result.exception.values[1].value, "[redacted-error]");
  assert.equal(result.breadcrumbs[0].message, "[redacted]");
  assert.equal(result.breadcrumbs[0].data, undefined);
});

test("Sentry scrubber removes arbitrary user-authored error and console text", () => {
  const privateMarker = "our private venue is the family home";
  const event = {
    message: privateMarker,
    contexts: { react: { componentStack: privateMarker } },
    exception: {
      values: [{
        type: "PostgrestError",
        value: privateMarker,
        stacktrace: { frames: [{ filename: "screen.tsx", lineno: 10 }] },
      }],
    },
    breadcrumbs: [{ category: "console", message: privateMarker }],
  };

  const result = privacy.sanitizeSentryEvent(event);
  const serialized = JSON.stringify(result);

  assert.equal(serialized.includes(privateMarker), false);
  assert.equal(result.contexts, undefined);
  assert.equal(result.exception.values[0].type, "PostgrestError");
  assert.equal(result.exception.values[0].stacktrace.frames[0].filename, "screen.tsx");
  assert.equal(result.exception.values[0].value, "[redacted-error]");
  assert.equal(result.breadcrumbs[0].message, "[redacted]");
});

test("Sentry transaction scrubber removes root-relative URL parameters", () => {
  const event = {
    transaction: "GET /auth/callback?code=oauth-code-marker&state=private-state#token=private-token",
  };

  privacy.sanitizeSentryTransaction(event);

  assert.equal(event.transaction, "GET /auth/callback");
  assert.equal(JSON.stringify(event).includes("oauth-code-marker"), false);
  assert.equal(JSON.stringify(event).includes("private-state"), false);
  assert.equal(JSON.stringify(event).includes("private-token"), false);
});

test("Sentry transaction scrubber removes span data and URLs before performance upload", () => {
  const transaction = {
    transaction: "GET https://hanbang.ai/api/profile?email=bride@example.com",
    user: { id: "person-1" },
    request: { url: "https://hanbang.ai/private" },
    extra: { budget: 5000 },
    spans: [
      {
        description: "fetch https://hanbang.ai/api/amora?phone=010-1234-5678",
        data: { url: "https://hanbang.ai/api/amora", body: "private chat" },
      },
    ],
  };

  const result = privacy.sanitizeSentryTransaction(transaction);

  assert.equal(result.transaction, "GET [url]");
  assert.equal(result.user, undefined);
  assert.equal(result.request, undefined);
  assert.equal(result.extra, undefined);
  assert.equal(result.spans[0].description, "[redacted]");
  assert.deepEqual(result.spans[0].data, {});
});

test("Sentry transaction scrubber removes arbitrary user-authored span descriptions", () => {
  const privateMarker = "private venue contract clause";
  const event = {
    spans: [{ description: privateMarker, data: { body: privateMarker } }],
  };

  privacy.sanitizeSentryTransaction(event);

  assert.equal(JSON.stringify(event).includes(privateMarker), false);
  assert.equal(event.spans[0].description, "[redacted]");
  assert.deepEqual(event.spans[0].data, {});
});
