import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

const sourcePath = fileURLToPath(
  new URL("../../../../packages/shared/src/utils/chatLane.ts", import.meta.url),
);
const compiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
});
const module = { exports: {} };
new Function("exports", "module", compiled.outputText)(module.exports, module);
const {
  createEmptyAmoraChatLaneRecord,
  resolveAmoraChatLane,
  updateAmoraChatLaneRecord,
} = module.exports;

test("composer state resolves to exactly three supported lanes and fails closed for an unlinked partner", () => {
  assert.equal(resolveAmoraChatLane("shared", "ai", true), "shared_ai");
  assert.equal(resolveAmoraChatLane("shared", "partner", true), "shared_partner");
  assert.equal(resolveAmoraChatLane("private", "ai", true), "private_ai");
  assert.equal(resolveAmoraChatLane("private", "partner", true), null);
  assert.equal(resolveAmoraChatLane("shared", "partner", false), null);
});

test("draft updates remain isolated while users switch among the three lanes", () => {
  let drafts = createEmptyAmoraChatLaneRecord(() => "");
  drafts = updateAmoraChatLaneRecord(drafts, "shared_ai", "아모라에게 물을 초안");
  drafts = updateAmoraChatLaneRecord(drafts, "shared_partner", "파트너에게 보낼 초안");
  drafts = updateAmoraChatLaneRecord(drafts, "private_ai", "나만의 상담 초안");

  assert.deepEqual(drafts, {
    shared_ai: "아모라에게 물을 초안",
    shared_partner: "파트너에게 보낼 초안",
    private_ai: "나만의 상담 초안",
  });
});
