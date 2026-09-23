import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const compiled = ts.transpileModule(readFileSync(new URL("../privacyConfirmationTarget.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const loaded = { exports: {} };
new Function("exports", "module", "require", compiled.outputText)(loaded.exports, loaded, () => {
  throw new Error("unexpected dependency");
});
const { readPrivacyConfirmationTarget } = loaded.exports;
const valid = { ownerId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", coupleId: "11111111-2222-4333-8444-555555555555", privacyEpoch: 1 };

test("confirmation target requires a complete object, not a primitive or array", () => {
  for (const value of [null, undefined, false, "", "target", 1, [], [valid], {}, { ownerId: valid.ownerId }, { ...valid, coupleId: undefined }, { ...valid, privacyEpoch: undefined }]) {
    assert.equal(readPrivacyConfirmationTarget(value), null);
  }
});

test("both owner and couple must be canonical UUID-shaped identifiers", () => {
  for (const field of ["ownerId", "coupleId"]) {
    for (const value of [null, 123, "", "not-a-uuid", "../../someone", ` ${valid[field]}`, `${valid[field]}\n`, "00000000-0000-0000-0000-000000000000", "aaaaaaaa-bbbb-6ccc-8ddd-eeeeeeeeeeee", "aaaaaaaa-bbbb-4ccc-7ddd-eeeeeeeeeeee"]) {
      assert.equal(readPrivacyConfirmationTarget({ ...valid, [field]: value }), null, `${field}=${JSON.stringify(value)}`);
    }
  }
});

test("privacy epoch rejects coerced, fractional, non-finite and unsafe integers", () => {
  for (const privacyEpoch of [null, true, "1", 0, -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(readPrivacyConfirmationTarget({ ...valid, privacyEpoch }), null, `epoch=${String(privacyEpoch)}`);
  }
  for (const privacyEpoch of [1, 2, Number.MAX_SAFE_INTEGER]) {
    assert.deepEqual(readPrivacyConfirmationTarget({ ...valid, privacyEpoch }), { ...valid, privacyEpoch });
  }
});

test("valid targets normalize UUID case, retain the exact epoch and return only a detached tuple", () => {
  const input = { ownerId: valid.ownerId.toUpperCase(), coupleId: valid.coupleId.toUpperCase(), privacyEpoch: 17, unrelated: "not authority" };
  const result = readPrivacyConfirmationTarget(input);
  assert.deepEqual(result, { ...valid, privacyEpoch: 17 });
  assert.notEqual(result, input);
  input.privacyEpoch = 18;
  assert.equal(result.privacyEpoch, 17);
});
