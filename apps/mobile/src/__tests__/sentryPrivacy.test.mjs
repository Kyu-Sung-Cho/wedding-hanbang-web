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
      values: [{ value: "Bearer abcdefghijklmnopqrstuvwx.abcdefghijkl.secretpayload" }],
    },
    breadcrumbs: [{ message: "resident 900101-1234567", data: { input: "private" } }],
  };

  const result = privacy.sanitizeSentryEvent(event);

  assert.equal(result.user, undefined);
  assert.equal(result.request, undefined);
  assert.equal(result.extra, undefined);
  assert.equal(result.message, "call [redacted] or [redacted] at [url]");
  assert.equal(result.exception.values[0].value, "[redacted]");
  assert.equal(result.breadcrumbs[0].message, "resident [redacted]");
  assert.equal(result.breadcrumbs[0].data, undefined);
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
  assert.equal(result.spans[0].description, "fetch [url]");
  assert.deepEqual(result.spans[0].data, {});
});
