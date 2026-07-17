import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

const sourcePath = fileURLToPath(new URL("../lib/chatPrivacyScope.ts", import.meta.url));
const compiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
});
const module = { exports: {} };
new Function("exports", "module", compiled.outputText)(module.exports, module);
const {
  chatVisibilityForScope,
  isMessageInChatScope,
  isMessageInAiContext,
  selectChatScope,
  updateChatScopeDraft,
} = module.exports;

test("private scope selection locks the target to Amora and fails closed without a verified role", () => {
  assert.deepEqual(
    selectChatScope({ scope: "shared", target: "partner" }, "private", "bride"),
    { scope: "private", target: "ai" },
  );
  assert.deepEqual(
    selectChatScope({ scope: "shared", target: "partner" }, "private", null),
    { scope: "shared", target: "partner" },
  );
});

test("scope visibility separates rendering while private AI context can retain shared history", () => {
  assert.equal(chatVisibilityForScope("shared", "bride"), "shared");
  assert.equal(chatVisibilityForScope("private", "bride"), "bride_private");
  assert.equal(chatVisibilityForScope("private", "groom"), "groom_private");
  assert.equal(chatVisibilityForScope("private", null), null);

  assert.equal(isMessageInChatScope("shared", "shared", "bride"), true);
  assert.equal(isMessageInChatScope("bride_private", "shared", "bride"), false);
  assert.equal(isMessageInChatScope("bride_private", "private", "bride"), true);
  assert.equal(isMessageInChatScope("groom_private", "private", "bride"), false);

  assert.equal(isMessageInAiContext("shared", "bride_private"), true);
  assert.equal(isMessageInAiContext("bride_private", "bride_private"), true);
  assert.equal(isMessageInAiContext("groom_private", "bride_private"), false);
  assert.equal(isMessageInAiContext("bride_private", "shared"), false);
});

test("unsent private and shared drafts remain isolated across scope changes", () => {
  let drafts = { shared: "", private: "" };
  drafts = updateChatScopeDraft(drafts, "private", "개인 상담 초안");
  assert.equal(drafts.shared, "");
  assert.equal(drafts.private, "개인 상담 초안");

  drafts = updateChatScopeDraft(drafts, "shared", "함께 대화 초안");
  assert.equal(drafts.shared, "함께 대화 초안");
  assert.equal(drafts.private, "개인 상담 초안");
});
