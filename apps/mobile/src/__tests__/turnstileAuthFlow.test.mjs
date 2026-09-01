import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

const componentPath = fileURLToPath(
  new URL("../components/auth/TurnstileModal.tsx", import.meta.url),
);
const signupPath = fileURLToPath(new URL("../../app/(auth)/signup.tsx", import.meta.url));
const forgotPath = fileURLToPath(
  new URL("../../app/(auth)/forgot-password.tsx", import.meta.url),
);
const apiPath = fileURLToPath(new URL("../lib/api.ts", import.meta.url));
const envPath = fileURLToPath(new URL("../../.env.example", import.meta.url));

test("the native Turnstile modal has accessible retry/cancel states and a trusted WebView", () => {
  assert.equal(existsSync(componentPath), true, "Turnstile modal is missing");
  const source = readFileSync(componentPath, "utf8");

  assert.match(source, /from "react-native-webview"/);
  assert.match(source, /source=\{\{ html, baseUrl: TURNSTILE_BASE_ORIGIN \}\}/);
  assert.match(source, /javaScriptEnabled/);
  assert.match(source, /domStorageEnabled/);
  assert.match(source, /isAllowedTurnstileNavigation\(request\.url\)/);
  assert.match(source, /parseTurnstileMessage\(event\.nativeEvent\.data\)/);
  assert.match(source, /message\.type === "success"[\s\S]*onVerify\(message\.token\)/);
  assert.match(source, /message\.type === "expired"/);
  assert.match(source, /message\.type === "error"/);
  assert.match(source, /accessibilityViewIsModal/);
  assert.match(source, /accessibilityLiveRegion="polite"/);
  assert.match(source, /accessibilityRole="button"/);
  assert.match(source, /취소/);
  assert.match(source, /다시 확인하기/);
  assert.match(source, /minHeight:\s*48/);
});

/**
 * 2026-09-02 — 규칙을 서버에 맞췄다.
 *
 * 예전 계약은 "사이트 키가 미발급이면 앱은 가입을 진행하지 말고 웹으로 넘긴다"
 * 였다. 그런데 운영 확인 결과 웹에도 키가 없어 **서버는 토큰을 보지 않고 IP·
 * 이메일 속도 제한으로만 방어하며 가입을 통과시키고 있었다**(주석에 "키 미발급
 * 상태로 릴리스돼 가입이 통째로 막혔던 운영 사고" 기록이 있다). 그 상태에서 앱만
 * 막는 것은 봇을 막지 못한다 — 봇은 웹으로 가면 된다. 막히는 것은 앱 사용자뿐이다.
 *
 * **지켜야 할 것은 그대로다:** 사이트 키가 발급돼 있으면 검증된 토큰 없이 API 를
 * 부르지 않는다. 아래 검사가 그것을 본다. 바뀐 것은 미발급일 때의 행동뿐이다.
 */
test("signup obtains one verified token before the API and clears it after use", () => {
  const source = readFileSync(signupPath, "utf8");

  assert.doesNotMatch(source, /publicApiFetch/);
  assert.match(source, /EXPO_PUBLIC_TURNSTILE_SITE_KEY/);
  assert.match(source, /turnstileTokenIsRequired\(TURNSTILE_SITE_KEY\)/);
  assert.match(source, /async function submitSignupWithTurnstile\(turnstileToken: string\)/);
  assert.match(source, /isValidTurnstileToken\(turnstileToken\)/);
  assert.match(source, /turnstileTokenRef\.current = turnstileToken/);
  assert.match(source, /requestMobileSignup\([\s\S]*turnstileTokenRef\.current/);
  assert.match(source, /finally \{[\s\S]*turnstileTokenRef\.current = ""/);
  assert.match(source, /<TurnstileModal[\s\S]*action="signup"/);
  assert.match(source, /onVerify=\{submitSignupWithTurnstile\}/);

  const handleStart = source.indexOf("async function handleSignup");
  const submitStart = source.indexOf("async function submitSignupWithTurnstile");
  assert.ok(handleStart >= 0 && submitStart > handleStart);
  const preChallengeHandler = source.slice(handleStart, submitStart);
  assert.match(preChallengeHandler, /setTurnstileVisible\(true\)/);
  assert.doesNotMatch(preChallengeHandler, /requestMobileSignup|\/api\/auth\/signup/);
});

test("password reset obtains one verified token before the API and clears it after use", () => {
  const source = readFileSync(forgotPath, "utf8");

  assert.doesNotMatch(source, /publicApiFetch/);
  assert.match(source, /EXPO_PUBLIC_TURNSTILE_SITE_KEY/);
  assert.match(source, /turnstileTokenIsRequired\(TURNSTILE_SITE_KEY\)/);
  assert.match(source, /async function submitResetWithTurnstile\(turnstileToken: string\)/);
  assert.match(source, /isValidTurnstileToken\(turnstileToken\)/);
  assert.match(source, /turnstileTokenRef\.current = turnstileToken/);
  assert.match(source, /requestMobilePasswordReset\([\s\S]*turnstileTokenRef\.current/);
  assert.match(source, /finally \{[\s\S]*turnstileTokenRef\.current = ""/);
  assert.match(source, /<TurnstileModal[\s\S]*action="forgot"/);
  assert.match(source, /onVerify=\{submitResetWithTurnstile\}/);

  const handleStart = source.indexOf("async function handleReset");
  const submitStart = source.indexOf("async function submitResetWithTurnstile");
  assert.ok(handleStart >= 0 && submitStart > handleStart);
  const preChallengeHandler = source.slice(handleStart, submitStart);
  assert.match(preChallengeHandler, /setTurnstileVisible\(true\)/);
  assert.doesNotMatch(preChallengeHandler, /requestMobilePasswordReset|\/api\/auth\/forgot-password/);
});

test("public API requests no longer claim an untrusted mobile identity", () => {
  const source = readFileSync(apiPath, "utf8");

  assert.doesNotMatch(source, /x-hanbang-client/i);
  assert.doesNotMatch(source, /Turnstile.*(?:생략|skip)/i);
  assert.match(source, /export async function publicApiFetch/);
  assert.match(source, /"Content-Type": "application\/json"/);
});

test("mobile environment example exposes only the public Turnstile site key", () => {
  const source = readFileSync(envPath, "utf8");

  assert.match(source, /^EXPO_PUBLIC_TURNSTILE_SITE_KEY=/m);
  assert.match(source, /Cloudflare Turnstile/);
  assert.doesNotMatch(source, /^TURNSTILE_SECRET_KEY=/m);
});
