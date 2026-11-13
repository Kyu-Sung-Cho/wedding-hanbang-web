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
  new URL("../lib/dashboardExperience.mjs", import.meta.url),
  new URL("../../app/profile.tsx", import.meta.url),
  new URL("../../app/bookings/index.tsx", import.meta.url),
];

test("mobile price entry opens the current vendor disclosure explorer", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.match(source, /resolveMobileSiteOrigin\(\s*process\.env\.EXPO_PUBLIC_SITE_URL/);
  // 카테고리로 바로 들어가면 허브의 위약금 안내를 건너뛴다 — h1과 대행사별 차이
  // 예시, "업체 상세의 '계약 전 확인'에서 비교하세요"가 전부 허브에 있다(`c019c68c`).
  // 앱 메뉴가 "공시가·위약금"이라고 약속하므로 도착 화면도 그걸 말해야 한다.
  assert.match(source, /buildMobileSiteUrl\("\/price"/);
  assert.doesNotMatch(source, /\/price\/studio/);
  assert.doesNotMatch(source, /https:\/\/hanbang\.ai\/price/);

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

// 웹은 2026-07-26에 위약금 원문 831건(502개 업체)을 공개하고 첫 화면 h1까지
// 그 사실로 바꿨다. 그런데 앱 진입점은 "업체 탐색 / 업체 찾기"로 남아, 앱 사용자는
// 그게 있는 줄 알 방법이 없었다 — 주간 최대 가치가 앱에서 발견 불가였다.
test("mobile price entries say what the destination actually holds", async () => {
  const entries = [
    ["dashboard", new URL("../lib/dashboardExperience.mjs", import.meta.url)],
    ["profile", new URL("../../app/profile.tsx", import.meta.url)],
  ];

  for (const [name, url] of entries) {
    const source = await readFile(url, "utf8");
    const entryBlock = source.slice(Math.max(0, source.indexOf("/market-prices") - 400));
    assert.match(
      entryBlock,
      /위약금/,
      `${name}의 공시가 진입점이 위약금을 말하지 않는다 — 앱에서 그 값이 보이지 않는다`,
    );
    assert.doesNotMatch(
      entryBlock.split("/market-prices")[0].slice(-200),
      /업체 찾기/,
      `${name}이 여전히 "업체 찾기"로 소개한다`,
    );
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
  // 공유는 지금 보는 화면을 따라가되, `#` 뒤(답·접근 키)는 빼고 보낸다(webviewShare.test.mjs).
  assert.match(webviewSource, /const shareUrl = shareableWebViewUrl\(currentUrl, SITE_ORIGIN\);/);
  assert.match(webviewSource, /Share\.share\(\{ url: shareUrl, message: shareUrl \}\)/);
  assert.match(webviewSource, /accessibilityLabel="이전 화면"/);
  assert.match(webviewSource, /accessibilityLabel="현재 페이지 공유"/);
});
