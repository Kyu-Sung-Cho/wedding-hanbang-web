import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

const helperPath = fileURLToPath(new URL("../lib/errorCopy.ts", import.meta.url));
const compiled = ts.transpileModule(readFileSync(helperPath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const module = { exports: {} };
new Function("exports", "module", "require", compiled.outputText)(
  module.exports,
  module,
  () => {
    throw new Error("unexpected dependency");
  },
);
const { toKoreanErrorMessage } = module.exports;

const settingsSource = readFileSync(
  fileURLToPath(new URL("../../app/settings/index.tsx", import.meta.url)),
  "utf8",
);
const writeSource = readFileSync(
  fileURLToPath(new URL("../../app/community/post/write.tsx", import.meta.url)),
  "utf8",
);

// 예전 조건은 전부 소문자였다. 실제로 오는 문구는 대문자로 시작해서 정확히 비껴갔고,
// 한국어 앱에 영어 문장이 떴다. 그래서 **실제 문구 그대로** 넣어 잰다.
test("대문자로 시작하는 실제 오류 문구를 놓치지 않는다", () => {
  assert.equal(
    toKoreanErrorMessage(new Error("Network request failed")),
    "네트워크가 불안정해요. 연결을 확인한 뒤 다시 시도해 주세요.",
  );
  assert.equal(
    toKoreanErrorMessage(new Error("Permission denied")),
    "로그인이 만료됐어요. 다시 로그인한 뒤 시도해 주세요.",
  );
  assert.equal(
    toKoreanErrorMessage(new Error("New password should be different from the old password.")),
    "지금 쓰는 비밀번호와 다른 비밀번호를 입력해 주세요.",
  );
});

test("못 알아본 영어 오류를 사용자에게 그대로 던지지 않는다", () => {
  const result = toKoreanErrorMessage(new Error("PGRST301: JWSError JWSInvalidSignature"));
  assert.ok(!/JWSError|PGRST/.test(result), `영어 원문이 새어 나갔습니다: ${result}`);
  assert.match(result, /[가-힣]/u);
});

test("우리가 쓴 한국어 문구는 그대로 보낸다", () => {
  // 서버가 상황을 더 잘 안다. 일반 문구로 덮으면 사용자가 고칠 수 있는 것도 못 고친다.
  const server = "이미 사용 중인 닉네임입니다.";
  assert.equal(toKoreanErrorMessage(new Error(server)), server);
});

test("자리에 맞는 기본 문구를 쓴다", () => {
  assert.equal(
    toKoreanErrorMessage(null, "글을 올리지 못했어요."),
    "글을 올리지 못했어요.",
  );
  assert.equal(toKoreanErrorMessage(new Error("   "), "저장하지 못했어요."), "저장하지 못했어요.");
});

// 화면이 이 함수를 실제로 부르지 않으면 위 검사는 아무것도 지키지 않는다.
test("영어를 그대로 띄우던 세 자리가 모두 이 함수를 지난다", () => {
  assert.match(settingsSource, /toKoreanErrorMessage\(err, "저장 중/);
  assert.match(settingsSource, /toKoreanErrorMessage\(err, "비밀번호를 바꾸지/);
  assert.match(writeSource, /toKoreanErrorMessage\(err, "글을 올리지/);
  // 옛 소문자 조건이 되살아나면 잡는다.
  assert.doesNotMatch(settingsSource, /includes\("network"\)/);
  assert.doesNotMatch(writeSource, /includes\("network"\)/);
});
