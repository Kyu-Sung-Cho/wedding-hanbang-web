import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

const sharedSource = readFileSync(
  fileURLToPath(new URL("../../../../packages/shared/src/contracts/passwordError.ts", import.meta.url)),
  "utf8",
);
const sharedCompiled = ts.transpileModule(sharedSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const sharedModule = { exports: {} };
new Function("exports", "module", sharedCompiled.outputText)(sharedModule.exports, sharedModule);

const helperPath = fileURLToPath(new URL("../lib/errorCopy.ts", import.meta.url));
const compiled = ts.transpileModule(readFileSync(helperPath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const module = { exports: {} };
new Function("exports", "module", "require", compiled.outputText)(
  module.exports,
  module,
  (id) => {
    assert.equal(id, "@hanbang/shared");
    return sharedModule.exports;
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

test("실제 shared helper로 유출 비밀번호 오류를 처리하고 원문은 숨긴다", () => {
  const error = Object.assign(new Error("민감한 진단: token=secret"), {
    name: "AuthWeakPasswordError", code: "weak_password", reasons: ["pwned"],
  });
  assert.equal(
    toKoreanErrorMessage(error, "기본 안내"),
    "유출된 적이 있는 비밀번호는 사용할 수 없어요. 다른 사이트에서 쓰지 않는 새 비밀번호를 입력해 주세요.",
  );
  assert.equal(toKoreanErrorMessage({ code: "weak_password", reasons: ["pwned"] }), toKoreanErrorMessage(error));
});

test("같은 비밀번호 구조화 코드는 SDK 원문과 무관하게 기존 한국어 안내를 유지한다", () => {
  assert.equal(
    toKoreanErrorMessage({ code: "same_password", message: "민감한 서버 진단" }),
    "지금 쓰는 비밀번호와 다른 비밀번호를 입력해 주세요.",
  );
});

test("기타 약한 비밀번호 사유는 강도만 안내하고 성공 로그인 경고는 오류로 취급하지 않는다", () => {
  assert.equal(
    toKoreanErrorMessage({ code: "weak_password", reasons: ["characters"] }),
    "보안 기준에 맞지 않는 비밀번호예요. 더 길고 추측하기 어려운 새 비밀번호를 입력해 주세요.",
  );
  assert.equal(toKoreanErrorMessage({ reasons: ["pwned"], message: "weak" }, "기본 안내"), "기본 안내");
  assert.equal(toKoreanErrorMessage({ name: "AuthWeakPasswordError", code: "email_exists" }, "기본 안내"), "기본 안내");
});
