import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeExternalHttpsUrl,
  normalizeWebViewExternalUrl,
} from "../lib/externalUrls.mjs";

test("webview external navigation rejects insecure and executable schemes", () => {
  assert.equal(normalizeWebViewExternalUrl("http://attacker.example/path"), null);
  assert.equal(normalizeWebViewExternalUrl("javascript:alert(1)"), null);
  assert.equal(normalizeWebViewExternalUrl("data:text/html,bad"), null);
  assert.equal(normalizeWebViewExternalUrl("intent://attacker.example"), null);
  assert.equal(normalizeWebViewExternalUrl("https://user:pass@example.com/"), null);
  assert.equal(normalizeWebViewExternalUrl("mailto:user@example.com%0d%0abcc:evil@example.com"), null);
});

test("webview external navigation allows canonical HTTPS and contact links", () => {
  assert.equal(
    normalizeWebViewExternalUrl("https://example.com/path?q=1"),
    "https://example.com/path?q=1",
  );
  assert.equal(normalizeWebViewExternalUrl("mailto:hello@example.com"), "mailto:hello@example.com");
  assert.equal(normalizeWebViewExternalUrl("tel:+82-2-1234-5678"), "tel:+82-2-1234-5678");
});

test("provider links require HTTPS and an exact domain boundary", () => {
  assert.equal(
    normalizeExternalHttpsUrl("https://map.naver.com/p/search/test", ["naver.com"]),
    "https://map.naver.com/p/search/test",
  );
  assert.equal(
    normalizeExternalHttpsUrl("https://naver.com.evil.example/path", ["naver.com"]),
    null,
  );
  assert.equal(
    normalizeExternalHttpsUrl("http://map.naver.com/path", ["naver.com"]),
    null,
  );
});
