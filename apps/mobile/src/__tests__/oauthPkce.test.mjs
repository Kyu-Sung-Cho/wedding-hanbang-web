import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const supabaseSource = fs.readFileSync(
  path.resolve(testDirectory, "../lib/supabase.ts"),
  "utf8",
);
const authSource = fs.readFileSync(
  path.resolve(testDirectory, "../lib/auth.ts"),
  "utf8",
);

test("mobile OAuth exchanges a PKCE code without accepting URL session tokens", () => {
  assert.match(supabaseSource, /flowType:\s*["']pkce["']/);
  assert.match(authSource, /exchangeCodeForSession\(code\)/);
  assert.match(
    authSource,
    /resolveMobileSiteOrigin\(\s*process\.env\.EXPO_PUBLIC_SITE_URL/,
  );
  assert.doesNotMatch(
    authSource,
    /process\.env\.EXPO_PUBLIC_SITE_URL\s*\|\|\s*["']https:\/\/hanbang\.ai/,
  );
  assert.doesNotMatch(authSource, /auth\.setSession\(/);
  assert.doesNotMatch(authSource, /params\.get\(["'](?:access_token|refresh_token)["']\)/);
});
