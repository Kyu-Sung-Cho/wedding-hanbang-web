import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

const sourcePath = fileURLToPath(new URL("../lib/mobileAuthRequests.ts", import.meta.url));
// 가입 동의는 웹·모바일이 같은 공유 계약을 쓴다. 여기에 스텁을 끼우면 이 테스트가
// 지키는 것이 실제 payload 모양이 아니라 스텁 모양이 되므로, 계약 원문을 같은
// 방식으로 컴파일해 함께 넣는다.
const consentPath = fileURLToPath(
  new URL("../../../../packages/shared/src/contracts/signupConsent.ts", import.meta.url),
);

function declarationsOf(path) {
  const sourceText = readFileSync(path, "utf8");
  const sourceFile = ts.createSourceFile(
    path,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  return sourceFile.statements
    .filter((statement) =>
      ts.isFunctionDeclaration(statement) || ts.isVariableStatement(statement)
    )
    .map((statement) => statement.getFullText(sourceFile).replace(/\bexport\s+/g, ""))
    .join("\n");
}

function loadRequests(publicApiFetch, isValidTurnstileToken) {
  const declarations = [declarationsOf(consentPath), declarationsOf(sourcePath)].join("\n");
  const compiled = ts.transpileModule(declarations, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  });
  return new Function(
    "publicApiFetch",
    "isValidTurnstileToken",
    `${compiled.outputText}\nreturn {
      requestMobileSignup,
      requestMobilePasswordReset: typeof requestMobilePasswordReset === "function"
        ? requestMobilePasswordReset
        : undefined,
      SIGNUP_CONSENT_POLICY_VERSION,
    };`,
  )(publicApiFetch, isValidTurnstileToken);
}

function recordingRequests() {
  const calls = [];
  const requests = loadRequests(
    async (...args) => {
      calls.push(args);
      return { ok: true };
    },
    (token) => typeof token === "string" && token.startsWith("valid."),
  );
  return { calls, requests };
}

const FULL_CONSENT = { terms: true, privacy: true, age14: true, marketing: true };

test("signup cannot reach the public API without a verified Turnstile token", async () => {
  const { calls, requests } = recordingRequests();

  await assert.rejects(
    () => requests.requestMobileSignup({
      email: "sample@example.test",
      password: "Strong1!",
      name: "샘플 사용자",
      consent: { terms: true, privacy: true, age14: true, marketing: false },
    }, ""),
    /사람인지 확인을 먼저 완료해주세요/,
  );
  assert.deepEqual(calls, []);
});

// 예전에는 화면에서 필수 동의를 받아 놓고 서버로는 marketingAgreed 만 보냈다.
// 필수 동의 기록이 어느 경로로도 남지 않던 상태다.
test("signup sends the verified token with the existing hardened API payload", async () => {
  const { calls, requests } = recordingRequests();
  const token = `valid.${"a".repeat(32)}`;

  await requests.requestMobileSignup({
    email: "sample@example.test",
    password: "Strong1!",
    name: "샘플 사용자",
    consent: FULL_CONSENT,
  }, token);

  assert.deepEqual(calls, [[
    "/api/auth/signup",
    {
      method: "POST",
      body: JSON.stringify({
        email: "sample@example.test",
        password: "Strong1!",
        name: "샘플 사용자",
        termsAgreed: true,
        privacyAgreed: true,
        ageOver14Confirmed: true,
        marketingAgreed: true,
        consentPolicyVersion: requests.SIGNUP_CONSENT_POLICY_VERSION,
        turnstileToken: token,
      }),
    },
  ]]);
});

test("signup carries the required consent even when marketing is declined", async () => {
  const { calls, requests } = recordingRequests();
  const token = `valid.${"c".repeat(32)}`;

  await requests.requestMobileSignup({
    email: "sample@example.test",
    password: "Strong1!",
    name: "샘플 사용자",
    consent: { terms: true, privacy: true, age14: true, marketing: false },
  }, token);

  const body = JSON.parse(calls[0][1].body);
  assert.equal(body.termsAgreed, true);
  assert.equal(body.privacyAgreed, true);
  // 만 14세 확인이 빠지면 서버가 계정을 만들지 않는다.
  assert.equal(body.ageOver14Confirmed, true);
  assert.equal(body.marketingAgreed, false);
  assert.equal(typeof body.consentPolicyVersion, "string");
});

test("signup never reaches the API when a required consent is missing", async () => {
  // 동의 없이 만들어진 계정이 정확히 문제였다. 요청 자체가 나가면 안 된다.
  for (const consent of [
    { terms: false, privacy: true, marketing: true },
    { terms: true, privacy: false, marketing: false },
    { terms: false, privacy: false, marketing: false },
  ]) {
    const { calls, requests } = recordingRequests();
    const token = `valid.${"d".repeat(32)}`;

    await assert.rejects(
      () => requests.requestMobileSignup({
        email: "sample@example.test",
        password: "Strong1!",
        name: "샘플 사용자",
        consent,
      }, token),
      /SIGNUP_CONSENT_REQUIRED/,
    );
    assert.deepEqual(calls, [], JSON.stringify(consent));
  }
});

test("password reset is gated by and forwards a verified Turnstile token", async () => {
  const { calls, requests } = recordingRequests();
  const token = `valid.${"b".repeat(32)}`;

  assert.equal(typeof requests.requestMobilePasswordReset, "function");
  await assert.rejects(
    () => requests.requestMobilePasswordReset("sample@example.test", null),
    /사람인지 확인을 먼저 완료해주세요/,
  );
  assert.deepEqual(calls, []);

  await requests.requestMobilePasswordReset("sample@example.test", token);
  assert.deepEqual(calls, [[
    "/api/auth/forgot-password",
    {
      method: "POST",
      body: JSON.stringify({
        email: "sample@example.test",
        turnstileToken: token,
      }),
    },
  ]]);
});
