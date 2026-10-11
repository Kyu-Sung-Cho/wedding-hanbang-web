import assert from "node:assert/strict";
import test from "node:test";
import { getSafeAmoraReferenceHref, readAmoraReferenceAt } from "../amoraReferenceLinks.mjs";

test("reference links preserve exact detailed HTTPS and internal addresses, not guessed destinations", () => {
  for (const href of ["https://example.com/guide_(wedding)?date=2026#fee", "/price?region=seoul", "/wedding/checklist?category=invitation"]) {
    assert.equal(getSafeAmoraReferenceHref(href), href);
    assert.deepEqual(readAmoraReferenceAt(`[자료](${href})`, 0), { type: "link", text: "자료", href, length: href.length + 6 });
  }
  assert.equal(readAmoraReferenceAt("소비자원에서 확인하세요", 0), null);
});

test("unsafe URLs never become actionable references", () => {
  for (const href of ["javascript:alert(1)", "data:text/html,test", "http://example.com", "//example.com", "https://user:pass@example.com", "https://example.com/%0d%0aevil", "https://example.com/\u202etest", "/api/auth/logout", "/safe/../admin", "https://hanbang.ai/api/auth/logout", "/\\evil.example/path", "https://example.com\\@evil.example"]) {
    assert.equal(getSafeAmoraReferenceHref(href), null, href);
    const source = `[자료](${href})`;
    const token = readAmoraReferenceAt(source, 0);
    assert.ok(!token || token.type === "text", href);
    if (token) assert.equal(token.text, source);
  }
});

test("bare addresses trim sentence punctuation, but keep balanced URL parentheses", () => {
  assert.deepEqual(readAmoraReferenceAt("https://example.com/info.", 0), { type: "link", text: "https://example.com/info", href: "https://example.com/info", length: 24 });
  const href = "https://example.com/a_(b)";
  assert.equal(readAmoraReferenceAt(`${href}).`, 0)?.href, href);
  assert.equal(readAmoraReferenceAt("xhttps://example.com", 1), null);
});

test("encoded app execution paths, malformed escapes and equivalent app hostnames remain inactive", () => {
  for (const href of ["/%61pi/chat", "/%61uth/callback", "/%2561pi/chat", "https://hanbang.ai/%61dmin", "https://hanbang.ai./admin", "https://example.com/%invalid"]) {
    assert.equal(getSafeAmoraReferenceHref(href), null, href);
  }
});

test("incomplete and nested-label references remain wholly inert, while unnamed valid links use the address", () => {
  for (const source of ["[자료](https://example.com/info", "![사진](https://example.com/image", "![자료 [사진]](https://example.com/image)", "[[자료]](https://example.com/info)"]) {
    assert.deepEqual(readAmoraReferenceAt(source, 0), { type: "text", text: source, length: source.length });
  }
  assert.equal(readAmoraReferenceAt("[  ](https://example.com/info)", 0)?.text, "https://example.com/info");
});

test("oversized reference and image labels keep their whole destination inert without consuming a later valid reference", () => {
  for (const prefix of ["", "!"]) {
    const source = `${prefix}[${"a".repeat(2100)}](https://example.com/image.png)`;
    const suffix = " [정상](https://example.com/next)";
    assert.deepEqual(readAmoraReferenceAt(source + suffix, 0), {
      type: "text", text: source, length: source.length,
    });
  }
});

test("label length boundary keeps supported labels clickable and longer scanning failures inert", () => {
  for (const size of [2047, 2048, 2049, 50000]) {
    const source = `[${"a".repeat(size)}](https://example.com/source)`;
    const token = readAmoraReferenceAt(source, 0);
    assert.equal(token.type, size <= 2048 ? "link" : "text");
    assert.equal(token.length, source.length);
    if (token.type === "text") assert.equal(token.text, source);
    else assert.equal(token.href, "https://example.com/source");
  }
});
