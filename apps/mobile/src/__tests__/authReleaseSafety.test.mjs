import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

function readSource(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

test("web logout runs without depending on the native Alert callback", () => {
  const logoutScreens = [
    readSource("../../app/(tabs)/profile.tsx"),
    readSource("../../app/settings/index.tsx"),
  ];

  for (const source of logoutScreens) {
    assert.match(source, /Platform\.OS\s*===\s*["']web["']/);
    assert.match(source, /const expectedActorUserId\s*=/u);
    assert.match(source, /void\s+performLogout\(expectedActorUserId\)/u);
    assert.match(
      source,
      /await\s+signOut\(\{ expectedOwnerId: expectedActorUserId \}\)/u,
    );
    assert.match(source, /setLogoutError\(/);
  }
});

test("social login exposes only configured native providers", () => {
  const authSource = readSource("../lib/auth.ts");
  const loginSource = readSource("../../app/(auth)/login.tsx");

  assert.match(authSource, /Platform\.OS\s*===\s*["']web["']\)\s*return false/);
  assert.match(authSource, /EXPO_PUBLIC_KAKAO_OAUTH_ENABLED\s*===\s*["']true["']/);
  assert.match(authSource, /EXPO_PUBLIC_APPLE_OAUTH_ENABLED\s*!==\s*["']false["']/);
  assert.match(loginSource, /isOAuthProviderEnabled\(["']kakao["']\)/);
  assert.match(loginSource, /isOAuthProviderEnabled\(["']apple["']\)/);
  assert.match(loginSource, /소셜 로그인은 설치한 앱에서 이용할 수 있어요/);
  assert.match(loginSource, /name=["']logo-apple["']/);
  assert.doesNotMatch(loginSource, /\\uF8FF/);
});

test("the root gate keeps auth and profile failures in a retryable error state", () => {
  const indexSource = readSource("../../app/index.tsx");

  assert.match(indexSource, /error:\s*sessionError/);
  assert.match(indexSource, /if\s*\(sessionError\)\s*throw sessionError/);
  assert.match(indexSource, /error:\s*profileError/);
  assert.match(indexSource, /if\s*\(profileError\)\s*throw profileError/);
  assert.match(indexSource, /setStatus\(["']error["']\)/);
  assert.match(indexSource, /setLoadAttempt\(\(attempt\)\s*=>\s*attempt\s*\+\s*1\)/);
  assert.match(indexSource, /다시 시도/);
});

test("the tab guard protects planning tabs while preserving the public community feed", () => {
  const layoutSource = readSource("../../app/(tabs)/_layout.tsx");

  assert.match(layoutSource, /isPublicCommunity\s*=\s*pathname\s*===\s*["']\/community["']/);
  assert.match(layoutSource, /supabase\.auth\.getSession\(\)/);
  assert.match(layoutSource, /onAuthStateChange/);
  assert.match(
    layoutSource,
    /authStatus\s*===\s*["']guest["']\s*&&\s*!isPublicCommunity/,
  );
  assert.match(layoutSource, /<Redirect\s+href=["']\/\(auth\)\/login["']/);
  assert.match(layoutSource, /href:\s*protectedTabHref/);
  assert.match(layoutSource, /name=["']community["']/);
});
