import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

const liveSmokePath = fileURLToPath(
  new URL("../live-smoke-test.mjs", import.meta.url),
);
const liveSmokeSource = readFileSync(liveSmokePath, "utf8");

test("live smoke blocks mobile release when runtime and signed-link contracts are absent", () => {
  assert.match(liveSmokeSource, /name:\s*"mobile-runtime-contract"/);
  assert.match(liveSmokeSource, /path:\s*"\/api\/mobile\/runtime-contract"/);
  assert.match(liveSmokeSource, /shared-supabase-auth-v1/);
  assert.match(liveSmokeSource, /wedding-journey-realtime-v1/);
  assert.match(liveSmokeSource, /mobile-web-bearer-v1/);

  assert.match(liveSmokeSource, /name:\s*"ios-universal-link-association"/);
  assert.match(liveSmokeSource, /path:\s*"\/\.well-known\/apple-app-site-association"/);
  assert.match(liveSmokeSource, /\.endsWith\("\.ai\.hanbang\.wedding"\)/);

  assert.match(liveSmokeSource, /name:\s*"android-app-link-association"/);
  assert.match(liveSmokeSource, /path:\s*"\/\.well-known\/assetlinks\.json"/);
  assert.match(liveSmokeSource, /package_name\s*===\s*"ai\.hanbang\.wedding"/);
  assert.match(liveSmokeSource, /sha256_cert_fingerprints/);

  assert.match(
    liveSmokeSource,
    /name:\s*"wedding-market-prices"[\s\S]*?path:\s*"\/wedding\/market-prices"[\s\S]*?hasPath\(result\.finalUrl,\s*"\/price"\)/,
  );
});
