// 가입 메일 진단 도구가 실제로 원인을 갈라내는가.
//
// 이 도구를 만든 이유는 2026-09-02 에 "가입이 502 인데 왜인지 아무도 모른다"는
// 상태가 있었기 때문이다. 도구가 틀린 판정을 내면 그 상태가 그대로 유지되므로,
// 판정 함수는 실제 Resend 응답 모양으로 고정해 둔다.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { readSenderDomain, verdict } from "../check-email-delivery.mjs";

const repoRoot = resolve(import.meta.dirname, "../..");
const SENDER_FILE = "apps/web/src/lib/email/sender.ts";

test("앱이 쓰는 보내는 도메인을 소스에서 읽는다", () => {
  // 값을 베껴 적으면 앱이 주소를 바꿀 때 도구가 조용히 엉뚱한 도메인을 본다.
  const source = readFileSync(resolve(repoRoot, SENDER_FILE), "utf8");
  assert.equal(readSenderDomain(source), "hanbang.ai");
});

test("표시 이름이 한글이어도 도메인만 정확히 떼어낸다", () => {
  assert.equal(
    readSenderDomain('export const ACCOUNT_EMAIL_SENDER = "웨딩한방 <noreply@hanbang.ai>";'),
    "hanbang.ai",
  );
  assert.equal(
    readSenderDomain('export const ACCOUNT_EMAIL_SENDER = "noreply@example.test";'),
    "example.test",
  );
});

test("보내는 주소를 못 찾으면 조용히 넘어가지 않는다", () => {
  // 조용히 기본값을 쓰면 검증된 적 없는 도메인을 "정상"이라고 말하게 된다.
  assert.throws(() => readSenderDomain("export const SOMETHING_ELSE = 1;"));
});

test("키가 없으면 설정 문제라고 말한다", () => {
  const result = verdict({ apiKeyPresent: false, senderDomain: "hanbang.ai" });
  assert.equal(result.code, "EMAIL_DELIVERY_UNCONFIGURED");
});

test("키가 거절되면 자격 문제라고 말한다", () => {
  // 2026-09-02 실측. 같은 "키가 틀렸다"가 부르는 자리마다 다른 상태 코드로 온다.
  // 상태 코드만 보면 400 을 제공자 장애로 오판한다 — 처음 만들 때 실제로 그랬다.
  const OBSERVED = [
    { status: 400, error: { statusCode: 400, name: "validation_error", message: "API key is invalid" } },
    { status: 401, error: { statusCode: 401, name: "missing_api_key", message: "Missing API Key" } },
    { status: 401, error: { statusCode: 401, name: "validation_error", message: "API key is invalid" } },
    { status: 403, error: { statusCode: 403, name: "restricted_api_key", message: "This API key is restricted" } },
  ];

  for (const { status, error } of OBSERVED) {
    assert.equal(
      verdict({ apiKeyPresent: true, status, error, senderDomain: "hanbang.ai" }).code,
      "EMAIL_DELIVERY_CREDENTIAL",
      `${status} ${error.name}`,
    );
  }
});

test("보내는 도메인이 계정에 없으면 도메인 문제라고 말한다", () => {
  const result = verdict({
    apiKeyPresent: true,
    status: 200,
    domains: [{ name: "other.example", status: "verified" }],
    senderDomain: "hanbang.ai",
  });
  assert.equal(result.code, "EMAIL_DELIVERY_SENDER_DOMAIN");
  // 어느 계정을 보고 있는지 알려줘야 "키가 다른 계정 것"을 알아챌 수 있다.
  assert.match(result.next, /other\.example/);
});

test("도메인이 있어도 verified 가 아니면 도메인 문제라고 말한다", () => {
  for (const status of ["pending", "failed", "not_started", "temporary_failure"]) {
    const result = verdict({
      apiKeyPresent: true,
      status: 200,
      domains: [{ name: "hanbang.ai", status }],
      senderDomain: "hanbang.ai",
    });
    assert.equal(result.code, "EMAIL_DELIVERY_SENDER_DOMAIN", status);
    assert.match(result.summary, new RegExp(status));
  }
});

test("대소문자가 달라도 같은 도메인으로 본다", () => {
  const result = verdict({
    apiKeyPresent: true,
    status: 200,
    domains: [{ name: "Hanbang.AI", status: "verified" }],
    senderDomain: "hanbang.ai",
  });
  assert.equal(result.code, "OK");
});

test("설정이 정상이면 남은 원인이 한도라고 말해 준다", () => {
  const result = verdict({
    apiKeyPresent: true,
    status: 200,
    domains: [{ name: "hanbang.ai", status: "verified", region: "ap-northeast-1" }],
    senderDomain: "hanbang.ai",
  });
  assert.equal(result.code, "OK");
  // "정상"으로 끝내면 조사가 여기서 멈춘다. 다음에 볼 곳을 말해야 한다.
  assert.match(result.next, /한도|rate_limit/);
});

test("제공자 장애와 설정 문제를 섞지 않는다", () => {
  assert.equal(
    verdict({ apiKeyPresent: true, status: 503, senderDomain: "hanbang.ai" }).code,
    "EMAIL_DELIVERY_PROVIDER_ERROR",
  );
});

test("판정 코드가 런타임이 쓰는 어휘와 같다", () => {
  // Sentry 에 찍힌 코드와 이 도구의 출력을 맞춰 보려면 두 곳이 같은 말을 해야 한다.
  const runtime = readFileSync(
    resolve(repoRoot, "apps/web/src/lib/email/deliveryFailure.ts"),
    "utf8",
  );
  const toolCodes = new Set(
    [...readFileSync(resolve(repoRoot, "scripts/check-email-delivery.mjs"), "utf8")
      .matchAll(/"(EMAIL_DELIVERY_[A-Z_]+)"/gu)].map((match) => match[1]),
  );

  assert.ok(toolCodes.size >= 4, `도구에서 ${toolCodes.size}개만 찾았습니다`);
  for (const code of toolCodes) {
    assert.ok(
      runtime.includes(code),
      `런타임 분류기에 없는 코드를 도구가 씁니다: ${code}`,
    );
  }
});
