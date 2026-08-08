import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

const sourcePath = fileURLToPath(
  new URL("../lib/chatSessionGeneration.ts", import.meta.url),
);
const compiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
});
const module = { exports: {} };
new Function("exports", "module", compiled.outputText)(module.exports, module);
const { createChatSessionGenerationGuard } = module.exports;

test("a new identity generation rejects results from every earlier session", () => {
  const guard = createChatSessionGenerationGuard();
  const firstIdentity = guard.begin();
  assert.equal(guard.isCurrent(firstIdentity), true);

  const secondIdentity = guard.begin();
  assert.equal(guard.isCurrent(firstIdentity), false);
  assert.equal(guard.isCurrent(secondIdentity), true);

  guard.invalidate();
  assert.equal(guard.isCurrent(secondIdentity), false);
});
