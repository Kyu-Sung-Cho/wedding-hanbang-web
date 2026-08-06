import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

// 웹 로그인 화면에는 카카오·구글·Apple 세 개가 있는데 앱에는 구글이 아예 없었다.
// 웹에서 구글로 시작한 사람이 앱을 깔면 자기가 쓰던 버튼이 없고, 이메일+비밀번호는
// 통하지 않는다 — 그 계정에는 비밀번호가 애초에 만들어지지 않기 때문이다.
//
// 그렇다고 버튼만 켜면 안 된다. Supabase Auth와 Google Cloud Console 설정이 끝나기
// 전에는 눌러도 로그인이 끝나지 않는다. 그래서 카카오와 똑같이 기본은 꺼둔다.

function readSource(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const authSource = readSource("../lib/auth.ts");
const loginSource = readSource("../../app/(auth)/login.tsx");
const envExample = readSource("../../.env.example");

test("구글이 앱의 로그인 수단으로 존재한다", () => {
  assert.match(authSource, /Extract<Provider,[^>]*["']google["']/);
  assert.match(loginSource, /isOAuthProviderEnabled\(["']google["']\)/);
  // 버튼이 실제로 렌더된다 — 타입만 넓히면 화면은 그대로다.
  assert.match(loginSource, /handleSocialLogin\(["']google["']\)/);
  assert.match(loginSource, /googleOAuthEnabled \?/);
  // 소셜 영역 자체가 구글만 켜져 있어도 열려야 한다.
  assert.match(loginSource, /hasSocialLogin[\s\S]{0,120}googleOAuthEnabled/);
});

test("구글은 명시적으로 켜기 전까지 꺼져 있다", () => {
  // 카카오와 같은 규율: `=== "true"`. Apple의 `!== "false"`(기본 켜짐)를 물려받으면
  // 설정이 끝나기 전에 버튼이 노출된다.
  assert.match(authSource, /EXPO_PUBLIC_GOOGLE_OAUTH_ENABLED\s*===\s*["']true["']/);
  assert.doesNotMatch(authSource, /EXPO_PUBLIC_GOOGLE_OAUTH_ENABLED\s*!==\s*["']false["']/);
  // 무엇을 켜야 하는지 환경변수 문서에 남는다.
  assert.match(envExample, /EXPO_PUBLIC_GOOGLE_OAUTH_ENABLED=false/);
});

test("꺼져 있을 때 구글을 Apple이라고 부르지 않는다", () => {
  const unavailable = authSource.slice(
    authSource.indexOf("소셜 로그인은 설치한 앱에서"),
    authSource.indexOf("throw new Error(message)"),
  );
  assert.match(unavailable, /provider === ["']google["']/);
  assert.match(unavailable, /구글 로그인은 현재 준비 중이에요/);
});

test("비밀번호가 없는 계정에게 비밀번호를 틀렸다고 하지 않는다", () => {
  const translate = loginSource.slice(
    loginSource.indexOf("function translateError"),
    loginSource.indexOf("function isValidEmail"),
  );

  const invalidLoginCopy = translate.slice(
    translate.indexOf('message.includes("Invalid login")'),
  ).split("\n").slice(0, 4).join("\n");

  // 나가는 길을 가리킨다. 이 화면에 실제로 있는 링크여야 한다.
  assert.match(invalidLoginCopy, /비밀번호 찾기/);
  assert.match(loginSource, /pathname: ["']\/\(auth\)\/forgot-password["']/);

  // 그러나 이 계정이 어느 수단으로 만들어졌는지는 말하지 않는다 — 말하면 가입 여부가
  // 밖으로 드러난다. 웹 가입 API가 지키는 기준과 같다.
  assert.doesNotMatch(invalidLoginCopy, /이 계정은/);
  assert.doesNotMatch(invalidLoginCopy, /가입(된|되어|하신)/);
});

test("소셜 로그인 실패는 Supabase 원문을 화면에 그대로 올리지 않는다", () => {
  const socialHandler = loginSource.slice(
    loginSource.indexOf("async function handleSocialLogin"),
    loginSource.indexOf("return ("),
  );

  // 앱이 직접 쓴 안내(provider 미개방)만 그대로 보여준다.
  assert.match(socialHandler, /err\.name === OAUTH_PROVIDER_UNAVAILABLE/);
  assert.match(authSource, /unavailable\.name = OAUTH_PROVIDER_UNAVAILABLE/);

  // 그 외에는 앱이 소유한 문장으로 대체한다 — 예전에는 err.message를 무조건 띄웠다.
  assert.match(socialHandler, /SOCIAL_PROVIDER_LABEL\[provider\]/);
  assert.doesNotMatch(
    socialHandler,
    /const message = err instanceof Error \? err\.message :/,
  );
});
