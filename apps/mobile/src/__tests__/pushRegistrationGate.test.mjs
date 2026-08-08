import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

import { isPushRegistrationEnabled } from "../lib/pushRegistrationGate.mjs";

test("push registration is default-off and accepts only exact true", () => {
  for (const value of [undefined, "", "false", "TRUE", "1", " true "]) {
    assert.equal(isPushRegistrationEnabled(value), false);
  }
  assert.equal(isPushRegistrationEnabled("true"), true);
});

test("the auth listener applies the release gate before importing push code", async () => {
  const source = await readFile(
    new URL("../lib/authListener.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /isPushRegistrationEnabled\(\s*process\.env\.EXPO_PUBLIC_PUSH_REGISTRATION_ENABLED,?\s*\)/,
  );
  assert.match(
    source,
    /pushRegistrationEnabled[\s\S]*import\("\.\/notifications"\)/,
  );
});

test("notification target verification fails closed without the configured mobile origin", async () => {
  const source = await readFile(
    new URL("../lib/notifications.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /createCommunityPushTargetResolver\(\s*\{[\s\S]*configuredSiteUrl:\s*process\.env\.EXPO_PUBLIC_SITE_URL,[\s\S]*isDevelopment:\s*__DEV__/,
  );
  assert.doesNotMatch(
    source,
    /EXPO_PUBLIC_SITE_URL\s*\?\?\s*["']https:\/\/hanbang\.ai["']/,
  );
});
