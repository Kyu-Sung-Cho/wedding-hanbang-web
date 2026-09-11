import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";
import ts from "typescript";

const { AbortController, Response } = globalThis;

// 제품 함수를 그대로 컴파일하고 네트워크 경계만 합성 응답으로 대체한다.
const source = readFileSync(new URL("../lib/signupConsentAccess.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source.replace(/^import .*;\r?\n/gm, ""), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function load(fetcher) {
  const exports = {};
  const supabase = { auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } };
  new Function("exports", "apiFetchForExpectedUser", "supabase", code)(exports, fetcher, supabase);
  return exports.readMobileSignupConsentAccess;
}

test("native는 정확한 현재 주체의 서버 동의 판정만 읽는다", async () => {
  for (const access of ["server_verified", "legacy_unverified", "required"]) {
    const signal = new AbortController().signal;
    const read = load(async (id, path, options) => {
      assert.equal(id, "owner");
      assert.equal(path, "/api/auth/me?consent_only=1");
      assert.equal(options.signal.aborted, false);
      assert.equal(signal.aborted, false);
      return Response.json({ user: { id: "owner" }, capabilities: { signupConsentAccess: access } });
    });
    assert.equal(await read("owner", signal), access);
  }
});

test("다른 주체·구서버·설정오류·위조 user_metadata는 동의 성공으로 대체하지 않는다", async () => {
  for (const body of [
    { user: { id: "other" }, capabilities: { signupConsentAccess: "server_verified" } },
    { user: { id: "owner", user_metadata: { terms_agreed: true, privacy_agreed: true } }, capabilities: { requiresSignupConsent: false } },
    { user: { id: "owner" }, capabilities: { signupConsentAccess: "configuration_error" } },
    { user: { id: "owner" }, capabilities: { signupConsentAccess: true } },
    null,
  ]) {
    await assert.rejects(load(async () => Response.json(body))("owner"), /SIGNUP_CONSENT_READ_FAILED/);
  }
  await assert.rejects(load(async () => Response.json({}, { status: 503 }))("owner"), /SIGNUP_CONSENT_READ_FAILED/);
});

test("취소/실패한 읽기는 legacy나 verified로 반환하지 않는다", async () => {
  await assert.rejects(load(async () => { throw new Error("synthetic aborted"); })("owner"), /synthetic aborted/);
});
