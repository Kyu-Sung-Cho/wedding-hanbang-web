import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

const sourceUrl = new URL("../../app/market-prices/index.tsx", import.meta.url);
const webviewUrl = new URL("../../app/webview.tsx", import.meta.url);
const apiUrl = new URL("../lib/api.ts", import.meta.url);
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

  const legacyListSource = await readFile(legacyListUrl, "utf8");
  assert.match(legacyListSource, /Redirect href="\/market-prices"/);
  assert.doesNotMatch(legacyListSource, /\/api\/vendors/);

  const legacyDetailSource = await readFile(legacyDetailUrl, "utf8");
  assert.match(legacyDetailSource, /buildLegacyVendorDetailUrl\(rawId, siteOrigin\)/);
  assert.match(legacyDetailSource, /pathname: "\/webview"/);
  assert.doesNotMatch(legacyDetailSource, /\/api\/vendors/);

  for (const entryUrl of entryUrls) {
    const entrySource = await readFile(entryUrl, "utf8");
    assert.match(entrySource, /\/market-prices/);
    assert.doesNotMatch(entrySource, /(?:route:\s*|pathname:\s*|router\.push\()["']\/vendors["']/);
  }
});

test("webview proxies only validated vendor API requests through the native session", async () => {
  const webviewSource = await readFile(webviewUrl, "utf8");
  const apiSource = await readFile(apiUrl, "utf8");

  assert.match(webviewSource, /parseMobileWebApiRequest/);
  assert.match(webviewSource, /buildMobileWebApiResponseScript/);
  assert.match(webviewSource, /apiFetchForWebBridge/);
  assert.match(webviewSource, /isMobileWebApiBridgeSourceUrl\(event\.nativeEvent\.url, SITE_ORIGIN\)/);
  assert.match(webviewSource, /parseMobileWebApiRequest\([\s\S]*event\.nativeEvent\.data,[\s\S]*bridgeNonce,[\s\S]*event\.nativeEvent\.url/);
  assert.match(webviewSource, /createMobileWebApiRequestGate/);
  assert.match(webviewSource, /createMobileWebApiAuthRedirectGate/);
  assert.match(webviewSource, /response\.status === 401/);
  assert.match(webviewSource, /bridgeAuthRedirectGate\.claim\(\)/);
  assert.match(webviewSource, /router\.replace\("\/\(auth\)\/login"\)/);
  assert.match(webviewSource, /let redirectToNativeLogin = false/);
  assert.match(webviewSource, /readMobileWebApiResponseBody/);
  assert.match(webviewSource, /onMessage=\{handleMessage\}/);
  assert.match(webviewSource, /injectedJavaScriptBeforeContentLoadedForMainFrameOnly/);
  assert.match(webviewSource, /injectedJavaScriptForMainFrameOnly/);
  assert.match(webviewSource, /injectJavaScript\(responseScript\)/);
  assert.doesNotMatch(webviewSource, /access_token/);
  assert.doesNotMatch(webviewSource, /Authorization:\s*[`'"]/);
  assert.ok(
    webviewSource.lastIndexOf("injectJavaScript(responseScript)")
      < webviewSource.indexOf('router.replace("/(auth)/login")'),
    "the bounded 401 must settle the web promise before native login navigation",
  );
  assert.match(apiSource, /fetchMobileWebApiWithSession/);
  assert.match(apiSource, /createMobileWebApiSessionRefreshGate/);
  assert.match(apiSource, /supabase\.auth\.refreshSession\(\)/);
  assert.match(apiSource, /data\.session\?\.user\.id/);
  assert.match(apiSource, /initialSession/);
  assert.match(apiSource, /current\.userId !== expected\.userId/);
  assert.doesNotMatch(apiSource, /webBridgeRefreshPromise/);
});

test("vendor webview back and share actions follow the current in-page navigation", async () => {
  const webviewSource = await readFile(webviewUrl, "utf8");

  assert.match(webviewSource, /const \[currentUrl, setCurrentUrl\]/);
  assert.match(webviewSource, /const \[canGoBack, setCanGoBack\]/);
  assert.match(webviewSource, /onNavigationStateChange=\{handleNavigationStateChange\}/);
  assert.match(webviewSource, /webViewRef\.current\?\.goBack\(\)/);
  assert.match(webviewSource, /Share\.share\(\{ url: currentUrl, message: currentUrl \}\)/);
  assert.match(webviewSource, /accessibilityLabel="이전 화면"/);
  assert.match(webviewSource, /accessibilityLabel="현재 페이지 공유"/);
});
