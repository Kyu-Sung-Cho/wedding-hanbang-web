import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMobileSiteUrl,
  normalizeMobileSiteUrl,
  resolveMobileSiteOrigin,
} from "../lib/siteUrl.mjs";

test("a staging EAS build keeps the exact configured HTTPS origin", () => {
  const origin = resolveMobileSiteOrigin(
    "https://vendor-preview.example.com/",
    { isDevelopment: false },
  );

  assert.equal(origin, "https://vendor-preview.example.com");
  assert.equal(
    buildMobileSiteUrl("/price/studio", origin),
    "https://vendor-preview.example.com/price/studio",
  );
});

test("production fails closed when EXPO_PUBLIC_SITE_URL is absent or unsafe", () => {
  assert.throws(
    () => resolveMobileSiteOrigin(undefined, { isDevelopment: false }),
    /EXPO_PUBLIC_SITE_URL_REQUIRED/,
  );

  for (const unsafe of [
    "javascript:alert(1)",
    "http://staging.example.com",
    "https://user:password@staging.example.com",
    "https://staging.example.com/app",
    "https://staging.example.com?environment=preview",
    "https://staging.example.com#preview",
  ]) {
    assert.throws(
      () => resolveMobileSiteOrigin(unsafe, { isDevelopment: false }),
      /EXPO_PUBLIC_SITE_URL_INVALID/,
    );
  }
});

test("development alone gets an explicit loopback HTTP fallback", () => {
  assert.equal(
    resolveMobileSiteOrigin(undefined, { isDevelopment: true }),
    "http://localhost:3000",
  );
  assert.equal(
    resolveMobileSiteOrigin("http://127.0.0.1:3000", { isDevelopment: true }),
    "http://127.0.0.1:3000",
  );
});

test("WebView navigation stays on the exact configured origin", () => {
  const origin = "https://vendor-preview.example.com";

  assert.equal(
    normalizeMobileSiteUrl(
      "https://vendor-preview.example.com/price/studio?region=seoul",
      origin,
    ),
    "https://vendor-preview.example.com/price/studio?region=seoul",
  );
  assert.equal(
    normalizeMobileSiteUrl("https://vendor-preview.example.com.evil.test/price/studio", origin),
    null,
  );
  assert.equal(
    normalizeMobileSiteUrl("https://user:password@vendor-preview.example.com/price/studio", origin),
    null,
  );
});
