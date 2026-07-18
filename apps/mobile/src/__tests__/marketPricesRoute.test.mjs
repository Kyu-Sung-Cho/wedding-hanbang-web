import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

const sourceUrl = new URL("../../app/market-prices/index.tsx", import.meta.url);
const webviewUrl = new URL("../../app/webview.tsx", import.meta.url);
const legacyListUrl = new URL("../../app/vendors/index.tsx", import.meta.url);
const legacyDetailUrl = new URL("../../app/vendors/[id].tsx", import.meta.url);
const entryUrls = [
  new URL("../../app/(tabs)/dashboard.tsx", import.meta.url),
  new URL("../../app/(tabs)/profile.tsx", import.meta.url),
  new URL("../../app/bookings/index.tsx", import.meta.url),
];

test("mobile price entry opens the current vendor disclosure explorer", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.match(source, /resolveMobileSiteOrigin\(\s*process\.env\.EXPO_PUBLIC_SITE_URL/);
  assert.match(source, /buildMobileSiteUrl\("\/price\/studio"/);
  assert.doesNotMatch(source, /https:\/\/hanbang\.ai\/price\/studio/);

  const webviewSource = await readFile(webviewUrl, "utf8");
  assert.match(webviewSource, /resolveMobileSiteOrigin\(\s*process\.env\.EXPO_PUBLIC_SITE_URL/);
  assert.match(webviewSource, /normalizeMobileSiteUrl\(url, SITE_ORIGIN\)/);
  assert.doesNotMatch(webviewSource, /const HANBANG_HOST/);
  assert.match(webviewSource, /pathname\.startsWith\("\/price\/"\)/);
  assert.match(webviewSource, /업체 공시가/);

  for (const legacyUrl of [legacyListUrl, legacyDetailUrl]) {
    const legacySource = await readFile(legacyUrl, "utf8");
    assert.match(legacySource, /Redirect href="\/market-prices"/);
    assert.doesNotMatch(legacySource, /\/api\/vendors/);
  }

  for (const entryUrl of entryUrls) {
    const entrySource = await readFile(entryUrl, "utf8");
    assert.match(entrySource, /\/market-prices/);
    assert.doesNotMatch(entrySource, /(?:route:\s*|pathname:\s*|router\.push\()["']\/vendors["']/);
  }
});
