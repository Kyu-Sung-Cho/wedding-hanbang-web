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

test("signup obtains one verified token before the API and clears it after use", () => {
  const source = readFileSync(signupPath, "utf8");

  assert.doesNotMatch(source, /publicApiFetch/);
  assert.match(source, /EXPO_PUBLIC_TURNSTILE_SITE_KEY/);
  assert.match(source, /hasValidTurnstileSiteKey\(TURNSTILE_SITE_KEY\)/);
  assert.match(source, /getTurnstileWebFallbackUrl\(\s*"signup",\s*process\.env\.EXPO_PUBLIC_SITE_URL/);
  assert.match(source, /async function submitSignupWithTurnstile\(turnstileToken: string\)/);
  assert.match(source, /isValidTurnstileToken\(turnstileToken\)/);
  assert.match(source, /turnstileTokenRef\.current = turnstileToken/);
  assert.match(source, /if \(!agreeTerms \|\| !agreePrivacy\)[\s\S]*return/);
  assert.match(source, /requestMobileSignup\([\s\S]*termsAgreed:\s*agreeTerms/);
  assert.match(source, /requestMobileSignup\([\s\S]*privacyAgreed:\s*agreePrivacy/);
  assert.match(source, /termsVersion:\s*CURRENT_TERMS_VERSION/);
  assert.match(source, /privacyVersion:\s*CURRENT_PRIVACY_VERSION/);
  assert.match(source, /requestMobileSignup\([\s\S]*turnstileTokenRef\.current/);
  assert.match(source, /finally \{[\s\S]*turnstileTokenRef\.current = ""/);
  assert.match(source, /<TurnstileModal[\s\S]*action="signup"/);
  assert.match(source, /onVerify=\{submitSignupWithTurnstile\}/);
  assert.match(source, /Linking\.openURL\(SIGNUP_WEB_URL\)/);

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
  assert.match(source, /hasValidTurnstileSiteKey\(TURNSTILE_SITE_KEY\)/);
  assert.match(source, /getTurnstileWebFallbackUrl\(\s*"forgot",\s*process\.env\.EXPO_PUBLIC_SITE_URL/);
  assert.match(source, /async function submitResetWithTurnstile\(turnstileToken: string\)/);
  assert.match(source, /isValidTurnstileToken\(turnstileToken\)/);
  assert.match(source, /turnstileTokenRef\.current = turnstileToken/);
  assert.match(source, /requestMobilePasswordReset\([\s\S]*turnstileTokenRef\.current/);
  assert.match(source, /finally \{[\s\S]*turnstileTokenRef\.current = ""/);
  assert.match(source, /<TurnstileModal[\s\S]*action="forgot"/);
  assert.match(source, /onVerify=\{submitResetWithTurnstile\}/);
  assert.match(source, /Linking\.openURL\(FORGOT_WEB_URL\)/);

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
