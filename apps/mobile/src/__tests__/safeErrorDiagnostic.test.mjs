import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const testDir = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(testDir, "../lib/safeErrorDiagnostic.ts");
const source = await readFile(sourcePath, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
});
const diagnostics = await import(
  `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString("base64")}`
);

test("mobile diagnostics retain only bounded operational tokens", () => {
  const privateMarker = "bride@example.com private wedding plan";
  const result = diagnostics.safeErrorDiagnostic({
    name: "PostgrestError",
    code: "23505",
    status: 409,
    message: privateMarker,
    details: { body: privateMarker },
    accessToken: "secret-token-marker",
  });

  assert.deepEqual(result, {
    name: "PostgrestError",
    code: "23505",
    status: 409,
  });
  assert.equal(JSON.stringify(result).includes(privateMarker), false);
  assert.equal(JSON.stringify(result).includes("secret-token-marker"), false);
});

test("mobile diagnostics reject token-shaped names and codes", () => {
  const marker = ["sk", "ant", "secret-token-marker"].join("-");
  const result = diagnostics.safeErrorDiagnostic({ name: marker, code: marker });

  assert.deepEqual(result, {
    name: "UnknownError",
    code: "unknown",
    status: null,
  });
  assert.equal(JSON.stringify(result).includes(marker), false);
});
