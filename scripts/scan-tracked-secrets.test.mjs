import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateFindings,
  createStreamingScanner,
  scanText,
} from "./scan-tracked-secrets.mjs";

function fixture(...parts) {
  return parts.join("");
}

test("detects every high-risk credential family without returning values", () => {
  const fixtures = [
    ["Supabase personal access token", fixture("sbp_", "A".repeat(40))],
    ["Supabase secret API key", fixture("sb_", "secret_", "B".repeat(36))],
    ["Resend API key", fixture("re_", "C".repeat(32))],
    ["age identity secret", fixture("AGE-SECRET-", "KEY-1", "Q".repeat(40))],
    ["PEM private key", fixture("-----BEGIN ", "PRIVATE KEY-----")],
    ["Cloudflare Turnstile secret key", fixture("0x", "4A".repeat(18))],
  ];

  for (const [category, secret] of fixtures) {
    const findings = scanText("fixture.txt", `prefix\n${secret}\nsuffix`);
    assert.equal(findings.length, 1, `expected one finding for ${category}`);
    assert.deepEqual(findings[0], { category, file: "fixture.txt", line: 2 });
    assert.equal(JSON.stringify(findings).includes(secret), false);
  }
});

test("does not flag public Supabase publishable keys or benign text", () => {
  const publishable = fixture("sb_", "publishable_", "D".repeat(36));
  const turnstileDummyKeys = ["1x", "2x", "3x"].map(
    (prefix) => fixture(prefix, "0".repeat(31), "AA")
  );
  assert.deepEqual(
    scanText("fixture.txt", [publishable, ...turnstileDummyKeys, "ordinary content"].join("\n")),
    []
  );
});

test("exempts only the exact public historical unit-test sentinel", () => {
  const historicalSentinel = fixture("sk-", "test-only-openai-key-1234567890");
  assert.deepEqual(scanText("fixture.txt", historicalSentinel), []);

  const lookalike = fixture("sk-", "test-only-openai-key-1234567891");
  assert.equal(scanText("fixture.txt", lookalike).length, 1);

  const turnstileSentinel = fixture(
    "0x4AAAAAAADDDDDDDD",
    "EEEEEEEEEEEEEEEE"
  );
  assert.deepEqual(scanText("fixture.txt", turnstileSentinel), []);
  assert.equal(
    scanText("fixture.txt", `${turnstileSentinel.slice(0, -1)}F`).length,
    1
  );
});

test("does not exempt random-looking credentials that contain placeholder words", () => {
  const fixtures = [
    ["OpenAI API key", fixture("sk-proj-", "A".repeat(20), "test", "B".repeat(20))],
    ["GitHub token", fixture("ghp_", "C".repeat(20), "fake", "D".repeat(20))],
    ["Supabase personal access token", fixture("sbp_", "E".repeat(20), "example", "F".repeat(20))],
    ["Resend API key", fixture("re_", "G".repeat(20), "changeme", "H".repeat(20))],
  ];

  for (const [category, secret] of fixtures) {
    const findings = scanText("fixture.txt", secret);
    assert.equal(findings.length, 1, `expected one finding for ${category}`);
    assert.equal(findings[0].category, category);
    assert.equal(JSON.stringify(findings).includes(secret), false);
  }
});

test("aggregates repeated redacted locations without retaining a candidate", () => {
  const finding = { category: "Resend API key", file: "git:abc", line: undefined };
  assert.deepEqual(aggregateFindings([finding, finding]), [{
    ...finding,
    occurrences: 2,
  }]);
});

test("streaming scan detects a credential split across process chunks", () => {
  const secret = fixture("re_", "S".repeat(32));
  const scanner = createStreamingScanner("git:fixture");

  scanner.push(`safe line\n${secret.slice(0, 11)}`);
  scanner.push(`${secret.slice(11)}\nanother safe line`);

  const findings = scanner.finish();
  assert.equal(findings.length, 1);
  assert.equal(findings[0].category, "Resend API key");
  assert.equal(JSON.stringify(findings).includes(secret), false);
});
