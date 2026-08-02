import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

function read(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

test("Bearer API and chat transports share the fail-closed mobile site origin", () => {
  for (const source of [
    read("../lib/api.ts"),
    read("../../app/(tabs)/chat.tsx"),
  ]) {
    assert.match(
      source,
      /resolveMobileSiteOrigin\(\s*process\.env\.EXPO_PUBLIC_SITE_URL,\s*\{\s*isDevelopment:\s*__DEV__\s*\}/,
    );
    assert.doesNotMatch(
      source,
      /process\.env\.EXPO_PUBLIC_SITE_URL\s*\|\|/,
    );
  }
});
